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

1. [What This Article Covers](#what-this-article-covers)
2. [The Release Continues When Traffic Moves](#the-release-continues-when-traffic-moves)
3. [Watch Window](#watch-window)
4. [How To Run The Watch Window](#how-to-run-the-watch-window)
5. [Verification Has Layers](#verification-has-layers)
6. [Industrial Observability and On-Call Stack](#industrial-observability-and-on-call-stack)
7. [Health Checks and Smoke Tests](#health-checks-and-smoke-tests)
8. [Real Traffic Telemetry](#real-traffic-telemetry)
9. [Rollback](#rollback)
10. [How To Roll Back In AWS](#how-to-roll-back-in-aws)
11. [Failure Scenarios and Decisions](#failure-scenarios-and-decisions)
12. [Runtime Operations After the Decision](#runtime-operations-after-the-decision)
13. [How To Verify After The Action](#how-to-verify-after-the-action)
14. [Release Record](#release-record)
15. [Putting It All Together](#putting-it-all-together)

## What This Article Covers
<!-- section-summary: This article starts after production traffic reaches the AWS candidate and the team needs evidence for the next decision. -->

The previous articles introduced the full AWS release shape, runtime configuration, secrets, feature flags, and safe rollout controls. The team has a running service, a candidate task definition, a rollback target, health checks, and enough deployment evidence to know that AWS accepted the rollout. This article starts at the next moment: production traffic has reached the candidate version, and the team has to decide what happens next.

We will keep using `devpolaris-orders-api`, the checkout API for DevPolaris. The team shipped a candidate version with new receipt retry behavior. The service runs on Amazon ECS behind an Application Load Balancer. Some adjacent checkout work also runs in AWS Lambda, such as a receipt-finalizer function that responds to events after checkout completes.

The candidate task definition is `orders-api:43`, and the previous stable task definition is `orders-api:42`. Production traffic has moved to the candidate through the ECS rolling deployment. If the team also uses blue/green or weighted routing in another environment, the same verification habit still applies: traffic has reached a new runtime version, so the release owner needs evidence from real users and real AWS signals.

This article has four practical jobs. First, we define the **watch window**, which is the active observation period after traffic moves. Then we connect health checks, smoke tests, CloudWatch telemetry, OpenTelemetry fields, ECS evidence, Lambda evidence, and on-call routing. After that, we compare **rollback**, **pause**, **continue**, and **fix forward** decisions. Finally, we write the release record so the team can explain what happened after the release is complete.

## The Release Continues When Traffic Moves
<!-- section-summary: Moving traffic starts the production verification period because staging checks cover only part of the real customer path. -->

Traffic movement is the moment the candidate starts serving real users. In ECS, that usually means the service controller has started tasks for the new task definition, the Application Load Balancer target group marks those tasks healthy, and old tasks begin draining as the deployment progresses. In Lambda, it might mean a production alias points to a new function version or splits a small percentage of invocations to it.

The release still needs active judgment because production adds details that staging rarely captures perfectly. Real customers send larger carts, expired payment tokens, repeated clicks, slow mobile networks, old client versions, and unusual address formats. The API also talks to real dependencies with real limits, such as Amazon RDS connection pools, Amazon S3 receipt storage, Amazon SQS queues, payment provider APIs, and CloudWatch telemetry pipelines.

For `devpolaris-orders-api`, the release question changes after traffic reaches `orders-api:43`. Before traffic moved, the team asked whether the task started, passed target health checks, and responded to direct checks. After traffic moves, the team asks whether checkout stays healthy for customers. That includes failed requests, p95 and p99 latency, RDS errors, S3 receipt writes, SQS publish failures, Lambda receipt-finalizer errors, and support or incident signals.

This is the point where a release can drift into loose attention. One person watches a dashboard. Another scans logs. Someone else asks whether the release is done. A **watch window** turns that loose attention into a named operating period with a clear owner, clear signals, and a clear decision at the end.

## Watch Window
<!-- section-summary: A watch window is a time-boxed release verification period with an owner, signal list, thresholds, and decision rule. -->

A **watch window** is a planned period of active observation after a release step. It names the release owner, traffic state, duration, user paths, telemetry signals, thresholds, and final decision. The team can use one watch window after a rolling ECS deployment completes, after a blue/green traffic shift, after a Lambda alias canary step, or after a risky configuration change.

The watch window should match the part of the product that the release can affect. A checkout API should watch checkout outcomes alongside average CPU. A receipt retry change should watch receipt storage, retry counts, duplicate receipts, queue messages, and downstream functions. General service health matters, and release-specific signals prove much more about the candidate.

Here is a watch window for the orders API. It records the deployment target, the paths the team cares about, the AWS evidence sources, and the decision rule before the candidate receives more confidence:

```yaml
watch_window:
  release: orders-api-2026-06-13-v43
  owner: platform-api-oncall
  runtime:
    primary: Amazon ECS
    cluster: production-apps
    service: orders-api-prod
    stable_task_definition: orders-api:42
    candidate_task_definition: orders-api:43
    load_balancer_target_group: tg-orders-api-prod
  duration: 20 minutes
  primary_paths:
    - POST /checkout
    - GET /orders/{id}
  adjacent_runtime:
    - lambda: receipt-finalizer-prod
  signals:
    - ECS service reaches steady state
    - ALB target health stays healthy for candidate tasks
    - failed checkout request rate stays near baseline
    - p95 checkout duration stays near baseline
    - RDS dependency errors stay near baseline
    - S3 receipt write failures stay near baseline
    - SQS publish failures stay near baseline
    - receipt-finalizer Lambda errors and throttles stay near baseline
    - CloudWatch Logs and traces contain candidate version fields
  decision:
    continue_if: candidate signals stay near baseline for the full window
    pause_if: telemetry is missing or evidence is incomplete
    rollback_if: checkout failure rate is above 2 percent for 5 minutes on the candidate
    fix_forward_if: issue is isolated, low impact, and a prepared config or flag change resolves it
```

The exact numbers depend on the service. A high-volume checkout path may need tighter thresholds and automated alarms because five minutes can contain thousands of failed users. A low-volume admin API may need synthetic checks because real traffic arrives slowly. A release with data migration risk may need a longer window because delayed jobs or async consumers may show the failure later.

The useful habit stays the same across those cases: decide what evidence matters before traffic moves. The watch window gives the release owner a calm structure for deciding whether to continue, pause, roll back, or fix forward. Now we can walk through the hands-on flow for running it.

## How To Run The Watch Window
<!-- section-summary: Running the watch window means capturing AWS state, checking health, querying telemetry, and writing the decision. -->

The first practical move is a state capture. The release owner records what AWS says right now before interpreting graphs. If the team later asks which task definition served traffic at 14:10 UTC, the release record should already have the answer.

For ECS, start with the service. This command shows the active deployments, task definitions, rollout state, desired count, running count, and recent service events:

```bash
aws ecs describe-services \
  --cluster production-apps \
  --services orders-api-prod \
  --query "services[0].{service:serviceName,status:status,desired:desiredCount,running:runningCount,pending:pendingCount,deployments:deployments[].{status:status,rolloutState:rolloutState,taskDefinition:taskDefinition,runningCount:runningCount,pendingCount:pendingCount},events:events[0:5].[createdAt,message]}" \
  --output json
```

Then inspect the running tasks. This helps the owner confirm that the candidate task definition has actual running tasks and that the launch type, availability zone spread, and task health make sense:

```bash
TASK_ARNS=$(aws ecs list-tasks \
  --cluster production-apps \
  --service-name orders-api-prod \
  --desired-status RUNNING \
  --query "taskArns[]" \
  --output text)

aws ecs describe-tasks \
  --cluster production-apps \
  --tasks $TASK_ARNS \
  --query "tasks[].{taskArn:taskArn,lastStatus:lastStatus,healthStatus:healthStatus,taskDefinition:taskDefinition,startedAt:startedAt,containers:containers[].{name:name,lastStatus:lastStatus,healthStatus:healthStatus,exitCode:exitCode,reason:reason}}" \
  --output table
```

Next, check the Application Load Balancer target group. ECS can report a service as active while a load balancer target still has health problems. The target health view tells you whether the load balancer is willing to send HTTP traffic to the tasks:

```bash
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:eu-west-2:111122223333:targetgroup/tg-orders-api-prod/abc123def456 \
  --query "TargetHealthDescriptions[].{target:Target.Id,port:Target.Port,state:TargetHealth.State,reason:TargetHealth.Reason,description:TargetHealth.Description}" \
  --output table
```

Direct health checks come next. The release owner calls health and readiness endpoints through the production route. If the platform supports a candidate-only route through a test listener, service mesh, or blue/green test listener, the owner can also call that. The important point is that the check should exercise the real network path the customers use.

```bash
curl -fsS https://orders-api.devpolaris.example/healthz
curl -fsS https://orders-api.devpolaris.example/readyz
```

After that, move to targeted telemetry. In CloudWatch Logs Insights, keep saved queries for checkout requests, dependency errors, and exceptions. The application should write structured JSON logs with fields such as `service`, `env`, `version`, `taskDefinition`, `route`, `statusCode`, `durationMs`, and `traceId`. Without version fields, the team can only see blended production behavior, which makes release decisions weaker.

```sql
fields @timestamp, level, route, statusCode, durationMs, version, taskDefinition, traceId, message
| filter service = "devpolaris-orders-api"
| filter route = "POST /checkout"
| filter @timestamp >= ago(20m)
| stats
    count(*) as total,
    sum(if(statusCode >= 500, 1, 0)) as serverErrors,
    pct(durationMs, 95) as p95DurationMs,
    pct(durationMs, 99) as p99DurationMs
  by bin(5m), version, taskDefinition
| sort bin(5m) asc
```

If the release includes Lambda behavior, capture Lambda evidence too. This example checks CloudWatch metrics for the receipt-finalizer function during the same window. The release owner watches `Errors`, `Throttles`, and `Duration` because async failures can turn a green checkout response into broken receipt handling later:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=receipt-finalizer-prod \
  --start-time 2026-06-13T13:40:00Z \
  --end-time 2026-06-13T14:00:00Z \
  --period 300 \
  --statistics Sum \
  --output table

aws logs filter-log-events \
  --log-group-name /aws/lambda/receipt-finalizer-prod \
  --start-time 1781358000000 \
  --filter-pattern '"checkoutReceipt" "ERROR"' \
  --limit 20
```

At the end of the watch window, the owner writes one of four decisions: **continue**, **pause**, **rollback**, or **fix forward**. That decision should include the time, AWS state, evidence snapshot, and next action. A short record gives the team a shared memory instead of several people remembering the same release differently.

## Verification Has Layers
<!-- section-summary: Good verification combines AWS platform state, direct checks, real traffic telemetry, alerts, and business signals. -->

**Verification** means proving that the candidate works well enough for the next release step. One green signal rarely proves the whole release. A service can have healthy ECS tasks while checkout requests fail. A smoke test can pass while real traffic finds a rare edge case. A dashboard can look quiet because telemetry stopped shipping.

The first layer is **AWS platform state**. ECS tells you whether tasks are running, whether the service reached a steady state, whether the deployment circuit breaker fired, and what service events AWS emitted. The Application Load Balancer tells you whether targets are healthy. Lambda tells you whether invocations, errors, throttles, and duration moved away from baseline.

The second layer is **direct functional checks**. A smoke test sends a known request through a known path and checks the expected result. For the orders API, that means creating a synthetic checkout, confirming the response, verifying the order write, verifying receipt storage, checking queue publication, and confirming telemetry arrived.

The third layer is **real traffic telemetry**. CloudWatch Logs, CloudWatch Metrics, AWS X-Ray, OpenTelemetry traces, Prometheus metrics, or an observability platform can show what real customers are experiencing. This layer matters because production users bring data shapes and timing that tests rarely cover completely.

The fourth layer is **alerting and business signals**. CloudWatch alarms, SLO burn-rate alerts, payment provider signals, support tickets, and customer service notes connect technical health to user impact. These signals matter most when the platform reports healthy targets while customers still fail to finish checkout.

Here is a layered verification checklist for `devpolaris-orders-api`:

| Layer | What it answers | Example signal |
|---|---|---|
| **AWS platform state** | Can AWS run and route to the candidate? | ECS deployment steady, ALB targets healthy, Lambda errors near baseline |
| **Smoke tests** | Can a known checkout path work on demand? | Synthetic checkout writes order, stores receipt, emits trace |
| **Real traffic telemetry** | How does the candidate behave under users? | 5xx rate, p95 latency, dependency errors, exception count by version |
| **Alerts** | Did an agreed threshold cross? | CloudWatch alarm for checkout 5xx rate or Lambda error spike |
| **Business signals** | Are customers failing the release path? | Failed payment handoffs, missing receipts, support reports |

The layers work together. Healthy ALB targets with rising checkout failures point toward application code or dependency behavior. Failed target health with no user traffic points toward startup, readiness, port, or security group behavior. Missing telemetry during a release supports a pause because the team lacks proof that the candidate is healthy.

The next layer connects those signals to the tools and human flow real teams use. AWS gives strong native observability surfaces, and many production teams also use OpenTelemetry and an on-call system so the release evidence leads to action.

## Industrial Observability and On-Call Stack
<!-- section-summary: Production release verification connects CloudWatch and AWS evidence to OpenTelemetry, SLOs, dashboards, alerts, and on-call runbooks. -->

**Observability** is the ability to understand what a running system is doing from its external evidence: logs, metrics, traces, events, and alerts. In AWS, the native stack usually includes Amazon CloudWatch Logs, CloudWatch Metrics, CloudWatch Alarms, AWS X-Ray, ECS service events, ALB metrics, and Lambda metrics. Many companies then add OpenTelemetry so the application emits portable telemetry that can go to AWS services or to another backend.

**OpenTelemetry** is an open standard for collecting traces, metrics, and logs. For a beginner, think of it as a common vocabulary and library set for telemetry. Instead of each application hardcoding one monitoring vendor, the app records useful attributes such as service name, route, version, trace id, and cloud region. That telemetry can then flow through AWS Distro for OpenTelemetry, the OpenTelemetry Collector, CloudWatch, X-Ray, Prometheus, Grafana, Datadog, New Relic, Honeycomb, or another backend the company uses.

For the orders API, the release owner needs stable fields that make release queries possible. The exact backend can vary, but the fields should stay consistent:

```yaml
telemetry_contract:
  standard: OpenTelemetry
  service.name: devpolaris-orders-api
  deployment.environment: production
  service.version: v43
  aws.ecs.cluster: production-apps
  aws.ecs.service: orders-api-prod
  aws.ecs.task_definition: orders-api:43
  http.route: POST /checkout
  cloud.provider: aws
  cloud.region: eu-west-2
  release_queries_group_by:
    - service.version
    - aws.ecs.task_definition
    - http.route
    - dependency.name
```

SLOs turn telemetry into decisions. An **SLI** is the measured signal, such as successful checkout requests divided by total checkout requests. An **SLO** is the target, such as 99.5 percent successful checkout requests over 28 days. The watch-window gate can be stricter than the long-term SLO because the release owner wants to catch candidate-specific damage quickly.

```yaml
slo_release_gate:
  user_journey: checkout
  sli: successful POST /checkout requests / total POST /checkout requests
  long_term_slo: 99.5 percent success over 28 days
  watch_window_gate:
    rollback_if: candidate checkout failure rate is above 2 percent for 5 minutes
    pause_if: candidate telemetry is missing or version fields are absent
  alert_route:
    cloudwatch_alarm: orders-api-prod-checkout-5xx-high
    incident_channel: platform-api-incidents
    pager: platform-api-oncall
    runbook: rollback-orders-api-ecs
```

The on-call system turns alerts into coordinated action. Some teams use PagerDuty. Others use Opsgenie, incident.io, ServiceNow, Slack workflows, Microsoft Teams, or a homegrown flow. The tool matters less than the handoff: the alert should name the service, the symptom, the dashboard, the runbook, the release owner, and the decision channel.

Runbooks are part of this stack. A runbook is a short, tested operating guide for a known situation. The rollback runbook for the orders API should include the exact ECS command, the previous task definition, the target health check, the CloudWatch query, and the release record location. During pressure, the team needs a prepared rollback sequence instead of relying on memory.

AWS provides the runtime evidence. OpenTelemetry keeps instrumentation portable. CloudWatch alarms and dashboards keep the watch visible. PagerDuty-style tools route human attention. Runbooks turn attention into repeatable action. This whole stack exists so the team can respond to evidence instead of arguing over guesses.

## Health Checks and Smoke Tests
<!-- section-summary: Health checks prove the runtime can receive traffic, while smoke tests prove a small user path works end to end. -->

A **health check** is a lightweight test that helps the platform decide whether a runtime target can receive traffic. For ECS behind an Application Load Balancer, the target group health check calls a path such as `/healthz` or `/readyz` on each task. If the task fails enough health checks, the load balancer stops routing new requests to it.

Health checks should match their routing job. A shallow `/healthz` endpoint can prove the process is alive. A readiness endpoint can prove the app loaded configuration and can serve traffic. A health check should stay fast and reliable because a fragile health check can remove good tasks from rotation and make the release worse.

For the orders API, a useful readiness response might look like this. It exposes version and dependency readiness without leaking secrets, connection strings, or customer data:

```json
{
  "status": "ready",
  "service": "devpolaris-orders-api",
  "version": "v43",
  "taskDefinition": "orders-api:43",
  "checks": {
    "configurationLoaded": true,
    "rdsReachable": true,
    "s3ReceiptBucketReachable": true,
    "sqsPublisherReady": true,
    "telemetryConfigured": true
  }
}
```

This response gives the release owner useful evidence. It says which version answered and whether the app sees the dependencies it needs. It keeps database passwords, secret ARN values, customer order ids, and raw IAM credentials out of the payload. That boundary matters because health endpoints often sit close to public traffic paths.

A **smoke test** is a small test of a real user path. It runs after deployment and during the watch window. For the orders API, the smoke test should use a sandbox payment token, a synthetic customer id, and cleanup rules that prevent test data from polluting production reports.

```yaml
smoke_test:
  name: checkout receipt path
  target: production route
  synthetic_customer: smoke-test-user-devpolaris
  steps:
    - create checkout with sandbox payment token
    - verify API returns 201
    - verify order record exists in production RDS
    - verify receipt object exists in the production S3 receipt bucket
    - verify SQS receipt event exists or was consumed
    - verify trace and structured log include service.version v43
  cleanup:
    - mark order as synthetic
    - delete synthetic receipt if retention policy allows
```

A smoke test should be small enough to run safely, but real enough to catch integration mistakes. A test that only calls `/healthz` proves process health but gives no receipt storage evidence. A test that creates real customer payments is too risky. The middle path is a synthetic checkout that uses production wiring with safe test data.

Health checks and smoke tests give controlled evidence. The team still needs real traffic telemetry because real users will try paths and timing outside the smoke test.

## Real Traffic Telemetry
<!-- section-summary: Real traffic telemetry shows how the candidate behaves under production users, dependencies, and timing. -->

**Real traffic telemetry** is the evidence produced by actual production requests. In AWS, this often starts with CloudWatch Logs and CloudWatch Metrics. If the application uses tracing, AWS X-Ray or an OpenTelemetry backend can connect the API request to downstream calls, queue events, and Lambda work.

For a release, the most important telemetry detail is version separation. The team should be able to compare `orders-api:43` with `orders-api:42` or compare `service.version = v43` with `service.version = v42`. If logs and traces only say `production`, the release owner has to guess whether the candidate caused the problem.

Here is a CloudWatch Logs Insights query for checkout requests. It assumes structured JSON logs with `service`, `route`, `statusCode`, `durationMs`, `version`, and `taskDefinition` fields:

```sql
fields @timestamp, route, statusCode, durationMs, version, taskDefinition, traceId
| filter service = "devpolaris-orders-api"
| filter route = "POST /checkout"
| filter @timestamp >= ago(20m)
| stats
    count(*) as total,
    sum(if(statusCode >= 400, 1, 0)) as failed,
    sum(if(statusCode >= 500, 1, 0)) as serverErrors,
    pct(durationMs, 95) as p95DurationMs
  by bin(5m), version, taskDefinition
| sort bin(5m) asc
```

This query answers a release question directly: did the candidate version fail or slow down compared with the stable version? The query stays focused on checkout because this release touched checkout receipt retry. A release that touches order lookup should use order lookup signals. A release that touches login should use login signals.

Dependency logs add another layer. This query looks for downstream errors from RDS, S3, SQS, and the payment provider:

```sql
fields @timestamp, dependency, operation, outcome, errorCode, durationMs, version, taskDefinition, traceId
| filter service = "devpolaris-orders-api"
| filter route = "POST /checkout"
| filter dependency in ["rds-orders", "s3-receipts", "sqs-receipt-events", "payment-provider"]
| filter @timestamp >= ago(20m)
| stats
    count(*) as calls,
    sum(if(outcome = "error", 1, 0)) as failures,
    pct(durationMs, 95) as p95DurationMs
  by bin(5m), dependency, version, taskDefinition
| sort bin(5m) asc
```

If `v43` shows S3 failures while `v42` stays healthy, the new receipt retry code is a strong suspect. If both versions show RDS timeouts, the release may have exposed a broader database problem. The decision can change depending on whether the evidence points to the candidate or to a shared dependency.

Exceptions and error logs show the shape of the failure. This query groups by error name and version so the team can see whether one exception dominates the release:

```sql
fields @timestamp, level, errorName, errorMessage, version, taskDefinition, traceId
| filter service = "devpolaris-orders-api"
| filter level in ["ERROR", "FATAL"]
| filter @timestamp >= ago(20m)
| stats count(*) as errors by errorName, errorMessage, version, taskDefinition
| sort errors desc
| limit 20
```

Lambda telemetry should use the same release thinking. If checkout publishes a receipt event and a Lambda function finishes the receipt, the watch window should inspect Lambda errors, throttles, duration, and logs. A green API response can still hide a broken async consumer.

```bash
aws cloudwatch get-metric-data \
  --metric-data-queries '[
    {
      "Id": "lambdaErrors",
      "MetricStat": {
        "Metric": {
          "Namespace": "AWS/Lambda",
          "MetricName": "Errors",
          "Dimensions": [
            {"Name": "FunctionName", "Value": "receipt-finalizer-prod"}
          ]
        },
        "Period": 300,
        "Stat": "Sum"
      }
    },
    {
      "Id": "lambdaDurationP95",
      "MetricStat": {
        "Metric": {
          "Namespace": "AWS/Lambda",
          "MetricName": "Duration",
          "Dimensions": [
            {"Name": "FunctionName", "Value": "receipt-finalizer-prod"}
          ]
        },
        "Period": 300,
        "Stat": "p95"
      }
    }
  ]' \
  --start-time 2026-06-13T13:40:00Z \
  --end-time 2026-06-13T14:00:00Z
```

Telemetry itself can fail. A missing log configuration, broken OpenTelemetry collector, wrong CloudWatch log group, or missing version field can make the watch window quiet. Quiet telemetry during a release should make the team cautious. If the evidence layer is unhealthy, pausing the rollout can be the right decision even when the app appears to answer a small number of requests.

When telemetry crosses a threshold, the team needs a recovery decision. That decision should protect users first and leave deeper debugging for the stable period after impact stops.

## Rollback
<!-- section-summary: Rollback moves users back to a known-good runtime state when the candidate creates unacceptable impact. -->

**Rollback** means returning production traffic to a known-good runtime state. It is a user-protection move first. The team can investigate the candidate after users are back on the stable path.

For ECS rolling deployments, rollback usually means updating the service back to the previous task definition revision. If `orders-api:43` causes checkout failures, the team can point the service back to `orders-api:42`. ECS then starts tasks for the old task definition and drains the bad tasks according to the deployment configuration.

```yaml
ecs_rollback:
  from:
    cluster: production-apps
    service: orders-api-prod
    task_definition: orders-api:43
  to:
    cluster: production-apps
    service: orders-api-prod
    task_definition: orders-api:42
  expected_effect: new checkout requests return to the stable task definition after deployment completes
```

If the ECS deployment circuit breaker is enabled with rollback, ECS can automatically roll the service back to the last completed deployment when the deployment fails to reach steady state. That helps with startup and health-check failures. The human watch window still matters because the circuit breaker has no full view of every business signal, support signal, or checkout-specific SLO.

For Lambda, rollback often means updating the production alias back to the previous function version or removing additional weighted routing to the candidate version. If `receipt-finalizer-prod` version `18` fails and the stable version is `17`, the alias can point back to `17`.

Rollback has limits. If the candidate changed data beyond the old version's read path, traffic rollback needs a compatibility plan. If the candidate wrote duplicate receipt objects, rollback stops new damage but cleanup still has to handle existing duplicates. If a shared dependency fails for both versions, rolling back the API may leave checkout unhealthy because the problem lives outside the candidate.

Rollback protects users. Fix forward can also be valid when the issue is small, understood, and reversible. The next section gives the actual AWS commands so rollback is a practical runbook action.

## How To Roll Back In AWS
<!-- section-summary: An AWS rollback runbook names the exact command, expected platform state, and first verification checks. -->

The ECS rollback command should be short, known, and tested before the incident. The release owner updates the service back to the previous task definition. The command below uses `orders-api:42`, which the release record already identified as the stable revision:

```bash
aws ecs update-service \
  --cluster production-apps \
  --service orders-api-prod \
  --task-definition orders-api:42
```

Then the owner waits for the service to stabilize. This command blocks until ECS reports the service as stable, which makes it useful in a runbook. The owner should still verify real traffic afterward because service stability only proves the platform state.

```bash
aws ecs wait services-stable \
  --cluster production-apps \
  --services orders-api-prod
```

After that, capture service state again. The goal is to see the primary deployment pointing at the stable task definition and the running count back at the desired count:

```bash
aws ecs describe-services \
  --cluster production-apps \
  --services orders-api-prod \
  --query "services[0].{desired:desiredCount,running:runningCount,deployments:deployments[].{status:status,rolloutState:rolloutState,taskDefinition:taskDefinition,runningCount:runningCount},events:events[0:5].[createdAt,message]}" \
  --output json
```

If the target group was part of the failure, check target health after the rollback. New stable tasks need to become healthy before users fully recover:

```bash
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:eu-west-2:111122223333:targetgroup/tg-orders-api-prod/abc123def456 \
  --query "TargetHealthDescriptions[].{target:Target.Id,state:TargetHealth.State,reason:TargetHealth.Reason,description:TargetHealth.Description}" \
  --output table
```

For Lambda alias rollback, point the alias back to the stable function version and remove candidate weights. This example sends all production alias traffic back to version `17`:

```bash
aws lambda update-alias \
  --function-name receipt-finalizer-prod \
  --name production \
  --function-version 17 \
  --routing-config '{}'
```

If the team uses a weighted Lambda canary, rollback can also mean keeping the main version stable and removing the additional candidate weight:

```bash
aws lambda get-alias \
  --function-name receipt-finalizer-prod \
  --name production

aws lambda update-alias \
  --function-name receipt-finalizer-prod \
  --name production \
  --function-version 17 \
  --routing-config '{}'
```

For configuration rollback, restore the previous value in the same source of truth. If the bad change was a feature flag in AWS AppConfig, restore the flag there. If the bad change was an ECS task definition environment variable, register a corrected task definition revision and update the service to it. If the bad change was a secret rotation, restore the previous secret version only when the security and application teams agree that doing so is safe.

The runbook should end after the team verifies platform state, health, and real traffic. A completed AWS command is one checkpoint. Recovered checkout behavior is the goal.

## Failure Scenarios and Decisions
<!-- section-summary: The right decision depends on user impact, evidence quality, rollback safety, and the size of the fix. -->

A **fix forward** is a small corrective change that keeps production moving without returning fully to the previous version. It might be a feature flag change, a safe configuration restore, a scale adjustment, or a tiny patch that the deployment pipeline can ship quickly. Fix forward can be a good choice when the issue is understood, the blast radius is small, and user impact stays controlled.

The choice between rollback and fix forward should use evidence rather than pride. A release can tempt a team to keep debugging because the fix seems close. Meanwhile customers keep failing checkout. A written decision rule helps the release owner protect users before the room gets noisy.

Here are common scenarios for the orders API:

| Scenario | Evidence | Likely first decision |
|---|---|---|
| Candidate-only checkout failures | `v43` failure rate rises, previous version stays near baseline | Roll back ECS service to `orders-api:42` |
| Candidate tasks fail ALB health | Target health shows `unhealthy`, ECS events mention failed checks | Roll back or let circuit breaker recover, then inspect readiness |
| Bad feature flag | Errors appear only when receipt retry branch runs | Disable the flag or restore config if that stops user impact quickly |
| Missing telemetry | API responds, but logs/traces lack candidate version data | Pause promotion and restore telemetry before widening exposure |
| RDS issue affects both versions | RDS timeouts rise for stable and candidate tasks | Treat as dependency incident, pause release, avoid blaming candidate too early |
| Lambda receipt-finalizer errors | Checkout succeeds, Lambda `Errors` or DLQ messages rise | Pause release or roll back Lambda alias, then inspect event payload compatibility |
| Capacity pressure | CPU, memory, target response time, or queue age rises during rollout | Pause rollout, scale carefully, and check downstream limits |
| Small logging bug | Users unaffected, error understood, patch is ready | Fix forward can be reasonable |

The release owner can use four questions during pressure.

**How many users feel it?** A small candidate percentage with rising checkout failures already affects real customers. A failed candidate-only smoke test before user traffic supports a pause without a production rollback.

**How good is the evidence?** Clear telemetry that points to `v43` supports rollback. Missing version fields, missing logs, or inconsistent dashboards support a pause because the team lacks proof that the candidate is healthy.

**How safe is rollback?** Traffic-only and task-definition-only changes usually roll back cleanly. Database schema changes, event format changes, and data writes may need compatibility checks before old code receives traffic again.

**How small is the fix?** Disabling a feature flag may be smaller and faster than a full rollback. Editing production code under pressure is a larger risk unless the issue is isolated and the pipeline can deliver a tested patch quickly.

The team should also record the decision time. Release incidents become confusing later because people remember the same 20 minutes differently. A timestamped decision gives the post-release review a stable timeline.

After the decision, runtime operations continue. The service still needs hands-on care after the team chooses continue, pause, rollback, or fix forward.

## Runtime Operations After the Decision
<!-- section-summary: Runtime operations stabilize the service after continue, pause, rollback, or fix-forward decisions. -->

**Runtime operations** are the actions the team takes on the running service after the release decision. They include scaling, restarting, draining traffic, restoring settings, checking logs, validating telemetry, preserving evidence, clearing bad tasks, and watching alerts return to normal.

If the team continues, runtime operations focus on controlled promotion. For ECS rolling deployments, that may mean declaring the release complete after the service is stable and the watch window passes. For blue/green or weighted systems, it may mean moving to the next traffic step and starting another watch window. The owner keeps the rollback target available until confidence is high enough to clean up old resources.

If the team pauses, runtime operations focus on holding the current state. The owner keeps traffic where it is, gathers missing evidence, checks dashboards, and prevents extra changes from mixing with the release. A pause is useful when the signal is unclear: telemetry is missing, traffic volume is too low, a dependency is noisy, or a business signal needs confirmation.

If the team rolls back, runtime operations focus on stabilization and cleanup. The owner restores the stable task definition or Lambda alias, waits for AWS state to settle, checks that new requests hit the stable version, watches failure rate and latency return near baseline, and then inspects partial work created by the candidate. For the orders API, cleanup might include failed checkout attempts, duplicate receipt objects, stuck SQS messages, or failed Lambda retries.

If the team fixes forward, runtime operations focus on proving the fix changed the right thing. A feature flag change needs verification that requests stopped taking the risky branch. A scale adjustment needs CPU, memory, latency, and downstream dependency monitoring. A patch release needs a new artifact, new task definition, and another watch window.

Here is a runtime operations board for a rollback:

```yaml
runtime_operations:
  decision: rollback
  decision_time_utc: "2026-06-13T14:08:00Z"
  actions:
    - update ECS service orders-api-prod to task definition orders-api:42
    - wait for ECS service stability
    - confirm ALB targets are healthy
    - confirm POST /checkout requests land on stable version
    - watch failed checkout rate for 20 minutes
    - inspect v43 traces and failed receipt writes for cleanup
  follow_up:
    - keep release evidence links in incident record
    - create bug for receipt retry S3 handling
    - keep task definition orders-api:43 available for inspection
    - block next promotion until telemetry and cleanup are reviewed
```

Runtime operations turn a decision into production stability. The next step is verification after the action, because the team needs proof that the action actually changed user experience.

## How To Verify After The Action
<!-- section-summary: Post-action verification proves that the recovery command changed AWS state and improved the user path. -->

After rollback or fix forward, the release owner should verify three things: AWS state, application health, and real traffic. AWS state proves the platform accepted the action. Application health proves the runtime can serve basic requests. Real traffic proves users are recovering.

For ECS, AWS state starts with the service description. The owner checks that the primary deployment points to the expected task definition and that running tasks match desired count:

```bash
aws ecs describe-services \
  --cluster production-apps \
  --services orders-api-prod \
  --query "services[0].deployments[].{status:status,rolloutState:rolloutState,taskDefinition:taskDefinition,desired:desiredCount,running:runningCount,pending:pendingCount}" \
  --output table
```

Then check the actual tasks. This catches cases where the service points to the right task definition but some tasks are still stopping, unhealthy, or restarting:

```bash
TASK_ARNS=$(aws ecs list-tasks \
  --cluster production-apps \
  --service-name orders-api-prod \
  --desired-status RUNNING \
  --query "taskArns[]" \
  --output text)

aws ecs describe-tasks \
  --cluster production-apps \
  --tasks $TASK_ARNS \
  --query "tasks[].{lastStatus:lastStatus,healthStatus:healthStatus,taskDefinition:taskDefinition,startedAt:startedAt}" \
  --output table
```

Application health checks should include both the basic health endpoint and the user path smoke test. The release owner should see the stable version in the response after rollback:

```bash
curl -fsS https://orders-api.devpolaris.example/healthz
curl -fsS https://orders-api.devpolaris.example/readyz
```

Real traffic verification goes back to the same CloudWatch Logs Insights query that triggered the decision. The owner compares the period before and after the action. The goal is to see checkout failures and latency return near baseline:

```sql
fields @timestamp, route, statusCode, durationMs, version, taskDefinition
| filter service = "devpolaris-orders-api"
| filter route = "POST /checkout"
| filter @timestamp >= ago(40m)
| stats
    count(*) as total,
    sum(if(statusCode >= 500, 1, 0)) as serverErrors,
    pct(durationMs, 95) as p95DurationMs
  by bin(5m), version, taskDefinition
| sort bin(5m) asc
```

For Lambda, verify the alias and metrics after rollback. The alias should point to the stable version, and `Errors` and `Throttles` should return near baseline:

```bash
aws lambda get-alias \
  --function-name receipt-finalizer-prod \
  --name production \
  --query "{name:Name,functionVersion:FunctionVersion,routingConfig:RoutingConfig}" \
  --output json
```

The last verification step is cleanup evidence. The team checks whether failed checkout attempts, duplicate receipt objects, dead-letter queue messages, or partial events need repair. That work may become a separate incident task, but the release record should name it before the watch window closes.

## Release Record
<!-- section-summary: The release record captures the candidate, AWS state, evidence, decisions, runtime actions, and cleanup work. -->

A **release record** is the timeline of the production change. It answers the questions people ask during and after a release: what changed, who owned it, when traffic moved, what evidence appeared, what decision happened, what action followed, and what remains to clean up.

The record can stay lightweight. Keep it short during the incident, with enough detail that the next engineer can understand the exact AWS state and the reason for the decision.

Here is a release record after an orders API rollback:

```yaml
release: orders-api-2026-06-13-v43
owner: platform-api-oncall
artifact:
  image: 111122223333.dkr.ecr.eu-west-2.amazonaws.com/orders-api@sha256:8a7b2f42c49d
  commit: 7f31c9a
runtime:
  primary_platform: Amazon ECS
  cluster: production-apps
  service: orders-api-prod
  stable_task_definition: orders-api:42
  candidate_task_definition: orders-api:43
  target_group: tg-orders-api-prod
adjacent_runtime:
  lambda_function: receipt-finalizer-prod
  stable_alias_version: "17"
  candidate_version: "18"
watch_window:
  started_utc: "2026-06-13T13:40:00Z"
  duration: 20 minutes
  primary_paths:
    - POST /checkout
traffic_and_state_timeline:
  - time_utc: "2026-06-13T13:40:00Z"
    state:
      ecs_primary_task_definition: orders-api:43
      desired_count: 4
      running_count: 4
      alb_target_health: healthy
    decision: start watch window
  - time_utc: "2026-06-13T14:03:00Z"
    evidence:
      checkout_failure_rate_v43: 4.6 percent
      checkout_failure_rate_v42_baseline: 0.4 percent
      s3_receipt_write_failures: elevated on v43
      lambda_receipt_finalizer_errors: near baseline
    decision: rollback ECS service
  - time_utc: "2026-06-13T14:08:00Z"
    action:
      command: aws ecs update-service --cluster production-apps --service orders-api-prod --task-definition orders-api:42
    state:
      ecs_primary_task_definition: orders-api:42
    decision: rollback command accepted
verification_after_action:
  - ECS service reached steady state
  - ALB target health healthy
  - checkout failure rate returned near baseline
  - p95 checkout duration returned near baseline
  - no new receipt-finalizer Lambda error spike
cleanup:
  - inspect failed v43 checkout traces
  - reconcile duplicate or missing receipt objects
  - create bug for receipt retry S3 error handling
  - keep v43 task definition and logs available for investigation
links:
  cloudwatch_dashboard: https://console.aws.amazon.com/cloudwatch/home?region=eu-west-2#dashboards:name=orders-api-prod
  runbook: rollback-orders-api-ecs
  incident: INC-2026-06-13-014
```

This record helps during the incident and after it. During the incident, it keeps the team aligned. After the incident, it gives the review a timeline. The team can ask whether the watch window caught the problem quickly, whether rollback worked, whether telemetry had enough version context, and whether cleanup tasks were created.

Release records also improve automation. If every rollback uses the same ECS command, the team can wrap it safely. If every watch window needs the same CloudWatch queries, the team can save them in a dashboard. If every release forgets to record previous task definitions or Lambda alias versions, the pipeline can capture them before deployment.

## Putting It All Together
<!-- section-summary: Verification and runtime operations turn AWS traffic movement into an evidence-based release decision. -->

The orders API release starts its watch window after traffic reaches `orders-api:43`. The owner captures ECS service state, running task evidence, ALB target health, direct health responses, CloudWatch Logs queries, Lambda metrics, and the current incident channel. The release is now in an evidence-gathering period where the team writes down what production shows.

The first layer looks healthy. ECS reports running tasks, the target group marks tasks healthy, and `/readyz` returns the candidate version. The smoke test also passes. A synthetic checkout writes an order, stores a receipt, publishes the receipt event, and emits telemetry with `service.version = v43`.

Real traffic shows the problem. CloudWatch Logs Insights reports that checkout failures for `v43` rise above the rollback threshold while baseline traffic stays much lower. Dependency logs point toward S3 receipt write failures in the new retry path. Lambda receipt-finalizer metrics stay near baseline, so the first suspect is the API candidate rather than the async function.

The release owner chooses rollback. The team updates the ECS service back to `orders-api:42`, waits for stability, confirms target health, and watches checkout failure rate return near baseline. The candidate task definition remains available for log and trace investigation, but customers are back on the stable path.

The release record captures the traffic moment, evidence, rollback decision, command, verification, and cleanup work. That is the operating habit this article is building toward: AWS release work after traffic moves is a loop of controlled observation, layered evidence, clear decisions, and runtime actions. ECS, ALB, Lambda, CloudWatch, OpenTelemetry, alarms, dashboards, on-call tools, and runbooks all support that loop.

---

**References**

* [Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html) - AWS guide to ECS service scheduling, deployments, and load balancer integration.
* [Amazon ECS deployment circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html) - Explains how ECS detects failed deployments and can roll back to the last completed deployment.
* [aws ecs describe-services](https://docs.aws.amazon.com/cli/latest/reference/ecs/describe-services.html) - AWS CLI reference for reading ECS service deployment and event evidence.
* [aws ecs update-service](https://docs.aws.amazon.com/cli/latest/reference/ecs/update-service.html) - AWS CLI reference for updating a service task definition and deployment configuration.
* [aws elbv2 describe-target-health](https://docs.aws.amazon.com/cli/latest/reference/elbv2/describe-target-health.html) - AWS CLI reference for inspecting load balancer target health.
* [CloudWatch Logs Insights query syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html) - Documents the query language used for CloudWatch Logs Insights examples.
* [Using CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html) - Explains metric alarms, thresholds, notifications, and automated actions.
* [Metrics in Amazon CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/working_with_metrics.html) - Explains CloudWatch metrics and custom metrics.
* [Working with Lambda function logs](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-logs.html) - Explains Lambda logging through CloudWatch Logs.
* [Using CloudWatch metrics with Lambda](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics.html) - Documents Lambda metrics such as invocations, errors, throttles, and duration.
* [Lambda weighted alias routing](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html) - Explains Lambda traffic shifting through aliases and weighted routing.
* [aws lambda update-alias](https://docs.aws.amazon.com/cli/latest/reference/lambda/update-alias.html) - AWS CLI reference for changing a Lambda alias during rollback.
* [AWS Distro for OpenTelemetry and AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-adot.html) - Documents ADOT collection for traces and metrics with AWS observability services.
* [AWS Distro for OpenTelemetry introduction](https://aws-otel.github.io/docs/introduction) - Explains ADOT as an AWS-supported OpenTelemetry distribution.
* [OpenTelemetry documentation](https://opentelemetry.io/docs/) - Vendor-neutral documentation for OpenTelemetry APIs, SDKs, collectors, and semantic conventions.
* [Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) - Explains SLIs, SLOs, and error budgets as reliability decision tools.
