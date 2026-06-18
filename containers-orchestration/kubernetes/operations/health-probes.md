---
title: "Health Probes"
description: "Configure Kubernetes liveness, readiness, and startup probes so Pods enter traffic only when they can serve requests."
overview: "Health probes let Kubernetes ask a container specific questions before routing traffic or restarting it. You will use devpolaris-orders-api to design probes that protect users without hiding real application failures."
tags: ["probes", "readiness", "liveness", "kubectl"]
order: 1
id: article-containers-orchestration-kubernetes-operations-health-probes
---

## Table of Contents

1. [Why Kubernetes Checks Health](#why-kubernetes-checks-health)
2. [The Three Probe Questions](#the-three-probe-questions)
3. [Readiness: Traffic Only Goes to Useful Pods](#readiness-traffic-only-goes-to-useful-pods)
4. [Liveness: Restart Only When Restart Helps](#liveness-restart-only-when-restart-helps)
5. [Startup: Slow Boots Need a Separate Window](#startup-slow-boots-need-a-separate-window)
6. [Timing: How Kubernetes Turns Checks Into Action](#timing-how-kubernetes-turns-checks-into-action)
7. [Endpoint Design Inside the Application](#endpoint-design-inside-the-application)
8. [Debugging Probe Failures](#debugging-probe-failures)
9. [Operational Checklist](#operational-checklist)

## Why Kubernetes Checks Health
<!-- section-summary: A running container can still be unsafe for traffic, so probes give Kubernetes a small health signal it can act on. -->

A Pod can look alive from the outside while the application inside it has no useful response for a user yet. The container process may have started, the port may be open, and the Pod may show `Running` while the app is still loading configuration, opening a database pool, replaying migrations, or recovering from a stuck worker thread.

For our scenario, the team runs **devpolaris-orders-api** in the `orders` namespace. It receives checkout requests, reads and writes PostgreSQL, and publishes order events to a queue. The Deployment has three replicas behind a Kubernetes Service, and the Service should send traffic only to replicas that can answer real requests.

**Health probes** are small checks that kubelet runs for a container. **Kubelet** is the node agent that starts containers, watches them, and reports status back to the Kubernetes control plane. A probe can call an HTTP path, open a TCP socket, run a command inside the container, or use a gRPC health check when the application supports it.

That last sentence matters because probes are not just dashboard labels. Kubernetes uses them to make decisions. A failing readiness probe changes Service traffic. A failing liveness probe restarts a container. A startup probe delays the other checks while an application is still booting.

The orders team cares because a rollout can have all three situations in one afternoon. A new Pod should stay out of traffic until it has loaded its config. A wedged process should restart. A slow image should get enough boot time so Kubernetes does not kill it during normal startup work.

## The Three Probe Questions
<!-- section-summary: Startup, readiness, and liveness probes ask different questions, and each failed answer leads to a different Kubernetes action. -->

Kubernetes gives you three probe fields because one health endpoint cannot safely answer every operational question. A good probe design starts by matching the check to the action you want Kubernetes to take.

Here is the practical map for `devpolaris-orders-api`. Keep your eye on the action column because that is what users will feel during a rollout or incident:

| Probe | Question | Kubernetes action after repeated failure |
|---|---|---|
| **startupProbe** | Has the container finished its slow startup work? | Keep waiting before liveness and readiness are enforced |
| **readinessProbe** | Can this Pod receive normal Service traffic right now? | Remove the Pod from Service endpoints |
| **livenessProbe** | Is this container stuck in a way restart can repair? | Restart the container |

The safest order is usually startup first for slow applications, readiness for traffic protection, and liveness only for process failures. Readiness is gentle because it gives the process time to recover. Liveness is stronger because kubelet kills and restarts the container.

For the orders API, a readiness failure during a short PostgreSQL outage is acceptable. The Pod leaves traffic and can rejoin after the database recovers. A liveness failure for that same PostgreSQL outage is risky because every replica might restart and reconnect at once, which adds load at the worst moment.

This is the first review question I like to ask on a probe pull request: **if this check fails, what exactly will Kubernetes do to traffic or to the process?** Once the team can answer that clearly, the YAML has a purpose instead of just a copied snippet.

## Readiness: Traffic Only Goes to Useful Pods
<!-- section-summary: Readiness protects users by keeping a Pod out of Service traffic until it can handle the normal request path. -->

A **readiness probe** controls whether a Pod is included in Service endpoints. When readiness fails, Kubernetes removes the Pod from normal Service traffic and keeps the container running so it can recover. That makes readiness the right place to check the things required for user requests.

For `devpolaris-orders-api`, readiness should prove that the HTTP server can answer, required configuration is loaded, and the PostgreSQL connection pool can borrow a connection quickly. If the queue publisher is required for every checkout, include a cheap queue check too. If analytics export is optional, keep it out of readiness so a reporting outage does not remove the API from traffic.

Here is a realistic Deployment slice. The example keeps the labels stable because those labels will also help with logs, metrics, and selectors later:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  namespace: orders
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-orders-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: devpolaris-orders-api
        app.kubernetes.io/component: api
        app.kubernetes.io/part-of: devpolaris
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026-05-07.1
          ports:
            - name: http
              containerPort: 8080
          readinessProbe:
            httpGet:
              path: /health/ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
```

The named port `http` keeps the probe readable and stable if the numeric port changes later. `periodSeconds: 10` means kubelet checks every ten seconds. `failureThreshold: 3` means Kubernetes needs three failed readiness checks in a row before it marks the Pod not ready.

The effect shows up in Pod readiness and EndpointSlices. This is the quickest way to prove whether a readiness failure changed Service routing:

```bash
$ kubectl -n orders get pods -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                      READY   STATUS    RESTARTS   AGE
devpolaris-orders-api-7c96df7d7c-2vd6k   1/1     Running   0          6m
devpolaris-orders-api-7c96df7d7c-dh8xq   1/1     Running   0          6m
devpolaris-orders-api-7c96df7d7c-q94r7   0/1     Running   0          72s

$ kubectl -n orders get endpointslice \
  -l kubernetes.io/service-name=devpolaris-orders-api
NAME                           ADDRESSTYPE   PORTS   ENDPOINTS
devpolaris-orders-api-cqtzn    IPv4          8080    10.244.1.21,10.244.2.33
```

The third Pod is running and currently unready. Its IP is absent from the EndpointSlice, so the Service sends traffic to the two ready replicas. That is a healthy rollout pattern when the new Pod is still warming up or waiting for a dependency.

This also explains why readiness should be cheap. Kubelet runs it often, and every replica answers it often. A readiness endpoint that performs a heavy database query can create its own production load, especially during a rollout with many Pods starting at once.

## Liveness: Restart Only When Restart Helps
<!-- section-summary: Liveness should identify a wedged process, not every short dependency problem, because failure restarts the container. -->

A **liveness probe** tells kubelet when the container should be restarted. It is useful when the process is stuck in a state where continuing to run is worse than starting a fresh process. Think of a deadlocked event loop, a worker thread that no longer accepts work, or an HTTP server that cannot answer even a shallow local health request.

The important design point is that liveness should focus on the process, not the whole outside world. If PostgreSQL is unavailable for thirty seconds, restarting the API does not repair PostgreSQL. It can also make recovery harder by forcing all API replicas to reconnect and rebuild caches at the same time.

For `devpolaris-orders-api`, liveness can be a shallow in-process endpoint. The timing is slower than readiness because restart is the stronger action:

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: http
  initialDelaySeconds: 20
  periodSeconds: 20
  timeoutSeconds: 2
  failureThreshold: 3
```

This configuration waits at least twenty seconds before liveness begins. After that, kubelet needs three failed checks spaced twenty seconds apart before it restarts the container. The service gets about a minute of tolerance for short pauses before Kubernetes takes the stronger action.

When liveness fires, the evidence appears in `describe pod`. That output is usually more useful than guessing from the restart count alone:

```bash
$ kubectl -n orders describe pod devpolaris-orders-api-7c96df7d7c-2vd6k
Containers:
  api:
    State:          Running
    Last State:     Terminated
      Reason:       Error
      Exit Code:    137
    Ready:          True
    Restart Count:  1
Events:
  Type     Reason     Age   From     Message
  Warning  Unhealthy  3m    kubelet  Liveness probe failed: HTTP probe failed with statuscode: 500
  Normal   Killing    3m    kubelet  Container api failed liveness probe, will be restarted
```

That event tells you the restart came from kubelet's liveness decision. It did not come from an image pull error, a manual restart, a scheduler issue, or the application exiting by itself. The next useful move is to read the application logs around the first `Unhealthy` event.

## Startup: Slow Boots Need a Separate Window
<!-- section-summary: Startup probes give slow containers time to finish booting before liveness and readiness checks start enforcing behavior. -->

A **startup probe** protects applications that need extra time during boot. While startup is still failing, Kubernetes disables liveness and readiness checks for that container. Once startup passes, kubelet starts applying the normal readiness and liveness behavior.

This is useful for the orders API after the team adds a larger policy bundle, a cache warmup step, or a migration check that can take more than a few seconds. Without a startup probe, liveness might kill a container that is still doing legitimate boot work.

The timing is simple multiplication. This example gives the app a generous boot window without delaying a fast successful startup:

```yaml
startupProbe:
  httpGet:
    path: /health/startup
    port: http
  periodSeconds: 5
  failureThreshold: 24
```

This gives the container up to 120 seconds to pass startup because `5 * 24 = 120`. The endpoint should return success only after the application has finished the work that must happen before normal checks make sense. It should not pass at the first line of the main function if the app still needs another minute before it can serve traffic.

Startup is also cleaner than inflating `initialDelaySeconds` for liveness. A fixed delay guesses how long boot takes every time. A startup probe lets a fast boot continue quickly and gives a slow boot the full allowed window.

For the orders team, a good startup endpoint might check that configuration loaded, required secrets were parsed, the HTTP server is bound, and local caches that must exist before serving traffic are ready. It can leave normal database availability to readiness unless the process truly cannot start without the database.

## Timing: How Kubernetes Turns Checks Into Action
<!-- section-summary: Probe timing controls how much temporary failure Kubernetes tolerates before changing traffic or restarting a container. -->

Probe timing decides how quickly Kubernetes reacts and how much short noise it tolerates. The same endpoint can behave very differently with a one-second timeout and one failure versus a two-second timeout and three consecutive failures.

These fields show up often. Read them as a schedule for how kubelet turns repeated probe answers into behavior:

| Field | Meaning | Practical starting point |
|---|---|---|
| `initialDelaySeconds` | Wait before the first check starts | Keep small when startupProbe handles slow boot |
| `periodSeconds` | Time between checks | 5 to 20 seconds for many APIs |
| `timeoutSeconds` | Time allowed for one probe response | 1 to 3 seconds for cheap health endpoints |
| `failureThreshold` | Failed checks needed before action | Higher for noisy dependencies |
| `successThreshold` | Successful checks needed before ready | Readiness can use more than 1 |

For readiness, `periodSeconds: 10` and `failureThreshold: 3` usually means about thirty seconds of failed checks before the Pod leaves endpoints. For liveness, the same math means about thirty seconds before restart, plus any initial delay or startup window. Kubernetes works from repeated observations, not from one failed HTTP response.

The orders API should pick timing from real behavior. If normal startup takes 35 seconds and p95 startup takes 70 seconds after a cold node pull, a 120-second startup window is reasonable. If the readiness endpoint sometimes waits two seconds on a database connection, a one-second timeout may create false failures.

It helps to write down the expected operational behavior beside the YAML during review. This makes the review about real failures rather than taste in timeout numbers:

| Scenario | Desired behavior |
|---|---|
| New Pod needs 60 seconds to warm a cache | Startup keeps liveness away until boot finishes |
| PostgreSQL has a short outage | Readiness fails and Pod leaves traffic, liveness keeps passing |
| HTTP server deadlocks | Liveness fails and kubelet restarts the container |
| Optional analytics service is down | Readiness and liveness keep passing |

That table turns probe tuning into a production decision. The reviewer is no longer arguing about numbers in isolation; they are checking whether the numbers match the failure the team expects.

## Endpoint Design Inside the Application
<!-- section-summary: Good probe endpoints are cheap, specific, and honest about the exact question each probe is supposed to answer. -->

Kubernetes can only act on the response your application gives. That means the health endpoint design inside `devpolaris-orders-api` matters as much as the Deployment YAML. A vague `/health` endpoint often causes trouble because nobody remembers whether it checks the database, the queue, local process state, or all of them.

A clearer design uses separate endpoints. The names matter less than the promise each endpoint keeps:

| Endpoint | Checks | Avoids |
|---|---|---|
| `/health/startup` | Required config, secret parsing, server boot, required local cache | Optional downstream services |
| `/health/ready` | Required dependencies for normal requests, such as PostgreSQL and the required queue path | Heavy queries and optional integrations |
| `/health/live` | Process responsiveness and basic event-loop or worker health | Short PostgreSQL, Redis, queue, or network failures |

The readiness endpoint can check PostgreSQL with a short timeout and a cheap operation. A good check might borrow a connection and run a lightweight query such as `SELECT 1`, then release the connection. A bad check might scan an orders table, call an external payment provider, or allocate a large object on every probe.

The endpoint should also log useful component names when it fails. Kubelet records that the probe failed, but the application should explain which internal check returned the failed status. That makes production diagnosis much faster.

```log
2026-05-07T10:14:20Z warn health_readiness_failed component=postgres timeout_ms=800 error="connection timeout"
2026-05-07T10:14:30Z warn health_readiness_failed component=postgres timeout_ms=800 error="connection timeout"
2026-05-07T10:14:40Z info health_readiness_recovered component=postgres
```

Those log lines tell the team this was a readiness and PostgreSQL problem. They do not suggest the process was dead. If the same failure had triggered liveness, the logs would point to a probe design issue.

## Debugging Probe Failures
<!-- section-summary: Probe debugging uses kubelet events, app logs, endpoints, and Service routing before YAML changes. -->

When a probe failure appears in production, the first job is to learn which probe failed and what Kubernetes did because of it. Start with the exact Pod, because Deployment-level output hides the kubelet event details.

```bash
$ kubectl -n orders describe pod devpolaris-orders-api-7c96df7d7c-2vd6k | sed -n '/Events:/,$p'
$ kubectl -n orders logs pod/devpolaris-orders-api-7c96df7d7c-2vd6k -c api --tail=100
$ kubectl -n orders get endpointslice -l kubernetes.io/service-name=devpolaris-orders-api -o wide
```

The first command shows kubelet's decision. The second command shows what the application reported around that time. The third command shows whether Service traffic changed. Together they separate traffic removal from process restart.

If the Pod restarted, previous logs are often the useful logs. They show what the old container said before kubelet replaced it:

```bash
$ kubectl -n orders logs pod/devpolaris-orders-api-7c96df7d7c-2vd6k -c api --previous --tail=100
```

`--previous` reads logs from the terminated container instance. That matters when the current container has already started again and has not reached the failing code path yet.

There is one failure pattern worth calling out because it causes many incidents. The team reuses `/health` for readiness and liveness, and `/health` checks PostgreSQL. During a database maintenance window, readiness and liveness both fail. Kubernetes removes the Pods from traffic and also restarts them, even though restart cannot repair the database.

The fix is usually a split endpoint design. Readiness can represent dependency health while liveness stays focused on process health:

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: http

livenessProbe:
  httpGet:
    path: /health/live
    port: http
```

After the split, the database outage should make readiness fail while liveness keeps passing. The restart count should stay flat. That is the production behavior you want to prove in staging before relying on it.

## Operational Checklist
<!-- section-summary: A useful probe review ties each health check to the Kubernetes action, the app endpoint, and the evidence gathered in staging. -->

Before merging probe changes for `devpolaris-orders-api`, review the probes as traffic and restart rules. The fields are small, but the behavior touches rollouts, incidents, Service routing, and application recovery.

| Review question | Good answer |
|---|---|
| What does readiness prove? | The Pod can handle normal orders API traffic now |
| What does liveness prove? | The process is stuck in a way restart can repair |
| What does startup protect? | Legitimate boot work such as config loading and cache warmup |
| Are checks cheap? | They avoid heavy queries and optional external calls |
| Are probe failures diagnosable? | App logs name the failing health component |
| Did staging prove the expected action? | EndpointSlices, logs, and restart counts match the design |

A strong probe evidence note is short and specific. It should show both the healthy path and one expected failure path:

| Evidence item | Observation |
|---|---|
| Healthy rollout | Pod passed startup at `10:02:39Z` and readiness at `10:02:42Z` |
| Endpoint routing | EndpointSlice included the Pod IP after readiness passed |
| Dependency outage test | Readiness failed during PostgreSQL block and Pod left endpoints |
| Restart behavior | Liveness kept passing and restart count stayed `0` |
| Deadlock test | Liveness failed three times and kubelet restarted only the affected container |

That kind of note tells a reviewer the probes did what the team intended. The review is not about liking one timeout more than another. It is about proving that Kubernetes changes traffic, waits, or restarts at the right moment.

Keep one final rule in your head during operations: **readiness changes traffic, liveness changes the process, and startup changes when the other two checks begin.** If the team can say which action they want for each failure, the probe design will stay much calmer during incidents.

---

**References**

- [Kubernetes: Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Official guide for probe fields, HTTP/TCP/command/gRPC probes, and failure behavior.
- [Kubernetes: Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) - Explains Pod phases, container states, readiness, and restart behavior.
- [Kubernetes: Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Describes how Services route traffic to ready endpoints.
- [Kubernetes: EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Documents EndpointSlice objects that represent Service backends.
- [Kubernetes: Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/) - Shows practical Pod inspection, events, and log commands.
