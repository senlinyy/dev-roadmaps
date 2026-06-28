---
title: "Cluster Upgrades"
description: "Plan and execute Kubernetes cluster upgrades with compatibility checks, workload drain behavior, and rollback-aware validation."
overview: "Cluster upgrades change the platform under every workload. You will learn how to prepare devpolaris-orders-api for upgrades by checking APIs, node drain behavior, controllers, and post-upgrade evidence."
tags: ["upgrades", "nodes", "drain", "compatibility"]
order: 7
id: article-containers-orchestration-cluster-operations-cluster-upgrades
aliases:
  - containers-orchestration/cluster-operations/cluster-upgrades.md
---

## Table of Contents

1. [Why Cluster Upgrades Need a Runbook](#why-cluster-upgrades-need-a-runbook)
2. [Build the Upgrade Inventory](#build-the-upgrade-inventory)
3. [Check API Versions Before the Window](#check-api-versions-before-the-window)
4. [Prove Add-ons and Clients Are Compatible](#prove-add-ons-and-clients-are-compatible)
5. [Make devpolaris-orders-api Drain-Ready](#make-devpolaris-orders-api-drain-ready)
6. [Rehearse the Node Roll in Staging](#rehearse-the-node-roll-in-staging)
7. [Upgrade in Phases](#upgrade-in-phases)
8. [Validate With Application Evidence](#validate-with-application-evidence)
9. [Handle Failed Drains and Bad Signals](#handle-failed-drains-and-bad-signals)
10. [Upgrade Runbook Checklist](#upgrade-runbook-checklist)
11. [What's Next](#whats-next)

## Why Cluster Upgrades Need a Runbook
<!-- section-summary: A cluster upgrade changes the shared platform, so the team needs planned evidence before, during, and after the maintenance window. -->

The shared Kubernetes version changes, but the app still has to serve users. That is the beginner-friendly way to think about a cluster upgrade. The platform may move the production cluster from Kubernetes `v1.29` to `v1.30`, while customers still expect checkout to work before, during, and after the maintenance window.

A **cluster upgrade** changes Kubernetes itself: the API server that accepts manifests, the controllers that reconcile objects, the scheduler that chooses nodes, and the kubelets that run Pods. In a managed cluster, the cloud provider may run many of those steps for you, yet your workloads still live through the change. The platform team needs to prove that important services still work after the version moves.

We will use one production scenario across this article. The service is `devpolaris-orders-api`, it runs in the `orders` namespace, and it serves checkout traffic. The first check is simple: can the app still receive requests and keep enough healthy Pods while the platform changes underneath it?

The runbook builds from that simple check. First, prove the current app path. Then check whether the API server accepts the manifests the app uses. Then check how Pods behave as nodes restart or drain. After that, check the shared cluster helpers such as DNS, ingress, storage, and metrics. The order keeps the maintenance window from turning into random command execution.

![Upgrade inventory board showing control plane, node pools, add-ons, kubectl clients, deprecated APIs, and rollback notes before a Kubernetes upgrade](/content-assets/articles/article-containers-orchestration-cluster-operations-cluster-upgrades/upgrade-inventory-board.png)

*The inventory board shows why a cluster upgrade starts with facts, not motion. The team needs platform versions, add-on support, client compatibility, API risks, and rollback notes before the window opens.*

The important idea is **evidence before motion**. Before the upgrade, gather facts about the current cluster. During the upgrade, validate after each phase. After the upgrade, prove the application path as well as the Kubernetes version number.

## Build the Upgrade Inventory
<!-- section-summary: The upgrade inventory names the exact platform pieces that might change, from API server version to add-ons and workload clients. -->

An **upgrade inventory** is a short record of the cluster versions, node versions, critical add-ons, and clients that matter for the upgrade. This sounds basic, but it prevents a common production mistake: treating "Kubernetes v1.x to v1.y" as one change. Real clusters also include networking, DNS, storage, ingress, metrics, autoscaling, and deployment tooling.

Start with the control plane and node versions. Use the command output as the starting point for the runbook, then compare it with your provider release notes and the Kubernetes version skew policy.

```bash
$ kubectl version
Client Version: v1.30.4
Server Version: v1.29.8

$ kubectl get nodes -o wide
NAME       STATUS   ROLES    AGE    VERSION   OS-IMAGE
worker-1   Ready    <none>   142d   v1.29.8   Ubuntu 22.04.4 LTS
worker-2   Ready    <none>   142d   v1.29.8   Ubuntu 22.04.4 LTS
worker-3   Ready    <none>   142d   v1.29.8   Ubuntu 22.04.4 LTS
```

The `Client Version` is the `kubectl` version on your machine or CI runner. The `Server Version` is the Kubernetes API server. Kubernetes documents supported version skew between components, so keep the deployment runner, local runbooks, and automation images inside the supported range for the target cluster.

Next, list the add-ons that your service depends on. `devpolaris-orders-api` might look like an application-only workload, but it relies on CoreDNS for service discovery, the CNI plugin for Pod networking, the ingress controller for external traffic, the CSI driver for mounted secrets or volumes, and Metrics Server for autoscaling signals.

```bash
$ kubectl -n kube-system get deploy,daemonset
NAME                          READY   UP-TO-DATE   AVAILABLE
deployment.apps/coredns        2/2     2            2
deployment.apps/metrics-server 1/1     1            1

NAME                                      DESIRED   CURRENT   READY
daemonset.apps/cilium                     3         3         3
daemonset.apps/secrets-store-csi-driver   3         3         3
```

Record the current version and target version for each add-on if your cluster exposes that through Helm, your GitOps repo, or provider metadata. An API server upgrade can finish successfully while an old ingress controller or CSI driver still fails against the new environment. The inventory gives you a place to catch that before production users hit it.

## Check API Versions Before the Window
<!-- section-summary: API compatibility checks make sure Kubernetes still accepts the manifests and live objects that the orders service depends on. -->

**API compatibility** means the target Kubernetes API server still accepts the resource versions your manifests use. Kubernetes removes deprecated API versions over time, and those removals matter during upgrades. A manifest using an old API version can fail to apply even when the container image, YAML fields, and application code are otherwise fine.

For `devpolaris-orders-api`, inspect the live objects first. This gives you a quick view of the API versions already stored in the cluster.

```bash
$ kubectl -n orders get deploy,svc,ingress,pdb -o custom-columns=KIND:.kind,NAME:.metadata.name,API:.apiVersion
KIND                         NAME                    API
Deployment                   devpolaris-orders-api   apps/v1
Service                      devpolaris-orders-api   v1
Ingress                      devpolaris-orders-api   networking.k8s.io/v1
PodDisruptionBudget          devpolaris-orders-api   policy/v1
```

Those API versions are current shapes for the common workload objects in this example. If the scan finds something like an old beta Ingress API, fix the manifest and roll that fix through normal deployment before the cluster upgrade. Mixing a manifest migration with the production upgrade window gives the team two changes to debug at once.

Then test the manifests against a staging cluster that already runs the target version. A **server-side dry run** asks the API server to validate the object without storing it, so it catches removed APIs, schema mistakes, and some admission policy problems.

```bash
$ kubectl apply --server-side --dry-run=server -f k8s/orders/
deployment.apps/devpolaris-orders-api serverside-applied (server dry run)
service/devpolaris-orders-api serverside-applied (server dry run)
ingress.networking.k8s.io/devpolaris-orders-api serverside-applied (server dry run)
poddisruptionbudget.policy/devpolaris-orders-api serverside-applied (server dry run)
```

The dry run proves only that the API server accepts the object shape. Ingress routing, image startup, and database dependency health still need runtime checks. Keep it as the first gate, then continue into runtime validation.

## Prove Add-ons and Clients Are Compatible
<!-- section-summary: Add-on compatibility checks protect the pieces that application teams usually notice first: DNS, networking, storage, ingress, and metrics. -->

Cluster add-ons are the shared systems that make application Pods useful. **CoreDNS** resolves service names. A **CNI plugin** connects Pods to the network. A **CSI driver** mounts storage or secrets. An **ingress controller** receives external traffic. **Metrics Server** feeds `kubectl top` and many HorizontalPodAutoscaler setups.

The platform team should check add-on support before the production window, then verify add-on health during the rollout. The exact commands depend on the provider and add-on stack, but the runbook should include a small table like this.

| Add-on | Why it matters for `devpolaris-orders-api` | Practical check |
|--------|--------------------------------------------|-----------------|
| CoreDNS | Service names such as `postgres.orders.svc` must resolve | Run DNS lookup from a test Pod |
| CNI plugin | Pods need Service and Pod-to-Pod networking | Curl the orders Service from inside the cluster |
| CSI driver | Mounted secrets or volumes must attach | Restart a Pod that uses the driver in staging |
| Ingress controller | Checkout traffic reaches the Service | Curl the external health URL |
| Metrics Server | HPA and operations dashboards need Pod metrics | Run `kubectl top pods` and check HPA conditions |

Use Kubernetes commands for the simple health checks and provider or Helm commands for version checks. The point is to collect proof from the layer that owns the behavior.

```bash
$ kubectl -n kube-system rollout status deployment/coredns
deployment "coredns" successfully rolled out

$ kubectl -n kube-system rollout status deployment/metrics-server
deployment "metrics-server" successfully rolled out

$ kubectl -n ingress-nginx rollout status deployment/ingress-nginx-controller
deployment "ingress-nginx-controller" successfully rolled out
```

Client compatibility belongs in the same checklist. The deployment pipeline, GitOps controller, policy engine, backup job, and on-call runbook all talk to the Kubernetes API. If an old controller sends objects the new API server rejects, the application team may see a failed release even though the cluster itself is healthy.

## Make devpolaris-orders-api Drain-Ready
<!-- section-summary: Drain readiness proves the service can lose one node at a time while enough replicas stay available for users. -->

A **node drain** is the planned process of moving Pods away from a node before maintenance. Kubernetes first cordons the node so new Pods do not land there, then evicts eligible Pods so controllers can create replacements elsewhere. Node upgrades depend on this behavior because most providers replace or restart worker nodes during the node-pool phase.

For the orders service, replicas are the first practical check. One replica gives you no room for voluntary disruption. Three replicas give the scheduler a chance to keep traffic flowing while one Pod moves, as long as the cluster has spare capacity and the Pods can run on more than one node.

```bash
$ kubectl -n orders get deploy devpolaris-orders-api
NAME                    READY   UP-TO-DATE   AVAILABLE
devpolaris-orders-api   3/3     3            3
```

Add a **PodDisruptionBudget**, usually called a PDB, so Kubernetes knows how much voluntary disruption the service can tolerate. This PDB says at least two orders API Pods should stay available during planned disruptions.

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

The PDB protects availability during drain, but it also blocks unsafe maintenance when the service has no spare room. That is useful pressure. If the PDB reports zero allowed disruptions, increase replicas, add node capacity, fix readiness, or adjust the rollout plan before touching production nodes.

```bash
$ kubectl -n orders get pdb devpolaris-orders-api
NAME                    MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS
devpolaris-orders-api   2               N/A               1
```

Drain readiness also needs **readiness probes**, realistic resource requests, and scheduling spread. The readiness probe keeps an unready Pod out of Service endpoints. Resource requests let the scheduler find real capacity. Topology spread or pod anti-affinity helps avoid placing all replicas on one node.

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
          image: ghcr.io/devpolaris/orders-api@sha256:8f4b9c7a9d1f6e24d5b6b0c2e9f77b0c4f37d8443c188a6eac1d2d5c07e42a91
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
          resources:
            requests:
              cpu: 250m
              memory: 384Mi
            limits:
              cpu: 1000m
              memory: 768Mi
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: devpolaris-orders-api
```

This is the part of upgrade preparation that application teams directly control. A managed provider can restart nodes carefully, but it cannot invent readiness probes or capacity for a workload that was never prepared to move.

## Rehearse the Node Roll in Staging
<!-- section-summary: A staging drain rehearsal shows whether PDBs, scheduling, capacity, and readiness behave before the production node pool rolls. -->

A **node roll** is the gradual replacement or restart of worker nodes. Rehearsing it in staging turns the upgrade from a theory into a small proof. You want to know whether one orders API Pod can leave a node, start on another node, pass readiness, and rejoin the Service endpoint list.

Start with a dry-run drain if your Kubernetes version and provider support it. Then run a real staging drain during a controlled test window.

```bash
$ kubectl drain worker-2 --ignore-daemonsets --delete-emptydir-data --dry-run=server
node/worker-2 cordoned (server dry run)
pod/devpolaris-orders-api-7c96df7d7c-dh8xq evicted (server dry run)

$ kubectl drain worker-2 --ignore-daemonsets --delete-emptydir-data
node/worker-2 cordoned
evicting pod orders/devpolaris-orders-api-7c96df7d7c-dh8xq
pod/devpolaris-orders-api-7c96df7d7c-dh8xq evicted
node/worker-2 drained
```

After the drain, check that the Deployment returns to its desired availability and that replacement Pods land on other nodes. The `-o wide` output matters here because it shows where each replica actually runs.

```bash
$ kubectl -n orders get pods -o wide -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                      READY   STATUS    NODE
devpolaris-orders-api-7c96df7d7c-2vd6k   1/1     Running   worker-1
devpolaris-orders-api-7c96df7d7c-q94r7   1/1     Running   worker-3
devpolaris-orders-api-7c96df7d7c-x6s8m   1/1     Running   worker-4
```

Finally, uncordon the staging node if it stays in the cluster. The rehearsal should leave the environment clean for the next test.

```bash
$ kubectl uncordon worker-2
node/worker-2 uncordoned
```

Write down any surprise from the rehearsal. A PDB block, FailedScheduling event, slow image pull, missing secret mount, or readiness failure is a production upgrade issue waiting for a quiet time to appear.

![Phased node roll infographic showing staging rehearsal, control plane upgrade, cordon, drain, validate, and next batch during Kubernetes node upgrades](/content-assets/articles/article-containers-orchestration-cluster-operations-cluster-upgrades/phased-node-roll.png)

*The phased roll visual keeps the node-pool upgrade from feeling like one giant change. Each batch has a cordon, drain, replacement, validation, and pause point before the next batch begins.*

## Upgrade in Phases
<!-- section-summary: Separate control plane, node pool, and add-on phases give the team clear pause points and smaller validation loops. -->

A phased upgrade gives you clear moments to stop and inspect. Most managed clusters upgrade the **control plane** before worker nodes. The control plane accepts API requests and runs controllers, while worker nodes run Pods through kubelet and the container runtime.

After the control plane phase, prove that ordinary Kubernetes operations still work. Check API readiness, controller reconciliation, and a no-op server-side dry run for the orders manifests.

```bash
$ kubectl get --raw='/readyz?verbose'
[+]ping ok
[+]log ok
[+]etcd ok
readyz check passed

$ kubectl -n orders rollout status deployment/devpolaris-orders-api
deployment "devpolaris-orders-api" successfully rolled out

$ kubectl apply --server-side --dry-run=server -f k8s/orders/
deployment.apps/devpolaris-orders-api serverside-applied (server dry run)
```

During the node-pool phase, move slowly enough to validate one slice of capacity before continuing. Watch nodes, the orders Deployment, and namespace events together. This helps you spot whether the issue is node readiness, Pod scheduling, or application readiness.

```bash
$ kubectl get nodes
NAME       STATUS                     VERSION
worker-1   Ready                      v1.29.8
worker-2   Ready,SchedulingDisabled   v1.29.8
worker-4   Ready                      v1.30.4

$ kubectl -n orders get events --sort-by=.lastTimestamp | tail -8
LAST SEEN   TYPE    REASON             OBJECT                                      MESSAGE
7m          Normal  Killing            pod/devpolaris-orders-api-...               Stopping container api
6m          Normal  SuccessfulCreate   replicaset/devpolaris-orders-api-...        Created pod
5m          Normal  Pulled             pod/devpolaris-orders-api-...               Container image already present
3m          Normal  Ready              pod/devpolaris-orders-api-...               Readiness probe passed
```

Rollback planning needs plain language. Managed control plane rollback is provider-specific and may be unavailable after a phase completes. Worker node rollback usually means pausing the rollout, keeping old nodes in service, adding a replacement node pool on the previous version if the provider supports it, or restoring from documented backups in self-managed clusters.

The runbook should name the **pause point** for each phase. A pause point is the exact signal that stops the upgrade before more capacity changes. For example, stop the next node drain if `orders` has fewer than two available replicas for more than five minutes, if CoreDNS reports unavailable replicas, or if checkout 5xx rate crosses the incident threshold.

## Validate With Application Evidence
<!-- section-summary: Post-upgrade validation proves the checkout path, service routing, dependencies, metrics, and events are healthy after the platform change. -->

The upgrade is complete only when the application path proves it is healthy. Node `Ready` status is a platform signal. The orders service still needs workload signals: Deployment availability, ready endpoints, in-cluster health, external routing, logs, metrics, and alerts.

Start with Kubernetes availability and endpoint state. EndpointSlices show which Pod IPs are ready behind the Service.

```bash
$ kubectl -n orders get deploy devpolaris-orders-api
NAME                    READY   UP-TO-DATE   AVAILABLE
devpolaris-orders-api   3/3     3            3

$ kubectl -n orders get endpointslice -l kubernetes.io/service-name=devpolaris-orders-api
NAME                          ADDRESSTYPE   PORTS   ENDPOINTS
devpolaris-orders-api-rb6hb   IPv4          8080    10.244.1.42,10.244.2.17,10.244.4.9
```

Then test the Service from inside the cluster. This catches DNS, CNI, Service routing, readiness, and application dependency checks in one small request.

```bash
$ kubectl -n orders run curlcheck --rm -it --image=curlimages/curl --restart=Never -- \
  curl -sS http://devpolaris-orders-api/health/ready
{"status":"ready","database":"ok","queue":"ok"}
```

Check the external path too. The ingress controller or gateway can fail even when the internal Service path works.

```bash
$ curl -sS -o /dev/null -w '%{http_code} %{time_total}\n' \
  https://api.devpolaris.local/orders/checkout/health
200 0.084312
```

Finally, look at the operations dashboards that the team already trusts. For `devpolaris-orders-api`, useful panels are request rate, 5xx rate, p95 latency, Pod restarts, CPU and memory, HPA desired replicas, queue depth, database error count, and ingress error count. The dashboard should show stable behavior for the maintenance window and the cool-down period after it.

```bash
$ kubectl -n orders top pods -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                      CPU(cores)   MEMORY(bytes)
devpolaris-orders-api-7c96df7d7c-2vd6k   220m         350Mi
devpolaris-orders-api-7c96df7d7c-q94r7   240m         361Mi
devpolaris-orders-api-7c96df7d7c-x6s8m   235m         358Mi
```

If any evidence is missing, keep the upgrade open. A platform version can be correct while the service still has a routing, metrics, or readiness problem.

## Handle Failed Drains and Bad Signals
<!-- section-summary: Failed drains, scheduling errors, and warning events are useful signals that should pause the rollout instead of being forced through. -->

A failed drain is usually the cluster protecting a workload or telling you capacity is missing. Treat that signal as a pause point. For the orders service, the most common drain blocker is a PDB that allows zero voluntary disruptions.

```bash
$ kubectl drain worker-2 --ignore-daemonsets --delete-emptydir-data
error when evicting pods/"devpolaris-orders-api-7c96df7d7c-dh8xq":
Cannot evict pod as it would violate the pod's disruption budget.

$ kubectl -n orders get pdb devpolaris-orders-api
NAME                    MIN AVAILABLE   MAX UNAVAILABLE   ALLOWED DISRUPTIONS
devpolaris-orders-api   3               N/A               0
```

This output says the PDB currently requires all three replicas to stay available. The fix might be to scale the Deployment to four replicas, change the PDB to `minAvailable: 2`, or add surge capacity before the node pool rolls. Deleting the PDB just to make the drain pass removes the protection that warned you.

Other bad signals have different fixes. Keep a small diagnostic table in the runbook so the on-call engineer knows where to look first.

| Signal | Likely meaning | First check |
|--------|----------------|-------------|
| `FailedScheduling` | No node has the required CPU, memory, taint toleration, or topology | `kubectl -n orders describe pod <pod>` |
| `FailedMount` | CSI driver, secret, config, or volume problem | Pod events and CSI driver status |
| Repeated `Unhealthy` | Readiness or liveness probe failing after reschedule | `kubectl -n orders logs <pod>` |
| CoreDNS unavailable | Service discovery risk for all workloads | `kubectl -n kube-system rollout status deployment/coredns` |
| New node Ready but no app Pods | Taints, labels, runtime, or image pull path mismatch | `kubectl describe node <node>` |

When the signal points to a platform add-on, pause the node rollout and fix the add-on first. When the signal points to one workload, decide whether that workload is critical enough to pause the cluster upgrade. For checkout traffic, the answer is usually yes.

## Upgrade Runbook Checklist
<!-- section-summary: A useful upgrade checklist ties each phase to evidence, owners, and stop conditions so the team can run the change calmly. -->

A runbook turns upgrade preparation into a repeatable operating habit. It should fit on one page, name the owner for each phase, and include the commands or dashboards people will actually use. Long runbooks that nobody reads during a maintenance window are less helpful than a short checklist with clear stop conditions.

Use this shape for `devpolaris-orders-api` and adapt it to the cluster you operate.

| Phase | Evidence to collect | Stop condition |
|-------|---------------------|----------------|
| Preflight | Version inventory, deprecated API scan, add-on support, PDB state | Unsupported API, unsupported add-on, or zero safe disruptions |
| Staging rehearsal | Successful drain, replacement Pod ready, Service health check passing | Failed scheduling, failed mount, readiness failures, or missing capacity |
| Control plane | API readyz, dry-run apply, controller reconciliation | API readiness failure or controller errors |
| Node pool | One node at a time, Deployment availability, namespace events | Orders API below two available replicas or repeated warning events |
| Validation | Internal health, external health, metrics, alerts, logs | 5xx, latency, dependency errors, or missing metrics |

![Cluster upgrade runbook checklist with inventory first, API checks, add-on proof, drain-ready apps, phased rollout, and evidence bundle](/content-assets/articles/article-containers-orchestration-cluster-operations-cluster-upgrades/cluster-upgrade-runbook.png)

*The runbook summary ties every upgrade phase to proof. It keeps the team focused on inventory, compatibility, drain behavior, phased rollout, and the evidence bundle that closes the maintenance window.*

The final upgrade note should record what changed and what evidence proved success. It should also record any follow-up, such as "add one node of surge capacity before the next upgrade" or "move image pre-pull into the node pool workflow." That note is what makes the next upgrade less stressful.

## What's Next

Cluster upgrades ask whether the platform can move safely under a running service. The next problem is how the API server prevents unsafe changes from getting stored in the first place. That is where admission control and policy enforcement enter the operations story.

For the same `devpolaris-orders-api` service, admission policies can reject weak Pod settings, missing owner labels, or mutable image tags before they reach production. The next article shows how those checks work and how to design them so developers can fix the denied request without guessing.

---

**References**

- [Kubernetes: Version Skew Policy](https://kubernetes.io/releases/version-skew-policy/) - Official compatibility rules between Kubernetes components.
- [Kubernetes: Deprecated API Migration Guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/) - Tracks deprecated and removed Kubernetes API versions.
- [Kubernetes: Safely Drain a Node](https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/) - Official guide for cordon, drain, and node maintenance.
- [Kubernetes: Pod Disruption Budgets](https://kubernetes.io/docs/tasks/run-application/configure-pdb/) - Explains voluntary disruption limits for workloads.
- [Kubernetes: Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/) - Documents node selection, affinity, taints, and scheduling controls.
- [Kubernetes: Topology Spread Constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/) - Explains spreading Pods across failure domains.
- [Kubernetes: Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Documents liveness, readiness, and startup probes.
