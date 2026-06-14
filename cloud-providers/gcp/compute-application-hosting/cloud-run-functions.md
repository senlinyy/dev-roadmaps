---
title: "Cloud Run Functions"
description: "Use Cloud Run functions for small event-driven work by understanding events, triggers, handlers, invocations, retries, timeouts, identity, logs, and when a service is simpler."
overview: "Not every piece of backend work should live inside the main API. This article explains Cloud Run functions as bounded handlers around the Orders system, with special attention to trigger shape and retry-safe design."
tags: ["gcp", "functions", "events", "eventarc", "pubsub"]
order: 4
id: article-cloud-providers-gcp-compute-application-hosting-cloud-run-functions-event-driven-workloads
aliases:
  - cloud-run-functions-and-event-driven-workloads
  - cloud-providers/gcp/compute-application-hosting/cloud-run-functions-and-event-driven-workloads.md
---

## Table of Contents

1. [What Cloud Run Functions Are](#what-cloud-run-functions-are)
2. [The Receipt and File Jobs Scenario](#the-receipt-and-file-jobs-scenario)
3. [Handlers, Triggers, and CloudEvents](#handlers-triggers-and-cloudevents)
4. [Pub/Sub and Eventarc Routing](#pubsub-and-eventarc-routing)
5. [At-Least-Once Delivery and Idempotency](#at-least-once-delivery-and-idempotency)
6. [Handler Shape in Code](#handler-shape-in-code)
7. [Deploying and Connecting a Trigger](#deploying-and-connecting-a-trigger)
8. [Timeouts, Retries, and Failure Paths](#timeouts-retries-and-failure-paths)
9. [Service Accounts, IAM, and Secrets](#service-accounts-iam-and-secrets)
10. [Logs and Operations](#logs-and-operations)
11. [When a Cloud Run Service Is Simpler](#when-a-cloud-run-service-is-simpler)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## What Cloud Run Functions Are
<!-- section-summary: Cloud Run functions run one handler for one HTTP request or event, while Cloud Run manages the container and scaling around that handler. -->

**Cloud Run functions** are small pieces of code deployed from source and run on Cloud Run. You write a handler, choose an entry point, choose a runtime, and connect the handler to an HTTP request or an event. Google Cloud builds the source into a container image, deploys it as a Cloud Run service, and invokes the handler when the trigger fires.

That sentence has a lot inside it, so let's slow it down. A **function** is the handler code. A **handler** is the function entry point that receives the input and performs the work. A **trigger** is the rule that starts the handler, such as an HTTP request, a Pub/Sub message, or a Cloud Storage object event. The runtime still runs in a container behind the scenes, but the authoring model stays focused on one handler instead of a full web service.

This is a good match for the jobs around our Orders and billing platform. In the previous article, the legacy invoice worker stayed on a Compute Engine VM because it needed a Linux daemon, native packages, process supervision, and disk behavior. The receipt email job has a different shape. A checkout completes, an event is published, one handler sends one receipt email, and then that handler exits. The file-processing job is similar: a customer uploads a supporting document, a storage event arrives, one handler scans or classifies the file, and the handler exits.

The senior-to-junior version is this: use a VM for the old worker that really needs a server, and use Cloud Run functions for small pieces of event work that should wake up, do one bounded task, log what happened, and finish.

## The Receipt and File Jobs Scenario
<!-- section-summary: Receipt emails and upload processing are small event jobs, so they let us talk about triggers, retries, idempotency, identity, and logs with one consistent example. -->

The team has three background jobs near the checkout and billing flow. The invoice PDF worker still runs on a VM. The receipt email job sends a customer receipt after checkout. The upload processor reacts when a customer attaches a tax document or purchase order file. The last two jobs have no persistent server process requirement, so they are good candidates for Cloud Run functions.

The checkout path should stay fast. When a customer pays, the API should commit the order, publish a `checkout.completed` event, and return success. The receipt email can happen after that because email providers have their own latency and failure modes. If the email provider has a temporary outage, the checkout API should keep the customer's browser out of that wait time.

The upload path has the same idea. A customer uploads `po-10492.pdf` to Cloud Storage. The application needs to scan it, extract metadata, and mark it ready for finance review. That work can run after the upload event. The upload service can rely on bucket events, and the processor can stay idle between files.

These jobs give us a clean map:

| Job | Event source | Function | Main risk |
|---|---|---|---|
| Send receipt email | Pub/Sub topic `checkout-events` | `send-order-receipt` | Duplicate event sends duplicate email. |
| Process uploaded file | Cloud Storage object finalized event | `process-billing-upload` | Retry reprocesses the same file. |
| Clean old temporary files | Cloud Scheduler through Pub/Sub or HTTP | `cleanup-billing-temp` | Long work exceeds timeout. |

Each job needs the same design pieces: a small handler, an event trigger, an idempotency guard, a timeout choice, a runtime service account, and logs that connect the attempt back to the customer or file.

## Handlers, Triggers, and CloudEvents
<!-- section-summary: A function handler is the code entry point, a trigger starts it, and CloudEvents gives event-driven handlers a standard envelope. -->

A **function entry point** is the named handler that Cloud Run invokes. In Node.js, for example, the Functions Framework registers the handler by name. When you deploy, the `--function` flag points Cloud Run at that entry point. The same source directory can contain supporting modules, but the deployed function should have one obvious job.

A **trigger** decides what starts the handler. HTTP functions receive HTTP requests, which fits webhooks or small internal endpoints. Event-driven functions receive events from Google Cloud sources, such as Pub/Sub topics or Cloud Storage buckets. Cloud Run functions use the Functions Framework, and event-driven functions use **CloudEvents**, an industry standard for describing event data in a common way.

A **CloudEvent** has metadata fields that help the handler understand what happened. The important beginner fields are `id`, `source`, `type`, `time`, and `data`. The CloudEvents specification says producers must make `source` plus `id` unique for each distinct event, and consumers may treat the same `source` plus `id` as a duplicate. That pair is perfect for our idempotency key later.

For the receipt email job, the envelope might describe a Pub/Sub message. The message payload contains business data such as `orderId`, `customerEmail`, and `correlationId`. The envelope tells us how the event was delivered. The payload tells us what the billing application wants done.

Here is the useful separation:

| Part | Example | What the handler uses it for |
|---|---|---|
| **CloudEvent `id`** | `1096437892045551` | Duplicate detection with the source. |
| **CloudEvent `source`** | `//pubsub.googleapis.com/projects/prod/topics/checkout-events` | Duplicate detection and audit trail. |
| **CloudEvent `type`** | `google.cloud.pubsub.topic.v1.messagePublished` | Handler routing and log context. |
| **CloudEvent `data`** | Pub/Sub message body | Business fields such as order ID and email address. |
| **Application `correlationId`** | `checkout-0f7b8c` | Connecting API logs to function logs. |

This is why a function should stay small. A small handler can understand one event envelope, validate one payload, perform one side effect, and write one clear result.

## Pub/Sub and Eventarc Routing
<!-- section-summary: Pub/Sub carries application messages, while Eventarc filters Google Cloud events and routes them to destinations such as Cloud Run functions. -->

**Pub/Sub** is Google Cloud's managed messaging service. A publisher writes a message to a topic, and subscribers receive messages from that topic. For the receipt email job, the checkout API publishes a message to `checkout-events` after the order transaction commits. The function receives the message later, so the customer's checkout response returns without waiting for the email provider.

**Eventarc** is Google Cloud's event routing service. Eventarc Standard can filter events from providers by source, type, and attributes, then route them to a destination such as a Cloud Run service or function. For the upload processor, Eventarc can listen for Cloud Storage object finalized events on a specific bucket and invoke `process-billing-upload`.

The difference is practical. Pub/Sub is a good fit when your application decides that something happened and publishes a domain message, like `checkout.completed`. Eventarc is a good fit when a Google Cloud service emits the event, like "an object was finalized in this bucket." Both can land in Cloud Run functions, and both require retry-safe code.

Our Orders and billing platform can use both:

| Workload | Routing path | Why this path fits |
|---|---|---|
| Receipt email | API publishes to Pub/Sub topic, function receives message | The application owns the business event and payload. |
| File processor | Cloud Storage emits an object event, Eventarc routes it | The platform event starts the work directly after upload. |
| Nightly cleanup | Cloud Scheduler triggers Pub/Sub or HTTP | The clock starts the work on a predictable schedule. |

The connection between sections is important here. Once a trigger can deliver work automatically, the next question is what happens when delivery repeats. Event systems are reliable because they retry, and retrying changes how handlers must write side effects.

## At-Least-Once Delivery and Idempotency
<!-- section-summary: Event-driven functions can receive the same event more than once, so production handlers need an idempotency guard before external side effects. -->

**At-least-once delivery** means the platform may deliver an event more than one time. Google Cloud documents at-least-once execution for event-driven Cloud Run functions. This is useful for reliability because a transient failure can get another attempt. It also means duplicate work is a normal engineering case rather than a rare surprise.

**Idempotency** means repeated attempts produce the same final result as one attempt. In our receipt function, the duplicate guard protects the customer from two emails when the same Pub/Sub message arrives twice. In the file processor, the same pattern protects finance reviewers from two records for the same storage event.

The usual pattern is an **idempotency guard**. The handler reads the CloudEvent `source` and `id`, combines them into a stable key, and claims that key in a database with a unique constraint or transactional create. Only the attempt that wins the claim performs the side effect. Later duplicate attempts see the existing claim and return successfully.

For a SQL-backed application, the table might look like this:

```sql
CREATE TABLE function_event_claims (
  event_key TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  business_id TEXT NOT NULL,
  status TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

Then the receipt handler follows a very ordinary order:

| Step | Receipt handler action | Reason |
|---|---|---|
| Receive | Read `source`, `id`, `type`, and payload | The handler needs event identity and business data. |
| Claim | Insert `source/id` into `function_event_claims` | The database decides which attempt owns the side effect. |
| Act | Send the email using the order ID and email address | The side effect happens after the duplicate guard. |
| Record | Mark the claim as completed and log the result | Operators can tell whether the event finished. |
| Duplicate | Return success if the claim already exists | The platform stops retrying without another email. |

This pattern is boring, which is exactly what we want near billing. Retries can happen, logs can show duplicates, and customers still receive one receipt for one checkout.

## Handler Shape in Code
<!-- section-summary: A good handler validates the event, claims it, performs one side effect, writes structured logs, and returns only after async work finishes. -->

The **Functions Framework** is the library that lets Cloud Run invoke your handler. For event-driven functions, it unmarshals the CloudEvents envelope and calls your registered handler. The handler should finish all asynchronous work before returning, because Cloud Run considers the event-driven function complete when the function returns.

Here is a Node.js shape for the receipt function. The code uses Firestore as the claim store because Firestore has transactional document creation. A relational database with a primary key or unique index works just as well.

```js
import { cloudEvent } from "@google-cloud/functions-framework";
import { Firestore } from "@google-cloud/firestore";
import { sendReceiptEmail } from "./email.js";

const db = new Firestore();

cloudEvent("sendReceipt", async (event) => {
  const encoded = event.data?.message?.data;
  const payload = encoded
    ? JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))
    : event.data;

  const eventKey = `${event.source}/${event.id}`;
  const claimRef = db.collection("function_event_claims").doc(eventKey);

  const claimed = await db.runTransaction(async (tx) => {
    const existing = await tx.get(claimRef);
    if (existing.exists) {
      return false;
    }

    tx.create(claimRef, {
      eventKey,
      eventType: event.type,
      orderId: payload.orderId,
      correlationId: payload.correlationId,
      status: "claimed",
      claimedAt: new Date().toISOString()
    });

    return true;
  });

  if (!claimed) {
    console.log(JSON.stringify({
      eventKey,
      orderId: payload.orderId,
      correlationId: payload.correlationId,
      duplicate: true
    }));
    return;
  }

  await sendReceiptEmail({
    orderId: payload.orderId,
    email: payload.customerEmail
  });

  await claimRef.set({
    status: "sent",
    completedAt: new Date().toISOString()
  }, { merge: true });

  console.log(JSON.stringify({
    eventKey,
    orderId: payload.orderId,
    correlationId: payload.correlationId,
    status: "sent"
  }));
});
```

There are a few quiet production choices in that code. The Firestore client lives outside the handler so warm instances can reuse it. The handler uses `source/id` as the event key. The claim happens before the email. The duplicate path logs and returns without throwing. The success path waits for the email call and the status update before returning.

The code should also distinguish retryable and permanent failures. A temporary email provider outage can throw, which lets the trigger retry if retries are configured. A malformed payload should log a clear validation failure and record a terminal state so the same bad event avoids a retry loop. That decision belongs in code because the platform cannot know which failures are safe to retry for your business process.

## Deploying and Connecting a Trigger
<!-- section-summary: Deployment chooses the function entry point and runtime, while the trigger decides which event source invokes it. -->

Cloud Run function deployment from source uses buildpacks and Cloud Build to build a container image for you. The basic deploy command names the function, source directory, entry point, base image, region, service account, and configuration values. The common source-deploy path gives you the Cloud Run service without a hand-written Dockerfile.

A typical receipt deployment looks like this:

```bash
gcloud run deploy send-order-receipt \
  --project=PROJECT_ID \
  --source=. \
  --function=sendReceipt \
  --base-image=nodejs24 \
  --region=us-central1 \
  --service-account=receipt-function-runtime@PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars=RECEIPT_FROM=receipts@example.com \
  --timeout=120s \
  --max-instances=20
```

That command deploys the code and service configuration. The event source still needs a route. For Pub/Sub, the team can create or reuse a topic, then create an Eventarc trigger that sends message-published events to the function's Cloud Run service:

```bash
gcloud pubsub topics create checkout-events \
  --project=PROJECT_ID

gcloud eventarc triggers create send-receipt-from-pubsub \
  --project=PROJECT_ID \
  --location=us-central1 \
  --destination-run-service=send-order-receipt \
  --destination-run-region=us-central1 \
  --event-filters=type=google.cloud.pubsub.topic.v1.messagePublished \
  --transport-topic=projects/PROJECT_ID/topics/checkout-events \
  --service-account=receipt-trigger-invoker@PROJECT_ID.iam.gserviceaccount.com
```

For the upload processor, the trigger filters Cloud Storage object events from the billing uploads bucket:

```bash
gcloud eventarc triggers create process-billing-upload \
  --project=PROJECT_ID \
  --location=us-central1 \
  --destination-run-service=process-billing-upload \
  --destination-run-region=us-central1 \
  --event-filters=type=google.cloud.storage.object.v1.finalized \
  --event-filters=bucket=billing-uploads-prod \
  --service-account=upload-trigger-invoker@PROJECT_ID.iam.gserviceaccount.com
```

In production, these commands usually live as Terraform or another reviewed deployment artifact. The key is the same either way: function deploy config answers how the code runs, and trigger config answers what invokes it.

## Timeouts, Retries, and Failure Paths
<!-- section-summary: Timeouts cap each attempt, retries create another attempt after failure, and the handler must decide which failures deserve another try. -->

A **timeout** is the maximum time one function attempt can run. Short timeouts protect the platform and your bill, but they also force the handler to stay small. The receipt function should finish in seconds. If sending a receipt regularly needs many minutes, the design probably needs a queue, a batch worker, or a Cloud Run service with a more explicit workflow.

**Retries** are new attempts after failed event handling. Eventarc retry behavior uses Pub/Sub delivery underneath, including exponential backoff and a default message retention window. Cloud Run functions also document differences based on how the function and trigger were created, so production teams should verify the actual trigger or subscription settings instead of relying on memory.

The most important rule is business-specific: retry transient failures and end permanent failures. A temporary email provider timeout is retryable. A missing `customerEmail` field in the payload is permanent because the same event will still be missing that field in the next attempt. A permanent failure should record a terminal state, log enough evidence, and return without throwing so retries stop.

Here is a practical failure table:

| Failure | Handler behavior | Why |
|---|---|---|
| Email provider 503 | Throw after logging the event key and provider response | A later attempt may succeed. |
| Duplicate event key | Return success after logging `duplicate: true` | The side effect already happened or is already claimed. |
| Invalid payload schema | Record `failed_validation`, log the field name, return success | Retrying the same malformed event will repeat the same result. |
| Database unavailable before claim | Throw | No durable claim exists, so another attempt should try again. |
| Timeout during email call | Let the attempt fail, then rely on idempotency during retry | The next attempt must recognize any completed side effect. |

Retries and idempotency belong together. Retry without idempotency risks duplicate receipts. Idempotency without retries can leave customers without receipts after transient outages. Together, they give you a handler that can recover without repeating customer-visible work.

## Service Accounts, IAM, and Secrets
<!-- section-summary: Each function should run with a narrow service account, and each trigger also needs an identity with the minimum delivery permissions. -->

A **runtime service account** is the identity the function uses when it calls Google Cloud APIs. The receipt function might need to read one Secret Manager secret, write to one Firestore collection, and publish an audit message. A custom service account gives reviewers a clear permission boundary and avoids broad project permissions from a default service account.

Eventarc triggers also use service accounts. Google Cloud documentation recommends user-managed service accounts for triggers in production and warns against leaning on highly privileged default identities. That matters because event delivery is a separate action from function runtime access. The trigger identity needs permission to invoke the target. The function runtime identity needs permission to do the business work.

For our receipt function, the IAM design might look like this:

| Identity | Needs | Example permission direction |
|---|---|---|
| `receipt-trigger-invoker@...` | Deliver Pub/Sub events to the Cloud Run function | Grant the invoke permissions required for the target service. |
| `receipt-function-runtime@...` | Read email API secret, write idempotency claims, write logs | Grant narrow access to Secret Manager, Firestore or database, and logging. |
| Human deployer or CI service account | Deploy source and act as the runtime service account | Grant deploy roles and `iam.serviceAccounts.actAs` through the normal CI path. |

Secrets deserve a short note. Environment variables are fine for non-sensitive configuration such as `RECEIPT_FROM` or `ENVIRONMENT`. API keys, database passwords, and signing secrets should live in Secret Manager or another secrets system, with access granted to only the function runtime service account. The handler then reads the secret through the client library or platform configuration rather than storing it in source code.

This identity split gives incident responders a clean answer. If the receipt handler has a dependency bug, the compromised function can only use the permissions attached to `receipt-function-runtime@...`. It cannot automatically process uploads, manage VMs, or read every secret in the project.

## Logs and Operations
<!-- section-summary: Function operations depend on structured logs, event keys, trigger visibility, retry settings, and a small runbook for common failures. -->

Cloud Run sends request, container, and application logs to Cloud Logging. For functions, `stdout` and `stderr` are enough for basic logs, and structured JSON logs make searching much easier. The receipt function should log `eventKey`, `orderId`, `correlationId`, `status`, and `duplicate` where relevant. The upload processor should log `bucket`, `object`, `generation`, `eventKey`, and scan result.

The **correlation ID** connects the customer-facing API request to the background function. The checkout API can generate `checkout-0f7b8c`, store it with the order, include it in the Pub/Sub message, and log it before returning to the browser. The function logs the same value. During an incident, an engineer searches one ID and sees the checkout request, Pub/Sub publish, receipt attempt, provider response, and final status.

A small runbook for the receipt function might look like this:

| Situation | First checks | Recovery action |
|---|---|---|
| Customer missing receipt | Search logs by `orderId` and `correlationId`, check claim status | Requeue the event or run a controlled resend path after confirming no successful send. |
| Duplicate receipt reported | Search by `eventKey`, inspect claim table uniqueness | Fix the idempotency guard before replaying any events. |
| Function retries for hours | Check latest errors, trigger retry policy, and event age | Patch permanent failure handling and redeploy, or disable/remove the bad trigger path if needed. |
| Upload processor misses files | List Eventarc triggers, check bucket event filters, inspect Cloud Storage object metadata | Repair trigger filters or bucket permissions, then replay from an audit list if the business requires it. |
| Slow processing | Review timeout logs, cold starts, downstream latency, and max instance settings | Raise timeout only if the work is still bounded, or move larger work to Cloud Run service or jobs. |

Useful day-two commands start with logs and trigger inventory:

```bash
gcloud run services logs read send-order-receipt \
  --project=PROJECT_ID \
  --region=us-central1 \
  --limit=50

gcloud eventarc triggers list \
  --project=PROJECT_ID \
  --location=us-central1
```

For a team that is new to event-driven work, the biggest cultural change is accepting that the customer request and the background result are separate. The API can succeed while the receipt function later fails. That is fine only if logs, claims, retry policy, and operator actions are designed up front.

## When a Cloud Run Service Is Simpler
<!-- section-summary: Cloud Run functions fit one bounded handler, while a Cloud Run service fits a larger HTTP or worker application with routes, revisions, and richer service configuration. -->

A **Cloud Run service** is the fuller container service model behind Cloud Run. It fits applications with multiple routes, framework middleware, richer HTTP behavior, custom containers, gradual traffic migration, and service-level configuration. Cloud Run functions are built on Cloud Run, but the function authoring model intentionally narrows attention to one handler.

The receipt function should stay a function as long as it has one input and one side effect. A mini application with `/receipts/send`, `/receipts/status`, `/receipts/retry`, `/templates/render`, and `/health/custom` routes belongs in a Cloud Run service where routes, revisions, health behavior, and rollouts are first-class.

The same rule applies to the upload processor. One storage event and one scan step fit a function. A document processing service with preview APIs, multiple scan vendors, batch retry endpoints, admin routes, and shared middleware should move to a Cloud Run service. For long batch jobs that need task semantics rather than request or event handling, Cloud Run jobs may also be a cleaner fit.

A simple decision table helps during design review:

| Workload shape | Good fit |
|---|---|
| One Pub/Sub event sends one receipt | Cloud Run function |
| One Cloud Storage event processes one file | Cloud Run function |
| External webhook with tiny validation and one write | HTTP Cloud Run function |
| Multi-route API with shared auth and routing middleware | Cloud Run service |
| Long batch task with a clear start and finish | Cloud Run job |
| Continuous worker that should always run | Cloud Run worker pool or another worker runtime |

This keeps the platform simple. Functions handle small event edges. Services handle application surfaces. Jobs handle batch work. VMs keep the legacy worker until the team has time to remove the server-shaped dependency.

## Putting It All Together
<!-- section-summary: The receipt workflow combines a domain event, Eventarc or Pub/Sub routing, a CloudEvents handler, idempotency, IAM, retries, and logs. -->

Let's replay the billing flow end to end. A customer checks out, and the API commits the order transaction. After the commit, the API publishes a `checkout.completed` message to the `checkout-events` Pub/Sub topic with `orderId`, `customerEmail`, and `correlationId`. The API returns success to the customer without waiting for the email provider.

Event routing invokes the `send-order-receipt` Cloud Run function. The Functions Framework passes the CloudEvents object into the `sendReceipt` handler. The handler builds an idempotency key from `source/id`, claims that key in Firestore or SQL, and sends the receipt email only after the claim succeeds. If the same event arrives again, the duplicate path logs and returns without sending another email.

The function runs as `receipt-function-runtime@...`, so it can read only the email secret and write only the state it needs. The trigger uses its own service account to deliver the event. Logs include the event key, order ID, correlation ID, status, and duplicate flag. Timeouts keep each attempt bounded, and retries handle transient failures without turning duplicate delivery into duplicate customer email.

That is the production shape for small event-driven work on Google Cloud. The handler is tiny, but the design around it is complete: event source, trigger, envelope, idempotency, identity, failure behavior, and operations.

## What's Next
<!-- section-summary: The next article moves from single handlers and services into managed Kubernetes for teams that need cluster-level orchestration. -->

Cloud Run functions are a strong fit for receipt emails, upload processing, and small integration handlers. Cloud Run services cover larger containerized services. Some teams eventually need Kubernetes because they have many services, custom controllers, service mesh policy, advanced scheduling, or platform teams standardizing workloads across a cluster.

The next article moves into GKE. The important thing to carry forward is the habit we used here: choose the runtime from the workload shape, then make the operational contract visible before production traffic depends on it.


---

**References**

- [Cloud Run functions documentation](https://docs.cloud.google.com/functions/docs) - Google Cloud's documentation hub for Cloud Run functions.
- [Compare Cloud Run functions](https://docs.cloud.google.com/run/docs/functions/comparison) - Explains that Cloud Run functions are deployed as Cloud Run services from source code.
- [Write Cloud Run functions](https://docs.cloud.google.com/run/docs/write-functions) - Documents Functions Framework entry points, HTTP functions, and event-driven CloudEvents functions.
- [Deploy a Cloud Run function](https://docs.cloud.google.com/run/docs/deploy-functions) - Shows source deployment, buildpacks, Cloud Build, base images, and `gcloud run deploy --function`.
- [When should I deploy a function?](https://docs.cloud.google.com/run/docs/functions-with-run) - Describes function use cases such as responding to file uploads, log changes, and Pub/Sub messages.
- [Eventarc overview](https://docs.cloud.google.com/eventarc/docs/overview) - Explains Eventarc Standard event filtering and routing by source, type, and attributes.
- [Manage triggers](https://docs.cloud.google.com/eventarc/docs/managing-triggers) - Documents trigger management through console, Google Cloud CLI, and API.
- [Retry events in Eventarc](https://docs.cloud.google.com/eventarc/docs/retry-events) - Documents retry backoff behavior and Eventarc message retention defaults.
- [Configure event-driven function retries](https://docs.cloud.google.com/run/docs/tips/function-retries) - Covers at-least-once execution, retry configuration, retry loops, and idempotent handler guidance.
- [Functions best practices](https://docs.cloud.google.com/run/docs/tips/functions-best-practices) - Covers idempotency, background activity, local development, dependencies, and operational tips.
- [Roles and permissions for Eventarc Cloud Run targets](https://docs.cloud.google.com/eventarc/docs/roles-permissions) - Documents trigger service accounts and production guidance for user-managed identities.
- [Configure service identity for Cloud Run services](https://docs.cloud.google.com/run/docs/configuring/services/service-identity) - Explains Cloud Run service accounts and deployment/update commands.
- [Logging and viewing logs in Cloud Run](https://docs.cloud.google.com/run/docs/logging) - Documents Cloud Run log types and Cloud Logging integration.
- [CloudEvents specification](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md) - Defines required CloudEvents attributes such as `id` and `source`.
