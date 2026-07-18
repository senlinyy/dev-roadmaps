---
title: "Prediction Logging"
description: "Record prediction request and response evidence with request IDs, privacy boundaries, redaction, sampling, and retention."
overview: "Prediction logging records the safest useful facts around each inference call. A supporting example follows an image moderation model service through structured JSON logs, request IDs, payload boundaries, redaction rules, OpenTelemetry log correlation, sampling, retention policies, and incident triage."
tags: ["MLOps", "core", "observability"]
order: 2
id: "article-mlops-monitoring-and-feedback-logging-prediction-requests-responses"
---


## Prediction Logs Preserve The Story Around A Decision
<!-- section-summary: Prediction logging records the request context, model identity, output summary, and operational evidence needed to debug or audit a prediction later. -->

**Prediction logging** means recording structured evidence around an inference request and the prediction response. A good prediction log can answer: which model handled the request, what safe summary of the input reached the model, what score or class came back, which policy decision followed, how long the request took, and which request id connects the event to traces and application logs.

Prediction logs help in two directions. During an incident, they help engineers explain what happened for a specific user-visible decision. During model review, they help data scientists compare slices of production behavior, such as false-positive complaints, low-confidence cases, or segments with many fallbacks. The log is useful only if it keeps sensitive payloads under control. Raw production data can carry personal data, secrets, regulated content, or copyrighted content, so a prediction log needs a boundary before code starts writing events.

This article uses one moderation service to make the tradeoffs concrete. You will see how to choose fields, add request ids, write JSON logs, connect logs with OpenTelemetry trace context, apply redaction in the app and the collector, sample high-volume events, retain logs for the right window, and use the evidence in a real incident.

## A Supporting Example: Image Moderation Service
<!-- section-summary: A supporting example is an image moderation API where the team needs debugging evidence while keeping raw images and private user details out of general logs. -->

Imagine **ClearFrame**, a creator platform where users upload photos for public galleries. Before an image appears publicly, the platform calls `moderation-api` at `/v1/moderate-image`. The service runs an image moderation model that scores categories such as `safe`, `medical`, `violence`, `adult`, and `self_harm`. The response sends a policy decision such as `allow`, `send_to_review`, or `block`.

ClearFrame has two teams reading prediction logs. The trust and safety team needs to investigate appeals, such as "my plant-care photo was blocked." The ML team needs to understand false positives and false negatives by image source, model version, and confidence band. The platform team needs to debug latency, dependency failures, and request spikes. All three groups need evidence, while raw images and private user data need tighter storage and access controls than normal application logs.

A useful prediction-log plan separates the event into safe fields:

| Field Group | Example Fields | Logging Boundary |
|---|---|---|
| Correlation | `request_id`, `trace_id`, `span_id` | Stored in every log line |
| Service identity | `service`, `environment`, `route`, `pod`, `region` | Stored in every log line |
| Model identity | `model_name`, `model_version`, `threshold_policy_version` | Stored in every prediction event |
| Input summary | `image_sha256`, `image_width`, `image_height`, `mime_type`, `source_surface` | Stored as metadata only |
| Private subject | `user_id_hash`, `account_age_bucket`, `country_code` | Hashed or bucketed before storage |
| Output summary | `top_label`, `top_score`, `decision`, `review_reason` | Stored without raw model tensors |
| Runtime evidence | `latency_ms`, `feature_fetch_ms`, `status_code`, `error_type` | Stored for debugging and SLO analysis |

This table is the safety contract. Raw image bytes stay in the media service with stricter access. Original user ids stay in the account system. Prediction logs store hashes, buckets, labels, scores, and versions. The team can investigate patterns without turning the general log index into a second copy of the production payload.

![ClearFrame safe prediction logging boundary](/content-assets/articles/article-mlops-monitoring-and-feedback-logging-prediction-requests-responses/clearframe-logging-boundary.png)
*ClearFrame keeps sensitive payloads in controlled systems while the prediction log index stores only joinable, summarized evidence for debugging and review.*

