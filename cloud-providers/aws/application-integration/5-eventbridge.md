---
title: "Amazon EventBridge"
description: "Learn how EventBridge routes facts from producers to targets through event buses, content-based rules, retries, dead-letter queues, archives, and cross-account boundaries."
overview: "Build a first-principles model of event-driven decoupling, event envelopes, buses, patterns, targets, delivery reliability, replay, SaaS integration, and EventBridge with SQS."
tags: ["aws", "eventbridge", "event-driven", "event-bus", "application-integration"]
order: 5
id: article-cloud-providers-aws-application-integration-event-driven-architecture
aliases:
  - event-driven-architecture
  - 3-event-driven-architecture
  - eventbridge
  - 5-eventbridge
  - amazon-eventbridge
  - cloud-providers/aws/application-integration/eventbridge.md
  - cloud-providers/aws/application-integration/3-event-driven-architecture.md
  - cloud-providers/aws/application-integration/5-eventbridge.md
---

## Table of Contents

1. [Why Do Applications Need an Event Router?](#why-do-applications-need-an-event-router)
2. [What Is the Difference Between an Event and a Command?](#what-is-the-difference-between-an-event-and-a-command)
3. [What Does an EventBridge Event Look Like?](#what-does-an-eventbridge-event-look-like)
4. [How Do Applications Publish and Match Events?](#how-do-applications-publish-and-match-events)
5. [How Do Archives and Replay Differ from Retries and DLQs?](#how-do-archives-and-replay-differ-from-retries-and-dlqs)
6. [How Does EventBridge Cross Accounts and SaaS Boundaries?](#how-does-eventbridge-cross-accounts-and-saas-boundaries)
7. [How Do You Build a Complete EventBridge Architecture?](#how-do-you-build-a-complete-eventbridge-architecture)
8. [How Should You Design Event Contracts?](#how-should-you-design-event-contracts)
9. [References](#references)

Amazon EventBridge starts from one distributed-systems question: **Something happened in one part of the system. How do other parts that care find out without the producer knowing who they are?** It answers with a managed event router. Producers publish facts to an event bus, rules independently match those facts, and matching events are delivered to targets.

The sections below answer these questions in order:

1. **Why Do Applications Need an Event Router?**
2. **What Is the Difference Between an Event and a Command?**
3. **What Does an EventBridge Event Look Like?**
4. **How Do Applications Publish and Match Events?**
5. **How Do Archives and Replay Differ from Retries and DLQs?**
6. **How Does EventBridge Cross Accounts and SaaS Boundaries?**
7. **How Do You Build a Complete EventBridge Architecture?**
8. **How Should You Design Event Contracts?**

## Why Do Applications Need an Event Router?
<!-- section-summary: EventBridge moves consumer knowledge and content-based routing out of the producer, reducing knowledge and temporal coupling. -->

Imagine an online store where placing an order must affect payment, inventory, email, fraud, and analytics:

```text
Order service
  ├── Payment service
  ├── Inventory service
  ├── Email service
  ├── Fraud service
  └── Analytics service
```

The order application can directly call all five. At first, that is easy to read. It also creates two forms of coupling.

**Knowledge coupling** means the order service knows every consumer, how to contact it, and often how to respond to its failures. Adding a recommendation or compliance consumer requires changing producer code or configuration.

**Temporal coupling** means downstream services may need to be available while the producer is completing its operation. A slow or unavailable nonessential consumer can delay order placement.

The stable domain fact is simpler:

```text
Order 7821 was placed.
```

The order service does not necessarily need to decide everything that happens because of that fact. Other systems can independently decide whether they care.

An SNS topic is one way to decouple the producer and fan a publication out. This works well when the organizing question is, "Who subscribes to this topic?" SNS subscriptions can also filter messages.

As a system grows, however, it may produce many event types—orders, payments, shipments, customers, refunds, file uploads, and AWS service state changes. Consumers may want combinations such as:

```text
Fraud:          OrderPlaced where total >= 1000
Rewards:        OrderPlaced where customerTier = gold
Operations:     PaymentFailed
Analytics:      every commerce event
Security:       selected security-sensitive events
```

The central problem is now content-based routing rather than simple topic fanout. Introduce a neutral event bus and predicates:

```text
Order service -----+
Payment service ---+-> EVENT BUS -> rules -> targets
AWS services ------+
SaaS source -------+
```

Conceptually:

```text
for each event E on bus B:
  for each rule R attached to B:
    if R.pattern matches E:
      deliver E to R's target
```

That is the core of EventBridge. A single event can match several rules or none. The producer publishes once; later routing is independently configured.

## What Is the Difference Between an Event and a Command?
<!-- section-summary: An event states an immutable past fact, while a command asks a particular action to occur. -->

An event says that something already happened. Good names are commonly past tense:

```text
OrderPlaced
PaymentCompleted
PaymentFailed
InventoryReserved
CustomerRegistered
FileUploaded
EC2InstanceStopped
```

Commands such as `ChargeCustomer`, `SendEmail`, and `ReserveInventory` have a different meaning: someone should perform this action.

Compare:

```text
Command: Charge the customer for order 7821.
Event:   Order 7821 was placed.
```

An order event can contain:

```json
{
  "type": "OrderPlaced",
  "orderId": "7821",
  "customerId": "C42",
  "total": 125.00
}
```

The producer is not directly instructing payment, fraud, analytics, and email. Each consumer assigns its own meaning to the fact:

```text
OrderPlaced
  ├── Payment decides to begin payment work
  ├── Fraud decides to inspect the order
  └── Analytics decides to record the sale
```

This inversion of responsibility is central to event-driven design. The producer owns the truth of what happened. Consumers own their reactions.

An event shaped as `TellPaymentServiceToProcessOrder` leaks today's orchestration and destination into the contract. `OrderPlaced` remains useful to consumers that do not exist yet. Loose coupling comes from publishing durable domain reality rather than a hidden list of commands.

Events do not eliminate all coordination. Producers and consumers must agree on event meaning, schema, identifiers, compatibility, sensitivity, and whether a later update or correction creates a new event. The decoupling is about deployment and routing knowledge, not the absence of contracts.

### How Do Event Buses, Rules, and Targets Work?
<!-- section-summary: The bus receives events, each rule asks whether an event matches, and a target receives the selected event or transformed input. -->

Three concepts explain most of EventBridge:

| Concept | First-principles meaning |
| --- | --- |
| Event bus | The boundary where events arrive |
| Rule | A predicate that asks whether this event is relevant |
| Target | The destination for a matching event |

Suppose this event arrives:

```json
{
  "source": "com.shop.orders",
  "detail-type": "Order Placed",
  "detail": {
    "orderId": "7821",
    "total": 1250,
    "customerTier": "gold"
  }
}
```

Three rules can evaluate it independently:

```text
Rule A: source=com.shop.orders and type=Order Placed -> match
Rule B: detail.total >= 1000                         -> match
Rule C: detail-type=Order Cancelled                  -> no match
```

The event can therefore go to both a payment queue and fraud workflow. The cancellation target receives nothing.

#### A bus is a routing domain, not a queue

An event bus routes. If no rule matches, no target action occurs. Events do not sit on the bus waiting for a future consumer as SQS messages do. Historical retention requires an archive configured for that purpose.

This is why EventBridge and SQS are commonly composed:

```text
Producer -> EventBridge -> matching rule -> SQS -> workers
```

EventBridge decides where the fact belongs. SQS lets that consumer process the routed copy at its own rate.

#### Targets can be different AWS or external capabilities

Targets include Lambda, SQS, SNS, Step Functions, Kinesis, API Gateway, another event bus, and API destinations, among others. EventBridge must have the correct permission to invoke or write to each target.

An input transformer can reduce or reshape the original event for one target. A full order event might contain customer, currency, warehouse, and total fields, while a fraud target needs only:

```json
{
  "orderId": "7821",
  "amount": 1250
}
```

One rule can have several targets, but the source guidance recommends one target per rule when practical so each consumer's pattern, permission, transformation, retry, and failure handling can evolve independently.

## What Does an EventBridge Event Look Like?
<!-- section-summary: The standard envelope separates routing and provenance metadata from producer-specific domain detail. -->

An EventBridge event uses an envelope like this:

```json
{
  "version": "0",
  "id": "event-id",
  "detail-type": "Order Placed",
  "source": "com.shop.orders",
  "account": "123456789012",
  "time": "2026-08-23T12:00:00Z",
  "region": "eu-west-2",
  "resources": [],
  "detail": {
    "orderId": "7821",
    "customerId": "C42",
    "total": 125
  }
}
```

Think of it as two layers:

```text
Routing and provenance:
source, detail-type, account, region, time, resources

Domain data:
detail { ... }
```

AWS service events use the same general envelope while `detail` varies by producing service. For application events, specific naming such as `source=com.example.orders` and `detail-type=Order Placed` is more useful than `source=app` and `detail-type=event1`. Routing metadata becomes part of the integration contract.

Every account has a **default event bus**, where many AWS service events appear. Applications can create **custom buses** such as `commerce`, `security`, or `platform` and control who can send with resource-based policies.

```text
default bus  -> AWS service events
commerce bus -> order, payment, shipping events
security bus -> security events
platform bus -> internal platform events
```

A separate bus is not required for every microservice. A bus is better understood as an integration boundary or routing domain with coherent ownership and policy.

## How Do Applications Publish and Match Events?
<!-- section-summary: Producers send facts with PutEvents, while consumers or platform owners declare content-based event patterns without changing producer code. -->

Custom applications publish with the `PutEvents` API. An entry can be:

```json
[
  {
    "EventBusName": "commerce",
    "Source": "com.shop.orders",
    "DetailType": "Order Placed",
    "Detail": "{\"orderId\":\"7821\",\"total\":1250}"
  }
]
```

Send it with:

```bash
aws events put-events \
  --entries file://events.json
```

The order service chooses the fact and event bus. It does not choose the fraud Lambda, payment queue, analytics pipeline, or email service.

### Rules use event patterns

A high-value-order rule can look like:

```json
{
  "source": ["com.shop.orders"],
  "detail-type": ["Order Placed"],
  "detail": {
    "total": [
      {
        "numeric": [">=", 1000]
      }
    ]
  }
}
```

Patterns follow the general structure of the event and can inspect top-level metadata and nested `detail` fields. An order worth 125 does not match; an order worth 2,500 does.

Routing rules conceptually belong to the consumers or owning integration domain. If analytics wants every order, it can create a rule for the order source. If security later wants orders above 5,000, it adds a rule and target. The order service remains unchanged.

This is **declarative routing**: the pattern states what facts a consumer cares about rather than the producer executing routing code such as `if total >= 1000: call fraud`.

The same power creates a contract risk. An incorrect `detail-type`, nested path, capitalization, or value type makes a healthy rule not match. Test patterns against real example events and version schemas so a producer change does not silently disconnect consumers.

### How Does EventBridge Deliver to Targets Reliably?
<!-- section-summary: EventBridge retries eligible target-delivery failures, consumers remain duplicate-safe, and a target DLQ preserves events that exhaust delivery. -->

After an event matches, EventBridge still has to deliver it across a distributed boundary. The target may throttle, be unavailable, have missing permission, or be deleted.

For retriable target-delivery failures, EventBridge uses exponential backoff and jitter. The default target retry policy attempts delivery for up to 24 hours and up to 185 retries.

```text
EventBridge -> target fails -> wait -> retry -> wait longer -> retry
```

The phrase **target delivery** matters. EventBridge already accepted the event. This retry concerns one matched rule-to-target path, not republishing the event from its original producer.

#### Consumers must be idempotent

A target can process an event successfully while the delivery acknowledgement is lost or another rare duplicate invocation occurs. Exactly-once business execution cannot be assumed.

Carry a stable business event ID:

```json
{
  "detail": {
    "eventId": "order-7821-placed-v1",
    "orderId": "7821"
  }
}
```

Before a non-repeatable side effect such as a payment, refund, or shipment, the consumer checks durable state for that event ID. Repeated delivery returns the recorded outcome instead of repeating the effect.

#### A DLQ preserves exhausted target deliveries

Without a DLQ, an event can be discarded after its target retry policy is exhausted. EventBridge can use an SQS Standard queue as the target's dead-letter queue:

```text
EventBridge -> target -> repeated delivery failure -> SQS DLQ
```

Operators can inspect whether permission, throttling, deletion, network behavior, or target configuration prevented delivery, correct the cause, and reprocess deliberately.

If EventBridge successfully puts the event into a target SQS queue but the queue's worker later fails, that processing error is outside the EventBridge delivery boundary. The main queue's redrive policy and SQS DLQ own it, just as in an SNS-to-SQS design.

## How Do Archives and Replay Differ from Retries and DLQs?
<!-- section-summary: Retry repairs a current delivery, a DLQ retains exhausted failures, an archive stores event history, and replay sends selected history back through the source bus. -->

These mechanisms solve different problems:

| Mechanism | Question it answers |
| --- | --- |
| Retry | Can this matched event reach its target after a temporary failure? |
| DLQ | Which target deliveries still failed after the retry policy? |
| Archive | Which historical events arrived on this bus? |
| Replay | Can selected historical events go through routing again? |

Suppose January orders were delivered successfully. In March, a new recommendation service wants those facts. A DLQ cannot help because the original deliveries did not fail. An archive can retain matching bus events, and replay can send selected historical events back to the archive's source event bus.

```text
Event bus -> Archive
Archive -- replay --> same source event bus -> current rules -> targets
```

An archive can capture all or a pattern-selected subset of events. Replayed events are not guaranteed to emerge in their exact original order. Consumers must be designed for duplicate or historical processing, and new rules should be scoped so replay does not accidentally repeat unrelated side effects.

Archives are not automatic for every bus. If history, later reprocessing, or new-consumer backfill matters, define the archive pattern, retention, access, cost, and replay procedure explicitly.

## How Does EventBridge Cross Accounts and SaaS Boundaries?
<!-- section-summary: Event bus policies and bus-to-bus rules create organizational boundaries, while partner sources and API destinations connect SaaS and external HTTP systems. -->

An organization may separate commerce, security, analytics, and platform work into different AWS accounts. Security processing need not be embedded in each application account:

```text
Commerce account commerce bus
           |
           | matching security events
           v
Security account security bus
           |
           v
Security tooling
```

Event bus resource policies can control which AWS accounts or organizations may send. Rules can route to buses in other accounts. The receiving account controls its own downstream rules and targets.

This makes the event bus an organizational integration boundary. The commerce producer need not know the security application, and commerce developers do not have to own security processing.

### SaaS events can enter through partner sources

For supported partners, a SaaS provider creates a partner event source. The customer associates it with an EventBridge bus and then routes partner events with normal rules:

```text
SaaS provider -> partner event source -> EventBridge bus
                                      -> rules -> Lambda, SQS, workflows
```

### API destinations can send events outward

An EventBridge API destination lets a matching rule invoke an external HTTP API:

```text
EventBridge -> API destination -> external SaaS or API
```

Together, these capabilities place EventBridge between AWS services, custom applications, AWS accounts, SaaS partners, and external HTTP systems.

### How Do EventBridge, SNS, and SQS Differ?
<!-- section-summary: SQS holds work, SNS broadcasts a topic publication, and EventBridge applies content-based rules to facts on a bus. -->

Feature overlap makes service memorization confusing. Start from the fundamental problem:

```text
SQS:         Keep this work until a consumer can process it.
SNS:         Send this publication to topic subscribers.
EventBridge: Route this fact according to event patterns.
```

| Question | SQS | SNS | EventBridge |
| --- | --- | --- | --- |
| Primary abstraction | Queue | Topic | Event bus |
| Main job | Buffer and distribute work | Fan out messages | Route events |
| Consumer relationship | Pull or managed poll | Push to subscriptions | Rules invoke targets |
| Content routing | Not central | Subscription filters | Event patterns are central |
| Waiting backlog | Core capability | Not standard topic behavior | Not bus behavior |

Do not treat EventBridge and SQS as competing alternatives when both jobs exist:

```text
Order service -> EventBridge -> Payments SQS -> Payment workers
```

EventBridge determines that payments cares about `OrderPlaced`. SQS retains that consumer's work during a slowdown and lets workers scale independently.

The same event can route to payments SQS, fraud SQS, analytics, and a security-account bus. Every consumer gets the delivery structure appropriate to its needs.

## How Do You Build a Complete EventBridge Architecture?
<!-- section-summary: A complete design joins a stable event envelope, custom bus, consumer-owned rules, buffered targets, retries, DLQs, optional archive, and cross-account routing. -->

Use this event:

```json
{
  "source": "com.shop.orders",
  "detail-type": "Order Placed",
  "detail": {
    "eventId": "evt-8fa21",
    "orderId": "O-7821",
    "customerId": "C-42",
    "total": 1250,
    "currency": "GBP",
    "customerTier": "gold"
  }
}
```

The order service calls `PutEvents` once on the commerce bus. An archive optionally records the event. Rules match independently:

```text
OrderPlaced             -> Payments SQS -> workers
total >= 1000           -> Fraud workflow
source=com.shop.orders  -> Analytics
security-sensitive      -> Security account event bus
```

Each target has the permission EventBridge needs, an appropriate retry policy, and a DLQ where failed delivery must be recoverable. SQS targets add their own visibility, consumer idempotency, scaling, and processing DLQ.

Permission is another boundary to diagnose explicitly. A producer needs permission to put its event on the chosen bus. The bus resource policy decides which accounts or organizations may publish. After a rule matches, EventBridge needs the service role or target resource-policy access required for that particular destination. A successful `PutEvents` call therefore proves ingestion, not successful invocation of every later target. Check the producer-to-bus and rule-to-target permission relationships separately rather than broadening the producer role until an unrelated delivery happens to work.

Operational evidence follows the same boundaries. Record the producer's stable business event ID and the `PutEvents` result. Test the exact event against the rule pattern. Confirm the rule was triggered, delivery was attempted, and the target received it. If delivery failed, inspect retry state and the EventBridge target DLQ. If an SQS target received it but its worker failed, move the investigation to queue age, consumer logs, visibility behavior, and that queue's processing DLQ. This last-confirmed-boundary method avoids treating all missing business outcomes as an event-bus failure.

Tomorrow, marketing asks for all gold-customer orders. Add a rule matching `customerTier=gold` and its target. The order service does not change. Compliance later requests refund events; another rule handles them without rewriting refund producers.

This is the architectural payoff: producers announce stable domain facts, while consumers and platform owners evolve routing independently.

The managed router replaces application code that would otherwise contain every `if event.type ... send_to_target` branch and require the team to operate its scaling, availability, permissions, retries, observability, cross-account delivery, SaaS links, event history, and replay.

## How Should You Design Event Contracts?
<!-- section-summary: Events should be stable statements of business reality with specific routing metadata, durable IDs, versioned detail, and duplicate-safe consumers. -->

Events may gain consumers that the producer does not know today. Prefer a durable statement:

```json
{
  "detail-type": "Order Placed",
  "detail": {
    "eventId": "evt-8fa21",
    "orderId": "O-7821",
    "total": 1250
  }
}
```

Avoid shaping the event around one current consumer:

```json
{
  "detail-type": "TellPaymentServiceToProcessOrder",
  "detail": {
    "paymentLambdaName": "...",
    "analyticsNeeded": true
  }
}
```

The first lets a future consumer decide that `Order Placed` matters. The second exposes orchestration decisions and target knowledge.

Use specific source and type names, stable business event IDs, occurrence time, a versioned schema, and only the detail subscribers are allowed and expected to receive. Make side-effecting consumers idempotent. Test event patterns with actual envelope examples. Define ownership for publisher permissions, bus policies, rules, target permissions, delivery DLQs, archives, and replays.

The complete mental model is:

```text
Event:      Something happened.
Event bus:  Bring events into this routing domain.
Rule:       Do I care about this event?
Target:     Send matching input here.
Retry:      Try this target delivery again.
DLQ:        Retain exhausted target failures.
Archive:    Keep selected bus history.
Replay:     Put selected history through the source bus again.
```

If you remember one sentence, use this: **A producer publishes a durable fact to an event bus; rules independently select events by their content and route matches to targets, allowing producers and consumers to evolve without knowing about one another.**

:::expand[Why Do Applications Need an Event Router?]{kind="recap"}
EventBridge moves consumer knowledge and content-based routing out of the producer, reducing knowledge and temporal coupling.

Direct producer calls create knowledge of every consumer and often require those consumers to be available. EventBridge moves content-based routing into managed rules so producers publish once and new consumers can appear without producer changes.
:::

:::expand[What Is the Difference Between an Event and a Command?]{kind="recap"}
An event states an immutable past fact, while a command asks a particular action to occur.

A command asks for an action. An event records a fact that already occurred. Events should describe durable domain reality and let consumers independently decide how to react.

The bus receives events, each rule asks whether an event matches, and a target receives the selected event or transformed input.

The bus receives events in a routing domain. Every rule evaluates its event pattern. Each matching rule delivers to its configured target, optionally with transformed input. A bus routes; it does not hold an unconsumed work backlog.
:::

:::expand[What Does an EventBridge Event Look Like?]{kind="recap"}
The standard envelope separates routing and provenance metadata from producer-specific domain detail.

The standard envelope carries source, type, account, Region, time, resources, and other routing metadata around producer-specific `detail`. Default buses commonly receive AWS service events; custom buses provide application or organizational routing domains.
:::

:::expand[How Do Applications Publish and Match Events?]{kind="recap"}
Producers send facts with PutEvents, while consumers or platform owners declare content-based event patterns without changing producer code.

Producers call PutEvents with a source, detail type, bus, and domain detail. Consumer-owned rules declaratively match top-level and nested fields, so a new routing requirement does not require a producer code path.

EventBridge retries eligible target-delivery failures, consumers remain duplicate-safe, and a target DLQ preserves events that exhaust delivery.

EventBridge retries eligible target-delivery failures with backoff and jitter. Targets remain idempotent because duplicate invocation can occur. A Standard SQS DLQ preserves deliveries that exhaust the configured target retry policy.
:::

:::expand[How Do Archives and Replay Differ from Retries and DLQs?]{kind="recap"}
Retry repairs a current delivery, a DLQ retains exhausted failures, an archive stores event history, and replay sends selected history back through the source bus.

Retry addresses a current target delivery. A DLQ retains final delivery failures. An archive stores selected event history even when delivery succeeded. Replay sends historical events back through the source bus and current matching rules.
:::

:::expand[How Does EventBridge Cross Accounts and SaaS Boundaries?]{kind="recap"}
Event bus policies and bus-to-bus rules create organizational boundaries, while partner sources and API destinations connect SaaS and external HTTP systems.

Bus policies and bus-to-bus rules connect AWS accounts under separate ownership. Partner event sources bring supported SaaS events in, and API destinations send matching events to external HTTP endpoints.

SQS holds work, SNS broadcasts a topic publication, and EventBridge applies content-based rules to facts on a bus.

SQS buffers work for consumption. SNS fans one topic publication out to subscriptions. EventBridge applies content-based event rules. EventBridge often routes to SQS when a selected consumer also needs durable buffering.
:::

:::expand[How Do You Build a Complete EventBridge Architecture?]{kind="recap"}
A complete design joins a stable event envelope, custom bus, consumer-owned rules, buffered targets, retries, DLQs, optional archive, and cross-account routing.

Publish a stable event once, route through consumer-owned patterns, buffer slow paths where necessary, grant narrow target permissions, capture delivery failures, optionally archive history, and let cross-account owners control their own downstream buses and targets.
:::

:::expand[How Should You Design Event Contracts?]{kind="recap"}
Events should be stable statements of business reality with specific routing metadata, durable IDs, versioned detail, and duplicate-safe consumers.

Use specific routing metadata, a stable event ID, versioned domain detail, and fact-based past-tense meaning. Avoid embedding current target names or orchestration. Test patterns and make side effects safe when an event is delivered again.
:::

## References

- [Amazon SNS documentation: Message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html)
- [Amazon EventBridge documentation: Event buses](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html)
- [Amazon EventBridge documentation: Event bus logging](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-logs-execution-steps.html)
- [Amazon EventBridge documentation: Events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-events.html)
- [Amazon EventBridge documentation: Create an event bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-event-bus.html)
- [Amazon EventBridge documentation: Sending custom events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-putevents.html)
- [Amazon EventBridge documentation: Event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html)
- [Amazon EventBridge documentation: Targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-targets.html)
- [Amazon EventBridge documentation: Event bus concepts and transformers](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is-how-it-works-concepts.html)
- [Amazon EventBridge documentation: Rule best practices](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules-best-practices.html)
- [Amazon EventBridge documentation: Retry policy](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html)
- [Amazon EventBridge documentation: Troubleshooting duplicate delivery](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-troubleshooting.html)
- [Amazon EventBridge documentation: Dead-letter queues](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html)
- [Amazon EventBridge documentation: Archives and replay](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html)
- [Amazon EventBridge documentation: Event bus permissions](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus-perms.html)
- [Amazon EventBridge documentation: SaaS partner events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-saas.html)
- [Amazon EventBridge documentation: API destinations](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-api-destinations.html)
- [AWS decision guide: Amazon SQS, SNS, or EventBridge](https://docs.aws.amazon.com/decision-guides/latest/sns-or-sqs-or-eventbridge/sns-or-sqs-or-eventbridge.html)
- [Amazon SQS documentation: Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
