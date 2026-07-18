---
title: "ML API Request Design"
description: "Design ML API request and response contracts with stable fields, schema versions, batch support, trace IDs, and predictable output metadata."
overview: "ML API request design turns a model call into a durable contract. This article explains the contract framework: product semantics, validation, response evidence, versioning, invocation shape, error behavior, and consumer verification."
tags: ["MLOps", "core", "api"]
order: 1
id: "article-mlops-model-serving-request-response-design-for-ml-apis"
aliases:
  - roadmaps/mlops/modules/model-serving/serving-apis/02-request-response-design-for-ml-apis.md
  - child-serving-apis-02-request-response-design-for-ml-apis
---

## A Request Contract Is The Product Shape Of A Prediction
<!-- section-summary: ML API request design defines the fields, units, versions, and response evidence that product services use when they ask a model for a prediction. -->

**ML API request design** is the work of deciding what a caller sends to a model service and what the service returns. The design includes field names, types, units, required values, schema versions, response metadata, error format, and batch behavior. It turns a model call into a stable product contract.

This topic comes right after the FastAPI article because a framework can only enforce the contract you give it. FastAPI and Pydantic can validate JSON, generate OpenAPI docs, and return clear errors. They still need a serving team to decide which fields belong in the request, which fields belong in the response, and which changes require a new version.

The contract should use the language of the product workflow. If a delivery app asks for an ETA, it should send fields such as `pickup_latitude`, `dropoff_latitude`, `driver_available_minutes`, and `restaurant_ready_state`. It should receive fields such as `eta_minutes`, `confidence_band`, and `model_version`. The API should avoid exposing training-only names such as `f_37` or a pandas column order that only the training notebook understands.

Good request design also lowers incident cost. During a bad prediction incident, the team needs to know which request came in, which schema version interpreted it, which model answered it, and what the service told the caller. Those details should exist in the response and logs from the first design review, not as a rushed patch after the first outage.

The design has seven connected responsibilities. **Product semantics** define what each field means at prediction time. **Boundary validation** rejects requests the model cannot interpret safely. **Response evidence** tells the caller what happened and which model produced it. **Compatibility policy** separates safe additions from breaking changes. **Invocation shape** defines single, batch, synchronous, and asynchronous use. **Error semantics** let callers distinguish repairable input problems from service failures. **Consumer verification** proves the contract works in the real product path. The rest of the article follows these responsibilities; one ETA API appears only to make the consequences concrete.

These responsibilities cannot be designed independently. A new required feature changes product semantics and validation, may break old clients, affects batch payload size, and needs a recognizable error when absent. A response field is useful operationally only if logs and traces carry the same request and model identities. Treating the contract as a JSON sample misses these interactions.

## A Delivery ETA Contract Under Real Constraints
<!-- section-summary: A delivery ETA example shows how latency, product meaning, and incident diagnosis constrain an otherwise simple prediction contract. -->

Imagine **ForkLane**, a food delivery company. The checkout page shows customers an estimated arrival time before they place an order. The current rule-based estimate uses distance and average preparation time. The ML platform team has trained a model that uses restaurant readiness, driver availability, weather, traffic, distance, and recent delivery history to predict `eta_minutes`.

The prediction sits directly in a user workflow. If the API is slow, checkout waits. If the output is confusing, product engineers cannot decide what to display. If the model version is missing, the on-call team cannot connect a spike in late deliveries to the release that caused it.

The serving contract needs to support three consumers:

| Consumer | Needs from the API | Example decision |
|---|---|---|
| Checkout service | One fast ETA for the current basket | Show `Arrives in 31-38 min` |
| Dispatch service | Batch ETAs for nearby driver choices | Rank candidate drivers |
| Support tools | Prediction metadata for a past order | Explain why an ETA changed |

One model can serve all three if the request and response are designed carefully. The rest of the article builds that design one piece at a time.

![ForkLane delivery ETA request contract shared by checkout, dispatch, and support tools, with request fields flowing into ETA response fields.](/content-assets/articles/article-mlops-model-serving-request-response-design-for-ml-apis/forklane-eta-contract.png)

*A useful ML API contract names the caller-facing fields, the shared endpoint, and the response evidence every consumer needs later.*

## Name The Inputs The Caller Understands
<!-- section-summary: Request fields should match the product event and use clear units, types, required fields, and schema versions. -->

The request should describe the product situation, not the internal feature array. A request is a message from one service to another. It should carry fields the caller can produce reliably and the serving team can validate.

Here is a first Pydantic request shape for a single ETA prediction:

```python
from typing import Literal

from pydantic import BaseModel, Field


class DeliveryEtaRequest(BaseModel):
    request_id: str = Field(min_length=12, max_length=100)
    order_id: str = Field(min_length=8, max_length=80)
    customer_region: Literal["nyc", "chicago", "austin", "seattle"]
    pickup_latitude: float = Field(ge=-90, le=90)
    pickup_longitude: float = Field(ge=-180, le=180)
    dropoff_latitude: float = Field(ge=-90, le=90)
    dropoff_longitude: float = Field(ge=-180, le=180)
    order_value_cents: int = Field(ge=0, le=200_000)
    item_count: int = Field(ge=1, le=80)
    restaurant_ready_state: Literal["not_started", "preparing", "ready"]
    driver_available_minutes: float = Field(ge=0, le=180)
    weather_condition: Literal["clear", "rain", "snow", "storm", "unknown"]
    traffic_level: Literal["low", "medium", "high", "unknown"]
    requested_at_utc: str
    feature_schema_version: Literal["delivery_eta_features_v5"]
```

