---
title: "Batch vs Online Inference"
description: "Compare batch inference jobs and online inference APIs through latency, freshness, cost, ownership, and failure recovery."
overview: "Batch inference scores many records on a schedule, while online inference scores one live request at a time. This guide follows a grocery delivery team that uses both patterns: a nightly substitution-risk job for operations and a checkout ETA API for customers."
tags: ["MLOps", "core", "inference"]
order: 1
id: "article-mlops-model-serving-batch-vs-online-inference"
---

## Table of Contents

1. [Why Serving Pattern Choice Matters](#why-serving-pattern-choice-matters)
2. [Batch Inference](#batch-inference)
3. [Online Inference](#online-inference)
4. [The Same Model Can Need Two Serving Paths](#the-same-model-can-need-two-serving-paths)
5. [A Practical Batch Job](#a-practical-batch-job)
6. [A Practical Online API](#a-practical-online-api)
7. [Operations, Checks, and Recovery](#operations-checks-and-recovery)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Why Serving Pattern Choice Matters
<!-- section-summary: Batch inference scores records ahead of time, while online inference scores a live request during the user workflow. -->

**Batch inference** means you run a model over many records at once, usually on a schedule or after a data pipeline finishes. **Online inference** means an application calls the model during a live user request and waits for the prediction before it continues. That is the basic answer to the title: batch serves a prepared list of predictions, and online serves a prediction right now.

Imagine a grocery delivery company called FreshCart. Every night, FreshCart wants to predict which products may need substitutions tomorrow because suppliers may miss deliveries. The operations team can wait for that job to finish before morning. That work fits batch inference. During checkout, the same company wants to show a delivery ETA while the customer is still choosing a slot. The app needs an answer in a few hundred milliseconds. That work fits online inference.

The pattern choice changes the whole production shape. Batch jobs care about input tables, schedules, retries, output partitions, and data quality before the next business process starts. Online APIs care about request validation, latency budgets, timeouts, autoscaling, and safe fallback responses. Both call a model, yet they create different operational promises.

Here is the map for this article:

| Concept | Plain meaning | FreshCart example |
|---|---|---|
| **Prediction unit** | The thing the model scores | One product-store-day row or one checkout request |
| **Freshness** | How recent the input and output must be | Tomorrow morning is fine for substitutions; checkout needs live traffic and store load |
| **Latency budget** | How long the caller can wait | Minutes for a nightly job; milliseconds for checkout |
| **Failure mode** | What happens when serving breaks | Operations can rerun the job; checkout needs a fallback ETA |
| **Cost shape** | Where spend concentrates | Batch workers for a window; online replicas all day |

![FreshCart serving pattern choice](/content-assets/articles/article-mlops-model-serving-batch-vs-online-inference/freshcart-serving-pattern-choice.png)
*FreshCart chooses serving style by asking who is waiting: operations can wait for tomorrow's substitution plan, while checkout needs a live ETA.*

The rest of the article follows those ideas through real code and runbooks. We will use batch first because it is usually the easier serving pattern to reason about, then move into online serving where every customer request adds pressure.

## Batch Inference
<!-- section-summary: Batch inference scores a known set of records and writes predictions for later use. -->

Batch inference is useful when the business already knows which records need predictions. FreshCart has a table of product-store pairs for tomorrow. Each row says, "For this store and this product, estimate the chance that a picker will need to substitute the item." The model can score ten thousand rows in one job, write the results to a table, and let operations planners use those results in the morning.

This pattern gives the team breathing room. The job can read from the warehouse, load a model artifact, process records in chunks, and write a new partition such as `prediction_date=2026-07-06`. If one partition fails, the data team can rerun the job for that date. Nobody is waiting inside a checkout flow while the model runs.

The input contract matters more than the endpoint contract in batch inference. A contract is the shape both sides agree on. For this job, the contract might be a table with these fields:

| Field | Type | Why the model needs it |
|---|---|---|
| `prediction_date` | `DATE` | The business day being planned |
| `store_id` | `STRING` | The store that will fulfill the order |
| `sku` | `STRING` | The product being stocked |
| `on_hand_units` | `INTEGER` | Current inventory signal |
| `expected_orders` | `INTEGER` | Demand forecast for the day |
| `supplier_delay_hours` | `FLOAT` | Recent supplier reliability signal |
| `last_substitution_rate` | `FLOAT` | Recent customer-facing substitution behavior |

The output table should also have a clear contract:

| Field | Type | Why reviewers need it |
|---|---|---|
| `prediction_date` | `DATE` | Partition and rerun boundary |
| `store_id` | `STRING` | Store-level action |
| `sku` | `STRING` | Product-level action |
| `model_version` | `STRING` | Which model produced the row |
| `substitution_risk` | `FLOAT` | Main score |
| `risk_band` | `STRING` | Human-friendly action bucket |
| `scored_at` | `TIMESTAMP` | When the row came from the model |

Notice the operational fields. `model_version` and `scored_at` help the team explain a plan later. If a store manager asks why a product received a high-risk flag, the team can trace the row back to a specific model and run time. Batch inference often feeds humans, reports, and downstream systems, so traceability belongs in the output.

## Online Inference
<!-- section-summary: Online inference serves one live request at a time, so latency, validation, and fallback behavior sit near the model. -->

Online inference handles a different kind of promise. A customer chooses a delivery slot and FreshCart needs to predict the ETA before the checkout page responds. The app sends one request to a model API with the cart size, store load, driver availability, customer address region, and current weather band. The API returns one prediction, and the product workflow uses it immediately.

The model still matters, but the surrounding service matters just as much. A bad input should return a clear validation error. A slow model call should hit a timeout before the checkout page hangs. A failed model service should return a conservative fallback ETA, because showing no delivery estimate blocks the customer.

FastAPI and Pydantic are a common Python pairing for this shape. FastAPI uses Pydantic models to define and validate request bodies. Pydantic gives you typed models, validation, and serialization helpers such as `model_validate()` and `model_dump()`. In production terms, this means the serving team can make the request contract visible in code instead of accepting random JSON and hoping the model can handle it.

Here is a small online request contract:

```python
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()


class EtaRequest(BaseModel):
    request_id: str = Field(min_length=12)
    store_id: str
    delivery_zone: str
    cart_items: int = Field(ge=1, le=150)
    active_pickers: int = Field(ge=0)
    open_orders: int = Field(ge=0)
    weather_band: Literal["clear", "rain", "storm"]


class EtaResponse(BaseModel):
    request_id: str
    eta_minutes: int
    model_version: str
    fallback_used: bool


@app.post("/predict/eta", response_model=EtaResponse)
def predict_eta(payload: EtaRequest) -> EtaResponse:
    features = payload.model_dump()
    eta_minutes = score_eta(features)
    return EtaResponse(
        request_id=payload.request_id,
        eta_minutes=eta_minutes,
        model_version="eta-xgb-2026-07-04",
        fallback_used=False,
    )
```

The important part is the boundary around the model. `EtaRequest` blocks impossible values like `cart_items=0` or `cart_items=5000`. The response includes `model_version` so logs and user-impact reviews can connect a prediction to the released artifact. The endpoint still needs timeouts, metrics, and fallback logic around this simple code, but the contract starts here.

## The Same Model Can Need Two Serving Paths
<!-- section-summary: Serving style follows the product timing, so one model family may produce both prepared predictions and live predictions. -->

FreshCart may train one feature pipeline and several related models for store operations. The substitution-risk model scores tomorrow's product plan in batch. The ETA model scores checkout requests online. The features overlap: store load, demand, inventory, weather, and supplier delay. The serving path changes because the caller changes.

This is where teams sometimes make expensive mistakes. They take a batch problem and build a live API because APIs feel more "production." Then they pay for replicas all day even though the business reads predictions once each morning. Or they take an online problem and run a batch job every hour, then the product team complains that customers see stale ETAs when a store suddenly gets busy.

A useful review question is: **who waits for the answer?** If a human planner, report, or downstream job can wait, batch may fit. If a customer, fraud rule, support workflow, or mobile app is blocked by the answer, online serving may fit. The next question is **how fresh the answer must be**. If yesterday's warehouse features are enough, batch is attractive. If the prediction needs current queue depth or the latest request fields, online serving has a stronger case.

Here is a compact decision view:

| Question | Batch answer | Online answer |
|---|---|---|
| Who waits? | A scheduled workflow or analyst | A live user or service |
| How many rows arrive together? | Many known rows | One request or a small request group |
| Where is the output stored? | Warehouse table, object storage, feature store, cache | API response and request log |
| How do you retry? | Rerun the partition or failed shard | Retry carefully, then fallback fast |
| What do you monitor? | Job success, row counts, freshness, output distribution | Latency, error rate, saturation, fallback rate |

This table is practical because it pushes the team toward an operating model. The serving pattern is not only an architecture diagram. It decides what wakes someone up at night.

## A Practical Batch Job
<!-- section-summary: A production batch job has a schedule, input validation, bounded retries, partitioned output, and a rerun path. -->

FreshCart can run the substitution model as a Kubernetes CronJob. A CronJob creates Jobs on a repeating schedule, which fits regular scoring work such as nightly planning. The job container can read one date of input rows, load the approved model version, score the rows, and write one output partition.

Here is a stripped-down manifest:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: substitution-risk-nightly
spec:
  schedule: "30 2 * * *"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 1800
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: scorer
              image: registry.example.com/ml/substitution-risk:2026-07-04
              args:
                - "--prediction-date=$(PREDICTION_DATE)"
                - "--model-version=sub-risk-lgbm-2026-07-04"
                - "--input=warehouse.freshcart.substitution_features"
                - "--output=warehouse.freshcart.substitution_predictions"
              env:
                - name: PREDICTION_DATE
                  valueFrom:
                    fieldRef:
                      fieldPath: metadata.annotations['batch.devpolaris.io/prediction-date']
              resources:
                requests:
                  cpu: "2"
                  memory: "4Gi"
                limits:
                  cpu: "4"
                  memory: "8Gi"
```

Several fields are worth reviewing. `concurrencyPolicy: Forbid` avoids two nightly runs writing the same partition at the same time. `startingDeadlineSeconds` gives the scheduler a bounded window if the cluster has a temporary issue. `backoffLimit` limits retries so a broken model image does not loop forever. The image tag and `--model-version` give reviewers a concrete artifact to inspect.

The scoring code should validate the input before it scores. A simple batch guard can catch a broken upstream pipeline:

```sql
SELECT
  prediction_date,
  COUNT(*) AS rows_to_score,
  COUNTIF(store_id IS NULL OR sku IS NULL) AS missing_keys,
  COUNTIF(on_hand_units < 0) AS negative_inventory,
  COUNTIF(expected_orders < 0) AS negative_demand
FROM warehouse.freshcart.substitution_features
WHERE prediction_date = DATE '2026-07-06'
GROUP BY prediction_date;
```

The job should fail before writing predictions if keys are missing or counts look impossible. That failure gives the data team a clean rerun path: fix the upstream partition, delete the partial output if any exists, and rerun the job for the same `prediction_date` and model version.

![FreshCart nightly batch inference job](/content-assets/articles/article-mlops-model-serving-batch-vs-online-inference/nightly-batch-inference-job.png)
*The batch path is table-shaped: validate one input partition, score rows, write one output partition, and give operations a rerunnable plan.*

## A Practical Online API
<!-- section-summary: A production online API wraps the model with validation, health checks, metrics, timeouts, and a fallback answer. -->

The checkout ETA service has a sharper timing promise. FreshCart might set a service-level objective such as "99% of ETA requests finish under 250 ms over five-minute windows." A service-level objective, or SLO, is a measurable reliability target that the team agrees to operate against. The exact number depends on the product, but the idea is simple: the model endpoint gets a time budget because the user is waiting.

The endpoint needs a few behaviors around the model:

| Behavior | Why it exists |
|---|---|
| Request validation | Block impossible inputs before they hit the model |
| Timeout | Protect checkout from slow dependencies |
| Fallback | Return a conservative ETA if the model cannot answer |
| Metrics | Show latency, error rate, fallback rate, and request volume |
| Trace fields | Connect a checkout request to model logs and release evidence |

The application code can make fallback explicit:

```python
from concurrent.futures import ThreadPoolExecutor, TimeoutError

MODEL_TIMEOUT_SECONDS = 0.15
executor = ThreadPoolExecutor(max_workers=8)


def conservative_eta(payload: EtaRequest) -> int:
    base = 45 if payload.weather_band == "storm" else 30
    queue_penalty = min(payload.open_orders // 25, 20)
    return base + queue_penalty


@app.post("/predict/eta", response_model=EtaResponse)
def predict_eta(payload: EtaRequest) -> EtaResponse:
    future = executor.submit(score_eta, payload.model_dump())
    try:
        eta_minutes = future.result(timeout=MODEL_TIMEOUT_SECONDS)
        fallback_used = False
    except TimeoutError:
        eta_minutes = conservative_eta(payload)
        fallback_used = True

    return EtaResponse(
        request_id=payload.request_id,
        eta_minutes=eta_minutes,
        model_version="eta-xgb-2026-07-04",
        fallback_used=fallback_used,
    )
```

This example keeps the main lesson visible. The fallback is part of the serving design, not an afterthought. It uses current request facts, returns the same response shape, and records `fallback_used` so operations can alert when the model path is unhealthy.

An online service also needs release discipline. Deploy the new model behind the same response contract. Compare latency, fallback rate, and prediction distribution before increasing traffic. Keep the previous image and model artifact ready so rollback means changing the deployment target, not rebuilding code during an incident.

![FreshCart checkout ETA online API](/content-assets/articles/article-mlops-model-serving-batch-vs-online-inference/checkout-eta-online-api.png)
*The online path is request-shaped: validate the payload, score within the latency budget, and return a conservative ETA if the model path times out.*

## Operations, Checks, and Recovery
<!-- section-summary: Batch and online inference need different evidence because their failures hurt the business in different ways. -->

Batch inference checks start with freshness and row counts. The job should answer these questions every run: Did the input partition arrive? Did the job score the expected number of rows? Did the output partition land once? Did the score distribution shift in a way that matches real business changes? Did the downstream planner read the new partition?

A simple batch run report can look like this:

| Check | Healthy signal | Owner |
|---|---|---|
| Input freshness | Feature partition exists for `prediction_date` | Data platform |
| Row count | Within 5% of recent same-weekday count | MLOps |
| Null score count | Zero | MLOps |
| Output partition | One successful write for the model version | Data platform |
| Distribution | Risk bands close to reviewed thresholds | Model owner |

Online inference checks start with live service behavior. The team watches request rate, p95 and p99 latency, error rate, timeout count, fallback rate, CPU or GPU saturation, and the rate of validation failures. These signals tell the team whether the customer workflow is healthy and whether the model service has enough capacity.

Here is a practical incident split:

| Symptom | Batch response | Online response |
|---|---|---|
| Bad input data | Stop the job, fix the partition, rerun | Reject invalid requests or fallback only if safe |
| Slow model | Increase job resources or chunk size | Scale replicas, reduce model work, or fallback |
| Wrong model version | Rerun output partition with approved version | Roll back deployment or route traffic to old version |
| Missing output | Rerun before business cutoff | Use cached or conservative answer while service recovers |

The key is to design recovery before the failure. Batch recovery needs rerun commands and partition ownership. Online recovery needs rollback commands, fallback policy, and alert thresholds. The same model card can mention both, but the runbooks should differ because the caller is different.

## Putting It Together
<!-- section-summary: Use batch when predictions can be prepared, and use online when the product workflow needs the prediction during the request. -->

Batch and online inference are the two serving patterns most teams meet first. Batch inference scores many records ahead of time and writes predictions for later use. Online inference scores live requests and returns predictions while the caller waits. FreshCart uses batch for tomorrow's substitution planning and online serving for checkout ETA because those workflows have different timing, freshness, cost, and failure needs.

When you design a serving path, start with the business workflow. Ask who waits for the answer, how fresh the input must be, where the output lives, how the team retries safely, and what evidence proves the service worked. After that, the tool choice gets much clearer: a scheduled job for prepared predictions, an API service for live predictions, and sometimes both for different parts of the same product.

## References

- [FastAPI request body docs](https://fastapi.tiangolo.com/tutorial/body/)
- [Pydantic model validation docs](https://pydantic.dev/docs/validation/dev/concepts/models/)
- [Kubernetes CronJob docs](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
- [Kubernetes Job docs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
