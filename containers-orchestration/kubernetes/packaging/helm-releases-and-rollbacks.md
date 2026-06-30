---
title: "Helm Releases and Rollbacks"
description: "Install, upgrade, inspect, and roll back Helm releases while verifying the Kubernetes objects they manage."
overview: "A Helm release is the cluster-side record created from a chart, values, and rendered manifests. `devpolaris-orders-api` moves through install, verification, upgrade history, manifest inspection, rollback, and failure recovery."
tags: ["helm", "releases", "rollback", "upgrade"]
order: 4
id: article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks
---
## Table of Contents

1. [The Helm Release Record](#the-helm-release-record)
2. [Install Revision One](#install-revision-one)
3. [Verify Kubernetes Output](#verify-kubernetes-output)
4. [Upgrade To Revision Two](#upgrade-to-revision-two)
5. [Inspect History Values And Manifests](#inspect-history-values-and-manifests)
6. [Roll Back To A Previous Revision](#roll-back-to-a-previous-revision)
7. [Recover From A Failed Upgrade](#recover-from-a-failed-upgrade)
8. [Use A Production Runbook](#use-a-production-runbook)
9. [What's Next](#whats-next)
10. [References](#references)

## The Helm Release Record
<!-- section-summary: A Helm release is the named install or upgrade record that connects a chart, values, rendered manifests, namespace, and revision history. -->

When Helm installs or upgrades a chart, it saves a named record in the target namespace. That record is the **Helm release**. It connects the release name, chart version, values, rendered manifests, namespace, status, and revision history.

That record matters after the first install. A production owner may need to answer which image tag is running, which chart produced the Deployment, which values were used, and which previous revision is safe to return to. Helm keeps those facts in the release history so the team has an operations trail during an upgrade or rollback.

The running example is `devpolaris-orders-api`. The team installs revision one, upgrades to a new image tag, verifies the Kubernetes objects, inspects Helm history, and rolls back when a later upgrade fails readiness checks. The first command gives Helm the release name, chart source, production values, and target namespace:

```bash
helm upgrade --install orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  -n devpolaris-prod
```

- `upgrade --install` tells Helm to upgrade the release if it already exists, or install it if it is new.
- `orders` is the release name operators will use later with `helm status`, `helm history`, and `helm rollback`.
- `./charts/orders-api` is the chart source that contains `Chart.yaml`, `values.yaml`, and templates.
- `-f environments/prod.values.yaml` supplies the production inputs, such as image tag, replica count, Service port, and resources.
- `-n devpolaris-prod` chooses the namespace where Kubernetes objects run and where Helm stores the release record.

The values file may look like this:

```yaml
replicaCount: 3
image:
  repository: ghcr.io/devpolaris/orders-api
  tag: "2026.06.16.1"
service:
  port: 80
```

Important points in these values:

- `replicaCount: 3` tells the Deployment how many Pods production should run.
- `image.repository` and `image.tag` identify the application build.
- `service.port: 80` sets the Service port callers use.
- Helm renders the chart with those values, sends the objects to Kubernetes, and records a release revision.

![Helm release timeline showing install revision one, upgrade revision two, rollback revision three, stored manifest, and namespace](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks/helm-release-timeline.png)

*A release record gives operators a named history of chart, values, and rendered manifest changes for one namespace.*

## Install Revision One
<!-- section-summary: The first install creates a named release and stores revision one for later inspection. -->

Revision one should be boring and well documented. It is the first cluster-side record for this release name, so later upgrades and rollbacks will refer back to it. The team should already know which chart source, values file, namespace, image tag, replica count, and Service port will reach Kubernetes. Rendering creates that evidence without changing the cluster.

The approval step needs concrete evidence before Helm stores the first revision. A `helm template` command renders the chart so reviewers can inspect the final YAML:

```bash
helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  -n devpolaris-prod \
  > rendered/orders-api-prod.yaml
```

Important points in this render command:

- `helm template` prints the manifests instead of touching the cluster.
- `orders` is the release name used during rendering.
- `-f environments/prod.values.yaml` supplies production values.
- `-n devpolaris-prod` sets the namespace used during rendering.
- `>` saves the output as a review artifact.

After approval, install the release:

```bash
helm upgrade --install orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  -n devpolaris-prod \
  --create-namespace \
  --wait \
  --timeout 5m
```

Important points in this install command:

- `helm upgrade --install` creates the release if it does not exist and updates it if it does.
- `--create-namespace` creates the namespace if it is missing.
- `--wait` tells Helm to wait for supported resources to reach a ready state before reporting success.
- `--timeout 5m` gives the release five minutes before Helm stops waiting and reports a timeout.

A successful install prints a release summary. The important fields are `STATUS: deployed`, which means Helm finished the operation successfully, and `REVISION: 1`, which means this is the first recorded release revision.

## Verify Kubernetes Output
<!-- section-summary: Helm success should be followed by Kubernetes checks for Deployment readiness, Pods, Services, and application smoke tests. -->

Helm reports the release operation, but operators still need to check the Kubernetes objects that run the application. The first useful check is Helm status:

This step separates the package manager view from the Kubernetes workload view. Helm can report that it completed the release operation, while the team still needs to confirm that the Deployment, Pods, Service, and application behavior are healthy. Helm status confirms the release record, and Kubernetes checks confirm the objects that carry traffic for the orders API.

```bash
helm status orders -n devpolaris-prod
```

Important points in this status command:

- `helm status orders` reads the named release record.
- `-n devpolaris-prod` reads the release record from the production namespace.
- The output should show the release name, namespace, `STATUS: deployed`, and the active revision.

```bash
NAME: orders
LAST DEPLOYED: Mon Jun 16 10:22:41 2026
NAMESPACE: devpolaris-prod
STATUS: deployed
REVISION: 1
TEST SUITE: None
```

- `STATUS: deployed` means Helm finished the install or upgrade successfully.
- `REVISION: 1` means Helm recorded the first saved state for this release.
- `NAMESPACE: devpolaris-prod` confirms the release record belongs to the production namespace.

Then check the Deployment:

```bash
kubectl get deployment orders-api -n devpolaris-prod
```

Important points in this Deployment check:

- `READY 3/3` means the Deployment has three ready Pods out of three requested.
- `UP-TO-DATE 3` means the Pods match the current Deployment template.
- `AVAILABLE 3` means Kubernetes considers all three available.

The rest of the verification can stay compact:

| Evidence | Command | What it proves |
|---|---|---|
| Helm release | `helm status orders -n devpolaris-prod` | Helm has an active deployed revision |
| Deployment | `kubectl get deployment orders-api -n devpolaris-prod` | Kubernetes has the requested ready count |
| Pods | `kubectl get pods -l app.kubernetes.io/name=orders-api -n devpolaris-prod` | The selected application Pods are running and ready |
| Service | `kubectl get service orders-api -n devpolaris-prod` | The stable network object exists and exposes the expected port |
| Smoke test | Team-specific health or API call | The application behavior works through the expected path |

![Release verification path showing helm upgrade, Deployment, ready Pods, working Service, and smoke test checks](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks/release-verification-path.png)

*A release review should move from Helm status to Kubernetes status and then to an application smoke test.*

## Upgrade To Revision Two
<!-- section-summary: A Helm upgrade applies a new rendered manifest and records the next release revision. -->

An upgrade usually changes one or more release inputs. The orders API team wants to move from image tag `2026.06.16.1` to `2026.06.16.2`.

Treat the upgrade as a new proposed state with review evidence. The values file changes the application build, Helm renders a new manifest from the chart and values, and Kubernetes rolls the Deployment toward the new Pod template. The reviewer should see the image tag change in rendered YAML before the upgrade, and the operator should watch rollout status after the upgrade.

```yaml
image:
  tag: "2026.06.16.2"
```

Important points in this values change:

- Only the image tag changes for this example upgrade.
- The chart and other production values stay the same.
- Reviewers should see the new tag in the rendered Deployment before the upgrade.

Render the proposed upgrade first:

```bash
helm template orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  -n devpolaris-prod \
  > rendered/orders-api-prod.yaml
```

Important points in this upgrade render:

- `helm template` renders the proposed revision without changing the cluster.
- The production values file should already contain the new image tag.
- The saved artifact lets reviewers confirm the Deployment image before the upgrade runs.

Then upgrade:

```bash
helm upgrade orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  -n devpolaris-prod \
  --wait \
  --timeout 5m
```

Important points in this upgrade command:

- `helm upgrade orders` updates the existing release named `orders`.
- The chart path and values file define the proposed new release state.
- `--wait` and `--timeout 5m` make Helm wait for readiness instead of returning as soon as objects are submitted.

Watch the Deployment rollout:

```bash
kubectl rollout status deployment/orders-api -n devpolaris-prod
```

Important points in this rollout command:

- `kubectl rollout status` watches the Deployment controller.
- `deployment/orders-api` selects the Deployment to watch.
- A success message means Kubernetes completed the Deployment update.

Helm should now show revision two:

```bash
helm history orders -n devpolaris-prod
```

```bash
REVISION  UPDATED                   STATUS      CHART             APP VERSION  DESCRIPTION
1         Mon Jun 16 10:22:41 2026  superseded  orders-api-0.1.0  2026.06.16.1 Install complete
2         Mon Jun 16 11:08:03 2026  deployed    orders-api-0.1.1  2026.06.16.2 Upgrade complete
```

Important points in this history output:

- The `deployed` row is the active release state.
- The older `superseded` row remains available for inspection or rollback.
- The `APP VERSION` column shows which application version each revision recorded.

## Inspect History Values And Manifests
<!-- section-summary: Helm inspection commands show which revisions exist, which values were recorded, and which manifests Helm stored. -->

During an incident, operators need facts before changing the release. Helm gives three useful inspection commands.

These commands answer different questions. History shows which revisions exist and which one is active. Values show the recorded release inputs Helm used. Manifest output shows the Kubernetes YAML stored with the release record. For the orders API, this means an operator can confirm the image tag, replica count, chart version, and Service wiring before deciding whether to roll forward, roll back, or investigate the Pods.

```bash
helm history orders -n devpolaris-prod
```

Important points in this history command:

- It shows the revision list recorded by Helm.
- It includes status, chart version, application version, and release description.
- It helps operators choose a rollback target from real release history.

```bash
helm get values orders -n devpolaris-prod
```

Important points in this values command:

- It prints the values recorded for the active release.
- Operators can confirm image tag, replica count, resource choices, and route input.
- Recorded values help separate a values problem from a Kubernetes runtime problem.

```bash
helm get manifest orders -n devpolaris-prod
```

Important points in this manifest command:

- It prints the rendered Kubernetes manifests stored in the active release.
- It helps when chart source has changed since the release.
- It lets the team compare what Helm thinks it manages with what Kubernetes currently reports.

These commands should be part of the normal support path. They answer, "What did Helm release?" before the team asks, "What are the Pods doing?"

## Roll Back To A Previous Revision
<!-- section-summary: Helm rollback creates a new revision from a previous release revision and should still be verified through Kubernetes status. -->

A **rollback** tells Helm to return a release to a previous revision. If revision two introduced a bad image, the team can roll back to revision one:

Rollback is a release operation with its own verification step. Helm reads the stored manifest and values from the target revision, applies that state again, and records a new revision for the rollback. The team should choose the target revision from history, run rollback with a wait and timeout, then verify the Deployment and application path just like an upgrade.

```bash
helm rollback orders 1 -n devpolaris-prod --wait --timeout 5m
```

Important points in this rollback command:

- `orders` is the release name.
- `1` is the target revision from `helm history`.
- `--wait` and `--timeout 5m` make Helm wait for supported resources to reach readiness.

```bash
Rollback was a success! Happy Helming!
```

Important points in this rollback message:

- Helm accepted the rollback request.
- A rollback still needs history and Kubernetes readiness checks.
- Helm creates a new revision for the rollback operation.

After rolling back revision two to revision one, history should show revision three as `deployed` with the old chart and application version. Revision three is active because rollback is itself a release operation. Verify Kubernetes after rollback:

```bash
helm history orders -n devpolaris-prod
```

```bash
REVISION  UPDATED                   STATUS      CHART             APP VERSION  DESCRIPTION
1         Mon Jun 16 10:22:41 2026  superseded  orders-api-0.1.0  2026.06.16.1 Install complete
2         Mon Jun 16 11:08:03 2026  superseded  orders-api-0.1.1  2026.06.16.2 Upgrade complete
3         Mon Jun 16 11:19:54 2026  deployed    orders-api-0.1.0  2026.06.16.1 Rollback to 1
```

Important points in this rollback history:

- Revision three is active because rollback created a new release revision.
- The active row points back to the old chart and application version.
- The earlier revisions remain in history for audit and support.

```bash
kubectl rollout status deployment/orders-api -n devpolaris-prod
kubectl get deployment orders-api -n devpolaris-prod
```

Important points in these verification commands:

- `kubectl rollout status` confirms the Deployment controller finished the rollback rollout.
- `kubectl get deployment` confirms the ready count after rollback.
- The application smoke test should still run after these Kubernetes checks.

## Recover From A Failed Upgrade
<!-- section-summary: Failed upgrades need fast evidence gathering, clear rollback criteria, and verification after recovery. -->

Imagine revision four changes the image tag to `2026.06.16.3`, but the new Pods fail readiness. Helm waits five minutes and reports a timeout.

This failure path is common because Helm can submit valid Kubernetes objects that still produce unhealthy Pods. The chart may render correctly, the API server may accept the Deployment, and the application may still fail readiness because of a bad image, missing config, failed database connection, or incompatible startup change. The recovery path should gather enough evidence to avoid guessing, then roll back when production health needs the previous known-good state.

```bash
helm upgrade orders ./charts/orders-api \
  -f environments/prod.values.yaml \
  -n devpolaris-prod \
  --wait \
  --timeout 5m
```

```bash
Error: UPGRADE FAILED: timed out waiting for the condition
```

Important points in this failure output:

- Helm submitted the upgrade.
- The watched resources did not reach the expected ready state before the timeout.
- `helm history` should now show a failed revision.

```bash
helm history orders -n devpolaris-prod
```

```bash
REVISION  UPDATED                   STATUS      CHART             APP VERSION  DESCRIPTION
3         Mon Jun 16 11:19:54 2026  superseded  orders-api-0.1.0  2026.06.16.1 Rollback to 1
4         Mon Jun 16 11:42:07 2026  failed      orders-api-0.1.2  2026.06.16.3 Upgrade failed: timed out waiting for the condition
```

Important points in this failed history:

- Revision four records the failed upgrade.
- Revision three is the previous known-good revision in this example.
- The chart and app version columns help operators confirm what changed.

Read Kubernetes evidence before choosing the recovery action:

```bash
kubectl get pods -l app.kubernetes.io/name=orders-api -n devpolaris-prod
kubectl describe deployment orders-api -n devpolaris-prod
kubectl logs deployment/orders-api -n devpolaris-prod --tail=80
```

Important points in these evidence commands:

- `kubectl get pods` shows Pod readiness and restarts.
- `kubectl describe deployment` shows events and rollout conditions.
- `kubectl logs deployment/orders-api --tail=80` prints recent logs from Pods selected by the Deployment.

If the release is hurting production, roll back:

```bash
helm rollback orders 3 -n devpolaris-prod --wait --timeout 5m
```

Important points in this rollback command:

- `orders` is the release that failed.
- `3` is the previous known-good revision in the example history.
- `--wait --timeout 5m` makes the rollback wait for readiness before reporting success or timeout.

![Rollback on failure flow showing unready Pods, wait timeout, rollback-on-failure recovery, previous revision, and release record](/content-assets/articles/article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks/rollback-on-failure.png)

*A failed upgrade should lead to evidence, rollback criteria, rollback execution, and post-rollback verification.*

Some teams use Helm's `--rollback-on-failure` flag during upgrade. That can help automation recover from a failed upgrade, and teams still need to review evidence afterward so the same failure is not repeated.

## Use A Production Runbook
<!-- section-summary: A release runbook keeps install, upgrade, verification, rollback, and evidence steps consistent. -->

A runbook keeps the release path predictable. For the orders API, the production flow can look like this:

The runbook is for the moment when speed and accuracy both matter. It keeps the namespace, release name, values file, timeout, verification commands, and rollback target in one place. A good runbook also tells the operator which evidence to save after the release, so a later incident review can connect chart source, values, rendered manifests, Helm revision, and application health.

For beginners, this turns release work into a repeatable path instead of a set of commands remembered under pressure.

```yaml
BeforeRelease:
  - render Helm output for production
  - review Deployment, Service, ConfigMap, and route changes
  - run helm lint with production values
  - run server-side dry run against the target cluster
Release:
  - run helm upgrade with --wait and a clear timeout
  - watch Deployment rollout status
  - run application smoke test
AfterRelease:
  - record Helm revision
  - save rendered manifest artifact
Rollback:
  - choose previous known-good revision
  - run helm rollback with --wait
  - verify Deployment readiness and smoke test
```

Important points in this runbook:

- `BeforeRelease` gathers evidence before the cluster changes.
- `Release` uses Helm wait behavior plus Kubernetes rollout checks.
- `AfterRelease` records the revision and rendered manifest for later support.
- `Rollback` names the previous known-good path before an incident happens.

The runbook should include the exact namespace, release name, chart source, values file, timeout, smoke test, and rollback target. During an incident, operators should not have to reconstruct those details from memory.

## What's Next

You now have the Helm release loop: render, install or upgrade, verify Kubernetes, inspect history, and roll back with evidence. The next packaging article switches to Kustomize, where valid YAML bases and overlays produce environment-specific manifests without Helm release records.

## References

- [Helm Install](https://helm.sh/docs/helm/helm_install/) - Official command reference for installing charts, values files, namespaces, wait behavior, and rollback-on-failure behavior.
- [Helm Upgrade](https://helm.sh/docs/helm/helm_upgrade/) - Official command reference for upgrades, values files, `--wait`, `--timeout`, and `--rollback-on-failure`.
- [Helm History](https://helm.sh/docs/helm/helm_history/) - Official command reference for release revision history.
- [Helm Status](https://helm.sh/docs/helm/helm_status/) - Official command reference for release status.
- [Helm Get Values](https://helm.sh/docs/helm/helm_get_values/) - Official command reference for inspecting recorded release values.
- [Helm Get Manifest](https://helm.sh/docs/helm/helm_get_manifest/) - Official command reference for inspecting rendered manifests stored in a release.
- [Helm Rollback](https://helm.sh/docs/helm/helm_rollback/) - Official command reference for rolling a release back to a previous revision.
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official Kubernetes documentation for Deployment rollout behavior and status checks.
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Official Kubernetes guide to stable networking for Pods.
