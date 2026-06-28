---
title: "Why Kubernetes Exists"
description: "Understand why teams add Kubernetes after containers: scheduling, self-healing, stable traffic, safe rollouts, and shared operations."
overview: "Kubernetes helps teams operate containerized applications across many machines. This article follows a Customer Notification Platform to explain clusters, Pods, Deployments, Services, the API, desired state, rollout safety, and daily operations."
tags: ["kubernetes", "containers", "orchestration", "operations"]
order: 1
id: article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists
---

## Table of Contents

1. [From One Container to Many](#from-one-container-to-many)
2. [The Small App We Will Keep Using](#the-small-app-we-will-keep-using)
3. [What Kubernetes Adds](#what-kubernetes-adds)
4. [The First Kubernetes Objects](#the-first-kubernetes-objects)
5. [The Cluster Pieces Behind the API](#the-cluster-pieces-behind-the-api)
6. [Desired State and Controllers](#desired-state-and-controllers)
7. [Scheduling and Self-Healing](#scheduling-and-self-healing)
8. [Stable Traffic with Services](#stable-traffic-with-services)
9. [Configuration, Secrets, and the Database Dependency](#configuration-secrets-and-the-database-dependency)
10. [Rollouts and Rollbacks](#rollouts-and-rollbacks)
11. [Day Two Operations](#day-two-operations)
12. [When Kubernetes Helps](#when-kubernetes-helps)
13. [Putting It All Together](#putting-it-all-together)
14. [What's Next](#whats-next)


## From One Container to Many
<!-- section-summary: A container packages one app process, while Kubernetes helps place and operate many running copies across machines. -->

A **container** is a packaged application process with the files it needs to run. For example, the `notification-api` container image can hold the Node.js app, its installed packages, and the command that starts the API. If that image runs on your laptop, the same image can run in CI, staging, and production with the same runtime files inside it.

One container on one machine is friendly enough. You can point at one server, start one process, read one log, and restart it when it crashes. A single `docker run` command can start the API on one server:

```bash
docker run -d \
  --name notification-api \
  -p 3000:3000 \
  -e DATABASE_URL=postgres://notifications-db.internal:5432/app \
  ghcr.io/devpolaris/notification-api:1.4.2
```

That command gives the process a port and a database URL. It also ties the work to the machine where the command ran. If that server restarts, someone or something must start the container again. If traffic grows, someone must choose more machines and start more copies. If the team releases a new image, someone must decide how old containers leave and new containers enter.

A **Pod** is the smallest application unit Kubernetes places and runs. In this article, one Pod usually wraps one `notification-api` container. A **node** is a machine that can run Pods. A **cluster** is a group of nodes managed together. A **control plane** is the coordination layer that accepts requests, stores the requested state, chooses where Pods should run, and keeps checking whether the cluster matches the request.

That gives us the first path through Kubernetes: one container needs a Pod, one Pod needs a node, many nodes form a cluster, and the cluster needs a control plane. The user-facing problem stays simple: the team wants the API running. The operating work grows once the team wants several copies, healthy replacement, stable traffic, safe release steps, and commands that show what happened.

| Beginner question | Kubernetes word that helps |
| --- | --- |
| What package should run? | Container image |
| What is one running application unit? | Pod |
| Where can that Pod use CPU and memory? | Node |
| What manages several nodes together? | Cluster |
| What accepts changes and coordinates the cluster? | Control plane |
| How many copies should keep running? | Desired state |
| How does a human or script talk to the cluster? | `kubectl` and the Kubernetes API |

This is the point where **container orchestration** enters the conversation. Container orchestration means coordinating many containers across many machines so the application keeps running while machines, traffic, releases, and failures change. Kubernetes is the most common orchestration system teams use for that job.

The container gave us a reliable package. The next step is a small application that needs more than one long-running container.

## The Small App We Will Keep Using
<!-- section-summary: The shared example has an API, a worker, a database, traffic, and releases, so every Kubernetes concept has a concrete job. -->

The Customer Notification Platform is a small application with two running pieces. The `notification-api` receives HTTP requests such as "send this receipt email" or "send this password reset SMS." The `worker` reads pending jobs from a queue, calls email and SMS providers, writes delivery status to the database, and retries failed messages with limits.

Notification systems need durable state. A customer support agent may ask whether a message was sent. The product team may need delivery counts. The worker may need to avoid sending the same SMS twice. In many companies, that durable state lives in a managed PostgreSQL or MySQL service outside the Kubernetes cluster, while the API and worker run inside the cluster.

Here is the application shape. The API accepts requests, the worker handles background delivery, and the database plus queue keep customer notification work durable while email and SMS providers sit outside the cluster.

![Customer Notification Platform flow showing clients calling notification-api, notification-api writing to the database and queue, notification-worker processing jobs, and external email and SMS providers receiving delivery calls](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists/notification-platform-flow.png)
*The platform has live HTTP traffic, background work, durable state, and external providers, so running one container on one server leaves too much operational work for humans.*

This application has two different runtime shapes. The API handles live HTTP traffic, so it needs stable routing, readiness checks, and enough replicas to absorb spikes. The worker handles background work, so it needs safe restarts, enough parallelism to drain the queue, and a clean way to receive configuration for providers and database access.

A normal day already creates practical questions. The team needs to know how many API Pods are running, which node holds each Pod, whether the worker has enough copies, which version is live, and whether the latest rollout finished. Those are the questions Kubernetes is designed to answer through standard objects and standard commands.

Those details give us enough context for the main definition. Now we can define Kubernetes with the scenario in mind.

## What Kubernetes Adds
<!-- section-summary: Kubernetes adds an API, objects, desired state, controllers, scheduling, traffic routing, and inspection commands around container images. -->

**Kubernetes** is an open source system for running containerized workloads across a group of machines. The official overview describes Kubernetes as a framework for resilient distributed systems, including scaling, failover, deployment patterns, service discovery, and load balancing. In plain English, it gives the team one place to describe what should run and a set of background components that keep working toward that description.

A **desired state** is the condition you ask Kubernetes to maintain. For example, the notification team can ask for four `notification-api` Pods and three `notification-worker` Pods. Kubernetes stores that request, creates Pods from it, places them on nodes, checks health, and replaces missing Pods when the current state no longer matches the request.

A **Kubernetes object** is a saved record in the Kubernetes API. A Deployment object can say "run four API Pods from this image." A Service object can say "give callers one stable name for the ready API Pods." A Secret object can hold the database connection value that Pods read at runtime.

The important shift is that engineers interact with Kubernetes through an **API**. An API is a set of operations that software exposes so other software can ask for data or request changes. In Kubernetes, `kubectl`, deployment pipelines, GitOps controllers, dashboards, and custom tools all talk to the Kubernetes API server.

Here is a tiny preview of that workflow. The first command sends a file to Kubernetes, and the next two commands inspect the state Kubernetes reports back.

```bash
kubectl apply -f notification-api-deployment.yaml
kubectl get deployments
kubectl get pods -l app=notification-api
```

The first command sends a manifest to the Kubernetes API. A **manifest** is a YAML or JSON file that describes a Kubernetes object. The next commands ask the API what Kubernetes recorded and what it currently sees running.

Once the API is the front door, the next piece is the objects we send through that front door. Those objects are the nouns Kubernetes stores, watches, and acts on.

## The First Kubernetes Objects
<!-- section-summary: Kubernetes objects are records of intent, and the first useful ones are Pods, Deployments, Services, ConfigMaps, and Secrets. -->

A **Kubernetes object** is a persistent record stored through the Kubernetes API. The official objects documentation explains that objects represent cluster state: which applications run, what resources they can use, and what policies guide behavior such as restarts, upgrades, and fault tolerance. A helpful way to say that in daily engineering language is: an object is the thing you ask Kubernetes to create and maintain.

Most Kubernetes objects have two important sides. The **spec** is what you ask for. The **status** is what Kubernetes reports back after controllers and nodes do work. For example, the spec may say the notification API should have four replicas, while the status may say three are available because one new Pod is still starting.

These are the first objects a beginner should know. Each one maps to a production job the notification platform needs.

| Object | Simple definition | How it appears in the notification platform |
| --- | --- | --- |
| **Pod** | The smallest deployable runtime unit Kubernetes manages | One running copy of `notification-api` or `worker` |
| **Deployment** | A controller-backed object for running and updating stateless Pods | Keeps four API Pods running and rolls out image updates |
| **Service** | A stable network endpoint for a changing set of Pods | Gives callers one name for the API even as Pods come and go |
| **ConfigMap** | Non-secret configuration stored as key-value data | Holds queue name, log level, and provider mode |
| **Secret** | Sensitive configuration such as passwords, tokens, and keys | Holds the database connection string or provider API token |

A **Pod** wraps one or more containers with shared networking and lifecycle. For the `notification-api`, one Pod usually contains one application container. That Pod gets its own IP address inside the cluster, its own container ports, and health checks that the node agent can run.

A **Deployment** manages Pods for stateless applications. Stateless means the running process can disappear and another copy can continue using external state such as a database, queue, or cache. The `notification-api` is a good Deployment workload because any healthy API Pod can handle the next request after it connects to the shared database and queue.

Start with the smallest useful Deployment shape. This first slice says "run four copies of this API image, and give the Pods a label that other Kubernetes objects can match."

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
spec:
  replicas: 4
  selector:
    matchLabels:
      app: notification-api
  template:
    metadata:
      labels:
        app: notification-api
    spec:
      containers:
        - name: notification-api
          image: ghcr.io/devpolaris/notification-api:1.4.2
```

The `replicas: 4` line gives the Deployment controller a target count. The `selector.matchLabels` field tells the Deployment which Pods belong to it. The `template` field gives Kubernetes the blueprint for each Pod it creates.

The next small piece is the port. The API listens on port `3000` inside the container, so Kubernetes needs that name and number before Services and probes can refer to it clearly.

```yaml
ports:
  - name: http
    containerPort: 3000
```

Configuration comes next. The API should not bake the database URL or queue name into the container image. A **Secret** can hold sensitive values such as database credentials, and a **ConfigMap** can hold ordinary settings such as queue names or feature flags.

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: notification-db
        key: url
  - name: QUEUE_NAME
    valueFrom:
      configMapKeyRef:
        name: notification-settings
        key: queueName
```

Health checks add the part that protects traffic. A **readiness probe** says whether the API should receive requests. A **liveness probe** says whether the container is stuck badly enough that the kubelet should restart it.

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: http
  initialDelaySeconds: 5
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /healthz
    port: http
  initialDelaySeconds: 15
  periodSeconds: 20
```

Resource settings give the scheduler a realistic placement signal. `250m` means a quarter of one CPU core. `256Mi` means 256 mebibytes of memory. The scheduler uses requests to decide where the Pod can fit, while limits cap how much the container can use at runtime.

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
  limits:
    cpu: "1"
    memory: "512Mi"
```

The worker uses the same Deployment idea with a different runtime shape. It does not receive live HTTP traffic, so its first questions are queue throughput, retry behavior, provider credentials, and database connection pressure. The worker might start with three replicas and larger resource requests because message rendering and provider calls can use more CPU and memory than a simple API request.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-worker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notification-worker
  template:
    metadata:
      labels:
        app: notification-worker
    spec:
      containers:
        - name: worker
          image: ghcr.io/devpolaris/notification-worker:1.4.2
```

The API and worker both use Deployment because the team wants Kubernetes to keep a target number of Pods running and handle replacement. Later in the roadmap, you will meet other workload objects such as StatefulSet, Job, and CronJob. For this first article, Deployment gives us enough to understand why Kubernetes exists.

A full API manifest belongs after those pieces have names. Near the end of this article, we will put the Deployment, Service, configuration, health, and resources together so the complete file reads like assembled parts instead of a surprise block of YAML.

Objects give us a vocabulary. The next step is seeing which cluster components receive those objects and turn them into running containers.

## The Cluster Pieces Behind the API
<!-- section-summary: The API server, etcd, scheduler, controllers, kubelet, and container runtime cooperate to turn manifests into running Pods. -->

The official components documentation describes a cluster as a control plane plus one or more worker nodes. The **control plane** manages overall cluster state. The **worker nodes** run the containers that make up your applications.

The **API server** is the HTTP front door for Kubernetes. When you run `kubectl apply`, your command reaches the API server. The API server authenticates the request, validates the object, runs admission checks, and stores the accepted object.

The accepted state lives in **etcd**, a consistent key-value database used by Kubernetes for API server data. Application teams rarely talk to etcd directly. They talk to the API server, and the control plane uses etcd as the source of stored cluster state.

The **scheduler** watches for Pods that exist in the API without a node assigned. It chooses a suitable node based on requested CPU, requested memory, constraints, taints, tolerations, and other scheduling rules. In our API Deployment, the scheduler sees each pending API Pod and selects a node that can run it.

The **controller manager** runs controllers. A controller is a background loop that watches objects and takes action when the current state differs from the requested state. The Deployment controller creates ReplicaSets, ReplicaSets create Pods, and other controllers handle nodes, endpoints, jobs, and more.

Each worker node runs a **kubelet**. The kubelet is the node agent that receives Pod assignments, asks the container runtime to start containers, runs probes, reports status, and restarts containers when the Pod policy calls for it. The container runtime, such as containerd, does the lower-level job of pulling images and running containers.

Here is the flow for the notification API. The visual follows one Deployment apply request from the engineer to running containers.

![Manifest to Pod flow showing kubectl sending a Deployment to the API server, etcd storing state, controllers creating Pods, the scheduler assigning nodes, kubelets starting containers, and status returning through the API](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists/manifest-to-pod-flow.png)
*A Deployment request travels through several hand-offs before containers run, so troubleshooting works best when you know which component owns the next step.*

This flow is useful during incidents. If Pods stay Pending, the scheduler may lack a suitable node or resources. If Pods receive nodes and containers fail, the kubelet events usually explain image pulls, missing Secrets, failed probes, or crashes. If the API server accepts the Deployment and no Pods appear, a controller path needs attention.

That component flow gives us the machinery. Now we can talk about the central idea that ties those components together: desired state.

## Desired State and Controllers
<!-- section-summary: Desired state is the requested cluster state, and controllers keep moving actual state toward it. -->

**Desired state** means the state you ask Kubernetes to maintain. If the Deployment says `replicas: 4`, the desired state is four matching API Pods. If the Service says it selects Pods with `app: notification-api`, the desired state includes a stable network endpoint that points at those ready Pods.

**Actual state** means what the cluster currently has. Maybe only three API Pods are ready because the fourth Pod is still pulling the image. Maybe a node restarted and one worker Pod is gone. Maybe the newest API version failed its readiness probe and Kubernetes kept it out of traffic.

Controllers connect those two sides. A controller watches the API, notices the gap, and requests changes. The Deployment controller notices missing replicas. The ReplicaSet controller creates replacement Pods. The endpoints controller updates the network targets behind a Service when ready Pods change.

This loop is why Kubernetes is more than a YAML storage system. The YAML tells Kubernetes what the team wants, and controllers keep acting after the first create request. If a notification worker crashes at 2:00 AM, the control loop still runs while everyone is asleep.

You can see desired and actual state with normal commands. These commands are usually the first stop when a workload has fewer ready Pods than expected.

```bash
kubectl get deployment notification-api
kubectl describe deployment notification-api
kubectl get pods -l app=notification-api
```

Example output might look like this. The `READY` column compares available Pods with requested Pods.

```bash
NAME               READY   UP-TO-DATE   AVAILABLE   AGE
notification-api   4/4     4            4           18d
```

That `4/4` is a quick health clue. It tells the on-call engineer that the Deployment currently has the four ready replicas it asked for. If it shows `3/4`, the next command is usually `kubectl describe deployment notification-api` or `kubectl describe pod <pod-name>` so the team can see events and status details.

Desired state gives Kubernetes a target. The scheduler and node agents make that target real on specific machines.

## Scheduling and Self-Healing
<!-- section-summary: Scheduling picks nodes for Pods, and self-healing replaces failed Pods or restarts unhealthy containers. -->

**Scheduling** means choosing where a Pod should run. Kubernetes does that through the scheduler, using information from the Pod spec and the cluster. The scheduler evaluates requested CPU and memory, available node capacity, node labels, affinity rules, taints, tolerations, and several other constraints.

For the API Deployment, resource requests are important because they tell Kubernetes what each Pod needs as a baseline. `cpu: "250m"` means one quarter of a CPU core. `memory: "256Mi"` means 256 mebibytes of memory. Kubernetes uses requests during scheduling to avoid placing more promised work on a node than it can reasonably run.

The notification worker asks for more CPU and memory because message rendering, provider calls, and retries can use more resources. In a real production cluster, the team watches usage over time and adjusts requests based on observed behavior. Many teams start with conservative requests, collect metrics, and then tune them so Pods schedule reliably without wasting node capacity.

**Self-healing** means Kubernetes keeps trying to restore the requested runtime shape after failures. If one API Pod exits, the owning ReplicaSet creates another Pod. If a node disappears, the control plane marks the node unhealthy and replacement Pods can run elsewhere. If a liveness probe keeps failing, the kubelet restarts that container.

Health checks are where beginners often see Kubernetes doing real work. A **readiness probe** tells Kubernetes whether a Pod should receive traffic. A **liveness probe** tells the kubelet whether a container should restart. For `notification-api`, readiness might check that the app can accept requests and reach the database; liveness might check that the process event loop still responds.

Here is how the API probes work in practice. The readiness check protects traffic, and the liveness check protects the running process.

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /healthz
    port: 3000
  initialDelaySeconds: 15
  periodSeconds: 20
```

If `/readyz` fails because the API loses database connectivity, Kubernetes keeps that Pod out of Service traffic. The Pod can keep running while the database connection recovers. If `/healthz` fails repeatedly because the process is stuck, the kubelet restarts the container and reports events for the Pod.

During on-call, the basic debugging path is direct. These commands move from broad Pod state to details, logs, and event history.

```bash
kubectl get pods -l app=notification-api
kubectl describe pod notification-api-7c9f6c9d8b-k2m5x
kubectl logs notification-api-7c9f6c9d8b-k2m5x
kubectl get events --sort-by=.lastTimestamp
```

Those commands answer different questions. `get pods` shows the broad state. `describe pod` shows scheduling decisions, probe failures, image pull errors, and other events. `logs` shows application output. `get events` gives a timeline of cluster-level activity that often explains what changed.

Scheduling and self-healing keep Pods alive. The next production question is how traffic reaches a set of Pods whose names and IP addresses keep changing.

## Stable Traffic with Services
<!-- section-summary: A Service gives callers a stable name and address while Kubernetes routes to the current ready Pods behind it. -->

A **Service** exposes a network application running in one or more Pods. The official Service documentation says a Service lets clients use a single endpoint even when the workload runs across multiple changing backends. That is exactly what the notification API needs.

Pods are temporary. A rollout creates new Pods. A crash creates replacement Pods. A node failure moves Pods. If every caller had to track Pod IPs directly, each release would break someone. A Service gives callers a stable name such as `notification-api.default.svc.cluster.local` while Kubernetes keeps the backend endpoint list updated.

Here is a Service for the API. It selects the API Pods by label and exposes them on a stable in-cluster port.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: notification-api
spec:
  selector:
    app: notification-api
  ports:
    - name: http
      port: 80
      targetPort: 3000
```

The selector connects the Service to Pods with `app: notification-api`. `port: 80` is the port clients use on the Service. `targetPort: 3000` is the port inside each selected Pod. The Service can stay stable while individual Pods come and go.

Inside the cluster, the worker could call the API through the Service name if it needed to. The Service name stays stable across rollouts.

```bash
curl http://notification-api.default.svc.cluster.local/healthz
```

For traffic from outside the cluster, teams usually put something in front of the Service. That might be a cloud load balancer, an Ingress controller, or the newer Gateway API. The exact entry point depends on the platform, and the Service still gives Kubernetes a stable internal target for the API Pods.

The on-call commands for traffic usually start with the Service and endpoints. They show whether the Service exists and which ready Pods sit behind it.

```bash
kubectl get service notification-api
kubectl get endpointslice -l kubernetes.io/service-name=notification-api
kubectl describe service notification-api
```

If users get connection errors while Pods are healthy, the Service selector may point at the wrong labels, the Pods may fail readiness, or the external entry point may be misconfigured. Kubernetes gives the team standard places to check and removes the need to inspect hand-built load balancer scripts first.

Traffic now has a stable route. The API still needs database and queue settings, so configuration comes next.

## Configuration, Secrets, and the Database Dependency
<!-- section-summary: ConfigMaps hold ordinary settings, Secrets hold sensitive values, and both feed Pods without rebuilding images for each environment. -->

**Configuration** means values that change between environments or releases without changing the application code. For the notification platform, configuration includes the queue name, log level, provider mode, database host, retry count, and feature flags. The container image should stay the same across staging and production while these values change around it.

A **ConfigMap** stores non-confidential key-value configuration. Kubernetes can pass ConfigMap values into containers as environment variables, command-line arguments, or mounted files. For the notification platform, a ConfigMap is a good place for ordinary settings such as queue name and log level.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: notification-settings
data:
  queueName: "customer-notifications"
  LOG_LEVEL: "info"
  PROVIDER_MODE: "live"
```

A **Secret** stores sensitive values such as passwords, tokens, or keys. Kubernetes can pass Secret values into Pods as environment variables or files. The official Secret documentation also warns that Secrets need careful handling because default storage depends on cluster configuration, RBAC, and encryption settings, so production teams usually combine Secrets with encryption at rest and a secret manager workflow.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: notification-db
type: Opaque
stringData:
  url: "postgres://notification_app:change-me@notifications-db.internal:5432/app"
```

This example is fine for learning because it shows the shape of the object. In production, teams usually avoid committing raw secret values to Git. They often use a cloud secret manager, External Secrets Operator, Sealed Secrets, SOPS, or a platform pipeline that creates the Kubernetes Secret from an approved secret source.

The API consumes both values like this. Kubernetes resolves the references when the kubelet starts the Pod.

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: notification-db
        key: url
  - name: QUEUE_NAME
    valueFrom:
      configMapKeyRef:
        name: notification-settings
        key: queueName
```

The database itself may run outside the cluster as a managed service. Kubernetes still helps the application side of that dependency: it injects the connection value, keeps unready API Pods out of traffic when the database check fails, restarts stuck containers, and gives operators one command surface for the app Pods that use the database.

The practical setup for a local learning cluster could use these commands. The order creates settings first, then starts the workloads that reference them.

```bash
kubectl apply -f notification-settings.yaml
kubectl apply -f notification-db-secret.yaml
kubectl apply -f notification-api-deployment.yaml
kubectl apply -f notification-worker-deployment.yaml
```

For a real deployment pipeline, the same idea usually appears as a reviewed manifest change. The pipeline applies ConfigMaps, Secrets or secret references, Deployments, and Services in a controlled order. The important part is that Kubernetes stores those objects through the API, then the kubelet uses them when it starts Pods.

The platform can now run with stable traffic and injected configuration. The next question is how the team changes versions without dropping customer requests.

## Rollouts and Rollbacks
<!-- section-summary: Deployments replace Pods gradually, report rollout status, and keep rollback history for fast recovery. -->

A **rollout** is the process of moving a workload from one version to another. For the notification API, a rollout might change the image from `1.4.2` to `1.4.3`. The team wants new Pods to join traffic only after they pass readiness, and they want old Pods to keep serving while the new version starts.

Deployments support this with rolling updates. In the earlier Deployment, `maxUnavailable: 1` means Kubernetes can take at most one old API Pod out of service during the update. `maxSurge: 1` means Kubernetes can create one extra Pod above the desired replica count while the rollout is in progress. With four replicas, this keeps capacity steady during normal releases.

One direct way to start a rollout is changing the image. This updates the Deployment's Pod template and starts a new Deployment revision.

```bash
kubectl set image deployment/notification-api \
  notification-api=ghcr.io/devpolaris/notification-api:1.4.3
```

Then the team watches the rollout. The status command reports whether the new Pods are replacing the old Pods successfully.

```bash
kubectl rollout status deployment/notification-api
kubectl get pods -l app=notification-api
```

If version `1.4.3` has a database timeout bug, the readiness probe may fail. Kubernetes then keeps those new Pods out of Service traffic, and the rollout may stall because the new Pods never become available. The old Pods continue handling traffic according to the rolling update limits, which gives the team time to inspect logs and make a decision.

The rollback command is intentionally simple. It asks the Deployment to return to the previous recorded revision.

```bash
kubectl rollout undo deployment/notification-api
kubectl rollout status deployment/notification-api
```

That restores the previous Deployment revision. Operators can also inspect rollout history, and the second command shows details for one revision.

```bash
kubectl rollout history deployment/notification-api
kubectl rollout history deployment/notification-api --revision=3
```

In production, many teams avoid typing `kubectl set image` by hand for normal releases. They commit a manifest change, use Helm or Kustomize to render environment-specific values, and let a CI/CD or GitOps system apply the change. Kubernetes still provides the rollout behavior underneath those tools.

Rollouts are one part of operations. After the application runs for weeks, the team needs steady daily commands for scale, debugging, and maintenance.

## Day Two Operations
<!-- section-summary: Kubernetes gives teams standard commands and objects for scaling, observing, debugging, and maintaining workloads after launch. -->

**Day two operations** means the work after the first successful deployment. It includes traffic spikes, failed Pods, noisy neighbors, slow rollouts, certificate rotations, database incidents, node upgrades, and on-call debugging. This is where Kubernetes often pays for its complexity because many operational tasks share the same API and object model.

Scaling the API manually is straightforward. The command changes the requested replica count for the Deployment.

```bash
kubectl scale deployment/notification-api --replicas=8
kubectl rollout status deployment/notification-api
```

That command updates the desired replica count. The Deployment controller and ReplicaSet controller create more Pods, the scheduler places them, the kubelets start them, and the Service adds ready Pods to its backend set. A campaign spike can receive more API capacity without changing the container image.

Automatic scaling uses a **HorizontalPodAutoscaler**, usually shortened to HPA. An HPA adjusts replica count based on metrics such as CPU utilization or custom metrics. For the notification API, CPU-based scaling might help during HTTP spikes. For the worker, a queue-depth metric often fits better because the goal is to drain pending messages fast enough.

Here is a simple HPA shape. It gives the API a minimum and maximum replica range and a CPU utilization target.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: notification-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: notification-api
  minReplicas: 4
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
```

Debugging also follows repeatable patterns. If the API returns errors, the team checks Pods, logs, events, rollout status, and Service endpoints. If the worker falls behind, the team checks worker replica count, queue metrics, provider errors, and database write latency.

```bash
kubectl get deployment notification-worker
kubectl get pods -l app=notification-worker
kubectl logs -l app=notification-worker --tail=100
kubectl describe deployment notification-worker
```

Real teams usually connect Kubernetes to observability tools. Metrics often flow into Prometheus or a managed metrics system. Logs often flow into a central log platform. Traces may use OpenTelemetry. Kubernetes supplies labels, object names, namespaces, and status that make those tools more useful.

Access control matters too. The team should use Kubernetes RBAC so application developers can inspect their namespace, deployment automation can apply approved objects, and only platform administrators can change cluster-level settings. That keeps daily operations productive while reducing the chance that a routine app release changes the whole cluster.

By this point, we have covered the main jobs Kubernetes handles. The next practical question is when the tool is worth the extra moving parts.

## When Kubernetes Helps
<!-- section-summary: Kubernetes helps most when many workloads, teams, releases, and operational requirements need one shared control plane. -->

Kubernetes helps when the operating problem is bigger than one container on one server. The Customer Notification Platform already has multiple runtime pieces, traffic-sensitive APIs, background workers, database dependencies, rollouts, health checks, and on-call needs. Add staging and production environments, several teams, and weekly releases, and a shared orchestration layer starts to make sense.

Kubernetes is especially useful when workloads need these patterns. The table connects each pattern to the notification platform's operating needs.

| Pattern | Why it matters |
| --- | --- |
| Many replicas | APIs need several copies for capacity and failure tolerance |
| Frequent rollouts | Teams need gradual updates, rollout status, and rollback |
| Stable service discovery | Callers need one stable name for changing Pods |
| Self-healing | Failed containers and lost nodes need automatic replacement |
| Shared operations | Teams need standard logs, events, status, labels, and access control |
| Platform growth | Many services need common deployment and runtime conventions |

Kubernetes also creates work. Someone must operate or pay for the cluster, choose networking and ingress components, configure observability, manage RBAC, handle upgrades, and set guardrails for resource usage. Managed Kubernetes services reduce some cluster maintenance, and application teams still need good manifests, probes, resource requests, rollout practices, and incident habits.

For a tiny internal app with one container, one developer, and low availability needs, a simpler platform may fit better. A virtual machine, a managed container service, or a platform-as-a-service can provide enough value with less setup. For a growing product with many services, many releases, and a need for consistent operations, Kubernetes gives the team a common foundation.

That tradeoff is the honest answer to why Kubernetes exists. Kubernetes exists because production container operations have repeated patterns, and teams wanted one API-driven system to handle those patterns across many machines and many applications.

## Putting It All Together
<!-- section-summary: Kubernetes takes a container image and surrounds it with scheduling, health, traffic, configuration, rollout, and operations workflows. -->

The whole article connects back to the notification platform. The team starts with two container images: `notification-api` and `notification-worker`. Containers solve packaging, so the same runtime artifact can move through local development, CI, staging, and production.

Kubernetes adds the operating layer around those images. A Deployment asks for four API Pods and three worker Pods. The scheduler places those Pods on healthy nodes. The kubelet starts containers and runs probes. Controllers replace missing Pods. A Service gives API callers a stable network endpoint. ConfigMaps and Secrets inject environment-specific settings. Rollout commands move from `1.4.2` to `1.4.3` and roll back when a release misbehaves.

Here is the full API Deployment after the pieces have been introduced. The file is long because it combines replica count, labels, the Pod template, container image, port, configuration references, health checks, and resource guidance in one object.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  labels:
    app: notification-api
spec:
  replicas: 4
  selector:
    matchLabels:
      app: notification-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  template:
    metadata:
      labels:
        app: notification-api
    spec:
      containers:
        - name: notification-api
          image: ghcr.io/devpolaris/notification-api:1.4.2
          ports:
            - name: http
              containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: notification-db
                  key: url
            - name: QUEUE_NAME
              valueFrom:
                configMapKeyRef:
                  name: notification-settings
                  key: queueName
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 15
            periodSeconds: 20
          resources:
            requests:
              cpu: "250m"
              memory: "256Mi"
            limits:
              cpu: "1"
              memory: "512Mi"
```

The API server ties the system together. Engineers, automation, and controllers all use the Kubernetes API to create, read, update, and watch objects. Objects carry desired state in `spec` and observed state in `status`, which gives both humans and software a shared way to understand the system.

The production value is consistency. The same commands and object ideas show up when the team scales traffic, debugs a readiness failure, checks rollout progress, inspects a Service, or updates a worker image. Kubernetes gives the team a shared control plane for work that otherwise spreads across scripts, SSH sessions, load balancers, process managers, and handwritten runbooks.

![Kubernetes operating loop summary showing manifests, API server, controllers, scheduler, nodes, Services, rollout checks, and operations evidence around the Customer Notification Platform](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists/kubernetes-operating-loop-summary.png)
*Kubernetes exists to turn repeated container operations into a shared API-driven loop: declare, schedule, run, route, observe, and repair.*

That is why Kubernetes exists. It takes the operational work around containers and gives teams a standard API, standard objects, and control loops that keep running after the first deploy command finishes.

## What's Next

You now know the problem Kubernetes solves and the first words you will keep seeing: **cluster**, **node**, **control plane**, **Pod**, **Deployment**, **Service**, **ConfigMap**, **Secret**, **desired state**, and **controller**. The next article can go deeper because these words now connect to one production story.

Next, we will follow one application through a Kubernetes cluster. We will connect the API objects, nodes, Pods, Deployments, Services, labels, and resource settings so the cluster stops looking like a pile of separate nouns.

---

**References**

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
