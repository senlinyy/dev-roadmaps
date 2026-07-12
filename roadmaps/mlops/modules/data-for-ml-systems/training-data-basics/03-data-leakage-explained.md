---
title: "Data Leakage"
description: "Explain the common ways future information sneaks into training and breaks trust."
overview: "Data leakage happens when training or evaluation uses information that would not be available at prediction time. This article shows common leakage paths in production ML and how teams catch them before release."
tags: ["MLOps", "core", "datasets"]
order: 3
id: "article-mlops-data-for-ml-systems-data-leakage-explained"
---

## Table of Contents

1. [Data Leakage Lets The Model Learn From Forbidden Information](#data-leakage-lets-the-model-learn-from-forbidden-information)
2. [Follow One Subscription Churn Model](#follow-one-subscription-churn-model)
3. [Future Information Leakage](#future-information-leakage)
4. [Target And Preprocessing Leakage](#target-and-preprocessing-leakage)
5. [Entity Leakage Across Splits](#entity-leakage-across-splits)
6. [Point-In-Time Joins](#point-in-time-joins)
7. [Leakage Review Checklist](#leakage-review-checklist)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Data Leakage Lets The Model Learn From Forbidden Information
<!-- section-summary: Data leakage happens when model training or evaluation uses data that would be unavailable at prediction time. -->

**Data leakage** happens when a model learns from information that would be unavailable when the model runs in production. The score can look excellent during development because the model sees hints from the future, the target, or repeated entities across splits. Production then exposes the truth because those hints are absent.

This article follows the split ideas from the previous article. A split creates a boundary between training, tuning, and final evaluation. Leakage breaks that boundary by letting information cross it in a way the product could never use during real scoring.

The running scenario is **StreamNest**, a video subscription product. The team wants to predict whether an active subscriber will cancel in the next 30 days, so the retention team can offer help, plan content recommendations, or improve onboarding. The model runs every Monday morning for active subscribers.

## Follow One Subscription Churn Model
<!-- section-summary: The churn scenario has a weekly prediction moment, delayed outcomes, and many tempting future fields. -->

For StreamNest, one example represents one subscriber at one weekly scoring date. The entity is `subscriber_id_hash`, the prediction timestamp is `score_week_start_ts`, and the target is `churned_next_30d`. Features should describe activity before Monday morning: watch minutes, failed payments before the score time, support tickets already opened, plan type, tenure, and device mix.

The tempting fields arrive later. Cancellation reason, win-back offer response, final invoice status, last-watch date after the scoring date, and support tickets opened after the scoring date all describe the future. They can help analysts explain churn after it happens, yet they should stay out of the model inputs for Monday morning scoring.

Here is the contract the team reviews:

| Field | Allowed as feature? | Reason |
|---|---|---|
| `watch_minutes_14d_before_score` | yes | Known before Monday scoring |
| `failed_payment_count_30d_before_score` | yes | Known before Monday scoring |
| `support_ticket_count_7d_before_score` | yes | Known before Monday scoring |
| `cancel_reason` | no | Filled after a subscriber cancels |
| `days_until_cancel` | no | Derived from the future target window |
| `retention_offer_accepted` | no | Happens after the model selects outreach candidates |

This review is plain, and that is why it works. Every feature needs an availability rule tied to `score_week_start_ts`. Any field without that rule should pause the release review.

![StreamNest churn timeline showing allowed pre-score features on the left and blocked future data such as cancel reason, days until cancel, and offer accepted on the right](/content-assets/articles/article-mlops-data-for-ml-systems-data-leakage-explained/future-information-boundary.png)

*The score-time boundary makes leakage visible: features can use facts known before scoring, while future cancellation evidence stays blocked.*

## Future Information Leakage
<!-- section-summary: Future information leakage uses data recorded after the prediction timestamp as if it were available before scoring. -->

**Future information leakage** is the most direct leakage path. It uses a value recorded after prediction time to train a model that will run earlier. StreamNest might accidentally include `last_watch_ts` from the full customer history. That field gives the model a strong hint because subscribers who cancel often stop watching before the label window ends.

The fix starts with source filters. Feature queries should limit source events to values at or before `score_week_start_ts`. The query should also create feature names that include the lookback window, because a name like `watch_minutes` hides the timing rule.

```sql
SELECT
  e.subscriber_id_hash,
  e.score_week_start_ts,
  SUM(w.watch_minutes) AS watch_minutes_14d_before_score
FROM ml_examples.churn_scoring_weeks e
LEFT JOIN warehouse.watch_events w
  ON w.subscriber_id_hash = e.subscriber_id_hash
  AND w.event_ts >= TIMESTAMP_SUB(e.score_week_start_ts, INTERVAL 14 DAY)
  AND w.event_ts < e.score_week_start_ts
GROUP BY e.subscriber_id_hash, e.score_week_start_ts;
```

The important rule is the upper bound on `w.event_ts`. The feature query only uses events before the scoring week starts. This same shape should appear in payments, support tickets, recommendations, and other time-windowed features.

## Target And Preprocessing Leakage
<!-- section-summary: Target leakage and preprocessing leakage let the label or evaluation data influence feature creation before training. -->

**Target leakage** happens when a feature directly or indirectly includes the answer. StreamNest could create `has_cancel_ticket_next_30d`, `retention_offer_sent`, or `refund_issued_after_cancel`. Those fields predict churn because they describe the churn process itself.

**Preprocessing leakage** happens when transformations learn from validation or test data before model review. For example, a scaler can compute means from the full dataset, or a target encoder can use labels from the validation month while building category statistics. The model may then receive information from rows that should have stayed outside training.

In Python, the safer pattern is to fit preprocessing on training rows and apply it to validation or test rows through a pipeline:

```python
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.linear_model import LogisticRegression

numeric_features = ["watch_minutes_14d_before_score", "failed_payment_count_30d_before_score", "tenure_days"]
categorical_features = ["plan_type", "primary_device_family"]

preprocess = ColumnTransformer(
    transformers=[
        ("num", Pipeline([("imputer", SimpleImputer()), ("scaler", StandardScaler())]), numeric_features),
        ("cat", OneHotEncoder(handle_unknown="ignore"), categorical_features),
    ]
)

model = Pipeline(
    steps=[
        ("preprocess", preprocess),
        ("classifier", LogisticRegression(max_iter=1000)),
    ]
)

model.fit(X_train, y_train)
validation_scores = model.predict_proba(X_validation)[:, 1]
```

The pipeline fits imputers, scalers, encoders, and the classifier during `model.fit(X_train, y_train)`. Validation data only flows through the already fitted transformation path. This pattern aligns with scikit-learn's guidance to avoid leakage during preprocessing.

![Safe preprocessing diagram showing scalers, imputers, and encoders fitted on train rows and then applied to validation and test rows, with fit-on-all-rows marked as leakage](/content-assets/articles/article-mlops-data-for-ml-systems-data-leakage-explained/train-only-preprocessing.png)

*Preprocessing stays leakage-safe when it learns statistics from training rows first, then applies those fitted steps to validation and test rows.*

## Entity Leakage Across Splits
<!-- section-summary: Entity leakage happens when the same real-world person, account, device, or item appears on both sides of a split in a way that inflates evaluation. -->

**Entity leakage** appears when the same real-world entity crosses split boundaries and gives the model an easy memory path. StreamNest scores subscribers weekly, so one subscriber can appear many times. If the team randomly splits weekly rows, the model may train on a subscriber in March and evaluate on the same subscriber in April.

Sometimes that design is acceptable because production also scores the same subscriber repeatedly. The danger comes when the evaluation question claims the model generalizes to new subscribers while the split contains repeated subscribers across train and test. The split should match the claim.

StreamNest can run an overlap check:

```sql
WITH train_entities AS (
  SELECT DISTINCT subscriber_id_hash
  FROM ml_curated.churn_examples
  WHERE split_name = 'train'
),
test_entities AS (
  SELECT DISTINCT subscriber_id_hash
  FROM ml_curated.churn_examples
  WHERE split_name = 'test'
)
SELECT
  COUNT(*) AS overlapping_subscribers
FROM train_entities tr
JOIN test_entities te
  USING (subscriber_id_hash);
```

If the release review targets all active subscribers, a time split with repeated entities can make sense. If the model supports a new-market launch with many new subscribers, the team may need an entity holdout or a separate new-subscriber test slice.

## Point-In-Time Joins
<!-- section-summary: Point-in-time joins attach historical feature values as they existed at each prediction timestamp. -->

A **point-in-time join** attaches feature values to examples as of each row's prediction timestamp. This is the core operation behind leakage-free training data for time-based models. The join should choose the latest valid feature record at or before the scoring timestamp, with freshness limits where needed.

For StreamNest, a subscriber plan feature may update whenever the user changes plans. The model should use the plan that was active on Monday morning, not the plan after cancellation. A point-in-time query can express that rule:

```sql
WITH ranked_plan AS (
  SELECT
    e.subscriber_id_hash,
    e.score_week_start_ts,
    p.plan_type,
    p.updated_ts,
    ROW_NUMBER() OVER (
      PARTITION BY e.subscriber_id_hash, e.score_week_start_ts
      ORDER BY p.updated_ts DESC
    ) AS plan_rank
  FROM ml_examples.churn_scoring_weeks e
  JOIN warehouse.subscriber_plan_history p
    ON p.subscriber_id_hash = e.subscriber_id_hash
    AND p.updated_ts <= e.score_week_start_ts
)
SELECT
  subscriber_id_hash,
  score_week_start_ts,
  plan_type
FROM ranked_plan
WHERE plan_rank = 1;
```

Feature-store systems such as Feast provide point-in-time retrieval so teams avoid rewriting this logic for every model. Even when a team writes SQL directly, the same principle applies: the feature value must represent what the model could have known at prediction time.

## Leakage Review Checklist
<!-- section-summary: A leakage review checks feature availability, label definitions, preprocessing, entity overlap, and suspicious metric jumps. -->

Leakage reviews should happen before model approval, especially when a new feature group creates a large score jump. The reviewer should ask for evidence, not reassurance. A short checklist helps the team make the review repeatable.

| Check | Evidence to request | StreamNest example |
|---|---|---|
| Prediction timestamp exists | Dataset column and contract | `score_week_start_ts` on every row |
| Feature availability rule exists | Feature definition file | All windows end before score time |
| Label query is separate from features | SQL review | `churned_next_30d` only appears as target |
| Preprocessing fits on train only | Pipeline code or test | Encoders and scalers fitted in training pipeline |
| Entity overlap is intentional | Overlap query and release claim | Weekly repeat subscribers reviewed explicitly |
| Metric jump has explanation | Diff report and feature review | New support-ticket feature checked for future tickets |

The team should also add a suspicious-feature report. Very high single-feature importance for a field with vague timing should trigger review. A model that suddenly reaches near-perfect validation performance usually deserves a data investigation before any release celebration.

## Habits That Prevent Leakage
<!-- section-summary: Leakage prevention improves when teams make prediction time, label windows, and train-only preprocessing normal review habits. -->

Leakage prevention is easier when it is part of the normal dataset workflow. StreamNest adds three habits to every training-data pull request. First, each example table must have a prediction timestamp. Second, the label query must state the future window it uses. Third, preprocessing code must show which rows are used for fitting encoders, imputers, and scalers.

Those habits make review concrete. Instead of asking whether the dataset "looks safe," a reviewer can inspect the timestamp, label window, and fit boundary. That keeps leakage from hiding inside a clever join or a convenient preprocessing helper.

## Putting It Together
<!-- section-summary: Leakage prevention protects the promise that model evaluation reflects the information production will actually have. -->

For StreamNest, leakage prevention means every feature has a time boundary, every target comes from a reviewed label query, preprocessing fits only on training rows, and entity overlap matches the release claim. These habits keep the model from learning future cancellation evidence that Monday morning scoring would never have.

This article closes the training-data basics submodule. The next group moves from defining datasets to validating and operating them, where checks enforce schema, missing-value, label, and skew rules before training or serving uses the data.

![Leakage review checklist with prediction timestamp, feature availability, label query, train-only preprocessing, entity overlap, review evidence, and trusted score](/content-assets/articles/article-mlops-data-for-ml-systems-data-leakage-explained/leakage-review-checklist.png)

*A leakage review asks for concrete evidence around time, labels, preprocessing, and entity overlap before the team trusts the model score.*

## References

- [scikit-learn common pitfalls: data leakage](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage)
- [Feast point-in-time joins documentation](https://docs.feast.dev/getting-started/concepts/point-in-time-joins)
- [TensorFlow Data Validation get started guide](https://www.tensorflow.org/tfx/data_validation/get_started)
- [dbt data tests documentation](https://docs.getdbt.com/docs/build/data-tests)
