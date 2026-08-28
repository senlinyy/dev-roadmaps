---
title: "Amazon SQS"
description: "Learn how SQS separates requesting work from performing it through durable messages, visibility timeouts, retries, dead-letter queues, and scalable consumers."
overview: "Build a first-principles model of queue buffering, message contracts, delivery lifecycle, idempotency, Standard and FIFO queues, Lambda or container consumers, monitoring, and security."
tags: ["aws", "sqs", "queues", "asynchronous", "application-integration"]
order: 3
id: article-cloud-providers-aws-application-integration-messaging
aliases:
  - messaging
  - 2-messaging
  - sqs
  - 3-sqs
  - amazon-sqs
  - cloud-providers/aws/application-integration/sqs.md
  - cloud-providers/aws/application-integration/2-messaging.md
  - cloud-providers/aws/application-integration/3-sqs.md
---

## Table of Contents

1. [Why Should Some Work Wait in a Queue?](#why-should-some-work-wait-in-a-queue)
2. [What Do Producers, Queues, and Consumers Do?](#what-do-producers-queues-and-consumers-do)
3. [How Does the SQS Message Lifecycle Work?](#how-does-the-sqs-message-lifecycle-work)
4. [How Do Retries, Dead-Letter Queues, and Idempotency Work Together?](#how-do-retries-dead-letter-queues-and-idempotency-work-together)
5. [When Should You Use Standard or FIFO Queues?](#when-should-you-use-standard-or-fifo-queues)
6. [How Do Lambda and Container Consumers Process SQS Messages?](#how-do-lambda-and-container-consumers-process-sqs-messages)
7. [How Do You Secure an SQS Queue?](#how-do-you-secure-an-sqs-queue)
8. [How Does a Complete Queue-Based System Behave?](#how-does-a-complete-queue-based-system-behave)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Amazon Simple Queue Service is easiest to understand as a durable place for **work that must not be forgotten but does not have to finish during the caller's current request**. A queue separates the moment an application requests work from the later moment a consumer performs it.

Imagine a user uploads a video. The system stores it, creates thumbnails, transcodes several formats, scans content, sends a notification, and updates analytics. If the upload API performs every task before responding, then the user's request succeeds only if every future dependency is healthy and fast right now.

```text
Request -> Upload API
             ├── thumbnail service
             ├── transcoding service
             ├── scanning service
             ├── notification service
             └── analytics service
          -> Response
```

A slow transcode delays the response. A notification outage can fail an otherwise valid upload. A sudden wave of uploads reaches every downstream service at once.

Keep these questions in view as you work through the lesson:

1. **Why Should Some Work Wait in a Queue?**
2. **What Do Producers, Queues, and Consumers Do?**
3. **How Does the SQS Message Lifecycle Work?**
4. **How Do Retries, Dead-Letter Queues, and Idempotency Work Together?**
5. **When Should You Use Standard or FIFO Queues?**
6. **How Do Lambda and Container Consumers Process SQS Messages?**
7. **How Do You Secure an SQS Queue?**
8. **How Does a Complete Queue-Based System Behave?**

## Why Should Some Work Wait in a Queue?
<!-- section-summary: SQS removes deferred work from the synchronous request path and buffers temporary differences between production and consumption rates. -->

Start with one question: **Does the caller need the completed result before continuing?**

Password checking, calculating the final shipping cost before checkout, and reading an account balance commonly need synchronous responses:

```text
Client -- request --> Service
Client <-- result --- Service
```

Thumbnail generation, later notification, or analytics updates can normally happen after the upload is accepted:

```text
Client -> API -> SQS queue -> workers later
               |
               +--> API can acknowledge acceptance
```

"Your request was accepted" and "all requested work finished" are different promises. Queue-based design makes that distinction explicit.

### A queue buffers different rates

Suppose workers handle 100 jobs per second, while an upload spike produces 500 per second:

```text
Producers at 500 jobs/s -> SQS backlog -> Consumers at 100 jobs/s
```

Without a buffer, the spike directly overloads the workers. With SQS, the backlog grows during the spike. After arrival rate falls—or after workers scale out—the consumers can drain it.

This provides four related properties:

- **Temporal decoupling:** producer and consumer do not have to run at the same moment.
- **Failure isolation:** work remains in the queue while consumers are temporarily unavailable.
- **Load leveling:** a burst becomes a measurable backlog instead of immediate downstream overload.
- **Independent scaling:** consumer capacity can change without changing producer code.

SQS redundantly stores messages across AWS infrastructure, and Standard queues are designed for very high throughput. A queue does not create infinite capacity: a sustained arrival rate above the consumption rate makes backlog and message age grow. It gives the system time and evidence to respond.

## What Do Producers, Queues, and Consumers Do?
<!-- section-summary: A producer describes work, SQS retains it, and one of several competing consumers retrieves and completes it. -->

Every basic queue path has three actors:

```text
Producer -- SendMessage --> SQS queue -- ReceiveMessage --> Consumer
```

### The producer discovers work

An order service, upload API, billing service, S3 event path, EventBridge rule, SNS topic, Lambda function, EC2 application, or other component can send a message. The producer describes the work; it should not need to know which specific worker will process it.

### The queue retains the request

A queue such as `orders-to-fulfil` can hold individual work items:

```text
orders-to-fulfil
  Order #1001
  Order #1002
  Order #1003
  Order #1004
```

SQS is not executing those jobs. It owns storage and delivery state until consumers acknowledge success or retention expires.

### Consumers pull work

Consumers can be Lambda functions, ECS or Fargate tasks, EC2 applications, Kubernetes pods, or software outside AWS. SQS normally uses a pull model: the consumer asks for available work rather than SQS opening a connection and pushing directly to the application.

Lambda can make this look like a push because AWS manages the polling through an event source mapping. The underlying relationship is still managed polling and batch delivery.

### Consumers normally compete for one stream of work

Four workers reading `orders-to-ship` can each receive a different order:

```text
orders-to-ship
  ├── Consumer A gets Order 81
  ├── Consumer B gets Order 82
  ├── Consumer C gets Order 83
  └── Consumer D gets Order 84
```

The queue represents one logical work stream. The intent is not usually to send Order 81 to every consumer. That would be fanout.

When billing, analytics, and notifications must each receive their own copy of an event, publish through SNS or route with EventBridge into separate SQS queues:

```text
                  +-> Billing SQS -> billing worker
Event -> SNS -----+-> Analytics SQS -> analytics worker
                  +-> Notifications SQS -> notification worker
```

A useful initial distinction is:

```text
SQS:             Someone needs to process this work.
SNS/EventBridge: Something happened; interested systems may react.
```

### What Should an SQS Message Contain?
<!-- section-summary: A useful message is a versioned contract with stable identifiers, duplicate protection, correlation context, time, and the data required for the work. -->

A minimal message might contain only an order ID:

```json
{
  "orderId": "order-123"
}
```

As the system grows, consumers need enough context to interpret, trace, and safely retry the work. A useful envelope can look like this:

```json
{
  "messageType": "OrderCreated",
  "schemaVersion": 1,
  "messageId": "evt-7f912",
  "idempotencyKey": "order-123-created",
  "correlationId": "req-9183",
  "occurredAt": "2026-08-23T12:30:00Z",
  "payload": {
    "orderId": "order-123",
    "customerId": "customer-88",
    "total": 79.95,
    "currency": "GBP"
  }
}
```

Each field answers a different operational question:

| Field | Question it answers |
| --- | --- |
| `messageType` | What does this message mean? |
| `schemaVersion` | Which contract version should parse the JSON? |
| `messageId` | Which logical event or command is this? |
| `idempotencyKey` | Has this business operation already succeeded? |
| `correlationId` | Which request or workflow caused it? |
| `occurredAt` | When did the producer create it? |
| `payload` | Which data is required to perform the work? |

Do not blindly serialize a complete database object. That couples consumers to internal storage shape, increases payload size, and can expose fields they do not need. Define a clear message contract and an evolution policy.

SQS messages can currently be up to 1 MiB. For larger payloads, store the data elsewhere, such as S3, and put a reference plus integrity and ownership context in the message. The consumer must then have permission to read that referenced object and handle its lifecycle.

## How Does the SQS Message Lifecycle Work?
<!-- section-summary: A message moves from available to temporarily invisible, then is either deleted after success or made available again after the visibility timeout. -->

The central SQS state machine is:

```text
Send -> AVAILABLE -> Receive -> IN-FLIGHT and invisible
                                  |
                    +-------------+-------------+
                    |                           |
                 success                    failure
                    |                           |
             DeleteMessage              timeout expires
                    |                           |
                  gone                    AVAILABLE again
```

### Receiving and deleting are separate operations

A producer sends `GenerateThumbnail(video-481)`. A worker calls `ReceiveMessage` and receives it. SQS does not delete the message at that moment; it temporarily hides it. The worker downloads the video, creates the thumbnail, uploads the result, and then calls `DeleteMessage` with the receipt handle for that delivery attempt.

If receive deleted the message immediately, a worker crash after delivery would produce this state:

```text
message gone + work unfinished
```

Separating receive from delete makes deletion the consumer's acknowledgement of success.

### Visibility timeout is a temporary processing lease

Suppose the visibility timeout is 30 seconds. Worker A receives message M at 12:00:00, so other consumers cannot receive it during the timeout. If A succeeds at 12:00:07 and deletes M, it is gone. If A crashes at 12:00:05 and never deletes it, M becomes available again after the timeout and Worker B can try.

SQS does not have to diagnose the crash. It only observes that no valid delete acknowledgement arrived before the lease expired.

### Choose the visibility timeout around processing behavior

If normal work takes 20 to 40 seconds while the timeout is 10, a second worker can receive the same message while the first is still working. A too-short timeout creates concurrent duplicate processing.

If normal work takes 5 seconds while the timeout is 6 hours, an immediate worker crash can delay the next attempt for far too long. A too-long timeout slows recovery.

```text
too short -> duplicate concurrent work
too long  -> slow retry after failure
```

For unpredictable jobs, a consumer can call `ChangeMessageVisibility` to extend the current lease as it makes progress. SQS visibility can be configured up to 12 hours.

### Four clocks serve different purposes

These settings are often confused:

| Clock | Meaning |
| --- | --- |
| Delivery delay | Hide a newly sent message before its first processing attempt |
| Long-poll wait time | Let `ReceiveMessage` wait for work instead of returning empty immediately |
| Visibility timeout | Hide a received message while one consumer attempts it |
| Message retention | Limit how long an unprocessed message may remain in the queue overall |

Long polling can wait up to 20 seconds and generally reduces empty receives and unnecessary polling calls. It does not extend the processing lease or the message's total retention.

## How Do Retries, Dead-Letter Queues, and Idempotency Work Together?
<!-- section-summary: Undeleted work returns for another attempt, repeated failures move to quarantine, and idempotency prevents a retried delivery from repeating business effects. -->

Retries emerge naturally from the receive–visibility–delete model. If processing fails and the consumer does not delete the message, the visibility timeout expires and SQS can deliver it again.

### Repeated failures create poison messages

A message with `"videoId": null` may never satisfy a consumer that requires a video ID:

```text
receive -> error -> visibility expires -> receive -> error -> ...
```

Automatic retry is valuable for transient failures but cannot repair malformed data or deterministic code bugs.

### A dead-letter queue quarantines unresolved messages

Configure `video-processing` with `video-processing-dlq` and a redrive policy such as `maxReceiveCount = 5`. After the configured number of receives, SQS moves the message to the DLQ.

```text
main queue -> repeated unsuccessful receives -> DLQ
```

A DLQ is quarantine, not trash. Investigate the message body, receive count, correlation ID, schema version, consumer logs, and exception. Fix the cause, then use a controlled redrive if the work should be tried again. SQS supports DLQ redrive operations for this recovery process.

### A successful side effect can still be followed by redelivery

Consider this sequence:

1. A worker receives `charge customer £50`.
2. The payment provider successfully charges the customer.
3. The worker sends `DeleteMessage`.
4. A network failure prevents the delete from succeeding.
5. Visibility expires and SQS delivers the message again.

SQS cannot infer that the external payment succeeded. Standard queues use at-least-once delivery, so consumer business logic must expect repeat delivery.

### Idempotency makes repeated execution safe

An idempotent operation has the same business effect when repeated:

```text
Non-idempotent: balance += £50
Idempotent:     set order.status = SHIPPED
```

For an action that is not naturally idempotent, include a stable key:

```json
{
  "idempotencyKey": "payment-order-92831",
  "orderId": "92831",
  "amount": 50
}
```

The consumer checks durable storage or the payment provider's idempotency feature. If the key already succeeded, it returns the recorded result and deletes the message without performing the side effect again. Otherwise it performs the action and durably records the successful key before acknowledging SQS.

Retries are not an exceptional edge case. They are part of the reliability model. Idempotency, retry limits, DLQ alarms, and redrive ownership belong in the first design, not after the first duplicate charge or poison-message incident.

## When Should You Use Standard or FIFO Queues?
<!-- section-summary: Standard queues favor high throughput with at-least-once, best-effort ordering, while FIFO queues preserve order within explicit message groups. -->

### Standard queues are the default

Standard SQS provides very high throughput, at-least-once delivery, and best-effort ordering. If messages A, B, C, and D are sent, the consumer must tolerate a sequence that can resemble:

```text
A, C, B, D, C
```

C appears more than once, and B and C are reordered. This is acceptable for independent jobs such as resizing images, generating reports, sending duplicate-safe email operations, updating analytics, or processing unrelated work items.

### FIFO queues preserve order within a group

Some operations have a required sequence. Depositing £100 and then withdrawing £80 from the same account may not have the same outcome if processed backwards.

FIFO queues provide ordering and producer-side deduplication semantics. Ordering is normally scoped through `MessageGroupId`, not forced across the entire system:

```text
Account A: A1 -> A2 -> A3
Account B: B1 -> B2 -> B3
```

The two accounts can progress concurrently while SQS preserves order within each group. A useful group ID might be an account, customer, order, or device whose operations must remain sequential.

### FIFO does not remove business-level idempotency

Descriptions of FIFO exactly-once processing should not be interpreted as a guarantee that an external payment, database action, or API side effect can never be observed twice. A consumer can perform the effect and fail before its completion is acknowledged. Important operations should remain idempotent even with FIFO.

| Question | Standard | FIFO |
| --- | --- | --- |
| Very high throughput is central | Strong default | More structured constraints |
| Strict ordering is required | No | Yes, within a message group |
| Duplicate-safe consumers needed | Yes | Still design defensively |
| Work items are independent | Usually appropriate | Sometimes unnecessary |
| Entity operations require sequence | Poor fit | Good fit |

Start with Standard unless a real ordering or deduplication requirement justifies FIFO. Do not select FIFO merely because it sounds more correct; ordering reduces concurrency where messages share a group.

## How Do Lambda and Container Consumers Process SQS Messages?
<!-- section-summary: Lambda event source mappings poll and batch on your behalf, while long-running consumers own receive, process, visibility, and delete loops. -->

### Lambda uses an event source mapping

In `SQS -> Lambda`, SQS is not opening an HTTP webhook to the function. A Lambda event source mapping polls the queue, gathers messages into a batch, invokes the function, and deletes messages after successful processing.

```text
SQS <- AWS-managed polling -> event source mapping -> Lambda batch
```

The invocation can contain several records:

```json
{
  "Records": [
    { "body": "job A" },
    { "body": "job B" },
    { "body": "job C" }
  ]
}
```

Batching improves efficiency but creates a failure question. If A, B, D, and E succeed while C fails, treating the whole invocation as failed can return all five messages for retry. Lambda supports **partial batch responses**, allowing the function to identify only C as unsuccessful while successful records are removed.

```text
A success -> delete
B success -> delete
C failure -> retry
D success -> delete
E success -> delete
```

AWS recommends configuring the source queue's visibility timeout to at least six times the Lambda function timeout, with additional allowance when a batching window is configured. This gives Lambda's retry and throttling behavior time to complete without messages becoming visible prematurely.

### Containers and virtual machines own the poll loop

ECS, Fargate, EC2, Kubernetes, or external consumers commonly implement:

```text
while running:
  ReceiveMessage with long polling
  for each message:
    process
    on success: DeleteMessage(receiptHandle)
    on failure: leave undeleted or adjust visibility deliberately
```

`ReceiveMessage` can return up to ten messages. Long polling usually reduces empty results and cost compared with frequent short polls.

Deletion uses the **receipt handle** returned for that receive attempt, not the application's order ID or message ID. The receipt handle is the acknowledgement token for this particular delivery.

Long-running consumers also own graceful shutdown and visibility management. They should avoid taking new work when terminating and ensure messages they cannot finish become available for another consumer within an appropriate time.

### How Do You Scale and Monitor SQS Consumers?
<!-- section-summary: Queue depth measures outstanding work, message age measures lateness, in-flight and empty-receive metrics explain consumer behavior, and any DLQ arrival deserves attention. -->

A queue makes demand observable. Four workers may be sufficient for ten messages but not for 100,000. Consumer scaling can use backlog and processing duration to add capacity until the drain rate exceeds the arrival rate.

Useful CloudWatch metrics in the `AWS/SQS` namespace include:

| Metric | What it indicates |
| --- | --- |
| `ApproximateNumberOfMessagesVisible` | Messages waiting for a consumer |
| `ApproximateNumberOfMessagesNotVisible` | Messages currently in flight |
| `ApproximateAgeOfOldestMessage` | How long the oldest waiting work has been delayed |
| `NumberOfEmptyReceives` | Poll requests that returned no messages |

Depth alone lacks business context. A queue with 50,000 messages may be healthy if workers process them in three seconds. An oldest-message age of 45 minutes is often a clearer sign that promised work is late.

Monitor both:

```text
How much work exists?
+
How late is the oldest work becoming?
```

A small sustained imbalance compounds. If 100 messages arrive each second and only 90 finish, backlog increases by 10 per second, 600 per minute, and 36,000 per hour.

#### DLQ metrics deserve a lower threshold

Twenty thousand visible messages in the main queue may represent intended burst buffering. One visible message in the DLQ can represent a deterministic bug, incompatible schema, or inaccessible dependency. A common operational policy is to alarm when the DLQ contains any message.

AWS recommends monitoring the DLQ's `ApproximateNumberOfMessagesVisible`. Messages moved automatically by redrive do not make `NumberOfMessagesSent` a complete signal for DLQ arrivals.

Scaling does not replace failure handling. Adding workers to a poison-message backlog only repeats the same error faster. Interpret depth, age, errors, receive counts, in-flight work, and DLQ state together.

## How Do You Secure an SQS Queue?
<!-- section-summary: Least-privilege producer and consumer actions, queue resource policies, transport encryption, and server-side encryption protect different parts of the path. -->

Producers and consumers usually need different permissions.

A producer commonly needs:

```text
sqs:SendMessage
```

It does not automatically need `DeleteMessage`, `PurgeQueue`, or `DeleteQueue`.

A consumer may need:

```text
sqs:ReceiveMessage
sqs:DeleteMessage
sqs:ChangeMessageVisibility
sqs:GetQueueAttributes
```

depending on its implementation.

```text
Producer role -- SendMessage --> Queue
Queue -- Receive/Delete/Visibility --> Consumer role
```

SQS supports IAM identity policies and queue resource policies. Resource policies are especially relevant when an AWS service publishes to the queue or when another account needs access. Scope principals, actions, queue ARNs, source conditions, and account boundaries instead of granting broad access.

Encryption addresses separate paths:

```text
Application -> SQS    encryption in transit
Messages stored in SQS encryption at rest
```

SQS supports server-side encryption, including KMS-backed options. A customer-managed KMS key can require additional key-policy and IAM permissions for producers, consumers, and integrated AWS services.

Server-side encryption protects the message body, not every piece of queue or message metadata. Do not place secrets in identifiers or metadata fields unnecessarily.

## How Does a Complete Queue-Based System Behave?
<!-- section-summary: An image-processing example connects fast acknowledgement, a versioned job, temporary invisibility, idempotent output, retry, DLQ quarantine, monitoring, and recovery. -->

Follow a complete image-processing flow.

### 1. Keep immediate work in the upload request

The API validates `photo.jpg`, stores the original in S3, records the image, and returns an accepted response. Thumbnail generation, metadata extraction, and image analysis do not have to block the user.

### 2. Send a versioned processing job

The upload API sends:

```json
{
  "messageType": "ProcessImage",
  "schemaVersion": 1,
  "idempotencyKey": "image-img-829-v1",
  "correlationId": "request-123",
  "payload": {
    "imageId": "img-829",
    "bucket": "uploads",
    "key": "images/img-829.jpg"
  }
}
```

The queue durably owns the pending job.

### 3. A consumer receives the job

The message changes from available to in flight and becomes temporarily invisible. A Lambda event source mapping or a container poller supplies it to application code.

### 4. The consumer writes idempotent output

The worker downloads the original, resizes it, writes `thumbnails/img-829.jpg`, and updates the image record. Repeating the operation reasserts the same deterministic output instead of creating `thumbnail1`, `thumbnail2`, and `thumbnail3`.

### 5. Success acknowledges the queue

The consumer finishes and the message is deleted. Lambda's event source mapping handles successful deletion; a custom poller uses the receipt handle.

### 6. A temporary failure retries

If S3 briefly fails, the consumer does not acknowledge success. Visibility eventually expires, the message becomes available, and another attempt can succeed.

### 7. A permanent failure enters quarantine

If the image is corrupt and every attempt fails, the redrive policy moves the message to `image-processing-dlq`. An alarm fires. An operator uses the correlation ID, schema, payload, receive count, and logs to determine whether to repair code, correct data, or intentionally discard the job. Valid recoverable messages can then be redriven.

The full loop is:

```text
Producer -- SendMessage --> SQS available backlog
                                |
                          ReceiveMessage
                                v
                         Consumer processing
                                |
                      +---------+---------+
                      |                   |
                   success             failure
                      |                   |
                    delete       no successful delete
                      |                   |
                    done          visibility expires
                                          |
                                          v
                                        retry
                                          |
                              repeated failures?
                                  no / yes
                                  |      |
                                queue   DLQ
```

The core rules are:

1. A queue separates requesting work from performing it.
2. The producer does not choose a specific consumer instance.
3. Receiving is not success; deletion acknowledges success.
4. Visibility is a temporary lease, not deletion.
5. Work without a successful delete becomes eligible for retry.
6. A configured DLQ quarantines repeated failures.
7. Standard queues require idempotent, duplicate-safe consumers.
8. FIFO belongs to real ordering requirements, scoped by message group.
9. Queue depth measures work volume; oldest-message age measures lateness.
10. Independent subscribers need fanout to separate queues rather than competition on one queue.

The deepest mental model is simple: **the work does not have to be performed by this exact process or at this exact moment, but it must not be forgotten.**

## Check Your Answers

:::expand[Why Should Some Work Wait in a Queue?]{kind="recap"}
SQS removes deferred work from the synchronous request path and buffers temporary differences between production and consumption rates.

If the caller does not need the completed result now, SQS can keep the work outside the synchronous request. The queue isolates consumer outages, absorbs short bursts, and allows consumer capacity to scale independently.
:::

:::expand[What Do Producers, Queues, and Consumers Do?]{kind="recap"}
A producer describes work, SQS retains it, and one of several competing consumers retrieves and completes it.

The producer describes a job, the queue retains it, and one consumer from a competing group processes it. Fanout to several independent systems requires SNS or EventBridge to deliver separate copies, often into separate queues.

A useful message is a versioned contract with stable identifiers, duplicate protection, correlation context, time, and the data required for the work.

Use a clear, versioned contract with message and idempotency IDs, a correlation ID, occurrence time, and only the payload required by the consumer. Store payloads larger than the SQS limit elsewhere and send a protected reference.
:::

:::expand[How Does the SQS Message Lifecycle Work?]{kind="recap"}
A message moves from available to temporarily invisible, then is either deleted after success or made available again after the visibility timeout.

A sent message is available. Receive makes it in flight and invisible. Successful work deletes it with the receipt handle. Failure leaves it undeleted, so visibility expiry makes it available again. Delay, polling wait, visibility, and retention are separate clocks.
:::

:::expand[How Do Retries, Dead-Letter Queues, and Idempotency Work Together?]{kind="recap"}
Undeleted work returns for another attempt, repeated failures move to quarantine, and idempotency prevents a retried delivery from repeating business effects.

Retries recover transient failures but can repeat a side effect or endlessly recycle invalid data. Idempotency protects business outcomes, while a redrive policy moves repeated failures to a DLQ for investigation and controlled recovery.
:::

:::expand[When Should You Use Standard or FIFO Queues?]{kind="recap"}
Standard queues favor high throughput with at-least-once, best-effort ordering, while FIFO queues preserve order within explicit message groups.

Use Standard for high-throughput work that tolerates best-effort ordering and duplicate delivery. Use FIFO when sequence matters, and select a message-group key that preserves order for one entity while allowing unrelated groups to run concurrently.
:::

:::expand[How Do Lambda and Container Consumers Process SQS Messages?]{kind="recap"}
Lambda event source mappings poll and batch on your behalf, while long-running consumers own receive, process, visibility, and delete loops.

Lambda event source mappings own polling, batching, invocation, and successful deletion; partial batch responses isolate failed records. Container or VM consumers own long polling, processing, visibility management, and deletion with each delivery's receipt handle.

Queue depth measures outstanding work, message age measures lateness, in-flight and empty-receive metrics explain consumer behavior, and any DLQ arrival deserves attention.

Scale from outstanding work and processing capacity, but monitor both visible depth and oldest-message age. In-flight messages and empty receives explain consumer behavior, while any DLQ message commonly deserves an alarm.
:::

:::expand[How Do You Secure an SQS Queue?]{kind="recap"}
Least-privilege producer and consumer actions, queue resource policies, transport encryption, and server-side encryption protect different parts of the path.

Give producers send permission and consumers only the receive, delete, visibility, and attribute actions they require. Use queue policies for service or cross-account access, TLS in transit, and server-side encryption at rest with correct KMS permissions.
:::

:::expand[How Does a Complete Queue-Based System Behave?]{kind="recap"}
An image-processing example connects fast acknowledgement, a versioned job, temporary invisibility, idempotent output, retry, DLQ quarantine, monitoring, and recovery.

The request stores immediate state and enqueues deferred work. A consumer receives the job invisibly, writes duplicate-safe output, and acknowledges success. Temporary failures retry; repeated permanent failures enter a monitored DLQ and follow an owned repair or redrive process.
:::

## References

- [Amazon SQS documentation: Standard queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html)
- [Amazon SQS documentation: Message quotas](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html)
- [Amazon SQS documentation: Receiving and deleting messages](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/step-receive-delete-message.html)
- [Amazon SQS documentation: Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
- [Amazon SQS API reference: ReceiveMessage](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html)
- [Amazon SQS documentation: Long polling](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/best-practices-setting-up-long-polling.html)
- [Amazon SQS documentation: Dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Amazon SQS documentation: DLQ redrive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)
- [Amazon SQS documentation: At-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html)
- [AWS Lambda documentation: Using Lambda with SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [AWS Lambda documentation: SQS error handling and partial batches](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html)
- [AWS Lambda documentation: Configuring an SQS event source](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)
- [Amazon SQS documentation: CloudWatch metrics](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)
- [Amazon SQS documentation: Identity-based policies](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-using-identity-based-policies.html)
- [Amazon SQS documentation: Least privilege for encrypted queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-least-privilege-policy.html)
- [Amazon SQS documentation: Server-side encryption](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html)
