---
title: "Helm Releases and Rollbacks"
description: "Install, upgrade, inspect, and roll back Helm releases while verifying the Kubernetes objects they manage."
overview: "A Helm release is the cluster-side record of installing a chart with a specific set of values. This article follows `devpolaris-orders-api` through upgrade, failure diagnosis, and rollback."
tags: ["helm", "releases", "rollback", "upgrade"]
order: 4
id: article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks
---

## Table of Contents

1. [A Release Is The Cluster Record](#a-release-is-the-cluster-record)
2. [Install The First Revision](#install-the-first-revision)
3. [Verify Kubernetes After Helm Returns](#verify-kubernetes-after-helm-returns)
4. [Upgrade Creates A New Revision](#upgrade-creates-a-new-revision)
5. [Inspect Values, Manifest, And History](#inspect-values-manifest-and-history)
6. [Diagnose A Failed Upgrade](#diagnose-a-failed-upgrade)
7. [Roll Back To A Previous Revision](#roll-back-to-a-previous-revision)
8. [Use Atomic Upgrades Carefully](#use-atomic-upgrades-carefully)
9. [Production Release Runbook](#production-release-runbook)
10. [What's Next](#whats-next)

## A Release Is The Cluster Record
<!-- section-summary: A Helm release records one installed chart, one release name, one namespace, chosen values, rendered manifests, and revision history. -->

Imagine production is running revision `2`, and the new image starts failing readiness checks. The team needs a fast answer: which chart, which values, and which rendered manifests were running before the bad change? One release record gives Helm enough history to inspect the current state and roll back to an earlier revision.

A **Helm release** is the cluster-side record created when Helm installs a chart. The release has a name, namespace, values, rendered manifests, status, and revision history. Helm stores that record so operators can inspect, upgrade, and roll back the same application later.

For `devpolaris-orders-api`, the team might use release name `orders` in namespace `devpolaris-prod`. The chart source lives at `./charts/orders-api`, and the production inputs live in `environments/prod.values.yaml`. Helm combines those pieces and records revision `1` after install.

Keep these words separate:

| Term | Plain-English meaning | Orders API example |
|---|---|---|
| Chart | Package source | `./charts/orders-api` |
| Values | Inputs for one target | `environments/prod.values.yaml` |
| Release | Installed chart record | `orders` in `devpolaris-prod` |
| Revision | One saved release version | revision `1`, revision `2`, revision `3` |
| Rollback | Return to an earlier saved manifest | revision `2` returns to revision `1` output |

Release name and namespace work together. A team can use release name `orders` in staging and production as long as the namespaces differ. During incidents, every command should include `--namespace` or `-n` so the operator inspects the intended release.

![Helm release timeline showing install revision one, upgrade revision two, rollback revision three, stored manifest, and namespace](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks/helm-release-timeline.png)

*A Helm release is easier to operate when the team sees the name, namespace, stored manifests, and revision timeline as one connected record.*

## Install The First Revision
<!-- section-summary: helm install renders the chart, sends the manifests to Kubernetes, and stores revision one for later operations. -->

**Installing** a chart creates the first release revision. Helm renders the chart with the chosen values, sends the rendered objects to the Kubernetes API, and stores release metadata.

Start by rendering for review.

```bash
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  > rendered/orders-api-prod.yaml
```

Then install with an explicit release name and namespace.

```bash
$ helm install orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  -n devpolaris-prod \
  --create-namespace
```

A successful install prints release status.

```bash
NAME: orders
LAST DEPLOYED: Tue Jun 16 10:24:31 2026
NAMESPACE: devpolaris-prod
STATUS: deployed
REVISION: 1
```

`STATUS: deployed` means Helm completed its operation from Helm's point of view. Kubernetes controllers still need to create Pods, update readiness, and attach endpoints. Treat Helm output as the first signal, then verify Kubernetes directly.

## Verify Kubernetes After Helm Returns
<!-- section-summary: Helm status and Kubernetes rollout status answer different production questions, so a healthy release checks both. -->

**Release verification** means checking both Helm and Kubernetes. Helm tells you whether the release operation completed. Kubernetes tells you whether the workload reached the desired state and can receive traffic.

Check Helm status first.

```bash
$ helm status orders -n devpolaris-prod
NAME: orders
NAMESPACE: devpolaris-prod
STATUS: deployed
REVISION: 1
```

Then check the Deployment rollout.

```bash
$ kubectl rollout status deployment/devpolaris-orders-api -n devpolaris-prod
deployment "devpolaris-orders-api" successfully rolled out
```

Check the Pods and Service endpoints.

```bash
$ kubectl get pods -l app.kubernetes.io/name=devpolaris-orders-api -n devpolaris-prod
NAME                                      READY   STATUS    RESTARTS   AGE
devpolaris-orders-api-6d7f87b6d9-9q8tz    1/1     Running   0          2m
devpolaris-orders-api-6d7f87b6d9-m2z4k    1/1     Running   0          2m

$ kubectl get endpoints devpolaris-orders-api -n devpolaris-prod
NAME                    ENDPOINTS                       AGE
devpolaris-orders-api   10.42.1.18:8080,10.42.2.9:8080  2m
```

The endpoints output proves the Service has Pod IPs behind it. If endpoints show `<none>`, traffic cannot reach the Pods through that Service.

Finish with a small application check.

```bash
$ curl -fsS https://orders.devpolaris.example/health/ready
ok
```

![Release verification path showing helm upgrade, Deployment, ready Pods, working Service, and smoke test checks](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks/release-verification-path.png)

*Helm can record a successful revision, but operators still need Kubernetes readiness and a small application check to prove the release actually works.*

## Upgrade Creates A New Revision
<!-- section-summary: helm upgrade renders new manifests, applies them, and stores a new revision in release history. -->

**Upgrading** a release means changing an existing Helm release. A normal upgrade uses the same release name and namespace, a chart source, and the values for the new release. Helm renders the new manifests, applies them, and stores the next revision.

The orders API team can upgrade the production image tag in `prod.values.yaml`, then render for review.

```bash
$ helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  > rendered/orders-api-prod.yaml
```

Apply the upgrade with `--wait` so Helm waits for supported resources to report readiness.

```bash
$ helm upgrade orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  -n devpolaris-prod \
  --wait \
  --timeout 5m
```

Successful output names the new revision.

```bash
Release "orders" has been upgraded. Happy Helming!
NAME: orders
NAMESPACE: devpolaris-prod
STATUS: deployed
REVISION: 2
```

`--wait` gives Helm a stronger signal than a quick apply, but operators should still run the Kubernetes checks from the previous section. The application may pass Kubernetes readiness and still fail a business smoke test, such as placing a test order against a downstream dependency.

## Inspect Values, Manifest, And History
<!-- section-summary: Helm inspection commands show which values and rendered manifests belong to each release revision. -->

**Release history** is the list of saved revisions for one Helm release. It helps operators answer what changed and which revision can be used for rollback.

```bash
$ helm history orders -n devpolaris-prod
REVISION  UPDATED                  STATUS      CHART             APP VERSION
1         Tue Jun 16 10:24:31 2026 deployed    orders-api-0.1.0  2026.06.16.1
2         Tue Jun 16 11:08:44 2026 deployed    orders-api-0.1.1  2026.06.16.2
```

Use `helm get values` to inspect the values recorded for the release.

```bash
$ helm get values orders -n devpolaris-prod
replicaCount: 3
image:
  tag: 2026.06.16.2
ingress:
  host: orders.devpolaris.example
```

Use `helm get manifest` to inspect the rendered manifests stored in the release record.

```bash
$ helm get manifest orders -n devpolaris-prod \
  | grep -n "kind: Deployment\\|image:\\|replicas:"
1:kind: Deployment
10:  replicas: 3
34:          image: ghcr.io/devpolaris/orders-api:2026.06.16.2
```

Those commands are useful during incidents. They show the release record Helm knows about. Operators should still compare with live Kubernetes objects when diagnosing drift or controller behavior.

## Diagnose A Failed Upgrade
<!-- section-summary: A failed upgrade needs Helm status, Kubernetes rollout details, events, logs, and the rendered manifest path. -->

A **failed upgrade** means Helm could not complete the release operation, or the release completed while the workload later failed verification. The diagnosis should move from Helm record to Kubernetes object to application evidence.

Imagine revision `2` changes the image to `2026.06.16.2`. The new image requires `ORDERS_EVENT_TOPIC`, but production values do not provide that setting. The YAML renders cleanly, and the API server accepts it. The Pods start, then the readiness endpoint refuses traffic.

Start with Helm status.

```bash
$ helm status orders -n devpolaris-prod
NAME: orders
STATUS: failed
REVISION: 2
```

Check rollout details.

```bash
$ kubectl rollout status deployment/devpolaris-orders-api -n devpolaris-prod
Waiting for deployment "devpolaris-orders-api" rollout to finish:
1 out of 3 new replicas have been updated...
```

Look at Pods and events.

```bash
$ kubectl get pods -l app.kubernetes.io/name=devpolaris-orders-api -n devpolaris-prod
NAME                                      READY   STATUS    RESTARTS   AGE
devpolaris-orders-api-75d56c8847-2v9dp    0/1     Running   3          4m

$ kubectl describe pod devpolaris-orders-api-75d56c8847-2v9dp -n devpolaris-prod
Readiness probe failed: missing ORDERS_EVENT_TOPIC
```

Then inspect application logs.

```bash
$ kubectl logs deployment/devpolaris-orders-api -n devpolaris-prod --tail=20
ERROR config: ORDERS_EVENT_TOPIC is required before accepting traffic
```

The evidence now points to a missing configuration value, not a chart install problem. The team can roll back, then add the value and schema check before retrying.

## Roll Back To A Previous Revision
<!-- section-summary: helm rollback applies the stored manifest from an earlier revision and records a new revision for the rollback action. -->

**Rollback** tells Helm to return a release to the rendered manifest from an earlier revision. The command takes the release name and a revision number. Helm applies the older stored manifest and records a new revision for the rollback operation.

List history before rolling back.

```bash
$ helm history orders -n devpolaris-prod
REVISION  STATUS      CHART             APP VERSION
1         deployed    orders-api-0.1.0  2026.06.16.1
2         failed      orders-api-0.1.1  2026.06.16.2
```

Roll back to revision `1`.

```bash
$ helm rollback orders 1 -n devpolaris-prod --wait --timeout 5m
Rollback was a success! Happy Helming!
```

History now shows a new revision for the rollback action.

```bash
$ helm history orders -n devpolaris-prod
REVISION  STATUS      CHART             APP VERSION
1         superseded  orders-api-0.1.0  2026.06.16.1
2         failed      orders-api-0.1.1  2026.06.16.2
3         deployed    orders-api-0.1.0  2026.06.16.1
```

Verify the workload again.

```bash
$ kubectl rollout status deployment/devpolaris-orders-api -n devpolaris-prod
deployment "devpolaris-orders-api" successfully rolled out

$ curl -fsS https://orders.devpolaris.example/health/ready
ok
```

Rollback restores the Kubernetes manifests Helm manages. Database migrations, queue messages, cache writes, and downstream changes need separate recovery plans. Production rollback plans should name those application-level risks before the release.

## Use Atomic Upgrades Carefully
<!-- section-summary: Atomic upgrades can recover failed Helm operations, but teams still need clear timeout, readiness, and follow-up practices. -->

`--atomic` tells `helm upgrade` to roll back changes if the upgrade fails. Helm also waits for readiness when `--atomic` is present. Many teams include `--wait` and `--timeout` anyway so the command states the intended release behavior plainly.

```bash
$ helm upgrade orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  -n devpolaris-prod \
  --wait \
  --timeout 5m \
  --atomic
```

Failure output can look like this.

```bash
Error: UPGRADE FAILED: timed out waiting for the condition
Release "orders" has been rolled back due to atomic being set
```

Atomic rollback is useful for readiness failures. It should not replace release review, rendered diff, smoke tests, or incident notes. If an upgrade fails, the follow-up work should still explain what failed and what will change before retry.

For the missing `ORDERS_EVENT_TOPIC` example, the follow-up should add the production config value, add a schema requirement, and add a release test that catches the missing topic before upgrade time.

![Rollback on failure flow showing unready Pods, wait timeout, atomic recovery, previous revision, and release record](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks/rollback-on-failure.png)

*Rollback works best when readiness failure, recovery command, previous revision, and release record all point to the same production story.*

## Production Release Runbook
<!-- section-summary: A production Helm runbook records render, upgrade, verification, rollback, and follow-up commands in one place. -->

A **release runbook** is the written sequence the operator follows during a release. It should name commands, expected evidence, and rollback steps. During an incident, the runbook helps the team work from facts instead of memory.

For the orders API, the runbook can stay compact.

```yaml
Release:
  name: orders
  namespace: devpolaris-prod
  chart: ./charts/orders-api
  values: environments/prod.values.yaml
Preflight:
  - helm lint ./charts/orders-api -f environments/prod.values.yaml
  - helm template orders ./charts/orders-api -f environments/prod.values.yaml > rendered/prod.yaml
Upgrade:
  - helm upgrade orders ./charts/orders-api -f environments/prod.values.yaml -n devpolaris-prod --wait --timeout 5m --atomic
Verify:
  - helm status orders -n devpolaris-prod
  - kubectl rollout status deployment/devpolaris-orders-api -n devpolaris-prod
  - curl -fsS https://orders.devpolaris.example/health/ready
Rollback:
  - helm history orders -n devpolaris-prod
  - helm rollback orders <revision> -n devpolaris-prod --wait --timeout 5m
```

After a rollback, record what happened.

```yaml
IncidentNote:
  release: orders
  failedRevision: 2
  rollbackRevision: 3
  command: helm rollback orders 1 -n devpolaris-prod --wait --timeout 5m
  reason: image 2026.06.16.2 required ORDERS_EVENT_TOPIC
  verification: /health/ready returned 200 after rollback
  followUp: add value, schema requirement, and release test
```

This habit turns Helm operations into evidence the next person can trust. It also keeps the chart, values, release record, Kubernetes rollout, and application smoke test tied together.

## What's Next

You now have the main Helm operations loop: render values, install or upgrade, inspect Helm history and status, verify Kubernetes objects, and roll back when a release revision needs recovery. That loop is the practical center of Helm operations for a service like `devpolaris-orders-api`.

The next article shifts to Kustomize. Some teams prefer valid Kubernetes YAML with overlays instead of Helm templates and release records. The same render-first habit stays in place, but the source files, review flow, and rollback story look different.

---

**References**

- [Helm Install](https://helm.sh/docs/helm/helm_install/) - Current command reference for installing charts, values files, `--wait`, rollback-on-failure behavior, and install dry runs.
- [Helm Upgrade](https://helm.sh/docs/v3/helm/helm_upgrade/) - Versioned Helm 3 command reference for upgrades, values precedence, `--wait`, `--timeout`, and `--atomic`.
- [Helm Upgrade](https://helm.sh/docs/helm/helm_upgrade/) - Current Helm command reference, including Helm 4 `--rollback-on-failure` behavior.
- [Helm History](https://helm.sh/docs/helm/helm_history/) - Current command reference for release revision history.
- [Helm Status](https://helm.sh/docs/helm/helm_status/) - Current command reference for release status.
- [Helm Get Values](https://helm.sh/docs/helm/helm_get_values/) - Current command reference for inspecting recorded release values.
- [Helm Get Manifest](https://helm.sh/docs/helm/helm_get_manifest/) - Current command reference for inspecting rendered manifests stored in a release.
- [Helm Rollback](https://helm.sh/docs/helm/helm_rollback/) - Current command reference for rolling a release back to a previous revision.
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official Kubernetes documentation for Deployment rollout behavior and status checks.
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Official Kubernetes guide to stable networking for Pods.
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - Official Kubernetes guide to HTTP routing through Ingress.
