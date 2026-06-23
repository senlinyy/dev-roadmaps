---
title: "Logs and Events"
description: "Use Kubernetes logs and events together to explain what happened to Pods, Deployments, and cluster objects."
overview: "Logs tell you what the container process said. Events tell you what Kubernetes did around that process. This article teaches a practical path for combining both signals while debugging devpolaris-orders-api."
tags: ["logs", "events", "kubectl", "debugging"]
order: 2
id: article-containers-orchestration-kubernetes-operations-logs-and-events
---

## Table of Contents

1. [Two Stories in One Incident](#two-stories-in-one-incident)
2. [Start With Object State](#start-with-object-state)
3. [Current Logs: What the Container Said](#current-logs-what-the-container-said)
4. [Previous Logs: Evidence From the Last Crash](#previous-logs-evidence-from-the-last-crash)
5. [Events: What Kubernetes Decided](#events-what-kubernetes-decided)
6. [Build a Timeline](#build-a-timeline)
7. [When Logs Are Empty](#when-logs-are-empty)
8. [Production Logging Habits](#production-logging-habits)
9. [Operational Checklist](#operational-checklist)

## Two Stories in One Incident
<!-- section-summary: Logs explain what the application process said, while events explain what Kubernetes did around that process. -->

When a Kubernetes workload fails, two different stories are usually unfolding at the same time. The application writes one story to stdout and stderr, and Kubernetes writes another story through object status and events. You need both if you want to understand what happened without guessing.

The running scenario stays with **devpolaris-orders-api** in the `orders` namespace. The team rolled out a new image after adding better health probes. A few minutes later, the Deployment shows only two available replicas out of three, and checkout traffic has started to produce intermittent errors.

**Container logs** are the lines your process writes. For a web API, that might include startup messages, request errors, database connection errors, and shutdown messages. **Kubernetes events** are short records from platform components such as the scheduler, kubelet, controllers, and admission flow. Events include image pull failures, missing Secrets, probe failures, failed scheduling, and container restarts.

These two stories answer different questions. Keep them side by side until they point to the same fix:

| Signal | Good question | Example answer |
|---|---|---|
| **Object state** | Which Kubernetes object is unhealthy right now? | One Pod is in `CrashLoopBackOff` |
| **Current logs** | What is the running container saying now? | The API reports `POSTGRES_URL missing` |
| **Previous logs** | What did the last crashed container say? | Startup failed before the HTTP server was ready |
| **Events** | What did Kubernetes do or refuse to do? | Kubelet could not mount a missing Secret |

![Incident evidence map connecting object state, current logs, previous logs, events, and a timeline for the next safe debugging check](/content-assets/articles/article-containers-orchestration-kubernetes-operations-logs-and-events/incident-evidence-map.png)

*The evidence map keeps Kubernetes state, application output, and event history side by side so the incident timeline comes from several matching signals, not one loud log line.*

The order matters. If you jump straight into random logs, you may read a healthy replica and miss the failing one. If you read only events, you may know Kubernetes restarted a container but miss the application error that caused the exit.

## Start With Object State
<!-- section-summary: Object state narrows the search to the failing Deployment, ReplicaSet, Pod, and container before you open logs. -->

**Object state** is the current status Kubernetes reports for resources such as Deployments, ReplicaSets, Pods, and containers. It gives you the map before you start reading the evidence. In a namespace with many Pods, this first step saves a lot of wandering.

For the orders API rollout, the useful first view is Deployment, ReplicaSet, and Pod state filtered by the stable application label. That gives you the controller view and the failing Pod in one pass:

```bash
$ kubectl -n orders get deploy,rs,pod -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                   READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/devpolaris-orders-api  2/3     3            2           18m

NAME                                              DESIRED   CURRENT   READY   AGE
replicaset.apps/devpolaris-orders-api-78b6f596dc  3         3         2       18m

NAME                                            READY   STATUS             RESTARTS   AGE
pod/devpolaris-orders-api-78b6f596dc-7x2tb      1/1     Running            0          18m
pod/devpolaris-orders-api-78b6f596dc-mk9z4      0/1     CrashLoopBackOff   5          17m
pod/devpolaris-orders-api-78b6f596dc-qk88c      1/1     Running            0          18m
```

That output tells a simple story. The Deployment wants three available replicas. The ReplicaSet created three Pods. One Pod is repeatedly crashing, so the next evidence should come from that Pod and its `api` container.

`CrashLoopBackOff` means Kubernetes has started the container, the container has exited, and kubelet is delaying the next restart because the failures are repeating. The delay protects the node from a tight restart loop. It also means current logs may belong to a new short-lived run, while the most useful error may be in previous logs.

For multi-container Pods, name the containers before reading logs. This avoids reading a healthy sidecar while the application container is failing:

```bash
$ kubectl -n orders get pod devpolaris-orders-api-78b6f596dc-mk9z4 \
  -o jsonpath='{.spec.containers[*].name}'
api envoy-metrics
```

This Pod has the application container and a metrics sidecar. If you forget `-c api`, you may read the sidecar and miss the application failure. Container names keep the investigation honest.

## Current Logs: What the Container Said
<!-- section-summary: Current logs show stdout and stderr from the running container, which makes them useful after you know the exact Pod and container. -->

**Container logs** are the lines written by the process inside the container. Kubernetes stores recent logs on the node and `kubectl logs` reads them through the Kubernetes API. They are perfect for answering what the application knew and reported.

For the failing orders API Pod, current logs might look like this. The useful part is the component and the missing configuration name:

```bash
$ kubectl -n orders logs pod/devpolaris-orders-api-78b6f596dc-mk9z4 -c api --tail=80
2026-05-07T10:22:18Z info config loaded environment=prod
2026-05-07T10:22:19Z error POSTGRES_URL missing from environment
2026-05-07T10:22:19Z fatal cannot start without database configuration
```

Those lines point toward configuration, not the database server itself. The app did not try and fail to connect to PostgreSQL. It never received the environment variable that tells it where PostgreSQL is.

Logs from the Deployment can be handy for a quick comparison. Use that view to compare replicas, then return to the exact Pod when the failure is narrow:

```bash
$ kubectl -n orders logs deploy/devpolaris-orders-api -c api --tail=20 --prefix
[pod/devpolaris-orders-api-78b6f596dc-7x2tb/api] info server ready port=8080
[pod/devpolaris-orders-api-78b6f596dc-qk88c/api] info server ready port=8080
```

That view shows the healthy replicas, but it may skip the crashed one if it is between restarts. For precise debugging, the exact Pod name is still the better target.

Application logs should include enough context for humans and machines. The orders team wants fields such as `request_id`, `route`, `component`, `error`, `pod`, `image`, and `revision` in its central log system. In local `kubectl logs`, even a few structured fields can make the difference between "database is broken" and "environment variable was never injected."

## Previous Logs: Evidence From the Last Crash
<!-- section-summary: Previous logs read the terminated container instance, which is often where the first useful CrashLoopBackOff error lives. -->

When `RESTARTS` is greater than zero, **previous logs** are often the most important logs. The `--previous` flag asks Kubernetes for logs from the last terminated container instance with the same name. That is exactly what you need when a container crashes quickly and starts again.

For the orders API Pod, previous logs might show the first failure cleanly. This is especially helpful when the current container has already restarted:

```bash
$ kubectl -n orders logs pod/devpolaris-orders-api-78b6f596dc-mk9z4 \
  -c api \
  --previous \
  --tail=80
2026-05-07T10:19:54Z info server starting port=8080
2026-05-07T10:19:55Z error POSTGRES_URL missing from environment
2026-05-07T10:19:55Z fatal cannot start without database configuration
```

This is the same symptom, but now you know it happened in a terminated instance. Combine that with the restart count and the Pod status, and the shape is clear: Kubernetes starts the container, the process exits during startup, kubelet waits, and then kubelet tries again.

Previous logs also matter for liveness failures. A container may restart because the liveness probe failed, and the current process may look healthy after restart. The previous logs help you find the app-side warning just before kubelet killed the old container.

```bash
$ kubectl -n orders logs pod/devpolaris-orders-api-7c96df7d7c-2vd6k -c api --previous --tail=40
2026-05-07T11:04:10Z warn health_liveness_failed component=http_server reason="event loop stalled"
2026-05-07T11:04:30Z warn health_liveness_failed component=http_server reason="event loop stalled"
2026-05-07T11:04:50Z warn shutdown signal=SIGTERM source=kubelet
```

Those lines connect the application symptom to the platform action. The app reported liveness failure, and kubelet later restarted it. That is very different from an image pull failure or a missing Secret.

![CrashLoop evidence diagram comparing previous run logs, current run logs, restart count, events, and root cause clues](/content-assets/articles/article-containers-orchestration-kubernetes-operations-logs-and-events/crashloop-evidence.png)

*CrashLoopBackOff investigations often need both the current container and the previous terminated one. The image highlights why `--previous` can hold the first useful error.*

## Events: What Kubernetes Decided
<!-- section-summary: Events explain Kubernetes decisions such as scheduling, image pulling, probe failure, Secret errors, and backoff behavior. -->

**Events** are short records created by Kubernetes components when something important happens to an object. They are recent operational clues, not a long-term audit log. They are exactly the right tool when the application log cannot explain what Kubernetes did around the container.

The fastest event view for one Pod is usually inside `describe pod`. It puts container state and recent events in the same output:

```bash
$ kubectl -n orders describe pod devpolaris-orders-api-78b6f596dc-mk9z4
Events:
  Type     Reason     Age                 From               Message
  Normal   Scheduled  18m                 default-scheduler  Successfully assigned orders/devpolaris-orders-api-78b6f596dc-mk9z4 to worker-2
  Normal   Pulled     17m                 kubelet            Successfully pulled image "ghcr.io/devpolaris/orders-api:2026-05-07.2"
  Warning  Failed     17m                 kubelet            Error: secret "orders-prod-env" not found
  Normal   BackOff    2m (x7 over 16m)    kubelet            Back-off restarting failed container api
```

Now the earlier log line makes sense. The app said `POSTGRES_URL missing`. The event says kubelet could not find the Secret named `orders-prod-env`, so the environment variables never reached the container. The likely fix is a Secret name, namespace, or deployment reference issue.

The namespace event list can show the rollout order. Sorting by timestamp makes the cause-and-effect chain easier to read:

```bash
$ kubectl -n orders get events --sort-by=.lastTimestamp
LAST SEEN   TYPE      REASON              OBJECT                                      MESSAGE
18m         Normal    ScalingReplicaSet   deployment/devpolaris-orders-api             Scaled up replica set devpolaris-orders-api-78b6f596dc to 3
17m         Warning   Failed              pod/devpolaris-orders-api-78b6f596dc-mk9z4   Error: secret "orders-prod-env" not found
2m          Normal    BackOff             pod/devpolaris-orders-api-78b6f596dc-mk9z4   Back-off restarting failed container api
```

That is enough evidence to inspect the Deployment reference and the Secret. The next commands check whether the manifest points at something that exists:

```bash
$ kubectl -n orders get secret orders-prod-env
Error from server (NotFound): secrets "orders-prod-env" not found

$ kubectl -n orders get deploy devpolaris-orders-api \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="api")].envFrom}'
[{"secretRef":{"name":"orders-prod-env"}}]
```

The Deployment expects a Secret that is absent from the `orders` namespace. Applying the Secret to another namespace would produce this exact shape: missing environment variable in logs, missing Secret event from kubelet, and a crash loop from the app.

## Build a Timeline
<!-- section-summary: A timeline combines rollout status, events, current logs, previous logs, and nearby changes into one evidence trail. -->

Once you have the main clues, build a small timeline. This keeps the team from treating one log line as the whole incident. It also helps the next person understand why you changed a Secret reference instead of debugging database networking.

A useful command sequence for the orders rollout is short. It gathers state, events, and logs before anyone edits the workload:

```bash
$ kubectl -n orders rollout status deployment/devpolaris-orders-api
$ kubectl -n orders get deploy,rs,pod -l app.kubernetes.io/name=devpolaris-orders-api
$ kubectl -n orders describe pod devpolaris-orders-api-78b6f596dc-mk9z4
$ kubectl -n orders logs pod/devpolaris-orders-api-78b6f596dc-mk9z4 -c api --previous --tail=80
$ kubectl -n orders get events --sort-by=.lastTimestamp
```

The written note can be even smaller than the commands. A compact table is often enough for a handoff or pull request comment:

| Evidence | What it says |
|---|---|
| Deployment status | `2/3` replicas available after image `2026-05-07.2` rollout |
| Failing Pod state | `CrashLoopBackOff`, restart count `5` |
| Application previous log | `POSTGRES_URL missing from environment` |
| Pod event | `secret "orders-prod-env" not found` |
| Nearby change | Deployment `envFrom` changed from `orders-env` to `orders-prod-env` |

That timeline points to one fix. Restore the correct Secret reference or create the intended Secret in the `orders` namespace, then watch the rollout. It also gives you a rollback path if the new image is tied to the new config shape.

After the fix, the verification should use the same signals. That keeps diagnosis and recovery tied to the same evidence:

```bash
$ kubectl -n orders rollout status deployment/devpolaris-orders-api
$ kubectl -n orders get pods -l app.kubernetes.io/name=devpolaris-orders-api
$ kubectl -n orders get events --sort-by=.lastTimestamp | tail -20
```

You want three available replicas, no new `Failed` events for the Secret, and logs showing the app passed startup and readiness. The same evidence that diagnosed the failure should prove the recovery.

## When Logs Are Empty
<!-- section-summary: Empty logs usually mean the process never started, so events and container state deserve the first inspection. -->

Sometimes `kubectl logs` returns nothing useful because the application process never started. That can happen with a missing ConfigMap, missing Secret, invalid command, denied image pull, or failed volume mount. In those cases, events are the main evidence.

Here is the shape. The command fails because Kubernetes cannot give you logs from a process that never started:

```bash
$ kubectl -n orders logs pod/devpolaris-orders-api-78b6f596dc-mk9z4 -c api
Error from server (BadRequest): container "api" in pod "devpolaris-orders-api-78b6f596dc-mk9z4" is waiting to start: CreateContainerConfigError
```

The process has not started, so there are no application logs to read. The next useful output is container state and events because kubelet is the component that hit the error:

```bash
$ kubectl -n orders describe pod devpolaris-orders-api-78b6f596dc-mk9z4
Containers:
  api:
    State:          Waiting
      Reason:       CreateContainerConfigError
Events:
  Type     Reason  Age   From     Message
  Warning  Failed  4m    kubelet  Error: configmap "orders-runtime-config" not found
```

The fix direction is the ConfigMap reference, the namespace, or the manifest that should create `orders-runtime-config`. Reading application code will waste time here because the application binary never ran.

Image pull failures have the same event-first shape. The registry or image reference fails before application code gets a chance to run:

```bash
$ kubectl -n orders describe pod devpolaris-orders-api-78b6f596dc-mk9z4
Events:
  Type     Reason   Age   From     Message
  Normal   Pulling  2m    kubelet  Pulling image "ghcr.io/devpolaris/orders-api:2026-05-07.9"
  Warning  Failed   2m    kubelet  Failed to pull image "ghcr.io/devpolaris/orders-api:2026-05-07.9": manifest unknown
  Warning  Failed   2m    kubelet  Error: ErrImagePull
  Normal   BackOff  1m    kubelet  Back-off pulling image
```

No application log can exist until the image starts. The likely causes are an unpublished tag, wrong image name, registry permissions, missing image pull secret, or a bad digest.

## Production Logging Habits
<!-- section-summary: kubectl is excellent for live debugging, but production teams also need centralized logs, event retention, labels, and trace context. -->

`kubectl logs` is a direct troubleshooting tool with a short retention window. Node-local container logs can disappear when Pods move, nodes rotate, or retention windows expire. Kubernetes events can also age out quickly, which means the best evidence may vanish before a later incident review.

Production teams usually ship logs to a central platform such as Loki, Elasticsearch, Cloud Logging, CloudWatch Logs, or another log backend. Many teams also standardize telemetry with **OpenTelemetry**, which can carry logs, metrics, and traces with shared attributes. The exact vendor matters less than the habit: logs should be searchable after the Pod name is gone.

Good labels make both `kubectl` and centralized search easier. They give humans and tools a stable way to group logs after Pod names change:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: devpolaris-orders-api
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: devpolaris
    devpolaris.io/team: orders
```

Those labels let a responder search by application, component, and team instead of guessing Pod names. They also make terminal commands safer because selectors target the service you meant.

Application logs should carry request context. A single line should help you jump from a user symptom to the service component that failed:

```log
2026-05-07T10:31:12Z error request_failed request_id=req-7f2a route=/orders method=POST status=500 component=postgres error="connection refused"
```

That line gives the incident responder a request ID, route, component, and error. If traces are enabled, the same request ID or trace ID can connect the Kubernetes log, API trace, database span, and frontend error.

Events need a handoff habit too. If an event explains the failure, copy the important line into the incident note before it expires. The cluster may forget the event before the team finishes the review:

| Event copied before expiry | Value |
|---|---|
| Type | `Warning` |
| Reason | `Failed` |
| Object | `pod/devpolaris-orders-api-78b6f596dc-mk9z4` |
| Message | `Error: secret "orders-prod-env" not found` |

That copied event helps future reviewers understand why the team changed a manifest after the original event is gone from the cluster. It also lets the next responder trust the investigation without needing the old event object to still exist.

## Operational Checklist
<!-- section-summary: A reliable debugging routine keeps application evidence and Kubernetes evidence side by side until one fix is clear. -->

For `devpolaris-orders-api`, a good logs-and-events routine starts narrow and gets wider only when needed. The point is to learn which object failed, what the process said, and what Kubernetes decided before editing YAML.

| Step | Command or check | Why it helps |
|---|---|---|
| Scope the workload | `kubectl -n orders get deploy,rs,pod -l app.kubernetes.io/name=devpolaris-orders-api` | Finds the failing object |
| Inspect the Pod | `kubectl -n orders describe pod <pod>` | Shows state, restarts, and events |
| Read current logs | `kubectl -n orders logs pod/<pod> -c api --tail=80` | Shows current process output |
| Read previous logs | `kubectl -n orders logs pod/<pod> -c api --previous --tail=80` | Shows the last crashed process |
| Sort events | `kubectl -n orders get events --sort-by=.lastTimestamp` | Shows recent platform decisions |
| Verify recovery | `kubectl -n orders rollout status deployment/devpolaris-orders-api` | Confirms the controller reached the target state |

![Logs and events checklist with describe first, current logs, previous logs, time-sorted events, failure naming, and saved timeline](/content-assets/articles/article-containers-orchestration-kubernetes-operations-logs-and-events/logs-events-checklist.png)

*The checklist shows the smallest useful loop for incidents: scope the object, read both log streams, sort events, name the failure, and keep the timeline for review.*

The main habit is to keep the stories separate until they agree. Logs tell you what the application saw. Events tell you what Kubernetes did. Object state tells you where to look. A clear incident note puts those pieces next to each other so the fix has evidence behind it.

For the orders rollout, the final diagnosis might be only one sentence in the incident summary, but it should rest on both stories: the app failed startup because `POSTGRES_URL` was missing, and kubelet reported the Secret that should have provided it did not exist in the `orders` namespace. That is a much stronger conclusion than either the log line or the event line on its own.

---

**References**

- [Kubernetes: kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/) - Official command reference for current logs, previous logs, selectors, and container targeting.
- [Kubernetes: Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/) - Official guide for inspecting Pods, logs, and events during application debugging.
- [Kubernetes: Viewing Pods and Nodes](https://kubernetes.io/docs/tutorials/kubernetes-basics/explore/explore-intro/) - Introductory task guide for inspecting Pod state and using `describe`.
- [Kubernetes Events API](https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/) - API reference for event objects and fields.
- [Kubernetes: Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/) - Explains node-level and cluster-level logging patterns.
- [OpenTelemetry Logs](https://opentelemetry.io/docs/concepts/signals/logs/) - Defines logs as an OpenTelemetry signal and explains how logs connect with other telemetry.
