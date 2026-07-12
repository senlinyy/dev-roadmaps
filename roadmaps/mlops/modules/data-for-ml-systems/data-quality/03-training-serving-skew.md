---
title: "Training-Serving Skew"
description: "Explain what happens when production inputs no longer match training assumptions."
overview: "Training-serving skew happens when the data used during training differs from the data used during live prediction. This article explains common skew patterns and the checks teams use to keep training and serving aligned."
tags: ["MLOps", "production", "core", "validation"]
order: 3
id: "article-mlops-data-for-ml-systems-training-serving-skew"
---

## Table of Contents

1. [Training-Serving Skew Means The Model Sees Different Data In Production](#training-serving-skew-means-the-model-sees-different-data-in-production)
2. [Follow One Ride ETA Model](#follow-one-ride-eta-model)
3. [Skew From Different Feature Logic](#skew-from-different-feature-logic)
4. [Skew From Timing And Freshness](#skew-from-timing-and-freshness)
5. [Compare Offline And Online Values](#compare-offline-and-online-values)
6. [Serving Payload Validation](#serving-payload-validation)
7. [Runbook For Skew Incidents](#runbook-for-skew-incidents)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Training-Serving Skew Means The Model Sees Different Data In Production
<!-- section-summary: Training-serving skew happens when the feature values used during training differ from the values the model receives during live scoring. -->

**Training-serving skew** happens when a model trains on one version of the data and receives a different version during production scoring. The column names may match, and the endpoint may stay healthy, yet the feature meaning changes. The model then uses patterns it learned from training data that production inputs no longer represent.

This article follows naturally from data quality. Validation checks whether a dataset matches its contract. Skew checks whether two paths match each other: the offline path that builds training rows and the online path that feeds live predictions.

The running scenario is **MetroRide**, a ride-hailing company that predicts pickup ETA when a rider requests a car. A low estimate makes riders angry when drivers arrive late. A high estimate can reduce bookings. The model depends on fast, consistent features from both warehouse history and live systems.

## Follow One Ride ETA Model
<!-- section-summary: The ride ETA scenario has warehouse training features and low-latency online features that must follow the same definitions. -->

MetroRide trains on historical ride requests in a warehouse. Each row represents a rider request, with the prediction timestamp at request time. Features include driver supply nearby, recent pickup speed, rider zone, time of day, weather, event venue traffic, and driver acceptance rate.

In production, the endpoint cannot scan the warehouse for every request. It reads online features from low-latency stores and services. Nearby driver count may come from a geospatial service, recent pickup speed from a streaming aggregation, and weather from a cached API result.

That creates two paths:

| Feature | Offline training path | Online serving path |
|---|---|---|
| `nearby_available_drivers_2km` | Warehouse snapshot of driver locations at request time | Live dispatch service |
| `pickup_speed_p50_30m` | Batch aggregation over completed pickups | Streaming aggregation in Redis |
| `venue_event_active` | Calendar table joined by zone and time | Feature flag service and event cache |
| `rain_intensity_mm_h` | Weather history table | Weather cache refreshed every five minutes |

Skew appears when any pair drifts apart. The training feature may count drivers within 2 kilometers while the online feature counts within 1 mile. Both values might be called `nearby_available_drivers`, and that shared name can hide the mismatch.

![Offline training and online serving paths meeting at a shared feature definition before match or skew alert](/content-assets/articles/article-mlops-data-for-ml-systems-training-serving-skew/training-serving-skew-map.png)

_This map shows the core skew problem: offline and online paths must meet the same feature definition before the model can trust the values._

## Skew From Different Feature Logic
<!-- section-summary: Logic skew appears when offline and online code compute the same feature name with different filters, windows, units, or defaults. -->

**Logic skew** happens when two systems compute the same feature with different rules. MetroRide's offline SQL may exclude drivers already assigned to a ride, while the online service may include them until the dispatch state updates. The model then learns from one supply definition and serves with another.

The fix is a reviewed feature definition that both paths must implement:

```yaml
feature: nearby_available_drivers_2km
entity: pickup_zone_id
prediction_time: request_ts
definition: "Count drivers within 2 kilometers of pickup coordinates who are online, unassigned, and eligible for standard rides."
offline_source: warehouse.driver_location_snapshots
online_source: dispatch.driver_supply_service
window: "latest snapshot at or before request_ts, max age 30 seconds"
default:
  value: 0
  allowed_when: "dispatch service unavailable and fallback policy active"
owner: dispatch-ml-platform
```

The definition gives reviewers a precise comparison target. During code review, the offline SQL and online service code should prove they use the same distance unit, driver state filter, ride type filter, and freshness limit.

An offline query can express the definition:

```sql
SELECT
  r.request_id,
  COUNTIF(d.driver_state = 'available'
    AND d.assigned_ride_id IS NULL
    AND ST_DISTANCE(d.location, r.pickup_location) <= 2000) AS nearby_available_drivers_2km
FROM warehouse.ride_requests r
JOIN warehouse.driver_location_snapshots d
  ON d.snapshot_ts <= r.request_ts
  AND d.snapshot_ts > TIMESTAMP_SUB(r.request_ts, INTERVAL 30 SECOND)
GROUP BY r.request_id;
```

The online path should have a test that uses the same fixture: pickup location, driver states, assignments, and expected count. Shared test cases catch skew earlier than dashboards that only show prediction drift.

## Skew From Timing And Freshness
<!-- section-summary: Timing skew appears when training joins and serving reads use different freshness limits or event-time rules. -->

**Timing skew** happens when the feature value comes from the wrong moment. Training might use a completed pickup-speed aggregation that includes rides finishing after the request. Serving can only use speeds known by request time. That mismatch gives the model cleaner history than production can provide.

MetroRide should build training rows with point-in-time joins:

```sql
WITH speed_ranked AS (
  SELECT
    r.request_id,
    s.pickup_zone_id,
    s.pickup_speed_p50_30m,
    s.feature_ts,
    ROW_NUMBER() OVER (
      PARTITION BY r.request_id
      ORDER BY s.feature_ts DESC
    ) AS rank
  FROM warehouse.ride_requests r
  JOIN warehouse.zone_pickup_speed_30m s
    ON s.pickup_zone_id = r.pickup_zone_id
    AND s.feature_ts <= r.request_ts
    AND s.feature_ts > TIMESTAMP_SUB(r.request_ts, INTERVAL 10 MINUTE)
)
SELECT
  request_id,
  pickup_speed_p50_30m,
  feature_ts
FROM speed_ranked
WHERE rank = 1;
```

The freshness limit matters. If no speed feature exists within 10 minutes, the training row should use the same default or fallback path as serving. Otherwise, training silently benefits from older or future data while serving faces the real-time constraint.

Feature-store tools can help here because they provide historical retrieval and online retrieval from feature definitions. The team still needs to review timestamp fields, freshness rules, and fallback behavior because the tool can only enforce the rules it receives.

## Compare Offline And Online Values
<!-- section-summary: Offline-online comparison tests replay production requests and compare logged online features with reconstructed offline features. -->

The strongest skew check compares live feature values with offline reconstructed values for the same requests. MetroRide can log the features sent to the model, then rebuild those same features from the warehouse and compare them after data lands.

The online prediction log should include the model version, request ID, prediction timestamp, feature values, feature timestamps, defaults, and source versions:

```json
{
  "request_id": "ride_req_8931",
  "model_version": "pickup-eta-v27",
  "prediction_ts": "2026-07-03T18:21:04Z",
  "features": {
    "nearby_available_drivers_2km": 8,
    "pickup_speed_p50_30m": 14.7,
    "venue_event_active": true,
    "rain_intensity_mm_h": 1.2
  },
  "feature_timestamps": {
    "driver_supply": "2026-07-03T18:21:02Z",
    "pickup_speed": "2026-07-03T18:20:00Z",
    "weather": "2026-07-03T18:20:00Z"
  },
  "defaults_used": []
}
```

After the warehouse catches up, a comparison query can flag mismatches:

```sql
SELECT
  l.model_version,
  COUNT(*) AS compared_requests,
  AVG(ABS(l.nearby_available_drivers_2km - o.nearby_available_drivers_2km)) AS avg_driver_count_abs_diff,
  AVG(ABS(l.pickup_speed_p50_30m - o.pickup_speed_p50_30m)) AS avg_speed_abs_diff,
  COUNTIF(l.venue_event_active != o.venue_event_active) / COUNT(*) AS venue_event_mismatch_rate
FROM ml_monitoring.online_pickup_eta_feature_log l
JOIN ml_recomputed.offline_pickup_eta_features o
  USING (request_id)
WHERE l.prediction_ts >= TIMESTAMP '2026-07-03 00:00:00 UTC'
  AND l.prediction_ts < TIMESTAMP '2026-07-04 00:00:00 UTC'
GROUP BY l.model_version;
```

Small differences can be normal for real-time systems. The team should set thresholds by feature. A driver count difference of one may be acceptable, while a mismatch rate of 20 percent for `venue_event_active` points to a broken event calendar path.

![Online feature log and offline rebuild feeding a parity check table with diff threshold bars](/content-assets/articles/article-mlops-data-for-ml-systems-training-serving-skew/offline-online-parity-check.png)

_The parity check shows how logged online values and reconstructed offline values can be compared for the same requests._

## Serving Payload Validation
<!-- section-summary: Serving validation checks each live request before prediction so missing, stale, or invalid features trigger controlled behavior. -->

Skew checks also belong in the serving path. The endpoint should validate incoming feature payloads before calling the model. This protects the model from missing fields, wrong types, stale feature timestamps, and defaults that exceed the allowed rate.

MetroRide can keep a serving schema near the endpoint:

```python
from pydantic import BaseModel, Field
from datetime import datetime


class PickupEtaFeatures(BaseModel):
    request_id: str
    prediction_ts: datetime
    nearby_available_drivers_2km: int = Field(ge=0, le=500)
    pickup_speed_p50_30m: float = Field(ge=1, le=80)
    venue_event_active: bool
    rain_intensity_mm_h: float = Field(ge=0, le=100)
    driver_supply_feature_ts: datetime
    pickup_speed_feature_ts: datetime
```

The endpoint should also compare feature timestamps with `prediction_ts`. If a feature is stale beyond its limit, the service can use a fallback model, a conservative ETA rule, or a previous healthy feature value depending on the product policy.

## Runbook For Skew Incidents
<!-- section-summary: A skew incident runbook guides rollback, fallback, feature disablement, and evidence gathering. -->

MetroRide treats skew as a production incident because riders and drivers feel the effect quickly. The runbook should connect alerts to action.

| Alert | First check | Decision owner | Safe action |
|---|---|---|---|
| Offline-online mismatch rate exceeds threshold | Compare feature logs with reconstructed features | ML on-call | Disable affected feature group or roll back model |
| Feature freshness breach | Inspect streaming job lag and online store age | Data platform on-call | Use fallback ETA rule until freshness recovers |
| Default rate spike | Inspect upstream service health | Dispatch platform | Route requests through conservative model |
| Prediction error spike in one city | Compare skew metrics by city and model version | ETA product owner | Roll back city rollout or lower traffic allocation |

The evidence packet should include model version, feature definitions, online logs, reconstructed offline values, serving schema errors, and recent deploys. This lets the team decide whether the issue came from model code, feature logic, data freshness, or product traffic changes.

![Skew incident runbook from alert to first check, safe action, evidence packet, fix path, rollback, and feature disablement](/content-assets/articles/article-mlops-data-for-ml-systems-training-serving-skew/skew-incident-runbook.png)

_The incident path keeps skew response practical: confirm the mismatch, choose a safe action, gather evidence, then roll back or disable the feature if needed._

## A Daily Skew Review
<!-- section-summary: A daily skew review catches feature mismatches before they turn into model-quality incidents. -->

MetroRide runs a short daily skew review for high-traffic cities. The review is not a meeting-heavy ceremony. It is a saved report with a clear owner and three questions:

- Did any online feature drift away from the offline recomputation?
- Did any serving feature exceed its freshness limit?
- Did prediction error rise in the same segment where skew increased?

The report links skew metrics with prediction quality and recent deploys. That connection matters because a mismatch alone may be harmless, while a mismatch plus a quality drop deserves action. A daily review also gives new engineers a simple way to learn which features are fragile in production.

Keep the review small, visible, owned, and actionable.

## Putting It Together
<!-- section-summary: Training-serving skew control keeps offline training logic, online serving logic, logs, and incident response aligned. -->

For MetroRide, skew control means shared feature definitions, point-in-time training joins, online payload validation, offline-online comparison tests, and a runbook for incidents. The model should receive live inputs that match the definitions it learned from during training.

This closes the data-quality submodule. You now have the vocabulary for examples, splits, leakage, validation, quality checks, and skew. The next submodule turns those habits into repeatable pipelines and versioned datasets.

## References

- [Feast point-in-time joins documentation](https://docs.feast.dev/getting-started/concepts/point-in-time-joins)
- [Feast online feature retrieval documentation](https://docs.feast.dev/getting-started/concepts/feature-retrieval)
- [TensorFlow Data Validation training-serving skew guide](https://www.tensorflow.org/tfx/guide/tfdv#checking_data_skew_and_drift)
- [Great Expectations checkpoints documentation](https://docs.greatexpectations.io/docs/core/trigger_actions_based_on_results/create_a_checkpoint/)
