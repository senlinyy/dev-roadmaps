---
title: "Model API Compatibility"
description: "Build model serving contracts that let product callers survive model swaps, alias moves, schema updates, and canary releases."
overview: "Backward-compatible model APIs keep approved requests and useful responses stable while the model version changes behind the endpoint. A supporting example follows a delivery ETA model through request and response contracts, MLflow and Databricks aliases, rollout gates, compatibility tests, and owners."
tags: ["MLOps", "production", "delivery"]
order: 1
id: "article-mlops-deployment-and-release-management-backward-compatible-model-apis"
aliases:
  - roadmaps/mlops/modules/deployment-and-release-management/release-strategies/03-backward-compatible-model-apis.md
  - child-release-strategies-03-backward-compatible-model-apis
---


## Why Model API Compatibility Matters
<!-- section-summary: A backward-compatible model API lets the model change while existing product callers keep sending valid requests and reading useful responses. -->

**Model API compatibility** means an approved caller can keep using a model endpoint after you release a new model version. The caller can send the same request shape, receive the same required response fields, and handle the same error categories. The model can improve, add optional metadata, or route to a new registered version behind the endpoint, while the product code keeps working.

Imagine ParcelPilot, a delivery company that shows customers an estimated arrival time. The mobile app calls `POST /v1/eta/predict` before checkout, the dispatcher screen calls it when assigning drivers, and the support dashboard calls it when a customer asks why an order will arrive late. A data science team trains `delivery_eta` version 18 with weather features and better holiday data. The serving team wants to promote it behind the same endpoint currently using version 17.

If the team changes the endpoint carelessly, small serving details can create product outages. A field called `delivery_minutes` might change from an integer to a string. A new required request field might make old mobile apps fail. A reviewed 90 percent prediction interval might quietly change to an 80 percent interval without a contract change, and the dispatcher screen might understate uncertainty. The model might have higher offline accuracy while the product breaks at the API boundary.

Backward compatibility gives the team a release rule before the model reaches production: **old approved clients must still work**. That rule protects product teams from surprise API changes, and it gives MLOps teams a safe path to release frequent model improvements. You can still introduce a new API version later, yet most model releases should happen behind a stable contract.

This article walks through that contract from the outside in. First we name the pieces that need compatibility. Then we design request and response schemas, connect the endpoint to model registry aliases, test compatibility in CI, and define owners for the release gate.

## The Compatibility Map
<!-- section-summary: Compatibility covers request shape, response shape, behavior, model version references, and ownership. -->

When teams first hear "API compatibility," they often think only about JSON fields. JSON matters, but a production model API has more moving parts. The endpoint is a promise between the model platform and every caller that depends on the prediction.

For ParcelPilot, the promise has these parts:

| Contract area | Beginner-friendly meaning | Production example |
|---|---|---|
| **Request contract** | What callers are allowed to send | `pickup_lat`, `dropoff_lat`, `order_created_at`, and `vehicle_type` keep the same names and types |
| **Response contract** | What callers can expect back | `eta_minutes`, interval bounds, `model_version`, and `explanation_codes` stay available |
| **Error contract** | How failures appear to callers | Bad input returns `422`, temporary serving failure returns `503`, and model fallback returns a clear fallback code |
| **Behavior contract** | The product meaning of the output | `eta_minutes` still means minutes from now, not arrival timestamp or rounded display text |
| **Version contract** | How the serving layer chooses the model | The endpoint targets an alias such as `Champion` instead of hardcoding a registry version in app code |
| **Owner contract** | Who approves and fixes each part | API owner, model owner, platform owner, product caller owner, and incident owner are named before release |

That table matters because compatibility failures usually cross team boundaries. The model owner may add a feature. The serving owner may update the container. The mobile owner may parse the response with strict client code. The product owner may depend on a threshold. A safe release names those boundaries before the canary starts.

The simplest rule is this: **make required things stable and make new things optional first**. A new model can add response metadata such as `traffic_bucket` or `calibration_band`. A new model should avoid requiring old callers to send a new field such as `rain_intensity` on day one. If the new feature really needs rain data, the serving layer can fill a default from an online feature store or route callers without that field to the older model until clients catch up.

![Backward-compatible ETA API](/content-assets/articles/article-mlops-deployment-and-release-management-backward-compatible-model-apis/backward-compatible-eta-api.png)

