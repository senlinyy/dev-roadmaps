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

1. [The Job Shape](#the-job-shape)
2. [What Lambda Runs](#what-lambda-runs)
3. [Events, Handlers, and Execution Roles](#events-handlers-and-execution-roles)
4. [Direct Triggers and Event Source Mappings](#direct-triggers-and-event-source-mappings)
5. [Timeout, Memory, and the Runtime Environment](#timeout-memory-and-the-runtime-environment)
6. [Retry Safety and Idempotency](#retry-safety-and-idempotency)
7. [Concurrency and Downstream Pressure](#concurrency-and-downstream-pressure)
8. [Observability, Deployment, and Rollback](#observability-deployment-and-rollback)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Job Shape
<!-- section-summary: Lambda fits work that starts from an event, finishes in a bounded time, and can run independently from the main application process. -->

Imagine a marketplace where sellers upload product photos. A seller drops a large image into the app, and the platform needs to resize the image, save the web-friendly version, record metadata, and tell the search system that the product has new media. That job has a clear start, a clear finish, and a specific input: one uploaded object.

You could put that image work inside the main web API. The same process that accepts checkout requests would also load image libraries, download big files, retry failed storage calls, and deal with sudden upload spikes. The web API would carry work that has a different rhythm from normal user requests.

**AWS Lambda** is useful for this kind of job. Lambda lets AWS run a piece of application code when an event arrives. AWS manages the compute fleet, creates runtime environments, runs your handler, and scales the number of environments as events arrive. Your team focuses on the code, the event contract, permissions, timeout, memory, retries, and concurrency limits.

This article follows that image-upload pipeline through the pieces that matter in production:

| Piece | Plain meaning | Image pipeline example |
|---|---|---|
| **Event** | The JSON input that starts the work | "S3 object `raw/photo.jpg` was uploaded" |
| **Handler** | The function in your code that processes the event | `handler(event)` validates the object key and starts resizing |
| **Execution role** | The IAM role the function uses when it calls AWS APIs | Read from the upload bucket and write to the resized bucket |
| **Trigger or event source mapping** | The connection between the event producer and the function | S3, EventBridge, or SQS starts the function |
| **Timeout, memory, and concurrency** | The runtime guardrails around each invocation and the total load | Finish in 30 seconds, use 1024 MB, run at most 20 in parallel |
| **Retry and idempotency** | The safety plan for repeated events | Duplicate upload messages produce one final resized image |

That list gives the path for the article. First we look at what Lambda actually runs. Then we connect a real event to a handler and execution role. After that we deal with triggers, timeout, memory, retries, concurrency, monitoring, deployment, and rollback.

## What Lambda Runs
<!-- section-summary: A Lambda function is a code package plus runtime settings that AWS invokes for one event at a time inside managed execution environments. -->

A **Lambda function** is a named unit of application code with configuration around it. The configuration includes a runtime such as Node.js or Python, a handler name such as `index.handler`, memory, timeout, environment variables, an execution role, and optional event sources. AWS uses that configuration to prepare an **execution environment**, which is the isolated place where the runtime and your code process events.

An **invocation** is one run of the function for one incoming event payload. During an invocation, Lambda passes the event to your handler and waits until the handler returns, throws, exits, or reaches the timeout. If more events arrive while one invocation is busy, Lambda can create more execution environments so those events can run in parallel.

The execution environment has a lifecycle. Lambda initializes the runtime, runs code outside the handler, invokes the handler, and later freezes or shuts down the environment. That reuse is important. SDK clients, database clients, and other expensive objects usually belong outside the handler so the next invocation can reuse them. User-specific data, request payloads, and security-sensitive state belong inside the handler or in durable storage because a reused environment may handle a later event.

For the image pipeline, the function package might contain the resize code and its dependencies. The handler receives a message with the bucket and object key, downloads the image, writes the resized copy, and records the result. Each upload message should produce a bounded amount of work.

Lambda fits jobs like this:

| Workload | Why Lambda fits |
|---|---|
| File processing | S3 uploads create events, and each object can be handled separately |
| Scheduled cleanup | EventBridge can start a function every hour or every night |
| Queue workers | SQS can hold backlog while Lambda processes messages in batches |
| Lightweight APIs | API Gateway or a Lambda function URL can pass HTTP requests into a handler |
| Stream reactions | DynamoDB Streams or Kinesis can start work after data changes |

Long-running servers, permanent WebSocket hubs, large jobs that run beyond the function timeout, and applications built around a steady in-memory process usually fit a container service such as ECS, Fargate, EC2, or EKS. Lambda works best when the unit of work has a small contract and a clear end.

## Events, Handlers, and Execution Roles
<!-- section-summary: The handler reads the event, and the execution role gives the handler only the AWS permissions needed for that work. -->

An **event** is the JSON payload Lambda sends to your handler. The event shape comes from the service that starts the function. An S3 event has bucket and object fields. An API Gateway event has HTTP method, path, headers, query string values, and a body. An SQS event has a `Records` array, and each record contains a message ID and a message body.

That event shape is a contract. If the image pipeline reads from SQS, the handler should expect a batch of records. Each record body can contain the actual image job, such as the source bucket, source key, and image version. The handler should validate those fields before touching S3, because a bad event can come from a bug, a manual replay, or a queue message created by an older version of the app.

```json
{
  "Records": [
    {
      "messageId": "4f5c9e2d-7b3a-4e2c-bf11-7f19f8a10001",
      "body": "{\"bucket\":\"seller-uploads\",\"key\":\"raw/seller-42/photo.jpg\",\"versionId\":\"3HL4kqtJlcpXroDTDmJ+rmSpXd3dIbrHY\"}"
    }
  ]
}
```

The **handler** is the function in your code that Lambda calls. In Node.js, a common handler exports an async function. This example processes SQS records, collects only failed message IDs, and returns the partial batch response shape that Lambda expects when `ReportBatchItemFailures` is enabled.

```js
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";

const s3 = new S3Client({});
const destinationBucket = process.env.DESTINATION_BUCKET;

export const handler = async (event) => {
  const batchItemFailures = [];

  for (const record of event.Records ?? []) {
    try {
      const upload = JSON.parse(record.body);
      await resizeImage(upload);
    } catch (error) {
      console.error("Image message failed", {
        messageId: record.messageId,
        errorName: error.name,
        errorMessage: error.message
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

async function resizeImage(upload) {
  if (!upload.bucket || !upload.key) {
    throw new Error("Upload message must include bucket and key");
  }

  const source = await s3.send(new GetObjectCommand({
    Bucket: upload.bucket,
    Key: upload.key,
    VersionId: upload.versionId
  }));

  const imageBytes = await source.Body.transformToByteArray();
  const resized = await sharp(imageBytes).resize({ width: 1200 }).webp().toBuffer();
  const outputKey = upload.key.replace(/^raw\//, "resized/").replace(/\.[^.]+$/, ".webp");

  await s3.send(new PutObjectCommand({
    Bucket: destinationBucket,
    Key: outputKey,
    Body: resized,
    ContentType: "image/webp"
  }));
}
```

Notice two production habits in that code. The S3 client is created outside the handler so a reused execution environment can reuse it. The handler also returns `batchItemFailures`, which lets Lambda retry only the records that failed in an SQS batch after partial batch responses are configured.

The code still needs permissions. A Lambda function uses an **execution role**, which is an IAM role Lambda assumes automatically when it invokes the function. The trust policy lets the Lambda service assume the role, and the permission policy grants the exact AWS actions the function needs.

Trust policy for the role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Permission policy for the image function:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOriginalUploads",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::seller-uploads/raw/*"
    },
    {
      "Sid": "WriteResizedImages",
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::seller-resized-images/resized/*"
    },
    {
      "Sid": "WriteFunctionLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

This is the same IAM idea from the security module, now applied to compute. The handler has a job, and the execution role gives that job enough permission to do the work. If the image function later needs DynamoDB for idempotency records, add that one table to the role instead of handing the function broad account access.

## Direct Triggers and Event Source Mappings
<!-- section-summary: Lambda can be invoked directly by services or through event source mappings that poll queues and streams in batches. -->

After the handler and role exist, the next question is how the event reaches the function. Lambda has two common connection styles: **direct triggers** and **event source mappings**. Both start the same handler, but they behave differently under load and failure.

A **direct trigger** means another AWS service pushes an event to Lambda. S3 can invoke a function after an object event. SNS can invoke after a topic publish. API Gateway can invoke after an HTTP request. The trigger configuration usually lives with the service that produces the event, because that service decides which event should call the function.

An **event source mapping** is a Lambda resource that reads from a stream or queue and invokes your function with batches of records. SQS, Kinesis, DynamoDB Streams, Amazon MSK, and similar sources use this pattern. Lambda runs pollers, gathers records into batches, and invokes the function when batch size, batching window, or payload size conditions are met.

For the image pipeline, a direct S3 trigger can work for a small app. A production team often puts SQS between S3 and Lambda. The queue holds backlog during upload spikes, gives operations a place to inspect failed messages, and lets the worker function process a controlled number of messages at a time.

Here is a small AWS SAM shape for that setup:

```yaml
Resources:
  ImageCreatedFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: functions/image-created/
      Handler: index.handler
      Runtime: nodejs22.x
      MemorySize: 1024
      Timeout: 30
      ReservedConcurrentExecutions: 20
      Environment:
        Variables:
          DESTINATION_BUCKET: !Ref ResizedImagesBucket
          IDEMPOTENCY_TABLE: !Ref ImageWorkTable
      Policies:
        - S3ReadPolicy:
            BucketName: !Ref UploadsBucket
        - S3WritePolicy:
            BucketName: !Ref ResizedImagesBucket
        - DynamoDBCrudPolicy:
            TableName: !Ref ImageWorkTable
      Events:
        UploadQueue:
          Type: SQS
          Properties:
            Queue: !GetAtt UploadQueue.Arn
            BatchSize: 10
            FunctionResponseTypes:
              - ReportBatchItemFailures
```

This configuration says a few important things. The queue sends batches of up to 10 messages. The function can return item-level failures, so a bad image message does not force successful records in the same batch to repeat. Reserved concurrency caps the worker at 20 parallel invocations so the function cannot flood S3, DynamoDB, or an image-processing dependency during a sudden upload surge.

The same setup can be inspected and changed with the AWS CLI. A real runbook usually records commands like these so an on-call engineer can see which queue mapping is attached and can enable partial batch responses if an older mapping missed that setting.

```bash
aws lambda list-event-source-mappings \
  --function-name image-created

aws lambda update-event-source-mapping \
  --uuid a1b2c3d4-5678-90ab-cdef-11111EXAMPLE \
  --function-response-types ReportBatchItemFailures
```

Once events are flowing into the function, the next operational problem is size and time. A function that reads small images in development may time out on real marketplace uploads, so timeout and memory need deliberate settings.

## Timeout, Memory, and the Runtime Environment
<!-- section-summary: Timeout limits how long one invocation can run, while memory also controls the CPU power available to the function. -->

**Timeout** is the maximum time one Lambda invocation can run. The default is 3 seconds, and standard Lambda functions can be configured up to 900 seconds, which is 15 minutes. The timeout should cover realistic input sizes and normal downstream latency, with enough margin for slower S3 downloads, larger images, and occasional API delays.

For the image pipeline, a 3-second timeout may pass a tiny local test and fail a real 8 MB product photo. A 30-second timeout gives the function room to download the original, resize it, upload the result, and write metadata. A timeout near the normal duration is risky because one slow storage call can push the invocation over the edge.

**Memory** is the RAM available to the function, and Lambda allocates CPU power in proportion to memory. Memory can be configured from 128 MB to 10,240 MB in 1 MB increments. At 1,769 MB, a function has the equivalent of one vCPU. More memory can reduce duration for CPU-heavy image work because the function also receives more CPU.

This is why Lambda tuning uses measurements rather than guesses. A useful tuning pass starts with a memory value that fits the workload, runs the function against realistic files, and compares `Duration`, `Max Memory Used`, and cost. AWS Lambda Power Tuning is a common tool for testing several memory values in your own account and comparing duration and price.

```bash
aws lambda update-function-configuration \
  --function-name image-created \
  --timeout 30 \
  --memory-size 1024
```

The **runtime environment** also affects performance. Lambda runs initialization code before the first handler call in a fresh environment. Large dependency trees, heavy framework startup, and network calls during initialization increase cold-start latency. For Node.js functions, initialize SDK clients outside the handler, include the SDK clients your app uses in the deployment package, and keep the package focused on runtime needs.

Here is a practical way to read the evidence:

| Signal | What it usually means | Practical response |
|---|---|---|
| `Duration` is close to timeout | The function has almost no room for slow inputs | Increase timeout, reduce work per event, or split the job |
| `Max Memory Used` is close to configured memory | The function may crash or slow down on larger inputs | Increase memory and test with larger files |
| High init duration | Startup work or dependency size is slowing fresh environments | Move work out of initialization, trim dependencies, or use provisioned concurrency for latency-sensitive paths |
| Many timeouts | The function reached its time limit before finishing | Inspect input size, downstream latency, and retry behavior before raising the limit |

Configuration keeps one invocation healthy. Retry behavior keeps repeated invocations safe, and that matters because Lambda systems often process the same event more than once.

## Retry Safety and Idempotency
<!-- section-summary: Lambda workloads need idempotent handlers because async events, queues, and event source mappings can deliver the same work more than once. -->

**Retry** means AWS tries the work again after a failure. **Idempotency** means repeated processing of the same event produces one intended result. For the image pipeline, two copies of the same upload message should lead to one final resized image and one clean metadata record, rather than duplicate notifications, duplicate database rows, or repeated customer-facing side effects.

Different invocation paths retry differently. With asynchronous invocation, Lambda keeps an internal event queue and retries function errors by default. With SQS, the message stays in the queue while Lambda processes it, and if processing fails, the message can become visible again after the queue visibility timeout. AWS also documents that event source mappings process records at least once, so duplicate processing can happen even during normal operation.

The handler already returned `batchItemFailures`. That solves one part of the problem for SQS batches. If a batch has 10 image messages and only message 7 fails, Lambda can retry message 7 while the other 9 messages stay successful. Without partial batch responses, the whole batch can come back, and the function may repeat work it already completed.

Idempotency handles the deeper problem: the same logical job may arrive again. A real image pipeline usually derives an **idempotency key** from stable event facts, such as bucket, object key, and object version. Then it stores that key in DynamoDB or another durable store before performing side effects.

```js
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({});
const tableName = process.env.IDEMPOTENCY_TABLE;

export async function claimImageJob(upload) {
  const key = `${upload.bucket}:${upload.key}:${upload.versionId ?? "latest"}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;

  try {
    await dynamodb.send(new PutItemCommand({
      TableName: tableName,
      Item: {
        pk: { S: key },
        status: { S: "IN_PROGRESS" },
        expiresAt: { N: String(expiresAt) }
      },
      ConditionExpression: "attribute_not_exists(pk)"
    }));

    return { key, claimed: true };
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return { key, claimed: false };
    }

    throw error;
  }
}

export async function markImageJobDone(key, outputKey) {
  await dynamodb.send(new UpdateItemCommand({
    TableName: tableName,
    Key: { pk: { S: key } },
    UpdateExpression: "SET #status = :done, outputKey = :outputKey",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: {
      ":done": { S: "DONE" },
      ":outputKey": { S: outputKey }
    }
  }));
}
```

That code shows the basic shape, but production teams usually add a few more details. The table should have a TTL field so abandoned `IN_PROGRESS` records can age out. The handler should mark jobs `DONE` after the side effect completes. For higher-risk actions such as payments, emails, or external partner calls, teams often use Powertools for AWS Lambda idempotency utilities or a carefully reviewed internal library instead of rewriting the pattern for every function.

The operational shape looks like this:

| Step | What happens | Why it matters |
|---|---|---|
| Create key | Stable fields such as bucket, key, and version | Retries can identify the same logical job |
| Claim work | Conditional write creates an `IN_PROGRESS` record | Only one invocation owns the side effect at a time |
| Do side effect | Resize image, write output, update metadata | Business work happens once under the claim |
| Mark done | Store `DONE` and the output key | Later duplicates can skip or return the existing result |
| Handle stale claim | TTL or a repair job clears abandoned work | A timeout after claim does not block the job forever |

Retries are normal in event-driven systems. The goal is to make them boring: a retry should either finish the missing work or discover that another invocation already finished it.

## Concurrency and Downstream Pressure
<!-- section-summary: Concurrency controls protect databases, APIs, queues, and other shared systems from too many Lambda invocations at once. -->

**Concurrency** is the number of in-flight requests a Lambda function is handling at the same time. If 20 image messages are being processed at once, the function has concurrency of 20. Lambda can create separate execution environments for concurrent work until the account or function reaches a concurrency limit.

AWS accounts have a regional concurrency quota, and a common default is 1,000 concurrent executions across the Region. That sounds large for a beginner app, but one busy queue, one recursive bug, or one sudden import job can consume it quickly. Concurrency planning keeps one function from starving other functions and keeps the function from overwhelming systems it calls.

**Reserved concurrency** sets capacity aside for one function and also caps how far that function can scale. For the image pipeline, reserved concurrency of 20 means the function can process at most 20 batches at the same time. If each batch has 10 messages, the function can have up to 200 image jobs in active batch processing, depending on duration and queue behavior.

```bash
aws lambda put-function-concurrency \
  --function-name image-created \
  --reserved-concurrent-executions 20
```

Reserved concurrency is also a useful emergency brake. Setting reserved concurrency to `0` stops new invocations while messages remain in the source system according to that source's behavior. For an SQS worker, that gives the team time to patch a bad image library or fix a permission problem while the queue holds the backlog.

```bash
aws lambda put-function-concurrency \
  --function-name image-created \
  --reserved-concurrent-executions 0
```

**Provisioned concurrency** has a different purpose. It keeps pre-initialized execution environments ready for latency-sensitive traffic. An API path that users wait on may use provisioned concurrency to reduce cold-start latency. A background image queue usually cares more about throughput, cost, and downstream protection, so reserved concurrency and queue settings are often the first tools.

Concurrency also connects to batch size and duration. Larger SQS batches can reduce invocation overhead, but they increase the amount of work in one handler call. Longer duration increases concurrency for the same arrival rate because each invocation stays busy longer. A practical review looks at the queue backlog, Lambda `Duration`, `Errors`, `Throttles`, and downstream metrics such as database connection count or S3 request errors.

After concurrency is controlled, the team still needs to see what the function is doing and release changes safely. That is where observability, versions, aliases, and rollback come in.

## Observability, Deployment, and Rollback
<!-- section-summary: Production Lambda work needs logs, metrics, alarms, versioned releases, and a clear rollback path. -->

**Observability** means the team can understand the function from its external signals: logs, metrics, traces, queue depth, and failed-event destinations. For Lambda, CloudWatch metrics such as `Invocations`, `Errors`, `Throttles`, and `Duration` tell you whether the function is being called, failing, throttled, or slowing down. For queue and stream sources, age metrics matter because they show whether work is backing up.

The image function should log structured facts that help during an incident. Good log fields include `messageId`, `bucket`, `key`, `versionId`, `idempotencyKey`, `outputKey`, and the error name. These fields let an on-call engineer search one image job across the function logs, the queue, the idempotency table, and the destination bucket.

Alarms should match user impact and operational risk. A useful starter set includes high error rate, sustained throttles, duration close to timeout, SQS `ApproximateAgeOfOldestMessage` rising, and messages moving to a dead-letter queue. For SQS partial batch responses, SQS `NumberOfMessagesDeleted` and `ApproximateAgeOfOldestMessage` help show whether messages are actually leaving the queue.

Deployment safety starts with versions and aliases. A **version** is an immutable published snapshot of function code and most configuration. An **alias** is a stable name that points to a version, such as `prod`. Production triggers usually point at an alias so the team can move traffic from version to version without wiring every trigger to `$LATEST`.

```bash
aws lambda publish-version \
  --function-name image-created

aws lambda update-alias \
  --function-name image-created \
  --name prod \
  --function-version 18
```

Rollback should be as concrete as deployment. If version 18 starts failing on real images, the runbook can move `prod` back to version 17, pause processing with reserved concurrency if needed, inspect failed messages, and replay from the queue or dead-letter queue after the fix.

```bash
aws lambda update-alias \
  --function-name image-created \
  --name prod \
  --function-version 17
```

Environment variables are part of the same release discipline. They work well for operational settings such as bucket names, table names, and feature flags. Database passwords, API tokens, and partner credentials belong in AWS Secrets Manager or another secrets system, with the execution role scoped to read only the specific secret.

At this point, the function has a complete production shape: event contract, handler, execution role, trigger, runtime sizing, retry safety, concurrency guardrails, observability, and rollback.

## Putting It All Together
<!-- section-summary: A production Lambda design connects the event path, permissions, retry behavior, concurrency limits, and release controls into one operating loop. -->

Let's put the image pipeline back together from the seller's upload to the final resized image. The seller uploads `raw/seller-42/photo.jpg` into S3. The upload event reaches SQS, and the queue stores the image job until Lambda pollers read it through the event source mapping.

Lambda invokes the image function with a batch of SQS records. The handler validates each message body, derives an idempotency key from the bucket, object key, and version, claims that key in DynamoDB, downloads the original image, writes the resized image, and marks the job done. If one record fails, the handler returns that message ID in `batchItemFailures`, and Lambda retries that record later.

The execution role keeps the function scoped. It can read only the upload prefix, write only the resized prefix, write logs, and update the idempotency table. The role gives the code enough room to work without giving a failed or compromised function broad account power.

Timeout and memory match real files instead of toy samples. The function has enough CPU and memory for normal images, and the timeout leaves room for slower storage calls. CloudWatch metrics and logs show duration, errors, throttles, and the exact image job that failed.

Concurrency keeps the rest of the system safe. Reserved concurrency limits parallel image work, SQS absorbs spikes, and an emergency setting of reserved concurrency to `0` gives the team a way to pause processing. Versions and the `prod` alias let the team release a new handler and move back to the previous version if production evidence says the new one is bad.

That is the real Lambda pattern. Production Lambda work includes more than handler code. The event contract, handler code, IAM role, runtime settings, retries, concurrency, metrics, and release control all have to line up.

## What's Next

Lambda covers event-shaped work very well, especially when each job has a small input, a bounded runtime, and a clear retry plan. The next article moves to Kubernetes and Amazon EKS, where teams run long-lived container workloads under a cluster scheduler and take on a different set of operational responsibilities.

---

**References**

- [What is AWS Lambda?](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html) - Defines Lambda as compute that runs code without managing servers, explains events, permissions, runtimes, scaling, and key features.
- [Define Lambda function handler in Node.js](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html) - Documents handler shape, event input, SDK client reuse, environment variables, and Node.js Lambda best practices.
- [Defining Lambda function permissions with an execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html) - Explains execution roles, Lambda trust policy, basic logging permissions, and least-privilege guidance.
- [How Lambda processes records from stream and queue-based event sources](https://docs.aws.amazon.com/lambda/latest/dg/invocation-eventsourcemapping.html) - Explains event source mappings, batching behavior, event pollers, duplicate processing, and queue or stream sources.
- [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html) - Documents SQS polling, batching, visibility timeout behavior, duplicate handling, and partial batch response guidance.
- [Handling errors for an SQS event source in Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html) - Documents SQS retry behavior, partial batch responses, `ReportBatchItemFailures`, and Powertools batch processor support.
- [How Lambda handles errors and retries with asynchronous invocation](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html) - Explains default async retry behavior, throttling retries, event age, dead-letter queues, and failure destinations.
- [Configure Lambda function timeout](https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html) - Documents timeout defaults, limits, and configuration methods.
- [Configure Lambda function memory](https://docs.aws.amazon.com/lambda/latest/dg/configuration-memory.html) - Documents memory limits, proportional CPU allocation, CloudWatch tuning signals, and Lambda Power Tuning.
- [Understanding the Lambda execution environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html) - Explains execution environment lifecycle phases, initialization, invocation, freezing, and failure behavior.
- [Understanding Lambda function scaling](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html) - Explains concurrency, execution environment scaling, account concurrency quotas, and scaling controls.
- [Configuring reserved concurrency for a function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html) - Documents reserved concurrency, provisioned concurrency, and using reserved concurrency as a limit.
- [Best practices for working with AWS Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html) - Covers execution environment reuse, idempotent code, environment variables, recursive invocation risks, metrics, and alarms.
- [Types of metrics for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html) - Lists invocation, error, throttle, duration, deployment, and event source mapping metrics in CloudWatch.
- [Manage Lambda function versions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html) - Documents `$LATEST`, published versions, immutable version snapshots, and versioned function ARNs.
- [Create an alias for a Lambda function](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html) - Explains aliases as pointers to function versions and traffic movement between versions.
- [Working with Lambda environment variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html) - Documents environment variable behavior, limits, version locking, and Secrets Manager guidance for sensitive values.
