---
title: "Classification Metrics"
description: "Read classification metrics through confusion matrices, precision, recall, F1, ROC AUC, PR AUC, calibration, thresholds, and segment reports."
overview: "Classification metrics explain how a model sorts examples into classes. This tutorial follows a marketplace fraud model through a confusion matrix, threshold table, scikit-learn report, calibration check, Evidently report, and release gate."
tags: ["MLOps", "core", "metrics"]
order: 2
id: "article-mlops-model-evaluation-classification-metrics"
---

## Table of Contents

1. [Classification Metrics Explain Which Mistakes The Model Makes](#classification-metrics-explain-which-mistakes-the-model-makes)
2. [Follow One Fraud Review](#follow-one-fraud-review)
3. [Start With The Confusion Matrix](#start-with-the-confusion-matrix)
4. [Precision, Recall, And F1](#precision-recall-and-f1)
5. [Ranking Metrics And Threshold Tables](#ranking-metrics-and-threshold-tables)
6. [Calibration And Segment Reports](#calibration-and-segment-reports)
7. [Automate The Report](#automate-the-report)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Classification Metrics Explain Which Mistakes The Model Makes
<!-- section-summary: Classification metrics measure how well a model assigns examples to classes and which mistake patterns matter in the product. -->

A **classification model** predicts a category. The category might be `fraud` or `legit`, `urgent` or `normal`, `cancel` or `stay`, `spam` or `safe`, `approved` or `needs_review`. Classification metrics measure how those predicted categories compare with the true labels.

The title answer is direct: **classification metrics help you count correct labels, missed positives, false alarms, class-level quality, ranking quality, and probability quality so you can choose a release threshold with evidence**. The metric names matter less than the question they answer.

In the previous article, you saw that metric choice starts with the product cost of a mistake. This article zooms into the classification toolkit. You will read a confusion matrix, compute precision and recall, compare thresholds, inspect ROC AUC and average precision, check calibration, and build a report that a release reviewer can understand.

## Follow One Fraud Review
<!-- section-summary: The running scenario uses a marketplace fraud model where false declines and missed fraud both cost money. -->

Imagine **MarketLane**, a marketplace for secondhand electronics. A fraud model scores each seller payout request. When the score crosses a threshold, the payout is held for manual review. When the score stays below the threshold, the payout proceeds automatically.

The evaluation set is `payout_fraud_holdout_2026_06`. It has 80,000 payout requests and a delayed fraud label from chargebacks, buyer disputes, and trust-and-safety investigations. The positive class is `fraud`. That definition matters because every metric with "positive" in the name refers to fraud cases.

The team evaluates two versions:

| Model | Description |
|---|---|
| `payout-risk:v18` | Current production model |
| `payout-risk:v19-candidate` | New model with device velocity, seller tenure, and listing-category features |

MarketLane wants fewer missed fraud payouts, while keeping manual review volume inside the team capacity of 9,000 cases per month. That means the metric conversation needs both fraud catch rate and reviewer load.

## Start With The Confusion Matrix
<!-- section-summary: A confusion matrix counts true positives, false positives, true negatives, and false negatives at one threshold. -->

A **confusion matrix** is the first table to inspect because it shows the raw counts behind the metric names. For a binary fraud model, the rows are true labels and the columns are predicted labels.

At threshold `0.62`, the candidate creates this confusion matrix:

| Actual / Predicted | Predicted legit | Predicted fraud |
|---|---:|---:|
| Actual legit | 72,900 | 3,600 |
| Actual fraud | 1,050 | 2,450 |

The four cells have plain meanings:

| Cell | Count | Meaning for MarketLane |
|---|---:|---|
| True negative | 72,900 | Legit payout moved automatically |
| False positive | 3,600 | Legit payout held for review |
| False negative | 1,050 | Fraud payout slipped through |
| True positive | 2,450 | Fraud payout held for review |

![MarketLane fraud confusion matrix](/content-assets/articles/article-mlops-model-evaluation-classification-metrics/confusion-matrix.png)
*The confusion matrix keeps the fraud review grounded in counts, so reviewers can see how many payouts were paid, held, missed, or correctly stopped.*

The matrix shows the real tradeoff. The candidate catches 2,450 fraud payouts and misses 1,050. It also sends 3,600 legit payouts into review. A product owner can understand those counts faster than a wall of percentages.

You can compute the matrix with scikit-learn:

```python
from sklearn.metrics import ConfusionMatrixDisplay, confusion_matrix

y_true = eval_df["is_fraud"].to_numpy()
y_pred = eval_df["risk_score"].to_numpy() >= 0.62

matrix = confusion_matrix(y_true, y_pred, labels=[0, 1])
print(matrix)

display = ConfusionMatrixDisplay(
    confusion_matrix=matrix,
    display_labels=["legit", "fraud"],
)
display.plot(values_format="d")
```

The `labels=[0, 1]` line keeps the row and column order stable. That small habit avoids embarrassing review mistakes where the team reads the positive class backward.

## Precision, Recall, And F1
<!-- section-summary: Precision measures alert quality, recall measures caught positives, and F1 summarizes both when the tradeoff is balanced enough. -->

**Recall** tells MarketLane how many true fraud payouts the model catches. In the matrix above, recall is `2,450 / (2,450 + 1,050) = 0.70`. If fraud loss is the biggest concern, recall gets close attention.

**Precision** tells MarketLane how many held payouts are truly fraud. In the same matrix, precision is `2,450 / (2,450 + 3,600) = 0.40`. If reviewer capacity and seller experience are the biggest concern, precision gets close attention.

**F1** combines precision and recall into one score. It can help compare models when the team cares about both false positives and false negatives. It should not replace the confusion matrix, because two models can have similar F1 scores and very different review volumes.

A scikit-learn classification report gives the common numbers in one table:

```python
from sklearn.metrics import classification_report

print(
    classification_report(
        y_true,
        y_pred,
        target_names=["legit", "fraud"],
        digits=3,
        zero_division=0,
    )
)
```

Example output:

```bash
              precision    recall  f1-score   support

       legit      0.986     0.953     0.969     76500
       fraud      0.405     0.700     0.513      3500

    accuracy                          0.942     80000
   macro avg      0.695     0.826     0.741     80000
weighted avg      0.960     0.942     0.949     80000
```

Accuracy is high because most payouts are legit. The fraud row gives the useful product story: the candidate catches 70% of labeled fraud at 40.5% precision. The `support` column shows how many examples each row used, which helps reviewers notice class imbalance.

## Ranking Metrics And Threshold Tables
<!-- section-summary: ROC AUC and average precision inspect ranking across thresholds, while threshold tables choose the actual operating point. -->

Before choosing a threshold, it helps to know whether the model ranks risky payouts above safe payouts. **ROC AUC** measures how well positive cases tend to score above negative cases across thresholds. **Average precision** summarizes the precision-recall curve and is often more informative when the positive class is rare.

For MarketLane, the candidate has stronger ranking metrics than production:

| Metric | Production `v18` | Candidate `v19` |
|---|---:|---:|
| ROC AUC | 0.931 | 0.948 |
| Average precision | 0.428 | 0.497 |
| Brier score | 0.037 | 0.034 |

These numbers say the candidate ranks fraud better overall. They do not choose the payout review threshold. The threshold table does that:

| Threshold | Fraud recall | Precision | Held payouts | Estimated fraud loss missed | Review capacity |
|---:|---:|---:|---:|---:|---|
| 0.45 | 0.82 | 0.29 | 9,890 | $221,000 | Over monthly capacity |
| 0.55 | 0.75 | 0.35 | 7,520 | $304,000 | Fits surge plan |
| 0.62 | 0.70 | 0.40 | 6,050 | $366,000 | Fits normal staffing |
| 0.70 | 0.61 | 0.49 | 4,360 | $511,000 | Too many misses |

![MarketLane ranking and threshold tradeoff](/content-assets/articles/article-mlops-model-evaluation-classification-metrics/ranking-thresholds.png)
*The ranking metrics say the candidate sorts risky payouts better, while the threshold markers show the staffing decision the team still has to make.*

The release discussion can now focus on a real operating choice. Threshold `0.55` catches more fraud and fits a surge month. Threshold `0.62` catches fewer cases and fits normal staffing. A mature rollout can start at `0.62`, monitor reviewer queues, and lower to `0.55` for known fraud waves if operations approves.

## Calibration And Segment Reports
<!-- section-summary: Calibration checks score reliability, and segments reveal where aggregate classification metrics hide weak behavior. -->

Fraud reviewers may use scores to sort queues, so probability quality matters. **Calibration** asks whether a score of `0.70` behaves like roughly 70% fraud among similar scored examples. A model can rank cases well while overstating or understating the actual probability.

MarketLane bins candidate scores:

| Score bin | Payouts | Average score | Fraud rate |
|---|---:|---:|---:|
| 0.00-0.20 | 61,400 | 0.04 | 0.03 |
| 0.20-0.40 | 9,600 | 0.29 | 0.18 |
| 0.40-0.60 | 4,700 | 0.49 | 0.33 |
| 0.60-0.80 | 2,900 | 0.69 | 0.57 |
| 0.80-1.00 | 1,400 | 0.88 | 0.82 |

The candidate overstates fraud risk in the middle bins. The team can still use the score for ranking and thresholding, yet the review UI should avoid exact probability language until calibration improves.

Segments complete the classification review:

| Segment | Fraud recall | Precision | Held payouts | Gate |
|---|---:|---:|---:|---|
| All payouts | 0.70 | 0.405 | 6,050 | Pass |
| New sellers | 0.76 | 0.382 | 2,140 | Pass |
| Established sellers | 0.64 | 0.431 | 3,910 | Review |
| High-value phones | 0.81 | 0.448 | 1,220 | Pass |
| Refurbished laptops | 0.52 | 0.332 | 810 | Block |

The laptop segment blocks the release because fraud recall is far below the approved minimum. The team should inspect labels, features, and examples from that category before rollout.

## Automate The Report
<!-- section-summary: A repeatable classification report should save metrics, plots, segments, thresholds, and pass/fail gates as release artifacts. -->

The report should run from the same repository each time. It should write a JSON file for gates, a human-readable markdown or HTML report for reviewers, and artifacts such as confusion matrices and calibration plots.

MLflow can evaluate a logged model with classic evaluation APIs, and Evidently can create classification reports and test suites for deeper inspection:

```python
import mlflow
from evidently import Report
from evidently.presets import ClassificationPreset

eval_data = eval_df[feature_columns + ["is_fraud"]].copy()

with mlflow.start_run(run_name="payout-risk-v19-evaluation"):
    result = mlflow.models.evaluate(
        model="models:/marketlane-payout-risk/19",
        data=eval_data,
        targets="is_fraud",
        model_type="classifier",
    )
    mlflow.log_dict(result.metrics, "metrics/mlflow_evaluation_metrics.json")

    evidently_report = Report([ClassificationPreset()], include_tests=True)
    snapshot = evidently_report.run(current_data=eval_df, reference_data=prod_eval_df)
    mlflow.log_dict(snapshot.dict(), "metrics/evidently_classification_snapshot.json")
```

The exact report structure should match the team's tooling, but the evidence list should stay stable:

| Artifact | What reviewers use it for |
|---|---|
| `confusion_matrix.png` | Raw mistake counts at the chosen threshold |
| `threshold_table.csv` | Recall, precision, and review load by threshold |
| `classification_report.json` | Precision, recall, F1, support by class |
| `calibration_bins.csv` | Score reliability by probability band |
| `segment_metrics.csv` | Release gates by seller and listing segment |
| `blocked_examples.csv` | Examples behind failed segment gates |

![MarketLane classification report artifacts](/content-assets/articles/article-mlops-model-evaluation-classification-metrics/report-artifacts.png)
*The report packet keeps MLflow metrics, Evidently checks, threshold tables, and blocked examples together so every reviewer uses the same evidence.*

That artifact set gives trust-and-safety, operations, and ML platform reviewers the same facts.

## Putting It Together
<!-- section-summary: Classification evaluation works when raw counts, threshold tradeoffs, ranking metrics, calibration, and segment gates agree with the release decision. -->

Classification metrics explain which categories the model gets right and wrong. Start with the confusion matrix, then read precision, recall, F1, support, ranking metrics, calibration, and segment reports in the context of the product workflow.

For MarketLane, the candidate ranks fraud better than production and offers a workable threshold. The release still pauses because refurbished laptop payouts fail the segment gate. That is a healthy outcome. The metrics did their job because they found a specific risk before the model changed real payout behavior.

## References

- [scikit-learn: Metrics and scoring](https://scikit-learn.org/stable/modules/model_evaluation.html) - Official guide to classification metrics and scoring.
- [scikit-learn: classification_report](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.classification_report.html) - Official API reference for precision, recall, F1, and support output.
- [scikit-learn: average_precision_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.average_precision_score.html) - Official API reference for average precision over a precision-recall curve.
- [scikit-learn: Probability calibration](https://scikit-learn.org/stable/modules/calibration.html) - Official guide to reliability diagrams and calibrated probabilities.
- [MLflow Model Evaluation](https://mlflow.org/docs/latest/ml/evaluation/) - Official guide to classic `mlflow.models.evaluate()` for classification and regression.
- [Evidently Classification Preset](https://docs.evidentlyai.com/metrics/preset_classification) - Official Evidently documentation for classification metrics, plots, and tests.
