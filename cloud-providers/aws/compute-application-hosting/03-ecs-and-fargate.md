---
title: "ECS And Fargate"
description: "Understand container images, task definitions, tasks, services, Fargate capacity, task networking, IAM roles, health checks, deployments, and debugging."
overview: "ECS and Fargate solve different parts of container hosting. This article follows a container image through its runtime contract, desired-state service, managed compute, network path, health checks, and safe rollout."
tags: ["ecs", "fargate", "containers", "ecr", "aws"]
order: 3
id: article-cloud-providers-aws-compute-application-hosting-ecs-and-fargate
aliases:
  - ecs-and-fargate
  - cloud-providers/aws/compute-application-hosting/ecs-and-fargate.md
---

## Table of Contents

1. [What Problem Do ECS and Fargate Solve?](#what-problem-do-ecs-and-fargate-solve)
2. [How Do Task Definition Revisions Become Running Tasks?](#how-do-task-definition-revisions-become-running-tasks)
3. [How Does an ECS Service Maintain Desired State?](#how-does-an-ecs-service-maintain-desired-state)
4. [How Does a Fargate Task Join the Network?](#how-does-a-fargate-task-join-the-network)
5. [How Do Load Balancers and Health Checks Work with ECS?](#how-do-load-balancers-and-health-checks-work-with-ecs)
6. [How Should Tasks Receive Secrets and Send Logs?](#how-should-tasks-receive-secrets-and-send-logs)
7. [How Does an ECS Rolling Deployment Work?](#how-does-an-ecs-rolling-deployment-work)
8. [How Should You Think About ECS as a Whole?](#how-should-you-think-about-ecs-as-a-whole)
9. [Check Your Understanding](#check-your-understanding)
10. [References](#references)

The sections below answer these questions in order:

1. **What Problem Do ECS and Fargate Solve?**
2. **How Do Task Definition Revisions Become Running Tasks?**
3. **How Does an ECS Service Maintain Desired State?**
4. **How Does a Fargate Task Join the Network?**
5. **How Do Load Balancers and Health Checks Work with ECS?**
6. **How Should Tasks Receive Secrets and Send Logs?**
7. **How Does an ECS Rolling Deployment Work?**
8. **How Should You Think About ECS as a Whole?**

## What Problem Do ECS and Fargate Solve?
<!-- section-summary: ECS coordinates desired container workloads, while Fargate supplies managed compute on which ECS can run them. -->

Suppose you have a small HTTP API with `GET /users` and `GET /health`. Source code alone cannot become a reliable internet service. Something must package its runtime and dependencies, store that package, allocate CPU and memory, start copies, connect them to a network, keep the requested number alive, route traffic only to healthy copies, provide credentials and configuration, collect logs, and replace the old version during a release.

AWS divides these responsibilities into several objects:

| Hosting problem | AWS concept |
|---|---|
| Package the application | Container image |
| Store the package | Amazon ECR or another registry |
| Describe how one copy runs | ECS task definition |
| Run one copy | ECS task |
| Maintain a requested number of copies | ECS service |
| Compare desired and actual workloads | ECS control plane and scheduler |
| Supply machines for the tasks | Fargate, EC2, or ECS Managed Instances |
| Give each copy network connectivity | VPC, ENI, subnets, and security groups |
| Send requests to healthy copies | Application Load Balancer |
| Let infrastructure start a task | Task execution role |
| Let application code call AWS | Task role |
| Supply sensitive startup values | Secrets Manager or Parameter Store |
| Preserve standard output and error | CloudWatch Logs |
| Replace versions safely | ECS deployment system |

The first distinction to learn is:

> **Amazon ECS is the orchestration and control layer. AWS Fargate is a managed compute layer.**

ECS decides which tasks should exist and keeps comparing that desired state with reality. Fargate provides CPU, memory, networking, a kernel, and storage for tasks without requiring you to provision and patch the underlying EC2 container hosts.

```text
task definition + service
    “what should exist?”
             │
             ▼
            ECS
      scheduler and control
             │ asks for capacity
             ▼
          Fargate
     managed task compute
             │
             ▼
       running ECS tasks
             │
             ▼
   Application Load Balancer
             │
             ▼
           users
```

That whole path begins with a container image.

### What Is the Difference Between an Image and a Task Definition?
<!-- section-summary: An image packages software, while a task definition is the versioned contract describing how ECS should run that software. -->

Without containers, a team might prepare a server by installing Python, adding Linux packages, installing libraries, copying source code, setting environment variables, configuring a startup command, and creating a process supervisor. This raises an immediate reproducibility problem: which versions and commands produce the working application?

A **container image** packages most of those software answers into an artifact:

```dockerfile
FROM python:3.13

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .

CMD ["python", "server.py"]
```

After `docker build`, the image contains the language runtime, libraries, application files, and default startup command. The team can push a version such as `users-api:1.0` to Amazon Elastic Container Registry (ECR).

An image is not yet executing. The relationship is like an executable file and an operating-system process:

```text
executable file  → running process
container image  → running container
```

A running container needs the stored image plus runtime resources and execution. The image also does not answer every hosting question. It does not necessarily specify the task CPU and memory, network mode, production port mapping, injected configuration and secrets, AWS roles, log destination, volumes, companion containers, or production health check.

An **ECS task definition** supplies that missing runtime contract. A simplified definition might be:

```json
{
  "family": "users-api",
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "123456789012.dkr.ecr.eu-west-2.amazonaws.com/users-api:1.0",
      "portMappings": [{ "containerPort": 8080 }],
      "environment": [
        { "name": "ENVIRONMENT", "value": "production" }
      ]
    }
  ]
}
```

Read it conceptually: run this image, give the task this CPU and memory, expose this container port, and provide this configuration. A real definition can also describe commands, volumes, logging, secrets, health checks, and IAM roles.

Keep the boundary clear:

```text
container image  = WHAT software exists
task definition  = HOW AWS should run that software
```

For example, `users-api:1.0` might be referenced by task definition `users-api:17`, which adds 0.5 vCPU, 1 GiB of memory, port `8080`, roles, secrets, log delivery, and health checks. The image is the artifact contract; the task definition is the runtime contract.

## How Do Task Definition Revisions Become Running Tasks?
<!-- section-summary: Registering stores a numbered task definition revision, and running it creates a task as one execution of that revision. -->

You **register** a task definition with ECS. Registration means “store this versioned runtime contract so that it can be run later.” It does not launch the application.

```text
register task definition ≠ start task
```

Task definitions belong to a **family**. Every registration in the same family gets a new **revision**:

```text
family: users-api

users-api:15   image v3, CPU 512, memory 1024
users-api:16   image v4, CPU 512, memory 1024
users-api:17   image v4, CPU 1024, memory 2048
          ↑
       revision
```

This versioning records changes to the entire runtime contract, not only the image. A CPU increase, role change, secret reference, port correction, or new image can all create a revision. Deployments and rollbacks can therefore select an exact earlier contract.

Once ECS has a definition, it can instantiate a **task**:

```text
task definition users-api:17
        ├──> Task A
        ├──> Task B
        └──> Task C
```

A task is one execution of the definition within an ECS cluster, much as an EC2 instance is one machine created from an AMI. Containers within the task share its lifecycle and, under `awsvpc` networking, can communicate with one another through `localhost`.

An **ECS cluster** is the logical grouping for tasks, services, and capacity. With EC2-based ECS, it can include customer-managed container instances. With Fargate, it remains a grouping and scheduling boundary even though you do not operate a host fleet inside it.

```text
cluster: production
├── service: users-api
├── service: payments-api
├── service: notifications
└── service: frontend
```

Running three tasks manually would produce three copies, but it would not by itself restore a copy after one stops. Long-running services need a desired-state controller.

## How Does an ECS Service Maintain Desired State?
<!-- section-summary: An ECS service continually compares its desired task count and revision with actual tasks, then takes corrective action. -->

An **ECS service** expresses an ongoing intention such as:

```text
task definition: users-api:17
desired count:   3
```

That means “keep approximately three healthy executions of this revision running.” If Task B crashes, the service scheduler notices that actual state no longer matches desired state and launches a replacement.

```text
desired = 3
actual  = 2
difference = 1
action = start one task
```

When three appropriate tasks are healthy, the difference becomes zero. ECS keeps repeating this comparison because reality changes: processes exit, deployments update the revision, operators scale the desired count, and infrastructure becomes unavailable.

```text
desired state
      │
      ▼
compare with actual state
      │
      ▼
is there a difference?
   ├── no  → wait and compare again
   └── yes → take corrective action → compare again
```

This **reconciliation loop** is more important than the act of launching a container. Instead of instructing ECS to “start these three named tasks,” you state the result you want. ECS owns the continuing work of making actual state approach that desired state.

For a load-balanced service, ECS also registers new task targets, waits for health, drains old targets, and replaces failed service tasks. The service tries to reach **steady state**: the desired count is running, the intended task definition revision is active, targets are healthy, and nothing currently needs correction.

### What Does Fargate Provide?
<!-- section-summary: Fargate supplies managed execution capacity for tasks, removing the separate job of provisioning and patching EC2 container hosts. -->

A scheduler cannot execute a task without real CPU, RAM, a kernel, networking, and storage. Some computer must host the containers.

In an EC2-backed ECS cluster, your team supplies that capacity:

```text
ECS cluster
├── EC2 host 1
│   ├── Task A
│   └── Task B
└── EC2 host 2
    └── Task C
```

This creates two capacity questions. The service decides how many tasks should run. The infrastructure layer still needs enough correctly sized, patched, and configured EC2 instances to place those tasks.

Fargate removes much of the host-capacity operation:

```text
ECS: “I need another task with 0.5 vCPU and 1 GiB.”
                     │
                     ▼
Fargate supplies the task compute
                     │
                     ▼
application container runs
```

You do not choose which EC2 host receives the container, log in to that host, or patch its operating system. You specify supported task-level CPU and memory. AWS supplies and operates the underlying host layer.

“Serverless” does not mean no servers exist. It means the service consumer does not provision and operate those servers. You still operate the image, task definition, application resource requests, service, network rules, roles, secrets, logs, health checks, and deployment.

The clean one-sentence model is:

> **ECS decides which container workloads should run; Fargate provides managed compute on which those ECS tasks run.**

Saying “Fargate instead of ECS” mixes the layers. A more precise statement is “ECS with Fargate capacity.” Capacity-provider strategies can choose `FARGATE`, `FARGATE_SPOT`, or combinations and weights. Older “Fargate launch type” language is still common, but capacity providers make the capacity choice explicit.

## How Does a Fargate Task Join the Network?
<!-- section-summary: Each Fargate task receives an ENI and private IP, so subnet routes, security groups, IP capacity, and outbound dependencies directly affect task startup. -->

Fargate uses ECS `awsvpc` networking. Each task gets an **elastic network interface (ENI)** with a private IP address in a selected subnet.

```text
VPC subnet 10.0.1.0/24
├── Task A ENI 10.0.1.21
├── Task B ENI 10.0.1.34
└── Task C ENI 10.0.1.52
```

From the VPC’s perspective, each task is a first-class network participant. Security groups can attach directly to the task ENI. A web task security group can allow TCP `8080` only from the load balancer’s security group instead of from `0.0.0.0/0`.

Because the application is reached through the task IP rather than an EC2 host ID, an Application Load Balancer target group for Fargate and `awsvpc` tasks uses:

```text
target type = ip
```

The registered targets look like `10.0.1.21:8080`, not `i-0123456789abcdef0`.

Production tasks commonly run in private subnets behind a public load balancer. “No public IP” improves the inbound exposure boundary, but it does not remove startup dependencies. A task may need HTTPS access to ECR to retrieve its image, Secrets Manager to retrieve a startup value, CloudWatch Logs to initialize logging, and external services needed by the application.

Private tasks therefore need suitable outbound paths. Depending on the destination and design, that can mean a NAT gateway, VPC endpoints and PrivateLink, or another permitted route. An inaccessible ECR endpoint can produce `CannotPullContainerError`; unreachable secrets or log services can contribute to `ResourceInitializationError`.

Every task also consumes a subnet IP. A subnet that runs out of available addresses can prevent new tasks from starting even if Fargate compute, the image, and task definition are otherwise valid. Networking is part of scheduling, not something added after the task exists.

## How Do Load Balancers and Health Checks Work with ECS?
<!-- section-summary: The ALB distributes traffic and tests external reachability, while ECS also tracks task and optional container health. -->

An Application Load Balancer has two related jobs. It distributes requests among registered targets, and it checks whether each target can serve requests.

Suppose the target group sends `GET /health`:

```text
Task A → 200 OK                  → healthy
Task B → connection refused      → unhealthy
Task C → 500 Internal Error      → unhealthy
```

Only healthy targets should receive ordinary production traffic. This external health is different from the ECS task state.

```text
task state RUNNING
= container process exists
≠ application is useful to network clients
```

A task can be `RUNNING` while `/health` returns `500`, the application listens on the wrong interface, a security group blocks the ALB, or the process listens on the wrong port. Think in layers:

| Layer | Question |
|---|---|
| Compute | Could the task be provisioned and started? |
| Process | Is the essential container process still running? |
| Container health | Does the local health command succeed? |
| ALB target health | Can the load balancer reach the task and receive an accepted response? |

For a load-balanced ECS service, target-group health contributes to service health. If an essential container also defines a container health check, both the container and target need to become healthy.

Startup timing matters. Imagine the process needs 25 seconds to load configuration, connect to its database, initialize its framework, and warm a cache. If ECS reacts to failed health checks after two seconds, each new task can be killed before it is able to become ready:

```text
start → early health failure → stop → replacement starts
  ↑                                      │
  └──────────────────────────────────────┘
```

The service setting `healthCheckGracePeriodSeconds` lets ECS ignore eligible health failures for a startup window. A grace period should cover legitimate initialization, not hide an application that never becomes healthy.

Two especially common network failures look like application failures. First, the process may bind to `127.0.0.1:8080`. A command inside the container can reach it through localhost, but connections arriving at the task ENI cannot. The application usually needs to bind to an externally reachable interface such as `0.0.0.0:8080`.

Second, the task security group may lack inbound TCP `8080` from the ALB security group. The task and container remain `RUNNING`, but every load-balancer health check is blocked. In both cases, expanding random ECS capacity settings misses the failed network contract.

![The container-to-service map shows how image, task definition, service, target group, logs, roles, and networking connect into one ECS release](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ecs-and-fargate/container-to-service-map.png)

*A task reaches users only after its artifact, runtime, compute, network, and health contracts all succeed.*

### Why Does an ECS Task Need Two IAM Roles?
<!-- section-summary: The execution role authorizes ECS startup operations, while the task role authorizes AWS API calls made by application code. -->

A Fargate task commonly refers to two IAM roles that solve different problems.

The **task execution role** is used by ECS and Fargate infrastructure while preparing and operating the task. Common responsibilities include pulling a private image from ECR, obtaining secrets or parameters referenced for injection, and sending output through the `awslogs` log driver.

```text
ECS/Fargate infrastructure
   ├── pull image from ECR
   ├── fetch referenced startup secret
   └── initialize CloudWatch log delivery
           uses execution role
```

The **task role** is supplied to the containers as their application identity. When the program calls an AWS SDK operation such as `s3:GetObject`, `dynamodb:PutItem`, or `events:PutEvents`, those requests use task-role credentials.

```text
application code
      │ AWS SDK request
      ▼
task-role temporary credentials
      │
      ▼
AWS service authorization
```

The easiest distinction is:

```text
execution role: Can ECS/Fargate launch and support this task?
task role:      What may my application do after it starts?
```

This boundary also directs debugging. An ECR image-pull denial points toward the execution role or image repository policy. An `AccessDenied` produced when the running application writes to S3 points toward the task role.

## How Should Tasks Receive Secrets and Send Logs?
<!-- section-summary: Sensitive runtime values should be referenced from a secret store, while stdout and stderr should leave disposable tasks through centralized logging. -->

Production database passwords and API keys should not be baked into the image. If the secret becomes part of an image layer, anyone able to retrieve the image may be able to recover it, and rotating the credential requires rebuilding the artifact.

A safer arrangement keeps code and credentials separate:

```text
container image
└── application, no production password

task definition
└── reference to a secret ARN

Secrets Manager
└── current secret value
```

During task startup, infrastructure uses the execution role to retrieve the referenced value and inject it into the container. The application then reads the configured environment variable or other supported delivery mechanism.

Injection has an important lifecycle consequence: changing the value in Secrets Manager does not rewrite the environment of an already running container. Existing tasks continue with the value they received at startup. Launch new tasks—often by forcing or performing a deployment—to pick up the changed value.

Containers should generally write application records to standard output and standard error:

```text
INFO server listening on :8080
INFO database connection established
ERROR request processing failed
```

The task definition’s `awslogs` configuration forwards those streams to CloudWatch Logs. Fargate hosts are not machines you administer through SSH, and tasks are replaceable, so evidence must survive outside the task.

Keep orchestration and application evidence separate:

```text
ECS service events
= scheduler view: placement, starts, health failures, deployment state

CloudWatch application logs
= process view: startup errors, dependency failures, request errors
```

A service event such as “target failed health checks” tells you what ECS observed. A log such as `DATABASE_URL missing` tells you why the process could not satisfy that health contract. Most incidents need both views.

## How Does an ECS Rolling Deployment Work?
<!-- section-summary: A deployment updates the service to a new task definition revision and gradually replaces old tasks while health and rollout controls protect capacity. -->

Trace a complete release. A pipeline builds image `users-api:v7`, pushes it to ECR, registers task definition `users-api:42` that references the image, and updates the service from revision 41 to revision 42.

Registering revision 42 alone changes no running service. The update tells ECS to reconcile production toward the new contract.

```text
source → build image v7 → push ECR
                          ↓
                register users-api:42
                          ↓
             update service from :41 to :42
                          ↓
                scheduler starts new tasks
                          ↓
            Fargate provides networked compute
                          ↓
                 ALB tests target health
                          ↓
                healthy tasks receive traffic
```

If desired count is four, stopping all four old tasks before starting new ones creates a zero-capacity gap. A rolling deployment overlaps the revisions:

```text
old old old old
old old old old + new new
old old + new new new new
new new new new
```

Two service controls shape the overlap: `minimumHealthyPercent` and `maximumPercent`. With desired count 4, minimum healthy 100%, and maximum 200%, ECS tries to retain at least four healthy tasks while allowing up to eight total tasks during deployment. That headroom can let it start four new tasks before removing old healthy tasks.

Health makes the rollout application-aware. A new container may reach `RUNNING`, but if the ALB gets `500` from `/health`, the new target does not become a healthy replacement. ECS should not count a merely existing process as successful production capacity.

Repeatedly starting and replacing a bad revision can otherwise continue without progress. The ECS **deployment circuit breaker** asks whether the deployment is moving toward a healthy steady state. It can mark the deployment failed and, when rollback is enabled, return the service to the most recent successfully completed deployment.

```text
revision 41 COMPLETED
        ↓
revision 42 starts
        ↓
new tasks repeatedly fail
        ↓
deployment FAILED
        ↓ automatic rollback, if configured
revision 41 restored
```

Rollback becomes selection of the last known-good task definition rather than a manual attempt to reverse every changed setting. Record the image digest and task definition revision together so the selected revision actually identifies an immutable artifact.

![The rollout summary connects image digest, task definition revision, service deployment, target health, logs, and previous revision evidence](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ecs-and-fargate/ecs-rollout-evidence-summary.png)

*A healthy rollout moves the service from one known steady state to another without dropping required capacity.*

### How Do You Debug a Failed ECS Service?
<!-- section-summary: Debug ECS by tracing the startup and traffic dependency chain until you find the first contract that failed. -->

Avoid changing random service settings when a deployment fails. Trace the dependencies in order:

```text
task definition
      ↓
Fargate capacity and ENI allocation
      ↓
image retrieval
      ↓
secret and log initialization
      ↓
container process
      ↓
application startup
      ↓
container health
      ↓
ALB network path
      ↓
ALB health response
      ↓
service steady state
```

The first failed layer usually causes every failure below it. A practical symptom map is:

| Symptom | First evidence to inspect |
|---|---|
| Task remains `PENDING` | Service events, Fargate provisioning, subnet IP capacity, task settings |
| Task quickly becomes `STOPPED` | Stopped reason, container reason, exit code, execution role, image, secrets |
| `CannotPullContainerError` | Image repository and tag/digest, ECR permission, NAT or ECR endpoints |
| `ResourceInitializationError` | Secret, ECR, logging, and startup network dependencies |
| Container exits with code 1 | Command, runtime configuration, and application logs |
| Container is out of memory | Task-definition memory and application usage |
| Task is `RUNNING`, ALB says unhealthy | App binding, security groups, ports, health path, readiness |
| ALB health check times out | Network path, listener, application hang |
| ALB receives 404 | Wrong health-check path or routing |
| ALB receives 500 | Application, configuration, or dependency failure |
| Works locally but not in ECS | Environment, architecture, roles, secrets, or network dependencies |
| Service continually replaces tasks | Service events, stopped reasons, target health, logs |

Consider a deployment of revision 42. The service wants three tasks, but only two run. ECS events say a new task failed health checks. A stopped-task description reports `EssentialContainerExited` and exit code `1`. CloudWatch Logs then reports `DATABASE_URL is missing`.

The evidence moves from controller to cause:

```text
service below desired count
       ↓ because
replacement task stopped
       ↓ because
essential application container exited
       ↓ because
startup configuration was missing
```

If instead the task is `RUNNING` and local `curl localhost:8080` succeeds while the ALB times out, inspect whether the process binds only to `127.0.0.1`, whether the target group uses port `8080` and target type `ip`, and whether the task security group permits that port from the ALB security group.

The response should repair the failed contract. Correct the task definition and register a new revision, fix the relevant role or endpoint, or roll back to the known-good revision. Editing a running task is neither durable nor a valid repair path because ECS will replace that task.

![The ECS checklist summarizes the evidence to check across task definition, image, service events, target health, logs, roles, and capacity](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ecs-and-fargate/ecs-fargate-checklist.png)

*Service events explain orchestration; task state and logs explain execution; target health explains network-visible readiness.*

## How Should You Think About ECS as a Whole?
<!-- section-summary: ECS hosting is a stack of artifact, runtime, availability, compute, and traffic contracts continuously reconciled by the control plane. -->

The object relationships fit into one chain:

```text
ECR stores
   ↓
container image — “the software”
   ↓ referenced by
task definition — “how to run it”
   ↓ instantiated as
task — “one running copy”
   ↑ maintained by
service — “keep N healthy copies”
   ↓ controlled by
ECS — “reconcile desired and actual workloads”
   ↓ requests compute from
Fargate — “managed execution capacity”
   ↓ gives each task
ENI + private IP
   ↓ registers with
ALB target group
   ↓ receives traffic through
ALB
   ↓
users
```

Memorize six nouns before the many settings:

| Concept | Plain meaning |
|---|---|
| Image | Packaged software |
| Task definition | Versioned runtime contract |
| Task | One execution of the contract |
| Service | Desired-state controller for long-running tasks |
| ECS | Orchestrator controlling the objects |
| Fargate | Managed compute that executes tasks |

Then attach ALB for traffic and external health, VPC for connectivity, IAM for permissions, secret stores for sensitive startup configuration, and CloudWatch Logs for durable process evidence.

One final model treats the system as five stacked contracts:

```text
1. Artifact:     “This is the software.”           → image
2. Runtime:      “Run it with these settings.”     → task definition
3. Availability: “Keep three healthy copies.”      → service
4. Compute:      “Each copy needs these resources.”→ Fargate
5. Traffic:      “Send requests to healthy copies.”→ ALB
```

When a service deployment fails, ask which contract reality could not satisfy. Was the artifact unavailable? Could the execution role and network retrieve it? Could Fargate initialize the task? Did the process stay alive? Did the task obtain configuration? Did it listen on the expected interface and port? Could the ALB reach it? Did the health path return success?

Reasoning from the first failed contract turns ECS from a wall of product settings into a distributed control system that converts versioned container artifacts into reliable running services.

## Check Your Understanding

:::expand[What Problem Do ECS and Fargate Solve?]{kind="recap"}
ECS coordinates desired container workloads, while Fargate supplies managed compute on which ECS can run them.

They solve different layers. ECS orchestrates workloads and desired state. Fargate is one managed capacity option on which ECS can execute tasks.

An image packages software, while a task definition is the versioned contract describing how ECS should run that software.

The image packages software, the task definition describes its runtime, a task executes one copy, the service maintains the desired copies, ECS reconciles state, Fargate supplies compute, and the ALB sends traffic to healthy targets.
:::

:::expand[How Do Task Definition Revisions Become Running Tasks?]{kind="recap"}
Registering stores a numbered task definition revision, and running it creates a task as one execution of that revision.

An image is a stored artifact containing software. It becomes a running container only when a runtime allocates resources and starts it, just as an executable file becomes useful when the operating system creates a process.

Registration stores a numbered runtime-contract revision in ECS. Running or scheduling that definition instantiates it as a task. Registration alone changes no running application.
:::

:::expand[How Does an ECS Service Maintain Desired State?]{kind="recap"}
An ECS service continually compares its desired task count and revision with actual tasks, then takes corrective action.

It compares the desired task definition and count with actual running and healthy tasks. When they differ, the scheduler starts, replaces, or stops tasks until the service approaches steady state.

Fargate supplies managed execution capacity for tasks, removing the separate job of provisioning and patching EC2 container hosts.
:::

:::expand[How Does a Fargate Task Join the Network?]{kind="recap"}
Each Fargate task receives an ENI and private IP, so subnet routes, security groups, IP capacity, and outbound dependencies directly affect task startup.

During startup it may need to pull an image from ECR, retrieve a secret, and initialize CloudWatch logging. It may also call external dependencies at runtime, so it needs permitted routes through NAT, VPC endpoints, or another appropriate path.

With `awsvpc`, every task receives its own ENI and private IP. The load balancer registers that task IP and application port rather than an underlying EC2 host ID.
:::

:::expand[How Do Load Balancers and Health Checks Work with ECS?]{kind="recap"}
The ALB distributes traffic and tests external reachability, while ECS also tracks task and optional container health.

`RUNNING` says the task and essential process exist. The application can still return errors, listen only on localhost, use the wrong port, fail a dependency, or be blocked from the ALB, so external health may fail.

The execution role authorizes ECS startup operations, while the task role authorizes AWS API calls made by application code.

The execution role lets ECS and Fargate pull images, retrieve injected startup values, and deliver logs. The task role authorizes AWS API calls made by the running application code.
:::

:::expand[How Should Tasks Receive Secrets and Send Logs?]{kind="recap"}
Sensitive runtime values should be referenced from a secret store, while stdout and stderr should leave disposable tasks through centralized logging.
:::

:::expand[How Does an ECS Rolling Deployment Work?]{kind="recap"}
A deployment updates the service to a new task definition revision and gradually replaces old tasks while health and rollout controls protect capacity.

The value is retrieved and placed into the container during startup. Updating the backing secret does not rewrite a running process environment; replacement tasks must start to receive the new value.

Minimum healthy percent protects available capacity, maximum percent limits temporary overlap, and container or ALB health determines when new tasks qualify as replacements for old healthy tasks.

Debug ECS by tracing the startup and traffic dependency chain until you find the first contract that failed.

Trace the dependency chain and find its earliest failure: definition, compute and ENI, image, startup dependencies, process, application health, ALB connectivity, target health, then service steady state.
:::

:::expand[How Should You Think About ECS as a Whole?]{kind="recap"}
ECS hosting is a stack of artifact, runtime, availability, compute, and traffic contracts continuously reconciled by the control plane.
:::

## References

- [AWS Fargate for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- [Amazon ECS task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)
- [TaskDefinition API](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_TaskDefinition.html)
- [Architect an Amazon ECS solution](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-configuration.html)
- [Amazon ECS services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html)
- [ECS launch types and capacity providers](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-launch-type-comparison.html)
- [Amazon ECS clusters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/clusters.html)
- [Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)
- [ECS awsvpc networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-networking-awsvpc.html)
- [Amazon ECS service definition parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html)
- [Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html)
- [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)
- [Pass Secrets Manager secrets to ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [ECS deployment circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)
- [Amazon ECS stopped task errors](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/stopped-task-error-codes.html)
