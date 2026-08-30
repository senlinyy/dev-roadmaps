---
title: "Notebook to Production"
description: "Learn how exploratory model work matures into reusable code, explicit configuration, tested data contracts, tracked jobs, release candidates, and operated production releases."
overview: "Notebooks are excellent laboratories for exploring data and model ideas. Production adds a repeatable path around that work: reusable modules, external configuration, tests, immutable data identity, tracked jobs, continuous integration, candidate evaluation, controlled release, and operational ownership."
tags: ["MLOps", "core", "teams"]
order: 2
id: "article-mlops-mlops-foundations-notebook-to-production-workflow"
---

## Table of Contents

1. [What Separates Exploration from Production Execution?](#what-separates-exploration-from-production-execution)
2. [What Production Contract Should Be Defined Before Code Is Extracted?](#what-production-contract-should-be-defined-before-code-is-extracted)
3. [How Does Notebook Logic Become an Explicit Reusable Program?](#how-does-notebook-logic-become-an-explicit-reusable-program)
4. [How Do Tests Prove the Training Workflow?](#how-do-tests-prove-the-training-workflow)
5. [How Do Jobs, Runs, and Artifacts Make Training Reproducible?](#how-do-jobs-runs-and-artifacts-make-training-reproducible)
6. [How Does a Trained Candidate Reach a Controlled Production Release?](#how-does-a-trained-candidate-reach-a-controlled-production-release)
7. [How Do Monitoring and Feedback Lead to the Next Candidate?](#how-do-monitoring-and-feedback-lead-to-the-next-candidate)
8. [What Minimum Stack and Maturity Path Should a Team Build First?](#what-minimum-stack-and-maturity-path-should-a-team-build-first)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A notebook works on Maya's laptop. She ran the cells in the right order, installed one package by hand, and used a CSV she edited locally. A teammate opens the same notebook the next week and gets a different result. Nothing in the file explains which data, package versions, configuration, or cell state produced Maya's model.

The notebook is still useful. It is where Maya explored the data, tested features, compared models, and explained what she learned. Production work begins when the stable parts move into reusable functions, declared configuration, tests, a controlled training job, and versioned outputs that another person can run.

“Notebook to production” means turning a promising experiment into a repeatable process and then a controlled release. It does not mean placing the notebook inside a container and calling the work finished.

Follow that change from exploration to operation:

1. **What Separates Exploration from Production Execution?**
2. **What Production Contract Should Be Defined Before Code Is Extracted?**
3. **How Does Notebook Logic Become an Explicit Reusable Program?**
4. **How Do Tests Prove the Training Workflow?**
5. **How Do Jobs, Runs, and Artifacts Make Training Reproducible?**
6. **How Does a Trained Candidate Reach a Controlled Production Release?**
7. **How Do Monitoring and Feedback Lead to the Next Candidate?**
8. **What Minimum Stack and Maturity Path Should a Team Build First?**

## What Separates Exploration from Production Execution?

<!-- section-summary: Exploration optimizes a short human learning loop and can tolerate interactive state. -->

The phrase **“notebook to production”** sounds like it means:

“Take a Jupyter notebook and deploy it.”

That is not quite right. The deeper idea is:

> **Turn an experiment that works once for one person into a system that can work repeatedly, predictably, and safely for other people and real users.**

Making that transition is a central reason teams adopt MLOps practices.

### The fundamental difference

A notebook is optimized for **exploration**. Production is optimized for **reliability**. Those are different goals.

In a notebook, you might write:

```python
df = pd.read_csv("customers.csv")

df["age"] = df["age"].fillna(df["age"].median())

X = df[["age", "income", "transactions"]]
y = df["churned"]

model.fit(X, y)
```

You run the cells. It works. You get:

```text
Accuracy = 91%
```

That's valuable. But production asks many more questions. Which version of `customers.csv` did you use?

Which version of the code? Which package versions? What random seed?

What happens if `age` is missing tomorrow? What if the schema changes? Where is the trained model stored?

How is it deployed? Who approved it? What happens if accuracy falls?

What happens if the prediction service crashes? Can you reproduce this exact model six months later? A notebook commonly does not answer those questions.

So:

$$
\boxed{
\text{Notebook Success}
\neq
\text{Production Readiness}
}
$$

### What a notebook actually gives you

Suppose you are building a churn model. Conceptually:

$$
x
=
(\text{age},\text{income},\text{usage},\text{tenure})
$$

and:

$$
f_\theta(x)
\rightarrow
P(\text{churn})
$$

Your notebook helps you discover a good $$f_\theta$$. You might experiment with:

* missing-value handling,
* feature transformations,
* logistic regression,
* random forests,
* gradient boosting,
* hyperparameters,
* evaluation metrics.

The notebook answers:

**“Can this idea work?”**

Production needs to answer:

**“Can we make this idea work repeatedly under real operating conditions?”**

That is a much larger problem.

### The notebook-to-production journey

At a high level, the transformation looks like:

$$
\text{Exploration}
\rightarrow
\text{Definition}
\rightarrow
\text{Reusable Code}
\rightarrow
\text{Tests}
\rightarrow
\text{Reproducible Training}
\rightarrow
\text{Evaluation}
\rightarrow
\text{Registration}
\rightarrow
\text{Deployment}
\rightarrow
\text{Monitoring}
\rightarrow
\text{Feedback}
$$

Notice that **deployment is only one step**. A common beginner misconception is:

$$
\text{Notebook}
\rightarrow
\text{Docker}
\rightarrow
\text{Production}
$$

But putting notebook code inside a container doesn't automatically make it production-quality. The hard part is creating guarantees around the entire lifecycle.

## What Production Contract Should Be Defined Before Code Is Extracted?

<!-- section-summary: Define the user and decision, prediction moment, affected population, target, permitted inputs, output meaning, product action, success measures, guardrails, ownership, deadline, and fallback. -->

### Before engineering anything, decide what the model actually does

Suppose a notebook predicts churn. Before turning it into production code, define the contract of the ML system. For example:

#### Input

```text
customer_id
account_age_days
monthly_spend
support_tickets_30d
sessions_30d
```

#### Output

```text
churn_probability = 0.82
```

But even that isn't enough. What does `0.82` mean operationally? Maybe:

$$
P(\text{churn}) > 0.7
\Rightarrow
\text{send retention offer}
$$

Now we have an actual product decision. The production system is therefore:

$$
\text{Customer Data}
\rightarrow
\text{Features}
\rightarrow
\text{Model}
\rightarrow
\text{Probability}
\rightarrow
\text{Decision}
$$

You should know which part the model owns.

### Define how predictions will happen

One of the first production decisions is **when** predictions are needed. There are two common possibilities.

#### Batch prediction

Perhaps the business wants a list of likely churners every morning. Then:

```text
Every day at 02:00
        ↓
Load customers
        ↓
Calculate features
        ↓
Run model
        ↓
Write predictions
        ↓
Marketing uses results
```

Latency of an individual prediction may not matter much. A 20-minute batch job might be perfectly acceptable.

#### Online prediction

Suppose the prediction is required while a customer is using your application. Then:

```text
Request
   ↓
Fetch features
   ↓
Model inference
   ↓
Return result
```

perhaps under:

$$
100\text{ ms}
$$

Now latency, availability, concurrency, and scaling become critical. The same model can require very different engineering depending on how it is used. So productionization begins with:

$$
\boxed{
\text{What does the business need the prediction to do?}
}
$$

not:

$$
\boxed{
\text{Which deployment technology should we use?}
}
$$

![Notebook exploration compared with the explicit package, data, configuration, environment, and outputs of a repeatable production job](/content-assets/articles/article-mlops-mlops-foundations-notebook-to-production-workflow/experiment-to-repeatable-job.png)

*Exploration remains interactive. Stable behavior moves into a production job whose inputs, runtime, and outputs have explicit sources and identities.*

## How Does Notebook Logic Become an Explicit Reusable Program?

<!-- section-summary: Move stable transformations, training, evaluation, and prediction logic into importable functions and packages with named inputs and outputs. -->

### The first major transformation: separate exploration from execution

Notebook code is frequently written like this:

```python
df = pd.read_csv("data.csv")
df = clean_data(df)

model = XGBClassifier(max_depth=8)
model.fit(df[features], df["label"])

preds = model.predict(df[features])
```

This is fine for exploration. But production benefits from separable functions:

```python
def load_data(path):
    ...

def validate_data(df):
    ...

def build_features(df):
    ...

def train_model(X, y, config):
    ...

def evaluate_model(model, X, y):
    ...

def save_model(model, path):
    ...
```

Then execution becomes:

```python
def train():
    df = load_data(...)
    validate_data(df)

    X, y = build_features(df)

    model = train_model(X, y, config)
    metrics = evaluate_model(model, X, y)

    save_model(model, ...)
```

Why is this better? Because individual parts can now be:

* tested,
* reused,
* replaced,
* called automatically,
* versioned,
* monitored.

This is the first big conceptual move:

$$
\text{Notebook Cells}
\rightarrow
\text{Reusable Program}
$$

### Why notebooks become fragile

Consider this innocent sequence:

```text
Cell 1 → load data
Cell 2 → clean data
Cell 3 → create feature
Cell 4 → train model
Cell 5 → redefine feature
Cell 6 → rerun training
```

What state was actually used? Possibly:

$$
1 \rightarrow 2 \rightarrow 3 \rightarrow 5 \rightarrow 4
$$

instead of:

$$
1 \rightarrow 2 \rightarrow 3 \rightarrow 4 \rightarrow 5 \rightarrow 6
$$

Interactive environments can contain hidden state. For example:

```python
learning_rate = 0.1
```

gets changed later to:

```python
learning_rate = 0.01
```

Then only some cells are rerun. You may no longer know exactly how the final model was created. Production systems prefer explicit execution:

```bash
python train.py --config config.yaml
```

where everything required for the run is declared.

### Make configuration explicit

A notebook frequently contains values scattered through cells:

```python
learning_rate = 0.03
max_depth = 7
test_size = 0.2
random_state = 42
```

Production code should generally separate configuration from implementation. For example:

```yaml
data:
  training_dataset: customers_v17

model:
  type: xgboost
  max_depth: 7
  learning_rate: 0.03

training:
  random_seed: 42

evaluation:
  minimum_auc: 0.88
```

Now you can distinguish:

$$
\text{Program Logic}
$$

from:

$$
\text{Run Configuration}
$$

Two runs can execute the same source code and still train different models because their configuration values differ.

### A trained model is the result of more than code

Suppose this commit:

```text
git commit = 8a217c
```

created your model. Is that enough information to recreate it? Usually not.

Training is closer to:

$$
M =
F(C,D,H,E,R)
$$

where:

* $$C$$ = code,
* $$D$$ = training data,
* $$H$$ = hyperparameters/configuration,
* $$E$$ = execution environment,
* $$R$$ = randomness.

So model reproducibility requires tracking more than Git. Conceptually:

$$
\boxed{
\text{Model Version}
=
\text{Code}
+
\text{Data}
+
\text{Config}
+
\text{Environment}
+
\text{Training Metadata}
}
$$

### The second major transformation: make training reproducible

Suppose you train:

```text
churn-model-v12
```

and it performs very well. Three months later someone asks:

“Can you recreate v12?”

A mature system should ideally know:

```text
Code commit: 8a217c
Dataset: customer-training-2026-07-01
Python: 3.13
scikit-learn: 1.x
Random seed: 42
Hyperparameters: ...
Feature definitions: ...
Training job: run-4832
```

The goal isn't necessarily bit-for-bit equality in every ML framework. The aim is enough lineage to understand:

**Where did this model come from?**

### The environment is part of the model

Suppose your notebook runs with:

```text
Python 3.x
pandas version A
scikit-learn version B
xgboost version C
```

while production runs different versions. That can produce different behavior. So:

$$
\text{Executable ML System}
=
\text{Code}
+
\text{Dependencies}
$$

A dependency file might declare them. For example:

```text
pandas
scikit-learn
xgboost
```

Often with controlled versions. Containers can go further:

```text
Code
+
Python
+
Libraries
+
OS dependencies
\rightarrow
Container Image
```

A container cannot guarantee a reproducible result on its own. It does, however, remove many differences between execution environments.

## How Do Tests Prove the Training Workflow?

<!-- section-summary: Unit tests protect feature, label, split, and policy logic. -->

### Then test the training workflow

A notebook frequently tells us:

“The code ran successfully once.”

Testing asks something stronger:

“What properties should always remain true?”

Consider:

```python
def make_features(df):
    ...
```

A unit test might verify:

```python
assert "monthly_spend_30d" in features.columns
assert features["monthly_spend_30d"].isna().sum() == 0
```

You're converting assumptions into executable checks. That is crucial.

### ML needs several kinds of tests

Traditional software commonly tests:

$$
\text{Input}
\rightarrow
\text{Deterministic Output}
$$

ML has more dimensions. A useful mental model is:

$$
\text{ML Testing}
=
\text{Code Tests}
+
\text{Data Tests}
+
\text{Training Tests}
+
\text{Model Tests}
+
\text{Integration Tests}
$$

#### Code tests

Does the transformation behave correctly?

```python
assert normalize_age(50) == expected_value
```

#### Data tests

Does the incoming dataset satisfy expectations? For example:

$$
0 \leq age \leq 120
$$

or:

```text
customer_id cannot be null
monthly_spend >= 0
country must belong to allowed set
```

#### Training smoke tests

Can the pipeline train on a small sample? For example:

```text
100 rows
↓
feature generation
↓
training
↓
model produced successfully
```

This catches broken wiring without paying for a full training run.

#### Model quality tests

Does the model satisfy minimum performance requirements? For example:

$$
AUC \geq 0.88
$$

or:

$$
Recall_{\text{fraud}} \geq 0.80
$$

#### Integration tests

Do the pieces work together? For example:

```text
Raw Data
→ Features
→ Model
→ Prediction
```

with the same interfaces that production will use.

### Test assumptions, not merely syntax

One of the most important lessons in ML productionization is that many failures come from violated assumptions. Your notebook silently assumes:

$$
\text{column "income" exists}
$$

$$
income \geq 0
$$

$$
currency = GBP
$$

$$
\text{customer\_id is unique}
$$

$$
\text{training label is available}
$$

These assumptions should become explicit checks wherever practical. A production pipeline should prefer:

$$
\text{Unexpected Input}
\rightarrow
\text{Clear Failure}
$$

over:

$$
\text{Unexpected Input}
\rightarrow
\text{Quietly Bad Model}
$$

## How Do Jobs, Runs, and Artifacts Make Training Reproducible?

<!-- section-summary: A controlled job executes a reviewed package against an exact data snapshot, split identity, resolved configuration, runtime, compute context, and workload identity. -->

### Training becomes a job, not a manual session

In the notebook stage:

```text
Scientist opens laptop
        ↓
Opens notebook
        ↓
Runs cells
        ↓
Produces model
```

Production-oriented training should become closer to:

```text
Trigger
  ↓
Known code version
  ↓
Known data
  ↓
Known configuration
  ↓
Controlled environment
  ↓
Training
  ↓
Evaluation
  ↓
Stored artifact + metadata
```

The trigger might be:

* manual,
* scheduled,
* new data arriving,
* a source-code change,
* a retraining policy.

The key change is:

$$
\text{Human Procedure}
\rightarrow
\text{Executable Workflow}
$$

### Track the experiment that produced the model

Suppose you run five training jobs.

| Run | Depth | Learning rate |  AUC |
| --- | ----: | ------------: | ---: |
| 101 |     4 |          0.10 | 0.86 |
| 102 |     6 |          0.05 | 0.89 |
| 103 |     8 |          0.03 | 0.91 |
| 104 |    10 |          0.03 | 0.90 |
| 105 |     8 |          0.01 | 0.89 |

Without experiment tracking, this frequently ends up as:

```text
final_model.pkl
final_model2.pkl
actually_final_model.pkl
final_model_best.pkl
```

That is not lineage. A training run should ideally record:

$$
\text{Parameters}
+
\text{Metrics}
+
\text{Artifact}
+
\text{Lineage}
$$

Then you can say:

```text
run-103
→ code abc123
→ dataset customer-v14
→ max_depth 8
→ AUC 0.91
→ produced model artifact XYZ
```

![A trained model crossing data, model-quality, system, and release-review gates before receiving production traffic](/content-assets/articles/article-mlops-mlops-foundations-notebook-to-production-workflow/model-release-gates.png)

*A candidate reaches production only after its data, model behavior, runtime package, and residual risk have passed distinct reviews. Failed gates preserve evidence and return the work to its owner.*

## How Does a Trained Candidate Reach a Controlled Production Release?

<!-- section-summary: CI tests and packages reviewed source. -->

### A model artifact is not automatically a production model

Training produces an artifact:

```text
model.pkl
```

or:

```text
model.onnx
```

or some framework-specific format. But now a new decision appears:

**Should this artifact be used in production?**

That requires evaluation. So we should distinguish:

$$
\text{Candidate Model}
$$

from:

$$
\text{Approved Model}
$$

### Decide whether the model is actually better

Suppose the current production model has:

$$
AUC = 0.89
$$

and the candidate has:

$$
AUC = 0.91
$$

Should we deploy? Maybe. But perhaps:

| Metric        | Current | Candidate |
| ------------- | ------: | --------: |
| AUC           |    0.89 |      0.91 |
| Recall        |    0.84 |      0.78 |
| P95 inference |   40 ms |    280 ms |
| Memory        |  300 MB |      4 GB |

The candidate is “better” according to one metric and worse according to others. Model readiness therefore requires multiple dimensions:

$$
\text{Production Readiness}
=
f(
\text{Quality},
\text{Latency},
\text{Cost},
\text{Robustness},
\text{Risk}
)
$$

There is no universal single score.

### Compare candidates against explicit requirements

A useful production gate might look conceptually like:

```text
AUC >= 0.90
AND recall >= 0.80
AND P95 latency <= 100 ms
AND required data checks pass
AND fairness checks pass
AND integration tests pass
```

Only then:

```text
Candidate
   ↓
APPROVED
```

This converts:

“This model seems good.”

into:

“This model satisfies the requirements we agreed on.”

That is a major maturity step.

### Model registries solve a different problem from experiment trackers

It's useful to distinguish two ideas. An **experiment tracker** answers:

What happened during training?

A **model registry** answers:

Which model artifacts exist, and what is their lifecycle state?

For example:

```text
churn-model

v21 → archived
v22 → production
v23 → candidate
v24 → rejected
```

The registry gives the organization a controlled identity for model artifacts. Conceptually:

$$
\text{Training Runs}
\rightarrow
\text{Candidate Artifact}
\rightarrow
\text{Registry}
\rightarrow
\text{Approval}
\rightarrow
\text{Deployment}
$$

### Then package inference separately from training

Training asks:

“How do I create the model?”

Inference asks:

“How do I use the trained model?”

Those are distinct operations. Training might look like:

```python
model.fit(X_train, y_train)
save(model)
```

Inference might look like:

```python
model = load_model(...)

def predict(features):
    return model.predict_proba(features)
```

In production, you generally do **not** want to retrain the model every time somebody asks for a prediction. So:

$$
\text{Training}
\neq
\text{Inference}
$$

Separating them makes architecture much clearer.

### Feature logic creates a subtle production problem

Suppose training includes:

```python
df["avg_order_value"] = df["total_spend"] / df["num_orders"]
```

But the production serving code computes:

```python
avg_order_value = total_spend / max(num_orders, 1)
```

The model was trained using one definition and served using another. The result creates:

$$
\text{Training Features}
\neq
\text{Serving Features}
$$

frequently called **training-serving skew**. Even small differences can produce poor predictions. So a strong principle is:

$$
\boxed{
\text{Feature semantics must remain consistent between training and serving.}
}
$$

Teams protect that consistency with shared transformation code, tested feature pipelines, and, where useful, a feature store.

### Deployment means exposing the model to real work

Deployment can take many forms. For batch:

```text
Scheduled Job
   ↓
Load approved model
   ↓
Read today's customers
   ↓
Generate predictions
   ↓
Write predictions table
```

For online serving:

```text
Application
   ↓
HTTP / RPC Request
   ↓
Prediction Service
   ↓
Feature Processing
   ↓
Model
   ↓
Response
```

Example:

```json
{
  "customer_id": "123",
  "churn_probability": 0.82
}
```

Putting a model into production starts with the way predictions will actually be consumed. An API is only one possible delivery design.

### Safe deployment is usually gradual

Suppose version 24 looks better offline. Should you immediately send 100% of production traffic to it? Often not.

You can reduce risk with deployment strategies.

#### Shadow deployment

In a shadow release, live requests also reach the candidate, while its responses remain observation-only and cannot affect users.

```text
Request
   ├── Production model → actual decision
   └── Candidate model → observation only
```

This lets you see how it behaves on real traffic.

#### Canary deployment

Send a small fraction to the new model. For example:

$$
95\% \rightarrow v23
$$

$$
5\% \rightarrow v24
$$

If v24 behaves correctly, increase its share.

#### A/B testing

Split users into controlled groups.

```text
Group A → old model
Group B → new model
```

Then measure actual downstream outcomes. Offline model quality and real-world business impact are not always the same thing.

### Production requires rollback

A deployment process that only knows how to move forward is incomplete. Suppose:

```text
v24 deployed
     ↓
conversion falls 12%
```

You should be able to return to:

```text
v23
```

quickly and reliably. So:

$$
\text{Safe Deployment}
=
\text{Release Capability}
+
\text{Rollback Capability}
$$

That is why keeping immutable, versioned model artifacts matters.

## How Do Monitoring and Feedback Lead to the Next Candidate?

<!-- section-summary: Operations observes delivery health, input quality, prediction behaviour, delayed labels, segment performance, and business outcomes. -->

### Deployment is not the end

A common lifecycle diagram stops here:

$$
\text{Train}
\rightarrow
\text{Deploy}
$$

For ML, that is deeply incomplete. The real lifecycle is:

$$
\text{Train}
\rightarrow
\text{Deploy}
\rightarrow
\text{Observe}
\rightarrow
\text{Learn}
\rightarrow
\text{Retrain}
$$

Production generates information about whether your assumptions were correct. So monitoring is part of model development.

### Monitor the system at several layers

An ML system can fail even when the API hasn't crashed. The consequence is monitoring must cover multiple layers. A useful framework is:

$$
\boxed{
\text{Infrastructure}
+
\text{Data}
+
\text{Model}
+
\text{Business}
}
$$

#### Infrastructure monitoring

Examples:

$$
\text{Latency}
$$

$$
\text{CPU}
$$

$$
\text{Memory}
$$

$$
\text{Request Error Rate}
$$

$$
\text{Availability}
$$

For example:

```text
P95 latency = 73 ms
error rate = 0.08%
availability = 99.98%
```

### Data monitoring

Production inputs may change. Suppose training contained:

$$
age \sim 18 \text{ to } 75
$$

but production suddenly contains values:

```text
420
-7
999
```

Something upstream may have broken. Data monitoring examines things like:

* schema,
* missing values,
* ranges,
* categories,
* freshness,
* distributions.

A critical idea is:

$$
P_{train}(X)
$$

versus:

$$
P_{production}(X)
$$

A large difference between those distributions is evidence that an assumption made during training may no longer describe production.

### Model monitoring

Now consider predictions themselves. Suppose the historical distribution was roughly:

$$
P(\hat y = \text{high risk}) = 0.07
$$

but suddenly:

$$
P(\hat y = \text{high risk}) = 0.58
$$

Maybe the world changed. Maybe the data broke. Maybe feature logic changed.

Prediction monitoring gives you another diagnostic signal. When ground truth eventually becomes available, you can also monitor real model quality. For example:

$$
Precision_t
$$

$$
Recall_t
$$

$$
AUC_t
$$

over time.

### Ground truth may arrive late

This is an important ML-specific complication. Suppose you're predicting whether someone will default within 90 days. Today:

```text
Model predicts:
P(default) = 0.72
```

You don't know whether that prediction was correct today. You may need to wait months. Therefore there are two monitoring periods.

#### Before labels arrive

Monitor proxies:

```text
data distributions
prediction distributions
missing values
system health
```

#### After labels arrive

Monitor actual predictive performance:

$$
\text{accuracy}
$$

$$
\text{precision}
$$

$$
\text{recall}
$$

etc. This makes ML monitoring fundamentally different from simple application monitoring.

### Business monitoring is often the most important layer

Suppose:

```text
API health = perfect
data = valid
prediction distribution = normal
accuracy = stable
```

Yet customers stop buying. The model may still be hurting the business. Ultimately the important metric may be:

$$
\text{Revenue}
$$

or:

$$
\text{Fraud Loss Prevented}
$$

or:

$$
\text{Customer Retention}
$$

or:

$$
\text{Manual Review Rate}
$$

So the full monitoring relationship is:

$$
\text{Infrastructure Metrics}
\rightarrow
\text{Is it running?}
$$

$$
\text{Data Metrics}
\rightarrow
\text{Are the inputs sane?}
$$

$$
\text{Model Metrics}
\rightarrow
\text{Are predictions behaving correctly?}
$$

$$
\text{Business Metrics}
\rightarrow
\text{Is it actually useful?}
$$

### Production feedback closes the loop

Suppose the churn model is deployed. Eventually you observe:

```text
Customer predicted high-risk
        ↓
Retention offer sent
        ↓
Customer stayed / left
```

Those outcomes become new information. Potentially:

$$
D_{new}
=
D_{old}
+
D_{production}
$$

That new dataset can support another training run:

$$
D_{new}
\rightarrow
\text{Train v25}
\rightarrow
\text{Evaluate}
\rightarrow
\text{Deploy}
$$

So production is not merely the destination of ML development. It is also a source of future training information. That gives us the complete feedback loop:

$$
\boxed{
\text{Data}
\rightarrow
\text{Train}
\rightarrow
\text{Evaluate}
\rightarrow
\text{Deploy}
\rightarrow
\text{Observe}
\rightarrow
\text{New Data}
\rightarrow
\text{Train Again}
}
$$

### Retraining should not automatically mean redeployment

Imagine you've automated monthly retraining. That does **not** imply:

```text
Train new model
→ automatically replace production
```

because the new model might be worse. Instead:

```text
New data
   ↓
Retrain
   ↓
Evaluate
   ↓
Compare with production model
   ↓
Pass gates?
   ├── No → reject
   └── Yes → candidate
               ↓
             approval
               ↓
             deployment
```

This separation is critical:

$$
\text{Retraining}
\neq
\text{Release}
$$

### Automation should remove repetition, not judgment blindly

MLOps frequently gets described as:

“Automate everything.”

That's too simplistic. A better principle is:

> **Automate deterministic, repeatable checks and workflows. Keep explicit judgment where risk or ambiguity requires it.**

Good automation candidates include:

```text
unit tests
data validation
training execution
metric calculation
artifact storage
container builds
deployment mechanics
monitoring
```

But some decisions may require humans:

```text
Is this fairness tradeoff acceptable?
Should we change the business threshold?
Is this model appropriate for this customer population?
```

So:

$$
\text{Automation}
\neq
\text{Removal of Human Responsibility}
$$

### CI and CD enter the picture

Moving model logic into regular source files lets the team apply familiar software engineering checks and release controls.

#### Continuous Integration

A developer changes feature code. Then:

```text
Commit
   ↓
Tests
   ↓
Data/feature checks
   ↓
Training smoke test
   ↓
Package/build checks
```

This asks:

**Is this change safe enough to integrate?**

#### Continuous Delivery

A valid model artifact moves toward deployment:

```text
Candidate Model
   ↓
Evaluation
   ↓
Approval
   ↓
Packaging
   ↓
Staging
   ↓
Production
```

This asks:

**Can we reliably release an approved model?**

MLOps extends CI/CD because the release depends on source code, data, and learned parameters together.

### Code versioning alone is not enough

Traditional software might say:

```text
Version 2.4.1
```

and Git explains where it came from. For ML, imagine:

```text
Git commit = same
```

but:

```text
Training data = different
```

You can get a different model. Formally:

$$
C_1=C_2
$$

does not imply:

$$
M_1=M_2
$$

if:

$$
D_1\neq D_2
$$

Therefore MLOps needs lineage across more dimensions than ordinary software development.

### Think in terms of immutable artifacts

Suppose:

```text
model.pkl
```

can be overwritten. Then this:

```text
production uses model.pkl
```

doesn't really tell you what production uses. Instead, prefer identities like:

```text
churn-model-v23
sha256:8f2...
```

Then production references a specific artifact. Conceptually:

$$
\text{Artifact Identity}
\rightarrow
\text{Exact Model}
$$

This improves:

* auditability,
* rollback,
* debugging,
* reproducibility.

## What Minimum Stack and Maturity Path Should a Team Build First?

<!-- section-summary: Start with reviewed source, a normal package and lockfile, layered tests, versioned data, one controlled training job, run and model tracking, a governed release, rollback, and production monitoring. -->

### A useful project structure

A simple project could evolve from:

```text
churn.ipynb
```

into something like:

```text
project/
│
├── notebooks/
│   └── exploration.ipynb
│
├── src/
│   ├── data.py
│   ├── features.py
│   ├── train.py
│   ├── evaluate.py
│   └── predict.py
│
├── tests/
│   ├── test_data.py
│   ├── test_features.py
│   └── test_predict.py
│
├── configs/
│   └── training.yaml
│
├── requirements.txt
├── Dockerfile
└── README.md
```

The important idea is not these exact filenames. The principle is:

$$
\text{Exploration}
$$

and:

$$
\text{Production Logic}
$$

should no longer be the same thing.

### Keep notebooks—they are still useful

“Notebook to production” does **not** mean:

“Notebooks are bad.”

Notebooks are excellent for:

* exploratory data analysis,
* visualizations,
* hypothesis testing,
* experimenting with models,
* communicating results.

The healthy relationship is:

```text
Notebook
   ↓
Discover useful logic
   ↓
Move reusable logic into modules
   ↓
Import module back into notebook if useful
```

For example:

```python
from src.features import build_features
from src.evaluation import evaluate_model
```

Now exploration and production can share tested code. This is much better than copying the same feature code into multiple places.

### A practical starter stack

You do **not** need an enormous MLOps platform to productionize your first model. A perfectly reasonable small-team stack might be:

#### Development

```text
Python
Jupyter
Git
```

#### Testing

```text
pytest
```

#### Packaging/environment

```text
requirements or pyproject
Docker when useful
```

#### Training

```text
Python scripts
+
scheduled job or workflow runner
```

#### Experiment tracking

Something that records:

```text
parameters
metrics
artifacts
```

#### Model storage/registry

Something that gives models explicit versions and lifecycle state.

#### Deployment

For batch:

```text
scheduler + container/job
```

For online:

```text
small API + container/runtime
```

#### Monitoring

Start with:

```text
application metrics
data quality
prediction distributions
business metrics
```

Then increase sophistication as the risk and scale justify it.

### Don't build the “perfect MLOps platform” too early

A common mistake is moving from:

```text
one notebook
```

straight to:

```text
Kubernetes
+ feature store
+ workflow orchestrator
+ model registry
+ experiment tracker
+ data versioning platform
+ service mesh
+ online feature serving
+ distributed training
```

before the first useful model reaches production. Every tool has operational cost. So the sensible principle is:

$$
\text{Infrastructure Complexity}
\leq
\text{Problem Complexity}
$$

Start with the smallest system that gives you the guarantees you actually need. Add machinery when concrete problems justify it.

### A minimal maturity progression

You can think about notebook-to-production maturity in stages.

#### Stage 1 — Experiment

```text
notebook
→ model works
```

Goal:

Prove the idea.

#### Stage 2 — Reusable training

```text
notebook
→ modules/scripts
→ repeatable training
```

Goal:

Make somebody else able to run it.

#### Stage 3 — Reproducible training

```text
code version
+ data version
+ configuration
+ dependencies
→ tracked model
```

Goal:

Know exactly where a model came from.

#### Stage 4 — Controlled release

```text
candidate
→ tests
→ evaluation
→ registry
→ approval
→ deployment
```

Goal:

Prevent arbitrary models reaching production.

#### Stage 5 — Production observation

```text
deployment
→ monitoring
→ alerts
→ rollback
```

Goal:

Know when the system isn't behaving properly.

#### Stage 6 — Feedback loop

```text
production
→ outcomes
→ new training data
→ retraining
→ evaluation
→ release
```

Goal:

Operate ML as an evolving system.

### Follow one example all the way through

Suppose Maya develops a fraud model. Her notebook does:

```text
transactions.csv
      ↓
cleaning
      ↓
features
      ↓
XGBoost
      ↓
AUC = 0.94
```

Promising. But nothing is productionized yet.

#### Step 1 — Define the production contract

Input:

```text
transaction data
account data
merchant data
```

Output:

```text
fraud probability
```

Business decision:

$$
P(\text{fraud}) > 0.85
\Rightarrow
\text{manual review}
$$

#### Step 2 — Extract reusable code

Move:

```text
feature engineering
training
evaluation
prediction
```

out of notebook cells and into Python modules.

#### Step 3 — Add tests

Check:

```text
amount >= 0
currency recognized
feature columns present
model output between 0 and 1
```

#### Step 4 — Make training reproducible

Record:

```text
Git commit
training dataset version
hyperparameters
dependencies
random seed
```

Run:

```text
training-run-482
```

#### Step 5 — Track the result

The run creates:

```text
fraud-model-v18
```

with:

```text
AUC = 0.941
Recall = 0.87
P95 inference = 31 ms
```

#### Step 6 — Evaluate against production requirements

Requirements:

```text
AUC >= 0.93
Recall >= 0.85
P95 latency <= 50 ms
```

All pass. The model becomes:

```text
APPROVED CANDIDATE
```

#### Step 7 — Register and deploy

```text
fraud-model-v18
      ↓
registry
      ↓
staging
      ↓
canary 5%
      ↓
production 100%
```

#### Step 8 — Monitor

Infrastructure:

```text
latency
errors
availability
```

Data:

```text
missing values
feature distributions
schema
```

Model:

```text
prediction distributions
precision
recall
```

Business:

```text
fraud losses
false declines
manual review volume
```

#### Step 9 — Detect change

Three months later:

$$
Recall:
0.87 \rightarrow 0.76
$$

Investigation shows a new type of fraud has become common. Production data becomes new training information.

#### Step 10 — Retrain

```text
new labeled transactions
        ↓
training-run-611
        ↓
fraud-model-v19
        ↓
evaluation
        ↓
approval
        ↓
deployment
```

Now we have the real lifecycle:

$$
\boxed{
\text{Experiment}
\rightarrow
\text{Engineer}
\rightarrow
\text{Train}
\rightarrow
\text{Validate}
\rightarrow
\text{Release}
\rightarrow
\text{Observe}
\rightarrow
\text{Learn}
}
$$

### Turn hidden assumptions into recorded inputs

The largest gap is hidden state. In a notebook, many required inputs and decisions remain **implicit**.

```text
"I know which file I used."

"I remember that cell 17 has to run first."

"I know why we chose 0.85."

"I know which package version works."

"I know where the model file is."

"I'll notice if something looks weird."
```

Production engineering makes those things explicit.

$$
\text{Memory}
\rightarrow
\text{Metadata}
$$

$$
\text{Manual Steps}
\rightarrow
\text{Pipelines}
$$

$$
\text{Assumptions}
\rightarrow
\text{Tests}
$$

$$
\text{Local Files}
\rightarrow
\text{Versioned Artifacts}
$$

$$
\text{Informal Judgment}
\rightarrow
\text{Evaluation Gates}
$$

$$
\text{Visual Inspection}
\rightarrow
\text{Monitoring}
$$

$$
\text{“I can rerun it”}
\rightarrow
\text{Reproducibility}
$$

That is the essence of productionization.

### What to remember

A notebook is an environment for answering:

**Can we build a useful model?**

MLOps must answer a much larger set of questions:

```text
Can we build it again?
Can we test it?
Can we identify its data?
Can we identify its code?
Can we compare it with the current model?
Can we approve it?
Can we deploy it safely?
Can we roll it back?
Can we observe its behavior?
Can we detect when reality changes?
Can we learn from production?
```

So the journey is not really:

$$
\boxed{
\text{Notebook}
\rightarrow
\text{Production}
}
$$

It is:

$$
\boxed{
\text{Experiment}
\rightarrow
\text{Repeatable Process}
\rightarrow
\text{Controlled Artifact}
\rightarrow
\text{Reliable Service}
\rightarrow
\text{Observed Feedback Loop}
}
$$

And that is why MLOps exists. The model itself may only be:

$$
\hat y=f_\theta(x)
$$

The surrounding production system has the harder responsibility: it must combine the intended $$x$$, the approved $$f_\theta$$, the correct version, and the expected operational decision reliably on every run.

![Notebook experimentation connected to packaging, testing, tracked training, evaluation, release, monitoring, and production feedback](/content-assets/articles/article-mlops-mlops-foundations-notebook-to-production-workflow/notebook-to-production-summary.png)

*The notebook remains a laboratory inside a larger operating loop. Production feedback creates focused questions for the next experiment instead of turning the notebook into the production runtime.*

## Check Your Answers

Use these answers to revisit the evidence, boundaries, and operating decisions behind each question.

:::expand[What Separates Exploration from Production Execution?]{kind="recap"}
Exploration optimizes a short human learning loop and can tolerate interactive state. Production must let another person or automated job declare inputs, execute approved logic, find outputs, investigate failures, and identify the exact candidate without relying on the original author’s workstation or memory.
:::

:::expand[What Production Contract Should Be Defined Before Code Is Extracted?]{kind="recap"}
Define the user and decision, prediction moment, affected population, target, permitted inputs, output meaning, product action, success measures, guardrails, ownership, deadline, and fallback. These contracts determine what code, data, tests, and delivery path the production workflow actually needs.
:::

:::expand[How Does Notebook Logic Become an Explicit Reusable Program?]{kind="recap"}
Move stable transformations, training, evaluation, and prediction logic into importable functions and packages with named inputs and outputs. Declare configuration, data identity, dependencies, workload identity, secrets, and run-specific output locations so execution no longer relies on cell order or hidden local state.
:::

:::expand[How Do Tests Prove the Training Workflow?]{kind="recap"}
Unit tests protect feature, label, split, and policy logic.

Data contracts protect schema, meaning, time, and coverage. Integration and smoke tests exercise the connected reader, trainer, evaluator, artifact writer, and serving load path. Model checks then compare quality, segments, capacity, robustness, and risk against explicit release rules.
:::

:::expand[How Do Jobs, Runs, and Artifacts Make Training Reproducible?]{kind="recap"}
A controlled job executes a reviewed package against an exact data snapshot, split identity, resolved configuration, runtime, compute context, and workload identity. Its tracked run connects those inputs to parameters, metrics, logs, evaluations, and an immutable model artifact that another person can explain and reload.
:::

:::expand[How Does a Trained Candidate Reach a Controlled Production Release?]{kind="recap"}
CI tests and packages reviewed source.

Training creates a candidate that binds the logged model to its data, code, runtime, metrics, interface, and limitations. Evaluation and accountable approval authorize an immutable candidate for a named route, limited rollout, monitoring plan, and tested rollback target.
:::

:::expand[How Do Monitoring and Feedback Lead to the Next Candidate?]{kind="recap"}
Operations observes delivery health, input quality, prediction behaviour, delayed labels, segment performance, and business outcomes.

Incidents and mature outcomes return focused questions to exploration. A new candidate must pass the same contract, tests, tracked job, evaluation, and release gates; retraining alone never authorizes deployment.
:::

:::expand[What Minimum Stack and Maturity Path Should a Team Build First?]{kind="recap"}
Start with reviewed source, a normal package and lockfile, layered tests, versioned data, one controlled training job, run and model tracking, a governed release, rollback, and production monitoring. Add orchestration, feature platforms, or specialized serving only after a concrete dependency, scale, latency, reuse, or ownership requirement justifies them.
:::

## References

- [Python Packaging User Guide: Writing `pyproject.toml`](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/)
- [pytest: Assertions](https://docs.pytest.org/en/stable/how-to/assert.html)
- [Jupyter Notebook documentation](https://jupyter-notebook.readthedocs.io/en/stable/)
- [Docker documentation](https://docs.docker.com/)
