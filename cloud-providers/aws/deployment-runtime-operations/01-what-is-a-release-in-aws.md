---
title: "What Is a Release in AWS"
description: "Understand an AWS release as a controlled production change across artifact, runtime target, infrastructure, configuration, identity, traffic, health evidence, and rollback."
overview: "A build can pass while the production release still has unanswered questions. This article explains an AWS release as the connected change across image digest, runtime target, task definition or alias, infrastructure, configuration, IAM role, traffic, health evidence, and rollback."
tags: ["aws", "deployment", "release", "runtime", "rollback"]
order: 1
id: article-cloud-providers-aws-deployment-runtime-operations-runtime-operations-mental-model
aliases:
  - what-is-a-release-in-aws
  - what-is-a-release
  - article-cloud-providers-aws-deployment-runtime-operations-what-is-a-release
  - runtime-operations-mental-model
  - cloud-providers/aws/deployment-runtime-operations/runtime-operations-mental-model.md
  - cloud-providers/aws/deployment-runtime-operations/01-runtime-operations-mental-model.md
---

## Table of Contents

1. [From Local Deploy to AWS Release](#from-local-deploy-to-aws-release)
2. [Artifact: The Exact Package](#artifact-the-exact-package)
3. [Runtime Target: Where the Package Runs](#runtime-target-where-the-package-runs)
4. [Runtime Settings and Identity](#runtime-settings-and-identity)
5. [Traffic Movement and Health Evidence](#traffic-movement-and-health-evidence)
6. [Rollback Belongs in the Release](#rollback-belongs-in-the-release)
7. [A Release Record Example](#a-release-record-example)
8. [Official References](#official-references)

## From Local Deploy to AWS Release
<!-- section-summary: A release moves production from one known state to another known state with evidence. -->

Imagine the first version of an app on one small server. You build the code on your laptop, copy the files to the server, edit an `.env` file, restart the process, run `curl /health`, and keep the previous folder nearby in case the new version fails. That is still a release, even if it feels like a manual deploy.

AWS keeps the same practical questions, but the answers live in named services. The copied folder turns into an **artifact**, such as an image in Amazon ECR or a published Lambda version. The restarted process turns into a **runtime target**, such as an ECS service, Lambda alias, or Auto Scaling group. The `.env` file turns into runtime configuration, secrets, and IAM permissions. The `curl /health` check turns into load balancer health, logs, metrics, smoke tests, and alarms. The old folder nearby turns into a rollback target.

This article follows `orders-api`, a small checkout service running as an ECS service behind an Application Load Balancer. Production currently runs task definition `orders-api:41`. The team wants to release `orders-api:42`, which contains a new checkout response and writes receipt PDFs to a new S3 prefix. That change sounds like code, but production also needs the right image, task definition, IAM permission, traffic movement, health evidence, and rollback plan.

Here is the release flow before we go into each part:

| Release part | Plain meaning | AWS example |
|---|---|---|
| Artifact | The exact package production should run | ECR image tag plus image digest |
| Runtime target | The AWS place that runs the package | ECS service `orders-api` in cluster `prod-web` |
| Runtime settings | Values the package reads at runtime | Environment variables, Parameter Store values, secret references |
| Identity | The AWS permissions the running code uses | ECS task role for S3 receipt writes |
| Traffic | How users reach the candidate version | ALB target group and ECS rolling deployment |
| Evidence | Proof that the new state works | Target health, CloudWatch logs, alarms, smoke tests |
| Rollback | The known-good state to restore | Previous task definition `orders-api:41` |

We will name the moving parts and show the kind of evidence a real release record should capture. The next two articles go deeper into configuration, traffic shifting, verification, and rollback operations.

![The release anatomy view shows the pieces a production change needs: artifact, target, config, identity, traffic, health evidence, and rollback path](/content-assets/articles/article-cloud-providers-aws-deployment-runtime-operations-runtime-operations-mental-model/release-anatomy.png)

*The release anatomy view shows the pieces a production change needs: artifact, target, config, identity, traffic, health evidence, and rollback path.*


## Artifact: The Exact Package
<!-- section-summary: The artifact is the immutable deployable package that production should run. -->

An **artifact** is the thing you deploy. For ECS, the artifact is usually a container image in Amazon ECR. For Lambda, it can be a zip package or container image tied to a published version. For EC2, it may be an AMI plus an application bundle. The artifact gives the release a concrete object instead of a vague phrase like "the latest code."

Tags such as `latest`, `prod`, or `2026-06-24.3` help humans talk about an image. A tag can move to a different image later, so the release record should also capture an immutable identifier. For containers, that identifier is the **image digest**. The digest is a hash of the image content, which gives the team a stable answer to the question: which bytes did production receive?

```bash
aws ecr describe-images \
  --repository-name orders-api \
  --image-ids imageTag=2026-06-24.3 \
  --region eu-west-2 \
  --query 'imageDetails[].{Digest:imageDigest,Pushed:imagePushedAt,Tags:imageTags}'
```

Example output:

```json
[
  {
    "Digest": "sha256:9d8b7f6a5e4c3b2a111111111111111111111111111111111111111111111111",
    "Pushed": "2026-06-24T09:41:12+00:00",
    "Tags": [
      "2026-06-24.3",
      "release-candidate"
    ]
  }
]
```

The command asks ECR for the image behind tag `2026-06-24.3`. `Digest` is the immutable artifact identity. `Pushed` connects the image to the build timeline. `Tags` shows the human labels currently attached to the same image. The next action is to copy the digest into the release record and compare it with the image reference in the task definition or deployment manifest.

Artifact evidence should also name the source commit, CI run, test result, and image scan result where your team has those controls. During an incident, this lets an operator answer three direct questions: what source created the package, what checks ran before production, and what exact package is running now.

For Lambda, the same idea usually appears as a published version:

```bash
aws lambda get-function \
  --function-name checkout-handler:17 \
  --region eu-west-2 \
  --query '{Version:Configuration.Version,RevisionId:Configuration.RevisionId,LastModified:Configuration.LastModified}'
```

Example output:

```json
{
  "Version": "17",
  "RevisionId": "4f7d1a9e-8fb1-47d7-9e1d-2d3b2ef8b756",
  "LastModified": "2026-06-24T09:44:18.000+0000"
}
```

`Version` identifies the immutable Lambda version. `RevisionId` helps detect whether the function configuration changed between reads. `LastModified` places the version in the release timeline. The next action is to make sure any production alias or deployment tool points at the intended version before moving traffic.

## Runtime Target: Where the Package Runs
<!-- section-summary: The runtime target is the AWS resource that receives the new artifact. -->

The **runtime target** is the AWS place that will run the artifact. In ECS, that target is a service moving to a task definition revision. In Lambda, it is usually an alias moving to a published version. In EC2, it might be an Auto Scaling group moving to a launch template version or AMI.

A release note should name the target with enough scope for another operator to find it. "Deploy orders" leaves room for confusion. "Update ECS service `orders-api` in cluster `prod-web`, account `123456789012`, Region `eu-west-2`, from task definition `orders-api:41` to `orders-api:42`" gives the team a checkable target and a rollback source.

Before the release, confirm the account and current runtime state:

```bash
aws sts get-caller-identity --profile prod

aws ecs describe-services \
  --cluster prod-web \
  --services orders-api \
  --region eu-west-2 \
  --query 'services[].{Service:serviceName,TaskDefinition:taskDefinition,Desired:desiredCount,Running:runningCount}'
```

Example output:

```json
[
  {
    "Service": "orders-api",
    "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/orders-api:41",
    "Desired": 4,
    "Running": 4
  }
]
```

The identity check proves the operator is using the intended account before changing production. The ECS query shows the current service state. `TaskDefinition` is the version currently running, `Desired` is how many tasks the service wants, and `Running` is how many tasks are active. The next action is to record `orders-api:41` as the rollback target before updating the service to `orders-api:42`.

This same release idea works across runtimes. A Lambda release records the current alias target before moving it. An EC2 release records the current launch template version before an instance refresh. The command changes, but the release habit stays the same: capture the current state, move to the candidate state, then verify the candidate state with evidence.

## Runtime Settings and Identity
<!-- section-summary: Runtime settings and IAM permissions must match the artifact being released. -->

The artifact runs inside a runtime environment. That environment supplies configuration values, secrets, and AWS permissions. A build can pass and still fail in production if the runtime lacks the value or permission the new code expects.

For `orders-api:42`, the new code writes receipt PDFs to `s3://prod-orders-receipts/receipts-v2/`. The release needs more than the image. It needs the task definition to carry the right settings, and it needs the ECS task role to allow `s3:PutObject` for that prefix. The release should check those before user traffic reaches the candidate.

```bash
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:role/prod-orders-task-role \
  --action-names s3:PutObject \
  --resource-arns arn:aws:s3:::prod-orders-receipts/receipts-v2/test.pdf \
  --region eu-west-2 \
  --query 'EvaluationResults[].{Action:EvalActionName,Resource:EvalResourceName,Decision:EvalDecision}'
```

Example output:

```json
[
  {
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::prod-orders-receipts/receipts-v2/test.pdf",
    "Decision": "allowed"
  }
]
```

The command asks IAM whether the task role has an identity-policy path that allows the tested action on the tested object ARN. `allowed` means the role policy contains a matching allow. `implicitDeny` means no matching allow was found. `explicitDeny` means a deny statement matched and wins. The next action for `allowed` is to continue with a real runtime smoke test. The next action for `implicitDeny` or `explicitDeny` is to fix the IAM path before moving traffic.

The simulator gives useful policy evidence, while a real request confirms the full runtime path. S3 bucket policies, KMS key policies, VPC endpoint policies, organization guardrails, and the exact application path can still affect production. A release record should say which role changed, which setting changed, and which smoke test proves the running service can use both.

Configuration should also have rollback notes. If the release changes a Parameter Store value, a feature flag, or a secret version, the release note should include the previous value or version. Rolling back code without rolling back a shared setting can leave the old code reading the new value.

## Traffic Movement and Health Evidence
<!-- section-summary: Traffic movement should have platform evidence and user-facing evidence. -->

Traffic movement is the part of the release where users start touching the candidate version. ECS rolling deployments replace tasks while keeping healthy capacity alive. Lambda aliases can send all traffic to one version or split a percentage to a candidate version. EC2 deployments can refresh instances behind a load balancer.

For the first article, keep the focus on the evidence shape. Platform evidence says the runtime is healthy: tasks are running, targets are healthy, aliases point where expected, and alarms stay quiet. User-facing evidence says important behavior still works: checkout succeeds, receipt writing works, latency stays inside the release threshold, and logs stay free of candidate-only errors.

For an ECS service behind an Application Load Balancer, target health gives a quick platform check:

```bash
aws elbv2 describe-target-health \
  --target-group-arn "$TG_ARN" \
  --region eu-west-2 \
  --query 'TargetHealthDescriptions[].{Target:Target.Id,State:TargetHealth.State,Reason:TargetHealth.Reason}'
```

Example output:

```json
[
  {
    "Target": "10.0.24.81",
    "State": "healthy",
    "Reason": null
  },
  {
    "Target": "10.0.31.44",
    "State": "initial",
    "Reason": "Elb.RegistrationInProgress"
  }
]
```

`healthy` means the load balancer can send traffic to that target. `initial` with `Elb.RegistrationInProgress` means the target has registered and is still warming up. A next action here is to wait through the expected warmup window and recheck. If the target moves to `unhealthy`, inspect the health check path, container port, security group, startup time, and application logs before sending more traffic.

Logs connect platform health to application behavior:

```bash
aws logs tail /ecs/prod/orders-api \
  --since 20m \
  --region eu-west-2 \
  --filter-pattern '"receipt"'
```

Example output:

```console
2026-06-24T10:07:33.421Z task/orders-api/8f12 INFO receipt_write_ok orderId=ord_4812 key=receipts-v2/ord_4812.pdf version=2026-06-24.3
2026-06-24T10:08:04.190Z task/orders-api/8f12 INFO checkout_completed orderId=ord_4812 status=paid version=2026-06-24.3
```

The command tails the recent ECS log group and filters for lines about receipt behavior. The output shows the candidate wrote to the new prefix and completed checkout. The next action is to compare this with metrics and smoke tests during the watch window. A log line with `AccessDenied`, provider rejection, or repeated timeout would move the release toward pause or rollback.

## Rollback Belongs in the Release
<!-- section-summary: Rollback is planned before production changes so the team knows the previous safe state. -->

Rollback is the path back to a known-good state. It belongs in the release plan before traffic moves because the team thinks more clearly before an incident starts. For ECS, rollback often means updating the service back to the previous task definition. For Lambda, it often means pointing the production alias back to the previous version. For EC2, it may mean returning an Auto Scaling group to a previous launch template version and starting another refresh.

For `orders-api`, the rollback target is `orders-api:41` because the pre-release check captured it. The command path is short:

```bash
aws ecs update-service \
  --cluster prod-web \
  --service orders-api \
  --task-definition orders-api:41 \
  --region eu-west-2 \
  --query 'service.{Service:serviceName,TaskDefinition:taskDefinition,Deployments:deployments[].{Status:status,TaskDefinition:taskDefinition,Rollout:rolloutState}}'
```

Example output:

```json
{
  "Service": "orders-api",
  "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/orders-api:41",
  "Deployments": [
    {
      "Status": "PRIMARY",
      "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/orders-api:41",
      "Rollout": "IN_PROGRESS"
    },
    {
      "Status": "ACTIVE",
      "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/orders-api:42",
      "Rollout": "IN_PROGRESS"
    }
  ]
}
```

`TaskDefinition` shows the service now points back to `orders-api:41`. The deployments array shows ECS replacing the candidate tasks. `PRIMARY` marks the deployment ECS is moving toward. The next action is to watch ECS service events, target health, logs, and user-facing smoke tests until the old revision is healthy and the bad symptoms stop.

Rollback also has data and configuration edges. If `orders-api:42` wrote receipt PDFs to a new S3 prefix, rolling back code may stop new writes, but the team still needs to decide what happens to objects already written. If a feature flag changed, restore the old flag rule. If a shared Parameter Store value changed, restore the old version. If a secret rotated, confirm the old code can still authenticate.

A practical rollback note names the command and the follow-up checks. The command returns traffic. The follow-up checks prove the system recovered.

![The rollback path shows how impact, config scope, artifact regression, and available evidence guide rollback, pause, or fix-forward choices](/content-assets/articles/article-cloud-providers-aws-deployment-runtime-operations-runtime-operations-mental-model/rollback-decision-path.png)

*The rollback path shows how impact, config scope, artifact regression, and available evidence guide rollback, pause, or fix-forward choices.*


## A Release Record Example
<!-- section-summary: A release record names the target, artifact, settings, identity, traffic plan, watch signals, and rollback path. -->

A useful release record is small enough to write during normal work and complete enough for another operator to follow during an incident. It should answer what changed, what evidence matters, and how to return to the previous state.

```yaml
release: orders-api-2026-06-24.3
account: prod / 123456789012
region: eu-west-2
runtimeTarget:
  type: ecs-service
  cluster: prod-web
  service: orders-api
from:
  taskDefinition: orders-api:41
to:
  taskDefinition: orders-api:42
artifact:
  repository: orders-api
  tag: 2026-06-24.3
  digest: sha256:9d8b7f6a5e4c3b2a111111111111111111111111111111111111111111111111
runtimeSettings:
  RECEIPT_PREFIX: receipts-v2/
identity:
  role: arn:aws:iam::123456789012:role/prod-orders-task-role
  newPermission: s3:PutObject on arn:aws:s3:::prod-orders-receipts/receipts-v2/*
traffic:
  method: ecs rolling deployment
watch:
  duration: 20 minutes
  checks:
    - ALB target health stays healthy
    - checkout smoke test passes
    - receipt write logs show version 2026-06-24.3
    - 5XX rate stays below 1 percent
rollback:
  ecsTaskDefinition: orders-api:41
  command: aws ecs update-service --cluster prod-web --service orders-api --task-definition orders-api:41 --region eu-west-2
```

Each field connects to a release question. `artifact` tells what package is being released. `runtimeTarget` tells where it runs. `runtimeSettings` and `identity` tell what the package depends on. `traffic` tells how users reach it. `watch` tells which evidence decides whether to continue. `rollback` tells how to restore the previous known-good runtime.

The next article takes the runtime settings part deeper. It shows how plain configuration, secrets, feature flags, candidate versions, and traffic controls fit into one rollout workflow.

![The release record makes the change review concrete by showing what changed, where it runs, who owns it, and how to undo it](/content-assets/articles/article-cloud-providers-aws-deployment-runtime-operations-runtime-operations-mental-model/release-record-example.png)

*The release record makes the change review concrete by showing what changed, where it runs, who owns it, and how to undo it.*


## Official References

- [Amazon ECR image concepts](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html)
- [Describing images in Amazon ECR](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-pull-ecr-image.html)
- [Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html)
- [Amazon ECS service load balancing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html)
- [IAM policy simulator API](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html)
- [Lambda versions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html)
- [Lambda aliases](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html)
- [Lambda weighted aliases](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html)
- [Amazon ECS blue/green deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html)
