---
title: "Production Features"
description: "Turn notebook feature ideas into owned, tested, versioned feature definitions that training and serving teams can trust."
overview: "Production feature engineering turns useful model inputs into shared product logic. This tutorial follows a grocery substitution model from warehouse schema to feature definition, Feast deployment, tests, review, release, and rollback."
tags: ["MLOps", "production", "features"]
order: 1
id: "article-mlops-data-for-ml-systems-feature-engineering-in-production"
---

## Table of Contents

1. [What Production Features Are](#what-production-features-are)
2. [The Feature Contract](#the-feature-contract)
3. [Source Schemas And Time Rules](#source-schemas-and-time-rules)
4. [Write The Feature Definition](#write-the-feature-definition)
5. [Test The Feature Before Release](#test-the-feature-before-release)
6. [Release And Version The Feature](#release-and-version-the-feature)
7. [Operate The Feature](#operate-the-feature)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## What Production Features Are
<!-- section-summary: Production features are model inputs with reviewed business meaning, source data, timing rules, owners, tests, and release history. -->

A **feature** is an input value a model uses to make a prediction. A **production feature** is that input after the team has turned it into shared, reviewed, tested, and repeatable logic. The feature has a name, source data, entity key, timestamp rule, default value, owner, validation checks, and release history.

Imagine FreshBasket, a grocery delivery company. When an item is out of stock, FreshBasket suggests a substitute: oat milk instead of almond milk, one brand of pasta instead of another, a smaller bag of rice instead of a larger one. A model ranks the substitutes. It needs features about the customer, the store, the item, and the current order.

In a notebook, a data scientist may create a useful column called `customer_brand_affinity_90d`. It measures how often a customer chose the same brand family during the last 90 days. The notebook version proves the idea has signal. The production version has to answer harder questions. Which purchases count? Which timestamp defines the 90-day window? What happens for a new customer? Can the online service fetch this value fast enough during checkout? Who approves a change?

That is the difference this article focuses on. Feature engineering in production is less about inventing clever columns and more about making the column safe for repeated use. The model should train and serve with the same meaning. Reviewers should understand the business rule. On-call engineers should know what broke when the feature goes stale.

![Notebook to production pipeline for turning a feature idea into reviewed code, an artifact, evaluation, release, and monitoring](/content-assets/articles/article-mlops-data-for-ml-systems-feature-engineering-in-production/production-feature-pipeline.png)

*A notebook feature reaches production only after the team turns the idea into reviewed code, a tested artifact, a release, and a monitored dependency.*

## The Feature Contract
<!-- section-summary: A feature contract defines the name, entity, source, window, cutoff time, default, owner, consumers, and allowed change process. -->

The first production artifact is the **feature contract**. A feature contract is a small definition that explains what the feature means and how teams may use it. It can live in YAML, Python, a data catalog, a feature-store registry, or a design document generated from code. The format can change by company, yet the contract should answer the same questions.

For FreshBasket, `customer_brand_affinity_90d` belongs to the substitution ranking model. The entity is a customer. The value uses completed purchases during the previous 90 days. It uses the model scoring time as the cutoff, because a checkout request should never use purchases that happened later.

```yaml
feature_contract:
  name: customer_brand_affinity_90d
  version: 1
  owner: grocery-personalization-platform
  description: Share of the customer's completed purchases in the last 90 days that match the candidate item's brand family.
  entity:
    name: customer
    join_key: customer_id
  source_tables:
    - warehouse.completed_order_items
    - warehouse.product_catalog
  event_time: purchased_at
  cutoff_time: substitution_request_ts
  window: 90 days before cutoff_time
  default_value: 0.0
  value_range:
    min: 0.0
    max: 1.0
  consumers:
    - substitution_ranker_v3
    - weekly_substitution_quality_report
  review_required_for:
    - source table change
    - window change
    - default change
    - entity key change
```

This contract gives different people the part they need. A data scientist sees the exact feature meaning. A data engineer sees the source tables and time column. A serving engineer sees the default behavior. A product reviewer sees that the feature uses purchase history and can ask whether the privacy and personalization policy covers it.

The contract also prevents silent behavior changes. If someone changes the 90-day window to 30 days, the feature may still have the same name in code, yet the model sees a different signal. Versioning makes that change visible.

## Source Schemas And Time Rules
<!-- section-summary: Production feature schemas need stable entity keys, event timestamps, ingestion timestamps, data types, and product definitions. -->

The feature contract points to source data, so the next question is whether the source schema can support the rule. A source schema is the shape of the data the feature reads. For ML features, the schema needs stable IDs, event time, ingestion time, clear business states, and data types that will survive both batch and online paths.

FreshBasket uses two source tables. `completed_order_items` stores item-level purchase events. `product_catalog` stores product metadata such as brand family and department. The model ranks a candidate substitute, so the feature logic needs both customer history and candidate item metadata.

| Table | Field | Type | Production meaning |
|---|---|---|---|
| `warehouse.completed_order_items` | `customer_id` | `STRING` | Entity key for customer history |
| `warehouse.completed_order_items` | `item_id` | `STRING` | Purchased item |
| `warehouse.completed_order_items` | `order_id` | `STRING` | Deduplication and traceability |
| `warehouse.completed_order_items` | `purchased_at` | `TIMESTAMP` | Event time used for the feature window |
| `warehouse.completed_order_items` | `ingested_at` | `TIMESTAMP` | Late-arrival and replay checks |
| `warehouse.completed_order_items` | `order_status` | `STRING` | Only completed purchases count |
| `warehouse.product_catalog` | `item_id` | `STRING` | Join key to catalog metadata |
| `warehouse.product_catalog` | `brand_family` | `STRING` | Brand grouping used by the feature |

The time rule needs careful wording. The feature counts completed purchases before the substitution request time. A customer may complete another purchase later the same day, and that later event cannot influence an earlier request. This is why every production feature definition needs a cutoff time.

```sql
CREATE OR REPLACE TABLE features.customer_brand_affinity_daily AS
SELECT
  i.customer_id,
  c.brand_family,
  DATE(i.purchased_at) AS feature_date,
  COUNT(*) AS completed_items,
  COUNT(DISTINCT i.order_id) AS completed_orders,
  MAX(i.ingested_at) AS max_ingested_at
FROM warehouse.completed_order_items i
JOIN warehouse.product_catalog c
  ON i.item_id = c.item_id
WHERE i.order_status = 'completed'
GROUP BY
  i.customer_id,
  c.brand_family,
  DATE(i.purchased_at);
```

This table is an intermediate feature table. It stores daily customer-brand counts, which can later support a 90-day rolling window. The query keeps `max_ingested_at` so operations can detect late data. It also uses explicit `completed` status so canceled orders do not leak into the feature.

![Feature cutoff window showing completed purchases before the request cutoff counting and future purchases being blocked](/content-assets/articles/article-mlops-data-for-ml-systems-feature-engineering-in-production/feature-cutoff-window.png)

*The cutoff window keeps the feature honest: completed purchases before the request can count, later purchases stay out, and ingestion time helps detect late data.*

## Write The Feature Definition
<!-- section-summary: A feature definition turns the contract into deployable code that a feature platform can validate, register, and serve. -->

After the contract and schema are clear, the team can write a feature definition. A feature definition is code or config that a feature platform can register. In Feast, teams define entities, data sources, feature views, and services in a feature repository. Feast docs describe feature views as the way to model existing feature data consistently for offline training and online serving.

FreshBasket uses Feast for the open-source example because it makes the pieces visible. The offline store reads warehouse tables. The online store serves low-latency values after materialization. The feature view names the entity, schema, source, TTL, and online flag.

```python
from datetime import timedelta

from feast import Entity, FeatureService, FeatureView, Field
from feast.infra.offline_stores.contrib.spark_offline_store.spark_source import SparkSource
from feast.types import Float32, Int64

customer = Entity(
    name="customer",
    join_keys=["customer_id"],
    description="FreshBasket customer account used for grocery personalization",
)

customer_brand_affinity_source = SparkSource(
    name="customer_brand_affinity_daily",
    table="features.customer_brand_affinity_daily",
    timestamp_field="feature_ts",
    created_timestamp_column="max_ingested_at",
)

customer_brand_affinity = FeatureView(
    name="customer_brand_affinity",
    entities=[customer],
    ttl=timedelta(days=91),
    schema=[
        Field(name="brand_affinity_90d", dtype=Float32),
        Field(name="completed_items_90d", dtype=Int64),
    ],
    source=customer_brand_affinity_source,
    online=True,
    tags={
        "owner": "grocery-personalization-platform",
        "model": "substitution_ranker",
        "contract": "customer_brand_affinity_90d:v1",
    },
)

substitution_ranker_features = FeatureService(
    name="substitution_ranker_v3",
    features=[customer_brand_affinity],
)
```

The code mirrors the contract. The entity is `customer`. The source table has an event timestamp and a created timestamp. The TTL is slightly longer than the 90-day window so late materialization can still fetch the needed value. `online=True` says the values should load into the online store for serving.

The CI job should register this definition only after tests pass. Feast `apply` scans Python files in the feature repository, validates object definitions, and syncs metadata to the registry. A team can run it from CI after code review.

```bash
feast apply
feast materialize 2026-07-01T00:00:00 2026-07-02T00:00:00 \
  --views customer_brand_affinity
```

`feast apply` updates the feature-store deployment and registry. `feast materialize` loads feature values for the selected time range into the online store. Feast docs call out that materialize needs a time range and fits a scheduler such as Airflow.

## Test The Feature Before Release
<!-- section-summary: Feature tests cover schema, point-in-time behavior, default values, online-offline consistency, and product assumptions. -->

Production feature tests should focus on the places feature logic usually breaks. For FreshBasket, the risky parts are time windows, canceled orders, catalog joins, new customers, and online-offline consistency. The model may look strong offline while the live feature path returns stale or missing values during checkout.

Start with SQL checks for the warehouse table. These checks can run in dbt, Airflow, Dagster, Great Expectations, or a small CI query runner. The tool matters less than the assertions.

```sql
SELECT
  COUNT(*) AS rows_checked,
  SUM(CASE WHEN brand_affinity_90d < 0 OR brand_affinity_90d > 1 THEN 1 ELSE 0 END) AS out_of_range_rows,
  SUM(CASE WHEN feature_ts IS NULL THEN 1 ELSE 0 END) AS missing_feature_ts,
  SUM(CASE WHEN max_ingested_at < feature_ts THEN 1 ELSE 0 END) AS impossible_ingestion_rows
FROM features.customer_brand_affinity_daily
WHERE feature_ts >= TIMESTAMP '2026-07-01 00:00:00 UTC'
  AND feature_ts < TIMESTAMP '2026-07-02 00:00:00 UTC';
```

This query catches impossible values and missing timestamps. It also makes the time window explicit, which helps reviewers see which partition the test covers.

Next comes a point-in-time unit test. The test creates a small history for one customer and scores a request at a specific timestamp. One purchase before the request should count. One purchase after the request should stay out of the feature.

```python
from datetime import datetime, timezone

import pandas as pd

def test_brand_affinity_uses_only_history_before_request(build_brand_affinity):
    purchases = pd.DataFrame(
        [
            {
                "customer_id": "cust_101",
                "brand_family": "oat-valley",
                "purchased_at": datetime(2026, 6, 1, 10, tzinfo=timezone.utc),
                "order_status": "completed",
            },
            {
                "customer_id": "cust_101",
                "brand_family": "oat-valley",
                "purchased_at": datetime(2026, 7, 2, 10, tzinfo=timezone.utc),
                "order_status": "completed",
            },
        ]
    )

    result = build_brand_affinity(
        purchases=purchases,
        customer_id="cust_101",
        brand_family="oat-valley",
        request_ts=datetime(2026, 7, 1, 12, tzinfo=timezone.utc),
    )

    assert result["completed_items_90d"] == 1
    assert result["brand_affinity_90d"] == 1.0
```

The test is tiny, and that is the point. It proves the rule that matters. The feature may later run on Spark or a warehouse, yet the business timing rule should still have a small test that humans can read.

The release also needs an online-offline comparison. The training job retrieves historical values. The serving system fetches online values. The team samples recent requests, logs safe feature values, recomputes the same values offline, and compares.

```sql
SELECT
  COUNT(*) AS sampled_requests,
  AVG(ABS(online.brand_affinity_90d - offline.brand_affinity_90d)) AS avg_abs_diff,
  SUM(
    CASE
      WHEN ABS(online.brand_affinity_90d - offline.brand_affinity_90d) > 0.05 THEN 1
      ELSE 0
    END
  ) AS large_mismatch_count
FROM serving_logs.substitution_feature_values online
JOIN offline_checks.customer_brand_affinity_recomputed offline
  ON online.request_id = offline.request_id
WHERE online.request_ts >= TIMESTAMP '2026-07-01 00:00:00 UTC'
  AND online.request_ts < TIMESTAMP '2026-07-02 00:00:00 UTC';
```

FreshBasket sets a small tolerance because online and offline paths may round values differently. A large mismatch count blocks the feature release until the owner explains the difference.

## Release And Version The Feature
<!-- section-summary: Feature release discipline records version changes, consumers, migration windows, and rollback paths before a model uses the new value. -->

Feature releases need version discipline because feature changes alter model behavior. A change from 90 days to 30 days may improve substitution relevance for some customers and hurt it for others. A change from completed orders to all orders may count canceled purchases and confuse the model. The feature name should show meaningful changes through versions or separate feature names.

FreshBasket uses a release packet for each feature change. It records the old version, new version, consumers, validation results, rollout plan, and rollback path.

```yaml
feature_release:
  feature: customer_brand_affinity_90d
  old_version: 1
  new_version: 2
  change: "Exclude refunded items from the completed purchase count."
  consumers:
    - substitution_ranker_v3
  validation:
    schema_check: passed
    point_in_time_test: passed
    online_offline_mismatch_rate: 0.003
    segment_review:
      new_customers: "no material change"
      vegan_products: "small precision improvement"
      high_refund_customers: "expected decrease in affinity"
  rollout:
    materialize_start: "2026-07-10T00:00:00Z"
    shadow_compare_days: 3
    model_retrain_required: true
  rollback:
    previous_feature_service: substitution_ranker_v3_features_2026_06
    owner: grocery-personalization-platform
```

This packet keeps the feature change from hiding inside a pull request. The model owner sees whether retraining is required. The serving owner sees which feature service to use if rollback is needed. The product owner sees which customer segments changed.

Managed platforms have their own versioning habits. Tecton, for example, treats feature services as production objects and recommends creating a new feature service when the feature list changes. SageMaker Feature Store organizes features into feature groups with records and metadata. Vertex AI Feature Store focuses on feature views backed by BigQuery sources and online serving through online stores. The production habit stays the same across tools: make the change explicit, test it, release it with an owner, and keep a rollback path.

## Operate The Feature
<!-- section-summary: Operating a feature means monitoring freshness, missing values, distribution shifts, online read latency, and owner response. -->

After release, the feature has to be operated like any other production dependency. FreshBasket monitors freshness, null rate, distribution, materialization success, online read latency, and model impact. These checks tell the team whether the feature path still matches the contract.

```sql
SELECT
  DATE(request_ts) AS request_date,
  COUNT(*) AS requests,
  AVG(CASE WHEN brand_affinity_90d IS NULL THEN 1 ELSE 0 END) AS null_rate,
  APPROX_PERCENTILE(brand_affinity_90d, 0.50) AS p50_affinity,
  APPROX_PERCENTILE(brand_affinity_90d, 0.95) AS p95_affinity,
  APPROX_PERCENTILE(feature_age_seconds, 0.95) AS p95_feature_age_seconds,
  APPROX_PERCENTILE(feature_read_latency_ms, 0.95) AS p95_read_latency_ms
FROM serving_logs.substitution_feature_values
WHERE request_ts >= TIMESTAMP '2026-07-01 00:00:00 UTC'
GROUP BY DATE(request_ts)
ORDER BY request_date DESC;
```

This dashboard query gives the on-call engineer the first view. If `p95_feature_age_seconds` jumps, materialization may be delayed. If null rate jumps for one region, the upstream order-item feed may have a schema issue. If online read latency spikes, the feature service may need a cache or online store capacity review.

The runbook names the response path:

| Signal | First owner | First check | Safe response |
|---|---|---|---|
| Freshness breach | Data platform | Last materialization job and warehouse partition arrival | Pause model rollout and use previous feature service |
| Null rate spike | Feature owner | Source table schema and product event status | Apply default only if the contract allows it |
| Online latency spike | Serving owner | Online store latency and request volume | Use cached value or previous model route |
| Offline-online mismatch | ML platform | Logged feature sample and point-in-time recompute | Block retraining until owner signs off |

![Feature release gate showing offline metrics, segment checks, load testing, latency checks, rollback readiness, shadow traffic, and canary rollout](/content-assets/articles/article-mlops-data-for-ml-systems-feature-engineering-in-production/feature-release-gate.png)

*A production feature should pass the same release gate as other product dependencies: offline checks, segment review, latency checks, shadow comparison, canary rollout, and a rollback target.*

Good feature engineering reaches this point. The feature is no longer a clever notebook column. It is product logic with a contract, code, tests, release history, monitoring, and a team that owns it.

## Putting It Together
<!-- section-summary: Production feature engineering turns feature ideas into shared, tested, versioned, monitored model inputs. -->

Production features are model inputs with business meaning. They need clear definitions, source schemas, time rules, feature-store code, tests, release packets, and operational checks. The more models that share a feature, the more important this discipline is.

FreshBasket's substitution feature started as a useful notebook column. The production version defined the customer entity, purchase-history window, cutoff time, default value, feature definition, materialization command, tests, release packet, and monitoring query. That is the work that lets training and serving use the same meaning.

The next article uses this foundation to separate offline and online feature paths. Once a feature has a contract, the team still has to deliver historical values for training and fresh values for live inference.

## References

- [Feast Docs: Feature views](https://docs.feast.dev/getting-started/concepts/feature-view) - Explains feature views for consistent offline and online feature modeling.
- [Feast Docs: CLI commands](https://docs.feast.dev/reference/feast-cli-commands) - Documents `feast apply` and validation behavior.
- [Feast Docs: Load data into the online store](https://docs.feast.dev/how-to-guides/feast-snowflake-gcp-aws/load-data-into-the-online-store) - Documents `feast materialize` and materialization windows.
- [Tecton Docs: Define features](https://docs.tecton.ai/docs/defining-features) - Explains batch, stream, and realtime feature definitions.
- [Tecton Docs: Feature services](https://docs.tecton.ai/docs/reading-feature-data/feature-services) - Documents feature services and versioned service changes.
- [Amazon SageMaker Feature Store Docs](https://docs.aws.amazon.com/sagemaker/latest/dg/feature-store.html) - Describes feature storage, sharing, and management.
- [Google Cloud Docs: Vertex AI Feature Store feature views](https://docs.cloud.google.com/gemini-enterprise-agent-platform/machine-learning/featurestore/latest/create-featureview) - Documents feature view sync behavior for BigQuery-backed feature data.