## Decide The Safe Logging Boundary
<!-- section-summary: A safe prediction log stores enough input and output summary to debug decisions while high-risk payloads stay in controlled systems. -->

The hardest part of prediction logging is choosing the boundary. If the log stores too little, incidents turn into guesswork. If the log stores too much, the observability system carries data it was never designed to protect. ClearFrame writes the boundary as a simple rule: logs can hold identifiers for joining, metadata for debugging, and summarized model outputs; logs exclude raw images, full prompts, full free-text captions, authentication tokens, exact GPS coordinates, and any field with a direct account identifier.

The boundary also depends on access. A small trust and safety group can use a reviewed image lookup tool that enforces purpose, approval, and audit trails. The broad engineering log dashboard should show only `image_sha256`, metadata, and model output summary. That separation lets many engineers debug service behavior while a narrower workflow handles sensitive content review.

A practical schema makes the boundary visible:

```yaml
prediction_log_schema:
  version: 1
  event_name: moderation_prediction
  required_fields:
    - request_id
    - trace_id
    - service
    - environment
    - route
    - model_name
    - model_version
    - threshold_policy_version
    - image_sha256
    - source_surface
    - top_label
    - top_score
    - decision
    - latency_ms
  forbidden_fields:
    - raw_image_bytes
    - image_url_with_token
    - user_email
    - user_id
    - access_token
    - caption_text
    - exact_gps
  allowed_private_transforms:
    user_id_hash: hmac_sha256
    account_age_bucket: fixed_bucket
    image_size_bucket: fixed_bucket
```

The forbidden list is as important as the required list. It gives code reviewers, data engineers, and incident responders one shared contract. If a developer wants to add `caption_text` later, the schema forces a review because captions can carry names, addresses, health details, or other sensitive text.

## Attach Request IDs And Structured Fields
<!-- section-summary: Request IDs and structured JSON fields turn scattered logs into joinable evidence across the API, model runtime, traces, and support workflow. -->

A **request ID** is a stable identifier for one request. It travels through the API response, application logs, prediction logs, support tickets, and traces. If a creator appeals a moderation decision, support can include the request id in the ticket, and engineers can find the exact event without searching by time and account details.

Structured logs use named fields instead of plain sentences. The log backend can filter `model_version="vision-mod-2026-06-28"`, group by `decision`, and join with trace ids. OpenTelemetry log records also support correlation with traces through trace id and span id fields, so a prediction log can connect to the distributed trace for the same request.

The request boundary should accept only a valid trusted incoming request ID or create a new one, store it in request-local context, return it to the caller, and attach current trace fields to structured logs. Public edges often replace client-supplied IDs so external input cannot forge internal correlation values.

:::expand[Implement bounded request and trace correlation]{kind="example"}
This complete FastAPI middleware validates the incoming header, creates request-local context, records one structured HTTP event, and returns the same ID. The implementation detail is optional; the visible contract is that request, trace, and span identities remain separate and joinable.

```python
import contextvars
import json
import logging
import re
import time
import uuid

from fastapi import FastAPI, Request
from opentelemetry import trace

app = FastAPI()
logger = logging.getLogger("moderation-api")
request_id_var = contextvars.ContextVar("request_id", default="")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,80}$")


def current_trace_fields() -> dict[str, str]:
    span_context = trace.get_current_span().get_span_context()
    if span_context.is_valid:
        return {
            "trace_id": format(span_context.trace_id, "032x"),
            "span_id": format(span_context.span_id, "016x"),
        }
    return {"trace_id": "", "span_id": ""}


@app.middleware("http")
async def request_context(request: Request, call_next):
    incoming_request_id = request.headers.get("x-request-id", "")
    accepted_incoming_id = bool(REQUEST_ID_PATTERN.fullmatch(incoming_request_id))
    request_id = incoming_request_id if accepted_incoming_id else str(uuid.uuid4())
    request.state.request_id = request_id
    token = request_id_var.set(request_id)
    start = time.perf_counter()
    try:
        response = await call_next(request)
        return response
    finally:
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        response = locals().get("response")
        logger.info(
            json.dumps(
                {
                    "event": "http_request",
                    "request_id": request_id,
                    "incoming_request_id_accepted": accepted_incoming_id,
                    **current_trace_fields(),
                    "service": "moderation-api",
                    "route": request.url.path,
                    "method": request.method,
                    "status_code": getattr(response, "status_code", 500),
                    "latency_ms": latency_ms,
                }
            )
        )
        if response is not None:
            response.headers["x-request-id"] = request_id
        request_id_var.reset(token)
```
:::

