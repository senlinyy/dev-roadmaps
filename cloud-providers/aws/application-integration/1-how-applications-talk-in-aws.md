---
title: "How Applications Talk in AWS"
description: "Learn how AWS applications communicate through request/response APIs, queues, topics, event buses, and workflows."
overview: "Application integration starts with one app needing to call another thing. This article follows a lesson publishing feature as it grows from a direct API call into queues, fanout notifications, routed events, and visible workflows."
tags: ["aws", "application-integration", "api-gateway", "sqs", "sns", "eventbridge", "step-functions"]
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

1. [Start With One App Calling Another Thing](#start-with-one-app-calling-another-thing)
2. [The First Direct API](#the-first-direct-api)
3. [When Work Needs to Wait](#when-work-needs-to-wait)
4. [When Many Systems Need the Same News](#when-many-systems-need-the-same-news)
5. [When Events Need Routing Rules](#when-events-need-routing-rules)
6. [When the Process Has Several Steps](#when-the-process-has-several-steps)
7. [Service-by-Job Map](#service-by-job-map)
8. [A First Debugging Path](#a-first-debugging-path)
9. [What's Next](#whats-next)
10. [References](#references)

## Start With One App Calling Another Thing
<!-- section-summary: Application integration starts with one program needing a safe way to ask another program or service for help. -->

Picture a learning platform called Northstar Learn. An instructor edits a lesson, uploads a video, writes a description, and clicks **Publish lesson**. The web app sends the request to a backend service, and that backend has to talk to other things before the lesson can reach learners.

At the smallest size, the backend only needs one answer. It asks the lesson service whether the lesson is ready. Does the instructor own it? Does the lesson have a title? Did the video upload finish? The web page waits because it needs a clear response to show the instructor.

That first call is the beginning of **application integration**. Application integration means the patterns and AWS services that help one application component communicate with another component. The communication may happen during a user request, after the request finishes, after a business event happens, or across a full multi-step workflow.

The useful beginner question is: **what kind of conversation is this?** A user-facing request needs an answer now. A slow job needs a durable waiting place. A business fact may need to reach several systems. A larger process may need a visible list of steps, retries, and branches.

This article keeps the same publishing feature all the way through. The feature starts with one direct API call, then adds a queue for video work, a topic for notifications, an event bus for broader routing, and a workflow for the full publishing process.

![The pattern map shows when one app should call directly, queue work, publish to many listeners, route events, or coordinate a longer workflow](/content-assets/articles/article-cloud-providers-aws-application-integration-how-applications-talk-in-aws/application-communication-patterns.png)

*The pattern map shows when one app should call directly, queue work, publish to many listeners, route events, or coordinate a longer workflow.*


## The First Direct API
<!-- section-summary: Request/response communication fits moments where the caller needs a clear answer before it can continue. -->

A **request/response API** is a direct conversation. One caller sends a request, waits for a response, and uses that response to decide what happens next. In Northstar Learn, the browser calls `POST /lessons/{lessonId}/publish`, and the backend returns either a validation problem or a publish request ID.

This shape works well when the caller needs a quick answer. The instructor should see something useful right away, such as "publishing started" or "the uploaded video is still missing." The web app cannot show a good next screen until the backend responds.

In AWS, **Amazon API Gateway** often owns this API boundary. API Gateway can receive HTTPS requests, match routes, apply authorization, protect the backend with throttling, write access logs, and send the request to Lambda, a container service, or another HTTP backend.

For the lesson publishing feature, the first request path looks like this:

| Step | Job | Example |
|---|---|---|
| Browser request | Caller asks for an answer | `POST /lessons/lesson-1042/publish` |
| API boundary | Route, authorize, and log the request | API Gateway route |
| Backend handler | Validate the lesson and create a publish request | Lambda or container service |
| Response | Tell the UI what happened | `202 Accepted` with `publishRequestId` |

The direct API should stay honest about timing. It can validate the lesson, create a durable publish record, and hand off long-running work. It should avoid doing every expensive job while the instructor waits on the browser tab.

## When Work Needs to Wait
<!-- section-summary: A queue stores work until a consumer has capacity to process it safely. -->

The first direct API gives the instructor an answer. Now the platform has slow work to do. The uploaded video needs several playback sizes, thumbnails, and maybe captions. That work can take seconds or minutes, and it may fail because of a temporary worker error or a bad input file.

A **queue** is a durable waiting place for messages. A producer sends a message to the queue, and a consumer receives the message later. In AWS, **Amazon SQS** is the common managed queue service for this job.

For Northstar Learn, the lesson service can send a message to a queue named `lesson-transcode-jobs` after it creates the publish request. A worker reads the message, loads the lesson details, creates the video outputs, and deletes the message only after the work succeeds.

The queue changes the shape of responsibility:

| Piece | Responsibility |
|---|---|
| Publish API | Validate the request and create the publish job |
| SQS queue | Hold transcode work durably while workers are busy or offline |
| Transcode worker | Receive one message, process the video, and delete the message after success |
| Dead-letter queue | Hold messages that failed too many times for human review |

This pattern protects the user-facing request from slow background work. It also gives operators a simple signal during an incident. If publishing requests succeed but videos stay in "processing," queue depth and oldest message age show whether the workers are keeping up.

## When Many Systems Need the Same News
<!-- section-summary: A topic fans one published message out to many subscribers that each need their own copy. -->

After the video finishes, the platform has a new fact: the lesson is published. Several systems care about that fact. Learner email wants to send notifications. Search wants to index the lesson. Analytics wants to count publish activity. The mobile app may want a push notification.

A **topic** is a shared publication point. One publisher sends a message to the topic, and each subscription gets a copy. In AWS, **Amazon SNS** is the common publish-subscribe topic service.

For Northstar Learn, the lesson service can publish a `LessonPublished` message to an SNS topic named `lesson-publishing-notifications`. Email, search, analytics, and mobile notification systems can subscribe without forcing the lesson service to call each one directly.

This is the concrete distinction from a queue. A queue usually has competing consumers that share one work backlog. A topic fans out one notification to many subscribers. If three subscribers match, all three receive a copy.

| Need | Better fit | Why |
|---|---|---|
| One worker should transcode one video job | SQS queue | Workers compete for messages from one backlog |
| Email, search, and analytics should each react to one published lesson | SNS topic | Each subscriber receives its own copy |
| One subscriber needs buffering and retries | SNS topic to SQS queue | SNS fans out, SQS gives that subscriber a durable backlog |

SNS to SQS is a very common production shape. The topic handles fanout, and each important subscriber owns a queue behind its subscription. That queue gives the subscriber its own retries, alarms, dead-letter queue, and processing speed.

## When Events Need Routing Rules
<!-- section-summary: An event bus routes facts by pattern, ownership, and target across larger systems. -->

SNS fanout works well for direct notification-style delivery. As Northstar Learn grows, event routing gets broader. The publishing team owns lesson events, the billing team owns subscription events, the analytics team owns reporting pipelines, and a central platform team wants a consistent event bus for product activity.

An **event** is a fact that already happened. `LessonPublished` says the lesson is available. `LessonPublishRequested` says the instructor started the process. `VideoTranscodeFailed` says a worker could not finish video processing. Events should carry stable identifiers and enough detail for routing, while the owning service keeps the full source record.

**Amazon EventBridge** is AWS's managed event bus and router. A service publishes events to a bus. Rules match events by fields such as `source`, `detail-type`, and values inside `detail`. Targets receive matching events. Targets can include Lambda functions, SQS queues, Step Functions state machines, API destinations, and other supported services.

For Northstar Learn, EventBridge can route `LessonPublished` events from `com.northstar.lessons` to analytics, search, a data lake loader, and a cross-account reporting bus. Each target can use a rule that describes the events it owns.

EventBridge and SNS can both deliver messages to multiple places, so the distinction should stay concrete:

| Pattern | Use it when | Northstar example |
|---|---|---|
| SNS topic | The producer wants notification fanout to known subscriber types | Notify email, search, and mobile subscribers about published lessons |
| EventBridge bus | Teams need routed business events, SaaS or AWS service events, archives, replay, or cross-account routing | Route product events by `source`, `detail-type`, tenant, or course category |
| SQS queue | One processing group needs a durable work backlog | Transcode one uploaded video at a time |

EventBridge also adds operational tools that matter for event-driven systems. Archives can keep matching events for replay. Rules can send failed deliveries to a dead-letter queue. Cross-account routing can let one application account publish selected events into a platform or analytics account.

## When the Process Has Several Steps
<!-- section-summary: A workflow tracks ordered work, branches, retries, waits, and failure paths across services. -->

The publishing feature now has several moving parts. The system validates the lesson, checks instructor permission, starts video transcoding, waits for the worker result, runs a content safety check, publishes the lesson, sends notifications, and records the final status. Some steps may retry. Some steps branch. Some steps wait for another service or a human.

A **workflow** is a multi-step process with state. In AWS, **Step Functions** runs workflows as state machines. A state machine defines named steps, and each execution tracks one run of those steps.

For Northstar Learn, a state machine named `PublishLessonWorkflow` can show exactly where a publish request sits. Maybe `lesson-1042` is waiting for video transcode. Maybe `lesson-2041` failed validation. Maybe a high-risk course is waiting for manual review. The workflow gives operators and developers a visible history instead of hiding the whole process inside one large function.

Step Functions fits a different job from queues and events. A queue says "someone should do this work later." An event bus says "this fact happened, and matching targets may react." A workflow says "these steps belong to one process, and AWS should track the order, state, retries, and result."

| Workflow concern | Step Functions feature |
|---|---|
| Ordered steps | Named states and `Next` transitions |
| Branching | Choice states |
| Parallel work | Parallel and Map states |
| Temporary failures | Retry and Catch rules |
| Waiting | Wait states and callback task tokens |
| Visibility | Execution history and visual workflow graph |

That makes Step Functions useful after the communication pattern grows beyond one handoff. The service does not replace SQS, SNS, or EventBridge. It often coordinates them as part of a larger flow.

## Service-by-Job Map
<!-- section-summary: The main AWS integration services line up with different communication jobs rather than one generic messaging bucket. -->

The module starts with this map because service names make more sense when each name has a job. A beginner does not need every feature on day one. The first skill is choosing the communication shape that matches the work.

| Job | Communication shape | AWS service | Simple test question |
|---|---|---|---|
| Ask for an answer now | Request/response API | API Gateway | Does the caller need a response before it continues? |
| Store work for one processing group | Queue | SQS | Should one consumer group pull durable work later? |
| Notify many subscribers | Topic fanout | SNS | Should several subscribers each receive a copy? |
| Route business facts by pattern | Event bus | EventBridge | Do teams need rules, archives, replay, or cross-account routing? |
| Track a multi-step process | Workflow | Step Functions | Does one process need ordered steps, branches, waits, and retries? |

The Northstar Learn feature can use all five without mixing their jobs. API Gateway receives the instructor request. SQS holds transcode work. SNS fans out the final published notification. EventBridge routes broader product events. Step Functions coordinates the full publish workflow.

In production, teams usually combine these services with IAM, CloudWatch, CloudTrail, X-Ray or OpenTelemetry, infrastructure as code, and clear payload contracts. The communication service is only one part of the system. The real design also needs permissions, alarms, retries, ownership, and a plan for bad messages.

![The decision board turns the module into a quick pattern chooser for direct APIs, queues, topics, event buses, and workflows](/content-assets/articles/article-cloud-providers-aws-application-integration-how-applications-talk-in-aws/integration-decision-board.png)

*The decision board turns the module into a quick pattern chooser for direct APIs, queues, topics, event buses, and workflows.*


## A First Debugging Path
<!-- section-summary: Troubleshooting starts by naming the communication shape that is failing, then checking the service that owns that job. -->

Imagine instructors report that lessons get stuck in "processing." The API still accepts publish requests, but videos never finish and learners never receive notifications. A steady debugging path follows the communication jobs instead of jumping between random services.

| Check | Evidence | Meaning |
|---|---|---|
| Request/response | API Gateway access logs show `202 Accepted` for publish requests | The user-facing API accepted the work |
| Queue | SQS `ApproximateAgeOfOldestMessage` keeps rising | Transcode workers are falling behind or failing |
| Worker logs | CloudWatch Logs show the same video file failing codec validation | The queue is healthy, but the worker cannot process one input shape |
| Topic fanout | SNS publish metrics stay flat because no lesson reaches published state | Notifications did not fail first; publishing never completed |
| Event routing | EventBridge has no `LessonPublished` events for that lesson | Downstream event consumers have no fact to react to |
| Workflow | Step Functions execution history stops at `StartTranscode` | The end-to-end process is waiting on the worker result |

This path turns application integration into a readable system. Each AWS service owns one communication job, and each job has its own signals. API logs answer whether the request entered the system. Queue metrics answer whether background work is waiting. Worker logs explain processing. Topic and event metrics answer whether notifications or events left the publishing service. Workflow history shows the step that stopped progress.

![The debugging path shows the evidence trail from caller to failed target, including IDs, retries, logs, metrics, and dead-letter queues](/content-assets/articles/article-cloud-providers-aws-application-integration-how-applications-talk-in-aws/integration-debugging-evidence.png)

*The debugging path shows the evidence trail from caller to failed target, including IDs, retries, logs, metrics, and dead-letter queues.*


## What's Next
<!-- section-summary: The next articles turn each communication shape into concrete AWS implementation practice. -->

The rest of this module goes one layer deeper. API Gateway comes first because the feature begins with a request that needs an answer. SQS follows because slow work needs a durable waiting place. SNS follows because one published fact may need to reach many subscribers. EventBridge follows because larger systems need routed events, archives, replay, and cross-account delivery. Step Functions closes the module by coordinating the full process as a visible workflow.

The important thread stays the same through every article: **request/response, queue, topic, event bus, and workflow are different communication jobs**. Picking the right one starts with timing, ownership, and failure behavior.

## References

- [What is Amazon API Gateway?](https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html)
- [What is Amazon Simple Queue Service?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)
- [What is Amazon Simple Notification Service?](https://docs.aws.amazon.com/sns/latest/dg/welcome.html)
- [What is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html)
- [What is AWS Step Functions?](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
