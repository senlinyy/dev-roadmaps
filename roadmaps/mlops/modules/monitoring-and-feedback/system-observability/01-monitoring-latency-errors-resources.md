---
title: "Service Health Metrics"
description: "Track latency, errors, traffic, CPU, memory, and accelerator pressure for model-serving APIs."
overview: "Service health metrics show whether an inference service is fast, reliable, and sized for current demand. A supporting example follows a recommendations API through FastAPI instrumentation, Prometheus histograms, SLO-style alert rules, Kubernetes resource metrics, GPU telemetry, dashboards, and incident triage."
tags: ["MLOps", "core", "observability"]
order: 1
id: "article-mlops-monitoring-and-feedback-monitoring-latency-errors-resources"
---


## Service Health Metrics Show If The Model Service Can Keep Serving
<!-- section-summary: Service health metrics track the serving API around the model so the team can see speed, failures, traffic, and resource pressure before users feel the outage. -->

**Service health metrics** are the numbers that tell you whether a model-serving service is healthy as an API. They answer questions such as: how many requests are arriving, how long inference takes, how often requests fail, how much CPU and memory the service uses, and whether the GPU worker pool has enough headroom. The model may have great offline accuracy, yet the product still suffers if the service times out, returns errors, or runs out of memory during a traffic spike.

The monitoring module follows four connected layers. **Service health** covers traffic, latency, errors, and saturation. **Input and feature health** covers schema, freshness, missing values, skew, and drift. **Prediction and outcome health** covers score distributions, decisions, delayed labels, product quality, and segments. **Feedback health** covers label coverage, human-review quality, and retraining evidence. Every layer keeps model, feature, policy, and release identity so an alert can lead to a specific owner and action.

Service health comes first because the later layers depend on a reliable prediction and evidence path. A recommendation model can miss its latency target before any label arrives, while a service can also return `200 OK` and still make poor decisions. The module keeps those failure classes separate, then connects them during incident triage.

This article focuses on the normal service signals around inference. You will see how a team instruments a FastAPI service, exports Prometheus metrics, writes alert rules, checks Kubernetes CPU and memory pressure, includes GPU telemetry where accelerators matter, and uses a small dashboard to triage incidents. The goal is simple: give every model request a measurable service envelope before deeper model monitoring enters the picture.

## A Supporting Example: Recommendations API
<!-- section-summary: A supporting example is a product recommendations API where slow inference directly hurts page load time and revenue. -->

Imagine **ShopGarden**, a marketplace for home goods and plants. The product page calls a service named `recommendation-api` every time a shopper opens a listing. The endpoint `/v1/recommendations` receives a user id, product id, locale, and device type. It returns eight recommended items from a two-stage system: a fast candidate lookup and a ranking model.

The ranking model runs on a small L4 GPU node pool because the team uses a neural re-ranker with dense embeddings. The service also has CPU-heavy work: validation, feature fetching, business-rule filters, and response formatting. A healthy request usually finishes in 120 to 180 ms. At 300 ms, the product page starts to feel slow. At 800 ms, the frontend times out and shows a fallback carousel.

ShopGarden uses this stack:

| Layer | Tooling | What The Team Watches |
|---|---|---|
| API service | FastAPI, Uvicorn, Pydantic | request count, duration, status code, exceptions |
| Metrics system | Prometheus and Grafana | 50th-, 95th-, and 99th-percentile latency (p50, p95, p99), error rate, traffic, saturation |
| Cluster runtime | Kubernetes | CPU, memory, restarts, OOM kills, requested versus used capacity |
| GPU telemetry | NVIDIA Data Center GPU Manager (DCGM) Exporter | GPU utilization, memory usage, temperature, error counters |
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

The application needs one request counter, one request-duration histogram, a bounded error counter, an in-flight gauge, and a separate model-inference histogram. A shared metrics module keeps names, labels, and buckets consistent across routers.

:::expand[Instrument the FastAPI request and inference boundaries]{kind="example"}
The complete middleware example below uses the official Prometheus Python client. It groups status codes, attaches stable release identity, times the whole request, and provides a separate context manager for inference duration. Keep raw user, request, and product identifiers out of metric labels.

