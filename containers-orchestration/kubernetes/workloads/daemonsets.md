---
title: "DaemonSets"
description: "Run one Kubernetes Pod on each eligible node for logging, monitoring, networking, and node-local helpers."
overview: "DaemonSets are for node-level work. A cluster-wide helper supports the Customer Notification Platform by following eligible nodes and exposing missing-agent symptoms."
tags: ["daemonsets", "nodes", "logging", "kubectl"]
order: 5
id: article-containers-orchestration-kubernetes-workloads-daemonsets
---
## Table of Contents

1. [DaemonSets Run Node-Level Agents](#daemonsets-run-node-level-agents)
2. [Node-Local Pods](#node-local-pods)
3. [A DaemonSet Skeleton](#a-daemonset-skeleton)
4. [Add Node Selection and Tolerations](#add-node-selection-and-tolerations)
5. [Add the Agent Container and Node Mounts](#add-the-agent-container-and-node-mounts)
6. [Inspecting DaemonSet Coverage](#inspecting-daemonset-coverage)
7. [Rolling Updates and Rollbacks](#rolling-updates-and-rollbacks)
8. [Debugging Missing Pods and Stuck Updates](#debugging-missing-pods-and-stuck-updates)
9. [Production Runbooks](#production-runbooks)
10. [Choosing DaemonSet or Another Workload](#choosing-daemonset-or-another-workload)
11. [References](#references)

## DaemonSets Run Node-Level Agents
<!-- section-summary: DaemonSets run node-level helpers, where the useful unit is one Pod per eligible node rather than a fixed replica count. -->

A **DaemonSet** runs one Pod on each eligible node. It fits node-level helpers such as log agents, metrics collectors, networking helpers, security sensors, and storage daemons. The desired count comes from the nodes that match the DaemonSet rules rather than from a `replicas` number.

For the Customer Notification Platform, application Pods may move across worker nodes during rollouts, scaling, and repairs. The platform team still needs logs and node-level signals from every eligible application worker. If `notification-api` runs on `worker-a`, a log agent on `worker-a` can read that node's container log files and forward them. If the API later runs on `worker-b`, the same kind of agent needs to exist there too.

The node-coverage problem leads to a DaemonSet skeleton, node selection, tolerations, hostPath mounts, coverage checks, rolling updates, and debugging commands for missing agents.

## Node-Local Pods
<!-- section-summary: A DaemonSet is for software that must run on nodes because the node itself is part of the job. -->

**Node-local** means the Pod's job depends on the node where it runs. A log agent reads files from that node. A monitoring agent reads node metrics from that node. A storage or networking helper configures local behavior on that node. The application may run anywhere, so the helper needs to follow the set of nodes rather than the number of application replicas.

For the notification platform, the team wants every application node to ship container logs to the central logging system. If an API Pod runs on `worker-a`, the log agent on `worker-a` reads that Pod's logs from the node and forwards them. If the cluster autoscaler adds `worker-f` during a launch campaign, the DaemonSet creates a log agent Pod there as well.

The DaemonSet controller handles this coverage loop. It evaluates nodes, creates one Pod per eligible node, and keeps replacing those Pods when they fail. The Pod template works like other workload templates, but DaemonSet Pods use `restartPolicy: Always` or omit the field so Kubernetes applies the default.

Logging agents, node exporters, security sensors, storage daemons, CNI plugin components, and local caching helpers all need node-level placement. The operating question changes from "how many replicas do we want?" to "which nodes must have this Pod?"

![DaemonSet node coverage infographic showing a DaemonSet placing one log agent Pod on each eligible node and automatically adding an agent when a new app node appears](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-daemonsets/daemonset-node-coverage.png)

*A DaemonSet follows eligible nodes, so node growth and node labels directly change where agent Pods appear.*

_This infographic shows the DaemonSet coverage loop: the desired count follows eligible nodes instead of an application replica number._

## A DaemonSet Skeleton
<!-- section-summary: The DaemonSet skeleton looks like a controller around a Pod template, with a selector that must match template labels. -->

The skeleton should look familiar because a DaemonSet still wraps a Pod template. The difference is the count. The log agent count comes from eligible nodes rather than a fixed `replicas` field. For the notification platform, the first thing to protect is the ownership link between the DaemonSet selector and the labels copied onto every node-local agent Pod, since that link decides which Pods the controller manages on each node pool.

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: notification-log-agent
  namespace: observability
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: notification-log-agent
  template:
    metadata:
      labels:
        app.kubernetes.io/name: notification-log-agent
```

The selector and template labels form the ownership contract. The DaemonSet controller creates and manages Pods with those labels. As with Deployments, the selector should be planned carefully because it is part of the controller identity.

The skeleton has three field groups to read first:

- `metadata.name` and `metadata.namespace` name the node agent object.
- `spec.selector.matchLabels` defines which Pods the DaemonSet owns.
- `spec.template.metadata.labels` defines the labels copied onto each node-local Pod.

The skeleton has no container yet and no placement rules yet. If we added only a container, the DaemonSet would try to run on every eligible node in the cluster. For the notification platform, the team wants only the app node pool.

## Add Node Selection and Tolerations
<!-- section-summary: Node selectors choose which nodes should receive DaemonSet Pods, while tolerations let trusted Pods run on intentionally tainted nodes. -->

An **eligible node** is a node that matches the DaemonSet's placement rules and can run the Pod. A DaemonSet may use `nodeSelector`, node affinity, taints and tolerations, or other scheduling constraints to define eligibility.

The notification log agent should follow application nodes only. Control-plane nodes, GPU nodes, storage nodes, and special-purpose nodes may have different security or performance requirements. Placement rules let the platform team state which node pool should receive the agent before the DaemonSet starts creating Pods across the fleet.

A **node selector** is the simplest placement rule. It says the node must have a matching label:

```yaml
template:
  spec:
    nodeSelector:
      devpolaris.io/node-pool: app
```

In this example, only nodes labeled `devpolaris.io/node-pool=app` should receive the log agent. Control-plane nodes, GPU nodes, and storage nodes can stay outside this DaemonSet if they use different labels.

A **taint** repels Pods from a node unless the Pod has a matching **toleration**. Dedicated nodes often use taints so only trusted workloads run there. If the app node pool has a taint such as `dedicated=app:NoSchedule`, the log agent needs a toleration:

```yaml
template:
  spec:
    tolerations:
      - key: dedicated
        operator: Equal
        value: app
        effect: NoSchedule
```

Node selection chooses the target pool. Tolerations let the Pod pass intentional taints on those nodes. Both pieces should appear in the runbook because a missing node label and a missing toleration create different symptoms.

![DaemonSet eligibility filters infographic showing app, gpu, and control nodes passing or skipping nodeSelector and toleration filters before an agent Pod is placed](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-daemonsets/daemonset-eligibility-filters.png)

*Node selectors and tolerations decide which nodes receive the agent before the Pod can run.*

_This infographic separates the two placement questions: node selection chooses the target pool, and tolerations let trusted DaemonSet Pods pass intentional taints._

## Add the Agent Container and Node Mounts
<!-- section-summary: A node log agent usually needs a container image, resource settings, and read-only hostPath mounts into node log directories. -->

The container block looks familiar from Pods and Deployments. The difference is the job the container performs. The log agent must read log files from the node, enrich them with metadata, and forward them to a central system.

That job makes resource and mount choices more sensitive than they may look. One small agent runs on every eligible node, so the total CPU and memory request grows with the node count. The agent also reads node files through a hostPath mount, so the manifest should keep the mount read-only and focused on the log directory it truly needs.

```yaml
containers:
  - name: agent
    image: ghcr.io/customer-notification/log-agent:2026.06.14
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 500m
        memory: 512Mi
```

Resource settings are important for DaemonSets because one Pod runs on each eligible node. A small per-Pod request turns into cluster-wide capacity when multiplied by every node.

The agent also needs a read-only mount of node log files:

```yaml
volumes:
  - name: varlogcontainers
    hostPath:
      path: /var/log/containers
      type: Directory
containers:
  - name: agent
    volumeMounts:
      - name: varlogcontainers
        mountPath: /var/log/containers
        readOnly: true
```

`hostPath` mounts a path from the node into the Pod. It is powerful and should be used carefully. A logging agent may need it because the node's container log files live outside the Pod. A normal application Pod should usually avoid it because it couples the application to node internals and expands security risk.

## Inspecting DaemonSet Coverage
<!-- section-summary: Coverage checks compare desired, current, ready, and available DaemonSet Pods against the eligible node set. -->

Coverage is the main health signal for a DaemonSet. The notification team wants one ready agent on each eligible application node. The first command compares desired, current, ready, and available counts so the team can see whether Kubernetes coverage matches the node pool before checking the logging system or agent configuration. This is the Kubernetes layer of the symptom, before downstream log delivery.

```bash
$ kubectl get daemonset -n observability notification-log-agent
NAME                     DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR
notification-log-agent   4         4         4       4            4           devpolaris.io/node-pool=app
```

`DESIRED` is the number of eligible nodes. `CURRENT` is the number of DaemonSet Pods created. `READY` and `AVAILABLE` show how many are healthy enough to count for operations.

List the Pods with nodes:

```bash
$ kubectl get pods -n observability \
  -l app.kubernetes.io/name=notification-log-agent -o wide
NAME                           READY   STATUS    NODE
notification-log-agent-4tdsk   1/1     Running   worker-a
notification-log-agent-7kq2p   1/1     Running   worker-b
notification-log-agent-m91px   1/1     Running   worker-c
notification-log-agent-z8vnt   1/1     Running   worker-d
```

The `-o wide` output shows the node for each Pod. A healthy DaemonSet should have one ready agent Pod on every eligible node. When notification logs disappear from one node, this is the first view the platform team checks.

Compare that against eligible nodes:

```bash
$ kubectl get nodes -l devpolaris.io/node-pool=app
NAME       STATUS   ROLES    AGE
worker-a   Ready    <none>   18d
worker-b   Ready    <none>   18d
worker-c   Ready    <none>   18d
worker-d   Ready    <none>   2h
```

If there are four eligible nodes and four ready DaemonSet Pods, the Kubernetes coverage layer looks healthy. The downstream logging system still needs its own check.

## Rolling Updates and Rollbacks
<!-- section-summary: DaemonSet updates replace one or more node-local Pods at a time, so rollout settings protect cluster-wide helper coverage. -->

DaemonSets support rolling updates. The update strategy controls how many agent Pods can be unavailable during the update:

Updating a node agent can affect every workload on the node, so the rollout pace deserves the same care as an application release. For the log agent, a brief gap may mean missing logs from one node. For networking or storage agents, a bad update can affect application traffic directly. The strategy below keeps only one agent unavailable at a time in the training example.

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
```

`maxUnavailable: 1` means Kubernetes should update one node-local Pod at a time. For a log agent, that limits the period where one node may briefly lack log forwarding. For networking or storage agents, the value may need even stricter review because the helper may affect every Pod on the node.

Update the image through a manifest or command:

```bash
$ kubectl set image daemonset/notification-log-agent -n observability \
  agent=ghcr.io/customer-notification/log-agent:2026.06.14-2
daemonset.apps/notification-log-agent image updated

$ kubectl rollout status daemonset/notification-log-agent -n observability
daemon set "notification-log-agent" successfully rolled out
```

Rollback uses the rollout machinery:

```bash
$ kubectl rollout history daemonset/notification-log-agent -n observability
$ kubectl rollout undo daemonset/notification-log-agent -n observability
$ kubectl rollout status daemonset/notification-log-agent -n observability
```

After a rollback, verify both Kubernetes and the downstream system. A ready agent Pod is useful evidence, and the real outcome is that logs from each application node arrive in the central logging platform.

## Debugging Missing Pods and Stuck Updates
<!-- section-summary: DaemonSet debugging starts with node eligibility, then checks taints, scheduling events, Pod logs, and rollout status. -->

When a node has no DaemonSet Pod, eligibility is the first check. A DaemonSet creates Pods for eligible nodes, so compare the node labels to the DaemonSet placement rules.

The first useful question is why Kubernetes thinks the node qualifies. A missing label, an unmatched taint, a resource shortage, an image failure, or a broken hostPath mount can all produce a node without a healthy agent. Eligibility evidence prevents the team from chasing agent logs on a Pod Kubernetes never created.

```bash
$ kubectl get node worker-c --show-labels
$ kubectl get daemonset -n observability notification-log-agent -o yaml
```

If the labels match, check taints. A dedicated node may repel the agent because the Pod template lacks a matching toleration.

```bash
$ kubectl describe node worker-c | grep -A3 Taints
$ kubectl get daemonset -n observability notification-log-agent \
  -o jsonpath='{.spec.template.spec.tolerations}'
```

If eligibility and tolerations look correct, check scheduling and resource pressure. A DaemonSet Pod still needs CPU, memory, image pull access, volume mounts, and a working kubelet. Pod events usually point to the blocker.

```bash
$ kubectl get pods -n observability \
  -l app.kubernetes.io/name=notification-log-agent -o wide
$ kubectl describe daemonset -n observability notification-log-agent
$ kubectl get events -n observability --sort-by=.lastTimestamp
$ kubectl describe node worker-c
```

For a stuck rollout, compare old and new Pods. `UP-TO-DATE` below the desired count usually means the rollout cannot replace some Pods yet. Common causes include the new image failing to pull, the new container crashing, resource requests that no longer fit on a node, a broken hostPath mount, or a readiness condition that never passes.

```bash
$ kubectl rollout status daemonset/notification-log-agent -n observability
$ kubectl get daemonset -n observability notification-log-agent
$ kubectl logs -n observability \
  -l app.kubernetes.io/name=notification-log-agent --all-containers=true --tail=100
```

When the new agent image crashes, rollback quickly if logs or metrics are production-critical. When the rollout is stuck because one node lacks resources, decide whether to reduce the agent request, drain unrelated workload from that node, or add capacity.

## Production Runbooks
<!-- section-summary: DaemonSet runbooks should connect Kubernetes coverage, node state, rollout state, and the downstream system the agent supports. -->

A good DaemonSet runbook starts with the business symptom. "Notification logs are missing from one node" is different from "all log agents crash after rollout" and different from "the networking agent is absent from a new node." The commands overlap, but the risk and rollback decision are different.

For **missing logs from one notification node**, identify the node that hosted the affected API or worker Pod. Then check whether the log agent Pod exists and is ready on the same node. If the agent exists, read its logs and check the downstream logging system. If the agent is absent, walk through labels, taints, tolerations, and node events.

```bash
$ kubectl get pod -n notifications -l app.kubernetes.io/name=notification-api -o wide
$ kubectl get pod -n observability -l app.kubernetes.io/name=notification-log-agent -o wide
$ kubectl describe node worker-c
```

For **a new node with no agent**, check the node labels applied by the node pool or cluster autoscaler. New nodes often miss custom labels when an infrastructure template changes. Fix the node pool configuration first, then label the current node only if you need an immediate repair.

```bash
$ kubectl label node worker-f devpolaris.io/node-pool=app
$ kubectl get pod -n observability -l app.kubernetes.io/name=notification-log-agent -o wide
```

For **a DaemonSet rollout that breaks telemetry**, rollback to the known good revision and keep the failed Pod logs. The failed Pods tell the team whether the issue was configuration, image startup, permissions, or downstream authentication. After rollback, verify the logging dashboard for at least one node per zone.

```bash
$ kubectl rollout history daemonset/notification-log-agent -n observability
$ kubectl rollout undo daemonset/notification-log-agent -n observability
$ kubectl rollout status daemonset/notification-log-agent -n observability
```

For **planned node maintenance**, remember that DaemonSet Pods may run on cordoned or unschedulable nodes because DaemonSets get special tolerations. Draining a node has rules around DaemonSet-managed Pods, so maintenance runbooks should focus on moving normal application Pods away, handling the node, and confirming the DaemonSet agent returns when the node rejoins service.

## Choosing DaemonSet or Another Workload
<!-- section-summary: Use DaemonSets for node-level helpers, Deployments for replicated services, and Jobs or CronJobs for finite work. -->

The Customer Notification Platform now has several workload shapes. The API server uses a Deployment because it should serve traffic continuously. The worker uses a Deployment because it should keep consuming queue messages. The migration uses a Job because it should finish once. The stale delivery cleanup uses a CronJob because it should create Jobs on a schedule. The log agent uses a DaemonSet because node coverage is the point.

Use a DaemonSet when the node itself is part of the job. Logs, metrics, security agents, storage helpers, and network components often need one Pod on each eligible node. Use a Deployment when you care about an application replica count. Use a Job or CronJob when the process should finish.

| Workload | Placement rule | Notification platform example |
|---|---|---|
| Deployment | Run a desired number of service replicas | `notification-api` |
| Deployment | Run a desired number of worker replicas | `notification-worker` |
| Job | Run finite work to completion | Notification schema migration |
| CronJob | Create finite work from a schedule | Nightly stale delivery cleanup |
| DaemonSet | Run one Pod on each eligible node | Log agent on app nodes |

For DaemonSets, inspect nodes and Pods together. Check labels, selectors, taints, tolerations, resource pressure, rollout revisions, and the downstream system the agent supports. A ready DaemonSet Pod is a good sign, and the real success check is whether the node-local job is actually happening.

![DaemonSet debug runbook infographic showing symptom, coverage, node state, agent logs, downstream logs, and rollback as the troubleshooting path](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-daemonsets/daemonset-debug-runbook.png)

*A missing-agent investigation should prove node eligibility, Pod health, downstream delivery, and rollback evidence in order.*

_This infographic summarizes the DaemonSet runbook: start from the missing node-local symptom, prove coverage, inspect node state and agent logs, then verify the downstream system._

## References

- [Kubernetes Workloads](https://kubernetes.io/docs/concepts/workloads/) - Overview of Kubernetes workload resources and controllers.
- [DaemonSet](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/) - Official DaemonSet behavior, required fields, selectors, node selection, scheduling, tolerations, communication patterns, and alternatives.
- [Perform a Rolling Update on a DaemonSet](https://kubernetes.io/docs/tasks/manage-daemon/update-daemon-set/) - Official rollout commands and troubleshooting guidance for DaemonSet updates.
- [Perform a Rollback on a DaemonSet](https://kubernetes.io/docs/tasks/manage-daemon/rollback-daemon-set/) - Official rollback commands and revision behavior for DaemonSets.
- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) - Official label and selector behavior used by DaemonSet Pod selectors and node labels.
- [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/) - Official `nodeSelector`, node affinity, and scheduling constraint behavior.
- [Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) - Official taint and toleration behavior for dedicated and special-purpose nodes.
- [kubectl get](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/) - Generated reference for listing resources.
- [kubectl describe](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_describe/) - Generated reference for inspecting resource details and events.
- [kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/) - Generated reference for reading Pod logs.
