---
title: "Helm Releases and Rollbacks"
description: "Install, upgrade, inspect, and roll back Helm releases while verifying the Kubernetes objects they manage."
overview: "A Helm release is the cluster-side record of installing a chart with a specific set of values. This article follows `devpolaris-orders-api` through upgrade, failure diagnosis, and rollback."
tags: ["helm", "releases", "rollback", "upgrade"]
order: 4
id: article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks
---

## Table of Contents

1. [A Release Is an Installed Chart](#a-release-is-an-installed-chart)
2. [Installing devpolaris-orders-api](#installing-devpolaris-orders-api)
3. [Upgrading a Release](#upgrading-a-release)
4. [Inspecting Release History](#inspecting-release-history)
5. [Failure Mode: Upgrade Succeeds but Pods Do Not Become Ready](#failure-mode-upgrade-succeeds-but-pods-do-not-become-ready)
6. [Rolling Back a Release](#rolling-back-a-release)
7. [Atomic Upgrades and Waiting](#atomic-upgrades-and-waiting)
8. [What Helm Rollback Does Not Prove](#what-helm-rollback-does-not-prove)
9. [Release Records for Humans](#release-records-for-humans)
10. [Uninstalling Without Losing the Plot](#uninstalling-without-losing-the-plot)

## A Release Is an Installed Chart

A Helm chart is the package source. A Helm release is an installation of that chart into a cluster namespace with a release name and values. The same chart can have many releases, such as `orders-staging` in `devpolaris-staging` and `orders-prod` in `devpolaris-prod`.

![Helm release lifecycle showing install, revision 1, upgrade, revision 2, and history](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks/helm-release-lifecycle.png)

*A Helm release is the installed chart plus its revision history.*


Helm stores release history so it can show what was installed and roll back to a previous revision. That history is helpful, but it does not remove the need to inspect Kubernetes objects. Helm remembers the rendered manifests. Kubernetes still decides whether Pods become ready and Services route traffic.

The running example uses the `orders-api` chart. The production release name is `orders`. The namespace is `devpolaris-prod`.

Release name and namespace together identify the installation. You can have a release called `orders` in staging and another release called `orders` in production because they live in different namespaces. That can be convenient, but your commands must always include the namespace so you do not inspect the wrong release.

```bash
$ helm list -A | grep orders
orders   devpolaris-staging  5  2026-05-07 18:22:10 +0000 UTC  deployed  orders-api-0.1.1
orders   devpolaris-prod     2  2026-05-07 19:36:44 +0000 UTC  deployed  orders-api-0.1.1
```

When a production incident is active, copy the namespace into every command. Guessing the namespace wastes time and can lead to reading staging evidence while production users are affected.

## Installing devpolaris-orders-api

Installing a Helm chart creates a release record and applies the rendered Kubernetes objects. It is the first time a chart, values, release name, and namespace become live cluster state.

Example: installing the orders API chart with release name `orders` in `devpolaris-prod` creates revision 1 and applies the rendered Deployment and Service.

```bash
$ helm install orders ./charts/orders-api \
  --namespace devpolaris-prod \
  --create-namespace \
  -f environments/prod.values.yaml
NAME: orders
LAST DEPLOYED: Thu May  7 19:11:08 2026
NAMESPACE: devpolaris-prod
STATUS: deployed
REVISION: 1
```

The output says Helm created revision 1. Now check the workload directly.

```bash
$ kubectl get deploy,svc -n devpolaris-prod -l app.kubernetes.io/instance=orders
NAME                                      READY   UP-TO-DATE   AVAILABLE
deployment.apps/orders-devpolaris-orders-api  3/3     3            3

NAME                             TYPE        CLUSTER-IP     PORT
service/orders-devpolaris-orders-api ClusterIP   10.96.144.20   8080/TCP
```

The label `app.kubernetes.io/instance=orders` connects these objects to the release. Good charts include that label so operators can query release-owned resources without guessing names.

## Upgrading a Release

Upgrading a Helm release renders the chart again with new chart source or values, then applies the difference to the cluster. It is how a release moves from one revision to the next.

Example: a normal orders API image release might update only `image.tag` from `2026.05.07` to `2026.05.07.2`, while keeping replicas, Service, and ingress unchanged.

```yaml
image:
  tag: "2026.05.07.2"
```

Run the upgrade with the same release name and namespace.

```bash
$ helm upgrade orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml
Release "orders" has been upgraded. Happy Helming!
NAME: orders
NAMESPACE: devpolaris-prod
STATUS: deployed
REVISION: 2
```

Now verify the Deployment image and rollout status:

```bash
$ kubectl rollout status deployment/orders-devpolaris-orders-api -n devpolaris-prod
deployment "orders-devpolaris-orders-api" successfully rolled out

$ kubectl get deploy orders-devpolaris-orders-api -n devpolaris-prod \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
ghcr.io/devpolaris/orders-api:2026.05.07.2
```

Helm's `STATUS: deployed` tells you the Helm operation completed. The Kubernetes rollout status tells you whether the Deployment controller finished replacing Pods.

## Inspecting Release History

Release history is Helm's record of install, upgrade, rollback, and uninstall actions for a release. It is useful during incidents because it gives you a timeline of Helm operations.

Example: if production fails after revision 2, `helm history orders -n devpolaris-prod` shows which revision is currently deployed and which earlier revision might be a rollback target.

```bash
$ helm history orders -n devpolaris-prod
REVISION  UPDATED                   STATUS      CHART           APP VERSION  DESCRIPTION
1         Thu May 7 19:11:08 2026   superseded  orders-api-0.1.0 2026.05.07   Install complete
2         Thu May 7 19:36:44 2026   deployed    orders-api-0.1.1 2026.05.07   Upgrade complete
```

You can inspect the values Helm used for a release:

```bash
$ helm get values orders -n devpolaris-prod
image:
  tag: 2026.05.07.2
replicaCount: 3
```

You can also inspect the rendered manifest stored for the release:

```bash
$ helm get manifest orders -n devpolaris-prod | grep -n "image:"
38:          image: ghcr.io/devpolaris/orders-api:2026.05.07.2
```

These commands answer different questions. `helm get values` shows inputs. `helm get manifest` shows output. `kubectl get` shows live cluster state.

If those three views disagree, treat the disagreement as the clue. For example, Helm may show image `2026.05.07.2`, but the live Deployment may still show `2026.05.07.1` if another controller reverted the object or the upgrade targeted a different namespace.

```bash
$ helm get manifest orders -n devpolaris-prod | grep "image:"
          image: ghcr.io/devpolaris/orders-api:2026.05.07.2

$ kubectl get deploy orders-devpolaris-orders-api -n devpolaris-prod \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
ghcr.io/devpolaris/orders-api:2026.05.07.1
```

Now the next question is not "why is Helm broken?" It is "who last changed the live Deployment?" Check events, GitOps sync status, and audit logs if your cluster exposes them.

## Failure Mode: Upgrade Succeeds but Pods Do Not Become Ready

A Helm upgrade can succeed at the apply layer while the application still fails at the readiness layer. Suppose a chart upgrade applies successfully, but the new image requires an environment variable that the values file did not provide. Helm may report the release as deployed if it did not wait for readiness.

![Helm upgrade readiness path showing helm upgrade, rendered YAML, API accepted, pods not ready, and rollback choice](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks/helm-upgrade-readiness.png)

*A Helm upgrade can succeed at the API layer while the workload still fails readiness.*


```bash
$ helm upgrade orders ./charts/orders-api -n devpolaris-prod -f environments/prod.values.yaml
Release "orders" has been upgraded. Happy Helming!

$ kubectl rollout status deployment/orders-devpolaris-orders-api -n devpolaris-prod --timeout=60s
Waiting for deployment "orders-devpolaris-orders-api" rollout to finish: 1 out of 3 new replicas have been updated...
error: timed out waiting for the condition
```

Now follow the Kubernetes path:

```bash
$ kubectl get pods -n devpolaris-prod -l app.kubernetes.io/instance=orders
NAME                                             READY   STATUS    RESTARTS
orders-devpolaris-orders-api-7fc7f88bdb-jg2m8    0/1     Running   0
orders-devpolaris-orders-api-8597c95b5c-px4db    1/1     Running   0
orders-devpolaris-orders-api-8597c95b5c-z9xsk    1/1     Running   0

$ kubectl logs orders-devpolaris-orders-api-7fc7f88bdb-jg2m8 -n devpolaris-prod --tail=20
2026-05-07T19:39:13Z startup failed: ORDERS_EVENT_TOPIC is required
```

The Helm release changed the Deployment. The application did not become ready. The fix direction is to add the missing value, render the manifest, and upgrade again, or roll back if production needs to return to the previous revision first.

## Rolling Back a Release

Helm rollback applies the stored manifest from an earlier release revision as a new revision. It exists to return Kubernetes objects to a previous chart output when the newer output is unhealthy.

Example: if revision 2 introduced a bad image, `helm rollback orders 1` creates revision 3 whose content matches revision 1.

```bash
$ helm rollback orders 1 -n devpolaris-prod
Rollback was a success! Happy Helming!

$ helm history orders -n devpolaris-prod
REVISION  STATUS      DESCRIPTION
1         superseded  Install complete
2         superseded  Upgrade complete
3         deployed    Rollback to 1
```

Notice that rollback creates a new revision. The current deployed revision is now 3, and its content matches revision 1. Verify the image and rollout:

```bash
$ kubectl get deploy orders-devpolaris-orders-api -n devpolaris-prod \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
ghcr.io/devpolaris/orders-api:2026.05.07

$ kubectl rollout status deployment/orders-devpolaris-orders-api -n devpolaris-prod
deployment "orders-devpolaris-orders-api" successfully rolled out
```

Rollback is a recovery action, not the end of the work. Open a follow-up change that fixes the missing value or app startup requirement.

## Atomic Upgrades and Waiting

Waiting tells Helm to watch supported Kubernetes resources for readiness before marking an operation successful. Atomic upgrade is the fail-and-rollback policy layered on top of that waiting behavior. Together, they make the release command care about whether the new Pods become ready, not only whether Kubernetes accepted the new objects.

Example: if the new orders API Pods never become ready within five minutes, `--atomic --timeout 5m` makes the command fail and tries to return the release to the previous revision.

```bash
$ helm upgrade orders ./charts/orders-api \
  -n devpolaris-prod \
  -f environments/prod.values.yaml \
  --atomic \
  --timeout 5m
Error: release orders failed, and has been rolled back due to atomic being set:
timed out waiting for the condition
```

This is safer than a plain upgrade because the command fails loudly and tries to return the release to the previous working revision. The tradeoff is that the command takes longer and depends on readiness signals being accurate. If probes are weak, Helm can wait for the wrong thing.

## What Helm Rollback Does Not Prove

Helm can restore an older manifest. It cannot prove the database schema is compatible, external queues are healthy, or users can place orders. After an upgrade or rollback, run a small application check.

```bash
$ curl -fsS https://orders.devpolaris.example/health/ready
{"status":"ready","database":"ok","events":"ok"}
```

For `devpolaris-orders-api`, a release record should include the Helm revision, image tag, rollout status, and smoke-test result.

```text
Release: orders
Namespace: devpolaris-prod
Helm revision: 3
Image: ghcr.io/devpolaris/orders-api:2026.05.07
Rollout: successfully rolled out
Smoke test: /health/ready returned 200
```

That evidence helps the next person understand whether the incident was a chart problem, a values problem, a Kubernetes readiness problem, or an application behavior problem.

## Release Records for Humans

Helm history is useful, but incident review often needs more context than Helm stores. A human release record should connect the Git commit, chart version, values file, image tag, release command, and verification evidence.

```text
Production release record

Service: devpolaris-orders-api
Namespace: devpolaris-prod
Helm release: orders
Git commit: 7f3a91c
Chart: orders-api-0.1.1
Values file: environments/prod.values.yaml
Image: ghcr.io/devpolaris/orders-api:2026.05.07.2
Command: helm upgrade orders ./charts/orders-api -n devpolaris-prod -f environments/prod.values.yaml --atomic --timeout 5m
Verification: rollout status passed, /health/ready returned 200
```

This record helps when the release needs to be explained the next day. It also helps during a rollback because the operator can see exactly which revision and image were known good.

When the release is automated, CI or the delivery controller can create the same record. The important thing is that the release evidence is easy to find. A Helm revision number by itself is not enough if nobody knows which Git change produced it.

## Uninstalling Without Losing the Plot

`helm uninstall` removes the Kubernetes resources Helm manages for a release. Those managed resources are the objects in the stored manifest, such as Deployments, Services, ConfigMaps, and sometimes PersistentVolumeClaims. Uninstall is useful for preview environments and temporary test installs. It is dangerous in production if the release owns persistent resources or if another team expects the objects to keep existing.

```bash
$ helm uninstall orders-preview -n devpolaris-pr-184
release "orders-preview" uninstalled
```

For production, inspect what the release manages before uninstalling:

```bash
$ helm get manifest orders -n devpolaris-prod | grep "^kind:"
kind: Service
kind: Deployment
kind: ConfigMap
kind: Ingress
```

If the manifest includes a PersistentVolumeClaim or another stateful object, slow down. Deleting the release may delete data-bearing resources depending on how they are configured. Even when data survives, removing the application objects can interrupt traffic.

For `devpolaris-orders-api`, uninstall is normally a preview cleanup action. Production retirement should be a planned change: remove traffic first, verify no callers remain, archive release evidence, then remove the release.

One final check is ownership. If another controller or team depends on an object from the release, uninstalling Helm can remove a shared object unexpectedly. Labels help you query ownership, but they do not replace a human retirement plan.

```bash
$ kubectl get all -n devpolaris-prod -l app.kubernetes.io/instance=orders
```

Use that output to confirm the release contains only the objects you intend to remove.


![Helm release summary covering install, upgrade, history, status, rollback, and atomic behavior](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks/helm-release-summary.png)

*Use this checklist to separate package installation from workload health.*

---

**References**

- [Helm Install](https://helm.sh/docs/helm/helm_install/) - Official command reference for installing a chart as a release.
- [Helm Upgrade](https://helm.sh/docs/helm/helm_upgrade/) - Official command reference for upgrading releases, values overrides, `--wait`, and `--atomic`.
- [Helm Rollback](https://helm.sh/docs/helm/helm_rollback/) - Official command reference for rolling a release back to an earlier revision.
- [Helm History](https://helm.sh/docs/helm/helm_history/) - Official command reference for inspecting release revisions.
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official Kubernetes documentation for rollout status and Deployment behavior.
