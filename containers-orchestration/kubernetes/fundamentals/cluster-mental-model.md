---
title: "How a Kubernetes Cluster Runs an App"
description: "Follow one notification platform through Kubernetes objects, Pods, Services, labels, rollouts, and capacity."
overview: "This article follows a Customer Notification Platform through a Kubernetes cluster so you can see how the API, nodes, Pods, Deployments, Services, labels, and resources work together."
tags: ["kubernetes", "cluster", "pods", "services"]
order: 2
id: article-containers-orchestration-kubernetes-fundamentals-cluster-mental-model
---

## Table of Contents

1. [From One Container to a Cluster](#from-one-container-to-a-cluster)
2. [API Objects](#api-objects)
3. [Nodes](#nodes)
4. [Pods](#pods)
5. [Deployments](#deployments)
6. [Labels and Selectors](#labels-and-selectors)
7. [Services](#services)
8. [Resource Requests and Limits](#resource-requests-and-limits)
9. [Following One Notification](#following-one-notification)
10. [Operations Checks](#operations-checks)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## From One Container to a Cluster
<!-- section-summary: One container leads to one Pod, one node, and then a group of nodes managed as a cluster. -->

A **container** is a packaged application process with the files it needs to run. For example, the `notification-api` container image can hold the API code, its dependencies, and the start command. One container on one laptop or one server is easy to point at: you know where it runs, how to read its logs, and which process to restart.

A **Pod** is the smallest runtime unit Kubernetes schedules. In the Customer Notification Platform, one `notification-api` Pod usually wraps one `notification-api` container. Kubernetes gives that Pod a cluster IP address, tracks its health, and treats it as one replaceable running copy of the API.

A **node** is a machine that can run Pods. A node might be a cloud virtual machine or a physical server. If the API needs six running copies, Kubernetes needs enough node CPU and memory to place those Pods without piling every important process onto one tired machine.

A **Kubernetes cluster** is a group of nodes managed under one shared API. The cluster has a **control plane**, which receives requests and stores cluster records, and **worker nodes**, which provide the CPU, memory, network, and disk where Pods actually run.

We are going to use one application all the way through: a Customer Notification Platform. The platform has `notification-api`, which receives HTTP requests from the product, and `worker`, which sends email or SMS messages after the request has been accepted. Both workloads depend on a database that stores customer preferences, delivery attempts, and notification status.

The concepts connect in this order. We will keep coming back to the same platform so the names stay familiar.

| Concept | Simple definition | Question it answers for the platform |
| --- | --- | --- |
| **Container** | A packaged application process | What application package should run? |
| **Pod** | One scheduled runtime unit | What is one running copy of the API or worker? |
| **Node** | A machine in the cluster | Where can a Pod use real CPU and memory? |
| **Cluster** | Nodes managed through one API | How do several machines act like one application platform? |
| **Control plane** | The coordination layer for the cluster | Who accepts requests and keeps cluster records? |
| **API object** | A saved record that describes something Kubernetes should manage | What did we ask the cluster to run? |
| **Deployment** | A controller for replaceable Pods | How many copies should run, and how should rollouts happen? |
| **Service** | A stable network endpoint for matching Pods | How does traffic reach Pods that keep changing? |

This path gives us a practical way to read Kubernetes. We start with the running package, follow it into a Pod, place the Pod on a node, group nodes into a cluster, and then use API objects to describe the state the cluster should maintain.

![Kubernetes cluster object map showing the API object, Deployment, ReplicaSet, Pods, nodes, labels, Service, and resource settings for notification-api](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-cluster-mental-model/cluster-object-map.png)
*Each object has one job in the same application: store the request, create Pods, place them on nodes, route traffic, and reserve capacity.*

## API Objects
<!-- section-summary: Kubernetes stores cluster intent as API objects, and kubectl is one common way to create and inspect those records. -->

An **API object** is a saved record in Kubernetes that describes part of the cluster state. For example, a Deployment object can say that the cluster should run three copies of `notification-api`, and a Service object can say that clients should reach those copies through one stable name.

The cluster needs those records because a human cannot log in to every node and keep the whole platform straight by hand. The team writes the desired state once, sends it to the API server, and lets controllers, the scheduler, and kubelets work from that stored request.

Every normal Kubernetes action goes through the Kubernetes API server. When you use `kubectl`, a CI pipeline, Helm, Argo CD, or a custom operator, that tool sends API requests to create, update, read, or delete objects. The API server stores those objects, and the rest of the system reacts to them.

Most Kubernetes objects have a few fields you will see again and again. These fields are the basic shape of the records stored in the API.

| Field | Meaning | Example |
| --- | --- | --- |
| `apiVersion` | The API group and version for this object | `apps/v1` |
| `kind` | The object type | `Deployment` |
| `metadata` | Name, namespace, labels, and other identifying data | `name: notification-api` |
| `spec` | The desired configuration you send to Kubernetes | `replicas: 3` |
| `status` | The current state reported by Kubernetes | `availableReplicas: 3` |

The `spec` field is the part your team usually writes. It describes the desired state, such as three API replicas. The `status` field is the part Kubernetes updates after controllers, schedulers, and node agents have done work, such as how many Pods are available right now.

A small object file for the API Deployment might start like this. The file describes the app by name, says it belongs in the `notifications-prod` namespace, and asks Kubernetes for three running copies.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications-prod
  labels:
    app: notification-api
    component: api
spec:
  replicas: 3
```

A CI job or an engineer's terminal usually sends that file to the API with a command like this. The command is small, but behind it Kubernetes receives an HTTP request and updates the stored object.

```bash
kubectl apply -f notification-api.yaml
```

Inspection uses the same API path in the other direction. This command asks the API server for the current Deployment record, including fields Kubernetes has added.

```bash
kubectl get deployment notification-api -n notifications-prod -o yaml
```

At this point, we have a saved record of what the team wants. The next question is where the Pods get actual compute capacity, because runtime work happens on nodes, inside containers wrapped by Pods.

## Nodes
<!-- section-summary: Nodes are the machines that provide runtime capacity, and each node runs agents that connect it back to the control plane. -->

A **node** is one machine that belongs to the cluster. In production it is often a virtual machine from a cloud provider, and in a private environment it might be a physical server. The node supplies the CPU, memory, local disk, and network path that containers use.

Every worker node runs a **kubelet**, which is the node agent that receives Pod instructions and reports Pod status. The node also runs a **container runtime**, such as containerd, which starts and stops containers. Many clusters also run kube-proxy or another networking component on each node so Services can route traffic to the right Pods.

For the Customer Notification Platform, a Pod cannot run until the scheduler chooses a node and the kubelet on that node starts the container. If all slow requests come from `notification-api` Pods on `worker-03`, the application code may be healthy while that node has a noisy neighbor, network trouble, or disk pressure. Kubernetes gives you useful objects, and operations still need the machine view when symptoms point to one host.

A first look at the cluster capacity uses the node list. This shows which machines the cluster currently knows about and whether they are reporting a healthy condition.

```bash
kubectl get nodes
```

Pod placement connects the app back to the machines. The wide view is useful because it shows the node name beside each running Pod.

```bash
kubectl get pods -n notifications-prod -o wide
```

In a healthy rollout, you might see `notification-api` spread across several nodes and `worker` Pods placed where enough CPU and memory remain. During an outage, the same command can show that every failing Pod landed on the same host or that replacements keep waiting for capacity.

Nodes give the cluster runtime capacity. Kubernetes schedules Pods onto that capacity, so the next concept is the Pod, the runtime wrapper for the containers.

## Pods
<!-- section-summary: A Pod is one scheduled runtime unit, usually holding one application container plus any tightly coupled helper containers. -->

A **Pod** is the smallest deployable unit of computing that Kubernetes creates and manages. In normal application work, one Pod represents one running instance of a workload, such as one copy of `notification-api` or one copy of `worker`.

A Pod wraps one or more containers that need to run together. Containers inside the same Pod share the same network address and can talk over `localhost`, so a helper container can sit next to the main app. For example, a production team might put a service-mesh proxy or log-forwarding helper beside `notification-api` while the main API container still owns the application code.

Pods have short lives in Kubernetes. Rollouts create new Pods, node failures trigger replacement Pods, and scaling changes add or remove Pods. This is why teams normally manage production traffic through higher-level objects and leave individual Pod creation for short experiments.

The Pod shape for `notification-api` lives inside the Deployment template. Start with the labels, image, and HTTP port. This says each Pod belongs to the API component and runs the `1.7.0` image.

```yaml
template:
  metadata:
    labels:
      app: notification-api
      component: api
      tier: backend
  spec:
    containers:
      - name: api
        image: ghcr.io/devpolaris/notification-api:1.7.0
        ports:
          - name: http
            containerPort: 3000
```

A Secret can provide the database URL at runtime. This keeps the database password out of the container image and out of the first Pod-shape snippet.

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: notification-database
        key: url
```

A readiness probe is another small part of the Pod template. It tells Kubernetes when the API can join Service traffic.

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: http
  periodSeconds: 10
  failureThreshold: 3
```

A **Secret** is a Kubernetes object for sensitive values such as passwords, tokens, and database connection strings. Kubernetes can provide the value at runtime from the Secret, which keeps database passwords out of the container image.

A **readiness probe** is a health check Kubernetes uses to decide whether a Pod should receive traffic. For `notification-api`, `/ready` might verify that the app has started, can parse configuration, and can reach the database. When the readiness check passes, the Pod can join Service traffic; while the Pod is still starting, Kubernetes keeps it out of the request path.

Troubleshooting usually starts with Pod status because it tells you which layer is complaining. These commands show the current state, recent logs, and detailed scheduling or container events.

```bash
kubectl get pods -n notifications-prod
kubectl logs deployment/notification-api -n notifications-prod --since=10m
kubectl describe pod notification-api-7f8c9d7b6c-r4m2p -n notifications-prod
```

Pods tell us what one runtime instance looks like. Production needs a manager that keeps the right number of Pods running and replaces them during releases, so we move from Pods to Deployments.

## Deployments
<!-- section-summary: A Deployment keeps a desired set of replaceable Pods running and controls how new versions roll out. -->

A **Deployment** is a Kubernetes object that manages a set of Pods for an application workload, usually a stateless workload. Stateless means the Pod can be replaced because durable data lives somewhere else, such as a database, object store, or queue. `notification-api` is a good fit because customer notification data lives in the database and queued work lives outside the API Pod.

The Deployment owns the rollout rules. If the team releases `notification-api` version `1.8.0`, Kubernetes creates new Pods from the new template and reduces the old Pods at a controlled pace. The Service can keep one stable address while the Deployment changes the backing Pods.

A Deployment starts with the target count and ownership rule. This first slice says the API should have three Pods, and those Pods must carry the same `app` and `component` labels the selector expects.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications-prod
  labels:
    app: notification-api
    component: api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notification-api
      component: api
```

Rollout settings come next. `maxUnavailable: 1` allows one old Pod to be unavailable during the update, and `maxSurge: 1` allows one extra new Pod while the rollout is in progress.

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 1
    maxSurge: 1
```

The Pod template is the part the Deployment uses whenever it creates new Pods. The labels in the template match the selector above, and the container points at the version the team wants to run.

```yaml
template:
  metadata:
    labels:
      app: notification-api
      component: api
      tier: backend
  spec:
    containers:
      - name: api
        image: ghcr.io/devpolaris/notification-api:1.7.0
        ports:
          - name: http
            containerPort: 3000
```

Readiness finishes the first production shape. The new Pod should join traffic only after `/ready` says the API can serve requests.

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: http
```

A full manifest combines those slices. We delay that full view until the recap, after labels, Services, and resources have been explained.

The `replicas: 3` line asks for three Pods. The `RollingUpdate` strategy lets Kubernetes add one new Pod and remove one old Pod at a time in this example. The readiness probe protects the rollout by making each new Pod prove it can serve traffic before the Service relies on it.

A production release often updates the image and waits for the rollout status. A CI system might run the same commands after building and pushing a new container image.

```bash
kubectl set image deployment/notification-api api=ghcr.io/devpolaris/notification-api:1.8.0 -n notifications-prod
kubectl rollout status deployment/notification-api -n notifications-prod
```

Rollback has a concrete command path as well. When error rates spike after the release, the team can inspect revisions and move back to a previous Pod template.

```bash
kubectl rollout history deployment/notification-api -n notifications-prod
kubectl rollout undo deployment/notification-api -n notifications-prod --to-revision=12
```

Deployments know which Pods they manage through labels. That means labels deserve their own section, because the same label system also controls Service traffic and many day-to-day queries.

## Labels and Selectors
<!-- section-summary: Labels are key-value tags, and selectors use those tags to find the right Kubernetes objects. -->

A **label** is a key-value tag attached to a Kubernetes object. A **selector** is a query that matches objects by their labels. Labels give teams a simple way to say which Pods are part of the same app, which environment they belong to, which component they run, or which release track they represent.

For the notification platform, a useful label set might include `app: notification-api`, `component: api`, `tier: backend`, and `environment: production`. The `worker` Pods might use `app: notification-worker`, `component: worker`, and the same `environment: production` label. These tags help controllers and humans ask precise questions.

The Deployment selector below says this Deployment manages Pods with these labels. The Pod template repeats the same labels so new Pods match the Deployment's ownership rule.

```yaml
spec:
  selector:
    matchLabels:
      app: notification-api
      component: api
  template:
    metadata:
      labels:
        app: notification-api
        component: api
        tier: backend
```

The same idea works in the terminal. This command shows only the API Pods in production, which is much cleaner than scanning every Pod in the namespace.

```bash
kubectl get pods -n notifications-prod -l app=notification-api,component=api
```

Labels also support operational habits. Dashboards can group metrics by `app` and `component`, alerts can point to the affected workload, and cost reports can group CPU and memory usage by team-owned labels. Real teams usually agree on a small label standard so automation, monitoring, and humans all speak the same naming language.

Now the Deployment can find its Pods. The next production problem is traffic, because clients need one stable address while Pods get replaced, rescheduled, and scaled.

## Services
<!-- section-summary: A Service gives clients a stable network endpoint while Kubernetes routes to the current matching Pods. -->

A **Service** is a Kubernetes object that exposes a network application running as one or more Pods. The Service gives clients a stable name and port, then Kubernetes routes traffic to Pods selected by labels.

For `notification-api`, the Pods might have names like `notification-api-7f8c9d7b6c-r4m2p` and IP addresses that change during every rollout. The product backend should call a stable endpoint such as `notification-api.notifications-prod.svc.cluster.local` or a public edge that forwards to that Service. The Service handles the changing Pod names and Pod IPs behind that stable route.

A basic Service for the API looks like this. The selector connects the Service to Pods with matching labels, and the port mapping sends Service port `80` to the container port named `http`.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: notification-api
  namespace: notifications-prod
spec:
  type: ClusterIP
  selector:
    app: notification-api
    component: api
  ports:
    - name: http
      port: 80
      targetPort: http
```

`ClusterIP` is the default Service type for internal cluster traffic. In many production systems, an Ingress, Gateway, or cloud load balancer handles the public edge and forwards traffic toward an internal Service. The Service still handles the stable in-cluster destination for the Pods behind it.

The Service depends on labels and readiness. A new `notification-api` Pod can receive traffic after it has the right labels and passes readiness checks. Terminating Pods, unhealthy Pods, and Pods with different labels stay outside the active traffic set.

![Labels and Service routing infographic showing notification-api Pods with app and component labels, a Service selector matching those labels, and ready Pods receiving traffic](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-cluster-mental-model/labels-service-routing.png)
*Labels connect ownership and traffic: the Deployment creates matching Pods, and the Service uses the same labels to find ready backends.*

Traffic debugging usually checks the Service definition, selected Pods, and recent Pod readiness. These commands show the Service, the Pods that should match it, and the logs from the API workload.

```bash
kubectl describe service notification-api -n notifications-prod
kubectl get pods -n notifications-prod -l app=notification-api,component=api
kubectl logs deployment/notification-api -n notifications-prod --since=10m
```

Traffic now has a stable path. The next question is capacity, because Kubernetes still needs enough CPU and memory to place Pods and keep them healthy under real load.

## Resource Requests and Limits
<!-- section-summary: Requests guide scheduling, limits cap runtime usage, and both settings turn app needs into cluster capacity decisions. -->

**Resource requests** tell Kubernetes how much CPU or memory a container needs for scheduling. **Resource limits** tell Kubernetes the maximum amount a container can use at runtime. CPU and memory are the common starting point, and production teams tune them from real measurements.

For `notification-api`, a request of `250m` CPU means a quarter of one CPU core. A memory request of `256Mi` means the scheduler should place the Pod on a node with at least that much available memory for this container. The scheduler uses requests to decide where the Pod fits.

Limits control the upper bound. A CPU limit can throttle a busy container, and a memory limit can cause the process to get killed if it uses too much memory. This matters for the `worker` because a large batch of notification jobs can use more memory than expected while rendering templates, calling providers, or loading customer preferences from the database.

The API container might start with settings like these. The numbers should come from load tests, production metrics, and a safety margin. Copying one guessed value between services creates capacity surprises:

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
  limits:
    cpu: "1"
    memory: "512Mi"
```

A worker usually has a different profile. If each worker sends notifications in batches, the team might give it more memory and scale replicas based on queue depth, while also watching database connection limits so the database can handle the extra concurrent work.

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "512Mi"
  limits:
    cpu: "2"
    memory: "1Gi"
```

Capacity problems have recognizable signs. A Pod stuck in `Pending` may have a scheduling event that says every node is short on CPU or memory for the request. A worker that exits with `OOMKilled` probably crossed its memory limit. A busy API with high latency and low error logs may be CPU throttled.

The usual checks connect Pod symptoms to resource settings. Metrics need the cluster metrics pipeline, but the describe output and events are available in ordinary clusters.

```bash
kubectl describe pod notification-api-7f8c9d7b6c-r4m2p -n notifications-prod
kubectl top pods -n notifications-prod
kubectl get events -n notifications-prod --sort-by=.lastTimestamp
```

Real platform teams often add guardrails at the namespace level. A **ResourceQuota** can cap the total CPU, memory, or object count used by a namespace, and a **LimitRange** can provide defaults or minimum and maximum values for Pods and containers. Those controls keep one workload from accidentally taking all shared cluster capacity.

Now we have the pieces: API objects, nodes, Pods, Deployments, labels, Services, and resource settings. The easiest way to make the pieces stick is to follow one notification request through the platform.

## Following One Notification
<!-- section-summary: A single customer notification crosses the Service, API Pods, database dependency, worker Pods, and rollout machinery. -->

A customer places an order, and the product backend calls the Customer Notification Platform to send a confirmation message. The public edge accepts the HTTPS request and forwards it toward the `notification-api` Service. That Service uses its selector to route the request to one ready `notification-api` Pod.

Inside the Pod, the API container validates the request, checks customer preferences, and writes a notification record to the database. The API can be running perfectly while the user request still fails if credentials, network policy, DNS, or connection pool settings block database access. Readiness checks often include a lightweight database check or a dependency check that represents the app's real startup requirements.

After the API stores the notification job, a `worker` Pod picks up work from the queue or database-backed job table. The worker calls the email or SMS provider, writes delivery attempts back to the database, and records enough detail for support teams to answer customer questions. The API and worker are separate Deployments because they scale for different reasons: the API scales with incoming HTTP traffic, and the worker scales with queued notification backlog.

Now add a rollout. The team releases `notification-api:1.8.0` with a safer provider timeout, and the Deployment starts new Pods. Each new Pod loads configuration, connects to the database, passes readiness, and then receives traffic through the Service. Old Pods drain as the rollout advances, while the Service address stays the same for callers.

This is the important production connection. The API object records intent, the Deployment controls replacement, the Pod runs the container, the node supplies capacity, the labels connect ownership and traffic, the Service gives a stable route, and the database remains an external dependency the workload must handle carefully.

## Operations Checks
<!-- section-summary: Daily Kubernetes debugging follows the object relationships from rollout state to Pods, Services, resources, and dependencies. -->

Operations work usually starts with a symptom from users, alerts, or dashboards. For this platform, common symptoms include API 5xx responses, delayed notifications, a stuck rollout, or Pods waiting for capacity. Each symptom maps back to one or more Kubernetes objects.

Here is a practical first pass a production engineer might use. The table keeps the first checks tied to the object relationships we have already covered.

![Cluster operations summary infographic showing rollout status, Deployment replicas, Pods on nodes, Service selection, resource checks, events, and logs for notification-api and worker](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-cluster-mental-model/cluster-operations-summary.png)
*A useful operations pass follows the relationships: Deployment, Pods, nodes, Service, resources, events, and logs.*

| Question | Command | Healthy signal |
| --- | --- | --- |
| Are the desired replicas available? | `kubectl get deployment notification-api worker -n notifications-prod` | Available replicas match desired replicas |
| Did the rollout finish? | `kubectl rollout status deployment/notification-api -n notifications-prod` | Rollout reports successful completion |
| Are Pods spread across nodes? | `kubectl get pods -n notifications-prod -o wide` | Pods run on healthy nodes with expected status |
| Are API Pods selected by the Service? | `kubectl get pods -n notifications-prod -l app=notification-api,component=api` | Matching Pods exist and report ready containers |
| Are capacity events blocking scheduling? | `kubectl get events -n notifications-prod --sort-by=.lastTimestamp` | Recent events stay free of repeated scheduling failures |
| Are containers hitting limits? | `kubectl top pods -n notifications-prod` | CPU and memory usage stay within expected ranges |

A rollout incident has a clear path. If `notification-api:1.8.0` increases 5xx errors, the engineer checks rollout status, reads recent API logs, confirms Service selection, and then uses rollout undo to return to the previous revision while the team investigates.

```bash
kubectl rollout status deployment/notification-api -n notifications-prod
kubectl logs deployment/notification-api -n notifications-prod --since=10m
kubectl rollout undo deployment/notification-api -n notifications-prod
```

A backlog incident uses a different path. If customers receive emails late, the engineer checks the `worker` Deployment, worker logs, resource usage, and database connection errors. Scaling the worker can help only when the database and provider can handle more concurrent work:

```bash
kubectl get deployment worker -n notifications-prod
kubectl logs deployment/worker -n notifications-prod --since=15m
kubectl scale deployment/worker -n notifications-prod --replicas=6
```

Useful Kubernetes operations follow object relationships before individual commands. Deployment health leads to Pods, Pods lead to nodes and logs, Services lead to labels and readiness, and resource symptoms lead to requests, limits, and namespace guardrails.

## Putting It All Together
<!-- section-summary: The cluster pieces form one operating loop from API records to running Pods, routed traffic, capacity decisions, and production recovery. -->

The Customer Notification Platform gives us one complete path through the cluster. A team stores desired configuration as API objects, the Deployment keeps the right number of Pods running, the scheduler places Pods on nodes, the kubelet starts containers, and the Service routes traffic to ready Pods selected by labels.

The database dependency adds the production reality. Kubernetes can keep Pods running, but the application still needs correct credentials, network access, connection limits, and dependency-aware readiness checks. A healthy platform treats the database as part of the runtime path, even when the database itself lives outside the cluster.

Here is the whole picture in one operational table. It works as a quick review before the next article goes deeper into the control plane and worker nodes.

| Piece | What it means | Notification platform example | Daily check |
| --- | --- | --- | --- |
| **API object** | Stored cluster record | Deployment and Service YAML for `notification-api` | `kubectl get deployment notification-api -o yaml` |
| **Node** | Runtime machine | `worker-02` hosts one API Pod and one worker Pod | `kubectl get pods -o wide` |
| **Pod** | One scheduled app instance | One running copy of `notification-api` | `kubectl logs deployment/notification-api` |
| **Deployment** | Pod lifecycle and rollout manager | Three API replicas, two worker replicas | `kubectl rollout status deployment/notification-api` |
| **Label and selector** | Tags and matching rules | `app=notification-api,component=api` | `kubectl get pods -l app=notification-api` |
| **Service** | Stable traffic endpoint | `notification-api` routes to ready API Pods | `kubectl describe service notification-api` |
| **Resources** | CPU and memory scheduling rules | API gets `250m` CPU request, worker gets larger memory | `kubectl describe pod` and `kubectl top pods` |

Here is the full Deployment after the article has introduced the smaller pieces. It combines identity, replica count, selector, rollout strategy, Pod labels, image, port, database Secret reference, and readiness in one file.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications-prod
  labels:
    app: notification-api
    component: api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: notification-api
      component: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  template:
    metadata:
      labels:
        app: notification-api
        component: api
        tier: backend
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/notification-api:1.7.0
          ports:
            - name: http
              containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: notification-database
                  key: url
          readinessProbe:
            httpGet:
              path: /ready
              port: http
```

These relationships give you a reliable reading order for a cluster. The API records what the team wants, controllers compare that with the current cluster, nodes run the containers, and operations checks tell you where the current state has drifted from the desired one.

## What's Next

You now have the main cluster pieces connected through one application. The next article zooms into **Control Plane and Worker Nodes**, where we look more closely at the API server, scheduler, controllers, kubelet, container runtime, and the handoff between them.

---

**References**

- [Kubernetes Components](https://kubernetes.io/docs/concepts/overview/components/) - Official overview of control plane components, node components, kubelet, kube-proxy, and the container runtime.
- [Objects In Kubernetes](https://kubernetes.io/docs/concepts/overview/working-with-objects/) - Official explanation of Kubernetes objects, `spec`, `status`, and desired state.
- [The Kubernetes API](https://kubernetes.io/docs/concepts/overview/kubernetes-api/) - Official overview of the API server and how tools query and manipulate Kubernetes objects.
- [Nodes](https://kubernetes.io/docs/concepts/architecture/nodes/) - Official node concept page for cluster machines, node status, and node management.
- [Pods](https://kubernetes.io/docs/concepts/workloads/pods/) - Official Pod concept page covering Pods as the smallest deployable units and their lifecycle.
- [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official Deployment page covering replica management, rollout, rollback, and scaling use cases.
- [Labels and Selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/) - Official reference for labels, selectors, and common label examples.
- [Service](https://kubernetes.io/docs/concepts/services-networking/service/) - Official Service page covering stable endpoints for applications running across one or more Pods.
- [Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/) - Official resource request and limit guidance for CPU, memory, and scheduling behavior.
- [Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Official task guide for the health checks used by Pods and rollouts.
- [Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/) - Official namespace-level quota concept for limiting resource and object usage.
- [Limit Ranges](https://kubernetes.io/docs/concepts/policy/limit-range/) - Official namespace-level default and constraint concept for container and Pod resources.
- [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) - Official Secret concept page for sensitive configuration such as database credentials.