The field names carry units where units can cause mistakes. `order_value_cents` avoids floating-point currency confusion. `driver_available_minutes` says time unit directly in the name. Latitude and longitude use normal geographic bounds. The enum values force the caller to use a controlled vocabulary for weather, traffic, and restaurant state.

The `feature_schema_version` field is important. It tells the service which contract the caller believes it is using. If ForkLane later adds `delivery_zone_id` and changes the feature builder, the serving team can introduce `delivery_eta_features_v6` while still rejecting mismatched calls clearly.

The request should avoid raw free text unless the model needs text. Free text can carry privacy risk, high-cardinality logs, and prompt-like surprises for LLM systems. This ETA model can use structured fields, so the first API keeps text out of the contract.

## Shape The Response For Decisions And Debugging
<!-- section-summary: The response should give the caller a usable decision value and give operators enough metadata to debug the prediction later. -->

The response should answer the caller's product question first. Checkout needs an ETA range. Dispatch may need a numeric score. Support needs the metadata that ties the answer back to a model version and feature schema.

```python
class DeliveryEtaResponse(BaseModel):
    request_id: str
    order_id: str
    eta_minutes: float = Field(ge=0, le=240)
    display_window_min: int = Field(ge=0, le=240)
    display_window_max: int = Field(ge=0, le=240)
    confidence_band: Literal["narrow", "normal", "wide"]
    model_name: str
    model_version: str
    feature_schema_version: str
    served_at_utc: str
```

The `eta_minutes` field gives downstream systems a numeric value. The display window gives the UI a customer-friendly range. The confidence band lets checkout widen the range during storms or sparse data. The model and schema fields give operators evidence when they compare prediction logs to model releases.

A realistic response might look like this:

```json
{
  "request_id": "checkout_20260705_180221_9231",
  "order_id": "ord_93af21c8",
  "eta_minutes": 34.7,
  "display_window_min": 31,
  "display_window_max": 39,
  "confidence_band": "normal",
  "model_name": "delivery-eta",
  "model_version": "delivery-eta-2026-07-03",
  "feature_schema_version": "delivery_eta_features_v5",
  "served_at_utc": "2026-07-05T18:02:21Z"
}
```

The response avoids over-sharing internals. It does not expose raw feature vectors, training split names, or model file paths. Those belong in logs and review artifacts. The API response gives the product service what it needs to act and gives support enough metadata to open the right investigation trail.

## Version The Contract And The Model Separately
<!-- section-summary: Schema versions and model versions solve different problems, so the API should carry both. -->

Two versions matter in serving. A **contract version** describes the request and response shape. A **model version** describes the artifact that generated the prediction. They change for different reasons.

ForkLane might retrain the ETA model every week while the input schema stays the same. That changes `model_version` from `delivery-eta-2026-07-03` to `delivery-eta-2026-07-10`. The checkout service should not need a code change for that weekly release.

ForkLane might also add a new field such as `restaurant_queue_depth`. That changes the request contract and the feature schema. The serving team should coordinate that change with callers because older clients cannot magically send the new field.

A simple versioning policy can look like this:

| Change | Example | Version action |
|---|---|---|
| Retrain with same fields | New weights, same request schema | New `model_version` only |
| Add optional response metadata | Add `calibration_bucket` | Same endpoint, updated response docs |
| Add required request field | Add `restaurant_queue_depth` | New `feature_schema_version`; often a new API path |
| Rename a request field | `driver_available_minutes` to `driver_wait_minutes` | New schema version and migration window |
| Change meaning of output | ETA to pickup time | New endpoint because product meaning changed |

The API path can stay at `/v1/eta:predict` while the feature schema changes inside the body, or the team can create `/v2/eta:predict` for larger changes. The rule should be boring and written down: if an existing caller can keep working safely, the change can be compatible. If an existing caller must change behavior, plan a new version and migration window.

![ForkLane ETA API versioning diagram showing delivery_eta_features_v5 to v6 separately from model versions delivery-eta-2026-07-03 to delivery-eta-2026-07-10.](/content-assets/articles/article-mlops-model-serving-request-response-design-for-ml-apis/schema-and-model-version-tracks.png)

*Schema versions and model versions answer different release questions, so the response should carry both pieces of evidence.*

## Support Single And Batch Calls
<!-- section-summary: Single prediction calls fit user-facing requests, while batch calls fit service-to-service ranking or backfills. -->

A serving API often needs both single and batch shapes. Checkout sends one order. Dispatch may score twenty candidate driver assignments. Support may replay a small set of historical requests during an incident. The same model can support all of those, but the contract should make batch behavior explicit.

