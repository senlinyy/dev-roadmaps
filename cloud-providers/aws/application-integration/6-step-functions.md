---
title: "AWS Step Functions"
description: "Learn how Step Functions durably remembers multi-step process state and coordinates tasks, decisions, waits, retries, compensation, and external callbacks."
overview: "Build a first-principles model of state machines and executions, Amazon States Language, integration patterns, workflow data, Standard and Express semantics, observability, redrive, cost, and workflow boundaries."
tags: ["aws", "step-functions", "workflows", "orchestration", "application-integration"]
order: 6
id: article-cloud-providers-aws-application-integration-step-functions
aliases:
  - step-functions
  - amazon-step-functions
  - aws-step-functions
  - workflows
  - 6-step-functions
  - cloud-providers/aws/application-integration/step-functions.md
  - cloud-providers/aws/application-integration/6-step-functions.md
  - cloud-providers/aws/application-integration/3-event-driven-architecture.md#step-functions
---

## Table of Contents

1. [Why Does a Multi-Step Process Need Durable Memory?](#why-does-a-multi-step-process-need-durable-memory)
2. [How Does Amazon States Language Describe a Workflow?](#how-does-amazon-states-language-describe-a-workflow)
3. [How Should You Design a Workflow from a Business Process?](#how-should-you-design-a-workflow-from-a-business-process)
4. [How Should a Workflow Handle Failure?](#how-should-a-workflow-handle-failure)
5. [How Does Data Move Through an Execution?](#how-does-data-move-through-an-execution)
6. [How Do Wait, Parallel, and Map States Change Control Flow?](#how-do-wait-parallel-and-map-states-change-control-flow)
7. [How Do You Observe, Redrive, and Pay for Workflows?](#how-do-you-observe-redrive-and-pay-for-workflows)
8. [How Does a Complete Publishing Workflow Run?](#how-does-a-complete-publishing-workflow-run)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

AWS Step Functions solves a fundamental distributed-systems problem: **How do you reliably remember where a multi-step process is and what should happen next?** It moves fragile control state out of the memory of one Lambda function, container, or server and into a managed workflow service.

Imagine an article-publishing process:

```text
validate article -> get approval -> publish article -> send notification
```

One function can call all four operations in sequence. That works only while every step is quick, every dependency responds, approval is immediate, the process never crashes, and nobody later needs a reliable record of what happened.

Suppose validation and approval succeed, then the coordinator crashes while publication is in progress. On restart, should it begin again? That can repeat validation and approval. Should it resume at publication? A new process does not know which prior steps completed. Worse, publication may have succeeded while its response was lost, so "retry" could repeat a real side effect.

Keep these questions in view as you work through the lesson:

1. **Why Does a Multi-Step Process Need Durable Memory?**
2. **How Does Amazon States Language Describe a Workflow?**
3. **How Should You Design a Workflow from a Business Process?**
4. **How Should a Workflow Handle Failure?**
5. **How Does Data Move Through an Execution?**
6. **How Do Wait, Parallel, and Map States Change Control Flow?**
7. **How Do You Observe, Redrive, and Pay for Workflows?**
8. **How Does a Complete Publishing Workflow Run?**

## Why Does a Multi-Step Process Need Durable Memory?
<!-- section-summary: A distributed process must remember its identity, progress, data, failure policy, and next action even when the coordinating compute disappears. -->

The coordinator needs durable answers to:

```text
Which process is this?
Which step is active?
Which earlier steps completed?
Which data and results are available?
What should happen next?
Which errors should retry?
What should happen after permanent failure?
```

If this knowledge exists only in process RAM, compute failure can erase workflow progress.

Step Functions separates **process lifetime** from **compute lifetime**. It stores workflow control state and invokes other systems to perform work:

```text
                   Step Functions
                 remembers progress
                 /       |        \
             Lambda   DynamoDB    SQS / APIs / ECS
```

It coordinates what runs, when it runs, what follows, which data moves, whether to wait, when to branch, and how to respond to failure. The surrounding services own algorithms, business data, and external side effects.

A useful mental model is:

> Step Functions is a durable program counter, workflow data, timers, routing, and failure policies for a distributed process.

The service does not normally perform validation, payment, publication, or image processing itself. A `Task` invokes Lambda, supported AWS service operations, HTTPS endpoints, or other integrations. Step Functions belongs to Application Integration because it coordinates independently running capabilities.

### Orchestration and choreography answer different questions

In choreography, services react to facts:

```text
OrderCreated -> EventBridge
                ├── Inventory reacts
                ├── Payment reacts
                └── Notification reacts
```

No single component necessarily owns the whole process.

In orchestration, a workflow explicitly owns the sequence:

```text
Reserve inventory -> Take payment
                         ├── success -> Ship
                         └── failure -> Release stock
```

Neither is universally better. Events are natural for independent reactions to "what happened?" A workflow is natural for "what must happen next?" when sequencing, branching, durable waiting, and central visibility matter.

### What Do State Machines, States, and Executions Mean?
<!-- section-summary: A state machine is the process definition, states are control points, transitions connect them, and each execution is one running instance with its own progress and data. -->

The central Step Functions abstraction is a **state machine**: a finite set of states and rules for moving between them.

```text
Validate -> valid?
             ├── no  -> Reject
             └── yes -> Publish
```

Step Functions calls each workflow step a **state**. Common state types are:

| State | Meaning |
| --- | --- |
| `Task` | Invoke work |
| `Choice` | Select a branch from conditions |
| `Wait` | Pause until a time or duration |
| `Parallel` | Run fixed branches concurrently |
| `Map` | Run a workflow for each item |
| `Pass` | Move or transform data without external work |
| `Succeed` | End successfully |
| `Fail` | End as a failure |

These correspond to familiar programming constructs:

```text
Task     -> function or service call
Choice   -> if / else
Map      -> loop
Parallel -> concurrent branches
Wait     -> durable timer
Succeed  -> return success
Fail     -> throw or terminate failure
Retry    -> retry loop
Catch    -> exception path
```

The workflow is a program represented as a graph.

#### A state machine definition is not an execution

`Validate -> Approve -> Publish` is the reusable definition. If three articles enter it, Step Functions creates three independent runs:

```text
Publish state machine
  ├── Execution A: waiting for approval
  ├── Execution B: publishing
  └── Execution C: failed validation
```

An **execution** is one running instance of the state machine with its own input, current state, results, retry history, and final status.

#### The durable program counter survives compute loss

A normal CPU remembers which instruction is executing. Step Functions performs a comparable job at process scale:

```text
Execution: publish-9382
Current state: WaitForApproval
Workflow data: articleId=9382, author=Sam
Completed: ValidateDraft, CheckPermissions
Next after callback: PublishArticle
```

For Standard Workflows, state is durably persisted between transitions. The Lambda that performed validation can disappear immediately. Hours later, the execution still remembers that it is waiting for approval. This is the central separation between workflow state and temporary compute.

## How Does Amazon States Language Describe a Workflow?
<!-- section-summary: Amazon States Language serializes the state graph as JSON and uses JSONata or JSONPath to select and transform workflow data. -->

AWS stores the state-machine graph in **Amazon States Language**, or ASL. This JSON definition names the starting state, each state's type and behavior, transitions, integrations, and termination.

A small approval choice can look like:

```json
{
  "Comment": "Simple publish workflow",
  "QueryLanguage": "JSONata",
  "StartAt": "CheckApproval",
  "States": {
    "CheckApproval": {
      "Type": "Choice",
      "Choices": [
        {
          "Condition": "{% $states.input.approved = true %}",
          "Next": "Publish"
        }
      ],
      "Default": "Rejected"
    },
    "Publish": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Arguments": {
        "FunctionName": "publishArticle",
        "Payload": "{% $states.input %}"
      },
      "End": true
    },
    "Rejected": {
      "Type": "Fail",
      "Error": "ArticleRejected"
    }
  }
}
```

The graph is simply:

```text
CheckApproval
  ├── approved -> Publish -> end
  └── otherwise -> Rejected
```

Learn the process graph before memorizing syntax. ASL is the serialization of that graph.

### JSONPath and JSONata handle workflow data

Step Functions passes JSON between states and supports JSONPath and JSONata for selecting and transforming it. If no query language is specified, JSONPath remains the default for backward compatibility. The source material notes that AWS recommends JSONata for new state machines.

Older JSONPath examples commonly use:

```text
InputPath
Parameters
ResultSelector
ResultPath
OutputPath
```

JSONata uses a more expression-oriented model with `Arguments`, `Assign`, `Output`, and expressions such as:

```text
{% $states.input.articleId %}
```

A JSONPath state machine can move incrementally by overriding selected states to use JSONata. The important principle under either syntax is that execution data accompanies the workflow and each state deliberately selects, transforms, and returns what later states need.

## How Should You Design a Workflow from a Business Process?
<!-- section-summary: Model business states and decisions first, then map each step to a Step Functions state and an AWS or external integration. -->

Suppose the requirement is: a draft must be validated, approved by an editor, published, and announced. Draw the business process before selecting AWS resources:

```text
Draft submitted
      |
   Validate
      |
    valid?
   /      \
 no       yes
 |         |
Reject   Wait for editor
             |
          approved?
          /      \
        no       yes
        |         |
      Reject    Publish
                   |
                 Notify
                   |
                  Done
```

Then map process concepts to technical states:

```text
Validate        -> Lambda Task
Valid?          -> Choice
Wait for editor -> Callback Task
Approved?       -> Choice
Publish         -> Lambda, API, or AWS service Task
Notify          -> SNS integration
Done            -> Succeed
```

The healthy design order is:

```text
business state machine
        -> technical state machine
        -> AWS integrations
```

Starting from a list of available services and asking how to connect them can produce a workflow that mirrors infrastructure rather than the business process.

Step Functions owns process and control logic: sequence, choices, waits, retry policy, and compensation routing. Task services own domain logic and actual work. Avoid two extremes:

- A workflow with hundreds of tiny states and Lambda functions for lowercase, concatenation, field extraction, or timestamp formatting. Native transformations can often do this.
- One giant Lambda that validates, waits, retries, publishes, notifies, and maintains every status. That recreates a fragile workflow engine inside compute.

Choose states that represent useful orchestration boundaries—places where responsibility, retry policy, durable wait, permission, or operational visibility changes.

### How Do Tasks Wait for Services, Jobs, and Callbacks?
<!-- section-summary: Tasks can wait for an immediate response, track a supported asynchronous job to completion, or pause until an external actor returns a task token. -->

Step Functions offers three fundamental service-integration patterns.

#### Request-response waits for the API result

The workflow asks a service to do something and waits for that API call's response:

```text
Step Functions -> Lambda or service
Step Functions <- API result
Step Functions -> next state
```

This fits work whose response represents the required completion boundary.

#### `.sync` starts a job and waits for business completion

Some APIs return as soon as a background job starts. "Job submitted" is not the same as "job finished." Supported `.sync` integrations let Step Functions start the job and remain in the state until completion:

```text
Start Batch job -> job running -> job finished -> next state
```

This keeps asynchronous job monitoring out of a custom polling Lambda.

#### `.waitForTaskToken` waits for an external callback

Editor approval might arrive in three seconds, three hours, or three days. A Lambda loop that sleeps and polls wastes compute and can fail during the wait.

With a callback task:

```text
Step Functions creates task token
       |
sends approval request with token
       |
workflow pauses with no waiting compute
       .
editor approves later
       |
external service calls SendTaskSuccess(token, output)
       |
exact waiting execution resumes
```

The token is authority to complete that particular task. Failure can be returned with `SendTaskFailure`.

Callbacks are not only for people. A legacy system, third-party SaaS product, on-premises process, internal asynchronous service, or device can receive the token and wake the workflow later. The pattern says, "I started process X; resume me when X finishes."

Standard Workflows support callback tasks and can wait within their one-year maximum duration. Express Workflows do not support callback integration patterns. Separating waiting from computing means a long business delay requires no Lambda to remain alive.

## How Should a Workflow Handle Failure?
<!-- section-summary: Retry handles plausible transient recovery, Catch changes control flow after failure, compensation reverses earlier business effects, and idempotency protects repeated tasks. -->

Network timeouts, throttling, service outages, Lambda errors, invalid data, permission denials, and third-party failures are normal in distributed systems. The workflow definition should state which failures repeat, how long to wait, how many attempts to allow, and what happens after attempts are exhausted.

### Retry only when repeating can help

A `Retry` policy can define matching errors, initial delay, maximum attempts, and backoff rate. `Task`, `Parallel`, and `Map` states support retriers.

Good retry candidates include temporary network failure, throttling, service unavailability, and transient server errors. Invalid input, a permanently denied permission, or an unsupported file format will not become valid after ten identical attempts.

```text
Publish
  ├── success -> next state
  └── transient failure -> wait 2s -> retry
                           wait 4s -> retry
```

### Catch follows a different path

After retry is exhausted—or immediately for a nonretryable error—a `Catch` can route to failure handling:

```text
Publish
  ├── success -> Notify
  └── failure -> HandlePublishFailure
```

Retry means run this state again. Catch means stop retrying this state and follow another state-machine path.

### Compensation handles partial business success

Step Functions cannot magically roll back independent systems. If inventory was reserved and payment charged before shipment creation failed, the workflow may need to refund payment and release inventory:

```text
Reserve inventory ✓
Charge customer   ✓
Create shipment   ✗
        |
Refund payment -> Release inventory -> Fail order
```

This is a compensating transaction, often associated with the Saga pattern. A database transaction can undo uncommitted writes within one database. A distributed workflow instead performs explicit business actions that compensate for earlier completed effects.

### Idempotency remains essential

Even Standard's workflow execution semantics do not eliminate repeated task execution. A configured retry or redrive can run a state again, and two callers can start separate executions for the same business operation.

Use a stable key such as `publish:A123`. The publication service checks whether that operation already succeeded and returns the existing result instead of publishing twice.

`StartExecution` provides useful idempotency for a running Standard execution: the same execution name and input returns the original response rather than starting another copy. Express `StartExecution` does not provide that behavior. Business-level duplicate safety is still owned by the application.

## How Does Data Move Through an Execution?
<!-- section-summary: Each state receives and produces JSON, but large or authoritative business data stays in purpose-built stores while the workflow carries control context and references. -->

An execution can start with:

```json
{
  "articleId": "A123",
  "authorId": "U456",
  "title": "Understanding Distributed Systems"
}
```

Validation can add a result:

```json
{
  "articleId": "A123",
  "valid": true
}
```

Approval can add `"approved": true`, and the publish task can consume those selected fields. State input, transformation, task result, and state output form an explicit data path rather than hidden process memory.

### Step Functions is not the business database

The maximum input or output for a task, state, or execution is 256 KiB. A 250-MB video or full CSV dataset does not belong in workflow state.

Store large data in S3 and carry a reference:

```json
{
  "bucket": "media-bucket",
  "key": "video.mp4"
}
```

Likewise, authoritative orders, balances, articles, and inventory live in DynamoDB, RDS, S3, or external systems. Step Functions retains workflow control state; it is not the source of truth for permanent business state.

Keep three layers separate:

| Layer | Question | Owner |
| --- | --- | --- |
| Workflow definition | What is supposed to happen? | State machine / ASL |
| Execution state | Where is this run now? | Step Functions |
| Business state | What actually exists or occurred? | Business databases and services |

"The Publish task completed" is workflow evidence. It does not turn Step Functions into the permanent article database.

### Starting creates one identifiable execution

Applications, API Gateway, Lambda, EventBridge, another state machine, an SDK, or the CLI can start a workflow:

```bash
aws stepfunctions start-execution \
  --state-machine-arn <state-machine-arn> \
  --name publish-A123 \
  --input '{"articleId":"A123"}'
```

Step Functions returns an execution ARN for that specific run. Use the business identifier and execution ARN in logs and external task requests so process and service evidence can be correlated.

### How Do Standard and Express Workflows Differ?
<!-- section-summary: Standard optimizes for durable, long-running process semantics; Express optimizes for high-volume, short-lived execution with different history, integrations, guarantees, and pricing. -->

#### Standard supports durable business processes

Standard Workflows fit order processing, human approvals, payments, ETL orchestration, account provisioning, and multi-day processes. An execution can run for up to one year. State is durably persisted between transitions, execution history is built into Step Functions, callback tokens and supported `.sync` jobs are available, and AWS describes the workflow execution model as exactly once unless the ASL explicitly retries a state.

#### Express supports high-volume short workflows

Express Workflows fit very high event rates and short processing such as streaming transformations, IoT processing, and high-volume application backends. An execution can run for up to five minutes. Express does not persist or expose history in the same way; CloudWatch Logs is required for detailed execution history. Callback and `.sync` integration patterns are unavailable.

The main differences are:

| Characteristic | Standard | Express |
| --- | --- | --- |
| Maximum duration | One year | Five minutes |
| State between transitions | Durably persisted | Not persisted in the same model |
| Detailed history | Built into Step Functions | Use CloudWatch Logs |
| Typical workload | Durable business process | High-volume short processing |
| Callback task token | Supported | Not supported |
| `.sync` job integration | Supported where available | Not supported |
| Request-response | Supported | Supported |
| Billing | State transitions | Requests, duration, and memory |

Execution semantics also differ in the source material:

```text
Standard workflow execution   -> exactly once
Asynchronous Express          -> at least once
Synchronous Express           -> at most once
```

At-least-once execution makes idempotency visibly necessary. An action such as `balance += 100` is not safe to repeat. `set article A123 status to published` can be idempotent if the service recognizes the same operation.

Idempotency can be expressed mathematically as:

```text
f(f(x)) = f(x)
```

`set light=ON` is idempotent; `toggle light` is not. Design important side effects defensively for both workflow families because task retries, redrive, and duplicate business starts remain possible.

Choose execution semantics first. Price is important, but a cheaper high-volume model is not a substitute for durable year-long waiting or callback behavior.

## How Do Wait, Parallel, and Map States Change Control Flow?
<!-- section-summary: Wait makes time durable state, Parallel runs a known set of independent branches, and Map applies workflow logic to each item. -->

### Wait makes time a first-class state

Traditional code often sleeps or polls. Step Functions can represent time directly:

```text
Send reminder -> Wait 24 hours -> Check response
```

This supports subscription expiry, grace periods, delayed notification, approval deadlines, follow-ups, and backoff without a Lambda consuming compute during the delay. Standard waits fit within the one-year workflow maximum; Express remains bounded by five minutes.

### Parallel runs fixed independent branches

If generating a thumbnail, indexing search, and building a social preview do not depend on each other, sequential work takes approximately the sum of their durations. A `Parallel` state starts the fixed branches together and waits for all of them:

```text
             +-> Generate thumbnail --+
Start -------+-> Index search ---------+-> Next
             +-> Social preview -------+
```

Runtime can approach the slowest branch rather than the sum, assuming downstream systems have capacity. Parallelism can overload a dependency if concurrency is not planned.

### Map iterates over data

For an input list of images, a `Map` can run a resize workflow for each item:

```text
Map
  ├── 1.jpg -> Resize
  ├── 2.jpg -> Resize
  └── 3.jpg -> Resize
```

The distinction is:

```text
Choice   -> conditional branch
Parallel -> fixed set of concurrent branches
Map      -> repeated workflow over items
```

Distributed Map extends this to large-scale parallel processing, commonly with data in S3. Large datasets should remain outside the 256-KiB workflow payload while the Map reads or carries appropriate references.

## How Do You Observe, Redrive, and Pay for Workflows?
<!-- section-summary: Execution history gives process-level evidence, redrive resumes eligible failed Standard runs, and the billing model reflects transitions or execution duration. -->

Without orchestration, debugging a process can require reconstructing one business operation from API, Lambda, queue, worker, and database logs. Step Functions provides an execution-oriented timeline:

```text
Validate          success  410 ms
CheckValidity     success
RequestApproval   success
WaitForApproval   success  3h 21m
Publish           failure
```

For Standard Workflows, the execution view includes transitions, state input and output, errors, retries, and final status. Standard execution history is retained and can normally be retrieved for up to 90 days after completion. Express relies on CloudWatch Logs for detailed history.

CloudWatch metrics and logs support fleet-level operation. AWS X-Ray can provide trace information and service maps for Step Functions and supported downstream integrations. The execution ARN and business ID should be propagated so workflow and service evidence join correctly.

### Redrive resumes eligible failed Standard executions

If A and B succeeded but C failed, restarting from the beginning may repeat expensive or irreversible work. Eligible failed, aborted, or timed-out Standard executions can be redriven:

```text
Original: A success -> B success -> C failure
Redrive:                         C -> D
```

Successful earlier results are preserved rather than rerun. The source material states that eligible unsuccessful Standard executions can be redriven within 14 days. Redrive can rerun the failed state, so its side effects still need idempotency.

### Pricing follows workflow type

Standard pricing is mainly based on state transitions. An execution through A, B, C, and D creates billable transitions, and retries add more:

```text
Standard cost ≈ executions × transitions per execution × transition price
```

Express pricing depends on workflow requests, execution duration, and memory used. It can fit huge numbers of short executions, while Standard fits fewer long-lived durable processes.

Cost encourages useful boundaries. Do not create a separate Lambda and state for every trivial string transformation if ASL can express it. Do not collapse the whole process into one opaque Lambda merely to reduce transitions. Semantics, operability, and ownership come before micro-optimization.

Treat retry transitions as both an operational and cost signal. A workflow whose normal path uses ten states but routinely adds twenty retries is not merely more expensive than the diagram suggests; it is telling you that a dependency, timeout, capacity limit, or error classification may be unhealthy. Conversely, removing every visible state to reduce billing can erase the durable checkpoints and process evidence that justified orchestration. Estimate the normal path, each expected branch, and the failure path separately, then compare those transition counts with real execution metrics.

Express sizing deserves the same discipline. Duration and workflow memory depend on the definition, input, and intermediate data, so carrying needlessly large JSON through every state affects more than readability. Keep payloads focused, use references for large objects, and emit the CloudWatch logs required for diagnosis before production volume makes a missing execution history painful. The workflow-type choice should remain traceable to maximum duration, callback and sync needs, execution semantics, history, throughput, and cost together.

### When Should You Use Step Functions?
<!-- section-summary: Use Step Functions when dependent steps need durable progress, explicit decisions, waits, retries, callbacks, compensation, and process-level visibility. -->

Step Functions is compelling when a process has dependent steps and someone must durably remember which completed, what data they produced, and what happens next. Long waits, human or external callbacks, supported asynchronous jobs, branches, compensation, and centralized process history strengthen the case.

It is not the default answer to every integration need:

```text
Need a durable backlog of independent work? -> SQS
Need to notify many subscribers?            -> SNS
Need event-pattern routing?                 -> EventBridge
Need to run code?                           -> Lambda, ECS, or other compute
Need a morning trigger?                     -> EventBridge Scheduler or another scheduler
Need durable multi-step coordination?       -> Step Functions
```

Use this decision path:

1. Does the process have several dependent steps? If not, orchestration may be unnecessary.
2. Must progress survive compute restarts? If yes, durable workflow state is useful.
3. Can it wait minutes, hours, or days? Consider Standard.
4. Does it need callbacks or `.sync` jobs? Use Standard.
5. Is it enormous volume, short-lived, and idempotent? Express may fit.
6. Is the payload large? Put it in S3 or another store and carry a reference.
7. Could any task execute again? Design business idempotency.
8. Can later failure follow earlier irreversible success? Design compensation.

Also separate workflow definition, execution state, and business state. This prevents a workflow tool from becoming an accidental database or a service from hiding process transitions that operators need to see.

## How Does a Complete Publishing Workflow Run?
<!-- section-summary: One execution validates input, branches, waits without compute, retries publication, announces success, and preserves a process-centered history. -->

Start `PublishWorkflow` with:

```json
{
  "articleId": "A123"
}
```

Step Functions creates an execution named or correlated as `publish-A123`.

### 1. Validate the draft

`ValidateDraft` invokes Lambda. The task returns:

```json
{
  "articleId": "A123",
  "valid": true
}
```

### 2. Choose the valid path

A `Choice` checks `valid`. Invalid input follows a rejection state; valid input continues.

### 3. Wait for editor approval

A callback task sends an approval request containing a task token and pauses. No Lambda runs during the three-hour wait. The editor approves, and the approval service calls `SendTaskSuccess` with the token and `approved=true`. The exact execution resumes.

### 4. Publish with a retry policy

The workflow invokes `PublishArticle`. A temporary error occurs. The retrier waits, tries again, backs off, and succeeds on the third attempt. If it exhausted retries, a catch path could record failure or start compensation.

### 5. Announce the published article

Step Functions calls SNS with an `ArticlePublished` notification. The task's success boundary is the SNS API response; independent subscribers continue their own delivery and processing paths.

### 6. Finish successfully

The workflow enters `Succeed`, and the execution status becomes `SUCCEEDED`. Its history shows validation, decision, approval wait, retry attempts, publication, notification, and completion.

The architecture is:

```text
                  Step Functions
             durable workflow control
              /       |          \
       validation   approval    publishing
         Lambda      system       Lambda/API
                       |
                    callback
                       |
                  Step Functions
                       |
                      SNS
                       |
                notification paths
```

Step Functions owns sequence, state, waiting, branching, retries, failure routing, and execution history. The surrounding systems own business truth, computation, and external effects. No single application process must remain alive for the workflow's full duration.

The complete mental model is:

```text
State machine = reusable process definition
Execution     = one instance of that process
State         = one control point
Task          = request that another capability does work
Transition    = movement to the next control point
Step Functions = durable coordinator that remembers progress
                 and decides what happens next
```

Step Functions is not primarily a diagramming tool. Its value is moving the fragile control state of a distributed process out of temporary application memory and into managed orchestration. Choices, waits, task tokens, retries, workflow types, execution history, idempotency, and redrive all follow from that problem.

## Check Your Answers

:::expand[Why Does a Multi-Step Process Need Durable Memory?]{kind="recap"}
A distributed process must remember its identity, progress, data, failure policy, and next action even when the coordinating compute disappears.

A coordinator can crash after some steps succeed or while a side effect is uncertain. Step Functions retains the process identity, current state, data, prior progress, failure policy, and next action independently of temporary compute.

A state machine is the process definition, states are control points, transitions connect them, and each execution is one running instance with its own progress and data.

The state machine is the reusable workflow program. States are control points connected by transitions. Each execution is one running instance with independent input, current state, results, retries, and outcome.
:::

:::expand[How Does Amazon States Language Describe a Workflow?]{kind="recap"}
Amazon States Language serializes the state graph as JSON and uses JSONata or JSONPath to select and transform workflow data.

ASL serializes the state graph as JSON. JSONPath and JSONata select and transform the JSON that accompanies execution; the source recommends JSONata for new workflows while supporting incremental migration from JSONPath.
:::

:::expand[How Should You Design a Workflow from a Business Process?]{kind="recap"}
Model business states and decisions first, then map each step to a Step Functions state and an AWS or external integration.

Draw business states, decisions, waits, and failure paths first. Then map them to Task, Choice, callback, and terminal states and finally select AWS integrations. Keep control logic in the workflow and domain computation in services.

Tasks can wait for an immediate response, track a supported asynchronous job to completion, or pause until an external actor returns a task token.

Request-response waits for an API result. A supported `.sync` task waits for an asynchronous job to finish. `.waitForTaskToken` pauses a Standard execution until a human or external system returns the unique task token.
:::

:::expand[How Should a Workflow Handle Failure?]{kind="recap"}
Retry handles plausible transient recovery, Catch changes control flow after failure, compensation reverses earlier business effects, and idempotency protects repeated tasks.

Retry transient errors where repeating can help. Catch routes exhausted or permanent failures. Compensation performs explicit business actions after partial success. Stable idempotency keys protect task side effects when retries, redrive, or duplicate executions occur.
:::

:::expand[How Does Data Move Through an Execution?]{kind="recap"}
Each state receives and produces JSON, but large or authoritative business data stays in purpose-built stores while the workflow carries control context and references.

States receive and produce JSON, but the 256-KiB limit and ownership model mean large or authoritative business data belongs in S3, databases, and services. The workflow should carry control context and references.

Standard optimizes for durable, long-running process semantics; Express optimizes for high-volume, short-lived execution with different history, integrations, guarantees, and pricing.

Standard supports durable state, one-year runs, built-in history, callbacks, and sync jobs. Express supports high-volume runs up to five minutes and relies on CloudWatch Logs for history. Their execution semantics and billing models also differ.
:::

:::expand[How Do Wait, Parallel, and Map States Change Control Flow?]{kind="recap"}
Wait makes time durable state, Parallel runs a known set of independent branches, and Map applies workflow logic to each item.

Wait makes time a durable state without sleeping compute. Parallel runs a fixed set of independent branches. Map applies workflow logic to every item, while Distributed Map handles larger-scale parallel datasets.
:::

:::expand[How Do You Observe, Redrive, and Pay for Workflows?]{kind="recap"}
Execution history gives process-level evidence, redrive resumes eligible failed Standard runs, and the billing model reflects transitions or execution duration.

Standard execution history provides a process timeline, while logs, metrics, and X-Ray connect downstream evidence. Redrive resumes eligible failed Standard runs without repeating successful states. Standard bills transitions; Express bills requests, duration, and memory.

Use Step Functions when dependent steps need durable progress, explicit decisions, waits, retries, callbacks, compensation, and process-level visibility.

Use it when dependent steps require durable progress, explicit sequencing, branching, waits, retries, callbacks, compensation, and process-level visibility. Prefer queues, topics, event buses, compute, or scheduling when those simpler jobs are all the system needs.
:::

:::expand[How Does a Complete Publishing Workflow Run?]{kind="recap"}
One execution validates input, branches, waits without compute, retries publication, announces success, and preserves a process-centered history.

One execution validates, branches, pauses for approval without running compute, resumes by token, retries transient publication failure, publishes a notification, and ends with a complete process-centered history while external systems retain business truth.
:::

## References

- [AWS Step Functions documentation](https://docs.aws.amazon.com/step-functions/latest/dg/welcome.html)
- [AWS Step Functions documentation: Amazon States Language](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-amazon-states-language.html)
- [AWS Step Functions documentation: State machines and executions](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html)
- [AWS Step Functions documentation: Choosing a workflow type](https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html)
- [AWS Step Functions documentation: State machine structure](https://docs.aws.amazon.com/step-functions/latest/dg/statemachine-structure.html)
- [AWS Step Functions documentation: Transforming data with JSONata](https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html)
- [AWS Step Functions documentation: Service integration patterns](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)
- [AWS Step Functions documentation: Error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- [AWS Step Functions documentation: Service quotas](https://docs.aws.amazon.com/step-functions/latest/dg/service-quotas.html)
- [AWS Step Functions API reference: StartExecution](https://docs.aws.amazon.com/step-functions/latest/apireference/API_StartExecution.html)
- [AWS Step Functions documentation: View execution details](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)
- [AWS Step Functions documentation: Wait state](https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html)
- [AWS Step Functions features: Distributed Map](https://aws.amazon.com/step-functions/features/)
- [AWS Step Functions documentation: X-Ray tracing](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-xray-tracing.html)
- [AWS Step Functions documentation: Redrive executions](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html)
- [AWS Step Functions pricing](https://aws.amazon.com/step-functions/pricing/)
