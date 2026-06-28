---
title: "Step Functions"
description: "Use AWS Step Functions as a managed workflow service for state machines, tasks, choices, retries, callbacks, observability, and service integrations."
overview: "Step Functions turns multi-step application work into a visible workflow. This article follows a lesson publishing process to show state machines, executions, Amazon States Language, task states, choices, retries, callbacks, Standard and Express workflows, input and output shaping, execution history, idempotency, cost, payload limits, and where queues or event buses are a cleaner fit."
tags: ["aws", "step-functions", "workflows", "serverless"]
order: 6
id: article-cloud-providers-aws-application-integration-step-functions
aliases:
  - step-functions
  - amazon-step-functions
  - workflows
  - 6-step-functions
  - cloud-providers/aws/application-integration/6-step-functions.md
  - cloud-providers/aws/application-integration/3-event-driven-architecture.md#step-functions
---

## Table of Contents

1. [The Process That Needs State](#the-process-that-needs-state)
2. [What Step Functions Does](#what-step-functions-does)
3. [State Machines and Executions](#state-machines-and-executions)
4. [Amazon States Language](#amazon-states-language)
5. [Create a Publish Workflow](#create-a-publish-workflow)
6. [Start and Inspect an Execution](#start-and-inspect-an-execution)
7. [Callbacks for Long-Running Work](#callbacks-for-long-running-work)
8. [Retries, Catch, and Failure Paths](#retries-catch-and-failure-paths)
9. [Standard and Express Workflows](#standard-and-express-workflows)
10. [Input, Output, and Payload Size](#input-output-and-payload-size)
11. [Observability and Operations](#observability-and-operations)
12. [Idempotency, Cost, and Fit](#idempotency-cost-and-fit)
13. [Putting It Together](#putting-it-together)
14. [References](#references)

## The Process That Needs State
<!-- section-summary: Step Functions fits multi-step work where one request needs visible order, branches, retries, waits, and final status. -->

The module has now covered the main communication shapes. API Gateway handled the direct publish request. SQS held video transcode work. SNS fanned out a lesson-published notification. EventBridge routed events to teams and accounts.

Northstar Learn still has one bigger need. One publish request has a sequence: validate the lesson, confirm the instructor's permission, start video transcode, wait for the result, check content safety, publish the lesson, send notifications, and record final status. Some steps retry. Some steps branch. Some steps wait for another service.

That sequence can live inside one large function, but the function then has to track every step, retry, branch, timeout, and partial failure. During an incident, a developer has to read logs and code to discover where one publish request stopped.

**AWS Step Functions** gives that process a visible workflow. The publish process is defined as a state machine. Each publish request starts an execution. The execution history shows which step ran, what output it produced, where it failed, and what path it followed.

## What Step Functions Does
<!-- section-summary: Step Functions runs workflows as state machines and tracks each execution as it moves through named states. -->

Step Functions is a managed workflow service for coordinating application steps across AWS services and custom code. A **workflow** is the whole process. A **state machine** is the definition of that process. A **state** is one named step. An **execution** is one run of the state machine with one input.

For Northstar Learn, the workflow is lesson publishing. The state machine can be named `PublishLessonWorkflow`. One instructor click starts an execution for `lesson-1042`. That execution moves through states such as `ValidateLesson`, `ReadyToPublish?`, `StartTranscode`, and `PublishEvent`.

Step Functions is useful because it keeps workflow state outside the individual services. Lambda functions can stay focused on validation or small pieces of business logic. SQS workers can process long-running jobs. EventBridge can publish final facts. Step Functions coordinates the order and records the history.

The beginner definition is: **Step Functions is for ordered, stateful application work**. It fits processes with named steps, branches, waits, retries, and failure paths that the team wants to see clearly.

## State Machines and Executions
<!-- section-summary: The state machine is the reusable workflow definition, and each execution is one live or completed run. -->

A **state machine** is a JSON definition plus configuration. It names the first state, defines each state, and tells Step Functions what happens next. It also has an IAM role so Step Functions can call other AWS services on behalf of the workflow.

An **execution** starts when something invokes the state machine. API Gateway could start it after the `POST /publish` request. EventBridge could start it after a `LessonPublishRequested` event. Another workflow could start it as a nested process.

Here is a small execution input for one lesson:

```json
{
  "publishRequestId": "pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P",
  "lessonId": "lesson-1042",
  "courseId": "course-aws-foundations",
  "requestedBy": "instructor-77",
  "correlationId": "req-9ef0d6c8"
}
```

The input gives the workflow stable identifiers. It keeps large lesson content and video files outside the workflow payload. The workflow can pass IDs to Lambda, SQS, and EventBridge while those services load full details from the systems that own them.

![The execution path shows how a state machine keeps step order, state, and history for a multi-step publishing workflow](/content-assets/articles/article-cloud-providers-aws-application-integration-step-functions/state-machine-execution.png)

*The execution path shows how a state machine keeps step order, state, and history for a multi-step publishing workflow.*


## Amazon States Language
<!-- section-summary: Amazon States Language is the JSON workflow definition that describes states, transitions, retries, and service calls. -->

Step Functions workflows are defined with **Amazon States Language**, often shortened to **ASL**. ASL is JSON that names states and transitions. A state can call a service, make a choice, wait, run branches in parallel, map over items, succeed, or fail.

Here is a compact workflow definition for the lesson publishing path:

```json
{
  "Comment": "Publish one Northstar lesson",
  "StartAt": "ValidateLesson",
  "States": {
    "ValidateLesson": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:validateLessonForPublish",
        "Payload.$": "$"
      },
      "ResultPath": "$.validation",
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException"
          ],
          "IntervalSeconds": 2,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "Next": "ReadyToPublish?"
    },
    "ReadyToPublish?": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.validation.Payload.ready",
          "BooleanEquals": true,
          "Next": "StartTranscode"
        }
      ],
      "Default": "RejectPublishRequest"
    },
    "StartTranscode": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
      "Parameters": {
        "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/lesson-transcode-jobs",
        "MessageBody": {
          "jobType": "TranscodeLessonVideo",
          "lessonId.$": "$.lessonId",
          "publishRequestId.$": "$.publishRequestId",
          "correlationId.$": "$.correlationId",
          "taskToken.$": "$$.Task.Token"
        }
      },
      "TimeoutSeconds": 7200,
      "ResultPath": "$.transcode",
      "Next": "PublishEvent"
    },
    "PublishEvent": {
      "Type": "Task",
      "Resource": "arn:aws:states:::events:putEvents",
      "Parameters": {
        "Entries": [
          {
            "EventBusName": "northstar-publishing",
            "Source": "com.northstar.lessons",
            "DetailType": "LessonPublished",
            "Detail": {
              "eventId.$": "$.publishRequestId",
              "lessonId.$": "$.lessonId",
              "courseId.$": "$.courseId",
              "correlationId.$": "$.correlationId"
            }
          }
        ]
      },
      "End": true
    },
    "RejectPublishRequest": {
      "Type": "Fail",
      "Error": "LessonNotReady",
      "Cause": "The validation step reported that the lesson cannot be published yet."
    }
  }
}
```

`StartAt` tells Step Functions which state runs first. `ValidateLesson` calls Lambda and stores the result under `$.validation`. `ReadyToPublish?` branches based on the Lambda response. `StartTranscode` sends a message to SQS and waits for a callback token. `PublishEvent` sends a final event to EventBridge. `RejectPublishRequest` ends the workflow with a clear failure when validation says the lesson is missing required content.

The definition is intentionally compact, but it shows the main workflow ideas: task states, a choice state, a retry rule, a callback task token, service integrations, result paths, and a fail state.

## Create a Publish Workflow
<!-- section-summary: A state machine needs a definition and an IAM role that allows Step Functions to call the services in the workflow. -->

Step Functions needs an IAM role for the workflow. The role should allow only the actions the state machine needs, such as invoking the validation Lambda, sending to the transcode queue, and putting events on the publishing bus.

The command below creates a Standard state machine from a local ASL file:

```bash
aws stepfunctions create-state-machine \
  --name PublishLessonWorkflow \
  --definition file://publish-lesson-workflow.asl.json \
  --role-arn arn:aws:iam::123456789012:role/service-role/PublishLessonWorkflowRole \
  --type STANDARD
```

Example output:

```json
{
  "stateMachineArn": "arn:aws:states:us-east-1:123456789012:stateMachine:PublishLessonWorkflow",
  "creationDate": "2026-06-27T10:05:12.421000+00:00"
}
```

`stateMachineArn` is the identifier used to start executions. `--type STANDARD` chooses the workflow type, which the article covers later. The IAM role is part of the configuration because Step Functions calls Lambda, SQS, and EventBridge as the workflow runs.

Infrastructure as code is the normal production path for this definition. The CLI command is useful for learning because it makes the moving parts visible: definition, role, name, and workflow type.

## Start and Inspect an Execution
<!-- section-summary: Starting an execution creates one workflow run, and inspection commands show live or completed state. -->

The command below starts one execution for `lesson-1042`. The execution name uses the publish request so retries from the caller can avoid starting duplicate workflows with the same name during the execution-name uniqueness window.

```bash
aws stepfunctions start-execution \
  --state-machine-arn arn:aws:states:us-east-1:123456789012:stateMachine:PublishLessonWorkflow \
  --name pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P \
  --input '{"publishRequestId":"pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P","lessonId":"lesson-1042","courseId":"course-aws-foundations","requestedBy":"instructor-77","correlationId":"req-9ef0d6c8"}'
```

Example output:

```json
{
  "executionArn": "arn:aws:states:us-east-1:123456789012:execution:PublishLessonWorkflow:pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P",
  "startDate": "2026-06-27T10:06:03.819000+00:00"
}
```

`executionArn` identifies this one run. It is the value to keep in logs, API responses, and support tools when a user asks why one publish request is still processing.

The command below describes the execution:

```bash
aws stepfunctions describe-execution \
  --execution-arn arn:aws:states:us-east-1:123456789012:execution:PublishLessonWorkflow:pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P
```

Example output while the workflow waits for the transcode callback:

```json
{
  "executionArn": "arn:aws:states:us-east-1:123456789012:execution:PublishLessonWorkflow:pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P",
  "stateMachineArn": "arn:aws:states:us-east-1:123456789012:stateMachine:PublishLessonWorkflow",
  "name": "pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P",
  "status": "RUNNING",
  "startDate": "2026-06-27T10:06:03.819000+00:00"
}
```

The `RUNNING` status tells the team the workflow has not finished. To see where it is waiting, use the execution history.

```bash
aws stepfunctions get-execution-history \
  --execution-arn arn:aws:states:us-east-1:123456789012:execution:PublishLessonWorkflow:pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P \
  --max-results 8
```

Example output, shortened to the key events:

```json
{
  "events": [
    {
      "id": 1,
      "type": "ExecutionStarted"
    },
    {
      "id": 2,
      "type": "TaskStateEntered",
      "stateEnteredEventDetails": {
        "name": "ValidateLesson"
      }
    },
    {
      "id": 5,
      "type": "ChoiceStateEntered",
      "stateEnteredEventDetails": {
        "name": "ReadyToPublish?"
      }
    },
    {
      "id": 8,
      "type": "TaskStateEntered",
      "stateEnteredEventDetails": {
        "name": "StartTranscode"
      }
    }
  ]
}
```

This output shows the workflow reached `StartTranscode`. That is much clearer than searching a large function log for private state transitions. The execution history gives developers, operators, and support one shared timeline.

## Callbacks for Long-Running Work
<!-- section-summary: Callback task tokens let a workflow pause while an external worker finishes long-running work. -->

Video transcode work may take longer than a normal Lambda invocation. The ASL definition used `arn:aws:states:::sqs:sendMessage.waitForTaskToken`, which sends an SQS message and pauses the workflow until a worker calls back with the token.

The SQS message body includes `taskToken`. The worker should treat it like a sensitive temporary credential because it can complete or fail that workflow task.

```json
{
  "jobType": "TranscodeLessonVideo",
  "lessonId": "lesson-1042",
  "publishRequestId": "pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P",
  "correlationId": "req-9ef0d6c8",
  "taskToken": "AQCEAAAAKgAAA..."
}
```

After the worker finishes the video outputs, it calls Step Functions with `SendTaskSuccess`:

```bash
aws stepfunctions send-task-success \
  --task-token "AQCEAAAAKgAAA..." \
  --task-output '{"transcodeStatus":"READY","outputs":["hls/lesson-1042/master.m3u8","thumbnails/lesson-1042/poster.jpg"]}'
```

This command returns no body on success. The workflow receives the task output under `$.transcode` because the state used `ResultPath`. It can then continue to `PublishEvent`.

When the worker detects a permanent failure, it should call `SendTaskFailure` with an error name and cause. That makes the execution history show the real failure instead of waiting until the timeout expires.

```bash
aws stepfunctions send-task-failure \
  --task-token "AQCEAAAAKgAAA..." \
  --error "UnsupportedVideoCodec" \
  --cause "The source video codec is not accepted by the transcode pipeline."
```

This command also returns no body on success. The value shows up in execution history, and any Catch rule on the waiting state can route the workflow to a failure-handling path.

## Retries, Catch, and Failure Paths
<!-- section-summary: Retry handles temporary errors, while Catch routes known failures to explicit recovery or failure states. -->

Step Functions has built-in `Retry` and `Catch` behavior. `Retry` describes when Step Functions should try a failed state again. `Catch` describes where the workflow should go after an error that should be handled by the workflow definition.

Here is a smaller retry-and-catch example for a content safety check:

```json
{
  "CheckContentSafety": {
    "Type": "Task",
    "Resource": "arn:aws:states:::lambda:invoke",
    "Parameters": {
      "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:checkLessonSafety",
      "Payload.$": "$"
    },
    "Retry": [
      {
        "ErrorEquals": [
          "Lambda.ServiceException",
          "Lambda.TooManyRequestsException"
        ],
        "IntervalSeconds": 3,
        "MaxAttempts": 4,
        "BackoffRate": 2
      }
    ],
    "Catch": [
      {
        "ErrorEquals": [
          "UnsafeLessonContent"
        ],
        "ResultPath": "$.safetyError",
        "Next": "SendToManualReview"
      },
      {
        "ErrorEquals": [
          "States.ALL"
        ],
        "ResultPath": "$.unexpectedError",
        "Next": "MarkPublishFailed"
      }
    ],
    "Next": "PublishEvent"
  }
}
```

The retry rule handles temporary Lambda service errors with exponential backoff. The first catch sends known safety failures to manual review. The final catch sends unexpected failures to a controlled failed-publish path. This keeps failure behavior visible in the workflow instead of scattering it across hidden `try/catch` blocks in application code.

In production, every side effect needs a failure story. If inventory was reserved, payment was charged, or an email was sent, the workflow needs either compensation, a manual queue, or a clear final failed state that support teams understand.

![The failure path shows how retry, backoff, catch, compensation, and alerting make workflow errors explicit](/content-assets/articles/article-cloud-providers-aws-application-integration-step-functions/retries-catch-failure-paths.png)

*The failure path shows how retry, backoff, catch, compensation, and alerting make workflow errors explicit.*


## Standard and Express Workflows
<!-- section-summary: Standard workflows fit durable long-running processes, while Express workflows fit high-volume short-running work. -->

Step Functions has **Standard** and **Express** workflow types. The publish process in this article uses Standard because it can wait for video transcode callbacks, needs durable execution history, and may run for minutes or hours.

Standard workflows are designed for long-running, durable, auditable processes. They support exactly-once workflow execution semantics for supported starts by execution name, long waits, callbacks, and detailed execution history. They are a natural fit for lesson publishing, order fulfillment, account onboarding, and approval flows.

Express workflows are designed for high-volume, short-duration workflows. They are useful for event processing, request processing, and high-throughput coordination where the execution history and billing model differ from Standard. They can be synchronous or asynchronous depending on how they are invoked.

The choice should come from the process. A visible publish workflow with callbacks and support inspection usually starts as Standard. A very high-volume data enrichment flow that finishes quickly may fit Express.

## Input, Output, and Payload Size
<!-- section-summary: Workflow payloads should carry IDs and step results, while large data stays in source systems such as S3 or databases. -->

Step Functions passes JSON input and output between states. `InputPath`, `Parameters`, `ResultPath`, and `OutputPath` control what each state receives and what it passes forward. These controls keep the workflow payload from growing without limit.

The publish workflow should carry identifiers, state results, and small decision fields. Large lesson bodies, video files, captions, and transcript content should stay in S3, a database, or the service that owns them. The workflow can pass object keys and IDs.

Here is a practical shape after validation:

```json
{
  "publishRequestId": "pub-01JZ0Z9F4R3ZV6W5K1JXG9CN0P",
  "lessonId": "lesson-1042",
  "courseId": "course-aws-foundations",
  "correlationId": "req-9ef0d6c8",
  "validation": {
    "ready": true,
    "sourceVideoKey": "uploads/lesson-1042/source.mov"
  }
}
```

This payload is small and useful. It has the IDs and decision result that the next state needs. The source video remains in S3, and the full lesson record remains in the lesson service or database.

Payload control matters because workflow payloads appear in execution history and have service limits. Good workflow design keeps sensitive data and large objects outside the state machine whenever possible.

## Observability and Operations
<!-- section-summary: Step Functions gives execution history, metrics, logs, and visual workflow status for operational support. -->

Step Functions provides execution status, execution history, CloudWatch metrics, and optional logging. The visual workflow view in the AWS Console is especially useful for support and incident response because it shows which state is active or failed.

Good workflows also carry correlation IDs. The API request ID, publish request ID, SQS message attributes, EventBridge `detail.eventId`, and Step Functions execution name should help a responder follow one publish request across the whole system.

Important metrics include executions started, succeeded, failed, timed out, throttled, and duration. Alarms should watch failed and timed-out executions for workflows that affect users. For callback tasks, teams should also watch timeouts because a worker may be failing to call back.

Execution history is a production tool, but it can expose payload fields. Avoid placing secrets, tokens, private learner data, or large documents in workflow input. Callback task tokens should only live where the trusted worker needs them.

## Idempotency, Cost, and Fit
<!-- section-summary: Workflows still need safe side effects, cost awareness, and a clear reason to coordinate steps. -->

Step Functions coordinates steps, but application code still needs idempotency. A retry can call a task again. A callback can arrive late. An operator can replay or restart a process. Each task should use stable keys such as `publishRequestId` and `lessonId` to avoid duplicate side effects.

Cost comes from state transitions, workflow type, duration, and related service calls. A state machine that adds many tiny states around simple code can cost more and add more moving parts than needed. A state machine that replaces a hidden multi-step process can save engineering time because failures and retries become visible.

The fit should stay concrete:

| Need | Better starting tool |
|---|---|
| One direct request needs an answer now | API Gateway plus backend |
| One worker group needs durable background work | SQS |
| Several subscribers need copies of one notification | SNS |
| Teams need routed events, archives, replay, or cross-account delivery | EventBridge |
| One process needs ordered steps, waits, branches, retries, and visible state | Step Functions |

Step Functions often uses the other services rather than replacing them. The publish workflow can receive the API request, send SQS work, wait for callback, publish EventBridge events, and let SNS or EventBridge notify subscribers.

## Putting It Together
<!-- section-summary: Step Functions gives the lesson publishing module a visible end-to-end process that coordinates the integration services. -->

Northstar Learn now has a complete application integration path. API Gateway accepts the instructor request. The backend or API layer starts `PublishLessonWorkflow`. Step Functions validates the lesson, sends video work to SQS, waits for the worker callback, publishes a final EventBridge event, and records the execution history.

SNS and EventBridge can notify the rest of the platform after the lesson goes live. SQS gives long-running workers durable work. Step Functions ties those pieces into one visible process with retries, branches, timeouts, and final state.

This is the concrete Step Functions distinction: **Step Functions is for workflow state**. It is the right tool when the system has moved beyond one message or one event and now needs a controlled process that humans and tools can inspect.

![The operations summary shows what to inspect when a workflow succeeds, fails, costs too much, or needs safe replay](/content-assets/articles/article-cloud-providers-aws-application-integration-step-functions/workflow-operations-summary.png)

*The operations summary shows what to inspect when a workflow succeeds, fails, costs too much, or needs safe replay.*


## References

- [What is AWS Step Functions?](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
- [Amazon States Language](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-amazon-states-language.html)
- [Standard vs Express Workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-standard-vs-express.html)
- [AWS service integrations in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-service-integrations.html)
- [Callback tasks with task tokens](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html#connect-wait-token)
- [Handling errors in Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- [Input and output processing in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-input-output-filtering.html)
