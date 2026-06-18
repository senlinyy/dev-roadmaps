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
3. [Verifying Kubernetes Objects After Install](#verifying-kubernetes-objects-after-install)
4. [Upgrading a Release](#upgrading-a-release)
5. [History, Status, Values, and Manifests](#history-status-values-and-manifests)
6. [When Helm Succeeds and Pods Stay Unready](#when-helm-succeeds-and-pods-stay-unready)
7. [Rolling Back to an Earlier Revision](#rolling-back-to-an-earlier-revision)
8. [Wait, Atomic, and Rollback-on-Failure](#wait-atomic-and-rollback-on-failure)
9. [Release Records for Production Teams](#release-records-for-production-teams)
10. [What's Next](#whats-next)

## A Release Is an Installed Chart
<!-- section-summary: A Helm release is the named cluster installation of a chart, values, namespace, and revision history. -->

The previous article focused on values because values decide what a chart renders. The next step is what happens after Helm sends that rendered YAML to Kubernetes. Helm creates a **release**, which is the cluster-side record for one installed chart with one release name, one namespace, one set of values, and a sequence of revisions.

For `devpolaris-orders-api`, the chart might live at `./charts/orders-api`. The production release name might be `orders`, and the namespace might be `devpolaris-prod`. That combination lets Helm find the production installation later.

The same chart can have multiple releases. This table shows the same chart source installed for different operational targets.

| Release | Namespace | Purpose |
|---|---|---|
| `orders` | `devpolaris-staging` | Staging release with release-candidate images |
| `orders` | `devpolaris-prod` | Production release with approved images |
| `orders-pr-184` | `devpolaris-pr-184` | Temporary preview release for one pull request |

Release name and namespace work together. A team can reuse the name `orders` in staging and production because the namespace separates them. That also means every operational command should include `--namespace` or `-n`, especially during an incident.

```bash
helm list --all-namespaces --filter '^orders$'
```

```
NAME    NAMESPACE             REVISION  UPDATED                  STATUS    CHART
orders  devpolaris-staging    7         2026-06-16 09:21:04 UTC  deployed  orders-api-0.3.0
orders  devpolaris-prod       3         2026-06-16 10:05:18 UTC  deployed  orders-api-0.3.0
```

That output tells the operator there are two releases with the same name. The production release exists in `devpolaris-prod`, so the rest of the production commands in this article carry that namespace explicitly.

## Installing devpolaris-orders-api
<!-- section-summary: Helm install creates the first release revision and applies the chart's rendered Kubernetes objects to the chosen namespace. -->

**Installing** a chart creates the first revision of a release. Helm renders the chart with the chosen values, sends the rendered objects to the Kubernetes API, and stores release metadata so future commands can inspect, upgrade, or roll back the release.

For the orders API, the production install uses the chart path and the production values file. The command also creates the namespace when the namespace is missing.

```bash
helm install orders ./charts/orders-api \
  --namespace devpolaris-prod \
  --create-namespace \
  -f environments/prod.values.yaml
```

```
NAME: orders
LAST DEPLOYED: Tue Jun 16 10:05:18 2026
NAMESPACE: devpolaris-prod
STATUS: deployed
REVISION: 1
```

This output confirms that Helm created revision `1` for the `orders` release. It also says `STATUS: deployed`, which means Helm completed the install operation from its point of view. The Kubernetes workload still deserves direct verification because controllers continue working after Helm returns.

A production team usually renders the chart before the install command reaches the cluster. That gives reviewers the exact YAML that Helm will apply.

```bash
helm template orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml \
  > rendered/prod-orders-api.yaml
```

The rendered file should show the expected Deployment, Service, ConfigMap, and routing object. If the chart uses Ingress, reviewers should see an Ingress host. If the platform uses Gateway API, reviewers should see the Gateway-related route object the chart owns.

## Verifying Kubernetes Objects After Install
<!-- section-summary: Helm reports release success, while kubectl confirms that the live Deployment, Service, ConfigMap, and routing objects match the release intent. -->

After install, the operator should verify the Kubernetes objects that the release manages. Helm applied the manifests, and now Kubernetes controllers reconcile those objects. The Deployment controller creates ReplicaSets and Pods, the Service selects Pods by labels, and the Ingress or Gateway controller configures routing.

Good charts put Helm's standard labels on objects. The label `app.kubernetes.io/instance=orders` gives the team a reliable way to query the resources that belong to the release.

```bash
kubectl get deploy,svc,configmap,ingress \
  -n devpolaris-prod \
  -l app.kubernetes.io/instance=orders
```

```
NAME                                            READY   UP-TO-DATE   AVAILABLE
deployment.apps/orders-devpolaris-orders-api    3/3     3            3

NAME                                      TYPE        CLUSTER-IP     PORT(S)
service/orders-devpolaris-orders-api      ClusterIP   10.96.44.20    8080/TCP

NAME                                               DATA   AGE
configmap/orders-devpolaris-orders-api-config      2      2m

NAME                                             CLASS   HOSTS
ingress.networking.k8s.io/orders-devpolaris-orders-api   nginx   orders.devpolaris.example
```

The Deployment line checks workload health. `3/3` ready means three desired Pods are ready from the Deployment controller's view. The Service line confirms the stable cluster endpoint exists on port `8080`, and the ConfigMap line confirms the plain runtime configuration object exists.

The next check follows the rollout directly. It waits for the Deployment controller to report that the desired Pods are ready.

```bash
kubectl rollout status deployment/orders-devpolaris-orders-api \
  -n devpolaris-prod \
  --timeout=5m
```

```
deployment "orders-devpolaris-orders-api" successfully rolled out
```

The rollout check matters because Helm and Kubernetes answer different questions. Helm answers whether the release operation finished. Kubernetes answers whether the workload reached the desired state. A production release needs both answers before the team treats the install as healthy.

## Upgrading a Release
<!-- section-summary: Helm upgrade renders the chart again with new chart source or values, applies the result, and creates the next release revision. -->

After the first install, normal delivery uses **upgrade**. A Helm upgrade takes the same release name and namespace, renders the chart again, applies changes to the cluster, and records a new revision. The upgrade might change chart templates, values, the container image tag, or some combination of those.

For a normal orders API release, the production values file might change only the image tag. The pull request should make that release intent obvious.

```diff
 image:
-  tag: "2026.06.16.1"
+  tag: "2026.06.16.2"
```

The upgrade command uses the same release name, chart path, namespace, and values file. Keeping those inputs consistent helps Helm update the existing release instead of creating a separate installation.

```bash
helm upgrade orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml
```

```
Release "orders" has been upgraded. Happy Helming!
NAME: orders
NAMESPACE: devpolaris-prod
STATUS: deployed
REVISION: 2
```

Helm now reports revision `2`. The team should verify that Kubernetes actually received the new image and completed the rollout.

```bash
kubectl get deployment orders-devpolaris-orders-api \
  -n devpolaris-prod \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

```
ghcr.io/devpolaris/orders-api:2026.06.16.2
```

```bash
kubectl rollout status deployment/orders-devpolaris-orders-api \
  -n devpolaris-prod \
  --timeout=5m
```

```
deployment "orders-devpolaris-orders-api" successfully rolled out
```

This verification closes the gap between Helm release state and live workload state. If Helm shows revision `2` but the Deployment still shows the previous image, the operator should investigate namespace mix-ups, another controller changing the Deployment, or a GitOps reconciler applying a different source of truth.

## History, Status, Values, and Manifests
<!-- section-summary: Helm inspection commands answer different questions about revision timeline, release state, supplied values, and stored rendered manifests. -->

Once a release has a few revisions, Helm's inspection commands become part of normal operations. **History** shows the timeline. **Status** shows the current release summary. **Get values** shows the user-supplied inputs Helm recorded. **Get manifest** shows the rendered YAML Helm stored for the release.

During a production incident, the timeline usually comes first. It gives the operator revision numbers and recent release actions.

```bash
helm history orders -n devpolaris-prod
```

```
REVISION  UPDATED                   STATUS      CHART           APP VERSION  DESCRIPTION
1         Tue Jun 16 10:05:18 2026  superseded  orders-api-0.3.0 2026.06.16   Install complete
2         Tue Jun 16 10:28:41 2026  deployed    orders-api-0.3.0 2026.06.16   Upgrade complete
```

This table says revision `2` is current and revision `1` still exists as an earlier point in the release history. That gives the operator a rollback target if revision `2` causes a production problem.

`helm status` gives the current release state. It is the quick check for the release Helm currently considers deployed.

```bash
helm status orders -n devpolaris-prod
```

```
NAME: orders
LAST DEPLOYED: Tue Jun 16 10:28:41 2026
NAMESPACE: devpolaris-prod
STATUS: deployed
REVISION: 2
```

`helm get values` answers which user-supplied values Helm recorded for the release. This is useful when an upgrade command used several values files or command-line overrides.

```bash
helm get values orders -n devpolaris-prod
```

```yaml
replicaCount: 3
image:
  tag: "2026.06.16.2"
config:
  logLevel: info
  catalogUrl: http://catalog-api.devpolaris-prod.svc.cluster.local:8080
ingress:
  enabled: true
  host: orders.devpolaris.example
```

`helm get manifest` answers what Helm stored after rendering. That stored YAML helps the team compare Helm's view with live Kubernetes objects.

```bash
helm get manifest orders -n devpolaris-prod | grep -n "image:\\|replicas:\\|host:"
```

```
12:  replicas: 3
33:          image: "ghcr.io/devpolaris/orders-api:2026.06.16.2"
86:    - host: "orders.devpolaris.example"
```

The last view comes from Kubernetes itself. It shows whether the Deployment controller has observed the latest desired state.

```bash
kubectl get deployment orders-devpolaris-orders-api \
  -n devpolaris-prod \
  -o jsonpath='{.metadata.generation}{" "}{.status.observedGeneration}{" "}{.status.readyReplicas}{"\n"}'
```

```
5 5 3
```

Those three numbers mean the Deployment controller observed the latest Deployment generation and has three ready replicas. Helm history, Helm status, stored values, stored manifest, and live Kubernetes state now tell one consistent story.

## When Helm Succeeds and Pods Stay Unready
<!-- section-summary: A Helm operation can complete while the application still fails readiness, so release diagnosis must follow the Kubernetes workload path. -->

A common production surprise looks like this: Helm reports `deployed`, but users still see failures. This can happen when Kubernetes accepts the Deployment object, creates Pods, and then the application fails its readiness checks. A plain Helm upgrade can finish before the workload proves it can serve traffic.

Imagine the orders API image `2026.06.16.2` now requires `ORDERS_EVENT_TOPIC`, but the production ConfigMap lacks that key. The upgrade applies cleanly because the YAML is valid. The new Pods start, read configuration, and then the readiness endpoint refuses traffic because the app has no event topic for publishing order events.

```bash
helm upgrade orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml
```

```
Release "orders" has been upgraded. Happy Helming!
```

The Kubernetes rollout shows the real problem. It connects the release to the Deployment controller instead of stopping at Helm output.

```bash
kubectl rollout status deployment/orders-devpolaris-orders-api \
  -n devpolaris-prod \
  --timeout=60s
```

```
Waiting for deployment "orders-devpolaris-orders-api" rollout to finish: 1 out of 3 new replicas have been updated...
error: timed out waiting for the condition
```

Now the operator follows Pods, events, and logs. This path usually turns a vague release failure into a specific application or configuration problem.

```bash
kubectl get pods \
  -n devpolaris-prod \
  -l app.kubernetes.io/instance=orders
```

```
NAME                                             READY   STATUS    RESTARTS
orders-devpolaris-orders-api-6cb66d5f98-kj42m    0/1     Running   0
orders-devpolaris-orders-api-76fdcc9c98-bz6ph    1/1     Running   0
orders-devpolaris-orders-api-76fdcc9c98-hz2cv    1/1     Running   0
```

```bash
kubectl describe pod orders-devpolaris-orders-api-6cb66d5f98-kj42m \
  -n devpolaris-prod
```

```
Readiness probe failed: HTTP probe failed with statuscode: 503
```

```bash
kubectl logs orders-devpolaris-orders-api-6cb66d5f98-kj42m \
  -n devpolaris-prod \
  --tail=30
```

```
2026-06-16T10:33:14Z startup check failed: ORDERS_EVENT_TOPIC is required
```

At this point, the team has a values or application compatibility problem. The fast recovery path might roll back to revision `1`. The lasting fix should add the missing ConfigMap value, update the chart schema if needed, render the diff, and release again after review.

## Rolling Back to an Earlier Revision
<!-- section-summary: Helm rollback applies the stored manifest from an earlier revision and records that recovery as a new release revision. -->

**Rollback** tells Helm to return a release to the rendered manifest from an earlier revision. The command takes the release name and a revision number. Helm then applies the older stored manifest and records a new revision for the rollback action.

If revision `2` introduced the missing event-topic configuration problem, revision `1` is the last known healthy target. The rollback command names that earlier revision directly.

```bash
helm rollback orders 1 -n devpolaris-prod
```

```
Rollback was a success! Happy Helming!
```

The history now shows a new current revision. It proves the recovery action has its own audit trail.

```bash
helm history orders -n devpolaris-prod
```

```
REVISION  STATUS      DESCRIPTION
1         superseded  Install complete
2         superseded  Upgrade complete
3         deployed    Rollback to 1
```

The important detail is revision `3`. Revision `2` remains in history, and Helm creates revision `3` whose rendered content matches revision `1`. That keeps the recovery action visible in history.

The same Kubernetes verification still applies. The command checks that the live Deployment now points at the image from the known healthy revision.

```bash
kubectl get deployment orders-devpolaris-orders-api \
  -n devpolaris-prod \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

```
ghcr.io/devpolaris/orders-api:2026.06.16.1
```

```bash
kubectl rollout status deployment/orders-devpolaris-orders-api \
  -n devpolaris-prod \
  --timeout=5m
```

```
deployment "orders-devpolaris-orders-api" successfully rolled out
```

Then the application check confirms that traffic can work again. It checks the app's own readiness path after Kubernetes finishes the rollout.

```bash
curl -fsS https://orders.devpolaris.example/health/ready
```

```json
{
  "status": "ready",
  "database": "ok",
  "events": "ok"
}
```

Rollback recovers the Kubernetes manifests that Helm manages. Application-level verification still matters because smoke tests cover database migrations, queue compatibility, cache state, and downstream service behavior. The release owner should open the follow-up fix while the incident details are still fresh.

## Wait, Atomic, and Rollback-on-Failure
<!-- section-summary: Waiting makes Helm care about readiness, while atomic or rollback-on-failure behavior tries to recover automatically when readiness fails. -->

The readiness problem above shows why many production Helm commands include **wait** behavior. With `--wait`, Helm watches supported Kubernetes resources and waits until they report ready, up to the configured timeout. That connects the Helm command more closely to the Deployment rollout instead of stopping after the API server accepts the objects.

For Helm 3, production teams often combine `--wait`, `--timeout`, and `--atomic`. The command expresses both a readiness timeout and an automatic recovery policy.

```bash
helm upgrade orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml \
  --wait \
  --timeout 5m \
  --atomic
```

If the new Pods never become ready within five minutes, Helm marks the upgrade as failed and rolls back the changes from the failed upgrade. Helm 3 also sets `--wait` automatically when `--atomic` is present, but many teams include both flags because the command then states the intent clearly.

The failure output might look like this. It tells the operator that Helm tried to recover because readiness missed the timeout.

```
Error: release orders failed, and has been rolled back due to atomic being set:
timed out waiting for the condition
```

Current Helm 4 documentation uses `--rollback-on-failure` for the same production idea. If the team runs Helm 4, the command should match the local `helm upgrade --help` output and the official Helm 4 docs. The operational goal stays the same: the release command should fail loudly when readiness fails and should attempt an automatic recovery path.

```bash
helm upgrade orders ./charts/orders-api \
  --namespace devpolaris-prod \
  -f environments/prod.values.yaml \
  --rollback-on-failure \
  --timeout 5m
```

Waiting improves the release signal, but it relies on the workload's readiness signals. If the app reports ready before it can process real orders, Helm will trust that signal. This is why teams pair Helm flags with meaningful readiness probes and a small smoke test after the command completes.

`--wait-for-jobs` matters when a chart runs Helm hook Jobs or release Jobs that must complete before the team treats the release as done. A migration Job, for example, should have a clear timeout and a recovery plan. Helm can wait for the Job, but the team still needs to decide what a failed migration means for rollback.

## Release Records for Production Teams
<!-- section-summary: A release record connects Helm revision data with Git, image, rendered output, Kubernetes verification, and smoke-test evidence. -->

Helm history gives a useful revision timeline, but a production release record should carry more context. The next engineer needs to know which Git commit produced the chart, which image tag ran, which values file supplied the inputs, which command executed, and which verification checks passed.

A concise release record for the orders API can look like this. The fields connect the Helm command to Git, Kubernetes, and the application check.

```
Service: devpolaris-orders-api
Namespace: devpolaris-prod
Helm release: orders
Helm revision: 2
Chart: orders-api-0.3.0
Git commit: 9b7c21e
Values file: environments/prod.values.yaml
Image: ghcr.io/devpolaris/orders-api:2026.06.16.2
Command: helm upgrade orders ./charts/orders-api -n devpolaris-prod -f environments/prod.values.yaml --wait --timeout 5m --atomic
Rendered diff: image tag changed from 2026.06.16.1 to 2026.06.16.2
Kubernetes verification: Deployment rolled out, 3/3 Pods ready, Service port 8080 present
Smoke test: /health/ready returned 200
```

Automation can create this record, and a human can enrich it during unusual releases. The important point is that the release evidence connects Helm state to live Kubernetes state. A revision number alone forces the next person to reconstruct too much under pressure.

During rollback, the record should include the target revision and the reason. The note should also name the follow-up change that prevents the same failure from returning.

```
Rollback record

Service: devpolaris-orders-api
Namespace: devpolaris-prod
Helm release: orders
Command: helm rollback orders 1 -n devpolaris-prod
New Helm revision: 3
Rollback target: revision 1
Reason: revision 2 image required ORDERS_EVENT_TOPIC, and production values lacked that key
Verification: Deployment rolled out, image returned to 2026.06.16.1, /health/ready returned 200
Follow-up: add ORDERS_EVENT_TOPIC value, schema requirement, and release test before retry
```

This habit turns release operations into a trail that people can trust. It also makes post-incident review fairer because the team can see the exact input, output, and verification path instead of guessing from memory.

## What's Next

You now have the main release loop: render values, install or upgrade, inspect Helm history and status, verify Kubernetes objects, and roll back when a release revision needs recovery. That loop is the practical center of Helm operations for a service like `devpolaris-orders-api`.

The next packaging problem is chart growth. As more environments, toggles, and platform features appear, teams need to keep templates readable and avoid turning values into a maze. The next article focuses on avoiding template sprawl while keeping the chart useful.

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
