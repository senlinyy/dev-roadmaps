---
title: "Why Kubernetes Exists"
description: "Understand why teams add Kubernetes after containers: scheduling, self-healing, stable traffic, safe rollouts, and shared operations."
overview: "Kubernetes helps teams operate containerized applications across many machines. This article follows a Customer Notification Platform to explain clusters, Pods, Deployments, Services, the API, desired state, rollout safety, and daily operations."
tags: ["kubernetes", "containers", "orchestration", "operations"]
order: 1
id: article-containers-orchestration-kubernetes-fundamentals-why-kubernetes-exists
---

## Table of Contents

1. [The Production Problem After Containers](#the-production-problem-after-containers)
2. [The Platform We Are Running](#the-platform-we-are-running)
3. [What Kubernetes Is](#what-kubernetes-is)
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

Here is the path for this article. We start with one working container, then we add the real production work around it: where it runs, how many copies run, how traffic reaches it, how failures recover, and how teams deploy changes without turning every release into a late-night event.

The same Customer Notification Platform follows us the whole way. It has a `notification-api` that accepts customer requests, a `worker` that sends emails and SMS messages, a database dependency that stores notification records, normal traffic from users and internal services, and an operations team that owns rollout safety, debugging, and on-call response.

## The Production Problem After Containers
<!-- section-summary: A container packages the application, while production still needs placement, recovery, traffic routing, rollouts, and operations. -->

A **container image** is a packaged version of an application and the files it needs to run. If the `notification-api` image works on your laptop, the same image can run in CI, staging, and production with the same runtime files inside it. That solves a huge packaging problem, especially for teams that used to lose hours on missing libraries, different operating system packages, and "works on my machine" bugs.

The Customer Notification Platform now has real users. Marketing sends a campaign at 9:00 AM, customers update phone numbers in the web app, and internal billing code calls the API after each successful payment. The container image still matters because it answers the first question: "What should run?" Production adds a whole row of new questions.

| Production question | What the team needs for `notification-api` |
| --- | --- |
| Where should the container run? | A healthy server with enough CPU and memory |
| How many copies should run? | Usually several API copies and several worker copies |
| What happens after a crash? | A replacement should start without a human logging in |
| How does traffic find the right copy? | Callers need one stable address even while Pods change |
| How does the app receive config? | Database URL, queue name, and feature flags need a controlled path |
| How do releases stay safe? | New versions should roll out gradually and roll back quickly |
| How does on-call debug it? | Logs, events, status, and rollout history need standard commands |

A single `docker run` command can start the API on one server. This is the kind of command many teams use before they introduce orchestration.

```bash
docker run -d \
  --name notification-api \
  -p 3000:3000 \
  -e DATABASE_URL=postgres://notifications-db.internal:5432/app \
  ghcr.io/devpolaris/notification-api:1.4.2
```

That command gives the process a port and a database URL. It also leaves the team to decide which server owns the process, how to replace the process after a host failure, how to add more copies during a campaign spike, and how to shift traffic during a release. Many teams can script those pieces for one service, then the work grows once the platform has ten services, several environments, and several people deploying changes each week.

This is the point where container orchestration enters the conversation. **Container orchestration** means coordinating many containers across many machines so applications keep running as servers, traffic, releases, and failures change. Kubernetes is the most common orchestration system teams use for that job.

The container gave us a reliable package. The next question is what kind of application we are trying to operate with that package.

## The Platform We Are Running
<!-- section-summary: The shared scenario has an API, a worker, data dependencies, traffic pressure, releases, and on-call operations. -->

The Customer Notification Platform is a small production system with very normal requirements. The `notification-api` receives HTTP requests such as "send this receipt email" or "send this password reset SMS." The `worker` reads pending jobs from a queue, calls email and SMS providers, writes delivery status to the database, and retries failed messages with limits.

The database dependency matters because notification systems need durable state. A customer support agent may ask whether a message was sent. The product team may need delivery counts. The worker may need to avoid sending the same SMS twice. In many companies, that database is a managed PostgreSQL or MySQL service outside the Kubernetes cluster, while the API and worker run inside the cluster.

Here is a simple flow. It shows how the API, worker, database, queue, and external providers fit together.

```mermaid
flowchart LR
    Client[Customer or internal service] --> Api[notification-api]
    Api --> Db[(notifications database)]
    Api --> Queue[notification queue]
    Worker[worker] --> Queue
    Worker --> Db
    Worker --> Provider[Email and SMS providers]
```

This platform has two different runtime shapes. The API handles live HTTP traffic, so it needs stable routing, readiness checks, and enough replicas to absorb spikes. The worker handles background work, so it needs safe restarts, enough parallelism to drain the queue, and a clean way to receive configuration for providers and database access.

The operations team cares about the boring details that decide whether the system survives a busy day. They want to see which version runs, whether the rollout finished, which Pods failed health checks, which node holds a noisy workload, and whether a rollback command can restore the last stable version. Kubernetes gives those teams a shared language and shared API for that work.

Those details give us enough context for the main definition. Now we can define Kubernetes with the scenario in mind.

## What Kubernetes Is
<!-- section-summary: Kubernetes is an API-driven control system for running containerized workloads across a cluster of machines. -->

**Kubernetes** is an open source system for running containerized workloads across a group of machines. The official overview describes Kubernetes as a framework for resilient distributed systems, including scaling, failover, deployment patterns, service discovery, and load balancing. In plain English, it gives the team one place to describe what should run and a set of background components that keep working toward that description.

A **cluster** is the group of machines Kubernetes manages together. A cluster has a **control plane**, which stores and coordinates the desired state, and **worker nodes**, which run the application containers. A node is usually a virtual machine or physical server with a container runtime, networking, and a local agent that talks to the control plane.

For the notification platform, the team sends Kubernetes a description with the API image, four replicas, container ports, health checks, and environment variables. Kubernetes chooses nodes, starts containers, watches health, and replaces missing pieces across the available nodes.

The important shift is that engineers interact with Kubernetes through an **API**. An API is a set of operations that software exposes so other software can ask for data or request changes. In Kubernetes, `kubectl`, deployment pipelines, GitOps controllers, dashboards, and custom tools all talk to the Kubernetes API server.

Here is a tiny preview of that API-driven workflow. The first command sends a file to Kubernetes, and the next two commands inspect the state Kubernetes reports back.

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

Here is a practical Deployment for the API. It is longer than a `docker run` command because it includes scale, labels, health checks, configuration references, and resource guidance.

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
            - containerPort: 3000
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
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3000
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

There is a lot in that file, so the important parts deserve names. `replicas: 4` asks Kubernetes for four API Pods. `selector.matchLabels` tells the Deployment which Pods belong to it. `template` describes the Pods the Deployment should create. The probes tell Kubernetes how to check whether the app can receive traffic and whether the container should keep running.

The worker uses the same idea with a different runtime shape. It runs background jobs, so it receives provider settings and has different resource requests.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-worker
  labels:
    app: notification-worker
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
          envFrom:
            - configMapRef:
                name: notification-settings
            - secretRef:
                name: notification-provider-secrets
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2"
              memory: "1Gi"
```

The API and worker both use Deployment because the team wants Kubernetes to keep a target number of Pods running and handle replacement. Later in the roadmap, you will meet other workload objects such as StatefulSet, Job, and CronJob. For this first article, Deployment gives us enough to understand why Kubernetes exists.

Objects give us a vocabulary. The next step is seeing which cluster components receive those objects and turn them into running containers.

## The Cluster Pieces Behind the API
<!-- section-summary: The API server, etcd, scheduler, controllers, kubelet, and container runtime cooperate to turn manifests into running Pods. -->

The official components documentation describes a cluster as a control plane plus one or more worker nodes. The **control plane** manages overall cluster state. The **worker nodes** run the containers that make up your applications.

The **API server** is the HTTP front door for Kubernetes. When you run `kubectl apply`, your command reaches the API server. The API server authenticates the request, validates the object, runs admission checks, and stores the accepted object.

The accepted state lives in **etcd**, a consistent key-value database used by Kubernetes for API server data. Application teams rarely talk to etcd directly. They talk to the API server, and the control plane uses etcd as the source of stored cluster state.

The **scheduler** watches for Pods that exist in the API without a node assigned. It chooses a suitable node based on requested CPU, requested memory, constraints, taints, tolerations, and other scheduling rules. In our API Deployment, the scheduler sees each pending API Pod and selects a node that can run it.

The **controller manager** runs controllers. A controller is a background loop that watches objects and takes action when the current state differs from the requested state. The Deployment controller creates ReplicaSets, ReplicaSets create Pods, and other controllers handle nodes, endpoints, jobs, and more.

Each worker node runs a **kubelet**. The kubelet is the node agent that receives Pod assignments, asks the container runtime to start containers, runs probes, reports status, and restarts containers when the Pod policy calls for it. The container runtime, such as containerd, does the lower-level job of pulling images and running containers.

Here is the flow for the notification API. The diagram follows one Deployment apply request from the engineer to running containers.

```mermaid
sequenceDiagram
    participant Engineer
    participant API as API server
    participant Store as etcd
    participant Controller as Deployment controller
    participant Scheduler
    participant Kubelet
    participant Runtime as container runtime

    Engineer->>API: apply Deployment manifest
    API->>Store: store desired object
    Controller->>API: create ReplicaSet and Pods
    Scheduler->>API: assign Pods to nodes
    Kubelet->>API: watch assigned Pods
    Kubelet->>Runtime: pull image and start containers
    Kubelet->>API: report Pod status
```

This flow matters during incidents. If Pods stay Pending, the scheduler may lack a suitable node or resources. If Pods receive nodes and containers fail, the kubelet events usually explain image pulls, missing Secrets, failed probes, or crashes. If the API server accepts the Deployment and no Pods appear, a controller path needs attention.

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

The API server ties the system together. Engineers, automation, and controllers all use the Kubernetes API to create, read, update, and watch objects. Objects carry desired state in `spec` and observed state in `status`, which gives both humans and software a shared way to understand the system.

The production value is consistency. The same commands and object ideas show up when the team scales traffic, debugs a readiness failure, checks rollout progress, inspects a Service, or updates a worker image. Kubernetes gives the team a shared control plane for work that otherwise spreads across scripts, SSH sessions, load balancers, process managers, and handwritten runbooks.

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
