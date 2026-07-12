---
title: "Feature Stores"
description: "Teach what feature stores solve and when they add more complexity than value."
overview: "A feature store helps teams define, reuse, store, and serve ML features across training and inference. This article explains what feature stores solve, what they add, and when a simpler setup may be enough."
tags: ["MLOps", "production", "features"]
order: 3
id: "article-mlops-data-for-ml-systems-feature-stores-explained"
---

## Table of Contents

1. [The Delivery ETA Problem](#the-delivery-eta-problem)
2. [The Pieces Of A Feature Store](#the-pieces-of-a-feature-store)
3. [Concrete Feature Definitions](#concrete-feature-definitions)
4. [The Offline Store](#the-offline-store)
5. [Point-In-Time Joins](#point-in-time-joins)
6. [The Online Store](#the-online-store)
7. [Materialization](#materialization)
8. [A Managed Feature Store Example](#a-managed-feature-store-example)
9. [Monitoring And Operations](#monitoring-and-operations)
10. [Tradeoffs](#tradeoffs)
11. [Putting It Together](#putting-it-together)
12. [References](#references)

This article follows one system all the way through: a food delivery company called **CityBite** predicts delivery ETA before a customer places an order. The model needs fresh facts about restaurants, couriers, weather, and local demand. Those facts must line up during training and during live serving. That is the whole reason feature stores exist.

A **feature store** is shared infrastructure for defining, storing, finding, reusing, and serving machine learning features. A **feature** is one input value the model uses, such as `restaurant_avg_prep_minutes_30d`, `courier_acceptance_rate_7d`, or `zone_orders_last_15m`. A feature store helps the team use the same feature meaning in historical training data and in real-time prediction.

The path in this article is simple: first we define the delivery problem, then we name the feature store pieces, then we write concrete feature definitions, then we split historical training data from low-latency serving data, then we check the operations work around the store.

## The Delivery ETA Problem
<!-- section-summary: A feature store helps when one model needs reusable features that must match across historical training and live serving. -->

CityBite has a delivery ETA model behind the checkout page. A customer picks ramen from a restaurant, enters an address, and sees an estimated delivery time before placing the order. If the estimate says 24 minutes and the order arrives after 45 minutes, the customer loses trust. If the estimate says 45 minutes and most orders would arrive in 24 minutes, customers may leave before checkout.

The model receives a prediction request with facts that exist right now: restaurant ID, customer zone, courier zone, menu size, current distance, weather, and current time. It also needs computed facts from recent history. How long has this restaurant taken to prepare orders during the last 30 days? How many open orders exist in this delivery zone during the last 15 minutes? How often has this courier accepted nearby trips during the last week? Those computed facts are the model features.

At first, a data scientist might write SQL in a notebook and build a training table. Later, a backend engineer might write TypeScript or Python in the checkout service to compute the same values live. That split is where trouble starts. The notebook might count canceled orders differently from the serving code. The live code might use a 10-minute demand window while training used 15 minutes. The training query might accidentally use facts that happened after the prediction time.

A feature store gives the team one shared feature definition and two serving paths. The **offline path** builds historical training datasets. The **online path** gives the checkout service fresh feature values with low latency. The same feature names, owners, timestamps, and freshness rules travel through both paths.

Here are the main ideas we will connect:

| Concept | Plain meaning | CityBite example |
|---|---|---|
| Entity | The thing a feature describes | `restaurant_id`, `courier_id`, `zone_id` |
| Feature | One model input value | `restaurant_avg_prep_minutes_30d` |
| Feature view | A named group of related features from a source | Restaurant preparation features from warehouse tables |
| Offline store | Historical feature access for training and batch scoring | BigQuery, Snowflake, Redshift, Parquet, or S3-backed tables |
| Online store | Low-latency lookup for live prediction | Redis, DynamoDB, Datastore, SQLite for local development |
| Point-in-time join | Historical join that respects prediction time | Training rows use only feature values known before checkout |
| Materialization | Loading computed feature values into the online store | Hourly jobs push latest zone demand and restaurant prep stats |
| Monitoring | Checks that features stay fresh, valid, and useful | Alerts for stale zone demand or missing restaurant stats |

## The Pieces Of A Feature Store
<!-- section-summary: Feature stores organize entities, feature views, sources, stores, and services so teams can reuse feature logic. -->

A feature store has a few pieces that show up across open-source and managed products. The names vary slightly by tool, so let us keep them plain first.

An **entity** is the object a feature belongs to. For CityBite, `restaurant_id` identifies one restaurant, `courier_id` identifies one courier, and `zone_id` identifies one delivery area. The entity key lets the system look up the right row. If the checkout request says `restaurant_id = rest_482`, the store knows which restaurant preparation values to fetch.

A **feature definition** gives one feature a name, type, source, owner, and timing rule. The definition should answer boring production questions clearly. Which table produces it? Which timestamp describes when the feature value was true? How fresh should it be? Who owns broken data? Which model uses it?

A **feature view** groups related features from one source. Restaurant preparation features can live together because they come from the same restaurant order history. Zone demand features can live together because they come from recent order events grouped by zone. In Feast, feature views model existing feature data in a consistent way for training and serving, and they point at data sources used for historical retrieval and online loading.

A **feature service** or model-facing feature set names the exact features a model version expects. CityBite can have `eta_model_v1_features` with restaurant prep, zone demand, courier acceptance, and weather features. Later, `eta_model_v2_features` might add `restaurant_delay_rate_7d` after the team proves it helps.

This structure matters because feature stores serve many people. Data engineers own pipelines, data scientists train models, backend engineers call online APIs, and platform engineers operate storage. The feature store gives them a shared contract instead of a pile of copied SQL snippets.

![Feature store pieces showing entities, feature views, registry, feature service, offline store, online store, training jobs, live serving, owners, and timestamps](/content-assets/articles/article-mlops-data-for-ml-systems-feature-stores-explained/feature-store-pieces.png)

*A feature store ties human contracts to serving paths: entities and feature views register shared definitions, then offline and online stores serve training jobs and live requests.*

## Concrete Feature Definitions
<!-- section-summary: Real feature definitions name the entity, timestamp, source, type, owner, freshness rule, and model use. -->

Now let us define a few CityBite features as if the team is using Feast. Feast is a good teaching example because its concepts are explicit: a project, entities, data sources, feature views, offline stores, online stores, and feature services. The exact storage backend can change later. The feature contract stays readable.

The team starts with three feature groups:

| Feature | Entity | Type | Source | Freshness goal |
|---|---|---|---|---|
| `restaurant_avg_prep_minutes_30d` | `restaurant_id` | Float | Warehouse table built from completed orders | Daily |
| `restaurant_cancel_rate_7d` | `restaurant_id` | Float | Warehouse table built from order outcomes | Daily |
| `zone_orders_last_15m` | `zone_id` | Integer | Streaming aggregation from order events | Under 5 minutes |
| `zone_couriers_available_now` | `zone_id` | Integer | Courier location and status stream | Under 2 minutes |
| `courier_acceptance_rate_7d` | `courier_id` | Float | Warehouse table built from courier offers | Daily |

The important detail is that every feature has an entity and a timestamp. The entity answers "which restaurant, courier, or zone?" The timestamp answers "when was this feature value observed?" Those two fields make training and serving line up.

A Feast-style definition can look like this:

```python
from datetime import timedelta

from feast import Entity, FeatureService, FeatureView, Field, FileSource
from feast.types import Float32, Int64

restaurant = Entity(name="restaurant", join_keys=["restaurant_id"])
zone = Entity(name="zone", join_keys=["zone_id"])

restaurant_stats_source = FileSource(
    name="restaurant_stats_source",
    path="data/restaurant_stats.parquet",
    timestamp_field="event_timestamp",
    created_timestamp_column="created_at",
)

zone_demand_source = FileSource(
    name="zone_demand_source",
    path="data/zone_demand.parquet",
    timestamp_field="event_timestamp",
    created_timestamp_column="created_at",
)

restaurant_stats = FeatureView(
    name="restaurant_stats",
    entities=[restaurant],
    ttl=timedelta(days=45),
    schema=[
        Field(name="restaurant_avg_prep_minutes_30d", dtype=Float32),
        Field(name="restaurant_cancel_rate_7d", dtype=Float32),
    ],
    online=True,
    source=restaurant_stats_source,
    tags={"owner": "delivery-data-platform", "model": "eta"},
)

zone_demand = FeatureView(
    name="zone_demand",
    entities=[zone],
    ttl=timedelta(hours=2),
    schema=[
        Field(name="zone_orders_last_15m", dtype=Int64),
        Field(name="zone_couriers_available_now", dtype=Int64),
    ],
    online=True,
    source=zone_demand_source,
    tags={"owner": "marketplace-realtime", "model": "eta"},
)

eta_model_v1_features = FeatureService(
    name="eta_model_v1_features",
    features=[restaurant_stats, zone_demand],
)
```

There are a few useful details in this definition. `restaurant` and `zone` are entities, so prediction code can fetch features by restaurant and zone IDs. `timestamp_field` tells Feast which event time belongs to each feature row. `ttl` tells the store how old a value can be for serving and retrieval decisions. `online=True` marks the view for online serving. The tags give ownership and model usage hints so the catalog stays useful for humans.

For a beginner, the main lesson is that a feature definition is production metadata plus schema. The name alone is weak. The owner, source, entity, timestamp, freshness, and model usage give the team enough information to trust the feature.

## The Offline Store
<!-- section-summary: The offline store gives training and batch jobs access to historical feature values with timestamps. -->

The **offline store** is the historical side of the feature store. It reads feature values from batch-friendly systems such as warehouse tables, data lake tables, Parquet files, BigQuery, Snowflake, Redshift, or Spark-backed storage. Feast describes an offline store as an interface for historical time-series feature values, and it uses that interface for training datasets and for loading values into an online store.

CityBite uses the offline path to train the ETA model. The training data needs rows like this:

| order_id | prediction_time | restaurant_id | zone_id | label_actual_delivery_minutes |
|---|---|---|---|---|
| `ord_1001` | `2026-06-04 12:08:15 UTC` | `rest_482` | `zone_18` | `31` |
| `ord_1002` | `2026-06-04 12:09:02 UTC` | `rest_219` | `zone_18` | `24` |
| `ord_1003` | `2026-06-04 12:11:44 UTC` | `rest_482` | `zone_07` | `39` |

Each row represents a moment when CityBite made or could have made an ETA prediction. The label arrives later after the order finishes. The features must come from the past relative to `prediction_time`, because that is all the live model would know at checkout.

In Feast, the entity dataframe for historical retrieval carries entity keys and timestamps:

```python
import pandas as pd
from feast import FeatureStore

store = FeatureStore(repo_path="feature_repo")

entity_df = pd.DataFrame(
    {
        "order_id": ["ord_1001", "ord_1002", "ord_1003"],
        "restaurant_id": ["rest_482", "rest_219", "rest_482"],
        "zone_id": ["zone_18", "zone_18", "zone_07"],
        "event_timestamp": pd.to_datetime(
            [
                "2026-06-04T12:08:15Z",
                "2026-06-04T12:09:02Z",
                "2026-06-04T12:11:44Z",
            ]
        ),
    }
)

training_features = store.get_historical_features(
    entity_df=entity_df,
    features=[
        "restaurant_stats:restaurant_avg_prep_minutes_30d",
        "restaurant_stats:restaurant_cancel_rate_7d",
        "zone_demand:zone_orders_last_15m",
        "zone_demand:zone_couriers_available_now",
    ],
).to_df()
```

The `entity_df` is the list of training moments. The feature list names the values the model wants. The feature store uses the event timestamps to pick historical values that match those moments. This is where a feature store earns its keep: it gives the data scientist a training table without forcing every notebook to rebuild tricky temporal joins by hand.

## Point-In-Time Joins
<!-- section-summary: A point-in-time join picks the latest feature values available at prediction time, which prevents future data from leaking into training. -->

A **point-in-time join** joins features onto examples using the example's timestamp. It selects feature values whose event time is at or before the prediction time. This protects the model from seeing the future during training.

CityBite has a common leakage trap. The restaurant preparation feature for `rest_482` updates every night. If the training query joins the June 30 restaurant average onto an order from June 4, the model learns from future information. Offline metrics will look strong, then the live model will disappoint customers because that future information never existed at checkout.

A point-in-time join uses the latest valid feature row for each training example. In SQL, the idea can look like this:

```sql
WITH candidate_features AS (
  SELECT
    labels.order_id,
    labels.prediction_time,
    labels.restaurant_id,
    stats.event_timestamp AS feature_time,
    stats.restaurant_avg_prep_minutes_30d,
    ROW_NUMBER() OVER (
      PARTITION BY labels.order_id
      ORDER BY stats.event_timestamp DESC
    ) AS feature_rank
  FROM eta_training_labels AS labels
  JOIN restaurant_stats_daily AS stats
    ON labels.restaurant_id = stats.restaurant_id
   AND stats.event_timestamp <= labels.prediction_time
)
SELECT
  order_id,
  prediction_time,
  restaurant_id,
  restaurant_avg_prep_minutes_30d
FROM candidate_features
WHERE feature_rank = 1;
```

The join condition keeps only feature rows available by the prediction time. The window function ranks the remaining feature rows, and `feature_rank = 1` keeps the newest valid one. Real feature stores handle more edge cases: multiple feature views, created timestamps, time-to-live windows, missing values, and batch engine differences. The beginner idea stays the same: every training row should receive the features the model could have known at that moment.

This also explains why timestamps matter so much. A feature table without event time cannot support reliable historical retrieval. If CityBite only stores the latest restaurant average by restaurant ID, yesterday's training job cannot reconstruct what the model knew two months ago. Historical feature records protect replay, evaluation, audit, and incident review.

## The Online Store
<!-- section-summary: The online store holds recent feature values for low-latency prediction requests. -->

The **online store** is the low-latency side of the feature store. It holds the latest feature values that a live model needs during inference. The checkout service cannot scan a warehouse table while a customer waits. It needs a fast key-value lookup by entity ID.

For CityBite, a live request might include this data from the application:

```json
{
  "order_id": "ord_live_9921",
  "restaurant_id": "rest_482",
  "zone_id": "zone_18",
  "requested_at": "2026-07-05T18:17:22Z",
  "distance_km": 4.2,
  "basket_item_count": 3
}
```

Some fields come directly from the request. `distance_km` and `basket_item_count` can be computed in the application. Other fields should come from shared feature views. The model server can fetch those values from the feature store:

```python
from feast import FeatureStore

store = FeatureStore(repo_path="feature_repo")

feature_vector = store.get_online_features(
    features=[
        "restaurant_stats:restaurant_avg_prep_minutes_30d",
        "restaurant_stats:restaurant_cancel_rate_7d",
        "zone_demand:zone_orders_last_15m",
        "zone_demand:zone_couriers_available_now",
    ],
    entity_rows=[
        {
            "restaurant_id": "rest_482",
            "zone_id": "zone_18",
        }
    ],
).to_dict()

model_input = {
    **feature_vector,
    "distance_km": 4.2,
    "basket_item_count": 3,
}
```

The online call returns the latest materialized values for the restaurant and zone. The model server then combines those store-managed features with request-time values. This split is normal in production. A feature store helps with shared computed features, while the application still owns facts that only exist in the current request.

The online store has a different job from the offline store. It cares about latency, throughput, key lookups, freshness, and operational reliability. Teams often choose Redis, DynamoDB, Datastore, or another managed key-value system for this path. Local development can use SQLite or files so a learner can run the workflow without cloud infrastructure.

## Materialization
<!-- section-summary: Materialization loads feature values into the online store so live models can read fresh precomputed values. -->

**Materialization** means loading feature values into the online store. The offline store or batch source may contain many historical rows. The online store needs the latest useful values for live keys, such as each active restaurant and delivery zone.

CityBite materializes restaurant stats daily and zone demand every few minutes. Restaurant preparation averages move slowly, so an overnight job is fine. Zone demand changes quickly during lunch and dinner, so a near-real-time aggregation job updates the feature source and materializes recent values on a short schedule.

A Feast command can materialize a specific time range:

```bash
feast materialize 2026-07-05T17:00:00 2026-07-05T18:00:00
```

That command asks Feast to query the batch sources for the configured feature views over the provided time range and load the latest values into the configured online store. Teams usually run this from an orchestrator such as Airflow, Dagster, Prefect, or a cloud scheduler. The job should produce logs that answer three questions: which feature views ran, how many rows loaded, and what timestamp watermark reached the online store.

A simple production schedule can look like this:

```yaml
feature_jobs:
  restaurant_stats:
    cadence: "0 3 * * *"
    owner: "delivery-data-platform"
    expected_freshness_hours: 30
    materialize_window_hours: 48
  zone_demand:
    cadence: "*/5 * * * *"
    owner: "marketplace-realtime"
    expected_freshness_minutes: 10
    materialize_window_minutes: 30
```

The window is deliberately larger than the cadence. Late events happen. A courier status event may arrive a few minutes after it occurred, and a restaurant order close event may land after a retry. Re-materializing an overlapping window gives the online store a chance to pick up corrected feature values.

The rollback path should also be clear. If `zone_demand` starts writing bad values after a deployment, CityBite can pause the materialization job, switch the ETA service to a previous model that ignores the broken feature, or materialize from the last known good time range after the upstream fix lands. Feature store operations need this kind of runbook because the store sits directly in the model serving path.

![Materialization with watermarks showing batch and stream sources, an overlap window, a materialization job, online store, serving read, latest watermark, freshness, and rollback path](/content-assets/articles/article-mlops-data-for-ml-systems-feature-stores-explained/materialization-watermarks.png)

*Materialization is an operational handoff: sources feed a job, the job advances a watermark, the online store serves fresh values, and the rollback path protects live traffic.*

## A Managed Feature Store Example
<!-- section-summary: Managed feature stores package many of the same ideas into cloud-native feature groups, online stores, and offline stores. -->

Feast shows the concepts clearly, and managed services package similar ideas with cloud-native storage, IAM, APIs, and catalogs. Amazon SageMaker Feature Store is one useful managed example. It organizes features into **feature groups**. A feature group defines feature names and types, a record identifier, and an event time.

The record identifier plays the entity role. If CityBite creates a `restaurant_stats` feature group, `restaurant_id` can identify each restaurant record. The event time describes when the record happened. AWS documents that the online store keeps the latest record by event time, while the offline store keeps historical records. That matches the two paths we already discussed: fast latest values for serving, and history for training and analysis.

The managed offline store also has concrete storage behavior. SageMaker Feature Store writes offline data to an S3 bucket in Parquet format. It supports AWS Glue and Apache Iceberg table formats for the offline store, with AWS Glue as the default. This matters for real teams because the feature store output can feed Athena, Glue, Spark, or lakehouse workflows without every team inventing a separate export path.

A feature group sketch for CityBite might look like this:

```yaml
feature_group_name: citybite-restaurant-stats
record_identifier_name: restaurant_id
event_time_feature_name: event_timestamp
features:
  - name: restaurant_id
    type: String
  - name: event_timestamp
    type: String
  - name: restaurant_avg_prep_minutes_30d
    type: Fractional
  - name: restaurant_cancel_rate_7d
    type: Fractional
stores:
  online: true
  offline:
    s3_uri: s3://citybite-ml-features/offline-store/
    table_format: Iceberg
```

This example is intentionally small. The managed service still needs the same engineering discipline as Feast: owners, feature definitions, event time, validation, materialization or ingestion jobs, online read paths, offline query paths, access control, and monitoring. The cloud service reduces some infrastructure work, while the team still owns the meaning and quality of the features.

## Monitoring And Operations
<!-- section-summary: Feature stores need freshness, validity, parity, latency, and usage checks because bad features can hurt live predictions quickly. -->

A feature store can fail quietly. The model endpoint may keep returning predictions even when one feature is stale, missing, or shifted. That is why feature monitoring should focus on feature health, serving health, and model impact.

Start with **freshness**. Each feature view should have an expected update cadence and a latest event time. CityBite expects zone demand to update within 10 minutes. If the latest `zone_orders_last_15m` timestamp is 45 minutes old during dinner, ETA predictions will understate demand.

```sql
SELECT
  feature_view,
  MAX(event_timestamp) AS latest_feature_time,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(event_timestamp), MINUTE) AS age_minutes
FROM feature_store_watermarks
GROUP BY feature_view
HAVING age_minutes > freshness_limit_minutes;
```

Next check **validity**. Features should stay inside reasonable ranges. A cancellation rate should sit between 0 and 1. Available couriers should never be negative. A null spike can indicate a broken join, a schema change, or an upstream outage.

```sql
SELECT
  COUNTIF(restaurant_avg_prep_minutes_30d IS NULL) AS null_prep_minutes,
  COUNTIF(restaurant_cancel_rate_7d < 0 OR restaurant_cancel_rate_7d > 1) AS invalid_cancel_rate,
  COUNT(*) AS checked_rows
FROM restaurant_stats_daily
WHERE event_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY);
```

Then check **offline-online parity**. The feature value used in serving should have the same intended meaning as the value used in training. A parity check can sample active restaurants and zones, fetch online values, compare them with the latest offline values, and alert when differences exceed a tolerance.

Serving checks matter too. The ETA service should record feature fetch latency, timeout rate, missing feature rate, and fallback usage. A common fallback is to use default values or a simpler model when the online store is unavailable. That fallback should be visible in dashboards because customers may still receive predictions while quality drops.

Finally, monitor feature usage. If no model reads a feature for 90 days, the team can retire it after checking owners. If a new model starts reading a feature, the owner should know. A feature store catalog should help answer "who uses this feature?" during schema changes and incidents.

## Tradeoffs
<!-- section-summary: Feature stores help shared and real-time feature workflows, while small batch-only systems may prefer simpler pipelines first. -->

A feature store adds value when the team has a real feature management problem. CityBite is a good fit because the ETA model needs historical training data, low-latency online serving, reusable restaurant and zone features, and clear ownership across data engineering, backend, and ML teams.

The same tool can add overhead for a small monthly batch model. If a team trains one churn model from one warehouse table and sends a CSV to a marketing tool once a month, a version-controlled SQL model, data validation, and a scheduled pipeline may teach better habits with fewer moving parts. A feature store adds registries, storage, materialization jobs, access rules, freshness monitoring, and incident runbooks.

The decision usually comes down to a few questions:

- Do several models reuse the same features?
- Does live inference need low-latency access to precomputed values?
- Has the team seen training-serving skew from duplicated feature logic?
- Do training datasets need point-in-time correctness across many feature sources?
- Does the organization need a catalog with owners, definitions, lineage, and usage?
- Can the platform team operate the store, jobs, permissions, and monitoring?

If most answers are yes, a feature store can pay for itself. If most answers are no, start with clean feature definitions in code, tested pipelines, strong timestamps, and reviewed training queries. Those practices carry forward if the team adopts a feature store later.

There is also a design tradeoff inside the feature store. Online stores want latest values and fast reads. Offline stores want history and replay. Point-in-time joins want clean timestamps. Materialization wants reliable schedules and watermarks. Monitoring wants feature-level ownership. Skipping any of those pieces weakens the platform.

## Putting It Together
<!-- section-summary: A feature store connects definitions, historical retrieval, online serving, materialization, and monitoring into one feature workflow. -->

A feature store helps teams manage ML features as shared production assets. In the CityBite ETA system, the store defines restaurant, zone, and courier features once. The offline store builds historical training datasets with point-in-time joins. The online store serves fresh values to the checkout model. Materialization moves computed values into the online store on a schedule. Monitoring checks freshness, validity, parity, latency, and usage.

![Feature store operations dashboard showing freshness, validity, offline-online parity, read latency, feature usage, owner response, model impact, and retiring unused features](/content-assets/articles/article-mlops-data-for-ml-systems-feature-stores-explained/feature-store-operations.png)

*The store stays useful when teams operate it as a product: watch freshness, validity, parity, latency, usage, model impact, and ownership for every important feature.*

The most important beginner idea is consistency across time. The model should train on values that would have been available at prediction time, then serve with feature values that carry the same meaning. Feast makes those concepts visible through entities, feature views, feature services, offline stores, online stores, and materialization. Managed services such as SageMaker Feature Store package similar ideas into cloud-managed feature groups, online stores, and offline stores.

Use a feature store when the feature workflow is shared, time-sensitive, and operationally important. Keep the feature definitions concrete, keep timestamps honest, keep online values fresh, and keep owners visible. That is how the feature store supports the model instead of turning into another system nobody trusts.

## References

- [Feast Docs: Introduction](https://docs.feast.dev/) - Defines Feast, its offline and online stores, point-in-time feature sets, and feature-serving goals.
- [Feast Docs: Feature View](https://docs.feast.dev/getting-started/concepts/feature-view) - Explains how feature views model existing feature data for offline training and online serving.
- [Feast Docs: Feature Retrieval](https://docs.feast.dev/getting-started/concepts/feature-retrieval) - Explains event timestamps, historical retrieval, and point-in-time joins.
- [Feast Docs: Offline Store](https://docs.feast.dev/getting-started/components/offline-store) - Describes offline stores as interfaces for historical time-series feature values and online materialization.
- [Feast Docs: Load Data Into The Online Store](https://docs.feast.dev/how-to-guides/feast-snowflake-gcp-aws/load-data-into-the-online-store) - Documents materialization commands and online-store loading.
- [Amazon SageMaker AI: Create, Store, And Share Features With Feature Store](https://docs.aws.amazon.com/sagemaker/latest/dg/feature-store.html) - Describes SageMaker Feature Store, online stores, offline stores, and training-serving skew.
- [Amazon SageMaker AI: Feature Store Concepts](https://docs.aws.amazon.com/sagemaker/latest/dg/feature-store-concepts.html) - Defines feature groups, record identifiers, event time, online latest records, and offline historical records.
- [Amazon SageMaker AI: Offline Store Data Format](https://docs.aws.amazon.com/sagemaker/latest/dg/feature-store-offline.html) - Documents S3-backed offline storage, Parquet output, and Glue or Iceberg table formats.
