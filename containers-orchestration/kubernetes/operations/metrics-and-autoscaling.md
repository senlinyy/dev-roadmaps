---
title: "Metrics and Autoscaling"
description: "Use Kubernetes metrics and autoscaling signals to scale applications without guessing replica counts."
overview: "Metrics turn cluster behavior into numbers you can compare. Autoscaling uses selected metrics to change replicas, but the signal must match the real bottleneck for devpolaris-orders-api."
tags: ["metrics", "hpa", "autoscaling", "resources"]
order: 3
id: article-containers-orchestration-kubernetes-operations-metrics-and-autoscaling
---

## Table of Contents

1. [Scaling Starts With a Measured Signal](#scaling-starts-with-a-measured-signal)
2. [Resource Requests Give HPA a Baseline](#resource-requests-give-hpa-a-baseline)
3. [Reading Metrics From Pods and Nodes](#reading-metrics-from-pods-and-nodes)
4. [Horizontal Pod Autoscaling](#horizontal-pod-autoscaling)
5. [Choose Metrics That Match the Bottleneck](#choose-metrics-that-match-the-bottleneck)
6. [Custom and External Metrics](#custom-and-external-metrics)
7. [Guardrails: Min, Max, Behavior, and Dependencies](#guardrails-min-max-behavior-and-dependencies)
8. [Debugging Autoscaling Surprises](#debugging-autoscaling-surprises)
9. [Operational Checklist](#operational-checklist)

## Scaling Starts With a Measured Signal
<!-- section-summary: Autoscaling works only when the metric represents the real capacity limit that users are hitting. -->

Scaling sounds simple from a distance. Traffic goes up, add more Pods. Traffic goes down, remove Pods. In production, the hard part is choosing the signal that tells Kubernetes when more Pods will actually help.

The running service is still **devpolaris-orders-api** in the `orders` namespace. It receives checkout requests, writes to PostgreSQL, and publishes order events to a queue. During a lunch traffic spike, p95 latency rises from 180ms to 900ms. The team needs to know whether more API Pods will reduce that latency or just put more pressure on the database and queue.

A **metric** is a measured number about the system. CPU usage, memory usage, request rate, error count, queue depth, database wait time, and p95 latency are all metrics. An **autoscaler** is a controller that changes capacity based on selected metrics. In Kubernetes, the most common application autoscaler is the **HorizontalPodAutoscaler**, usually called HPA.

**Horizontal scaling** means adding or removing Pods. **Vertical scaling** means changing CPU or memory for a Pod. **Cluster scaling** means adding or removing nodes. These tools can work together, but they answer different questions. HPA can ask for more orders API Pods, but it cannot create node capacity by itself unless a cluster autoscaler is also running.

For the orders API, the first operational question is not "what HPA YAML should we write?" The first question is **what is the bottleneck?** If each Pod is CPU-bound while parsing JSON and calculating totals, more Pods can help. If requests wait on PostgreSQL locks, more API Pods may increase the lock pressure and make latency worse.

## Resource Requests Give HPA a Baseline
<!-- section-summary: CPU-based HPA needs CPU requests because utilization is calculated as a percentage of requested CPU. -->

A **resource request** is the amount of CPU or memory Kubernetes uses as the scheduling baseline for a container. Requests tell the scheduler how much node capacity to reserve. CPU requests also give HPA the denominator it needs for CPU utilization.

For example, if the orders API requests `500m` CPU and currently uses `350m`, it is using 70 percent of its requested CPU. If the same container has no CPU request, HPA cannot calculate a CPU utilization percentage for that container.

Here is a practical starting point for the Deployment. Treat these values as an example to test, not a universal setting:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  namespace: orders
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026-05-07.1
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
```

`500m` means half of one CPU core. The memory values use binary units, so `512Mi` is 512 mebibytes. These are not magic numbers; they should come from observation in staging, load tests, and production dashboards.

Memory deserves a careful note. Memory requests help scheduling, and memory limits protect nodes from one process consuming too much memory. Memory is usually a weaker HPA signal for web APIs because adding replicas does not fix a memory leak. If every Pod slowly grows until it hits the limit, the answer is code, caching behavior, or workload shape, not endless replicas.

Resource requests also affect cost and scheduling. If the CPU request is too high, the scheduler may leave node space unused because it reserves more CPU than the container normally needs. If the request is too low, HPA percentages can look high too early and node pressure can surprise you during spikes.

## Reading Metrics From Pods and Nodes
<!-- section-summary: kubectl top gives a quick live view, while dashboards and Prometheus provide history and application context. -->

Kubernetes resource metrics usually come from **Metrics Server**, which exposes recent CPU and memory usage through the resource metrics API. The `kubectl top` command reads that API. It gives a quick live check with a short history window, so dashboards and Prometheus-style storage still matter for trend analysis.

For the orders API, a first terminal check might look like this. The output gives a live snapshot of resource pressure on each replica:

```bash
$ kubectl -n orders top pods -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                      CPU(cores)   MEMORY(bytes)
devpolaris-orders-api-7c96df7d7c-2vd6k   420m         382Mi
devpolaris-orders-api-7c96df7d7c-dh8xq   465m         401Mi
devpolaris-orders-api-7c96df7d7c-q94r7   438m         390Mi
```

If those Pods request `500m` CPU each, they are using roughly 84 to 93 percent of requested CPU. That is useful pressure evidence, especially if request latency rises at the same time and the database looks healthy.

Node metrics answer a different question: can the cluster place more Pods if HPA asks for them? This matters because a replica recommendation still has to fit somewhere:

```bash
$ kubectl top nodes
NAME       CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
worker-1   1820m        45%    6110Mi          52%
worker-2   2190m        54%    6880Mi          58%
worker-3   2010m        50%    6405Mi          54%
```

This cluster has room for more orders API Pods. If node CPU were already near saturation, HPA could increase the desired replica count while new Pods remain `Pending`. That would move the discussion to cluster autoscaling, node size, requests, or workload placement.

In a dashboard, the orders team should look at more than CPU and memory. The minimum useful panel set is request rate, p50/p95/p99 latency, error rate, CPU per Pod, memory per Pod, HPA desired replicas, HPA current replicas, ready Pods, pending Pods, PostgreSQL connection count, and queue depth. That set lets the team see whether scaling changed the user symptom or only changed the number of Pods.

## Horizontal Pod Autoscaling
<!-- section-summary: HPA watches selected metrics and updates the target Deployment replica count within configured boundaries. -->

A **HorizontalPodAutoscaler** is a Kubernetes controller that updates the replica count for a scalable workload such as a Deployment. It does not send traffic itself. It changes the desired number of Pods, and the Deployment plus ReplicaSet create or remove Pods to match that desired count.

Here is a CPU-based HPA for the orders API. It scales the Deployment, and the Deployment still owns the Pods:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: devpolaris-orders-api
  namespace: orders
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: devpolaris-orders-api
  minReplicas: 3
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

This tells HPA to keep average CPU utilization near 70 percent of requested CPU across the Pods. It can move the Deployment between three and twelve replicas. The floor protects availability, and the ceiling protects cost and downstream systems.

After applying it, status is the first thing to read. The short table tells you whether the current metric is above or below the target:

```bash
$ kubectl -n orders get hpa devpolaris-orders-api
NAME                   REFERENCE                         TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
devpolaris-orders-api  Deployment/devpolaris-orders-api   88%/70%   3         12        5          6m
```

The short table says current CPU is above the target and the Deployment currently has five replicas. `describe hpa` gives the conditions that explain whether scaling is active, limited, or blocked.

```bash
$ kubectl -n orders describe hpa devpolaris-orders-api
Metrics:                                               (current / target)
  resource cpu on pods  (as a percentage of request):  68% (340m) / 70%
Min replicas:                                          3
Max replicas:                                          12
Deployment pods:                                       7 current / 7 desired
Conditions:
  Type            Status  Reason              Message
  AbleToScale     True    ReadyForNewScale     recommended size matches current size
  ScalingActive   True    ValidMetricFound     the HPA was able to calculate a replica count
  ScalingLimited  False   DesiredWithinRange   the desired count is within the acceptable range
```

Those condition names are worth reading during incidents. `ScalingActive=False` often means HPA cannot calculate from the metric. `ScalingLimited=True` often means the recommended replica count hit `minReplicas` or `maxReplicas`.

## Choose Metrics That Match the Bottleneck
<!-- section-summary: The scaling metric should measure the part of the request path that runs out of capacity first. -->

A **bottleneck** is the part of the system that reaches its limit before the rest. Autoscaling helps when the metric points at that limit and the scaling action relieves it. CPU is a good first metric for some APIs, and other workloads need queue, database, latency, or upstream metrics.

For the orders API, compare the user symptom with several possible constraints. The right row depends on what the request path is actually waiting for:

| Symptom | Metric to check | Likely action |
|---|---|---|
| CPU rises with request latency | CPU utilization per Pod | Scale API Pods if nodes and dependencies have room |
| API queue grows inside the process | In-flight requests or request queue depth | Scale API Pods and inspect downstream limits |
| Checkout waits on database locks | PostgreSQL lock wait and slow query metrics | Fix query, index, or transaction design |
| Events pile up after checkout | Queue depth per worker replica | Scale `devpolaris-orders-worker` or improve worker throughput |
| Memory grows until OOM kills happen | Memory growth, restarts, OOM events | Fix leak, cache, or limit behavior |
| External payment API slows down | Upstream latency and error rate | Add backpressure, retries with limits, or circuit breaking |

This is where a senior review can save a lot of pain. If CPU is high and the app is stateless, HPA on CPU is often a reasonable first pass. If CPU is low and latency is high, the bottleneck probably lives somewhere else in the request path.

The orders team should connect each HPA change to a user-facing hypothesis. That keeps the autoscaling change tied to an outcome rather than a habit:

| Hypothesis | Evidence needed |
|---|---|
| More API Pods will lower checkout p95 latency | CPU rises with traffic, database waits stay low, new replicas reduce p95 |
| More API Pods will overload PostgreSQL | Database connections or waits climb faster than request throughput |
| Worker scaling will drain the queue | Queue depth per worker falls after worker replicas increase |

That language keeps autoscaling out of "just add more Pods" mode. The metric, the bottleneck, and the scaling action have to line up.

## Custom and External Metrics
<!-- section-summary: CPU metrics are built in, but production autoscaling often needs application or external metrics such as latency and queue depth. -->

**Custom metrics** are metrics about Kubernetes objects that are not built-in CPU or memory resource metrics. **External metrics** are metrics from outside the cluster or not tied directly to one Kubernetes object, such as a managed queue depth. HPA can use both through the Kubernetes metrics APIs when an adapter provides them.

Many teams use **Prometheus** to collect application metrics and a Prometheus adapter to expose selected metrics to HPA. Another common option for event-driven scaling is **KEDA**, which can scale workloads from queue, stream, database, and cloud service signals. OpenTelemetry can standardize how the application emits metrics before Prometheus or another backend stores them.

For `devpolaris-orders-api`, latency can be a useful dashboard metric, but it is often tricky as a direct HPA signal. Latency can rise because of CPU pressure, database locks, network problems, or a slow upstream provider. Scaling on latency without guardrails can add more callers to a struggling dependency.

Queue depth is usually a clearer scaling signal for workers. The worker is the component that drains the queue, so it should own this scaling action:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: devpolaris-orders-worker
  namespace: orders
spec:
  scaleTargetRef:
    name: devpolaris-orders-worker
  minReplicaCount: 2
  maxReplicaCount: 20
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc:9090
        metricName: order_events_ready
        query: sum(order_events_ready{namespace="orders"})
        threshold: "200"
```

This example scales the worker rather than the API. That distinction matters. If checkout requests are fast while background order events are delayed, the worker owns the slow step. Scaling the API would add more events to the queue without increasing drain speed.

For application metrics, write the target in plain English next to the configuration. This gives future reviewers the reason behind the threshold:

| Metric | Target meaning |
|---|---|
| `order_events_ready` | Keep fewer than about 100 ready events per worker replica during normal database latency |
| `http_server_requests_in_flight` | Add API replicas when each Pod has sustained request concurrency near its tested limit |
| `checkout_latency_p95_seconds` | Use for alerting and review, then confirm the bottleneck before scaling directly |

That note prevents mystery thresholds. A future reviewer can see why `200` was chosen and when it should be revisited.

## Guardrails: Min, Max, Behavior, and Dependencies
<!-- section-summary: Autoscaling needs safety limits so the controller does not overload dependencies, churn replicas, or hide capacity problems. -->

Autoscaling is a feedback loop. More traffic raises a metric, HPA changes replicas, new Pods change the metric, and the loop continues. Guardrails keep that loop from creating a new incident.

The first guardrails are `minReplicas` and `maxReplicas`. `minReplicas` keeps enough warm capacity for normal availability and sudden bursts. `maxReplicas` protects databases, queues, external APIs, and cost. For the orders API, `maxReplicas: 12` might come from a database connection budget rather than a Kubernetes preference.

HPA behavior can also shape how quickly scaling happens. These settings are useful when traffic rises quickly but falls in short waves:

```yaml
behavior:
  scaleUp:
    stabilizationWindowSeconds: 60
    policies:
      - type: Percent
        value: 100
        periodSeconds: 60
      - type: Pods
        value: 4
        periodSeconds: 60
    selectPolicy: Max
  scaleDown:
    stabilizationWindowSeconds: 300
    policies:
      - type: Percent
        value: 50
        periodSeconds: 60
```

This allows faster scale-up and slower scale-down. Fast scale-up helps during demand spikes. Slower scale-down keeps warm Pods around long enough to avoid dropping capacity between traffic bursts.

Dependencies need their own review. If each API Pod opens up to 20 PostgreSQL connections and HPA can scale to 12 replicas, the API layer can open 240 connections before workers, admin jobs, and migrations are counted. The database budget may force a lower `maxReplicas`, a smaller per-Pod connection pool, or a connection proxy.

Manual scaling needs cleanup too. It is an incident action, and the steady-state controller may later move the replica count again:

```bash
$ kubectl -n orders scale deployment devpolaris-orders-api --replicas=8
deployment.apps/devpolaris-orders-api scaled

$ kubectl -n orders get hpa devpolaris-orders-api
NAME                   TARGETS   MINPODS   MAXPODS   REPLICAS
devpolaris-orders-api  32%/70%   3         12        8
```

If HPA owns the Deployment, it may later move replicas back toward the metric target. If GitOps owns the manifest, it may revert a manual change. A manual scale during an incident should leave a note that explains whether the steady-state HPA or resource requests need an update afterward.

## Debugging Autoscaling Surprises
<!-- section-summary: HPA surprises usually come from missing metrics, missing requests, max/min limits, pending Pods, or a metric that points at the wrong bottleneck. -->

When autoscaling behaves strangely, `describe hpa` is usually the best first command. It tells you whether HPA can read the metric, calculate a recommendation, and apply the recommendation within the boundaries.

A common failure is missing CPU requests. The HPA status usually tells you this directly:

```bash
$ kubectl -n orders get hpa devpolaris-orders-api
NAME                   REFERENCE                         TARGETS         MINPODS   MAXPODS   REPLICAS
devpolaris-orders-api  Deployment/devpolaris-orders-api   <unknown>/70%   3         12        3

$ kubectl -n orders describe hpa devpolaris-orders-api
Conditions:
  Type           Status  Reason                   Message
  AbleToScale    True    ReadyForNewScale          recommended size matches current size
  ScalingActive  False   FailedGetResourceMetric   missing request for cpu in container api of Pod devpolaris-orders-api-7c96df7d7c-2vd6k
```

The fix is to add realistic CPU requests, roll out the Deployment, and watch HPA status again. The target `70%` has no meaning until the container has a requested CPU value.

Another common surprise is pending Pods after HPA scales up. In that case, HPA made a recommendation but scheduling could not complete it:

```bash
$ kubectl -n orders get pods -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                      READY   STATUS    RESTARTS
devpolaris-orders-api-7c96df7d7c-2vd6k   1/1     Running   0
devpolaris-orders-api-7c96df7d7c-dh8xq   1/1     Running   0
devpolaris-orders-api-7c96df7d7c-q94r7   1/1     Running   0
devpolaris-orders-api-7c96df7d7c-tb8mc   0/1     Pending   0

$ kubectl -n orders describe pod devpolaris-orders-api-7c96df7d7c-tb8mc
Events:
  Type     Reason            Age   From               Message
  Warning  FailedScheduling  42s   default-scheduler  0/3 nodes are available: 3 Insufficient cpu.
```

HPA asked for capacity, but the scheduler could not place the new Pod. Raising `maxReplicas` would not help this case because the cluster has no room. The next decision is cluster autoscaling, node size, workload placement, or resource request tuning based on real usage.

The quietest surprise is scaling the wrong workload. Imagine these dashboard values during the checkout spike, then ask which component is actually behind:

| Metric | Value |
|---|---|
| `checkout_latency_p95_seconds` | `4.8` |
| `orders_api_cpu_utilization` | `0.25` |
| `order_events_queue_depth` | `18420` |
| `order_worker_replicas` | `2` |
| `postgres_lock_wait_seconds` | `0.03` |

CPU is low, database locks are low, and queue depth is high. The API is not the slow part of this path. The worker fleet is probably behind. The next test should focus on `devpolaris-orders-worker`, worker throughput, queue drain rate, and database writes from the workers.

## Operational Checklist
<!-- section-summary: A good autoscaling review proves the metric, target, limits, dependencies, and recovery behavior before relying on the controller. -->

Autoscaling review is capacity design in YAML form. A reviewer should know which user symptom should improve, which metric represents the limit, and which dependency receives more load when replicas increase.

| Review question | Good answer |
|---|---|
| What user symptom should improve? | Checkout p95 latency during CPU-bound traffic spikes |
| Which metric drives scaling? | CPU utilization, queue depth, or another signal tied to the bottleneck |
| Are requests set and realistic? | CPU and memory requests came from observed usage and load tests |
| Can the cluster place more Pods? | Node capacity or cluster autoscaler can satisfy the HPA range |
| Can dependencies absorb the added work? | Database connections, queue throughput, and upstream rate limits were reviewed |
| Are min and max replicas intentional? | The floor protects availability and the ceiling protects dependencies and cost |
| Does scale-down fit traffic shape? | Warm capacity stays long enough for normal bursts |

A useful HPA evidence note for `devpolaris-orders-api` might look like this. It proves the metric, the user symptom, and the dependency budget together:

| Observation | Value |
|---|---|
| Load test | Checkout read/write mix for 20 minutes |
| Starting replicas | `3` |
| Peak replicas | `7` |
| CPU target | `70%` of request |
| p95 latency before spike | `180ms` |
| p95 latency during spike | `260ms` after scale-up |
| PostgreSQL connections | Rose from `18` to `41`, below budget |
| Scale-down | Returned to `3` replicas after traffic settled |

That evidence says CPU tracked the added work, added replicas helped the user symptom, and PostgreSQL stayed inside the budget. If latency stayed high while CPU dropped, the same evidence would tell the team to look beyond API replicas.

Keep the daily debugging commands close. They cover HPA status, live metrics, Pod placement, and recent events:

```bash
$ kubectl -n orders get hpa devpolaris-orders-api
$ kubectl -n orders describe hpa devpolaris-orders-api
$ kubectl -n orders top pods -l app.kubernetes.io/name=devpolaris-orders-api
$ kubectl -n orders get pods -l app.kubernetes.io/name=devpolaris-orders-api
$ kubectl -n orders get events --sort-by=.lastTimestamp
```

The controller can change replicas for you, but it cannot decide whether the metric represents the real bottleneck. That judgment still belongs to the team. Good autoscaling needs a measured signal, safe boundaries, and proof that more Pods actually improve the user experience.

---

**References**

- [Kubernetes: Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) - Official guide to HPA concepts, algorithm behavior, metrics, and configuration.
- [Kubernetes: HorizontalPodAutoscaler API](https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/horizontal-pod-autoscaler-v2/) - API reference for `autoscaling/v2`, including metrics and behavior fields.
- [Kubernetes: Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) - Explains CPU and memory requests, limits, and scheduling behavior.
- [Kubernetes: Resource Metrics Pipeline](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/) - Documents Metrics Server, resource metrics, and `kubectl top`.
- [Kubernetes: Metrics for Kubernetes System Components](https://kubernetes.io/docs/concepts/cluster-administration/system-metrics/) - Overview of Kubernetes metrics concepts and system component metrics.
- [Prometheus: Metric Types](https://prometheus.io/docs/concepts/metric_types/) - Defines counters, gauges, histograms, and summaries used in application metrics.
- [OpenTelemetry Metrics](https://opentelemetry.io/docs/concepts/signals/metrics/) - Explains metrics as an OpenTelemetry signal for application and system telemetry.
- [KEDA Concepts](https://keda.sh/docs/latest/concepts/) - Describes event-driven autoscaling and ScaledObjects for external signals such as queues and Prometheus queries.
