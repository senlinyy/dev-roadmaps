---
title: "Helm Releases and Rollbacks"
description: "Install, upgrade, inspect, and roll back Helm releases while verifying the Kubernetes objects they manage."
overview: "A Helm release gives one named chart installation an identity and an ordered history while Kubernetes maintains the current state of the individual objects."
tags: ["helm", "releases", "rollback", "upgrade"]
order: 4
id: article-containers-orchestration-kubernetes-packaging-helm-releases-and-rollbacks
---

## Table of Contents

1. [How does a chart gain a release identity?](#how-does-a-chart-gain-a-release-identity)
2. [Where does Helm keep release history, and what can it contain?](#where-does-helm-keep-release-history-and-what-can-it-contain)
3. [How does the first install become revision one?](#how-does-the-first-install-become-revision-one)
4. [What changes when an upgrade creates the next revision?](#what-changes-when-an-upgrade-creates-the-next-revision)
5. [How do Helm records and Kubernetes status answer different questions?](#how-do-helm-records-and-kubernetes-status-answer-different-questions)
6. [What happens when Helm rolls back to an earlier revision?](#what-happens-when-helm-rolls-back-to-an-earlier-revision)
7. [When should automated rollback accompany an upgrade?](#when-should-automated-rollback-accompany-an-upgrade)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

Kubernetes maintains the desired state of individual objects. Helm adds application-level identity and history for a collection of those objects. It renders manifests, sends them to Kubernetes, and records what that named installation attempted to deploy.

The deepest distinction is that Helm both sends objects and remembers what it sent. Kubernetes can tell you what a Deployment looks like now; Helm can tell you which named application-level operation produced a recorded collection of Deployments, Services, ConfigMaps, and other resources.

```text
chart + values + release context
              ↓
         Helm renderer
              ↓
      Kubernetes manifests
          ┌───┴───┐
          ↓       ↓
 Kubernetes API   Helm release record
 current objects  historical release intent
```

The render result depends not only on chart files and values, but also on release identity and available cluster capabilities used by templates. Helm then manages two related outputs: the API objects sent to Kubernetes and the history record used to explain or revisit that operation.

Keep these questions in view as you work through the lesson:

1. **How does a chart gain a release identity?**
2. **Where does Helm keep release history, and what can it contain?**
3. **How does the first install become revision one?**
4. **What changes when an upgrade creates the next revision?**
5. **How do Helm records and Kubernetes status answer different questions?**
6. **What happens when Helm rolls back to an earlier revision?**
7. **When should automated rollback accompany an upgrade?**

## How does a chart gain a release identity?
<!-- section-summary: Installing a reusable chart under a release name and namespace creates one long-lived Helm-managed application instance. -->

Keep four counters separate:

- chart version: the version of the packaging definition;
- chart `appVersion`: metadata about the represented application;
- Helm revision: the ordered history of one release;
- Deployment revision: the controller's own rollout history.

### Chart, release, and revision answer different identity questions

A **chart** is reusable packaging and template source. It has no production identity by itself. A **release** is one installation of that chart, normally identified by release name and namespace. A **revision** is one ordered Helm operation within that release's lifetime.

The counters can legitimately look like:

```text
Helm revision        8
chart version        2.4.0
chart appVersion     7.1.2
Deployment revision 13
```

Revision 8 does not imply application version 8 or chart version 8. It says that seven earlier Helm release operations preceded the current one.

The same chart can be installed several times:

```bash
helm install payments-prod ./payments
helm install payments-canary ./payments
helm install payments-dev ./payments
```

Each is a different release. A release identity is approximately its name plus namespace, such as `prod/payments`.

For:

```bash
helm install payments ./payments-chart --namespace prod
```

templates receive:

```text
.Release.Name       = payments
.Release.Namespace  = prod
.Release.Revision   = 1
.Release.IsInstall  = true
```

The release name identifies this installation, not the reusable chart. Helm also marks managed resources with release ownership annotations and the Helm managed-by label.

Installing the same chart as `payments-prod` and `payments-canary` gives each invocation its own values, namespace, generated names, and history. Release identity is the stable application-level thread joining those operations.

### Build identity from reusable source to one running instance

Suppose `payments-chart` has chart version `2.4.0` and `appVersion: 7.1.2`. Those values describe the reusable package and its application metadata. They do not say whether the chart is installed, where it runs, or what this installation is called.

Installing it creates that missing identity:

```text
reusable payments chart
├─ install as prod/payments        → release A, revision 1
├─ install as prod/payments-canary → release B, revision 1
└─ install as dev/payments         → release C, revision 1
```

Each release can move through upgrades and rollbacks independently. The chart can use `.Release.Name` to render `payments` for the first installation and `payments-canary` for the second. Ownership annotations and the managed-by label let Helm distinguish their resources even when the underlying object kinds are the same.

Revision belongs inside one release. It starts at one and increases as that named installation undergoes operations. A Deployment controller has its own rollout revision because it tracks ReplicaSet history for one Deployment. Treating either counter as the application version loses the identity question each was designed to answer.

## Where does Helm keep release history, and what can it contain?
<!-- section-summary: Helm's storage driver persists release records in the cluster; the default Secret records contain enough chart, values, manifest, hook, identity, and status data to reconstruct history. -->

With the default storage backend, Helm keeps release records as Secrets in the release namespace; other storage drivers are also supported:

```text
sh.helm.release.v1.payments.v1
sh.helm.release.v1.payments.v2
sh.helm.release.v1.payments.v3
```

```bash
kubectl get secrets -n prod -l owner=helm
helm history payments -n prod
```

A record can include release name, namespace, chart, user configuration, rendered manifest, hooks, revision, and status. Helm therefore has application-level historical intent even though Kubernetes itself does not maintain that exact release abstraction.

### One record preserves enough intent to explain a revision

Conceptually, a revision Secret contains:

```text
release record v3
├── release name and namespace
├── chart used
├── supplied configuration
├── rendered manifest
├── hooks
├── revision number
└── operation status
```

This is why `helm history`, historical manifests, and historical values exist without Kubernetes providing an application snapshot abstraction. It also explains why the records deserve security controls: chart values and manifests can carry sensitive material.

Release records can contain charts and values, including sensitive data that passed through them. Restrict Secret access and use appropriate encryption-at-rest controls.

History is finite when retention is limited. Current rollback command documentation uses a default history limit of 10, while 0 means unlimited. Removing an old record also removes Helm's ability to use it as rollback material, so retention is an operational recovery choice.

### See history as stored release material, not a label on live objects

After three operations, the `prod` namespace can contain records conceptually shaped like:

```text
payments.v1
├─ chart and supplied values for install
├─ rendered Deployment and Service
└─ status and revision 1

payments.v2
├─ chart and supplied values for first upgrade
├─ newly rendered release manifest
└─ status and revision 2

payments.v3
├─ chart and supplied values for next operation
├─ rendered release manifest and hooks
└─ status and revision 3
```

`helm history` can enumerate this sequence because Helm reads its own release records; it is not asking the Deployment controller to reconstruct a multi-object application history. A release owning resources from several API groups makes this distinction important.

Storage also establishes two operational obligations. First, access to the release records can expose configuration and rendered content, so Kubernetes Secret access and encryption at rest matter. Second, retention determines which historical states remain available as rollback inputs. Unlimited retention preserves more recovery material but accumulates records; pruning history reduces that material. Choose the trade deliberately rather than treating the storage backend as an implementation detail.

Protecting history and being able to use it are separate requirements. A rollback candidate should be inspected before an incident: confirm the revision exists within retention, inspect its manifest and values, identify its chart and application versions, and determine which external-state assumptions it carries. A record may be technically available yet unsafe because its binary no longer understands the database schema or dependent protocol.

This turns release history into prepared recovery evidence rather than a list of numbers. Operators can state which earlier revision represents the intended Kubernetes state, what changed after it, and which application checks must pass if that state is redeployed. The rollback command supplies the mechanism; this compatibility analysis supplies the safety case.

Record the selected revision beside the incident evidence and verify the new revision created by rollback. That keeps the chronological operation, recovered Kubernetes intent, and user-facing recovery proof connected.
Also preserve the command inputs and timeout behavior, because they determine what Helm waited for and which recovery operation it attempted.
That evidence prevents a later status label from replacing the actual operation timeline.

## How does the first install become revision one?
<!-- section-summary: Install merges values, creates release context, renders and submits objects, and then records the first state under one release identity. -->

```bash
helm install payments ./payments-chart \
  -n prod \
  --set image.tag=1.0
```

Conceptually:

1. Helm loads the chart.
2. It merges the values.
3. It sets `Release.Name`, `Namespace`, and `Revision=1`.
4. It renders the templates into manifests.
5. It sends those resources to Kubernetes.
6. It records Helm revision 1.

### Install produces two related records of the event

Revision one might record chart `payments-1.0.0`, value `image.tag=1.0`, a Deployment using `payments:1.0`, a Service, and status `deployed`. Kubernetes separately holds Deployment `payments` and Service `payments`.

Those are two views of the same operation: Helm records release intent and Kubernetes holds current resource state.

For example, revision one can remember `image.tag=1.0` and the complete rendered Deployment and Service. Kubernetes stores those objects individually and its controllers begin reconciling them. Helm's `deployed` status describes the install operation; Kubernetes status describes what the workload is doing afterward.

Walk the two outputs with a concrete example:

```text
chart default: replicas = 3
command value: image.tag = 1.0
release name:  payments
namespace:     prod
revision:      1
```

The rendered manifest can contain Deployment `payments` with image `payments:1.0` and three replicas, plus Service `payments` on port 8080. Helm submits those objects. Kubernetes persists them and its Deployment and Service controllers begin their own reconciliation. Separately, Helm records that the `prod/payments` install used this chart, configuration, manifest, hooks, and status as revision one.

The release record is therefore not a second running copy of the Deployment. It is Helm's historical representation of the application-level operation. Kubernetes remains responsible for making the actual Deployment and Service state real.

## What changes when an upgrade creates the next revision?
<!-- section-summary: Upgrade keeps the release identity, renders new intent as revision N plus one, and reconciles old Helm intent, live state, and the new manifest. -->

```bash
helm upgrade payments ./payments-chart \
  -n prod \
  --set image.tag=2.0
```

If revision one was current, Helm creates revision two. It does not edit revision one in place.

Upgrade has three relevant states:

```text
A = previous Helm manifest
B = current live Kubernetes object
C = newly rendered Helm manifest
```

Live state may differ because a user or another controller changed it. Helm's upgrade machinery accounts for previous intent, live state, and new intent through three-way merge behavior, and newer Helm can also use server-side apply.

### An upgrade moves forward through history

If revision one uses `payments:1.0` and the new inputs select `payments:2.0`, Helm renders a new desired release state and assigns revision two before reconciling it. Revision one remains historical material. A successful operation marks the old revision superseded and the new one deployed.

The three-state model matters when live state drifted. Previous Helm intent might say three replicas, the current Deployment might have been manually scaled to five, and new Helm intent might say four. Upgrade is a reconciliation among previous ownership, present cluster state, and the newly rendered result—not blind replacement of an isolated file.

After success:

```text
revision 1  superseded
revision 2  deployed
```

The Helm revision is a monotonically increasing sequence number for release operations, not an application or chart version.

### Use previous intent, live state, and new intent as three separate inputs

Assume revision one recorded three replicas. An operator manually scales the live Deployment to five, then the next values request four:

```text
A: previous Helm manifest → replicas 3
B: current live object    → replicas 5
C: new rendered manifest  → replicas 4
```

A two-way replacement that considered only C could not distinguish a user's live change from fields previously managed by Helm. Three-way merge behavior gives the upgrade machinery the previous release, current resource, and desired release as context. Newer Helm can also use server-side apply, but the first-principles question remains the same: what did Helm previously intend, what exists now, and what does this operation intend next?

If the operation succeeds, revision one is preserved and marked superseded while revision two becomes deployed. The old record is not mutated into the new one. That append-only mental model explains both chronological history and later rollback behavior.

## How do Helm records and Kubernetes status answer different questions?
<!-- section-summary: Helm history describes what a release operation recorded, while the Kubernetes API and controllers describe present desired and runtime state. -->

Suppose Helm revision four rendered three replicas of `payments:4.0`. Later:

```bash
kubectl scale deployment payments --replicas=10
```

`kubectl get deployment payments` can report ten replicas, while `helm get manifest payments` still shows the three replicas recorded by Helm revision four. Both are correct.

| System | Question |
|---|---|
| Kubernetes API | What desired object exists now? |
| Kubernetes controller status | Is the workload converging and running? |
| Helm history | What state did a release revision represent? |
| Helm status | What happened during the Helm operation? |

`helm status` reporting `deployed` does not guarantee that the application remains healthy forever. Pods can crash, dependencies can fail, Nodes can disappear, resources can be edited, and other controllers can mutate state later.

During an incident, keep Git commit, chart version, Helm revision, Deployment revision, and image identity separate. Inspect a historical manifest and values, then compare them with the live Deployment and Pods.

### Keep three histories and runtime evidence separate

Git history explains how source and declared inputs changed. Helm history explains which release operations and rendered states were recorded. Kubernetes live state explains what objects currently exist, while controller status and Pods explain whether that state is running successfully.

```bash
helm history payments -n prod
helm get manifest payments -n prod --revision 16
helm get values payments -n prod --revision 16
kubectl get deployment payments -n prod -o yaml
kubectl get pods -n prod
```

The results can differ without contradiction. The task is to identify which history or runtime layer contains the unexpected state.

Use the layers as an incident sequence. Begin with `helm history` to identify the release operation and its revision. Inspect the historical values and manifest to learn what Helm recorded. Compare those objects with live YAML to reveal manual change, another controller's mutation, or a later operation. Finally inspect Deployment status, ReplicaSets, Pods, Events, logs, and the user request path to learn whether the live state is healthy.

```text
source history → why declared input changed
Helm history   → what release operation recorded
live objects   → what desired state exists now
controller     → whether resources converged
application    → whether the user-visible behavior works
```

Skipping directly from `helm status: deployed` to “the application is healthy” collapses all five boundaries. Helm can complete an operation, after which a Node disappears, a dependency fails, or a process crashes. Release status and continuing runtime health are related evidence, not synonyms.

## What happens when Helm rolls back to an earlier revision?
<!-- section-summary: Rollback creates a new revision whose desired manifests come from an older record; it does not rewind history or restore external application state. -->

Given:

```text
rev 1  state A
rev 2  state B
rev 3  state C
```

this command:

```bash
helm rollback payments 1 -n prod
```

creates revision four based on state A:

```text
rev 1  install A
rev 2  upgrade B
rev 3  upgrade C
rev 4  rollback A  ← deployed
```

Helm retrieves the old chart, configuration, manifest, and hooks, constructs a new release record with the next revision, and reconciles Kubernetes toward that desired state. Rollback is a new deployment event, which preserves the audit trail.

### Follow a complete release timeline

```text
rev 1  install   state A
rev 2  upgrade   state B
rev 3  upgrade   state C
rev 4  rollback  state A
rev 5  upgrade   state D
```

The revision number is a monotonically increasing operation sequence. Rollback to revision one at revision three does not make one current again; it creates revision four whose desired manifests come from one. This preserves the fact that C was attempted and then deliberately replaced by A.

### Rollback restores managed intent, not the outside world

It is not an etcd snapshot or transaction rollback. Helm can restore managed Deployments, ConfigMaps, Services, and other manifest state, but it cannot automatically undo a database migration, data written to a PVC, messages, emails, or external cloud changes. Pre- and post-rollback hooks can perform explicit lifecycle work, but the application must remain compatible with external state.

`kubectl rollout undo deployment/payments` changes one Deployment. `helm rollback` operates across the Helm release, which may also include Services, ConfigMaps, Ingresses, ServiceAccounts, and Roles.

This difference matters when one upgrade changed several coordinated objects:

```text
Deployment image → version 3
ConfigMap format  → version 3
Service port      → new port
Ingress route     → new Service port
```

Undoing only the Deployment can combine the old image with the new configuration, Service, and route. Helm rollback uses an earlier release record as the desired source for the whole Helm-managed object collection, so it can restore those resources coherently as a new operation.

The boundary stops at managed Kubernetes intent. A database schema, data written to persistent storage, published message, sent email, or external cloud operation is not reconstructed from the release manifest. Hooks can perform explicit rollback work, but they are application logic and must be designed and tested. A successful Helm rollback can therefore coexist with a broken application when the restored binary is incompatible with external state left by the failed version.

## When should automated rollback accompany an upgrade?
<!-- section-summary: Automated rollback fits changes whose success is captured by Helm's wait conditions and whose previous application remains compatible with any state changed by the candidate. -->

When Kubernetes readiness accurately represents success, automated rollback can contain a failed candidate:

```bash
helm upgrade payments ./chart --rollback-on-failure
```

If revision two is healthy and revision three never becomes Ready, history can show revision three as failed and revision four as a rollback to revision two's state. The failed attempt remains visible.

### Automated recovery depends on meaningful success signals

Readiness must represent the application's ability to serve, not merely that its process started. When new Pods never become Ready, Helm can observe failure during its wait window and invoke rollback. This is strong containment for a stateless image or configuration change whose success is visible through Kubernetes readiness.

This works well for stateless services, web APIs, workers with backward-compatible protocols, configuration changes, image upgrades, and applications with meaningful readiness probes.

It can give false confidence when the candidate performs an incompatible database migration or changes external state. Helm may restore the old manifests successfully while the old binary cannot read the new schema. Use backward-compatible expand-deploy-migrate-contract sequences when older and newer versions must coexist or recover safely.

Automated Helm rollback is a deployment recovery mechanism, not an ACID transaction. Confirm both Helm's new deployed revision and the application's real request path.

The complete proof is therefore: the failed revision is recorded, a later rollback revision is deployed, Kubernetes objects converge to the intended earlier manifest state, compatible application instances become Ready, and the same user-facing operation succeeds again. A green Helm status alone proves only part of that chain.

### Read automated rollback as another forward operation

Suppose revision two is healthy and revision three contains a bad image:

```text
rev 2 deployed, application healthy
        ↓ upgrade with rollback on failure
rev 3 candidate submitted
        ↓ Pods fail meaningful readiness until failure
rev 3 recorded as failed
        ↓ automatic rollback invokes previous successful state
rev 4 created from rev 2 material and deployed
```

The failure is not erased. History preserves both the attempted candidate and the recovery operation, which makes the sequence auditable. Waiting is essential: Helm needs an observable failure condition during the operation rather than declaring success immediately after submitting objects.

Readiness quality determines what can be observed. A readiness probe that merely reports a live process may accept an application that cannot reach a required dependency or serve its real path. Conversely, a meaningful readiness failure can make automated rollback effective containment for stateless services, compatible workers, image changes, or configuration changes.

External state determines whether returning to the earlier Kubernetes manifests is safe. Prefer migrations that preserve coexistence:

```text
expand schema compatibly
→ deploy code that handles old and new forms
→ migrate data
→ remove old form in a later release
```

An immediate destructive schema change can make the old binary unusable, even when Helm restores every managed resource exactly. Automated rollback is strongest when Helm's wait conditions represent real success and old and new versions remain compatible with every state the candidate can change.

## Check Your Answers
<!-- section-summary: Rebuild the release model from identity, stored history, install, upgrade, live-state separation, forward-moving rollback, and automation boundaries. -->

:::expand[How does a chart gain a release identity?]{kind="recap"}
Installing a chart with a release name and namespace creates one named instance. The same chart can create many independent releases.
:::

:::expand[Where does Helm keep release history, and what can it contain?]{kind="recap"}
The default driver stores release records as namespace Secrets containing chart, values, rendered manifests, hooks, revision, identity, and status. Protect and retain them deliberately.
:::

:::expand[How does the first install become revision one?]{kind="recap"}
Helm merges values, builds release context, renders and submits manifests, and stores the result as revision one.
:::

:::expand[What changes when an upgrade creates the next revision?]{kind="recap"}
The release identity remains, while Helm reconciles previous intent, live state, and new intent and records revision N plus one.
:::

:::expand[How do Helm records and Kubernetes status answer different questions?]{kind="recap"}
Helm describes release-operation history. Kubernetes describes current resource desired state and controller/runtime convergence. The answers can differ legitimately.
:::

:::expand[What happens when Helm rolls back to an earlier revision?]{kind="recap"}
Helm deploys the old release state as a new, higher revision. It restores managed configuration, not databases, PVC data, messages, or other external effects.
:::

:::expand[When should automated rollback accompany an upgrade?]{kind="recap"}
Use it when readiness captures success and the prior version remains compatible with changed state. Always verify the real application path after rollback.
:::

## References

- [Helm glossary](https://helm.sh/docs/glossary/)
- [Helm history](https://helm.sh/docs/helm/helm_history/)
- [Helm rollback](https://helm.sh/docs/helm/helm_rollback/)
- [Helm upgrade](https://helm.sh/docs/helm/helm_upgrade/)
- [Helm storage backends](https://helm.sh/docs/topics/advanced/#storage-backends)
