---
title: "Data Validation"
description: "Build layered validation that prevents completed pipelines from publishing unsafe ML data."
overview: "ML data validation checks source readiness, structure, meaning, relationships, time, distributions, labels, and leakage before a dataset can enter training or serving. Publication gates connect those checks to quarantine, repair, evidence, ownership, and monitoring."
tags: ["MLOps", "core", "validation"]
order: 1
id: "article-mlops-data-for-ml-systems-data-validation-for-ml-pipelines"
---

## Table of Contents

1. [Why Can a Successful Pipeline Still Publish Invalid ML Data?](#why-can-a-successful-pipeline-still-publish-invalid-ml-data)
2. [How Do Freshness and Completeness Establish Source Readiness?](#how-do-freshness-and-completeness-establish-source-readiness)
3. [How Do Schema, Value, and Relationship Checks Work Together?](#how-do-schema-value-and-relationship-checks-work-together)
4. [How Do Temporal Checks Protect Feature and Label Meaning?](#how-do-temporal-checks-protect-feature-and-label-meaning)
5. [How Do Population and Segment Checks Distinguish Change from Corruption?](#how-do-population-and-segment-checks-distinguish-change-from-corruption)
6. [How Are Labels, Leakage, and Split Integrity Validated?](#how-are-labels-leakage-and-split-integrity-validated)
7. [How Should Validation Results Control Quarantine, Repair, and Publication?](#how-should-validation-results-control-quarantine-repair-and-publication)
8. [How Do Owners, Evidence, and Tests Keep the Validator Trustworthy?](#how-do-owners-evidence-and-tests-keep-the-validator-trustworthy)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A nightly pipeline reads every expected file, finishes every transformation, and writes a training table. The scheduler marks the run successful. The table can still be unsafe for training.

Suppose an upstream identifier changes from an integer to a prefixed string. The transformation converts both forms to text, so it does not crash. The label join now matches only 62 percent of examples instead of its usual 96 percent. Every column exists, but more than one third of the outcomes are missing.

**Data validation asks whether this dataset is fit for this ML use.** It checks more than file existence and SQL success. It examines source freshness, schema, values, joins, time boundaries, population coverage, labels, leakage, and split integrity. The result controls whether a candidate dataset is published, quarantined, or rebuilt.

Follow those checks from source to release:

1. **Why Can a Successful Pipeline Still Publish Invalid ML Data?**
2. **How Do Freshness and Completeness Establish Source Readiness?**
3. **How Do Schema, Value, and Relationship Checks Work Together?**
4. **How Do Temporal Checks Protect Feature and Label Meaning?**
5. **How Do Population and Segment Checks Distinguish Change from Corruption?**
6. **How Are Labels, Leakage, and Split Integrity Validated?**
7. **How Should Validation Results Control Quarantine, Repair, and Publication?**
8. **How Do Owners, Evidence, and Tests Keep the Validator Trustworthy?**

## Why Can a Successful Pipeline Still Publish Invalid ML Data?

<!-- section-summary: Schedulers and query engines prove that work executed, not that the output represents the ML problem correctly. -->

A data pipeline can run successfully and still produce a dataset that is completely unsafe for machine learning. That is the starting point. Suppose a job:

```text
starts successfully
reads every source table
executes every SQL query
writes 20 million rows
uploads the output
returns exit code 0
```

Operationally, the job succeeded. But imagine the resulting dataset has:

```text
99% missing income values
duplicated customers
future information in features
labels shifted by one day
no positive examples
transactions from the wrong country
2024 data instead of 2026 data
```

The computer successfully produced the wrong thing. So:

$$
\boxed{
\text{Pipeline success} \neq \text{data correctness}
}
$$

**Data validation** gathers and checks the evidence a team needs before downstream ML work can rely on a dataset for a stated purpose.

### Why ML data needs more validation than ordinary file processing

Suppose you are copying a file. A simple correctness question might be:

Did all the bytes arrive?

For ML, that is nowhere near enough. We need questions such as:

Are these actually the customers we intended to score?

Do these timestamps represent the correct historical moments?

Are negative labels genuinely negative rather than unresolved?

Did a source system backfill future information?

Has the population changed dramatically?

Are related examples leaking across train and test?

Does `account_status` mean the same thing as last month?

So ML datasets have multiple notions of correctness. A useful hierarchy is:

$$
\boxed{
\text{Can we read it?}
\rightarrow
\text{Is it structurally valid?}
\rightarrow
\text{Is it internally consistent?}
\rightarrow
\text{Does it represent the intended reality?}
\rightarrow
\text{Is it safe for this ML use?}
}
$$

The farther right you go, the harder the questions become. But they are also more important.

### Validation is really about claims

Suppose someone publishes:

```text
churn_training_v42
```

By publishing it, they are implicitly making claims:

These rows represent eligible historical churn prediction opportunities.

These features were knowable at prediction time.

These labels correctly describe later churn.

The data covers the expected population.

No known critical integrity violation exists.

Validation is the evidence supporting those claims. You can think of a dataset release as:

$$
Dataset + ValidationEvidence
\rightarrow
TrustedArtifact
$$

Without validation, you merely have:

$$
Dataset
\rightarrow
Hope
$$

### The intended dataset contract

Before asking whether data is valid, define what **valid** means. Suppose the ML task is:

Every Monday, predict whether an active paying subscriber will voluntarily cancel within 30 days.

Then the dataset contract may say:

```text
one row = one eligible subscriber at Monday 00:00 UTC
subscriber must be active and paying
account age >= 30 days
features use only information available before prediction time
label = voluntary cancellation during next 30 days
negative label requires complete 30-day observation window
```

Now validation can test claims derived from that definition. For example:

$$
prediction\_weekday = Monday
$$

$$
account\_status_{prediction}=active
$$

$$
feature\_available\_time \le prediction\_time
$$

$$
Y=1
\Rightarrow
cancel\_time\in(t,t+30d]
$$

This is much stronger than generic checks like:

```text
no nulls
correct types
```

Validation should emerge from the **meaning of the ML problem**.

### A successful query can still answer the wrong question

Imagine this SQL runs perfectly:

```sql
SELECT *
FROM customers
WHERE status = 'active'
```

But you are constructing historical training rows from January 2025. The query uses today's customer status. A customer who was active in January 2025 but cancelled later is now excluded.

Another customer's current plan may differ from their historical plan. The query is valid SQL. The database returns consistent data.

The pipeline succeeds. The dataset is wrong. This shows why:

$$
\boxed{
\text{technical validity}
\neq
\text{semantic validity}
}
$$

### Validation is best thought of in layers

No single check can prove an ML dataset is safe. A useful layered model is:

$$
\text{Source readiness}
$$

$$
\downarrow
$$

$$
\text{Schema and shape}
$$

$$
\downarrow
$$

$$
\text{Row-level values}
$$

$$
\downarrow
$$

$$
\text{Relationships and invariants}
$$

$$
\downarrow
$$

$$
\text{Temporal correctness}
$$

$$
\downarrow
$$

$$
\text{Population and distribution}
$$

$$
\downarrow
$$

$$
\text{Label correctness}
$$

$$
\downarrow
$$

$$
\text{Leakage and split integrity}
$$

$$
\downarrow
$$

$$
\text{Publication decision}
$$

Each layer catches different failure modes.

## How Do Freshness and Completeness Establish Source Readiness?

<!-- section-summary: Validation moves from source readiness through schema, values, relationships, time, population, labels, leakage, splits, and publication. -->

### Layer 1: Is the source ready?

Before validating the derived dataset, ask whether its inputs are complete enough to use. Suppose a daily transaction table normally receives:

$$
10M
$$

rows by 06:00. Today it contains:

$$
3.2M
$$

rows. Your feature-generation pipeline can still run. It will happily calculate:

```text
transactions_last_24h
```

using incomplete data. Those features may be dramatically wrong. So before building anything, check source readiness.

### Source readiness is a contract between producers and consumers

A source table might promise:

```text
daily partition ready by 06:00 UTC
at least 99.8% of expected records loaded
schema version = 14
late-arriving updates < 0.5%
```

The downstream ML pipeline should verify those assumptions. Conceptually:

$$
SourceReady(S,t)
\in
\{true,false\}
$$

Only if:

$$
SourceReady=true
$$

should dependent jobs proceed. The control prevents downstream validation from trying to repair a source that was never complete in the first place.

### Freshness is one of the simplest and most valuable checks

Suppose your pipeline runs August 28. But:

```text
MAX(event_date) = August 23
```

The source may be stale. A freshness check asks:

$$
current\_time - latest\_source\_time
\le
allowed\_lag
$$

For example:

$$
lag \le 2h
$$

or:

$$
latest\_partition = yesterday
$$

depending on the source. Many catastrophic data incidents are merely:

"The pipeline used yesterday's yesterday's data."

Freshness validation catches that early.

### Completeness is different from freshness

Suppose the latest partition exists. Great. But perhaps only half of it arrived.

So you also check volume. For example:

$$
rows_{today}
$$

against:

$$
median(rows_{last\ 28\ days})
$$

If typical volume is:

$$
10M\pm0.5M
$$

and today's partition has:

$$
2.8M
$$

something is wrong. A basic threshold might be:

$$
0.8
<
\frac{rows_{today}}
{expected\ rows}
<
1.2
$$

But fixed thresholds should be used carefully when traffic naturally varies.

### Source validation should inspect partitions, not just entire tables

Suppose a warehouse table contains five years of data. Total row count:

$$
3.4B
$$

Looks fine. But today's partition is empty. A whole-table row-count check may not notice.

For periodic data, validate the slice actually used:

```text
partition = 2026-08-27
region = UK
event_type = payment
```

Validation should align with consumption boundaries.

![Seven validation layers covering source readiness, structure, meaning, relationships, time, distributions, labels, and leakage](/content-assets/articles/article-mlops-data-for-ml-systems-data-validation-for-ml-pipelines/seven-validation-layers.png)

*Each layer answers a different safety question before the dataset can be considered for training.*

## How Do Schema, Value, and Relationship Checks Work Together?

<!-- section-summary: Source checks verify arrival, freshness, partitions, and completeness. -->

### Layer 2: schema and data shape

Now assume the source is ready. The simplest dataset checks concern structure. Examples:

```text
required columns exist
unexpected columns absent
types match expectations
column order where relevant
valid enum values
nullability constraints
primary keys present
```

Suppose training expects:

```text
customer_id STRING
prediction_time TIMESTAMP
sessions_30d INTEGER
spend_90d FLOAT
target INTEGER
```

but today's pipeline produces:

```text
spend_90d STRING
```

That should fail early.

### Schema validation prevents accidental interface changes

A downstream model frequently depends on a stable interface:

$$
X =
[x_1,x_2,\ldots,x_p]
$$

If a column disappears or changes meaning, predictions may become nonsensical. So a schema is effectively an API contract for data. You might validate:

$$
columns_{actual}
=
columns_{expected}
$$

or allow explicitly declared backward-compatible extensions. The important point is that schema evolution should be deliberate rather than accidental.

### Types are necessary but weak

Suppose:

```text
age = -40
```

The type is valid:

```text
INTEGER
```

But the value is impossible. Similarly:

```text
probability = 7.3
```

is a valid float. So schema validation only tells us:

The values have the correct representation.

It does not tell us:

The values make sense.

This motivates row-level validation.

### Layer 3: value-level checks

For each field, define plausible domains. Examples:

$$
age \in [0,120]
$$

$$
probability \in [0,1]
$$

$$
transaction\_amount \ge 0
$$

$$
country \in allowed\_countries
$$

$$
prediction\_time \neq NULL
$$

These are **domain constraints**. They catch impossible or malformed values.

### Nulls require semantic interpretation

A common check is:

$$
null\_rate(feature) < threshold
$$

For example:

```text
income null rate <= 5%
```

But nulls are not always invalid. A missing value might legitimately mean:

```text
not applicable
not yet collected
unknown
user declined
source unavailable
```

Those meanings differ. So validation should ask:

Is null permitted here, and if so, what does it mean?

For a required primary key:

$$
NULL
$$

is probably fatal. For an optional demographic field, it may be perfectly normal.

### Sudden null-rate changes are often more informative than absolute null rates

Suppose a feature historically has:

$$
3\%\ null
$$

and today:

$$
48\%\ null
$$

Even if your formal limit is 50%, this deserves investigation. A useful validation strategy compares both:

$$
absolute\ constraint
$$

and:

$$
change\ from\ historical\ baseline
$$

For example:

$$
nullrate_t - median(nullrate_{t-30:t-1})
$$

Large deviations can indicate source or join failures.

### Uniqueness checks are basic but important

Suppose one training row should correspond to:

$$
(customer,\ prediction\_time)
$$

Then uniqueness requires:

$$
count(rows)
=
count(distinct(customer,prediction\_time))
$$

If not, examples are duplicated. Duplicates can alter:

* training weights
* evaluation metrics
* class balance
* split integrity

Ten copies of one customer's row can give that customer ten times the intended influence during training.

### Duplicate keys and duplicate content are different

Two rows can have distinct IDs but identical content. For example:

```text
record_id A123
record_id B991
```

may represent the same transaction ingested twice. So validation can consider several levels:

$$
key\ duplicates
$$

$$
exact\ row\ duplicates
$$

$$
domain\ duplicates
$$

such as identical transaction IDs from two upstream feeds. Near-duplicate detection may also matter for text, image, audio, or document datasets.

### Layer 4: relationships between fields

Many errors are visible only through relationships. Suppose:

```text
account_created_at = May 1
prediction_time    = April 20
```

Each timestamp individually looks valid. Together they are impossible. So validate invariants such as:

$$
account\_created\_at
\le
prediction\_time
$$

or:

$$
order\_created
\le
order\_paid
\le
order\_shipped
\le
order\_delivered
$$

Relationships frequently encode more real-world meaning than isolated ranges.

### Cross-field invariants come from domain logic

Examples: If:

```text
is_refunded = false
```

then perhaps:

$$
refund\_amount = 0
$$

If:

```text
subscription_status = active
```

perhaps:

$$
cancellation\_date = NULL
$$

at prediction time. If:

```text
country = UK
```

perhaps currency should commonly be GBP—but maybe not always. The strongest validation rules come from people who understand how the product actually works.

### Referential integrity matters for ML joins

Suppose every training example references:

```text
customer_id
```

but 8% of those IDs do not exist in the customer feature table. A left join might silently produce null features. Your pipeline still succeeds.

So check join coverage. For example:

$$
join\_match\_rate
=
\frac{rows\ matched}
{rows\ expected}
$$

You might require:

$$
join\_match\_rate > 99.9\%
$$

for a critical dimension.

### Many-to-one assumptions should be validated

Suppose your feature pipeline expects:

$$
customer\_id \rightarrow exactly\ one\ account\ record
$$

But due to an upstream bug there are two account records. A join can multiply rows:

```text
10M examples
```

becomes:

```text
14M rows
```

Nothing necessarily crashes. So before and after joins, check cardinality. For example:

$$
count_{after\ join}
\approx
count_{before\ join}
$$

when a one-to-one or many-to-one join is intended. Unexpected row multiplication is a classic silent data corruption.

### Row-count checks should be placed around important transformations

For a filter:

$$
N_{after} \le N_{before}
$$

For a one-to-one enrichment:

$$
N_{after}=N_{before}
$$

For a controlled expansion:

$$
N_{after}
$$

should match a known rule. These simple checks create invariants around transformations. They help locate where a pipeline stopped meaning what it was supposed to mean.

## How Do Temporal Checks Protect Feature and Label Meaning?

<!-- section-summary: Temporal validation distinguishes event, availability, prediction, and label-maturity times. -->

### Layer 5: temporal correctness

Time is especially important in ML because training examples reconstruct past prediction situations. Suppose a row has:

```text
prediction_time = June 1
```

A feature based on:

```text
event_time = June 10
```

is invalid. So validate:

$$
feature\_event\_time
\le
prediction\_time
$$

or more strictly:

$$
feature\_availability\_time
\le
prediction\_time
$$

This is one of the most important ML-specific validation rules.

### Point-in-time correctness needs more than one timestamp

Imagine a profile field:

```text
risk_status = high
```

The record itself was created in January. But `risk_status` was updated in July. A historical prediction from March must not see July's value.

So you may need:

```text
valid_from
valid_to
updated_at
available_at
```

or equivalent history. A correct historical join asks:

Which version of the record was valid and knowable at prediction time?

### Timezones can create surprisingly serious errors

Suppose one system stores:

```text
2026-08-28 23:30 Europe/London
```

another interprets it as UTC. Around daylight-saving transitions, errors become even easier. For ML examples near time boundaries, this can move events:

$$
before\ prediction
$$

to:

$$
after\ prediction
$$

or vice versa. So validate:

* timezone assumptions
* timestamp precision
* conversion logic
* daylight-saving behavior
* inclusive/exclusive boundaries

Time correctness is rarely just "column type = timestamp."

### Label maturity is also a temporal validation problem

Suppose target:

Cancel within 30 days.

Prediction date:

```text
August 20
```

Dataset cutoff:

```text
August 28
```

If no cancellation has occurred yet, the label is not:

$$
0
$$

It is:

$$
pending
$$

A valid negative requires the entire observation horizon to finish. If horizon is $$H$$:

$$
prediction\_time + H
\le
label\_cutoff
$$

for a fully mature negative. Validation should enforce this.

## How Do Population and Segment Checks Distinguish Change from Corruption?

<!-- section-summary: Population checks compare volume, coverage, missingness, distributions, and important segments with a relevant versioned baseline. -->

### Layer 6: population validation

A dataset can be structurally perfect yet describe the wrong population. Suppose your fraud model normally trains on:

```text
UK + France + Germany
```

but a filtering bug leaves only:

```text
UK
```

Every row can still be valid. Types are correct. No nulls.

Labels look fine. Yet the dataset no longer represents the intended problem. So validate population composition.

### Population validation asks "Who is here?"

Useful dimensions might include:

* country
* customer tier
* acquisition channel
* platform
* device
* product
* age of account
* transaction type
* hospital
* language
* region

For example:

```text
UK        42%
France    31%
Germany   27%
```

historically, versus:

```text
UK        96%
France     3%
Germany    1%
```

today. That difference may signal a bug or a genuine business change. Either way, investigate.

### Distribution changes are not automatically failures

Suppose transaction amounts increase because prices rose. Or customer mix changes because the product launched in a new country. A distribution shift can be real.

Therefore validation should not blindly enforce:

$$
P_t(X)=P_{t-1}(X)
$$

The aim is to detect unexpected change, not to freeze reality. A shift detector is frequently an **alarm**, not proof of corruption.

### Drift checks answer a different question from schema checks

Schema asks:

Can this field hold these values?

Distribution checks ask:

Does this field still behave roughly as expected?

For numeric features, compare things like:

$$
mean
$$

$$
median
$$

$$
quantiles
$$

$$
variance
$$

$$
min/max
$$

$$
missingness
$$

For categories:

$$
frequency(category)
$$

For entire distributions, metrics such as PSI, KL divergence, Jensen–Shannon divergence, Wasserstein distance, or KS statistics may help. But the metric matters less than understanding what shift would be meaningful operationally.

### Feature drift may expose pipeline bugs

Suppose:

```text
sessions_30d
```

historically has median:

$$
12
$$

Today:

$$
0
$$

Maybe users suddenly stopped using the product. More likely:

* session ingestion failed
* historical join window broke
* date boundary changed
* partition was missing

Validation should stop that change before the training process accepts the altered data as a real pattern.

### Population drift should also be checked by important segments

Overall distribution can look stable while one segment breaks. Suppose:

```text
overall null rate = 4%
```

Normal. But:

```text
Android null rate = 1%
iOS null rate     = 42%
```

An iOS-specific ingestion failure is hidden by the aggregate. So high-value features and labels frequently need validation sliced by meaningful dimensions.

![A validation gate combining blocking and advisory checks and producing pass, quarantine, or publish-with-warning decisions](/content-assets/articles/article-mlops-data-for-ml-systems-data-validation-for-ml-pipelines/validation-decision-gate.png)

*The gate turns check results into an explicit publication decision and records the report, owner, and rule version behind it.*

## How Are Labels, Leakage, and Split Integrity Validated?

<!-- section-summary: Label checks cover source rules, maturity, revisions, join coverage, class and segment evidence, and human or automatic provenance. -->

### Layer 7: labels

Labels deserve separate validation because they define what the model learns. For binary labels:

$$
Y\in\{0,1\}
$$

is only the simplest check. You also need:

Does 1 mean the intended event?

Are negatives truly observed negatives?

Are label timestamps within the correct outcome window?

Has the label source changed?

Is positive prevalence plausible?

### Label-rate changes are valuable signals

Suppose fraud prevalence is normally:

$$
0.7\%-1.0\%
$$

Today:

$$
0.02\%
$$

Possible explanations:

* fraud disappeared
* label pipeline failed
* positive source stopped loading
* cutoff window changed
* labels are not mature
* filtering removed suspicious cases

Again, large change is not automatically an error. But it should trigger investigation.

### Validate labels against their generating rule

Suppose:

$$
Y=1
$$

means:

voluntary cancellation within 30 days.

Then every positive should satisfy:

$$
cancel\_type=voluntary
$$

and:

$$
prediction\_time
<
cancel\_time
\le
prediction\_time+30d
$$

For mature negatives:

$$
\text{no qualifying cancellation in window}
$$

and:

$$
prediction\_time+30d
\le
cutoff
$$

These are semantic invariants derived directly from the target definition.

### Automatically generated labels still need audits

Suppose the label comes from:

```text
billing_event = CANCELLED
```

That might seem objective. But perhaps:

* mobile cancellations use a different event
* duplicate events exist
* failed renewals also create CANCELLED
* back-office removals share the same code

So periodically trace label records back to source events. Automatic does not mean correct.

### Human-generated labels also need validation

For annotation-based datasets, useful checks include:

* reviewer agreement
* adjudication rate
* guideline version
* gold-item accuracy
* uncertain-rate changes
* label-source mix
* reviewer calibration

Suppose disagreement suddenly doubles after a guideline revision. That may indicate the new instructions are unclear. Label validation belongs in the same release pipeline as ordinary data checks.

### Layer 8: leakage validation

A dataset may look perfect statistically and still be unsafe because it leaks information. Data validation should therefore test important leakage invariants. For every feature:

$$
available\_time(feature)
\le
prediction\_time
$$

For grouped evaluation:

$$
group_{train}
\cap
group_{test}
=
\varnothing
$$

For duplicates:

$$
duplicate\_cluster
$$

should not cross forbidden split boundaries. For preprocessing:

$$
fit\_data
\subseteq
train
$$

These are ML-specific integrity conditions.

### Leakage checks should combine automation and semantic review

Automation can detect:

```text
feature timestamp > prediction timestamp
same customer in train and test
same hash in train and test
label field accidentally selected as feature
```

But consider:

```text
retention_case_status
```

Its timestamp may be before prediction. Yet perhaps the retention team opens a case only after a customer already requests cancellation. The feature semantically reveals the answer.

No generic validator knows that. So leakage validation requires both:

$$
automated\ constraints
$$

and:

$$
domain\ understanding
$$

### Split integrity is part of dataset validation

Suppose your dataset is correct, but split assignment is wrong. Customer 817 appears in:

```text
train
```

and:

```text
test
```

even though your evaluation is supposed to measure generalization to unseen customers. Then the dataset release used for experimentation is unsafe. Validate:

$$
IDs_{train}\cap IDs_{test}=\varnothing
$$

at the proper grouping level. For time-based splits:

$$
max(t_{train})
<
min(t_{test})
$$

if strict chronology is required.

### Dataset validation should include representation checks

Suppose the test set has:

```text
2 positive examples
```

Technically valid. Statistically useless. A release check may require minimum counts:

$$
N_{positive,test}\ge N_{min}
$$

and similarly for important slices. You need enough examples to measure the system you care about. This is a quality issue even though nothing is "wrong" with the rows.

### Statistical validity differs from semantic validity

Consider two datasets. Dataset A:

```text
10M rows
perfect schema
zero nulls
stable distributions
```

but target means the wrong thing. Dataset B:

```text
8M rows
3% expected missingness
some distribution shift
```

but faithfully represents the production problem. Dataset B may be far safer. So validation should never become:

"All dashboards are green, therefore the dataset is correct."

A dashboard only validates the assumptions encoded into it.

### One-example tracing remains one of the best validation techniques

Pick a row:

```text
customer_id = C817
prediction_time = 2026-04-06
sessions_30d = 6
target = 1
```

Now trace:

```text
prediction opportunity
↓
eligibility source
↓
session events
↓
feature aggregation
↓
label event
↓
final row
```

Verify manually:

* customer was eligible
* exactly six qualifying sessions existed
* all were available before prediction time
* cancellation occurred inside the correct horizon
* no later information entered the features

This connects abstract checks to reality.

### Trace several strategically chosen rows

Useful examples include:

* ordinary positive
* ordinary negative
* recently matured negative
* row near an outcome boundary
* row with missing features
* rare segment
* entity appearing across multiple periods
* extreme feature values
* row around a timezone boundary

Manual inspection cannot cover millions of rows. But carefully chosen examples can reveal misunderstandings that no aggregate test catches.

## How Should Validation Results Control Quarantine, Repair, and Publication?

<!-- section-summary: Severity maps observations to warning, review, quarantine, or block. -->

### Validation can be divided into hard failures and soft warnings

Not every anomaly should stop publication. Consider:

```text
primary key null
```

Almost certainly fatal. But:

```text
average transaction value increased 8%
```

might just be real. So define severity. For example:

$$
severity \in \{info,warning,error,critical\}
$$

A critical violation might automatically block publication. A warning might require review. This avoids both extremes:

* publishing dangerous data
* blocking every release because reality changed slightly

### Hard constraints versus statistical expectations

A **hard constraint** represents something that should never happen. Examples:

$$
prediction\_time < account\_creation
$$

impossible.

$$
target \notin \{0,1\}
$$

invalid for a binary published target. A **statistical expectation** represents something commonly true:

```text
positive rate commonly ~3%
```

Today's 4.5% may be worth investigating but not automatically invalid. These two categories should be handled differently.

### A publication gate converts checks into action

Suppose validation produces:

```text
schema                  PASS
freshness               PASS
join coverage           PASS
null-rate check         WARN
label maturity          PASS
future-feature check    FAIL
population shift        WARN
```

Should the dataset publish? A release policy might say:

$$
any\ critical\ failure
\Rightarrow
BLOCK
$$

$$
warnings
\Rightarrow
REVIEW
$$

$$
all\ required\ checks\ pass
\Rightarrow
PUBLISH
$$

The validation system therefore does not merely generate reports. It participates in release control.

### Think of publishing as a state transition

A dataset can move through states:

```text
BUILDING
   ↓
BUILT
   ↓
VALIDATING
   ↓
VALIDATED
   ↓
PUBLISHED
```

or:

```text
VALIDATION_FAILED
```

The key principle is:

$$
\boxed{
\text{downstream consumers should use only published versions}
}
$$

not whatever temporary table the pipeline happened to write. The control prevents incomplete or failed artifacts from being consumed accidentally.

### Atomic publication is safer than publishing in place

Suppose a job writes directly into:

```text
current_training_dataset
```

It inserts half the rows. Then validation fails. Downstream jobs may already have read the half-written dataset.

A safer pattern is:

```text
build candidate_v43
validate candidate_v43
if pass:
    mark v43 published
    update pointer/current alias
else:
    keep v42 active
```

Conceptually:

$$
candidate
\xrightarrow{validation}
published
$$

Only a validated immutable candidate becomes visible as the official version.

### Keep known-good data available

If today's dataset fails validation, the response should commonly not be:

Delete yesterday's good dataset.

Instead retain:

$$
last\ known\ good
$$

and quarantine the failed candidate. The result gives downstream systems a clear choice:

* continue using previous validated data if safe
* stop completely if freshness requirements make old data unsafe

The decision depends on the application.

### Quarantine bad data rather than silently repairing everything

Suppose 20 rows violate:

$$
amount \ge 0
$$

You might be tempted to convert negative amounts to zero. But why were they negative? Perhaps negative amounts represent refunds.

Now you've destroyed meaning. Automatic repairs should only happen when the intended correction is known. Otherwise:

$$
bad\ data
\rightarrow
quarantine
\rightarrow
investigate
$$

is safer than:

$$
bad\ data
\rightarrow
guess\ correction
$$

### Repair should happen at the earliest responsible layer

Suppose today's feature dataset has 40% missing location because an upstream mobile event stopped sending country. You could patch the training dataset. But the root problem belongs in source ingestion.

A useful rule is:

$$
\boxed{
\text{fix the earliest layer that is actually wrong}
}
$$

This reduces duplicate patches and prevents multiple consumers from compensating differently.

### Rebuild downstream artifacts after upstream correction

Suppose:

```text
source partition
```

was wrong. It generated:

```text
feature_dataset_v17
```

which generated:

```text
training_dataset_v32
```

which trained:

```text
model_v81
```

If the source is corrected, all affected descendants may need reconstruction. Lineage provides:

$$
source
\rightarrow
features
\rightarrow
dataset
\rightarrow
model
$$

Validation failures therefore interact directly with artifact lineage.

### A validation failure can invalidate metrics, not just data

Suppose a model's test set accidentally contained duplicate training cases. Reported:

$$
AUC=0.94
$$

Later validation finds the overlap. The proper conclusion is not:

"AUC is probably slightly optimistic."

It is:

The evaluation evidence is contaminated.

You need a clean split and new evaluation. Validation protects the credibility of measurements as well as datasets.

## How Do Owners, Evidence, and Tests Keep the Validator Trustworthy?

<!-- section-summary: Each rule records its scope, expected and observed value, severity, owner, response, code and contract version, and protected evidence. -->

### Record which checks ran

Suppose a dataset says:

```text
validation_status = PASS
```

What does that mean? Did it run:

```text
schema check
freshness check
label maturity check
leakage check
duplicate check
```

or only:

```text
row_count > 0
```

A pass/fail flag is meaningless without the test suite behind it. So record:

$$
validation\_suite\_version
$$

and the exact checks executed.

### Validation results should themselves be data

Conceptually:

```text
dataset_version
check_name
check_version
status
observed_value
expected_rule
timestamp
owner
```

For example:

```text
training_v42
positive_rate
v3
WARN
0.071
expected 0.02-0.05
2026-08-28
fraud-data-team
```

The result creates an audit trail. You can later ask:

Which datasets were released while this check was disabled?

or:

When did this metric start drifting?

### Validation rules need owners

Suppose a check fails:

```text
Germany population dropped 40%
```

Who decides whether that's real? Maybe:

* data engineering owns source completeness
* ML platform owns split integrity
* fraud team owns label semantics
* product analytics owns customer-population expectations

A validation system without ownership frequently degenerates into a dashboard everyone assumes someone else is watching. For every critical check, know:

$$
owner(check)
$$

### Validation rules need documentation too

A rule like:

```text
feature_null_rate < 12%
```

raises obvious questions. Why 12%? Why not 10%?

What happens if it hits 13%? Is the threshold based on:

* product semantics
* historical distribution
* model sensitivity
* operational tolerance
* arbitrary guess

A validation rule should have a reason. Otherwise thresholds accumulate and eventually nobody knows whether they matter.

### The validator itself can fail

The result creates a recursive problem. Suppose the data pipeline runs every day. Validation used to run after it.

Six months ago, an orchestration change accidentally disconnected the validation task. Datasets have been publishing ever since. All visible dataset statuses say:

```text
published
```

but no checks have actually run. So you must monitor the **validation system itself**.

### "No failed checks" can mean "no checks ran"

This is a dangerous distinction:

$$
0\ failed\ checks
$$

could mean:

```text
100 checks ran, all passed
```

or:

```text
0 checks ran
```

Those are completely different. A healthy release policy should require:

$$
required\_checks\_executed
=
true
$$

before interpreting pass/fail.

### Validate validator freshness

Suppose:

```text
last_validation_run = 3 weeks ago
```

but the dataset is daily. That itself should trigger failure. You can monitor:

$$
current\_time - last\_successful\_validation
$$

and expected test count. For example:

```text
expected checks = 47
executed checks = 31
```

Publication should probably block.

### Validation code is production code

A broken validator can be as dangerous as a broken feature pipeline. Therefore it needs:

* tests
* versioning
* deployment review
* monitoring
* ownership
* change history

If someone changes:

```text
amount >= 0
```

to:

```text
amount > -1000000
```

that is effectively changing your safety policy. Validation logic should not be treated as disposable notebook code.

### Tool choice should follow where the data lives

For a small in-memory dataset, validation might happen with dataframe checks. For warehouse-scale data, checks may run in SQL. For streaming features, you may need continuous metrics.

For distributed datasets, checks may use Spark or similar execution engines. For schemas, type contracts may live in serialization or table definitions. The exact tool is secondary.

Place each validation rule near enough to the data it protects that the check remains dependable and inexpensive to run.

### Do not move billions of rows just to validate them somewhere else

Suppose your data already lives in a warehouse. Copying it into Python merely to count nulls is unnecessary. Compute:

$$
COUNT(*)
$$

$$
COUNTIF(feature IS NULL)
$$

$$
MIN
$$

$$
MAX
$$

$$
APPROX\_QUANTILES
$$

where the data already lives. Validation should be operationally inexpensive enough that teams actually run it on every release.

### Some checks should happen during transformations

Suppose a join is expected to be many-to-one. Validate row multiplication immediately after that join. Do not wait until the final dataset to discover:

```text
row count doubled
```

The closer a check is to the possible failure point, the easier debugging becomes. A useful architecture is:

```text
source
→ validate
→ transformation A
→ validate
→ transformation B
→ validate
→ final dataset
→ release validation
```

Not every stage needs hundreds of checks. A few strong invariants at important boundaries can be extremely effective.

### Final publication validation answers a different question

Intermediate checks ask:

Did this transformation behave correctly?

Final validation asks:

Is this complete artifact safe for its intended consumers?

That includes things individual transformations cannot know, such as:

* overall population balance
* label quality
* split integrity
* feature-target leakage
* final dataset size
* evaluation coverage

So both local and final validation matter.

### Validation rules can be derived from four kinds of expectations

A useful taxonomy is:

#### Structural expectations

```text
column exists
type is integer
key is unique
```

#### Semantic expectations

```text
prediction occurs after signup
refund only exists for refundable transaction
```

#### Statistical expectations

```text
positive rate roughly stable
feature distribution not wildly different
```

#### ML-integrity expectations

```text
no future features
no group overlap across split
labels mature
preprocessing provenance correct
```

Together these cover much of what matters.

### Some validation is deterministic; some is probabilistic

This rule:

$$
target\in\{0,1\}
$$

is deterministic. Either it holds or not. This claim:

"The population looks suspiciously different."

is statistical. There is no universal threshold that guarantees corruption. This distinction matters because statistical alarms need investigation rather than blind rejection.

The system should know whether a check means:

$$
must\ be\ true
$$

or:

$$
normally\ expected
$$

### Baselines should usually be versioned

Suppose you compare today's data to:

$$
previous\ 30\ days
$$

But the product launches in a new region. The old baseline may no longer be appropriate. So distribution checks need explicit reference populations:

```text
baseline_dataset_version
baseline_period
baseline_population
```

Otherwise a "drift" score lacks context.

### Compare like with like

Suppose weekday behavior differs from weekends. Comparing Monday data against Sunday's can trigger false alarms. Similarly:

* holidays
* end-of-month
* product launches
* marketing campaigns
* seasonal traffic

may change expected distributions. A good baseline might compare:

$$
Monday_t
$$

against previous Mondays rather than the immediately previous day. Statistical validation should reflect real operating patterns.

### Dataset validation and model monitoring are related but different

Data validation happens before or around publication:

Is this data artifact safe to consume?

Model monitoring happens after deployment:

Is the model and its incoming production data behaving acceptably?

Both may inspect:

* missingness
* feature distributions
* schema
* drift

But the contexts differ. Training-data validation protects development artifacts. Production monitoring protects live predictions.

The same conceptual checks can appear at both stages.

### Some validation should compare training and serving data

Suppose training feature:

```text
transactions_last_hour
```

has distribution:

$$
median=3
$$

but serving logs show:

$$
median=0
$$

Maybe:

* serving feature is broken
* historical feature reconstruction leaks future events
* online and offline definitions differ

A powerful validation asks:

$$
F_{offline}(entity,t)
\stackrel{?}{=}
F_{online\ replay}(entity,t)
$$

for sampled examples. This helps catch training-serving skew.

### Shadow comparisons are valuable for feature validation

Choose historical or live examples and compute the same feature by both production paths:

```text
offline training pipeline
online serving pipeline
```

Then compare:

$$
difference = F_{offline} - F_{online}
$$

If supposedly identical definitions disagree frequently, investigate before training or deployment. This is stronger than separately validating each pipeline. It checks equivalence.

### "Safe to publish" is a product of evidence, not certainty

No finite set of checks can prove that a dataset is perfect. There could always be an unknown failure mode. So validation really asks:

Do we have enough evidence that known critical assumptions hold, and no unresolved signal suggests the artifact is unsafe?

That is similar to software testing. Tests cannot prove software has no bugs. They can establish confidence that important properties hold.

### Validation coverage matters

Suppose you have 200 possible failure modes but only validate:

```text
row count
```

Your pipeline is technically "validated" but poorly protected. Over time, learn from incidents. If an outage was caused by:

```text
late-arriving partner labels
```

add a check for label-source completeness. If a model failed because:

```text
customer plan was joined from current state
```

add point-in-time validation. Validation suites should evolve from real failure history.

### Incident history is one of the best sources of validation rules

Every serious data incident should ask:

Could we have detected this automatically before publication?

If yes, convert the lesson into a permanent check. The result creates:

$$
incident
\rightarrow
new\ invariant
\rightarrow
future\ prevention
$$

Over time the validation system becomes institutional memory. Without this, teams repeatedly rediscover the same classes of mistakes.

### But avoid accumulating meaningless checks

The opposite failure also happens. A team adds hundreds of warnings. Half are always red.

Everyone ignores them. Now the validation system has lost credibility. A good check should be:

* tied to a real risk
* interpretable
* owned
* actionable
* calibrated
* periodically reviewed

A small set of release gates tied to real risks can protect the pipeline better than hundreds of noisy warnings.

### A useful release decision model

Suppose validation produces check results:

$$
C_1,C_2,\ldots,C_n
$$

Each check has:

$$
severity_i
$$

and:

$$
status_i
$$

Then publication can be represented as:

$$
Publish(D)=
\begin{cases}
false & \text{if any blocking invariant fails}\\
review & \text{if unresolved warnings exceed policy}\\
true & \text{otherwise}
\end{cases}
$$

The exact policy varies. The important thing is that publication rules are explicit and reproducible.

### Human review still has a role

Suppose:

```text
France traffic -32%
```

The statistical validator flags it. But the product team knows the service intentionally shut down in France yesterday. Publishing may be correct.

This is where human review belongs. The validator identifies unexpected facts. A knowledgeable owner interprets whether they represent:

$$
bug
$$

or:

$$
real\ world\ change
$$

Human judgment should operate on surfaced evidence, not replace all automation.

### Manual overrides should be recorded

Suppose a critical drift warning is deliberately overridden. Record:

```text
dataset version
failed/warned check
who approved
reason
timestamp
expiry if appropriate
```

Otherwise six months later nobody knows why a suspicious dataset was published. Overrides are sometimes necessary. Invisible overrides are dangerous.

### Validation should be reproducible

If dataset:

```text
training_v42
```

was published after passing validation, the retained evidence should let the team rerun:

```text
validation_suite_v8(training_v42)
```

and recover the same deterministic results. For statistical checks, record the baseline and thresholds used. This lets you reconstruct the exact reasoning behind publication.

### Example: validating a churn dataset from beginning to end

Suppose the task is:

Every Monday, predict whether an active subscriber voluntarily cancels within 30 days.

Candidate dataset:

```text
churn_training_v52
```

First check source readiness. Billing data:

```text
freshness = PASS
expected partition present = PASS
volume = PASS
```

Session events:

```text
latest partition present = PASS
volume = 51% of expected = FAIL
```

At this point, you may stop. Why validate the final training dataset? Its session features are already known to be incomplete.

Source readiness prevents wasted work.

### Continue the example after the source is repaired

Now the candidate rebuilds. Schema:

```text
required columns = PASS
types = PASS
target domain {0,1} = PASS
```

Row integrity:

```text
(customer_id, prediction_time) unique = PASS
prediction_time Mondays only = PASS
```

Eligibility:

```text
active customer at prediction = PASS
account_age >= 30 days = PASS
```

Now temporal checks:

```text
feature events <= prediction_time = PASS
feature availability <= prediction_time = PASS
```

These establish point-in-time correctness.

### Continue with label validation

Target:

$$
Y=1
$$

means voluntary cancellation within 30 days. Validation finds:

```text
all positives within 30-day horizon = PASS
all positives voluntary = PASS
all negatives label-mature = FAIL
```

Why? Some examples from the last two weeks were labeled 0 even though their 30-day window had not finished. That is severe.

Publication should block. The pipeline executed correctly. The labels were semantically unsafe.

### Continue after label repair

Now population checks:

```text
UK      51% → 50%
France  27% → 28%
Germany 22% → 22%
```

Fine. Positive rate:

```text
historical 3.1%
candidate 3.3%
```

Fine. Feature distribution:

```text
sessions_30d stable
support_tickets_60d stable
spend_90d stable
```

No strong warnings. Now split checks:

```text
train/test customer overlap = 0
temporal boundary correct = PASS
positive examples sufficient in all splits = PASS
```

Now the candidate is eligible for publication.

### Publish immutably

Instead of replacing:

```text
churn_training
```

in place, mark:

```text
churn_training_v52
```

as:

```text
PUBLISHED
```

and record:

```text
validation_suite_v8
source versions
split version
label definition version
feature definition version
publication timestamp
```

Now a training run can say:

$$
model\_103
\leftarrow
churn\_training\_v52
$$

and that claim is reproducible.

### Example: a dataset that passes every basic check and is still unsafe

Suppose fraud dataset:

```text
10M rows
no nulls
correct schema
stable class balance
no duplicates
```

All basic checks pass. Feature:

```text
chargeback_reason
```

is populated only weeks after transactions. The model predicts fraud at authorization time. So:

$$
available\_time(chargeback\_reason)

prediction\_time
$$

The dataset is leaking future information. This demonstrates why data validation for ML must include the **prediction-time semantics**, not merely ordinary data-quality checks.

### Example: a dataset that looks statistically strange but is valid

Suppose customer country distribution changes:

```text
UK 60% → 30%
Spain 5% → 40%
```

A drift validator alarms. Investigation finds:

The product launched nationally in Spain this week.

The change is real. The dataset may be perfectly valid. But the model may now face a new production distribution.

So the finding should perhaps trigger:

* model evaluation on Spain
* new training coverage
* monitoring updates

Validation sometimes reveals **real product change requiring ML adaptation** rather than corruption.

### Data validation is therefore connected to model risk

A validation warning may indicate:

$$
bad\ data
$$

or:

$$
real\ distribution\ shift
$$

Both matter. Bad data means:

Do not trust this artifact.

Real drift means:

This artifact may be correct, but the model assumptions may need reconsideration.

Validation sits at the boundary between data engineering and ML reliability.

### A compact validation contract

Before publishing a training dataset, I would want explicit answers to questions like: **Source readiness** Are every required source and partition complete enough?

**Schema** Are required fields present with expected representations? **Keys**

Does every row correspond to exactly one intended example? **Values** Are field values legal and plausible?

**Relationships** Do cross-field invariants hold? **Time**

Were all features actually knowable at prediction time? **Population** Are the intended entities and segments represented?

**Distribution** Have important fields or segments changed unexpectedly? **Labels**

Do labels represent the intended target, and are outcomes mature? **Leakage** Is forbidden future or evaluation information absent?

**Splits** Are independence and chronology rules satisfied? **Coverage**

Are rare classes and important slices sufficiently represented? **Lineage** Can source data and transformations be traced?

**Validation execution** Did all required validation jobs actually run? **Publication policy**

Do the results permit release? If those questions are explicit, validation becomes systematic rather than ceremonial.

### The relationship to the previous concepts

Training data construction asks:

$$
\boxed{
\text{Did we build the intended historical examples?}
}
$$

Dataset splitting asks:

$$
\boxed{
\text{Did we preserve the intended generalization boundary?}
}
$$

Leakage prevention asks:

$$
\boxed{
\text{Did forbidden information cross a boundary?}
}
$$

Label quality asks:

$$
\boxed{
\text{Does }Y\text{ genuinely represent the intended answer?}
}
$$

Data validation asks:

$$
\boxed{
\text{What evidence do we have that all of those properties actually hold for this published dataset version?}
}
$$

So validation is not a separate side topic. It is the mechanism that enforces the contracts created by all the others.

### A deeper mental model: validation protects assumptions

Every ML dataset relies on assumptions. For example:

$$
A_1:
\text{all relevant source partitions arrived}
$$

$$
A_2:
\text{one row means one eligible prediction opportunity}
$$

$$
A_3:
\text{feature values were knowable historically}
$$

$$
A_4:
\text{labels are mature and correctly defined}
$$

$$
A_5:
\text{test entities are independent where required}
$$

$$
A_6:
\text{population resembles the intended evaluation context}
$$

Without validation, these assumptions remain implicit. Validation converts assumptions into checked propositions:

$$
A_i
\rightarrow
Check_i(D)
$$

That is the fundamental purpose.

### Data validation is executable skepticism

A useful engineering mindset is:

Assume every important property can eventually be violated.

Not because people are incompetent. Because systems change. Sources migrate.

Schemas evolve. Product definitions change. Late events arrive.

Joins gain duplicates. Timezones shift. Experiments modify traffic.

Human labeling guidelines change. A good validator turns reasonable skepticism into executable checks. Instead of saying:

"This could never happen."

encode:

$$
assert(\text{it did not happen})
$$

for properties that matter.

### Validity is contextual

A dataset is not merely:

$$
valid
$$

or:

$$
invalid
$$

in the abstract. It is valid **for a purpose**. A customer dataset using current account state may be perfectly valid for today's dashboard.

The same dataset may be invalid for reconstructing historical churn predictions. A random row split may be fine for predicting additional events from known users. It may be invalid for evaluating unseen-user generalization.

So:

$$
\boxed{
\text{Data validity is always relative to the intended use.}
}
$$

That is why the prediction contract must come first.

#### What to remember

A data pipeline succeeding tells you only:

$$
\boxed{
\text{the computation completed}
}
$$

It does **not** tell you:

$$
\boxed{
\text{the resulting data means what you think it means}
}
$$

Data validation exists to close that gap. For ML systems, strong validation proceeds through several layers:

$$
\boxed{
source\ readiness
\rightarrow
schema
\rightarrow
values
\rightarrow
relationships
\rightarrow
time
\rightarrow
population
\rightarrow
labels
\rightarrow
leakage
\rightarrow
split\ integrity
\rightarrow
publication
}
$$

Some checks prove hard invariants:

$$
target\in\{0,1\}
$$

$$
feature\_available\_time\le prediction\_time
$$

$$
train\_groups\cap test\_groups=\varnothing
$$

Others detect suspicious changes:

$$
positive\ rate\ shifted
$$

$$
feature\ distribution\ moved
$$

$$
a segment suddenly disappeared
$$

Those need interpretation. A mature ML data system does not immediately expose whatever a pipeline produces. It builds an immutable candidate, validates it, records which checks ran and what they found, blocks publication on critical failures, keeps the last known good artifact available where appropriate, repairs errors at their source, rebuilds affected descendants, and records enough lineage that every released dataset can later be explained. The deepest question is therefore:

**What must be true for this dataset to safely represent the ML problem we intend to solve, and what concrete evidence did we collect that those things are true for this exact version?**

That is the standard a complete data-validation process should enforce.

![A six-step path from detecting unsafe data through quarantine, impact tracing, source repair, rebuild, verification, and republishing](/content-assets/articles/article-mlops-data-for-ml-systems-data-validation-for-ml-pipelines/safe-republish-path.png)

*Recovery closes the validation loop by fixing the source, rebuilding every affected output, and preserving proof that publication is safe again.*

## Check Your Answers

Use these answers to revisit the evidence, boundaries, and operating decisions behind each question.

:::expand[Why Can a Successful Pipeline Still Publish Invalid ML Data?]{kind="recap"}
Schedulers and query engines prove that work executed, not that the output represents the ML problem correctly.

Valid-looking rows can contain broken joins, wrong units, current state attached to old decisions, immature labels, or missing segments. Validation supplies evidence that one identified dataset is fit for its next use.
:::

:::expand[How Do Freshness and Completeness Establish Source Readiness?]{kind="recap"}
Validation moves from source readiness through schema, values, relationships, time, population, labels, leakage, splits, and publication.

Earlier layers establish that data is present and interpretable. Later layers test contextual claims about the prediction problem. Keeping the layers distinct routes each failure to the boundary that can repair it.
:::

:::expand[How Do Schema, Value, and Relationship Checks Work Together?]{kind="recap"}
Source checks verify arrival, freshness, partitions, and completeness.

Schema checks protect columns, types, and compatibility. Value rules enforce units, domains, ranges, and cross-field meaning. Relationship checks protect keys, uniqueness, referential integrity, join cardinality, and declared row grain. Passing one layer cannot substitute for another.
:::

:::expand[How Do Temporal Checks Protect Feature and Label Meaning?]{kind="recap"}
Temporal validation distinguishes event, availability, prediction, and label-maturity times.

It proves features were knowable before each decision, outcomes fell inside the label window, negative labels had complete follow-up, and late records followed the contract. Time zones, boundary inclusion, and current-state joins receive explicit tests.
:::

:::expand[How Do Population and Segment Checks Distinguish Change from Corruption?]{kind="recap"}
Population checks compare volume, coverage, missingness, distributions, and important segments with a relevant versioned baseline.

A changed distribution can reflect real behaviour, a source change, or pipeline damage. Segment evidence and owner review provide the context needed to classify the change rather than treating every drift alert as corruption.
:::

:::expand[How Are Labels, Leakage, and Split Integrity Validated?]{kind="recap"}
Label checks cover source rules, maturity, revisions, join coverage, class and segment evidence, and human or automatic provenance.

Leakage checks inspect permitted information and point-in-time retrieval. Split checks detect entity, group, duplicate, and time overlap and ensure preprocessing fitted only on training evidence.
:::

:::expand[How Should Validation Results Control Quarantine, Repair, and Publication?]{kind="recap"}
Severity maps observations to warning, review, quarantine, or block.

A candidate stays private until every required result is complete. Repair occurs at the earliest broken boundary, affected descendants are rebuilt, and the replacement receives a new immutable version. Atomic publication exposes only a fully validated dataset while preserving the last known good release.
:::

:::expand[How Do Owners, Evidence, and Tests Keep the Validator Trustworthy?]{kind="recap"}
Each rule records its scope, expected and observed value, severity, owner, response, code and contract version, and protected evidence.

Validator health confirms expected checks ran over the right data and wrote results. Fixtures, failure injection, baseline review, and bounded override records test the control system as rigorously as the data it judges.
:::

## References

- [Apache Spark Declarative Pipelines](https://spark.apache.org/docs/latest/declarative-pipelines-programming-guide.html)
- [AWS Glue Data Quality](https://docs.aws.amazon.com/glue/latest/dg/glue-data-quality.html)
- [Google Cloud Knowledge Catalog automatic data quality](https://docs.cloud.google.com/dataplex/docs/auto-data-quality-overview)
