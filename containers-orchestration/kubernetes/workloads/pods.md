---
title: "Pods"
description: "Run containers as Kubernetes Pods, inspect their lifecycle, and diagnose Pod readiness failures."
overview: "Pods are the smallest deployable compute object in Kubernetes. This article shows how a Pod wraps the containers for `devpolaris-orders-api`, how Kubernetes reports Pod state, and how to debug the first failures you will meet."
tags: ["pods", "containers", "kubectl", "probes"]
order: 1
id: article-containers-orchestration-kubernetes-workloads-pods
---

## Table of Contents

1. [The Pieces Around a Pod](#the-pieces-around-a-pod)
2. [What a Pod Is](#what-a-pod-is)
3. [A One-Container Pod for the Orders API](#a-one-container-pod-for-the-orders-api)
4. [Multi-Container Pods](#multi-container-pods)
5. [Shared Network and Shared Storage](#shared-network-and-shared-storage)
6. [Pod Lifecycle and Pod State](#pod-lifecycle-and-pod-state)
7. [Readiness, Liveness, and Startup Probes](#readiness-liveness-and-startup-probes)
8. [Why Teams Usually Create Pods Through Controllers](#why-teams-usually-create-pods-through-controllers)
9. [Inspecting a Healthy Pod](#inspecting-a-healthy-pod)
10. [Debugging Common Pod Failures](#debugging-common-pod-failures)
11. [Production Pod Guidance](#production-pod-guidance)
12. [References](#references)

## The Pieces Around a Pod
<!-- section-summary: Pods sit between container images and higher-level Kubernetes controllers, so understanding Pods makes every later workload object easier to debug. -->

The scenario for this article is `devpolaris-orders-api`, a small HTTP API that accepts customer orders and stores them in PostgreSQL. The team already has a container image called `ghcr.io/devpolaris/orders-api:2026-06-14.1`, and now the team wants Kubernetes to run it in a cluster.

Kubernetes places a workload object, rather than a raw container image, onto a node. Kubernetes creates an API object, stores the desired state for that object, schedules it to a node, and asks the node agent to run containers that match the object. The smallest workload object in that path is the **Pod**.

Here is the set of ideas we will connect in this article:

| Concept | Plain meaning | How it shows up for `devpolaris-orders-api` |
|---|---|---|
| **Container image** | The packaged application file system and startup command | `ghcr.io/devpolaris/orders-api:2026-06-14.1` |
| **Pod** | The runnable Kubernetes wrapper around one or more containers | One API container, one Pod IP, labels, probes, and status |
| **Node** | A worker machine where Pods run | The Pod may land on `worker-a` or another schedulable node |
| **Kubelet** | The node agent that starts containers and reports Pod status | It pulls the image, starts the API process, runs probes, and reports events |
| **Controller** | A higher-level object that keeps Pods replaced and updated | A Deployment usually creates the orders API Pods in production |

This order matters because the first Kubernetes debugging question usually asks where the Pod sits in this path. The answer may be waiting for a node, waiting for an image, running but failing readiness, or restarting after the process exits.

## What a Pod Is
<!-- section-summary: A Pod is the smallest deployable compute object in Kubernetes, and it wraps containers with shared runtime settings and one Kubernetes status record. -->

A **Pod** is the smallest deployable compute unit that Kubernetes creates and manages. It can contain one container or a small group of tightly connected containers, and Kubernetes treats that group as one scheduled unit. The containers in one Pod share the same placement decision, network identity, and any volumes that the Pod defines.

For `devpolaris-orders-api`, the most common shape is one container in one Pod. The API process listens on port `8080`, Kubernetes gives the Pod an internal IP, and the Pod status tells the team whether the container has started, restarted, or become ready for traffic. Even though one container runs inside it, the Pod remains the object that Kubernetes schedules and reports.

This wrapper gives Kubernetes a place to store runtime details that belong around the container. Labels help Services and controllers find the Pod. Environment variables provide configuration. Volumes mount files into containers. Probes tell Kubernetes whether the application can receive traffic or needs a restart. Restart policy tells the node what to do when the process exits.

The important production lesson is that Pod state and container state are related but separate signals. A container can be running while the Pod stays unready. A Pod can be scheduled while the image still fails to pull. A Pod can show `CrashLoopBackOff` while Kubernetes keeps retrying the same container because the restart policy allows it.

## A One-Container Pod for the Orders API
<!-- section-summary: A single-container Pod is the normal first shape for an API, and the manifest shows how Kubernetes receives the image, labels, ports, and configuration. -->

A **Pod manifest** is a YAML document that describes the Pod Kubernetes should create. The API server stores that document as desired state, the scheduler chooses a node, and the kubelet on that node starts the container through the configured container runtime.

Here is a direct Pod manifest for `devpolaris-orders-api`. This shape is useful for learning and debugging because it removes the Deployment layer for a moment and lets us look at the Pod itself.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: devpolaris-orders-api
  labels:
    app: devpolaris-orders-api
    component: api
    environment: training
spec:
  containers:
    - name: api
      image: ghcr.io/devpolaris/orders-api:2026-06-14.1
      imagePullPolicy: IfNotPresent
      ports:
        - name: http
          containerPort: 8080
      env:
        - name: NODE_ENV
          value: production
        - name: ORDERS_DB_HOST
          value: orders-postgres.default.svc.cluster.local
```

The top part names the Kubernetes object. `apiVersion: v1` and `kind: Pod` tell the API server which schema this object uses. `metadata.name` gives the Pod its name in the namespace. The labels describe the Pod in a way other Kubernetes objects can select later.

The `spec` describes the runtime. The `containers` list has one entry named `api`, and that entry points to the orders API image. The `ports` field documents that the process listens on port `8080` inside the Pod. That field by itself leaves the API internal; a Service or another networking object handles stable routing.

The team can send this manifest to a training cluster:

```bash
$ kubectl apply -f pod.yaml
pod/devpolaris-orders-api created

$ kubectl get pod devpolaris-orders-api -o wide
NAME                    READY   STATUS    RESTARTS   AGE   IP           NODE
devpolaris-orders-api   1/1     Running   0          32s   10.42.1.18   worker-a
```

The output gives a compact first reading. `READY` means one of one containers is ready. `STATUS` gives the high-level phase or waiting reason that Kubernetes currently reports. `RESTARTS` counts container restarts, and `NODE` shows where the Pod landed.

## Multi-Container Pods
<!-- section-summary: Multi-container Pods work best for tightly coupled helper containers that need the same network identity or the same local files as the main container. -->

A **multi-container Pod** is a Pod with more than one container in the same shared Pod context. Kubernetes supports this because some helpers need to sit right beside the main application process. A log shipper, local proxy, metrics exporter, or file refresher can live in the same Pod when the helper needs the same local network or mounted files.

For the orders API, imagine the application writes Prometheus-style metrics to a local Unix socket under `/var/run/orders`. The team wants a tiny metrics sidecar to read that socket and expose metrics on another port. The sidecar belongs in the same Pod because it is part of the same local runtime contract as the API.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: devpolaris-orders-api
  labels:
    app: devpolaris-orders-api
    component: api
spec:
  containers:
    - name: api
      image: ghcr.io/devpolaris/orders-api:2026-06-14.1
      ports:
        - name: http
          containerPort: 8080
      volumeMounts:
        - name: runtime
          mountPath: /var/run/orders
    - name: metrics-sidecar
      image: ghcr.io/devpolaris/orders-metrics:2026-06-14.1
      ports:
        - name: metrics
          containerPort: 9090
      volumeMounts:
        - name: runtime
          mountPath: /var/run/orders
  volumes:
    - name: runtime
      emptyDir: {}
```

The two containers share the `runtime` volume. The API can create the socket, and the sidecar can read it from the same path. The containers also share the Pod network namespace, so one container can reach another through `localhost` and its container port.

This pattern should stay narrow. When a helper has its own scale, deployment schedule, or failure behavior, it often belongs in its own Pod with its own controller. A metrics sidecar that depends on the API process is a good fit. A separate worker that processes order events from a queue usually deserves its own Deployment.

## Shared Network and Shared Storage
<!-- section-summary: Containers inside one Pod share the Pod IP and declared volumes, which is powerful for local cooperation and risky for data that must survive Pod replacement. -->

Every Pod receives one network identity inside the cluster. Containers inside that Pod share the same Pod IP and port space. If the `api` container listens on `8080`, another container in the same Pod can call `http://localhost:8080` because both containers share the same network namespace.

That shared network is useful for local cooperation. A sidecar proxy can listen on `localhost:15001` and forward outbound traffic. A metrics exporter can scrape a local endpoint without a Service. A security agent can watch local traffic for the Pod. These designs use the Pod as a small runtime envelope around closely related processes.

Volumes work in a similar way. The Pod defines the volume, and each container chooses where to mount it. The `emptyDir` volume from the previous example creates temporary storage that exists for the life of the Pod. If the Pod disappears and Kubernetes creates a replacement, that data disappears with the old Pod.

That storage behavior matters for production. Temporary files, generated configuration, sockets, and scratch caches can use `emptyDir`. Customer orders, uploaded receipts, audit records, and database files need durable storage outside the replaceable Pod, such as a database, object storage, or a PersistentVolume that fits the workload.

## Pod Lifecycle and Pod State
<!-- section-summary: Pod status tells you which part of the run path is failing: scheduling, image pulling, container startup, restarts, readiness, or termination. -->

The **Pod lifecycle** is the path from accepted Pod spec to a final state such as running, succeeded, failed, or removed. Kubernetes reports this through fields on the Pod status, container status, conditions, and events. Those fields give the team a structured way to investigate instead of jumping straight into application logs.

For `devpolaris-orders-api`, the normal path looks like this. The API server accepts the Pod. The scheduler assigns it to a node. The kubelet on that node pulls the image. The container starts. The app opens port `8080`. Probes run. Once readiness passes, a Service can include the Pod as a traffic endpoint.

Common status values point to different parts of that path:

| Status or reason | What Kubernetes is telling you | First place to look |
|---|---|---|
| `Pending` | The Pod is still waiting to start fully, often because scheduling, image pulling, or volume setup is waiting | `kubectl describe pod` events, node capacity, volume events |
| `ContainerCreating` | The kubelet is preparing the runtime, pulling images, or mounting volumes | Events, image pull messages, volume mount messages |
| `Running` with `0/1 READY` | The container process is running, but readiness is still failing | Readiness probe result, application logs, dependency health |
| `CrashLoopBackOff` | The container starts, exits, and Kubernetes waits before another restart | Previous logs, exit code, command, missing config |
| `ImagePullBackOff` | The kubelet cannot pull the image and is backing off between retries | Image name, tag, registry auth, network access |

Behind the scenes, Kubernetes separates a broad **Pod phase** from more specific container waiting reasons. The `STATUS` column in `kubectl get pod` often shows the useful waiting reason, such as `CrashLoopBackOff`, even though the Pod phase itself has a smaller official set of values. That detail explains why the table view can look more specific than the conceptual lifecycle diagram.

## Readiness, Liveness, and Startup Probes
<!-- section-summary: Probes let Kubernetes ask the application separate questions about startup, traffic readiness, and whether the container should be restarted. -->

A **probe** is a health check that the kubelet runs against a container. Probes connect the application’s own health signals to Kubernetes decisions. For an HTTP API, probes usually call endpoints such as `/health/startup`, `/health/ready`, and `/health/live`.

The orders API has two dependencies during startup: configuration must load, and the database connection pool must open. The team wants Kubernetes to wait for those checks before sending traffic. A readiness probe gives Kubernetes that signal.

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: http
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

**Readiness** answers the traffic question: should this Pod receive requests right now? If the database connection fails or a downstream dependency is unavailable, the app can return a failure from `/health/ready`, and Kubernetes can keep the Pod out of Service endpoints until the check passes.

**Liveness** answers the restart question: is this process stuck badly enough that the kubelet should restart the container? A good liveness endpoint usually checks the local process rather than every external dependency. If the database has a short outage and liveness checks the database, Kubernetes may restart every healthy API process during an incident and make recovery noisier.

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: http
  initialDelaySeconds: 30
  periodSeconds: 20
  timeoutSeconds: 2
  failureThreshold: 3
```

**Startup** answers the slow-boot question: has this container finished its initial startup path? A startup probe is useful for applications that need time to run migrations, warm caches, load large configuration, or compile assets before liveness should begin judging them.

```yaml
startupProbe:
  httpGet:
    path: /health/startup
    port: http
  periodSeconds: 5
  failureThreshold: 24
```

With this setup, the orders API can take up to two minutes to finish startup before liveness starts applying pressure. After startup succeeds, readiness controls traffic, and liveness handles a genuinely stuck process. Those three checks give Kubernetes separate signals instead of one overloaded health endpoint.

## Why Teams Usually Create Pods Through Controllers
<!-- section-summary: Direct Pods are useful for learning and debugging, while controllers create replacement Pods and keep production services available. -->

A **direct Pod** is a Pod object created by a person or script without a higher-level owner. It is useful in a lab because it shows the exact workload unit. It is also useful for temporary debugging, such as launching a short-lived curl Pod inside the cluster to test DNS or network paths.

Production APIs usually need a stronger promise. The team wants three orders API replicas, replacements when a node fails, controlled image updates, and rollout history. A direct Pod cannot express that whole operating contract by itself. A controller can.

The usual controller for a stateless API is a **Deployment**. The Deployment creates ReplicaSets, and ReplicaSets create Pods. If a Pod disappears, the ReplicaSet creates another Pod to match the desired replica count. If the team ships image `2026-06-14.2`, the Deployment can create a new ReplicaSet and roll the new Pods in gradually.

Other controllers fit other workload shapes:

| Workload need | Usual object | Why it fits |
|---|---|---|
| Replaceable web API replicas | Deployment | Keeps a desired replica count and manages rollouts |
| One-time task such as a migration | Job | Treats successful completion as the goal |
| Scheduled cleanup or report generation | CronJob | Creates Jobs on a schedule |
| One Pod on each node for logs or agents | DaemonSet | Follows node membership |
| Stable identity and stable storage | StatefulSet | Gives ordered names and volume identity |

The Pod remains the thing Kubernetes runs in all of these cases. The controller decides how many Pods should exist, when replacements should appear, and how updates should move from old Pods to new Pods.

## Inspecting a Healthy Pod
<!-- section-summary: A steady inspection path moves from summary, to full status and events, to logs, then into the container only when process-level evidence is needed. -->

Good Pod debugging starts with the Kubernetes view before the application view. The cluster already knows whether scheduling worked, which node owns the Pod, which image was pulled, whether probes passed, and which events the kubelet reported. That information saves time because it points the investigation toward the right layer.

The team can start with a compact summary:

```bash
$ kubectl get pod devpolaris-orders-api -o wide
NAME                    READY   STATUS    RESTARTS   AGE   IP           NODE
devpolaris-orders-api   1/1     Running   0          4m    10.42.1.18   worker-a
```

The next command expands the Kubernetes story:

```bash
$ kubectl describe pod devpolaris-orders-api
Name:             devpolaris-orders-api
Namespace:        default
Node:             worker-a/10.0.3.21
Labels:           app=devpolaris-orders-api
                  component=api
Containers:
  api:
    Image:        ghcr.io/devpolaris/orders-api:2026-06-14.1
    State:        Running
    Ready:        True
    Restart Count: 0
Conditions:
  Type              Status
  PodScheduled      True
  Ready             True
Events:
  Type    Reason     Age   From     Message
  Normal  Scheduled  4m    default-scheduler  Successfully assigned default/devpolaris-orders-api to worker-a
  Normal  Pulled     4m    kubelet            Container image already present on machine
  Normal  Started    4m    kubelet            Started container api
```

Logs come after the status check because logs explain application behavior, while `describe` explains Kubernetes behavior:

```bash
$ kubectl logs devpolaris-orders-api -c api --tail=30
2026-06-14T09:10:21Z orders-api listening on :8080
2026-06-14T09:10:22Z readiness passed: database reachable
```

When the process is running and the image has a shell or diagnostic tools, `exec` can answer process-level questions from inside the container. Many production images are intentionally small, so logs, metrics, and ephemeral debug containers often matter more than assuming every app image has `sh`, `curl`, or `ps`.

```bash
$ kubectl exec devpolaris-orders-api -c api -- printenv ORDERS_DB_HOST
orders-postgres.default.svc.cluster.local
```

This sequence gives a clean habit: summary first, Kubernetes details second, logs third, shell access only when it will answer a specific question.

## Debugging Common Pod Failures
<!-- section-summary: The same inspect path works for Pending, CrashLoopBackOff, ImagePullBackOff, and readiness failures when you read events and container status carefully. -->

Pod failures can look similar in a dashboard, but the causes live in different layers. `Pending` often points to scheduling or volume setup. `ImagePullBackOff` points to image retrieval. `CrashLoopBackOff` points to a process that keeps exiting. Readiness failures point to an application that is running but still outside the traffic path.

### Pending

`Pending` means Kubernetes has accepted the Pod, but the Pod is still waiting for a running state. For the orders API, this can happen because no node has enough CPU or memory for the Pod request, a node selector matches no nodes, a taint blocks scheduling, or a PersistentVolume claim cannot bind.

```bash
$ kubectl get pod devpolaris-orders-api
NAME                    READY   STATUS    RESTARTS   AGE
devpolaris-orders-api   0/1     Pending   0          2m

$ kubectl describe pod devpolaris-orders-api
Events:
  Type     Reason             Age   From               Message
  Warning  FailedScheduling   92s   default-scheduler  0/3 nodes are available: 3 Insufficient cpu.
```

This message points at capacity. The next step is capacity evidence because no container has started. The team would compare the Pod’s requested CPU with node capacity, then either reduce an unrealistic request, add capacity, or move less urgent workloads away from the cluster.

### ImagePullBackOff

`ImagePullBackOff` means the kubelet failed to pull the container image and is waiting longer between retries. The most common causes are a missing tag, a private registry without the right pull secret, or node network access to the registry failing.

```bash
$ kubectl get pod devpolaris-orders-api
NAME                    READY   STATUS             RESTARTS   AGE
devpolaris-orders-api   0/1     ImagePullBackOff   0          3m

$ kubectl describe pod devpolaris-orders-api
Events:
  Type     Reason     Age    From     Message
  Normal   Pulling    2m58s  kubelet  Pulling image "ghcr.io/devpolaris/orders-api:2026-06-14.9"
  Warning  Failed     2m57s  kubelet  Failed to pull image: manifest unknown
  Warning  Failed     2m57s  kubelet  Error: ErrImagePull
  Normal   BackOff    90s    kubelet  Back-off pulling image
```

`manifest unknown` points to the tag. The team would compare the manifest tag with the tag built by CI, correct the image field, and apply the manifest again. When the event says `unauthorized`, the focus moves to `imagePullSecrets`, registry permissions, and whether the secret exists in the same namespace as the Pod.

### CrashLoopBackOff

`CrashLoopBackOff` means the container starts and exits repeatedly. Kubernetes restarts it according to the restart policy, then waits longer between repeated attempts. The most useful evidence is often the previous container log because the current restart often has little output.

```bash
$ kubectl get pod devpolaris-orders-api
NAME                    READY   STATUS             RESTARTS   AGE
devpolaris-orders-api   0/1     CrashLoopBackOff   6          8m

$ kubectl logs devpolaris-orders-api -c api --previous --tail=40
2026-06-14T09:22:11Z fatal: ORDERS_DB_HOST is required
```

This points to missing configuration. The fix belongs in the Pod template or the object that injects configuration, such as a ConfigMap, Secret, Helm values file, or Kustomize overlay. After the team corrects the environment variable and creates a new Pod, the restart loop should stop because the application process can complete startup.

### Readiness failures

A readiness failure means the container process is running, but the Pod stays outside Service traffic. The most common causes are wrong probe path, wrong port name, slow startup, missing dependency, or an app that returns an unhealthy status until it finishes warmup.

```bash
$ kubectl describe pod devpolaris-orders-api
Containers:
  api:
    State:        Running
    Ready:        False
Events:
  Type     Reason     Age   From     Message
  Warning  Unhealthy  16s   kubelet  Readiness probe failed: HTTP probe failed with statuscode: 503

$ kubectl logs devpolaris-orders-api -c api --tail=20
2026-06-14T09:31:42Z readiness failed: database connection refused
```

This output says Kubernetes reached the app, and the app deliberately reported an unready state. The next investigation goes to the database Service, database Pod, credentials, NetworkPolicy, or connection string. A probe path typo would look different because the app might return `404`, or the event might mention connection refused on the wrong port.

## Production Pod Guidance
<!-- section-summary: Production Pods need clear labels, resource requests, health probes, safe configuration handling, and controller ownership. -->

Production teams usually review Pod templates through the controller that creates them, often a Deployment. The Pod template still carries the details that decide how each replica behaves. Clear labels, resource requests, probes, configuration references, and security settings all live in or near that template.

For the orders API, a stronger Pod spec includes named ports, resource requests, resource limits, probes, and configuration through Kubernetes objects rather than hardcoded values. This example still shows the Pod shape directly, but the same `spec.template.spec` would appear inside a Deployment.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: devpolaris-orders-api
  labels:
    app: devpolaris-orders-api
    component: api
    environment: production
spec:
  containers:
    - name: api
      image: ghcr.io/devpolaris/orders-api:2026-06-14.1
      ports:
        - name: http
          containerPort: 8080
      envFrom:
        - configMapRef:
            name: orders-api-config
        - secretRef:
            name: orders-api-secrets
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 512Mi
      startupProbe:
        httpGet:
          path: /health/startup
          port: http
        periodSeconds: 5
        failureThreshold: 24
      readinessProbe:
        httpGet:
          path: /health/ready
          port: http
        periodSeconds: 10
        timeoutSeconds: 2
        failureThreshold: 3
      livenessProbe:
        httpGet:
          path: /health/live
          port: http
        periodSeconds: 20
        timeoutSeconds: 2
        failureThreshold: 3
```

The resource request gives the scheduler a real signal about the capacity the Pod needs. The limit gives the container a ceiling, and teams choose those values from measurements rather than guesswork after the service has real traffic data. The probes separate slow startup, traffic readiness, and stuck-process restart behavior.

Configuration deserves the same care. ConfigMaps are useful for non-secret configuration such as feature flags, hostnames, and tuning values. Secrets are the Kubernetes object for sensitive values, though teams still need encryption at rest, restricted RBAC, and external secret management practices in serious production environments. A Pod spec should keep raw passwords out of plain YAML committed to a repository.

The last guidance is simple and important: use direct Pods for learning, diagnostics, and special cases, then use controllers for services. A direct Pod can teach the object clearly, but `devpolaris-orders-api` as a production API needs a Deployment so Kubernetes can keep replicas alive and roll out new templates deliberately.

## References

- [Kubernetes Workloads](https://kubernetes.io/docs/concepts/workloads/) - Official overview of workload resources and the controller pattern.
- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/) - Official definition of Pods, single-container Pods, multi-container Pods, and shared Pod context.
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) - Official details for Pod phases, container states, restart behavior, and Pod conditions.
- [Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Official task guide for configuring probes.
- [Debug Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/) - Official task guide for inspecting and troubleshooting Pods.
- [kubectl get](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/) - Official reference for listing Kubernetes resources.
- [kubectl describe](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_describe/) - Official reference for showing detailed resource state and events.
- [kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/) - Official reference for retrieving container logs from Pods.
