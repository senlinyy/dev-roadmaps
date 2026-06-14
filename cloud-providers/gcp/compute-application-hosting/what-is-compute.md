---
title: "What Is GCP Compute"
description: "Choose where application code should run in GCP by matching Cloud Run, Compute Engine, Cloud Run functions, and GKE to workload shape and team responsibility."
overview: "Compute is the GCP layer where code gets CPU, memory, network access, startup behavior, scaling behavior, identity, and operating evidence. This article builds the foundation for choosing a runtime without turning the choice into a product list."
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

1. [What GCP Compute Is](#what-gcp-compute-is)
2. [The Orders Team Scenario](#the-orders-team-scenario)
3. [The Four Runtime Choices](#the-four-runtime-choices)
4. [Compute Engine: Virtual Machines](#compute-engine-virtual-machines)
5. [Cloud Run: Serverless Containers](#cloud-run-serverless-containers)
6. [Cloud Run Functions: Event Handlers](#cloud-run-functions-event-handlers)
7. [GKE: Managed Kubernetes](#gke-managed-kubernetes)
8. [Background Work and Queues](#background-work-and-queues)
9. [Operational Questions Before You Choose](#operational-questions-before-you-choose)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## What GCP Compute Is
<!-- section-summary: GCP compute choices make sense after you name the work pattern and the operating responsibility your team wants to own. -->

**Compute** is the part of Google Cloud that gives your code a place to run. That place includes CPU, memory, network access, startup rules, scaling rules, an identity for calling other Google services, and logs that prove what happened when something went wrong. In local development, your laptop quietly provides all of those things. In production, the runtime has to provide them in a repeatable way.

The beginner trap is treating compute as a product list. A small team sees **Compute Engine**, **Cloud Run**, **Cloud Run functions**, and **Google Kubernetes Engine**, then tries to memorize which one is the "best" service. A senior engineer usually asks a different question first: what shape does the work have, and which responsibilities should the team keep?

A **runtime** is the managed environment that starts your code and keeps it reachable. A **workload shape** is the pattern of work your code handles: long-running HTTP requests, short event handlers, batch jobs, legacy server processes, or a full container platform. A **responsibility boundary** is the line between what your team operates and what Google operates. Those three ideas turn the choice into an engineering conversation instead of a product quiz.

This article follows one small team moving an Orders and Checkout system to GCP. They have a customer-facing Orders API, a receipt email task, a nightly reconciliation job, a legacy invoice PDF worker that still expects a Linux server, and a future platform discussion about Kubernetes. Each piece needs compute, but each piece asks for a different runtime contract.

## The Orders Team Scenario
<!-- section-summary: One application area can contain several workload shapes, so one cloud runtime rarely fits every part equally well. -->

Imagine a six-person team running a checkout system for an online store. The main **Orders API** receives HTTP requests from the frontend, validates carts, writes orders to a database, and calls a payment provider. Customers notice latency on this path, so the team cares about fast startup, predictable scaling, safe rollouts, and logs tied to each request.

The same team also sends receipt emails after an order succeeds. That work starts from an event, usually a Pub/Sub message or another platform event. The handler can retry if the email provider has a temporary problem, and the customer request should finish before the email provider responds.

At night, the team runs a reconciliation task that compares orders, payment captures, and refunds. This task may process thousands of rows, exit after completion, and produce an audit report. It needs a batch-style runtime, not a permanent web server.

One older billing piece still renders invoice PDFs with a vendor library that expects a specific Linux package, a local daemon, and a predictable filesystem path. The team wants to retire it later, but today the fastest safe migration may put that process on a virtual machine. That buys time while the team removes the OS dependency.

A different group in the company already runs Kubernetes for shared internal platforms. They ask whether the Orders team should join that platform. That question matters only if the Orders team needs Kubernetes features, shared cluster policy, service mesh patterns, or platform-level workload controls.

So the conversation starts with the work itself. The same business feature contains a request-driven API, an event handler, a batch task, a legacy server process, and a possible platform workload. GCP has compute services for all of these, and the right choice depends on the job.

## The Four Runtime Choices
<!-- section-summary: The main choices differ by deployment unit, scaling model, and how much infrastructure your team operates directly. -->

GCP gives you several compute services because production applications do several kinds of work. The main options in this part of the roadmap are **Compute Engine**, **Cloud Run**, **Cloud Run functions**, and **GKE**. They overlap in small places, but their day-to-day operating experience is very different.

| Runtime | Deployment unit | Best fit in the Orders scenario | Team owns | Google owns |
|---|---|---|---|---|
| **Compute Engine** | Virtual machine | Legacy invoice PDF worker that needs OS-level control | Guest OS, packages, process manager, patch plan, disks | Physical hardware, virtualization, base infrastructure |
| **Cloud Run** | Container service, job, or worker pool | Orders API and containerized batch tasks | Container contract, app code, service config, IAM roles | Server hosts, routing, sandboxing, autoscaling, revision management |
| **Cloud Run functions** | Function source code | Receipt email handler triggered by an order event | Handler code, trigger shape, retry-safe logic | Buildpacks, build flow, event delivery into Cloud Run, runtime management |
| **GKE** | Kubernetes workloads | Shared platform with Kubernetes policies and add-ons | Kubernetes objects, cluster policies, workload configuration | Managed control plane and GKE integrations |

**Serverless** means the cloud provider handles server provisioning and scaling around a documented contract. Cloud Run and Cloud Run functions are serverless in this sense. You still design the application carefully, set limits, choose identities, watch costs, and protect downstream systems, but you spend far less time managing host machines.

**Virtual machines** give the most direct server control. **Kubernetes** gives a powerful orchestration API for teams that already need cluster-level primitives. **Serverless containers** give a simpler service model for stateless web services and many background tasks. **Functions** give a small handler model for event-driven work. With that map in mind, we can walk through each option as the Orders team makes decisions, starting with the runtime that looks most like a traditional server.

## Compute Engine: Virtual Machines
<!-- section-summary: Compute Engine fits workloads that need direct operating-system control, but the team accepts more patching and process-management work. -->

**Compute Engine** is Google Cloud's virtual machine service. A **virtual machine**, or VM, is a software-defined server with a machine type, operating system image, attached disks, network interfaces, firewall rules, and a service account identity. It is the closest GCP runtime to a server you might run in a datacenter.

The Orders team would choose Compute Engine for the legacy invoice PDF worker because that worker depends on OS packages, a local daemon, and predictable disk behavior. The team can install the package, configure `systemd`, place logs under the normal Linux paths, attach a persistent disk if needed, and control maintenance windows more directly. That control solves real migration problems when the application cannot yet fit a container or function contract.

A first test VM might look like this. The command names the server, chooses a zone and machine type, picks a Debian image, and attaches a dedicated runtime service account.

```bash
gcloud compute instances create invoice-worker-1 \
  --zone=us-central1-a \
  --machine-type=e2-standard-2 \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --service-account=invoice-worker-runtime@orders-prod.iam.gserviceaccount.com
```

That command only creates the server. The production checklist continues with startup scripts or image baking, OS patching, process supervision, firewall rules, disk backups, monitoring agents, and a plan for replacing failed instances. Managed instance groups can help with fleets of similar VMs, but the team still owns the guest operating system and the process running inside it.

This is the main tradeoff. Compute Engine gives server-shaped workloads a practical home, especially during migrations. For a new stateless HTTP API, the same control turns into extra work that the Orders team may not need. The Orders API is already containerized, so the team looks next at a runtime that keeps the container and removes most host operations.

## Cloud Run: Serverless Containers
<!-- section-summary: Cloud Run fits stateless containers that should receive requests or run managed container work without VM or cluster operations. -->

**Cloud Run** runs containers on a fully managed platform. A **container image** is the packaged application: code, runtime, dependencies, and startup command. A **Cloud Run service** is the managed HTTPS endpoint, revision history, traffic rules, scaling configuration, identity, and logging path around that image.

That distinction matters for the Orders API. The Docker image alone does not decide who can call the service, how many instances can start, which service account the code uses, or which revision receives traffic. Cloud Run stores those decisions in the service configuration and creates a new immutable revision when important deployable settings change.

The first Orders API deployment might use a command like this. The image tag is tied to a specific code version, and the service account is the identity the running container will use.

```bash
gcloud run deploy orders-api \
  --image=us-central1-docker.pkg.dev/orders-prod/apps/orders-api:a3f8c2d \
  --region=us-central1 \
  --service-account=orders-api-runtime@orders-prod.iam.gserviceaccount.com \
  --no-allow-unauthenticated
```

In this example, the backend is private to callers with the right IAM permission. A public website can still sit in front of it, or the team can intentionally allow unauthenticated Cloud Run invocation for a public API. The important point is that access belongs in service configuration, not in the container image.

Cloud Run is a strong default for stateless HTTP APIs because the team can focus on a smaller contract. The container needs to start cleanly, listen on the port Cloud Run provides, handle concurrent requests safely, write logs to standard output and standard error, and store durable state in managed services such as Cloud SQL, Firestore, Spanner, or Cloud Storage. Google handles the server fleet around that contract.

Cloud Run also has **jobs** and **worker pools**. A job runs container tasks to completion, which fits batch work like nightly reconciliation. A worker pool runs containers for continuous background work without a public load-balanced URL. Those options keep the container model while changing how work enters the runtime.

The receipt email task has an even smaller shape than a container service. That points the team toward Cloud Run functions.

## Cloud Run Functions: Event Handlers
<!-- section-summary: Cloud Run functions fit small handlers that respond to events and let Google build and host the function as a Cloud Run-backed service. -->

**Cloud Run functions** are single-purpose functions that respond to HTTP requests or events. A function is usually a small handler with an entry point, runtime base image, source directory, and trigger. Google uses buildpacks and Cloud Build to turn that source into a container image, stores artifacts in Artifact Registry, and hosts the result on Cloud Run.

For the Orders team, the receipt email handler is a good function candidate. The checkout flow publishes an `order.created` event after the database transaction commits. The function receives that event, loads the order summary, calls the email provider, and records delivery status.

A simple deployment flow may create the function first and then attach an Eventarc trigger. The function deployment names the source entry point, while the trigger connects Pub/Sub events to the Cloud Run-hosted function.

```bash
gcloud run deploy receipt-email \
  --source=. \
  --function=sendReceipt \
  --base-image=nodejs24 \
  --region=us-central1

gcloud eventarc triggers create receipt-email-order-created \
  --location=us-central1 \
  --destination-run-service=receipt-email \
  --destination-run-region=us-central1 \
  --event-filters="type=google.cloud.pubsub.topic.v1.messagePublished" \
  --transport-topic=projects/orders-prod/topics/order-created \
  --service-account=receipt-trigger@orders-prod.iam.gserviceaccount.com
```

The practical production idea here is **idempotency**. An idempotent handler can process the same event more than once and still leave the system in the correct final state. The receipt function can store an `email_sent_at` timestamp or an email delivery record keyed by `order_id`, so a retry does not send three receipts for one purchase.

Functions are helpful when the code naturally fits a small event handler. If the Orders team starts adding many routes, shared middleware, long dependency initialization, custom container behavior, and rollout controls, the work may fit a Cloud Run service more cleanly. The decision follows the shape of the code and the operations the team wants to see. The platform team then raises Kubernetes, which is a different kind of runtime choice because it changes the operating surface, not just the packaging style.

## GKE: Managed Kubernetes
<!-- section-summary: GKE fits teams that intentionally operate through Kubernetes APIs and need cluster-level platform capabilities. -->

**Google Kubernetes Engine**, or **GKE**, is managed Kubernetes on Google Cloud. Kubernetes runs containerized workloads through objects such as **Pods**, **Deployments**, **Services**, **ConfigMaps**, **Secrets**, **Ingress**, and **HorizontalPodAutoscalers**. GKE manages the Kubernetes control plane and integrates the cluster with Google Cloud networking, identity, logging, and monitoring.

GKE is a strong fit when the organization already has a platform built around Kubernetes. The platform might enforce admission policies, sidecar injection, network policies, service mesh routing, custom controllers, or shared observability agents. In that world, the Orders API may join the cluster because the platform contract has value beyond simply running a container.

The team pays for that power with more moving parts. Someone has to understand manifests, namespaces, rollout status, pod scheduling, cluster upgrades, node pools or Autopilot constraints, workload identity, ingress behavior, and cluster-level failure modes. A small team that only needs one HTTPS API can spend a lot of time learning Kubernetes before they ship meaningful business value.

This is why Cloud Run and GKE can coexist in one company. The Orders API may start on Cloud Run while a central platform runs complex internal systems on GKE. Later, if the Orders system needs the shared Kubernetes platform, migration is a platform decision rather than a reaction to product names. That leaves the background work, where teams often mix up events, jobs, and long-running consumers.

## Background Work and Queues
<!-- section-summary: Background work needs a trigger, a retry story, and a runtime that matches whether the task is event-based, batch-based, or continuous. -->

**Background work** is work that happens outside the customer-facing request path. It often starts from a queue, a scheduler, a file upload, or a database change. The runtime choice depends on how the work starts and how long it runs.

For the Orders team, receipt emails fit a Cloud Run function because each event triggers a small handler. The nightly reconciliation task fits a Cloud Run job because it runs a container, finishes, and exits. A long-running consumer that continuously pulls from a custom broker may fit a Cloud Run worker pool. A legacy process with OS-level dependencies may stay on Compute Engine until the team can modernize it.

The queue matters as much as the runtime. Pub/Sub fits event streams and fan-out. Cloud Tasks fits controlled HTTP task delivery, rate limits, and retry scheduling for per-request background work. Cloud Scheduler can start periodic work, often by calling a service, publishing to Pub/Sub, or starting a job through a workflow.

The production habit is to separate the customer request from slow or unreliable dependencies. The checkout request should commit the order and publish a durable event. Email, analytics, warehouse sync, and reconciliation can happen after that. This design protects user latency and gives the team clearer retry points. With the runtime choices on the table, the last step is asking operational questions before the team commits.

## Operational Questions Before You Choose
<!-- section-summary: A good runtime choice names startup, ingress, state, scaling, identity, dependencies, and debugging evidence before the first deploy. -->

The Orders team should answer a few questions for each workload. These questions turn the runtime choice into a reviewable design, and they help beginners avoid choosing a service only because it was the last one they learned.

| Question | Why it matters | Orders example |
|---|---|---|
| **How does the work start?** | The trigger tells you whether the workload is request-driven, event-driven, scheduled, batch, or continuous. | Checkout requests start the API; Pub/Sub starts receipt email; a scheduler starts reconciliation. |
| **How long does it run?** | Short handlers, web services, and long-running processes need different lifecycle behavior. | The Orders API runs continuously as requests arrive; reconciliation exits after the report finishes. |
| **Does it need local state?** | Serverless containers and functions should treat local disk as temporary. | Orders live in Cloud SQL or another database, not inside a container filesystem. |
| **What should scaling protect?** | Compute scaling can overload databases, third-party APIs, and queues. | Max instances and queue rate limits protect the orders database and payment provider. |
| **Which identity does it use?** | Runtime service accounts should have only the permissions the workload needs. | The Orders API can read one database secret and connect to one database, but it does not need project Editor. |
| **Where will the team debug?** | A runtime choice also chooses the evidence trail. | Cloud Run shows revisions and request logs; VMs need guest OS logs and process status; GKE needs pod events and workload logs. |

These questions also make migration safer. The first version may put the invoice PDF worker on Compute Engine while the team rewrites it. The Orders API can move to Cloud Run sooner because it already has a stateless container shape. The receipt handler can move to Cloud Run functions because event handling is the natural contract.

## Putting It All Together
<!-- section-summary: The final architecture can use more than one runtime, because each workload keeps the runtime contract that fits its shape. -->

Here is the small team's first GCP compute plan. The **Orders API** runs as a Cloud Run service from an immutable container image, with a dedicated runtime service account, explicit concurrency, max instances to protect the database, and logs written to standard output. The service receives traffic through a controlled ingress path and uses revisions for deploy safety.

The **receipt email handler** runs as a Cloud Run function triggered by an order event. The handler records delivery state by order ID so retries do not duplicate customer emails. The function stays small because its job is one event, one side effect, and one audit record.

The **nightly reconciliation** runs as a Cloud Run job. It uses the same container discipline as the API, but its lifecycle is batch-oriented: start, process, write a report, exit. The team can schedule it and review execution logs without keeping a VM alive all day.

The **legacy invoice PDF worker** starts on Compute Engine. That keeps the OS-specific dependency available while the team removes it from the checkout path. The team treats this as a migration bridge with a patching plan, monitoring, backups, and a clear retirement target.

The **shared platform discussion** stays open for GKE. If the Orders system later needs Kubernetes policies, service mesh sidecars, custom controllers, or a company-wide deployment platform, GKE may be the right home. Until then, Cloud Run gives the Orders team a smaller operating surface for the main API.

This is the core lesson: GCP compute selection is about workload shape and operating responsibility. The best architecture for a small team can use several runtimes at once, as long as each one has a clear reason to exist.

## What's Next
<!-- section-summary: The next article zooms into Cloud Run because it is the usual first home for a stateless backend API on GCP. -->

The Orders API is the most important user-facing path in this scenario, so the next article goes deep on Cloud Run. We will follow one container image into a Cloud Run service, then connect the details: services, revisions, traffic splits, rollbacks, concurrency, max instances, min instances, runtime identity, environment variables, secrets, logs, and verification.

---

**References**

- [Cloud Run documentation](https://docs.cloud.google.com/run/docs) - Official Cloud Run documentation for services, jobs, worker pools, functions, configuration, security, and operations.
- [What is Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run) - Explains Cloud Run services, jobs, and worker pools as ways to run code on the same managed execution environment.
- [Create jobs in Cloud Run](https://docs.cloud.google.com/run/docs/create-jobs) - Documents Cloud Run jobs for container tasks that run to completion.
- [Deploy worker pools to Cloud Run](https://docs.cloud.google.com/run/docs/deploy-worker-pools) - Describes worker pools for continuous background work without a load-balanced endpoint.
- [Compute Engine documentation](https://docs.cloud.google.com/compute/docs) - Official documentation for creating and running virtual machines on Google infrastructure.
- [Cloud Run functions documentation](https://docs.cloud.google.com/functions/docs) - Defines Cloud Run functions as single-purpose functions for Cloud events and HTTP handlers.
- [Deploy a Cloud Run function](https://docs.cloud.google.com/run/docs/deploy-functions) - Documents the current Cloud Run function deployment flow using `gcloud run deploy`, buildpacks, and Eventarc triggers.
- [GKE overview](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/kubernetes-engine-overview) - Defines GKE as managed Kubernetes for running containerized workloads at scale.
- [GKE and Cloud Run](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/gke-and-cloud-run) - Compares Cloud Run and GKE for containerized application hosting choices.
