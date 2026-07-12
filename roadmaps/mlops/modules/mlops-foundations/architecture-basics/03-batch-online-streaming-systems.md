---
title: "Serving Modes"
description: "Compare the major serving shapes so learners can classify systems early."
overview: "Models reach production through different serving modes. This article compares batch prediction, online inference, streaming inference, and hybrid systems so learners can choose the right shape for a product decision."
tags: ["MLOps", "core", "architecture"]
order: 3
id: "article-mlops-mlops-foundations-batch-online-streaming-systems"
---

## Table of Contents

1. [Serving Mode Means How Predictions Reach The Product](#serving-mode-means-how-predictions-reach-the-product)
2. [Batch Prediction](#batch-prediction)
3. [Online Inference](#online-inference)
4. [Streaming Inference](#streaming-inference)
5. [Hybrid Systems](#hybrid-systems)
6. [How To Choose A Serving Mode](#how-to-choose-a-serving-mode)
7. [Operational Checks For Each Mode](#operational-checks-for-each-mode)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Serving Mode Means How Predictions Reach The Product
<!-- section-summary: A serving mode describes when a model runs, what triggers it, how fast the product needs the answer, and where the prediction is stored or returned. -->

Once a team has a trained model, the next question is how the product will use it. Some products need a prediction before a user can continue. Some need predictions prepared ahead of time. Some react to a stream of events. These shapes are called **serving modes**.

A **serving mode** describes how predictions reach the product or downstream system. It answers practical questions: when does the model run, what triggers it, how fast does the answer need to arrive, where does the result go, and how does the team monitor the path?

Let's use **FlowRide**, a commuter shuttle company. It has several model use cases. A weekly demand model predicts how many vans each neighborhood will need next Monday. An online ETA model predicts arrival time while a rider waits in the app. A streaming incident model watches live vehicle and traffic events for sudden service disruption. These are all production ML systems, but they need different serving modes.

The three common serving modes are **batch prediction**, **online inference**, and **streaming inference**. Many real systems combine them. Recognizing the shape early helps you reason about latency, infrastructure, monitoring, cost, and failure handling.

![Three serving modes infographic comparing batch scheduled scores, online request response, and streaming events in motion](/content-assets/articles/article-mlops-mlops-foundations-batch-online-streaming-systems/three-serving-modes.png)

_The image gives you the first split: batch prepares scores, online answers live requests, and streaming reacts to moving events._

## Batch Prediction
<!-- section-summary: Batch prediction runs a model over many records on a schedule or job trigger, then stores the results for later use. -->

**Batch prediction** runs a model over a group of records at once. The job may run hourly, daily, weekly, or when a dataset arrives. The output usually lands in a table, file, feature store, CRM system, search index, or notification queue.

FlowRide might use batch prediction for neighborhood demand planning. Every night, a job scores every service zone and writes expected ride demand to a warehouse table. The operations team sees the score in its planning dashboard the next morning and assigns vans before drivers start their shifts. The score does not need to arrive in 100 milliseconds because nobody is waiting inside a live rider request.

```yaml
batch_job:
  model: neighborhood-demand:v7
  schedule: daily at 02:00 UTC
  input: warehouse.zone_daily_features
  output: warehouse.zone_demand_predictions
  freshness_sla: available by 05:00 UTC
```

Batch systems are useful when the product can use prepared predictions. They are often simpler to operate than low-latency APIs because the job has more time, can process records in chunks, and can retry failed partitions. They also make cost easier to control because compute runs during known windows.

Batch serving has its own risks. The output can go stale. A failed job can leave yesterday's scores in place. A schema change can break the job before business users arrive. Monitoring should track job success, record counts, freshness, output distribution, and downstream delivery.

## Online Inference
<!-- section-summary: Online inference runs a model during a live request and returns a prediction inside the product's latency budget. -->

**Online inference** runs a model when a live request arrives. The product needs the answer immediately, so latency and availability matter. The model usually sits behind an API, model server, or managed endpoint.

FlowRide uses online inference for ETA prediction. When a rider opens the app, the product sends a request with pickup location, nearest vehicle, current route state, traffic summary, and promised pickup window. The endpoint validates the input, builds or retrieves features, loads the model version, returns an ETA, and the app decides what message to show.

```yaml
online_endpoint:
  model: pickup-eta:v18
  route: /predict/pickup-eta
  p95_latency_ms: 120
  inputs:
    - pickup_zone
    - vehicle_distance_meters
    - route_delay_seconds
    - active_rider_count
  output:
    eta_seconds: integer
```

Online serving fits product decisions that cannot wait for a batch job. Fraud checks, recommendations during a session, search ranking, content moderation before publishing, and dynamic pricing can all need online inference.

The tradeoff is operational pressure. The service needs autoscaling, health checks, dependency handling, timeouts, fallbacks, and version visibility. A slow model can slow the product. A broken endpoint can block a rider request path. The team should know what happens if the model is unavailable: use a fallback model, use a simple distance-based rule, return a conservative ETA, or stop the workflow.

Kubernetes, KServe, managed endpoints, and simpler FastAPI services can all serve online models. The platform choice matters less than the contract: the endpoint should know the model version, validate the request, expose latency and error metrics, and provide a rollback path. Kubernetes Horizontal Pod Autoscaler can add Pods when demand rises, while KServe adds ML-specific serving resources such as predictors, canary rollouts, and model-serving runtimes.

## Streaming Inference
<!-- section-summary: Streaming inference scores records as events flow through a stream, which fits near-real-time decisions that do not belong inside a request-response API. -->

**Streaming inference** runs as events flow through a stream. The trigger is an event, such as a new transaction, sensor reading, click, log line, or message. The output may create another event, update a store, trigger an alert, or feed another system.

FlowRide might use streaming inference for service disruption detection. Each vehicle GPS event, driver status update, traffic incident, and pickup cancellation enters a stream. A stream processor builds recent-window features, scores each zone, and publishes high-risk disruption alerts to an operations topic. Dispatchers can react within seconds by moving vans or changing rider messages.

```yaml
streaming_job:
  model: service-disruption:v4
  input_topic: fleet.events
  output_topic: ops.disruption-alerts
  window_features:
    - zone_pickup_cancellations_5m
    - vehicle_idle_rate_10m
    - traffic_incident_count_15m
  max_event_lag_seconds: 20
```

Streaming fits event-driven systems where the product needs near-real-time behavior outside a direct synchronous response. It can handle high event volume and continuous updates, and it brings stream-specific concerns: event lag, out-of-order events, replay behavior, exactly-once or at-least-once processing, and stateful feature windows.

Monitoring should track input lag, processing errors, output volume, feature window health, model score distribution, and alert quality. The team should also define replay rules. If the model version changes, should old events be replayed with the new model, or should only new events use it?

## Hybrid Systems
<!-- section-summary: Many production systems combine batch, online, and streaming paths because different parts of the same product need predictions at different times. -->

Many systems combine serving modes. The same model family can use batch for precomputed features, online inference for live decisions, and streaming for feedback or alerts. This is normal because products have more than one timing need.

FlowRide's operations system might use all three modes. A nightly batch job creates zone demand forecasts. The online ETA endpoint uses recent route and vehicle features when a rider opens the app. A stream monitors live fleet events and publishes disruption alerts. Later, actual pickup times and cancellation outcomes flow back through data pipelines for retraining.

![Hybrid serving system infographic showing batch scoring, online predictions, feature updates, monitoring, and feedback labels connected around one model system](/content-assets/articles/article-mlops-mlops-foundations-batch-online-streaming-systems/mixed-serving-modes.png)

_The hybrid view shows why one product can use several serving modes around the same model family._

Hybrid systems need clear boundaries. The team should know which path owns which prediction, which model version each path uses, and how failures in one path affect the others. A stale batch feature can hurt the online endpoint. A delayed stream can create late alerts. A model version mismatch can make investigation confusing.

## How To Choose A Serving Mode
<!-- section-summary: Choosing a serving mode starts with the product decision, latency need, data freshness, scale, cost, and failure behavior. -->

The serving mode should follow the product decision. Start with the question the product needs answered, then look at timing, freshness, cost, and risk.

![Decision infographic mapping daily report to batch, checkout prediction to online, and fraud signal feed to streaming with latency, freshness, and cost tradeoffs](/content-assets/articles/article-mlops-mlops-foundations-batch-online-streaming-systems/choose-by-product-need.png)

_The decision visual connects product need to serving mode, then shows the latency, freshness, and cost tradeoffs you should expect._

| Question | Batch | Online | Streaming |
|---|---|---|---|
| When does the model run? | On a schedule or job trigger | During a live request | For each event or event window |
| Latency expectation | Minutes to hours | Milliseconds to seconds | Seconds or near-real-time |
| Output location | Table, file, store, queue | API response | Topic, alert, store update |
| Good fit | Prepared scores, reports, offline actions | Checkout, search, moderation, recommendations | Anomaly alerts, event enrichment, monitoring |
| Main risk | Stale or missing output | Product latency or endpoint failure | Lag, replay, event ordering |

For FlowRide, pickup ETA belongs online because the rider is waiting for an answer. Neighborhood demand forecasting belongs in batch because operations can use a prepared morning plan. Service disruption detection can use streaming because each event should be evaluated quickly without blocking the rider request path.

The mode can change as the product changes. A model may start as batch because the team wants a safe first release. Later, the product may need online scoring. That change is an architecture change, not only a model change, because latency, monitoring, deployment, and rollback all change.

## Operational Checks For Each Mode
<!-- section-summary: Each serving mode needs different operational checks, but every mode needs version visibility, input quality checks, output monitoring, and rollback thinking. -->

Each mode has its own operational checklist. Batch needs freshness and completeness. Online needs latency and availability. Streaming needs lag and event handling. All modes need model version visibility and input/output monitoring.

| Mode | Minimum checks |
|---|---|
| Batch | job success, input count, output count, freshness, score distribution, downstream delivery |
| Online | request rate, p95 latency, error rate, timeout rate, model version, input validation, fallback use |
| Streaming | event lag, processing errors, replay status, window state health, output volume, alert quality |

A rollback plan also changes by mode. Batch rollback may mean restoring yesterday's score table or rerunning a previous model version. Online rollback may mean routing traffic back to the previous endpoint. Streaming rollback may mean switching the processor model version and deciding what to do with events processed during the bad window.

The team should write these checks before production release. A serving mode without operational checks is only a diagram. Production needs the checks that show whether the path is working.

## Putting It All Together
<!-- section-summary: Serving modes classify the production path so teams can design the right latency, freshness, deployment, monitoring, and rollback controls. -->

Serving mode is one of the first architecture decisions for a model. Batch prediction prepares scores ahead of time. Online inference answers a live request. Streaming inference reacts to events as they flow. Hybrid systems combine these paths when the product has several timing needs.

For FlowRide, the same company needs all three shapes. Demand planning needs batch prediction. Pickup ETA needs online inference. Fleet disruption detection needs streaming inference. Each mode changes how the team thinks about freshness, cost, failure, deployment, monitoring, and rollback.

Once you can classify the serving mode, the rest of the architecture has clearer boundaries. You know where predictions go, how fast they must arrive, which systems can fail, and which evidence proves the model is working.

## What's Next
<!-- section-summary: The next module starts the data path, beginning with labels, features, targets, splits, and leakage. -->

This finishes the MLOps Foundations module. Next, the roadmap moves into Data for ML Systems. The first articles explain labels, features, targets, train-validation-test splits, and data leakage, which are the ingredients every later training and evaluation workflow depends on.

## References

- [KServe Docs: Welcome to KServe](https://kserve.github.io/website/docs/intro) - Documents KServe predictors, transformers, explainers, autoscaling, canary deployment, and multi-framework model serving on Kubernetes.
- [Google Cloud: Batch prediction for Vertex AI](https://cloud.google.com/vertex-ai/docs/predictions/get-batch-predictions) - Describes batch prediction jobs and output destinations.
- [AWS SageMaker AI: Real-time inference](https://docs.aws.amazon.com/sagemaker/latest/dg/realtime-endpoints.html) - Documents real-time endpoints for low-latency online inference.
- [AWS SageMaker AI: Batch transform](https://docs.aws.amazon.com/sagemaker/latest/dg/batch-transform.html) - Documents batch inference jobs for datasets that can be processed asynchronously.
- [Kubernetes Docs: Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/) - Explains how Kubernetes can adjust workload replicas to match demand.