```python
import time
from contextlib import contextmanager

from fastapi import FastAPI, Request
from prometheus_client import Counter, Gauge, Histogram, make_asgi_app

app = FastAPI()

REQUESTS = Counter(
    "recommendation_requests_total",
    "Total recommendation API requests",
    ["route", "method", "status_class", "model_version", "environment"],
)

ERRORS = Counter(
    "recommendation_errors_total",
    "Total recommendation API errors by category",
    ["route", "error_type", "model_version", "environment"],
)

REQUEST_DURATION = Histogram(
    "recommendation_request_duration_seconds",
    "Recommendation API request duration in seconds",
    ["route", "method", "model_version", "environment"],
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
ENVIRONMENT = "prod"


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
        ERRORS.labels(route=route, error_type="validation", model_version=MODEL_VERSION, environment=ENVIRONMENT).inc()
        raise
    except TimeoutError:
        ERRORS.labels(route=route, error_type="dependency_timeout", model_version=MODEL_VERSION, environment=ENVIRONMENT).inc()
        raise
    finally:
        status_code = getattr(locals().get("response", None), "status_code", 500)
        status_class = f"{status_code // 100}xx"
        REQUESTS.labels(
            route=route,
            method=method,
            status_class=status_class,
            model_version=MODEL_VERSION,
            environment=ENVIRONMENT,
        ).inc()
        REQUEST_DURATION.labels(
            route=route,
            method=method,
            model_version=MODEL_VERSION,
            environment=ENVIRONMENT,
        ).observe(time.perf_counter() - start)
        INFLIGHT.dec()


metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)
```
:::

The code counts every request, records duration, and exposes `/metrics` for Prometheus scraping. The `status_class` label groups status codes into `2xx`, `4xx`, and `5xx`, which keeps cardinality low. The `model_version` label lets the team compare a new release with the previous release during a canary. The separate inference histogram shows whether slow requests came from the model runtime or from request parsing, feature fetching, or response building.

The endpoint code can wrap the ranking call with `time_inference("l4-ranker-pool")`. That small wrapper matters during incidents because it separates "the whole API is slow" from "the model call is slow." If model time stays normal while request time rises, the team looks at dependencies, request validation, queueing, or downstream services. If model time rises with GPU utilization, the team checks batch size, accelerator memory, model version, and node pressure.

![ShopGarden FastAPI metrics path](/content-assets/articles/article-mlops-monitoring-and-feedback-monitoring-latency-errors-resources/shopgarden-fastapi-metrics-path.png)
*The middleware path gives every request the same evidence: count it, time it, group status codes safely, expose `/metrics`, and let alerts read the same signals the service emits.*

## Turn Metrics Into SLO Alerts
<!-- section-summary: Alerts should describe user harm, last long enough to avoid noise, and include labels that point responders toward the service, model version, and runbook. -->

Metrics help on dashboards, yet production teams need alerts for urgent user harm. An **SLO**, or service-level objective, is a target for reliability or speed that the team agrees to operate around. For ShopGarden, a clear objective is: 99 percent of recommendation requests should complete under 300 ms over a rolling 30-day window, and fewer than 0.5 percent should return server errors.

Prometheus alerting rules turn queries into notifications. A useful rule has a condition, a duration, labels, and annotations. The duration matters because a one-minute spike during a deploy can create noise, while a sustained fifteen-minute burn can deserve a page. The labels route the alert to the right team. The annotations tell the responder what to check first.

:::expand[Encode latency, error, and fallback alerts]{kind="example"}
This complete rule group shows three different operational meanings. Latency and server errors use fast multi-window burn-rate pages because they consume formal SLO budgets. A fallback spike creates a lower-urgency ticket because the service still answers while product quality may be degraded.

