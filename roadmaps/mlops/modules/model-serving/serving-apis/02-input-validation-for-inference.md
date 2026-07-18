---
title: "Input Validation"
description: "Validate inference inputs before model execution with type checks, range checks, business rules, schema versions, and safe error handling."
overview: "Input validation protects inference services by enforcing structural, semantic, temporal, compatibility, and resource rules before model execution, then making failures observable and safe for callers."
tags: ["MLOps", "core", "api"]
order: 2
id: "article-mlops-model-serving-input-validation-for-inference"
aliases:
  - roadmaps/mlops/modules/model-serving/serving-apis/03-input-validation-for-inference.md
  - child-serving-apis-03-input-validation-for-inference
---

## Validation Protects The Model Boundary
<!-- section-summary: Input validation checks inference requests before model execution so broken payloads never turn into misleading predictions. -->

**Input validation** is the serving step that checks a prediction request before the model runs. It verifies required fields, types, ranges, enum values, schema versions, cross-field rules, and payload size. If the request fails the contract, the service returns a clear error and skips model execution.

This topic builds on the request-design article. A request contract says what the caller should send. Validation enforces that contract every time. The model should not receive a missing timestamp, a negative claim amount, a stale feature schema, or a field that changed meaning after a client release.

Validation is not only a neat API feature. It is a production safety control. It protects model latency because invalid requests stop early. It protects prediction logs because bad inputs receive explicit error records. It protects incident response because validation failure rates can reveal a broken client deploy before customers report strange predictions.

The main idea is simple: reject broken requests at the boundary where the caller can still fix them. If the request reaches feature transformation and model execution, the serving team has already lost the cleanest place to explain the problem.

Validation has five layers. **Structural rules** check presence, types, shape, and size. **Semantic rules** check units, ranges, categories, and cross-field meaning. **Temporal rules** check event order, staleness, and prediction-time availability. **Compatibility rules** identify the schema and feature contract the caller uses. **Operational rules** limit work and produce stable failures, metrics, and safe logs. Authentication, authorization, rate limiting, and adversarial-input defenses surround these layers but remain distinct controls.

The layers should fail differently. A missing required field is a repairable client error. An unknown schema version may require a client upgrade. A payload beyond the resource limit should stop before expensive parsing or inference. An internal feature lookup failure is a service error, not evidence that the caller's data was invalid. Stable categories let product clients respond correctly and let operators see which boundary is degrading.

## A Claim Severity API As A Supporting Example
<!-- section-summary: A claim-severity example shows how structural, semantic, temporal, and compatibility rules protect one serving boundary. -->

Imagine **Cedar Mutual**, an insurance company that receives auto claims through a mobile app and a call-center workflow. The model predicts whether a claim will need senior adjuster review. The prediction helps route work: high-severity claims go to experienced adjusters, straightforward claims go to the normal queue.

The request uses structured claim facts: accident time, report time, estimated damage, injury indicator, vehicle age, location state, and whether the vehicle is drivable. Bad input has real cost. A negative damage amount can send a claim into the wrong queue. A report timestamp before the accident time can create nonsense feature values. A stale schema can drop a new injury field the model expects.

The first serving contract is:

| Field | Example | Validation reason |
|---|---|---|
| `request_id` | `claim_20260705_5512` | Join logs and caller errors |
| `claim_id` | `clm_842193` | Connect prediction to claim workflow |
| `accident_time_utc` | `2026-07-05T12:10:00Z` | Builds delay features |
| `reported_time_utc` | `2026-07-05T13:35:00Z` | Must come after accident time |
| `estimated_damage_cents` | `275000` | Numeric range and currency unit |
| `vehicle_age_years` | `7` | Range check |
| `injury_reported` | `true` | Routing signal |
| `vehicle_drivable` | `false` | Routing signal |
| `state` | `CA` | Controlled geography |
| `feature_schema_version` | `claim_severity_features_v2` | Prevent stale clients |

That table is the validation plan. Each row says what the caller sends and why the API cares.