The middleware creates one context for the request. It accepts only a bounded character set and length from the incoming header, which prevents control characters, huge values, and log-forging payloads from entering the evidence stream. ClearFrame's public edge removes client-supplied `X-Request-ID` and creates a trusted value; internal services may forward that value after authentication. The application still validates it because trust boundaries and proxy configurations can change.

The endpoint can pull `request.state.request_id` and write a prediction event with the same value. The request ID is an application correlation value, while the W3C `traceparent` header carries distributed trace context. The service keeps `request_id`, `trace_id`, and `span_id` as separate fields rather than copying one into another. In production, many teams use a JSON logging library or a logging framework formatter rather than calling `json.dumps` directly, yet the important shape stays the same: one JSON object, stable keys, and no sensitive payload fields.

![ClearFrame request ID connects the evidence](/content-assets/articles/article-mlops-monitoring-and-feedback-logging-prediction-requests-responses/clearframe-request-id-evidence.png)
*A shared request ID lets support, traces, HTTP logs, and prediction logs point to the same moderation decision without copying the raw image into general logs.*

## Log The Response Without Leaking The Payload
<!-- section-summary: The response log should describe the model decision, score, version, policy, and runtime outcome while raw payloads remain outside the general log stream. -->

The prediction event is the log line the ML team usually cares about most. It records the safe request summary, the model identity, the response summary, and runtime evidence. ClearFrame logs one prediction event per moderation request after the model returns.

```json
{
  "event": "moderation_prediction",
  "schema_version": 1,
  "request_id": "a3fe3f5c-37dc-4b4d-9c61-2b7042dbb482",
  "trace_id": "a7b3d42f81294385a4b218c1f7ab5130",
  "span_id": "4d51f2b0a9c18492",
  "service": "moderation-api",
  "environment": "prod",
  "route": "/v1/moderate-image",
  "region": "us-east-1",
  "model_name": "clearframe-vision-moderator",
  "model_version": "vision-mod-2026-06-28",
  "threshold_policy_version": "policy-2026-07-03",
  "image_sha256": "d9f6a4bb7df2c4973f8c3eac...",
  "image_width": 1280,
  "image_height": 720,
  "mime_type": "image/jpeg",
  "source_surface": "creator_upload",
  "user_id_hash": "hmac:v1:1b483a9c...",
  "account_age_bucket": "30_90_days",
  "top_label": "medical",
  "top_score": 0.82,
  "decision": "send_to_review",
  "review_reason": "medical_confidence_band",
  "latency_ms": 186.4,
  "feature_fetch_ms": 11.8,
  "status_code": 200
}
```

This log line supports several workflows. An engineer can filter by `request_id` and jump to the trace. A data scientist can group by `model_version`, `top_label`, and `source_surface` to inspect decision patterns. A trust and safety reviewer can use `image_sha256` inside an approved review tool to find the original image when an appeal requires it. The log itself still avoids raw image content and direct account identifiers.

The endpoint writes this event after inference from already sanitized image metadata. Log safety therefore happens before the logger receives the object, which keeps a later formatter or exporter from accidentally seeing raw payload fields.

:::expand[Build the structured prediction event in application code]{kind="example"}
The full helper below maps the model result and safe metadata into the event schema. It rounds numeric fields, attaches release and policy identity, and reuses request and trace context without accepting direct user identifiers.

