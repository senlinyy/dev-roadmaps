---
title: "GCP Core Services Map"
description: "Map one application request to the core Google Cloud services behind traffic, compute, data, identity, releases, and operations."
overview: "A first GCP service map helps you connect one application request to the service families that run, protect, store, deploy, and observe it. The example follows a simple photo-sharing backend and introduces each Google Cloud service only after its job is clear."
tags: ["gcp", "cloud-run", "cloud-sql", "cloud-storage"]
order: 1
id: article-cloud-providers-gcp-foundations-gcp-core-services-map
aliases:
  - core-services
  - gcp-core-services-map
  - cloud-providers/gcp/foundations/gcp-core-services-map.md
---

## Table of Contents

1. [What Problems Does a GCP Service Map Organize?](#what-problems-does-a-gcp-service-map-organize)
2. [How Do Networking Services Carry Traffic to the Application?](#how-do-networking-services-carry-traffic-to-the-application)
3. [How Much Compute Control Does the Workload Need?](#how-much-compute-control-does-the-workload-need)
4. [How Should Durable Data Be Split by Its Access Pattern?](#how-should-durable-data-be-split-by-its-access-pattern)
5. [How Do Events and Tasks Move Work Out of the Request Path?](#how-do-events-and-tasks-move-work-out-of-the-request-path)
6. [How Do IAM, Service Accounts, and Secrets Control Access?](#how-do-iam-service-accounts-and-secrets-control-access)
7. [How Does Source Code Become a Running Release?](#how-does-source-code-become-a-running-release)
8. [How Do Operations Signals and System Flows Explain What Happened?](#how-do-operations-signals-and-system-flows-explain-what-happened)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

You can understand Google Cloud by looking at an app you already know. Picture a small backend on your laptop. It listens on `localhost:8080`, receives a browser request, writes data, saves a file, reads an API key, prints logs, and returns a response. Nothing about that flow is cloud-specific yet.

That local app already has the same jobs as a cloud app. Someone needs to reach it. The code needs CPU and memory. Data needs to survive after the process stops. Sensitive values need a safer home than one local `.env` file. New code needs a release path. After an outage, you need evidence instead of guesses.

A **GCP service map** connects those application jobs to Google Cloud services. The map answers a practical beginner question: "I know what my app needs to do, so which Google Cloud service usually handles each job?"

Before naming products, map the jobs: accept a request, run code, store state, control access, connect systems, and collect operational evidence.

Keep these questions in view as you work through the lesson:

1. **What Problems Does a GCP Service Map Organize?**
2. **How Do Networking Services Carry Traffic to the Application?**
3. **How Much Compute Control Does the Workload Need?**
4. **How Should Durable Data Be Split by Its Access Pattern?**
5. **How Do Events and Tasks Move Work Out of the Request Path?**
6. **How Do IAM, Service Accounts, and Secrets Control Access?**
7. **How Does Source Code Become a Running Release?**
8. **How Do Operations Signals and System Flows Explain What Happened?**

## What Problems Does a GCP Service Map Organize?
<!-- section-summary: A GCP service map connects each job in one application request to the Google Cloud service family that usually owns that job. -->

| Application job | Plain English question | Photo-sharing example |
|---|---|---|
| Public entry | How does a user reach the app safely? | A user opens `photos.example.com`. |
| Code execution | Where does the backend code run? | The photo API receives the request and runs business logic. |
| Durable state | Where does the app keep important data? | Photo records, comments, photo objects, and events need storage. |
| Permission | Which identity may the app use? | The backend needs permission to write files and read secrets. |
| Sensitive values | Where do private values live? | The external processing service key needs controlled access. |
| Release path | How does source code turn into a running version? | A new photo API version reaches production. |
| Evidence | How do you know what happened? | Logs, metrics, traces, and audit records explain failures. |

The word **service** here means a managed building block provided by Google Cloud. A managed service takes over part of the platform work for you. One service may route traffic. Another may run code. Another may store files. Another may collect logs. You still decide how the application behaves, how data is shaped, which permissions are safe, how releases work, and how the team responds during incidents.

The rest of the article reveals the service names in the same order as the request. First you learn the job. Then you learn the Google Cloud service that usually owns that job.

### The Photo Application
<!-- section-summary: One small photo-sharing flow gives every later service a concrete job instead of a random product name. -->

The example is **PhotoShop**, a small web application where people sign in, upload photos, add captions, browse their images, and receive generated thumbnails. You can follow this flow before knowing any Google Cloud product names because the work is application work first. The service names matter only after each application responsibility is clear.

The example is intentionally ordinary. A browser reaches `photos.example.com`; backend code handles an upload; a database records the user, caption, and object path; object storage keeps the image bytes; a background worker creates a thumbnail; and logs, metrics, and traces explain failures. Those jobs map cleanly to Google Cloud services without turning the lesson into a product-name catalogue.

The browser sends an upload request. The backend authenticates the user, stores the image object, records its metadata and caption, publishes a `PhotoUploaded` event, and returns an "upload received" response without waiting for every later operation. A worker can then resize the image, create a thumbnail, inspect it, and record analytics. All of those components produce evidence for later investigation.

The request gives the article its order. A user reaches the app. Code runs. State survives the request. Events hand work to other consumers. Permissions are checked. Secrets are accessed. A release path changes the running version. Operations evidence tells the team what happened.

The resources themselves live under another foundation: organization, folders, projects, and individual service resources. A project is the administrative home where APIs are enabled, permissions are applied, usage is linked to billing, and objects such as the Cloud Run service, database, bucket, secrets, and service accounts are created. That hierarchy explains ownership; each regional, zonal, or global resource then has its own placement or scope.

## How Do Networking Services Carry Traffic to the Application?
<!-- section-summary: Traffic services receive callers, protect the public entry path, and route requests toward the backend code. -->

**Traffic** means the path between a user and your application. On your laptop, the path is tiny: the browser calls `localhost:8080`, and the process on your machine receives the request. In production, the user is outside your laptop and outside your private network. The app needs a public name, HTTPS, routing rules, and protection from abusive traffic.

For the photo-sharing app, the public URL might be `https://photos.example.com/api/photos`. A beginner-friendly way to read that URL is: the user is reaching the photo-sharing system over HTTPS, using the hostname `photos.example.com`, and asking for the `/api/photos` path.

Google Cloud has several services for this public entry path:

| Service | Beginner definition | Photo-sharing example |
|---|---|---|
| **Cloud DNS** | Publishes DNS records for names you own. | `photos.example.com` points to the public entry point. |
| **TLS certificate** | Proves the HTTPS endpoint is allowed to serve a hostname and helps encrypt the connection. | The browser trusts `https://photos.example.com`. |
| **Cloud Load Balancing** | Receives requests and chooses which backend should handle each one. | `/api/*` reaches the photo API, while reusable public assets can follow a cached path. |
| **Cloud Armor** | Applies security rules at the edge before traffic reaches the backend. | A rule rejects abusive or known-malicious traffic before the application spends work on it. |

This section is only about the path into the system. DNS owns the name. HTTPS owns trust and encryption. The load balancer owns routing. Cloud Armor owns edge protection. After those decisions, the request reaches the place where the application code runs.

That leads naturally to compute.

The **VPC** answers a related internal-networking question. DNS and load balancing explain how a user reaches a stable public entrance. A Virtual Private Cloud provides the private networking environment—subnets, addresses, routes, and firewall policy—through which connected resources reach one another. In GCP the VPC network is global and contains regional subnets, so it should be pictured as network fabric beneath VM, GKE, and connected serverless paths rather than as another application product.

Cloud CDN adds another traffic decision. When many users request the same reusable bytes, an edge cache can serve copies closer to them instead of asking the origin to retransmit the same content each time. Cloud Armor follows the opposite efficiency rule: reject unwanted work as early as possible, before it consumes application or database resources.

## How Much Compute Control Does the Workload Need?
<!-- section-summary: Compute services run application code, and the main choice is how much infrastructure control the team needs. -->

**Compute** is the part of Google Cloud that gives your code a place to run. On your laptop, you might start the backend with `npm start`, `go run`, `python app.py`, or a Docker command. In Google Cloud, a compute service gives that code CPU, memory, network access, startup rules, logs, and scaling behavior on Google-managed infrastructure.

A **container** is a packaged application process with the files, libraries, runtime, and startup command it needs. If your backend already runs in a container on your laptop, Google Cloud can run that container for real users.

**Cloud Run** is Google Cloud's managed service for running containers and request-driven backend services. You provide a container image. Cloud Run starts instances of that image, sends requests to them, scales the number of instances up or down, records revision history, captures logs, and attaches a service account for permissions.

For `photo-api`, Cloud Run is a good first compute choice because the app has a clear request shape. A user sends a photo-upload request, the backend handles the request, and the response returns to the browser. The team can focus on application behavior before taking on virtual machine patching or Kubernetes cluster operations.

After Cloud Run exists, it can also expose a generated HTTPS URL for early testing. That URL belongs in the compute discussion because it comes from the service that runs the code. A user-facing production app usually adds the traffic services from the previous section so the public path uses a stable domain, managed certificate, shared routing, and edge policy.

![Runtime choices by ownership](/content-assets/articles/article-cloud-providers-gcp-foundations-gcp-core-services-map/runtime-ownership-map.png)
*Runtime choice is an ownership choice. More control usually adds more operating work.*

Cloud Run is one compute choice, and there are others:

| Compute service | Beginner definition | Good fit |
|---|---|---|
| **Cloud Run** | Runs containers on managed infrastructure with request-based scaling. | Web APIs, small backends, event handlers, simple workers. |
| **Compute Engine** | Gives you virtual machines with operating-system control. | Legacy software, custom agents, special OS packages, server-style workloads. |
| **Google Kubernetes Engine** | Runs Kubernetes clusters on Google Cloud. | Many services that need Kubernetes APIs, cluster policy, sidecars, or platform controls. |

For the photo-sharing product, a practical first shape could use Cloud Run for the public photo API and thumbnail worker. Software that truly expects a long-running Linux server and OS-level control can use Compute Engine. A larger platform with many containerized services, shared Kubernetes APIs, scheduling, service discovery, and cluster policy might use GKE.

These services form a responsibility spectrum. Compute Engine is closest to "give me a computer": the team controls the operating system, processes, disks, and machine shape. A container packages an application, while GKE adds Kubernetes to schedule and operate many containers as a distributed system. Cloud Run accepts application or container code while Google handles more infrastructure, instance creation, request routing, and scaling. The choice is therefore about required control and accepted operating responsibility, not a universal ranking of products.

The request can now reach the system and run code. The next question is where the app keeps the data created by that code.

## How Should Durable Data Be Split by Its Access Pattern?
<!-- section-summary: Data services split by data shape, so each part of the app state goes to the service that matches how the app reads and writes it. -->

**State** is information the app must remember after one request or compute instance ends. PhotoShop has several shapes of state. User and photo metadata have relationships. The image itself is a blob of bytes. Preferences can be document-shaped. Billions of historical view events belong to analytical queries. Treating compute instances as replaceable requires each durable shape to live outside their local memory and filesystem.

A beginner mistake is putting every kind of data into one place. A cloud app is easier to reason about after you separate data by shape:

| Data shape | What it means | GCP service that often fits |
|---|---|---|
| **Relational rows** | Tables, relationships, constraints, and transactions. | Cloud SQL, AlloyDB, Spanner |
| **Object files** | Whole files or byte payloads with names and metadata. | Cloud Storage |
| **Documents** | App-shaped records read by path or indexed query. | Firestore |
| **Analytics events** | Many historical records queried for reports. | BigQuery |
| **Messages** | Work that another service should process later. | Pub/Sub |

**Cloud SQL** is Google Cloud's managed relational database service for PostgreSQL, MySQL, and SQL Server. It fits users, photos, comments, and other related application records. Transactions preserve meaning when several related changes must succeed together. A conventional web application can reasonably begin with Cloud Run and Cloud SQL rather than choosing a distributed database merely because it runs on Google Cloud.

**Cloud Storage** stores objects in buckets. An object is file-like bytes plus metadata. The database can store `photo_id`, `user_id`, caption, and an object path such as `gs://photos/42.jpg`, while Cloud Storage keeps the actual JPEG bytes. This avoids forcing a large image or video into an ordinary relational row.

**Firestore** is a managed document database. It can fit application-oriented structures such as one user's nested preferences and recent-photo data when that document and its access pattern are more natural than relational joins. The choice should follow data shape and reads and writes, rather than the idea that NoSQL is automatically newer or better.

**Spanner** keeps a relational model, transactions, and strong consistency while addressing much larger horizontal and geographic distribution requirements. It is a different response to a different constraint set, not simply a better Cloud SQL. **BigQuery** serves another job again: analytical questions over very large historical datasets, such as how millions of users behaved last quarter. Operational lookups and analytical scans may both use SQL, yet their workload shapes pull in different directions.

The practical map is therefore: Cloud Storage for whole files and blobs; Cloud SQL for conventional relational application data; Firestore for document-oriented application state; Spanner when distributed relational scale is a real requirement; and BigQuery for analytical scanning and aggregation. Service choice follows the access pattern, consistency needs, scale, and query shape.

The app now has a place to run and places to keep state. The next question is which work belongs after the immediate HTTP response.

## How Do Events and Tasks Move Work Out of the Request Path?
<!-- section-summary: Messaging and orchestration let the upload request finish while independent consumers perform later work with clear coordination semantics. -->

If one upload request must store the file, resize it, create a thumbnail, detect objects, generate metadata, email the user, and update analytics before returning, the user waits on every step and every dependency. A better boundary saves the necessary state, publishes that the photo was uploaded, and returns "upload received." Later work proceeds independently.

**Pub/Sub** carries events without requiring the producer to know every consumer. `photo-api` publishes `PhotoUploaded`; thumbnail, analysis, notification, and analytics consumers subscribe separately. The broker decouples the application that announces what happened from the services that choose to react.

**Cloud Tasks** represents a more directed instruction: call a particular handler such as `/resize-photo/42`, and retry it according to task settings if the attempt fails. Pub/Sub is naturally read as "something happened," while a task is naturally read as "perform this specific unit of work."

**Eventarc** routes events from supported systems toward consumers such as Cloud Run. An object-created event can therefore become a trigger for a processing service without the uploader manually calling every downstream handler. **Workflows** handles explicit multi-step orchestration where step order, branches, and outcomes are themselves part of the process.

These mechanisms solve different coordination problems, yet they belong to the same service map because they move work between components. Once work crosses that boundary, each producer, broker, trigger, task, workflow, and consumer also needs an identity and permission.

## How Do IAM, Service Accounts, and Secrets Control Access?
<!-- section-summary: Identity and secret services give the runtime scoped access to GCP APIs without storing long-lived keys inside the application. -->

**Identity** answers the question, "Who is calling Google Cloud?" For a person, the answer might be a user signed in through a company identity provider. For running code, the answer should usually be a **service account**. This separation matters because production software keeps running after one developer closes a laptop, changes teams, or leaves the company. The app needs an identity that belongs to the workload itself.

A **service account** is a Google Cloud identity for software, automation, and workloads. The `photo-api` service account can receive only the permissions the app needs: connect to the database, write photo files, access a external API secret, and send logs or metrics. A dedicated workload identity keeps production access separate from a developer's personal account.

**IAM**, Identity and Access Management, is the access-control system that grants permissions. IAM uses three important ideas:

| IAM idea | Simple definition | Photo-sharing example |
|---|---|---|
| **Principal** | The caller receiving access. | `photo-api@photo-prod.iam.gserviceaccount.com` |
| **Role** | A bundle of permissions. | A role that allows reading secret versions. |
| **Resource** | The thing being accessed. | A secret, bucket, project, database, or service. |

The permission story should stay narrow. The backend needs access to the external API secret for this service. It needs write access to the photo-file bucket. It needs database connection permission. Broad project administration would give the runtime far more access than this request needs.

Secrets need their own home. A **secret** is a sensitive value such as an external API key, webhook signing key, OAuth client secret, database password, or private certificate. **Secret Manager** stores those values as named secrets with versions and IAM checks. The photo-sharing app can ask for `processing-api-key:latest` at runtime instead of baking the value into source code or its container image.

Google client libraries usually find credentials through **Application Default Credentials**, or **ADC**. On your laptop, ADC can use local developer credentials. On Cloud Run, ADC can use the attached service account. That gives the same code a safe credential path in production without downloading a service-account key file into the app.

Now the app has runtime permissions and secrets. The next question is how a source-code change turns into a controlled production version.

## How Does Source Code Become a Running Release?
<!-- section-summary: Delivery services create a chain from source code to image, deployed revision, traffic movement, and rollback evidence. -->

**Delivery** is the path from source code to a running production version. For `photo-api`, a useful delivery path should answer four questions: which source change was built, which artifact was produced, which version is serving traffic, and how can the team move traffic back if the release breaks?

**Artifact Registry** stores build artifacts such as container images. A container image is the packaged version of the app that Cloud Run can start. A clear image tag or digest helps the team connect a running service back to a build.

**Cloud Build** runs build steps in Google Cloud. It can build the container image, run tests, push the image to Artifact Registry, and record build evidence. A small team may use a simple build trigger. A larger team may require approvals, vulnerability checks, and deployment promotion rules.

**Cloud Run revisions** are named versions of a Cloud Run service. Every deploy creates a revision. That matters because a revision gives the team a concrete rollback target. If revision `photo-api-00043` produces errors, the team can move traffic back to `photo-api-00042` after checking that it was the last healthy version.

**Cloud Deploy** can manage delivery pipelines across environments such as development, staging, and production. It is useful after the team needs repeatable promotion, approvals, and release records across multiple targets.

Here is the compact release path for the photo application. A developer merges a source change that fixes an image-processing timeout in commit `9f4c2d1`. Cloud Build runs tests, builds the container, and pushes an image digest such as `us-central1-docker.pkg.dev/photo-prod/apps/photo-api@sha256:61ab...`. The digest matters because a tag can move later, while the digest points to the exact image bytes that Cloud Run starts.

The team can deploy that image as a new revision without sending normal user traffic to it:

```bash
gcloud run deploy photo-api \
  --image=us-central1-docker.pkg.dev/photo-prod/apps/photo-api@sha256:61ab... \
  --region=us-central1 \
  --no-traffic \
  --tag=release-43
```

Important parts:

- `--image` connects the running service back to the build artifact.
- `--no-traffic` creates the revision while the public upload path still uses the old revision.
- `--tag=release-43` gives the team a direct URL for smoke tests before user traffic moves.

Useful output should name the revision and show that it has no normal traffic yet:

```console
Service [photo-api] revision [photo-api-00043-hld] has been deployed and is serving 0 percent of traffic.
Tag URL: https://release-43---photo-api-7a2b3c-uc.a.run.app
```

After a smoke test uploads a test image and verifies its metadata, the release can receive a small traffic share:

```bash
gcloud run services update-traffic photo-api \
  --region=us-central1 \
  --to-revisions=photo-api-00042-green=95,photo-api-00043-hld=5
```

If upload errors rise, rollback uses the same traffic control:

```bash
gcloud run services update-traffic photo-api \
  --region=us-central1 \
  --to-revisions=photo-api-00042-green=100
```

A beginner should save release evidence that answers the incident question "what changed?" For this photo application, the useful bundle is the pull request or commit, Cloud Build ID, image digest, Cloud Run revision name, traffic split command or approval, smoke-test photo ID, log query filtered by revision, error-rate snapshot, and the previous healthy revision used for rollback. That bundle connects the delivery layer back to the same request flow: source change, image, runtime revision, user traffic, and operations evidence.

Continuous integration and continuous delivery occupy connected but distinct parts of this path. Integration automates testing, building, and producing an artifact after source changes. Delivery or deployment promotes that identified artifact through targets such as development, staging, and production. Building once and deploying the exact artifact avoids silently rebuilding different bytes on each production machine.

The delivery layer connects back to the map. A new release may change the container image, environment variables, secret version, service account, database connection, scaling settings, or public behavior. The team needs a release record because many incidents first raise the question: what changed?

After code reaches production, the team needs evidence from the running system. That takes us to operations.

## How Do Operations Signals and System Flows Explain What Happened?
<!-- section-summary: Operations services turn production behavior into evidence through logs, metrics, traces, errors, and first-review checks. -->

**Operations** is the everyday work of understanding a running system. After `photo-api` launches, you need answers without attaching a debugger to a production container. Are users seeing errors? Did latency rise after a deploy? Did database connections spike? Did the external processing service fail, or did the app fail before calling it?

The first operations terms are straightforward:

| Signal | Beginner definition | Photo-sharing example |
|---|---|---|
| **Log** | A record of something that happened. | An object write failed for one upload request. |
| **Metric** | A number tracked over time. | 5xx rate, latency, request count, instance count. |
| **Trace** | The path and timing of one request across steps. | Photo-upload request spent most time waiting on external processing service. |
| **Error group** | Similar application errors grouped together. | The same timeout error appears 800 times after release. |
| **Audit log** | A record of who changed a cloud resource. | A deploy moved traffic to a new revision. |

**Cloud Logging** stores and searches logs. Cloud Run can send container standard output and standard error into Cloud Logging. A useful application log should include fields that help you connect one user symptom to one release, such as request ID, route, revision, external processing service, sanitized error code, and photo record ID. It should avoid API tokens, passwords, and unnecessary personal data.

**Cloud Monitoring** stores metrics and powers dashboards and alerting policies. For this service, useful first metrics include request count, 5xx count, latency, container instance count, CPU, memory, and database connection pressure.

**Cloud Trace** follows request latency across steps. If upload takes four seconds, a trace can show time in the HTTP handler, image-processing call, database query, object upload, and Pub/Sub publish. Trace data needs application instrumentation to be truly useful, especially after a system has more than one service.

**Error Reporting** groups repeated application errors. During a traffic spike, one bug can create thousands of similar log lines. Error grouping helps the team find the main failure pattern and connect it to an owner.

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

### Putting the Map Together
<!-- section-summary: The full map follows one request from public entry through runtime, data, identity, delivery, and production evidence. -->

You now have the first practical GCP map for an application request. A user sends an HTTPS request. Traffic services receive and route it. A compute service runs the backend code. Data services store records, files, documents, events, and messages. IAM and service accounts give the runtime permission. Secret Manager keeps sensitive values out of source code and container images. Delivery services create a traceable release. Operations services show what happened after the release reaches users.

For the photo-sharing example, the first production shape could be:

| Layer | First service choice | Why it belongs in the map |
|---|---|---|
| Traffic | Cloud DNS, HTTPS certificate, load balancer, Cloud Armor | Gives users a stable and protected public entry path. |
| Compute | Cloud Run | Runs the photo API as a managed container service. |
| Relational data | Cloud SQL for PostgreSQL | Protects photo metadata with transactions. |
| Files | Cloud Storage | Stores generated photo objects and exports. |
| Messages | Pub/Sub | Sends thumbnail and notification work to background handlers. |
| Identity | Service account plus IAM | Lets the app call GCP APIs with scoped permissions. |
| Secrets | Secret Manager | Stores external processing service keys as versioned secrets. |
| Build and release | Cloud Build, Artifact Registry, Cloud Run revisions | Connects source code to an image, revision, and rollback target. |
| Operations | Cloud Logging, Cloud Monitoring, Cloud Trace | Gives the team evidence during normal operation and incidents. |

![One request, six GCP jobs](/content-assets/articles/article-cloud-providers-gcp-foundations-gcp-core-services-map/request-service-map.png)
*After the concepts are in place, the request map shows the full path: browser, public entry, code runtime, data, files, secrets, operations evidence, and review.*

The next GCP foundation topic sits underneath this service map: projects, billing, regions, zones, enabled APIs, and quotas. Those pieces decide where the services live, who pays for them, which APIs can run, and which limits the team should check before launch.

The most useful way to retain the map is through flows rather than isolated definitions. A request flows from the user through DNS and load balancing to compute and then to state. An upload flows from the application to Cloud Storage. An event flows from the producer through Pub/Sub or Eventarc to a worker. An authorization flow resolves the workload's service account, evaluates IAM, and either permits or refuses the call. A release flows from source through Cloud Build, Artifact Registry, promotion, and the runtime. Telemetry flows from every layer into logs, metrics, traces, dashboards, alerts, and an operator response.

Another boundary separates the **data plane** from the **control plane**. Alice uploading `holiday.jpg` through the running application is data-plane work. An engineer deploying revision 18, Terraform creating a database, or an administrator granting bucket access is control-plane work that changes the system itself. The distinction helps incident responders ask whether user traffic is failing inside the configured system or whether a recent management action changed that system.

The word **managed** describes responsibility rather than magic. With Compute Engine, Google operates the data-centre hardware and virtualization while the team still owns much of the guest operating system and server environment. With Cloud Run, Google also owns more of the runtime platform, scaling, request routing, and instance lifecycle. The application, its data model, permissions, release safety, and incident response remain the team's responsibility. The product is often valuable because it removes layers of operational work.

Physical geography completes the service map. A region and its zones affect latency, service availability, data residency, cost, and the failures the design can survive. The application and frequently called database should normally avoid unnecessary geographic separation. A multi-zone or multi-region design can provide wider resilience, but it also introduces replication, consistency, traffic, deployment, and recovery decisions. Choosing `Cloud Run + Cloud SQL` names services; choosing where they run and how they recover turns those names into architecture.

When an unfamiliar GCP product appears, classify it before memorizing it. Ask which fundamental job it solves—governance, traffic, compute, state, coordination, identity, delivery, or observability. Then ask what work it abstracts, what enters it, what comes out, and which services sit immediately before and after it. Those questions give the product a place in a real system.

## Check Your Answers

:::expand[What Problems Does a GCP Service Map Organize?]{kind="recap"}
It organizes the recurring jobs of governance, traffic, compute, durable state, asynchronous coordination, identity, delivery, and observability around one application flow.
:::

:::expand[How Do Networking Services Carry Traffic to the Application?]{kind="recap"}
DNS resolves the name, load balancing provides a stable routed entrance, CDN can cache reusable data, Armor can reject bad traffic early, and the VPC supplies internal network paths.
:::

:::expand[How Much Compute Control Does the Workload Need?]{kind="recap"}
Compute Engine gives machine and OS control, GKE operates many containers through Kubernetes, and Cloud Run removes more server and platform management for application code.
:::

:::expand[How Should Durable Data Be Split by Its Access Pattern?]{kind="recap"}
Use object storage for whole blobs, relational or document databases for matching application access patterns, Spanner for justified distributed relational scale, and BigQuery for analytical scans.
:::

:::expand[How Do Events and Tasks Move Work Out of the Request Path?]{kind="recap"}
Pub/Sub broadcasts events to independent consumers, Cloud Tasks directs a retried unit of work, Eventarc routes supported events, and Workflows coordinates explicit multi-step sequences.
:::

:::expand[How Do IAM, Service Accounts, and Secrets Control Access?]{kind="recap"}
The workload runs as a service account, IAM grants that principal scoped actions on resources, and Secret Manager holds sensitive values the authorized workload needs.
:::

:::expand[How Does Source Code Become a Running Release?]{kind="recap"}
Cloud Build tests and packages source, Artifact Registry stores the identified artifact, delivery promotes it, and the runtime starts that exact version with rollback evidence.
:::

:::expand[How Do Operations Signals and System Flows Explain What Happened?]{kind="recap"}
Logs describe events, metrics summarize behavior, traces show one request's timing, and alerts create a feedback loop. Reading their flows connects symptoms to runtime and control-plane changes.
:::

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
