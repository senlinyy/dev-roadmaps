---
title: "Pods"
description: "Understand the Pod as Kubernetes' unit of scheduling, shared runtime, identity, readiness, and replacement."
overview: "A Pod is one application instance as Kubernetes sees it: an API object realized as a node-level sandbox, one or more container processes, shared networking and volumes, and a set of lifecycle signals."
tags: ["pods", "containers", "kubectl", "probes", "sidecars"]
order: 1
id: article-containers-orchestration-kubernetes-workloads-pods
---

## Table of Contents

1. [Why Is the Pod Kubernetes' Smallest Schedulable Unit?](#why-is-the-pod-kubernetes-smallest-schedulable-unit)
2. [How Does a Pod Object Become Running Processes on a Node?](#how-does-a-pod-object-become-running-processes-on-a-node)
3. [What Do Containers Inside One Pod Share?](#what-do-containers-inside-one-pod-share)
4. [Which Containers Belong Together in One Pod?](#which-containers-belong-together-in-one-pod)
5. [What Changes During a Container Restart and a Pod Replacement?](#what-changes-during-a-container-restart-and-a-pod-replacement)
6. [How Does a Pod Start, Become Ready, and Shut Down?](#how-does-a-pod-start-become-ready-and-shut-down)
7. [How Do Phase, Container State, Conditions, and STATUS Describe One Pod?](#how-do-phase-container-state-conditions-and-status-describe-one-pod)
8. [How Do You Trace a Pod from Scheduling to Application Failure?](#how-do-you-trace-a-pod-from-scheduling-to-application-failure)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A running application eventually executes as one or more operating-system processes. A container packages one of those processes with its executable, libraries, environment, filesystem view, and isolation settings. Kubernetes still needs a larger unit that it can place on a node and describe through its API.

That unit is the **Pod**.

A Pod represents **one running application instance as Kubernetes sees it**. It gives that instance:

- an API identity with a name, namespace, and UID;
- one scheduling decision that selects a node;
- a runtime sandbox with network and security settings;
- one or more containers that run together;
- volumes that selected containers can mount;
- lifecycle rules, probes, events, and status;
- resource requirements used during scheduling and enforcement.

The common case is one application container in one Pod. A product-search API might have twenty replicas, with each replica represented by a separate Pod containing one `search-api` container. Each Pod is one replaceable instance behind a Service.

Keep these questions in view as you work through the lesson:

1. **Why Is the Pod Kubernetes' Smallest Schedulable Unit?**
2. **How Does a Pod Object Become Running Processes on a Node?**
3. **What Do Containers Inside One Pod Share?**
4. **Which Containers Belong Together in One Pod?**
5. **What Changes During a Container Restart and a Pod Replacement?**
6. **How Does a Pod Start, Become Ready, and Shut Down?**
7. **How Do Phase, Container State, Conditions, and STATUS Describe One Pod?**
8. **How Do You Trace a Pod from Scheduling to Application Failure?**

## Why Is the Pod Kubernetes' Smallest Schedulable Unit?
<!-- section-summary: A Pod gives Kubernetes one object for placing and operating a complete application instance made from one container or a few tightly coupled containers. -->

Multiple containers fit when they form one inseparable runtime unit. A video-processing Pod could contain:

- a `transcoder` that converts an uploaded source file into streaming segments; and
- a `segment-uploader` that sends completed segments from a shared local volume to object storage.

Those processes need the same node, the same temporary files, and the same lifetime. Kubernetes can schedule the complete Pod once and keep that relationship intact.

The same logic explains why a web frontend, an API, and a database usually occupy separate Pods. They scale at different rates, receive separate releases, and recover independently. Ten busy API Pods may serve one frontend release while a database runs under a StatefulSet. Packing all three processes into one Pod would couple every scaling and replacement decision.

Here is the smallest useful Pod specification for a search API:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: search-api
  namespace: storefront
  labels:
    app.kubernetes.io/name: search-api
spec:
  containers:
    - name: search-api
      image: ghcr.io/example-commerce/search-api:2.3.1
      ports:
        - name: http
          containerPort: 8080
      resources:
        requests:
          cpu: 250m
          memory: 256Mi
        limits:
          memory: 512Mi
```

The `Pod` object is a request stored through the Kubernetes API. It says which container image to run and what the process needs. At this point, the YAML is still a description. The next section follows how the cluster turns that description into a running process.

## How Does a Pod Object Become Running Processes on a Node?
<!-- section-summary: The scheduler binds the Pod to a node, and that node's kubelet uses the Container Runtime Interface to create the Pod sandbox, networking, mounts, and containers. -->

Creating a Pod crosses several boundaries. Each component has a narrow responsibility:

1. The API server accepts the Pod object and stores its desired specification.
2. The scheduler finds an eligible node and records the chosen node in `spec.nodeName`.
3. The kubelet on that node notices the assigned Pod.
4. The kubelet admits the Pod and prepares its required volumes.
5. The kubelet asks the container runtime to create a **Pod sandbox**.
6. Runtime and network integration establish the Pod's isolation, network namespace, IP address, DNS settings, and port mappings.
7. The kubelet asks the runtime to pull images, create containers, and start their processes.
8. The kubelet reports observed status back through the API.

![From a Pod API object through scheduling, kubelet and CRI calls to a node-level Pod sandbox with running containers, shared networking, and mounted volumes](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-pods/pod-runtime-wrapper.png)

*The API object describes the desired instance. The node's kubelet and runtime build the execution environment that makes it real.*

### The scheduling result is visible in the same object

Before scheduling, the Pod is waiting for a node assignment. After scheduling, the stored object contains a binding such as:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: search-api
  namespace: storefront
  uid: 6176f9fc-27b4-4ba7-88a7-28fdc21d36a2
spec:
  nodeName: worker-03
  containers:
    - name: search-api
      image: ghcr.io/example-commerce/search-api:2.3.1
```

The scheduler has made one placement decision for this Pod. The kubelet on `worker-03` now owns the node-level work. A Pod normally stays associated with that node for its lifetime. Recovery from a lost node creates a replacement Pod with a new identity, which we will examine later.

### The kubelet talks to a runtime through CRI

Kubernetes supports runtimes such as containerd and CRI-O through the **Container Runtime Interface**, or **CRI**. CRI is a gRPC API designed for communication between kubelet and a Kubernetes-aware runtime.

One of its calls is `RunPodSandbox`. The official CRI schema defines a request containing Pod metadata, hostname, DNS configuration, labels, annotations, security settings, and the requested runtime handler. A simplified representation for our Pod could look like this:

```json
{
  "config": {
    "metadata": {
      "name": "search-api",
      "uid": "6176f9fc-27b4-4ba7-88a7-28fdc21d36a2",
      "namespace": "storefront",
      "attempt": 0
    },
    "hostname": "search-api",
    "logDirectory": "/var/log/pods/storefront_search-api_6176f9fc.../",
    "labels": {
      "app.kubernetes.io/name": "search-api"
    },
    "linux": {
      "cgroupParent": "kubepods-burstable-pod6176f9fc.slice"
    }
  },
  "runtimeHandler": ""
}
```

This JSON is a readable approximation of a protocol-buffer request. Application teams submit the Pod manifest; kubelet produces this runtime handoff. It preserves the Pod's UID, namespace, labels, log location, and isolation settings while translating the Kubernetes object into runtime operations.

The runtime returns a `pod_sandbox_id`. Kubelet then makes further CRI calls for each container, conceptually:

```text
RunPodSandbox(search-api)       -> sandbox ID: 8bf2...
PullImage(search-api:2.3.1)    -> image ID: sha256:91ae...
CreateContainer(sandbox 8bf2)  -> container ID: 4c07...
StartContainer(4c07...)        -> application process starts
```

This compact trace is a sequence of operations, so a text block is useful here. The sandbox is the shared runtime context for the Pod. With conventional Linux container runtimes, it commonly includes infrastructure that keeps Pod-level namespaces alive while application containers start and restart. Other runtime handlers may provide stronger isolation through a lightweight virtual machine. The CRI abstraction lets kubelet request the Pod-level environment while each runtime chooses its internal implementation.

On a Linux node with a CRI runtime, an administrator can inspect this lower layer with `crictl`:

```bash
sudo crictl pods --name search-api
sudo crictl ps --name search-api
sudo crictl inspectp <pod-sandbox-id>
```

Application developers usually stay with `kubectl`. The node-level commands are valuable when the API says a Pod is assigned yet container creation or sandbox networking is failing.

### The runtime result returns through Pod status

After the sandbox and container start, kubelet reports observations such as the Pod IP, host IP, container ID, image ID, start time, and conditions:

```yaml
status:
  hostIP: 10.0.4.23
  podIP: 10.244.3.18
  phase: Running
  conditions:
    - type: PodReadyToStartContainers
      status: "True"
    - type: Ready
      status: "True"
  containerStatuses:
    - name: search-api
      ready: true
      restartCount: 0
      containerID: containerd://4c07c1...
      imageID: ghcr.io/example-commerce/search-api@sha256:91ae...
      state:
        running:
          startedAt: "2026-08-19T09:14:22Z"
```

The `spec` expresses the requested Pod. The `status` records what the cluster has observed while trying to realize it. Reading both sides is one of the most useful Kubernetes habits.

## What Do Containers Inside One Pod Share?
<!-- section-summary: Containers in one Pod share a network context and can mount common Pod volumes, while each container retains its own image filesystem and process environment. -->

Co-location matters because a Pod supplies resources at Pod scope.

### One network context

Containers in a normal Pod share one network namespace. That gives them:

- the same Pod IP address;
- the same port space;
- access to one another through `localhost`;
- the same configured Pod DNS view.

Suppose a banking authorization Pod contains an `authorization-api` listening on port `8080` and a local mTLS proxy listening on `15001`:

```yaml
spec:
  containers:
    - name: authorization-api
      image: ghcr.io/example-bank/authorization-api:5.8.0
      ports:
        - containerPort: 8080
    - name: mtls-proxy
      image: ghcr.io/example-bank/mtls-proxy:1.12.4
      ports:
        - containerPort: 15001
```

The proxy can forward to `127.0.0.1:8080`. Both processes appear outside the Pod through the same Pod IP. Because they share one port space, each process needs a distinct listening port.

This local connection avoids a Service lookup and a trip through the cluster network. It also creates close operational coupling: if the proxy must accompany every API process, placing both in one Pod keeps that invariant true.

### Shared files come from volumes

Each container image supplies its own root filesystem. Kubernetes shares selected paths by mounting the same Pod volume into multiple containers.

For a video platform, a transcoder can write streaming segments into an `emptyDir` volume while an uploader sends completed files to object storage:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: transcode-job
  namespace: media-processing
spec:
  volumes:
    - name: segments
      emptyDir:
        sizeLimit: 8Gi
  containers:
    - name: transcoder
      image: ghcr.io/example-video/transcoder:3.7.0
      volumeMounts:
        - name: segments
          mountPath: /work/segments
    - name: segment-uploader
      image: ghcr.io/example-video/segment-uploader:2.2.1
      volumeMounts:
        - name: segments
          mountPath: /queue
```

`/work/segments/chunk-0042.m4s` in the transcoder and `/queue/chunk-0042.m4s` in the uploader refer to the same volume data. The mount paths can differ because each container has its own filesystem view.

An `emptyDir` volume exists for the Pod's lifetime on its current node. A container restart inside that Pod preserves the files. Pod deletion ends the `emptyDir` data. Data that must outlive a Pod belongs on durable external storage, commonly through a PersistentVolumeClaim or an object store.

### Process visibility has its own boundary

Containers normally keep separate process namespaces, even while sharing networking. A `ps` command inside `authorization-api` therefore lists that container's process view; the proxy's processes stay in the proxy container's view.

Specialised Pods can request a shared process namespace:

```yaml
spec:
  shareProcessNamespace: true
```

This can help a debugging or supervision tool observe processes across containers. It also changes the isolation relationship, so it deserves an explicit reason and an appropriate security review.

The result is a precise sharing model:

| Resource | Default relationship inside one Pod |
|---|---|
| Node placement | Shared |
| Pod IP and network namespace | Shared |
| Port space | Shared |
| Pod volumes | Shared when mounted into each container |
| Container image filesystem | Separate |
| Environment variables | Configured separately per container |
| Process namespace | Separate by default; optionally shared |

## Which Containers Belong Together in One Pod?
<!-- section-summary: Containers belong in one Pod when they require the same placement and lifetime and cooperate through Pod-local networking or storage. -->

The design question is about **operational independence**.

Containers are a good Pod-level match when all of these statements are true:

- they should always land on the same node;
- they should start and end as one application instance;
- they exchange data through `localhost` or a local volume;
- their scaling relationship is one-to-one;
- one controller should replace the complete unit.

The video transcoder and segment uploader satisfy those conditions. One uploader per transcoder keeps the local queue moving. Scheduling them separately would require remote storage or a message broker for the intermediate segments and extra coordination for ownership and cleanup.

A storefront web application and product-search API fail the same test. The frontend may need five replicas while search needs fifty. They have separate release cycles and communicate through a stable network interface. Separate Deployments and Pods preserve that freedom.

### Container roles express startup and lifetime

A Pod can contain three important roles.

#### Regular init containers

Regular init containers run sequentially before the application containers. Each one must complete successfully before the next starts. They suit finite preparation work such as rendering a configuration file or checking a schema version.

```yaml
spec:
  initContainers:
    - name: render-config
      image: ghcr.io/example-commerce/config-renderer:1.6.0
      command: ["/bin/render-config"]
      args: ["--output", "/generated/search.yaml"]
      volumeMounts:
        - name: generated-config
          mountPath: /generated
  containers:
    - name: search-api
      image: ghcr.io/example-commerce/search-api:2.3.1
      volumeMounts:
        - name: generated-config
          mountPath: /etc/search
  volumes:
    - name: generated-config
      emptyDir: {}
```

The init container exits after writing the file. The main container then reads `/etc/search/search.yaml` from the same volume.

#### Application containers

Application containers perform the Pod's main work. A Pod may have several, though one remains the usual shape. For a Job, their successful completion determines when the work has finished.

#### Native sidecar containers

Kubernetes supports sidecars as entries under `initContainers` with `restartPolicy: Always`. This feature is stable from Kubernetes 1.33. A native sidecar starts in init order, remains running beside the application containers, and receives ordered shutdown treatment when the Pod terminates.

```yaml
spec:
  initContainers:
    - name: segment-uploader
      image: ghcr.io/example-video/segment-uploader:2.2.1
      restartPolicy: Always
      startupProbe:
        exec:
          command: ["/bin/test", "-S", "/run/uploader.sock"]
        periodSeconds: 1
        failureThreshold: 30
      volumeMounts:
        - name: segments
          mountPath: /queue
  containers:
    - name: transcoder
      image: ghcr.io/example-video/transcoder:3.7.0
      volumeMounts:
        - name: segments
          mountPath: /work/segments
```

The sidecar's startup probe can hold later init progress until the upload service is ready. For a Job, the main container can finish while the native sidecar is still running; Kubernetes understands the sidecar role and allows the Job to complete from the main workload's result.

An ordinary second application container may also act as a helper, but its lifecycle semantics are the same as any other app container. Native sidecars make startup and shutdown relationships explicit in the Pod API.

## What Changes During a Container Restart and a Pod Replacement?
<!-- section-summary: A container restart reuses the existing Pod sandbox and identity, while replacement creates a new Pod object with a new UID and usually a new IP and node placement. -->

Kubernetes performs two very different recovery operations.

### A container restart stays inside the Pod

The kubelet can restart a failed container according to the Pod's `restartPolicy`, whose default is `Always`. The Pod object, UID, node assignment, Pod IP, and mounted Pod volumes stay in place while the runtime creates a fresh container process.

For example, after an out-of-memory termination:

```yaml
status:
  phase: Running
  containerStatuses:
    - name: search-api
      restartCount: 3
      lastState:
        terminated:
          reason: OOMKilled
          exitCode: 137
      state:
        running:
          startedAt: "2026-08-19T10:42:51Z"
```

The current process is running, and `lastState` records the previous termination. An `emptyDir` volume still contains its Pod-scoped files. The container's writable image layer starts fresh, so application state stored only there disappears with the old container.

### A replacement is a new Pod

A Deployment, StatefulSet, DaemonSet, or Job controller manages Pods to maintain a desired workload. When a Pod disappears or its node becomes unavailable, the controller can create another Pod object from the workload template.

The replacement receives:

- a new UID;
- a new creation timestamp;
- a fresh sandbox and containers;
- usually a new Pod IP;
- potentially a different node;
- fresh Pod-lifetime storage such as `emptyDir`.

![A workload controller replacing one failed search-api Pod with a new Pod that has a different UID, IP, and node while a Service continues selecting the stable application label](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-pods/pod-replacement-identity.png)

*The workload's desired replica remains, while the individual Pod identity changes.*

Suppose a Deployment wants three product-search replicas. One old Pod and its replacement might look like this:

```text
Old Pod name: search-api-7cb49d6bbf-d4q2p
Old Pod UID:  6176f9fc-27b4-4ba7-88a7-28fdc21d36a2
Old Pod IP:   10.244.3.18
Old node:     worker-03

New Pod name: search-api-7cb49d6bbf-k9mx7
New Pod UID:  c2fd2524-40d8-4184-b39c-f8ef49d1eb5d
New Pod IP:   10.244.7.31
New node:     worker-07

Shared label: app.kubernetes.io/name=search-api
```

The Pod names look related because the Deployment and ReplicaSet generate them from the same template. Their UIDs prove they are separate API objects. A Service selects the stable label and updates its endpoints as ready replicas change, so clients use the Service identity while Pods remain replaceable.

StatefulSets add stable ordinal names and persistent-volume relationships for applications that need them. Even there, recreating `database-0` produces a new Pod UID and a new Pod lifetime. Stable workload identity and individual Pod identity remain separate concepts.

## How Does a Pod Start, Become Ready, and Shut Down?
<!-- section-summary: Pod startup builds the sandbox, completes initialization, starts application containers, proves readiness, and later drains traffic before processes are terminated. -->

A Pod lifecycle is a sequence of observable gates. Understanding those gates helps distinguish slow startup, broken networking, unavailable dependencies, unhealthy processes, and graceful termination.

### 1. Scheduling chooses the node

The scheduler records a node assignment. The `PodScheduled` condition changes to `True`. A Pod can remain `Pending` here while the scheduler searches for a node that satisfies resource requests, affinity rules, taints, volume constraints, and other scheduling requirements.

### 2. The runtime prepares the Pod sandbox

The kubelet asks the runtime to create the sandbox and establish networking. The `PodReadyToStartContainers` condition changes to `True` after sandbox creation and network configuration succeed. This condition is especially useful because a Pod can be scheduled while its node-level runtime environment is still being prepared.

For example:

```yaml
conditions:
  - type: PodScheduled
    status: "True"
  - type: PodReadyToStartContainers
    status: "False"
```

This places the problem after scheduling and before application startup. Pod events and kubelet evidence can then show whether volume preparation, sandbox creation, or network configuration is still in progress or has failed.

### 3. Init containers prepare the instance

Regular init containers run in order and finish. Native sidecars start according to their init ordering and remain active. The `Initialized` condition then changes to `True` when Kubernetes has satisfied the Pod's initialization requirements.

For a Pod with zero init containers, kubelet can set `Initialized=True` before sandbox creation. In that case, `PodReadyToStartContainers` provides the clearer signal for the runtime sandbox and network boundary.

### 4. Application containers start

The runtime creates the application containers and starts their processes. A **startup probe** can give a slow application time to initialize before liveness and readiness checks begin.

Consider a recommendation service that loads an 8 GiB model and builds an in-memory index. The process may accept a TCP connection before it can answer recommendations correctly. Its probes can express three separate questions:

```yaml
startupProbe:
  httpGet:
    path: /startup
    port: 8080
  periodSeconds: 5
  failureThreshold: 60
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  periodSeconds: 5
livenessProbe:
  httpGet:
    path: /live
    port: 8080
  periodSeconds: 10
  failureThreshold: 3
```

- **Startup:** Has model loading finished far enough for normal health checks to make sense?
- **Readiness:** Can this instance serve production requests now?
- **Liveness:** Has this process reached a state where restarting it is the useful recovery action?

When every required container is ready, `ContainersReady` changes to `True`. When the Pod also satisfies any custom readiness gates, `Ready` changes to `True`. Service controllers use readiness when publishing Pod endpoints, so a running process can stay outside normal traffic until its dependencies and internal state are ready.

### 5. Deletion starts a graceful handoff

Deleting a Pod sets a deletion timestamp and starts its termination grace period, which defaults to 30 seconds. During this period, Kubernetes exposes the endpoint as terminating and marks its normal readiness false, allowing traffic infrastructure to stop choosing it for new requests.

If a container defines a `preStop` hook, kubelet runs it within the same grace-period budget. Kubelet then asks the runtime to send the container's stop signal, commonly `SIGTERM`. The process can stop accepting new requests, finish in-flight work, flush buffers, and exit.

```yaml
spec:
  terminationGracePeriodSeconds: 45
  containers:
    - name: authorization-api
      image: ghcr.io/example-bank/authorization-api:5.8.0
      lifecycle:
        preStop:
          httpGet:
            path: /drain
            port: 8080
```

If processes remain after the grace period, kubelet forces their termination. Native sidecars receive termination after the main application containers, in reverse order, which keeps supporting processes available while the primary workload drains.

Graceful shutdown therefore coordinates two views of the same instance: the network view stops sending new traffic, and the process view receives time to finish existing work.

## How Do Phase, Container State, Conditions, and STATUS Describe One Pod?
<!-- section-summary: Pod phase, per-container state, Pod conditions, and kubectl STATUS summarize different layers of the same lifecycle and can legitimately show different words. -->

Kubernetes exposes several status vocabularies because scheduling, sandbox creation, container state, readiness, and recent failures each need their own signal.

![Four coordinated views of one Pod: overall phase, current and previous container state, readiness conditions, and the human-oriented kubectl STATUS column](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-pods/pod-lifecycle-signals.png)

*Read each signal as an answer to a different question about the same Pod.*

### Pod phase gives the broad lifecycle category

The API defines a small set of Pod phases:

| Phase | Meaning |
|---|---|
| `Pending` | The cluster accepted the Pod, and one or more containers are still waiting to be set up or started. |
| `Running` | The Pod is bound to a node, all containers have been created, and at least one remains running or is starting or restarting. |
| `Succeeded` | Every container terminated successfully and will stay stopped. |
| `Failed` | Every container terminated, and at least one ended in failure or was terminated by the system. |
| `Unknown` | Communication with the node has failed, so the control plane lacks a current Pod state. |

Phase is intentionally broad. A Pod in phase `Running` can have an application container repeatedly crashing because another container is currently running or because the failed container is waiting between restart attempts.

### Container state describes one container now

Each entry in `status.containerStatuses` has one current state:

- `waiting`, with a reason such as `ContainerCreating` or `CrashLoopBackOff`;
- `running`, with its process start time;
- `terminated`, with exit code, reason, signal, and finish time.

It can also have `lastState`, which preserves the previous state after a restart. This is where `OOMKilled`, exit code `137`, or a completed previous process often appears.

### Conditions record lifecycle gates

Conditions are named checks with `True`, `False`, or `Unknown` values. Common conditions include:

- `PodScheduled`;
- `PodReadyToStartContainers`;
- `Initialized`;
- `ContainersReady`;
- `Ready`.

Conditions also carry `reason`, `message`, and transition time. Together, those fields show which lifecycle gates have completed and which gate is still waiting.

### `kubectl get pods` STATUS is a display summary

The `STATUS` column in `kubectl get pods` chooses a useful human-facing reason from the available lifecycle data. Values such as `CrashLoopBackOff`, `ImagePullBackOff`, `Terminating`, and `ContainerCreating` are often more actionable than the broad Pod phase. They are display summaries, while `.status.phase` remains the API field.

One Pod can therefore produce all of these observations together:

```text
Pod phase:                Running
Container current state: Waiting
Container waiting reason: CrashLoopBackOff
Last container state:    Terminated, exit code 1
Ready condition:         False
kubectl STATUS:           CrashLoopBackOff
```

These values describe separate layers. A restartable container has failed, kubelet is applying a backoff before the next attempt, the Pod remains in its broad running lifecycle, and readiness keeps it out of normal Service traffic.

The raw object makes the layers concrete:

```yaml
status:
  phase: Running
  conditions:
    - type: Ready
      status: "False"
      reason: ContainersNotReady
  containerStatuses:
    - name: catalog-api
      ready: false
      restartCount: 6
      state:
        waiting:
          reason: CrashLoopBackOff
          message: back-off 1m20s restarting failed container=catalog-api
      lastState:
        terminated:
          reason: Error
          exitCode: 1
```

## How Do You Trace a Pod from Scheduling to Application Failure?
<!-- section-summary: Diagnose a Pod in lifecycle order, using assignment, conditions, events, container state, logs, and runtime inspection to find the first stage that failed. -->

Commands that follow the execution path make Pod debugging much clearer. Start with the stored object and identify the first incomplete or failing layer.

### 1. Confirm identity, node, IP, readiness, and restarts

```bash
kubectl get pod catalog-api-6fd66c48c8-5vr7n \
  --namespace storefront \
  --output wide
```

Look for:

- `NODE`: whether scheduling completed;
- `IP`: whether the Pod network was established;
- `READY`: how many containers currently pass readiness;
- `RESTARTS`: whether kubelet has recreated a container process;
- `STATUS`: the most useful current summary.

### 2. Read conditions, container state, and events together

```bash
kubectl describe pod catalog-api-6fd66c48c8-5vr7n \
  --namespace storefront
```

`describe` combines several useful views: node assignment, container state, last termination, probe results, volume mounts, conditions, and recent events.

Events can place a failure before the process starts:

```text
Warning  FailedScheduling  0/8 nodes are available: 8 Insufficient memory
Warning  FailedMount       configmap "catalog-settings" not found
Warning  Failed            failed to pull image "...:2.4.0"
```

These failures occur before application code runs. The event names identify the responsible stage, so the investigation can stay at scheduling, volume setup, or image retrieval.

### 3. Inspect the exact API fields when summaries are too compact

```bash
kubectl get pod catalog-api-6fd66c48c8-5vr7n \
  --namespace storefront \
  --output yaml
```

Focused JSONPath queries are useful during repeated checks:

```bash
kubectl get pod catalog-api-6fd66c48c8-5vr7n \
  --namespace storefront \
  --output jsonpath='{.spec.nodeName}{"\n"}{.status.phase}{"\n"}{.status.containerStatuses[*].state}{"\n"}'
```

This distinguishes the authored `spec`, the scheduler's node assignment, and kubelet's observed `status` inside one object.

### 4. Read current and previous process output

```bash
kubectl logs catalog-api-6fd66c48c8-5vr7n \
  --namespace storefront \
  --container catalog-api
```

After a restart, the current container may have produced very little output. Ask kubelet for the previous container instance:

```bash
kubectl logs catalog-api-6fd66c48c8-5vr7n \
  --namespace storefront \
  --container catalog-api \
  --previous
```

Suppose it prints:

```text
configuration error: /etc/catalog/ranking.yaml: no such file or directory
```

Now compare the manifest's volume name and mount path with the process argument:

```bash
kubectl get pod catalog-api-6fd66c48c8-5vr7n \
  --namespace storefront \
  --output jsonpath='{.spec.containers[?(@.name=="catalog-api")].volumeMounts}'
```

This is a process-start failure inside a successfully scheduled, networked, and mounted Pod. The earlier layers worked; the application expected `/etc/catalog/ranking.yaml`, while the current mount exposes its configuration at a different path.

### 5. Inspect a running container's view

```bash
kubectl exec catalog-api-6fd66c48c8-5vr7n \
  --namespace storefront \
  --container catalog-api \
  -- ls -la /etc/catalog
```

`exec` is suitable when the container stays running and contains a usable shell or diagnostic command. It shows the filesystem and environment visible to that exact container.

### 6. Add a temporary debugging container when the image is minimal

Production images often omit shells, package managers, and network tools. An ephemeral debug container can join the existing Pod for troubleshooting:

```bash
kubectl debug -it catalog-api-6fd66c48c8-5vr7n \
  --namespace storefront \
  --image=busybox:1.36 \
  --target=catalog-api
```

The debug container can inspect the Pod network and, where the runtime supports process targeting, the target container's process context. It leaves the original image and workload template unchanged.

### 7. Move to the node/runtime layer when sandbox creation fails

When `PodReadyToStartContainers=False`, events mention sandbox creation, or kubelet reports a runtime error, cluster operators may need the node view:

```bash
sudo crictl pods --name catalog-api
sudo crictl inspectp <pod-sandbox-id>
sudo journalctl --unit kubelet
```

That layer can reveal an unavailable CRI endpoint, failed sandbox, missing CNI configuration, or runtime-level resource problem. The diagnostic order has narrowed the search from the whole cluster to the component responsible for turning the assigned Pod into a runtime environment.

Workload controllers add one more layer above the Pod. A Deployment can replace a failed Pod, yet the reason for a container crash still lives in the Pod's events, status, and logs. The next article follows how Deployments and ReplicaSets create and maintain those replaceable instances.

## Check Your Answers
<!-- section-summary: Revisit Pod scheduling, runtime realization, shared resources, container grouping, restart and replacement, lifecycle gates, status signals, and diagnosis. -->

:::expand[Why Is the Pod Kubernetes' Smallest Schedulable Unit?]{kind="recap"}
A Pod gives Kubernetes one API object for placing and operating a complete application instance. It combines one scheduling decision, a runtime sandbox, networking, volumes, lifecycle rules, status, and one or more tightly coupled containers. One container per Pod is common; multiple containers fit when they require the same node and lifetime.
:::

:::expand[How Does a Pod Object Become Running Processes on a Node?]{kind="recap"}
The API server stores the Pod, the scheduler records a node assignment, and that node's kubelet performs the runtime work. Kubelet uses CRI calls to create a Pod sandbox, prepare networking and mounts, create containers, start their processes, and report observations back into Pod status.
:::

:::expand[What Do Containers Inside One Pod Share?]{kind="recap"}
Containers share the Pod's network namespace, Pod IP, and port space. They can mount the same Pod volumes at chosen paths. Each container keeps its own image filesystem, environment configuration, and normally its own process namespace.
:::

:::expand[Which Containers Belong Together in One Pod?]{kind="recap"}
Containers fit together when they need the same placement, lifetime, local network, or local files and should scale as one unit. Regular init containers perform finite preparation, application containers perform the main work, and native sidecars remain active to support that work with explicit startup and shutdown semantics.
:::

:::expand[What Changes During a Container Restart and a Pod Replacement?]{kind="recap"}
A container restart occurs inside the existing Pod sandbox, so the Pod UID, node, IP, and Pod volumes remain. A controller replacement creates a new Pod object with a new UID, sandbox, containers, and usually a new IP or node. Services and controllers rely on stable labels and workload intent while individual Pods remain replaceable.
:::

:::expand[How Does a Pod Start, Become Ready, and Shut Down?]{kind="recap"}
Scheduling selects a node, sandbox creation prepares Pod-level isolation and networking, initialization completes, application processes start, and probes establish startup and readiness. During deletion, endpoint readiness falls, lifecycle hooks and stop signals give processes a grace period, and the runtime forces termination if that budget expires.
:::

:::expand[How Do Phase, Container State, Conditions, and STATUS Describe One Pod?]{kind="recap"}
Phase gives a broad Pod lifecycle category. Container state describes each container now and `lastState` preserves its previous outcome. Conditions record lifecycle gates such as scheduling and readiness. The `kubectl` STATUS column chooses a useful human summary, so `Running`, `Waiting`, `Ready=False`, and `CrashLoopBackOff` can all describe different layers of one Pod at the same time.
:::

:::expand[How Do You Trace a Pod from Scheduling to Application Failure?]{kind="recap"}
Follow the same order Kubernetes uses: confirm assignment and IP, read conditions and events, inspect exact status fields, read current and previous logs, inspect a running container's view, add an ephemeral debugger when needed, and move to kubelet or CRI evidence when sandbox creation is the failing layer.
:::

## References
<!-- section-summary: Kubernetes documentation defines Pod structure, scheduling, networking, storage, container lifecycle, readiness, status, and debugging behavior. -->

- [Kubernetes documentation: Pods](https://kubernetes.io/docs/concepts/workloads/pods/)
- [Kubernetes documentation: Pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Kubernetes documentation: Pod conditions](https://kubernetes.io/docs/concepts/workloads/pods/pod-condition/)
- [Kubernetes documentation: Container Runtime Interface](https://kubernetes.io/docs/concepts/containers/cri/)
- [Kubernetes CRI API: `RunPodSandbox` and `PodSandboxConfig`](https://github.com/kubernetes/cri-api/blob/master/pkg/apis/runtime/v1/api.proto)
- [Kubernetes documentation: Sidecar containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)
- [Kubernetes documentation: Configure a shared process namespace](https://kubernetes.io/docs/tasks/configure-pod-container/share-process-namespace/)
- [Kubernetes documentation: Volumes](https://kubernetes.io/docs/concepts/storage/volumes/)
- [Kubernetes documentation: Liveness, readiness, and startup probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)
- [Kubernetes documentation: Container lifecycle hooks](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/)
- [Kubernetes documentation: Explore Pod and endpoint termination](https://kubernetes.io/docs/tutorials/services/pods-and-endpoint-termination-flow/)
- [Kubernetes documentation: Debug running Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/)
- [Kubernetes documentation: Debug nodes with `crictl`](https://kubernetes.io/docs/tasks/debug/debug-cluster/crictl/)
