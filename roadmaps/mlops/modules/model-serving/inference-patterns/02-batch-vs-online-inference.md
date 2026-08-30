---
title: "Operating Batch and Online Inference"
description: "Operate batch jobs and online APIs through shared model identity, freshness, contracts, capacity, failure recovery, and dual-path consistency."
overview: "Batch and online inference give prediction systems different timing, data, scaling, output, and recovery contracts, while many products deliberately combine both paths."
tags: ["MLOps", "core", "inference"]
order: 2
id: "article-mlops-model-serving-batch-vs-online-inference"
aliases:
  - roadmaps/mlops/modules/model-serving/inference-patterns/01-batch-vs-online-inference.md
  - child-inference-patterns-01-batch-vs-online-inference
---

## Table of Contents

1. [How Do Deadlines Distinguish Batch from Online Inference?](#how-do-deadlines-distinguish-batch-from-online-inference)
2. [Why Do Batch and Online Systems Pay Different Capacity Costs?](#why-do-batch-and-online-systems-pay-different-capacity-costs)
3. [How Do Data Engineering, Idempotency, and Lineage Make Batch Inference Reliable?](#how-do-data-engineering-idempotency-and-lineage-make-batch-inference-reliable)
4. [How Do Request Reliability, Overload, Loading, and Autoscaling Make Online Inference Reliable?](#how-do-request-reliability-overload-loading-and-autoscaling-make-online-inference-reliable)
5. [How Can Both Paths Preserve the Same Model and Feature Meaning?](#how-can-both-paths-preserve-the-same-model-and-feature-meaning)
6. [How Do Monitoring, Replay, Redundancy, and Retries Differ between the Paths?](#how-do-monitoring-replay-redundancy-and-retries-differ-between-the-paths)
7. [How Do Releases, Migrations, and Cascades Combine Batch and Online Inference?](#how-do-releases-migrations-and-cascades-combine-batch-and-online-inference)
8. [What Decision Framework Chooses the Right Operating Path?](#what-decision-framework-chooses-the-right-operating-path)
9. [Check Your Answers](#check-your-answers)

A retailer can score tomorrow's catalogue overnight and serve those predictions from a table in milliseconds. A payment authorization cannot wait for a nightly job; it needs a live decision while the customer is still at checkout.

**Batch inference** processes a known body of work by a completion deadline. **Online inference** serves a waiting request under a much shorter response deadline. That timing difference changes capacity, queues, data contracts, recovery, monitoring, and release behaviour even when both paths use the same model artifact.

These questions compare the two operating models and show where hybrid designs provide a better answer:

1. **How Do Deadlines Distinguish Batch from Online Inference?**
2. **Why Do Batch and Online Systems Pay Different Capacity Costs?**
3. **How Do Data Engineering, Idempotency, and Lineage Make Batch Inference Reliable?**
4. **How Do Request Reliability, Overload, Loading, and Autoscaling Make Online Inference Reliable?**
5. **How Can Both Paths Preserve the Same Model and Feature Meaning?**
6. **How Do Monitoring, Replay, Redundancy, and Retries Differ between the Paths?**
7. **How Do Releases, Migrations, and Cascades Combine Batch and Online Inference?**
8. **What Decision Framework Chooses the Right Operating Path?**

## How Do Deadlines Distinguish Batch from Online Inference?
<!-- section-summary: Batch work has a completion deadline across available records, while online work has a waiting decision and a per-request latency deadline. -->

The clearest distinction is whether a waiting decision needs one response now or a set of predictions needs completion by a later deadline.

The easiest way to understand batch and online inference is to stop thinking of them as two different kinds of machine learning. The model may be identical:

$$
y=f(x)
$$

What changes is **when the system is required to produce $$y$$**. That gives us the core distinction:

> **Batch inference computes predictions because a schedule or dataset says work is ready. Online inference computes predictions because a live decision is waiting for the answer.**

From that difference follow almost all of their architectural and operational differences. Suppose a product needs a prediction. There are three important times:

$$
t_{input}=\text{when the required input becomes available}
$$

$$
t_{prediction}=\text{when the prediction becomes available}
$$

$$
t_{decision}=\text{when the product must make its decision}
$$

For the prediction to be useful:

$$
t_{prediction} \le t_{decision}
$$

Define the available inference window:

$$
D=t_{decision}-t_{input}
$$

This $$D$$ is the fundamental serving constraint. If:

$$
D=50\text{ ms}
$$

you almost certainly need online inference. If:

$$
D=8\text{ hours}
$$

batch inference may be perfectly adequate. For example, consider a payment fraud decision:

```text
transaction happens
       ↓
features become known
       ↓
model scores transaction
       ↓
approve / decline payment
```

The payment cannot reasonably wait until tonight. Now consider a sales team that needs a list of likely-to-churn customers each morning:

```text
midnight data snapshot
       ↓
score customers overnight
       ↓
write prediction table
       ↓
sales team uses it at 9 AM
```

Here, computing each prediction synchronously at 9 AM would usually add complexity without improving the product. So before asking:

"Batch or online?"

ask:

**How long can the decision wait after the necessary information becomes available?**

Batch inference begins because some **collection of inputs is ready to process**. Suppose the warehouse contains:

```text
customer_id | purchases | sessions | tenure | ...
--------------------------------------------------
1           | ...
2           | ...
3           | ...
...
20,000,000
```

The system effectively computes:

$$
Y=f(X)
$$

where

$$
X=\{x_1,x_2,\ldots,x_N\}
$$

and produces:

$$
Y=\{f(x_1),f(x_2),\ldots,f(x_N)\}
$$

The architecture might look like:

```text
Warehouse / Object Store
          │
          ▼
     batch scheduler
          │
          ▼
   feature computation
          │
          ▼
     model inference
          │
          ▼
   prediction dataset
          │
          ▼
 warehouse / database
```

The prediction becomes a **data product**.

For example:

```text
customer_id | churn_probability | model_version | scored_at
----------------------------------------------------------------
1001        | 0.82              | churn_v17     | 02:14
1002        | 0.13              | churn_v17     | 02:14
...
```

Applications later read those results. The important consequence is that users aren't normally blocked while each row is computed. That changes what the system should optimize. Instead of primarily optimizing:

$$
\text{latency per prediction}
$$

you often optimize:

$$
\text{predictions per unit time}
$$

and:

$$
\text{cost per prediction}
$$

Online inference reverses the relationship. The prediction is not produced because a dataset happened to be ready. It is produced because **something is waiting**.

```text
user / service
      │
      │ request
      ▼
 feature lookup
      │
      ▼
 model service
      │
      ▼
 prediction
      │
      ▼
 decision
```

For example:

```text
GET /search?q=running+shoes
```

The application might retrieve candidate products and ask a ranking model:

$$
score_i=f(user,query,item_i,current\ context)
$$

The user is waiting for the page. Consequently:

$$
L_{request}
=
L_{network}
+
L_{features}
+
L_{queue}
+
L_{inference}
+
L_{postprocess}
$$

must satisfy something like:

$$
P99(L_{request}) < D
$$

The P99 is important. Suppose latency is:

```text
50% of requests:   30 ms
90%:               45 ms
99%:              400 ms
99.9%:              4 s
```

An average of 35 ms might look excellent while the actual user experience is terrible during tail events. Online inference therefore creates pressure around:

```text
tail latency
capacity
concurrency
timeouts
autoscaling
overload
dependency failures
```

Batch inference experiences many of the same underlying failures, but the operational priority is different because nobody is usually blocking on an individual prediction. This distinction is subtle but important. Suppose nightly inference processes 100 million customers. Maybe no individual prediction needs to finish within 50 ms. But the **whole job must finish before 06:00**. So batch systems have deadlines too. If the job starts at midnight:

$$
T_{available}=6\text{ hours}
$$

and you have:

$$
N=100\,000\,000
$$

predictions to compute, then your required average throughput is at least:

$$
Q=\frac{N}{T_{available}}
$$

which gives approximately:

$$
Q \approx 4,630 \text{ predictions/sec}
$$

before accounting for retries, data loading, skew, failures and output writes. So batch doesn't mean:

"Performance doesn't matter."

It means performance is generally measured at the **job level** rather than the individual-request level. Online asks:

$$
\text{Did this request finish quickly enough?}
$$

Batch asks:

$$
\text{Did the entire required dataset finish before its publication deadline?}
$$

This is one of the most important distinctions in serving systems.

### Latency

Latency measures:

$$
\text{request received}
\rightarrow
\text{prediction returned}
$$

Suppose:

$$
L=40\text{ ms}
$$

That sounds very real-time. But perhaps the model uses features computed yesterday. Your prediction may be fast but stale.

### Freshness

Freshness asks:

How recent is the information used to produce this prediction

Define prediction age:

$$
A=t_{now}-t_{data}
$$

If your product tolerates:

$$
A<24\text{ hours}
$$

nightly batch may work perfectly. If it requires:

$$
A<5\text{ seconds}
$$

the serving architecture must somehow incorporate very recent information. Therefore these are separate dimensions:

|                           | Low request latency |    High request latency |
| ------------------------- | ------------------: | ----------------------: |
| **Fresh data**            |    Online inference | Async/stream processing |
| **Older data acceptable** |  Precomputed lookup |       Traditional batch |

A prediction can therefore be:

**fast but stale** or:

**slow but fresh** or:

**fast and fresh** or:

**slow and stale**. Only the product can tell you which combination is acceptable. Suppose recommendations are computed every hour.

```text
hourly batch job
      ↓
model inference
      ↓
top recommendations/user
      ↓
key-value store
```

When the user opens the app:

```text
user_id
   ↓
database lookup
   ↓
recommendations
```

Request latency might be only:

$$
5\text{ ms}
$$

even though inference itself happened 37 minutes earlier. So "online product experience" does **not** imply "online inference." This architecture has transformed:

$$
\text{expensive model execution}
$$

into:

$$
\text{cheap data lookup}
$$

at request time. The trade-off is freshness.

## Why Do Batch and Online Systems Pay Different Capacity Costs?
<!-- section-summary: Batch improves utilization and tolerates queues; online pays for ready capacity, while microbatching trades a short wait for efficiency. -->

Those deadlines create different economics: batch fills capacity with available work, while online reserves readiness for uncertain arrivals.

Accelerators are most efficient when kept busy. Suppose a GPU is capable of processing a large batch efficiently. Batch inference can often do:

```text
large dataset
     ↓
partition
     ↓
large inference batches
     ↓
high GPU utilization
```

There is little reason to keep spare capacity waiting for unpredictable users. The system can usually optimize heavily for:

$$
\text{throughput}
$$

and:

$$
\text{utilization}
$$

This tends to reduce:

$$
\text{cost per prediction}
$$

Batch systems can also tolerate queueing:

```text
10 million items waiting
        ↓
workers process continuously
```

If the deadline is hours away, waiting 30 seconds for an available worker may be irrelevant. This ability to buffer work is economically powerful. Online traffic is not usually smooth. Imagine requests per second:

```text
1000 |                 █
 800 |                 █
 600 |        █        █
 400 |        █   █    █
 200 | █  █   █   █    █
   0 +----------------------
```

A user arriving during the spike cannot be told:

"We'll process your ranking request when GPU utilization is convenient."

So online systems maintain enough capacity to absorb traffic. If:

$$
Q_{avg}=1,000\text{ req/s}
$$

but:

$$
Q_{peak}=4,000\text{ req/s}
$$

you may need infrastructure capable of operating near the peak. That capacity may spend much of its time idle. Hence online inference often trades:

$$
\text{lower utilization}
$$

for:

$$
\text{low waiting time}
$$

In simplified form:

$$
\boxed{
\text{Online serving pays for readiness}
}
$$

while:

$$
\boxed{
\text{Batch serving pays mainly for work actually performed}
}
$$

The exact economics depend on the compute platform, but the principle is general. Suppose several online requests arrive close together:

```text
r1 ─────┐
r2 ───┐ │
r3 ─┐ │ │
    ▼ ▼ ▼
     GPU
```

Running each separately may waste GPU capacity. So an inference server can briefly wait:

```text
r1 ─────────┐
r2 ──────┐  │
r3 ───┐  │  │
r4 ─┐ │  │  │
    ▼ ▼  ▼  ▼
      batch
        ↓
       GPU
```

This introduces a queue delay:

$$
L_{queue}
$$

but may substantially reduce compute time per request. So the online serving system solves:

$$
\min(\text{latency})
$$

subject to maintaining reasonable:

$$
\text{throughput and utilization}
$$

Batch serving tends to solve almost the inverse:

$$
\max(\text{throughput/utilization})
$$

subject to:

$$
T_{job}<D_{batch}
$$

This is why batching techniques appear even inside "online" systems. The boundary isn't about whether the GPU sees a batch. It's about **what caused the work and who is waiting for it**.

![One approved model version follows a fixed snapshot, partitioned scoring, validation, and publication for batch while a live request follows current features, ready capacity, and a latency deadline for online inference](/content-assets/articles/article-mlops-model-serving-batch-vs-online-inference/batch-online-two-promises.png)

*Batch protects a complete publication before a business cutoff. Online protects a caller that is waiting for a valid response inside the request deadline.*

## How Do Data Engineering, Idempotency, and Lineage Make Batch Inference Reliable?
<!-- section-summary: Reliable batch serving depends on reproducible input snapshots, idempotent partitions, durable outputs, and lineage for every produced prediction. -->

High utilization does not make a batch pipeline trustworthy; identified inputs, repeatable partitions, and lineage still protect its results.

A toy batch system looks like:

```python
df = load_data()
predictions = model.predict(df)
save(predictions)
```

A production system has to answer more questions. What exact data snapshot did we score? Which model version produced the prediction? What happens if worker 47 fails? Can we rerun only the failed partition? Can the job be restarted without duplicating outputs? Can we reproduce yesterday's predictions? What happens if the feature table arrives late? What happens if today's dataset has twice as many rows? These questions lead naturally to a production architecture:

```text
source datasets
      ↓
data validation
      ↓
snapshot / partition selection
      ↓
feature transformation
      ↓
distributed inference
      ↓
prediction validation
      ↓
atomic publication
      ↓
consuming systems
```

The critical word is **publication**. Consumers should usually not see:

```text
30% today's scores
70% yesterday's scores
```

just because a job is halfway finished. A safer design often writes results somewhere temporary:

```text
predictions_2026_08_30_staging
```

validates them, and only then makes that version visible.

Conceptually:

```text
compute
   ↓
validate
   ↓
commit
```

This resembles transactional thinking applied to model outputs. Suppose partition 73 crashes halfway through. The orchestrator retries it. If processing the same input twice creates duplicate outputs, retries become dangerous. So ideally:

$$
f(x,\text{run version})
$$

can be executed repeatedly without corrupting the final dataset. For example, writing:

```text
model_version = fraud_v8
score_date = 2026-08-30
customer_id = 123
```

under a deterministic output key makes replacement easier than blindly appending another row on every retry. This is **idempotent processing**. In production:

**Retries should be boring.**

If every retry requires a human to determine whether output was partially written, the serving pipeline is fragile. A prediction isn't just:

$$
0.83
$$

Operationally it is closer to:

$$
(
0.83,
model=v17,
features=v12,
data\_snapshot=2026\text{-}08\text{-}29,
code=abc123,
run=84291
)
$$

Why? Imagine somebody asks:

"Why did customer 9382 receive this score last Tuesday?"

Without lineage, you may not know. This becomes particularly important after retraining. Suppose:

```text
Monday      model v7
Tuesday     model v7
Wednesday   model v8
```

If performance changes Wednesday morning, model version becomes an obvious variable to investigate. Good batch operation therefore treats predictions as **versioned, reproducible data artifacts**.

## How Do Request Reliability, Overload, Loading, and Autoscaling Make Online Inference Reliable?
<!-- section-summary: Reliable online serving depends on bounded queues, overload behaviour, timeouts, loaded models, redundancy, and autoscaling signals tied to the bottleneck. -->

Online work has a different failure surface because requests, queues, model loading, and overload sit on a live critical path.

A toy online service is:

```python
@app.post("/predict")
def predict(x):
    return model(x)
```

A production online system looks more like:

```text
                ┌──────── feature service
                │
Client → gateway → inference service → model runtime
                │
                └──────── cache / metadata
                         ↓
                      response
```

And around it exist:

```text
load balancing
autoscaling
timeouts
rate limiting
health checks
model loading
observability
rollouts
fallback behavior
```

The essential difference is that every dependency contributes to the user's latency and reliability. If:

$$
A_1,A_2,\ldots,A_n
$$

represent dependency availabilities and every dependency is mandatory, overall availability can roughly behave like:

$$
A_{system}\approx\prod_i A_i
$$

For example, if five required components are each available 99.9% of the time:

$$
0.999^5 \approx 99.5\%
$$

So adding synchronous dependencies isn't free. This encourages architectures where the request path is kept as short and predictable as possible. Suppose the system can safely process:

$$
Q_{capacity}=10,000\text{ req/s}
$$

and suddenly receives:

$$
Q_{incoming}=40,000\text{ req/s}
$$

If every request is accepted indefinitely:

```text
requests
████████████████████████
          ↓
        queue
████████████████████████████████
          ↓
        model
```

queueing delay rises. Then requests time out. But workers continue computing responses nobody needs. The queue grows further. Eventually the service collapses. This is a classic overload feedback loop. A better system might deliberately shed load:

```text
incoming traffic
       ↓
capacity check
   ↙        ↘
accept      reject/fallback
  ↓
model
```

The key principle is:

**A service that rejects 5% of excess traffic quickly can be healthier than one that attempts 100% and times out on 70%.**

So online inference operation includes mechanisms such as concurrency limits, bounded queues, deadlines, rate limiting and fallback responses. Suppose a recommendation model hasn't responded after 300 ms. Should the application wait? Maybe not. Perhaps it can return popular products instead.

```text
recommendation request
        ↓
online model
   ↙          ↘
success      timeout
  ↓             ↓
personalized   popular items
```

That gives the model a **prediction budget**:

$$
D_{model}<D_{page}
$$

For example:

$$
D_{page}=500\text{ ms}
$$

but:

$$
D_{model}=150\text{ ms}
$$

because the application needs time to recover if inference fails. This is better than giving the model the entire user-facing deadline. Models can be large. Suppose a model requires 40 GB of GPU memory. A new inference worker starts:

```text
container starts
      ↓
download weights
      ↓
load into RAM
      ↓
copy to GPU
      ↓
initialize runtime
      ↓
warm kernels/cache
      ↓
ready
```

This might take substantial time. Therefore:

$$
T_{pod-start}
\neq
T_{service-ready}
$$

A container being alive doesn't mean it is capable of serving inference. Online systems must distinguish:

```text
process exists
```

from:

```text
model is ready for production traffic
```

That matters particularly during autoscaling and deployments. Traditional web services are often scaled using CPU utilization. Inference workloads can behave differently. Useful signals might include:

$$
Q=\text{requests/sec}
$$

$$
C=\text{active requests}
$$

$$
B=\text{queue backlog}
$$

$$
L=\text{tail latency}
$$

$$
U_{GPU}=\text{accelerator utilization}
$$

Suppose GPU utilization is 40%. That doesn't necessarily mean there is spare capacity. Perhaps memory is full. Or latency has already reached the SLO because requests are large. LLMs complicate things further because different requests may consume radically different compute:

```text
request A → 20 output tokens
request B → 5,000 output tokens
```

So:

$$
1\text{ request}
\neq
1\text{ unit of work}
$$

Operational capacity planning has to account for work size, not merely request count.

## How Can Both Paths Preserve the Same Model and Feature Meaning?
<!-- section-summary: Batch and online may share an immutable model, but feature definitions, event time, preprocessing, and policy must preserve the same product meaning. -->

Teams often operate both paths, which makes shared model and feature semantics more important than sharing identical infrastructure.

Imagine you trained:

```text
fraud_model_v12
```

There is no fundamental reason you need separate mathematical models for batch and online serving. You might deploy:

```text
                         fraud_model_v12
                         /             \
                        /               \
                       ▼                 ▼
             nightly backfill      online API
```

The model is identical. The execution environments differ. This can be extremely useful. For example, after releasing a new model you can batch-score historical data:

$$
f_{new}(X_{historical})
$$

while simultaneously serving new requests online. The distinction is therefore architectural, not necessarily statistical. This is where many hybrid systems fail. Suppose training defines:

$$
x=\text{purchases during previous 30 days}
$$

The batch pipeline computes it using SQL:

```text
warehouse → aggregation → 30_day_purchases
```

The online service computes it from a real-time store:

```text
event stream → feature state → 30_day_purchases
```

If these implementations differ, the model may see:

```text
training:
30_day_purchases = 11

online:
30_day_purchases = 8
```

for logically equivalent situations. This is often called **training-serving skew** or **feature skew**. The larger principle is:

> **The semantic meaning of an input feature must not depend on whether it was produced through the batch path or online path.**

The technology may differ. The meaning must not. Many production ML systems should not choose "batch versus online." They should ask:

**Which pieces belong in each?**

Consider recommendation ranking. A complete online computation might require comparing one user against 100 million products. Doing that interactively is impractical.

Instead:

```text
                 BATCH PATH

all users × catalog
       ↓
candidate generation
       ↓
500 candidates/user
       ↓
candidate store
```

Then when the user arrives:

```text
                 ONLINE PATH

user request
     ↓
read 500 candidates
     ↓
current context
     ↓
online ranking model
     ↓
top 20
```

Batch solves the expensive broad search. Online solves the freshness-sensitive final decision. This is a powerful general pattern:

$$
\boxed{
\text{batch for expensive broad computation}
+
\text{online for small fresh computation}
}
$$

Imagine fraud detection needs both historical and immediate information. Historical features:

```text
account age
average purchase amount
90-day chargeback rate
merchant history
```

can be batch-computed. Recent features:

```text
transactions in last 5 minutes
current location
current device
current transaction amount
```

need fresh updates. So prediction becomes:

$$
y=f(x_{historical},x_{recent},x_{request})
$$

Architecturally:

```text
batch pipeline
      ↓
historical features ──────┐
                          │
stream processor          │
      ↓                   │
recent features ──────────┼──→ online model → decision
                          │
current request ──────────┘
```

Again, "batch versus online" is the wrong framing. The correct question is:

**Which information needs which freshness guarantee?**

![A 30-millisecond online response still uses a six-hour-old account balance, while a 20-minute batch can meet daily planning freshness with prior-day finalized stock counts](/content-assets/articles/article-mlops-model-serving-batch-vs-online-inference/batch-online-freshness-latency.png)

*Data freshness, prediction freshness, and response latency are separate clocks. Each needs a limit tied to the product decision.*

## How Do Monitoring, Replay, Redundancy, and Retries Differ between the Paths?
<!-- section-summary: Batch recovery replays identified work, while online recovery uses redundancy and degradation; their retry and monitoring signals therefore differ. -->

The same difference continues into monitoring and recovery: replay suits durable work, whereas online paths need redundancy and controlled degradation.

Batch systems fail in ways that can look deceptively quiet. If an API is down, users complain immediately. If a nightly prediction job silently writes half the expected rows, nobody may notice until morning. So batch monitoring needs to verify the **data product**, not merely that a process exited with code 0. Useful concepts include:

| Signal                  | Example                                    |
| ----------------------- | ------------------------------------------ |
| Job completion          | Did today's run finish                    |
| Completion deadline     | Did it finish before 06:00                |
| Input volume            | Expected 20M rows, received 11M            |
| Output volume           | Did every expected entity receive a score |
| Failure rate            | How many partitions/items failed          |
| Data freshness          | Which source snapshot was used            |
| Prediction distribution | Did average score suddenly change         |
| Model/version lineage   | Which artifact produced the data          |

A successful scheduler status does not prove inference was correct. Online systems need a different set of operational signals. The core service-level measurements are often:

$$
\text{request rate}
$$

$$
\text{error rate}
$$

$$
P50,\ P95,\ P99\ latency
$$

$$
\text{saturation}
$$

But inference adds model-specific dimensions such as batch size, tokens/sec for generative models, accelerator utilization, model-loading failures, feature-fetch latency and fallback rate. The request should ideally be traceable:

```text
request
  │
  ├─ 7 ms   gateway
  ├─ 13 ms  feature lookup
  ├─ 4 ms   queue
  ├─ 31 ms  inference
  └─ 3 ms   postprocessing

total = 58 ms
```

Otherwise "the ML endpoint is slow" doesn't tell you what to fix. Suppose today's batch job fails. You generally want:

```text
input snapshot
      ↓
rerun
      ↓
same logical output
```

This is much easier when data is immutable or versioned. If the source dataset changes underneath the rerun, reproducibility becomes difficult. So robust batch systems like deterministic inputs:

$$
X_{2026-08-30}
$$

plus an explicit model:

$$
M_{v17}
$$

plus explicit feature logic:

$$
F_{v23}
$$

Then:

$$
Y=M_{v17}(F_{v23}(X_{2026-08-30}))
$$

can be reproduced. Backfills become the same operation over historical partitions:

```text
2026-08-27 → score
2026-08-28 → score
2026-08-29 → score
2026-08-30 → score
```

This is one reason batch pipelines fit naturally into data-platform abstractions. If an online service fails at 14:03, rerunning requests tomorrow doesn't help. The decision deadline has already passed. So recovery is fundamentally different. Online systems rely more on:

```text
multiple replicas
health checks
automatic routing
fast replacement
timeouts
retries when safe
fallbacks
cached predictions
previous-model versions
load shedding
```

The principle is:

$$
\text{recover before the decision deadline}
$$

or:

$$
\text{degrade gracefully}
$$

For example:

```text
primary ML model unavailable
          ↓
cached model score
          ↓
if missing:
rules-based fallback
```

The fallback may be less accurate. But:

$$
\text{slightly worse prediction}
$$

can be much better than:

$$
\text{no product response}
$$

Retries sound harmless:

```text
request failed
     ↓
retry
```

But suppose the service is overloaded. The original request times out because the service is too busy. If every caller immediately retries:

$$
10,000\text{ failed requests}
\rightarrow
10,000\text{ new requests}
$$

The retry makes overload worse. This can create a **retry storm**. So online retries usually need limited attempts, deadlines, exponential backoff and jitter. Even more importantly:

Don't retry work after its result is no longer useful.

If the user-facing deadline has passed, completing the prediction often just consumes capacity.

## How Do Releases, Migrations, and Cascades Combine Batch and Online Inference?
<!-- section-summary: Releases affect long jobs and request traffic differently, and migrations, precomputation, hybrid fraud paths, and cascades combine both modes deliberately. -->

Changing patterns or models therefore affects two operating systems and often produces intentional hybrids and cascades.

For batch:

```text
model v1
   ↓
next scheduled job uses model v2
```

Deployment can often be tied to a new output partition. You might preserve:

```text
scores_v1
scores_v2
```

and compare them before publication. Online serving is trickier because traffic is live. A common conceptual rollout is:

```text
             traffic
                │
          ┌─────┴─────┐
          ▼           ▼
       model v1    model v2
         95%          5%
```

Observe metrics. Then perhaps:

```text
50% / 50%
```

and eventually:

```text
0% / 100%
```

This reduces blast radius. The essential requirement is that **deployment and model selection are reversible**. If model v2 behaves badly, routing should be able to return quickly to v1. This is a deeper architectural concern. Imagine the product defines:

"Customer risk score represents the probability of churn within 30 days, using information available at scoring time."

Initially, you compute it nightly. Later the product needs fresher predictions, so you move to online inference. The infrastructure can change:

```text
warehouse
   ↓
batch model
```

to:

```text
feature service
   ↓
online model
```

without changing what the score *means*. Ideally:

$$
P(\text{churn in 30 days}\mid x)
$$

still has the same semantic definition. This separation is valuable:

```text
product semantics
       │
       ▼
feature/model contract
       │
       ▼
serving implementation
```

The bottom layer should be replaceable without silently changing the top. One way to preserve meaning is to think of the model as exposing a logical contract:

```text
Prediction:
    entity
    event_time
    features_as_of
    model_version
    prediction
```

For example:

```text
customer = 19281
prediction_time = 10:00
features_as_of = 09:59:55
model_version = churn_v17
churn_probability = 0.81
```

Whether that record was produced by Spark at midnight or by an online inference server at 10:00 isn't its semantic meaning. This makes migrations easier. Suppose you begin with nightly recommendations.

```text
00:00 → compute recommendations
all day → serve stored recommendations
```

Users eventually expect purchases to affect recommendations immediately. You don't necessarily replace the entire system. A safer progression is:

```text
Stage 1

nightly candidates
      ↓
serve directly
```

then:

```text
Stage 2

nightly candidates
      ↓
online reranker using current context
```

then perhaps:

```text
Stage 3

stream-updated candidates
      ↓
online reranker
```

You move only the freshness-sensitive work onto the expensive online path. This is usually better than making everything synchronous. Suppose an application performs an online model call whenever someone views a customer profile. After measuring production traffic, you discover:

```text
5 million profile views/day
100,000 unique customers/day
```

Most scores are being recomputed repeatedly. If scores can be one hour old, then:

```text
hourly score generation
      ↓
prediction store
      ↓
lookup
```

could replace:

```text
5 million model executions
```

with perhaps:

```text
2.4 million or fewer periodic executions
```

depending on how broadly you score. So moving from online to batch isn't a regression. It may be an architecture becoming better aligned with its actual requirements. Suppose an expensive model takes:

$$
T_{model}=800\text{ ms}
$$

but the product deadline is:

$$
D=100\text{ ms}
$$

Then pure synchronous inference is physically incompatible with the requirement:

$$
800 > 100
$$

You have four basic options:

```text
make model faster
precompute part/all of the result
use a cheaper model online
relax the product deadline
```

This is an important first-principles point:

Architecture cannot defeat arithmetic.

If the computation cannot fit inside the deadline, another part of the system must change. Suppose a cheap model handles most requests.

$$
f_{small}(x)
$$

Only uncertain examples go to an expensive model:

$$
f_{large}(x)
$$

Conceptually:

```text
request
   ↓
small fast model
   ↓
confidence
 ↙         ↘
high       low
 ↓          ↓
answer     large model
             ↓
           answer
```

If only 5% need the expensive model, average cost may fall dramatically. Similar reasoning can apply between batch and online. Batch computation can remove easy or reusable work so the online service performs only the irreducibly live portion.

## What Decision Framework Chooses the Right Operating Path?
<!-- section-summary: The final choice compares value deadlines, data arrival, freshness, workload size, compute cost, recovery, and the consumer's interaction pattern. -->

The decision framework returns to the product deadline and selects the simplest path that meets freshness, cost, and reliability needs.

This is perhaps the cleanest mathematical summary.

### Batch inference

Given:

$$
N=\text{number of predictions}
$$

and:

$$
D_b=\text{job deadline}
$$

choose resources to minimize:

$$
\text{total cost}
$$

subject to:

$$
T_{completion}\le D_b
$$

and correctness requirements. You can tolerate substantial queueing and maximize utilization.

### Online inference

Given a stream of requests $$r_i$$, each with deadline $$D_i$$, choose resources to minimize cost while ensuring something like:

$$
P99(L_i)\le D_i
$$

and maintaining availability. This generally requires spare capacity. So:

$$
\boxed{\text{Batch optimizes a workload}}
$$

whereas:

$$
\boxed{\text{Online optimizes a waiting experience}}
$$

That difference explains most of the architecture. When deciding how to operate a prediction, reason in this order:

1. **What product decision uses the prediction?**
2. **What information must be known before the prediction can be computed?**
3. **How fresh must that information be?**
4. **When does the product need the answer?**
5. **Can the answer be computed before the request exists?**
6. **Will many requests reuse the same prediction?**
7. **Can expensive work be moved off the live path?**
8. **What happens when inference is late or unavailable?**
9. **How will the system replay, retry, roll back and observe predictions?**
10. **Does the simplest architecture satisfying those constraints use batch, online, or both?**

That last point matters. The objective isn't:

"Use the most sophisticated serving architecture."

It is:

**Use the cheapest and simplest architecture that preserves the product's required prediction semantics and deadline.**

Batch and online inference are easiest to remember as two timelines.

### Batch

```text
data exists
    ↓
prediction computed
    ↓
prediction stored
    ↓
eventually somebody needs it
```

The system tries to ensure:

$$
\boxed{\text{prediction exists before it will be needed}}
$$

### Online

```text
decision needs answer
       ↓
request arrives
       ↓
prediction computed now
       ↓
decision continues
```

The system tries to ensure:

$$
\boxed{\text{prediction finishes before the waiting decision expires}}
$$

And hybrid systems exploit both:

```text
slow / broad / reusable work
            ↓
           BATCH
            ↓
      precomputed state
            +
fresh / narrow / contextual work
            ↓
          ONLINE
            ↓
         decision
```

The deepest principle is:

$$
\boxed{
\text{Do as much computation as possible before the request,
but keep online whatever cannot be correct until the request exists.}
}
$$

That one rule explains why recommendation systems precompute candidates but rerank online, why fraud systems batch historical features but evaluate transactions live, why online systems need spare capacity and fallbacks, and why batch systems emphasize lineage, replay and completion deadlines. **Batch and online are therefore not competing technologies. They are two places on the timeline where you are allowed to spend computation.**

![Hybrid recommendation path precomputes candidates in batch, publishes the current approved generation to a versioned store, and re-ranks it with current context inside the page deadline](/content-assets/articles/article-mlops-model-serving-batch-vs-online-inference/batch-online-hybrid-summary.png)

*A hybrid design gives stable catalogue work to batch and deadline-bound context to online inference while preserving shared model, feature, score, and fallback meaning.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[How Do Deadlines Distinguish Batch from Online Inference?]{kind="recap"}
Batch work has a completion deadline across available records, while online work has a waiting decision and a per-request latency deadline.
:::

:::expand[Why Do Batch and Online Systems Pay Different Capacity Costs?]{kind="recap"}
Batch improves utilization and tolerates queues; online pays for ready capacity, while microbatching trades a short wait for efficiency.
:::

:::expand[How Do Data Engineering, Idempotency, and Lineage Make Batch Inference Reliable?]{kind="recap"}
Reliable batch serving depends on reproducible input snapshots, idempotent partitions, durable outputs, and lineage for every produced prediction.
:::

:::expand[How Do Request Reliability, Overload, Loading, and Autoscaling Make Online Inference Reliable?]{kind="recap"}
Reliable online serving depends on bounded queues, overload behaviour, timeouts, loaded models, redundancy, and autoscaling signals tied to the bottleneck.
:::

:::expand[How Can Both Paths Preserve the Same Model and Feature Meaning?]{kind="recap"}
Batch and online may share an immutable model, but feature definitions, event time, preprocessing, and policy must preserve the same product meaning.
:::

:::expand[How Do Monitoring, Replay, Redundancy, and Retries Differ between the Paths?]{kind="recap"}
Batch recovery replays identified work, while online recovery uses redundancy and degradation; their retry and monitoring signals therefore differ.
:::

:::expand[How Do Releases, Migrations, and Cascades Combine Batch and Online Inference?]{kind="recap"}
Releases affect long jobs and request traffic differently, and migrations, precomputation, hybrid fraud paths, and cascades combine both modes deliberately.
:::

:::expand[What Decision Framework Chooses the Right Operating Path?]{kind="recap"}
The final choice compares value deadlines, data arrival, freshness, workload size, compute cost, recovery, and the consumer's interaction pattern.
:::
