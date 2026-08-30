---
title: "Training Triggers"
description: "Choose scheduled, event-based, manual, or hybrid training triggers based on data arrival, label readiness, business cadence, and operational risk."
overview: "A production trigger proposes retraining work. A separate eligibility policy decides whether the data, labels, capacity, and authority are ready for one safe pipeline run."
tags: ["MLOps", "production", "orchestration"]
order: 3
id: "article-mlops-training-pipelines-scheduled-vs-event-based-training"
aliases:
  - roadmaps/mlops/modules/training-pipelines/pipeline-design/02-scheduled-vs-event-based-training.md
  - child-pipeline-design-02-scheduled-vs-event-based-training
---

## Table of Contents

1. [Why Should a Trigger Create a Training Request Instead of Starting Compute?](#why-should-a-trigger-create-a-training-request-instead-of-starting-compute)
2. [How Does the System Decide That Training Data Is Ready?](#how-does-the-system-decide-that-training-data-is-ready)
3. [How Do Idempotency and Run Identities Handle Duplicate Triggers?](#how-do-idempotency-and-run-identities-handle-duplicate-triggers)
4. [How Do Retry, Replay, Backfill, and Manual Requests Differ?](#how-do-retry-replay-backfill-and-manual-requests-differ)
5. [How Do Request State and Concurrency Control Work Together?](#how-do-request-state-and-concurrency-control-work-together)
6. [How Does Reconciliation Recover Missing Events?](#how-does-reconciliation-recover-missing-events)
7. [What Evidence and Monitoring Belong to the Trigger Control Plane?](#what-evidence-and-monitoring-belong-to-the-trigger-control-plane)
8. [What Does a Complete Training Trigger Lifecycle Look Like?](#what-does-a-complete-training-trigger-lifecycle-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

At 02:00, a scheduler requests a daily fraud-model retrain. Transactions and customer records are complete through midnight, but chargeback labels are still loading. Starting immediately would produce a model from incomplete outcomes even though the schedule fired exactly on time.

A **training trigger** is evidence that a team may want a run. It is not proof that the exact inputs are ready or that policy and capacity allow execution. The trigger should create a durable logical request that defines the model, training interval, data cutoff, code or pipeline version, configuration, and reason for the request.

Readiness checks then decide whether that request is safe to run. Stable identities prevent a schedule, data event, and duplicate message from launching the same expensive work several times. Attempts, replays, and backfills remain separate operations, and reconciliation repairs requests that a missing event failed to create.

These questions follow one request from its first signal through readiness, admission, execution, recovery, and audit:

1. **Why Should a Trigger Create a Training Request Instead of Starting Compute?**
2. **How Does the System Decide That Training Data Is Ready?**
3. **How Do Idempotency and Run Identities Handle Duplicate Triggers?**
4. **How Do Retry, Replay, Backfill, and Manual Requests Differ?**
5. **How Do Request State and Concurrency Control Work Together?**
6. **How Does Reconciliation Recover Missing Events?**
7. **What Evidence and Monitoring Belong to the Trigger Control Plane?**
8. **What Does a Complete Training Trigger Lifecycle Look Like?**

## Why Should a Trigger Create a Training Request Instead of Starting Compute?
<!-- section-summary: A trigger records intent and defines a logical request with an explicit interval and cutoff; readiness and policy decide whether execution may begin. -->

A schedule can fire on time while a required label source is still incomplete. That is why an incoming signal should describe intended work rather than directly allocate a GPU.

A training pipeline ultimately does something like:

$$
\text{model} = \text{Train}(\text{data}, \text{code}, \text{configuration})
$$

The difficult part is not usually calling `Train()`. The difficult part is deciding:

**When is it correct to call `Train()`?**

That is the problem training triggers solve. The central rule is:

> **A trigger is evidence that training may be needed. It is not permission to start training immediately.**

A robust system therefore separates:

$$
\boxed{\text{Trigger} \rightarrow \text{Training Request} \rightarrow \text{Readiness Check} \rightarrow \text{Run}}
$$

That separation explains almost every design decision that follows. Imagine you train a fraud model every day. At 02:00, a scheduler fires:

```text
It's 02:00.
Retrain the fraud model.
```

But suppose one source looks like this:

```text
transactions     ready through yesterday ✓
customers        ready through yesterday ✓
chargebacks      still loading            ✗
```

If the scheduler directly starts training, the model gets incomplete data. So the scheduler was not really saying:

```text
Training is safe.
```

It was saying:

```text
We intended to train around this time.
Please evaluate whether that training run can happen.
```

That distinction gives us two separate concepts:

```text
Trigger
    ↓
"We might want a training run."

Readiness
    ↓
"The exact inputs required by that run are now safe."

Execution
    ↓
"Start it."
```

A useful equation is:

$$
\text{StartTraining}
=
\text{Requested}
\land
\text{DataReady}
\land
\text{PolicyAllows}
\land
\text{NotAlreadyRunning}
$$

This is much safer than:

$$
\text{StartTraining} = \text{TriggerReceived}
$$

Instead of having triggers launch compute directly, have them create a **logical training request**.

For example:

```text
TrainingRequest

model: fraud_model
training_window: [2026-05-01, 2026-08-29)
data_cutoff: 2026-08-29T00:00:00Z
pipeline_version: fraud_training_v17
config_version: cfg_42
reason: scheduled
```

Notice what is missing:

```text
"Use whatever data happens to exist when the GPU starts."
```

That would make the run nondeterministic. The request should define what training means before execution starts. The trigger answers:

Why are we considering training

The training request answers:

Exactly what training are we considering

There are many variations, but most triggers reduce to four families.

| Trigger    | Meaning                                      | Example                     |
| ---------- | -------------------------------------------- | --------------------------- |
| Time       | "We periodically consider retraining."       | Every day at 02:00          |
| Data event | "New training data became available."        | June partition completed    |
| Condition  | "Something about the system changed enough." | Drift > threshold           |
| Human/API  | "Someone explicitly requested retraining."   | Engineer launches a retrain |

These mechanisms should ideally converge on the **same request path**:

```text
Cron ──────────────┐
                   │
Data event ────────┤
                   ▼
Drift alert ──→ Training Request → Readiness Gate → Training
                   ▲
Manual/API ────────┘
```

This is an important architectural property. If every trigger has its own way of launching training, eventually their behaviour diverges. You get things like:

```text
scheduled training checks completeness
manual training doesn't

event training checks quality
scheduled training doesn't

backfills bypass both
```

Then the correctness of your model depends on how somebody happened to start the pipeline.

Instead:

**Triggers should differ in how they create requests, not in what makes those requests safe.**

This is one of the easiest mistakes to make. Suppose a daily training pipeline fires at:

```text
2026-08-29 02:00
```

What data does that run represent? It probably should not mean:

```text
all data available at 02:00
```

because that changes depending on whether upstream systems were early or late. Instead define a logical cutoff.

For example:

```text
trigger time:
2026-08-29 02:00 UTC

data cutoff:
2026-08-29 00:00 UTC

training history:
2026-06-01 00:00
        ↓
2026-08-29 00:00
```

In interval notation:

$$
[2026\text{-}06\text{-}01,\;2026\text{-}08\text{-}29)
$$

The half-open interval `[start, end)` is useful because adjacent windows fit together without overlap:

```text
Day 1: [Aug 27, Aug 28)
Day 2: [Aug 28, Aug 29)
Day 3: [Aug 29, Aug 30)
```

No timestamp belongs to two windows.

### Why this matters

Suppose today's run starts late at 04:30. If your rule is:

```text
SELECT * WHERE timestamp < current_time()
```

then today's training set is different simply because the pipeline was delayed. Instead use the request's cutoff:

```sql
WHERE timestamp < :data_cutoff
```

Now:

```text
scheduled at 02:00
started at 02:01

and

scheduled at 02:00
started at 05:47
```

can still represent the same logical training run. That is fundamental for reproducibility.

## How Does the System Decide That Training Data Is Ready?
<!-- section-summary: Central readiness checks verify complete inputs, producer watermarks, data quality, and label maturity for the request's cutoff. -->

The request fixes the time window first; the next step proves that every input needed for that exact window is complete and usable.

Consider a training dataset assembled from three systems:

```text
orders
customers
refunds
```

Training cutoff:

```text
2026-08-29 00:00
```

At 02:00:

```text
orders watermark       = 2026-08-29 00:00 ✓
customers watermark    = 2026-08-29 00:00 ✓
refunds watermark      = 2026-08-28 22:00 ✗
```

The request exists, but it should sit in:

```text
WAITING_FOR_DATA
```

rather than running. Twenty minutes later:

```text
refunds watermark = 2026-08-29 00:00
```

The exact same request becomes runnable. So:

$$
\text{trigger time} \neq \text{data-ready time}
$$

and frequently:

$$
\text{data-ready time} > \text{trigger time}
$$

"File exists" is often too weak. Suppose an upstream pipeline produces:

```text
s3://training/2026-08-28/part-001.parquet
s3://training/2026-08-28/part-002.parquet
...
s3://training/2026-08-28/part-100.parquet
```

The arrival of `part-001` doesn't mean the dataset is complete. A better contract is something like:

```text
partition = 2026-08-28
expected_files = 100
actual_files = 100
producer_state = COMPLETE
quality_checks = PASS
```

or a producer can publish a watermark:

```text
complete_through = 2026-08-29T00:00:00Z
```

Conceptually, the readiness function might be:

```python
def ready(request):
    return (
        orders.complete_through >= request.data_cutoff
        and customers.complete_through >= request.data_cutoff
        and refunds.complete_through >= request.data_cutoff
        and quality_checks_pass(request)
        and labels_are_mature(request)
    )
```

For ML systems, **label maturity** is particularly important. Imagine predicting whether a customer will churn within 30 days. A customer observation from yesterday cannot yet have a complete 30-day churn label. So your training window may actually involve several different times:

```text
observation cutoff
feature cutoff
label maturity cutoff
training execution time
```

These should not accidentally become the same timestamp. Suppose you have:

```text
scheduled trigger
data trigger
drift trigger
manual trigger
backfill
retry
```

A fragile design does this:

```text
schedule → readiness logic A
event    → readiness logic B
manual   → skip checks
backfill → special script
```

A stronger design is:

```text
                   ┌──────────────┐
all requests ────→ │ ready(run)  │
                   └──────┬───────┘
                          │
                       yes│
                          ▼
                       execute
```

That gives you an invariant:

> **No training execution can exist without satisfying the same admission rules.**

The readiness system can still understand modes. For example, a historical backfill may have different availability rules from today's training, but that difference should be explicit configuration inside the readiness policy rather than a bypass.

![Schedules, events, data-aware checks, and manual approvals create normalized retraining requests that share one eligibility policy](/content-assets/articles/article-mlops-training-pipelines-scheduled-vs-event-based-training/four-signals-one-policy.png)

*Every request source records the same interval, dataset versions, and purpose. The policy may wait, reject, or reserve one logical run key before training begins.*

## How Do Idempotency and Run Identities Handle Duplicate Triggers?
<!-- section-summary: Several messages can refer to one logical operation, so a stable logical run key deduplicates requests while attempt IDs preserve physical retries. -->

Event systems can deliver the same meaning more than once, so readiness must be paired with identities that distinguish messages, logical work, and attempts.

Now consider event-driven retraining. An upstream system publishes:

```text
training_data_ready(2026-08-28)
```

Your consumer receives it and processes it. But before the event broker hears the acknowledgement, the consumer crashes. The broker reasonably thinks:

```text
Maybe it didn't process the event.
I'll send it again.
```

Now the same logical event arrives twice. Or perhaps:

```text
02:00 scheduled trigger
02:01 data-ready trigger
```

both refer to exactly the same training period. Without protection:

```text
                     ┌→ Training #1
same logical data ───┼→ Training #2
                     └→ Training #3
```

For a large model, duplicates might mean thousands of pounds of wasted accelerator time. More importantly, they create ambiguous models:

```text
Which duplicate is the real one
Which gets registered
Which gets deployed
```

Trying to guarantee that every event is delivered **exactly once** is often much harder than making repeated events harmless. The important question is:

"Are these two events asking for the same logical training operation?"

For example, construct a logical key from:

```text
model
training interval
data cutoff
training specification/version
```

Conceptually:

```text
fraud_model
+
2026-06-01..2026-08-29
+
cutoff=2026-08-29
+
training_spec=v17
```

giving something like:

```text
fraud_model:2026-08-29:spec-v17
```

Then put a uniqueness constraint around it. Pseudo-SQL:

```sql
INSERT INTO training_requests (
    logical_run_id,
    ...
)
VALUES (...)
ON CONFLICT (logical_run_id)
DO NOTHING;
```

Now:

```text
cron event ─────────┐
data event ─────────┼─→ same logical_run_id
duplicate message ──┘
                         │
                         ▼
                  one training request
```

This property is called **idempotency**. Repeatedly asking for the same logical operation does not repeatedly create the operation. Suppose you receive:

```text
event_id = abc123
event_id = xyz789
```

They are different messages. But both might mean:

```text
"Train fraud_model through Aug 29."
```

So:

```text
event identity
```

and:

```text
training identity
```

are different concepts. You generally want to preserve both:

```text
TriggerEvent
    event_id = xyz789
    source = drift_monitor

TrainingRequest
    logical_run_id = fraud_model:2026-08-29:v17
```

Multiple events can point to the same request:

```text
event A ──┐
event B ──┼→ logical training request X
event C ──┘
```

This also produces excellent audit information:

```text
Why did this run exist

- scheduled trigger at 02:00
- data-ready event at 02:14
- drift alert at 02:17
```

But only one model was trained. This distinction is extremely useful. Suppose training fails because a GPU node dies. You retry. Did the intended training operation change? No. Therefore:

```text
logical_run_id
    fraud:2026-08-29:v17
```

should stay constant. But the physical execution changed:

```text
attempt 1 → failed
attempt 2 → failed
attempt 3 → succeeded
```

So model it as:

```text
Logical training run
    fraud:2026-08-29:v17

        ├── attempt-001
        ├── attempt-002
        └── attempt-003
```

This gives you two useful identities:

$$
\text{LogicalRunID} = \text{what we intended to compute}
$$

$$
\text{AttemptID} = \text{one physical attempt to compute it}
$$

Never use retry number as part of the logical identity. Otherwise every retry looks like a completely unrelated training job.

## How Do Retry, Replay, Backfill, and Manual Requests Differ?
<!-- section-summary: Retries repeat failed execution, replays repeat pinned intent, backfills create historical logical runs, and manual requests still pass the same correctness checks. -->

Those identities make it possible to define different repetition operations precisely instead of sending all of them through an unsafe rerun button.

These words are sometimes used interchangeably, but operationally they should have different meanings.

| Operation | Meaning                                                                  | Logical inputs                 |
| --------- | ------------------------------------------------------------------------ | ------------------------------ |
| Retry     | Previous execution failed                                                | Same                           |
| Replay    | Intentionally execute the same logical request again                     | Normally same/pinned           |
| Backfill  | Create training requests for historical periods that should have existed | Different historical intervals |

A **retry** might look like:

```text
run = churn:2026-08-29:v4

attempt 1 → infrastructure failure
attempt 2 → success
```

Nothing about the requested training changed. A **replay** might mean:

```text
Re-execute churn:2026-08-29:v4
using the original input snapshot
```

This is useful for debugging or verifying reproducibility. A **backfill** is different:

```text
Backfill June 1–5

churn:2026-06-01:v4
churn:2026-06-02:v4
churn:2026-06-03:v4
churn:2026-06-04:v4
churn:2026-06-05:v4
```

A backfill is not one giant retry. It is normally a collection of logical historical runs. Give the collection a parent identity:

```text
backfill_id = bf_7281

    ├── June 1 run
    ├── June 2 run
    ├── June 3 run
    ├── June 4 run
    └── June 5 run
```

Imagine you rerun training for January. Your database now contains corrected January transactions that were not available in January. What does "retrain January" mean? It could mean:

```text
A. Reproduce exactly what January's pipeline would have seen then.
```

or:

```text
B. Train for January using the best corrected data we know today.
```

Those are scientifically different experiments. Therefore a serious backfill policy should specify its snapshot semantics:

```text
data_snapshot_policy = historical_as_of

or

data_snapshot_policy = latest_corrected
```

If your system only records:

```text
training_window = January
```

you do not have enough information to know which experiment occurred. A manual button is just another source of a training request. It should not secretly mean:

```text
Ignore missing partitions.
Ignore dedupe.
Ignore feature freshness.
Ignore everything and start GPUs.
```

Instead:

```text
Engineer
   │
   ▼
Manual request
   │
   ▼
same readiness checks
   │
   ▼
optional approval
   │
   ▼
training
```

Manual **approval** is a different concept from manual **triggering**.

For example:

```text
automatic trigger:
drift increased sharply

readiness:
data complete ✓

policy:
estimated training cost = £18,000
bulk retraining = true

state:
WAITING_FOR_APPROVAL
```

Someone can then approve that already-valid request. This is especially useful for expensive backfills, emergency retraining, unusual data corrections, or forced replays.

## How Do Request State and Concurrency Control Work Together?
<!-- section-summary: A durable request state machine separates readiness from capacity admission, while concurrency limits control simultaneous legitimate runs rather than duplicates. -->

After a valid request exists, its state still has to distinguish waiting for data, approval, capacity, execution, and completion.

Once we derive everything above, training triggering starts looking less like "run a cron job" and more like managing durable state:

```text
              trigger
                 │
                 ▼
            REQUESTED
                 │
          data incomplete
                 ▼
        WAITING_FOR_DATA
                 │
            data ready
                 ▼
       WAITING_FOR_APPROVAL   ← optional
                 │
             approved
                 ▼
              READY
                 │
          capacity available
                 ▼
             RUNNING
            /       \
           /         \
       FAILED      SUCCEEDED
          │
        retry
          │
          └────────→ RUNNING
```

Duplicates do not create parallel state machines. They attach to the existing logical request. That is a much cleaner model. These are easy to confuse. **Deduplication** asks:

Is this already the same logical training operation

**Concurrency control** asks:

Even if these are legitimate different runs, how many may execute simultaneously

For example:

```text
Aug 27 training ── legitimate
Aug 28 training ── legitimate
Aug 29 training ── legitimate
```

A backfill might create all three correctly. But perhaps your GPU budget says:

```text
maximum concurrent training runs = 1
```

Then:

```text
Aug 27 → RUNNING
Aug 28 → READY
Aug 29 → READY
```

This is admission control, not deduplication. Keeping these mechanisms separate makes the system much easier to reason about.

![A trigger ledger suppresses duplicate deliveries, repairs a lost submission response by querying the logical key, and reconstructs missing events through reconciliation](/content-assets/articles/article-mlops-training-pipelines-scheduled-vs-event-based-training/trigger-ledger-recovery.png)

*The ledger creates one logical request for a redelivered event, attaches an already accepted orchestrator run after a lost response, and sends recovered proposals through normal eligibility.*

## How Does Reconciliation Recover Missing Events?
<!-- section-summary: Events provide quick notice, idempotency makes duplicates harmless, and periodic reconciliation recreates requests that missing events failed to produce. -->

Deduplication handles repeated signals, while correctness also requires a repair path for a signal that never arrives.

Event systems can produce:

```text
duplicate events
```

but they can also produce:

```text
missing events
```

Idempotency solves the first. It does not solve the second. Suppose August 28 data becomes complete, but the `data_ready` message disappears. If your architecture depends entirely on receiving that message, training may never happen. A stronger system combines **events** with **reconciliation**. An event gives you low latency:

```text
"Something changed. Check immediately."
```

A reconciler periodically asks:

```text
"For every training interval that should exist,
is there a corresponding request?"
```

For example:

```text
expected:
Aug 26 ✓
Aug 27 ✓
Aug 28

actual:
Aug 26 ✓
Aug 27 ✓

reconciler:
create Aug 28 request
```

This produces a powerful pair of properties:

```text
duplicates → harmless because requests are idempotent
missing events → repaired by reconciliation
```

In distributed systems, that combination is generally much more robust than trying to build perfect message delivery. A good architecture therefore looks approximately like this:

```text
                  TRIGGER SOURCES

       cron        data        drift       manual
        │           │            │            │
        └───────────┴──────┬─────┴────────────┘
                           ▼
                    Trigger Events
                           │
                           ▼
                normalize / deduplicate
                           │
                           ▼
                ┌─────────────────────┐
                │ Training Requests   │
                │ durable database    │
                └─────────┬───────────┘
                          │
                    readiness check
                          │
              ┌───────────┴───────────┐
              │                       │
           not ready                ready
              │                       │
          wait/recheck                ▼
                               policy/admission
                                       │
                                       ▼
                                    execute
                                       │
                                       ▼
                              Training Attempts
                                       │
                                  model artifact
```

The database—or equivalent durable orchestration state—is important. The event broker should not be your only record of whether a model ought to be trained.

## What Evidence and Monitoring Belong to the Trigger Control Plane?
<!-- section-summary: The ledger records exact intent, trigger sources, readiness evidence, approvals, attempts, outputs, and latency spent waiting for data, approval, or capacity. -->

The durable ledger provides that repair point and the evidence needed to monitor work that is late before training even starts.

At minimum, you want enough information to answer:

```text
What were we trying to train
Why
Using what
When
What actually happened
```

Conceptually:

```text
logical_run_id

model_name
training_interval_start
training_interval_end
data_cutoff

data_snapshot_ids

pipeline_version
container_image_digest
code_commit
training_config_version
feature_definition_version

trigger_sources
trigger_event_ids
request_created_at

readiness_status
readiness_evidence

approval_status
approver
approval_reason

attempts
attempt_statuses

output_model_id
metrics
```

The exact schema varies. The principle is:

**The logical training request should be reconstructable without inspecting a pile of ephemeral logs.**

Teams frequently monitor:

```text
training failed
```

but forget to monitor:

```text
training never started.
```

Those are different failures. For trigger infrastructure, useful things to observe include:

```text
request creation rate
duplicate-trigger rate
requests waiting for data
age of oldest waiting request
readiness-check failures
approval queue age
ready-but-not-started time
training attempt failure rate
retry count
missing expected intervals
backfill progress
```

One particularly valuable metric is:

$$
\text{trigger-to-start latency}
=
t_{\text{training start}}
-
t_{\text{request creation}}
$$

But break it down:

$$
\text{total latency}
=
\text{waiting for data}
+
\text{waiting for approval}
+
\text{waiting for capacity}
$$

Then an alert like:

```text
Training started 4 hours late
```

becomes diagnosable:

```text
3h 42m waiting for refunds
12m waiting for approval
6m waiting for GPU capacity
```

rather than merely "pipeline slow." The concepts are more important than the product, but modern orchestrators provide pieces of this architecture. For example, current Apache Airflow 3.x supports traditional timetable scheduling as well as asset-aware scheduling. Assets can trigger downstream DAGs when upstream data is updated, multiple assets can be combined, and Airflow 3 also supports external event-driven patterns through REST-pushed asset events or `AssetWatcher`s. ([Apache Airflow][1]) Dagster currently exposes schedules, sensors, asset sensors, declarative automation, partitions/backfills, asset checks, and concurrency-management concepts. Those primitives map naturally to time triggers, event polling, data-readiness conditions, historical partitions, and admission control. ([Dagster Docs][2])

Kubeflow Pipelines distinguishes individual runs from recurring runs; recurring runs can periodically instantiate runs and enforce a maximum number of concurrent runs. KFP runs can also be launched through its UI, SDK, CLI, or API, making it possible to put your own request/readiness layer in front of execution. ([Kubeflow][3]) The important point is not:

```text
"Airflow has feature X."
```

It is:

```text
Use the orchestrator as the mechanism.

Keep your correctness rules—
logical intervals,
readiness,
idempotency,
run identity,
replay policy—
explicit.
```

## What Does a Complete Training Trigger Lifecycle Look Like?
<!-- section-summary: All trigger sources converge on one request, readiness, policy, admission, execution, and result path with at most one accepted output. -->

The full lifecycle joins schedules, data events, alerts, and manual requests to one consistent admission and execution path.

Suppose you retrain a recommendations model daily. The business rule is:

```text
Every day, produce a model using the most recent
90 complete days of interactions.
```

At:

```text
2026-08-29 02:00
```

the scheduler emits:

```text
TrainingTrigger(
    model="recommendations",
    logical_date="2026-08-29",
    reason="scheduled"
)
```

The trigger handler derives:

```text
data_cutoff = 2026-08-29 00:00 UTC

training_window =
[2026-05-31 00:00,
 2026-08-29 00:00)
```

It computes:

```text
logical_run_id =
recommendations:2026-08-29:training-spec-v12
```

and performs an idempotent insert. The request becomes:

```text
WAITING_FOR_DATA
```

because:

```text
clicks     complete through Aug 29 00:00 ✓
purchases  complete through Aug 29 00:00 ✓
catalog    complete through Aug 28 23:00 ✗
```

At 02:17, a catalog-complete event arrives. It wakes the readiness evaluator. Now:

```text
clicks     ✓
purchases  ✓
catalog    ✓
DQ checks  ✓
```

The request moves:

```text
WAITING_FOR_DATA → READY
```

At 02:18 another copy of the catalog event arrives. Nothing happens:

```text
logical_run_id already exists
```

At 02:19 the executor starts:

```text
attempt_id = attempt-001
```

At 02:35 a machine failure occurs:

```text
attempt-001 = FAILED
```

The retry controller starts:

```text
attempt-002
```

but keeps:

```text
logical_run_id =
recommendations:2026-08-29:training-spec-v12
```

The second attempt succeeds. Later the audit trail can say:

```text
Logical request:
recommendations:2026-08-29:training-spec-v12

Reason:
daily schedule

Requested:
02:00

Data ready:
02:17

Started:
02:19

Attempts:
001 failed — infrastructure
002 succeeded

Input snapshot:
snapshot_98127

Model:
model_77410
```

That is what a well-designed training trigger system buys you. It helps to think of the whole architecture as three different layers:

```text
INTENT
"Why might we need training?"
        │
        │ triggers
        ▼
CORRECTNESS
"What exact run is intended,
and is it safe to execute?"
        │
        │ readiness + idempotency + policy
        ▼
EXECUTION
"Allocate machines and train."
```

A lot of brittle ML infrastructure skips the middle layer:

```text
trigger → GPU job
```

A robust system inserts it:

```text
trigger
   ↓
logical request
   ↓
stable identity
   ↓
data readiness
   ↓
deduplication
   ↓
approval/policy
   ↓
capacity admission
   ↓
execution attempt
```

**Triggers should create intent, not directly create compute.** A trigger can be early, late, duplicated, missing, manually generated, replayed, or produced by multiple independent systems. So design the training system so that none of those properties threaten correctness. The central invariant becomes:

$$
\boxed{
\text{One well-defined logical training request}
\rightarrow
\text{zero or more execution attempts}
\rightarrow
\text{at most one accepted training result}
}
$$

Once that invariant exists, cron schedules, event buses, drift detectors, retries, backfills, and manual retraining become different inputs to the same reliable control system rather than six unrelated ways of launching a training job.

![A safe trigger lifecycle records a proposal, resolves immutable inputs, evaluates readiness, reserves one logical key, submits idempotently, and links the pipeline run to audit evidence](/content-assets/articles/article-mlops-training-pipelines-scheduled-vs-event-based-training/safe-trigger-lifecycle.png)

*Pending and rejected requests preserve their exact evidence. Admitted work reaches one pipeline run, while reconciliation returns missing or ambiguous work to the request ledger.*

## Check Your Answers

Use these short answers to revisit the reasoning behind each section.

:::expand[Why Should a Trigger Create a Training Request Instead of Starting Compute?]{kind="recap"}
A trigger records intent and defines a logical request with an explicit interval and cutoff; readiness and policy decide whether execution may begin.
:::

:::expand[How Does the System Decide That Training Data Is Ready?]{kind="recap"}
Central readiness checks verify complete inputs, producer watermarks, data quality, and label maturity for the request's cutoff.
:::

:::expand[How Do Idempotency and Run Identities Handle Duplicate Triggers?]{kind="recap"}
Several messages can refer to one logical operation, so a stable logical run key deduplicates requests while attempt IDs preserve physical retries.
:::

:::expand[How Do Retry, Replay, Backfill, and Manual Requests Differ?]{kind="recap"}
Retries repeat failed execution, replays repeat pinned intent, backfills create historical logical runs, and manual requests still pass the same correctness checks.
:::

:::expand[How Do Request State and Concurrency Control Work Together?]{kind="recap"}
A durable request state machine separates readiness from capacity admission, while concurrency limits control simultaneous legitimate runs rather than duplicates.
:::

:::expand[How Does Reconciliation Recover Missing Events?]{kind="recap"}
Events provide quick notice, idempotency makes duplicates harmless, and periodic reconciliation recreates requests that missing events failed to produce.
:::

:::expand[What Evidence and Monitoring Belong to the Trigger Control Plane?]{kind="recap"}
The ledger records exact intent, trigger sources, readiness evidence, approvals, attempts, outputs, and latency spent waiting for data, approval, or capacity.
:::

:::expand[What Does a Complete Training Trigger Lifecycle Look Like?]{kind="recap"}
All trigger sources converge on one request, readiness, policy, admission, execution, and result path with at most one accepted output.
:::

## References

[1]: https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/assets.html "Asset Definitions — Airflow 3.3.1 Documentation"
[2]: https://docs.dagster.io/ "Overview | Dagster Docs"
[3]: https://www.kubeflow.org/docs/components/pipelines/concepts/run/ "Run and Recurring Run | Kubeflow"