![Cedar Mutual claim severity request crossing a Pydantic boundary with type checks, range checks, schema version checks, and business rules before model scoring or a 422 response.](/content-assets/articles/article-mlops-model-serving-input-validation-for-inference/claim-validation-boundary.png)

*Validation protects the model boundary by checking the Cedar Mutual claim payload before it reaches scoring.*

## Validate Types, Ranges, And Required Fields
<!-- section-summary: Basic validation catches missing fields, wrong types, out-of-range values, and stale schema versions. -->

The first layer of validation belongs in the Pydantic request model. This layer should be boring and explicit: required fields are required, numbers have ranges, strings have lengths, and schema versions use a controlled value.

```python
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ClaimSeverityRequest(BaseModel):
    request_id: str = Field(min_length=12, max_length=100)
    claim_id: str = Field(min_length=6, max_length=80)
    accident_time_utc: datetime
    reported_time_utc: datetime
    estimated_damage_cents: int = Field(ge=0, le=20_000_000)
    vehicle_age_years: int = Field(ge=0, le=60)
    injury_reported: bool
    vehicle_drivable: bool
    state: str = Field(pattern=r"^[A-Z]{2}$")
    feature_schema_version: Literal["claim_severity_features_v2"]
```

The ranges should come from the business and training data review, not from a guess. `estimated_damage_cents` allows up to `$200,000` because this API handles normal auto claims, while total-loss and specialty claims go through a separate workflow. `vehicle_age_years` allows older vehicles because the company still sees classic cars, yet a value of `400` should fail. The state pattern checks the two-letter shape; a separate approved-jurisdiction set should enforce membership because syntactic shape alone cannot distinguish a real code from `ZZ`.

FastAPI will use this model to parse the JSON body. If the client sends `"estimated_damage_cents": "many"`, Pydantic rejects the type. If the client sends `-2000`, the range check fails. If the client sends `claim_severity_features_v1`, the schema version fails. The model function never runs.

## Add Business Rules With Pydantic Validators
<!-- section-summary: Custom validators catch cross-field mistakes that simple type and range checks cannot catch. -->

Types and ranges catch many broken requests. Real inference payloads also need cross-field rules. For Cedar Mutual, the report time should be the same as or after the accident time. A claim with serious injury and `vehicle_drivable=true` may still be valid, so the validator should focus on rules the business truly treats as impossible or unsupported.

Pydantic validators let the model class check those rules after field parsing:

:::expand[Implement the cross-field rules and manual-review route]{kind="example"}

```python
from pydantic import model_validator


class ClaimSeverityRequest(BaseModel):
    request_id: str = Field(min_length=12, max_length=100)
    claim_id: str = Field(min_length=6, max_length=80)
    accident_time_utc: datetime
    reported_time_utc: datetime
    estimated_damage_cents: int = Field(ge=0, le=20_000_000)
    vehicle_age_years: int = Field(ge=0, le=60)
    injury_reported: bool
    vehicle_drivable: bool
    state: Literal[
        "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
        "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD",
        "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH",
        "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC",
        "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY",
        "DC"
    ]
    feature_schema_version: Literal["claim_severity_features_v2"]

    @model_validator(mode="after")
    def check_time_order(self) -> "ClaimSeverityRequest":
        if self.reported_time_utc < self.accident_time_utc:
            raise ValueError("reported_time_utc must be at or after accident_time_utc")
        return self

    @model_validator(mode="after")
    def check_large_claim_context(self) -> "ClaimSeverityRequest":
        if self.estimated_damage_cents >= 10_000_000 and self.vehicle_drivable:
            raise ValueError(
                "claims over 100000 dollars require vehicle_drivable=false or manual review"
            )
        return self
```

The second validator is a business routing rule. It does not say the world can never produce a drivable vehicle with a large estimate. It says this specific API should route that case to manual review because the claim is outside the model's reviewed operating range. That is the right place for validation to meet model governance.

The serving endpoint can keep manual-review behavior explicit:

```python
from fastapi import HTTPException


@app.post("/v1/claim-severity:predict", response_model=ClaimSeverityResponse)
def predict_claim_severity(body: ClaimSeverityRequest, request: Request):
    if body.estimated_damage_cents >= 10_000_000:
        raise HTTPException(
            status_code=422,
            detail={
                "error_code": "OUTSIDE_MODEL_OPERATING_RANGE",
                "message": "Large claims require senior adjuster review without ML routing.",
                "request_id": body.request_id,
                "retryable": False,
            },
        )

    features = build_claim_features(body)
    score = float(request.app.state.model.predict(features)[0])
    return build_response(body, score, request.app.state.model_version)
```

This keeps the model away from cases the review team has excluded. It also gives the caller a clear next step: send the claim to senior adjuster review.

:::

![Cedar Mutual claim payload routed through time-order, schema, and large-claim validation rules to 422 client error, senior adjuster review, or 503 service error outcomes.](/content-assets/articles/article-mlops-model-serving-input-validation-for-inference/claim-validation-rules-outcomes.png)

*The validation outcome should tell the caller whether to fix the payload, route the claim to senior review, or retry a service failure.*

## Separate Client Errors From Service Errors
<!-- section-summary: Validation failures should produce client errors, while model load failures and dependency failures should produce service errors. -->

An inference API should separate errors by owner. A missing required field is usually a caller problem. A broken model artifact is a serving problem. A feature store timeout may involve another platform dependency. If all of those failures return the same vague `500`, the caller and on-call team lose useful information.

Use a small error policy:

| Failure | Status | Retryable | Owner |
|---|---:|---|---|
| Missing required field | `422` | `false` | Caller |
| Field outside range | `422` | `false` | Caller or product workflow |
| Unsupported schema version | `422` | `false` | Caller migration |
| Model still loading | `503` | `true` | Serving platform |
| Feature dependency timeout | `503` or fallback response | `true` with backoff | Serving and dependency owners |
| Unexpected model exception | `500` | `false` until investigated | Serving owner |

FastAPI's default validation body is already structured. A team can wrap it with its own `error_code` format if callers need a stable cross-service error shape. The important rule is that invalid input should not look like a model failure. Dashboards should show validation failures separately from runtime failures.

## Log Validation Failures Without Leaking Data
<!-- section-summary: Validation logs should count and explain failures while avoiding raw personal data or unbounded high-cardinality fields. -->

Validation errors are useful signals, so the service should log them. The log should include enough information to debug the caller and schema. It should avoid raw free text, private claim notes, or every unique raw field value. Even structured fields can carry privacy risk when logs live longer than the request path.

A validation log event can look like this:

```json
{
  "event": "inference_validation_failed",
  "endpoint": "/v1/claim-severity:predict",
  "request_id": "claim_20260705_5512",
  "caller": "claims-mobile-api",
  "feature_schema_version": "claim_severity_features_v1",
  "error_code": "UNSUPPORTED_FEATURE_SCHEMA",
  "field": "feature_schema_version",
  "model_name": "claim-severity",
  "accepted_schema_versions": ["claim_severity_features_v2"]
}
```

That event is enough for on-call to see the problem. The mobile API is sending the old schema. The model version may be healthy. The fix belongs in the client migration path.

Validation logs should also avoid storing raw user-provided strings unless the privacy review approves them. For this Cedar Mutual API, the request is structured and does not include claim notes. If a future API accepts text, the serving team should decide whether to hash, redact, sample, or skip the raw content in logs.

## Monitor Validation Drift
<!-- section-summary: Validation failure rates can reveal stale clients, upstream schema drift, broken data joins, and bad release coordination. -->

Validation failures are a serving metric. A stable service may see a tiny baseline of bad requests. A sudden spike often points to a client release, upstream schema change, or expired migration window.

Useful metrics include:

| Metric | Why it helps |
|---|---|
| `inference_requests_total{status="accepted"}` | Tracks normal traffic |
| `inference_validation_failures_total{field="feature_schema_version"}` | Finds stale clients |
| `inference_validation_failures_total{field="estimated_damage_cents"}` | Finds bad upstream amount mapping |
| `inference_validation_failure_rate{caller="claims-mobile-api"}` | Separates one bad caller from global failure |
| `inference_payload_size_bytes` | Finds oversized requests before they hurt latency |

