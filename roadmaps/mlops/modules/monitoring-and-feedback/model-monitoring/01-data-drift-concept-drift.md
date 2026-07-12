---
title: "Data and Concept Drift"
description: "Explain data drift, concept drift, baselines, alerts, and triage through one grocery demand forecasting system."
overview: "Data drift means the inputs arriving in production have shifted away from the reference data. Concept drift means the relationship between inputs and outcomes has changed. This tutorial follows a grocery demand forecast model through prediction logging, reference windows, Evidently checks, whylogs profiles, drift alerts, and triage decisions."
tags: ["MLOps", "production", "drift"]
order: 1
id: "article-mlops-monitoring-and-feedback-data-drift-concept-drift"
---

## Table of Contents

1. [Data Drift And Concept Drift Explain Why Models Age](#data-drift-and-concept-drift-explain-why-models-age)
2. [Follow One Grocery Demand Forecast](#follow-one-grocery-demand-forecast)
3. [Choose The Baseline Before The Test](#choose-the-baseline-before-the-test)
4. [Log The Evidence You Need Later](#log-the-evidence-you-need-later)
5. [Run Data Drift Checks With Evidently](#run-data-drift-checks-with-evidently)
6. [Profile Production Windows With whylogs](#profile-production-windows-with-whylogs)
7. [Tell Data Drift From Concept Drift](#tell-data-drift-from-concept-drift)
8. [Alert And Triage Drift](#alert-and-triage-drift)
9. [Practical Checks, Common Mistakes, And Interview Understanding](#practical-checks-common-mistakes-and-interview-understanding)
10. [References](#references)

## Data Drift And Concept Drift Explain Why Models Age
<!-- section-summary: Data drift is a change in production inputs, while concept drift is a change in the input-to-outcome relationship the model learned. -->

**Data drift** means the data arriving in production has a different pattern from the data you used as a reference. The model may still run, the feature schema may still validate, and the prediction endpoint may still return answers. The problem is that the model now sees a world that has moved away from the one it learned from.

**Concept drift** means the relationship between the inputs and the target has changed. The fields can look familiar, yet the old rule inside the model no longer matches the business reality. In a demand model, rainy weather might have raised soup sales last winter. After a new meal-kit competitor opens nearby, the same rainy weather may lead to a smaller soup spike because shoppers changed where they buy dinner.

You need both ideas because they lead to different actions. Data drift asks, "Did the input environment change?" Concept drift asks, "Did the meaning of the inputs change for the outcome we care about?" A drift alert should push you toward a review packet, label checks, segment analysis, retraining decisions, or a temporary business rule. It should never be treated as a magic retraining button.

Here is the simple shape of the article:

| Concept | Plain meaning | Evidence you inspect | Typical first action |
|---|---|---|---|
| Data drift | Production feature or prediction distributions moved away from a reference | Feature distributions, prediction distributions, null rates, category mix, row counts | Check data sources, campaigns, seasonality, new segments, and feature code |
| Concept drift | The target relationship changed | Fresh labels, error by segment, calibration, residual patterns, business events | Review labels, compare model versions, retrain candidate, add segment rule |
| Baseline | The reference window used for comparison | Training snapshot, last healthy production window, seasonal peer window | Pick the baseline that matches the question before reading the result |
| Threshold | The rule that turns a metric into a warning or page | Column-level drift, dataset-level drift, business impact guardrails | Route to the owner with context and a runbook |

The most useful drift monitoring starts with a specific production question. If the question is "Are the current inputs still similar to the training data?", use the training dataset as a reference. If the question is "Did yesterday break compared with normal production?", use a recent healthy production window. The same current data can produce different answers depending on the baseline, so the baseline is part of the monitoring design.

## Follow One Grocery Demand Forecast
<!-- section-summary: The running scenario follows a grocery demand model where stores, promotions, holidays, and supply changes can shift the data or the target relationship. -->

Imagine **GreenBasket**, a regional grocery chain. Every night, GreenBasket predicts tomorrow's demand for each `store_id` and `sku_id`. The forecast decides how many units the warehouse sends to each store before the morning truck leaves. The model helps with products such as strawberries, oat milk, frozen pizza, diapers, and soup.

The model uses features that look ordinary:

| Feature | Example value | Why it matters |
|---|---:|---|
| `store_id` | `store_042` | Stores have different shopper patterns |
| `sku_id` | `oat_milk_1l_barista` | Each product has its own demand shape |
| `day_of_week` | `friday` | Weekend demand differs from weekday demand |
| `promotion_type` | `multibuy` | Promotions can move demand quickly |
| `shelf_price` | `2.30` | Price changes affect units sold |
| `temperature_c` | `29.4` | Weather affects fresh food and drinks |
| `stockout_minutes_7d` | `180` | Recent stockouts hide true demand |
| `units_sold_lag_7d` | `42` | Recent sales anchor the forecast |

The target is `units_sold_next_day`, adjusted for known stockouts where the analytics team can estimate lost sales. The model runs nightly and writes forecasts into a replenishment planning table. Store operations sees the forecast as a recommended order quantity.

GreenBasket sees drift for very human reasons. A heatwave changes drink demand. A competitor opens near a store. A supplier shortage removes a popular brand from shelves. A promotion engine starts using a new category name. A new neighborhood delivery service changes the customer mix. Every one of those events can shift the data, the concept, or both.

Data drift in this scenario might look like this:

| Signal | What changed | Possible explanation |
|---|---|---|
| `promotion_type` category mix | `app_only_coupon` appears for 18 percent of rows | Marketing launched a new campaign channel |
| `temperature_c` distribution | Current week is far hotter than the training reference | Heatwave or weather data source issue |
| `stockout_minutes_7d` values | Many more products report long stockouts | Supplier outage or inventory feed delay |
| Predictions | Forecasts shift upward for cold drinks | Real demand change or model overreaction |

Concept drift might look different. The weather values, prices, and promotions may fall within familiar ranges, yet the model's errors grow. Shoppers may have changed behavior after a competitor launched same-day delivery. The old relationship between `promotion_type = multibuy` and units sold may weaken because shoppers now compare prices in another app.

The team needs monitoring that can answer both questions. First, it checks whether the feature and prediction patterns moved. Then, when actual sales labels arrive, it checks whether the model is still accurate for the affected stores and products.

## Choose The Baseline Before The Test
<!-- section-summary: A baseline is the reference data you compare against, and different baselines answer different production questions. -->

A **baseline** is the data window that represents "normal" for a drift check. The baseline might be the training dataset, the validation dataset, last month of healthy production traffic, the same season last year, or a carefully chosen slice such as "London urban stores during summer weekdays." The baseline should match the decision you want to make.

GreenBasket uses three baselines:

| Baseline | Window | Question it answers | Owner |
|---|---|---|---|
| Training reference | The frozen dataset used for model `demand_forecast:v18` | Are current inputs still inside the world the model learned from? | ML owner |
| Recent healthy production | Last 28 days after data-quality checks passed | Did the latest window break compared with normal operations? | ML platform |
| Seasonal peer | Same week last year, adjusted to active stores and SKUs | Is this change unusual for the season? | Forecasting analyst |

This choice matters. A summer heatwave will drift from the winter-heavy training data. That may be expected. The same heatwave may still look normal against last July, or it may look extreme even for July. The alert text should state the baseline, because an alert without a baseline forces the on-call engineer to guess what "changed" means.

GreenBasket stores baseline metadata next to every drift run:

```yaml
drift_run:
  model_name: demand_forecast
  model_version: "18"
  current_window:
    start: "2026-07-01T00:00:00Z"
    end: "2026-07-07T00:00:00Z"
  baseline:
    name: recent_healthy_28d
    start: "2026-06-01T00:00:00Z"
    end: "2026-06-29T00:00:00Z"
    filters:
      market: uk
      channel: store_replenishment
  owner: grocery-forecasting-ml
```

That metadata gives every chart and alert a plain story. The drift score is tied to a model version, a current window, a reference window, and a set of filters. If the business asks why an alert fired, the team can inspect the exact comparison.

![GreenBasket drift baseline dashboard](/content-assets/articles/article-mlops-monitoring-and-feedback-data-drift-concept-drift/greenbasket-drift-baselines.png)

*The baseline view shows why the same July forecast window can look different against training data, recent healthy production, and a seasonal peer.*

## Log The Evidence You Need Later
<!-- section-summary: Drift monitoring depends on prediction logs that capture model identity, feature values, predictions, labels, and segment keys. -->

Drift checks need data. In production, that usually means the serving or batch prediction job writes a **prediction log**. The log should include the model identity, request or batch row identity, feature values used by the model, prediction output, important segment keys, and eventually the actual outcome.

For GreenBasket, the nightly prediction log can look like this:

```json
{
  "forecast_id": "fcst_2026_07_06_store_042_oat_milk_1l_barista",
  "model_name": "demand_forecast",
  "model_version": "18",
  "prediction_ts": "2026-07-06T02:10:14Z",
  "store_id": "store_042",
  "region": "north_london",
  "sku_id": "oat_milk_1l_barista",
  "category": "dairy_alternatives",
  "features": {
    "day_of_week": "monday",
    "promotion_type": "app_only_coupon",
    "shelf_price": 2.3,
    "temperature_c": 29.4,
    "stockout_minutes_7d": 180,
    "units_sold_lag_7d": 42
  },
  "prediction": {
    "units_forecast": 67.8,
    "prediction_interval_p90": [49.0, 91.0]
  },
  "actual": {
    "units_sold_next_day": null,
    "label_available_ts": null
  }
}
```

That log gives the monitoring jobs enough information for several checks:

| Check | Uses labels? | Example |
|---|---|---|
| Feature drift | No | Compare `promotion_type`, `temperature_c`, and `stockout_minutes_7d` against the baseline |
| Prediction drift | No | Compare the distribution of `units_forecast` by category |
| Data quality | No | Track nulls, ranges, new categories, duplicate forecast IDs |
| Prediction quality | Yes | Join actual units after sales close and compute error |
| Concept drift | Yes | Check whether error patterns changed by store, category, promotion, or weather |

Labels arrive later. The actual `units_sold_next_day` value is known after the store closes and the sales table lands. If stockout adjustment runs separately, the final label may arrive another day later. That delay is normal. Drift monitoring can give early proxy signals before labels arrive, while quality monitoring confirms whether the model actually got worse.

## Run Data Drift Checks With Evidently
<!-- section-summary: Evidently compares current and reference datasets, can check each column, and can produce dataset-level drift results for review. -->

Evidently is useful for batch drift reports because it can compare a current dataset with a reference dataset and choose drift methods based on column type and row counts. Current Evidently docs show the `Report([DataDriftPreset()]).run(current, ref)` workflow for the data drift preset. The preset checks column drift, prediction or target drift when those columns exist, and overall dataset drift.

GreenBasket builds two dataframes. The reference dataframe is the recent healthy baseline. The current dataframe is the latest forecast window. Both contain only the columns the model actually used, plus the prediction:

```python
import pandas as pd
from evidently import Report
from evidently.presets import DataDriftPreset, DataSummaryPreset


feature_columns = [
    "day_of_week",
    "promotion_type",
    "shelf_price",
    "temperature_c",
    "stockout_minutes_7d",
    "units_sold_lag_7d",
    "units_forecast",
]

reference = pd.read_parquet("s3://greenbasket-ml-monitoring/reference/recent_healthy_28d.parquet")
current = pd.read_parquet("s3://greenbasket-ml-monitoring/current/2026-07-01_2026-07-07.parquet")

report = Report([
    DataDriftPreset(),
    DataSummaryPreset(),
])

eval_result = report.run(
    current_data=current[feature_columns],
    reference_data=reference[feature_columns],
)

drift_payload = eval_result.dict()
```

The extra `DataSummaryPreset` gives the team a quick view of missing values, ranges, and descriptive statistics. That matters because a pure drift check can miss a sharp rise in nulls if the test filters empty values during distribution comparison. GreenBasket treats null-rate checks as separate data-quality checks, then reads drift results alongside them.

The report should land in a durable place:

```bash
aws s3 cp drift-report-2026-07-07.html \
  s3://greenbasket-ml-monitoring/reports/demand_forecast/v18/2026-07-07.html
```

The drift job also writes a small summary table for dashboards and alerts:

```sql
CREATE TABLE IF NOT EXISTS ml_monitoring.demand_drift_runs (
  run_id STRING,
  model_name STRING,
  model_version STRING,
  baseline_name STRING,
  current_start TIMESTAMP,
  current_end TIMESTAMP,
  drifted_column_count INT64,
  total_column_count INT64,
  dataset_drift BOOLEAN,
  strongest_columns ARRAY<STRING>,
  report_uri STRING,
  created_at TIMESTAMP
);
```

The HTML report is helpful for human review. The summary table is helpful for automation. A pager alert should point to both.

## Profile Production Windows With whylogs
<!-- section-summary: whylogs profiles store compact statistical summaries that can be written, merged, compared, and monitored over time. -->

Evidently reports are good for scheduled comparisons. whylogs is useful when you want compact **profiles** of data windows. A profile is a statistical summary of a dataset. It can capture counts, missing values, distributions, frequent values, and other metrics without storing every raw row in the monitoring system.

GreenBasket can profile each daily forecast window:

```python
import pandas as pd
import whylogs as why


forecast_window = pd.read_parquet("s3://greenbasket-forecast-logs/date=2026-07-06/")

profile_results = why.log(
    forecast_window[
        [
            "store_id",
            "region",
            "sku_id",
            "category",
            "promotion_type",
            "temperature_c",
            "stockout_minutes_7d",
            "units_forecast",
        ]
    ]
)

profile_view = profile_results.view()
profile_view.write("demand_forecast_2026-07-06.bin")
```

The profile file is small enough to store for every day, region, or model version. whylogs profiles are also useful for privacy-sensitive monitoring because the monitoring platform can often use summaries rather than raw customer rows. GreenBasket still reviews privacy with its data governance team because product names, stores, and small segments can carry business-sensitive information.

If the team uses WhyLabs, uploaded profiles can feed monitors for data drift, data quality, concept drift, label drift, model performance, data volume, and ingestion. WhyLabs docs describe monitor configuration around baselines, thresholds, segments, and actions. The important design is the same even if GreenBasket stores profiles in S3 and builds internal dashboards: profiles give each time window a comparable statistical fingerprint.

Here is the profile storage layout:

```yaml
profiles:
  base_uri: s3://greenbasket-ml-monitoring/whylogs/demand_forecast
  partitioning:
    - model_version
    - prediction_date
    - region
  retention_days: 400
  raw_prediction_log_retention_days: 45
```

That retention plan keeps compact monitoring history for long-term seasonality while limiting the raw prediction log window. The exact numbers should match your privacy policy, debugging needs, and storage budget.

## Tell Data Drift From Concept Drift
<!-- section-summary: Data drift can appear before labels arrive, while concept drift needs outcome evidence from labels or trusted human review. -->

Data drift can be detected before labels arrive because it only needs current and reference inputs. Concept drift needs labels, accepted human review, or another trusted outcome source. In the grocery scenario, the actual sales result arrives after the trading day closes. That means GreenBasket can see feature drift on Tuesday morning and confirm concept drift after labels mature.

The label join can be simple:

```sql
WITH predictions AS (
  SELECT
    forecast_id,
    model_version,
    prediction_ts,
    store_id,
    region,
    sku_id,
    category,
    promotion_type,
    temperature_c,
    units_forecast
  FROM warehouse.demand_forecast_predictions
  WHERE DATE(prediction_ts) BETWEEN DATE '2026-07-01' AND DATE '2026-07-07'
),
labels AS (
  SELECT
    forecast_id,
    units_sold_next_day,
    stockout_adjusted,
    label_available_ts
  FROM warehouse.demand_forecast_labels
  WHERE label_available_ts < TIMESTAMP '2026-07-09 00:00:00 UTC'
)
SELECT
  p.region,
  p.category,
  p.promotion_type,
  COUNT(*) AS forecasts,
  AVG(ABS(l.units_sold_next_day - p.units_forecast)) AS mae_units,
  APPROX_QUANTILES(ABS(l.units_sold_next_day - p.units_forecast), 100)[OFFSET(90)] AS p90_abs_error,
  AVG(CASE WHEN l.stockout_adjusted THEN 1 ELSE 0 END) AS stockout_adjusted_rate
FROM predictions p
JOIN labels l USING (forecast_id)
GROUP BY p.region, p.category, p.promotion_type
HAVING forecasts >= 500
ORDER BY p90_abs_error DESC;
```

This query tells the team where errors are growing. If `promotion_type = app_only_coupon` has high drift and high error, the team may have a concept issue around a new campaign. If temperature drift is high during a heatwave, while errors stay within the normal range, the model may handle that weather pattern well enough. Drift is a signal for review; quality metrics decide impact.

The triage decision can look like this:

| Evidence | Likely reading | First response |
|---|---|---|
| Feature drift high, labels pending | The model is seeing a new environment | Watch early business guardrails, request label acceleration, check data quality |
| Feature drift high, error stable | The environment moved, and the model handled it | Keep monitoring, consider baseline update after review |
| Feature drift high, error high | New environment is hurting forecasts | Add segment rule, train candidate, review promotion or supply event |
| Feature drift low, error high | Relationship changed or labels changed | Check label logic, business rule changes, competitor events, model calibration |
| Prediction drift high, feature drift low | Model or post-processing changed | Check model version, feature defaults, forecast caps, and release config |

Concept drift is usually harder because the data can look familiar. That is why prediction quality monitoring, label checks, and segment reports are part of the same monitoring story.

![GreenBasket data drift and concept drift timeline](/content-assets/articles/article-mlops-monitoring-and-feedback-data-drift-concept-drift/greenbasket-data-vs-concept-drift.png)

*The label timeline separates early feature drift from later concept-drift evidence, so the team waits for segment error before retraining.*

## Alert And Triage Drift
<!-- section-summary: Drift alerts should state the baseline, affected segment, threshold, owner, and first investigation steps. -->

An alert threshold translates a monitoring signal into an action. The threshold should be tied to a response plan. If an alert wakes someone up, it should tell them what to inspect first and what decision they own.

GreenBasket uses warning tickets for mild drift and pages for drift tied to product impact. The warning ticket opens when more than 30 percent of monitored columns drift against the recent healthy baseline. The page fires when drift appears in important features and early forecast error or stockout guardrails also move.

```yaml
groups:
  - name: demand-forecast-drift
    rules:
      - alert: DemandForecastDatasetDriftReview
        expr: demand_forecast_drifted_column_ratio{baseline="recent_healthy_28d"} > 0.30
        for: 2h
        labels:
          severity: ticket
          owner: grocery-forecasting-ml
        annotations:
          summary: Demand forecast input drift needs review
          runbook: https://runbooks.greenbasket.example/demand-forecast-drift
          dashboard: https://grafana.greenbasket.example/d/demand-drift

      - alert: DemandForecastDriftWithErrorImpact
        expr: |
          demand_forecast_drifted_column_ratio{baseline="recent_healthy_28d"} > 0.30
          and
          demand_forecast_mae_units_24h > 1.25 * demand_forecast_mae_units_baseline_28d
        for: 30m
        labels:
          severity: page
          owner: grocery-forecasting-ml
        annotations:
          summary: Demand forecast drift is paired with higher forecast error
          action: Check current drift report, label join, promotion changes, and supply events
```

Prometheus alerting rules support expressions, labels, annotations, and a `for` duration that keeps a condition active for a period before the alert fires. The `for` window is useful here because one noisy batch can create a brief spike. GreenBasket wants a person involved after sustained evidence instead of one partial upload.

The runbook should be short enough for an on-call shift:

| Step | Question | Evidence |
|---|---|---|
| 1 | Which baseline and segment fired? | Alert labels, drift run metadata |
| 2 | Which columns moved most? | Evidently report, whylogs profile diff |
| 3 | Did data quality fail first? | Null rates, schema checks, freshness checks |
| 4 | Did labels confirm quality impact? | MAE, p90 absolute error, bias by region and category |
| 5 | Is there a known business event? | Promotion calendar, supplier incidents, weather, store launches |
| 6 | What action protects the product? | Baseline update, segment rule, retraining ticket, rollback of feature transform |

![GreenBasket drift triage runbook](/content-assets/articles/article-mlops-monitoring-and-feedback-data-drift-concept-drift/greenbasket-drift-triage-runbook.png)

*The runbook connects drift scores, data quality, label impact, and product action so an alert leads to review instead of guesswork.*

The team should write an incident or review note even for non-page drift events. That note builds the memory the model team needs later when choosing retraining cadence and baseline updates.

```yaml
drift_review:
  id: drift-2026-07-07-demand-forecast
  alert: DemandForecastDatasetDriftReview
  strongest_signal: promotion_type app_only_coupon rose to 18 percent of rows
  impacted_segments:
    - region: north_london
      category: dairy_alternatives
  data_quality_status: passed
  label_status: partial labels available through 2026-07-06
  business_context: new app-only campaign launched 2026-07-01
  decision: keep model active, add campaign segment dashboard, review after full labels land
  owner: grocery-forecasting-ml
```

Notice how the decision is specific. The team keeps retraining out of the first response. It keeps the model active because the first label slice is acceptable, adds a campaign dashboard, and schedules a follow-up after full labels land.

## Practical Checks, Common Mistakes, And Interview Understanding
<!-- section-summary: A strong drift answer connects definitions, baselines, logging, alerts, labels, and triage actions. -->

Use this practical checklist when you design drift monitoring:

| Check | What good looks like |
|---|---|
| Define the monitored unit | One prediction row, one batch row, or one entity-time pair is clear |
| Record model identity | Logs include model name, version, feature pipeline version, and prediction timestamp |
| Pick baselines deliberately | Training, recent production, and seasonal baselines answer different questions |
| Separate proxy and outcome signals | Feature drift can fire before labels; concept drift needs labels or trusted review |
| Track segments | Drift by region, category, channel, model version, and customer type is more useful than one global score |
| Store reports and summaries | Human reports and machine-readable tables both exist |
| Tie thresholds to action | Ticket, page, retrain review, feature rollback, or baseline update has an owner |

Common mistakes are easy to spot. Teams compare current data to a random old training file and forget seasonality. They alert on a global drift score while the real issue lives in one high-value segment. They use drift as a retraining trigger without checking labels. They update baselines after every alert and accidentally erase evidence of a real production shift. They log predictions without feature values, which leaves the monitoring team unable to explain the alert.

In an interview, you can explain it like this:

> Data drift is a change in the input or prediction distribution. Concept drift is a change in the relationship between input and outcome. I would log prediction events with model version, features, prediction, segment keys, and later labels. I would compare current windows against a chosen baseline, use tools like Evidently or whylogs for distribution checks, then confirm impact with label-based quality metrics before deciding on retraining, baseline updates, or production guardrails.

That answer shows the full production loop. You know the definitions, and you know the evidence needed to act responsibly.

## References

- [Evidently Data Drift Preset](https://docs.evidentlyai.com/metrics/preset_data_drift)
- [Evidently Data Drift Explainer](https://docs.evidentlyai.com/metrics/explainer_drift)
- [Evidently Report documentation](https://docs.evidentlyai.com/docs/library/report)
- [whylogs API documentation](https://whylogs.readthedocs.io/en/latest/api/whylogs/index.html)
- [WhyLabs whylogs overview](https://docs.whylabs.ai/docs/whylogs-overview/)
- [WhyLabs Monitor Manager overview](https://docs.whylabs.ai/docs/monitor-manager/)
- [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
