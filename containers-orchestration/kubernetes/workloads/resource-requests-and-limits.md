---
title: "Resource Requests and Limits"
description: "Set Kubernetes CPU and memory requests and limits so Pods schedule predictably and fail in understandable ways."
overview: "Requests help the scheduler place Pods. Limits constrain runtime usage. This article shows how `devpolaris-orders-api` uses both, and how to diagnose Pending Pods and memory kills."
tags: ["resources", "requests", "limits", "oom"]
order: 7
id: article-containers-orchestration-kubernetes-workloads-resource-requests-and-limits
---

## Table of Contents

1. [Why Resource Settings Matter](#why-resource-settings-matter)
2. [Requests: The Scheduler's Planning Number](#requests-the-schedulers-planning-number)
3. [Limits: The Runtime Boundary](#limits-the-runtime-boundary)
4. [Node Allocatable and Scheduling Fit](#node-allocatable-and-scheduling-fit)
5. [CPU and Memory Behave Differently](#cpu-and-memory-behave-differently)
6. [QoS Classes and Eviction Order](#qos-classes-and-eviction-order)
7. [Namespace Guardrails](#namespace-guardrails)
8. [A Production Sizing Loop](#a-production-sizing-loop)
9. [Debugging Pending Pods and OOMKilled Restarts](#debugging-pending-pods-and-oomkilled-restarts)
10. [How Bad Resource Settings Hurt Rollouts and Autoscaling](#how-bad-resource-settings-hurt-rollouts-and-autoscaling)
11. [Operational Runbook](#operational-runbook)

## Why Resource Settings Matter
<!-- section-summary: Requests and limits give Kubernetes the numbers it needs to place Pods and control runtime resource usage. -->

Kubernetes runs many workloads on shared nodes. A node may host the public orders API, a background worker, an ingress controller, a metrics agent, and several small internal services at the same time. Each Pod asks for CPU and memory, and the platform has to decide where that Pod can safely run.

For `devpolaris-orders-api`, resource settings affect ordinary release work. The team wants three replicas serving checkout traffic. During a rolling update, the Deployment may ask for a fourth temporary Pod because `maxSurge: 1` allows one extra replica. That extra Pod needs enough CPU and memory to schedule. After it starts, it needs enough runtime headroom to pass readiness and handle real requests.

Kubernetes gives you two resource controls for each container:

| Setting | What it answers | Example for the orders API |
|---|---|---|
| **Request** | How much CPU or memory should the scheduler plan for? | Reserve `300m` CPU and `384Mi` memory for each API Pod |
| **Limit** | What runtime ceiling should the node enforce? | Allow the API to burst to `1` CPU and `768Mi` memory |

A **CPU request** and **memory request** influence placement. A **CPU limit** and **memory limit** influence what happens after the container starts. They sit in the same YAML block, but they answer different operational questions.

Here is the baseline Deployment shape we will use:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  labels:
    app: devpolaris-orders-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: devpolaris-orders-api
  template:
    metadata:
      labels:
        app: devpolaris-orders-api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026.06.14-2
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 300m
              memory: 384Mi
            limits:
              cpu: "1"
              memory: 768Mi
```

`300m` means three tenths of one CPU core. `384Mi` means 384 mebibytes of memory. The API may use less than its request during quiet periods and more than its CPU request during busy periods. The request gives the scheduler a planning number, and the limit gives the node a boundary.

## Requests: The Scheduler's Planning Number
<!-- section-summary: Requests tell the scheduler how much CPU and memory to reserve on paper before placing a Pod on a node. -->

A **resource request** is the amount of CPU or memory Kubernetes should reserve for a container during scheduling. The scheduler compares the Pod's requested resources with the unrequested allocatable resources on each node. If a node has enough available requested capacity, the Pod can fit there.

Think about the orders API during a rollout. Three existing Pods are already serving traffic. The new release needs one surge Pod. If each Pod requests `300m` CPU and `384Mi` memory, the scheduler needs to find a node that can account for those extra numbers. The new Pod may start with low usage, but the scheduler uses the request because it needs a stable placement decision before the process runs.

Requests are written under `resources.requests`:

```yaml
resources:
  requests:
    cpu: 300m
    memory: 384Mi
```

CPU uses cores as the base unit. `1000m` equals one full CPU core, `500m` equals half a core, and `250m` equals a quarter core. Memory uses byte units such as `Mi` and `Gi`. Most Kubernetes manifests use binary units for memory because application memory measurements often show up that way in container tooling.

The request should reflect normal operating needs, including startup. If the orders API usually sits around `220Mi` but reaches `360Mi` while loading configuration and warming caches, a `384Mi` memory request gives the scheduler a more honest number. A request far below normal usage can pack too many Pods onto one node. A request far above normal usage can make the cluster look full while machines still have idle resources.

Requests also affect operations beyond scheduling. Horizontal Pod Autoscaling can calculate CPU utilization as a percentage of the CPU request. If the CPU request is missing for containers that the HPA needs to evaluate, that utilization signal can fail for the metric. That is why production teams usually treat CPU requests as part of autoscaling design, not just a YAML detail.

## Limits: The Runtime Boundary
<!-- section-summary: Limits tell the node how far a running container can grow before CPU throttling or memory termination happens. -->

A **resource limit** is the runtime boundary for a container. The kubelet and container runtime use limits to control how much CPU or memory the process can consume on the node. Limits protect neighbors on a shared machine, but tight limits can also create slow responses or restarts.

The orders API uses limits like this:

```yaml
resources:
  limits:
    cpu: "1"
    memory: 768Mi
```

The CPU limit says the container can use up to one CPU core worth of time. If the process wants more CPU than that, the runtime can throttle it. Throttling means the process waits for CPU time. The API may stay alive, but request latency can climb because the Node.js event loop or worker threads spend time waiting.

The memory limit behaves more sharply. If the process goes above its memory limit, the kernel can kill the container. Kubernetes reports this as `OOMKilled`. The Pod may restart, and users may see failed requests during the restart window.

For a Node.js API, memory needs include more than the JavaScript heap. Buffers, native modules, TLS, compression, JSON parsing, framework overhead, and the runtime itself all use memory. A limit that sits just above normal usage can fail during a traffic spike, a large bulk import, or a slower downstream dependency that causes requests to pile up in memory.

Production teams usually set memory limits with enough headroom for known bursts, then use metrics to tune them. CPU limits need a little more judgment. Some teams set CPU requests and skip CPU limits for latency-sensitive services so the service can use spare CPU when the node has it. Other teams keep CPU limits for stronger isolation. The right choice depends on cluster policy, tenancy, workload type, and the evidence from throttling metrics.

## Node Allocatable and Scheduling Fit
<!-- section-summary: The scheduler places Pods against node allocatable capacity, which is the part of node capacity available for Pods after system reservations. -->

**Node allocatable** is the amount of CPU, memory, and other resources on a node that Kubernetes makes available for Pods. A node might have 4 CPU cores and 16 GiB of memory in total, but kubelet, the operating system, and system daemons need their own reservation. The scheduler places Pods against allocatable capacity, not the machine's raw capacity.

You can see this in `kubectl describe node`:

```bash
$ kubectl describe node worker-1
Capacity:
  cpu:                4
  memory:             16383748Ki
Allocatable:
  cpu:                3800m
  memory:             14531264Ki
Allocated resources:
  Resource           Requests     Limits
  cpu                3200m (84%)  7600m (200%)
  memory             11776Mi      23040Mi
```

That output shows several important ideas at once. The node has 4 cores of raw capacity, but only `3800m` CPU is allocatable to Pods. Current CPU requests already total `3200m`, so a new Pod requesting `700m` CPU will not fit on this node even if live CPU usage looks low at that exact moment.

This difference explains a common beginner surprise. `kubectl top node` might show low live usage, while a new Pod still stays Pending with `Insufficient cpu`. The scheduler places Pods from requests rather than live usage because it needs a stable promise from every workload.

For the orders API, this matters during rollouts. If the cluster has exactly enough requested capacity for three replicas and no extra room, `maxSurge: 1` creates a fourth Pod that may sit Pending. The release stalls before the new code even starts. The fix may involve lowering an unrealistic request, adding node capacity, reducing surge, moving other workloads, or letting a cluster autoscaler add nodes.

## CPU and Memory Behave Differently
<!-- section-summary: CPU pressure usually creates throttling and latency, while memory pressure commonly creates OOMKilled restarts. -->

CPU is a time-sharing resource. When several containers want CPU at the same time, the kernel can divide CPU time between them. If a container hits its CPU limit, it waits. The process keeps running, but response time can suffer.

Memory has a different failure pattern. A process has memory available until it runs out. When a container crosses its memory limit, the kernel can terminate it. Kubernetes then records the terminated state and restarts the container according to the Pod's restart policy.

The orders API may show CPU pressure like this:

```bash
$ kubectl top pod -l app=devpolaris-orders-api
NAME                                       CPU(cores)   MEMORY(bytes)
devpolaris-orders-api-7c9d4c685b-4q9kc     980m         421Mi
devpolaris-orders-api-7c9d4c685b-j2z6p     940m         438Mi
devpolaris-orders-api-7c9d4c685b-m8vnn     990m         429Mi
```

If each Pod has a one-core CPU limit, those Pods are near the ceiling. Users may report slow checkout responses while the Pods remain Ready and restart count stays at zero. The useful next signals are request latency, CPU throttling metrics from your monitoring stack, and HPA behavior.

Memory pressure often leaves a different trail:

```bash
$ kubectl get pod devpolaris-orders-api-7c9d4c685b-j2z6p
NAME                                       READY   STATUS    RESTARTS   AGE
devpolaris-orders-api-7c9d4c685b-j2z6p     1/1     Running   4          2h

$ kubectl describe pod devpolaris-orders-api-7c9d4c685b-j2z6p
Last State:
  Terminated:
    Reason:       OOMKilled
    Exit Code:    137
```

That says the container crossed its memory boundary. The resource setting tells you where the boundary was. The logs and application metrics tell you why the process crossed it.

## QoS Classes and Eviction Order
<!-- section-summary: Kubernetes assigns Pods a QoS class from their requests and limits, and that class influences eviction decisions under node pressure. -->

Kubernetes assigns each Pod a **Quality of Service class**, often shortened to **QoS class**, from the requests and limits on its containers. QoS classes help Kubernetes decide which Pods to evict first when a node runs out of resources.

There are three classes:

| QoS class | How a Pod gets it | Operational meaning |
|---|---|---|
| **Guaranteed** | Every container has CPU and memory request and limit, and each request equals its matching limit | Strongest placement and eviction protection, with no burst above the requested amount |
| **Burstable** | At least one request or limit exists, and the Pod falls outside the Guaranteed rules | Common for web services that need a stable request and some burst headroom |
| **BestEffort** | No CPU or memory requests or limits exist on any container | Lowest protection during node pressure |

The orders API example is **Burstable** because it requests `300m` CPU and `384Mi` memory but allows higher limits. That is a common shape for APIs. The scheduler gets a planning number, while the process can use more CPU or memory during short bursts.

`Guaranteed` can fit tightly controlled systems, but it removes burst headroom because request and limit match. If the orders API had `memory request: 768Mi` and `memory limit: 768Mi`, the scheduler would reserve more memory for every replica. That might be worth it for a critical service with predictable usage, but it can waste capacity for workloads that usually run lower.

`BestEffort` is risky for production APIs because the scheduler receives no resource promise and the Pod has the weakest eviction position under node pressure. Small local experiments may use it, but production workloads should usually declare requests at minimum.

QoS classes connect resource settings to incident behavior. During node memory pressure, Kubernetes tries to protect Pods with stronger guarantees first. The orders API still needs good memory sizing because a Pod can be evicted under node pressure or killed by its own memory limit, and those are different failure paths.

## Namespace Guardrails
<!-- section-summary: LimitRange and ResourceQuota help platform teams set defaults, minimums, maximums, and namespace-level resource budgets. -->

Application teams set requests and limits on their workloads, while platform teams often add namespace-level guardrails. Two common Kubernetes objects appear here: **LimitRange** and **ResourceQuota**.

A **LimitRange** sets defaults, minimums, and maximums for resource requests and limits in a namespace. It helps a platform avoid BestEffort Pods created by accident, and it can prevent extreme values that would damage shared capacity.

Here is a small example for a namespace that runs checkout services:

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: checkout-container-defaults
  namespace: checkout
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      default:
        cpu: "1"
        memory: 1Gi
      min:
        cpu: 50m
        memory: 64Mi
      max:
        cpu: "2"
        memory: 2Gi
```

This says a container without explicit values can receive defaults, and containers outside the min/max range can be rejected. In real production, app teams should still set explicit values for important services because defaults rarely capture the actual needs of each workload.

A **ResourceQuota** caps total resource use in a namespace. It can limit total requested CPU, total requested memory, total limits, and object counts. This helps a cluster shared by many teams avoid one namespace consuming the whole cluster budget.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: checkout-resource-budget
  namespace: checkout
spec:
  hard:
    requests.cpu: "12"
    requests.memory: 32Gi
    limits.cpu: "24"
    limits.memory: 64Gi
    pods: "80"
```

If the orders team tries to deploy more replicas than the namespace budget allows, the API server can reject the new Pod creation. That is a different failure from scheduler Pending. Quota failures show up during admission, while scheduler failures show up after the Pod object exists and cannot be placed.

## A Production Sizing Loop
<!-- section-summary: Good resource settings come from measurement, load testing, rollout observation, and regular tuning. -->

Resource settings improve through a loop. The first values are educated guesses. The later values should come from real measurements.

For the orders API, the team might begin in staging with a realistic checkout load test. The test sends normal order creation traffic, coupon scenarios, payment-provider retries, and a bulk order import that resembles the busiest expected customer workflow. During the run, the team watches CPU, memory, latency, restarts, and readiness behavior.

The first review may look like this:

| Signal | Observed value | Decision |
|---|---:|---|
| Normal memory | `260Mi` to `330Mi` | Request should sit above normal usage |
| Startup memory peak | `365Mi` | Request should cover startup and warmup |
| Bulk import memory peak | `610Mi` | Limit needs burst headroom above this |
| Normal CPU | `120m` to `280m` | `300m` request fits ordinary traffic |
| Peak CPU | `850m` | One-core limit may work if latency stays healthy |
| P95 checkout latency at peak | `240ms` | Acceptable for the current service target |

Those measurements support the earlier manifest:

```yaml
resources:
  requests:
    cpu: 300m
    memory: 384Mi
  limits:
    cpu: "1"
    memory: 768Mi
```

After release, live metrics should confirm or challenge the staging values. `kubectl top` gives a quick current view when Metrics Server is installed:

```bash
$ kubectl top pod -l app=devpolaris-orders-api --containers
POD                                        NAME   CPU(cores)   MEMORY(bytes)
devpolaris-orders-api-7c9d4c685b-4q9kc     api    230m         344Mi
devpolaris-orders-api-7c9d4c685b-j2z6p     api    260m         351Mi
devpolaris-orders-api-7c9d4c685b-m8vnn     api    210m         338Mi
```

That command shows recent usage, not history. A production sizing loop needs historical metrics from your monitoring system, such as Prometheus plus kube-state-metrics and container CPU/memory metrics, or the managed monitoring stack from your Kubernetes provider. Historical dashboards let you see spikes that happened at midnight, during deploys, or during customer traffic bursts.

The loop usually lands on a cadence:

1. Pick starting requests and limits from staging load tests or a similar service.
2. Deploy with dashboards and alerts for Pending Pods, restarts, OOMKilled, CPU throttling, latency, and HPA replica count.
3. Review live data after the first production week.
4. Raise requests that sit below normal usage, lower requests that greatly exceed real usage, and adjust limits that cause throttling or OOM kills.
5. Repeat after major code changes, traffic growth, and dependency changes.

This turns resource settings into normal operations work. The values change because the application changes.

## Debugging Pending Pods and OOMKilled Restarts
<!-- section-summary: Pending Pods point toward scheduling or admission problems, while OOMKilled restarts point toward memory limits or application memory behavior. -->

Two resource failures show up often during orders API operations: a new Pod stays Pending, or a running container gets OOMKilled.

A **Pending Pod** exists in the API but has no node assignment yet. During a rollout, this can mean the surge Pod cannot fit anywhere with its requests.

```bash
$ kubectl get pods -l app=devpolaris-orders-api
NAME                                       READY   STATUS    RESTARTS   AGE
devpolaris-orders-api-8d6b8df875-b4gk2     0/1     Pending   0          2m
```

The event stream explains the scheduling reason:

```bash
$ kubectl describe pod devpolaris-orders-api-8d6b8df875-b4gk2
Events:
  Type     Reason             Message
  ----     ------             -------
  Warning  FailedScheduling   0/4 nodes are available: 4 Insufficient cpu.
```

The practical checks are:

```bash
$ kubectl get pod devpolaris-orders-api-8d6b8df875-b4gk2 \
  -o jsonpath='{.spec.containers[0].resources}{"\n"}'

$ kubectl describe node worker-1

$ kubectl get events --sort-by=.lastTimestamp
```

From there, the fix depends on the evidence. A request typo such as `cpu: "3"` instead of `cpu: 300m` should be corrected in the manifest. A real capacity shortage may need more nodes or fewer replicas. A rollout with `maxSurge: 1` may need temporary capacity before it can safely replace Pods.

An **OOMKilled restart** means the container crossed its memory boundary. The Pod may be Running again by the time you check it, so `describe pod` matters:

```bash
$ kubectl describe pod devpolaris-orders-api-7c9d4c685b-j2z6p
Containers:
  api:
    State:          Running
    Last State:
      Terminated:
        Reason:     OOMKilled
        Exit Code:  137
    Restart Count:  4
```

The previous container logs often hold the last useful application clue:

```bash
$ kubectl logs devpolaris-orders-api-7c9d4c685b-j2z6p --previous --tail=50
2026-06-14T12:19:03Z processing bulk order import request id=req-8491 rows=50000
2026-06-14T12:19:19Z memory rss=742Mi heapUsed=601Mi
```

Now the team can choose the right repair. A memory leak needs code investigation. A legitimate bulk import may need streaming instead of loading every row into memory. A limit that sits too close to normal behavior may need to increase along with the request. The resource setting marks the boundary, while the application evidence explains the workload behavior.

## How Bad Resource Settings Hurt Rollouts and Autoscaling
<!-- section-summary: Requests and limits influence rollout progress, readiness timing, Pod restarts, and autoscaler math. -->

Resource settings connect directly to the rollout article before this one. A Deployment can have a safe RollingUpdate strategy and still fail because resource settings block the new Pods.

Here is the release story again. The orders API has three replicas and `maxSurge: 1`. Version `2026.06.14-2` starts a rollout. The new Pod requests `800m` CPU because someone copied values from a larger service. Every node has only `500m` of unrequested allocatable CPU. The Pod stays Pending, `kubectl rollout status` waits, and the Deployment eventually reports progress deadline exceeded.

Another version of the same incident starts after the Pod schedules. The request is low, so the Pod lands on a busy node. Startup competes for CPU, readiness takes too long, and the rollout waits. The Pod may eventually pass, but the release looks flaky because placement hid the real capacity need.

Memory limits can damage rollouts too. A new image may use more memory during startup because it loads a new fraud-rule cache. If the limit remains at `512Mi` and startup reaches `620Mi`, the container gets OOMKilled before readiness succeeds. Kubernetes keeps trying, old Pods keep serving if the strategy allows it, and the release never completes.

Autoscaling has its own connection. For CPU-based HPA targets, Kubernetes uses CPU usage relative to CPU requests. If the request is much lower than real normal usage, the HPA may scale aggressively because utilization looks high. If the request is much higher than real usage, the HPA may scale late because utilization looks low. Missing CPU requests can make CPU utilization unavailable for the metric.

This is why resource tuning belongs in release planning. The right image, the right readiness probe, and the right resource settings travel together. A production release should answer all three questions: what code is running, how Kubernetes knows it is ready, and what capacity shape it needs.

## Operational Runbook
<!-- section-summary: A simple runbook helps teams verify resource settings before release and respond quickly when capacity failures appear. -->

A resource review before an orders API release usually covers these checks:

1. Confirm each production container has explicit CPU and memory requests.
2. Confirm memory limits leave headroom above startup, normal peak, and expected burst usage.
3. Confirm CPU limits, if used, match the latency goal and throttling evidence for the service.
4. Confirm the namespace has enough ResourceQuota budget for the desired replicas plus rollout surge.
5. Confirm node groups or autoscaling can supply enough allocatable capacity for surge Pods.
6. Confirm dashboards show CPU, memory, restarts, OOMKilled, Pending Pods, and HPA behavior.

During a Pending Pod incident, the operator path is:

```bash
$ kubectl get pods -l app=devpolaris-orders-api
$ kubectl describe pod <pending-pod-name>
$ kubectl get events --sort-by=.lastTimestamp
$ kubectl describe node <candidate-node-name>
$ kubectl get resourcequota -n checkout
```

The likely decision points are straightforward. A manifest typo gets fixed and redeployed. A namespace quota shortage goes to the platform owner or release owner. A real cluster capacity shortage may need more nodes, fewer replicas, lower surge, or a corrected request after measurement.

During an OOMKilled incident, the operator path is:

```bash
$ kubectl get pods -l app=devpolaris-orders-api
$ kubectl describe pod <restarted-pod-name>
$ kubectl logs <restarted-pod-name> --previous --tail=100
$ kubectl top pod -l app=devpolaris-orders-api --containers
```

The likely decision points are different. A memory leak goes to code investigation. A legitimate new memory need goes to a request and limit change. A traffic pattern that loads too much data into memory may need streaming, pagination, or a background Job. Raising a memory limit can stop the immediate restart, but the team should still understand why the process crossed the old boundary.

Good resource settings make Kubernetes behavior easier to explain during releases. The scheduler can place Pods predictably, the kubelet enforces clear boundaries, autoscaling has meaningful inputs, and rollback decisions are based on evidence instead of guesswork.

---

**References**

- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) - Defines CPU and memory requests and limits, scheduler use of requests, kubelet enforcement of limits, and OOMKilled behavior.
- [Assign CPU Resources to Containers and Pods](https://kubernetes.io/docs/tasks/configure-pod-container/assign-cpu-resource/) - Shows CPU request and limit configuration and explains CPU units.
- [Assign Memory Resources to Containers and Pods](https://kubernetes.io/docs/tasks/configure-pod-container/assign-memory-resource/) - Shows memory request and limit configuration, memory units, and memory-limit failure behavior.
- [Reserve Compute Resources for System Daemons](https://kubernetes.io/docs/tasks/administer-cluster/reserve-compute-resources/) - Documents node allocatable resources and how system reservations affect Pod capacity.
- [Pod Quality of Service Classes](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/) - Explains Guaranteed, Burstable, and BestEffort QoS classes and eviction order under node pressure.
- [Limit Ranges](https://kubernetes.io/docs/concepts/policy/limit-range/) - Documents namespace-level constraints and defaults for resource requests and limits.
- [Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/) - Documents namespace-level aggregate resource constraints.
- [kubectl top](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_top/) - Explains live CPU and memory usage from Metrics Server.
- [Resource metrics pipeline](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/) - Describes Metrics API data used for Pod and node CPU and memory metrics.
- [Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/) - Explains HPA resource metrics and CPU utilization relative to requests.
