---
title: "What Is GCP Compute"
description: "Choose where application code should run in GCP by matching workload shape to Cloud Run, Compute Engine, Cloud Run functions, and GKE."
overview: "Compute is the GCP layer where your code gets CPU, memory, runtime startup, scaling, identity, logs, and a production operating path."
tags: ["gcp", "compute", "cloud-run", "compute-engine", "gke"]
order: 1
id: article-cloud-providers-gcp-compute-application-hosting-gcp-compute-hosting-mental-model
aliases:
  - gcp-compute-and-hosting-mental-model
  - choosing-the-right-gcp-runtime
  - article-cloud-providers-gcp-compute-application-hosting-choosing-right-gcp-runtime
  - cloud-providers/gcp/compute-application-hosting/gcp-compute-and-hosting-mental-model.md
  - cloud-providers/gcp/compute-application-hosting/choosing-the-right-gcp-runtime.md
---

## Table of Contents

1. [What Does Compute Give a Program?](#what-does-compute-give-a-program)
2. [How Does Machine-Shaped Compute Work?](#how-does-machine-shaped-compute-work)
3. [How Does Application-Shaped Compute Work?](#how-does-application-shaped-compute-work)
4. [How Do Functions and Jobs Handle Other Work Shapes?](#how-do-functions-and-jobs-handle-other-work-shapes)
5. [When Does a Kubernetes Platform Make Sense?](#when-does-a-kubernetes-platform-make-sense)
6. [What Problems Must Every Runtime Solve?](#what-problems-must-every-runtime-solve)
7. [Can One Application Use Several Compute Products?](#can-one-application-use-several-compute-products)
8. [How Do You Choose the Right Runtime?](#how-do-you-choose-the-right-runtime)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

At its simplest, **compute** means a place where a program's instructions can execute. The language can be Python, Java, Go, C++, JavaScript, Rust, or something else. Eventually the program needs the same physical ingredients: CPU executes instructions, memory holds working data, storage holds code and state, networking carries communication, identity authenticates calls, and a lifecycle starts, stops, or restarts the process.

Your laptop already acts as a small compute platform. When you run `python app.py`, the operating system loads the executable, allocates memory, schedules CPU time, opens sockets, reads files, and terminates the process when required. A browser, local API, database, and background script can all share the same machine.

Production adds the responsibilities that a developer's laptop quietly avoids. What happens if the computer dies? Who adds capacity when 10,000 users arrive? Which component assigns an address, terminates TLS, restarts a crashed process, patches Linux, deploys a new version, collects logs, gives the program credentials, and creates additional machines?

Keep these questions in view as you work through the lesson:

1. **What Does Compute Give a Program?**
2. **How Does Machine-Shaped Compute Work?**
3. **How Does Application-Shaped Compute Work?**
4. **How Do Functions and Jobs Handle Other Work Shapes?**
5. **When Does a Kubernetes Platform Make Sense?**
6. **What Problems Must Every Runtime Solve?**
7. **Can One Application Use Several Compute Products?**
8. **How Do You Choose the Right Runtime?**

## What Does Compute Give a Program?
<!-- section-summary: Compute services provide the execution environment around code, and their main difference is where responsibility passes from your team to Google. -->

Google Cloud's compute services give different answers to those questions. **Compute Engine** exposes a machine and substantial operating-system control. **GKE** exposes Kubernetes as a programmable orchestration layer. **Cloud Run** asks primarily for an application, container, source tree, or function and hides more of the infrastructure. The main comparison is therefore a responsibility boundary: how much of the computer does your team need to manage directly?

The full stack still exists for every product:

```text
application
runtime
operating system
virtualization
physical server
network and data centre
power and cooling
```

Google always owns the lower physical layers. Each compute product draws the handoff at a different point. More exposed layers give more control and more operating work. More managed layers reduce the infrastructure visible to the application team. This is a spectrum of responsibilities, not a ranking from good to bad.

![Four workload shapes mapped to GCP runtime contracts](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gcp-compute-hosting-mental-model/runtime-contract-map.png)

*The workload's execution shape comes first; the product name follows from the contract that shape needs.*

This opening model is the spine of the module. A compute service is not merely a product label. It is a contract covering what you provide, what causes execution, what Google operates, and what your team must still operate.

## How Does Machine-Shaped Compute Work?
<!-- section-summary: Compute Engine supplies a durable computer-like VM for software that depends on an operating system and machine-level control. -->

The first workload shape asks, “Can I have a computer?” Imagine software organized around a Linux machine where systemd supervises Nginx, the application, a monitoring agent, and a custom daemon. It might require root access, intensive local-disk activity, a particular kernel or operating-system configuration, a commercial installer, unusual networking, special drivers, or dependencies that do not fit a serverless runtime.

The natural abstraction is a **virtual machine**, and Google Cloud's main VM service is Compute Engine. Google's physical infrastructure and hypervisor supply virtual hardware. Your VM boots Linux or Windows and runs the application like an ordinary remote server.

```text
Google physical infrastructure
             |
         hypervisor
             |
      virtual machine
      |-- operating system
      |-- runtime and packages
      `-- application processes
```

A request for four vCPUs, 16 GB of RAM, Debian, and a 100 GB disk is essentially a request for a computer-like environment that continues to exist. An administrator can connect with SSH, install packages, edit operating-system configuration, and use systemd to start services.

The freedom comes with the corresponding work. Your team increasingly owns guest-OS configuration, patching, package installation, process supervision, capacity planning, application recovery, and the VM's lifecycle. Google keeps responsibility for the data centre and underlying hardware.

One VM is rarely a complete production architecture. If all internet traffic reaches a single instance, losing that instance loses the service. A load balancer can distribute requests across multiple VMs, and a managed instance group can recreate unhealthy instances or adjust the group size.

```text
                 load balancer
                  /          \
                 v            v
                VM            VM
                 \            /
              managed instance group
```

Even with those managed helpers, the service remains machine-shaped. Compute Engine's primary unit is a machine. The application is software installed and operated on those machines. That makes it suitable when machine semantics are a real requirement, and unnecessarily low-level when they are not.

## How Does Application-Shaped Compute Work?
<!-- section-summary: Cloud Run accepts an application package and manages the stable endpoint, instance lifecycle, and much of scaling below it. -->

Now consider a container image named `my-api:v42`. The image packages the program, language runtime, libraries, binaries, and filesystem dependencies. The team does not care whether it runs on host 17 or host 218. It cares that an HTTP request reaches the application and receives a response.

That is application-shaped compute, and **Cloud Run** is Google's fully managed application platform for this model. Instead of asking how many machines to create, the team supplies the application and asks the platform to run enough temporary instances as requests arrive. When demand falls, Cloud Run removes instances and can eventually scale a service to zero.

```text
request
   |
Cloud Run service
   |
   +-- instance
   +-- instance
   `-- instance

demand falls -> fewer instances -> possibly zero
```

The word **serverless** describes this responsibility boundary. It does not mean that CPUs, RAM, networks, or physical servers disappeared. It means those servers sit below the layer your team normally operates. With Compute Engine, the team owns the application, runtime, guest OS, and machine configuration. With Cloud Run, the team mainly owns the application or container and service configuration while Google handles the host OS, placement, instance lifecycle, much of scaling, and physical infrastructure.

Containers and VMs are also different artifacts. A VM includes a guest operating system and virtual hardware environment. A container packages the application, runtime, libraries, and filesystem dependencies while depending on the host's kernel and container runtime. A container is therefore a strong application deployment unit, but the package alone does not choose its orchestrator.

```text
VM                              container
|-- application                |-- application
|-- libraries                  |-- libraries
|-- guest OS                   `-- packaged filesystem
`-- virtual hardware                |
                                 host kernel and runtime
```

Cloud Run is one answer to who should orchestrate the package: Google manages each application service directly. GKE offers a different answer by giving the team Kubernetes as a shared orchestration platform.

Cloud Run also changes the meaning of continuity. The stable object is the service and its URL, not one container instance. Instances may appear and disappear as demand changes. Important state therefore belongs in durable systems outside any particular instance. This replaceable-compute model is a natural fit for HTTP backends, web applications, microservices, and other containerized request-serving software.

![The responsibility boundary moves across VM, managed container, function, and Kubernetes runtimes](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gcp-compute-hosting-mental-model/responsibility-boundary.png)

*Every runtime still uses servers; the useful question is which server and platform layers remain your team's responsibility.*

## How Do Functions and Jobs Handle Other Work Shapes?
<!-- section-summary: Functions react to requests or events, while jobs perform finite work and exit instead of serving indefinitely. -->

Some programs do not naturally look like an HTTP server. Suppose an image arrives in Cloud Storage and the required reaction is to create a thumbnail. The application logic may be only a handler that downloads the object, resizes it, writes the result, and returns. There is no business requirement for a server process to wait forever.

The work shape is:

```text
state change or event
        |
run a handler
        |
finish
```

This is where **Cloud Run functions** fits. Cloud Functions 2nd gen is now named Cloud Run functions and belongs to the wider Cloud Run platform. The function model asks for a handler and a way to invoke it rather than asking the team to operate a permanent server around that handler.

An **event** is structured information that describes something that happened: an object was created, a message was published, or a database record changed. An event producer emits that fact, routing infrastructure delivers it, and the function receives fields describing the event type, resource, time, metadata, and payload. Event-driven compute is therefore code invoked because state changed rather than because a person directly requested an HTTP page.

Cloud Run services and Cloud Run functions are closer than older product names suggest. Current Cloud Run can run containers, source deployments, and functions. The useful distinction is the programming model. A service says, “This application serves requests.” A function says, “When this request or event arrives, invoke this handler.”

There is a fourth shape: finite work. A nightly program that processes five million records starts, works, completes, and exits. It should not remain alive waiting for another request. This is a **job** or **batch workload**.

```text
service: start -> wait -> handle -> wait -> continue
job:     start -> process -> finish -> exit
```

Cloud Run Jobs runs containers to completion and can divide work into parallel tasks. Google Cloud **Batch** schedules batch workloads onto compute resources, including VM-oriented or large compute jobs. Modeling a finite job as an indefinite service, or an indefinite service as a finite job, adds lifecycle complexity.

These shapes already appear on a laptop. PostgreSQL resembles a continuously running server. A Flask application waits for HTTP requests. A file callback reacts to an event. A report script runs once and exits. Cloud services host the same program shapes with different levels of managed infrastructure.

## When Does a Kubernetes Platform Make Sense?
<!-- section-summary: GKE fits systems that need Kubernetes itself as a shared, programmable control plane for many containerized workloads. -->

Imagine a platform containing a frontend, orders API, payments API, inventory API, recommendation service, workers, schedulers, a proxy, a telemetry agent, and perhaps stateful components. All are containerized. Each could potentially run as an independent managed service, but the team may need custom scheduling, placement rules, sidecars, node-level daemon processes, cluster networking, shared policy, stateful orchestration, specialized controllers, or Kubernetes APIs.

At that point the requirement has changed from “run this application” to “give us a programmable container platform that we operate as a coordinated system.” **Google Kubernetes Engine**, or **GKE**, is Google's managed Kubernetes service for that job.

Kubernetes begins with a placement and recovery problem. Given three machines and many application copies, something must decide which machine receives each container, recreate work after a container or node failure, let services find each other, replace version 1 with version 2, and change the number of copies as demand moves.

The deepest mechanism is **desired-state reconciliation**. The team declares that five orders replicas should exist. Controllers compare that intent with actual state. If only four exist, the system creates one; if six exist, it removes one. The control loop observes, compares, acts, and checks again.

```text
desired state
      |
compare with actual state
      |
difference
      |
controller action
      `----> observe again
```

GKE operates substantial Kubernetes infrastructure for the team. In **Standard** mode, the team retains more responsibility for node pools and worker-machine configuration. In **Autopilot**, Google manages considerably more of the node infrastructure while the team still works with Kubernetes resources such as Pods, Deployments, Services, namespaces, and policies.

The conceptual management spectrum is Compute Engine, GKE Standard, GKE Autopilot, and Cloud Run. It is not an absolute feature ranking. It shows how direct machine control generally decreases as Google manages more of the platform.

Kubernetes flexibility has a cost. Pods, Deployments, Services, Ingress or Gateway, namespaces, node pools, scheduling, autoscaling, upgrades, and network policy are valuable when the system needs them. For a single stateless HTTP container, the same concepts are operational surface that Cloud Run can remove. A reliable general rule is to select the highest-level abstraction that still exposes the control the workload actually needs.

Google Cloud also offers **App Engine**, its long-running managed application platform. It remains supported and appears in the compute catalog. For a modern starting model, it is often clearer to learn Compute Engine, GKE, Cloud Run, Cloud Run functions, and Cloud Run Jobs or Batch first, then learn App Engine when an existing workload or its platform-specific capabilities make it relevant.

It also helps to name the unit that each product asks your team to hand over. Compute Engine primarily receives a VM configuration or image and exposes a machine. GKE receives containers plus Kubernetes desired state and exposes a workload platform and cluster. A Cloud Run service receives a container or source tree and exposes a request-serving application. A Cloud Run function receives handler source and exposes a request or event reaction. A Cloud Run Job receives a container task and runs it to completion. Batch receives a batch job definition and schedules its compute work. App Engine receives application source within its managed platform model.

| Product | What your team primarily supplies | Main unit you operate |
|---|---|---|
| **Compute Engine** | VM shape, image, disks, network, and installed software | A machine |
| **GKE** | Containers and Kubernetes declarations | A Kubernetes workload and cluster platform |
| **Cloud Run service** | Container image or application source | A request-serving service |
| **Cloud Run function** | Handler source and trigger relationship | A request or event handler |
| **Cloud Run Job** | A container task | A finite run-to-completion job |
| **Batch** | A batch specification plus executable or image | A scheduled compute workload |
| **App Engine** | Application source and platform configuration | A managed application |

The table is more useful than treating product descriptions as unrelated definitions. It reveals what the team names, versions, scales, and troubleshoots. A VM incident begins with machine and process state. A Cloud Run incident begins with service, revision, instance, and request evidence. A GKE incident begins with the Kubernetes object path and its reconciliation state.

The same comparison also prevents a common mistake: packaging and execution are separate choices. Putting an application in a container does not automatically mean it needs Kubernetes. The image only defines a portable execution package. Cloud Run can orchestrate it as one managed application, while GKE can orchestrate it inside a programmable multi-workload platform.

## What Problems Must Every Runtime Solve?
<!-- section-summary: Product names change, but every compute environment must answer the same questions about packaging, placement, resources, lifecycle, scaling, networking, identity, state, evidence, and releases. -->

Every runtime eventually maps code to CPU and memory, then surrounds that execution with the same ten operational concerns.

### Packaging

What exactly gets deployed? Compute Engine begins with an image and installed software. GKE deploys containers through Kubernetes declarations. Cloud Run accepts a container, source, or function. A Cloud Run function begins with handler source. Batch combines a job definition with an executable or container.

### Placement

The code must execute somewhere: a region, zone, machine, cluster, or managed instance. The more infrastructure Google manages, the less often an application team chooses the exact machine. Geography still affects latency, availability, and data paths.

### CPU and memory

CPU governs the execution of instructions, and RAM holds active working state. Every product ultimately assigns finite amounts of both. A managed setting still maps to resources on a real machine, although the machine name may remain hidden.

### Lifecycle

Something decides when execution starts, stops, restarts, and responds to a crash. Compute Engine exposes VM and operating-system process lifecycles. GKE makes Pod lifecycle visible. Cloud Run largely hides instance lifecycle while still starting and stopping real processes.

### Scaling

If one worker handles about 100 requests per second and demand reaches 1,000 requests per second, the system needs roughly ten workers before other bottlenecks are considered. The team, a managed instance group, Kubernetes autoscalers, or Cloud Run may detect and supply that capacity. The first-principles intuition remains demand divided by useful capacity per worker.

### Networking

Clients need a route in, applications need routes to databases and APIs, and operators need to know which address, DNS record, VPC connection, firewall, and load balancer governs each packet. Compute and networking cannot be separated because remote code is useful only when its intended callers and dependencies can reach it.

### Identity

Applications call Cloud Storage, Secret Manager, Pub/Sub, BigQuery, and other APIs. A service account gives the running workload an identity independent of the developer or machine. IAM authorizes that identity without embedding a long-lived username and password in application code.

### State

Compute executes work; durable systems preserve important data. If a Cloud Run instance disappears, its memory disappears. A scalable design stores necessary data in systems such as Cloud SQL, Cloud Storage, Firestore, Spanner, or Memorystore. **Stateless** does not mean the application has no data. It means no particular compute instance must survive for correctness.

```text
replaceable compute
       |
       +--> durable database
       +--> object storage
       `--> messaging or cache services
```

### Observability

Remote execution needs logs, metrics, traces, and health evidence. Those signals let the team distinguish a code crash from CPU saturation, DNS failure, dependency timeout, or denied authorization.

### Deployment and versioning

Moving from version 41 to 42 requires a release mechanism and a rollback path. Compute Engine may use a new instance template and managed-group rollout. Kubernetes uses a Deployment rollout. Cloud Run creates a new revision. The products differ, but the purpose is the same: replace executing code without needless user disruption.

Together these concerns prevent compute selection from becoming a product-name quiz. The right runtime must both match the program shape and answer the production questions around it.

## Can One Application Use Several Compute Products?
<!-- section-summary: One system can combine compute products because each component may have a different trigger, lifetime, and responsibility contract. -->

There is no rule that an organization must select one compute product for every workload. An ecommerce application can place its request-serving web API on Cloud Run and store durable transactions in Cloud SQL. The API can publish an order event to Pub/Sub, which invokes a Cloud Run function that sends a confirmation. A scheduled Cloud Run Job can recalculate recommendations overnight.

The same system may retain a Compute Engine VM for an older ERP integration that requires an ordinary server installer. A sophisticated machine-learning platform may use GKE because it needs Kubernetes scheduling, policies, and shared orchestration.

```text
                        users
                          |
                    Cloud Run API
                    /           \
                   v             v
             Cloud SQL         Pub/Sub
                                  |
                           Cloud Run function

scheduled work -> Cloud Run Job
legacy server  -> Compute Engine
shared complex container platform -> GKE
```

Each component is placed according to its own natural execution model. The public API waits for requests. The confirmation handler reacts to an event. The recommendation process runs to completion. The ERP integration needs machine semantics. The shared platform needs Kubernetes APIs.

This decomposition is usually clearer than forcing every component into the most complicated runtime the company already knows. It also makes responsibility explicit: the VM team owns operating-system work for the legacy integration, while Google hides the server layer for the Cloud Run services and functions.

![Summary of GCP runtime choices by workload shape](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gcp-compute-hosting-mental-model/compute-choice-summary.png)

*Different components of one product can use different runtimes when their triggers, lifetimes, and control requirements differ.*

The architecture still needs shared identity, networking, durable state, deployment, and observability. Mixing runtimes does not remove those concerns; it places each runtime behind the abstraction boundary best suited to its work.

## How Do You Choose the Right Runtime?
<!-- section-summary: Start with what triggers the program, how long it lives, whether it needs machine control, and whether Kubernetes itself is required. -->

Begin with the program rather than a debate between product names.

First ask what causes execution. An HTTP request points toward a service. A platform or business event points toward a function or event-driven service. A schedule or finite task points toward a job. A process that must remain alive may fit a service, VM, or Kubernetes workload depending on its other requirements.

Second, ask about natural lifetime. Does the program run for milliseconds or minutes and then exit, or does it wait indefinitely? The answer separates jobs and handlers from continuously serving processes.

Third, ask whether the program needs machine semantics. Root access, SSH, OS customization, legacy installers, kernel assumptions, persistent daemon layouts, custom agents, and precise machine control make Compute Engine attractive. If the only requirement is to execute an HTTP application when requests arrive, a VM may expose infrastructure the team does not need.

Fourth, ask whether a container is sufficient. A simple, independently scalable application is a strong Cloud Run candidate. A system that specifically needs Kubernetes scheduling, sidecars, stateful controllers, platform policy, custom resources, or cluster networking is a GKE candidate.

Fifth, ask whether each execution instance is replaceable. Managed autoscaling is easiest when important state lives externally and any instance can disappear without breaking correctness.

Replaceability also changes how recovery is designed. A machine-shaped workload can still be automated so a failed VM is rebuilt from an image and startup configuration. A Cloud Run instance is already expected to disappear. A Kubernetes controller recreates Pods from a declared template. In every case, keeping durable data outside an accidental single execution copy reduces the amount of state that recovery must reconstruct.

The question is therefore about required identity as well as stored data. A batch task may need a durable job record while every worker remains disposable. A database replica may need stable storage and ordering even when its process is replaced. “Stateless” is a useful default for scalable compute instances, while stateful requirements should be named explicitly and matched to a runtime and storage design that supports them.

A practical first-pass tree is:

```text
need to run code
      |
need operating-system or machine control?
      | yes -> Compute Engine
      | no
      v
what causes the work?
      |-- HTTP/request -> Cloud Run service
      |-- event        -> Cloud Run function
      `-- finite task  -> Cloud Run Job or Batch

need Kubernetes-specific orchestration or platform control?
      `-- yes -> GKE
```

The tree is a starting model rather than a universal proof. Real systems can cross branches, as the ecommerce example shows.

The most useful Cloud Run versus GKE question is not which can run containers; both can. Ask whether the team wants to operate an application or a programmable container platform. Cloud Run accepts an application and Google orchestrates its runtime. GKE accepts Kubernetes desired state and the team operates the distributed system through Kubernetes.

The most useful Compute Engine versus Cloud Run question is not which is universally faster. Ask whether the application needs the behavior of a machine. If it does, the VM is appropriate. If it only needs a managed request-serving runtime, Cloud Run may place the handoff at a better level.

More managed also does not mean suitable only for toy workloads. Cloud Run can host production web applications and APIs, run arbitrary languages in containers, support jobs, and provide GPU-backed workloads. “More managed” means Google chooses more implementation details. Move down the abstraction ladder when those details are exactly what the workload must control.

The deepest model is one long execution path:

```text
source code -> build or package -> find hardware -> allocate CPU and RAM
-> boot environment -> configure network -> assign identity -> start process
-> accept work -> observe -> scale -> recover -> deploy replacement version
```

Every compute product draws a boundary through that path. Above the boundary, your team manages the work. Below it, Google does. When you meet a new compute product, ask four questions: what unit do I give it, what starts the code, what does Google manage, and what remains my responsibility? Those answers place the product in the wider compute landscape more reliably than memorizing a feature list.

## Check Your Answers

:::expand[What Does Compute Give a Program?]{kind="recap"}
Compute supplies CPU, memory, storage, networking, identity, and lifecycle around executable code. GCP products mainly differ in where operational responsibility moves from your team to Google.
:::

:::expand[How Does Machine-Shaped Compute Work?]{kind="recap"}
Compute Engine gives the team a VM with operating-system control. The team gains machine flexibility and owns the guest OS, packages, processes, capacity, and much of recovery.
:::

:::expand[How Does Application-Shaped Compute Work?]{kind="recap"}
Cloud Run treats the application service as the stable unit and creates disposable container instances as demand changes. Serverless moves servers below the team's normal operating boundary.
:::

:::expand[How Do Functions and Jobs Handle Other Work Shapes?]{kind="recap"}
A function reacts to a request or event through a handler. A job starts, performs finite work, and exits, while a service normally waits for work indefinitely.
:::

:::expand[When Does a Kubernetes Platform Make Sense?]{kind="recap"}
GKE is appropriate when Kubernetes scheduling, networking, policy, stateful orchestration, sidecars, or custom controllers are part of the requirement. Desired-state reconciliation coordinates the system.
:::

:::expand[What Problems Must Every Runtime Solve?]{kind="recap"}
Every runtime must address packaging, placement, resources, lifecycle, scaling, networking, identity, state, observability, and version replacement even when it hides some of them.
:::

:::expand[Can One Application Use Several Compute Products?]{kind="recap"}
Yes. Components with different triggers, lifetimes, and control needs can use Cloud Run, functions, jobs, Compute Engine, and GKE in the same larger architecture.
:::

:::expand[How Do You Choose the Right Runtime?]{kind="recap"}
Start with the program's trigger and lifetime, then test its need for machine control, container sufficiency, Kubernetes semantics, and replaceable instances. Choose the highest abstraction that still exposes required control.
:::

## References

- [Google Cloud compute overview](https://docs.cloud.google.com/docs/compute-area/overview?authuser=993749347) - Official overview of Google Cloud compute products.
- [Application hosting options](https://cloud.google.com/hosting-options) - Official comparison of hosting abstractions.
- [Compute Engine overview](https://docs.cloud.google.com/compute/docs/overview?authuser=1) - Official VM and machine-oriented compute documentation.
- [What is Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run) - Official overview of Cloud Run services, jobs, functions, and managed behavior.
- [Cloud Run functions release notes](https://docs.cloud.google.com/functions/docs/release-notes) - Official naming and product evolution notes.
- [Cloud Run product page](https://cloud.google.com/run) - Official Cloud Run service and job overview.
- [Google Cloud products](https://cloud.google.com/products) - Official catalog including Batch and App Engine.
- [GKE and Cloud Run](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gke-and-cloud-run?hl=en) - Official comparison of the two container platforms.
