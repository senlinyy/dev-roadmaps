---
title: "Rolling Deployments"
description: "Deploy updates gradually across distributed container services with zero-downtime, healthy resource buffers, and readiness probe gates."
overview: "Replacing an entire application cluster at once introduces severe release risk. Learn how rolling deployments replace containers wave-by-wave, how minimum and maximum healthy capacities prevent resource starvation, and how to gate deployments using automated readiness probes."
tags: ["rolling-deployments", "ecs", "kubernetes", "zero-downtime"]
order: 1
id: article-cicd-deployment-strategies-rolling-deployments-and-rollbacks
aliases:
  - /cicd/deployment-strategies/rolling-deployments-and-rollbacks
---

## Table of Contents

1. [The Release Problem](#the-release-problem)
2. [The Rolling Deployment Shape](#the-rolling-deployment-shape)
3. [Capacity During the Rollout](#capacity-during-the-rollout)
4. [Readiness Before Traffic](#readiness-before-traffic)
5. [Automation and Stop Rules](#automation-and-stop-rules)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## The Release Problem
<!-- section-summary: A rolling deployment protects the service by replacing a small part of the fleet at a time. -->

Imagine we run the checkout API for an online store. Ten application containers serve traffic behind a load balancer. Version `2026.06.13.1` works well, and we want to ship version `2026.06.13.2` with a new discount calculation. The risky move would be stopping all ten old containers, starting ten new containers, and hoping the new version becomes healthy before users notice.

That style creates a very simple failure. During the gap, the load balancer has no healthy targets. Every checkout request waits, retries, or fails. Even if the gap lasts one minute, that one minute can create failed payments, support tickets, and a very loud incident channel.

A **rolling deployment** means the platform replaces the running service in small waves. It starts a few new tasks or pods, waits until they pass health checks, sends traffic to them, and then removes a few old ones. The key idea is **overlap**. Old version and new version run together during the rollout so the service keeps enough healthy capacity for users.

This article follows one release all the way through. We will use Kubernetes and Amazon ECS examples because both show the same release idea with slightly different names. Kubernetes talks about Deployments, ReplicaSets, pods, `maxSurge`, and `maxUnavailable`. ECS talks about services, tasks, `maximumPercent`, `minimumHealthyPercent`, target group health, and deployment circuit breakers. Different words, same practical concern: keep healthy capacity while replacing code.

The first thing to understand is the shape of the rollout. Once that shape makes sense, the capacity numbers and readiness checks become much easier to place.

![Rolling deployment wave replacement showing old version containers, new version containers, health checks, and traffic staying on](/content-assets/articles/article-cicd-deployment-strategies-rolling-deployments-and-rollbacks/rolling-wave-replacement.png)

*A rolling deployment keeps the old version serving traffic while the new version joins in small healthy waves.*

## The Rolling Deployment Shape
<!-- section-summary: The platform creates new instances, proves they are healthy, and then removes old instances in repeated waves. -->

A **deployment instance** is one running copy of the application. In Kubernetes, that copy is usually a pod. In ECS, that copy is usually a task. If the checkout service runs ten copies, the rollout controller has ten old instances to replace.

In a rolling deployment, the platform follows a loop:

1. Start a small number of new instances from the new image.
2. Wait for those instances to become healthy.
3. Add them to traffic.
4. Remove a matching number of old instances.
5. Repeat until every active instance runs the new version.

Here is a small Kubernetes Deployment for the checkout API:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-api
spec:
  replicas: 10
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2
      maxUnavailable: 1
  selector:
    matchLabels:
      app: checkout-api
  template:
    metadata:
      labels:
        app: checkout-api
        version: "2026.06.13.2"
    spec:
      containers:
        - name: checkout-api
          image: registry.example.com/checkout-api:2026.06.13.2
          ports:
            - containerPort: 8080
```

The `replicas: 10` line says the service wants ten running pods. The `RollingUpdate` strategy tells Kubernetes to move toward the new pod template gradually. The `maxSurge: 2` value lets Kubernetes run up to two extra pods above the desired count during the rollout. The `maxUnavailable: 1` value lets at most one desired pod be unavailable during the rollout.

The same idea appears in ECS with different field names. An ECS service can use a rolling update deployment type and set `minimumHealthyPercent` and `maximumPercent`. For a service with ten desired tasks, `minimumHealthyPercent: 90` means ECS should keep at least nine healthy tasks during the deployment. `maximumPercent: 120` means ECS can run up to twelve tasks while it starts the replacement version.

Those numbers are the next thing we need to talk about because the rolling shape only works when the service has enough room to run old and new versions at the same time.

## Capacity During the Rollout
<!-- section-summary: Rolling deployments need a capacity buffer so new instances can start before old instances disappear. -->

**Capacity** means the compute room the service has available: CPU, memory, node slots, task slots, database connections, and load balancer target slots. A rolling deployment consumes extra capacity for a short time because old and new instances overlap.

Let's stay with the checkout API. Ten old containers are already serving traffic. The rollout starts two new containers. For a few minutes, the cluster needs room for twelve containers. If the cluster has only enough CPU and memory for exactly ten, the new containers may sit pending. The rollout can stall because the platform has no room to create the healthy replacement instances it needs.

That is why teams choose rollout numbers together with infrastructure capacity. Here is a simple planning table for ten replicas:

| Setting | What it allows | Highest running count | Lowest healthy target |
|---|---|---:|---:|
| `maxSurge: 1`, `maxUnavailable: 0` | Slow and cautious | 11 | 10 |
| `maxSurge: 2`, `maxUnavailable: 1` | Common balanced rollout | 12 | 9 |
| `maxSurge: 5`, `maxUnavailable: 2` | Faster rollout with more burst capacity | 15 | 8 |

The first option protects user capacity strongly but moves slowly. The second option gives the platform a little room to move without draining too much live traffic capacity. The third option finishes faster, but the cluster and database must handle more simultaneous new containers and a lower healthy floor.

In real production, platform teams usually connect this to autoscaling. If a Kubernetes cluster runs close to full, the cluster autoscaler may need time to add nodes before the new pods can schedule. If ECS runs on EC2 capacity providers, the Auto Scaling group may need room to launch more instances. If ECS runs on Fargate, the compute capacity feels simpler, but the application can still hit database connection limits, outbound NAT limits, or load balancer health check delays.

A practical rollout checklist usually includes these questions:

| Check | Why it matters |
|---|---|
| Can the cluster run the desired surge count? | The new version needs room before old instances drain. |
| Can the database handle overlap? | Twelve app instances may open more connections than ten. |
| Can the load balancer register targets quickly enough? | New instances need traffic only after health checks pass. |
| Can autoscaling react before the rollout times out? | Scheduling delays can look like release failures. |

![Rolling deployment capacity buffer showing desired count, surge capacity, minimum healthy floor, database connections, and load balancer targets](/content-assets/articles/article-cicd-deployment-strategies-rolling-deployments-and-rollbacks/rolling-capacity-buffer.png)

*The rollout needs temporary room for old and new containers, plus enough database and load balancer capacity to carry the overlap.*

Capacity keeps the service alive during the wave. Readiness answers the next question: whether the new version can safely receive user traffic.

## Readiness Before Traffic
<!-- section-summary: Readiness checks tell the platform when a new instance can receive real user requests. -->

**Readiness** means the application can handle real traffic now. A process can be running while the app still warms caches, opens database pools, loads configuration, runs migrations, or waits for a downstream dependency. The platform needs a signal that means "this copy can answer user requests."

In Kubernetes, a **readiness probe** checks each pod. When the readiness probe fails, Kubernetes removes that pod from Service endpoints and keeps normal traffic away from it. A **startup probe** gives slow-starting containers extra time before the platform treats the startup as failed. A **liveness probe** answers a different question: whether the container should restart because it got stuck.

Here is a useful probe setup for the checkout API:

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 3
startupProbe:
  httpGet:
    path: /startup
    port: 8080
  periodSeconds: 5
  failureThreshold: 24
livenessProbe:
  httpGet:
    path: /live
    port: 8080
  periodSeconds: 10
  failureThreshold: 3
```

The `/startup` endpoint should become healthy after the application finishes slow boot work. The `/ready` endpoint should check things the app needs for requests, like configuration loaded, database pool created, and required dependencies reachable. The `/live` endpoint should stay simple, because a liveness failure restarts the container. A liveness check that depends on a flaky downstream service can create restart loops during an unrelated outage.

In ECS behind an Application Load Balancer, target group health checks play a similar role. The load balancer calls a path like `/ready` and sends traffic only to targets that pass the health check. ECS also has container health checks and deployment health behavior. The important production rule stays the same: the new task should join traffic only after the application has finished the work needed to serve requests.

Good readiness checks also protect rollback. If version `2026.06.13.2` starts but fails to connect to the payment database, the new containers fail readiness. The platform keeps traffic on the old containers and the release stops before customers hit the bad version. This is much calmer than discovering the problem after half the fleet has already changed.

Now we have the rollout loop, enough capacity, and readiness gates. The final piece is automation that watches the rollout and stops it when the signals go bad.

## Automation and Stop Rules
<!-- section-summary: A rollout needs automatic stop rules so the pipeline can halt before a bad version spreads. -->

A **stop rule** is a clear condition that tells the deployment system to pause, fail, or roll back. People often notice a bad rollout too late because they wait for customer reports or stare at a dashboard without an agreed threshold. Automation should watch the same signals every time.

For Kubernetes, the basic command flow looks like this:

```bash
kubectl set image deployment/checkout-api \
  checkout-api=registry.example.com/checkout-api:2026.06.13.2

kubectl rollout status deployment/checkout-api --timeout=5m
```

The `rollout status` command waits for the Deployment to complete. If it times out, the pipeline should fail the release job. A rollback command can move back to the previous revision:

```bash
kubectl rollout undo deployment/checkout-api
```

That command only helps when the old version can still run against the current environment. Database changes, queue formats, feature flags, and configuration changes can make a rollback unsafe. We will spend a full article on that problem later in this module.

For ECS, teams often enable the **deployment circuit breaker**. The circuit breaker detects failed service deployments and can automatically roll back to the last completed deployment. Teams commonly pair it with CloudWatch alarms for error rate, latency, task failures, and target health. The pipeline watches the ECS deployment status and treats a failed deployment as a blocked release.

Here is a simple pipeline shape:

```yaml
deploy_checkout:
  stage: deploy
  script:
    - ./scripts/render-task-definition.sh "$IMAGE_DIGEST"
    - ./scripts/deploy-ecs-service.sh checkout-api "$IMAGE_DIGEST"
    - ./scripts/wait-for-ecs-stability.sh checkout-api 900
    - ./scripts/smoke-test.sh https://checkout.example.com/ready
```

The practical detail is that the pipeline deploys by **image digest** or another immutable version, then waits for service stability, then runs a smoke test. A smoke test is a small verification request that proves the most important user path still works. For checkout, that might be creating a test cart, calculating totals, and hitting a payment-provider sandbox route.

The stop rules should be written before the release starts. A useful first set looks like this:

| Signal | Stop when |
|---|---|
| New instance readiness | New pods or tasks fail readiness for more than 5 minutes. |
| HTTP 5xx rate | Error rate doubles against the previous 30-minute baseline. |
| p95 latency | p95 latency stays above the service objective for 10 minutes. |
| Target health | Load balancer healthy targets fall below the capacity floor. |
| Business check | Synthetic checkout fails twice from two regions. |

This is where rolling deployments start to feel like release engineering instead of "restart the service and hope." The system has a plan, a capacity budget, readiness checks, and an automatic reason to stop.

## Putting It All Together
<!-- section-summary: A safe rolling deployment combines overlap, health checks, capacity planning, and a rehearsed rollback path. -->

Let's replay the checkout API release from start to finish.

The team builds one image for version `2026.06.13.2` and pushes it to the registry. The deployment updates the service from that immutable image. Kubernetes or ECS starts a small wave of new instances while the old version continues to serve users.

The platform waits for each new instance to pass readiness. The load balancer sends traffic only after the new instance becomes healthy. The rollout controller keeps at least the configured healthy count available. If the cluster needs twelve containers during the release, the team has already planned enough CPU, memory, database connections, and load balancer capacity for that short overlap.

The pipeline watches rollout status, target health, error rate, latency, and a checkout smoke test. If the new version fails startup, readiness, or user-facing checks, the pipeline stops the release and uses the platform rollback mechanism while the old version can still carry traffic.

Rolling deployments work well for normal service updates because they are simple and built into common platforms. They also have one big tradeoff: old and new versions run side by side during the rollout. That means APIs, database schemas, message formats, and feature flags must support mixed versions for a short time.

![Rolling release checklist showing readiness, error rate, latency, smoke checkout, promotion, and rollback path](/content-assets/articles/article-cicd-deployment-strategies-rolling-deployments-and-rollbacks/rolling-release-checklist.png)

*A safe rolling release combines capacity, readiness, monitoring, smoke tests, and a rollback path before the first wave starts.*

Some releases need stronger isolation than that. If old and new versions should never serve production traffic at the same time, the next pattern gives each version a full environment.

## What's Next
<!-- section-summary: Blue-green deployments trade extra environment cost for stronger version isolation and faster traffic switching. -->

The next article covers **blue-green deployments**. We will keep the same checkout API scenario, but now the new release gets its own full environment. That changes the release question from "How do we replace instances wave by wave?" to "How do we switch traffic between two complete environments safely?"

---

**References**

- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Documents Deployment rolling updates, rollout status, rollback commands, and `maxSurge` / `maxUnavailable`.
- [Kubernetes liveness, readiness, and startup probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/) - Explains probe types and how readiness controls whether a pod receives traffic.
- [Amazon ECS rolling deployments](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html) - Documents ECS rolling update behavior, minimum healthy percent, and maximum percent.
- [Amazon ECS deployment circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html) - Explains how ECS detects failed deployments and can roll back.
- [Application Load Balancer target group health checks](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html) - Documents health check paths, thresholds, and target health behavior.
