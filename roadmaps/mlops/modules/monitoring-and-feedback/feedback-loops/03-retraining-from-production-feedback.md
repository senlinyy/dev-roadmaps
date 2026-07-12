---
title: "Feedback-Based Retraining"
description: "Use production feedback to trigger retraining safely with label maturity windows, backfills, validation gates, registry evidence, and rollback plans."
overview: "Feedback-based retraining uses production labels and monitoring evidence to decide when a new model should be trained, evaluated, registered, and released. This guide follows a marketplace abuse classifier through feedback triggers, backfill windows, Airflow orchestration, MLflow tracking, validation gates, and rollback."
tags: ["MLOps", "production", "feedback"]
order: 3
id: "article-mlops-monitoring-and-feedback-retraining-from-production-feedback"
---

## Table of Contents

1. [Feedback-Based Retraining Turns Feedback Into A Release Candidate](#feedback-based-retraining-turns-feedback-into-a-release-candidate)
2. [Follow One Marketplace Abuse Classifier](#follow-one-marketplace-abuse-classifier)
3. [Choose Retraining Triggers](#choose-retraining-triggers)
4. [Build A Backfill Window](#build-a-backfill-window)
5. [Validate Feedback Before Training](#validate-feedback-before-training)
6. [Orchestrate The Retraining Pipeline](#orchestrate-the-retraining-pipeline)
7. [Track And Register The Candidate](#track-and-register-the-candidate)
8. [Gate Release And Plan Rollback](#gate-release-and-plan-rollback)
9. [Practical Checks, Mistakes, And Interview Understanding](#practical-checks-mistakes-and-interview-understanding)
10. [References](#references)

## Feedback-Based Retraining Turns Feedback Into A Release Candidate
<!-- section-summary: Feedback-based retraining uses matured production labels to create a reviewed model candidate rather than retraining on every fresh event. -->

**Feedback-based retraining** is the process of using production feedback labels to train a new model candidate. The feedback might come from user reports, human review, appeals, delayed outcomes, customer corrections, or post-release audits. The goal is to let the model learn from current production reality while keeping the training and release path controlled.

The word "controlled" matters. Fresh feedback can contain mistakes, delayed labels, review bias, incident noise, or policy changes. A good retraining workflow waits for labels to mature, checks coverage, builds a reproducible dataset, trains a candidate, evaluates it against gates, registers the evidence, and releases only after review.

You can think of the workflow as a chain:

| Step | Question it answers |
|---|---|
| Trigger | Is there enough reason to train a new candidate? |
| Backfill | Which production window supplies mature feedback labels? |
| Validation | Are labels, features, and segments healthy enough for training? |
| Training | Can a candidate learn from the new feedback dataset? |
| Evaluation | Does the candidate improve the right metrics and avoid regressions? |
| Registry | Which evidence explains the candidate version? |
| Release | Which rollout and rollback path protects production? |

This article finishes the feedback-loop sequence. The previous articles showed how labels are collected and how human review workflows create trustworthy decisions. Now you will connect those labels to retraining without turning production feedback into an automatic model factory.

## Follow One Marketplace Abuse Classifier
<!-- section-summary: The running scenario follows a marketplace abuse model that classifies risky listings using moderator labels, user reports, appeals, and production prediction logs. -->

Imagine **BazaarGuard**, a marketplace for handmade goods, vintage items, and local services. Sellers create listings, buyers send messages, and the trust-and-safety team reviews policy violations. The company runs a model called `listing_abuse_classifier` that scores new listings for categories such as `counterfeit`, `prohibited_item`, `scam_risk`, `adult_content`, and `safe`.

The model supports two product actions:

| Score range | Action | Feedback source |
|---|---|---|
| High-risk score | Send listing to moderator review before publication | Moderator final decision |
| Medium-risk score | Publish with post-review sampling | User reports and sampled moderator review |
| Low-risk score | Publish normally | User reports, appeals, and routine audits |

Production feedback arrives from several places. Moderators label reviewed listings. Buyers report suspicious listings. Sellers appeal decisions. A policy team updates guidelines when new scam patterns appear. The model team wants to retrain when feedback shows that production has moved away from the last training set.

The key production tables look like this:

```sql
CREATE TABLE mlops.listing_abuse_predictions (
  prediction_id STRING NOT NULL,
  listing_id STRING NOT NULL,
  seller_id_hash STRING NOT NULL,
  predicted_at TIMESTAMP NOT NULL,
  model_name STRING NOT NULL,
  model_version STRING NOT NULL,
  model_alias STRING NOT NULL,
  policy_version STRING NOT NULL,
  predicted_label STRING NOT NULL,
  predicted_score FLOAT64 NOT NULL,
  score_vector ARRAY<STRUCT<label STRING, score FLOAT64>> NOT NULL,
  category STRING,
  seller_region STRING,
  listing_language STRING,
  listing_text_hash STRING NOT NULL,
  feature_snapshot_uri STRING,
  action_taken STRING NOT NULL
)
PARTITION BY DATE(predicted_at)
CLUSTER BY model_version, predicted_label, action_taken;
```

```sql
CREATE TABLE mlops.listing_abuse_feedback (
  feedback_id STRING NOT NULL,
  listing_id STRING NOT NULL,
  prediction_id STRING,
  feedback_source STRING NOT NULL,
  feedback_label STRING NOT NULL,
  feedback_created_at TIMESTAMP NOT NULL,
  feedback_available_at TIMESTAMP NOT NULL,
  actor_type STRING NOT NULL,
  actor_id_hash STRING,
  appeal_outcome STRING,
  policy_version STRING NOT NULL,
  confidence FLOAT64,
  rationale_code STRING,
  audit_packet_uri STRING
)
PARTITION BY DATE(feedback_created_at)
CLUSTER BY feedback_source, feedback_label;
```

The prediction table records what the model did. The feedback table records later answers. The retraining workflow should use both and keep the join reproducible.

## Choose Retraining Triggers
<!-- section-summary: Retraining triggers should combine label volume, metric movement, drift evidence, policy changes, and incident follow-up. -->

A retraining trigger is the reason to start a new candidate run. Some teams retrain on a fixed schedule, such as weekly or monthly. That can work when labels arrive reliably and the product changes often. Other teams trigger retraining only when monitoring or feedback shows a need. The strongest systems use both: a regular check plus explicit trigger rules.

BazaarGuard uses five trigger types:

| Trigger | Example | Why it matters |
|---|---|---|
| Label volume | 80,000 mature labels collected since last candidate | New data can support a meaningful train/eval split |
| Quality regression | Moderator override rate rises for `scam_risk` | The live model may miss current abuse patterns |
| Segment drift | Spanish listings have rising report-to-confirmation rate | A segment may need new examples or threshold changes |
| Policy update | Trust team adds a new prohibited item rule | Labels before and after the rule need careful separation |
| Incident follow-up | A counterfeit campaign bypassed the model last week | Retraining may help after containment and root-cause review |

The triggers should write records. A retraining run should never start because someone vaguely felt that the model was old. BazaarGuard stores trigger events:

```sql
CREATE TABLE mlops.retraining_triggers (
  trigger_id STRING NOT NULL,
  model_name STRING NOT NULL,
  created_at TIMESTAMP NOT NULL,
  trigger_type STRING NOT NULL,
  severity STRING NOT NULL,
  evidence_window_start TIMESTAMP NOT NULL,
  evidence_window_end TIMESTAMP NOT NULL,
  metric_name STRING,
  current_value FLOAT64,
  threshold_value FLOAT64,
  segment_key STRING,
  owner STRING NOT NULL,
  decision STRING NOT NULL,
  decision_notes_uri STRING
);
```

A daily trigger query can create candidates for review:

```sql
INSERT INTO mlops.retraining_triggers (
  trigger_id,
  model_name,
  created_at,
  trigger_type,
  severity,
  evidence_window_start,
  evidence_window_end,
  metric_name,
  current_value,
  threshold_value,
  segment_key,
  owner,
  decision,
  decision_notes_uri
)
SELECT
  GENERATE_UUID(),
  'listing_abuse_classifier',
  CURRENT_TIMESTAMP(),
  'quality_regression',
  CASE WHEN override_rate >= 0.18 THEN 'high' ELSE 'medium' END,
  window_start,
  window_end,
  'moderator_override_rate',
  override_rate,
  0.12,
  CONCAT(category, ':', listing_language),
  'trust-ml-oncall',
  'needs_retraining_review',
  review_packet_uri
FROM mlops.abuse_feedback_segment_metrics
WHERE window_end = TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), DAY)
  AND reviewed_predictions >= 500
  AND override_rate >= 0.12;
```

This trigger creates evidence for a human decision. The training pipeline may run automatically after approval, yet the trigger record still explains why the run exists.

![BazaarGuard retraining trigger review](/content-assets/articles/article-mlops-monitoring-and-feedback-retraining-from-production-feedback/bazaarguard-trigger-review.png)
*BazaarGuard starts retraining from a trigger record with evidence, an owner, data checks, and an approval decision instead of a vague feeling that the model is old.*

## Build A Backfill Window
<!-- section-summary: A backfill window selects production feedback with mature labels, stable policy meaning, and reproducible time boundaries. -->

A **backfill window** is the slice of production history used to create training data. It should have a start time, end time, label maturity rule, policy version rule, and source-table versions. The window keeps the dataset reproducible and protects training from fresh labels that have less time to arrive.

BazaarGuard uses a 60-day training window and a 14-day label maturity delay. Appeals can change a moderation label after the first decision, so the workflow waits two weeks before treating labels as mature. The team also separates policy versions because an old label may mean something different after a policy update.

```yaml
feedback_backfill_window:
  model_name: listing_abuse_classifier
  training_window_days: 60
  label_maturity_days: 14
  run_as_of: "2026-07-05T00:00:00Z"
  prediction_start: "2026-04-22T00:00:00Z"
  prediction_end: "2026-06-21T00:00:00Z"
  allowed_feedback_sources:
    - moderator_final_decision
    - appeal_final_outcome
    - trust_safety_audit
  policy_versions:
    - "2026-05-marketplace-abuse-v4"
    - "2026-06-marketplace-abuse-v5"
  holdouts:
    time_holdout:
      start: "2026-06-14T00:00:00Z"
      end: "2026-06-21T00:00:00Z"
    incident_holdout:
      incident_id: "INC-2026-06-18-COUNTERFEIT-CAMPAIGN"
```

The window ends on June 21 even though the run happens on July 5. That gives two weeks for appeals and moderator updates to arrive. The holdout window keeps the most recent mature week out of training so the team can evaluate on data that feels closer to production.

![BazaarGuard backfill and label maturity window](/content-assets/articles/article-mlops-monitoring-and-feedback-retraining-from-production-feedback/bazaarguard-backfill-maturity-window.png)
*The backfill window, holdout week, maturity delay, and run-as-of cutoff decide which feedback rows can move into the training split.*

The dataset query should keep source and timing columns:

```sql
CREATE TABLE ml_training.listing_abuse_feedback_2026_07_05 AS
WITH best_feedback AS (
  SELECT
    p.prediction_id,
    p.listing_id,
    f.feedback_label,
    f.feedback_source,
    f.feedback_available_at,
    f.policy_version AS feedback_policy_version,
    ROW_NUMBER() OVER (
      PARTITION BY p.prediction_id
      ORDER BY
        CASE f.feedback_source
          WHEN 'appeal_final_outcome' THEN 1
          WHEN 'moderator_final_decision' THEN 2
          WHEN 'trust_safety_audit' THEN 3
          ELSE 9
        END,
        f.feedback_available_at DESC
    ) AS feedback_rank
  FROM mlops.listing_abuse_predictions p
  JOIN mlops.listing_abuse_feedback f
    ON f.listing_id = p.listing_id
   AND f.feedback_available_at >= p.predicted_at
  WHERE p.predicted_at >= TIMESTAMP '2026-04-22 00:00:00 UTC'
    AND p.predicted_at < TIMESTAMP '2026-06-21 00:00:00 UTC'
    AND f.feedback_available_at < TIMESTAMP '2026-07-05 00:00:00 UTC'
    AND f.feedback_source IN (
      'moderator_final_decision',
      'appeal_final_outcome',
      'trust_safety_audit'
    )
)
SELECT
  p.prediction_id,
  p.listing_id,
  p.seller_id_hash,
  p.predicted_at,
  p.model_version AS previous_model_version,
  p.policy_version AS prediction_policy_version,
  p.predicted_label,
  p.predicted_score,
  p.category,
  p.seller_region,
  p.listing_language,
  p.feature_snapshot_uri,
  b.feedback_label AS target_label,
  b.feedback_source,
  b.feedback_available_at,
  b.feedback_policy_version,
  CASE
    WHEN p.predicted_at >= TIMESTAMP '2026-06-14 00:00:00 UTC' THEN 'time_holdout'
    ELSE 'train'
  END AS split_name
FROM mlops.listing_abuse_predictions p
JOIN best_feedback b
  ON b.prediction_id = p.prediction_id
 AND b.feedback_rank = 1;
```

The split is time-based because marketplace abuse changes over time. Random splitting could leak near-duplicate campaign patterns across train and holdout. A time holdout asks a better production question: can the candidate handle mature feedback from the latest week?

## Validate Feedback Before Training
<!-- section-summary: Feedback validation checks label coverage, source balance, segment health, policy consistency, and leakage risks before compute-heavy training starts. -->

Before training starts, the dataset should prove it is healthy. Feedback data can fail in quiet ways: one label source disappears, one language has low coverage, an appeal backfill changes old labels, or an incident period dominates the sample. Training on that data can create a candidate that passes overall metrics and fails in production.

BazaarGuard checks coverage and balance:

```sql
SELECT
  split_name,
  COUNT(*) AS rows,
  COUNT(DISTINCT listing_id) AS listings,
  COUNT(DISTINCT seller_id_hash) AS sellers,
  AVG(CASE WHEN target_label = 'safe' THEN 1 ELSE 0 END) AS safe_rate,
  COUNTIF(feedback_source = 'appeal_final_outcome') AS appeal_labels,
  COUNTIF(feedback_source = 'moderator_final_decision') AS moderator_labels
FROM ml_training.listing_abuse_feedback_2026_07_05
GROUP BY split_name;
```

Then it checks segment coverage:

```sql
SELECT
  split_name,
  category,
  listing_language,
  COUNT(*) AS rows,
  AVG(CASE WHEN target_label = predicted_label THEN 1 ELSE 0 END) AS previous_model_agreement
FROM ml_training.listing_abuse_feedback_2026_07_05
GROUP BY split_name, category, listing_language
HAVING rows >= 250
ORDER BY previous_model_agreement ASC;
```

The first query catches broad dataset problems. The second query shows where the previous model disagreed with feedback. Low agreement in a high-volume segment may explain the retraining trigger. Low coverage in a segment may block release because the team lacks enough evidence to evaluate it.

The validation rules should live in a gate config:

```yaml
feedback_dataset_gates:
  min_rows:
    train: 50000
    time_holdout: 5000
  min_distinct_sellers:
    train: 10000
  max_missing_feature_snapshot_rate: 0.002
  required_labels:
    - safe
    - counterfeit
    - prohibited_item
    - scam_risk
    - adult_content
  segment_min_rows:
    category_language_pair: 250
  appeal_label_share:
    max: 0.35
  blocked_conditions:
    - policy_version_missing
    - feedback_available_after_run_as_of
    - duplicate_prediction_id
```

These gates keep bad feedback out of training. They also give reviewers concrete reasons when a run stops. A failed gate should create an issue or review packet instead of disappearing inside a scheduler log.

## Orchestrate The Retraining Pipeline
<!-- section-summary: A retraining pipeline should build data, validate it, train a candidate, evaluate gates, register evidence, and notify release owners. -->

Retraining should run through an orchestrator so every step has dependencies, logs, retries, and a visible status. Airflow, Dagster, Prefect, Kubeflow Pipelines, and managed cloud pipeline systems can all do this. The core shape is the same: build the dataset, validate it, train the candidate, evaluate it, register the evidence, and ask for release review.

Here is an Airflow TaskFlow-style sketch using the current decorator pattern from the official docs:

```python
import pendulum

from airflow.sdk import dag, task


@dag(
    dag_id="listing_abuse_feedback_retraining",
    schedule="@daily",
    start_date=pendulum.datetime(2026, 7, 1, tz="UTC"),
    catchup=False,
    tags=["mlops", "feedback", "abuse"],
)
def listing_abuse_feedback_retraining():
    @task()
    def find_approved_trigger() -> dict:
        return query_one("""
            SELECT trigger_id, evidence_window_start, evidence_window_end
            FROM mlops.retraining_triggers
            WHERE model_name = 'listing_abuse_classifier'
              AND decision = 'approved_for_training'
            ORDER BY created_at DESC
            LIMIT 1
        """)

    @task()
    def build_feedback_dataset(trigger: dict) -> dict:
        return run_sql_job(
            sql_path="sql/build_listing_abuse_feedback_dataset.sql",
            params={
                "trigger_id": trigger["trigger_id"],
                "run_as_of": pendulum.now("UTC").to_iso8601_string(),
            },
        )

    @task()
    def validate_dataset(dataset: dict) -> dict:
        return run_validation_suite(
            suite_path="checks/listing_abuse_feedback_gates.yml",
            dataset_name=dataset["dataset_name"],
        )

    @task()
    def train_candidate(validation: dict) -> dict:
        return run_training_job(
            image="ghcr.io/bazaarguard/ml-training:2026.07.05",
            command=[
                "python",
                "-m",
                "training.train_listing_abuse",
                "--dataset",
                validation["dataset_name"],
                "--trigger-id",
                validation["trigger_id"],
            ],
        )

    @task()
    def notify_release_review(candidate: dict) -> None:
        send_release_packet(
            channel="#trust-ml-release",
            model_name="listing_abuse_classifier",
            model_version=candidate["registered_model_version"],
            evaluation_report_uri=candidate["evaluation_report_uri"],
        )

    trigger = find_approved_trigger()
    dataset = build_feedback_dataset(trigger)
    validation = validate_dataset(dataset)
    candidate = train_candidate(validation)
    notify_release_review(candidate)


listing_abuse_feedback_retraining()
```

The code is a sketch, yet the structure is real. Each task returns a small payload that the next task can use. The training job runs in a pinned container image, so the run records the code and dependency environment. The final task sends a release packet rather than pushing the candidate straight to production.

The orchestrator should record run metadata:

```yaml
pipeline_run_record:
  pipeline: listing_abuse_feedback_retraining
  dag_run_id: scheduled__2026-07-05T00:00:00Z
  trigger_id: trg_20260705_scam_risk_es
  dataset_name: ml_training.listing_abuse_feedback_2026_07_05
  run_as_of: "2026-07-05T00:00:00Z"
  training_image: ghcr.io/bazaarguard/ml-training:2026.07.05
  git_sha: "8a31c9d"
  status: candidate_registered
```

This record matters during rollback and audits. If a release fails, the team can trace the candidate back to the trigger, dataset, container, and code.

## Track And Register The Candidate
<!-- section-summary: MLflow tracking and registry records should capture dataset identity, metrics, signatures, input examples, aliases, and approval evidence. -->

Training should write an experiment record and a registry record. The experiment record explains the run: parameters, metrics, dataset, code, container, and artifacts. The registry record explains the candidate version that release automation may use.

Here is a compact scikit-learn and MLflow example. It uses `name=` for model logging, includes an input example and signature, and records feedback-specific tags:

```python
import mlflow
import mlflow.sklearn
import pandas as pd
from mlflow.models import infer_signature
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, precision_recall_fscore_support
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

MODEL_NAME = "catalog.trust_ml.listing_abuse_classifier"

train_df = pd.read_parquet("s3://bazaarguard-ml/datasets/listing_abuse_feedback_2026_07_05/train.parquet")
holdout_df = pd.read_parquet("s3://bazaarguard-ml/datasets/listing_abuse_feedback_2026_07_05/time_holdout.parquet")

feature_cols = ["listing_text_clean", "category", "seller_region", "listing_language"]
target_col = "target_label"

preprocess = ColumnTransformer(
    transformers=[
        ("text", TfidfVectorizer(max_features=25000, ngram_range=(1, 2)), "listing_text_clean"),
        ("cat", OneHotEncoder(handle_unknown="ignore"), ["category", "seller_region", "listing_language"]),
    ]
)

model = Pipeline(
    steps=[
        ("features", preprocess),
        ("classifier", LogisticRegression(max_iter=500, class_weight="balanced")),
    ]
)

X_train = train_df[feature_cols]
y_train = train_df[target_col]
X_holdout = holdout_df[feature_cols]
y_holdout = holdout_df[target_col]

with mlflow.start_run(run_name="feedback_retraining_2026_07_05") as run:
    model.fit(X_train, y_train)
    predictions = model.predict(X_holdout)
    report = classification_report(y_holdout, predictions, output_dict=True)
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_holdout,
        predictions,
        labels=["counterfeit", "prohibited_item", "scam_risk", "adult_content"],
        average="macro",
        zero_division=0,
    )

    mlflow.log_params({
        "dataset": "listing_abuse_feedback_2026_07_05",
        "training_window_days": 60,
        "label_maturity_days": 14,
        "model_family": "logistic_regression_tfidf",
    })
    mlflow.log_metrics({
        "holdout_macro_precision_abuse": precision,
        "holdout_macro_recall_abuse": recall,
        "holdout_macro_f1_abuse": f1,
        "holdout_accuracy": report["accuracy"],
    })
    mlflow.log_dict(report, "evaluation/classification_report.json")

    input_example = X_holdout.head(5)
    signature = infer_signature(input_example, model.predict(input_example))
    model_info = mlflow.sklearn.log_model(
        sk_model=model,
        name="abuse_classifier",
        input_example=input_example,
        signature=signature,
        registered_model_name=MODEL_NAME,
        tags={
            "trigger_id": "trg_20260705_scam_risk_es",
            "feedback_dataset": "listing_abuse_feedback_2026_07_05",
            "run_as_of": "2026-07-05T00:00:00Z",
        },
    )

    print(model_info.model_uri)
    print(run.info.run_id)
```

The snippet logs metrics, the classification report, the input example, the signature, and the registered model. The classifier is simple on purpose. In many abuse systems, teams use stronger models and richer features, yet the MLOps lesson stays the same: record the data, evidence, and candidate identity.

The release pipeline should then add aliases or tags through the registry after gates pass:

```python
from mlflow import MlflowClient

client = MlflowClient()

client.set_model_version_tag(
    name="catalog.trust_ml.listing_abuse_classifier",
    version="37",
    key="release_gate_status",
    value="passed_offline_review",
)

client.set_registered_model_alias(
    name="catalog.trust_ml.listing_abuse_classifier",
    alias="Candidate",
    version="37",
)
```

Aliases make serving and release automation easier because the system can ask for `Candidate` or `Champion` instead of hardcoding a version in every script. The concrete model version still belongs in logs and release packets.

## Gate Release And Plan Rollback
<!-- section-summary: A feedback-trained candidate needs offline gates, segment gates, human review, shadow or canary release, and a clear rollback target. -->

A retrained model should pass gates before it receives production traffic. Gates should compare the candidate with the current production version and with fixed safety thresholds. BazaarGuard cares about catching abuse and avoiding false positives that punish legitimate sellers, so the gates include class metrics, appeal impact, and segment checks.

```yaml
release_gates:
  model: catalog.trust_ml.listing_abuse_classifier
  candidate_version: "37"
  baseline_version: "36"
  required_metrics:
    holdout_macro_recall_abuse:
      min: 0.82
      min_delta_vs_baseline: 0.01
    holdout_macro_precision_abuse:
      min: 0.76
      min_delta_vs_baseline: -0.01
    counterfeit_recall:
      min: 0.88
    safe_false_positive_rate:
      max: 0.035
    appeal_overturn_rate_proxy:
      max: 0.08
  segment_gates:
    listing_language:
      min_rows: 500
      max_false_positive_rate: 0.05
    seller_region:
      min_rows: 500
      max_recall_drop_vs_baseline: 0.03
  required_reviews:
    - trust_and_safety_policy_owner
    - abuse_ml_owner
    - marketplace_operations_owner
  release_path:
    - shadow_24h
    - canary_5_percent
    - canary_25_percent
    - full_release
  rollback_target:
    model_version: "36"
    alias: Champion
```

The release packet should show the candidate and the baseline together:

```sql
SELECT
  metric_name,
  baseline_value,
  candidate_value,
  candidate_value - baseline_value AS delta,
  gate_result
FROM mlops.model_release_gate_results
WHERE model_name = 'listing_abuse_classifier'
  AND candidate_version = '37'
ORDER BY gate_result, metric_name;
```

During shadow release, the candidate scores live listings while the current production model still controls the product action. The team compares live score distributions, disagreement, latency, and review outcomes. During canary release, a small slice of eligible traffic uses the candidate, and monitors watch abuse catch rate, seller appeals, moderator load, and latency.

Rollback should be ready before the canary starts:

![BazaarGuard release gates and rollback path](/content-assets/articles/article-mlops-monitoring-and-feedback-retraining-from-production-feedback/bazaarguard-release-gates-rollback.png)
*Offline gates, shadow scoring, canary traffic, and a ready Champion rollback keep a feedback-trained candidate from skipping release discipline.*

```yaml
rollback_runbook:
  trigger_conditions:
    - safe_false_positive_rate_above_0_04_for_30_minutes
    - seller_appeal_rate_above_baseline_by_25_percent
    - moderator_queue_p95_age_above_45_minutes
    - production_error_rate_above_1_percent
  actions:
    - move_serving_alias_Champion_back_to_version_36
    - set_canary_weight_to_0
    - pause_feedback_retraining_trigger_for_incident_segments
    - keep_candidate_shadow_logging_enabled_for_analysis
  verification:
    - prediction_logs_show_model_version_36_for_new_actions
    - appeal_rate_returns_to_baseline_band
    - moderator_queue_age_recovers
    - incident_packet_links_candidate_run_and_dataset
```

The key rollback habit is to move the serving pointer and traffic route first, then preserve evidence. Deleting the candidate or feedback dataset during an incident can erase the clues that explain the failure. Keep the candidate registered, mark it blocked, and attach the incident packet.

## Practical Checks, Mistakes, And Interview Understanding
<!-- section-summary: A reliable feedback retraining system has explicit triggers, mature labels, reproducible datasets, validation gates, registry evidence, and rollback. -->

Before approving a feedback retraining pipeline, BazaarGuard asks:

```yaml
feedback_retraining_checks:
  trigger:
    - trigger_record_has_owner_metric_window_and_decision
    - policy_change_or_incident_context_recorded
  data:
    - backfill_window_has_run_as_of_prediction_start_prediction_end
    - label_maturity_delay_applied
    - train_and_time_holdout_splits_created
    - label_source_distribution_reviewed
  validation:
    - feedback_dataset_gates_passed
    - segment_metrics_passed_or_have_review_notes
    - leakage_checks_reviewed
  training:
    - run_logs_dataset_name_git_sha_container_image
    - model_signature_and_input_example_logged
    - evaluation_report_saved
  release:
    - registry_candidate_alias_set_after_gates
    - baseline_version_and_rollback_target_recorded
    - shadow_or_canary_plan_approved
```

Common mistakes follow a pattern. Some teams retrain every night without checking whether labels are mature. Some teams combine policy versions and then train on labels with different meanings. Some teams evaluate only overall accuracy and miss the false-positive harm to good sellers. Some teams let the training job update production directly, which removes the review step where business owners can catch a risky candidate.

In an interview, explain feedback-based retraining as a release workflow that contains a training script inside a larger control path. Start with trigger evidence, then describe the backfill window and label maturity delay. Explain dataset validation, time-based holdout, segment metrics, MLflow tracking, registry aliases, release gates, shadow or canary release, and rollback.

A strong answer might sound like this: "For a marketplace abuse classifier, I would train from production feedback only after moderator and appeal labels mature. The pipeline would build a reproducible dataset with source and policy metadata, validate coverage by category and language, train a candidate in an orchestrated job, log metrics and a signature in MLflow, assign a candidate alias after gates, and release through shadow and canary with a rollback target."

That answer shows the central lesson. Feedback can improve the model, and production feedback also carries risk. Mature labels, validation gates, and rollback plans turn that risk into a controlled MLOps workflow.

## References

- [Apache Airflow: TaskFlow](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/taskflow.html)
- [Apache Airflow: DAG runs and data intervals](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dag-run.html)
- [MLflow scikit-learn API](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.sklearn.html)
- [MLflow Model Registry workflows](https://mlflow.org/docs/latest/ml/model-registry/workflow/)
- [MLflow Model Evaluation](https://mlflow.org/docs/latest/ml/evaluation/)
- [scikit-learn: Metrics and scoring](https://scikit-learn.org/stable/modules/model_evaluation.html)
- [NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
