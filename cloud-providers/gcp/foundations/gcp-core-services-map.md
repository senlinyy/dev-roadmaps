---
title: "GCP Core Services Map"
description: "Map one application request to the core Google Cloud services behind traffic, compute, data, identity, releases, and operations."
overview: "A first GCP service map helps you connect one application request to the service families that run, protect, store, deploy, and observe it. The example follows a simple ticket-booking backend and introduces each Google Cloud service only after its job is clear."
tags: ["gcp", "cloud-run", "cloud-sql", "cloud-storage"]
order: 1
id: article-cloud-providers-gcp-foundations-gcp-core-services-map
aliases:
  - core-services
  - gcp-core-services-map
  - cloud-providers/gcp/foundations/gcp-core-services-map.md
---

## Table of Contents

1. [What a GCP Service Map Is](#what-a-gcp-service-map-is)
2. [The Example App](#the-example-app)
3. [Traffic: How Users Reach the App](#traffic-how-users-reach-the-app)
4. [Compute: Where the Code Runs](#compute-where-the-code-runs)
5. [Data: Where the App Keeps State](#data-where-the-app-keeps-state)
6. [Identity and Secrets: How the App Gets Permission](#identity-and-secrets-how-the-app-gets-permission)
7. [Delivery: How Code Turns Into a Release](#delivery-how-code-turns-into-a-release)
8. [Operations: How You Know What Happened](#operations-how-you-know-what-happened)
9. [Putting the Map Together](#putting-the-map-together)
10. [References](#references)

## What a GCP Service Map Is
<!-- section-summary: A GCP service map connects each job in one application request to the Google Cloud service family that usually owns that job. -->

You can understand Google Cloud by looking at an app you already know. Picture a small backend on your laptop. It listens on `localhost:8080`, receives a browser request, writes data, saves a file, reads an API key, prints logs, and returns a response. Nothing about that flow is cloud-specific yet.

That local app already has the same jobs as a cloud app. Someone needs to reach it. The code needs CPU and memory. Data needs to survive after the process stops. Sensitive values need a safer home than one local `.env` file. New code needs a release path. After an outage, you need evidence instead of guesses.

A **GCP service map** connects those application jobs to Google Cloud services. The map answers a practical beginner question: "I know what my app needs to do, so which Google Cloud service usually handles each job?"

For AWS readers, use the same habit you use in AWS: follow one request and separate entry, compute, data, identity, delivery, and operations. The concrete AWS service anchors appear section by section after the matching GCP idea is introduced.

Before naming products, look at the jobs:

| Application job | Plain English question | Ticketing example |
|---|---|---|
| Public entry | How does a user reach the app safely? | A customer opens `tickets.example.com`. |
| Code execution | Where does the backend code run? | The purchase API receives the request and runs business logic. |
| Durable state | Where does the app keep important data? | Seats, payments, ticket PDFs, and events need storage. |
| Permission | Which identity may the app use? | The backend needs permission to write files and read secrets. |
| Sensitive values | Where do private values live? | The payment provider key needs controlled access. |
| Release path | How does source code turn into a running version? | A new purchase API version reaches production. |
| Evidence | How do you know what happened? | Logs, metrics, traces, and audit records explain failures. |

The word **service** here means a managed building block provided by Google Cloud. A managed service takes over part of the platform work for you. One service may route traffic. Another may run code. Another may store files. Another may collect logs. You still decide how the application behaves, how data is shaped, which permissions are safe, how releases work, and how the team responds during incidents.

The rest of the article reveals the service names in the same order as the request. First you learn the job. Then you learn the Google Cloud service that usually owns that job.

## The Example App
<!-- section-summary: One small ticket-booking flow gives every later service a concrete job instead of a random product name. -->

The example is a small event-ticketing backend called `ticket-api`. A customer chooses two concert seats, enters payment details, and receives a QR-code ticket. You can follow this flow before knowing the Google Cloud product names, because the work is normal application work first. The cloud service names only matter after the application jobs are clear.

The example is intentionally ordinary. A ticket app has work a beginner can picture: show a page, run backend code, protect seat reservations, keep ticket files, store private provider keys, and leave evidence after a failed purchase. Those jobs map cleanly to Google Cloud services without turning the article into a product-name list.

The customer request moves through ordinary application work. The browser sends a purchase request. The backend checks whether the seats are still available. The backend records the order and payment attempt. It generates a ticket PDF or QR image. It saves that file. It may publish a message so another piece of code can send an email. It records logs and metrics so the team can investigate errors later.

The request gives the article its order. A user reaches the app. Code runs. Data is saved. Permissions are checked. Secrets are accessed. A release path changes the running version. Operations evidence tells the team what happened.

## Traffic: How Users Reach the App
<!-- section-summary: Traffic services receive callers, protect the public entry path, and route requests toward the backend code. -->

**Traffic** means the path between a user and your application. On your laptop, the path is tiny: the browser calls `localhost:8080`, and the process on your machine receives the request. In production, the user is outside your laptop and outside your private network. The app needs a public name, HTTPS, routing rules, and protection from abusive traffic.

For the ticketing app, the public URL might be `https://tickets.example.com/api/purchase`. A beginner-friendly way to read that URL is: the customer is reaching the ticketing system over HTTPS, using the hostname `tickets.example.com`, and asking for the `/api/purchase` path.

Google Cloud has several services for this public entry path:

| Service | Beginner definition | Ticketing example |
|---|---|---|
| **Cloud DNS** | Publishes DNS records for names you own. | `tickets.example.com` points to the public entry point. |
| **TLS certificate** | Proves the HTTPS endpoint is allowed to serve a hostname and helps encrypt the connection. | The browser trusts `https://tickets.example.com`. |
| **Cloud Load Balancing** | Receives requests and chooses which backend should handle each one. | `/api/*` goes to the purchase backend, while `/assets/*` can go to static files. |
| **Cloud Armor** | Applies security rules at the edge before traffic reaches the backend. | A rule slows repeated purchase attempts from abusive clients. |

For AWS readers, Cloud DNS is closest to Route 53, Cloud Load Balancing is closest to Elastic Load Balancing or an Application Load Balancer for this path, and Cloud Armor fills a similar space to AWS WAF-style edge protection.

This section is only about the path into the system. DNS owns the name. HTTPS owns trust and encryption. The load balancer owns routing. Cloud Armor owns edge protection. After those decisions, the request reaches the place where the application code runs.

That leads naturally to compute.

## Compute: Where the Code Runs
<!-- section-summary: Compute services run application code, and the main choice is how much infrastructure control the team needs. -->

**Compute** is the part of Google Cloud that gives your code a place to run. On your laptop, you might start the backend with `npm start`, `go run`, `python app.py`, or a Docker command. In Google Cloud, a compute service gives that code CPU, memory, network access, startup rules, logs, and scaling behavior on Google-managed infrastructure.

A **container** is a packaged application process with the files, libraries, runtime, and startup command it needs. If your backend already runs in a container on your laptop, Google Cloud can run that container for real users.

**Cloud Run** is Google Cloud's managed service for running containers and request-driven backend services. You provide a container image. Cloud Run starts instances of that image, sends requests to them, scales the number of instances up or down, records revision history, captures logs, and attaches a service account for permissions.

For `ticket-api`, Cloud Run is a good first compute choice because the app has a clear request shape. A customer sends a purchase request, the backend handles the request, and the response returns to the browser. The team can focus on application behavior before taking on virtual machine patching or Kubernetes cluster operations.

After Cloud Run exists, it can also expose a generated HTTPS URL for early testing. That URL belongs in the compute discussion because it comes from the service that runs the code. A customer-facing production app usually adds the traffic services from the previous section so the public path uses a stable domain, managed certificate, shared routing, and edge policy.

![Runtime choices by ownership](/content-assets/articles/article-cloud-providers-gcp-foundations-gcp-core-services-map/runtime-ownership-map.png)
*Runtime choice is an ownership choice. More control usually adds more operating work.*

Cloud Run is one compute choice, and there are others:

| Compute service | Beginner definition | Good fit |
|---|---|---|
| **Cloud Run** | Runs containers on managed infrastructure with request-based scaling. | Web APIs, small backends, event handlers, simple workers. |
| **Compute Engine** | Gives you virtual machines with operating-system control. | Legacy software, custom agents, special OS packages, server-style workloads. |
| **Google Kubernetes Engine** | Runs Kubernetes clusters on Google Cloud. | Many services that need Kubernetes APIs, cluster policy, sidecars, or platform controls. |

For AWS readers, Compute Engine maps closely to EC2, and GKE maps closely to EKS. Cloud Run is closest to App Runner for request-driven containers, with some Lambda-like serverless scaling behavior.

For the ticketing product, a practical first shape could use Cloud Run for the public purchase API. A legacy nightly settlement script might stay on Compute Engine because it expects a Linux VM and local packages. A larger platform with many services and shared Kubernetes policy might use GKE later.

The request can now reach the system and run code. The next question is where the app keeps the data created by that code.

## Data: Where the App Keeps State
<!-- section-summary: Data services split by data shape, so each part of the app state goes to the service that matches how the app reads and writes it. -->

**State** is data the app must remember after one request ends. A ticket purchase creates several kinds of state. The seat reservation and order need strong database rules. The ticket PDF behaves like a file. A checkout draft may behave like a document. Sales reports need historical event data.

A beginner mistake is putting every kind of data into one place. A cloud app is easier to reason about after you separate data by shape:

| Data shape | What it means | GCP service that often fits |
|---|---|---|
| **Relational rows** | Tables, relationships, constraints, and transactions. | Cloud SQL, AlloyDB, Spanner |
| **Object files** | Whole files or byte payloads with names and metadata. | Cloud Storage |
| **Documents** | App-shaped records read by path or indexed query. | Firestore |
| **Analytics events** | Many historical records queried for reports. | BigQuery |
| **Messages** | Work that another service should process later. | Pub/Sub |

For AWS readers, Cloud SQL is closest to RDS, Cloud Storage is closest to S3, Firestore is closest to DynamoDB for document-style app state, BigQuery sits closer to Redshift or Athena-style analytics, and Pub/Sub overlaps with SNS, SQS, and EventBridge messaging ideas.

**Cloud SQL** is Google Cloud's managed relational database service for PostgreSQL, MySQL, and SQL Server. It fits ticket purchases because seat reservations need transactions. A transaction lets the app reserve seats, create the order, and record the payment attempt as one coordinated database change. If payment recording fails, the database can roll the reservation back instead of leaving the seat in a broken state.

**Cloud Storage** stores objects in buckets. An object is file-like data plus metadata. For the ticketing app, a generated PDF ticket can live at an object name such as `tickets/2026/06/order-88421.pdf`. The database stores the object name, and Cloud Storage stores the PDF bytes.

**Firestore** is a document database. It can fit a checkout draft because the app may want one document that contains selected seats, email address, timer state, and partial payment state. The app can update that document as the customer moves through checkout.

**BigQuery** is an analytics warehouse. It fits questions that scan lots of historical events, such as sales by venue, failed payments by provider, or campaign conversion by hour. Those questions belong outside the live purchase request because one customer needs the purchase API to answer quickly.

**Pub/Sub** is a messaging service. After a purchase succeeds, `ticket-api` can publish a `ticket.purchased` message. A separate worker can send email, notify a mobile app, or update a CRM system after the customer already has a response.

The app now has a place to run and places to keep state. The next problem is permission. The backend needs its own workload identity instead of borrowing a human user's access.

## Identity and Secrets: How the App Gets Permission
<!-- section-summary: Identity and secret services give the runtime scoped access to GCP APIs without storing long-lived keys inside the application. -->

**Identity** answers the question, "Who is calling Google Cloud?" For a person, the answer might be a user signed in through a company identity provider. For running code, the answer should usually be a **service account**. This separation matters because production software keeps running after one developer closes a laptop, changes teams, or leaves the company. The app needs an identity that belongs to the workload itself.

A **service account** is a Google Cloud identity for software, automation, and workloads. The `ticket-api` service account can receive only the permissions the app needs: connect to the database, write ticket files, access a payment secret, and send logs or metrics. A dedicated workload identity keeps production access separate from a developer's personal account.

**IAM**, Identity and Access Management, is the access-control system that grants permissions. IAM uses three important ideas:

| IAM idea | Simple definition | Ticketing example |
|---|---|---|
| **Principal** | The caller receiving access. | `ticket-api@ticket-prod.iam.gserviceaccount.com` |
| **Role** | A bundle of permissions. | A role that allows reading secret versions. |
| **Resource** | The thing being accessed. | A secret, bucket, project, database, or service. |

For AWS readers, a GCP service account often fills the workload-identity job that an IAM role fills for an AWS service. One key difference is that a GCP service account is also an IAM principal that you grant roles to directly.

The permission story should stay narrow. The backend needs access to the payment secret for this service. It needs write access to the ticket-file bucket. It needs database connection permission. Broad project administration would give the runtime far more access than this request needs.

Secrets need their own home. A **secret** is a sensitive value such as an API key, webhook signing key, OAuth client secret, database password, or private certificate. **Secret Manager** stores those values as named secrets with versions and IAM checks. The ticketing app can ask for `payment-api-key:latest` at runtime instead of baking the payment key into the container image.

Google client libraries usually find credentials through **Application Default Credentials**, or **ADC**. On your laptop, ADC can use local developer credentials. On Cloud Run, ADC can use the attached service account. That gives the same code a safe credential path in production without downloading a service-account key file into the app.

Now the app has runtime permissions and secrets. The next question is how a source-code change turns into a controlled production version.

## Delivery: How Code Turns Into a Release
<!-- section-summary: Delivery services create a chain from source code to image, deployed revision, traffic movement, and rollback evidence. -->

**Delivery** is the path from source code to a running production version. For `ticket-api`, a useful delivery path should answer four questions: which source change was built, which artifact was produced, which version is serving traffic, and how can the team move traffic back if the release breaks?

**Artifact Registry** stores build artifacts such as container images. A container image is the packaged version of the app that Cloud Run can start. A clear image tag or digest helps the team connect a running service back to a build.

**Cloud Build** runs build steps in Google Cloud. It can build the container image, run tests, push the image to Artifact Registry, and record build evidence. A small team may use a simple build trigger. A larger team may require approvals, vulnerability checks, and deployment promotion rules.

**Cloud Run revisions** are named versions of a Cloud Run service. Every deploy creates a revision. That matters because a revision gives the team a concrete rollback target. If revision `ticket-api-00043` produces errors, the team can move traffic back to `ticket-api-00042` after checking that it was the last healthy version.

**Cloud Deploy** can manage delivery pipelines across environments such as development, staging, and production. It is useful after the team needs repeatable promotion, approvals, and release records across multiple targets.

For AWS readers, Artifact Registry is closest to ECR for container images, Cloud Build is closest to CodeBuild, and Cloud Deploy covers part of the promotion and rollout space you may know from CodePipeline and CodeDeploy.

Here is the compact release path for the ticket app. A developer merges a source change that fixes seat-hold expiration in commit `9f4c2d1`. Cloud Build runs tests, builds the container, and pushes an image digest such as `us-central1-docker.pkg.dev/ticket-prod/apps/ticket-api@sha256:61ab...`. The digest matters because a tag can move later, while the digest points to the exact image bytes that Cloud Run starts.

The team can deploy that image as a new revision without sending normal customer traffic to it:

```bash
gcloud run deploy ticket-api \
  --image=us-central1-docker.pkg.dev/ticket-prod/apps/ticket-api@sha256:61ab... \
  --region=us-central1 \
  --no-traffic \
  --tag=release-43
```

Important parts:

- `--image` connects the running service back to the build artifact.
- `--no-traffic` creates the revision while the public purchase path still uses the old revision.
- `--tag=release-43` gives the team a direct URL for smoke tests before customer traffic moves.

Useful output should name the revision and show that it has no normal traffic yet:

```console
Service [ticket-api] revision [ticket-api-00043-hld] has been deployed and is serving 0 percent of traffic.
Tag URL: https://release-43---ticket-api-7a2b3c-uc.a.run.app
```

After a smoke test creates a test purchase, the release can receive a small traffic share:

```bash
gcloud run services update-traffic ticket-api \
  --region=us-central1 \
  --to-revisions=ticket-api-00042-green=95,ticket-api-00043-hld=5
```

If checkout errors rise, rollback uses the same traffic control:

```bash
gcloud run services update-traffic ticket-api \
  --region=us-central1 \
  --to-revisions=ticket-api-00042-green=100
```

A beginner should save release evidence that answers the incident question "what changed?" For this ticket app, the useful bundle is the pull request or commit, Cloud Build ID, image digest, Cloud Run revision name, traffic split command or approval, smoke-test order ID, log query filtered by revision, error-rate snapshot, and the previous healthy revision used for rollback. That bundle connects the delivery layer back to the same request flow: source change, image, runtime revision, customer traffic, and operations evidence.

The delivery layer connects back to the map. A new release may change the container image, environment variables, secret version, service account, database connection, scaling settings, or public behavior. The team needs a release record because many incidents first raise the question: what changed?

After code reaches production, the team needs evidence from the running system. That takes us to operations.

## Operations: How You Know What Happened
<!-- section-summary: Operations services turn production behavior into evidence through logs, metrics, traces, errors, and first-review checks. -->

**Operations** is the everyday work of understanding a running system. After `ticket-api` launches, you need answers without attaching a debugger to a production container. Are users seeing errors? Did latency rise after a deploy? Did database connections spike? Did the payment provider fail, or did the app fail before calling it?

The first operations terms are straightforward:

| Signal | Beginner definition | Ticketing example |
|---|---|---|
| **Log** | A record of something that happened. | Payment authorization failed for one request. |
| **Metric** | A number tracked over time. | 5xx rate, latency, request count, instance count. |
| **Trace** | The path and timing of one request across steps. | Purchase request spent most time waiting on payment provider. |
| **Error group** | Similar application errors grouped together. | The same timeout error appears 800 times after release. |
| **Audit log** | A record of who changed a cloud resource. | A deploy moved traffic to a new revision. |

For AWS readers, Cloud Logging and Cloud Monitoring cover much of the CloudWatch Logs and metrics space, Cloud Trace is closest to X-Ray, and audit logs play a role similar to CloudTrail.

**Cloud Logging** stores and searches logs. Cloud Run can send container standard output and standard error into Cloud Logging. A useful application log should include fields that help you connect one customer symptom to one release, such as request ID, route, revision, payment provider, sanitized error code, and order ID. It should avoid payment tokens, passwords, and unnecessary personal data.

**Cloud Monitoring** stores metrics and powers dashboards and alerting policies. For this service, useful first metrics include request count, 5xx count, latency, container instance count, CPU, memory, and database connection pressure.

**Cloud Trace** follows request latency across steps. If checkout takes four seconds, a trace can show time in the HTTP handler, payment call, database query, object upload, and Pub/Sub publish. Trace data needs application instrumentation to be truly useful, especially after a system has more than one service.

**Error Reporting** groups repeated application errors. During a popular sale, one bug can create thousands of similar log lines. Error grouping helps the team find the main failure pattern and connect it to an owner.

![First production review map](/content-assets/articles/article-cloud-providers-gcp-foundations-gcp-core-services-map/production-review-map.png)
*A first production review walks across the same map: traffic, runtime, data, identity, delivery, and operations.*

A first production review should walk through the same map:

| Review area | What you should be able to point to |
|---|---|
| Traffic | Domain, HTTPS certificate, routing rule, allowed caller path, and edge protection decision. |
| Compute | Runtime choice, region, scaling settings, service account, and current deployed version. |
| Data | Database backup settings, restore practice, bucket retention, lifecycle rules, and connection limits. |
| Identity | Separate human and workload identities, least-privilege roles, and no unnecessary service account keys. |
| Secrets | Secret versions, runtime access, rotation path, and audit evidence. |
| Delivery | Traceable image, active revision, approval record, rollback path, and traffic split. |
| Operations | Logs, metrics, traces, alerts, error groups, and cost signals. |

That review is the reason a service map matters. It gives you a path through the running system instead of a pile of disconnected product names.

## Putting the Map Together
<!-- section-summary: The full map follows one request from public entry through runtime, data, identity, delivery, and production evidence. -->

You now have the first practical GCP map for an application request. A customer sends an HTTPS request. Traffic services receive and route it. A compute service runs the backend code. Data services store records, files, documents, events, and messages. IAM and service accounts give the runtime permission. Secret Manager keeps sensitive values out of source code and container images. Delivery services create a traceable release. Operations services show what happened after the release reaches users.

For the ticketing example, the first production shape could be:

| Layer | First service choice | Why it belongs in the map |
|---|---|---|
| Traffic | Cloud DNS, HTTPS certificate, load balancer, Cloud Armor | Gives users a stable and protected public entry path. |
| Compute | Cloud Run | Runs the purchase API as a managed container service. |
| Relational data | Cloud SQL for PostgreSQL | Protects seat reservations with transactions. |
| Files | Cloud Storage | Stores generated ticket PDFs and exports. |
| Messages | Pub/Sub | Sends receipt and notification work to background handlers. |
| Identity | Service account plus IAM | Lets the app call GCP APIs with scoped permissions. |
| Secrets | Secret Manager | Stores payment provider keys as versioned secrets. |
| Build and release | Cloud Build, Artifact Registry, Cloud Run revisions | Connects source code to an image, revision, and rollback target. |
| Operations | Cloud Logging, Cloud Monitoring, Cloud Trace | Gives the team evidence during normal operation and incidents. |

![One request, six GCP jobs](/content-assets/articles/article-cloud-providers-gcp-foundations-gcp-core-services-map/request-service-map.png)
*After the concepts are in place, the request map shows the full path: browser, public entry, code runtime, data, files, secrets, operations evidence, and review.*

The next GCP foundation topic sits underneath this service map: projects, billing, regions, zones, enabled APIs, and quotas. Those pieces decide where the services live, who pays for them, which APIs can run, and which limits the team should check before launch.

## References

- [Google Cloud products and services](https://cloud.google.com/products) - Official product catalog for the core Google Cloud services mentioned in this map.
- [What is Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run) - Defines Cloud Run as a fully managed platform for running code, functions, and containers.
- [Cloud Load Balancing overview](https://docs.cloud.google.com/load-balancing/docs/load-balancing-overview) - Explains Google Cloud load balancer families and traffic patterns.
- [Cloud SQL documentation](https://docs.cloud.google.com/sql/docs) - Defines Cloud SQL as a managed relational database service for MySQL, PostgreSQL, and SQL Server.
- [Cloud Storage documentation](https://docs.cloud.google.com/storage/docs) - Documents object storage, buckets, objects, locations, and access patterns.
- [IAM overview](https://docs.cloud.google.com/iam/docs/overview) - Explains principals, roles, resources, allow policies, and resource hierarchy inheritance.
- [Service accounts overview](https://docs.cloud.google.com/iam/docs/service-account-overview) - Explains service accounts as identities for workloads and automation.
- [Secret Manager overview](https://docs.cloud.google.com/secret-manager/docs/overview) - Documents secrets, secret versions, metadata, labels, annotations, and permissions.
- [Artifact Registry overview](https://docs.cloud.google.com/artifact-registry/docs/overview) - Explains repositories for container images and build artifacts.
- [Deploying to Cloud Run using Cloud Build](https://docs.cloud.google.com/build/docs/deploying-builds/deploy-cloud-run) - Documents Cloud Build deployment flow for Cloud Run services.
- [Cloud Logging documentation](https://docs.cloud.google.com/logging/docs) - Documents log storage, search, analysis, monitoring, and alerting.
- [Cloud Monitoring documentation](https://docs.cloud.google.com/monitoring/docs) - Documents metrics, dashboards, alerting, and service health workflows.
- [Cloud Trace overview](https://docs.cloud.google.com/trace/docs/overview) - Explains distributed tracing for latency analysis.
