---
title: "Logs and Events"
description: "Use Kubernetes logs and events together to explain what happened to Pods, Deployments, and cluster objects."
tags: ["Kubernetes", "Operations", "Debugging", "Logs"]
area: "Containers & Orchestration"
order: 2
id: article-containers-orchestration-kubernetes-operations-logs-and-events
---
## Table of Contents

- [Two Stories in One Incident](#two-stories-in-one-incident)
- [Scope the Failing Object](#scope-the-failing-object)
- [Current Logs: What the Container Says Now](#current-logs-what-the-container-says-now)
- [Previous Logs: What the Last Container Said](#previous-logs-what-the-last-container-said)
- [Events: What Kubernetes Decided](#events-what-kubernetes-decided)
- [Build the Timeline](#build-the-timeline)
- [When Logs Are Empty](#when-logs-are-empty)
- [Production Logging Habits](#production-logging-habits)
- [Operational Checklist](#operational-checklist)
- [References](#references)

## Two Stories in One Incident
<!-- section-summary: Logs tell the application story, while Kubernetes events tell the platform story around scheduling, pulling images, probes, restarts, and object changes. -->

Kubernetes **logs and events** answer different parts of the same production question: what happened to this workload? Logs come from the container process. Events come from Kubernetes components such as the scheduler, kubelet, and controllers.

Use a real incident path for `devpolaris-orders-api`: a rollout created new Pods, users saw checkout errors, and the Deployment stayed below its desired ready count. The application log might say the process failed because `POSTGRES_URL` was missing. The Kubernetes event might say the Secret that should provide that value was absent.

Keep those two stories side by side. Logs explain what the process experienced. Events explain what Kubernetes attempted and why it changed object state.

![Incident evidence map connecting object state, current logs, previous logs, events, and a timeline for the next safe debugging check](/content-assets/articles/article-containers-orchestration-kubernetes-operations-logs-and-events/incident-evidence-map.png)

*The evidence map keeps the investigation ordered: object state points to the Pod, logs show process output, events show platform decisions, and the timeline keeps the fix honest.*

## Scope the Failing Object
<!-- section-summary: Scope the Deployment, ReplicaSet, and Pods so the investigation follows the controller chain instead of chasing a random Pod name. -->

Start by finding the exact workload objects involved in the incident. The Deployment describes desired state, the ReplicaSet connects the rollout revision, and the Pods show the current running attempts.

```bash
$ kubectl -n orders get deploy,rs,pod -l app.kubernetes.io/name=devpolaris-orders-api
NAME                                      READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/devpolaris-orders-api     2/3     1            2           18m

NAME                                                 DESIRED   CURRENT   READY   AGE
replicaset.apps/devpolaris-orders-api-78b6f596dc      1         1         0       4m

NAME                                           READY   STATUS             RESTARTS   AGE
pod/devpolaris-orders-api-78b6f596dc-mk9z4     0/1     CrashLoopBackOff   4          4m
```

What this output gives you:

- The rollout has one new Pod that is failing.
- The older Pods still serve traffic.
- The right next target is the failing Pod and its owning ReplicaSet.

## Current Logs: What the Container Says Now
<!-- section-summary: Current logs show the output from the container instance that is running at the moment you ask. -->

Use current logs for a container that is running long enough to print useful messages. Target the container name when the Pod has a sidecar or init containers.

```bash
$ kubectl -n orders logs pod/devpolaris-orders-api-78b6f596dc-mk9z4 -c api --tail=40
2026-06-30T09:40:12Z INFO starting devpolaris-orders-api
2026-06-30T09:40:13Z ERROR configuration POSTGRES_URL is required
2026-06-30T09:40:13Z INFO shutting down
```

What the log says:

- The image started and reached application code.
- The failure points to application configuration; scheduling already succeeded.
- The missing key has a name, so the next check should look at environment and Secret wiring.

Current logs can be empty if the process exits too quickly. That is where previous logs help.

## Previous Logs: What the Last Container Said
<!-- section-summary: Previous logs preserve the output from the prior crashed container instance in a restarted Pod. -->

When a Pod enters `CrashLoopBackOff`, the current container may be between restarts. The `--previous` flag shows the logs from the terminated container instance.

```bash
$ kubectl -n orders logs pod/devpolaris-orders-api-78b6f596dc-mk9z4 -c api --previous --tail=40
2026-06-30T09:41:44Z INFO starting devpolaris-orders-api
2026-06-30T09:41:44Z ERROR configuration POSTGRES_URL is required
```

What this output proves:

- The failure repeats across restarts.
- The restart loop comes from the same startup error.
- The Pod is crashing after the app starts, so image pull and scheduling are probably past the critical path.

![CrashLoop evidence diagram comparing previous run logs, current run logs, restart count, events, and root cause clues](/content-assets/articles/article-containers-orchestration-kubernetes-operations-logs-and-events/crashloop-evidence.png)

*The CrashLoop evidence view keeps the current run, previous run, restart count, and events in one place.*

## Events: What Kubernetes Decided
<!-- section-summary: Events record Kubernetes actions such as scheduling, image pulls, probe failures, missing Secrets, and backoff decisions. -->

Kubernetes events explain platform-side decisions. They are especially useful when the application log is empty or the failure happens before application code runs.

```bash
$ kubectl -n orders get events --field-selector involvedObject.name=devpolaris-orders-api-78b6f596dc-mk9z4 --sort-by=.lastTimestamp
LAST SEEN   TYPE      REASON    OBJECT                                             MESSAGE
4m          Normal    Pulled    pod/devpolaris-orders-api-78b6f596dc-mk9z4          Container image already present on machine
3m          Warning   Failed    pod/devpolaris-orders-api-78b6f596dc-mk9z4          Error: secret "orders-prod-env" not found
2m          Warning   BackOff   pod/devpolaris-orders-api-78b6f596dc-mk9z4          Back-off restarting failed container api
```

What the events add:

- Kubernetes could pull or find the image.
- Kubelet failed when resolving the referenced Secret.
- The backoff is a consequence of repeated container failures.

Events have retention limits, so copy the important lines into the incident note while they still exist.

## Build the Timeline
<!-- section-summary: A useful incident timeline combines object changes, events, logs, and recovery checks in timestamp order. -->

The incident path should read like a production handoff. Each row should say what was observed, where it came from, and what it proved.

| Time | Evidence | What it proved |
|---|---|---|
| `09:38` | Deployment rollout started | New ReplicaSet created |
| `09:39` | Pod event `Failed` | Secret `orders-prod-env` missing |
| `09:40` | Previous logs | App required `POSTGRES_URL` |
| `09:44` | Secret restored | Required environment source existed again |
| `09:46` | Rollout status | Deployment reached `3/3` available |

Verify recovery with a controller-level command:

```bash
$ kubectl -n orders rollout status deployment/devpolaris-orders-api
deployment "devpolaris-orders-api" successfully rolled out
```

The success line matters because it confirms the Deployment reached its target state after the fix.

## When Logs Are Empty
<!-- section-summary: Empty logs usually mean the failure happened before application code, in a different container, or outside the Pod. -->

Empty logs are evidence too. They usually point to one of four places: wrong container, early process exit, image or command failure before logging, or a platform failure that kept the container from running.

Use this quick route:

```bash
$ kubectl -n orders describe pod devpolaris-orders-api-78b6f596dc-mk9z4
Containers:
  api:
    State:          Waiting
      Reason:       CreateContainerConfigError
Events:
  Warning  Failed  Error: secret "orders-prod-env" not found
```

What this output says:

- The container never reached a normal running state.
- Application logs can be empty because kubelet failed during container setup.
- Fix configuration or Secret creation before changing app logging.

## Production Logging Habits
<!-- section-summary: Production logs should name the operation, request context, failure reason, and safe correlation fields without leaking secrets. -->

Good Kubernetes logging habits make later investigations faster. The application should write logs to stdout and stderr so the node runtime can collect them. Each important line should include service name, environment, operation, status, and a request or trace ID.

Example application log:

```json
{"time":"2026-06-30T09:40:13Z","service":"devpolaris-orders-api","level":"error","operation":"startup","error":"POSTGRES_URL is required","trace_id":"none"}
```

What this log gives the team:

- It names the service and operation.
- It gives the exact missing setting.
- It avoids printing the Secret value.
- It can connect with traces later if a trace ID exists.

## Operational Checklist
<!-- section-summary: A reliable debugging routine keeps application evidence and Kubernetes evidence side by side until one fix is clear. -->

Use this checklist during a `devpolaris-orders-api` incident:

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

The final incident sentence should join both stories: the application failed startup because `POSTGRES_URL` was missing, and kubelet reported the Secret that should provide it was absent in the `orders` namespace.

## References

- [Kubernetes: kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/) - Official command reference for current logs, previous logs, selectors, and container targeting.
- [Kubernetes: Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/) - Official guide for inspecting Pods, logs, and events during application debugging.
- [Kubernetes: Viewing Pods and Nodes](https://kubernetes.io/docs/tutorials/kubernetes-basics/explore/explore-intro/) - Introductory task guide for inspecting Pod state and using `describe`.
- [Kubernetes Events API](https://kubernetes.io/docs/reference/kubernetes-api/cluster-resources/event-v1/) - API reference for event objects and fields.
- [Kubernetes: Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/) - Explains node-level and cluster-level logging patterns.
- [OpenTelemetry Logs](https://opentelemetry.io/docs/concepts/signals/logs/) - Defines logs as an OpenTelemetry signal and explains how logs connect with other telemetry.
