---
title: "Control Plane and Worker Nodes"
description: "Understand how Kubernetes accepts API requests, stores cluster state, places Pods on nodes, and gets containers running."
overview: "Kubernetes splits coordination from execution. The control plane accepts and stores the desired state, while worker nodes run Pods, report health, and carry application traffic."
tags: ["kubernetes", "control-plane", "nodes", "kubelet"]
order: 3
id: article-containers-orchestration-kubernetes-fundamentals-control-plane-and-worker-nodes
aliases:
  - containers-orchestration/orchestration-k8s/k8s-architecture.md
  - article-containers-orchestration-orchestration-k8s-k8s-architecture
---

## Table of Contents

1. [One Pod Needs a Place to Run](#one-pod-needs-a-place-to-run)
2. [The App We Will Deploy](#the-app-we-will-deploy)
3. [From Request to Running Pod](#from-request-to-running-pod)
4. [The API Server and Kubernetes API](#the-api-server-and-kubernetes-api)
5. [etcd: The Cluster State Store](#etcd-the-cluster-state-store)
6. [Controllers and the Scheduler](#controllers-and-the-scheduler)
7. [Worker Nodes, kubelet, and the Container Runtime](#worker-nodes-kubelet-and-the-container-runtime)
8. [Networking and Traffic on Nodes](#networking-and-traffic-on-nodes)
9. [Operations: Debugging the Hand-Offs](#operations-debugging-the-hand-offs)
10. [Managed Kubernetes Responsibilities](#managed-kubernetes-responsibilities)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## One Pod Needs a Place to Run
<!-- section-summary: One container runs inside one Pod, and that Pod needs a worker node plus a control plane that coordinates placement. -->

A **container** is a packaged application process with the files it needs to run. For example, the `notification-api` container image can hold the API code, installed dependencies, and the command that starts the HTTP server. A container image answers the packaging question: what should run?

A **Pod** is the smallest runtime unit Kubernetes schedules. One `notification-api` Pod usually wraps one API container and gives it a cluster network identity, health checks, and a place in the Kubernetes API. A Pod answers the first runtime question: what is one running copy of the app?

A **worker node** is a physical or virtual machine that runs Pods. The node supplies CPU, memory, local disk, and networking. Each worker node runs a local agent called the kubelet, a container runtime such as containerd or CRI-O, and networking components that let Pods communicate.

A **Kubernetes cluster** is a group of worker nodes managed under one API. The cluster needs a coordination layer because many Pods need placement, many nodes report health, and many users or pipelines can ask for changes. That coordination layer is the **control plane**.

A **control plane** is the set of Kubernetes components that expose the API and keep cluster state moving toward the requested configuration. It includes the API server, etcd, the scheduler, and controllers. The API server accepts requests, etcd stores cluster data, the scheduler chooses nodes for Pods, and controllers keep checking whether the cluster matches what was requested.

This article follows that split in the order work actually travels. We will start with the shared application, send a deployment request, follow the API server and etcd, then follow controllers, scheduler, kubelet, runtime, networking, and operations. By the end, a Kubernetes rollout should read like a chain of concrete jobs.

## The App We Will Deploy
<!-- section-summary: The Customer Notification Platform gives every component a concrete job: API traffic, worker processing, database dependency, rollout, and operations. -->

We will use a Customer Notification Platform for the whole article. It has a `notification-api` service that receives HTTP requests from other product systems, such as checkout or billing. It validates the request, stores a notification record in a database, and returns a response. It also has a `notification-worker` process that picks up pending notifications and sends email, SMS, or push messages.

Many Kubernetes failures show up as application symptoms. The `notification-api` Pod can start successfully while the database connection fails. The worker can keep running while it falls behind after database latency increases. Kubernetes can help route traffic only to healthy Pods, restart failed containers, and schedule replacement Pods, but the app still needs good probes, logs, resource requests, and rollout settings.

In this scenario, the platform usually has these Kubernetes objects. Each one lines up with a real production job, so the same names will reappear when we talk about scheduling, traffic, rollout, and debugging.

| Object | Example name | Why it exists |
|---|---|---|
| **Namespace** | `notifications-prod` | Keeps production notification objects grouped together. |
| **Deployment** | `notification-api` | Runs and rolls out API Pods. |
| **Deployment** | `notification-worker` | Runs background worker Pods. |
| **Service** | `notification-api` | Gives traffic a stable way to reach ready API Pods. |
| **Secret** | `notification-database` | Holds the database connection string or credentials. |
| **ConfigMap** | `notification-settings` | Holds non-secret settings such as batch size or feature flags. |

The same example also gives us realistic operations work. A new image version rolls out after a bug fix. Traffic must reach ready API Pods. Worker replicas may need scaling during a marketing campaign. A database outage should show up in readiness, logs, and metrics. A node upgrade should drain Pods safely without losing notification requests halfway through processing.

## From Request to Running Pod
<!-- section-summary: A Kubernetes request moves from desired state to API object, then through controllers, scheduler, kubelet, runtime, and networking before traffic reaches a Pod. -->

A **manifest** is a YAML or JSON file that describes a Kubernetes object. The file says what you want the cluster to manage. For `notification-api`, a manifest can describe the image, replicas, port, database Secret, health checks, and resource requests. A resource request tells Kubernetes how much CPU or memory the container expects to need for scheduling.

The manifest is the desired state. For example, `replicas: 2` asks Kubernetes to keep two API Pods running. The rest of the cluster then works from that stored request: controllers create Pod records, the scheduler chooses nodes, and kubelets start containers on the selected machines.

Start with the smallest Deployment skeleton. It gives the API two replicas and enough labels for controllers to connect the Deployment to the Pods it creates.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications-prod
  labels:
    app: notification-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: notification-api
  template:
    metadata:
      labels:
        app: notification-api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/notification-api:1.8.0
```

The next slice names the port and the database Secret. The port gives probes and Services a target. The Secret reference gives the container a database URL without putting the credential in the image.

```yaml
ports:
  - name: http
    containerPort: 3000
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: notification-database
        key: url
```

Readiness and resources finish the part that matters to scheduling and traffic. The scheduler uses the requests to place the Pod, and the readiness probe keeps the Pod out of traffic until `/ready` passes.

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: http
  periodSeconds: 10
  failureThreshold: 3
resources:
  requests:
    cpu: "250m"
    memory: "512Mi"
  limits:
    cpu: "1"
    memory: "1Gi"
```

You apply that file with `kubectl`, the command-line client for the Kubernetes API. The client reads your kubeconfig, authenticates to the cluster, and sends an HTTP request to the API server.

```bash
kubectl apply -f notification-api.yaml
```

The command output may say `deployment.apps/notification-api created` or `deployment.apps/notification-api configured`. That message means the API server accepted and stored the Deployment object. The containers still need several components to notice the new state and act on it.

The full hand-off looks like this. The table follows one Deployment request, but the same component chain shows up when you scale workers, change probes, or roll out a new image.

| Step | Component | What happens for `notification-api` |
|---|---|---|
| 1 | **kubectl** | Sends the Deployment request to the Kubernetes API. |
| 2 | **API server** | Authenticates the caller, checks permission, validates the object, and writes it to storage. |
| 3 | **etcd** | Stores the Deployment and later stores related status updates. |
| 4 | **Deployment controller** | Creates a ReplicaSet for the new version. |
| 5 | **ReplicaSet controller** | Creates two Pod objects because `replicas: 2` asked for two copies. |
| 6 | **Scheduler** | Chooses worker nodes that have enough resources and satisfy scheduling rules. |
| 7 | **kubelet** | Notices a Pod assigned to its node and asks the runtime to start containers. |
| 8 | **Container runtime** | Pulls the image and starts the container process. |
| 9 | **Networking components** | Give the Pod an IP address and route Service traffic to ready Pods. |

![Manifest handoff chain showing kubectl, API server, etcd, controllers, scheduler, kubelet, container runtime, networking, and status updates for notification-api](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-control-plane-and-worker-nodes/manifest-handoff-chain.png)
*One Deployment request moves through the control plane first, then through worker-node components that start containers and report status.*

This flow is the practical structure for debugging. If `kubectl apply` fails, the investigation starts at the API server request. If Pods sit in `Pending`, scheduling and capacity need attention. If Pods show `ImagePullBackOff`, the request reached a worker node and the runtime failed to pull the image. If the Pod runs and receives no traffic, readiness and Service endpoints need inspection.

## The API Server and Kubernetes API
<!-- section-summary: The API server is the front door for Kubernetes, and every user, controller, scheduler, and kubelet uses that API as the shared path for cluster state. -->

The **Kubernetes API** is the HTTP interface for creating, reading, updating, and deleting Kubernetes objects. An **API object** is one stored record in Kubernetes, such as a Deployment, Pod, Service, Secret, Namespace, or Event. The API gives all cluster actors one shared language for saying what exists and what should happen next.

The **API server**, usually named `kube-apiserver`, exposes that API. Developers use it through `kubectl`, CI/CD systems use it during deployments, controllers watch it for changes, the scheduler writes placement decisions to it, and kubelets report node and Pod status back to it. This central API path keeps the cluster consistent because everyone works through the same validation, security, and storage rules.

For the Customer Notification Platform, a CI pipeline might deploy a new image after tests pass. The pipeline uses a service account with permission to update Deployments in `notifications-prod`. The API server checks that identity, checks the RBAC rules, validates the Deployment schema, runs admission checks, and only then stores the new desired state.

The request pipeline usually includes these stages. The same checks apply whether the caller is a person using `kubectl`, a CI pipeline, or a controller inside the cluster.

| Stage | What it means in plain English | Production example |
|---|---|---|
| **Authentication** | Kubernetes verifies who is calling. | A CI service account token identifies the deployment pipeline. |
| **Authorization** | Kubernetes checks what that caller can do. | RBAC allows updating Deployments in `notifications-prod`. |
| **Admission** | Kubernetes applies extra policy before storage. | A policy can require resource requests or block unsigned images. |
| **Validation and defaulting** | Kubernetes checks the object shape and fills safe defaults. | The API rejects a Deployment with an invalid field name. |
| **Persistence** | Kubernetes stores the accepted object. | The Deployment spec lands in etcd. |

You can ask Kubernetes whether your current identity has permission before a rollout. This is useful in CI setup, where a missing permission should fail early, before it interrupts the middle of a release.

```bash
kubectl auth can-i update deployments -n notifications-prod
```

You can also call the API directly through `kubectl get --raw`. This helps you remember that `kubectl` is a client for an HTTP API, and other clients can use the same API through official client libraries.

```bash
kubectl get --raw /apis/apps/v1/namespaces/notifications-prod/deployments/notification-api
```

A key API behavior is a **watch**. A watch is a long-running API request that streams changes as objects update. Controllers, the scheduler, and kubelets use watches so they can react quickly when a Deployment changes, a Pod needs placement, or a Pod status needs reporting. This is why Kubernetes can coordinate many independent components without one giant process doing every job.

## etcd: The Cluster State Store
<!-- section-summary: etcd stores Kubernetes cluster data, so production clusters protect it carefully and keep business data somewhere else. -->

**etcd** is the strongly consistent key-value store Kubernetes uses as its backing store for cluster data. A key-value store saves data under named keys, a bit like a structured map. In Kubernetes, etcd stores API objects and their state, including Deployments, Pods, Services, Secrets, ConfigMaps, Node objects, and Events.

The API server is the normal path into etcd. Controllers, schedulers, kubelets, and users talk to the API server, and the API server talks to etcd. That boundary matters for security and consistency because it keeps validation, authorization, admission, and audit behavior in front of the storage layer.

For our platform, etcd stores the `notification-api` Deployment and the Pod records created from it. Your customer notification rows belong in the application database, such as PostgreSQL. The database stores business facts: who needs a notification, delivery state, retry count, and timestamps. etcd stores cluster facts: which Kubernetes objects exist, which Pods are assigned to which nodes, and what status those Pods reported.

This difference shows up during incidents. If PostgreSQL has a regional outage, Kubernetes can still show Deployments, Pods, and Events because those records live in etcd. The application may mark readiness as failed, and the Service should stop routing traffic to unhealthy API Pods. If etcd loses quorum in a self-managed control plane, existing Linux container processes can continue running for a while, while new deploys, scale changes, and scheduler bindings stop until the storage layer recovers.

Self-managed clusters need a serious etcd plan. Real teams run etcd on reliable storage, protect it with TLS, keep access narrow, monitor disk latency and leader health, and take regular snapshots. A snapshot command in a self-managed environment often looks like this, with real certificate paths supplied by your cluster setup.

```bash
ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /backup/etcd-$(date +%F).db
```

Managed Kubernetes changes the day-to-day work around etcd, because the provider usually operates the control-plane storage. The concept still matters for troubleshooting. If your API server gets slow during a rollout, the cause may sit in control-plane health, admission webhooks, or etcd performance, while a Pod crash points you toward worker nodes, runtime, or application behavior.

## Controllers and the Scheduler
<!-- section-summary: Controllers create and maintain the objects needed for your requested state, while the scheduler chooses suitable nodes for Pods. -->

A **controller** is a control loop that watches Kubernetes objects and makes changes to move the cluster toward the requested state. In application terms, a controller notices a gap between what you asked for and what currently exists. Then it creates, updates, or deletes Kubernetes objects through the API server.

The Deployment controller handles rollouts for `notification-api`. When you apply the Deployment, it creates a ReplicaSet for the version of the Pod template in that Deployment. The ReplicaSet controller then keeps the requested number of Pods present. If `replicas: 2` asks for two API Pods and only one exists, the controller creates another Pod object.

Controllers work through the API server by creating or updating objects. The scheduler and kubelet handle the later machine-level hand-offs. That design lets several small controllers cooperate. One controller manages Deployments, another manages ReplicaSets, another manages Nodes, and another can manage cloud load balancers through a cloud controller manager.

The **scheduler** chooses which worker node should run a Pod. It watches for Pod objects that need a node assignment, checks candidate nodes, and writes the chosen node name back through the API server. Once that binding exists, the kubelet on the selected node takes over the local runtime work.

The scheduler usually thinks in two broad phases: **filtering** and **scoring**. Filtering removes nodes that lack the resource, taint, node selector, affinity, volume, or health requirements for the Pod. Scoring ranks the remaining nodes so Kubernetes can spread work sensibly across the cluster.

For `notification-api`, filtering might remove a small node that lacks `512Mi` of available memory. Scoring might prefer a node in a different zone so two API replicas land across failure domains. For `notification-worker`, you might choose cheaper batch nodes with a label such as `workload=background`, because workers process jobs asynchronously and can tolerate a different node pool from the user-facing API.

Here is a small scheduling rule that asks Kubernetes to spread API Pods across zones when possible. It uses the standard zone label that many clusters place on nodes.

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app: notification-api
```

When a Pod stays in `Pending`, scheduler events usually come before random setting changes. The describe output often tells you the real blocker, such as `Insufficient memory`, a missing toleration, or a node selector that matches zero nodes.

```bash
kubectl -n notifications-prod describe pod notification-api-7f5c9d6c8f-q2m8n
```

The fix depends on the event. Add node capacity when the cluster lacks resources. Correct the request if the app asked for more CPU or memory than it uses. Add a toleration only when the Pod truly belongs on a tainted node. Change labels or affinity rules when a scheduling policy points at the wrong node pool.

## Worker Nodes, kubelet, and the Container Runtime
<!-- section-summary: Worker nodes run the local pieces that turn an assigned Pod into Linux processes with logs, probes, volumes, and reported status. -->

A **worker node** is the machine that runs Pods. It may be a cloud VM, a bare-metal server, or another supported compute environment. Kubernetes represents each machine with a Node object, and the control plane uses that object to track capacity, labels, conditions, and health.

The **kubelet** is the primary node agent. It runs on every node, registers the node with the API server, watches for PodSpecs assigned to that node, prepares volumes and configuration, asks the container runtime to start containers, runs health probes, and reports status back to the API server. A PodSpec is the part of the Pod object that describes the containers, volumes, environment, probes, and other runtime settings.

For `notification-api`, the kubelet sees that the scheduler assigned a Pod to `worker-02`. It makes sure the Secret and ConfigMap data needed by the Pod can mount or appear as environment variables. It asks the runtime to pull `ghcr.io/devpolaris/notification-api:1.8.0`. It starts the container, calls the `/ready` endpoint for readiness, and reports whether the Pod is running and ready.

The **container runtime** is the software that actually runs containers on the node. Common Kubernetes runtimes include containerd and CRI-O. Kubernetes talks to runtimes through the **Container Runtime Interface**, usually shortened to CRI, so the kubelet can ask for standard actions such as pulling an image, creating a container, starting it, stopping it, and collecting status.

This local responsibility explains common failure messages. `ImagePullBackOff` usually means the kubelet reached the runtime and the runtime failed to fetch the image because of a bad tag, missing registry credentials, or registry outage. `CrashLoopBackOff` usually means the runtime started the container and the process exited repeatedly. A readiness failure means the process may be running while the app reports that it should stay out of Service traffic.

![Node runtime stack showing a worker node with kubelet, container runtime, Pod sandbox, notification-api container, probes, logs, volumes, and status reporting back to the API server](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-control-plane-and-worker-nodes/node-runtime-stack.png)
*Worker-node debugging usually follows this stack: node condition, kubelet event, runtime action, container log, probe result, and status update.*

These commands show the node side of the story. They connect the Pod you care about to the worker machine, runtime events, and application logs.

```bash
kubectl get nodes -o wide
kubectl -n notifications-prod get pods -o wide
kubectl -n notifications-prod describe pod notification-api-7f5c9d6c8f-q2m8n
kubectl -n notifications-prod logs deployment/notification-api -c api
```

Node maintenance uses the same control-plane and node split. `cordon` marks a node unschedulable for new Pods. `drain` evicts eligible Pods so controllers can create replacements on other nodes. After maintenance, `uncordon` lets the scheduler place new Pods on that node again.

```bash
kubectl cordon worker-02
kubectl drain worker-02 --ignore-daemonsets --delete-emptydir-data
kubectl uncordon worker-02
```

Production teams usually combine draining with **PodDisruptionBudgets**. A PodDisruptionBudget, or PDB, tells Kubernetes how many Pods for an app must remain available during voluntary disruptions such as node drains. For the API, a PDB can protect customer traffic during node upgrades. For the worker, the budget may allow more disruption if jobs can retry safely.

## Networking and Traffic on Nodes
<!-- section-summary: Node networking connects Pod IPs, Service routing, readiness, and traffic so customers reach healthy application containers. -->

Kubernetes gives each Pod its own network identity. A **Pod IP** is the address assigned to a Pod inside the cluster network. A **CNI plugin** is the networking plugin that creates the Pod network attachment and handles the cluster network rules needed by that implementation. CNI stands for Container Network Interface, the standard plugin shape used by Kubernetes networking implementations.

A **Service** gives clients a stable way to reach a changing set of Pods. Pods come and go during rollouts, scaling, crashes, and node drains, so clients should avoid calling individual Pod IPs directly. A Service selects Pods by labels and routes to the ones Kubernetes considers ready.

Here is a Service for the API. It selects Pods with `app: notification-api` and exposes port `80` inside the cluster while forwarding to container port `3000`.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: notification-api
  namespace: notifications-prod
spec:
  selector:
    app: notification-api
  ports:
    - name: http
      port: 80
      targetPort: 3000
```

The user-facing traffic path might look like this in production: an Ingress or cloud load balancer receives HTTPS traffic, routes to the `notification-api` Service, and the Service sends traffic to ready API Pods. The API reads and writes the database. The worker Deployment usually receives background work through the database or a queue and needs outbound access for provider calls.

The kubelet and networking layer work together during rollout. The kubelet runs the readiness probe against `/ready`. If the app loses its database connection, the probe should fail. Kubernetes then keeps that Pod out of the Service endpoint set until the app reports readiness. This gives the rollout a practical safety check: a container can start, warm up, connect to dependencies, and only then receive customer traffic.

You can inspect the Service routing view with these commands. They show the stable Service object, the current endpoint set, and the Pod readiness details that explain the current traffic path.

```bash
kubectl -n notifications-prod get svc notification-api
kubectl -n notifications-prod get endpointslices -l kubernetes.io/service-name=notification-api
kubectl -n notifications-prod describe pod -l app=notification-api
```

The node component traditionally associated with Service routing is **kube-proxy**. It maintains network rules on nodes so Services can reach Pods. Some modern networking stacks implement Service behavior with other data-plane approaches, such as eBPF, but the Kubernetes idea stays the same: traffic targets a Service, the Service selects ready Pods, and node networking delivers packets to the right Pod IPs.

## Operations: Debugging the Hand-Offs
<!-- section-summary: Good Kubernetes operations follow the hand-off chain: API request, stored state, controller work, scheduling, node startup, readiness, and traffic. -->

At this point, the cluster has enough moving parts that guessing wastes time. A better habit is to follow the hand-offs in order. During an incident, the team first identifies which component last did its job successfully, then inspects the next component in the chain.

A new `notification-api` version rolls out, and checkout traffic starts failing. The deployment pipeline succeeded, so the first question is whether the API server accepted the current desired state. Then the team checks whether controllers created new ReplicaSets and Pods, whether the scheduler placed those Pods, whether kubelets started containers, whether readiness passed, and whether the Service has endpoints.

A practical rollout command set looks like this. The first command changes the image, and the next commands watch whether controllers, scheduler, and kubelets complete the rollout.

```bash
kubectl -n notifications-prod set image deployment/notification-api \
  api=ghcr.io/devpolaris/notification-api:1.8.1

kubectl -n notifications-prod rollout status deployment/notification-api
kubectl -n notifications-prod get deploy,rs,pods -l app=notification-api
```

If the rollout fails after the new image starts crashing, rollback is a normal operational action. The Deployment controller keeps rollout history, so you can ask Kubernetes to return to the previous ReplicaSet.

```bash
kubectl -n notifications-prod rollout undo deployment/notification-api
kubectl -n notifications-prod rollout status deployment/notification-api
```

Here is the debugging path I would walk with a junior engineer during that incident. Each row maps one question to the component that owns the next hand-off.

| Question | Command | What the answer tells you |
|---|---|---|
| Can I reach the control plane? | `kubectl cluster-info` | Basic API connectivity works from your machine or CI runner. |
| Is the API server healthy enough to answer readiness? | `kubectl get --raw='/readyz?verbose'` | Control-plane readiness checks pass or name the failing check. |
| Did Kubernetes store the desired Deployment? | `kubectl -n notifications-prod get deployment notification-api -o yaml` | The image, replicas, probes, and labels match the intended rollout. |
| Did controllers create rollout objects? | `kubectl -n notifications-prod get rs,pods -l app=notification-api` | ReplicaSets and Pods exist for the new version. |
| Did the scheduler place the Pods? | `kubectl -n notifications-prod get pods -o wide` | The `NODE` column shows placement, while blank placement points at scheduling. |
| Did the node start the container? | `kubectl -n notifications-prod describe pod <pod-name>` | Events show image pull, mount, probe, and runtime errors. |
| What did the app say? | `kubectl -n notifications-prod logs <pod-name> -c api` | Application logs show crashes, database errors, and startup failures. |
| Is traffic routed to ready Pods? | `kubectl -n notifications-prod get endpointslices -l kubernetes.io/service-name=notification-api` | EndpointSlices show which Pod IPs back the Service. |

Operations teams also monitor these layers continuously. Control-plane alerts cover API availability, request latency, admission webhook errors, and etcd health in self-managed clusters. Node alerts cover `Ready` status, CPU and memory pressure, disk pressure, image pull errors, kubelet health, CNI errors, and Pod restart rates. Application alerts cover request latency, failed notifications, worker backlog, and database connection errors.

This is where Kubernetes architecture helps day-to-day work. A `Pending` Pod sends you toward scheduler events and capacity. `ImagePullBackOff` sends you toward registry credentials, image tags, and runtime events. Readiness failures send you toward app startup, database connectivity, and dependency health. API server errors during a deployment send you toward authentication, authorization, admission, control-plane health, or etcd.

## Managed Kubernetes Responsibilities
<!-- section-summary: Managed Kubernetes usually runs the control plane for you, while your team still owns workload design, node choices, rollout behavior, and application health. -->

**Managed Kubernetes** means a cloud provider operates important parts of the cluster for you. In services such as Amazon EKS, Google Kubernetes Engine, and Azure Kubernetes Service, the provider usually manages the control-plane machines and etcd. Your team still uses the Kubernetes API, deploys workloads, configures access, chooses node pools, and operates the application.

This responsibility line matters during production planning. If the provider manages the API server and etcd, you usually rely on provider controls for control-plane upgrades, backups, and high availability. Your team still designs `notification-api` with resource requests, readiness probes, rollout strategy, PDBs, logs, metrics, and safe database behavior. The provider can keep the API reachable, while your manifests decide whether a rollout protects customers.

Worker nodes may still belong to your team. Managed node groups can automate parts of node provisioning and upgrades, but you choose instance types, capacity, labels, taints, autoscaling settings, security updates, and networking add-ons. Serverless or autopilot-style Kubernetes offerings move more node operations to the provider, while application specs still shape scheduling, health checks, and traffic behavior.

A simple production checklist for this article's boundary looks like this. The point is ownership: the team responsible for a layer should know its alerts, change process, and rollback path.

| Area | Common owner | What to verify |
|---|---|---|
| API server and etcd | Provider in managed clusters, platform team in self-managed clusters | Availability, upgrades, backups, admission behavior, API latency. |
| Worker node pools | Platform team with provider automation | Node version, capacity, labels, taints, runtime, CNI, system reservations. |
| `notification-api` manifests | Application team with platform review | Probes, resources, rollout strategy, Service selector, database configuration. |
| `notification-worker` manifests | Application team with platform review | Replica count, job concurrency, retry behavior, resources, graceful shutdown. |
| Observability | Shared | Events, logs, metrics, traces, alerts, dashboards, and runbooks. |

The practical advice is simple: the team tracks which layer each change touches. Applying a Deployment changes API objects and starts a controller-driven rollout. Resizing a node pool changes scheduling capacity. Updating the CNI changes Pod networking behavior. Rotating database credentials changes application dependency health and may require coordinated Secret updates and rollout timing.

## Putting It All Together
<!-- section-summary: A real rollout combines every piece: API request, stored state, controller work, scheduling, node startup, readiness, traffic, and operations feedback. -->

The Customer Notification Platform release path now runs from release to traffic. A CI pipeline updates `notification-api` from `1.8.0` to `1.8.1`. `kubectl` sends the request to the API server. The API server authenticates the pipeline, checks authorization, runs admission, validates the Deployment, and stores the accepted object in etcd.

The Deployment controller sees the updated Pod template and creates a new ReplicaSet. The ReplicaSet controller creates new Pod objects. The scheduler sees Pods that need placement, filters and scores worker nodes, and writes node bindings through the API server. The kubelet on each selected node sees its assigned Pod, asks the runtime to pull the image, mounts configuration, starts the container, and runs readiness probes.

Once the API Pods report ready, the Service endpoint set includes their Pod IPs. Customer traffic reaches the Service, flows to a ready API Pod, and the API writes notification records to the database. The worker Deployment runs separate Pods that process the pending records and send notifications. If a worker falls behind, scaling the worker Deployment creates more worker Pods through the same controller, scheduler, kubelet, and runtime path.

Here is the full Deployment request after the control-plane and worker-node responsibilities have names. The API server stores this object, controllers expand it into lower-level objects, the scheduler chooses nodes, and kubelets start the containers.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-api
  namespace: notifications-prod
  labels:
    app: notification-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: notification-api
  template:
    metadata:
      labels:
        app: notification-api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/notification-api:1.8.0
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
            periodSeconds: 10
            failureThreshold: 3
          resources:
            requests:
              cpu: "250m"
              memory: "512Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
```

The same structure handles failure. A bad manifest fails at the API server. Missing capacity shows up in scheduler events. A private image problem shows up in node and runtime events. A database outage shows up through readiness, logs, and application metrics. A node upgrade uses cordon, drain, replacement scheduling, and readiness to keep the platform serving customers.

That is the core of control plane and worker nodes. The control plane accepts, stores, decides, and coordinates. Worker nodes pull images, start containers, run probes, report status, and carry traffic. Kubernetes works well in production because those responsibilities stay separated and communicate through the API.

![Control plane and worker node summary showing API server, etcd, controllers, scheduler, kubelet, container runtime, Services, readiness, and operations evidence around notification-api](/content-assets/articles/article-containers-orchestration-kubernetes-fundamentals-control-plane-and-worker-nodes/control-plane-node-summary.png)
*The control plane coordinates through the API, and worker nodes perform the local runtime work that makes the application real.*

## What's Next

This article focused on the components that cooperate inside a cluster. The next article goes deeper into **desired state and reconciliation**, which is the Kubernetes pattern behind Deployments, ReplicaSets, node health, and many higher-level tools.

That topic makes controllers more concrete. You will see how Kubernetes keeps comparing the requested state with the observed state, why it keeps retrying after failures, and how that loop changes the way you deploy, scale, and recover applications like the Customer Notification Platform.

---

**References**

- [Kubernetes Components](https://kubernetes.io/docs/concepts/overview/components/)
- [The Kubernetes API](https://kubernetes.io/docs/concepts/overview/kubernetes-api/)
- [Nodes](https://kubernetes.io/docs/concepts/architecture/nodes/)
- [kubelet](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/)
- [Container Runtimes](https://kubernetes.io/docs/setup/production-environment/container-runtimes/)
- [Kubernetes Scheduler](https://kubernetes.io/docs/concepts/scheduling-eviction/kube-scheduler/)
- [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/)
- [Operating etcd clusters for Kubernetes](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/)
