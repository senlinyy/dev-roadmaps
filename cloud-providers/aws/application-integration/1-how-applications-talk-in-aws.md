---
title: "How Applications Talk in AWS"
description: "Learn how AWS applications communicate through direct APIs, queues, pub/sub topics, event buses, workflows, schedulers, and brokers."
overview: "Application integration is the set of choices that decides how one AWS service talks to another. This article follows one production publishing system and shows when a service should call another service directly, place work on a queue, or publish an event for other systems to react to."
tags: ["aws", "application-integration", "api-gateway", "sqs", "sns", "eventbridge", "step-functions", "amazon-mq"]
order: 1
id: article-cloud-providers-aws-application-integration-how-applications-talk-in-aws
aliases:
  - how-applications-talk-in-aws
  - applications-talk-in-aws
  - application-integration-communication-patterns
  - cloud-providers/aws/application-integration/how-applications-talk-in-aws.md
  - cloud-providers/aws/application-integration/1-how-applications-talk-in-aws.md
---

## Table of Contents

1. [The Production Scenario](#the-production-scenario)
2. [The First Communication Decision](#the-first-communication-decision)
3. [Synchronous APIs and Amazon API Gateway](#synchronous-apis-and-amazon-api-gateway)
4. [Queues and Amazon SQS](#queues-and-amazon-sqs)
5. [Pub/Sub Topics and Amazon SNS](#pubsub-topics-and-amazon-sns)
6. [Event Buses and Amazon EventBridge](#event-buses-and-amazon-eventbridge)
7. [Workflows and AWS Step Functions](#workflows-and-aws-step-functions)
8. [Schedulers and EventBridge Scheduler](#schedulers-and-eventbridge-scheduler)
9. [Brokers and Amazon MQ](#brokers-and-amazon-mq)
10. [Putting the Patterns Together](#putting-the-patterns-together)
11. [What's Next](#whats-next)

## The Production Scenario
<!-- section-summary: One publishing system gives every integration pattern a real place in the same application. -->

Imagine a company called Northstar Learn. It sells online training to companies, and its main product lets instructors upload lessons, schedule them for release, send learner notifications, and sync enrollment data from older customer systems. The product has a web app, a lesson service, a media processing service, a notification service, an analytics pipeline, and one old enterprise integration that still speaks a broker protocol from before the AWS migration.

At first, all of this can look like one large "send data from here to there" problem. In production, the shape of the communication matters a lot. A browser clicking **Publish lesson** needs a fast answer. A video transcode can take minutes. A search index, analytics system, and email service may all care that a lesson is available, but the lesson service should not need custom code for every future team that cares about that fact.

That is what **application integration** means in AWS. It is the set of services and patterns that let applications talk without forcing every part of the system to know too much about every other part. The same product can use direct APIs, queues, events, workflows, schedules, and brokers because each pattern solves a different production problem.

The central decision in this article is simple enough to remember: **call directly when the caller needs an answer now, place work on a queue when one worker needs durable work to finish later, and publish an event when something happened and other systems may want to react**. Everything else in this module builds on that decision.

## The First Communication Decision
<!-- section-summary: Direct calls, queues, and events answer three different questions about timing, ownership, and coupling. -->

A **synchronous API call** means the caller sends a request and waits for a response. The caller usually needs that answer before it can continue. For example, the Northstar web app calls the lesson service to ask, "Can this instructor publish this lesson right now?" The page needs a success or failure response, so a direct request makes sense.

A **queue** stores work until a worker is ready to process it. The producer places a message on the queue, and a consumer picks it up later. For example, the lesson service can put a `TranscodeLessonVideo` message on a queue after upload. The instructor does not need to keep the browser open while a worker creates several video sizes, thumbnails, and captions.

An **event** describes something that already happened. The producer publishes the event, and interested consumers react. For example, after a lesson is available, the lesson service can publish `LessonPublished`. The email service can send a message to learners, the analytics pipeline can record the launch, and the search service can update the index.

These three choices keep teams from tying every service together with direct calls. Direct calls are still useful because users need answers. Queues are useful because background work needs durability. Events are useful because the producer should not need to know every reaction that the business invents next quarter.

| Question | Pattern | AWS services in this article |
|---|---|---|
| Does the caller need an answer before it continues? | **Synchronous API** | Amazon API Gateway, backend services, Lambda |
| Does one worker need durable work to finish later? | **Queue** | Amazon SQS |
| Did something happen that other systems may care about? | **Pub/sub or event routing** | Amazon SNS, Amazon EventBridge |
| Does the process have several steps, retries, branches, or waits? | **Workflow** | AWS Step Functions |
| Does the work need to start at a time or on a recurring schedule? | **Scheduler** | EventBridge Scheduler |
| Does an existing app require a standard broker protocol? | **Broker** | Amazon MQ |

The rest of the article walks through these choices in the order a real feature often grows. The first step is the user-facing request, because every production system has at least one moment where a user or another application needs an answer right now.

## Synchronous APIs and Amazon API Gateway
<!-- section-summary: Direct API calls fit request-response moments where the caller needs a clear answer immediately. -->

A **synchronous API** is a request-response contract. One application calls another application, waits for the response, and uses that response to decide the next step. In AWS, **Amazon API Gateway** is the managed service teams often use as the front door for HTTP APIs, REST APIs, and WebSocket APIs. It can route requests to Lambda functions, HTTP backends, and other AWS integrations while handling API concerns such as authorization, throttling, logging, stages, and custom domains.

In the Northstar system, the browser calls `POST /lessons/{lessonId}/publish` through API Gateway. API Gateway checks authentication and routes the request to the lesson service. The lesson service validates the instructor, checks that the lesson has a title, confirms that a video upload exists, writes the first publish record, and returns a response with a `publishRequestId`.

That direct call fits because the web app needs a quick answer it can show to the instructor. A good response might say that publishing started and show a progress page. A failed response might say the lesson cannot publish because the uploaded video is missing. The user experience depends on that immediate response, so a queue or event alone would leave the page guessing.

The API contract should stay small and honest. The direct API call should validate the request, create the durable record, and hand off slow work. It should avoid doing a full video transcode, sending every notification, and updating every downstream system before returning to the browser. Long work inside a synchronous request turns a user action into a timeout problem.

Here is a small request and response shape for the publish API. The request names the lesson and carries an idempotency key, while the response gives the UI a durable handle for progress.

```json
{
  "lessonId": "lesson-7429",
  "requestedBy": "instructor-118",
  "idempotencyKey": "publish-lesson-7429-2026-06-13"
}
```

```json
{
  "publishRequestId": "pubreq-4db2",
  "status": "accepted",
  "message": "Publishing has started."
}
```

The **idempotency key** matters in real systems. Idempotency means the same request can be safely retried without creating duplicate work. A browser may retry after a network error, API Gateway may see a client disconnect, or a mobile app may send the request again. The lesson service can store the idempotency key with the publish request and return the existing `publishRequestId` when the same action arrives again.

For direct APIs, teams usually define a few production rules early. The API should have clear status codes, request validation, authentication, access logs, metrics, rate limits, and a timeout budget. The backend should call only the services needed to answer the current request. Slow side effects should move to SQS, SNS, EventBridge, or Step Functions so the API remains predictable for users.

The publish API has now accepted the user's request. The next question is what to do with the video processing work that may take minutes and may need retries.

## Queues and Amazon SQS
<!-- section-summary: Queues hold durable work for workers, so slow or spiky processing does not block the user-facing API. -->

A **queue** is a place where one part of the system leaves a message and another part picks it up later. The producer and consumer do not need to run at the same speed. In AWS, **Amazon Simple Queue Service**, usually called **Amazon SQS**, provides managed queues that store messages durably and let worker applications process them.

In the Northstar system, the lesson service sends a message to an SQS queue called `lesson-media-jobs` after the publish API accepts the request. A media worker reads from the queue and creates thumbnails, lower-resolution video copies, captions, and a final playback manifest. If one hundred instructors publish lessons after a live workshop, the queue absorbs the spike while the worker fleet processes messages at the pace it can handle.

That queue changes the failure story. If the media worker crashes halfway through a job, the message can return to the queue after the **visibility timeout** expires. The visibility timeout is the period where SQS hides a received message from other consumers while one worker processes it. The worker deletes the message only after the job finishes successfully, so a crash does not automatically lose the work.

Here is the kind of message the lesson service can place on the queue. It carries the work request and points the worker to the uploaded file instead of carrying the whole video.

```json
{
  "jobType": "TranscodeLessonVideo",
  "publishRequestId": "pubreq-4db2",
  "lessonId": "lesson-7429",
  "sourceVideoKey": "uploads/lesson-7429/original.mp4",
  "requestedAt": "2026-06-13T10:15:30Z"
}
```

The message should contain enough information for the worker to find the real data, but it should not carry a huge payload. A common production pattern stores large files in Amazon S3 and sends object keys through SQS. The message acts as a durable pointer to the work, and S3 holds the heavy content.

Queues also need a plan for bad messages. A **dead-letter queue**, often shortened to **DLQ**, receives messages that fail too many times. For example, if the source video file was deleted or has an unsupported format, retrying the same message forever wastes worker capacity. The DLQ gives operators a place to inspect the failed job, fix the data, or replay it after a bug fix.

SQS offers **Standard queues** and **FIFO queues**. Standard queues maximize throughput and provide at-least-once delivery, so workers must handle the possibility that the same message arrives more than once. FIFO queues preserve order within a message group and support exactly-once processing behavior from the queue side. Many production systems still write idempotent consumers because downstream APIs, retries, and worker crashes can create repeated effects outside the queue itself.

The practical rule is this: a queue is a good fit when there is a clear unit of work and one consumer group owns that work. The media worker owns video processing, so SQS fits well. Once the media worker finishes, a different pattern is useful because several systems may care that the media is ready.

## Pub/Sub Topics and Amazon SNS
<!-- section-summary: Pub/sub topics push the same message to several subscribers without making the publisher call each one directly. -->

**Pub/sub** means publish and subscribe. A publisher sends one message to a topic, and the topic delivers copies to its subscribers. In AWS, **Amazon Simple Notification Service**, usually called **Amazon SNS**, is the managed topic service that can deliver messages to SQS queues, Lambda functions, HTTP endpoints, email, SMS, mobile push, and other supported endpoints.

In the Northstar system, the media worker finishes the transcode job and publishes `LessonMediaReady` to an SNS topic. The lesson service can subscribe a queue that updates publish status. The notification service can subscribe a different queue that prepares instructor-facing alerts. The analytics service can subscribe another queue to record processing time and video format details.

This is called **fanout**. One publisher sends one message, and the topic fans it out to multiple subscribers. The publisher does not need three direct API clients, three retry policies, and three different failure paths. Each subscriber can own its queue and process the same fact in its own way.

Here is a simple SNS message body. It describes the completed media artifact and avoids naming the services that may subscribe later.

```json
{
  "eventType": "LessonMediaReady",
  "lessonId": "lesson-7429",
  "publishRequestId": "pubreq-4db2",
  "videoManifestKey": "processed/lesson-7429/manifest.m3u8",
  "readyAt": "2026-06-13T10:19:42Z"
}
```

For application-to-application delivery, a common production shape is **SNS topic to SQS queue**. SNS pushes a copy of the message into each subscribed queue, and each consuming service reads from its own queue. This gives every subscriber its own retry behavior, DLQ, permissions, and scaling settings. If analytics is down, the lesson status updater can still continue.

SNS works well when the publisher knows the topic and wants immediate fanout. It is also useful for simple notifications to people or systems, such as email, SMS, mobile push, and HTTPS endpoints. For larger event-driven systems, another AWS service often appears because teams need richer routing across many event sources and many targets.

That leads to EventBridge. SNS can fan out a message quickly, while EventBridge gives the organization a central event bus with rules, filtering, and routing for domain events across services.

## Event Buses and Amazon EventBridge
<!-- section-summary: Event buses route business events across teams so producers and consumers can stay loosely connected. -->

An **event bus** is a router for events. A producer puts an event onto the bus, rules inspect the event, and matching targets receive it. In AWS, **Amazon EventBridge** provides event buses for events from custom applications, AWS services, and supported third-party software. It also supports rules that filter events and deliver them to targets such as Lambda, SQS, SNS, Step Functions, API destinations, and other AWS services.

In Northstar, `LessonPublished` is a business event. It says a lesson became available to learners. The lesson service owns that fact, but many other systems may react: search indexes the lesson, recommendations recalculates course suggestions, billing updates usage, audit stores a compliance record, and the data platform loads the event into a warehouse.

The event should describe the business fact instead of telling every consumer what to do. A command message might say `SendLearnerEmail`, which belongs to one workflow. A domain event says `LessonPublished`, which gives future systems room to react without changing the publisher. This difference helps the lesson service stay focused on lesson state instead of becoming the central coordinator for every downstream feature.

Here is an EventBridge event shape. The source and detail type give rules stable fields to match, and the detail carries the business data consumers need.

```json
{
  "Source": "northstar.lesson-service",
  "DetailType": "LessonPublished",
  "Detail": {
    "lessonId": "lesson-7429",
    "courseId": "course-204",
    "publishedAt": "2026-06-13T10:21:05Z",
    "audience": "enterprise-customers"
  }
}
```

EventBridge rules can route this event by source, detail type, or fields inside the detail. A search rule can match every `LessonPublished` event. A billing rule can match only lessons with an enterprise audience. An audit rule can match a wider set of lesson events, such as `LessonPublished`, `LessonUnpublished`, and `LessonArchived`.

Event buses need governance because events become shared contracts. Teams usually choose stable event names, version event detail carefully, document required fields, and avoid removing fields that consumers may depend on. They also decide which account owns the bus, which producers can put events on it, and which targets receive which event types.

The difference between SNS and EventBridge is practical. SNS is often the simple topic for fanout from one publisher to a set of subscribers. EventBridge is often the event routing layer for many producers, many rules, and many targets across an application or organization. Both are useful, and many real systems use SNS for local fanout and EventBridge for cross-service domain events.

Now the platform can accept a publish request, process media in the background, fan out a media-ready message, and publish a business event. The next production issue is coordination, because publishing may require several steps with branches, retries, waits, and human approval.

## Workflows and AWS Step Functions
<!-- section-summary: Workflows coordinate multi-step processes so retry, branching, waiting, and visibility do not hide inside one service. -->

A **workflow** is a controlled series of steps. Each step can call a service, wait, branch, retry, catch an error, or run work in parallel. In AWS, **AWS Step Functions** lets teams model workflows as state machines. A state machine is the workflow definition, and an execution is one running instance of that workflow.

In Northstar, lesson publishing can grow beyond one queue message. A real publish flow may scan the uploaded file, transcode video, generate captions, wait for moderation on high-risk content, update lesson status, publish events, and notify learners. If all of that logic lives inside one Lambda function or one worker process, retries and partial failures can become hard to see.

Step Functions gives the process a visible shape. A `ScanVideo` step can retry temporary scanner errors. A `TranscodeVideo` step can wait for a longer media job to finish. A `Choice` step can send a lesson to human review when the content scanner flags it. A final step can publish `LessonPublished` to EventBridge after all required work succeeds.

Here is a shortened workflow idea. The real state machine would include full IAM roles, error handling, and service-specific parameters, but this small version shows the shape of the orchestration.

```json
{
  "StartAt": "ScanVideo",
  "States": {
    "ScanVideo": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Next": "NeedsReview"
    },
    "NeedsReview": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.scan.requiresReview",
          "BooleanEquals": true,
          "Next": "WaitForReview"
        }
      ],
      "Default": "TranscodeVideo"
    },
    "WaitForReview": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
      "Next": "TranscodeVideo"
    },
    "TranscodeVideo": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Next": "PublishLessonEvent"
    },
    "PublishLessonEvent": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents",
      "End": true
    }
  }
}
```

This example shows two important workflow ideas. First, each step has a clear job, so the workflow can show where an execution is waiting or failing. Second, the workflow can call other AWS services directly through service integrations, including Lambda, SQS, SNS, and EventBridge. The orchestration logic lives in Step Functions instead of being spread across several services through custom callback code.

Step Functions has **Standard workflows** and **Express workflows**. Standard workflows fit long-running, auditable processes that may need execution history and visual debugging. Express workflows fit high-volume, shorter-running processes. A lesson publishing process with moderation and durable audit history usually starts as a Standard workflow.

A workflow is a good fit when the business process has named steps and the team wants to see progress. A queue is still better for a simple worker-owned job. An event bus is still better for announcing that something happened. Step Functions sits in the middle when the system needs orchestration rather than only communication.

Publishing also has a time problem. Some lessons should go live immediately, but instructors often schedule a lesson for Monday morning or run a cleanup every night.

## Schedulers and EventBridge Scheduler
<!-- section-summary: Schedulers start work at a specific time or recurring interval without a server waiting in a loop. -->

A **scheduler** starts work at a time you choose. That time can be a one-time timestamp, a recurring rate, or a cron expression. In AWS, **EventBridge Scheduler** is the managed scheduler for creating, running, and managing schedules that target AWS services and API operations.

In Northstar, an instructor may choose "publish this lesson next Monday at 9:00 AM London time." The lesson service can store the draft lesson and create a one-time schedule. At the scheduled time, EventBridge Scheduler can start the Step Functions publishing workflow, send a message to SQS, invoke Lambda, publish to SNS, put an event on EventBridge, or call many other AWS API operations.

This avoids a common beginner mistake: running a service that wakes up every minute, scans a database for due work, and tries to trigger jobs manually. That polling service needs deployment, scaling, logs, retries, and ownership. EventBridge Scheduler gives the schedule its own managed resource, with retry settings and flexible time windows for workloads that do not require exact second-level timing.

A schedule target should receive enough input to start the real process. The target can load the full lesson record from the database and use this payload as the durable trigger.

```json
{
  "target": "StartLessonPublishWorkflow",
  "input": {
    "lessonId": "lesson-7429",
    "publishRequestId": "pubreq-4db2",
    "requestedBy": "instructor-118"
  },
  "scheduledFor": "2026-06-15T09:00:00+01:00"
}
```

The practical setup has three parts. The schedule needs an expression or timestamp, a target API operation, and an IAM role that lets EventBridge Scheduler call that target. The target should also be idempotent, because reliable schedulers can retry failed deliveries. If the publish workflow starts twice with the same `publishRequestId`, the workflow should detect the existing execution or safely return the current state.

Schedulers fit time-based starts. They do not replace queues, events, or workflows. In Northstar, the scheduler starts the publishing workflow at the right time, Step Functions coordinates the workflow, SQS handles worker-owned jobs, and EventBridge announces the final business event.

One final pattern appears during migrations and enterprise integrations. Some applications already depend on a broker protocol, and replacing that protocol may take years.

## Brokers and Amazon MQ
<!-- section-summary: Brokers help existing applications keep using standard messaging protocols during migration or hybrid integration. -->

A **message broker** is a server that applications connect to using a messaging protocol. The broker can support queues, topics, routing, acknowledgements, and connection-level behavior that client libraries expect. In AWS, **Amazon MQ** is a managed broker service for Apache ActiveMQ Classic and RabbitMQ. It supports standard messaging protocols such as JMS, AMQP, MQTT, OpenWire, and STOMP depending on the broker engine.

Northstar has one older enterprise customer integration from before the AWS migration. That customer sends enrollment updates through a JMS application that expects an ActiveMQ-style broker. Rewriting the customer system may take a long contract cycle, so Northstar can run an Amazon MQ broker and connect a bridge service that reads enrollment messages and turns them into AWS-native events.

This is a different choice from SQS or SNS. SQS and SNS give simple AWS APIs for cloud-native queues and topics. Amazon MQ gives protocol compatibility for applications that already use broker clients, transactions, routing semantics, or operational expectations from ActiveMQ or RabbitMQ. Teams usually choose Amazon MQ for migration, hybrid systems, or vendor software that cannot easily switch to SQS, SNS, or EventBridge.

The bridge service should make the boundary explicit. It can read an `EnrollmentChanged` message from Amazon MQ, validate and normalize the payload, write a durable processing record, and publish a `LearnerEnrollmentChanged` event to EventBridge. After that point, the rest of the AWS application can use the same event bus patterns as newer services.

Amazon MQ still needs production ownership. The team should choose the broker engine deliberately, configure private networking where appropriate, use encryption in transit and at rest, monitor broker and queue metrics in CloudWatch, define maintenance windows, and test failover behavior. Managed broker service does not remove the need to understand broker semantics, but it removes much of the setup and maintenance burden compared with running brokers by hand.

With brokers covered, the whole communication picture is ready. Each service now has a reason to exist, and each pattern has a place in the same publishing system.

## Putting the Patterns Together
<!-- section-summary: A production system often combines APIs, queues, events, workflows, schedules, and brokers in one connected flow. -->

Here is the Northstar publishing flow as one connected story. The browser calls API Gateway because the instructor needs an immediate response. The lesson service validates the request, stores a durable publish record, and returns a `publishRequestId` so the UI can show progress.

The service places video processing work on SQS because transcoding is slow and worker-owned. The media worker reads the message, processes the video, deletes the message after success, and relies on a DLQ for jobs that repeatedly fail. The worker then publishes `LessonMediaReady` to SNS so multiple subscribers can receive the same media-ready fact through their own queues.

The lesson service publishes `LessonPublished` to EventBridge because a business event may matter to many systems now and later. Rules route the event to search, billing, audit, recommendations, analytics, and any future consumer that gets permission to subscribe. The event name and payload become part of the product's shared contract.

Step Functions coordinates the full publish workflow when the process has several steps, decisions, retries, or waits. EventBridge Scheduler starts that workflow for lessons that should publish at a future time. Amazon MQ supports the older JMS enrollment integration while a bridge service converts broker messages into the same EventBridge event language used by the newer platform.

The decision table now has production meaning. Each row maps the same Northstar scenario to the pattern that matches its timing, ownership, and coupling.

| Situation in Northstar | Better pattern | Why it fits |
|---|---|---|
| Browser asks to publish a lesson | **Direct API through API Gateway** | The user needs a fast accepted or rejected response. |
| Video needs transcoding | **SQS queue** | One worker group owns durable background work. |
| Media processing finished | **SNS topic with SQS subscribers** | Several known services need the same message and independent retries. |
| Lesson became available | **EventBridge event bus** | Many current and future systems can react to a business event. |
| Publishing has scan, review, transcode, and event steps | **Step Functions workflow** | The process needs visible orchestration, retry, branching, and waiting. |
| Lesson should go live Monday morning | **EventBridge Scheduler** | The system needs a managed time-based trigger. |
| Old customer system speaks JMS | **Amazon MQ** | The integration needs broker protocol compatibility during migration. |

Most application integration mistakes come from using one pattern everywhere. Direct calls everywhere create timeout chains and tight coupling. Queues everywhere hide business facts from other teams. Events everywhere can make request-response flows awkward. A healthy AWS architecture uses the pattern that matches the timing, ownership, and reaction model of the work.

## What's Next

You now have the core application integration map for AWS. The important part is the decision, not the service names by themselves. Direct APIs answer now, queues finish work later, events announce facts, workflows coordinate steps, schedulers start work at a time, and brokers support protocol-heavy systems.

The next articles can go deeper into each pattern. API Gateway has authorization, integrations, stages, throttling, and deployment choices. SQS has visibility timeouts, DLQs, FIFO behavior, batching, and idempotent consumers. EventBridge and Step Functions open the door to larger event-driven and workflow-based systems.

---

**References**

- [What is Amazon API Gateway?](https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html) - Official API Gateway overview for HTTP, REST, and WebSocket APIs, backend integrations, traffic management, authorization, monitoring, and API operations.
- [What is Amazon Simple Queue Service?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html) - Official SQS overview for managed queues, durability, visibility timeout, message lifecycle, dead-letter queues, Standard queues, and FIFO queues.
- [What is Amazon SNS?](https://docs.aws.amazon.com/sns/latest/dg/welcome.html) - Official SNS overview for topics, publishers, subscribers, supported endpoints, and fanout scenarios.
- [What is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html) - Official EventBridge overview for event buses, rules, sources, targets, pipes, and Scheduler.
- [What is Step Functions?](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html) - Official Step Functions overview for state machines, executions, Standard and Express workflows, service integrations, retries, choices, and callbacks.
- [What is Amazon EventBridge Scheduler?](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html) - Official Scheduler overview for one-time schedules, cron and rate expressions, templated targets, universal targets, retries, and flexible time windows.
- [What is Amazon MQ?](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/welcome.html) - Official Amazon MQ overview for managed ActiveMQ Classic and RabbitMQ brokers, standard protocols, broker monitoring, encryption, and migration use cases.
