---
title: "Resource Requests and Limits"
description: "Set CPU and memory requests and limits so Kubernetes can place Pods and manage their runtime resource use."
overview: "Requests describe the capacity a workload needs for placement. Limits describe runtime boundaries. Together they shape scheduling, throttling, memory failures, rollouts, and autoscaling."
tags: ["resources", "requests", "limits", "scheduling"]
order: 7
id: article-containers-orchestration-kubernetes-workloads-resource-requests-and-limits
---

## Table of Contents

1. [What decisions do requests and limits control?](#what-decisions-do-requests-and-limits-control)
2. [How does the scheduler decide whether a Pod fits on a node?](#how-does-the-scheduler-decide-whether-a-pod-fits-on-a-node)
3. [Why do CPU and memory limits produce different outcomes?](#why-do-cpu-and-memory-limits-produce-different-outcomes)
4. [How does Kubernetes calculate the resource need of a multi-container Pod?](#how-does-kubernetes-calculate-the-resource-need-of-a-multi-container-pod)
5. [How do QoS classes, LimitRanges, and ResourceQuotas affect a workload?](#how-do-qos-classes-limitranges-and-resourcequotas-affect-a-workload)
6. [How can measurements turn into useful request and limit values?](#how-can-measurements-turn-into-useful-request-and-limit-values)
7. [How do resource settings affect rollouts, autoscaling, and diagnosis?](#how-do-resource-settings-affect-rollouts-autoscaling-and-diagnosis)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

The easiest way to understand Kubernetes resources is to start with the physical machine. A node has finite CPU time and finite RAM. Kubernetes must answer three different questions:

1. **Before a process exists:** which machine has enough room for this workload?
2. **After processes start:** when they compete, how much CPU time or memory should each receive?
3. **When demand exceeds capacity:** which process slows down, gets killed, or becomes a candidate for eviction?

Requests, limits, Quality of Service classes, namespace policy, and autoscaling answer different parts of those questions. Three numbers provide the foundation:

```text
REQUEST = the capacity Kubernetes plans around
LIMIT   = the runtime boundary Kubernetes enforces
USAGE   = what the process consumes right now
```

A container can request `500m` CPU, currently use `120m`, and have a `1000m` limit. Later it can still request `500m`, use `850m`, and remain below the same limit. Usage changes from moment to moment; the request remains the planning commitment used for placement.

The central model is:

> **A request answers “how much capacity should the cluster plan for?” A limit answers “how far may this container or Pod go at runtime?”**

Keep these questions in view as you work through the lesson:

1. **What decisions do requests and limits control?**
2. **How does the scheduler decide whether a Pod fits on a node?**
3. **Why do CPU and memory limits produce different outcomes?**
4. **How does Kubernetes calculate the resource need of a multi-container Pod?**
5. **How do QoS classes, LimitRanges, and ResourceQuotas affect a workload?**
6. **How can measurements turn into useful request and limit values?**
7. **How do resource settings affect rollouts, autoscaling, and diagnosis?**

## What decisions do requests and limits control?
<!-- section-summary: Requests provide planning values before placement, while limits create runtime boundaries after startup. -->

A container can declare four resource fields:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

Read the configuration as: budget half a CPU and 512 MiB when choosing a node; after startup, allow the container to use up to one CPU and 1 GiB.

| Field | Primary decision |
|---|---|
| `requests.cpu` | CPU capacity to reserve for scheduling and CPU weight during contention |
| `requests.memory` | memory capacity to reserve for scheduling and a signal used during memory pressure |
| `limits.cpu` | maximum CPU execution rate |
| `limits.memory` | memory boundary that can trigger an out-of-memory kill |

CPU values use cores or milliCPU. `1000m` equals one CPU, `500m` equals half a CPU, and `2000m` equals two CPUs. One CPU means approximately one core or vCPU worth of compute time; it does not normally pin the container to a particular physical core.

Memory uses byte quantities such as `Mi` and `Gi`. A particularly dangerous typo is `memory: 400m`: lowercase `m` means millibytes, so it does not mean 400 MiB.

The operating system enforces runtime controls through Linux control groups, or cgroups, on Linux nodes. A CPU request influences scheduling and usually the container's relative CPU weight during contention. A CPU limit creates a rate boundary. A memory request guides placement and contributes to node-pressure decisions. A memory limit creates a cgroup memory boundary.

Requests do not carve out permanently idle private blocks. A container can use more than its CPU or memory request when capacity is available. The request says what the cluster committed to plan around, while actual use may sit below or above it.

![Four fields separating scheduling requests from runtime CPU and memory boundaries](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-resource-requests-and-limits/four-fields-two-decisions.png)

*Requests take part in placement; limits act after the process starts.*

## How does the scheduler decide whether a Pod fits on a node?
<!-- section-summary: The scheduler compares request commitments with node allocatable capacity rather than using current CPU and memory measurements. -->

Suppose a node has this allocatable capacity:

```text
CPU:    8
Memory: 30Gi
```

Existing Pods on the node request a total of 7 CPUs and 20 GiB. A new Pod requests 2 CPUs and 2 GiB. Memory would fit, but CPU would become `7 + 2 = 9`, which exceeds 8. The scheduler rejects that node for this Pod.

The node might currently use only 1.2 CPUs and still produce an `Insufficient cpu` event. Scheduling is based on commitments rather than a momentary usage sample. Existing workloads may need the CPU they declared when traffic or background work arrives.

Requests work like reservations. A hotel does not sell an occupied room again because its guest is currently outside. In the same way, a quiet process still holds the capacity commitment expressed by its request.

For every required resource, the fit check is conceptually:

```text
existing requests + new Pod request <= node allocatable
```

All requested resources must fit before the scheduler can choose the node.

Scheduling uses requests, so the sum of limits can exceed the node's capacity. On a four-CPU node, four Pods might each request one CPU and have a two-CPU limit. Their requests total four CPUs while their limits total eight. The assumption is that all workloads may not burst at the same time. If they do, CPU can be divided and throttled.

Memory overcommit has a harder boundary. Four Pods on a 16 GiB node might each request 3 GiB and have a 6 GiB limit. The requests total 12 GiB, but the limits total 24 GiB. All four processes cannot simultaneously consume their full limits on that machine. Memory pressure, reclamation, eviction, or out-of-memory behavior must eventually resolve the physical shortage.

## Why do CPU and memory limits produce different outcomes?
<!-- section-summary: CPU can be time-shared and throttled, while memory holds live state and can require an out-of-memory kill. -->

CPU and memory have different physical behavior.

CPU is time. When two processes want the same core, the operating system can let process A run for a slice, then process B, then return to A. Both processes continue, but each receives less execution time. A container that tries to exceed its CPU limit is usually throttled, so the visible result is slower work, higher latency, or timeouts.

Memory holds live state: heap objects, caches, buffers, thread stacks, and other bytes the process may need immediately. The operating system cannot solve a 1 GiB process crossing a 512 MiB boundary by giving it “half the memory for the next 100 milliseconds.” It must reclaim memory, reject allocations, or kill a process.

This produces the practical distinction:

| Boundary crossed | Typical result |
|---|---|
| CPU limit | the cgroup throttles CPU time; the container usually keeps running |
| memory limit | the kernel's OOM mechanism can kill a process in the container |

A container can therefore appear `Running`, `Ready`, and free of restarts while suffering heavy CPU throttling. Memory-limit pressure can instead appear as `OOMKilled`.

Memory requests also matter during node pressure. A Burstable Pod consuming substantially above its memory request may be more exposed to eviction than a workload whose usage remains within its declared commitment. On suitable cgroup v2 configurations, memory requests can also participate in memory protection mechanisms.

The request and limit still answer separate questions: a `512Mi` memory request does not create an untouchable 512 MiB allocation, and a 1 GiB memory limit does not promise that the node can supply 1 GiB when every workload bursts at once.

## How does Kubernetes calculate the resource need of a multi-container Pod?
<!-- section-summary: Kubernetes combines containers according to which ones can run at the same time, then accounts for init peaks and Pod overhead. -->

The scheduler places a Pod as one unit, so it needs an effective Pod request.

Requests for ordinary containers that run together are added. If an application requests `500m` CPU and `512Mi`, while a metrics sidecar requests `100m` and `128Mi`, the Pod requests:

```text
CPU:    500m + 100m = 600m
Memory: 512Mi + 128Mi = 640Mi
```

Their limits also add conceptually for simultaneous use. A 1 CPU / 1 GiB application limit plus a `200m` / `256Mi` sidecar limit gives a possible combined limit of 1.2 CPUs and 1280 MiB.

Ordinary init containers run sequentially before the application containers. If the running containers request `600m` CPU, one init container requests `200m`, and another requests `1500m`, the Pod does not need all three totals at once. The effective CPU request is the larger of the steady-state running total and the largest init-container peak:

```text
max(600m, 1500m) = 1500m
```

Native restartable sidecars need special handling because they begin during initialization and remain running with later containers. Pod overhead can then be added for runtime-level costs outside the declared containers.

The complete two-container example looks like this:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: api
spec:
  containers:
    - name: application
      image: api:v1
      resources:
        requests:
          cpu: "500m"
          memory: "512Mi"
        limits:
          cpu: "1"
          memory: "1Gi"
    - name: metrics
      image: metrics:v1
      resources:
        requests:
          cpu: "100m"
          memory: "128Mi"
        limits:
          cpu: "200m"
          memory: "256Mi"
```

The scheduler looks for at least `600m` CPU and `640Mi` of uncommitted requested capacity. Once running, the Pod may currently use only `125m` CPU and `380Mi` memory. That low usage does not erase the scheduling commitment.

Kubernetes v1.34 also provides the beta `PodLevelResources` feature, which can declare an overall Pod budget:

```yaml
spec:
  resources:
    requests:
      cpu: "2"
      memory: "2Gi"
    limits:
      cpu: "4"
      memory: "4Gi"
```

Containers can share that Pod-level budget. This can help multi-container Pods where rigidly sizing every sidecar wastes capacity, but the feature and cluster version must support it.

## How do QoS classes, LimitRanges, and ResourceQuotas affect a workload?
<!-- section-summary: Resource declarations create a Pod QoS class, while namespace policies can default, constrain, or reject resource values during admission. -->

Kubernetes groups Pods into three Quality of Service classes based on their CPU and memory configuration.

**Guaranteed** means every container has CPU and memory requests and limits and each request equals its matching limit:

```yaml
requests:
  cpu: "1"
  memory: "1Gi"
limits:
  cpu: "1"
  memory: "1Gi"
```

**Burstable** covers Pods with some request or limit that do not satisfy the Guaranteed rules. A common application shape requests `500m` / `512Mi` and limits at 2 CPUs / 1 GiB.

**BestEffort** means the Pod declares no CPU or memory requests or limits.

During node pressure, the simplified intuition is that BestEffort Pods are easiest to evict, followed by Burstable, while Guaranteed receives stronger protection. The complete decision also considers whether a Pod is using more than its request and the Pod's priority.

Namespace admission policy can change or reject the resource configuration before scheduling begins.

A `LimitRange` can inject defaults, enforce minimums and maximums, and constrain request-to-limit ratios. A namespace can, for example, default every container to a `100m` CPU request and a `500m` CPU limit. A manifest with `resources: {}` can therefore produce a stored Pod with values the author did not write.

If a limit is supplied without its request and no admission mechanism provides another request, Kubernetes can make the request equal the limit. A container with only `limits.memory: 1Gi` can consequently reserve 1 GiB for scheduling, which may explain an unexpected `Pending` Pod.

A `ResourceQuota` limits aggregate namespace consumption. A team namespace might allow at most 20 requested CPUs, 40 GiB requested memory, 40 CPU limits, and 80 GiB memory limits. A Pod can fit on a node and still be rejected because admitting it would exceed the namespace total.

Keep the two gates separate:

| Gate | Question |
|---|---|
| API admission | Is this namespace allowed to ask for these values? |
| scheduling | Is there a node whose remaining request ledger can fit the Pod? |

## How can measurements turn into useful request and limit values?
<!-- section-summary: Useful values come from representative load, container-level measurements, explicit headroom, and repeated validation. -->

Resource values should model the workload's real behavior. Begin with representative load and measure every container, including sidecars.

CPU demand can be estimated from CPU cost per operation and operations per second. If one request needs about 10 milliseconds of CPU and the Pod handles 40 requests per second:

```text
10 ms × 40 = 400 ms of CPU per second ≈ 0.4 CPU ≈ 400m
```

A request around `400m` to `500m` now has a physical reason: it is the CPU the Pod should be able to obtain under contention to meet its expected work. A request set too low lets the scheduler pack too many Pods together; a request set too high makes nodes appear full while much of their capacity sits unused.

Memory demand includes more than one visible heap number:

- base process memory;
- heap and working set;
- caches;
- thread stacks;
- request and response buffers;
- sidecars;
- concurrency-dependent state;
- temporary allocations.

If measurements show 450 MiB normally, 600 MiB at the 95th percentile, and 720 MiB at a legitimate peak, a `650Mi` request and `900Mi` limit may be a reasonable starting point, depending on recovery cost and risk tolerance.

The memory limit is a failure boundary: beyond it, killing and restarting the container is considered safer than continued growth. Avoid using observed average memory as the limit. Garbage-collected runtimes, JIT compilation, caches, TLS buffers, large responses, and temporary work all create valid peaks. For a JVM process, container memory includes the heap plus metaspace, native allocations, thread stacks, and direct buffers.

CPU limits require a policy choice. They can protect tenants from noisy neighbors, but a latency-sensitive service can be throttled even when the node has spare CPU because its configured limit forbids additional execution time. A common starting shape is a carefully sized CPU request, a generous or omitted CPU limit where policy permits, a carefully sized memory request, and an explicit memory limit. Guaranteed QoS, CPU Manager use, multi-tenant policy, or other constraints may justify tighter values.

## How do resource settings affect rollouts, autoscaling, and diagnosis?
<!-- section-summary: The same request and limit values influence rollout headroom, HPA calculations, scheduling failures, throttling, OOM kills, and eviction. -->

Requests are part of the Horizontal Pod Autoscaler's utilization calculation. With a `500m` CPU request and `350m` usage, utilization is 70%:

```text
350m / 500m = 70%
```

If the request changes to `1000m` while usage stays at `350m`, the reported utilization becomes 35%. The request therefore calibrates the autoscaling control loop. To target 70% when the desired scale point is around `350m`, work backwards: `350m / 0.70 = 500m`. If the relevant containers lack CPU requests, the HPA may be unable to calculate resource utilization for those Pods.

Requests also determine whether a rolling Deployment has room for surge Pods. Ten replicas requesting 1 CPU and 2 GiB each need 10 CPUs and 20 GiB at steady state. With `maxSurge: 25%`, a rollout can temporarily need about 13 CPUs and 26 GiB of requested capacity. Without that headroom, a new Pod remains `Pending`, old Pods stay to preserve availability, and the rollout stalls. Terminating Pods can make actual use temporarily higher still.

Truthful requests and planned rollout headroom solve this tension. Artificially high requests prevent useful placement; artificially low requests allow placement while creating contention and memory pressure.

### Follow one CPU request through four different decisions

Suppose each API Pod requests `500m` CPU, has no CPU limit where policy permits, and the HPA targets 70% utilization.

First, scheduling treats every replica as a 500m commitment. Eight replicas require four CPUs of node allocatable capacity before sidecars and rollout surge. That ledger remains four CPUs even when current use is only one CPU.

Second, CPU contention uses the request as an important relative weight. The request describes how much execution capacity the workload should reasonably obtain when neighboring containers also need CPU; it is not merely a bin-packing label.

Third, the HPA interprets `350m` usage as 70% because `350m / 500m = 0.70`. Doubling the request without changing work turns the same `350m` into 35% and can suppress scaling. Resource tuning and autoscaling tuning are therefore one control-system change, not two independent YAML edits.

Fourth, rollout capacity multiplies the request. Eight steady replicas reserve four CPUs. A 25% surge can add two Pods, raising the requested CPU to five before sidecars. If the cluster has only the steady-state room, the two new Pods cannot both schedule and the rollout may stop behind its availability rules.

```text
500m request
├─ scheduler commitment per Pod
├─ relative CPU entitlement under contention
├─ HPA utilization denominator
└─ rollout headroom consumed by every surge Pod
```

This is why changing a request requires more than watching average usage. Verify placement density, latency under contention, HPA behavior at the intended load, and the worst expected rollout population.

### Follow one memory pair from placement to failure

Assume a Pod requests `650Mi` and has a `900Mi` memory limit. The scheduler reserves 650 MiB in its planning ledger. The process can legitimately use 720 MiB during a measured peak because a request is not a hard ceiling. That usage is above the packing assumption, however, so many Pods peaking together can create node pressure.

At 900 MiB, the cgroup boundary creates a different consequence: allocation growth can produce an OOM kill. Raising the limit may stop that immediate kill but can increase node-pressure risk if requests and cluster capacity still assume 650 MiB. Raising the request may make packing truthful but can reveal that rollout or steady-state capacity is insufficient.

Treat the three numbers as one model:

```text
observed working set and legitimate peak
→ truthful scheduling request with justified headroom
→ explicit memory failure boundary
→ enough node and rollout capacity for all expected simultaneous Pods
```

The safe change is the one that keeps those statements consistent, not the one that merely removes the latest `OOMKilled` event.

When diagnosis starts, first locate the lifecycle stage.

### A Pod remains Pending

Inspect Pod events and the node's request commitments:

```bash
kubectl describe pod <pod>
kubectl describe node <node>
kubectl top nodes
kubectl top pods --containers
```

`describe node` shows assigned requests and limits, while `kubectl top` shows recent usage. Seeing 25% CPU usage and 95% CPU requested explains how a quiet-looking node can reject another request.

### A container is `OOMKilled`

Inspect the previous container state in the Pod:

```bash
kubectl describe pod <pod>
kubectl get pod <pod> -o yaml
```

`reason: OOMKilled` is strong evidence that the memory boundary was crossed. Exit code 137 only tells you the process received `SIGKILL`, so it is a clue rather than proof by itself. Compare observed peaks with the configured memory limit.

### A running application is slow

Compare CPU use with the CPU limit and inspect throttling metrics. A container can remain ready with zero restarts while the cgroup repeatedly delays its work. `kubectl top` reports sampled usage and may hide short throttling periods; Prometheus or cAdvisor CPU-throttling metrics provide stronger evidence.

### Pods are evicted

Look for `Evicted`, `MemoryPressure`, or other node conditions:

```bash
kubectl describe node <node>
```

Check the Pod's QoS class, priority, request, and usage. A workload consuming far above its memory request may reveal that the cluster-packing assumption was inaccurate.

### A rollout will not complete

Follow the chain:

```bash
kubectl rollout status deployment/<name>
kubectl describe deployment <name>
kubectl get pods
kubectl describe pod <new-pending-pod>
```

A new ReplicaSet may exist, yet its Pod request cannot fit. Availability policy keeps an old Pod, so the rollout cannot advance.

### The HPA behaves unexpectedly

Inspect the HPA and calculate the ratio yourself:

```bash
kubectl describe hpa <name>
```

Compare CPU usage, CPU request, calculated utilization, and the target. The denominator is the request, so changing it changes the HPA's interpretation of the same usage.

Across all these cases, keep the sequence clear: admission policy checks the declared values, requests guide scheduler placement, the node enforces CPU and memory behavior, and the same numbers influence QoS, eviction, autoscaling, and rollout capacity.

## Check Your Answers
<!-- section-summary: Revisit planning, runtime enforcement, Pod calculations, policy, measurement, rollouts, autoscaling, and diagnosis. -->

:::expand[What decisions do requests and limits control?]{kind="recap"}
Requests provide stable CPU and memory commitments for placement and resource sharing. Limits create runtime boundaries. Usage is a separate live measurement that can move below or above the request.
:::

:::expand[How does the scheduler decide whether a Pod fits on a node?]{kind="recap"}
For every required resource, the scheduler adds the new Pod's effective request to existing request commitments and compares the result with node allocatable capacity. Live usage does not replace that reservation ledger.
:::

:::expand[Why do CPU and memory limits produce different outcomes?]{kind="recap"}
CPU is execution time that the kernel can divide, so crossing a CPU limit produces throttling. Memory stores live state, so crossing a memory limit can require an out-of-memory kill.
:::

:::expand[How does Kubernetes calculate the resource need of a multi-container Pod?]{kind="recap"}
Kubernetes adds containers that run together, compares the steady-state total with ordinary init-container peaks, accounts for restartable sidecars, and adds Pod overhead. Pod-level resources can provide a shared budget when the feature is enabled.
:::

:::expand[How do QoS classes, LimitRanges, and ResourceQuotas affect a workload?]{kind="recap"}
Resource declarations determine Guaranteed, Burstable, or BestEffort QoS. LimitRange can default or constrain per-object values, while ResourceQuota limits namespace totals. These policies act during API admission before scheduling.
:::

:::expand[How can measurements turn into useful request and limit values?]{kind="recap"}
Measure the application under representative load, derive requests from healthy demand, and set limits from legitimate peaks and deliberate failure boundaries. CPU cost per operation and measured memory percentiles give the values a physical basis.
:::

:::expand[How do resource settings affect rollouts, autoscaling, and diagnosis?]{kind="recap"}
Requests determine whether surge Pods fit and form the denominator for utilization-based HPA decisions. Limits shape CPU throttling and memory kills. Diagnose by separating admission, scheduling, runtime enforcement, autoscaling, rollout capacity, and node-pressure eviction.
:::

## References
<!-- section-summary: Kubernetes documentation for resource requests, limits, Pod calculations, policy, autoscaling, and pressure behavior. -->

- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) — requests, limits, units, enforcement, Pod calculations, and Pod-level resources.
- [Pod Quality of Service Classes](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/) — Guaranteed, Burstable, BestEffort, and pressure behavior.
- [Limit Ranges](https://kubernetes.io/docs/concepts/policy/limit-range/) — namespace defaults, minimums, maximums, and request-to-limit ratios.
- [Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/) — aggregate namespace constraints and admission behavior.
- [Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/) — utilization calculations and the role of requests.
- [Node-pressure Eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/) — pressure signals and eviction decisions.
- [`kubectl top`](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_top/) — recent CPU and memory measurements.
