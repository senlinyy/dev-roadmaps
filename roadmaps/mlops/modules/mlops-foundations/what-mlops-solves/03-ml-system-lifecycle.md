---
title: "ML System Lifecycle"
description: "Walk through the full production lifecycle for an ML system, from the business problem to data, training, evaluation, deployment, monitoring, and improvement."
overview: "A production ML system moves through a loop: define the product decision, collect and validate data, train candidate models, evaluate them, register an approved version, deploy it safely, monitor real behavior, and feed production evidence back into the next cycle. This article uses one fraud-risk model to show how the lifecycle connects every later MLOps topic."
tags: ["MLOps", "core", "lifecycle"]
order: 2
id: "article-mlops-mlops-foundations-ml-system-lifecycle"
---

## Table of Contents

1. [Start With The Product Decision](#start-with-the-product-decision)
2. [Turn Production Events Into Training Data](#turn-production-events-into-training-data)
3. [Create A Repeatable Training Run](#create-a-repeatable-training-run)
4. [Evaluate The Candidate Model](#evaluate-the-candidate-model)
5. [Register The Model Version](#register-the-model-version)
6. [Package The Serving Path](#package-the-serving-path)
7. [Release With Gates And Rollback](#release-with-gates-and-rollback)
8. [Monitor The System And The Model](#monitor-the-system-and-the-model)
9. [Feed Production Evidence Back Into The Loop](#feed-production-evidence-back-into-the-loop)
10. [Putting It All Together](#putting-it-all-together)

## Start With The Product Decision
<!-- section-summary: The lifecycle starts by naming the product decision, the prediction target, and the cost of each kind of mistake. -->

A production ML lifecycle starts with a **decision the product needs to make**. The model exists to support that decision. A model that predicts something interesting but never changes a product action becomes a research artifact, not a production system.

Let's use a payment company called Northstar Pay. The team wants to reduce card fraud without blocking too many real customers. Every time a customer starts a payment, the product has a decision to make: approve the payment, decline it, or send it through extra verification.

The ML model helps with that decision by producing a **fraud risk score**. A score near `0.95` means the payment looks very risky. A score near `0.02` means the payment looks ordinary. The product still needs rules around the score. For example, Northstar Pay might approve scores below `0.60`, ask for step-up verification between `0.60` and `0.85`, and decline scores above `0.85`.

A **target label** is the real-world outcome the model learns to predict. For the fraud model, the label could be `is_confirmed_fraud`. That label might come from chargebacks, fraud analyst reviews, customer reports, or bank network signals. The label definition matters because the model learns exactly what the team calls fraud. If analysts include refunded-but-legitimate payments in the fraud label, the model learns a confusing target.

Before anyone opens a notebook, the team should write down a small release brief. This brief gives the lifecycle a clear start and prevents model work from drifting into vague experimentation.

```yaml
model_name: payment-fraud-risk
product_decision: approve, verify, or decline a payment
prediction_target: payment becomes confirmed fraud within 30 days
primary_metric: recall_at_2_percent_manual_review_rate
guardrail_metrics:
  false_decline_rate: must not increase by more than 0.1 percent
  p95_latency_ms: must stay below 80
  verification_rate: must stay below 3 percent of payments
business_owner: payments-risk
ml_owner: fraud-ml-team
serving_path: online API called during payment authorization
```

The primary metric says what the model tries to improve. The guardrail metrics say what the model must protect while improving. **Recall** measures how many true fraud cases the system catches. **False decline rate** measures how often the system blocks a real customer. In fraud systems, both matter because catching more fraud by blocking everyone would hurt the business and the customer experience.

Now we have a decision, a target, and the cost of mistakes. The next question becomes practical: what data can show the model examples of that decision?

## Turn Production Events Into Training Data
<!-- section-summary: Training data turns messy product history into examples with features, labels, timestamps, and quality checks. -->

**Training data** is the set of past examples the model learns from. For Northstar Pay, each example might represent one payment attempt. The example contains facts known at payment time, such as amount, country, merchant category, device age, account age, recent payment attempts, and whether the customer passed previous verification.

The model should learn from information that existed at the moment of the decision. This timing detail matters. If a feature uses data created after the payment finished, the model gets an unfair advantage during training and then fails in production. This problem is called **data leakage**. A fraud model that uses `chargeback_created_at` as an input would look amazing in testing because chargebacks identify fraud, but that field arrives after the payment decision.

A practical training row needs a few categories of data. These fields help the team check whether each example uses the right time boundary, joins to the right outcome, and can be traced during debugging.

| Field type | What it means | Fraud example |
|---|---|---|
| **Entity keys** | IDs used to join events safely | `payment_id`, `customer_id`, `merchant_id` |
| **Event time** | The time the product made the decision | `payment_created_at` |
| **Features** | Inputs available before the decision | amount, country, device age, recent attempts |
| **Label** | The outcome the model learns | confirmed fraud within 30 days |
| **Label time** | The time the outcome became known | chargeback or analyst decision time |
| **Split marker** | Which dataset split owns the row | train, validation, or test |

The team also needs **data validation**. Data validation checks whether incoming data has the shape and meaning the pipeline expects. A simple schema check might require `amount_usd` to exist, be numeric, and stay above zero. A statistical check might notice that the share of payments from one country jumped from 5 percent to 40 percent in one day. That jump could be a real product launch, a fraud attack, or a broken upstream field.

Here is a small validation contract for the fraud training table. The exact field limits would come from production history and risk review, but the shape shows how a team turns data expectations into checks.

```yaml
dataset: payment_authorization_examples
required_columns:
  - payment_id
  - customer_id
  - payment_created_at
  - amount_usd
  - merchant_country
  - device_age_days
  - attempts_last_hour
  - is_confirmed_fraud
checks:
  amount_usd:
    min: 0.01
    max: 10000
  device_age_days:
    min: 0
  attempts_last_hour:
    min: 0
    max: 50
  is_confirmed_fraud:
    allowed_values: [0, 1]
```

The exact tool can change. Some teams use Great Expectations, TensorFlow Data Validation, Deequ, custom SQL checks, dbt tests, or warehouse-native constraints. The important part is the habit: data has to pass checks before it trains a model, because a broken dataset can create a broken model without throwing a normal software error.

Once the team has trusted examples, the lifecycle moves from data preparation into training. Training should produce more than a model file. It should produce a record the team can repeat and inspect.

## Create A Repeatable Training Run
<!-- section-summary: A training run should record code, data, configuration, environment, metrics, and artifacts so the model can be reproduced later. -->

A **training run** is one execution of the code that creates a candidate model. It reads a data version, uses a configuration, runs in an environment, and writes outputs. The output includes the model artifact, metrics, logs, and metadata.

In the first experiment, a data scientist may train the fraud model from a notebook. That is a normal starting point. The lifecycle becomes stronger when the team turns the working notebook into a repeatable job. The job should run from version-controlled code, read a named dataset, use a checked-in config file, and write outputs to a predictable location.

For Northstar Pay, the training job might use this config. The values make each run easier to compare because the data snapshot, feature list, training settings, and output locations are written down before the job starts.

```yaml
model:
  name: payment-fraud-risk
  algorithm: lightgbm
data:
  training_snapshot: s3://northstar-ml-data/fraud/examples/2026-05-01/
  time_window:
    train_start: "2025-11-01"
    train_end: "2026-04-15"
    validation_start: "2026-04-16"
    validation_end: "2026-04-30"
features:
  - amount_usd
  - merchant_country
  - device_age_days
  - attempts_last_hour
  - account_age_days
  - customer_velocity_24h
training:
  seed: 42
  max_depth: 6
  learning_rate: 0.05
  num_boost_round: 400
outputs:
  artifact_uri: s3://northstar-ml-models/payment-fraud-risk/candidates/
  metrics_uri: s3://northstar-ml-runs/payment-fraud-risk/
```

This file makes the run easier to review. A teammate can see which data snapshot, date ranges, feature list, and training settings created the candidate. If the candidate behaves strangely, the team can inspect the config instead of guessing what happened inside a notebook.

The training job should save a run record. A run record is metadata about the execution. Azure Machine Learning, SageMaker, Vertex AI, MLflow, Weights & Biases, and many internal platforms store this kind of metadata. The names differ, but the production need stays the same.

```json
{
  "run_id": "fraud-2026-06-13-1842",
  "model_name": "payment-fraud-risk",
  "training_commit": "9c7a31f",
  "data_snapshot": "s3://northstar-ml-data/fraud/examples/2026-05-01/",
  "container_image": "ghcr.io/northstar/fraud-training:2026-06-13",
  "config_file": "configs/payment_fraud_risk.yml",
  "artifact_uri": "s3://northstar-ml-models/payment-fraud-risk/candidates/fraud-2026-06-13-1842/model.pkl",
  "started_by": "scheduled-training-pipeline",
  "status": "completed"
}
```

This is where **reproducibility** enters the lifecycle. Reproducibility means the team can explain and recreate the model well enough for debugging, comparison, audit, or rollback. Perfect bit-for-bit reproduction can be difficult with distributed training and specialized hardware, but the team should still preserve the ingredients: code, data, config, environment, seed, and artifact.

Now the team has a candidate model. A candidate is only a model that training produced. It becomes useful after evaluation shows whether it deserves to move forward.

## Evaluate The Candidate Model
<!-- section-summary: Evaluation compares the candidate with the current production model using metrics, segments, thresholds, and business guardrails. -->

**Evaluation** asks whether a candidate model is good enough for the next stage. In a production lifecycle, evaluation compares the candidate against a baseline, usually the current production model. The question is practical: does this candidate improve the decision without breaking the guardrails?

For the fraud model, the data science team might start with offline metrics. **Precision** measures how often flagged payments really become fraud. **Recall** measures how many fraud cases the model catches. **AUC** measures how well the model ranks risky payments above safer payments across many thresholds. **Calibration** checks whether a score like `0.80` behaves like roughly 80 percent risk across similar examples.

Offline metrics need segment checks. A model can look good overall while causing trouble in one country, one merchant type, one payment method, or one customer group. Segment evaluation helps the team find these hidden regressions before release.

| Check | Release question | Example pass rule |
|---|---|---|
| Overall fraud recall | Does the model catch more fraud at the review budget? | Recall improves by at least 3 percent |
| False decline rate | Does the model block too many real customers? | Increase stays below 0.1 percent |
| Country segments | Does one market regress badly? | No top market loses more than 2 percent recall |
| Merchant segments | Does one merchant category get over-flagged? | Verification rate stays below agreed limit |
| Latency | Can the model run inside the payment path? | p95 prediction latency stays below 80 ms |
| Stability | Does the score distribution shift wildly? | Score buckets stay within reviewed ranges |

Evaluation should also test the serving code around the model. The model artifact may load in the training environment and fail in the serving container because a package version changed. The input schema may match the training table and fail against the API payload. A lifecycle that stops at offline metrics misses those production problems.

A simple evaluation report gives reviewers a standard packet. Everyone can look at the same baseline, candidate metrics, serving checks, segment results, and release recommendation.

```yaml
candidate_model: payment-fraud-risk:v18
baseline_model: payment-fraud-risk:v17
offline_metrics:
  recall_at_2_percent_review:
    baseline: 0.61
    candidate: 0.65
  false_decline_rate:
    baseline: 0.42
    candidate: 0.47
  auc:
    baseline: 0.931
    candidate: 0.944
serving_checks:
  model_load: passed
  input_contract: passed
  p95_latency_ms: 52
segment_results:
  merchant_country_us: passed
  merchant_country_gb: passed
  new_customers: needs_review
recommendation: approve_for_shadow_test
```

Notice the `new_customers` segment. A careful lifecycle gives the team room to say, "This model looks strong, but one segment needs review before production traffic." The candidate can move into a shadow test, where it receives production inputs and logs predictions without affecting customer decisions.

Once evaluation produces enough evidence, the team needs to store the approved candidate as a versioned production asset. That is the registry stage.

## Register The Model Version
<!-- section-summary: The model registry stores approved model versions with metadata so teams can find, compare, promote, and roll back models. -->

A **model registry** is a catalog for trained models. It stores model versions, metadata, approval status, evaluation results, lineage, and deployment state. The registry gives the team a shared place to answer, "Which version is approved, what created it, and where is it running?"

Without a registry, model files often spread across object storage, laptops, chat links, and deployment repositories. A file named `model_final_v3_really_final.pkl` tells almost nothing about the data, code, environment, review, or rollout. A registry turns the model into a managed production asset.

For Northstar Pay, the registry entry for version `v18` might look like this. The entry connects the model file to the run, data snapshot, evaluation report, and owners who approved the next step.

```yaml
registered_model: payment-fraud-risk
version: 18
stage: candidate
approval_status: pending_manual_approval
artifact_uri: s3://northstar-ml-models/payment-fraud-risk/candidates/fraud-2026-06-13-1842/model.pkl
lineage:
  run_id: fraud-2026-06-13-1842
  training_commit: 9c7a31f
  data_snapshot: s3://northstar-ml-data/fraud/examples/2026-05-01/
evaluation:
  report_uri: s3://northstar-ml-runs/payment-fraud-risk/fraud-2026-06-13-1842/evaluation.yml
  recommendation: approve_for_shadow_test
owners:
  technical_owner: fraud-ml-team
  business_owner: payments-risk
```

The registry supports **promotion**. Promotion means moving a model version through states such as candidate, staging, shadow, canary, production, and archived. Different tools use different names. The important part is that each state has a meaning and an approval path.

A registry also supports rollback. If `v18` creates problems during rollout, the deployment system needs to know the last approved production version, maybe `v17`. The rollback should point traffic back to a known good version with a known artifact and serving image.

The registry does not serve predictions by itself in many systems. It stores the version and metadata. The next lifecycle step packages that version into a serving path the product can call.

## Package The Serving Path
<!-- section-summary: Serving turns the model artifact into a reliable prediction path with input validation, feature retrieval, dependencies, and an API or batch contract. -->

**Serving** means using the trained model to make predictions for new inputs. Serving can happen through an online API, a batch job, a streaming consumer, an edge device, or a database scoring process. Northstar Pay needs online serving because the payment decision happens while the customer waits.

The serving path contains more than the model file. It needs code that accepts a request, validates the input, retrieves or computes features, loads the model, produces a score, applies thresholds or policy rules, and returns a response. It also needs runtime dependencies, secrets, resource limits, logging, and monitoring hooks.

Here is a small API contract for the fraud model. The contract gives product engineers, platform engineers, and ML engineers the same expectation for request shape, response shape, latency, and fallback behavior.

```yaml
endpoint: POST /v1/fraud-risk
request:
  payment_id: string
  customer_id: string
  amount_usd: number
  merchant_country: string
  device_id: string
  payment_created_at: timestamp
response:
  model_name: payment-fraud-risk
  model_version: string
  score: number
  decision_band: approve | verify | decline
  reason_codes: list
latency_budget:
  p95_ms: 80
fallback:
  on_timeout: rules_engine_only
  on_feature_error: step_up_verification
```

The fallback section matters. A production system needs a behavior for timeouts, missing features, invalid inputs, and model load failures. The fallback should be boring and explicit. For Northstar Pay, a timeout can send the payment to the existing rules engine instead of leaving the checkout flow stuck.

The serving package also needs an environment. A common pattern is a container image that contains the scoring code, dependency versions, and model-loading logic. Some platforms package the model and code together. Other platforms keep the model artifact in the registry and fetch it at startup. Either way, the release should identify the exact artifact and runtime.

```yaml
serving_image: ghcr.io/northstar/fraud-serving:2026-06-13
model_version: payment-fraud-risk:v18
python_version: "3.11"
dependencies:
  lightgbm: "4.5.0"
  pandas: "2.2.3"
  fastapi: "0.115.0"
runtime:
  cpu: "2"
  memory: "4Gi"
  min_replicas: 4
  max_replicas: 40
```

The serving path should validate inputs before scoring. If `amount_usd` arrives as `"free"` or `merchant_country` arrives empty, the service should reject or route the request through a safe fallback. Input validation protects the model from data shapes it never learned from and gives engineers clear logs when upstream systems change.

Now the model has a serving path. The next lifecycle step is release, where the team decides how the new version gets traffic and how it can be removed quickly.

## Release With Gates And Rollback
<!-- section-summary: Controlled release gates move a model through staging, shadow, canary, and production while preserving a fast rollback path. -->

A **release gate** is a check that must pass before a model version moves forward. Gates turn the lifecycle from a hopeful handoff into an evidence-based release. For Northstar Pay, a gate might require approved offline metrics, successful shadow testing, latency inside budget, product owner approval, and a documented rollback plan.

The release can move through several stages. Each stage gives the team more production evidence while limiting how many customers feel the new model behavior.

| Stage | What happens | What the team learns |
|---|---|---|
| **Staging** | Test the service with synthetic and replayed requests | The model loads, the API contract works, and dependencies fit the runtime |
| **Shadow** | Send production inputs to the model without using its decision | The team sees real score distributions and latency with no customer impact |
| **Canary** | Send a small share of real decisions to the model | The team measures early business and system impact |
| **Production** | Increase traffic after gates pass | The model becomes the normal decision path |

Shadow testing is especially useful for ML systems. The candidate model sees real production inputs, and the team can compare its scores with the current production model. Since the candidate does not affect the customer yet, the team can inspect surprises before canary traffic begins.

A canary release starts small. Northstar Pay might send 1 percent of eligible payments to `v18`, then 5 percent, then 25 percent, then 100 percent. Each step checks dashboards before traffic increases. The dashboards should include normal service health and model-specific signals.

```yaml
release_plan:
  model_version: payment-fraud-risk:v18
  stages:
    - name: shadow
      duration: 48h
      pass:
        p95_latency_ms_below: 80
        feature_error_rate_below: 0.1
        score_distribution_reviewed: true
    - name: canary_1_percent
      duration: 24h
      pass:
        auth_success_rate_drop_below: 0.05
        verification_rate_below: 3.0
        fraud_ops_alerts_clear: true
    - name: canary_5_percent
      duration: 24h
      pass:
        false_decline_proxy_reviewed: true
        support_ticket_spike: false
rollback:
  target_model_version: payment-fraud-risk:v17
  max_time_to_restore_minutes: 10
  owner: fraud-ml-oncall
```

Rollback means returning the production decision path to a previous safe version or fallback behavior. In ML systems, rollback should include the model version, the serving image, the threshold config, and sometimes the feature pipeline. If the issue comes from a broken feature, rolling back only the model may leave the same bad inputs flowing into the old model.

Once the model reaches production, the lifecycle changes from release work to operating work. The team needs to watch how the system behaves with real users, real attackers, real merchants, and real traffic spikes.

## Monitor The System And The Model
<!-- section-summary: Production monitoring watches service health, data quality, drift, prediction behavior, labels, and business outcomes together. -->

**Monitoring** collects signals that show how the production system behaves. An ML system needs normal software monitoring and model monitoring at the same time.

The software side watches request rate, error rate, latency, CPU, memory, dependency failures, deployment health, and queue depth. If the fraud API times out, Northstar Pay has a production incident even if the model quality remains strong.

The model side watches inputs, outputs, labels, and business effects. **Data drift** means production inputs start looking different from the data used in training or evaluation. **Prediction drift** means model scores or decision bands shift in unexpected ways. **Model quality monitoring** compares predictions with later labels when those labels arrive.

For Northstar Pay, the model team might monitor these signals. The table mixes system health, model behavior, label health, and business impact because all of them can explain a production issue.

| Signal | Example alert | Why it matters |
|---|---|---|
| Feature missing rate | `device_age_days` missing above 2 percent | Missing features can push many payments through fallback logic |
| Input distribution | `merchant_country` mix changes sharply | Traffic may come from a launch, attack, or upstream bug |
| Score distribution | High-risk scores double in one hour | The model may be reacting to a real fraud wave or broken features |
| Decision rate | Verification rate rises above 3 percent | Customers may experience too much friction |
| Latency | p95 exceeds 80 ms | The payment path may slow down |
| Delayed labels | Chargeback join fails for two days | Quality dashboards may silently go stale |
| Business outcome | Support tickets mention blocked payments | The model may hurt customers even while technical metrics look normal |

Prediction logs make this possible. The log should connect the request, model version, features or feature references, score, decision, and later label. Sensitive values need privacy controls, access limits, and retention rules, especially in payment systems.

```json
{
  "request_id": "pay_9f13",
  "model_name": "payment-fraud-risk",
  "model_version": "v18",
  "prediction_timestamp": "2026-06-13T18:42:15Z",
  "features": {
    "amount_usd": 142.39,
    "merchant_country": "US",
    "device_age_days": 3,
    "attempts_last_hour": 4
  },
  "score": 0.78,
  "decision_band": "verify",
  "serving_latency_ms": 41,
  "fallback_used": false
}
```

Monitoring should lead to named actions. A service outage can trigger traffic routing to the fallback rules engine. A feature freshness alert can pause model-based declines and use verification instead. A score distribution alert can ask fraud operations to inspect a possible attack. A quality regression can open a retraining task or roll back to `v17`.

These actions connect monitoring to the final lifecycle step. Production evidence should flow back into the next version, because the world that creates fraud, customer behavior, and payment patterns keeps changing.

## Feed Production Evidence Back Into The Loop
<!-- section-summary: Feedback turns production predictions, labels, incidents, and human reviews into the next training dataset and release decision. -->

**Feedback** means the lifecycle learns from production after the model ships. Feedback can include labels, human review decisions, customer support signals, incident notes, product metrics, and feature-quality reports. The team uses this evidence to debug, retrain, adjust thresholds, or change the product workflow.

For fraud, labels arrive late. A payment might look safe today and become a confirmed chargeback three weeks later. This delay shapes the lifecycle. The team cannot know the full quality of today's predictions immediately, so it needs proxy signals in the short term and label-based evaluation later.

Northstar Pay can build a feedback table that joins predictions with later outcomes. This table turns scattered production events into training evidence, monitoring evidence, and release-review evidence.

| payment_id | model_version | score | decision_band | label_after_30_days | analyst_review | support_signal |
|---|---|---:|---|---|---|---|
| pay_9f13 | v18 | 0.78 | verify | fraud | confirmed | none |
| pay_2a88 | v18 | 0.91 | decline | legitimate | false_positive | customer_complaint |
| pay_7b20 | v18 | 0.12 | approve | legitimate | none | none |

This table helps the team answer concrete questions. Did `v18` catch more fraud than `v17`? Did false declines increase for new customers? Did one merchant category receive too many verifications? Did the model perform worse after a product launch or attacker behavior change?

Feedback does not always mean retraining immediately. Sometimes the right fix is a threshold change, a feature pipeline bug fix, a product rule change, a better fallback, or a new analyst workflow. Retraining helps when the model needs to learn from newer patterns. A broken feature needs engineering work before retraining, because a new model trained on bad data repeats the problem.

A mature lifecycle names retraining triggers. The triggers can be scheduled, event-based, quality-based, or manual, and each trigger should lead to a clear response instead of a vague improvement request.

| Trigger | Example | Response |
|---|---|---|
| Schedule | Train every Monday after 30-day labels close | Create a fresh candidate and evaluate against production |
| New data | A large batch of analyst-reviewed fraud cases lands | Run training after validation passes |
| Drift | Device-age distribution changes beyond threshold | Investigate upstream data, then retrain if the change is real |
| Quality regression | Recall drops below the release target | Open incident review and create a candidate fix |
| Product change | New payment method launches | Add features or segments before the next release |

Feedback closes the loop, but it also creates accountability. Every new candidate should carry the evidence that caused it to exist. The reason might be "weekly refresh," "fraud pattern changed," "false declines rose in new customers," or "feature pipeline fixed after incident." That reason helps reviewers understand why a model version moved through the lifecycle.

Now all the parts are visible. The lifecycle can be drawn as one loop that keeps the product decision, data, training, release, monitoring, and feedback connected.

## Putting It All Together
<!-- section-summary: The ML system lifecycle is a repeating operating loop that keeps product decisions, data, models, serving, monitoring, and feedback connected. -->

The ML system lifecycle is the path from a product decision to production evidence and back again. Northstar Pay starts with one decision: approve, verify, or decline a payment. That decision defines the target label, the metrics, the guardrails, and the serving pattern.

From there, the team builds training data from production events, validates the data, runs a repeatable training job, evaluates a candidate model, registers an approved version, packages the serving path, releases with gates, monitors real behavior, and feeds labels and incidents into the next cycle. Each stage leaves evidence for the next stage, so the team can explain why a model moved forward or why it stopped.

```mermaid
flowchart TB
    Decision[Product decision<br/>approve, verify, decline]:::plan
    Data[Training data<br/>events, features, labels]:::data
    Train[Training run<br/>code, config, environment]:::compute
    Eval[Evaluation<br/>metrics, segments, guardrails]:::quality
    Registry[Model registry<br/>versions, lineage, approval]:::artifact
    Serving[Serving path<br/>API, features, fallback]:::compute
    Release[Controlled release<br/>shadow, canary, rollback]:::quality
    Monitor[Monitoring<br/>service health, drift, labels]:::quality
    Feedback[Feedback<br/>labels, reviews, incidents]:::data

    Decision --> Data --> Train --> Eval --> Registry --> Serving --> Release --> Monitor --> Feedback --> Data
    Decision --> Eval
    Registry --> Release
    Monitor --> Release

    classDef plan fill:#2a2a2a,stroke:#777,stroke-width:2px,color:#fff
    classDef data fill:#19313a,stroke:#31c6d4,stroke-width:2px,color:#fff
    classDef compute fill:#2c1d3e,stroke:#c446ff,stroke-width:2px,color:#fff
    classDef quality fill:#3c341f,stroke:#f39c12,stroke-width:2px,color:#fff
    classDef artifact fill:#24351f,stroke:#6bd95f,stroke-width:2px,color:#fff
```

Each later MLOps topic fits somewhere in this loop. Data validation protects the data stage. Experiment tracking and reproducibility protect training. Evaluation metrics and segment checks protect release decisions. Registries protect version management. Serving architecture protects the prediction path. Deployment strategies protect rollout. Monitoring and feedback protect the model after it meets the real world. Governance protects the decisions, approvals, and evidence around the whole system.

The lifecycle also shows why MLOps is a team practice. Data engineers keep the input pipelines healthy. Data scientists and ML engineers train and evaluate candidates. Platform engineers provide CI/CD, registries, infrastructure, secrets, and monitoring. Product and risk owners define acceptable behavior. Operations teams respond when production signals cross a line.

A production ML system becomes manageable when every model version has a path through this loop. The team knows why the model exists, which data trained it, which metrics approved it, where it runs, what it is doing now, and what evidence should shape the next version.

---

**References**

- [Google Cloud: MLOps continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) - Describes CI, CD, continuous training, data validation, model validation, metadata management, and monitoring for production ML systems.
- [Microsoft Learn: MLOps model management with Azure Machine Learning](https://learn.microsoft.com/en-us/azure/machine-learning/concept-model-management-and-deployment?view=azureml-api-2) - Covers reproducible pipelines, reusable environments, model registration, deployment, lineage, lifecycle events, and monitoring.
- [AWS SageMaker AI: Model Registry](https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry.html) - Explains model groups, registered model versions, and model registry workflows.
- [AWS SageMaker AI: Update the approval status of a model](https://docs.aws.amazon.com/sagemaker/latest/dg/model-registry-approve.html) - Shows how model version approval can connect evaluation results to CI/CD deployment.
- [AWS SageMaker AI: Data and model quality monitoring](https://docs.aws.amazon.com/sagemaker/latest/dg/model-monitor.html) - Documents monitoring for data quality, model quality, bias drift, and feature attribution drift in production.
- [Microsoft Learn: MLOps maturity model](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/mlops-maturity-model) - Describes progressive MLOps capability levels, including traceability, automated training, automated deployment, and production feedback.
