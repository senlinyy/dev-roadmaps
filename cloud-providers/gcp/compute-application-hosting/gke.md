---
title: "GKE"
description: "Understand the Google Kubernetes Engine fit for containers that need Kubernetes as their operating layer."
overview: "GKE is Kubernetes-shaped compute on GCP through core vocabulary, Autopilot and Standard modes, rollout flow, identity, networking, policy, and tradeoffs against simpler runtimes."
tags: ["gcp", "gke", "kubernetes", "containers", "pods"]
order: 5
id: article-cloud-providers-gcp-compute-application-hosting-gke
aliases:
  - google-kubernetes-engine
  - kubernetes-on-gcp
  - gke-autopilot
---

## Table of Contents

1. [Why Do Containers Lead to Kubernetes?](#why-do-containers-lead-to-kubernetes)
2. [How Do Clusters, Control Planes, Nodes, and Scheduling Work?](#how-do-clusters-control-planes-nodes-and-scheduling-work)
3. [How Do Pods, Deployments, Services, and Routes Work Together?](#how-do-pods-deployments-services-and-routes-work-together)
4. [How Do Rollouts, Health Checks, and Scaling Repair Reality?](#how-do-rollouts-health-checks-and-scaling-repair-reality)
5. [How Do Autopilot and Standard Divide Responsibility?](#how-do-autopilot-and-standard-divide-responsibility)
6. [How Does a Multi-Service Platform Handle State, Identity, and Secrets?](#how-does-a-multi-service-platform-handle-state-identity-and-secrets)
7. [How Do Sidecars, Policies, and Controllers Extend Kubernetes?](#how-do-sidecars-policies-and-controllers-extend-kubernetes)
8. [When Should a Team Choose GKE?](#when-should-a-team-choose-gke)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

An application might depend on Python 3.13, exact Python packages, ImageMagick, Linux libraries, configuration, and its own code. Installing that stack manually on every server creates drift: one machine receives library version 1.8, another gets 1.9, and a third misses a package.

A **container image** packages the application, runtime, libraries, and supporting files as one repeatable artifact. A team can ask a platform to run `orders-api:v17` instead of finding a machine and recreating its environment by hand. Containers solve packaging and portability.

The image is a template rather than a running copy. A registry can hold `orders-api:v17`, while several container processes created from that image execute on different machines. Rebuilding the image as `v18` creates a new package; it does not reach into existing containers and mutate their files. That versioned, reproducible artifact gives an orchestrator something precise to place and replace.

They do not solve coordination by themselves. Fifty services with five copies each already produce 250 containers. Someone must place them on machines, replace them when a process or machine dies, keep the requested number running, make services discoverable, introduce new versions, add capacity, enforce restrictions, and support many teams sharing infrastructure.

Keep these questions in view as you work through the lesson:

1. **Why Do Containers Lead to Kubernetes?**
2. **How Do Clusters, Control Planes, Nodes, and Scheduling Work?**
3. **How Do Pods, Deployments, Services, and Routes Work Together?**
4. **How Do Rollouts, Health Checks, and Scaling Repair Reality?**
5. **How Do Autopilot and Standard Divide Responsibility?**
6. **How Does a Multi-Service Platform Handle State, Identity, and Secrets?**
7. **How Do Sidecars, Policies, and Controllers Extend Kubernetes?**
8. **When Should a Team Choose GKE?**

## Why Do Containers Lead to Kubernetes?
<!-- section-summary: Containers make application environments portable, and Kubernetes continually coordinates large numbers of those packages against declared desired state. -->

Manually assigning 30 containers across five nodes works only until a node fails, traffic doubles, or a rollout must be reversed. At that moment, a human must remember what disappeared, find spare capacity, test placement constraints, create replacements, and prove that enough replicas remain available.

The desired request is much simpler: “Run three healthy, interchangeable copies of `orders:v17`; the exact machines are an implementation detail.” **Kubernetes** is an orchestration system that accepts declarations like that and continually moves actual state toward them. **Google Kubernetes Engine**, or **GKE**, is Google's managed Kubernetes service.

The deepest mechanism is a **control loop**. If desired replicas equal three and actual replicas equal two, the controller creates another. If four exist, it removes one. Then it observes again.

```text
declared desired state
        |
compare with observed state
        |
calculate difference
        |
take corrective action
        `----> repeat
```

A thermostat compares desired and actual temperature and turns heating on or off. Kubernetes controllers apply the same pattern to resources. This reconciliation idea explains failure replacement, scaling, rollouts, and custom automation.

The loop also explains why the declarative record matters more than the individual container. If a human starts one extra process directly on a node, the declared replica count has not changed. A controller can later remove the excess. If a human deletes one managed Pod, the declared replica count still says three, so a replacement appears. Operators work with the declaration and controller status instead of treating temporary runtime objects as the source of truth.

Desired state does not mean the system reaches the target instantly or under every possible condition. A Pod can remain pending because no node has enough memory, an image can fail to download, or a readiness probe can keep a new replica out of service. Reconciliation keeps trying and records evidence about the gap. The operator's job becomes understanding why actual state cannot currently converge.

Kubernetes and GKE are not synonyms. Kubernetes is the open-source orchestration technology defining Pods, Deployments, Services, StatefulSets, Jobs, Ingress, ConfigMaps, Secrets, controllers, and the Kubernetes API. GKE combines those concepts with a Google-operated control plane, Compute Engine infrastructure, Google Cloud networking, IAM and storage integrations, logging and monitoring, upgrades, and security tooling.

```text
Kubernetes -> orchestration technology and API
GKE        -> Google's managed Kubernetes platform
```

![GKE gives many containerized workloads one shared Kubernetes platform API and policy vocabulary](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gke/gke-platform-api.png)

*A team reaches for GKE when Kubernetes itself is part of the operating contract, not merely because the application uses a container.*

## How Do Clusters, Control Planes, Nodes, and Scheduling Work?
<!-- section-summary: A cluster defines the orchestration boundary, the control plane stores and reconciles intent, nodes execute Pods, and the scheduler chooses suitable placement. -->

Kubernetes needs a boundary around the resources it coordinates. A **cluster** is that universe. It includes a control plane and worker machines called nodes. Inside the boundary, Kubernetes can answer which workloads exist, where they should run, whether they are healthy, how they communicate, and who may change them.

```text
GKE cluster
|-- control plane
`-- worker nodes
    |-- Node A
    |-- Node B
    `-- Node C
```

A **node** is a machine capable of running containers. In ordinary GKE infrastructure, nodes are backed by Compute Engine VMs. Each node runs a container runtime, Kubernetes networking components, system agents, workloads, and a node agent called the **kubelet**. The kubelet receives the Pod specification assigned to its node and ensures that the requested containers actually run there.

The **control plane** keeps a global view. It exposes the Kubernetes API, stores cluster state, runs controllers, schedules workloads, and coordinates the cluster. In GKE, Google manages that control plane instead of requiring the application team to install and operate it.

```text
              control plane
     +-----------------------------+
     | Kubernetes API              |
     | scheduler                    |
     | controllers                  |
     | cluster-state storage        |
     +--------------+--------------+
                    |
             +------+------+
             v      v      v
           Node A Node B Node C
```

Control-plane and node responsibilities are distinct. The control plane decides and records what should happen. The kubelet and node runtime make that assigned state real on one machine.

**Scheduling** selects a node for each Pod. Suppose three requested Pods each need two CPUs and 4 GiB of memory. Node A has eight CPUs and 12 GiB free, Node B has one CPU and 20 GiB free, and Node C has four CPUs and 8 GiB free. The scheduler can place two Pods on A and one on C. Node B lacks the required CPU even though it has abundant memory.

Workloads can declare more than CPU and RAM. A Pod may require a GPU, a chosen zone, an anti-affinity rule that separates replicas, a preference for a labeled node, or eight GiB of memory. Kubernetes compares these requests and constraints with the available node set.

This is why Kubernetes is more than Docker running on several servers. Containers supply artifacts and processes. Kubernetes adds an API, persistent desired state, scheduling, controllers, discovery, rollout mechanics, and policy around many containerized workloads.

In GKE Standard, the team sees and configures more of the node layer. In GKE Autopilot, Google takes on more of the worker infrastructure. Both modes still use the cluster, API, Pod, scheduling, and reconciliation model.

## How Do Pods, Deployments, Services, and Routes Work Together?
<!-- section-summary: Pods run tightly coupled containers, Deployments maintain replicas, Services hide Pod churn, and Ingress or Gateway routes external HTTP traffic. -->

Kubernetes normally schedules a **Pod**, not a bare container. The common Pod contains one application container. A Pod can also contain multiple containers that genuinely belong in one execution unit, such as an application and a proxy sidecar. Containers in the same Pod share networking, can communicate through localhost, can share volumes, and live within a common lifecycle context.

A useful definition is: a Pod is Kubernetes's logical host for one tightly coupled application unit. It is not simply another name for a container.

The shared network namespace means every container in the Pod reaches the others through localhost and shares the Pod IP. That is useful for a proxy or helper that belongs to the same execution unit. It also means the containers are scheduled together rather than placed independently across nodes. If two components should scale, update, or fail independently, they usually belong in separate Pods connected through a Service instead of being combined only for convenience.

Pods are disposable. When `orders-pod-abc123` dies, operators normally do not repair that exact object. A controller creates another Pod, perhaps with a different name and on a different node. Pod identity is therefore different from the identity of a long-lived server.

Creating a Pod directly does not tell Kubernetes that a replacement must exist after deletion. A higher-level workload object supplies that policy. A **Deployment** declares a Pod template and a replica count for interchangeable application copies.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders
spec:
  replicas: 3
  # Pod template follows
```

Conceptually, the Deployment manages ReplicaSets, which create and maintain Pods:

```text
Deployment
    |
ReplicaSet
    |
    +-- Pod
    +-- Pod
    `-- Pod
```

The objects answer different questions. The container image packages `orders:v17`. A Pod is one running logical instance. A Deployment states that three interchangeable copies should continue to exist.

The Pod template inside the Deployment is the bridge between versioned packaging and runtime state. It names the image, resource needs, labels, service account, volumes, and health probes for every replica. Changing that template creates a new rollout because the desired definition of a replica changed. Changing only the replica count asks the same template to exist more or fewer times.

Disposable Pods create a networking problem because their addresses change. An orders Deployment might currently use Pod IPs `10.2.1.4`, `10.2.5.9`, and `10.2.8.3`; a replacement can appear at `10.2.3.17`. Callers cannot safely hard-code those addresses.

A Kubernetes **Service** gives a logical set of Pods one stable network identity. Checkout calls the `orders` Service, and the Service sends traffic to matching ready Pods. The Deployment keeps compute replicas alive; the Service makes the changing replica set reachable through a stable name and virtual endpoint.

Kubernetes commonly connects these objects with **labels** and selectors. Orders Pods carry `app=orders`, and the Service selects `app=orders`. Selection by declared properties replaces a list of fixed machine identities.

The label contract must agree across objects. If the Deployment template labels Pods `app=order-api` while the Service selects `app=orders`, both resources can exist and look healthy in isolation while the Service has no endpoints. A beginner-friendly debugging sequence therefore reads the Deployment's Pod labels, the Service selector, and the selected endpoint set together. Stable networking depends on that relationship, not on the resource names merely looking similar.

Internal service-to-service networking still does not bring public users into the cluster. For HTTP and HTTPS traffic, an **Ingress** can declare host and path routes to Services. The Ingress object is configuration; an Ingress controller watches it and configures the actual load-balancing or routing infrastructure.

```text
internet
   |
Ingress or Gateway
   |-- shop.example.com/          -> frontend Service
   |-- shop.example.com/api/orders -> orders Service
   `-- admin.example.com/          -> admin Service
```

Ingress remains common and supported, but the Kubernetes project has frozen that API and directs new feature development to **Gateway API**, a newer and more expressive traffic-routing model. Existing systems still make Ingress essential vocabulary.

![A Deployment maintains Pods, a Service gives them one stable name, and Ingress or Gateway carries customer traffic](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gke/kubernetes-request-rollout-path.png)

*The request path and the rollout path meet at ready Pods selected behind the Service.*

These resources are created through the **Kubernetes API**. `kubectl` is a client rather than the platform's core. Applying a manifest asks the API to make those declarations part of cluster desired state. Controllers then decide which lower-level actions move reality toward that state.

This API-centered model allows several clients to use the same contract. A person can apply YAML with `kubectl`, a continuous-delivery system can update an image field, and a custom controller can create related objects. All of them submit or read Kubernetes resources through the API. The API stores intent and reports status; the command-line tool is only one interface to it.

It also separates a resource definition from the controller that makes it effective. An Ingress object is stored desired routing configuration, while an Ingress controller builds the actual traffic path. A Deployment is desired replica and rollout configuration, while Deployment and ReplicaSet controllers produce Pods. When an object exists but behavior is missing, ask which controller owns reconciliation and what its status or events report.

## How Do Rollouts, Health Checks, and Scaling Repair Reality?
<!-- section-summary: Declarative updates, health probes, controllers, and autoscalers replace failing capacity and introduce new versions without preserving individual Pods or nodes. -->

Traditional administration can be a sequence of commands: start server 4, install the application, copy configuration, restart a service, and create another instance. Kubernetes encourages a **declarative** model. The team states that replicas equal four and the image should be `orders:v18`; controllers work out the steps.

A Deployment rollout follows naturally from desired state. If three Pods run v17 and the Pod template changes to v18, Kubernetes gradually creates v18 replicas and removes v17 replicas rather than stopping all capacity at once.

```text
v17 v17 v17
    |
v17 v17 v18
    |
v17 v18 v18
    |
v18 v18 v18
```

Process existence alone is insufficient. A v18 container can be running while unable to reach its database. Kubernetes health probes let the kubelet and routing layer reason about application condition.

- **Readiness** asks whether the Pod should receive traffic. An unready Pod stays out of Service endpoints.
- **Liveness** asks whether a badly stuck process should be restarted.
- **Startup** gives a slow-starting application time before other probes judge it.

Readiness makes a rolling update meaningful because new replicas should enter the request path only after they can serve. Liveness and startup address different lifecycle problems and should not be treated as interchangeable success checks.

A normal release path builds source into a container image, stores it in Artifact Registry, updates the Deployment image through the API, and lets the Deployment controller perform rolling replacement. Operators can watch:

```bash
kubectl rollout status deployment/orders
kubectl get pods
kubectl get services
kubectl describe deployment orders
kubectl logs POD_NAME
```

`kubectl rollout status` reports rollout progress and completion or a progress-deadline problem. Verification should go beyond a `READY` count. A real request must cross external routing, the Service, a new Pod, and the application's database or API dependencies before producing the correct response.

![Rollout evidence combines Deployment state, available replicas, Pod readiness, Service and ingress paths, events, and logs](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gke/gke-rollout-evidence.png)

*Infrastructure readiness is necessary, and the end-to-end application path proves whether the release actually works.*

Failure recovery uses the same desired-state mechanism. If a node carrying `orders-1` and `checkout-1` fails, actual replicas fall below their Deployment targets. After the system detects the failure, replacement Pods can be scheduled on surviving capacity. Applications are restored by replacement rather than by preserving the dead node.

There can be a period between node failure and replacement. The control plane must detect that the node is unavailable, mark affected workloads accordingly, and find eligible capacity elsewhere. During that interval, the Service sends traffic only to endpoints considered ready. Maintaining several replicas across suitable failure domains reduces the impact, while a single replica remains a single application-capacity risk even though Kubernetes can eventually recreate it.

Scaling has two separate layers. The **Horizontal Pod Autoscaler** can raise or lower the desired number of application Pods according to observed demand. A Deployment might move from three replicas to twenty. If current nodes can fit only fourteen, six remain pending and the infrastructure layer needs more capacity.

```text
application capacity -> number of Pods
infrastructure capacity -> number and size of nodes
```

Pod autoscaling changes application copies. Cluster or node scaling changes worker-machine capacity. Confusing them can leave an autoscaler requesting Pods that the cluster has nowhere to place. GKE's operating mode changes how directly the team manages that lower layer.

Resource requests connect the two layers. The scheduler uses requested CPU and memory when deciding whether a Pod fits, and the node-scaling layer uses unschedulable demand as evidence that more infrastructure may be required. Requests set too low can pack workloads tightly and cause runtime contention; requests set far above real need can make healthy capacity appear unavailable. Autoscaling can only act sensibly on the declarations and measurements it receives.

Scaling down also has consequences. Removing application replicas reduces request capacity, and removing nodes requires their workloads to move. Desired-state systems coordinate these changes, but the application must still handle termination, drained connections, and replacement without relying on one Pod's memory or local filesystem.

## How Do Autopilot and Standard Divide Responsibility?
<!-- section-summary: Standard leaves the team substantial worker-node control, while Autopilot manages more node provisioning and configuration from workload resource requests. -->

GKE always manages the Kubernetes control plane. The main operating-mode question is how much the team should care about worker nodes.

In **GKE Standard**, the team retains direct control and substantial responsibility for node infrastructure. Engineers choose node pools, machine types, node counts, autoscaling configuration, hardware placement, node settings, and upgrade strategies. The workload uses Kubernetes, but node design remains a visible platform concern.

```text
Google -> managed control plane
team   -> Kubernetes workloads plus substantial node decisions
```

Standard is appropriate when the platform needs particular node configurations, unusual privileged behavior, precise pool management, specialized hardware treatment, or other infrastructure constraints that require that control.

In **GKE Autopilot**, the team works more directly from Pod requirements. A workload requests two CPUs and 4 GiB of memory, and GKE provisions and manages much of the node infrastructure required to run it. Google currently recommends Autopilot for most workloads and manages nodes, scaling, security defaults, and other infrastructure settings.

```text
Standard
Pod requests -> team designs node pools -> nodes -> Google infrastructure

Autopilot
Pod requests -> GKE provisions and manages infrastructure
```

Autopilot does not remove Kubernetes. Teams still use Pods, Deployments, Services, namespaces, policies, the Kubernetes API, and Kubernetes networking. It removes more node-management work.

The choice follows a general abstraction rule. More management by Google means fewer low-level decisions for the team. That is usually valuable until a hidden or restricted detail is precisely what the workload needs to control. Google guidance positions Autopilot as the default for most production workloads and Standard for requirements that need deeper node-level flexibility.

Autopilot also helps clarify the two scaling layers. Application engineers still describe Pod resource requests and replica behavior. GKE takes more responsibility for ensuring that underlying capacity exists. In Standard, a platform team has a more direct role in node-pool design and scaling boundaries.

Neither mode removes the need for correct workload requests, health probes, identity, networking, rollout verification, or application observability. The operating mode changes the node boundary, not the application team's responsibility for declaring and validating the distributed system.

Mode choice should therefore begin with concrete constraints rather than a preference for seeing nodes. List every requirement that depends on node-pool design, privileged behavior, hardware placement, or a configuration unavailable in Autopilot. If no requirement survives that review, Autopilot's managed defaults remove an infrastructure layer the team would otherwise have to size, secure, scale, and upgrade. If a requirement does survive, Standard exposes the layer needed to implement it.

The choice also affects incident ownership. In Standard, a pending Pod can lead the platform team directly into node-pool capacity, machine types, and autoscaler configuration. In Autopilot, the team begins with workload requests, scheduling events, and supported platform constraints while Google manages the underlying worker fleet. In both cases, Kubernetes status and events explain the gap between desired and actual state.

## How Does a Multi-Service Platform Handle State, Identity, and Secrets?
<!-- section-summary: A GKE platform combines independent Deployments and Services while using specialized workload objects, federated identity, and external secret storage where needed. -->

Consider an online shop with frontend, orders, payments, inventory, and recommendations services. Each has its own container image and desired replica count. The frontend Deployment might maintain six Pods behind a frontend Service. Orders might maintain four Pods behind an internal `orders` Service. Payments might use three replicas behind a Service that is reachable only inside the application network. Recommendations may declare a GPU requirement so the scheduler chooses appropriate infrastructure.

Each component can express a different runtime contract inside the same platform. The frontend needs external routing and horizontal replicas. Orders needs a stable internal name so frontend Pods never learn Pod IPs. Payments can remain internal and accept calls only through the application path. Recommendations can ask for specialized hardware without every service using that hardware. Kubernetes provides one API vocabulary while preserving separate workload declarations.

```text
internet
   |
Gateway or Ingress
   |
frontend Service
   |
frontend Pods
   |
orders Service
   |
orders Pods
   |-- payments Service
   `-- inventory Service
```

The abstraction boundaries remain clear. Deployments manage execution lifecycle for interchangeable replicas. Services provide stable service-to-service destinations. Gateway or Ingress handles outside-to-inside HTTP routing. Placement remains an implementation detail controlled by resource requests and scheduling rules.

Not every workload has interchangeable state. Frontend replicas can usually be replaced freely. A database may require stable names such as `db-0`, `db-1`, and `db-2`, stable disks, and ordered startup. A **StatefulSet** manages workloads whose identity, persistent storage, or ordering matters. A Deployment says, “Maintain N interchangeable copies.” A StatefulSet says, “Maintain N copies whose individual identities and state matter.”

GKE can therefore host a wider range of distributed systems than a simple stateless HTTP platform, but stateful orchestration adds operational responsibility for data, replication, backup, and recovery.

Workloads also need Google Cloud identity. Putting a service-account JSON key in a container forces the team to store, protect, rotate, and prevent leaks of a long-lived credential. **Workload Identity Federation for GKE** connects a workload's Kubernetes identity to short-lived Google Cloud credentials and IAM authorization.

```text
Pod
  |
Kubernetes ServiceAccount
  |
Workload Identity Federation for GKE
  |
Google Cloud IAM
  |
Cloud Storage, Pub/Sub, or another API
```

A **Kubernetes ServiceAccount** gives the workload an identity within Kubernetes. Google Cloud IAM governs authorization to Google Cloud resources. Federation bridges those two identity systems instead of distributing static Google keys.

Secret values are a separate concern from permissions. A database password, Stripe key, TLS certificate, or vendor token must be delivered as data. Kubernetes has a Secret resource, and Google Cloud provides Secret Manager. The GKE Secret Manager add-on can use the CSI integration to mount Secret Manager values into Pods as volumes, with access authorized through workload identity.

This separates three concerns:

```text
container image -> application artifact
IAM             -> what the workload may access
Secret Manager  -> sensitive values supplied at runtime
```

Secrets should not be baked into the image. Identity authorizes retrieval, while the secret service owns the value's lifecycle. The multi-service platform can then give each workload a narrow identity and only the secrets its own job requires.

## How Do Sidecars, Policies, and Controllers Extend Kubernetes?
<!-- section-summary: Pods can include supporting sidecars, admission policy can reject unsafe declarations, and custom resources plus controllers add organization-specific desired-state APIs. -->

Some supporting behavior belongs close to an application but should not be implemented inside every codebase. A proxy, certificate helper, log transformer, security agent, or data synchronizer can run as a **sidecar** beside the application container in one Pod.

```text
Pod
|-- orders application
`-- proxy sidecar

orders -> localhost -> proxy -> network
```

The containers share the Pod's network and can share volumes and lifecycle context. Sidecars let infrastructure functionality accompany the application without modifying its main binary. They also add hidden operational behavior to every Pod, so teams must understand resource use, startup ordering, logging, and failure interaction.

Shared clusters create governance problems. Hundreds of developers can accidentally request privileged host access, run as root, use an unapproved image, omit required labels, or ask for unreasonable CPU. Documentation alone does not reliably enforce dozens of rules.

**Admission policy** checks objects as they enter the Kubernetes API. A compliant Deployment is accepted; a violation is rejected. GKE Policy Controller can enforce constraints on new requests and audit existing resources. This turns important platform rules from reminders into executable controls.

```text
developer submits resource
        |
Kubernetes API admission
        |
policy evaluation
    | accepted -> store desired state
    ` rejected -> report violation
```

Kubernetes can also add new API types. Suppose the company repeatedly creates a database together with replication, backup schedules, Services, credentials, and monitoring. Developers might prefer to declare:

```yaml
kind: CompanyDatabase
spec:
  size: medium
  backups: daily
  replicas: 3
```

`CompanyDatabase` is not a built-in resource. A **Custom Resource Definition**, or CRD, teaches the Kubernetes API to store and validate that new type. The data alone does not create a database, so a **custom controller** watches the resource, compares desired and actual state, and creates or updates StatefulSets, Services, backup resources, and monitoring.

This extends the same reconciliation loop that powers Deployments. An **operator** packages human operational knowledge into controller logic. For a PostgreSQL cluster, the controller can provision volumes, configure replicas, schedule backups, detect failure, promote a replica, and repair topology in response to one declarative resource.

The CRD defines the language available to users, while the controller gives that language behavior. Creating a `CompanyDatabase` object when no controller watches it stores desired data but provisions nothing. Running the controller without a well-defined resource gives it no durable declaration to reconcile. The useful platform abstraction requires both pieces and status fields that explain current progress back to the user.

Controller code also becomes production infrastructure. A bug in an ordinary command may affect one invocation; a bug in a continuously running controller can repeatedly make the wrong change. Platform teams therefore treat controller permissions, upgrade compatibility, observability, and failure behavior as part of the cost of an extension.

Kubernetes is therefore more than a container scheduler. It is an extensible desired-state automation platform. That power supports rich internal platforms and ecosystems, and it also increases the number of APIs, controllers, upgrade paths, and failure modes a team must understand.

By this point the platform vocabulary may include clusters, nodes, Pods, Deployments, ReplicaSets, Services, Gateway or Ingress, namespaces, ConfigMaps, Secrets, ServiceAccounts, RBAC, network policy, autoscaling, StatefulSets, persistent volumes, admission policy, CRDs, controllers, and operators. That accumulated surface is Kubernetes's strength and its cost.

## When Should a Team Choose GKE?
<!-- section-summary: GKE is justified when the team needs Kubernetes-level orchestration and extension; simpler application hosting is preferable when those controls are not requirements. -->

If the complete requirement is “run this stateless HTTP container and scale it with requests,” Cloud Run offers a much smaller surface: container, service, and URL. GKE adds a cluster, Deployment, Pod, Service, routing, Kubernetes permissions, autoscaling, and potentially node capacity. Those concepts are overhead when the application does not use the control they provide.

GKE fits requirements that include complex microservice topology, Kubernetes APIs, stateful workloads, advanced networking, custom placement, special hardware, cluster-wide policy, sidecars or service meshes, custom controllers and operators, specialized platform tooling, or deep infrastructure control.

The comparison is really about who orchestrates. With Compute Engine, the team is close to VMs, operating systems, and processes or containers. With GKE, the team supplies Kubernetes desired state and GKE orchestrates it onto nodes. With Cloud Run, the team supplies application or container configuration and Google's platform orchestrates the infrastructure without exposing a cluster.

```text
Compute Engine -> machine and OS control
GKE            -> Kubernetes platform control
Cloud Run      -> managed application execution
```

Start with the simplest abstraction that meets actual requirements. A normal HTTP API often deserves Cloud Run consideration first. Kubernetes networking, custom controllers, stateful orchestration, specialized scheduling, platform policy, and deep cluster customization make GKE meaningful. Direct ordinary-machine control points back to Compute Engine.

To see the whole GKE flow, return to the online shop. Source code becomes versioned container images in Artifact Registry. A GKE cluster provides a Google-managed control plane and nodes, with Autopilot managing more of those underlying node resources. Deployments declare images and replica counts for frontend, orders, payments, and other services.

The scheduler places Pods according to capacity and constraints. Services hide Pod churn behind stable names. Gateway or Ingress sends internet requests to the frontend Service. Workload Identity Federation connects each Kubernetes ServiceAccount to Google IAM permissions, and Secret Manager supplies sensitive values to authorized Pods.

Controllers continually repair reality. A missing orders Pod is replaced because desired replicas exceed actual replicas. A failed node causes workloads to be scheduled elsewhere. Changing `orders:v12` to `orders:v13` updates desired state, and the Deployment controller performs a rolling replacement while readiness controls when new Pods receive traffic.

Verification checks Deployment progress, Pod health, Service endpoints, logs, metrics, external routing, and downstream dependencies. A successful `kubectl apply` proves only that the API accepted the declaration; it does not prove the customer request path.

Rollback follows the same declarative history. If `orders:v13` never becomes ready or produces unacceptable application results, the team can restore the previous Deployment revision and let controllers reconcile back toward the older Pod template. Readiness keeps broken replacement Pods away from the Service while the rollout is evaluated, but the team still needs revision-aware logs and a real request to decide whether the business behavior is acceptable.

That final distinction matters: reconciliation proves that Kubernetes can produce the declared objects; it cannot decide whether version 13 calculates the right total. Platform evidence and application evidence complete different parts of the release decision.

The core concepts can be compressed into their questions:

| Concept | Question it answers |
|---|---|
| **Container** | How is the software environment packaged consistently? |
| **Kubernetes** | How are large numbers of containers orchestrated? |
| **GKE** | Who manages Kubernetes infrastructure on Google Cloud? |
| **Cluster** | Which resources belong to one orchestration boundary? |
| **Control plane** | Who stores desired state and coordinates the system? |
| **Node** | Which worker machine executes workloads? |
| **Scheduler** | Which suitable node should receive a Pod? |
| **Pod** | What is the smallest schedulable execution unit? |
| **Deployment** | How many interchangeable copies should remain running? |
| **Service** | How do callers reach Pods through one stable identity? |
| **Ingress or Gateway** | How does external HTTP traffic enter and route? |
| **Probe** | Is a running process actually usable? |
| **Autoscaling** | How should Pod and node capacity change? |
| **Workload Identity** | Which Google Cloud permissions does a workload receive? |
| **Secret Manager** | Where should sensitive values live? |
| **Sidecar** | How can supporting functionality accompany an application? |
| **Policy Controller** | Which declarations should the cluster reject? |
| **CRD and controller** | How can Kubernetes gain a new declarative resource and automate it? |
| **Autopilot** | Can Google manage most worker-node infrastructure? |
| **Standard** | Does the team need deeper worker-node control? |

The reason to choose GKE is not that containers inherently require Kubernetes. It is that a sufficiently complex system benefits from one programmable control system that continually coordinates containers, machines, networks, policies, identities, stateful services, and deployments as a shared platform.

The platform must still be operated as a product for its users. Application teams need a reliable API, clear namespace and policy boundaries, working image and deployment paths, useful status and logs, and a documented way to request special capacity. Kubernetes supplies the programmable mechanisms; a platform team turns them into a coherent shared service.

That decision should be revisited as the system changes. A team can begin with a simpler managed runtime and adopt GKE when concrete Kubernetes requirements appear, or move an independently scalable service out of a cluster when it no longer benefits from the shared platform controls.

## Check Your Answers

:::expand[Why Do Containers Lead to Kubernetes?]{kind="recap"}
Containers package application environments consistently. Kubernetes is useful for many containers that need continuous placement, replacement, scaling, discovery, rollout, and policy through desired-state reconciliation.
:::

:::expand[How Do Clusters, Control Planes, Nodes, and Scheduling Work?]{kind="recap"}
A cluster defines the orchestration boundary. The control plane stores intent and coordinates controllers, nodes run Pods through kubelet, and the scheduler chooses placements that satisfy resource and policy constraints.
:::

:::expand[How Do Pods, Deployments, Services, and Routes Work Together?]{kind="recap"}
Pods run tightly coupled containers, Deployments maintain interchangeable Pod replicas, Services give changing Pods stable names, and Ingress or Gateway routes external HTTP traffic.
:::

:::expand[How Do Rollouts, Health Checks, and Scaling Repair Reality?]{kind="recap"}
Controllers roll desired images forward, probes decide whether Pods should start or receive traffic, failure replacement restores replica counts, and Pod and node scaling adjust different capacity layers.
:::

:::expand[How Do Autopilot and Standard Divide Responsibility?]{kind="recap"}
Standard leaves the team direct node-pool and worker-infrastructure control. Autopilot manages more node provisioning and configuration while the team still uses Kubernetes APIs and workload resources.
:::

:::expand[How Does a Multi-Service Platform Handle State, Identity, and Secrets?]{kind="recap"}
Deployments and Services organize stateless components, StatefulSets handle stable identity and storage needs, Workload Identity Federation supplies short-lived Google credentials, and Secret Manager supplies sensitive values.
:::

:::expand[How Do Sidecars, Policies, and Controllers Extend Kubernetes?]{kind="recap"}
Sidecars colocate support processes, admission policy enforces cluster rules, and CRDs plus custom controllers add organization-specific resources and reconciliation through the operator pattern.
:::

:::expand[When Should a Team Choose GKE?]{kind="recap"}
Choose GKE when Kubernetes-level networking, policy, scheduling, stateful orchestration, sidecars, or extensions are real requirements. Prefer a simpler managed runtime when the workload only needs straightforward application hosting.
:::

## References

- [GKE overview](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/kubernetes-engine-overview) - Official managed Kubernetes and operating-mode overview.
- [Kubernetes controllers](https://kubernetes.io/docs/concepts/architecture/controller/) - Official desired-state reconciliation model.
- [GKE cluster architecture](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/cluster-architecture?authuser=0) - Official control plane, node, kubelet, and Google responsibility model.
- [Kubernetes Pods](https://kubernetes.io/docs/concepts/workloads/pods/) - Official Pod definition and colocated-container behavior.
- [Kubernetes Services](https://kubernetes.io/docs/concepts/services-networking/service/) - Official stable networking for changing Pods.
- [Kubernetes workload management](https://kubernetes.io/docs/concepts/workloads/controllers/) - Official guidance to use workload controllers instead of bare Pods.
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Official ReplicaSet, rollout, and status behavior.
- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) - Official Ingress behavior and Gateway API direction.
- [Kubernetes Pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) - Official readiness, liveness, and startup probe behavior.
- [GKE Autopilot](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview?authuser=0000&hl=en) - Official managed-node responsibilities and recommendation.
- [Choose a GKE mode](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/choose-cluster-mode?authuser=3) - Official Autopilot and Standard comparison.
- [Kubernetes StatefulSets](https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/) - Official stable identity, storage, and ordered behavior.
- [Workload Identity Federation for GKE](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/workload-identity?authuser=77) - Official Kubernetes-to-Google identity model.
- [Secret Manager add-on for GKE](https://docs.cloud.google.com/secret-manager/docs/secret-manager-managed-csi-component?authuser=6&hl=en) - Official CSI-mounted Secret Manager integration.
- [Kubernetes sidecars](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/) - Official sidecar-container model.
- [GKE Policy Controller](https://docs.cloud.google.com/kubernetes-engine/policy-controller/docs) - Official constraint enforcement and audit behavior.
- [Kubernetes custom resources](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/) - Official CRD, controller, and operator pattern.
- [What is Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run) - Official simpler managed-container alternative.
- [GKE and Cloud Run](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gke-and-cloud-run?hl=en) - Official comparison of application and Kubernetes orchestration.
- [Choose Google Cloud compute options](https://docs.cloud.google.com/docs/compute-area/choose-compute-options) - Official guidance across Cloud Run, GKE, and Compute Engine.
