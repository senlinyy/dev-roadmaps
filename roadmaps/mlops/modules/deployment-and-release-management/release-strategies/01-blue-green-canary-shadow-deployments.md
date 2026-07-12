---
title: "Model Release Strategies"
description: "Use blue-green, canary, and shadow releases to move model changes into production with controlled traffic, observable checkpoints, and a clear stop path."
overview: "Model release strategies control how a new model version reaches real traffic. This tutorial follows a product search ranking service through blue-green stacks, canary traffic, shadow evaluation, Argo Rollouts analysis, Istio mirroring, Prometheus signals, and MLflow or Databricks aliases."
tags: ["MLOps", "production", "delivery"]
order: 1
id: "article-mlops-deployment-and-release-management-blue-green-canary-shadow-deployments"
---

## Table of Contents

1. [Release Strategies Control The Blast Radius](#release-strategies-control-the-blast-radius)
2. [Follow One Search Ranking Release](#follow-one-search-ranking-release)
3. [Blue-Green Gives You Two Complete Stacks](#blue-green-gives-you-two-complete-stacks)
4. [Canary Sends A Small Slice First](#canary-sends-a-small-slice-first)
5. [Shadow Runs The Candidate Beside Production](#shadow-runs-the-candidate-beside-production)
6. [Connect Traffic To Model Aliases And Evidence](#connect-traffic-to-model-aliases-and-evidence)
7. [Use Signals To Promote, Pause, Or Stop](#use-signals-to-promote-pause-or-stop)
8. [Putting It Together](#putting-it-together)
9. [References](#references)

## Release Strategies Control The Blast Radius
<!-- section-summary: A model release strategy controls how much real traffic reaches a new model version while the team gathers evidence. -->

A **model release strategy** is the traffic plan for moving a new model version into production. It answers a simple release question early: how many users should see the candidate model before the team has enough production evidence to trust it? For ML systems, that question matters because a model can pass offline evaluation and still hurt production through slow inference, missing features, skewed predictions, or surprising product behavior.

In the previous release-basics articles, you saw model artifacts, version labels, environments, and registry aliases. This article uses those pieces to control real traffic. A release strategy sits between "the candidate passed review" and "every request now uses the candidate." It gives the team a small first step, a way to compare behavior, and a ready stop path.

The three common strategies in model releases are **blue-green**, **canary**, and **shadow**. Blue-green keeps two complete serving stacks and switches traffic after the candidate stack passes checks. Canary sends a small percentage of production traffic to the candidate, then widens that slice after the signals stay healthy. Shadow copies production requests to the candidate while users still receive the old model's answer, which helps the team inspect candidate behavior before it affects the product.

![CedarCart model release paths](/content-assets/articles/article-mlops-deployment-and-release-management-blue-green-canary-shadow-deployments/cedarcart-release-paths.png)

*CedarCart can choose a full-stack switch, a staged canary, or a shadow path for `product-ranker:v38`, while rollback and metrics stay attached to each path.*

## Follow One Search Ranking Release
<!-- section-summary: The running scenario follows an ecommerce ranking model where poor release control can harm search results and revenue. -->

Imagine **CedarCart**, an ecommerce marketplace. Customers search for products such as "running shoes," "coffee grinder," and "portable monitor." A model called `product-ranker` orders the search results. The current production model is `product-ranker:v37`, and the candidate is `product-ranker:v38`.

The ML team trained `v38` with fresher click and purchase data. Offline ranking metrics improved, especially for long-tail searches. That sounds promising, yet the release risk is real. If the model pushes out-of-stock items to the top, conversion drops. If it over-favors one seller segment, marketplace operations gets complaints. If inference latency rises, search pages load slowly and users leave before seeing the results.

CedarCart uses this stack:

| Piece | CedarCart example | Why it matters |
|---|---|---|
| Registry | MLflow or Databricks Unity Catalog model `prod_ml.search.product_ranker` | Stores model versions, aliases, tags, lineage, and review evidence |
| Serving runtime | `ranker-api` in Kubernetes | Handles `/rank` requests from the search backend |
| Release controller | Argo Rollouts | Declares canary or blue-green steps and pauses |
| Traffic layer | Istio or another supported router | Splits or mirrors traffic by percentage or route |
| Observability | Prometheus, Grafana, OpenTelemetry traces, warehouse logs | Shows latency, errors, traffic share, and model behavior |
| Rollback control | Registry alias, rollout abort, GitOps revert | Returns traffic to `v37` if the candidate fails |

The model release should connect all of these. A traffic percentage alone only tells you where requests go. The release is useful when that traffic percentage links to model version labels, health checks, product metrics, and a clear action if the numbers cross a threshold.

## Blue-Green Gives You Two Complete Stacks
<!-- section-summary: Blue-green releases run the old and new stacks side by side, then switch the active route after the new stack passes checks. -->

**Blue-green release** means you keep two production-ready stacks. The blue stack serves real traffic now. The green stack runs the candidate version with the same request contract, similar capacity, and the same observability labels. The release team tests green first, then switches the active route when the evidence is strong enough.

For CedarCart, blue is `ranker-api` serving `product-ranker:v37`. Green is another `ranker-api` stack serving `product-ranker:v38`. Search traffic still goes to blue while the platform team checks green with synthetic requests, replayed production queries, and a small internal preview route. If green passes, the active Service or traffic route moves from blue to green.

Argo Rollouts supports a blue-green strategy with an active Service and a preview Service. The active Service receives normal application traffic. The preview Service sends test traffic to the new ReplicaSet before promotion. A simplified manifest can look like this:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: ranker-api
spec:
  replicas: 10
  selector:
    matchLabels:
      app: ranker-api
  strategy:
    blueGreen:
      activeService: ranker-api-active
      previewService: ranker-api-preview
      autoPromotionEnabled: false
      prePromotionAnalysis:
        templates:
          - templateName: ranker-preview-checks
  template:
    metadata:
      labels:
        app: ranker-api
    spec:
      containers:
        - name: api
          image: ghcr.io/cedarcart/ranker-api@sha256:72a9c...
          env:
            - name: MODEL_URI
              value: models:/prod_ml.search.product_ranker/38
            - name: MODEL_VERSION
              value: "38"
```

The useful detail is `autoPromotionEnabled: false`. The controller can prepare the green stack, but a person or automation gate still has to promote it after the analysis passes. That fits ML releases because final approval often needs model-specific evidence, not only Pod readiness.

Blue-green works well when the team wants a clean switch between full stacks. It also gives a fast fallback if the green stack fails soon after promotion because the old stack can stay warm for a short window. The tradeoff is cost and capacity. Running two complete stacks for a large model service can double GPU or CPU demand during the release window, so the plan should state how long the old stack stays active.

## Canary Sends A Small Slice First
<!-- section-summary: A canary release sends a small percentage of live traffic to the candidate and expands only after the release signals pass. -->

**Canary release** means a small slice of production traffic goes to the candidate first. The team watches the candidate against the current model, then widens the slice in planned steps. Canary is usually the daily release pattern for online model services because it limits harm while still collecting real production behavior.

CedarCart chooses canary for `v38` because search traffic is high enough to compare quickly. The release starts with 2 percent of search requests for 30 minutes, then 10 percent for one hour, then 25 percent through a normal shopping peak. Each step has a decision: continue, pause for investigation, or abort.

An Argo Rollouts canary can express those steps:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: ranker-api
spec:
  replicas: 10
  strategy:
    canary:
      stableService: ranker-api-stable
      canaryService: ranker-api-canary
      trafficRouting:
        istio:
          virtualService:
            name: ranker-api
            routes:
              - primary
      steps:
        - setWeight: 2
        - pause:
            duration: 30m
        - analysis:
            templates:
              - templateName: ranker-canary-prometheus
        - setWeight: 10
        - pause:
            duration: 1h
        - setWeight: 25
        - pause:
            duration: 2h
        - setWeight: 100
```

The `setWeight` fields describe the traffic share. The pause fields give the team time to gather evidence. The analysis step lets the rollout query a metric system such as Prometheus and stop the release if the candidate crosses a failure condition.

With a traffic manager such as Istio, the traffic percentage can stay separate from Pod counts. That matters for model serving because one candidate Pod might need more memory or GPU capacity than one stable Pod. The release team should size the candidate stack for the traffic it will receive and keep the stable stack ready to handle full traffic if the candidate is aborted.

## Shadow Runs The Candidate Beside Production
<!-- section-summary: Shadow release copies live requests to the candidate so the team can inspect behavior before candidate responses reach users. -->

**Shadow release** means live production requests are copied to the candidate model, while users still receive the current production answer. Shadow traffic helps the team answer, "How would the candidate respond to real requests?" without using those answers in the product yet.

For CedarCart, the search backend sends the real request to `v37` and receives the ranking that customers see. The traffic layer also sends a copy to `v38`. The candidate response is logged and dropped. Nobody sees it in the product, but the team can compare rank distributions, missing feature behavior, latency, and seller segment exposure.

Istio supports traffic mirroring through a route rule. A simplified VirtualService can mirror a portion of traffic to a candidate service:

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: ranker-api
spec:
  hosts:
    - ranker-api.cedarcart.svc.cluster.local
  http:
    - route:
        - destination:
            host: ranker-api-stable
            subset: v37
          weight: 100
      mirror:
        host: ranker-api-shadow
        subset: v38
      mirrorPercentage:
        value: 20
```

Shadow traffic is powerful, but it needs guardrails. Candidate calls still consume CPU, memory, GPUs, downstream feature store reads, and log volume. Shadow also needs privacy review because the candidate receives real request data. CedarCart keeps shadow results out of customer responses, writes them to a separate table, and samples enough traffic to compare behavior without accidentally doubling the whole production workload.

Shadow fits models whose labels or product outcomes arrive later. A search ranking team can compare candidate rank position, availability, price bands, and latency on day one. Purchase conversion takes longer, so shadow cannot answer every product question alone. It gives the canary a cleaner start.

## Connect Traffic To Model Aliases And Evidence
<!-- section-summary: Release traffic should point to approved model identities and every request should record the resolved model version. -->

Traffic control tells the platform where to send requests. Model identity tells the team what served those requests. CedarCart needs both. If the rollout says "canary service," the canary service must still load a known model version, record the resolved version, and connect that version to registry evidence.

MLflow Model Registry supports versions and aliases such as `champion` or `candidate`. Current MLflow docs recommend aliases for deployment-style pointers, and model stages are deprecated. In Databricks, Unity Catalog models are the governed model lifecycle surface for modern workspaces, with access control, audit, lineage, discovery, and compatibility with the open-source MLflow client.

CedarCart keeps production stable on the `champion` alias and points the canary runtime at the explicit version under review:

```yaml
stable:
  model_uri: models:/prod_ml.search.product_ranker@champion
  expected_resolved_version: "37"

canary:
  model_uri: models:/prod_ml.search.product_ranker/38
  release_candidate: true
  review_packet: s3://cedarcart-ml-reviews/product-ranker/v38/review.yaml
```

Every prediction log should record both the requested pointer and the resolved version:

```json
{
  "event": "ranker_prediction",
  "query_id": "q_881923",
  "traffic_group": "canary",
  "model_name": "prod_ml.search.product_ranker",
  "model_pointer": "version:38",
  "model_version": "38",
  "request_latency_ms": 44,
  "result_count": 48,
  "out_of_stock_top10": 1
}
```

This record makes the release auditable. If support reports bad search results at 18:20 UTC, the team can query by `traffic_group`, `model_version`, and query segment. If rollback happens, the failed model version stays in the registry with its metrics and logs, so the team can fix the release rather than guessing from memory.

## Use Signals To Promote, Pause, Or Stop
<!-- section-summary: Release decisions should use service health, model behavior, and product guardrails instead of traffic percentages alone. -->

A release strategy needs decision signals. Kubernetes readiness can tell you the Pod accepted traffic, but it cannot tell you whether the ranking model is harming search quality. CedarCart watches signals in three layers: service health, model behavior, and product guardrails.

| Layer | Signal | Example stop rule |
|---|---|---|
| Service health | 5xx rate, p95 latency, timeout rate | Stop if canary p95 stays above 150 ms for 10 minutes |
| Input health | missing features, unknown category rate, feature store errors | Stop if feature lookup errors exceed 0.5 percent |
| Prediction behavior | empty result rate, out-of-stock top results, score distribution | Stop if out-of-stock items in top 10 double from baseline |
| Product guardrail | add-to-cart rate, zero-result searches, support contacts | Pause if add-to-cart drops by more than the reviewed threshold |

Prometheus can hold the fast service metrics. The product and model signals may come from logs or warehouse tables. Argo Rollouts can run Prometheus analysis during canary:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: ranker-canary-prometheus
spec:
  metrics:
    - name: canary-error-rate
      interval: 2m
      count: 5
      successCondition: result[0] < 0.01
      provider:
        prometheus:
          address: http://prometheus.monitoring.svc:9090
          query: |
            sum(rate(http_requests_total{app="ranker-api",traffic_group="canary",status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total{app="ranker-api",traffic_group="canary"}[5m]))
    - name: canary-p95-latency
      interval: 2m
      count: 5
      successCondition: result[0] < 0.15
      provider:
        prometheus:
          address: http://prometheus.monitoring.svc:9090
          query: |
            histogram_quantile(
              0.95,
              sum by (le) (
                rate(http_request_duration_seconds_bucket{app="ranker-api",traffic_group="canary"}[5m])
              )
            )
```

The first query checks server errors. The second checks p95 latency. Both use labels that the service must emit consistently. OpenTelemetry semantic conventions help teams use common HTTP metric names and attributes, while Prometheus alerting and recording rules help turn repeated queries into shared release checks.

The practical habit is to write the stop rules before the release starts. During a tense rollout, people can talk themselves into waiting "five more minutes." A written threshold gives the incident commander and release owner a calmer decision path.

![Canary gates for product-ranker v38](/content-assets/articles/article-mlops-deployment-and-release-management-blue-green-canary-shadow-deployments/canary-gates-product-ranker-v38.png)

*The canary widens from 2 percent to 25 percent only after service, feature, prediction, and product signals stay inside the reviewed thresholds.*

## Putting It Together
<!-- section-summary: Blue-green, canary, and shadow releases work best when traffic control, model identity, signals, and rollback are planned together. -->

Model release strategies give CedarCart a safe path from approved artifact to production traffic. Blue-green prepares a complete candidate stack and switches after checks. Canary sends a small live slice first, then widens only after signals pass. Shadow copies real requests to the candidate so the team can study behavior before users receive candidate predictions.

The release strategy works because it connects traffic to model identity and evidence. The serving runtime records model versions. The registry keeps aliases and review packets. Argo Rollouts and Istio control the route. Prometheus, OpenTelemetry, logs, and warehouse checks show whether the candidate is healthy enough to continue.

![Release evidence loop](/content-assets/articles/article-mlops-deployment-and-release-management-blue-green-canary-shadow-deployments/release-evidence-loop.png)

*A useful release loop ties the registry alias, rollout step, live signals, decision record, and rollback path to the same candidate version.*

For ML systems, release control is product safety. A good plan says which version is live, who approved it, which traffic slice sees it, which signals decide the next step, and how the team stops the release if the model harms users.

## References

- [MLflow Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [Databricks: Manage model lifecycle in Unity Catalog](https://docs.databricks.com/aws/en/machine-learning/manage-model-lifecycle/)
- [Argo Rollouts: BlueGreen Deployment Strategy](https://argo-rollouts.readthedocs.io/en/stable/features/bluegreen/)
- [Argo Rollouts: Canary Deployment Strategy](https://argo-rollouts.readthedocs.io/en/stable/features/canary/)
- [Argo Rollouts: Analysis and Progressive Delivery](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/)
- [Istio: Traffic Mirroring](https://istio.io/latest/docs/tasks/traffic-management/mirroring/)
- [Prometheus: Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [OpenTelemetry: HTTP metrics semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/)
