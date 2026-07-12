---
title: "Saving and Loading Models"
description: "Save and load model artifacts with signatures, manifests, checksums, smoke tests, and safe serving handoff instead of fragile notebook files."
overview: "Saving and loading models for serving means preserving the model file, input/output signature, runtime dependencies, feature schema, checksum, and review evidence. This article follows a used-car pricing model from training output to safe serving startup with MLflow model signatures and artifact checks."
tags: ["MLOps", "production", "packaging"]
order: 1
id: "article-mlops-model-serving-saving-loading-models-safely"
---

## Table of Contents

1. [A Saved Model Is A Serving Contract](#a-saved-model-is-a-serving-contract)
2. [Follow One Pricing Model](#follow-one-pricing-model)
3. [Save The Model With Signature Evidence](#save-the-model-with-signature-evidence)
4. [Package A Serving Manifest](#package-a-serving-manifest)
5. [Load The Model With Safety Checks](#load-the-model-with-safety-checks)
6. [Run A Smoke Test Before Readiness](#run-a-smoke-test-before-readiness)
7. [Handle Serialization Risk](#handle-serialization-risk)
8. [Review And Rollback](#review-and-rollback)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## A Saved Model Is A Serving Contract
<!-- section-summary: A saved model needs the artifact, schema, dependencies, signature, checksum, and review evidence that make serving predictable. -->

**Saving and loading models** means turning a trained model into an artifact that another process can load safely and use for predictions. The artifact is more than one binary file. A serving-ready model needs the model file, input and output shape, runtime dependencies, feature schema, version, checksum, training evidence, and a smoke test that proves the runtime can call it.

This article comes after the API contract articles because the API can only be reliable when the model artifact matches the request shape. If the API receives `vehicle_age_years` and the model expects `car_age`, the endpoint can validate JSON perfectly and still produce broken predictions. Safe loading connects the artifact to the same contract the API exposes.

The beginner trap is saving `model.pkl` from a notebook and copying it into a server. That file may load only with the exact Python package versions from the notebook. It may hide a changed feature order. It may carry serialization risk. It may lack the input example that tells a future serving engineer how to call it. Production serving needs a stronger handoff.

## Follow One Pricing Model
<!-- section-summary: The running example serves a used-car pricing model where feature order, dependency versions, and artifact identity matter. -->

Imagine **TrailAuto**, a marketplace for used cars. Sellers enter vehicle details, and the app suggests a listing price range. The model predicts `recommended_price_usd` from make, model year, mileage, trim, accident history, region, fuel type, and listing season. The pricing API appears in seller onboarding, so it needs fast startup, clear version evidence, and a safe rollback path.

The training team built a LightGBM model and logged it to MLflow. The serving team wants to load that model in a FastAPI service. The handoff should answer these questions:

| Question | Evidence needed |
|---|---|
| Which model is this? | Model name, model version, training run ID |
| What input shape does it expect? | MLflow signature, input example, feature schema version |
| Which packages does it need? | `requirements.txt`, lock file, runtime image digest |
| Can the service load it? | Startup load check and smoke prediction |
| Was the file changed after review? | SHA-256 checksum |
| How do we roll back? | Previous artifact URI and previous image digest |

If any of those answers are missing, the serving team can still hack together a demo. The risk appears when the model reaches production and the first incident asks for evidence.

![TrailAuto pricing model serving contract](/content-assets/articles/article-mlops-model-serving-saving-loading-models-safely/serving-contract-bundle.png)

*A serving handoff is a reviewed bundle, not a loose model file. TrailAuto needs the artifact, signature, manifest, checksum, dependency lock, and rollback pointer before the pricing API can start safely.*

## Save The Model With Signature Evidence
<!-- section-summary: MLflow model signatures and input examples record the shape a serving runtime should send into the model. -->

An **MLflow model signature** describes the model's expected inputs and outputs. An **input example** stores a small sample of valid input. Together, they help reviewers and serving code see the shape the model expects. MLflow uses these concepts across model logging and serving workflows.

The training code should log the model with a signature and input example at the moment it creates the reviewed artifact:

```python
import mlflow
import mlflow.lightgbm
from mlflow.models import infer_signature

from trailauto.data import load_training_frame
from trailauto.features import build_price_features
from trailauto.train import train_price_model


training_table = "warehouse.ml.used_car_prices_2026_06_30"
feature_schema_version = "used_car_price_features_v7"

df = load_training_frame(training_table)
X_train, X_valid, y_train, y_valid = build_price_features(
    df,
    schema_version=feature_schema_version,
)
model, metrics = train_price_model(X_train, y_train, X_valid, y_valid)

input_example = X_valid.head(5)
signature = infer_signature(input_example, model.predict(input_example))

with mlflow.start_run(run_name="used-car-pricer-2026-07-04"):
    mlflow.set_tags(
        {
            "owner": "pricing-ml",
            "training_table": training_table,
            "feature_schema_version": feature_schema_version,
            "git_sha": "51db4a8",
        }
    )
    mlflow.log_metrics(
        {
            "valid_mae_usd": metrics.valid_mae_usd,
            "valid_p90_abs_error_usd": metrics.valid_p90_abs_error_usd,
            "suv_segment_mae_usd": metrics.suv_segment_mae_usd,
        }
    )
    model_info = mlflow.lightgbm.log_model(
        model,
        name="model",
        input_example=input_example,
        signature=signature,
    )
```

The `name="model"` argument follows current MLflow model logging style. The logged model contains the trained artifact and metadata around how to call it. The signature is especially useful when serving moves to a different team. A platform engineer can open the model record and see which columns, types, and output shape the model expects.

The signature does not replace the API schema. The API schema describes what product services send. The model signature describes what the model runtime expects after feature transformation. They should match through a tested conversion layer.

## Package A Serving Manifest
<!-- section-summary: A serving manifest ties the model artifact to version, schema, checksum, runtime, owner, and rollback metadata. -->

The model artifact should travel with a small serving manifest. The manifest is a plain review object. It gives the serving process and the on-call team one file that explains what the artifact is and how it should run.

```json
{
  "model_name": "used-car-price",
  "model_version": "used-car-price-2026-07-04",
  "mlflow_run_id": "a823ed2b6f2c4b56aa38bde45c013317",
  "mlflow_model_uri": "models:/used-car-price@champion",
  "feature_schema_version": "used_car_price_features_v7",
  "input_example_path": "input_example.json",
  "artifact_sha256": "d8975d9510c4f3c8e7235d6db7f6d0d881a70508df048b00e6e8d50b2a4df936",
  "python_version": "3.12.5",
  "runtime_image": "ghcr.io/trailauto/price-api@sha256:1c7e...",
  "previous_model_version": "used-car-price-2026-06-27",
  "owner": "pricing-ml",
  "approved_by": "model-review-2026-07-05"
}
```

The checksum should cover the artifact file or model directory that serving loads. The exact checksum path depends on the storage layout, but the habit stays the same: reviewed bytes should match served bytes. If the artifact changes after approval, startup should fail.

The manifest also records the previous model version. That helps rollback. During an incident, the team should not search through dashboards to remember last week's artifact. The rollback pointer should sit next to the current serving evidence.

## Load The Model With Safety Checks
<!-- section-summary: Safe loading verifies the manifest, checksum, schema, dependency hints, and model load path before the API accepts traffic. -->

Loading should happen at service startup, before readiness passes. The service can read the manifest, verify the checksum, load the MLflow model, and store version metadata for responses and logs.

```python
from pathlib import Path
import hashlib
import json

import mlflow.pyfunc


MODEL_DIR = Path("/models/used-car-price")
MANIFEST_PATH = MODEL_DIR / "serving_manifest.json"


def hash_directory(path: Path) -> str:
    digest = hashlib.sha256()
    for file_path in sorted(p for p in path.rglob("*") if p.is_file()):
        if file_path.name == "serving_manifest.json":
            continue
        digest.update(str(file_path.relative_to(path)).encode("utf-8"))
        digest.update(file_path.read_bytes())
    return digest.hexdigest()


def load_serving_model() -> tuple[mlflow.pyfunc.PyFuncModel, dict]:
    manifest = json.loads(MANIFEST_PATH.read_text())
    actual_hash = hash_directory(MODEL_DIR)
    if actual_hash != manifest["artifact_sha256"]:
        raise RuntimeError(
            f"artifact hash mismatch for {manifest['model_version']}"
        )

    if manifest["feature_schema_version"] != "used_car_price_features_v7":
        raise RuntimeError("unsupported feature schema for this server build")

    model = mlflow.pyfunc.load_model(str(MODEL_DIR))
    return model, manifest
```

This code checks identity before traffic. It also checks that this server build knows how to create the expected feature schema. That protects against a common release mismatch: a new model artifact expects a field the current API image cannot produce.

The dependency check can happen in the image build and startup smoke test. A lock file such as `requirements.lock` or `uv.lock` should live beside the serving code. The runtime image digest should appear in the manifest and the deployment record.

![TrailAuto model startup safety gate](/content-assets/articles/article-mlops-model-serving-saving-loading-models-safely/startup-safety-gate.png)

*Safe startup checks trusted source, checksum, schema, loading, and smoke prediction before `/readyz` passes. A user-uploaded artifact should be blocked before loading.*

## Run A Smoke Test Before Readiness
<!-- section-summary: A smoke prediction proves that the loaded model, feature conversion code, and runtime dependencies work together. -->

A startup smoke test should use the input example or a reviewed synthetic request. It should call the same feature conversion code the API uses, then call the loaded model. This catches missing packages, wrong column order, and output shape surprises before the service receives traffic.

```python
import pandas as pd


def smoke_test_model(model, manifest: dict) -> None:
    example = pd.DataFrame(
        [
            {
                "make": "Toyota",
                "model_year": 2021,
                "mileage": 38800,
                "trim": "LE",
                "accident_count": 0,
                "seller_region": "pacific",
                "fuel_type": "gas",
                "listing_month": 7,
            }
        ]
    )
    prediction = model.predict(example)
    if len(prediction) != 1:
        raise RuntimeError("smoke test returned the wrong row count")
    price = float(prediction[0])
    if price < 500 or price > 250_000:
        raise RuntimeError(
            f"smoke test returned an implausible price for {manifest['model_version']}"
        )
```

The smoke test does not prove the model is accurate. It proves the runtime can execute the model and that the output lives in a plausible range. Accuracy belongs in evaluation and monitoring. Startup safety belongs here.

Readiness should pass only after load and smoke test pass. If the model fails, the process can exit or keep `/readyz` in a failed state. The exact platform behavior depends on the orchestrator, but the service should avoid accepting traffic with a half-loaded artifact.

## Handle Serialization Risk
<!-- section-summary: Serialization formats can carry compatibility and security risk, so serving teams need trusted artifacts, restricted loading paths, and reviewed dependencies. -->

Many Python model files use pickle-based formats under the hood. Pickle can execute code during loading, which makes untrusted artifacts dangerous. A serving platform should only load artifacts from trusted training pipelines and approved registries. It should never accept a user-uploaded model file and load it directly inside the prediction service.

Compatibility risk is the second issue. A model saved with one library version may fail or change behavior with another version. That is why the artifact needs a dependency manifest, model signature, runtime image digest, and smoke test. The serving image should pin major dependencies and record the exact image digest that passed review.

Some model families support formats with stronger runtime boundaries, such as ONNX for certain models or framework-specific saved formats. Those formats can help portability, yet they still need version checks and smoke tests. The practical rule for beginners is this: treat the model artifact like deployable code. It has provenance, dependencies, a review path, and rollback.

## Review And Rollback
<!-- section-summary: The release review should check model identity, schema compatibility, runtime dependencies, smoke tests, and the previous known-good artifact. -->

Before TrailAuto deploys the pricing model, the serving review should use a small checklist:

| Check | Evidence |
|---|---|
| Model identity | MLflow run ID, model version, registry alias or deployment ticket |
| Input shape | MLflow signature and API-to-feature conversion tests |
| Dependencies | Lock file, image digest, Python version |
| Artifact integrity | SHA-256 checksum in manifest |
| Startup safety | Load check and smoke prediction in CI |
| Contract safety | API request tests and model signature comparison |
| Rollback | Previous model version and previous image digest |

Rollback should have two paths. If only the model is bad and the runtime image is healthy, point the deployment back to the previous artifact. If the image introduced the failure, roll back the image too. The manifest helps the team choose quickly because it records both model and runtime identity.

![TrailAuto rollback decision board](/content-assets/articles/article-mlops-model-serving-saving-loading-models-safely/rollback-decision-board.png)

*The rollback board separates model failures, image failures, schema mismatches, and smoke-test evidence so the team can choose the right previous artifact or image digest.*

## Putting It Together
<!-- section-summary: Safe saving and loading turns a trained model into a reviewed serving artifact with signature, manifest, checksum, dependency evidence, startup checks, and rollback. -->

Saving and loading models for production is artifact engineering. The trained model file matters, and the evidence around it matters just as much. A serving-ready handoff includes the MLflow model, signature, input example, manifest, checksum, dependency record, smoke test, and rollback pointer.

TrailAuto's pricing model shows the flow. Training logs a signature and input example. Packaging writes a serving manifest. Startup verifies the checksum and schema. Readiness waits for a smoke prediction. Review checks identity, dependencies, and rollback. That is the difference between a notebook file and an artifact a production API can trust.

## References

- [MLflow model signatures and input examples](https://mlflow.org/docs/latest/ml/model/signatures/)
- [MLflow Python model API](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.pyfunc.html)
- [MLflow LightGBM API](https://mlflow.org/docs/latest/api_reference/python_api/mlflow.lightgbm.html)
- [Docker image digests](https://docs.docker.com/reference/cli/docker/image/pull/#pull-an-image-by-digest-immutable-identifier)
- [Python pickle security notes](https://docs.python.org/3/library/pickle.html)
