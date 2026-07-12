---
title: "ML Data Basics"
description: "Explain the basic pieces of supervised ML data in one connected article."
overview: "Supervised ML data is built from examples, features, labels, targets, timestamps, and entity keys. This article uses a hospital readmission model to show what each piece means and why production teams need clear definitions before training begins."
tags: ["MLOps", "core", "datasets"]
order: 1
id: "article-mlops-data-for-ml-systems-training-data-labels-features-targets"
---

## Table of Contents

1. [ML Data Basics Are The Contract Behind A Model](#ml-data-basics-are-the-contract-behind-a-model)
2. [Follow One Hospital Readmission Dataset](#follow-one-hospital-readmission-dataset)
3. [Examples, Entities, And Prediction Time](#examples-entities-and-prediction-time)
4. [Features](#features)
5. [Labels And Targets](#labels-and-targets)
6. [A Dataset Schema The Team Can Review](#a-dataset-schema-the-team-can-review)
7. [Checks Before Training](#checks-before-training)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## ML Data Basics Are The Contract Behind A Model
<!-- section-summary: ML data basics are the reviewed definitions for examples, features, labels, targets, timestamps, and entity keys. -->

**ML data basics** are the pieces that tell a supervised model what it can learn from. An **example** is one historical case, **features** are the facts the model may use, a **label** is the answer recorded later, a **target** is the exact value the model learns to predict, and timestamps say what was known at the moment of prediction.

You can think of this as the contract before training starts. If the contract says one row represents one hospital discharge, the model learns from discharged patients. If someone quietly changes the row to one lab result or one billing claim, the model learns a different problem while the notebook may still run successfully.

The running scenario is **Riverbend Health**, a regional hospital network building a model that estimates the risk of a patient returning within 30 days after discharge. The model supports a care coordination team. A high-risk patient may receive a follow-up call, a medication review, or a home-care referral, so the dataset needs clear definitions before the team trusts any score.

## Follow One Hospital Readmission Dataset
<!-- section-summary: The readmission scenario gives every data piece a concrete owner, timestamp, and business purpose. -->

Riverbend wants a model that runs shortly after discharge. At that moment, the hospital knows the patient age band, discharge department, length of stay, diagnosis group, recent admissions, lab summary fields, medication count, and whether a follow-up appointment was scheduled. The hospital will only learn the label after 30 days pass.

That timing gives the dataset its shape. One row should represent one **discharge event**, because the prediction happens once for that discharge. The row needs a stable discharge ID, a patient key, a prediction timestamp, features known by that timestamp, and a future label showing whether the patient returned inside the agreed window.

Here is the simple map the team uses during design:

| Piece | Riverbend example | Why it matters |
|---|---|---|
| Entity | `patient_id_hash` | Groups events that belong to the same patient without exposing raw identifiers |
| Example | `discharge_id` | Gives one training row per discharge decision |
| Prediction time | `discharge_ts` | Draws the line between available facts and future outcomes |
| Features | `prior_admissions_180d`, `medication_count`, `followup_scheduled` | Give the model facts it can use during scoring |
| Label | `readmitted_30d` | Records the later answer used for supervised learning |
| Target | Binary `0` or `1` value from `readmitted_30d` | Gives the training algorithm the value to learn |

The business owner, clinical owner, data engineer, and ML engineer should agree on this map before model training. A model can only answer the question encoded by the dataset, so the dataset contract is also the product requirement.

![Riverbend training row diagram showing one discharge example, approved features, prediction time, label, and target](/content-assets/articles/article-mlops-data-for-ml-systems-training-data-labels-features-targets/example-features-label-target.png)

*The row contract keeps the example, features, label, and target separate, with prediction time marking where future information begins.*

## Examples, Entities, And Prediction Time
<!-- section-summary: An example is one training row, an entity is the real thing behind rows, and prediction time defines what the model may know. -->

An **example** is one row that teaches the model. For Riverbend, one example represents one discharge decision, such as patient `p_39172` leaving the cardiology unit on `2026-06-03T15:20:00Z`. The row tells the model what Riverbend knew at that time and later attaches the 30-day readmission answer.

An **entity** is the real-world thing the row describes. In this dataset, the main entity is the patient, and the event entity is the discharge. This distinction matters because one patient can have several discharges across a year, and the team needs to avoid mixing facts from a later discharge into an earlier example.

**Prediction time** is the timestamp where the model would run in production. For this use case, prediction time is the discharge timestamp, with a small grace period for final discharge documentation. Every feature needs an `as_of_ts` rule so the team can prove the feature was available when the score would have been produced.

```sql
SELECT
  discharge_id,
  patient_id_hash,
  discharge_ts AS prediction_ts,
  department,
  age_band,
  length_of_stay_hours,
  prior_admissions_180d,
  abnormal_lab_count_48h,
  medication_count_at_discharge,
  followup_scheduled,
  readmitted_30d
FROM ml_curated.readmission_training_examples
WHERE discharge_ts >= TIMESTAMP '2026-01-01 00:00:00 UTC'
  AND discharge_ts < TIMESTAMP '2026-07-01 00:00:00 UTC';
```

The important detail is the time filter on `discharge_ts`. The filter selects examples by the moment the prediction would have happened, and the feature columns should also respect that same moment. Later articles on splits and leakage build directly on this time boundary.

## Features
<!-- section-summary: Features are model inputs, and each feature needs a definition that says how it is computed and when it is available. -->

A **feature** is an input value the model can use. Some features come directly from source systems, such as `department` or `age_band`. Other features come from a transformation, such as counting prior admissions in the last 180 days or summarizing abnormal lab results in the 48 hours before discharge.

Feature names should sound boring and precise. A name like `risk_score` hides the source and timing, while `prior_admissions_180d` tells you the entity, the event type, and the window. You want a new teammate to understand the meaning before reading the pipeline code.

Riverbend can keep feature definitions in a small reviewed file:

```yaml
features:
  prior_admissions_180d:
    entity: patient_id_hash
    type: integer
    source_table: warehouse.admissions
    definition: "Count completed inpatient admissions in the 180 days before discharge_ts."
    available_at: "discharge_ts"
    default: 0
    owner: care-ml-platform
  abnormal_lab_count_48h:
    entity: discharge_id
    type: integer
    source_table: warehouse.lab_results
    definition: "Count lab results marked abnormal in the 48 hours before discharge_ts."
    available_at: "discharge_ts"
    default: 0
    owner: clinical-data-eng
  followup_scheduled:
    entity: discharge_id
    type: boolean
    source_table: warehouse.appointments
    definition: "True when an outpatient follow-up appointment exists before the discharge record closes."
    available_at: "discharge_record_closed_ts"
    default: false
    owner: care-coordination
```

This file gives reviewers more than field names. It explains the source, the timing rule, the default behavior, and the owner. When the model behaves strangely, the on-call engineer can inspect the feature definition instead of guessing how a column was built.

![Feature definition cards for Riverbend showing source, owner, default, lookback windows, and the prediction-time availability gate](/content-assets/articles/article-mlops-data-for-ml-systems-training-data-labels-features-targets/feature-availability-rules.png)

*Each feature definition carries timing, source, ownership, and default rules so reviewers can tell whether the value was available at scoring time.*

## Labels And Targets
<!-- section-summary: A label is the observed answer from history, and the target is the exact training value derived from that label. -->

A **label** is the answer attached to a historical example. In Riverbend's case, the label is whether the patient returned for an unplanned inpatient admission within 30 days after discharge. The team needs one definition, because a planned chemotherapy visit and an unexpected heart failure readmission carry different meanings.

A **target** is the exact value the algorithm learns from. For a binary classifier, the target can be `1` for a qualifying readmission and `0` for no qualifying readmission. The target should come from a label query that the clinical and analytics teams can review together.

```sql
WITH discharge_examples AS (
  SELECT
    discharge_id,
    patient_id_hash,
    discharge_ts
  FROM warehouse.discharges
  WHERE discharge_status = 'completed'
),
future_admissions AS (
  SELECT
    patient_id_hash,
    admission_ts,
    planned_admission
  FROM warehouse.admissions
)
SELECT
  d.discharge_id,
  CASE
    WHEN COUNTIF(a.planned_admission = false) > 0 THEN 1
    ELSE 0
  END AS readmitted_30d
FROM discharge_examples d
LEFT JOIN future_admissions a
  ON a.patient_id_hash = d.patient_id_hash
  AND a.admission_ts > d.discharge_ts
  AND a.admission_ts <= TIMESTAMP_ADD(d.discharge_ts, INTERVAL 30 DAY)
GROUP BY d.discharge_id;
```

The label query uses future data because the row belongs to historical training. That is acceptable for the target. The same future admission fields should stay out of the feature columns, because the model would lack that information at discharge time.

## A Dataset Schema The Team Can Review
<!-- section-summary: A schema gives the dataset a stable shape that data engineering, ML, and product reviewers can inspect. -->

A training dataset schema is the practical version of the contract. It names each column, type, null rule, owner, and timing note. The schema helps you catch accidental changes, and it helps reviewers understand what the model learned from.

Riverbend can write the schema in a data catalog, dbt model contract, Great Expectations suite, Pandera schema, or a simple repository file. The tool matters less than the review habit at this stage, although later data-quality articles will show validation tools in more detail.

| Column | Type | Required | Timing rule | Purpose |
|---|---|---|---|---|
| `discharge_id` | string | yes | Known at discharge | Example key |
| `patient_id_hash` | string | yes | Known before discharge | Entity key |
| `prediction_ts` | timestamp | yes | Discharge time | Point-in-time boundary |
| `department` | string | yes | Known at discharge | Care area context |
| `age_band` | string | yes | Known before discharge | Demographic band approved for use |
| `length_of_stay_hours` | float | yes | Known at discharge | Visit duration |
| `prior_admissions_180d` | integer | yes | Before prediction time | Utilization history |
| `abnormal_lab_count_48h` | integer | yes | Before prediction time | Recent clinical signal |
| `medication_count_at_discharge` | integer | yes | Known when discharge meds close | Complexity signal |
| `followup_scheduled` | boolean | yes | Known when discharge record closes | Care plan signal |
| `readmitted_30d` | integer | yes after label maturity | 30 days after discharge | Training target |

The schema also tells the team which rows are ready for training. A discharge from yesterday lacks a mature 30-day label, so it belongs in monitoring or future backfill rather than supervised training. Label maturity is one of the first production data rules a beginner should learn.

## Checks Before Training
<!-- section-summary: Pre-training checks make sure the dataset matches the contract before the model learns from it. -->

Before training, Riverbend should run a small set of checks that match the schema and timing rules. These checks should run in CI for small samples and in the scheduled pipeline for full datasets. A failed check should stop the training job when it can change model behavior.

Here is a compact Pandera example for a dataframe produced by the training-data query:

```python
import pandera.pandas as pa
from pandera.typing import Series


class ReadmissionTrainingSchema(pa.DataFrameModel):
    discharge_id: Series[str] = pa.Field(unique=True)
    patient_id_hash: Series[str]
    prediction_ts: Series[pa.DateTime]
    department: Series[str] = pa.Field(isin=["cardiology", "orthopedics", "general", "neurology"])
    length_of_stay_hours: Series[float] = pa.Field(ge=0, le=1440)
    prior_admissions_180d: Series[int] = pa.Field(ge=0, le=20)
    abnormal_lab_count_48h: Series[int] = pa.Field(ge=0, le=200)
    medication_count_at_discharge: Series[int] = pa.Field(ge=0, le=80)
    followup_scheduled: Series[bool]
    readmitted_30d: Series[int] = pa.Field(isin=[0, 1])


validated_df = ReadmissionTrainingSchema.validate(training_df)
```

The validation code catches duplicate examples, impossible lengths of stay, unexpected departments, and target values outside `0` or `1`. The ranges should come from clinical review and historical data, so they flag real surprises instead of turning the pipeline into a loose spell-checker.

A useful run report should also include dataset-level checks:

```sql
SELECT
  COUNT(*) AS rows,
  COUNT(DISTINCT discharge_id) AS distinct_discharges,
  AVG(readmitted_30d) AS positive_label_rate,
  AVG(CASE WHEN followup_scheduled THEN 1 ELSE 0 END) AS followup_rate,
  COUNTIF(prior_admissions_180d IS NULL) AS missing_prior_admissions
FROM ml_curated.readmission_training_examples
WHERE prediction_ts >= TIMESTAMP '2026-01-01 00:00:00 UTC'
  AND prediction_ts < TIMESTAMP '2026-07-01 00:00:00 UTC';
```

These numbers help the team review the dataset before it trains a model. If the positive label rate drops from 13 percent to 2 percent, the team should inspect label ingestion before celebrating a new model score.

## Putting It Together
<!-- section-summary: The core data pieces give later MLOps work a shared vocabulary and a reviewable training contract. -->

For Riverbend, the model starts with a clear supervised-learning question: at discharge time, which patients have higher risk of unplanned readmission within 30 days? The dataset answers that question with one row per discharge, patient and discharge keys, a prediction timestamp, approved features, and a mature label.

That structure gives the rest of the roadmap something solid to build on. Dataset splits use the prediction timestamp, leakage checks protect the boundary between features and labels, validation enforces the schema, pipelines rebuild the dataset, and feature management keeps shared definitions consistent across training and serving.

![Training data contract summary with one row per discharge, patient key, prediction timestamp, approved features, mature label, and schema checks](/content-assets/articles/article-mlops-data-for-ml-systems-training-data-labels-features-targets/training-data-contract-summary.png)

*A reviewable training data contract turns the model question into dataset fields, timing rules, mature labels, and checks that later MLOps work can reuse.*

## References

- [Pandera DataFrameModel documentation](https://pandera.readthedocs.io/en/latest/dataframe_models.html)
- [Pandera checks documentation](https://pandera.readthedocs.io/en/stable/checks.html)
- [TensorFlow Data Validation get started guide](https://www.tensorflow.org/tfx/data_validation/get_started)
- [Great Expectations GX Core overview](https://docs.greatexpectations.io/docs/core/introduction/gx_overview/)
