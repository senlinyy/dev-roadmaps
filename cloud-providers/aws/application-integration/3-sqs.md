---
title: "SQS"
description: "Use Amazon SQS queues to decouple AWS workloads with producers, consumers, polling, visibility timeout, retries, DLQs, FIFO ordering, Lambda triggers, monitoring, permissions, and encryption."
overview: "Amazon SQS gives background work a durable place to wait. This article follows an order fulfillment flow through queues, producers, consumers, polling, visibility timeout, receipt handles, retries, DLQs, FIFO message groups, idempotent workers, Lambda event source mappings, CloudWatch alarms, IAM permissions, and encryption."
tags: ["aws", "sqs", "queues", "messaging", "application-integration"]
order: 3
id: article-cloud-providers-aws-application-integration-messaging
aliases:
  - messaging
  - 2-messaging
  - sqs
  - 3-sqs
  - cloud-providers/aws/application-integration/2-messaging.md
  - cloud-providers/aws/application-integration/3-sqs.md
---

## Table of Contents

1. [The Checkout Queue](#the-checkout-queue)
2. [Queues, Producers, And Consumers](#queues-producers-and-consumers)
3. [A Useful Message Shape](#a-useful-message-shape)
4. [Polling](#polling)
5. [Visibility Timeout And Receipt Handles](#visibility-timeout-and-receipt-handles)
6. [Retries And Dead-Letter Queues](#retries-and-dead-letter-queues)
7. [Standard Queues And FIFO Queues](#standard-queues-and-fifo-queues)
8. [Message Groups And Idempotency](#message-groups-and-idempotency)
9. [Lambda Event Source Mapping](#lambda-event-source-mapping)
10. [Monitoring Backlog Age](#monitoring-backlog-age)
11. [Permissions And Encryption](#permissions-and-encryption)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## The Checkout Queue
<!-- section-summary: SQS gives slow or retryable work a durable place to wait after the user-facing request finishes. -->

The previous article put API Gateway in front of an application API. Now the request can reach the backend through a clean public entry point. The next question is what the backend should finish before it answers the customer.

The production scenario for this article is a checkout flow. A customer buys a laptop bag from an online store. The checkout API validates the cart, creates an `orderId`, writes the order row, and returns a response. Around that core path, several extra jobs need to happen. A receipt email should go out. A warehouse pick ticket should be created. A fraud review system should receive the order. A customer analytics table should update.

Those jobs matter, but they have different timing and failure rules from the checkout request. The email provider can slow down. The warehouse system can return a temporary error. The analytics table can lag for a few minutes. If the checkout API waits for all of that work before it returns, the customer experience now depends on every downstream system behaving perfectly at the same moment.

**Amazon Simple Queue Service**, usually shortened to **SQS**, gives that extra work a place to wait. SQS is a managed queue service. A queue stores messages until a worker receives them, processes them, and deletes them. In the checkout flow, the API sends an order fulfillment message to a queue such as `order-fulfillment-jobs`, returns to the customer, and lets workers process the fulfillment jobs in the background.

That small change creates a better boundary. Checkout owns creating the order. The queue owns waiting. Workers own doing the slower background work. If the warehouse system has a 10-minute outage, messages collect in the queue instead of disappearing or blocking checkout. When the warehouse recovers, workers keep pulling from the backlog.

## Queues, Producers, And Consumers
<!-- section-summary: An SQS design starts with one queue, one or more producers that send messages, and one or more consumers that drain work. -->

A **queue** is a durable waiting room for messages. In SQS, a message contains a body, optional attributes, system attributes, and an identifier that AWS returns when the message enters the queue. SQS stores messages redundantly across AWS infrastructure, and the queue can hold work while producers and consumers run at different speeds.

A **producer** is the application component that sends a message. In the checkout scenario, the producer is the checkout API. After it commits the order row, it sends a compact message to `order-fulfillment-jobs`. The producer should send facts about the work, not a giant copy of every object in the order system. The `orderId` points workers back to the source of truth.

A **consumer** is the application component that receives messages and processes them. A consumer can be a container worker, an EC2 process, a Kubernetes job, a Lambda function, or any service using the AWS SDK. In the checkout scenario, fulfillment workers receive order messages, load the order from the database, call the warehouse system, send the receipt, and delete the message after the work succeeds.

The first production habit is to name queues by the work they contain. `order-fulfillment-jobs` says what the consumer should do. `checkout-events` sounds broader and can become a dumping ground for unrelated work. A clear queue name helps alarms, dashboards, IAM policies, and incident notes stay readable.

The second habit is to keep one queue focused on one processing contract. If receipt emails and warehouse tickets need totally different retry limits, throughput, permissions, and alert thresholds, they usually deserve separate queues. Sharing one queue can work for early development, but production teams separate workloads when the operations story starts to diverge.

Here is a practical starting shape for the checkout flow:

| Piece | Production name | Job |
| --- | --- | --- |
| Producer | `checkout-api` | Sends one message after the order commit succeeds |
| Queue | `order-fulfillment-jobs` | Stores fulfillment work until workers have capacity |
| Consumer | `fulfillment-worker` | Receives, processes, and deletes messages |
| Failure queue | `order-fulfillment-dlq` | Holds messages that failed too many receives |

This shape keeps the request path short. It also gives operators a clear place to look during an incident. If customers can check out but fulfillment lags, the queue metrics show the size and age of the backlog.

## A Useful Message Shape
<!-- section-summary: A good SQS message contains stable identifiers, operation intent, and enough context for a consumer to work safely. -->

A **message** is the record that travels through the queue. It should be small, stable, and specific. In a real system, the queue message usually says which business object changed and what work the consumer should perform. The database, object store, or service API remains the source of truth for the full details.

For the checkout scenario, the message can look like this:

```json
{
  "schemaVersion": 1,
  "eventType": "OrderReadyForFulfillment",
  "eventId": "evt_01J9Z9V1N8G6P5V7K2H7Q89MZ4",
  "orderId": "ord_104455",
  "customerId": "cus_77891",
  "idempotencyKey": "fulfill-order:ord_104455:v1",
  "createdAt": "2026-06-13T09:45:12Z"
}
```

The `schemaVersion` field gives consumers a way to handle message changes over time. The `eventType` names the work. The `eventId` gives logs and traces a stable correlation value. The `orderId` points to the source record. The `idempotencyKey` gives consumers a business key for duplicate protection. The timestamp helps operators reason about delay.

Message attributes can carry routing or observability metadata outside the body. For example, the producer can attach `tenantId`, `environment`, or `traceId` as attributes so workers and logs can filter without parsing every body. Keep sensitive personal data out of attributes unless the team has a clear reason and a clear retention policy.

The producer should send the SQS message after the order commit succeeds. If the API sends the message first and the database write fails, the worker can receive a job for an order that never existed. Teams often use an **outbox table** for stronger reliability. The checkout transaction writes both the order row and an outbox row. A separate publisher reads unsent outbox rows, sends SQS messages, and marks them as published. That pattern gives the team a recovery path if the API crashes between the database commit and the SQS send.

A producer policy for the checkout API can stay narrow. This role only needs to send messages to one queue:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendOrderFulfillmentJobs",
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:order-fulfillment-jobs"
    }
  ]
}
```

That policy does not let the checkout API receive messages, delete messages, purge the queue, or change queue settings. Production IAM should follow the same shape: producers can send, consumers can receive and delete, and administrators manage queue configuration through a separate path.

## Polling
<!-- section-summary: Consumers receive SQS messages by polling, and long polling reduces empty responses while keeping workers responsive. -->

SQS consumers use **polling** to ask the queue for messages. Polling means the consumer calls `ReceiveMessage` and SQS returns up to a configured number of messages, with a maximum of 10 per receive call. If messages are available, the consumer gets a batch and starts work. If the queue is empty, the call can return no messages.

SQS supports **short polling** and **long polling**. Short polling samples part of the SQS fleet and returns quickly, even when no messages come back. Long polling lets SQS wait for a message to arrive before responding. In practice, production consumers usually use long polling because it reduces empty receives and lowers API cost for quiet queues.

The most common long polling setting is `WaitTimeSeconds`, with a value above 0 and up to 20 seconds. With `WaitTimeSeconds: 20`, a worker can wait up to 20 seconds for a message. If a message arrives sooner, the call returns sooner. This gives the worker a steady loop without hammering the queue during quiet periods.

A worker loop usually has this shape:

1. Call `ReceiveMessage` with long polling and a batch size.
2. Parse and validate each message body.
3. Process each message with idempotency protection.
4. Delete each message only after its work succeeds.
5. Leave failed messages undeleted so SQS can retry them after the visibility timeout.

A receive request for the fulfillment worker can ask for message system attributes that help with operations:

```json
{
  "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/order-fulfillment-jobs",
  "MaxNumberOfMessages": 10,
  "WaitTimeSeconds": 20,
  "VisibilityTimeout": 60,
  "MessageSystemAttributeNames": [
    "ApproximateReceiveCount",
    "SentTimestamp",
    "AWSTraceHeader"
  ],
  "MessageAttributeNames": [
    "tenantId",
    "traceId"
  ]
}
```

`ApproximateReceiveCount` tells the worker how many times SQS has delivered the message without a successful delete. `SentTimestamp` helps measure delay from producer to consumer. `AWSTraceHeader` can connect traces when the producer passes X-Ray tracing context.

Polling gives workers control over pace. A container service can run more worker tasks during a backlog. A small internal application can run one worker during business hours. A Lambda event source mapping can let Lambda do the polling and scaling. The queue shape stays the same, but the consumer runtime can change as the workload grows.

## Visibility Timeout And Receipt Handles
<!-- section-summary: Receiving a message hides it for a visibility window, and the current receipt handle is the token used to delete it after success. -->

The most important SQS timing concept is the **visibility timeout**. When a consumer receives a message, SQS keeps the message in the queue but hides it from other consumers for a period of time. The default queue visibility timeout is 30 seconds, and teams adjust it to match their processing time.

The fulfillment worker makes the timing concrete. A worker receives order `ord_104455` and starts creating the warehouse pick ticket. During the visibility timeout, another worker should not receive the same message. If the first worker finishes in time and deletes the message, the job leaves the queue. If the first worker crashes or takes too long, the visibility timeout expires and SQS makes the message visible again for another receive.

A **receipt handle** is the token SQS returns when a consumer receives a message. The consumer uses the receipt handle to delete the message or change its visibility timeout. The receipt handle belongs to that receive attempt, not to the message forever. If SQS delivers the same message again later, the consumer gets a new receipt handle.

That detail matters during retries. Suppose worker A receives the message and gets receipt handle `rh-1`. The worker stalls, the 60-second visibility timeout expires, and worker B receives the same message with receipt handle `rh-2`. Worker A wakes up and tries to delete with `rh-1`. The old handle may no longer remove the message. Worker B now owns the current receive attempt.

The practical rule is simple: delete with the receipt handle from the receive attempt that actually finished the work. A worker should keep the handle next to the parsed message while processing. After success, it calls `DeleteMessage` with that handle. After failure, it leaves the message alone so SQS can retry.

Long-running work needs a visibility plan. If fulfillment normally takes 20 seconds but sometimes takes 3 minutes when the warehouse API slows down, a 30-second timeout creates duplicate processing during slow periods. Teams have two common options. Set the queue or receive visibility timeout to cover the normal upper bound, or extend visibility during processing with `ChangeMessageVisibility` before the current timeout gets too close to expiring.

The timeout should leave room for failure recovery. A visibility timeout of several hours can hide a failed message for too long. A timeout that is shorter than normal processing can create duplicate work. Pick a number from real worker timing, then alarm on messages that keep returning.

## Retries And Dead-Letter Queues
<!-- section-summary: SQS retries happen when a message is received but not deleted, and DLQs isolate messages that keep failing. -->

SQS retry behavior comes from the receive-delete contract. A message leaves the queue only after a successful delete. If a consumer fails, crashes, times out, or chooses not to delete the message, SQS makes the message visible again after the visibility timeout. Another consumer can receive it and try again.

This retry style works well for temporary problems. The warehouse API can return a `503`. The worker can log the error and leave the message undeleted. After the visibility timeout, SQS presents the message again. If the warehouse API recovers, the next attempt succeeds and the worker deletes the message.

Permanent problems need a different path. A message can have a malformed `orderId`, reference a deleted customer, or hit a code path that fails every time. Teams often call this kind of message a poison message. If it returns to the queue forever, it wastes worker time and can hide the useful backlog behind repeated failures.

A **dead-letter queue**, or **DLQ**, is a separate SQS queue that receives messages after they fail too many receive attempts. The source queue uses a redrive policy with `maxReceiveCount`. If `maxReceiveCount` is 5, SQS moves a message to the DLQ after enough failed receives. The DLQ gives engineers a quarantine area where they can inspect the message body, compare logs, fix the bug or data issue, and redrive messages back to the source queue after the fix.

Here is a CloudFormation-style JSON shape for the fulfillment queue and its DLQ:

```json
{
  "Resources": {
    "OrderFulfillmentDlq": {
      "Type": "AWS::SQS::Queue",
      "Properties": {
        "QueueName": "order-fulfillment-dlq",
        "MessageRetentionPeriod": 1209600,
        "SqsManagedSseEnabled": true
      }
    },
    "OrderFulfillmentQueue": {
      "Type": "AWS::SQS::Queue",
      "Properties": {
        "QueueName": "order-fulfillment-jobs",
        "ReceiveMessageWaitTimeSeconds": 20,
        "VisibilityTimeout": 60,
        "MessageRetentionPeriod": 345600,
        "SqsManagedSseEnabled": true,
        "RedrivePolicy": {
          "deadLetterTargetArn": {
            "Fn::GetAtt": [
              "OrderFulfillmentDlq",
              "Arn"
            ]
          },
          "maxReceiveCount": 5
        }
      }
    }
  }
}
```

The source queue keeps messages for 4 days in this example. The DLQ keeps them for 14 days. A longer DLQ retention period gives the team time to investigate after a weekend or a noisy incident. The DLQ should usually live in the same account and Region as the source queue so redrive and operations stay straightforward.

The consumer code should log the `eventId`, `orderId`, receive count, and exception before it gives up on an attempt. That log line gives the on-call engineer a trail from CloudWatch alarms to the DLQ message to the exact worker failure. A DLQ without useful logs turns into a bin of mystery JSON.

## Standard Queues And FIFO Queues
<!-- section-summary: Standard queues optimize for high throughput and at-least-once delivery, while FIFO queues add ordering and deduplication within message groups. -->

SQS has two main queue types: **standard** and **FIFO**. Standard queues are the default choice for most background work. They support very high throughput, deliver messages at least once, and provide best-effort ordering. In plain terms, every message should reach a consumer, duplicates can happen, and order can vary.

For the checkout scenario, a standard queue works well for independent fulfillment jobs. If order `ord_104455` and order `ord_104456` process in the opposite order, the business still works. The workers use idempotency so a duplicate receipt or duplicate warehouse call does not create a duplicate side effect.

**FIFO** means first-in-first-out. FIFO queues preserve order within a **message group** and support deduplication using a `MessageDeduplicationId` or content-based deduplication. A FIFO queue name ends with `.fifo`, such as `order-status-updates.fifo`.

FIFO fits workflows where order matters for the same business entity. Imagine an order status pipeline with these messages for one order: `Created`, `Paid`, `Packed`, `Shipped`, `Cancelled`. Processing `Cancelled` before `Paid` can produce bad state. A FIFO queue can use the order ID as the message group so status changes for one order stay in order.

Here is a FIFO send shape for order status updates:

```json
{
  "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/order-status-updates.fifo",
  "MessageBody": "{\"schemaVersion\":1,\"eventType\":\"OrderStatusChanged\",\"orderId\":\"ord_104455\",\"status\":\"Packed\",\"eventId\":\"evt_01J9ZB1V8S40A6WQ3T8R8ZE1MV\"}",
  "MessageGroupId": "order-ord_104455",
  "MessageDeduplicationId": "evt_01J9ZB1V8S40A6WQ3T8R8ZE1MV"
}
```

The message group controls ordering. SQS can process different message groups in parallel, so `order-ord_104455` and `order-ord_104456` can move independently. Within one group, SQS holds later messages while an earlier message remains in flight. That protects order, and it also means one stuck message can block that group.

The queue type decision should follow the business rule. Standard queues fit independent jobs that need high throughput and can handle duplicates. FIFO queues fit ordering for a business entity when that ordering matters enough to accept the extra design constraints. Many systems use both: standard queues for fulfillment jobs, FIFO queues for ordered state transitions.

## Message Groups And Idempotency
<!-- section-summary: FIFO message groups control per-entity ordering, but every SQS consumer still needs idempotent processing. -->

**Message groups** are the concurrency lanes inside a FIFO queue. All messages with the same `MessageGroupId` process in order. Messages with different group IDs can process at the same time. The group ID should match the business unit that needs ordering.

For order status, `MessageGroupId: "order-ord_104455"` is a good fit because all status updates for that order need sequence. For a tenant billing export, `MessageGroupId: "tenant-acme"` might fit because exports for one tenant need order while different tenants can run in parallel. A group ID such as `"all-orders"` creates one giant lane and removes most of the concurrency benefit.

**Idempotency** means the consumer can safely handle the same message more than once. This matters for standard queues because duplicates can happen. It also matters for FIFO queues because worker crashes, visibility timeout expiry, and downstream retry behavior can still make business side effects repeat. SQS can help with FIFO send deduplication, but the consumer still owns safe processing.

The fulfillment worker can use the `idempotencyKey` from the message body. Before it creates a warehouse pick ticket, it records the key in a database table with a unique constraint. If the insert succeeds, this worker owns the first processing attempt for that business operation. If the insert finds an existing key, the worker knows another attempt already handled or started the same operation.

A relational table can look like this:

```sql
CREATE TABLE processed_sqs_jobs (
  idempotency_key text PRIMARY KEY,
  event_id text NOT NULL,
  order_id text NOT NULL,
  status text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
```

The worker can claim the job with an insert that succeeds only once:

```sql
INSERT INTO processed_sqs_jobs (idempotency_key, event_id, order_id, status)
VALUES (:idempotencyKey, :eventId, :orderId, 'started')
ON CONFLICT (idempotency_key) DO NOTHING;
```

If the insert returns zero rows, the worker can skip the external side effect and delete the SQS message. If the insert succeeds, the worker calls the warehouse system with its own request ID, then updates the row to `completed`. The same idea works with DynamoDB conditional writes, Redis `SET NX`, or a workflow database table.

Idempotency should protect the real side effect, not only the SQS delete. A duplicate warehouse pick ticket, duplicate refund, or duplicate email can happen outside SQS if the worker calls the external service and crashes before writing local success. Real teams pass idempotency keys to payment providers, warehouse APIs, and email providers when those systems support them. When they do not, the team stores enough local state to detect repeats before calling.

## Lambda Event Source Mapping
<!-- section-summary: Lambda can poll SQS for you, but the function still needs batch failure handling, visibility tuning, and idempotency. -->

SQS consumers do not have to be long-running servers. **Lambda event source mapping** is the AWS feature that lets Lambda poll an SQS queue and invoke a function with batches of messages. Lambda handles the receive loop. Your function receives an event with records, processes them, and returns.

In the checkout scenario, a Lambda function can process `order-fulfillment-jobs` if each job finishes within the Lambda timeout and the downstream systems can handle Lambda's scaling behavior. This works nicely for spiky workloads because Lambda can add concurrency as the backlog grows. It also keeps the worker deployment small when the business logic is simple.

The core behavior stays the same. Lambda polls the queue, receives a batch, and invokes the function. The messages remain in the queue but stay hidden during the visibility timeout. If the function successfully processes the batch, Lambda deletes the messages. If the function errors, the messages can become visible again after the visibility timeout.

Batch handling needs careful design. By default, one failed message can cause the whole batch to retry, including messages that already succeeded. For production queues, enable **partial batch responses** with `ReportBatchItemFailures`. Then the function returns only the failed message IDs, and Lambda can avoid retrying successful records from the same batch.

A partial batch response has this shape:

```json
{
  "batchItemFailures": [
    {
      "itemIdentifier": "4f8c2f0d-7c98-4b8f-81b1-1a9f789f9e83"
    }
  ]
}
```

For FIFO queues, the function should stop processing records in the same ordered group after the first failure and report the failed and unprocessed records. That keeps the group order intact. For standard queues, the function can usually process independent records and return the specific failures.

The visibility timeout needs to account for Lambda retries and throttling. AWS recommends setting the queue visibility timeout to six times the Lambda function timeout, plus the batch window when a batch window is configured. If the function timeout is 30 seconds and the maximum batching window is 5 seconds, a practical visibility timeout starts at 185 seconds. The team can tune after measuring real processing time and retry behavior.

Lambda permissions also split cleanly. The Lambda execution role needs consumer actions on the queue:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ConsumeOrderFulfillmentJobs",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:us-east-1:123456789012:order-fulfillment-jobs"
    }
  ]
}
```

This role can drain the queue but cannot send new fulfillment jobs or change queue settings. Keeping producer and consumer permissions separate makes incidents easier to contain.

## Monitoring Backlog Age
<!-- section-summary: Queue health depends on backlog size, backlog age, in-flight messages, failures, and DLQ depth. -->

An SQS queue can look quiet from the application logs while work quietly piles up. Production teams watch queue metrics because the queue owns the waiting state. The most useful question is how old the oldest useful message is, because age connects backlog to customer impact.

CloudWatch publishes SQS metrics under the `AWS/SQS` namespace. The values are often approximate because SQS is distributed, but they are accurate enough for operational decisions. For fulfillment, a dashboard should show how many messages are waiting, how many are in flight, how old the oldest message is, how many empty receives happen, and whether the DLQ contains anything.

These metrics make a practical first dashboard:

| Metric | What it tells you | Fulfillment alarm idea |
| --- | --- | --- |
| `ApproximateNumberOfMessagesVisible` | Messages waiting for retrieval | Alarm when backlog stays above normal for 10 minutes |
| `ApproximateNumberOfMessagesNotVisible` | Messages received but not deleted yet | Alarm when high in-flight count stays high without deletes |
| `ApproximateAgeOfOldestMessage` | Age of the oldest unprocessed message | Alarm when age exceeds the user promise, such as 5 minutes |
| `NumberOfMessagesReceived` | Messages returned to consumers | Compare with producer sends and deletes |
| `NumberOfMessagesDeleted` | Successful delete calls | Watch for a drop while receives continue |
| `NumberOfEmptyReceives` | Receive calls that returned no messages | Tune polling when empty receives are high |
| DLQ `ApproximateNumberOfMessagesVisible` | Failed messages waiting in the DLQ | Alarm on any message in critical queues |

For checkout fulfillment, `ApproximateAgeOfOldestMessage` might be the page-worthy alarm. If the business promise says warehouse tickets should start within 5 minutes, an oldest message age above 300 seconds means the queue is breaking the promise. The fix might be scaling workers, pausing a noisy downstream call, raising a provider limit, or rolling back a worker release.

Backlog size and backlog age tell different stories. A backlog of 10,000 messages can be acceptable during a planned import if workers drain it quickly. A backlog of 50 messages can be urgent if the oldest one has waited 30 minutes. Age helps connect the metric to the experience users or operations teams care about.

DLQ monitoring needs special care. For a DLQ, the recommended first signal is `ApproximateNumberOfMessagesVisible`, because messages moved by redrive do not always behave like manually sent messages in every metric. A critical queue can alarm on any DLQ message. A lower-priority queue can alarm when DLQ depth stays above a small threshold for a short period.

The runbook should include the queue URL, the DLQ URL, the owning service, the last deployment link, common failure messages, and the safe redrive process. A redrive before the bug is fixed just sends broken messages back into the same failure loop.

## Permissions And Encryption
<!-- section-summary: SQS security uses IAM policies, optional queue resource policies, encrypted transport, and server-side encryption at rest. -->

SQS access uses IAM, just like the rest of AWS. A producer role needs `sqs:SendMessage`. A consumer role needs `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility`, and often `sqs:GetQueueAttributes`. An operations role might need `sqs:GetQueueAttributes`, `sqs:ListQueues`, and controlled redrive actions. Queue administrators need separate permissions to create queues, set attributes, and manage policies.

SQS also supports **resource-based queue policies**. A queue policy attaches to the queue itself and can grant or deny access to principals, accounts, or services. Identity-based policies are usually enough inside one account. Queue policies matter for cross-account producers, service integrations, and guardrails such as requiring encrypted transport.

Here is a queue policy statement that denies SQS actions over insecure transport:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "sqs:*",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:order-fulfillment-jobs",
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

That statement uses an explicit deny. If a request does not use secure transport, the deny wins even when another policy grants access. This is the kind of guardrail that belongs at the queue boundary because it protects every producer and consumer path.

For cross-account sending, a queue policy can allow one role in another account to call `sqs:SendMessage`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPartnerOrderProducer",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111122223333:role/partner-order-producer"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:order-fulfillment-jobs"
    }
  ]
}
```

That policy should be paired with a narrow identity policy in the sending account. The queue owner controls the resource boundary. The producer account controls which workload can assume the sending role. Both sides should log the message `eventId` so cross-account troubleshooting has a shared key.

SQS supports server-side encryption at rest. New queues can use SQS-managed server-side encryption, often called SSE-SQS, or a KMS key, often called SSE-KMS. SSE-SQS reduces key management work. SSE-KMS gives the team more control over key policy, auditing, and separation when compliance requires it.

If a queue uses SSE-KMS with a customer managed key, producers and consumers may need KMS permissions in addition to SQS permissions. A producer can fail with a KMS access error even when `sqs:SendMessage` is allowed. A consumer can fail receive or delete flows if the key policy and IAM policy do not allow the needed KMS use. The practical production check is to test producer and consumer roles against the encrypted queue before rollout, then include KMS errors in the runbook.

Security also includes message design. Put identifiers and work instructions in SQS. Keep large payloads and sensitive documents in services designed for that data, such as a database or S3 with its own access controls. The SQS message can carry a pointer and a version. That keeps queue retention, logs, DLQs, and debugging from spreading more sensitive data than the worker needs.

## Putting It All Together
<!-- section-summary: A production SQS workflow separates the request path, waiting state, worker retries, failure quarantine, monitoring, and access boundaries. -->

Return to checkout with the full SQS design in place.

The checkout API validates the cart, writes the order, and records an outbox row in the same database transaction. An outbox publisher sends a small `OrderReadyForFulfillment` message to `order-fulfillment-jobs`. The message contains `eventId`, `orderId`, `schemaVersion`, `createdAt`, and an `idempotencyKey`. The checkout API role can only call `sqs:SendMessage` on that queue.

Fulfillment workers use long polling with `WaitTimeSeconds: 20` and receive up to 10 messages at a time. When a worker receives a message, SQS hides it for the visibility timeout and returns a receipt handle. The worker validates the body, claims the idempotency key in the database, calls the warehouse system, sends the receipt, records success, and deletes the SQS message with the current receipt handle.

Temporary failures use normal SQS retries. The worker logs the failure and leaves the message undeleted. After the visibility timeout expires, SQS returns the message to the queue. Permanent failures move to `order-fulfillment-dlq` after the configured receive count. Engineers inspect the DLQ body and logs, fix the underlying problem, and redrive the messages only after the consumer can handle them.

The queue type follows the business rule. The main fulfillment queue can use a standard queue because each order job stands alone and workers use idempotency. A separate `order-status-updates.fifo` queue can handle ordered status transitions with `MessageGroupId` set to the order ID. That gives high-throughput background work one path and ordered state changes another path.

Lambda can replace container workers when the job fits Lambda's execution model. The event source mapping polls SQS and invokes the function in batches. Partial batch responses keep successful records from retrying with failed records. The queue visibility timeout accounts for the function timeout and batch window.

Operations watch backlog depth, oldest message age, in-flight count, delete rate, empty receives, and DLQ depth. The page-worthy alarm uses `ApproximateAgeOfOldestMessage` because it maps directly to the fulfillment promise. Permissions split producer, consumer, admin, and cross-account access. Encryption protects data at rest, and secure transport guardrails protect requests in transit.

This is the main SQS production pattern: the request path does the minimum synchronous work, the queue stores retryable work, consumers process safely, DLQs isolate poison messages, and metrics tell the team whether the background system is keeping its promise.

## What's Next

SQS is the first async building block to understand because it teaches the queue contract: send, wait, receive, hide, process, delete, retry, and quarantine. Many event-driven AWS designs use this same thinking even when the routing layer changes.

The next article moves from one queue to pub/sub with SNS. It looks at topics, subscriptions, fanout, message filters, SNS-to-SQS delivery, and how several systems can receive the same publication without checkout calling each one directly.

---

**References**

- [What is Amazon Simple Queue Service?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html) - Defines SQS, basic architecture, message lifecycle, retention, durability, and security benefits.
- [Amazon SQS queue types](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html) - Explains standard queues, FIFO queues, throughput, ordering, at-least-once delivery, deduplication, and message groups.
- [Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html) - Documents how messages become hidden after receive and visible again if consumers do not delete them.
- [ReceiveMessage API](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ReceiveMessage.html) - Documents receive parameters, long polling, message attributes, system attributes, visibility timeout, and receipt handles.
- [DeleteMessage API](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_DeleteMessage.html) - Explains deleting messages with receipt handles and why the latest receipt handle matters.
- [Setting up long polling in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/best-practices-setting-up-long-polling.html) - Documents long polling behavior, maximum wait time, empty response reduction, and false empty response reduction.
- [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html) - Covers DLQ use, redrive policy, `maxReceiveCount`, retention behavior, and DLQ monitoring guidance.
- [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html) - Explains Lambda polling, batching, delete behavior, and partial batch response guidance for SQS event source mappings.
- [Creating and configuring an Amazon SQS event source mapping](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html) - Documents Lambda SQS configuration and the recommended visibility timeout relationship to function timeout and batch window.
- [Handling errors for an SQS event source in Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html) - Explains retry backoff, partial batch responses, and FIFO failure handling considerations.
- [Available CloudWatch metrics for Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html) - Documents SQS metrics such as oldest message age, visible backlog, in-flight messages, deletes, empty receives, and DLQ metric behavior.
- [Identity-based policy examples for Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-basic-examples-of-iam-policies.html) - Shows least-privilege identity policy examples for SQS producers and operators.
- [Basic examples of Amazon SQS policies](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-basic-examples-of-sqs-policies.html) - Shows queue resource policy examples for cross-account permissions and access restrictions.
- [Encryption at rest in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html) - Explains SQS server-side encryption with SQS-managed encryption and AWS KMS keys.
