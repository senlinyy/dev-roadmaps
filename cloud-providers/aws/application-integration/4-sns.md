---
title: "SNS"
description: "Use Amazon SNS topics for publish-subscribe delivery with publishers, subscriptions, fanout, SNS-to-SQS queues, filter policies, raw delivery, retries, DLQs, and endpoint choices."
overview: "SNS is AWS's publish-subscribe notification service. This article follows an orders system as it publishes order events to topics, fans them out to subscribers, filters deliveries with attributes, protects subscribers with queues and DLQs, and decides when EventBridge is the cleaner routing service."
tags: ["aws", "sns", "pub-sub", "fanout", "messaging"]
order: 4
id: article-cloud-providers-aws-application-integration-sns
aliases:
  - sns
  - amazon-sns
  - pub-sub-topics
  - 4-sns
  - cloud-providers/aws/application-integration/4-sns.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is SNS](#what-is-sns)
3. [Topics](#topics)
4. [Publishers](#publishers)
5. [Subscriptions And Endpoints](#subscriptions-and-endpoints)
6. [Push Delivery](#push-delivery)
7. [Fanout](#fanout)
8. [SNS To SQS](#sns-to-sqs)
9. [Message Attributes And Filter Policies](#message-attributes-and-filter-policies)
10. [Raw Message Delivery](#raw-message-delivery)
11. [Retries And Dead-Letter Queues](#retries-and-dead-letter-queues)
12. [Where EventBridge Fits](#where-eventbridge-fits)
13. [Putting It All Together](#putting-it-all-together)
14. [What's Next](#whats-next)

## The Problem
<!-- section-summary: One order event may need to reach many systems, and checkout should not know every subscriber. -->

The orders system already has an API boundary and a messaging foundation. Checkout can create an order, put work on a queue, and let background workers handle slow tasks. That works well when one producer has one clear worker. The next shape appears when one business fact matters to several teams at the same time.

When an order is created, the receipt service needs to send an email, the warehouse system needs to start fulfillment, analytics needs to record the sale, fraud review may need a copy for high-risk orders, and a mobile app may need to notify the customer. Checkout could call all of those systems directly, but then checkout owns every downstream timeout, every retry rule, every endpoint URL, and every future subscriber request.

That direct-call shape gets awkward in production. A new analytics subscriber needs a checkout release. A slow fraud endpoint can make checkout slower. A broken notification endpoint creates debate about whether order creation should fail. The checkout service should own order creation. It should publish the fact that an order exists, then let interested systems subscribe through a managed delivery layer.

That is the SNS-shaped problem: **one publisher, many subscribers, independent delivery paths**.

## What Is SNS
<!-- section-summary: SNS is a managed publish-subscribe service where publishers send messages to topics and subscribers receive copies. -->

Amazon Simple Notification Service, usually called **SNS**, is AWS's managed publish-subscribe notification service. A **publisher** sends a message to a **topic**. A **subscription** connects that topic to an endpoint. SNS then delivers a copy of the message to each matching subscription.

The key idea is **publish-subscribe**, often shortened to pub/sub. In pub/sub, the publisher sends to a named channel instead of sending directly to every receiver. The receivers subscribe to that channel. In the orders system, checkout can publish one `OrderCreated` message to `orders-events`, while receipt, analytics, fulfillment, fraud, and mobile notification paths each receive their own copy.

The topic is the communication point. The subscription is the delivery instruction. The endpoint is the destination. The publisher only needs permission to publish to the topic, without knowing whether the subscriber is a queue, Lambda function, HTTPS endpoint, email address, or mobile push endpoint.

That separation is the reason teams use SNS in production. It lets the producer publish one business notification, while each subscriber chooses its own processing style, retry handling, filters, and failure owner. Checkout can stay small, and downstream systems can join or leave without changing checkout code.

## Topics
<!-- section-summary: A topic is the named publication point that groups subscribers around one kind of notification. -->

An **SNS topic** is a logical access point for messages. It has an ARN, permissions, encryption settings, delivery status logging options, and subscriptions. A topic should usually represent a stream of related notifications, not one tiny destination. `orders-events` is a useful topic name. `send-receipt-email-only` is usually too narrow because it names one subscriber's job instead of the shared business fact.

For the orders system, the topic might be:

```json
{
  "topicName": "orders-events",
  "topicArn": "arn:aws:sns:us-east-1:123456789012:orders-events",
  "purpose": "Publish order lifecycle notifications from checkout and payment services"
}
```

The topic name tells producers where to publish. The ARN is the full AWS resource address used in IAM policies, queue policies, CloudFormation, Terraform, and application configuration. In production, that ARN usually lives in environment configuration or a parameter store value rather than deep inside application logic.

Topic design starts with ownership. A topic needs an owning team, a payload contract, a publishing permission model, and monitoring. If every team publishes unrelated messages to one generic `events` topic, filters and debugging get messy. If every tiny action gets a separate topic, subscription sprawl is hard to manage. A practical starting point is one topic per business event family, such as `orders-events`, `payments-events`, or `customer-notifications`.

SNS supports **standard topics** and **FIFO topics**. Standard topics are the normal starting point for high-throughput fanout where subscribers can handle duplicate or out-of-order delivery. FIFO topics add ordering and deduplication behavior for workloads that need ordered delivery, mainly with SQS FIFO queues. FIFO fits a real ordering requirement, such as sequential inventory adjustments for the same SKU.

## Publishers
<!-- section-summary: A publisher sends small, stable messages to the topic and leaves subscriber-specific work outside the checkout path. -->

A **publisher** is the application or AWS service that calls `Publish` on the topic. In the orders system, the checkout API publishes `OrderCreated` after it has committed the order. Later, the payment service may publish `PaymentCaptured`, and the returns service may publish `RefundIssued`.

The publisher should send a small message that names the event and includes stable identifiers. Keep the full database row in the system that owns it. If the receipt service needs customer details, it can fetch them using `orderId` or read a receipt document from S3. That keeps messages small and reduces the chance that every subscriber depends on fields outside its ownership.

A clean `OrderCreated` message might look like this:

```json
{
  "eventType": "OrderCreated",
  "eventId": "evt-01JZ6XWQ1B7N3BR5M9C4A8W2ZP",
  "orderId": "order-1042",
  "customerId": "cust-991",
  "total": 149.99,
  "currency": "USD",
  "createdAt": "2026-06-13T14:30:00Z"
}
```

The message carries enough information for subscribers to know what happened and find the related state. `eventId` helps with idempotency. `orderId` is the business key. `total` and `currency` may help fraud or analytics filters decide whether they want this message.

The publisher also needs IAM permission to publish. A checkout role can be scoped to one topic:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:orders-events"
    }
  ]
}
```

That permission is small on purpose. Checkout can publish order notifications, but it cannot change subscriptions, delete the topic, or publish to unrelated topics. In a real deployment, the topic and the publishing role usually come from infrastructure as code, while the application receives the topic ARN through configuration.

## Subscriptions And Endpoints
<!-- section-summary: A subscription connects one topic to one endpoint, and each endpoint type fits a different production job. -->

A **subscription** connects a topic to an endpoint. The subscription says, "deliver matching messages from this topic to this destination." The endpoint type controls what delivery looks like and what the subscriber has to implement.

In the orders system, the same topic can have several subscriptions:

| Endpoint type | Example in the orders system | Practical fit |
| --- | --- | --- |
| **SQS queue** | `orders-receipts-queue` | Durable worker backlog with polling, visibility timeout, and worker-controlled pace |
| **Lambda function** | `capture-order-analytics` | Small event handler where direct invocation is acceptable |
| **HTTP/S endpoint** | `https://fraud.example.com/sns/orders` | Internal service, partner system, or external webhook receiver |
| **Email** | `ops-orders@example.com` | Human notification for low-volume operational messages |
| **Mobile platform endpoint** | Customer app push endpoint | Native mobile push notification through platform services such as APNs or FCM |

SQS is usually the production default for application work because it gives the subscriber a backlog. If the receipt worker is down for a deploy, messages can wait in the queue. If the worker needs to slow down because the email provider is rate-limited, the queue absorbs the pressure.

Lambda subscriptions are useful for small reactions where direct invocation is enough. The function still needs idempotency because deliveries can be retried. HTTP/S subscriptions are useful when SNS needs to reach a service endpoint. That endpoint should respond with a successful status only after it has safely accepted the message. Email and mobile push are application-to-person paths, so use them for human-facing notification and keep machine workflow on queues, Lambda, or HTTP endpoints.

Endpoint choice is a production design decision. It decides who owns buffering, how retries behave, what monitoring looks like, and how operators recover from failure. For critical backend processing, SNS-to-SQS usually gives teams the most control.

## Push Delivery
<!-- section-summary: SNS pushes delivery attempts to subscriptions, so subscribers must be ready for retry and duplicate handling. -->

SNS uses **push delivery**. The publisher publishes once, and SNS attempts delivery to the subscriptions. For Lambda, SNS invokes the function. For HTTP/S, SNS sends an HTTP request. For email or mobile push, SNS talks to the notification channel. For SQS, SNS sends a message into the queue, and then queue consumers poll SQS at their own pace.

A topic is a delivery fanout surface, while a queue stores work until consumers receive and delete it. If a subscriber needs durable waiting, put SQS behind the subscription. That gives the subscriber a place where messages can wait after SNS successfully delivers them to the queue.

Push delivery also changes how the publisher thinks. Checkout publishes once and receives a `MessageId` from SNS. That means SNS accepted the message for delivery. Every subscriber still completes its business work in its own path. The receipt queue may receive the message, but the receipt worker still needs to send the email. The fraud HTTP endpoint may retry for a while. The analytics Lambda may succeed. Those are separate delivery and processing paths.

For production, treat the SNS publish call as the handoff from the producer to the notification layer. Then monitor each subscription or downstream queue separately. Publisher success, SNS delivery success, and subscriber business success are three separate signals.

## Fanout
<!-- section-summary: Fanout lets one published message become many independent subscriber deliveries. -->

**Fanout** means one published message is replicated to multiple subscribers. This is the classic SNS use case. Checkout publishes one `OrderCreated` event, and SNS fans it out to receipt, fulfillment, analytics, fraud, and customer notification paths.

The useful part is independent ownership. The receipt team can subscribe an SQS queue and tune worker concurrency. The analytics team can subscribe a Lambda function. The fraud team can subscribe an HTTPS endpoint with a custom retry policy. The mobile team can subscribe a mobile notification path. Checkout still publishes one message to one topic.

A fanout plan for `orders-events` might look like this:

| Subscriber | Receives | Why |
| --- | --- | --- |
| `orders-receipts-queue` | All `OrderCreated` messages | Send receipts through a controlled email worker |
| `orders-fulfillment-queue` | Paid physical orders | Prepare warehouse fulfillment |
| `capture-order-analytics` Lambda | All order lifecycle messages | Write analytics events |
| Fraud HTTPS endpoint | High-value or risky orders | Start review without blocking checkout |
| Mobile push endpoint | Customer-visible order updates | Notify the customer's device |

The topic should publish the shared fact, and each subscriber should own its reaction. That keeps the producer from turning into a traffic controller for the whole business. It also makes subscriber failures easier to isolate. If fraud delivery fails, receipt and analytics can still receive their copies.

Fanout has one important discipline: every subscriber must be safe to receive a duplicate. Retries, network failures, and downstream errors can cause repeated delivery attempts. An idempotency key such as `eventId` or `orderId + eventType` should protect emails, shipments, and external tickets from duplicate side effects.

## SNS To SQS
<!-- section-summary: SNS-to-SQS gives each subscriber its own durable queue, retry controls, worker scaling, and DLQ path. -->

The **SNS-to-SQS pattern** is the most common production shape for backend fanout. SNS handles the publish-subscribe fanout. SQS gives each subscriber its own durable buffer. Workers poll their queue, process at their own pace, and use normal SQS visibility timeout and DLQ behavior.

For receipt emails, the shape is simple. Checkout publishes `OrderCreated` to `orders-events`. SNS delivers a copy to `orders-receipts-queue`. Receipt workers poll that queue and send emails. If the email provider slows down, the queue grows while checkout continues creating orders.

There are two practical setup details. First, subscribe the SQS queue to the SNS topic. Second, add a queue policy that allows the SNS topic to send messages to that queue. Without the queue policy, the subscription can exist while delivery still fails.

The queue policy should scope access to the specific topic:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowOrdersTopicToSendMessages",
      "Effect": "Allow",
      "Principal": {
        "Service": "sns.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:orders-receipts-queue",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:sns:us-east-1:123456789012:orders-events"
        }
      }
    }
  ]
}
```

That condition is the important part. It lets the expected SNS topic send to the queue, instead of allowing every SNS topic in the account or every AWS account to send messages. In cross-account designs, the same principle applies, but the topic account, queue account, and resource policies need extra care.

This pattern gives each subscriber an independent failure boundary. The receipt queue can have a receipt DLQ. The fulfillment queue can have a fulfillment DLQ. The analytics subscriber can scale separately. A poison message in one subscriber path stays inside that subscriber's queue and DLQ path.

## Message Attributes And Filter Policies
<!-- section-summary: Message attributes and filter policies let subscribers receive only the messages they are designed to handle. -->

**Message attributes** are structured metadata attached to an SNS message. They sit next to the message body and can include strings, numbers, arrays, or binary values. Subscribers can use attributes for filtering so they receive only the messages they care about.

In the orders system, the message body carries the business event, while attributes carry routing hints:

```json
{
  "eventType": {
    "DataType": "String",
    "StringValue": "OrderCreated"
  },
  "orderChannel": {
    "DataType": "String",
    "StringValue": "web"
  },
  "riskScore": {
    "DataType": "Number",
    "StringValue": "87"
  },
  "shippingMethod": {
    "DataType": "String",
    "StringValue": "express"
  }
}
```

A **filter policy** attaches to a subscription. It tells SNS which messages should be delivered to that subscription. By default, SNS evaluates filter policies against message attributes. A fraud subscription could receive only high-risk created orders:

```json
{
  "eventType": ["OrderCreated"],
  "riskScore": [
    {
      "numeric": [">=", 80]
    }
  ]
}
```

Now the fraud endpoint receives high-risk `OrderCreated` messages, while the receipt queue can still receive every `OrderCreated` message:

```json
{
  "eventType": ["OrderCreated"]
}
```

This is the difference between filtering at the topic and filtering at the subscriber. The topic still receives the full event stream. Each subscription declares its interest. That lets the fulfillment subscriber ask for physical goods, while analytics asks for everything.

Here is a practical publish command with message attributes:

```bash
aws sns publish \
  --topic-arn arn:aws:sns:us-east-1:123456789012:orders-events \
  --message '{"eventType":"OrderCreated","eventId":"evt-01JZ6XWQ1B7N3BR5M9C4A8W2ZP","orderId":"order-1042","customerId":"cust-991","total":149.99,"currency":"USD","createdAt":"2026-06-13T14:30:00Z"}' \
  --message-attributes '{
    "eventType": {"DataType": "String", "StringValue": "OrderCreated"},
    "orderChannel": {"DataType": "String", "StringValue": "web"},
    "riskScore": {"DataType": "Number", "StringValue": "87"},
    "shippingMethod": {"DataType": "String", "StringValue": "express"}
  }'
```

The main gotcha is consistency. If the fraud filter expects `riskScore` and the publisher forgets that attribute, the fraud subscription will not receive the message. Treat attributes as part of the event contract. Review them the same way you review the message body.

## Raw Message Delivery
<!-- section-summary: Raw message delivery sends only the message body to SQS or HTTP/S endpoints instead of the SNS JSON envelope. -->

By default, SNS wraps a message in a JSON envelope for many endpoint types. That envelope includes metadata such as `Type`, `MessageId`, `TopicArn`, `Timestamp`, `Signature`, and the original `Message` field. For SQS subscribers, the queue message body often contains this SNS envelope unless raw delivery is enabled.

With raw delivery disabled, the SQS message body may look like this:

```json
{
  "Type": "Notification",
  "MessageId": "9f6a3a7c-9d3d-5d0a-9d1a-111122223333",
  "TopicArn": "arn:aws:sns:us-east-1:123456789012:orders-events",
  "Message": "{\"eventType\":\"OrderCreated\",\"eventId\":\"evt-01JZ6XWQ1B7N3BR5M9C4A8W2ZP\",\"orderId\":\"order-1042\"}",
  "Timestamp": "2026-06-13T14:30:01.000Z",
  "SignatureVersion": "1",
  "Signature": "EXAMPLE",
  "SigningCertURL": "https://sns.us-east-1.amazonaws.com/SimpleNotificationService.pem",
  "UnsubscribeURL": "https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=EXAMPLE"
}
```

With **raw message delivery** enabled, SNS strips the SNS metadata and sends the original message body as the payload:

```json
{
  "eventType": "OrderCreated",
  "eventId": "evt-01JZ6XWQ1B7N3BR5M9C4A8W2ZP",
  "orderId": "order-1042"
}
```

Raw delivery is useful when an SQS worker or HTTP endpoint wants to process the business payload directly. It reduces parsing code and avoids making every worker unwrap the `Message` string from the SNS envelope. You enable it on the subscription by setting the `RawMessageDelivery` subscription attribute to `true`.

The tradeoff is metadata. The SNS envelope gives subscribers delivery metadata and signature fields. HTTP/S endpoints that receive non-raw SNS messages should handle subscription confirmation and validate message authenticity. With raw delivery, HTTP/S endpoints receive the raw body and an `x-amz-sns-rawdelivery` header. For HTTP/S and Firehose raw delivery, SNS leaves message attributes out of the raw body. For SQS raw delivery, SNS supports message attributes, but an SQS raw subscription can receive a maximum of 10 message attributes.

The practical rule is straightforward. Raw delivery fits internal SQS workers that already trust the queue boundary and want the clean payload. The SNS envelope fits HTTP/S endpoints that need SNS metadata, confirmation handling, and signature validation.

## Retries And Dead-Letter Queues
<!-- section-summary: SNS retries delivery by subscription protocol, and each subscription can have its own DLQ for undeliverable messages. -->

SNS delivery failure handling lives at the **subscription** level. One published message can succeed for receipt, retry for fraud, and fail into a DLQ for mobile notification. Each subscription has its own endpoint, delivery path, retry result, and DLQ choice.

SNS retries server-side delivery failures according to the delivery protocol. AWS-managed endpoints such as Lambda and SQS get a long retry policy. AWS documentation describes up to 100,015 attempts over 23 days for server-side errors to Lambda and SQS endpoints. Customer-managed endpoints such as HTTP/S can use configurable delivery policies, and SMTP, SMS, and mobile push use SNS-defined policies. Client-side errors, such as a deleted endpoint or a resource policy that blocks SNS, are not useful to retry until configuration changes.

For HTTP/S subscriptions, you can define a delivery policy. This lets the fraud endpoint protect itself from too much retry traffic:

```json
{
  "healthyRetryPolicy": {
    "minDelayTarget": 1,
    "maxDelayTarget": 60,
    "numRetries": 50,
    "numNoDelayRetries": 3,
    "numMinDelayRetries": 2,
    "numMaxDelayRetries": 35,
    "backoffFunction": "exponential"
  },
  "throttlePolicy": {
    "maxReceivesPerSecond": 10
  },
  "requestPolicy": {
    "headerContentType": "application/json"
  }
}
```

That policy belongs either on the topic for all HTTP/S subscriptions or on one subscription for one endpoint. In production, subscription-level policy is usually clearer when different endpoints have different capacity. Fraud may accept 10 deliveries per second, while an internal audit endpoint may accept 100.

A **dead-letter queue**, or DLQ, gives SNS a place to move messages that cannot be delivered after the retry policy is exhausted or when a non-retryable delivery failure occurs. The DLQ is an SQS queue attached to the SNS subscription, not to the topic. That is important because each subscriber needs its own failure evidence.

A subscription redrive policy is small:

```json
{
  "deadLetterTargetArn": "arn:aws:sqs:us-east-1:123456789012:orders-fraud-sns-dlq"
}
```

The DLQ queue must be in the same AWS account and Region as the SNS subscription. For FIFO topic subscriptions, use a FIFO queue as the DLQ. For standard topic subscriptions, use a standard queue. If the DLQ is encrypted with AWS KMS, the key policy must allow the SNS service principal to use the key.

The operational habit is to alarm on the DLQ, inspect messages, fix the endpoint or permission problem, and redrive deliberately. A DLQ message may mean a customer did not receive a push notification, a partner fraud endpoint missed a review, or a Lambda permission was removed during deployment. Deleting DLQ messages without investigation turns delivery failure into silent data loss.

## Where EventBridge Fits
<!-- section-summary: EventBridge fits broader event routing with richer rules, many sources, target transformation, schedules, and cross-account event flows. -->

SNS and EventBridge can both deliver one event to multiple destinations, so teams often ask which one to use. Start from the routing job. SNS is a strong fit for pub/sub fanout from a known topic, especially when subscribers include SQS queues, Lambda functions, HTTP/S endpoints, email, SMS, or mobile push. It is simple, direct, and very effective for notification fanout.

EventBridge fits a different routing shape. It gives you event buses, rules, event patterns, many AWS service sources, partner SaaS sources, input transformation, schedules through EventBridge Scheduler, and cross-account event routing patterns. If the orders platform needs to route events from many services across an organization, apply richer JSON event patterns, transform target input, or receive partner SaaS events, EventBridge usually gives a cleaner event router.

Here is the same high-risk order idea as an EventBridge rule pattern:

```json
{
  "source": ["devpolaris.orders"],
  "detail-type": ["OrderCreated"],
  "detail": {
    "riskScore": [
      {
        "numeric": [">=", 80]
      }
    ]
  }
}
```

SNS filter policies are excellent when subscribers filter a topic's messages by attributes or selected body fields. EventBridge event patterns are richer for routing across event metadata and nested event details. EventBridge also has a broader set of AWS service event sources, while SNS has direct application-to-person notification endpoints such as email, SMS, and mobile push.

A practical choice table looks like this:

| Need | Start with |
| --- | --- |
| One application publishes notifications to several subscribers | SNS topic |
| Each backend subscriber needs its own durable backlog | SNS topic to SQS queues |
| Mobile push, SMS, or email notification is part of the delivery path | SNS |
| Many AWS services, custom apps, or SaaS sources route through one bus | EventBridge |
| Rich JSON event pattern matching, input transformation, or cross-account event routing | EventBridge |
| Scheduled invocation with retry settings and flexible windows | EventBridge Scheduler |

The two services can work together. EventBridge can send selected events to an SNS topic, and SNS can fan those notifications out to email, mobile, or SQS subscribers. SNS can also be a target behind an EventBridge rule. The service that owns the main routing decision should lead the design, with the other service connected only where the architecture needs both shapes.

## Putting It All Together
<!-- section-summary: A production SNS design gives checkout one publish path while each subscriber owns filtering, delivery, buffering, and recovery. -->

Now return to the orders system with all the pieces connected. Checkout publishes one `OrderCreated` message to the `orders-events` SNS topic after the order is committed. The message body includes stable identifiers and business facts. Message attributes include `eventType`, `riskScore`, `shippingMethod`, and other routing fields that subscribers can filter on.

Receipt uses an SQS subscription because email sending needs a durable backlog and worker-controlled retry. Fulfillment uses another SQS subscription with a filter for physical orders. Analytics uses a Lambda subscription because the handler is small and can tolerate direct invocation. Fraud uses an HTTP/S subscription with a filter for high-risk orders, a custom delivery policy, and its own SNS subscription DLQ. Mobile notification uses a platform endpoint path for customer-facing push.

The important production boundaries are clear:

| Boundary | Owner | Why it matters |
| --- | --- | --- |
| Topic contract | Orders platform | Defines what is published and which attributes exist |
| Publish permission | IAM and platform team | Keeps publishers scoped to the right topic |
| Subscription filters | Subscriber team | Lets each subscriber receive only relevant messages |
| SQS backlog | Subscriber team | Controls worker pace, retries, and processing DLQ |
| SNS subscription DLQ | Subscriber team | Captures delivery failures before the endpoint receives the message |
| Idempotency key | Subscriber application | Prevents duplicate delivery from repeating side effects |
| EventBridge routing | Platform team when needed | Handles broader event buses, richer routing, schedules, and cross-account flows |

This design keeps checkout focused on order creation. Checkout publishes a fact once. SNS fans that fact out. SQS queues protect backend subscribers that need buffering. Filter policies keep subscribers from receiving noise. Raw delivery simplifies queue workers where it fits. Retry policies and DLQs make delivery failures visible instead of mysterious.

SNS is strongest when you want a simple pub/sub notification channel with practical endpoint choices. It fits fanout, SNS-to-SQS, mobile and email notification, and direct subscriber delivery. EventBridge fits when the routing surface grows into many sources, richer event patterns, target transformation, schedules, or organization-wide event flow.

## What's Next

SNS is a strong fit when one publisher sends the same notification to known subscribers. The next article expands the routing surface with EventBridge. It follows events as business facts, shows how rules match those facts, and explains when an event bus gives teams more room than a topic.

---

**References**

- [What is Amazon SNS?](https://docs.aws.amazon.com/sns/latest/dg/welcome.html) - Defines SNS, publishers, subscribers, topics, fanout, endpoint categories, and common scenarios.
- [Creating an Amazon SNS topic](https://docs.aws.amazon.com/sns/latest/dg/sns-create-topic.html) - Covers topic creation, topic type selection, and topic configuration basics.
- [Publishing an Amazon SNS message](https://docs.aws.amazon.com/sns/latest/dg/sns-publishing.html) - Shows how publishing works, including message attributes and protocol-specific payloads.
- [Fanout Amazon SNS notifications to Amazon SQS queues](https://docs.aws.amazon.com/sns/latest/dg/sns-sqs-as-subscriber.html) - Documents SNS-to-SQS fanout and the default SNS JSON envelope delivered to SQS.
- [Fanout Amazon SNS notifications to Lambda functions](https://docs.aws.amazon.com/sns/latest/dg/sns-lambda-as-subscriber.html) - Explains Lambda subscriptions to SNS topics.
- [Sending mobile push notifications with Amazon SNS](https://docs.aws.amazon.com/sns/latest/dg/sns-mobile-application-as-subscriber.html) - Documents mobile platform endpoint delivery through SNS.
- [Amazon SNS message attributes](https://docs.aws.amazon.com/sns/latest/dg/sns-message-attributes.html) - Describes message attribute data types, validation, filtering use, and raw-delivery limits.
- [Amazon SNS message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html) - Explains filter policies for delivering only matching messages to subscriptions.
- [Amazon SNS raw message delivery](https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html) - Documents raw message delivery for SQS, HTTP/S, and Firehose endpoints.
- [Amazon SNS message delivery retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html) - Documents protocol retry policies, HTTP/S delivery policies, backoff, and retry limits.
- [Amazon SNS dead-letter queues](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html) - Explains subscription-level DLQs, redrive policy, failure causes, and DLQ monitoring.
- [What is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html) - Defines EventBridge event buses, pipes, routing, transformation, and Scheduler.
- [Amazon SQS, Amazon SNS, or Amazon EventBridge?](https://docs.aws.amazon.com/decision-guides/latest/sns-or-sqs-or-eventbridge/sns-or-sqs-or-eventbridge.html) - AWS decision guide comparing queues, topics, and event buses.
