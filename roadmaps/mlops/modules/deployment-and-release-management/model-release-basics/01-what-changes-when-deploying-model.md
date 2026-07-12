---
title: "Deploying a Model"
description: "Explain what changes when a trained model turns into a production service with contracts, runtime packaging, rollout checks, monitoring, and rollback."
overview: "Deploying a model means moving a trained artifact into a runtime that real callers can use. This article follows a grocery ETA model from MLflow run evidence to a FastAPI container, Kubernetes deployment, canary route, observability checks, and rollback decision."
tags: ["MLOps", "production", "release"]
order: 1
id: "article-mlops-deployment-and-release-management-what-changes-when-deploying-model"
---

## Table of Contents

1. [Deployment Changes The Job](#deployment-changes-the-job)
2. [Follow One ETA Model Release](#follow-one-eta-model-release)
3. [Package The Model For A Real Caller](#package-the-model-for-a-real-caller)
4. [Make The Contract Visible](#make-the-contract-visible)
5. [Release The Runtime In Small Steps](#release-the-runtime-in-small-steps)
6. [Watch Signals During The Release](#watch-signals-during-the-release)
7. [Use A Promotion Checklist](#use-a-promotion-checklist)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Deployment Changes The Job
<!-- section-summary: Deploying a model means turning a trained artifact into a production runtime with a stable caller contract and operations checks. -->

A training run answers one question: did this model perform well on the evidence the team prepared? Deployment answers a different question: can the model receive real requests, return safe responses, stay within latency and cost limits, and give operators enough evidence to stop the release if customers start getting poor results?

**Deploying a model** means moving a trained model artifact into a runtime that real systems can call. The runtime may be a FastAPI service in Kubernetes, a managed endpoint in SageMaker, Vertex AI, or Azure Machine Learning, a batch scoring job, or a model server such as KServe, BentoML, Ray Serve, or NVIDIA Triton. The common idea is simple: the model leaves the experiment page and joins the production path.

That move changes the work. During training, the team cares about datasets, features, metrics, and artifacts. During deployment, the team also cares about request shape, response shape, model loading, container image digests, environment variables, secrets, CPU or GPU capacity, traffic routing, logs, traces, metrics, alert thresholds, and rollback. A model with a strong offline score can still fail production if callers send fields the model never expected or if the service doubles p95 latency during peak traffic.

## Follow One ETA Model Release
<!-- section-summary: The running scenario follows a grocery delivery ETA model moving from a strong run into a controlled production release. -->

Imagine **HarborCart**, a grocery delivery company. Customers see an estimated arrival time after checkout, and dispatchers use the same ETA to group orders by driver route. The current production model is `eta-arrival:v24`, and it predicts minutes until delivery from order size, store load, distance, driver availability, weather, and recent route speed.

The logistics team trained a candidate called `eta-arrival:v25`. Offline evaluation shows a lower median absolute error, especially for rainy evenings. The candidate artifact came from an MLflow run with a model signature, an input example, segment metrics, and a review note from operations. That is a good start. It still has to pass the production release path.

The deployment work connects these pieces:

| Piece | HarborCart example | Why it matters |
|---|---|---|
| Model artifact | `models:/eta-arrival/25` or managed registry version | The exact trained model the team wants to serve |
| Serving code | `predict_eta.py` and FastAPI endpoint | The code that loads the model and handles requests |
| API contract | `EtaRequest` and `EtaResponse` schemas | The promise made to checkout and dispatch callers |
| Container image | `ghcr.io/harborcart/eta-api@sha256:91ab...` | The runtime package with code and dependencies |
| Environment | `staging` then `production` | The place where the same release is tested and promoted |
| Routing | 5 percent canary before full traffic | The control that limits blast radius |
| Signals | latency, errors, missing features, ETA error labels | The evidence used during the release |
| Rollback | route back to `eta-arrival:v24` | The recovery path if the candidate harms customers |

This table is the deployment shape. The model artifact is only one row. The production release succeeds when all rows line up.

![HarborCart ETA v25 release map](/content-assets/articles/article-mlops-deployment-and-release-management-what-changes-when-deploying-model/deployment-release-map.png)
*The release path connects MLflow evidence, the model artifact, serving code, image identity, canary routing, and the production callers that depend on the ETA response.*

## Package The Model For A Real Caller
<!-- section-summary: A deployment package combines the model artifact, serving code, dependencies, and runtime settings into a repeatable image or managed endpoint. -->

A **deployment package** is the complete set of files and runtime settings needed to serve the model. For HarborCart, the package includes a Python application, the model loader, input validation, dependency versions, the MLflow model reference, and the container image digest that Kubernetes will run. If the team uses SageMaker, Vertex AI, or Azure Machine Learning, the same idea appears as a model resource plus an endpoint deployment. The packaging surface changes, yet the release still needs an exact artifact, serving code, resources, and a caller contract.

The serving code should load one approved model version and expose one clear prediction path. This small FastAPI example shows the shape:

```python
import os
from typing import Literal

import mlflow.pyfunc
import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel, Field


class EtaRequest(BaseModel):
    order_id: str
    store_id: str
    distance_km: float = Field(ge=0, le=80)
    basket_items: int = Field(ge=1, le=250)
    driver_supply: int = Field(ge=0, le=500)
    weather: Literal["clear", "rain", "snow", "storm"]
    requested_at_utc: str


class EtaResponse(BaseModel):
    order_id: str
    model_version: str
    eta_minutes: float
    confidence_bucket: Literal["low", "medium", "high"]


MODEL_URI = os.environ["MODEL_URI"]
MODEL_VERSION = os.environ["MODEL_VERSION"]

app = FastAPI()
model = mlflow.pyfunc.load_model(MODEL_URI)


@app.post("/predict", response_model=EtaResponse)
def predict_eta(request: EtaRequest) -> EtaResponse:
    frame = pd.DataFrame([request.model_dump()])
    prediction = model.predict(frame)[0]
    return EtaResponse(
        order_id=request.order_id,
        model_version=MODEL_VERSION,
        eta_minutes=max(float(prediction), 1.0),
        confidence_bucket="medium",
    )
```

The important part is the boundary. The request schema rejects impossible values such as negative distance. The response returns the model version so checkout logs can prove which version produced each ETA. The model URI lives in an environment variable so the same image can serve a staging version and a production version without changing application code.

The container should also use pinned dependencies. A production Dockerfile usually pins a base image and installs from a lock file. The release record should keep the image digest after build, because a digest points to one immutable image:

```bash
docker build \
  --tag ghcr.io/harborcart/eta-api:2026-07-04-v25 \
  .

docker push ghcr.io/harborcart/eta-api:2026-07-04-v25

docker buildx imagetools inspect \
  ghcr.io/harborcart/eta-api:2026-07-04-v25
```

The final command gives the digest the deployment manifest should use. A friendly tag helps humans. The digest helps automation pull the exact image that passed review.

## Make The Contract Visible
<!-- section-summary: A production model needs an API contract that tells callers which inputs, outputs, versions, and error cases they can rely on. -->

An **API contract** is the agreement between the model service and the systems that call it. For HarborCart, checkout and dispatch need to know which fields to send, which fields they will receive, how errors are reported, and which compatibility rules apply during model updates. A contract protects the callers from surprise schema changes.

This is where model deployment differs from running a notebook. A notebook can build a dataframe from whatever columns happen to exist that day. A service caller needs stable field names. If `driver_supply` changes to `available_driver_count` without coordination, checkout may send the old field and receive validation errors during a live customer flow.

The contract can live in an OpenAPI document, generated from FastAPI, and in a small release manifest:

```yaml
release:
  service: eta-api
  model_name: eta-arrival
  model_version: "25"
  model_uri: models:/eta-arrival/25
  image: ghcr.io/harborcart/eta-api@sha256:91ab4c...
  contract_version: eta-request-v3
  compatible_with:
    - eta-request-v2
    - eta-request-v3
  owners:
    product: logistics
    engineering: ml-platform
    on_call: eta-release-primary
```

The `compatible_with` line matters because production callers rarely update at the same time. Dispatch may already send the newest request shape while checkout still sends the previous one. A beginner-friendly rule is useful here: add optional fields first, keep old fields working during the rollout window, and remove old fields only after logs show the old caller path has stopped.

![HarborCart ETA request contract](/content-assets/articles/article-mlops-deployment-and-release-management-what-changes-when-deploying-model/eta-request-contract.png)
*The contract makes the request fields, validation gate, response fields, compatibility window, and model version logging visible before production traffic reaches the service.*

## Release The Runtime In Small Steps
<!-- section-summary: Progressive release limits traffic at first so the team can compare live behavior before sending every request to the candidate. -->

Once the package and contract exist, the release needs a traffic plan. HarborCart should avoid flipping every checkout request to `eta-arrival:v25` at once. A smaller first step gives the team production evidence while limiting customer impact.

In Kubernetes, the basic runtime object is a Deployment. The Deployment keeps a desired number of Pods running and updates them when the image or environment changes. A Service gives callers a stable network name. For model releases, teams often add Argo Rollouts, Istio, Envoy, or managed cloud endpoint traffic splitting so a small percentage of traffic reaches the candidate first.

A simple canary plan for HarborCart might be:

| Step | Traffic to v25 | Evidence window | Release decision |
|---|---:|---|---|
| Staging | 100 percent staging traffic | 2 hours of synthetic and replayed orders | Promote only if contract and latency pass |
| Canary 1 | 5 percent production traffic | 30 minutes during normal load | Continue if errors and p95 latency stay inside threshold |
| Canary 2 | 25 percent production traffic | 2 hours including rainy-region orders | Continue if ETA error proxy and support tickets stay stable |
| Full | 100 percent production traffic | First 24 hours | Keep rollback route ready |

Argo Rollouts can express the traffic steps and pause points near the deployment:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: eta-api
spec:
  replicas: 8
  strategy:
    canary:
      steps:
        - setWeight: 5
        - pause:
            duration: 30m
        - setWeight: 25
        - pause:
            duration: 2h
        - setWeight: 100
  selector:
    matchLabels:
      app: eta-api
  template:
    metadata:
      labels:
        app: eta-api
    spec:
      containers:
        - name: api
          image: ghcr.io/harborcart/eta-api@sha256:91ab4c...
          env:
            - name: MODEL_URI
              value: models:/eta-arrival/25
            - name: MODEL_VERSION
              value: "25"
```

The traffic weights are only the outer control. The release still needs analysis. A canary that sends 5 percent of traffic to a broken service should stop because signals cross a threshold, not because someone happens to watch a dashboard at the perfect moment.

## Watch Signals During The Release
<!-- section-summary: Release signals should cover service health, model input health, prediction behavior, and delayed product outcomes. -->

Observability is the release evidence system. For a model service, watch both software signals and model-specific signals. Software signals tell you whether the service runs. Model signals tell you whether the predictions still make sense for the product.

HarborCart can track this signal set:

| Signal | Example | Why it matters during deployment |
|---|---|---|
| Request latency | p50, p95, p99 for `/predict` | Checkout needs a fast ETA response |
| Error rate | 4xx validation errors and 5xx service errors | Schema mismatch or runtime failure can show quickly |
| Input quality | missing `driver_supply`, weather category counts | Bad feature values can create poor predictions |
| Prediction shape | ETA distribution by region and store | A model that predicts too many tiny ETAs can harm trust |
| Business proxy | late delivery complaints and manual dispatcher edits | Product impact can show before full labels arrive |
| Labels later | actual delivery time versus predicted ETA | Final quality evidence arrives after deliveries finish |

OpenTelemetry can carry traces, metrics, and logs from the model service. Prometheus can scrape service metrics and evaluate alert rules. The exact platform can vary, yet the release principle stays practical: collect enough evidence to answer which version handled the request and what happened around it.

Here is a compact Prometheus alert shape for the canary:

```yaml
groups:
  - name: eta-release
    rules:
      - alert: EtaCanaryHighErrorRate
        expr: |
          sum(rate(http_server_request_duration_seconds_count{service_name="eta-api", model_version="25", http_response_status_code=~"5.."}[5m]))
          /
          sum(rate(http_server_request_duration_seconds_count{service_name="eta-api", model_version="25"}[5m]))
          > 0.02
        for: 10m
        labels:
          severity: page
        annotations:
          summary: "ETA v25 canary has high 5xx rate"
```

The filter includes `model_version="25"`. That one label lets the team separate candidate behavior from baseline behavior during a mixed rollout.

![HarborCart canary decision board](/content-assets/articles/article-mlops-deployment-and-release-management-what-changes-when-deploying-model/canary-decision-board.png)
*A useful canary board combines service health, input health, prediction shape, and product proxy signals so the team can continue, pause, or roll back with shared evidence.*

## Use A Promotion Checklist
<!-- section-summary: A promotion checklist turns deployment into a repeatable review instead of a hopeful push to production. -->

Before HarborCart promotes `eta-arrival:v25`, the release owner should check the same evidence every time. This checklist keeps the team from skipping a boring step during a busy release window:

| Check | Pass condition |
|---|---|
| Registry evidence | Model version `25` has run ID, signature, input example, metrics, and review owner |
| Contract | `eta-request-v3` handles current checkout and dispatch callers |
| Container | Image digest appears in the release manifest and vulnerability scan passes team policy |
| Staging | Replay tests pass on at least 10,000 recent orders |
| Canary service health | p95 latency stays under 120 ms and 5xx rate stays under 2 percent |
| Canary model behavior | ETA distribution by region stays inside reviewed bounds |
| Rollback | Baseline route to `eta-arrival:v24` remains ready |
| Incident owner | On-call engineer and logistics owner agree on stop conditions |

The rollback path should be written before the release starts:

```bash
kubectl argo rollouts abort eta-api
kubectl argo rollouts promote eta-api --full
kubectl rollout status deployment/eta-api
```

Teams will tune commands to their rollout tool. The important habit is that the rollback path is tested, written, and visible in the release notes before the candidate receives production traffic.

## Putting It Together
<!-- section-summary: Deployment connects the trained model, caller contract, runtime package, traffic plan, signals, and rollback path. -->

Deploying a model changes the work from experiment evidence to production responsibility. The trained artifact still matters, yet it now sits inside a larger release system: API contracts, container images, environment settings, routing controls, telemetry, dashboards, alerts, and rollback commands.

For HarborCart, `eta-arrival:v25` should move only after the team can prove which artifact is running, which callers it supports, which image digest contains the serving code, which traffic step is active, and which signals decide whether the release continues. That is the practical difference between a good model run and a production deployment.

## References

- [MLflow Model Signatures and Input Examples](https://mlflow.org/docs/latest/ml/model/signatures/)
- [Amazon SageMaker: Deploy models for inference](https://docs.aws.amazon.com/sagemaker/latest/dg/deploy-model.html)
- [Vertex AI: Deploy a model to an endpoint](https://cloud.google.com/vertex-ai/docs/general/deployment)
- [Azure Machine Learning: Managed online endpoints](https://learn.microsoft.com/en-us/azure/machine-learning/concept-endpoints-online)
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [OpenTelemetry Signals](https://opentelemetry.io/docs/concepts/signals/)
