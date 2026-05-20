---
title: "GCP Core Services Map"
description: "Choose the first GCP service family to inspect by asking which app job needs help."
overview: "After projects, placement, and resource identity, the service list becomes easier to read as a map of jobs. This article follows one Orders API through traffic, compute, state, access, signals, deployment, cost, and recovery."
tags: ["gcp", "cloud-run", "cloud-sql", "cloud-storage"]
order: 4
id: article-cloud-providers-gcp-foundations-gcp-core-services-map
aliases:
  - core-services
  - gcp-core-services-map
  - cloud-providers/gcp/foundations/gcp-core-services-map.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Job-Based Map](#job-based-map)
3. [Orders API](#orders-api)
4. [Traffic](#traffic)
5. [Compute](#compute)
6. [State](#state)
7. [Access](#access)
8. [Signals](#signals)
9. [Deployment](#deployment)
10. [Cost And Recovery](#cost-and-recovery)
11. [Debugging With The Map](#debugging-with-the-map)
12. [Putting It All Together](#putting-it-all-together)

## The Problem

The team can now place a GCP workload and identify exact resources. The last foundation step is service choice.

This is where the product list gets noisy. A beginner opens Google Cloud and sees Cloud Run, Compute Engine, GKE, Cloud Functions, Cloud SQL, Cloud Storage, Firestore, BigQuery, Cloud Load Balancing, Cloud DNS, Secret Manager, IAM, Cloud Logging, Cloud Monitoring, Artifact Registry, Cloud Build, Billing, and more.

The mistake is to ask for direct replacements too early:

```text
What is the GCP ECS?
What is the GCP S3?
What is the GCP CloudWatch?
```

Those questions can orient you, but they are too narrow. The better beginner question is:

> Which GCP service family should I look at first for this app need?

This article builds that map around `devpolaris-orders-api`. Each section starts with the app job, then names the GCP services that usually belong in the first conversation.

## Job-Based Map

Read the map from left to right. The job comes first. The service family comes second. The exact service name comes last.

| Guiding question | GCP service family | GCP services to recognize |
| --- | --- | --- |
| What handles public traffic? | Traffic entry | Cloud Load Balancing, Cloud DNS, certificates, Cloud Run service URL, API Gateway. |
| Where does code run? | Compute | Cloud Run, Compute Engine, GKE, Cloud Functions. |
| Where does state live? | Storage and databases | Cloud SQL, Cloud Storage, Firestore, BigQuery, Persistent Disk. |
| Who grants access? | Identity and secrets | IAM, service accounts, Secret Manager. |
| Where do logs, metrics, traces, and alerts live? | Observability | Cloud Logging, Cloud Monitoring, Cloud Trace, Error Reporting. |
| Which services help deployment? | Release operations | Artifact Registry, Cloud Build, Cloud Deploy, CI/CD tools. |
| Which services help cost and recovery? | Cost and resilience | Cloud Billing, budgets, labels, backups, redundancy, service-specific recovery. |

An AWS or Azure bridge can sit beside this, but it should not drive the design alone.

| If AWS or Azure made you think of... | Ask this GCP job question |
| --- | --- |
| ALB, Route 53, Front Door, Application Gateway | What owns DNS, TLS, routing, and backend health? |
| ECS, Lambda, App Service, Container Apps | What runtime shape does this code need? |
| S3, Blob Storage, RDS, Azure SQL | What kind of state is this: object, relational, document, disk, or analytic? |
| IAM roles, managed identities, Key Vault | Which principal needs which permission or secret? |
| CloudWatch, Azure Monitor | Where will logs, metrics, traces, and alerts live? |

The comparison is a bridge. The GCP mechanism still has to be checked in GCP terms.

## Orders API

The running example is `devpolaris-orders-api`. It receives checkout requests, writes order records, creates receipt files, reads a database secret, emits logs, and needs repeatable releases.

Before choosing services, write the jobs in app language:

```text
orders API needs:
  public traffic to reach the app
  backend code to keep running
  order records to persist
  receipt files to persist
  private config to stay private
  logs and metrics after the process exits
  container images before runtime deploy
  cost and recovery controls before the app grows
```

That list is more useful than a product menu. It tells you what question each service is supposed to answer.

## Traffic

Traffic is the path from users to healthy code. In GCP, the first traffic conversation depends on the runtime and exposure pattern.

Cloud Run can expose an HTTPS service URL and can also sit behind external Application Load Balancers for custom routing, shared entry points, security controls, or more complex traffic management. Cloud DNS can own the public name. Certificates handle TLS. API Gateway can sit in front of APIs when the gateway job matters.

For the first Orders API, traffic might be:

```text
api.devpolaris.example -> HTTPS entry -> Cloud Run service
```

The habit is to separate name, TLS, routing, and runtime. A DNS record can be correct while the Cloud Run service is unhealthy. A Cloud Run service can be healthy while the load balancer target or certificate is wrong.

## Compute

Compute is where code runs. GCP gives several shapes:

| Runtime | Good first mental model |
| --- | --- |
| Cloud Run | Run a containerized service without managing servers. |
| Compute Engine | Run VM-shaped workloads when the machine shape matters. |
| GKE | Run Kubernetes when the team needs Kubernetes control and ecosystem. |
| Cloud Functions | Run event-triggered code for small function-shaped work. |

Cloud Run is often the easiest first fit for a containerized backend. It creates revisions when you deploy, can route traffic between revisions, and scales service instances based on requests and configuration.

The gotcha is that "serverless" still has operating choices. Concurrency, CPU, memory, minimum instances, service account, environment variables, VPC connectivity, and revision traffic all affect behavior and cost.

## State

State is everything the app must remember after a process exits.

For the Orders API:

| Data shape | GCP service to inspect first |
| --- | --- |
| Relational order records | Cloud SQL. |
| Receipt files | Cloud Storage. |
| Document-style app data | Firestore. |
| Analytics tables | BigQuery. |
| VM-attached disk state | Persistent Disk. |

Cloud SQL is a managed relational database service for MySQL, PostgreSQL, and SQL Server. Cloud Storage stores objects inside buckets. BigQuery is for analytic tables, not a normal request-path application database. Firestore is document-oriented.

Choose by data shape and access pattern, not by which service name feels familiar from another cloud. A receipt file and an order row are both "data," but they do not want the same service.

## Access

Access decides who or what can act. GCP IAM grants roles to principals on resources or hierarchy scopes. Service accounts are principals for machine workloads.

The Orders API needs at least two access stories:

| Caller | Access question |
| --- | --- |
| Deployment caller | Can it deploy Cloud Run, read images, and update the right service? |
| Runtime service account | Can the app read its secret, connect to the database path, and write receipts? |

Secret Manager belongs in this conversation because secrets are resources with versions and access policies. A Cloud Run service can have the right image and still fail because its runtime service account cannot access the secret or database path.

Do not fix access problems by making the app broadly powerful. Match the role to the job and the scope to the resource.

## Signals

Signals are the evidence the team uses after the request leaves one terminal. GCP's first observability services are Cloud Logging, Cloud Monitoring, Cloud Trace, and Error Reporting.

For the Orders API, useful signals might include:

| Signal | What it answers |
| --- | --- |
| Request logs | Did checkout receive requests and what status did it return? |
| Error logs | What failed and where? |
| Metrics | Is latency, error rate, instance count, CPU, memory, or database pressure changing? |
| Traces | Which downstream call made a request slow? |
| Alerts | Who is notified when the service promise is at risk? |

Signals should be tied to the service map. If checkout fails, the team should know whether to inspect Cloud Run logs, Cloud SQL metrics, load balancer health, Secret Manager access, or deployment revisions first.

## Deployment

Deployment is how code becomes runtime. For a containerized GCP app, the basic flow often includes:

```text
source -> build -> container image -> Artifact Registry -> Cloud Run revision -> traffic
```

Artifact Registry stores container images and other build artifacts. Cloud Build can build from source. Existing CI/CD tools can also build and deploy. Cloud Run creates an immutable revision when the service configuration changes.

The key foundation idea is that deployment has resources too. The image repository, deployer identity, runtime service account, revision, and traffic split are all part of the service. When a release goes wrong, the team needs evidence across that path.

## Cost And Recovery

Cost and recovery are not later paperwork. They are part of the first service map.

Cost starts with the project and billing account, then becomes visible through service usage and labels. A Cloud Run service with minimum instances behaves differently from one that scales to zero. Cloud Logging volume can grow with noisy logs. Cloud Storage cost grows with objects, versions, locations, and operations. Cloud SQL cost follows instance configuration, storage, backups, and availability choices.

Recovery starts with the data and runtime promises. Cloud SQL backups, Cloud Storage object protection, multi-zone or regional choices, and tested restore steps all matter. A service can be "managed" and still lack a recovery plan that the team has practiced.

The foundation habit is to ask:

```text
What does this service cost when idle?
What does it cost when busy?
What data must recover?
What signal proves recovery worked?
```

## Debugging With The Map

The map is a debugging tool.

If customers cannot reach checkout, start with traffic and compute. If the app starts but cannot read the database URL, inspect access and secrets. If orders are accepted but missing from reports, inspect state and downstream jobs. If the bill jumps, group cost by project, service, label, and time. If a release changed behavior, inspect Artifact Registry image, Cloud Run revision, traffic split, runtime config, and logs.

The service name matters after the job is clear.

| Symptom | First map area |
| --- | --- |
| `404` or TLS error | Traffic. |
| Container starts then exits | Compute and runtime config. |
| Permission denied on secret | Access and Secret Manager. |
| Slow checkout writes | State and Cloud SQL. |
| Missing request evidence | Signals. |
| Wrong version serving traffic | Deployment and Cloud Run revisions. |
| Cost spike after release | Cost, labels, logs, scaling, and storage. |

## Putting It All Together

Return to the noisy product list.

- Traffic became DNS, TLS, routing, and backend health.
- Compute became Cloud Run, Compute Engine, GKE, or Cloud Functions depending on runtime shape.
- State became Cloud SQL, Cloud Storage, Firestore, BigQuery, or disks depending on data shape.
- Access became IAM principals, service accounts, roles, and Secret Manager.
- Signals became logs, metrics, traces, alerts, and request evidence.
- Deployment became image, repository, revision, and traffic.
- Cost and recovery became part of the operating map from the start.

The GCP product list is easier once every service has a job in the Orders API story. That closes the foundation module: the next GCP modules can now go deeper into identity, networking, compute, and data without re-teaching the map every time.

---

**References**

- [Cloud Run revisions](https://cloud.google.com/run/docs/managing/revisions)
- [Cloud Run concurrency](https://cloud.google.com/run/docs/about-concurrency)
- [Cloud SQL overview](https://docs.cloud.google.com/sql/docs/introduction)
- [Cloud Storage overview](https://cloud.google.com/storage/docs/introduction)
- [Artifact Registry overview](https://cloud.google.com/artifact-registry/docs/overview)
- [Service accounts overview](https://cloud.google.com/iam/docs/service-account-overview)