```python
from pydantic import BaseModel


class ModerationResult(BaseModel):
    top_label: str
    top_score: float
    decision: str
    review_reason: str | None = None


def log_prediction_event(
    *,
    request: Request,
    image_meta: dict,
    result: ModerationResult,
    model_version: str,
    policy_version: str,
    latency_ms: float,
) -> None:
    event = {
        "event": "moderation_prediction",
        "schema_version": 1,
        "request_id": request.state.request_id,
        **current_trace_fields(),
        "service": "moderation-api",
        "environment": "prod",
        "route": request.url.path,
        "model_name": "clearframe-vision-moderator",
        "model_version": model_version,
        "threshold_policy_version": policy_version,
        "image_sha256": image_meta["sha256"],
        "image_width": image_meta["width"],
        "image_height": image_meta["height"],
        "mime_type": image_meta["mime_type"],
        "source_surface": image_meta["source_surface"],
        "user_id_hash": image_meta["user_id_hash"],
        "account_age_bucket": image_meta["account_age_bucket"],
        "top_label": result.top_label,
        "top_score": round(result.top_score, 4),
        "decision": result.decision,
        "review_reason": result.review_reason,
        "latency_ms": round(latency_ms, 2),
        "status_code": 200,
    }
    logger.info(json.dumps(event, separators=(",", ":")))
```
:::

The code receives sanitized `image_meta`. That matters because log safety should happen before the logging call. A helper that hashes user ids, strips tokenized URLs, and computes image metadata gives the endpoint a safe object by design. The logger then writes only fields allowed by the schema.

## Redact, Sample, And Retain Logs Deliberately
<!-- section-summary: Production prediction logging needs redaction before export, sampling for volume control, and retention windows that match debugging, audit, and privacy needs. -->

Application code should write safe logs, and the telemetry pipeline should provide another guardrail. OpenTelemetry Collector processors can modify telemetry before export. The attributes processor can delete or hash attributes on spans, logs, and metrics, which gives the platform team a central place to remove fields that slipped through or normalize sensitive identifiers.

The Collector provides a second guardrail after application-side redaction. It can delete tokenized URLs, remove payload fields, and hash a legacy user ID before export while retaining request and trace correlation.

:::expand[Apply a central OpenTelemetry log-redaction policy]{kind="example"}
This fragment shows the central policy. It supports older services during migration, but it should never serve as the only redaction layer because the application understands field meaning and data classification more accurately.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
      http:

processors:
  attributes/moderation_redaction:
    actions:
      - key: image_url_with_token
        action: delete
      - key: access_token
        action: delete
      - key: user_id
        action: hash
      - key: caption_text
        action: delete
      - key: raw_image_bytes
        action: delete

  batch:

exporters:
  otlp/logs:
    endpoint: logs-gateway.observability.svc.cluster.local:4317

service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [attributes/moderation_redaction, batch]
      exporters: [otlp/logs]
```
:::

Redaction reduces risk, while sampling controls volume. ClearFrame keeps every prediction log for review decisions, blocks, and errors because those events are operationally important. It samples high-volume `allow` decisions at 10 percent after the daily quality tables receive their aggregate counts. The sampling policy is written down so data scientists understand which logs are complete and which logs are a sample.

```yaml
prediction_logging_policy:
  keep_full_rate:
    - decision: block
    - decision: send_to_review
    - status_code: "5xx"
    - top_score_range: "0.45_0.65"
  sample_rate:
    decision_allow: 0.10
  aggregate_tables:
    daily_counts_by_model_label_surface: required
    daily_latency_by_model_region: required
