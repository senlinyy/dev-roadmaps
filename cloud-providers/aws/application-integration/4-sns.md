---
title: "SNS"
description: "Use Amazon SNS topics for publish-subscribe delivery with publishers, subscriptions, fanout, SNS-to-SQS queues, filter policies, raw delivery, retries, DLQs, and endpoint choices."
overview: "SNS is AWS's publish-subscribe notification service. This article follows a lesson publishing system as it publishes one lesson event to a topic, fans it out to email, search, analytics, and mobile subscribers, protects subscribers with SQS queues, uses message attributes and filter policies, and decides where EventBridge is a cleaner routing service."
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

1. [The Fanout Problem](#the-fanout-problem)
2. [What SNS Does](#what-sns-does)
3. [Topics, Publishers, and Subscriptions](#topics-publishers-and-subscriptions)
4. [Create a Topic and Subscribe Queues](#create-a-topic-and-subscribe-queues)
5. [Publish a Lesson Notification](#publish-a-lesson-notification)
6. [Inspect Subscriber Delivery](#inspect-subscriber-delivery)
7. [Message Attributes and Filter Policies](#message-attributes-and-filter-policies)
8. [Raw Delivery, Retries, and DLQs](#raw-delivery-retries-and-dlqs)
9. [SNS, SQS, and EventBridge](#sns-sqs-and-eventbridge)
10. [Putting It Together](#putting-it-together)
11. [What's Next](#whats-next)
12. [References](#references)

## The Fanout Problem
<!-- section-summary: SNS fits the moment one fact should reach several subscribers without the producer calling each one directly. -->

The SQS article handled one background work lane. A publish request created a transcode message, and a worker processed that message. Now the worker has finished the video and the lesson can go live.

That creates a new fact: `LessonPublished`. Several systems care about it. Learner email wants to send a notification. Search wants to index the lesson. Analytics wants to count publishing activity. The mobile app wants to update a feed or push notification. Each system needs its own copy of the same fact.

The lesson service could call those systems one by one, but then publishing owns every downstream endpoint, timeout, retry rule, and future subscriber. A new analytics subscriber would require a lesson service change. A slow notification endpoint would add pressure to publishing.

**Amazon Simple Notification Service**, usually called **SNS**, solves the fanout job. The lesson service publishes one message to a topic, and SNS delivers copies to each subscription. The publisher owns the fact. Subscribers own their own reaction.

## What SNS Does
<!-- section-summary: SNS is a managed publish-subscribe service where publishers send messages to topics and subscriptions receive copies. -->

SNS is AWS's managed publish-subscribe notification service. A **publisher** sends a message to a **topic**. A **subscription** connects the topic to an endpoint. SNS delivers the message to matching subscriptions.

The beginner definition is: **SNS is a fanout topic service**. The producer sends one message to one topic. SNS handles the delivery attempts to subscribed endpoints. The endpoints can be SQS queues, Lambda functions, HTTP or HTTPS endpoints, email addresses, SMS targets, mobile push endpoints, and other supported destinations.

For Northstar Learn, the topic can be named `lesson-publishing-notifications`. The lesson service publishes `LessonPublished`. Search, analytics, learner email, and mobile notifications each subscribe in the way that fits their own processing model.

The topic creates a clear ownership split:

| Piece | Job |
|---|---|
| Publisher | Sends a stable business notification |
| Topic | Receives the publication and fans out copies |
| Subscription | Defines one delivery path from the topic |
| Endpoint | Receives the message, such as an SQS queue or Lambda function |
| Subscriber system | Processes its copy and owns its failures |

This is different from SQS. SQS gives one processing group a backlog. SNS gives many subscribers their own copy of a notification. In production, the two services are often used together as SNS-to-SQS.

![The fanout view shows how one publish operation can deliver the same notification to queues, functions, webhooks, or people independently](/content-assets/articles/article-cloud-providers-aws-application-integration-sns/topic-fanout.png)

*The fanout view shows how one publish operation can deliver the same notification to queues, functions, webhooks, or people independently.*


## Topics, Publishers, and Subscriptions
<!-- section-summary: A topic should represent a related notification stream, while subscriptions represent independent delivery paths. -->

An **SNS topic** is the publication point. It has an ARN, policy, encryption settings, subscriptions, and delivery behavior. A useful topic name describes the shared business notifications, such as `lesson-publishing-notifications`, rather than one subscriber's job.

A **publisher** is the app or service that calls `Publish`. In this scenario, the lesson publishing workflow publishes after the lesson record changes to `PUBLISHED`. The publisher should send stable identifiers and a small payload so subscribers can load more detail from the owning service if needed.

A **subscription** is one delivery path from the topic to an endpoint. The search team may subscribe an SQS queue. The analytics team may subscribe another queue. A small notification Lambda may subscribe directly if it can handle SNS retries and failure behavior safely.

Here is the message contract the topic owners might document:

```json
{
  "eventType": "LessonPublished",
  "schemaVersion": 1,
  "lessonId": "lesson-1042",
  "courseId": "course-aws-foundations",
  "publishedAt": "2026-06-27T10:15:00Z",
  "publishedBy": "instructor-77",
  "correlationId": "req-9ef0d6c8"
}
```

This payload contains enough information for subscribers to identify the lesson and connect logs. It avoids copying the full lesson body, learner lists, or private instructor details into every subscription, queue, log, and DLQ.

## Create a Topic and Subscribe Queues
<!-- section-summary: SNS topics publish notifications, and SQS subscriptions give important consumers their own durable backlog. -->

The command below creates the SNS topic for lesson publishing notifications:

```bash
aws sns create-topic \
  --name lesson-publishing-notifications
```

Example output:

```json
{
  "TopicArn": "arn:aws:sns:us-east-1:123456789012:lesson-publishing-notifications"
}
```

The topic ARN is the value producers use when they publish. It is also the value subscriptions and IAM policies use when they refer to this topic.

For durable subscribers, create SQS queues first. The commands are the same style as the SQS article, so this article starts from two existing queues:

```json
{
  "searchQueueArn": "arn:aws:sqs:us-east-1:123456789012:lesson-search-index-jobs",
  "analyticsQueueArn": "arn:aws:sqs:us-east-1:123456789012:lesson-analytics-events"
}
```

These queues give search and analytics separate backlogs. Search can be down for a deployment while analytics continues. Analytics can process in larger batches while search processes quickly. Each subscriber gets its own operations story.

An SQS queue must allow the SNS topic to send messages to it. The queue policy below grants `sqs:SendMessage` only when the source ARN is the lesson topic.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowLessonPublishingTopic",
      "Effect": "Allow",
      "Principal": {
        "Service": "sns.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:lesson-search-index-jobs",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:sns:us-east-1:123456789012:lesson-publishing-notifications"
        }
      }
    }
  ]
}
```

`Principal` names SNS as the service allowed to send. `Action` limits the permission to sending messages. `Condition` limits the source to the expected topic, which prevents other SNS topics from writing to this queue through the same statement.

The subscription command connects the topic to the search queue. `RawMessageDelivery=true` makes the SQS message body contain the original published message body instead of the larger SNS envelope.

```bash
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:123456789012:lesson-publishing-notifications \
  --protocol sqs \
  --notification-endpoint arn:aws:sqs:us-east-1:123456789012:lesson-search-index-jobs \
  --attributes RawMessageDelivery=true
```

Example output:

```json
{
  "SubscriptionArn": "arn:aws:sns:us-east-1:123456789012:lesson-publishing-notifications:4d4a8c7e-5f35-49a1-a3df-4a6c9a1d4c6b"
}
```

The subscription ARN identifies this one delivery path. If the search team later needs a filter policy, DLQ, or raw delivery change, it updates this subscription without changing the publisher.

## Publish a Lesson Notification
<!-- section-summary: A publisher sends one message to the topic with a stable body and useful attributes for filtering. -->

The lesson service publishes after it commits the lesson status as `PUBLISHED`. The command below sends the notification body and attributes. Attributes are separate from the JSON body and can drive SNS filter policies.

```bash
aws sns publish \
  --topic-arn arn:aws:sns:us-east-1:123456789012:lesson-publishing-notifications \
  --message '{"eventType":"LessonPublished","schemaVersion":1,"lessonId":"lesson-1042","courseId":"course-aws-foundations","publishedAt":"2026-06-27T10:15:00Z","publishedBy":"instructor-77","correlationId":"req-9ef0d6c8"}' \
  --message-attributes '{"eventType":{"DataType":"String","StringValue":"LessonPublished"},"courseLevel":{"DataType":"String","StringValue":"beginner"},"tenantId":{"DataType":"String","StringValue":"tenant-learning"}}'
```

Example output:

```json
{
  "MessageId": "3c2b8e9a-6b5f-5d4d-a2b7-54c0f0a8c9d1"
}
```

`MessageId` proves SNS accepted the publish call. It does not prove every subscriber has finished processing. Each subscription has its own delivery behavior, and durable subscribers should expose their own queue metrics and DLQs.

The publisher should handle publish failures as part of the lesson workflow. If the topic publish fails after the lesson record is already `PUBLISHED`, the system needs a retry path or an outbox pattern so the business fact can still reach subscribers.

## Inspect Subscriber Delivery
<!-- section-summary: Subscription and queue inspection show whether fanout is configured and whether subscribers received their copies. -->

The command below lists subscriptions attached to the topic. It is a simple way to confirm that expected subscriber paths exist.

```bash
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-1:123456789012:lesson-publishing-notifications
```

Example output:

```json
{
  "Subscriptions": [
    {
      "SubscriptionArn": "arn:aws:sns:us-east-1:123456789012:lesson-publishing-notifications:4d4a8c7e-5f35-49a1-a3df-4a6c9a1d4c6b",
      "Owner": "123456789012",
      "Protocol": "sqs",
      "Endpoint": "arn:aws:sqs:us-east-1:123456789012:lesson-search-index-jobs",
      "TopicArn": "arn:aws:sns:us-east-1:123456789012:lesson-publishing-notifications"
    }
  ]
}
```

This output proves the topic has an SQS subscription for search. If a subscriber says it receives nothing, the next checks are the subscription status, queue policy, filter policy, and the subscriber queue metrics.

The command below receives the search subscriber's copy from SQS:

```bash
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/lesson-search-index-jobs \
  --max-number-of-messages 1 \
  --wait-time-seconds 10 \
  --message-attribute-names All
```

Example output with raw delivery enabled:

```json
{
  "Messages": [
    {
      "MessageId": "b3cfb29a-24b8-4ab7-b28b-f4bba29d6f4e",
      "ReceiptHandle": "AQEBz7...long-handle...",
      "Body": "{\"eventType\":\"LessonPublished\",\"schemaVersion\":1,\"lessonId\":\"lesson-1042\",\"courseId\":\"course-aws-foundations\",\"publishedAt\":\"2026-06-27T10:15:00Z\",\"publishedBy\":\"instructor-77\",\"correlationId\":\"req-9ef0d6c8\"}",
      "MessageAttributes": {
        "eventType": {
          "StringValue": "LessonPublished",
          "DataType": "String"
        },
        "courseLevel": {
          "StringValue": "beginner",
          "DataType": "String"
        }
      }
    }
  ]
}
```

The queue message has its own SQS `MessageId` because the subscription delivered a copy into the queue. The body contains the original published message because raw delivery is enabled. The attributes are available for subscriber logic and debugging.

## Message Attributes and Filter Policies
<!-- section-summary: Filter policies let subscribers receive only the messages that match their declared interest. -->

SNS can filter messages before delivery to a subscription. A **filter policy** is JSON on the subscription. It matches message attributes by default, and it can also filter on message body fields when configured for payload-based filtering.

For example, the mobile notification subscriber may only want beginner courses. The filter policy below matches messages with `eventType=LessonPublished` and `courseLevel=beginner`.

```json
{
  "eventType": [
    "LessonPublished"
  ],
  "courseLevel": [
    "beginner"
  ]
}
```

This JSON is subscription configuration. The publisher must send matching message attributes, or SNS will skip delivery to that subscription. Filters should stay simple because they are part of the delivery contract between publisher and subscriber.

The command below applies the filter policy to one subscription:

```bash
aws sns set-subscription-attributes \
  --subscription-arn arn:aws:sns:us-east-1:123456789012:lesson-publishing-notifications:4d4a8c7e-5f35-49a1-a3df-4a6c9a1d4c6b \
  --attribute-name FilterPolicy \
  --attribute-value '{"eventType":["LessonPublished"],"courseLevel":["beginner"]}'
```

This command returns no body on success. A good follow-up check is `get-subscription-attributes`, because filter mistakes are a common reason a subscriber receives no messages.

```bash
aws sns get-subscription-attributes \
  --subscription-arn arn:aws:sns:us-east-1:123456789012:lesson-publishing-notifications:4d4a8c7e-5f35-49a1-a3df-4a6c9a1d4c6b \
  --query 'Attributes.FilterPolicy'
```

Example output:

```json
"{\"eventType\":[\"LessonPublished\"],\"courseLevel\":[\"beginner\"]}"
```

The escaped JSON string is normal because subscription attributes are stored as string values. The important check is that the policy uses the same attribute names and values the publisher sends.

![The filter view shows how message attributes let each subscription receive only the notifications it cares about](/content-assets/articles/article-cloud-providers-aws-application-integration-sns/message-attributes-filter-policies.png)

*The filter view shows how message attributes let each subscription receive only the notifications it cares about.*


## Raw Delivery, Retries, and DLQs
<!-- section-summary: Subscriber delivery settings decide payload shape, retry behavior, and where failed notifications go. -->

Raw message delivery changes the SQS payload shape. With raw delivery enabled, the SQS body is the original SNS message body. With raw delivery disabled, the SQS body is an SNS envelope that includes fields such as `Type`, `MessageId`, `TopicArn`, `Message`, `Timestamp`, and signature metadata.

Raw delivery is convenient when the subscriber only wants the business payload. The SNS envelope is useful when the subscriber needs SNS metadata or signature fields. The choice should be documented because it changes the code a consumer writes.

SNS retries failed deliveries according to the endpoint type and delivery policy. SQS subscriptions are usually durable because SNS sends into the queue and the queue stores the message. HTTP, HTTPS, Lambda, mobile, SMS, and email endpoints have different delivery behavior and operational limits.

Important subscribers often use SNS-to-SQS with a DLQ on the SQS queue. That gives the subscriber its own retry, backlog, and failure-review path. If search indexing fails for a bad lesson payload, search can review its queue and DLQ without blocking email or analytics.

SNS subscriptions can also have redrive policies for supported protocols. For critical direct Lambda or HTTP subscriptions, configure failure destinations carefully and alarm on failed deliveries. A subscriber without a failure path can turn message loss into a quiet production problem.

## SNS, SQS, and EventBridge
<!-- section-summary: SQS, SNS, and EventBridge solve different communication jobs even though they can all move messages. -->

SQS, SNS, and EventBridge are easy to blur together at first because all three move messages. The job is the clean way to separate them.

| Need | Service | Northstar example |
|---|---|---|
| One worker group should process durable work | SQS | Transcode uploaded lesson videos |
| Several subscribers each need a copy of a notification | SNS | Email, search, analytics, and mobile react to `LessonPublished` |
| Events need pattern routing, archive, replay, SaaS or AWS service events, or cross-account routing | EventBridge | Route product events across application and analytics accounts |

SNS is a strong fit for fanout notifications with direct subscriber paths. EventBridge is a strong fit when event routing rules, archives, replay, schema ownership, or cross-account delivery matter more than simple topic fanout. Many AWS systems use both: SNS for immediate fanout around a service boundary, and EventBridge for broader event routing across teams.

The key is to avoid making one service pretend to be every pattern. A queue should not act like a fanout topic. A topic should not hide a long-running ordered process. An event bus should not carry private payloads that every target and archive should never see.

## Putting It Together
<!-- section-summary: SNS lets the lesson platform publish one fact and let independent subscribers process their own copies. -->

When the lesson publishing worker finishes the video, the platform publishes `LessonPublished` to SNS. SNS fans out the message to search, analytics, email, and mobile subscribers. Each subscriber can use SQS, filters, raw delivery, retries, and DLQs according to its own processing needs.

That keeps the lesson service focused on the fact it owns. It publishes the lesson notification once. Subscribers process their own copies, fail independently, and scale independently. The topic contract, message attributes, subscription policies, and alarms become the shared integration surface.

This is the concrete SNS distinction: **SNS is for fanout notification**. It is the right next step after SQS when the system changes from one worker group to many interested subscribers.

![The evidence summary shows the checks that explain whether a topic publish reached, retried, or failed a subscriber](/content-assets/articles/article-cloud-providers-aws-application-integration-sns/sns-delivery-evidence-summary.png)

*The evidence summary shows the checks that explain whether a topic publish reached, retried, or failed a subscriber.*


## What's Next
<!-- section-summary: The next article moves from topic fanout to event routing with buses, rules, targets, archives, and replay. -->

SNS gives Northstar Learn a clean fanout topic. The next step appears when events need richer routing, cross-account delivery, archives, replay, and rules owned by different teams. That is where EventBridge enters the module.

## References

- [What is Amazon SNS?](https://docs.aws.amazon.com/sns/latest/dg/welcome.html)
- [Amazon SNS topics](https://docs.aws.amazon.com/sns/latest/dg/sns-create-topic.html)
- [Amazon SNS subscriptions](https://docs.aws.amazon.com/sns/latest/dg/sns-create-subscribe-endpoint-to-topic.html)
- [Amazon SNS message filtering](https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html)
- [Amazon SNS raw message delivery](https://docs.aws.amazon.com/sns/latest/dg/sns-large-payload-raw-message-delivery.html)
- [Amazon SNS dead-letter queues](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html)
