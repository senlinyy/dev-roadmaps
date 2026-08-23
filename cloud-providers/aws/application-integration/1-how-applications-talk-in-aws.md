---
title: "How Applications Talk in AWS"
description: "Understand request-response APIs, queues, publish-subscribe topics, event routing, workflows, brokers, and streams from first principles."
overview: "Choose an AWS application-integration service by deciding where waiting, buffering, fanout, routing, retries, and business-process state should live."
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

1. [What Problems Appear When Applications Communicate?](#what-problems-appear-when-applications-communicate)
2. [What Can One Application Say to Another?](#what-can-one-application-say-to-another)
3. [How Does a Queue Let Work Wait Safely?](#how-does-a-queue-let-work-wait-safely)
4. [How Do Topics and Event Buses Deliver the Same News?](#how-do-topics-and-event-buses-deliver-the-same-news)
5. [How Does Step Functions Coordinate a Process?](#how-does-step-functions-coordinate-a-process)
6. [Where Do EventBridge Pipes, Amazon MQ, and Streams Fit?](#where-do-eventbridge-pipes-amazon-mq-and-streams-fit)
7. [How Do You Debug a Missing Message?](#how-do-you-debug-a-missing-message)
8. [How Do You Choose the Communication Pattern?](#how-do-you-choose-the-communication-pattern)
9. [References](#references)

AWS application integration is easier to understand when you begin with the communication problem instead of a comparison such as "SQS versus SNS versus EventBridge." Two pieces of software need to exchange a question, an instruction, a fact, or progress through a longer process. Once they run in separate processes, containers, functions, machines, or services, failures and timing become part of the design.

The sections below answer these questions in order:

1. **What Problems Appear When Applications Communicate?**
2. **What Can One Application Say to Another?**
3. **How Does a Queue Let Work Wait Safely?**
4. **How Do Topics and Event Buses Deliver the Same News?**
5. **How Does Step Functions Coordinate a Process?**
6. **Where Do EventBridge Pipes, Amazon MQ, and Streams Fit?**
7. **How Do You Debug a Missing Message?**
8. **How Do You Choose the Communication Pattern?**

## What Problems Appear When Applications Communicate?
<!-- section-summary: Separate applications become coupled by time, location, processing rate, and responsibility for remembering a multi-step process. -->

Start with the smallest possible relationship:

```text
Application A  -------------------->  Application B
```

A wants B either to provide information or to perform work. As soon as A and B are separate runtime units, the simple arrow hides difficult questions:

- What happens if B is unavailable?
- What happens if B processes work more slowly than A produces it?
- What if three or ten systems need the same information?
- What if only particular consumers care about a message?
- What if the business operation contains several ordered steps?
- What if one step fails after earlier steps succeeded?
- Which component remembers how far the process progressed?

Application-integration services take responsibility for different parts of those problems. A useful first map is:

```text
API Gateway     -> Talk to a service now and wait for an answer.
SQS             -> Keep this work safe until a worker can do it.
SNS             -> Give the same news to interested subscribers.
EventBridge     -> Examine an event and route it by rules.
Step Functions  -> Remember and carry out a whole process.
```

These are learning boundaries rather than absolute feature boundaries. The services overlap and are often composed. Their deeper purpose becomes clearer through four kinds of coupling.

### Temporal coupling

With a direct call, both applications normally have to be available at the same moment. If B is offline, A cannot get the response. A queue can remove this requirement by retaining work until B returns.

### Location coupling

A needs a destination for B. Managed API, topic, queue, and event-bus boundaries can give applications a stable integration location while the target implementation changes behind that boundary.

### Rate coupling

If A produces 10,000 operations per second while B can process only 1,000, a direct path overloads B or forces A to slow down. A durable buffer can absorb the short-term difference, while operators scale consumers or address a sustained capacity mismatch.

### Process coupling

A business operation might reserve inventory, charge a card, create a shipment, and send a confirmation. Something has to record which steps completed, which retry policy applies, and what to do after a failure. A workflow service can own this process state instead of hiding it across application variables and databases.

The central architecture question is therefore not simply which service accepts a message. It is **where waiting, buffering, fanout, routing rules, retry state, and process state should live**.

## What Can One Application Say to Another?
<!-- section-summary: Queries request information, commands request action, and events announce facts that already occurred. -->

Most application communication expresses one of three meanings. Naming that meaning helps prevent an event bus from becoming a disguised collection of remote procedure calls.

### A query asks for information

A query means, "tell me something":

```http
GET /customers/123
```

The caller commonly needs the result before it can continue. A browser requesting a customer record or an application checking whether credentials are valid normally expects an immediate answer.

### A command asks for an action

A command means, "please do something":

```text
GenerateInvoice(order-123)
```

The caller might wait for completion, or it might only need confirmation that the instruction was accepted for later work. A command names the desired action and often implies an intended handler.

### An event announces a fact

An event says that something already happened:

```text
OrderPlaced
PaymentReceived
CustomerAddressChanged
```

Compare these two messages:

```text
Command: Please ship order 123.
Event:   Order 123 was paid.
```

The event publisher should ideally announce the fact without deciding every downstream reaction. Shipping, analytics, fraud detection, and customer communications can independently decide whether the fact matters to them.

An event such as `OrderPlacedAndNowEmailCustomerAndUpdateWarehouse` is really an instruction list disguised as a fact. A cleaner event such as `OrderPlaced` keeps the producer from owning consumer-specific actions.

Queries, commands, and events can all travel through several technologies. Their meaning is an application contract, not a property automatically created by the AWS service. The name, schema, identifiers, and failure expectations should make the intended meaning clear.

### How Does Direct Request and Response Work?
<!-- section-summary: A synchronous API fits communication where the caller must know the outcome before deciding what to do next. -->

Suppose a browser needs to display an order:

```text
Browser -- GET /orders/123 --> Order service
Browser <-- order or error --- Order service
```

The user is waiting, and the response determines the next screen. This is a natural request-response interaction. API Gateway can provide a managed HTTP API boundary in front of Lambda functions, HTTP services, and supported AWS service integrations. REST APIs use the familiar synchronous model in which the caller waits for the result.

A direct response can communicate an outcome such as:

```text
200 -> request succeeded
404 -> requested resource was not found
409 -> request conflicts with current state
500 -> the service encountered a failure
```

This immediate knowledge is valuable when the next action depends on it. An authentication check should normally return yes or no now; queuing a login request and telling the user to return later would not satisfy the interaction.

The problem appears when direct calls form a long chain:

```text
Checkout -> Order -> Inventory -> Payment -> Email
```

If checkout waits for order, order waits for inventory, inventory waits for payment, and payment waits for email, a slow or broken email service can delay or fail the customer's checkout. The end-to-end latency accumulates, and the availability of the full request becomes dependent on every synchronous component.

The design question is not whether direct APIs are good or bad. It is whether the caller truly needs the target's answer before continuing. Payment authorization may need a response in the checkout path. Sending a confirmation email usually does not. Work that can happen after the response is a candidate for an asynchronous boundary.

With a direct API, the waiting lives inside the caller:

```text
A ---- request ----> B
A <--- response ---- B

A remains blocked while B works.
```

That explicit wait is the correct tradeoff when immediate knowledge matters. It is costly when the work is slow, bursty, or not essential to the user's current result.

## How Does a Queue Let Work Wait Safely?
<!-- section-summary: SQS holds unfinished work, absorbs rate differences, redelivers unacknowledged messages, and isolates repeated failures. -->

Suppose placing an order also requires generating a PDF invoice. The customer does not need to hold the request open for eight seconds while a worker renders the document. The order service can instead create a command and put it in SQS:

```text
Order service -> [GenerateInvoice(order-123)] -> Invoice worker
                         SQS
```

Think of Amazon SQS as a **durable inbox of unfinished work**. The producer deposits an item. A worker pulls it when capacity is available. The queue owns the waiting, so producer and consumer no longer have to cooperate at exactly the same moment.

If the consumer is offline for five minutes, the producer can continue adding messages within the system's capacity and retention design. When workers return, they consume the backlog. This is temporal decoupling.

### A queue also absorbs a temporary rate mismatch

Imagine 5,000 orders arrive per minute while current workers can process only 3,000:

```text
5,000/min -> SQS backlog -> workers at 3,000/min
```

The queue prevents the immediate burst from overwhelming the workers. Operators can add workers so the consumption rate exceeds the arrival rate and the backlog shrinks. If the mismatch is permanent, however, the queue grows until retention or operational limits become a problem. Buffering buys time; it does not replace adequate capacity.

### Receiving a message does not mean the work finished

When a worker receives `GenerateInvoice(order-123)`, SQS does not immediately remove it forever. The message becomes temporarily hidden for its **visibility timeout**. The worker processes it and deletes it after success:

```text
SQS -> deliver and hide -> Worker
                           |
                           +-- success -> delete message
```

If the worker crashes or does not delete the message before the visibility timeout ends, the message can become visible and another worker can receive it. This behavior protects unfinished work from disappearing with a failed worker.

The visibility timeout must be long enough for normal processing or deliberately extended during longer tasks. A timeout that expires while a healthy worker is still processing can cause another worker to receive the same item.

### At-least-once delivery requires idempotent consumers

Standard SQS queues use an at-least-once delivery model. A consumer must tolerate the same message arriving more than once. Retries may occur after a worker crash, an acknowledgement problem, or another distributed-system uncertainty.

Duplicate processing is dangerous for a command such as:

```text
ChargeCustomer(order-123, £100)
```

The payment operation can use an idempotency key such as `order-123-payment`. The first successful execution records that key. A later delivery returns the already-recorded result instead of charging another £100.

The broader principle is:

> Retries can create duplicates, so make repeated execution safe.

"The queue accepted the message" and "the business operation completed" are two different acknowledgements. A successful `SendMessage` means the work item reached SQS; it does not prove that a worker finished the invoice, payment, or shipment.

### Dead-letter queues isolate repeated failures

A malformed order could fail every invoice attempt. Retrying forever wastes capacity and hides the exceptional item among healthy work. An SQS redrive policy can move a message to a dead-letter queue after repeated unsuccessful receives:

```text
Main queue -> fail -> retry -> fail -> retry -> Dead-letter queue
```

The DLQ isolates the message for inspection and possible redrive after its cause is corrected. It is not a place to forget failures. It is operational evidence that needs alarms, ownership, investigation, and a defined recovery procedure.

## How Do Topics and Event Buses Deliver the Same News?
<!-- section-summary: SNS owns subscriber fanout from a topic, while EventBridge owns rule-based routing from many event sources to targets. -->

After an order is placed, email, analytics, warehouse, loyalty, and fraud systems may all care. Calling each system directly makes the order service own the list of consumers:

```text
Order service
  ├── Email
  ├── Analytics
  ├── Warehouse
  ├── Loyalty
  └── Fraud
```

Adding a recommendation system would require changing the producer. A publish-subscribe topic moves fanout outside the producer.

### SNS broadcasts one publication to subscribers

The order service publishes `OrderPlaced` once:

```text
                     +--> Email
Order -> SNS topic --+--> Analytics
                     +--> Warehouse
                     +--> Loyalty
```

Amazon SNS replicates and pushes the publication to subscribed endpoints. The producer knows the topic rather than every subscriber. Subscription configuration owns the fanout.

The producer could send five separate SQS messages, but it would then remain responsible for knowing all five queues and handling each send. With SNS, the publisher's responsibility ends at the topic boundary.

### Combine SNS and SQS for independent subscriber backlogs

SNS provides fanout, while SQS provides durable, rate-decoupled consumption. They are frequently combined:

```text
                     SNS OrderPlaced
                   /        |        \
                  v         v         v
             Email SQS   WMS SQS   Analytics SQS
                  |         |         |
                worker    worker    worker
```

If analytics remains unavailable for two hours, its queue accumulates a backlog while email and warehouse processing continue. Each subscriber can have its own throughput, retries, alarms, and dead-letter behavior. This composition demonstrates that integration services are building blocks, not mutually exclusive alternatives.

SNS subscriptions can filter messages using attributes or JSON body properties. A UK subscriber might receive order messages where `country` is `UK`, while a US subscriber receives `US`. It is therefore inaccurate to say that SNS cannot filter and EventBridge can. Their distinction is architectural, not a single capability checkbox.

### EventBridge routes events by rules

A larger organization may publish many event types:

```text
OrderPlaced          PaymentFailed
OrderCancelled       UserCreated
FileUploaded         EC2InstanceStopped
DeploymentCompleted
```

Now the problem is not merely to broadcast one topic. It is to examine each event's source, type, and content and decide which targets match. An EventBridge event bus acts as a routing desk:

```text
Sources -> Event bus -> matching rules -> Lambda, SQS, Step Functions, ...
```

An event might contain:

```json
{
  "source": "myshop.orders",
  "detail-type": "OrderPlaced",
  "detail": {
    "orderId": "123",
    "country": "UK",
    "value": 900
  }
}
```

One rule can send all `OrderPlaced` events to analytics. Another can send UK orders to UK fulfilment. Another can send high-value orders to fraud review. One event may match several rules or none.

Without the bus, the order service contains rules such as "always notify analytics," "route UK orders here," and "send values over 500 there." With EventBridge, the producer only announces the fact. Rules own who is interested and under which conditions. Routing knowledge moves out of producer code.

### SNS and EventBridge begin from different organizing ideas

SNS starts from a topic:

```text
Producer -> Orders topic -> topic subscribers
```

It is naturally suited to one publication being fanned out to subscribers.

EventBridge starts from an event:

```text
many sources -> event bus -> content-based rules -> many targets
```

It is naturally suited to many-to-many routing by event source, type, and content. EventBridge is not simply a newer or universally better SNS. Both can filter and fan out, but they give ownership to different organizing structures.

## How Does Step Functions Coordinate a Process?
<!-- section-summary: Step Functions stores workflow state and makes ordering, branches, waits, retries, and failure paths explicit. -->

Messaging moves information or work between boundaries. A business process adds ordered state:

```text
1. Reserve stock.
2. Charge payment.
3. Create a shipment after successful payment.
4. Release stock after failed payment.
5. Wait for warehouse confirmation.
6. Notify the customer.
```

Someone must remember the current step, prior results, retry decisions, branches, and waits. A single service can hard-code the process:

```python
reserve_stock()

try:
    charge_card()
except Exception:
    release_stock()
    return

create_shipment()
send_email()
```

This becomes a home-grown workflow engine when tasks take hours, involve several services or people, run in parallel, retry under different policies, or must survive the coordinating process crashing.

Step Functions represents the process as a state machine and retains execution state:

```text
Reserve stock -> Charge payment -> success -> Create shipment -> Notify
                      |
                      +----------> failure -> Release stock
```

Task states perform work. `Choice`, `Parallel`, `Map`, and `Wait` states express control flow. The execution history shows what happened and where the process currently sits.

Retry and failure behavior can be part of the workflow through `Retry` and `Catch`. A temporary payment-network error can retry under an explicit policy, while a permanent failure follows a compensation path. That policy becomes visible in the state-machine definition rather than being scattered through application loops and status flags.

### Orchestration and choreography organize ownership differently

With **orchestration**, a central workflow tells components what happens next:

```text
                 Step Functions
                /       |       \
          Inventory   Payment   Shipping
```

The workflow knows the sequence and owns overall progress.

With **choreography**, services react to events without one central process controller:

```text
OrderPlaced -> EventBridge -> Payment
PaymentCompleted -> EventBridge -> Shipping
```

Neither model is universally superior. An explicit business process with required sequencing, waits, and compensation is often easier to reason about as orchestration. Independent reactions such as analytics, email, and recommendation updates are naturally choreographed around an event.

If application code accumulates statuses such as `PAYMENT_PENDING`, counters, timeouts, approval waits, and conditional transitions, the application may already be implementing workflow state. That is the point to consider whether Step Functions should own it explicitly.

## Where Do EventBridge Pipes, Amazon MQ, and Streams Fit?
<!-- section-summary: Pipes connect one source to one target, MQ preserves broker compatibility, and streams retain an ordered record history for processing and replay. -->

The five core mental models do not cover every integration shape. Three adjacent choices solve distinct problems.

### EventBridge Pipes provide a managed point-to-point connector

An event bus is useful for many sources, many rules, and many targets. Sometimes the requirement is only:

```text
one source -> filter -> transform or enrich -> one target
```

EventBridge Pipes provides this point-to-point structure. A pipe might read SQS, filter selected records, transform or enrich them, and send the result to Step Functions. Think of an event bus as a routing network and a pipe as a managed connector.

### Amazon MQ preserves traditional broker expectations

Existing applications may be designed around ActiveMQ, RabbitMQ, JMS, or other traditional broker protocols. Rewriting all of those integrations to AWS-native primitives may not be the immediate goal. Amazon MQ provides managed ActiveMQ and RabbitMQ brokers, which can support migration or operation of broker-based applications that expect those protocols.

The simplified distinction is:

```text
SQS, SNS, EventBridge -> AWS-native integration primitives
Amazon MQ             -> managed traditional broker compatibility
```

### Kinesis and Amazon MSK address streaming

A queue asks which work items have not been processed by a consumer. A stream retains a continuing ordered history that one or more consumers can process and potentially replay:

```text
records: 1 2 3 4 5 6 7 8 9 ...
         ----------------------->
```

Kinesis Data Streams and Amazon Managed Streaming for Apache Kafka belong to this high-volume real-time streaming category. They are useful when consumers need a record sequence and replay model, rather than merely a durable handoff of individual work items.

```text
Queue:  What work remains for this consumer path?
Stream: What ordered sequence of records occurred?
```

### How Can These Services Work Together?
<!-- section-summary: A production design can assign immediate response, routing, buffering, fanout, and process tracking to separate services. -->

Consider a checkout request. The customer needs an immediate acknowledgement, so an HTTP boundary accepts the request:

```text
Customer -> API Gateway -> Order service
```

After the order is stored, the service publishes `OrderPlaced`. EventBridge routes the fact to independent destinations:

```text
                         EventBridge
                      /      |        \
                Analytics  Fulfilment  Notifications
                              |
                              v
                        Step Functions
                         /    |     \
                      Stock Payment Shipping
```

Notification delivery can be buffered:

```text
EventBridge -> SQS -> Email workers
```

Each component has a distinct responsibility:

- API Gateway provides the synchronous client boundary.
- The order service records the authoritative order and announces a fact.
- EventBridge owns event routing.
- SQS lets a consumer work at its own rate and survive an outage.
- Step Functions owns fulfilment process state and sequencing.
- SNS could fan one notification publication to several subscriber types.

This composition answers a particularly useful question: **where is the waiting?**

| Pattern | Where the responsibility lives |
| --- | --- |
| Direct API | The caller waits for the target's response |
| SQS | The queue stores unfinished work and absorbs backpressure |
| SNS | The topic owns fanout to subscribers |
| EventBridge | The event bus and rules own routing decisions |
| Step Functions | The workflow owns process state, waits, and transitions |

An EventBridge-to-SQS-to-worker path means, "route the event to this application, then let that application process it at its own pace." EventBridge decides who should receive the event. SQS gives that receiver time. Treating EventBridge as a worker backlog mixes two different jobs.

## How Do You Debug a Missing Message?
<!-- section-summary: Trace the actual path from left to right and find the last boundary with confirmed evidence. -->

Distributed systems become manageable when debugging follows the message rather than jumping between unrelated dashboards. Draw the real path:

```text
Producer -> EventBridge -> SQS -> Lambda -> Database
```

Use a business identifier and a correlation identifier in messages and logs, for example:

```text
orderId       = ord-123
correlationId = c-84729
```

Then inspect each boundary in order.

### Did the producer send successfully?

Check the result of `SendMessage`, `Publish`, `PutEvents`, or the relevant API call. A log line that application code reached "about to publish" is weaker evidence than the integration API returning success.

### Did the integration service receive the message?

For SQS, determine whether the message or a growing backlog is present. For EventBridge, verify the event reached the intended bus. For Step Functions, confirm that an execution started. For API Gateway, confirm that the gateway received the request.

### Did the routing or filter match the real payload?

An EventBridge event with `detail-type` equal to `OrderCreated` will not match a rule expecting `OrderPlaced`. The services can be healthy while the data simply fails the rule. Inspect the actual event, including types and nesting, rather than the payload a developer remembers producing. SNS subscription filters can fail for the same category of mismatch.

### Was delivery permitted in both directions?

Separate these questions:

```text
Can the producer send to the integration service?
Can the integration service deliver to or invoke the target?
```

The producer's IAM role is only one part. A resource policy, service role, target policy, or cross-account permission may control another arrow. Confirm the exact principal, action, resource, and account boundary involved.

### Did the target receive and process it?

Check whether Lambda was invoked, a message reached SQS, a state-machine execution started, or an HTTP target received the request. This distinguishes a routing or delivery failure from a target business-code failure.

### Is the operation retrying or in a dead-letter queue?

EventBridge can retry eligible target-delivery failures and can send events it cannot deliver to an SQS DLQ when configured. SQS redrive policies can isolate repeatedly failing messages in their own DLQ. A DLQ is often the best forensic record of the exact failed payload and error path.

### Could the apparent failure be duplicate execution?

If an operation happened twice, ask whether a client retried, SQS visibility expired, or a consumer completed the side effect but failed before acknowledging it. Distributed systems often prefer possible duplicate execution over silent loss. Idempotent business operations turn that tradeoff into safe behavior.

At every arrow, ask:

```text
1. Was it sent?
2. Was it accepted?
3. Did it match?
4. Was delivery permitted?
5. Was delivery attempted?
6. Did the receiver succeed?
7. If not, where are the retry and DLQ evidence?
```

If A sent successfully, B received, and C did not, focus on the B-to-C boundary. Finding the last confirmed boundary converts a vague distributed-system failure into a much smaller investigation.

## How Do You Choose the Communication Pattern?
<!-- section-summary: Start with whether an answer is needed now, then identify work ownership, fanout, routing, workflow, broker compatibility, or stream history. -->

Use the job rather than the product name as the first decision:

| Need | Start with | Mental model |
| --- | --- | --- |
| Ask another service and wait | API or API Gateway | Phone call |
| Give one logical processing group work for later | SQS | Work inbox |
| Absorb a temporary production burst | SQS | Buffer |
| Notify several independent consumers | SNS | Broadcast topic |
| Route events by source, type, or content | EventBridge | Routing desk |
| Connect one source to one target with filtering or enrichment | EventBridge Pipes | Managed connector |
| Coordinate ordered, branching, or waiting business steps | Step Functions | Process manager |
| Preserve ActiveMQ or RabbitMQ protocols | Amazon MQ | Managed broker |
| Process and replay an ordered high-volume record history | Kinesis or Amazon MSK | Stream |

A quick decision path is:

```text
Does the caller need an answer now?
  yes -> synchronous API
  no  -> continue

Is this deferred work for one logical consumer group?
  yes -> SQS
  no  -> continue

Should the same publication fan out to subscribers?
  yes -> SNS

Do events need content-based routing across sources and targets?
  yes -> EventBridge

Does one process need sequencing, branches, waits, and remembered state?
  yes -> Step Functions
```

Real architectures can answer yes at more than one level. For example, EventBridge can route an event to an SQS queue, and a Step Functions task can publish through SNS. The goal is not to force the system into one box. It is to give each service a clear job.

Avoid several common mistakes:

- Do not make every interaction synchronous; long chains propagate latency and failure.
- Do not treat standard SQS as a guarantee that business code executes exactly once; use at-least-once assumptions and idempotency.
- Do not make an event name prescribe every downstream command.
- Do not make the producer own every consumer when fanout or routing can own that knowledge.
- Do not use EventBridge as the consumer's durable work backlog when an SQS queue should absorb waiting.
- Do not build a hidden workflow engine from status fields, retry counters, waits, and branches without considering Step Functions.

The shortest durable model is this:

```text
API            -> caller owns waiting
SQS            -> queue owns waiting and backpressure
SNS            -> topic owns fanout
EventBridge    -> rules own event routing
Step Functions -> workflow owns process state
```

Once those responsibilities are clear, individual AWS features are easier to place because the architecture has already decided who should wait, who should know the recipients, who should buffer excess work, and who should remember the next step.

:::expand[What Problems Appear When Applications Communicate?]{kind="recap"}
Separate applications become coupled by time, location, processing rate, and responsibility for remembering a multi-step process.

Separate applications become coupled by availability at the same time, destination knowledge, different production and consumption rates, and responsibility for multi-step progress. Integration services move some of that waiting, buffering, routing, and process memory out of application code.
:::

:::expand[What Can One Application Say to Another?]{kind="recap"}
Queries request information, commands request action, and events announce facts that already occurred.

A query requests information, a command requests an action, and an event announces a fact that already happened. Keeping those meanings clear prevents producers from embedding downstream instructions into supposedly neutral events.

A synchronous API fits communication where the caller must know the outcome before deciding what to do next.

The caller sends a request, waits, and uses the result before continuing. This is correct when an immediate answer matters, but unnecessary synchronous links can create long latency and failure chains.
:::

:::expand[How Does a Queue Let Work Wait Safely?]{kind="recap"}
SQS holds unfinished work, absorbs rate differences, redelivers unacknowledged messages, and isolates repeated failures.

SQS durably retains unfinished work, hides a received message during its visibility timeout, and makes the consumer delete it after success. Standard queues require duplicate-safe consumers, and dead-letter queues isolate repeated failures for investigation and recovery.
:::

:::expand[How Do Topics and Event Buses Deliver the Same News?]{kind="recap"}
SNS owns subscriber fanout from a topic, while EventBridge owns rule-based routing from many event sources to targets.

SNS publishes through a topic and owns fanout to subscribers. EventBridge receives events from many sources and uses rules to route matches to targets. Both can filter, but their organizing models and ownership differ.
:::

:::expand[How Does Step Functions Coordinate a Process?]{kind="recap"}
Step Functions stores workflow state and makes ordering, branches, waits, retries, and failure paths explicit.

Step Functions stores execution state and makes tasks, choices, parallel work, waits, retries, catches, and compensation paths explicit. It is useful when one business process needs a central, durable coordinator.
:::

:::expand[Where Do EventBridge Pipes, Amazon MQ, and Streams Fit?]{kind="recap"}
Pipes connect one source to one target, MQ preserves broker compatibility, and streams retain an ordered record history for processing and replay.

Pipes provide one-source-to-one-target integration with optional filtering, transformation, and enrichment. Amazon MQ preserves traditional broker protocols. Kinesis and Amazon MSK retain record streams for ordered processing and replay.

A production design can assign immediate response, routing, buffering, fanout, and process tracking to separate services.

Assign a distinct job to each boundary: an API for immediate acknowledgement, EventBridge for routing, SQS for a consumer backlog, SNS for fanout, and Step Functions for process state. Combining services is useful when their responsibilities remain explicit.
:::

:::expand[How Do You Debug a Missing Message?]{kind="recap"}
Trace the actual path from left to right and find the last boundary with confirmed evidence.

Draw the actual path, carry a correlation identifier, and inspect each arrow from left to right. Confirm send, acceptance, matching, permission, attempted delivery, receiver behavior, retries, and dead-letter evidence until you find the last proven boundary.
:::

:::expand[How Do You Choose the Communication Pattern?]{kind="recap"}
Start with whether an answer is needed now, then identify work ownership, fanout, routing, workflow, broker compatibility, or stream history.

First ask whether the caller needs an answer now. Otherwise decide whether the need is deferred work, fanout, rule-based event routing, a stateful process, broker compatibility, or a replayable stream. The job selects the service, and a real architecture may compose several jobs.
:::

## References

- [Amazon API Gateway documentation: REST APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-rest-api.html)
- [Amazon SQS documentation: Visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
- [Amazon SQS documentation: At-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html)
- [Amazon SQS documentation: Dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
- [Amazon SNS documentation](https://docs.aws.amazon.com/sns/latest/dg/welcome.html)
- [Amazon SNS documentation: Subscription filter policies](https://docs.aws.amazon.com/sns/latest/dg/sns-subscription-filter-policies.html)
- [Amazon EventBridge documentation: Event bus concepts](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-what-is-how-it-works-concepts.html)
- [Amazon EventBridge documentation: Event buses](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html)
- [Amazon EventBridge documentation: Pipes concepts](https://docs.aws.amazon.com/eventbridge/latest/userguide/pipes-concepts.html)
- [Amazon EventBridge documentation: Rules and event matching](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules.html)
- [Amazon EventBridge documentation: Targets and permissions](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-targets.html)
- [Amazon EventBridge documentation: Retry policies and dead-letter queues](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-retry-policy.html)
- [AWS Step Functions documentation: Workflow states](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-states.html)
- [AWS Step Functions documentation: Error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)
- [Amazon MQ documentation](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/welcome.html)
- [AWS decision guide: Choosing an application integration service](https://docs.aws.amazon.com/decision-guides/latest/application-integration-on-aws-how-to-choose/application-integration-on-aws-how-to-choose.html)
