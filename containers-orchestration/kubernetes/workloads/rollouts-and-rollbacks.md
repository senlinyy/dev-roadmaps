---
title: "Rollouts and Rollbacks"
description: "Update Kubernetes workloads safely, inspect rollout progress, and roll back a bad Deployment revision."
overview: "Rollouts are how Kubernetes moves a Deployment from one Pod template to another. This article follows a `devpolaris-orders-api` image update, shows what progress looks like, and diagnoses a stuck release."
tags: ["rollouts", "rollback", "deployments", "kubectl"]
order: 6
id: article-containers-orchestration-kubernetes-workloads-rollouts-and-rollbacks
---

## Table of Contents

1. [How a Deployment Changes Running Pods](#how-a-deployment-changes-running-pods)
2. [Revisions and the Pod Template Hash](#revisions-and-the-pod-template-hash)
3. [RollingUpdate Pacing](#rollingupdate-pacing)
4. [Readiness and Traffic Safety](#readiness-and-traffic-safety)
5. [Starting and Watching a Release](#starting-and-watching-a-release)
6. [Diagnosing a Stuck Rollout](#diagnosing-a-stuck-rollout)
7. [History, Undo, and Restart](#history-undo-and-restart)
8. [Pause, Resume, and Release Runbooks](#pause-resume-and-release-runbooks)
9. [Rollback Caveats](#rollback-caveats)
10. [What's Next](#whats-next)

## How a Deployment Changes Running Pods
<!-- section-summary: A rollout replaces Pods created from one Deployment template with Pods created from a newer template. -->

A **rollout** is the process Kubernetes uses to move a workload from one Pod template to another Pod template. A Pod template is the part of a Deployment that describes the Pods it should create: container image, environment variables, probes, labels, resource settings, volumes, and other Pod-level settings.

For this article, picture a team shipping `devpolaris-orders-api`. Version `2026.06.14-1` is already serving customer checkout traffic. The next release, `2026.06.14-2`, includes a bug fix for coupon validation and a new environment variable named `ORDERS_EVENT_TOPIC`. The team changes the Deployment template so new Pods use the new image and the new variable. Kubernetes sees that the template changed, creates new Pods from the new template, and gradually removes the Pods from the previous template.

A **rollback** points the same machinery back at an earlier template. If version `2026.06.14-2` fails readiness checks or returns bad checkout responses, the team can ask Kubernetes to use the previous Deployment revision again. Kubernetes then creates Pods from that earlier template and scales down the broken one.

The important beginner detail is that Kubernetes changes Pods by replacement. A running container keeps the image and configuration it started with. When you change a Deployment, Kubernetes creates a new group of Pods and retires the old group according to the Deployment strategy. That replacement process gives the platform a chance to keep healthy Pods available during the release.

Here is the small Deployment shape we will keep using:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  labels:
    app: devpolaris-orders-api
spec:
  replicas: 3
  revisionHistoryLimit: 5
  progressDeadlineSeconds: 300
  selector:
    matchLabels:
      app: devpolaris-orders-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: devpolaris-orders-api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026.06.14-1
          ports:
            - containerPort: 8080
          env:
            - name: ORDERS_EVENT_TOPIC
              value: orders.events.v1
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            periodSeconds: 5
            failureThreshold: 3
```

This manifest introduces the pieces that matter for rollout safety: **replicas** tell Kubernetes how many Pods should exist, **RollingUpdate** tells it to replace them gradually, **progressDeadlineSeconds** tells it how long progress can stall before the Deployment reports a failure condition, and the **readiness probe** tells it whether a new Pod should receive traffic.

![Rollout replacement flow infographic showing a Deployment creating new v2 Pods, waiting for readiness, removing old v1 Pods, using maxSurge one, and sending traffic only to ready Pods](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-rollouts-and-rollbacks/rollout-replacement-flow.png)

_This infographic shows that a rollout replaces Pods, not running containers in place, and that readiness decides when a new Pod can join traffic._

## Revisions and the Pod Template Hash
<!-- section-summary: Each changed Pod template gets a Deployment revision, and the Deployment controller uses ReplicaSets plus a pod-template-hash label to keep versions apart. -->

A **Deployment revision** is Kubernetes' record of a particular Deployment Pod template. When the template changes, the Deployment controller creates or updates a ReplicaSet for the new template and increments the revision number. A ReplicaSet is the controller object that keeps a matching set of Pods running for one template.

For `devpolaris-orders-api`, revision 1 might represent image `2026.06.14-1` with `ORDERS_EVENT_TOPIC=orders.events.v1`. Revision 2 might represent image `2026.06.14-2` with `ORDERS_EVENT_TOPIC=orders.events.v2`. Kubernetes can keep old ReplicaSets around because `revisionHistoryLimit` allows previous templates to remain available for rollback.

The **pod template hash** is a label the Deployment controller adds to Pods and ReplicaSets so it can separate one template from another. You will often see a name like `devpolaris-orders-api-6f8f7b9d88`. The last part comes from the template hash. You should treat that label as Kubernetes-owned. It helps the controller avoid mixing old Pods and new Pods under the same Deployment selector.

This command shows the ReplicaSets that belong to the orders API:

```bash
$ kubectl get rs -l app=devpolaris-orders-api
NAME                                 DESIRED   CURRENT   READY   AGE
devpolaris-orders-api-6f8f7b9d88     3         3         3       2d
devpolaris-orders-api-7c9d4c685b     0         0         0       15m
```

The ready ReplicaSet is the version serving traffic. The zero-desired ReplicaSet can still matter because it may hold a previous template for rollback. During an active rollout, both ReplicaSets may have desired Pods for a short time: the new one scales up, and the old one scales down.

You can connect Pods back to their template hash while a release is moving:

```bash
$ kubectl get pods -l app=devpolaris-orders-api -L pod-template-hash
NAME                                       READY   STATUS    RESTARTS   POD-TEMPLATE-HASH
devpolaris-orders-api-6f8f7b9d88-8fkwd     1/1     Running   0          6f8f7b9d88
devpolaris-orders-api-6f8f7b9d88-lk2qp     1/1     Running   0          6f8f7b9d88
devpolaris-orders-api-7c9d4c685b-m8vnn     0/1     Running   0          7c9d4c685b
```

That output tells a useful story. Two old Pods are still ready. One new Pod exists, but it has not passed readiness yet. The next section explains how Kubernetes decides how many of each version may exist at the same time.

## RollingUpdate Pacing
<!-- section-summary: RollingUpdate uses maxSurge and maxUnavailable to control how quickly new Pods appear and old Pods disappear. -->

**RollingUpdate** is the default Deployment strategy. It gradually replaces old Pods with new Pods while trying to keep enough available Pods in service. This strategy fits normal stateless web APIs because the Service can send traffic to whichever Pods are ready.

Two fields control the pace. **maxSurge** is the number of extra Pods Kubernetes may create above the desired replica count during the rollout. **maxUnavailable** is the number of desired Pods that may be unavailable during the rollout. Both fields accept an absolute number or a percentage.

For the orders API, the Deployment asks for three replicas:

```yaml
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
```

With `maxSurge: 1`, Kubernetes may temporarily run four Pods: three old Pods plus one new Pod. With `maxUnavailable: 0`, Kubernetes should keep three available Pods during the release. This is a conservative setting for a production API because old traffic capacity stays in place while one new Pod proves it can serve.

The tradeoff is cluster capacity. A surge Pod needs CPU and memory like any other Pod. If every node is already full, the new Pod may stay Pending and the rollout will wait. If the team uses `maxUnavailable: 1` instead, Kubernetes may remove one old Pod before the new one is ready, which reduces capacity but may avoid needing extra headroom for the surge Pod.

Percentages behave the same way, but Kubernetes rounds them to whole Pods. A common pattern is:

```yaml
rollingUpdate:
  maxSurge: 25%
  maxUnavailable: 25%
```

That pattern works well for larger replica counts. For a tiny three-replica API, exact numbers often make the rollout behavior easier to reason about during incidents. The next piece is the signal Kubernetes uses before it trusts a new Pod with traffic.

## Readiness and Traffic Safety
<!-- section-summary: Readiness probes and optional readiness gates decide whether a new Pod can join Service traffic during a rollout. -->

A **readiness probe** is a check that tells Kubernetes whether a container is ready to receive traffic. For an HTTP API, it usually calls a path such as `/health/ready`. If the probe succeeds, Kubernetes can mark the Pod Ready. If the probe fails, Kubernetes keeps the Pod out of normal Service traffic.

In the orders API, readiness should check the things needed for real requests. The process may be running, but checkout traffic still needs the database connection, the event topic configuration, and any required cache warmup. A readiness endpoint should return success only after the app can handle ordinary user traffic.

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3
```

This probe gives the application a short startup window, then checks every five seconds. Three failures mark the container unready. During a rollout, that unready state protects users because the new Pod stays out of Service endpoints while old ready Pods keep serving.

Kubernetes also has **readiness gates** for advanced cases. A readiness gate adds a custom Pod condition that must be `True` before the Pod counts as Ready. Teams use this when another controller has extra knowledge, such as a cloud load balancer controller that knows whether the Pod is registered and healthy outside the cluster. If the custom condition is missing or `False`, the Pod stays unready even when its containers are ready.

Here is the shape, included so you recognize it in production manifests:

```yaml
spec:
  readinessGates:
    - conditionType: devpolaris.com/external-lb-ready
```

That field needs a controller or operator to update the Pod status condition. A normal application Deployment usually starts with a good readiness probe. Add a readiness gate only when a real external readiness signal exists and your platform has a controller that writes that condition.

Readiness connects directly to release safety. The Deployment controller counts available Pods, Services route to ready endpoints, and `kubectl rollout status` waits for the new template to satisfy the rollout rules. Now we can start a release and watch those signals in order.

## Starting and Watching a Release
<!-- section-summary: A rollout starts when the Deployment Pod template changes, and kubectl can watch the controller until the new revision completes or stalls. -->

A rollout starts when you change the Deployment's Pod template. In a production team, that change usually lands through GitOps or a CI/CD pipeline. Someone edits a manifest, opens a pull request, automation applies the change, and the cluster moves toward the new desired state. For learning and emergency work, `kubectl set image` shows the same mechanism directly.

The orders team wants to move from image `2026.06.14-1` to `2026.06.14-2`:

```bash
$ kubectl set image deployment/devpolaris-orders-api \
  api=ghcr.io/devpolaris/orders-api:2026.06.14-2
deployment.apps/devpolaris-orders-api image updated
```

Now watch the rollout:

```bash
$ kubectl rollout status deployment/devpolaris-orders-api --timeout=5m
Waiting for deployment "devpolaris-orders-api" rollout to finish: 1 out of 3 new replicas have been updated...
Waiting for deployment "devpolaris-orders-api" rollout to finish: 2 of 3 updated replicas are available...
deployment "devpolaris-orders-api" successfully rolled out
```

That command reports the Deployment controller's progress. It tells you whether Kubernetes completed the replacement according to the Deployment rules. It still belongs beside application verification, because a Pod can pass readiness while a business path still has a bug.

Check the controller view:

```bash
$ kubectl get deployment devpolaris-orders-api
NAME                    READY   UP-TO-DATE   AVAILABLE   AGE
devpolaris-orders-api   3/3     3            3           14d
```

Then check the template image:

```bash
$ kubectl get deployment devpolaris-orders-api \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="api")].image}{"\n"}'
ghcr.io/devpolaris/orders-api:2026.06.14-2
```

And check the user path:

```bash
$ curl -fsS https://orders.devpolaris.example/health/ready
{"status":"ready","database":"ok","events":"ok"}

$ curl -fsS https://orders.devpolaris.example/internal/smoke/checkout-total
{"status":"ok","scenario":"coupon-with-tax","total":"42.19"}
```

The first `curl` checks the same readiness surface the Pod exposes. The second checks a real business behavior. Many production teams run a small smoke test like this after the rollout status succeeds, then watch dashboards and alerts for error rate, latency, restarts, and queue lag.

## Diagnosing a Stuck Rollout
<!-- section-summary: A stuck rollout needs a quick path through Deployment status, ReplicaSets, Pods, events, and logs. -->

A rollout is **stuck** when Kubernetes cannot make progress toward the new revision. The new Pods may be Pending, CrashLooping, failing readiness, blocked by an image pull error, or waiting for capacity. The old Pods may still be serving, but the release has stopped moving.

The Deployment field **progressDeadlineSeconds** tells Kubernetes how long a rollout can go without progress before the Deployment reports a failed progress condition. In the orders API manifest, that deadline is 300 seconds. When the deadline passes, Kubernetes sets a condition with the reason `ProgressDeadlineExceeded`. The controller keeps reconciling afterward, so this condition is an alert signal and a debugging entry point.

Start with rollout status:

```bash
$ kubectl rollout status deployment/devpolaris-orders-api --timeout=60s
Waiting for deployment "devpolaris-orders-api" rollout to finish: 1 out of 3 new replicas have been updated...
error: timed out waiting for the condition
```

Then read the Deployment:

```bash
$ kubectl describe deployment devpolaris-orders-api
Conditions:
  Type           Status  Reason
  ----           ------  ------
  Available      True    MinimumReplicasAvailable
  Progressing    False   ProgressDeadlineExceeded
Events:
  Type     Reason             Message
  ----     ------             -------
  Normal   ScalingReplicaSet  Scaled up replica set devpolaris-orders-api-7c9d4c685b to 1
```

The conditions tell you the shape of the incident. `Available=True` means enough old Pods may still be serving. `Progressing=False` with `ProgressDeadlineExceeded` means the new revision did not move forward in time.

Next, inspect the Pods and events:

```bash
$ kubectl get pods -l app=devpolaris-orders-api -L pod-template-hash
NAME                                       READY   STATUS             RESTARTS   POD-TEMPLATE-HASH
devpolaris-orders-api-6f8f7b9d88-8fkwd     1/1     Running            0          6f8f7b9d88
devpolaris-orders-api-6f8f7b9d88-lk2qp     1/1     Running            0          6f8f7b9d88
devpolaris-orders-api-6f8f7b9d88-zp4hz     1/1     Running            0          6f8f7b9d88
devpolaris-orders-api-7c9d4c685b-m8vnn     0/1     Running            0          7c9d4c685b

$ kubectl describe pod devpolaris-orders-api-7c9d4c685b-m8vnn
Events:
  Type     Reason     Message
  ----     ------     -------
  Warning  Unhealthy  Readiness probe failed: HTTP probe failed with statuscode: 500
```

Now read the application logs:

```bash
$ kubectl logs devpolaris-orders-api-7c9d4c685b-m8vnn --tail=40
2026-06-14T10:42:17Z server started on :8080
2026-06-14T10:42:20Z readiness failed: missing ORDERS_EVENT_TOPIC
```

That points to a release packaging issue. The new image expects `ORDERS_EVENT_TOPIC`, and the new template may have the wrong value, the wrong environment variable name, or a missing ConfigMap reference. The fast production choice is usually one of two paths: patch the missing configuration and let the rollout continue, or roll back to the previous revision while the release fix goes through review.

Other stuck rollout shapes have different first fixes:

| Symptom | What it usually means | First checks |
|---|---|---|
| `ImagePullBackOff` | The node cannot pull the image | Image tag, registry auth, imagePullSecrets |
| `Pending` with `Insufficient cpu` | The surge Pod cannot fit on available nodes | Requests, node allocatable, cluster autoscaler, maxSurge |
| `CrashLoopBackOff` | The container starts and exits repeatedly | `kubectl logs --previous`, command, config, dependencies |
| `Running` but `0/1 Ready` | The app process is up but readiness fails | Readiness endpoint, dependencies, startup timing, readiness gates |

This workflow gives you the evidence needed for the rollback decision. You know whether old capacity remains healthy, whether the new template can be repaired quickly, and whether the issue affects user traffic.

![Stuck rollout debug path infographic showing ProgressDeadlineExceeded, rollout status, Deployment, ReplicaSet, Pod events, logs, patch fix, and rollback](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-rollouts-and-rollbacks/stuck-rollout-debug-path.png)

_This infographic turns a stuck rollout into an evidence ladder, so the team can decide whether to patch the template forward or roll back from a known cause._

## History, Undo, and Restart
<!-- section-summary: kubectl rollout history, undo, and restart let operators inspect revisions, return to an earlier template, or refresh Pods without changing the image. -->

`kubectl rollout history` shows Deployment revisions. It helps you answer which templates Kubernetes can still use for rollback.

```bash
$ kubectl rollout history deployment/devpolaris-orders-api
deployment.apps/devpolaris-orders-api
REVISION  CHANGE-CAUSE
1         initial production Deployment
2         orders-api 2026.06.14-2 coupon validation release
```

Kubernetes stores the template for each retained revision on ReplicaSets. The table is most useful when your pipeline annotates the Deployment with a clear change cause before or during release:

```bash
$ kubectl annotate deployment/devpolaris-orders-api \
  kubernetes.io/change-cause="orders-api 2026.06.14-2 coupon validation release" \
  --overwrite
deployment.apps/devpolaris-orders-api annotated
```

You can inspect a specific revision:

```bash
$ kubectl rollout history deployment/devpolaris-orders-api --revision=2
deployment.apps/devpolaris-orders-api with revision #2
Pod Template:
  Labels:       app=devpolaris-orders-api
                pod-template-hash=7c9d4c685b
  Containers:
   api:
    Image:      ghcr.io/devpolaris/orders-api:2026.06.14-2
```

`kubectl rollout undo` asks Kubernetes to restore a previous template:

```bash
$ kubectl rollout undo deployment/devpolaris-orders-api --to-revision=1
deployment.apps/devpolaris-orders-api rolled back

$ kubectl rollout status deployment/devpolaris-orders-api --timeout=5m
deployment "devpolaris-orders-api" successfully rolled out
```

After an undo, verify the template and the user path:

```bash
$ kubectl get deployment devpolaris-orders-api \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="api")].image}{"\n"}'
ghcr.io/devpolaris/orders-api:2026.06.14-1

$ curl -fsS https://orders.devpolaris.example/internal/smoke/checkout-total
{"status":"ok","scenario":"coupon-with-tax","total":"42.19"}
```

`kubectl rollout restart` serves a different purpose. It refreshes Pods by changing an annotation on the Pod template, which causes a new rollout using the same image and configuration. Teams use it after rotating a Secret mounted as a volume, refreshing connections, or recovering from a node-level issue. Use it with the same rollout status and smoke-test checks because it still replaces Pods.

```bash
$ kubectl rollout restart deployment/devpolaris-orders-api
deployment.apps/devpolaris-orders-api restarted

$ kubectl rollout status deployment/devpolaris-orders-api --timeout=5m
deployment "devpolaris-orders-api" successfully rolled out
```

Undo and restart are operational tools. The next section ties them into a release runbook so a team can use them consistently during real incidents.

## Pause, Resume, and Release Runbooks
<!-- section-summary: Pause and resume help group multiple template changes, while a runbook keeps release and rollback decisions consistent. -->

`kubectl rollout pause` marks a Deployment as paused. While paused, the Deployment can accept template changes, but the controller holds off on rolling out those changes. `kubectl rollout resume` lets the controller continue.

This helps when a fix needs multiple template edits. Suppose the orders API release needs both a new image and a new `ORDERS_EVENT_TOPIC` value. Applying the image first could create a broken revision. Pausing lets an operator group the changes:

```bash
$ kubectl rollout pause deployment/devpolaris-orders-api
deployment.apps/devpolaris-orders-api paused

$ kubectl set image deployment/devpolaris-orders-api \
  api=ghcr.io/devpolaris/orders-api:2026.06.14-2
deployment.apps/devpolaris-orders-api image updated

$ kubectl set env deployment/devpolaris-orders-api \
  ORDERS_EVENT_TOPIC=orders.events.v2
deployment.apps/devpolaris-orders-api env updated

$ kubectl rollout resume deployment/devpolaris-orders-api
deployment.apps/devpolaris-orders-api resumed
```

In a steady delivery workflow, a reviewed manifest change gives the same safety with a stronger audit trail. The pause and resume commands still matter for emergency command-line work, especially when you need to avoid creating several partial revisions during a live incident.

A practical release runbook for `devpolaris-orders-api` can stay short:

1. Confirm the manifest uses an immutable image tag or digest for the release.
2. Confirm the Deployment has readiness probes, resource requests, and a rollout strategy with enough surge capacity.
3. Apply the manifest through the normal pipeline.
4. Watch `kubectl rollout status deployment/devpolaris-orders-api --timeout=5m`.
5. Check Deployment, ReplicaSets, and Pods if the rollout waits longer than expected.
6. Run the readiness URL and one business smoke test after Kubernetes reports success.
7. Watch error rate, latency, restarts, and queue lag for the release window.
8. Roll back if the new revision fails readiness, fails smoke tests, or causes user-facing errors beyond the agreed threshold.

The rollback runbook should be just as concrete:

1. Capture the current revision with `kubectl rollout history deployment/devpolaris-orders-api`.
2. Save the failing Pod logs and events before they disappear.
3. Run `kubectl rollout undo deployment/devpolaris-orders-api --to-revision=<known-good-revision>`.
4. Watch rollout status until the old template is available again.
5. Verify the image, readiness URL, business smoke test, and production dashboard.
6. Open a follow-up fix that explains why the bad template failed and how the next rollout will avoid the same failure.

Runbooks prevent improvisation during pressure. They also make the limits of Kubernetes rollback clearer, which matters for database changes, mutable tags, and external systems.

## Rollback Caveats
<!-- section-summary: Kubernetes rollback restores a previous Pod template, while data changes, external systems, and mutable artifacts need separate recovery planning. -->

A Kubernetes rollback restores a Deployment Pod template. That is powerful, but the surrounding release may include changes outside that template. Production teams plan for those boundaries before they need the rollback.

The first caveat is database migration. If release `2026.06.14-2` changed the schema in a way that older code cannot read, rolling the Pods back to `2026.06.14-1` may restore old containers while leaving the database in the new shape. Safer release plans use backward-compatible migrations: add columns before code uses them, write code that tolerates both shapes during the transition, and remove old columns in a later release.

The second caveat is configuration. A rollback restores the Deployment template, including environment variables written directly in the template. If the template references a ConfigMap or Secret by a stable name, and someone changed the object contents separately, the old Deployment revision may still point at the new ConfigMap or Secret data. Many teams version configuration names or let GitOps manage Deployment and configuration together so the release can return to a known set of files.

The third caveat is image identity. A mutable tag like `latest` or `prod` can point to different images over time. Rollback works best with immutable tags or image digests because revision history should lead back to the exact artifact that previously ran. For production release records, store the image digest, commit SHA, build ID, and deployment revision together.

The fourth caveat is external side effects. If the bad release published duplicate order events, charged a payment provider, or changed data in another service, a Deployment rollback will only change future Pods. The incident may still need data repair, message replay handling, or a compensating workflow.

So the production habit is simple: use Kubernetes rollback to recover the workload template quickly, then keep investigating the full release. The rollback gets healthy Pods back into service. The incident review handles the database, configuration, artifact, and business effects.

![Rollback boundary map infographic showing rollback restores the Pod template, image, and env, while database, ConfigMap, image tag, and external effects need separate recovery](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-rollouts-and-rollbacks/rollback-boundary-map.png)

_This infographic draws the rollback boundary clearly: Kubernetes can restore an earlier Pod template, while data changes, mutable configuration, artifacts, and business effects need their own recovery plan._

## What's Next
<!-- section-summary: The next article explains why resource requests and limits affect scheduling, rollout speed, and failure behavior. -->

Rollouts depend on capacity. A safe `maxSurge: 1` setting only helps if the cluster has room for one extra Pod. A readiness probe only gets a chance to pass if the Pod can schedule and start. CPU pressure can make a new version look slow, and memory limits can restart a Pod right as the Deployment waits for it to become available.

The next article looks at **resource requests and limits**. We will use the same `devpolaris-orders-api` service to see how Kubernetes decides where Pods fit, why CPU and memory behave differently, and how bad resource settings can turn a normal rollout into a confusing production incident.

---

**References**

- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Explains Deployment rollouts, ReplicaSets, revisions, progress deadlines, rollback behavior, and rolling update configuration.
- [kubectl rollout](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/) - Lists rollout subcommands such as status, history, undo, restart, pause, and resume.
- [kubectl rollout status](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_status/) - Documents how rollout status watches the latest rollout and supports timeouts and revision selection.
- [kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/) - Documents rolling back to a previous rollout revision.
- [kubectl rollout restart](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_restart/) - Documents restarting workloads through rollout machinery.
- [kubectl rollout pause](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_pause/) and [kubectl rollout resume](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_resume/) - Document pausing and resuming Deployment rollout reconciliation.
- [Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/) - Defines readiness probes and their role in deciding whether a container can receive traffic.
- [Pod lifecycle: Pod readiness](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) - Documents Pod readiness gates and how custom Pod conditions affect the Ready condition.
- [Update a Deployment without downtime](https://kubernetes.io/docs/tasks/run-application/update-deployment-rolling/) - Walks through rolling updates, monitoring progress, pausing, resuming, and rolling back.
