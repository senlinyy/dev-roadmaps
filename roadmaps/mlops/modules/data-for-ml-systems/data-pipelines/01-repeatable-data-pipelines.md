---
title: "Repeatable Data Pipelines"
description: "Learn how production data pipelines create trustworthy ML datasets through declared inputs, deterministic transformations, safe retries, validation, publication, lineage, and controlled backfills."
overview: "A repeatable data pipeline can rebuild a trustworthy ML dataset from declared source versions, reviewed transformation logic, and explicit run parameters. The production framework covers safe retries, validation, publication, lineage, backfills, recovery, ownership, and the roles of common industrial tools."
tags: ["MLOps", "production", "pipelines"]
order: 1
id: "article-mlops-data-for-ml-systems-repeatable-data-pipelines"
---

## Table of Contents

1. [What Makes an ML Data Pipeline Repeatable?](#what-makes-an-ml-data-pipeline-repeatable)
2. [Which Inputs, Clocks, and Environments Must a Run Control?](#which-inputs-clocks-and-environments-must-a-run-control)
3. [How Do Determinism, Idempotency, and Safe Retries Differ?](#how-do-determinism-idempotency-and-safe-retries-differ)
4. [How Do Private Builds and Atomic Publication Prevent Partial Data from Escaping?](#how-do-private-builds-and-atomic-publication-prevent-partial-data-from-escaping)
5. [How Does Validation Protect a Candidate Output?](#how-does-validation-protect-a-candidate-output)
6. [How Do Provenance, Lineage, and Immutable Versions Explain Each Output?](#how-do-provenance-lineage-and-immutable-versions-explain-each-output)
7. [How Do Logical Time and Backfills Rebuild Historical Windows?](#how-do-logical-time-and-backfills-rebuild-historical-windows)
8. [How Do Orchestration, Recovery, and Ownership Keep the Pipeline Operable?](#how-do-orchestration-recovery-and-ownership-keep-the-pipeline-operable)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A daily pipeline builds features for a payment-risk model. It reads transactions, joins account profiles, calculates recent spending totals, and appends the result to a training table. Halfway through, the job fails.

An operator retries it. During the gap, late transactions arrive and several profiles change. The retry reads the newer state and appends another set of rows. The job reports success, but the table now contains duplicate keys, mixed source versions, and different profile values for the same logical day.

A **repeatable pipeline** avoids that result by making its inputs, code, configuration, logical time, and output identity explicit. A retry repeats the same logical work safely. The pipeline builds privately, validates the candidate, publishes it atomically, and records enough history to explain or rebuild the result.

Follow one run through those controls:

1. **What Makes an ML Data Pipeline Repeatable?**
2. **Which Inputs, Clocks, and Environments Must a Run Control?**
3. **How Do Determinism, Idempotency, and Safe Retries Differ?**
4. **How Do Private Builds and Atomic Publication Prevent Partial Data from Escaping?**
5. **How Does Validation Protect a Candidate Output?**
6. **How Do Provenance, Lineage, and Immutable Versions Explain Each Output?**
7. **How Do Logical Time and Backfills Rebuild Historical Windows?**
8. **How Do Orchestration, Recovery, and Ownership Keep the Pipeline Operable?**

## What Makes an ML Data Pipeline Repeatable?

<!-- section-summary: A repeatable pipeline defines its output as a function of versioned inputs, code, configuration, logical time, and environment. -->

A data pipeline is frequently described as:

$$
\text{raw data} \rightarrow \text{transformations} \rightarrow \text{dataset}
$$

But for an ML system, that description hides the hardest requirement. You commonly need to be able to answer:

**If I run this pipeline again, can I reconstruct the same logical dataset, understand exactly how it was produced, and safely replace it if necessary?**

That is the essence of a **repeatable data pipeline**. Its output can be described as a function of every controlled input:

$$
\boxed{
\text{Output}
=
F(
\text{inputs},
\text{code},
\text{configuration},
\text{time window},
\text{environment}
)
}
$$

A pipeline is repeatable once every variable that determines $$F$$ is controlled or recorded.

### Why repeatability matters more in ML than it first appears

Imagine you train:

$$
M_1 = \text{Train}(D_1)
$$

and obtain 92% validation accuracy. Two months later you discover a strange prediction and ask:

"What exactly was in $$D_1$$?"

If the answer is:

"Whatever happened to be in the database when the pipeline ran that morning,"

then you don't really have a reproducible ML system. You have a historical accident. The model artifact may still exist:

```text
model_v42
```

but the process that created its training data may be impossible to reconstruct. That creates problems with:

* debugging,
* audits,
* experiments,
* model comparisons,
* incident recovery,
* feature changes,
* label corrections,
* backfills,
* regulatory investigations.

So the deeper purpose of a repeatable pipeline is:

$$
\boxed{
\text{Turn data production from an event into a reproducible computation.}
}
$$

### Start by treating the pipeline as a function

Suppose we have:

```text
transactions
customers
fraud_labels
```

and want to produce:

```text
fraud_training_examples
```

Conceptually:

$$
D =
F(T,C,L)
$$

But this is incomplete. Which transactions? Which version of the customer table?

Labels as known when? Which transformation code? A more accurate description is:

$$
D_{2026-08-01}
=
F(
T_{\leq 2026-08-01},
C_{\leq 2026-08-01},
L_{\leq 2026-08-01},
\text{code}=v17
)
$$

Now the computation has a precise meaning. Repeatability starts when these dependencies stop being implicit.

### The enemy of repeatability is hidden state

Consider this pipeline:

```python
customers = read_database("customers")
transactions = read_database("transactions")

output = transform(customers, transactions)
```

It looks simple. But what does:

```text
read_database("customers")
```

mean? It means roughly:

Give me whatever happens to exist right now.

Run it Monday:

$$
F(X_{\text{Monday}})
$$

Run it Wednesday:

$$
F(X_{\text{Wednesday}})
$$

You did not repeat the same computation. You performed two different computations. This distinction is fundamental:

$$
\boxed{
\text{same pipeline code}
\neq
\text{same pipeline computation}
}
$$

Repeatability requires controlling the **inputs**, not merely the code.

## Which Inputs, Clocks, and Environments Must a Run Control?

<!-- section-summary: The run pins source snapshots or cutoffs, event and availability-time rules, parameters, random seeds, reference data, code revision, dependency environment, and intended output identity. -->

### Declare the inputs explicitly

Suppose you're building daily features for August 20. A weak input specification is:

```text
Read the transactions table.
```

A stronger specification is:

```text
Read transactions whose event time is:

2026-08-20 00:00:00
≤ timestamp <
2026-08-21 00:00:00
```

Or even better:

```text
transactions snapshot: version 481
customer snapshot: version 239
label snapshot: version 712
pipeline code: commit abc123
configuration: production-v4
window: 2026-08-20
```

Now the output has identifiable causes. Conceptually:

$$
O =
F(I_1^{v_1},I_2^{v_2},\ldots,I_n^{v_n})
$$

where each $$I_i^{v_i}$$ is an identifiable version of an input.

### Time is part of the input

This becomes especially important in ML. Suppose you want a feature:

```text
purchases_last_30_days
```

The answer depends on **when** you're asking. For prediction at time $$t$$:

$$
\text{purchase\_count}_{30d}(t)
=
\sum_i
1[t-30d \le t_i < t]
$$

Without $$t$$, the feature is undefined. So a feature pipeline is more accurately:

$$
X =
F(\text{raw data}, t)
$$

rather than merely:

$$
X=F(\text{raw data})
$$

Explicit time windows are therefore a basic requirement for rebuilding an ML pipeline result.

### Distinguish event time from processing time

Suppose a purchase occurs at:

```text
10:04
```

but your system receives it at:

```text
10:11
```

There are two times:

$$
t_e = \text{event time}
$$

and:

$$
t_p = \text{processing time}
$$

These mean different things. If you construct hourly features for:

```text
10:00–11:00
```

does the event belong there? Usually, from a business perspective, yes:

$$
10{:}04 \in [10{:}00,11{:}00)
$$

even though the pipeline only learned about it at 10:11. The result creates the problem of **late-arriving data**. A repeatable pipeline therefore needs explicit rules about:

* which timestamp defines the window,
* how long to wait for late data,
* whether historical windows can change,
* when a window is considered final.

Without fixed cutoff and lateness rules, a request for "the August 20 dataset" can return different contents depending on the day it runs.

![A failed pipeline attempt writing to isolated staging, followed by a safe retry, validation, and one atomic published version](/content-assets/articles/article-mlops-data-for-ml-systems-repeatable-data-pipelines/safe-retry-and-publish.png)

*Staging and atomic publication let an operator retry a failed run without exposing duplicate or partial data to readers.*

## How Do Determinism, Idempotency, and Safe Retries Differ?

<!-- section-summary: Determinism means equivalent declared inputs produce equivalent results. -->

### Same logical inputs should produce the same logical output

At first glance this seems obvious:

$$
F(X)=Y
$$

Therefore:

$$
F(X)=Y
$$

again. But real data systems contain many sources of nondeterminism. For example:

```python
sample(frac=0.1)
```

without a fixed random seed. Or:

```text
SELECT *
LIMIT 1000
```

without a deterministic ordering. Or assigning IDs based on:

```text
whatever worker finishes first
```

Or using:

```python
current_time()
```

inside the transformation. Then:

$$
F(X)_1 \neq F(X)_2
$$

even though the apparent input is identical.

### Determinism usually requires controlling randomness

Machine learning frequently needs randomness:

```text
train/test split
negative sampling
record sampling
augmentation
shuffling
```

Randomness itself isn't the problem. Uncontrolled randomness is. Instead of:

$$
Y=F(X,R)
$$

where $$R$$ is arbitrary randomness, use:

$$
Y=F(X,R_s)
$$

where $$R_s$$ is generated from a known seed $$s$$. For example:

```text
split_seed = 84721
```

Then the seed becomes part of the computation's configuration. That makes the randomness repeatable.

### Determinism is not always byte-for-byte identity

Distributed systems complicate this. Suppose two workers calculate:

$$
a+b+c+d
$$

in different orders. Floating-point arithmetic is not perfectly associative:

$$
(a+b)+c
$$

can differ slightly from:

$$
a+(b+c)
$$

So distributed execution may occasionally produce tiny numerical differences. Therefore what you commonly require is **logical determinism**:

The same records, features, labels, and materially equivalent numerical results are produced.

Not necessarily:

Every byte of every intermediate file must be identical.

The required level of determinism depends on the use case.

### Every run should be safe to retry

Now imagine a daily pipeline:

```text
Read August 20 data
↓
Compute features
↓
Write output
```

Halfway through writing, the worker crashes. The scheduler retries. What happens?

If the pipeline blindly appends the data again:

```text
first attempt  → 400,000 rows
retry          → another 400,000 rows
```

you now have:

```text
800,000 rows
```

The retry corrupted the dataset. This leads to one of the most important properties in reliable pipelines:

$$
\boxed{\text{idempotency}}
$$

An operation is idempotent when:

$$
f(f(x))=f(x)
$$

Operationally:

Running the same pipeline for the same logical window multiple times should have the same effect as running it once.

### Prefer at-least-once execution plus idempotency

People sometimes aim for:

```text
exactly once
```

execution. In distributed systems, guaranteeing exactly-once execution everywhere can be difficult. A very practical design is:

$$
\boxed{
\text{at-least-once execution}
+
\text{idempotent output}
}
$$

The scheduler is allowed to retry. Your pipeline is designed so retries are harmless. Consider instead of:

```text
append rows to daily_features
```

use:

```text
replace partition:
date = 2026-08-20
```

Then:

```text
run #1 → writes August 20
run #2 → replaces August 20
run #3 → replaces August 20
```

The logical dataset still contains one August 20 partition.

### A logical run needs an identity

A powerful concept is to give each unit of work a logical key. For example:

$$
K =
(\text{pipeline},\text{date})
$$

Such as:

```text
pipeline = daily_fraud_features
window   = 2026-08-20
```

Then retries refer to the same work:

```text
daily_fraud_features / 2026-08-20
```

rather than creating new logical work every time. You might expand this to:

$$
K=
(\text{pipeline version},\text{window},\text{configuration})
$$

depending on your system.

## How Do Private Builds and Atomic Publication Prevent Partial Data from Escaping?

<!-- section-summary: The pipeline writes a private candidate and checks source completeness, structure, keys, values, relationships, time, population, labels, and expected scope. -->

### Build privately before publishing publicly

Suppose the final dataset is:

```text
features/2026-08-20
```

A dangerous pipeline writes directly into that location:

```text
production output
    ↑
pipeline actively writing
```

What happens if another system reads it halfway through? It might see:

```text
40% of the data
```

and assume that is the complete dataset. This violates an important principle:

$$
\boxed{
\text{Incomplete output should not look complete.}
}
$$

### Build, validate, then publish

A safer pattern is:

```text
input
  ↓
compute
  ↓
temporary/staging output
  ↓
validate
  ↓
atomic publish
  ↓
official output
```

For example:

```text
_staging/run_8712/
```

gets written first. Then validation checks:

```text
expected columns present
row count plausible
primary key unique
null rates acceptable
timestamps within window
feature constraints valid
```

The pipeline exposes the dataset under its published identity only after every required check succeeds:

```text
features/date=2026-08-20
```

This resembles a database transaction:

$$
\text{prepare}
\rightarrow
\text{validate}
\rightarrow
\text{commit}
$$

### Publishing should be atomic from the reader's perspective

Imagine replacing version 10 with version 11. Bad publication:

```text
delete v10
copy file 1 of v11
copy file 2 of v11
copy file 3 of v11
...
```

Readers can see an intermediate state. Better:

```text
build v11 completely
↓
validate v11
↓
switch pointer:
current → v11
```

The reader sees either:

$$
v10
$$

or:

$$
v11
$$

but never:

$$
0.37\times v11
$$

This property is frequently called **atomic publication**.

### Why atomicity matters especially for ML

Suppose training uses 100 feature shards:

```text
part-001
part-002
...
part-100
```

If training starts while only 63 shards have arrived, it may happily train on incomplete data. No Python exception is required. You merely get the wrong model.

Therefore a common production principle is:

$$
\boxed{
\text{Consumers read only committed datasets.}
}
$$

Not:

Consumers infer completeness by looking at whatever files currently exist.

## How Does Validation Protect a Candidate Output?

<!-- section-summary: Atomic publication exposes one complete validated version through a snapshot, manifest, or metadata transaction. -->

### Validate the output, not only the input

Even perfect inputs can produce bad outputs. Suppose:

```text
transactions
```

passes every quality check. Then a bug occurs:

```python
amount_usd = amount_cents * 100
```

instead of:

```python
amount_usd = amount_cents / 100
```

Input validation passes. Output is wrong. Therefore:

$$
\text{valid inputs}
\not\Rightarrow
\text{valid outputs}
$$

The artifact that consumers receive needs its own assertions; validating only intermediate steps leaves the publication boundary unprotected.

### Useful publication checks

Suppose we're producing daily customer features. We might verify:

#### Structural invariants

```text
customer_id exists
customer_id unique
required columns present
expected types
```

#### Cardinality

$$
0.9N_{\text{expected}}
<
N_{\text{actual}}
<
1.1N_{\text{expected}}
$$

#### Missingness

$$
P(\text{age missing}) < 0.05
$$

#### Value constraints

$$
0 \le \text{account age} \le 20\text{ years}
$$

#### Time consistency

For an August 20 output:

$$
t_{\text{event}} < 2026\text{-}08\text{-}21
$$

#### ML-specific checks

For every feature:

$$
t_{\text{feature available}}
\le
t_{\text{prediction}}
$$

to protect against leakage. Publication is allowed only after the artifact satisfies its contract.

![The source snapshot, time window, code version, parameters, and data contract joined into one published dataset identity](/content-assets/articles/article-mlops-data-for-ml-systems-repeatable-data-pipelines/pipeline-run-identity.png)

*A scheduler can coordinate the work, while the run record preserves the exact evidence that gives the published dataset its identity.*

## How Do Provenance, Lineage, and Immutable Versions Explain Each Output?

<!-- section-summary: Provenance records the exact inputs, code, configuration, environment, times, and run that produced one artifact. -->

### Record exactly how each output was produced

Suppose you discover:

```text
features/date=2026-08-20
```

What should you be able to ask? Ideally:

```text
Which source snapshots produced this?
Which code version?
Which configuration?
Which parameters?
Which pipeline run?
When was it generated?
Which validation checks passed?
```

This information forms the artifact's **provenance**. For example:

```text
artifact:
  customer_features_2026_08_20_v3

inputs:
  transactions_snapshot_882
  customers_snapshot_307

code:
  git_commit = f93ac71

configuration:
  prod/features_v6.yaml

window:
  [2026-08-20, 2026-08-21)

created_by:
  run_178291

quality_result:
  validation_991
```

Now you have a causal explanation of the output.

### Lineage and provenance are related but slightly different

You can think of **provenance** as:

What specifically produced this artifact?

And **lineage** as:

How do artifacts depend on one another?

For example:

```text
transactions_raw
       ↓
clean_transactions
       ↓
order_features ─────┐
                    ↓
                 training_set
                    ↓
                 model_v17
```

If `transactions_raw` was corrupted, lineage lets you calculate the blast radius. Which means:

```text
bad raw partition
↓
which cleaned partition?
↓
which feature partition?
↓
which training dataset?
↓
which model?
```

Repeatability and recovery depend heavily on this graph.

### The output should be versioned

Imagine rebuilding August 20 after discovering an upstream bug. You could overwrite:

```text
features/2026-08-20
```

But now the name refers to something different than it did yesterday. That destroys historical reproducibility. A better design is:

```text
features/
  date=2026-08-20/
    version=1
    version=2
```

where:

```text
v1 = original
v2 = corrected rebuild
```

Then some metadata can declare:

```text
current version = 2
```

But historical consumers can still say:

```text
model_v41 used features 2026-08-20 v1
```

### Immutability simplifies reasoning enormously

There are two broad strategies:

#### Mutable

```text
dataset_X
```

changes over time.

#### Immutable/versioned

```text
dataset_X_v1
dataset_X_v2
dataset_X_v3
```

The second requires more metadata and storage. But it gives a powerful invariant:

$$
\boxed{
\text{Once published, artifact } A_v
\text{ never changes meaning.}
}
$$

That makes:

* debugging,
* backfills,
* experiments,
* audits,
* model reproduction

far easier. Storage is frequently cheaper than confusion.

## How Do Logical Time and Backfills Rebuild Historical Windows?

<!-- section-summary: Partitions and runs use a declared logical window rather than the current clock. -->

### Schedule logical time windows, not vague "runs"

Suppose someone says:

"Run the pipeline every day at 2 AM."

That describes **when computation starts**. It does not describe **what computation means**. A stronger definition is:

At 02:00 on August 21, compute the window
$$[2026\text{-}08\text{-}20,2026\text{-}08\text{-}21)$$.

The logical unit is:

$$
W_d=[d,d+1)
$$

The schedule merely determines when $$W_d$$ gets computed. This separation is crucial.

### Logical time should be independent from wall-clock execution time

Imagine the August 20 job fails and is rerun on August 24. The pipeline should still compute:

$$
W=[\text{Aug 20},\text{Aug 21})
$$

It should not accidentally become:

$$
W=[\text{yesterday},\text{today})
$$

based on when the retry happens. This is a classic source of irreproducibility. Bad pipeline:

```python
start = now() - timedelta(days=1)
end = now()
```

Better conceptual pipeline:

```python
def build_features(window_start, window_end):
    ...
```

The orchestrator supplies:

```text
window_start = 2026-08-20
window_end   = 2026-08-21
```

Now a retry next month still means exactly the same thing.

### This gives us an important separation

There are two clocks:

$$
\boxed{
\text{logical data time}
\neq
\text{execution time}
}
$$

For example:

```text
logical window:
August 20

first execution:
August 21 at 02:00

retry:
August 21 at 02:37

historical rebuild:
September 15 at 11:03
```

All three executions may compute the same logical window:

```text
August 20
```

That is the foundation of reliable backfills.

### Backfills should be a normal operation

Suppose you discover on September 1 that a feature calculation has been wrong since August 1. Affected partitions:

$$
\text{Aug 1},\text{Aug 2},\ldots,\text{Aug 31}
$$

You need to rebuild 31 days. If the pipeline was designed only for:

```text
today
```

you now have an operational nightmare. If the pipeline was designed as:

$$
F(W_d)
$$

for arbitrary day $$d$$, rebuilding history is straightforward:

```text
for each date Aug 1...Aug 31:
    run feature_pipeline(date)
```

Historical rebuilding must be part of the initial design, because the first incident is too late to recover inputs and rules that were never retained.

### A repeatable pipeline should be parameterized by the logical unit of work

For daily pipelines:

$$
F(\text{date})
$$

For hourly pipelines:

$$
F(\text{hour})
$$

For customer-based work:

$$
F(\text{customer shard})
$$

Sometimes:

$$
F(\text{date},\text{region})
$$

The important thing is that the work has an explicit identity. For example:

```text
date=2026-08-20
region=UK
```

That gives you a natural unit for:

* retries,
* ownership,
* validation,
* backfills,
* partitioning,
* observability.

### But backfills introduce dependencies

Imagine:

```text
daily_transactions
        ↓
daily_customer_features
        ↓
weekly_training_dataset
```

You fix August 20 transactions. Now what must be rebuilt? At least:

```text
daily_customer_features / Aug 20
```

Potentially also:

```text
weekly_training_dataset / week containing Aug 20
```

And perhaps:

```text
models trained from that dataset
```

So backfill planning is really a lineage problem:

$$
\text{changed input}
\rightarrow
\text{affected descendants}
$$

A mature system should make that dependency explicit.

### Incremental pipelines require especially careful state management

Suppose yesterday we processed records through ID 10,000. Today we process:

```text
10,001 → 11,000
```

That can be efficient. But now the pipeline contains hidden state:

```text
last_processed_id = 10,000
```

If this state becomes wrong, so does the pipeline. Incremental computation therefore trades computational efficiency for state-management complexity. Conceptually:

#### Full recomputation

$$
O_t=F(I_{\le t})
$$

Simple semantics, potentially expensive.

#### Incremental

$$
O_t=G(O_{t-1},\Delta I_t)
$$

Efficient, but correctness depends on:

$$
O_{t-1}
$$

and:

$$
\Delta I_t
$$

both being correct. This is why pipelines should be designed so historical state can still be rebuilt from authoritative inputs when necessary.

### Keep source-of-truth data separate from derived state

A useful hierarchy is:

```text
authoritative raw data
        ↓
cleaned data
        ↓
derived features
        ↓
training datasets
        ↓
models
```

Ideally, derived layers are rebuildable. That gives you the principle:

$$
\boxed{
\text{Derived data should be disposable if authoritative inputs survive.}
}
$$

Not necessarily cheap to recompute. But logically reconstructable. This is a very powerful reliability property.

### ML pipelines have an additional time problem: point-in-time correctness

Suppose you're training a credit-risk model. For a loan decision at:

```text
2025-03-01 14:00
```

you want the customer's balance as known at 14:00. Not their latest balance today. Suppose today's table says:

```text
customer_id = 42
balance = £500
```

But at prediction time it was:

```text
balance = £8,200
```

Joining training examples to the current customer table produces the wrong historical feature. So ML pipelines frequently need a **point-in-time join**. For prediction time $$t$$:

$$
\text{feature value}
=
\text{latest value where}
\quad
t_{\text{feature}} \le t
$$

This protects against future information leaking backward into historical examples.

### Repeatability and leakage prevention are connected

Suppose a historical training pipeline does:

```sql
JOIN customers USING customer_id
```

against today's customer table. Run the pipeline today:

$$
D_1
$$

Run it one month later:

$$
D_2
$$

Even with the same historical examples:

$$
D_1 \neq D_2
$$

because customer information has changed. Worse, $$D_2$$ may include information that did not exist at prediction time. So versioned, point-in-time inputs solve two problems simultaneously:

$$
\boxed{
\text{repeatability}
+
\text{leakage prevention}
}
$$

### Labels need similar treatment

Suppose a transaction occurred on January 1. On January 5:

```text
fraud = unknown
```

On February 10:

```text
fraud = confirmed
```

What should a historical rebuild use? That depends on what you're reproducing. If you want:

"Recreate exactly what the January 7 training run knew,"

you need the label snapshot as of January 7. If you want:

"Build the best corrected dataset using mature labels,"

you may deliberately use the later confirmed label. These are two different pipeline modes. One is **historical reproduction**.

The other is **historical reconstruction with corrected knowledge**. A mature system should distinguish them.

### "repeat the pipeline" can mean two different things

#### Reproduce the old artifact

Use:

```text
same input versions
same code version
same configuration
```

Then aim for:

$$
O_{\text{new}}\approx O_{\text{old}}
$$

#### Recompute history using corrected information

Use:

```text
same logical time window
new corrected inputs
possibly new code
```

Then you expect:

$$
O_{\text{new}}\neq O_{\text{old}}
$$

and that difference is intentional. This distinction is incredibly useful during ML incidents.

## How Do Orchestration, Recovery, and Ownership Keep the Pipeline Operable?

<!-- section-summary: The processing engine performs transformations, while the orchestrator manages dependencies, schedules, retries, backfills, and alerts. -->

### Orchestration is not the same as data processing

There are two different jobs.

#### Processing engine

Answers:

How do I transform a lot of data?

Examples of capabilities:

```text
joins
aggregations
group-by
window functions
distributed computation
streaming
```

#### Orchestrator

Answers:

When should each computation run, in what order, and what happens if it fails?

Capabilities include:

```text
dependencies
scheduling
retries
backfills
run history
alerts
parameters
resource policies
```

Conceptually:

```text
orchestrator
     │
     ├── run ingestion
     │
     ├── wait
     │
     ├── run validation
     │
     ├── run features
     │
     └── publish
```

You frequently need both.

### Choose processing tools based on the workload

The fundamental question is not:

"Which data tool is best?"

It is:

"What computational properties does this pipeline require?"

For example:

#### Small datasets

A single machine may be sufficient. Advantages:

```text
simple
cheap
easy to debug
```

#### Large batch datasets

You may need distributed execution. Requirements:

```text
partitioning
parallelism
shuffle handling
fault recovery
```

#### Low-latency streams

You may need:

```text
continuous processing
event-time semantics
watermarks
stateful aggregations
```

The goal isn't to maximize architectural sophistication. It's to choose the simplest machinery that satisfies:

$$
\text{volume}
+
\text{latency}
+
\text{reliability}
+
\text{cost}
$$

requirements.

### Choose orchestration tools based on failure semantics

A scheduler that can merely say:

```text
run this at 2 AM
```

may be enough for very simple jobs. Production ML frequently eventually needs more:

```text
Run B only if A succeeded.
Retry A three times.
Do not publish partial B.
Backfill August 1–31.
Record run parameters.
Alert someone after persistent failure.
Prevent overlapping runs.
Expose historical run status.
```

Those are orchestration concerns. The important design principle is:

$$
\boxed{
\text{Operational semantics matter more than cron syntax.}
}
$$

### Failure should be designed, not treated as exceptional

Failures are normal:

```text
network timeout
worker crash
bad source partition
database unavailable
schema changed
disk full
late input
quality check failed
```

So instead of asking:

"How do we prevent every failure?"

ask:

"What happens when each class of failure occurs?"

For example:

```text
transient infrastructure failure
        ↓
automatic retry
```

versus:

```text
data validation failure
        ↓
do not retry forever
        ↓
quarantine
        ↓
notify data owner
```

versus:

```text
code bug
        ↓
stop publication
        ↓
fix code
        ↓
backfill affected windows
```

Different failures need different recovery semantics.

### Decide who owns failures

An alert such as:

```text
daily_features failed
```

is useful only if somebody is responsible for acting on it. Every production pipeline should have answers to questions like:

```text
Who owns this pipeline?
Who owns each upstream dependency?
What severity is a missed run?
How long can the output remain stale?
Who can authorize a backfill?
What happens if data quality fails?
Which downstream models are affected?
```

Reliability is partly software design and partly organizational design. A pipeline with perfect monitoring but no clear owner is not operationally reliable.

### Freshness is part of the pipeline contract

Suppose an ML service expects:

```text
customer features no older than 6 hours
```

Then even perfectly correct data can become unusable merely by being late. Define freshness:

$$
\text{freshness lag}
=
t_{\text{now}}
-
t_{\text{latest successful data}}
$$

Then require:

$$
\text{freshness lag} < \tau
$$

where $$\tau$$ is the maximum acceptable staleness. The result creates an observable service-level expectation for data.

### A pipeline should expose more than success/failure

Imagine the dashboard says:

```text
SUCCESS
```

What does that actually prove? Maybe only that:

```text
the Python process exited with code 0
```

That isn't enough. A useful pipeline run might expose:

```text
logical window
input versions
input row counts
output row count
validation results
execution duration
data freshness
published artifact version
code version
retry count
```

These records let operators explain the pipeline's behavior instead of treating it as an opaque sequence of jobs.

### Distinguish computation success from publication success

A pipeline might successfully compute an artifact that fails validation. So:

$$
\text{computation succeeded}
$$

does not imply:

$$
\text{dataset should be published}
$$

A better state machine is something like:

```text
PENDING
  ↓
RUNNING
  ↓
COMPUTED
  ↓
VALIDATING
  ↓
VALIDATED
  ↓
PUBLISHED
```

with failure states such as:

```text
COMPUTE_FAILED
VALIDATION_FAILED
PUBLISH_FAILED
```

This tells operators what actually happened.

### Avoid readers depending on "latest" when reproducibility matters

Suppose a training configuration says:

```text
features = latest
labels = latest
```

Training is convenient. But what does `latest` mean six months later? Probably something different.

Before an experiment or model build starts, resolve any mutable alias to an immutable identifier:

```text
latest
    ↓ resolved at run start
features_v817
```

Then the training record stores:

```text
features_v817
```

not:

```text
latest
```

Aliases are useful for humans. Immutable versions are useful for machines and history.

### Separate pipeline definitions from pipeline runs

Suppose we define:

```text
daily_customer_features v7
```

This is the **pipeline definition**. Then execute it for:

```text
2026-08-20
```

That creates a **pipeline run**. And the run publishes:

```text
customer_features/
date=2026-08-20/
version=3
```

That is an **artifact**. These are different concepts:

$$
\boxed{
\text{Pipeline Definition}
\rightarrow
\text{Pipeline Run}
\rightarrow
\text{Artifact}
}
$$

Keeping them separate makes lineage much easier to understand.

### A practical metadata model

You might conceptually record:

```text
Pipeline:
    daily_customer_features
    version: 7

Run:
    id: run_98112
    logical_window: 2026-08-20
    started: 2026-08-21 02:00
    completed: 2026-08-21 02:13
    status: published

Inputs:
    customers_snapshot_177
    transactions_snapshot_812

Code:
    commit_f981ac

Output:
    customer_features_2026-08-20_v3

Validation:
    validation_run_711

Parent runs:
    transaction_cleanup_2026-08-20
```

With metadata like this, a model can eventually say:

```text
model_v71
   ↓
training_dataset_v612
   ↓
feature partitions
   ↓
source snapshots
```

That is a debuggable ML system.

### Think carefully about partial recomputation

Suppose August contains 31 daily partitions:

```text
Aug 01
Aug 02
...
Aug 31
```

Only August 12 is corrupt. You don't necessarily want to rebuild the entire month. Partitioning enables:

$$
\text{repair scope}
\approx
\text{damage scope}
$$

For example:

```text
rebuild Aug 12
↓
rebuild monthly aggregate that depends on Aug 12
```

rather than:

```text
recompute all historical data ever produced
```

Partition boundaries influence safe retries and repairs as well as query speed, which makes them an operational design choice.

### Partition boundaries should correspond to meaningful recomputation units

Useful partitions might be:

```text
date
hour
region
customer shard
event type
```

A good partition should ideally:

1. be independently computable,
2. be independently validatable,
3. be independently replaceable,
4. correspond to a likely recovery unit.

Too large:

```text
one file containing five years
```

makes repair expensive. Too small:

```text
one object per individual record
```

creates excessive operational overhead. So partitioning is fundamentally a trade-off between:

$$
\text{granularity}
\leftrightarrow
\text{operational complexity}
$$

### A simple but strong production pattern

Suppose we're building daily training features. A practical design might be:

```text
                  scheduler
                      │
                      ▼
             logical date = D
                      │
                      ▼
          resolve immutable inputs
                      │
                      ▼
               staging compute
                      │
                      ▼
               quality checks
                  ↙       ↘
              FAIL        PASS
                │           │
           quarantine       ▼
                │      publish version
             alert          │
                            ▼
                    mark partition ready
                            │
                            ▼
                     downstream jobs
```

Each run records:

```text
date
input versions
code version
configuration
validation result
output version
```

And running it again for the same date is safe. That architecture is already surprisingly strong.

### Walk through one complete example

Suppose you build a churn model. Every day you create customer features. For August 20:

$$
W=[2026\text{-}08\text{-}20,2026\text{-}08\text{-}21)
$$

The scheduler starts the work on August 21.

#### Step 1 — Resolve inputs

```text
customers_snapshot_514
events through 2026-08-21 00:00
subscriptions_snapshot_128
```

These are recorded.

#### Step 2 — Compute

For each customer:

```text
sessions_last_7_days
purchases_last_30_days
support_tickets_last_90_days
subscription_age
```

All time-relative calculations use the logical reference time:

$$
t=2026\text{-}08\text{-}21\ 00{:}00
$$

not:

```text
current system time
```

#### Step 3 — Write staging output

```text
_staging/
run_89112/
```

No downstream consumer can use it yet.

#### Step 4 — Validate

Checks include:

```text
one row per customer
expected columns
no future events
null rates within bounds
customer count plausible
feature ranges plausible
```

#### Step 5 — Publish

If validation passes:

```text
customer_features/
date=2026-08-20/
version=3/
```

becomes committed.

#### Step 6 — Record provenance

```text
artifact:
customer_features_2026-08-20_v3

built_from:
customers_snapshot_514
events_snapshot_731
subscriptions_snapshot_128

code:
commit_a871be
```

#### Step 7 — Retry safely

Suppose publishing fails. The orchestrator reruns August 20. The pipeline writes a fresh staged artifact and then atomically replaces or republishes the logical partition.

No duplicate rows appear.

#### Step 8 — Historical correction

A month later you find a bug affecting August 10–20. You run:

```text
D = Aug 10
D = Aug 11
...
D = Aug 20
```

with corrected code. New artifact versions are produced. The old versions remain associated with models that historically used them.

That is repeatability in practice.

### What does not make a pipeline repeatable?

Several things can create the illusion of repeatability.

#### "It's in source control."

Good, but code versioning alone is insufficient. Inputs may have changed.

#### "The job runs every night."

Scheduling is not repeatability. A regularly executed nondeterministic pipeline is merely regularly nondeterministic.

#### "We can rerun it."

Can you rerun **the same logical computation**? If rerunning reads different mutable data, you're running something else.

#### "Our database is backed up."

Backups help disaster recovery. They do not automatically encode:

```text
which snapshot
which code
which configuration
which window
which labels
```

produced an artifact.

#### "The task succeeded."

Process success is not data correctness. The output still needs validation.

### Make time and state explicit

Most irreproducible pipelines contain hidden versions of these:

```text
whatever data exists now
current date
latest customer record
most recent label
last successful position
random sample
current configuration
```

Repeatability comes from replacing hidden state with explicit state. Instead of:

```text
today
```

use:

```text
logical_date = 2026-08-20
```

Instead of:

```text
latest table
```

use:

```text
snapshot = 482
```

Instead of:

```text
random sample
```

use:

```text
seed = 9917
```

Instead of:

```text
current code
```

use:

```text
commit = abc123
```

The recurring pattern is:

$$
\boxed{
\text{implicit dependency}
\rightarrow
\text{explicit parameter/version}
}
$$

### Pipelines are build systems for data

Software has build systems:

```text
source code
+
dependencies
+
compiler configuration
↓
binary
```

A data pipeline is conceptually similar:

```text
source datasets
+
transformation code
+
configuration
+
logical time
↓
dataset artifact
```

For software, you care about:

```text
which source commit?
which dependencies?
which compiler?
which build flags?
```

For data, you should care about:

```text
which input versions?
which code?
which date/window?
which configuration?
which quality rules?
```

The build-system analogy fits ML well because a training run can be described as another derived artifact build:

```text
training dataset
+
training code
+
hyperparameters
+
random seed
↓
model artifact
```

So the complete system becomes:

$$
\text{raw data}
\rightarrow
\boxed{\text{data build}}
\rightarrow
\text{training dataset}
\rightarrow
\boxed{\text{model build}}
\rightarrow
\text{model}
$$

### Repeatability is an end-to-end property

You cannot commonly bolt repeatability onto the final step. Suppose:

```text
source database
↓
daily extraction
↓
cleaning
↓
features
↓
training dataset
```

If the extraction layer overwrites history, then carefully versioning the training dataset cannot reconstruct what the extractor originally saw. So repeatability must propagate through the chain:

$$
\boxed{
\text{versioned source}
\rightarrow
\text{repeatable transforms}
\rightarrow
\text{versioned outputs}
}
$$

End-to-end reproducibility requires control over every important dependency between source data and the published artifact.

### What every repeatable ML pipeline ultimately needs to answer

For an artifact $$A$$, you should ideally be able to answer:

#### What?

What exactly does the artifact represent?

```text
customer features for August 20
```

#### When?

Which logical period?

$$
[2026\text{-}08\text{-}20,
2026\text{-}08\text{-}21)
$$

#### From what?

Which input versions?

#### How?

Which transformation code and configuration?

#### Is it complete?

Did validation succeed before publication?

#### Can I safely retry it?

Will another execution create duplicates or corruption?

#### Can I rebuild it?

Can the same logical window be recomputed later?

#### What depends on it?

Which datasets and models use it? These questions are more important than the specific orchestration technology.

### A compact checklist derived from the principles

For each production ML data pipeline, ask:

| Principle       | Question                                                     |
| --------------- | ------------------------------------------------------------ |
| Explicit inputs | Can I identify every important input version?                |
| Explicit time   | What exact logical window does this run represent?           |
| Determinism     | Will equivalent inputs produce equivalent output?            |
| Idempotency     | Can I safely retry the same work?                            |
| Isolation       | Can readers see incomplete output?                           |
| Validation      | Is output checked before becoming official?                  |
| Atomicity       | Do readers see one complete version at a time?               |
| Versioning      | Can historical artifacts retain their meaning?               |
| Provenance      | Can I explain exactly how this artifact was produced?        |
| Lineage         | Can I find everything affected by bad input?                 |
| Backfills       | Can arbitrary historical windows be rebuilt?                 |
| Observability   | Can operators tell whether data is stale, missing, or wrong? |
| Ownership       | Does someone know what to do when it fails?                  |

Several "no" answers reveal a pipeline that may complete on ordinary days yet offers little help during failure or investigation.

### What to remember

A repeatable pipeline is not merely one that can execute twice. It is one where a data artifact can be described as a controlled computation:

$$
\boxed{
O =
F(
I,
C,
P,
W
)
}
$$

where:

$$
I=\text{versioned inputs}
$$

$$
C=\text{code version}
$$

$$
P=\text{parameters/configuration}
$$

$$
W=\text{logical time window}
$$

The pipeline then adds four operational guarantees:

$$
\boxed{
\text{deterministic}
+
\text{idempotent}
+
\text{validated}
+
\text{atomically published}
}
$$

and records enough history to answer:

$$
\boxed{
\text{Where did this dataset come from?}
}
$$

Finally, it must treat historical recomputation as normal:

$$
\boxed{
\text{today's run and a backfill are the same computation over different windows}
}
$$

The deepest principle is this:

> **Never let important state remain implicit.**

Make the input version explicit. Make time explicit. Make randomness explicit. Make code versions explicit. Make publication state explicit. Make dependencies explicit. Once those things are controlled, a pipeline stops being "a script that happened to run successfully" and becomes something much more valuable:

$$
\boxed{\text{a reproducible build system for data}}
$$

Those properties allow future teams to trust a dataset, and the models trained from it, months or years after the original run.

![Nine controls surrounding a trusted dataset, covering pinned inputs, time, deterministic logic, retries, validation, publication, lineage, backfills, and recovery](/content-assets/articles/article-mlops-data-for-ml-systems-repeatable-data-pipelines/repeatable-pipeline-summary.png)

*A repeatable pipeline combines deterministic computation with safe publication, traceable evidence, controlled historical repair, and tested recovery.*

## Check Your Answers

Use these answers to revisit the evidence, boundaries, and operating decisions behind each question.

:::expand[What Makes an ML Data Pipeline Repeatable?]{kind="recap"}
A repeatable pipeline defines its output as a function of versioned inputs, code, configuration, logical time, and environment.

The same definition can be retried, audited, and rebuilt without relying on hidden mutable state. Logical equality commonly matters more than identical file names or byte order in distributed execution.
:::

:::expand[Which Inputs, Clocks, and Environments Must a Run Control?]{kind="recap"}
The run pins source snapshots or cutoffs, event and availability-time rules, parameters, random seeds, reference data, code revision, dependency environment, and intended output identity.

Logical time describes the window being processed; wall-clock time records execution. Separating them prevents retries and backfills from silently reading a different world.
:::

:::expand[How Do Determinism, Idempotency, and Safe Retries Differ?]{kind="recap"}
Determinism means equivalent declared inputs produce equivalent results.

Idempotency means repeating the same logical write does not create additional effects. Safe retry combines both with stable run identity, bounded partitions, duplicate-resistant writes, and controlled source versions so at-least-once execution cannot corrupt the output.
:::

:::expand[How Do Private Builds and Atomic Publication Prevent Partial Data from Escaping?]{kind="recap"}
The pipeline writes a private candidate and checks source completeness, structure, keys, values, relationships, time, population, labels, and expected scope.

Critical failures preserve evidence and prevent publication. Validation results identify the candidate, contract, observations, severity, and owner so a green computation cannot bypass a failed data claim.
:::

:::expand[How Does Validation Protect a Candidate Output?]{kind="recap"}
Atomic publication exposes one complete validated version through a snapshot, manifest, or metadata transaction.

Consumers resolve a stable version only after every partition and check succeeds. An interrupted attempt remains private, and the previous approved version stays available. Computation status and publication status remain separate facts.
:::

:::expand[How Do Provenance, Lineage, and Immutable Versions Explain Each Output?]{kind="recap"}
Provenance records the exact inputs, code, configuration, environment, times, and run that produced one artifact.

Lineage connects that artifact to upstream and downstream datasets, jobs, models, and releases. An immutable output identity preserves those records attached to a stable result while mutable aliases resolve to it at controlled boundaries.
:::

:::expand[How Do Logical Time and Backfills Rebuild Historical Windows?]{kind="recap"}
Partitions and runs use a declared logical window rather than the current clock.

A backfill applies the versioned build definition to selected historical windows under explicit late-data and knowledge-cutoff rules. Rebuilt partitions receive validation and publication controls identical to normal runs, while corrected reconstructions remain distinct from exact historical reproduction.
:::

:::expand[How Do Orchestration, Recovery, and Ownership Keep the Pipeline Operable?]{kind="recap"}
The processing engine performs transformations, while the orchestrator manages dependencies, schedules, retries, backfills, and alerts.

Recovery restores the last approved output, preserves failed candidates, and repairs bounded partitions. Source, transformation, platform, and dataset owners each have a defined response for freshness, quality, capacity, and semantic failures.
:::

## References

- [Polars documentation: Using the lazy API](https://docs.pola.rs/user-guide/lazy/using/)
- [Polars documentation: Lazy sources and sinks](https://docs.pola.rs/user-guide/lazy/sources_sinks/)
- [OpenLineage specification: Object model](https://openlineage.io/docs/spec/object-model/)