OpenTelemetry metrics can carry these counters and histograms to the team's monitoring backend. Keep labels low-cardinality. A label such as `field` is useful because there are few fields. A label such as `claim_id` is harmful because every claim creates a new time series.

A simple alert can watch schema failures:

```yaml
alert: ClaimSeverityUnsupportedSchemaSpike
expr: |
  sum(rate(inference_validation_failures_total{
    endpoint="/v1/claim-severity:predict",
    error_code="UNSUPPORTED_FEATURE_SCHEMA"
  }[10m])) > 5
for: 15m
labels:
  severity: page
annotations:
  summary: "Claim severity API is receiving unsupported schema versions"
  runbook: "Check caller release versions and accepted feature schema versions."
```

This alert points the on-call person to the right investigation. It does not say the model is inaccurate. It says callers are sending a contract version the service rejects.

## Secure the Boundary Beyond Validation
<!-- section-summary: Authentication, authorization, TLS, network policy, rate limits, and request budgets protect the serving path around the validated JSON body. -->

Pydantic proves that a request has the expected shape. The production boundary also needs to prove **who sent it**, **what that caller may do**, **how traffic is protected**, and **how much work one caller can demand**. These controls solve different problems, so passing schema validation should never grant access by itself.

For Cedar Mutual, the platform and application teams divide the boundary like this:

| Control | Question it answers | Practical ownership |
|---|---|---|
| **Authentication** | Which workload or user sent the request? | The API gateway validates a short-lived OIDC access token, including issuer, audience, signature, and expiry. |
| **Authorization** | May that identity call this operation? | The gateway and API require a narrow scope such as `claims:predict`; access to admin or explanation routes uses separate scopes. |
| **TLS** | Is traffic encrypted and is the peer identity checked? | The gateway terminates client TLS. The platform also uses reviewed gateway-to-backend TLS or service-mesh mTLS when the threat model requires it. |
| **Network policy** | Which workloads can reach the model pods? | Kubernetes allows ingress from the gateway namespace and blocks unrelated pod traffic. The cluster network plugin must enforce NetworkPolicy. |
| **Rate limit** | How quickly may one caller send requests? | The gateway applies per-client or per-tenant limits and returns `429` with retry guidance. Limits come from capacity tests and product priority. |
| **Request budget** | How much time and work may one request consume? | The boundary caps body size, batch count, feature lookups, queue wait, and end-to-end deadline before expensive inference starts. |

FastAPI can declare OAuth2 scopes through its `Security` dependencies, while many teams validate tokens and apply coarse scopes at the gateway as well. The service should still receive a trusted caller identity for audit and fine-grained product rules. It should avoid trusting a caller-supplied header such as `X-User-Role` unless the gateway removes external copies and writes a verified value.

A short policy record keeps these controls reviewable without binding the API contract to one gateway product:

:::expand[Inspect the boundary and NetworkPolicy configuration]{kind="example"}

```yaml
inference_boundary:
  token:
    issuer: https://identity.cedarmutual.example/
    audience: claim-severity-api
    required_scope: claims:predict
  transport:
    client_to_gateway: tls
    gateway_to_service: tls_with_backend_certificate_validation
  limits:
    requests_per_minute_per_client: 600
    max_request_bytes: 32768
    max_batch_items: 1
    end_to_end_timeout_ms: 800
  overload_response:
    status: 429
    retry_after_seconds: 2
```

The numbers are example operating values for this scenario. The serving owner should derive them from load tests, downstream capacity, caller retry behavior, and the safe fallback. A timeout budget should leave time for the caller to use its fallback instead of consuming the caller's entire deadline inside model inference.

Kubernetes NetworkPolicy adds a separate network boundary. This example allows only gateway pods in the labeled gateway namespace to reach the claim model on port `8080`:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: claim-severity-ingress
  namespace: ml-serving
spec:
  podSelector:
    matchLabels:
      app: claim-severity-api
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: api-gateway
          podSelector:
            matchLabels:
              app: inference-gateway
      ports:
        - protocol: TCP
          port: 8080
