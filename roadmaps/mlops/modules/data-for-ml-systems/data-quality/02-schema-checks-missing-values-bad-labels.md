---
title: "Data Quality Checks"
description: "Group common data quality checks into one practical article."
overview: "Data quality checks catch the common problems that damage model training: schema drift, missing values, invalid ranges, category changes, duplicate rows, broken joins, and bad labels."
tags: ["MLOps", "core", "validation"]
order: 2
id: "article-mlops-data-for-ml-systems-schema-checks-missing-values-bad-labels"
---

## Table of Contents

1. [Data Quality Checks Catch The Ordinary Breakages](#data-quality-checks-catch-the-ordinary-breakages)
2. [Follow One Content Moderation Dataset](#follow-one-content-moderation-dataset)
3. [Schema And Type Checks](#schema-and-type-checks)
4. [Missing Values And Defaults](#missing-values-and-defaults)
5. [Bad Labels And Broken Joins](#bad-labels-and-broken-joins)
6. [A Quality Report Reviewers Can Use](#a-quality-report-reviewers-can-use)
7. [Incident Response For Data Quality](#incident-response-for-data-quality)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Data Quality Checks Catch The Ordinary Breakages
<!-- section-summary: Data quality checks find the common table problems that can damage model behavior before anyone notices a model metric. -->

**Data quality checks** are targeted tests for the table problems that break ML work: missing columns, changed types, null spikes, invalid ranges, duplicate examples, broken joins, unexpected categories, and labels that no longer match the product definition. These checks sit close to the dataset because they protect the inputs the model will learn from.

This article narrows the previous validation article into the checks you will write again and again. The exact tool can be dbt, Pandera, Great Expectations, TensorFlow Data Validation, or a warehouse query. The deeper habit is to connect each check to a production failure the team understands.

The running scenario is **ClipJoy**, a short-video platform training a model to route newly uploaded videos for safety review. The model predicts whether a video likely violates the platform policy. A damaged dataset can send harmful videos past review or overload human moderators with safe content.

![Training table surrounded by schema, missing value, bad label, and broken join checks](/content-assets/articles/article-mlops-data-for-ml-systems-schema-checks-missing-values-bad-labels/data-quality-check-families.png)

_This map turns the broad idea of data quality into four concrete check families around the training table._

## Follow One Content Moderation Dataset
<!-- section-summary: The moderation scenario has video metadata, creator history, policy labels, duplicate examples, and join paths that need quality checks. -->

ClipJoy builds one training example per uploaded video after the moderation label matures. Features include video duration, language, upload country, creator account age, prior policy strikes, audio fingerprint status, and text signals from captions. The label is `policy_violation_confirmed`, created after reviewer decisions and appeals settle.

The dataset joins many systems: upload events, creator profiles, moderation decisions, appeal outcomes, caption extraction, and audio processing. That makes data quality more than a column checklist. A broken join can drop creator history, a delayed appeal table can flip labels later, and a new country code can fall into an unknown category bucket.

ClipJoy starts with this table shape:

| Column | Type | Required | Example |
|---|---|---|---|
| `video_id` | string | yes | `vid_89102` |
| `creator_id_hash` | string | yes | `crt_77a2` |
| `uploaded_ts` | timestamp | yes | `2026-06-17T12:44:03Z` |
| `duration_seconds` | integer | yes | `42` |
| `language_code` | string | yes | `en` |
| `upload_country` | string | yes | `GB` |
| `creator_age_days` | integer | yes | `412` |
| `prior_policy_strikes_365d` | integer | yes | `1` |
| `caption_available` | boolean | yes | `true` |
| `policy_violation_confirmed` | integer | yes after maturity | `0` |

The schema gives the checks something concrete to enforce. A vague goal like "make the data clean" produces weak work. A table with columns, types, null rules, ranges, and label maturity produces checks the team can run.

## Schema And Type Checks
<!-- section-summary: Schema checks confirm that required columns exist with expected types, allowed values, and duplicate rules. -->

**Schema checks** answer the first question: does the table still have the shape the model expects? If `duration_seconds` changes from integer to string, the model code may fail or silently cast values. If `language_code` disappears, a text-safety feature group loses context.

dbt can protect warehouse tables with built-in tests and custom tests:

```yaml
version: 2

models:
  - name: moderation_training_examples
    columns:
      - name: video_id
        data_tests:
          - unique
          - not_null
      - name: uploaded_ts
        data_tests:
          - not_null
      - name: language_code
        data_tests:
          - not_null
          - accepted_values:
              arguments:
                values: ["en", "es", "fr", "de", "pt", "hi", "ja", "ko"]
      - name: duration_seconds
        data_tests:
          - not_null
```

Warehouse tests catch the shape before Python reads the table. Python checks can then validate the final dataframe:

```python
import pandera.pandas as pa
from pandera.typing import Series


class ModerationTrainingSchema(pa.DataFrameModel):
    video_id: Series[str] = pa.Field(unique=True)
    creator_id_hash: Series[str]
    uploaded_ts: Series[pa.DateTime]
    duration_seconds: Series[int] = pa.Field(ge=1, le=7200)
    language_code: Series[str] = pa.Field(str_length=2)
    creator_age_days: Series[int] = pa.Field(ge=0, le=5000)
    prior_policy_strikes_365d: Series[int] = pa.Field(ge=0, le=100)
    caption_available: Series[bool]
    policy_violation_confirmed: Series[int] = pa.Field(isin=[0, 1])
```

The two layers serve different owners. Analytics engineering catches warehouse shape problems. ML engineering catches the final training dataframe shape. Both layers should report into the same pipeline run.

## Missing Values And Defaults
<!-- section-summary: Missing-value checks separate acceptable absent values from outages that change model behavior. -->

Missing values need context. A missing caption can be normal when a video has no speech or text. A sudden spike in missing captions may mean the caption extraction job failed. The check should distinguish an expected absence from a pipeline outage.

ClipJoy tracks missing rates by source and segment:

```sql
SELECT
  DATE(uploaded_ts) AS upload_date,
  upload_country,
  COUNT(*) AS rows,
  COUNTIF(caption_text IS NULL) / COUNT(*) AS missing_caption_rate,
  COUNTIF(audio_fingerprint_status IS NULL) / COUNT(*) AS missing_audio_status_rate,
  COUNTIF(creator_age_days IS NULL) / COUNT(*) AS missing_creator_age_rate
FROM ml_curated.moderation_training_examples
WHERE uploaded_ts >= TIMESTAMP '2026-06-01 00:00:00 UTC'
GROUP BY upload_date, upload_country
ORDER BY upload_date, upload_country;
```

The response depends on the column. Missing caption text may use a default value and a `caption_available` feature, because the model can learn that no caption exists. Missing `creator_id_hash` should block training, because the team loses entity history and duplicate checks.

ClipJoy records default choices in the feature contract:

```yaml
defaults:
  caption_text:
    value: ""
    companion_feature: caption_available
    severity_if_missing_rate_gt_20_percent: warn
  creator_age_days:
    value: null
    severity_if_missing: block
  prior_policy_strikes_365d:
    value: 0
    severity_if_missing_rate_gt_1_percent: block
```

Defaults should be boring and reviewed. A default of `0` for missing prior strikes makes sense only if the source query proves the absence means no strikes. If the join failed, `0` hides a serious data problem.

## Bad Labels And Broken Joins
<!-- section-summary: Label and join checks protect the target definition and the feature history that models often rely on. -->

Bad labels hurt supervised learning because the model treats them as the answer. ClipJoy's label should represent a confirmed policy violation after reviewer decisions and appeals settle. If appeal reversals arrive late, the training table can carry labels that the policy team no longer stands behind.

The label query needs maturity and exclusion rules:

```sql
WITH matured_reviews AS (
  SELECT
    video_id,
    final_policy_state,
    review_closed_ts,
    appeal_closed_ts
  FROM warehouse.moderation_cases
  WHERE review_closed_ts < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
    AND (appeal_closed_ts IS NULL OR appeal_closed_ts < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY))
)
SELECT
  video_id,
  CASE
    WHEN final_policy_state = 'violation_confirmed' THEN 1
    WHEN final_policy_state = 'cleared' THEN 0
  END AS policy_violation_confirmed
FROM matured_reviews
WHERE final_policy_state IN ('violation_confirmed', 'cleared');
```

Broken joins create a different failure. The table can have rows and labels, while a join quietly removes creator history. A row-count check after each join helps the team locate where records disappear.

```sql
WITH base AS (
  SELECT video_id, creator_id_hash
  FROM warehouse.video_uploads
  WHERE uploaded_ts >= TIMESTAMP '2026-06-01 00:00:00 UTC'
),
with_creator AS (
  SELECT
    b.video_id,
    c.creator_created_ts
  FROM base b
  LEFT JOIN warehouse.creator_profiles c
    ON c.creator_id_hash = b.creator_id_hash
)
SELECT
  COUNT(*) AS uploaded_videos,
  COUNTIF(creator_created_ts IS NULL) AS missing_creator_profiles,
  COUNTIF(creator_created_ts IS NULL) / COUNT(*) AS missing_creator_profile_rate
FROM with_creator;
```

This check should fail fast when missing creator profiles rise above the accepted threshold. A moderation model with missing creator history may under-rank repeat offenders, so the join health is a model-safety concern.

![Uploads, creator profiles, reviews, and appeals flowing through join health and mature label gates into a training dataset](/content-assets/articles/article-mlops-data-for-ml-systems-schema-checks-missing-values-bad-labels/label-join-quality-gates.png)

_The gate view shows why join health and label maturity need explicit checks before rows enter the training dataset._

## A Quality Report Reviewers Can Use
<!-- section-summary: A quality report summarizes row counts, schema results, missingness, label health, joins, and distribution shifts for each dataset version. -->

Data quality checks should produce a report that a reviewer can read without running the pipeline. ClipJoy includes the report in each training run and links it from the model review ticket. The report gives the team one place to inspect the data behind a candidate model.

```yaml
dataset_version: moderation_train_2026_07_01_v3
pipeline_run_id: airflow://moderation_dataset/dagrun/2026-07-02T02:00:00Z
rows: 18320491
schema:
  status: passed
missingness:
  caption_text_rate: 0.184
  creator_age_days_rate: 0.0002
joins:
  creator_profile_missing_rate: 0.0002
  caption_extraction_missing_rate: 0.184
labels:
  positive_rate: 0.037
  appeal_maturity_window_days: 14
  excluded_unmatured_reviews: 219340
distribution_warnings:
  - upload_country=BR caption_text_rate rose from 0.21 to 0.34
decision: "approved_for_training_with_caption_warning"
owner: moderation-ml-oncall
```

The report should preserve the decision. If the model later behaves poorly for Brazilian Portuguese videos, the team can see that caption missingness already warned during training. That makes incident review faster and more honest.

## Incident Response For Data Quality
<!-- section-summary: A data-quality incident response names the blast radius, affected dataset versions, owner, and model actions. -->

When a quality check fails after a model release, the team needs a response path. ClipJoy treats data-quality incidents like production incidents because the dataset influences moderation outcomes.

| Step | What ClipJoy does | Evidence |
|---|---|---|
| Confirm failure | Re-run the failed check on the affected date range | dbt or validation logs |
| Find blast radius | List dataset versions and model versions trained from affected rows | dataset manifest and registry metadata |
| Freeze releases | Pause promotion of candidates using damaged data | model review ticket |
| Rebuild data | Fix source or join, then rebuild the affected dataset version | pipeline run ID |
| Compare model impact | Train or score with fixed data and compare segment metrics | evaluation report |
| Decide rollout | Keep current model, roll back, or release a fixed model | incident commander decision |

The runbook prevents the team from jumping straight to retraining. Sometimes the model never used the damaged dataset. Sometimes only one segment changed. Sometimes a dashboard query had the bug while the model table was healthy. The evidence path keeps the response focused.

## Start With A Small Check Set
<!-- section-summary: A small first check set should protect the dataset columns, labels, joins, row counts, and owner handoff that matter most. -->

If a team is new to data quality, start with five checks rather than trying to cover every possible failure. For ClipJoy, the first useful set is:

- Required columns exist with the expected types.
- The row count stays inside a normal range for the training window.
- Critical feature columns have missing-value thresholds.
- Labels use only approved values and have a mature review window.
- Key joins do not drop or duplicate too many rows.

That starter set gives reviewers a shared baseline. When a future incident happens, add the missing check to the report. Over time, the quality suite grows from real failure evidence instead of a theoretical wish list.

![Reviewer report showing schema, missingness, joins, labels, warning metrics, and approve with warning decision](/content-assets/articles/article-mlops-data-for-ml-systems-schema-checks-missing-values-bad-labels/reviewer-quality-report.png)

_The report view shows how check results, warning thresholds, key metrics, and the final decision can travel with one dataset version._

## Putting It Together
<!-- section-summary: Data quality checks give each model dataset a concrete health report before training and during incident review. -->

For ClipJoy, data quality checks protect the moderation model from schema drift, null spikes, duplicate videos, broken creator joins, and unstable labels. The checks run in the warehouse and in Python, and the quality report travels with the dataset version.

The useful pattern is practical: define the table, write checks that map to real failures, store the report, and keep an incident path for damaged data. The next article uses these ideas for training-serving skew, where training data and live serving data drift apart.

## References

- [dbt data tests documentation](https://docs.getdbt.com/docs/build/data-tests)
- [Pandera checks documentation](https://pandera.readthedocs.io/en/stable/checks.html)
- [Great Expectations expectation concepts](https://docs.greatexpectations.io/docs/core/define_expectations/)
- [TensorFlow Data Validation anomalies documentation](https://www.tensorflow.org/tfx/data_validation/anomalies)