```

Retention is a product, legal, and operations decision. ClearFrame keeps hot searchable prediction logs for 30 days, archived audit logs for 180 days with tighter access, and aggregate monitoring tables for 13 months. The exact numbers vary by company and regulation, so the important practice is to define retention by data class and purpose instead of leaving logs in the backend forever.

![ClearFrame logging pipeline controls](/content-assets/articles/article-mlops-monitoring-and-feedback-logging-prediction-requests-responses/clearframe-logging-pipeline-controls.png)
*The logging pipeline applies controls after the app writes safe JSON: redact risky fields, keep high-value events, sample high-volume allows, and retain each class for a defined purpose.*

An Elastic Index Lifecycle Management policy can implement this lifecycle with a daily or size-based hot-index rollover, a warm phase after seven days, and deletion after the approved searchable window. The general prediction-log index follows that operational policy. The archived audit copy lives in a separate controlled store with its own retention and access rules. Separating those paths keeps daily debugging fast while keeping sensitive review evidence under a stricter workflow.

## Use Logs During Incidents And Reviews
<!-- section-summary: Prediction logs help responders join a user report to model version, decision policy, request timing, and repeated patterns across similar requests. -->

Now imagine ClearFrame receives an incident report: plant-care photos with beige backgrounds are being sent to review after the latest model rollout. Metrics show fallback and latency are normal, so the service is healthy. The question shifts to prediction behavior. Prediction logs give the team a starting set of facts without pulling raw images first.

The responder filters logs for the model version, the decision, and the source surface. In the query, `p50_score` is the median score and `p95_score` is the 95th-percentile score, meaning 95 percent of logged scores are at or below it.

```sql
SELECT
  model_version,
  threshold_policy_version,
  top_label,
  decision,
  source_surface,
  COUNT(*) AS predictions,
  APPROX_PERCENTILE(top_score, 0.50) AS p50_score,
  APPROX_PERCENTILE(top_score, 0.95) AS p95_score
FROM moderation_prediction_logs
WHERE event_time >= TIMESTAMP '2026-07-05 09:00:00'
  AND source_surface = 'creator_upload'
  AND decision = 'send_to_review'
GROUP BY
  model_version,
  threshold_policy_version,
  top_label,
  decision,
  source_surface
ORDER BY predictions DESC;
```

The result shows a sharp increase in `top_label="medical"` for `vision-mod-2026-06-28`, tied to `policy-2026-07-03`. The team pulls a small approved review sample through the trust and safety tool, confirms that many images show plant leaves against a skin-tone background, and changes the policy threshold for that confidence band while the ML team prepares a model fix.

The logs also show whether the issue is isolated or broad. If only one source surface changed, the team checks that upload path. If only one model version changed, rollback or traffic reduction is likely. If multiple versions show the same issue after a policy update, the threshold policy is the stronger suspect. Prediction logs shorten the path from complaint to evidence.

## Operational Checks And Failure Modes
<!-- section-summary: Strong prediction logging gives each prediction a joinable, privacy-aware, structured record with clear ownership, sampling rules, and retention. -->

Before shipping prediction logging, check the schema with security, privacy, ML, and support reviewers. The event should include request id, trace id, model name, model version, safe input summary, output summary, decision, latency, status, and owner labels. The forbidden-field list should include raw payloads, secrets, direct account identifiers, tokenized URLs, and free text that may contain private details. The redaction test should run in CI against example logs.

The common mistakes are predictable. Teams log complete request bodies because it helps local debugging, then production logs accumulate sensitive payloads. They skip request ids, which makes support investigations slow. They log model scores without model versions, which makes release analysis weak. They sample everything uniformly, which loses rare failures and review decisions. They keep logs indefinitely because nobody owns retention.

Prediction logs are structured records for inference events. They connect a request ID, trace ID, model version, sanitized input summary, prediction output, policy decision, latency, and status. The logging boundary must preserve enough evidence for investigation without copying sensitive payloads into a broad observability system. Metrics show aggregate health, traces show the service path, and prediction logs explain the specific decision that teams need to query, review, sample, and retain.

## References

- [OpenTelemetry Log Specification](https://opentelemetry.io/docs/specs/otel/logs/)
- [OpenTelemetry Collector Attributes Processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/attributesprocessor/README.md)
- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [Elastic Index Lifecycle Management](https://www.elastic.co/docs/manage-data/lifecycle/index-lifecycle-management)
- [FastAPI Middleware](https://fastapi.tiangolo.com/tutorial/middleware/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
