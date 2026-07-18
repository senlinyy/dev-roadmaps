---
title: "Classification Metrics"
description: "Read classification metrics through confusion matrices, precision, recall, F1, ROC AUC, distinct AP and PR AUC calculations, calibration, thresholds, and segment reports."
overview: "Classification metrics explain how a model sorts examples into classes. A supporting example follows a marketplace fraud model through a confusion matrix, threshold table, scikit-learn report, calibration check, Evidently report, and release gate."
tags: ["MLOps", "core", "metrics"]
order: 2
id: "article-mlops-model-evaluation-classification-metrics"
---


## Classification Metrics Explain Which Mistakes The Model Makes
<!-- section-summary: Classification metrics measure how well a model assigns examples to classes and which mistake patterns matter in the product. -->

A **classification model** predicts a category. The category might be `fraud` or `legit`, `urgent` or `normal`, `cancel` or `stay`, `spam` or `safe`, `approved` or `needs_review`. Classification metrics measure how those predicted categories compare with the true labels.

The title answer is direct: **classification metrics help you count correct labels, missed positives, false alarms, class-level quality, ranking quality, and probability quality so you can choose a release threshold with evidence**. The metric names matter less than the question they answer.

In the previous article, you saw that metric choice starts with the product cost of a mistake. This article zooms into the classification toolkit. You will read a confusion matrix, compute precision and recall, compare thresholds, inspect ROC AUC and average precision, check calibration, and build a report that a release reviewer can understand.

## A Supporting Example: Fraud Review
<!-- section-summary: A supporting example uses a marketplace fraud model where false declines and missed fraud both cost money. -->

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

Before choosing a threshold, it helps to know whether the model ranks risky payouts above safe payouts. **ROC AUC** measures how well positive cases tend to score above negative cases across thresholds. A **precision-recall curve** plots precision against recall as the threshold changes, which makes it especially useful when fraud is rare.

Two summaries of that curve often receive the same informal name, **PR AUC**, even though they use different calculations. Scikit-learn's `average_precision_score` computes **average precision (AP)** as a weighted sum of precision values, where each weight is the increase in recall. `auc(recall, precision)` applies trapezoidal interpolation to the plotted points. That interpolation can give a different and sometimes more optimistic result. MarketLane records the exact metric name and implementation as `average_precision_sklearn` so a future report cannot silently compare AP with trapezoidal PR AUC.

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

MLflow can evaluate a static table of labels and predictions with its classic evaluation API. Evidently can read the same scored table, calculate a visual classification report, and return explicit pass or fail tests. Evidently 0.7 uses a `Dataset` with a `DataDefinition`; the definition prevents the library from guessing which column is the label and which column is the probability.

The threshold must have one owner. A registered classifier's `predict()` method may use `0.5` or another built-in cutoff, while this release decision uses `0.62`. Calling the model through MLflow and passing the probability table to Evidently would therefore evaluate different decisions. MarketLane computes `predicted_label` once from `risk_score >= 0.62`, passes that static label column to MLflow, and passes the probability column plus the same threshold to Evidently.

MarketLane pins MLflow `3.14.0` and Evidently `0.7.21` in the evaluation image. `BinaryClassification` maps the true label to `is_fraud` and the positive-class probability to `risk_score`. The scored-table artifact also carries the model URI, scoring image digest, dataset ID, and threshold so a reviewer can trace how those probabilities were produced:

```python
import json
from importlib.metadata import version

import mlflow
from evidently import BinaryClassification, DataDefinition, Dataset, Report
from evidently.metrics import Precision, Recall
from evidently.presets import ClassificationPreset
from evidently.tests import gte

DECISION_THRESHOLD = 0.62
scored_eval = eval_df.copy()
scored_eval["predicted_label"] = (
    scored_eval["risk_score"] >= DECISION_THRESHOLD
).astype("int8")
eval_data = scored_eval[["is_fraud", "predicted_label"]].copy()
definition = DataDefinition(
    classification=[BinaryClassification(
        target="is_fraud",
        prediction_probas="risk_score",
        pos_label=1,
    )],
    categorical_columns=["is_fraud"],
    numerical_columns=["risk_score"],
)
current_dataset = Dataset.from_pandas(
    scored_eval,
    data_definition=definition,
)
reference_dataset = Dataset.from_pandas(
    prod_eval_df,
    data_definition=definition,
)

with mlflow.start_run(run_name="payout-risk-v19-evaluation"):
    mlflow.set_tags({
        "candidate_model_uri": "models:/marketlane-payout-risk/19",
        "scoring_image_digest": "sha256:8b25d4f09f61...",
        "evaluation_dataset": "payout_fraud_holdout_2026_06",
        "decision_threshold": str(DECISION_THRESHOLD),
    })
    result = mlflow.models.evaluate(
        data=eval_data,
        predictions="predicted_label",
        targets="is_fraud",
        model_type="classifier",
        evaluator_config={"pos_label": 1},
    )
    mlflow_threshold_metrics = {
        "recall_score": float(result.metrics["recall_score"]),
        "precision_score": float(result.metrics["precision_score"]),
    }
    mlflow.log_dict(
        mlflow_threshold_metrics,
        "metrics/mlflow_threshold_metrics.json",
    )

    evidently_report = Report([
        ClassificationPreset(probas_threshold=DECISION_THRESHOLD),
        Recall(probas_threshold=DECISION_THRESHOLD, tests=[gte(0.68)]),
        Precision(probas_threshold=DECISION_THRESHOLD, tests=[gte(0.39)]),
    ])
    snapshot = evidently_report.run(
        current_data=current_dataset,
        reference_data=reference_dataset,
    )
    payload = json.loads(snapshot.json())
    failures = [
        test["name"]
        for test in payload["tests"]
        if test["status"] in {"FAIL", "ERROR"}
    ]
    metric_key_map = {
        "Recall": "recall_score",
        "Precision": "precision_score",
    }
    evidently_threshold_metrics = {}
    for metric in payload["metrics"]:
        metric_type = metric["config"]["type"].rsplit(":", 1)[-1]
        if metric["config"].get("tests") and metric_type in metric_key_map:
            evidently_threshold_metrics[metric_key_map[metric_type]] = float(
                metric["value"]
            )
    for metric_name, mlflow_value in mlflow_threshold_metrics.items():
        evidently_value = evidently_threshold_metrics[metric_name]
        if abs(mlflow_value - evidently_value) > 1e-12:
            raise RuntimeError(
                f"threshold metric mismatch for {metric_name}: "
                f"MLflow={mlflow_value}, Evidently={evidently_value}"
            )
    if version("mlflow") != "3.14.0":
        raise RuntimeError("evaluation image must pin mlflow==3.14.0")
    if version("evidently") != "0.7.21":
        raise RuntimeError("evaluation image must pin evidently==0.7.21")
    mlflow.log_dict(
        payload,
        "metrics/evidently_classification_snapshot.json",
    )
    if failures:
        raise RuntimeError(f"Evidently classification gate failed: {failures}")
    print({
        "mlflow": version("mlflow"),
        "evidently": version("evidently"),
        "threshold": DECISION_THRESHOLD,
        "threshold_metrics": {
            name: round(value, 3)
            for name, value in mlflow_threshold_metrics.items()
        },
        "evidently_tests": [
            (test["name"], test["status"])
            for test in payload["tests"]
        ],
    })
```

