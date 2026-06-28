---
title: "Pods"
description: "Run containers as Kubernetes Pods, inspect their lifecycle, and diagnose Pod readiness failures."
overview: "Pods are the smallest deployable compute object in Kubernetes. This article shows how a Pod wraps the containers for `notification-api`, how Kubernetes reports Pod state, and how to debug the first failures you will meet."
tags: ["pods", "containers", "kubectl", "probes"]
order: 1
id: article-containers-orchestration-kubernetes-workloads-pods
---

## Table of Contents

1. [One Container Needs a Kubernetes Wrapper](#one-container-needs-a-kubernetes-wrapper)
2. [What the Pod Adds](#what-the-pod-adds)
3. [Start with the Smallest Useful Pod Shape](#start-with-the-smallest-useful-pod-shape)
4. [Metadata and Labels](#metadata-and-labels)
5. [The Container Block](#the-container-block)
6. [Configuration, Ports, and Volumes](#configuration-ports-and-volumes)
7. [Readiness, Liveness, and Startup Probes](#readiness-liveness-and-startup-probes)
8. [Multi-Container Pods](#multi-container-pods)
9. [Pod Lifecycle and Pod State](#pod-lifecycle-and-pod-state)
10. [Inspecting a Healthy Pod](#inspecting-a-healthy-pod)
11. [Debugging Common Pod Failures](#debugging-common-pod-failures)
12. [Production Pod Guidance](#production-pod-guidance)

## One Container Needs a Kubernetes Wrapper
<!-- section-summary: A container image gives Kubernetes the application bits, and a Pod gives Kubernetes the object it can schedule, run, inspect, and replace through controllers. -->

Start with one familiar thing: a container image. The **Customer Notification Platform** has a `notification-api` image called `ghcr.io/customer-notification/notification-api:2026.06.14-1`. The image contains the application files and startup command for an API that receives requests such as "send this password reset email" or "send this delivery update by SMS."

On a laptop, a developer can run that image directly with a container runtime. In a Kubernetes cluster, the cluster needs a durable API object around that image. Kubernetes has to record the desired container, choose a worker machine, give the running process a network identity, attach configuration, run health checks, and report status back to `kubectl`.

That wrapper is a **Pod**. A Pod is the smallest Kubernetes workload object that can run containers. Even when the Pod has one container, the Pod gives Kubernetes the shape it can schedule and the status record operators can inspect.

Here is the set of ideas we will connect in this article:

| Concept | Plain meaning | Notification example |
|---|---|---|
| **Container image** | The packaged application file system and startup command | `ghcr.io/customer-notification/notification-api:2026.06.14-1` |
| **Pod** | The runnable Kubernetes wrapper around one or more containers | One API container, one Pod IP, labels, probes, and status |
| **Node** | A worker machine where Pods run | The Pod may land on `worker-a` or another schedulable node |
| **Kubelet** | The node agent that starts containers and reports Pod status | It pulls the image, starts the API process, runs probes, and reports events |
| **Controller** | A higher-level object that keeps Pods replaced and updated | A Deployment usually creates the notification API Pods in production |

This chain gives you a debugging path. A failing Pod may be waiting for a node, waiting for an image pull, running while still unready for traffic, or restarting after the process exits. Each state points to a different next command.

## What the Pod Adds
<!-- section-summary: A Pod wraps containers with shared runtime settings, a network identity, labels, probes, volumes, and one Kubernetes status record. -->

A **Pod** can contain one container or a small group of tightly connected containers, and Kubernetes treats that group as one scheduled unit. The containers in one Pod share the same placement decision, network identity, and any volumes that the Pod defines.

For `notification-api`, the common shape is one container in one Pod. The API process listens on port `8080`, Kubernetes gives the Pod an internal IP, and the Pod status tells the team whether the container has started, restarted, or become ready for traffic. Even though one container runs inside it, the Pod remains the object that Kubernetes schedules and reports.

The Pod wrapper gives Kubernetes a place to store runtime details around the container. **Labels** help Services and controllers find the Pod. **Environment variables** provide configuration. **Volumes** mount files into containers. **Probes** tell Kubernetes whether the application can receive traffic or needs a restart. **Restart policy** tells the node what to do when the process exits.

The production lesson is that Pod state and container state are related but separate signals. A container can be running while the Pod stays unready. A Pod can be scheduled while the image still fails to pull. A Pod can show `CrashLoopBackOff` while Kubernetes keeps retrying the same container because the restart policy allows it.

![Pod runtime wrapper infographic showing a manifest becoming a Pod with a notification-api container, Pod IP, labels, probes, volumes, worker node placement, and Pod status](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-pods/pod-runtime-wrapper.png)

_This infographic shows the Pod as the Kubernetes wrapper around the container, where runtime details such as labels, probes, volumes, network identity, and status travel with the workload._

## Start with the Smallest Useful Pod Shape
<!-- section-summary: A useful first Pod manifest only needs identity, one container, and an image; the rest of the production details can be layered in after that shape is clear. -->

A **Pod manifest** is a YAML document that describes the Pod Kubernetes should create. The API server stores that document as desired state, the scheduler chooses a node, and the kubelet on that node starts the container through the configured container runtime.

Start with the smallest shape that still teaches the structure:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: notification-api
spec:
  containers:
    - name: api
      image: ghcr.io/customer-notification/notification-api:2026.06.14-1
```

The first two lines tell Kubernetes which API and object type you are creating. `metadata.name` gives the Pod a name in its namespace. `spec.containers` lists the containers that should run together inside the Pod. For this first example, one container is enough.

You can apply this file and watch the object move through the API:

```bash
$ kubectl apply -f notification-api-pod.yaml
pod/notification-api created

$ kubectl get pod notification-api
NAME               READY   STATUS    RESTARTS   AGE
notification-api   1/1     Running   0          18s
```

`READY` shows how many containers are ready out of the total containers in the Pod. `STATUS` is the current high-level Pod phase or waiting reason. `RESTARTS` counts container restarts. `AGE` tells you how long this Pod object has existed.

This Pod teaches the basic shape. Production use adds labels for routing, a named port, configuration references, resource settings, and health probes. We will add those pieces one at a time.

## Metadata and Labels
<!-- section-summary: Metadata identifies the Pod, and labels give Services, controllers, dashboards, and commands a stable way to find it. -->

**Metadata** is the descriptive information around a Kubernetes object. The name, namespace, labels, and annotations all live under `metadata`. The name identifies one object. Labels group objects so other Kubernetes resources and human commands can select them.

For the notification API, labels should answer ordinary operating questions. Which application is this? Which component is it? Which larger platform owns it? Which environment does it belong to?

```yaml
metadata:
  name: notification-api
  namespace: notifications
  labels:
    app.kubernetes.io/name: notification-api
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: customer-notification-platform
    app.kubernetes.io/environment: training
```

These labels are not decoration. A Service can select `app.kubernetes.io/name: notification-api` and send traffic to matching Pods. A Deployment can use the same identity in its Pod template. A dashboard can group restart counts by component. A command can list only API Pods:

```bash
$ kubectl get pods -n notifications -l app.kubernetes.io/name=notification-api
NAME               READY   STATUS    RESTARTS   AGE
notification-api   1/1     Running   0          1m
```

A common beginner mistake is to treat labels like free-form notes. In production, labels become an ownership and routing contract. If the Service selects one label and the Pod uses another, the Pod may run perfectly while no traffic reaches it.

## The Container Block
<!-- section-summary: The container block describes the process Kubernetes should start inside the Pod, including the image, exposed ports, and optional command details. -->

A **container block** describes one container inside the Pod. At minimum it needs a name and image. Real application Pods usually add named ports, environment variables, resource settings, and probes in the same area.

Here is the container block with a named HTTP port:

```yaml
spec:
  containers:
    - name: api
      image: ghcr.io/customer-notification/notification-api:2026.06.14-1
      ports:
        - name: http
          containerPort: 8080
```

The `name: api` value is the container name, not the Pod name. It helps when a Pod has more than one container or when you ask for logs from a specific container. The `image` value points to the release artifact. The named port lets probes and Services refer to `http` instead of repeating the number everywhere.

For a production release, use a tag or digest that points to a specific build. A broad tag such as `latest` makes incidents harder because the same manifest may pull different content later. A precise tag such as `2026.06.14-1` or an image digest gives the team a concrete release identity.

You can confirm the image Kubernetes sees:

```bash
$ kubectl get pod notification-api -n notifications \
  -o jsonpath='{.spec.containers[0].image}{"\n"}'
ghcr.io/customer-notification/notification-api:2026.06.14-1
```

That small command is handy during release review. It checks the live object rather than trusting the file you meant to apply.

## Configuration, Ports, and Volumes
<!-- section-summary: Configuration and volumes connect the container to its runtime environment without baking every setting into the image. -->

**Configuration** is the runtime input that changes between environments without changing the application image. For `notification-api`, configuration may include the message queue topic, provider endpoint, feature flags, and database connection settings. Non-secret values usually live in a ConfigMap. Sensitive values usually live in a Secret, with stronger secret management and RBAC around production clusters.

The Pod can load those objects with `envFrom`:

```yaml
spec:
  containers:
    - name: api
      envFrom:
        - configMapRef:
            name: notification-api-config
        - secretRef:
            name: notification-api-secrets
```

This tells Kubernetes to expose keys from those objects as environment variables inside the container. For example, a ConfigMap might set `NOTIFICATION_EVENT_TOPIC=notifications.requests.v1`, while a Secret might provide the database password.

A **volume** gives a Pod a mounted file system path. Some volumes point to Kubernetes objects such as ConfigMaps and Secrets. Some point to storage. Some are temporary and disappear with the Pod. For this API, a small ConfigMap-backed file can hold provider routing rules:

```yaml
spec:
  volumes:
    - name: provider-routes
      configMap:
        name: notification-provider-routes
  containers:
    - name: api
      volumeMounts:
        - name: provider-routes
          mountPath: /app/config/providers
          readOnly: true
```

The `volumes` entry defines what exists at the Pod level. The `volumeMounts` entry attaches that volume to a specific container. The names must match exactly. If they do not, the Pod will not start, and `kubectl describe pod` will show the validation or mount error.

## Readiness, Liveness, and Startup Probes
<!-- section-summary: Probes let Kubernetes separate slow startup, traffic readiness, and stuck-process recovery. -->

A **readiness probe** asks whether the container should receive traffic. For `notification-api`, readiness should check that the process can accept requests and reach the dependencies needed for ordinary notification work, such as the database and queue configuration.

```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: http
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

A **liveness probe** asks whether Kubernetes should restart the container. It should detect a stuck process, not punish every temporary dependency outage. If the email provider is down, restarting every API Pod will not repair the provider and may make the incident noisier.

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: http
  periodSeconds: 20
  timeoutSeconds: 2
  failureThreshold: 3
```

A **startup probe** gives a slow-starting container time before liveness begins. This helps applications that load templates, warm caches, or run startup checks before they can answer liveness reliably.

```yaml
startupProbe:
  httpGet:
    path: /health/startup
    port: http
  periodSeconds: 5
  failureThreshold: 24
```

With this setup, Kubernetes can make three different decisions. The startup probe protects boot time. The readiness probe protects traffic. The liveness probe restarts a stuck process. Those are separate jobs, and mixing them often creates avoidable outages.

## Multi-Container Pods
<!-- section-summary: Multi-container Pods are for tightly coupled helpers that must share the same network or storage context, not for unrelated application services. -->

A **multi-container Pod** runs more than one container as one scheduled unit. The containers share the Pod IP and any volumes the Pod defines. Kubernetes reports one Pod status with container-level details inside it.

For the Customer Notification Platform, the main API should not share a Pod with `notification-worker`. The API receives HTTP requests continuously. The worker reads queue messages and sends email, SMS, or push notifications in the background. They scale differently, fail differently, and deploy on different rhythms, so they should usually be separate Deployments.

A good multi-container example is a local helper that must sit beside the main container. Suppose the API writes structured audit events to a shared file, and a tiny sidecar forwards those events to a collector in the same network environment:

```yaml
spec:
  volumes:
    - name: audit-buffer
      emptyDir: {}
  containers:
    - name: api
      volumeMounts:
        - name: audit-buffer
          mountPath: /var/run/notification-audit
    - name: audit-forwarder
      image: ghcr.io/customer-notification/audit-forwarder:2026.06.14
      volumeMounts:
        - name: audit-buffer
          mountPath: /var/run/notification-audit
```

`emptyDir` is temporary storage created when the Pod starts and removed when the Pod goes away. Both containers mount the same volume, so the sidecar can read the files the API writes. This pattern fits only when the helper has a tight lifecycle relationship with the main container.

## Pod Lifecycle and Pod State
<!-- section-summary: Pod status, conditions, container states, events, and logs together show where startup or runtime failed. -->

The **Pod lifecycle** is the set of states a Pod moves through from creation to deletion. Kubernetes tracks a high-level Pod phase such as `Pending`, `Running`, `Succeeded`, or `Failed`, and it also tracks container states such as waiting, running, or terminated.

For `notification-api`, a normal path looks like this: Kubernetes accepts the Pod object, the scheduler picks a node, the kubelet pulls the image, the container starts, the startup probe succeeds, the readiness probe succeeds, and the Pod is ready for Service traffic.

The same path gives a troubleshooting map. `Pending` often points to scheduling, image pull, or volume mount work. `ImagePullBackOff` points to the image name, tag, registry credentials, or network path. `CrashLoopBackOff` means the container starts and exits repeatedly. `Running` with `READY 0/1` usually points to readiness failure.

![Pod lifecycle signals infographic showing accepted, scheduled, image pulled, container running, and ready states with Pending, ImagePullBackOff, CrashLoopBackOff, readiness, events, logs, and probes as troubleshooting clues](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-pods/pod-lifecycle-signals.png)

_This infographic turns Pod status into a debugging path, so each failure reason points toward scheduling, image pull, container startup, readiness, or evidence collection._

Kubernetes gives you several evidence sources:

| Evidence | What it answers | Example command |
|---|---|---|
| Pod list | Which phase or waiting reason is visible now? | `kubectl get pods -n notifications` |
| Describe output | What did the scheduler and kubelet report? | `kubectl describe pod notification-api -n notifications` |
| Events | What happened recently in the namespace? | `kubectl get events -n notifications --sort-by=.lastTimestamp` |
| Logs | What did the application print? | `kubectl logs notification-api -n notifications -c api` |
| Exec | What does the running container see? | `kubectl exec -n notifications notification-api -c api -- env` |

Read these in that order during beginner debugging. Start with Kubernetes evidence, then move into application logs, then use `exec` only when the container is actually running and you need to inspect inside it.

## Inspecting a Healthy Pod
<!-- section-summary: A healthy Pod inspection proves the object exists, the container is ready, events look normal, and the application responds through the expected health endpoint. -->

A healthy Pod should be easy to explain from the terminal. Start with the list view:

```bash
$ kubectl get pod notification-api -n notifications -o wide
NAME               READY   STATUS    RESTARTS   AGE   IP           NODE
notification-api   1/1     Running   0          4m    10.42.2.18   worker-a
```

This output says the Pod has one ready container out of one total container. It is running on `worker-a`, and its cluster-internal Pod IP is `10.42.2.18`.

`kubectl describe` adds events and container details:

```bash
$ kubectl describe pod notification-api -n notifications
Containers:
  api:
    Image:          ghcr.io/customer-notification/notification-api:2026.06.14-1
    Ready:          True
    Restart Count:  0
Conditions:
  Type              Status
  PodScheduled      True
  Ready             True
Events:
  Normal  Scheduled  Successfully assigned notifications/notification-api to worker-a
  Normal  Pulled     Container image already present on machine
  Normal  Started    Started container api
```

That output proves the scheduler placed the Pod, the image was available, the container started, and readiness passed. If a teammate asks whether Kubernetes started the release artifact you expected, this output answers that question.

Application logs should line up with the Kubernetes view:

```bash
$ kubectl logs notification-api -n notifications -c api --tail=5
2026-06-14T10:00:01Z service=notification-api version=2026.06.14-1 listening=:8080
2026-06-14T10:00:04Z readiness=ok queue=connected database=connected
```

The log line gives application-level evidence that the API is listening and its readiness dependencies are connected. Kubernetes readiness and application readiness should tell the same story.

## Debugging Common Pod Failures
<!-- section-summary: Pod failures become less confusing when you map each symptom to scheduling, image pull, container exit, readiness, or dependency evidence. -->

An **ImagePullBackOff** means Kubernetes could not pull the image. The container has not started yet, so application logs will not help. Start with `describe`:

```bash
$ kubectl describe pod notification-api -n notifications
Events:
  Warning  Failed   Failed to pull image "ghcr.io/customer-notification/notification-api:2026.06.14-9"
  Warning  Failed   Error: ImagePullBackOff
```

The next check is the image reference and registry access. A wrong tag, missing imagePullSecret, private registry problem, or network policy around egress can all create this symptom.

A **CrashLoopBackOff** means the container starts and exits repeatedly. Now application logs matter:

```bash
$ kubectl get pod notification-api -n notifications
NAME               READY   STATUS             RESTARTS   AGE
notification-api   0/1     CrashLoopBackOff   6          8m

$ kubectl logs notification-api -n notifications -c api --previous --tail=40
Error: NOTIFICATION_EVENT_TOPIC is required
```

The `--previous` flag reads logs from the last terminated container attempt. Without it, you may only see the new attempt that just started.

A Pod that is `Running` but not ready usually points to the readiness endpoint or one of the dependencies it checks:

```bash
$ kubectl describe pod notification-api -n notifications
Events:
  Warning  Unhealthy  Readiness probe failed: HTTP probe failed with statuscode: 503

$ kubectl logs notification-api -n notifications -c api --tail=20
readiness=fail reason="database connection timeout" database=notification-postgres
```

This output says Kubernetes reached the app, and the app deliberately reported an unready state. The next investigation goes to the database Service, database Pod, credentials, NetworkPolicy, or connection string. A probe path typo would look different, often as a `404` or connection refusal on the wrong port.

## Production Pod Guidance
<!-- section-summary: Production Pods need clear labels, resource requests, health probes, safe configuration handling, and controller ownership. -->

Production teams usually review Pod templates through the controller that creates them, often a Deployment. The Pod template still carries the details that decide how each replica behaves. Clear labels, resource requests, probes, configuration references, and security settings all live in or near that template.

After all the small pieces, the full direct Pod example looks like this:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: notification-api
  namespace: notifications
  labels:
    app.kubernetes.io/name: notification-api
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: customer-notification-platform
spec:
  containers:
    - name: api
      image: ghcr.io/customer-notification/notification-api:2026.06.14-1
      ports:
        - name: http
          containerPort: 8080
      envFrom:
        - configMapRef:
            name: notification-api-config
        - secretRef:
            name: notification-api-secrets
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

The resource request gives the scheduler a real signal about the capacity the Pod needs. The limit gives the container a ceiling, and teams choose those values from measurements rather than guesses after the service has real traffic data. The probes separate slow startup, traffic readiness, and stuck-process restart behavior.

Configuration deserves the same care. ConfigMaps are useful for non-secret configuration such as feature flags, hostnames, provider routing, and tuning values. Secrets hold sensitive values, though production teams still need encryption at rest, restricted RBAC, and external secret management practices. Raw passwords should not live in plain YAML committed to a repository.

Use direct Pods for learning, diagnostics, and special cases. Use controllers for services. `notification-api` as a production API needs a Deployment so Kubernetes can keep replicas alive, replace failed Pods, and roll out new templates deliberately.

![Production Pod checklist infographic showing Pod template labels, requests, probes, config, controller ownership, and the describe, events, logs, exec debugging path](/content-assets/articles/article-containers-orchestration-kubernetes-workloads-pods/production-pod-checklist.png)

_This infographic summarizes the production Pod review loop: build a clear Pod template, let a controller own it, then debug from Kubernetes evidence before jumping into the container._

**References**

- [Kubernetes Workloads](https://kubernetes.io/docs/concepts/workloads/) - Official overview of workload resources and the controller pattern.
- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/) - Official definition of Pods, single-container Pods, multi-container Pods, and shared Pod context.
- [Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) - Official details for Pod phases, container states, restart behavior, and Pod conditions.
- [Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Official task guide for configuring probes.
- [Debug Pods](https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/) - Official task guide for inspecting and troubleshooting Pods.
- [kubectl get](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/) - Official reference for listing Kubernetes resources.
- [kubectl describe](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_describe/) - Official reference for showing detailed resource state and events.
- [kubectl logs](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/) - Official reference for retrieving container logs from Pods.
