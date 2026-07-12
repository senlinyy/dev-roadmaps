---
title: "Choosing Serving Patterns"
description: "Connect latency, freshness, cost, and product requirements."
overview: "Choosing a serving pattern means deciding where predictions run, how fresh they must be, how fast the product needs an answer, and which operational system owns the endpoint, queue, job, or stream."
tags: ["MLOps", "core", "inference"]
order: 3
id: "article-mlops-model-serving-choosing-serving-pattern"
---

## Table of Contents

1. [What a Serving Pattern Decides](#what-a-serving-pattern-decides)
2. [The Concepts You Will Connect](#the-concepts-you-will-connect)
3. [Online Request-Response Serving](#online-request-response-serving)
4. [Batch Scoring](#batch-scoring)
5. [Streaming and Event-Driven Inference](#streaming-and-event-driven-inference)
6. [Asynchronous Queue-Based Serving](#asynchronous-queue-based-serving)
7. [Framework Choices in Production](#framework-choices-in-production)
8. [Serving-Pattern Decision Matrix](#serving-pattern-decision-matrix)
9. [Operational Checks Before You Commit](#operational-checks-before-you-commit)
10. [Runbook: The Pattern Is Causing Trouble](#runbook-the-pattern-is-causing-trouble)
11. [Putting It Together](#putting-it-together)
12. [References](#references)

## What a Serving Pattern Decides
<!-- section-summary: A serving pattern is the production shape of prediction: request path, freshness, runtime, cost, and failure behavior. -->

Choosing a serving pattern means deciding **how your product asks a model for predictions in production**. The pattern covers the request path, the freshness of the features, the latency target, the runtime that loads the model, the scaling mechanism, and the fallback your product uses when prediction fails.

Think about a marketplace called StyleLoop. It sells second-hand clothing and runs three models. A **search ranking model** orders products while a shopper types. A **daily demand model** scores which items will likely sell this week. A **listing moderation model** reviews uploaded images and text before the listing goes live. Each model produces a prediction, yet each one needs a different production shape.

The search model needs an answer during a live user request, so it fits online serving. The demand model can score millions of rows overnight, so it fits batch scoring. The moderation model can wait a few seconds after upload, so it fits an asynchronous queue. If StyleLoop forces every model through one endpoint shape, the system either spends too much money, misses freshness needs, or adds latency to product flows that do not need it.

The useful question is practical: **who needs the prediction, how soon do they need it, and what happens if the model cannot answer?** Once you answer that question, the serving pattern starts to show itself.

![StyleLoop serving pattern choices](/content-assets/articles/article-mlops-model-serving-choosing-serving-pattern/styleloop-serving-pattern-choices.png)
*StyleLoop picks the serving pattern from the product promise: live search needs an online endpoint, demand planning fits a batch job, and moderation can move through an asynchronous queue.*

## The Concepts You Will Connect
<!-- section-summary: The decision uses a few repeatable concepts: latency, freshness, throughput, ownership, runtime, scaling, and fallback. -->

Before you choose a pattern, it helps to name the pieces you are balancing. These words show up in every serving design review, so let us connect them to the StyleLoop example before looking at tools.

| Concept | Plain-English meaning | StyleLoop example |
|---|---|---|
| **Latency** | How long the user or downstream system waits for one prediction. | Search ranking needs a response in the request path, usually inside a few hundred milliseconds. |
| **Freshness** | How current the input data and prediction result must be. | Search ranking needs current inventory and user context. Weekly demand can use last night's data. |
| **Throughput** | How many predictions the system handles per second, minute, or batch. | Search has traffic spikes. Demand scoring processes the full catalog on a schedule. |
| **Trigger** | The event that starts prediction. | A web request, a scheduled job, a Kafka event, or an upload queue message. |
| **Runtime** | The service or job that loads the model and runs inference. | FastAPI, BentoML, KServe, Ray Serve, Spark, or a workflow job. |
| **Fallback** | The safe answer when prediction is unavailable or too slow. | Search can use a rules-based ranker. Moderation can send a listing to manual review. |
| **Owner** | The team that operates the serving path. | Platform owns KServe, search owns ranking logic, data engineering owns batch jobs. |

These concepts connect because serving is a product promise, not just a deployment choice. If the promise is "the shopper sees ranked products now," the model has to live close to the request path. If the promise is "merchandising sees a refreshed forecast every morning," a scheduled batch table is a cleaner shape. If the promise is "the seller receives a moderation result soon," a queue gives the product a good waiting room.

## Online Request-Response Serving
<!-- section-summary: Online serving runs a model during a live request, so the design starts with latency, validation, and fallback. -->

**Online serving** means the application sends a request to a model service and waits for the response before finishing the user workflow. A checkout fraud check, search ranker, delivery ETA, support-ticket router, or real-time personalization endpoint often uses this pattern.

For StyleLoop, the search page calls a ranking endpoint after the search service retrieves candidate products. The endpoint receives the shopper context, product candidates, and features such as price, category, seller quality, and inventory status. It returns the same products with scores and reason fields the product team can log.

The simplest custom shape often starts with FastAPI because the team can define a clear HTTP contract, validate inputs with Python types, load the model during application startup, and expose health checks for Kubernetes or another platform. FastAPI's lifespan events fit model loading because startup code can load the model before the app accepts requests and shutdown code can release memory or GPU resources.

```python
from contextlib import asynccontextmanager
from typing import Annotated

import joblib
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

model_state = {}


class ProductCandidate(BaseModel):
    product_id: str
    price_cents: int = Field(ge=0)
    seller_rating: float = Field(ge=0, le=5)
    in_stock: bool


class RankRequest(BaseModel):
    shopper_id: str
    query: str
    candidates: list[ProductCandidate]


class RankedProduct(BaseModel):
    product_id: str
    score: float
    model_version: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    model_state["ranker"] = joblib.load("/models/search-ranker.joblib")
    model_state["version"] = "search-ranker-2026-07-01"
    yield
    model_state.clear()


app = FastAPI(lifespan=lifespan)


@app.post("/v1/rank", response_model=list[RankedProduct])
def rank_products(
    request: RankRequest,
    request_id: Annotated[str | None, Header(alias="X-Request-ID")] = None,
):
    if len(request.candidates) > 200:
        raise HTTPException(status_code=413, detail="too many candidates")

    rows = [
        [item.price_cents, item.seller_rating, int(item.in_stock)]
        for item in request.candidates
    ]
    scores = model_state["ranker"].predict_proba(rows)[:, 1]

    return [
        RankedProduct(
            product_id=item.product_id,
            score=float(score),
            model_version=model_state["version"],
        )
        for item, score in zip(request.candidates, scores, strict=True)
    ]
```

The important part is the contract around the model. The request has a maximum candidate count because one user request should not send a huge batch through the live endpoint. The response includes `model_version` so logs can connect product behavior to the deployed artifact. The code reads `X-Request-ID` because the serving team will need to connect application logs, traces, model logs, and product events during an incident.

Online serving asks the strongest operational questions. What is the 95th percentile latency? How many requests can one replica handle? Which fields are required? Which fallback keeps the page working? The search page can fall back to a simple ranker based on text relevance and seller quality. That fallback may rank less accurately, but the shopper still receives a search result instead of a broken page.

## Batch Scoring
<!-- section-summary: Batch scoring runs predictions for many records on a schedule or data event, then stores results for later use. -->

**Batch scoring** means the system predicts for many records at once and writes the results somewhere another workflow can read them later. The trigger can be a schedule, a completed data pipeline, a model promotion event, or a backfill request. The user usually waits for the data product, not for each individual prediction.

StyleLoop's demand model is a good batch example. Merchandising wants a table every morning that estimates which listings will sell in the next seven days. The input table has product metadata, price history, search impressions, seasonality features, and seller history. The output table powers dashboards, discount recommendations, and inventory operations. Nobody needs this result inside a live web request.

The batch shape usually has four pieces:

| Piece | What it does | Example |
|---|---|---|
| Input snapshot | Freezes the records and features used for scoring. | `warehouse.features.product_demand_snapshot_2026_07_05` |
| Scoring job | Loads the model and scores all records. | Spark, Ray batch job, Kubernetes Job, Airflow task, or warehouse UDF path |
| Output table | Stores predictions with versions and timestamps. | `warehouse.predictions.product_demand_daily` |
| Quality checks | Verifies row counts, nulls, score ranges, and freshness. | dbt tests, SQL checks, or orchestration gates |

The practical value is control. A batch job can process one million products with a clear input snapshot and output table. If the job fails, the product can keep using yesterday's predictions for a while. If the model team needs to replay last Friday, the input snapshot and model version give them a route back to the same scoring packet.

Batch scoring has its own failure mode. The prediction might be too stale for a live decision. If a product sells out at noon and the demand score refreshes tomorrow, the page should avoid using that score as the final availability answer. Batch results are strongest when the product can tolerate scheduled freshness.

## Streaming and Event-Driven Inference
<!-- section-summary: Streaming inference runs predictions as events arrive, which fits near-real-time workflows that do not sit inside a user request. -->

**Streaming inference** means new events trigger predictions continuously. The model consumes events from a stream or message system, enriches them with features, writes predictions to another stream or store, and lets downstream consumers react. This pattern fits near-real-time systems where seconds matter, while the prediction can happen outside the user's direct request.

StyleLoop can use this for seller risk signals. Every listing upload, seller profile change, payment dispute, and buyer complaint lands as an event. A streaming job scores seller risk as those events arrive and writes the latest risk state to an online store. The listing upload service can then read the latest risk state during moderation instead of recomputing the full seller history in the request.

Streaming inference has a different design center from online serving. The key metrics are event lag, processing time, retry counts, and output freshness. A single event can arrive late or out of order, so the code needs a timestamp policy. If the stream stalls, downstream systems may use older risk scores, so the prediction record needs `feature_time`, `scored_at`, and `model_version`.

An event-driven scoring record might look like this:

```json
{
  "seller_id": "seller_8842",
  "feature_time": "2026-07-05T12:01:00Z",
  "scored_at": "2026-07-05T12:01:03Z",
  "model_version": "seller-risk-2026-06-28",
  "risk_score": 0.82,
  "risk_band": "review"
}
```

This record gives the moderation service a current answer without turning the moderation request into a large feature computation. The serving pattern moves the work earlier, close to the events that change the score. The product tradeoff is also clear: the request reads a prepared score, and the streaming system owns freshness.

## Asynchronous Queue-Based Serving
<!-- section-summary: Queue-based serving accepts work quickly, processes predictions in workers, and returns the result through status polling or callbacks. -->

**Asynchronous serving** means the product accepts a request, places prediction work on a queue, and lets workers process it outside the immediate user response. The user or downstream service receives a status page, webhook, callback, notification, or updated database row later.

StyleLoop's listing moderation model fits this pattern. A seller uploads photos and a description. The product does not need to block the upload request while an image model, text model, and policy checks run. The upload service can store the listing as `pending_review`, enqueue a moderation job, and show the seller a clear status.

The queue gives the system a buffer. If 20,000 sellers upload listings after a campaign email, workers can scale up while the product still accepts uploads. If the model service has a problem, the queue holds work and the moderation team can switch a subset to manual review. The service needs idempotency because retries happen. Idempotency means processing the same job twice produces one final moderation result instead of duplicate side effects.

A practical moderation job payload should carry the fields needed for traceability:

```json
{
  "job_id": "modjob_20260705_000381",
  "listing_id": "listing_77121",
  "seller_id": "seller_8842",
  "image_uris": [
    "s3://styleloop-listing-images/listing_77121/front.jpg"
  ],
  "description_uri": "s3://styleloop-listings/listing_77121/description.txt",
  "model_versions": {
    "image": "listing-image-policy-2026-06-30",
    "text": "listing-text-policy-2026-06-22"
  },
  "submitted_at": "2026-07-05T12:01:00Z"
}
```

The queue pattern changes the product conversation. Instead of promising "the model responds inside the upload request," the product promises "the listing moves through review with a visible status and a clear maximum wait." That promise can be easier to operate because the queue absorbs spikes and workers can use batching where it helps.

## Framework Choices in Production
<!-- section-summary: Frameworks shape packaging, scaling, routing, and operations, so the tool should match the serving pattern. -->

Once the pattern is clear, the serving framework choice gets simpler. The framework should support the request shape, packaging style, scaling behavior, and team ownership you need. A small FastAPI service can be perfect for one validated HTTP endpoint. A platform team may prefer KServe because it gives model teams a Kubernetes-native `InferenceService`. A Python-heavy team may choose BentoML for service packaging and deployment. A team composing multiple Python deployments or scaling model pipelines may choose Ray Serve.

![StyleLoop framework fit after the pattern](/content-assets/articles/article-mlops-model-serving-choosing-serving-pattern/styleloop-framework-fit.png)
*The framework choice comes after the pattern decision: each tool helps with a different mix of HTTP contracts, Kubernetes rollout controls, packaging, and traffic-aware scaling.*

Here is a small KServe `InferenceService` shape for a Kubernetes-native online endpoint. KServe uses custom resources to hide some of the lower-level Kubernetes objects and supports serving runtimes for model formats such as scikit-learn, XGBoost, LightGBM, MLflow, TensorFlow, PyTorch, ONNX, and others through included or custom runtimes.

```yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: styleloop-search-ranker
  namespace: ml-serving
spec:
  predictor:
    minReplicas: 2
    maxReplicas: 20
    model:
      modelFormat:
        name: sklearn
      storageUri: s3://styleloop-models/search-ranker/2026-07-01/
      resources:
        requests:
          cpu: "1"
          memory: 2Gi
        limits:
          cpu: "2"
          memory: 4Gi
```

The `storageUri` points at the model artifact, and the `modelFormat` tells KServe which serving runtime can load it. The replica bounds turn the product requirement into an operations boundary: the platform keeps at least two replicas warm and caps the endpoint at twenty replicas unless a human changes the review.

BentoML puts the service definition close to Python model code. That can work well when the model team owns preprocessing, prediction, and response shaping in one package.

```python
import bentoml
from pydantic import BaseModel


class RankRequest(BaseModel):
    shopper_id: str
    query: str
    product_ids: list[str]


@bentoml.service(
    traffic={
        "concurrency": 32,
    }
)
class ProductRanker:
    model = bentoml.models.get("styleloop_search_ranker:latest")

    @bentoml.api
    def rank(self, request: RankRequest) -> list[dict[str, float | str]]:
        scores = self.model.predict(request.product_ids)
        return [
            {"product_id": product_id, "score": float(score)}
            for product_id, score in zip(request.product_ids, scores, strict=True)
        ]
```

The `concurrency` value tells BentoML how many simultaneous requests this service is designed to handle per replica in BentoCloud autoscaling. The right value comes from load tests, not a guess. A CPU-bound model and an I/O-heavy model will have different safe concurrency limits.

Ray Serve fits Python serving systems that need multiple deployments, composition, or traffic-aware autoscaling. A ranking system might call a feature fetcher deployment and a ranker deployment inside one Serve application. Ray Serve's production config file lets the team update deployment settings such as autoscaling without rebuilding the application code.

```yaml
applications:
  - name: styleloop-ranking
    route_prefix: /rank
    import_path: ranker.app:app
    deployments:
      - name: Ranker
        num_replicas: auto
        max_ongoing_requests: 8
        autoscaling_config:
          target_ongoing_requests: 4
          min_replicas: 2
          max_replicas: 20
```

This config treats queue pressure inside each replica as the scaling signal. If the deployment receives more ongoing requests than the target, Ray Serve can add replicas up to the limit. That makes the serving framework part of the performance design, not just a packaging wrapper.

## Serving-Pattern Decision Matrix
<!-- section-summary: The matrix turns product requirements into a first serving choice and records the reason behind the choice. -->

A decision matrix keeps the review honest. It prevents the team from choosing the newest platform feature when the product only needs a scheduled table. It also records the tradeoff for future maintainers who wonder why the model landed in a queue instead of a live endpoint.

| Product need | Best first pattern | Good fit | Watch carefully |
|---|---|---|---|
| User waits for an answer during a page, checkout, API call, or workflow | Online request-response | Search ranking, fraud check, ETA, support routing | 95th percentile latency, input validation, timeouts, fallback |
| Many records need predictions on a schedule | Batch scoring | Demand forecasts, churn lists, price recommendations, backfills | Data snapshot, output freshness, row counts, replay path |
| Events change the score continuously | Streaming inference | Risk state, device telemetry, real-time personalization state | Event lag, late events, duplicate events, state store freshness |
| Work can finish after the user receives a status | Asynchronous queue | Listing moderation, document classification, image review | Queue depth, retry policy, idempotency, user status copy |
| Multiple models compose inside one Python service | Ray Serve or similar serving graph | Feature fetcher plus ranker, router plus specialist models | Per-deployment autoscaling, tracing across deployments |
| Kubernetes platform should own common model serving behavior | KServe | Standardized model endpoint, canary rollout, shared runtimes | Runtime support, artifact access, networking, scale-to-zero mode choices |
| Python package should ship service logic with the model | BentoML | Custom inference API, model-specific preprocessing, BentoCloud deployment | Concurrency value, packaging dependencies, load-test evidence |
| Result can be safely reused for repeated inputs | Cache in front of online serving | Stable recommendations, category scores, expensive deterministic predictions | Cache key, TTL, invalidation, privacy, model version |

The first column describes the user or system requirement. The second column gives the serving pattern to try first. The last column names the thing that usually breaks. That last column matters because every serving choice creates an operations checklist.

## Operational Checks Before You Commit
<!-- section-summary: A serving pattern is ready only after the team proves latency, freshness, scale, fallback, observability, and rollout behavior. -->

Before a team commits to a pattern, it should run a small design review with concrete evidence. The review should include the product owner, model owner, service owner, and on-call owner because each person owns a different failure path.

| Check | Evidence to bring | Example acceptance bar |
|---|---|---|
| Latency | Load-test report with 50th, 95th, and 99th percentile latency | Search ranker 95th percentile under 180 ms at peak traffic |
| Freshness | Feature timestamp and prediction timestamp in logs or output table | Online features less than 5 minutes old for live ranking |
| Throughput | Requests per second, batch rows per hour, or queue jobs per minute | Batch demand job scores 5 million products in 45 minutes |
| Fallback | Product behavior when prediction fails, times out, or returns invalid output | Search uses text relevance ranker after 150 ms timeout |
| Observability | Metrics, logs, traces, and model version fields | Every prediction log includes `request_id`, `model_version`, and `feature_time` |
| Rollout | Canary, shadow, or batch comparison plan | KServe canary starts at 10 percent traffic with rollback criteria |
| Cost | Expected replica count, job runtime, or stream worker count | Peak online serving stays under the approved monthly compute budget |

KServe canary rollout is useful when a Kubernetes-native endpoint needs a controlled release. A small traffic percentage goes to the new revision while the last good revision keeps most traffic. The team then promotes the new revision or rolls back based on latency, errors, and model quality signals.

```yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: styleloop-search-ranker
  namespace: ml-serving
spec:
  predictor:
    canaryTrafficPercent: 10
    model:
      modelFormat:
        name: sklearn
      storageUri: s3://styleloop-models/search-ranker/2026-07-05/
```

The canary percentage is the product risk dial. Ten percent can be too high for a high-risk decision and too low to measure a rare failure quickly. The team should choose it from traffic volume, blast radius, and how fast monitoring can detect a bad result.

![StyleLoop serving-pattern review before launch](/content-assets/articles/article-mlops-model-serving-choosing-serving-pattern/styleloop-serving-pattern-review.png)
*A pattern review is ready when the team can prove latency, freshness, scale, fallback, observability, and rollback before the first real launch.*

## Runbook: The Pattern Is Causing Trouble
<!-- section-summary: A serving-pattern incident runbook starts by naming the failing promise, then isolates latency, freshness, queue, runtime, and rollout issues. -->

Serving incidents often sound vague at first. Someone says "the model is slow," "the predictions are old," or "the queue is backed up." The runbook should turn that into a specific broken promise.

| Symptom | First checks | Likely action |
|---|---|---|
| Online endpoint latency crosses the product budget | Check 95th percentile latency, replica count, CPU or GPU saturation, request payload size, downstream feature-store latency | Enable fallback, reduce max candidates, scale replicas, roll back new model, or move heavy work out of the request |
| Batch predictions are missing or late | Check orchestration status, input row count, model artifact path, output table partition, warehouse or cluster quota | Re-run from last good snapshot, keep yesterday's predictions, page data pipeline owner |
| Streaming predictions are stale | Check event lag, consumer errors, state-store write failures, late-event rate | Pause dependent rollout, increase workers, replay from checkpoint, expose freshness warning |
| Queue-based moderation waits too long | Check queue depth, worker count, retry storm, poison messages, model service errors | Scale workers, move poison messages to dead-letter queue, route high-risk jobs to manual review |
| Canary performs worse than baseline | Compare latency, error rate, prediction distribution, business guardrail metrics by model version | Set canary traffic back to zero, keep last good revision, open model-quality incident |

The runbook should include ownership. The product owner decides whether fallback is acceptable for users. The platform owner changes replica limits and ingress behavior. The model owner investigates prediction distributions and feature changes. The data owner checks freshness and training-serving skew. Without clear ownership, the team can spend the first thirty minutes deciding who is allowed to act.

## Putting It Together
<!-- section-summary: The right serving pattern follows the product promise, then the tooling and operations plan support that promise. -->

Choosing a serving pattern starts with the product promise. If the user needs the answer inside a request, use an online endpoint and design for latency, validation, fallback, and rollout. If the business needs many predictions on a schedule, use batch scoring and design for snapshots, output checks, and replay. If events should update a score continuously, use streaming inference and design for lag and state freshness. If work can happen after the request, use a queue and design for retries, idempotency, and status.

Frameworks help after that decision. FastAPI gives a clear custom HTTP service. KServe gives a Kubernetes-native model-serving API with runtimes, autoscaling, and rollout features. BentoML keeps Python service logic close to the model package and adds concurrency controls for deployment. Ray Serve supports Python serving applications with multiple deployments and traffic-aware autoscaling. The tool is useful when it supports the pattern and the team can operate it under pressure.

## References

- [KServe: Deploy Your First Predictive Inference Service](https://kserve.github.io/website/docs/getting-started/predictive-first-isvc)
- [KServe: ServingRuntime](https://kserve.github.io/website/docs/concepts/resources/servingruntime)
- [KServe: Canary Rollout Strategy](https://kserve.github.io/website/docs/model-serving/predictive-inference/rollout-strategies/canary)
- [BentoML: Create online API Services](https://docs.bentoml.com/en/latest/build-with-bentoml/services.html)
- [BentoML: Concurrency and autoscaling](https://docs.bentoml.com/en/latest/scale-with-bentocloud/scaling/autoscaling.html)
- [Ray Serve: Serve Config Files](https://docs.ray.io/en/latest/serve/production-guide/config.html)
- [Ray Serve: Autoscaling](https://docs.ray.io/en/latest/serve/autoscaling-guide.html)
- [FastAPI: Lifespan Events](https://fastapi.tiangolo.com/advanced/events/)
