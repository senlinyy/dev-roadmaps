---
title: "EventBridge"
description: "Route AWS, application, and SaaS events with EventBridge event buses, rules, targets, retries, archives, schedules, and cross-account delivery."
overview: "EventBridge is AWS's managed event router. This article follows the lesson publishing platform as it publishes facts to an event bus, matches them with rules, sends them to targets, handles failed delivery, archives and replays events, routes selected events across accounts, and chooses between EventBridge, SNS, and SQS."
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

1. [From Topic Fanout to Event Routing](#from-topic-fanout-to-event-routing)
2. [Events Are Facts](#events-are-facts)
3. [Event Buses, Rules, and Targets](#event-buses-rules-and-targets)
4. [Create a Custom Event Bus](#create-a-custom-event-bus)
5. [Publish an Event with PutEvents](#publish-an-event-with-putevents)
6. [Match Events with Rules](#match-events-with-rules)
7. [Send Events to Targets](#send-events-to-targets)
8. [Retries, DLQs, Archives, and Replay](#retries-dlqs-archives-and-replay)
9. [Cross-Account and SaaS Events](#cross-account-and-saas-events)
10. [EventBridge, SNS, and SQS](#eventbridge-sns-and-sqs)
11. [Putting It Together](#putting-it-together)
12. [What's Next](#whats-next)
13. [References](#references)

## From Topic Fanout to Event Routing
<!-- section-summary: EventBridge fits larger event routing where teams need rules, targets, archives, replay, and account boundaries. -->

The SNS article gave Northstar Learn a fanout topic. The lesson service publishes `LessonPublished`, and subscribers such as email, search, analytics, and mobile notifications receive their own copies. That is a clean notification pattern.

Now the platform has a broader integration need. Lesson publishing events should reach analytics in another account. Some events should start a Step Functions workflow. Some should land in a data lake loader. Product teams want to route events by source, event type, course category, and tenant. Operations wants an archive so events can be replayed after a consumer bug.

This is the EventBridge moment. **Amazon EventBridge** is AWS's managed event router. Applications, AWS services, and SaaS partners publish events. EventBridge evaluates rules and sends matching events to targets.

The main shift is from topic fanout to event routing. SNS is excellent when a publisher owns a topic and subscribers need copies. EventBridge is strong when event buses, routing rules, target ownership, archive, replay, SaaS events, or cross-account delivery are part of the design.

## Events Are Facts
<!-- section-summary: A useful event says what already happened and carries stable identifiers that consumers can use safely. -->

An **event** is a JSON record that describes something that already happened. `LessonPublished` is a fact. It tells consumers that the lesson is available. The event should avoid asking another service to do a job by name because each consumer should own its own reaction.

EventBridge events have an envelope. The fields used most often are `source`, `detail-type`, `detail`, `time`, `resources`, `account`, and `region`. Custom publishers provide the key routing fields when they call `PutEvents`.

Here is a lesson publishing event in the EventBridge shape:

```json
{
  "version": "0",
  "id": "7f4b3341-0f2b-48b7-8ec0-b8f2d2e7ad11",
  "detail-type": "LessonPublished",
  "source": "com.northstar.lessons",
  "account": "123456789012",
  "time": "2026-06-27T10:15:00Z",
  "region": "us-east-1",
  "resources": [
    "arn:aws:dynamodb:us-east-1:123456789012:table/lessons"
  ],
  "detail": {
    "eventId": "evt-01JZ0ZAT9QW5WQHC8B1RGX5G9S",
    "lessonId": "lesson-1042",
    "courseId": "course-aws-foundations",
    "tenantId": "tenant-learning",
    "courseLevel": "beginner",
    "publishedBy": "instructor-77",
    "correlationId": "req-9ef0d6c8"
  }
}
```

`source` identifies the publishing application or service area. `detail-type` names the business fact. `detail` carries the business payload. `eventId` gives consumers a stable application-level idempotency key for retries and replay.

Events can live in archives, logs, queues, and target systems. That makes payload discipline important. Keep private data out of broad events unless every target, archive, and replay path is allowed to hold it.

![The event envelope makes the event fields visible so source, detail type, time, ID, and detail do not feel like abstract JSON noise](/content-assets/articles/article-cloud-providers-aws-application-integration-event-driven-architecture/event-as-fact.png)

*The event envelope makes the event fields visible so source, detail type, time, ID, and detail do not feel like abstract JSON noise.*


## Event Buses, Rules, and Targets
<!-- section-summary: An EventBridge bus receives events, rules select matching events, and targets receive the selected events. -->

An **event bus** is the place where events are received and evaluated. AWS accounts have a default event bus, and teams can create custom event buses for application domains. Northstar Learn can use a custom bus named `northstar-publishing` for lesson publishing events.

A **rule** contains an event pattern. The pattern matches fields in the event. For example, one rule can match `source=com.northstar.lessons` and `detail-type=LessonPublished`. Another rule can match only beginner courses or only one tenant.

A **target** is the destination for matching events. EventBridge can send events to Lambda, SQS, Step Functions, Kinesis, API destinations, event buses in another account, and many other targets. A rule can have multiple targets, but each target should still have a clear owner and failure path.

The simple shape looks like this:

| EventBridge part | Northstar example | Owner |
|---|---|---|
| Event bus | `northstar-publishing` | Platform or publishing team |
| Published event | `LessonPublished` from `com.northstar.lessons` | Lesson service |
| Rule | `lesson-published-to-analytics` | Analytics team |
| Target | Analytics SQS queue or Lambda function | Analytics team |
| Archive | `lesson-publishing-archive` | Platform or publishing team |

This ownership map matters because event-driven systems can spread quickly. A bus without owners, payload contracts, target owners, and alarms can turn into a quiet integration tangle.

## Create a Custom Event Bus
<!-- section-summary: A custom bus gives application events a clear routing boundary separate from the account default bus. -->

The command below creates a custom event bus for Northstar publishing events:

```bash
aws events create-event-bus \
  --name northstar-publishing
```

Example output:

```json
{
  "EventBusArn": "arn:aws:events:us-east-1:123456789012:event-bus/northstar-publishing"
}
```

The ARN is the full bus identifier. Producers use the bus name or ARN when they call `PutEvents`. Rules and archives also refer to this bus.

The default event bus is useful for many AWS service events. A custom bus gives application events a named home and clearer permissions. The lesson service can receive permission to publish to `northstar-publishing` without receiving broader permissions on every event bus in the account.

## Publish an Event with PutEvents
<!-- section-summary: PutEvents sends custom application events to a bus and returns per-entry success or failure details. -->

The lesson service publishes events with `PutEvents`. The command below sends one `LessonPublished` entry. `Detail` is a JSON string because EventBridge accepts the business payload as a string field in the request.

```bash
aws events put-events \
  --entries '[
    {
      "EventBusName": "northstar-publishing",
      "Source": "com.northstar.lessons",
      "DetailType": "LessonPublished",
      "Detail": "{\"eventId\":\"evt-01JZ0ZAT9QW5WQHC8B1RGX5G9S\",\"lessonId\":\"lesson-1042\",\"courseId\":\"course-aws-foundations\",\"tenantId\":\"tenant-learning\",\"courseLevel\":\"beginner\",\"publishedBy\":\"instructor-77\",\"correlationId\":\"req-9ef0d6c8\"}"
    }
  ]'
```

Example output:

```json
{
  "FailedEntryCount": 0,
  "Entries": [
    {
      "EventId": "7f4b3341-0f2b-48b7-8ec0-b8f2d2e7ad11"
    }
  ]
}
```

`FailedEntryCount` is the first field to check. A value of `0` means EventBridge accepted the entry. The returned `EventId` identifies the EventBridge event, while the `detail.eventId` inside the payload remains the application-level idempotency key used by consumers.

In production code, a failed `PutEvents` call needs retry handling. Many teams use an outbox pattern around domain events so a database commit and event publication can recover cleanly if one side succeeds and the other side fails.

## Match Events with Rules
<!-- section-summary: Event patterns select events by envelope fields and detail fields before delivery to targets. -->

An **event pattern** is JSON that tells EventBridge which events a rule should match. The pattern below matches lesson-published events for beginner courses.

```json
{
  "source": [
    "com.northstar.lessons"
  ],
  "detail-type": [
    "LessonPublished"
  ],
  "detail": {
    "courseLevel": [
      "beginner"
    ]
  }
}
```

`source` and `detail-type` match the EventBridge envelope. `detail.courseLevel` matches a field inside the business payload. This is why event field names should stay stable and documented.

The test command below checks the pattern against a sample event before the rule is created:

```bash
aws events test-event-pattern \
  --event-pattern file://lesson-published-beginner-pattern.json \
  --event file://lesson-published-event.json
```

Example output:

```json
{
  "Result": true
}
```

`Result: true` means the sample event matches the pattern. This command is useful in reviews because small JSON shape mistakes can make a rule silently miss events.

The command below creates the rule on the custom bus:

```bash
aws events put-rule \
  --event-bus-name northstar-publishing \
  --name lesson-published-beginner-to-search \
  --event-pattern file://lesson-published-beginner-pattern.json \
  --state ENABLED
```

Example output:

```json
{
  "RuleArn": "arn:aws:events:us-east-1:123456789012:rule/northstar-publishing/lesson-published-beginner-to-search"
}
```

The rule now exists, but it still needs a target. A rule without a target matches events and has nowhere useful to send them.

![The rules view shows how event patterns select targets and why routing belongs in the bus rule rather than hidden application code](/content-assets/articles/article-cloud-providers-aws-application-integration-event-driven-architecture/event-bus-rules-targets.png)

*The rules view shows how event patterns select targets and why routing belongs in the bus rule rather than hidden application code.*


## Send Events to Targets
<!-- section-summary: Targets receive matching events, and each target should have permissions, retry behavior, and failure handling. -->

The command below attaches an SQS queue target to the rule. This lets the search team process matched events from its own durable queue.

```bash
aws events put-targets \
  --event-bus-name northstar-publishing \
  --rule lesson-published-beginner-to-search \
  --targets '[
    {
      "Id": "search-index-queue",
      "Arn": "arn:aws:sqs:us-east-1:123456789012:lesson-search-index-events",
      "DeadLetterConfig": {
        "Arn": "arn:aws:sqs:us-east-1:123456789012:eventbridge-target-dlq"
      },
      "RetryPolicy": {
        "MaximumRetryAttempts": 8,
        "MaximumEventAgeInSeconds": 3600
      }
    }
  ]'
```

Example output:

```json
{
  "FailedEntryCount": 0,
  "FailedEntries": []
}
```

`FailedEntryCount: 0` means EventBridge accepted the target configuration. The SQS queue also needs a queue policy that allows `events.amazonaws.com` to send messages from this rule. Without that resource policy, the rule can exist while delivery fails.

Targets can receive the full event by default. EventBridge also supports input transformers. A transformer can pass a smaller payload to a target when the target only needs selected fields.

```json
{
  "InputPathsMap": {
    "lessonId": "$.detail.lessonId",
    "courseId": "$.detail.courseId",
    "eventId": "$.detail.eventId"
  },
  "InputTemplate": "{\"jobType\":\"IndexLesson\",\"lessonId\":\"<lessonId>\",\"courseId\":\"<courseId>\",\"eventId\":\"<eventId>\"}"
}
```

This transformer produces a search job shape instead of the full event envelope. It is target configuration, so the rule owner should document it. A transformer can help keep target messages small, but it also creates another contract that needs review when event fields change.

The command below lists rules on the custom bus. It gives operators a quick way to confirm whether the expected rule is enabled.

```bash
aws events list-rules \
  --event-bus-name northstar-publishing \
  --query 'Rules[].{Name:Name,State:State,EventPattern:EventPattern}' \
  --output table
```

Example output:

```bash
-----------------------------------------------------------------------------------------
|                                      ListRules                                        |
+------------------------------------+----------+---------------------------------------+
| Name                               | State    | EventPattern                          |
+------------------------------------+----------+---------------------------------------+
| lesson-published-beginner-to-search| ENABLED  | {"source":["com.northstar.lessons"]...|
+------------------------------------+----------+---------------------------------------+
```

If the rule is disabled, no matching events reach its targets. If the rule is enabled and target delivery still fails, check target resource policy, failed invocation metrics, DLQ messages, and retry settings.

## Retries, DLQs, Archives, and Replay
<!-- section-summary: EventBridge delivery needs a failure path, and archives let teams replay events after a consumer bug. -->

EventBridge retries failed target delivery for a configured time window and attempt count. A target DLQ gives failed events a place to land after retries. For SQS, Lambda, and Step Functions targets, DLQs and target policies should be part of the infrastructure review rather than a last-minute incident fix.

An **archive** stores events from a bus that match a pattern. Archives are useful when a consumer bug drops or mishandles events. After the bug is fixed, teams can replay the archived events into a bus for reprocessing.

The command below creates an archive for lesson events and keeps matching events for 30 days:

```bash
aws events create-archive \
  --archive-name lesson-publishing-archive \
  --event-source-arn arn:aws:events:us-east-1:123456789012:event-bus/northstar-publishing \
  --event-pattern '{"source":["com.northstar.lessons"]}' \
  --retention-days 30
```

Example output:

```json
{
  "ArchiveArn": "arn:aws:events:us-east-1:123456789012:archive/lesson-publishing-archive",
  "State": "ENABLED"
}
```

The archive pattern keeps the archive focused on lesson events. Retention controls how long events stay available for replay. Teams should treat archive data as production data because it may contain business identifiers.

The command below starts a replay for a one-hour window. It sends archived events back to the same event bus.

```bash
aws events start-replay \
  --replay-name replay-search-index-2026-06-27 \
  --event-source-arn arn:aws:events:us-east-1:123456789012:archive/lesson-publishing-archive \
  --event-start-time 2026-06-27T09:00:00Z \
  --event-end-time 2026-06-27T10:00:00Z \
  --destination '{"Arn":"arn:aws:events:us-east-1:123456789012:event-bus/northstar-publishing"}'
```

Example output:

```json
{
  "ReplayArn": "arn:aws:events:us-east-1:123456789012:replay/replay-search-index-2026-06-27",
  "State": "STARTING"
}
```

Replay makes idempotency mandatory. Search indexing should use `detail.eventId` or `lessonId` to avoid duplicate records. Analytics should handle repeated events without double-counting. Replayed events are powerful because they can repair missed processing, and they can also repeat side effects when consumers are careless.

## Cross-Account and SaaS Events
<!-- section-summary: EventBridge can route selected events across accounts and ingest supported SaaS partner events. -->

Larger AWS environments often separate accounts by workload, environment, or team. Northstar Learn may run lesson publishing in an application account and analytics in a data account. EventBridge can send selected events from one account to an event bus in another account when bus policies allow it.

Cross-account routing gives platform teams a controlled way to share events. The publishing account can publish `LessonPublished`, and a rule can send those events to the analytics account bus. The analytics team then owns its own rules and targets inside its account.

EventBridge also integrates with many AWS service events and supported SaaS partner event sources. This lets teams route events from AWS services, custom applications, and SaaS tools through one event pattern and target model.

Cross-account and SaaS designs need clear data rules. An event that is safe inside one application account may expose too much when sent to analytics, security, or a partner-integrated bus. Keep the payload small, document owners, and treat event schemas as public contracts inside the organization.

## EventBridge, SNS, and SQS
<!-- section-summary: EventBridge routes facts by pattern, SNS fans out notifications, and SQS stores work for one consumer group. -->

EventBridge, SNS, and SQS can all appear in the same lesson publishing system. The difference is the communication job.

| Need | Best starting service | Example |
|---|---|---|
| One consumer group needs durable work | SQS | Transcode uploaded video |
| Several subscribers need a direct notification copy | SNS | Email, search, analytics, and mobile receive `LessonPublished` |
| Teams need event routing rules, replay, archives, or cross-account delivery | EventBridge | Route product events to analytics, data lake, workflows, and account-level consumers |

EventBridge works well for business event routing. SNS works well for topic fanout. SQS works well for durable work. Combining them is normal. For example, EventBridge can route `LessonPublished` to an SQS queue target so the search team gets a durable backlog from a routed event rule.

The design should name the owner of each contract. The lesson service owns the event fields it publishes. The platform team may own the event bus. Each consumer team owns its rule, target, alarms, and idempotency behavior.

## Putting It Together
<!-- section-summary: EventBridge gives the publishing platform routed events that can be owned, inspected, archived, and replayed. -->

Northstar Learn now has a custom event bus for lesson publishing. The lesson service publishes `LessonPublished` with stable fields. Rules match events for search, analytics, data lake loading, and workflow starts. Targets receive the matching events with retry policies and DLQs.

The archive gives the team a recovery tool after consumer bugs. Replay gives the team a way to reprocess selected events. Cross-account routing lets analytics own its processing in a separate account while the lesson service continues publishing the same fact.

This is the concrete EventBridge distinction: **EventBridge is for routed events**. It fits the point where application integration needs more than one topic fanout path and starts needing rules, targets, account boundaries, archives, replay, and event ownership.

![The operations summary connects retries, DLQs, archives, replay, event IDs, and target logs into one event-recovery path](/content-assets/articles/article-cloud-providers-aws-application-integration-event-driven-architecture/event-operations-summary.png)

*The operations summary connects retries, DLQs, archives, replay, event IDs, and target logs into one event-recovery path.*


## What's Next
<!-- section-summary: The next article uses Step Functions when the publishing process needs visible steps, branches, retries, waits, and final state. -->

Events are good for facts and reactions. The final article in this module covers a different need: one publish request has a sequence of steps that should be visible and controlled from start to finish. Step Functions gives that process a state machine.

## References

- [What is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html)
- [Amazon EventBridge event buses](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html)
- [Amazon EventBridge events](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-events.html)
- [Amazon EventBridge event patterns](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html)
- [Amazon EventBridge targets](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-targets.html)
- [Amazon EventBridge archives and replay](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html)
- [Sending and receiving Amazon EventBridge events between AWS accounts](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-cross-account.html)
