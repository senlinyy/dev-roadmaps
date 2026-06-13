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

1. [What This Article Covers](#what-this-article-covers)
2. [What Is a Release](#what-is-a-release)
3. [Artifact](#artifact)
4. [Industry Tools Around an AWS Release](#industry-tools-around-an-aws-release)
5. [Runtime](#runtime)
6. [How To Inspect Runtime State](#how-to-inspect-runtime-state)
7. [Infrastructure and Pipeline](#infrastructure-and-pipeline)
8. [Configuration and Identity](#configuration-and-identity)
9. [Traffic and Health](#traffic-and-health)
10. [Rollback](#rollback)
11. [How Rollback Happens In AWS](#how-rollback-happens-in-aws)
12. [Release Record](#release-record)
13. [Putting It All Together](#putting-it-all-together)
14. [What's Next](#whats-next)

## What This Article Covers
<!-- section-summary: An AWS release has several connected pieces, and naming those pieces helps a team understand production before they change it. -->

In this module, we are going to treat an AWS release as the full production story around a change. That story includes the artifact that was built, the AWS runtime that runs it, the infrastructure that surrounds it, the settings it reads, the IAM identity it uses, the traffic that reaches it, the health evidence the team watches, and the rollback path the team can use if customers are hurt.

We will use one service through this article: `devpolaris-orders-api`. It is a checkout API deployed to AWS. When a customer buys a course, the API writes the order to RDS for PostgreSQL, stores a receipt file in S3, publishes background work to SQS and EventBridge, and emits telemetry to CloudWatch through OpenTelemetry instrumentation.

The team wants to ship a receipt retry change. The code change sounds small because it only retries failed receipt uploads. Production still needs more care. The release owner needs to know which image digest was built, which ECS service or Lambda alias will receive the change, which Terraform plan changed infrastructure, which IAM role will call S3 and SQS, which users will receive traffic, which CloudWatch signals prove the release is healthy, and which stable version can receive traffic again.

This article names the pieces in a practical order. First, we define **release** in plain English. Then we walk through **artifact**, **runtime**, **infrastructure and pipeline**, **configuration and identity**, **traffic and health**, **rollback**, and **release record**. The next two articles will go deeper into runtime configuration, safe rollout controls, verification, rollback, and daily operations.

## What Is a Release
<!-- section-summary: A release is the controlled exposure of one production change to real users, with evidence and recovery prepared before traffic expands. -->

A **release** is the controlled exposure of a specific production change to real users. In AWS, that change can be application code, a container image, a Lambda version, an ECS task definition revision, a Terraform change, an environment variable, a Secrets Manager reference, an IAM permission, an ALB listener rule, a database migration, or several of those together.

A **deployment** puts a candidate into an environment. A **release** controls how that candidate reaches production users and how the team proves the candidate behaves well. That distinction matters because AWS can accept a deployment while the team still needs to decide whether the change should receive traffic. An ECS service can register a new task definition revision. A Lambda function can publish a new version. A target group can contain new tasks that pass a basic health check. The release question asks what production users are actually experiencing.

For `devpolaris-orders-api`, the team builds version `v31` from commit `7f31c9a` and pushes a container image to Amazon Elastic Container Registry, usually shortened to **ECR**. ECR is AWS's managed container image registry. The pipeline updates an ECS service on Fargate with task definition revision `devpolaris-orders-api:31`. ECS starts replacement tasks and the Application Load Balancer sends checkout requests to the healthy tasks. The deployment part says the candidate reached the runtime. The release part asks a wider set of questions: which exact image digest is running, which task definition revision receives traffic, can the task role write receipts to S3 and publish messages to SQS/EventBridge, which CloudWatch metrics define success, and which earlier revision is safe for rollback.

Here is the shape of that release conversation:

```mermaid
graph LR
    Artifact[Artifact]:::artifact --> Runtime[AWS runtime target]:::runtime
    Runtime --> Infra[Infrastructure and pipeline]:::infra
    Infra --> Config[Configuration and identity]:::config
    Config --> Traffic[Traffic exposure]:::traffic
    Traffic --> Health[Health evidence]:::health
    Health --> Recovery[Continue or rollback]:::recovery

    classDef artifact fill:#1f2937,stroke:#f97316,stroke-width:2px,color:#fff
    classDef runtime fill:#2c1d3e,stroke:#c446ff,stroke-width:2px,color:#fff
    classDef infra fill:#19324a,stroke:#38bdf8,stroke-width:2px,color:#fff
    classDef config fill:#3c341f,stroke:#f39c12,stroke-width:2px,color:#fff
    classDef traffic fill:#16362f,stroke:#2dd4bf,stroke-width:2px,color:#fff
    classDef health fill:#1e3a5f,stroke:#60a5fa,stroke-width:2px,color:#fff
    classDef recovery fill:#3b1d2a,stroke:#fb7185,stroke-width:2px,color:#fff
```

This vocabulary matters during real incidents. When someone says "the release is done," the team should know whether that means the image was pushed, the task definition was registered, the ECS deployment reached steady state, traffic moved, alarms stayed quiet, or rollback stayed ready. The first piece to name is the artifact because every other release decision points back to the exact thing the team built.

## Artifact
<!-- section-summary: The artifact is the exact build output that the team intends to run in AWS. -->

An **artifact** is the versioned output of a build. For an ECS service, the artifact is usually a Docker container image stored in ECR. For Lambda, it can be a published function version backed by a ZIP package or a container image. For infrastructure, the artifact can be a Terraform or OpenTofu plan, a CloudFormation change set, or the exact module version and variables used for production.

The artifact answers one production question: which version are we discussing? A tag like `latest` gives weak evidence because tags can move. A commit SHA, release number, signed build record, package version, image digest, or Lambda version gives stronger evidence because it points to a specific build output. During a checkout incident, that exactness helps the team connect a CloudWatch log line, a GitHub Actions run, an ECR image, an ECS task definition, and a rollback target.

For the orders API, the artifact record can look like this:

```yaml
service: devpolaris-orders-api
change: receipt upload retry for checkout
source_commit: 7f31c9a
container_image: 123456789012.dkr.ecr.eu-west-2.amazonaws.com/devpolaris-orders-api@sha256:8a7b2f42c49d
pipeline_run: github-actions-9831
build_time_utc: "2026-06-12T09:40:00Z"
sbom: s3://devpolaris-release-evidence/orders-api/v31/sbom.spdx.json
```

An **image digest** is the SHA-based identifier for the exact image content. If the task definition uses the digest, production points at exact bytes instead of a moving label. AWS documents that ECS task definitions include the Docker image to use, and ECS can resolve image tags to image digests during deployment. In release records, digest-based references make later investigation clearer because the artifact name still points to the same image after more builds happen.

An **SBOM**, or Software Bill of Materials, lists the software packages inside an artifact. It helps the team answer a different release question: which libraries did we put into production? A team might generate an SBOM during the Docker build, scan the image with Amazon Inspector or ECR image scanning, and store the SBOM beside the release record. Runtime verification still carries the production decision, and the SBOM gives security and incident teams a concrete inventory when a vulnerability appears.

Artifacts can also include infrastructure changes. A release might update the ECS service deployment configuration, an ALB target group health check, an RDS security group, an S3 bucket policy, an EventBridge rule, or an IAM permission. The release record should include the infrastructure artifact too because a production change can live outside the application image. The same safe-looking code can fail if the Terraform plan removes SQS publish access or points receipts at the wrong bucket.

The artifact gives the release a stable name. The next question is where AWS runs that artifact and what production object receives traffic.

## Industry Tools Around an AWS Release
<!-- section-summary: Real AWS releases use AWS services plus CI/CD, infrastructure as code, container tooling, identity federation, security evidence, telemetry, and incident workflow. -->

AWS is the runtime target in this article, but a real production release usually includes tools around AWS. A team may build in **GitHub Actions** or **GitLab CI**, package the app with **Docker**, push the image to **ECR**, manage infrastructure with **Terraform** or **OpenTofu**, authenticate the pipeline through **OIDC**, generate an **SBOM**, deploy with the AWS CLI or a delivery tool, watch CloudWatch and OpenTelemetry signals, and use an incident workflow when rollback criteria trigger.

OIDC matters because it lets a CI/CD job receive short-lived AWS credentials by assuming an IAM role. The pipeline avoids storing long-lived AWS access keys as repository secrets. GitHub's AWS OIDC guide explains this pattern for GitHub Actions, and the same idea exists in many CI/CD systems: the job proves its identity to AWS, AWS STS issues temporary credentials, and the deployment step uses those credentials only for that run.

Here is a realistic release packet for the orders API:

```yaml
release_packet:
  ci_cd:
    system: GitHub Actions
    aws_auth: OIDC assume-role
    pipeline_run: github-actions-9831
  artifact:
    build_tool: Docker Buildx
    registry: Amazon ECR
    image_digest: sha256:8a7b2f42c49d
    sbom: sbom.spdx.json
    vulnerability_scan: Amazon Inspector container image scan
  infrastructure:
    tool: Terraform
    plan_file: tfplan-orders-api-v31
    changed_resources:
      - aws_ecs_task_definition.orders_api
      - aws_ecs_service.orders_api
      - aws_cloudwatch_metric_alarm.checkout_5xx
  runtime_controls:
    primary_runtime: Amazon ECS on AWS Fargate
    traffic_entry: Application Load Balancer
    async_runtime: AWS Lambda alias for receipt worker
  observability:
    metrics_and_logs: Amazon CloudWatch
    tracing: OpenTelemetry
    required_dimensions:
      - service.name
      - deployment.environment
      - deployment.version
      - aws.ecs.task_definition.revision
  incident_workflow:
    owner: platform-api-oncall
    rollback_decision: failed checkout rate above release threshold
```

This packet shows the usual shape of production work. AWS runs the application, but the release owner still needs the pipeline run, Terraform plan, image digest, OIDC role, scan result, telemetry dimensions, and incident owner. Those items make the release inspectable. Without them, a console page may say the service is healthy while the team lacks the evidence needed to explain what changed.

The packet also prevents a common beginner mistake: treating every AWS release as only an ECS command or only a Lambda command. In real systems, the release is the combination of runtime state, dependency access, and delivery evidence.

## Runtime
<!-- section-summary: The runtime is the AWS service and production object that runs the artifact and receives traffic. -->

A **runtime** is the AWS hosting surface that executes the artifact. ECS runs containers as tasks inside a service. Fargate supplies serverless compute for ECS tasks. Lambda runs functions without the team managing servers. Elastic Beanstalk runs applications behind a managed platform layer. Amazon EKS runs Kubernetes workloads. EC2 runs virtual machines that the team manages more directly.

For release work, "it runs on AWS" gives the team too little detail. A useful runtime statement names the service, region, environment, production object, revision, and traffic path. For example: `devpolaris-orders-api` runs as ECS service `svc-orders-api-prod` in cluster `ecs-devpolaris-prod` in `eu-west-2`, using task definition `devpolaris-orders-api:31`, behind an Application Load Balancer target group. That statement tells the release owner where to inspect deployments, which task definition to compare, and which load balancer health check controls traffic.

ECS and Lambda expose releases in different shapes. In ECS, the release often centers on a **task definition revision** and an **ECS service deployment**. A task definition is the launch specification for tasks: image, CPU, memory, ports, environment variables, secrets, logging, and IAM roles. An ECS service maintains the desired number of running tasks and replaces tasks during deployments. In Lambda, the release often centers on a **published version** and an **alias**. A Lambda alias is a named pointer such as `prod` that can point to one version or split traffic between two versions.

For the orders API, the primary runtime record might look like this:

```yaml
runtime:
  platform: Amazon ECS on AWS Fargate
  region: eu-west-2
  cluster: ecs-devpolaris-prod
  service: svc-orders-api-prod
  stable_task_definition: devpolaris-orders-api:30
  candidate_task_definition: devpolaris-orders-api:31
  load_balancer: alb-devpolaris-prod
  target_group: tg-orders-api-prod
  desired_count: 6
```

The same release may also touch an asynchronous receipt worker implemented with Lambda. If the API publishes a receipt event and the worker processes it, the worker runtime needs a record too:

```yaml
async_runtime:
  platform: AWS Lambda
  function: devpolaris-receipt-worker
  alias: prod
  stable_version: "42"
  candidate_version: "43"
  first_step:
    version_42: 90
    version_43: 10
```

Naming the runtime decides the rest of the release workflow. ECS rollback usually updates the service back to a previous task definition revision or lets the ECS deployment circuit breaker roll back to the last completed deployment. Lambda rollback usually moves an alias back to a previous version or removes the weighted alias route. Infrastructure, configuration, health checks, and rollback all depend on which AWS runtime receives the artifact.

## How To Inspect Runtime State
<!-- section-summary: Runtime state is practical when the release owner can query the current service, task definition, deployment, and Lambda alias before changing traffic. -->

Inspection is the first practical move in a release. The release owner wants to answer three questions before changing production: which version is running, where is traffic going, and which settings and roles will the running workload use. The AWS CLI is useful here because read-only commands can turn assumptions into facts before the team updates anything.

For the ECS service, start by describing the service. This shows the active deployments, task definition ARNs, desired count, running count, rollout state, and load balancer target group.

```bash
aws ecs describe-services \
  --cluster ecs-devpolaris-prod \
  --services svc-orders-api-prod \
  --region eu-west-2 \
  --query "services[0].{serviceName:serviceName,taskDefinition:taskDefinition,desiredCount:desiredCount,runningCount:runningCount,deployments:deployments[*].{status:status,taskDefinition:taskDefinition,desiredCount:desiredCount,runningCount:runningCount,rolloutState:rolloutState},loadBalancers:loadBalancers}" \
  --output yaml
```

Then inspect the task definition that the service reports. This shows the image reference, environment variable names, Secrets Manager or SSM Parameter Store references, task role, execution role, port mappings, log configuration, CPU, and memory.

```bash
aws ecs describe-task-definition \
  --task-definition devpolaris-orders-api:31 \
  --region eu-west-2 \
  --query "taskDefinition.{family:family,revision:revision,taskRoleArn:taskRoleArn,executionRoleArn:executionRoleArn,containers:containerDefinitions[*].{name:name,image:image,environment:environment,secrets:secrets,portMappings:portMappings,logConfiguration:logConfiguration},cpu:cpu,memory:memory}" \
  --output yaml
```

Those two commands give the release owner a grounded view of the ECS side. If the service says revision `31` is active and the task definition image matches the release packet digest, the runtime and artifact agree. If the service still points at revision `30`, the release remains before the runtime change. If the task definition uses a tag without a digest, the team has weaker evidence and should be more careful when connecting logs to build outputs.

For the Lambda receipt worker, inspect the alias. The alias output shows the main function version and any weighted routing to another version.

```bash
aws lambda get-alias \
  --function-name devpolaris-receipt-worker \
  --name prod \
  --region eu-west-2 \
  --query "{alias:Name,functionVersion:FunctionVersion,routing:RoutingConfig}" \
  --output yaml
```

This command answers the traffic question for Lambda. If `FunctionVersion` is `42` and `AdditionalVersionWeights` sends `0.1` to `43`, then the alias is sending most traffic to the stable version and a small slice to the candidate. AWS Lambda supports aliases and weighted alias routing for this kind of traffic split.

The practical habit matters more than memorizing every property. Inspect current state, compare it with the release packet, then update the runtime only after the facts match. That habit keeps a release from turning into guesswork.

## Infrastructure and Pipeline
<!-- section-summary: Infrastructure and pipeline changes decide how the candidate reaches AWS and whether the environment around it changed at the same time. -->

**Infrastructure** is the AWS resource shape around the application. For the orders API, it includes the ECS cluster, ECS service, task definition, Application Load Balancer, target group, security groups, RDS PostgreSQL instance, S3 receipt bucket, SQS queue, EventBridge bus or rule, CloudWatch log group, alarms, IAM roles, and network paths. **Pipeline** means the automated workflow that builds, tests, scans, deploys, and records the change.

Application releases and infrastructure releases often travel together. The receipt retry code may ship in the container image while the same pull request changes an ALB health check path, adds a new SQS queue permission, adjusts ECS deployment percentages, or changes a security group rule. The code can look safe while the infrastructure change creates the outage. That is why a release review should name both the application artifact and the infrastructure artifact.

Many AWS teams use Terraform or OpenTofu to manage this shape. The release owner should know whether the infrastructure step ran, which plan was approved, which resources changed, and whether any drift was detected. A release that changes only the ECS task definition has a different risk profile from a release that also changes RDS connectivity, IAM permissions, or target group health checks.

Here is a compact combined summary:

```yaml
pipeline:
  run: github-actions-9831
  source_commit: 7f31c9a
  aws_auth: OIDC assume-role arn:aws:iam::123456789012:role/github-actions-prod-release
  tests:
    unit: passed
    api_contract: passed
    smoke_checkout_staging: passed
  security:
    image_scan: passed
    sbom_generated: true
  deploy_steps:
    - build Docker image
    - push image digest to Amazon ECR
    - register ECS task definition devpolaris-orders-api:31
    - update ECS service svc-orders-api-prod
    - keep release watch active for 20 minutes
infrastructure_changes:
  - no RDS schema change
  - no S3 bucket policy change
  - no SQS queue policy change
  - ECS task definition image and environment changed
```

The last lines are useful because they tell the on-call engineer what stayed steady. If checkout failures rise, the team can focus first on the candidate image, task definition settings, and runtime behavior instead of wondering whether the database schema moved. When infrastructure does change, the record should say so plainly and include the plan output location.

The pipeline gets the candidate into AWS. The candidate still needs the right runtime values and permissions once it starts. That is where configuration and identity come in.

## Configuration and Identity
<!-- section-summary: Configuration and identity decide which dependencies the running artifact can reach and how it behaves in production. -->

**Runtime configuration** is the environment-specific set of values the app reads while it runs. In ECS, configuration often appears as container environment variables, Secrets Manager references, SSM Parameter Store references, feature flags, log settings, and task definition values. In Lambda, configuration appears as function environment variables, alias routing, reserved concurrency, event source mappings, layers, and execution role settings.

The same artifact can behave differently when configuration changes. The orders API image may contain the retry code, but `CHECKOUT_RECEIPT_RETRY_ENABLED=true` decides whether the new branch runs. `RECEIPTS_BUCKET=devpolaris-prod-receipts` decides where receipt files land. `ORDER_EVENTS_BUS=devpolaris-prod-events` decides which EventBridge bus receives background events. A healthy container process can still write to the wrong target if configuration points at the wrong AWS resource.

**Identity** is the AWS principal the runtime uses when it calls other services. In ECS, the **task role** is the application identity used by code running inside the task. The **task execution role** lets ECS pull images, fetch secrets, and write logs. In Lambda, the **execution role** is the IAM role the function assumes when it runs. These roles receive temporary credentials from AWS. The app code uses the AWS SDK, and the SDK finds those credentials through the runtime environment.

For the orders API, the task role needs specific permissions. It needs to write receipt objects to one S3 bucket, send messages to one SQS queue, put events on one EventBridge bus, write telemetry through the configured path, and connect to RDS through the database credentials or IAM auth pattern the team uses. The release owner should keep secret values out of the release record while still recording target names and permission shape.

```yaml
configuration:
  CHECKOUT_RECEIPT_RETRY_ENABLED:
    old: "false"
    new: "true"
    risk: enables new retry branch on receipt upload
  RECEIPTS_BUCKET:
    old_target: devpolaris-prod-receipts
    new_target: devpolaris-prod-receipts
  ORDER_EVENTS_BUS:
    old_target: devpolaris-prod-events
    new_target: devpolaris-prod-events
  DATABASE_SECRET:
    source: AWS Secrets Manager
    secret_id: /devpolaris/prod/orders-api/database
identity:
  runtime_identity: arn:aws:iam::123456789012:role/ecs-task-orders-api-prod
  required_access:
    - s3:PutObject on arn:aws:s3:::devpolaris-prod-receipts/*
    - sqs:SendMessage on arn:aws:sqs:eu-west-2:123456789012:orders-receipt-work
    - events:PutEvents on arn:aws:events:eu-west-2:123456789012:event-bus/devpolaris-prod-events
    - secretsmanager:GetSecretValue on /devpolaris/prod/orders-api/database
```

This record avoids putting passwords or tokens into release notes. It records the target and permission shape. If the app needs a secret, the release review should confirm that the task execution role can fetch the secret reference and the app can use the loaded value. If the app needs direct AWS API access, the review should confirm that the task role or Lambda execution role has the narrow permission needed for the exact resource.

Configuration and identity connect the artifact to real dependencies. Once those look right, the release question moves to user exposure and health evidence because the team still needs to decide how much traffic reaches the candidate.

## Traffic and Health
<!-- section-summary: Traffic controls who reaches the candidate, and health evidence shows whether the release is safe to continue. -->

**Traffic control** decides which users or events reach the candidate. In ECS, traffic usually reaches tasks through an Application Load Balancer and target group. For a standard ECS rolling deployment, the service scheduler replaces old tasks with new tasks while keeping enough healthy tasks running according to the service deployment configuration. For blue/green or canary-style patterns, teams may use CodeDeploy, weighted DNS, separate target groups, feature flags, or a service mesh. In Lambda, an alias can split traffic between two published versions.

The useful beginner idea is that production exposure can be smaller than the act of deploying. The orders API can register task definition `31`, start new tasks, wait for load balancer health checks, watch the deployment reach steady state, and then continue the release watch before declaring success. The receipt worker can send 10 percent of alias traffic to version `43` while version `42` stays the main path.

**Health evidence** is the set of signals the team uses to decide whether the candidate behaves well. A target group health check proves the task can answer a specific HTTP path. A smoke test proves a known checkout path works. CloudWatch metrics, logs, alarms, Application Signals, and OpenTelemetry traces show what real requests and dependencies are doing. Health evidence should match the risk of the release. For a receipt retry change, receipt upload failures matter more than a generic CPU chart.

Here is a traffic and health plan for the release:

```yaml
traffic_plan:
  ecs_service:
    method: rolling deployment with minimum healthy percent 100
    stable_task_definition: devpolaris-orders-api:30
    candidate_task_definition: devpolaris-orders-api:31
  lambda_receipt_worker:
    alias: prod
    first_step:
      version_42: 90
      version_43: 10
  promote_if:
    - checkout 5xx rate stays near baseline for 20 minutes
    - p95 checkout latency stays under 650 ms
    - RDS connection errors stay near baseline
    - S3 receipt write failures stay near baseline
    - SQS and EventBridge publish failures stay near baseline
    - no high-severity CloudWatch alarm enters ALARM
```

These signals match the checkout path. The API writes to RDS, stores receipts in S3, publishes background work to SQS/EventBridge, and emits telemetry to CloudWatch. A useful release watch checks those exact dependencies. If the S3 receipt write metric rises while generic service CPU stays normal, the release still has a customer-impacting problem because buyers may miss receipts.

Health checks need care because AWS services use them to make traffic decisions. An ALB target group health check pings a configured path and only routes to targets marked healthy. ECS uses container health checks and load balancer health when deciding whether tasks can serve traffic. Lambda alias routing only proves where invocations go, so the team needs function error rate, duration, throttles, dead-letter queue or failure destination signals, and business-path logs.

Once traffic and health evidence exist, the team needs a prepared recovery path. That path should have a name before the candidate receives production traffic.

## Rollback
<!-- section-summary: Rollback returns production to a previously stable runtime state when the release harms users. -->

**Rollback** means returning production to a previously stable state. In ECS, rollback can mean updating the service back to the previous task definition revision or relying on the ECS deployment circuit breaker when it is configured to roll back failed deployments. In Lambda, rollback can mean moving an alias back to the previous version or removing the weighted route to the candidate. For configuration mistakes, rollback can mean restoring the previous environment variable, secret reference, feature flag, IAM policy, or traffic rule.

Rollback works best when the release record names the target before traffic moves. For the orders API, the target might be task definition `devpolaris-orders-api:30` and Lambda receipt worker version `42`. If version `31` raises checkout errors, the team can update the ECS service back to revision `30`. If Lambda version `43` raises receipt processing failures, the team can point alias `prod` fully back to version `42`.

Rollback has limits, so the team should name them early. If the release includes a database migration that changes rows beyond the old code's read path, moving traffic back to the old task definition may create a second failure. If the release changes receipt object names in S3, rollback may also need a repair step for receipts written during the bad window. If the release changes EventBridge event shape, downstream consumers may need their own recovery plan.

Here is a short rollback plan:

```yaml
rollback_plan:
  trigger:
    - checkout 5xx rate above 2 percent for 5 minutes
    - S3 receipt write failures above baseline for 5 minutes
    - RDS connection failures above baseline for 5 minutes
  ecs_primary_action:
    - update ECS service to task definition devpolaris-orders-api:30
    - wait for service stability
  lambda_action_if_needed:
    - set alias prod to version 42 with no additional weights
  config_action_if_needed:
    - restore CHECKOUT_RECEIPT_RETRY_ENABLED to "false"
  owner: platform-api-oncall
  expected_user_effect: new checkout requests return to the stable runtime path
```

This plan gives the on-call engineer a first move. It also keeps expectations honest. Rollback protects new user traffic first. After rollback, the team still needs to inspect failed orders, missing receipts, duplicated retry attempts, dead-letter queues, support tickets, and any cleanup work created during the bad window.

## How Rollback Happens In AWS
<!-- section-summary: AWS rollback usually means updating an ECS service to a previous task definition, letting a configured circuit breaker recover, changing a Lambda alias, or restoring configuration. -->

For ECS, the most direct manual rollback is updating the service to the previous task definition revision. In the orders API release, the candidate is `devpolaris-orders-api:31` and the stable revision is `devpolaris-orders-api:30`.

```bash
aws ecs update-service \
  --cluster ecs-devpolaris-prod \
  --service svc-orders-api-prod \
  --task-definition devpolaris-orders-api:30 \
  --region eu-west-2

aws ecs wait services-stable \
  --cluster ecs-devpolaris-prod \
  --services svc-orders-api-prod \
  --region eu-west-2
```

The first command asks ECS to start a new deployment using the previous task definition. The second command waits until ECS reports the service has reached a stable state. The team should then describe the service again and confirm the active task definition matches the rollback target.

```bash
aws ecs describe-services \
  --cluster ecs-devpolaris-prod \
  --services svc-orders-api-prod \
  --region eu-west-2 \
  --query "services[0].deployments[*].{status:status,taskDefinition:taskDefinition,rolloutState:rolloutState,runningCount:runningCount}" \
  --output table
```

ECS also has a deployment circuit breaker for rolling deployments. When configured with rollback enabled, ECS can mark a failed deployment as failed and roll back to the most recent completed deployment. That feature helps when new tasks fail to reach steady state. The release owner should still record whether the circuit breaker is enabled because automatic rollback only helps if the service is configured for it and the failure matches the detection path.

For Lambda, rollback usually means updating the alias. If alias `prod` sends traffic to version `43` and the worker starts failing receipt jobs, move the alias back to version `42` and clear the weighted route.

```bash
aws lambda update-alias \
  --function-name devpolaris-receipt-worker \
  --name prod \
  --function-version 42 \
  --routing-config AdditionalVersionWeights={} \
  --region eu-west-2

aws lambda get-alias \
  --function-name devpolaris-receipt-worker \
  --name prod \
  --region eu-west-2 \
  --query "{alias:Name,functionVersion:FunctionVersion,routing:RoutingConfig}" \
  --output yaml
```

For configuration rollback, the exact command depends on where the setting lives. An ECS environment variable change usually requires registering a new task definition revision and updating the service. A Secrets Manager value can be restored by moving the application back to a previous secret version or by updating the secret with a known-good value through the team's secret-management process. A feature flag can be turned off in the flag system without rebuilding the container.

The practical rollback sequence is consistent: move new traffic back to the stable runtime target, restore the configuration value if configuration caused the problem, verify runtime state, and then watch the user-path telemetry. The command itself matters, but the release record matters just as much because it tells the team which command to run.

## Release Record
<!-- section-summary: A release record keeps the production change understandable during rollout, incident response, and future review. -->

A **release record** is the written snapshot of what changed, where it runs, how traffic moves, what the team watches, and how recovery works. It can live in a deployment system, a pull request, a change ticket, an incident-management tool, or a markdown note attached to the release. The format matters less than the habit of recording production facts.

For a small team, this can feel like extra ceremony. It pays off during the first bad rollout. When checkout errors rise, people ask the same questions at once: which image is live, which task definition revision did ECS start, which Lambda version receives events, which setting changed, which IAM role is active, where are the logs, which alarm fired, who owns the decision, and what command rolls back. A release record answers those questions without forcing the team to dig through console screens under pressure.

Here is a compact release record for the orders API:

```yaml
release: orders-api-2026-06-12-v31
service: devpolaris-orders-api
change: receipt upload retry for checkout
artifact:
  image: 123456789012.dkr.ecr.eu-west-2.amazonaws.com/devpolaris-orders-api@sha256:8a7b2f42c49d
  commit: 7f31c9a
  sbom: s3://devpolaris-release-evidence/orders-api/v31/sbom.spdx.json
pipeline:
  system: GitHub Actions
  run: github-actions-9831
  aws_auth: OIDC assume-role
infrastructure:
  tool: Terraform
  plan: tfplan-orders-api-v31
  changes:
    - register ECS task definition devpolaris-orders-api:31
    - update ECS service svc-orders-api-prod
runtime:
  primary:
    platform: Amazon ECS on AWS Fargate
    cluster: ecs-devpolaris-prod
    service: svc-orders-api-prod
    candidate_task_definition: devpolaris-orders-api:31
    stable_task_definition: devpolaris-orders-api:30
  async_worker:
    platform: AWS Lambda
    function: devpolaris-receipt-worker
    alias: prod
    candidate_version: "43"
    stable_version: "42"
configuration:
  CHECKOUT_RECEIPT_RETRY_ENABLED: "true"
  RECEIPTS_BUCKET: devpolaris-prod-receipts
identity:
  ecs_task_role: arn:aws:iam::123456789012:role/ecs-task-orders-api-prod
  checked_access:
    - S3 receipt writes
    - SQS receipt work publish
    - EventBridge order event publish
    - Secrets Manager database secret read
traffic:
  ecs_method: rolling deployment
  lambda_first_step: 10 percent to version 43
health:
  watch_window: 20 minutes
  signals:
    - checkout 5xx rate
    - p95 checkout latency
    - RDS connection errors
    - S3 receipt write failures
    - SQS and EventBridge publish failures
    - CloudWatch alarms
rollback:
  ecs_target: devpolaris-orders-api:30
  lambda_target: version 42
  action: move runtime targets back to stable versions and restore retry flag if needed
owner: platform-api-oncall
```

The record stays readable because it focuses on release-critical facts. It skips AWS properties outside the release decision. If the service ran on EKS, the runtime section would name the namespace, deployment, image digest, replicas, service, ingress, and rollback revision. If the service ran only on Lambda, the runtime section would name function versions, aliases, event source mappings, concurrency settings, and failure destinations.

Release records also help future reviews. A month later, the team can compare successful and failed releases. Maybe every incident involved missing IAM permission checks. Maybe the rollback command worked for ECS but the Lambda alias record was incomplete. Those patterns turn into better templates, better automation, and fewer surprises.

## Putting It All Together
<!-- section-summary: A complete AWS release connects the candidate artifact, runtime target, infrastructure, settings, identity, traffic, health, rollback target, and written evidence. -->

The orders API release starts with a candidate artifact. The team builds image digest `sha256:8a7b2f42c49d` from commit `7f31c9a`, pushes it to ECR, generates an SBOM, scans the image, and records the pipeline run. That gives everyone a stable name for the build under discussion.

The pipeline uses short-lived AWS credentials through OIDC and applies the Terraform plan for this release. The plan registers ECS task definition `devpolaris-orders-api:31`, keeps the same RDS, S3, SQS, and EventBridge targets, and updates the ECS service. The release owner records that no database migration, bucket policy change, queue policy change, or event bus change occurred.

The runtime inspection confirms what AWS is running. `aws ecs describe-services` shows the ECS deployment and task definition. `aws ecs describe-task-definition` shows the image digest, task role, execution role, secrets, environment variables, ports, logs, CPU, and memory. `aws lambda get-alias` shows whether the receipt worker alias is still on the stable version or already sending a small percentage to the candidate.

The team reviews configuration and identity before expanding exposure. The retry flag is on, the receipt bucket still points to production, the database secret reference is unchanged, and the ECS task role has the permissions needed for S3, SQS, EventBridge, and Secrets Manager. This check matters because a correct artifact can fail immediately when AWS gives it the wrong values or the wrong permissions.

Traffic and health provide the release decision. ECS replaces tasks according to the service deployment configuration and load balancer health checks. The Lambda receipt worker alias sends a small first step to the new version. During the watch window, the team watches checkout failures, p95 latency, RDS errors, S3 receipt write failures, SQS/EventBridge publish failures, Lambda errors, and CloudWatch alarms.

The rollback target stays ready. If the candidate hurts checkout, the team updates the ECS service back to task definition `30`, moves the Lambda alias back to version `42`, and restores the retry flag if needed. After new traffic is stable, the team investigates failed orders, missing receipts, queue messages, traces, logs, and any cleanup work.

That is the core idea of this module. A release in AWS is a connected production change. The artifact, runtime target, infrastructure, configuration, identity, traffic, health evidence, rollback path, and release record all matter because users experience the combination.

## What's Next
<!-- section-summary: The next article focuses on ECS deployments, task definitions, service updates, deployment configuration, and steady-state verification. -->

Now that the release pieces have names, the next article goes deeper into the main runtime path for this module: ECS deployments. We will keep using `devpolaris-orders-api` and look closely at task definitions, ECS service updates, deployment configuration, load balancer health checks, steady state, and the release evidence an operator should collect before calling a deployment successful.

That next step makes the release model more concrete. Instead of only saying "the service deployed," we will inspect what ECS changed, how tasks roll forward, how health gates work, and how the team confirms the runtime is actually serving production safely.

---

**References**

- [Amazon ECS task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html) - Explains task definitions as the blueprint for ECS tasks, including image, roles, ports, CPU, memory, and other launch settings.
- [Amazon ECS task definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html) - Documents task definition fields and image behavior, including tag and digest references.
- [How the Amazon ECS deployment circuit breaker detects failures](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html) - Describes failed deployment detection and rollback to the most recent completed deployment when rollback is enabled.
- [aws ecs describe-services](https://docs.aws.amazon.com/cli/latest/reference/ecs/describe-services.html) - Documents the AWS CLI command for inspecting ECS service state and deployments.
- [aws ecs describe-task-definition](https://docs.aws.amazon.com/cli/latest/reference/ecs/describe-task-definition.html) - Documents the AWS CLI command for inspecting ECS task definition revisions.
- [Create an alias for a Lambda function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html) - Explains Lambda aliases as pointers to function versions.
- [Implement Lambda canary deployments using a weighted alias](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html) - Documents weighted alias routing for traffic splitting and rollback.
- [aws lambda get-alias](https://docs.aws.amazon.com/cli/latest/reference/lambda/get-alias.html) - Documents the AWS CLI command for inspecting a Lambda alias.
- [Scan images for software vulnerabilities in Amazon ECR](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-scanning.html) - Explains ECR image scanning for container vulnerabilities.
- [Integrating Amazon Inspector scans into your CI/CD pipeline](https://docs.aws.amazon.com/inspector/latest/user/scanning-cicd.html) - Covers CI/CD vulnerability scanning and SBOM-related workflows with Amazon Inspector.
- [OpenTelemetry with Amazon CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-OpenTelemetry-Sections.html) - Explains CloudWatch support for OpenTelemetry and application monitoring.
- [Configuring OpenID Connect in Amazon Web Services](https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) - Explains GitHub Actions OIDC federation for AWS deployments without long-lived AWS credentials.
