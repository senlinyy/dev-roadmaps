---
title: "Rolling Deployments"
description: "Deploy updates gradually across a replicated service with healthy capacity buffers, readiness gates, mixed-version compatibility, and stop rules."
overview: "Replacing an entire application cluster at once introduces severe release risk. Learn how rolling deployments replace containers wave-by-wave, how minimum and maximum healthy capacities prevent resource starvation, and how to gate deployments using automated readiness probes."
tags: ["rolling-deployments", "kubernetes", "readiness", "capacity"]
order: 1
id: article-cicd-deployment-strategies-rolling-deployments-and-rollbacks
aliases:
  - /cicd/deployment-strategies/rolling-deployments-and-rollbacks
---

## Table of Contents

1. [Why Is Deployment a State Transition?](#why-is-deployment-a-state-transition)
2. [How Does a Rolling Deployment Replace Instances?](#how-does-a-rolling-deployment-replace-instances)
3. [How Do Surge, Unavailability, and Headroom Control Capacity?](#how-do-surge-unavailability-and-headroom-control-capacity)
4. [How Do Readiness and Graceful Shutdown Create a Safe Handoff?](#how-do-readiness-and-graceful-shutdown-create-a-safe-handoff)
5. [Why Must Old and New Versions Coexist Safely?](#why-must-old-and-new-versions-coexist-safely)
6. [How Do Observability and Stop Rules Limit Exposure?](#how-do-observability-and-stop-rules-limit-exposure)
7. [Why Are Rollback, Startup Speed, and Stateful Workloads Harder?](#why-are-rollback-startup-speed-and-stateful-workloads-harder)
8. [How Does a Production-Safe Rolling Sequence Fit Together?](#how-does-a-production-safe-rolling-sequence-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Imagine we run an application service for an online store. Ten application containers serve traffic behind a load balancer. Version `2026.06.13.1` works well, and we want to ship version `2026.06.13.2` with a new discount calculation. The risky move would be stopping all ten old containers, starting ten new containers, and hoping the new version passes health checks before users notice.

That style creates a very simple failure. During the gap, the load balancer has no healthy targets. Every checkout request waits, retries, or fails. Even if the gap lasts one minute, that one minute can create failed requests, support tickets, and a very loud incident channel.

A **rolling deployment** means the platform replaces the running service in small waves. It starts a few new tasks or pods, waits until they pass health checks, sends traffic to them, and then removes a few old ones. The key idea is **overlap**. Old version and new version run together during the rollout so the service keeps enough healthy capacity for users.

Keep these questions in view as you work through the lesson:

1. **Why Is Deployment a State Transition?**
2. **How Does a Rolling Deployment Replace Instances?**
3. **How Do Surge, Unavailability, and Headroom Control Capacity?**
4. **How Do Readiness and Graceful Shutdown Create a Safe Handoff?**
5. **Why Must Old and New Versions Coexist Safely?**
6. **How Do Observability and Stop Rules Limit Exposure?**
7. **Why Are Rollback, Startup Speed, and Stateful Workloads Harder?**
8. **How Does a Production-Safe Rolling Sequence Fit Together?**

## Why Is Deployment a State Transition?
<!-- section-summary: A rolling deployment protects the service by replacing a small part of the fleet at a time. -->

The release can now be followed end to end and then mapped to a Kubernetes Deployment. Kubernetes names the replacement groups ReplicaSets, the running instances pods, and the two main rollout limits `maxSurge` and `maxUnavailable`. The underlying concern is to preserve healthy service capacity while desired state moves from version A to version B.

The first thing to understand is the shape of the rollout. Once that shape makes sense, the capacity numbers and readiness checks become much easier to place.

Deployment is a state transition, not a file-copy event. The system begins in state A: desired replica count, version A, healthy traffic, and supporting data contracts. It must reach state B: the same service obligation fulfilled by version B. During the transition it passes through mixed states containing some A instances and some B instances. A safe strategy constrains every intermediate state, not only the endpoint.

This gives rolling deployment its main safety idea: reduce the size of each change and preserve a healthy floor while learning whether B behaves correctly. It does not guarantee zero downtime or correctness by itself; those outcomes depend on capacity, health signals, graceful handoff, compatibility, and stop rules.

![Rolling deployment wave replacement showing old version containers, new version containers, health checks, and traffic staying on](/content-assets/articles/article-cicd-deployment-strategies-rolling-deployments-and-rollbacks/rolling-wave-replacement.png)

*A rolling deployment keeps the old version serving traffic while the new version joins in small healthy waves.*

## How Does a Rolling Deployment Replace Instances?
<!-- section-summary: The platform creates new instances, proves they are healthy, and then removes old instances in repeated waves. -->

A **deployment instance** is one running copy of the application. In Kubernetes, that copy is usually a pod. If the application service runs ten copies, the rollout controller has ten old instances to replace.

In a rolling deployment, the platform follows a loop:

1. Start a small number of new instances from the new image.
2. Wait for those instances to become healthy.
3. Add them to traffic.
4. Remove a matching number of old instances.
5. Repeat until every active instance runs the new version.

Here is a small Kubernetes Deployment for an application service:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: service
spec:
  replicas: 10
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2
      maxUnavailable: 1
  selector:
    matchLabels:
      app: service
  template:
    metadata:
      labels:
        app: service
        version: "2026.06.13.2"
    spec:
      containers:
        - name: service
          image: registry.example.com/service:2026.06.13.2
          ports:
            - containerPort: 8080
```

The `replicas: 10` line says the service wants ten running pods. The `RollingUpdate` strategy tells Kubernetes to move toward the new pod template gradually. The `maxSurge: 2` value lets Kubernetes run up to two extra pods above the desired count during the rollout. The `maxUnavailable: 1` value lets at most one desired pod be unavailable during the rollout.

Those numbers are the next thing we need to talk about because the rolling shape only works when the service has enough room to run old and new versions at the same time.

The controller can replace in two broad orders. **Stop-first** removes an old instance to free resources, then starts its replacement. It works without spare capacity but temporarily lowers service capacity. **Start-first** creates and proves a new instance before draining an old one. It preserves capacity more strongly but requires headroom for overlap. `maxSurge` and `maxUnavailable` let Kubernetes combine these choices in bounded waves.

## How Do Surge, Unavailability, and Headroom Control Capacity?
<!-- section-summary: Rolling deployments need a capacity buffer so new instances can start before old instances disappear. -->

**Capacity** means the compute room the service has available: CPU, memory, node slots, task slots, database connections, and load balancer target slots. A rolling deployment consumes extra capacity for a short time because old and new instances overlap.

Let's stay with an application service. Ten old containers are already serving traffic. The rollout starts two new containers. For a few minutes, the cluster needs room for twelve containers. If the cluster has only enough CPU and memory for exactly ten, the new containers may sit pending. The rollout can stall because the platform has no room to create the healthy replacement instances it needs.

That is why teams choose rollout numbers together with infrastructure capacity. Here is a simple planning table for ten replicas:

| Setting | What it allows | Highest running count | Lowest healthy target |
|---|---|---:|---:|
| `maxSurge: 1`, `maxUnavailable: 0` | Slow and cautious | 11 | 10 |
| `maxSurge: 2`, `maxUnavailable: 1` | Common balanced rollout | 12 | 9 |
| `maxSurge: 5`, `maxUnavailable: 2` | Faster rollout with more burst capacity | 15 | 8 |

These fields may be absolute counts or percentages. With desired replica count (R), a count-based approximation is:

```text
maximum running during rollout = R + surge
minimum available during rollout = R - unavailable
```

Percentage values require platform rounding rules, which matter most for small replica sets. A seemingly safe `25%` on four replicas represents only one pod. Check the controller's calculated values rather than reasoning from the percentage name alone.

The two limits are not direct promises that exactly that many pods change in every wave. Scheduling, readiness time, termination delay, and controller reconciliation determine the actual sequence. They define the envelope in which the controller may move. `maxUnavailable: 0` prevents deliberate reduction below desired availability, but a node failure or crashing old pod can still reduce real capacity; rollout configuration cannot cancel independent failures.

The first option protects user capacity strongly but moves slowly. The second option gives the platform a little room to move without draining too much live traffic capacity. The third option finishes faster, but the cluster and database must handle more simultaneous new containers and a lower healthy floor.

In real production, platform teams connect this to autoscaling. If a Kubernetes cluster runs close to full, the cluster autoscaler may need time to add nodes before the new pods can schedule. Even when compute expands, the application can still hit database connection limits, outbound network limits, or health-check delays.

A practical rollout checklist usually includes these questions:

| Check | Why it matters |
|---|---|
| Can the cluster run the desired surge count? | The new version needs room before old instances drain. |
| Can the database handle overlap? | Twelve app instances may open more connections than ten. |
| Can the load balancer register targets quickly enough? | New instances need traffic only after health checks pass. |
| Can autoscaling react before the rollout times out? | Scheduling delays can look like release failures. |

![Rolling deployment capacity buffer showing desired count, surge capacity, minimum healthy floor, database connections, and load balancer targets](/content-assets/articles/article-cicd-deployment-strategies-rolling-deployments-and-rollbacks/rolling-capacity-buffer.png)

*The rollout needs temporary room for old and new containers, plus enough database and load balancer capacity to carry the overlap.*

Headroom is deployment infrastructure. If normal traffic consumes every CPU unit and database connection, there is no safe place to start B before stopping A. Plan spare cluster resources, quotas, IP addresses, image-pull bandwidth, load-balancer registration capacity, and downstream connection budgets as part of the release design.

Autoscaling complicates the arithmetic because desired replicas can change while replacement is in progress. The rollout controller and autoscaler may both create or remove pods in response to different signals. Capacity planning should consider the largest expected desired count plus surge and the delay before new nodes become schedulable. A rollout timeout shorter than node provisioning time can fail a healthy release.

Cluster capacity is not the only limit. New pods can be pending because of placement constraints, unavailable volumes, topology rules, or insufficient IP addresses. They can start successfully but overload the database by opening fresh connection pools while old pods remain active. The capacity invariant must cover the entire dependency path.

Capacity keeps the service alive during the wave. Readiness answers the next question: whether the new version can safely receive user traffic.

## How Do Readiness and Graceful Shutdown Create a Safe Handoff?
<!-- section-summary: Readiness checks tell the platform when a new instance can receive real user requests. -->

**Readiness** means the application can handle real traffic now. A process can be running while the app still warms caches, opens database pools, loads configuration, runs migrations, or waits for a downstream dependency. The platform needs a signal that means "this copy can answer user requests."

In Kubernetes, a **readiness probe** checks each pod. When the readiness probe fails, Kubernetes removes that pod from Service endpoints and keeps normal traffic away from it. A **startup probe** gives slow-starting containers extra time before the platform treats the startup as failed. A **liveness probe** answers a different question: whether the container should restart because it got stuck.

Here is a useful probe setup for an application service:

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

Good readiness checks also protect rollback. If version `2026.06.13.2` starts but fails to connect to the payment database, the new containers fail readiness. The platform keeps traffic on the old containers and the release stops before customers hit the bad version. This is much calmer than discovering the problem after half the fleet has already changed.

Readiness creates a handoff. A new pod starts outside normal traffic, initializes, proves the minimum conditions needed to serve, enters the endpoint set, and only then allows an old pod to leave. Liveness answers whether a stuck process should restart; readiness answers whether this process should receive traffic now. Mixing them can cause a downstream outage to restart every otherwise healthy pod.

A readiness endpoint can lie. Returning `200` because the HTTP server responds does not prove configuration loaded, migrations are compatible, caches warmed, or required dependencies are usable. An endpoint can also be too strict: if it depends on every optional downstream, one minor outage may remove all service capacity. Readiness should test the smallest honest set of prerequisites for this instance to handle its promised traffic.

The old end of the handoff matters too. Before termination, an instance should become unready, stop accepting new work, finish or bound in-flight requests, close consumers and connections, and exit before the platform's grace period expires. If removal and process termination race, load balancers or clients may still send work to a dying instance. Graceful shutdown is part of the deployment contract.

The complete handoff is therefore: start B, wait for honest readiness, add B to traffic, mark one A unavailable for new work, drain A, terminate A, and verify capacity. Repeating only “start and stop” leaves out the two traffic transitions where user-visible failures often occur.

Now we have the rollout loop, enough capacity, and readiness gates. Before automation can judge the rollout, A and B must also coexist safely.

## Why Must Old and New Versions Coexist Safely?
<!-- section-summary: A rolling deployment deliberately creates a mixed-version period, so shared data, messages, sessions, and APIs must remain compatible across both directions. -->

During the rollout, traffic can reach A and B at the same time. Either version may read data written by the other. A message produced by B may be consumed by A. A user session created on A may send its next request to B. This mixed state is not an edge case; it is the defining intermediate state of a rolling deployment.

Database changes make the requirement concrete. If B drops or renames a column that A still reads, the first B instance can break the remaining A fleet. Use **expand and contract**: first add a compatible schema, deploy code that can work with both forms, migrate or backfill data, move all consumers, and only later remove the old schema in a separate release. Destructive change waits until no live or rollback version depends on it.

Message queues have the same contract problem. Producers and consumers deploy independently, and queued messages outlive processes. Add fields compatibly, tolerate unknown fields, version message types when semantics change, and avoid making one wave produce data that the previous wave cannot parse.

Sessions can fail if state lives only in one process or its serialized shape changes incompatibly. Prefer external session storage or backward-compatible session formats, and avoid relying on sticky routing to hide a fundamental incompatibility. Retries can also move a request from an old instance to a new one, so idempotency and shared request semantics matter.

The hidden invariant is simple: A must tolerate B's outputs, and B must tolerate A's outputs, for the full overlap and rollback window. If that cannot be true, use feature flags to separate deployment from activation or choose a strategy that prevents mixed serving.

## How Do Observability and Stop Rules Limit Exposure?
<!-- section-summary: A rollout needs automatic stop rules so the pipeline can halt before a bad version spreads. -->

A **stop rule** is a clear condition that tells the deployment system to pause, fail, or roll back. People often notice a bad rollout too late because they wait for customer reports or stare at a dashboard without an agreed threshold. Automation should watch the same signals every time.

For Kubernetes, the basic command flow looks like this:

```bash
kubectl set image deployment/service \
  service=registry.example.com/service:2026.06.13.2

kubectl rollout status deployment/service --timeout=5m
```

The `rollout status` command waits for the Deployment to complete. If it times out, the pipeline should fail the release job. A rollback command can move back to the previous revision:

```bash
kubectl rollout undo deployment/service
```

That command only helps when the old version can still run against the current environment. Database changes, queue formats, feature flags, and configuration changes can make a rollback unsafe. We will spend a full article on that problem later in this module.

Here is a simple pipeline shape:

```yaml
deploy_service:
  stage: deploy
  script:
    - kubectl set image deployment/service service="registry.example.com/service@$IMAGE_DIGEST"
    - kubectl rollout status deployment/service --timeout=5m
    - ./scripts/smoke-test.sh https://service.example.com/ready
```

The practical detail is that the pipeline deploys by **image digest** or another immutable version, waits for rollout completion, then runs a smoke test. A smoke test is a small verification request that proves an important user path still works rather than only checking that a process exists.

The stop rules should be written before the release starts. A useful first set looks like this:

| Signal | Stop when |
|---|---|
| New instance readiness | New pods fail readiness for more than 5 minutes. |
| HTTP 5xx rate | Error rate doubles against the previous 30-minute baseline. |
| p95 latency | p95 latency stays above the service objective for 10 minutes. |
| Target health | Load balancer healthy targets fall below the capacity floor. |
| Business check | A synthetic request fails twice from two regions. |

This is where rolling deployments start to feel like release engineering instead of "restart the service and hope." The system has a plan, a capacity budget, readiness checks, and an automatic reason to stop.

A rollout is an experiment whose sample grows over time. The first healthy B pod receives some real traffic; its behavior supplies evidence. Each next replacement increases exposure. The safest automation is often the ability to stop progression when evidence turns bad, preserving the remaining A capacity while humans or policy decide what follows.

Readiness answers only “may this instance receive traffic?” It does not answer whether business results are correct, error rate is acceptable, latency remains within objective, resource use is stable, or downstream load is safe. Combine platform progress with service metrics, saturation, logs, traces, and synthetic or business checks.

Write stop rules before release so thresholds are not renegotiated under pressure. A stop can pause further replacement without immediately undoing healthy B pods. Rollback is a separate action with its own compatibility and capacity consequences.

## Why Are Rollback, Startup Speed, and Stateful Workloads Harder?
<!-- section-summary: Rolling backward repeats the same replacement process, while slow startup, autoscaling, state, and irreversible data changes can make recovery slower or unsafe. -->

Rollback is also a rollout. The controller must replace B instances with A instances, wait for A readiness, drain B, and preserve capacity. It is fast only if the A artifact is still available, configuration remains compatible, and shared state has not crossed an irreversible boundary. Deploy immutable image digests so the exact previous artifact can be selected rather than rebuilding a moving tag.

If B never becomes ready, Kubernetes cannot safely complete the handoff. Progress reaches its deadline, the pipeline fails, and old healthy pods should remain where the strategy permits. Diagnose image pulls, scheduling, startup, probes, configuration, and dependency access before forcing progress by deleting A capacity.

Startup time determines how quickly each wave can produce trustworthy capacity. Larger surge can overlap more startup work but consumes more resources. Looser readiness may appear faster while merely moving failures into user traffic. Faster replacement is not automatically safer; a larger wave also exposes more users before stop signals react.

Approximate rollout duration depends on the number of replacement waves multiplied by the slowest meaningful handoff time: scheduling, image pull, startup, readiness stabilization, observation, drain, and termination. Optimizing only container boot may not change the bottleneck. Measure the whole transition and shorten it only where the safety evidence remains intact.

Stateful workloads add identity, storage, ordering, and quorum constraints. A replica may own a persistent volume or partition, require ordered restart, or participate in leader election. Generic stateless rolling assumptions do not automatically preserve those invariants. Availability also differs from correctness: every pod can be ready while B calculates the wrong result. Operational and semantic validation are both required.

That distinction affects completion. The controller can truthfully report that every desired pod is available even while business results regress. Platform status proves convergence and health under configured probes; release status additionally needs version-segmented service and business evidence.

## How Does a Production-Safe Rolling Sequence Fit Together?
<!-- section-summary: A safe rolling deployment combines overlap, health checks, capacity planning, and a rehearsed rollback path. -->

Let's replay an application service release from start to finish.

The team builds one image for version `2026.06.13.2` and pushes it to the registry. The deployment updates the service from that immutable image. Kubernetes starts a small wave of new instances while the old version continues to serve users.

The platform waits for each new instance to pass readiness. The load balancer sends traffic only after the new instance is healthy. The rollout controller keeps at least the configured healthy count available. If the cluster needs twelve containers during the release, the team has already planned enough CPU, memory, database connections, and load balancer capacity for that short overlap.

The pipeline watches rollout status, target health, error rate, latency, and a service smoke test. If the new version fails startup, readiness, or user-facing checks, the pipeline stops the release and uses the platform rollback mechanism while the old version can still carry traffic.

Rolling deployments work well for normal service updates because they are simple and built into common platforms. They also have one big tradeoff: old and new versions run side by side during the rollout. That means APIs, database schemas, message formats, and feature flags must support mixed versions for a short time.

Deployment and release can be separated. The team can roll B to every pod with a new feature disabled, verify runtime health, then enable the feature gradually through configuration or a flag. This reduces the number of unknowns in the infrastructure transition and gives product behavior its own stop control.

A production-safe sequence builds and identifies an immutable artifact, proves capacity headroom, confirms compatibility, records baseline signals and stop thresholds, starts a small B wave, waits for honest readiness, admits traffic, observes behavior, drains A gracefully, and repeats. Completion includes post-rollout verification rather than merely reaching the desired replica count.

The safety invariants are: enough healthy capacity remains; unready instances receive no normal traffic; terminating instances drain; every mixed version can share data and messages; the exact previous artifact remains deployable; observability can stop progression; and deployment success includes correctness evidence, not only process health.

![Rolling release checklist showing readiness, error rate, latency, smoke checkout, promotion, and rollback path](/content-assets/articles/article-cicd-deployment-strategies-rolling-deployments-and-rollbacks/rolling-release-checklist.png)

*A safe rolling release combines capacity, readiness, monitoring, smoke tests, and a rollback path before the first wave starts.*

Some releases need stronger isolation than that. If old and new versions should never serve production traffic at the same time, the next pattern gives each version a full environment.

## Check Your Answers

:::expand[Why Is Deployment a State Transition?]{kind="recap"}
The service moves from all-A desired state to all-B through intermediate mixed states. A strategy must preserve safety throughout that transition. Rolling limits the size of each change, but capacity, signals, compatibility, and stop rules determine whether the transition is actually safe.
:::

:::expand[How Does a Rolling Deployment Replace Instances?]{kind="recap"}
The controller starts B instances, waits for them to become eligible for traffic, drains and removes A instances, and repeats. Start-first preserves capacity with extra headroom; stop-first frees resources while temporarily reducing capacity. Kubernetes bounds the combination with surge and unavailability.
:::

:::expand[How Do Surge, Unavailability, and Headroom Control Capacity?]{kind="recap"}
`maxSurge` limits temporary extra replicas, while `maxUnavailable` limits the desired replicas that may be missing. Headroom must cover compute, placement, IPs, image pulls, connection pools, and downstream load. Autoscaling delay must fit the rollout deadline.
:::

:::expand[How Do Readiness and Graceful Shutdown Create a Safe Handoff?]{kind="recap"}
Readiness admits a genuinely prepared B instance to traffic. Liveness decides whether a stuck process should restart. Then A becomes unready, stops new work, drains in-flight work, and exits within its grace period. Honest probes and both traffic transitions form the handoff.
:::

:::expand[Why Must Old and New Versions Coexist Safely?]{kind="recap"}
A and B simultaneously read and write shared schemas, messages, sessions, and APIs. Expand-and-contract migrations and compatible formats preserve both directions through the overlap and rollback window. If coexistence is impossible, separate activation with flags or choose another strategy.
:::

:::expand[How Do Observability and Stop Rules Limit Exposure?]{kind="recap"}
Each replacement wave enlarges an experiment. Readiness alone cannot detect wrong business results, latency, errors, or saturation. Compare service and business signals with written thresholds, then stop progression before the remaining A capacity disappears. Stop and rollback are separate decisions.
:::

:::expand[Why Are Rollback, Startup Speed, and Stateful Workloads Harder?]{kind="recap"}
Rollback repeats replacement in the opposite direction and requires the exact A artifact plus compatible shared state. Slow startup, cluster scaling, and probe timing govern wave speed. Stateful systems add volumes, identity, order, and quorum constraints beyond stateless availability.
:::

:::expand[How Does a Production-Safe Rolling Sequence Fit Together?]{kind="recap"}
Deploy an immutable artifact, verify headroom and compatibility, record baselines and stops, start a small wave, wait for readiness, observe real behavior, drain old instances, and repeat. Validate correctness afterward and activate risky features separately when possible.
:::

## References

- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Documents Deployment rolling updates, rollout status, rollback commands, and `maxSurge` / `maxUnavailable`.
- [Kubernetes liveness, readiness, and startup probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/) - Explains probe types and how readiness controls whether a pod receives traffic.
