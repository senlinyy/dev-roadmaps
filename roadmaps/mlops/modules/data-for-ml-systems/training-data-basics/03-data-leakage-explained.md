---
title: "Data Leakage"
description: "Learn how illegitimate information enters ML development, inflates evaluation, and fails at the real decision boundary."
overview: "Data leakage occurs when model development or evaluation receives information that the real decision could not legitimately use. This tutorial explains the major leakage paths, the reasoning needed to find them, and the industrial controls that prevent contaminated models from reaching production."
tags: ["MLOps", "core", "datasets"]
order: 3
id: "article-mlops-data-for-ml-systems-data-leakage-explained"
---

## Table of Contents

1. [What Is Data Leakage and Why Can It Improve Offline Metrics?](#what-is-data-leakage-and-why-can-it-improve-offline-metrics)
2. [How Do You Define the Information Allowed at a Prediction?](#how-do-you-define-the-information-allowed-at-a-prediction)
3. [How Do Target and Temporal Leakage Reveal Future Outcomes?](#how-do-target-and-temporal-leakage-reveal-future-outcomes)
4. [How Do Entity Overlap and Duplicate Cases Leak Across Splits?](#how-do-entity-overlap-and-duplicate-cases-leak-across-splits)
5. [How Do Preprocessing and Feature Selection Leak Evaluation Information?](#how-do-preprocessing-and-feature-selection-leak-evaluation-information)
6. [How Do Selection Processes and Repeated Test Use Contaminate Evaluation?](#how-do-selection-processes-and-repeated-test-use-contaminate-evaluation)
7. [How Do Row Traces and Adversarial Checks Find Plausible Leakage?](#how-do-row-traces-and-adversarial-checks-find-plausible-leakage)
8. [How Do Gates, Rebuilds, and Lineage Contain a Leakage Incident?](#how-do-gates-rebuilds-and-lineage-contain-a-leakage-incident)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A team builds a model to predict whether a payment will later be confirmed as fraud. One input says whether the transaction was refunded. Refunds frequently happen after investigators confirm fraud, so the model gets an excellent offline score. At payment time, however, the refund has not happened.

This is **data leakage**. Model development received information that the real decision could not use. The information may enter through a future field or a current table joined to an old event. It can also cross through related cases in different splits, preprocessing fitted too early, or repeated use of final test results.

Leakage is dangerous because it improves the evidence instead of breaking the pipeline. The query succeeds, the metric rises, and the released model loses the advantage it had during development.

Find those hidden information paths with these questions:

1. **What Is Data Leakage and Why Can It Improve Offline Metrics?**
2. **How Do You Define the Information Allowed at a Prediction?**
3. **How Do Target and Temporal Leakage Reveal Future Outcomes?**
4. **How Do Entity Overlap and Duplicate Cases Leak Across Splits?**
5. **How Do Preprocessing and Feature Selection Leak Evaluation Information?**
6. **How Do Selection Processes and Repeated Test Use Contaminate Evaluation?**
7. **How Do Row Traces and Adversarial Checks Find Plausible Leakage?**
8. **How Do Gates, Rebuilds, and Lineage Contain a Leakage Incident?**

## What Is Data Leakage and Why Can It Improve Offline Metrics?

<!-- section-summary: Data leakage gives development or evaluation information that the real decision could not legitimately use. -->

Data leakage happens when an ML system learns from **information it would not legitimately have when making the real prediction**. The information can enter through features, time joins, dataset splits, preprocessing, duplicates, or repeated human use of test results. All of those cases break the same rule:

$$
\boxed{
\text{Data leakage = information crossing a boundary that was supposed to keep it unavailable}
}
$$

Start by naming the boundaries, because leakage is always information crossing one that should have held.

### The real prediction situation

Suppose a bank wants to predict:

At the moment a customer applies for a loan, will they default within the next 12 months?

At application time $$t$$, the bank might legitimately know:

$$
X_t =
\{
income,\ credit\ history,\ existing\ debt,\ loan\ amount,\ldots
\}
$$

But it does not yet know:

$$
Y =
\text{whether the customer defaults later}
$$

The production problem is therefore:

$$
X_t \rightarrow Y_{future}
$$

Training reconstructs historical versions of this situation:

$$
\text{what was knowable at }t
\rightarrow
\text{what eventually happened}
$$

The central constraint is:

$$
\boxed{
\text{The training model should not receive information that its production counterpart would not have.}
}
$$

Leakage violates that constraint.

### Why leakage is so dangerous

Suppose we accidentally add this feature:

```text
days_past_due_after_loan
```

to the loan-default model. A customer who eventually defaults may have:

```text
days_past_due_after_loan = 90
```

A customer who does not default may have:

```text
days_past_due_after_loan = 0
```

The model learns something like:

$$
days\_past\_due > 60
\Rightarrow
default
$$

Offline evaluation may look incredible. Perhaps:

$$
AUC=0.99
$$

But at application time, there are no overdue payments yet because the loan does not even exist. So in production the feature is unavailable. The model looked intelligent only because the historical dataset allowed it to see the future.

This is the characteristic danger of leakage:

$$
\boxed{
\text{Leakage frequently makes a bad system look unusually good.}
}
$$

A normal bug may lower your metrics. Leakage can increase them. That makes leakage particularly deceptive.

### Leakage is fundamentally an information-flow problem

It helps to stop thinking about leakage as merely:

"A bad column accidentally entered my CSV."

There are several boundaries through which information can improperly flow. For one prediction example:

```text
PAST / PRESENT                  FUTURE
information available          outcome not known yet

features                         label
────────────── prediction time ──────────────>
```

For model development:

```text
DEVELOPMENT                     FINAL EVALUATION

train + validation              test
────────────── boundary ─────────────────────>
```

For independent entities:

```text
TRAINING GROUPS                 TEST GROUPS

patients seen in training       genuinely unseen patients
────────────── boundary ─────────────────────>
```

For preprocessing:

```text
TRAIN DATA                      TEST DATA

fit statistics here             only apply them here
────────────── boundary ─────────────────────>
```

Leakage occurs when information crosses one of these boundaries improperly.

## How Do You Define the Information Allowed at a Prediction?

<!-- section-summary: The prediction contract names the entity, decision time, action, target window, population, and facts available under product and legal rules. -->

### First define what the model is allowed to know

Before looking for leakage, define the prediction contract. Suppose the task is:

At 10:00 AM, when a transaction is submitted, predict whether it will later be confirmed as fraudulent.

You should be able to define:

$$
t_p = \text{prediction timestamp}
$$

Then every feature $$x_j$$ should satisfy something like:

$$
available\_time(x_j) \le t_p
$$

The word **available** matters. Suppose a merchant transaction occurs at:

```text
09:58
```

but arrives in your serving system at:

```text
10:03
```

If prediction happens at:

```text
10:00
```

the model cannot use it. Even though the event happened before prediction, the model did not know it yet. So a more precise rule is:

$$
\boxed{
t_{\text{available}}(x)
\le
t_{\text{prediction}}
}
$$

not merely:

$$
t_{\text{event}}
\le
t_{\text{prediction}}
$$

This distinction becomes essential in real production systems.

### Event time, update time, and availability time

Historical databases frequently make time more complicated than it first appears. Imagine a support ticket:

```text
Ticket created:          March 1
Customer cancelled:     March 8
Ticket closed:           March 10
Final resolution added:  March 10
```

Suppose the model predicts churn on March 3. The ticket itself existed. But the value:

```text
final_resolution = "customer cancelled"
```

did not. If today's database stores:

```text
ticket_created = March 1
final_resolution = customer_cancelled
```

and you merely join that row into a March 3 training example, you leak the future. This is why historical ML systems frequently need to know not just:

"When was the record created?"

but:

"When did this particular value become knowable?"

### Seven major ways leakage enters ML development

A useful taxonomy is the following:

1. **Target leakage:** a feature directly or indirectly reveals the outcome.
2. **Temporal leakage:** information from after prediction time enters historical features.
3. **Entity leakage:** related examples cross train/test boundaries, allowing recognition or memorization.
4. **Preprocessing leakage:** statistics or transformations are learned using validation/test data.
5. **Duplicate leakage:** identical or near-identical cases appear on both sides of an evaluation boundary.
6. **Selection or pipeline leakage:** the process used to create examples, labels, or features depends on future outcomes.
7. **Evaluation leakage:** test-set results repeatedly influence model development.

These frequently overlap. A single feature can cause both target leakage and temporal leakage, for example.

![Allowed and forbidden signals separated by the real-world prediction moment](/content-assets/articles/article-mlops-data-for-ml-systems-data-leakage-explained/information-boundary.png)

*The information boundary blocks future events, final outcomes, and post-decision fields from flowing backward into an earlier prediction.*

## How Do Target and Temporal Leakage Reveal Future Outcomes?

<!-- section-summary: Target leakage exposes the answer or a downstream reaction to it. -->

### Target leakage: giving the model the answer

Suppose the target is:

$$
Y=
\mathbb{1}[\text{customer churns}]
$$

A feature like:

```text
cancellation_date
```

obviously leaks the target. But real leakage is frequently less obvious. Consider:

```text
account_closure_reason
refund_after_cancellation
retention_case_result
collection_agency_status
chargeback_reason
insurance_claim_outcome
final_diagnosis
```

These may all be strongly related to $$Y$$ because they are consequences of the event being predicted. You can think of the causal sequence as:

$$
X \rightarrow Y \rightarrow Z
$$

where:

* $$X$$ = legitimate pre-outcome information
* $$Y$$ = outcome
* $$Z$$ = information created because the outcome happened

If you predict $$Y$$ using $$Z$$:

$$
Z \rightarrow Y
$$

the model is reasoning backward from a consequence. That may work beautifully on historical records. It is useless before the event occurs.

### The causal-direction test

For every suspiciously predictive feature, ask:

"Does this information help cause or anticipate the event, or was it created because the event happened?"

Suppose you predict whether a customer will fail to make a payment. Feature:

```text
collection_agency_assigned = true
```

Why was the customer assigned to collections? Probably because payment problems already occurred. So:

$$
payment\ failure
\rightarrow
collections
$$

not:

$$
collections
\rightarrow
future\ payment\ failure
$$

Using collections information may therefore reveal the outcome. The feature can be correlated with the target while still being invalid. Correlation alone cannot tell you whether a feature belongs in the model.

### Leakage through post-outcome fields

A useful practical suspicion rule is:

Fields produced by workflows that happen after the target event deserve special scrutiny.

Suppose the target is fraud. Post-fraud workflows may generate:

```text
fraud_review_result
chargeback_reason
refund_status
investigator_notes
account_frozen
police_report_id
```

Suppose the target is hospital readmission. Post-readmission workflows may generate:

```text
readmission_discharge_summary
new_diagnosis
followup_procedure
readmission_ward
```

Suppose the target is churn. Post-churn workflows may generate:

```text
exit_survey
cancellation_reason
retention_offer_outcome
closed_account_status
```

These fields are tempting precisely because they predict the target so well. That is why they are dangerous.

### Time leakage: information from the future

Target leakage focuses on information related to the answer. Temporal leakage is broader. A feature may contain future information without directly encoding the target.

Suppose we predict churn on January 1. We create:

```text
customer_average_monthly_sessions
```

using the customer's entire history through August. Even if the feature never mentions churn, it contains information from:

```text
January → August
```

which was unavailable on January 1. Correct historical feature:

$$
avg\_sessions_{\le Jan1}
$$

Leaky feature:

$$
avg\_sessions_{\le today}
$$

This is temporal leakage.

### Aggregates are a common source of hidden time leakage

Imagine a user has transactions:

```text
Jan 3
Jan 20
Feb 4
Apr 12
Jun 8
```

Historical prediction:

```text
Feb 1
```

Feature:

```text
lifetime_transaction_count
```

Today's database says:

$$
5
$$

But on February 1 the correct count was:

$$
2
$$

The historical feature must satisfy:

$$
count_i(t)
=
\#\{events_i:e.time<t\}
$$

not:

$$
count_i(today)
$$

Any feature with words such as:

```text
total
lifetime
average
latest
current
ever
historical
```

deserves careful examination when building historical training examples.

### "Current" tables are particularly dangerous

Production databases frequently store the latest state:

| customer | status    | plan    | risk_level |
| -------- | --------- | ------- | ---------- |
| A        | cancelled | premium | high       |

Suppose you're constructing a training example from six months earlier. The current state may not equal the historical state. Perhaps back then:

```text
status = active
plan = basic
risk_level = low
```

A naive join gives the historical row information from the future. This is why current-state tables are not automatically suitable for historical ML training. You frequently need:

* historical snapshots
* event logs
* change-data-capture records
* versioned tables
* valid-from / valid-to histories

so you can reconstruct the state **as of prediction time**.

### Point-in-time correctness

This leads to one of the most important ideas in ML data engineering. A feature is **point-in-time correct** if its historical value matches what the model could actually have known at that historical prediction moment. Suppose:

$$
t_p = 2025\text{-}04\text{-}03\ 12{:}00
$$

A valid feature generation process computes:

$$
X(t_p)
=
F(\text{records available by }t_p)
$$

not:

$$
X(t_p)
=
F(\text{database as it exists today})
$$

The difference looks subtle in code. Statistically it can completely invalidate the model.

### Late-arriving data creates another temporal problem

Suppose a payment occurs at 9:00. Your feature store receives the event at 9:20. The model predicts at 9:10.

Historical warehouse:

```text
payment_time = 09:00
```

If you reconstruct training using only payment time, you may include it. But the production model at 9:10 would not have seen it. So sometimes historical correctness requires:

$$
ingestion\_time \le prediction\_time
$$

rather than merely:

$$
event\_time \le prediction\_time
$$

This matters especially for:

* streaming systems
* partner feeds
* fraud data
* delayed labels
* financial transactions
* mobile telemetry
* periodically refreshed warehouse tables

### Backfilled data can make history look cleaner than it really was

Imagine a customer's country was missing on January 1. In March, the data pipeline repairs historical records. Today's table shows:

```text
country = UK
```

for January. If the model at the real January prediction time did not know the country, then training with the repaired value gives the historical model an information advantage over production. This leads to a subtle question:

Are we reconstructing what was objectively true, or what the production system actually knew?

For serving-parity evaluation, you commonly care about:

$$
\boxed{\text{what the system knew}}
$$

because that is what the deployed model will experience.

## How Do Entity Overlap and Duplicate Cases Leak Across Splits?

<!-- section-summary: Repeated entities let a model memorize stable identity patterns across partitions. -->

### Entity leakage: unseen row does not necessarily mean unseen case

Suppose your dataset contains monthly rows for customers. Customer 817 appears:

```text
Jan
Feb
Mar
Apr
May
```

A random row split might produce:

```text
Jan → train
Feb → train
Mar → test
Apr → validation
May → train
```

Technically the March row is not in training. But the model has already seen the same customer multiple times. Features such as:

```text
postcode
company
device_type
subscription_plan
historical behavior
```

may allow it to recognize that customer. Your test score may therefore measure:

"Can the model predict another observation from someone it already knows?"

while production might require:

"Can it generalize to new customers?"

That is entity leakage relative to the intended evaluation problem.

### The right question is not "Are the rows different?"

The right question is:

"How independent are the underlying cases?"

Rows can have different IDs while sharing almost all meaningful information. Examples include:

$$
\text{same patient, different visits}
$$

$$
\text{same user, different sessions}
$$

$$
\text{same household, different family members}
$$

$$
\text{same machine, different measurements}
$$

$$
\text{same document, different chunks}
$$

$$
\text{same video, different frames}
$$

$$
\text{same product, different images}
$$

If production requires generalization across those units, the entire group should commonly stay in one split.

### Grouped splitting prevents this kind of leakage

Suppose patients have many observations. Define:

$$
split(patient\_id)
$$

rather than:

$$
split(row\_id)
$$

Then:

$$
patient_i \in train
\Rightarrow
patient_i \notin validation,test
$$

This preserves a stronger boundary. The appropriate grouping variable follows from the deployment question. If production sees existing users again, user overlap may be perfectly valid.

If production sees entirely new users, it is not. Leakage is always relative to what the model is supposed to know.

### Duplicate leakage

Suppose your training set contains an image of a damaged engine. Your test set contains the exact same image under another filename. The model scores correctly.

Did it generalize? Not really. It may have memorized the example.

Exact duplication can happen because of:

* repeated ingestion
* multiple databases containing the same record
* resampled files
* copied documents
* mirrored websites
* shared attachments

You need to reason about identity beyond primary keys.

### Near-duplicates can be harder than exact duplicates

Suppose training contains:

```text
"The central bank increased interest rates by 0.25 percentage points..."
```

and test contains a syndicated news copy with almost identical wording. Different URL. Different record ID.

Nearly identical information. Or training contains:

```text
frame 1024 of a video
```

and test contains:

```text
frame 1025
```

Technically different images. Practically almost identical. Or medical data contains two scans taken seconds apart.

Near-duplicate leakage makes memorization look like generalization. So the grouping unit might need to be:

$$
document\ cluster
$$

rather than document. Or:

$$
video
$$

rather than frame. Or:

$$
study
$$

rather than individual medical image.

## How Do Preprocessing and Feature Selection Leak Evaluation Information?

<!-- section-summary: Imputation, scaling, encoding, vocabulary creation, target encoding, PCA, embedding learning, and feature selection all learn from data. -->

### Preprocessing can leak information too

Suppose you standardize income:

$$
z=
\frac{x-\mu}{\sigma}
$$

You calculate:

$$
\mu,\sigma
$$

using the entire dataset. Then split into:

```text
train
validation
test
```

The test data influenced:

$$
\mu,\sigma
$$

which are then used to transform the training data. The model has indirectly learned something about the test distribution. The correct approach is:

$$
\mu_{train}
=
mean(X_{train})
$$

$$
\sigma_{train}
=
std(X_{train})
$$

Then:

$$
z_{train}
=
\frac{x-\mu_{train}}{\sigma_{train}}
$$

The fitted transformation is then reused unchanged for validation and test data.

### "Fit on train, apply everywhere else"

This is a useful general rule. Any preprocessing step that **learns parameters from data** should be treated like part of model training. Consider suppose a transformation is:

$$
T_\phi(X)
$$

where $$\phi$$ is estimated from data. Then:

$$
\phi
=
Fit(X_{train})
$$

and:

$$
X'_{train}=T_\phi(X_{train})
$$

$$
X'_{val}=T_\phi(X_{val})
$$

$$
X'_{test}=T_\phi(X_{test})
$$

The validation and test sets may be transformed. They just should not determine $$\phi$$.

### Many things count as learned preprocessing

This includes more than normalization. For example:

```text
mean/median imputation
category vocabularies
rare-category grouping
PCA
feature selection
target encoding
text vocabulary construction
embedding learning
normalization statistics
outlier thresholds derived from data
dimensionality reduction
```

A common mistake is:

```text
clean everything
engineer everything
fit everything
then split
```

The safer conceptual order is:

$$
split
\rightarrow
fit\ transformations\ on\ training
\rightarrow
apply\ to\ validation/test
$$

### Target encoding creates especially direct leakage risk

Suppose categorical feature:

```text
merchant_id
```

We replace each merchant with:

$$
merchant\_fraud\_rate
$$

If we calculate the rate using all rows, then each row's own target can influence its feature value. For merchant $$m$$:

$$
rate_m
=
\frac{\sum_{i:merchant_i=m}y_i}
{N_m}
$$

Then row $$j$$'s own $$y_j$$ contributes to the value used to predict $$y_j$$. This is leakage. Safe target encoding generally requires careful out-of-fold or past-only construction.

The feature calculation must satisfy this requirement:

$$
feature_i
\text{ must not be computed using }y_i
$$

or other labels that would not legitimately have been known.

### Feature selection can leak too

Suppose you have 100,000 candidate features. Before splitting, you calculate correlation with the target across all data. You select the 50 best.

Then train on the training subset and evaluate on test. The training algorithm never saw test labels directly. But feature selection did.

So the test outcomes influenced which variables survived. The model-development process therefore used the test set. The correct conceptual structure is:

$$
\text{feature selection}
\subset
\text{training/development pipeline}
$$

not:

$$
\text{dataset preparation before evaluation boundaries exist}
$$

![Three questions about time, cause, and data history used to investigate a suspicious feature](/content-assets/articles/article-mlops-data-for-ml-systems-data-leakage-explained/leakage-diagnostic-questions.png)

*Tracing availability, causal order, and field creation reveals whether a feature carried knowledge that the live model could never possess.*

## How Do Selection Processes and Repeated Test Use Contaminate Evaluation?

<!-- section-summary: People can transmit protected answers through feature design, row repair, query selection, annotation context, model choice, and repeated benchmark use. -->

### Evaluation leakage: the test set can leak through humans

Suppose you have a perfect test set. You train Model A:

$$
test\ AUC=0.82
$$

You inspect test failures. Then change features. Model B:

$$
0.85
$$

Inspect test failures again. Change architecture. Model C:

$$
0.87
$$

Repeat 100 times. You have not trained gradient descent directly on test examples. But the test results repeatedly influenced development.

Eventually:

$$
\boxed{\text{the developers become part of the optimization algorithm}}
$$

The test set has become a validation set.

### Why repeated tuning overfits evaluation data

Imagine 1,000 equally good candidate models. Because test metrics contain random noise, some model will happen to perform unusually well. If you choose:

$$
M^*
=
\arg\max_i Score(M_i,D_{test})
$$

you have selected partly based on test noise. As the number of attempts grows, the probability of exploiting peculiarities of that specific test sample increases. This is conceptually similar to ordinary overfitting.

Ordinary training:

$$
model \text{ adapts to train}
$$

Repeated test-driven development:

$$
development\ process \text{ adapts to test}
$$

### Test labels are not the only source of evaluation leakage

Even knowing certain details about the test population can influence development. For example:

"Most test failures are premium customers."

You add premium-specific features.

"Hospital C is particularly difficult."

You add hospital-specific normalization.

"Test users mostly use Android."

You optimize for Android. Each may be reasonable from a product perspective. But if those decisions were driven by the held-out test set, that set is no longer untouched evidence.

You may need fresh evaluation data afterward.

### Selection leakage can happen before training

Suppose your original population contains 1 million customers. You build your dataset by selecting only customers who:

```text
have a known churn outcome
```

But whether the outcome becomes known may itself depend on future behavior. Consider perhaps certain records are complete only after cancellation. Then the selection rule:

$$
include\ row
$$

contains information about $$Y$$. This can change the population you train and evaluate on. Leakage can therefore occur through:

$$
\text{which examples exist}
$$

not merely through feature columns.

### Filtering using the outcome can distort the task

Imagine you want to predict hospital mortality. You remove:

```text
patients with incomplete 30-day follow-up
```

But follow-up completeness may correlate with survival, transfer status, socioeconomic circumstances, or hospital. Now the dataset population may differ systematically from production. Or suppose you predict customer churn but include only customers with:

```text
completed exit survey OR still active
```

Churned customers without exit surveys vanish. The model sees an artificially selected reality. This is sometimes closer to **selection bias** than classic leakage, but the distinction is less important operationally than asking:

"Did future/outcome information influence which historical examples were included?"

### Leakage can happen through labels themselves

Suppose you predict fraud. The label is generated from:

```text
manual investigator result
```

But investigators are shown the output of an earlier fraud model. Then your label-generation process depends partly on previous model predictions. Now your new model may be learning:

$$
\text{what the old model caused investigators to examine}
$$

rather than:

$$
\text{ground-truth fraud}
$$

Although this may fall outside the narrow textbook definition of leakage, it reveals a broader truth:

The data-generating process matters.

Historical labels are not automatically neutral observations of reality.

### A model can learn the old policy instead of the desired outcome

Suppose loan applications were historically approved only when an old credit score exceeded 700. You observe repayment outcomes only for approved loans. Now you train a model to predict repayment.

The dataset mostly contains:

$$
score>700
$$

You have little evidence about:

$$
score\le700
$$

This is a selective-label problem. Some information problems fall outside the exact definition of leakage, yet leakage investigations frequently uncover these neighboring issues. The deeper question remains:

"What information does this dataset actually permit us to learn?"

## How Do Row Traces and Adversarial Checks Find Plausible Leakage?

<!-- section-summary: Row traces reconstruct what one decision could know, while source lineage explains how every feature was created. -->

### Time, cause, and data history are three powerful leakage tests

When investigating any suspicious feature $$Z$$, ask three questions.

#### Time

When did $$Z$$ become available?

$$
t_Z \le t_{prediction}\ ?
$$

If not, it leaks future information.

#### Cause

Why does $$Z$$ exist? Did it precede the outcome, or was it created because the outcome happened?

$$
Z \rightarrow Y
$$

versus:

$$
Y \rightarrow Z
$$

The second direction is suspicious.

#### Data history

Is the value we see today the same value the system would have seen historically? Was it:

* updated later
* corrected
* backfilled
* overwritten
* enriched
* derived from later events

These three questions catch a surprisingly large fraction of leakage problems.

### Feature names are not enough

Suppose feature:

```text
customer_risk_score
```

Sounds legitimate. But what creates it? Perhaps:

```text
risk_score
=
function(
fraud_review_result,
chargeback_status,
account_investigation
)
```

Then it leaks. Or:

```text
customer_health_index
```

might use laboratory results taken after the prediction date. Or:

```text
seller_quality_score
```

might be recalculated retroactively using future complaints. You cannot determine leakage from a column name. You need lineage:

$$
source\ records
\rightarrow
transformation
\rightarrow
feature
$$

### Suspiciously good performance should trigger investigation

Suppose baseline AUC:

$$
0.67
$$

Then a new feature raises it to:

$$
0.98
$$

That can happen legitimately. But it deserves scrutiny. Ask:

Why does this feature know so much?

Perhaps the feature is:

```text
fraud_case_status
```

or:

```text
final_account_state
```

or:

```text
refund_processed
```

A huge jump is not proof of leakage. It is a reason to investigate lineage and timing carefully.

### Leakage can produce absurdly strong single features

A useful diagnostic is to train tiny models or inspect individual relationships. Suppose:

$$
P(Y=1\mid Z=1)=0.997
$$

and:

$$
P(Y=1\mid Z=0)=0.001
$$

Maybe $$Z$$ is genuinely that informative. But you should understand **why**. Good leakage analysis is not:

"High correlation means remove it."

It is:

"High correlation means understand its causal and temporal origin."

### Missing values can leak outcomes

Suppose a test is ordered only after clinicians suspect a disease. You use:

```text
test_result
```

as a feature. Missing test result itself may tell the model:

The doctor did not suspect the disease.

Or imagine cancellation forms only exist for customers entering a churn workflow. Feature:

```text
cancellation_reason
```

Even if you fill missing values with:

```text
UNKNOWN
```

the distinction:

$$
missing \quad vs \quad nonmissing
$$

may encode the target. Removing explicit values does not necessarily remove leakage if the **presence of the field** reveals the outcome.

### Nullness can be a feature whether you intend it or not

Suppose:

```text
refund_amount = NULL
```

for normal transactions and populated only after fraud claims. You remove the actual refund amount but keep:

```text
has_refund_amount
```

You've preserved much of the same leaked information. Even some model libraries automatically treat missingness as predictive. So ask:

Why is this value missing or present?

Missing-data patterns themselves have causes. Those causes can occur after the target.

### IDs can become leakage channels

Suppose case IDs are generated sequentially. A system changed behavior midway through the dataset. Then:

$$
case\_id
$$

may implicitly encode:

$$
time
$$

Or customer IDs might reveal:

* geography
* account type
* acquisition channel
* generation date

A model might exploit that encoding. Likewise file paths can contain:

```text
/fraud_cases/
/non_fraud_cases/
```

while the path is accidentally passed to the model. Identifiers should commonly be treated as metadata unless there is a strong reason otherwise.

### Data provenance can leak labels

Machine-learning datasets are frequently assembled from separate sources:

```text
positive_examples/
negative_examples/
```

Suppose positive images came from one camera and negative images from another. The model may learn:

$$
camera\ type
$$

instead of the intended concept. For example:

```text
disease cases → Hospital A scanner
healthy cases → Hospital B scanner
```

The model predicts the scanner. The scanner predicts the dataset's label. Offline accuracy is high.

Deployment at Hospital C fails. This is sometimes called **shortcut learning** or confounding rather than leakage, but the benchmark is misleading for the same reason:

$$
\text{model receives information that makes the benchmark easier than the real task}
$$

### Leakage and shortcuts are related but not identical

A useful distinction: **Leakage** The model has access to information that should have been unavailable.

Example:

```text
future cancellation status
```

**Shortcut learning** The information is legitimately present, but the model exploits a correlation that will not reliably hold in deployment. Example:

```text
hospital scanner type
```

Both can create:

$$
high\ offline\ performance
$$

with:

$$
poor\ production\ performance
$$

Leakage is mostly about violated information boundaries. Shortcut learning is more broadly about unstable correlations.

### Time-based splitting can reduce some leakage, but not all

Suppose:

```text
Train = 2024
Test  = 2025
```

This helps prevent future examples from entering training. But a historical 2024 row can still contain:

```text
current_customer_status
```

computed in 2026. Then the training feature itself leaks future state. So:

$$
\boxed{
\text{correct temporal split}
\not\Rightarrow
\text{point-in-time-correct features}
}
$$

You need both.

### Group splitting can reduce entity leakage, but not temporal leakage

Similarly, suppose each customer belongs to exactly one split. Good. But features for training customers could still use future behavior.

So there are independent dimensions:

$$
\text{feature-time correctness}
$$

$$
\text{entity separation}
$$

$$
\text{preprocessing isolation}
$$

$$
\text{evaluation isolation}
$$

Passing one does not imply passing the others.

### Leakage prevention should start before model training

Many teams treat leakage as a model-review concern:

"Let's inspect feature importance before deployment."

That's too late. A better architecture builds constraints into the data pipeline. Conceptually:

```text
define prediction timestamp
        ↓
construct eligible historical examples
        ↓
perform point-in-time feature joins
        ↓
construct future labels separately
        ↓
assign stable splits
        ↓
fit preprocessing on training only
        ↓
train and validate
        ↓
locked final evaluation
```

Preventing leakage is easier after the pipeline architecture mirrors the information boundaries.

### Features and labels should often be built separately

A useful conceptual separation is:

$$
FeatureBuilder(entity,t)
$$

and:

$$
LabelBuilder(entity,t)
$$

Feature builder can access:

$$
data\ available\ at\ or\ before\ t
$$

Label builder can inspect:

$$
future\ outcome\ window
$$

For example:

$$
Y_t=
\mathbb{1}
[
cancel\in(t,t+30d]
]
$$

The feature system should not receive that future window. The control prevents accidental joins where outcome data becomes ordinary feature columns.

### Point-in-time joins are a core engineering tool

Suppose customer plan changes over time:

| customer | plan    | valid_from |
| -------- | ------- | ---------- |
| A        | basic   | Jan 1      |
| A        | premium | Mar 10     |
| A        | basic   | Jul 4      |

Prediction:

```text
February 20
```

Correct plan:

```text
basic
```

Prediction:

```text
April 20
```

Correct plan:

```text
premium
```

The historical join should retrieve:

$$
\max(valid\_from)
$$

subject to:

$$
valid\_from \le prediction\_time
$$

This is an **as-of** or **point-in-time join**. Naively joining today's current customer row would leak later changes.

### Windows need explicit boundaries

Suppose feature:

```text
transactions_last_30_days
```

At prediction time $$t$$, define it precisely:

$$
transactions\in[t-30d,t)
$$

Using:

$$
[t-30d,t+1d)
$$

by accident may include transactions occurring after prediction time. Likewise an SQL condition such as:

```sql
event_date <= prediction_date
```

can be dangerous if predictions happen midday and `event_date` has only day-level precision. Time zones, inclusive bounds, and timestamp truncation can all create accidental future access. Leakage sometimes hides in a one-character inequality.

### Historical feature computation should be replayable

A strong design principle is:

Given a historical prediction timestamp, can we reconstruct exactly what the serving system would have seen?

For example:

$$
Replay(customer,t)
\rightarrow
X_t
$$

If historical training features are produced one way and serving features another, leakage and training-serving skew become much harder to detect. Shared feature definitions, temporal warehouses, feature stores, or carefully versioned transformations can help. The technology is secondary.

The important property is reproducible point-in-time semantics.

### Leakage checks should be semantic, not just statistical

You can run automated checks such as:

```text
no feature timestamp > prediction timestamp
no customer crosses group split
no duplicate hash crosses split
test IDs absent from training
```

Those are valuable. But consider:

```text
retention_case_opened = true
```

Timestamp:

```text
before prediction time
```

So a temporal check passes. Yet perhaps a retention case is opened only when the customer has already requested cancellation. The feature is semantically leaking the answer.

No timestamp rule alone will detect that. You need knowledge of the business workflow.

### Statistical tests can assist semantic investigation

Suppose one feature dominates performance. You might compare:

$$
Performance(X)
$$

against:

$$
Performance(X\setminus Z)
$$

or train a model using only:

$$
Z
$$

If $$Z$$ almost perfectly predicts the target, investigate it. Similarly inspect feature-target relationships across time. Perhaps:

$$
corr(Z,Y)
$$

is enormous only after a pipeline change. These diagnostics can reveal suspicious features. But they cannot tell you whether the feature is legitimate.

For that you need lineage and semantics.

### One-row tracing is exceptionally powerful

Pick a positive training row:

```text
customer = C817
prediction_time = April 1
target = churned_next_30d = 1
```

Now reconstruct every feature from source data. Suppose:

```text
sessions_30d = 4
tickets_60d = 2
account_status = cancelled
```

Immediately ask:

Why does a customer being scored for future churn already have `account_status=cancelled`?

Trace the field. Perhaps it came from today's current-state customer table. You just found leakage.

Manual lineage inspection frequently reveals problems invisible in aggregate statistics.

### Trace negative and boundary examples too

Positive examples frequently expose obvious leakage, but other cases reveal different bugs. A recently matured negative can reveal incorrect label timing. An example immediately before an event can reveal inclusive-boundary leakage.

A customer with missing features can reveal backfill effects. A repeated entity can reveal split contamination. A row around daylight-saving or timezone boundaries can reveal timestamp errors.

Leakage prevention benefits from deliberately examining difficult cases.

### A useful adversarial question

For each feature, imagine you are the production model standing at the prediction time. Ask:

**Exactly how would I obtain this value right now?**

A valid answer might be:

"The event stream contains all payments processed up to this timestamp."

A suspicious answer might be:

"The warehouse has this field today."

Those are not equivalent. The first demonstrates availability. The second describes historical storage, not production knowledge.

### Check a case where the outcome never occurs

Suppose feature:

```text
case_resolution_code
```

Ask:

If the customer never churned, would this field ever be created?

If the answer is no, its existence likely reveals the target. Similarly:

```text
fraud_investigation_notes
```

Ask:

Would this record exist for a transaction that was never suspected or confirmed as fraud?

A field produced only after one particular outcome path may expose that outcome almost directly.

### Preprocessing must follow split boundaries

Suppose the development process is:

```text
raw examples
   ↓
split into train/val/test
   ↓
fit preprocessing on train
   ↓
train model
   ↓
select using validation
   ↓
evaluate once on test
```

This respects information direction. Contrast:

```text
raw examples
   ↓
normalize using all data
   ↓
select features using all labels
   ↓
deduplicate with knowledge of test
   ↓
split
```

Now information from future evaluation data has already entered the development process before the split even appears. The split must be reflected throughout the entire pipeline.

### Cross-validation has the same leakage rules

Suppose you perform five-fold cross-validation. For each fold:

$$
D=D_{\text{train fold}}\cup D_{\text{validation fold}}
$$

Preprocessing should be fitted anew inside each fold. For fold $$k$$:

$$
\phi_k=Fit(D^{(k)}_{\text{train}})
$$

Then apply:

$$
T_{\phi_k}
$$

to that fold's validation data. If preprocessing is fitted once on all data before cross-validation, validation information leaks into every training fold. This can make cross-validation scores optimistic.

### Grouped and temporal cross-validation matter too

If the same patient appears in several folds, ordinary CV can leak patient identity. If future months appear in training for earlier validation months, shuffled CV can leak time structure. So cross-validation does not automatically prevent leakage.

The fold construction must preserve the real independence boundary. For a forecasting problem, you might use:

$$
Jan-Mar \rightarrow Apr
$$

$$
Jan-Apr \rightarrow May
$$

$$
Jan-May \rightarrow Jun
$$

rather than arbitrary shuffled folds.

### Test-set access should be treated as privileged information

Conceptually, the test labels are answers to a final exam. You want the development process to proceed without them. A strong workflow might expose validation metrics freely during experimentation while restricting final test evaluation until release candidates are frozen.

The exact operational mechanism varies. The principle is:

$$
\boxed{
\text{the more independent the evaluation evidence, the more trustworthy it is}
}
$$

Repeated access consumes independence.

### Leakage can occur through feature debugging

Imagine an engineer is allowed to inspect raw test rows and labels. They notice:

```text
test positives frequently have missing feature Z
```

So they change missing-value handling. The test set influenced development. Even though the model never trained on those labels directly, evaluation information crossed the boundary.

This does not mean engineers should never inspect failures. It means that after using held-out failures to improve the model, that set should be considered development data, and truly independent evaluation should come from somewhere else.

### Leakage can be organizational

Suppose the same benchmark has existed for five years. Everyone knows:

* which examples are difficult
* which segments score poorly
* which features improve the benchmark
* which model families perform well

No one intentionally copied test labels into training. Still, the organization has gradually adapted to the benchmark. This is why long-running benchmarks can become overfit at the ecosystem level.

Fresh temporal holdouts are frequently valuable.

### Leakage checks should block release, not merely create warnings

Suppose your release pipeline detects:

```text
17 customer IDs overlap train and test
```

or:

```text
feature timestamp > prediction timestamp
```

If the integrity requirement says this is forbidden, the release should fail. Why? Because you do not know how much the reported metric is inflated.

A model with known leakage does not have:

$$
AUC=0.92
$$

in the meaningful sense. It has:

"AUC 0.92 under a contaminated evaluation."

The true deployment performance remains unknown.

### Leakage failures invalidate evidence

This is a critical operational principle. Suppose a model gets:

$$
accuracy=97\%
$$

Then you discover that 8% of test examples were duplicates of training examples. You cannot merely say:

"It's probably still around 95%."

You need to remove the contamination and re-evaluate. Leakage damages the **measurement process**, not just the model. Once the evidence is contaminated, it must be recreated.

## How Do Gates, Rebuilds, and Lineage Contain a Leakage Incident?

<!-- section-summary: Critical time, overlap, fitting-scope, and feature-legitimacy checks block publication. -->

### What to do after discovering leakage

The repair details depend on the source of leakage, while the recovery sequence follows the same basic order:

$$
identify\ contamination
$$

$$
\downarrow
$$

$$
find\ affected\ datasets,\ features,\ models
$$

$$
\downarrow
$$

$$
repair\ data\ construction
$$

$$
\downarrow
$$

$$
rebuild\ clean\ dataset
$$

$$
\downarrow
$$

$$
retrain
$$

$$
\downarrow
$$

$$
reevaluate\ on\ uncontaminated\ data
$$

Repeated debugging against the old test data can contaminate it too. In that case, evaluate on a fresh holdout instead of simply rerunning the familiar set.

### Do not merely delete the suspicious feature from the final model

Suppose:

```text
feature X
```

leaked the target. You remove it. Is everything now fine?

Maybe not. During development, X may have influenced:

* feature selection
* architecture
* thresholds
* hyperparameters
* which experiments were pursued
* which model family was chosen

If leakage materially influenced the development process, the safer approach is to rebuild the affected stages from clean data. Leakage can propagate downstream.

### Data lineage determines the blast radius

Suppose a corrupted feature was present in:

```text
dataset_v12
dataset_v13
dataset_v14
```

and those datasets trained:

```text
model_41
model_42
model_43
model_44
```

Without lineage, determining what must be rebuilt is painful. With lineage:

$$
source
\rightarrow
feature\ version
\rightarrow
dataset\ version
\rightarrow
training\ run
\rightarrow
model\ version
$$

you can identify affected artifacts precisely. Leakage prevention and reproducibility are therefore closely related.

### Version the split as well as the data

Suppose the dataset is unchanged, but someone modifies:

```text
split_policy
```

from:

```text
random row split
```

to:

```text
customer-group split
```

Metrics may fall dramatically. Nothing about the model necessarily got worse. The new evaluation is merely harder and more realistic.

So reproducibility should track:

$$
dataset\ version
$$

$$
split\ version
$$

$$
feature\ version
$$

$$
label\ version
$$

$$
training\ code\ version
$$

Without these, leakage investigations become guesswork.

### Leakage often explains mysterious production collapse

Suppose offline:

$$
AUC=0.96
$$

Production:

$$
AUC=0.68
$$

Possible explanations include:

* distribution shift
* training-serving skew
* bad labels
* monitoring errors
* leakage

One of the first leakage investigations should ask:

What information did the offline model receive that production did not?

Examples:

```text
historically corrected records
future events
latest database state
post-outcome workflow fields
test-derived preprocessing
duplicate cases
```

This comparison between offline and production information environments is frequently revealing.

### Training-serving skew and leakage are closely related

Suppose training feature:

$$
F_{train}(entity,t)
$$

is computed from a complete warehouse. Production feature:

$$
F_{serve}(entity,t)
$$

comes from a real-time system with delays. If:

$$
F_{train}
$$

includes data not actually available during serving, the problem is both:

$$
\text{training-serving skew}
$$

and potentially:

$$
\text{temporal leakage}
$$

Ideally:

$$
F_{train}(entity,t)
=
F_{serve}^{historical\ replay}(entity,t)
$$

or at least the two should obey identical availability semantics.

### Data leakage is not simply "using the target column"

That is the beginner's version. A more complete view is:

$$
\boxed{
\text{Leakage occurs whenever model development has access to information that makes evaluation easier than the real deployment problem.}
}
$$

That information might come from:

$$
future
$$

$$
outcome consequences
$$

$$
same entities
$$

$$
duplicates
$$

$$
test statistics
$$

$$
test labels
$$

$$
historical corrections
$$

$$
data-selection rules
$$

Different mechanisms, same fundamental failure.

### Think of leakage as forbidden arrows

Suppose the legitimate system is:

$$
Past\ X
\rightarrow
Prediction
\rightarrow
Future\ Y
$$

Training legitimately uses:

$$
Past\ X
\rightarrow
Model
$$

and separately observes:

$$
Future\ Y
$$

to compute loss. But leakage introduces arrows like:

$$
Future\ Y
\rightarrow
Feature
$$

or:

$$
Test\ Y
\rightarrow
Feature\ selection
$$

or:

$$
Test\ entity
\rightarrow
Training
$$

or:

$$
Test\ statistics
\rightarrow
Training\ preprocessing
$$

The job of leakage prevention is to remove forbidden information paths.

### A useful way to reason about the whole system

For every prediction example $$i$$, define an information set:

$$
\mathcal I_i(t)
$$

containing everything the production system legitimately knows at prediction time $$t$$. Then the model's features must satisfy:

$$
X_i \subseteq \mathcal I_i(t)
$$

The target:

$$
Y_i
$$

commonly lies outside that information set because it is not known yet. Now define the development information set:

$$
\mathcal D_{dev}
$$

which may contain training and validation examples. Final test labels should remain outside it:

$$
Y_{test}\notin\mathcal D_{dev}
$$

until final evaluation. Leakage is merely a violation of these allowed-information sets. This is perhaps the cleanest mathematical way to think about it.

### The release question should not be "Did we check for leakage?"

It should be more concrete:

"Can we explain why every major information path available during training and evaluation would also be legitimate under the deployment scenario?"

For features:

How was this value known at prediction time?

For history:

Is this the historical value, not today's corrected value?

For grouping:

Could the same underlying entity appear on both sides of the evaluation boundary?

For preprocessing:

Which rows determined this transformation?

For evaluation:

Have these test results influenced model design?

Those questions force leakage discussions into observable facts.

### A compact leakage investigation

When a model looks suspiciously good, I would examine four layers. At the **row level**, confirm that the target genuinely occurs after the prediction moment and every feature was actually available beforehand. At the **feature level**, trace highly predictive fields to their source systems and ask whether they are consequences of the outcome.

At the **dataset level**, inspect entity overlap, duplicates, near-duplicates, temporal ordering, and selection rules. At the **development level**, check preprocessing, feature selection, hyperparameter tuning, and test-set reuse. Together these cover most practical leakage channels.

### The connection to the previous two ideas

Training data construction asks:

$$
\boxed{
\text{Did we recreate the historical prediction situation correctly?}
}
$$

Dataset splitting asks:

$$
\boxed{
\text{Did we preserve independent evidence of generalization?}
}
$$

Data leakage is what happens when either answer becomes **no**. Inside an example:

$$
future
\rightarrow
features
$$

is leakage. Across examples:

$$
test\ information
\rightarrow
training/development
$$

is leakage. Across related entities:

$$
same\ underlying\ case
\rightarrow
both\ train\ and\ test
$$

can be leakage. So leakage is the unifying concept behind both **point-in-time correctness** and **split integrity**.

### Simulate ignorance faithfully

At prediction time, a real model is ignorant of the future. It does not know:

* whether the transaction becomes fraud
* whether the patient returns
* whether the customer cancels
* what next month's behavior looks like
* which test examples developers will later find difficult

That ignorance is not a defect. It is the problem the model exists to solve. A valid ML experiment must reproduce that ignorance.

Training is allowed to use historical outcomes to learn relationships. But it must do so without pretending that those outcomes were already available as evidence at prediction time. Evaluation is allowed to reveal answers after predictions are frozen.

But it should not allow those answers to influence the system being evaluated. The result gives the central principle:

$$
\boxed{
\text{A trustworthy ML experiment preserves the same information constraints the deployed model will face.}
}
$$

#### What to remember

Data leakage is best understood as an **information-boundary violation**. For a real prediction:

$$
\boxed{
\text{available information now}
\rightarrow
\text{unknown outcome later}
}
$$

Training should reconstruct:

$$
\boxed{
\text{information that was genuinely available then}
\rightarrow
\text{outcome observed afterward}
}
$$

And evaluation should preserve:

$$
\boxed{
\text{development information}
\;\;\big|\;\;
\text{independent evaluation information}
}
$$

Leakage happens when information crosses those boundaries in the wrong direction. The most obvious case is:

$$
target \rightarrow feature
$$

but production ML systems also need to defend against:

$$
future \rightarrow historical\ feature
$$

$$
test \rightarrow preprocessing
$$

$$
test\ labels \rightarrow model\ selection
$$

$$
same\ entity \rightarrow train\ and\ supposedly\ independent\ test
$$

$$
duplicate \rightarrow both\ sides
$$

$$
post\text{-}outcome\ workflow \rightarrow feature
$$

The most useful question is therefore not merely:

**"Does this dataset contain leakage?"**

It is:

**"For every piece of information that influenced this model, exactly when, why, and through what process did the system become allowed to know it?"**

When the team cannot explain that boundary for a key feature, preprocessing operation, split, or metric, the model's evaluation evidence remains incomplete.

![Prevention, detection, and recovery controls for keeping data leakage out of a model release](/content-assets/articles/article-mlops-data-for-ml-systems-data-leakage-explained/leakage-prevent-detect-recover.png)

*Leakage control spans time-aware data construction, realistic splits, train-only preprocessing, suspicious-result review, containment, rebuild, and re-evaluation.*

## Check Your Answers

Use these answers to revisit the evidence, boundaries, and operating decisions behind each question.

:::expand[What Is Data Leakage and Why Can It Improve Offline Metrics?]{kind="recap"}
Data leakage gives development or evaluation information that the real decision could not legitimately use.

Because the forbidden signal frequently predicts the answer strongly, metrics can improve instead of failing. The score then measures a privileged reconstruction of the past rather than performance under the production information boundary.
:::

:::expand[How Do You Define the Information Allowed at a Prediction?]{kind="recap"}
The prediction contract names the entity, decision time, action, target window, population, and facts available under product and legal rules. A feature is allowed only if its source, timestamp, causal role, transformation state, and delivery path let production produce the same evidence before that decision.
:::

:::expand[How Do Target and Temporal Leakage Reveal Future Outcomes?]{kind="recap"}
Target leakage exposes the answer or a downstream reaction to it.

Temporal leakage uses events, corrections, current state, or backfills unavailable at the historical cutoff. Event time and availability or system time must both support the row, and post-outcome fields require causal review even if their names look harmless.
:::

:::expand[How Do Entity Overlap and Duplicate Cases Leak Across Splits?]{kind="recap"}
Repeated entities let a model memorize stable identity patterns across partitions.

Exact and near duplicates expose nearly the same evidence on both sides. Grouping the real dependency unit and assigning whole information-equivalent clusters to one split produces an evaluation based on genuinely independent cases.
:::

:::expand[How Do Preprocessing and Feature Selection Leak Evaluation Information?]{kind="recap"}
Imputation, scaling, encoding, vocabulary creation, target encoding, PCA, embedding learning, and feature selection all learn from data.

They must fit on training rows inside each fold and only transform validation or test rows. Otherwise the held-back distribution or labels shape the representation before evaluation begins.
:::

:::expand[How Do Selection Processes and Repeated Test Use Contaminate Evaluation?]{kind="recap"}
People can transmit protected answers through feature design, row repair, query selection, annotation context, model choice, and repeated benchmark use.

Every result that guides development reduces that sample's independence. Recorded experiments, restricted test access, visible policy effects, and fresh holdouts preserve an honest final claim.
:::

:::expand[How Do Row Traces and Adversarial Checks Find Plausible Leakage?]{kind="recap"}
Row traces reconstruct what one decision could know, while source lineage explains how every feature was created.

Split comparisons, overlap reports, suspicious feature analysis, and adversarial questions identify places where future knowledge or identity may hide. Statistical signals guide investigation; timestamps and causal evidence establish the violation.
:::

:::expand[How Do Gates, Rebuilds, and Lineage Contain a Leakage Incident?]{kind="recap"}
Critical time, overlap, fitting-scope, and feature-legitimacy checks block publication.

After discovery, teams stop affected releases, trace the contaminated dataset to runs and endpoints, repair the earliest failed boundary, publish a new dataset identity, retrain, and evaluate on independent evidence. The incident adds a durable regression control.
:::

## References

- [OpenLineage documentation](https://openlineage.io/docs/)
- [Kaufman et al.: Leakage in Data Mining — Formulation, Detection, and Avoidance](https://doi.org/10.1145/2382577.2382579)
- [Kapoor and Narayanan: Leakage and the Reproducibility Crisis in ML-based Science](https://arxiv.org/abs/2207.07048)
- [Lee et al.: Deduplicating Training Data Makes Language Models Better](https://research.google/pubs/deduplicating-training-data-makes-language-models-better/)
