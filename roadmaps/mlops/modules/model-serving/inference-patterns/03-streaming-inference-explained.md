---
title: "Streaming Inference"
description: "Learn how streaming inference scores continuous events with durable logs, event time, state, replay-safe outputs, and controlled recovery."
overview: "Streaming inference turns a continuous event stream into a continuous stream of predictions. This guide builds the operating model from events, partitions, offsets, and time through schemas, state, delivery guarantees, capacity, watermarks, replay, and production monitoring."
tags: ["MLOps", "core", "inference"]
order: 3
id: "article-mlops-model-serving-streaming-inference-explained"
aliases:
  - roadmaps/mlops/modules/model-serving/inference-patterns/02-streaming-inference-explained.md
  - child-inference-patterns-02-streaming-inference-explained
---

## Table of Contents

1. [What Makes Streaming Inference a History of Timed Events?](#what-makes-streaming-inference-a-history-of-timed-events)
2. [How Do Partitioning and State Shape Streaming Features?](#how-do-partitioning-and-state-shape-streaming-features)
3. [How Do Stable Event Identities and Delivery Guarantees Handle Replay?](#how-do-stable-event-identities-and-delivery-guarantees-handle-replay)
4. [How Do Schemas, Feature Versions, Watermarks, and Late Events Preserve Meaning?](#how-do-schemas-feature-versions-watermarks-and-late-events-preserve-meaning)
5. [How Do Lag and Backpressure Reveal a Capacity Failure?](#how-do-lag-and-backpressure-reveal-a-capacity-failure)
6. [Where Should Model Execution Fit in a Streaming Stack?](#where-should-model-execution-fit-in-a-streaming-stack)
7. [How Do Replay, Model Versions, Revisions, Monitoring, and Recovery Work Together?](#how-do-replay-model-versions-revisions-monitoring-and-recovery-work-together)
8. [How Does the Complete Streaming System Differ from an Online Request API?](#how-does-the-complete-streaming-system-differ-from-an-online-request-api)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A card transaction event arrives, updates a customer's recent-spend features, receives a fraud score, and triggers an action. Minutes later an older transaction arrives out of order. Reprocessing it may change the state and the prediction that followed.

**Streaming inference** applies models inside a continuing history of events. Correctness depends on event identity, event time, partitioned state, schemas, watermarks, replay, model versions, and side effects—not only on the prediction function. Delivery and recovery must preserve the meaning of that history.

Use these questions to follow one event from arrival through state, inference, action, and replay:

1. **What Makes Streaming Inference a History of Timed Events?**
2. **How Do Partitioning and State Shape Streaming Features?**
3. **How Do Stable Event Identities and Delivery Guarantees Handle Replay?**
4. **How Do Schemas, Feature Versions, Watermarks, and Late Events Preserve Meaning?**
5. **How Do Lag and Backpressure Reveal a Capacity Failure?**
6. **Where Should Model Execution Fit in a Streaming Stack?**
7. **How Do Replay, Model Versions, Revisions, Monitoring, and Recovery Work Together?**
8. **How Does the Complete Streaming System Differ from an Online Request API?**

## What Makes Streaming Inference a History of Timed Events?
<!-- section-summary: A stream is an ordered or partially ordered history of facts with event time, processing time, identity, and evolving meaning. -->

Streaming inference begins with durable facts arriving over time, not with an endless collection of unrelated API calls.

Streaming inference is easiest to understand by starting with how the world produces information. Many systems do not receive neat datasets or isolated API requests. They receive an endless sequence of facts:

```text
10:00:01  customer opened app
10:00:04  customer searched "laptop"
10:00:09  customer viewed product 82
10:00:13  customer added product 82 to cart
10:00:18  customer attempted payment
...
```

Each fact changes what the system knows. If a model should react whenever those facts arrive, we get **streaming inference**:

$$
\boxed{\text{event} \rightarrow \text{update state/features} \rightarrow \text{model} \rightarrow \text{prediction event}}
$$

The defining property is not that inference is fast. It is that **inference is driven by a continuing stream of events rather than a bounded dataset or a waiting request**. Recall the three common triggers for inference. Batch inference says:

```text
dataset ready
    ↓
run predictions
```

Online inference says:

```text
request waiting
    ↓
run prediction
```

Streaming inference says:

```text
something happened
    ↓
run/update prediction
```

For example, a fraud system might receive:

```text
transaction event
       ↓
update customer's recent activity
       ↓
construct features
       ↓
fraud model
       ↓
risk-score event
```

Nobody necessarily makes an HTTP request to the fraud model. The event itself caused the work. We can describe the pipeline mathematically. Let events be:

$$
e_1,e_2,e_3,\ldots
$$

A stateful streaming system maintains state:

$$
S_t
$$

and each event transforms that state:

$$
S_{t+1}=g(S_t,e_{t+1})
$$

The model then receives features derived from the event and state:

$$
x_{t+1}=\phi(e_{t+1},S_{t+1})
$$

and computes:

$$
y_{t+1}=f(x_{t+1})
$$

That is the essence of streaming inference. The model itself may be completely ordinary. The complexity comes from maintaining the correct $$S_t$$ while events arrive late, machines fail, work is replayed, and traffic fluctuates. It is tempting to imagine streaming systems as:

```text
producer → queue → consumer
```

That is useful but incomplete. For reliable stream processing, it is more useful to think of the stream as an **ordered history of facts**:

```text
offset

100   customer_viewed
101   item_added
102   payment_started
103   payment_completed
104   customer_viewed
...
```

Consumers keep track of where they are:

```text
stream

100 101 102 103 104 105 106 107
                ↑
           consumer position
```

If a worker crashes, a replacement can return to an earlier position and process events again. This one property—**replayability**—is the foundation of much of streaming reliability. Instead of requiring:

"Never fail."

we can build systems around:

"If processing fails, restore state and replay the history."

Kafka, for example, models records as a retained log consumed using positions/offsets, which is why it is commonly paired with stateful processors and replay-based recovery. ([Apache Kafka][1]) A useful event usually says that something **happened**.

For example:

```text
PaymentAttempted
CustomerLoggedIn
DeviceLocationObserved
ProductPurchased
TemperatureMeasured
```

rather than an instruction like:

```text
CalculateSomething
```

Why? Because facts remain meaningful during replay. Suppose this event exists:

```text
event_id:       tx_837261
type:           PaymentAttempted
customer_id:    C42
amount:         975.00
currency:       GBP
event_time:     10:04:17.328
```

You can process that event today, replay it tomorrow, use it to reconstruct features, or run a new model over historical traffic. The event becomes part of the system's durable history. This is one of the most important ideas in stream processing. Suppose somebody makes a purchase at:

```text
10:00:00
```

Their phone temporarily loses connectivity. The event reaches your backend at:

```text
10:02:17
```

A worker finally processes it at:

```text
10:02:19
```

We now have at least three times.

$$
t_e=\text{event time}
$$

$$
t_a=\text{arrival/ingestion time}
$$

$$
t_p=\text{processing time}
$$

In this example:

$$
t_e=10{:}00{:}00
$$

$$
t_a=10{:}02{:}17
$$

$$
t_p=10{:}02{:}19
$$

These are not interchangeable. Suppose your fraud feature is:

$$
\text{transactions during previous 5 minutes}
$$

Imagine these transactions actually occurred in this order:

```text
event time

10:00  A
10:01  B
10:02  C
```

But network delays cause arrival order:

```text
processing order

10:00 event A
10:02 event C
10:01 event B
```

If you reason using processing order alone, history becomes:

```text
A → C → B
```

which is not what happened. For many ML features, that changes the answer. Flink explicitly supports event-time processing because stream applications often need to reason about the order in which events occurred rather than merely the order in which machines happened to receive them. ([Apache Nightlies][2]) So a good streaming system asks:

**Are my features defined in world time or machine time?**

Usually business features such as "spend in the last hour" mean world/event time.

## How Do Partitioning and State Shape Streaming Features?
<!-- section-summary: Stateful features accumulate history, and partitioning determines which worker owns each key's state and how it can recover. -->

Because later predictions depend on earlier events, the system must place and recover state consistently.

Consider this fraud model:

$$
risk=f(
amount,
device,
transactions_{10m},
spend_{24h},
distinct\_countries_{1h}
)
$$

Only `amount` and perhaps `device` come directly from the current event. The others require history. So for customer $$k$$, the stream processor might maintain:

$$
S_k=
\{
transactions_{10m},
spend_{24h},
countries_{1h},
...
\}
$$

When a new event arrives:

```text
transaction
    ↓
find state for customer C42
    ↓
update rolling windows
    ↓
derive features
    ↓
run model
```

This is why streaming inference is often much more than:

```python
model.predict(event)
```

It is really:

```text
event
  +
correct historical state
  +
model version
  ↓
prediction
```

In many applications, maintaining the state correctly is harder than running the neural network. Suppose we process transactions for millions of customers. To calculate one customer's recent activity efficiently, events for that customer should normally reach the same logical state partition.

Conceptually:

```text
customer A ─┐
customer A ─┼──► partition 1 ─► state[A]

customer B ─┐
customer B ─┼──► partition 2 ─► state[B]

customer C ─────► partition 3 ─► state[C]
```

A key such as:

$$
key=customer\_id
$$

determines which processor owns the relevant state. This allows horizontal scaling:

```text
partitions 0-9    → worker 1
partitions 10-19  → worker 2
partitions 20-29  → worker 3
```

But it introduces another engineering question: **are keys distributed evenly?** Imagine one merchant produces 30% of all events:

```text
merchant_A ████████████████████
merchant_B ██
merchant_C █
merchant_D ██
```

Even with 100 workers, the partition containing merchant A can become the bottleneck. This is called **key skew**. Scaling streaming inference therefore depends not only on total traffic but also on how traffic distributes across state keys. Imagine the processor has handled:

```text
events 1 ... 1,000,000
```

and accumulated:

$$
S_{1,000,000}
$$

Then its machine dies. Starting with empty state would make future predictions wrong. The replacement worker needs both:

```text
a consistent saved state
+
a known stream position
```

Conceptually:

```text
checkpoint

state = S_900000
stream position = 900000
```

Recovery becomes:

```text
restore S_900000
      ↓
replay events 900001 ... 1000000
      ↓
reconstruct S_1000000
      ↓
continue
```

This is the fundamental relationship:

$$
\boxed{\text{checkpointed state}+\text{replayable input}=\text{recoverable stream processing}}
$$

Flink's checkpointing model follows exactly this idea: state is snapshotted, and source data can be replayed after failure to reconstruct a consistent execution. ([Apache Nightlies][3])

![Parcel scan timeline separates the eight-minute source or network delay, one-minute queue and processing delay, and nine-minute total product freshness](/content-assets/articles/article-mlops-model-serving-streaming-inference-explained/streaming-event-time-delays.png)

*Event time places the scan in its real window. Ingestion and scoring timestamps show where the product's total freshness delay accumulated.*

## How Do Stable Event Identities and Delivery Guarantees Handle Replay?
<!-- section-summary: Stable identities make replay and side effects deduplicatable, while delivery guarantees describe outcomes rather than claiming code literally runs once. -->

Recovery replays events, which immediately creates duplicate-execution and side-effect questions that require stable identity.

Suppose event 1001 produces:

```text
risk_score = 0.96
```

The system writes that result. Then it crashes before recording that event 1001 was successfully processed. After recovery it sees event 1001 again:

```text
first execution:
event 1001 → prediction

crash

replay:
event 1001 → prediction again
```

Physically, the model ran twice. This is normal. Therefore reliable streaming architecture cannot assume:

$$
\text{each event physically executes once}
$$

Instead, it should aim for:

$$
\text{repeated execution does not produce incorrect logical effects}
$$

This is the reason idempotency and stable identities matter so much. Suppose the payment event has:

```text
event_id = payment_82917
```

Do not generate a completely unrelated output identity every time processing happens. Instead, the prediction could have a logical identity derived from the triggering work:

$$
prediction\_id
=
H(event\_id,model\_version,prediction\_type)
$$

For example:

```text
event_id:       payment_82917
model_version:  fraud_v12
prediction_id:  fraud_v12:payment_82917
score:          0.96
```

If the event is replayed:

```text
fraud_v12:payment_82917
```

is produced again. A sink can then do:

```text
PUT prediction_id = fraud_v12:payment_82917
```

instead of:

```text
APPEND another unrelated row
```

The second execution simply replaces or confirms the first. That is an **idempotent output**. Imagine model output directly triggers:

```text
send SMS
charge card
disable account
issue refund
```

Replay becomes dangerous. If:

```text
event 183
→ model says "send alert"
```

is executed twice, you might send two alerts. For money movement, the consequences can be worse. So a robust architecture often separates:

```text
prediction
```

from:

```text
business action
```

For example:

```text
transaction event
       ↓
fraud inference
       ↓
prediction event
id = fraud_v12:tx_183
       ↓
decision service
       ↓
idempotent action
```

The action system can record:

```text
already processed fraud_v12:tx_183
```

and ignore duplicates. This is an essential rule of replayable systems:

**Anything downstream of a stream should assume that logically identical work may appear again unless the entire boundary is protected transactionally.**

These terms describe what can happen around failures.

| Guarantee              |              Loss possible | Duplicate processing/effects possible |
| ---------------------- | --------------------------: | -------------------------------------: |
| At-most-once           |                         Yes |                                     No |
| At-least-once          | No, assuming recovery works |                                    Yes |
| Exactly-once semantics |             No logical loss |            No duplicate logical effect |

At-most-once effectively says:

Better to lose something than repeat it.

At-least-once says:

Better to repeat something than lose it.

For most important ML event pipelines, **at-least-once plus idempotent processing** is a very useful design. Exactly-once needs more careful interpretation. Suppose:

```text
event
  ↓
update state
  ↓
model
  ↓
crash
```

The event may physically be processed again. Exactly-once semantics usually mean:

After recovery, the system's committed state and outputs are equivalent to what would have happened if each logical event had affected them once.

Flink's documentation explicitly makes this distinction: exactly-once checkpointing does not mean every record physically traverses the system once; it means recovered managed state reflects each logical record once. End-to-end exactly-once additionally requires a replayable source and a transactional or idempotent sink. ([Apache Nightlies][4]) Kafka similarly distinguishes producer, consumer, and transactional boundaries; Kafka's transactional mechanisms can atomically coordinate consumed offsets with output written back to Kafka, but guarantees outside that boundary depend on the destination system. ([Apache Kafka][1]) So whenever somebody says:

"Our pipeline is exactly once."

the useful next question is:

**Exactly once across which boundary?**

## How Do Schemas, Feature Versions, Watermarks, and Late Events Preserve Meaning?
<!-- section-summary: Versioned schemas and feature semantics keep old events interpretable, while watermarks choose how long to wait for out-of-order data. -->

Identity alone cannot explain old events when schemas or feature meanings change, and event time introduces out-of-order arrivals.

A stream can live for years. Imagine your original event is:

```text
Transaction {
    customer_id
    amount
}
```

Six months later you need:

```text
Transaction {
    customer_id
    amount
    currency
    merchant_country
}
```

Meanwhile old producers, new producers, old consumers, new consumers and replayed historical data may coexist. Without an explicit schema contract:

```text
producer v1 ──┐
producer v2 ──┼── stream ──► consumer v1
producer v3 ──┘              consumer v3
```

every deployment becomes risky. A production event generally needs a contract describing field names, types, required/optional fields, defaults and versioning rules.

For example:

```text
event_type:       PaymentAttempted
schema_version:   3
event_id:         ...
event_time:       ...
customer_id:      ...
amount:           ...
currency:         ...
```

The central principle is:

> **A stream is a long-lived public interface between independently evolving systems.**

Treating event schemas like API schemas makes evolution much safer. Suppose model v1 expects:

$$
transaction\_count_{1h}
$$

Version 2 changes the definition from:

all transaction attempts

to:

completed transactions only.

The feature still has the same numerical type. But its **meaning changed**. That is more dangerous than changing an integer to a string because schema validation might not catch it. So the model-serving contract should include not merely:

```text
float
integer
string
```

but semantic definitions such as:

```text
transaction_count_1h:
count of PaymentCompleted events
with event_time in (prediction_time - 1h, prediction_time]
```

This becomes especially important during replay. If historical events are reprocessed using new feature semantics, you may generate different predictions even with the same model. Suppose we calculate purchases per five-minute window. Events occur:

```text
10:01  A
10:02  B
10:04  C
```

The processor reaches 10:06 and produces the result for:

```text
10:00–10:05
```

Then an event arrives:

```text
event_time = 10:03
arrival_time = 10:07
```

What now? The event logically belongs to an already-computed window. There is no universally correct answer. The product must choose among semantics such as:

```text
ignore late event
```

or:

```text
update previous result
```

or:

```text
emit corrected result
```

or:

```text
send late event to separate reconciliation path
```

This is not merely infrastructure behavior. It can change model features and therefore predictions. A stream processor cannot literally know:

"No event from 10:03 will ever arrive again."

Networks can delay indefinitely. Instead it needs an operational approximation. A **watermark** says roughly:

"We believe event time has advanced this far."

If:

$$
W=10{:}05
$$

then the processor may decide that windows ending before 10:05 are sufficiently complete.

For example:

```text
events received:

10:01
10:03
10:04
10:07

watermark:
       10:05
         ↑
windows before here
can usually be finalized
```

Flink describes watermarks as event-time progress indicators; when watermarks are heuristic, older events can still arrive and applications must decide whether to ignore them, route them separately, or revise previously emitted results. ([Apache Nightlies][5]) Watermarks therefore turn an impossible question—

"Have all events arrived?"

—into a useful engineering question:

**"How long are we willing to wait before treating the result as complete enough?"**

Suppose events can arrive 30 seconds late. You could wait:

$$
30\text{ seconds}
$$

before finalizing every window. You capture more late data, but predictions arrive later. Or wait:

$$
2\text{ seconds}
$$

Predictions are fresher, but more events arrive after finalization. So:

$$
\boxed{\text{more waiting} \rightarrow \text{greater completeness} \rightarrow \text{higher latency}}
$$

and:

$$
\boxed{\text{less waiting} \rightarrow \text{lower latency} \rightarrow \text{more corrections/loss}}
$$

The right watermark policy therefore follows from the product. An hourly billing report can wait. Real-time fraud prevention often cannot.

## How Do Lag and Backpressure Reveal a Capacity Failure?
<!-- section-summary: Consumer lag measures how far computation trails the event history, and backpressure protects downstream systems when work arrives faster than it can finish. -->

Waiting for late data competes with timeliness; lag and backpressure show when the system is no longer keeping that balance.

Suppose events enter the stream at rate:

$$
\lambda
$$

events/second. Your pipeline can process:

$$
\mu
$$

events/second. If:

$$
\mu>\lambda
$$

the system can keep up. If:

$$
\lambda>\mu
$$

backlog grows. Ignoring complications:

$$
\frac{dB}{dt}=\lambda-\mu
$$

where $$B$$ is backlog. If traffic arrives at:

$$
12,000/s
$$

while you process:

$$
10,000/s
$$

then backlog grows by approximately:

$$
2,000\text{ events/sec}.
$$

After five minutes:

$$
B\approx600,000
$$

events. The service may still be "healthy" in the sense that nothing has crashed. But its predictions are becoming increasingly stale. Suppose a fraud pipeline is ten minutes behind. The model itself may execute in:

$$
5\text{ ms}.
$$

Calling this a "5 ms inference system" would be misleading. A transaction occurring now may wait ten minutes before reaching the model. The actual relevant delay is closer to:

$$
L_{stream}
=
L_{ingestion}
+
L_{backlog}
+
L_{feature}
+
L_{inference}
+
L_{output}
$$

Frequently:

$$
L_{backlog} \gg L_{inference}.
$$

This is why stream monitoring must include things such as offsets, event-time delay and watermark progress, not merely model latency. Flink, for example, exposes watermark progression specifically so operators can identify event-time stragglers. ([Apache Nightlies][6]) Imagine:

```text
Kafka
 ↓ 50k events/s
feature processor
 ↓ 50k/s
model service
 ↓ 12k/s
output
```

The model service is the bottleneck. Without control:

```text
feature processor
       ↓
huge queue
       ↓
model
```

memory eventually fills. A streaming runtime can instead propagate pressure backward:

```text
source
  ↓
operator A
  ↓
operator B   ← slow
  ↑
backpressure
```

The upstream stages reduce how aggressively they produce work. Backpressure protects the system from unbounded internal buffering. But it does not magically create capacity. It tells you:

$$
\mu_{\text{bottleneck}} < \lambda
$$

for the current load. Then you need to scale, improve inference throughput, reduce work, increase batching, partition differently, or accept more lag. Consider a lightweight feature computation:

$$
0.1\text{ ms/event}
$$

followed by a model taking:

$$
20\text{ ms/event}.
$$

Clearly the model dominates. But accelerators often process batches much more efficiently. So a streaming inference stage might perform microbatching:

```text
events arriving continuously

e1 ────────┐
e2 ──────┐ │
e3 ────┐ │ │
e4 ──┐ │ │ │
     ▼ ▼ ▼ ▼
       batch
         ↓
        GPU
```

Again we trade:

$$
\text{batch wait}
$$

against:

$$
\text{higher throughput}.
$$

The right batch size depends on the stream's latency budget. This is analogous to dynamic batching in online serving, except persistent stream lag also enters the equation.

![At-least-once replay returns the same event to a pinned scoring revision while a unique prediction ID, transactional outbox, command ID, and effect ledger prevent duplicate predictions and actions](/content-assets/articles/article-mlops-model-serving-streaming-inference-explained/streaming-replay-safe-output.png)

*A unique sink protects the prediction fact. External effects need their own durable outbox, command identity, and receiver-side ledger because they sit outside the stream processor's commit boundary.*

## Where Should Model Execution Fit in a Streaming Stack?
<!-- section-summary: A production stack separates ingestion, stateful feature work, inference, result publication, and action, then evaluates guarantees across the full chain. -->

The model is one stage in a larger stateful stack, so its placement must follow feature ownership and capacity.

There are two broad architectures.

### Model embedded in the stream processor

```text
stream
  ↓
Flink-like worker
  ├─ feature state
  ├─ model loaded locally
  └─ inference
  ↓
output
```

This can minimize network hops and align model execution closely with state processing. But large models may make workers expensive and deployment harder.

### Separate inference service

```text
stream processor
      ↓
features
      ↓
inference service
      ↓
prediction
```

This separates streaming compute from accelerator serving. It can make GPU management, model rollouts and batching easier, but introduces another distributed dependency. Now you must handle:

$$
\text{network failures}
$$

$$
\text{timeouts}
$$

$$
\text{model-service backpressure}
$$

$$
\text{retry duplicates}
$$

There is no universal winner. The decision follows from model size, accelerator requirements, throughput, latency and deployment independence. Think in terms of responsibilities rather than brand names:

```text
event producers
      ↓
durable event log
      ↓
stateful stream processor
      ↓
feature/state computation
      ↓
model runtime / inference service
      ↓
prediction stream
      ↓
database / alert system / decision service
```

A common contemporary implementation might use Kafka for the durable log and a system such as Flink for stateful event-time processing. Kafka provides persistent partitioned streams and transactional/idempotent capabilities, while Flink focuses heavily on state, event time, watermarks and checkpoint/replay recovery. ([Apache Kafka][1]) The model can run inside the processing job when lightweight enough, or behind a dedicated serving layer when accelerator scheduling and independent scaling matter more. The important architectural principle is:

> **Every layer should have one clear responsibility, and its failure/replay contract must match the layer before and after it.**

End-to-end behavior is a chain. Imagine:

```text
Kafka
  ↓
stream processor
  ↓
model API
  ↓
PostgreSQL
  ↓
email system
```

Perhaps the stream processor has exactly-once managed state. That does **not** automatically mean:

```text
email sent exactly once
```

The real system guarantee is constrained by every boundary. A useful mental equation is:

$$
G_{end-to-end}
=
\text{composition of source, processor, model call, sink, side-effect guarantees}
$$

If the final sink cannot participate in transactions, you may need idempotency keys or deduplication. Flink's current documentation makes this explicit: exactly-once managed state alone does not imply exactly-once external effects; end-to-end guarantees require compatible source and sink behavior. ([Apache Nightlies][3])

## How Do Replay, Model Versions, Revisions, Monitoring, and Recovery Work Together?
<!-- section-summary: Designed replay needs model identity, revision semantics, time-aware monitoring, and interruption tests so recovery does not create contradictory predictions. -->

Once the topology exists, replay, model changes, revisions, and recovery need an explicit design and time-aware monitoring.

Imagine you discover a feature bug:

```text
country_count_1h
```

was incorrectly computed. You want to rewind three days of events and regenerate predictions. That's one of the great powers of an event log:

```text
historical stream
       ↓
fixed feature logic
       ↓
model
       ↓
corrected predictions
```

But replay can also overwhelm live infrastructure. Suppose normal traffic is:

$$
20,000\text{ events/s}
$$

and replay runs at:

$$
200,000\text{ events/s}.
$$

If both call the same inference service:

```text
live traffic ────┐
                 ├──► model service
replay traffic ──┘
```

the backfill may destroy live latency. So production designs often separate priorities, quotas or capacity for:

```text
live processing
```

and:

```text
historical replay
```

Replay isn't merely a disaster-recovery feature. It is a normal operating mode of a well-designed streaming system. Suppose an event originally passed through:

$$
M_7
$$

but the current deployed model is:

$$
M_{12}.
$$

If you replay the event, should you use:

$$
M_7
$$

or:

$$
M_{12}
$$

There are two completely different intents. For **recovery**, you normally want the same logical result:

$$
event + M_7 + feature\_logic_5
$$

For **backtesting/recomputation**, you may intentionally want:

$$
event + M_{12} + feature\_logic_9.
$$

Therefore a reproducible prediction should carry lineage such as:

```text
prediction_id
source_event_id
event_time
processing_time
model_version
feature_version
schema_version
```

Without that information, replay can silently change what your historical prediction stream means. Suppose fraud risk at 10:05 was:

$$
0.42
$$

based on known activity. Then a delayed transaction from 10:03 arrives. Correct event-time state now yields:

$$
0.79.
$$

Should the pipeline emit:

```text
prediction = 0.79
```

as another unrelated record Better semantics may be:

```text
prediction_id:   customer42:10:05
revision:        2
score:           0.79
supersedes:      revision 1
```

The downstream system now understands that the prediction was corrected. This is particularly important for analytical outputs. For irreversible operational decisions, revision may be impossible:

```text
payment already approved
```

In those cases the system must explicitly decide how much late data it can tolerate before acting. Streaming semantics ultimately come from the product's ability—or inability—to revise decisions. A streaming cluster can have:

```text
CPU = 40%
memory = 60%
all processes healthy
```

and still be producing bad operational outcomes. You also need to know whether the pipeline is keeping pace with reality. A compact set of questions is more useful than merely "is the service up?":

1. **How far behind the head of the stream are consumers?**
2. **How far behind wall-clock time is processed event time?**
3. **Are watermarks progressing normally?**
4. **Is backpressure increasing anywhere?**
5. **Are checkpoint duration/failure rates changing?**
6. **How large is maintained state and how fast is it growing?**
7. **What fraction of events are late, duplicated, rejected or sent to recovery paths?**
8. **What are inference latency, error rate and throughput?**
9. **Did prediction distributions change unexpectedly?**
10. **Can we restore a checkpoint and replay without producing unsafe effects?**

The first half tells you whether the **streaming system** is healthy. The second half tells you whether the **model-serving system** is healthy. You need both. A system isn't truly replay-safe because an architecture diagram says so. Test failures such as:

```text
worker dies after state update
worker dies after output write
inference call times out
checkpoint storage becomes unavailable
events arrive out of order
events arrive hours late
duplicate events arrive
schema changes during deployment
a partition becomes extremely hot
sink becomes unavailable
```

Then verify the important invariant:

$$
\boxed{\text{recovery produces the intended logical state and effects}}
$$

The point isn't merely that processing resumes. It is that it resumes **correctly**.

## How Does the Complete Streaming System Differ from an Online Request API?
<!-- section-summary: Streaming continuously advances state and event history, whereas an online API usually treats each request as an immediate interaction. -->

The complete example highlights why a stream's state and history create different correctness obligations from synchronous online serving.

Online inference commonly has this relationship:

```text
request
   ↓
model
   ↓
response
```

The request itself usually contains most of the immediate context. Streaming inference often has:

```text
                   ┌──────── accumulated state
                   │
event ─────────────┼────► features ─► model ─► prediction event
                   │
                   └──────── event-time history
```

So correctness depends on:

$$
\text{model correctness}
$$

plus:

$$
\text{state correctness}
$$

plus:

$$
\text{temporal correctness}
$$

plus:

$$
\text{replay correctness}.
$$

This is why a model with excellent offline metrics can still produce incorrect streaming behavior when its event-time or state semantics are wrong. Consider real-time account takeover detection. Events arrive:

```text
LoginSucceeded
DeviceObserved
PasswordChanged
PaymentAttempted
LocationObserved
```

Each event carries:

```text
event_id
account_id
event_time
schema_version
payload
```

The stream is partitioned by:

$$
account\_id
$$

so the processor can maintain per-account state:

$$
S_a=
\{
login\_count_{10m},
devices_{24h},
locations_{1h},
password\_changed_{1h},
...
\}
$$

A `PaymentAttempted` event arrives:

```text
event
  ↓
update event-time state
  ↓
construct features
  ↓
fraud model v14
  ↓
prediction_id = fraud:v14:payment_827
  ↓
RiskScored event
```

If the processor crashes, it restores a checkpoint and replays events. `payment_827` may be evaluated again, but the same prediction identity allows safe deduplication. If an event arrives late, the watermark policy determines whether it updates state, produces a correction, or goes to a late-event path. If incoming rate exceeds processing capacity:

$$
\lambda>\mu
$$

consumer lag grows and the fraud decision becomes stale even though model execution remains fast. That single example contains nearly every major streaming concept:

$$
\boxed{
\text{events}
+
\text{time}
+
\text{state}
+
\text{identity}
+
\text{replay}
+
\text{capacity}
}
$$

The model is only one component. The cleanest way to reason about streaming inference is:

```text
THE WORLD CHANGES
       ↓
record that change as an event
       ↓
preserve event identity + event time
       ↓
append it to replayable history
       ↓
update keyed state
       ↓
derive time-correct features
       ↓
run the model
       ↓
produce an identifiable prediction
       ↓
make downstream effects replay-safe
```

Then failures become:

```text
restore state
    +
return to known stream position
    +
replay
```

and scale becomes:

$$
\boxed{\text{incoming rate }\lambda
\quad\text{vs}\quad
\text{processing capacity }\mu}
$$

while temporal correctness becomes:

$$
\boxed{\text{event time}+\text{watermarks}+\text{late-event policy}}
$$

and delivery correctness becomes:

$$
\boxed{
\text{replayable source}
+
\text{checkpointed state}
+
\text{idempotent/transactional outputs}
}
$$

The most important insight is this:

**Streaming inference is not primarily “running a model continuously.” It is maintaining a recoverable, time-aware state of the world and producing model decisions as that world changes.**

Once that is understood, offsets, state stores, checkpoints, schemas, watermarks, idempotency, lag, backpressure, and exactly-once semantics stop looking like unrelated distributed-systems features. **They are all mechanisms for preserving the meaning of a prediction while an endless, imperfect stream of reality moves through a fallible distributed system.**

![Seven-stage streaming inference system carries event identity and time through a durable topic, stateful processor, immutable scoring package, prediction topic, idempotent sink, and effect-ledger action consumer](/content-assets/articles/article-mlops-model-serving-streaming-inference-explained/streaming-system-summary.png)

*Freshness, lag, schema failures, quarantine, checkpoint health, and replay conflicts prove whether the replayable system around the model is still meeting its product promise.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Makes Streaming Inference a History of Timed Events?]{kind="recap"}
A stream is an ordered or partially ordered history of facts with event time, processing time, identity, and evolving meaning.
:::

:::expand[How Do Partitioning and State Shape Streaming Features?]{kind="recap"}
Stateful features accumulate history, and partitioning determines which worker owns each key's state and how it can recover.
:::

:::expand[How Do Stable Event Identities and Delivery Guarantees Handle Replay?]{kind="recap"}
Stable identities make replay and side effects deduplicatable, while delivery guarantees describe outcomes rather than claiming code literally runs once.
:::

:::expand[How Do Schemas, Feature Versions, Watermarks, and Late Events Preserve Meaning?]{kind="recap"}
Versioned schemas and feature semantics keep old events interpretable, while watermarks choose how long to wait for out-of-order data.
:::

:::expand[How Do Lag and Backpressure Reveal a Capacity Failure?]{kind="recap"}
Consumer lag measures how far computation trails the event history, and backpressure protects downstream systems when work arrives faster than it can finish.
:::

:::expand[Where Should Model Execution Fit in a Streaming Stack?]{kind="recap"}
A production stack separates ingestion, stateful feature work, inference, result publication, and action, then evaluates guarantees across the full chain.
:::

:::expand[How Do Replay, Model Versions, Revisions, Monitoring, and Recovery Work Together?]{kind="recap"}
Designed replay needs model identity, revision semantics, time-aware monitoring, and interruption tests so recovery does not create contradictory predictions.
:::

:::expand[How Does the Complete Streaming System Differ from an Online Request API?]{kind="recap"}
Streaming continuously advances state and event history, whereas an online API usually treats each request as an immediate interaction.
:::

## References

[1]: https://kafka.apache.org/40/design/design/ "Design | Apache Kafka"
[2]: https://nightlies.apache.org/flink/flink-docs-stable/docs/learn-flink/overview/ "Overview | Apache Flink"
[3]: https://nightlies.apache.org/flink/flink-docs-stable/docs/learn-flink/fault_tolerance/ "Fault Tolerance | Apache Flink"
[4]: https://nightlies.apache.org/flink/flink-docs-stable/api/java/org/apache/flink/streaming/api/CheckpointingMode.html "CheckpointingMode (Flink : 2.3-SNAPSHOT API)"
[5]: https://nightlies.apache.org/flink/flink-docs-master/api/java/org/apache/flink/api/common/eventtime/Watermark.html "Watermark (Flink : 2.4-SNAPSHOT API)"
[6]: https://nightlies.apache.org/flink/flink-docs-stable/docs/ops/debugging/debugging_event_time/ "Debugging Windows  Event Time | Apache Flink"
