---
title: "Health Probes"
description: "Configure Kubernetes liveness, readiness, and startup probes so Pods enter traffic only when they can serve requests."
tags: ["Kubernetes", "Operations", "Reliability", "Probes"]
area: "Containers & Orchestration"
order: 1
id: article-containers-orchestration-kubernetes-operations-health-probes
---
## Table of Contents

- [Why Kubernetes Checks Health](#why-kubernetes-checks-health)
- [The Three Probe Questions](#the-three-probe-questions)
- [Readiness: Traffic Only Goes to Useful Pods](#readiness-traffic-only-goes-to-useful-pods)
- [Liveness: Restart Only When Restart Helps](#liveness-restart-only-when-restart-helps)
- [Startup: A Separate Window For Slow Boots](#startup-a-separate-window-for-slow-boots)
- [Timing: How Checks Turn Into Action](#timing-how-checks-turn-into-action)
- [Endpoint Design Inside the Application](#endpoint-design-inside-the-application)
- [Debugging Probe Failures](#debugging-probe-failures)
- [Operational Checklist](#operational-checklist)
- [References](#references)

## Why Kubernetes Checks Health
<!-- section-summary: Health probes tell Kubernetes when a running container can receive traffic, when it needs a restart, and when a slow boot deserves more time. -->

A Kubernetes **health probe** is a small check the kubelet runs against a container so the platform can make one of three production decisions: send traffic, restart the container, or wait during startup. The important idea is simple: a process can be running while the service is still unusable.

Use `devpolaris-orders-api` as the running example. The container process might start, bind port `8080`, and still fail real requests because database migrations are running, a cache is warming, or a required dependency is unavailable. Kubernetes needs a signal that says more than "the process exists."

The first production rule is: **running is not the same as ready**. Probes turn that difference into clear behavior during rollouts and incidents.

## The Three Probe Questions
<!-- section-summary: Readiness controls traffic, liveness controls restarts, and startup protects slow initialization before the other checks run. -->

The three probe types ask different questions about the same container. Keep the questions separate during design reviews:

| Probe | Question | Kubernetes action |
|---|---|---|
| Readiness | Can this Pod serve normal traffic right now? | Add or remove the Pod from Service endpoints |
| Liveness | Is the container stuck in a way a restart can repair? | Restart the container after repeated failures |
| Startup | Has the application finished its slow boot path? | Delay readiness and liveness until startup succeeds |

![Probe decision map showing startup, readiness, and liveness checks leading to boot waiting, Service traffic gating, and restart decisions](/content-assets/articles/article-containers-orchestration-kubernetes-operations-health-probes/probe-decision-map.png)

*The map keeps the actions separate: startup waits, readiness gates traffic, and liveness restarts a broken process.*

A useful probe design starts as a tiny skeleton. The exact paths and timing come later:

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: 8080
livenessProbe:
  httpGet:
    path: /livez
    port: 8080
startupProbe:
  httpGet:
    path: /startupz
    port: 8080
```

What this skeleton shows:

- `/readyz` answers the traffic question.
- `/livez` answers the restart question.
- `/startupz` gives the app boot path its own check.
- The paths can share code internally, but the meanings should stay separate.

## Readiness: Traffic Only Goes to Useful Pods
<!-- section-summary: A readiness probe removes a Pod from Service routing while the process is alive but unable to handle normal requests. -->

A **readiness probe** tells Kubernetes whether the Pod should receive Service traffic. During a rollout, this check keeps new Pods out of the load-balancing set until they can answer real user requests.

For `devpolaris-orders-api`, readiness should check the pieces required for a normal request path: the HTTP server is accepting requests, required configuration loaded, and the database connection pool can serve orders traffic. It should avoid expensive work such as a full checkout transaction.

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

Field notes:

- `periodSeconds: 10` checks often enough for rollouts without turning health checks into load.
- `timeoutSeconds: 2` keeps a hanging dependency check from tying up kubelet work.
- `failureThreshold: 3` gives short blips room while still removing bad Pods quickly.

When readiness fails, Kubernetes keeps the Pod running and removes it from endpoints. A useful check during rollout is:

```bash
$ kubectl -n orders get endpointslice -l kubernetes.io/service-name=devpolaris-orders-api
NAME                         ADDRESSTYPE   PORTS   ENDPOINTS
devpolaris-orders-api-7p8ql  IPv4          8080    10.42.3.18,10.42.4.21
```

What this output tells you:

- Only ready Pod IPs should appear as endpoints for the Service.
- If the new Pod IP is missing, inspect readiness events before changing Service YAML.
- If an unready Pod still receives traffic, check labels and Service selectors.

## Liveness: Restart Only When Restart Helps
<!-- section-summary: A liveness probe should catch stuck process states while readiness handles ordinary dependency outages. -->

A **liveness probe** tells kubelet when the container should be restarted. Use it for states such as deadlocks, wedged event loops, or an application process that stopped making internal progress.

Keep liveness narrower than readiness. If PostgreSQL is down, restarting every API Pod usually creates more churn while the database is still unavailable. Readiness can remove Pods from traffic, while liveness should focus on process health.

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 8080
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

What the behavior shows:

- Three failed checks trigger a container restart.
- A successful check resets the failure count.
- The restart count on the Pod should increase only for failures where restart is the intended repair.

The fastest evidence check is the Pod status:

```bash
$ kubectl -n orders get pod devpolaris-orders-api-7d9f9c8f75-6qv2z
NAME                                      READY   STATUS    RESTARTS   AGE
devpolaris-orders-api-7d9f9c8f75-6qv2z    1/1     Running   1          14m
```

This output says kubelet has restarted the container once. Pair it with events and previous logs before changing the probe, because a restart count alone only tells you the action happened.

## Startup: A Separate Window For Slow Boots
<!-- section-summary: A startup probe prevents liveness from killing an application during legitimate initialization work. -->

A **startup probe** gives a slow application a protected boot window. While startup is failing, kubelet holds back liveness and readiness checks for that container.

Use startup for workloads that perform expected initialization: loading a large model, running local cache preparation, warming route tables, or waiting for embedded workers. For the orders API, startup might allow the process to load configuration and finish schema checks before normal probes begin.

```yaml
startupProbe:
  httpGet:
    path: /startupz
    port: 8080
  periodSeconds: 5
  failureThreshold: 24
```

This configuration gives the app up to about two minutes to boot: `5 seconds * 24 failures`. After startup succeeds once, kubelet switches to readiness and liveness for ongoing decisions.

Use events to confirm startup behavior:

```bash
$ kubectl -n orders describe pod devpolaris-orders-api-7d9f9c8f75-6qv2z
Events:
  Type     Reason     Age   From     Message
  Warning  Unhealthy  45s   kubelet  Startup probe failed: HTTP probe failed with statuscode: 503
  Normal   Pulled     60s   kubelet  Container image already present on machine
```

The event shows kubelet waited during startup rather than restarting immediately. If the startup window is too short, the Pod may restart before the application ever reaches readiness.

## Timing: How Checks Turn Into Action
<!-- section-summary: Probe timing fields convert temporary failures into platform actions after a defined number of attempts. -->

Probe timing fields decide how patient Kubernetes should be. The defaults rarely describe your application perfectly, so production probes deserve explicit timing.

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 2
  successThreshold: 1
  failureThreshold: 3
```

Field meanings:

- `initialDelaySeconds` waits before the first check.
- `periodSeconds` sets the interval between checks.
- `timeoutSeconds` sets how long kubelet waits for one response.
- `failureThreshold` sets how many failures trigger the action.
- `successThreshold` matters most for readiness because it can require repeated success before traffic returns.

![Probe timing window showing initial delay, period, timeout, failure threshold, and the action after repeated probe failures](/content-assets/articles/article-containers-orchestration-kubernetes-operations-health-probes/probe-timing-window.png)

*The timing window shows how Kubernetes turns repeated check results into traffic or restart decisions.*

## Endpoint Design Inside the Application
<!-- section-summary: Good health endpoints are cheap, clear, and mapped to the exact platform action they control. -->

The application owns the meaning of each endpoint. Kubernetes only receives pass or fail. That means the app team should design health endpoints as production contracts instead of leftover routes.

For `devpolaris-orders-api`, a practical shape is:

| Endpoint | Should check | Should avoid |
|---|---|---|
| `/startupz` | Boot tasks finished, configuration loaded | Long dependency calls |
| `/readyz` | Required dependencies for normal request traffic | Optional analytics or heavy queries |
| `/livez` | Main process loop is responsive | Database availability |

Useful response examples:

```bash
$ curl -s http://localhost:8080/readyz
{"status":"ok","checks":{"database":"ok","config":"ok"}}

$ curl -s http://localhost:8080/readyz
{"status":"fail","checks":{"database":"timeout","config":"ok"}}
```

What these responses give responders:

- The status tells Kubernetes whether to route traffic.
- The named checks tell humans why traffic changed.
- The endpoint stays cheap enough to run often.

## Debugging Probe Failures
<!-- section-summary: Probe debugging should read Pod state, events, endpoints, and application logs before changing probe thresholds. -->

When a rollout stalls, avoid guessing from the YAML first. Build the evidence path in this order: Pod state, kubelet events, endpoint membership, application logs, then endpoint behavior.

```bash
$ kubectl -n orders get pod -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                      READY   STATUS    RESTARTS   AGE
devpolaris-orders-api-7d9f9c8f75-6qv2z    0/1     Running   0          2m

$ kubectl -n orders describe pod devpolaris-orders-api-7d9f9c8f75-6qv2z
Events:
  Type     Reason     Message
  Warning  Unhealthy  Readiness probe failed: HTTP probe failed with statuscode: 503
```

What this evidence says:

- The process is running.
- Readiness is failing.
- Kubernetes should keep the Pod out of Service endpoints.
- The next check should be application logs or the `/readyz` response before increasing timeouts.

If liveness caused restarts, add previous logs:

```bash
$ kubectl -n orders logs pod/devpolaris-orders-api-7d9f9c8f75-6qv2z -c api --previous --tail=40
2026-06-30T10:14:22Z ERROR health /livez failed: event loop watchdog stalled for 45s
```

This output ties the restart to a named application condition. That is the kind of evidence you want before changing liveness behavior.

## Operational Checklist
<!-- section-summary: A useful probe review ties each health check to the Kubernetes action, the app endpoint, and the evidence gathered in staging. -->

Use this checklist before merging probe changes for `devpolaris-orders-api`:

| Review question | Good answer |
|---|---|
| What does readiness prove? | The Pod can handle normal orders API traffic now |
| What does liveness prove? | The process is stuck in a way restart can repair |
| What does startup protect? | Legitimate boot work such as config loading and cache warmup |
| Are checks cheap? | They avoid heavy queries and optional external calls |
| Are probe failures diagnosable? | App logs name the failing health component |
| Did staging prove the action? | EndpointSlices, logs, events, and restart counts match the design |

![Health probe operations checklist with cheap endpoints, startup protection, readiness traffic control, liveness restart scope, events, and dashboards](/content-assets/articles/article-containers-orchestration-kubernetes-operations-health-probes/health-probe-operations-checklist.png)

*The checklist turns probe review into production behavior: prove endpoint cost, traffic effect, restart effect, and incident evidence.*

A concise final review note works well here: readiness failed during a PostgreSQL block and removed the Pod from endpoints; liveness kept passing; a simulated process stall triggered one restart with matching previous logs. That note proves the probes direct Kubernetes to take the intended action.

## References

- [Kubernetes: Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Official guide for probe fields, HTTP/TCP/command/gRPC probes, and failure behavior.
- [Kubernetes: Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) - Explains Pod phases, container states, readiness, and restart behavior.
- [Kubernetes: Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Describes how Services route traffic to ready endpoints.
- [Kubernetes: EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Documents EndpointSlice objects that represent Service backends.
- [Kubernetes: Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/) - Shows practical Pod inspection, events, and log commands.
