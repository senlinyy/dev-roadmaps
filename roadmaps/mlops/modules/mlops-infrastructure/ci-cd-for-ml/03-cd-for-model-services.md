---
title: "Model Service CD"
description: "Connect model packaging, deployment, and release controls."
overview: "Learn how continuous delivery for model services connects packaged models, container images, deployment manifests, canary traffic, monitoring, and rollback evidence."
tags: ["MLOps", "production", "ci-cd"]
order: 3
id: "article-mlops-mlops-infrastructure-cd-for-model-services"
---

## CD For Models Has Two Moving Parts
<!-- section-summary: Continuous delivery for a normal web service usually promotes a container image. Continuous delivery for a model service often promotes both a service image and a model... -->

Continuous delivery for a normal web service usually promotes a container image. Continuous delivery for a model service often promotes both a service image and a model artifact. Those two things have separate lifecycles. The API code can change while the model stays the same. The model can change while the API code stays the same. A production release process needs to track both.

Imagine `SafeStreet Vision`, a city operations team that serves an image classifier for road hazards. The service receives an uploaded street image and returns labels such as `pothole`, `fallen_branch`, or `blocked_lane`. The serving stack uses FastAPI, a container image, a model artifact in object storage, and Kubernetes for deployment.

A CD pipeline for this service should answer:

- Which model version is being served?
- Which container image loads it?
- Which feature or preprocessing code version is inside the image?
- Which environment received the release?
- Which canary checks passed?
- Which rollback command works?
- Which team approved production traffic?

Without those answers, "we deployed the model" is too vague. You need a release record that joins code, model, data, config, traffic, monitoring, and approval.

![SafeStreet model service release record](/content-assets/articles/article-mlops-mlops-infrastructure-cd-for-model-services/safestreet-release-record.png)
*SafeStreet release evidence joins the service image, model artifact, deployment target, approval owner, and rollback target in one record.*

## Package The Service In A Repeatable Shape
<!-- section-summary: Start by defining what gets built. A model service package usually includes:. -->

Start by defining what gets built. A model service package usually includes:

- The application code.
- The model loader and prediction code.
- Preprocessing and postprocessing code.
- Dependency lockfiles.
- A container image.
- A model reference, such as a registry alias, model version, or object-store URI.
- Health and readiness endpoints.
- A deployment manifest.

A simple Dockerfile should avoid downloading the model from a developer laptop path. The release should point to a model artifact controlled by the pipeline.

```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY safestreet_service ./safestreet_service

ENV MODEL_URI=""
ENV MODEL_NAME="safestreet-hazard-classifier"

CMD ["uvicorn", "safestreet_service.api:app", "--host", "0.0.0.0", "--port", "8080"]
```

The container image should be immutable. The model reference can arrive through an environment variable, config map, or serving platform field. Choose one pattern and make it visible in metrics and logs.

## Build Once, Promote With Evidence
<!-- section-summary: A common mistake is rebuilding the image separately for dev, staging, and production. That makes environments hard to compare. Prefer building once, signing or attesting the... -->

A common mistake is rebuilding the image separately for dev, staging, and production. That makes environments hard to compare. Prefer building once, signing or attesting the image if your organization requires it, then promoting the same digest through environments.

```yaml
name: safestreet-model-service-cd

on:
  push:
    branches: [main]

jobs:
  build-image:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      image_digest: ${{ steps.build.outputs.digest }}
    steps:
      - uses: actions/checkout@v5
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/example/safestreet-api:${{ github.sha }}

  deploy-staging:
    runs-on: ubuntu-latest
    needs: build-image
    environment: staging
    steps:
      - uses: actions/checkout@v5
      - run: ./deploy/render.sh staging ${{ needs.build-image.outputs.image_digest }}
      - run: kubectl apply -f rendered/staging.yaml
      - run: kubectl -n ml-serving rollout status deployment/safestreet-api --timeout=180s
```

This is only the skeleton. Real teams also add vulnerability scanning, image signing, SBOM generation, policy checks, and approval gates. The core idea stays simple: every environment receives a traceable artifact.

## Carry The Model Version Through The Deployment
<!-- section-summary: The service should expose the model version it loaded. If an incident happens, responders need to find the answer from metrics, logs, and the API itself. -->

The service should expose the model version it loaded. If an incident happens, responders need to find the answer from metrics, logs, and the API itself.

In Kubernetes, pass the model URI and expected version explicitly:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: safestreet-api
  namespace: ml-serving
  labels:
    app: safestreet-api
    model_name: safestreet-hazard-classifier
spec:
  replicas: 3
  selector:
    matchLabels:
      app: safestreet-api
  template:
    metadata:
      labels:
        app: safestreet-api
        model_name: safestreet-hazard-classifier
        model_version: "27"
    spec:
      containers:
        - name: api
          image: ghcr.io/example/safestreet-api@sha256:REPLACE_ME
          env:
            - name: MODEL_URI
              value: "s3://safestreet-models/prod/hazard-classifier/27/model.pkl"
            - name: MODEL_VERSION
              value: "27"
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            periodSeconds: 5
            failureThreshold: 3
          startupProbe:
            httpGet:
              path: /ready
              port: 8080
            periodSeconds: 10
            failureThreshold: 18
