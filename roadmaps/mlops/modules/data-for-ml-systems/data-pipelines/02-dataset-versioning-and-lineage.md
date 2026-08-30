---
title: "Dataset Versioning"
description: "Learn how dataset identity, immutable snapshots, transformation evidence, contracts, lineage, and retention make ML runs traceable."
overview: "A production dataset version connects one logical dataset to an immutable data state, a versioned contract, the transformation run that created it, and the models that consumed it. That evidence supports fair comparison, incident investigation, controlled rebuilds, and audit."
tags: ["MLOps", "production", "pipelines"]
order: 2
id: "article-mlops-data-for-ml-systems-dataset-versioning-and-lineage"
---

## Table of Contents

1. [Why Is a Dataset Name Not a Dataset Version?](#why-is-a-dataset-name-not-a-dataset-version)
2. [What Is the Difference Between a Dataset Artifact and Its Build Recipe?](#what-is-the-difference-between-a-dataset-artifact-and-its-build-recipe)
3. [How Do Immutable Versions and Mutable Aliases Work Together?](#how-do-immutable-versions-and-mutable-aliases-work-together)
4. [Which Schema, Feature, Label, and Time Semantics Belong in the Version?](#which-schema-feature-label-and-time-semantics-belong-in-the-version)
5. [How Does Lineage Connect Source Data, Dataset Builds, and Model Runs?](#how-does-lineage-connect-source-data-dataset-builds-and-model-runs)
6. [When Should Teams Preserve Bytes Instead of Rebuilding Them?](#when-should-teams-preserve-bytes-instead-of-rebuilding-them)
7. [How Can a Rebuild Prove Physical, Logical, or Semantic Equivalence?](#how-can-a-rebuild-prove-physical-logical-or-semantic-equivalence)
8. [What Record Makes a Dataset Version Reusable and Auditable?](#what-record-makes-a-dataset-version-reusable-and-auditable)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A model is trained from `analytics.customer_features`. Several weeks later, an engineer reads the same table to investigate the run. New customers have arrived, corrected labels have replaced old ones, and missing values are filled differently. The table name stayed the same; the dataset did not.

A **dataset version** identifies the exact data state used for one purpose. It may point to a preserved artifact or to a recipe with pinned sources, code, configuration, and time rules. **Lineage** connects that version to what produced it and to the training runs and models that consumed it.

Those records answer practical questions. Did two model candidates use the same evaluation data? Which releases consumed a bad label version? Can the team reproduce the original evidence or only rebuild a corrected equivalent?

Separate those identities through these questions:

1. **Why Is a Dataset Name Not a Dataset Version?**
2. **What Is the Difference Between a Dataset Artifact and Its Build Recipe?**
3. **How Do Immutable Versions and Mutable Aliases Work Together?**
4. **Which Schema, Feature, Label, and Time Semantics Belong in the Version?**
5. **How Does Lineage Connect Source Data, Dataset Builds, and Model Runs?**
6. **When Should Teams Preserve Bytes Instead of Rebuilding Them?**
7. **How Can a Rebuild Prove Physical, Logical, or Semantic Equivalence?**
8. **What Record Makes a Dataset Version Reusable and Auditable?**

## Why Is a Dataset Name Not a Dataset Version?

<!-- section-summary: A logical name describes a dataset family while its contents can change through new rows, corrections, labels, and transformations. -->

A model is produced from data:

$$
M = \text{Train}(D)
$$

Understanding, reproducing, debugging, comparing, or auditing a model eventually requires an answer to this question:

**What exactly was $$D$$?**

That sounds simple until someone says:

```text
We trained it on customer_features.csv
```

or:

```text
We used the training_data table.
```

Those are names, not identities. The contents behind those names may change every hour. Dataset versioning exists to solve this fundamental problem:

$$
\boxed{
\text{A dataset used by an ML system must have a stable identity through time.}
}
$$

### Why a dataset name is not enough

Suppose your training code contains:

```text
read("customer_features")
```

You train a model on Monday:

$$
M_1 = Train(D_{\text{Monday}})
$$

On Friday, more customers and transactions have arrived. The same command:

```text
read("customer_features")
```

now gives:

$$
D_{\text{Friday}}
$$

So:

$$
D_{\text{Monday}} \neq D_{\text{Friday}}
$$

even though both are called:

```text
customer_features
```

The result creates an important distinction:

$$
\boxed{
\text{dataset name} \neq \text{dataset version}
}
$$

A name answers:

Which logical dataset?

A version answers:

Which exact state of that dataset?

### Dataset versioning begins with identity

Suppose we have these rows:

| customer_id | age | spend |
| ----------- | --: | ----: |
| 101         |  32 |   120 |
| 102         |  45 |    80 |
| 103         |  27 |   210 |

We train a model. Later one row gets corrected:

| customer_id |    age | spend |
| ----------- | -----: | ----: |
| 101         |     32 |   120 |
| 102         | **46** |    80 |
| 103         |     27 |   210 |

From a human perspective this is still:

```text
customer_training_data
```

But from the ML system's perspective:

$$
D_1 \neq D_2
$$

because changing even one relevant value can potentially change:

$$
Train(D_1) \neq Train(D_2)
$$

A useful dataset version identifies a specific **content set or logical snapshot**. A table name alone can continue pointing at changing rows.

### Think of a dataset version like a Git commit

Source code has a similar problem. You would not commonly document a production binary by saying:

"It was built from `main`."

`main` moves. Instead you want something immutable such as:

```text
commit = a8f72c1
```

Then that identifier refers to one historical state of the code. Dataset versioning applies the same idea to data:

```text
customer_features
```

is like a branch name.

```text
customer_features@v381
```

is more like a commit. The desired property is:

$$
\boxed{
\text{Dataset version ID}
\rightarrow
\text{one immutable logical dataset}
}
$$

## What Is the Difference Between a Dataset Artifact and Its Build Recipe?

<!-- section-summary: The artifact is the preserved table snapshot or exact object manifest consumed by the model. -->

### What exactly needs to be versioned?

A common misconception is that dataset versioning means:

"Keep copies of CSV files."

Sometimes that is enough. Often it is not. Suppose your training dataset is generated from:

```text
transactions
customers
subscriptions
```

using transformation code:

```text
feature_pipeline v17
```

with parameters:

```text
prediction_date = 2026-08-01
lookback = 90 days
country = UK
```

Then the dataset depends on all of these things:

$$
D =
F(
I,
C,
P
)
$$

where:

$$
I=\text{input data}
$$

$$
C=\text{code}
$$

$$
P=\text{parameters/configuration}
$$

So proper dataset versioning commonly needs to preserve both:

$$
\boxed{\text{the artifact}}
$$

and:

$$
\boxed{\text{the recipe that produced it}}
$$

These solve different problems.

### The artifact tells you what the dataset was

Suppose you store:

```text
training_dataset_v42/
    part-001.parquet
    part-002.parquet
    part-003.parquet
```

Those files represent the materialized dataset actually consumed by training. Keeping them gives you a strong answer to:

What exact records did the model see?

This matters because rebuilding later is not always guaranteed to produce the same result. Inputs may change. Libraries may change.

External sources may disappear. Transformation behavior may change. So for important model builds, preserving the actual training artifact can be extremely valuable.

### The recipe tells you why the dataset looked that way

Imagine you have the files but no idea how they were produced. You know:

```text
training_dataset_v42
```

contains certain rows. But you cannot explain:

```text
Why were these customers included?
Why were these customers excluded?
Where did feature X come from?
Why is this value NULL?
Which label definition was used?
Which transformation generated this column?
```

That is why versioning should commonly preserve provenance such as:

```text
input snapshots
transformation code version
parameters
configuration
feature definitions
label definition
time window
```

The artifact answers:

What did we use?

The recipe answers:

How did we get it?

### Two different goals

Dataset versioning frequently gets confused with reproducibility. They are related, but different.

#### Historical preservation

You keep the exact dataset:

$$
D_{42}
$$

Then months later you can still inspect:

$$
D_{42}
$$

#### Reproducibility

You keep enough information to run:

$$
F(I,C,P)
$$

again and regenerate:

$$
D'_{42}
$$

Ideally:

$$
D'_{42}=D_{42}
$$

The strongest systems support both. You preserve what happened **and** enough information to recreate it.

### Why rebuilding is not the same as historical reproduction

This distinction is especially important. Suppose a transaction occurred in January and was initially labeled:

```text
fraud = false
```

In March, investigators determine:

```text
fraud = true
```

The original January training dataset contained:

```text
fraud = false
```

Now imagine rebuilding January in April. If you use current corrected labels, you get:

$$
D_{\text{April rebuild}}
\neq
D_{\text{original January}}
$$

That may be desirable. But it is not reproduction. There are actually two legitimate questions:

**What did the model historically train on?**

versus:

**What dataset would we construct now for that historical period using our current knowledge?**

They correspond to two different artifacts.

### Give them different identities

For example:

```text
training_dataset_2026_01_v1
```

might represent the original historical build. After correcting labels:

```text
training_dataset_2026_01_v2
```

represents the improved reconstruction. Then:

$$
v1 \neq v2
$$

and both remain understandable. You might record:

```text
v1 → original production build
v2 → rebuilt after fraud-label correction
```

The dangerous alternative is silently overwriting $$v1$$. Then history disappears.

![Six pieces of evidence that give one dataset version a durable identity](/content-assets/articles/article-mlops-data-for-ml-systems-dataset-versioning-and-lineage/exact-dataset-version.png)

*A logical name identifies an exact dataset version only after it is bound to an immutable snapshot, contract, transformation, time boundary, and manifest.*

## How Do Immutable Versions and Mutable Aliases Work Together?

<!-- section-summary: Immutable versions preserve stable evidence. -->

### Immutability is therefore one of the strongest design principles

Once a version is published:

$$
D_v
$$

its meaning should ideally never change. Instead of:

```text
dataset_v17
```

being edited, corrected, and overwritten, create:

```text
dataset_v18
```

The invariant becomes:

$$
\boxed{
D_v(t_1)=D_v(t_2)
}
$$

for any later times $$t_1,t_2$$. In other words:

> Version 17 always means version 17.

This simple rule removes a remarkable amount of ambiguity.

### Mutable names can still exist

Humans frequently want convenient aliases such as:

```text
latest
production
approved
current
```

That's fine. But those should behave like pointers:

```text
latest → dataset_v182
```

Tomorrow:

```text
latest → dataset_v183
```

The alias moves. The underlying versions do not. So:

$$
\boxed{
\text{mutable alias}
\rightarrow
\text{immutable version}
}
$$

is a useful architecture.

### What constitutes the "exact dataset"?

This question gets subtle with large distributed datasets. Suppose a dataset consists of 500 Parquet objects. One possible identity is:

```text
path = s3://bucket/training/v42/
```

But what if someone replaces one file inside that path? The name remains unchanged while the contents change. A stronger identity uses a **manifest**.

Conceptually:

```text
dataset_v42.manifest

part-001.parquet  hash=A19...
part-002.parquet  hash=F81...
part-003.parquet  hash=882...
...
```

The manifest itself can also be hashed. Then:

$$
H(D)
=
H(
H(f_1),
H(f_2),
\dots,
H(f_n)
)
$$

where $$H$$ is a cryptographic content hash. Now changing a file changes the dataset identity.

### Content hashes give you a powerful invariant

Suppose:

$$
H(D_1)=abc123
$$

After rebuilding:

$$
H(D_2)=abc123
$$

Assuming a suitable hashing scheme and canonical representation, you now have strong evidence that the contents match. If:

$$
H(D_2)=ef7192
$$

something differs. That doesn't tell you whether the difference is correct. But it immediately tells you:

$$
D_1 \neq D_2
$$

This is very useful for detecting accidental mutation.

### But byte-level hashes aren't always enough

Imagine two Parquet datasets contain logically identical rows but:

```text
different file ordering
different compression
different row-group layout
different metadata
```

Their file hashes may differ even though the logical dataset is the same. So there are two useful concepts:

$$
\text{physical identity}
$$

and:

$$
\text{logical identity}
$$

Physical identity asks:

Are these literally the same stored bytes?

Logical identity asks:

Do they represent the same records and values?

Different applications may need different levels of comparison.

## Which Schema, Feature, Label, and Time Semantics Belong in the Version?

<!-- section-summary: The contract records structural schema and semantic meaning: row grain, entity and prediction clocks, feature windows and availability rules, label source and maturity, target transformation, missing states, exclusions,  -->

### A dataset is more than rows: schema matters too

Consider:

```text
customer_id: integer
revenue: float
```

Now somebody changes:

```text
revenue
```

from:

total lifetime revenue in pounds

to:

revenue over the last 30 days in pounds.

The values remain floats. The column name remains the same. Yet the feature has fundamentally changed.

Therefore a dataset version needs to capture not only:

$$
\text{schema structure}
$$

but also:

$$
\text{schema semantics}
$$

### Structural schema and semantic schema are different

Structural schema might say:

```text
revenue:
    float64
    nullable = false
```

Semantic schema says:

```text
revenue:
    total completed transaction value
    denomination = GBP
    window = lifetime
    refunds excluded
    measured as of prediction_time
```

The structural schema tells software how to interpret bytes. The semantic schema tells humans and ML systems what the numbers mean. For ML, both matter.

### Some schema changes are compatible, others are not

Suppose version 1 contains:

```text
user_id
age
country
```

Version 2 adds:

```text
preferred_language
```

A model that only consumes the original fields may remain compatible. But changing:

```text
age: years
```

to:

```text
age: months
```

while keeping the name `age` is much more serious. So versioning systems frequently need rules around changes such as:

$$
\text{backward compatible}
$$

versus:

$$
\text{breaking}
$$

The key question is:

Will existing consumers interpret the new dataset correctly?

### Feature definitions deserve versioning too

Suppose:

```text
transactions_last_30_days
```

was originally:

$$
\sum 1[t-30d \le t_i < t]
$$

Then engineers change it to exclude refunded transactions:

$$
\sum 1[t-30d \le t_i < t
\land \text{not refunded}]
$$

The column name may remain unchanged. But the feature definition changed. Therefore you may want:

```text
feature_definition_version = 3
```

or record the transformation code commit that defines it. Otherwise two datasets can look structurally identical while carrying different meanings.

### Labels require especially careful versioning

Labels are not ordinary columns. They define the learning target. Suppose:

```text
churn = customer canceled within 30 days
```

becomes:

```text
churn = customer had no paid activity for 60 days
```

The field might still be called:

```text
churn
```

But:

$$
Y_{\text{old}} \neq Y_{\text{new}}
$$

That is effectively a different ML problem. A dataset version should therefore make the label definition identifiable. For example:

```text
label_definition = churn_v4
label_maturity_window = 60 days
```

### Dataset versioning should preserve time semantics

ML data is frequently historical. Suppose a row represents a prediction made at:

$$
t_p
$$

A feature must generally satisfy:

$$
t_{\text{feature available}} \le t_p
$$

If you don't record how point-in-time joins were performed, you may later reconstruct a dataset using today's values and accidentally leak future information. For example:

```text
customer_status today = premium
```

does not imply:

```text
customer_status at prediction time = premium
```

So dataset versions frequently need information such as:

```text
event window
snapshot time
prediction time
label cutoff
data availability cutoff
```

Time semantics are part of dataset meaning.

## How Does Lineage Connect Source Data, Dataset Builds, and Model Runs?

<!-- section-summary: Runtime lineage records which job run consumed each source version and produced the dataset, then which training and evaluation runs consumed that dataset and produced models. -->

### Lineage tells you where a dataset came from

Suppose the final dataset is produced through:

```text
transactions_raw ──────┐
                       ↓
                 clean_transactions
                       │
customers ─────────────┼────→ customer_features
                       │
fraud_cases ───────────┘
                       ↓
                training_dataset_v42
```

This dependency structure is **data lineage**. For `training_dataset_v42`, lineage answers:

Which upstream artifacts contributed to it?

That can include exact versions:

```text
transactions_raw@891
customers@318
fraud_cases@102
```

rather than merely logical table names.

### Why lineage and versioning reinforce each other

Imagine discovering:

```text
customers@318 contained corrupted birth dates
```

With lineage you can ask:

$$
\text{Which descendants used customers@318?}
$$

Perhaps:

```text
customer_features@511
training_dataset@42
training_dataset@43
```

and then:

```text
model@17
model@18
```

Now you know the blast radius. Without version-level lineage, you may only know:

"Some models used the customer table."

That is far less actionable.

### The chain should ideally extend all the way to the model

Suppose:

$$
D_{42}
$$

was used to train:

$$
M_{17}
$$

Record that relationship. Then the system can answer:

```text
model_v17
    ↓ trained from
dataset_v42
    ↓ built from
feature_data_v91
    ↓ built from
transactions_v812
customers_v318
```

This produces a causal chain:

$$
\boxed{
\text{Source Data}
\rightarrow
\text{Derived Data}
\rightarrow
\text{Training Dataset}
\rightarrow
\text{Training Run}
\rightarrow
\text{Model}
}
$$

This lineage graph is among the most useful records an ML platform can provide.

### Training metadata completes the connection

Suppose two models use the same dataset:

$$
M_1 = Train(D_{42},\theta_1)
$$

$$
M_2 = Train(D_{42},\theta_2)
$$

Their differences are probably attributable to:

```text
training code
hyperparameters
random seed
environment
```

But if they use:

$$
D_{42}
$$

and:

$$
D_{43}
$$

then dataset changes are another possible cause. Without explicit dataset versions, model comparison becomes much harder because you don't know what changed.

### Think of the model as the result of two versioned build systems

There is a **data build**:

$$
D_v =
BuildData(
I,
C_d,
P_d
)
$$

and then a **model build**:

$$
M_k =
Train(
D_v,
C_m,
P_m
)
$$

where:

$$
C_d=\text{data pipeline code}
$$

$$
P_d=\text{data parameters}
$$

$$
C_m=\text{training code}
$$

$$
P_m=\text{hyperparameters}
$$

A reproducible ML system therefore tracks both chains.

![Lineage from a source snapshot through a dataset and training run to a model, batch scores, and an online endpoint](/content-assets/articles/article-mlops-data-for-ml-systems-dataset-versioning-and-lineage/lineage-blast-radius.png)

*Lineage makes the blast radius visible: a corrected source field can be traced to every dataset, model, and production output that used it.*

## When Should Teams Preserve Bytes Instead of Rebuilding Them?

<!-- section-summary: Preserve the exact artifact when source history can expire, external dependencies can change, historical environments may disappear, or the release needs strong audit and reproduction evidence. -->

### Dataset versioning can be physical or logical

Suppose you have a huge 50 TB table. Copying all 50 TB every time one partition changes is wasteful. You don't necessarily need physical duplication.

A dataset version might instead refer to immutable pieces:

```text
dataset_v100:
    partition Jan → object A
    partition Feb → object B
    partition Mar → object C

dataset_v101:
    partition Jan → object A
    partition Feb → object B
    partition Mar → object D
```

Most data is shared. Only the changed partition is new. This is conceptually similar to persistent data structures or Git objects.

The requirement is not:

Copy everything.

The requirement is:

Preserve a stable mapping from version to contents.

### Snapshot-based storage is especially useful

Modern table formats and data stores may expose snapshot identities. Conceptually:

```text
customers snapshot 481
```

means:

The exact state of `customers` represented by snapshot 481.

Then dataset metadata can record:

```text
customer_snapshot = 481
transaction_snapshot = 991
```

Instead of physically duplicating source tables. The critical property is that the referenced snapshot remains readable for as long as reproducibility requires it.

### Retention is therefore part of versioning

Suppose your metadata says:

```text
training_dataset_v42
used transactions_snapshot_991
```

But six weeks later snapshot 991 has been deleted. Your metadata survived. The actual evidence did not.

Therefore:

$$
\boxed{
\text{version metadata without retention}
\neq
\text{historical reproducibility}
}
$$

You need an explicit retention policy.

### Not everything needs to be retained forever

Keeping every intermediate artifact forever may be enormously expensive. So retention should depend on value. Consider you might retain:

```text
production training datasets
important source snapshots
model-associated labels
audit metadata
```

longer than:

```text
temporary staging data
easily reconstructed intermediate joins
debug outputs
```

The right question is:

What would we need in order to explain or reproduce an important historical model?

That should influence retention.

### Data retention also creates privacy and security responsibilities

Historical datasets may contain sensitive information. Versioning can increase risk because instead of holding only today's state, you may now preserve many historical states. Consider if a customer requests deletion, their information might exist in:

```text
dataset_v51
dataset_v52
dataset_v53
...
```

So versioning needs to coexist with:

```text
access control
encryption
retention limits
deletion policies
audit logging
```

"Immutable" cannot merely mean:

Nobody can ever remove anything under any circumstance.

Operational immutability must coexist with privacy, legal, and security requirements.

### Separate artifact immutability from access policy

A useful distinction is:

$$
\text{artifact contents}
$$

versus:

$$
\text{who may access artifact}
$$

You might preserve an immutable dataset while progressively restricting access:

```text
active training dataset
→ limited historical dataset
→ archive
→ deletion when retention expires
```

The approach retains controlled historical evidence while avoiding unrestricted access to old training records.

## How Can a Rebuild Prove Physical, Logical, or Semantic Equivalence?

<!-- section-summary: Physical equivalence compares exact bytes or content hashes. -->

### How do you prove a rebuilt dataset matches?

Suppose you intentionally reconstruct:

$$
D'
$$

from the stored recipe. You want to know whether:

$$
D'=D
$$

Start with structural checks:

$$
schema(D') = schema(D)
$$

Then counts:

$$
|D'|=|D|
$$

Then keys:

$$
Keys(D')=Keys(D)
$$

Then values. If canonical representation is possible:

$$
H(D')=H(D)
$$

gives strong evidence of equality. For very large datasets, you may also compare partition hashes or record-level fingerprints.

### Compare by stable keys where possible

Suppose both datasets have:

```text
example_id
```

Then compare:

$$
D \Join D'
$$

on `example_id`. You can detect:

```text
rows missing from rebuild
new unexpected rows
changed feature values
changed labels
```

For example:

$$
\Delta_j
=
|\{i:D_{ij}\neq D'_{ij}\}|
$$

for column $$j$$. This identifies both whether the datasets differ and **where** the differences occur.

### Floating-point data may require tolerance

Suppose one distributed execution produces:

$$
0.30000000004
$$

and another:

$$
0.29999999999
$$

Byte-for-byte equality fails. But logically the feature may be equivalent. So numerical comparison might use:

$$
|x-y| < \epsilon
$$

for an appropriate tolerance. Again, dataset equality can mean different things:

$$
\text{byte equality}
$$

$$
\text{record equality}
$$

$$
\text{semantic equivalence}
$$

You should decide which guarantee matters.

### Rebuild verification should itself be automated

Don't rely only on:

"The new dataset looks roughly right."

For important datasets, comparison can produce a report:

| Check               |   Original |    Rebuild | Result |
| ------------------- | ---------: | ---------: | ------ |
| Rows                | 81,421,731 | 81,421,731 | Pass   |
| Columns             |        184 |        184 | Pass   |
| IDs                 |   matching |   matching | Pass   |
| Labels              |   matching |   matching | Pass   |
| Missingness         |   matching |   matching | Pass   |
| Content fingerprint |  identical |  identical | Pass   |

Then reconstruction becomes a testable property.

### Versioning also helps isolate why models changed

Suppose model accuracy falls:

$$
0.91 \rightarrow 0.86
$$

You want to ask:

```text
Did the model code change?
Did hyperparameters change?
Did the training dataset change?
Did feature definitions change?
Did label definitions change?
```

Versioned components make this analysis possible. For example:

```text
Model 17:
dataset_v42
trainer_v8
hyperparams_v3

Model 18:
dataset_v43
trainer_v8
hyperparams_v3
```

Only the dataset changed. That significantly narrows the investigation.

### Dataset versions are also critical for experiments

Imagine a researcher runs:

```text
Experiment A → accuracy 0.881
Experiment B → accuracy 0.894
```

But A was trained on Monday's dataset and B on Thursday's dataset. Then you cannot safely conclude:

B's algorithm is better.

The experiment changed two variables:

$$
\text{algorithm}
$$

and:

$$
\text{data}
$$

Controlled experimentation requires holding the dataset constant:

$$
D_A=D_B
$$

while changing the model variable you actually want to measure. Dataset versioning makes that possible.

## What Record Makes a Dataset Version Reusable and Auditable?

<!-- section-summary: The version record joins logical name, immutable artifact, manifest or digest, contract, source states, build code, configuration, environment, run, time boundaries, quality evidence, owners, retention, access, purpose,  -->

### Pitfall: putting the date in the filename

You may see:

```text
training_data_2026_08_20.csv
```

This is better than:

```text
training_data.csv
```

but it does not necessarily identify the contents. What if the pipeline reruns August 20 three times?

```text
first build
corrected build
backfilled build
```

All could have the same date. So:

$$
\text{logical date} \neq \text{dataset version}
$$

Date is useful metadata. It is not necessarily sufficient identity.

### Pitfall: overwriting historical partitions

Imagine:

```text
date=2026-08-20/
```

is regenerated after a correction. If files are replaced in place, then:

```text
date=2026-08-20
```

means one thing today and another tomorrow. A model that historically referenced that partition can no longer be reconstructed reliably. Prefer:

```text
date=2026-08-20/version=1
date=2026-08-20/version=2
```

or snapshot-level table versions.

### Pitfall: versioning the dataset but not the code

Suppose you preserve:

```text
dataset_v81
```

but don't record which transformation code produced it. You can inspect the old artifact. But you cannot reliably rebuild it or understand obscure calculations.

So the version should point to something like:

```text
data_pipeline_commit = 1bf89d2
```

or another immutable build identifier.

### Pitfall: versioning code but not configuration

The same code might run with:

```text
lookback_days = 30
```

or:

```text
lookback_days = 90
```

producing completely different data. Thus:

$$
D =
F(I,C,P)
$$

not merely:

$$
D=F(I,C)
$$

Parameters matter.

### Pitfall: recording configuration as "production"

Suppose metadata says:

```text
config = production
```

But the production configuration changes next month. You've saved another mutable pointer. A stronger approach records:

```text
config_version = 17
```

or stores the resolved configuration itself. Again:

$$
\boxed{
\text{record resolved immutable values, not moving aliases}
}
$$

### Pitfall: not versioning external dependencies

Suppose your pipeline calls an external enrichment service:

```text
IP address → geographic region
```

The service's database changes continuously. Re-running historical data later may produce different countries or regions. If that feature matters, you may need:

```text
geolocation_database_version
```

or preserve the enriched result. Anything that affects the output is, conceptually, an input dependency.

### Pitfall: assuming SQL is enough provenance

Imagine you save:

```sql
SELECT ...
FROM customers
JOIN transactions ...
```

That tells you the transformation. But if `customers` and `transactions` are mutable, the query does not identify what it read. The real computation is:

$$
Query(
customers@v_c,
transactions@v_t
)
$$

So provenance requires both:

$$
\text{transformation}
+
\text{input versions}
$$

### Pitfall: versioning only the final table

Suppose:

```text
training_dataset_v42
```

is preserved. But an important derived feature table used in its construction is overwritten. You can preserve the final dataset, but investigating how feature values were produced becomes harder.

Temporary operations can expire while key lineage points remain identifiable. Think in terms of:

$$
\text{audit value}
$$

rather than merely:

$$
\text{number of files}
$$

### Pitfall: dataset version equals pipeline run ID

Suppose:

```text
run_98172
```

produces a dataset. Then a retry:

```text
run_98173
```

produces exactly the same logical output. Are these two dataset versions? Not necessarily.

A **pipeline run** represents an execution event. A **dataset version** represents a data artifact. Several attempts may lead to one published version.

So keep separate:

$$
\text{execution identity}
$$

and:

$$
\text{artifact identity}
$$

### Pipeline run, dataset version, and model version are different objects

A useful conceptual model is:

```text
Pipeline Definition
        ↓
Pipeline Run
        ↓
Dataset Version
        ↓
Training Run
        ↓
Model Version
```

For example:

```text
pipeline:
customer_features v12

pipeline run:
run_98172

dataset:
customer_features_v438

training run:
train_712

model:
churn_model_v91
```

Each has a different purpose. Connecting them creates strong provenance.

### Pitfall: assuming a model registry alone solves dataset versioning

A model registry may tell you:

```text
model = fraud_v32
```

and perhaps:

```text
training_dataset = fraud_training
```

But if `fraud_training` is mutable, this is insufficient. The model should ideally point to:

```text
fraud_training@v918
```

The principle is:

$$
\boxed{
\text{model artifact}
\rightarrow
\text{immutable dataset identity}
}
$$

not merely a dataset name.

### Dataset versioning also needs quality metadata

Suppose two dataset versions exist:

```text
v81
v82
```

Why was v82 published? Perhaps because:

```text
mobile missingness fixed
incorrect labels repaired
new source added
```

Recording validation results helps explain the transition. For example:

```text
row_count = 91,821,772
duplicate_rate = 0
label_positive_rate = 0.0148
validation_suite = quality_rules_v19
validation_result = passed
```

The result gives historical context to the artifact.

### Versioning should record intent, not only mechanics

Suppose:

```text
dataset_v83
```

differs substantially from `v82`. Metadata showing 300 changed files is mechanically correct but not very informative. It is also useful to record:

```text
reason:
exclude test merchant transactions after incident INC-417
```

or:

```text
reason:
rebuild with mature fraud labels through July 31
```

This explains why the version exists. The versioning system then helps humans understand history, not merely preserve bytes.

### Dataset versions are scientific specimens

Imagine someone publishes a scientific result based on:

```text
sample A
```

Later they cannot identify which physical sample "A" actually was. The experiment becomes difficult to verify. Training data plays a similar role.

A model's measured behavior is an empirical result derived from a particular data sample. So you want:

$$
\boxed{
\text{dataset identity}
+
\text{measurement procedure}
+
\text{experimental configuration}
}
$$

This is why ML reproducibility depends heavily on dataset versioning.

### Datasets are build artifacts

Consider software:

```text
source code
+
compiler
+
dependencies
+
build configuration
↓
binary artifact
```

For data:

```text
source snapshots
+
transformation code
+
configuration
+
time semantics
↓
dataset artifact
```

Then for ML:

```text
dataset artifact
+
training code
+
hyperparameters
↓
model artifact
```

From this perspective, the ML system contains two linked build processes:

$$
\boxed{
\text{Data Build}
\rightarrow
\text{Model Build}
}
$$

Dataset versions are the interface between them.

### What should be recorded for every important dataset version?

A useful record might conceptually contain:

| Area                | Example                       |
| ------------------- | ----------------------------- |
| Dataset identity    | `fraud_training_v918`         |
| Logical dataset     | `fraud_training`              |
| Creation time       | `2026-08-21T03:14Z`           |
| Logical time window | `2025-01-01 → 2026-07-01`     |
| Physical location   | immutable snapshot / manifest |
| Content fingerprint | hash or snapshot ID           |
| Input versions      | transactions@812, users@481   |
| Pipeline code       | commit `a83f7c1`              |
| Configuration       | config version 19             |
| Parameters          | label lag=45d, lookback=90d   |
| Schema version      | schema v12                    |
| Feature definitions | feature set v31               |
| Label definition    | fraud label v7                |
| Quality rules       | validation suite v16          |
| Validation result   | passed                        |
| Lineage             | parent datasets               |
| Build run           | pipeline run 81721            |
| Reason for creation | corrected fraud labels        |
| Training usage      | model runs 9182, 9197         |
| Retention class     | production-model evidence     |
| Access policy       | ML-risk-data group            |

Not every organization needs every field. The principle is that the record should answer:

$$
\boxed{
\text{What was it, where did it come from, and who used it?}
}
$$

### A concrete end-to-end example

Suppose we're building a fraud model. The pipeline produces:

```text
fraud_training_v72
```

for predictions made between January and June. Its metadata says:

```text
logical_dataset:
fraud_training

version:
72

prediction_window:
2026-01-01 through 2026-06-30

inputs:
transactions snapshot 881
accounts snapshot 314
chargebacks snapshot 551

feature_code:
commit 827fa91

feature_set:
fraud_features_v12

label_definition:
confirmed_chargeback_within_60_days_v3

label_cutoff:
2026-08-29

configuration:
fraud_training_config_v8

pipeline_run:
run_91273

schema:
fraud_schema_v9

validation:
quality_suite_v17 = PASS

content:
manifest hash = 91a77...

published_at:
2026-08-30
```

Then training produces:

```text
fraud_model_v21
```

with metadata:

```text
training_dataset:
fraud_training_v72

training_code:
commit f12c99a

hyperparameters:
config v31

random_seed:
71821
```

Now, six months later, someone investigates model 21. They can traverse:

```text
fraud_model_v21
        ↓
fraud_training_v72
        ↓
feature code + label definition
        ↓
source snapshots
```

That is what good dataset versioning buys you.

### A label bug is discovered

Suppose `chargebacks snapshot 551` incorrectly marked some cases as negative. Engineers fix it. They should not silently mutate:

```text
fraud_training_v72
```

Instead they create:

```text
fraud_training_v73
```

with:

```text
chargebacks snapshot 559
```

and reason:

```text
rebuild after correction to chargeback labeling
```

Now:

$$
D_{72} \neq D_{73}
$$

and that's okay. Historical facts remain clear:

```text
model_v21 used v72
model_v22 used v73
```

You can now measure the effect of the correction.

### Suppose someone wants to reproduce version 72

The system resolves:

```text
transactions@881
accounts@314
chargebacks@551
feature code 827fa91
config v8
```

It reconstructs:

$$
D'_{72}
$$

Then verification compares:

$$
schema(D'_{72})
$$

$$
rowcount(D'_{72})
$$

$$
keys(D'_{72})
$$

$$
labels(D'_{72})
$$

$$
fingerprint(D'_{72})
$$

against the stored original. If they match, you have demonstrated reproducibility. If they do not, the difference itself becomes useful diagnostic information.

### Rebuilding a corrected historical dataset

That is a different request. You may deliberately use:

```text
transactions@latest-corrected
accounts@latest-corrected
chargebacks@559
new feature code
```

but preserve the same historical prediction window. The result creates:

$$
D_{\text{corrected}}
$$

not:

$$
D_{72}
$$

Both can be valuable. One explains history. The other improves future training.

Never confuse them.

### Identity versus derivation

There are two independent questions:

#### Identity

Which exact dataset is this?

Answered by things such as:

```text
immutable snapshot
manifest
version ID
content hash
```

#### Derivation

How was this dataset produced?

Answered by:

```text
input versions
code version
parameters
lineage
```

A mature versioning system records both. Why? Because you may possess the artifact while losing the recipe.

Or possess the recipe while losing the historical inputs. Neither is as strong as possessing both.

### Dataset versioning is really about preserving causality

The model is an effect. Its training process is a cause. Its dataset is another cause.

The dataset's sources and transformations are further causes. Conceptually:

$$
I
\xrightarrow{C_d,P_d}
D
\xrightarrow{C_m,P_m}
M
$$

Good versioning lets you walk backward:

$$
M
\rightarrow
D
\rightarrow
I
$$

and answer:

Why does this artifact exist in this exact form?

That is why versioning is more than storage management. It is the preservation of causal history.

#### What to remember

Dataset versioning starts with a very simple observation:

$$
\boxed{
\text{A dataset name does not uniquely identify its contents.}
}
$$

So every important ML dataset needs an immutable identity:

$$
\boxed{
\text{Dataset Version}
\rightarrow
\text{one specific logical dataset}
}
$$

But identity alone is not enough. You also want to preserve how the dataset was produced:

$$
\boxed{
D_v =
F(
\text{input versions},
\text{code version},
\text{configuration},
\text{time semantics}
)
}
$$

Then connect that version to training:

$$
\boxed{
\text{Source Versions}
\rightarrow
\text{Dataset Version}
\rightarrow
\text{Training Run}
\rightarrow
\text{Model Version}
}
$$

The central design principles follow naturally:

$$
\boxed{
\text{Immutable versions, mutable aliases}
}
$$

$$
\boxed{
\text{Preserve both artifact and provenance}
}
$$

$$
\boxed{
\text{Never overwrite history when meaning changes}
}
$$

$$
\boxed{
\text{Distinguish reproducing history from rebuilding it with corrected knowledge}
}
$$

$$
\boxed{
\text{Keep enough data and metadata to verify reconstruction}
}
$$

The deepest reason for doing all of this is not administrative neatness. It is that an ML model cannot really be understood independently of the data that created it. If you cannot identify the training dataset, you cannot fully identify the experiment that produced the model.

A trustworthy ML system keeps enough lineage to answer this question years after the original training run:

**Exactly what data did this model learn from, what did that data mean at the time, where did it come from, and can we prove it?**

![Snapshot, contract, and lineage joined with retention, access, and verification to create reproducible model evidence](/content-assets/articles/article-mlops-data-for-ml-systems-dataset-versioning-and-lineage/dataset-versioning-summary.png)

*The complete record joins exact data, agreed meaning, and downstream history with the controls needed to preserve and verify the evidence.*

## Check Your Answers

Use these answers to revisit the evidence, boundaries, and operating decisions behind each question.

:::expand[Why Is a Dataset Name Not a Dataset Version?]{kind="recap"}
A logical name describes a dataset family while its contents can change through new rows, corrections, labels, and transformations.

A version identifies one fixed state and its meaning. Training and evaluation records need that immutable identity so later comparisons do not silently read a different dataset under the same name.
:::

:::expand[What Is the Difference Between a Dataset Artifact and Its Build Recipe?]{kind="recap"}
The artifact is the preserved table snapshot or exact object manifest consumed by the model.

The recipe contains pinned sources, code, configuration, logical time, environment, and rules that derived it. The artifact supports direct historical retrieval; the recipe explains the computation and may rebuild it if every dependency remains available.
:::

:::expand[How Do Immutable Versions and Mutable Aliases Work Together?]{kind="recap"}
Immutable versions preserve stable evidence.

Mutable aliases such as `current`, `approved`, or `champion-data` help consumers discover the selected version. A run resolves the alias at its boundary and records the immutable target, preventing the alias from moving during execution and leaving the input ambiguous.
:::

:::expand[Which Schema, Feature, Label, and Time Semantics Belong in the Version?]{kind="recap"}
The contract records structural schema and semantic meaning: row grain, entity and prediction clocks, feature windows and availability rules, label source and maturity, target transformation, missing states, exclusions, split policy, and permitted changes. A compatible type alone cannot preserve a changed unit, population, or outcome definition.
:::

:::expand[How Does Lineage Connect Source Data, Dataset Builds, and Model Runs?]{kind="recap"}
Runtime lineage records which job run consumed each source version and produced the dataset, then which training and evaluation runs consumed that dataset and produced models.

Backward traversal explains provenance. Forward traversal identifies the blast radius of a bad source, transformation, label rule, or dataset version.
:::

:::expand[When Should Teams Preserve Bytes Instead of Rebuilding Them?]{kind="recap"}
Preserve the exact artifact when source history can expire, external dependencies can change, historical environments may disappear, or the release needs strong audit and reproduction evidence.

A recipe remains valuable for explanation and corrected reconstruction. Retention, privacy, deletion, and access policies determine which bytes may remain and for how long.
:::

:::expand[How Can a Rebuild Prove Physical, Logical, or Semantic Equivalence?]{kind="recap"}
Physical equivalence compares exact bytes or content hashes.

Logical equivalence compares stable row identities, splits, labels, and values under documented numeric tolerances despite file-layout differences. Semantic equivalence supports the same contract even if corrected knowledge changes some records. The verification report states the claimed level and each comparison result.
:::

:::expand[What Record Makes a Dataset Version Reusable and Auditable?]{kind="recap"}
The version record joins logical name, immutable artifact, manifest or digest, contract, source states, build code, configuration, environment, run, time boundaries, quality evidence, owners, retention, access, purpose, downstream runs, and known limitations. This record lets another team retrieve, interpret, compare, rebuild, or retire the dataset responsibly.
:::

## References

- [Amazon S3: Checking object integrity for uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html) - Documents stored checksums and the limits of interpreting ETags as content hashes.
- [OpenLineage: Object Model](https://openlineage.io/docs/spec/object-model) - Defines datasets, jobs, runs, runtime events, and lineage facets.
