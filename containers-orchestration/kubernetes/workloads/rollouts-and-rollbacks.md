---
title: "Rollouts and Rollbacks"
description: "Update Kubernetes workloads safely, inspect rollout progress, and roll back a bad Deployment revision."
overview: "Rollouts move a Deployment from one Pod template to another. A `notification-api` image update shows progress checks, stuck-release diagnosis, and rollback boundaries."
tags: ["rollouts", "rollback", "deployments", "kubectl"]
order: 6
id: article-containers-orchestration-kubernetes-workloads-rollouts-and-rollbacks
---
## Table of Contents

1. [A New Image Without Stopping Traffic](#a-new-image-without-stopping-traffic)
2. [The Small Rollout Shape](#the-small-rollout-shape)
3. [Revisions and the Pod Template Hash](#revisions-and-the-pod-template-hash)
4. [RollingUpdate Pacing](#rollingupdate-pacing)
5. [Readiness and Traffic Safety](#readiness-and-traffic-safety)
6. [Starting and Watching a Release](#starting-and-watching-a-release)
7. [Diagnosing a Stuck Rollout](#diagnosing-a-stuck-rollout)
8. [History, Undo, and Restart](#history-undo-and-restart)
9. [Pause, Resume, and Release Runbooks](#pause-resume-and-release-runbooks)
10. [Rollback Caveats](#rollback-caveats)
11. [What's Next](#whats-next)
12. [References](#references)

## A New Image Without Stopping Traffic
<!-- section-summary: A rollout replaces old Deployment Pods with new-template Pods while readiness and strategy settings keep traffic on healthy replicas. -->

A Deployment owns a Pod template, manages ReplicaSets, and keeps the requested number of replicas available. A **rollout** happens after that Pod template changes. Kubernetes creates Pods from the new template and retires Pods from the old template according to the Deployment strategy.

For the Customer Notification Platform, the release is `notification-api` image `2026.06.14-2`. The running service already has three Pods on image `2026.06.14-1` serving password reset emails, delivery updates, and account alerts. The new image improves provider retry handling and needs a `NOTIFICATION_EVENT_TOPIC` value. Kubernetes has to introduce those new Pods while old Pods keep serving traffic until replacement capacity is ready.

A **rollback** uses the same replacement machinery in the other direction. If `2026.06.14-2` fails readiness checks or starts returning bad notification responses, the team can ask Kubernetes to restore a previous Deployment revision. Kubernetes then creates Pods from that earlier template and scales down the broken one.

Release control has a practical order: understand the rollout fields, track ReplicaSet revisions, watch pacing and readiness, use status commands, diagnose stuck progress, then decide whether to patch forward, restart, pause, resume, or roll back.

![Rollout replacement flow infographic showing a Deployment creating new v2 Pods, waiting for readiness, removing old v1 Pods, using maxSurge one, and sending traffic only to ready Pods](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-rollouts-and-rollbacks/rollout-replacement-flow.png)

*A rollout replaces Pods gradually so readiness can protect traffic while the new version proves it can serve.*

_This infographic shows that a rollout replaces Pods as units, while readiness decides when a new Pod can join traffic._

## The Small Rollout Shape
<!-- section-summary: The rollout fields get a small Deployment slice before the full application template appears elsewhere. -->

The full Deployment has many fields. Release behavior comes from a small set of settings. For the notification API, the team wants three Pods in normal service, a short history for rollback, a deadline that exposes stalled progress, and a strategy that adds replacement capacity before removing old capacity. Reading these fields first helps the later commands connect to the exact manifest settings that control the release path.

```yaml
spec:
  replicas: 3
  revisionHistoryLimit: 5
  progressDeadlineSeconds: 300
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

`replicas: 3` says the normal desired count is three Pods. `revisionHistoryLimit: 5` keeps up to five old ReplicaSets around for history and rollback. `progressDeadlineSeconds: 300` tells Kubernetes when a rollout has stopped making progress long enough to report a failed condition.

The strategy section says how replacement should happen. `RollingUpdate` replaces Pods gradually. `maxSurge: 1` allows one extra Pod above the desired count during the update. `maxUnavailable: 0` tells Kubernetes not to intentionally drop below three available Pods while replacing them.

The rollout fields answer separate release questions:

- `replicas` sets the normal steady-state Pod count.
- `revisionHistoryLimit` controls how many previous ReplicaSets stay available for history and rollback.
- `progressDeadlineSeconds` gives Kubernetes a time window for rollout progress before reporting a failed condition.
- `strategy.type: RollingUpdate` chooses gradual replacement.
- `maxSurge` controls temporary extra capacity during replacement.
- `maxUnavailable` controls planned availability loss during replacement.

The image change lives deeper in the Pod template:

```yaml
template:
  spec:
    containers:
      - name: api
        image: ghcr.io/customer-notification/notification-api:2026.06.14-2
        env:
          - name: NOTIFICATION_EVENT_TOPIC
            value: notifications.requests.v2
```

That small snippet is the release itself. The strategy above controls how Kubernetes moves from the old template to this new template.

## Revisions and the Pod Template Hash
<!-- section-summary: Deployment revisions and template hashes help Kubernetes and operators separate old Pods from new Pods during a rollout. -->

A **Deployment revision** is a recorded version of the Deployment's Pod template. Kubernetes creates a new revision when the template changes. For `notification-api`, revision 1 might represent image `2026.06.14-1` with `NOTIFICATION_EVENT_TOPIC=notifications.requests.v1`. Revision 2 might represent image `2026.06.14-2` with `NOTIFICATION_EVENT_TOPIC=notifications.requests.v2`.

The **pod template hash** is a label the Deployment controller adds to Pods and ReplicaSets so it can separate one template from another. You will often see a ReplicaSet name such as `notification-api-6f8f7b9d88`. The last part comes from the template hash. Treat that label as Kubernetes-owned.

This command shows the ReplicaSets that belong to the API:

```bash
$ kubectl get rs -n notifications -l app.kubernetes.io/name=notification-api
NAME                         DESIRED   CURRENT   READY   AGE
notification-api-6f8f7b9d88  3         3         3       2d
notification-api-7c9d4c685b  0         0         0       15m
```

You can see the same separation on Pods:

```bash
$ kubectl get pods -n notifications \
  -l app.kubernetes.io/name=notification-api -L pod-template-hash
NAME                               READY   STATUS    HASH
notification-api-6f8f7b9d88-8fkwd  1/1     Running   6f8f7b9d88
notification-api-6f8f7b9d88-lk2qp  1/1     Running   6f8f7b9d88
notification-api-7c9d4c685b-m8vnn  0/1     Running   7c9d4c685b
```

During a production issue, the hash lets you say which Pods came from the old template and which Pods came from the new template.

## RollingUpdate Pacing
<!-- section-summary: RollingUpdate settings decide how much extra capacity Kubernetes can create and how much existing capacity it may remove during replacement. -->

**RollingUpdate pacing** is the rate at which Kubernetes can add new Pods and remove old Pods during a Deployment update. The two main knobs are `maxSurge` and `maxUnavailable`.

`maxSurge` controls extra temporary Pods. With three replicas and `maxSurge: 1`, Kubernetes can create a fourth Pod during the rollout. That new Pod must still schedule, pull the image, start, and pass readiness.

`maxUnavailable` controls how many desired Pods can be unavailable during replacement. With `maxUnavailable: 0`, Kubernetes keeps the old Pods serving until new capacity is ready. That is a common setting for small user-facing APIs when the cluster has room for one surge Pod.

Here is the pacing table for the notification API:

| Desired replicas | maxSurge | maxUnavailable | Maximum Pods during update | Minimum available Pods |
|---|---|---|---|---|
| 3 | 1 | 0 | 4 | 3 |
| 3 | 25% | 25% | 4 | 2 |
| 10 | 30% | 10% | 13 | 9 |

Percentages are useful for larger services. Small services often use explicit numbers so the behavior is obvious to the person watching the release.

Capacity can still block a careful strategy. If every node is already full according to requested CPU and memory, the surge Pod may stay Pending. The Deployment has a safe strategy, but the cluster has no room to execute it.

## Readiness and Traffic Safety
<!-- section-summary: Readiness decides when a new Pod can receive Service traffic, so rollout safety depends on probes that check real serving conditions. -->

A **readiness probe** asks whether a container should receive traffic. During a rollout, readiness is the gate that tells Kubernetes when a new Pod can count as available.

For `notification-api`, readiness should check the dependencies needed for real requests. The process may be running, but sending a notification request still needs database access, queue publishing, template loading, and provider routing configuration. A readiness endpoint should return success only after the app can handle ordinary user traffic.

This matters during the image update because Kubernetes may create a new Pod before it has any proof that the API can serve customers. The readiness probe gives the rollout a traffic gate: the old Pods keep serving while the new Pod starts, loads config, checks dependencies, and reports that it can handle the Service contract.

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: http
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3
```

If readiness is too shallow, Kubernetes may route traffic to a Pod that cannot send notifications yet. If readiness is too strict, a temporary provider outage may remove every Pod from traffic even though the API could still accept and queue requests. A good readiness check matches what the Service actually promises to callers.

`minReadySeconds` can add one more safety check:

```yaml
spec:
  minReadySeconds: 10
```

This asks Kubernetes to keep a new Pod ready for at least 10 seconds before treating it as available during the rollout. It helps catch Pods that pass one probe and immediately crash or turn unready.

## Starting and Watching a Release
<!-- section-summary: A release starts with a template change, then operators watch rollout status, controller state, image identity, and application smoke tests. -->

The notification team wants to move from image `2026.06.14-1` to `2026.06.14-2`. The command changes the Deployment template, and verification finishes the release.

Starting a release means changing the Deployment template. Watching a release means checking both Kubernetes progress and application behavior. For this notification API release, the team needs to see the new ReplicaSet grow, confirm the Deployment template records the new image, and run a business smoke test that exercises a real notification path before calling the rollout complete. Each check answers a separate release question, and together they keep the team from treating a template patch as a verified production release.

```bash
$ kubectl set image deployment/notification-api -n notifications \
  api=ghcr.io/customer-notification/notification-api:2026.06.14-2
deployment.apps/notification-api image updated
```

That command patches the Deployment template. The Deployment controller creates a new ReplicaSet and begins the RollingUpdate process.

Watch the rollout:

```bash
$ kubectl rollout status deployment/notification-api -n notifications --timeout=5m
Waiting for deployment "notification-api" rollout to finish: 1 out of 3 new replicas have been updated...
Waiting for deployment "notification-api" rollout to finish: 2 of 3 updated replicas are available...
deployment "notification-api" successfully rolled out
```

Then verify the live image:

```bash
$ kubectl get deployment notification-api -n notifications \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
ghcr.io/customer-notification/notification-api:2026.06.14-2
```

Finish with a business smoke test:

```bash
$ curl -fsS https://notify.devpolaris.example/internal/smoke/template-preview
{"status":"ok","channel":"email","template":"password-reset"}
```

The Kubernetes rollout proves the new Pods are available. The smoke test proves a real notification path still works.

## Diagnosing a Stuck Rollout
<!-- section-summary: A stuck rollout should be debugged from Deployment progress to ReplicaSets, Pods, events, and application logs. -->

The Deployment field **progressDeadlineSeconds** tells Kubernetes how long a rollout can go without progress before the Deployment reports a failed progress condition. In the API manifest, that deadline is 300 seconds. When the deadline passes, Kubernetes sets a condition with the reason `ProgressDeadlineExceeded`. The controller keeps reconciling afterward, so this condition is an alert signal and a debugging entry point.

The debug path should follow what changed. A new image can fail to pull, crash on startup, miss a required environment variable, fail readiness, or fit poorly on the available nodes. The notification API example below keeps the old Pods healthy while the new template gets stuck, so the team can inspect evidence before deciding between a forward fix and rollback.

Rollout status gives the first high-level signal:

```bash
$ kubectl rollout status deployment/notification-api -n notifications --timeout=60s
Waiting for deployment "notification-api" rollout to finish: 1 out of 3 new replicas have been updated...
error: timed out waiting for the condition
```

Describe the Deployment:

```bash
$ kubectl describe deployment notification-api -n notifications
Conditions:
  Type           Status  Reason
  Available      True    MinimumReplicasAvailable
  Progressing    False   ProgressDeadlineExceeded
Events:
  Normal   ScalingReplicaSet  Scaled up replica set notification-api-7c9d4c685b to 1
```

Now inspect the Pods by template hash:

```bash
$ kubectl get pods -n notifications \
  -l app.kubernetes.io/name=notification-api -L pod-template-hash
NAME                               READY   STATUS             HASH
notification-api-6f8f7b9d88-8fkwd  1/1     Running            6f8f7b9d88
notification-api-6f8f7b9d88-lk2qp  1/1     Running            6f8f7b9d88
notification-api-6f8f7b9d88-zp4hz  1/1     Running            6f8f7b9d88
notification-api-7c9d4c685b-m8vnn  0/1     CrashLoopBackOff   7c9d4c685b
```

The new Pod is crashing. The previous logs give the application clue:

```bash
$ kubectl logs -n notifications notification-api-7c9d4c685b-m8vnn --previous --tail=40
Error: NOTIFICATION_EVENT_TOPIC must be one of notifications.requests.v1, notifications.requests.v2
```

At this point the team chooses a repair. A forward fix may patch the variable to the accepted value. A rollback may be faster if users are affected and the previous revision is known good.

![Stuck rollout debug path infographic showing ProgressDeadlineExceeded, rollout status, Deployment, ReplicaSet, Pod events, logs, patch fix, and rollback](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-rollouts-and-rollbacks/stuck-rollout-debug-path.png)

*A stuck rollout should move from rollout status to ReplicaSets, Pod events, logs, a small fix, or rollback.*

_This infographic turns a stuck rollout into an evidence ladder, so the team can decide whether to patch the template forward or roll back from a known cause._

## History, Undo, and Restart
<!-- section-summary: Rollout history shows previous revisions, undo restores an older Pod template, and restart recreates Pods without changing the image. -->

A rollback decision needs two pieces of evidence: which revision was last known good, and what the current broken revision changed. History gives the revision list, annotations add human context, and undo asks Kubernetes to restore an earlier Pod template. Restart uses the rollout path too, but it keeps the same template and simply creates fresh Pods for the current release. The commands below separate those operations so the runbook names the right action.

```bash
$ kubectl rollout history deployment/notification-api -n notifications
deployment.apps/notification-api
REVISION  CHANGE-CAUSE
1         notification-api 2026.06.14-1 provider retry baseline
2         notification-api 2026.06.14-2 retry policy release
```

Kubernetes can store a change cause annotation:

```bash
$ kubectl annotate deployment/notification-api -n notifications \
  kubernetes.io/change-cause="notification-api 2026.06.14-2 retry policy release" \
  --overwrite
deployment.apps/notification-api annotated
```

To roll back to a known good revision:

```bash
$ kubectl rollout undo deployment/notification-api -n notifications --to-revision=1
deployment.apps/notification-api rolled back

$ kubectl rollout status deployment/notification-api -n notifications --timeout=5m
deployment "notification-api" successfully rolled out
```

Verify the image and application behavior afterward:

```bash
$ kubectl get deployment notification-api -n notifications \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
ghcr.io/customer-notification/notification-api:2026.06.14-1
```

`kubectl rollout restart` is different from rollback. It asks Kubernetes to recreate Pods from the current template. Use it when the template is still correct but Pods need to restart, such as after a mounted Secret refresh pattern or a stuck process.

```bash
$ kubectl rollout restart deployment/notification-api -n notifications
deployment.apps/notification-api restarted
```

A restart keeps the same Deployment template and creates fresh Pods from it. Use rollout undo only if the goal is to return to an earlier image or template.

## Pause, Resume, and Release Runbooks
<!-- section-summary: Pause and resume help group multiple template edits, while a runbook keeps release and rollback decisions concrete. -->

`kubectl rollout pause` tells the Deployment controller to stop rolling out new template changes. This helps when a fix needs multiple template edits. Suppose the API release needs both a new image and a new `NOTIFICATION_EVENT_TOPIC` value. Applying the image first could create a broken revision. Pausing lets an operator group the changes:

Pause and resume are emergency tools for controlling the sequence of template edits. In the normal path, a reviewed manifest should include the image and matching configuration together. During a live repair, pausing can keep Kubernetes from rolling a half-finished template while the operator applies the remaining field changes.

```bash
$ kubectl rollout pause deployment/notification-api -n notifications
deployment.apps/notification-api paused

$ kubectl set image deployment/notification-api -n notifications \
  api=ghcr.io/customer-notification/notification-api:2026.06.14-2
deployment.apps/notification-api image updated

$ kubectl set env deployment/notification-api -n notifications \
  NOTIFICATION_EVENT_TOPIC=notifications.requests.v2
deployment.apps/notification-api env updated

$ kubectl rollout resume deployment/notification-api -n notifications
deployment.apps/notification-api resumed
```

In a steady delivery workflow, a reviewed manifest change gives the same safety with a stronger audit trail. Pause and resume still help during emergency command-line work, especially when you need to avoid several partial revisions during a live production issue.

A practical release runbook for `notification-api` can stay concrete:

1. Confirm the manifest uses an immutable image tag or digest for the release.
2. Confirm the Deployment has readiness probes, resource requests, and rollout settings with enough surge capacity.
3. Apply the manifest through the normal pipeline.
4. Watch `kubectl rollout status deployment/notification-api -n notifications --timeout=5m`.
5. Check Deployment, ReplicaSets, and Pods if the rollout waits longer than expected.
6. Run the readiness URL and one business smoke test after Kubernetes reports success.
7. Watch error rate, latency, restarts, queue publish failures, and provider retry counts.
8. Roll back if the new revision fails readiness, fails smoke tests, or causes user-facing errors beyond the agreed threshold.

The rollback runbook should be just as concrete:

1. Capture history with `kubectl rollout history deployment/notification-api -n notifications`.
2. Save the failing Pod logs and events before they disappear.
3. Run `kubectl rollout undo deployment/notification-api -n notifications --to-revision=<known-good-revision>`.
4. Watch rollout status until the old template is available again.
5. Verify the image, readiness URL, business smoke test, and production dashboard.
6. Open a follow-up fix that explains why the bad template failed and how the next rollout will avoid the same failure.

Runbooks prevent improvisation during pressure. They also make the limits of Kubernetes rollback visible before database changes, mutable tags, and external systems enter the recovery plan.

## Rollback Caveats
<!-- section-summary: Kubernetes rollback restores a previous Pod template, while data changes, external systems, and mutable artifacts need separate recovery planning. -->

A Kubernetes rollback restores a Deployment Pod template. That is powerful, but the surrounding release may include changes outside that template. Production teams plan for those boundaries before they need the rollback.

The first caveat is database migration. If release `2026.06.14-2` changed the notification table in a way that older code cannot read, rolling the Pods back to `2026.06.14-1` may restore old containers while leaving the database in the new shape. Safer release plans use backward-compatible migrations: add columns before code uses them, write code that tolerates both shapes during the transition, and remove old columns in a later release.

The second caveat is configuration. A rollback restores environment variables written directly in the template. If the template references a ConfigMap or Secret by a stable name, and someone changed that object separately, the old Deployment revision may still point at the new data. Many teams version configuration names or let GitOps manage Deployment and configuration together so the release can return to a known set of files.

The third caveat is image identity. A mutable tag like `latest` or `prod` can point to different images over time. Rollback needs immutable tags or image digests because revision history should lead back to the exact artifact that previously ran. Store the image digest, commit SHA, build ID, and Deployment revision together.

The fourth caveat is external side effects. If the bad release published duplicate notification jobs, sent the same SMS twice, or changed data in another service, a Deployment rollback only changes future Pods. The recovery may still need data repair, message deduplication, provider reconciliation, or a compensating workflow.

Use Kubernetes rollback to recover the workload template quickly, then keep investigating the full release. The rollback gets healthy Pods back into service. The follow-up review handles the database, configuration, artifact, and business effects.

![Rollback boundary map infographic showing rollback restores the Pod template, image, and env, while database, ConfigMap, image tag, and external effects need separate recovery](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-rollouts-and-rollbacks/rollback-boundary-map.png)

*A Deployment rollback restores the Pod template, while data, external effects, and some configuration changes need separate recovery.*

_This infographic draws the rollback boundary clearly: Kubernetes can restore an earlier Pod template, while data changes, mutable configuration, artifacts, and business effects need their own recovery plan._

## What's Next
<!-- section-summary: The next article explains why resource requests and limits affect scheduling, rollout speed, and failure behavior. -->

Rollouts depend on capacity. A safe `maxSurge: 1` setting only helps if the cluster has room for one extra Pod. A readiness probe only gets a chance to pass if the Pod can schedule and start. CPU pressure can make a new version slow to report ready, and memory limits can restart a Pod right as the Deployment waits for it to report available.

The next topic is **resource requests and limits**. The same `notification-api` service shows how Kubernetes decides where Pods fit, why CPU and memory behave differently, and how bad resource settings can turn a normal rollout into a confusing production issue.

## References

- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Explains Deployment rollouts, ReplicaSets, revisions, progress deadlines, rollback behavior, and rolling update configuration.
- [kubectl rollout](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/) - Lists rollout subcommands such as status, history, undo, restart, pause, and resume.
- [kubectl rollout status](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_status/) - Documents how rollout status watches the latest rollout and supports timeouts and revision selection.
- [kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/) - Documents rolling back to a previous rollout revision.
- [kubectl rollout restart](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_restart/) - Documents restarting workloads through rollout machinery.
- [kubectl rollout pause](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_pause/) and [kubectl rollout resume](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_resume/) - Document pausing and resuming Deployment rollout reconciliation.
- [Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/) - Defines readiness probes and their role in deciding whether a container can receive traffic.
- [Pod lifecycle: Pod readiness](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) - Documents Pod readiness gates and how custom Pod conditions affect the Ready condition.
- [Update a Deployment without downtime](https://kubernetes.io/docs/tasks/run-application/update-deployment-rolling/) - Walks through rolling updates, monitoring progress, pausing, resuming, and rolling back.
