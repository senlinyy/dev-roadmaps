---
title: "EventBridge"
description: "Route AWS, application, and SaaS events with EventBridge event buses, rules, targets, retries, archives, schedules, and cross-account delivery."
overview: "EventBridge is AWS's managed event router. This article follows one production order platform as it publishes facts, routes them through event buses, handles delivery failures, replays events safely, and chooses between EventBridge, SNS, and SQS."
tags: ["aws", "eventbridge", "events", "application-integration"]
order: 5
id: article-cloud-providers-aws-application-integration-event-driven-architecture
aliases:
  - event-driven-architecture
  - 3-event-driven-architecture
  - eventbridge
  - 5-eventbridge
  - cloud-providers/aws/application-integration/3-event-driven-architecture.md
  - cloud-providers/aws/application-integration/5-eventbridge.md
---

## Table of Contents

1. [The Production Scenario](#the-production-scenario)
2. [Events Are Facts](#events-are-facts)
3. [Event Buses](#event-buses)
4. [Publishing with PutEvents](#publishing-with-putevents)
5. [Rules and Event Patterns](#rules-and-event-patterns)
6. [Targets and Input Transformers](#targets-and-input-transformers)
7. [Retries, DLQs, and Failed Delivery](#retries-dlqs-and-failed-delivery)
8. [Archives and Replay](#archives-and-replay)
9. [Cross-Account Routing](#cross-account-routing)
10. [Pipes, Scheduled Rules, and Scheduler](#pipes-scheduled-rules-and-scheduler)
11. [Idempotency and Ordering](#idempotency-and-ordering)
12. [When SNS or SQS Is Better](#when-sns-or-sqs-is-better)
13. [Putting It All Together](#putting-it-all-together)
14. [What's Next](#whats-next)

## The Production Scenario
<!-- section-summary: EventBridge makes sense when one production fact needs to reach several teams without checkout knowing every consumer. -->

Imagine a course marketplace called Northstar Learn. A student buys a course, and the checkout service stores the order in its database. That one order matters to many parts of the company. The receipt service wants to email the customer. The analytics team wants to count revenue. The fraud team wants to inspect large orders. The fulfillment team wants to unlock the course. The finance team wants a nightly reconciliation file.

Checkout could call every one of those systems directly. That works on the first day, when there are two consumers and everyone sits in the same codebase. After a few months, checkout carries too many responsibilities. Every new consumer needs a checkout deployment. Every slow consumer can slow checkout down. Every retry rule for a downstream service leaks into the place where the customer is waiting.

**Amazon EventBridge** gives the system a different shape. Checkout publishes a fact like `OrderCreated` or `PaymentCaptured` to an event bus. EventBridge evaluates rules on that bus and delivers matching events to targets. The receipt team owns a receipt rule. The fraud team owns a fraud rule. Checkout owns the fact it published, and each consumer owns its reaction to that fact.

That is the pattern for the whole article. Northstar Learn will publish order events, route them through an EventBridge bus, transform some payloads for targets, deal with failure, replay events after a bug, route selected events across accounts, and decide when a queue or topic is the cleaner tool.

## Events Are Facts
<!-- section-summary: A useful event says what already happened, carries stable identifiers, and lets consumers decide their own reaction. -->

An **event** is a JSON record that says something happened. In EventBridge, AWS service events, custom application events, and SaaS partner events all use this idea. The important habit is to write events as facts. `OrderCreated` is a fact. `CreateOrder` is a request for another system to do something. The words matter because they tell you who owns the action.

In Northstar Learn, checkout owns order creation. After checkout commits the order, it can publish `OrderCreated`. The receipt service may send an email. Analytics may update a report. Fraud may start a review. Checkout stays focused on the fact it owns and leaves each consumer to decide its own reaction.

EventBridge events have a common envelope. AWS fills some fields for events it receives, and custom publishers provide the main routing fields when they call `PutEvents`. The fields you will see most often are `source`, `detail-type`, `detail`, `time`, `resources`, `account`, and `region`. The `detail` field carries the business payload.

```json
{
  "version": "0",
  "id": "9c2f7d31-52b4-4eb8-9c77-ef6a9f47b4b8",
  "detail-type": "OrderCreated",
  "source": "com.northstar.checkout",
  "account": "111122223333",
  "time": "2026-06-13T09:15:00Z",
  "region": "us-east-1",
  "resources": [
    "arn:aws:dynamodb:us-east-1:111122223333:table/orders"
  ],
  "detail": {
    "eventId": "evt-01JXG0NS2ZP6V6MMJ18B8SW96P",
    "orderId": "order-1042",
    "customerId": "cust-7781",
    "tenantId": "tenant-learning",
    "totalCents": 12900,
    "currency": "USD",
    "createdAt": "2026-06-13T09:14:58Z"
  }
}
```

The example keeps the event small. It includes stable IDs, money values needed for routing, and a timestamp. The payload avoids copying the whole order database row. In production, this matters because events live longer than the first consumer. If the payload contains private data, every target, archive, log group, and replay path may also receive that data.

For application events, a good `source` usually uses a reverse-domain style name such as `com.northstar.checkout`. A good `detail-type` uses past-tense business language such as `OrderCreated`, `PaymentCaptured`, or `RefundIssued`. A good `detail` includes an application-level `eventId` or business key so consumers can handle retries and replays safely.

The hardest part is making the fact true. If checkout writes the order to a database and then publishes the event, the publish call might fail. If checkout publishes first and the database write fails, consumers react to a fact that never became real. Real teams usually handle this with a **transactional outbox** or a managed stream. With an outbox, checkout writes the order and an `outbox_events` row in the same database transaction. A small publisher process reads unsent rows, calls EventBridge, marks them sent, and retries failed publishes. DynamoDB teams often use DynamoDB Streams for a similar handoff from committed table changes.

## Event Buses
<!-- section-summary: Event buses receive events and route them through rules, and teams choose default, custom, or partner buses based on ownership. -->

An **event bus** is the EventBridge router. Sources send events to a bus. Rules on that bus inspect each event. Matching rules deliver the event to targets. The bus owns routing, filtering, and delivery attempts. Order, customer, and receipt records still belong to the services that created them.

EventBridge gives you three bus categories to think about.

| Bus type | What it is for | Northstar Learn example |
| --- | --- | --- |
| **Default bus** | Events from AWS services in the account, plus custom events that use the account default | S3 object events, ECS task events, or quick internal experiments |
| **Custom bus** | Application-owned event traffic with clearer permissions and rules | `northstar-orders-prod` for checkout, payment, refund, and enrollment facts |
| **Partner bus** | Events from integrated SaaS partners after you accept the partner event source | Payment provider risk signals or support-tool ticket events |

The default bus is convenient because many AWS services send events there. If Northstar Learn wants to react when an ECS task stops or an S3 object lands, the default bus is a natural place to start. For domain events such as `OrderCreated`, a custom bus gives cleaner ownership. The order platform can apply a bus policy, archive only order events, and let consumer teams create rules without mixing those rules with every AWS service event in the account.

Partner buses are for SaaS integrations. A partner event source appears in EventBridge after the SaaS provider connects to your AWS account. You accept that source, EventBridge creates or associates the partner bus, and rules can route those SaaS events like other events. The main difference is ownership: the SaaS partner emits the event, and your account decides which rules and targets receive it.

A practical production setup starts with one custom bus per strong ownership boundary rather than one bus per event type. Northstar Learn might use `northstar-orders-prod` for order-domain facts and a separate `northstar-security-prod` bus for security findings. That separation lets teams apply different permissions, retention choices, and operational alarms without creating dozens of tiny buses that nobody can navigate.

Creating the order bus with the AWS CLI is small:

```bash
aws events create-event-bus \
  --name northstar-orders-prod
```

The real work comes after creation. The team decides who can call `events:PutEvents` on the bus, who can create rules, whether archives are enabled, which tags identify ownership, and which CloudWatch alarms watch failed invocations and throttling.

## Publishing with PutEvents
<!-- section-summary: PutEvents sends custom events to a bus, and production publishers must validate the response entry by entry. -->

Custom applications publish events with the **PutEvents** API. The API accepts a batch of entries. Each entry names the event bus, source, detail type, and detail payload. In the raw API and CLI shape, `Detail` is a JSON string, even though the content inside that string represents JSON.

Here is the Northstar Learn checkout event as an `entries.json` file:

```json
[
  {
    "EventBusName": "northstar-orders-prod",
    "Source": "com.northstar.checkout",
    "DetailType": "OrderCreated",
    "Time": "2026-06-13T09:15:00Z",
    "Resources": [
      "arn:aws:dynamodb:us-east-1:111122223333:table/orders"
    ],
    "Detail": "{\"eventId\":\"evt-01JXG0NS2ZP6V6MMJ18B8SW96P\",\"orderId\":\"order-1042\",\"customerId\":\"cust-7781\",\"tenantId\":\"tenant-learning\",\"totalCents\":12900,\"currency\":\"USD\",\"createdAt\":\"2026-06-13T09:14:58Z\"}"
  }
]
```

The CLI call uses that file directly:

```bash
aws events put-events \
  --entries file://entries.json
```

The response needs real handling. EventBridge returns one response entry for each request entry, in the same order. A response can succeed for some entries and fail for others. Production code should check `FailedEntryCount`, inspect each failed entry, and retry or park the failed events in the publisher's outbox. Treating an HTTP 200 as "all events published" loses information.

```json
{
  "FailedEntryCount": 1,
  "Entries": [
    {
      "EventId": "e6b1f29f-4819-4f90-8f0a-098cf6d9145a"
    },
    {
      "ErrorCode": "InternalFailure",
      "ErrorMessage": "An internal service error occurred."
    }
  ]
}
```

There are two easy limits to remember during design. One `PutEvents` request can include up to 10 entries, and the total request must be under 1 MB. If the business payload is large, put the large document in S3 and publish an event that contains the S3 object location plus stable identifiers. EventBridge should route events; full invoice PDFs, huge course catalog snapshots, and full customer profiles belong in a storage service.

There is also one sharp edge. If a publisher sends an event to a missing bus name, EventBridge can still return a 200 response and drop the event because no bus rules can match it. That is why production publishers should keep bus names in infrastructure configuration, test them in deployment, and alarm on missing event volume from important sources.

## Rules and Event Patterns
<!-- section-summary: Rules use event patterns to subscribe targets to the exact events they need. -->

A **rule** is a subscription on an event bus. It says, "When an event matches this pattern, deliver it to this target." The pattern can match top-level metadata like `source`, `detail-type`, `account`, and `region`, and it can match fields inside `detail`.

The receipt service at Northstar Learn only needs newly created orders. Its rule can stay simple:

```json
{
  "source": ["com.northstar.checkout"],
  "detail-type": ["OrderCreated"],
  "detail": {
    "tenantId": ["tenant-learning"]
  }
}
```

The fraud service cares about large payments. Its rule can match the payment fact and a numeric value inside `detail`:

```json
{
  "source": ["com.northstar.payments"],
  "detail-type": ["PaymentCaptured"],
  "detail": {
    "totalCents": [
      {
        "numeric": [">=", 50000]
      }
    ],
    "currency": ["USD"]
  }
}
```

This is where EventBridge earns its place. Checkout publishes the same `OrderCreated` fact once. The receipt rule matches it. The analytics rule may also match it. The fraud rule ignores it because it cares about a different event type. No checkout code changes when the finance team adds a new rule later.

Event patterns deserve the same care as API contracts. A broad pattern like this may look harmless in development:

```json
{
  "source": ["com.northstar.checkout"]
}
```

In production, that pattern sends every checkout event to the target: order created, order cancelled, discount applied, checkout abandoned, and future event types the team may add later. A precise pattern protects the target and makes event volume easier to reason about.

The AWS console includes an EventBridge Sandbox for testing patterns against sample events. In infrastructure as code, teams usually keep a sample event next to the rule and test the pattern in CI with a small matcher library or an AWS-provided test path. The habit matters because one typo in `detail-type` or one wrong nesting level can leave a target silent.

AWS allows one rule to deliver to multiple targets, but real production setups are usually easier to maintain with one target per rule. If receipt and analytics both need `OrderCreated`, two rules can use the same pattern and separate targets. Later, analytics can add a filter, a DLQ, or a different retry policy without changing receipt delivery.

## Targets and Input Transformers
<!-- section-summary: Targets receive matching events, and input transformers reshape event data when a target needs a smaller or different payload. -->

A **target** is the destination EventBridge invokes after a rule matches. Common targets include Lambda functions, SQS queues, SNS topics, CloudWatch Logs groups, API destinations, Kinesis streams, ECS tasks, and other event buses. A rule can also target a bus in another account or Region when permissions allow it.

For Northstar Learn, the receipt rule might target an SQS queue instead of a Lambda function directly. That gives the receipt worker control over processing speed and keeps email provider failures away from EventBridge delivery retries. The analytics rule might target Kinesis Data Firehose or another ingestion service. The fraud rule might target a Lambda function that calls a risk API.

Targets need permissions. For Lambda, SNS, SQS, and CloudWatch Logs targets, EventBridge uses resource-based policies on the target resource. For some other target types, EventBridge uses an IAM role. This is one of the first places teams hit a confusing "rule matched, target failed" situation. The rule can be correct and still fail because the target lacks permission for `events.amazonaws.com` to invoke it or send a message to it.

Here is the shape of an SQS queue policy statement that lets one EventBridge rule send messages to one queue:

```json
{
  "Sid": "AllowEventBridgeReceiptRule",
  "Effect": "Allow",
  "Principal": {
    "Service": "events.amazonaws.com"
  },
  "Action": "sqs:SendMessage",
  "Resource": "arn:aws:sqs:us-east-1:111122223333:receipt-events",
  "Condition": {
    "ArnEquals": {
      "aws:SourceArn": "arn:aws:events:us-east-1:111122223333:rule/northstar-orders-prod/receipt-order-created"
    }
  }
}
```

Most targets can receive the original event. Sometimes that is more than the target wants. An **input transformer** lets the rule build a new payload from values in the original event. The transformer has two parts: input paths that extract values, and an input template that creates the target payload.

For a receipt queue, the worker may only need `orderId`, `customerId`, and `eventId`:

```json
{
  "InputPathsMap": {
    "eventId": "$.detail.eventId",
    "orderId": "$.detail.orderId",
    "customerId": "$.detail.customerId"
  },
  "InputTemplate": "{\"eventId\":\"<eventId>\",\"orderId\":\"<orderId>\",\"customerId\":\"<customerId>\",\"jobType\":\"send-receipt\"}"
}
```

The transformer leaves the original event on the bus intact. It changes what EventBridge sends to that target. That distinction helps when analytics wants the full event, receipt wants a small job message, and fraud wants only payment fields. One event can support several target-specific payloads without making the publisher know every target format.

Transformers fit small reshaping. Heavier business logic belongs in a Lambda function, an API destination, or a pipe enrichment step, especially when the target needs to enrich an order with customer profile data.

## Retries, DLQs, and Failed Delivery
<!-- section-summary: EventBridge retries target delivery, and DLQs preserve failed events so operators can inspect and redrive them. -->

Event delivery has two different failure zones. First, the publisher may fail to put the event on the bus. That belongs to the publisher and its outbox. Second, EventBridge may receive a valid event, match a rule, and fail to deliver it to the target. That belongs to the rule target configuration.

For retriable target errors, EventBridge retries delivery. By default, EventBridge retries for up to 24 hours and up to 185 attempts with exponential backoff and jitter. You can configure a target retry policy with a lower maximum event age or lower retry count when stale work should stop sooner.

Northstar Learn's receipt target can tolerate retries for a while. Email can go out a few minutes late. The fraud target may need faster visibility, but it still needs failure evidence. A production rule usually sets a **dead-letter queue**, or DLQ, for the target. In EventBridge, a target DLQ is an SQS standard queue that receives events after EventBridge exhausts retries or hits certain non-retryable failures.

The DLQ is where operations work begins. A good DLQ message includes the original event plus EventBridge failure metadata, such as error code, error message, retry attempts, rule ARN, and target ARN. The team can inspect the failed event, fix the missing permission or broken target, and redrive the event through a controlled process.

A practical runbook for the receipt DLQ includes four steps:

1. Check the EventBridge rule metrics, especially failed invocations, throttled rules, and latency.
2. Inspect a DLQ message and identify whether the failure is permission, missing target, throttling, or target application error.
3. Fix the target or permission problem before replaying messages.
4. Redrive in small batches and make the receipt worker idempotent so a duplicated receipt job still sends one customer email.

A DLQ and an archive answer different operational questions. A DLQ stores failed deliveries for a target. An archive stores selected events from a bus so you can replay them later. Production systems often use both. The DLQ asks, "Which deliveries failed?" The archive asks, "Can I reprocess events from a time window?"

## Archives and Replay
<!-- section-summary: Archives keep selected bus events, and replay sends a historical time window back through the original bus. -->

An **archive** stores events from one event bus according to an event pattern and a retention period. A **replay** sends archived events back to the original source event bus. This is useful when a consumer had a bug, a new consumer needs historical events, or a team wants to validate a new rule against real production-shaped data.

At Northstar Learn, analytics shipped a bug that ignored `PaymentCaptured` events for two hours. The payment service published the events correctly. The bus routed them correctly. The analytics target accepted them but wrote bad records. After the analytics team fixes the bug, they can replay `PaymentCaptured` events from the affected time window and let the corrected consumer rebuild its state.

An archive can filter the events it stores:

```json
{
  "source": ["com.northstar.payments"],
  "detail-type": ["PaymentCaptured", "RefundIssued"]
}
```

That filter keeps the archive focused on finance events instead of storing every order-domain event forever. The team also chooses a retention period. Infinite retention may be useful for a small critical stream, but it has cost and privacy implications. Many teams choose a retention window tied to operational recovery needs, such as 7, 30, or 90 days.

Replay needs careful handling because it sends events through the bus again. Existing rules can match replayed events. Targets can process old facts again. EventBridge adds a `replay-name` metadata field to replayed events, so consumers and rules can identify replay traffic when they need to. Some teams create a replay-specific rule, while others let normal rules process replayed events because every consumer is already idempotent.

Before a replay, the team should answer three questions. Which time window is safe? Which rules should receive the replay? Which consumers can handle duplicates? If the answer to the third question is unclear, fix idempotency before replaying production events.

## Cross-Account Routing
<!-- section-summary: Cross-account routing lets producer and consumer teams keep separate AWS accounts while sharing selected events through bus policies and rules. -->

Many AWS organizations separate workloads into accounts. Northstar Learn has a `prod-orders` account, a `prod-analytics` account, and a `prod-security` account. Checkout can share facts with analytics without direct permission to write into analytics databases. Analytics can receive those facts without broad access to the orders account. EventBridge can route selected events across account boundaries.

Cross-account routing uses two sides. The receiving account grants permission on its event bus with a resource-based policy. The sending account creates a rule whose target is the receiver's event bus. For newer cross-account event bus targets, the sending side also uses an IAM role for the target. The receiver then creates its own rules on its bus to route incoming events to local targets.

Here is a simplified receiver-side bus policy for the analytics account. It allows the orders account to put events on the analytics ingress bus:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowOrdersAccountEvents",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111122223333:root"
      },
      "Action": "events:PutEvents",
      "Resource": "arn:aws:events:us-east-1:444455556666:event-bus/analytics-ingress-prod",
      "Condition": {
        "StringEquals": {
          "events:source": "com.northstar.payments"
        }
      }
    }
  ]
}
```

The sender-side rule in the orders account can match payment events and target the analytics bus ARN. The analytics account then owns the downstream rules that write to its warehouse or stream processor. That ownership boundary is the reason cross-account routing is powerful. Producers share facts. Consumers manage their own subscriptions and targets.

For larger organizations, the receiver can grant access to an AWS Organizations organization ID instead of one account at a time. That can reduce policy maintenance, but it raises the importance of event patterns. If a bus accepts events from many accounts, receiver-side rules should match the `account` field, `source`, and `detail-type` intentionally so only expected accounts trigger sensitive targets.

Cross-account routing still needs governance. Teams need naming conventions, schema expectations, cost ownership, and alarms. EventBridge charges custom events to the sending account for cross-account delivery, so producer teams should know which high-volume events they route out.

## Pipes, Scheduled Rules, and Scheduler
<!-- section-summary: EventBridge includes buses for many-to-many routing, Pipes for point-to-point movement, and Scheduler for time-based invocation. -->

EventBridge now has three related shapes that are easy to mix together: event buses, Pipes, and Scheduler. They all move work based on events or time, but they solve different jobs.

**Event buses** handle many-to-many routing. Many sources can publish to a bus, and many rules can route matching events to many targets. The Northstar order bus is a bus problem because receipt, analytics, fraud, finance, and future consumers may all care about the same facts.

**EventBridge Pipes** handle point-to-point movement from one source to one target, with optional filtering and enrichment in the middle. A pipe can read from supported sources such as SQS, DynamoDB Streams, Kinesis, or Amazon MQ, filter records, optionally enrich them, and send them to a target. This is useful when the integration is clearly one source to one destination.

For example, Northstar Learn might have a DynamoDB stream for enrollment table changes. A pipe can filter only new enrollment records, call a Lambda enrichment step to add course metadata, and send the result to an SQS queue for certificate generation. A pipe fits that path without introducing a shared event bus, unless other teams also need the same enrollment facts.

**Scheduled rules** are the older EventBridge way to run a rule on a rate or cron expression. AWS now recommends **EventBridge Scheduler** for scheduled work. Scheduler supports one-time schedules, recurring rate and cron schedules, time zones, flexible time windows, retry settings, DLQs, and a wider set of target API operations.

Northstar's nightly finance reconciliation starts from time rather than from an order fact, so it fits Scheduler. It runs at 02:00 in a chosen time zone and invokes a target that starts reconciliation. If that target is an EventBridge `PutEvents` call, the scheduled payload might publish a `FinanceReconciliationRequested` event to the order bus:

```json
{
  "source": "com.northstar.finance",
  "detail-type": "FinanceReconciliationRequested",
  "detail": {
    "eventId": "evt-01JXG1QBSXQA5SZEJAZGWC02S2",
    "businessDate": "2026-06-12",
    "reason": "nightly-close"
  }
}
```

The decision is simple enough for most systems. An event bus fits facts that many consumers may react to. A pipe fits one source that needs a managed path to one target with filtering or enrichment. Scheduler fits work created by time.

## Idempotency and Ordering
<!-- section-summary: EventBridge consumers should handle duplicate delivery, replayed events, and arbitrary ordering. -->

EventBridge delivery favors durability and retries, so consumers need **idempotency**. An idempotent consumer can process the same event more than once and still produce the correct final result. This matters after target retries, publisher retries, DLQ redrives, and archive replays.

Northstar's receipt service should send one receipt even if it sees the same `OrderCreated` event twice. A common pattern is to store a processed-event record keyed by `eventId` and consumer name before or during the side effect. For receipt email, the key might be `receipt-service#evt-01JXG0NS2ZP6V6MMJ18B8SW96P`. If the worker sees that key again, it skips the email and records that the duplicate was ignored.

```json
{
  "pk": "receipt-service#evt-01JXG0NS2ZP6V6MMJ18B8SW96P",
  "orderId": "order-1042",
  "status": "processed",
  "processedAt": "2026-06-13T09:15:08Z",
  "ttl": 1791815708
}
```

Some consumers should use a business key instead of an event ID. Analytics may count revenue by `paymentId` so a replayed `PaymentCaptured` event updates the same row instead of adding another sale. Fraud may store a review record keyed by `orderId` and review type. The correct idempotency key depends on the side effect.

Ordering needs the same planning. Event bus targets can receive messages in arbitrary order. A consumer may see `PaymentCaptured` before it sees `OrderCreated`, especially when events come from different sources, rules, retries, or replays. Consumers should use event timestamps, version numbers, or state lookups when order matters.

In Northstar Learn, the fulfillment service treats arrival order as unreliable. It can fetch the current order state by `orderId` before unlocking the course. If the current state is still waiting for payment, it can park the work in SQS, retry later, or wait for a more specific event such as `CourseAccessGranted`.

When strict ordering is the core requirement, SQS FIFO queues and SNS FIFO topics are the natural AWS choices for ordered message groups. Some teams also use Kinesis when they need ordered processing per partition key and streaming-style consumers. EventBridge can still announce facts broadly, while the ordered part of the workflow uses a service designed for ordering.

## When SNS or SQS Is Better
<!-- section-summary: EventBridge routes facts by pattern, SNS fans messages out quickly, and SQS gives one or more workers a durable pull queue. -->

EventBridge, SNS, and SQS all decouple systems, but they do it with different shapes.

**EventBridge** is best when events need rich routing. It matches JSON patterns, receives AWS service events, receives SaaS partner events, supports custom buses, routes across accounts, transforms target input, archives and replays events, and can send the same fact to different kinds of targets. Northstar uses EventBridge for domain facts because future consumers are expected.

**Amazon SNS** is best when one publisher needs push fan-out to subscribers with simpler filtering. SNS topics are especially common for notifications, mobile push, SMS/email integrations, and high-throughput pub/sub where subscribers receive pushed messages. SNS FIFO topics can also provide ordered fan-out with deduplication within FIFO constraints.

**Amazon SQS** is best when work should wait for workers to pull it. A queue gives consumers backpressure, visibility timeouts, redrive policies, and a clear buffer between producer and worker. Northstar uses SQS behind the receipt service because email sending can slow down, retry, and scale independently. SQS FIFO queues are the better fit when one worker group needs ordered processing by message group.

Here is the practical choice table:

| Need | Usually choose | Why |
| --- | --- | --- |
| Many teams may react to a business fact | EventBridge | Pattern matching, many target types, cross-account routing, archives, replay |
| One event should push to many subscribers with simple topic semantics | SNS | Push pub/sub with topic subscriptions and high fan-out |
| One worker fleet should process jobs at its own speed | SQS | Pull-based buffering, visibility timeout, worker backpressure |
| Strict first-in-first-out processing by key | SQS FIFO or SNS FIFO | FIFO ordering and deduplication features |
| AWS service or SaaS events need routing into your account | EventBridge | Native AWS service events and partner event buses |

These services also combine well. EventBridge can route `OrderCreated` to an SQS queue for receipt processing. It can route `PaymentCaptured` to an SNS topic for a notification fan-out. The question is which service should own the first integration boundary. For Northstar's domain facts, EventBridge owns routing. For receipt work, SQS owns worker pacing. For notification fan-out, SNS can own subscriber delivery.

## Putting It All Together
<!-- section-summary: A production EventBridge setup has clear event names, owned buses, precise rules, target failure handling, replay plans, and idempotent consumers. -->

Northstar Learn's final setup has a few clear pieces. Checkout and payment services publish past-tense facts such as `OrderCreated`, `PaymentCaptured`, and `RefundIssued`. The publisher keeps those facts aligned with the source database through an outbox or stream-based publisher. Each event includes stable business IDs and an idempotency key that consumers can store.

The order platform owns a custom `northstar-orders-prod` event bus. AWS service events stay on the default bus unless the team has a reason to forward them. SaaS partner events use partner buses. The custom bus has clear permissions, tags, metrics, and an archive for the events the team may need to replay.

Consumer teams own rules with precise event patterns. Receipt matches `OrderCreated`. Fraud matches high-value `PaymentCaptured`. Finance matches `PaymentCaptured` and `RefundIssued`. Each rule has one target so retry policy, DLQ, permissions, and input shape can change independently.

Targets receive the shape they need. Some targets get the original event. Some get a small transformed payload. SQS queues sit behind slow worker systems. Cross-account routing sends selected facts to analytics and security accounts without giving those accounts broad access to the producer account.

Operations are part of the design. Publishers check every `PutEvents` response entry. Rules have CloudWatch metrics and alarms. Target DLQs preserve failed deliveries. Archives support controlled replay. Consumers use idempotency keys and avoid assuming event order.

That is EventBridge in production: publish truthful facts, route them with precise rules, handle delivery as an operational workflow, and choose SNS or SQS when their communication shape fits the problem better.

## What's Next

EventBridge gives facts a routing surface. The next article moves into workflows with Step Functions. That is the right place when the business process has known steps, waits, retries, branches, human approval, and execution history that operators need to inspect.

---

**References**

- [What Is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html) - Defines EventBridge as a serverless event service for event-driven applications.
- [Event bus concepts in Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is-how-it-works-concepts.html) - Explains events, sources, event buses, rules, schedules, targets, and advanced bus features.
- [Event buses in Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html) - Describes event buses as routers from many sources to many targets.
- [AWS service event metadata](https://docs.aws.amazon.com/eventbridge/latest/ref/events-structure.html) - Lists common event envelope fields such as `id`, `source`, `detail-type`, `account`, `region`, `resources`, and `detail`.
- [Sending events with PutEvents in Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-putevents.html) - Documents `PutEvents`, response entries, batching, and request size behavior.
- [Creating Amazon EventBridge event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html) - Explains how rules match events by source, metadata, and `detail` values.
- [Event bus targets in Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-targets.html) - Lists target types and target configuration behavior.
- [Amazon EventBridge input transformation](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-transform-target-input.html) - Documents input paths, input templates, and target payload transformation.
- [How EventBridge retries delivering events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html) - Documents retry policy behavior, including default retry duration and attempt count.
- [Using dead-letter queues to process undelivered events in EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html) - Explains EventBridge target DLQs and SQS queue requirements.
- [Archiving and replaying events in Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html) - Documents archives, retention, replay behavior, and replay metadata.
- [Sending and receiving events between AWS accounts in Amazon EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-cross-account.html) - Explains cross-account event bus routing and receiver/sender setup.
- [Amazon EventBridge Pipes](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes.html) - Explains Pipes sources, filtering, enrichment, and targets.
- [Amazon EventBridge Scheduler](https://docs.aws.amazon.com/eventbridge/latest/userguide/using-eventbridge-scheduler.html) - Describes Scheduler, schedule types, retry settings, DLQs, and target invocation.
- [Amazon SQS, Amazon SNS, or EventBridge?](https://docs.aws.amazon.com/decision-guides/latest/sns-or-sqs-or-eventbridge/sns-or-sqs-or-eventbridge.html) - Compares communication model, filtering, ordering, persistence, and use cases.
