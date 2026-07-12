---
title: "Service Health Metrics"
description: "Track latency, errors, traffic, CPU, memory, and accelerator pressure for model-serving APIs."
overview: "Service health metrics show whether an inference service is fast, reliable, and sized for current demand. This tutorial follows a recommendations API through FastAPI instrumentation, Prometheus histograms, SLO-style alert rules, Kubernetes resource metrics, GPU telemetry, dashboards, and incident triage."
tags: ["MLOps", "core", "observability"]
order: 1
id: "article-mlops-monitoring-and-feedback-monitoring-latency-errors-resources"
---

## Table of Contents

1. [Service Health Metrics Show If The Model Service Can Keep Serving](#service-health-metrics-show-if-the-model-service-can-keep-serving)
2. [Follow One Recommendations API](#follow-one-recommendations-api)
3. [Measure Traffic, Latency, Errors, And Saturation](#measure-traffic-latency-errors-and-saturation)
4. [Add FastAPI Metrics At The Request Boundary](#add-fastapi-metrics-at-the-request-boundary)
5. [Turn Metrics Into SLO Alerts](#turn-metrics-into-slo-alerts)
6. [Watch Kubernetes And GPU Resources](#watch-kubernetes-and-gpu-resources)
7. [Build The Dashboard For Triage](#build-the-dashboard-for-triage)
8. [Practical Checks, Mistakes, And Interview Understanding](#practical-checks-mistakes-and-interview-understanding)
9. [References](#references)

## Service Health Metrics Show If The Model Service Can Keep Serving
<!-- section-summary: Service health metrics track the serving API around the model so the team can see speed, failures, traffic, and resource pressure before users feel the outage. -->

**Service health metrics** are the numbers that tell you whether a model-serving service is healthy as an API. They answer questions such as: how many requests are arriving, how long inference takes, how often requests fail, how much CPU and memory the service uses, and whether the GPU worker pool has enough headroom. The model may have great offline accuracy, yet the product still suffers if the service times out, returns errors, or runs out of memory during a traffic spike.

In MLOps, service health sits before model-quality monitoring. You can only trust drift charts, prediction-quality charts, and feedback loops after the service reliably accepts requests and emits evidence. If a recommendation model misses its latency target, the first incident question is rarely about embeddings or training data. The first question is usually, "Which part of the serving path slowed down, and did capacity or code change?"

This article focuses on the normal service signals around inference. You will see how a team instruments a FastAPI service, exports Prometheus metrics, writes alert rules, checks Kubernetes CPU and memory pressure, includes GPU telemetry where accelerators matter, and uses a small dashboard to triage incidents. The goal is simple: give every model request a measurable service envelope before deeper model monitoring enters the picture.

## Follow One Recommendations API
<!-- section-summary: The running scenario is a product recommendations API where slow inference directly hurts page load time and revenue. -->

Imagine **ShopGarden**, a marketplace for home goods and plants. The product page calls a service named `recommendation-api` every time a shopper opens a listing. The endpoint `/v1/recommendations` receives a user id, product id, locale, and device type. It returns eight recommended items from a two-stage system: a fast candidate lookup and a ranking model.

The ranking model runs on a small L4 GPU node pool because the team uses a neural re-ranker with dense embeddings. The service also has CPU-heavy work: validation, feature fetching, business-rule filters, and response formatting. A healthy request usually finishes in 120 to 180 ms. At 300 ms, the product page starts to feel slow. At 800 ms, the frontend times out and shows a fallback carousel.

ShopGarden uses this stack:

| Layer | Tooling | What The Team Watches |
|---|---|---|
| API service | FastAPI, Uvicorn, Pydantic | request count, duration, status code, exceptions |
| Metrics system | Prometheus and Grafana | p50/p95/p99 latency, error rate, traffic, saturation |
| Cluster runtime | Kubernetes | CPU, memory, restarts, OOM kills, requested versus used capacity |
| GPU telemetry | NVIDIA DCGM Exporter | GPU utilization, memory usage, temperature, error counters |
| Release evidence | model version labels and deployment labels | whether a new model or image changed health |
| Load checks | k6 in CI and staging | whether latency and error thresholds hold under expected demand |

The important habit is to label metrics with stable service facts. The team needs `service="recommendation-api"`, `environment="prod"`, `model_version="ranker-2026-07-01"`, and `route="/v1/recommendations"`. They avoid labels with unbounded values such as `user_id`, `request_id`, or raw product ids in metrics because each unique value creates more time series. Request ids belong in logs and traces, while metrics stay aggregated.

![ShopGarden recommendation API service health](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-latency-errors-resources/shopgarden-service-health.png)
*ShopGarden watches the full serving path with bounded labels, so teams can compare traffic, latency, errors, and saturation without turning every request into a new metric series.*

## Measure Traffic, Latency, Errors, And Saturation
<!-- section-summary: A useful service-health view starts with traffic, latency, errors, and saturation, then adds model-serving details such as model version and fallback counts. -->

Most service dashboards start with four signals. **Traffic** tells you how many requests the service receives. **Latency** tells you how long requests take. **Errors** tell you how often the service fails. **Saturation** tells you whether a resource is close to a limit. These signals are simple, and they work well because nearly every production incident changes at least one of them.

For a model API, the same four signals need model-aware labels and counters. ShopGarden tracks total requests by route, status class, and model version. It tracks duration with a histogram so Prometheus can calculate p95 and p99 latency. It tracks exceptions and fallback responses separately because a successful HTTP 200 can still hide a degraded model path if the service used a cached fallback. It tracks CPU, memory, GPU utilization, and queue depth because resource pressure often explains latency.

A practical metric plan for `recommendation-api` might look like this:

| Signal | Prometheus Metric | Why It Helps |
|---|---|---|
| Request volume | `recommendation_requests_total` | Shows traffic by route, status, and model version |
| Request latency | `recommendation_request_duration_seconds` | Shows p50, p95, and p99 service speed |
| Model inference time | `recommendation_inference_duration_seconds` | Separates model runtime from request overhead |
| Error count | `recommendation_errors_total` | Shows validation, feature, model, and dependency failures |
| Fallback count | `recommendation_fallbacks_total` | Shows user-visible degradation even when HTTP succeeds |
| In-flight work | `recommendation_inflight_requests` | Shows concurrency pressure |
| GPU pressure | `DCGM_FI_DEV_GPU_UTIL`, `DCGM_FI_DEV_FB_USED` | Shows accelerator load and memory pressure |

Latency needs histograms rather than plain averages. Averages hide the tail, and tail latency is what users feel. Prometheus histograms record observations into buckets, which lets the team query p95 and p99 across instances. The bucket choices should match the user experience. A recommendation service that cares about 200 ms needs buckets around 50 ms, 100 ms, 200 ms, 300 ms, 500 ms, and 1 second. A batch scoring service would use different buckets.

## Add FastAPI Metrics At The Request Boundary
<!-- section-summary: FastAPI middleware gives every request one consistent place to count requests, time latency, attach labels, and expose Prometheus metrics. -->

The easiest place to measure service health is the request boundary. FastAPI middleware runs around each request, so it can start a timer before the endpoint runs and record the result after the response is ready. The model code can add a second timer around the actual inference call so the team can compare API latency with model latency.

Here is a compact FastAPI setup using the official Prometheus Python client. In real production code, the metrics module often lives beside the application setup so every router uses the same metric names and label rules.

```python
import time
from contextlib import contextmanager

from fastapi import FastAPI, Request
from prometheus_client import Counter, Gauge, Histogram, make_asgi_app

app = FastAPI()

REQUESTS = Counter(
    "recommendation_requests_total",
    "Total recommendation API requests",
    ["route", "method", "status_class", "model_version"],
)

ERRORS = Counter(
    "recommendation_errors_total",
    "Total recommendation API errors by category",
    ["route", "error_type", "model_version"],
)

REQUEST_DURATION = Histogram(
    "recommendation_request_duration_seconds",
    "Recommendation API request duration in seconds",
    ["route", "method", "model_version"],
    buckets=(0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0, 2.0),
)

INFERENCE_DURATION = Histogram(
    "recommendation_inference_duration_seconds",
    "Ranking model inference duration in seconds",
    ["model_version", "device_pool"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1.0),
)

INFLIGHT = Gauge(
    "recommendation_inflight_requests",
    "In-flight recommendation requests",
)

MODEL_VERSION = "ranker-2026-07-01"


@contextmanager
def time_inference(device_pool: str):
    start = time.perf_counter()
    try:
        yield
    finally:
        INFERENCE_DURATION.labels(
            model_version=MODEL_VERSION,
            device_pool=device_pool,
        ).observe(time.perf_counter() - start)


@app.middleware("http")
async def record_request_metrics(request: Request, call_next):
    route = request.url.path
    method = request.method
    start = time.perf_counter()
    INFLIGHT.inc()
    try:
        response = await call_next(request)
        return response
    except ValueError:
        ERRORS.labels(route=route, error_type="validation", model_version=MODEL_VERSION).inc()
        raise
    except TimeoutError:
        ERRORS.labels(route=route, error_type="dependency_timeout", model_version=MODEL_VERSION).inc()
        raise
    finally:
        status_code = getattr(locals().get("response", None), "status_code", 500)
        status_class = f"{status_code // 100}xx"
        REQUESTS.labels(
            route=route,
            method=method,
            status_class=status_class,
            model_version=MODEL_VERSION,
        ).inc()
        REQUEST_DURATION.labels(
            route=route,
            method=method,
            model_version=MODEL_VERSION,
        ).observe(time.perf_counter() - start)
        INFLIGHT.dec()


metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)
```

The code counts every request, records duration, and exposes `/metrics` for Prometheus scraping. The `status_class` label groups status codes into `2xx`, `4xx`, and `5xx`, which keeps cardinality low. The `model_version` label lets the team compare a new release with the previous release during a canary. The separate inference histogram shows whether slow requests came from the model runtime or from request parsing, feature fetching, or response building.

The endpoint code can wrap the ranking call with `time_inference("l4-ranker-pool")`. That small wrapper matters during incidents because it separates "the whole API is slow" from "the model call is slow." If model time stays normal while request time rises, the team looks at dependencies, request validation, queueing, or downstream services. If model time rises with GPU utilization, the team checks batch size, accelerator memory, model version, and node pressure.

![ShopGarden FastAPI metrics path](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-latency-errors-resources/shopgarden-fastapi-metrics-path.png)
*The middleware path gives every request the same evidence: count it, time it, group status codes safely, expose `/metrics`, and let alerts read the same signals the service emits.*

## Turn Metrics Into SLO Alerts
<!-- section-summary: Alerts should describe user harm, last long enough to avoid noise, and include labels that point responders toward the service, model version, and runbook. -->

Metrics help on dashboards, yet production teams need alerts for urgent user harm. An **SLO**, or service-level objective, is a target for reliability or speed that the team agrees to operate around. For ShopGarden, a clear objective is: 99 percent of recommendation requests should complete under 300 ms over a rolling 30-day window, and fewer than 0.5 percent should return server errors.

Prometheus alerting rules turn queries into notifications. A useful rule has a condition, a duration, labels, and annotations. The duration matters because a one-minute spike during a deploy can create noise, while a sustained fifteen-minute burn can deserve a page. The labels route the alert to the right team. The annotations tell the responder what to check first.

```yaml
groups:
  - name: recommendation-api-slo
    rules:
      - alert: RecommendationApiHighTailLatency
        expr: |
          histogram_quantile(
            0.95,
            sum by (le, route, model_version) (
              rate(recommendation_request_duration_seconds_bucket{
                route="/v1/recommendations",
                environment="prod"
              }[5m])
            )
          ) > 0.300
        for: 15m
        labels:
          severity: page
          service: recommendation-api
          owner: personalization-platform
        annotations:
          summary: "Recommendation API p95 latency is above 300 ms"
          runbook: "https://runbooks.shopgarden.example/recommendation-api/latency"

      - alert: RecommendationApiErrorBudgetBurn
        expr: |
          (
            sum(rate(recommendation_requests_total{
              route="/v1/recommendations",
              status_class="5xx",
              environment="prod"
            }[5m]))
            /
            sum(rate(recommendation_requests_total{
              route="/v1/recommendations",
              environment="prod"
            }[5m]))
          ) > 0.005
        for: 10m
        labels:
          severity: page
          service: recommendation-api
          owner: personalization-platform
        annotations:
          summary: "Recommendation API server error rate is above 0.5 percent"
          runbook: "https://runbooks.shopgarden.example/recommendation-api/errors"

      - alert: RecommendationApiFallbackSpike
        expr: |
          sum(rate(recommendation_fallbacks_total{environment="prod"}[10m]))
          /
          sum(rate(recommendation_requests_total{environment="prod"}[10m]))
          > 0.02
        for: 20m
        labels:
          severity: ticket
          service: recommendation-api
          owner: personalization-platform
        annotations:
          summary: "Recommendation fallback rate is above 2 percent"
```

The latency alert uses `histogram_quantile` over histogram buckets. The error alert divides server errors by total requests, which makes it stable across traffic changes. The fallback alert catches degraded behavior that still returns HTTP 200. Together, these rules page on user-facing harm rather than raw CPU alone.

Load tests help before production. A small k6 test can encode the same latency and error expectations used by production alerts. That gives the team a CI or staging gate before a model image reaches the canary.

```javascript
import http from "k6/http";

export const options = {
  thresholds: {
    http_req_failed: ["rate<0.005"],
    "http_req_duration{endpoint:recommendations}": ["p(95)<300"],
  },
};

export default function () {
  http.post(
    "https://staging.shopgarden.example/v1/recommendations",
    JSON.stringify({
      user_id: "load-user-128",
      product_id: "plant-stand-44",
      locale: "en-US",
      device_type: "mobile",
    }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { endpoint: "recommendations" },
    },
  );
}
```

The staging test cannot prove production health, yet it catches obvious release mistakes. If the test fails after a dependency update or model packaging change, the team can fix the issue before real users provide the signal.

## Watch Kubernetes And GPU Resources
<!-- section-summary: Kubernetes and GPU telemetry explain whether latency came from code, node pressure, memory limits, restarts, or accelerator saturation. -->

Service metrics tell you what users experience. Runtime metrics help explain why. Kubernetes resource requests and limits describe how much CPU and memory the scheduler reserves for a container and what limits the runtime enforces. For a model API, those settings influence cost, latency, and incident behavior.

ShopGarden deploys `recommendation-api` with separate CPU and memory requests, a memory limit, and an optional GPU limit for the ranking worker. A simplified deployment fragment can look like this:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: recommendation-api
  labels:
    app: recommendation-api
spec:
  replicas: 6
  selector:
    matchLabels:
      app: recommendation-api
  template:
    metadata:
      labels:
        app: recommendation-api
        model_version: ranker-2026-07-01
    spec:
      nodeSelector:
        accelerator: nvidia-l4
      containers:
        - name: api
          image: ghcr.io/shopgarden/recommendation-api@sha256:4a9b...
          ports:
            - containerPort: 8000
          resources:
            requests:
              cpu: "750m"
              memory: "2Gi"
            limits:
              memory: "4Gi"
              nvidia.com/gpu: "1"
```

The request values help Kubernetes schedule Pods onto nodes with enough capacity. The memory limit protects the node, and crossing it can terminate the container with an OOM kill. For CPU, many teams set requests carefully and evaluate CPU limits with workload-specific testing because CPU throttling can raise latency. The right policy depends on the cluster, tenancy, and service profile, so teams record the reasoning in the service runbook.

During an incident, the first commands are usually simple:

```bash
kubectl top pod -n ml-serving -l app=recommendation-api
kubectl describe pod -n ml-serving -l app=recommendation-api
kubectl get events -n ml-serving --sort-by=.lastTimestamp
kubectl rollout history deployment/recommendation-api -n ml-serving
```

`kubectl top` reads from the Kubernetes Metrics API, which provides CPU and memory usage for nodes and Pods when metrics-server is installed. The describe and events output show restarts, failed scheduling, image pull issues, readiness failures, and OOM kills. Rollout history connects a health change to a deployment change.

For GPU-backed inference, CPU and memory metrics are only part of the picture. NVIDIA DCGM Exporter exposes GPU metrics through a Prometheus-compatible `/metrics` endpoint. A dashboard can show `DCGM_FI_DEV_GPU_UTIL` for utilization and `DCGM_FI_DEV_FB_USED` for framebuffer memory. If p95 inference latency rises while GPU utilization sits near 100 percent and request traffic also rises, the likely next checks are batching, replica count, node pool capacity, and queue depth. If GPU utilization stays low while latency rises, the team looks at feature fetches, Python worker concurrency, cold starts, or upstream routing.

## Build The Dashboard For Triage
<!-- section-summary: A triage dashboard should line up user-visible symptoms with model version, deployment, and resource evidence on one page. -->

A good dashboard tells an incident story from top to bottom. ShopGarden puts user-facing signals first, then runtime evidence, then model-specific labels. The first row answers, "Are users hurt?" The second row answers, "Which release or model version is involved?" The third row answers, "Which resource or dependency changed?"

The recommendation dashboard has these panels:

| Panel | Query Shape | Triage Question |
|---|---|---|
| Request rate | `sum(rate(recommendation_requests_total[5m])) by (route, model_version)` | Did traffic change, and which model served it? |
| p95 latency | `histogram_quantile(0.95, sum by (le, model_version)(rate(recommendation_request_duration_seconds_bucket[5m])))` | Which version is slow? |
| Inference p95 | `histogram_quantile(0.95, sum by (le, device_pool)(rate(recommendation_inference_duration_seconds_bucket[5m])))` | Is the model call slow? |
| Error rate | `sum(rate(recommendation_requests_total{status_class="5xx"}[5m])) / sum(rate(recommendation_requests_total[5m]))` | Are requests failing? |
| Fallback rate | `sum(rate(recommendation_fallbacks_total[10m])) / sum(rate(recommendation_requests_total[10m]))` | Are users receiving degraded results? |
| Pod CPU and memory | container metrics by Pod | Is the service under resource pressure? |
| GPU utilization and memory | DCGM metrics by node and Pod | Is the accelerator pool saturated? |
| Restarts and rollout | Kubernetes deployment and restart metrics | Did a deploy or crash align with the symptom? |

The dashboard should include annotations for deployments, canary changes, configuration changes, and registry alias changes. When p95 latency jumps at the same time as `ranker-2026-07-01` reaches 25 percent traffic, the team has a concrete starting point. When latency rises without a release, the team looks at traffic, node pressure, dependency latency, and upstream callers.

The runbook ties the dashboard to action. A practical latency runbook for this service has five steps: check the alert panel, compare current and previous model versions, inspect inference latency against total request latency, check Kubernetes and GPU pressure, and choose the action. The action might be rollback, scale out, reduce canary weight, disable the neural re-ranker, or route to a cached fallback while the team investigates.

![ShopGarden latency incident triage](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-latency-errors-resources/shopgarden-latency-triage.png)
*A useful incident dashboard lines up user-visible symptoms, release annotations, runtime pressure, and the next runbook decision on one page.*

## Practical Checks, Mistakes, And Interview Understanding
<!-- section-summary: A strong service-health practice uses low-cardinality metrics, user-centered alerts, runtime evidence, and a clear triage path. -->

Before a model service goes live, the team should verify a small set of checks. The `/metrics` endpoint should expose request count, request duration, error count, in-flight requests, and model inference duration. Each metric should use bounded labels such as route, method, status class, environment, model version, and device pool. The dashboard should show p95 latency, error rate, fallback rate, request rate, CPU, memory, restarts, and GPU metrics where accelerators are in use. The alert rules should page on user harm, and every page should include an owner and runbook.

The most common mistakes are easy to make. Teams put user ids or request ids into metric labels and create high-cardinality time series. They alert on raw CPU instead of user-visible latency or errors. They average latency and miss the tail. They instrument the API boundary while skipping the model inference timer, which leaves them guessing during incidents. They collect GPU utilization without linking it to request latency, model version, and node pool capacity.

In an interview, you can explain service health metrics like this: a model service needs the same health signals as any production API, plus model-aware labels and runtime evidence. You track traffic, latency, errors, and saturation. You use histograms for latency, counters for requests and errors, gauges for in-flight work, Kubernetes metrics for CPU and memory, and DCGM-style exporter metrics for NVIDIA GPUs. You write SLO-style alerts around user harm, then use dashboards and runbooks to decide whether to rollback, scale, reduce traffic, or investigate a dependency.

## References

- [FastAPI Middleware](https://fastapi.tiangolo.com/tutorial/middleware/)
- [Prometheus Python Client Histogram](https://prometheus.github.io/client_python/instrumenting/histogram/)
- [Prometheus Alerting Rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Prometheus Histograms and Summaries](https://prometheus.io/docs/practices/histograms/)
- [Kubernetes Resource Metrics Pipeline](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/)
- [Kubernetes Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [NVIDIA DCGM Exporter](https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html)
- [Grafana k6 Thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
