---
title: "Regression Metrics"
description: "Evaluate regression models with MAE, RMSE, MAPE, residuals, prediction intervals, segment checks, and release gates."
overview: "Regression metrics measure how far numeric predictions miss. This tutorial follows a delivery ETA team as they compare MAE, RMSE, MAPE, residual tables, tail-error gates, segment reports, and Evidently regression checks."
tags: ["MLOps", "core", "metrics"]
order: 3
id: "article-mlops-model-evaluation-regression-metrics"
---

## Table of Contents

1. [Regression Metrics Measure Numeric Error](#regression-metrics-measure-numeric-error)
2. [Follow One Delivery ETA Review](#follow-one-delivery-eta-review)
3. [MAE, RMSE, And Business Units](#mae-rmse-and-business-units)
4. [Percentage Error And Bias](#percentage-error-and-bias)
5. [Residuals, Tails, And Segments](#residuals-tails-and-segments)
6. [Build The Evaluation Job](#build-the-evaluation-job)
7. [Write Release Gates For Numeric Models](#write-release-gates-for-numeric-models)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Regression Metrics Measure Numeric Error
<!-- section-summary: Regression metrics compare numeric predictions with numeric labels and explain the size, direction, and concentration of error. -->

A **regression model** predicts a number. The number might be delivery minutes, demand units, claim cost, machine temperature, customer lifetime value, or house price. Regression metrics measure how far those predicted numbers are from the true numbers.

The title answer is straightforward: **regression metrics help you measure numeric error in the same units as the product, then decide whether the average error, large misses, percent misses, bias, and segment behavior are acceptable for release**. A single overall score rarely tells the full story.

The previous article covered classification, where the model chooses a class and the team counts false positives and false negatives. Regression has a different shape. A prediction can miss by 1 minute, 10 minutes, or 60 minutes. The size and direction of the miss matter.

This article follows a delivery ETA model. You will compare MAE, RMSE, MAPE, residuals, tail errors, segment reports, Evidently regression checks, and a release gate that product and operations teams can understand.

## Follow One Delivery ETA Review
<!-- section-summary: The running scenario uses a delivery ETA model where average error, late-order tails, and segment misses all affect customers. -->

Imagine **QuickBite**, a food delivery company. The app shows customers an estimated arrival time before checkout and keeps updating the ETA during delivery. The current model is `eta-minutes:v31`. A candidate model, `eta-minutes:v32`, adds restaurant prep-delay signals, courier supply features, and weather alerts.

The evaluation dataset is `eta_holdout_2026_06_weekends`. It has 210,000 completed deliveries from weekend dinner windows. The label is `actual_minutes_to_door`, measured from order confirmation to doorstep delivery. The prediction is `predicted_minutes_to_door`.

The table has these fields:

| Field | Example | Why it matters |
|---|---|---|
| `order_id` | `ord_981377` | Trace one prediction to app logs |
| `market` | `austin` | Checks local traffic and supply behavior |
| `restaurant_type` | `pizza` | Prep-time patterns differ by cuisine |
| `weather_bucket` | `heavy_rain` | Weather creates delay tails |
| `distance_miles` | `4.8` | Distance affects baseline difficulty |
| `predicted_minutes_to_door` | `38.2` | Model output |
| `actual_minutes_to_door` | `46.0` | Ground truth |

QuickBite cares about more than average error. A customer gets annoyed when a promised 25-minute order takes 50 minutes. A courier operations lead cares when the model repeatedly underestimates rainy Friday nights. A finance analyst cares if a changed ETA hurts conversion. The regression report needs numbers that match these concerns.

## MAE, RMSE, And Business Units
<!-- section-summary: MAE gives average miss in product units, while RMSE gives larger misses more weight. -->

**Mean absolute error**, or **MAE**, is the average absolute miss. If the ETA says 38 minutes and the order arrives in 46 minutes, the absolute error is 8 minutes. MAE keeps the unit readable: minutes.

**Root mean squared error**, or **RMSE**, also returns minutes, but it gives large misses more weight. A handful of 40-minute misses can move RMSE a lot. That makes RMSE useful when large misses are especially painful.

QuickBite compares production and candidate:

| Metric | Production `v31` | Candidate `v32` | Direction |
|---|---:|---:|---|
| MAE | 6.8 minutes | 6.1 minutes | Candidate improves average miss |
| RMSE | 10.9 minutes | 10.4 minutes | Candidate improves large misses slightly |
| p90 absolute error | 15.7 minutes | 14.9 minutes | Candidate improves tail somewhat |
| p95 absolute error | 22.8 minutes | 23.6 minutes | Candidate worsens worst common tail |

![QuickBite ETA error metrics](/content-assets/articles/article-mlops-model-evaluation-regression-metrics/eta-error-metrics.png)
*The ETA panel keeps the metrics in product units: the customer feels the eight-minute miss, while MAE, RMSE, and p95 summarize the pattern across many orders.*

This is already a useful lesson. The candidate improves MAE and RMSE, yet p95 error gets worse. If QuickBite only looked at MAE, the candidate would look ready. The p95 gate tells the team that some late orders may be getting worse.

Here is a small scikit-learn metric script:

```python
from sklearn.metrics import mean_absolute_error, root_mean_squared_error, r2_score

y_true = eval_df["actual_minutes_to_door"]
y_pred = eval_df["predicted_minutes_to_door"]
abs_error = (y_true - y_pred).abs()

metrics = {
    "mae_minutes": mean_absolute_error(y_true, y_pred),
    "rmse_minutes": root_mean_squared_error(y_true, y_pred),
    "p90_abs_error_minutes": abs_error.quantile(0.90),
    "p95_abs_error_minutes": abs_error.quantile(0.95),
    "r2": r2_score(y_true, y_pred),
}
```

The code logs both average and tail metrics. `r2` can help compare statistical fit, but product reviewers usually understand MAE, RMSE, and percentiles faster because they stay close to customer minutes.

## Percentage Error And Bias
<!-- section-summary: Percentage error helps compare different scales, and bias shows whether predictions usually run high or low. -->

**Percentage error** compares the miss with the actual value. If a 10-minute pickup estimate misses by 5 minutes, that is a 50% miss. If a 90-minute catering order misses by 5 minutes, that is a much smaller product problem. Percentage metrics help when the target value has very different sizes.

For delivery ETAs, percentage error can be noisy for very short orders. A two-minute difference on a four-minute pickup creates a huge percentage. QuickBite therefore reports MAPE only for deliveries above 15 minutes and keeps MAE as the primary metric.

The team also checks **bias**, which is the average signed error. Signed error uses `prediction - actual`. A negative value means the model usually promises earlier delivery than reality. That is dangerous because customers experience it as lateness.

| Slice | MAE | MAPE for orders over 15 min | Mean signed error |
|---|---:|---:|---:|
| All deliveries | 6.1 min | 18.4% | -1.7 min |
| Clear weather | 5.4 min | 16.0% | -0.8 min |
| Heavy rain | 9.8 min | 26.5% | -5.9 min |
| Distance over 5 miles | 10.7 min | 21.2% | -4.6 min |

This table points to the real issue. The candidate underestimates rainy and long-distance orders. The app may show customers a confident ETA that the operation cannot meet. The fix may involve features, training data, or a product rule that widens ETA ranges during heavy rain.

## Residuals, Tails, And Segments
<!-- section-summary: Residual analysis shows where errors concentrate and which groups need release gates. -->

A **residual** is `actual - predicted`. Positive residuals mean the real delivery took longer than predicted. Negative residuals mean the delivery arrived earlier than predicted. Residuals help reviewers see patterns that one metric hides.

QuickBite creates a segment report:

| Segment | Orders | MAE | p95 absolute error | Mean residual | Gate |
|---|---:|---:|---:|---:|---|
| All orders | 210,000 | 6.1 | 23.6 | 1.7 | Review |
| Austin | 41,000 | 5.8 | 21.4 | 1.1 | Pass |
| Boston | 35,000 | 6.6 | 26.9 | 2.5 | Review |
| Heavy rain | 12,800 | 9.8 | 37.2 | 5.9 | Block |
| Pizza | 28,500 | 7.5 | 29.4 | 3.8 | Review |
| Distance over 5 miles | 19,300 | 10.7 | 41.0 | 4.6 | Block |

![QuickBite residual segment gates](/content-assets/articles/article-mlops-model-evaluation-regression-metrics/residual-segment-gates.png)
*Residuals show where the ETA model under-promises delivery time, and the segment gates highlight the heavy-rain and long-distance slices that block full rollout.*

The candidate cannot ship to all traffic because heavy rain and long-distance orders fail the p95 gate. The team can still consider a scoped rollout to clear-weather markets, yet the model needs a mitigation before full release.

The segment report should include enough support to avoid overreacting to tiny slices. A segment with 23 examples can start an investigation, but it should not carry the same release weight as a segment with 12,800 orders.

Warehouse SQL can generate the same report for every candidate:

```sql
SELECT
  segment_name,
  COUNT(*) AS orders,
  AVG(ABS(actual_minutes_to_door - predicted_minutes_to_door)) AS mae_minutes,
  APPROX_QUANTILES(ABS(actual_minutes_to_door - predicted_minutes_to_door), 100)[OFFSET(95)] AS p95_abs_error_minutes,
  AVG(actual_minutes_to_door - predicted_minutes_to_door) AS mean_residual_minutes
FROM ml_eval.eta_predictions
WHERE model_version = 'eta-minutes:v32'
  AND eval_dataset = 'eta_holdout_2026_06_weekends'
GROUP BY segment_name
ORDER BY p95_abs_error_minutes DESC;
```

This query is useful because operations managers often trust warehouse reports more than notebook screenshots. It also lets dashboards track evaluation results across model versions.

## Build The Evaluation Job
<!-- section-summary: A regression evaluation job should log metrics, residual artifacts, segment tables, and comparison reports in a repeatable way. -->

Regression evaluation should run as a job, not as an untracked notebook. The job loads the holdout dataset, scores the candidate, computes metrics, writes segment artifacts, and stores the report beside the model run.

MLflow can log model evaluation metrics, and Evidently can produce regression quality reports with plots such as actual versus predicted and error distributions:

```python
import mlflow
from evidently import Report
from evidently.presets import RegressionPreset

feature_frame = eval_df[feature_columns + ["actual_minutes_to_door"]]

with mlflow.start_run(run_name="eta-minutes-v32-evaluation"):
    result = mlflow.models.evaluate(
        model="models:/quickbite-eta-minutes/32",
        data=feature_frame,
        targets="actual_minutes_to_door",
        model_type="regressor",
    )
    mlflow.log_dict(result.metrics, "metrics/mlflow_regression_metrics.json")

    report = Report([RegressionPreset()], include_tests=True)
    snapshot = report.run(current_data=eval_df, reference_data=prod_eval_df)
    mlflow.log_dict(snapshot.dict(), "metrics/evidently_regression_snapshot.json")

    segment_table.to_csv("segment_metrics.csv", index=False)
    mlflow.log_artifact("segment_metrics.csv", artifact_path="evaluation")
```

The job should fail when required columns are missing, when the holdout dataset version is missing, or when the candidate produces null predictions. A bad evaluation job should block the model before reviewers waste time reading unreliable numbers.

## Write Release Gates For Numeric Models
<!-- section-summary: Regression release gates should combine average error, tail error, bias, segment floors, and rollback actions. -->

A regression model release gate should describe what level of error the product accepts. The gate should include average error, large misses, bias, segment checks, and any scope limits for rollout.

QuickBite writes this gate:

```yaml
regression_release_gate:
  model: eta-minutes
  candidate: v32
  baseline: v31
  evaluation_dataset: eta_holdout_2026_06_weekends
  primary:
    mae_minutes:
      max: 6.3
      must_improve_over_baseline: true
  guardrails:
    rmse_minutes:
      max: 10.8
    p95_abs_error_minutes:
      max: 23.0
    mean_residual_minutes:
      min: -1.0
      max: 2.0
  segments:
    - name: heavy_rain
      mae_minutes_max: 8.5
      p95_abs_error_minutes_max: 30.0
    - name: distance_over_5_miles
      mae_minutes_max: 9.0
      p95_abs_error_minutes_max: 32.0
  release_decision:
    if_failed: hold_full_rollout
    allowed_scope: clear_weather_orders_under_5_miles
    rollback_alias: eta-minutes@production
```

![QuickBite regression evaluation release packet](/content-assets/articles/article-mlops-model-evaluation-regression-metrics/regression-release-packet.png)
*The release packet connects the holdout data, MLflow metrics, Evidently report, segment table, and gate decision into one repeatable review artifact.*

This gate says the candidate can help some traffic while still failing full release. That is a practical MLOps decision. The release owner can ship a scoped route, collect fresh labels, and keep production protected for risky segments.

## Putting It Together
<!-- section-summary: Regression evaluation works when the team reads average error, large misses, bias, and segment behavior in product units. -->

Regression metrics measure how far numeric predictions miss. MAE gives an average miss in familiar units. RMSE gives larger misses more weight. Percentage error helps when target sizes vary. Residuals show direction. Tail metrics and segment reports show where the worst product pain lives.

For QuickBite, the candidate improves average ETA error, yet heavy-rain and long-distance orders fail the release gate. The right decision is a scoped rollout or another training cycle, not a blind full release. The metric report helps because it tells the team which customers benefit and which customers still need protection.

## References

- [scikit-learn: Regression metrics](https://scikit-learn.org/stable/modules/model_evaluation.html#regression-metrics) - Official guide to regression scoring functions.
- [scikit-learn: mean_absolute_error](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.mean_absolute_error.html) - Official API reference for MAE.
- [scikit-learn: root_mean_squared_error](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.root_mean_squared_error.html) - Official API reference for RMSE, added in scikit-learn 1.4.
- [scikit-learn: mean_squared_error](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.mean_squared_error.html) - Official API reference for MSE.
- [MLflow Model Evaluation](https://mlflow.org/docs/latest/ml/evaluation/) - Official guide to classic `mlflow.models.evaluate()` for regression and classification.
- [Evidently Regression Preset](https://docs.evidentlyai.com/metrics/preset_regression) - Official Evidently documentation for regression metrics, plots, and tests.
