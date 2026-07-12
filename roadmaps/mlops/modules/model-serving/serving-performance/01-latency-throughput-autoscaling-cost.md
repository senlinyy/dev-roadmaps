---
title: "Inference Cost and Scale"
description: "Tune a production model API with latency percentiles, throughput, bounded queues, Kubernetes HPA, KEDA, load tests, observability, and cost per request."
overview: "Inference cost and scale is the day-to-day practice of serving predictions fast enough for users, scaling replicas from real demand signals, and checking the money spent for each successful request."
tags: ["MLOps", "serving", "performance", "autoscaling"]
order: 1
id: "article-mlops-model-serving-latency-throughput-autoscaling-cost"
---

## Table of Contents

1. [What Inference Cost and Scale Means](#what-inference-cost-and-scale-means)
2. [The Pieces We Will Connect](#the-pieces-we-will-connect)
3. [Start With the Model API Contract](#start-with-the-model-api-contract)
4. [Latency Percentiles Tell You What Users Actually Feel](#latency-percentiles-tell-you-what-users-actually-feel)
5. [Throughput and Concurrency Tell You How Much Work the Service Can Carry](#throughput-and-concurrency-tell-you-how-much-work-the-service-can-carry)
6. [Queues Protect the Service Only When They Stay Short](#queues-protect-the-service-only-when-they-stay-short)
7. [Autoscaling With HPA and KEDA](#autoscaling-with-hpa-and-keda)
8. [Load Testing the Capacity Plan](#load-testing-the-capacity-plan)
9. [Prometheus and OpenTelemetry Make the Evidence Usable](#prometheus-and-opentelemetry-make-the-evidence-usable)
10. [Cost Per Request Turns Performance Into a Business Number](#cost-per-request-turns-performance-into-a-business-number)
11. [Production Checks and Incident Response](#production-checks-and-incident-response)
12. [Putting It Together](#putting-it-together)
13. [References](#references)

## What Inference Cost and Scale Means
<!-- section-summary: Inference cost and scale means serving predictions fast enough, for enough requests, with enough capacity, while tracking the cost of each successful response. -->

**Inference cost and scale** is the work of running a model API so it answers users quickly, handles the request volume the product sends, grows and shrinks capacity from real signals, and keeps the serving bill tied to customer value. The model already exists at this point in the roadmap. Now the question is different: can the model serve live traffic with healthy **latency**, enough **throughput**, sensible **autoscaling**, controlled **queues**, and a cost per request the business can afford?

We will follow one concrete system all the way through. LumaShelf is an online grocery marketplace. When a shopper opens the home page, the application calls a model API named `fresh-rank-api`. The model receives the shopper region, device type, cart context, and 80 candidate grocery items. It returns the top 12 items to show in the first recommendation shelf. The model is useful because it lifts click-through and basket size, so product teams want it on the request path. That also means a slow prediction delays the home page.

The first production target is simple enough to say out loud: during the lunch peak, LumaShelf wants `fresh-rank-api` to handle 900 successful requests per second, keep p95 latency under 180 ms, keep p99 latency under 350 ms, and keep serving cost near $1.25 per million successful requests for the CPU-based version of the model. Those numbers are examples, and they make the tradeoffs visible. A faster model with too few replicas will still queue. A larger fleet with no cost check can hide waste. A cheap fleet that misses p99 can hurt checkout traffic.

This article connects the whole path: the API contract, latency percentiles, throughput, concurrency, queues, HPA, KEDA, load testing, Prometheus, OpenTelemetry, and cost per request. The goal is to use each piece of evidence well enough to know when the serving team should optimize the model, add replicas, change autoscaling signals, shorten queues, or reject traffic before users wait too long.

## The Pieces We Will Connect
<!-- section-summary: Serving performance uses a small set of connected concepts: request shape, percentiles, throughput, concurrency, queues, scaling signals, telemetry, and cost. -->

A model serving stack has many moving parts, so we will name the important ones before we tune anything. The same request passes through an API gateway, a Kubernetes Service, several model server pods, a short in-process queue, the model runtime, and the response serializer. Every part can add delay or cost.

| Concept | Simple meaning | LumaShelf example |
|---|---|---|
| **Latency** | How long one request takes from the caller's view | Home page waits 147 ms for ranking |
| **p95 and p99** | Tail percentiles that show slow requests | 95% under 180 ms, 99% under 350 ms |
| **Throughput** | Completed requests per second | 900 successful ranking calls per second |
| **Concurrency** | Requests in progress at the same time | 140 ranking calls active across the fleet |
| **Queue depth** | Requests waiting before inference starts | 24 requests waiting across pods |
| **HPA** | Kubernetes scaling controller for a target workload | Scale Deployment from CPU or custom metrics |
| **KEDA** | Event-driven scaler that can feed external metrics into HPA | Scale from Prometheus request rate or queue depth |
| **Cost per request** | Serving spend divided by successful predictions | $1.12 per million successful requests |

These pieces connect in a loop. The API contract tells you what the request contains. Latency percentiles show user experience. Throughput and concurrency show capacity. Queues reveal overload before errors rise. Autoscaling changes pod count. Load tests check the plan before a release. Prometheus and OpenTelemetry turn runtime behavior into evidence. Cost per request tells the team whether the serving design is financially healthy.

The rest of the article follows that loop in production order. We start with the API because the request shape affects every metric that comes after it.

## Start With the Model API Contract
<!-- section-summary: A clear model API contract gives the team a stable request shape, response shape, timeout, fallback, and measurement boundary. -->

A **model API contract** is the shape of the request and response that callers rely on. It includes the endpoint, input fields, output fields, timeout, version, error behavior, and fallback path. This matters for performance because the server can only tune what it can see consistently. If every caller sends a different payload size, every latency chart mixes several workloads into one blurry number.

LumaShelf keeps the first production contract narrow. The home page sends at most 80 candidate items. The API returns 12 ranked item IDs, a score, the model version, and a trace ID. The gateway timeout is 500 ms, while the model service aims to finish much earlier. The fallback returns a cached popular-items shelf for the same region if the model API fails to answer quickly.

Here is the request and response shape the serving team uses in examples, tests, and dashboards:

```json
{
  "request_id": "req_20260705_184501_9ac1",
  "shopper_id": "shopper_4812",
  "region": "us-east-1",
  "device": "mobile",
  "cart_item_ids": ["milk_2pct", "strawberries_16oz"],
  "candidate_item_ids": ["eggs_large", "bananas", "spinach_bag"],
  "max_results": 12
}
```

```json
{
  "request_id": "req_20260705_184501_9ac1",
  "model_name": "fresh-rank",
  "model_version": "2026-07-03.4",
  "ranked_items": [
    {"item_id": "bananas", "score": 0.931},
    {"item_id": "eggs_large", "score": 0.874}
  ],
  "served_from": "model",
  "trace_id": "4f9d7e12c4a7486d9c5c6a0b81d2bb1f"
}
```

The fields are boring in a useful way. `candidate_item_ids` limits the work the model server performs. `model_version` lets dashboards compare the new model against the old one. `served_from` tells support whether the shopper saw a model answer or a fallback answer. `trace_id` lets the team connect the gateway span, feature lookup span, inference span, and response span during an incident.

The serving team also writes down the timeout and fallback rule beside the API contract:

```yaml
fresh_rank_api:
  route: POST /v1/recommendations/rank
  model_name: fresh-rank
  model_version: "2026-07-03.4"
  max_candidates: 80
  response_results: 12
  caller_timeout_ms: 500
  service_target_p95_ms: 180
  service_target_p99_ms: 350
  overload_policy:
    max_inflight_per_pod: 8
    max_queue_per_pod: 16
    fallback_after_ms: 300
    fallback_response: regional_popular_items
```

That small config gives the rest of the article a shared boundary. Latency starts when the service receives the request and ends when it returns a response. Throughput counts successful model and fallback responses separately. Queue depth has a clear limit per pod. Cost per request counts only successful responses so error storms never make the math look cheap.

## Latency Percentiles Tell You What Users Actually Feel
<!-- section-summary: Percentiles show the distribution of request speed, so p95 and p99 expose slow-tail behavior that averages hide. -->

**Latency** is the time one request spends waiting for a response. For a model API, the total latency includes request parsing, validation, feature fetches, queue wait, model runtime, post-processing, and response serialization. A single average latency number can hide the slow requests that users notice. That is why serving teams talk about **percentiles**.

A percentile says what share of requests finished under a certain time. If p95 is 180 ms, then 95 out of 100 requests finished in 180 ms or less during the measurement window. If p99 is 350 ms, then 99 out of 100 finished in 350 ms or less. The remaining 1 request out of 100 may still be much slower, so teams also watch max latency during incidents, though max values can jump around from one rare event.

For LumaShelf, p50 tells the team how the common request behaves. p95 tells product whether most shoppers see a responsive page. p99 tells on-call engineers whether tail requests are close to timeout. The gap between p50 and p99 matters. A p50 of 70 ms with a p99 of 900 ms usually points to queueing, cold workers, noisy neighbors, slow feature calls, or runtime pauses rather than a uniformly slow model.

The team uses a simple latency budget to keep the discussion practical:

| Step | Target budget |
|---|---:|
| Request validation and JSON parsing | 10 ms |
| Feature fetch from online store | 35 ms |
| Queue wait inside the pod | 25 ms |
| Model runtime | 80 ms |
| Response formatting and network write | 30 ms |
| Total p95 target | 180 ms |

![LumaShelf fresh-rank-api request path with latency budget](/content-assets/articles/article-mlops-model-serving-latency-throughput-autoscaling-cost/latency-budget-request-path.png)

*The request path makes the p95 target concrete: each serving step gets a budget, and the bounded queue has a fallback rule before shoppers wait too long.*

This budget helps during reviews. If the model runtime p95 is already 140 ms, adding a 50 ms feature lookup will miss the service target. If queue wait p95 grows from 4 ms to 80 ms during peak, the model code may be fine while the fleet is too small. Percentiles give each owner a number they can improve: feature platform owns feature fetch time, serving owns queue wait and model runtime, platform owns pod scheduling and node pressure.

Prometheus histograms are a common way to calculate these percentiles for replicated services. The model server records each request duration into histogram buckets. Prometheus can aggregate buckets across pods and calculate a p95 or p99 for a route and model version:

```promql
histogram_quantile(
  0.95,
  sum by (le, model_version) (
    rate(model_request_duration_seconds_bucket{
      route="/v1/recommendations/rank",
      served_from="model"
    }[5m])
  )
)
```

The query reads the request-duration buckets over the last five minutes, groups the buckets by `le` and `model_version`, and asks for the 95th percentile. Grouping by model version matters during a canary. If version `2026-07-03.4` has p95 of 210 ms while the previous version stays at 145 ms, the rollback decision has direct evidence.

Latency tells us how one request behaves. The next question is how many requests the fleet can answer at the same time.

## Throughput and Concurrency Tell You How Much Work the Service Can Carry
<!-- section-summary: Throughput measures completed work per second, while concurrency estimates how many requests must run at once to sustain that work. -->

**Throughput** is the amount of work the service completes per second. For HTTP model APIs, teams usually track successful requests per second, failed requests per second, and fallback requests per second. Throughput has to be paired with latency because a service can accept many requests and still make users wait too long.

**Concurrency** is the number of requests in progress at the same time. It connects throughput and latency in a practical sizing rule: active requests across the fleet are roughly requests per second multiplied by request time in seconds. Serving teams often add a safety factor because traffic arrives in bursts and latency changes under load.

For the LumaShelf lunch peak, the plan uses the p95 target:

```yaml
capacity_plan:
  target_successful_rps: 900
  target_p95_latency_seconds: 0.18
  safety_factor: 1.4
  estimated_active_requests: 227
  safe_concurrency_per_pod: 8
  estimated_pods_for_peak: 29
```

![LumaShelf capacity planning from RPS to pods and autoscaling signals](/content-assets/articles/article-mlops-model-serving-latency-throughput-autoscaling-cost/capacity-planning-queue-autoscaling.png)

*Capacity planning connects target RPS, p95 latency, safety headroom, per-pod concurrency, and queue-depth signals before HPA or KEDA changes replicas.*

The estimate is `900 * 0.18 * 1.4 = 226.8` active requests across the fleet. If one pod stays healthy at 8 active requests, the peak needs about 29 pods. The team treats this number as a starting point for a load test. Python workers, ONNX Runtime threads, CPU limits, garbage collection, feature-store latency, and network behavior can all change the real limit.

The team finds `safe_concurrency_per_pod` with a single-pod test before testing the full fleet. They run one pod with the production CPU and memory requests, fixed model version, fixed candidate count, and the same feature-store path. They increase concurrency until p95 latency crosses the budget or errors rise. If one pod handles 10 active requests at p95 170 ms and starts queueing badly at 12, the team may set the production limit at 8 to keep headroom.

The model server should expose these basic metrics:

```python
from prometheus_client import Counter, Gauge, Histogram

REQUESTS = Counter(
    "model_requests_total",
    "Model API requests by outcome",
    ["route", "model_name", "model_version", "outcome", "served_from"],
)

INFLIGHT = Gauge(
    "model_inflight_requests",
    "Requests currently executing inside the model service",
    ["route", "model_name", "model_version"],
)

QUEUE_DEPTH = Gauge(
    "model_queue_depth",
    "Requests waiting inside the model service before inference starts",
    ["route", "model_name", "model_version"],
)

LATENCY = Histogram(
    "model_request_duration_seconds",
    "End-to-end model API latency observed by the model service",
    ["route", "model_name", "model_version", "served_from"],
    buckets=(0.025, 0.05, 0.075, 0.1, 0.15, 0.18, 0.25, 0.35, 0.5, 0.75, 1.0),
)
```

The labels deserve care. `model_version` makes canary analysis possible. `outcome` separates success, timeout, validation error, and internal error. `served_from` separates model output from fallback output. The route label should stay low-cardinality, such as `/v1/recommendations/rank`, rather than raw URLs with request IDs. High-cardinality labels can make metrics storage expensive and slow.

Throughput and concurrency give us the fleet size target. The next danger is the space between the load balancer and the model runtime: queues.

## Queues Protect the Service Only When They Stay Short
<!-- section-summary: A bounded queue absorbs tiny bursts, while a long queue adds latency and hides overload until users wait too long. -->

A **queue** is a waiting area for work before it can start. Queues appear in several places: the API gateway, the web server, the model runtime thread pool, a message broker, or an async batch worker. For a synchronous model API on a home page, the queue should be short and bounded because the shopper is waiting.

LumaShelf uses a small in-process queue per pod. Each pod can run 8 requests at once and hold 16 more for a short time. If the queue is full or a request waits too long, the service returns the regional popular-items fallback. That policy protects the page from a slow death spiral where every request waits behind old requests that already missed the user's patience window.

The behavior can be written as a serving rule:

```yaml
queue_policy:
  max_inflight_per_pod: 8
  max_queue_per_pod: 16
  max_queue_wait_ms: 75
  fallback_after_total_ms: 300
  reject_validation_errors: true
  fallback_on_overload: true
```

The important part is the bounded queue. If the queue has no limit, a traffic spike creates a backlog. The backlog raises p95 and p99 latency. Slower requests hold workers longer. Workers free up slowly. More requests arrive. The service spends the next few minutes answering old requests after the product moment already passed.

Queue metrics also tell the autoscaler something CPU often misses. A model server can have a growing queue while CPU still looks moderate if the bottleneck is feature-store latency or a downstream lock. A queue-depth metric catches that pressure earlier. LumaShelf watches both average queue depth and p95 queue wait:

```promql
sum(model_queue_depth{route="/v1/recommendations/rank"})
```

```promql
histogram_quantile(
  0.95,
  sum by (le) (
    rate(model_queue_wait_seconds_bucket{
      route="/v1/recommendations/rank"
    }[5m])
  )
)
```

For async inference, the queue story changes. A fraud review batch, image enrichment job, or nightly recommendations refresh can sit in Kafka, SQS, Pub/Sub, or another broker. In that case, queue depth and lag are first-class scaling signals because the work is decoupled from one browser request. KEDA is especially useful for that event-driven pattern. For the live home-page API, a short queue and fast fallback keep the user path healthy.

Now we have the signals. The next step is turning those signals into replica changes.

## Autoscaling With HPA and KEDA
<!-- section-summary: HPA changes replica count from Kubernetes metrics, while KEDA adds event and external metric triggers and then drives HPA for the target workload. -->

**Autoscaling** changes the number of running replicas based on demand. In Kubernetes, **Horizontal Pod Autoscaler**, usually called **HPA**, adjusts replicas for a workload such as a Deployment. HPA reads metrics on a control loop and updates the desired replica count. For CPU scaling, the pods need CPU requests because HPA calculates utilization against those requests.

LumaShelf starts with a plain HPA for the first version because CPU is a decent signal for the CPU-bound ONNX model runtime. The Deployment sets resource requests and limits, readiness probes, and a graceful shutdown period so Kubernetes can remove a pod from traffic before it exits:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fresh-rank-api
  namespace: ml-serving
spec:
  replicas: 6
  selector:
    matchLabels:
      app: fresh-rank-api
  template:
    metadata:
      labels:
        app: fresh-rank-api
        model_name: fresh-rank
        model_version: "2026-07-03.4"
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: api
          image: registry.example.com/ml/fresh-rank-api:2026-07-03.4
          ports:
            - containerPort: 8080
          env:
            - name: MAX_INFLIGHT
              value: "8"
            - name: MAX_QUEUE
              value: "16"
          resources:
            requests:
              cpu: "750m"
              memory: "1Gi"
            limits:
              cpu: "1500m"
              memory: "2Gi"
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /live
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
```

The HPA sets a floor, a ceiling, and a CPU target:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: fresh-rank-api
  namespace: ml-serving
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: fresh-rank-api
  minReplicas: 6
  maxReplicas: 40
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
```

The target says the fleet should add pods as average CPU utilization rises above 65% of requested CPU. The scale-up policy lets the fleet grow quickly during lunch. The scale-down stabilization window slows down removals after a short quiet patch.

CPU works well when CPU is the bottleneck. Model APIs often need richer signals. If the feature store slows down, CPU may fall while queue depth rises. If traffic jumps faster than CPU metrics react, request-rate scaling can add pods earlier. This is where **KEDA** helps. KEDA watches event sources and external metrics, exposes those metrics to Kubernetes, and creates or manages an HPA for the target workload.

For `fresh-rank-api`, the team uses KEDA with a Prometheus scaler after the first incident review shows queue depth rising before CPU. KEDA queries Prometheus, compares the result to a threshold, and feeds the scaling decision through HPA:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: fresh-rank-api-prometheus
  namespace: ml-serving
spec:
  scaleTargetRef:
    name: fresh-rank-api
  pollingInterval: 30
  cooldownPeriod: 300
  minReplicaCount: 6
  maxReplicaCount: 40
  fallback:
    failureThreshold: 3
    replicas: 12
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleUp:
          stabilizationWindowSeconds: 30
          policies:
            - type: Percent
              value: 100
              periodSeconds: 60
        scaleDown:
          stabilizationWindowSeconds: 300
          policies:
            - type: Percent
              value: 25
              periodSeconds: 60
  triggers:
    - type: prometheus
      metadata:
        serverAddress: http://prometheus.monitoring.svc.cluster.local:9090
        threshold: "28"
        activationThreshold: "4"
        query: |
          sum(model_queue_depth{namespace="ml-serving", app="fresh-rank-api"})
```

This scaler asks Prometheus for total queue depth across the API pods. The threshold of 28 means the service starts scaling when the backlog is roughly one pod's safe queue capacity across the fleet. The activation threshold avoids waking extra pods for tiny blips. The fallback setting gives KEDA a safe replica count if the scaler fails to read Prometheus several times in a row.

One ownership detail matters in production: a Deployment should have one autoscaling owner for the same replica field. The team can use a plain HPA or a KEDA ScaledObject that creates and manages the HPA. Running two separate controllers against the same Deployment can make scaling behavior confusing. During migration, platform engineers should plan ownership transfer, alert rules, and rollback before replacing the plain HPA with KEDA.

Autoscaling config can look convincing in review. The load test is where the plan meets real traffic.

## Load Testing the Capacity Plan
<!-- section-summary: Load testing checks latency, throughput, queueing, scaling speed, and error behavior before real users send peak traffic. -->

A **load test** sends controlled traffic to the service so the team can measure behavior before a launch or peak event. For model serving, the test should use realistic payloads, candidate counts, auth headers, keep-alive behavior, and regional traffic patterns. A tiny test with one sample request can give a false sense of safety because model latency often changes with payload size.

LumaShelf uses k6 for the service-level test. The script ramps to 900 requests per second, holds that rate, then ramps down. It checks p95, p99, and error rate. The team runs it against a staging environment with the same pod resources and node pool shape as production. They also run a smaller smoke test in production after deployment with a protected traffic source.

```javascript
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    lunch_peak: {
      executor: "ramping-arrival-rate",
      startRate: 100,
      timeUnit: "1s",
      preAllocatedVUs: 250,
      maxVUs: 1200,
      stages: [
        { target: 300, duration: "5m" },
        { target: 900, duration: "10m" },
        { target: 900, duration: "20m" },
        { target: 100, duration: "5m" }
      ]
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(95)<180", "p(99)<350"]
  }
};

const payload = JSON.stringify({
  request_id: "load-test",
  shopper_id: "shopper_load_001",
  region: "us-east-1",
  device: "mobile",
  cart_item_ids: ["milk_2pct", "strawberries_16oz"],
  candidate_item_ids: Array.from({ length: 80 }, (_, i) => `item_${i}`),
  max_results: 12
});

export default function () {
  const res = http.post(
    "https://staging-api.example.com/v1/recommendations/rank",
    payload,
    {
      headers: {
        "Content-Type": "application/json",
        "X-Test-Traffic": "k6-lunch-peak"
      },
      timeout: "500ms"
    }
  );

  check(res, {
    "response is successful": (r) => r.status === 200,
    "model version is present": (r) => r.json("model_version") !== ""
  });
}
```

The threshold lines turn the performance target into a pass/fail gate. If p95 crosses 180 ms or p99 crosses 350 ms, the test fails. If more than 0.5% of requests fail, the test fails. The team still reads the graphs after a pass because a clean final number can hide a brief scaling delay during the ramp.

The load-test review packet should include:

| Evidence | Healthy sign |
|---|---|
| p50, p95, p99 latency by model version | p95 and p99 stay below target during hold period |
| Successful requests per second | Service sustains 900 RPS without fallback spike |
| Queue depth and queue wait | Queue drains during scale-up and stays bounded |
| Pod count over time | Replicas grow before sustained queueing |
| CPU and memory by pod | Pods stay below throttling and memory pressure |
| Error and fallback rate | Errors stay below threshold and fallback stays explainable |
| Cost estimate for the window | Cost per successful request stays inside target |

Load testing also checks the autoscaling delay. If traffic ramps from 300 to 900 RPS in five minutes and pod count takes eight minutes to catch up, users will see slow requests during the real launch. The fix might be a higher `minReplicaCount` during known peaks, a faster scale-up policy, a KEDA trigger from request rate, or pre-warming a larger model runtime pool before a campaign.

The load test gives us evidence for one planned window. The production telemetry keeps collecting that evidence all day.

## Prometheus and OpenTelemetry Make the Evidence Usable
<!-- section-summary: Prometheus metrics show fleet-level rates and percentiles, while OpenTelemetry traces connect one slow request to the exact slow step. -->

**Prometheus** is commonly used for metrics such as request counts, histogram buckets, queue depth, CPU, memory, and replica count. **OpenTelemetry** gives a standard way to produce traces, metrics, and logs across services. In a model API, metrics tell the team what is happening across the fleet, and traces explain why one request was slow.

The service should expose a small set of metrics that answer production questions:

| Question | Metric or query |
|---|---|
| How many successful predictions are we serving? | `sum(rate(model_requests_total{outcome="success"}[5m]))` |
| How slow is the API at p95 and p99? | `histogram_quantile()` over `model_request_duration_seconds_bucket` |
| Are requests waiting before inference? | `sum(model_queue_depth)` and p95 queue wait |
| Are we falling back too often? | `sum(rate(model_requests_total{served_from="fallback"}[5m]))` |
| Did the canary change behavior? | Same metrics grouped by `model_version` |
| Is the pod under CPU pressure? | CPU usage, throttling, and memory working set by pod |

OpenTelemetry adds the request story. A trace for one slow home-page call should show spans for gateway routing, model API validation, feature lookup, queue wait, inference, and response serialization. The trace attributes should include stable names such as `model.name`, `model.version`, `route`, `served_from`, and `request.candidate_count`. The OpenTelemetry HTTP semantic conventions also define standard HTTP server metrics such as `http.server.request.duration`, which helps teams keep service dashboards consistent across languages.

Here is a practical span shape for the model API:

```yaml
trace:
  name: POST /v1/recommendations/rank
  attributes:
    http.route: /v1/recommendations/rank
    model.name: fresh-rank
    model.version: "2026-07-03.4"
    request.candidate_count: 80
    served_from: model
  child_spans:
    - validate_request: 4ms
    - fetch_online_features: 32ms
    - wait_for_worker: 18ms
    - run_model_inference: 71ms
    - serialize_response: 9ms
```

This trace makes an on-call conversation concrete. If `fetch_online_features` jumps to 180 ms, the incident belongs near the feature store. If `wait_for_worker` jumps to 120 ms while inference stays at 70 ms, the fleet is queueing. If `run_model_inference` jumps after a new model version, the model artifact or runtime config needs review.

The dashboards should pair golden signals with model-specific signals:

```promql
sum(rate(model_requests_total{route="/v1/recommendations/rank", outcome="success"}[5m]))
```

```promql
sum(rate(model_requests_total{route="/v1/recommendations/rank", served_from="fallback"}[5m]))
/
sum(rate(model_requests_total{route="/v1/recommendations/rank"}[5m]))
```

```promql
histogram_quantile(
  0.99,
  sum by (le, model_version) (
    rate(model_request_duration_seconds_bucket{route="/v1/recommendations/rank"}[5m])
  )
)
```

The dashboard should avoid labels that change on every request, such as `request_id` or `shopper_id`. Those belong in traces or logs with privacy controls. Metrics need stable labels so Prometheus can aggregate them cheaply.

Now that the service has performance evidence, the team can attach money to the same window.

## Cost Per Request Turns Performance Into a Business Number
<!-- section-summary: Cost per request divides serving infrastructure spend by successful responses, so the team can compare model versions, scaling policies, and hardware choices. -->

**Cost per request** is the serving cost for a time window divided by successful responses in that same window. It helps the team compare choices that all pass latency tests. A model version that saves 20 ms and doubles CPU cost may still be worth it for checkout ranking. A model version that adds tiny relevance gains and triples cost may need pruning, distillation, caching, or a cheaper runtime.

For this article, we use serving infrastructure cost only: Kubernetes nodes, model pods, gateway share, observability overhead, and any dedicated feature-cache capacity used by the online path. Training, data pipelines, experimentation, and engineering time stay outside this particular number. Real finance reports may allocate costs differently, so the article uses a worksheet pattern rather than a cloud price claim.

The LumaShelf serving worksheet for one lunch hour looks like this:

| Item | Example calculation | Cost |
|---|---:|---:|
| Model-serving node pool | 8 nodes * $0.32 per node hour * 1 hour | $2.56 |
| API gateway allocation | Shared gateway estimate for route | $0.24 |
| Online feature cache allocation | Cache CPU and memory share | $0.46 |
| Metrics and tracing allocation | Extra telemetry ingest for route | $0.18 |
| Total serving cost | Sum for the one-hour window | $3.44 |
| Successful responses | 900 RPS * 3600 seconds * 99.7% success | 3,230,280 |
| Cost per request | $3.44 / 3,230,280 | $0.000001065 |
| Cost per million requests | Cost per request * 1,000,000 | $1.07 |

This number gives the team a common language. If the product target is $1.25 per million requests, this version passes. If a larger model raises the node pool to 20 nodes and cost per million reaches $2.40, the model review should ask what product lift pays for that increase. If KEDA lowers overnight replicas from 6 to 2 and cost drops while p95 stays healthy, the scaling policy creates real savings.

Cost per request should be broken down by route and model version:

```sql
SELECT
  model_name,
  model_version,
  DATE_TRUNC(observed_at, HOUR) AS serving_hour,
  SUM(serving_cost_usd) / NULLIF(SUM(successful_requests), 0) AS cost_per_request,
  1000000 * SUM(serving_cost_usd) / NULLIF(SUM(successful_requests), 0) AS cost_per_million_requests
FROM ml_finance.serving_cost_hourly
WHERE route = '/v1/recommendations/rank'
  AND observed_at >= TIMESTAMP '2026-07-05 12:00:00 UTC'
  AND observed_at < TIMESTAMP '2026-07-05 13:00:00 UTC'
GROUP BY model_name, model_version, serving_hour
ORDER BY serving_hour, model_version;
```

The `NULLIF` guard keeps empty windows from dividing by zero. The grouping by model version lets reviewers compare a canary with the stable version during the same traffic period. The route filter prevents one expensive API from blending into a cheap one.

Cost also changes the autoscaling conversation. A high `minReplicaCount` protects p99 during sudden spikes, and it spends money while the service is quiet. A low `minReplicaCount` saves money overnight, and it can add cold-start delay during the first traffic burst. The right value comes from traffic shape, model warm-up time, business criticality, and fallback quality.

## Production Checks and Incident Response
<!-- section-summary: A serving team needs release gates, alerts, rollback steps, and incident checks that connect latency, queueing, autoscaling, and cost. -->

The production workflow should turn the article concepts into a review habit. Before a model version moves to full traffic, the serving owner, model owner, and platform owner should inspect the same packet of evidence. That packet needs more than offline model quality. It needs API compatibility, load-test results, p95 and p99 latency, throughput, queue behavior, autoscaling behavior, fallback rate, and cost per request.

A release gate for `fresh-rank-api` can look like this:

```yaml
release_gate:
  model_version: "2026-07-03.4"
  api_contract:
    max_candidates: 80
    response_schema_checked: true
    fallback_checked: true
  load_test:
    target_rps: 900
    p95_latency_ms: 172
    p99_latency_ms: 318
    error_rate: 0.002
    fallback_rate: 0.004
  autoscaling:
    min_replicas: 6
    max_replicas: 40
    peak_replicas_observed: 31
    queue_depth_peak: 22
  cost:
    cost_per_million_requests_usd: 1.07
    target_cost_per_million_requests_usd: 1.25
  decision:
    status: approved_for_25_percent_canary
    rollback_trigger: "p99 > 350ms for 10 minutes or fallback_rate > 2%"
```

![LumaShelf production review packet with load test, telemetry, and CPU serving cost](/content-assets/articles/article-mlops-model-serving-latency-throughput-autoscaling-cost/production-review-packet-cost.png)

*The release packet puts load-test evidence, live telemetry, and CPU serving cost in one view so the canary decision has performance and cost evidence together.*

Alerts should point to the first useful action. A p99 alert without queue, CPU, fallback, and version context sends people hunting. A better alert message includes the route, model version, p95, p99, queue depth, current replicas, and recent deployment. The on-call engineer can then choose a first move:

| Symptom | First checks | Common response |
|---|---|---|
| p99 high, queue depth high, CPU high | Pod count, HPA events, node capacity | Raise max replicas, add nodes, reduce traffic, enable fallback |
| p99 high, queue depth high, CPU normal | Feature-store latency, worker lock, downstream timeout | Shift to fallback, fix dependency, lower queue wait |
| Error rate high after canary | Compare by `model_version`, inspect traces | Roll back canary or disable new route |
| Fallback rate high with stable latency | Overload policy, caller timeout, feature dependency | Tune timeout, investigate fallback trigger |
| Cost per request high with healthy latency | Replica floor, low traffic windows, runtime CPU use | Lower off-peak floor, optimize model, change node shape |

Rollback should be boring and rehearsed. If the new model version causes p99 to cross the rollback trigger, the team shifts traffic back to the previous version through the deployment controller, feature flag, or gateway route. The rollback note should include the model version, start time, end time, traffic percentage, reason, and links to dashboards. After the rollback, the team keeps the incident window for analysis because the failed canary may reveal a capacity problem that the old model avoided by being smaller.

The final production check is cost drift. A scaling policy can pass during launch week and then waste money after traffic patterns change. A weekly serving review should compare request volume, p95, p99, peak replicas, idle replicas, fallback rate, and cost per million requests. If cost rises while latency stays flat and traffic falls, the team should inspect replica floors, telemetry cardinality, and model runtime efficiency.

## Putting It Together
<!-- section-summary: Healthy inference serving connects API shape, percentiles, throughput, queues, autoscaling, telemetry, load tests, and cost into one operating loop. -->

Inference cost and scale is one connected operating loop. The API contract defines the request shape and fallback. Latency percentiles show the user-facing distribution. Throughput and concurrency estimate how much capacity the fleet needs. Queue depth warns the team before overload turns into timeouts. HPA and KEDA turn CPU, request rate, or queue signals into replica changes. Load tests check the plan before users depend on it. Prometheus and OpenTelemetry explain fleet behavior and single slow requests. Cost per request turns the serving design into a number the product and finance teams can discuss.

For the LumaShelf recommendation API, the practical path was clear. The team set p95 and p99 targets, measured a safe per-pod concurrency, bounded the queue, started with HPA, moved to KEDA when queue depth gave a better signal, tested the lunch peak with k6, watched Prometheus histograms and OpenTelemetry traces, and calculated cost per million successful requests. Every step answered the same production question: can this model help the product without making the page slow or the serving bill surprising?

That is the habit to carry into any model API. A good serving review starts with the user request, measures the tail, sizes the fleet from throughput and latency, keeps queues short, scales from the signal that fails first, tests before launch, watches the live system with metrics and traces, and counts the money per successful prediction.

## References

- [Kubernetes: Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/)
- [KEDA: Scaling Deployments, StatefulSets and Custom Resources](https://keda.sh/docs/2.20/concepts/scaling-deployments/)
- [KEDA: ScaledObject specification](https://keda.sh/docs/2.20/reference/scaledobject-spec/)
- [KEDA: Prometheus scaler](https://keda.sh/docs/2.20/scalers/prometheus/)
- [Prometheus: Histograms and summaries](https://prometheus.io/docs/practices/histograms/)
- [OpenTelemetry: Semantic conventions for HTTP metrics](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/)
- [OpenTelemetry: Metrics data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/)
- [Grafana k6: Thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
