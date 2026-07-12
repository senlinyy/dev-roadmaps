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

1. [What GCP Compute Is](#what-gcp-compute-is)
2. [Your Laptop Already Shows the Jobs](#your-laptop-already-shows-the-jobs)
3. [Four Workload Shapes](#four-workload-shapes)
4. [Request-Driven Containers](#request-driven-containers)
5. [Server-Shaped Software](#server-shaped-software)
6. [Event-Driven Work](#event-driven-work)
7. [Many Services With Shared Platform Rules](#many-services-with-shared-platform-rules)
8. [What Every Runtime Must Provide](#what-every-runtime-must-provide)
9. [Putting the Choice Together](#putting-the-choice-together)
10. [References](#references)

## What GCP Compute Is
<!-- section-summary: GCP compute gives your code a production place to run, with CPU, memory, startup rules, scaling, identity, and logs. -->

Your code needs a place to run. On your laptop, that place may be a terminal tab running `npm start`, a Python script, a local Docker container, or a service you keep open while testing. The laptop quietly supplies CPU, memory, environment variables, a network port, a filesystem, credentials, logs, and a human nearby to restart the process.

Production asks for the same jobs with less luck involved. The code needs CPU and memory in a region. It needs a runtime that starts it the same way every time. Users or events need a path into it. It needs scaling rules, a safe identity for Google Cloud APIs, logs for support, and a release path for new versions.

That is the core compute problem: your program needs somewhere reliable to run after it leaves your laptop. A runtime is more than "a server." It is the agreement between your code and the platform. The agreement says how the code starts, how traffic or events reach it, how many copies can run, how it proves health, which identity it uses, and how the team replaces it with a new version.

**GCP compute** is the Google Cloud service family that gives application code that running place. The main beginner choice is not the product name first. The useful first question is: what shape does the work have?

![Four workload shapes mapped to runtime contracts](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gcp-compute-hosting-mental-model/runtime-contract-map.png)
*Compute choices make sense after the work shape is visible: request service, server process, event handler, or shared platform workload.*

## Your Laptop Already Shows the Jobs
<!-- section-summary: A local process hides several production responsibilities that a cloud runtime has to make explicit. -->

Picture a tiny contact form API on your laptop. It receives `POST /contact`, validates the email address, stores the message, and sends a notification. While you test it locally, the command line hides a lot of details. Your machine has a CPU. Your process has memory. The app listens on a port. Logs print in the terminal. A `.env` file provides a mail provider key.

Moving that API to production makes each hidden detail explicit:

| Runtime job | Plain question | Contact form example |
|---|---|---|
| **CPU and memory** | How much capacity can the code use while it runs? | The API needs enough memory for validation and mail client libraries. |
| **Startup** | What command launches the app? | The container runs `node server.js` and listens for HTTP requests. |
| **Runtime contract** | What does the platform expect from the code? | The app reads the provided port and writes logs to standard output. |
| **Scaling** | What happens during traffic spikes or quiet periods? | More instances can handle a campaign spike, then idle capacity can shrink. |
| **Identity** | Which software identity calls other GCP services? | The API reads one secret and writes to one database with a service account. |
| **Logs and metrics** | How does the team investigate behavior? | Failed submissions show route, request ID, revision, and sanitized error reason. |

Those jobs appear in every compute service. The services differ in how much of the surrounding server or platform work your team owns.

## Four Workload Shapes
<!-- section-summary: The first compute decision is the workload shape, then the matching GCP service name enters the conversation. -->

A workload shape describes how work arrives, how long it runs, and how much platform control it needs. The names below appear only after the job is clear.

| Workload shape | The job in plain English | Good GCP fit |
|---|---|---|
| **Request-driven container service** | A containerized web API or backend receives HTTP requests and can scale around request traffic. | **Cloud Run** |
| **Server-shaped software** | Software expects a VM, an operating system, host packages, a daemon, or block storage. | **Compute Engine** |
| **Event-driven handler** | A small piece of code runs after an event such as a message, file upload, or schedule. | **Cloud Run functions** |
| **Shared Kubernetes platform workload** | Many services need Kubernetes APIs, cluster policy, sidecars, service mesh, or custom controllers. | **GKE** |

For AWS readers, the rough anchors are useful after the GCP job is clear. Cloud Run overlaps with App Runner for container services and has Lambda-like scaling behavior for containers. Compute Engine maps closely to EC2. Cloud Run functions map to Lambda-style handlers often wired through EventBridge, SNS, SQS, or S3 notifications. GKE maps to EKS, while ECS or Fargate may be the simpler AWS comparison for managed containers without Kubernetes APIs.

![Compute responsibility boundary across four runtime types](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gcp-compute-hosting-mental-model/responsibility-boundary.png)
*The responsibility boundary moves by runtime. A VM keeps more server work with your team, while managed services narrow the contract.*

## Request-Driven Containers
<!-- section-summary: A request-driven container fits Cloud Run because the app already has a web-service shape and needs managed scaling around it. -->

A request-driven service receives an HTTP request, does a bounded piece of application work, and returns a response. The contact form API has that shape. A customer submits a form, the API validates the payload, stores the message, publishes a notification, and returns success.

If that API already runs in a container on your laptop, **Cloud Run** is often the clean first production home. A container packages the app code, runtime, dependencies, and startup command. Cloud Run wraps that container with a managed service endpoint, scaling, release history, traffic routing, runtime identity, and Cloud Logging integration.

The useful production question is no longer "Can the container run?" The better question is "Can this service receive real requests safely?" That means the container listens on the provided port, keeps durable state outside the container, handles concurrent requests safely, uses a narrow service account, and emits logs that help you debug failed submissions.

The AWS bridge is close to App Runner as a managed container service. It also has Lambda-like scale-to-zero behavior for request traffic, but Cloud Run still runs your container image and can host a normal HTTP app with multiple routes.

The first practical check is the container contract. Confirm that the container listens on the port Cloud Run provides, starts without writing required state to the local filesystem, and logs a clean startup line. If those three checks fail, scaling and traffic splitting will not save the service.

## Server-Shaped Software
<!-- section-summary: Server-shaped software fits Compute Engine for operating-system runtime requirements. -->

Some software expects a server. An invoice renderer may need a licensed native PDF package, a local daemon, a mounted data disk, a specific Linux library, and `systemd` process supervision. That shape can be awkward to force into a small function or a stateless web container.

**Compute Engine** gives you virtual machines on Google Cloud. A virtual machine is a software-defined server with a machine type, boot image, disk, zone, network, startup behavior, and service account. Google operates the physical hardware and virtualization layer. Your team still operates the guest operating system, packages, patches, process manager, disks, and application health inside the VM.

The VM path can be the right migration step for the invoice renderer. The team can install the vendor package, run the worker under `systemd`, attach a persistent disk for in-flight files, send logs through the Ops Agent, and later rewrite the workload after the server dependency is gone.

For AWS readers, Compute Engine maps closely to EC2. Images map to AMIs, Persistent Disk maps to EBS, startup scripts play a similar role to user data, and `systemd` patterns carry over directly for Linux services. The GCP details differ in IAM, metadata, networking, and disk options, so the service names are familiar while the operating checklist still needs GCP-specific review.

The first practical check is the VM boot and service state. Confirm the image, machine type, disk, zone, service account, firewall path, startup script, and `systemd` service status. That evidence tells you whether the server shape exists before you debug the application itself.

## Event-Driven Work
<!-- section-summary: Event-driven work fits Cloud Run functions for small handlers triggered by a message, file upload, or schedule. -->

Some work should happen after an event, outside the main request. A receipt email can run after a purchase succeeds. A thumbnail generator can run after an image upload. A cleanup task can run after a scheduled message. Keeping these jobs outside the main request protects the user path from slower providers and retry loops.

A **function** is a small handler with one clear entry point. A **trigger** decides the handler start condition. The trigger might come from Pub/Sub, Eventarc, Cloud Storage, or an HTTP request. **Cloud Run functions** let you write that handler from source while Google builds and runs it on Cloud Run.

The thumbnail example fits the shape well. A user uploads `profile-photo.png` to Cloud Storage. A storage event reaches the function. The handler validates the object name, creates thumbnail sizes, writes them back to a bucket, records status, and exits. If the platform retries the event, the handler needs idempotency so it can handle the same file event safely.

For AWS readers, this is the closest fit to Lambda wired to EventBridge, SNS/SQS, or S3 event notifications. The difference is that modern Cloud Run functions are built and hosted on Cloud Run, so the function authoring model sits on top of the Cloud Run platform.

The first practical check is the trigger route. Confirm that the trigger exists, points to the expected function service, carries the event type you expect, and shows one successful test event in logs. A handler can be correct and still never run if the trigger path is wrong.

## Many Services With Shared Platform Rules
<!-- section-summary: GKE fits teams that want Kubernetes as the platform API for many services and shared controls. -->

One service can be simple. Many services with shared platform rules may need a stronger common operating layer. Imagine an internal commerce platform with a catalog API, pricing API, checkout API, fraud scoring service, background workers, service mesh policy, sidecar proxies, custom deployment rules, and team-specific namespaces.

**Kubernetes** is an orchestration system for running containerized workloads through an API. **Google Kubernetes Engine**, or **GKE**, is Google's managed Kubernetes service. GKE manages the Kubernetes control plane and connects clusters to Google Cloud networking, identity, logging, monitoring, and node options.

GKE is justified if Kubernetes itself is part of the requirement. The platform team may need admission policy, network policy, sidecars, service mesh routing, custom controllers, namespace boundaries, or a shared way to deploy many services. A single contact form API usually does not need that much platform surface on day one.

For AWS readers, GKE maps to EKS. ECS and Fargate are useful comparison points for managed container hosting without Kubernetes. Kubernetes adds a vocabulary of clusters, nodes, Pods, Deployments, Services, and Ingress or Gateway resources that the team must understand and operate, so the first GKE check should prove the team really needs that shared platform surface.

The first practical check is the Kubernetes object path. Confirm the cluster, namespace, Deployment, Pods, Service, and route. If a team cannot explain how traffic reaches one Pod through those objects, GKE is probably too much surface for a first single-service deployment.

## What Every Runtime Must Provide
<!-- section-summary: Every compute choice still needs capacity, startup, scaling, identity, logs, release safety, and recovery decisions. -->

The service names change, but the production checklist stays recognizable. You want each runtime choice to answer the same operational questions before the workload reaches users.

| Question | What a good answer includes |
|---|---|
| **How does the code start?** | Container command, VM startup script, function entry point, or Kubernetes Deployment spec. |
| **How does work reach it?** | HTTP request, queue message, object event, schedule, internal service call, or Kubernetes routing. |
| **How does it scale?** | Instance limits, concurrency, VM group size, function retry behavior, or Kubernetes autoscaling. |
| **Which identity does it use?** | A narrow service account or workload identity with only the roles needed for the job. |
| **Where does state live?** | Managed databases, object storage, queues, or disks with clear backup and recovery rules. |
| **How does the team debug it?** | Logs, metrics, traces, error reports, audit logs, and release records tied to versions. |
| **How does rollback work?** | Cloud Run traffic movement, VM template rollback, function redeploy, or Kubernetes rollout undo. |

Apply the checklist to the contact API on Cloud Run. The service is a containerized HTTP API, so good evidence should prove that the container starts, Cloud Run can scale it inside known bounds, the app runs as the expected service account, and support can find a failed request in logs.

```bash
gcloud run services describe contact-api \
  --region=us-central1 \
  --format="yaml(status.conditions,status.latestReadyRevisionName,spec.template.spec.serviceAccountName,spec.template.spec.containerConcurrency,spec.template.metadata.annotations)"
```

Important parts:

- `status.conditions` shows whether the latest revision reached a ready state.
- `status.latestReadyRevisionName` names the revision that actually started.
- `serviceAccountName` shows the runtime identity used by application code.
- `containerConcurrency` and scaling annotations show how Cloud Run accepts and bounds traffic.

Good output should read like a small operations record:

```yaml
status:
  conditions:
    - type: Ready
      status: 'True'
  latestReadyRevisionName: contact-api-00018-canary
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/maxScale: '15'
    spec:
      containerConcurrency: 20
      serviceAccountName: contact-api-runtime@support-prod.iam.gserviceaccount.com
```

The interpretation is direct. `Ready: True` says Cloud Run accepted the revision and the container passed the platform startup path. `maxScale: 15` and `containerConcurrency: 20` tell reviewers the service can handle up to about 300 simultaneous in-flight requests before requests queue or fail, depending on downstream pressure and request duration. The service account confirms that the code uses the workload identity assigned to production.

Logs complete the check because a ready service can still reject real requests. A first support query should filter by service, revision, and route:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="contact-api"
   resource.labels.revision_name="contact-api-00018-canary"
   jsonPayload.route="/contact"' \
  --limit=3 \
  --format="value(timestamp,jsonPayload.severity,jsonPayload.message,jsonPayload.requestId,jsonPayload.status)"
```

Healthy evidence might look like this:

```console
2026-07-04T10:18:22Z INFO contact request accepted req-9c12 202
2026-07-04T10:18:37Z WARN contact validation failed req-9c19 400
```

The `INFO` line proves one request reached the new revision and returned the expected accepted status. The `WARN` line is also useful because it shows a client validation failure with a request ID and sanitized reason, rather than a secret value or full message body. That is the level of evidence a runtime review needs before the team calls the compute choice production-ready.

This checklist keeps compute from turning into a product quiz. You can explain the workload, choose the runtime, and then prove that the runtime has the controls a production team needs.

## Putting the Choice Together
<!-- section-summary: The best compute choice follows the job, then the team checks the runtime responsibilities before launch. -->

Here is the short version you can carry into the rest of the module:

Use the table as a first-pass map, then test the choice against real operations. A service that appears simple in a diagram still needs logs, identity, rollback, and recovery. A VM that seems familiar still needs patching, disk care, firewall review, and process supervision. GKE earns its place only if the Kubernetes platform features are part of the requirement.

| You have this job | First runtime to consider | Why |
|---|---|---|
| A containerized HTTP API, webhook receiver, or simple backend | Cloud Run | It gives the container a managed service endpoint, scaling, traffic control, identity, and logs. |
| A legacy worker or package that expects a Linux server | Compute Engine | It gives OS control, disks, startup scripts, and process management while staying on GCP infrastructure. |
| A small task after a message, upload, schedule, or platform event | Cloud Run functions | It keeps the code focused on one handler and one trigger. |
| A multi-service platform that needs Kubernetes policy and APIs | GKE | It gives Kubernetes as the shared operating layer for many services and platform controls. |

![Summary of runtime choices by workload shape](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-gcp-compute-hosting-mental-model/compute-choice-summary.png)
*A compute choice is a workload-shape decision first, then a responsibility decision.*

The rest of this module walks each option in more depth. Cloud Run comes next because it is often the simplest production home for a container that already works locally and needs a managed service around it.

## References

- [What is Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run) - Official Cloud Run overview for services, jobs, functions, and managed runtime behavior.
- [Compute Engine instances](https://docs.cloud.google.com/compute/docs/instances) - Official Compute Engine documentation for VM instances and related instance operations.
- [Write Cloud Run functions](https://docs.cloud.google.com/run/docs/write-functions) - Official guide for HTTP and event-driven Cloud Run functions.
- [Google Kubernetes Engine documentation](https://docs.cloud.google.com/kubernetes-engine/docs) - Official GKE documentation for clusters and workload deployment.
