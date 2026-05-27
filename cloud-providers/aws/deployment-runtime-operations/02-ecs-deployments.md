---
title: "ECS Deployments"
description: "Deploy an ECS service by following the image, task definition, service update, target health, deployment evidence, and rollback path."
overview: "An ECS deployment is the moment a new container image becomes running tasks behind real traffic. This article follows that path from ECR image to task definition revision, service update, target health, and rollback."
tags: ["ecs", "ecr", "deployments", "alb"]
order: 2
id: article-cloud-providers-aws-deployment-runtime-operations-deploying-and-updating-an-ecs-service
aliases:
  - deploying-and-updating-an-ecs-service
  - cloud-providers/aws/deployment-runtime-operations/deploying-and-updating-an-ecs-service.md
---

## Table of Contents

1. [The Outage of the Hard Stop](#the-outage-of-the-hard-stop)
2. [The ECS Service Controller](#the-ecs-service-controller)
3. [ECR Images: Deployable Candidates](#ecr-images-deployable-candidates)
4. [Versioning the Recipe: Task Definitions](#versioning-the-recipe-task-definitions)
5. [The Rolling Update Deployment Policy](#the-rolling-update-deployment-policy)
6. [Target Health Checks and Traffic Trust](#target-health-checks-and-traffic-trust)
7. [Deployment Evidence Checklist](#deployment-evidence-checklist)
8. [The Mechanics of Rollback](#the-mechanics-of-rollback)
9. [Operational Deployment Tradeoffs](#operational-deployment-tradeoffs)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Outage of the Hard Stop

When developing applications locally, releasing a new code version is simple. You run `docker stop api` to terminate the active container process, followed immediately by `docker run api` to boot the new container image. This hard stop takes only five seconds, which is completely unnoticeable during standalone development.

If you attempt this brute-force restart in a production environment serving active customer traffic, you will trigger an immediate operational outage. The moment the old container process is terminated, thousands of active TCP connections are severed. Users checking out will see raw gateway timeout pages, network reset errors, and failed database transactions. Even worse, if the new image fails to boot due to a missing environment configuration, your entire service remains completely offline.

To release software in production safely, you must coordinate a zero-downtime rolling deployment. This process slowly provisions fresh container tasks, verifies their application health, shifts user traffic to the new instances, and only terminates the old containers when the new version is fully trusted.

## The ECS Service Controller

In an Amazon ECS cluster, the zero-downtime rolling update is managed by the ECS Service Controller. The service controller is a persistent software loop cabled directly to an Application Load Balancer.

For our application, `devpolaris-orders-api`, the service definition declares the desired state:

Orchestrator Coordinates and Service Parameters:

| Coordinate Parameter | Operational Value |
| :--- | :--- |
| **ECS Cluster** | `production-apps` |
| **Active Task Definition** | `orders-api:42` |
| **Desired Task Count** | `4` |
| **Load Balancer Target Group** | `tg-orders-api-prod` |
| **Deployment Ingress Port** | `3000` |
| **Deployment Strategy** | Rolling Update |

The service controller owns the desired state. When you deploy a release, you do not update the container process directly. You update the service controller to use a new Task Definition revision. The controller then manages the progressive replacement of old container tasks with new ones.

## ECR Images: Deployable Candidates

A container image is the immutable package containing your application files. Before an ECS deployment begins, your build system compiles the image and pushes it to an Amazon ECR repository.

The image should be clearly identified. While developers often use mutable tags like `latest` or `production` for convenience, these tags can move. If your auto-scaling policies launch new tasks while a tag is being updated, you can end up with different tasks running different versions of the code in the same cluster. 

To maintain strict operational tracking, every release record must document the immutable SHA256 digest of the image:

Release Artifact Evidence Matrix:

| Registry Attribute | Example Value | Operational Value |
| :--- | :--- | :--- |
| **Git Commit Reference** | `git-4f22cd8` | Connects the artifact to the exact source commit. |
| **Image Tag** | `v2.4.1` | The human-readable release identifier. |
| **Image SHA256 Digest** | `sha256:2b91f1...` | The physical, immutable signature of the built bytes. |
| **ECR Image Scan Status** | `MUTUAL_TRUST_PASS` | Confirms the image is free of severe CVE vulnerabilities. |

The image alone is not enough to run a service. It has no knowledge of environment configurations, Secrets Manager passwords, or load balancer route rules. Those live around the image in the Task Definition.

## Versioning the Recipe: Task Definitions

A Task Definition is the blueprint recipe ECS uses to launch tasks. When the blueprint changes (such as updating an image digest or modifying an environment variable), ECS registers a new, numbered Task Definition revision.

Let us inspect the JSON structure of our application's Task Definition recipe:

```json
{
  "family": "orders-api",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "111122223333.dkr.ecr.eu-west-2.amazonaws.com/orders-api@sha256:2b91f1...",
      "portMappings": [
        {
          "containerPort": 3000,
          "hostPort": 3000,
          "protocol": "tcp"
        }
      ],
      "essential": true,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/aws/ecs/orders-api-prod",
          "awslogs-region": "eu-west-2",
          "awslogs-stream-prefix": "api"
        }
      }
    }
  ]
}
```

The Task Definition declares all structural coordinates:

* `family`: The logical name grouping revisions of this workload.
* `image`: Explicitly references the ECR repository using the immutable SHA256 digest instead of a mutable tag, preventing tag drift.
* `portMappings`: Declares that the container process listens on port 3000. Fargate maps this internal port directly to the host network interface.
* `logConfiguration`: Cables the container's standard output stream to CloudWatch Logs under the prefix `api`.

## The Rolling Update Deployment Policy

When the ECS service is updated to use a new Task Definition revision, the rolling update begins. The controller manages the rate of task replacement using two percentage-based boundaries:

* **Minimum Healthy Percent**: The minimum number of healthy tasks that must remain active and serving traffic during the deployment, relative to the desired count.
* **Maximum Percent**: The upper boundary on the number of concurrent tasks allowed to run during the deployment.

Let us visualize a rolling update execution matrix where the desired count is `4`, the `minimumHealthyPercent` is `100%`, and the `maximumPercent` is `200%`:

```text
Desired Count: 4  |  Min Healthy: 4 (100%)  |  Max Count: 8 (200%)

Step 1: Start 4 new tasks (Revision 43) in parallel.
  Active Tasks: [Old1, Old2, Old3, Old4] + [New1, New2, New3, New4] (Total: 8)

Step 2: Wait for ALB Target Group to mark all 4 new tasks healthy.
  Traffic: [Old1, Old2, Old3, Old4] and [New1, New2, New3, New4] share load.

Step 3: ALB deregisters Old tasks. Connection draining window begins.
  Traffic: ALB routes all new requests exclusively to [New1, New2, New3, New4].

Step 4: Deregistration delay completes. Old tasks receive SIGTERM.
  Active Tasks: [New1, New2, New3, New4] (Total: 4) - Deployment Complete.
```

By enforcing `minimumHealthyPercent=100%`, the service controller guarantees that active checkout capacity never drops below the desired baseline. If the new task definition fails to boot, the old tasks continue to serve traffic, preventing service outages.

## Target Health Checks and Traffic Trust

The service controller does not assume a task is healthy simply because the container process is running. It relies on the Application Load Balancer target group to verify health before routing customer packets.

Let us inspect the recommended production parameters for our ALB target group:

Target Group Health Check Configurations:

| Parameter Key | Recommended Production Value | Operational Job |
| :--- | :--- | :--- |
| **Health Check Path** | `/healthz` or `/ready` | Dedicated route that returns HTTP 200 when ready. |
| **Health Check Interval** | `15` seconds | The duration between consecutive probes sent to the task. |
| **Response Timeout** | `5` seconds | The maximum time the load balancer waits for a response. |
| **Healthy Threshold** | `3` consecutive successes | Proves the process is stable before routing traffic. |
| **Unhealthy Threshold** | `2` consecutive failures | Rapidly drops unhealthy nodes to protect customer traffic. |
| **Grace Period** | `60` seconds | The startup window where health failures are ignored. |

The Grace Period is essential. A Node.js or Java application needs time to open database pools, load cache keys, and warm up its runtime. If the grace period is shorter than the application's boot duration, the service controller will mark the new tasks unhealthy and terminate them before they are ready, entering a continuous restart loop.

## Deployment Evidence Checklist

Deployments can fail in several distinct ways. To debug a failed deployment, you must execute a terminal session to query the service controller for events:

```bash
$ aws ecs describe-services \
    --cluster "production-apps" \
    --services "orders-api-prod"
```

The terminal returns the active service definition, including chronological system events:

```json
{
  "services": [
    {
      "serviceName": "orders-api-prod",
      "status": "ACTIVE",
      "desiredCount": 4,
      "runningCount": 2,
      "pendingCount": 2,
      "deployments": [
        {
          "id": "ecs-svc/123456789",
          "status": "PRIMARY",
          "taskDefinition": "arn:aws:ecs:eu-west-2:111122223333:task-definition/orders-api:43",
          "rolloutState": "IN_PROGRESS"
        }
      ],
      "events": [
        {
          "id": "e1",
          "createdAt": 1779836395.042,
          "message": "(service orders-api-prod) (deployment ecs-svc/123456789) has started 2 tasks."
        },
        {
          "id": "e2",
          "createdAt": 1779836410.120,
          "message": "(service orders-api-prod) (task ecs-task-b-8a91) failed container health checks."
        }
      ]
    }
  ]
}
```

This output provides critical diagnostic evidence:

* `desiredCount` vs. `runningCount`: Shows that the service controller is stalled, holding tasks in a pending state due to execution failures.
* `rolloutState`: Tracks the progress of the primary deployment revision.
* `events`: Chronological system events revealing exactly why the deployment stalled, such as container health check failures.

## Under-the-Hood: Connection Draining and SIGTERM Mechanics

When the Application Load Balancer deregisters an old container task during a rolling update, it does not sever active connections. Instead, it enters a connection draining window, officially called deregistration delay.

During this window (defaulting to 300 seconds, but recommended to set to 30 seconds for web APIs), the ALB stops routing new HTTP requests to the task, while keeping established TCP sockets open to allow in-flight checkouts to complete safely.

Once the deregistration delay window expires, the ECS agent terminates the container process using a strict two-stage Unix signal sequence:

1. **SIGTERM (Signal Terminate)**: ECS sends a `SIGTERM` to the application process. The application must intercept this signal, stop accepting new requests, flush internal message queues, close open database connections, and exit cleanly.
2. **SIGKILL (Signal Kill)**: If the application process fails to exit within a configured grace window (defined by `stopTimeout`, typically 30 seconds), the container runtime sends a `SIGKILL` directly to the kernel, terminating the process immediately.

If your application code does not handle `SIGTERM` or has an infinite loop inside its shutdown hook, Fargate will force kill the process, potentially severing active transactions and corrupting state.

## The Mechanics of Rollback

Rollback is the recovery operation designed to restore the service to a known-good configuration. For ECS, this is achieved by updating the service to use the previous, stable Task Definition revision:

```bash
$ aws ecs update-service \
    --cluster "production-apps" \
    --service "orders-api-prod" \
    --task-definition "orders-api:42"
```

Executing this command initiates a rolling update in reverse. The service controller launches tasks from the stable `orders-api:42` blueprint, verifies their health behind the ALB target group, shifts traffic, and terminates the bad version.

If you have configured the ECS Deployment Circuit Breaker, the orchestrator handles rollbacks automatically. The circuit breaker monitors task launch failures. If the primary deployment tasks continuously fail health checks or exit, the circuit breaker marks the deployment failed, halts the rollouts, and updates the service back to the previous stable revision automatically, minimizing user impact.

## Operational Deployment Tradeoffs

Deployment configurations require balancing speed, cost, and operational risk.

Starting more replacement tasks in parallel speeds up deployments, but it temporarily increases capacity costs and can saturate downstream databases. Keeping more old tasks active protects availability, but requires sufficient memory headroom in the cluster.

Deployment Strategy Tradeoffs:

| Strategic Choice | Operational Advantage | Operational Risk |
| :--- | :--- | :--- |
| **Fast Rolling Update** | Shorter release window, rapid code shipping. | Less time to observe and capture slow-forming memory leaks. |
| **Conservative Overlap** | High availability, zero connection loss. | Requires cluster memory headroom and database connection capacity. |
| **Deployment Circuit Breaker** | Automated failure recovery, no manual paging. | Only detects immediate boot failures; misses logic bugs. |
| **Strict Target Health Checks** | Prevents bad tasks from receiving traffic. | Can trigger cascading restart loops if checks are fragile. |

## Putting It All Together

Operating a resilient deployment pipeline requires mastering orchestrator updates, health boundaries, and rollback targets:

* **Always Deploy Revisions**: ECS services deploy Task Definition revisions; never attempt to deploy container images directly.
* **Anchor to SHA256 Digests**: Use immutable image digests inside task definitions to completely prevent tag drift.
* **Enforce Safe Capacity Boundaries**: Set `minimumHealthyPercent` to 100% in production to protect customer throughput during updates.
* **Align Grace Periods**: Match target group grace periods to your application's actual startup times to prevent termination loops.
* **Design Elegant Shutdowns**: Intercept `SIGTERM` in your code to drain connection pools and close sockets cleanly.
* **Enforce Automated Circuit Breakers**: Enable the deployment circuit breaker to automate rollbacks when new tasks fail to boot.

## What's Next

We have covered the mechanics of zero-downtime rolling updates, target health checking, and rollback pathways. However, a container cannot boot successfully without environment configurations and credentials. In the next article, we will go deep into configurations and secrets, delivering variables securely to tasks, using Secrets Manager references, and evaluating task execution roles vs. task application roles.

---

**References**

* [Amazon ECS Services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_services.html) - AWS developer guide to compute controllers and load balancer targets.
* [Amazon ECS Task Definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html) - Documentation on versioning container parameters and resource boundaries.
* [Task Definition Parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html) - Technical reference for image, port, role, log, and memory parameters.
* [Amazon ECS Application Auto Scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html) - Guide to configuring horizontal scale limits.
