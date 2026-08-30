---
title: "Choosing Serving Patterns"
description: "Connect latency, freshness, cost, and product requirements."
overview: "Choosing a serving pattern means deciding where predictions run, how fresh they must be, how fast the product needs an answer, and which operational system owns the endpoint, queue, job, stream, or device runtime."
tags: ["MLOps", "core", "inference"]
order: 1
id: "article-mlops-model-serving-choosing-serving-pattern"
aliases:
  - roadmaps/mlops/modules/model-serving/inference-patterns/03-choosing-serving-pattern.md
  - child-inference-patterns-03-choosing-serving-pattern
---

## Table of Contents

1. [What Timing and Request Pattern Does a Serving Design Need to Satisfy?](#what-timing-and-request-pattern-does-a-serving-design-need-to-satisfy)
2. [How Do Synchronous, Asynchronous, Batch, Streaming, and Precomputed Inference Differ?](#how-do-synchronous-asynchronous-batch-streaming-and-precomputed-inference-differ)
3. [When Does Freshness or Device Locality Matter More than Network Latency?](#when-does-freshness-or-device-locality-matter-more-than-network-latency)
4. [How Do Traffic, Throughput, Latency, and Placement Shape the Economics?](#how-do-traffic-throughput-latency-and-placement-shape-the-economics)
5. [What Decision Order Selects a Serving Pattern?](#what-decision-order-selects-a-serving-pattern)
6. [Why Are Hybrid Architectures and Several Infrastructure Layers Normal?](#why-are-hybrid-architectures-and-several-infrastructure-layers-normal)
7. [Where Does Each Serving Pattern Move Its Complexity?](#where-does-each-serving-pattern-move-its-complexity)
8. [When Should the Product Revisit Its Serving Pattern?](#when-should-the-product-revisit-its-serving-pattern)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A fraud decision must return before a payment is authorized. A nightly recommendation list can be computed hours earlier, while a document-analysis job may take several minutes after upload. All three systems run inference, but they need different schedules.

A **serving pattern** decides when inference runs, how work arrives, where the computation happens, and how the result reaches the consumer. The right choice follows from the decision deadline, freshness, traffic shape, interaction model, failure tolerance, privacy, and cost.

Use these questions to choose the logical pattern before selecting infrastructure or optimization tools:

1. **What Timing and Request Pattern Does a Serving Design Need to Satisfy?**
2. **How Do Synchronous, Asynchronous, Batch, Streaming, and Precomputed Inference Differ?**
3. **When Does Freshness or Device Locality Matter More than Network Latency?**
4. **How Do Traffic, Throughput, Latency, and Placement Shape the Economics?**
5. **What Decision Order Selects a Serving Pattern?**
6. **Why Are Hybrid Architectures and Several Infrastructure Layers Normal?**
7. **Where Does Each Serving Pattern Move Its Complexity?**
8. **When Should the Product Revisit Its Serving Pattern?**

## What Timing and Request Pattern Does a Serving Design Need to Satisfy?
<!-- section-summary: A serving pattern schedules inference around the decision deadline, request arrival, freshness need, response path, and acceptable cost. -->

Serving begins with the moment a prediction can still influence a decision, not with a preferred platform.

A model is useful only when its prediction becomes available **at the moment a product or another system can use it**. That gives us the first-principles view of model serving:

> **Model serving is the problem of scheduling inference so that the right prediction exists at the right place, before its usefulness expires, at an acceptable cost.**

Everything people call *real-time inference, batch inference, asynchronous inference, streaming inference, precomputed predictions,* or *edge inference* is a different solution to that scheduling problem. Suppose we have a model

$$
y = f(x)
$$

Training gives us $$f$$. Serving has to answer a different question:

$$
\text{When, where, and under what conditions should } f(x) \text{ be computed?}
$$

For every prediction, there are roughly four moments:

```text
input becomes known
        │
        ▼
inference can begin
        │
        ▼
prediction becomes available
        │
        ▼
decision uses prediction
```

A serving architecture controls the gaps between those events. For example, imagine a fraud model.

```text
Customer clicks "Pay"
        ↓
Transaction information becomes known
        ↓
Fraud model runs
        ↓
Risk score produced
        ↓
Payment accepted/rejected
```

The prediction must exist **before the payment decision**. Now compare that with customer-churn prediction:

```text
Nightly warehouse snapshot
        ↓
Predict churn for 20 million customers
        ↓
Store predictions
        ↓
Marketing system reads them tomorrow
```

The model may be exactly as complicated, but the serving architecture should be completely different. So don't start with:

"Should we use Kubernetes, Kafka, Triton, or Spark?"

Start with:

**When must the prediction exist?**

Let

$$
D = \text{maximum useful time between input availability and prediction availability}
$$

This is the **decision deadline**. For an interactive product:

$$
D \approx 100\text{ ms} - \text{a few seconds}
$$

For document processing:

$$
D \approx \text{seconds or minutes}
$$

For overnight recommendations:

$$
D \approx \text{hours}
$$

For monthly forecasting:

$$
D \approx \text{days}
$$

Now decompose serving latency:

$$
L =
L_{network}
+
L_{queue}
+
L_{preprocess}
+
L_{inference}
+
L_{postprocess}
+
L_{network-return}
$$

Your serving architecture is feasible only if approximately

$$
P99(L) \le D
$$

Notice the **P99**. Average latency is often nearly irrelevant. If your checkout model usually takes 40 ms but occasionally takes 3 seconds, customers experience the 3-second version. So the serving question is not merely:

"How fast is the model?"

It is:

"Can the entire system reliably finish before the decision deadline?"

Two systems with identical latency requirements can still need different serving patterns because their workloads arrive differently. Imagine 1 million predictions.

### Workload A

They arrive gradually:

```text
request
   request
      request
  request
       request
```

Maybe 100 requests per second.

### Workload B

They already exist as a dataset:

```text
1,000,000 rows
available simultaneously
```

These workloads should not necessarily use the same architecture. A few properties matter especially.

| Property            | Question                                                             |
| ------------------- | -------------------------------------------------------------------- |
| Arrival pattern     | Individual requests, bursts, continuous events, or bounded datasets |
| Deadline            | Milliseconds, seconds, minutes, hours                               |
| Work per prediction | Tiny classifier or expensive generative model                       |
| Reuse               | Will many consumers want the same prediction                        |
| Freshness           | How old may a prediction be                                         |
| State               | Does prediction depend on previous events                           |
| Locality            | Where does the input data live                                      |
| Connectivity        | Is a network connection guaranteed                                  |

From these constraints the serving pattern starts to emerge.

## How Do Synchronous, Asynchronous, Batch, Streaming, and Precomputed Inference Differ?
<!-- section-summary: Synchronous, asynchronous, batch, streaming, and precomputed inference differ in who waits, how work arrives, and when results must exist. -->

Once the deadline and arrival pattern are clear, the common serving modes can be compared by who waits and how work is scheduled.

There isn't a universal law saying there must be exactly six. A useful production taxonomy is:

| Pattern                        | When inference happens        |                Caller waits | Typical use                               |
| ------------------------------ | ----------------------------- | ---------------------------: | ----------------------------------------- |
| **Synchronous online**         | On request                    |                          Yes | Search ranking, fraud, interactive APIs   |
| **Asynchronous**               | After a submitted request     |                           No | Document processing, expensive generation |
| **Batch**                      | Over a bounded dataset        |                           No | Nightly scoring, embeddings, forecasts    |
| **Streaming / event-driven**   | As events continuously arrive |                   Usually no | Fraud streams, anomaly detection          |
| **Precomputed / materialized** | Before the request            | No inference at request time | Recommendations, risk scores              |
| **Edge / on-device**           | Near the user/data            |                      Depends | Camera, speech, mobile personalization    |

These aren't perfectly orthogonal. Edge describes **placement**, while batch/online/streaming mostly describe **timing**. That's intentional: production architectures frequently combine them. The simplest mental model is:

```text
Client
  │
  │ request x
  ▼
Model service
  │
  │ f(x)
  ▼
prediction y
  │
  ▼
Client continues
```

The caller is blocked until inference completes. Think:

```python
prediction = model_service.predict(x)
do_something(prediction)
```

This is appropriate when the prediction depends on information that became known **right now** and the decision also needs to happen **right now**. Examples include search ranking, authorization, fraud checks, recommendation reranking and interactive LLM requests. Its fundamental constraint is

$$
L_{end-to-end} < D
$$

Because the deadline is tight, synchronous serving forces you to care about things like capacity reservations, autoscaling, overload protection, tail latency and cold starts. There's an important optimization here: **synchronous doesn't mean one request per GPU execution**. An inference server can briefly collect concurrent requests:

```text
r1 ─┐
r2 ─┼──► batch ──► GPU
r3 ─┤
r4 ─┘
```

This is dynamic batching. NVIDIA Triton, for example, can dynamically combine requests to increase throughput while limiting how long requests wait for a batch. ([NVIDIA Docs][1]) So:

**Serving pattern and hardware batching strategy are different decisions.**

Sometimes the input becomes known now, but the answer doesn't have to return in the current request.

Instead:

```text
Client
   │
   │ submit job
   ▼
 Queue
   │
   ▼
Inference workers
   │
   ▼
Result store
   │
   ▼
Client polls / webhook / event
```

The API might behave like:

```text
POST /generate-report

→ 202 Accepted
→ job_id = 83921
```

Later:

```text
GET /jobs/83921

→ completed
```

This is useful when

$$
T_{inference} \gg \text{reasonable HTTP request time}
$$

or when workload bursts shouldn't immediately force massive compute provisioning. The queue fundamentally changes the system. Without a queue:

```text
incoming traffic → required compute immediately
```

With a queue:

```text
incoming traffic → backlog → compute processes backlog
```

You have exchanged **latency for elasticity**. That is often a very good trade. The operational problems also change. Instead of obsessing only over millisecond latency, you now care about retries, duplicate processing, job status, priority, timeouts, idempotency and dead-letter handling. Now suppose nobody actually generates individual prediction requests. Instead you already have:

```text
customers.parquet

customer_1
customer_2
customer_3
...
customer_20,000,000
```

Running an HTTP request twenty million times is usually solving the wrong problem. You have a bounded dataset:

$$
X=\{x_1,x_2,\ldots,x_N\}
$$

so compute

$$
Y=f(X)
$$

as a data-processing job.

```text
Data lake / warehouse
        │
        ▼
     partitions
   ┌────┼────┐
   ▼    ▼    ▼
 worker worker worker
   │    │    │
   └────┼────┘
        ▼
 prediction table
```

Because users aren't waiting for each item, the system can optimize primarily for

$$
\text{throughput}
$$

rather than individual-request latency. That permits large batches, cheaper compute, aggressive parallelization and better accelerator utilization. AWS Batch illustrates the general queue-and-compute model: jobs wait in queues until capacity is available in an appropriate compute environment. ([AWS Documentation][2]) Batch is therefore often the cheapest architecture when the product deadline permits it. Consider credit-card activity. There isn't a fixed dataset:

```text
transaction
transaction
transaction
transaction
...
```

The input is conceptually unbounded. You want:

```text
event stream
     │
     ▼
feature/state computation
     │
     ▼
model
     │
     ▼
prediction event
```

The important difference from an HTTP service is **who is waiting**. With synchronous serving:

```text
caller → prediction → caller continues
```

With streaming:

```text
event → prediction → another event
```

The producer generally doesn't block waiting for the model. Streaming is particularly useful for predictions that depend on accumulated state.

For example:

$$
\text{fraud risk}
=
f(
\text{transaction},
\text{transactions in previous 10 minutes},
\text{customer state}
)
$$

Now the architecture may maintain state continuously:

```text
transaction events
       ↓
last-10-minute state
       ↓
feature calculation
       ↓
model
       ↓
fraud event
```

Kafka is commonly used as the durable event backbone, while stream processors such as Flink can continuously process stateful event streams. Flink also explicitly distinguishes event time from processing time, which matters for late or out-of-order events. ([Apache Kafka][3]) This is one of the most important patterns because sometimes the best way to serve a model is:

**Don't run the model when the request arrives.**

Suppose your product needs a "likelihood to purchase" score for each customer. You could do:

```text
request
  ↓
load customer data
  ↓
run model
  ↓
return score
```

But imagine each customer receives 100 page views per day while their purchasing propensity changes slowly.

Instead:

```text
every hour
   ↓
score every customer
   ↓
store score
```

Then:

```text
request
   ↓
lookup score
   ↓
return
```

Inference latency disappears from the request path. The important equation is reuse. Let

$$
R = \text{number of requests}
$$

and

$$
E = \text{number of unique entities that need predictions}
$$

If

$$
R \gg E
$$

then repeatedly calculating predictions may be wasteful.

For example:

$$
R=100\,000\,000\text{ page views/day}
$$

but only

$$
E=2\,000\,000\text{ customers}.
$$

Precomputing two million scores may replace tens of millions of repeated inferences. But you've paid for that efficiency with **staleness**. Which leads to an extremely important variable.

![Six concrete product promises map to synchronous online, asynchronous queue, batch, streaming, edge, and hybrid serving patterns](/content-assets/articles/article-mlops-model-serving-choosing-serving-pattern/serving-pattern-product-promises.png)

*The useful pattern follows the actor, deadline, and arrival shape: a payment caller waits, a document enters a durable job queue, a known population runs as a batch, events update state, a disconnected device runs locally, and hybrid work crosses deliberate boundaries.*

## When Does Freshness or Device Locality Matter More than Network Latency?
<!-- section-summary: A prediction can need fresh data or local execution even when raw server latency appears acceptable, especially at the edge or without connectivity. -->

Latency is only one clock; some systems care more about data freshness or placing the decision on the device itself.

Define

$$
F = \text{maximum acceptable age of a prediction}
$$

Suppose recommendation scores may be 30 minutes old. Then

$$
F=30\text{ minutes}.
$$

You don't necessarily need online inference. Perhaps:

```text
every 10 minutes
    ↓
recompute recommendations
    ↓
store results
```

is perfectly adequate. Conversely, fraud detection may have

$$
F \approx 0
$$

because the current transaction itself changes the answer. A useful mental matrix is therefore:

|                             | **Low freshness requirement** | **Very fresh data required** |
| --------------------------- | ----------------------------- | ---------------------------- |
| **Tight decision deadline** | Precompute/cache              | Sync online / edge           |
| **Moderate deadline**       | Precompute or batch           | Async                        |
| **Continuous events**       | Periodic materialization      | Streaming                    |
| **Long deadline**           | Batch                         | Batch using newest snapshot  |

This is why starting with "real time sounds better" is dangerous. Real time usually costs more. Use it when the product actually requires it. So far we've assumed:

```text
device → network → server → model
```

But suppose the input is a camera frame. Sending every frame to a server introduces

$$
L_{network}
$$

and may introduce privacy, bandwidth and connectivity problems.

Instead:

```text
camera
   ↓
model on device
   ↓
prediction
```

Now

$$
L_{network}\approx0
$$

for inference. This can be ideal for computer vision, speech recognition, sensor processing, mobile personalization, robotics and disconnected environments. But the constraints move elsewhere:

```text
Cloud:
large GPU
lots of memory
central deployment

Edge:
limited RAM
limited power
limited compute
many device types
harder model upgrades
```

So models may need quantization, compression or hardware-specific optimization. Modern runtimes explicitly target this use case. ONNX Runtime Mobile supports inference on iOS and Android, while Google's LiteRT targets on-device ML and GenAI across edge hardware. ([ONNX Runtime][4]) And remember:

> **Edge is a placement decision, not necessarily an interaction pattern.**

You might have synchronous edge inference:

```text
photo → classifier → result
```

or streaming edge inference:

```text
camera frame
camera frame
camera frame
     ↓
continuous detection
```

## How Do Traffic, Throughput, Latency, and Placement Shape the Economics?
<!-- section-summary: Traffic shape, batching, utilization, queueing, and placement determine the latency-throughput-cost trade rather than pattern names alone. -->

Those timing requirements interact with traffic and utilization, which determine whether the pattern is economically sustainable.

Suppose a model requires 10 ms of GPU time. At first glance you might estimate maximum throughput as

$$
100\text{ predictions/sec}.
$$

Real systems are more complicated because batching and concurrency matter, but the important quantity remains:

$$
\text{utilization}
=
\frac{\text{useful inference compute}}
{\text{available inference compute}}
$$

Imagine traffic looks like:

```text
requests/sec

1000 |             █
 800 |             █
 600 |        █    █
 400 |    █   █    █
 200 | █  █   █ █  █
   0 +----------------
```

A synchronous system must maintain enough capacity for peaks if it wants tight latency. So you may provision near:

$$
C_{peak}
$$

while average demand is only

$$
C_{avg}.
$$

Your utilization becomes roughly

$$
U \approx \frac{C_{avg}}{C_{provisioned}}.
$$

If demand averages 20 GPUs but you need 80 GPUs available for peak latency:

$$
U\approx25\%.
$$

Queues change this. If the deadline is loose, work can accumulate during peaks and execute later:

```text
burst
 ↓
queue ███████████
       ↓↓↓↓↓
constant worker pool
```

Now provisioning can move closer to average load. That is why, in general,

```text
tight latency
    ↓
extra capacity
    ↓
lower utilization
    ↓
higher cost
```

while

```text
loose latency
    ↓
batching / queueing
    ↓
higher utilization
    ↓
lower cost
```

Imagine a GPU runs one example in 8 ms. Four examples individually:

$$
4\times8=32\text{ ms}
$$

Perhaps a batch of four takes only 12 ms. Then throughput improves substantially. But the first request may have to wait for others:

```text
request 1 ─────────┐
request 2 ──────┐  │
request 3 ───┐  │  │
request 4 ─┐ │  │  │
           ▼ ▼  ▼  ▼
             batch
```

So you trade

$$
\text{queue delay}
$$

for

$$
\text{compute efficiency}.
$$

This trade-off exists throughout serving:

$$
\boxed{\text{latency} \leftrightarrow \text{utilization} \leftrightarrow \text{cost}}
$$

There is rarely a serving architecture that simultaneously minimizes all three. Another common mistake is deciding infrastructure first:

"Should this run on Kubernetes?"

That's downstream of the real decision. First determine:

```text
decision deadline
      ↓
freshness requirement
      ↓
arrival pattern
      ↓
computation size
      ↓
reuse opportunity
```

Then determine placement:

```text
cloud
regional datacenter
customer environment
browser
mobile device
embedded device
```

Placement is largely controlled by four forces:

$$
\text{latency}+\text{data locality}+\text{privacy}+\text{compute availability}.
$$

For example:

```text
Very large model
+ tiny phone
→ probably cloud

Camera frames
+ privacy requirement
+ capable NPU
→ probably device

Huge warehouse dataset
→ compute near warehouse

Interactive service
+ GPU cluster
→ regional/cloud inference service
```

## What Decision Order Selects a Serving Pattern?
<!-- section-summary: A deliberate decision tree starts from the product deadline and arrivals, then considers freshness, interaction, scale, privacy, and failure tolerance. -->

The tradeoffs become manageable when the team follows a fixed decision order rather than choosing from product labels.

A practical serving decision can therefore be made in this order:

1. **Identify the decision.** What consumes the prediction
2. **Set its deadline $$D$$.** When does the prediction become useless
3. **Set freshness $$F$$.** How old may the input or prediction be
4. **Inspect arrivals.** Individual requests, continuous events, or bounded datasets
5. **Measure computation.** Can inference reliably finish inside the deadline
6. **Look for reuse.** Could one prediction satisfy many future requests
7. **Choose placement.** Does data/privacy/connectivity require edge or local execution
8. **Estimate traffic.** Average rate, peak rate, burstiness and concurrency.
9. **Choose the cheapest architecture satisfying the above constraints.**
10. **Benchmark the complete system at P95/P99, not merely the model kernel.**

That order prevents a surprising amount of unnecessary infrastructure. You can compress most of the reasoning into this:

```text
                         Prediction needed
                                │
                                ▼
                  Does it depend on new information
                     │                     │
                    NO                    YES
                     │                     │
                     ▼                     ▼
               PRECOMPUTE          How soon is it needed
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              milliseconds      seconds        hours
                    │              │              │
                    ▼              ▼              ▼
              SYNC / EDGE        ASYNC          BATCH

But:

Are inputs a continuous event stream
             │
            YES
             │
             ▼
         STREAMING

Does data need to remain on device,
or must inference work offline
             │
            YES
             │
             ▼
           EDGE
```

And real systems commonly combine branches.

![Five primary serving patterns compared by their health signal, failure unit, and recovery responsibility, with hybrid systems inheriting every path they combine](/content-assets/articles/article-mlops-model-serving-choosing-serving-pattern/serving-pattern-operating-work.png)

*Online, queue, batch, streaming, and edge contracts give on-call teams different clocks and recovery units. A hybrid owns all of the duties created by its component paths.*

## Why Are Hybrid Architectures and Several Infrastructure Layers Normal?
<!-- section-summary: Real products combine patterns and map the logical timing choice onto queues, jobs, services, streams, devices, and storage. -->

A single pattern rarely covers every path, so hybrid designs and multiple infrastructure components are expected.

Consider recommendations. You might compute candidate recommendations nightly:

```text
BATCH
users × products
      ↓
top 500 candidates/user
```

Then store them:

```text
PRECOMPUTE
candidate store
```

When the user opens the app:

```text
SYNC
current context
      +
cached candidates
      ↓
online reranker
      ↓
top 20
```

Meanwhile user interactions flow through:

```text
STREAMING
click/view/purchase events
        ↓
real-time features
```

So one product can simultaneously contain:

```text
batch
+ streaming
+ precomputation
+ synchronous inference
```

This is often better than forcing the entire ML system into one serving model. Don't interpret these as mandatory stacks; they're examples of how today's systems implement the underlying patterns.

| Pattern     | Typical architecture                                               |
| ----------- | ------------------------------------------------------------------ |
| Synchronous | API gateway → inference service → CPU/GPU replicas                 |
| Async       | API → durable queue → workers → result store                       |
| Batch       | Orchestrator → distributed compute → warehouse/object store        |
| Streaming   | Kafka-like log → stream processor → inference → output topic/store |
| Precompute  | Batch/stream inference → DB/feature store/cache                    |
| Edge        | App/device → local inference runtime                               |

For Kubernetes-centric online serving, KServe provides inference services and more specialized generative serving primitives, while Ray Serve supports scalable online inference, model composition, batching and streaming responses. ([KServe][5]) For GPU-heavy services, Triton provides scheduling and dynamic batching primitives. ([NVIDIA Docs][1]) For continuous stateful processing, stacks commonly combine an event log such as Kafka with a stream processor such as Flink. ([Apache Kafka][3]) For mobile and edge deployment, ONNX Runtime Mobile and LiteRT are representative runtimes. ([ONNX Runtime][6]) The product requirement should choose among these tools—not the reverse.

## Where Does Each Serving Pattern Move Its Complexity?
<!-- section-summary: Every pattern simplifies one boundary while creating operational work elsewhere, and inference-engine optimization remains a separate decision. -->

Each choice moves complexity between callers, queues, storage, services, and devices, while engine tuning solves a different layer.

There is no free serving pattern.

| Pattern        | Main thing you optimize  | Main operational burden              |
| -------------- | ------------------------ | ------------------------------------ |
| **Sync**       | Immediate answers        | P99 latency, autoscaling, overload   |
| **Async**      | Elastic expensive work   | Queues, retries, idempotency         |
| **Batch**      | Cost and throughput      | Scheduling, partitioning, backfills  |
| **Streaming**  | Fresh continuous state   | Ordering, state, replay, late events |
| **Precompute** | Extremely cheap reads    | Staleness, refreshes, invalidation   |
| **Edge**       | Locality/privacy/latency | Device compatibility and rollout     |

This is a useful engineering principle:

**You don't eliminate complexity. You choose where you want complexity to live.**

For example, precomputation removes model latency from the request path but creates cache-refresh complexity. Async removes strict execution latency but creates job-management complexity. Edge removes network dependency but creates model-distribution complexity. Especially with LLMs, you'll hear terms such as:

```text
continuous batching
tensor parallelism
pipeline parallelism
prefill/decode disaggregation
prefix-aware routing
KV-cache routing
```

These are important, but they answer a lower-level question:

**How should an inference cluster execute requests efficiently?**

They don't usually answer the higher-level product question:

**When should the product request inference?**

For example:

```text
Product architecture:
SYNCHRONOUS

        ↓

Serving layer:
Ray Serve / KServe

        ↓

Inference engine:
vLLM / Triton / etc.

        ↓

Execution optimizations:
continuous batching
tensor parallelism
prefill/decode separation
```

Modern Ray Serve LLM documentation, for example, uses "serving patterns" for techniques such as data-parallel attention and prefill/decode disaggregation. Those are valuable cluster-level patterns, but they're a different abstraction layer from the six application-level patterns discussed here. ([Ray][7]) Keeping those layers separate makes architecture conversations much clearer.

## When Should the Product Revisit Its Serving Pattern?
<!-- section-summary: Serving choices should change when deadlines, traffic, freshness, cost, privacy, or product interaction change. -->

The selected pattern is a product assumption that needs review as the workload and value deadline evolve.

The best pattern at launch may be completely wrong a year later. Imagine an application starts with 1,000 predictions/day. A synchronous service is simple:

```text
API → model
```

Then it grows to 100 million predictions/day. You discover that 90% of requests repeatedly ask for predictions about the same entities. Now:

```text
batch/stream
     ↓
precompute
     ↓
cache
     ↓
API lookup
```

might be dramatically cheaper. Or perhaps a nightly fraud model starts losing money because attacks happen faster.

Then:

```text
nightly batch
```

may need to become:

```text
streaming features
       +
online inference
```

Serving architecture therefore isn't a permanent property of a model. It is a property of the relationship between

$$
\boxed{
\text{model}
+
\text{product}
+
\text{data}
+
\text{traffic}
+
\text{hardware}
}
$$

and all five change over time. If you remember only one framework, use this:

```text
                     WHEN IS THE INPUT KNOWN
                              │
                              ▼
                     WHEN IS THE OUTPUT NEEDED
                              │
                              ▼
                     HOW FRESH MUST IT BE
                              │
                              ▼
              HOW EXPENSIVE IS IT TO COMPUTE
                              │
                              ▼
              CAN THE RESULT BE REUSED
                              │
                              ▼
                  WHERE CAN IT BE COMPUTED
                              │
                              ▼
                 WHAT DOES TRAFFIC LOOK LIKE
                              │
                              ▼
                   choose serving pattern
```

And the resulting intuition is:

$$
\boxed{
\begin{aligned}
\text{need answer immediately} &\rightarrow \text{synchronous} \\
\text{can wait for a job} &\rightarrow \text{asynchronous} \\
\text{many bounded records} &\rightarrow \text{batch} \\
\text{continuous events} &\rightarrow \text{streaming} \\
\text{same answer reused} &\rightarrow \text{precompute} \\
\text{data/decision belongs locally} &\rightarrow \text{edge}
\end{aligned}}
$$

The deeper principle is simpler:

**Choose the least real-time, least distributed, least operationally complex serving architecture that still delivers a sufficiently fresh prediction before the decision deadline.**

That principle tends to produce systems that are cheaper, easier to operate, and easier to evolve.

![Six-step serving-pattern selection starts with the product actor and action, then evaluates deadline, arrival shape, freshness, constraints, and failure policy before choosing a delivery contract and runtime](/content-assets/articles/article-mlops-model-serving-choosing-serving-pattern/serving-pattern-selection-summary.png)

*The delivery contract is a product promise. Runtime and tool selection comes after the team can state who acts, when the answer is useful, how work arrives, and what happens when the path fails.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Timing and Request Pattern Does a Serving Design Need to Satisfy?]{kind="recap"}
A serving pattern schedules inference around the decision deadline, request arrival, freshness need, response path, and acceptable cost.
:::

:::expand[How Do Synchronous, Asynchronous, Batch, Streaming, and Precomputed Inference Differ?]{kind="recap"}
Synchronous, asynchronous, batch, streaming, and precomputed inference differ in who waits, how work arrives, and when results must exist.
:::

:::expand[When Does Freshness or Device Locality Matter More than Network Latency?]{kind="recap"}
A prediction can need fresh data or local execution even when raw server latency appears acceptable, especially at the edge or without connectivity.
:::

:::expand[How Do Traffic, Throughput, Latency, and Placement Shape the Economics?]{kind="recap"}
Traffic shape, batching, utilization, queueing, and placement determine the latency-throughput-cost trade rather than pattern names alone.
:::

:::expand[What Decision Order Selects a Serving Pattern?]{kind="recap"}
A deliberate decision tree starts from the product deadline and arrivals, then considers freshness, interaction, scale, privacy, and failure tolerance.
:::

:::expand[Why Are Hybrid Architectures and Several Infrastructure Layers Normal?]{kind="recap"}
Real products combine patterns and map the logical timing choice onto queues, jobs, services, streams, devices, and storage.
:::

:::expand[Where Does Each Serving Pattern Move Its Complexity?]{kind="recap"}
Every pattern simplifies one boundary while creating operational work elsewhere, and inference-engine optimization remains a separate decision.
:::

:::expand[When Should the Product Revisit Its Serving Pattern?]{kind="recap"}
Serving choices should change when deadlines, traffic, freshness, cost, privacy, or product interaction change.
:::

## References

[1]: https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/batcher.html "Batchers — NVIDIA Triton Inference Server"
[2]: https://docs.aws.amazon.com/batch/latest/userguide/job_queues.html "Job queues - AWS Batch"
[3]: https://kafka.apache.org/documentation/ "Introduction | Apache Kafka"
[4]: https://onnxruntime.ai/docs/tutorials/mobile/ "Deploy on mobile | onnxruntime"
[5]: https://kserve.github.io/website/docs/admin-guide/overview "Administrator Guide | KServe"
[6]: https://onnxruntime.ai/docs/get-started/with-mobile.html "Mobile | onnxruntime"
[7]: https://docs.ray.io/en/latest/serve/llm/architecture/overview.html "Architecture overview — Ray 2.58.0"
