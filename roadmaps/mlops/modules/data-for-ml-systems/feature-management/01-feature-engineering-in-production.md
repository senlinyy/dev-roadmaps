---
title: "Production Features"
description: "Turn notebook feature ideas into owned, tested, versioned feature definitions that training and serving teams can trust."
overview: "Production feature engineering turns useful model inputs into dependable product logic. Learn how teams define time and ownership, compute historical values safely, reuse transformations, validate releases, operate freshness, preserve lineage, and retire features."
tags: ["MLOps", "production", "features"]
order: 1
id: "article-mlops-data-for-ml-systems-feature-engineering-in-production"
---

## Table of Contents

1. [What Turns a Notebook Column into a Production Feature?](#what-turns-a-notebook-column-into-a-production-feature)
2. [How Does a Feature Contract Separate Meaning from Calculated Values?](#how-does-a-feature-contract-separate-meaning-from-calculated-values)
3. [How Do Time Boundaries Keep Historical Feature Values Honest?](#how-do-time-boundaries-keep-historical-feature-values-honest)
4. [How Can Offline and Online Implementations Preserve One Meaning?](#how-can-offline-and-online-implementations-preserve-one-meaning)
5. [How Do Freshness, Missingness, Latency, and Availability Shape Serving?](#how-do-freshness-missingness-latency-and-availability-shape-serving)
6. [How Are Features Validated, Versioned, and Backfilled?](#how-are-features-validated-versioned-and-backfilled)
7. [How Do Shared Paths and Monitoring Keep Features Operable?](#how-do-shared-paths-and-monitoring-keep-features-operable)
8. [How Are Feature Dependencies Deprecated and Removed Safely?](#how-are-feature-dependencies-deprecated-and-removed-safely)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A fraud notebook creates `failed_payments_24h`, the number of failed attempts for an account during the previous 24 hours. The feature improves recall on historical data. That result only shows that the idea may help.

The warehouse may have removed duplicate events before the notebook reads them, while the live path receives the same event twice after a retry. The notebook may measure the window from each old authorization time, while serving uses the current clock. Both paths return an integer, but the integers may describe different facts.

A **production feature** needs a precise contract: meaning, entity, sources, time window, availability rule, missing states, version, owner, and delivery deadline. The same contract must guide historical training, live serving, backfills, validation, monitoring, and retirement.

Carry the feature through that lifecycle:

1. **What Turns a Notebook Column into a Production Feature?**
2. **How Does a Feature Contract Separate Meaning from Calculated Values?**
3. **How Do Time Boundaries Keep Historical Feature Values Honest?**
4. **How Can Offline and Online Implementations Preserve One Meaning?**
5. **How Do Freshness, Missingness, Latency, and Availability Shape Serving?**
6. **How Are Features Validated, Versioned, and Backfilled?**
7. **How Do Shared Paths and Monitoring Keep Features Operable?**
8. **How Are Feature Dependencies Deprecated and Removed Safely?**

## What Turns a Notebook Column into a Production Feature?

<!-- section-summary: A production feature has stable semantics, an entity and prediction-time boundary, governed sources, reproducible historical logic, a serving strategy, validation, versions, owners, service expectations, monitoring, back -->

A feature in a notebook is just a calculation. A **production feature** is a calculation that has become part of a reliable system. That difference is much larger than it first appears.

Suppose a researcher writes:

```python
customer_spend_30d = sum(
    transaction.amount
    for transaction in customer.transactions
    if transaction.time >= prediction_time - 30_days
)
```

In a notebook, the feature may look useful. But production immediately introduces harder questions:

* What exactly counts as a transaction?
* Which currency is `amount` in?
* Are refunds included?
* What happens when transactions arrive late?
* What value should be used for a brand-new customer?
* Can the feature be calculated before the prediction deadline?
* Can we reconstruct its value six months ago?
* Will training and serving calculate it identically?
* How fresh must it be?
* Who fixes it when the source breaks?
* What happens to old models if its definition changes?

The real problem is therefore not:

**How do we compute this feature?**

It is:

> **How do we make this feature a stable, time-correct, reproducible input to an ML system?**

The resulting feature value depends on all of these inputs:

$$
\boxed{
\text{Feature Value}
=
F(
\text{source facts},
\text{feature definition},
\text{entity},
\text{prediction time}
)
}
$$

Production feature engineering is about controlling every term in that equation.

### Why features exist

An ML system eventually makes some decision:

$$
\hat{Y}=M(X)
$$

where $$X$$ is the collection of features. Consider a fraud system may decide:

$$
\text{approve transaction?}
$$

A delivery system may estimate:

$$
\text{expected arrival time}
$$

A recommendation system may choose:

$$
\text{which products to rank}
$$

Features exist to provide the model with information available when that decision must be made. So before defining a feature, ask:

**What decision are we making, for which entity, and at what time?**

The result gives three fundamental pieces:

$$
\boxed{
\text{Entity}
+
\text{Decision}
+
\text{Decision Time}
}
$$

For example:

```text
Entity:
transaction 88127

Decision:
approve or decline

Decision time:
2026-08-28 14:03:17
```

Now feature requirements become much clearer.

### The decision deadline constrains what features are possible

Imagine a fraud decision must return within:

$$
100\text{ ms}
$$

Suppose someone proposes:

```text
number_of_chargebacks_last_year
```

This may be predictive. But if computing it requires scanning 50 million records and takes 8 seconds, it is not usable in the live decision path. So predictive usefulness alone is insufficient.

A production feature must satisfy:

$$
\boxed{
\text{useful}
+
\text{available}
+
\text{fast enough}
}
$$

If the prediction deadline is $$t_d$$, then:

$$
t_{\text{feature ready}}
\le t_d
$$

Otherwise the model cannot use the feature in production.

## How Does a Feature Contract Separate Meaning from Calculated Values?

<!-- section-summary: The definition records what the feature means, how it is calculated, and which version owns those semantics. -->

### Production features have two different things: definition and value

This distinction is fundamental. Consider:

```text
purchases_last_30_days
```

There is a **feature definition**:

Count completed purchases made by a customer during the 30 days before prediction time.

And there are **feature values**:

```text
customer 101 at 09:00 → 4
customer 102 at 09:00 → 17
customer 101 at 12:00 → 5
```

Conceptually:

$$
\boxed{
\text{Feature Definition}
\neq
\text{Feature Value}
}
$$

The feature definition is the recipe. The value is one evaluation of that recipe.

### Think of a feature as a function

Suppose:

$$
F=
\text{purchases in previous 30 days}
$$

Then:

$$
F(customer,t)
$$

means:

Evaluate the feature for this customer at time $$t$$.

For example:

$$
F(101,\text{Aug 1})=8
$$

and:

$$
F(101,\text{Aug 20})=12
$$

Same feature definition. Different feature values. This time dependence is one reason production ML features are more subtle than ordinary database columns.

### The feature recipe must have precise semantics

A weak definition is:

```text
customer spending
```

What does that mean? Possibilities include:

```text
lifetime spending
spending in last 30 days
authorized transaction value
completed transaction value
value after refunds
value before refunds
GBP-equivalent value
raw transaction currency
```

The model doesn't know which interpretation you intended. A stronger definition might be:

```text
Feature:
completed_spend_30d_gbp

Entity:
customer

Definition:
sum of completed, non-refunded purchases
whose event times fall within the 30 days
before prediction_time

Currency:
converted to GBP using exchange rate
available at transaction time

Window:
[prediction_time - 30 days, prediction_time)

Missing behavior:
0 when customer has no qualifying purchases
```

Now the feature has semantics rather than merely a name.

### Feature names do not preserve meaning

Imagine version 1 of:

```text
customer_spend_30d
```

includes refunds. Later an engineer changes it to exclude refunds. The name stays the same.

But:

$$
F_{v1}(x,t)\neq F_{v2}(x,t)
$$

This can silently alter model behavior. Therefore important feature definitions need versioning. For example:

```text
customer_spend_30d:v1
customer_spend_30d:v2
```

or an equivalent immutable definition ID. The important invariant is:

$$
\boxed{
\text{One feature version should have one stable meaning.}
}
$$

### The source facts

A feature is derived from something. Suppose:

$$
F=\text{completed purchases in last 30 days}
$$

The source may be:

```text
orders table
payments table
refunds table
```

Before productionizing the feature, you need to understand what those sources mean. For example:

```text
orders.status = "completed"
```

Does `completed` mean:

merchant accepted it?

or:

payment settled?

or:

customer received it?

These are different business events. So production feature work starts with **source semantics**, not transformation syntax.

### Every source should have an owner and a contract

Suppose your model depends on:

```text
customer_country
```

coming from a customer profile system. Production questions include:

```text
Who owns this field?
Can it be NULL?
How quickly are updates published?
Can historical values change?
What does "country" mean?
Residence?
Billing country?
Current IP country?
```

If nobody knows, your model depends on an undocumented interpretation. A useful source contract covers things such as:

```text
field meaning
data type
valid values
freshness expectations
NULL semantics
update behavior
owner
```

This matters because a production feature inherits assumptions from its source.

### A feature can be correct mathematically but wrong semantically

Suppose you compute:

$$
\text{average order value}
=
\frac{\sum amount}{N}
$$

The arithmetic is correct. But perhaps `amount` changed from:

```text
GBP
```

to:

```text
pence
```

The feature is now 100× larger. Or perhaps:

```text
cancelled orders
```

started appearing in the source. Your code still executes perfectly. So:

$$
\boxed{
\text{correct calculation}
\not\Rightarrow
\text{correct feature}
}
$$

Production feature systems must protect meaning, not merely computation.

### Determinism matters

Suppose you compute:

$$
F(X)=Y
$$

for fixed source data $$X$$. Running it again should normally produce the same logical values:

$$
F(X)=Y
$$

again. Things that break this include:

```text
current_time()
unseeded sampling
unordered LIMIT
mutable external APIs
non-versioned lookup tables
```

For example:

```python
window_start = datetime.now() - timedelta(days=30)
```

makes the feature depend on execution time. Instead, use an explicit prediction/reference time:

```python
def feature(customer_id, prediction_time):
    ...
```

Now the computation is controlled.

![One versioned feature recipe producing different values for the same entity at three historical cutoffs](/content-assets/articles/article-mlops-data-for-ml-systems-feature-engineering-in-production/feature-recipe-and-values.png)

*The recipe stays stable while the calculated value changes with the entity and the information available at each cutoff.*

## How Do Time Boundaries Keep Historical Feature Values Honest?

<!-- section-summary: The product decision identifies the action the model supports. -->

### Time is part of the feature definition

This is perhaps the most important ML-specific idea. Suppose:

```text
purchases_last_30_days
```

At prediction time $$t$$:

$$
F(t)=
\sum_i
1[t-30d \le t_i < t]
$$

Without $$t$$, the feature is undefined. That means many ML features are not static columns. They are functions of historical state:

$$
\boxed{
F(entity,t)
}
$$

This perspective naturally leads to point-in-time correctness.

### Historical features must use only facts available at that time

Imagine rebuilding the inputs used for a loan decision at this time:

```text
2026-01-10 09:00
```

Today the customer's account status is:

```text
defaulted
```

But on January 10 it was:

```text
current
```

Which should training use? The January value. Formally, a historical feature must satisfy:

$$
t_{\text{information available}}
\le
t_{\text{prediction}}
$$

Anything learned afterward is future information. Using it creates leakage.

### Event time alone is not always enough

Suppose a transaction happened at:

```text
10:00
```

but entered the warehouse at:

```text
10:20
```

Prediction occurred at:

```text
10:10
```

Did the production model know about that transaction? No. So even though:

$$
t_{\text{event}} < t_{\text{prediction}}
$$

we may have:

$$
t_{\text{arrival}} > t_{\text{prediction}}
$$

For strict production simulation, training may need to respect **availability time**, not just event time. This distinction is central to leakage-resistant feature generation.

### Point-in-time joins protect historical training

Suppose the customer table contains changing values:

| customer | time  | tier     |
| -------- | ----- | -------- |
| 42       | Jan 1 | Standard |
| 42       | Mar 1 | Premium  |

Training example:

```text
customer = 42
prediction_time = Feb 10
```

A normal current-state join might return:

```text
Premium
```

because that is the latest row today. A point-in-time join asks:

What was the latest value available by February 10?

So it selects:

```text
Standard
```

Conceptually:

$$
value(t)
=
\arg\max_{v}
\{
t_v \mid t_v\le t
\}
$$

That is a fundamental operation in historical ML feature computation.

### Offline usefulness can hide impossible online features

Suppose researchers discover:

```text
time_until_customer_refund
```

strongly predicts fraud. Of course it does. The refund happens after the transaction.

So it cannot exist when the transaction decision is made. Offline:

$$
P(Y\mid X)
$$

looks excellent. Production:

$$
X
$$

does not exist yet. A production feature must satisfy:

$$
\boxed{
\text{available at prediction time}
}
$$

not merely:

$$
\text{present somewhere in the warehouse}
$$

## How Can Offline and Online Implementations Preserve One Meaning?

<!-- section-summary: Historical computation evaluates the feature at each example's prediction time using explicit half-open windows, event and availability timestamps, historical dimensions, deterministic tie-breaking, and point-in-time joi -->

### Training and serving create two computational worlds

Most production ML systems need feature values in two contexts.

#### Offline

For:

```text
training
validation
backtesting
historical analysis
```

This might involve billions of examples.

#### Online

For:

```text
one live prediction
```

under a tight latency requirement. The result creates a difficult problem:

$$
F_{\text{offline}}
$$

and:

$$
F_{\text{online}}
$$

must mean the same thing. If not:

$$
\boxed{\text{training-serving skew}}
$$

appears.

### Training-serving skew can happen even with similar-looking code

Suppose training uses:

```python
age_days = floor(seconds / 86400)
```

while serving uses:

```python
age_days = round(seconds / 86400)
```

Small implementation difference. Different feature values. Or:

```text
offline:
NULL → 0

online:
NULL → -1
```

or:

```text
offline currency conversion:
daily rate

online:
latest market rate
```

Now:

$$
F_{\text{train}}(x,t)
\neq
F_{\text{serve}}(x,t)
$$

and the model sees a different input distribution after deployment.

### There are several ways to reuse feature logic

One design is:

$$
\boxed{
\text{same transformation implementation}
}
$$

used both offline and online. This reduces semantic drift but may be difficult when the execution environments differ greatly. Another design is:

```text
offline computation
→ materialize feature values
→ online lookup
```

Then serving doesn't recompute the feature. It fetches a precomputed value. For example:

```text
customer 42
purchase_count_30d = 17
updated_at = 10:05
```

This trades computation cost for freshness concerns.

### Precomputed versus request-time features

There are roughly two broad feature patterns.

#### Precomputed

Example:

```text
customer_purchase_count_30d
```

updated every hour. At prediction time:

```text
lookup(customer_id)
```

Advantages:

```text
low latency
expensive aggregates possible
```

Disadvantage:

```text
can become stale
```

#### Request-time

Example:

```text
current_cart_value
```

computed directly from the current request. Advantages:

```text
fresh
naturally tied to prediction
```

Disadvantages:

```text
latency-sensitive
may require live dependencies
```

Many production models use both.

### Some features combine historical and request-time information

Suppose:

```text
current_purchase_amount /
average_purchase_amount_90d
```

This requires:

$$
F=
\frac{X_{\text{request}}}
{X_{\text{historical stored}}}
$$

The numerator comes from the live request. The denominator comes from a precomputed feature. This introduces multiple freshness and availability requirements.

For example:

```text
request amount must exist now
historical average must be < 1 hour old
```

The feature contract should make these dependencies explicit.

## How Do Freshness, Missingness, Latency, and Availability Shape Serving?

<!-- section-summary: Training may use warehouse SQL while serving uses materialized state, streaming counters, or request-time code. -->

### Freshness is part of feature correctness

Suppose the stored value is:

```text
account_balance = £1,000
updated 8 hours ago
```

The value may have been correct eight hours ago. But if the decision needs a balance no older than five minutes, it is not acceptable now. So feature correctness depends on:

$$
\text{value}
+
\text{timestamp}
$$

A useful quantity is:

$$
\text{feature age}
=
t_{\text{prediction}}
-
t_{\text{feature update}}
$$

and require:

$$
\text{feature age}
\le
\tau
$$

for some freshness threshold $$\tau$$.

### Different features need different freshness guarantees

For example:

```text
date_of_birth:
months of staleness may be irrelevant

lifetime_purchase_count:
perhaps hourly

current_inventory:
seconds

current_account_balance:
potentially milliseconds
```

So there is no universal:

```text
all features must update every minute
```

A freshness limit should follow both the rate at which the underlying fact changes and the decision the model makes from it.

### Freshness and latency trade off

Suppose a feature is expensive to compute. Updating every second produces excellent freshness but high cost. Updating daily is cheap but stale.

So production design chooses a balance:

$$
\text{Cost}
\leftrightarrow
\text{Freshness}
\leftrightarrow
\text{Latency}
$$

This is not primarily an ML modeling decision. It is a systems design decision induced by the model.

### Missing live features require explicit behavior

Suppose the model requests:

```text
purchase_count_30d
```

but the feature store has no record for a new customer. What should happen? Possible choices:

```text
0
NULL
global average
special missing token
fallback model
reject prediction
```

Those choices are not interchangeable. Training must simulate the same behavior. If production uses:

```text
missing → 0
```

but training drops missing rows, then:

$$
P_{\text{train}}(X)
\neq
P_{\text{serve}}(X)
$$

So missing-value behavior belongs in the feature contract.

### Distinguish "zero" from "unknown"

Consider:

```text
purchase_count_30d = 0
```

This might mean:

Customer made no purchases.

But missing may mean:

Customer data failed to load.

If both become `0`, the model cannot distinguish:

$$
\text{true zero}
$$

from:

$$
\text{measurement failure}
$$

Sometimes adding:

```text
purchase_count_30d_missing = 1
```

is appropriate. The deeper principle is:

Do not silently collapse different real-world states unless that equivalence is intentional.

![A shared source and feature definition feeding historical training data and fresh online predictions through separate delivery paths](/content-assets/articles/article-mlops-data-for-ml-systems-feature-engineering-in-production/two-feature-delivery-paths.png)

*Historical and live delivery can use different storage and compute paths while preserving the same feature meaning and logic.*

## How Are Features Validated, Versioned, and Backfilled?

<!-- section-summary: The serving contract includes value timestamp, maximum age, lookup latency, availability, fallback, and distinct states for zero, unknown, absent history, stale value, lookup failure, and version mismatch. -->

### Feature validation belongs before publication

Suppose you compute daily features. Don't immediately expose them to models. Instead:

```text
source data
↓
feature computation
↓
staging
↓
validation
↓
publish
```

Checks may include:

```text
schema
NULL rate
range
freshness
cardinality
distribution
duplicate entity IDs
timestamps
```

For example:

$$
0\le purchase\_count_{30d}
$$

or:

$$
NULLRate(account\_age)<0.01
$$

The production model should consume only committed, validated values.

### Feature checks should include time correctness

Ordinary data-quality checks are not sufficient. For historical feature sets, verify:

$$
t_{\text{source available}}
\le
t_{\text{prediction}}
$$

For window features:

$$
t_{\text{window end}}
=
t_{\text{prediction}}
$$

For label-independent features:

```text
no source derived from post-outcome information
```

These are ML-specific correctness conditions.

### Compare offline and online feature values directly

One powerful way to detect training-serving skew is to take actual production examples and recompute the corresponding offline features. For example:

```text
prediction 881
online purchase_count_30d = 17

offline reconstruction = 17
```

Repeat across many examples. Then measure:

$$
MismatchRate_j
=
P(
F^{online}_j
\neq
F^{offline}_j
)
$$

for feature $$j$$. Ideally:

$$
MismatchRate_j\approx 0
$$

except where known tolerances apply.

### Production feature values should carry timestamps and provenance

Instead of storing only:

```text
customer_id = 42
feature = 17
```

you may want something conceptually closer to:

```text
customer_id = 42
feature_name = purchase_count_30d
feature_version = 3
value = 17
event_time = 10:00
computed_at = 10:05
source_snapshot = 881
```

Not every system stores all of this per value. But these concepts matter because they let you answer:

How old is this?

Which definition produced it?

Can I reconstruct it?

### Feature lineage connects values back to sources

Suppose:

```text
customer_risk_velocity
```

looks wrong. You need to trace:

```text
risk_velocity
      ↓
daily_transaction_aggregate
      ↓
clean_transactions
      ↓
payment_events
```

Lineage answers:

Which source facts and transformations produced this feature?

This matters both for debugging and incident impact analysis. If:

```text
payment_events / Aug 20
```

was corrupted, lineage can show the feature partitions and downstream models that used the bad source.

### Feature versioning should connect to model versioning

Suppose:

```text
fraud_model_v12
```

uses:

```text
purchase_count_30d:v3
country_risk:v7
account_age_days:v2
```

Record that relationship. Then if `country_risk:v7` is discovered to be flawed, you can ask:

$$
\text{Which models use feature version 7?}
$$

rather than:

Which models might use something called `country_risk`?

Version-level dependency information makes incident response much more precise.

### Changing a feature is often equivalent to creating a new feature

Suppose:

```text
spend_30d:v1
```

includes refunds. You want to exclude them. Instead of silently redefining it, treat the new semantics as:

```text
spend_30d:v2
```

Then:

```text
existing models → continue using v1
new model experiments → can test v2
```

This makes rollout controlled. Once old consumers are gone, $$v1$$ can eventually be deprecated.

### Why silent changes are dangerous

Suppose model $$M$$ was trained using:

$$
X_j = F_{v1}
$$

Production suddenly starts serving:

$$
X_j = F_{v2}
$$

without retraining. Now the deployed model receives a feature distribution it never learned. This is effectively changing the model's input contract.

So:

$$
\boxed{
\text{feature semantic change}
\approx
\text{API breaking change}
}
$$

for models consuming that feature.

### Feature evolution should therefore use compatibility rules

Possible changes include:

#### Safe or mostly safe

```text
documentation improvement
performance optimization preserving values
storage-format change
```

#### Potentially breaking

```text
different window
different unit
different source
different NULL handling
different category mapping
different filtering
```

The important question is:

$$
F_{\text{new}}(x,t)
\stackrel{?}{=}
F_{\text{old}}(x,t)
$$

If semantics change materially, use a new version.

### Historical feature recomputation is called backfilling

Suppose you introduce:

```text
merchant_refund_rate_90d
```

today. But you want to train on two years of historical examples. You need historical values:

$$
F(merchant,t)
$$

for many past times $$t$$. That is a **backfill**. You cannot merely calculate:

```text
merchant_refund_rate_90d today
```

and attach today's value to all historical rows. Each historical example needs the value that belonged to its historical prediction time.

### Historical backfills must preserve point-in-time correctness

For an example at time $$t$$:

$$
refund\_rate_{90d}(t)
=
\frac{
\text{refunds during }[t-90d,t)
}{
\text{orders during }[t-90d,t)
}
$$

not:

$$
refund\_rate_{90d}(today)
$$

A common ML data bug is accidentally substituting present state for historical state. That makes offline training unrealistically powerful.

### Late data creates a subtle backfill choice

Suppose an event happened before prediction time but wasn't ingested until afterward. For a historical backfill, should it count? There are two different goals.

#### Reconstruct ideal historical truth

Use the event because it happened before prediction time.

#### Simulate actual production knowledge

Exclude it because production had not received it yet. These are different experiments. You should decide explicitly which you're building.

## How Do Shared Paths and Monitoring Keep Features Operable?

<!-- section-summary: Validation checks schema, domain, time, historical fixtures, and offline-online parity before publication. -->

### A feature platform often needs both historical and live serving paths

Conceptually:

```text
                  Feature Definition
                         │
               ┌─────────┴─────────┐
               ▼                   ▼
         historical path       live path
               │                   │
               ▼                   ▼
       training datasets      prediction service
```

The aim is:

$$
\boxed{
\text{same feature semantics}
}
$$

across both paths. The infrastructure may differ. The meaning should not.

### Why a "feature store" can help

A feature store is not magical. Its value comes from solving recurring coordination problems such as:

```text
feature definitions
historical retrieval
online retrieval
entity keys
freshness
versioning
discovery
reuse
```

Conceptually it tries to provide:

$$
\text{Feature Definition}
\rightarrow
\begin{cases}
\text{historical values for training}\\
\text{current values for serving}
\end{cases}
$$

while preserving semantic consistency. You don't necessarily need a dedicated product to achieve these properties. But you do need the properties somewhere.

### Avoid producing every feature twice independently

A dangerous architecture is:

```text
data scientist SQL
→ training feature

backend engineer code
→ serving feature
```

Two teams independently implement:

```text
purchase_count_30d
```

Eventually one includes:

```text
pending transactions
```

and the other doesn't. Now:

$$
F_{\text{train}}
\neq
F_{\text{serve}}
$$

The safer pattern is to share:

* feature definitions,
* transformation libraries,
* tests,
* or materialized values.

Implementations may differ across batch and online paths, while both must follow one authoritative definition of the feature's meaning.

### But sharing code alone does not guarantee equality

Suppose both paths call the same function:

```python
purchase_count_30d(...)
```

Yet training reads:

```text
warehouse transaction history
```

while serving reads:

```text
real-time event cache
```

Those inputs may differ. So consistency requires:

$$
\text{logic consistency}
+
\text{input semantics consistency}
$$

Shared code solves only one half.

### Production features need service-level expectations

For an important feature, define things like:

```text
availability ≥ 99.99%
freshness ≤ 5 min
lookup p99 latency ≤ 15 ms
missing rate ≤ 0.1%
```

Why? Because once a model depends on the feature, the feature effectively becomes a production service dependency. A useful feature that is unavailable 10% of the time may be worse than a slightly less predictive but reliable feature.

### Features have reliability budgets too

Suppose a prediction requires ten features. Each feature lookup independently succeeds with probability:

$$
0.99
$$

The probability all ten succeed is roughly:

$$
0.99^{10}\approx 0.904
$$

So a collection of individually "pretty reliable" dependencies can create a weak overall path. This is why production models should avoid unnecessary live dependencies. Feature design affects system reliability.

### Precomputation can reduce serving dependencies

Suppose a live prediction would otherwise need:

```text
orders database
customer database
refund service
currency service
```

Instead, a pipeline can precompute:

```text
customer_spend_30d
```

and place it in an online feature store. Then prediction depends on one lookup instead of four computations. Conceptually:

$$
\text{complexity shifted}
$$

from:

$$
\text{latency-sensitive serving path}
$$

to:

$$
\text{asynchronous data pipeline}
$$

This is one reason feature platforms exist.

### But precomputation introduces staleness

If:

```text
customer_spend_30d
```

updates hourly, then the live value may lag behind reality. Therefore precomputation trades:

$$
\text{latency}
$$

for:

$$
\text{freshness}
$$

A good feature design explicitly accepts that trade.

### Monitor both feature quality and feature delivery

Production monitoring should ask two classes of questions.

#### Is the feature arriving correctly?

```text
freshness
availability
lookup latency
missingness
error rate
```

#### Do the values still make sense?

```text
distribution
range
category frequencies
drift
segment behavior
```

A feature store that returns nonsense quickly is still broken.

### Monitor by important segments

Suppose overall missingness is:

$$
2\%
$$

Looks good. But:

```text
web users:      0.5%
Android users: 18%
```

The model may fail badly for Android. So monitor:

$$
Q(F\mid segment)
$$

not merely:

$$
Q(F)
$$

Useful segments may include:

```text
country
device
customer type
model version
data source
region
```

### Feature drift is not automatically a data-quality failure

Suppose:

```text
travel_bookings_30d
```

jumps significantly before a holiday. That may be real behavior. So:

$$
\text{feature distribution changed}
\not\Rightarrow
\text{feature broken}
$$

A drift alert means:

Something changed.

Then investigate whether the cause is:

```text
real world
upstream data
feature code
serving bug
```

This distinction matters for production monitoring.

### Record the feature value used for important predictions when necessary

Suppose someone investigates a prediction six months later. Knowing today's feature values is useless. You may need to know:

```text
What feature values did the model actually receive?
```

For sufficiently important decisions, prediction logs can include:

```text
model version
feature versions
feature values or fingerprints
feature timestamps
prediction timestamp
```

subject to storage, privacy, and security requirements. The design allows:

$$
\text{prediction}
\rightarrow
\text{exact model inputs}
$$

which is extremely useful for debugging.

### Monitoring should include feature/model compatibility

Suppose:

```text
fraud_model_v17
```

expects:

```text
country_risk:v4
```

but a deployment accidentally serves:

```text
country_risk:v5
```

Both may be numeric. Nothing crashes. The model silently gets the wrong semantics.

So serving systems should ideally validate:

$$
\text{expected feature contract}
=
\text{served feature contract}
$$

before inference.

## How Are Feature Dependencies Deprecated and Removed Safely?

<!-- section-summary: Lineage identifies every active and fallback model that still requires the feature version. -->

### Removing a feature is also a production change

Suppose feature $$F$$ appears unused because your newest model no longer consumes it. Can you delete it? Maybe older models still use it:

```text
fraud_model_v17 → feature F
fraud_model_v18 → feature F
fraud_model_v19 → no F
```

If version 17 can still receive traffic, $$F$$ remains required. So feature deletion should follow lineage:

$$
F
\rightarrow
\text{consuming models}
$$

Only when all active consumers are gone is removal safe.

### Feature deprecation should be staged

A reasonable lifecycle is:

```text
ACTIVE
↓
DEPRECATED
↓
NO_NEW_CONSUMERS
↓
unused by production
↓
offline historical retention if needed
↓
REMOVED
```

The control prevents surprise breakage. A feature is effectively an API. You generally don't delete APIs while consumers still depend on them.

### Historical values may need different retention from current values

An online serving system may need only:

```text
latest customer feature value
```

But training needs:

```text
historical feature values
```

For example:

```text
customer 42:
Jan 1 → 3
Feb 1 → 8
Mar 1 → 12
```

If only the current value survives:

```text
12
```

you cannot build point-in-time training data. So online storage and historical storage frequently have different requirements.

### Treat derived feature values as rebuildable when possible

Ideally:

$$
F(entity,t)
$$

can be reconstructed from authoritative historical facts plus the feature definition. Then derived feature storage becomes partly a performance optimization. Conceptually:

$$
\boxed{
\text{raw/history}
+
\text{feature definition}
\rightarrow
\text{feature values}
}
$$

If derived values are lost, you can backfill them. This requires preserving historical source state and time semantics.

### But sometimes preserving exact values is valuable

Even a feature that can be recomputed may need its exact historical values retained for reasons such as:

```text
external dependencies changed
floating-point execution changed
original source history expired
old transformation runtime disappeared
```

For important production models, preserving the exact training dataset frequently gives stronger historical evidence than relying entirely on future recomputation.

### Production feature lifecycle

A useful mental model is:

```text
Idea
 ↓
Notebook
 ↓
Semantic definition
 ↓
Source contract
 ↓
Historical implementation
 ↓
Point-in-time validation
 ↓
Serving strategy
 ↓
Offline/online consistency tests
 ↓
Publication
 ↓
Model adoption
 ↓
Monitoring
 ↓
Versioned evolution
 ↓
Deprecation
```

The notebook is near the beginning, not the end.

### Walk through one example

Suppose a researcher proposes:

```text
failed_payments_last_7d
```

for subscription churn prediction. The decision is made:

```text
when customer opens the app
```

at time $$t$$. The feature definition becomes:

$$
F(customer,t)
=
\sum_i
1[
t-7d\le t_i<t
\land
status_i=failed
]
$$

#### Step 1: Define the source

Source:

```text
payment_attempts
```

You establish:

```text
status = failed
means payment provider returned a final failure

event_time
means provider attempt time

arrival_time
means warehouse ingestion time
```

#### Step 2: Define historical semantics

For training at prediction time $$t$$:

```text
use payment attempts available before t
```

Depending on desired fidelity, perhaps:

$$
arrival\_time \le t
$$

as well as:

$$
event\_time < t
$$

#### Step 3: Define online computation

Instead of querying seven days of payments during every app request, precompute the count every five minutes. Store:

```text
customer_id
failed_payments_last_7d
updated_at
```

#### Step 4: Define freshness

Require:

$$
prediction\_time-updated\_at \le 10\text{ minutes}
$$

Otherwise use a fallback.

#### Step 5: Define missing semantics

Brand-new customer with no payments:

```text
value = 0
```

Feature lookup failure:

```text
not equivalent to 0
```

perhaps handled separately.

#### Step 6: Backfill training

For each historical prediction:

$$
F(customer,t)
$$

uses only the seven-day history that ended immediately before that particular $$t$$.

#### Step 7: Validate

Check:

```text
value >= 0
NULL rate approximately 0
distribution plausible
historical timestamps ≤ prediction timestamps
```

#### Step 8: Compare online/offline paths

Take live predictions and reconstruct:

```text
online value vs historical pipeline value
```

Measure mismatch.

#### Step 9: Publish version

```text
failed_payments_last_7d:v1
```

Model metadata records:

```text
churn_model_v8 uses v1
```

#### Step 10: Monitor

Track:

```text
freshness
missingness
distribution
lookup latency
online/offline mismatch
```

Now the feature is genuinely productionized.

### What makes a notebook feature fail in production?

Common reasons include:

#### It depends on future information

Excellent offline performance, impossible online.

#### It takes too long to compute

Useful mathematically, incompatible with serving latency.

#### The source meaning is unclear

Code works, semantics drift.

#### Offline and online implementations diverge

Training-serving skew appears.

#### Historical values cannot be reconstructed

Backtesting and retraining become unreliable.

#### Freshness is undefined

Models consume stale values without realizing it.

#### Missing values behave differently between training and serving

Production distribution differs from training.

#### Semantic changes are made in place

Existing models receive a feature they were never trained on.

#### Nobody owns the upstream path

Failures persist because responsibility is unclear. These are commonly systems problems rather than modeling problems.

### A practical production feature contract

For every important production feature, the team should be able to complete a record like this:

| Question                  | Example                                       |
| ------------------------- | --------------------------------------------- |
| Name                      | `failed_payments_last_7d`                     |
| Version                   | v1                                            |
| Entity                    | customer                                      |
| Meaning                   | final failed payment attempts in prior 7 days |
| Prediction-time semantics | window ends immediately before prediction     |
| Source                    | payment attempts                              |
| Source owner              | payments team                                 |
| Data type                 | integer                                       |
| Missing behavior          | zero only for true absence                    |
| Offline logic             | point-in-time aggregation                     |
| Online strategy           | precomputed every 5 min                       |
| Maximum age               | 10 min                                        |
| Serving SLA               | p99 < 10 ms                                   |
| Backfillable?             | yes                                           |
| Quality checks            | nonnegative, null rate, freshness             |
| Training-serving check    | live comparison                               |
| Consumers                 | churn_model_v8, v9                            |
| Owner                     | feature/ML platform team                      |
| Deprecation state         | active                                        |

This is far more useful than merely storing:

```text
feature_name = failed_payments_last_7d
```

### Features are interfaces between data and models

A source system speaks in terms such as:

```text
payments
orders
events
accounts
```

The model speaks in terms of:

```text
numbers
categories
embeddings
```

Features are the interface between them. Conceptually:

$$
\text{Real World}
\rightarrow
\text{Source Facts}
\rightarrow
\boxed{\text{Feature Contract}}
\rightarrow
\text{Model}
$$

If the contract changes unexpectedly, the model's interpretation of its input becomes unreliable. This is why production features should be treated almost like APIs.

### A feature is a time-dependent API

Imagine:

$$
F(entity,t)
$$

as an API call. For example:

```text
GetPurchaseCount30d(customer=42, as_of=10:00)
```

The API promises:

```text
stable meaning
defined time semantics
defined missing behavior
defined freshness
defined version
```

Training calls this API conceptually across historical times. Serving calls it at the current prediction time. The central requirement is that both receive the same semantic answer.

### Training-serving consistency can be expressed as an invariant

For an entity $$e$$ and prediction time $$t$$:

$$
\boxed{
F_{\text{offline}}(e,t)
\approx
F_{\text{online}}(e,t)
}
$$

provided both have access to the same information. That equation captures a large fraction of production feature engineering. If it doesn't hold, the model was trained on one world and deployed into another.

### The final system

Conceptually:

```text
                     SOURCE SYSTEMS
                          │
                          ▼
                historical source data
                          │
                          ▼
                Feature Definition vN
                     /          \
                    /            \
                   ▼              ▼
         historical computation  live computation
                   │              │
                   ▼              ▼
          training feature set   online values
                   │              │
                   ▼              ▼
                training       inference
                    \            /
                     \          /
                      ▼        ▼
                      ML MODEL
                         │
                         ▼
                    predictions
```

Around it you need:

```text
versioning
quality checks
lineage
freshness monitoring
ownership
backfills
deprecation
```

The difficult part is not computing $$F$$. It is preserving the contract around $$F$$.

#### What to remember

A production feature is not just a column. It is a **versioned, time-dependent data contract** between source systems and a model. At first principles, define it as:

$$
\boxed{
F(e,t)
=
\text{feature value for entity }e
\text{ using information legitimately available at }t
}
$$

Everything else follows from that definition. The feature must have a stable recipe:

$$
\boxed{\text{Feature Definition}}
$$

and independently generated values:

$$
\boxed{\text{Feature Values}}
$$

Historical training must respect:

$$
\boxed{
t_{\text{information}}
\le
t_{\text{prediction}}
}
$$

Training and serving should preserve:

$$
\boxed{
F_{\text{offline}}(e,t)
\approx
F_{\text{online}}(e,t)
}
$$

Live serving must satisfy:

$$
\boxed{
\text{freshness}
+
\text{latency}
+
\text{availability}
}
$$

and changes should create controlled feature versions rather than silently changing meaning. So the path from notebook to production is really:

$$
\boxed{
\text{idea}
\rightarrow
\text{precise semantics}
\rightarrow
\text{historically correct implementation}
\rightarrow
\text{serving strategy}
\rightarrow
\text{validation}
\rightarrow
\text{versioned publication}
\rightarrow
\text{monitoring}
}
$$

The deepest principle is:

> **A model does not consume "data in general." It consumes specific facts, transformed according to specific rules, as they were available at a specific moment.**

Production feature engineering supplies the definitions, pipelines, evidence, and operating controls needed to uphold that statement repeatedly under real serving constraints.

![Six controls for a safe production feature, followed by monitoring, backfill, and retirement responsibilities](/content-assets/articles/article-mlops-data-for-ml-systems-feature-engineering-in-production/production-feature-summary.png)

*A production feature needs clear meaning, known availability, historical correctness, serving parity, freshness control, and traceable versions throughout its lifecycle.*

## Check Your Answers

Use these answers to revisit the evidence, boundaries, and operating decisions behind each question.

:::expand[What Turns a Notebook Column into a Production Feature?]{kind="recap"}
A production feature has stable semantics, an entity and prediction-time boundary, governed sources, reproducible historical logic, a serving strategy, validation, versions, owners, service expectations, monitoring, backfill, and retirement policy. Predictive usefulness is necessary, while dependable delivery and preserved meaning determine whether a deployed model can use it.
:::

:::expand[How Does a Feature Contract Separate Meaning from Calculated Values?]{kind="recap"}
The definition records what the feature means, how it is calculated, and which version owns those semantics.

Values are separate results for particular entities and times. This separation lets teams recompute history, publish current state, compare implementations, and introduce a new version without silently redefining values consumed by existing models.
:::

:::expand[How Do Time Boundaries Keep Historical Feature Values Honest?]{kind="recap"}
The product decision identifies the action the model supports.

The entity identifies what each value describes. The prediction deadline limits which facts can arrive and how long computation may take. Together they decide the cutoff, freshness, serving latency, source availability, and whether a historically predictive idea is feasible in production.
:::

:::expand[How Can Offline and Online Implementations Preserve One Meaning?]{kind="recap"}
Historical computation evaluates the feature at each example's prediction time using explicit half-open windows, event and availability timestamps, historical dimensions, deterministic tie-breaking, and point-in-time joins. Backfills distinguish ideal event-time truth from the state production actually knew, and they never attach today's value to every old row.
:::

:::expand[How Do Freshness, Missingness, Latency, and Availability Shape Serving?]{kind="recap"}
Training may use warehouse SQL while serving uses materialized state, streaming counters, or request-time code.

Identical implementation is optional; semantic equivalence is required. Shared definitions, transformation libraries, test fixtures, source contracts, and paired comparisons protect both calculation logic and input semantics.
:::

:::expand[How Are Features Validated, Versioned, and Backfilled?]{kind="recap"}
The serving contract includes value timestamp, maximum age, lookup latency, availability, fallback, and distinct states for zero, unknown, absent history, stale value, lookup failure, and version mismatch.

Precomputation reduces request-time dependencies while accepting staleness. Reliability across many features also constrains how much live state a model should require.
:::

:::expand[How Do Shared Paths and Monitoring Keep Features Operable?]{kind="recap"}
Validation checks schema, domain, time, historical fixtures, and offline-online parity before publication.

Semantic changes create a new feature version and lineage records consuming models. Monitoring covers delivery and value behaviour by segment. Backfills recompute `F(entity, time)` for historical cutoffs and publish their evidence under an immutable version.
:::

:::expand[How Are Feature Dependencies Deprecated and Removed Safely?]{kind="recap"}
Lineage identifies every active and fallback model that still requires the feature version.

Deprecation blocks new consumers, preserves historical values as policy requires, migrates or retires existing consumers, verifies that no production route relies on it, and only then removes live infrastructure. A feature behaves like a versioned API to its models.
:::

## References

- [Polars lazy API](https://docs.pola.rs/user-guide/lazy/)
- [OpenLineage object model](https://openlineage.io/docs/spec/object-model/)
