---
title: "Rollouts and Rollbacks"
description: "Update Kubernetes workloads safely, inspect rollout progress, and roll back a bad Deployment revision."
overview: "Deployment rollouts move from one Pod template to another through old and new ReplicaSets, while pacing, readiness, revision history, and recovery boundaries determine how safely the change reaches users."
tags: ["rollouts", "rollback", "deployments", "kubectl"]
order: 6
id: article-containers-orchestration-kubernetes-workloads-rollouts-and-rollbacks
---

## Table of Contents

1. [What changes when a Deployment rolls out a new Pod template?](#what-changes-when-a-deployment-rolls-out-a-new-pod-template)
2. [Why does a Deployment keep old and new ReplicaSets during replacement?](#why-does-a-deployment-keep-old-and-new-replicasets-during-replacement)
3. [How do maxSurge, maxUnavailable, readiness, and minReadySeconds control the pace?](#how-do-maxsurge-maxunavailable-readiness-and-minreadyseconds-control-the-pace)
4. [How can you tell whether a rollout is progressing, complete, or stalled?](#how-can-you-tell-whether-a-rollout-is-progressing-complete-or-stalled)
5. [When should you patch forward, pause, restart, or roll back?](#when-should-you-patch-forward-pause-restart-or-roll-back)
6. [What does a Deployment rollback restore, and which changes need separate recovery?](#what-does-a-deployment-rollback-restore-and-which-changes-need-separate-recovery)
7. [How do you verify the workload and the user-facing behavior after a release or rollback?](#how-do-you-verify-the-workload-and-the-user-facing-behavior-after-a-release-or-rollback)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

At first principles, a Kubernetes rollout changes the desired Pod template and safely replaces one population of Pods with another. Kubernetes does not open each running container and update its image in place.

The controller relationship is:

> **Deployment → old and new ReplicaSets → old and new Pods**

A Deployment says that the desired template is now `v2`. One ReplicaSet still represents template `v1`, while another represents template `v2`. The Deployment controller gradually moves capacity from the old ReplicaSet to the new one.

Only a change under `.spec.template` creates a new rollout revision. Changing `.spec.replicas` asks the current template for a different number of Pods, so that change is scaling.

The central model is:

> **A rollout changes the desired Pod template. ReplicaSets preserve template generations. Readiness tells the controller when new capacity is useful.**

The model separates three changes that are easy to confuse:

```text
scale replicas 4 → 6     → same template generation, larger population
change image v1 → v2     → new template generation and rollout
restart current template → new Pod instances without choosing an older application template
```

All three may create or delete Pods, but the desired-state reason and recovery meaning are different.

The article follows seven questions:

1. **What changes when a Deployment rolls out a new Pod template?**
2. **Why does a Deployment keep old and new ReplicaSets during replacement?**
3. **How do maxSurge, maxUnavailable, readiness, and minReadySeconds control the pace?**
4. **How can you tell whether a rollout is progressing, complete, or stalled?**
5. **When should you patch forward, pause, restart, or roll back?**
6. **What does a Deployment rollback restore, and which changes need separate recovery?**
7. **How do you verify the workload and the user-facing behavior after a release or rollback?**

## What changes when a Deployment rolls out a new Pod template?
<!-- section-summary: A new Pod template creates a new ReplicaSet and a replacement population of Pods. -->

### A release replaces a population instead of editing processes in place

Start with a four-replica Deployment:

```yaml
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: api
          image: my-api:v1
```

Changing the image to `my-api:v2` changes `.spec.template`. Existing Pods still represent `v1`, so the Deployment creates new Pods from `v2` and retires the old Pods over time.

Before the change, one ReplicaSet owns four `v1` Pods. Early in the rollout, that old ReplicaSet may still own all four while a new ReplicaSet starts one `v2` Pod. At completion, the old ReplicaSet has zero desired replicas and the new ReplicaSet owns four available `v2` Pods.

This gives each object a precise role:

| Object | What it represents |
|---|---|
| Deployment | the desired release and replica count |
| ReplicaSet | one concrete Pod-template generation |
| Pod | one running instance of that generation |

The Deployment controller therefore solves a population-replacement problem: the cluster currently has instances of template `v1`, desired state now says `v2`, and the change should happen without losing too much working capacity.

## Why does a Deployment keep old and new ReplicaSets during replacement?
<!-- section-summary: Separate ReplicaSets let Kubernetes represent two template generations at the same time and move capacity between them. -->

### ReplicaSets make both generations explicit

Kubernetes needs both generations during a rolling release. With four desired replicas, the populations might move through states like these:

| Stage | Old ReplicaSet `v1` | New ReplicaSet `v2` |
|---|---:|---:|
| Before rollout | 4 | 0 |
| New generation begins | 4 | 1 starting |
| Handoff | 3 | 2 |
| Later handoff | 2 | 3 |
| Complete | 0 | 4 |

The Deployment controller changes ReplicaSet replica counts. Each ReplicaSet controller then creates or deletes Pods until its own actual population matches that count.

Each distinct Pod template receives a `pod-template-hash`. This hash labels the ReplicaSet and its Pods so the generations do not become mixed. It also makes the ownership visible when you inspect ReplicaSets and Pods.

After a successful rollout, the old ReplicaSet usually remains with zero replicas. Keeping the object preserves an earlier Pod-template revision and provides the history used by Deployment rollback. The Deployment's `revisionHistoryLimit` controls how many old ReplicaSets are retained; its default is 10. Setting it to 0 allows old history to be removed after cleanup and removes the Deployment's ability to return to those revisions.

### Read the Deployment as an orchestrator of populations

The Deployment controller does not directly keep every Pod count by itself. It assigns desired sizes to generation-specific ReplicaSets:

```text
Deployment: desired template v2, desired population 4
├─ ReplicaSet for hash of v1 → shrink toward 0
└─ ReplicaSet for hash of v2 → grow toward 4
```

Each ReplicaSet controller then reconciles its assigned population. The hash labels keep a v1 Pod from being mistaken for a v2 Pod even when both match the application's stable Service selector.

Retained zero-sized ReplicaSets are therefore more than clutter. They connect revision history to concrete Pod templates. Before relying on rollback, verify that the intended revision remains inside `revisionHistoryLimit`; a revision pruned from history cannot be reconstructed by the Deployment controller merely because the image still exists somewhere.

![A four-replica Deployment moving desired capacity from an old ReplicaSet with v1 Pods to a new ReplicaSet with v2 Pods while a Service uses ready Pods](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-rollouts-and-rollbacks/rollout-replacement-flow.png)

*Old and new ReplicaSets coexist so Kubernetes can replace a population gradually.*

## How do maxSurge, maxUnavailable, readiness, and minReadySeconds control the pace?
<!-- section-summary: Surge and unavailability define the rollout's capacity envelope, while readiness defines when new capacity can be trusted. -->

### Capacity limits define the safe operating region

`maxSurge` answers how much extra capacity Kubernetes may create during the handoff. `maxUnavailable` answers how much desired capacity may temporarily be unavailable.

For this strategy:

```yaml
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
```

the rollout normally works inside this envelope:

```text
Minimum available capacity: 4 - 1 = 3 Pods
Maximum normal Pod count:    4 + 1 = 5 Pods
```

Kubernetes can create a fifth Pod because the surge budget is one. Once that new Pod supplies safe capacity, the controller can remove an old Pod without dropping below three available replicas. The two settings are safety rails around the replacement loop.

When percentages are used, Kubernetes currently defaults both settings to 25%. Percentage `maxUnavailable` rounds down, while percentage `maxSurge` rounds up. Terminating Pods may remain alive during their grace period, so actual resource consumption can temporarily exceed the simple `replicas + maxSurge` number.

Creation alone does not prove that a Pod can serve requests. A new process may need to start a runtime, establish database connections, load configuration, warm caches, and open its listener. Kubernetes distinguishes several states:

| State | What it proves |
|---|---|
| created | the Pod object exists |
| scheduled | a node has been selected |
| `Running` | at least one container process is running |
| `Ready` | the configured readiness checks say the Pod can receive traffic |
| available | the Deployment can count the Pod as stable capacity |

A readiness probe supplies the feedback signal:

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  periodSeconds: 5
```

When readiness fails, the Pod can keep running, but matching Services stop treating it as a ready endpoint. The Deployment also avoids retiring too much proven old capacity.

`minReadySeconds` adds a stability period:

```yaml
minReadySeconds: 30
```

The Pod must remain ready for that time before the Deployment counts it as available. The resulting control loop is straightforward: create a new Pod, wait for it to become ready and available, retire safe old capacity, and repeat.

### Readiness is the controller's evidence that replacement capacity is useful

A `Running` container proves that a process exists, not that it can serve users. During a safe handoff, an old Ready Pod remains useful while a new Pod starts but is not Ready. Only after the new Pod becomes Ready—and remains so for `minReadySeconds` when configured—does the controller have evidence that it can retire more old capacity.

If new Pods stay unhealthy while old Pods remain, the apparent lack of progress is often the availability guardrail doing its job. The controller refuses to trade proven serving capacity for an unproven replacement.

### Walk the four-replica safety envelope step by step

With four desired replicas, surge one, and unavailable one, start at four Ready v1 Pods. Kubernetes may create one v2 Pod, making five total. While that Pod is starting, available capacity remains four because the old Pods still serve. Once v2 is Ready and satisfies `minReadySeconds`, the controller can remove old capacity while staying above the minimum of three.

```text
old available  new available  total Pods  interpretation
4              0              5           one v2 is starting under surge
4              1              5           new capacity has been proven
3              1              4           one old Pod can retire safely
3              1              5           another v2 begins
...                                         repeat toward 0 old, 4 new
```

If the first v2 Pod never becomes Ready, the new ReplicaSet exists and a container may even be Running, but no replacement capacity has been proven. Keeping v1 is correct. Weakening readiness merely to advance the rollout would trade a visible stalled release for user traffic sent to an unhealthy process.

Resource capacity participates too. The fifth Pod's requests must fit somewhere. A safe surge policy without cluster headroom produces a Pending Pod and cannot provide the availability evidence needed for the next handoff.

## How can you tell whether a rollout is progressing, complete, or stalled?
<!-- section-summary: Observe the Deployment, its ReplicaSets, and the new Pods to locate where replacement is progressing or blocked. -->

### Find the first blocked step in the desired-state chain

Changing the image with either a command or an updated manifest changes the desired Pod template:

```bash
kubectl set image deployment/api api=myregistry/api:v2
kubectl apply -f deployment.yaml
```

Watch the Deployment until it completes:

```bash
kubectl rollout status deployment/api
```

During progress, the command reports how many updated replicas are available. Successful completion returns exit code 0, which also makes the command useful in a CI/CD step.

Watch the mechanism directly in another terminal:

```bash
kubectl get rs -w
```

You should see the old ReplicaSet shrink and the new ReplicaSet grow. The Deployment is complete when all desired replicas are updated and available and no old replicas remain running.

When progress stops, follow the object chain rather than treating the Deployment as one opaque object:

```bash
kubectl get deploy api
kubectl get rs
kubectl get pods
kubectl describe deployment api
```

Classify the first visible symptom:

| Symptom | Layer to inspect next |
|---|---|
| New ReplicaSet never appears | Deployment update or API admission |
| ReplicaSet exists but no Pods appear | quota, admission, or permissions |
| Pods remain `Pending` | scheduling, requested resources, volumes |
| `ImagePullBackOff` | image name, tag, credentials, registry access |
| `CrashLoopBackOff` | application startup or configuration |
| `Running` but not ready | readiness endpoint and application dependencies |
| Ready but not yet available | `minReadySeconds` |
| New Pods are unhealthy while old Pods remain | availability protection is preserving old capacity |

`progressDeadlineSeconds` controls how long Kubernetes waits before reporting that progress has stalled. Its default is currently 600 seconds. A Deployment condition may then show `Progressing=False` with reason `ProgressDeadlineExceeded`.

That condition reports failure; the Deployment controller does not automatically choose a rollback. A delivery system, GitOps controller, operator, or person must decide whether the right response is a forward fix, a restart, or an older template.

This separates detection from recovery. `ProgressDeadlineExceeded` says that the new population did not make sufficient progress in time. It does not establish that the previous revision is still compatible with current configuration, data, or dependencies, so Kubernetes cannot safely infer rollback on its own.

### Diagnose from controller intent toward one new Pod

Use the object hierarchy as a narrowing sequence:

```text
Did the Deployment accept the new template and create a revision?
→ Did a new ReplicaSet appear with the expected hash and template?
→ Did that ReplicaSet create a Pod object?
→ Did admission accept the Pod and the scheduler place it?
→ Did the kubelet pull the image and start the container?
→ Did startup complete and readiness become true?
→ Did readiness remain true long enough to become available?
```

The first “no” owns the next evidence. `Insufficient cpu` on a new Pod does not indicate a bad readiness probe. `ImagePullBackOff` does not improve by raising `progressDeadlineSeconds`. A Ready Pod waiting through `minReadySeconds` is making progress even though availability has not yet advanced.

The deadline should cover a legitimately slow but healthy release while still reporting a genuinely stalled one. It is an observation threshold, not a repair mechanism. When it expires, preserve the conditions and Pod events before changing desired state so the cause is not erased by recovery.

## When should you patch forward, pause, restart, or roll back?
<!-- section-summary: Different rollout commands change the desired template, group edits, recreate current Pods, or restore an earlier template. -->

These actions solve different problems.

### Patch forward

Use a forward change when you know the correct desired configuration. If `my-api:v2-broken` should be `my-api:v2.0.1`, update the image:

```bash
kubectl set image deployment/api api=my-api:v2.0.1
```

The patch changes `.spec.template`, creates another revision, and lets reconciliation replace the broken desired state with the corrected one.

### Pause and resume

Pause when several Pod-template edits should become one release destination:

```bash
kubectl rollout pause deployment/api
```

You can change the image, resources, environment, and probes while paused. Then resume:

```bash
kubectl rollout resume deployment/api
```

Kubernetes can create one ReplicaSet from the combined edits instead of rolling through several intermediate templates. Pausing temporarily stops reconciliation of those template changes. It is not a backup, and a paused Deployment must be resumed before it can be rolled back.

### Restart

Restart when the current desired image and configuration remain correct but you need fresh Pod instances:

```bash
kubectl rollout restart deployment/api
```

The desired application version stays the same while Kubernetes creates replacement Pods. This is useful when process state needs clearing or a process only reads some configuration at startup.

### Roll back

Inspect the retained revisions first:

```bash
kubectl rollout history deployment/api
```

Then select the previous revision or a particular one:

```bash
kubectl rollout undo deployment/api
kubectl rollout undo deployment/api --to-revision=7
```

Rollback makes an earlier Pod template desired again. Choose it when that earlier template is the compatible recovery target.

## What does a Deployment rollback restore, and which changes need separate recovery?
<!-- section-summary: Deployment rollback restores an earlier Pod template; state and objects outside that template follow separate lifecycles. -->

### Rollback restores a template, not an earlier universe

Suppose revision 7 used this Pod template:

```yaml
template:
  spec:
    containers:
      - image: api:v1
        env:
          - name: FEATURE
            value: "off"
```

Revision 8 changed the image and environment value. Undoing to revision 7 restores the earlier `.spec.template` fields and starts replacement Pods from that template.

The boundary matters. Deployment rollback does not restore every part of an application system:

| Restored through the earlier Pod template | Requires separate compatibility or recovery |
|---|---|
| image reference | live `ConfigMap` or `Secret` contents |
| template environment values | `Service` objects |
| probes | database schema and persistent data |
| container resources | external APIs and side effects |
| template volume references | replica count changed separately |
| Pod labels and annotations | other Deployments and cluster configuration |

For example, imagine `v2` removes a database column that `v1` still reads. Kubernetes can restore the `v1` Pod template perfectly, yet the old process can still fail against the changed database. Application recovery has to account for compute version, configuration, schema, persistent data, and external compatibility.

A rollback is another forward reconciliation. Desired state moves from template `T1` to `T2`, then to `T1` again. Time does not run backwards. The controller scales the `T1` ReplicaSet up and the `T2` ReplicaSet down using the same readiness, surge, and availability rules as any rollout.

This also means rollback can stall. If the old image now depends on a service that no longer exists, its Pods may start and fail readiness. Requesting rollback proves that the desired template changed; it does not prove that recovery succeeded.

The important equation is therefore broader than the Deployment revision:

```text
recoverable application
= compatible compute version
+ compatible configuration
+ compatible schema and persistent data
+ compatible external services and side effects
```

Kubernetes owns only the Pod-template portion of that recovery. The remaining components need explicit compatibility or a separate recovery plan.

### Treat rollback as a release that must pass the same gates

Undoing revision 8 to revision 7 changes the desired template to the earlier image, environment values embedded in the template, probes, resources, volumes, labels, and annotations. The old ReplicaSet can grow again while revision 8 shrinks, but surge, unavailability, scheduling, readiness, and availability still govern the handoff.

That produces several possible recovery failures. The old image may be unavailable from the registry. Its resource request may no longer fit. Its readiness probe may depend on a removed endpoint. A referenced ConfigMap may now contain new-format data. The database may have migrated beyond what the old binary understands.

Before rollback, state the compatibility assumption for each external boundary. After rollback starts, observe it exactly like a new rollout. “Undo command accepted” proves only that desired template changed. Recovery is successful when the older population becomes available and performs correctly with current configuration, data, and dependencies.

## How do you verify the workload and the user-facing behavior after a release or rollback?
<!-- section-summary: Verify controller completion, ready endpoints, the intended template, and representative application behavior. -->

### Controller completion and application correctness are separate proofs

Verification has several layers. Begin with controller completion:

```bash
kubectl rollout status deployment/api
kubectl get deployment api
```

A completed four-replica Deployment should show four ready, up-to-date, and available replicas. Then inspect generations and Pods:

```bash
kubectl get rs
kubectl get pods -l app=api
kubectl describe deployment api
```

The current ReplicaSet should own the desired population, old ReplicaSets should be at zero replicas, and the Pods should be ready. A completed Deployment gets `Progressing=True` with reason `NewReplicaSetAvailable`.

Next, confirm that the expected image and template values actually reached the Pods. Then verify that the Service has ready backends and sends traffic to them. Kubernetes-level health establishes that the requested workload exists and satisfies the configured health checks.

Application behavior needs its own evidence. Send a representative request, check that the response is correct, and compare error rate, latency, and saturation with the pre-release baseline. Also exercise paths affected by current configuration, data, or external dependencies—especially after a rollback.

The full verification sequence is:

1. Deployment reconciliation completed.
2. Desired replicas are updated and available.
3. The expected image and template values are running.
4. Matching Service endpoints are ready.
5. Representative requests return correct results.
6. Errors, latency, and saturation remain acceptable.
7. Data, configuration, and external integrations remain compatible.

Kubernetes can confirm the controller's state and the health signal you configured. It cannot judge whether a business operation is semantically correct. Release and recovery are complete only when both layers have evidence.

### Use the old version as a baseline, not merely a fallback

Before changing traffic, capture the v1 baseline for request success, latency, saturation, dependency errors, and the business paths affected by v2. During rollout, correlate those outcomes with old and new Pod-template hashes so mixed populations do not hide a candidate regression inside aggregate metrics.

After completion or rollback, send the same representative requests through the Service rather than directly to an isolated Pod. This proves selector and EndpointSlice membership as well as application behavior. Confirm that no old serving Pods remain when the rollout should be complete, and that the intended older generation owns serving capacity when recovery was the goal.

For state-changing operations, verify outcomes rather than only HTTP status. A payment endpoint can return success while duplicating a charge; a schema rollback can make reads succeed while corrupting writes. Kubernetes readiness is necessary release feedback, but business correctness completes the proof.

## Check Your Answers
<!-- section-summary: Revisit template replacement, ReplicaSet generations, pacing, progress, recovery choices, rollback boundaries, and verification. -->

:::expand[What changes when a Deployment rolls out a new Pod template?]{kind="recap"}
A change under `.spec.template` creates a new revision and a new ReplicaSet. Kubernetes starts new Pods from that template and gradually retires Pods from the previous generation. A replica-count change alone is scaling.
:::

:::expand[Why does a Deployment keep old and new ReplicaSets during replacement?]{kind="recap"}
Each ReplicaSet represents one Pod-template generation. Keeping both generations lets the Deployment preserve working capacity while the new population starts and also retains revision history for rollback.
:::

:::expand[How do maxSurge, maxUnavailable, readiness, and minReadySeconds control the pace?]{kind="recap"}
`maxSurge` budgets extra Pods, and `maxUnavailable` budgets temporary loss of available capacity. Readiness tells the controller when a Pod can serve, while `minReadySeconds` requires that readiness to remain stable before the Pod counts as available.
:::

:::expand[How can you tell whether a rollout is progressing, complete, or stalled?]{kind="recap"}
Watch Deployment status, old and new ReplicaSet counts, and the state of new Pods. `ProgressDeadlineExceeded` means progress remained stalled beyond the deadline; it reports the failure without choosing the recovery action.
:::

:::expand[When should you patch forward, pause, restart, or roll back?]{kind="recap"}
Patch when you know the corrected desired template, pause when several edits should form one revision, restart when the current desired version needs fresh instances, and roll back when an earlier retained Pod template is the compatible target.
:::

:::expand[What does a Deployment rollback restore, and which changes need separate recovery?]{kind="recap"}
Rollback restores an earlier Pod template. Live configuration objects, Services, data schemas, persistent data, external effects, separately changed replicas, and other workloads require their own compatibility or recovery plan.
:::

:::expand[How do you verify the workload and the user-facing behavior after a release or rollback?]{kind="recap"}
Confirm controller completion, current ReplicaSet ownership, ready Pods, the expected image and template, and ready Service endpoints. Then test representative behavior and check application errors, latency, saturation, data, configuration, and external compatibility.
:::

## References
<!-- section-summary: Kubernetes documentation for Deployment revisions, rolling updates, readiness, history, and rollback. -->

- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) — template-triggered revisions, ReplicaSet replacement, update calculations, progress conditions, history, and rollback scope.
- [Update a Deployment During a Rolling Release](https://kubernetes.io/docs/tasks/run-application/update-deployment-rolling/) — rollout monitoring, pause, resume, history, and undo.
- [`kubectl rollout status`](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_status/) — rollout watching and exit behavior.
- [`kubectl rollout history`](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_history/) — retained revision inspection.
- [`kubectl rollout undo`](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/) — restoring an earlier Deployment revision.
- [`kubectl rollout restart`](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_restart/) — recreating Pods from the current desired configuration.
- [Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) — readiness behavior and probe configuration.
