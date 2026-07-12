---
title: "FastAPI Model Serving"
description: "Build a small FastAPI inference service with Pydantic request models, safe model loading, health checks, and a clear prediction contract."
overview: "FastAPI model serving wraps a trained model in an HTTP API that accepts validated requests and returns versioned predictions. This article follows a hospital triage model from local artifact loading to a usable `/v1/triage-risk:predict` endpoint with Pydantic schemas, health checks, and smoke tests."
tags: ["MLOps", "core", "api"]
order: 1
id: "article-mlops-model-serving-serving-model-with-fastapi"
---

## Table of Contents

1. [FastAPI Turns A Model Into A Request Path](#fastapi-turns-a-model-into-a-request-path)
2. [Follow One Triage Service](#follow-one-triage-service)
3. [Design The Request And Response Models](#design-the-request-and-response-models)
4. [Load The Model Once At Startup](#load-the-model-once-at-startup)
5. [Write The Prediction Endpoint](#write-the-prediction-endpoint)
6. [Add Health And Readiness Checks](#add-health-and-readiness-checks)
7. [Test The Contract Locally](#test-the-contract-locally)
8. [Production Checks](#production-checks)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## FastAPI Turns A Model Into A Request Path
<!-- section-summary: FastAPI model serving exposes a trained model through an HTTP endpoint with typed input, typed output, and predictable error behavior. -->

**FastAPI model serving** means you put a trained model behind an HTTP API so another service can ask for predictions. The model still lives as a file or registered artifact, yet product code reaches it through a path such as `POST /v1/triage-risk:predict`. The API receives JSON, validates the fields, calls the model, and returns a response with scores and metadata.

That first definition matters because serving is where a model leaves the notebook world. A notebook can call `model.predict(row)` with any local object the author has in memory. A production API needs a contract that another team can use without seeing the notebook. The contract says which fields are required, which units they use, how errors look, and which model version produced the answer.

FastAPI is a good first serving framework because it connects Python type hints, Pydantic models, request parsing, validation, and OpenAPI documentation. You write Python classes for request and response shapes, and FastAPI uses those classes to read JSON bodies, convert types, reject invalid input, and generate interactive API docs.

In this article, the goal is small and concrete. We are going to serve one tabular model with a single prediction endpoint. Later articles can move the same contract into Docker, Kubernetes, KServe, BentoML, Ray Serve, or Triton. The first step is learning what a clean inference API looks like when you can still hold the whole service in one file.

## Follow One Triage Service
<!-- section-summary: The running example serves a hospital triage risk model that predicts whether a patient should receive a nurse review within fifteen minutes. -->

Imagine a regional hospital network called **Maple Clinic**. The call-center app collects a small set of structured fields when a patient calls about symptoms: age, symptom duration, pain score, fever, known conditions, and whether the patient reports shortness of breath. A model named `triage-risk` predicts the probability that the patient needs nurse review within fifteen minutes.

The model does not make the medical decision. It helps the call-center workflow sort cases so nurses see risky calls quickly. That distinction shapes the API. The response should include a probability, a risk band, the model version, and enough request metadata for audit. It should also reject broken input before the model runs, because a missing age or impossible pain score can create a misleading score.

Here is the contract the call-center team wants:

| Piece | Example | Why it matters |
|---|---|---|
| Endpoint | `POST /v1/triage-risk:predict` | Stable path for the caller |
| Request ID | `call_20260705_142355_0042` | Joins app logs, API logs, and prediction logs |
| Model version | `triage-risk-2026-07-04` | Shows which artifact produced the score |
| Response time target | p95 under `120 ms` | Keeps the call-center screen responsive |
| Fallback | Route to normal nurse queue | Keeps the workflow alive during API failure |
| Audit fields | risk score, risk band, feature schema version | Gives reviewers enough evidence after an incident |

Notice how the API contract already includes operations. We care about more than `predict()`. We care about latency, fallbacks, versioning, and evidence. That is what makes serving different from local experimentation.

## Design The Request And Response Models
<!-- section-summary: Pydantic models turn the JSON contract into Python classes that FastAPI can validate and document. -->

A **request model** describes the JSON the caller sends. A **response model** describes the JSON the API returns. In FastAPI, these models usually inherit from Pydantic `BaseModel`. Pydantic checks types and constraints, while FastAPI uses the models to parse the request body and publish the OpenAPI schema.

For Maple Clinic, the request model should use business names instead of feature-engineering shortcuts. A caller understands `pain_score` and `shortness_of_breath`. A caller should never need to know that the training code later transforms those fields into `x_07` and `x_11`.

```python
from typing import Literal

from pydantic import BaseModel, Field


class TriageRiskRequest(BaseModel):
    request_id: str = Field(min_length=8, max_length=80)
    patient_age_years: int = Field(ge=0, le=120)
    symptom_duration_hours: float = Field(ge=0, le=24 * 30)
    pain_score: int = Field(ge=0, le=10)
    has_fever: bool
    shortness_of_breath: bool
    known_condition_count: int = Field(ge=0, le=20)
    feature_schema_version: Literal["triage_features_v3"]


class TriageRiskResponse(BaseModel):
    request_id: str
    risk_probability: float = Field(ge=0, le=1)
    risk_band: Literal["low", "medium", "high"]
    review_within_minutes: int
    model_version: str
    feature_schema_version: str
```

The important parts are plain. `patient_age_years` has a range, `pain_score` uses the common 0-to-10 clinical input scale, and `feature_schema_version` pins the caller to the schema the model expects. A later schema can add a new value such as `triage_features_v4` after the serving team updates both model and client.

Pydantic is also useful because validation errors happen before model execution. If the caller sends `"pain_score": 14`, FastAPI returns a structured validation error instead of passing garbage into the model. That protects latency and protects the meaning of the prediction logs.

## Load The Model Once At Startup
<!-- section-summary: A serving process should load the model during startup, verify the artifact, and fail readiness when the model cannot run. -->

The next piece is model loading. A beginner often writes code that loads the model inside the request handler. That works in a notebook-sized demo, then falls apart under real traffic because every request pays disk, network, or deserialization cost. A serving process should load the model once during startup and reuse it for requests.

Maple Clinic stores the reviewed artifact as an MLflow model. MLflow models can carry a signature and input example, which helps serving code know the expected input and output shape. The service also keeps a small manifest beside the model with the version, checksum, training run, and feature schema.

The service can use FastAPI's lifespan hook to load and verify the model:

```python
from contextlib import asynccontextmanager
from pathlib import Path
import hashlib
import json

import mlflow.pyfunc
import pandas as pd
from fastapi import FastAPI


MODEL_DIR = Path("/models/triage-risk")
MANIFEST_PATH = MODEL_DIR / "serving_manifest.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest() -> dict:
    manifest = json.loads(MANIFEST_PATH.read_text())
    expected_hash = manifest["artifact_sha256"]
    actual_hash = sha256_file(MODEL_DIR / "model.pkl")
    if actual_hash != expected_hash:
        raise RuntimeError("model artifact hash mismatch")
    return manifest


@asynccontextmanager
async def lifespan(app: FastAPI):
    manifest = load_manifest()
    model = mlflow.pyfunc.load_model(str(MODEL_DIR))

    smoke_frame = pd.DataFrame(
        [
            {
                "patient_age_years": 44,
                "symptom_duration_hours": 5.0,
                "pain_score": 6,
                "has_fever": True,
                "shortness_of_breath": False,
                "known_condition_count": 1,
            }
        ]
    )
    prediction = model.predict(smoke_frame)
    if len(prediction) != 1:
        raise RuntimeError("model smoke test returned an unexpected shape")

    app.state.model = model
    app.state.model_version = manifest["model_version"]
    app.state.feature_schema_version = manifest["feature_schema_version"]
    yield


app = FastAPI(title="Maple Clinic Triage Risk API", lifespan=lifespan)
```

The smoke test is small, yet it catches many real release mistakes. It checks that the file exists, the checksum matches, MLflow can load the artifact, the runtime dependencies are available, and the model returns one prediction for one row. If any of those checks fail, the app should fail startup instead of accepting traffic with a broken model.

The manifest might look like this:

```json
{
  "model_name": "triage-risk",
  "model_version": "triage-risk-2026-07-04",
  "training_run_id": "mlflow-run-9bd65c",
  "feature_schema_version": "triage_features_v3",
  "artifact_sha256": "a6a5f0f6b8340e0b9fd7e57f6af2f1167b51d2d9b01bbef7d8e0cf5f6e43a911",
  "python_version": "3.12.5",
  "runtime_image": "ghcr.io/maple/triage-api@sha256:6b2f..."
}
```

That manifest gives the runtime the same discipline you saw in experiment tracking. A serving incident should let the team answer which model, which run, which schema, which image, and which checksum without guessing.

## Write The Prediction Endpoint
<!-- section-summary: The prediction endpoint converts validated request data into model features, calls the model, and returns a response with version metadata. -->

Now the endpoint can stay focused. FastAPI gives the function a validated `TriageRiskRequest`. The handler converts that request into the feature frame expected by the model, calls `predict`, maps the probability into a simple risk band, and returns a typed response.

```python
import time

import pandas as pd
from fastapi import Request


def to_feature_frame(body: TriageRiskRequest) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "patient_age_years": body.patient_age_years,
                "symptom_duration_hours": body.symptom_duration_hours,
                "pain_score": body.pain_score,
                "has_fever": body.has_fever,
                "shortness_of_breath": body.shortness_of_breath,
                "known_condition_count": body.known_condition_count,
            }
        ]
    )


def risk_band(probability: float) -> tuple[str, int]:
    if probability >= 0.65:
        return "high", 15
    if probability >= 0.35:
        return "medium", 60
    return "low", 240


@app.post("/v1/triage-risk:predict", response_model=TriageRiskResponse)
def predict_triage_risk(body: TriageRiskRequest, request: Request) -> TriageRiskResponse:
    started = time.perf_counter()
    features = to_feature_frame(body)
    raw_prediction = request.app.state.model.predict(features)
    probability = float(raw_prediction[0])
    band, review_minutes = risk_band(probability)
    elapsed_ms = (time.perf_counter() - started) * 1000

    request.app.state.logger.info(
        "triage_prediction",
        extra={
            "request_id": body.request_id,
            "model_version": request.app.state.model_version,
            "risk_band": band,
            "latency_ms": round(elapsed_ms, 2),
        },
    )

    return TriageRiskResponse(
        request_id=body.request_id,
        risk_probability=round(probability, 6),
        risk_band=band,
        review_within_minutes=review_minutes,
        model_version=request.app.state.model_version,
        feature_schema_version=request.app.state.feature_schema_version,
    )
```

The endpoint has three boundaries. The request model protects the entry point. `to_feature_frame` keeps feature conversion separate from HTTP plumbing. The response model protects the output shape. That separation makes review easier because the team can test feature conversion without starting a web server, and it can test the HTTP contract with one `curl` request.

![Maple Clinic triage request path through FastAPI, Pydantic validation, feature conversion, the loaded triage-risk model, and a typed response.](/content-assets/articles/article-mlops-model-serving-serving-model-with-fastapi/fastapi-triage-request-path.png)

*A serving endpoint is easier to review when the caller, request schema, feature frame, model call, and response evidence each have a clear boundary.*

## Add Health And Readiness Checks
<!-- section-summary: Health endpoints tell the platform whether the process is alive and whether the model is ready for traffic. -->

Most platforms need two different checks. **Liveness** says the process is alive. **Readiness** says the process can handle real traffic. The difference matters during model loading. A process may be alive while it is still downloading or verifying the model. The load balancer should wait until readiness passes before sending prediction requests.

```python
@app.get("/livez")
def livez() -> dict[str, str]:
    return {"status": "alive"}


@app.get("/readyz")
def readyz(request: Request) -> dict[str, str]:
    model = getattr(request.app.state, "model", None)
    if model is None:
        return {"status": "loading"}
    return {
        "status": "ready",
        "model_version": request.app.state.model_version,
        "feature_schema_version": request.app.state.feature_schema_version,
    }
```

In Kubernetes, `/livez` usually feeds a liveness probe and `/readyz` feeds a readiness probe. The liveness probe should stay cheap. The readiness probe can include model-loaded state, manifest state, or a cached smoke-test result. Avoid calling the model on every readiness check because probes can create extra load during incidents.

![Startup and readiness checks for the Maple Clinic triage API showing manifest verification, checksum, MLflow load, smoke test, app state, and ready or loading outcomes.](/content-assets/articles/article-mlops-model-serving-serving-model-with-fastapi/startup-readiness-checks.png)

*Readiness should wait for artifact verification, model loading, and a small smoke test before the platform sends prediction traffic.*

## Test The Contract Locally
<!-- section-summary: A local contract test should prove that valid requests work, invalid requests fail clearly, and the response includes version evidence. -->

Before packaging this service, the team should test the contract from the outside. That means sending JSON to the running API, not only calling Python functions. The command below starts the app with one worker, which matches the simple local test path.

```bash
fastapi dev app/main.py
```

Then send a valid request:

```bash
curl -s http://127.0.0.1:8000/v1/triage-risk:predict \
  -H 'content-type: application/json' \
  -d '{
    "request_id": "call_20260705_142355_0042",
    "patient_age_years": 44,
    "symptom_duration_hours": 5,
    "pain_score": 6,
    "has_fever": true,
    "shortness_of_breath": false,
    "known_condition_count": 1,
    "feature_schema_version": "triage_features_v3"
  }'
```

Expected response shape:

```json
{
  "request_id": "call_20260705_142355_0042",
  "risk_probability": 0.418214,
  "risk_band": "medium",
  "review_within_minutes": 60,
  "model_version": "triage-risk-2026-07-04",
  "feature_schema_version": "triage_features_v3"
}
```

Now send a broken request:

```bash
curl -s http://127.0.0.1:8000/v1/triage-risk:predict \
  -H 'content-type: application/json' \
  -d '{
    "request_id": "bad-call",
    "patient_age_years": 44,
    "symptom_duration_hours": 5,
    "pain_score": 14,
    "has_fever": true,
    "shortness_of_breath": false,
    "known_condition_count": 1,
    "feature_schema_version": "triage_features_v3"
  }'
```

FastAPI should return a validation error with a `422` status. The useful evidence is the location and reason for the failure. The client team can fix `pain_score` without reading server logs, and the model never receives a value outside the contract.

## Production Checks
<!-- section-summary: A production serving API needs artifact checks, contract tests, latency tests, logs, fallbacks, and rollback instructions. -->

Once the local path works, Maple Clinic can turn the example into a production checklist. This checklist keeps the first deployment honest before the team adds Docker or Kubernetes.

| Check | What the team verifies |
|---|---|
| Artifact identity | Manifest model version, MLflow run ID, checksum, feature schema |
| Startup safety | App fails readiness when the artifact hash, load, or smoke test fails |
| Contract tests | Valid request, invalid request, missing field, old schema version |
| Latency test | p50, p95, and p99 for one worker and the planned worker count |
| Logging | `request_id`, model version, risk band, latency, validation failures |
| Privacy review | Prediction logs avoid raw symptom notes or unnecessary patient identifiers |
| Fallback | Caller routes to standard nurse queue when the API times out |
| Rollback | Deployment can point back to the previous model artifact and image digest |

The fallback deserves a clear owner. If the API times out, the call-center app should avoid blocking the nurse workflow. It can send the case through the normal queue and mark the prediction as unavailable. That gives patients a safe path while the serving team investigates.

![Production checklist loop for the Maple Clinic triage API covering contract tests, p95 latency, structured logs, timeout fallback, privacy review, rollback, and the previous artifact.](/content-assets/articles/article-mlops-model-serving-serving-model-with-fastapi/production-serving-checks.png)

*The first production release needs contract tests, latency evidence, logs, fallback ownership, privacy review, and a rollback artifact before traffic ramps up.*

## Putting It Together
<!-- section-summary: FastAPI serving joins the model artifact, request schema, response schema, loading checks, endpoint code, health checks, and contract tests into one small service. -->

FastAPI model serving gives a trained model a reliable request path. The API receives validated JSON, turns it into model features, calls the loaded artifact, and returns a response with version evidence. The important production idea is that the model is only one part of the service. The request model, response model, startup checks, health endpoints, logs, fallback behavior, and rollback path carry just as much weight.

The Maple Clinic example stays deliberately small. That makes the serving surface visible. You can now point to the exact endpoint, JSON contract, model load path, readiness behavior, and test request. The next serving articles build from this base by improving request design, validation depth, runtime packaging, and scale behavior.

## References

- [FastAPI request body tutorial](https://fastapi.tiangolo.com/tutorial/body/)
- [FastAPI response model tutorial](https://fastapi.tiangolo.com/tutorial/response-model/)
- [FastAPI in containers with Docker](https://fastapi.tiangolo.com/deployment/docker/)
- [Pydantic models](https://docs.pydantic.dev/latest/concepts/models/)
- [Pydantic validators](https://docs.pydantic.dev/latest/concepts/validators/)
- [MLflow model signatures and input examples](https://mlflow.org/docs/latest/ml/model/signatures/)
- [MLflow pyfunc API](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.pyfunc.html)
