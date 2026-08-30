---
title: "Rebuild Past Datasets"
description: "Reconstruct historical ML datasets from preserved time boundaries, immutable inputs, transformation and runtime identity, timing rules, split membership, and verification evidence."
overview: "Rerunning an old query against today's data usually creates a new dataset. An exact historical rebuild must recover what the system knew at the original boundary, replay the same code and timing policies, preserve split membership, and prove that the resulting rows match. Missing snapshots, deleted records, or lost runtimes may limit the work to a documented best-effort reconstruction."
tags: ["MLOps", "production", "pipelines"]
order: 3
id: "article-mlops-data-for-ml-systems-rebuilding-past-datasets"
---

## Table of Contents

1. [Why Does Rerunning an Old Query Usually Produce a Different Dataset?](#why-does-rerunning-an-old-query-usually-produce-a-different-dataset)
2. [What Is the Difference Between Reproduction and Reconstruction?](#what-is-the-difference-between-reproduction-and-reconstruction)
3. [How Do Event Time, Knowledge Time, and an As-Of Cutoff Define the Past?](#how-do-event-time-knowledge-time-and-an-as-of-cutoff-define-the-past)
4. [Which Inputs, Code, Configuration, and Environment Must Be Recovered?](#which-inputs-code-configuration-and-environment-must-be-recovered)
5. [How Do Late Data and Delayed Labels Change a Historical Rebuild?](#how-do-late-data-and-delayed-labels-change-a-historical-rebuild)
6. [How Are Row Membership, Splits, Features, and Labels Verified?](#how-are-row-membership-splits-features-and-labels-verified)
7. [What Can Be Claimed When Exact Reproduction Is Impossible?](#what-can-be-claimed-when-exact-reproduction-is-impossible)
8. [How Should Retention, Privacy, and Rebuild Tests Prepare Future Datasets?](#how-should-retention-privacy-and-rebuild-tests-prepare-future-datasets)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A team investigates a model released several months ago. The training run points to a SQL file and says the dataset had 11.8 million examples. An engineer checks out the old code and runs the query again. It returns 12.4 million rows.

The query is valid. The sources changed. Events arrived late, labels matured, records were corrected, reference data changed, and privacy requests removed other rows.

Rebuilding the past first requires a choice. **Reproduction** tries to recover the imperfect dataset the old run actually saw. **Reconstruction** applies a chosen later knowledge cutoff or corrected understanding to the old prediction times. Both are useful, but they answer different questions and need different identities.

Choose and verify the intended past through these questions:

1. **Why Does Rerunning an Old Query Usually Produce a Different Dataset?**
2. **What Is the Difference Between Reproduction and Reconstruction?**
3. **How Do Event Time, Knowledge Time, and an As-Of Cutoff Define the Past?**
4. **Which Inputs, Code, Configuration, and Environment Must Be Recovered?**
5. **How Do Late Data and Delayed Labels Change a Historical Rebuild?**
6. **How Are Row Membership, Splits, Features, and Labels Verified?**
7. **What Can Be Claimed When Exact Reproduction Is Impossible?**
8. **How Should Retention, Privacy, and Rebuild Tests Prepare Future Datasets?**

## Why Does Rerunning an Old Query Usually Produce a Different Dataset?

<!-- section-summary: Queries describe transformations while their sources continue to receive late events, corrections, mature labels, reference updates, and deletions. -->

Suppose a model was trained six months ago on dataset $$D$$. Today you want to answer:

**Can I reconstruct exactly what that model saw?**

At first this sounds easy:

```text
rerun the old pipeline
```

But that frequently produces a different dataset. Why? Because a dataset is not determined only by its query or code.

A better model is:

$$
\boxed{
D =
F(
\text{input state},
\text{code},
\text{parameters},
\text{time},
\text{environment}
)
}
$$

When any of those inputs or rules changes, a pipeline that looks identical may now produce:

$$
D' \neq D
$$

Rebuilding a past dataset therefore means **reconstructing the computation as it existed at the historical cutoff**.

### The central problem: the past has changed

Imagine that on March 1 you ran:

```sql
SELECT *
FROM transactions
WHERE event_date < '2026-03-01'
```

and obtained:

```text
10,000,000 rows
```

You run exactly the same SQL on August 1. Now you get:

```text
10,137,421 rows
```

How can a query about the past change? Because the underlying table changed after March 1. Perhaps:

```text
late transactions arrived
incorrect rows were corrected
duplicate records were removed
fraud labels were updated
customers requested deletion
historical events were backfilled
```

The SQL text is the same. But:

$$
\text{table state}_{March}
\neq
\text{table state}_{August}
$$

Therefore:

$$
Q(\text{table}_{March})
\neq
Q(\text{table}_{August})
$$

The result gives the first principle:

$$
\boxed{
\text{Reproducing a query is not the same as reproducing its historical inputs.}
}
$$

## What Is the Difference Between Reproduction and Reconstruction?

<!-- section-summary: Reproduction aims to recover the dataset the historical run actually consumed, including incomplete knowledge and old errors. -->

### There are actually two kinds of "rebuild"

This distinction is essential. Suppose an old training dataset contained an incorrect label. Today you know the label should be corrected.

When someone says:

"Rebuild the old dataset."

They might mean one of two things.

#### Historical reproduction

Recreate exactly what the old training job saw.

$$
D_{\text{rebuild}} = D_{\text{original}}
$$

Even if the original contained errors. This answers:

**What happened historically?**

#### Historical reconstruction with current knowledge

Recompute the same historical period using corrected inputs and newer knowledge.

$$
D_{\text{corrected}}
\neq
D_{\text{original}}
$$

This answers:

**What dataset should we use now for that historical period?**

Both are legitimate. They should never be confused.

### A concrete example

Suppose a transaction happened on January 10. On January 15, the system believed:

```text
fraud = false
```

On February 20, investigators confirmed:

```text
fraud = true
```

The model trained on January 31 saw:

```text
fraud = false
```

If you reproduce that training dataset exactly, you must reconstruct:

```text
the label as known on January 31
```

not today's corrected label. But if you're building a better training dataset today, you probably want:

```text
fraud = true
```

So:

$$
\boxed{
\text{historical truth-as-known-then}
\neq
\text{best truth-known-now}
}
$$

This becomes one of the hardest parts of ML dataset reconstruction.

![Two timelines showing why the original dataset had 11.8 million rows while a later rerun of the same query had 12.4 million rows](/content-assets/articles/article-mlops-data-for-ml-systems-rebuilding-past-datasets/todays-query-vs-yesterday.png)

*Late events, mature labels, corrections, and deletions change the historical world even if the SQL text stays unchanged.*

## How Do Event Time, Knowledge Time, and an As-Of Cutoff Define the Past?

<!-- section-summary: Event time says when the real-world fact occurred. -->

### First decide which historical moment you mean

Suppose you say:

"Rebuild the March training dataset."

That is not precise enough. There may be several relevant times:

```text
events occurred in March
pipeline ran April 2
labels were accepted through April 30
model training started May 1
```

Which state should you reproduce? A robust rebuild request needs an **as-of time**. For example:

$$
t_{\text{as-of}}
=
2026\text{-}05\text{-}01\ 00{:}00
$$

Then the question becomes:

Reconstruct the dataset exactly as it could have been observed at $$t_{\text{as-of}}$$.

This is much more precise.

### Event time and knowledge time are different

This is one of the deepest ideas in historical data reconstruction. Suppose:

```text
purchase happened:
March 10

purchase entered warehouse:
March 12
```

There are at least two timestamps:

$$
t_e = \text{event time}
$$

$$
t_a = \text{arrival time}
$$

Now suppose you rebuild as of March 11. Should that purchase appear? If you're reproducing what the pipeline knew on March 11:

$$
t_a > March\ 11
$$

so no. Even though:

$$
t_e < March\ 11
$$

The consequence is historical reconstruction frequently requires not only:

When did the event happen?

but also:

When did the system learn about it?

### Bitemporal thinking

A useful conceptual model gives each fact two dimensions of time.

#### Valid time

When was the fact true in the real world?

#### System time

When did the data system know or record it? For example:

```text
transaction happened:
Jan 10

transaction ingested:
Jan 11

amount corrected:
Jan 20
```

Then:

```text
As of Jan 15:
amount = £100

As of Jan 25:
amount = £120
```

The historical event did not move. But the system's knowledge changed. Rebuilding past ML data accurately frequently requires preserving this distinction.

## Which Inputs, Code, Configuration, and Environment Must Be Recovered?

<!-- section-summary: The rebuild resolves immutable source snapshots, object versions, external references, transformation commit, compiled queries, parameters, random seeds, feature and label contracts, dependency lock, container or runtime -->

### So what do you actually need to reproduce an old dataset?

At minimum, think of the dataset as:

$$
D =
F(
I,
C,
P,
T,
E
)
$$

where:

$$
I=\text{exact input states}
$$

$$
C=\text{code}
$$

$$
P=\text{parameters/configuration}
$$

$$
T=\text{time semantics}
$$

$$
E=\text{execution environment}
$$

For stronger reproducibility, you may also need:

```text
random seeds
library versions
external lookup versions
feature definitions
label definitions
split logic
schema versions
```

If one important dependency is missing, exact reproduction may fail.

### Recover the exact input versions

Suppose the original training dataset used:

```text
customers
transactions
fraud_labels
```

Do not merely record those names. You need something more like:

```text
customers snapshot 418
transactions snapshot 991
fraud_labels snapshot 182
```

Then:

$$
D =
F(
C_{418},
T_{991},
L_{182}
)
$$

not:

$$
D =
F(
customers_{\text{today}},
transactions_{\text{today}},
labels_{\text{today}}
)
$$

The reconstruction depends on durable identities such as snapshot IDs, immutable files, table versions, or manifests.

### Why source snapshots matter

Imagine a customer table originally contained:

| customer_id | country |
| ----------- | ------- |
| 1           | UK      |
| 2           | France  |

Later customer 2's country is corrected:

| customer_id | country |
| ----------- | ------- |
| 1           | UK      |
| 2           | Belgium |

Now the exact same join produces different features. So:

$$
Join(D,Customers_{old})
\neq
Join(D,Customers_{new})
$$

The query can reproduce its old result only when the customer state from that time is still addressable.

### Derived inputs need versions too

Suppose your training dataset depends on:

```text
raw events
↓
clean_events
↓
customer_features
↓
training dataset
```

You could rebuild everything from raw data. But if intermediate transformations were stateful or if historical raw inputs have changed, the old intermediate artifact might matter. So your lineage may need to identify:

```text
clean_events_v81
customer_features_v212
```

not just:

```text
raw source names
```

The important question is:

Which state of every causally relevant dependency did the training dataset use?

### Recover the original code

Suppose your old pipeline computed:

```python
days_active = (prediction_time - signup_time).days
```

Later it was changed to:

```python
days_active = ceil(
    (prediction_time - signup_time).total_seconds() / 86400
)
```

Even with identical inputs:

$$
F_{\text{old}}(X)
\neq
F_{\text{new}}(X)
$$

So rebuilding an old dataset requires the original transformation version. Usually this means something like:

```text
Git commit = abc921f
```

rather than:

```text
branch = main
```

because `main` moves.

### Configuration is part of the code's meaning

Suppose the same pipeline supports:

```text
lookback_days = 30
```

or:

```text
lookback_days = 90
```

Then:

$$
F(X,30)
\neq
F(X,90)
$$

The source code alone does not identify the dataset. So you also need parameters such as:

```text
lookback window
label window
country filters
feature flags
sampling rate
minimum activity threshold
random seed
```

A good historical record stores resolved parameter values, not merely:

```text
environment = production
```

because "production" may later change.

### Recover the execution environment when it matters

Suppose the old job used:

```text
Python 3.x
library A v2
library B v5
```

and today you run:

```text
library A v4
library B v8
```

You may get different behavior. Examples include changes in:

```text
date parsing
NULL handling
sorting behavior
random number generation
floating-point routines
categorical encoding
serialization
```

So sometimes the full computation is more accurately:

$$
D =
F(I,C,P,E)
$$

where $$E$$ represents the software environment. For exact reconstruction, you may preserve things like:

```text
container image
package lockfile
runtime version
processing-engine version
```

### External services are hidden inputs too

Suppose the feature pipeline enriches IP addresses using:

```text
IP → country lookup service
```

The service updates its geographic database every month. Re-running old inputs today may produce different results. Therefore:

$$
\text{external lookup state}
$$

is also part of the input. Either record:

```text
geo database version = 2026-03
```

or preserve the already-materialized enrichment. The general rule is:

$$
\boxed{
\text{Anything capable of changing the output is an input dependency.}
}
$$

## How Do Late Data and Delayed Labels Change a Historical Rebuild?

<!-- section-summary: A late event may belong to an earlier event-time window while remaining unknown to production at the cutoff. -->

### Late-arriving data makes exact reconstruction harder

Suppose you're producing a dataset for March 1. An event happened:

```text
March 1 08:00
```

but arrived:

```text
March 3 12:00
```

The dataset created on March 2 did not include it. A rebuild today probably will—unless you deliberately reproduce the old arrival cutoff. So an exact historical reconstruction needs something like:

$$
t_{\text{arrival}}
\le
t_{\text{original build}}
$$

not merely:

$$
t_{\text{event}}
\in
\text{historical window}
$$

This is why recording ingestion timestamps can be crucial.

### Delayed labels create the same issue

Suppose the original model predicted 30-day churn. A customer event occurs on January 1. You cannot know the full 30-day outcome until roughly January 31.

So the training pipeline might enforce:

$$
t_{\text{example}} + 30d
\le
t_{\text{label cutoff}}
$$

If you rebuild months later, more labels are now mature. Using them all would change the dataset. Therefore an exact rebuild needs the original:

```text
label cutoff
label maturity rule
label snapshot
```

### A negative label may historically mean "not yet positive"

This is easy to miss. Suppose on January 15:

```text
fraud = 0
```

really meant:

No fraud confirmation has arrived yet.

By February 20:

```text
fraud = 1
```

If the January dataset encoded the earlier state as `0`, exact reconstruction requires reproducing that historical imperfection. Otherwise you're not reproducing the original training problem. This may feel uncomfortable, but:

$$
\boxed{
\text{reproduction describes history; it does not repair history}
}
$$

![The cutoff, input snapshots, code commit, runtime image, late-data policy, and split membership feeding an exact rebuild workspace](/content-assets/articles/article-mlops-data-for-ml-systems-rebuilding-past-datasets/exact-rebuild-evidence.png)

*An exact rebuild needs the original time boundary and data state as well as the code, runtime, timing rules, and row membership.*

## How Are Row Membership, Splits, Features, and Labels Verified?

<!-- section-summary: Verification progresses from schema and counts to stable example IDs, ordering where required, split manifests, label states, feature values, statistics, content fingerprints, and model behaviour. -->

### Rebuild the same rows, not merely similar statistics

Suppose the original dataset had:

```text
10 million rows
```

and the rebuild also has:

```text
10 million rows
```

That does not mean they are the same. You want stable example identities. For example:

```text
example_id
transaction_id
customer_id + prediction_time
```

Then compare:

$$
IDs(D_{\text{old}})
$$

against:

$$
IDs(D_{\text{rebuild}})
$$

Ideally:

$$
IDs(D_{\text{old}})
=
IDs(D_{\text{rebuild}})
$$

for exact reproduction.

### Train/test splits need reconstruction too

Suppose the original pipeline randomly split:

```text
80% train
20% test
```

without controlling the randomness. Today you might recreate the same rows but assign them differently. Then model evaluation changes.

A better split rule is deterministic. For example:

$$
bucket =
Hash(customer\_id) \bmod 100
$$

Then:

```text
bucket 0–79 → train
bucket 80–99 → test
```

Now the split is derived from stable identity. Alternatively preserve:

```text
random seed
split algorithm version
```

The important thing is:

$$
\boxed{
\text{dataset membership and split membership are both part of reproducibility.}
}
$$

### Time-based splits must reproduce the same boundaries

Suppose the original experiment used:

```text
train:
Jan–March

validation:
April

test:
May
```

Then a historical rebuild must preserve those boundaries. You should not accidentally use today's convenient split such as:

```text
latest 30 days = test
```

because the logical meaning changed. Store explicit boundaries:

$$
Train=[t_0,t_1)
$$

$$
Validation=[t_1,t_2)
$$

$$
Test=[t_2,t_3)
$$

### Group-based splitting matters too

Suppose records from the same customer must stay together. The original split may have been:

```text
customer 101 → train
customer 102 → train
customer 103 → test
```

A rebuilt split that places customer 103 partly in train and partly in test creates leakage. Therefore reconstruction should preserve whatever splitting unit mattered:

```text
customer
patient
merchant
device
household
time period
```

A dataset's split logic is part of its semantics.

### Reconstruct ordering only when ordering matters

Some training pipelines are insensitive to row ordering. Others are not. Consider online or stateful algorithms may process examples sequentially:

$$
\theta_{t+1}
=
Update(\theta_t,x_t)
$$

Then:

$$
[x_1,x_2,x_3]
$$

can produce a different result from:

$$
[x_3,x_1,x_2]
$$

So if order influenced model training, order may need to be reproduced. This is one reason to distinguish:

$$
\text{set equality}
$$

from:

$$
\text{sequence equality}
$$

### The rebuilt dataset

Suppose the original dataset is:

$$
D
$$

and the rebuilt dataset is:

$$
D'
$$

Do not merely assume:

$$
D'=D
$$

because the pipeline finished successfully. You should compare systematically. Start with schema:

$$
Schema(D)=Schema(D')
$$

Then row count:

$$
|D|=|D'|
$$

Then example IDs:

$$
IDs(D)=IDs(D')
$$

Then values.

### Use stable fingerprints when possible

For each row $$r_i$$, calculate:

$$
h_i=H(r_i)
$$

where $$H$$ is a cryptographic hash over a canonical representation. Then compare row hashes. You can also produce partition-level or dataset-level hashes.

For example:

$$
H_D =
H(
sort(h_1,h_2,\dots,h_n)
)
$$

If:

$$
H_D = H_{D'}
$$

you have strong evidence of content equality. The exact hashing strategy depends on ordering, floating-point representation, file format, and scale.

### Physical equality and logical equality differ

Suppose two Parquet datasets contain identical records but one uses:

```text
Snappy compression
```

and another:

```text
Zstandard compression
```

Their file bytes differ. But logically:

$$
D=D'
$$

Similarly, file partitioning may differ. So decide what you are trying to reproduce.

#### Physical reproduction

Same bytes/files. Very strong and sometimes unnecessary.

#### Logical reproduction

Same rows and values. Often the meaningful requirement for ML.

#### Semantic reproduction

Equivalent values within acceptable tolerances and semantics. Sometimes appropriate for floating-point/distributed systems.

### Floating-point computations may not reproduce bit-for-bit

Distributed computations can execute aggregations in different orders. Because floating-point arithmetic is approximately:

$$
(a+b)+c
\neq
a+(b+c)
$$

at the last few bits, you may get:

$$
0.30000000001
$$

instead of:

$$
0.29999999998
$$

So exact byte equality may fail even though the datasets are effectively equivalent. You may compare:

$$
|x-x'|<\epsilon
$$

for selected numerical fields. The tolerance should be defined, not improvised after differences appear.

### Compare distributions too

Even when row-by-row comparison is possible, aggregate checks help diagnose failures. Compare things such as:

$$
P(Y=1)
$$

$$
\text{NULL rate}(X_j)
$$

$$
\mu(X_j)
$$

$$
Q_{50}(X_j),Q_{95}(X_j)
$$

$$
\text{category frequencies}
$$

For example:

```text
Original fraud rate: 1.42%
Rebuild fraud rate:  2.83%
```

That immediately suggests a label-history problem.

### Compare train and test sets independently

Suppose the full reconstructed dataset matches statistically, but rows moved between train and test. Then evaluation is no longer comparable. So verify:

$$
Train'=Train
$$

$$
Validation'=Validation
$$

$$
Test'=Test
$$

not merely:

$$
Train'\cup Test' = Train\cup Test
$$

This distinction matters greatly for experiment reproducibility.

### You can also compare the downstream model

Suppose you rebuild:

$$
D'
$$

and retrain with the original training pipeline:

$$
M' = Train(D')
$$

If training is deterministic, you might expect:

$$
M'=M
$$

or at least equivalent predictions. If not, investigate whether the mismatch came from:

```text
data
training code
random seed
hardware nondeterminism
library version
```

The result gives you another level of reproducibility testing.

### Think in levels of rebuild confidence

Exact reconstruction is not always possible. It is useful to define levels.

#### Level 1 — Exact artifact retained

You still have the exact files the model used. Strongest historical evidence.

#### Level 2 — Exact logical reconstruction

Files may differ physically, but rows and values match.

$$
D'=D
$$

logically.

#### Level 3 — Semantically equivalent reconstruction

Tiny numerical differences exist but have no material effect.

$$
D'\approx D
$$

#### Level 4 — Best-effort reconstruction

Some dependencies are missing, but major semantics are reconstructed.

#### Level 5 — Impossible

Critical inputs or history no longer exist. Being explicit about which level you achieved is better than claiming "reproducible" vaguely.

## What Can Be Claimed When Exact Reproduction Is Impossible?

<!-- section-summary: The report states which evidence is preserved, which dependency is missing, which differences are explained, and whether physical, logical, or semantic equivalence is supported. -->

### When exact rebuilding is impossible

Suppose the original dataset depended on:

```text
an API response that was never stored
```

and that service no longer has historical state. Then exact reconstruction may merely be impossible. Or:

```text
source table kept only 90 days
```

but the model was trained two years ago. Or:

```text
customer records were legally deleted
```

and cannot be restored. The correct conclusion may be:

$$
\boxed{
\text{Exact reconstruction is impossible with retained evidence.}
}
$$

That is not necessarily an engineering failure today. The failure may have been the absence of sufficient historical preservation when the model was built.

### This is why rebuildability must be designed beforehand

You cannot retroactively version data that no longer exists. If the system needs to reproduce a model years later, you must preserve the relevant history at training time. That can include:

```text
training dataset artifact
source snapshot IDs
input manifests
code commits
configuration
container image
random seeds
split IDs
label cutoffs
```

Reconstruction is therefore a property created **before** the incident.

### Storing the exact training dataset is often the simplest insurance

Suppose your final training dataset is 500 GB. The raw data platform is 5 PB and evolves constantly. It may be cheaper and more reliable to preserve:

```text
the exact 500 GB training snapshot
```

than to guarantee every historical upstream dependency forever. That artifact directly answers:

What did the model see?

Then lineage and source versions can explain how it was created. A useful principle is:

$$
\boxed{
\text{For important model builds, preserve the final training artifact whenever practical.}
}
$$

### But retaining only the final dataset is not enough for explanation

Suppose you preserve the exact rows. You can reproduce training. But a regulator or engineer asks:

Why was `risk_score_feature` equal to 0.81 for this customer?

If the feature pipeline and source history are gone, you may not know. So two different goals exist:

#### Training reproducibility

Preserve:

$$
D
$$

#### Data-generation explainability

Preserve:

$$
I,C,P,T
$$

Ideally you do both.

## How Should Retention, Privacy, and Rebuild Tests Prepare Future Datasets?

<!-- section-summary: At training time, preserve the exact dataset artifact, build manifest, snapshots, code, environment, contracts, split membership, and verification fingerprints for the approved retention period. -->

### Retention policy is part of rebuild design

You cannot keep everything forever. So decide which artifacts have which retention classes. For example:

```text
temporary staging output:
7 days

intermediate features:
90 days

production training dataset:
7 years

source snapshots:
according to regulatory/reproducibility needs

metadata and lineage:
long-lived
```

The specific durations depend on your requirements. The important part is that retention is intentional.

### Privacy can make perfect historical reconstruction undesirable

Suppose a user's information is deleted in accordance with legal or privacy requirements. A historical training dataset may originally have contained that user. After deletion, you may be prohibited from reconstructing it.

Then the system faces two valid requirements:

$$
\text{reproducibility}
$$

and:

$$
\text{privacy/deletion}
$$

Privacy requirements can override reproducibility. So your documentation might record:

Exact historical reconstruction is no longer possible because some source records were legitimately deleted.

An explicit reconstruction limit is safer than preserving prohibited copies under the excuse of reproducibility.

### "Immutable data" does not mean "never deletable"

In engineering, immutable commonly means:

Once published, this version is not silently mutated in place.

It does not mean:

Legal deletion can never happen.

A more accurate model is:

```text
immutable during permitted retention
↓
restricted archive
↓
deleted when required
```

After removing protected data, the system can retain non-sensitive metadata that records the former artifact and explains why it can no longer be rebuilt.

### Feature stores introduce another rebuilding question

Suppose a model used:

```text
customer_purchase_count_30d
```

from an online feature store. Today's feature store contains only the latest value. That is not enough to reconstruct historical training examples.

For historical reconstruction, you need either:

```text
historical feature values
```

or:

```text
raw events + point-in-time feature computation
```

Otherwise you're tempted to join historical examples against current values:

$$
X_{\text{historical}}
\leftarrow
X_{\text{today}}
$$

which can cause leakage and incorrect reconstruction.

### Point-in-time correctness is fundamental

Suppose customer 42 had:

```text
credit_score = 610
```

when a decision was made in January. Today:

```text
credit_score = 740
```

A naive historical rebuild joins against the latest customer record. Then January's training row incorrectly gets:

```text
740
```

The correct historical feature is:

$$
X(t_p)
=
\text{latest feature value available at or before }t_p
$$

where $$t_p$$ is prediction time. So:

$$
t_{\text{feature}}
\le
t_p
$$

is a critical reconstruction constraint.

### This is why historical reconstruction and leakage prevention are the same problem in disguise

A leak happens when historical training sees information from the future. A bad rebuild can introduce exactly that. For example:

```text
current customer status
current fraud outcome
current account balance
current subscription state
```

may not have existed at historical prediction time. Therefore a correct rebuild needs to answer:

**What could this system actually have known at that moment?**

That question is central both to reproducibility and to leakage prevention.

### Rebuilds should be normal pipeline operations

Suppose your daily feature pipeline only supports:

```text
process today
```

Then historical recovery becomes awkward. A better pipeline takes:

```text
logical_date = D
```

and computes:

$$
F(D)
$$

Then today's normal job might execute:

```text
F(2026-08-27)
```

while a historical rebuild executes:

```text
F(2026-03-12)
```

The computational abstraction is the same. This is why good repeatable pipelines make logical time explicit.

### But an exact historical rebuild may need an as-of time too

Sometimes one date isn't enough. Suppose you're rebuilding:

```text
prediction date = March 12
```

but want to reproduce the dataset built:

```text
April 20
```

Then the pipeline may need:

$$
F(
\text{prediction window},
\text{as-of knowledge time}
)
$$

For example:

```text
prediction_window = March 1–31
knowledge_cutoff   = April 20
```

The design allows:

```text
March events
+
labels known by April 20
```

while excluding information learned after April 20. This is a powerful design for historical ML data.

### The original build timestamp is not always sufficient

Imagine a job starts at 02:00 and runs for four hours. Source A is read at:

```text
02:05
```

Source B at:

```text
05:37
```

If those sources change during the run, the resulting dataset may reflect inconsistent states. This is why consistent snapshots are valuable. Ideally:

$$
I_1,I_2,\dots,I_n
$$

are resolved to a common historical snapshot or explicit versions before computation begins. Then the pipeline has a well-defined input state.

### Record a rebuild manifest

For any reconstruction that matters, publish a manifest with details such as:

```text
target dataset:
fraud_training_v72

rebuild mode:
exact historical reproduction

prediction window:
2026-01-01 to 2026-06-30

as-of time:
2026-08-29T00:00Z

inputs:
transactions@881
accounts@314
chargebacks@551

pipeline code:
commit 827fa91

config:
fraud_training_v8

environment:
image sha256:...

random seed:
71821

split definition:
split_v4

expected original fingerprint:
91a77...
```

This turns reconstruction into an explicit build specification.

### Then rebuild into a new location

Do not overwrite the original while checking reproducibility. Use something like:

```text
original:
fraud_training_v72

candidate rebuild:
fraud_training_v72_rebuild_2026_08_28
```

Then compare them. Only after verification should the rebuild be treated as equivalent. The control prevents a failed reconstruction from destroying historical evidence.

### A strong verification ladder

For original $$D$$ and rebuild $$D'$$, check progressively:

### Schema

$$
Schema(D)=Schema(D')
$$

### Row counts

$$
|D|=|D'|
$$

### Stable IDs

$$
IDs(D)=IDs(D')
$$

### Train/test membership

$$
Split(D)=Split(D')
$$

### Labels

$$
Y(D)=Y(D')
$$

### Feature values

$$
X(D)=X(D')
$$

or within tolerance.

### Dataset fingerprint

$$
H(D)=H(D')
$$

where appropriate.

### Downstream model behavior

Optionally retrain and compare predictions or metrics. Each level gives stronger evidence.

### If the rebuild differs, classify the difference

Not all mismatches have the same cause. Suppose:

$$
D' \neq D
$$

Ask whether the cause is:

```text
missing historical input
late-arriving records
label revision
code mismatch
configuration mismatch
dependency version change
floating-point nondeterminism
split nondeterminism
privacy deletion
external service change
```

The comparison should help explain the mismatch, not merely declare failure.

### Maintain an explicit reproducibility status

For each important model or dataset, you might record:

```text
EXACT_ARTIFACT_AVAILABLE
```

or:

```text
LOGICALLY_REPRODUCIBLE
```

or:

```text
BEST_EFFORT_ONLY
```

or:

```text
NOT_REPRODUCIBLE_AFTER_RETENTION_EXPIRY
```

This is far more informative than a generic:

```text
reproducible = true
```

because reproducibility has degrees and dependencies.

### A historical dataset is a snapshot of knowledge

It is tempting to think of a training dataset as merely:

$$
\text{facts about events}
$$

But a historical ML dataset is frequently better understood as:

$$
\boxed{
\text{facts as they were known under a particular information cutoff}
}
$$

Suppose reality is:

```text
transaction eventually turns out to be fraud
```

But the system does not know that until 30 days later. A model trained earlier did not have access to eventual truth. So historical reconstruction needs to preserve the **information boundary** that existed at the time.

This information-time distinction is a foundational way to reason about historical ML data.

### A useful timeline model

Imagine:

```text
Event happens
    |
    v
Jan 1
    |
    | event arrives
    v
Jan 2
    |
    | model training occurs
    v
Jan 10
    |
    | fraud investigation completes
    v
Feb 5
    |
    | label corrected
    v
Feb 7
```

If reproducing the Jan 10 model:

```text
include event?        yes
include fraud result? no
```

If reconstructing the best modern training dataset:

```text
include event?        yes
include fraud result? yes
```

Same historical event. Different knowledge cutoffs.

### Rebuilding is historical simulation

To reproduce a dataset exactly, imagine placing the entire data platform back in time. Ask:

If it were that date again, what would the system be able to see?

That means hiding:

```text
future rows
future corrections
future labels
future customer states
future external-database updates
```

The rebuild is effectively simulating:

$$
\text{information available at time }t
$$

This makes the problem much easier to reason about.

### What a well-designed system should preserve at training time

For every significant production model, ideally keep enough information to answer:

| Question                 | Evidence                         |
| ------------------------ | -------------------------------- |
| What exact dataset?      | dataset version / manifest       |
| What rows?               | stable IDs or preserved artifact |
| What features?           | schema + feature definitions     |
| What labels?             | label definition/version         |
| What source state?       | snapshot IDs                     |
| What code?               | immutable commit                 |
| What parameters?         | resolved configuration           |
| What time cutoff?        | prediction/knowledge windows     |
| What splits?             | split rule/version/seed          |
| What environment?        | container/runtime version        |
| What did validation say? | quality report                   |
| What model used it?      | training-run lineage             |
| Can it still be rebuilt? | retention/reproducibility status |

This metadata converts a vague historical pipeline into an inspectable experiment.

### A full example

Suppose you need to rebuild the training data for:

```text
fraud_model_v21
```

The registry tells you:

```text
training dataset:
fraud_training_v72

training run:
train_9128
```

Dataset metadata gives:

```text
prediction window:
2026-01-01 → 2026-06-30

knowledge cutoff:
2026-08-01

transactions:
snapshot 881

customers:
snapshot 314

fraud labels:
snapshot 551

feature code:
commit 827fa91

configuration:
fraud_features_v8

random seed:
71821

split version:
customer_hash_split_v3
```

You reconstruct:

$$
D'_{72}
$$

in staging. Then compare. Original:

```text
Rows:
81,421,731

Positive labels:
1,209,833

Train rows:
65,137,019

Test rows:
16,284,712

Fingerprint:
91a77...
```

Rebuild:

```text
Rows:
81,421,731

Positive labels:
1,209,833

Train rows:
65,137,019

Test rows:
16,284,712

Fingerprint:
91a77...
```

Now you have strong evidence that:

$$
D'_{72}=D_{72}
$$

### One snapshot was deleted

Suppose:

```text
fraud labels snapshot 551
```

no longer exists. The oldest available is:

```text
snapshot 559
```

which contains later corrections. Then:

$$
D'_{72}
$$

cannot be guaranteed to equal:

$$
D_{72}
$$

You might still perform a best-effort reconstruction. But the system should clearly report:

```text
Exact reproduction unavailable:
historical label snapshot expired.
```

That honesty matters.

### The hardest bugs are often temporal

Most engineers initially think reconstruction failures will come from:

```text
missing file
wrong code
```

In ML, some of the most subtle failures come from time:

```text
late events
revised facts
delayed labels
future features
current-state joins
changed split windows
```

Historical ML data therefore needs defined event, observation, and availability times; filenames and file timestamps cannot express those semantics by themselves.

### Rebuildability improves everyday debugging too

Suppose production accuracy suddenly declines. You ask:

Did the model change because of code or data?

If old datasets are reproducible, you can perform controlled experiments. For example:

$$
M_A=Train(D_{\text{old}},C_{\text{old}})
$$

$$
M_B=Train(D_{\text{old}},C_{\text{new}})
$$

This isolates code changes. Or:

$$
M_C=Train(D_{\text{new}},C_{\text{old}})
$$

which isolates data changes. Without historical dataset reconstruction, these experiments are much harder.

### Rebuildability is therefore not merely an audit feature

It helps with:

```text
debugging
model regression analysis
incident response
label corrections
feature bugs
controlled experiments
backfills
compliance
scientific reproducibility
```

The benefit appears every time someone asks:

"What changed?"

Rebuildable datasets let you change one variable at a time.

### A practical production design

Conceptually:

```text
                   model registry
                        │
                        ▼
                 training run
                        │
                        ▼
                 dataset version
                        │
             ┌──────────┼───────────┐
             ▼          ▼           ▼
       input snapshots  code     configuration
             │
             └──────────┼───────────┘
                        ▼
                 rebuild manifest
                        │
                        ▼
                  staging rebuild
                        │
                        ▼
                  comparison suite
                    ↙        ↘
                mismatch      match
                   │            │
                report      verified
```

This makes historical reconstruction a normal engineering process rather than archaeology.

### Preserve causes, not just outcomes

Suppose you only preserve:

```text
model_v21
```

That preserves the outcome. But the model was caused by:

$$
\text{inputs}
\rightarrow
\text{dataset}
\rightarrow
\text{training}
\rightarrow
\text{model}
$$

To explain or reproduce the model, you need enough of that causal chain to survive. The stronger invariant is:

$$
\boxed{
M
\rightarrow
D
\rightarrow
(I,C,P,T,E)
}
$$

where every arrow is traceable. That is what historical rebuildability really means.

#### What to remember

An old query can return a new result, because each of these dependencies may have changed:

$$
\boxed{
\text{old query}
+
\text{new data state}
=
\text{new dataset}
}
$$

Reproducing the dataset requires reconstructing the complete computation at its historical state:

$$
\boxed{
D_{\text{old}}
=
F(
\text{old input versions},
\text{old code},
\text{old parameters},
\text{old time semantics},
\text{old environment}
)
}
$$

The most important idea is the **information cutoff**. Ask:

**What could the system actually have known when the original dataset was created?**

That determines:

* which events had arrived,
* which corrections existed,
* which labels were mature,
* which customer state was visible,
* which feature values were available,
* and which future information must remain excluded.

Then reconstruct the records together with:

$$
\text{train/test membership}
$$

$$
\text{feature definitions}
$$

$$
\text{label definitions}
$$

and compare the rebuild against the original using stable IDs, schemas, values, fingerprints, and—in important cases—downstream model behavior. Finally, distinguish these two operations:

$$
\boxed{
\text{Reproduction}
=
\text{recreate what happened then}
}
$$

versus:

$$
\boxed{
\text{Reconstruction}
=
\text{recompute the past using what we know now}
}
$$

Both are useful. Only the first explains the historical model exactly. The deepest lesson is:

$$
\boxed{
\text{A past ML dataset is not merely historical data. It is historical data under a historical boundary of knowledge.}
}
$$

Preserving that boundary together with versioned inputs, code, configuration, split rules, and labels allows a genuine historical rebuild instead of applying today's system to an old date range.

![A rebuild loop that restores evidence, replays transformations, compares rows and splits, explains differences, and classifies the result](/content-assets/articles/article-mlops-data-for-ml-systems-rebuilding-past-datasets/rebuild-compare-classify.png)

*Classify the rebuild as Exact, Equivalent only for explained and immaterial differences, or Not Reproduced when a difference remains unexplained or material.*

## Check Your Answers

Use these answers to revisit the evidence, boundaries, and operating decisions behind each question.

:::expand[Why Does Rerunning an Old Query Usually Produce a Different Dataset?]{kind="recap"}
Queries describe transformations while their sources continue to receive late events, corrections, mature labels, reference updates, and deletions.

Current aliases, libraries, and external services can change too. Old code against today's state therefore creates a new computation unless every historical dependency and knowledge cutoff is restored.
:::

:::expand[What Is the Difference Between Reproduction and Reconstruction?]{kind="recap"}
Reproduction aims to recover the dataset the historical run actually consumed, including incomplete knowledge and old errors.

Reconstruction creates an explicitly identified view of the past, frequently using corrected knowledge available later. One supports historical evidence; the other supports analysis or improvement. They must remain separate artifacts with separate claims.
:::

:::expand[How Do Event Time, Knowledge Time, and an As-Of Cutoff Define the Past?]{kind="recap"}
Event time says when the real-world fact occurred.

Knowledge or system time says when the data platform could observe a particular record or revision. The as-of cutoff fixes the latest knowledge admitted to the rebuild. Together they prevent later corrections and labels from silently entering an earlier production perspective.
:::

:::expand[Which Inputs, Code, Configuration, and Environment Must Be Recovered?]{kind="recap"}
The rebuild resolves immutable source snapshots, object versions, external references, transformation commit, compiled queries, parameters, random seeds, feature and label contracts, dependency lock, container or runtime, locale, time zone, hardware-sensitive settings, and original output manifest. Mutable names are resolved to their historical identities.
:::

:::expand[How Do Late Data and Delayed Labels Change a Historical Rebuild?]{kind="recap"}
A late event may belong to an earlier event-time window while remaining unknown to production at the cutoff.

A label may mature or be corrected after training. Exact reproduction applies the original arrival and label-as-of rules. A corrected reconstruction can include later knowledge only under a new identity and documented purpose.
:::

:::expand[How Are Row Membership, Splits, Features, and Labels Verified?]{kind="recap"}
Verification progresses from schema and counts to stable example IDs, ordering where required, split manifests, label states, feature values, statistics, content fingerprints, and model behaviour.

Comparing one-row traces and boundary fixtures explains differences that aggregate equality can hide. The declared tolerance matches the intended use.
:::

:::expand[What Can Be Claimed When Exact Reproduction Is Impossible?]{kind="recap"}
The report states which evidence is preserved, which dependency is missing, which differences are explained, and whether physical, logical, or semantic equivalence is supported.

Material or unexplained differences mean the original was not reproduced. A best-effort reconstruction can remain useful as a separate artifact without serving as exact audit evidence.
:::

:::expand[How Should Retention, Privacy, and Rebuild Tests Prepare Future Datasets?]{kind="recap"}
At training time, preserve the exact dataset artifact, build manifest, snapshots, code, environment, contracts, split membership, and verification fingerprints for the approved retention period.

Privacy and deletion rules still apply, so the record distinguishes retained evidence from irrecoverable data. Scheduled rebuild drills expose missing dependencies before an incident needs them.
:::

## References

- [Amazon S3: Retaining multiple versions of objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html) - Documents object version IDs, recovery from overwrite or deletion, and lifecycle considerations.
- [OpenLineage: Object model](https://openlineage.io/docs/spec/object-model/) - Defines jobs, runs, datasets, source-code facets, and dataset-version facets.
- [NIST: Privacy Framework](https://www.nist.gov/privacy-framework) - Provides a risk-management framework covering data processing, retention, alteration, and deletion.
