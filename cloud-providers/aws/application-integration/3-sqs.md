---
title: "SQS"
description: "Use Amazon SQS queues to decouple AWS workloads with producers, consumers, visibility timeout, retries, DLQs, FIFO ordering, Lambda triggers, monitoring, permissions, and encryption."
overview: "Amazon SQS gives background work a durable place to wait. This article follows a lesson video publishing flow through queues, producers, consumers, message shape, polling, visibility timeout, receipt handles, retries, dead-letter queues, FIFO ordering, idempotent workers, Lambda event source mappings, CloudWatch metrics, IAM permissions, and encryption."
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

1. [The Work That Should Wait](#the-work-that-should-wait)
2. [Queues, Producers, and Consumers](#queues-producers-and-consumers)
3. [A Useful Message Shape](#a-useful-message-shape)
4. [Create a Queue and Dead-Letter Queue](#create-a-queue-and-dead-letter-queue)
5. [Send, Receive, and Delete a Message](#send-receive-and-delete-a-message)
6. [Visibility Timeout and Retries](#visibility-timeout-and-retries)
7. [Standard Queues, FIFO Queues, and Idempotency](#standard-queues-fifo-queues-and-idempotency)
8. [Lambda and Container Consumers](#lambda-and-container-consumers)
9. [Monitoring, Permissions, and Encryption](#monitoring-permissions-and-encryption)
10. [Putting It Together](#putting-it-together)
11. [What's Next](#whats-next)
12. [References](#references)

## The Work That Should Wait
<!-- section-summary: SQS fits background work that should continue after the direct API response. -->

The API Gateway article ended with a successful `POST /lessons/{lessonId}/publish` request. The backend validated the instructor, created a publish request, and returned `202 Accepted`. Now Northstar Learn has a slower job: create playable video outputs from the uploaded lesson video.

That job should survive worker restarts, temporary failures, and traffic spikes. It should also run after the API response so the instructor does not wait on a long video pipeline. This is the queue moment in application integration.

**Amazon Simple Queue Service**, usually called **SQS**, is a managed queue service. A queue stores messages until a consumer receives them, processes them, and deletes them. In the lesson publishing flow, the producer sends a message that says "transcode this lesson video," and workers drain those messages as capacity is available.

The request/response API still matters. It starts the work and gives the UI a tracking ID. SQS handles the next job: **durable background work for one processing group**.

## Queues, Producers, and Consumers
<!-- section-summary: An SQS design starts with one queue, one producer that sends work, and one consumer group that drains it. -->

A **queue** is a durable waiting place for messages. It has a URL, an ARN, configuration attributes, metrics, and access policies. Messages wait inside the queue until a consumer receives them.

A **producer** is the application component that sends messages. In Northstar Learn, the lesson publish backend sends one message to `lesson-transcode-jobs` after it creates the publish request. The producer should send stable identifiers and enough context for the worker to start safely.

A **consumer** is the component that receives messages and processes them. The consumer could be Lambda, an ECS worker, an EC2 process, or a Kubernetes worker using the AWS SDK. In this scenario, the transcode worker receives a message, loads lesson metadata, reads the source video from S3, writes video outputs, updates publish status, and deletes the message after success.

The first production habit is to name the queue by the work it contains. `lesson-transcode-jobs` tells operators what waits there. A vague name such as `lesson-events` can hide whether the queue is work, notification, audit data, or something else.

| Piece | Northstar name | Job |
|---|---|---|
| Producer | `publishLesson` backend | Sends one transcode job after the publish request is created |
| Queue | `lesson-transcode-jobs` | Stores video work until consumers have capacity |
| Consumer | `lesson-transcode-worker` | Processes videos and deletes messages after success |
| Failure queue | `lesson-transcode-dlq` | Holds messages that failed too many receives |

This shape gives the team a clear incident story. If publish requests succeed but videos lag, queue metrics show whether messages are building up and how old the oldest message is.

![The queue flow shows how producers, consumers, deletes, retries, and a dead-letter queue turn delayed work into an observable process](/content-assets/articles/article-cloud-providers-aws-application-integration-messaging/sqs-producer-consumer-flow.png)

*The queue flow shows how producers, consumers, deletes, retries, and a dead-letter queue turn delayed work into an observable process.*


## A Useful Message Shape
<!-- section-summary: A good SQS message carries stable identifiers and leaves large source data in the owning service or storage layer. -->

A **message** is the unit of work in the queue. It should be small, stable, and specific. The message should usually point to the source of truth instead of copying a full database row or large file content.

For the lesson transcode job, the body can look like this:

```json
{
  "schemaVersion": 1,
  "jobType": "TranscodeLessonVideo",
  "publishRequestId": "pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P",
  "lessonId": "lesson-1042",
  "sourceVideoKey": "uploads/lesson-1042/source.mov",
  "requestedBy": "instructor-77",
  "correlationId": "req-9ef0d6c8"
}
```

`schemaVersion` gives consumers a way to handle message changes over time. `jobType` names the work. `publishRequestId` and `lessonId` let the worker update the right record. `sourceVideoKey` points to the S3 object instead of placing video data in the message. `correlationId` connects API logs, worker logs, and workflow history.

Message attributes can carry routing or tracing values outside the body. They are useful when a consumer or subscription filter needs metadata without parsing the whole JSON body. For SQS alone, many teams keep the main business fields in the body and use attributes for trace IDs, tenant IDs, or content type.

## Create a Queue and Dead-Letter Queue
<!-- section-summary: A production queue usually has a DLQ so repeatedly failing messages have a review path. -->

A **dead-letter queue**, often shortened to **DLQ**, receives messages that fail too many times. The main queue tracks receive attempts. After the configured `maxReceiveCount`, SQS moves the message to the DLQ.

The command below creates the DLQ first because the main queue needs the DLQ ARN in its redrive policy.

```bash
aws sqs create-queue \
  --queue-name lesson-transcode-dlq
```

Example output:

```json
{
  "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/lesson-transcode-dlq"
}
```

The queue URL is used by SQS API calls. IAM policies and redrive policies use the queue ARN, so the next command asks SQS for that ARN.

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/lesson-transcode-dlq \
  --attribute-names QueueArn
```

Example output:

```json
{
  "Attributes": {
    "QueueArn": "arn:aws:sqs:us-east-1:123456789012:lesson-transcode-dlq"
  }
}
```

The main queue command uses that ARN in `RedrivePolicy`. `VisibilityTimeout` gives a worker three minutes to process a message before it can reappear. `MessageRetentionPeriod` keeps unprocessed messages for four days in this example.

```bash
aws sqs create-queue \
  --queue-name lesson-transcode-jobs \
  --attributes VisibilityTimeout=180,MessageRetentionPeriod=345600,RedrivePolicy='{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:123456789012:lesson-transcode-dlq","maxReceiveCount":"5"}'
```

Example output:

```json
{
  "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/lesson-transcode-jobs"
}
```

`maxReceiveCount` means a message can be received and returned to the queue several times before SQS moves it to the DLQ. The right number depends on the workload. A transient network failure may deserve retries, while a bad video file should land in a review queue after a few attempts.

## Send, Receive, and Delete a Message
<!-- section-summary: A consumer receives a message, processes it, and deletes it with the receipt handle after success. -->

The producer sends the transcode job after the publish request is saved. The command below sends one message and includes a trace value as a message attribute.

```bash
aws sqs send-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/lesson-transcode-jobs \
  --message-body '{"schemaVersion":1,"jobType":"TranscodeLessonVideo","publishRequestId":"pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P","lessonId":"lesson-1042","sourceVideoKey":"uploads/lesson-1042/source.mov","requestedBy":"instructor-77","correlationId":"req-9ef0d6c8"}' \
  --message-attributes '{"traceId":{"DataType":"String","StringValue":"req-9ef0d6c8"}}'
```

Example output:

```json
{
  "MD5OfMessageBody": "46ad2b8f6f7d1fb763ab0c2bfcfdf452",
  "MD5OfMessageAttributes": "9a7bce6a5d7d30c6f8c6d9ad5a540ed0",
  "MessageId": "7c0b5f1d-930e-44e6-9b08-21df3a2f6482"
}
```

`MessageId` proves SQS accepted the message. The MD5 values help the client verify that the body and attributes arrived as sent. The worker still treats the database and S3 as the source of truth for full lesson details.

Consumers receive messages by polling the queue. Long polling waits up to `WaitTimeSeconds` for a message, which reduces empty responses and API churn.

```bash
aws sqs receive-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/lesson-transcode-jobs \
  --max-number-of-messages 1 \
  --wait-time-seconds 10 \
  --attribute-names ApproximateReceiveCount SentTimestamp \
  --message-attribute-names All
```

Example output:

```json
{
  "Messages": [
    {
      "MessageId": "7c0b5f1d-930e-44e6-9b08-21df3a2f6482",
      "ReceiptHandle": "AQEBp2f...long-handle...",
      "Body": "{\"schemaVersion\":1,\"jobType\":\"TranscodeLessonVideo\",\"publishRequestId\":\"pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P\",\"lessonId\":\"lesson-1042\",\"sourceVideoKey\":\"uploads/lesson-1042/source.mov\",\"requestedBy\":\"instructor-77\",\"correlationId\":\"req-9ef0d6c8\"}",
      "Attributes": {
        "ApproximateReceiveCount": "1",
        "SentTimestamp": "1782579600000"
      },
      "MessageAttributes": {
        "traceId": {
          "StringValue": "req-9ef0d6c8",
          "DataType": "String"
        }
      }
    }
  ]
}
```

The important field is `ReceiptHandle`. A consumer deletes this exact receive attempt after the work succeeds. If the worker crashes or the visibility timeout expires before deletion, the message can return to the queue for another attempt.

After successful processing, the worker deletes the message:

```bash
aws sqs delete-message \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/lesson-transcode-jobs \
  --receipt-handle "AQEBp2f...long-handle..."
```

The delete command usually returns no body on success. Quiet success is normal for this API call. A worker should log the message ID, lesson ID, and publish request ID before deletion so operators can connect completed work to the original publish request.

## Visibility Timeout and Retries
<!-- section-summary: Visibility timeout hides a received message temporarily, and retries happen when the message is not deleted. -->

**Visibility timeout** is the time a received message stays hidden from other consumers. It starts when a consumer receives the message. If the consumer deletes the message before the timeout expires, the work is complete. If the consumer fails to delete it, SQS can make the message visible again.

This design gives SQS retry behavior without the queue knowing the business result. If the transcode worker crashes halfway through a video, the message can reappear. Another worker can receive it and try again. If the same message fails too many receives, the redrive policy moves it to the DLQ.

The visibility timeout should match real processing time. A three-minute timeout is poor for a video job that usually takes ten minutes. The worker can either set a longer queue-level timeout or call `ChangeMessageVisibility` while it makes progress.

The command below changes the timeout for one received message to fifteen minutes:

```bash
aws sqs change-message-visibility \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/lesson-transcode-jobs \
  --receipt-handle "AQEBp2f...long-handle..." \
  --visibility-timeout 900
```

This command also returns no body on success. The important operational signal is that the message stays in flight longer, and `ApproximateNumberOfMessagesNotVisible` can rise while workers hold messages.

DLQ review should be part of the runbook. A message in `lesson-transcode-dlq` may mean a bad source video, a missing S3 permission, a bug in the worker, or a downstream service outage. Teams usually inspect the body, look up the correlation ID, fix the cause, and redrive the message only when the consumer can handle it safely.

![The retry loop shows why a received message becomes hidden, returns after failure, and eventually moves to the DLQ after the receive limit](/content-assets/articles/article-cloud-providers-aws-application-integration-messaging/visibility-timeout-retry-loop.png)

*The retry loop shows why a received message becomes hidden, returns after failure, and eventually moves to the DLQ after the receive limit.*


## Standard Queues, FIFO Queues, and Idempotency
<!-- section-summary: Standard queues maximize throughput, FIFO queues add ordering by group, and consumers still need idempotent behavior. -->

SQS has **standard queues** and **FIFO queues**. Standard queues are the normal first choice. They support high throughput and at-least-once delivery, which means a message may be delivered more than once. Consumers should handle duplicate delivery safely.

FIFO queues add first-in-first-out ordering within a message group and deduplication behavior. They are useful when order matters for one business key. For example, a queue that applies lesson status transitions may use a FIFO queue with `lessonId` as the message group ID so updates for the same lesson stay ordered.

Video transcode work often fits a standard queue because each job can run independently. The worker still needs **idempotency**, which means processing the same message twice should not corrupt data or create duplicate outputs. The worker can check whether `publishRequestId` already has completed video outputs before starting expensive work again.

An idempotent worker usually follows this shape:

```json
{
  "idempotencyKey": "pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P:TranscodeLessonVideo",
  "firstCheck": "Look up whether this publish request already has completed outputs",
  "safeWrite": "Write outputs to deterministic S3 keys",
  "finalUpdate": "Mark the publish request as transcoded only once"
}
```

This JSON describes the worker behavior rather than an AWS resource. The deterministic key and output paths matter because duplicate delivery is a normal queue behavior that the application must tolerate.

## Lambda and Container Consumers
<!-- section-summary: Lambda can poll SQS for event-driven workers, while containers fit longer or more customized processing loops. -->

SQS consumers can be written in several ways. **Lambda event source mappings** let Lambda poll SQS, invoke the function with batches of messages, and delete messages after successful processing. This is a common fit for short to medium background jobs.

The command below connects the queue to a Lambda worker:

```bash
aws lambda create-event-source-mapping \
  --function-name lessonTranscodeWorker \
  --event-source-arn arn:aws:sqs:us-east-1:123456789012:lesson-transcode-jobs \
  --batch-size 5 \
  --maximum-batching-window-in-seconds 10
```

Example output:

```json
{
  "UUID": "3d89e8b8-7c3c-4b07-a5fd-36a5b57d1c9f",
  "State": "Creating",
  "BatchSize": 5,
  "EventSourceArn": "arn:aws:sqs:us-east-1:123456789012:lesson-transcode-jobs",
  "FunctionArn": "arn:aws:lambda:us-east-1:123456789012:function:lessonTranscodeWorker"
}
```

`batch-size` controls how many messages Lambda can send to one invocation. `maximum-batching-window-in-seconds` lets Lambda wait briefly to build a batch. The function code should report partial batch failures when only some records fail, so successful messages stay complete while failed records return for another attempt.

Container workers fit jobs that need longer runtime, custom binaries, local scratch space, specialized libraries, or steady throughput tuning. A video transcode pipeline often uses ECS workers because video tools may need more runtime and memory than a small Lambda handler. The queue pattern stays the same: receive, process, delete after success.

## Monitoring, Permissions, and Encryption
<!-- section-summary: SQS operations need backlog metrics, narrow IAM permissions, and encryption settings that match the workload. -->

Queue monitoring starts with a few CloudWatch metrics. `ApproximateNumberOfMessagesVisible` shows the backlog waiting to be received. `ApproximateNumberOfMessagesNotVisible` shows messages currently held by consumers. `ApproximateAgeOfOldestMessage` shows how long the oldest visible message has waited.

The command below inspects those queue attributes directly. It is useful during a hands-on lab or incident because it shows the same concepts behind the CloudWatch metrics.

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/lesson-transcode-jobs \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateAgeOfOldestMessage
```

Example output:

```json
{
  "Attributes": {
    "ApproximateNumberOfMessages": "42",
    "ApproximateNumberOfMessagesNotVisible": "8",
    "ApproximateAgeOfOldestMessage": "612"
  }
}
```

This output says 42 messages are waiting, 8 are currently in flight, and the oldest visible message has waited 612 seconds. A production alarm often watches oldest age because a small queue with old messages can still mean the system is stuck.

IAM permissions should match the component job. The producer needs `sqs:SendMessage` on the queue. A worker needs `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility`, and `sqs:GetQueueAttributes`. A DLQ review tool may need receive permissions on the DLQ. Keeping these roles separate makes incidents and access reviews cleaner.

SQS supports server-side encryption with SQS-managed encryption keys or AWS KMS keys. KMS keys add key policy and audit control, and they also add KMS permissions that producers and consumers must have. For sensitive lesson metadata, encryption plus careful message design helps avoid spreading private data through logs, DLQs, and reprocessing tools.

![The checklist groups the queue signals and controls a production review should cover before trusting an async workflow](/content-assets/articles/article-cloud-providers-aws-application-integration-messaging/queue-operations-checklist.png)

*The checklist groups the queue signals and controls a production review should cover before trusting an async workflow.*


## Putting It Together
<!-- section-summary: SQS gives the lesson publishing system a durable background work lane after the API request returns. -->

The lesson publishing API can now return quickly. It validates the request, creates the publish record, and sends a transcode message to SQS. The worker receives that message, processes the video, and deletes the message only after success.

The queue gives the system important production behavior. Temporary worker failures turn into retries. Repeated failures land in a DLQ. Backlog metrics show whether workers keep up. IAM policies keep producer and consumer access narrow. Idempotency protects the system from duplicate delivery.

This is the concrete queue distinction: **SQS is for durable work that one consumer group should process later**. It is the right next step after the direct API because video work is slower and more failure-prone than the instructor's HTTP request.

## What's Next
<!-- section-summary: The next article moves from one consumer group to fanout, where several subscribers each need a copy. -->

After the worker finishes the video, the platform has a new fact: the lesson is published. Email, search, analytics, and mobile notifications may all need to react. One queue would make those consumers compete for the same message, so the next article introduces SNS topics for fanout.

## References

- [What is Amazon SQS?](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)
- [Amazon SQS visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
- [Using dead-letter queues in Amazon SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Amazon SQS FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html)
- [Using AWS Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [Amazon SQS server-side encryption](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html)
