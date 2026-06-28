---
title: "GCP Core Services Map"
description: "Map one application request to the core Google Cloud services behind traffic, compute, data, identity, releases, and operations."
overview: "A first GCP service map connects one real application request to the service families that run, protect, store, deploy, and observe it. This article follows a ticket-booking API across Cloud Run, load balancing, Cloud SQL, Cloud Storage, service accounts, Secret Manager, Artifact Registry, Cloud Build, and Cloud Operations."
tags: ["gcp", "cloud-run", "cloud-sql", "cloud-storage"]
order: 1
id: article-cloud-providers-gcp-foundations-gcp-core-services-map
aliases:
  - core-services
  - gcp-core-services-map
  - cloud-providers/gcp/foundations/gcp-core-services-map.md
---

## Table of Contents

1. [The Map We Are Building](#the-map-we-are-building)
2. [Traffic: Getting the Request to the Backend](#traffic-getting-the-request-to-the-backend)
3. [Runtime: Choosing Where the Code Runs](#runtime-choosing-where-the-code-runs)
4. [State: Choosing Where the Data Lives](#state-choosing-where-the-data-lives)
5. [Identity and Secrets: Letting the Code Call GCP Safely](#identity-and-secrets-letting-the-code-call-gcp-safely)
6. [Delivery: Turning Source Code Into a Safe Release](#delivery-turning-source-code-into-a-safe-release)
7. [Operations: Logs, Metrics, Traces, and First Production Review](#operations-logs-metrics-traces-and-first-production-review)
8. [What's Next](#whats-next)

## The Map We Are Building
<!-- section-summary: A GCP service map connects each job in one real application request to the service family that usually owns that job. -->

Imagine you have already built a small API on your laptop. It listens on `localhost:8080`, accepts a checkout request, writes an order row, saves a receipt file, and prints logs to the terminal. That local app already has the same jobs a cloud app has. It needs an entry point, a runtime, durable data, a safe way to read secrets, a release path, and evidence when something breaks.

A **GCP service map** ties those jobs to Google Cloud services. The map keeps the first conversation practical. Instead of opening the whole Google Cloud product catalog, we follow one request and ask which service family owns each job. In this article the request belongs to `ticket-api`, a backend for a small event-ticketing company. A customer chooses two seats, presses Buy, and waits for a ticket with a QR code.

That single request needs several pieces. The browser needs an HTTPS entry point. The API code needs a runtime. The seat reservation needs a relational transaction. The ticket PDF needs object storage. The payment provider token needs a secret store. The release needs a build artifact and a deployed version. The team needs logs, metrics, traces, and rollback evidence when launch traffic arrives.

A **managed service** means Google operates part of the platform for you, such as servers, request routing, scaling systems, database maintenance workflows, or logging pipelines. The team still owns application design, security choices, data shape, cost review, release decisions, and production behavior. Managed services reduce machine care, and they do not remove engineering responsibility.

![One request, six GCP jobs](/content-assets/articles/article-cloud-providers-gcp-foundations-gcp-core-services-map/request-service-map.png)
*A checkout request is easier to place when each service name is tied to a job: entry, runtime, state, secrets, evidence, and review.*

Here is the first service map for the ticketing API. The table gives each product family a job, then the rest of the article walks through the request in the same order.

| Application job | Common GCP services | What the team checks first |
|---|---|---|
| Accept web or mobile traffic | **Cloud Run ingress**, **Cloud Load Balancing**, **Cloud Armor** | domain, TLS, route, allowed callers, protection policy |
| Run backend code | **Cloud Run**, **Compute Engine**, **Google Kubernetes Engine** | container contract, scaling behavior, operating-system ownership |
| Store relational business data | **Cloud SQL**, **AlloyDB**, **Spanner** | transactions, backups, high availability, connection path |
| Store files, exports, and backups | **Cloud Storage** | bucket location, access control, lifecycle rule, retention rule |
| Store document-style app state | **Firestore** | document shape, indexes, query pattern, consistency needs |
| Analyze historical data | **BigQuery** | dataset location, partitioning, query cost, dashboard access |
| Give workloads an identity | **Service accounts**, **IAM**, **Application Default Credentials** | least privilege, attached service account, key-file avoidance |
| Store secrets and config safely | **Secret Manager**, **Cloud KMS** | secret versions, runtime access, rotation path, encryption needs |
| Build and release software | **Cloud Build**, **Artifact Registry**, **Cloud Deploy**, **Cloud Run revisions** | image tag, provenance, approval, rollout, rollback |
| See what happened in production | **Cloud Logging**, **Cloud Monitoring**, **Cloud Trace**, **Error Reporting** | logs, metrics, alerts, latency traces, error groups |

The first path stays small. The browser calls a public HTTPS endpoint. The request reaches Cloud Run. Cloud Run writes order data to Cloud SQL, saves the ticket PDF in Cloud Storage, reads a payment token from Secret Manager, and sends production evidence to Cloud Logging, Cloud Monitoring, and Cloud Trace.

That path gives the rest of the article a natural order. Traffic reaches the platform first, so we start at the entry point. After that, the request needs running code, and the runtime choice decides how much infrastructure work the team accepts.

## Traffic: Getting the Request to the Backend
<!-- section-summary: Traffic services receive callers, apply the first routing and protection decisions, and send the request to the backend runtime. -->

**Traffic** means the path a request takes before it reaches your application code. For `ticket-api`, traffic starts in a browser or mobile app and arrives as an HTTPS request. The first GCP decision is the entry point: a direct Cloud Run HTTPS URL for a small service, or a load balancer in front of one or more backends for shared domains, route rules, custom TLS control, private patterns, and edge protection.

**TLS certificates** are the files browsers use to verify and encrypt HTTPS connections. In a small service, Cloud Run can provide a direct HTTPS endpoint. In a larger production setup, the load balancer often owns the public domain and certificate, then forwards accepted traffic to the backend service.

**Cloud Run** is Google Cloud's managed way to run a containerized web service. A **container** is a packaged application process with its runtime files and dependencies. **Ingress** means the entry path into a service, so Cloud Run ingress controls which callers can reach the service.

**Cloud Load Balancing** sits in front of one or more backends and decides where each request should go. In a production ticketing system, the same domain might route `/api/*` to the API, `/assets/*` to static files, and `/admin/*` to a separate service. **Cloud Armor** can add edge security rules such as allowlists, denylists, rate-based controls, and preconfigured web attack protections.

A first Cloud Run service can start with one direct deploy. The command below creates or updates the service named `ticket-api` with one container image. It includes four important choices: `--image` points to the exact container image, `--region` places the service, `--allow-unauthenticated` lets public callers invoke it, and `--service-account` attaches the workload identity the code will use when calling other Google Cloud APIs.

```bash
gcloud run deploy ticket-api \
  --image=us-central1-docker.pkg.dev/ticket-prod/apps/ticket-api:2026-06-14-8f31c2a \
  --region=us-central1 \
  --allow-unauthenticated \
  --service-account=ticket-api@ticket-prod.iam.gserviceaccount.com
```

A beginner should expect output that names the service URL and the deployed revision. The URL confirms where public traffic enters, and the revision gives operations a version name to use later during rollback.

```console
Deploying container to Cloud Run service [ticket-api] in project [ticket-prod] region [us-central1]
OK Deploying new service... Done.
  OK Creating Revision...
  OK Routing traffic...
Done.
Service [ticket-api] revision [ticket-api-00001-xad] has been deployed and is serving 100 percent of traffic.
Service URL: https://ticket-api-uc.a.run.app
```

That first service now has a managed HTTPS entry point. A mature setup may put an external Application Load Balancer in front of Cloud Run through a serverless network endpoint group, which is the load balancer's way to point traffic at a serverless backend. The direct service URL is enough for orientation, while a later networking article can go deep on load balancer resources, certificates, DNS, and private routing.

Traffic gets the customer request to the backend boundary. The next question is where the backend process runs. GCP gives several compute shapes, and each one changes the amount of platform work the team owns.

## Runtime: Choosing Where the Code Runs
<!-- section-summary: Runtime services run the application code, and the main choice is how much infrastructure control the team needs. -->

**Runtime** means the place where your application process runs. For `ticket-api`, that process might be a Node.js, Go, Java, Python, or Rust HTTP server. GCP can run that code as a managed container service, as a virtual machine process, or as a Kubernetes workload.

Cloud Run is the natural first runtime for many backend APIs because it runs containers on managed infrastructure. The team provides a container image, sets CPU and memory, configures environment variables and secrets, and Cloud Run handles request routing to running instances. The container needs to follow the Cloud Run container contract, including listening on the port from the `PORT` environment variable and writing logs to standard output and standard error.

![Runtime choices by ownership](/content-assets/articles/article-cloud-providers-gcp-foundations-gcp-core-services-map/runtime-ownership-map.png)
*Runtime choice is an ownership choice. The more control the team asks for, the more operating work the team must plan for.*

The Cloud Run deploy grows as the service map fills in. The next version connects the runtime to Cloud SQL, environment variables, and Secret Manager. The command still deploys one service, but it now shows how compute, data, identity, and configuration meet at runtime.

```bash
gcloud run deploy ticket-api \
  --image=us-central1-docker.pkg.dev/ticket-prod/apps/ticket-api:2026-06-14-8f31c2a \
  --region=us-central1 \
  --service-account=ticket-api@ticket-prod.iam.gserviceaccount.com \
  --add-cloudsql-instances=ticket-prod:us-central1:ticket-db \
  --set-env-vars=ENV=prod,RECEIPT_BUCKET=ticket-receipts-prod \
  --set-secrets=PAYMENT_API_KEY=payment-api-key:latest
```

The flags carry production meaning. `--add-cloudsql-instances` connects the service to the Cloud SQL instance through the managed connection path. `--set-env-vars` passes non-secret runtime settings into the container. `--set-secrets` maps a Secret Manager secret version into the runtime, so the payment key can rotate without baking a secret into the image.

After deployment, a read-only describe command helps a beginner verify the runtime facts without changing anything.

```bash
gcloud run services describe ticket-api \
  --region=us-central1 \
  --project=ticket-prod \
  --format="yaml(status.url,spec.template.spec.serviceAccountName,spec.template.metadata.annotations,spec.template.spec.containers[0].env)"
```

Useful output should show the service URL, the attached service account, the Cloud SQL connection annotation, and the environment variables or secret references. Healthy output names the expected service account and the expected database instance.

```yaml
status:
  url: https://ticket-api-uc.a.run.app
spec:
  template:
    metadata:
      annotations:
        run.googleapis.com/cloudsql-instances: ticket-prod:us-central1:ticket-db
    spec:
      serviceAccountName: ticket-api@ticket-prod.iam.gserviceaccount.com
      containers:
      - env:
        - name: ENV
          value: prod
        - name: RECEIPT_BUCKET
          value: ticket-receipts-prod
        - name: PAYMENT_API_KEY
          valueFrom:
            secretKeyRef:
              key: latest
              name: payment-api-key
```

**Compute Engine** runs virtual machines. A **virtual machine** is a software server with its own operating system, CPU, memory, disk, and network settings. Teams usually pick it for workloads that need operating-system control, special agents, custom startup scripts, unusual networking, licensed software, persistent local processes, or migration compatibility with existing servers.

**Google Kubernetes Engine**, usually shortened to **GKE**, runs Kubernetes clusters on Google Cloud. **Kubernetes** is a platform for running many containers across a group of machines with deployment, networking, and scheduling rules. Teams usually pick GKE when they already need Kubernetes APIs, many services sharing one cluster platform, admission policies, sidecars, custom controllers, service meshes, or fine-grained pod scheduling.

The ticketing company can start with Cloud Run because `ticket-api` has a clean container boundary and request-based traffic. Later, the team might keep the API on Cloud Run, move long-running stream processors to GKE, and keep a legacy batch service on Compute Engine. The service map stays useful because each runtime has a job.

At this point, the API can receive a request and run code. The request still needs durable state, because checkout data must survive container restarts and scale-downs.

## State: Choosing Where the Data Lives
<!-- section-summary: Data services split by data shape, so each part of the application state goes to the service that matches how the app reads and writes it. -->

**State** means data the system must remember after one request finishes. In `ticket-api`, the order row, seat reservation, payment status, ticket PDF, customer support notes, and sales dashboard history all count as state. GCP has several data services because each kind of state has a different shape and access pattern.

**Relational data** means data organized in tables with relationships between records, such as `orders`, `customers`, `seats`, and `payments`. A **transaction** is a group of database changes that succeeds or rolls back as one unit, which matters when two customers try to buy the same seat. **Cloud SQL** is Google Cloud's managed relational database service for PostgreSQL, MySQL, and SQL Server, so it fits ordinary application records that need SQL, transactions, indexes, constraints, and familiar database tooling.

The first command creates the managed PostgreSQL instance, and the second creates the application database inside it. `--availability-type=REGIONAL` asks Cloud SQL to use a high availability configuration in the selected region, and `--tier` chooses CPU and memory shape for the instance.

```bash
gcloud sql instances create ticket-db \
  --database-version=POSTGRES_16 \
  --region=us-central1 \
  --availability-type=REGIONAL \
  --tier=db-custom-2-7680

gcloud sql databases create tickets \
  --instance=ticket-db
```

A beginner should look for the instance name, database version, region, and state after creation. The exact operation ID can vary, but `RUNNABLE` or a successful create message tells the team the database is ready for follow-up configuration.

```console
Creating Cloud SQL instance for POSTGRES_16...done.
Created [https://sqladmin.googleapis.com/sql/v1beta4/projects/ticket-prod/instances/ticket-db].

Created database [tickets].
```

A real production review would also check automated backups, point-in-time recovery, maintenance windows, database flags, user management, connection limits, and whether the application reaches the database through an approved private or managed connection path. Cloud SQL removes much of the database operations burden, but the team still owns schema design, indexes, query behavior, migrations, and capacity choices.

**Cloud Storage** stores objects in buckets. An object is file-like data plus metadata, such as `tickets/2026/06/order-88421.pdf` or `exports/daily-sales-2026-06-14.csv`. The ticketing API can store generated ticket PDFs in Cloud Storage because a PDF works as durable object data with metadata, lifecycle rules, and bucket access policies.

```bash
gcloud storage buckets create gs://ticket-receipts-prod \
  --location=us-central1 \
  --uniform-bucket-level-access
```

The `--location` flag places the bucket data, and `--uniform-bucket-level-access` makes access depend on bucket-level IAM instead of a mixture of IAM and object ACLs. Useful output should confirm the bucket URI.

```console
Creating gs://ticket-receipts-prod/...
```

The bucket should have a clear location, lifecycle policy, access policy, and retention decision. For example, ticket PDFs may need to stay available for customer support for one year, while temporary export files may expire after seven days. The same storage service can hold both, but lifecycle rules and naming conventions help the team treat them differently.

**Firestore** is a document database. It fits data that naturally lives as documents and collections, such as user preferences, shopping-cart drafts, notification state, or mobile app sync data. For `ticket-api`, Firestore could hold a short-lived checkout session document while the customer moves through the payment flow.

**BigQuery** is an analytics data warehouse. It fits historical questions such as "Which shows sold out fastest?", "Which campaign produced refunds?", or "What was checkout latency during the launch hour?" The application can keep the source-of-truth order in Cloud SQL and send clean event data into BigQuery for reporting and later analysis.

**Pub/Sub** and **Memorystore** often appear near the data layer, even though they serve different jobs. Pub/Sub moves messages between systems, such as sending `ticket.purchased` events to an email worker after checkout. Memorystore provides managed Redis or Valkey-style caching, which can help with hot read paths such as event metadata that many buyers request at the same time.

The API can now run and save data, but one question remains before it can safely call these services. The code needs permission. In GCP, that leads directly to service accounts, IAM roles, Application Default Credentials, and Secret Manager.

## Identity and Secrets: Letting the Code Call GCP Safely
<!-- section-summary: Identity and secret services give the runtime scoped access to GCP APIs without storing long-lived keys inside the application. -->

**Identity** answers which caller is making a request to Google Cloud. For a running application, the caller should usually be a **service account**, which is a special Google Cloud account meant for workloads instead of humans. The `ticket-api` service account can receive only the permissions needed to read its secret, connect to Cloud SQL, write ticket PDFs, and emit telemetry.

**IAM**, or Identity and Access Management, grants permissions through roles on resources. A **principal** is the identity that receives access, and a **role** is a bundle of permissions such as reading secrets or connecting to Cloud SQL. A binding connects a principal to a role on a project, folder, organization, or individual resource.

These two commands grant database connection permission at the project level and object-write style permission on one bucket. The important detail is scope: the Cloud SQL role applies to the project because the connection permission is project-scoped, while the Storage role is attached directly to the receipts bucket.

```bash
gcloud projects add-iam-policy-binding ticket-prod \
  --member=serviceAccount:ticket-api@ticket-prod.iam.gserviceaccount.com \
  --role=roles/cloudsql.client

gcloud storage buckets add-iam-policy-binding gs://ticket-receipts-prod \
  --member=serviceAccount:ticket-api@ticket-prod.iam.gserviceaccount.com \
  --role=roles/storage.objectUser
```

The output usually includes the updated policy. A beginner should find the role and service account in the bindings rather than trusting that the command succeeded.

```yaml
bindings:
- members:
  - serviceAccount:ticket-api@ticket-prod.iam.gserviceaccount.com
  role: roles/cloudsql.client
etag: BwYJ6u2x3mQ=
version: 1
```

**Application Default Credentials**, often called **ADC**, is the strategy Google client libraries use to find credentials automatically. In local development, ADC can use credentials created by `gcloud auth application-default login`. In production on Cloud Run, ADC can use the attached service account through the metadata server, which is a local runtime endpoint that gives the workload short-lived identity information without putting downloaded key files in the application.

The application code can stay simple because the library handles credential lookup. The example below writes a ticket PDF to the bucket named in runtime configuration. The same code can run locally with developer ADC and in production with the attached service account.

```js
import {Storage} from "@google-cloud/storage";

const storage = new Storage();

export async function saveTicketPdf(orderId, pdfBuffer) {
  await storage
    .bucket(process.env.RECEIPT_BUCKET)
    .file(`tickets/${orderId}.pdf`)
    .save(pdfBuffer, {
      contentType: "application/pdf",
      resumable: false
    });
}
```

The important fields are `RECEIPT_BUCKET`, which selects the bucket, and `contentType`, which tells consumers the object is a PDF. The code has no JSON key file path because the client library asks ADC for credentials. That keeps long-lived private keys out of the container image, out of environment variables, and out of source control.

**Secret Manager** stores sensitive values such as API tokens, webhook signing secrets, database passwords for legacy clients, and private certificates. A secret has versions, so rotation can add a new version while the application keeps the same secret name.

```bash
printf "%s" "$PAYMENT_API_KEY" | gcloud secrets create payment-api-key \
  --data-file=- \
  --replication-policy=automatic

gcloud secrets add-iam-policy-binding payment-api-key \
  --member=serviceAccount:ticket-api@ticket-prod.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

`--data-file=-` reads the secret payload from standard input, and `--replication-policy=automatic` lets Google manage secret replication. The IAM binding output should show the runtime service account under `roles/secretmanager.secretAccessor`.

Identity and secrets give the running service scoped access to the rest of GCP. After that, the team needs a repeatable way to build the container, store the artifact, release it, and move traffic.

## Delivery: Turning Source Code Into a Safe Release
<!-- section-summary: Delivery services create a chain from source code to image, deployed revision, traffic movement, and rollback evidence. -->

**Delivery** means the path from source code to a running production version. For `ticket-api`, a healthy delivery path builds a container image, stores it in a registry, deploys it to Cloud Run, records the new revision, moves traffic in a controlled way, and leaves enough evidence for a reviewer during an incident. A **registry** is a storage place for build artifacts, and a **revision** is a named Cloud Run version created from one deploy.

**Artifact Registry** stores build artifacts such as container images and language packages. A production Cloud Run deployment should point at a clear image tag, digest, commit SHA, or build number. Tags like `latest` make operations work harder because the running service no longer points clearly to one build.

The first command creates a Docker repository in Artifact Registry. The second command builds the current source tree and pushes one tagged image. `--repository-format=docker` selects container image storage, `--location` places the repository, and `--tag` names the image that Cloud Run will deploy.

```bash
gcloud artifacts repositories create apps \
  --repository-format=docker \
  --location=us-central1

gcloud builds submit \
  --tag=us-central1-docker.pkg.dev/ticket-prod/apps/ticket-api:2026-06-14-8f31c2a
```

Useful output links the build to a build ID and the pushed image. In a real pipeline, that build ID should connect back to source commit, test result, and approval evidence.

```console
Created repository [apps].

Creating temporary archive of 48 file(s) totalling 1.8 MiB before compression.
Uploading tarball of [.] to [gs://ticket-prod_cloudbuild/source/1718370000.123456.tgz]
Created [https://cloudbuild.googleapis.com/v1/projects/ticket-prod/locations/global/builds/7a52c9d1-91a6-4a0d-8c2a-7c6e9d7f21b4].
PUSH: us-central1-docker.pkg.dev/ticket-prod/apps/ticket-api:2026-06-14-8f31c2a
DONE
```

**Cloud Run revisions** are the deploy history for a Cloud Run service. Every configuration change creates a new revision, including a new image, environment variable, secret mount, CPU setting, memory setting, or service account. This gives the team a built-in release record and a direct traffic target.

During rollback, this command sends all traffic back to a known good revision. The team gets the revision name from service history before running the command.

```bash
gcloud run services update-traffic ticket-api \
  --region=us-central1 \
  --to-revisions=ticket-api-00042-good=100
```

Expected output should confirm the traffic split. If the output still shows traffic on a bad revision, the rollback is incomplete.

```console
Updating traffic...done.
Traffic:
  100% ticket-api-00042-good
```

**Cloud Deploy** is Google Cloud's managed continuous delivery service. It can define targets, delivery pipelines, approvals, and promotion flow across environments. For a beginner service, direct Cloud Build to Cloud Run may be enough. A team with dev, staging, and production usually benefits from a delivery tool that records promotion decisions and standardizes the release path.

The release path connects back to everything we have covered. A new image changes what code runs. A new revision may use a different service account, secret version, or database connection. A safe delivery process gives the team one place to answer what changed, who approved it, and how to roll back.

After the release reaches production, the service still needs evidence. The team needs to see errors, latency, traffic, saturation, and request traces without logging into containers or guessing from customer reports.

## Operations: Logs, Metrics, Traces, and First Production Review
<!-- section-summary: Operations services turn production behavior into evidence, and a first production review checks access, data safety, release safety, reliability, and cost. -->

**Operations** means the everyday work of understanding and improving a running system. For `ticket-api`, operations includes reading logs after a failed checkout, watching error rate during a launch, tracing a slow request through Cloud Run and Cloud SQL, and receiving alerts before customers flood support. Google Cloud groups much of this under Cloud Operations, especially Cloud Logging, Cloud Monitoring, Cloud Trace, and Error Reporting.

The first operations words are simple. A **log** is a record of something that happened, such as a checkout error or payment-provider response. A **metric** is a number over time, such as request count, error rate, latency, CPU, or memory. A **trace** follows one request across several steps, which helps the team see where time went during a slow checkout.

**Cloud Logging** collects logs from Google Cloud services and from application output. Cloud Run automatically captures standard output and standard error from the container, so a structured log line from the application can show up with resource labels such as service name, revision, project, and region. The team should include useful fields such as `order_id`, `request_id`, `payment_provider`, and `release_sha`, while keeping payment tokens, passwords, and unnecessary personal data out of logs.

This command reads recent error logs for one Cloud Run service. The query filters on the Cloud Run resource type, the service name, and severity, while `--limit` keeps the first investigation small.

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="ticket-api" AND severity>=ERROR' \
  --limit=20 \
  --project=ticket-prod
```

Helpful output should show a timestamp, severity, revision, and the application message. The revision label is especially useful when a new release caused the problem.

```yaml
---
insertId: 6f6x2k9f8c3
severity: ERROR
timestamp: "2026-06-14T19:05:12.481Z"
resource:
  labels:
    service_name: ticket-api
    revision_name: ticket-api-00043-bad
textPayload: "payment authorization failed: provider timeout after 3000ms"
```

**Cloud Monitoring** collects metrics and powers dashboards and alerting policies. For a Cloud Run API, first metrics usually include request count, request latency, error count, container instance count, CPU usage, memory usage, and database connection pressure. A ticket launch needs alerts on user-facing symptoms such as high 5xx rate or checkout latency, because those symptoms show customer impact better than a single CPU graph.

**Cloud Trace** helps follow request latency across services. If checkout takes four seconds, Trace can show time spent in the handler, payment call, database query, and object upload when the application emits trace context correctly. Trace matters more as the system adds workers, events, and multiple services, because one customer request can spread across several places.

**Error Reporting** groups application errors so the team can see repeated failures without reading every log line manually. A single bad null reference might produce hundreds of logs during a launch. Error grouping helps the team find the main failure pattern, assign ownership, and connect it to a release or dependency issue.

![First production review map](/content-assets/articles/article-cloud-providers-gcp-foundations-gcp-core-services-map/production-review-map.png)
*The first production review walks across the same service map: traffic, runtime, state, identity, delivery, and operations.*

A first production review should walk through the service map and ask concrete questions. The traffic layer needs a domain, TLS, allowed caller rules, and Cloud Armor decisions. The runtime needs CPU, memory, concurrency, min or max instances, region choice, and a known service account. The data layer needs backups, restore tests, lifecycle rules, retention choices, indexes, and connection limits.

The identity review should confirm that humans and workloads have separate identities. The Cloud Run service should use a dedicated service account, and that service account should have only the roles needed for Cloud SQL, Cloud Storage, Secret Manager, and telemetry. Service account keys should be absent unless a documented legacy integration truly requires them.

The delivery review should confirm that every production revision points to a traceable image. The team should know how to find the active revision, compare it with the previous one, move traffic back, and explain who approved the release. A rollback path needs practice before the team depends on it during an incident.

The operations review should confirm that the team can answer customer-impact questions quickly. What is the current error rate? Which revision produced the errors? Did latency rise after the deploy? Did Cloud SQL reach connection limits? Did the payment provider fail, or did the application fail before calling it?

The service map now has a full request path. A customer request enters through traffic services, runs on a compute service, reads and writes data services, uses a workload identity, depends on secrets, ships through a delivery path, and leaves operational evidence. That is the first practical map of Google Cloud for application builders.

## What's Next

This article stayed at the application-service level. We named the core services and connected them to one request, because that gives every later GCP topic a practical anchor. The next foundation step is the account structure underneath those services: projects, billing accounts, regions, zones, APIs, and the resource hierarchy.

Those pieces decide where the services live, who pays for them, which APIs can run, and how teams separate development, staging, and production. After that, service maps are easier to apply because every resource has a project boundary, a location decision, and a billing trail.

---

**References**

- [What is Cloud Run](https://cloud.google.com/run/docs/overview/what-is-cloud-run) - Explains Cloud Run services, jobs, worker pools, containerized workloads, scaling, revisions, and managed runtime behavior.
- [Cloud Run container runtime contract](https://cloud.google.com/run/docs/container-contract) - Documents how Cloud Run containers receive ports, requests, signals, filesystems, and logs.
- [Cloud Run service identity](https://cloud.google.com/run/docs/securing/service-identity) - Explains how Cloud Run uses service accounts as runtime identities.
- [Cloud Run rollbacks and traffic migration](https://cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration) - Documents gradual rollouts, traffic splits, revision tags, and rollback patterns.
- [Cloud Load Balancing overview](https://cloud.google.com/load-balancing/docs/load-balancing-overview) - Describes Google Cloud load balancing families and traffic distribution patterns.
- [Cloud Armor overview](https://cloud.google.com/armor/docs/cloud-armor-overview) - Explains edge security policies, WAF rules, and DDoS-related protection features.
- [Cloud SQL overview](https://cloud.google.com/sql/docs/introduction) - Defines Cloud SQL as a managed relational database service for MySQL, PostgreSQL, and SQL Server.
- [Connect from Cloud Run to Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres/connect-run) - Documents Cloud Run connection options and IAM requirements for Cloud SQL.
- [Cloud Storage overview](https://cloud.google.com/storage/docs/introduction) - Explains buckets, objects, locations, storage classes, lifecycle management, and access control.
- [Firestore overview](https://cloud.google.com/firestore/docs/overview) - Describes Firestore as a document database for mobile, web, and server development.
- [BigQuery overview](https://cloud.google.com/bigquery/docs/introduction) - Explains BigQuery as a serverless analytics data warehouse.
- [Pub/Sub overview](https://cloud.google.com/pubsub/docs/overview) - Describes topics, subscriptions, and asynchronous message delivery.
- [Service accounts overview](https://cloud.google.com/iam/docs/service-account-overview) - Defines service accounts and common workload identity use cases.
- [How Application Default Credentials works](https://cloud.google.com/docs/authentication/application-default-credentials) - Documents how Google authentication libraries find credentials in development and production.
- [Secret Manager overview](https://cloud.google.com/security/products/secret-manager) - Describes managed storage and access control for secrets.
- [Artifact Registry overview](https://cloud.google.com/artifact-registry/docs/overview) - Explains managed repositories for container images and build artifacts.
- [Cloud Build overview](https://cloud.google.com/build/docs/overview) - Describes managed build steps, triggers, and CI/CD workflows.
- [Cloud Deploy overview](https://cloud.google.com/deploy/docs/overview) - Describes delivery pipelines, targets, promotion, and deployment automation.
- [Cloud Logging overview](https://cloud.google.com/logging/docs/overview) - Explains log collection, querying, routing, and analysis.
- [Cloud Monitoring overview](https://cloud.google.com/monitoring/docs/monitoring-overview) - Documents metrics, dashboards, alerting, and observability workflows.
- [Cloud Trace overview](https://cloud.google.com/trace/docs/overview) - Explains distributed tracing for latency analysis.
- [Cloud Billing budgets and alerts](https://cloud.google.com/billing/docs/how-to/budgets) - Documents budgets and alerts for cost monitoring.