```yaml
groups:
  - name: recommendation-api-slo
    rules:
      - alert: RecommendationApiLatencyBudgetBurn
        expr: |
          (
            1 -
            sum(rate(recommendation_request_duration_seconds_bucket{route="/v1/recommendations",environment="prod",le="0.3"}[1h]))
            /
            sum(rate(recommendation_request_duration_seconds_count{route="/v1/recommendations",environment="prod"}[1h]))
          ) > 14.4 * 0.01
          and
          (
            1 -
            sum(rate(recommendation_request_duration_seconds_bucket{route="/v1/recommendations",environment="prod",le="0.3"}[5m]))
            /
            sum(rate(recommendation_request_duration_seconds_count{route="/v1/recommendations",environment="prod"}[5m]))
          ) > 14.4 * 0.01
        for: 2m
        labels:
          severity: page
          service: recommendation-api
          owner: personalization-platform
        annotations:
          summary: "Recommendation API is rapidly consuming its 99%-under-300-ms latency budget"
          runbook: "https://runbooks.shopgarden.example/recommendation-api/latency"

      - alert: RecommendationApiErrorBudgetBurn
        expr: |
          (
            sum(rate(recommendation_requests_total{route="/v1/recommendations",status_class="5xx",environment="prod"}[1h]))
            /
            sum(rate(recommendation_requests_total{route="/v1/recommendations",environment="prod"}[1h]))
          ) > 14.4 * 0.005
          and
          (
            sum(rate(recommendation_requests_total{route="/v1/recommendations",status_class="5xx",environment="prod"}[5m]))
            /
            sum(rate(recommendation_requests_total{route="/v1/recommendations",environment="prod"}[5m]))
          ) > 14.4 * 0.005
        for: 2m
        labels:
          severity: page
          service: recommendation-api
          owner: personalization-platform
        annotations:
          summary: "Recommendation API is rapidly consuming its server-error budget"
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
:::

The latency alert measures the exact service-level indicator in the SLO: the fraction of requests slower than 300 ms. A p95 query would answer a different question and could not prove that 99 percent stayed below the boundary. The alert applies a 14.4-times **burn rate** to both a one-hour and five-minute window. Burn rate describes how quickly the service consumes its allowed bad-request budget; the two windows require both sustained impact and current impact before paging. The error alert applies the same pattern to the separate 0.5 percent server-error budget. The fallback alert catches degraded behavior that still returns HTTP 200.

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

ShopGarden deploys `recommendation-api` with separate CPU and memory requests, a memory limit, and an optional GPU limit for the ranking worker. The workload identity, immutable image, model version, accelerator selector, and resource contract should all be visible in the release record.

:::expand[Inspect the Kubernetes resource declaration]{kind="example"}
This simplified fragment shows how scheduler inputs connect to service-health signals. The GPU resource and node selector place the workload, CPU and memory requests influence scheduling, and the memory limit defines a termination boundary that an incident dashboard should expose.

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
:::

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

## Operational Checks And Failure Modes
<!-- section-summary: A strong service-health practice uses low-cardinality metrics, user-centered alerts, runtime evidence, and a clear triage path. -->

Before a model service goes live, the team should verify a small set of checks. The `/metrics` endpoint should expose request count, request duration, error count, in-flight requests, and model inference duration. Each metric should use bounded labels such as route, method, status class, environment, model version, and device pool. The dashboard should show p95 latency, error rate, fallback rate, request rate, CPU, memory, restarts, and GPU metrics where accelerators are in use. The alert rules should page on user harm, and every page should include an owner and runbook.

The most common mistakes are easy to make. Teams put user ids or request ids into metric labels and create high-cardinality time series. They alert on raw CPU instead of user-visible latency or errors. They average latency and miss the tail. They instrument the API boundary while skipping the model inference timer, which leaves them guessing during incidents. They collect GPU utilization without linking it to request latency, model version, and node pool capacity.

A production model service needs the same health signals as any production API, plus model-aware labels and runtime evidence. The operating view combines traffic, latency, errors, saturation, model version, fallback use, and accelerator pressure. Histograms, counters, gauges, Kubernetes metrics, and DCGM exporter metrics feed alerts and dashboards, while the runbook tells responders when to roll back, scale, reduce traffic, or investigate a dependency.

## References

- [FastAPI Middleware](https://fastapi.tiangolo.com/tutorial/middleware/)
- [Prometheus Python Client Histogram](https://prometheus.github.io/client_python/instrumenting/histogram/)
- [Prometheus Alerting Rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Prometheus Histograms and Summaries](https://prometheus.io/docs/practices/histograms/)
- [Kubernetes Resource Metrics Pipeline](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/)
- [Kubernetes Resource Management for Pods and Containers](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [NVIDIA DCGM Exporter](https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html)
- [Grafana k6 Thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
- [Google SRE Workbook: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