```

The startup probe gives the model time to download and load. The readiness probe keeps traffic away until the service is ready to answer. The endpoint should check that the model is loaded, required metadata exists, and the service can run a tiny known input.

## Build Health Endpoints For Model Reality
<!-- section-summary: A normal /healthz endpoint often checks only that the web process is alive. A model service needs a slightly richer split:. -->

A normal `/healthz` endpoint often checks only that the web process is alive. A model service needs a slightly richer split:

- `/live` answers whether the process should stay running.
- `/ready` answers whether Kubernetes or the load balancer should send traffic.
- `/version` answers which image and model are loaded.
- `/predict` handles real customer traffic.

For SafeStreet Vision, readiness should fail when the model failed to load, the preprocessing bundle is missing, or the service cannot run a tiny built-in fixture.

```python
from fastapi import FastAPI, Response

app = FastAPI()
state = {"model": None, "model_version": None, "startup_error": None}


@app.get("/live")
def live():
    return {"status": "alive"}


@app.get("/ready")
def ready(response: Response):
    if state["startup_error"]:
        response.status_code = 503
        return {"status": "unready", "reason": state["startup_error"]}
    if state["model"] is None:
        response.status_code = 503
        return {"status": "unready", "reason": "model_missing"}
    return {"status": "ready", "model_version": state["model_version"]}


@app.get("/version")
def version():
    return {
        "service": "safestreet-api",
        "model_version": state["model_version"],
    }
```

Keep `/live` simple. If liveness checks depend on a slow model or remote store, Kubernetes may restart healthy pods during temporary dependency delays. Put traffic-readiness logic in `/ready`.

![SafeStreet service health endpoints](/content-assets/articles/article-mlops-mlops-infrastructure-cd-for-model-services/safestreet-health-endpoints.png)
*The endpoint split lets SafeStreet keep the process alive, block traffic until the model loads, and expose the exact image and model version.*

## Use Canary Releases For User-Facing Services
<!-- section-summary: A canary release sends a small amount of traffic to the candidate before full promotion. For ML, the canary should compare service health and prediction behavior. -->

A canary release sends a small amount of traffic to the candidate before full promotion. For ML, the canary should compare service health and prediction behavior.

Canary checks can include:

- Error rate and latency.
- Timeout rate.
- Prediction volume.
- Empty or fallback response rate.
- Distribution of predicted classes or scores.
- Guardrail violations.
- Business proxy metrics if labels arrive quickly enough.
- Segment metrics for important user groups.

For KServe, a canary rollout can be represented on the `InferenceService` with a candidate model and a traffic percentage. Current KServe docs note that canary rollout strategy is supported in serverless deployment mode, so check your installation before teaching this pattern as universal.

```yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: safestreet-hazard
  namespace: ml-serving
spec:
  predictor:
    canaryTrafficPercent: 10
    model:
      modelFormat:
        name: sklearn
      storageUri: "s3://safestreet-models/candidate/hazard-classifier/28"
```

In a plain Kubernetes deployment, you may use a service mesh, ingress controller, progressive delivery controller, or two deployments with weighted routing. The platform can vary; the release rule is stable. Send limited traffic, watch the right signals, then promote or rollback.

## Put Gates In The Pipeline
<!-- section-summary: CD should pause when evidence is missing. You can gate each environment:. -->

CD should pause when evidence is missing. You can gate each environment:

```yaml
release_gates:
  staging:
    required:
      - image_built_from_main
      - model_signature_present
      - smoke_prediction_passed
      - dependency_scan_passed
  production_canary:
    required:
      - staging_soak_30m
      - champion_comparison_report
      - rollback_target_known
      - owner_approval
  production_full:
    required:
      - canary_error_rate_below_threshold
      - canary_p95_latency_below_250ms
      - no_guardrail_violations
      - support_queue_normal
```

The gate should produce an artifact, such as `release.json`:

```json
{
  "service": "safestreet-api",
  "image_digest": "sha256:9b4...",
  "model_name": "safestreet-hazard-classifier",
  "model_version": "28",
  "environment": "production-canary",
  "canary_percent": 10,
  "approved_by": "lina",
  "rollback_model_version": "27",
  "checks": {
    "smoke_prediction": "passed",
    "p95_latency_ms": 118,
    "error_rate": 0.001,
    "guardrail_violations": 0
  }
}
```

This release record helps audits, debugging, and future incident reviews.

## Separate Environment Permissions
<!-- section-summary: CD should use different permissions for dev, staging, and production. A staging pipeline can write candidate artifacts and deploy to a staging namespace. A production pipeline... -->

CD should use different permissions for dev, staging, and production. A staging pipeline can write candidate artifacts and deploy to a staging namespace. A production pipeline should promote approved artifacts and deploy only through protected environments.

One simple layout:

| Environment | Artifact access | Deployment access | Human approval |
|---|---|---|---|
| dev | Read/write dev artifacts | Dev namespace | Usually none |
| staging | Read candidate artifacts | Staging namespace | Team owner |
| production canary | Read approved candidate and champion | Production namespace, limited traffic | On-call or release owner |
| production full | Read approved candidate and champion | Production namespace, full traffic | Product or risk owner for sensitive models |

The CD workflow should never need broad cloud admin rights. It needs the exact rights to read release artifacts, apply manifests, query rollout status, and update traffic. If a job can delete unrelated buckets or read raw training data, the deployment role is too powerful.

## Verify After Deployment
<!-- section-summary: After the deployment starts, CD should verify the running system rather than trusting that kubectl apply succeeded. -->

After the deployment starts, CD should verify the running system rather than trusting that `kubectl apply` succeeded.

```bash
kubectl -n ml-serving rollout status deployment/safestreet-api --timeout=180s