*ParcelPilot keeps mobile, dispatcher, and support callers pointed at the same ETA endpoint while model versions move behind the contract.*

## The Serving Contract
<!-- section-summary: The serving contract gives the endpoint a reviewed request schema, response schema, error shape, and version metadata. -->

A **serving contract** is the written shape of the model endpoint. It tells a caller what to send and what will come back. In web APIs, teams commonly publish that shape as an OpenAPI document, validate requests in the service, and keep sample requests as contract tests. OpenAPI describes the API surface in JSON or YAML, and JSON Schema gives the field-level rules for objects, strings, numbers, arrays, and optional fields.

For the ETA endpoint, the contract starts with a path:

```yaml
openapi: 3.1.0
info:
  title: ParcelPilot ETA Prediction API
  version: 1.4.0
paths:
  /v1/eta/predict:
    post:
      operationId: predictEta
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/EtaPredictionRequest"
            examples:
              checkout:
                value:
                  order_id: "ord_84721"
                  pickup_lat: 51.5072
                  pickup_lng: -0.1276
                  dropoff_lat: 51.5155
                  dropoff_lng: -0.0922
                  order_created_at: "2026-07-05T13:15:00Z"
                  vehicle_type: "bike"
      responses:
        "200":
          description: ETA prediction
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/EtaPredictionResponse"
        "422":
          description: Request failed validation
        "503":
          description: Prediction service temporarily unavailable
components:
  schemas:
    EtaPredictionRequest:
      type: object
      required:
        - order_id
        - pickup_lat
        - pickup_lng
        - dropoff_lat
        - dropoff_lng
        - order_created_at
        - vehicle_type
      properties:
        order_id:
          type: string
        pickup_lat:
          type: number
        pickup_lng:
          type: number
        dropoff_lat:
          type: number
        dropoff_lng:
          type: number
        order_created_at:
          type: string
          format: date-time
        vehicle_type:
          type: string
          enum: ["bike", "scooter", "car"]
        client_features:
          type: object
          additionalProperties: true
      additionalProperties: false
    EtaPredictionResponse:
      type: object
      required:
        - order_id
        - eta_minutes
        - eta_lower_minutes
        - eta_upper_minutes
        - interval_nominal_coverage
        - model_name
        - model_version
        - request_id
      properties:
        order_id:
          type: string
        eta_minutes:
          type: integer
          minimum: 0
        eta_lower_minutes:
          type: integer
          minimum: 0
        eta_upper_minutes:
          type: integer
          minimum: 0
        interval_nominal_coverage:
          type: number
          minimum: 0
          maximum: 1
        model_name:
          type: string
        model_version:
          type: string
        model_alias:
          type: string
        request_id:
          type: string
        explanation_codes:
          type: array
          items:
            type: string
      additionalProperties: true
```

The request schema stays strict with `additionalProperties: false` because surprise input fields can hide caller bugs. If the mobile app starts sending `pickupLatitude` instead of `pickup_lat`, the service should reject the request during validation instead of passing a half-empty feature vector into the model. That gives the caller a fast, visible fix.

The response schema allows extra fields with `additionalProperties: true`. That choice gives the model API room to add optional metadata later. Old clients can keep reading `eta_minutes` while interval-aware clients use the lower bound, upper bound, and named nominal coverage. The model team must measure actual interval coverage on held-out data and production segments. If the model has no reviewed interval, the API should omit interval fields through an explicit contract version instead of inventing a generic confidence value. Some client SDKs still use strict generated types, so the API owner should also tell client owners to ignore unknown response fields during deserialization.

The response also includes version metadata. `model_name`, `model_version`, and `model_alias` help the team connect a customer complaint to the exact model that answered the request. `request_id` connects the API response to logs, traces, and prediction tables. These fields may look like operations details, but they are part of the product contract once support and incident teams depend on them.

## Adding Fields Without Breaking Callers
<!-- section-summary: Safe model API changes add optional fields first, keep old fields stable, and move required changes through a versioned migration. -->

Now the data science team wants version 18 to use weather. The training data includes `rain_mm_last_hour`, `wind_speed_kph`, and `road_closure_count`. The model owner has two choices. They can require callers to send those fields immediately, or the serving layer can fetch them from a feature service while callers keep sending the old request.

The compatible path uses the second option first. The endpoint accepts the same request, then enriches it before calling the model:

```python
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EtaPredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: str
    pickup_lat: float
    pickup_lng: float
    dropoff_lat: float
    dropoff_lng: float
    order_created_at: datetime
    vehicle_type: str
    client_features: dict[str, Any] = Field(default_factory=dict)


class EtaPredictionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    order_id: str
    eta_minutes: int
    eta_lower_minutes: int
    eta_upper_minutes: int
    interval_nominal_coverage: float
    model_name: str
    model_version: str
    model_alias: str
    request_id: str
    explanation_codes: list[str] = Field(default_factory=list)
```

The request model rejects unknown top-level fields, which keeps the input contract clean. The response model allows extra fields, which keeps additive response changes safe. The important part is the release habit around these models. A field moves through stages before it can affect all callers:

| Change | Compatible release path |
|---|---|
| Add response field | Add it as optional, document it, keep old fields unchanged |
| Add request field | Add it as optional, backfill or default it in serving, track caller adoption |
| Rename response field | Add the new field, keep the old field during migration, publish a deprecation date |
| Change field type | Create a new field or new API version; keep the old type in the existing contract |
| Remove field | Remove only after callers have migrated and the API owner has evidence |
| Change model meaning | Keep the output definition stable, or create a new endpoint/version with product approval |

This is where model APIs differ from ordinary CRUD APIs. A field can keep the same name and type while the meaning drifts. If `interval_nominal_coverage` used to mean a reviewed 90 percent prediction interval and version 18 changes the construction method or target coverage, the JSON shape stays the same while the product contract changes. The team must either preserve the reviewed meaning or version the field and migrate callers.

![Add weather features safely](/content-assets/articles/article-mlops-deployment-and-release-management-backward-compatible-model-apis/add-weather-features-safely.png)

*The serving layer can enrich old requests with weather features, return optional metadata, and keep existing callers reading the required ETA fields.*

The API contract should therefore include plain product definitions:

```yaml
x-ml-contract:
  output_meaning:
    eta_minutes: "Predicted minutes from response time until customer delivery."
    eta_lower_minutes: "Lower bound of the reviewed prediction interval."
    eta_upper_minutes: "Upper bound of the reviewed prediction interval."
    interval_nominal_coverage: "Target coverage of the interval; actual coverage is monitored by segment."
  compatibility_window:
    response_fields: "Required fields remain stable for at least 180 days."
    request_fields: "New required fields require a new API version or migration plan."
  owners:
    api_owner: "ml-platform-serving@parcelpilot.example"
    model_owner: "eta-modeling@parcelpilot.example"
    product_owner: "delivery-experience@parcelpilot.example"
```

That metadata makes the review concrete. The model owner approves model quality, the API owner approves request and response shape, and the product owner approves the meaning of the output in the customer workflow.

## Model Aliases and Version References
<!-- section-summary: Registry aliases let serving code target a stable name while owners move the alias after validation. -->

After the API contract is stable, the next question is how the serving layer chooses the model. A fragile service hardcodes version 17 in application code. Every promotion needs a code change, and every rollback needs a code change. A safer serving layer points at a **model alias** such as `Champion`, while the registry maps that alias to a concrete model version.

In MLflow Model Registry, an alias is a named reference to a registered model version. The serving service can load `models:/prod.ml_team.delivery_eta@Champion`, and the registry owner can reassign `Champion` from version 17 to version 18 after validation. Databricks recommends Models in Unity Catalog for governed model lifecycle work, and Unity Catalog models use MLflow-compatible client APIs for aliases, permissions, lineage, and discovery.

The training job should log a model with a signature and an input example because the serving team needs to know the model input shape. In MLflow 3, use the `name=` parameter when logging a model rather than the older `artifact_path=` style.

```python
import mlflow
import mlflow.sklearn
from mlflow.models import infer_signature

input_example = training_frame[
    [
        "pickup_lat",
        "pickup_lng",
        "dropoff_lat",
        "dropoff_lng",
        "vehicle_type_encoded",
        "rain_mm_last_hour",
        "wind_speed_kph",
    ]
].head(5)

signature = infer_signature(input_example, model.predict(input_example))

mlflow.set_registry_uri("databricks-uc")

with mlflow.start_run(run_name="delivery-eta-v18"):
    mlflow.log_metric("mae_minutes", 4.8)
    mlflow.log_metric("p90_abs_error_minutes", 11.2)
    mlflow.sklearn.log_model(
        sk_model=model,
        name="delivery_eta_model",
        input_example=input_example,
        signature=signature,
        registered_model_name="prod.ml_team.delivery_eta",
    )
```

