---
title: "Online vs Offline"
description: "Explain feature timing, freshness, and consistency for different serving styles."
overview: "Offline features support training and batch work, while online features support low-latency serving. This article explains freshness, consistency, backfills, point-in-time joins, online reads, comparison tests, and incident runbooks."
tags: ["MLOps", "production", "features"]
order: 2
id: "article-mlops-data-for-ml-systems-online-vs-offline-features"
---

## Table of Contents

1. [Two Paths For The Same Feature](#two-paths-for-the-same-feature)
2. [The Feature Timing Map](#the-feature-timing-map)
3. [Offline Features](#offline-features)
4. [Online Features](#online-features)
5. [Point-In-Time Training Data](#point-in-time-training-data)
6. [Serving With The Same Feature Names](#serving-with-the-same-feature-names)
7. [Consistency Checks And Monitoring](#consistency-checks-and-monitoring)
8. [Incident Runbook](#incident-runbook)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## Two Paths For The Same Feature
<!-- section-summary: Online and offline features answer the same model question at different times, so the team needs one meaning and two delivery paths. -->

**Offline features** are feature values built from historical data for training, evaluation, backfills, batch scoring, and audits. **Online features** are feature values available during a live prediction request, usually from a low-latency store, cache, stream processor, or request payload. The short answer is this: offline features help you learn from the past, and online features help your model make a decision right now.

Use a food delivery ETA model as the running example. The product is called BentoNow. A customer opens the app, chooses a restaurant, and asks for an estimated delivery time before placing the order. The model needs the restaurant's recent prep speed, nearby courier availability, current distance, order volume, and maybe weather. The same ideas show up in fraud scoring, marketplace ranking, ad ranking, rideshare dispatch, and support routing. The exact columns change, while the timing problem stays the same.

During training, you have a warehouse table with millions of old orders. For each old order, you need the restaurant prep feature as it was known before that order was created. You also need the courier supply feature as it was known at that time. That is the offline path. During live serving, the API has one current order candidate and needs the latest feature values in a few milliseconds. That is the online path.

The important lesson is that online and offline describe **where and when the model receives feature values**. They do not describe two separate meanings. If `restaurant_avg_prep_minutes_30m` means one thing in training and a slightly different thing during serving, the model learns from one reality and serves in another. That gap is called **training-serving skew**, and it can make a good offline model behave strangely in production.

This article follows one spine: a live ETA problem needs features, the features have different timing needs, offline training needs historical correctness, online serving needs fresh low-latency reads, and production teams compare the two paths with tests, logs, and runbooks.

![Online and offline delivery paths sharing one feature contract and the same feature names](/content-assets/articles/article-mlops-data-for-ml-systems-online-vs-offline-features/online-offline-delivery-paths.png)

*Online and offline paths can use different storage and timing, but the feature contract keeps the meaning and names aligned.*

## The Feature Timing Map
<!-- section-summary: The feature timing map names each feature, its owner, where it is computed, where it is stored, and how fresh it must be. -->

Before writing SQL or adding a feature store, the team should write down what each feature means. This sounds small, yet it saves a lot of debugging later. A model feature is an input column used by the model, and a production feature also needs an owner, an entity key, an event time, a freshness target, and a fallback plan.

For BentoNow, the ETA model uses both slow historical signals and fast request-time signals. Restaurant prep time changes throughout the day, courier supply changes minute by minute, and the straight-line distance from courier to restaurant comes from the current dispatch request. Those signals belong together in one model, yet they arrive through different systems.

| Feature | Entity key | Offline source | Online source | Freshness target | Owner |
|---|---|---|---|---|---|
| `restaurant_avg_prep_minutes_30m` | `restaurant_id` | Warehouse order events | Redis or feature online store | Under 5 minutes | Delivery data team |
| `restaurant_late_order_rate_7d` | `restaurant_id` | Warehouse order outcomes | Daily materialized value | Under 24 hours | Delivery data team |
| `zone_open_couriers_5m` | `zone_id` | Courier status history | Stream processor output | Under 60 seconds | Dispatch platform |
| `route_distance_meters` | `order_id` | Batch route snapshots for replay | Request payload | Request time | ETA service |
| `is_heavy_rain` | `zone_id` | Weather history table | Weather API cache | Under 10 minutes | Platform data |

This table tells you which features need an online store and which can stay offline. `restaurant_late_order_rate_7d` changes slowly enough for a daily materialization job. `zone_open_couriers_5m` needs recent courier status, so it needs a streaming or frequent update path. `route_distance_meters` may come straight from the request because it depends on the current order candidate.

The table also forces a decision about **entity keys**. An entity key is the identifier used to fetch a feature value, like `restaurant_id` or `zone_id`. If training uses `store_id` and serving uses `restaurant_uuid`, you need a reliable mapping. If a feature has no stable key, the online path will struggle because the serving service has no clear lookup value.

## Offline Features
<!-- section-summary: Offline features build correct historical examples for training, evaluation, batch scoring, and audits. -->

An offline feature pipeline usually runs in a warehouse, lakehouse, or batch compute system. It can scan large tables, join labels, recompute old windows, and support backfills. Backfill means recomputing historical feature values for older time ranges, often after a bug fix or a new feature definition.

For BentoNow, the offline data lives in tables like these:

| Table | Grain | Important fields |
|---|---|---|
| `orders` | One row per order | `order_id`, `restaurant_id`, `zone_id`, `created_at`, `delivered_at` |
| `restaurant_events` | One row per restaurant event | `restaurant_id`, `event_timestamp`, `prep_minutes`, `cancelled` |
| `courier_status_events` | One row per courier status change | `courier_id`, `zone_id`, `event_timestamp`, `status` |
| `weather_snapshots` | One row per zone per sample | `zone_id`, `event_timestamp`, `rain_mm_hour` |

The offline job can compute windows over these tables. The model label might be `actual_delivery_minutes`, calculated after the order finishes. The features must come from data available before the order was created. That time boundary matters because the model should train on the same evidence it would have had during live prediction.

Here is a simplified SQL query for one offline feature. It calculates the average restaurant prep time from the 30 minutes before each order.

```sql
WITH training_orders AS (
  SELECT
    order_id,
    restaurant_id,
    zone_id,
    created_at,
    TIMESTAMP_DIFF(delivered_at, created_at, MINUTE) AS actual_delivery_minutes
  FROM analytics.orders
  WHERE created_at >= TIMESTAMP '2026-06-01 00:00:00 UTC'
    AND created_at < TIMESTAMP '2026-07-01 00:00:00 UTC'
    AND delivered_at IS NOT NULL
),
restaurant_prep AS (
  SELECT
    o.order_id,
    AVG(e.prep_minutes) AS restaurant_avg_prep_minutes_30m
  FROM training_orders o
  LEFT JOIN analytics.restaurant_events e
    ON e.restaurant_id = o.restaurant_id
   AND e.event_timestamp < o.created_at
   AND e.event_timestamp >= TIMESTAMP_SUB(o.created_at, INTERVAL 30 MINUTE)
  GROUP BY o.order_id
)
SELECT
  o.order_id,
  o.restaurant_id,
  o.zone_id,
  o.created_at AS event_timestamp,
  o.actual_delivery_minutes,
  COALESCE(p.restaurant_avg_prep_minutes_30m, 18.0) AS restaurant_avg_prep_minutes_30m
FROM training_orders o
LEFT JOIN restaurant_prep p
  USING (order_id);
```

The important part is the time filter on `restaurant_events`. The join uses events before `created_at` and inside the 30 minute window. If the query accidentally includes prep events after the order was created, the model sees future information during training. Offline metrics may look great, and the live model will miss that future information during real requests.

Offline jobs also give you room for audits. If the ETA model failed badly on July 2, you can rebuild the feature vector for the bad orders and inspect the values. A live cache usually cannot answer that question because it keeps only the latest value for each entity.

## Online Features
<!-- section-summary: Online features give the serving service fresh feature values fast enough for live prediction. -->

Online features sit on the request path. When a customer opens the checkout screen, the ETA service may have 50 milliseconds for all feature retrieval and model inference before the product starts to feel slow. The online path therefore cares about latency, availability, freshness, and fallback behavior.

An **online store** usually stores the latest feature value for each entity key. Feast's documentation describes online stores as low-latency stores, and its online store keeps the current feature values for entity keys rather than full history. Amazon SageMaker Feature Store uses a similar split: an online store for real-time inference and an offline store for historical training and batch inference.

Here is a small serving contract for the BentoNow ETA service:

```yaml
eta_feature_contract:
  model_name: delivery_eta_minutes
  model_version: eta-2026-07-05
  p95_feature_read_ms: 15
  fail_open_features:
    restaurant_late_order_rate_7d: 0.08
  fail_closed_features:
    zone_open_couriers_5m: route_to_rules_eta
  max_feature_age:
    restaurant_avg_prep_minutes_30m: 300
    zone_open_couriers_5m: 60
    is_heavy_rain: 600
  log_fields:
    - request_id
    - model_version
    - feature_vector_hash
    - feature_age_seconds
    - fallback_used
```

The contract tells the serving team what "fresh enough" means. Some missing features can use a safe default, such as a historical late-order rate. Other features need a stronger fallback. If `zone_open_couriers_5m` is stale, the ETA model may give a dangerously optimistic estimate, so the service routes to a rules-based ETA path until the feature recovers.

The online read usually happens in application code. In Feast, a Python service can call `get_online_features` with feature references or a feature service. This example reads the latest restaurant and zone features for one request.

```python
from feast import FeatureStore

store = FeatureStore(repo_path="/srv/eta_feature_repo")

features = store.get_online_features(
    features=[
        "restaurant_delivery_stats:restaurant_avg_prep_minutes_30m",
        "restaurant_delivery_stats:restaurant_late_order_rate_7d",
        "zone_dispatch_stats:zone_open_couriers_5m",
        "zone_weather_stats:is_heavy_rain",
    ],
    entity_rows=[
        {
            "restaurant_id": 8471,
            "zone_id": 42,
        }
    ],
).to_dict()

feature_vector = {
    "restaurant_avg_prep_minutes_30m": features["restaurant_avg_prep_minutes_30m"][0],
    "restaurant_late_order_rate_7d": features["restaurant_late_order_rate_7d"][0],
    "zone_open_couriers_5m": features["zone_open_couriers_5m"][0],
    "is_heavy_rain": features["is_heavy_rain"][0],
    "route_distance_meters": 3200,
}
```

The request includes `restaurant_id` and `zone_id` because those keys identify the latest values in the online store. The route distance stays outside the feature store in this example because the routing service computes it for the current order candidate. A real service would also validate types, feature ages, nulls, and fallback flags before calling the model.

## Point-In-Time Training Data
<!-- section-summary: Point-in-time joins protect training data from future information and make offline examples resemble live requests. -->

Point-in-time correctness means each training row receives feature values available at that row's event time. This concept matters because labels arrive later. For an ETA model, the label `actual_delivery_minutes` is known after delivery, while the prediction happened before delivery. Training can include the label because that is the target. Training should keep future feature values away from the input columns.

Feature retrieval tools exist partly because point-in-time joins are easy to get wrong by hand. Feast uses event timestamps during historical retrieval so it can join the right historical values onto entity rows. The entity dataframe contains the entity key and the event timestamp, and the feature store retrieves feature values as of that timestamp.

Here is the shape of an entity dataframe for BentoNow training:

```python
from datetime import datetime
import pandas as pd
from feast import FeatureStore

entity_df = pd.DataFrame.from_dict(
    {
        "restaurant_id": [8471, 9912, 8471],
        "zone_id": [42, 17, 42],
        "event_timestamp": [
            datetime(2026, 6, 11, 18, 3, 0),
            datetime(2026, 6, 11, 18, 8, 0),
            datetime(2026, 6, 11, 18, 14, 0),
        ],
        "actual_delivery_minutes": [38, 31, 44],
    }
)

store = FeatureStore(repo_path="/srv/eta_feature_repo")

training_df = store.get_historical_features(
    entity_df=entity_df,
    features=[
        "restaurant_delivery_stats:restaurant_avg_prep_minutes_30m",
        "restaurant_delivery_stats:restaurant_late_order_rate_7d",
        "zone_dispatch_stats:zone_open_couriers_5m",
        "zone_weather_stats:is_heavy_rain",
    ],
).to_df()
```

The `event_timestamp` column is the anchor. The feature references tell the feature store which values to join. The label column passes through so the training code can train a supervised model after the feature join finishes. If you later compare offline and online values, use the same feature names and entity keys so the comparison is straightforward.

The same idea applies without Feast. A warehouse-only team can still write point-in-time SQL, keep feature definitions in version control, and log the exact query version used for a training dataset. The tool helps, yet the rule stays the same: use the feature value that would have existed at prediction time.

![Point-in-time join selecting the latest valid feature row before prediction time and blocking a future row](/content-assets/articles/article-mlops-data-for-ml-systems-online-vs-offline-features/point-in-time-join.png)

*A point-in-time join chooses the latest valid feature value before prediction time and blocks future rows that would leak information into training.*

## Serving With The Same Feature Names
<!-- section-summary: Shared feature names, schemas, owners, and freshness rules help the model see the same meaning in training and serving. -->

The next production problem is naming. If training data uses `restaurant_avg_prep_minutes_30m` and serving code sends `avg_prep`, people have to remember that those columns are intended to match. That memory will fail during a refactor, a model upgrade, or an incident. Shared names and schemas remove guesswork.

A simple feature definition can live in a feature repository. This example uses Feast-style objects and a local file source for readability. In production, the source might point to BigQuery, Snowflake, Redshift, Spark, or another supported store. The important part for the learner is the structure: entity, timestamped source, schema, TTL, and feature service.

```python
from datetime import timedelta

from feast import Entity, FeatureService, FeatureView, Field, FileSource, Project
from feast.types import Bool, Float32, Int64

project = Project(
    name="bentonow_eta",
    description="Delivery ETA features for training and serving",
)

restaurant = Entity(name="restaurant", join_keys=["restaurant_id"])
zone = Entity(name="zone", join_keys=["zone_id"])

restaurant_source = FileSource(
    name="restaurant_delivery_stats_source",
    path="data/restaurant_delivery_stats.parquet",
    timestamp_field="event_timestamp",
    created_timestamp_column="created_at",
)

zone_source = FileSource(
    name="zone_dispatch_stats_source",
    path="data/zone_dispatch_stats.parquet",
    timestamp_field="event_timestamp",
    created_timestamp_column="created_at",
)

restaurant_delivery_stats = FeatureView(
    name="restaurant_delivery_stats",
    entities=[restaurant],
    ttl=timedelta(hours=24),
    schema=[
        Field(name="restaurant_avg_prep_minutes_30m", dtype=Float32),
        Field(name="restaurant_late_order_rate_7d", dtype=Float32),
    ],
    online=True,
    source=restaurant_source,
    tags={"owner": "delivery-data"},
)

zone_dispatch_stats = FeatureView(
    name="zone_dispatch_stats",
    entities=[zone],
    ttl=timedelta(minutes=10),
    schema=[
        Field(name="zone_open_couriers_5m", dtype=Int64),
        Field(name="is_heavy_rain", dtype=Bool),
    ],
    online=True,
    source=zone_source,
    tags={"owner": "dispatch-platform"},
)

eta_model_v1 = FeatureService(
    name="delivery_eta_minutes_v1",
    features=[restaurant_delivery_stats, zone_dispatch_stats],
)
```

The `FeatureService` groups the features used by one model version. That grouping helps when the model moves from training to serving because the same group can guide historical retrieval and online retrieval. It also gives reviewers a list of dependencies to inspect before release.

Operationally, the team applies definitions and loads feature values into the online store:

```bash
feast apply
CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S")
feast materialize-incremental "$CURRENT_TIME"
```

`feast apply` registers the entity, feature view, and feature service definitions. The materialization command moves recent feature values into the online store so serving can fetch them quickly. In a larger system, a scheduler such as Airflow, Dagster, or a managed workflow service would run materialization on a defined cadence, and a streaming path might push high-frequency features.

## Consistency Checks And Monitoring
<!-- section-summary: Teams compare logged online features with offline recomputation to catch skew, stale features, missing values, and bad defaults. -->

Once the model serves traffic, the team needs evidence that online and offline paths still agree. The best raw material is a prediction log. The serving service should log the request ID, model version, entity keys, feature names, feature values or safe summaries, feature ages, fallback flags, prediction, and final business outcome when it arrives.

Here is a prediction log schema that supports comparison without forcing the team to store sensitive raw payloads forever:

```sql
CREATE TABLE ml_observability.eta_prediction_logs (
  request_id STRING,
  order_id STRING,
  restaurant_id INT64,
  zone_id INT64,
  model_version STRING,
  predicted_eta_minutes FLOAT64,
  feature_vector_hash STRING,
  feature_values_json STRING,
  feature_age_seconds_json STRING,
  fallback_used BOOL,
  requested_at TIMESTAMP,
  created_at TIMESTAMP
);
```

The comparison job samples prediction logs, recomputes point-in-time offline features for those same entity keys and timestamps, and checks whether the values match within a tolerance. Some features should match exactly, such as a daily categorical flag. Others need numeric tolerance because streaming windows and batch windows can close at slightly different times.

```sql
WITH sampled_requests AS (
  SELECT
    request_id,
    restaurant_id,
    zone_id,
    requested_at,
    JSON_VALUE(feature_values_json, '$.restaurant_avg_prep_minutes_30m') AS online_prep_30m
  FROM ml_observability.eta_prediction_logs
  WHERE requested_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
    AND model_version = 'eta-2026-07-05'
    AND RAND() < 0.01
),
offline_recomputed AS (
  SELECT
    s.request_id,
    AVG(e.prep_minutes) AS offline_prep_30m
  FROM sampled_requests s
  LEFT JOIN analytics.restaurant_events e
    ON e.restaurant_id = s.restaurant_id
   AND e.event_timestamp < s.requested_at
   AND e.event_timestamp >= TIMESTAMP_SUB(s.requested_at, INTERVAL 30 MINUTE)
  GROUP BY s.request_id
)
SELECT
  COUNT(*) AS sampled_rows,
  AVG(ABS(CAST(s.online_prep_30m AS FLOAT64) - o.offline_prep_30m)) AS mean_abs_diff,
  AVG(
    CASE
      WHEN ABS(CAST(s.online_prep_30m AS FLOAT64) - o.offline_prep_30m) > 2.0 THEN 1
      ELSE 0
    END
  ) AS mismatch_rate
FROM sampled_requests s
JOIN offline_recomputed o
  USING (request_id);
```

A healthy comparison job should have a known tolerance and an owner. For BentoNow, a mismatch rate over 1 percent for `restaurant_avg_prep_minutes_30m` pages the delivery data team during business hours. A stale `zone_open_couriers_5m` feature pages the dispatch platform immediately because it affects live ETA quality quickly.

Teams should monitor these checks:

| Check | Example threshold | Owner response |
|---|---|---|
| Online read latency | p95 under 15 ms | Scale online store or cache hot keys |
| Feature freshness | `zone_open_couriers_5m` under 60 seconds | Inspect stream consumer lag |
| Missing feature rate | Under 0.5 percent per feature | Check materialization and entity keys |
| Offline-online mismatch | Under 1 percent for sampled requests | Compare feature definitions and windows |
| Fallback rate | Under 2 percent per hour | Inspect upstream source health |

These checks connect engineering systems to model behavior. A model metric drop may come from the model itself, a source table change, a stale materialization job, an online store incident, or a serving code mapping bug. Feature monitoring narrows the search.

## Incident Runbook
<!-- section-summary: A feature incident runbook tells the team how to detect, contain, diagnose, repair, and learn from online-offline feature failures. -->

Feature incidents are common because they involve several systems. A restaurant events table may change schema, a stream processor may lag, a materialization job may skip a partition, or a serving service may send the wrong entity key. A beginner should know what real teams do after an alert fires.

Here is a practical runbook for BentoNow's ETA feature path:

| Step | Action | Owner | Evidence |
|---|---|---|---|
| Detect | Alert fires on freshness, mismatch, missing rate, or fallback rate | On-call MLOps engineer | Dashboard link and alert payload |
| Contain | Route high-risk requests to rules ETA when required features are stale | ETA service owner | Feature flag change and traffic graph |
| Diagnose | Check latest materialization job, stream lag, online store latency, and schema changes | Data platform owner | Job logs, stream offsets, query history |
| Repair | Rerun materialization, roll back feature definition, restore stream consumer, or patch mapping | Owning team | Command output and validation query |
| Verify | Re-run online read probes and offline-online comparison sample | MLOps engineer | Freshness and mismatch report |
| Follow up | Add a test, alert, or contract check that would have caught the failure earlier | Incident lead | Post-incident action item |

The containment step deserves special attention. If the model needs a fresh courier supply feature and that feature is stale, the service should already know what to do. The team should avoid debating fallback behavior during the outage. A feature contract should say whether the model can use a default, reuse a cached value, call a backup path, or skip ML for that request.

Here is a small feature health probe the serving team can run from a scheduled job:

```python
from datetime import datetime, timezone
from feast import FeatureStore

store = FeatureStore(repo_path="/srv/eta_feature_repo")

probe = store.get_online_features(
    features=[
        "zone_dispatch_stats:zone_open_couriers_5m",
        "restaurant_delivery_stats:restaurant_avg_prep_minutes_30m",
    ],
    entity_rows=[
        {
            "zone_id": 42,
            "restaurant_id": 8471,
        }
    ],
).to_dict()

checked_at = datetime.now(timezone.utc).isoformat()

print(
    {
        "checked_at": checked_at,
        "zone_open_couriers_5m": probe["zone_open_couriers_5m"][0],
        "restaurant_avg_prep_minutes_30m": probe["restaurant_avg_prep_minutes_30m"][0],
    }
)
```

This probe proves that the online store can return expected feature names for known entities. It should sit next to dashboard checks for freshness and read latency because a successful read with stale data is still a serving risk.

![Freshness and parity runbook connecting prediction logs, offline recomputation, mismatch rate, freshness age, fallback rate, alert owner, contain, repair, and verify](/content-assets/articles/article-mlops-data-for-ml-systems-online-vs-offline-features/freshness-parity-runbook.png)

*Feature monitoring should connect evidence to action: logs feed recomputation, dashboards show freshness and parity, and the runbook names who contains, repairs, and verifies the issue.*

## Putting It Together
<!-- section-summary: Offline features give historical correctness, online features give live freshness, and comparison checks keep the two paths aligned. -->

Online and offline features are two delivery paths for model inputs. Offline features build training datasets, support evaluation, power batch scoring, and help audits. Online features serve live requests with low latency and freshness expectations. A production model can use both paths safely when the team keeps one shared feature meaning across both.

For BentoNow, the ETA model trains on historical restaurant, courier, route, and weather signals. During live serving, the ETA service reads the latest restaurant and zone features, adds request-time route distance, validates freshness, and calls the model. Prediction logs then let the team compare online values with offline recomputation.

The daily discipline is practical: define features with entity keys and timestamps, build point-in-time training data, materialize online values on a known cadence, log served feature values safely, monitor freshness and mismatch rates, and keep a runbook for failures. That is the difference between a model that only works in a notebook and a feature path the product can depend on.

## References

- [Feast documentation: Introduction](https://docs.feast.dev/) - Defines Feast as a feature store with offline and online stores, point-in-time feature sets, and low-latency serving.
- [Feast documentation: Offline store](https://docs.feast.dev/getting-started/components/offline-store) - Explains offline stores for historical time-series feature values and materialization into online stores.
- [Feast documentation: Online store](https://docs.feast.dev/getting-started/components/online-store) - Explains low-latency online stores and latest-value serving by entity key.
- [Feast documentation: Feature retrieval](https://docs.feast.dev/getting-started/concepts/feature-retrieval) - Documents event timestamps, entity dataframes, `get_historical_features`, feature services, and online retrieval.
- [Feast documentation: Load data into the online store](https://docs.feast.dev/how-to-guides/feast-snowflake-gcp-aws/load-data-into-the-online-store) - Shows materialization commands for loading feature values into an online store.
- [Feast documentation: Read features from the online store](https://docs.feast.dev/how-to-guides/feast-snowflake-gcp-aws/read-features-from-the-online-store) - Shows `get_online_features` for low-latency model serving.
- [Amazon SageMaker AI Feature Store documentation](https://docs.aws.amazon.com/sagemaker/latest/dg/feature-store.html) - Documents online and offline feature storage patterns, real-time inference, and offline model training support.
