---
title: "Cloud Run"
description: "Understand how Cloud Run turns a container into a managed service with an endpoint, revisions, traffic control, scaling, identity, logs, and release safety."
overview: "Cloud Run is a strong first GCP home for containers that already work locally and need a service endpoint, scaling, release history, logs, and runtime identity."
tags: ["gcp", "cloud-run", "containers", "revisions"]
order: 2
id: article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis
aliases:
  - cloud-run-services-for-backend-apis
  - cloud-providers/gcp/compute-application-hosting/cloud-run-services-for-backend-apis.md
---

## Table of Contents

1. [What Cloud Run Solves](#what-cloud-run-solves)
2. [Container First](#container-first)
3. [Service Endpoint](#service-endpoint)
4. [Revision](#revision)
5. [Traffic Split](#traffic-split)
6. [Concurrency](#concurrency)
7. [Minimum and Maximum Instances](#minimum-and-maximum-instances)
8. [Identity, Secrets, and Logs](#identity-secrets-and-logs)
9. [A Small Deploy and Verification Flow](#a-small-deploy-and-verification-flow)
10. [Putting It All Together](#putting-it-all-together)
11. [References](#references)

## What Cloud Run Solves
<!-- section-summary: Cloud Run wraps a working container with the production service controls it needs. -->

You have a container that works on your laptop. Maybe it is a contact-form API. It listens on port `8080`, accepts `POST /contact`, validates the message, stores it, and publishes a notification for the support team. Locally, Docker starts the process and your terminal shows the logs.

Production needs more around that same container. The API needs a service endpoint, a safe runtime identity, scaling rules, release history, traffic control, logs, and a clear way to move away from a bad deploy. **Cloud Run** gives you that managed service layer without asking your team to operate virtual machines or a Kubernetes cluster.

The easiest way to understand Cloud Run is to separate the application from the service wrapper. The container image answers "what code should run?" Cloud Run answers "how does production run it?" It gives the image an HTTPS path, starts instances, sends requests to those instances, records revision history, captures logs, applies IAM invocation rules, and scales the service based on traffic.

For the contact-form API, that means you are no longer just running `node server.js` in a terminal. You are creating a managed service that has a URL, a region, a revision, a runtime service account, a concurrency setting, and logs attached to each request. Beginners often miss this shift. Cloud Run is useful because it turns a working container into an operable service.

The contact-form API is a good Cloud Run example because it has a simple request shape. A caller sends an HTTP request, the app does bounded work, and the response returns quickly. Durable data lives outside the container in managed services such as Cloud SQL, Firestore, Pub/Sub, Secret Manager, or Cloud Storage.

For AWS readers, Cloud Run overlaps with App Runner as a managed container service. It also has Lambda-like request scaling and scale-to-zero behavior, while the deployable unit stays your container image.

## Container First
<!-- section-summary: A container packages the app, while Cloud Run expects the container to follow a small runtime contract. -->

A **container** packages your application code, language runtime, dependencies, and startup command into an image. The image should be repeatable: the same image that passed tests in CI should be the image you deploy. In Google Cloud, teams commonly store that image in Artifact Registry before deploying it to Cloud Run.

Cloud Run services follow a **container contract**. For an HTTP service, the ingress container must listen for HTTP requests on the port provided in the `PORT` environment variable. The app should bind to `0.0.0.0`, write logs to standard output or standard error, and keep durable state outside the container filesystem.

A small Node.js contact API can follow that contract like this:

```js
import express from "express";

const app = express();
const port = Number(process.env.PORT || 8080);

app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/contact", async (req, res) => {
  console.log(JSON.stringify({
    severity: "INFO",
    message: "contact request accepted",
    route: "/contact",
    emailDomain: String(req.body.email || "").split("@")[1] || "unknown"
  }));

  res.status(202).json({ accepted: true });
});

app.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({
    severity: "INFO",
    message: "contact api listening",
    port
  }));
});
```

Important parts:

- `process.env.PORT` lets Cloud Run choose the request port for the service.
- `0.0.0.0` lets the platform route traffic into the container.
- Structured JSON logs make Cloud Logging more useful during support work.
- The handler accepts the request and leaves durable storage and notification work to managed services outside the container.

The Dockerfile should launch the app directly:

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "server.js"]
```

Important parts:

- The image includes the runtime and app files needed at launch time.
- `npm ci --omit=dev` installs production dependencies from the lockfile.
- `CMD` starts the HTTP server without a manual shell step.

After the container contract is clear, the next object is the Cloud Run service.

## Service Endpoint
<!-- section-summary: A Cloud Run service gives the container a regional endpoint, invocation policy, configuration, scaling, identity, and logs. -->

A **Cloud Run service** is the managed resource around the container image. It has a regional name, a generated `run.app` URL, IAM invocation settings, environment variables, secret mappings, CPU and memory settings, scaling settings, service identity, logs, and release controls.

For the contact-form API, the service answers production questions the image alone cannot answer. Who can call it? Which service account does the app use? How many instances can start? Which version receives traffic? Where do logs go after a failed submission?

The URL can exist even if unauthenticated callers cannot invoke it. For a public contact form, the team may allow unauthenticated invocation or put the service behind a load balancer, API gateway, or application authentication layer. That access decision belongs to the service design rather than the container image.

A describe check shows the endpoint facts that reviewers need:

```bash
gcloud run services describe contact-api \
  --region=us-central1 \
  --format="yaml(metadata.name,status.url,status.traffic,spec.template.spec.serviceAccountName)"

gcloud run services get-iam-policy contact-api \
  --region=us-central1 \
  --format="yaml(bindings)"
```

Important parts:

- `status.url` is the generated Cloud Run URL for the regional service.
- `status.traffic` shows which revision receives normal service traffic.
- `serviceAccountName` shows the identity used by the running container.
- The IAM policy shows who can invoke the service under Cloud Run IAM protection.

Good evidence for an internal contact API might look like this:

```yaml
metadata:
  name: contact-api
status:
  url: https://contact-api-7a2b3c-uc.a.run.app
  traffic:
    - revisionName: contact-api-00017-green
      percent: 100
spec:
  template:
    spec:
      serviceAccountName: contact-api-runtime@support-prod.iam.gserviceaccount.com
---
bindings:
  - role: roles/run.invoker
    members:
      - serviceAccount:website-gateway@support-prod.iam.gserviceaccount.com
```

The generated `run.app` URL is useful for platform checks and tagged revision tests. A production domain such as `https://support.example.com/contact` usually sits in front of it through a load balancer, API gateway, or application route so the company owns the hostname, certificate, routing rules, and edge policy. The service endpoint is the managed Cloud Run resource around the container: regional URL, invocation policy, traffic target, runtime identity, scaling settings, and logs. That is why the endpoint review asks more than "what URL did the container get?"

After the service idea is clear, the next release object is the revision.

## Revision
<!-- section-summary: A revision is an immutable snapshot of deployable service configuration. -->

A **revision** is an immutable snapshot of the deployable service configuration. Cloud Run creates a new revision for a new image deploy or a runtime-setting change, such as environment variables, secrets, service account, memory, CPU, or concurrency.

The contact API uses revisions as release evidence. Revision `contact-api-00017-green` might run image `2026-07-04-a`, while revision `contact-api-00018-canary` runs image `2026-07-04-b`. The revision name lets the team connect logs, metrics, and traffic to one deployable snapshot.

The first deploy can create the service and its first revision:

```bash
gcloud run deploy contact-api \
  --image=us-central1-docker.pkg.dev/support-prod/apps/contact-api:2026-07-04-a \
  --region=us-central1 \
  --service-account=contact-api-runtime@support-prod.iam.gserviceaccount.com \
  --no-allow-unauthenticated
```

Important parts:

- `contact-api` is the Cloud Run service name.
- `--image` points to the container image that Cloud Run runs.
- `--region` chooses where the service lives.
- `--service-account` attaches the runtime identity used by application code.
- `--no-allow-unauthenticated` keeps invocation behind IAM until the team chooses a public entry design.

Healthy output should name the service, the first revision, and the URL:

```console
Deploying container to Cloud Run service [contact-api] in project [support-prod] region [us-central1]
OK Deploying new service... Done.
  OK Creating Revision...
  OK Routing traffic...
Done.
Service [contact-api] revision [contact-api-00001-hxf] has been deployed and is serving 100 percent of traffic.
Service URL: https://contact-api-7a2b3c-uc.a.run.app
```

You can create a new revision without sending normal service traffic to it:

```bash
gcloud run deploy contact-api \
  --image=us-central1-docker.pkg.dev/support-prod/apps/contact-api:2026-07-04-b \
  --region=us-central1 \
  --service-account=contact-api-runtime@support-prod.iam.gserviceaccount.com \
  --no-traffic \
  --tag=canary
```

Important parts:

- `--no-traffic` creates the revision while leaving the main service URL on the existing traffic target.
- `--tag=canary` gives the new revision a tag URL for direct smoke tests.
- The same service account is repeated so runtime identity changes do not slip into a code-only deploy.

Expected output should show zero percent of normal service traffic:

```console
Service [contact-api] revision [contact-api-00018-canary] has been deployed and is serving 0 percent of traffic.
Tag URL: https://canary---contact-api-7a2b3c-uc.a.run.app
```

![Cloud Run image, service, revision, and traffic shape](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis/cloud-run-release-shape.png)
*The image packages code, the service owns runtime settings, and each revision records one deployable snapshot.*

## Traffic Split
<!-- section-summary: A traffic split decides how much service traffic each revision receives. -->

A **traffic split** is the percentage of service requests routed to each active revision. It lets the team separate deployment from release. The new revision can exist, pass smoke checks, receive a small share of traffic, and then receive more traffic after logs and metrics look healthy.

This idea matters because deploying code and trusting code are different steps. A new revision can be present in Cloud Run with zero normal traffic. The team can call its tagged URL, check startup logs, confirm secret access, and run one controlled request. Only then does the team move a small percentage of real service traffic to it.

Picture a shop trying a new checkout screen. The team does not need to send every customer through it immediately. They can send a small slice first, watch payment errors and latency, then either increase the slice or move everyone back to the previous version. A Cloud Run traffic split gives the same release control at the service level.

For the contact API, the team can send five percent of traffic to the new revision:

```bash
gcloud run services update-traffic contact-api \
  --region=us-central1 \
  --to-revisions=contact-api-00017-green=95,contact-api-00018-canary=5
```

Important parts:

- The percentages must add up to 100.
- The old revision stays active, which gives the team a fast rollback target.
- Support teams should watch error rate, latency, and request volume by revision while the split is active.

Expected output should show the new routing plan:

```console
Updating traffic...
Done.
Traffic:
  95% contact-api-00017-green
   5% contact-api-00018-canary
```

Rollback is another traffic update:

```bash
gcloud run services update-traffic contact-api \
  --region=us-central1 \
  --to-revisions=contact-api-00017-green=100
```

Important parts:

- The command routes all normal service traffic back to the previous revision.
- The canary revision can stay available for investigation or be removed later.
- Logs from the canary remain useful because they are tied to the revision name.

![Cloud Run safe release and rollback loop](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis/cloud-run-safe-release-loop.png)
*A safer Cloud Run release moves through deploy, direct verification, limited traffic, observation, and rollback if needed.*

## Concurrency
<!-- section-summary: Concurrency controls how many simultaneous requests one Cloud Run instance can process. -->

**Concurrency** is the maximum number of requests one Cloud Run instance can handle at the same time. If concurrency is `20`, one warm instance can process up to 20 simultaneous requests before extra load pushes Cloud Run to add more instances.

The contact API may call a database, Secret Manager, and Pub/Sub. High concurrency can reduce instance count, but it can also create more simultaneous database queries or mail-provider calls inside one container. Low concurrency may protect downstream systems, but it can create more instances and higher cost for the same traffic.

Think of one Cloud Run instance as one small service desk. Concurrency decides how many customers that desk can handle at the same time. A desk that accepts 80 simultaneous customers may look efficient, but the worker behind it may then open too many database sessions or wait on too many provider calls. A desk that accepts only one customer at a time is easier to reason about, but Cloud Run may need many more desks during a traffic spike.

The setting is therefore a capacity tradeoff, not a magic speed knob. A mostly I/O-bound API can often handle higher concurrency because many requests wait on remote services. A CPU-heavy image processor may need lower concurrency because each request competes for the same CPU and memory inside the instance. The safe value comes from load tests, request duration, downstream limits, and error-rate evidence.

A practical update might set concurrency to 20:

```bash
gcloud run services update contact-api \
  --region=us-central1 \
  --concurrency=20
```

Important parts:

- The setting affects how much work one instance accepts at once.
- The right value depends on app behavior and downstream limits, not only Cloud Run defaults.
- A CPU-heavy image processor may need lower concurrency than an I/O-heavy contact API.

The useful beginner habit is to connect concurrency to downstream capacity. If each instance opens a database pool of five connections and the database budget is 100 connections, a max instance setting near 15 leaves room for migrations, admin sessions, and other services.

## Minimum and Maximum Instances
<!-- section-summary: Minimum instances keep warm capacity, while maximum instances cap the service to protect cost and downstream systems. -->

**Minimum instances** keep a configured number of idle instances warm. This can reduce cold-start latency for user-facing paths. **Maximum instances** cap how many instances Cloud Run can create for the service or revision. This protects cost and downstream systems during spikes.

The easiest way to picture this is a small front desk. Minimum instances decide how many staff members are already sitting at the desk before the next customer arrives. Maximum instances decide how many staff members the building is allowed to add during a rush. Too few warm staff can make the first customer wait. Too many total staff can overwhelm the database, email provider, or budget.

For the contact API, the team might keep one warm instance during business hours and cap total scale so the database and notification service are not overwhelmed:

```bash
gcloud run services update contact-api \
  --region=us-central1 \
  --min-instances=1 \
  --max-instances=15
```

Important parts:

- `--min-instances=1` keeps one idle instance ready, which can reduce first-request latency.
- `--max-instances=15` bounds cost and downstream pressure.
- Max instances can also cause requests to wait or fail under heavy load, so alerts should watch saturation.

These settings are service behavior, not app code. They should live in a reviewed deployment path such as Terraform, a deployment script, or a release pipeline so changes are visible.

Review these settings alongside downstream limits. If the service can scale to 15 instances and each instance opens five database connections, the service could use 75 database connections before admin sessions, migrations, and other services are counted. That simple multiplication is often the difference between a safe cap and a new outage.

![Cloud Run runtime controls around downstream systems](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-services-backend-apis/cloud-run-runtime-controls.png)
*Concurrency controls each instance, while min and max instances shape the whole service.*

## Identity, Secrets, and Logs
<!-- section-summary: Runtime identity, secret access, and logs turn a running container into an operable production service. -->

A **runtime service account** is the Google Cloud identity attached to the running service. The contact API should use a service account that can read only the secrets and data it needs. The deployer identity may have permission to deploy Cloud Run services, while the runtime identity should have narrower application permissions.

Keep the two identities separate during review. The deployer identity might be a CI service account such as `cloud-build-deployer@support-prod.iam.gserviceaccount.com`; it needs permission to deploy Cloud Run and act as the runtime service account during deployment. The runtime identity is `contact-api-runtime@support-prod.iam.gserviceaccount.com`; it is the identity the app uses after the container starts. That runtime identity should receive application permissions, such as reading one mail-provider secret or publishing to one topic.

Secrets should come from Secret Manager rather than the container image. A mail provider token can live as a secret version and be exposed to the service as an environment variable or mounted volume, depending on the app design.

The service update can connect a secret version:

```bash
gcloud run services update contact-api \
  --region=us-central1 \
  --set-secrets=MAIL_PROVIDER_TOKEN=mail-provider-token:latest
```

Important parts:

- `MAIL_PROVIDER_TOKEN` is the environment variable visible to the app.
- `mail-provider-token:latest` points to the Secret Manager secret and version alias.
- The runtime service account still needs permission to access that secret.

The IAM grant and policy check should name the runtime identity as the grantee:

```bash
gcloud secrets add-iam-policy-binding mail-provider-token \
  --project=support-prod \
  --member=serviceAccount:contact-api-runtime@support-prod.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor

gcloud secrets get-iam-policy mail-provider-token \
  --project=support-prod \
  --format="yaml(bindings)"
```

Expected policy evidence:

```yaml
bindings:
  - role: roles/secretmanager.secretAccessor
    members:
      - serviceAccount:contact-api-runtime@support-prod.iam.gserviceaccount.com
```

The interpretation is narrow. The grant gives secret access to the running app identity only. In a larger setup, the team may apply the role on a specific secret, folder pattern, or managed policy path, but the review still asks which runtime identity can read which secret.

Logs matter because Cloud Run captures standard output and standard error. The contact API should include fields such as route, request ID, revision, sanitized validation error, and downstream provider name. It should avoid raw message bodies, passwords, tokens, and unnecessary personal data.

A log review should prove both success and safe failure:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="contact-api"
   resource.labels.revision_name="contact-api-00018-canary"
   jsonPayload.route="/contact"' \
  --limit=5 \
  --format="value(timestamp,jsonPayload.severity,jsonPayload.message,jsonPayload.requestId,jsonPayload.status,jsonPayload.errorCode)"
```

Useful output:

```console
2026-07-04T10:18:22Z INFO contact request accepted req-9c12 202 -
2026-07-04T10:19:04Z ERROR mail provider publish failed req-9c22 502 PROVIDER_TIMEOUT
```

The first line proves the new revision accepted a request. The second line gives support a request ID, route, status, and sanitized provider error without leaking the mail token or message body. If the error code is `PERMISSION_DENIED` while reading Secret Manager, the next check is the runtime service account policy above.

## A Small Deploy and Verification Flow
<!-- section-summary: A basic Cloud Run release checks the service, revision, logs, traffic, and scaling controls before calling the deploy healthy. -->

After the core ideas are clear, the deploy flow should read like a short release checklist. The goal is not only to run a command. The goal is to create a new revision, prove which revision exists, move a controlled amount of traffic, and leave evidence that a reviewer can understand later.

For the contact API, the team wants a new image online without immediately replacing the stable revision. That is why the first command creates a tagged canary revision with no normal traffic. The second command records the revision and URL. The third command moves a small traffic share after direct checks pass.

```bash
gcloud run deploy contact-api \
  --image=us-central1-docker.pkg.dev/support-prod/apps/contact-api:2026-07-04-b \
  --region=us-central1 \
  --service-account=contact-api-runtime@support-prod.iam.gserviceaccount.com \
  --no-traffic \
  --tag=canary

gcloud run services describe contact-api \
  --region=us-central1 \
  --format="value(status.latestCreatedRevisionName,status.url)"

gcloud run services update-traffic contact-api \
  --region=us-central1 \
  --to-revisions=contact-api-00017-green=95,contact-api-00018-canary=5
```

Important parts:

- The first command creates a tagged revision without normal traffic.
- The describe command gives the latest revision name and service URL for release notes.
- The traffic command exposes a small percentage after direct checks pass.

Expected describe output should show the revision and URL:

```console
contact-api-00018-canary    https://contact-api-7a2b3c-uc.a.run.app
```

The team should verify these signals before raising traffic:

| Signal | What to check |
|---|---|
| **Startup** | The revision reaches ready state and logs a clean startup message. |
| **Health route** | `/healthz` answers from the canary tag URL. |
| **Request behavior** | A test contact request returns the expected status and does not expose sensitive data in logs. |
| **Downstream pressure** | Database connections, Pub/Sub publish errors, and mail-provider errors stay within the expected range. |
| **Revision evidence** | Logs and metrics include or can be filtered by revision. |

## Putting It All Together
<!-- section-summary: Cloud Run fits stateless container services with clear release, scaling, identity, and logging needs. -->

Cloud Run fits the contact-form API because the workload has a request-driven container shape. The app listens on the provided port, stores state outside the container, uses a narrow runtime service account, and emits logs that support real operations.

The service gives the container its production wrapper: endpoint, IAM invocation choice, revision history, traffic split, concurrency, min and max instances, secret access, and Cloud Logging. Those controls are the reason Cloud Run often works well before a team needs VM operations or a Kubernetes platform.

The next article covers Compute Engine, where the job changes from "run this container service" to "some software expects a server."

## References

- [What is Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run) - Official overview of Cloud Run services, jobs, functions, and managed runtime behavior.
- [Cloud Run container runtime contract](https://docs.cloud.google.com/run/docs/container-contract) - Official contract for ports, requests, resources, and container behavior.
- [Maximum concurrent requests for services](https://docs.cloud.google.com/run/docs/about-concurrency) - Official guide for Cloud Run concurrency behavior.
- [Set minimum instances for services](https://docs.cloud.google.com/run/docs/configuring/min-instances) - Official guide for keeping idle service instances warm.
- [Set maximum instances for services](https://docs.cloud.google.com/run/docs/configuring/max-instances) - Official guide for Cloud Run maximum instance limits.
- [Manage revisions and traffic](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration) - Official guide for revisions, gradual rollouts, rollbacks, and traffic migration.
- [Configure service identity](https://docs.cloud.google.com/run/docs/configuring/services/service-identity) - Official guide for assigning a runtime service account to Cloud Run services.
- [Configure secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets) - Official guide for using Secret Manager secrets with Cloud Run.
- [View logs in Cloud Run](https://docs.cloud.google.com/run/docs/logging) - Official guide for Cloud Run request and application logs.
