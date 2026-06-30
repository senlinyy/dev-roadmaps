---
title: "Resource Requests and Limits"
description: "Set Kubernetes CPU and memory requests and limits so Pods schedule predictably and fail in understandable ways."
overview: "Requests help the scheduler place Pods. Limits constrain runtime usage. `notification-api` shows both fields through Pending Pods, throttling, and memory kills."
tags: ["resources", "requests", "limits", "oom"]
order: 7
id: article-containers-orchestration-kubernetes-workloads-resource-requests-and-limits
---
## Table of Contents

1. [Several Pods Share One Machine](#several-pods-share-one-machine)
2. [The Resource Block](#the-resource-block)
3. [Requests: The Scheduler's Planning Number](#requests-the-schedulers-planning-number)
4. [Limits: The Runtime Boundary](#limits-the-runtime-boundary)
5. [Node Allocatable and Scheduling Fit](#node-allocatable-and-scheduling-fit)
6. [CPU and Memory Behave Differently](#cpu-and-memory-behave-differently)
7. [QoS Classes and Eviction Order](#qos-classes-and-eviction-order)
8. [Namespace Guardrails](#namespace-guardrails)
9. [A Production Sizing Loop](#a-production-sizing-loop)
10. [Debugging Pending Pods and OOMKilled Restarts](#debugging-pending-pods-and-oomkilled-restarts)
11. [How Bad Resource Settings Hurt Rollouts and Autoscaling](#how-bad-resource-settings-hurt-rollouts-and-autoscaling)
12. [Operational Runbook](#operational-runbook)
13. [References](#references)

## Several Pods Share One Machine
<!-- section-summary: Requests and limits start from a shared-node problem: Kubernetes needs numbers for placement, and the node needs boundaries during runtime. -->

Every Pod shares real machines with other Pods. Kubernetes needs a planning number before it can place a Pod, and the node needs runtime boundaries after the container starts. **Requests** and **limits** are the two fields that carry those decisions.

A **request** is the CPU or memory amount the scheduler uses when deciding where a Pod can fit. A **limit** is the runtime ceiling the node enforces after the container starts. They sit next to each other in YAML, but they answer different operational questions.

For the Customer Notification Platform, `notification-api` needs enough CPU and memory to answer requests and pass readiness checks. During a rolling update, the Deployment may ask for a fourth temporary Pod because `maxSurge: 1` allows one extra replica. That surge Pod needs enough requested capacity to schedule. After it starts, it needs enough runtime headroom to stay ready under traffic.

The resource block stays small at first. Scheduling fit, CPU and memory behavior, QoS classes, namespace guardrails, sizing loops, Pending Pods, memory kills, and rollout side effects build on that small block.

| Setting | Plain meaning | Notification example |
|---|---|---|
| **Request** | The CPU or memory amount Kubernetes should plan for when scheduling | Reserve `300m` CPU and `384Mi` memory for each API Pod |
| **Limit** | The runtime ceiling enforced after the container starts | Allow the API to burst to `1` CPU and `768Mi` memory |

A **CPU request** and **memory request** influence placement. A **CPU limit** and **memory limit** influence what happens after the container starts. They sit in the same YAML block, but they answer different operational questions.

![Requests plan limits enforce infographic showing the scheduler using a request to place a notification-api Pod and the runtime enforcing limits through CPU throttling and OOMKilled outcomes](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-resource-requests-and-limits/requests-plan-limits-enforce.png)

*Requests help Kubernetes plan placement, while limits define the runtime boundary the container must live inside.*

_This infographic separates the two decisions: requests help the scheduler place the Pod, while limits define the runtime boundary after the container starts._

## The Resource Block
<!-- section-summary: The resources block deserves its own small example before it appears inside a full Deployment template. -->

The resource block sits close to the image because the numbers describe the runtime shape of that container. For `notification-api`, these values tell the scheduler how much capacity to reserve before placement and tell the node what boundary to enforce after startup. Reading this small block first keeps requests and limits clear before they appear inside a Deployment template with other fields around them later in the release path.

```yaml
resources:
  requests:
    cpu: 300m
    memory: 384Mi
  limits:
    cpu: "1"
    memory: 768Mi
```

`300m` means three tenths of one CPU core. `384Mi` means 384 mebibytes of memory. The API may use less than its request during quiet periods and more than its CPU request during busy periods. The request gives the scheduler a planning number, and the limit gives the node a boundary.

The block carries two separate decisions:

- `requests.cpu` is the CPU amount the scheduler reserves on paper for placement.
- `requests.memory` is the memory amount the scheduler reserves on paper for placement.
- `limits.cpu` is the runtime CPU ceiling, which usually shows up as throttling rather than a restart.
- `limits.memory` is the runtime memory ceiling, and crossing it can end with an `OOMKilled` container.

The block lives inside a container in a Pod template:

```yaml
containers:
  - name: api
    image: ghcr.io/customer-notification/notification-api:2026.06.14-2
    resources:
      requests:
        cpu: 300m
        memory: 384Mi
```

That small slice is enough to understand scheduling. A full Deployment has labels, selectors, probes, rollout strategy, and other fields, but the scheduler looks at the requests in this container block when it decides where the Pod can fit.

## Requests: The Scheduler's Planning Number
<!-- section-summary: Requests tell the scheduler how much CPU and memory to reserve on paper before placing a Pod on a node. -->

A **request** is the amount of CPU or memory Kubernetes uses for scheduling. If a container requests `300m` CPU and `384Mi` memory, the scheduler looks for a node with at least that much unrequested allocatable capacity available for the Pod.

For `notification-api`, the request should reflect normal operating needs. If the API usually needs around `220m` CPU under typical load and sometimes reaches `280m` during template rendering bursts, a `300m` CPU request gives the scheduler a realistic planning number. If the API normally sits near `330Mi` memory after warmup, a `384Mi` memory request gives reasonable headroom.

Requests also feed other Kubernetes features. CPU-based Horizontal Pod Autoscaling calculates utilization as usage relative to CPU requests. If CPU requests are missing or wildly wrong, autoscaling decisions get noisy. ResourceQuota can also count requests at the namespace level, so the namespace needs enough request budget for normal replicas plus rollout surge.

Here is a Pod stuck because the request is too large for current capacity:

```bash
$ kubectl describe pod notification-api-7c9d4c685b-j2z6p -n notifications
Events:
  Warning  FailedScheduling  0/3 nodes are available: 3 Insufficient cpu.
```

The container has no running process yet. The scheduler event says the Pod cannot be placed with its current request and the current cluster capacity.

## Limits: The Runtime Boundary
<!-- section-summary: Limits define what the node enforces after the container starts, and CPU and memory limits fail in different ways. -->

A **limit** is a runtime ceiling. Kubernetes passes limits to the node runtime so the container cannot use unlimited CPU or memory on a shared node.

CPU limits usually cause throttling. If `notification-api` has a `cpu: "1"` limit, the container can use up to one CPU core worth of CPU time. When it wants more, the runtime slows it down. The process usually keeps running, but latency can rise and readiness may slow down.

Memory limits behave more sharply. If the container crosses its memory limit, the runtime can terminate it. Kubernetes reports the previous container state as `OOMKilled`, often with exit code `137`.

```bash
$ kubectl describe pod notification-api-7c9d4c685b-j2z6p -n notifications
Containers:
  api:
    Last State:
      Terminated:
        Reason:     OOMKilled
        Exit Code:  137
    Restart Count:  4
```

For the notification API, a memory kill might happen during a bulk template preview that loads too much data into memory. Raising the limit may stop the immediate restart, but the team should still investigate whether the application should stream, paginate, cache differently, or reject oversized requests.

Limits are guardrails around measured sizing. A limit that is too low creates avoidable failures. A limit that is too high can let one container hurt other workloads on the node. The right values come from measurement and review.

## Node Allocatable and Scheduling Fit
<!-- section-summary: The scheduler compares Pod requests against node allocatable capacity after system reservations and existing Pod requests. -->

**Node allocatable** is the part of a node's CPU and memory Kubernetes can use for Pods after reserving capacity for the operating system, kubelet, and cluster daemons. The scheduler compares Pod requests against the remaining allocatable capacity after other Pod requests are counted.

A node can look quiet in live CPU usage while the scheduler still rejects a Pod. Live usage answers "what is happening right now?" Requests answer "what capacity has already been promised on paper?"

Imagine one node with `2000m` allocatable CPU. Existing Pods request `1800m`. Live usage is only `400m` because traffic is quiet. A new surge Pod requests `300m`. The scheduler rejects it on that node because `1800m + 300m` is greater than `2000m`.

```bash
$ kubectl describe node worker-a
Allocatable:
  cpu:                2
  memory:             7812Mi
Allocated resources:
  Resource           Requests
  cpu                1800m (90%)
  memory             5200Mi (66%)
```

The fix depends on the situation. A request typo should be corrected. A real capacity shortage may need more nodes or fewer replicas. A rollout with `maxSurge: 1` may need temporary capacity before it can safely replace Pods.

![Node allocatable fit infographic showing existing requests filling allocatable CPU, a surge Pod blocked with Insufficient cpu, and live usage that can still look low](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-resource-requests-and-limits/node-allocatable-fit.png)

*A Pod can stay Pending because requested capacity does not fit, even if live usage looks low at that moment.*

_This infographic shows the scheduling surprise: a node can look quiet in live usage while the scheduler still rejects a surge Pod because requested capacity is already committed._

## CPU and Memory Behave Differently
<!-- section-summary: CPU can be compressed through throttling, while memory pressure can terminate the container. -->

**CPU is compressible** in Kubernetes resource behavior. If several containers want more CPU than the node can give at that moment, they can be throttled or slowed down. The API may still run, but response time and startup time can suffer.

**Memory pressure has a harder boundary**. If a process needs memory and the limit has no room left, the node cannot keep slowing down memory allocation forever. The container may be killed, and Kubernetes may restart it according to the Pod's restart policy.

For `notification-api`, CPU pressure may look like slow readiness:

```bash
$ kubectl logs -n notifications notification-api-7c9d4c685b-j2z6p --tail=5
readiness=waiting reason="template cache warmup still running" elapsed_ms=42100
```

Memory pressure may look like a restart:

```bash
$ kubectl logs -n notifications notification-api-7c9d4c685b-j2z6p --previous --tail=5
processing bulk template preview request id=req-8491 recipients=50000
memory rss=742Mi heapUsed=601Mi
```

The repair path differs. CPU throttling may need a higher request, no CPU limit for latency-sensitive workloads, more replicas, or code optimization. Memory kills need a memory profile, safer request sizes, higher limits only when justified, and application fixes for large allocations.

## QoS Classes and Eviction Order
<!-- section-summary: Kubernetes assigns QoS classes from requests and limits, and those classes influence which Pods are evicted first under node pressure. -->

Kubernetes assigns each Pod a **Quality of Service class**, often called **QoS**. The class comes from container resource requests and limits. It helps Kubernetes choose which Pods to evict first when a node is under resource pressure.

QoS shows why missing resource fields create operational risk beyond one Pod. If the notification namespace has important API Pods with no requests or limits, Kubernetes has weaker planning data and those Pods receive the lowest QoS class. A clear request and limit policy gives the scheduler and eviction logic a better signal during node pressure.

| QoS class | Plain meaning | Typical resource shape |
|---|---|---|
| **Guaranteed** | Every container has CPU and memory requests equal to limits | Strictly sized critical workloads |
| **Burstable** | At least one request exists, and requests and limits differ somewhere | Most production app Pods |
| **BestEffort** | No CPU or memory requests or limits | Small experiments or risky defaults |

`notification-api` will often be Burstable: it has requests for scheduling and higher limits for bursts. That is normal for many web services. A critical single-purpose infrastructure Pod might be Guaranteed. BestEffort is usually a poor fit for important production workloads because the scheduler has no planning number and eviction priority is low.

QoS is one signal inside sizing work. A Guaranteed Pod can still be badly sized. A Burstable Pod can be reliable when requests and limits come from real measurement. Treat QoS as one signal in the larger resource design.

## Namespace Guardrails
<!-- section-summary: LimitRanges and ResourceQuotas set namespace-level defaults and budgets so teams cannot accidentally create unbounded or overcommitted workloads. -->

A **LimitRange** sets default or allowed resource values inside a namespace. It can apply default requests and limits when a Pod omits them, or reject values outside allowed ranges.

Namespace guardrails protect a shared cluster from accidental resource shapes. For the notification team, they can prevent an API Pod from launching with no request, stop a typo such as a giant memory value, and make rollout capacity visible before production. These controls sit at the namespace level, so they affect every Deployment, Job, and CronJob in that scope.

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: notification-defaults
  namespace: notifications
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      default:
        cpu: 500m
        memory: 512Mi
```

A **ResourceQuota** caps aggregate usage in a namespace. It can limit total requested CPU, total requested memory, and object counts.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: notification-compute
  namespace: notifications
spec:
  hard:
    requests.cpu: "8"
    requests.memory: 16Gi
    limits.memory: 32Gi
```

These guardrails protect shared clusters. They also create real release constraints. If the notification namespace has only enough request budget for three replicas and no surge, a rollout may fail even when the nodes have capacity. Check quota before blaming the scheduler.

## A Production Sizing Loop
<!-- section-summary: Resource settings should come from measurement, release evidence, and repeated tuning rather than one-time guesses. -->

Resource sizing is a loop. Choose a reasonable baseline, observe real behavior, adjust through normal review, and keep learning from production issues.

The loop is necessary because the first numbers are estimates. The notification API may use one shape during normal traffic, another during template preview bursts, and another during startup after a release. The team should treat requests and limits as reviewed operating data that changes with the application and traffic pattern.

For `notification-api`, a practical loop looks like this:

1. Measure local and staging behavior during startup, readiness, normal traffic, and bursty template preview paths.
2. Set initial requests from normal operating needs plus headroom.
3. Set memory limits high enough for expected bursts and low enough to protect the node.
4. Release with dashboards for CPU usage, CPU throttling, memory working set, restarts, readiness time, and latency.
5. Tune after real traffic, especially after a campaign or provider outage changes request patterns.
6. Revisit values when the image, runtime, traffic shape, or rollout strategy changes.

Use multiple signals together. CPU average can hide short throttling bursts. Memory working set can hide startup peaks. Restarts can lag behind a bad limit. Readiness time can reveal resource pressure before users see errors.

`notification-worker` may need different values from `notification-api`. A worker that renders templates and calls providers may use more memory per message than the API. It may also tolerate CPU throttling differently because queue processing latency has different user impact than HTTP request latency. Separate Deployments let each workload carry its own resource shape.

## Debugging Pending Pods and OOMKilled Restarts
<!-- section-summary: Pending Pods point to scheduling evidence, while OOMKilled restarts point to runtime memory evidence and previous logs. -->

This debug section separates placement failures from runtime failures. A Pending Pod has no useful application logs because there is no running container yet. An OOMKilled Pod did start, crossed its memory boundary, and may already be running again by the time the operator checks. The evidence sources are different, so the repair path should start from the visible symptom and the Kubernetes state around it.

A **Pending Pod** has no running container yet. Pod events usually explain the scheduling blocker:

```bash
$ kubectl get pods -n notifications -l app.kubernetes.io/name=notification-api
NAME                               READY   STATUS    AGE
notification-api-7c9d4c685b-j2z6p  0/1     Pending   3m

$ kubectl describe pod -n notifications notification-api-7c9d4c685b-j2z6p
Events:
  Warning  FailedScheduling  0/3 nodes are available: 3 Insufficient memory.
```

From there, check events, nodes, and quota:

```bash
$ kubectl get events -n notifications --sort-by=.lastTimestamp
$ kubectl describe node worker-a
$ kubectl get resourcequota -n notifications
```

A request typo such as `memory: 384Gi` instead of `384Mi` should be corrected in the manifest. A real capacity shortage may need more nodes, fewer replicas, lower surge, or a measured request change.

An **OOMKilled restart** means the container crossed its memory boundary. The Pod may be Running again by the time you check it, so `describe pod` and previous logs are important:

```bash
$ kubectl describe pod -n notifications notification-api-7c9d4c685b-j2z6p
Last State:
  Terminated:
    Reason:     OOMKilled
    Exit Code:  137
Restart Count:  4

$ kubectl logs -n notifications notification-api-7c9d4c685b-j2z6p --previous --tail=50
2026-06-14T12:19:03Z processing bulk template preview request id=req-8491 recipients=50000
2026-06-14T12:19:19Z memory rss=742Mi heapUsed=601Mi
```

Now the team can choose the right repair. A memory leak needs code investigation. A legitimate bulk path may need streaming instead of loading every recipient into memory. A limit that sits too close to normal behavior may need to increase along with the request.

## How Bad Resource Settings Hurt Rollouts and Autoscaling
<!-- section-summary: Requests and limits influence rollout progress, readiness timing, Pod restarts, and autoscaler math. -->

Resource settings connect directly to rollout safety. A Deployment can have a careful RollingUpdate strategy and still fail when resource settings block the new Pods.

Here is the release story again. `notification-api` has three replicas and `maxSurge: 1`. Version `2026.06.14-2` starts a rollout. The new Pod requests `800m` CPU because someone copied values from a larger service. Every node has only `500m` of unrequested allocatable CPU. The Pod stays Pending, `kubectl rollout status` waits, and the Deployment eventually reports progress deadline exceeded.

Another version of the same problem starts after the Pod schedules. The request is too low, so the Pod lands on a busy node. Startup competes for CPU, readiness takes too long, and the rollout waits. The Pod may eventually pass, but the release looks flaky because placement hid the real capacity need.

Memory limits can damage rollouts too. A new image may use more memory during startup because it loads a new template cache. If the limit remains at `512Mi` and startup reaches `620Mi`, the container gets OOMKilled before readiness succeeds. Kubernetes keeps trying, old Pods keep serving if the strategy allows it, and the release never completes.

Autoscaling has its own connection. For CPU-based HPA targets, Kubernetes uses CPU usage relative to CPU requests. If the request is much lower than real normal usage, utilization looks high and the HPA may scale aggressively. If the request is much higher than real usage, utilization looks low and the HPA may scale late. Missing CPU requests can make CPU utilization unavailable for the metric.

Resource tuning belongs in release planning. A production release should answer what code is running, how Kubernetes knows it is ready, and what capacity shape it needs.

## Operational Runbook
<!-- section-summary: A simple runbook helps teams verify resource settings before release and respond quickly when capacity failures appear. -->

The runbook turns the resource ideas into a release habit. Before rollout, the team checks whether the desired replicas and surge Pods can fit. During an incident, the team reads scheduler events for Pending Pods and previous logs for memory kills. Keeping those paths separate helps the team choose between a manifest fix, quota change, node capacity change, or application memory fix without guessing under release pressure or noisy alerts.

A resource review before a notification API release usually covers these checks:

1. Confirm each production container has explicit CPU and memory requests.
2. Confirm memory limits leave headroom above startup, normal peak, and expected burst usage.
3. Confirm CPU limits, if used, match the latency goal and throttling evidence for the service.
4. Confirm the namespace has enough ResourceQuota budget for desired replicas plus rollout surge.
5. Confirm node groups or autoscaling can supply enough allocatable capacity for surge Pods.
6. Confirm dashboards show CPU, memory, restarts, OOMKilled, Pending Pods, and HPA behavior.

During a Pending Pod investigation, the operator path is:

```bash
$ kubectl get pods -n notifications -l app.kubernetes.io/name=notification-api
$ kubectl describe pod -n notifications <pending-pod-name>
$ kubectl get events -n notifications --sort-by=.lastTimestamp
$ kubectl describe node <candidate-node-name>
$ kubectl get resourcequota -n notifications
```

The likely decision points are straightforward. A manifest typo gets fixed and redeployed. A namespace quota shortage goes to the platform owner or release owner. A real cluster capacity shortage may need more nodes, fewer replicas, lower surge, or a corrected request after measurement.

During an OOMKilled investigation, the operator path is:

```bash
$ kubectl get pods -n notifications -l app.kubernetes.io/name=notification-api
$ kubectl describe pod -n notifications <restarted-pod-name>
$ kubectl logs -n notifications <restarted-pod-name> --previous --tail=100
$ kubectl top pod -n notifications -l app.kubernetes.io/name=notification-api --containers
```

The likely decision points are different. A memory leak goes to code investigation. A legitimate new memory need goes to a request and limit change. A traffic pattern that loads too much data into memory may need streaming, pagination, or a background Job. Raising a memory limit can stop the immediate restart, but the team should still understand why the process crossed the old boundary.

Good resource settings make Kubernetes behavior clear during releases. The scheduler can place Pods predictably, the kubelet enforces clear boundaries, autoscaling has meaningful inputs, and rollback decisions come from evidence instead of guesswork.

![Resource sizing loop infographic showing notification-api moving through measure, set values, release, watch metrics, tune, and production signals such as Pending and OOMKilled](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-resource-requests-and-limits/resource-sizing-loop.png)

*Resource sizing is an operating loop: measure, set requests and limits, release, watch signals, and tune safely.*

_This infographic summarizes resource tuning as a loop, because the right request and limit values come from measurement, release evidence, metrics, and production feedback._

## References

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
