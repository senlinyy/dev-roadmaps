---
title: "Verification, Rollback, and Runtime Operations"
description: "Use watch windows, smoke tests, CloudWatch, OpenTelemetry, ECS and Lambda evidence, rollback decisions, and runtime actions after AWS traffic moves."
overview: "Traffic movement starts the production verification period. This article explains how an AWS team watches a candidate version, uses layered evidence, decides whether to continue, pause, roll back, or fix forward, and verifies the service after each action."
tags: ["aws", "ecs", "lambda", "cloudwatch", "rollback", "observability"]
order: 3
id: article-cloud-providers-aws-deployment-runtime-operations-deploying-and-updating-an-ecs-service
aliases:
  - verification-rollback-and-runtime-operations
  - release-verification-rollback-runtime-operations
  - article-cloud-providers-aws-deployment-runtime-operations-verification-rollback-runtime-operations
  - deploying-and-updating-an-ecs-service
  - cloud-providers/aws/deployment-runtime-operations/deploying-and-updating-an-ecs-service.md
  - cloud-providers/aws/deployment-runtime-operations/02-ecs-deployments.md
  - article-cloud-providers-aws-deployment-runtime-operations-scaling-jobs-and-operational-controls
  - scaling-jobs-and-operational-controls
  - runtime-controls
  - cloud-providers/aws/deployment-runtime-operations/scaling-jobs-and-operational-controls.md
  - cloud-providers/aws/deployment-runtime-operations/04-runtime-controls.md
---

## Table of Contents

