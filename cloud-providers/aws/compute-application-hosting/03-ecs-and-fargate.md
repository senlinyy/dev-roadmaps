---
title: "ECS And Fargate"
description: "Explain how ECS turns an ECR image into a long-running Fargate service, with networking, roles, load balancing, and logs in the right places."
overview: "A container image is only a package. This article follows one image through ECS task definitions, services, Fargate tasks, load balancer targets, IAM roles, and CloudWatch Logs so the runtime shape is visible."
tags: ["ecs", "fargate", "containers", "ecr", "aws"]
order: 3
id: article-cloud-providers-aws-compute-application-hosting-ecs-and-fargate
aliases:
  - ecs-and-fargate
  - cloud-providers/aws/compute-application-hosting/ecs-and-fargate.md
---

## Table of Contents

1. [From Image to Running Service](#from-image-to-running-service)
2. [The Task Definition Contract](#the-task-definition-contract)
3. [Registering the Task Definition](#registering-the-task-definition)
4. [Services, Desired Counts, and Fargate Tasks](#services-desired-counts-and-fargate-tasks)
5. [Networking and ALB Target Health](#networking-and-alb-target-health)
6. [Roles, Secrets, and Logs](#roles-secrets-and-logs)
7. [Deploying and Rolling Back a Revision](#deploying-and-rolling-back-a-revision)
8. [Debugging a Failed ECS Rollout](#debugging-a-failed-ecs-rollout)
9. [References](#references)

## From Image to Running Service
<!-- section-summary: ECS starts after a container image exists and turns that image into running tasks with networking, identity, logs, and health checks. -->

The `orders-api` team has a Docker image. It starts with `node server.js`, listens on port `3000`, and works locally with a command like this:

```bash
docker run -p 3000:3000 -e NODE_ENV=production orders-api:local
```

`-p 3000:3000` maps laptop port `3000` to container port `3000`. `-e NODE_ENV=production` passes an environment variable into the container. `orders-api:local` names the image. This proves the image can start, but production still needs CPU, memory, network placement, AWS permissions, log delivery, health checks, and a way to keep several copies running.

**Amazon ECS** is AWS's container orchestration service. ECS runs containers as **tasks**. A task can have one container or a small group of containers that share a lifecycle. **AWS Fargate** supplies serverless compute capacity for ECS tasks, so the team chooses task CPU and memory while AWS handles the underlying host fleet.

For this article, the image lives in Amazon ECR. A task definition describes how to run one copy. An ECS service keeps three copies running. Fargate supplies capacity. An Application Load Balancer routes traffic to healthy task IPs. IAM roles let the app call AWS without static keys. CloudWatch Logs receives stdout and stderr.

That path has a clean order:

1. Build and push an image to ECR.
2. Register a task definition revision that points at that image.
3. Create or update an ECS service to use the revision.
4. Watch service counts, task state, target health, logs, and application metrics.

The important shift from EC2 is that the container image is the artifact, while the task definition and service are the runtime contract.

![The container-to-service map shows how image, task definition, service, target group, logs, roles, and networking connect into one ECS release](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ecs-and-fargate/container-to-service-map.png)

*The container-to-service map shows how image, task definition, service, target group, logs, roles, and networking connect into one ECS release.*


## The Task Definition Contract
<!-- section-summary: A task definition is the versioned recipe ECS uses to start one copy of the workload. -->

A **task definition** is a JSON document that describes one task. Every update creates a new revision, such as `orders-api:42`. That revision history matters because rollback means moving the service back to a previous known-good revision.

Here is a realistic Fargate task definition for `orders-api`:

```json
{
  "family": "orders-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "taskRoleArn": "arn:aws:iam::123456789012:role/prod-orders-api-task-role",
  "executionRoleArn": "arn:aws:iam::123456789012:role/prod-ecs-task-execution-role",
  "runtimePlatform": {
    "cpuArchitecture": "X86_64",
    "operatingSystemFamily": "LINUX"
  },
  "containerDefinitions": [
    {
      "name": "api",
      "image": "123456789012.dkr.ecr.eu-west-2.amazonaws.com/orders-api@sha256:5f6d7a8b9c0d",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp",
          "appProtocol": "http"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:eu-west-2:123456789012:secret:prod/orders/db-AbCdEf"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/prod/orders-api",
          "awslogs-region": "eu-west-2",
          "awslogs-stream-prefix": "api"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 20
      }
    }
  ]
}
```

The task-level fields describe the runtime envelope:

| Field | Meaning |
|---|---|
| `family` | The task definition family name. Revisions appear as `orders-api:1`, `orders-api:2`, and so on. |
| `networkMode` | `awsvpc` gives each Fargate task its own elastic network interface, subnet placement, private IP, and security group. |
| `requiresCompatibilities` | `["FARGATE"]` tells ECS to validate this definition for Fargate. |
| `cpu` | Task-level CPU units. `512` means half a vCPU for the whole task. |
| `memory` | Task-level memory in MiB. `1024` means 1 GiB for the whole task. |
| `taskRoleArn` | The IAM role the application code uses at runtime when it calls AWS APIs. |
| `executionRoleArn` | The IAM role ECS uses to pull the image, fetch injected secrets, and send container logs. |
| `runtimePlatform` | The CPU architecture and operating system family the task expects. |

The container-level fields describe the app process:

| Field | Meaning |
|---|---|
| `name` | The container name inside the task. ECS events and logs use this name. |
| `image` | The exact image to run. A digest pins the content more precisely than a mutable tag. |
| `essential` | If this container stops, ECS stops the whole task. That is right for the main API container. |
| `portMappings` | The app listens on container port `3000` over TCP, and the ALB target group should send traffic there. |
| `environment` | Non-secret runtime values. These appear in task metadata and should stay safe to reveal. |
| `secrets` | Secret values injected from Secrets Manager or Parameter Store at startup. |
| `logConfiguration` | Sends stdout and stderr to CloudWatch Logs using the `awslogs` driver. |
| `healthCheck` | Runs inside the container and tells ECS whether the app process is healthy. |

The port mapping deserves special attention. With Fargate and `awsvpc`, each task has its own network interface and private IP. The Application Load Balancer target group should use target type `ip`, and it should route to the task private IP on port `3000`. The target group health check and the container health check can use the same endpoint, but they answer different questions: ALB health controls user traffic, while container health controls task replacement.

Now the task definition needs to become an ECS revision.

## Registering the Task Definition
<!-- section-summary: Registering a task definition creates a numbered revision that services can deploy and roll back to. -->

Save the JSON as `orders-api-task.json`, then register it:

```bash
aws ecs register-task-definition \
  --cli-input-json file://orders-api-task.json \
  --region eu-west-2
```

Example output:

```json
{
  "taskDefinition": {
    "taskDefinitionArn": "arn:aws:ecs:eu-west-2:123456789012:task-definition/orders-api:42",
    "family": "orders-api",
    "revision": 42,
    "status": "ACTIVE",
    "requiresCompatibilities": ["FARGATE"],
    "cpu": "512",
    "memory": "1024"
  }
}
```

`taskDefinitionArn` is the full address of this revision. `family` and `revision` give the short name `orders-api:42`. `status: ACTIVE` means ECS can use it for new tasks. The output repeats the Fargate compatibility, CPU, and memory so you can verify the registered recipe matches the intended release.

Many teams record the image digest and task definition revision in the release notes. That small record matters during incidents because "revision 42" should identify the exact image, roles, secrets, ports, log group, and health check used by the service.

A registered task definition can run one-off tasks, scheduled tasks, or long-running services. Web APIs usually need an ECS service.

## Services, Desired Counts, and Fargate Tasks
<!-- section-summary: An ECS service keeps the desired number of task copies running and reports whether rollout state matches that desired count. -->

An **ECS service** keeps a desired number of task copies running. If desired count is `3`, ECS tries to keep three tasks alive. If one task stops, ECS starts a replacement. If the service is connected to a load balancer, ECS also registers and deregisters task IPs with the target group.

For `orders-api`, the service might run in private subnets with desired count `3`. A rolling deployment starts new tasks with revision `42`, waits for health, then stops old tasks from revision `41`. Deployment settings such as minimum healthy percent and maximum percent control how much overlap happens during the rollout.

Check the service state like this:

```bash
aws ecs describe-services \
  --cluster prod-web \
  --services orders-api \
  --region eu-west-2 \
  --query 'services[].{Desired:desiredCount,Running:runningCount,Pending:pendingCount,TaskDefinition:taskDefinition,Deployments:deployments[].{Status:status,TaskDefinition:taskDefinition,Desired:desiredCount,Running:runningCount,Pending:pendingCount,Rollout:rolloutState}}'
```

Example output:

```json
[
  {
    "Desired": 3,
    "Running": 2,
    "Pending": 1,
    "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/orders-api:42",
    "Deployments": [
      {
        "Status": "PRIMARY",
        "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/orders-api:42",
        "Desired": 3,
        "Running": 2,
        "Pending": 1,
        "Rollout": "IN_PROGRESS"
      }
    ]
  }
]
```

`Desired` is how many tasks the service wants. `Running` is how many are currently running. `Pending` is how many are starting or waiting for placement. A short period with `Pending: 1` during a deployment can be normal. A long gap between desired and running means ECS is trying and failing to reach the desired state.

Service events usually explain the first reason:

```bash
aws ecs describe-services \
  --cluster prod-web \
  --services orders-api \
  --region eu-west-2 \
  --query 'services[].events[0:8].message'
```

Example output:

```json
[
  "service orders-api has started 1 tasks: task 9f8e7d6c5b4a.",
  "service orders-api registered 1 targets in target-group arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/orders-api/abc123.",
  "service orders-api (task 9f8e7d6c5b4a) failed container health checks."
]
```

These messages connect ECS state to the next check. The task started and registered with the target group, then failed container health checks. The next step is target health and logs.

## Networking and ALB Target Health
<!-- section-summary: Fargate tasks usually live in private subnets while an ALB routes public HTTPS traffic to healthy task IPs. -->

For a public API, place the Application Load Balancer in public subnets and Fargate tasks in private subnets. The ALB security group accepts HTTPS from users. The task security group accepts traffic only from the ALB security group on the container port. The task security group reaches the database security group on the database port.

The network path for `orders-api` can be summarized like this:

| Source | Destination | Port | Purpose |
|---|---|---|---|
| Internet | ALB security group | `443` | User HTTPS traffic. |
| ALB security group | Task security group | `3000` | Load-balanced app traffic. |
| Task security group | RDS security group | `5432` | PostgreSQL connection. |
| Task network path | ECR, CloudWatch Logs, Secrets Manager | HTTPS | Image pulls, logs, and secret injection. |

With Fargate and `awsvpc`, the target group should use `ip` targets because each task gets its own private IP address. The target group health check might call `/health` on port `3000`. If health checks fail, the ALB stops routing user traffic to that task, and ECS can replace it depending on service health behavior.

Inspect target health:

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
    "Target": "10.20.31.45",
    "Port": 3000,
    "State": "healthy",
    "Reason": null,
    "Description": null
  },
  {
    "Target": "10.20.42.18",
    "Port": 3000,
    "State": "unhealthy",
    "Reason": "Target.ResponseCodeMismatch",
    "Description": "Health checks failed with these codes: [500]"
  }
]
```

The target IDs are task private IPs. A `healthy` target can receive normal traffic. `Target.ResponseCodeMismatch` means the ALB reached the task but the health endpoint returned a code outside the allowed matcher. That points toward the app health endpoint, missing config, startup readiness, or a dependency the health endpoint checks.

Subnet IP capacity also matters. Every Fargate task needs a private IP address. If private subnets run low on IPs, tasks can stay pending even when CPU, memory, image, and health checks are correct. That failure appears in ECS service events and stopped task reasons.

Networking gets traffic to the task. The next layer is identity and evidence inside the task.

## Roles, Secrets, and Logs
<!-- section-summary: ECS separates the role used to start the task from the role the application uses at runtime, and logs should leave the task immediately. -->

ECS uses two common IAM roles for Fargate tasks. The **task execution role** lets ECS prepare the task. It pulls the image from ECR, retrieves secret values referenced in the task definition, and writes logs to CloudWatch. The **task role** is the identity your application code receives through the AWS SDK while the container is running.

For `orders-api`, the execution role needs ECR, CloudWatch Logs, and Secrets Manager permissions for startup. The task role needs only the actions the app performs after startup, such as writing receipt objects to one S3 prefix. Keeping those roles separate makes debugging faster. Image pull and secret injection errors usually point at the execution role. Runtime `AccessDenied` errors from application code usually point at the task role.

A task role policy might look like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WriteReceipts",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::prod-orders-receipts/receipts/*"
    },
    {
      "Sid": "PublishOrderEvents",
      "Effect": "Allow",
      "Action": "events:PutEvents",
      "Resource": "arn:aws:events:eu-west-2:123456789012:event-bus/prod-orders"
    }
  ]
}
```

`WriteReceipts` lets the app read and write only under the receipt prefix. `PublishOrderEvents` lets it publish events only to the production orders event bus. This policy leaves the database password out because this example injects it at startup through the task definition `secrets` field, which the execution role retrieves.

The log configuration in the task definition sends container output to CloudWatch Logs. A useful log group name includes environment and service name, such as `/ecs/prod/orders-api`. The stream prefix `api` helps group logs by container name and task ID.

Search recent errors:

```bash
aws logs tail /ecs/prod/orders-api \
  --since 30m \
  --region eu-west-2 \
  --filter-pattern '"ERROR"'
```

Example output:

```bash
2026-06-24T10:16:08Z api/orders-api/9f8e7d6c Error: DATABASE_URL is not set
2026-06-24T10:16:08Z api/orders-api/9f8e7d6c     at loadConfig (/app/config.js:12:11)
```

`--since 30m` limits the search to the recent incident window. `--filter-pattern '"ERROR"'` prints events containing the word `ERROR`. A quiet result means the app may log with a different word or structure, so search by request ID, exception name, status code, task ID, or deployment time.

With roles and logs in place, the service can move safely from one revision to another.

## Deploying and Rolling Back a Revision
<!-- section-summary: ECS deployments move a service from one task definition revision to another while service counts and health checks protect traffic. -->

A basic ECS release has four steps: push a new image to ECR, register a new task definition revision, update the service, and watch health. The service update points at a revision rather than an image tag alone, so the release includes every runtime field in the task definition.

Before changing the service, record the current revision:

```bash
aws ecs describe-services \
  --cluster prod-web \
  --services orders-api \
  --region eu-west-2 \
  --query 'services[0].taskDefinition'
```

Example output:

```json
"arn:aws:ecs:eu-west-2:123456789012:task-definition/orders-api:41"
```

Now update to the new revision:

```bash
aws ecs update-service \
  --cluster prod-web \
  --service orders-api \
  --task-definition orders-api:42 \
  --region eu-west-2
```

After the update, watch service counts, ECS events, ALB target health, task logs, and application metrics. A healthy rollout should move `Running` toward the desired count for the new primary deployment while old tasks drain from the target group.

Rollback uses the same command with the previous revision:

```bash
aws ecs update-service \
  --cluster prod-web \
  --service orders-api \
  --task-definition orders-api:41 \
  --region eu-west-2
```

Some services enable the ECS deployment circuit breaker with rollback. That can mark a failed deployment and return the service to the last completed deployment. Even with automation, keep the previous revision in the release record. Humans still need to understand which image digest, roles, secrets, and health checks were active before and after the event.

Now put the pieces together in a failure path.

![The rollout summary connects image digest, task definition revision, service deployment, target health, logs, and previous revision evidence](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ecs-and-fargate/ecs-rollout-evidence-summary.png)

*The rollout summary connects image digest, task definition revision, service deployment, target health, logs, and previous revision evidence.*


## Debugging a Failed ECS Rollout
<!-- section-summary: ECS rollout debugging follows service counts, service events, stopped task reasons, logs, target health, roles, and release metadata. -->

At 15:05, revision `42` starts rolling out and users see intermittent `503` responses. Start with the service because it connects desired state, deployment state, and recent events:

```bash
aws ecs describe-services \
  --cluster prod-web \
  --services orders-api \
  --region eu-west-2 \
  --query 'services[].{Desired:desiredCount,Running:runningCount,Pending:pendingCount,Events:events[0:8].message,Deployments:deployments[].{Status:status,TaskDefinition:taskDefinition,Running:runningCount,Pending:pendingCount,Rollout:rolloutState}}'
```

Example output:

```json
[
  {
    "Desired": 3,
    "Running": 2,
    "Pending": 0,
    "Events": [
      "service orders-api (task 9f8e7d6c5b4a) failed container health checks.",
      "service orders-api registered 1 targets in target-group arn:aws:elasticloadbalancing:eu-west-2:123456789012:targetgroup/orders-api/abc123."
    ],
    "Deployments": [
      {
        "Status": "PRIMARY",
        "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/orders-api:42",
        "Running": 1,
        "Pending": 0,
        "Rollout": "IN_PROGRESS"
      },
      {
        "Status": "ACTIVE",
        "TaskDefinition": "arn:aws:ecs:eu-west-2:123456789012:task-definition/orders-api:41",
        "Running": 1,
        "Pending": 0,
        "Rollout": "COMPLETED"
      }
    ]
  }
]
```

The service wants three tasks and only two are running. The primary deployment is revision `42`, and the event says container health checks failed. Check stopped tasks next:

```bash
aws ecs list-tasks \
  --cluster prod-web \
  --service-name orders-api \
  --desired-status STOPPED \
  --region eu-west-2 \
  --max-results 5
```

Then describe one stopped task:

```bash
aws ecs describe-tasks \
  --cluster prod-web \
  --tasks arn:aws:ecs:eu-west-2:123456789012:task/prod-web/9f8e7d6c5b4a \
  --region eu-west-2 \
  --query 'tasks[].{LastStatus:lastStatus,StopCode:stopCode,StoppedReason:stoppedReason,Containers:containers[].{Name:name,ExitCode:exitCode,Reason:reason,LastStatus:lastStatus}}'
```

Example output:

```json
[
  {
    "LastStatus": "STOPPED",
    "StopCode": "EssentialContainerExited",
    "StoppedReason": "Essential container in task exited",
    "Containers": [
      {
        "Name": "api",
        "ExitCode": 1,
        "Reason": null,
        "LastStatus": "STOPPED"
      }
    ]
  }
]
```

`EssentialContainerExited` means the main app container stopped, and `ExitCode: 1` means the app exited with an error. That points to logs rather than placement or image pull.

```bash
aws logs tail /ecs/prod/orders-api \
  --since 20m \
  --region eu-west-2 \
  --filter-pattern '"DATABASE_URL"'
```

If logs show a missing secret, inspect the task definition revision:

```bash
aws ecs describe-task-definition \
  --task-definition orders-api:42 \
  --region eu-west-2 \
  --query 'taskDefinition.containerDefinitions[].secrets'
```

Example output:

```json
[
  [
    {
      "name": "DATABASE_URL",
      "valueFrom": "arn:aws:secretsmanager:eu-west-2:123456789012:secret:prod/orders/wrong-db-AbCdEf"
    }
  ]
]
```

The secret ARN points to the wrong secret name. The fix is a new task definition revision with the correct `valueFrom`, then an `update-service` to deploy it. If users need immediate recovery, roll back to revision `41` first.

Other stopped reasons point to different layers. `CannotPullContainerError` usually means the image, ECR permission, or network path to ECR failed. `ResourceInitializationError` can mean log group, secret retrieval, or network setup failed. Long `Pending` counts can mean subnet IP capacity, Fargate capacity, or invalid placement. ALB target health failures with running tasks point toward health endpoint behavior, security groups, target group port, or app readiness.

The useful habit is to follow ECS evidence in order: service counts, service events, task stop reasons, container logs, target health, roles, and release metadata. That keeps the investigation tied to the layer that is actually failing.

![The ECS checklist summarizes the evidence to check across task definition, image, service events, target health, logs, roles, and capacity](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ecs-and-fargate/ecs-fargate-checklist.png)

*The ECS checklist summarizes the evidence to check across task definition, image, service events, target health, logs, roles, and capacity.*


## References

- [Amazon ECS task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)
- [Amazon ECS task definition parameters for Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)
- [Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html)
- [Use load balancing with Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html)
- [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)
- [Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
- [Send Amazon ECS logs to CloudWatch](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_awslogs.html)
- [Architect for AWS Fargate for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
