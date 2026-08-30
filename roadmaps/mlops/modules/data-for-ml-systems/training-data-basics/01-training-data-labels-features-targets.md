---
title: "Training Data: Examples, Features, Labels, and Targets"
description: "Turn a product decision into time-correct, traceable training examples with clear features, labels, targets, and dataset identity."
overview: "A supervised training dataset reconstructs past product decisions. Each row combines time-correct feature evidence with a mature outcome produced by documented label and target rules."
tags: ["MLOps", "core", "datasets"]
order: 1
id: "article-mlops-data-for-ml-systems-training-data-labels-features-targets"
---

## Table of Contents

1. [What Does One Training Example Represent?](#what-does-one-training-example-represent)
2. [How Do Eligibility and Grain Decide Which Cases Become Rows?](#how-do-eligibility-and-grain-decide-which-cases-become-rows)
3. [How Do Features Represent What Was Knowable at Prediction Time?](#how-do-features-represent-what-was-knowable-at-prediction-time)
4. [How Are Outcomes Turned into Labels and Training Targets?](#how-are-outcomes-turned-into-labels-and-training-targets)
5. [Why Must Pending and Unobserved Outcomes Stay Separate from Negative Labels?](#why-must-pending-and-unobserved-outcomes-stay-separate-from-negative-labels)
6. [How Do Time-Aware Feature Joins Prevent Future Information from Entering Rows?](#how-do-time-aware-feature-joins-prevent-future-information-from-entering-rows)
7. [How Does a Dataset Contract Turn a Product Question into an Executable Build?](#how-does-a-dataset-contract-turn-a-product-question-into-an-executable-build)
8. [How Do Versioning, Validation, and Row Traces Make Training Data Reproducible?](#how-do-versioning-validation-and-row-traces-make-training-data-reproducible)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

At 09:00, a support system has to decide whether a new ticket needs a specialist. At that moment it knows the ticket category, the customer's plan, the queue size, and earlier support history. The ticket is escalated at 16:00.

One training example should recreate the decision at 09:00. Its **features** contain facts available by that time. Its **label** records the later outcome. Its **target** is the exact value derived from that outcome for training. A private note written at 14:00 may help explain the escalation. It cannot be a model input because the live system did not know it at 09:00.

Building training data means repeating this process across many historical decisions. The team must define which cases belong, what one row represents, which clock separates inputs from outcomes, and when a delayed outcome is mature enough to label.

Build those rows by answering these questions:

1. **What Does One Training Example Represent?**
2. **How Do Eligibility and Grain Decide Which Cases Become Rows?**
3. **How Do Features Represent What Was Knowable at Prediction Time?**
4. **How Are Outcomes Turned into Labels and Training Targets?**
5. **Why Must Pending and Unobserved Outcomes Stay Separate from Negative Labels?**
6. **How Do Time-Aware Feature Joins Prevent Future Information from Entering Rows?**
7. **How Does a Dataset Contract Turn a Product Question into an Executable Build?**
8. **How Do Versioning, Validation, and Row Traces Make Training Data Reproducible?**

## What Does One Training Example Represent?

<!-- section-summary: One example represents one historical opportunity to make the product prediction. -->

A machine-learning model learns from **examples of the decisions or predictions we want it to make**. Everything else—rows, features, labels, targets, dataset versions, leakage checks—is machinery for expressing those examples correctly. A useful starting equation is:

$$
\text{information available now} \rightarrow \text{prediction about something not yet known}
$$

Training data reconstructs that situation from history:

$$
\text{information that was available then} \rightarrow \text{what eventually happened}
$$

That is the central idea.

### The prediction, not the data

Imagine a food-delivery company wants to predict:

"When an order is accepted by a courier, will it arrive more than 10 minutes late?"

At prediction time, perhaps we know:

* restaurant
* distance
* current traffic estimate
* courier location
* promised delivery time
* weather
* restaurant's historical preparation times

We do **not** yet know:

* actual delivery time
* whether the courier will get stuck in traffic
* whether the customer will complain
* whether the order will eventually be late

So the production problem has this form:

$$
X_t \rightarrow Y_{future}
$$

where:

* $$t$$ = prediction time
* $$X_t$$ = information available at time $$t$$
* $$Y_{future}$$ = outcome that becomes known later

Training data must reproduce exactly this relationship.

### What is a training example?

A **training example** is one historical instance of the prediction problem. Suppose order `O123` was accepted at 6:14 PM yesterday. At 6:14 PM the system knew:

| Information                      |   Value |
| -------------------------------- | ------: |
| Distance                         |  4.2 km |
| Restaurant average prep time     |  18 min |
| Traffic level                    |    High |
| Courier distance from restaurant |  1.1 km |
| Promised delivery time           | 6:52 PM |

Later, the order arrived at 7:08 PM. It was 16 minutes late. Therefore the historical example becomes approximately:

$$
(4.2,\ 18,\ \text{high},\ 1.1,\ldots) \rightarrow 1
$$

where:

$$
1 = \text{late}
$$

This is one **training example**. In a tabular dataset, it will commonly be represented as one **training row**.

### A training row describes one past prediction opportunity

People frequently say:

"Each row represents a customer."

That definition is commonly too vague. A better definition is:

> **Each training row represents one historical moment at which the model could have been asked to make its prediction.**

For the delivery model:

One row = one order at the moment a courier accepts it.

For a fraud model:

One row = one card transaction at authorization time.

For a churn model:

One row = one active customer at the beginning of a prediction period.

For a recommendation model:

One row might = one user-item impression at the time an item could be recommended.

For a hospital-readmission model:

One row might = one patient at discharge.

This definition matters enormously. Consider churn prediction. If you merely say:

"One row is one customer."

you immediately run into ambiguity. Which moment in the customer's history? A customer could have been:

* new in January
* highly active in March
* becoming inactive in June
* churned in August

Those represent very different prediction situations. A more precise definition might be:

One row represents one active subscriber at midnight on the first day of each month, and the model predicts whether they will cancel during the following 30 days.

Now the training example is unambiguous.

## How Do Eligibility and Grain Decide Which Cases Become Rows?

<!-- section-summary: Eligibility states which historical cases the production system would actually have considered. -->

### First define which cases become rows

Before deciding which columns to include, define the **unit of prediction**. Suppose we want to predict:

"Will a subscriber cancel during the next 30 days?"

We could construct examples monthly:

```text
customer  prediction_time
A         2026-01-01
A         2026-02-01
A         2026-03-01
B         2026-01-01
B         2026-02-01
...
```

Each `(customer, prediction_time)` pair is a different example. The row is therefore not merely:

$$
customer
$$

It is:

$$
(customer,\ prediction\ time)
$$

More generally, an example can be thought of as:

$$
e_i = (entity_i,\ prediction\_time_i)
$$

where `entity` could be:

* customer
* transaction
* order
* machine
* patient
* document
* search query
* user-item pair
* account
* shipment

This is sometimes called the **grain** or **unit of observation** of the dataset. If the grain is unclear, almost every downstream definition becomes unclear.

### Eligibility: not every historical case necessarily becomes a row

You also need to define which prediction opportunities count. Consider suppose the churn model is used only for:

* paying customers
* with accounts at least 30 days old
* who are not already cancelling
* in countries where the retention program operates

Then the historical dataset should generally reproduce those conditions. We can define an eligibility function:

$$
E(entity,t) =
\begin{cases}
1 & \text{if a prediction would have been made at time } t\\
0 & \text{otherwise}
\end{cases}
$$

Training examples should normally come from:

$$
E(entity,t)=1
$$

Rows outside that boundary teach the model from situations that cannot occur when it is actually used.

![One maintenance-prediction training row showing the entity and features available before prediction time, followed by the later label and target](/content-assets/articles/article-mlops-data-for-ml-systems-training-data-labels-features-targets/one-training-row.png)

*The row recreates one historical decision. Features capture what the system could know at prediction time, while the label and target come from an outcome observed later.*

## How Do Features Represent What Was Knowable at Prediction Time?

<!-- section-summary: Features encode evidence the deployed system could obtain before its decision deadline. -->

### What is a feature?

A **feature** is a piece of information given to the model when it makes a prediction. If the prediction is:

"Will this customer cancel during the next 30 days?"

features might include:

```text
days_since_signup
subscription_plan
payments_last_90_days
sessions_last_30_days
days_since_last_session
support_tickets_last_60_days
average_session_duration
```

Mathematically, the model receives a feature vector:

$$
x_i =
[x_{i1}, x_{i2}, ..., x_{ip}]
$$

For example:

$$
x_i =
[437,\ premium,\ 3,\ 7,\ 12,\ 2,\ 14.3]
$$

The model learns a function:

$$
f(x_i)
$$

Perhaps producing:

$$
f(x_i)=0.73
$$

meaning roughly:

Estimated probability of cancellation = 73%.

### Features are not simply "columns in a table"

This distinction is important. A database may contain hundreds of columns about a customer. That does **not** mean they are valid features.

Suppose a historical customer record contains:

```text
customer_id
signup_date
country
sessions_last_month
cancelled_date
refund_amount
cancellation_reason
retention_agent_notes
```

Some of those columns describe information that only became available **after cancellation**. They exist in the database today because we are looking backward. But they would not have existed when the model had to predict churn.

Therefore:

$$
\text{database field} \neq \text{valid feature}
$$

A valid feature must satisfy a stronger condition:

**Could the production system actually know this value at the prediction time?**

### Prediction time is the boundary between features and the future

Imagine a timeline:

```text
Past                       Prediction time                     Future
────────────────────────────────┼─────────────────────────────────>
                                 t
```

Feature information must normally come from:

```text
<= t
```

The target comes from:

```text
> t
```

So a training example has two fundamentally different regions:

```text
                  PREDICTION TIME
                       │
   FEATURE WINDOW      │       OUTCOME WINDOW
<──────────────────────┼────────────────────────>
                       │
                       t
```

For churn:

```text
<---- previous 30 days ---->|<------ next 30 days ------->
           features         |            label
                            t
```

For example:

```text
Prediction date: July 1

Features:
June 1–June 30 activity

Target:
Did cancellation happen July 1–July 30?
```

Drawing this timeline makes many training-data decisions easier to see and verify.

### Use only information available at prediction time

This sounds simple, but it is responsible for one of the most common ML failures: **data leakage**. Suppose we're predicting whether a loan applicant will default. A historical table might contain:

```text
income
credit_score
loan_amount
interest_rate
days_past_due
collections_status
default_date
```

If the prediction happens when the loan is originated, then:

```text
income              ✓
credit_score        ✓
loan_amount         ✓
interest_rate       possibly ✓
days_past_due       ✗
collections_status  ✗
default_date        ✗
```

`days_past_due` might be extraordinarily predictive. That is exactly the problem. The model is effectively being given evidence that the future event has already occurred.

Its offline performance may look spectacular while its production performance collapses.

### Leakage is really a violation of causality in the dataset

A useful mental rule is:

The model should not be allowed to know anything that its real-world counterpart would need a time machine to know.

Suppose:

$$
t_p = \text{prediction time}
$$

and a piece of information becomes available at:

$$
t_f
$$

For it to be safely usable:

$$
t_f \le t_p
$$

If instead:

$$
t_f > t_p
$$

the feature contains future information. This is **temporal leakage**. But timestamps alone aren't enough.

Imagine a support ticket created before prediction time, but its field:

```text
final_resolution = "customer cancelled"
```

was updated three weeks later. The ticket itself existed before prediction time. The value did not.

Therefore good ML data systems care about:

**When was this value knowable?**

not merely:

"What timestamp does the database row have?"

### Event time versus availability time

The result creates an important distinction. Suppose a payment happened at:

```text
10:01 AM
```

but the analytics warehouse did not receive it until:

```text
10:08 AM
```

If your model made a prediction at 10:05 AM, could it use the payment? Conceptually the event already happened. Operationally the model did not know about it.

So there can be two timestamps:

$$
t_{event}
$$

and

$$
t_{available}
$$

For strict online simulation, the relevant rule is frequently:

$$
t_{available} \le t_{prediction}
$$

Production histories are especially vulnerable because ingestion delays, backfills, corrections, and retroactive updates can all reveal information earlier than it was truly available.

## How Are Outcomes Turned into Labels and Training Targets?

<!-- section-summary: Outcome evidence records what happened after the prediction. -->

### What is a label?

The **label** is the answer associated with a historical training example. Suppose our question is:

"Will the customer cancel within 30 days?"

Then:

$$
y_i =
\begin{cases}
1 & \text{customer cancels within 30 days}\\
0 & \text{customer does not cancel within 30 days}
\end{cases}
$$

A row might therefore look like:

| prediction_time | sessions_30d | days_since_login | tickets_60d | cancelled_next_30d |
| --------------- | -----------: | ---------------: | ----------: | -----------------: |
| Jul 1           |            3 |               17 |           4 |                  1 |

The first three values are features. The final value is the label. The training algorithm sees many pairs:

$$
(x_1,y_1), (x_2,y_2), ..., (x_n,y_n)
$$

and tries to learn:

$$
f(x) \approx y
$$

### Labels come from the future relative to prediction time

This initially sounds contradictory. We just said:

Never use the future.

More precisely:

> **Never use future information as an input to the model.**

But we absolutely need the future when determining whether the historical prediction would have been correct. Training works precisely because history lets us reconstruct both sides:

```text
What we knew then  →  What happened later
      features              label
```

Suppose prediction time is:

```text
2026-01-01
```

Features might use data through:

```text
2025-12-31
```

Then we observe:

```text
2026-01-01 through 2026-01-30
```

to determine the label. That future data belongs in the **answer**, not in the model input.

### Features and labels have opposite information rules

This distinction is worth making explicit.

|                                 | Features                   | Label                    |
| ------------------------------- | -------------------------- | ------------------------ |
| Purpose                         | Evidence for prediction    | Correct answer           |
| Information comes from          | Prediction time or earlier | Usually after prediction |
| Available in production?        | Yes                        | No, not yet              |
| Given to model when predicting? | Yes                        | No                       |
| Used while training?            | Yes                        | Yes                      |

At serving time:

$$
x \rightarrow f(x)
$$

There is no $$y$$ yet. Later, reality produces $$y$$, which may eventually be used for evaluation or retraining.

### Label versus target

The words **label** and **target** are frequently used almost interchangeably. For many ML tasks:

```text
label = target = thing being predicted
```

For example:

```python
target = cancelled_next_30_days
```

But there can be a useful distinction. The real-world outcome may be:

```text
delivery_delay_minutes = 17
```

That could be transformed into a binary target:

$$
y =
\mathbb{1}[\text{delay} > 10]
$$

giving:

```text
late = 1
```

So conceptually:

```text
raw outcome
    ↓
labeling rule
    ↓
training target
```

Another example:

```text
Raw outcome:
customer_cancel_date

Target:
cancelled_within_30_days = 1
```

Teams do not always use these terms consistently. Record the exact meaning of each field so the dataset contract remains clear regardless of naming preference.

### Labels must correspond exactly to the product question

Suppose the business asks:

"Which customers are likely to cancel during the next 30 days?"

But the training label is:

```text
cancelled sometime during the next 12 months
```

Those are different problems. Similarly:

"Will an order arrive more than 10 minutes late?"

is different from:

"Will an order be late at all?"

and from:

"How many minutes late will the order be?"

These produce three different targets:

$$
Y_1 = \mathbb{1}[delay > 10]
$$

$$
Y_2 = \mathbb{1}[delay > 0]
$$

$$
Y_3 = delay\_minutes
$$

A model can perfectly optimize the wrong label. Machine learning does not know what the business intended. It only knows what you encoded into $$y$$.

### Labeling requires an observation window

Suppose the target is:

"Does the customer cancel within 30 days?"

For a prediction made July 1, we cannot know the answer until approximately July 31. Imagine today is July 10. Customer A has not cancelled yet.

Can we label:

```text
A → 0
```

No. The correct status is:

```text
unknown / pending
```

because there are still 21 days during which the customer could cancel. The result creates three possible dataset states:

$$
Y \in \{positive,\ negative,\ pending\}
$$

even when the final ML problem is binary.

## Why Must Pending and Unobserved Outcomes Stay Separate from Negative Labels?

<!-- section-summary: A negative label asserts that the defined outcome did not occur after enough observation. -->

### Pending is not negative

This is an extremely important principle. Suppose:

```text
Prediction date: August 20
Outcome window: 30 days
Dataset generated: August 28
```

Only eight days have passed. If the customer has not cancelled, that does **not** mean:

$$
Y=0
$$

It means:

$$
Y=\text{not yet known}
$$

Calling it negative systematically corrupts recent examples. A mature system therefore has something like a **label maturity** rule. If the outcome horizon is $$H$$, then a row whose prediction time is $$t$$ is fully observable only after approximately:

$$
t + H
$$

potentially plus reporting delay. If:

$$
t + H > t_{\text{dataset cutoff}}
$$

the example usually needs to remain unlabeled until the observation window closes.

### Why this creates a training-data lag

Suppose you predict:

"Will a company default within 12 months?"

Then an example generated today cannot become a fully known negative until roughly a year later. That means supervised-learning data inherently trails reality. For an outcome window $$H$$:

$$
\text{most recent fully labeled example}
\approx
today-H
$$

For a 30-day churn model, this might be manageable. For five-year loan default, it creates a much larger challenge. This is sometimes related to **censoring**: you have not observed the subject for long enough to know the eventual outcome.

### Be careful with positive examples too

There is a subtlety. Suppose the target is:

"Will this customer cancel within 30 days?"

Prediction:

```text
August 20
```

Customer cancels:

```text
August 25
```

On August 28, we already know:

$$
Y=1
$$

even though 30 days haven't passed. But someone who hasn't cancelled yet remains unresolved. Thus recent data can create an asymmetric situation:

```text
some positives are known
negatives are not yet known
```

Training on known positives while calling unresolved cases negative causes severe bias. Usually the simplest policy is to include only examples whose entire label window has matured.

### The full timeline of one example

A useful abstraction is:

```text
                     prediction time
                            │
        feature history     │      label observation
<───────────────────────────┼──────────────────────────>
                            │
                            t
```

Suppose:

```text
Feature window = previous 90 days
Label window   = next 30 days
```

Then:

$$
X_t = g(events[t-90d,t])
$$

and:

$$
Y_t =
\mathbb{1}
[
cancel\_event \in (t,t+30d]
]
$$

The result gives a precise mathematical definition of the example:

$$
(X_t,Y_t)
$$

![Timeline separating pre-decision features from pending and mature outcome evidence while blocking future-data leakage](/content-assets/articles/article-mlops-data-for-ml-systems-training-data-labels-features-targets/prediction-time-boundary.png)

*Prediction time separates inputs from answers. Pending outcomes remain unknown until the maturity window closes, and future evidence never crosses backward into the features.*

## How Do Time-Aware Feature Joins Prevent Future Information from Entering Rows?

<!-- section-summary: Each feature lookup uses the example's prediction cutoff and selects only source state permitted by the feature's event-time and availability-time rules. -->

### Feature engineering is mostly summarizing the past

Production data frequently consists of events:

```text
2026-01-04 login
2026-01-05 login
2026-01-10 purchase
2026-01-16 support_ticket
2026-01-27 login
...
```

A model commonly doesn't consume the entire raw database. Instead we compute features relative to the prediction time. For prediction time February 1:

```text
logins_last_7_days       = 1
logins_last_30_days      = 3
purchases_last_90_days   = 6
support_tickets_last_30d = 1
days_since_last_login    = 5
```

Notice that these are not timeless properties. They are functions of time:

$$
feature(entity,t)
$$

For example:

$$
logins\_30d(customer,t)
=
\#\{login\ events \in [t-30d,t)\}
$$

This time dependence is one reason historical reconstruction can be difficult.

### The same customer can have different feature values at different times

Consider customer 42. January 1:

```text
sessions_last_30_days = 25
```

February 1:

```text
sessions_last_30_days = 10
```

March 1:

```text
sessions_last_30_days = 1
```

These are three different examples:

$$
(customer42, Jan1)
$$

$$
(customer42, Feb1)
$$

$$
(customer42, Mar1)
$$

The identity is the same. The prediction state is different. That is why thinking in terms of:

$$
(entity,\ prediction\ time)
$$

is much more powerful than thinking merely in terms of database rows.

### Future leakage can hide inside aggregates

Suppose you build:

```text
customer_lifetime_orders
```

from today's database. For a prediction supposedly made in January 2024, today's value might count orders from:

```text
2024
2025
2026
```

The feature looks harmless. But it contains information from the future. The correct value is:

$$
orders\_before(prediction\_time)
$$

not:

$$
orders\_before(today)
$$

Historical feature generation therefore has to preserve **point-in-time correctness**: every value must reflect only what was knowable at that moment.

### Point-in-time correctness

A point-in-time-correct feature answers:

"What would this value have been if we had computed it using only information available at that historical prediction time?"

For example:

```text
Prediction:
2025-06-01 10:00

Transaction history available before then:
8 transactions

Transactions known today:
23 transactions
```

The correct historical feature is:

```text
transaction_count = 8
```

not:

```text
23
```

This requirement sounds obvious, but many analytical warehouses primarily store the **current state** rather than every historical state. That makes ML reconstruction harder.

### Snapshot tables can accidentally leak future state

Suppose your customer table currently says:

```text
customer_id       817
plan              premium
account_status    cancelled
country           UK
```

You want to create a historical training example from six months before cancellation. Was `account_status = cancelled` true then? No.

Was `plan = premium` true then? Maybe. Was `country = UK` true then?

Probably—but perhaps the customer moved. A table describing **what is true now** cannot automatically tell you **what was known historically**. This is why event logs, change histories, valid-time tables, or historical snapshots are frequently important for training-data construction.

### Direct leakage versus indirect leakage

Some leakage is obvious:

```text
target: defaulted
feature: default_date
```

Other leakage is indirect. Suppose target:

```text
customer_cancelled
```

Feature:

```text
retention_team_case_created
```

If retention cases are opened only after a cancellation request, then:

$$
retention\_case \approx cancellation
$$

Even though the feature isn't literally the target, the product workflow has encoded the answer. Similarly:

```text
fraud_case_closed
refund_after_chargeback
collection_agency_assignment
death_certificate_received
diagnosis_added_after_test
```

can all leak future outcomes. Leakage detection therefore requires understanding **business semantics**, not merely inspecting data types or correlations.

### High predictive power can be a warning sign

Suppose one feature gives a fraud classifier 99.9% accuracy by itself. That might represent an extraordinary signal. But it might instead be:

```text
fraud_investigation_status
chargeback_received
manual_review_result
```

In real datasets, suspiciously good features deserve investigation. Ask:

"Why does this feature know so much?"

Sometimes the answer is legitimate. Sometimes it reveals that the answer has leaked into the inputs.

## How Does a Dataset Contract Turn a Product Question into an Executable Build?

<!-- section-summary: The contract translates the product decision into executable rules for population, grain, clocks, features, labels, maturity, exclusions, splits, validation, ownership, and retention. -->

### Write the product question as a dataset specification

Before implementing data pipelines, it helps to write the prediction problem in a mechanically precise form. For example:

**Prediction problem:** At midnight each Monday, for every active paying subscriber whose account is at least 30 days old, predict whether that subscriber will voluntarily cancel during the following 30 calendar days, using only information available to the production system before that Monday at midnight.

That sentence defines almost the entire dataset. It tells us: **Entity**

$$
subscriber
$$

**Prediction frequency**

$$
weekly
$$

**Prediction time**

```text
Monday 00:00
```

**Eligibility**

```text
active paying subscriber
account age >= 30 days
```

**Feature boundary**

```text
information known before prediction time
```

**Outcome**

```text
voluntary cancellation
```

**Outcome horizon**

```text
30 days
```

Now engineering decisions can be checked against this contract.

### Then derive the training table from the question

Conceptually:

| subscriber | prediction_time | features... | label |
| ---------- | --------------- | ----------- | ----- |
| A          | Jan 5           | ...         | 0     |
| B          | Jan 5           | ...         | 1     |
| C          | Jan 5           | ...         | 0     |
| A          | Jan 12          | ...         | 0     |
| B          | Jan 12          | ...         | —     |

If B is no longer eligible on January 12 because it already cancelled, that row shouldn't exist. So the table isn't created by blindly joining available data. Its rows come from the **definition of prediction opportunities**.

This is a useful inversion:

First generate the prediction moments.
Then attach historically valid features.
Then attach future outcomes.

Rather than:

Start with a giant warehouse table and decide what columns look useful.

### A useful conceptual construction

For each historical prediction time $$t_i$$:

$$
R_i =
(
ID_i,
t_i,
X_i,
Y_i
)
$$

where:

$$
X_i = F(data_{\leq t_i})
$$

and:

$$
Y_i = L(data_{(t_i,t_i+H]})
$$

Here:

* $$F$$ is the feature-generation logic
* $$L$$ is the labeling rule
* $$H$$ is the prediction horizon

And the row should only be included if:

$$
E(ID_i,t_i)=1
$$

and the label is sufficiently mature. This tiny formulation captures much of supervised training-data construction.

### Example, feature, label, and target together

Consider fraud detection. Business question:

"At transaction authorization, should this transaction be considered likely fraudulent?"

One example:

```text
transaction = tx_987
prediction_time = 14:32:18
```

Features known at 14:32:18:

```text
amount = £684
merchant_country = FR
cardholder_country = UK
transactions_last_hour = 7
distance_from_previous_transaction = 820 km
card_age_days = 612
```

Later:

```text
confirmed_chargeback_reason = fraud
```

Training representation:

$$
X =
[684, FR, UK, 7, 820, 612]
$$

$$
Y=1
$$

The **example** is the complete historical prediction case. The **features** are the information supplied to the model. The **label/target** is the correct historical answer.

### Not every ML example is literally one SQL row

"One row = one example" is useful for tabular ML, but it is a conceptual simplification. For an image classifier:

```text
example = image
feature/input = image pixels
label = cat
```

For language modeling:

```text
example = token sequence
input = previous tokens
target = next token(s)
```

For recommendation:

```text
example = user + context + candidate item
target = clicked/not clicked
```

For forecasting:

```text
example = historical time window
target = future value/window
```

So the deeper principle is:

One training example represents one instance of the learning problem.

A "row" is merely one convenient storage representation.

### Sometimes one prediction creates many rows

Suppose a search engine displays ten results. The product question might be:

"Which result should be ranked highest?"

You might create examples at several possible grains:

```text
one search query
one query-document pair
one pair of competing documents
one entire ranked list
```

All can be valid depending on the model and objective. So there is no universal correct row shape. There is only a row shape that correctly represents the **prediction unit your model is learning**.

### Training data records reality—but product decisions can alter reality

There is another important complication. Suppose a fraud model blocks transactions. For transactions it allows, eventually you may learn whether they were fraudulent.

For transactions it blocks, you may never observe what would have happened had they been allowed. Likewise:

```text
loan denied → never observe whether applicant would've repaid
treatment withheld → don't observe treatment outcome
recommendation not shown → don't observe whether user would've clicked
```

This is sometimes called a **selective-label** or **counterfactual** problem. The training data records:

What happened under the decisions the old system actually made.

It does not necessarily tell you:

What would have happened under every possible decision.

That becomes especially important in systems where predictions directly affect outcomes.

### Missing labels have meaning

Suppose your data says:

```text
fraud_label = NULL
```

That could mean many things:

```text
outcome hasn't matured yet
transaction was blocked
labeling pipeline failed
customer never reported fraud
data source unavailable
case awaiting manual review
```

Those are not interchangeable. So a good ML dataset frequently separates:

```text
label_value
label_status
label_reason
```

Conceptually:

```text
label_value  = 0/1
label_status = mature/pending/unobservable
```

Rather than coercing every unknown into zero.

### "Not observed" does not necessarily mean "did not happen"

This missing-event mistake appears often. Suppose a system predicts purchases and the database contains no purchase event.

Does that imply:

$$
purchase=0
$$

Only if you know the event logging is complete. Maybe:

* the customer bought offline
* the transaction arrived late
* a tracking event failed
* an external partner hasn't reported it
* the outcome window isn't over

So labels depend on both the real-world definition of an outcome and the **observation process**. A label means:

"According to these specified systems and rules, we observed this outcome."

That definition deserves careful attention.

### Dataset creation is a program, not a spreadsheet export

A reliable training dataset should be reproducible from a specification. You want something conceptually like:

$$
D =
BuildDataset(
source\ data,
eligibility\ rule,
prediction\ times,
feature\ definitions,
label\ definition,
cutoff
)
$$

not:

"I ran some queries, downloaded a CSV, fixed a few cells, and trained on it."

Why? Because six months later you will want to answer:

* What exactly was this model trained on?
* Why did this row have this value?
* Did the data change?
* Can we reproduce the experiment?
* Which label rule was used?
* Did a source table get backfilled?
* Were bad examples filtered?
* Which time boundary was applied?

If the dataset cannot be recreated, those questions become extremely difficult.

### Reproducibility requires more than storing SQL

Imagine your query says:

```sql
SELECT *
FROM transactions
WHERE transaction_date < CURRENT_DATE
```

You run it in January. Then again in August. You may get different data.

Even worse, old records might have been:

* corrected
* deleted
* backfilled
* deduplicated
* reclassified

So "same query" does not necessarily mean:

$$
same\ dataset
$$

True reproducibility may require fixing both:

$$
transformation\ version
$$

and:

$$
source\ data\ version
$$

## How Do Versioning, Validation, and Row Traces Make Training Data Reproducible?

<!-- section-summary: An immutable dataset version connects exact rows or source snapshots to code, configuration, time rules, environment, validation evidence, and split membership. -->

### Give published training datasets fixed identities

Suppose an experiment says:

```text
Training dataset = churn_dataset
```

What does that mean? Today's version? Yesterday's?

Before or after an upstream bug fix? A safer approach is to publish immutable versions such as:

```text
churn_training_2026_06_01_v17
```

or a dataset ID/hash. Conceptually:

$$
dataset\_version \rightarrow immutable\ set\ of\ examples
$$

A trained model should then record something like:

```text
model_version      = churn_model_42
dataset_version    = churn_training_v17
feature_code       = commit_a13f...
label_definition   = churn30_v3
training_code      = commit_c91e...
```

The result creates lineage:

```text
sources
   ↓
dataset version
   ↓
training run
   ↓
model version
```

### Reproducibility has two meanings

There is a subtle distinction.

#### Logical reproducibility

Reproducibility asks a concrete question: can the same historical inputs and transformation logic produce an equivalent dataset again?

#### Exact reproducibility

Can we recover the exact bytes/rows that were used for model training? For important production models, both are useful. The second might require immutable snapshots or content-addressed storage rather than relying solely on recomputation.

### Dataset validation has two layers

You can validate a training dataset mechanically. For example:

```text
column exists
type is numeric
no duplicate IDs
target is 0 or 1
null rate < threshold
timestamps parse successfully
10 million rows present
```

These are **data-shape checks**. They are necessary. But they don't prove the dataset represents the intended real-world problem.

Consider:

```text
target column contains only 0 and 1
```

Great. But perhaps:

```text
1 = refund
```

while the model is supposed to predict:

```text
fraud
```

The schema is perfectly valid. The semantics are wrong.

### Shape correctness versus semantic correctness

Think of two levels:

$$
\text{syntactic/data correctness}
$$

and:

$$
\text{real-world semantic correctness}
$$

A dataset can pass every engineering check while still answering the wrong question. For example:

| Check                              | Result |
| ---------------------------------- | ------ |
| No null labels                     | ✓      |
| Correct numeric types              | ✓      |
| Feature ranges sensible            | ✓      |
| No duplicate IDs                   | ✓      |
| Label represents intended outcome  | ✗      |
| Feature existed at prediction time | ✗      |

The final two failures are much more dangerous. Unfortunately they are harder to automate. They require understanding the product and the source systems.

### Validate invariants derived from reality

Good semantic checks come from asking:

"If our interpretation of the world is correct, what should almost always be true?"

Consider if:

```text
target = cancelled within next 30 days
```

then every positive example should satisfy:

$$
prediction\_time
<
cancellation\_time
\le
prediction\_time + 30d
$$

If features are point-in-time correct:

$$
feature\_event\_time \le prediction\_time
$$

If only active accounts are eligible:

```text
account_status_at_prediction = active
```

If an order must already exist:

$$
order\_created\_time \le prediction\_time
$$

These aren't arbitrary quality checks. They come directly from the meaning of the prediction problem.

### Always trace at least one example end to end

One of the most powerful validation methods is surprisingly simple:

Pick one training example and reconstruct it manually from source records.

Suppose dataset row:

```text
customer_id = 923
prediction_time = 2026-04-01
sessions_30d = 6
tickets_60d = 2
cancelled_next_30d = 1
```

Go to the underlying source systems. Check that exactly six qualifying sessions happened before April 1. Check that exactly two qualifying tickets existed.

Check whether their information was actually available before the prediction timestamp. Check that the customer was eligible on April 1. Then verify a qualifying cancellation occurred between:

```text
April 1
and
May 1
```

That comparison is valuable because it joins three parts of the system that are often tested separately:

```text
business meaning
      ↕
training table
      ↕
source records
```

A manual trace exposes many dataset bugs that aggregate checks miss.

### Trace more than just a positive example

If possible, manually inspect examples representing different cases:

1. an ordinary negative
2. a clear positive
3. an example near the time boundary
4. an example with missing source data
5. a recently matured label
6. an entity entering eligibility
7. an entity leaving eligibility
8. an unusual but valid case

You are looking for mismatches between:

what the dataset says happened

and:

what a knowledgeable human concludes happened from the underlying records.

### Train/validation/test splitting must respect how examples arise

Once examples are built correctly, they must still be split correctly. Suppose the same customer appears monthly:

```text
Customer A — January
Customer A — February
Customer A — March
```

A random row split might put:

```text
January → train
February → validation
March → test
```

Sometimes that is acceptable. Sometimes it creates unrealistic dependence. More importantly, many production systems operate forward in time.

You train on history and predict the future. Then a temporal split frequently better reflects reality:

```text
Train:
Jan–Sep

Validation:
Oct

Test:
Nov
```

That recreates:

$$
past \rightarrow future
$$

rather than randomly mixing past and future.

### Don't let dataset splitting create another form of leakage

Suppose you calculate:

```text
global_average_purchase_amount
```

using the entire dataset before splitting. Then the training rows indirectly contain information from the test period. Or suppose you normalize a feature using:

$$
\mu = mean(all\ rows)
$$

including test examples. That leaks evaluation information. The correct conceptual sequence is:

```text
construct examples
      ↓
split
      ↓
fit learned preprocessing on training data
      ↓
apply it to validation/test
```

This applies to things such as:

* mean/std normalization
* vocabularies
* target encoding
* imputation statistics
* feature selection
* dimensionality reduction

### Training data is an executable definition of the ML problem

This is a deeper way to think about datasets. People sometimes think the ML problem is defined by the model:

```text
XGBoost
neural network
transformer
logistic regression
```

But a large part of the problem definition actually lives in the training dataset. Changing:

```text
who becomes a row
when the prediction happens
which history becomes features
which future period defines the target
what counts as positive
how pending cases are treated
```

can fundamentally change what the model learns. Two models using identical architecture but different dataset definitions may solve entirely different problems. Conversely, logistic regression and a neural network trained on the same examples are at least trying to solve the same underlying supervised-learning task.

So:

$$
\boxed{\text{Dataset design is part of model design}}
$$

### Dataset errors can be more dangerous than model errors

Suppose your model implementation contains an obvious bug. Perhaps training crashes. That's painful but visible.

Now suppose the dataset accidentally uses:

```text
cancelled_at
```

as a feature for predicting cancellation. Training succeeds. Validation accuracy is 99.8%.

Everyone celebrates. The model goes to production and fails. This kind of error is more dangerous because the system appears healthy.

A bad dataset can produce:

$$
excellent\ metrics + useless\ model
$$

which is frequently worse than producing no model at all.

### Feature availability must match serving availability

Another important connection is between training and inference. Suppose a training feature is:

```text
customer_total_spend_30d
```

During dataset generation, an analyst computes it using a warehouse that updates once per day. But the production model runs immediately after every transaction. At inference time the equivalent value may be:

* six hours stale
* unavailable
* calculated differently

Then the model is trained under one information environment and served under another. This is called **training-serving skew**. Ideally:

$$
Feature_{training}(entity,t)
\approx
Feature_{serving}(entity,t)
$$

with identical definitions whenever practical.

### Feature definitions need operational semantics

Instead of defining:

```text
orders_last_30_days
```

only by name, define precisely:

```text
Number of successfully submitted non-test orders
whose creation timestamp is >= prediction_time - 30 days
and < prediction_time,
excluding cancelled-before-payment orders.
```

Then edge cases become deterministic. Does an order exactly 30 days earlier count? What about one exactly at prediction time?

What about refunded orders? What timezone? Without these definitions, two engineers can produce different datasets while believing they implemented the same feature.

### Time boundaries deserve explicit notation

A useful convention is half-open intervals. For example:

$$
[t-30d,\ t)
$$

means:

```text
include start
exclude prediction time
```

The target might use:

$$
[t,\ t+30d)
$$

Then an event cannot accidentally belong to both windows. Exact boundary conventions are less important than being explicit and consistent.

### IDs usually are not features

A dataset might contain:

```text
customer_id
transaction_id
prediction_time
```

These are frequently needed for:

* joining data
* debugging
* lineage
* evaluation
* tracing examples

But that doesn't necessarily mean the model should receive them. It helps to distinguish:

```text
example metadata
features
label
```

A conceptual row could be:

```text
metadata:
    customer_id
    prediction_time
    dataset_version

features:
    sessions_30d
    spend_90d
    account_age

label:
    cancelled_30d
```

The control prevents accidental use of bookkeeping fields as predictive inputs.

### A training row should tell a coherent historical story

Consider this suspicious row:

```text
prediction_time        = 2026-01-01
account_age_days       = 500
sessions_last_30d      = 3
cancellation_reason    = "too expensive"
cancelled_next_30d     = 1
```

The columns all have valid values. But ask:

"Imagine standing on January 1. What did we actually know?"

`cancellation_reason` probably did not exist yet. That narrative approach is a surprisingly powerful leakage test. For every feature, ask:

**How exactly could the system have known this value at that moment?**

If there is no convincing answer, investigate it.

### Think of training data as replaying history

A strong mental model is a **time machine that only travels backward**. Pick a historical timestamp:

```text
2025-05-03 14:00
```

Pretend you are the production model at that moment. Freeze the universe. Ask:

"What can I see?"

That becomes $$X$$. Now let time run forward for the target horizon. Ask:

"What happened?"

That becomes $$Y$$. Then rewind to another historical prediction time and repeat. Training-data construction is essentially:

```text
freeze history
collect available evidence
observe subsequent outcome
repeat
```

Any value written after the frozen cutoff must remain invisible; exposing it gives the historical build knowledge it could not have had.

### One complete worked example

Suppose a SaaS company wants to predict customer churn. The product requirement is:

Every Monday at 00:00 UTC, score every active paying customer and estimate whether they will voluntarily cancel within the next 30 days.

Take customer `C817`. Prediction moment:

```text
Monday, 6 April 2026 00:00 UTC
```

Eligibility at that moment:

```text
paying     = yes
active     = yes
account age = 294 days
```

Therefore:

$$
E(C817,t)=1
$$

Feature definitions produce:

```text
sessions_last_7d        = 1
sessions_last_30d       = 6
days_since_last_session = 5
support_tickets_last_60d = 3
failed_payments_last_90d = 1
account_age_days         = 294
```

All underlying events used in those calculations must have been available before April 6 00:00. Now define the outcome interval:

$$
[April\ 6,\ May\ 6)
$$

Suppose source records show:

```text
voluntary cancellation:
April 24
```

Therefore:

$$
Y=1
$$

The published training row becomes conceptually:

```text
customer_id: C817
prediction_time: 2026-04-06T00:00Z

features:
    sessions_7d: 1
    sessions_30d: 6
    days_since_session: 5
    tickets_60d: 3
    failed_payments_90d: 1
    account_age_days: 294

target:
    voluntarily_cancelled_30d: 1
```

The model learns from:

$$
X_{C817,Apr6} \rightarrow 1
$$

Now imagine the next weekly prediction:

```text
13 April
```

If the customer was still active then, another example might exist. Its features differ because another week of history has occurred. And because cancellation happens April 24:

$$
Y_{C817,Apr13}=1
$$

So one real cancellation can legitimately make several earlier prediction moments positive. Whether that is desirable depends on the product definition. The key is that it happens deliberately, not accidentally.

### Generating the dataset too recently

Suppose prediction time is:

```text
20 August
```

and the dataset cutoff is:

```text
28 August
```

The label window ends:

```text
19 September
```

A customer hasn't cancelled by August 28. Do we store:

```text
target = 0
```

No. The outcome has not matured. Store something conceptually equivalent to:

```text
label_status = pending
```

or exclude that example from the supervised training dataset. Only after the label window closes can the absence of cancellation become evidence for:

$$
Y=0
$$

### A leakage bug

Suppose someone creates the feature:

```text
current_account_status
```

by joining the latest customer table. Today `C817` says:

```text
status = cancelled
```

That value is copied onto the April 6 historical row. Training data becomes:

```text
current_account_status = cancelled
target                  = 1
```

The model learns:

If account status says cancelled, predict cancellation.

Offline metrics look fantastic. But on April 6 in the real system:

```text
status = active
```

So the model has learned from information that never existed at prediction time. That one join can invalidate the experiment.

### A useful training-dataset contract

Before building a dataset, I would want these questions answered:

1. **Prediction:** What exact unknown quantity will the model predict?
2. **Entity:** What object or event are we predicting about?
3. **Prediction moment:** Exactly when is the model conceptually called?
4. **Eligibility:** Which entities receive predictions?
5. **Example grain:** What exactly does one example represent?
6. **Features:** What information is allowed, and when must it have been available?
7. **Feature windows:** Which historical intervals are used?
8. **Outcome:** What real-world event/value determines correctness?
9. **Label rule:** How is that outcome converted into the training target?
10. **Outcome horizon:** How long do we wait?
11. **Label maturity:** When is a negative actually knowable?
12. **Missing outcomes:** What does unknown/unobservable mean?
13. **Data cutoff:** What historical data version may be used?
14. **Split strategy:** How will train/validation/test mimic production?
15. **Version:** What immutable identifier describes the published dataset?
16. **Lineage:** Can every row and feature be traced back to its sources?
17. **Validation:** What shape checks and semantic invariants must hold?
18. **Serving parity:** Can every training feature be produced the same way when predictions are actually made?

Once these are precise, much of the dataset implementation becomes mechanical.

### How the dataset fits into the ML system

You can summarize a supervised ML data system as four transformations:

$$
\text{Reality}
\rightarrow
\text{Historical Records}
\rightarrow
\text{Training Examples}
\rightarrow
\text{Model}
$$

The first transformation is performed by your operational systems:

```text
people act
orders happen
payments occur
sensors report
events are logged
```

The second is your dataset construction:

$$
(entity,t)
\rightarrow
(X_t,Y_t)
$$

The third is learning:

$$
\{(X_i,Y_i)\}_{i=1}^N
\rightarrow
f
$$

Then production runs the learned function on a new case:

$$
X_{now}
\xrightarrow{f}
\hat{Y}_{future}
$$

Notice what is absent at inference time:

$$
Y_{future}
$$

That is precisely why the model exists.

### Features are evidence; labels are hindsight

This is perhaps the cleanest distinction. **Features are evidence available to the decision-maker.** **Labels are hindsight available to the trainer.**

During training:

$$
evidence + hindsight
$$

are both available. During production:

$$
evidence
$$

is available, but:

$$
hindsight
$$

is not. The job of dataset construction is to keep those two worlds separate.

### Dataset design is really information-boundary design

Much of training-data engineering exists to keep one information boundary intact:

```text
KNOWN                     UNKNOWN
at prediction time        at prediction time

features                   target
─────────────── t ──────────────────>
past                       future
```

Then asking every column:

Which side of this boundary does this information belong on?

And asking every example:

Would this prediction genuinely have occurred at this point in history?

And asking every label:

Has enough future actually passed for us to know the answer?

Those three questions catch a remarkable fraction of training-data mistakes.

#### What to remember

A model is supposed to operate in the present:

$$
\boxed{\text{what I know now} \rightarrow \text{what will happen later}}
$$

Training uses history to simulate that situation:

$$
\boxed{\text{what was knowable then} \rightarrow \text{what actually happened later}}
$$

So a good training example should be reconstructible as:

$$
\boxed{
(entity,\ prediction\ time,\ historically\ available\ features,\ later\ outcome)
}
$$

The **row/example** defines one historical prediction opportunity. The **features** contain only information the real system could have known at that moment. The **label/target** represents what reality subsequently revealed.

**Pending outcomes are not negatives.** Future information must never cross backward into the features. The dataset specification should follow directly from the product prediction question.

For any row in a published dataset, its versions, validation evidence, and lineage should let the team answer:

**Why does this example exist, why does every feature have this value, and why is this the correct label?**

Clear, evidence-backed answers to those questions are a strong sign that the training data can be trusted.

![Training dataset workflow from a dataset contract through case selection, historical evidence, mature outcomes, fixed versioning, validation, and row-level tracing](/content-assets/articles/article-mlops-data-for-ml-systems-training-data-labels-features-targets/trustworthy-training-dataset-summary.png)

*A trustworthy dataset can be rebuilt, explained, and validated from source records to feature values, label, and target. The contract preserves each build tied to the intended product decision.*

## Check Your Answers

Use these answers to revisit the evidence, boundaries, and operating decisions behind each question.

:::expand[What Does One Training Example Represent?]{kind="recap"}
One example represents one historical opportunity to make the product prediction.

It combines the entity and prediction time that identify the decision, the evidence legitimately available at that cutoff, and an outcome measured later. The representation may occupy one table row or several stored objects, but its conceptual identity remains tied to one prediction opportunity.
:::

:::expand[How Do Eligibility and Grain Decide Which Cases Become Rows?]{kind="recap"}
Eligibility states which historical cases the production system would actually have considered.

Grain states the smallest unit represented by one example, commonly an entity and prediction time. Together they prevent mixed populations, duplicated decisions, and labels attached at a different level from the prediction.
:::

:::expand[How Do Features Represent What Was Knowable at Prediction Time?]{kind="recap"}
Features encode evidence the deployed system could obtain before its decision deadline.

Their contracts define sources, calculations, entities, windows, missing semantics, and event or availability timestamps. A causally valid historical fact still makes a poor production feature if the serving path cannot deliver it with the required freshness, latency, and reliability.
:::

:::expand[How Are Outcomes Turned into Labels and Training Targets?]{kind="recap"}
Outcome evidence records what happened after the prediction.

A label rule interprets that evidence under a documented observation window, and a target transformation converts the result into the exact value the learning algorithm consumes. Keeping these steps separate preserves raw evidence and allows a changed policy to create a new target version without rewriting history.
:::

:::expand[Why Must Pending and Unobserved Outcomes Stay Separate from Negative Labels?]{kind="recap"}
A negative label asserts that the defined outcome did not occur after enough observation.

A pending case has not reached that maturity boundary, while an unobserved case lacks sufficient measurement even afterward. Collapsing either state into negative teaches the model a data-collection artifact and can make recently observed positives appear unfairly different from incomplete cases.
:::

:::expand[How Do Time-Aware Feature Joins Prevent Future Information from Entering Rows?]{kind="recap"}
Each feature lookup uses the example's prediction cutoff and selects only source state permitted by the feature's event-time and availability-time rules. Explicit half-open windows, historical dimensions, and as-of joins stop later events, corrections, current tables, and outcome-derived fields from leaking into an earlier decision.
:::

:::expand[How Does a Dataset Contract Turn a Product Question into an Executable Build?]{kind="recap"}
The contract translates the product decision into executable rules for population, grain, clocks, features, labels, maturity, exclusions, splits, validation, ownership, and retention. Row, feature, label, and split builders implement those rules, making the dataset a reviewable program rather than an undocumented export.
:::

:::expand[How Do Versioning, Validation, and Row Traces Make Training Data Reproducible?]{kind="recap"}
An immutable dataset version connects exact rows or source snapshots to code, configuration, time rules, environment, validation evidence, and split membership.

Structural and semantic checks protect publication, while source-to-row traces demonstrate that representative examples follow the contract. The manifest should state whether exact, logical, or semantic reproduction is supported.
:::

## References

- [Google Machine Learning Glossary: examples, features, and labels](https://developers.google.com/machine-learning/glossary/fundamentals)
- [Google Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml)
- [Google Machine Learning Crash Course: labels](https://developers.google.com/machine-learning/crash-course/overfitting/labels)
- [Google Production ML Systems: checking for label leakage](https://developers.google.com/machine-learning/crash-course/production-ml-systems/monitoring#check_for_label_leakage)
- [OpenLineage object model](https://openlineage.io/docs/spec/object-model/)
- [Datasheets for Datasets](https://arxiv.org/abs/1803.09010)