```

NetworkPolicy works at the network layer; it does not verify JWT scopes or replace TLS. The platform team should test the policy with an allowed gateway pod and a denied unrelated pod. It should also verify the cluster's network plugin actually enforces the resource. Together, these controls give the inference API a layered boundary: the network restricts reachability, TLS protects traffic, identity and scopes control access, validation protects the model contract, and rate or request budgets protect capacity.

:::

## Roll Out Validation Safely
<!-- section-summary: Stricter validation should ship with shadow counts, caller communication, migration windows, and rollback controls. -->

Validation rules can break callers, so changes need release care. Adding a new required field, tightening a range, or removing an old schema version can produce a sudden wave of `422` responses. The serving team should treat validation changes as API changes.

Use a rollout sequence:

| Step | What happens |
|---|---|
| Observe | Log warnings for the future rule while still accepting requests |
| Share | Tell caller teams which requests would fail and when enforcement starts |
| Enforce in staging | Reject invalid staging traffic and require contract tests |
| Enforce in production | Reject invalid traffic after the migration window |
| Watch | Monitor failure rate by caller and field |
| Roll back | Re-enable the previous accepted schema version if a critical caller was missed |

For Cedar Mutual, the team might allow both `claim_severity_features_v1` and `claim_severity_features_v2` for two weeks. During the window, responses can include a warning header for v1 callers:

```python
@app.middleware("http")
async def add_schema_warning(request, call_next):
    response = await call_next(request)
    if getattr(request.state, "deprecated_schema_used", False):
        response.headers["x-ml-schema-warning"] = (
            "claim_severity_features_v1 retires on 2026-07-20"
        )
    return response
```

That warning is a bridge for the client team. It gives them a date, a schema, and a signal they can test before enforcement.

![Cedar Mutual validation rollout and monitoring path showing observe, share, staging enforcement, production enforcement, caller-field metrics, and rollback.](/content-assets/articles/article-mlops-model-serving-input-validation-for-inference/validation-rollout-monitoring.png)

*Stricter validation should ship through observation, caller communication, staging enforcement, production metrics, and rollback controls.*

## Putting It Together
<!-- section-summary: Input validation turns the API contract into a safety layer that protects model execution, client feedback, logs, metrics, and release migration. -->

Input validation is the guardrail at the model boundary. It checks that the request matches the contract, rejects impossible or unsupported cases, returns errors the caller can act on, and gives operators a clean signal when clients drift.

The Cedar Mutual claim API shows the practical shape. Pydantic handles fields, types, ranges, schema versions, and cross-field rules. Identity, scopes, TLS, NetworkPolicy, rate limits, and request budgets protect the wider serving path. The endpoint keeps manual-review cases outside the model's operating range. Logs and metrics show which caller broke which rule. Rollout controls let the team make validation stricter without surprising every client at once.

## References

- [FastAPI handling errors](https://fastapi.tiangolo.com/tutorial/handling-errors/)
- [FastAPI request body tutorial](https://fastapi.tiangolo.com/tutorial/body/)
- [Pydantic models](https://docs.pydantic.dev/latest/concepts/models/)
- [Pydantic validators](https://docs.pydantic.dev/latest/concepts/validators/)
- [FastAPI OAuth2 scopes](https://fastapi.tiangolo.com/advanced/security/oauth2-scopes/)
- [Kubernetes NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
- [Gateway API BackendTLSPolicy](https://gateway-api.sigs.k8s.io/reference/api-types/policy/backendtlspolicy/)
- [Envoy Gateway JWT authentication](https://gateway.envoyproxy.io/latest/tasks/security/jwt-authentication/)
- [Envoy Gateway global rate limiting](https://gateway.envoyproxy.io/latest/tasks/traffic/global-rate-limit/)
- [OpenTelemetry metrics](https://opentelemetry.io/docs/concepts/signals/metrics/)
- [OpenTelemetry Python instrumentation](https://opentelemetry.io/docs/languages/python/instrumentation/)
