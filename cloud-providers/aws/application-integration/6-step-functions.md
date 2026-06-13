---
title: "Step Functions"
description: "Use AWS Step Functions as a managed workflow service for state machines, tasks, choices, retries, callbacks, observability, and service integrations."
overview: "Step Functions turns multi-step application work into a visible workflow. This article follows an order fulfillment scenario to show states, Amazon States Language, Standard and Express workflows, retries, callbacks, input and output shaping, idempotency, costs, payload limits, and when a queue or event bus is the cleaner fit."
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

1. [The Problem](#the-problem)
2. [What Is Step Functions](#what-is-step-functions)
3. [State Machines and Executions](#state-machines-and-executions)
4. [Amazon States Language](#amazon-states-language)
5. [Core States](#core-states)
6. [Tasks and Service Integrations](#tasks-and-service-integrations)
7. [Retries and Catch](#retries-and-catch)
8. [Standard vs Express](#standard-vs-express)
9. [Human Approval and Callback Patterns](#human-approval-and-callback-patterns)
10. [Input and Output Shaping](#input-and-output-shaping)
11. [Execution History and Observability](#execution-history-and-observability)
12. [Idempotency](#idempotency)
13. [Cost and Payload Considerations](#cost-and-payload-considerations)
14. [Queue or Event Bus Fit](#queue-or-event-bus-fit)
15. [Putting It All Together](#putting-it-all-together)

## The Problem
<!-- section-summary: Multi-step application work needs a place to track order, state, branches, retries, and failures across services. -->

The application integration module has already covered API front doors, queues, topics, and events. Those services help systems talk to each other. Now the order platform has a new kind of problem: one business process needs several services to work together in a clear sequence.

Imagine a customer places an order for a camera kit. The API accepts the checkout request, then the platform needs to validate the order, reserve inventory, charge the card, check fraud risk, ask for approval when the order value is high, create a shipping label, notify the customer, and write a final order status. Some steps can run at the same time. Some steps need retries. Some steps need a different path when a payment fails. One step may wait for a human approver.

A team can write one large Lambda function for all of that, but that function starts to own too much. It has to remember which step already ran, which retry count is active, which branch the order took, which side effect needs cleanup, and what happened before a failure. The code turns into a private workflow engine hidden inside application logic.

**AWS Step Functions** gives that workflow a managed home. The order workflow is defined as a visible state machine, and each order creates an execution with its own input, path, history, and final result. The business flow is something your team can inspect while the order is running and after it finishes.

## What Is Step Functions
<!-- section-summary: Step Functions runs workflows as state machines, where each execution moves through named states with managed tracking. -->

AWS Step Functions is a managed workflow service for building distributed applications, automating processes, coordinating microservices, and running data pipelines. A **workflow** is the whole multi-step process. A **state machine** is the definition of that workflow. A **state** is one named step inside the state machine. An **execution** is one run of the state machine with one input payload.

For the order platform, the state machine could be named `OrderFulfillmentWorkflow`. Order `ORD-1042` starts one execution. That execution moves through states such as `ValidateOrder`, `ReserveInventory`, `ChargePayment`, `CheckFraudRisk`, `RequestApproval`, and `CreateShipment`. Step Functions tracks which state is active, what data each state receives, what result it returns, and which path the execution takes next.

This matters in production because the workflow crosses service boundaries. Inventory might live behind Lambda. Payments might call an external provider through a Lambda function or HTTP integration. Fraud risk might publish an event. Shipping might use a queue because a warehouse system consumes work at its own pace. Step Functions coordinates those calls while keeping the workflow state outside the individual services.

The useful beginner idea is simple: **Step Functions is for ordered, stateful application work**. It fits processes with a known set of steps, branches, waits, retries, and failure paths that should be visible and controlled.

## State Machines and Executions
<!-- section-summary: The state machine is the reusable workflow definition, and each execution is one live or completed run of that definition. -->

A **state machine** is a JSON definition plus configuration. It says which state starts first, which states exist, which state comes next, and which states end the workflow. It also has an IAM role so Step Functions can call AWS services on behalf of the workflow. IAM is the permission system AWS uses to decide which actions an identity can perform.

An **execution** is created when something starts the state machine. API Gateway might start it after checkout. EventBridge might start it after an `OrderPlaced` event. Another Step Functions workflow might start it as a nested workflow. The execution receives JSON input, such as the order ID, customer ID, total, line items, and a correlation ID used for logs and tracing.

Here is a small execution input for the order scenario:

```json
{
  "orderId": "ORD-1042",
  "customerId": "CUST-88",
  "correlationId": "checkout-2026-06-13-00042",
  "total": 820,
  "items": [
    {
      "sku": "CAMERA-BODY-01",
      "quantity": 1
    },
    {
      "sku": "LENS-50MM-01",
      "quantity": 1
    }
  ]
}
```

That input should stay small and business-focused. A practical workflow input usually carries identifiers and decision data instead of full database records, large documents, images, or raw API responses. The services called by the workflow can read detailed data from DynamoDB, S3, or another system by using the IDs in the input.

The split between state machine and execution helps during operations. The state machine definition answers, "How should order fulfillment work?" The execution answers, "What happened to this one order?" That second question is the one on-call engineers care about at 2 a.m.

## Amazon States Language
<!-- section-summary: Amazon States Language is the JSON format that defines states, transitions, branches, and terminal results. -->

Step Functions workflows are defined with **Amazon States Language**, often shortened to ASL. ASL is JSON. It describes the state machine declaratively, which means the JSON says what states exist and how they connect. Step Functions runs that definition for each execution.

Every state machine has a `StartAt` field and a `States` object. `StartAt` names the first state. `States` contains the named state definitions. Most states use `Next` to point to the next state. A terminal state uses `End: true`, `Succeed`, or `Fail` to finish the execution.

Here is a small ASL workflow for the order platform. It validates the order, chooses an approval path for high-value orders, reserves inventory, then records success.

```json
{
  "Comment": "Fulfill one customer order.",
  "StartAt": "ValidateOrder",
  "States": {
    "ValidateOrder": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:ValidateOrder",
        "Payload.$": "$"
      },
      "ResultSelector": {
        "validatedOrder.$": "$.Payload"
      },
      "ResultPath": "$.validation",
      "Next": "NeedsApproval"
    },
    "NeedsApproval": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.validation.validatedOrder.total",
          "NumericGreaterThanEquals": 500,
          "Next": "RequestApproval"
        }
      ],
      "Default": "ReserveInventory"
    },
    "RequestApproval": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:CreateApprovalRequest",
        "Payload.$": "$"
      },
      "ResultPath": "$.approval",
      "Next": "ReserveInventory"
    },
    "ReserveInventory": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": {
        "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:ReserveInventory",
        "Payload.$": "$"
      },
      "ResultPath": "$.inventory",
      "Next": "RecordOrderReady"
    },
    "RecordOrderReady": {
      "Type": "Succeed"
    }
  }
}
```

This example shows the shape of the language. A production workflow would add retries, catches, service integrations, logging, and tighter input shaping. The important point is that the business sequence appears in the state machine definition rather than inside one long handler function.

## Core States
<!-- section-summary: States are the workflow building blocks: work, decisions, parallel branches, item loops, waits, and final outcomes. -->

A **state** is one named checkpoint in the workflow. Each state receives JSON input, does its state-specific behavior, creates JSON output, then hands that output to the next state. The state type controls what happens at that checkpoint.

Here are the state types a beginner should recognize first:

| State type | What it does | Order workflow example |
| --- | --- | --- |
| **Task** | Calls Lambda, another AWS service, an activity worker, or an HTTPS endpoint | Charge payment or update DynamoDB |
| **Choice** | Selects the next state based on input data | High-value orders go to approval |
| **Parallel** | Runs multiple branches at the same time and waits for them | Check fraud risk and reserve inventory together |
| **Map** | Runs the same mini-workflow for each item in an array or dataset | Reserve each line item in the order |
| **Wait** | Pauses for a fixed time or timestamp | Wait 15 minutes before a payment status check |
| **Pass** | Passes or shapes data without external work | Add a default field while testing |
| **Succeed** | Finishes the execution successfully | Order is ready for shipping |
| **Fail** | Finishes the execution as failed | Payment declined and order closed |

A **Choice** state is the workflow's branching point. In the order scenario, high-value orders need approval, while smaller orders can continue automatically.

```json
{
  "NeedsApproval": {
    "Type": "Choice",
    "Choices": [
      {
        "Variable": "$.total",
        "NumericGreaterThanEquals": 500,
        "Next": "RequestApproval"
      }
    ],
    "Default": "ReserveInventory"
  }
}
```

A **Parallel** state runs branches concurrently. The order platform can check fraud risk and reserve inventory in separate branches, then continue after both branches finish. Each branch has its own `StartAt` and `States` section.

```json
{
  "FraudAndInventory": {
    "Type": "Parallel",
    "Branches": [
      {
        "StartAt": "CheckFraudRisk",
        "States": {
          "CheckFraudRisk": {
            "Type": "Task",
            "Resource": "arn:aws:states:::lambda:invoke",
            "Parameters": {
              "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:CheckFraudRisk",
              "Payload.$": "$"
            },
            "End": true
          }
        }
      },
      {
        "StartAt": "ReserveInventory",
        "States": {
          "ReserveInventory": {
            "Type": "Task",
            "Resource": "arn:aws:states:::lambda:invoke",
            "Parameters": {
              "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:ReserveInventory",
              "Payload.$": "$"
            },
            "End": true
          }
        }
      }
    ],
    "ResultPath": "$.checks",
    "Next": "ChargePayment"
  }
}
```

A **Map** state repeats work for every item. For a normal order with a small line-item array, Inline Map is usually enough. For a large dataset stored in S3, Distributed Map gives each item or batch its own child workflow execution and avoids the parent execution growing too large.

```json
{
  "ReserveEachItem": {
    "Type": "Map",
    "ItemsPath": "$.items",
    "MaxConcurrency": 5,
    "ItemSelector": {
      "orderId.$": "$$.Execution.Input.orderId",
      "item.$": "$$.Map.Item.Value"
    },
    "ItemProcessor": {
      "ProcessorConfig": {
        "Mode": "INLINE"
      },
      "StartAt": "ReserveOneItem",
      "States": {
        "ReserveOneItem": {
          "Type": "Task",
          "Resource": "arn:aws:states:::lambda:invoke",
          "Parameters": {
            "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:ReserveOneItem",
            "Payload.$": "$"
          },
          "End": true
        }
      }
    },
    "ResultPath": "$.itemReservations",
    "Next": "ChargePayment"
  }
}
```

A **Wait** state pauses the workflow. This is useful for business time, such as waiting before checking a slow external payment status, or waiting until a promised shipment release time.

```json
{
  "WaitBeforePaymentStatusCheck": {
    "Type": "Wait",
    "Seconds": 900,
    "Next": "CheckPaymentStatus"
  }
}
```

Those five states cover most beginner workflows: Task for work, Choice for decisions, Parallel for independent branches, Map for repeated items, and Wait for time.

## Tasks and Service Integrations
<!-- section-summary: Task states can call Lambda, AWS services, activities, and HTTP endpoints through Step Functions integrations. -->

A **Task** state represents work performed outside the workflow engine. A task can invoke Lambda, call supported AWS service APIs directly, call an HTTPS endpoint, or wait for an activity worker. The task is where Step Functions reaches into the rest of your application.

Many teams start with Lambda tasks because Lambda gives them normal code. That is fine for business logic such as payment provider calls or custom validation. But Step Functions also has **service integrations**, which let the state machine call AWS APIs directly. For example, the workflow can update DynamoDB, send an SQS message, publish to SNS, put an event on EventBridge, start an ECS task, or start another Step Functions execution.

Here is a DynamoDB service integration that records the order status after inventory is reserved. DynamoDB is AWS's managed key-value and document database service.

```json
{
  "RecordReservedStatus": {
    "Type": "Task",
    "Resource": "arn:aws:states:::dynamodb:updateItem",
    "Parameters": {
      "TableName": "Orders",
      "Key": {
        "orderId": {
          "S.$": "$.orderId"
        }
      },
      "UpdateExpression": "SET orderStatus = :status, updatedAt = :updatedAt",
      "ExpressionAttributeValues": {
        ":status": {
          "S": "RESERVED"
        },
        ":updatedAt": {
          "S.$": "$$.State.EnteredTime"
        }
      }
    },
    "ResultPath": null,
    "Next": "ChargePayment"
  }
}
```

Notice the practical shape. The workflow passes the order ID, writes a small status update, and discards the raw DynamoDB result with `ResultPath: null`. The next state receives the original workflow input instead of a large DynamoDB response.

Service integrations also need permissions. The state machine has an IAM role, and that role must allow the specific API actions and resources the workflow uses. For the DynamoDB example, the role needs `dynamodb:UpdateItem` on the `Orders` table. This keeps permissions attached to the workflow rather than hidden in a Lambda function that only forwards the call.

## Retries and Catch
<!-- section-summary: Retry handles temporary failures, while Catch sends known failures to a deliberate recovery or closing path. -->

Distributed workflows fail in ordinary ways. A Lambda function times out. A payment provider returns a temporary `503`. DynamoDB throttles a write. An inventory service reports that one item is out of stock. The workflow needs a planned response for each kind of failure.

**Retry** tells Step Functions to try a state again after matching errors. A retrier can include the first delay, maximum attempts, and backoff rate. This is useful for temporary failures where the same action may succeed a moment later.

**Catch** tells Step Functions where to go after a state fails and retries have been exhausted. A catcher turns a failure into a branch. In the order workflow, payment failure can move to `ReleaseInventory` and then `MarkOrderFailed`.

```json
{
  "ChargePayment": {
    "Type": "Task",
    "Resource": "arn:aws:states:::lambda:invoke",
    "Parameters": {
      "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:ChargePayment",
      "Payload.$": "$"
    },
    "Retry": [
      {
        "ErrorEquals": [
          "Lambda.ServiceException",
          "Lambda.AWSLambdaException",
          "Lambda.SdkClientException",
          "PaymentProvider.Timeout"
        ],
        "IntervalSeconds": 2,
        "MaxAttempts": 3,
        "BackoffRate": 2
      }
    ],
    "Catch": [
      {
        "ErrorEquals": [
          "PaymentProvider.CardDeclined"
        ],
        "ResultPath": "$.paymentError",
        "Next": "ReleaseInventory"
      },
      {
        "ErrorEquals": [
          "States.ALL"
        ],
        "ResultPath": "$.unhandledError",
        "Next": "MarkOrderNeedsReview"
      }
    ],
    "ResultPath": "$.payment",
    "Next": "CreateShipment"
  }
}
```

The beginner rule is to separate **temporary technical errors** from **business outcomes**. A network timeout deserves a retry. A declined card deserves a business branch. An unknown error deserves a review path with enough context for support or engineering.

Retries can create repeated side effects. If `ChargePayment` reaches the payment provider and the response is lost, the retry might call the provider again. That is why payment calls need idempotency keys, which we will cover later in this article.

## Standard vs Express
<!-- section-summary: Standard workflows fit durable, longer, auditable business processes; Express workflows fit short, high-volume, idempotent flows. -->

Step Functions has two workflow types: **Standard Workflows** and **Express Workflows**. The workflow type is one of the most important design choices because it affects duration, execution semantics, observability, integration patterns, and pricing.

| Question | Standard Workflows | Express Workflows |
| --- | --- | --- |
| How long can an execution run? | Up to one year | Up to five minutes |
| What kind of work fits? | Long-running, auditable business processes | High-volume, short-lived request or event processing |
| Execution behavior | Exactly-once workflow execution | Asynchronous Express uses at-least-once execution; Synchronous Express uses at-most-once execution |
| History and debugging | Detailed execution history through Step Functions APIs and console | CloudWatch Logs and Step Functions console experience with logging enabled |
| Integration patterns | Request response, job-run `.sync`, and callback `.waitForTaskToken` where supported | Request response integrations |
| Pricing shape | Charged by state transitions | Charged by request count, duration, and memory used |

For the order fulfillment scenario, Standard is the natural starting point. The process might wait for approval, last more than five minutes, need detailed execution history, and include non-idempotent actions such as charging a card. Callback and job-run integration patterns also belong with Standard workflows.

Express fits a different part of the order platform. Suppose every `OrderViewed` event needs a short enrichment flow that adds customer segment data, writes a metric, and publishes a small event. That flow is short, high-volume, and safe to repeat because each step uses idempotent writes. Express can be a strong fit there.

Some production systems use both. A Standard workflow can own the durable order process, while an Express workflow handles short idempotent enrichment inside one step. This keeps the long business process auditable and gives high-volume helper work a cheaper execution model.

## Human Approval and Callback Patterns
<!-- section-summary: Callback tasks let Standard workflows pause until an external system or person returns a task token. -->

Some workflows need a person or external system in the middle. In the order platform, a high-value order might need fraud review. The workflow should pause, send an approval request, and continue only after a reviewer approves or rejects it.

Step Functions supports this with the **callback pattern**. A callback task creates a **task token**, sends that token to another system, and waits. The external system later calls `SendTaskSuccess` or `SendTaskFailure` with that token. The workflow then resumes from the paused state.

Here is a beginner version using SQS. The workflow sends a message to an approval queue and waits for the callback token to come back. SQS is AWS's managed queue service for passing messages between components.

```json
{
  "RequestApproval": {
    "Type": "Task",
    "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
    "Parameters": {
      "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/order-approvals",
      "MessageBody": {
        "taskToken.$": "$$.Task.Token",
        "orderId.$": "$.orderId",
        "customerId.$": "$.customerId",
        "total.$": "$.total",
        "correlationId.$": "$.correlationId"
      }
    },
    "TimeoutSeconds": 86400,
    "ResultPath": "$.approval",
    "Next": "ApprovalDecision"
  },
  "ApprovalDecision": {
    "Type": "Choice",
    "Choices": [
      {
        "Variable": "$.approval.decision",
        "StringEquals": "APPROVED",
        "Next": "ReserveInventory"
      }
    ],
    "Default": "MarkOrderRejected"
  }
}
```

A practical approval flow has a few moving parts. The queue message starts a Lambda function that creates an approval record in DynamoDB and sends a link to an internal review UI. The reviewer opens the UI, checks the order, then clicks approve or reject. API Gateway receives that click, a Lambda function verifies the reviewer, reads the stored token, and calls `SendTaskSuccess` or `SendTaskFailure`.

Treat the task token like a secret. Store it server-side, protect the approval endpoint with real authentication, and avoid placing raw tokens directly in emails or chat messages. Add a timeout so abandoned approvals move to a known path, such as `MarkOrderNeedsManualFollowUp`.

## Input and Output Shaping
<!-- section-summary: InputPath, Parameters, ResultSelector, ResultPath, and OutputPath control how JSON moves between states. -->

Every Step Functions state receives JSON and returns JSON. Without shaping, workflow data can grow quickly because each task response adds more fields. Large responses make execution history harder to read, increase log size, and can hit payload quotas.

For JSONPath-based workflows, five fields control the data flow:

| Field | What it controls | Practical use |
| --- | --- | --- |
| **InputPath** | Which part of the state input reaches the state | Send only `$.payment` to a payment step |
| **Parameters** | The exact request sent to the task or service | Build a Lambda payload or DynamoDB request |
| **ResultSelector** | The shape of the raw task result before storing it | Keep only `Payload.paymentId` from Lambda output |
| **ResultPath** | Where the result is placed in the original input | Save payment result under `$.payment` |
| **OutputPath** | Which part of the state output goes to the next state | Pass only the clean order object forward |

Here is a payment task that sends only the fields the function needs, keeps only the useful result, and stores that result under `$.payment`.

```json
{
  "ChargePayment": {
    "Type": "Task",
    "Resource": "arn:aws:states:::lambda:invoke",
    "InputPath": "$",
    "Parameters": {
      "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:ChargePayment",
      "Payload": {
        "orderId.$": "$.orderId",
        "customerId.$": "$.customerId",
        "amount.$": "$.total",
        "idempotencyKey.$": "$.orderId"
      }
    },
    "ResultSelector": {
      "paymentId.$": "$.Payload.paymentId",
      "status.$": "$.Payload.status"
    },
    "ResultPath": "$.payment",
    "Next": "CreateShipment"
  }
}
```

The output after this state keeps the original order fields and adds a small `payment` object. That is easier to debug than passing a full Lambda invocation response through every later state.

This is one of the most useful habits with Step Functions: **pass IDs and small decisions through the workflow, and store large data elsewhere**. If an order has a generated invoice PDF, the workflow should pass an S3 bucket and key instead of the PDF content. If an external API returns a huge response, a Lambda function or service integration should store it and return a small reference.

## Execution History and Observability
<!-- section-summary: Step Functions gives each execution a traceable story through history, logs, metrics, and optional X-Ray traces. -->

Observability means your team can answer what happened without guessing. Step Functions helps because each execution has a visible path. For Standard workflows, the execution history records state entries, task starts, task results, retries, catches, waits, and final status. For Express workflows, CloudWatch Logs become the main place to inspect execution details after logging is enabled.

In the order platform, an on-call engineer can search for execution name `ORD-1042`, open the execution, and see that validation passed, fraud risk returned `REVIEW`, approval timed out, and the workflow moved to `MarkOrderNeedsManualFollowUp`. That history is more useful than searching several Lambda log groups and trying to reconstruct the sequence by timestamps.

A production setup should include these habits:

- A stable execution name that includes the order ID, such as `order-ORD-1042`, can protect callers that safely enforce uniqueness.
- Include `orderId` and `correlationId` in the execution input so logs from Lambda, API Gateway, and other services can be joined.
- Enable CloudWatch Logs for workflows that need retained execution details, and choose payload logging carefully when inputs contain customer data.
- Create CloudWatch alarms for failed, timed-out, aborted, and throttled executions.
- Enable X-Ray tracing when the workflow needs service-level latency visibility across Lambda and other traced integrations.

There is one detail worth knowing early. Standard workflow execution history is kept for a limited retention period after completion, and each execution has an event history quota. Long loops and large inline maps can create many history events. For large item processing, Distributed Map or nested executions can keep each execution history smaller and easier to operate.

## Idempotency
<!-- section-summary: Workflows need duplicate-safe side effects because retries, callbacks, and client retries can call external systems more than once. -->

**Idempotency** means repeating the same request produces the same intended result instead of creating a duplicate side effect. Charging a customer twice is the classic danger. Creating two shipping labels for one order is another. Sending two customer emails may be less severe, but it still creates confusion.

Step Functions gives some help at the execution boundary. `StartExecution` is idempotent for Standard workflows when the caller uses the same execution name and the same input while the execution is running. In that case, AWS returns the same response for the running execution. Express workflow starts have a different execution model, so the application should handle duplicate starts itself.

Downstream tasks still need their own protection. The workflow can retry a task after a timeout. The caller can retry starting a workflow. A reviewer can double-click approve. A Lambda function can receive the same event again. Each side effect should use a stable business key.

For the order platform, practical idempotency looks like this:

- Start the Standard execution with a name derived from the order ID, such as `order-ORD-1042`.
- Send `orderId` as the idempotency key to the payment provider.
- DynamoDB conditional writes can record `PAYMENT_CAPTURED` once for one order.
- Store approval decisions by `orderId` and reject second decisions after the first final decision is saved.
- Create shipping labels with an idempotency key or a database record that maps one order to one label.

Here is a simple DynamoDB condition inside a service integration. It records a payment ID only when the order has no existing `paymentId`.

```json
{
  "RecordPaymentOnce": {
    "Type": "Task",
    "Resource": "arn:aws:states:::dynamodb:updateItem",
    "Parameters": {
      "TableName": "Orders",
      "Key": {
        "orderId": {
          "S.$": "$.orderId"
        }
      },
      "UpdateExpression": "SET paymentId = :paymentId, orderStatus = :status",
      "ConditionExpression": "attribute_not_exists(paymentId)",
      "ExpressionAttributeValues": {
        ":paymentId": {
          "S.$": "$.payment.paymentId"
        },
        ":status": {
          "S": "PAID"
        }
      }
    },
    "ResultPath": null,
    "Next": "CreateShipment"
  }
}
```

This kind of guard belongs near every irreversible action. Step Functions can coordinate the workflow, and the services still own the rules that make their side effects safe to repeat.

## Cost and Payload Considerations
<!-- section-summary: Workflow cost follows state transitions or request-duration pricing, while payload and history limits shape the data design. -->

Step Functions pricing depends on workflow type. Standard Workflows are charged by state transition. A state transition happens when an execution moves from one state to the next. Express Workflows use request count, duration, and memory-based billing. The right choice depends on workflow volume, duration, number of steps, and how much audit detail the process needs.

For the order workflow, a Standard execution with fifteen transitions is easy to reason about. You can estimate monthly cost by multiplying order count by transitions per order, then applying the Standard transition price for the Region. For a short enrichment flow that runs millions of times per day, Express may have a better cost shape because the work is short and high-volume.

Payload design matters just as much as pricing. Step Functions has a maximum input or output size for a task, state, or execution. The documented quota is 256 KiB of UTF-8 JSON data. CloudWatch Logs can also truncate large escaped input and output values. Large workflow payloads also make debugging unpleasant because every state carries too much data.

A production workflow usually uses the **claim check pattern** for large data. The workflow stores large data in S3 or a database and passes a small reference through the state machine.

```json
{
  "orderId": "ORD-1042",
  "invoice": {
    "bucket": "order-documents-prod",
    "key": "invoices/ORD-1042.pdf"
  }
}
```

Map states need extra care. Inline Map is useful for a small array such as line items in a normal order. A large batch, such as processing millions of order export records, should use Distributed Map with input stored in S3. Distributed Map gives child workflow executions their own histories and supports large-scale parallel processing without stuffing the parent execution with every item.

The practical design question is this: how many steps, how much data, how long, and how many executions per day? Those four numbers usually tell you whether the workflow should be Standard, Express, split into nested workflows, or partly moved to queues and events.

## Queue or Event Bus Fit
<!-- section-summary: Step Functions coordinates a known process, while SQS buffers work and EventBridge routes facts to interested systems. -->

Step Functions works beside queues and event buses as one piece of the integration design. The order platform may use all three because they solve different integration problems.

| Use this | Best fit | Order platform example |
| --- | --- | --- |
| **Step Functions** | A known multi-step process with state, branches, waits, retries, and clear success or failure | Fulfill one paid order from validation through shipment |
| **SQS** | A durable work buffer where producers and consumers should run at their own pace | Send shipment requests to warehouse workers with retry and dead-letter handling |
| **EventBridge** | Routing facts from one producer to many interested consumers | Publish `OrderFulfilled` so analytics, email, and loyalty systems can react independently |

SQS fits the main need of buffering work. A producer can place a message on the queue and move on. Consumers pull messages when they have capacity. Dead-letter queues help isolate messages that keep failing. This fits work such as warehouse label printing, email sending, and slow partner handoffs.

EventBridge fits the main need of event routing. The order service can publish `OrderPlaced` or `OrderFulfilled` without knowing which systems care. Rules route matching events to targets such as Lambda, SQS, Step Functions, or another event bus. This fits fanout and loose coupling.

Step Functions fits the main need of workflow ownership. The order process has a start, an expected path, business branches, retries, waits, and a final outcome. The workflow needs to remember where it is and show what happened.

These services often connect. API Gateway can start a Step Functions execution. A Step Functions task can send a message to SQS and wait for a callback. A workflow can put an event on EventBridge after fulfillment succeeds. EventBridge can start a workflow after an order event. The clean design is the one where each service has one clear job.

## Putting It All Together
<!-- section-summary: A production Step Functions workflow keeps the business path visible, data small, side effects safe, and integration choices deliberate. -->

The order platform now has a place for the full fulfillment process. API Gateway accepts the checkout request. The application starts `OrderFulfillmentWorkflow` with a small JSON input. Step Functions validates the order, branches for approval, runs fraud and inventory checks, retries temporary failures, catches known business failures, writes status updates through service integrations, waits for callbacks when humans are involved, and publishes a final event when the order is fulfilled.

The workflow definition should stay readable. State names should describe business actions. Task payloads should carry only the fields needed by that task. Large documents and API responses should live in S3 or a database, with references passed through the workflow. Every irreversible action should use an idempotency key. Every failure path should leave the order in a status support teams can understand.

Standard Workflows fit the durable order process because it can run for more than a few minutes, needs history, and may wait for approval. Express Workflows fit short idempotent helper flows. SQS handles buffering work for consumers. EventBridge handles event fanout. Step Functions handles the known stateful process that connects them.

That is the production value of Step Functions. It moves coordination out of hidden code and into a managed workflow that your team can design, operate, debug, and improve one state at a time.

---

**References**

- [What is AWS Step Functions?](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html) - Official Step Functions overview for workflows, state machines, distributed applications, microservices, and data pipelines.
- [Amazon States Language](https://states-language.net/) - Official Amazon States Language specification for defining state machines in JSON.
- [Task workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html) - AWS documentation for Task states and supported task resources.
- [Parallel workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-parallel.html) - AWS documentation for Parallel state branch behavior.
- [Map workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-map.html) - AWS documentation for Inline and Distributed Map modes.
- [Choosing workflow type in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html) - AWS comparison of Standard and Express workflow types, durations, execution semantics, and integration-pattern support.
- [AWS Step Functions Pricing](https://aws.amazon.com/step-functions/pricing/) - Official pricing page for Standard state-transition pricing and Express request, duration, and memory pricing.
- [Handling errors in Step Functions workflows](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html) - AWS documentation for Retry and Catch behavior.
- [Discover service integration patterns in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html) - AWS documentation for request response, job-run, and callback integration patterns.
- [Deploying a workflow that waits for human approval in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/tutorial-human-approval.html) - AWS tutorial for a human approval workflow that pauses and resumes through approval.
- [Processing input and output in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-input-output-filtering.html) - AWS documentation for `InputPath`, `Parameters`, `ResultSelector`, `ResultPath`, and `OutputPath`.
- [Using CloudWatch Logs to log execution history in Step Functions](https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html) - AWS documentation for workflow logging and payload truncation considerations.
- [Step Functions service quotas](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html) - AWS documentation for payload size, execution duration, history, and related quotas.
- [StartExecution API reference](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html) - AWS documentation for Standard workflow start idempotency and Express workflow start behavior.
- [Amazon SQS documentation](https://docs.aws.amazon.com/sqs/) - AWS documentation for SQS as a managed queue for decoupling and scaling distributed components.
- [What is Amazon EventBridge?](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is.html) - AWS documentation for EventBridge as an event bus for event-driven applications.