After the model passes offline evaluation and staging traffic checks, the registry owner can move aliases:

```python
from mlflow import MlflowClient

client = MlflowClient()

client.set_registered_model_alias(
    name="prod.ml_team.delivery_eta",
    alias="Candidate",
    version="18",
)

candidate = client.get_model_version_by_alias(
    name="prod.ml_team.delivery_eta",
    alias="Candidate",
)

print(candidate.version)
```

`Candidate` gives the rollout system a stable reference for the version under test. `Champion` should stay on version 17 until the canary gate passes. That small naming choice protects production callers because the release can shift traffic or aliases without asking mobile, dispatch, and support systems to change their own code.

## Compatibility Tests in CI
<!-- section-summary: Compatibility tests replay approved request and response examples before the model or endpoint can reach production. -->

A compatibility contract helps only when CI checks it. The release pipeline should fail before production if a new endpoint version rejects old requests, removes required response fields, changes important types, or changes the documented error shape.

ParcelPilot keeps a small set of approved contract examples in the API repository:

```json
{
  "name": "checkout_bike_order_v1",
  "request": {
    "order_id": "ord_84721",
    "pickup_lat": 51.5072,
    "pickup_lng": -0.1276,
    "dropoff_lat": 51.5155,
    "dropoff_lng": -0.0922,
    "order_created_at": "2026-07-05T13:15:00Z",
    "vehicle_type": "bike"
  },
  "required_response_fields": [
    "order_id",
    "eta_minutes",
    "eta_lower_minutes",
    "eta_upper_minutes",
    "interval_nominal_coverage",
    "model_name",
    "model_version",
    "request_id"
  ]
}
```

The CI test posts each old request to the candidate container and checks the response contract:

```python
import requests


def test_old_checkout_request_still_works(candidate_url, contract_example):
    response = requests.post(
        f"{candidate_url}/v1/eta/predict",
        json=contract_example["request"],
        timeout=2,
    )

    assert response.status_code == 200
    payload = response.json()

    for field in contract_example["required_response_fields"]:
        assert field in payload

    assert isinstance(payload["eta_minutes"], int)
    assert payload["eta_lower_minutes"] <= payload["eta_minutes"]
    assert payload["eta_minutes"] <= payload["eta_upper_minutes"]
    assert 0 < payload["interval_nominal_coverage"] < 1
    assert payload["model_name"] == "prod.ml_team.delivery_eta"
```

This test checks the endpoint from the caller's side. It does not care whether the service uses FastAPI, KServe, BentoML, a custom container, or a managed serving platform. The caller sends JSON and receives JSON. That keeps the compatibility test tied to the product boundary.

The model team should also keep model-level signature checks. The API contract says what callers send to the endpoint. The MLflow signature says what the model artifact expects after serving enrichment. If either shape changes, the release reviewer needs to know. The endpoint can remain backward compatible while the internal model signature changes, as long as the serving layer still maps old requests into the new model input.

A practical GitHub Actions gate might look like this:

```yaml
name: eta-api-compatibility

on:
  pull_request:
    paths:
      - "services/eta-api/**"
      - "contracts/eta-api/**"
      - ".github/workflows/eta-api-compatibility.yml"

jobs:
  contract-test:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - run: python -m pip install --require-hashes -r services/eta-api/requirements-dev.lock
      - run: pytest services/eta-api/tests/test_contract_compatibility.py
        env:
          CANDIDATE_MODEL_ALIAS: Candidate
```

The `environment: staging` line gives GitHub Actions a place to apply environment protection rules, secrets, and deployment approvals. The exact approval setup belongs in the repository settings, but the workflow should make the deployment target visible in code.

## Canary Gates and Owners
<!-- section-summary: A canary sends a small slice of traffic to the candidate model while owners watch compatibility, latency, errors, and prediction quality. -->

After CI passes, the team still needs a production-safe release step. A **canary** sends a small percentage of real traffic to the candidate version while most users stay on the stable version. This is useful for model APIs because offline metrics rarely cover every live segment. Weather, new restaurants, app versions, missing features, and customer behavior can show issues that validation data missed.

