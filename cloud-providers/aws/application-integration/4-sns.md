---
title: "Amazon SNS"
description: "Learn how SNS lets one publisher fan a message out to independently configured subscribers through topics, filters, delivery policies, and queues."
overview: "Build a first-principles model of publishers, topics, subscriptions, endpoints, filtering, raw delivery, retry boundaries, dead-letter queues, and SNS-to-SQS fanout."
tags: ["aws", "sns", "pub-sub", "fanout", "application-integration"]
order: 4
id: article-cloud-providers-aws-application-integration-sns
aliases:
  - sns
  - amazon-sns
  - pub-sub-topics
  - 4-sns
  - cloud-providers/aws/application-integration/sns.md
  - cloud-providers/aws/application-integration/4-sns.md
---

## Table of Contents

1. [Why Does One Event Need a Fanout Service?](#why-does-one-event-need-a-fanout-service)
2. [What Are Publishers, Topics, Subscriptions, and Endpoints?](#what-are-publishers-topics-subscriptions-and-endpoints)
3. [How Do Subscription Filters Choose Messages?](#how-do-subscription-filters-choose-messages)
4. [What Does an SQS Subscriber Actually Receive?](#what-does-an-sqs-subscriber-actually-receive)
5. [How Do SNS Retries and Dead-Letter Queues Work?](#how-do-sns-retries-and-dead-letter-queues-work)
6. [How Do SNS, SQS, and EventBridge Differ?](#how-do-sns-sqs-and-eventbridge-differ)
7. [How Do You Build a Complete SNS Fanout Path?](#how-do-you-build-a-complete-sns-fanout-path)
8. [How Do You Design with SNS?](#how-do-you-design-with-sns)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Amazon Simple Notification Service does not execute application business logic. It lets independently deployed parts of a system communicate without the publisher directly knowing every receiver. Its core question is: **One thing happened; how do I tell many interested systems efficiently?**

Imagine a learning platform in which publishing a lesson must notify email, analytics, and search indexing:

```text
Lesson service
  ├── Email service
  ├── Analytics service
  └── Search service
```

The first implementation can save the lesson and call all three services. It appears simple, but the producer now knows that each consumer exists. Six months later, recommendations, audit, mobile push, and a data warehouse may also need the same fact. Every addition requires producer code or configuration changes.

This is the **fanout problem**. One fact—`Lesson 123 was published`—must produce several independent deliveries. An intermediary lets the lesson service publish once without owning every consumer's delivery path.

Keep these questions in view as you work through the lesson:

1. **Why Does One Event Need a Fanout Service?**
2. **What Are Publishers, Topics, Subscriptions, and Endpoints?**
3. **How Do Subscription Filters Choose Messages?**
4. **What Does an SQS Subscriber Actually Receive?**
5. **How Do SNS Retries and Dead-Letter Queues Work?**
6. **How Do SNS, SQS, and EventBridge Differ?**
7. **How Do You Build a Complete SNS Fanout Path?**
8. **How Do You Design with SNS?**

## Why Does One Event Need a Fanout Service?
<!-- section-summary: SNS removes the producer's need to know, call, retry, and reconfigure every system that cares about one publication. -->

- Know every consumer and its location
- Speak each consumer's delivery mechanism
- Retry consumer failures
- Wait for or otherwise handle slow consumers
- Add and remove consumers from its own configuration
- Decide which consumers should receive which messages

Those are not facts the producer should necessarily own. Its domain knowledge is that a lesson was published. It should not have to know every team that cares.

Insert a publish-subscribe intermediary:

```text
                    +--> Email
Lesson service -> SNS -> Analytics
                    +--> Search
                    +--> Audit
```

The producer publishes once. Independently configured subscriptions determine the deliveries. This gives the system **loose coupling**: adding a subscriber does not require changing the publisher.

AWS calls SNS a managed pub/sub service for decoupled applications. The first-principles value is not merely message copying. It is the transfer of recipient knowledge away from the producer.

## What Are Publishers, Topics, Subscriptions, and Endpoints?
<!-- section-summary: The publisher announces through a topic, each subscription stores one receiver's delivery policy, and an endpoint receives an independent copy. -->

The basic SNS model is:

```text
Publisher -> Topic -> Subscription -> Endpoint
```

### A publisher announces the message

The publisher can be Lambda, EC2, ECS, another AWS service, a laptop, or an application outside AWS. It publishes to a topic:

```text
publish(
  topic = lesson-events,
  message = "Lesson 123 was published"
)
```

It does not send separate instructions to email, analytics, and search. The topic is the end of the publisher's recipient responsibility.

### A topic represents a category or channel

A topic can be named `lesson-events`, `order-events`, `payment-events`, or `system-alerts`. It has an ARN such as:

```text
arn:aws:sns:eu-west-1:123456789012:lesson-events
```

Think of a topic as an address for a category of publications. It is not primarily a worker backlog that applications poll later. Standard topics route and push each incoming publication to currently configured matching subscriptions.

### An endpoint is the receiver

SNS supports endpoint types that include SQS queues, Lambda functions, HTTP/S endpoints, email, SMS, and mobile push. Backend architectures frequently use SQS endpoints because each consumer system then receives its own durable buffer.

### A subscription owns the relationship

The relationship between a topic and endpoint needs its own configuration:

```text
lesson-events
  ├── subscription A
  |     endpoint = email queue
  |     filter = premium lessons
  |     raw delivery = true
  |
  └── subscription B
        endpoint = analytics queue
        filter = all lessons
```

Destination, filtering, raw delivery, delivery and retry settings, and delivery DLQ configuration belong to subscriptions. Two endpoints attached to the same topic can therefore have different interests and failure handling.

The hierarchy is:

```text
Topic
  ├── Subscription -> Endpoint
  ├── Subscription -> Endpoint
  └── Subscription -> Endpoint
```

### SNS creates independent copies

If three queues subscribe to a topic, one publication becomes three deliveries:

```text
                SNS
              /  |  \
             v   v   v
          copy copy copy
             |   |   |
           Email Analytics Search
```

Each subscription is evaluated independently. One can receive the message while another is filtered out or experiences a delivery failure. This is the mental model worth retaining: **SNS converts one publication into zero, one, or many independently configured deliveries.**

### How Does SNS Work with SQS?
<!-- section-summary: SNS owns fanout between systems, while each SQS queue owns buffering and competing work distribution inside one consumer system. -->

SNS can invoke Lambda or an HTTP endpoint directly, but SQS adds a durable waiting place between the publication and consumer processing:

```text
                     SNS topic
                  /      |       \
                 v       v        v
             Email SQS Search SQS Analytics SQS
                 |       |        |
               workers workers  workers
```

SNS answers: **Who should receive an independent copy?** SQS answers: **When can this consumer group process its copy?**

If search is unavailable, its queue continues to accept deliveries and accumulates a backlog. Email and analytics proceed through their own queues. When search recovers, its workers catch up. This failure isolation is a major reason the `Producer -> SNS -> SQS -> Consumer` shape is common.

#### Create the topic, queues, and subscriptions

A small lesson system can begin with:

```bash
aws sns create-topic \
  --name lesson-events

aws sqs create-queue \
  --queue-name email-lessons

aws sqs create-queue \
  --queue-name analytics-lessons
```

SNS subscriptions use the queue ARN:

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:eu-west-1:123456789012:lesson-events \
  --protocol sqs \
  --notification-endpoint arn:aws:sqs:eu-west-1:123456789012:email-lessons
```

The publisher can then send one message:

```bash
aws sns publish \
  --topic-arn arn:aws:sns:eu-west-1:123456789012:lesson-events \
  --message '{
    "event":"lesson.published",
    "lessonId":"L123",
    "title":"SNS from First Principles"
  }'
```

It does not name either queue. SNS discovers matching subscriptions and attempts a copy for each.

#### Subscription and queue permission are separate

Creating a subscription means, "SNS should deliver here." It does not automatically mean, "the queue authorizes this topic to send."

The SQS resource policy must allow the SNS service to call `sqs:SendMessage` and should restrict the permitted source topic:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Service": "sns.amazonaws.com"
  },
  "Action": "sqs:SendMessage",
  "Resource": "arn:aws:sqs:eu-west-1:123456789012:email-lessons",
  "Condition": {
    "ArnEquals": {
      "aws:SourceArn": "arn:aws:sns:eu-west-1:123456789012:lesson-events"
    }
  }
}
```

Keep the responsibilities distinct:

```text
Subscription = configure the destination relationship.
Queue policy = permit the selected topic to deliver.
```

#### Multiple subscriptions copy; multiple queue consumers compete

Three SQS endpoints subscribed to SNS each receive their own copy. Three workers polling one of those queues normally compete to process that one queued copy.

```text
SNS subscriptions: one publication -> many copies
SQS consumers:     one queued copy -> one processing path
```

This is why one shared queue is not a fanout design for three independent applications. The workers would divide messages instead of each application seeing every event.

## How Do Subscription Filters Choose Messages?
<!-- section-summary: Per-subscription filter policies let each receiver declare its interest before SNS attempts delivery. -->

Suppose the published body describes a lesson, while message attributes classify it:

```text
Body:
{
  "lessonId": "L123",
  "title": "SNS from First Principles"
}

Attributes:
eventType = lesson.published
level     = advanced
audience  = pro
```

SNS message attributes support types including `String`, `String.Array`, `Number`, and `Binary`. They are metadata that can help a subscription decide whether a delivery is relevant.

Without filtering, every consumer receives every message and discards irrelevant data itself:

```text
SNS -> Email consumer -> beginner? process : discard
```

With a subscription filter, the decision moves before delivery:

```text
SNS -> filter level=beginner -> Email queue
```

A filter policy can be:

```json
{
  "level": ["beginner"]
}
```

Filtering is configured per subscription. Analytics can have no filter and receive everything. Advanced email can match `level=advanced`. A French index can match `language=fr`.

For a publication with `level=advanced` and `language=en`:

```text
Analytics, no filter       -> delivery
Advanced email             -> delivery
French index               -> no delivery
```

SNS can evaluate attributes or fields from a JSON message body depending on `FilterPolicyScope`. Filter policies support more than exact equality, including numeric matching, prefixes, suffixes, and `anything-but` conditions.

Filtering moves routing logic out of each consumer, but the contract still needs ownership. Producers and subscribers must agree on attribute names, types, body shape, and schema evolution. A misspelled attribute can make a healthy subscription receive nothing.

## What Does an SQS Subscriber Actually Receive?
<!-- section-summary: Default SQS delivery wraps the publication in an SNS notification envelope, while raw delivery places the original payload more directly in the queue body. -->

Suppose the publisher sends:

```json
{
  "lessonId": "L123"
}
```

With normal SNS-to-SQS delivery, the queue body contains an SNS notification envelope rather than only that object:

```json
{
  "Type": "Notification",
  "MessageId": "...",
  "TopicArn": "...",
  "Message": "{\"lessonId\":\"L123\"}",
  "Timestamp": "..."
}
```

The consumer parses two layers:

```text
SQS body -> SNS envelope -> Message string -> application JSON
```

The envelope carries SNS delivery metadata, which can be useful when the consumer wants topic, message, or signature context.

### Raw message delivery removes the wrapper

When `RawMessageDelivery` is enabled on an SQS subscription, the queue body contains the published payload more directly:

```text
Default: SQS body -> SNS envelope -> application payload
Raw:     SQS body -----------------> application payload
```

This is often simpler for backend SQS consumers with a well-defined application envelope of their own. Raw delivery is a subscription setting, so other subscribers can retain normal SNS formatting.

For SQS subscriptions with raw delivery enabled, SNS supports up to ten message attributes on the delivered message. The contract should account for that limit if attributes carry routing or processing metadata.

## How Do SNS Retries and Dead-Letter Queues Work?
<!-- section-summary: SNS retries temporary endpoint delivery failures, and subscription DLQs capture transport failures separately from downstream SQS consumer failures. -->

A delivery can fail because an endpoint was deleted, permissions changed, a service was unavailable, or another endpoint-specific error occurred. SNS applies delivery retries. The policy differs by endpoint protocol: AWS-managed endpoints and HTTP/S endpoints do not necessarily use the same schedule, and HTTP/S subscriptions can support custom delivery policies.

The first-principles purpose is stable: SNS attempts to recover temporary delivery failures instead of dropping a message after one unsuccessful request.

### An SNS dead-letter queue belongs to one subscription

Retries cannot continue forever. An SNS subscription can use an SQS queue as its DLQ:

```text
SNS topic
   |
subscription
   ├── successful delivery -> endpoint
   └── exhausted failure --> subscription DLQ
```

The DLQ is configured per subscription because failure is per destination. Email and analytics can receive a publication while search delivery fails. Only the unsuccessful subscription needs to preserve its undelivered copy.

### Delivery failure and processing failure are different boundaries

For `SNS -> Main SQS -> Worker`, two independent things can fail.

**Boundary 1: SNS cannot deliver to the queue.** The subscription is mispermitted, the queue is unavailable, or another delivery failure occurs. Use the SNS subscription DLQ.

```text
SNS subscription --X--> Main SQS
         |
         +--> SNS subscription DLQ
```

**Boundary 2: The queue received the message, but the worker cannot process it.** SNS finished its responsibility successfully. Use the source queue's redrive policy and SQS DLQ.

```text
SNS -> Main SQS -> Worker fails repeatedly
           |
           +--> SQS processing DLQ
```

The complete path can therefore contain both:

```text
                                  processing failures
                                        |
SNS -> subscription -> Main SQS -> Worker
          |                 |
 delivery failure           +--> SQS DLQ
          |
          +--> SNS subscription DLQ
```

These DLQs protect different arrows and require different investigations. One asks why SNS could not put a copy into the queue. The other asks why application code could not complete work that the queue already held.

### Inspect the correct responsibility boundary

Use `ReceiveMessage` or queue metrics to confirm whether a copy reached SQS:

```bash
aws sqs receive-message \
  --queue-url <queue-url>
```

If the message is present, SNS delivery succeeded and the consumer path owns the next question. SNS can also publish delivery-status information to CloudWatch Logs for supported protocols such as SQS, Lambda, and HTTP.

```text
SNS metrics and delivery logs -> Did SNS deliver?
SQS metrics and consumer logs -> Did the application process it?
```

## How Do SNS, SQS, and EventBridge Differ?
<!-- section-summary: SQS buffers one work stream, SNS fans a publication through topic subscriptions, and EventBridge evaluates event patterns on a bus. -->

SNS is not normally a durable worker queue. SQS stores messages until consumers receive and acknowledge them. A consumer can start later and process the backlog. Standard SNS topics push an incoming publication toward currently configured subscriptions; applications do not normally poll the topic for yesterday's messages.

FIFO topics are a specific exception because they can optionally archive messages for up to 365 days and replay them. That refinement should not replace the base mental model of SNS as fanout.

### SQS asks who will process this work

```text
Producer -> Queue -> competing workers
```

One logical processing path handles each queued copy. Messages often sound like commands: resize this image, charge this card, or generate this report.

### SNS asks who needs an independent copy

```text
Publisher -> Topic -> subscriptions -> A, B, C
```

Several systems receive the same announcement. Messages often sound like facts: `OrderPlaced`, `UserRegistered`, or `LessonPublished`.

### EventBridge asks which event rules match

```text
Sources -> Event bus -> rules inspect source, type, and detail -> targets
```

SNS is organized around a topic and its subscriptions, with per-subscription filters. EventBridge is organized around an event bus and pattern-matching rules across events from applications, AWS services, and SaaS sources.

A practical comparison is:

| Question | SQS | SNS | EventBridge |
| --- | --- | --- | --- |
| Primary abstraction | Queue | Topic | Event bus |
| Main job | Buffer work | Fan out publications | Route events |
| Consumer style | Pull or managed polling | Push to subscriptions | Rules deliver to targets |
| One input to many systems | Not alone | Core strength | Supported through matching rules |
| Durable worker backlog | Core strength | Not the standard topic model | Not its main job |
| Filtering | Minimal | Per-subscription policies | Event patterns central to service |
| Ordering option | FIFO queue | FIFO topic | Usually not the selection reason |

The services compose. SNS can fan out to several SQS queues. EventBridge can route to SQS. The design remains clear when each service owns one responsibility.

### When Do Standard and FIFO Topics Matter?
<!-- section-summary: Standard topics provide high-scale, best-effort pub/sub, while FIFO topics add ordered message groups, deduplication, and optional archive and replay. -->

Most introductory and general-purpose SNS fanout uses Standard topics. The model is high-scale publication, best-effort ordering, and possible duplicate delivery. Important consumers should tolerate duplicates where the protocol and side effects require it.

FIFO topics add ordering, message groups, and deduplication. A common strict-order path is:

```text
SNS FIFO topic -> SQS FIFO queue
```

Under the documented conditions, this can preserve ordering and deduplication through the fanout path. FIFO topics can also deliver to Standard queues when a particular subscriber does not require those guarantees.

Message groups let unrelated entity streams progress separately rather than forcing every publication through one global sequence. The group should match the entity whose events require order.

FIFO topics can optionally archive messages for up to 365 days and replay them. This is a specialized capability and an exception to the normal statement that SNS is not a replayable backlog.

Start from the requirement. Choose FIFO when ordered, deduplicated publication within groups is necessary. Do not choose it merely because the word "FIFO" sounds safer; ordering changes throughput and concurrency behavior, and downstream side effects should still be idempotent.

## How Do You Build a Complete SNS Fanout Path?
<!-- section-summary: A complete path combines one stable publication, per-subscription interest, authorized SQS delivery, independent buffering, consumer redrive, and separate delivery evidence. -->

Use a lesson publication with this body:

```json
{
  "event": "lesson.published",
  "lessonId": "L123",
  "title": "SNS from First Principles"
}
```

and these attributes:

```text
level    = advanced
language = en
```

Configure three subscriptions:

```text
Analytics queue: no filter
Email queue:     level = advanced
French index:    language = fr
```

The publisher performs one `Publish` to `lesson-events`. SNS evaluates each subscription independently. Analytics and advanced email match. French index does not. Two copies are delivered.

```text
                    Lesson service
                         |
                    publish once
                         v
                 SNS lesson-events
                 /       |        \
        no filter   level=advanced  language=fr
             |            |             X
             v            v
       Analytics SQS   Email SQS
             |            |
          workers       workers
```

The queue policies authorize this exact topic to send. Each consumer system owns its queue throughput, worker count, visibility timeout, idempotency, processing DLQ, and alarms.

For production resilience, each subscription can also use a delivery DLQ:

```text
SNS
 |
subscription
 ├── success -> Main SQS -> worker -> repeated failure -> SQS DLQ
 └── delivery exhausted ---------------------------> SNS delivery DLQ
```

This architecture produces several forms of independence:

- **Publisher autonomy:** it knows `lesson-events`, not every receiver.
- **Consumer autonomy:** a new analytics or recommendation subscription does not change the producer.
- **Failure isolation:** one queue or worker group can fail while others continue.
- **Independent scaling:** email can run three workers while search runs thirty and analytics one hundred.
- **Independent filtering:** each subscription owns its interest criteria.

### Follow one publication through the complete system

The lesson service begins with one domain fact rather than a list of instructions to consumers:

```text
LessonPublished
lessonId = L123
level = advanced
language = en
```

Its IAM identity needs permission to publish to `lesson-events`; it does not need `sqs:SendMessage` permission for every subscriber queue. The successful publish response means SNS accepted the publication. It does not mean email, search, and analytics have all completed their application work.

SNS enumerates the topic's subscriptions. For Analytics, no filter exists, so the publication is eligible. For Advanced Email, `level=advanced` matches. For French Search, `language=fr` does not match. A filtered-out delivery is not a failure and should not enter a DLQ; that subscription deliberately expressed no interest.

For each eligible SQS subscription, SNS attempts `SendMessage` under the queue's resource policy. The queue checks that the service principal is `sns.amazonaws.com` and that the source ARN is the allowed `lesson-events` topic. This source condition prevents an unrelated topic from using the same broad service principal to place messages in the queue.

After both queues accept their copies, the delivery layer is complete:

```text
SNS accepted publication
  ├── Analytics SQS accepted copy
  ├── Email SQS accepted copy
  └── French Search intentionally filtered out
```

Analytics and email then proceed independently. Each queue can have several competing workers, but only one processing path should handle a given queued copy at a time. If email is slow, its backlog and oldest-message age grow while analytics continues. That delay does not cause SNS to republish to analytics or block the lesson service.

### Decide whether direct delivery or a queue is appropriate

SNS can deliver directly to Lambda or HTTP/S, which can be useful when the receiver is fast, retry-safe, and designed for the endpoint's delivery behavior. The receiver then participates directly in the SNS delivery boundary.

Putting SQS between them changes that boundary:

```text
Direct:
SNS -> receiver must accept this delivery now or rely on SNS retry

Buffered:
SNS -> SQS accepts the copy now -> receiver processes at its own rate later
```

The queue adds its own retention, visibility timeout, worker scaling, and processing redrive. That is more infrastructure, but it gives a consumer control over backlog and recovery. The decision should follow the consumer's availability and rate requirements rather than a rule that every SNS endpoint must use SQS.

### Verify publication, delivery, and processing separately

An end-to-end symptom such as "the lesson email never arrived" spans several responsibilities. Inspect them in order:

1. Confirm that the lesson service called `Publish` successfully and record the SNS message ID or correlation ID.
2. Confirm that the email subscription exists, is confirmed where confirmation applies, and its filter matches the actual attributes or JSON body.
3. Confirm that the queue policy permits this exact topic ARN to call `sqs:SendMessage`.
4. Check SNS delivery status evidence and the subscription delivery DLQ for a transport failure.
5. Check the main queue for the expected copy. Presence proves the SNS-to-SQS step worked.
6. Inspect queue depth, message age, worker logs, visibility behavior, and the SQS processing DLQ.
7. Confirm the downstream email provider or application side effect using the same correlation identifier.

Do not use consumer logs alone to decide that publishing failed. A filter may have excluded the message, SNS may have exhausted delivery into its own subscription DLQ, the queue may contain an unprocessed backlog, or a worker may have moved the copy to its processing DLQ. The last confirmed boundary identifies the owner of the next investigation.

### Treat message contracts as shared interfaces

Loose deployment coupling does not mean a producer can change messages without coordination. A subscriber filter that expects a string attribute named `level` can silently stop matching if the producer renames it to `difficulty`, changes its type, or moves it into the body without updating `FilterPolicyScope`.

Likewise, a consumer configured for raw delivery expects its application payload directly, while a consumer using default delivery expects an SNS envelope whose `Message` field contains the payload string. Changing raw delivery changes the parsing contract even though the domain event did not change.

Version important payloads, document attributes used by filters, and test both matching and nonmatching examples. A useful publication carries a stable event name, unique message or event ID, occurrence time, correlation ID, and a body that contains only the data subscribers are meant to receive. Consumers should remain duplicate-safe because Standard topic delivery can repeat.

The publisher still owns a stable event contract. Decoupling deployment does not eliminate coordination around event meaning, schema versions, identifiers, sensitive fields, and compatibility.

## How Do You Design with SNS?
<!-- section-summary: Define the fact, its topic, every independent receiver, filtering and payload shape, buffering, permissions, and both delivery and processing failure paths. -->

Reduce an SNS design to four initial questions:

1. **What happened?** For example, `LessonPublished`.
2. **Where is that category published?** For example, `lesson-events`.
3. **Who requires an independent copy?** Email, analytics, search, or another system.
4. **What happens when a receiver cannot keep up?** Usually, place its SQS queue between the subscription and workers.

Then add the operational questions:

- Which body and message attributes form the versioned contract?
- Does each subscription filter attributes or JSON body fields?
- Does the endpoint want the SNS envelope or raw delivery?
- Does the endpoint authorize only the intended topic?
- Which SNS retry and subscription DLQ preserve delivery failures?
- Which SQS redrive policy and DLQ preserve processing failures?
- Which metrics or logs prove publication, delivery, queueing, and processing?
- Does ordering genuinely require an SNS FIFO and SQS FIFO path?

The service hierarchy can be remembered as increasing routing responsibility:

```text
SQS:
I have work that one processing path must eventually complete.

SNS:
Several independent systems need a copy of this publication.

EventBridge:
Many event sources need rules that decide which targets match.
```

The analogy is an announcement system. A professor announces that Lesson 42 is available. The professor does not visit every student, library, office, and analytics team. Subscribers register their interest, and each department can have its own mailbox.

```text
Professor             = publisher
Announcement channel  = topic
Interest relationship = subscription
Student or mailbox    = endpoint
Announcement          = message
```

The first-principles definition is: **SNS lets a producer announce something once while independently configured subscriptions decide whether, where, and how they receive a copy.** Topics, filters, raw delivery, retries, delivery DLQs, and SQS fanout are the machinery supporting that separation.

## Check Your Answers

:::expand[Why Does One Event Need a Fanout Service?]{kind="recap"}
SNS removes the producer's need to know, call, retry, and reconfigure every system that cares about one publication.

Without an intermediary, the producer knows and calls every consumer, handles their failures, and changes whenever a new receiver appears. SNS lets the producer publish the fact once while subscriptions own the receiver list.
:::

:::expand[What Are Publishers, Topics, Subscriptions, and Endpoints?]{kind="recap"}
The publisher announces through a topic, each subscription stores one receiver's delivery policy, and an endpoint receives an independent copy.

The publisher announces to a topic that represents a message category. Each subscription stores one receiver's endpoint, filter, formatting, and delivery policy. SNS evaluates those subscriptions and creates independent deliveries.

SNS owns fanout between systems, while each SQS queue owns buffering and competing work distribution inside one consumer system.

SNS fans one publication out to separate queues. Each SQS queue buffers one subscriber's copy and distributes it among that system's competing workers. The subscription configures delivery, while the queue policy authorizes the selected topic.
:::

:::expand[How Do Subscription Filters Choose Messages?]{kind="recap"}
Per-subscription filter policies let each receiver declare its interest before SNS attempts delivery.

Each subscription can match message attributes or JSON body fields. Filters can use exact, numeric, prefix, suffix, or exclusion conditions so irrelevant messages are not delivered to the endpoint and discarded there.
:::

:::expand[What Does an SQS Subscriber Actually Receive?]{kind="recap"}
Default SQS delivery wraps the publication in an SNS notification envelope, while raw delivery places the original payload more directly in the queue body.

Default delivery places the application message inside an SNS notification envelope in the SQS body. Raw delivery removes that wrapper and delivers the payload more directly, with a limit of ten delivered message attributes for raw SQS subscriptions.
:::

:::expand[How Do SNS Retries and Dead-Letter Queues Work?]{kind="recap"}
SNS retries temporary endpoint delivery failures, and subscription DLQs capture transport failures separately from downstream SQS consumer failures.

SNS retries temporary endpoint delivery failures. An SNS subscription DLQ captures messages that SNS could not deliver. Once SQS accepts a message, consumer failure belongs to the queue's redrive policy and SQS DLQ instead.
:::

:::expand[How Do SNS, SQS, and EventBridge Differ?]{kind="recap"}
SQS buffers one work stream, SNS fans a publication through topic subscriptions, and EventBridge evaluates event patterns on a bus.

SQS stores one work stream for competing consumers. SNS fans a topic publication to subscriptions. EventBridge applies rules to events on a bus. They are complementary and can be composed when routing, fanout, and buffering are all required.

Standard topics provide high-scale, best-effort pub/sub, while FIFO topics add ordered message groups, deduplication, and optional archive and replay.

Standard topics suit high-scale fanout with best-effort ordering and duplicate-safe consumers. FIFO topics add ordered message groups and deduplication, can pair with FIFO queues, and can optionally archive and replay messages for up to 365 days.
:::

:::expand[How Do You Build a Complete SNS Fanout Path?]{kind="recap"}
A complete path combines one stable publication, per-subscription interest, authorized SQS delivery, independent buffering, consumer redrive, and separate delivery evidence.

Publish one stable event, let filters select subscriptions, authorize the topic in each queue policy, buffer each copy in its own SQS queue, and give every delivery and processing boundary its own logs, metrics, retries, DLQ, and owner.
:::

:::expand[How Do You Design with SNS?]{kind="recap"}
Define the fact, its topic, every independent receiver, filtering and payload shape, buffering, permissions, and both delivery and processing failure paths.

Name the fact, topic, and independent receivers first. Then define filters, payload formatting, buffering, authorization, delivery recovery, processing recovery, and any real ordering requirement. The publisher should know what happened, not every system that cares.
:::

## References

- [AWS decision guide: Choosing an application integration service](https://docs.aws.amazon.com/decision-guides/latest/application-integration-on-aws-how-to-choose/application-integration-on-aws-how-to-choose.html)
- [AWS decision guide: Amazon SQS, SNS, or EventBridge](https://docs.aws.amazon.com/decision-guides/latest/sns-or-sqs-or-eventbridge/sns-or-sqs-or-eventbridge.html)
- [Amazon SNS documentation: Subscribe an SQS queue](https://docs.aws.amazon.com/sns/latest/dg/subscribe-sqs-queue-to-sns-topic.html)
- [Amazon SNS documentation: Message attributes](https://docs.aws.amazon.com/sns/latest/dg/sns-message-attributes.html)
- [Amazon SNS documentation: Message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html)
- [Amazon SNS documentation: Subscription filter policies](https://docs.aws.amazon.com/sns/latest/dg/sns-subscription-filter-policies.html)
- [Amazon SNS documentation: Raw message delivery](https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html)
- [Amazon SNS API reference: Subscribe](https://docs.aws.amazon.com/sns/latest/api/API_Subscribe.html)
- [Amazon SNS documentation: Delivery retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)
- [Amazon SNS documentation: Dead-letter queues](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html)
- [Amazon SNS documentation: Delivery status logging](https://docs.aws.amazon.com/sns/latest/dg/topics-attrib.html)
- [Amazon SNS documentation: FIFO message archiving and replay](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-archiving-replay.html)
- [AWS Prescriptive Guidance: Amazon EventBridge](https://docs.aws.amazon.com/prescriptive-guidance/latest/modernization-integrating-microservices/eventbridge.html)
- [Amazon SNS documentation: FIFO topic message ordering](https://docs.aws.amazon.com/sns/latest/dg/fifo-topic-message-ordering.html)