Here is one batch request shape:

```python
class DeliveryEtaBatchRequest(BaseModel):
    batch_request_id: str = Field(min_length=12, max_length=100)
    items: list[DeliveryEtaRequest] = Field(min_length=1, max_length=100)


class DeliveryEtaBatchResponse(BaseModel):
    batch_request_id: str
    results: list[DeliveryEtaResponse]
```

The batch size limit protects the service. A batch of 20 or 100 may help throughput because the model can process a frame of rows at once. A batch of 50,000 belongs in offline scoring or a streaming job, not a checkout-facing HTTP call.

Batch responses need ordering rules. The simplest rule is that responses appear in the same order as request items and each response repeats `request_id`. That lets the caller join results safely even if the model service later parallelizes work internally.

The service should also decide partial failure behavior. For this ETA API, the clean default is all-or-nothing validation at the request boundary. If one item has a broken latitude, the API returns a validation error for the whole batch. For offline replay tools, a separate endpoint can allow per-row errors. Mixing those behaviors in one endpoint creates confusion during incidents.

## Design Error Bodies Before Incidents
<!-- section-summary: Predictable error responses help callers fix bad requests and help operators separate client errors from model service failures. -->

Errors are part of the contract. A caller should know what happens when a field is missing, a schema version is stale, the model service times out, or the model artifact is unavailable. FastAPI and Pydantic already return structured validation errors for many bad requests. The team can add a small top-level error format for business-rule failures and service failures.

```python
class ApiError(BaseModel):
    error_code: str
    message: str
    request_id: str | None = None
    retryable: bool
    details: list[dict] = Field(default_factory=list)
```

Example stale schema response:

```json
{
  "error_code": "UNSUPPORTED_FEATURE_SCHEMA",
  "message": "delivery_eta_features_v4 is no longer accepted by this endpoint.",
  "request_id": "checkout_20260705_180221_9231",
  "retryable": false,
  "details": [
    {
      "field": "feature_schema_version",
      "accepted_values": ["delivery_eta_features_v5"]
    }
  ]
}
```

The `retryable` field helps the caller avoid harmful retry loops. A validation error is usually a client bug or stale client version, so retrying the same payload wastes traffic. A `503` during model startup may be retryable with backoff. A timeout may trigger a product fallback instead of repeated calls.

The service should log all errors with `request_id`, endpoint, schema version, caller identity, and model readiness state. That turns dashboards into clear buckets: client validation failures, model load failures, dependency failures, and slow model calls.

## Review The Contract With Real Consumers
<!-- section-summary: Contract review should include the caller team, serving team, product owner, privacy reviewer, and on-call owner before the endpoint goes live. -->

The contract is ready for review when it has examples. ForkLane should review one valid checkout request, one valid dispatch batch, one invalid field, one stale schema, and one timeout fallback. Abstract schema talk is weak; examples expose confusing field names and missing metadata quickly.

Use a review packet like this:

| Review question | Evidence to bring |
|---|---|
| Can checkout produce every required field? | Sample payload from staging checkout |
| Are units clear? | Field table with units and ranges |
| Can support explain a bad order later? | Response metadata and prediction log example |
| Can privacy approve the payload? | Field list with retention and masking notes |
| Can on-call debug failures? | Error body examples and dashboard labels |
| Can the team migrate versions? | Accepted schema versions and sunset date |

The best review often changes small things. Maybe `driver_available_minutes` should use seconds because dispatch already measures in seconds. Maybe `weather_condition` should include `unknown` because weather data can lag. Maybe support needs `model_version` in the customer service screen. Those changes are cheap before launch and painful after clients depend on the first shape.

![ForkLane ETA contract review map showing single checkout calls, batch dispatch calls, stale schema error bodies, timeout fallback, ordered results, and review packet owners.](/content-assets/articles/article-mlops-model-serving-request-response-design-for-ml-apis/single-batch-error-contract.png)

*Contract review should exercise single calls, batch calls, stale-schema errors, timeout fallback, and owner sign-off with real examples.*

## Putting It Together
<!-- section-summary: Strong ML API request design gives the serving system a product contract that stays useful across model releases, clients, batch calls, and incidents. -->

ML API request design is the bridge between model code and product code. A strong contract names inputs in product language, states units and ranges, carries schema and model versions, returns decision-ready outputs, supports batch calls intentionally, and uses predictable error bodies.

The ForkLane ETA API shows the pattern. The model predicts one number, yet the API contract carries much more than that number: request IDs, order IDs, schema versions, confidence bands, display windows, model versions, timestamps, and error rules. Those details help product engineers build the feature and help operators investigate the system later.

## References

- [FastAPI request body tutorial](https://fastapi.tiangolo.com/tutorial/body/)
- [FastAPI response model tutorial](https://fastapi.tiangolo.com/tutorial/response-model/)
- [Pydantic models](https://docs.pydantic.dev/latest/concepts/models/)
- [Pydantic validators](https://docs.pydantic.dev/latest/concepts/validators/)
- [OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/)
- [OpenTelemetry semantic conventions for HTTP spans](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
