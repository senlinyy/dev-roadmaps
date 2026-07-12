---
title: "Data Validation"
description: "Introduce automated validation before training or inference uses data."
overview: "Data validation checks whether ML data is safe enough to use before training, evaluation, or inference. This article explains schema, freshness, range, distribution, and label checks through one delivery ETA pipeline."
tags: ["MLOps", "core", "validation"]
order: 1
id: "article-mlops-data-for-ml-systems-data-validation-for-ml-pipelines"
---

## Table of Contents

1. [Data Validation Checks Whether ML Data Is Safe To Use](#data-validation-checks-whether-ml-data-is-safe-to-use)
2. [Follow One Delivery ETA Pipeline](#follow-one-delivery-eta-pipeline)
3. [Validation Contracts](#validation-contracts)
4. [Schema And Range Checks In Python](#schema-and-range-checks-in-python)
5. [Warehouse Tests With dbt](#warehouse-tests-with-dbt)
6. [Distribution And Anomaly Checks](#distribution-and-anomaly-checks)
7. [Runbook For Failed Validation](#runbook-for-failed-validation)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Data Validation Checks Whether ML Data Is Safe To Use
<!-- section-summary: Data validation runs automated checks that decide whether a dataset can move into training, evaluation, or serving. -->

**Data validation** is the habit of checking ML data before a model uses it. The checks can confirm the schema, required fields, freshness, allowed ranges, category values, label health, row counts, and distribution changes. The goal is simple: catch broken data while the pipeline can stop, alert, or route to a safe fallback.

This matters because ML pipelines often fail quietly. A training job can still produce a model when a field arrives as a string, a join drops half the rows, or yesterday's labels never landed. The model may look normal from the outside while it learns from damaged inputs.

The earlier articles explained examples, labels, splits, and leakage. Validation turns those definitions into automatic gates. If the dataset contract says `pickup_latitude` is required and labels must be mature, validation checks those facts every time the pipeline builds data.

## Follow One Delivery ETA Pipeline
<!-- section-summary: The delivery ETA scenario has late GPS pings, changing schemas, missing labels, and production decisions that depend on fresh data. -->

Imagine **SwiftDrop**, a food delivery company that predicts arrival time after a driver accepts an order. The ETA model affects what customers see in the app, when restaurants prepare food, and how dispatchers handle late orders. Bad data can send drivers to the wrong queue or tell customers a meal will arrive much earlier than reality.

The training dataset has one row per accepted delivery. Features include restaurant location, customer zone, driver distance, pickup wait history, weather, order size, and recent traffic speed. The label is `actual_delivery_minutes`, measured after the order completes. The prediction happens when the driver accepts, so validation needs to protect both historical training data and live request payloads.

SwiftDrop sees common data issues:

| Problem | Example | Impact |
|---|---|---|
| Schema drift | `driver_distance_meters` changes from integer to string | Training code may cast incorrectly or fail late |
| Missing values | Weather provider misses a city for two hours | Model may overuse defaults for one region |
| Range error | `restaurant_latitude` arrives as `920.1` | Distance features break |
| Freshness problem | Traffic table stops updating at 03:00 UTC | ETA underestimates rush-hour travel time |
| Label bug | Cancelled orders enter training with `actual_delivery_minutes = 0` | Model learns fake fast deliveries |

These issues sound ordinary because they are ordinary. Validation gives the team a way to catch them before the model training job or serving endpoint treats them as truth.

## Validation Contracts
<!-- section-summary: A validation contract records which checks are warnings, which checks block the pipeline, and who owns each response. -->

A **validation contract** is the reviewable list of checks for a dataset or request payload. It should say what each field means, which values are allowed, which checks block the pipeline, and which owner receives the alert. The contract can live in Great Expectations, Pandera, TensorFlow Data Validation, dbt, a warehouse quality system, or a small internal framework.

For SwiftDrop, a contract can group checks by purpose:

| Check group | Example check | Severity | Owner |
|---|---|---|---|
| Schema | Required columns exist with expected types | block training | ML platform |
| Freshness | Traffic features updated within 15 minutes | block serving feature publish | Data platform |
| Range | Latitude between -90 and 90, duration between 1 and 240 minutes | block training | Delivery data engineering |
| Completeness | Missing weather rate below 2 percent per city | warn above 1 percent, block above 5 percent | Data platform |
| Label quality | Cancelled orders excluded from completed-order labels | block training | Analytics engineering |
| Drift | Order-size distribution changed by more than review threshold | warn and open review | ML owner |

The severity column matters. Some checks should stop the pipeline immediately, such as missing labels or impossible coordinates. Other checks may warn first, such as a mild distribution shift after SwiftDrop launches in a new city. A production validation system should make that decision explicit.

![Data validation gate showing source data passing through a validation contract with pass and block paths](/content-assets/articles/article-mlops-data-for-ml-systems-data-validation-for-ml-pipelines/validation-gates.png)

_This gate view shows how source data passes through a validation contract before training, evaluation, or a blocking alert._

## Schema And Range Checks In Python
<!-- section-summary: Python validation catches dataframe schema, null, category, and range problems before training code runs. -->

Python validation works well near training code because it checks the exact dataframe the model will consume. Pandera gives teams a dataframe schema with typed columns and checks. This fits notebooks, batch jobs, and CI tests around feature-building code.

Here is a compact SwiftDrop training schema:

```python
import pandera.pandas as pa
from pandera.typing import Series


class DeliveryEtaTrainingSchema(pa.DataFrameModel):
    delivery_id: Series[str] = pa.Field(unique=True)
    accepted_ts: Series[pa.DateTime]
    city_id: Series[str]
    restaurant_latitude: Series[float] = pa.Field(ge=-90, le=90)
    restaurant_longitude: Series[float] = pa.Field(ge=-180, le=180)
    driver_distance_meters: Series[int] = pa.Field(ge=0, le=80000)
    pickup_wait_p50_minutes_7d: Series[float] = pa.Field(ge=0, le=90, nullable=True)
    traffic_speed_kph_15m: Series[float] = pa.Field(ge=1, le=130)
    order_item_count: Series[int] = pa.Field(ge=1, le=80)
    cancelled: Series[bool]
    actual_delivery_minutes: Series[float] = pa.Field(ge=1, le=240)


validated_df = DeliveryEtaTrainingSchema.validate(training_df, lazy=True)
```

The `lazy=True` option asks Pandera to collect multiple failures in one validation result. That helps the on-call engineer see the whole shape of the problem rather than fixing one column and rerunning repeatedly.

Python checks should also test business rules across columns:

```python
import pandera.pandas as pa


completed_orders_have_labels = pa.Check(
    lambda df: (~df["cancelled"]) | df["actual_delivery_minutes"].isna(),
    element_wise=False,
    error="Cancelled orders should not create completed-delivery duration labels.",
)
```

This check protects the label definition. A cancelled order may carry useful operational data, yet it should stay out of the completed-delivery duration target. The validation code records that rule where the training job can enforce it.

## Warehouse Tests With dbt
<!-- section-summary: Warehouse tests catch source-table and model-table issues before the ML dataset reaches Python. -->

Many ML datasets come from warehouse transformations. dbt data tests fit this layer because analytics engineers can test source and model tables where joins, filters, and labels are created. A warehouse test can fail before a Python training job starts.

SwiftDrop can define dbt tests for the curated training table:

```yaml
version: 2

models:
  - name: delivery_eta_training_examples
    columns:
      - name: delivery_id
        data_tests:
          - unique
          - not_null
      - name: accepted_ts
        data_tests:
          - not_null
      - name: city_id
        data_tests:
          - not_null
          - accepted_values:
              arguments:
                values: ["london", "manchester", "birmingham", "edinburgh"]
      - name: actual_delivery_minutes
        data_tests:
          - not_null:
              config:
                where: "cancelled = false"
```

This dbt file protects common warehouse failures: duplicate example keys, missing prediction timestamps, unsupported city IDs, and completed deliveries without labels. Custom dbt tests can add freshness or range logic when built-in tests are too small for the production rule.

The ML team should read dbt test results in the same run packet as the training metrics. A model review that only shows accuracy ignores the data gates that made the metric trustworthy.

## Distribution And Anomaly Checks
<!-- section-summary: Distribution checks compare new data with expected patterns so teams can catch drifts, outages, and changed sources. -->

Schema and range checks catch hard failures. Distribution checks catch softer failures where the data still has valid types and values, yet the pattern changed enough to require review. SwiftDrop might see normal integer distances, while the average distance doubles because a geocoder swapped meters and kilometers before the ML table.

TensorFlow Data Validation can compute statistics over datasets, infer or validate schemas, and detect anomalies. Great Expectations can also express expectations and run them through validation definitions and checkpoints. The exact tool can vary, and the workflow stays the same: compute a report, compare it with a baseline or thresholds, and store the result with the dataset version.

Here is a warehouse check that catches a distribution shift in one city:

```sql
WITH current_day AS (
  SELECT
    city_id,
    AVG(driver_distance_meters) AS avg_driver_distance_meters,
    COUNT(*) AS rows
  FROM ml_curated.delivery_eta_training_examples
  WHERE DATE(accepted_ts) = DATE '2026-07-03'
  GROUP BY city_id
),
baseline AS (
  SELECT
    city_id,
    AVG(driver_distance_meters) AS baseline_avg_distance
  FROM ml_curated.delivery_eta_training_examples
  WHERE DATE(accepted_ts) BETWEEN DATE '2026-06-01' AND DATE '2026-06-30'
  GROUP BY city_id
)
SELECT
  c.city_id,
  c.rows,
  c.avg_driver_distance_meters,
  b.baseline_avg_distance,
  SAFE_DIVIDE(c.avg_driver_distance_meters, b.baseline_avg_distance) AS ratio_to_baseline
FROM current_day c
JOIN baseline b USING (city_id)
WHERE c.rows >= 1000
  AND SAFE_DIVIDE(c.avg_driver_distance_meters, b.baseline_avg_distance) > 1.35;
```

This query should open a review rather than automatically delete data. A distance shift could reflect a real service-area expansion, a broken geocoder, or a changed dispatch rule. The validation system catches the change and routes it to the people who can interpret it.

![Delivery ETA quality report with schema, freshness, ranges, missing weather, labels, and review decision](/content-assets/articles/article-mlops-data-for-ml-systems-data-validation-for-ml-pipelines/delivery-eta-quality-report.png)

_The report view collects schema, freshness, ranges, missing weather, label health, and a review decision in one artifact._

## Runbook For Failed Validation
<!-- section-summary: A validation runbook connects each failure to a decision, owner, rollback path, and evidence packet. -->

Validation without a response plan can create alert noise. SwiftDrop needs a runbook that says who owns each class of failure and what the pipeline should do next. The runbook should also state which previous dataset or feature snapshot the system can use as a safe fallback.

| Failure | Pipeline decision | Owner | First evidence to inspect | Recovery path |
|---|---|---|---|---|
| Required column missing | Stop training | Data engineering | Schema diff and upstream deploy log | Revert source change or update contract after review |
| Traffic table stale | Stop feature publish | Data platform | Last successful traffic ingest run | Use last healthy online feature values within freshness limit |
| Label rate drops sharply | Stop training | Analytics engineering | Label query diff and cancelled-order counts | Rebuild labels after source fix |
| Mild city distribution shift | Continue with warning | ML owner | City launch calendar and geocoder logs | Add segment monitoring or update baseline |

A good validation report should include the dataset version, pipeline run ID, check results, failing rows or samples, owner, and decision. That report should live next to the model training run so later model reviewers can see which data gates passed.

![Failed validation runbook loop connecting failed check, owner, evidence, fix or fallback, and re-run gate](/content-assets/articles/article-mlops-data-for-ml-systems-data-validation-for-ml-pipelines/validation-failure-runbook.png)

_The runbook loop keeps a failed check tied to an owner, evidence, fallback choice, and re-run before the dataset moves forward._

## Putting It Together
<!-- section-summary: Data validation turns dataset definitions into automatic gates that protect training, evaluation, and serving. -->

For SwiftDrop, validation protects ETA training from broken schemas, missing weather, stale traffic, impossible coordinates, and bad labels. The team combines Python schemas, warehouse tests, distribution checks, and a runbook so failures produce action instead of surprise.

The important habit is to validate before trust. A model score only means something when the underlying data passed the contract that defines examples, features, labels, timestamps, and ownership.

## References

- [Great Expectations GX Core overview](https://docs.greatexpectations.io/docs/core/introduction/gx_overview/)
- [Great Expectations Validation Definitions](https://docs.greatexpectations.io/docs/core/define_expectations/organize_expectation_suites/)
- [Pandera DataFrameModel documentation](https://pandera.readthedocs.io/en/latest/dataframe_models.html)
- [TensorFlow Data Validation get started guide](https://www.tensorflow.org/tfx/data_validation/get_started)
- [dbt data tests documentation](https://docs.getdbt.com/docs/build/data-tests)
