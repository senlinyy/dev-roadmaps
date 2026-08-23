---
title: "Logs and Events"
description: "Use container logs, Kubernetes Events, and Pod state together to explain workload behavior."
overview: "Logs record what a container process reports. Events record short-lived observations from Kubernetes components. Pod state connects both streams to one container run."
tags: ["Kubernetes", "Operations", "Debugging", "Logs"]
area: "Containers & Orchestration"
order: 2
id: article-containers-orchestration-kubernetes-operations-logs-and-events
---

## Table of Contents

1. [Why do container logs, Kubernetes Events, and Pod state answer different questions?](#why-do-container-logs-kubernetes-events-and-pod-state-answer-different-questions)
2. [How do you locate the exact Pod and container that produced an observation?](#how-do-you-locate-the-exact-pod-and-container-that-produced-an-observation)
3. [What do current and previous logs preserve across a container restart?](#what-do-current-and-previous-logs-preserve-across-a-container-restart)
4. [How do Events connect Kubernetes actions to object state?](#how-do-events-connect-kubernetes-actions-to-object-state)
5. [What can Pod state and Events reveal when container logs are sparse?](#what-can-pod-state-and-events-reveal-when-container-logs-are-sparse)
6. [How do you combine status, logs, and Events into a causal sequence?](#how-do-you-combine-status-logs-and-events-into-a-causal-sequence)
7. [What must a production logging pipeline and application log format provide?](#what-must-a-production-logging-pipeline-and-application-log-format-provide)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

The explanation follows 7 practical questions:

1. **Why do container logs, Kubernetes Events, and Pod state answer different questions?**
2. **How do you locate the exact Pod and container that produced an observation?**
3. **What do current and previous logs preserve across a container restart?**
4. **How do Events connect Kubernetes actions to object state?**
5. **What can Pod state and Events reveal when container logs are sparse?**
6. **How do you combine status, logs, and Events into a causal sequence?**
7. **What must a production logging pipeline and application log format provide?**

## Why do container logs, Kubernetes Events, and Pod state answer different questions?
<!-- section-summary: Container logs, Kubernetes Events, and Pod state describe different parts of the same workload lifecycle. -->

A container can run only after several Kubernetes components have done their work. The scheduler chooses a node. The kubelet pulls the image, prepares volumes and environment data, and asks the container runtime to start the process. The process then reads its configuration and begins its own application work.

Each part can report what it observed:

- **container logs** come from the process's standard output and standard error streams;
- **Kubernetes Events** come from components such as the scheduler, kubelet, and controllers; and
- **Pod status** records the current and most recent container states, readiness conditions, restart counts, reasons, and exit codes.

Suppose a `checkout` Deployment has several Pods. One Pod cannot schedule, another cannot pull its image, and a third starts the application and then exits. They can all look unhealthy in a list even though the failures belong to different lifecycle stages.

The three Pods may all appear unhealthy in a list, yet their causes live at different stages:

| Stage reached | Strong first evidence | Example |
|---|---|---|
| Scheduling | Pod conditions and scheduler Events | `FailedScheduling` explains insufficient memory |
| Container setup | Waiting reason and kubelet Events | `FailedMount` identifies a missing volume source |
| Application process | Current or previous container logs | Application output reports why the process exited |

Logs and Events therefore complement each other. A process can describe only the work it reached. Kubernetes components can describe the platform actions they attempted. Pod state tells you which stage and container run those observations belong to.

### A Pod is not one process

One Pod can contain an init container that performs a migration, an application container, and a proxy sidecar. Each process owns a different output stream, while scheduler and kubelet Events concern the Pod and its setup. Saying “the Pod crashed” discards the identity needed to choose evidence.

```text
Pod checkout-7c8f9d-q7m4z
├── init container migrate-db -> its logs and status
├── container checkout        -> its logs and restart history
└── container envoy           -> its logs and status

Kubernetes observations       -> Pod conditions and Events
```

If `migrate-db` fails, the checkout process may never start and its log stream is correctly empty. If the scheduler cannot place the Pod, none of the container streams can exist yet. The lifecycle stage determines whether process output is possible, so sparse logs are evidence rather than automatically a logging failure.


## How do you locate the exact Pod and container that produced an observation?
<!-- section-summary: Namespace, controller ownership, Pod revision, container name, and node placement identify the source before log reading begins. -->

`kubectl logs` needs a concrete log source. That source is a container inside a Pod in a namespace. A Deployment name is useful for finding the family, while the generated Pod name identifies one running copy.

Start from the controller and follow its label to the Pods:

```bash
kubectl get deployment checkout -n production

kubectl get pods -n production \
  -l app=checkout \
  -o wide
```

A possible result is:

```text
NAME                             READY   STATUS             RESTARTS   NODE
checkout-7c8f9d-x2k9p       1/1     Running            0          node-3
checkout-7c8f9d-q7m4z       0/1     CrashLoopBackOff   6          node-5
```

The generated suffix matters. These Pods belong to the same Deployment, yet each has its own node, restart history, Events, and log files. The second Pod is the useful target.

Next, list its containers:

```bash
kubectl get pod checkout-7c8f9d-q7m4z \
  -n production \
  -o jsonpath='{.spec.initContainers[*].name}{"\n"}{.spec.containers[*].name}{"\n"}'
```

Suppose the result is:

```text
migrate-db
checkout envoy
```

Each name selects a separate log stream:

```bash
kubectl logs pod/checkout-7c8f9d-q7m4z \
  -n production \
  -c checkout

kubectl logs pod/checkout-7c8f9d-q7m4z \
  -n production \
  -c migrate-db
```

The init-container stream answers whether setup completed. The application stream answers what the checkout process reported. The sidecar stream describes its own telemetry work. Mixing those sources can produce a convincing yet unrelated explanation, so record the namespace, Pod, container, and image beside every important excerpt.

For several replicas, a label selector can gather bounded output and prefix each line with its source:

```bash
kubectl logs -n production \
  -l app=checkout \
  -c checkout \
  --prefix \
  --tail=50 \
```

This view helps compare replicas. A single-Pod command remains better for restart history because every Pod has a separate lifecycle.

Record the Pod UID when replacement is possible. A controller may delete one Pod and create another with a different generated name and UID, while kubelet can restart a container several times inside one unchanged Pod. “New container instance” and “new Pod” are different transitions with different local history.

A row showing `Running` and `RESTARTS=7` can therefore mean that the eighth instance of the container is active now. Current state describes this moment; restart count and `lastState` preserve evidence that earlier instances terminated.

## What do current and previous logs preserve across a container restart?
<!-- section-summary: Current logs belong to the active container instance, while previous logs expose the immediately preceding terminated instance retained by kubelet. -->

A Pod keeps its name while kubelet restarts one of its containers. Think of the Pod as the envelope and each container start as a numbered attempt inside it.

For the active attempt, use the normal command:

```bash
kubectl logs pod/checkout-7c8f9d-q7m4z \
  -n production \
  -c checkout \
  --timestamps \
  --tail=80
```

For the immediately preceding terminated attempt, add `--previous`:

```bash
kubectl logs pod/checkout-7c8f9d-q7m4z \
  -n production \
  -c checkout \
  --previous \
  --timestamps \
  --tail=80
```

Suppose the previous output ends with:

```text
starting checkout service
authentication failed for user checkout
```

This proves that the container reached application code and reported an authentication failure before it exited. A `BackOff` Event may explain why kubelet delays the next restart, while the previous logs explain why the last process exited.

Kubelet normally retains logs for one terminated container instance. Another restart replaces that previous slot. Pod eviction removes the Pod's containers from the node together with their node-local logs. Log rotation can also limit the bytes available through `kubectl logs`; kubelet serves only the latest log file for the selected container.

These boundaries make `--previous` a focused recovery tool. A central log store carries history across many restarts, Pod replacement, node removal, and longer time ranges.

Think of the local interface as two slots rather than an archive:

```text
kubectl logs            -> current container instance
kubectl logs --previous -> immediately preceding terminated instance
older instances         -> require separately exported durable logs
```

The previous slot is most valuable during a restart loop because the current instance may contain only new startup messages. Capture it before another restart replaces it. Even then, node-side rotation limits the available file, so incident response should not treat `kubectl logs` as complete historical storage.


## How do Events connect Kubernetes actions to object state?
<!-- section-summary: Events attach a reason, message, reporting component, and time information to Kubernetes observations about an object. -->

An Event is a Kubernetes object that reports a notable occurrence concerning another object. The scheduler can report a placement problem. Kubelet can report image pulls, volume setup, probe failures, container creation, and restart backoff. Controllers can report work they perform for their resources.

Ask for Events associated with one Pod:

```bash
kubectl events \
  -n production \
  --for pod/checkout-7c8f9d-q7m4z \
  --types=Warning,Normal
```

Example output:

```text
LAST SEEN   TYPE      REASON    OBJECT                                           MESSAGE
2m          Normal    Pulled    Pod/checkout-7c8f9d-q7m4z               Container image already present on machine
45s         Warning   BackOff   Pod/checkout-7c8f9d-q7m4z               Back-off restarting failed container checkout
```

Read each row as a structured observation:

- **regarding object** identifies the resource being discussed;
- **reason** supplies a short machine-oriented category such as `FailedScheduling`, `FailedMount`, or `BackOff`;
- **note or message** adds human-readable detail;
- **reporting controller and instance** identify the source; and
- **event time or series data** records observation timing and repetition.

Repeated occurrences can be represented as one Event series with a count and last-observed time. A line that shows `BackOff` 14 times summarizes one recurring observation from kubelet. Root-cause interpretation still comes from the surrounding state and process evidence.

Events have limited retention and best-effort delivery. Reasons and message wording can evolve across component versions. Treat them as timely supporting evidence. Object status, controller state, application records, metrics, durable logs, and API audit logs cover longer-lived or different questions.

`kubectl describe pod` includes related Events at the bottom and remains convenient for one-object reading:

```bash
kubectl describe pod checkout-7c8f9d-q7m4z -n production
```

The dedicated `kubectl events --for ...` view is helpful when you want the Event stream alone or want to watch new observations as they arrive.

An Event often reports Kubernetes' reaction rather than the initiating defect. `BackOff` says kubelet is delaying repeated restarts; it does not say why the process exited. `Unhealthy` says a probe failed; application state explains why the endpoint returned failure. `FailedScheduling` is closer to the blocking decision because scheduling stopped before any process existed. Always ask which component produced the Event and what earlier condition it observed.

## What can Pod state and Events reveal when container logs are sparse?
<!-- section-summary: Waiting and terminated state fields explain how far a container progressed and direct the next evidence request. -->

Sparse logs can be completely consistent with the lifecycle. A process produces output only after the runtime has created and started it. Earlier failures leave stronger evidence in Pod state and Events.

Inspect the selected Pod as structured data:

```bash
kubectl get pod checkout-7c8f9d-q7m4z \
  -n production \
  -o jsonpath='{range .status.containerStatuses[*]}{.name}{"\n  current="}{.state}{"\n  previous="}{.lastState}{"\n  restarts="}{.restartCount}{"\n"}{end}'
```

Four common patterns point to different next steps:

| Pod or container state | Meaning | Next evidence |
|---|---|---|
| Pod `Pending`, condition `PodScheduled=False` | Scheduler is still seeking a suitable node | `kubectl events --for pod/...` and scheduling constraints |
| Waiting `ImagePullBackOff` | Kubelet is retrying image acquisition | image name, registry credentials, kubelet Event message |
| Waiting `CreateContainerConfigError` | Container setup is waiting for required configuration resolution | referenced ConfigMaps, Secrets, and Event message |
| Previous state `Terminated` with exit code | Process started and ended | `kubectl logs --previous`, termination reason, application contract |

Consider an image name or tag that the registry cannot provide. Image acquisition blocks process startup because kubelet receives a registry failure. An empty application log stream is expected. The waiting reason names the stage, and the `Failed` or `BackOff` Event carries the registry response.

Now consider a readiness probe that receives HTTP 503. The application process may continue running and producing logs. Kubelet Events can report probe failures, Pod readiness stays false, and Service endpoints exclude the Pod until readiness recovers. Reading only application error lines would miss the routing consequence recorded in Pod conditions.

Exit codes also need their owning process contract. Kubernetes can report exit code `2`; the application documentation or source explains that this particular binary uses `2` for invalid input. The platform supplies the observation, while the program defines its meaning.

Pod phase requires the same care. The formal phase can remain `Running` while `kubectl` displays `CrashLoopBackOff` in its human-oriented STATUS column because one container is repeatedly terminating and waiting. `CrashLoopBackOff` is a waiting reason and operational symptom, not a Pod phase. Inspect `containerStatuses[].state`, `lastState`, and `restartCount` to recover the underlying structure.

Conditions show how far the Pod progressed. `PodScheduled=True` and `Initialized=True` with `ContainersReady=False` narrows the failure beyond placement and initialization toward the regular containers or their readiness. This is much more actionable than reading the top-level phase alone.

## How do you combine status, logs, and Events into a causal sequence?
<!-- section-summary: A causal sequence orders controller state, Pod state, Events, and process output by lifecycle stage and checks the result after one change. -->

A good explanation names the chain of cause and effect. It avoids treating the last visible warning as the cause automatically.

For the checkout Pod, collect a small evidence set:

```bash
kubectl get pods -n production -l app=checkout -o wide

kubectl get pod checkout-7c8f9d-q7m4z \
  -n production \
  -o yaml

kubectl describe pod checkout-7c8f9d-q7m4z -n production

kubectl events -n production --for pod/checkout-7c8f9d-q7m4z

kubectl logs checkout-7c8f9d-q7m4z -n production -c checkout \
  --previous --timestamps
```

Then order the observations by the lifecycle they describe:

1. The scheduler bound the Pod to a Node.
2. Kubelet made the image available, created the container, and started it.
3. The checkout process tried to connect to PostgreSQL, reported an authentication failure, and exited with code `1`.
4. Kubernetes observed the termination, and kubelet attempted a restart.
5. Repeated failures produced restart backoff, which `kubectl` displayed as `CrashLoopBackOff`.

The process log explains the application failure. The BackOff Event explains Kubernetes's later restart delay. Ordering them keeps an effect from being mistaken for the initiating cause.

The causal wording should preserve both sides: “PostgreSQL rejected checkout authentication, the process exited with code 1, kubelet restarted it, and repeated exits caused restart backoff.” The database failure is the cause reported by the process; exit state is the structured observation; restart and BackOff are Kubernetes reactions. Each clause has a distinct evidence source.

After correcting the application input, repeat the same Pod status, Event, and current-log checks and reconstruct the timeline again. The recovery is proved when the container remains running, readiness returns, restart backoff stops growing, and the application evidence shows a successful start.

The verification should show the controller reaching its desired available count, current Pods ready, and the application remaining running. Checks at the same layers show whether the cause-and-effect chain changed.

## What must a production logging pipeline and application log format provide?
<!-- section-summary: Node-local container logs are bounded by rotation and Pod placement, so durable search requires a cluster-level logging pipeline. -->

The container runtime redirects standard output and standard error into the CRI log format. Kubelet manages the log directory and rotation policy on each node, and it serves the selected container's latest log file through the Pod log API used by `kubectl logs`.

That local path is valuable for immediate inspection. Its lifecycle remains tied to the node, container, rotation limits, and Pod placement. Kubernetes supplies the access mechanism and leaves cluster-level retention, indexing, and search to a separate logging system.

A common pipeline runs a node-level logging agent as a DaemonSet. The application writes to standard output or standard error, the container runtime records those streams in CRI log files on the node, and the agent reads those files. It enriches each record with Kubernetes metadata and sends batches to a central backend with retention and search. Useful metadata includes namespace, Pod, container, node, controller labels, image, and cluster identity. The backend then supports questions across replaced Pods, such as “show checkout errors from every replica during this deployment window.”

The independent lifecycle is the essential property:

```text
application stdout/stderr
        ↓
node-local CRI log files
        ↓
DaemonSet logging agent
        ↓
central store with retention, indexing, and search
```

When Pod A is deleted, Node B fails, and replacement Pod C starts elsewhere, the central store can still preserve one searchable incident window. Kubernetes provides the container log interface but does not provide that long-term backend automatically.

Events need their own collection decision. Their API objects are short-lived and best-effort, so an observability pipeline can export selected Events to a durable backend when later comparison matters. API audit logs serve a separate purpose: they record requests made to the Kubernetes API according to the cluster's audit policy.


### How to Write Logs That Remain Useful
<!-- section-summary: Structured records with stable context, explicit outcomes, and protected sensitive data make container output searchable and comparable. -->

The logging pipeline can transport records, yet the application decides what those records explain. A production-ready line lets a reader identify the component, operation, subject, and outcome.

The checkout process can emit one structured JSON record per event:

```json
{
  "timestamp": "2026-08-20T02:17:31.413Z",
  "level": "error",
  "service": "checkout",
  "environment": "production",
  "event": "database_connection_failed",
  "request_id": "req-91fa",
  "trace_id": "2af873...",
  "database": "orders-primary",
  "attempt": 3,
  "duration_ms": 2011,
  "error_type": "timeout"
}
```

This record names the service, environment, event, request and trace, dependency, attempt, duration, and error type. Those stable fields let a backend group similar failures while retaining the context needed to reconstruct one request.

Use a bounded, stable vocabulary for fields such as level, operation, and error kind. Place changing detail in separate values. A chart can count a stable error type even when the human-readable message changes.

Sensitive values deserve deliberate exclusion. Log the Secret name or configuration key needed for diagnosis, while credentials, tokens, session data, and personal records stay out of the message. Logging libraries can add redaction and field allowlists before serialization.

### A Practical Evidence Route
<!-- section-summary: The shortest useful route follows object identity, lifecycle state, the matching evidence source, and recovery at the owning controller. -->

Use the lifecycle stage to choose the next observation:

| Observation | Read next | Question answered |
|---|---|---|
| Deployment below desired availability | ReplicaSet and Pod list | Which revision and Pod are behind? |
| Pod remains `Pending` | Pod conditions and Events | Which scheduling requirement is unsatisfied? |
| Container waits in setup | Waiting reason and Events | Which image, mount, Secret, or configuration step failed? |
| Container restart count rises | Previous logs and terminated state | What did the preceding process report and how did it exit? |
| Pod runs while readiness stays false | Probe Events, conditions, and application logs | What response did kubelet observe and what is the app doing? |
| Pod was replaced or node history is needed | Central logs and exported Events | What evidence survived the local lifecycle? |

Keep the target explicit in every command:

```bash
namespace=production
pod=checkout-7c8f9d-q7m4z
container=checkout

kubectl get pod "$pod" -n "$namespace" -o wide
kubectl describe pod "$pod" -n "$namespace"
kubectl logs pod/"$pod" -n "$namespace" -c "$container" --tail=80
kubectl logs pod/"$pod" -n "$namespace" -c "$container" --previous --tail=80
kubectl events -n "$namespace" --for pod/"$pod"
```

Some commands will naturally return little data. For a container with zero restarts, the previous-instance view is empty. Image-pull failure leaves the application stream empty. These results narrow the lifecycle stage and point to the next source.

The final explanation can stay plain: the new Pod reached application startup, the application reported an authentication failure, kubelet restarted that container three times, and the Pod stayed unready during those attempts. Every clause comes from a named observation.

## Check Your Answers
<!-- section-summary: Revisit evidence ownership, source identity, restart history, Events, sparse logs, causal ordering, and durable logging. -->

:::expand[Why do container logs, Kubernetes Events, and Pod state answer different questions?]{kind="recap"}
Container logs report what one process wrote after it started. Events report observations made by Kubernetes components while scheduling and running objects. Pod state connects those observations to waiting, running, and terminated container instances, readiness, restarts, reasons, and exit codes.
:::

:::expand[How do you locate the exact Pod and container that produced an observation?]{kind="recap"}
Start from the controller and its labels, then select the namespace and generated Pod name. List init containers and regular containers, choose the relevant container with `-c`, and record the image and node. Each Pod and container has its own state, Events, and log stream.
:::

:::expand[What do current and previous logs preserve across a container restart?]{kind="recap"}
The normal log view reads the active container instance. `--previous` reads the immediately preceding terminated instance retained by kubelet for that Pod and container. Later restarts, log rotation, Pod eviction, and node lifecycle bound the history available through this local interface.
:::

:::expand[How do Events connect Kubernetes actions to object state?]{kind="recap"}
An Event names the object it concerns, a reason, a human-readable message, a reporting component, and timing or repetition data. Scheduler, kubelet, and controller Events help explain state such as unscheduled Pods, failed mounts, image retries, probe failures, and restart backoff.
:::

:::expand[What can Pod state and Events reveal when container logs are sparse?]{kind="recap"}
Waiting reasons and Events show failures that occur before the process starts, including scheduling, image acquisition, volume setup, and configuration resolution. Terminated state supplies an exit code and reason after a process run. The lifecycle stage explains why a log stream may contain little data.
:::

:::expand[How do you combine status, logs, and Events into a causal sequence?]{kind="recap"}
Order observations by controller creation, scheduling, kubelet setup, process execution, termination, restart, and readiness. Separate the initiating failure from later effects, make one deliberate correction, and verify recovery at the Pod and owning-controller layers.
:::

:::expand[What must a production logging pipeline and application log format provide?]{kind="recap"}
A production pipeline exports node-local CRI logs to a durable backend and enriches them with Kubernetes identity. Application records need stable structured fields, explicit operation and outcome context, correlation identifiers, sensitive-data controls, and a volume policy. Selected Events can also be exported for longer retention.
:::

## References
<!-- section-summary: Current Kubernetes documentation defines container log capture, rotation, current and previous logs, Events, Pod diagnosis, and cluster-level logging. -->

- [Logging Architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/) — stdout and stderr capture, CRI logs, kubelet serving and rotation, previous instances, node lifecycle, and cluster-level logging patterns.
- [kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/) — container selection, previous logs, timestamps, prefixes, selectors, tails, and concurrent requests.
- [kubectl events](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_events/) — recent Events, resource filtering, type filtering, output formats, and watching.
- [Events API](https://kubernetes.io/docs/reference/kubernetes-api/events/) — limited retention, best-effort semantics, evolving reasons and messages, and Event purpose.
- [Event v1 API](https://kubernetes.io/docs/reference/kubernetes-api/events/event-v1/) — reporting fields, object references, Event series counts, and last-observed time.
- [Debug Running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/) — Pod logs, shells, ephemeral debugging containers, and node-level debugging routes.
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) — Pod phases, container states, restart behavior, conditions, and common displayed statuses.
