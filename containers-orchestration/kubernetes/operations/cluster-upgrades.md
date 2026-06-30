---
title: "Cluster Upgrades"
description: "Plan and execute Kubernetes cluster upgrades with compatibility checks, workload drain behavior, and rollback-aware validation."
overview: "Cluster upgrades change the platform under every workload. Preparing devpolaris-orders-api for upgrades means checking APIs, node drain behavior, controllers, and post-upgrade evidence."
tags: ["upgrades", "nodes", "drain", "compatibility"]
order: 7
id: article-containers-orchestration-cluster-operations-cluster-upgrades
aliases:
  - containers-orchestration/cluster-operations/cluster-upgrades.md
---
## Table of Contents

1. [Why Cluster Upgrades Need a Runbook](#why-cluster-upgrades-need-a-runbook)
2. [Build the Upgrade Inventory](#build-the-upgrade-inventory)
3. [Check API Versions Early](#check-api-versions-early)
4. [Prove Add-ons and Clients Are Compatible](#prove-add-ons-and-clients-are-compatible)
5. [Make devpolaris-orders-api Drain-Ready](#make-devpolaris-orders-api-drain-ready)
6. [Rehearse the Node Roll in Staging](#rehearse-the-node-roll-in-staging)
7. [Upgrade in Phases](#upgrade-in-phases)
8. [Validate With Application Evidence](#validate-with-application-evidence)
9. [Handle Failed Drains and Bad Signals](#handle-failed-drains-and-bad-signals)
10. [Upgrade Runbook Checklist](#upgrade-runbook-checklist)
11. [References](#references)

## Why Cluster Upgrades Need a Runbook
<!-- section-summary: A cluster upgrade changes API compatibility, control-plane behavior, node runtime behavior, and workload placement, so operators need a staged runbook. -->

A Kubernetes **cluster upgrade** changes the platform underneath every workload. The control plane, nodes, add-ons, API versions, clients, and drain behavior can all affect production apps during the same maintenance window.

For `devpolaris-orders-api`, a good upgrade runbook answers four questions early: which version are we moving from and to, which APIs and add-ons might break, how will Pods move during node drains, and what evidence proves the app still works after each phase?

The workflow is inventory, compatibility, drain readiness, phased rollout, validation, and rollback notes.

![Upgrade inventory board showing control plane, node pools, add-ons, kubectl clients, deprecated APIs, and rollback notes before a Kubernetes upgrade](/content-assets/articles/article-containers-orchestration-cluster-operations-cluster-upgrades/upgrade-inventory-board.png)

*The inventory board keeps the upgrade tied to versioned facts rather than assumptions.*

## Build the Upgrade Inventory
<!-- section-summary: The inventory names the current version, target version, node pools, add-ons, clients, and workloads that need special handling. -->

Start by writing down the current cluster version, target version, node pools, managed add-ons, critical controllers, and client versions used by automation.

```bash
$ kubectl version --short
Client Version: v1.30.2
Server Version: v1.29.8

$ kubectl get nodes
NAME          STATUS   ROLES    VERSION
worker-a      Ready    <none>   v1.29.8
worker-b      Ready    <none>   v1.29.8
worker-c      Ready    <none>   v1.29.8
```

What this output records:

- The API server is currently `v1.29.8`.
- All visible nodes run the same kubelet version.
- The client version is close enough for normal admin work.

Add workload inventory:

```bash
$ kubectl -n orders get deploy,hpa,pdb
NAME                                      READY   UP-TO-DATE   AVAILABLE
deployment.apps/devpolaris-orders-api     3/3     3            3

NAME                                                 MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS
poddisruptionbudget.policy/devpolaris-orders-api     2               N/A               1
```

The PDB line says one voluntary disruption is allowed while keeping two Pods available.

## Check API Versions Early
<!-- section-summary: Deprecated or removed API versions should be fixed before the cluster version changes. -->

Kubernetes removes old API versions over time. An upgrade window is a poor time to discover that a manifest or controller still submits removed APIs.

The safest evidence comes from live objects and release manifests:

```bash
$ kubectl api-resources --deprecated=true
NAME                              SHORTNAMES   APIVERSION
flowschemas                                    flowcontrol.apiserver.k8s.io/v1beta3
prioritylevelconfigurations                    flowcontrol.apiserver.k8s.io/v1beta3
```

What this output means:

- Deprecated APIs still exist in the cluster.
- The team should check whether any owned manifests or controllers use them.
- The target Kubernetes release notes decide whether these APIs are warnings or blockers.

For application manifests, scan YAML in source control too:

```bash
$ rg "apiVersion: .*v1beta|apiVersion: .*v1alpha" deploy/
deploy/old-policy.yaml:apiVersion: policy/v1beta1
```

This result points to a file that should be migrated before the upgrade.

## Prove Add-ons and Clients Are Compatible
<!-- section-summary: Add-ons such as ingress, metrics, CNI, CSI, and policy controllers must support the target Kubernetes version. -->

Cluster add-ons often touch core APIs. Check ingress controllers, CNI, CSI, Metrics Server, cert-manager, admission policy engines, and service mesh components before touching the control plane.

```bash
$ kubectl -n kube-system get deploy
NAME             READY   UP-TO-DATE   AVAILABLE
coredns          2/2     2            2
metrics-server   1/1     1            1

$ kubectl -n ingress-nginx get deploy
NAME                       READY   UP-TO-DATE   AVAILABLE
ingress-nginx-controller   2/2     2            2
```

What this output gives you:

- Add-ons are currently healthy.
- Each add-on needs a target-version support check from its own release notes.
- Record the add-on version beside the Kubernetes target version.

Also check automation clients:

```bash
$ kubectl -n orders auth can-i patch deployments --as=system:serviceaccount:orders:orders-release
yes
```

The release identity still has the permission needed to restart or roll back the app during the window.

## Make devpolaris-orders-api Drain-Ready
<!-- section-summary: Drain readiness means the app can lose a Pod voluntarily while readiness, PDBs, and replica counts protect traffic. -->

Node upgrades move Pods. The orders API should handle voluntary disruption through multiple replicas, readiness probes, and a PodDisruptionBudget.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: devpolaris-orders-api
  namespace: orders
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: devpolaris-orders-api
```

What this PDB means:

- During voluntary disruptions, at least two matching Pods should stay available.
- Drains may pause if only two ready Pods remain.
- The selector must match the Deployment Pod labels.

Check readiness before a drain:

```bash
$ kubectl -n orders get pods -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                      READY   STATUS    RESTARTS
devpolaris-orders-api-6d4f9b7d6f-b7m2p    1/1     Running   0
devpolaris-orders-api-6d4f9b7d6f-k9v5r    1/1     Running   0
devpolaris-orders-api-6d4f9b7d6f-q2lm8    1/1     Running   0
```

All Pods are ready, so the workload can tolerate one voluntary disruption under this PDB.

## Rehearse the Node Roll in Staging
<!-- section-summary: A staging rehearsal proves drain behavior, PDB behavior, rollout evidence, and monitoring before production. -->

Rehearse a node drain in staging with the same Deployment shape and PDB. The point is to observe scheduling and user-facing signals before the production window.

```bash
$ kubectl drain worker-a --ignore-daemonsets --delete-emptydir-data --dry-run=server
node/worker-a cordoned (server dry run)
node/worker-a drained (server dry run)
```

What this dry run tells you:

- Kubernetes accepted the drain request shape.
- It did not mutate the live node because this was a server dry run.
- A real staging drain should still be observed with metrics and rollout checks.

![Phased node roll infographic showing staging rehearsal, control plane upgrade, cordon, drain, validate, and next batch during Kubernetes node upgrades](/content-assets/articles/article-containers-orchestration-cluster-operations-cluster-upgrades/phased-node-roll.png)

*The phased node roll keeps validation between batches instead of treating the upgrade as one large action.*

## Upgrade in Phases
<!-- section-summary: Upgrade control plane, add-ons, and node pools in small phases with validation after each phase. -->

The exact commands depend on your Kubernetes provider, but the operating shape stays consistent:

| Phase | Evidence before moving on |
|---|---|
| Control plane | API server healthy, controllers reconciling, webhooks reachable |
| Core add-ons | DNS, ingress, metrics, CNI, CSI, and policy controllers healthy |
| First node batch | Drains succeed, Pods reschedule, PDBs behave |
| Remaining node batches | App evidence stays inside SLOs |

After each node batch:

```bash
$ kubectl get nodes
NAME          STATUS   ROLES    VERSION
worker-a      Ready    <none>   v1.30.2
worker-b      Ready    <none>   v1.29.8
worker-c      Ready    <none>   v1.29.8

$ kubectl -n orders rollout status deployment/devpolaris-orders-api
deployment "devpolaris-orders-api" successfully rolled out
```

The output proves one node moved to the target version and the orders Deployment is available after rescheduling.

## Validate With Application Evidence
<!-- section-summary: Post-upgrade validation should prove both Kubernetes health and application behavior. -->

Cluster health alone is not enough. Validate the user path that matters for the app.

```bash
$ kubectl -n orders get deploy,hpa,pdb
NAME                                      READY   UP-TO-DATE   AVAILABLE
deployment.apps/devpolaris-orders-api     3/3     3            3

NAME                                    REFERENCE                          TARGETS   REPLICAS
horizontalpodautoscaler.autoscaling/devpolaris-orders-api   Deployment/devpolaris-orders-api   54%/70%   3
```

What this proves:

- The Deployment is fully available.
- HPA can still read metrics.
- PDB still exists for later node operations.

Pair Kubernetes checks with app checks:

```bash
$ curl -sS https://orders.devpolaris.example/healthz
{"status":"ok","version":"2026.06.30"}
```

The application response proves the public request path still works after the platform change.

## Handle Failed Drains and Bad Signals
<!-- section-summary: Failed drains and bad post-upgrade signals should pause the rollout while operators preserve evidence and choose the smallest safe mitigation. -->

A failed drain often points to PDB limits, stuck terminating Pods, local storage, or controllers that cannot replace Pods. The error message gives the next safe action, so forced drains should stay behind evidence and approval.

```bash
$ kubectl drain worker-b --ignore-daemonsets --delete-emptydir-data
error: cannot evict pod "devpolaris-orders-api-6d4f9b7d6f-k9v5r": Cannot evict pod as it would violate the pod's disruption budget.
```

What this error means:

- Kubernetes is protecting availability through the PDB.
- The next step is to check ready replicas and current disruptions.
- Forcing deletion would bypass the availability guardrail.

If post-upgrade signals look bad, pause the next batch and collect evidence:

```bash
$ kubectl -n orders get events --sort-by=.lastTimestamp
LAST SEEN   TYPE      REASON      OBJECT                                      MESSAGE
2m          Warning   Unhealthy   pod/devpolaris-orders-api-6d4f9b7d6f-q2lm8   Readiness probe failed: HTTP probe failed with statuscode: 503
```

The event gives a specific failure family: readiness. The next check should inspect readiness behavior and application health.

## Upgrade Runbook Checklist
<!-- section-summary: The runbook should prove inventory, compatibility, drain safety, phased rollout, application health, and rollback notes. -->

Use this checklist before the production window:

| Check | Expected result |
|---|---|
| Version inventory | Current and target Kubernetes versions are recorded |
| API compatibility | Deprecated or removed APIs are remediated |
| Add-ons | DNS, ingress, metrics, CNI, CSI, policy, and mesh components support the target |
| Clients | CI/CD and operator clients support the target version |
| Drain readiness | Replicas, readiness probes, and PDBs protect traffic |
| Staging rehearsal | Drain and validation were tested before production |
| Phases | Control plane, add-ons, and node batches have separate checks |
| App evidence | Health, latency, errors, HPA, and events are reviewed after each phase |
| Rollback notes | Provider rollback limits and app rollback commands are documented |

![Cluster upgrade runbook checklist with inventory first, API checks, add-on proof, drain-ready apps, phased rollout, and evidence bundle](/content-assets/articles/article-containers-orchestration-cluster-operations-cluster-upgrades/cluster-upgrade-runbook.png)

*The runbook checklist keeps the upgrade evidence-first: inventory, compatibility, drain safety, phase checks, and application validation.*

## References

- [Kubernetes Version Skew Policy](https://kubernetes.io/releases/version-skew-policy/) - Official policy for supported skew between control plane, kubelets, kube-proxy, and kubectl.
- [Kubernetes Deprecation Policy](https://kubernetes.io/docs/reference/using-api/deprecation-policy/) - Explains API deprecation, removal, and compatibility guarantees.
- [Kubernetes Deprecated API Migration Guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/) - Lists removed and deprecated APIs by Kubernetes version.
- [Kubernetes Safely Drain a Node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/) - Official guide for cordon, drain, eviction, and maintenance operations.
- [Kubernetes Pod Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/) - Explains voluntary disruptions and PodDisruptionBudgets.
- [Kubernetes Configure Pod Disruption Budget](https://kubernetes.io/docs/tasks/run-application/configure-pdb/) - Practical PDB examples for application availability.