1. [The Watch Window Starts](#the-watch-window-starts)
2. [Smoke Tests and User Journeys](#smoke-tests-and-user-journeys)
3. [CloudWatch, Logs, and Traces](#cloudwatch-logs-and-traces)
4. [ECS Runtime Checks](#ecs-runtime-checks)
5. [Lambda Runtime Checks](#lambda-runtime-checks)
6. [Rollback, Pause, or Fix Forward](#rollback-pause-or-fix-forward)
7. [After the Action](#after-the-action)
8. [Official References](#official-references)

## The Watch Window Starts
<!-- section-summary: Verification starts when production traffic reaches the candidate version. -->

The release has moved traffic. `checkout-api:58` is now the primary ECS deployment, and the `checkout-handler` Lambda alias sends a small percentage of webhook traffic to version `17`. The deployment command returned success, but users have only just started touching the candidate. **Verification** is the watch period where the team proves the new runtime state behaves the way the release record promised.

A useful watch window has a time target and a sample target. For example, watch for 20 minutes and at least 500 checkout attempts. Time helps catch slow failures. Sample count helps during quiet traffic periods. The team should decide these numbers before traffic moves so nobody has to negotiate the rules during a problem.

For this module, the watch window follows the same flow every time:

| Layer | Evidence | Continue when | Next action if bad |
|---|---|---|---|
| Smoke test | Health, version, and checkout path | Test calls pass with candidate version visible | Pause traffic and inspect logs before wider exposure |
| Platform health | ECS deployments, ALB target health, Lambda alias and metrics | Runtime targets are healthy and alarms stay OK | Inspect service events, target reasons, throttles, or concurrency |
| Application behavior | Logs, traces, business counters | Error rate, latency, and checkout success stay near baseline | Roll back, pause, or fix forward based on impact and rollback safety |
| Side effects | Queues, S3 writes, database rows, payment events | Backlog and writes look expected | Clean up partial writes or replay failed work after recovery |

The rest of this article turns that table into commands and decisions. Each check should answer three things: what did we see, what does it mean, and what should we do next?

![The watch window board shows the release evidence a responder should keep visible after traffic starts moving](/content-assets/articles/article-cloud-providers-aws-deployment-runtime-operations-deploying-and-updating-an-ecs-service/watch-window-evidence-board.png)

*The watch window board shows the release evidence a responder should keep visible after traffic starts moving.*


## Smoke Tests and User Journeys
<!-- section-summary: Smoke tests prove the release can complete the important user path after traffic moves. -->

A **smoke test** is a small production-safe test that checks the important path after deployment. For checkout, a useful smoke test confirms the API is alive, the running version is the candidate, and a test checkout can move through tax, payment sandbox mode, order creation, receipt writing, and logs.

Start with small endpoint checks:

```bash
curl -fsS https://api.example.com/health

curl -fsS https://api.example.com/version
```

Example output:

```json
{
  "status": "ok",
  "dependencies": {
    "database": "ok",
    "payments": "ok"
  }
}
```

```json
{
  "service": "checkout-api",
  "version": "2026-06-24.3",
  "taskDefinition": "checkout-api:58",
  "imageDigest": "sha256:9d8b7f6a5e4c3b2a111111111111111111111111111111111111111111111111"
}
```

`-f` makes `curl` fail on HTTP error responses. `-sS` keeps normal progress output quiet while still printing errors. The health response shows the app and key dependencies are reachable. The version response ties the request to the candidate artifact and task definition. The next action is to run a user-journey smoke test through the same public path users use.

```bash
curl -fsS -X POST https://api.example.com/test-checkout \
  -H "content-type: application/json" \
  -H "x-release-smoke: checkout-api-2026-06-24.3" \
  -d '{"sku":"SMOKE-TEST-SKU","quantity":1,"paymentMode":"sandbox"}'
```

Example output:

```json
{
  "status": "accepted",
  "orderId": "smoke_20260624_1012",
  "paymentMode": "sandbox",
  "receiptKey": "receipts-v2/smoke_20260624_1012.pdf",
  "version": "2026-06-24.3"
}
```

The POST sends a safe test order with a marker header that logs can search later. The response proves the checkout path accepted the order, used sandbox payment mode, wrote the receipt to the v2 prefix, and returned the candidate version. The next action for this output is to record the order ID in the release log and check logs or traces for the same marker. If the request fails, pause the rollout before waiting for more users to hit the same path.

Smoke tests should use safe test data, idempotency where the API supports it, and a cleanup or retention plan. The goal is a small test that operators trust enough to run during every release.

## CloudWatch, Logs, and Traces
<!-- section-summary: Metrics, alarms, logs, and traces show whether the candidate behaves under real traffic. -->

CloudWatch metrics and alarms give the release a fast read on error rate, latency, throttles, queue depth, and resource pressure. Logs explain individual failures. Traces from AWS X-Ray or OpenTelemetry help when a checkout request crosses ECS, Lambda, DynamoDB, SQS, S3, and an external payment provider.

Start by checking release alarms:

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix checkout-api-prod \
  --region eu-west-2 \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Reason:StateReason}'
```

Example output:

```json
[
  {
    "Name": "checkout-api-prod-5xx-rate",
    "State": "OK",
    "Reason": "Recent datapoints stayed below the 1.0 threshold."
  },
  {
    "Name": "checkout-api-prod-p95-latency",
    "State": "OK",
    "Reason": "Recent datapoints stayed below the 900.0 threshold."
  }
]
```

`State` should stay `OK` through the watch window. `ALARM` means the metric is breaching. `INSUFFICIENT_DATA` means CloudWatch lacks enough datapoints yet, which can happen early in a release or with quiet traffic. The next action for `OK` alarms is to keep watching application-level checks. The next action for `ALARM` is to read the metric, logs, and release decision rule before moving more traffic.

Logs should include version, request ID, route, treatment, and safe error fields. During a checkout release, search the recent window with the smoke marker or the risky operation:

```bash
aws logs tail /ecs/prod/checkout-api \
  --since 20m \
  --region eu-west-2 \
  --filter-pattern '"checkout"'
```

Example output:

```console
2026-06-24T10:12:07.111Z task/checkout-api/91d2 INFO checkout_completed orderId=smoke_20260624_1012 version=2026-06-24.3 treatment=v2 durationMs=184
2026-06-24T10:13:28.402Z task/checkout-api/a84e ERROR checkout_failed orderId=ord_9921 version=2026-06-24.3 treatment=v2 error=PaymentEndpointRejected durationMs=221
```

The first line supports the smoke test. The second line shows a candidate-version payment failure on treatment `v2`. The next action is to compare the error count with the release threshold and inspect configuration for the payment endpoint. If repeated candidate-only errors appear, pause or roll back according to the release plan.

Metrics show the pattern behind those individual lines. A focused metric check can confirm whether the alarm state matches recent datapoints:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=TargetGroup,Value="$TARGET_GROUP_DIMENSION" Name=LoadBalancer,Value="$LOAD_BALANCER_DIMENSION" \
  --statistics Sum \
  --period 60 \
  --start-time 2026-06-24T10:00:00Z \
  --end-time 2026-06-24T10:20:00Z \
  --region eu-west-2 \
  --query 'Datapoints[].{Time:Timestamp,Errors:Sum}'
```

Example output:

```json
[
  {
    "Time": "2026-06-24T10:12:00+00:00",
    "Errors": 1.0
  },
  {
    "Time": "2026-06-24T10:13:00+00:00",
    "Errors": 9.0
  },
  {
    "Time": "2026-06-24T10:14:00+00:00",
    "Errors": 11.0
  }
]
```

The datapoints show errors rising after the candidate received traffic. The next action is to decide whether the rise crosses the release stop rule. If it does, stop traffic movement and choose rollback, pause, or fix forward. If it stays under the threshold, keep watching until the window completes.

Traces add one more layer when the symptom crosses services. If a trace shows most time spent in a payment provider segment, the next action is different from a trace showing slow database writes. The operational habit is to follow the failing request across service boundaries before changing unrelated resources.

## ECS Runtime Checks
<!-- section-summary: ECS evidence comes from service deployments, service events, target health, stopped tasks, logs, and resource metrics. -->

For ECS, the service can report success at one layer and trouble at another. A task may be running while the load balancer marks it unhealthy. A target may be healthy while the app logs show candidate-only payment errors. Good verification reads the layers together.

Start with the service deployment state:

```bash
aws ecs describe-services \
  --cluster prod-web \
  --services checkout-api \
  --region eu-west-2 \
  --query 'services[].{Events:events[0:5].message,Deployments:deployments[].{Status:status,TaskDefinition:taskDefinition,Running:runningCount,Pending:pendingCount,Rollout:rolloutState,Reason:rolloutStateReason}}'
```

Example output:

```json
[
  {
    "Events": [
      "(service checkout-api) has reached a steady state.",
      "(service checkout-api) registered 4 targets in (target-group arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/prod-checkout/abc123)."
    ],
    "Deployments": [
      {
        "Status": "PRIMARY",
        "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/checkout-api:58",
        "Running": 4,
        "Pending": 0,
        "Rollout": "COMPLETED",
        "Reason": "ECS deployment ecs-svc/123 completed."
      }
    ]
  }
]
```

The output says ECS placed the candidate tasks, registered targets, and completed the deployment. The next action is to check target health and application evidence because ECS steady state only proves the service scheduler finished its work.

```bash
aws elbv2 describe-target-health \
  --target-group-arn "$TG_ARN" \
  --region eu-west-2 \
  --query 'TargetHealthDescriptions[].{Target:Target.Id,Port:Target.Port,State:TargetHealth.State,Reason:TargetHealth.Reason,Description:TargetHealth.Description}'
```

Example output:

```json
[
  {
    "Target": "10.0.24.81",
    "Port": 3000,
    "State": "healthy",
    "Reason": null,
    "Description": null
  },
  {
    "Target": "10.0.31.44",
    "Port": 3000,
    "State": "unhealthy",
    "Reason": "Target.ResponseCodeMismatch",
    "Description": "Health checks failed with these codes: [500]"
  }
]
```

One target is healthy and one target fails the health check with HTTP 500. The next action is to inspect the failing task logs and startup readiness path before allowing the rollout to continue. Common causes include a bad health endpoint, missing config, wrong container port, security group issue, slow startup, or a dependency required by readiness.

If tasks stopped during the rollout, inspect stopped task reasons:

```bash
aws ecs list-tasks \
  --cluster prod-web \
  --service-name checkout-api \
  --desired-status STOPPED \
  --region eu-west-2 \
  --query 'taskArns[0:3]'
```

Example output:

```json
[
  "arn:aws:ecs:eu-west-2:123456789012:task/prod-web/0f4b0c3d2a1e4f5a8b9c"
]
```

The list gives task ARNs to inspect. The next action is to describe one stopped task:

```bash
aws ecs describe-tasks \
  --cluster prod-web \
  --tasks arn:aws:ecs:eu-west-2:123456789012:task/prod-web/0f4b0c3d2a1e4f5a8b9c \
  --region eu-west-2 \
  --query 'tasks[].{StoppedReason:stoppedReason,Containers:containers[].{Name:name,ExitCode:exitCode,Reason:reason}}'
```

Example output:

```json
[
  {
    "StoppedReason": "Essential container in task exited",
    "Containers": [
      {
        "Name": "checkout-api",
        "ExitCode": 1,
        "Reason": "CannotStartContainerError"
      }
    ]
  }
]
```

The task exited before it could serve traffic. The next action is to read container logs around startup and check image pull permissions, missing environment variables, secret access, and application startup validation. A stopped task reason gives direction, while logs usually give the exact failure.

![The runtime checks compare container service evidence and function evidence before the team chooses rollback, pause, or repair](/content-assets/articles/article-cloud-providers-aws-deployment-runtime-operations-deploying-and-updating-an-ecs-service/runtime-checks-services-functions.png)

*The runtime checks compare container service evidence and function evidence before the team chooses rollback, pause, or repair.*


## Lambda Runtime Checks
<!-- section-summary: Lambda evidence comes from alias routing, invocation metrics, logs, throttles, concurrency, and event source state. -->

For Lambda, first confirm the traffic pointer. If the release plan says the `prod` alias sends 10 percent to version `17`, the alias output should show that exact route:

```bash
aws lambda get-alias \
  --function-name checkout-handler \
  --name prod \
  --region eu-west-2 \
  --query '{Name:Name,FunctionVersion:FunctionVersion,RoutingConfig:RoutingConfig}'
```

Example output:

```json
{
  "Name": "prod",
  "FunctionVersion": "16",
  "RoutingConfig": {
    "AdditionalVersionWeights": {
      "17": 0.1
    }
  }
}
```

`FunctionVersion` is the primary alias target. `AdditionalVersionWeights` sends 10 percent to version `17`. The next action is to watch metrics and logs for both versions. If the alias points somewhere unexpected, fix the alias before interpreting application symptoms.

Check Lambda errors for the release window:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=checkout-handler Name=Resource,Value=checkout-handler:prod \
  --statistics Sum \
  --period 60 \
  --start-time 2026-06-24T10:00:00Z \
  --end-time 2026-06-24T10:20:00Z \
  --region eu-west-2 \
  --query 'Datapoints[].{Time:Timestamp,Errors:Sum}'
```

Example output:

```json
[
  {
    "Time": "2026-06-24T10:10:00+00:00",
    "Errors": 0.0
  },
  {
    "Time": "2026-06-24T10:11:00+00:00",
    "Errors": 6.0
  },
  {
    "Time": "2026-06-24T10:12:00+00:00",
    "Errors": 8.0
  }
]
```

The errors start during the watch window. The next action is to filter logs by version or request marker and check whether version `17` has a different error pattern from version `16`. Also check `Duration`, `Throttles`, and concurrency if errors pair with slower runtime or capacity pressure.

For queue-backed or stream-backed functions, verify the event source state because traffic rollback may stop new failures while old failed messages remain:

```bash
aws lambda list-event-source-mappings \
  --function-name checkout-handler \
  --region eu-west-2 \
  --query 'EventSourceMappings[].{UUID:UUID,State:State,FunctionArn:FunctionArn,LastProcessingResult:LastProcessingResult}'
```

Example output:

```json
[
  {
    "UUID": "6f0b3ac1-4fc3-4c40-a8f9-1f2d4b8c9012",
    "State": "Enabled",
    "FunctionArn": "arn:aws:lambda:eu-west-2:123456789012:function:checkout-handler:prod",
    "LastProcessingResult": "OK"
  }
]
```

`State` shows whether Lambda is polling the event source. `FunctionArn` shows the target the event source invokes. `LastProcessingResult` gives a quick status for recent polling. The next action is to check queue depth, iterator age, dead-letter queues, and failed batch behavior if errors rise or processing stalls.

Lambda verification should always match the trigger type. API-backed Lambda needs HTTP status and latency. SQS-backed Lambda needs queue age, batch failures, and dead-letter queue count. Stream-backed Lambda needs iterator age and retry behavior. Scheduled Lambda needs completion and downstream side effects.

## Rollback, Pause, or Fix Forward
<!-- section-summary: The response should match impact, confidence, and the safety of the previous state. -->

Bad signals lead to one of three common actions. **Rollback** returns traffic to the previous known-good state. **Pause** holds the rollout at the current exposure while the team gathers evidence. **Fix forward** deploys a targeted correction when rollback would create more risk, such as after a one-way data migration or external event format change.

The decision should include evidence, impact, action, and verification. A short note is enough:

```yaml
decision: rollback
time: 2026-06-24T10:18:00Z
trigger:
  - checkout-api candidate 5XX rose above 4 percent
  - smoke checkout failed payment authorization
  - target health was green
  - logs showed PaymentEndpointRejected on version 2026-06-24.3
action:
  - move ECS service back to task definition checkout-api:57
verify:
  - 5XX below 0.5 percent for 10 minutes
  - smoke checkout passes
  - payment rejection logs stop
```

The note explains why rollback is the right action. Target health stayed green, so the service was reachable. The application logs showed payment failures, so the candidate behavior was bad. The next action is to run the rollback command and verify recovery with the same checks that detected the problem.

For ECS rollback:

```bash
aws ecs update-service \
  --cluster prod-web \
  --service checkout-api \
  --task-definition checkout-api:57 \
  --region eu-west-2 \
  --query 'service.{Service:serviceName,TaskDefinition:taskDefinition,Deployments:deployments[].{Status:status,TaskDefinition:taskDefinition,Rollout:rolloutState}}'
```

Example output:

```json
{
  "Service": "checkout-api",
  "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/checkout-api:57",
  "Deployments": [
    {
      "Status": "PRIMARY",
      "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/checkout-api:57",
      "Rollout": "IN_PROGRESS"
    },
    {
      "Status": "ACTIVE",
      "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/checkout-api:58",
      "Rollout": "IN_PROGRESS"
    }
  ]
}
```

The service points back to `checkout-api:57`, and ECS has started replacing candidate tasks. The next action is to watch service events, target health, logs, alarms, and smoke tests until the previous revision reaches steady state and the bad symptoms stop.

For Lambda rollback:

```bash
aws lambda update-alias \
  --function-name checkout-handler \
  --name prod \
  --function-version 16 \
  --routing-config '{"AdditionalVersionWeights":{}}' \
  --region eu-west-2 \
  --query '{Name:Name,FunctionVersion:FunctionVersion,RoutingConfig:RoutingConfig}'
```

Example output:

```json
{
  "Name": "prod",
  "FunctionVersion": "16",
  "RoutingConfig": {
    "AdditionalVersionWeights": {}
  }
}
```

The alias sends all `prod` traffic back to version `16` because the weighted candidate map is empty. The next action is to check Lambda errors, duration, throttles, logs, and any event source backlog. A rollback can stop new failures while old failed messages still need replay, dead-letter handling, or cleanup.

Fix forward needs a tighter bar than rollback. Use it when the candidate wrote data that requires new reader logic, when a rollback would duplicate external actions, or when a small config correction can restore service faster with less user impact. The release log should say why rollback was risky and which evidence proved the fix forward worked.

![The decision view shows when rollback, pause, or fix-forward is the safer operational response](/content-assets/articles/article-cloud-providers-aws-deployment-runtime-operations-deploying-and-updating-an-ecs-service/rollback-pause-fix-forward.png)

*The decision view shows when rollback, pause, or fix-forward is the safer operational response.*


## After the Action
<!-- section-summary: Runtime operations continue after success or rollback because partial side effects may remain. -->

After a successful rollout, close the release with evidence. After a rollback, keep operating until the system is actually recovered. The bad version may have written partial data, left failed queue messages, created S3 objects, changed feature flag exposure, or caused users to retry actions.

For ECS, confirm the service has settled on the expected revision:

```bash
aws ecs describe-services \
  --cluster prod-web \
  --services checkout-api \
  --region eu-west-2 \
  --query 'services[].deployments[].{Status:status,TaskDefinition:taskDefinition,Running:runningCount,Pending:pendingCount,Rollout:rolloutState}'
```

Example output:

```json
[
  {
    "Status": "PRIMARY",
    "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/checkout-api:57",
    "Running": 4,
    "Pending": 0,
    "Rollout": "COMPLETED"
  }
]
```

One `PRIMARY` deployment with the expected task definition and `COMPLETED` rollout means ECS settled after rollback. The next action is to repeat the smoke test, confirm alarms return to `OK`, and inspect side effects from the failed candidate.

If checkout uses SQS for receipt jobs, check queue backlog after the action:

```bash
aws sqs get-queue-attributes \
  --queue-url "$RECEIPT_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateAgeOfOldestMessage \
  --region eu-west-2
```

Example output:

```json
{
  "Attributes": {
    "ApproximateNumberOfMessages": "3",
    "ApproximateNumberOfMessagesNotVisible": "0",
    "ApproximateAgeOfOldestMessage": "42"
  }
}
```

`ApproximateNumberOfMessages` shows visible backlog. `ApproximateNumberOfMessagesNotVisible` shows messages currently being processed or waiting for visibility timeout. `ApproximateAgeOfOldestMessage` shows how stale the oldest visible message is in seconds. The next action is to decide whether the backlog will drain normally, needs replay, or contains messages from the bad candidate that require special handling.

Finally, check that release alarms recovered:

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix checkout-api-prod \
  --region eu-west-2 \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Reason:StateReason}'
```

Example output:

```json
[
  {
    "Name": "checkout-api-prod-5xx-rate",
    "State": "OK",
    "Reason": "Recent datapoints stayed below the 1.0 threshold."
  },
  {
    "Name": "checkout-api-prod-p95-latency",
    "State": "OK",
    "Reason": "Recent datapoints stayed below the 900.0 threshold."
  }
]
```

`OK` alarms after rollback or completion support recovery, but they are only one layer. The next action is to close the release or incident with the decision, commands run, outputs observed, user impact, cleanup tasks, and one improvement for the next release. Good improvements are specific: add a startup validation, add the parameter version to release notes, label logs with feature treatment, or add a smoke test for the missed path.

This is the complete release flow for the module: identify the artifact, place it in a runtime target, supply the right configuration and identity, move traffic carefully, verify with layered evidence, roll back or fix forward with a known path, and keep operating until the user-facing system is clean.

## Official References

- [Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html)
- [Amazon ECS service load balancing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html)
- [Amazon ECS stopped task errors](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/stopped-task-errors.html)
- [Describe target health for Application Load Balancers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/check-target-health.html)
- [CloudWatch alarm concepts](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)
- [View log data sent to CloudWatch Logs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html)
- [Lambda aliases](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html)
- [Lambda weighted aliases](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html)
- [Monitoring and troubleshooting Lambda applications](https://docs.aws.amazon.com/lambda/latest/dg/lambda-monitoring.html)
- [Using AWS Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [Amazon SQS queue metrics](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)
