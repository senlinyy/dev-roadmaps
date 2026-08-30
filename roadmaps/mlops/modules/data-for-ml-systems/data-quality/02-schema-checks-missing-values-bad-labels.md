---
title: "Data Quality Checks"
description: "Learn how structural validity, missing-value semantics, and label integrity protect ML datasets from silent failures."
overview: "ML data quality asks whether a dataset has a trustworthy shape, whether unavailable information has a clear meaning, and whether labels represent mature, traceable outcomes. These three evidence layers guide investigation, repair, validation, quarantine, and backfill across data pipelines."
tags: ["MLOps", "core", "validation"]
order: 2
id: "article-mlops-data-for-ml-systems-schema-checks-missing-values-bad-labels"
---

## Table of Contents

1. [Why Must ML Data Quality Cover Structure, Meaning, and Truth?](#why-must-ml-data-quality-cover-structure-meaning-and-truth)
2. [How Do Schema Contracts Detect Breaking Data Changes?](#how-do-schema-contracts-detect-breaking-data-changes)
3. [What Does Missing Data Mean and Why Must It Be Checked by Segment?](#what-does-missing-data-mean-and-why-must-it-be-checked-by-segment)
4. [How Are Bad, Delayed, and Changing Labels Detected?](#how-are-bad-delayed-and-changing-labels-detected)
5. [How Can One Bad Field Damage Training, Serving, and Monitoring?](#how-can-one-bad-field-damage-training-serving-and-monitoring)
6. [How Do Severity, Quarantine, and Repair Control the Response?](#how-do-severity-quarantine-and-repair-control-the-response)
7. [How Do Failure Tests Prove the Full Quality System Works?](#how-do-failure-tests-prove-the-full-quality-system-works)
8. [Where Should Quality Checks Run Across the Data Path?](#where-should-quality-checks-run-across-the-data-path)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

An ML pipeline can finish successfully while three different errors hide in its output. A producer changes `parcel_weight_grams` from an integer to formatted text. A customer-income field is empty because of several different causes. A fraud label says “no chargeback” before the dispute window has closed.

The first error changes structure. The second hides meaning inside a null. The third gives the model an answer that may still change. A generic “job succeeded” check cannot distinguish them.

Data quality therefore asks three separate questions: does the dataset have the expected shape, do its values mean what the model expects, and do its labels provide trustworthy answers? Each check also needs a response, such as warning an owner, quarantining rows, blocking publication, repairing an upstream source, or rebuilding affected datasets.

Work through those quality decisions here:

1. **Why Must ML Data Quality Cover Structure, Meaning, and Truth?**
2. **How Do Schema Contracts Detect Breaking Data Changes?**
3. **What Does Missing Data Mean and Why Must It Be Checked by Segment?**
4. **How Are Bad, Delayed, and Changing Labels Detected?**
5. **How Can One Bad Field Damage Training, Serving, and Monitoring?**
6. **How Do Severity, Quarantine, and Repair Control the Response?**
7. **How Do Failure Tests Prove the Full Quality System Works?**
8. **Where Should Quality Checks Run Across the Data Path?**

## Why Must ML Data Quality Cover Structure, Meaning, and Truth?

<!-- section-summary: ML data passes from reality through measurement, storage, transformation, features, and labels. -->

Data quality in machine learning is not mainly about whether a CSV opens successfully or whether every column is non-null. The deeper question is:

**Does this dataset still represent the real-world phenomenon that we believe it represents?**

An ML system learns statistical relationships from data. If the data-generating process is misunderstood, corrupted, delayed, or changed, the model learns the wrong relationships—even if the training code is perfectly correct. A useful way to reason about data quality is therefore:

$$
\text{Real world}
\rightarrow
\text{measurement}
\rightarrow
\text{stored data}
\rightarrow
\text{features/labels}
\rightarrow
\text{model}
$$

At each arrow, the pipeline can lose, distort, delay, or accidentally expose information.

### The fundamental job of training data

Suppose we want a model

$$
f(X) \rightarrow Y
$$

where $$X$$ contains features and $$Y$$ is the thing we want to predict. Consider for fraud detection:

$$
X =
\{\text{amount, merchant, country, account history, ...}\}
$$

and

$$
Y =
\{\text{fraud},\text{not fraud}\}
$$

The training system assumes something extremely important:

$$
(X,Y)_{\text{dataset}}
\approx
(X,Y)_{\text{real world}}
$$

If that assumption is false, better GPUs, more sophisticated models, and more hyperparameter tuning commonly do not solve the underlying problem. So data-quality checks exist to protect that assumption.

### Think of data quality as several different questions

Teams often hide several different failure modes behind one vague statement such as:

"The dataset passed validation."

That hides very different failure modes. There are at least three fundamentally different things to check:

$$
\boxed{
\text{Structure}
\quad
\text{Meaning}
\quad
\text{Truth}
}
$$

#### Structure

Can we interpret the data mechanically? Examples:

```text
customer_id     integer
country         string
age             integer
purchase_time   timestamp
fraud_label     boolean
```

Questions include:

* Did a column disappear?
* Did `age` change from integer to string?
* Did a timestamp format change?
* Did the JSON nesting change?
* Are duplicate records appearing?

These are **schema and structural problems**.

#### Meaning

Even when the structure is correct, values may have changed meaning. Imagine:

```text
discount = 0
```

Does that mean:

```text
no discount
```

or:

```text
discount information unavailable
```

Those are completely different facts. Similarly:

```text
country = NULL
```

could mean:

```text
country unknown
```

or:

```text
user declined to provide country
```

or:

```text
country pipeline failed
```

These are **semantic data-quality problems**.

#### Truth

Finally, the data may be structurally valid and semantically understandable but merely wrong. For example:

```text
fraud_label = 0
```

when investigators later determine that the transaction was fraudulent. This is especially important for labels because labels define what the model learns.

## How Do Schema Contracts Detect Breaking Data Changes?

<!-- section-summary: Schema contracts define fields, types, nullability, units, grain, keys, and compatibility rules. -->

### First check the structure

Structural checks should normally happen before expensive feature computation or model training. Suppose yesterday's data looked like:

```text
customer_id   int
age           int
country       string
revenue       float
```

Today it becomes:

```text
customer_id   string
country       string
revenue       string
```

The pipeline may still run. That is exactly why validation matters. A robust schema can specify things such as:

```text
customer_id:
    required
    unique
    type = integer

age:
    nullable
    type = integer
    range = [0, 120]

country:
    type = categorical
    allowed_values = known ISO countries

revenue:
    type = float
    minimum = 0
```

Now the question becomes measurable rather than subjective.

### But not every schema change should fail the pipeline

Schema validation needs an important distinction:

$$
\text{breaking change}
\neq
\text{compatible change}
$$

Suppose a table originally contains:

```text
user_id
age
country
```

and a producer adds:

```text
preferred_language
```

A reader using only the original three columns may not care. So:

```text
adding unused column
```

might be compatible. But:

```text
removing user_id
```

is probably catastrophic. Similarly:

```text
age: int32 → int64
```

may be harmless. While:

```text
age: integer → "18 years old"
```

may break downstream assumptions. This leads to a useful principle:

> **Schemas should describe contracts between producers and consumers, not merely describe files.**

The correct question is therefore not:

"Did the schema change?"

It is:

"Did the schema change in a way that invalidates a downstream assumption?"

### Structural validity does not imply useful data

Consider this perfectly valid dataset:

| user_id |  age | country |
| ------- | ---: | ------- |
| 101     |   32 | UK      |
| 102     |   28 | UK      |
| 103     | NULL | UK      |
| 104     | NULL | UK      |

Nothing is structurally wrong. But now imagine yesterday:

$$
P(\text{age missing}) = 2\%
$$

and today:

$$
P(\text{age missing}) = 45\%
$$

The schema check passes. The dataset may nevertheless be badly damaged. This is why **missingness must be treated as information**.

![Three data quality families asking whether systems can read the data, why values are absent, and whether outcomes tell the truth](/content-assets/articles/article-mlops-data-for-ml-systems-schema-checks-missing-values-bad-labels/three-quality-questions.png)

*Structure, missingness, and labels need separate evidence because each family exposes a different way that training data can become unsafe.*

## What Does Missing Data Mean and Why Must It Be Checked by Segment?

<!-- section-summary: Zero, unknown, inapplicable, withheld, stale, source-missing, join-failed, and lookup-failed describe different states. -->

### A missing value is an event, not just an empty cell

Suppose `income` is missing. There are several possible causes:

```text
The user does not have an income.
The user refused to disclose income.
The upstream service timed out.
The feature does not apply to this user.
The value has not arrived yet.
A software bug deleted the value.
```

These should not automatically mean the same thing. We can represent missingness itself with a variable:

$$
M =
\begin{cases}
1 & \text{if value is missing}\\
0 & \text{otherwise}
\end{cases}
$$

Now the important question becomes:

$$
P(M=1\mid X,Y,\text{segment},t)
$$

Is missingness random, or does it correlate with something important? Consider perhaps:

$$
P(M_{\text{income}}=1 \mid \text{country=A})=2\%
$$

but:

$$
P(M_{\text{income}}=1 \mid \text{country=B})=54\%
$$

The overall dataset might show only 6% missingness. An aggregate metric hides the failure.

### Measure quality by segment

This is one of the most important principles in production ML. Suppose overall missingness is:

$$
5\%
$$

That sounds acceptable. But imagine:

```text
Existing customers:      1%
New customers:          35%
```

or:

```text
Web traffic:             2%
Android traffic:        41%
```

or:

```text
United Kingdom:          1%
Brazil:                 38%
```

A global average can therefore create false confidence. You frequently want checks resembling:

$$
Q(\text{feature}
\mid
\text{country, device, source, model version, time})
$$

rather than merely:

$$
Q(\text{feature})
$$

This is particularly important because ML errors frequently concentrate in subpopulations.

### Check distributions, not only individual rows

Many corruptions produce perfectly legal values. Imagine a user's age must satisfy:

$$
0 \le age \le 120
$$

Every row today satisfies the rule. But yesterday:

$$
\text{median age}=37
$$

and today:

$$
\text{median age}=7
$$

The values are individually valid but collectively suspicious. Maybe a transformation changed years into something else. Likewise, suppose purchase amounts are valid positive floats but suddenly:

$$
\$52.30
\rightarrow
5230
$$

because dollars became cents. Nothing necessarily violates the numeric type. Distribution checks may reveal:

$$
E[X_t] \gg E[X_{t-1}]
$$

or major changes in quantiles:

$$
Q_{50}, Q_{90}, Q_{99}
$$

or categorical frequencies:

$$
P(X=\text{category}_i)
$$

These detect errors that schema validation cannot.

## How Are Bad, Delayed, and Changing Labels Detected?

<!-- section-summary: Label checks verify source evidence, eligible population, window, maturity, revisions, human judgments, adjudication, join coverage, class balance, and segment coverage. -->

### The most dangerous field: the label

Features describe the input. Labels tell the model what reality supposedly was. Consider:

```text
transaction_id = 8173
fraud_label = 0
```

Training interprets this as:

"Transaction 8173 was genuinely legitimate."

But perhaps it actually means:

"Nobody has reported transaction 8173 as fraud yet."

Those are not equivalent. This distinction is fundamental. A model trained on the second interpretation may incorrectly learn that recently occurring fraud is legitimate merely because the investigation has not finished.

### Labels are often delayed

Many real-world labels do not exist immediately. Credit default may require months. Fraud may require:

```text
transaction
↓
customer complaint
↓
investigation
↓
confirmed fraud
```

Medical outcomes may take weeks. Subscription churn may only become certain after some inactivity period. Suppose an event happens at:

$$
t_0
$$

but its true label becomes known at:

$$
t_0 + 30\text{ days}
$$

Training on records from yesterday may therefore produce incorrect negative labels. You need a concept such as a **label maturity window**. For example:

```text
Do not use transactions newer than 45 days
for supervised training.
```

Then:

$$
\text{training cutoff}
=
\text{today}-45\text{ days}
$$

This sacrifices freshness in exchange for trustworthy labels.

### Labels can also change

Imagine:

```text
Day 1:   fraud = unknown
Day 7:   fraud = false
Day 20:  fraud = true
```

A training dataset constructed on Day 8 differs from one rebuilt on Day 30. Therefore training data frequently needs more than:

```text
transaction_id
label
```

It may need:

```text
transaction_id
event_time
label
label_timestamp
label_source
label_version
```

The design allows the system to distinguish:

What did we know?

from:

When did we know it?

That distinction matters enormously in ML.

### Label leakage

One common way to create an apparently excellent ML model is accidentally giving it information from the future. Suppose we want to predict loan default at approval time. The dataset contains:

```text
income
credit_score
loan_amount
collection_calls
default
```

`collection_calls` strongly predicts default. Perhaps:

$$
P(default \mid collection\_calls > 5)
\approx 1
$$

The model looks amazing. But collection calls happen **after** the borrower begins failing to repay. At prediction time they do not exist.

The correct constraint is:

$$
t_{\text{feature}}
\le
t_{\text{prediction}}
$$

For every feature. If:

$$
t_{\text{feature}}

t_{\text{prediction}}
$$

the feature contains future information. That is leakage.

### Leakage is fundamentally a time-consistency problem

Imagine a prediction at 09:00. The model should only be allowed to see information available by 09:00. You can picture the dataset as:

```text
Past ---------------- Prediction ---------------- Future
                         |
customer age -----------|
past purchases ----------|
account history ----------|
                         |------ chargeback result
                         |------ fraud investigation
                         |------ cancellation
```

Everything to the right of the prediction point must normally be invisible to the feature pipeline. A surprisingly large fraction of offline ML evaluation problems come from violating this rule.

## How Can One Bad Field Damage Training, Serving, and Monitoring?

<!-- section-summary: A structural defect can create nulls, break a label join, remove one segment, shift class balance, change model behaviour, and corrupt the monitoring baseline. -->

### A bad field rarely damages only training

Suppose feature `account_age_days` breaks. Instead of:

```text
5
100
450
800
```

the pipeline produces:

```text
0
0
0
0
```

This has several consequences. During training:

$$
X_{\text{training}}
$$

is corrupted. The learned parameters become:

$$
\theta' \neq \theta
$$

Then offline metrics may change. But that same broken field may also feed monitoring. Suppose the monitoring system computes:

```text
prediction accuracy by account age
```

Now the monitoring system is corrupted too. So the system may suffer:

```text
bad source data
      ↓
bad features
      ↓
bad training dataset
      ↓
bad model
      ↓
bad predictions
```

while simultaneously:

```text
bad source data
      ↓
bad monitoring data
      ↓
monitoring says everything is fine
```

This second path is especially dangerous. The system has lost **observability** as well as accuracy.

### Data quality therefore needs lineage

To repair a failure, we need to know what depended on what. Suppose:

```text
raw_transactions
        ↓
transaction_features
        ↓
training_dataset_v57
        ↓
model_v12
```

If `raw_transactions` was corrupt from August 10 through August 12, you need to determine which derived artifacts were affected. Ideally:

```text
raw_transactions partition
        ↓
feature partitions
        ↓
training snapshots
        ↓
models
        ↓
evaluation reports
```

This dependency graph is called **data lineage**. Without lineage, teams frequently know:

"The upstream data was wrong."

but cannot answer:

"Which models need rebuilding?"

![Three meanings of a missing delivery-time value and their different rates across mobile, web, and partner segments](/content-assets/articles/article-mlops-data-for-ml-systems-schema-checks-missing-values-bad-labels/missingness-causes-and-segments.png)

*The same null can mean a failed observation, an inapplicable field, or a delayed outcome, and segment-level rates help distinguish those causes.*

## How Do Severity, Quarantine, and Repair Control the Response?

<!-- section-summary: Severity maps a failed rule to warn, block, quarantine, or review. -->

### Detection is only the first half of data quality

Imagine the system detects:

```text
country column is 92% NULL
```

Excellent. What happens next? If the only response is:

```text
send Slack alert
```

the organization has monitoring, but not necessarily a reliable data-quality system. A production response normally involves three stages:

$$
\boxed{\text{Detect} \rightarrow \text{Contain} \rightarrow \text{Recover}}
$$

For example:

```text
Detected:
Android age field is broken.

Contain:
Prevent today's partition from entering training.

Repair:
Recompute Android ages from raw events.

Recover:
Rebuild downstream feature partitions.

Republish:
Replace affected datasets.

Verify:
Run quality checks again.

Retrain:
Only if affected data entered a model.
```

The recovery path matters just as much as the detector.

### Quarantining is often safer than silently repairing

Suppose a record says:

```text
age = -147
```

You could convert it to:

```text
age = NULL
```

But that changes the data. Sometimes that is appropriate. Sometimes the correct response is:

```text
quarantine record
```

so that it cannot contaminate downstream systems. A useful architecture is:

```text
incoming data
      ↓
validation
   ↙       ↘
valid     invalid
 ↓          ↓
publish   quarantine
```

Then invalid data can be inspected without entering training. The control prevents what might be called **silent corruption**:

```text
bad value
→ automatic guess
→ apparently valid dataset
→ nobody realizes anything was wrong
```

### Repairing data creates another important problem: reproducibility

Suppose you train:

```text
model_v1
```

on:

```text
dataset_2026_07_15
```

Later you discover corruption and repair that dataset. If you overwrite it in place, the dataset called:

```text
dataset_2026_07_15
```

now means something different from what trained `model_v1`. You can no longer reconstruct the model. A better pattern is immutable or versioned data:

```text
dataset_v103   corrupted historical version
dataset_v104   repaired version
```

Then:

```text
model_v1 → dataset_v103
model_v2 → dataset_v104
```

This preserves causality.

## How Do Failure Tests Prove the Full Quality System Works?

<!-- section-summary: Known-bad fixtures prove that schema, missingness, label, leakage, and segment rules reject the defects they claim to detect. -->

### Quality checks should exist at several boundaries

You can think of an ML data system as a sequence:

```text
Source
  ↓
Raw data
  ↓
Cleaned data
  ↓
Features
  ↓
Training examples
  ↓
Model
  ↓
Predictions
  ↓
Labels
```

Checking only the raw input is insufficient because corruption can be introduced during transformations. For example:

```text
correct timestamp
       ↓
timezone conversion bug
       ↓
incorrect hour_of_day feature
```

The source passed validation. The feature did not. Therefore validation belongs around important **interfaces and artifacts**, not just the beginning of the pipeline.

### Different checks protect against different failures

A practical quality system might test:

| Question                       | Example                               |
| ------------------------------ | ------------------------------------- |
| Does the field exist?          | `customer_id` present                 |
| Is its representation valid?   | integer                               |
| Is its value plausible?        | `age ∈ [0,120]`                       |
| Is it sufficiently complete?   | null rate < 2%                        |
| Is it unique when required?    | no duplicate transaction IDs          |
| Are relationships valid?       | order.customer_id exists in customers |
| Is the distribution plausible? | revenue median hasn't shifted 100×    |
| Is freshness acceptable?       | newest events < 20 min old            |
| Is volume plausible?           | 8M–12M rows/day                       |
| Are labels mature?             | at least 45 days old                  |
| Are timestamps leakage-safe?   | feature time ≤ prediction time        |

Notice that no single check tells you that the dataset is "good." Quality emerges from many constraints corresponding to assumptions made by downstream systems.

### Every quality check represents an assumption

Suppose you write:

$$
0 \le age \le 120
$$

That test isn't arbitrary. The ML system implicitly assumes:

`age` represents human age measured in years.

Suppose you write:

$$
\text{NULL rate(country)} < 5\%
$$

You are expressing another assumption:

country should normally be available.

Suppose you write:

$$
\text{daily rows} > 10^6
$$

You are expressing:

the upstream system normally produces at least one million observations.

So data-quality engineering can be understood as:

$$
\boxed{
\text{Turn hidden assumptions into executable checks}
}
$$

That sentence describes the purpose of data-quality engineering.

### There are hard constraints and soft expectations

Some assumptions should never be violated. For example:

```text
transaction_id must not be NULL
```

That's a **hard constraint**. Other things naturally fluctuate:

```text
average transaction amount
fraction of users from London
fraud rate
daily event count
```

Those need statistical monitoring. For example:

$$
|\mu_t-\mu_{\text{baseline}}| > \tau
$$

might trigger investigation. Or compare distributions:

$$
D(P_t,P_{\text{reference}})>\tau
$$

where $$D$$ might represent a distribution-distance metric. This distinction helps prevent overly brittle pipelines. You commonly don't want:

```text
mean purchase value != £41.27
→ stop everything
```

You want:

```text
unexpectedly large change
→ investigate or block depending on severity
```

### Not every distribution shift is a data-quality problem

This distinction matters enormously. Suppose ice-cream purchases rise dramatically in July. The distribution changed.

But the data may be completely correct. So:

$$
\text{distribution shift}
\not\Rightarrow
\text{data corruption}
$$

The shift might represent:

```text
seasonality
new product launch
economic event
marketing campaign
new geography
real customer behavior
```

A quality system should detect unexpected changes, but humans or higher-level logic frequently need to decide whether they represent:

$$
\text{pipeline failure}
$$

or:

$$
\text{real-world change}
$$

This separates **data quality** from the broader concept of **data drift**.

### Labels deserve stronger checks than ordinary features

Labels define what the model learns to predict, so their checks need to ask questions such as:

```text
Where did this label come from?
Who or what created it?
How long after the event did it arrive?
Can it change?
How frequently is it wrong?
Does "negative" actually mean negative, or merely "not yet positive"?
Are labels systematically missing for certain groups?
Was the label available only after prediction time?
```

For human-generated labels, disagreement can also be informative. Suppose two reviewers label the same examples. If their agreement is:

$$
55\%
$$

then expecting a classifier to achieve nearly perfect accuracy may be conceptually unreasonable. Sometimes apparent "model error" is really:

$$
\text{label uncertainty}
$$

### Monitoring production data requires comparison with training data

A model learned from a training distribution:

$$
P_{\text{train}}(X,Y)
$$

Production generates:

$$
P_{\text{prod}}(X,Y)
$$

Some differences are expected. But large unexplained differences deserve investigation. You might monitor:

$$
P_{\text{prod}}(X)
\quad\text{vs}\quad
P_{\text{train}}(X)
$$

For example:

```text
Training:
device_type
mobile  60%
desktop 40%

Production:
mobile   2%
desktop 98%
```

Maybe user behavior changed. Or maybe the mobile ingestion pipeline failed. Monitoring cannot automatically know which one happened.

But it tells you where to look.

### Training-serving consistency is another quality dimension

Suppose training calculates:

```python
age_days = floor((prediction_time - signup_time) / 86400)
```

while production uses:

```python
age_days = round(...)
```

Neither dataset is intrinsically corrupted. Yet the model sees one feature definition during training and another during inference. Formally:

$$
f_{\text{train}}(raw)
\neq
f_{\text{serve}}(raw)
$$

That creates training-serving skew. Therefore data-quality checks for ML frequently need to validate **feature semantics and transformations**, not merely source data.

### What should happen when a check fails?

Not every failure deserves the same response. Imagine three incidents:

```text
Optional marketing field:
NULL rate rises from 3% → 4%

Important model feature:
NULL rate rises from 3% → 40%

Primary key:
100% NULL
```

Treating all three identically would be poor engineering. Quality rules frequently benefit from severity levels such as:

```text
WARN
BLOCK
QUARANTINE
```

Conceptually:

$$
\text{response severity}
\propto
\text{expected downstream damage}
$$

The correct response depends on:

```text
feature importance
blast radius
ability to repair
freshness requirements
model criticality
whether corruption is reversible
```

### Choosing a data-quality tool

The specific product matters less than the capabilities you need. A useful system should help express things such as:

```text
schema contracts
null thresholds
ranges
uniqueness
referential integrity
categorical domains
distribution tests
freshness
volume
custom business rules
```

For ML specifically, also look for support around:

```text
feature distributions
training/serving comparisons
label validation
time-window checks
dataset versioning
lineage
segment-level metrics
```

But detection alone is insufficient. The tool must fit the surrounding data platform so that failed checks can influence orchestration:

```text
quality check
      ↓
pipeline decision
      ↓
publish / block / quarantine
```

A simple in-pipeline validator that blocks corrupt data can protect training more effectively than an elaborate dashboard with no enforcement path.

### Test the failure path, not only the happy path

Imagine engineers create:

```text
assert null_rate < 5%
```

They test it on good data. It passes. That does not prove the quality system works.

You should deliberately inject bad data:

```text
drop required column
change numeric field to string
produce 80% NULLs
duplicate primary keys
shift timestamps into future
corrupt labels
reduce volume by 90%
```

Then verify the entire chain:

```text
bad data
   ↓
check fails
   ↓
pipeline blocks publication
   ↓
alert reaches correct owner
   ↓
data gets repaired
   ↓
affected outputs rebuild
   ↓
checks pass
   ↓
dataset republishes
```

That is a much stronger test. You are testing the **recovery mechanism**, not merely the validator.

## Where Should Quality Checks Run Across the Data Path?

<!-- section-summary: Run checks at producer, ingestion, transformation, feature, label, training, publication, and serving boundaries according to the failure each can prevent. -->

### Why data quality is particularly difficult in ML

Traditional software frequently behaves roughly like:

$$
\text{code} + \text{input}
\rightarrow
\text{output}
$$

In machine learning:

$$
\text{code}
+
\boxed{\text{training data}}
\rightarrow
\text{model}
$$

and then:

$$
\text{model}
+
\boxed{\text{production data}}
\rightarrow
\text{prediction}
$$

So data affects the system twice. Corrupted training data changes the program you effectively create. Corrupted inference data changes what that program sees.

This is why data should frequently be treated almost like source code:

```text
version it
test it
trace its dependencies
review important changes
make builds reproducible
```

### Data is a measurement system

This is perhaps the deepest way to think about the problem. Suppose you want to predict:

$$
Y = \text{customer satisfaction}
$$

But you cannot directly observe satisfaction. Instead you observe:

```text
survey responses
support tickets
refunds
ratings
usage
```

These are measurements of reality. The pipeline then transforms those measurements. So ML actually sees:

$$
\text{Reality}
\xrightarrow{\text{measurement}}
\text{Recorded data}
\xrightarrow{\text{pipeline}}
\text{features}
$$

The model never sees reality directly. It sees the outputs of your measurement system. If the measurement system changes, the meaning of the model's input changes.

That is why a change such as:

```text
"Customers must now explicitly opt into surveys"
```

can damage ML data quality even though the database schema remains unchanged.

### A complete way to reason about a dataset

To decide whether an ML dataset is trustworthy, trace its evidence through this chain:

1. **Identity** — What does one row represent?
2. **Structure** — Are the expected fields, types, keys, formats, and relationships present?
3. **Semantics** — What exactly does every field mean?
4. **Completeness** — Why are values missing, and for whom?
5. **Validity** — Are individual values plausible?
6. **Distribution** — Does the population look plausible, globally and by segment?
7. **Time** — When did each fact become available?
8. **Labels** — Are targets correct, mature, stable, and sufficiently complete?
9. **Leakage** — Could any feature know something unavailable at prediction time?
10. **Lineage** — Where did the data come from and what depends on it?
11. **Recovery** — What gets blocked, repaired, rebuilt, and republished when quality fails?
12. **Observability** — Can we notice deterioration after deployment?

Each item protects an assumption required by the model, so the sequence is more than a mechanical checklist.

### A concrete example

Imagine you're building a model predicting whether a food-delivery order will arrive late. Prediction occurs when the customer places the order:

$$
t_{\text{prediction}}=\text{order creation}
$$

Features might include:

```text
restaurant
distance
time_of_day
weather
restaurant historical delay rate
driver availability
```

Label:

```text
late_delivery
```

Now imagine several quality failures.

#### Risk 1: structural

```text
distance_km
```

changes to:

```text
distance_meters
```

without renaming the field. Values suddenly become 1,000× larger.

#### Risk 2: missingness

The driver-location service fails only in one city. Global missingness:

$$
3\%
$$

City-level missingness:

$$
67\%
$$

An aggregate quality check misses it.

#### Risk 3: label delay

An order's actual arrival time isn't finalized until delivery completion. Recent orders therefore have no mature label. Treating them as:

```text
late_delivery = false
```

corrupts training.

#### Risk 4: leakage

Someone creates:

```text
actual_delivery_duration
```

as a training feature. It predicts lateness beautifully. But it exists only after delivery.

The offline metric rises sharply even though the live prediction path can never supply that feature.

#### Risk 5: monitoring corruption

The same broken distance field is used to calculate:

```text
accuracy by delivery distance
```

Now monitoring is unreliable too.

#### Risk 6: incomplete repair

Engineers fix the raw table. But yesterday's derived feature table remains corrupted. Future jobs still consume:

```text
features_2026_08_27
```

unless downstream partitions are rebuilt. The incident isn't actually resolved until the dependency chain is repaired.

### The architecture you ultimately want

Conceptually:

```text
                    DATA PRODUCERS
                          │
                          ▼
                   ┌─────────────┐
                   │ Raw Data    │
                   └──────┬──────┘
                          │
                structural checks
                freshness / volume
                          │
                    ┌─────┴─────┐
                    │           │
                  PASS         FAIL
                    │           │
                    │       quarantine
                    ▼
                transforms
                    │
                    ▼
                features
                    │
           semantic / statistical
                validation
                    │
                    ▼
              training dataset
                    │
              label + leakage
                  checks
                    │
                    ▼
                  model
                    │
                    ▼
               production
                    │
                    ▼
             drift / quality
               monitoring
```

And behind all of it:

```text
lineage + versioning + observability
```

#### What to remember

ML begins with a hidden assumption:

$$
\boxed{
\text{The data means what we think it means.}
}
$$

Data-quality engineering exists to continuously test that assumption. Schema checks ask:

**Can I read this data correctly?**

Semantic checks ask:

**Do these values mean what I think they mean?**

Missingness checks ask:

**What information failed to appear, and for whom?**

Distribution checks ask:

**Does this population still look plausible?**

Label checks ask:

> **Is the thing we're teaching the model actually true?**

Leakage checks ask:

**Could we really have known this at prediction time?**

Lineage and recovery ask:

**If something was wrong, what did it contaminate and how do we reconstruct the system correctly?**

The deepest principle is:

$$
\boxed{
\text{A model can only be as trustworthy as the measurement process that created its data.}
}
$$

A strong ML data-quality system does more than reject malformed rows. It turns the assumptions linking **reality → data → features → labels → models** into checks that can run, be observed, and support recovery.

![A data quality recovery loop connecting detection, quarantine, diagnosis, repair, backfill, verification, and republication](/content-assets/articles/article-mlops-data-for-ml-systems-schema-checks-missing-values-bad-labels/data-quality-recovery-loop.png)

*Quality controls protect training data through a complete recovery loop rather than stopping after the first failed check.*

## Check Your Answers

Use these answers to revisit the evidence, boundaries, and operating decisions behind each question.

:::expand[Why Must ML Data Quality Cover Structure, Meaning, and Truth?]{kind="recap"}
ML data passes from reality through measurement, storage, transformation, features, and labels.

Structure says readers can interpret the representation. Meaning says values and missing states express the intended facts. Truth asks whether the target and evidence validly measure the prediction problem. A dataset needs all three claims for its declared use.
:::

:::expand[How Do Schema Contracts Detect Breaking Data Changes?]{kind="recap"}
Schema contracts define fields, types, nullability, units, grain, keys, and compatibility rules.

Additive changes may be compatible for flexible readers, while removed fields, changed units, nested shapes, new enum meanings, or altered grain can break consumers. Versioned contracts and producer-consumer tests turn those changes into explicit release decisions.
:::

:::expand[What Does Missing Data Mean and Why Must It Be Checked by Segment?]{kind="recap"}
Zero, unknown, inapplicable, withheld, stale, source-missing, join-failed, and lookup-failed describe different states.

Preserving reason and freshness prevents infrastructure failure from looking like a real value. Segment checks reveal concentrated missingness hidden by a healthy global rate and connect it to affected populations and source paths.
:::

:::expand[How Are Bad, Delayed, and Changing Labels Detected?]{kind="recap"}
Label checks verify source evidence, eligible population, window, maturity, revisions, human judgments, adjudication, join coverage, class balance, and segment coverage.

Pending and unobserved outcomes stay separate from negatives. Feature lineage and prediction-time tests preserve outcome evidence and post-decision reactions out of model inputs.
:::

:::expand[How Can One Bad Field Damage Training, Serving, and Monitoring?]{kind="recap"}
A structural defect can create nulls, break a label join, remove one segment, shift class balance, change model behaviour, and corrupt the monitoring baseline. Impact tracing starts at the first failed field or source and follows every downstream dataset, feature, model, and dashboard rather than treating the last visible symptom as the cause.
:::

:::expand[How Do Severity, Quarantine, and Repair Control the Response?]{kind="recap"}
Severity maps a failed rule to warn, block, quarantine, or review.

Quarantine preserves suspect rows and evidence without exposing them to approved consumers. Repair fixes the owning source or transformation, backfills the bounded affected range, reruns the unchanged contract, publishes a new version, and reevaluates downstream models.
:::

:::expand[How Do Failure Tests Prove the Full Quality System Works?]{kind="recap"}
Known-bad fixtures prove that schema, missingness, label, leakage, and segment rules reject the defects they claim to detect. Pipeline tests then prove a block stops publication, quarantine retains evidence, alerts reach the owner, the last good version remains usable, and a corrected backfill passes before republication.
:::

:::expand[Where Should Quality Checks Run Across the Data Path?]{kind="recap"}
Run checks at producer, ingestion, transformation, feature, label, training, publication, and serving boundaries according to the failure each can prevent. Tools may differ across SQL, Python, distributed data processing, streams, and services, while shared contracts, check identities, lineage, and owners preserve their evidence consistent across offline and online paths.
:::

## References

- [AWS documentation: AWS Glue Data Quality](https://docs.aws.amazon.com/glue/latest/dg/glue-data-quality.html)
- [Confluent documentation: Schema evolution and compatibility](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html)
