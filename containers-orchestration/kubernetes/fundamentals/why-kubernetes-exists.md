---
title: "What Is Kubernetes?"
description: "Understand what Kubernetes is and why teams use it for scheduling, self-healing, stable traffic, safe rollouts, and shared operations."
overview: "Kubernetes is an open source system for running containerized applications across a group of machines. It connects one familiar container to Pods, nodes, clusters, the control plane, desired state, traffic, releases, and operations."
tags: ["kubernetes", "containers", "orchestration", "operations"]
order: 1
id: article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists
---
## Table of Contents

1. [What Is Kubernetes?](#what-is-kubernetes)
2. [From One Container To Many](#from-one-container-to-many)
3. [The Production Problem](#the-production-problem)
4. [The Kubernetes Hierarchy](#the-kubernetes-hierarchy)
5. [Desired State In One Example](#desired-state-in-one-example)
6. [Traffic, Releases, And Recovery](#traffic-releases-and-recovery)
7. [What Kubernetes Is Good At](#what-kubernetes-is-good-at)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)
10. [References](#references)

## What Is Kubernetes?
<!-- section-summary: Kubernetes is an open source system for running containerized applications across a group of machines. -->

**Kubernetes** is an open source system for running containerized applications across a group of machines. You tell Kubernetes what you want running, such as three copies of an API, one stable network name, and a health check. Kubernetes stores that request, chooses machines for the work, starts containers, watches health, replaces failed copies, and gives operators a standard way to inspect what happened.

The simple version is this: Kubernetes is the system teams use after containers are no longer just something they start by hand. A container packages an application so it can run consistently. Kubernetes coordinates many of those containerized application copies across many machines, especially after traffic, releases, failures, and team ownership start changing every day.

Picture a Customer Notification Platform. Other product systems call `notification-api` after a checkout, password reset, or billing event. The API records the request and a `notification-worker` sends the email or SMS message. On a laptop, one container can prove the app starts. In production, the team needs several API copies, several worker copies, safe releases, stable traffic, configuration, logs, and recovery after a machine fails.

That is the first reason Kubernetes exists. It gives the team one shared operating loop: declare what should run, let the cluster place and run it, send traffic to healthy copies, and inspect evidence through the same API.

## From One Container To Many
<!-- section-summary: A container packages one application process, while Kubernetes coordinates many running copies of those packages. -->

A **container** is a packaged application process with the files it needs to run. If you have used Docker before, this part is familiar. The image carries the app code, installed packages, runtime files, and startup command together. The same image can run on a laptop, in CI, in staging, and in production.

For a first local check, a developer might run the notification API with Docker:

```bash
docker run -d \
  --name notification-api \
  -p 3000:3000 \
  -e DATABASE_URL=postgres://notifications-db.internal:5432/app \
  ghcr.io/devpolaris/notification-api:1.4.2
```

The command has a few important parts:

- `--name notification-api` gives this local container a readable name.
- `-p 3000:3000` maps a port on the machine to a port inside the container.
- `-e DATABASE_URL=...` gives the process one runtime setting.
- `ghcr.io/devpolaris/notification-api:1.4.2` names the image and version to run.

This command is useful because it shows the raw ingredients: an image, a port, and configuration. It also shows the limit. The command starts one container on one machine. If that machine restarts, someone or some other system has to bring the container back. If the app needs six copies, someone has to decide where those copies should run. If version `1.4.3` has a bug, the team needs a controlled way to stop the rollout and return to the previous image.

Kubernetes starts where that single-container command stops. The container remains the application package. Kubernetes supplies the coordination around many running copies of that package.

## The Production Problem
<!-- section-summary: Production needs placement, scaling, recovery, stable traffic, safe releases, and shared evidence around many containers. -->

The Customer Notification Platform has a shape that many real systems share. The API accepts live HTTP requests from other product services. The worker processes background messages. Both pieces need a database connection, provider credentials, health checks, logs, metrics, and a release path from staging to production.

![Customer Notification Platform flow showing clients calling notification-api, notification-api writing to the database and queue, notification-worker processing jobs, and external email and SMS providers receiving delivery calls](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists/notification-platform-flow.png)

*The platform has live traffic, background work, durable state, and external providers, so the team needs more than one container command on one server.*

The first production questions are ordinary and practical:

| Production question | What the platform needs |
| --- | --- |
| Where should each copy run? | Machines with enough CPU, memory, network access, and storage access |
| How many copies should exist? | Enough API and worker replicas for traffic and background jobs |
| What happens after a crash? | A replacement should launch automatically after the failure |
| How does traffic find the API? | Callers need one stable address while individual copies change |
| How do releases stay controlled? | New versions need pacing, health checks, and rollback evidence |
| How do operators debug issues? | Status, logs, events, rollout history, and metrics need standard access |

Trying to solve those questions with SSH sessions and hand-written scripts gets fragile quickly. The team needs a system that remembers the desired application state and keeps checking whether the live machines match it. That system is Kubernetes.

## The Kubernetes Hierarchy
<!-- section-summary: Kubernetes organizes work through Pods, nodes, clusters, the control plane, and API objects. -->

Kubernetes has a few core words that make the rest of the roadmap easier. The words form a hierarchy from the smallest running unit to the whole environment.

A **Pod** is the smallest application unit Kubernetes places and runs. In the common case, one Pod wraps one application container, such as one running copy of `notification-api`. A Pod can also hold a small helper container that must share the same network and storage space with the main app.

A **node** is a machine that can run Pods. In cloud environments, a node is often a virtual machine. In private environments, it may be a physical server. A node supplies CPU, memory, local disk, and networking for the Pods assigned to it.

A **cluster** is the group of nodes managed together. The team talks to the cluster through the Kubernetes API instead of choosing every machine by hand. The cluster can run many applications, many namespaces, and many copies of the same application.

The **control plane** is the coordination layer for the cluster. It accepts requests, stores Kubernetes objects, chooses nodes for Pods, watches for missing or unhealthy work, and lets node agents report status. A helpful analogy is an operations desk: teams submit a request, the desk records it, assigns work to available machines, and keeps checking whether the work is actually happening.

The main vocabulary looks like this:

| Kubernetes word | Simple meaning | Notification platform example |
| --- | --- | --- |
| **Pod** | One scheduled application unit | One running copy of `notification-api` |
| **Node** | One machine that can run Pods | A worker machine with CPU and memory |
| **Cluster** | Nodes managed through one Kubernetes API | The production Kubernetes environment |
| **Control plane** | The coordination layer | Accepts changes, stores objects, schedules Pods, watches status |
| **Deployment** | Object that keeps replaceable Pods running | Maintains four API Pods |
| **Service** | Stable network name and port | Gives callers one `notification-api` address |
| **ConfigMap** | Ordinary runtime settings | Queue name, log level, provider mode |
| **Secret** | Sensitive runtime settings | Database URL or provider token |

Now the hierarchy is visible: Kubernetes stores objects in the control plane, the control plane coordinates nodes, nodes run Pods, and higher-level objects such as Deployments and Services keep the application usable.

## Desired State In One Example
<!-- section-summary: Desired state is the request Kubernetes stores, and reconciliation is the loop that keeps current state close to it. -->

The most important Kubernetes idea is **desired state**. Desired state means the condition you want Kubernetes to maintain. For the notification platform, desired state can say: keep four `notification-api` Pods running from image `1.4.2`, expose them through a Service, and send traffic only to Pods that pass a readiness check.

Here is a small Deployment skeleton. It is intentionally small because the first idea is the request, not every production field.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
spec:
  replicas: 4
  template:
    spec:
      containers:
        - name: notification-api
          image: ghcr.io/devpolaris/notification-api:1.4.2
```

The fields have separate jobs:

- `kind: Deployment` chooses the Kubernetes object that manages replaceable Pods and rollouts.
- `metadata.name: notification-api` gives the object a stable name for commands, logs, and review.
- `spec.replicas: 4` records the requested number of API copies.
- `image: ghcr.io/devpolaris/notification-api:1.4.2` records the application package new Pods should run.

After the Deployment is stored, controllers keep comparing the request with current reality. If production should have four API Pods and one node fails, current state may drop to three running Pods. The controller notices the gap and asks Kubernetes to create another Pod on a healthy node.

That repeated comparison is **reconciliation**. Kubernetes keeps the request in the API, checks what is actually running, and takes the next action that moves the cluster toward the request.

![Manifest to Pod flow showing kubectl sending a Deployment to the API server, etcd storing state, controllers creating Pods, the scheduler assigning nodes, kubelets starting containers, and status returning through the API](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists/manifest-to-pod-flow.png)

*The Deployment request enters through the API, then controllers, the scheduler, and kubelets cooperate to turn that request into running Pods.*

A simple status check shows the desired count beside the live result:

```bash
kubectl get deployment notification-api -n notifications-prod
```

```bash
NAME               READY   UP-TO-DATE   AVAILABLE   AGE
notification-api   4/4     4            4           18d
```

`READY 4/4` means four Pods are ready out of four requested Pods. `UP-TO-DATE 4` means the four Pods match the current Deployment template. `AVAILABLE 4` means Kubernetes considers four Pods available for use.

## Traffic, Releases, And Recovery
<!-- section-summary: Services, Deployments, readiness checks, rollout status, and events turn running Pods into an operable service. -->

Running Pods are only part of the platform. Other applications still need a stable way to call the API, releases need a safe pace, and operators need evidence during production issues.

A **Service** gives callers one stable name and port while Pods are replaced behind it. The Service selects Pods by labels and routes only to endpoints Kubernetes considers ready. For the notification platform, callers can use a Service name such as `notification-api.notifications-prod.svc.cluster.local` instead of chasing temporary Pod IPs.

A Service skeleton shows the first traffic idea:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: notification-api
spec:
  selector:
    app: notification-api
  ports:
    - port: 80
      targetPort: http
```

The important parts are:

- `metadata.name: notification-api` creates the stable Service name.
- `selector.app: notification-api` tells the Service which Pods sit behind the name.
- `port: 80` is the port callers use through the Service.
- `targetPort: http` points at the named container port inside each selected Pod.

Deployments also help releases. Updating the API image from `1.4.2` to `1.4.3` changes the Pod template. Kubernetes creates new Pods from the new template, waits for health checks, and removes old Pods according to the rollout strategy.

Operators can watch the release:

```bash
kubectl rollout status deployment/notification-api -n notifications-prod
```

```bash
deployment "notification-api" successfully rolled out
```

The command checks rollout progress through the Kubernetes API. Success means the Deployment completed its update according to its rules. A stalled rollout sends the team toward Pods, events, image pull errors, readiness failures, logs, and recent configuration changes.

This is where Kubernetes starts to feel practical. A node can fail, and the stored Deployment request gives the cluster a target to repair. A Pod can crash, and the replacement uses the same template. A release can stall, and rollout status gives the team a shared signal. A Service can keep the caller address stable while the running Pods change underneath it.

## What Kubernetes Is Good At
<!-- section-summary: Kubernetes helps most after teams need repeated container operations across machines, releases, traffic, and failures. -->

Kubernetes helps most after the application has crossed from "one container can run" to "this service must keep running." It is useful for teams that need several copies of a service, safe rollouts, standard recovery after failures, stable internal networking, environment-specific configuration, and shared operational commands.

It also adds real complexity. Teams have to learn manifests, API objects, labels, controllers, networking, storage, security, and cluster operations. A small script, a short-lived demo, or a single internal tool may not need that machinery. Kubernetes earns its keep after the operational work around containers needs a shared platform instead of handmade server steps.

For the notification platform, Kubernetes is useful because the application has live traffic, background work, health checks, configuration, releases, and several teams that need the same operating language. Product engineers, platform engineers, deployment automation, and production responders can all inspect the same objects and status.

## Putting It All Together
<!-- section-summary: Kubernetes turns repeated container operations into an API-driven loop: declare, schedule, run, route, observe, and repair. -->

The full picture now has a clear order. A container image packages the application. Kubernetes runs those images inside Pods. Nodes provide the machines. A cluster groups those nodes behind one API. The control plane stores the desired state and coordinates the work. Deployments keep replaceable Pods running. Services give callers a stable route. Controllers, the scheduler, and kubelets keep working toward the request.

For the Customer Notification Platform, this means the team can talk about one operating loop instead of a pile of separate server tasks. A release enters as a Deployment update. The cluster places new Pods, waits for readiness, keeps traffic on healthy copies, and records status for operators. After a node failure or Pod crash, the same loop gives Kubernetes a stored request to repair from.

![Kubernetes operating loop summary showing manifests, API server, controllers, scheduler, nodes, Services, rollout checks, and operations evidence around the Customer Notification Platform](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists/kubernetes-operating-loop-summary.png)

*Kubernetes turns repeated container operations into a shared loop: declare, schedule, run, route, observe, and repair.*

That is why Kubernetes exists. It gives teams a standard way to operate containers after the application needs more than a single process on a single machine.

## What's Next

You now have the first Kubernetes map: container, Pod, node, cluster, control plane, Deployment, Service, desired state, and reconciliation. The next article follows one application through the cluster so those words connect to the actual path from a stored request to running Pods.

## References

- [Kubernetes Overview](https://kubernetes.io/docs/concepts/overview/) - Official overview of Kubernetes as a framework for resilient distributed systems, scaling, failover, deployment patterns, service discovery, and load balancing.
- [Kubernetes Components](https://kubernetes.io/docs/concepts/overview/components/) - Official description of the control plane, worker nodes, API server, etcd, scheduler, controller manager, kubelet, and related components.
- [The Kubernetes API](https://kubernetes.io/docs/concepts/overview/kubernetes-api/) - Official explanation of the API server, API objects, `kubectl`, discovery, OpenAPI, and server-side validation.
- [Objects In Kubernetes](https://kubernetes.io/docs/concepts/overview/working-with-objects/) - Official explanation of Kubernetes objects, `spec`, `status`, and desired state.
- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/) - Official definition of Pods as the smallest deployable units of computing in Kubernetes.
- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official guide to Deployment behavior, rolling updates, rollout status, rollback, scaling, and Deployment spec fields.
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Official explanation of Services as stable network abstractions for one or more Pods.
- [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) - Official guide to storing non-confidential configuration and injecting it into Pods.
- [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Official guide to sensitive data, Secret usage, and security cautions.
- [Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Official examples for probes and how kubelet responds to probe results.
- [Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/) - Official guide to automatically adjusting workload replicas based on metrics.
