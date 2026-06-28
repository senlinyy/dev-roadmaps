---
title: "Cloud Run"
description: "Understand how Cloud Run wraps a container image as a managed GCP service through services, revisions, traffic, scaling, identity, configuration, logs, and health."
overview: "Cloud Run is often the simplest first GCP home for a backend API, but a container image is not the whole service. This article follows the Orders API from image to healthy HTTPS runtime."
tags: ["gcp", "cloud-run", "containers", "revisions"]
order: 2
id: article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis
aliases:
  - cloud-run-services-for-backend-apis
  - cloud-providers/gcp/compute-application-hosting/cloud-run-services-for-backend-apis.md
---

## Table of Contents

1. [What Cloud Run Runs](#what-cloud-run-runs)
2. [Service, Image, and Revision](#service-image-and-revision)
3. [The Container Contract](#the-container-contract)
4. [First Deploy for the Orders API](#first-deploy-for-the-orders-api)
5. [Revisions, Traffic Splits, and Rollback](#revisions-traffic-splits-and-rollback)
6. [Concurrency and Downstream Protection](#concurrency-and-downstream-protection)
7. [Max and Min Instances](#max-and-min-instances)
8. [Runtime Identity](#runtime-identity)
9. [Environment Variables and Secrets](#environment-variables-and-secrets)
10. [Logs and Verification](#logs-and-verification)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## What Cloud Run Runs
<!-- section-summary: Cloud Run gives a containerized application a managed runtime contract, so the team can focus on the service shape instead of VM hosts. -->

**Cloud Run** is Google Cloud's managed platform for running containers that respond to requests, events, jobs, or worker-style background work. For a backend API, the common resource is a **Cloud Run service**. The service gives the container a stable endpoint, revision history, traffic routing, scaling settings, runtime identity, and logs without asking the team to operate virtual machines or a Kubernetes cluster.

Let's keep following the same small Orders team. They have a container image for `orders-api`, and that image already works on a developer laptop. The senior engineer on the team is going to slow the conversation down a little, because a working Docker image is only one part of a production service.

The Cloud Run service answers the production questions around the image. Which revision receives traffic? How many requests can one instance process at the same time? How many instances can start before the database gets stressed? Which service account does the running code use? Where do logs go when checkout fails at 2:00 a.m.? That is why Cloud Run is such a useful first home for stateless backend APIs: the team keeps the application contract and service configuration, while Google manages the server fleet, sandboxing, routing, and autoscaling loop around it.

## Service, Image, and Revision
<!-- section-summary: The image packages the code, the service holds the managed runtime settings, and each deployable snapshot creates an immutable revision. -->

A **container image** is the sealed package that contains the application code, language runtime, dependencies, and startup command. The Orders image might be tagged with a Git SHA, such as `orders-api:a3f8c2d`, so the team can connect a deployed artifact back to a commit. Images usually live in Artifact Registry before Cloud Run deploys them.

A **Cloud Run service** is the managed resource around that image. It has a regional name, a stable `run.app` URL, IAM settings for invocation, environment variables, secret mappings, CPU and memory settings, concurrency, scaling limits, and traffic rules. Google documentation also notes that Cloud Run imports the image at deployment time and keeps that copy while a serving revision uses it.

A **revision** is an immutable snapshot of the service's deployable configuration. Cloud Run creates a new revision when the team deploys a new image or changes settings that affect the runtime, such as environment variables, service account, memory, or concurrency. The old revision stays available for traffic routing and rollback until Cloud Run retention limits or manual cleanup remove it.

Here is the service shape the Orders team is working with. The image feeds the service, the service owns revisions, and traffic rules decide which revision receives requests.

![Cloud Run image, service, revision, and traffic shape](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis/cloud-run-release-shape.png)
*The image is the deployable package, the service holds the runtime contract, and traffic rules choose which immutable revision receives requests.*

This separation gives the Orders team a safer release workflow. They can build one image, deploy it as a new revision, verify it with no traffic or a small percentage of traffic, and move customers back to the previous revision quickly if errors rise. Before that workflow works, the container has to satisfy Cloud Run's runtime contract.

## The Container Contract
<!-- section-summary: A Cloud Run service needs the ingress container to listen on the provided port and on the correct network interface. -->

The **container contract** is the set of rules a container must follow so Cloud Run can start it and route traffic to it. For services, the most important rule is the network listener. Cloud Run injects a `PORT` environment variable into the ingress container, and the application must listen for HTTP requests on that port.

The interface matters too. Binding the server to `127.0.0.1` keeps the listener on the container loopback interface. Binding to `0.0.0.0` lets the Cloud Run request path reach the process inside the container environment. The default request port is `8080` unless the service config chooses another port, but production code should read `PORT` instead of hardcoding local development assumptions.

For a small Node.js Orders API, the listener could look like this. The important parts are reading `PORT` and binding the process to `0.0.0.0`.

```js
import express from "express";

const app = express();
const port = Number(process.env.PORT || 8080);

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/orders", async (_req, res) => {
  res.status(202).json({ accepted: true });
});

app.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({
    severity: "INFO",
    message: "orders api listening",
    port
  }));
});
```

The Dockerfile should start the server directly, with no manual shell steps after the container starts. The same pattern works in other languages as long as the final command starts the web process.

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "server.js"]
```

The same container should treat local filesystem writes as temporary. Order records, payment state, inventory reservations, and audit events belong in managed storage such as Cloud SQL, Firestore, Spanner, Pub/Sub, or Cloud Storage. Cloud Run can restart or replace instances, so durable state needs a service outside the container. Once the container follows that contract, the image is ready for a first service deployment.

## First Deploy for the Orders API
<!-- section-summary: The first deploy creates a service, attaches runtime identity, and decides whether callers need IAM permission to invoke it. -->

The first Cloud Run deploy should create a service with a clear name, region, image, and runtime service account. A **runtime service account** is the identity the running container uses when it calls Google APIs. It is separate from the human or CI/CD identity that performs the deployment.

For a private backend service in the Orders production project, the first deploy might look like this. The command creates the service if it does not exist yet, or creates a new revision if the service already exists.

```bash
gcloud run deploy orders-api \
  --image=us-central1-docker.pkg.dev/orders-prod/apps/orders-api:a3f8c2d \
  --region=us-central1 \
  --service-account=orders-api-runtime@orders-prod.iam.gserviceaccount.com \
  --no-allow-unauthenticated
```

This command creates or updates the `orders-api` service in `us-central1`, points it at a specific image tag, and attaches the runtime identity. The `--no-allow-unauthenticated` flag keeps invocation behind IAM, which fits a backend called by another trusted service or by a frontend edge that handles authentication separately.

Healthy output confirms that Cloud Run created a revision and routed traffic. The service URL is real, but private invocation still requires IAM because of `--no-allow-unauthenticated`.

```console
Deploying container to Cloud Run service [orders-api] in project [orders-prod] region [us-central1]
OK Deploying new service... Done.
  OK Creating Revision...
  OK Routing traffic...
Done.
Service [orders-api] revision [orders-api-00041-stable] has been deployed and is serving 100 percent of traffic.
Service URL: https://orders-api-7a2b3c-uc.a.run.app
```

A public API might intentionally use `--allow-unauthenticated`, but that choice grants the Cloud Run Invoker role to public callers. The Orders team should make that decision in the service design, not by accepting a CLI prompt during a late deploy. For customer-facing checkout, many teams put Cloud Load Balancing, Identity-Aware Proxy, API Gateway, or application-level authentication in front of the backend depending on the wider architecture. After the first deploy, the team needs a release process, and Cloud Run revisions plus traffic splits give them that process.

## Revisions, Traffic Splits, and Rollback
<!-- section-summary: Revisions let the team separate deployment from release, so a new image can be verified before it receives customer traffic. -->

A **revision** captures a deployable version of the service. The Orders team gets a new revision when they deploy image `b7c91d2` or change runtime settings such as concurrency, environment variables, secrets, or the service account. Since a revision is immutable, rollback can move traffic back to a known previous runtime snapshot.

For a safer rollout, the team can deploy a new revision with no customer traffic. This keeps the new revision reachable by its tag while the main service URL continues using the current traffic split.

```bash
gcloud run deploy orders-api \
  --image=us-central1-docker.pkg.dev/orders-prod/apps/orders-api:b7c91d2 \
  --region=us-central1 \
  --service-account=orders-api-runtime@orders-prod.iam.gserviceaccount.com \
  --no-traffic \
  --tag=canary
```

That creates a revision and gives it a tag URL for direct verification. The team can check startup, logs, health, and a small internal smoke test before it reaches the main service URL. This is deployment without release.

```console
Service [orders-api] revision [orders-api-00042-canary] has been deployed and is serving 0 percent of traffic.
Tag URL: https://canary---orders-api-7a2b3c-uc.a.run.app
```

The revision list shows the named targets available for traffic. This gives the operator the exact revision names to use in rollout and rollback commands.

```bash
gcloud run revisions list \
  --service=orders-api \
  --region=us-central1
```

```console
REVISION                  ACTIVE  SERVICE     DEPLOYED                 DEPLOYED BY
orders-api-00042-canary   yes     orders-api  2026-06-27 20:13:42 UTC  ci-deploy@orders-prod.iam.gserviceaccount.com
orders-api-00041-stable   yes     orders-api  2026-06-26 18:02:17 UTC  ci-deploy@orders-prod.iam.gserviceaccount.com
```

When the canary looks healthy, a gradual traffic split might send a small percentage to the new revision. The percentages below keep most checkout traffic on the stable revision while the team watches the canary.

```bash
gcloud run services update-traffic orders-api \
  --region=us-central1 \
  --to-revisions=orders-api-00041-stable=95,orders-api-00042-canary=5
```

```console
Updating traffic...
Done.
Traffic:
  95% orders-api-00041-stable
   5% orders-api-00042-canary
```

If error rates rise, rollback is a traffic update to the previous revision. The rollback command routes all requests back to the revision that was serving before the canary.

```bash
gcloud run services update-traffic orders-api \
  --region=us-central1 \
  --to-revisions=orders-api-00041-stable=100
```

```console
Updating traffic...
Done.
Traffic:
  100% orders-api-00041-stable
```

Traffic rollback is fast because the old revision still exists as a target. The team still watches startup latency, database pressure, and logs after the rollback, because instances for the old revision may need to start again and downstream systems may still be recovering from the bad release. Traffic controls handle release safety, and scaling controls protect the rest of the system while the service is running.

![Cloud Run safe release and rollback loop](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis/cloud-run-safe-release-loop.png)
*A safe Cloud Run release separates deploy, verification, small traffic exposure, and rollback evidence instead of treating deploy as the whole release.*

## Concurrency and Downstream Protection
<!-- section-summary: Concurrency decides how many requests one instance can handle, and that setting must match database pools and external dependency limits. -->

**Concurrency** is the maximum number of requests one Cloud Run instance can process at the same time. If the Orders API has concurrency set to `20`, one warm instance can handle up to 20 simultaneous requests before Cloud Run needs another instance for extra load. Higher concurrency can reduce instance count and cost, but the application code and dependencies must be safe under that shared load.

The Orders API does database writes, payment calls, and inventory checks. If one instance can process 80 requests at once, the app may create many simultaneous database queries inside one container. If concurrency is set too low, Cloud Run may start more instances than needed, and each instance may open its own connection pool.

The team should size concurrency with downstream limits in mind. Suppose the database team gives the Orders API a budget of 180 active database connections. If each Cloud Run instance opens a pool of 5 connections, a max of 30 instances keeps the worst-case pool count near 150 connections and leaves room for migrations, admin sessions, and other services. Concurrency then decides how much user traffic those 30 instances can absorb before requests queue or fail.

A practical starting update may look like this. This changes the service configuration and records the value in a new revision.

```bash
gcloud run services update orders-api \
  --region=us-central1 \
  --concurrency=20
```

The team should test this value with realistic checkout traffic. CPU-heavy code may need lower concurrency. Mostly I/O-bound code may tolerate higher concurrency. The important production habit is treating concurrency as a capacity control, not a random default. Concurrency shapes each instance, while max and min instances shape the whole service.

## Max and Min Instances
<!-- section-summary: Max instances cap blast radius for downstream systems, while min instances keep warm capacity for latency-sensitive paths. -->

**Max instances** sets an upper limit on how many Cloud Run instances the service can run. This is one of the most important safety controls for a public backend. Autoscaling without a cap can turn a traffic spike into a database incident if every new instance opens connections or calls the same downstream API.

The Orders team might set the service to at most 30 instances. That number should come from dependency budgets, load testing, and the team's chosen failure mode.

```bash
gcloud run services update orders-api \
  --region=us-central1 \
  --max-instances=30
```

That cap does not make the API infinitely reliable. When demand exceeds what 30 instances can handle, callers may see latency or errors. The cap gives the team a controlled failure mode instead of letting the checkout database collapse under a connection surge.

**Min instances** keeps a configured number of instances warm and ready to receive requests. This can reduce cold-start latency on important paths, and it also creates predictable baseline cost. Google documents billing considerations for minimum instances, so teams usually choose small values for latency-sensitive services and keep admin or low-traffic services at zero.

For the Orders API, one warm instance may be enough to protect normal checkout latency. A busier service might choose a larger baseline after measuring cold starts and cost.

```bash
gcloud run services update orders-api \
  --region=us-central1 \
  --min-instances=1
```

![Cloud Run runtime controls around downstream systems](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis/cloud-run-runtime-controls.png)
*Concurrency, max instances, min instances, and service account identity are runtime controls around the same container, and each one protects a different downstream dependency.*

Minimum instances are useful, but they are still managed instances. The application should start cleanly, handle restarts, and expose useful health behavior. A warm instance is a latency tool, not a replacement for good startup code and safe retries. Scaling limits protect capacity, and runtime identity protects access.

## Runtime Identity
<!-- section-summary: The deployer identity manages Cloud Run, while the service identity is the account the running container uses for Google API calls. -->

Cloud Run uses two identity ideas that beginners often mix together. The **deployer account** is the user or CI/CD service account that creates services, deploys revisions, and changes configuration through the Cloud Run Admin API. The **service identity** is the service account attached to the running Cloud Run service or revision.

For the Orders API, the deployer might be a GitHub Actions workflow using Workload Identity Federation. That deployer needs Cloud Run deployment permissions and the ability to attach the runtime service account. Google documents this attachment permission through the Service Account User role, which contains `iam.serviceAccounts.actAs`.

The running container should use a narrower account. A dedicated runtime identity might look like this, with only the roles the Orders API needs for Cloud SQL and one Secret Manager secret.

```bash
gcloud iam service-accounts create orders-api-runtime \
  --project=orders-prod \
  --display-name="Orders API runtime"

gcloud projects add-iam-policy-binding orders-prod \
  --member="serviceAccount:orders-api-runtime@orders-prod.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud secrets add-iam-policy-binding orders-db-url \
  --project=orders-prod \
  --member="serviceAccount:orders-api-runtime@orders-prod.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

That runtime identity can connect to Cloud SQL and read the specific database secret. It does not need project Owner, project Editor, broad Secret Manager access, or deployment permissions. If the Orders container is compromised, the attacker receives only the runtime permissions attached to this service account.

The service can attach or change the identity with an update. That update also creates a new revision because the runtime configuration changed.

```bash
gcloud run services update orders-api \
  --region=us-central1 \
  --service-account=orders-api-runtime@orders-prod.iam.gserviceaccount.com
```

Identity answers who the service is. Environment variables and secrets answer what settings the service receives at runtime, and those settings need the same review discipline as image changes.

## Environment Variables and Secrets
<!-- section-summary: Environment variables carry non-sensitive configuration, while Secret Manager stores sensitive values and Cloud Run maps them into the container. -->

**Environment variables** are runtime values available to the process, such as `ENVIRONMENT`, `LOG_LEVEL`, `ORDERS_DB_NAME`, or a feature flag. They help the team promote the same image from development to staging to production while changing only the runtime configuration. The image tag can stay tied to the code version, and the service config can hold environment-specific values.

A non-sensitive configuration update might look like this. These values are safe to expose in service configuration because they do not contain credentials.

```bash
gcloud run services update orders-api \
  --region=us-central1 \
  --update-env-vars=ENVIRONMENT=prod,LOG_LEVEL=info,ORDERS_DB_NAME=orders
```

**Secrets** are sensitive values such as passwords, API tokens, certificates, and private keys. Google recommends storing these values in Secret Manager and making them available to Cloud Run as environment variables or mounted files. The service identity needs Secret Manager access to the specific secret.

If the Orders service maps the database URL from Secret Manager, the update could look like this. The secret name is `orders-db-url`, and Cloud Run exposes it to the container as `DATABASE_URL`.

```bash
gcloud run services update orders-api \
  --region=us-central1 \
  --set-secrets=DATABASE_URL=orders-db-url:latest
```

The team should treat secret mappings as release-sensitive configuration. A pinned secret version gives a revision a reproducible value. A `latest` mapping can simplify rotation, especially for mounted secret files, but the team still needs to understand when running instances pick up the value and how rollback should behave.

The application code should read configuration from its normal runtime environment and fail clearly when required values are missing. That failure should appear in logs during canary verification, long before customers depend on the new revision.

## Logs and Verification
<!-- section-summary: Cloud Run debugging relies on service status, revision status, request logs, container logs, and downstream metrics rather than SSH access. -->

Cloud Run sends several types of logs to Cloud Logging. **Request logs** describe requests sent to Cloud Run services. **Container logs** come from the application, usually standard output and standard error. **System logs** come from the platform. Together, these logs replace the old habit of SSHing into a server and looking around manually.

For the Orders API, the application should write structured logs to standard output and standard error. The log should include useful fields such as order ID, request ID, payment provider attempt, and the active code version, while avoiding card data, tokens, and customer secrets. Structured logs make Logs Explorer and alerting much more useful during a failed rollout.

The verification flow after a deploy usually checks service configuration, revisions, and logs. These commands give the operator the service state, the revision list, and the latest service logs.

```bash
gcloud run services describe orders-api \
  --region=us-central1

gcloud run revisions list \
  --service=orders-api \
  --region=us-central1

gcloud run services logs read orders-api \
  --region=us-central1 \
  --limit=50
```

Useful output has three different kinds of evidence: service URL and traffic, revision status, and logs tied to requests. In this example the canary is receiving five percent of traffic and the latest logs show both a successful request and one payment dependency error.

```console
URL: https://orders-api-7a2b3c-uc.a.run.app
Traffic:
  95% orders-api-00041-stable
   5% orders-api-00042-canary

REVISION                  ACTIVE  TRAFFIC
orders-api-00042-canary   yes     5
orders-api-00041-stable   yes     95

2026-06-27T20:20:31Z INFO  request_id=req-8f31 order_id=ORD-10492 status=202 revision=orders-api-00042-canary
2026-06-27T20:21:04Z ERROR request_id=req-8f44 order_id=ORD-10496 dependency=payment-provider error=timeout
```

For deeper filtering, the team can query Cloud Logging directly. The resource filter narrows the result to Cloud Run revisions for this service.

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="orders-api"' \
  --project=orders-prod \
  --limit=20
```

Verification should include downstream evidence too. The team checks Cloud SQL connection count, database latency, payment provider errors, Pub/Sub backlog, and error budget burn while the canary receives traffic. A Cloud Run revision can look healthy while the database is under stress, so service logs and dependency metrics need to be read together. Now the pieces can come together as one production rollout.

## Putting It All Together
<!-- section-summary: A healthy Cloud Run rollout connects image, service config, identity, secrets, scaling, traffic, and logs in one repeatable path. -->

The Orders team starts by building an immutable container image and pushing it to Artifact Registry. The application listens on the injected `PORT`, binds to `0.0.0.0`, writes structured logs, and treats durable state as an external service. That container contract lets Cloud Run start and route traffic to the service.

The first production deploy creates the `orders-api` service in `us-central1` with a dedicated runtime service account. The service account can connect to Cloud SQL and read only the required database secret. Environment variables hold non-sensitive settings, and Secret Manager holds the database URL.

For each new release, the team deploys a new revision with no traffic and a canary tag. They verify startup logs, revision status, health behavior, and dependency access through the tag URL or another controlled test path. When the canary looks healthy, they move a small percentage of traffic to it.

During the rollout, concurrency and max instances protect the database connection budget. Min instances keep one warm container ready for the checkout path. Logs, request metrics, database metrics, and payment-provider errors decide whether the rollout continues or traffic returns to the previous revision.

This is the production shape Cloud Run is good at: a stateless container service with a clear port contract, a managed service wrapper, explicit identity, controlled configuration, bounded scaling, and revision-based release safety. The Orders team can repeat the same pattern for other HTTP backends once the first service works reliably.

## What's Next
<!-- section-summary: The next runtime to understand is Compute Engine, because some workloads still need VM-level control. -->

Cloud Run is a strong default for the Orders API, but the older invoice PDF worker still needs a server-shaped home while the team modernizes it. The next article moves into Compute Engine and looks at virtual machines, machine types, images, disks, service accounts, startup scripts, zones, and maintenance behavior.

---

**References**

- [Cloud Run documentation](https://docs.cloud.google.com/run/docs) - Official Cloud Run documentation for services, jobs, worker pools, functions, configuration, security, and operations.
- [What is Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run) - Explains Cloud Run services, jobs, and worker pools as ways to run code on the same managed execution environment.
- [Container runtime contract](https://docs.cloud.google.com/run/docs/container-contract) - Documents the `PORT` environment variable, the `0.0.0.0` listener requirement, and other container requirements.
- [Deploying container images to Cloud Run](https://docs.cloud.google.com/run/docs/deploying) - Documents `gcloud run deploy`, service creation, image deployment, and invocation access choices.
- [Manage Cloud Run services](https://docs.cloud.google.com/run/docs/managing/services) - Documents service URLs and service-level management behavior.
- [Manage revisions](https://docs.cloud.google.com/run/docs/managing/revisions) - Explains immutable revisions, revision listing, tagged revisions, traffic routing, and revision retention considerations.
- [Rollbacks, gradual rollouts, and traffic migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration) - Documents traffic percentages, gradual rollout, split traffic, and rollback commands.
- [Maximum concurrent requests for services](https://docs.cloud.google.com/run/docs/about-concurrency) - Explains per-instance request concurrency and its operational impact.
- [Set maximum concurrent requests per instance](https://docs.cloud.google.com/run/docs/configuring/concurrency) - Documents the `--concurrency` configuration flow.
- [Set maximum instances for services](https://docs.cloud.google.com/run/docs/configuring/max-instances) - Documents service and revision maximum instance settings.
- [Set minimum instances for services](https://docs.cloud.google.com/run/docs/configuring/min-instances) - Documents warm minimum instances, billing considerations, and related commands.
- [Configure service identity for services](https://docs.cloud.google.com/run/docs/configuring/services/service-identity) - Documents Cloud Run service identity, deployer permissions, and `--service-account`.
- [Introduction to service identity](https://docs.cloud.google.com/run/docs/securing/service-identity) - Explains deployer identity and service identity for Cloud Run.
- [Configure environment variables for services](https://docs.cloud.google.com/run/docs/configuring/services/environment-variables) - Documents environment variable deployment and update flags.
- [Configure secrets for services](https://docs.cloud.google.com/run/docs/configuring/services/secrets) - Documents Secret Manager integration, secret environment variables, secret volumes, and required roles.
- [Logging and viewing logs in Cloud Run](https://docs.cloud.google.com/run/docs/logging) - Documents request logs, container logs, system logs, standard output, standard error, and CLI log commands.