With Argo Rollouts, the platform team can define canary steps and pause points. A service mesh or ingress controller can handle precise traffic routing, and analysis checks can query Prometheus before the rollout moves forward.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: eta-api
  namespace: ml-serving
spec:
  replicas: 12
  strategy:
    canary:
      stableService: eta-api-stable
      canaryService: eta-api-canary
      trafficRouting:
        istio:
          virtualService:
            name: eta-api
            routes:
              - primary
      steps:
        - setWeight: 5
        - pause:
            duration: 20m
        - analysis:
            templates:
              - templateName: eta-compatibility-checks
        - setWeight: 25
        - pause:
            duration: 30m
        - setWeight: 50
        - pause:
            duration: 30m
```

The rollout checks should include API compatibility signals and model quality proxies. For example:

```yaml
groups:
  - name: eta-api-release
    rules:
      - alert: EtaApiCandidateValidationErrorsHigh
        expr: |
          sum(rate(http_requests_total{
            service="eta-api",
            status=~"4..",
            model_alias="Candidate"
          }[5m])) > 2
        for: 10m
        labels:
          severity: page
          owner: ml-platform-serving
        annotations:
          summary: "Candidate ETA API is rejecting too many requests"
```

This alert catches a classic compatibility failure: old callers send requests that the candidate endpoint rejects. The team should also watch `5xx` errors, 95th-percentile (**p95**) latency, fallback rate, missing feature rate, and online error proxy metrics such as customer ETA correction events. P95 is the latency that 95 percent of requests meet or beat. When labels arrive later, the model owner should compare actual arrival times against predictions by city, vehicle type, weather band, and app version.

Owners make the gate real:

| Owner | Release responsibility |
|---|---|
| **API owner** | Approves OpenAPI changes, compatibility tests, error shape, and client migration notes |
| **Model owner** | Approves offline evaluation, model signature, feature defaults, and quality thresholds |
| **Platform owner** | Owns rollout YAML, routing, serving health, capacity, and rollback commands |
| **Product caller owner** | Confirms mobile, dispatch, support, and batch callers can parse the response |
| **Incident owner** | Confirms alerts, runbook, escalation path, and rollback decision points |

A model release should stop if any owner cannot explain how to roll back their part. That sounds strict, but it saves time during incidents. The team wants the rollback path decided before the pager rings.

![Compatibility release gate](/content-assets/articles/article-mlops-deployment-and-release-management-backward-compatible-model-apis/compatibility-release-gate.png)

*The release gate joins contract examples, CI checks, aliases, canary traffic, owner review, and rollback choices before `delivery_eta` reaches full traffic.*

## Putting It Together
<!-- section-summary: A compatible model API separates caller stability from model improvement, then enforces that separation with schemas, aliases, tests, canaries, and owners. -->

Backward-compatible model APIs let teams improve models without surprising every product caller. The stable part is the API contract: approved requests keep working, required response fields stay useful, error categories stay predictable, and output definitions keep their product meaning. The flexible part is the model implementation behind the endpoint: the model version, internal features, registry alias, container image, and canary traffic can move through a controlled release process.

For ParcelPilot, version 18 can use weather features because the serving layer enriches old requests. The response can add optional metadata because clients keep parsing the required fields. MLflow and Databricks aliases let the platform target `Candidate` and `Champion` rather than asking callers to hardcode versions. CI replays old contract examples, and the canary gate watches live validation errors, latency, fallback, and prediction quality proxies.

The important habit is ownership. The model owner cannot carry API compatibility alone, and the API owner cannot judge prediction quality alone. A good release names the API, model, platform, product, and incident owners before production traffic moves. That gives the team a clean release path and a clean rollback path.

## References

- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [MLflow Model Signatures and Input Examples](https://mlflow.org/docs/latest/ml/model/signatures/)
- [Databricks: Manage model lifecycle in Unity Catalog](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/)
- [Databricks MLflow 3 for models](https://learn.microsoft.com/en-us/azure/databricks/mlflow/mlflow-3-install)
- [OpenAPI Specification v3.2.0](https://spec.openapis.org/oas/v3.2.0.html)
- [JSON Schema object reference](https://json-schema.org/understanding-json-schema/reference/object)
- [GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub Actions environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [Argo Rollouts canary strategy](https://argo-rollouts.readthedocs.io/en/stable/features/canary/)
- [Prometheus alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
