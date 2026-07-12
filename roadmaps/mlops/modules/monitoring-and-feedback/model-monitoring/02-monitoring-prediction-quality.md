---
title: "Prediction Quality"
description: "Show how teams measure deployed model outcomes with delayed labels, thresholds, quality windows, and alertable metrics."
overview: "Prediction quality monitoring checks whether model decisions still match the outcomes the business cares about. This guide follows a fraud queue classifier through prediction logging, delayed chargeback labels, precision and recall windows, SQL dashboards, scikit-learn metric jobs, Evidently reports, Prometheus alerts, and triage notes."
tags: ["MLOps", "production", "drift"]
order: 2
id: "article-mlops-monitoring-and-feedback-monitoring-prediction-quality"
---

## Table of Contents

1. [Prediction Quality Measures Whether Decisions Still Work](#prediction-quality-measures-whether-decisions-still-work)
2. [Follow One Fraud Queue Classifier](#follow-one-fraud-queue-classifier)
3. [Log Scores, Decisions, Thresholds, And Labels](#log-scores-decisions-thresholds-and-labels)
4. [Use Matured Label Windows](#use-matured-label-windows)
5. [Compute Quality Metrics With SQL And scikit-learn](#compute-quality-metrics-with-sql-and-scikit-learn)
6. [Turn Metrics Into Dashboards And Alerts](#turn-metrics-into-dashboards-and-alerts)
7. [Review Prediction Quality With Evidently](#review-prediction-quality-with-evidently)
8. [Triage A Quality Drop](#triage-a-quality-drop)
9. [Practical Checks, Common Mistakes, And Interview Understanding](#practical-checks-common-mistakes-and-interview-understanding)
10. [References](#references)

## Prediction Quality Measures Whether Decisions Still Work
<!-- section-summary: Prediction quality connects model outputs to later outcomes, so the team can see whether production decisions still help the product. -->

**Prediction quality monitoring** checks whether deployed model outputs still lead to correct or useful decisions after the model reaches real users. It answers a simple question: are the predictions still good enough for the workflow they drive?

For classification, quality might mean precision, recall, false positive rate, false negative rate, calibration, area under the precision-recall curve, or cost-weighted loss. For regression, it might mean mean absolute error, p90 absolute error, bias, or coverage of prediction intervals. For ranking, it might mean click-through rate, purchase rate, nDCG, or segment fairness checks. The right metric depends on the product decision.

Prediction quality differs from service health. A model endpoint can return `200 OK`, stay under latency targets, and still make poor decisions. Quality monitoring needs the prediction logs and the later labels. That label delay shapes the whole system. You often need fast proxy signals today and confirmed quality metrics after outcomes mature.

The production loop looks like this:

| Step | What the team records | Why it matters |
|---|---|---|
| Predict | Score, class, threshold, model version, request ID, segment keys | Lets you replay which decision the system made |
| Decide | Approve, decline, queue, rank, route, recommend, or fallback | Connects model score to product behavior |
| Label | Chargeback, conversion, delivery time, human review, defect result | Gives the later truth signal |
| Measure | Precision, recall, error, calibration, queue load, cost | Shows whether the system still meets its quality target |
| Act | Threshold change, review rule, rollback, retraining, data fix | Turns the metric into a product response |

In a real MLOps system, quality monitoring is a scheduled job, a dashboard, and a runbook. It should say which model version, threshold, segment, label window, and owner are involved. A chart without those details can create debate instead of action.

## Follow One Fraud Queue Classifier
<!-- section-summary: The running scenario uses a payment fraud classifier where false positives hurt good customers and false negatives let fraud through. -->

Imagine **RiverGate Cards**, a card issuer that screens online card transactions. A model named `fraud_queue_classifier` scores each transaction from 0 to 1. High scores go to a human review queue, very high scores can be blocked automatically, and low scores pass through.

The model is only one part of the decision policy:

```yaml
fraud_decision_policy:
  model: fraud_queue_classifier
  model_version: "31"
  thresholds:
    allow_below: 0.35
    review_at_or_above: 0.35
    block_at_or_above: 0.92
  queue_limits:
    max_reviews_per_hour: 4200
    priority_review_amount_usd: 500
  protected_segments:
    new_card_first_24h:
      block_at_or_above: 0.97
      require_manual_review: true
```

The threshold values matter as much as the model. If the review threshold moves from `0.35` to `0.25`, recall may rise because more fraud gets reviewed. Precision may fall because analysts see more good transactions. Customer friction may rise because more shoppers receive a review delay. Quality monitoring has to include the threshold and the decision policy.

RiverGate cares about several quality questions:

| Question | Metric | Why it matters |
|---|---|---|
| How many fraud cases did we catch? | Recall on labelled fraud | Missed fraud creates financial loss |
| How clean is the review queue? | Precision among reviewed transactions | Low precision wastes analyst time and annoys customers |
| Are good customers blocked? | False positive rate for automatic blocks | Good-customer blocks damage trust |
| Does the score rank risk well? | Average precision or PR AUC | Ranking matters when queue capacity is limited |
| Are segments treated consistently? | Metrics by merchant type, country, channel, card age | A global metric can hide harm in one segment |

Fraud labels arrive late. A chargeback can appear days or weeks after the original authorization. A manual analyst label can arrive within minutes. Customer disputes can arrive much later. RiverGate therefore monitors early human-review quality and later chargeback-confirmed quality separately.

## Log Scores, Decisions, Thresholds, And Labels
<!-- section-summary: Prediction quality needs logs that capture model output, decision policy, segment keys, and the later label source. -->

Quality monitoring starts with the prediction log. For RiverGate, every scored transaction writes one row:

```json
{
  "prediction_id": "pred_01J0R7R2N4MT",
  "transaction_id": "txn_874223910",
  "event_ts": "2026-07-05T14:11:32Z",
  "model_name": "fraud_queue_classifier",
  "model_version": "31",
  "feature_pipeline_version": "features_2026_06_28",
  "score": 0.81,
  "threshold_review": 0.35,
  "threshold_block": 0.92,
  "decision": "manual_review",
  "amount_usd": 842.19,
  "merchant_category": "electronics",
  "country": "GB",
  "channel": "card_not_present",
  "card_age_days": 3,
  "label": {
    "fraud_confirmed": null,
    "label_source": null,
    "label_ts": null
  }
}
```

The exact feature values may be sensitive, so RiverGate stores full feature payloads in a restricted table and sends only approved segment keys to broad dashboards. The monitoring job still needs enough context to answer quality questions. `merchant_category`, `country`, `channel`, amount band, and card age help the team see where the classifier is slipping.

When labels arrive, a label table links outcomes back to predictions:

```sql
CREATE TABLE IF NOT EXISTS fraud_monitoring.transaction_labels (
  transaction_id STRING,
  fraud_confirmed BOOL,
  label_source STRING,
  label_ts TIMESTAMP,
  chargeback_amount_usd NUMERIC,
  analyst_queue_id STRING
);
```

The label source matters. Analyst review labels arrive quickly, while chargeback labels arrive later and may represent a different population. If you train the dashboard on only analyst-reviewed transactions, you can bias the quality view toward cases the policy already selected. RiverGate tracks `label_source` and reports manual-review quality separately from chargeback-confirmed quality.

## Use Matured Label Windows
<!-- section-summary: A matured label window only measures predictions old enough to have reliable outcomes, which protects dashboards from fake quality swings. -->

A **matured label window** includes predictions old enough for labels to be reasonably complete. This is one of the most important ideas in prediction quality monitoring. If you measure today's transactions at noon, most fraud outcomes are still missing. The dashboard will say fraud is low because the labels are missing rather than because the model is great.

RiverGate uses two windows:

| Window | Label source | Delay | Used for |
|---|---|---:|---|
| Fast review quality | Analyst review outcome | 2 hours | Queue precision, analyst workload, early threshold checks |
| Confirmed fraud quality | Chargeback and dispute outcome | 14 days | Recall, false negative estimates, financial loss, retraining decisions |

The confirmed window query excludes recent transactions whose labels are still immature:

```sql
WITH labelled_predictions AS (
  SELECT
    p.prediction_id,
    p.transaction_id,
    p.event_ts,
    p.model_version,
    p.score,
    p.threshold_review,
    p.threshold_block,
    p.decision,
    p.amount_usd,
    p.merchant_category,
    p.country,
    p.channel,
    p.card_age_days,
    l.fraud_confirmed,
    l.label_source,
    l.label_ts
  FROM fraud_monitoring.prediction_log p
  JOIN fraud_monitoring.transaction_labels l
    ON p.transaction_id = l.transaction_id
  WHERE p.event_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 28 DAY)
    AND p.event_ts < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
    AND l.label_source IN ("chargeback", "confirmed_dispute")
)
SELECT *
FROM labelled_predictions;
```

This window is slower, yet it is more trustworthy for confirmed fraud. A good dashboard should show the label maturity next to the metric. RiverGate displays "confirmed fraud window: 14-28 days old" at the top of the chart so product and risk teams understand why the chart lags.

The fast window still has value. If the analyst queue suddenly loses precision, analysts will see many more good transactions. That signal can appear within hours. RiverGate treats it as an early warning and then waits for confirmed labels before making long-term model decisions.

![RiverGate fraud label windows](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-prediction-quality/rivergate-label-windows.png)

*The label-window timeline keeps fast analyst signals separate from slower chargeback-confirmed quality metrics.*

## Compute Quality Metrics With SQL And scikit-learn
<!-- section-summary: SQL gives transparent production windows, while scikit-learn gives well-known metric functions for repeatable metric jobs. -->

SQL is often the best first tool for production quality monitoring because the prediction log and labels usually live in the warehouse. A daily job can compute the same metrics by model version and segment:

```sql
WITH scored AS (
  SELECT
    model_version,
    channel,
    merchant_category,
    country,
    amount_usd,
    CASE WHEN score >= threshold_review THEN 1 ELSE 0 END AS predicted_review,
    CASE WHEN fraud_confirmed THEN 1 ELSE 0 END AS actual_fraud
  FROM fraud_monitoring.labelled_predictions_14d
),
metrics AS (
  SELECT
    model_version,
    channel,
    merchant_category,
    COUNT(*) AS transactions,
    SUM(predicted_review) AS predicted_reviews,
    SUM(actual_fraud) AS confirmed_fraud,
    SUM(CASE WHEN predicted_review = 1 AND actual_fraud = 1 THEN 1 ELSE 0 END) AS true_positives,
    SUM(CASE WHEN predicted_review = 1 AND actual_fraud = 0 THEN 1 ELSE 0 END) AS false_positives,
    SUM(CASE WHEN predicted_review = 0 AND actual_fraud = 1 THEN 1 ELSE 0 END) AS false_negatives,
    SUM(CASE WHEN predicted_review = 0 AND actual_fraud = 0 THEN 1 ELSE 0 END) AS true_negatives
  FROM scored
  GROUP BY model_version, channel, merchant_category
)
SELECT
  model_version,
  channel,
  merchant_category,
  transactions,
  SAFE_DIVIDE(true_positives, true_positives + false_positives) AS precision,
  SAFE_DIVIDE(true_positives, true_positives + false_negatives) AS recall,
  SAFE_DIVIDE(false_positives, false_positives + true_negatives) AS false_positive_rate,
  SAFE_DIVIDE(false_negatives, transactions) AS missed_fraud_rate
FROM metrics
WHERE transactions >= 1000
ORDER BY missed_fraud_rate DESC;
```

Precision answers, "Of the transactions we sent to review, how many were truly fraud?" Recall answers, "Of the fraud transactions in this labelled window, how many did we catch?" scikit-learn documents these classification metrics and provides repeatable functions for Python metric jobs.

The same window can be computed in Python when the team wants metric artifacts, confidence intervals, or reports:

```python
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    precision_recall_fscore_support,
)


df = pd.read_parquet("s3://rivergate-fraud-monitoring/labelled_windows/confirmed_14d/")

y_true = df["fraud_confirmed"].astype(int)
y_score = df["score"].astype(float)
y_pred = (df["score"] >= df["threshold_review"]).astype(int)

precision, recall, f1, support = precision_recall_fscore_support(
    y_true,
    y_pred,
    average="binary",
    zero_division=0,
)

tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
avg_precision = average_precision_score(y_true, y_score)

quality_summary = {
    "precision": float(precision),
    "recall": float(recall),
    "f1": float(f1),
    "average_precision": float(avg_precision),
    "true_positives": int(tp),
    "false_positives": int(fp),
    "false_negatives": int(fn),
    "true_negatives": int(tn),
    "label_window": "confirmed_14d",
}
```

Average precision uses the score ranking rather than one threshold. That is useful for a queue classifier because RiverGate can only review a limited number of transactions. If average precision falls while the threshold metrics still look stable, the model may be losing ranking quality before the current threshold exposes the issue.

## Turn Metrics Into Dashboards And Alerts
<!-- section-summary: Alerts should encode product risk, segment scope, label maturity, and a clear owner. -->

Prediction quality metrics should feed dashboards, tickets, and sometimes pages. The threshold for alerting depends on product risk. RiverGate pages for confirmed fraud recall drops in high-value online transactions. It opens tickets for queue precision drops that create analyst workload.

The daily metric job can export gauges for Prometheus:

```python
from prometheus_client import Gauge, start_http_server


precision_gauge = Gauge(
    "fraud_classifier_precision_14d",
    "Precision for the confirmed 14-day fraud label window",
    ["model_version", "channel", "merchant_category"],
)

recall_gauge = Gauge(
    "fraud_classifier_recall_14d",
    "Recall for the confirmed 14-day fraud label window",
    ["model_version", "channel", "merchant_category"],
)

review_rate_gauge = Gauge(
    "fraud_classifier_review_rate_1h",
    "Fraction of transactions routed to manual review in the last hour",
    ["model_version", "channel"],
)

start_http_server(9108)

for row in metric_rows:
    labels = (row["model_version"], row["channel"], row["merchant_category"])
    precision_gauge.labels(*labels).set(row["precision"])
    recall_gauge.labels(*labels).set(row["recall"])
```

Prometheus gauges fit metrics that can go up and down, such as precision, recall, queue rate, and calibration error. Counters fit cumulative events, such as prediction count, review decisions, and label ingestion failures. Histograms fit distributions, such as score values, review latency, or label delay.

The alert rules should name the affected segment and label window:

```yaml
groups:
  - name: fraud-prediction-quality
    rules:
      - alert: FraudRecallBelowFloor
        expr: fraud_classifier_recall_14d{channel="card_not_present"} < 0.82
        for: 1h
        labels:
          severity: page
          owner: fraud-ml-oncall
        annotations:
          summary: Confirmed fraud recall is below the approved floor
          label_window: confirmed chargeback labels, 14-28 days old
          runbook: https://runbooks.rivergate.example/fraud-quality

      - alert: FraudReviewPrecisionDrop
        expr: fraud_classifier_precision_14d{channel="card_not_present"} < 0.38
        for: 2h
        labels:
          severity: ticket
          owner: fraud-ml-oncall
        annotations:
          summary: Fraud review queue precision is below target
          action: Check threshold changes, merchant category mix, and analyst labels
```

The recall alert uses a page because missed fraud can create direct financial loss. The precision alert uses a ticket because the team may need a threshold review, analyst workflow check, or segment analysis during business hours. Alert severity should follow the decision cost.

![RiverGate fraud quality slice dashboard](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-prediction-quality/rivergate-quality-slices.png)

*The slice dashboard ties precision, recall, threshold, and segment risk to the same model version.*

## Review Prediction Quality With Evidently
<!-- section-summary: Evidently classification reports can compare reference and current labelled windows so teams can inspect quality, drift, and segment behavior together. -->

Evidently can also help with labelled quality reviews. A model-quality report compares a reference labelled dataset with a current labelled dataset. For a fraud classifier, the reference might be the last approved model window, and the current window might be the latest matured chargeback window.

RiverGate prepares current and reference data with common columns:

```python
import pandas as pd
from evidently import Report
from evidently.presets import ClassificationPreset, DataDriftPreset


reference = pd.read_parquet("s3://rivergate-fraud-monitoring/reference/model_30_confirmed_14d.parquet")
current = pd.read_parquet("s3://rivergate-fraud-monitoring/current/model_31_confirmed_14d.parquet")

reference_report_data = reference.rename(
    columns={
        "fraud_confirmed": "target",
        "decision_review": "prediction",
    }
)

current_report_data = current.rename(
    columns={
        "fraud_confirmed": "target",
        "decision_review": "prediction",
    }
)

report = Report([
    ClassificationPreset(),
    DataDriftPreset(),
])

eval_result = report.run(
    current_data=current_report_data,
    reference_data=reference_report_data,
)

eval_result.save_html("fraud-quality-model-31.html")
```

The classification report helps reviewers look beyond one number. Precision and recall can move in opposite directions after a threshold change. Data drift can explain why quality moved. Segment tables can reveal whether the global metric hides one risky slice.

The report should be linked from the release or incident packet:

```yaml
quality_review:
  model_name: fraud_queue_classifier
  candidate_version: "31"
  reference_version: "30"
  label_window: confirmed_14d
  report_uri: s3://rivergate-fraud-monitoring/reports/model_31/fraud-quality-model-31.html
  decision: keep active, raise review threshold for low-amount electronics, retrain candidate with recent merchant data
```

This gives the team a clear path from metric to decision.

## Triage A Quality Drop
<!-- section-summary: Triage checks label health, traffic mix, threshold changes, data drift, model version, and product impact before picking a response. -->

When quality drops, the first response should gather evidence before changing the model. RiverGate uses a triage checklist:

| Step | Question | Evidence |
|---|---|---|
| 1 | Did label ingestion change? | Label count, label source mix, label delay, analyst queue export status |
| 2 | Did traffic mix change? | Merchant category, country, channel, amount band, card age |
| 3 | Did thresholds or policies change? | Policy config diff, feature flag history, release notes |
| 4 | Did input data drift? | Feature drift report, null rates, new categories |
| 5 | Did one model version cause the drop? | Metrics by model version, canary comparison, release time |
| 6 | What is the customer or financial impact? | Missed fraud amount, good-customer blocks, review queue overload |

![RiverGate prediction quality triage flow](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-prediction-quality/rivergate-quality-triage.png)

*The triage path checks labels, traffic mix, thresholds, drift, release timing, and product impact before changing the classifier.*

An incident note can keep the team aligned:

```yaml
incident:
  id: fraud-quality-2026-07-05
  model: fraud_queue_classifier
  model_version: "31"
  signal: recall_14d for card_not_present electronics dropped from 0.87 to 0.79
  label_window: confirmed chargebacks from 2026-06-07 through 2026-06-21
  strongest_segment:
    channel: card_not_present
    merchant_category: electronics
    card_age_days: "0-7"
  label_health: passed
  traffic_mix: new marketplace merchants increased 22 percent
  immediate_action: raise manual review priority for high-amount new-card electronics
  follow_up: retrain candidate with new merchant features and review threshold curve
```

The immediate action protects the workflow. The follow-up fixes the model or policy after the evidence is clearer. RiverGate may also roll back a model version if the drop aligns tightly with a release and the previous version has a known safe profile.

## Practical Checks, Common Mistakes, And Interview Understanding
<!-- section-summary: A production-quality answer explains labels, windows, metrics, thresholds, segments, and actions. -->

Use this checklist for prediction quality monitoring:

| Check | What good looks like |
|---|---|
| Store model and policy identity | Every prediction row includes model version, thresholds, and decision |
| Track label maturity | Dashboards state the label source and delay window |
| Use the right metric | Precision, recall, average precision, error, calibration, and cost fit the product decision |
| Segment the metrics | Metrics are broken down by channel, geography, amount band, customer type, and model version |
| Separate queue health from confirmed quality | Fast analyst labels and slow chargebacks have separate panels |
| Tie alerts to response | Threshold change, segment guardrail, rollback, retraining, or investigation has an owner |
| Preserve review evidence | SQL outputs, reports, configs, and incident notes link to the model version |

Common mistakes show up quickly. Teams report accuracy on imbalanced fraud data and miss recall collapse. They measure labels that are too fresh and create fake improvement. They track the model score while ignoring the threshold that changed the decision. They average every segment together and miss a high-risk merchant category. They alert on metrics without a runbook, so the on-call engineer has to invent the response under pressure.

In an interview, you can say:

> I would monitor prediction quality by joining prediction logs to mature labels. For a fraud classifier, I would log score, model version, threshold, decision, and segment keys, then compute precision, recall, false positives, false negatives, and average precision over label windows. I would separate fast analyst-review signals from slower chargeback-confirmed metrics, alert on product-risk thresholds, and triage label health, traffic mix, threshold changes, data drift, and release timing before changing the model.

That answer shows you understand the full production system. A model metric is only useful when it connects to labels, thresholds, product cost, and a response path.

## References

- [scikit-learn precision_recall_fscore_support](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.precision_recall_fscore_support.html)
- [scikit-learn average_precision_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.average_precision_score.html)
- [scikit-learn confusion_matrix](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.confusion_matrix.html)
- [Evidently Classification Preset](https://docs.evidentlyai.com/metrics/preset_classification)
- [Evidently Data Drift Preset](https://docs.evidentlyai.com/metrics/preset_data_drift)
- [Prometheus Python client instrumentation](https://prometheus.github.io/client_python/instrumenting/)
- [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
