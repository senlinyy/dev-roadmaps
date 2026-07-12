---
title: "Cloud Run Functions"
description: "Use Cloud Run functions for small event-driven work by understanding functions, handlers, triggers, events, CloudEvents, Pub/Sub, Eventarc, retries, idempotency, identity, and logs."
overview: "Some backend work should run after an event instead of staying inside the main request. Cloud Run functions fit small handlers such as thumbnail generation, receipt email, and cleanup jobs."
tags: ["gcp", "functions", "events", "eventarc", "pubsub"]
order: 4
id: article-cloud-providers-gcp-compute-application-hosting-cloud-run-functions-event-driven-workloads
aliases:
  - cloud-run-functions-and-event-driven-workloads
  - cloud-providers/gcp/compute-application-hosting/cloud-run-functions-and-event-driven-workloads.md
---

## Table of Contents

1. [Why Event Work Lives Outside the Main Request](#why-event-work-lives-outside-the-main-request)
2. [Function](#function)
3. [Handler](#handler)
4. [Trigger](#trigger)
5. [Event](#event)
6. [CloudEvent](#cloudevent)
7. [Pub/Sub and Eventarc](#pubsub-and-eventarc)
8. [Retry and Idempotency](#retry-and-idempotency)
9. [Code Shape](#code-shape)
10. [Deploy and Verify](#deploy-and-verify)
11. [Identity, Secrets, and Operations](#identity-secrets-and-operations)
12. [Putting It All Together](#putting-it-all-together)
13. [References](#references)

## Why Event Work Lives Outside the Main Request
<!-- section-summary: Cloud Run functions fit bounded work that should run after an event rather than inside a customer request. -->

Some work should happen after an event, not inside the main request. A profile page should not wait while your app generates every thumbnail size. A checkout response should not wait while an email provider accepts a receipt. A support upload should not block while a virus scan or metadata extractor runs.

The main request should commit the important user action and hand follow-up work to an event path. Then a smaller piece of code can wake up, do one bounded task, write logs, and finish. **Cloud Run functions** are a good fit for that shape because you write a focused piece of source code while Google Cloud builds and runs it on Cloud Run.

The important beginner idea is the handoff. The web API should finish the user-facing action first: save the profile change, accept the purchase, or store the uploaded file. After that, an event says, "something useful just happened." A function listens for that event and performs the follow-up work. This keeps the main user path short and gives slower jobs their own retry, logging, and failure handling.

That separation also makes ownership clearer. The upload API owns accepting the original file. The thumbnail function owns derived image sizes. The receipt function owns email delivery. If email delivery fails, the purchase record can still exist, and the team can retry the receipt function without asking the customer to buy the ticket again.

Two examples help because event work comes in different shapes. The first is thumbnail generation after a user uploads an image to Cloud Storage. The second is a receipt email after a purchase event reaches Pub/Sub. The sections below introduce each needed idea before using it in the examples.

## Function
<!-- section-summary: A function is a small deployable unit of code with one focused job. -->

A **function** is a small deployable unit of code with one focused job. In Cloud Run functions, you deploy source code and choose an entry point. Google Cloud uses buildpacks and Cloud Build to turn that source into a container image, then runs it on Cloud Run.

For thumbnail generation, the function's job is narrow: receive one image-upload event, create the required thumbnail files, store them, and record the result. For receipt email, the function's job is also narrow: receive one purchase event, send one receipt if it has not already been sent, and record the result.

Think of the function as one named worker with one inbox. The inbox is the trigger, and the worker's task is the handler code. That shape is different from a full web service with many routes and long-lived business flows. A function should be easy to describe in one sentence: "generate thumbnails for new profile uploads" or "send receipts for completed purchases."

This focus helps during operations. If thumbnail generation is slow, the team can inspect thumbnail function logs, retries, runtime identity, and object metadata. If receipt delivery fails, the team can inspect the receipt function, Pub/Sub message, idempotency store, and email provider response. The function boundary tells responders where one piece of asynchronous work starts and ends.

That narrow job is the reason functions are useful. The code does not need to own a full web API, route table, or long-running server loop. It owns one task that starts from a specific input.

For AWS readers, Cloud Run functions are closest to Lambda as an authoring pattern. A key GCP detail is that current Cloud Run functions build and run on Cloud Run, so you get function-style source deployment on top of the Cloud Run platform.

## Handler
<!-- section-summary: A handler is the named entry point Cloud Run invokes for each function run. -->

A **handler** is the named entry point Cloud Run invokes. In Node.js, the Functions Framework registers the handler name. In Python, the function name or decorator marks the entry point. The deploy command points Cloud Run to that entry point.

Think of the handler as the one function the platform calls after the event arrives. The platform handles the outer work: receiving the event, starting an instance, loading your code, and invoking the entry point. Your handler handles the business work: validate the event, decide whether the event should be processed, perform the side effect, write logs, and return a clear result.

The handler should validate input, perform one side effect, write structured logs, and finish all asynchronous work before returning. Cloud Run treats the function invocation as complete after the handler returns, so unfinished promises, background timers, or open work can create confusing results.

For thumbnail generation, the handler receives information about the uploaded object. It checks the bucket and object name, skips files that are already thumbnails, downloads the original, writes thumbnails, and logs the image ID. For receipt email, the handler checks the purchase event, claims the event key, sends the email, records completion, and logs the order ID.

A strong handler has a small visible shape:

- It rejects events from the wrong bucket, topic, or type.
- It extracts stable IDs such as object name, generation, order ID, and event ID.
- It uses those IDs for idempotency before sending email, writing thumbnails, or updating status.
- It logs the event ID and result without printing secrets or customer payloads.
- It returns only after required asynchronous work has finished.

## Trigger
<!-- section-summary: A trigger is the rule that decides what starts the handler. -->

A **trigger** is the rule that starts the handler. An HTTP trigger starts a function from a request. An event trigger starts a function after an event source emits a matching event. Cloud Run functions can use triggers for sources such as Pub/Sub messages and Cloud Storage object changes.

The trigger is separate from the handler on purpose. The handler says what the code does. The trigger says which outside signal is allowed to call that code. A thumbnail handler should not run for every object in every bucket. It should run for the upload bucket and the object-finalized event that means a file finished writing.

The trigger should match the real job:

| Job | Trigger shape | Why it fits |
|---|---|---|
| Generate thumbnails | Cloud Storage object finalized event | The file upload itself starts the work. |
| Send receipt email | Pub/Sub message event | The application publishes a business event after checkout succeeds. |
| Clean temp files | Scheduler to Pub/Sub or HTTP | A clock event starts periodic cleanup. |

The trigger gives the platform a delivery rule. The handler still needs to protect the business side effect, because delivery can repeat during retries.

Trigger review should answer four questions:

- Which source emits the event?
- Which event type should match?
- Which service account or runtime identity receives the event?
- Which logs prove one test event reached the handler?

Those questions catch a common failure: the function code is correct, but the platform never sends it the event the developer expected.

## Event
<!-- section-summary: An event is a record that something happened and carries enough data for the handler to act. -->

An **event** is a record that something happened. The event may come from your application, such as `purchase.completed`, or from a Google Cloud service, such as a Cloud Storage object finalized event. The event should contain enough information for the handler to do its job or look up the missing details safely.

An event is not the same as the work itself. A Cloud Storage event says an object exists. The handler still decides whether that object is a real upload, a thumbnail, a temporary file, or something the function should ignore. A Pub/Sub purchase event says checkout completed. The handler still decides whether the receipt was already sent and which template to use.

For the thumbnail job, the event needs the bucket name, object name, generation, content type, and enough metadata to skip derived thumbnail files. For the receipt job, the event payload needs an order ID, customer email, receipt template, and correlation ID from the checkout request.

Good event payloads are small and stable. They carry identifiers and facts, not huge blobs of data. The thumbnail function can download the original image from Cloud Storage using the object name. The receipt function can load the latest order summary from the database using the order ID.

The practical design rule is to put the **pointer** in the event and keep the large payload in the system that owns it. Object bytes stay in Cloud Storage. Order records stay in the database. The event carries enough information to find those records and to make retries safe.

## CloudEvent
<!-- section-summary: A CloudEvent is a standard envelope for event-driven function input. -->

A **CloudEvent** is a standard envelope for event data. Cloud Run functions use the Functions Framework to receive event-driven input as CloudEvents. The envelope includes fields such as `id`, `source`, `type`, `time`, and `data`.

The useful idea is envelope versus payload. The envelope tells the function where the event came from, what kind of event it is, and how to identify this delivery. The payload tells the function the business or resource details. This split helps libraries, routers, and your own code handle many event sources with one predictable outer shape.

The envelope and the business payload have different jobs:

| CloudEvent field | Thumbnail example | How the handler uses it |
|---|---|---|
| **`id`** | `1096437892045551` | Pairs with `source` for duplicate detection. |
| **`source`** | `//storage.googleapis.com/projects/_/buckets/profile-uploads` | Shows which system emitted the event. |
| **`type`** | `google.cloud.storage.object.v1.finalized` | Confirms the event kind. |
| **`time`** | Upload completion timestamp | Helps operators trace timing. |
| **`data`** | Object metadata | Gives the handler the bucket and object name. |

The CloudEvents specification says the producer should make `source` plus `id` unique for each distinct event. That pair gives the function a strong idempotency key.

For thumbnail generation, the handler can store a processed-event record using `source + id`. A retry with the same pair can return success without creating duplicate thumbnails. For receipt email, the handler may use the order ID plus event ID to make sure the customer does not receive the same receipt twice.

## Pub/Sub and Eventarc
<!-- section-summary: Pub/Sub carries application messages, while Eventarc routes events from Google Cloud sources to destinations such as Cloud Run functions. -->

**Pub/Sub** is Google Cloud's messaging service for asynchronous communication between independent applications. A publisher sends a message to a topic, and subscribers receive messages from that topic. The receipt function fits Pub/Sub because the checkout application decides that a purchase completed and publishes a business message.

**Eventarc** is Google Cloud's event routing service. It filters events from supported sources and routes them to destinations such as Cloud Run services and functions. The thumbnail function fits Eventarc because Cloud Storage emits the object-finalized event after the upload completes.

The two paths can live side by side:

| Workload | Routing path | Production note |
|---|---|---|
| Receipt email | Checkout API publishes to Pub/Sub, function receives the message | The application owns the business event and payload. |
| Thumbnail generation | Cloud Storage event flows through Eventarc to the function | The platform event starts the work after object creation. |
| Scheduled cleanup | Cloud Scheduler publishes to Pub/Sub or calls HTTP | The clock starts the work on a predictable interval. |

For AWS readers, Pub/Sub overlaps with SNS and SQS concepts, while Eventarc overlaps with EventBridge-style routing. Cloud Storage object events map to the familiar idea of S3 event notifications feeding Lambda or an event bus.

![Event sources routed through triggers to bounded handlers](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-functions-event-driven-workloads/event-to-handler-path.png)
*The event source and trigger decide the handler start condition; the handler stays focused on one bounded job.*

## Retry and Idempotency
<!-- section-summary: Retries help reliability, so handlers need idempotency before customer-visible side effects. -->

**Retry** means the platform may deliver the same event again after a failure or timeout. Pub/Sub and Eventarc delivery can repeat. That is helpful for reliability, but a repeated event can send two receipts or generate the same thumbnail record twice if the handler is careless.

**Idempotency** means repeated attempts leave the same final result as one attempt. The handler should claim a stable event key before it performs a customer-visible side effect. The key can use `source` plus `id` from the CloudEvent envelope.

For receipt email, the handler can insert an event claim into a database with a unique key. The attempt that creates the claim sends the email. A duplicate attempt sees the existing claim and returns success without another email. For thumbnails, the handler can record that the object generation has already been processed before writing derived files.

The flow is simple:

| Step | Handler action | Why |
|---|---|---|
| Receive | Get `source`, `id`, `type`, and payload | The handler needs event identity and business data. |
| Claim | Create a unique `source/id` record | One attempt wins the right to do the side effect. |
| Act | Send the email or create thumbnails | The side effect happens after the duplicate guard. |
| Record | Mark the claim complete and log the result | Operators can inspect what happened. |
| Duplicate | Return success for an existing claim | The platform stops retrying without repeating the side effect. |

![Retry-safe Cloud Run function flow](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-functions-event-driven-workloads/retry-safe-function-loop.png)
*A retry-safe handler claims the event before the side effect, so duplicate delivery exits cleanly.*

## Code Shape
<!-- section-summary: A good function validates input, claims the event, performs one side effect, logs the result, and returns after work finishes. -->

Here is a Node.js CloudEvent handler for the receipt path. Firestore is used as the claim store because transactional document creation gives the handler a simple duplicate guard. A SQL table with a primary key can work the same way.

The code shape should read like the operational story. First, reject events that do not belong to this function. Next, build an idempotency key from stable event fields. Then claim the key before doing the side effect. Finally, log the safe identifiers a responder needs. The actual email library and datastore can vary, but this order keeps the handler understandable.

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

Important parts:

- `cloudEvent("sendReceipt", ...)` registers the handler entry point.
- The Pub/Sub message body is decoded from base64 if present.
- `event.source` and `event.id` create the idempotency key.
- The claim happens before sending the email.
- Duplicate delivery logs and returns without throwing.
- The handler waits for email and status writes before returning.

Permanent validation failures should end differently from temporary provider failures. A malformed payload should log a terminal error and avoid a retry loop. A temporary email provider outage can throw so the platform can retry if retry policy allows it.

## Deploy and Verify
<!-- section-summary: Deployment chooses the handler entry point, runtime, service account, timeout, scaling limit, and trigger route. -->

Cloud Run function deployment from source names the function service, source directory, handler entry point, runtime base image, region, service account, timeout, and scaling limits:

```bash
gcloud run deploy send-receipt \
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

Important parts:

- `--source=.` tells Cloud Run to build from source.
- `--function=sendReceipt` selects the handler entry point.
- `--base-image=nodejs24` chooses the runtime base image.
- `--service-account` attaches the runtime identity.
- `--timeout` bounds one invocation.
- `--max-instances` protects downstream systems during spikes.

Expected output should name the Cloud Run-backed service and revision:

```console
Service [send-receipt] revision [send-receipt-00007-yem] has been deployed.
Service URL: https://send-receipt-7a2b3c-uc.a.run.app
```

The event route can connect a Pub/Sub topic through Eventarc:

```bash
gcloud eventarc triggers create receipt-pubsub-trigger \
  --project=PROJECT_ID \
  --location=us-central1 \
  --destination-run-service=send-receipt \
  --destination-run-region=us-central1 \
  --event-filters="type=google.cloud.pubsub.topic.v1.messagePublished" \
  --transport-topic=projects/PROJECT_ID/topics/purchase-events \
  --service-account=receipt-trigger@PROJECT_ID.iam.gserviceaccount.com
```

Important parts:

- `--event-filters` chooses the Pub/Sub message-published event type.
- `--transport-topic` names the topic carrying purchase events.
- `--destination-run-service` points at the Cloud Run service created by the function deploy.
- The trigger service account needs the permissions required by Eventarc for routing.

Expected output should show the trigger and destination:

```console
Created trigger [receipt-pubsub-trigger] in location [us-central1].
Destination: Cloud Run service [send-receipt]
Transport topic: projects/PROJECT_ID/topics/purchase-events
```

The first verification path should publish one test event, describe the trigger, and check logs for exactly one handled invocation. The publish command sends the same kind of business event the checkout API would send after a purchase commits.

```bash
gcloud eventarc triggers describe receipt-pubsub-trigger \
  --project=PROJECT_ID \
  --location=us-central1 \
  --format="yaml(name,eventFilters,serviceAccount,destination.cloudRun,transport.pubsub.topic)"

gcloud pubsub topics publish purchase-events \
  --project=PROJECT_ID \
  --message='{"orderId":"ord-test-1042","customerEmail":"alex@example.com","correlationId":"checkout-test-1042"}'

gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="send-receipt"
   jsonPayload.orderId="ord-test-1042"' \
  --project=PROJECT_ID \
  --limit=5 \
  --format="value(timestamp,jsonPayload.severity,jsonPayload.message,jsonPayload.eventKey,jsonPayload.status,jsonPayload.correlationId)"
```

Important parts:

- `triggers describe` proves the trigger points to the expected function service, region, topic, and routing service account.
- `topics publish` sends a realistic payload through the event path instead of calling the handler by hand.
- The log query filters on the test order ID so the reviewer can see the invocation tied to that event.

Good trigger output should name the Pub/Sub event type and Cloud Run destination:

```yaml
name: projects/PROJECT_ID/locations/us-central1/triggers/receipt-pubsub-trigger
eventFilters:
  - attribute: type
    value: google.cloud.pubsub.topic.v1.messagePublished
serviceAccount: receipt-trigger@PROJECT_ID.iam.gserviceaccount.com
destination:
  cloudRun:
    service: send-receipt
    region: us-central1
transport:
  pubsub:
    topic: projects/PROJECT_ID/topics/purchase-events
```

Good log output should show one accepted side effect:

```console
2026-07-04T10:24:41Z INFO receipt email sent //pubsub.googleapis.com/projects/PROJECT_ID/topics/purchase-events/1096437892045551 sent checkout-test-1042
```

The interpretation is specific. The trigger route exists, the test message reached the function through Pub/Sub and Eventarc, and the handler logged one completed receipt for `ord-test-1042`. If a second log line for the same `eventKey` says `duplicate skipped`, the idempotency guard is working during duplicate delivery tests.

Verification should check that the trigger exists, the function logs one test event, duplicates do not repeat the side effect, and the runtime service account has only the required roles.

## Identity, Secrets, and Operations
<!-- section-summary: Functions still need narrow identity, secret access, retry policy, logs, metrics, and failure review. -->

Cloud Run functions still run as software identities. The receipt function should use a runtime service account that can read only the email-provider secret, write the event-claim record, and load the order summary it needs. Deployment automation should use a separate identity for broader deploy permissions.

Secrets should come from Secret Manager. The email-provider token should never live in source code, logs, or the container image built from the function source. Environment variables can hold non-sensitive configuration such as sender address, template name, or feature flag values.

Operations evidence should prove the runtime path as well as the source code. A small review can check the Cloud Run service behind the function, the secret policy, and the failed-event path:

```bash
gcloud run services describe send-receipt \
  --project=PROJECT_ID \
  --region=us-central1 \
  --format="yaml(spec.template.spec.serviceAccountName,spec.template.spec.containers[0].env,status.latestReadyRevisionName)"

gcloud secrets get-iam-policy email-provider-token \
  --project=PROJECT_ID \
  --format="yaml(bindings)"

gcloud pubsub topics describe receipt-failures \
  --project=PROJECT_ID \
  --format="yaml(name,labels)"
```

Good evidence should show the runtime service account on the deployed service, the same service account on the secret accessor binding, and a topic or operations queue for terminal failures:

```yaml
spec:
  template:
    spec:
      serviceAccountName: receipt-function-runtime@PROJECT_ID.iam.gserviceaccount.com
      containers:
        - env:
            - name: RECEIPT_FROM
              value: receipts@example.com
status:
  latestReadyRevisionName: send-receipt-00007-yem
---
bindings:
  - role: roles/secretmanager.secretAccessor
    members:
      - serviceAccount:receipt-function-runtime@PROJECT_ID.iam.gserviceaccount.com
---
name: projects/PROJECT_ID/topics/receipt-failures
labels:
  owner: commerce-ops
```

The interpretation is the same pattern as a web service. The deployed function runs as `receipt-function-runtime`, and that identity can access the email-provider token. Non-sensitive configuration such as `RECEIPT_FROM` appears in environment variables. The failed-event topic gives operators a place to review payloads that the handler rejects permanently, such as a message missing `orderId`.

Retry evidence should separate temporary failure from terminal failure. A temporary provider outage can throw so Eventarc can retry the event. A malformed payload should log a terminal failure, publish a small review message to `receipt-failures`, and stop the retry loop.

```console
2026-07-04T10:31:02Z ERROR receipt send failed eventKey=... orderId=ord-8831 retryable=true errorCode=EMAIL_PROVIDER_TIMEOUT
2026-07-04T10:32:18Z WARN receipt payload rejected eventKey=... orderId=- retryable=false failedTopic=receipt-failures reason=MISSING_ORDER_ID
```

The first line tells operators that retry is useful because the provider failed temporarily. The second line tells them the event itself is invalid, so the handler recorded a failed-event path for human review and avoided a retry loop.

Operational checks should include:

| Area | What to check |
|---|---|
| **Trigger health** | Eventarc trigger exists in the expected region and points to the function service. |
| **Retry behavior** | Temporary failures retry, while permanent validation failures reach a terminal state. |
| **Idempotency** | Duplicate `source/id` delivery does not repeat email or thumbnail output. |
| **Logs** | Logs include event key, business ID, correlation ID, and sanitized error reason. |
| **Metrics** | Invocation count, error count, latency, retry count, and max-instance saturation are visible. |
| **Dead-letter path** | Repeated failures have a review path such as a dead-letter topic or an operations queue. |

![Cloud Run functions operations checklist](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-functions-event-driven-workloads/function-operations-checklist.png)
*A production function review checks trigger route, retry safety, identity, logs, metrics, and failure handling.*

## Putting It All Together
<!-- section-summary: Cloud Run functions fit small event jobs with focused handlers and retry-safe triggers. -->

Cloud Run functions fit work that should run after an event. The function is the small deployable unit. The handler is the entry point. The trigger starts the handler. The event records what happened. The CloudEvent envelope gives the handler standard metadata. Pub/Sub and Eventarc route messages and platform events. Retry improves reliability, and idempotency protects the side effect.

Thumbnail generation and receipt email both fit this shape because the main request can finish first and the follow-up work can run separately. The production design still needs a narrow service account, secrets, logs, metrics, retry policy, and a way to inspect failed events.

The next article covers GKE, where the question changes from one bounded handler to many services that may need Kubernetes as a shared platform API.

## References

- [Deploy Cloud Run functions](https://docs.cloud.google.com/run/docs/deploy-functions) - Official deployment guide for Cloud Run functions and current deploy flags.
- [Write Cloud Run functions](https://docs.cloud.google.com/run/docs/write-functions) - Official guide for HTTP and event-driven Cloud Run functions and the Functions Framework.
- [Compare Cloud Run functions](https://docs.cloud.google.com/run/docs/functions/comparison) - Official comparison of Cloud Run functions behavior and configuration.
- [Eventarc overview](https://docs.cloud.google.com/eventarc/docs/overview) - Official overview of Eventarc event routing.
- [Pub/Sub overview](https://docs.cloud.google.com/pubsub/docs/overview) - Official overview of asynchronous Pub/Sub messaging.
- [Publish messages to topics](https://docs.cloud.google.com/pubsub/docs/publisher) - Official Pub/Sub publisher documentation, including delivery behavior.
- [Retry events in Eventarc](https://docs.cloud.google.com/eventarc/docs/retry-events) - Official Eventarc retry behavior guide.
