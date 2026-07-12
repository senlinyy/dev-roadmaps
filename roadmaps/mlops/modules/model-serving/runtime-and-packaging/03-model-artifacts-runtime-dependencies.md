---
title: "Runtime Compatibility"
description: "Connect model artifacts, feature schemas, package versions, container images, CPU/GPU libraries, and serving frameworks so inference stays reliable."
overview: "Runtime compatibility means the artifact, API schema, dependency lock, container image, hardware, and serving framework all agree. This article follows a document classification service and shows compatibility manifests, matrix tests, GPU library checks, model server choices, and rollback evidence."
tags: ["MLOps", "production", "packaging"]
order: 3
id: "article-mlops-model-serving-model-artifacts-runtime-dependencies"
---

## Table of Contents

1. [Compatibility Means The Whole Runtime Agrees](#compatibility-means-the-whole-runtime-agrees)
2. [Follow One Document Classifier](#follow-one-document-classifier)
3. [Create A Compatibility Manifest](#create-a-compatibility-manifest)
4. [Check Feature Schema And Model Signature](#check-feature-schema-and-model-signature)
5. [Check Packages, System Libraries, And Images](#check-packages-system-libraries-and-images)
6. [Check CPU, GPU, And Server Runtime](#check-cpu-gpu-and-server-runtime)
7. [Run A Compatibility Matrix In CI](#run-a-compatibility-matrix-in-ci)
8. [Operate And Roll Back Compatibility Incidents](#operate-and-roll-back-compatibility-incidents)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## Compatibility Means The Whole Runtime Agrees
<!-- section-summary: Runtime compatibility means the model artifact, schema, libraries, image, hardware, and serving framework can run together with the same behavior the team reviewed. -->

**Runtime compatibility** means the saved model and the serving environment agree on how inference should run. The artifact, input schema, Python packages, system libraries, container image, CPU or GPU hardware, CUDA stack, and serving framework all need to fit together. If one piece drifts, the model may fail to load, return wrong shapes, run slowly, or crash under real traffic.

This article connects the previous two articles. You learned how to save a model with signatures and how to package an API in a container. Compatibility is the review layer across both. It asks: can this exact model run inside this exact image on this exact hardware with this exact request contract?

That question matters because serving failures often come from small mismatches. A feature column changes order. A library minor version changes model deserialization. A GPU image expects a CUDA runtime that the node driver cannot support. A model server expects a repository layout the team copied incorrectly. Compatibility work turns those surprises into checks.

## Follow One Document Classifier
<!-- section-summary: The running example serves a document classifier where tokenizer versions, model weights, schemas, and hardware choices must line up. -->

Imagine **LedgerLine**, a finance operations platform. Customers upload invoices, receipts, tax forms, and bank letters. A model classifies each document so the workflow can send invoices to accounts payable, tax forms to compliance, and bank letters to account review.

The model is a transformer-based classifier. It needs model weights, tokenizer files, label mapping, preprocessing code, Python dependencies, and enough CPU or GPU capacity for the expected document volume. The API receives a `document_uri` and returns `document_type`, confidence, model version, and label set version.

LedgerLine has two serving paths:

| Path | Runtime | Why it exists |
|---|---|---|
| Normal traffic | FastAPI plus PyTorch CPU image | Handles steady document uploads at predictable cost |
| End-of-month surge | GPU node pool with NVIDIA Triton candidate | Tests higher throughput for batch-like spikes |

The team wants one compatibility process that works for both paths. The details differ, yet the review question stays the same: does the model artifact match the runtime that will serve it?

## Create A Compatibility Manifest
<!-- section-summary: A compatibility manifest records the exact artifact, schema, packages, image, hardware, and server settings approved for a release. -->

A compatibility manifest is the release receipt for serving. It records the artifact and the runtime side by side. It should live with the deployment ticket, model registry entry, or artifact bundle.

```yaml
model:
  name: document-classifier
  version: document-classifier-2026-07-04
  registry_uri: models:/document-classifier@candidate
  mlflow_run_id: 8616dbdfb47e4d62a1c7e13baf0ddba1
  artifact_sha256: 5f31d2f6c7a4a1b2e6f4e7250ec7df18bbd71f85c8d61a9f4d2c83ddc5a1f910
  signature_version: mlflow-signature-v1

schema:
  request_schema: document_classification_request_v3
  feature_schema: document_text_features_v5
  label_set: ledgerline_document_labels_v4

runtime:
  image: ghcr.io/ledgerline/document-api@sha256:cb41...
  python: "3.12.5"
  requirements_lock: requirements.lock
  torch: "2.8.0"
  transformers: "4.53.0"
  tokenizer_sha256: 1c9ed276e8f693a1...

hardware:
  default_pool: cpu-inference
  gpu_pool_candidate: l4-inference
  cuda_runtime_image: nvidia/cuda:12.8.1-runtime-ubuntu24.04

serving:
  framework: fastapi
  endpoint: /v1/document-classifier:predict
  readiness_smoke_test: tests/fixtures/document_invoice_request.json
  rollback_model: document-classifier-2026-06-20
  rollback_image: ghcr.io/ledgerline/document-api@sha256:8aa2...
```

The manifest makes compatibility review visible. It gives platform, ML, and on-call engineers one place to check model, code, package, image, hardware, and rollback identity.

![LedgerLine compatibility manifest board](/content-assets/articles/article-mlops-model-serving-model-artifacts-runtime-dependencies/compatibility-manifest-board.png)

*LedgerLine's compatibility manifest keeps model, schema, runtime, hardware, serving framework, and rollback entries in one review packet before release.*

## Check Feature Schema And Model Signature
<!-- section-summary: Schema and signature checks catch request-to-feature mismatches before serving traffic reaches the model. -->

The first compatibility boundary is the request-to-model path. The API request schema describes what the caller sends. The feature schema describes what the model expects after preprocessing. The model signature describes the shape accepted by the saved artifact. These three should agree through tests.

LedgerLine can store an expected feature list:

```json
{
  "feature_schema_version": "document_text_features_v5",
  "features": [
    {"name": "token_ids", "dtype": "int64", "shape": ["batch", 512]},
    {"name": "attention_mask", "dtype": "int64", "shape": ["batch", 512]},
    {"name": "source_system_id", "dtype": "string"},
    {"name": "document_language", "dtype": "string"}
  ]
}
```

Then a CI test can compare the preprocessing output against the model signature:

```python
import json

import mlflow

from app.preprocessing import build_features
from app.schemas import DocumentClassificationRequest


def test_request_features_match_model_signature():
    model = mlflow.pyfunc.load_model("models/document-classifier")
    request = DocumentClassificationRequest.model_validate_json(
        open("tests/fixtures/document_invoice_request.json").read()
    )
    features = build_features(request)
    signature = model.metadata.signature

    expected_inputs = [item.name for item in signature.inputs.inputs]
    actual_inputs = list(features.columns)

    assert actual_inputs == expected_inputs
```

This test is plain and valuable. If preprocessing drops `attention_mask`, changes column order, or renames a field, CI fails before deployment. The serving team should treat signature mismatch as a release blocker.

## Check Packages, System Libraries, And Images
<!-- section-summary: Dependency compatibility needs lock files, image digests, system package records, import checks, and model-load smoke tests. -->

The second boundary is the software runtime. Python packages, OS libraries, and image base all affect model loading. For document classification, the tokenizer and model libraries matter as much as the model weights. A tokenizer version mismatch can change token IDs, and changed token IDs can change predictions.

Record the package set in a lock file and the image as a digest. During CI, run import and version checks:

```python
import importlib.metadata


def test_runtime_versions_match_manifest():
    expected = {
        "torch": "2.8.0",
        "transformers": "4.53.0",
        "fastapi": "0.116.0",
        "pydantic": "2.11.0",
    }
    for package, version in expected.items():
        assert importlib.metadata.version(package) == version
```

This test should use the team's actual approved versions. The versions in this article are examples, not a universal recommendation. The real review should use the versions that passed training, evaluation, scanning, and serving smoke tests.

System libraries also matter. Image decoding may need `libjpeg` or `libpng`. OCR preprocessing may need native libraries. GPU images need NVIDIA runtime libraries. Keep those dependencies in the Dockerfile and deployment manifest instead of relying on a node that happens to have them installed.

## Check CPU, GPU, And Server Runtime
<!-- section-summary: Hardware and model server compatibility depend on resource requests, CUDA stack, GPU operator support, and the server's model repository rules. -->

The third boundary is hardware and serving framework. CPU inference mainly needs package and resource checks. GPU inference adds driver, CUDA, container runtime, device plugin, and scheduling checks. NVIDIA's GPU Operator documentation and support matrices are the right place to verify supported platforms, drivers, and GPU software stack details before a production rollout.

For LedgerLine's CPU path, the deployment can request CPU and memory:

```yaml
resources:
  requests:
    cpu: "1"
    memory: 2Gi
  limits:
    cpu: "2"
    memory: 4Gi
```

For the GPU candidate, the deployment must request GPU resources and land on a compatible node pool:

```yaml
resources:
  requests:
    cpu: "2"
    memory: 8Gi
    nvidia.com/gpu: "1"
  limits:
    cpu: "4"
    memory: 16Gi
    nvidia.com/gpu: "1"
nodeSelector:
  accelerator: nvidia-l4
```

If the team uses NVIDIA Triton, it also needs a model repository layout and model configuration that Triton understands. Triton can serve models from a repository with versioned directories, and features such as dynamic batching need deliberate configuration and load testing. If the team uses BentoML or Ray Serve, compatibility moves into their service and deployment model. The habit is the same: check the framework's current docs, build a small smoke test, and record the exact runtime version.

TorchServe deserves a specific note. Its official documentation currently describes the project as in limited maintenance. That makes it a candidate for existing systems or legacy support, while new production services should evaluate current maintenance status before choosing it as a default.

![LedgerLine CPU and GPU runtime compatibility checks](/content-assets/articles/article-mlops-model-serving-model-artifacts-runtime-dependencies/cpu-gpu-runtime-checks.png)

*The CPU path and GPU candidate share the same artifact, but the GPU route needs extra checks for node pool, driver, CUDA image, GPU request, smoke test, and traffic gate.*

## Run A Compatibility Matrix In CI
<!-- section-summary: A CI matrix should load the model, run smoke predictions, check versions, and test planned CPU or GPU runtime combinations. -->

A compatibility matrix tests the combinations the team plans to ship. It should stay small. Test the approved image, the approved model artifact, and the approved hardware class or runtime target.

```yaml
name: document-classifier-compatibility

on:
  pull_request:
  workflow_dispatch:

jobs:
  cpu-smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Build image
        run: docker build -t document-api:${{ github.sha }} .
      - name: Run smoke tests
        run: ./scripts/docker-smoke.sh document-api:${{ github.sha }}

  gpu-smoke:
    if: github.event_name == 'workflow_dispatch'
    runs-on: gpu-l4-runner
    steps:
      - uses: actions/checkout@v5
      - name: Check GPU
        run: nvidia-smi
      - name: Build GPU image
        run: docker build -f Dockerfile.gpu -t document-api-gpu:${{ github.sha }} .
      - name: Run GPU smoke tests
        run: ./scripts/docker-gpu-smoke.sh document-api-gpu:${{ github.sha }}
```

The CPU smoke can run on every pull request. GPU smoke may run on demand or before release because GPU runners cost more. The GPU test should still exist. A model that only fails on the target accelerator should fail before deployment, not during an end-of-month surge.

The matrix should produce artifacts: version report, smoke-test response, model load logs, and image digest. Those artifacts help release reviewers see exactly what passed.

## Operate And Roll Back Compatibility Incidents
<!-- section-summary: Compatibility incidents need fast evidence about the failing boundary and a rollback plan for model, image, or hardware target. -->

When a compatibility incident happens, first identify the boundary. A model load error points to artifact, dependency, or serialization mismatch. A validation spike points to schema mismatch. A crash only on GPU points to image, driver, CUDA, or hardware scheduling. A slow response after moving to a model server points to batching, worker count, or resource settings.

Use a runbook like this:

| Symptom | First checks | Likely rollback |
|---|---|---|
| Startup fails | Manifest hash, load logs, missing package | Previous image or previous artifact |
| Validation failures spike | Caller version, schema version, field errors | Re-enable previous accepted schema |
| CPU service memory spikes | batch size, model copy count, worker count | Previous image or lower concurrency |
| GPU service fails to start | `nvidia-smi`, node labels, driver/runtime support | Move traffic back to CPU pool |
| Triton returns shape error | model config, repository layout, request tensor names | Previous Triton config or FastAPI path |

Compatibility rollback should be precise. If the model artifact changed and the image stayed the same, roll back the model. If the image changed and the model stayed the same, roll back the image digest. If the GPU pool caused the failure, route traffic back to the CPU path and keep the artifact in place.

![LedgerLine compatibility matrix and rollback boundaries](/content-assets/articles/article-mlops-model-serving-model-artifacts-runtime-dependencies/compatibility-matrix-rollback.png)

*The compatibility matrix records what passed in CI, then maps incidents to the boundary that failed: schema, package, image, GPU route, or model artifact.*

## Putting It Together
<!-- section-summary: Runtime compatibility joins schemas, signatures, dependencies, images, hardware, serving frameworks, CI smoke tests, and rollback evidence into one release discipline. -->

Runtime compatibility asks whether the whole serving system agrees. The model artifact, input schema, model signature, dependencies, container image, hardware, and serving framework all have to line up. A failure in any one of those places can break inference.

LedgerLine's document classifier shows the practical flow. Create a compatibility manifest. Compare feature schema to model signature. Pin and test packages. Record image digest and hardware target. Verify GPU support from official NVIDIA docs when accelerators enter the path. Run CPU and GPU smoke tests in CI. Keep rollback split by model, image, and hardware route.

## References

- [MLflow model signatures and input examples](https://mlflow.org/docs/latest/ml/model/signatures/)
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Kubernetes scheduling GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)
- [NVIDIA GPU Operator platform support](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html)
- [NVIDIA AI Enterprise Infrastructure Support Matrix](https://docs.nvidia.com/ai-enterprise/support-matrix/latest/index.html)
- [NVIDIA Triton model repository](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_repository.html)
- [NVIDIA Triton model configuration](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_configuration.html)
- [BentoML services](https://docs.bentoml.com/en/latest/build-with-bentoml/services.html)
- [Ray Serve overview](https://docs.ray.io/en/latest/serve/index.html)
- [TorchServe documentation](https://docs.pytorch.org/serve/)
