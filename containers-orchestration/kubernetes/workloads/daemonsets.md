---
title: "DaemonSets"
description: "Run one Kubernetes Pod on each eligible node for logging, monitoring, networking, and node-local helpers."
overview: "DaemonSets turn a changing set of eligible nodes into one node-local Pod per node, with placement, host access, and rollout behavior designed around node coverage."
tags: ["daemonsets", "nodes", "logging", "kubectl"]
order: 5
id: article-containers-orchestration-kubernetes-workloads-daemonsets
---

## Table of Contents

1. [Why does a node-local agent need a DaemonSet?](#why-does-a-node-local-agent-need-a-daemonset)
2. [How does Kubernetes turn each eligible node into one targeted Pod?](#how-does-kubernetes-turn-each-eligible-node-into-one-targeted-pod)
3. [How do node labels, taints, and tolerations shape the eligible node set?](#how-do-node-labels-taints-and-tolerations-shape-the-eligible-node-set)
4. [What access does a node-local agent need, and what security boundary comes with it?](#what-access-does-a-node-local-agent-need-and-what-security-boundary-comes-with-it)
5. [What happens when a node joins, leaves, changes labels, or enters maintenance?](#what-happens-when-a-node-joins-leaves-changes-labels-or-enters-maintenance)
6. [How do DaemonSet rolling updates trade temporary coverage for temporary capacity?](#how-do-daemonset-rolling-updates-trade-temporary-coverage-for-temporary-capacity)
7. [How do you trace one node from eligibility to useful data?](#how-do-you-trace-one-node-from-eligibility-to-useful-data)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

A DaemonSet becomes much easier to understand when you start with the quantity Kubernetes must control.

A Deployment begins with a replica count: “I want `N` interchangeable copies of this application somewhere in the cluster.” A DaemonSet begins with a set of machines: “For every node that satisfies these conditions, I want one copy of this Pod on that node.”

```text
Deployment: desired Pods = replicas
DaemonSet:  desired Pods = eligible nodes
```

With ten eligible nodes, the DaemonSet wants ten Pods. Add an eleventh eligible node and the desired count becomes eleven. Remove three nodes and it becomes eight. There is no `replicas: 10` field because the current set of eligible nodes supplies the count.

The central model is:

> **A DaemonSet maintains a node-local invariant: every eligible node should have one instance of this Pod.**

This is a relationship invariant, not merely a count. Ten Pods running on ten arbitrary nodes are insufficient if two agents share one node while another eligible node has none. The controller cares about the mapping:

```text
each eligible node ↔ its intended DaemonSet Pod
```

That distinction explains why a disappearing node lowers desired population rather than causing its agent to be recreated elsewhere. The missing machine took its node-local logs, devices, and network context with it; an extra copy on another node cannot represent that state.

The article follows seven questions:

1. **Why does a node-local agent need a DaemonSet?**
2. **How does Kubernetes turn each eligible node into one targeted Pod?**
3. **How do node labels, taints, and tolerations shape the eligible node set?**
4. **What access does a node-local agent need, and what security boundary comes with it?**
5. **What happens when a node joins, leaves, changes labels, or enters maintenance?**
6. **How do DaemonSet rolling updates trade temporary coverage for temporary capacity?**
7. **How do you trace one node from eligibility to useful data?**

## Why does a node-local agent need a DaemonSet?
<!-- section-summary: A DaemonSet manages work that must follow node-local data or capabilities. -->

Each Kubernetes node has state and capabilities that belong to that machine. Its `/var/log` directory contains its local logs. Its network interfaces, disks, devices, and kernel state also belong to that node.

Suppose a cluster has three worker nodes and you need to collect container logs. The useful work is local:

| Node | Where its logs exist | Process that can read them locally |
|---|---|---|
| `worker-1` | `worker-1:/var/log` | log agent on `worker-1` |
| `worker-2` | `worker-2:/var/log` | log agent on `worker-2` |
| `worker-3` | `worker-3:/var/log` | log agent on `worker-3` |

A collector on `worker-1` cannot treat `/var/log` as a cluster-wide directory. That path refers to `worker-1`'s filesystem. The natural design is therefore one agent on each node: each agent reads local data and sends it to a central log store.

The agent follows the data. This same relationship appears in:

- node metrics collectors that inspect the local machine;
- CNI networking agents that configure node networking;
- storage node plugins that work with disks attached to a node;
- security agents that inspect node activity;
- device plugins that advertise local hardware;
- node-local caches and proxies.

These processes are node agents managed through Kubernetes. Their desired population changes when the node population changes.

![A DaemonSet deriving one log-agent Pod from each eligible node while a Deployment maintains a separate fixed replica count](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-daemonsets/daemonset-node-coverage.png)

*A Deployment follows a number; a DaemonSet follows the eligible-node set.*

## How does Kubernetes turn each eligible node into one targeted Pod?
<!-- section-summary: The DaemonSet controller chooses eligible nodes, creates a targeted Pod for each, and lets the scheduler perform the final binding. -->

Assume the cluster contains `node-a`, `node-b`, `node-c`, and `node-d`. The DaemonSet controller repeatedly asks the same question for every node: should this DaemonSet run here?

Let `E` mean the eligible-node set and `P` mean the DaemonSet's Pods. The controller tries to maintain one intended Pod for each member of `E`:

| Node | Eligible? | Desired result |
|---|---:|---|
| `node-a` | Yes | one DaemonSet Pod on `node-a` |
| `node-b` | Yes | one DaemonSet Pod on `node-b` |
| `node-c` | No | no DaemonSet Pod |
| `node-d` | Yes | one DaemonSet Pod on `node-d` |

This is an ongoing reconciliation loop. The controller watches both the DaemonSet and the node set, compares desired coverage with actual coverage, and acts whenever the two differ.

The default scheduler still participates. For each eligible node, the DaemonSet controller creates a Pod with required node affinity targeting that node's name. Conceptually, a Pod intended for `worker-17` receives a constraint like this:

```yaml
nodeAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    nodeSelectorTerms:
      - matchFields:
          - key: metadata.name
            operator: In
            values:
              - worker-17
```

The responsibilities are separate:

1. The DaemonSet controller decides that `worker-17` should have a Pod.
2. It creates a Pod whose required affinity targets `worker-17`.
3. The scheduler checks whether that Pod can actually run there and binds it to the node.
4. The kubelet on `worker-17` pulls the image and starts the containers.

That distinction explains how a DaemonSet can want a Pod while the Pod remains `Pending`. The desired node coverage may be correct, yet the target node may lack the requested CPU or memory. A controller can keep asking for the missing Pod; it cannot create capacity on the machine.

### Separate desired coverage from successful placement

Assume four nodes match. The DaemonSet controller can correctly report four desired nodes and create four targeted Pods, yet one remains Pending on `worker-17` because its CPU request cannot fit. The state is then:

```text
eligible nodes          4
intended targeted Pods  4
scheduled Pods          3
useful ready agents     at most 3
```

Increasing replicas is not an available fix because no replica field owns the desired count. Moving the Pod to a roomy node is not a fix either because it must represent `worker-17`. The choices are to free or add capacity on that node, reduce a justified resource request, change node eligibility intentionally, or correct another scheduling constraint.

This is why status needs several counts. `desiredNumberScheduled` proves node selection, while current, ready, available, updated, and misscheduled fields describe later parts of the coverage pipeline. A single “four desired” number cannot prove that all four nodes receive a useful agent.

## How do node labels, taints, and tolerations shape the eligible node set?
<!-- section-summary: Labels select the intended node population, while tolerations allow the Pod through matching taints. -->

The controller needs rules for deciding which nodes belong to `E`. Labels, selectors, affinity, taints, and tolerations answer different parts of that decision.

A label describes a node. For example:

```yaml
metadata:
  labels:
    kubernetes.io/os: linux
    node-pool: general
    logging: enabled
```

The DaemonSet can require those properties:

```yaml
nodeSelector:
  kubernetes.io/os: linux
  logging: enabled
```

A node must satisfy both entries to enter the selected set. Node affinity can express richer matching rules, but the purpose is the same: identify nodes whose properties fit the workload.

A taint works from the node's side. A node with this taint repels ordinary Pods:

```text
dedicated=gpu:NoSchedule
```

A Pod with a matching toleration is allowed past that restriction:

```yaml
tolerations:
  - key: dedicated
    operator: Equal
    value: gpu
    effect: NoSchedule
```

The distinction is worth holding clearly:

| Mechanism | Question it answers |
|---|---|
| `nodeSelector` or node affinity | Which kinds of node does this Pod require? |
| taint | Which Pods should this node repel? |
| toleration | Is this taint an allowed condition for this Pod? |

A toleration grants permission; it does not select the node by itself. A common infrastructure pattern combines both mechanisms:

```yaml
nodeSelector:
  pool: infra

tolerations:
  - key: dedicated
    operator: Equal
    value: infra
    effect: NoSchedule
```

The selector attracts the agent to the infrastructure pool, while the toleration allows it onto nodes protected by the `dedicated=infra:NoSchedule` taint.

DaemonSet Pods also receive several tolerations automatically because node-level software often has to remain present while a node is unhealthy or undergoing maintenance. These cover conditions including `NotReady`, `Unreachable`, disk pressure, memory pressure, PID pressure, and unschedulable nodes.

This behavior explains why this command does not remove ordinary DaemonSet agents from the node:

```bash
kubectl cordon worker-1
```

Cordoning prevents ordinary new scheduling, while node agents may still be needed for networking, logging, metrics, or maintenance visibility. Custom taints still require an explicit matching toleration when the agent legitimately belongs on those nodes.

## What access does a node-local agent need, and what security boundary comes with it?
<!-- section-summary: Node-local agents often need narrow host access, node identity, and resources sized for every selected node. -->

The log agent needs to read the node's files from inside its container. A `hostPath` volume exposes a specific path from the node filesystem at a container path:

```yaml
volumeMounts:
  - name: node-logs
    mountPath: /host/var/log
    readOnly: true

volumes:
  - name: node-logs
    hostPath:
      path: /var/log
      type: Directory
```

On `worker-1`, `/host/var/log` refers to `worker-1:/var/log`. The same Pod template on `worker-2` exposes `worker-2:/var/log`. One template therefore produces node-relative behavior.

Host access crosses an isolation boundary, so the scope matters. Mount the exact path the process needs, make it read-only when possible, avoid privileged mode unless the node operation truly requires it, grant minimal Linux capabilities, and give the ServiceAccount only the Kubernetes API permissions the agent needs.

Different agents need different access. A log reader may only need read-only files. A CNI plugin may need host networking, writes to host paths, privileged operations, or network-namespace access. The workload kind and the security permissions answer separate questions:

- DaemonSet controls where the Pods run and how many exist.
- `securityContext`, volumes, Linux capabilities, and RBAC control what those Pods can do.

The agent commonly needs to identify its own node when tagging logs or metrics. The Downward API can copy the assigned node name into an environment variable:

```yaml
env:
  - name: NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
```

Each instance then reports a different value, such as `NODE_NAME=worker-1`, so a central backend can associate an event with the correct cluster node.

Here is the complete simple log-agent example from those pieces:

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-log-agent
spec:
  selector:
    matchLabels:
      app: node-log-agent
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
  minReadySeconds: 10
  template:
    metadata:
      labels:
        app: node-log-agent
    spec:
      nodeSelector:
        logging: enabled
      tolerations:
        - key: node-agent
          operator: Exists
          effect: NoSchedule
      containers:
        - name: agent
          image: <your-agent-image>
          env:
            - name: NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
          volumeMounts:
            - name: node-logs
              mountPath: /host/var/log
              readOnly: true
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
      volumes:
        - name: node-logs
          hostPath:
            path: /var/log
            type: Directory
```

The selector identifies the Pods owned by the DaemonSet and must match the Pod-template labels. This selector is immutable after creation. The `nodeSelector` chooses nodes. The toleration permits placement on a matching tainted node. The volume exposes local data, and `NODE_NAME` gives that data a node identity.

Resource requests multiply across the fleet. A request of `100m` CPU on each of 500 eligible nodes commits 50 CPUs across the cluster. A small per-node number can become a large fleet-wide reservation.

Read the manifest as one causal sentence: for every node labelled `logging=enabled` and permitted by its taints, create an agent Pod targeted to that node; reserve enough capacity, expose only that node's `/var/log` read-only, identify the node through `spec.nodeName`, and report Ready only when logs can reach the backend.

Every field should support that sentence. Removing `readOnly: true` changes host risk, not coverage. Changing the selector changes the desired node population. Raising the request changes whether each targeted Pod fits and multiplies the reservation by the eligible-node count. Weakening readiness can make status claim coverage before the agent is useful.

For fleet cost, calculate both steady state and update overlap. Five hundred agents requesting `50m` CPU and `64Mi` reserve 25 CPU cores and roughly 31.25 GiB of memory. A surge rollout may temporarily require both old and new requests on selected nodes, so cluster-wide totals are not enough; each individual node must have room for its overlapping pair.

## What happens when a node joins, leaves, changes labels, or enters maintenance?
<!-- section-summary: Changes to nodes and their labels change the DaemonSet's desired set and therefore its Pod population. -->

Think in sets. If the eligible nodes are initially `{A, B, C}`, the desired Pods are `{Pod-A, Pod-B, Pod-C}`.

When matching node `D` joins, the controller observes that `D` belongs to the desired set and has no DaemonSet Pod. It creates `Pod-D` targeted to that node. When node `B` disappears, `B` leaves the desired set and its Pod is garbage collected. There is no need to recreate `Pod-B` on another node because the work represented `B` itself.

This differs from a Deployment:

| Event | Deployment | DaemonSet |
|---|---|---|
| A Pod disappears but the node remains | replace it to restore the replica count | replace it on that same eligible node |
| A node disappears | replace affected replicas elsewhere if needed | desired count falls because that node no longer needs an agent |
| A new node joins | replica count usually stays the same | create an agent when the node is eligible |

Labels can change the set without adding or deleting nodes. Suppose `A` and `B` have `logging=enabled`, while `C` has `logging=disabled`. The eligible set is `{A, B}`. This command moves `C` into the set:

```bash
kubectl label node C logging=enabled --overwrite
```

The controller then creates a Pod for `C`. Changing `B` to `logging=disabled` removes `B` from the set and causes its DaemonSet Pod to be removed.

This lets one cluster run different agents on different node populations: logging on all Linux nodes, a GPU monitor on GPU nodes, a storage agent on storage nodes, and an edge proxy on edge nodes.

DaemonSet status summarizes the same node-set model. Useful fields include:

| Status field | Question it answers |
|---|---|
| `desiredNumberScheduled` | How many nodes should run the daemon? |
| `numberReady` | How many daemon Pods are ready? |
| `numberAvailable` | How many are available? |
| `numberUnavailable` | How many desired nodes lack available coverage? |
| `updatedNumberScheduled` | How many desired nodes run the updated template? |
| `numberMisscheduled` | How many nodes run the daemon even though they should not? |

If twelve nodes are desired, all twelve Pods exist, and only eleven are ready, the controller has achieved placement but one node still lacks useful coverage.

## How do DaemonSet rolling updates trade temporary coverage for temporary capacity?
<!-- section-summary: Rolling-update settings choose between a short gap on a node and temporary overlap of old and new agents. -->

Changing the DaemonSet's Pod template creates a rollout across the eligible-node set. Replacing every agent at once would remove node-level coverage across the fleet, so the controller updates a controlled number of nodes at a time.

The default style uses `maxUnavailable: 1` and no surge:

```yaml
updateStrategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 1
    maxSurge: 0
```

For one node, the old agent stops, the new agent starts, and the new agent becomes ready. The node has a brief coverage gap, while its resource use stays close to one agent's request. `maxUnavailable` controls how many eligible nodes may be in that condition at once.

An alternative preserves coverage with temporary overlap:

```yaml
rollingUpdate:
  maxUnavailable: 0
  maxSurge: 1
```

The old agent stays while the new agent starts. After the new agent is ready, Kubernetes removes the old one. This can temporarily require the sum of both versions' CPU and memory on a node.

Surge is impossible for some node agents. If the old Pod owns host port `9100`, an exclusive device, or a locked socket, the new Pod cannot coexist on that node. The rollout strategy must match both resource capacity and the agent's ability to overlap.

Readiness defines useful coverage. A started process may still be initializing, connecting to a backend, or preparing local state. With a readiness probe and `minReadySeconds: 10`, Kubernetes waits for the new agent to remain ready before treating the handoff as stable.

The trade is therefore concrete:

| Strategy | Temporary state | Main cost |
|---|---|---|
| allow unavailability | one or more nodes briefly have no useful agent | reduced coverage |
| allow surge | old and new agents coexist on a node | extra capacity and possible overlap |

### Prove rollout coverage on nodes with different constraints

Before choosing surge, test whether both versions can coexist with host ports, devices, sockets, host paths, and per-node resources. One roomy test node does not prove a constrained node pool can surge. Before choosing unavailability, decide how long one node may operate without logging, networking, storage, or security coverage and how many simultaneous gaps the system can tolerate.

During rollout, compare `updatedNumberScheduled`, `numberReady`, `numberAvailable`, and `numberUnavailable` with the eligible-node count. Then sample individual nodes from each pool and prove the new agent emits useful node-tagged data. A Ready process that cannot access the local path or reach its backend is not meaningful coverage.

Rollback carries the same trade. Restoring the old Pod template still progresses across nodes under the update strategy. Confirm that recovery does not require coexistence that the old and new agents cannot support, and keep watching actual node coverage until every eligible node again reports useful service.

## How do you trace one node from eligibility to useful data?
<!-- section-summary: Debug one node by following the full chain from selection through scheduling, startup, local access, identity, and readiness. -->

Take `worker-17`. It has these labels:

```yaml
kubernetes.io/os: linux
logging: enabled
```

It also has this taint:

```text
node-agent=true:NoSchedule
```

The DaemonSet selects Linux nodes with logging enabled and tolerates the `node-agent` taint. Trace the result in order:

1. **Selection:** confirm that both required labels match. A mismatch keeps the node outside the desired set.
2. **Permission:** confirm that the Pod tolerates every blocking taint. A selector match does not cancel a taint.
3. **Controller decision:** the DaemonSet should count `worker-17` among its desired nodes.
4. **Targeted Pod:** the controller should create one Pod with required affinity for `worker-17`.
5. **Scheduling:** inspect Pod events for CPU, memory, volume, or other placement failures. The scheduler can leave a correctly targeted Pod `Pending`.
6. **Kubelet startup:** the kubelet on `worker-17` pulls the image and starts the container.
7. **Local data:** `/host/var/log` should map to `worker-17:/var/log`.
8. **Identity:** `NODE_NAME` should equal `worker-17`.
9. **Useful output:** the agent should send recent records tagged with `worker-17` to the backend.
10. **Readiness:** the Pod should report ready only after the agent can perform its useful work.

The first failed step narrows the problem. A desired count that excludes the node points to labels or affinity. A desired Pod with no placement points to the scheduler. A running Pod without local files points to the mount. A ready Pod without backend data points beyond Kubernetes to the agent or its destination.

A final design test helps decide whether this controller fits the workload:

> If a matching node is added tomorrow, should this workload appear there because that node exists?

Logging, metrics, networking, storage, security, device, and node-cache agents usually answer yes. An API that needs more request capacity usually answers with a replica count instead and belongs in a Deployment. The DaemonSet represents each selected node; the Deployment represents service capacity.

## Check Your Answers
<!-- section-summary: Revisit node-derived desired state, targeting, selection, host access, node lifecycle, rolling updates, and diagnosis. -->

:::expand[Why does a node-local agent need a DaemonSet?]{kind="recap"}
A DaemonSet derives its desired count from eligible nodes and maintains one Pod on each. That matches work tied to local logs, networking, storage, devices, or other node-specific state.
:::

:::expand[How does Kubernetes turn each eligible node into one targeted Pod?]{kind="recap"}
The DaemonSet controller decides which nodes need coverage and creates one Pod per eligible node with required affinity for that host. The scheduler performs the final fit check and binding, then the node's kubelet starts the containers.
:::

:::expand[How do node labels, taints, and tolerations shape the eligible node set?]{kind="recap"}
Selectors and affinity identify nodes with the required properties. Taints repel Pods, while matching tolerations allow this agent past those restrictions. Selection and permission usually work together.
:::

:::expand[What access does a node-local agent need, and what security boundary comes with it?]{kind="recap"}
A node agent may use a narrow `hostPath` and the Downward API to read local state and tag it with the node name. Host access is a security boundary, so paths, write access, privileges, Linux capabilities, and RBAC should be limited to the agent's actual job.
:::

:::expand[What happens when a node joins, leaves, changes labels, or enters maintenance?]{kind="recap"}
A matching new node raises the desired count, a removed node lowers it, and label changes move nodes into or out of the selected set. Automatic tolerations let many infrastructure agents remain during conditions that repel ordinary application Pods, including when a node is cordoned.
:::

:::expand[How do DaemonSet rolling updates trade temporary coverage for temporary capacity?]{kind="recap"}
`maxUnavailable` permits a short coverage gap while keeping one agent's resource footprint. `maxSurge` overlaps old and new agents to preserve coverage, which needs extra capacity and may be blocked by exclusive ports, devices, or sockets.
:::

:::expand[How do you trace one node from eligibility to useful data?]{kind="recap"}
Follow one node through label matching, taint permission, the controller's desired set, targeted Pod creation, scheduling, kubelet startup, local mounts, node identity, backend output, and readiness. The first failed transition identifies the layer to investigate.
:::

## References
<!-- section-summary: Kubernetes documentation for DaemonSet behavior and the mechanisms used by node-local agents. -->

- [DaemonSet](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/) — node-derived desired state, Pod targeting, automatic tolerations, node-label changes, status, and update behavior.
- [DaemonSet API](https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/daemon-set-v1/) — status fields and rolling-update parameters.
- [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/) — node selectors and affinity.
- [Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) — node taints and Pod tolerations.
- [Volumes: `hostPath`](https://kubernetes.io/docs/concepts/storage/volumes/#hostpath) — node filesystem access and security considerations.
- [Perform a Rolling Update on a DaemonSet](https://kubernetes.io/docs/tasks/manage-daemon/update-daemon-set/) — rolling-update behavior and rollout inspection.