curl -fsS https://staging-ml.example.com/safestreet/ready

curl -fsS https://staging-ml.example.com/safestreet/predict \
  -H "Content-Type: application/json" \
  -d '{"image_uri":"s3://safestreet-fixtures/pothole-small.jpg","request_id":"smoke-001"}'
```

Then query metrics:

```promql
histogram_quantile(
  0.95,
  sum(rate(http_server_request_duration_seconds_bucket{service="safestreet-api"}[5m])) by (le)
)
```

For model-specific checks, compare canary and champion outputs on a small fixed replay set. The replay set should contain examples that previously broke the service, such as nighttime images, roadwork signs, blurred images, and empty uploads.

## Design Rollback Before You Need It
<!-- section-summary: Rollback should be a pipeline feature, not a heroic manual act. Record the previous service image, previous model version, and previous routing rule before promotion. -->

Rollback should be a pipeline feature, not a heroic manual act. Record the previous service image, previous model version, and previous routing rule before promotion.

```bash
kubectl -n ml-serving rollout undo deployment/safestreet-api --to-revision=12
kubectl -n ml-serving rollout status deployment/safestreet-api --timeout=180s
```

For a model-only rollback:

```bash
./deploy/promote-model.sh \
  --service safestreet-api \
  --environment production \
  --model-version 27 \
  --reason "rollback from release 2026-07-05.2"
```

After rollback, verify which version serves traffic:

```bash
curl -fsS https://ml.example.com/safestreet/version
```

Expected response:

```json
{
  "service": "safestreet-api",
  "image_digest": "sha256:9b4...",
  "model_name": "safestreet-hazard-classifier",
  "model_version": "27",
  "loaded_at": "2026-07-05T14:26:31Z"
}
```

The response gives responders a direct answer. Logs and metrics should carry the same fields.

![SafeStreet canary and rollback path](/content-assets/articles/article-mlops-mlops-infrastructure-cd-for-model-services/safestreet-canary-rollback.png)
*SafeStreet limits candidate traffic, watches service and prediction signals, then promotes or rolls back to the known model version.*

## Common Mistakes
<!-- section-summary: Watch for these patterns:. -->

Watch for these patterns:

- The pipeline promotes a model artifact without testing the service image that will load it.
- The service hides model version, so incidents start with guesswork.
- Readiness probes only check that the HTTP server is alive.
- Canary checks only watch latency and miss prediction drift.
- Dev and production builds use different dependency versions.
- Registry writes happen from developer machines.
- Rollback requires editing YAML by hand during an incident.
- The release artifact lacks the data snapshot, code commit, and approval owner.

The fix is boring and powerful: build once, attach model evidence, deploy through environments, verify the running service, and keep rollback tested.

## What A Reviewer Should Ask
<!-- section-summary: When you review a model-service CD change, focus on traceability and recovery:. -->

When you review a model-service CD change, focus on traceability and recovery:

- Can you name the exact image digest being deployed?
- Can you name the exact model version or alias being served?
- Does the service expose `/version` or equivalent metadata?
- Does readiness prove the model is loaded?
- Does the canary watch prediction behavior as well as HTTP health?
- Is the rollback target recorded before promotion?
- Are production credentials separated from staging credentials?
- Is the release evidence stored somewhere durable?
- Can the on-call person find the dashboard and runbook from the alert?
- Is a human approval required for high-impact model changes?

These questions catch the difference between "the pipeline applied YAML" and "the team can safely release and recover an ML service." Beginners often think CD ends at deployment. In production ML, CD ends when you can prove the right model is serving, the signals are healthy, and the rollback path is ready.

## References

- [GitHub Actions workflow syntax](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions)
- [Docker Build GitHub Actions](https://docs.docker.com/build/ci/github-actions/)
- [Kubernetes Deployment controller](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Kubernetes liveness, readiness, and startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [kubectl rollout undo](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_undo/)
- [KServe canary rollout strategy](https://kserve.github.io/website/docs/model-serving/predictive-inference/rollout-strategies/canary)
- [BentoML services](https://docs.bentoml.com/en/latest/build-with-bentoml/services.html)
- [NVIDIA Triton model repository](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_repository.html)
