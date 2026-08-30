---
title: "Dataset Splits"
description: "Design train, validation, and protected test evidence that matches the model's real deployment claim."
overview: "Dataset splitting gives model learning, model selection, and final release evaluation different evidence. Learn how production teams protect those roles across repeated tuning, entities, time, sites, rare events, cross-validation, versioned manifests, and release gates."
tags: ["MLOps", "core", "datasets"]
order: 2
id: "article-mlops-data-for-ml-systems-train-validation-test-splits"
---

## Table of Contents

1. [Why Do Training, Validation, and Test Data Need Different Roles?](#why-do-training-validation-and-test-data-need-different-roles)
2. [How Does Repeated Tuning Use Up Independent Evaluation Evidence?](#how-does-repeated-tuning-use-up-independent-evaluation-evidence)
3. [What Does Unseen Data Mean for the Real Deployment?](#what-does-unseen-data-mean-for-the-real-deployment)
4. [How Do Group and Time Boundaries Prevent Related Cases from Crossing Splits?](#how-do-group-and-time-boundaries-prevent-related-cases-from-crossing-splits)
5. [How Should Rare Outcomes and Important Segments Be Represented?](#how-should-rare-outcomes-and-important-segments-be-represented)
6. [When Does Cross-Validation Improve the Development Estimate?](#when-does-cross-validation-improve-the-development-estimate)
7. [How Are Split Rules and Membership Made Reproducible?](#how-are-split-rules-and-membership-made-reproducible)
8. [How Do Integrity Checks and Release Policy Protect the Final Test?](#how-do-integrity-checks-and-release-policy-protect-the-final-test)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A team trains a classifier and checks it on held-back data. The score looks promising, so the team changes the features and checks the same data again. It then changes the model, threshold, class weights, and missing-value rules, looking at that score after every change.

The model never trained directly on those held-back labels, but the team's decisions did. After enough rounds, the score partly measures how well the team adapted to that particular sample.

Dataset splits give different evidence different jobs. Training data teaches the model. Validation data helps the team choose among candidates. A protected test set measures the frozen choice against the kind of new case the product will face. That new case might be a later month, a different hospital, a new customer, or another device—not merely a random row.

Design the evidence boundaries through these questions:

1. **Why Do Training, Validation, and Test Data Need Different Roles?**
2. **How Does Repeated Tuning Use Up Independent Evaluation Evidence?**
3. **What Does Unseen Data Mean for the Real Deployment?**
4. **How Do Group and Time Boundaries Prevent Related Cases from Crossing Splits?**
5. **How Should Rare Outcomes and Important Segments Be Represented?**
6. **When Does Cross-Validation Improve the Development Estimate?**
7. **How Are Split Rules and Membership Made Reproducible?**
8. **How Do Integrity Checks and Release Policy Protect the Final Test?**

## Why Do Training, Validation, and Test Data Need Different Roles?

<!-- section-summary: Training data fits model and preprocessing parameters. -->

A machine-learning system is not useful merely because it can explain the data it already saw. It needs to perform well on **future cases it has never seen before**. That immediately creates a problem:

If we train a model on some data, how can we use that same data to determine whether the model will generalize?

We cannot do this reliably, because the training process deliberately adapts the model to that data. So we need to separate two activities:

$$
\text{learning from data}
$$

and

$$
\text{testing what was learned on unseen data}
$$

That separation is the reason dataset splits exist.

### Why evaluating on training data is fundamentally misleading

Suppose we have 10,000 historical customers and want to predict churn. We train a model:

$$
f_\theta(X) \rightarrow \hat{Y}
$$

where $$\theta$$ represents the model's learned parameters. Training chooses $$\theta$$ specifically to make predictions on the training examples better:

$$
\theta^*
=
\arg\min_\theta
L(D_{\text{train}},\theta)
$$

The model has therefore been optimized against those examples. If we now ask:

"How accurate is the model on those same examples?"

we are partly measuring how well it learned or memorized the past. But production asks a different question:

"How accurate will it be on examples it did not get to learn from?"

Those are not equivalent. A model could memorize every training row:

$$
\text{training accuracy}=100\%
$$

while being terrible on new customers. This is **overfitting**. So evaluation requires data that did not participate in fitting the model.

### The simplest split: training data and testing data

Imagine we have historical examples:

$$
D=\{(X_i,Y_i)\}_{i=1}^N
$$

We divide them into:

$$
D_{\text{train}}
$$

and

$$
D_{\text{test}}
$$

The training set is used to learn the model:

$$
D_{\text{train}}
\rightarrow
\theta^*
$$

Then the test set asks:

$$
f_{\theta^*}(X_{\text{test}})
\rightarrow
\hat{Y}_{\text{test}}
$$

and compares:

$$
\hat{Y}_{\text{test}}
\quad\text{against}\quad
Y_{\text{test}}
$$

Because the model did not train on these examples, test performance is a better estimate of what might happen on unseen production cases. Conceptually:

```text
historical examples
       │
       ├──────── training ────────> learn model
       │
       └──────── test ────────────> evaluate unseen cases
```

But real model development introduces another complication.

### We usually make many decisions after seeing model performance

Suppose your first model gets 78% accuracy. You change:

* features
* learning rate
* tree depth
* architecture
* regularization
* class weighting
* preprocessing
* threshold
* loss function

Then you evaluate again. Perhaps:

```text
Model A → 78%
Model B → 81%
Model C → 84%
Model D → 83%
Model E → 85%
```

You choose Model E. If all of those numbers came from the **test set**, then something subtle happened. You did not directly train Model E on the test rows.

But you did use the test results to decide which model to keep. So information from the test set influenced the final system. The test set has indirectly become part of the development process.

That is why we commonly need three roles.

### Train, validation, and test

The standard conceptual split is:

$$
D
=
D_{\text{train}}
\cup
D_{\text{validation}}
\cup
D_{\text{test}}
$$

with no overlapping examples. Each part answers a different question.

| Split      | Main question                                              |
| ---------- | ---------------------------------------------------------- |
| Training   | What should the model learn?                               |
| Validation | Which model/design choices should we prefer?               |
| Test       | How well does the finished development process generalize? |

The distinction is more important than the exact percentages.

### Training data teaches the model

Training examples directly determine learned model parameters. For linear regression:

$$
\hat{Y}=\beta_0+\beta_1X_1+\cdots+\beta_pX_p
$$

the training set determines the estimated coefficients:

$$
\hat{\beta}_0,\hat{\beta}_1,\ldots,\hat{\beta}_p
$$

For neural networks it determines millions or billions of weights. For decision trees it determines:

* split variables
* thresholds
* tree structure

Training data therefore participates directly in optimization. You can think of it as:

$$
D_{\text{train}}
\rightarrow
\text{learned parameters}
$$

### Validation data teaches us which model to choose

Some choices are not commonly learned by ordinary gradient descent or fitting. Suppose you train several models with:

$$
depth \in \{3,5,8,12\}
$$

The training algorithm learns the trees. But **you** need to decide which depth is best. You compare validation performance:

$$
Score(D_{\text{validation}},M_3)
$$

$$
Score(D_{\text{validation}},M_5)
$$

$$
Score(D_{\text{validation}},M_8)
$$

$$
Score(D_{\text{validation}},M_{12})
$$

and choose the best. This process is called **model selection**. Validation data can influence decisions such as architecture, features, hyperparameters, preprocessing, stopping time, thresholds, calibration methods, and even which modeling approach to use.

So validation data is not truly untouched. It is part of development.

### The test set is supposed to answer a final question

After development is finished, we want something resembling:

"Imagine we now deploy this model and encounter fresh unseen data. What should we expect?"

That is the role of the test set. Ideally, the final test evaluation happens after choices are frozen. Conceptually:

```text
Train
  ↓
learn parameters
  ↓
Validation
  ↓
choose architecture/features/hyperparameters
  ↓
freeze development choices
  ↓
Test
  ↓
estimate generalization
```

This is why the test set is sometimes called a **holdout set**. It is held out from the development feedback loop.

## How Does Repeated Tuning Use Up Independent Evaluation Evidence?

<!-- section-summary: Every feature, threshold, model, or policy choice made after inspecting an evaluation result adapts development to that sample. -->

### Why repeated test-set use weakens the test

Suppose you run one model against the test set. Then another. Then 50 more.

Eventually you select whichever happens to perform best. Even if the models are equally good in reality, random statistical noise means some will score higher on this particular test sample. If you repeatedly select based on that sample, you begin optimizing for its peculiarities.

In abstract form:

$$
M^*
=
\arg\max_{M_1,\ldots,M_k}
Score(M_i,D_{\text{test}})
$$

Now the chosen model is partly adapted to $$D_{\text{test}}$$. The test set has become a validation set. This is sometimes described as **overfitting to the test set**.

### Humans can overfit too

This does not require an automated hyperparameter search. Imagine:

"The test results show poor performance among new customers."

So you create features specifically for new customers. Then:

"Now the model performs badly in Scotland."

You add location interactions. Then:

"False positives are especially high among premium customers."

You change the thresholding scheme. Each individual decision may be sensible. But you are using test information to alter the system.

Eventually the model and the human development process both become adapted to the test set. The test estimate is no longer truly independent.

### Independent evidence

Dataset splitting is really about preserving **independent evidence**. Before seeing a test example, many models are plausible. After seeing the answer, you can adjust your behavior.

So if you want an unbiased-ish measurement of how the finished system performs on unseen data, you need some observations whose outcomes have not influenced development decisions. This is conceptually similar to an exam. Studying using practice questions is fine.

But if the teacher gives you the exact final exam, lets you repeatedly check your score, and you revise your answers after every attempt, the eventual exam score no longer measures unseen-question performance. Training is studying. Validation is practice exams.

Test is the final exam.

![The different jobs of training, validation, and test data, with the final test set kept protected](/content-assets/articles/article-mlops-data-for-ml-systems-train-validation-test-splits/split-roles.png)

*Training fits the model, validation guides development choices, and the protected test set supplies one final estimate after those choices are frozen.*

## What Does Unseen Data Mean for the Real Deployment?

<!-- section-summary: Unseen data must name the intended novelty: a new row, later time, new entity, household, site, geography, or operating regime. -->

### Random splitting works only under important assumptions

A common approach is to shuffle examples randomly and assign perhaps:

$$
70\% \rightarrow train
$$

$$
15\% \rightarrow validation
$$

$$
15\% \rightarrow test
$$

This can work when examples are approximately independent and identically distributed. Informally:

Future production examples should look like random additional examples from the same underlying population.

But many real ML datasets violate this. Examples may be related by:

* customer
* patient
* device
* household
* company
* geographic region
* time
* document
* conversation
* product
* hospital
* user session

Then random row splitting can give a dangerously optimistic result.

### The true unit of independence may not be the row

Suppose one customer appears 50 times. You randomly split rows. You might get:

```text
Customer A rows:
35 → train
8  → validation
7  → test
```

Now the test set technically contains unseen **rows**. But the model has already seen customer A repeatedly. Suppose the features reveal stable characteristics such as:

* postcode
* device
* company
* purchase habits
* age
* subscription tier

The model may effectively recognize the customer. Then test performance answers:

"Can I predict another example from a customer I already know?"

But production might require:

"Can I predict for a completely new customer?"

Those are different generalization problems.

### Keep related cases in the same split when necessary

Suppose one patient has several hospital visits. If some visits are in training and others are in test, the model may learn patient-specific patterns. A safer strategy could be:

$$
patient\_id \rightarrow split
$$

Then all rows for patient 817 belong to exactly one of:

```text
train
validation
test
```

This is called a **grouped split**. The important rule is:

$$
group_i \cap train \neq \varnothing
\implies
group_i \cap test = \varnothing
$$

The group might be:

* user
* patient
* household
* device
* company
* school
* hospital
* video
* document
* session
* product family

depending on the real-world problem.

### Split according to the kind of generalization production requires

This is one of the deepest principles in dataset splitting. There is no universally correct split. The right split asks:

**What exactly will be new at production time?**

If production sees new transactions from existing customers, letting the same customer appear across splits may be reasonable. If production must work on brand-new customers, customers should probably be held out as groups. If production predicts next month's behavior, time should probably be held out.

If production expands into unseen hospitals, entire hospitals may need to be held out. Your evaluation set should simulate the novelty the model will face after deployment.

## How Do Group and Time Boundaries Prevent Related Cases from Crossing Splits?

<!-- section-summary: Group rules preserve information-equivalent cases such as visits from one patient, devices from one household, or near-duplicate documents together. -->

### Time is often the most important source of novelty

Consider a churn model. Suppose your dataset covers:

```text
January 2024 → December 2025
```

A random split might put examples like:

```text
Nov 2025 → train
Feb 2024 → test
Dec 2025 → train
Jul 2024 → test
```

But that is not how production works. In production, the model is trained on the past and predicts the future. So a more realistic split might be:

```text
Train:
Jan 2024 – Jun 2025

Validation:
Jul 2025 – Sep 2025

Test:
Oct 2025 – Dec 2025
```

Mathematically:

$$
t_{\text{train}}
<
t_{\text{validation}}
<
t_{\text{test}}
$$

This is a **temporal split**.

### Why temporal splitting matters

Real systems change. Over time:

* customer behavior changes
* products change
* prices change
* fraud strategies change
* user interfaces change
* economic conditions change
* competitors change
* measurement pipelines change
* marketing policies change

So data distributions can change:

$$
P_{2024}(X,Y)
\neq
P_{2026}(X,Y)
$$

This is frequently called **distribution shift** or **concept drift**, depending on what changes. A random split mixes these eras together. That can make the evaluation problem artificially easy.

A temporal split asks something closer to:

"Can a model learned from earlier reality survive later reality?"

### Time splits also prevent certain subtle leaks

Suppose a company's product catalog changes every month. A random split could expose late-period information during training while asking the model to predict an earlier-period test example. Even if individual feature rows are point-in-time correct, the model-development process itself now has knowledge of the future distribution.

For a true forecasting-style application, this is unrealistic. A temporal split preserves the arrow of time:

$$
past
\rightarrow
future
$$

### But time splitting does not automatically solve everything

Suppose Customer A appears:

```text
2024 → training
2025 → test
```

If production predicts future behavior for existing customers, that may be exactly correct. But if production specifically targets customers never previously seen, it may not be. So sometimes you need both constraints:

$$
\text{future time}
$$

and

$$
\text{unseen groups}
$$

For example:

Test on customers who joined after January 2026 and therefore could not appear in training.

Splitting is ultimately an attempt to simulate the deployment scenario.

### Hold out entire groups when production will face unseen groups

Imagine a model predicts equipment failures across factories. You train on data from 100 factories. If production will mostly make predictions in those same factories, a random or time-based within-factory test may be reasonable.

But suppose the business goal is:

"Deploy this model to factories we've never collected data from."

Then the important question is:

$$
\text{Does the model generalize across factories?}
$$

You should test using factories absent from training:

```text
Factories 1–70   → train
Factories 71–85  → validation
Factories 86–100 → test
```

Now a test score measures cross-factory generalization.

### Different splits answer different scientific questions

Consider a medical model using data from many hospitals. A random patient split answers approximately:

"How well does the model generalize to new patients drawn from these hospital environments?"

A hospital-group split answers:

"How well does it work at completely unseen hospitals?"

A temporal split answers:

"How well does it generalize to patients treated later?"

A combined hospital-and-time split could ask:

"How well does it generalize to future patients at new hospitals?"

Those scores can differ dramatically. None is inherently "the" correct test score. The correct one depends on what deployment means.

### Splits are part of the problem definition

Earlier we can think of a training example as:

$$
(entity,t,X,Y)
$$

Now add a split function:

$$
S(entity,t,\ldots)
\rightarrow
\{train,val,test\}
$$

This function should embody your intended generalization boundary. For example:

$$
S(row)=
\begin{cases}
train & t < 2025\text{-}07\text{-}01\\
validation & 2025\text{-}07\text{-}01\le t<2025\text{-}10\text{-}01\\
test & t\ge 2025\text{-}10\text{-}01
\end{cases}
$$

Or perhaps:

$$
S(row)=hash(customer\_id)
$$

mapped deterministically to splits. The split rule is not merely bookkeeping. It determines what kind of generalization your reported metrics mean.

## How Should Rare Outcomes and Important Segments Be Represented?

<!-- section-summary: Each reported outcome and segment needs enough independent examples to support the metric and its uncertainty. -->

### Rare outcomes create a practical problem

Suppose you are detecting a rare type of fraud. Dataset:

$$
1,000,000\text{ examples}
$$

but only:

$$
500\text{ fraud cases}
$$

A random test allocation of 1% would contain approximately:

$$
500 \times .01 = 5
$$

positive examples. A test result based on five positives will be extremely unstable. If the model correctly detects three instead of four, recall changes from:

$$
60\%
$$

to:

$$
80\%
$$

because of one example. So dataset splitting is not only about independence. You also need enough examples to measure what matters.

### Rare segments matter too

Suppose overall your test set has 100,000 examples. That sounds huge. But production includes an important segment:

```text
enterprise customers
```

and only 30 enterprise customers appear in test. Then:

$$
N_{\text{test}}=100,000
$$

does not mean your enterprise evaluation is reliable. Effective sample size depends on the slice you care about. You may need enough test examples across:

* positive and negative classes
* high-risk groups
* countries
* device types
* customer tiers
* product families
* important demographics where appropriate
* operational edge cases

The exact slices depend on the application.

### Stratification can preserve important proportions

For classification, random splitting may accidentally put very different positive rates in each split. Suppose:

$$
P(Y=1)=1\%
$$

A **stratified split** intentionally preserves approximately the same class proportions:

$$
P(Y=1\mid train)
\approx
P(Y=1\mid validation)
\approx
P(Y=1\mid test)
$$

This frequently improves evaluation stability. But stratification cannot override the more fundamental generalization requirement. If your split must be temporal, you should not randomly move future positives backward merely to make class ratios identical.

Reality may genuinely have changing class prevalence.

### Sometimes differing class proportions are exactly what you need to observe

Suppose fraud rates increase:

```text
2024 → 0.5%
2025 → 1.1%
2026 → 2.0%
```

If your production evaluation should represent 2026, forcibly making the test set 0.5% positive could hide an important shift. So there is tension between:

$$
\text{statistical convenience}
$$

and

$$
\text{deployment realism}
$$

Deployment realism generally wins for the final test. You may use sampling techniques during training while still keeping validation and test distributions representative of production.

### Training distribution and evaluation distribution need not be identical

Suppose positive cases are very rare. You might deliberately oversample positives during training:

```text
training:
50% positive
50% negative
```

even though production is:

```text
1% positive
99% negative
```

That can be a valid training strategy. But if you also make the test set 50/50, metrics such as accuracy, precision, and calibration may no longer reflect deployment. The test set should generally resemble the population whose performance you want to estimate.

This distinction is useful:

$$
\text{training set optimized for learning}
$$

versus

$$
\text{test set optimized for honest measurement}
$$

Those are different objectives.

### Sample size determines how much you can trust the metric

Suppose two models score:

$$
84.1\%
$$

and

$$
84.3\%
$$

on a test set of 200 examples. That difference may merely be random noise. A metric from a finite test sample is itself an estimate:

$$
\hat{M}_{test}
$$

of some unknown population performance:

$$
M_{production}
$$

The smaller or rarer the relevant sample, the larger the uncertainty. This is why serious evaluation may include:

* confidence intervals
* bootstrap estimates
* repeated evaluations
* significance tests where appropriate

The important first principle is:

A test score is not an exact property of the model. It is an estimate produced from a finite sample.

### Validation data can become scarce

Suppose you only have 5,000 examples. A fixed split like:

```text
3,000 train
1,000 validation
1,000 test
```

means the model only learns from 60% of available development data. Maybe we want to make more efficient use of the data. This motivates **cross-validation**.

![A group split keeping each entity together and a time split keeping future observations out of development data](/content-assets/articles/article-mlops-data-for-ml-systems-train-validation-test-splits/group-and-time-splits.png)

*The split boundary should match the way production must generalize, preventing both entity overlap and future information from entering development.*

## When Does Cross-Validation Improve the Development Estimate?

<!-- section-summary: Cross-validation rotates development evidence to reduce dependence on one validation sample. -->

### Cross-validation rotates the validation role

In $$k$$-fold cross-validation, development data is divided into $$k$$ parts. For five folds:

```text
Fold 1
Fold 2
Fold 3
Fold 4
Fold 5
```

First:

```text
Train: folds 2–5
Validate: fold 1
```

Then:

```text
Train: folds 1,3,4,5
Validate: fold 2
```

and so on. Each example gets a chance to serve as validation data. The final validation estimate might be:

$$
CVScore
=
\frac{1}{k}
\sum_{j=1}^{k}
Score_j
$$

This commonly gives a more stable estimate of model-selection performance than one small validation split.

### Cross-validation does not eliminate the need for a final test

Suppose you compare 200 hyperparameter settings through cross-validation. You choose the best. The cross-validation results have now influenced development extensively.

They served the validation role. You still ideally want an untouched final test set:

```text
development data
    ↓
cross-validation
    ↓
choose model

untouched test
    ↓
final evaluation
```

Cross-validation primarily improves the use of development data. It does not magically create independent final evidence.

### Cross-validation must obey the same grouping rules

Naive $$k$$-fold cross-validation randomly divides rows. That can recreate the same leakage problems as random train/test splitting. If multiple rows belong to the same patient:

$$
patient \rightarrow one fold
$$

If time ordering matters, ordinary shuffled $$k$$-fold may be inappropriate. Instead you might use something resembling:

```text
Train Jan–Mar → validate Apr
Train Jan–Apr → validate May
Train Jan–May → validate Jun
```

This is commonly called **rolling**, **walk-forward**, or **time-series cross-validation**. Again, the method should simulate deployment.

### Temporal validation is different from ordinary cross-validation

With ordinary random folds:

$$
train \leftrightarrow validation
$$

are samples from approximately the same period. With temporal evaluation:

$$
past \rightarrow future
$$

must always hold. For example:

```text
Run 1:
Train  Jan–Mar
Val    Apr

Run 2:
Train  Jan–Apr
Val    May

Run 3:
Train  Jan–May
Val    Jun
```

This asks:

"Had I trained the system at each historical point, how would it have performed immediately afterward?"

That is frequently much closer to the operational ML question.

## How Are Split Rules and Membership Made Reproducible?

<!-- section-summary: A split contract records the deployment claim, unit, clocks, boundaries, seed or hash rule, exclusions, label maturity, and allowed use. -->

### Be careful with preprocessing before splitting

Suppose you standardize a feature:

$$
z=
\frac{x-\mu}{\sigma}
$$

If you compute:

$$
\mu,\sigma
$$

using all rows before splitting, then information from validation and test contributed to training-time preprocessing. The result creates leakage. Instead:

$$
\mu_{\text{train}}
=
mean(X_{\text{train}})
$$

$$
\sigma_{\text{train}}
=
std(X_{\text{train}})
$$

Then apply the same values to validation and test:

$$
z_{\text{val}}
=
\frac{x_{\text{val}}-\mu_{\text{train}}}
{\sigma_{\text{train}}}
$$

and likewise for test. The principle is:

Any transformation that learns something from data should commonly be fitted only on the appropriate training portion.

### Leakage can happen through surprisingly ordinary preprocessing

Examples include learning:

* vocabulary
* category mappings
* imputation values
* normalization statistics
* feature selection
* target encoding
* PCA directions
* embeddings
* duplicate-removal rules based on full data
* thresholds inferred from the target

The safe conceptual pipeline is:

```text
split
  ↓
fit preprocessing on train
  ↓
transform train
transform validation
transform test
```

Not:

```text
fit preprocessing on all data
  ↓
split
```

### Duplicate examples are a serious split-integrity problem

Suppose your raw dataset accidentally contains the same photograph several times. One copy lands in training. Another lands in test.

The model appears to recognize an unseen test image. But it has effectively already seen it. The same can occur with:

* duplicate text documents
* repeated transactions
* copied web pages
* repeated images
* near-duplicate videos
* cloned customer records

So split integrity frequently needs deduplication at a level stronger than exact row IDs.

### Near-duplicates can be just as dangerous

Consider two documents:

```text
Document A:
"Company announces Q3 revenue of £4.2bn..."

Document B:
"Company announces Q3 revenue of £4.2bn..."
```

Perhaps one is a syndicated copy from another website. Different IDs. Nearly identical content.

If one is training and the other is test, the evaluation may overestimate generalization. So the correct unit for splitting might be a **content cluster** rather than an individual database row. This again returns us to the same principle:

Keep information-equivalent or strongly related examples from crossing the evaluation boundary when that would make the task artificially easy.

### Labels can leak through groups too

Imagine household credit-risk prediction. Husband's loan application goes into train. Wife's loan application goes into test.

Features include:

```text
address
household income
postcode
joint bank behavior
```

Even though the individuals differ, the examples are highly related. If deployment must generalize to new households, splitting by person is too weak. You may need:

$$
household\_id \rightarrow split
$$

Similarly:

```text
multiple devices → same user
multiple users → same organization
multiple images → same physical object
multiple samples → same biological subject
```

Choosing the correct group requires understanding how data is generated.

### A useful question: "What information could cross the boundary?"

Instead of only asking:

"Does the exact same row appear in train and test?"

ask:

"Could information from the test case have effectively appeared in training?"

Possible channels include:

* same customer
* same household
* same document
* same time period
* same event
* duplicate content
* target-derived preprocessing
* future aggregates
* statistics computed from test data

Dataset split leakage is fundamentally an **information-flow problem**.

### The split should be deterministic

Imagine creating a random split today:

```text
customer A → train
customer B → test
```

Then next month rebuilding the dataset and randomly splitting again:

```text
customer A → test
customer B → train
```

Now experiments cannot be compared cleanly. A model may appear better merely because the test set changed. So mature systems make split assignment deterministic.

For example:

$$
bucket=hash(customer\_id)\bmod 100
$$

then:

```text
0–69  → train
70–84 → validation
85–99 → test
```

The exact rule is not important. Stable membership is.

### Save exact split membership

Even if you have a deterministic rule, it is valuable to publish exact membership. Conceptually:

```text
example_id     split
A001           train
A002           train
A003           test
A004           validation
...
```

Why? Because upstream data can change. Rows can be:

* backfilled
* deleted
* deduplicated
* corrected
* newly discovered

If you need to reproduce a historical model exactly, saving split membership gives you stronger lineage. A model release should ideally be traceable to:

$$
dataset\ version
+
split\ version
+
training\ code
$$

### Split rules should be treated as versioned logic

Suppose Model A was evaluated with:

```text
random row split
```

and Model B with:

```text
future-month test split
```

Their scores are not directly comparable. A score such as:

$$
AUC = 0.91
$$

has meaning only relative to the evaluation population. So it is useful to treat:

```text
split_policy_v1
split_policy_v2
```

as first-class artifacts. Changing the split changes the experiment.

### Dataset size affects implementation, not the principle

For a 20,000-row dataset, you could assign splits in memory. For billions of examples, you might use:

* distributed SQL
* Spark
* warehouse transformations
* streaming data systems
* hash-based split functions during ingestion

But the conceptual problem remains identical:

$$
example
\rightarrow
stable\ split
$$

The infrastructure should preserve the statistical and semantic rules rather than determining them. Do not let:

"This split was easiest to implement"

become the definition of the evaluation problem.

### Hash splitting is especially useful at scale

Suppose examples are grouped by customer. You can compute something like:

$$
h=hash(customer\_id)
$$

and assign:

$$
h \bmod 100 < 70
\rightarrow train
$$

$$
70 \le h\bmod100 <85
\rightarrow validation
$$

$$
85 \le h\bmod100
\rightarrow test
$$

This has useful properties. All examples belonging to the same customer get the same split. New rows can be assigned consistently without loading the entire dataset.

Keeping both the identifier and hashing rule stable makes the assignment reproducible across rebuilds.

### But hashing cannot replace reasoning

Suppose the data should be split chronologically. Hashing timestamps randomly into train and test destroys the production simulation. Likewise, hashing individual rows when they should be grouped by patient creates leakage.

A deterministic bad split is still a bad split. The order is:

$$
\text{define generalization requirement}
$$

then:

$$
\text{choose split strategy}
$$

then:

$$
\text{choose implementation}
$$

### Split integrity should be tested explicitly

Before trusting metrics, verify the split itself. A useful integrity checklist includes checks such as:

* no exact example appears in more than one split
* grouped entities do not cross forbidden boundaries
* temporal ordering holds when required
* all labels are mature
* preprocessing was learned from training data only
* class and segment counts are sufficient
* important segments exist in evaluation
* label rates are plausible
* split sizes match expectations
* duplicates or near-duplicates are controlled
* test membership has not accidentally been used during training

A checklist helps here because several independent mechanisms can invalidate an otherwise reasonable-looking split.

### Also inspect the meaning of the differences between splits

Suppose:

```text
Train positive rate = 2%
Validation          = 2.1%
Test                = 8.7%
```

Is that a bug? Maybe. Or perhaps the test period experienced a real fraud wave.

Likewise:

```text
Train average age = 37
Test average age  = 58
```

Could indicate:

* accidental filtering
* a changed product population
* a different geographic region
* deliberate group holdout
* real drift

Do not automatically force splits to look identical. Investigate whether the difference is expected from the deployment scenario.

## How Do Integrity Checks and Release Policy Protect the Final Test?

<!-- section-summary: Integrity checks detect row, entity, group, duplicate, and time overlap; verify sample and segment coverage; and confirm deterministic membership. -->

### Metrics only describe the test population

Suppose your model gets:

$$
95\%\text{ accuracy}
$$

on a test set consisting almost entirely of US customers. You cannot automatically conclude:

"The model is 95% accurate globally."

The correct interpretation is more like:

"The model achieved 95% accuracy on examples drawn according to this test-set construction."

The stronger your test population resembles future production, the more useful that statement becomes. Thus:

$$
\text{test score}
+
\text{split definition}
$$

belong together. A metric without its evaluation population is incomplete.

### A test set can become stale

Suppose your permanent test set was created in 2022. For four years, every engineer has evaluated against it. People know:

* which segments are difficult
* which edge cases exist
* which metrics move
* where models tend to fail

Even if nobody directly trains on its rows, organizational knowledge has gradually leaked from the test set into development. Meanwhile production may have changed. So mature systems sometimes introduce:

* fresh temporal holdouts
* rolling evaluation windows
* new benchmark versions
* shadow production evaluation

The aim is to restore fresh independent evidence.

### There can be several legitimate evaluation sets

A production system might maintain:

```text
random in-distribution test
future-time test
new-customer test
new-region test
stress-test set
rare-slice benchmark
```

Each answers a different question. For example:

$$
M_{\text{future}}
$$

measures temporal generalization.

$$
M_{\text{new customers}}
$$

measures entity generalization.

$$
M_{\text{rare segment}}
$$

measures performance where the ordinary test sample is too small. There is no requirement that one test set answer every possible question.

### But one benchmark should not secretly become five optimization loops

Suppose teams tune models to maximize:

```text
main test
new-region test
rare-segment test
stress test
long-term test
```

Once all of them repeatedly guide model development, they are all functioning as validation signals. You may still need another independent final evaluation mechanism. The terminology matters less than the information flow.

Ask:

"Did seeing this dataset's results influence what we built?"

If yes, it belongs to the development feedback loop.

### Online evaluation is another layer

Offline train/validation/test splitting estimates how a model might perform. But production introduces realities that historical datasets may not reproduce:

* latency
* user reactions
* changing behavior
* feedback loops
* product interventions
* system failures

So mature systems may proceed:

$$
offline\ validation
\rightarrow
offline\ test
\rightarrow
shadow/canary
\rightarrow
online\ experiment
$$

An offline test is important, but it is not the universe's final verdict. It is one layer of evidence.

### The most important design question

Before writing code to split a dataset, complete this sentence:

"After deployment, the model must generalize from __________ to __________."

Examples:

past transactions → future transactions

existing hospitals → new hospitals

known customers → new customers

earlier interactions from the same users → their later interactions

observed geographic regions → unseen regions

old fraud strategies → emerging fraud strategies

After that deployment boundary is explicit, the team can judge a split against a concrete future use.

### Worked example: churn prediction

Suppose the product question is:

Every Monday, predict whether each currently active subscriber will cancel within the following 30 days.

Historical examples span:

```text
January 2024 – June 2026
```

Customers may appear weekly. Production behavior is:

$$
\text{historical data}
\rightarrow
\text{future weeks}
$$

So a temporal split makes sense. Perhaps:

```text
Train:
Jan 2024 – Dec 2025

Validation:
Jan 2026 – Mar 2026

Test:
Apr 2026 – Jun 2026
```

During development, we train different models on the training period and choose among them based on January–March. Once choices are frozen, April–June provides the final historical simulation. The test asks:

"If we'd finished development at the end of March, how would this system have performed over the following three months?"

That has a clear operational meaning.

### But suppose the actual product goal changes

Now suppose the churn product is specifically for newly acquired customers. The business asks:

"Will this work on customers acquired after the model was developed?"

A pure time split may already help, because future customers entered later. But perhaps long-lived customers appearing in both train and test dominate the dataset. Then the measured score mostly reflects existing-customer generalization.

You may instead construct the test cohort using:

$$
signup\_time > training\ cutoff
$$

Now test customers are genuinely unseen entities. Same dataset. Different split.

Different question.

### Worked example: medical prediction

Suppose 50 hospitals provide patient records. You randomly split patients within every hospital. Result:

$$
AUC=0.91
$$

Excellent. But then the model is deployed at Hospital 51 and gets:

$$
AUC=0.72
$$

Was the original evaluation wrong? Not necessarily. It answered:

"Does this model work on new patients from hospitals represented during training?"

Production asked:

"Does it generalize to a new hospital with different workflows, equipment, coding practices, and patient population?"

A hospital-held-out test would have better simulated that deployment. This illustrates a crucial principle:

$$
\boxed{\text{A test score is only as relevant as the split behind it}}
$$

### Worked example: fraud

Suppose one credit card can generate thousands of transactions. Random transaction split:

```text
transactions from card A → train and test
```

This evaluates:

"Can the model predict new transactions from cards it may already know?"

That might be correct if production mostly deals with existing cards. But suppose your actual concern is fraud on newly issued cards. Then split by card:

$$
card\_id \rightarrow split
$$

Now no test card appears during training. Neither strategy is universally right. They test different kinds of novelty.

### A useful mathematical view

Let:

$$
P_{\text{train}}(X,Y)
$$

be the distribution represented by training. Let:

$$
P_{\text{prod}}(X,Y)
$$

be the production distribution we ultimately care about. What we really want to estimate is:

$$
E_{(X,Y)\sim P_{\text{prod}}}
[L(f(X),Y)]
$$

But production data may not yet exist. So we create a test set:

$$
D_{\text{test}}
$$

that attempts to approximate samples from:

$$
P_{\text{prod}}
$$

The quality of the test estimate therefore depends on two things:

$$
\text{enough independent test examples}
$$

and

$$
P_{\text{test}}\approx P_{\text{prod}}
$$

This is the theoretical heart of dataset splitting.

### Why "80/10/10" is not a first principle

People frequently memorize:

```text
80% train
10% validation
10% test
```

But nothing fundamental says those ratios are correct. Suppose you have one billion examples. A 10% test set gives:

$$
100,000,000
$$

test examples. That may be vastly more than needed. Perhaps:

```text
99.8% train
0.1% validation
0.1% test
```

is plenty. Conversely, with 1,000 rare medical cases, a 10% test gives only 100 examples. That may be inadequate.

The right sizes depend on:

$$
\text{amount needed to learn}
$$

and

$$
\text{amount needed to measure reliably}
$$

not a universal percentage.

### More training data and more test data solve different problems

Increasing training data can improve the model:

$$
N_{\text{train}}\uparrow
\Rightarrow
potential\ model\ quality\uparrow
$$

Increasing test data does not teach the model anything. Instead it improves confidence in measurement:

$$
N_{\text{test}}\uparrow
\Rightarrow
evaluation\ uncertainty\downarrow
$$

This is an important tradeoff when data is limited. Training data buys **learning**. Test data buys **knowledge about performance**.

Validation data buys **better development decisions**.

### Once the model is chosen, can we retrain on train + validation?

Often yes. Suppose validation identified the best hyperparameters. You may then train a final model using:

$$
D_{\text{train}}\cup D_{\text{validation}}
$$

while keeping:

$$
D_{\text{test}}
$$

untouched. This uses more data for the final fit. But there is a subtlety: the exact final model has now been trained on examples that were previously validation cases.

That's okay because validation's role is over. The untouched test set remains the independent evaluator.

### Should the model be retrained on the test set after final evaluation?

Potentially for a final deployed model, organizations sometimes eventually train on all available labeled data. But once the model trains on the old test set:

$$
D_{\text{test}}
\rightarrow training
$$

that dataset can no longer provide an independent evaluation of the newly trained model. You need fresh future data or another untouched holdout to evaluate it. Evidence can be consumed.

That is a useful way to think about test datasets.

### Test data is a finite resource

Not because the rows physically disappear. Because every time results influence decisions, some of their independence is consumed. You can model this conceptually as:

```text
untouched test
      ↓ first evaluation
some information revealed
      ↓ repeated debugging
more information revealed
      ↓ extensive tuning
effectively validation data
```

This is why organizations sometimes restrict access to benchmark labels or limit submission frequency. They are preserving independent evidence.

### Splitting should happen at the right point in the pipeline

A healthy conceptual order is:

```text
Define prediction problem
        ↓
Construct valid historical examples
        ↓
Determine independence/generalization unit
        ↓
Assign examples/groups/times to splits
        ↓
Fit training-derived preprocessing
        ↓
Train models
        ↓
Use validation for development
        ↓
Freeze system
        ↓
Evaluate on test
```

Notice that splitting comes before any learned preprocessing. But it comes after determining what a valid example means. You should not split corrupted examples and hope the split makes them valid.

### Dataset construction and splitting solve different problems

Training-data construction asks:

"Is each row a legitimate historical prediction example?"

Splitting asks:

"Which examples may influence learning and development, and which must remain independent?"

A dataset can have perfect splits but terrible feature leakage. Or perfectly point-in-time-correct rows but a terrible random split that mixes patient identities. Both levels matter.

### The complete information-boundary view

There are actually two important boundaries in ML data. The first is **within each example**:

```text
past information | future outcome
    features      |    label
```

The control prevents prediction-time leakage. The second is **between examples**:

```text
development data | final evaluation data
 train + val      | test
```

The control prevents evaluation leakage. So reliable ML needs both:

$$
\boxed{\text{time/information integrity inside rows}}
$$

and

$$
\boxed{\text{independence integrity across splits}}
$$

This connects the way examples are constructed directly to the way train, validation, and test evidence is separated.

### A compact dataset-split specification

A serious ML project should be able to state something like:

Examples before January 1, 2026 are eligible for development. Examples from January through March 2026 form validation. Examples from April through June 2026 form the locked test set. Labels must be mature before the dataset cutoff. All examples for the same transaction remain together by definition. Preprocessing statistics are fitted only on training data. Test membership is immutable and versioned as `split_policy_v4`.

For another system:

Users are deterministically hashed into splits, so no user appears in more than one split. Seventy percent of users are assigned to training, fifteen percent to validation, and fifteen percent to test. The assignment is stable across dataset rebuilds.

These descriptions are much more meaningful than:

"We used an 80/20 split."

Imagine building an ML system at historical time $$T$$. Everything before $$T$$ is available to you. Everything after $$T$$ is genuinely unknown.

You design your model using the past. Then time advances. New examples arrive.

You measure what happens. That is the real production process:

$$
past
\rightarrow
build
\rightarrow
future
\rightarrow
evaluate
$$

A good dataset split is a historical simulation of that process. For grouped deployment:

$$
known\ groups
\rightarrow
build
\rightarrow
new\ groups
\rightarrow
evaluate
$$

For geographic deployment:

$$
known\ regions
\rightarrow
build
\rightarrow
new\ regions
\rightarrow
evaluate
$$

The split should reproduce whatever boundary production will cross.

#### What to remember

Dataset splitting is not fundamentally about randomly assigning 80% of rows to one table and 20% to another. It is about creating **independent evidence about generalization**. Training data answers:

$$
\boxed{\text{What should the model learn?}}
$$

Validation data answers:

$$
\boxed{\text{Which model and development choices should we prefer?}}
$$

Test data answers:

$$
\boxed{\text{How well does the finished development process work on genuinely unseen cases?}}
$$

The hardest part is deciding what **"unseen"** should mean. It might mean:

$$
\text{new row}
$$

but frequently it really means:

$$
\text{future time}
$$

or:

$$
\text{new customer}
$$

or:

$$
\text{new patient}
$$

or:

$$
\text{new hospital}
$$

or:

$$
\text{new geographic region}
$$

or a combination of them. The split must therefore follow this rule:

$$
\boxed{
\text{Design the split to reproduce the boundary the model must cross in production.}
}
$$

Then keep that boundary clean: related examples should stay on one side, preprocessing should learn only from allowed data, repeated tuning should preserve the final test set, rare and important cases should be sufficiently represented, and exact split membership should be reproducible and versioned. A model's reported metric is meaningful only if you can answer:

**What was the model prevented from seeing, and why does that resemble what will be new after deployment?**

![Six parts of a data split contract producing trustworthy train, validation, and test evaluation](/content-assets/articles/article-mlops-data-for-ml-systems-train-validation-test-splits/data-split-contract-summary.png)

*A durable split contract records the unit, time and group rules, seed, exact row membership, and integrity checks behind the evaluation.*

## Check Your Answers

Use these answers to revisit the evidence, boundaries, and operating decisions behind each question.

:::expand[Why Do Training, Validation, and Test Data Need Different Roles?]{kind="recap"}
Training data fits model and preprocessing parameters.

Validation data guides choices among candidates and operating policies. A protected test evaluates the frozen procedure and product scope after those choices are complete. The separation prevents the same evidence from teaching the system and serving as independent proof of its quality.
:::

:::expand[How Does Repeated Tuning Use Up Independent Evaluation Evidence?]{kind="recap"}
Every feature, threshold, model, or policy choice made after inspecting an evaluation result adapts development to that sample.

The model may never fit the labels directly, yet the team can still overfit the reported score. Test evidence is therefore a finite resource, and a changed candidate needs fresh protected evidence.
:::

:::expand[What Does Unseen Data Mean for the Real Deployment?]{kind="recap"}
Unseen data must name the intended novelty: a new row, later time, new entity, household, site, geography, or operating regime.

The split unit and boundary should reproduce that novelty. A random row split supports an independent-row claim only if related examples and future conditions are outside the deployment challenge.
:::

:::expand[How Do Group and Time Boundaries Prevent Related Cases from Crossing Splits?]{kind="recap"}
Group rules preserve information-equivalent cases such as visits from one patient, devices from one household, or near-duplicate documents together.

Time rules place rows according to prediction time and preserve chronological order. Combined group-time designs are needed if deployment must generalize across both new entities and future periods.
:::

:::expand[How Should Rare Outcomes and Important Segments Be Represented?]{kind="recap"}
Each reported outcome and segment needs enough independent examples to support the metric and its uncertainty.

Training may rebalance rare classes, while validation and test ordinarily preserve the evaluation population. Segment counts, prevalence, confidence intervals, and dependency-aware resampling prevent a large global sample from hiding weak subgroup evidence.
:::

:::expand[When Does Cross-Validation Improve the Development Estimate?]{kind="recap"}
Cross-validation rotates development evidence to reduce dependence on one validation sample.

Its folds must preserve the same group, time, leakage, and preprocessing boundaries as deployment. Nested selection can help with heavy tuning, while a final test outside every fold still evaluates the frozen development procedure.
:::

:::expand[How Are Split Rules and Membership Made Reproducible?]{kind="recap"}
A split contract records the deployment claim, unit, clocks, boundaries, seed or hash rule, exclusions, label maturity, and allowed use.

An immutable manifest stores exact example membership. Together with pinned data, code, and configuration, those records reconstruct the same partitions rather than merely repeat a percentage.
:::

:::expand[How Do Integrity Checks and Release Policy Protect the Final Test?]{kind="recap"}
Integrity checks detect row, entity, group, duplicate, and time overlap; verify sample and segment coverage; and confirm deterministic membership. Release policy limits access to test labels, records each consumption, freezes the candidate before evaluation, and requires fresh evidence if the result influences another development decision.
:::

## References
