---
title: "Lambda"
description: "Understand AWS Lambda as event-driven compute, including handlers, execution environments, state, roles, invocation models, concurrency, queues, retries, idempotency, monitoring, versions, and rollback."
overview: "Lambda runs bounded units of code when work arrives. This article derives its execution, scaling, reliability, security, deployment, and observability behavior from that first principle."
tags: ["lambda", "events", "serverless", "aws"]
order: 4
id: article-cloud-providers-aws-compute-application-hosting-lambda-event-driven-compute
aliases:
  - lambda-and-event-driven-compute
  - cloud-providers/aws/compute-application-hosting/lambda-and-event-driven-compute.md
---

## Table of Contents

1. [What Is AWS Lambda?](#what-is-aws-lambda)
2. [What Is an Execution Environment?](#what-is-an-execution-environment)
3. [Where Should a Lambda Function Keep State?](#where-should-a-lambda-function-keep-state)
4. [How Does Lambda Scale?](#how-does-lambda-scale)
5. [Why Do Retries Require Idempotency?](#why-do-retries-require-idempotency)
6. [When Is Lambda the Right Compute Model?](#when-is-lambda-the-right-compute-model)
7. [How Do Versions, Aliases, and Rollback Work?](#how-do-versions-aliases-and-rollback-work)
8. [How Do You Design a Complete Lambda Workload?](#how-do-you-design-a-complete-lambda-workload)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

All code needs compute. A function such as `resize_image(image)` cannot execute without processors, memory, an operating system, a language runtime, networking, permissions, a start mechanism, capacity for simultaneous work, and recovery when infrastructure fails.

With a traditional application server, a team supplies a continuously running host and process:

```text
request → load balancer → server → application process → function
```

For example, an EC2 instance can run Linux, Python, a web framework, and `resize_image()`. The server and process may remain allocated all day even when only a few requests arrive.

**AWS Lambda** changes the unit you ask AWS to run. You provide code, dependencies, runtime configuration, permissions, and an entry point. AWS provides a managed environment that invokes the entry point when work arrives.

```text
event
  ↓
Lambda service
  ↓
execution environment
  ↓
your handler
  ↓
result or failure
```

You are not primarily renting a permanent server. You define how AWS should perform **bounded executions of code**. One invocation starts with input, performs computation and calls other systems, produces a result or error, and ends.

Keep these questions in view as you work through the lesson:

1. **What Is AWS Lambda?**
2. **What Is an Execution Environment?**
3. **Where Should a Lambda Function Keep State?**
4. **How Does Lambda Scale?**
5. **Why Do Retries Require Idempotency?**
6. **When Is Lambda the Right Compute Model?**
7. **How Do Versions, Aliases, and Rollback Work?**
8. **How Do You Design a Complete Lambda Workload?**

## What Is AWS Lambda?
<!-- section-summary: Lambda runs bounded pieces of customer code when work arrives while AWS operates the underlying machines and execution infrastructure. -->

```text
invocation starts
   ├── receive input
   ├── compute
   ├── read or write other systems
   └── produce output
invocation ends
```

That is different from a web server that starts once, waits, handles many unrelated requests over time, and keeps running indefinitely. Lambda naturally matches work such as one HTTP request, one uploaded file, one scheduled cleanup, one database-change event, one queue batch, or one background task.

The word **serverless** does not mean servers disappeared. AWS still uses servers. It means most server provisioning, worker placement, process isolation, machine replacement, basic scaling machinery, and host operating-system lifecycle are hidden behind the service.

Your team still owns application logic, dependencies, runtime selection and configuration, event integrations, IAM permissions, downstream design, and correctness. Lambda removes server fleet administration; it does not remove software engineering or distributed-systems responsibilities.

### What Does a Lambda Handler Receive?
<!-- section-summary: The handler is the configured entry point and receives source-shaped event data plus context about the current invocation. -->

AWS needs to know where execution of your program begins. That entry point is the **handler**.

```python
def lambda_handler(event, context):
    return {
        "statusCode": 200,
        "body": "Hello"
    }
```

The handler is the boundary between Lambda-managed code and your application code:

```text
AWS invocation machinery
          │
          ▼
lambda_handler(event, context)
          │
          ▼
application logic
```

The `event` contains the input to this invocation. Lambda does not assign one universal meaning to it; the triggering system determines its shape. An API event can contain a method, path, headers, query parameters, and body. An S3 event identifies a bucket, object key, and event type. An SQS event carries one or more messages. A scheduled event contains schedule metadata.

The `context` object describes the invocation itself, including metadata and the remaining execution time. A useful translation is:

```text
handler(
  what happened,
  information about this execution
)
```

Lambda also separates the function from whatever causes it to run. The same function can conceptually be invoked by API Gateway, S3, EventBridge, SQS, another application, or another supported integration. Those producers and integrations are often called **triggers** or **event sources**.

```text
API Gateway ───┐
S3 ────────────┤
EventBridge ───┼──> Lambda handler
SQS ───────────┤
application ───┘
```

This separation is why Lambda fits event-driven architecture. The function implements what should happen; the event integration defines when it should happen and what input arrives.

![The function lifecycle shows how an event payload, handler, role, configuration, downstream call, logs, and metrics fit into one bounded job](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-lambda-event-driven-compute/lambda-handler-lifecycle.png)

*The event source defines the payload, and the configured handler turns that payload into one bounded execution.*

## What Is an Execution Environment?
<!-- section-summary: Lambda creates isolated runtime environments for invocations and may reuse them, but applications must treat them as disposable. -->

When an invocation arrives, Lambda needs somewhere to execute the handler. It can use a suitable existing **execution environment** or create a new one.

Conceptually, an environment contains:

```text
isolated compute
├── allocated memory and related CPU resources
├── language runtime
├── deployed code
├── dependencies
└── temporary local storage
```

Creating a new environment requires initialization:

```text
create environment
      ↓
initialize language runtime
      ↓
load code and dependencies
      ↓
run initialization outside the handler
      ↓
invoke handler
```

This extra path creates what is commonly called a **cold start**. Lambda may reuse the prepared environment for a later invocation, which can avoid much of the initialization work. That later path is often called a **warm invocation**.

Code outside the handler can benefit from reuse:

```python
database_client = create_database_client()

def handler(event, context):
    return database_client.query(...)
```

The client may remain available when Lambda reuses that environment. Reuse is a performance opportunity, not a correctness guarantee. AWS may create many environments for concurrency, and any environment may disappear.

```text
Environment A: local counter = 7
Environment B: local counter = 3
Environment C: local counter = 11
```

A global counter is therefore not a reliable account-wide total. A local cache can improve performance when present, but every invocation must remain correct if the cache is empty and the environment has never seen earlier work.

The right mental model is:

> **Execution environments are reusable but disposable.**

## Where Should a Lambda Function Keep State?
<!-- section-summary: Lambda performs ephemeral computation, while authoritative state must live in an external durable system. -->

Calling a function **stateless** does not mean it cannot read or modify state. It means the individual execution environment must not be the authoritative home of application state.

Bad design:

```text
Lambda process memory
└── authoritative customer balance
```

Better design:

```text
Lambda computation
       ↓ read or write
DynamoDB, RDS, S3, cache, queue, or another durable service
       ↓
authoritative state
```

Temporary files in the environment can support one invocation or an opportunistic cache. In-memory clients can be reused. Neither is a substitute for a durable database, object store, or queue when the information must survive environment removal or be shared across concurrent invocations.

This principle can be summarized as:

```text
compute ≠ durable state
```

For an order workflow, durable order facts belong in a database, receipts in object storage, messages in a queue, and events in an event bus. Lambda performs transient calculation and coordination that moves durable state from one valid condition to another.

> **Lambda is ephemeral compute acting on durable state.**

### How Do Configuration and Permissions Work?
<!-- section-summary: Function configuration defines the bounded runtime, and IAM separately controls who may invoke the function and what the function may call. -->

A Lambda function is code plus a runtime definition. AWS needs the handler, language runtime, dependencies, memory, timeout, environment variables, architecture, network configuration, and IAM execution role.

```text
Function: ProcessOrder
├── code and dependencies
├── handler: app.handler
├── runtime: Python
├── memory: 1024 MB
├── timeout: 30 seconds
├── environment: TABLE_NAME, STAGE
├── network settings
├── execution role
└── event integrations
```

The **timeout** establishes a hard upper bound. If the handler does not finish before the configured duration, Lambda terminates the invocation. That boundary encourages finite work such as “generate thumbnail X” rather than “start this worker and run forever.”

Memory is also a compute setting. Lambda associates CPU capacity with allocated execution resources, so increasing memory can improve both available memory and execution speed. A 512 MB configuration that takes four seconds is not automatically cheaper or better than a larger configuration that takes one second. Measure representative workloads and compare latency and the combined effect of allocation and duration.

Networking still exists underneath a serverless application. A function calling a database, private service, AWS API, or public endpoint still relies on DNS, routes, security controls, and destination availability. Connecting Lambda to a VPC makes subnet and security-group choices important. Serverless removes host administration, not networking.

The **execution role** answers what the running function may do. If `ProcessOrder` calls DynamoDB, the role can allow `dynamodb:PutItem` on the Orders table and log delivery, without permission to delete buckets or administer IAM.

Two permission directions must remain separate:

```text
Who or what may invoke the function?
               ↓
             Lambda
               ↓
What AWS operations may the function perform?
```

Trigger permissions or function resource policies can govern the first direction. The execution role governs the second. A valid S3 trigger does not automatically let the handler read the object, and a role that can read S3 does not automatically let every caller invoke the function.

## How Does Lambda Scale?
<!-- section-summary: Lambda scales horizontally by running more invocations concurrently, and concurrency depends on both arrival rate and execution duration. -->

When several events arrive together, Lambda can use multiple execution environments:

```text
Event 1 → Environment A
Event 2 → Environment B
Event 3 → Environment C
Event 4 → Environment D
```

**Concurrency** is approximately the number of invocations executing at the same time. A useful estimate for a steady workload is:

```text
concurrency ≈ request or event rate × average duration
```

If 100 invocations arrive each second and each takes two seconds, the function needs about 200 concurrent executions at steady state. If 500 events per second each take 0.2 seconds, the estimate is about 100.

Automatic scaling is not the same as unlimited system capacity. The Lambda layer may add execution environments faster than a small database, cache, or rate-limited API can accept new work.

```text
10,000 messages
       ↓
many concurrent Lambda invocations
       ↓
many parallel database operations
       ↓
database overload
```

Ask how much concurrency the dependency behind the function can safely handle. A reserved or integration-level concurrency limit can deliberately cap pressure:

```text
large event backlog
       ↓
Lambda, maximum 50 concurrent executions
       ↓
database with known safe capacity
```

Concurrency and duration also form feedback. At 100 requests per second and 0.1-second duration, concurrency is about 10. If a dependency slows each invocation to five seconds, the same incoming rate implies about 500 concurrent executions. More concurrency then adds more dependency pressure.

Retries can amplify that loop:

```text
dependency slows or fails
      ↓
invocations last longer or fail
      ↓
concurrency and retries rise
      ↓
additional dependency load
      ↓
deeper failure
```

Production control therefore combines concurrency limits, queues, sensible timeouts, retry backoff, idempotency, failure destinations, and alarms rather than treating them as unrelated settings.

### How Do Invocation Models and Queues Change Reliability?
<!-- section-summary: Synchronous, asynchronous, and poll-based integrations differ in response handling, batching, acknowledgement, and retry ownership. -->

Not every trigger behaves like a simple request and response. Lambda participates in several invocation models.

In a **synchronous invocation**, the caller waits for the function result. An API request is the usual mental example:

```text
caller → invoke Lambda → wait → response or error
```

Latency and failure are visible to the caller in that interaction.

In an **asynchronous invocation**, a producer hands the event to AWS and does not wait for the application result in the same way. AWS accepts the event, then performs invocation and configured retry or failure handling separately.

In a **poll-based integration**, AWS retrieves records from a queue or stream and invokes the function with records, possibly as a batch:

```text
SQS or stream
      ↑ AWS-managed poller
      ↓
    Lambda
```

The integration determines who retries, when work is acknowledged, whether records arrive individually or in batches, and where exhausted failures go. Those semantics are part of application correctness.

A queue can also buffer uneven arrival. Compare a producer invoking compute directly with a producer writing durable work to SQS:

```text
direct: producer → Lambda → database

buffered: producer → SQS → Lambda → database
```

If producers create one million jobs, the queue holds the backlog while Lambda consumes it at a controlled pace. This decouples the rate at which work arrives from the rate at which downstream systems must process it. Queue age then becomes an important signal: the system may be error-free per invocation while falling further behind.

## Why Do Retries Require Idempotency?
<!-- section-summary: Events can be processed more than once, so side-effecting functions need a stable operation identity and duplicate-safe behavior. -->

Consider an order handler that charges a card, updates a database, and returns success. The card charge can succeed, followed by a network failure before the invocation is acknowledged as successful. A retry can then execute the charge again.

This is the distributed-systems fact behind an essential Lambda rule:

> **An event may be processed more than once.**

**Idempotency** means repeated execution creates one logical business effect. A naïve handler can charge £50 twice when the same order event arrives twice. An idempotent design attaches the action to a stable key such as `order-123`.

```text
Invocation 1
  ↓
Has order-123 been completed? no
  ↓
perform the action and record completion atomically

Invocation 2
  ↓
Has order-123 been completed? yes
  ↓
return the prior result or skip the duplicate side effect
```

The exact storage and atomicity mechanism depend on the workflow, but the principle is:

```text
at-least-once delivery + idempotent processing
→ one intended logical effect
```

For image thumbnails, a deterministic output key such as `thumbnail/holiday.jpg` can make repeated processing overwrite the intended object rather than create duplicates. Payments, emails, and multi-step database mutations need stronger operation records and conditional behavior.

Idempotency also makes replay safer after an outage. If operators cannot safely send a failed event through the system again, the failure-recovery design is incomplete.

![The retry and idempotency view shows how concurrency limits, duplicate protection, and failed-event capture protect downstream systems](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-lambda-event-driven-compute/function-retry-concurrency-idempotency.png)

*Retries preserve work only when duplicate attempts cannot multiply the business side effect.*

### How Should Lambda Failures Be Handled?
<!-- section-summary: A production workload defines retries, exhausted-event storage, alarms, investigation, repair, and replay before failures occur. -->

Failure is a normal path to design, not an anomaly to ignore. For an SQS-triggered payment function, the full path might be:

```text
message
  ↓
Lambda
  ↓
payment dependency temporarily fails
  ↓
retry according to integration rules
  ↓
failure repeats beyond configured tolerance
  ↓
dead-letter queue or failure destination
  ↓
alarm and investigation
  ↓
dependency or code repaired
  ↓
safe replay
```

A production design should answer:

- What happens when the handler throws an exception?
- What happens when it reaches its timeout?
- What happens when a dependency is unavailable?
- Which component performs retries, and with what timing?
- Where does an event go after repeated failure?
- How will operators notice it?
- Which evidence identifies the cause?
- Can the event be replayed without duplicating side effects?

Consider `Order 123`. Lambda receives the SQS message and the payment API returns `503`. The handler reports failure, so the message remains eligible under the queue’s processing semantics. After repeated attempts, it moves to a dead-letter queue. A CloudWatch alarm on dead-letter messages alerts an operator. After the payment service recovers, the team replays the message through the main path.

Several Lambda ideas form one reliability chain:

```text
retry means duplicate execution is possible
      ↓
idempotency protects the business effect
      ↓
some events still exhaust retries
      ↓
failure destination preserves them
      ↓
monitoring alerts operators
      ↓
replay completes recovery
```

Restoring the function for new work and repairing the backlog are separate recovery steps. A green error metric after the fix does not prove old failed events were processed.

## When Is Lambda the Right Compute Model?
<!-- section-summary: Lambda is a strong fit for finite event-driven work, while VMs and containers fit workloads needing machine or long-running process control. -->

The timeout and invocation abstraction make Lambda a natural fit for finite tasks. It is less natural for a program that must remain alive indefinitely. The compute models form an abstraction continuum:

| Model | Primary request |
|---|---|
| EC2 | “Give me a machine.” |
| Container hosting | “Keep this application process or container running.” |
| Lambda | “Execute this bounded code when work arrives.” |

EC2 provides the most host control. Container platforms hide more machine detail while managing long-running application processes. Lambda hides more infrastructure and focuses on invocations.

Economics follow the abstraction. A continuously allocated instance exists through idle and busy periods. Lambda metering can follow executions and compute duration more closely. That can be attractive for irregular traffic, bursty work, event processing, and small automation. It does not mean Lambda is always cheapest; a continuously busy workload may fit another model better.

Think about an hour containing only three short jobs. A provisioned server remains allocated across the quiet gaps as well as the work. Lambda can align its metered execution more closely with the three active intervals. Now change the example to a service that is busy throughout the entire hour. The idle-gap advantage disappears, and the continuously active invocation pattern may make a container or instance economically attractive. This is why cost follows workload shape rather than the word “serverless.” Compare representative rate, duration, memory, downstream charges, and operational effort instead of assuming that one abstraction always wins.

Lambda deserves serious consideration when the workload can be said plainly as “When X happens, perform Y”: when an API request arrives, calculate a response; when an object lands in S3, transform it; when a queue has work, process a batch; when midnight arrives, clean up; when a record changes, react.

Choose based on the workload boundary rather than treating one compute product as universally superior.

## How Do Versions, Aliases, and Rollback Work?
<!-- section-summary: Immutable versions identify deployed code and configuration, while aliases provide stable pointers that can move or split traffic. -->

Production needs a better identity than “whatever was uploaded most recently.” A published Lambda **version** is an immutable snapshot of function code and relevant configuration.

```text
Function
├── Version 1 → snapshot A
├── Version 2 → snapshot B
└── Version 3 → snapshot C
```

An **alias** is a stable name that points to a version:

```text
prod → version 27
```

Callers can invoke the `prod` alias while a release changes its target to version 28. The alias is a stable reference with a movable target.

If version 28 causes failures, rollback can point `prod` back to version 27 rather than reconstructing yesterday’s code. This combines a known-good immutable artifact with a small, reviewable pointer change.

Aliases can also split supported traffic between versions:

```text
90% → version 42
10% → version 43
```

After observation, the deployment can increase version 43’s share or return all traffic to version 42. A gradual shift reduces the initial blast radius of a defective release.

Record the event source and qualified function ARN used in production. Moving an alias affects integrations that invoke that alias; an integration pinned directly to another version or the unqualified function may behave differently.

![The alias rollback view shows why publishing versions and moving an alias can make function rollback a small, reviewable change](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-lambda-event-driven-compute/lambda-alias-rollback.png)

*Versions answer what code exists; an alias answers which version a stable production name currently selects.*

### How Should You Monitor Lambda?
<!-- section-summary: Logs, aggregate metrics, traces, and business outcomes reveal different parts of function correctness. -->

Infrastructure being available does not prove that useful work occurred. Monitor four layers.

**Logs** explain individual executions: which order was processed, which exception occurred, which safe input identifier was involved, and where application code failed. Avoid logging passwords, tokens, or sensitive customer data.

**Metrics** summarize the workload. Common signals include invocations, errors, duration, throttles, and concurrency. Queue-backed functions also need queue age and backlog; failure destinations need message count. Metrics reveal patterns without requiring an operator to read thousands of log lines.

**Traces** place the function inside a larger request. A 900 ms request could spend 20 ms at API Gateway, 120 ms initializing Lambda, 40 ms in application code, 100 ms in a database, and 620 ms in an external API. Without the breakdown, a team might call “Lambda” slow when the external dependency dominates.

**Business metrics** answer whether the intended outcome happened. A function can report a zero-percent platform error rate while creating zero orders because of a logic bug. Track outcomes such as orders processed, payments completed, thumbnails produced, emails dispatched, and events moved to the failure queue.

Technical and business health should be read together. For a queue workload, rising duration can raise concurrency, throttling can raise queue age, and repeated failures can fill the dead-letter queue. For an API workload, latency and status codes at the front door matter alongside Lambda duration and errors.

## How Do You Design a Complete Lambda Workload?
<!-- section-summary: A thumbnail example connects events, roles, durable state, concurrency, idempotency, failure handling, deployment, and monitoring. -->

Consider an image-thumbnail service:

```text
Browser uploads holiday.jpg
           ↓
          S3
           ↓ object-created event
        Lambda
       ├── read original
       ├── resize image
       └── write thumbnail
           ↓
          S3
```

S3 supplies an event containing the bucket and object key. The handler extracts those fields and treats one image as the bounded work. The runtime includes the image-processing dependency. The execution role permits reads from the originals prefix, writes to the thumbnails prefix, and log delivery—without unrelated administrative access.

If 100 images arrive together, Lambda can create concurrent environments. The design checks whether image libraries, S3 request patterns, and any other dependency can handle the concurrency. If pressure needs control, a queue and concurrency limit provide buffering and a predictable processing ceiling.

The output key is deterministic: `originals/holiday.jpg` maps to `thumbnails/holiday.jpg`. Processing the same event twice therefore targets the same output rather than creating two business objects. Repeated failures go to a configured failure path, produce an alarm, and can be replayed after repair.

The team monitors invocations, errors, duration, throttles, concurrency, failed-event count, and the business count of thumbnails successfully produced. A new image-library release is published as version 8 and selected through `prod`. If its output is corrupted or errors spike, `prod` moves back to version 7.

Five design questions expose most weaknesses:

1. **What causes execution?** Identify the API, queue, file event, stream, schedule, or caller and understand its delivery semantics.
2. **What is one bounded unit of work?** Define whether an invocation handles one request, one image, one order, or a batch.
3. **Which state must survive?** Put authoritative state outside the execution environment in a suitable durable system.
4. **What happens if execution repeats?** Give side effects stable identities and make retry or replay safe.
5. **What happens if thousands run together?** Follow every downstream arrow and impose buffering or concurrency limits based on dependency capacity.

The deeper model can be read word by word:

> **Lambda is AWS-managed ephemeral compute that turns events into bounded concurrent executions of your code.**

- **AWS-managed** means you do not administer the worker fleet.
- **Ephemeral** means local environments can disappear and durable state belongs elsewhere.
- **Events** imply triggers, payloads, and event-driven integration.
- **Bounded** implies a handler, finite unit, and timeout.
- **Concurrent** implies horizontal scaling and downstream-capacity controls.
- **Executions** imply retries, duplicates, idempotency, failure handling, and monitoring.
- **Your code** still implies dependencies, runtime configuration, roles, versions, and aliases.

```text
event
  ↓
Lambda: ephemeral, bounded, concurrent compute
  ├──> durable database state
  ├──> durable queued work
  └──> external service side effect

around the execution:
IAM, runtime, timeout, concurrency, retries,
idempotency, logs, metrics, traces, versions, aliases
```

A Lambda function is not a tiny permanent server. It is a definition of how AWS should execute a finite piece of your code when work arrives.

## Check Your Answers

:::expand[What Is AWS Lambda?]{kind="recap"}
Lambda runs bounded pieces of customer code when work arrives while AWS operates the underlying machines and execution infrastructure.

The handler is the configured entry point and receives source-shaped event data plus context about the current invocation.

The event is source-specific input describing what happened. The context supplies metadata about this invocation, including information such as its remaining execution time.
:::

:::expand[What Is an Execution Environment?]{kind="recap"}
Lambda creates isolated runtime environments for invocations and may reuse them, but applications must treat them as disposable.

It can reuse expensive clients or caches to improve performance, but correctness cannot depend on earlier invocations or on the environment surviving. Every environment is disposable, and many can exist concurrently.
:::

:::expand[Where Should a Lambda Function Keep State?]{kind="recap"}
Lambda performs ephemeral computation, while authoritative state must live in an external durable system.

The function may read and write state, but its local memory and temporary files are not authoritative. Durable state that must survive or be shared belongs in an external database, object store, queue, or similar system.

Function configuration defines the bounded runtime, and IAM separately controls who may invoke the function and what the function may call.

Invocation permission determines who or which service may call the function. The execution role determines which AWS actions the running function may perform on other resources.
:::

:::expand[How Does Lambda Scale?]{kind="recap"}
Lambda scales horizontally by running more invocations concurrently, and concurrency depends on both arrival rate and execution duration.

For steady work, concurrency is approximately arrival rate multiplied by average invocation duration. One hundred requests per second lasting two seconds imply roughly 200 concurrent executions.

Longer dependency calls keep each invocation active for more time. At the same arrival rate, the increased duration raises the number of overlapping invocations, which may add still more pressure to the dependency.

It provides a durable buffer that separates arrival rate from processing rate. Lambda can drain the backlog at controlled concurrency instead of transferring every burst immediately to a slower downstream system.

Synchronous, asynchronous, and poll-based integrations differ in response handling, batching, acknowledgement, and retry ownership.
:::

:::expand[Why Do Retries Require Idempotency?]{kind="recap"}
Events can be processed more than once, so side-effecting functions need a stable operation identity and duplicate-safe behavior.

Delivery, timeouts, and retries can cause the same logical event to be handled more than once. Idempotency uses a stable operation identity so repeated attempts do not repeat the business effect.

A production workload defines retries, exhausted-event storage, alarms, investigation, repair, and replay before failures occur.

Define retry ownership, maximum tolerance, a dead-letter queue or failure destination, an alarm, operator evidence, repair steps, and a safe replay method for work that failed before recovery.
:::

:::expand[When Is Lambda the Right Compute Model?]{kind="recap"}
Lambda is a strong fit for finite event-driven work, while VMs and containers fit workloads needing machine or long-running process control.

Lambda’s main unit is one bounded invocation created when work arrives. A permanent server starts a long-running process that waits for and handles many requests over an indefinite lifetime.

It fits finite work that can be expressed as “when X happens, perform Y.” Machines fit host control, containers fit long-running application processes, and Lambda fits bounded event-driven executions.
:::

:::expand[How Do Versions, Aliases, and Rollback Work?]{kind="recap"}
Immutable versions identify deployed code and configuration, while aliases provide stable pointers that can move or split traffic.

A version is an immutable release snapshot. An alias is a stable name pointing to a version. Rollback moves the alias back to the last known-good version instead of reconstructing old code.

Logs, aggregate metrics, traces, and business outcomes reveal different parts of function correctness.

Application logic can return successfully while failing to produce the intended outcome. Counts such as orders completed or thumbnails created reveal correctness that infrastructure error metrics cannot prove.
:::

:::expand[How Do You Design a Complete Lambda Workload?]{kind="recap"}
A thumbnail example connects events, roles, durable state, concurrency, idempotency, failure handling, deployment, and monitoring.
:::

## References

- [What is AWS Lambda?](https://docs.aws.amazon.com/lambda/latest/dg/welcome.html)
- [Lambda function handlers](https://docs.aws.amazon.com/lambda/latest/dg/foundation-progmodel.html)
- [Lambda execution environments](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)
- [Lambda best practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [Lambda execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)
- [Lambda concurrency](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html)
- [Lambda event-driven architectures](https://docs.aws.amazon.com/lambda/latest/dg/concepts-event-driven-architectures.html)
- [Using Lambda with Amazon SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)
- [Lambda error handling and retries](https://docs.aws.amazon.com/lambda/latest/dg/invocation-retries.html)
- [Lambda versions](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html)
- [Lambda aliases](https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html)
- [Weighted alias routing](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html)
- [Monitoring Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/lambda-monitoring.html)
