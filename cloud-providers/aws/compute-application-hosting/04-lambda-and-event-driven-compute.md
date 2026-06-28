---
title: "Lambda"
description: "Understand AWS Lambda as event-driven compute for bounded work, including events, handlers, execution roles, triggers, timeouts, memory, retries, idempotency, concurrency, monitoring, and rollback."
overview: "Lambda runs short units of application code in response to events. This article follows an image-upload pipeline and shows how events, handlers, execution roles, triggers, retries, timeouts, memory, concurrency, monitoring, and rollout safety fit together."
tags: ["lambda", "events", "serverless", "aws"]
order: 4
id: article-cloud-providers-aws-compute-application-hosting-lambda-event-driven-compute
aliases:
  - lambda-and-event-driven-compute
  - cloud-providers/aws/compute-application-hosting/lambda-and-event-driven-compute.md
---

## Table of Contents

1. [One Event, One Bounded Job](#one-event-one-bounded-job)
2. [Handlers and Event Payloads](#handlers-and-event-payloads)
3. [Execution Roles and Runtime Configuration](#execution-roles-and-runtime-configuration)
4. [Triggers, Retries, and Idempotency](#triggers-retries-and-idempotency)
5. [Concurrency and Downstream Protection](#concurrency-and-downstream-protection)
6. [Versions, Aliases, and Rollback](#versions-aliases-and-rollback)
7. [Monitoring Lambda Work](#monitoring-lambda-work)
8. [A Lambda Failure Path](#a-lambda-failure-path)
9. [References](#references)

## One Event, One Bounded Job
<!-- section-summary: Lambda fits work that starts because an event happened and finishes inside a clear time boundary. -->

The photo app stores original images in S3. After each upload, the team wants a `256x256` thumbnail. Keeping a web server busy for that background job wastes attention because the work only starts when an object arrives.

**AWS Lambda** runs a function handler in response to an event. Lambda creates the runtime environment, calls your handler, streams logs to CloudWatch, records metrics, and ends the invocation when the handler returns or the timeout is reached. You choose memory, timeout, runtime, environment variables, permissions, triggers, and failure behavior.

For this article, follow a function called `thumbnail-worker`. Original images land in `s3://northstar-photos-prod/originals/`. An event reaches Lambda. The function reads the original object, creates a thumbnail, writes it to `s3://northstar-photos-prod/thumbs/`, and logs the result. That small job still needs a serious production shape because events can repeat, bursts can arrive, and downstream services can fail.

Lambda is strongest when the work has a clear boundary:

| Workload | Why Lambda fits |
|---|---|
| Create a thumbnail after S3 upload | One object event leads to one output object. |
| Process an SQS message | One queue message or batch leads to one unit of work. |
| Run a scheduled cleanup | One EventBridge schedule triggers bounded maintenance. |
| Validate a webhook | One HTTP request produces one response through API Gateway or Function URLs. |

The next step is understanding what Lambda actually calls: the handler and the event payload.

![The function lifecycle shows how an event payload, handler, role, configuration, downstream call, logs, and metrics fit into one bounded job](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-lambda-event-driven-compute/lambda-handler-lifecycle.png)

*The function lifecycle shows how an event payload, handler, role, configuration, downstream call, logs, and metrics fit into one bounded job.*


## Handlers and Event Payloads
<!-- section-summary: The handler receives source-specific event data and turns it into one bounded unit of work. -->

A **handler** is the function Lambda calls. The event shape depends on the trigger. S3 events include bucket and object information. SQS events include message bodies and receipt metadata. API Gateway events include method, path, headers, and body. EventBridge events include `source`, `detail-type`, and `detail`.

Here is a small S3 event sample:

```json
{
  "Records": [
    {
      "eventSource": "aws:s3",
      "eventName": "ObjectCreated:Put",
      "s3": {
        "bucket": {
          "name": "northstar-photos-prod"
        },
        "object": {
          "key": "originals/profile-123.png",
          "size": 184230
        }
      }
    }
  ]
}
```

`Records` can contain more than one event record. `eventSource` tells the code which AWS service produced the record. `eventName` names the type of change. `s3.bucket.name` gives the source bucket, and `s3.object.key` gives the object key. The object key may contain URL-encoded characters, so Node.js handlers often decode it before using it.

Now connect that event to real code:

```js
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const s3 = new S3Client({});

export const handler = async (event, context) => {
  for (const record of event.Records) {
    const sourceBucket = record.s3.bucket.name;
    const sourceKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const outputKey = sourceKey.replace("originals/", "thumbs/");

    console.log(JSON.stringify({
      requestId: context.awsRequestId,
      sourceBucket,
      sourceKey,
      outputKey
    }));

    const original = await s3.send(new GetObjectCommand({
      Bucket: sourceBucket,
      Key: sourceKey
    }));

    const bytes = await original.Body.transformToByteArray();
    const thumbnail = await sharp(Buffer.from(bytes))
      .resize(256, 256, { fit: "inside" })
      .png()
      .toBuffer();

    await s3.send(new PutObjectCommand({
      Bucket: process.env.THUMBNAIL_BUCKET,
      Key: outputKey,
      Body: thumbnail,
      ContentType: "image/png"
    }));
  }
};
```

The `S3Client` is created outside the handler so the runtime can reuse it across warm invocations. The loop handles every record in the event. `sourceBucket` and `sourceKey` come from the event. `outputKey` uses a predictable path so retries write the same thumbnail location. The log line includes safe metadata and the Lambda request ID. `GetObjectCommand` reads the original file, `sharp` creates the thumbnail, and `PutObjectCommand` writes the result to the bucket named by `THUMBNAIL_BUCKET`.

The handler uses `/tmp` only if the image library needs temporary files. Lambda runtime environments can be reused, so cached clients are useful, but correctness should come from the event and durable services rather than leftover local files.

Once the handler shape is clear, the next question is what the function is allowed to do and how the runtime is configured.

## Execution Roles and Runtime Configuration
<!-- section-summary: A Lambda execution role gives the function scoped AWS permissions, while memory, timeout, and environment settings shape runtime behavior. -->

Every Lambda function has an **execution role**. This IAM role gives the function permission to write logs and call AWS services. For `thumbnail-worker`, the role needs `s3:GetObject` on the original prefix and `s3:PutObject` on the thumbnail prefix.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOriginalImages",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::northstar-photos-prod/originals/*"
    },
    {
      "Sid": "WriteThumbnails",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::northstar-photos-prod/thumbs/*"
    }
  ]
}
```

`ReadOriginalImages` allows reads only from the original image prefix. `WriteThumbnails` allows writes only to the thumbnail prefix. The role also needs the standard CloudWatch Logs permissions, often through the AWS managed basic execution role policy or a scoped equivalent. Secret values should come from Secrets Manager, Parameter Store, or another managed secret path. Environment variables are fine for non-secret settings such as `THUMBNAIL_BUCKET` and `LOG_LEVEL`.

Runtime configuration shapes cost and reliability:

```bash
aws lambda get-function-configuration \
  --function-name thumbnail-worker \
  --region eu-west-2 \
  --query '{Runtime:Runtime,Handler:Handler,Memory:MemorySize,Timeout:Timeout,Role:Role,Environment:Environment.Variables,LastModified:LastModified}'
```

Example output:

```json
{
  "Runtime": "nodejs22.x",
  "Handler": "index.handler",
  "Memory": 1024,
  "Timeout": 30,
  "Role": "arn:aws:iam::123456789012:role/prod-thumbnail-worker",
  "Environment": {
    "THUMBNAIL_BUCKET": "northstar-photos-prod",
    "LOG_LEVEL": "info"
  },
  "LastModified": "2026-06-24T09:42:11.000+0000"
}
```

`Runtime` tells Lambda which language runtime runs the code. `Handler` points to the exported function. `Memory` is the configured memory in MB, and Lambda allocates CPU in proportion to memory. `Timeout` is the maximum invocation duration in seconds. `Role` is the execution role ARN. `Environment` shows non-secret settings available to the code. `LastModified` helps line up configuration changes with incidents.

Image processing often benefits from testing several memory sizes. A 1024 MB function can finish faster than a 512 MB function because it receives more CPU, and the shorter duration can offset the higher memory setting. Use representative images, not a tiny sample file, when tuning.

VPC configuration is another production choice. A function needs VPC access when it must reach private resources such as an RDS database. A function that only reads and writes S3 can often skip VPC attachment, which keeps networking simpler. If VPC access is required, plan subnets, security groups, outbound access, and IP capacity.

Permissions and runtime settings define the function. The trigger defines how work reaches it.

## Triggers, Retries, and Idempotency
<!-- section-summary: Event-driven systems need a clear trigger path, retry behavior, and duplicate-safe writes. -->

A Lambda trigger can be a direct S3 notification, an SQS queue, an EventBridge rule, an API Gateway route, or another event source. Each source has its own retry behavior. This is one reason Lambda design needs more than a handler function.

For a small thumbnail system, S3 can invoke Lambda directly when objects arrive. For a busier system, S3 can send events to SQS and Lambda can poll the queue. The queue adds backlog visibility, retry control, and a dead-letter queue for messages that keep failing.

Create an SQS event source mapping like this:

```bash
aws lambda create-event-source-mapping \
  --function-name thumbnail-worker:prod \
  --event-source-arn arn:aws:sqs:eu-west-2:123456789012:thumbnail-events \
  --batch-size 5 \
  --maximum-batching-window-in-seconds 10 \
  --region eu-west-2
```

Example output:

```json
{
  "UUID": "6f3c9e50-90f3-43f5-b742-0db2f4b1a111",
  "State": "Creating",
  "FunctionArn": "arn:aws:lambda:eu-west-2:123456789012:function:thumbnail-worker:prod",
  "EventSourceArn": "arn:aws:sqs:eu-west-2:123456789012:thumbnail-events",
  "BatchSize": 5,
  "MaximumBatchingWindowInSeconds": 10
}
```

`FunctionArn` points at the `prod` alias, so the trigger follows the production release pointer. `EventSourceArn` is the queue Lambda will poll. `BatchSize: 5` lets one invocation process up to five messages. `MaximumBatchingWindowInSeconds: 10` lets Lambda wait briefly to gather a batch. The `State` starts as `Creating` and should move to `Enabled`.

**Idempotency** means repeated attempts leave the same correct result. Event-driven systems often deliver events at least once, so duplicates can happen. The thumbnail worker uses a deterministic output key: `originals/profile-123.png` maps to `thumbs/profile-123.png`. If the same event arrives twice, the function overwrites the same thumbnail instead of creating duplicates.

Jobs with money, emails, or database writes need a stronger idempotency key. A payment handler might store `orderId` in DynamoDB with a conditional write before charging a card. If a retry arrives with the same `orderId`, the handler sees the existing record and skips the duplicate side effect.

Retries keep temporary failures from losing work. Idempotency keeps retries from corrupting work. The next risk is scale: Lambda can run many copies at the same time.

![The retry and idempotency view shows how concurrency limits, duplicate protection, and failed-event capture protect downstream systems](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-lambda-event-driven-compute/function-retry-concurrency-idempotency.png)

*The retry and idempotency view shows how concurrency limits, duplicate protection, and failed-event capture protect downstream systems.*


## Concurrency and Downstream Protection
<!-- section-summary: Concurrency controls how many Lambda invocations can run at once and can protect slower downstream systems. -->

**Concurrency** is the number of Lambda invocations running at the same time. A sudden upload burst can start many thumbnail jobs. That can be fine for S3 and expensive image processing, but it can hurt a small database, a rate-limited API, or a shared service.

Reserved concurrency sets a maximum for one function:

```bash
aws lambda put-function-concurrency \
  --function-name thumbnail-worker \
  --reserved-concurrent-executions 50 \
  --region eu-west-2
```

Example output:

```json
{
  "ReservedConcurrentExecutions": 50
}
```

This reserves and caps the function at 50 concurrent invocations. The cap protects downstream systems and prevents one busy function from consuming all account concurrency. If SQS is the trigger and the queue receives more work than 50 concurrent invocations can process, queue age grows. That is acceptable when the goal is controlled delay instead of overwhelming a dependency.

Batch size also affects pressure. A batch size of `5` means one invocation can process up to five messages. If each message triggers a database write, `50` concurrent invocations and batch size `5` can create up to `250` in-flight message operations. Choose these numbers from downstream capacity, not guesswork.

Concurrency choices connect directly to monitoring. Watch throttles, queue age, function duration, errors, and downstream health together. A function can look healthy while the queue quietly grows, or the queue can drain while a database starts timing out.

Once the function has safe runtime behavior, releases need a stable pointer and rollback path.

## Versions, Aliases, and Rollback
<!-- section-summary: Lambda versions and aliases give releases stable names, traffic control, and a rollback target. -->

A Lambda **version** is an immutable snapshot of function code and most configuration. An **alias** is a stable name that points to a version, such as `prod` pointing to version `17`. Event sources, API clients, and deployment systems can use the alias ARN so releases move the alias rather than changing every caller.

Check the current production pointer:

```bash
aws lambda get-alias \
  --function-name thumbnail-worker \
  --name prod \
  --region eu-west-2 \
  --query '{Alias:Name,FunctionVersion:FunctionVersion,RoutingConfig:RoutingConfig}'
```

Example output:

```json
{
  "Alias": "prod",
  "FunctionVersion": "17",
  "RoutingConfig": null
}
```

`FunctionVersion: "17"` means production traffic points at version `17`. `RoutingConfig: null` means the alias sends all traffic to that version. A release can update the alias to version `18` after publishing and testing the version.

```bash
aws lambda update-alias \
  --function-name thumbnail-worker \
  --name prod \
  --function-version 18 \
  --region eu-west-2
```

Rollback uses the same operation pointed at the previous version:

```bash
aws lambda update-alias \
  --function-name thumbnail-worker \
  --name prod \
  --function-version 17 \
  --region eu-west-2
```

Aliases can also use weighted routing for supported invocation paths. This command keeps most traffic on version `17` and sends 10 percent to version `18`:

```bash
aws lambda update-alias \
  --function-name thumbnail-worker \
  --name prod \
  --function-version 17 \
  --routing-config '{"AdditionalVersionWeights":{"18":0.1}}' \
  --region eu-west-2
```

The release record should state which event source invokes which ARN. If an SQS event source mapping points at `thumbnail-worker:prod`, alias rollback changes the code used for future messages. Failed messages that already landed in a dead-letter queue still need a replay plan after the fix.

Now the service needs evidence during normal operations and incidents.

![The alias rollback view shows why publishing versions and moving an alias can make function rollback a small, reviewable change](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-lambda-event-driven-compute/lambda-alias-rollback.png)

*The alias rollback view shows why publishing versions and moving an alias can make function rollback a small, reviewable change.*


## Monitoring Lambda Work
<!-- section-summary: Lambda operations rely on invocation metrics, errors, duration, throttles, logs, queue age, and event-source state. -->

CloudWatch collects Lambda metrics and logs. Start with invocations, errors, duration, throttles, concurrent executions, and dead-letter queue depth if one exists. For SQS triggers, add queue age and visible message count. For streams, add iterator age. For API-style functions, add latency and status-code metrics from the front door.

Check error metrics for an incident window:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=thumbnail-worker \
  --start-time 2026-06-24T13:30:00Z \
  --end-time 2026-06-24T14:30:00Z \
  --period 300 \
  --statistics Sum \
  --region eu-west-2
```

Example output:

```json
{
  "Label": "Errors",
  "Datapoints": [
    {
      "Timestamp": "2026-06-24T13:55:00+00:00",
      "Sum": 0.0,
      "Unit": "Count"
    },
    {
      "Timestamp": "2026-06-24T14:00:00+00:00",
      "Sum": 18.0,
      "Unit": "Count"
    }
  ]
}
```

`--period 300` groups data into five-minute buckets. `--statistics Sum` returns the total number of errors per bucket. The jump from `0` to `18` points at a real failure window. Empty datapoints can mean no invocations, a wrong function name, a wrong Region, or metric delay, so compare this with the invocation metric before deciding the function was idle.

Search logs for the same window:

```bash
aws logs tail /aws/lambda/thumbnail-worker \
  --since 45m \
  --region eu-west-2 \
  --filter-pattern '"AccessDenied"'
```

Example output:

```bash
2026-06-24T14:01:12Z 5d446c07 ERROR AccessDenied: User arn:aws:sts::123456789012:assumed-role/prod-thumbnail-worker is not authorized to perform s3:PutObject on arn:aws:s3:::northstar-photos-prod/thumbs/profile-123.png
```

The log gives the request time, request ID, error type, assumed role, action, and resource. That is enough to check the execution role policy and compare the resource path with the function code.

Monitoring should connect function state to the event source. If Lambda errors rise but SQS queue age stays low, retries may be recovering quickly. If queue age rises and throttles appear, concurrency may be too low for the incoming volume or a downstream dependency may be slow.

## A Lambda Failure Path
<!-- section-summary: Lambda debugging follows event source state, metrics, logs, permissions, concurrency, alias history, and replay needs. -->

At 14:05, users report that new profile pictures show full-size images but no thumbnails. Start with three questions: did events arrive, did the function run, and did errors rise?

Check Lambda errors and invocations for the same window. Then check the event source. For an SQS-backed design, queue age is a strong signal:

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateAgeOfOldestMessage \
  --dimensions Name=QueueName,Value=thumbnail-events \
  --start-time 2026-06-24T13:30:00Z \
  --end-time 2026-06-24T14:30:00Z \
  --period 300 \
  --statistics Maximum \
  --region eu-west-2
```

If queue age grows while Lambda errors rise, messages are backing up because processing fails. Search Lambda logs for the first clear error:

```bash
aws logs tail /aws/lambda/thumbnail-worker \
  --since 60m \
  --region eu-west-2 \
  --filter-pattern '"ERROR"'
```

The logs show `AccessDenied` on `s3:PutObject` for the `thumbs/` prefix. Now inspect the deployed alias and the execution role policy. A common release mistake is code writing to a new prefix such as `thumbnails/` while the role still allows only `thumbs/`.

```bash
aws lambda get-alias \
  --function-name thumbnail-worker \
  --name prod \
  --region eu-west-2
```

If the alias moved to version `18` at the start of the failure, roll back to version `17` while the team prepares the correct policy or code change:

```bash
aws lambda update-alias \
  --function-name thumbnail-worker \
  --name prod \
  --function-version 17 \
  --region eu-west-2
```

After rollback, upload a test image and confirm a new thumbnail appears. Then handle old failed work. If SQS holds the messages, they can retry automatically after the function is healthy. If messages moved to a dead-letter queue, replay them after confirming the fix. If S3 invoked Lambda directly and events were lost after repeated failures, you may need a backfill script that scans the `originals/` prefix and creates missing thumbnails.

That final replay step is easy to forget. Event-driven incidents have two recoveries: restore the function for future events, then repair the events that failed during the outage.

## References

- [What is AWS Lambda?](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
- [Best practices for working with AWS Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [Lambda function handler in Node.js](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html)
- [Manage Lambda function versions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html)
- [Create a Lambda alias](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html)
- [Lambda canary deployments with weighted aliases](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html)
- [Using AWS Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [Configuring reserved concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)
