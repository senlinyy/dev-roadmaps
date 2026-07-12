---
title: "Candidate vs Production"
description: "Compare a candidate model with the current production model using frozen evaluation data, shadow traffic, segment tables, registry evidence, and release decisions."
overview: "A candidate-vs-production review asks whether a new model version should replace the version serving users today. This tutorial follows a delivery ETA model through a comparison packet, MLflow registry aliases, regression metrics, segment risk, shadow traffic, and a decision table."
tags: ["MLOps", "production", "approval"]
order: 1
id: "article-mlops-model-evaluation-candidate-vs-production-model"
---

## Table of Contents

1. [A Candidate Must Beat The Model Users Already Have](#a-candidate-must-beat-the-model-users-already-have)
2. [Follow One Delivery ETA Review](#follow-one-delivery-eta-review)
3. [Create The Comparison Packet](#create-the-comparison-packet)
4. [Score Both Models On The Same Data](#score-both-models-on-the-same-data)
5. [Compare Segments And Product Harm](#compare-segments-and-product-harm)
6. [Use Registry Aliases For The Handoff](#use-registry-aliases-for-the-handoff)
7. [Make The Release Decision](#make-the-release-decision)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## A Candidate Must Beat The Model Users Already Have
<!-- section-summary: A candidate-vs-production review compares a new model against the current serving model with the same evidence, same thresholds, and same product risk lens. -->

A **candidate model** is the new model version asking for release. The **production model** is the version currently serving users. A candidate-vs-production review asks a plain question: **does the candidate improve the product enough, and safely enough, to replace the production model?**

That sounds simple, but teams often get this wrong. A candidate can win on one headline metric and still create worse customer behavior in a key segment. It can improve the average prediction error while making rainy-day estimates worse. It can pass offline evaluation while adding latency that hurts the API. The review has to compare the two models on the same data, same metrics, same traffic slices, and same release rules.

You just saw robustness testing before release. That article shook the candidate with messy inputs. This release-decision article takes the next step. It shows how the team packages evidence so a reviewer can say yes, no, or limited rollout with a clear reason.

## Follow One Delivery ETA Review
<!-- section-summary: The running scenario uses a grocery delivery ETA model where average error, late underestimation, weather, zones, and shadow traffic all affect release. -->

Imagine **CityCart**, a grocery delivery company. When a customer places an order, the app shows an estimated delivery time. The current production model is `delivery_eta:v42`. The candidate is `delivery_eta:v43`.

The model predicts `eta_minutes`, the number of minutes from order confirmation to delivery. The product team cares about average accuracy, yet one error hurts more than another. If the app says 25 minutes and the order arrives in 42 minutes, the customer waits far longer than promised. CityCart calls that a **late underestimation**. It is a prediction that is too optimistic by more than 10 minutes.

The candidate was trained with fresher courier assignment features and a new weather feature. The training team is excited because offline mean absolute error improved. Mean absolute error, or MAE, is the average absolute difference between predicted and actual values. For ETA, an MAE of 6 means predictions miss by 6 minutes on average.

The release team still needs a full comparison:

| Evidence | Why reviewers need it |
|---|---|
| Frozen holdout results | Shows both models on the same labeled orders |
| Segment metrics | Finds weak zones, weather conditions, stores, and courier types |
| Shadow traffic | Shows how the candidate behaves on current production requests |
| Latency and failure rate | Confirms the model can serve within API limits |
| Rollback path | Explains how to return to the current production model |
| Owner approvals | Shows who accepted product, ML, operations, and risk tradeoffs |

The important habit is fairness between the two versions. The candidate and production model need the same test, same labels, same threshold rules, and same product definitions.

## Create The Comparison Packet
<!-- section-summary: A comparison packet records model versions, datasets, metrics, segment rules, serving constraints, and the final recommendation in one reviewable artifact. -->

A **comparison packet** is the release artifact that lets reviewers inspect the candidate beside production. It can be a model card section, a markdown report, an MLflow artifact, a dashboard snapshot, or all of those together. The format matters less than the contents and repeatability.

CityCart writes the packet header like this:

```yaml
comparison_packet:
  product: citycart_delivery_eta
  registered_model: citycart.delivery_eta
  production_version: v42
  candidate_version: v43
  production_alias: champion
  evaluation_dataset: delivery_eta_holdout_2026_06
  shadow_dataset: delivery_eta_shadow_2026_07_01_to_2026_07_07
  primary_metric: mean_absolute_error_minutes
  guardrail_metrics:
    - p90_absolute_error_minutes
    - late_underestimation_rate
    - api_p95_latency_ms
    - prediction_error_rate
  blocking_segments:
    - city_zone
    - weather_condition
    - store_type
    - courier_mode
  recommendation_owner: delivery-ml-platform
```

This packet avoids a common release problem: people arguing about which score matters after the result arrives. The release criteria are written before the candidate review, and every candidate uses the same comparison shape.

CityCart also stores a compact decision table in the packet:

| Area | Production v42 | Candidate v43 | Release rule | Status |
|---|---:|---:|---|---|
| MAE | 6.8 min | 6.1 min | Candidate improves by at least 0.3 min | Pass |
| P90 absolute error | 15.4 min | 14.8 min | Candidate improves or stays within 0.2 min | Pass |
| Late underestimation | 8.7% | 8.2% | Candidate stays below 8.5% | Pass |
| Rain late underestimation | 11.8% | 13.1% | Candidate stays below 12.0% | Block |
| API p95 latency | 42 ms | 58 ms | Candidate stays below 75 ms | Pass |

![CityCart ETA comparison packet showing v43 and v42 through holdout data, shared metrics, segment review, shadow traffic, and release decision](/content-assets/articles/article-mlops-model-evaluation-candidate-vs-production-model/citycart-eta-review-v43-vs-v42.png)

*The comparison packet keeps the candidate and production model in the same review path, so the rain blocker is visible before the team changes the champion alias.*

The headline result is strong, yet rain behavior blocks full rollout. That is exactly why the packet exists. It lets a reviewer see the product risk instead of only the average improvement.

## Score Both Models On The Same Data
<!-- section-summary: The production and candidate models should run against the same frozen rows so metric differences come from model behavior rather than data movement. -->

A frozen evaluation dataset is a labeled dataset that stays fixed for a release comparison. CityCart uses `delivery_eta_holdout_2026_06`, which contains completed orders, actual delivery times, weather labels, store data, courier mode, zone, and timestamp. Both models score the same feature rows.

The scoring script writes one row per order and model:

```python
import pandas as pd
from sklearn.metrics import mean_absolute_error

holdout = pd.read_parquet("delivery_eta_holdout_2026_06.parquet")

def score_model(model, model_version: str) -> pd.DataFrame:
    feature_cols = [
        "basket_size",
        "store_queue_depth",
        "courier_distance_km",
        "weather_condition",
        "city_zone",
        "hour_of_day",
    ]
    predictions = model.predict(holdout[feature_cols])
    return pd.DataFrame({
        "order_id": holdout["order_id"],
        "model_version": model_version,
        "actual_eta_minutes": holdout["actual_eta_minutes"],
        "predicted_eta_minutes": predictions,
        "weather_condition": holdout["weather_condition"],
        "city_zone": holdout["city_zone"],
        "store_type": holdout["store_type"],
        "courier_mode": holdout["courier_mode"],
    })

production_scores = score_model(production_model, "v42")
candidate_scores = score_model(candidate_model, "v43")
scores = pd.concat([production_scores, candidate_scores], ignore_index=True)

summary = (
    scores.assign(
        abs_error=lambda df: (df["actual_eta_minutes"] - df["predicted_eta_minutes"]).abs(),
        late_underestimate=lambda df: (df["actual_eta_minutes"] - df["predicted_eta_minutes"]) > 10,
    )
    .groupby("model_version")
    .agg(
        mae=("abs_error", "mean"),
        p90_abs_error=("abs_error", lambda s: s.quantile(0.90)),
        late_underestimation_rate=("late_underestimate", "mean"),
    )
)
```

Scikit-learn provides `mean_absolute_error` for regression error, and its model evaluation guide covers common regression metrics. CityCart still computes the product-specific late-underestimation rate directly because scikit-learn cannot know which error direction hurts this delivery promise.

That last point matters. Official metrics give the team reliable building blocks. Product metrics connect those blocks to the real user experience.

## Compare Segments And Product Harm
<!-- section-summary: A candidate should beat production in the segments that matter to users, operations, and known release risk. -->

The overall summary says v43 improves. The segment report says where the improvement lands:

| Segment | Production late underestimation | Candidate late underestimation | Delta | Gate |
|---|---:|---:|---:|---|
| All orders | 8.7% | 8.2% | -0.5 pp | Pass |
| Clear weather | 7.1% | 6.4% | -0.7 pp | Pass |
| Rain | 11.8% | 13.1% | +1.3 pp | Block |
| Dense downtown | 9.2% | 8.8% | -0.4 pp | Pass |
| Outer zone | 10.9% | 11.6% | +0.7 pp | Review |
| Bicycle courier | 12.2% | 12.6% | +0.4 pp | Review |

![CityCart segment risk panel comparing all-order MAE improvement with clear weather, rain, and outer-zone release gates](/content-assets/articles/article-mlops-model-evaluation-candidate-vs-production-model/citycart-average-win-segment-risk.png)

*The average ETA score improves, while the rain segment still creates a customer promise risk that reviewers need to block or scope.*

The candidate learned from fresher data, yet the new weather feature appears weak during rain. Maybe the training data has too few rain examples. Maybe the weather join uses hourly observations and misses sudden storms. Maybe bicycle couriers slow down more than the model expects.

The team adds a warehouse query so the report can be recreated:

```sql
SELECT
  model_version,
  weather_condition,
  COUNT(*) AS orders,
  AVG(ABS(actual_eta_minutes - predicted_eta_minutes)) AS mae_minutes,
  APPROX_QUANTILES(ABS(actual_eta_minutes - predicted_eta_minutes), 100)[OFFSET(90)] AS p90_abs_error_minutes,
  AVG(CASE WHEN actual_eta_minutes - predicted_eta_minutes > 10 THEN 1 ELSE 0 END) AS late_underestimation_rate
FROM ml_eval.delivery_eta_comparison
WHERE evaluation_dataset = 'delivery_eta_holdout_2026_06'
GROUP BY model_version, weather_condition
ORDER BY weather_condition, model_version;
```

The product harm is specific. A rainy delivery estimate that is too optimistic can increase support contacts, refunds, and courier pressure. The candidate needs a scoped release or more weather work before it takes the main alias.

## Use Registry Aliases For The Handoff
<!-- section-summary: Registry aliases let serving systems target a named production reference while the release team changes which model version that reference points to. -->

A **model registry** stores registered models, versions, metadata, and release labels. MLflow Model Registry supports versions, tags, descriptions, and aliases. An **alias** is a mutable name that points to a specific model version. A common pattern is a `champion` alias for the model version serving the main production path.

CityCart uses the model URI `models:/citycart.delivery_eta@champion` in the serving config. During this review, `champion` still points to v42. If v43 earns release, the platform team can move the alias to v43 after approval. If v43 only earns a canary, the team can create a separate `canary` alias and route a small traffic slice there.

The candidate gets tags before approval:

```python
from mlflow import MlflowClient

client = MlflowClient()
model_name = "citycart.delivery_eta"
candidate_version = "43"

client.set_model_version_tag(model_name, candidate_version, "comparison_status", "rain_blocked")
client.set_model_version_tag(model_name, candidate_version, "comparison_packet", "runs:/8a1f.../comparison_packet.yaml")
client.set_model_version_tag(model_name, candidate_version, "approved_scope", "shadow_only")
```

If the rain blocker is fixed in v44, the approval step can move an alias:

```python
client.set_registered_model_alias("citycart.delivery_eta", "champion", "44")
```

This is cleaner than editing service code to point at a raw version every time. The service keeps reading `@champion`, while the release process controls which reviewed version owns that alias.

## Make The Release Decision
<!-- section-summary: The final decision should name the winning evidence, failed evidence, allowed scope, rollback path, and owners. -->

CityCart has three possible decisions:

| Decision | When it fits | What happens |
|---|---|---|
| Full release | Candidate passes overall, segment, shadow, latency, and rollback checks | Move `champion` alias after approval |
| Scoped release | Candidate helps a safe slice and fails a risky slice | Use canary or feature flag for approved traffic only |
| Hold release | Candidate fails a blocking metric or lacks evidence | Keep production model and require a new packet |

For v43, the decision is hold full release and allow shadow-only testing:

```yaml
release_decision:
  registered_model: citycart.delivery_eta
  production_version: v42
  candidate_version: v43
  decision: hold_full_release
  reason:
    - rain late underestimation increased from 11.8 percent to 13.1 percent
    - outer-zone delivery estimates need reviewer inspection
  allowed_next_step:
    - shadow traffic for all zones
    - offline retraining with enriched rain examples
  production_alias:
    champion: v42
  rollback_plan:
    serving_config: models:/citycart.delivery_eta@champion
    rollback_action: keep champion alias on v42
  next_review:
    owner: delivery-ml-platform
  required_candidate: v44
```

![CityCart release decision map with full release, scoped release, and hold release outcomes tied to evidence](/content-assets/articles/article-mlops-model-evaluation-candidate-vs-production-model/citycart-release-decision-map.png)

*The decision map turns the review packet into one of three actions: move the main alias, scope the rollout, or hold the release with named evidence.*

The decision respects the evidence. The candidate improves average ETA accuracy, yet the rain segment creates enough customer risk to hold the main alias. The team can still learn from shadow traffic while v42 keeps serving users.

## Putting It Together
<!-- section-summary: Candidate-vs-production review compares versions with shared data, shared metrics, segment evidence, registry metadata, and an explicit release choice. -->

A candidate-vs-production review asks whether a new model should replace the model users already have. Build a comparison packet, score both versions on the same frozen data, inspect product segments, add shadow and latency evidence, attach the result to the registry, and make a decision that names the allowed rollout scope.

For CityCart, v43 beats v42 on average ETA error, yet it performs worse during rain. The team keeps `champion` on v42, records the blocker on v43, and sends the next training run toward a concrete fix.

## References

- [scikit-learn regression metrics](https://scikit-learn.org/stable/modules/model_evaluation.html#regression-metrics) - Official scikit-learn guide for regression metrics such as mean absolute error.
- [scikit-learn mean_absolute_error](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.mean_absolute_error.html) - Official API reference for MAE.
- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/) - Official registry concepts for registered models, model versions, aliases, tags, and descriptions.
- [MLflow Model Registry workflows](https://mlflow.org/docs/latest/ml/model-registry/workflow/) - Official workflow guide for aliases, tags, model version organization, and deployment handoff.
