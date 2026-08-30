---
title: "What Is MLOps?"
description: "Define MLOps in plain language and connect it to the work of shipping models safely."
overview: "MLOps controls the complete machine-learning lifecycle: specify the decision, build a reproducible model, release it safely, operate it, and learn from real outcomes."
tags: ["MLOps", "core", "foundations"]
order: 1
id: "article-mlops-mlops-foundations-what-is-mlops"
---

## Table of Contents

1. [Why Does MLOps Start with the Whole System?](#why-does-mlops-start-with-the-whole-system)
2. [What Work Must MLOps Control?](#what-work-must-mlops-control)
3. [Why Does Machine Learning Need Controls Beyond DevOps?](#why-does-machine-learning-need-controls-beyond-devops)
4. [How Do Purpose, Data, and Training Produce a Reproducible Model?](#how-do-purpose-data-and-training-produce-a-reproducible-model)
5. [How Is a Model Evaluated and Released Safely?](#how-is-a-model-evaluated-and-released-safely)
6. [What Must a Production ML System Monitor?](#what-must-a-production-ml-system-monitor)
7. [How Do Feedback and Ownership Keep the Lifecycle Working?](#how-do-feedback-and-ownership-keep-the-lifecycle-working)
8. [How Should a Team Start Building MLOps?](#how-should-a-team-start-building-mlops)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A fraud model returns a score of `0.92`. That number does nothing by itself. The payment system still has to collect the right transaction facts, calculate the expected features, and call the approved model version. It then compares the score with a threshold and decides whether to allow, block, or review the payment.

The work continues after that decision. The team needs to record which model and features produced the score, observe whether the service is healthy, and later connect the decision to a confirmed fraud outcome. If fraud patterns change, that new evidence has to reach the next training run.

**MLOps is the way a team makes this whole process repeatable and safe.** It covers data, training, evaluation, release, monitoring, recovery, and feedback. Deploying a model is one step inside that larger job.

To understand MLOps, follow the work around one model:

1. **Why Does MLOps Start with the Whole System?**
2. **What Work Must MLOps Control?**
3. **Why Does Machine Learning Need Controls Beyond DevOps?**
4. **How Do Purpose, Data, and Training Produce a Reproducible Model?**
5. **How Is a Model Evaluated and Released Safely?**
6. **What Must a Production ML System Monitor?**
7. **How Do Feedback and Ownership Keep the Lifecycle Working?**
8. **How Should a Team Start Building MLOps?**

## Why Does MLOps Start with the Whole System?
<!-- section-summary: A model is one artifact inside a product path that must acquire data, deliver a decision, observe outcomes, and remain safe as its dependencies change. -->

For a transaction (x), a fraud model (f_\theta) may calculate a probability:

$$
x \rightarrow f_\theta(x) \rightarrow 0.92
$$

Here, (x) contains transaction information, (\theta) represents learned parameters, and `0.92` is the estimated fraud probability. This expression describes inference. The bank still needs a system that can use the estimate at the moment a transaction must be approved, blocked, or sent for investigation.

The complete path includes much more work:

```text
transaction occurs
    ↓
collect the available transaction facts
    ↓
construct the model features
    ↓
request a fraud score
    ↓
apply thresholds and business rules
    ↓
approve, block, or investigate
    ↓
observe the eventual outcome
    ↓
store the outcome for later learning
```

Testing, versioning, deployment, permissions, security, monitoring, audit logs, data validation, model validation, ownership, and rollback surround this path. Together they form the production environment in which the model has to remain useful.

This distinction changes how quality is judged. Suppose three experiments report the following validation results:

| Model | Validation accuracy |
| --- | ---: |
| A | 91% |
| B | 94% |
| C | 96% |

The highest number does not settle the production decision. Model C may require a feature the live service cannot obtain. It may need 20 GB of memory, fail on a missing field, respond after the decision deadline, or lack enough lineage to reproduce its training. Model B may deliver greater practical value if it operates within the real constraints.

Production value depends on several properties at once:

$$
\text{Model value} = f(
\text{predictive quality},
\text{reliability},
\text{latency},
\text{cost},
\text{reproducibility},
\text{maintainability},
\text{safety})
$$

MLOps is the engineering discipline for managing this larger equation. Its product is a controlled ML system that can repeatedly use a model correctly, rather than a model file considered in isolation.

![The product, learning, release, and operating loops connected by feedback and governed controls](/content-assets/articles/article-mlops-mlops-foundations-what-is-mlops/four-mlops-loops.png)

*The model participates in several connected loops; no single training or deployment step represents the whole product.*

## What Work Must MLOps Control?
<!-- section-summary: MLOps repeatedly specifies the intended decision, builds a traceable candidate, operates an approved release, and learns from production evidence. -->

The lifecycle can be understood through four jobs: **specify**, **build**, **operate**, and **learn**. This grouping is a mental model rather than a universal product taxonomy. It is useful because every working ML system has to cover these responsibilities in some form.

**Specify** defines what the model should do. The team names the decision, the prediction moment, the information available by that moment, the output, the consumer, the resulting action, and the acceptable constraints. Without this definition, an apparently accurate model can solve a question the product cannot use.

**Build** turns versioned inputs into a candidate. This includes acquiring and validating data, creating features, splitting datasets, training, evaluating, packaging the artifact, and recording the run. The same declared inputs and configuration should travel through the same traceable process.

**Operate** introduces an approved model into production and keeps the service functioning. Release controls, serving infrastructure, monitoring, access control, rollback, and incident response live here.

**Learn** connects predictions to outcomes. Delayed fraud reports, product returns, clicks, cancellations, or other results provide evidence about the current model and new labeled examples for later training.

The four jobs form a loop:

```text
SPECIFY
What decision and constraints define success?
    ↓
BUILD
Can a reproducible candidate satisfy them?
    ↓
OPERATE
Can the approved version serve safely?
    ↓
LEARN
What do real outcomes reveal?
    └────────────→ next specification or build
```

The loop also clarifies the difference among related disciplines. Data science asks whether a useful pattern can be learned from data. ML engineering asks whether the resulting model can function as software. MLOps asks whether the entire system can repeatedly produce, release, observe, recover, and improve models.

```text
data science:    data → model
ML engineering: data → model → application
MLOps:           data → train → release → predictions → outcomes → next data
```

MLOps improves the control of the lifecycle. The algorithm may remain unchanged while the process gains versioned data, automated training, recorded experiments, validation gates, a model registry, controlled deployment, monitoring, outcome collection, and repeatable retraining.

## Why Does Machine Learning Need Controls Beyond DevOps?
<!-- section-summary: Machine-learning behavior depends on code, data, features, parameters, artifacts, and a changing population, so software delivery controls cover only part of the risk. -->

DevOps supplies essential practices for repeatable software changes:

```text
write code → test → build → deploy → monitor → improve
```

ML systems need all of those practices. They also depend on inputs that ordinary software delivery does not fully describe. A conventional application's behavior can be approximated as a function of code and configuration:

$$
\text{behavior} = f(\text{code}, \text{configuration})
$$

An ML system has a larger dependency set:

$$
\text{behavior} = f(
\text{code},
\text{configuration},
\text{training data},
\text{features},
\text{algorithm},
\text{hyperparameters},
\text{model weights})
$$

The same training code can produce a different model after the dataset changes. The same dataset can lead to a different model after feature logic changes. A fixed serving artifact can lose production value after customer behavior, fraud patterns, prices, language, products, or markets shift.

This gives an ML system three moving parts:

1. Code changes, such as feature logic moving from version 5 to version 6.
2. Models change, such as a production release moving from version 17 to version 18.
3. The world changes, even while the deployed code and model remain fixed.

The third movement is especially important:

$$
\text{world}_{t+1} \neq \text{world}_t
$$

A fraud model trained in January may lose accuracy after attackers change their methods in June. Nothing has to crash for this failure to occur. Infrastructure can remain healthy while the statistical relationship learned by the model weakens.

![Four properties that make machine-learning operations different from ordinary software delivery, with the roles of CI, CD, and CT](/content-assets/articles/article-mlops-mlops-foundations-what-is-mlops/why-ml-needs-mlops.png)

*Software controls remain necessary; data, model, and world changes add further controls around training, evaluation, and continuous learning.*

## How Do Purpose, Data, and Training Produce a Reproducible Model?
<!-- section-summary: A product contract defines the prediction boundary, and a recorded pipeline connects every candidate to the data, code, features, parameters, environment, and evaluation that produced it. -->

The lifecycle starts with a product question: **What decision should the prediction help someone make?** For transaction fraud, the contract might state:

```text
Goal: reduce fraudulent transactions
Task: estimate the probability that the current transaction is fraudulent
Input: facts available at transaction time
Output: a probability from 0 to 1
Consumer: the payment authorization system
Deadline: less than 100 milliseconds
Action: block or review transactions above an approved threshold
```

The prediction moment creates an information boundary. A field such as `chargeback_received_30_days_later` may explain the outcome during analysis, yet it cannot be supplied to the live model at transaction time. Including that field in training would allow future evidence to leak into the input.

After the contract is clear, training moves from an informal sequence into a pipeline:

```text
acquire data
    ↓
validate data
    ↓
create features
    ↓
split datasets
    ↓
train a model
    ↓
evaluate the candidate
    ↓
check product and technical requirements
    ↓
package the model
    ↓
register the candidate
```

Exploration can still happen in a notebook. Production training cannot depend on a person remembering which cells ran, which CSV was loaded, or which parameter was edited. The pipeline declares those inputs so another run can follow the same process.

Reproducibility asks a concrete question: **How exactly was the deployed model produced?** A useful run record contains the training code commit, dataset version, feature definitions, algorithm, hyperparameters, dependency versions, random seeds, execution environment, evaluation results, and final artifact.

Conceptually:

$$
M = Train(D, F, A, H, C, E)
$$

where (D) is data, (F) is feature transformation, (A) is the algorithm, (H) is the hyperparameter set, (C) is the code, and (E) is the environment. Saving only (M) preserves the output while discarding the evidence needed to explain it.

An experiment record might look like this:

```text
run: 8472
code: git commit 9ae31c
dataset: transactions_2026_07_v3
features: feature_set_v12
algorithm: XGBoost
depth: 8
learning_rate: 0.05
AUC: 0.943
precision: 0.81
recall: 0.76
artifact: fraud-model-8472.bin
```

This record creates lineage from data through features and training to the model, deployment, and later prediction. It supports both reproduction and investigation.

## How Is a Model Evaluated and Released Safely?
<!-- section-summary: Evaluation compares a specific candidate with product and operating requirements, while staged release and rollback limit the effect of mistakes. -->

Evaluation must represent the intended production problem. Accuracy can be misleading when classes are unbalanced. If fraud occurs in only 0.1% of transactions, a system that predicts `NOT FRAUD` every time reaches 99.9% accuracy and catches no fraud.

The useful measures may include precision, recall, false-positive rate, PR-AUC, money saved from prevented fraud, and the number of legitimate transactions incorrectly blocked. Operational constraints matter alongside predictive measures:

```text
AUC ≥ 0.92
false-positive rate ≤ 0.5%
P95 latency ≤ 100 ms
model size ≤ 500 MB
no unacceptable degradation for an important subgroup
```

The approval question is whether one exact candidate performs well enough for its operating environment. A single impressive metric cannot answer that question.

The model registry gives candidates and releases controlled identities. An experiment may produce `model_001` through `model_147`; the registry can show that version 17 is archived, version 18 is in production, version 19 is a candidate, and version 20 was rejected. Each entry connects to its training run, dataset, metrics, owner, creation time, and stored artifact. This inventory makes “What exactly are we running?” easy to answer.

An approved candidate follows a release path:

```text
candidate
    ↓
automated tests
    ↓
model validation
    ↓
required approval
    ↓
staging
    ↓
limited production exposure
    ↓
comparison with the current release
    ↓
full rollout or rollback
```

A **shadow deployment** sends real requests to the candidate while the established model still controls the decision. Candidate results are logged for comparison without affecting users.

```text
request ──┬──→ current model → actual decision
          └──→ candidate model → observation only
```

A **canary release** gives the candidate a small share of live traffic, perhaps 5%, while 95% continues to use the current release. Exposure can rise after health and outcome checks pass.

Rollback must be ready before expansion. If version 18 breaches latency or behaves unexpectedly, the system should return traffic to version 17. A release is safer when reversal is an ordinary tested action.

Retraining does not authorize deployment. A weekly training schedule produces candidates. Each candidate still passes evaluation, quality gates, and any human review required by the application's risk. Automation runs the process consistently; it does not erase decisions that need accountable judgment.

## What Must a Production ML System Monitor?
<!-- section-summary: Monitoring covers delivery health, input and prediction behavior, measured model quality, and the business results that justified the model. -->

Production monitoring has two fundamental layers. The first asks whether the service is functioning. CPU, memory, request volume, error rate, uptime, throughput, and latency belong here. A P95 latency of 82 milliseconds may show that requests meet the technical deadline.

The second layer asks whether the model remains useful. It observes input distributions, missing features, prediction distributions, calibration, accuracy, precision and recall after labels arrive, and the business outcomes influenced by the prediction.

Both layers are necessary because a technically healthy endpoint can make poor decisions. Suppose the mean age in training data was 38 while the mean age in current production inputs is 61. The input population has changed. This is **data drift**:

$$
P_{train}(X) \neq P_{production}(X)
$$

**Concept drift** describes a change in the relationship between inputs and outcomes:

$$
P_{train}(Y|X) \neq P_{production}(Y|X)
$$

New fraud strategies can change which transaction patterns indicate risk. The server may still return every score on time, even as the learned relationship loses value.

Monitoring should therefore connect each signal to a response. Missing required training data should stop the pipeline and alert its owner. A sudden null increase should fail validation before release. A candidate that performs worse should be rejected while the current model keeps serving. A canary that causes high latency should stop expanding and roll back. Drift should trigger investigation and may justify new training. A failed retraining run should leave the established production model available.

The recovery workflow is as important as the success workflow:

```text
success path: validated inputs → candidate → approved release → healthy operation
recovery path: detected failure → contained effect → owner action → safe state
```

Reliability comes from making failures visible and recoverable, since no production system can eliminate every failure.

## How Do Feedback and Ownership Keep the Lifecycle Working?
<!-- section-summary: Delayed outcomes supply future labels, while named owners decide how data, model, platform, product, and governance evidence should change the system. -->

Many labels arrive after the prediction. A transaction receives a fraud probability, the bank approves it, and weeks later the customer reports fraud. The later outcome can measure the deployed model and supply a labeled example for a future dataset.

The learning loop is:

$$
Data_t \rightarrow Model_t \rightarrow Predictions_t \rightarrow Outcomes_t
\rightarrow Data_{t+1} \rightarrow Model_{t+1}
$$

This feedback needs careful storage. The prediction, action, model version, relevant inputs, and eventual outcome must remain joinable. The result may support investigation, metric calculation, threshold changes, new feature work, or retraining. A new candidate still needs independent evaluation before release.

Production problems cross team boundaries, so the lifecycle also needs explicit owners. A sudden quality loss could come from a changed source, unsuitable model behavior, a broken feature pipeline, the wrong deployed version, or a changed target definition.

| Responsibility | Possible owner |
| --- | --- |
| Source-data quality | Data engineering |
| Feature definitions | ML or data team |
| Model training | ML engineering |
| Model validation | ML and domain owner |
| Deployment infrastructure | Platform or ML platform |
| Production service | ML engineering or SRE |
| Business performance | Product or domain owner |
| Compliance approval | Risk or compliance |

Team names vary. Every important lifecycle decision still needs someone with authority to act.

Tools support these responsibilities. Git can identify code. A data platform can retain dataset versions and lineage. An orchestrator can run training stages. An experiment tracker can record run metadata. A model registry can manage model identities and states. CI/CD can test and release changes. Serving infrastructure can deliver predictions. Monitoring systems can collect service and ML signals.

Installing MLflow, Kubernetes, or any other product does not establish the practice by itself. The team first identifies the required responsibility—versioning, orchestration, evaluation, serving, monitoring, approval, or another control—and then selects a mechanism that fits it.

## How Should a Team Start Building MLOps?
<!-- section-summary: One complete vertical workflow reveals the real controls a product needs and should include deliberate tests of both successful operation and safe failure. -->

A team can learn more by completing one production path than by building a broad platform in advance. Starting with feature stores, Kubernetes, streaming, distributed training, advanced drift detection, a data catalog, and automated retraining can consume months before the first model completes its lifecycle.

The first vertical slice should connect:

```text
raw data
    ↓
validation
    ↓
feature engineering
    ↓
training
    ↓
evaluation
    ↓
model registration
    ↓
controlled deployment
    ↓
prediction
    ↓
service and ML monitoring
    ↓
outcome collection
    ↓
retraining candidate
```

An online store predicting item returns offers a complete example. The product contract uses facts available before shipment and outputs a return probability so an intervention may reduce returns. Orders, customers, products, and historical returns supply the data. Validation checks schema, missingness, ranges, and unexpected categories. Features may include customer return rate, product return rate, order value, and days since the customer's previous purchase.

Training produces a candidate. Evaluation checks precision, recall, calibration, subgroup performance, and latency. The run record retains code, data, parameters, metrics, and the artifact. The registry marks the exact version as a candidate. A canary may send 5% of traffic to it and keep 95% on the earlier model.

Production monitoring covers error rate, latency, memory, throughput, feature drift, prediction drift, the real return rate, and label-based precision or recall after outcomes arrive. The later `returned: yes/no` value joins back to the prediction and can enter a new dataset. The next trained model replaces the current release only after it passes the same controls.

The team should also test failure paths. Remove a required training input and confirm that training stops. Inject nulls into a critical feature and confirm that validation blocks release. Present a weaker candidate and confirm rejection. Cause a canary latency breach and verify rollback. Simulate a failed retraining run and confirm that the current model continues serving.

These tests measure MLOps maturity more directly than the number of installed products. A mature workflow can reproduce a model, identify a release, observe what it is doing, detect harmful changes, recover, and use real outcomes to guide the next cycle.

The goals are reproducibility, reliability, observability, safety, and useful iteration speed. Their balance depends on risk. A recommendation system and a medical decision-support system may use different approval and rollout procedures because the cost of a wrong decision differs.

![The complete MLOps production path from a product question to governed data, evaluation, release, operation, observed results, and feedback](/content-assets/articles/article-mlops-mlops-foundations-what-is-mlops/mlops-complete-system-summary.png)

*A complete workflow controls the path from product intent through real outcomes and the next candidate.*

## Check Your Answers

Use these answers to check whether you can connect the model, production system, operating controls, and learning loop without treating any one tool as the definition of MLOps.

:::expand[Why Does MLOps Start with the Whole System?]{kind="recap"}
A trained model performs one mathematical operation. A useful product also needs time-correct inputs, feature construction, a decision rule, delivery, outcome collection, monitoring, ownership, security, auditability, and recovery.
:::

:::expand[What Work Must MLOps Control?]{kind="recap"}
MLOps specifies the intended decision, builds a reproducible candidate, operates an approved release, and learns from production outcomes. Those jobs form a repeated lifecycle.
:::

:::expand[Why Does Machine Learning Need Controls Beyond DevOps?]{kind="recap"}
ML retains normal software-delivery needs and adds dependence on training data, feature logic, parameters, model artifacts, and changing real-world populations. Production value can fall even if code and infrastructure remain unchanged.
:::

:::expand[How Do Purpose, Data, and Training Produce a Reproducible Model?]{kind="recap"}
The product contract defines the prediction moment, inputs, output, consumer, action, and constraints. A reproducible run then records the code, dataset, features, algorithm, parameters, seeds, environment, evaluation, and resulting artifact.
:::

:::expand[How Is a Model Evaluated and Released Safely?]{kind="recap"}
Evaluation checks predictive, subgroup, business, latency, cost, and safety requirements for one exact candidate. Registration, approval, shadow or canary exposure, and a tested rollback route control its release.
:::

:::expand[What Must a Production ML System Monitor?]{kind="recap"}
It monitors service delivery through errors, latency, capacity, and uptime, and it monitors ML behavior through inputs, missingness, predictions, measured quality, drift, and business outcomes.
:::

:::expand[How Do Feedback and Ownership Keep the Lifecycle Working?]{kind="recap"}
Delayed outcomes connect earlier predictions to model evaluation and future training data. Named owners decide how source, feature, model, platform, product, and governance evidence should change the system.
:::

:::expand[How Should a Team Start Building MLOps?]{kind="recap"}
Start with one complete path from governed data to training, release, monitoring, outcomes, and recovery. Test expected failures, then add platform capabilities in response to demonstrated operating needs.
:::

## References

- [Google Cloud Architecture Center: MLOps continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning)
- [Microsoft Azure Architecture Center: Machine learning operations](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/machine-learning-operations-v2)
- [Amazon SageMaker AI: Implement MLOps](https://docs.aws.amazon.com/sagemaker/latest/dg/mlops.html)
- [Databricks: MLOps workflows](https://docs.databricks.com/aws/en/machine-learning/mlops/mlops-workflow)
- [MLflow: Model Registry workflows](https://mlflow.org/docs/latest/ml/model-registry/workflow/)
- [Google: Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml)
- [Google Research: Hidden Technical Debt in Machine Learning Systems](https://research.google/pubs/hidden-technical-debt-in-machine-learning-systems/)
