---
title: "Metrics and Autoscaling"
description: "Use Kubernetes metrics and autoscaling signals to scale applications without guessing replica counts."
tags: ["Kubernetes", "Operations", "Autoscaling", "Metrics"]
area: "Containers & Orchestration"
order: 3
id: article-containers-orchestration-kubernetes-operations-metrics-and-autoscaling
---
## Table of Contents

- [Scaling Needs a Measured Signal](#scaling-needs-a-measured-signal)
- [Requests Give the Signal a Baseline](#requests-give-the-signal-a-baseline)
- [Read Live Resource Metrics](#read-live-resource-metrics)
- [Horizontal Pod Autoscaling](#horizontal-pod-autoscaling)
- [Choose Metrics That Match the Bottleneck](#choose-metrics-that-match-the-bottleneck)
- [Custom and External Metrics](#custom-and-external-metrics)
- [Guardrails: Floor, Ceiling, and Behavior](#guardrails-floor-ceiling-and-behavior)
- [Debugging Autoscaling Surprises](#debugging-autoscaling-surprises)
- [Operational Checklist](#operational-checklist)
- [References](#references)

## Scaling Needs a Measured Signal
<!-- section-summary: Autoscaling works only when the metric represents real pressure on the workload and the team knows what action that metric should drive. -->

Kubernetes **metrics and autoscaling** let the cluster adjust replica counts from measured pressure instead of guesses. The operational path is signal first, baseline second, HPA third, and guardrails around the whole loop.

For `devpolaris-orders-api`, the team wants more Pods during checkout traffic spikes and fewer Pods after traffic settles. Kubernetes can only do that safely when the scaling signal matches the bottleneck. CPU can work for CPU-bound request handling. Queue depth can work for background workers. Request latency alone can be noisy unless it points to a clear capacity limit.

The practical question is: **what measurement proves this workload needs more capacity right now?**

## Requests Give the Signal a Baseline
<!-- section-summary: CPU utilization in HPA is measured against container requests, so missing or unrealistic requests make scaling decisions unreliable. -->

Before an HPA can use CPU utilization well, each container needs a realistic CPU request. Kubernetes compares live CPU usage to the requested CPU amount. A Pod using `350m` CPU against a `500m` request is at `70%` utilization.

A small resource skeleton looks like this:

```yaml
resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    memory: 1Gi
```

What this baseline means:

- `cpu: 500m` gives the scheduler and HPA a CPU reference point.
- `memory: 512Mi` helps scheduling and capacity planning.
- The memory limit protects the node from one process consuming unlimited memory.
- A CPU limit may be useful for some workloads, but it can also throttle request handling, so review it deliberately.

![Requests set the baseline infographic showing CPU request, Pod usage, HPA target, utilization, scheduler fit, and the scale decision](/content-assets/articles/article-containers-orchestration-kubernetes-operations-metrics-and-autoscaling/requests-set-baseline.png)

*The baseline view shows why requests matter: HPA reads usage as a percentage of the request, while the scheduler uses requests to place Pods.*

## Read Live Resource Metrics
<!-- section-summary: Live Pod and node metrics show whether the cluster can see the resource pressure that HPA will use. -->

The Metrics Server feeds the Kubernetes resource metrics API. `kubectl top` is the quick operator view into that data.

```bash
$ kubectl -n orders top pods -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                      CPU(cores)   MEMORY(bytes)
devpolaris-orders-api-6d4f9b7d6f-b7m2p    340m         410Mi
devpolaris-orders-api-6d4f9b7d6f-k9v5r    365m         436Mi
devpolaris-orders-api-6d4f9b7d6f-q2lm8    322m         398Mi
```

What this output tells you:

- Metrics are flowing for the selected Pods.
- CPU usage is near `70%` of a `500m` request.
- Memory usage is below the example `1Gi` limit.

If `kubectl top` fails, debug Metrics Server or permissions before blaming the HPA.

## Horizontal Pod Autoscaling
<!-- section-summary: HPA watches a metric, compares it with a target, and updates the replica count on the target workload. -->

A **HorizontalPodAutoscaler** watches a workload such as a Deployment and changes the replica count based on metrics. For the orders API, the first useful HPA can scale from three to ten replicas when average CPU utilization rises above `70%`.

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
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

What each part does:

- `scaleTargetRef` points to the Deployment HPA can resize.
- `minReplicas: 3` keeps baseline availability.
- `maxReplicas: 10` protects cost and dependencies.
- `averageUtilization: 70` means average CPU should stay near `70%` of requested CPU.

Check the controller result:

```bash
$ kubectl -n orders get hpa devpolaris-orders-api
NAME                    REFERENCE                          TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
devpolaris-orders-api   Deployment/devpolaris-orders-api   78%/70%   3         10        5          12m
```

How to read this:

- `78%/70%` means current average CPU is above the target.
- `REPLICAS 5` shows HPA has already changed the Deployment replica count.
- If replicas stay fixed while the target is high, describe the HPA for conditions.

![Autoscaling control loop showing metrics source, Metrics API, HPA controller, Deployment replicas, Pods, and stabilization window](/content-assets/articles/article-containers-orchestration-kubernetes-operations-metrics-and-autoscaling/autoscaling-control-loop.png)

*The control loop ties the metric source, Metrics API, HPA controller, Deployment, and Pods into one scaling path.*

## Choose Metrics That Match the Bottleneck
<!-- section-summary: The best scaling metric is the measurement closest to the workload pressure that more replicas can relieve. -->

CPU works when each extra Pod can take work away from busy Pods. It is a weak signal when the bottleneck is a database connection pool, a slow upstream API, or a queue that needs workers rather than HTTP replicas.

Use this selection table during design:

| Workload pressure | Better signal | Scaling action |
|---|---|---|
| CPU-bound API requests | CPU utilization | Add API replicas |
| Queue backlog | Queue length per worker | Add worker replicas |
| Slow database | DB saturation metrics | Fix DB capacity or queries before scaling API |
| Rate-limited upstream | Error and throttle rate | Add protection and reduce caller pressure |
| Memory growth | Memory usage and OOM events | Fix leak or set safer limits before HPA |

Check whether more Pods improve the user symptom. If five extra API Pods only create more database connections while latency stays high, the metric points away from the real bottleneck.

## Custom and External Metrics
<!-- section-summary: Custom and external metrics let HPA scale on application or platform signals outside basic Pod CPU and memory. -->

Resource metrics are the starting point. Production systems often need a signal closer to the work queue or request flow. Kubernetes HPA can use custom and external metrics when an adapter exposes them through the Kubernetes metrics APIs.

Example HPA shape for queue-backed workers:

```yaml
metrics:
  - type: External
    external:
      metric:
        name: orders_queue_depth
      target:
        type: AverageValue
        averageValue: "25"
```

What this means:

- The metric comes from an external metrics adapter.
- HPA aims for about `25` queued orders per worker Pod.
- The adapter must provide fresh values, or HPA will report missing metrics.

KEDA is a common production option for event-driven autoscaling. It adds ScaledObjects that connect queue systems, Prometheus queries, cloud services, and other event sources to Kubernetes scaling.

## Guardrails: Floor, Ceiling, and Behavior
<!-- section-summary: Autoscaling needs replica limits, stabilization, dependency capacity checks, and alerts for ceiling pressure. -->

Autoscaling should have boundaries. The minimum protects availability. The maximum protects dependencies, nodes, and cost. Behavior policies slow unsafe scale-down and make scale-up predictable.

```yaml
behavior:
  scaleUp:
    stabilizationWindowSeconds: 0
    policies:
      - type: Percent
        value: 100
        periodSeconds: 60
  scaleDown:
    stabilizationWindowSeconds: 300
    policies:
      - type: Percent
        value: 50
        periodSeconds: 60
```

What this behavior does:

- Scale-up can move quickly during rising demand.
- Scale-down waits five minutes before removing capacity.
- Scale-down removes at most half the replicas per minute.

![Autoscaling guardrails checklist with min replicas, max replicas, scale up policy, scale down policy, dependency capacity, and saturation alerts](/content-assets/articles/article-containers-orchestration-kubernetes-operations-metrics-and-autoscaling/autoscaling-guardrails.png)

*The guardrails board shows replica floors and ceilings, behavior policies, dependency budgets, and alerts when demand reaches the ceiling.*

Also alert when HPA sits at `maxReplicas` while latency or queue depth remains high. That state says the workload needs a capacity decision before more HPA tuning.

## Debugging Autoscaling Surprises
<!-- section-summary: Autoscaling debugging follows the metric path from Pod requests to live metrics, HPA conditions, Deployment replicas, and dependency capacity. -->

When HPA behavior surprises the team, the loop has a clear order:

```bash
$ kubectl -n orders describe hpa devpolaris-orders-api
Metrics:                                               ( current / target )
  resource cpu on pods  (as a percentage of request):   82% (410m) / 70%
Conditions:
  AbleToScale    True
  ScalingActive  True
  ScalingLimited True   the desired replica count is more than the maximum replica count
```

What this output says:

- HPA can consume the metric.
- CPU is above target.
- The maximum replica count is limiting the scale-up.

Continue with Pod placement and dependency checks:

```bash
$ kubectl -n orders get deploy devpolaris-orders-api
NAME                    READY   UP-TO-DATE   AVAILABLE   AGE
devpolaris-orders-api   10/10   10           10          3h

$ kubectl -n orders top pods -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                      CPU(cores)   MEMORY(bytes)
devpolaris-orders-api-6d4f9b7d6f-b7m2p    480m         460Mi
```

This confirms the Deployment reached the HPA ceiling and Pods are still busy. The next decision may involve raising the ceiling, adding nodes, protecting dependencies, or reducing per-request cost.

## Operational Checklist
<!-- section-summary: A production HPA review proves the signal, the request baseline, the replica boundaries, and the user-facing effect. -->

Use this checklist for `devpolaris-orders-api` autoscaling:

| Check | Good answer |
|---|---|
| Metric | The selected metric matches the real bottleneck |
| Requests | CPU and memory requests reflect observed production usage |
| HPA target | The target leaves headroom before user-visible saturation |
| Min replicas | The floor keeps availability during normal operations |
| Max replicas | The ceiling fits node, database, queue, and cost budgets |
| Behavior | Scale-down keeps warm capacity long enough for normal bursts |
| Evidence | A load test shows replicas, latency, errors, and dependency usage together |
| Alerts | The team gets paged when HPA hits the ceiling with bad user symptoms |

A useful evidence note might say: a 20-minute checkout load test moved from three to seven replicas, CPU settled near the target, p95 latency stayed below `300ms`, and PostgreSQL connections stayed under the approved budget. That note proves scaling helped users without overrunning the next system.

## References

- [Kubernetes: Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) - Official guide to HPA concepts, algorithm behavior, metrics, and configuration.
- [Kubernetes: HorizontalPodAutoscaler API](https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/horizontal-pod-autoscaler-v2/) - API reference for `autoscaling/v2`, including metrics and behavior fields.
- [Kubernetes: Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) - Explains CPU and memory requests, limits, and scheduling behavior.
- [Kubernetes: Resource Metrics Pipeline](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/) - Documents Metrics Server, resource metrics, and `kubectl top`.
- [Kubernetes: Metrics for Kubernetes System Components](https://kubernetes.io/docs/concepts/cluster-administration/system-metrics/) - Overview of Kubernetes metrics concepts and system component metrics.
- [Prometheus: Metric Types](https://prometheus.io/docs/concepts/metric_types/) - Defines counters, gauges, histograms, and summaries used in application metrics.
- [OpenTelemetry Metrics](https://opentelemetry.io/docs/concepts/signals/metrics/) - Explains metrics as an OpenTelemetry signal for application and system telemetry.
- [KEDA Concepts](https://keda.sh/docs/latest/concepts/) - Describes event-driven autoscaling and ScaledObjects for external signals such as queues and Prometheus queries.
