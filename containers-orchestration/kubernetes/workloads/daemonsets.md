---
title: "DaemonSets"
description: "Run one Kubernetes Pod on each eligible node for logging, monitoring, networking, and node-local helpers."
overview: "DaemonSets are for node-level work. This article shows how a cluster-wide helper supports `devpolaris-orders-api`, why it follows nodes instead of replica counts, and how to debug missing DaemonSet Pods."
tags: ["daemonsets", "nodes", "logging", "kubectl"]
order: 5
id: article-containers-orchestration-kubernetes-workloads-daemonsets
---

## Table of Contents

1. [What This Article Covers](#what-this-article-covers)
2. [Node-Local Pods](#node-local-pods)
3. [A Log Agent for Orders Nodes](#a-log-agent-for-orders-nodes)
4. [Selectors, Labels, and Eligible Nodes](#selectors-labels-and-eligible-nodes)
5. [Taints, Tolerations, and Dedicated Nodes](#taints-tolerations-and-dedicated-nodes)
6. [Inspecting DaemonSet Coverage](#inspecting-daemonset-coverage)
7. [Rolling Updates and Rollbacks](#rolling-updates-and-rollbacks)
8. [Debugging Missing Pods and Stuck Updates](#debugging-missing-pods-and-stuck-updates)
9. [Production Runbooks](#production-runbooks)
10. [Choosing DaemonSet or Another Workload](#choosing-daemonset-or-another-workload)

## What This Article Covers
<!-- section-summary: DaemonSets run node-local helpers, so the article focuses on node eligibility, coverage, and safe updates. -->

`devpolaris-orders-api` runs as a normal application Deployment. The API Pods can move between worker nodes as Kubernetes schedules, replaces, and updates them. That works well for customer traffic because the team cares about having enough healthy API replicas behind the Service.

Some supporting software needs a different placement rule. A log collector should run on every node that may host orders Pods, because it reads the node's container logs. A metrics agent should run near the node it observes. A network plugin component often needs to exist on each node so Pods on that node can communicate correctly.

A **DaemonSet** is the Kubernetes workload object for that kind of node-local work. It creates one Pod on each eligible node, adds Pods when new eligible nodes join, and removes Pods when nodes leave or stop matching the rules. The count follows node coverage rather than an application replica number.

We will follow the orders platform through a practical DaemonSet story. The team adds a log agent for `devpolaris-orders-api`, limits it to the application node pool, handles taints and tolerations, checks coverage, rolls out a new agent image, and debugs missing Pods when one node has no logs.

## Node-Local Pods
<!-- section-summary: A DaemonSet is for software that must run on nodes because the node itself is part of the job. -->

**Node-local** means the Pod's job depends on the node where it runs. A log agent reads files from that node. A monitoring agent reads node metrics from that node. A storage or networking helper configures local behavior on that node. The application may run anywhere, so the helper needs to follow the set of nodes rather than the number of application replicas.

For `devpolaris-orders-api`, the platform team wants every orders node to ship container logs to the central logging system. If an API Pod runs on `worker-a`, the log agent on `worker-a` reads that Pod's logs from the node and forwards them. If the cluster autoscaler adds `worker-f` during a sale, the DaemonSet creates a log agent Pod there as well.

The DaemonSet controller handles this coverage loop. It evaluates nodes, creates one Pod per eligible node, and keeps replacing those Pods when they fail. The Pod template works like other workload templates, but DaemonSet Pods use `restartPolicy: Always` or omit the field so Kubernetes applies the default.

This is why DaemonSets show up in platform and cluster operations. Logging agents, node exporters, security sensors, storage daemons, CNI plugin components, and local caching helpers all need node-level placement. The important question changes from "how many replicas do we want?" to "which nodes must have this Pod?"

![DaemonSet node coverage infographic showing a DaemonSet placing one log agent Pod on each eligible node and automatically adding an agent when a new app node appears](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-daemonsets/daemonset-node-coverage.png)

_This infographic shows the DaemonSet coverage loop: the desired count follows eligible nodes, not an application replica number._

## A Log Agent for Orders Nodes
<!-- section-summary: A DaemonSet manifest combines a normal Pod template with selector rules and node-local mounts. -->

The first orders example is a log agent. The team has an application namespace called `orders`, and a platform namespace called `observability`. The agent runs in `observability`, reads `/var/log/containers` from each eligible node, and adds labels that make orders logs searchable later.

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: devpolaris-log-agent
  namespace: observability
  labels:
    app.kubernetes.io/name: devpolaris-log-agent
    app.kubernetes.io/component: node-logging
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-log-agent
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
  template:
    metadata:
      labels:
        app.kubernetes.io/name: devpolaris-log-agent
        app.kubernetes.io/component: node-logging
    spec:
      serviceAccountName: devpolaris-log-agent
      nodeSelector:
        devpolaris.io/node-pool: app
      containers:
        - name: agent
          image: ghcr.io/devpolaris/log-agent:2026.06.14
          args:
            - "--cluster=prod-eu"
            - "--include-namespace=orders"
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              memory: 256Mi
          volumeMounts:
            - name: container-logs
              mountPath: /var/log/containers
              readOnly: true
      volumes:
        - name: container-logs
          hostPath:
            path: /var/log/containers
            type: Directory
```

The DaemonSet has two selectors to understand. The `spec.selector.matchLabels` value selects the Pods owned by this DaemonSet, and it must match the labels in `spec.template.metadata.labels`. The `nodeSelector` inside the Pod template selects nodes labeled `devpolaris.io/node-pool=app`, which keeps this agent on the application worker pool.

The `hostPath` volume is powerful because it lets the Pod read a directory from the node filesystem. This is normal for log agents, but it deserves security review. Run the agent with the smallest permissions it needs, keep it in a platform-owned namespace, pin resource requests and limits, review the image supply chain, and avoid mounting broad node paths when a narrower path works.

Apply and inspect the DaemonSet like this:

```bash
kubectl apply --dry-run=server -f devpolaris-log-agent-daemonset.yaml
kubectl apply -f devpolaris-log-agent-daemonset.yaml
kubectl get daemonset -n observability devpolaris-log-agent
kubectl get pods -n observability -l app.kubernetes.io/name=devpolaris-log-agent -o wide
```

The `-o wide` output matters because it shows the node for each Pod. A healthy DaemonSet should have one ready agent Pod on every eligible node. When the orders team loses logs from one node, this is the first place they look.

## Selectors, Labels, and Eligible Nodes
<!-- section-summary: Labels identify objects, selectors choose matching objects, and DaemonSets use both Pod selectors and node selection rules. -->

**Labels** are key-value pairs attached to Kubernetes objects. They let humans and controllers organize objects by meaningful attributes, such as app name, component, environment, or node pool. A **selector** is a rule that chooses objects with matching labels.

A DaemonSet uses labels in two places. The **Pod selector** tells the DaemonSet which Pods belong to it. The **node selection rules** tell the DaemonSet which nodes should receive Pods. Mixing up those two ideas causes many beginner bugs, so it helps to name them separately during review.

The Pod selector is required and stable. In the log agent example, the DaemonSet selector matches Pods with `app.kubernetes.io/name=devpolaris-log-agent`. Kubernetes rejects the manifest when the selector and Pod template labels differ, and the selector cannot be changed after creation because changing ownership rules can orphan existing Pods.

```yaml
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-log-agent
  template:
    metadata:
      labels:
        app.kubernetes.io/name: devpolaris-log-agent
```

Node selection works inside the Pod template. `nodeSelector` is the simplest option because it requires the node to have each listed label. The orders platform uses this to keep the logging DaemonSet on application workers, while other platform agents may run on every worker node.

```yaml
spec:
  template:
    spec:
      nodeSelector:
        devpolaris.io/node-pool: app
```

Node affinity gives more expressive rules. For example, the team may want the log agent on Linux application nodes in two production zones. The required affinity below says a node must match both the node pool label and the operating system label. The zone expression accepts either listed zone.

```yaml
spec:
  template:
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: devpolaris.io/node-pool
                    operator: In
                    values: ["app"]
                  - key: kubernetes.io/os
                    operator: In
                    values: ["linux"]
                  - key: topology.kubernetes.io/zone
                    operator: In
                    values: ["eu-west-1a", "eu-west-1b"]
```

The phrase `IgnoredDuringExecution` has an operational meaning. If a node label changes after a Pod is already running, that running Pod can continue until the controller replaces it or another change occurs. During a label migration, operators should check both current node labels and existing DaemonSet Pods so the coverage picture stays clear.

## Taints, Tolerations, and Dedicated Nodes
<!-- section-summary: Taints repel Pods from nodes, and tolerations let trusted DaemonSet Pods run on those nodes when that is intentional. -->

**Taints** are labels with an effect that repel Pods from a node. A node can say, in effect, "Pods without a matching toleration should stay away." **Tolerations** are Pod settings that say the Pod accepts a matching taint. This is how clusters reserve nodes for special workloads or protect control-plane nodes from normal application Pods.

For the orders platform, the application nodes may carry a taint like this:

```bash
kubectl taint nodes worker-a devpolaris.io/dedicated=orders:NoSchedule
```

That taint means ordinary Pods cannot schedule on `worker-a` unless they have a matching toleration. If `devpolaris-orders-api` runs on those nodes, the API Deployment already needs the toleration. The log agent needs it too, because the agent must run wherever the API can run.

```yaml
spec:
  template:
    spec:
      tolerations:
        - key: "devpolaris.io/dedicated"
          operator: "Equal"
          value: "orders"
          effect: "NoSchedule"
```

DaemonSet Pods receive several built-in tolerations for node conditions such as not-ready, unreachable, pressure, and unschedulable states. That behavior lets important node-level agents start early and remain present during some node transitions. You can still add your own tolerations for dedicated pools, GPU nodes, control-plane nodes, or platform-owned infrastructure nodes.

This is an area where production teams move carefully. A toleration lets a Pod pass a taint, and node selection chooses the target pool. Pair tolerations with `nodeSelector` or node affinity when the DaemonSet should cover a specific pool. That combination says both "these nodes are allowed" and "these are the nodes I want."

![DaemonSet eligibility filters infographic showing app, gpu, and control nodes passing or skipping nodeSelector and toleration filters before an agent Pod is placed](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-daemonsets/daemonset-eligibility-filters.png)

_This infographic separates the two placement questions: node selection chooses the target pool, and tolerations let trusted DaemonSet Pods pass intentional taints._

## Inspecting DaemonSet Coverage
<!-- section-summary: Coverage checks compare desired, ready, and actual Pods against the node list that should be eligible. -->

The core DaemonSet health question is coverage. If four nodes are eligible, the DaemonSet should usually want four Pods, have four current Pods, and show four ready Pods. The `kubectl get daemonset` output gives that first summary.

```bash
kubectl get daemonset -n observability devpolaris-log-agent
```

Typical output looks like this:

```bash
NAME                   DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR                    AGE
devpolaris-log-agent   4         4         4       4            4           devpolaris.io/node-pool=app      18m
```

`DESIRED` means how many eligible nodes the DaemonSet wants to cover. `CURRENT` means how many DaemonSet Pods currently exist. `READY` means how many are ready. `UP-TO-DATE` shows how many match the latest Pod template during a rollout, and `AVAILABLE` shows how many satisfy availability rules.

The next command compares Pods to nodes. This catches the exact node missing an agent, and it also shows placement during rollouts.

```bash
kubectl get pods -n observability -l app.kubernetes.io/name=devpolaris-log-agent -o wide
kubectl get nodes -l devpolaris.io/node-pool=app -o wide
```

For deeper inspection, describe the DaemonSet and one affected Pod. The DaemonSet events show controller-level problems. The Pod events show scheduling, image pull, volume mount, and container restart problems.

```bash
kubectl describe daemonset -n observability devpolaris-log-agent
kubectl describe pod -n observability devpolaris-log-agent-x7q9m
kubectl logs -n observability devpolaris-log-agent-x7q9m --all-containers=true --tail=200
```

Coverage should also connect to the application problem. If `devpolaris-orders-api` has no logs for `worker-c`, check whether the API Pod and the log agent Pod are both on that node. Then check the agent logs for file read errors, permission errors, and forwarding errors to the logging backend.

## Rolling Updates and Rollbacks
<!-- section-summary: DaemonSet updates replace node agents across the cluster, so rollout speed and rollback commands belong in the runbook. -->

A DaemonSet rollout updates node-local software across the cluster. That can be more sensitive than an application rollout because the agent may support logs, metrics, security telemetry, storage, or networking. A bad update can affect visibility or node behavior across many workloads at the same time.

The default update approach is **RollingUpdate**. The controller replaces DaemonSet Pods gradually according to the update strategy. In the log agent manifest, `maxUnavailable: 1` means the rollout should take down at most one unavailable agent at a time, which keeps most nodes covered while the new version rolls out.

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
```

For the orders log agent, the safest rollout path starts in staging. Apply the updated manifest, create test orders, confirm logs arrive with the new agent version, and then promote the same manifest to production. In production, watch both Kubernetes rollout status and the logging dashboard because Kubernetes can show the Pods are ready while the downstream log pipeline still has a formatting or authentication issue.

```bash
kubectl apply -f devpolaris-log-agent-daemonset.yaml
kubectl rollout status daemonset/devpolaris-log-agent -n observability
kubectl get pods -n observability -l app.kubernetes.io/name=devpolaris-log-agent -o wide
```

When the only change is the image tag, an operator can use `kubectl set image`, though a version-controlled manifest remains the cleaner long-term source of truth.

```bash
kubectl set image daemonset/devpolaris-log-agent -n observability agent=ghcr.io/devpolaris/log-agent:2026.06.21
kubectl rollout status daemonset/devpolaris-log-agent -n observability
```

Rollback uses the same rollout tooling as other controller-managed workloads. Check the history, choose the known good revision, and watch the rollback complete. After rollback, verify application logs from several nodes, including the node that first showed the issue.

```bash
kubectl rollout history daemonset/devpolaris-log-agent -n observability
kubectl rollout undo daemonset/devpolaris-log-agent -n observability --to-revision=3
kubectl rollout status daemonset/devpolaris-log-agent -n observability
```

DaemonSet rollbacks create a new revision as they move forward to the old template. That means the revision number sequence keeps increasing, which can surprise people during incident review. The important record is the template content, image tag, and change cause, rather than the older revision number itself.

## Debugging Missing Pods and Stuck Updates
<!-- section-summary: Missing Pods usually come from eligibility, taints, resources, image pulls, or a broken new template. -->

When a node has no DaemonSet Pod, start with eligibility. A DaemonSet creates Pods for eligible nodes, so the first question is whether the node matches the node selector or affinity. Check the node labels and compare them to the DaemonSet template.

```bash
kubectl get node worker-c --show-labels
kubectl get daemonset -n observability devpolaris-log-agent -o yaml
```

If the labels match, check taints. A dedicated node may repel the agent because the Pod template lacks a matching toleration. The node description shows taints, and the DaemonSet YAML shows tolerations.

```bash
kubectl describe node worker-c | grep -A3 Taints
kubectl get daemonset -n observability devpolaris-log-agent -o jsonpath='{.spec.template.spec.tolerations}'
```

If eligibility and tolerations look correct, check scheduling and resource pressure. A DaemonSet Pod still needs CPU, memory, image pull access, volume mounts, and a working kubelet. Pod events usually point to the exact blocker.

```bash
kubectl get pods -n observability -l app.kubernetes.io/name=devpolaris-log-agent -o wide
kubectl describe daemonset -n observability devpolaris-log-agent
kubectl get events -n observability --sort-by=.lastTimestamp
kubectl describe node worker-c
```

For a stuck rollout, compare old and new Pods. `UP-TO-DATE` below the desired count usually means the rollout cannot replace some Pods yet. Common causes include the new image failing to pull, the new container crashing, resource requests that no longer fit on a node, a broken hostPath mount, or a readiness condition that never passes.

```bash
kubectl rollout status daemonset/devpolaris-log-agent -n observability
kubectl get daemonset -n observability devpolaris-log-agent
kubectl get pods -n observability -l app.kubernetes.io/name=devpolaris-log-agent -o wide
kubectl logs -n observability -l app.kubernetes.io/name=devpolaris-log-agent --all-containers=true --tail=100
```

When the new agent image crashes, rollback quickly if logs or metrics are production-critical. When the rollout is stuck because one node lacks resources, decide whether to reduce the agent request, drain unrelated workload from that node, or let the cluster autoscaler add capacity. Avoid deleting random Pods during an incident without checking ownership, disruption budgets, and customer impact.

## Production Runbooks
<!-- section-summary: DaemonSet runbooks should connect Kubernetes coverage, node state, rollout state, and the downstream system the agent supports. -->

A good DaemonSet runbook starts with the business symptom. "Orders logs missing from one node" is different from "all log agents crash after rollout" and different from "the networking agent is absent from a new node." The commands overlap, but the risk and rollback decision are different.

For **missing logs from one orders node**, identify the node that hosted the affected API Pod. Then check whether the log agent Pod exists and is ready on the same node. If the agent exists, read its logs and check the downstream logging system. If the agent is absent, walk through labels, taints, tolerations, and node events.

```bash
kubectl get pod -n orders -l app.kubernetes.io/name=devpolaris-orders-api -o wide
kubectl get pod -n observability -l app.kubernetes.io/name=devpolaris-log-agent -o wide
kubectl describe node worker-c
```

For **a new node with no agent**, check the node labels applied by the node pool or cluster autoscaler. New nodes often miss custom labels when an infrastructure template changes. Fix the node pool configuration first, then label the current node only if you need an immediate repair.

```bash
kubectl label node worker-f devpolaris.io/node-pool=app
kubectl get pod -n observability -l app.kubernetes.io/name=devpolaris-log-agent -o wide
```

For **a DaemonSet rollout that breaks telemetry**, rollback to the known good revision and keep the failed Pod logs. The failed Pods tell the team whether the issue was configuration, image startup, permissions, or downstream authentication. After rollback, verify the logging dashboard for at least one node per zone.

```bash
kubectl rollout history daemonset/devpolaris-log-agent -n observability
kubectl rollout undo daemonset/devpolaris-log-agent -n observability
kubectl rollout status daemonset/devpolaris-log-agent -n observability
```

For **a risky agent change**, reduce blast radius before production. Test in staging, use a low `maxUnavailable`, and monitor the downstream system during the rollout. For security sensors, network agents, and storage helpers, involve the platform owner because those agents can affect every workload on a node.

For **planned node maintenance**, remember that DaemonSet Pods may run on cordoned or unschedulable nodes because DaemonSets get special tolerations. Draining a node has rules around DaemonSet-managed Pods, so maintenance runbooks should focus on moving normal application Pods away, handling the node, and confirming the DaemonSet agent returns when the node rejoins service.

## Choosing DaemonSet or Another Workload
<!-- section-summary: Use DaemonSets for node-level helpers, Deployments for replicated services, and Jobs or CronJobs for finite work. -->

The orders platform now has several workload shapes. The API server uses a Deployment because it should serve traffic continuously. The schema migration uses a Job because it should finish once. The checkout cleanup uses a CronJob because it should create Jobs on a schedule. The log agent uses a DaemonSet because node coverage is the point.

Use a DaemonSet when the node itself is part of the job. Logs, metrics, security agents, storage helpers, and network components often need one Pod on each eligible node. Use a Deployment when you care about an application replica count. Use a Job or CronJob when the process should finish.

| Workload | Placement rule | Orders platform example |
|---|---|---|
| Deployment | Run a desired number of service replicas | `devpolaris-orders-api` |
| Job | Run finite work to completion | Orders schema migration |
| CronJob | Create finite work from a schedule | Nightly checkout cleanup |
| DaemonSet | Run one Pod on each eligible node | Orders log agent on app nodes |

The production skill is knowing what to inspect. For DaemonSets, inspect nodes and Pods together. Check labels, selectors, taints, tolerations, resource pressure, rollout revisions, and the downstream system the agent supports. A ready DaemonSet Pod is a good sign, and the real success check is whether the node-local job is actually happening.

![DaemonSet debug runbook infographic showing symptom, coverage, node state, agent logs, downstream logs, and rollback as the troubleshooting path](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-daemonsets/daemonset-debug-runbook.png)

_This infographic summarizes the DaemonSet runbook: start from the missing node-local symptom, prove coverage, inspect node state and agent logs, then verify the downstream system._

---

**References**

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
