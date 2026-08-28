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

1. [Why Does Event Work Leave the Main Request?](#why-does-event-work-leave-the-main-request)
2. [What Are a Function and Its Handler?](#what-are-a-function-and-its-handler)
3. [How Do Events, Triggers, and CloudEvents Connect?](#how-do-events-triggers-and-cloudevents-connect)
4. [What Roles Do Pub/Sub and Eventarc Play?](#what-roles-do-pubsub-and-eventarc-play)
5. [Why Do Retries Require Idempotency?](#why-do-retries-require-idempotency)
6. [How Should Function Code and Runtime State Be Shaped?](#how-should-function-code-and-runtime-state-be-shaped)
7. [How Do You Deploy, Verify, Secure, and Operate a Function?](#how-do-you-deploy-verify-secure-and-operate-a-function)
8. [What Happens During a Complete Event-Driven Flow?](#what-happens-during-a-complete-event-driven-flow)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Cloud Run functions starts with a common application requirement: something happened, so a piece of code should run. A file upload should produce a thumbnail. A new order should cause a confirmation email. A Pub/Sub message should be processed. A database change should update another system. An HTTP webhook should be validated and handled.

It is possible to keep a server running forever for each reaction. That server would need a VM, operating system, runtime, process manager, route, and application wrapper around one small handler. Cloud Run functions lets the team provide mainly the code that reacts while Google manages much of the invocation and scaling machinery.

To see why this model matters, follow a checkout request. The browser sends `POST /checkout`, and the application may validate the basket, charge payment, create the order, send an email, generate an invoice PDF, update analytics, notify the warehouse, and update a CRM. If all of those operations run before the response, a slow CRM makes the customer wait. An unavailable email service raises the question of whether buying should fail. An analytics outage can block a purchase even though analytics is not required to create it.

Keep these questions in view as you work through the lesson:

1. **Why Does Event Work Leave the Main Request?**
2. **What Are a Function and Its Handler?**
3. **How Do Events, Triggers, and CloudEvents Connect?**
4. **What Roles Do Pub/Sub and Eventarc Play?**
5. **Why Do Retries Require Idempotency?**
6. **How Should Function Code and Runtime State Be Shaped?**
7. **How Do You Deploy, Verify, Secure, and Operate a Function?**
8. **What Happens During a Complete Event-Driven Flow?**

## Why Does Event Work Leave the Main Request?
<!-- section-summary: Event-driven work separates actions required for an immediate answer from reactions that can happen after the result exists. -->

The request has mixed two categories of work. The immediate answer usually depends on validating the order, charging the customer, and recording the order. Sending email, updating analytics, notifying the warehouse, and updating the CRM are consequences of the successful result and can often happen later.

```text
checkout request
      |
critical synchronous work
      |
record OrderCreated
      |
respond to customer

OrderCreated
   |-- send email
   |-- update analytics
   `-- notify warehouse
```

This separation creates **temporal decoupling**. The checkout system does not require every consumer to be available at exactly the moment the order is recorded. Consumers can react independently after the fact.

Background work is not automatically better. If the caller needs a computation's answer before it can proceed, synchronous request and response is usually simpler. The useful distinction is whether the result is needed now. Required immediate results stay on the request path; reactions that can occur later are candidates for events and asynchronous handlers.

## What Are a Function and Its Handler?
<!-- section-summary: A function is a focused request or event reaction, and the handler is the named entry point the Functions Framework invokes. -->

Suppose the entire post-order reaction is a function named `send_confirmation(order)`. Traditionally, the team might wrap it in Linux, Python, a web server, routing code, and a permanently running process. The business concern is much smaller: input reaches code and produces a side effect or result.

That focused unit is a **function**:

```text
request or event -> code -> result or side effect
```

A serverless functions platform provides the receiving runtime, routing, and scaling around the code. The team normally does not administer the operating system or process supervisor.

Modern Cloud Run functions is not an unrelated magical runtime. Deploying function source leads through Cloud Build, buildpacks, the Functions Framework, a container image in Artifact Registry, and a Cloud Run service. The resulting service is built from the function source and hosted on Cloud Run.

```text
source code
    |
Cloud Build and buildpacks
    |
Functions Framework in a container image
    |
Artifact Registry
    |
Cloud Run service
```

This places the product on the wider abstraction ladder. Compute Engine says, “Give me a computer.” A Cloud Run service says, “Run this application or container.” A Cloud Run function says, “Invoke this handler when work arrives.” Each step upward exposes a smaller application unit and hides more infrastructure decisions.

A source project can contain many functions and helpers. The platform therefore needs one named entry point. The **handler**, also called the function entry point, is the piece that receives the invocation.

```python
def order_created(event):
    ...
```

The Functions Framework sits between the Cloud Run environment and the handler. It exposes the expected server interface and calls the selected entry point, so function authors generally do not write a socket accept loop, process manager, or container startup protocol.

Cloud Run functions supports two main handler shapes. An **HTTP function** receives an explicit HTTP request and returns an HTTP response. It suits webhooks, small APIs, callbacks, and direct invocations.

```python
@functions_framework.http
def calculate_tax(request):
    ...
    return result
```

A **CloudEvent function** runs because something happened in an event-producing system.

```python
@functions_framework.cloud_event
def image_uploaded(cloud_event):
    ...
```

Pub/Sub message publication, Cloud Storage object creation, Firestore changes, and other Google Cloud events can use this shape. The two signatures answer different causes of execution: someone made a request, or a system reported a fact.

## How Do Events, Triggers, and CloudEvents Connect?
<!-- section-summary: The event describes a fact, the trigger chooses a destination, and CloudEvents gives delivery a standard outer envelope. -->

A function named `resize_image(event)` contains the reaction, but its code does not inherently mean “run when the `photos` bucket receives an object.” A separate object must connect the condition to the destination. That object is a **trigger**.

```text
trigger
  source: Cloud Storage
  event type: object finalized
  bucket: photos
  destination: resize-image
```

The distinction is foundational: the function describes what should happen; the trigger describes when and where it should be invoked. Cloud Run functions supports direct HTTP invocation and event-driven triggers, with Eventarc routing event-driven functions.

Keeping the objects separate also makes change safer. The handler can be redeployed as a new revision while the trigger continues to describe the source and filters, or routing can change without rewriting the business reaction. Operations can then inspect runnable code and event wiring as two related but independent layers.

An **event** is a fact stated after it happened: object X was created, order 983 was submitted, message Y was published, or document Z was updated. A command asks a component to do something; an event reports that something already occurred.

That wording affects coupling. A command usually names an intended action and often a responsible receiver: “resize this image.” An event says only that an image was uploaded. Consumers choose their own reactions. A thumbnail generator can resize it, a scanner can inspect it, and a metadata service can index it without the uploader issuing three separate instructions.

Events also avoid promising that every reaction completes before the producer continues. The producer records or publishes the fact; delivery and consumers progress according to their own availability. That independence is the temporal decoupling introduced by the checkout example, and it is also why delivery status, retries, and durable outcomes need explicit observation.

That fact can have several consumers. One `ImageUploaded` event can reach a thumbnail generator, virus scanner, and metadata extractor. The uploader does not need to know each downstream implementation. Producers and consumers are decoupled around the event.

Every producer can have different event-specific fields. Storage cares about buckets and object names, Pub/Sub has message data, and a database reports document changes. Yet every event system still needs to communicate an identifier, event type, source, time, and payload. **CloudEvents** standardizes that outer envelope.

```json
{
  "specversion": "1.0",
  "id": "evt-123",
  "source": "...",
  "type": "...",
  "time": "...",
  "data": {
    "...": "..."
  }
}
```

The CloudEvent is not the real-world event itself. It is a standardized description of the event. Its outer attributes are consistent while `data` carries source-specific information. The Functions Framework turns this representation into the CloudEvent programming model used by the handler.

Event delivery still uses networking. A bucket does not directly call a Python function by magic. For an Eventarc-triggered function, an event producer surfaces the event, Eventarc routes it, and an HTTP request carrying CloudEvent data reaches the underlying Cloud Run service. The Functions Framework parses the request and calls the handler.

```text
event producer
      |
Eventarc routing
      |
HTTP delivery with CloudEvent
      |
Cloud Run service
      |
Functions Framework
      |
handler
```

The platform hides much of this plumbing, but the packet path remains important when diagnosing a trigger that exists while a handler never runs.

## What Roles Do Pub/Sub and Eventarc Play?
<!-- section-summary: Pub/Sub buffers and distributes messages, while Eventarc filters events and routes matching ones to destinations. -->

Suppose a producer creates work faster than one consumer can process it. A direct connection overloads the consumer. A durable mailbox between them lets the producer publish now and the consumer process at its sustainable rate.

**Pub/Sub** provides that messaging role. A publisher sends messages to a topic, and subscribers receive messages associated with the topic. This supplies decoupling, buffering, fan-out, delivery, and redelivery.

```text
publisher -> Pub/Sub topic
                  |-- subscriber A
                  |-- subscriber B
                  `-- subscriber C
```

**Eventarc** answers a different question. It expresses that events from a selected producer, matching chosen attributes, should go to a destination. A trigger might filter Cloud Storage object-finalized events to one bucket and deliver them to a resize function. Eventarc supports sources including Pub/Sub, Cloud Storage, Firestore, and many events surfaced through Cloud Audit Logs.

A useful approximation is:

```text
Pub/Sub -> durable message transport and broker
Eventarc -> event integration, filtering, and routing
```

The services can work together. A message published to a Pub/Sub topic is itself an event. An Eventarc trigger can route that event to a Cloud Run function. Google documents Pub/Sub triggers for functions as Eventarc triggers, and Eventarc Standard uses Pub/Sub as part of its transport machinery.

![Event sources reach focused handlers through matching Eventarc triggers](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-functions-event-driven-workloads/event-to-handler-path.png)

*The source produces work, the trigger selects its destination, and the handler stays focused on one reaction.*

Choosing between them is therefore not a contest. Use the mental models to locate responsibility. Pub/Sub gives producers and consumers a durable messaging boundary. Eventarc connects events from supported sources to destinations according to filters. A Pub/Sub event may pass through both layers before the handler runs.

## Why Do Retries Require Idempotency?
<!-- section-summary: At-least-once delivery can repeat an event after uncertainty, so handlers must make duplicate execution safe and isolate persistent failures. -->

Imagine an `OrderCreated` handler calls an email provider and the provider times out. The delivery system can discard the event or try again. Retrying is useful for transient failures, but it creates the central duplicate problem.

Suppose the function sends the email successfully and then loses the network connection before it can acknowledge success. The infrastructure cannot prove whether processing completed. Delivering again is safer for reliability, but the second invocation can send a second email. A repeated payment could be much worse.

Distributed systems therefore commonly use **at-least-once delivery**, where a message is delivered one or more times. Eventarc Standard can redeliver events, so duplicate delivery is possible when retries apply. The practical goal is not to assume that infrastructure will execute application logic precisely once. It is to make repeating the work safe.

An operation is **idempotent** when applying it repeatedly does not move the final state beyond one successful application. Marking an order shipped twice still leaves it shipped once. Charging the same payment twice does not have that property.

A common design uses the event identifier. Within a transaction, the handler checks whether event `abc123` has already been processed. If so, it exits safely. If not, it performs the mutation and records the identifier before committing.

```text
begin transaction
    |
has event source + id already succeeded?
    | yes -> stop safely
    | no
    v
perform mutation
    |
record event as processed
    |
commit
```

Eventarc recommends idempotent handlers and identifies duplicate CloudEvents by the combination of `source` and `id`. When an external API supports idempotency keys, the same event identifier can be passed to that provider.

The check and the mutation must be coordinated carefully. If code first checks a `processed_events` table, performs a database update, and crashes before recording success, a retry can perform the update again. When both operations affect the same transactional database, wrapping the mutation and processed-event record in one transaction removes that gap. They either commit together or neither becomes durable.

External side effects need the destination's own guarantees. Sending an event ID as a payment provider's or email provider's idempotency key lets that system recognize the repeated call. When a destination offers no such facility, the application needs another durable record or a business operation whose repeated result is naturally safe. Idempotency is therefore an application design property, not a checkbox that the trigger can add after deployment.

![A retry-safe handler checks an idempotency key before producing one side effect](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-functions-event-driven-workloads/retry-safe-function-loop.png)

*At-least-once delivery may repeat the invocation; the application prevents a repeated business effect.*

Retry behavior is a trigger property rather than a universal function guarantee. Eventarc can use retry and backoff, while a Cloud Run destination can also have one delivery attempt. Current creation paths can have different defaults. Production design therefore asks what this trigger's delivery policy is and records its backoff, maximum attempts, dead-letter handling, idempotency, and alerting.

Retries only help temporary failures. A permanently invalid event can fail forever. A **dead-letter destination** gives persistently failing work somewhere to go after repeated attempts so operators can alert, inspect, repair, or deliberately discard it. The durable rule is simple: transient failures deserve a retry policy; permanent failures need an explicit destination and human or automated recovery path.

## How Should Function Code and Runtime State Be Shaped?
<!-- section-summary: A small infrastructure-facing handler delegates to ordinary business logic, assumes instances are replaceable, and keeps expensive startup work under control. -->

A handler should act as an adapter between cloud delivery and business logic. It parses and validates the CloudEvent, extracts the domain inputs, and calls ordinary application code.

```python
@functions_framework.cloud_event
def on_order_created(event):
    order_id = extract_order_id(event)
    process_order(order_id, event["id"])

def process_order(order_id, event_id):
    ...
```

This design lets tests call `process_order("123", "event-456")` without manufacturing the entire Eventarc delivery path. Infrastructure-specific parsing stays at the edge while billing, SQL, templates, and downstream API calls remain in application modules. “Function” describes a focused invocation boundary; the supporting code can still be substantial.

Cloud Run may reuse an instance across invocations, but it can also create several instances, remove idle ones, or restart them. Correctness cannot depend on RAM from a previous invocation, a file written only to ephemeral local storage, the next event reaching the same process, or there being exactly one instance. Important shared state belongs in a database, Cloud Storage, Pub/Sub, or another durable system.

This is the serverless meaning of **statelessness**: any invocation can run on a different instance. It does not mean the function cannot read or write durable data.

Scaling follows incoming work. Zero events can mean no active instances. A burst of 500 events per second can cause the platform to create more instances, and capacity can shrink when the backlog clears. That removes manual server provisioning from the normal path.

Fresh capacity still needs time to start. A **cold start** creates a runtime or container, loads libraries, initializes the application, and then invokes the handler. Large dependency sets and expensive global initialization increase that delay. Startup logic should perform only the work required before a handler can safely begin.

Function source eventually becomes infrastructure. A project containing `main.py` and `requirements.txt` is uploaded, built with Cloud Build and buildpacks, combined with the Functions Framework into a container image, stored in Artifact Registry, and deployed as a Cloud Run revision. Functions still execute in containers; the platform generates and operates much of that container machinery.

Each deployment creates an immutable runnable revision. Named versions are a stronger operational model than editing `app.py` on a production server and restarting it. Logs, identity, and trigger verification can be tied to the deployed version.

## How Do You Deploy, Verify, Secure, and Operate a Function?
<!-- section-summary: Verification follows the invocation path, identity separates delivery from downstream access, and operations watch producers, retries, handlers, and dependencies. -->

An HTTP function is verified with an HTTP client. Invoke its service endpoint, then inspect the response status, body, latency, and logs. Cloud Run functions built on the current model have an HTTP service endpoint underneath even when an event trigger is the normal caller.

An event-driven function requires a different proof. Deployment success only shows that runnable code exists. The complete test produces an event, confirms that the trigger matches, confirms delivery to the handler, inspects the logs, and checks the intended side effect.

```text
producer -> event -> trigger -> delivery -> handler -> side effect
```

For a Pub/Sub path, publish a test message, verify that Eventarc has an active matching trigger, confirm that the function receives the event, and check the database or other destination. Trigger creation can take time to become active, so service deployment and trigger readiness are separate states.

A useful test records one correlation value from beginning to end. Put a known identifier in the test message or object name, find that same value in the CloudEvent attributes or data, locate it in handler logs, and then confirm it in the resulting database row or output object. This distinguishes a real end-to-end success from an unrelated healthy invocation that happened at the same time.

The negative paths deserve proof as well. Send the same event identity twice and confirm that the side effect occurs once. Force a temporary dependency failure and verify the configured retry behavior. Use a permanently invalid payload and confirm that attempts stop according to policy and the event reaches its dead-letter destination or alert path. These checks turn retry and idempotency from design claims into observable behavior.

Security has at least two identity directions. First, an event-delivery identity must be allowed to invoke the underlying service. Second, the function's runtime service account must be authorized for the storage, database, Pub/Sub topic, or API it calls after startup. A permission error can therefore occur before the handler starts or inside the handler during downstream access.

The runtime service account supplies short-lived workload credentials to application libraries, and IAM applies least privilege. A thumbnail function can read an input bucket and write an output location without permission to delete the project. Long-lived Google Cloud keys do not need to appear in source.

Third-party systems may still require secret values such as a Stripe key, database password, or vendor token. Those belong in Secret Manager rather than source code, Git, a Dockerfile, or ordinary plain configuration. Authorized Cloud Run instances can receive secrets as mounted files or environment values while Secret Manager owns their lifecycle.

Serverless does not remove operations; it changes the layer being operated. The team still needs to know whether events arrive, how many invocations fail, how long processing takes, whether a backlog grows, whether retries are rising, whether duplicate handling is safe, whether a new revision introduced failures, and whether dependencies are healthy.

Cloud Logging and Cloud Monitoring provide request, application or container, and platform evidence. A complete operational view follows the chain from producer health to delivery health, handler health, and dependency health rather than monitoring only the function box.

That chain helps interpret “the function did not run.” The producer may never have emitted the event. The trigger filter may not match its type or source. Delivery authentication may be denied. The handler may start and reject malformed data. The business logic may succeed while the final dependency fails. Each state needs a different signal and owner, so a dashboard that displays only invocation count leaves large blind spots.

![A production function needs trigger, revision, retry, dead-letter, log, and service-account evidence](/content-assets/articles/article-cloud-providers-gcp-compute-application-hosting-cloud-run-functions-event-driven-workloads/function-operations-checklist.png)

*Operations cover the whole event route, including work that never reached the handler and work that failed after it started.*

When an operator sees failures, the repair depends on the layer. A missing trigger calls for routing repair. Invocation denial calls for the delivery identity. Downstream denial calls for runtime IAM. A persistent invalid event calls for dead-letter handling. A transient provider error calls for retry and idempotency evidence.

## What Happens During a Complete Event-Driven Flow?
<!-- section-summary: A photo upload becomes a routed CloudEvent, a retry-safe handler uses workload identity, and durable output proves successful processing. -->

Consider a photo-processing system. A user uploads `photo.jpg` to Cloud Storage, and the application must create a thumbnail without making the upload request wait for image processing.

First, the successful object creation is the fact: `photo.jpg` now exists. Cloud Storage emits event information that identifies the bucket and object. Eventarc has a trigger whose condition selects object-finalized events from the `photos` bucket and whose destination is the `generate-thumbnail` function.

Eventarc packages and delivers a CloudEvent. Its outer fields identify the event ID, source, type, and time, while its data contains the bucket and object names. The Functions Framework receives the underlying HTTP delivery and calls the declared CloudEvent handler.

```python
@functions_framework.cloud_event
def generate_thumbnail(event):
    ...
```

Before producing `thumbnails/photo.jpg`, the application checks its idempotency record or output rule. That protects the business effect if the event is delivered again. The function's service account passes through IAM authorization to read the original and write the thumbnail, so no static Google Cloud key is embedded in source.

If processing succeeds, the handler returns successfully and the delivery is considered handled. If a temporary Storage call fails and the trigger's policy retries, the same event can arrive again. Idempotent logic prevents the retry from becoming a duplicate-output incident. A permanently invalid event eventually follows the configured dead-letter and alert path rather than retrying forever.

```text
user uploads photo
       |
Cloud Storage records object-finalized event
       |
Eventarc trigger filters and routes it
       |
CloudEvent describes what happened
       |
Cloud Run service receives HTTP delivery
       |
Functions Framework calls handler
       |
handler checks idempotency
       |
runtime identity reads original and writes thumbnail
       |
logs and durable output prove success
```

The same system can use Pub/Sub when durable message buffering belongs between a producer and consumers. IAM controls who may deliver and what the function may access. Secret Manager supplies sensitive external credentials. Retry policy addresses temporary failure. Idempotency addresses duplicates. Dead-letter handling isolates persistent failure. Logging and monitoring reveal whether events are flowing successfully.

An operator should be able to name the durable evidence at each boundary: the source object or business record, the published message where messaging is used, the trigger configuration and readiness, the CloudEvent identifier, the handler log, the processed-event record, and the thumbnail object. That chain makes it possible to locate one missing reaction without guessing whether the problem began at production, routing, invocation, application logic, or output storage.

The compact vocabulary is now connected:

| Concept | Plain meaning |
|---|---|
| **Cloud Run function** | Run a named handler without operating its server. |
| **Handler** | Receive and adapt incoming work to application logic. |
| **HTTP function** | Run because a caller made a request. |
| **CloudEvent function** | Run because a system reported an event. |
| **Event** | A fact describing something that happened. |
| **CloudEvent** | A standard outer description of that fact. |
| **Trigger** | A rule connecting matching events to a destination. |
| **Pub/Sub** | Durable messaging between producers and consumers. |
| **Eventarc** | Event-source integration, filtering, and routing. |
| **Retry** | Attempt delivery again after a failure. |
| **Idempotency** | Make repeated execution safe. |
| **Entry point** | Tell the Functions Framework which handler to call. |
| **Service account** | Give the workload a Google Cloud identity. |
| **Secret Manager** | Keep sensitive external credentials out of source. |
| **Revision** | Name one immutable deployed version. |
| **Observability** | Prove that events arrive and complete successfully. |

The deepest event model is: a producer creates a fact, an event describes it, a trigger decides which destination cares, a CloudEvent transports the description consistently, a function contains the reaction, retry addresses temporary uncertainty, and idempotency makes repetition safe.

## Check Your Answers

:::expand[Why Does Event Work Leave the Main Request?]{kind="recap"}
Immediate work stays synchronous when the caller needs its result. Reactions such as email, analytics, or warehouse notification can often follow an event, which decouples their availability from the request.
:::

:::expand[What Are a Function and Its Handler?]{kind="recap"}
A function is focused code invoked for a request or event. Its handler is the named entry point called by the Functions Framework inside a generated Cloud Run container and service.
:::

:::expand[How Do Events, Triggers, and CloudEvents Connect?]{kind="recap"}
An event states a fact, a trigger maps matching facts to a destination, and CloudEvents supplies a standard envelope that the framework presents to the handler.
:::

:::expand[What Roles Do Pub/Sub and Eventarc Play?]{kind="recap"}
Pub/Sub provides durable message transport, buffering, and fan-out. Eventarc integrates event sources, filters events, and routes matches to destinations; the two can be used together.
:::

:::expand[Why Do Retries Require Idempotency?]{kind="recap"}
At-least-once delivery can repeat work after an uncertain result. Idempotency prevents a repeated invocation from repeating the business effect, while dead-letter handling isolates permanent failures.
:::

:::expand[How Should Function Code and Runtime State Be Shaped?]{kind="recap"}
Keep the handler as an infrastructure adapter around testable business logic. Store important state externally, assume instances are replaceable, and minimize unnecessary cold-start initialization.
:::

:::expand[How Do You Deploy, Verify, Secure, and Operate a Function?]{kind="recap"}
Verify the full route, not only deployment. Separate delivery identity from runtime identity, keep secrets external, and observe producers, retries, handlers, revisions, and dependencies.
:::

:::expand[What Happens During a Complete Event-Driven Flow?]{kind="recap"}
A producer emits a fact, Eventarc routes its CloudEvent, the framework invokes a retry-safe handler, workload identity authorizes dependencies, and durable output plus logs proves success.
:::

## References

- [Cloud Run functions overview](https://docs.cloud.google.com/run/docs/functions/overview?authuser=1) - Official source-build, container, and service model.
- [Write Cloud Run functions](https://docs.cloud.google.com/run/docs/write-functions?authuser=2) - Official Functions Framework, entry point, HTTP, and CloudEvent signatures.
- [Cloud Run function triggers](https://docs.cloud.google.com/run/docs/function-triggers) - Official HTTP and Eventarc trigger behavior.
- [Trigger functions from Pub/Sub with Eventarc](https://docs.cloud.google.com/run/docs/tutorials/pubsub-eventdriven?authuser=2) - Official underlying HTTP and CloudEvent delivery path.
- [Create Pub/Sub triggers](https://docs.cloud.google.com/run/docs/triggering/pubsub-triggers?hl=en) - Official Pub/Sub-to-Eventarc trigger guidance.
- [Eventarc retry events](https://docs.cloud.google.com/eventarc/docs/retry-events?authuser=0000) - Official delivery, duplicates, idempotency, retry defaults, and dead-letter guidance.
- [Cloud Run functions best practices](https://docs.cloud.google.com/run/docs/tips/functions-best-practices?authuser=19) - Official statelessness and cold-start guidance.
- [Deploy Cloud Run services](https://docs.cloud.google.com/run/docs/deploying) - Official immutable revision deployment behavior.
- [Configure service identity](https://docs.cloud.google.com/run/docs/configuring/services/service-identity) - Official runtime service-account model.
- [Configure environment variables and secrets](https://docs.cloud.google.com/run/docs/configuring/services/environment-variables) - Official recommendation to use Secret Manager for sensitive values.
- [Cloud Run logging](https://docs.cloud.google.com/run/docs/logging) - Official request, application, and system log behavior.
