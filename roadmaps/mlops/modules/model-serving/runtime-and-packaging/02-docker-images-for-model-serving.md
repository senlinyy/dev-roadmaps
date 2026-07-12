---
title: "Model Serving Containers"
description: "Build model serving containers with pinned dependencies, copied artifacts, non-root runtime users, health checks, smoke tests, and image digests."
overview: "Model serving containers package API code, model loading code, dependencies, runtime settings, and health checks into a reproducible image. This article follows a produce quality vision API from Dockerfile to local run, CI smoke test, and deployment metadata."
tags: ["MLOps", "production", "packaging"]
order: 2
id: "article-mlops-model-serving-docker-images-for-model-serving"
---

## Table of Contents

1. [A Container Freezes The Serving Runtime](#a-container-freezes-the-serving-runtime)
2. [Follow One Vision API](#follow-one-vision-api)
3. [Lay Out The Serving Repository](#lay-out-the-serving-repository)
4. [Write A Dockerfile For Inference](#write-a-dockerfile-for-inference)
5. [Pin Dependencies And Keep The Image Small](#pin-dependencies-and-keep-the-image-small)
6. [Run The Container Locally](#run-the-container-locally)
7. [Add CI Smoke Tests](#add-ci-smoke-tests)
8. [Record Image Identity For Deployment](#record-image-identity-for-deployment)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## A Container Freezes The Serving Runtime
<!-- section-summary: A model serving container packages the API code, model loader, system libraries, Python packages, and startup command into one deployable image. -->

**A model serving container** is a Docker image that carries the runtime a model service needs: API code, model loading code, Python packages, system libraries, environment defaults, health endpoints, and the command that starts the server. It gives the team one build artifact to test and deploy.

The container article follows the saving-and-loading article. The previous article focused on the model artifact. This one focuses on the process that loads that artifact. A good model file can still fail in production if the image has the wrong Python version, missing shared libraries, an unsafe startup command, or no health check.

Containers help because the same image can run in CI, on a laptop, in Kubernetes, or in a managed serving platform. The image digest gives the team an immutable identity for the runtime. That matters during incidents: "we deployed tag `latest`" is weak evidence, while "we deployed `ghcr.io/team/api@sha256:...`" names exact bytes.

## Follow One Vision API
<!-- section-summary: The running example packages a produce quality image classifier that needs Python, FastAPI, Pillow, Torch CPU inference, and a reviewed model artifact. -->

Imagine **GreenBasket**, a grocery fulfillment company. Workers photograph produce bins before packing. A model classifies each bin as `pass`, `review`, or `reject` based on visible bruising, mold, and packaging damage. The API receives an image URI from the warehouse app, loads the image from internal object storage, runs a CPU inference model, and returns a quality label.

The serving team wants a reproducible image because small runtime differences can break image preprocessing. Pillow version changes can alter decoding behavior. Torch version changes can alter model loading. Missing OS libraries can break image formats. The Docker image should capture those dependencies in one place.

The target service has:

| Piece | Example |
|---|---|
| API framework | FastAPI |
| Model runtime | PyTorch CPU inference |
| Image library | Pillow |
| Model artifact | `/models/produce-quality/model.pt` |
| Health checks | `/livez` and `/readyz` |
| Startup command | `uvicorn app.main:app --host 0.0.0.0 --port 8080` |
| Runtime user | Non-root user `appuser` |

The example uses CPU inference because the first production path has modest traffic. GPU container details come later in the GPU inference article.

## Lay Out The Serving Repository
<!-- section-summary: A clear repository layout separates API code, model loading code, dependency files, tests, and deployment metadata. -->

A serving repository should make the runtime pieces easy to review. GreenBasket can use this layout:

```console
produce-quality-api/
  app/
    __init__.py
    main.py
    model_loader.py
    schemas.py
    preprocessing.py
  models/
    produce-quality/
      model.pt
      serving_manifest.json
      input_example.json
  tests/
    test_contract.py
    test_model_smoke.py
  requirements.in
  requirements.lock
  Dockerfile
  docker-smoke.sh
```

The split is practical. `schemas.py` holds Pydantic request and response models. `model_loader.py` verifies and loads the model. `preprocessing.py` keeps image transforms testable. The `models/` directory may be copied into the image for a small artifact, or mounted/downloaded at startup for larger artifacts. The same manifest and smoke-test ideas from the previous article still apply.

Small teams often copy a model into the image because it makes the deploy artifact self-contained. Larger models often live in object storage or a model registry because copying multi-gigabyte files into every image slows builds and rollbacks. Either path can work if the final deployment records both image identity and model identity.

## Write A Dockerfile For Inference
<!-- section-summary: A serving Dockerfile should install pinned dependencies, copy only required files, run as a non-root user, and start the API predictably. -->

The Dockerfile is the recipe for the runtime image. It should avoid hidden laptop state. The image should build from a known base, install pinned dependencies, copy serving files, create a non-root user, expose the service port, and define one startup command.

```dockerfile
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODEL_DIR=/app/models/produce-quality \
    PORT=8080

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libjpeg62-turbo libpng16-16 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.lock ./requirements.lock
RUN pip install --no-cache-dir --requirement requirements.lock

COPY app ./app
COPY models/produce-quality ./models/produce-quality
COPY docker-smoke.sh ./docker-smoke.sh

RUN adduser --disabled-password --gecos "" appuser \
    && chown -R appuser:appuser /app \
    && chmod +x /app/docker-smoke.sh

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD curl --fail http://127.0.0.1:8080/readyz || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
```

The base image gives Python and Debian packages. The `apt-get` line installs the image libraries the app needs for JPEG and PNG decoding, then removes package lists to keep the image cleaner. `pip install --requirement requirements.lock` installs reviewed Python dependencies. The service runs as `appuser`, so a runtime bug has fewer permissions inside the container.

The `HEALTHCHECK` calls readiness. Docker's health check helps local and simple runtime environments. Kubernetes usually defines probes in deployment YAML, yet keeping a local health check still helps CI and manual testing.

![GreenBasket model serving container layer stack](/content-assets/articles/article-mlops-model-serving-docker-images-for-model-serving/container-layer-stack.png)

*The serving image layers should explain the runtime: base image, system libraries, locked packages, app code, model artifact, non-root user, health check, and startup command.*

## Pin Dependencies And Keep The Image Small
<!-- section-summary: Dependency locking and image hygiene reduce runtime drift, build surprises, vulnerability noise, and cold-start cost. -->

Model serving images should pin dependencies. A lock file records exact versions. Without a lock file, rebuilding the same Dockerfile next week can install different package versions. That can change preprocessing, model loading, or validation behavior.

The `requirements.in` file can hold human-friendly direct dependencies:

```python
fastapi
uvicorn[standard]
pydantic
torch
pillow
mlflow
```

The generated `requirements.lock` should hold exact versions and hashes if your tooling supports them. Teams commonly use `pip-tools`, Poetry, uv, or another dependency manager. The tool matters less than the result: reviewers should see which versions will run in the image.

Image size also matters for serving. Large images pull more slowly, scan more slowly, and roll back more slowly. Use a slim base when it fits the workload, copy only serving code, keep training notebooks out of the image, and avoid build caches in final layers. If the model artifact is huge, consider downloading it from a trusted registry at startup or using a platform-side model volume.

Security scanning belongs in the build pipeline. The team should scan the image, triage critical vulnerabilities, and rebuild when the base image needs patches. A reproducible image does not remove patching work; it makes patching traceable.

![GreenBasket dependency lock SBOM and scan release gate](/content-assets/articles/article-mlops-model-serving-docker-images-for-model-serving/dependency-sbom-release-gate.png)

*GreenBasket's build gate turns dependency locking into release evidence: lock the packages, build the image, create an SBOM, scan, triage, and keep the approved digest.*

## Run The Container Locally
<!-- section-summary: Local container tests prove that the image can start, load the model, pass readiness, and answer a realistic prediction request. -->

After building the image, test it from the outside. This proves the Dockerfile includes everything the service needs.

```bash
docker build \
  --tag ghcr.io/greenbasket/produce-quality-api:2026-07-05 \
  .
```

Start the container:

```bash
docker run --rm \
  --publish 8080:8080 \
  --name produce-quality-api \
  ghcr.io/greenbasket/produce-quality-api:2026-07-05
```

Check readiness:

```bash
curl -s http://127.0.0.1:8080/readyz
```

Expected shape:

```json
{
  "status": "ready",
  "model_name": "produce-quality",
  "model_version": "produce-quality-2026-07-04",
  "feature_schema_version": "produce_image_features_v4"
}
```

Send one prediction:

```bash
curl -s http://127.0.0.1:8080/v1/produce-quality:predict \
  -H 'content-type: application/json' \
  -d '{
    "request_id": "warehouse_cam_20260705_8821",
    "bin_id": "bin_sf_04291",
    "image_uri": "s3://greenbasket-quality-images/2026/07/05/bin_sf_04291.jpg",
    "camera_id": "dock_4_cam_2",
    "feature_schema_version": "produce_image_features_v4"
  }'
```

This test should return a label, score, model version, and schema version. It also proves the container can import image libraries, load the model, reach the configured image source in the test environment, and return a contract-compliant response.

## Add CI Smoke Tests
<!-- section-summary: CI should build the image, start it, wait for readiness, run contract requests, and fail the release when startup or inference breaks. -->

A serving image should pass CI before deployment. GreenBasket can use a `docker-smoke.sh` script that starts the image, waits for readiness, and sends one valid prediction plus one invalid request.

```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?image tag or digest is required}"
CONTAINER_NAME="produce-quality-smoke-${RANDOM}"

docker run -d --rm \
  --name "${CONTAINER_NAME}" \
  --publish 18080:8080 \
  "${IMAGE}"

cleanup() {
  docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:18080/readyz >/dev/null; then
    break
  fi
  sleep 2
done

curl --fail --silent http://127.0.0.1:18080/v1/produce-quality:predict \
  -H 'content-type: application/json' \
  -d @tests/fixtures/valid_prediction_request.json >/tmp/produce-response.json

curl --silent --output /tmp/invalid-response.json --write-out '%{http_code}' \
  http://127.0.0.1:18080/v1/produce-quality:predict \
  -H 'content-type: application/json' \
  -d @tests/fixtures/invalid_prediction_request.json | grep 422
```

This script catches common mistakes: missing files, missing packages, bad startup command, broken readiness, contract regressions, and validation behavior changes. It is still a smoke test, not a load test. Performance testing comes later.

## Record Image Identity For Deployment
<!-- section-summary: Deployment records should use image digests and link the image to the model version, schema version, build commit, and rollback target. -->

Docker tags are convenient names. Digests are stronger release evidence because they identify exact image content. After CI builds and pushes the image, capture the digest in the deployment record:

```bash
docker buildx build \
  --platform linux/amd64 \
  --tag ghcr.io/greenbasket/produce-quality-api:2026-07-05 \
  --push \
  .

docker buildx imagetools inspect \
  ghcr.io/greenbasket/produce-quality-api:2026-07-05
```

The deployment ticket should record:

| Field | Example |
|---|---|
| Image digest | `ghcr.io/greenbasket/produce-quality-api@sha256:9f0a...` |
| Git commit | `7b912f0` |
| Model version | `produce-quality-2026-07-04` |
| Feature schema | `produce_image_features_v4` |
| Build time | `2026-07-05T09:12:44Z` |
| Previous image digest | `ghcr.io/greenbasket/produce-quality-api@sha256:44a...` |
| Previous model version | `produce-quality-2026-06-20` |

That record makes rollback practical. If the new model is bad, roll back the model pointer or redeploy the previous image. If the image is bad, redeploy the previous digest. The team should avoid guessing from tag names during an incident.

![GreenBasket deployment record with image and model pairing](/content-assets/articles/article-mlops-model-serving-docker-images-for-model-serving/deployment-record-pairing.png)

*A rollback-ready deployment record pairs the current image and model with the previous known-good image and model, plus schema, commit, and build-time evidence.*

## Putting It Together
<!-- section-summary: Model serving containers make the runtime reproducible when they include pinned dependencies, reviewed artifacts, health checks, smoke tests, and digest-based release evidence. -->

Model serving containers package the environment that runs the model. A strong image includes pinned dependencies, only the files needed for serving, a non-root runtime user, health checks, a predictable startup command, and a CI smoke test that proves the image can load and answer a request.

GreenBasket's produce quality API shows the full loop. The repository layout separates serving code from tests and artifacts. The Dockerfile installs pinned dependencies and starts FastAPI. Local tests call readiness and prediction endpoints. CI builds and smokes the image. Deployment records image digest, model version, schema version, and rollback target. That gives the team a runtime artifact it can trust.

## References

- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- [Docker image pull by digest](https://docs.docker.com/reference/cli/docker/image/pull/#pull-an-image-by-digest-immutable-identifier)
- [FastAPI in containers with Docker](https://fastapi.tiangolo.com/deployment/docker/)
- [Kubernetes probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