The static MLflow call receives `predictions="predicted_label"`, so it never invokes a model-native class threshold. Evidently receives `risk_score` and the same `DECISION_THRESHOLD`. The equality loop turns alignment into a test: both libraries must return identical recall and precision before release validation continues. A passing run for the article's confusion matrix prints output in this shape:

```console
{'mlflow': '3.14.0', 'evidently': '0.7.21', 'threshold': 0.62, 'threshold_metrics': {'recall_score': 0.7, 'precision_score': 0.405}, 'evidently_tests': [('Recall metric: Greater or Equal 0.680', 'SUCCESS'), ('Precision metric: Greater or Equal 0.390', 'SUCCESS')]}
```

Changing 71 true-fraud rows from scores above `0.62` to scores below it changes `predicted_label` for both tools and reduces recall from `2450 / 3500 = 0.700` to `2379 / 3500 = 0.6797`. That falls below the `0.68` gate, makes the recall test return `FAIL`, and causes the job to raise `Evidently classification gate failed`. Altering the MLflow label column without changing the Evidently probability table triggers `threshold metric mismatch`, which proves the alignment check catches split decision paths. The report JSON remains useful evidence, so production code writes it to a failure-artifact path before raising. A missing `risk_score` or `is_fraud` column makes report execution fail, which blocks release before a report with guessed roles can be logged.

Current MLflow documentation separates evaluation from threshold validation. Since MLflow 2.18, model validation uses `mlflow.validate_evaluation_results()` rather than an argument on `mlflow.models.evaluate()`. The release job can validate headline metrics there, then run the product-specific segment gate from its own versioned rules:

```python
from mlflow.models import MetricThreshold

mlflow.validate_evaluation_results(
    candidate_result=result,
    validation_thresholds={
        "recall_score": MetricThreshold(threshold=0.68, greater_is_better=True),
        "precision_score": MetricThreshold(threshold=0.39, greater_is_better=True),
    },
)

failed_segments = segment_metrics.query(
    "support >= 500 and fraud_recall < recall_floor"
)
if not failed_segments.empty:
    failed_segments.to_csv("blocked_examples_segments.csv", index=False)
    raise RuntimeError(
        f"segment release gate failed: {failed_segments.segment.tolist()}"
    )
```

MLflow validation and Evidently now check the same threshold decision over the same rows. Their threshold-based recall and precision must agree exactly; the versioned probability table still supplies ranking and calibration metrics that class labels cannot provide. The separate segment rule preserves product-specific floors and support requirements. For the article's numbers, the overall checks pass and `refurbished_laptops` fails. The expected pipeline result is a blocked candidate with the segment table and example IDs attached, rather than a green run with a warning inside one chart.

Test the gate with a fixture confusion matrix whose counts give known precision and recall, then add one failed segment below its floor. This verifies both the metric direction and the release decision. A missing `segment_metrics` artifact must also fail because absence of subgroup evidence cannot produce approval.

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
- [scikit-learn: average_precision_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.average_precision_score.html) - Official API reference explaining why AP differs from trapezoidal area under a precision-recall curve.
- [scikit-learn: Probability calibration](https://scikit-learn.org/stable/modules/calibration.html) - Official guide to reliability diagrams and calibrated probabilities.
- [MLflow Model Evaluation](https://mlflow.org/docs/latest/ml/evaluation/) - Official guide to classic evaluation and current `mlflow.validate_evaluation_results()` validation.
- [Evidently Data Definition](https://docs.evidentlyai.com/docs/library/data_definition) - Current `Dataset`, `DataDefinition`, and `BinaryClassification` column-role mapping.
- [Evidently Tests](https://docs.evidentlyai.com/docs/library/tests) - Current custom `gte` and `lte` conditions and test status behavior.
- [Evidently Classification Preset](https://docs.evidentlyai.com/metrics/preset_classification) - Official Evidently documentation for classification metrics, plots, and tests.
