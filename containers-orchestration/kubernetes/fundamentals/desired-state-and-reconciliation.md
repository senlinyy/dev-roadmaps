---
title: "Desired State and Reconciliation"
description: "Understand how Kubernetes preserves a requested result, notices gaps, and uses cooperating controllers to keep moving the cluster toward that result."
overview: "Kubernetes runs as a collection of continuing feedback loops. This article builds that idea from first principles, then follows one Deployment through stored API state, List and Watch, controller queues, ReplicaSets, Pods, scheduling, kubelets, rollouts, drift, and operational verification."
tags: ["kubernetes", "desired-state", "controllers", "reconciliation", "deployments"]
order: 4
id: article-containers-orchestration-kubernetes-fundamentals-desired-state-and-reconciliation
---

## Table of Contents

1. [What Are Desired State and Reconciliation in Plain Terms?](#what-are-desired-state-and-reconciliation-in-plain-terms)
2. [Where Do Desired and Observed State Appear in an API Object?](#where-do-desired-and-observed-state-appear-in-an-api-object)
3. [How Does a Controller Notice That It Has Work to Do?](#how-does-a-controller-notice-that-it-has-work-to-do)
4. [What Happens During One Reconciliation?](#what-happens-during-one-reconciliation)
5. [How Do Several Reconciliation Loops Produce a Running Application?](#how-do-several-reconciliation-loops-produce-a-running-application)
6. [What Happens When the Cluster, a Person, or Another Controller Changes State?](#what-happens-when-the-cluster-a-person-or-another-controller-changes-state)
7. [Which Problems Can Reconciliation Repair?](#which-problems-can-reconciliation-repair)
8. [How Do You Prove That the Latest Desired State Took Effect?](#how-do-you-prove-that-the-latest-desired-state-took-effect)
9. [Check Your Answers](#check-your-answers)
10. [What's Next](#whats-next)
11. [References](#references)

## What Are Desired State and Reconciliation in Plain Terms?
<!-- section-summary: Desired state is a durable description of the result Kubernetes should maintain; reconciliation is the continuing feedback loop that compares that description with observations and makes corrective changes. -->

The previous article introduced the control plane as the part of Kubernetes that accepts requests, stores API objects, and coordinates work across the cluster. The idea that connects those components is **reconciliation**.

**You record what the cluster should look like. Kubernetes repeatedly observes what it currently looks like and takes steps that bring the two closer together.**

A thermostat is a useful small comparison. You choose a target temperature of 20°C. The thermostat measures 17°C, finds a three-degree gap, turns on the heater, measures again, and stops heating when the room reaches the target. The target stays meaningful after the first measurement and after the first heater action.

Kubernetes applies the same control-system idea to API objects. A Deployment can say:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: playback-session
  namespace: video
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: playback-session
  template:
    metadata:
      labels:
        app.kubernetes.io/name: playback-session
    spec:
      containers:
        - name: api
          image: ghcr.io/example/playback-session:4.1.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
```

The important request is larger than “start three containers once.” It means:

- keep three Pods based on this template;
- replace a managed Pod when it disappears;
- move the population to a new template when the image changes;
- report how much of the requested result currently exists.

Kubernetes calls the requested result **desired state**. For an object with a `spec`, the `spec` normally carries that request. The running Pods, their API records, their readiness reports, their Node assignments, and any relevant external resources contribute to **observed state**.

The controller responsible for a resource repeats four kinds of work:

1. read the desired state;
2. observe the state it owns or depends on;
3. calculate the gap;
4. make a change that reduces the gap, then observe again later.

### Why a sequence of commands is weaker

Imagine a deployment script built around one-time actions:

```text
1. start process A
2. start process B
3. start process C
4. exit successfully
```

The script can complete while all three processes are healthy. If process B disappears six hours later, the completed script has no continuing responsibility. A monitoring system could launch a new workflow, but the workflow engine now needs durable state describing what should exist, observations describing what does exist, retry rules, and recovery after its own restart. Those are the ingredients of a reconciliation system.

The Deployment keeps the request alive:

```text
requested replicas: 3
observed replicas:  2
gap:                1 missing replica
next useful change: create one replacement Pod object
```

The object remains in the API after `kubectl` exits. A controller can restart, rebuild its view from the API, and calculate the same gap. A lost notification can delay the calculation, while a later observation still reveals that three were requested and two exist.

This is the deeper reason Kubernetes asks for outcomes. Machines, processes, network connections, and controllers all change over time. A persistent target plus repeated comparison gives the system a way to recover from changes that nobody predicted when the original request was submitted. A detailed execution script ends after its listed actions; the stored outcome continues guiding later corrections.

These questions guide the rest of the article:

1. **What are desired state and reconciliation in plain terms?**
2. **Where do desired and observed state appear in an API object?**
3. **How does a controller notice that it has work to do?**
4. **What happens during one reconciliation?**
5. **How do several reconciliation loops produce a running application?**
6. **What happens when the cluster, a person, or another controller changes state?**
7. **Which problems can reconciliation repair?**
8. **How do you prove that the latest desired state took effect?**

## Where Do Desired and Observed State Appear in an API Object?
<!-- section-summary: Spec, status, generation, observedGeneration, and resourceVersion answer different questions about the requested configuration, controller progress, and stored API revision. -->

A Kubernetes object is a versioned API record. The manifest you submit supplies a desired configuration. The API server adds identity and storage metadata. Controllers and node agents publish observations as the cluster works.

Run this command against a real Deployment:

```bash
kubectl get deployment playback-session -n video -o json
```

An abbreviated response can look like this:

```json
{
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": {
    "name": "playback-session",
    "namespace": "video",
    "uid": "7562437c-b68a-43ec-8b56-c060f4d50b79",
    "generation": 7,
    "resourceVersion": "84210"
  },
  "spec": {
    "replicas": 3,
    "selector": {
      "matchLabels": {
        "app.kubernetes.io/name": "playback-session"
      }
    },
    "template": {
      "metadata": {
        "labels": {
          "app.kubernetes.io/name": "playback-session"
        }
      },
      "spec": {
        "containers": [
          {
            "name": "api",
            "image": "ghcr.io/example/playback-session:4.1.0"
          }
        ]
      }
    }
  },
  "status": {
    "observedGeneration": 7,
    "replicas": 3,
    "updatedReplicas": 3,
    "readyReplicas": 2,
    "availableReplicas": 2,
    "conditions": [
      {
        "type": "Progressing",
        "status": "True",
        "reason": "ReplicaSetUpdated"
      },
      {
        "type": "Available",
        "status": "False",
        "reason": "MinimumReplicasUnavailable"
      }
    ]
  }
}
```

YAML and JSON are two representations of the same API object. The API server may store a built-in resource as Kubernetes Protobuf bytes in etcd, as the previous article explained. Clients usually receive a decoded JSON representation, and `kubectl` can print that representation as JSON, YAML, a table, or selected fields.

### `spec` carries the requested result

For this Deployment, `spec.replicas: 3` requests a population of three, and `spec.template` describes each new Pod. The selector connects the Deployment's ReplicaSets to Pods with the expected label.

The word “desired” means the field belongs to the requested configuration. Admission, policy, capacity, missing dependencies, or an application error can still prevent the complete result.

### `status` carries the latest published observation

The Deployment controller calculates the Deployment's status from its ReplicaSets and their Pods. Here it reports:

```text
desired replicas:    3
current replicas:    3
updated replicas:    3
ready replicas:      2
available replicas:  2
```

Three Pod records exist, while only two currently satisfy the conditions needed for readiness and availability. This is useful precisely because desired and observed values can differ. The difference shows that work remains or that a prerequisite is blocking progress.

Status is a report from a particular observation. Pods can change after the controller writes it. A later reconciliation refreshes the report. This asynchronous timing lets the Deployment, ReplicaSets, and Pods keep progressing independently, with each fresh report describing the latest completed observation.

### `generation` identifies a desired-state revision

When an accepted update changes the desired configuration of a normal resource, the API server advances `metadata.generation`. Changing the image or replica count can therefore move this Deployment from generation `7` to generation `8`.

Generation belongs to this one Deployment. It acts as a sequence number for desired configuration. Timestamps describe time, and `resourceVersion` supplies the API storage token used across persisted changes.

### `observedGeneration` shows how far the controller has processed

The Deployment controller reports the newest generation it has observed in `status.observedGeneration`.

Suppose an image update has just been accepted:

```yaml
metadata:
  generation: 8
status:
  observedGeneration: 7
```

The stored desired state is generation `8`. The controller-written status still describes work calculated from generation `7`. Reading replica counts or conditions as proof of the new rollout would be premature.

Later, the object may show:

```yaml
metadata:
  generation: 8
status:
  observedGeneration: 8
  updatedReplicas: 3
  readyReplicas: 2
```

Now the controller has processed the latest desired generation. Runtime progress remains incomplete because one updated replica still lacks readiness. `observedGeneration` answers “has the controller processed this configuration?” Replica and condition fields answer “what result did it observe?”

### `resourceVersion` identifies a stored API revision

`metadata.resourceVersion` changes when the stored object changes. A spec update, a status update, a label edit, or another persisted modification can produce a new value. API clients treat it as an opaque token.

This creates three separate version ideas:

| Field | Question it answers | Example |
| --- | --- | --- |
| `apiVersion` | Which API group, version, and schema describe this representation? | `apps/v1` Deployment |
| `metadata.generation` | Which accepted desired configuration does this object carry? | Desired generation `8` |
| `status.observedGeneration` | Which desired generation has the responsible controller processed? | Controller processed generation `8` |
| `metadata.resourceVersion` | Which stored API revision did this response return? | Opaque revision `84210` |

`resourceVersion` supports two important distributed-systems jobs. A watcher can ask for changes after a known revision. A writer can include the version it read so the API server can detect that another writer changed the object first.

![Studio Light infographic showing one Deployment spec at generation 7, a controller processing that generation, status with observedGeneration 7, and resourceVersion changing across stored writes](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-desired-state-and-reconciliation/object-generation-and-status.png)

*Generation follows desired configuration, observedGeneration reports controller progress, and resourceVersion identifies each stored API revision.*

## How Does a Controller Notice That It Has Work to Do?
<!-- section-summary: Controllers use List and Watch to maintain local caches, then place compact object keys on work queues so workers can reconcile the newest state at a controlled rate. -->

A controller needs current information about the resources it manages. Repeatedly downloading every Deployment, ReplicaSet, and Pod several times per second would create large, redundant API traffic. Kubernetes clients commonly combine **List**, **Watch**, a local cache, and a work queue.

### List establishes a starting point

The controller first requests the current collection. For Deployments in the `video` namespace, the HTTP request is:

```http
GET /apis/apps/v1/namespaces/video/deployments
Accept: application/json
```

The response includes the current items and a collection `resourceVersion`:

```json
{
  "kind": "DeploymentList",
  "metadata": {
    "resourceVersion": "84190"
  },
  "items": [
    {
      "metadata": {
        "name": "playback-session",
        "namespace": "video"
      }
    }
  ]
}
```

The client stores the returned objects in a local cache. That cache gives reconciliation workers fast reads without a separate API round trip for every lookup.

### Watch streams later changes

The controller then asks for changes after revision `84190`:

```http
GET /apis/apps/v1/namespaces/video/deployments?watch=1&resourceVersion=84190
```

The API server keeps the HTTP response open and streams events. An update can arrive as:

```json
{
  "type": "MODIFIED",
  "object": {
    "apiVersion": "apps/v1",
    "kind": "Deployment",
    "metadata": {
      "name": "playback-session",
      "namespace": "video",
      "generation": 8,
      "resourceVersion": "84210"
    },
    "spec": {
      "replicas": 3
    }
  }
}
```

The event updates the cache and tells the controller that this object deserves another calculation. Watches also carry `ADDED` and `DELETED` results, and clients can use bookmark events to advance their known resource version during long-running watches.

### The work queue holds a reference for recalculation

An event handler commonly places a key such as this on a rate-limited queue:

```text
video/playback-session
```

The key means “recalculate the Deployment with this namespace and name.” It carries no instruction such as “create ReplicaSet number four” or “run the update handler exactly once.” A worker removes the key later and reads the newest Deployment, ReplicaSets, and Pods from its caches.

This separation keeps the controller robust through messy timing:

- five quick updates can collapse into one queued key;
- a controller restart can rebuild the cache and enqueue current objects;
- a ReplicaSet event can enqueue its owning Deployment;
- a Pod deletion can enqueue the owner whose status or population may have changed.

The calculation uses the latest known **level** of state. Events decide when to look again.

### Level-based control survives missed and repeated events

Consider two possible designs.

An event-only design receives “the replica count changed from two to three” and creates exactly one Pod. Losing that event can leave two Pods forever. Processing it twice can create four.

A level-based design reads:

```text
desired replicas: 3
observed replicas: 2
gap:               1
```

It creates one Pod and later recalculates. A repeated notification sees three Pods and produces a gap of zero. A missed notification can be recovered by a resync, a related event, or a rebuilt cache because the current mismatch still exists.

Kubernetes API history is finite. If a watch tries to resume from a resource version that has aged out, the API server can return `410 Gone`. The client lists again, replaces its local view with a current snapshot, and begins a new watch from the returned version.

This is why watches improve responsiveness while current-state comparison provides correctness.

![Studio Light infographic following one reconciliation from list and watch, through a local cache and queued namespace/name key, into desired-versus-observed comparison, a Pod API write, and a later status update](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-desired-state-and-reconciliation/desired-current-loop.png)

*A watch wakes the controller; the cached current state determines the next action.*

## What Happens During One Reconciliation?
<!-- section-summary: One reconciliation reads the latest target and owned objects, calculates a gap, performs a bounded API action, updates status, and relies on later observations for the next decision. -->

One reconciliation handles one object key. The controller reads the latest target, gathers the related objects it owns or depends on, calculates what differs, and chooses a small next action.

The ReplicaSet controller provides a concrete example. Assume the Deployment controller has already created a ReplicaSet named `playback-session-7d9f68b47c` with this desired count:

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: playback-session-7d9f68b47c
  namespace: video
spec:
  replicas: 3
```

The ReplicaSet controller lists the active Pods controlled by that ReplicaSet and finds two. Its calculation is straightforward:

```text
desired Pods:  3
observed Pods: 2
gap:           1 missing Pod
```

The controller can reduce that gap by creating one Pod API object. An abbreviated request looks like this:

```http
POST /api/v1/namespaces/video/pods
Content-Type: application/json

{
  "apiVersion": "v1",
  "kind": "Pod",
  "metadata": {
    "generateName": "playback-session-7d9f68b47c-",
    "labels": {
      "app.kubernetes.io/name": "playback-session",
      "pod-template-hash": "7d9f68b47c"
    },
    "ownerReferences": [
      {
        "apiVersion": "apps/v1",
        "kind": "ReplicaSet",
        "name": "playback-session-7d9f68b47c",
        "uid": "4fa93ac7-e02c-472b-8ac7-54cbc6959cb2",
        "controller": true
      }
    ]
  },
  "spec": {
    "containers": [
      {
        "name": "api",
        "image": "ghcr.io/example/playback-session:4.1.0"
      }
    ]
  }
}
```

The `ownerReferences` entry gives the Pod a stable relationship to one ReplicaSet UID. The labels allow selector-based grouping. The generated name gives each Pod its own identity.

The API server can return `201 Created` after persisting the Pod. At this point the ReplicaSet controller has completed one useful action. The Pod may still be unscheduled, its image may still need downloading, and its readiness probe may still need to pass. Those stages belong to other components.

### Shortage, excess, and match

For population control, the comparison has three broad outcomes:

| Desired count | Observed active count | Gap | Useful action |
| ---: | ---: | ---: | --- |
| 3 | 2 | `+1` | Create one Pod |
| 3 | 4 | `-1` | Select and delete one Pod |
| 3 | 3 | `0` | Keep the population and refresh status as needed |

Real controller code also handles expectations, deletion timestamps, ownership, adoption, slow starts, failed creates, and bursts of changes. The central calculation stays recognizable: compare the requested population with the owned population and move toward the requested count.

### Bounded actions create clear handoffs

The ReplicaSet controller's responsibility ends after creating the Pod object. The scheduler owns Node selection, and the kubelet owns image and process work on the chosen Node. This boundary keeps each component's authority narrow and makes every handoff visible through the API.

The newly created Pod says, in effect, “a container with this image should run somewhere.” The scheduler later adds a placement decision. The kubelet later turns the assigned Pod spec into runtime work. Each component can restart and rediscover its responsibility from the stored objects.

### Reconciliation must be safe to repeat

Distributed operations have uncertain outcomes. A controller can send the Pod creation request, lose its network connection before reading the response, and remain unsure whether the API server accepted the object. Two related events can enqueue the same parent. Another writer can update an object between the controller's read and write.

A reliable controller uses current observations and API guarantees to make repeated work safe:

- it counts and recognizes existing dependents before creating more;
- it links dependents to an owner UID;
- it writes toward a specific value, so repeated work converges on the same target;
- it uses stable identities or generated-name and ownership expectations;
- it retries temporary failures through a rate-limited queue;
- it recalculates after a conflict and preserves the newer accepted view.

Suppose a controller reads resource version `84210`. An autoscaler updates the object, producing `84211`. A replacement request based on `84210` can receive:

```http
HTTP/1.1 409 Conflict
```

The controller reads the newer object, applies its decision to that current state, and submits a fresh update. This optimistic-concurrency cycle preserves the autoscaler's accepted change.

Create operations need equivalent care. An HTTP timeout can hide whether the API server persisted the request. Built-in controllers combine owner references, observed dependents, creation expectations, and later reconciliation to control duplicate work. A temporary extra Pod also creates an observable excess that a later pass can remove.

The goal is **idempotent behavior**: repeating the reconciliation from the same current state leads toward the same result. “Set the ReplicaSet target to three” has that property. An instruction to add one on every notification can accumulate the wrong result.

### Status records what this pass learned

After acting, a controller can update status to report its latest observation. Status gives humans and other controllers evidence while the `spec` remains the requested configuration.

The next reconciliation starts from API state again. Controller process memory can improve efficiency, while durable objects preserve the state needed for recovery.

## How Do Several Reconciliation Loops Produce a Running Application?
<!-- section-summary: Several independent loops turn a Deployment into a running and reachable application, with each API output supplying input for the next component. -->

The word “controller” can sound like one central Kubernetes brain. In practice, Kubernetes uses many focused loops. A complete application emerges from their cooperation.

Start with this accepted Deployment:

```yaml
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api
          image: ghcr.io/example/playback-session:4.1.0
```

Assume the namespace also contains a Service that selects Pods with `app.kubernetes.io/name: playback-session`.

### Loop 1: the Deployment controller creates a revision-specific ReplicaSet

The Deployment controller compares the Pod template with the ReplicaSets already owned by the Deployment. A brand-new Deployment has no ReplicaSet for that template, so the controller creates one.

The new ReplicaSet carries the Pod template and receives a desired replica count. During a rollout, the Deployment controller can split the desired population across an old and a new ReplicaSet according to `maxSurge`, `maxUnavailable`, readiness, and progress.

The Deployment controller manages **revisions and rollout population**. It delegates individual Pod creation to the ReplicaSet controller.

### Loop 2: the ReplicaSet controller creates Pod objects

The ReplicaSet requests three Pods and currently owns zero. Its controller creates three Pod API records. Each record contains the same template, a unique name and UID, and an owner reference to the ReplicaSet.

Immediately after creation, the Pods can have no Node assignment:

```yaml
metadata:
  name: playback-session-7d9f68b47c-x7m4p
spec:
  nodeName: ""
status:
  phase: Pending
```

The records now exist, so the ReplicaSet population gap is closed at the API-object layer. Runtime work remains.

### Loop 3: the scheduler records a placement decision

The scheduler watches for Pods that need a Node. For each one, it considers resource requests and cluster constraints such as:

- available CPU and memory;
- node selectors and node affinity;
- taints and tolerations;
- topology spread rules;
- storage and volume placement requirements;
- other scheduling policies enabled in the cluster.

Suppose the scheduler chooses `worker-2`. It records the binding through the Kubernetes API. The Pod now contains:

```yaml
spec:
  nodeName: worker-2
```

The scheduler has completed placement. It leaves process creation to the node agent.

### Loop 4: the kubelet realizes the assigned Pod locally

The kubelet on `worker-2` watches for Pods assigned to that Node. The assigned Pod supplies desired local state to that kubelet.

The kubelet coordinates volume preparation, Pod networking, image availability, container creation through the runtime, and health probes. It then reports container state and Pod conditions through the API.

A later Pod response can include:

```yaml
status:
  phase: Running
  conditions:
    - type: Ready
      status: "True"
  containerStatuses:
    - name: api
      ready: true
      restartCount: 0
```

`Running` says that at least one container is running or starting. `Ready=True` says the Pod currently satisfies its readiness condition and can normally serve traffic.

### Loop 5: the EndpointSlice controller publishes ready backends

The Service selector identifies the playback Pods. The EndpointSlice controller turns that relationship into one or more EndpointSlice objects containing backend addresses and readiness information.

An abbreviated endpoint can look like this:

```yaml
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  labels:
    kubernetes.io/service-name: playback-session
addressType: IPv4
ports:
  - name: http
    port: 8080
endpoints:
  - addresses:
      - 10.42.2.17
    conditions:
      ready: true
    nodeName: worker-2
```

Service data-plane components consume EndpointSlices to program forwarding toward usable backends. A Pod becoming ready can therefore trigger an EndpointSlice update even though the Service spec itself stayed unchanged.

### One object can be observed state for one loop and desired state for another

This is the key compositional idea.

- A ReplicaSet is the Deployment controller's managed output and the ReplicaSet controller's desired input.
- A Pod record proves population to the ReplicaSet controller and describes desired local runtime to the kubelet.
- Pod conditions are kubelet output and EndpointSlice-controller input.
- EndpointSlices are controller output and Service data-plane input.

Each component makes a narrow decision, records it through the API, and lets another component observe the result. The full application lifecycle emerges from those handoffs.

![Studio Light infographic showing a Deployment controller creating a ReplicaSet, the ReplicaSet controller creating three Pod records, the scheduler binding Pods to worker nodes, kubelets starting containers and reporting readiness, and the EndpointSlice controller publishing ready Service backends](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-desired-state-and-reconciliation/cooperating-control-loops.png)

*A running Service emerges from several loops. Each API object is both evidence from an earlier step and input to a later one.*

This architecture also creates useful failure boundaries. During temporary scheduler unavailability, existing assigned Pods can continue running while new Pods remain pending. A kubelet startup failure affects its assigned Pod while the Deployment and ReplicaSet records still preserve the request. After a Deployment controller restart, the existing ReplicaSets and Pods let it reconstruct rollout progress.

## What Happens When the Cluster, a Person, or Another Controller Changes State?
<!-- section-summary: Pod deletion changes observed state, scaling changes desired state, rollouts change the Pod template, and outer controllers such as HPA or GitOps can update fields consumed by built-in workload controllers. -->

You can predict reconciliation by first identifying **which object and field changed**. A missing Pod, a new replica target, a new image, and an autoscaler recommendation produce different gaps.

### Deleting a managed Pod changes observed state

Assume the Deployment requests three replicas and three ready Pods exist. An engineer deletes one Pod:

```bash
kubectl delete pod playback-session-7d9f68b47c-x7m4p -n video
```

The higher-level desired state still requests three. The ReplicaSet controller later observes two active owned Pods:

```text
ReplicaSet desired count: 3
active owned Pods:        2
gap:                      1 missing Pod
```

It creates a replacement with a new name and UID. The replacement may land on a different Node and receive a different Pod IP. The requested population is the stable target; each interchangeable Deployment Pod has a temporary identity.

### Scaling the Deployment changes desired state

This command changes the replica target itself:

```bash
kubectl scale deployment playback-session -n video --replicas=5
```

Underneath, `kubectl` updates the Deployment's scale representation through the API. The Deployment controller adjusts the active ReplicaSet target, and the ReplicaSet controller creates the additional Pods.

The contrast is concrete:

| Action | Field or observation changed | Controller response |
| --- | --- | --- |
| Delete one managed Pod | Observed owned-Pod population falls from 3 to 2 | ReplicaSet controller creates a replacement |
| Scale Deployment to 5 | Desired replica target changes to 5 | Deployment and ReplicaSet controllers grow the population |

### Changing the image creates a new revision

Now update the container image:

```bash
kubectl set image deployment/playback-session \
  api=ghcr.io/example/playback-session:4.2.0 \
  -n video
```

The Pod template changes, so the Deployment generation advances. The old ReplicaSet describes template `4.1.0`; a new ReplicaSet describes `4.2.0`.

With a rolling-update strategy, the Deployment controller gradually changes the desired counts. A simplified progression can be:

| Reconciliation stage | Ready old Pods | Ready new Pods | What the controller can do next |
| --- | ---: | ---: | --- |
| Before update | 3 | 0 | Create or scale the new ReplicaSet |
| First new Pod reports readiness | 3 | 1 | Reduce the old ReplicaSet within availability limits |
| More new Pods become ready | 2 | 2 | Continue shifting population |
| Rollout converges | 0 | 3 | Report the new revision as available |

Each stage is calculated from current ReplicaSets and Pod availability. A new Pod that stays unready prevents the controller from treating it as healthy replacement capacity. The rollout can pause with both revisions present while status and events explain the incomplete step.

### The HorizontalPodAutoscaler changes another controller's target

A HorizontalPodAutoscaler is another reconciliation loop. It observes metrics, calculates a suitable replica count, and writes the workload's scale subresource.

Suppose the playback API currently has three replicas and average CPU is twice the configured target. A simplified HPA calculation can recommend six replicas. The HPA writes that desired scale. The Deployment and ReplicaSet controllers then realize the new population.

The loops divide the decision:

- HPA decides **how many replicas current demand requires**;
- Deployment controller decides **which ReplicaSet revisions should carry that population**;
- ReplicaSet controller decides **which Pod objects must be created or removed**;
- scheduler and kubelets decide **where and how those Pods run**.

Repeatedly writing a fixed replica count while an HPA manages the same field creates competing writers. Each actor can keep replacing the other's desired value. The cluster is functioning as instructed by both writers; the configuration needs one clear owner for the replica field.

### GitOps can make the live object observed state

Built-in workload controllers treat the live Deployment as desired state. A GitOps controller compares the live Deployment with a repository revision. From the GitOps controller's perspective, the live API object is observed state.

If the repository says `replicas: 5` and a direct cluster edit changes the live object to `replicas: 2`, the GitOps controller can restore five. The Deployment controller then acts on the restored live spec. This creates a control loop around another set of control loops.

![Studio Light infographic comparing Pod deletion, Deployment scaling, HorizontalPodAutoscaler updates, and GitOps correction, with each change pointing to the reconciliation loop that owns the next action](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-desired-state-and-reconciliation/drift-and-correction.png)

*Start with the changed object and field. That identifies the target that moved and the controller that owns the next comparison.*

## Which Problems Can Reconciliation Repair?
<!-- section-summary: Reconciliation repairs gaps only when a desired condition is expressed, a controller understands it, and available actions and real-world prerequisites can move the system closer. -->

Kubernetes is often described as self-healing. A precise boundary gives that phrase practical meaning.

A controller can repair a gap when three things are true:

1. an API object expresses the desired result;
2. a controller understands how to compare that result with observations;
3. the cluster or external system provides an action capable of reducing the gap.

### A missing replica fits the control loop

For a ReplicaSet, the target and action are clear:

```text
desired replicas: 3
active owned Pods: 2
available action:  create one Pod object
```

If a feasible Node, image, storage, and configuration are available, the later loops can turn that Pod object into a ready process.

### A dead container fits the kubelet's local loop

The assigned Pod spec says that a container should be running. The kubelet observes that the process exited and applies the Pod's restart policy. This repair occurs on the same Node and preserves the Pod object.

A complete Pod loss is different. The higher-level ReplicaSet eventually creates a new Pod object, and the scheduler can place it on any feasible Node. The two repairs belong to different loops.

### A blocked gap stays visible until a prerequisite changes

Suppose the Deployment requests ten replicas and the new Pods each request one GPU. The cluster has four suitable GPUs.

The controllers can create ten Pod records. The scheduler can place four and leave six pending. Repeated reconciliation continues to observe the same capacity constraint:

```text
desired GPU-backed Pods: 10
schedulable Pods:         4
pending Pods:             6
reported reason:          insufficient suitable GPU capacity
```

Physical GPU capacity sits outside the scheduler's authority. Adding capacity, reducing the request, or changing placement requirements provides the new input needed for progress.

Other common blockers follow the same pattern:

| Desired result | Observed blocker | Evidence | Input that can unlock progress |
| --- | --- | --- | --- |
| Start a Pod | Image pull fails for the requested tag | Container waiting reason and kubelet Events | Publish the image, correct the tag, or fix registry access |
| Place a Pod | Every suitable Node lacks requested memory | `FailedScheduling` Event | Add capacity or reduce the request |
| Create another Pod | Namespace quota rejects creation | ReplicaSet or Deployment Event | Free quota, raise quota, or lower the requested population |
| Attach storage | Required volume remains unbound or unattached | PVC, Pod, and storage-controller Events | Supply matching storage or correct topology/access settings |
| Realize a custom resource | Responsible operator is absent | Object exists with no progressing status | Install or restore the controller |

The control loop can keep the unmet target visible. Visibility and retry remain valuable while the current environment lacks a path to convergence.

### Application correctness requires application-level signals

Consider a payment-authorization service whose Pods are running, readiness probes pass, and Service endpoints are published. A code defect applies the currency conversion twice. Kubernetes sees the requested Pods, healthy processes, and passing probes. The infrastructure state has converged while the business result is wrong.

Kubernetes responds to signals represented in the loops it understands. A meaningful readiness probe can remove a backend that fails a service check. Metrics and alerts can reveal an error-rate increase. Tests and transaction checks can catch incorrect authorization amounts. A release controller or operator can then change the desired version.

This gives “self-healing” a practical definition: **Kubernetes automatically corrects declared, observable infrastructure gaps for which a controller has an available corrective action.** Teams still supply sound specifications, truthful health signals, enough capacity, application correctness, data protection, and release decisions.

### Convergence describes continuing progress toward the target

Desired state can change while the cluster is still working. Nodes can disappear during a rollout. An autoscaler can raise the replica target. A readiness probe can move a Pod in and out of service. Several loops may be converging at once.

The useful question is whether each responsible controller can keep reducing its gap or clearly report why progress stopped. A healthy control system may spend time between states while preserving availability and exposing the remaining work.

## How Do You Prove That the Latest Desired State Took Effect?
<!-- section-summary: Verification separates API acceptance, controller observation, dependent-object creation, runtime readiness, Service publication, and application behavior into distinct evidence checkpoints. -->

A successful `kubectl apply` response proves that the API server accepted and stored the request. The complete application still depends on later controllers, the scheduler, kubelets, probes, and Service endpoint publication.

Verification should follow the same chain.

### Check 1: did the API store the intended spec?

Read the Deployment directly:

```bash
kubectl get deployment playback-session -n video \
  -o jsonpath='{.spec.replicas}{" replicas, image="}{.spec.template.spec.containers[0].image}{"\n"}'
```

Expected result after the example update:

```text
3 replicas, image=ghcr.io/example/playback-session:4.2.0
```

This proves the desired configuration in the live API object.

### Check 2: did the Deployment controller process that generation?

Compare generation with observed generation:

```bash
kubectl get deployment playback-session -n video \
  -o custom-columns='GEN:.metadata.generation,OBSERVED:.status.observedGeneration,DESIRED:.spec.replicas,UPDATED:.status.updatedReplicas,READY:.status.readyReplicas,AVAILABLE:.status.availableReplicas'
```

Example output during the rollout:

```text
GEN   OBSERVED   DESIRED   UPDATED   READY   AVAILABLE
8     8          3         3         2       2
```

Read it in two stages:

1. `GEN` and `OBSERVED` both equal `8`, so the Deployment controller processed the current desired configuration.
2. `READY` and `AVAILABLE` equal `2`, so one updated replica still needs to become healthy and available.

Matching generations prove controller observation. Replica counts and conditions prove progress toward the result.

### Check 3: which dependent object holds the incomplete handoff?

Inspect rollout revisions and Pods:

```bash
kubectl get replicasets,pods -n video \
  -l app.kubernetes.io/name=playback-session \
  -o wide
```

Look for these boundaries:

- an old ReplicaSet still carrying replicas can mean the new revision has yet to provide enough available capacity;
- a Pod with `NODE` empty is waiting for scheduling;
- `Pending` with a scheduling Event points to placement or capacity;
- `ImagePullBackOff` points to image name, credentials, or registry reachability;
- `Running` with `0/1` ready points to startup or readiness behavior.

Use `describe` and Events for the specific object whose handoff is incomplete:

```bash
kubectl describe deployment playback-session -n video
kubectl describe pod <pod-name> -n video
kubectl events -n video --for deployment/playback-session
kubectl events -n video --for pod/<pod-name>
```

### Check 4: did ready Pods become Service endpoints?

Read the Service's EndpointSlices:

```bash
kubectl get endpointslices -n video \
  -l kubernetes.io/service-name=playback-session \
  -o wide
```

The endpoint addresses should correspond to the intended ready Pods. A Pod can be running while its readiness condition keeps it out of the normal ready endpoint set.

### Check 5: did the rollout meet the controller's completion criteria?

Wait with a bounded command:

```bash
kubectl rollout status deployment/playback-session \
  -n video \
  --timeout=5m
```

A successful exit confirms that the Deployment reached its rollout completion criteria during the wait. A timeout sends the investigation back to Deployment conditions, ReplicaSets, Pods, and Events.

`progressDeadlineSeconds` gives the Deployment controller a reporting deadline. When progress exceeds that deadline, the controller can set `Progressing=False` with reason `ProgressDeadlineExceeded`. The built-in controller reports the failure and continues reconciling; a person or a higher-level release system chooses the next change, such as fixing the image or rolling back.

### Check 6: does the application produce the intended result?

Infrastructure evidence establishes that Kubernetes realized its declared state. Application verification completes the proof:

- send a representative request through the same route clients use;
- check response correctness as well as status code;
- inspect application error and latency metrics;
- verify critical downstream calls and data effects;
- confirm the new revision label or build identifier where the service exposes one.

This final check catches the gap between “three healthy Pods exist” and “the new application behaves correctly.” Kubernetes gives each stage observable records; a reliable deployment process reads the evidence at every boundary.

## Check Your Answers
<!-- section-summary: These answers connect persistent intent, object versions, List and Watch, bounded reconciliation, cooperating loops, state changes, repair limits, and verification. -->

:::expand[What are desired state and reconciliation in plain terms?]{kind="recap"}
Desired state is the durable result recorded in an API object's configuration. Reconciliation is the continuing feedback loop that reads that result, observes the resources or external systems under its responsibility, calculates the gap, makes a bounded corrective change, and later repeats from fresh state.
:::

:::expand[Where do desired and observed state appear in an API object?]{kind="recap"}
`spec` normally carries the requested configuration, while `status` carries a controller's latest report. `metadata.generation` identifies the desired configuration, `status.observedGeneration` shows which desired generation the controller processed, and `metadata.resourceVersion` identifies the stored API revision used for watches and concurrency.
:::

:::expand[How does a controller notice that it has work to do?]{kind="recap"}
The controller lists objects to establish a current snapshot, watches from the returned resource version, updates a local cache, and places affected keys on a work queue. Events wake the controller, while the newest cached state supplies the calculation. An expired watch history leads to another list and a rebuilt view.
:::

:::expand[What happens during one reconciliation?]{kind="recap"}
A worker reads one key, gathers the latest desired and observed objects, calculates a gap, and chooses a small API action. A ReplicaSet requesting three Pods while owning two leads to one Pod creation. Ownership, current-state checks, optimistic concurrency, and rate-limited retries make repeated passes safe.
:::

:::expand[How do several reconciliation loops produce a running application?]{kind="recap"}
The Deployment controller manages ReplicaSets, the ReplicaSet controller creates Pod records, the scheduler binds each Pod to a Node, the kubelet starts containers and reports conditions, and the EndpointSlice controller publishes ready Service backends. Each API output supplies evidence or desired input for another loop.
:::

:::expand[What happens when the cluster, a person, or another controller changes state?]{kind="recap"}
Deleting a managed Pod changes the observed population, so the ReplicaSet replaces it. Scaling changes the desired count. An image update creates a new Pod-template revision and ReplicaSet. HPA and GitOps add outer loops that can update fields consumed by the built-in workload controllers.
:::

:::expand[Which problems can reconciliation repair?]{kind="recap"}
Repair works when the desired result is declared, a controller understands the gap, and a real corrective action is available. Missing Pods and dead containers fit those loops. Capacity shortages, unavailable images, quota, missing controllers, and application logic errors require new capacity, configuration, software, or operational decisions.
:::

:::expand[How do you prove that the latest desired state took effect?]{kind="recap"}
Verify the live spec, compare generation with observedGeneration, inspect ReplicaSets and Pods, read conditions and Events, confirm ready EndpointSlices, wait for rollout completion, and test the application's real behavior. Each step proves a different handoff from API acceptance to a useful service.
:::

## What's Next

Desired state and reconciliation explain why Kubernetes keeps working after an API request finishes. The next article applies this foundation to everyday navigation: choosing a cluster context and namespace, reading objects with `kubectl`, and checking the scope of each command.

## References

- [Kubernetes: Objects in Kubernetes](https://kubernetes.io/docs/concepts/overview/working-with-objects/) - Defines persistent API objects, desired state, spec, and status.
- [Kubernetes: Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) - Explains control loops, desired and current state, API-mediated actions, and focused controllers.
- [Kubernetes API Concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/) - Documents resource operations, List and Watch, resource versions, watch recovery, and update conflicts.
- [Kubernetes: Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Documents ReplicaSet coordination, rolling updates, status, conditions, progress deadlines, and completion behavior.
- [Kubernetes: ReplicaSets](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/) - Explains desired Pod populations, ownership, replacement, adoption, and Deployment-managed ReplicaSets.
- [Kubernetes: Owners and Dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/) - Explains owner references and controller ownership of dependent objects.
- [Kubernetes: EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) - Explains how the control plane publishes Service backends and endpoint readiness.
- [Kubernetes: Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/) - Explains how HPA calculates and updates a workload's desired scale.
- [Kubernetes Sample Controller](https://github.com/kubernetes/sample-controller/blob/master/controller.go) - Shows informer caches, work queues, reconciliation workers, status updates, and rate-limited retries in source code.
- [Kubernetes Deployment Controller Source](https://github.com/kubernetes/kubernetes/blob/master/pkg/controller/deployment/deployment_controller.go) - Shows the built-in Deployment controller's informers, listers, queue keys, workers, and synchronization logic.
- [kubectl rollout status](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_status/) - Documents bounded rollout waiting and exit behavior.
