---
title: "Health Probes"
description: "Configure Kubernetes startup, readiness, and liveness probes so each check produces the intended traffic or restart decision."
tags: ["Kubernetes", "Operations", "Reliability", "Probes"]
area: "Containers & Orchestration"
order: 1
id: article-containers-orchestration-kubernetes-operations-health-probes
---

## Table of Contents

1. [What decisions do health probes give Kubernetes?](#what-decisions-do-health-probes-give-kubernetes)
2. [How does readiness change Service traffic?](#how-does-readiness-change-service-traffic)
3. [When should liveness restart a container?](#when-should-liveness-restart-a-container)
4. [How does startup give a slow application time to initialize?](#how-does-startup-give-a-slow-application-time-to-initialize)
5. [How do timing settings turn probe results into action?](#how-do-timing-settings-turn-probe-results-into-action)
6. [How can you verify that the probes behave correctly?](#how-can-you-verify-that-the-probes-behave-correctly)
7. [Check Your Answers](#check-your-answers)
8. [References](#references)

A process can be alive, still starting, or temporarily unable to serve traffic. Kubernetes uses three probes because those states call for different actions: startup grants initialization time, readiness controls traffic eligibility, and liveness allows the kubelet to restart a process that has stopped making progress.

Six questions organize the decisions behind those checks:

1. **What decisions do health probes give Kubernetes?**
2. **How does readiness change Service traffic?**
3. **When should liveness restart a container?**
4. **How does startup give a slow application time to initialize?**
5. **How do timing settings turn probe results into action?**
6. **How can you verify that the probes behave correctly?**

## What decisions do health probes give Kubernetes?
<!-- section-summary: The kubelet runs three kinds of probe because traffic eligibility, process recovery, and slow startup require different actions. -->

### Running says only that a process exists

A Kubernetes **health probe** is a small diagnostic that the kubelet runs against one container. The result gives Kubernetes enough information to make a specific runtime decision. Readiness controls whether a Pod is eligible for Service traffic. Liveness can restart a container whose process has stopped making progress. Startup gives initialization a separate window before the other two checks begin.

Suppose an application needs a loaded configuration and a working connection pool before requests can succeed. Its process may exist before initialization finishes, it may temporarily be unable to serve traffic, or it may become permanently deadlocked. Those three states need three different responses.

The **kubelet** is the Kubernetes agent running on the same node as the Pod. It executes the configured HTTP, TCP, gRPC, or command check and records each result. For startup and liveness failures, the kubelet directly controls the container lifecycle. For readiness, it reports container and Pod readiness to the control plane, which updates the endpoint information used by Services.

| Probe | Question answered by the application | Kubernetes response |
|---|---|---|
| **Startup** | Has this container finished initialization? | Hold readiness and liveness checks; restart the container after the startup budget is exhausted |
| **Readiness** | Can this replica handle its normal traffic now? | Mark the Pod ready or unready and update its Service endpoint eligibility |
| **Liveness** | Is this process making progress? | Restart the container after the configured number of failures |


This separation gives each symptom an appropriate response. A temporarily busy replica benefits from a pause in traffic. A stuck process benefits from a restart. A healthy process still loading its index benefits from more startup time.

The three application predicates are deliberately different:

```text
Started(app) = initialization is complete enough for normal checks
Ready(app)   = sending normal traffic here is a good decision now
Live(app)    = keeping this process is better than replacing it
```

Keeping them distinct makes every Kubernetes action explainable from the application's reported condition.

Liveness is not a broad “is everything healthy?” test. It asks whether a restart is a useful treatment. That wording prevents many shared dependency failures from being turned into restart storms.

### Separate process existence from application decisions

The container runtime can report that PID 1 exists. It cannot infer whether the process has loaded its configuration, whether callers should use it, or whether its event loop is permanently stuck. Probes let the application translate internal state into three small signals that Kubernetes can act upon.

The actions are intentionally different:

```text
startup failure budget exhausted -> replace this container and try startup again
readiness failure                 -> keep the container, remove normal new traffic
liveness failure budget exhausted-> replace this container because a fresh process may help
```

A single `/health` endpoint reused for all three probes can accidentally collapse those decisions. If it checks PostgreSQL, a database outage can be interpreted simultaneously as “initialization failed,” “stop traffic,” and “restart every API process.” Separate endpoints let each condition answer only the question whose action is appropriate.

## How does readiness change Service traffic?
<!-- section-summary: Readiness describes whether this replica can serve its normal request path, and Kubernetes reflects that result in Pod and EndpointSlice conditions. -->

### Readiness removes work without destroying the worker

A readiness probe answers a routing question about one replica: can this Pod accept its normal requests at this moment? A successful result contributes to the Pod's `Ready` condition. A failed result sets that condition to false while the container continues running and the kubelet continues checking it.

For a Service with a selector, the EndpointSlice controller records the matching Pod IPs and their conditions. A ready API Pod appears as an endpoint for normal Service traffic. When its readiness probe fails, its `ready` condition changes, so Service proxies can withhold normal traffic from that replica. Once readiness succeeds again, the Pod can rejoin the routing set.

That path involves two separate Kubernetes responsibilities:

1. The kubelet runs the probe and reports the container's readiness.
2. The control plane reflects the Pod's `Ready` condition in the Service's EndpointSlices.

This is why a readiness failure leaves the restart count unchanged. Kubernetes is changing routing eligibility, while the process keeps its memory, local state, and chance to recover.

### Readiness Should Describe This Replica

Readiness should describe whether this replica can serve requests. A local configuration or connection-pool condition can be part of that answer when every normal request depends on it.

Remote dependencies need deliberate treatment. If every replica checks the same optional dependency, one remote outage can make every Pod unready at once. If a dependency is essential for all useful requests, readiness can include it—but the team should understand that the whole Service may then lose its ready endpoints. If the application can serve cached or reduced results, keep the replica ready and expose the degradation through responses, metrics, and alerts instead.

A readiness check should be small, bounded, and safe to run repeatedly. Expensive application queries and broad dependency checks belong elsewhere.

### Follow readiness into the endpoint set

Suppose the `api` Service has three matching Pods. Initially, each has `Ready=True`, so EndpointSlices publish three ready endpoints. Pod B's connection pool becomes unusable, and `/health/ready` begins returning failure. The kubelet records the failed checks and reports B as unready. The control plane then reflects that result in the EndpointSlice.

```text
/health/ready fails on Pod B
        ↓
container readiness = false
        ↓
Pod Ready condition = false
        ↓
EndpointSlice marks B not ready
        ↓
normal new Service traffic uses A and C
```

Pod B remains Running so the application can reconnect, preserve useful process state, and expose diagnostics. When the configured number of successful checks is reached, the same path reverses and B rejoins the eligible set. Readiness is therefore a feedback signal between application capacity and Service traffic, not a restart trigger.

The consequence of a shared dependency check should be deliberate. If PostgreSQL is essential for every useful request and all replicas report unready when it fails, the Service can have zero ready endpoints. That may be more truthful than accepting requests that cannot succeed, but it is a system-wide routing decision, not merely a local health detail.

## When should liveness restart a container?
<!-- section-summary: Liveness represents process progress and should fail when a fresh process is likely to repair the condition. -->

### Restart only when a fresh process improves the state

A liveness probe gives the kubelet permission to replace one container process with a fresh instance. That action clears memory, recreates threads, and runs the container entrypoint again. It is useful when the process has reached a state that requires a fresh process for recovery.

Suppose the application deadlocks. The process still has a PID, yet it stops making progress. A liveness check can detect that persistent local failure and let the kubelet restart the container.

Restarting also has a cost. The replica leaves service and the remaining replicas receive more traffic. This makes liveness a good match for a persistent local failure and a poor match for a shared dependency failure, which a restart cannot repair.

A sound liveness design follows one rule: **the checked condition should have a reasonable chance of recovery after a fresh process starts**. Deadlocked threads, a wedged event loop, or a corrupt in-memory worker state fit that rule. Remote service latency, a scheduled maintenance window, and ordinary load belong in readiness signals, application responses, metrics, or alerts according to the effect they have.

After `failureThreshold` consecutive liveness failures, the kubelet stops and restarts that container according to the Pod's restart policy. A later successful check clears the consecutive-failure count. The Pod object remains, while its container restart count increases and the previous container's logs remain available for inspection.

Consider a database outage. If every API Pod makes PostgreSQL availability part of `/live`, all replicas fail together, restart, initialize, and reconnect while the database is still unavailable. The original dependency outage now also creates container churn, CPU spikes, cache rebuilding, and connection storms. Keeping `/live` focused on local process progress and using readiness for an essential dependency avoids that second failure.

Follow one replica to see why the restart is counterproductive. It detects PostgreSQL failure, crosses the liveness threshold, and is terminated. Its replacement reloads configuration and caches, then tries the same unavailable database. Ten replicas repeat the sequence at similar times, producing synchronized connection attempts and removing whatever degraded diagnostic capacity the old processes retained.

A deadlock is different. The local process cannot make forward progress even though its PID exists. A fresh process recreates its threads and memory and has a reasonable chance of serving again. The restart action matches the failure scope. The design question is always causal: “What condition did the probe observe, and how does replacing this container improve that condition?”

## How does startup give a slow application time to initialize?
<!-- section-summary: A startup probe gives initialization a bounded window and hands control to readiness and liveness as soon as boot completes. -->

### Startup is a temporary gate, not an ongoing health check

Some applications perform legitimate work before their ongoing health signals are meaningful. A valid slow start may take about 90 seconds, so liveness must not restart the container during that initialization window.

A liveness check that starts after 10 seconds would see an unresponsive health route and repeatedly restart the container during healthy initialization. A long liveness delay would give initialization more time, yet it would also delay liveness after every quick start. The startup probe gives each phase its own timing.

While a startup probe is configured and still failing, the kubelet holds both readiness and liveness checks for that container. Service traffic waits, and liveness remains paused throughout initialization. As soon as startup succeeds once, the kubelet starts the ongoing readiness and liveness schedules. That success applies to the current container instance; a later restart creates a new startup phase.

For this API, a five-second period and a failure threshold of 24 provide roughly two minutes for boot:

```yaml
startupProbe:
  httpGet:
    path: /health/startup
    port: http
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 24
```

The `/health/startup` route returns success after initialization is complete. A quick start hands control to the other probes quickly. A container that remains stuck in initialization beyond the two-minute budget reaches the failure threshold, and the kubelet restarts it.

The startup budget should cover a measured slow start with some operating margin. An extremely large budget can hide an image, volume, or initialization defect for a long period. A very small budget turns healthy cold starts into restart loops. Startup-duration metrics from staging and production provide the measurements for choosing these numbers.

Use the 90-second application as a timeline. With liveness starting immediately, three ten-second failures can terminate it near 30 seconds, long before initialization can finish. With a startup probe every five seconds and `failureThreshold: 24`, the container receives roughly 120 seconds. A valid 90-second start succeeds and hands off immediately; it does not wait for the unused 30 seconds.

```text
0s container starts
5s..85s startup probe may fail normally
90s startup succeeds
     readiness and liveness schedules begin
```

If startup remains unsuccessful through the budget, Kubernetes now has evidence that this instance exceeded an accepted initialization time. The restart begins a new container instance and therefore a new startup gate. Startup is bounded patience, not infinite tolerance.

## How do timing settings turn probe results into action?
<!-- section-summary: Probe handlers define the signal, while timing fields define how many results and how much time Kubernetes uses before changing traffic or restarting a container. -->

### Turn probe intervals into an evidence budget

Probe configuration has two parts. The **handler** obtains one result, and the **timing fields** decide when a sequence of results should change Kubernetes state. Keeping those parts separate makes the configuration easier to review: first decide which result means healthy, then decide how patient the platform should be.

Kubernetes supports four handlers. An HTTP probe checks a small endpoint, a TCP probe checks whether a connection can be opened, a gRPC probe uses the gRPC Health Checking Protocol, and an exec probe runs a command inside the container. The application already exposes HTTP, so dedicated HTTP routes give the clearest application-level result. A TCP success would prove that a socket accepted a connection while leaving index and event-loop state unexplained.

The main timing fields have distinct jobs:

| Field | Meaning | Design question |
|---|---|---|
| `initialDelaySeconds` | Wait before the first check | Does this probe need a short fixed pause before checks start? |
| `periodSeconds` | Normal interval between checks | How quickly should Kubernetes notice a change? |
| `timeoutSeconds` | Maximum duration for one check | How long can one probe occupy resources before it counts as failed? |
| `failureThreshold` | Consecutive failures required for the failure action | How much transient failure should this decision tolerate? |
| `successThreshold` | Consecutive successes required after failure | How many healthy results should readiness require before traffic returns? |

Liveness and startup use a `successThreshold` of `1`. Readiness can require several consecutive successes when a rapidly changing signal would otherwise move traffic in and out too often. Each probe owns its own counters and timing.

A useful rough calculation is:

```text
failure detection budget ≈ failureThreshold × periodSeconds
```

Three failures at a ten-second period mean roughly thirty seconds of persistent failure before action. The exact wall time also depends on where failure begins relative to the schedule, each timeout, and termination grace. For readiness, a success threshold greater than one adds hysteresis: the replica needs sustained recovery before traffic returns instead of flapping Ready and NotReady on alternating results.

Treat entry and recovery as two sides of a state machine. With `failureThreshold: 2` and `successThreshold: 2`, two consecutive failed readiness checks remove traffic. Afterward, one success is not enough to rejoin. A failure between two successes resets the recovery count, and only two consecutive successes restore readiness. That asymmetry filters a dependency that alternates rapidly between good and bad states.

Detection speed and stability trade off. A shorter period or lower threshold reacts faster but is more sensitive to brief scheduler delay, CPU pressure, or transient network loss. A longer budget avoids false transitions but leaves an unhealthy endpoint eligible or a deadlocked process alive for longer. Choose numbers from measured failure and recovery behavior rather than copying one manifest across every workload.

The complete container configuration now expresses three contracts:

```yaml
containers:
  - name: api
    image: example/api:1.0
    ports:
      - name: http
        containerPort: 8080

    startupProbe:
      httpGet:
        path: /health/startup
        port: http
      periodSeconds: 5
      timeoutSeconds: 2
      failureThreshold: 24

    readinessProbe:
      httpGet:
        path: /health/ready
        port: http
      periodSeconds: 5
      timeoutSeconds: 2
      failureThreshold: 2
      successThreshold: 2

    livenessProbe:
      httpGet:
        path: /health/live
        port: http
      periodSeconds: 10
      timeoutSeconds: 2
      failureThreshold: 3
```

The readiness configuration withholds traffic after two failed checks and requires two successes before returning it. Liveness waits for three failures across its slower schedule before restarting. Readiness acts through status and routing while the container keeps running.


The numbers form one operating hypothesis. Verification should show that the two-minute startup budget covers a 90-second valid start, readiness changes traffic without a restart, and repeated liveness failure restarts the container.

### Make each endpoint cheap, local, and bounded

`/health/startup` should show that initialization has completed. `/health/ready` should show that this replica can serve its normal request path. `/health/live` should show that the local process can still make progress. A TCP probe proves only that a connection can be opened; it may succeed while the application is deadlocked. An HTTP or gRPC health implementation can express the application-level state more directly.

A health endpoint runs frequently and sits inside a control loop. It should not perform an unbounded database query or expensive computation. Otherwise the probe itself consumes capacity and turns dependency slowness into ambiguous health failures.

The probe handler sets the depth of evidence. TCP proves that a socket accepted a connection, not that the application can process a request. HTTP can ask a dedicated route for application state. gRPC can use the health checking protocol and require a `SERVING` result. Exec can inspect a local condition when no network endpoint exists, but each run creates command-execution overhead. Choose the cheapest mechanism that still answers the intended startup, readiness, or liveness question.

## How can you verify that the probes behave correctly?
<!-- section-summary: Controlled staging states should produce three distinct observations: delayed probe handoff, endpoint readiness changes, and a container restart with matching logs and events. -->

### Test the complete lifecycle, not only each endpoint

A manifest can pass API validation while its probes express the wrong application contract. A staging test closes that gap by creating one controlled condition for each probe and observing the exact Kubernetes action.

### Verify the Startup Handoff

Make the application take 90 seconds to initialize. During that delay, startup may fail while liveness remains paused. When startup succeeds, readiness and liveness begin.

```bash
kubectl get pod api-abc123 -w
```

The restart count should remain unchanged while startup stays within its roughly two-minute budget. Then make startup never complete and confirm that reaching the startup failure threshold restarts the container.

### Verify the Readiness Traffic Change

Make `/health/ready` fail in a test environment. The Pod should move from `1/1` to `0/1` while remaining Running and keeping the same restart count. The corresponding EndpointSlice entry should report `ready: false`.

```bash
kubectl get endpointslice \
  -l kubernetes.io/service-name=api -o yaml
```

After capacity returns, readiness succeeds and the EndpointSlice controller marks the endpoint eligible again. That sequence shows a routing change and recovery on the same container instance.

### Verify the Liveness Restart

Make `/health/live` fail long enough to reach its failure threshold. The kubelet should record probe failures followed by a container restart, and the restart count should increase from `0` to `1`.

```text
Warning  Unhealthy  Liveness probe failed
Normal   Killing    Container failed liveness probe
```

The restart confirms the chain from failed liveness checks to kubelet action. Startup begins again for the new container instance.


These tests also create useful monitoring signals. Teams can alert on Pods that remain in startup near the expected budget, frequent readiness changes, and liveness-driven restarts. The alert should preserve the probe type because each one points to a different owner and recovery path.

Use events and previous-container logs together. `Unhealthy` events identify the probe, result, and timing. A later `Killing` event links repeated liveness failure to the kubelet restart. The new container's normal logs describe the fresh process, while `kubectl logs --previous` preserves evidence from the container that was replaced. Without that previous instance, the restart can erase the most useful account of the deadlock or local failure.

A complete scenario connects the decisions. The container starts and startup succeeds after 40 seconds, enabling readiness and liveness. When the database disappears, `/ready` returns failure while `/live` continues succeeding, so the process stays alive and Service traffic stops. When the database returns, readiness succeeds and traffic resumes without a restart. Later, a local deadlock makes `/live` fail repeatedly, the kubelet restarts the container, startup runs again, and the replacement rejoins traffic only after readiness succeeds.

## Check Your Answers
<!-- section-summary: The six answers connect probe meaning, Kubernetes action, timing, dependency scope, and staging observations. -->

:::expand[What decisions do health probes give Kubernetes?]{kind="recap"}
Startup controls the initialization window, readiness controls Service endpoint eligibility, and liveness controls container restarts. The kubelet runs each check, then either acts on the container lifecycle or reports readiness for the control plane to publish.
:::

:::expand[How does readiness change Service traffic?]{kind="recap"}
A failed readiness probe sets the Pod's `Ready` condition to false while the container keeps running. The EndpointSlice controller reflects that state, allowing Service proxies to withhold normal traffic until the replica reports ready again.
:::

:::expand[When should liveness restart a container?]{kind="recap"}
Liveness should fail for a persistent local state that a fresh process can repair, such as a stuck event loop. Shared dependency failures call for separate monitoring, degraded application behaviour, or readiness handling chosen from the caller's needs.
:::

:::expand[How does startup give a slow application time to initialize?]{kind="recap"}
The startup probe owns a bounded initialization period. Readiness and liveness start after its first success, so a valid slow boot can finish before traffic or restart decisions begin.
:::

:::expand[How do timing settings turn probe results into action?]{kind="recap"}
The handler produces one result, while the period, timeout, and consecutive-result thresholds decide when Kubernetes changes state. Startup and liveness failures can restart a container; readiness failures change Pod and endpoint readiness.
:::

:::expand[How can you verify that the probes behave correctly?]{kind="recap"}
Create one controlled staging condition for each probe and observe its specific result. Slow startup should preserve the container, readiness failure should change endpoint eligibility with a stable restart count, and liveness failure should produce one restart with matching events and previous logs.
:::

## References

- [Kubernetes: Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/) - Defines each probe's responsibility, handler types, thresholds, and failure actions.
- [Kubernetes: Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Provides the current configuration fields, startup handoff behaviour, and probe-level termination grace period.
- [Kubernetes: EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Explains endpoint `ready`, `serving`, and `terminating` conditions used for Service routing.
- [Kubernetes: Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) - Connects container states, restarts, probes, and Pod readiness.
- [Kubernetes: Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/) - Documents Pod events, current logs, and previous-container logs used to verify probe behaviour.
