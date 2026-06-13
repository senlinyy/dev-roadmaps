---
title: "Canary Deployments"
description: "Verify new releases in production safely by routing a tiny slice of real user traffic and monitoring telemetry."
overview: "Switching 100% of users to a new release at once exposes systems to critical scale bugs. Learn how canary deployments partition live traffic, how service meshes execute weight-based splits, and how to automate rollbacks using real-time error and latency metrics."
tags: ["canary-deployments", "traffic-routing", "telemetry", "prometheus"]
order: 3
id: article-cicd-deployment-strategies-canary-deployments
aliases:
  - /cicd/deployment-strategies/canary-deployments
---

## Table of Contents

1. [Why a Smaller Production Step Helps](#why-a-smaller-production-step-helps)
2. [The Canary Release Shape](#the-canary-release-shape)
3. [Traffic Weights](#traffic-weights)
4. [Telemetry Comparison](#telemetry-comparison)
5. [Automated Gates](#automated-gates)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## Why a Smaller Production Step Helps
<!-- section-summary: Canary deployments reduce release exposure by letting a small part of real traffic try the new version first. -->

Blue-green deployments gave our checkout API a clean environment switch. Green was validated, traffic moved, and blue stayed nearby for rollback. That is a strong pattern, but promotion still sends the full user base to the new version at once.

Some bugs only appear with real production traffic. A search query pattern may use more memory than staging ever showed. A checkout discount may fail only for users with old saved carts. A payment provider may throttle a new request shape only when thousands of users hit it. Local tests, integration tests, and smoke tests help, but production traffic has a variety that test data rarely matches.

A **canary deployment** sends a small, controlled slice of production traffic to the new version while most users stay on the stable version. The team watches the new version beside the stable version. If the new version behaves well, the team increases traffic in steps. If it behaves badly, the team sends traffic back to the stable version before the whole service feels the failure.

The key difference from blue-green is exposure. Blue-green asks, "Can the green environment handle production?" Canary asks, "Can a small amount of real production traffic prove this version deserves more traffic?"

To make that useful, we need two things: a traffic system that can split requests by weight, and telemetry that can compare the new version against the current baseline.

## The Canary Release Shape
<!-- section-summary: A canary release keeps a stable baseline active while the new version receives a measured traffic slice. -->

The **baseline** is the current healthy version. The **canary** is the new version under evaluation. Both versions run at the same time, but the canary receives only a small percentage of traffic at first.

For the checkout API, the first step might look like this:

| Version | Role | Traffic |
|---|---|---:|
| `2026.06.13.1` | Baseline | 99% |
| `2026.06.13.2` | Canary | 1% |

The pipeline waits for a few minutes and checks signals. If the canary looks healthy, the next steps might be 5%, 10%, 25%, 50%, and 100%. The exact numbers depend on the service. A low-traffic internal API might need bigger steps or longer windows to collect enough requests. A high-traffic checkout path can collect meaningful signal from 1% quickly.

Here is a simplified Argo Rollouts canary shape:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: checkout-api
spec:
  replicas: 20
  strategy:
    canary:
      steps:
        - setWeight: 1
        - pause:
            duration: 10m
        - setWeight: 5
        - pause:
            duration: 15m
        - setWeight: 25
        - pause:
            duration: 20m
        - setWeight: 100
  selector:
    matchLabels:
      app: checkout-api
  template:
    metadata:
      labels:
        app: checkout-api
    spec:
      containers:
        - name: checkout-api
          image: registry.example.com/checkout-api:2026.06.13.2
```

This is the release story written into the controller: start tiny, wait, increase, wait, increase again. The pauses give monitoring time to collect enough evidence. A canary step without a watch window can move too fast for metrics and alerts to catch up.

![Canary traffic ladder showing baseline, canary, 1 percent, 5 percent, 25 percent, 100 percent, and pass gates](/content-assets/articles/article-cicd-deployment-strategies-canary-deployments/canary-traffic-ladder.png)

*A canary release earns more traffic in steps instead of asking the new version to handle everyone immediately.*

The shape depends on traffic routing. The next question is how the platform sends exactly 1%, 5%, or 25% of requests to the new version.

## Traffic Weights
<!-- section-summary: Weighted routing lets the platform control how much live traffic reaches each version. -->

**Weighted routing** means the traffic layer sends a configured percentage of matching requests to each version. A service mesh, ingress controller, gateway, load balancer, or progressive delivery controller can own that split.

In Istio, traffic shifting uses a `VirtualService` that assigns weights to different destination subsets. A simplified checkout route might look like this:

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: checkout-api
spec:
  hosts:
    - checkout-api
  http:
    - route:
        - destination:
            host: checkout-api
            subset: stable
          weight: 95
        - destination:
            host: checkout-api
            subset: canary
          weight: 5
```

The stable subset receives 95% of matching requests. The canary subset receives 5%. The platform can change these weights during the release without rebuilding the application.

Weighted routing has a few practical details that beginners often miss.

First, low request volume can make percentages feel strange. If an admin API receives ten requests per hour, a 1% canary may receive no requests for a long time. For low-volume services, teams may use test users, internal users, region-based routing, or a longer watch window.

Second, user sessions may need stickiness. If a user adds a checkout discount through the canary and then the next request goes to stable, the stable version must understand the data the canary wrote. The platform can use session affinity, header-based routing, or feature flags for selected users, but compatibility still matters.

Third, traffic percentage and capacity percentage are related. If the canary receives 5% of traffic, the team still needs enough canary instances to handle that traffic plus normal bursts. A single canary pod can become a bottleneck if the requests are heavy, even when the percentage looks small.

Traffic weights create the experiment. Telemetry tells us whether the experiment is healthy.

## Telemetry Comparison
<!-- section-summary: Canary decisions need side-by-side signals for baseline and canary, separate from one global service chart. -->

**Telemetry** is the data the system emits while it runs: metrics, logs, traces, and events. During a canary release, telemetry needs labels that separate baseline and canary. A global checkout error-rate chart can hide the problem because 1% bad traffic may barely move the total line.

For canary decisions, the team should compare the same signals for both versions:

| Signal | Baseline question | Canary question |
|---|---|---|
| Error rate | What is normal right now? | Is the new version worse than normal? |
| Latency | What p95 and p99 values are users seeing? | Is the new version slower under the same traffic period? |
| Saturation | How full are CPU, memory, queue workers, and DB pools? | Does the new version consume more resources per request? |
| Business result | How many checkouts succeed? | Does the canary reduce successful checkouts or payment approvals? |

Labels make this comparison possible. A Prometheus metric for HTTP requests might include `service`, `route`, `status`, and `version`. Then a query can compare version `2026.06.13.2` against version `2026.06.13.1`.

Here is a small PromQL example for canary 5xx rate:

```promql
sum(rate(http_requests_total{
  service="checkout-api",
  version="2026.06.13.2",
  status=~"5.."
}[5m]))
/
sum(rate(http_requests_total{
  service="checkout-api",
  version="2026.06.13.2"
}[5m]))
```

That query focuses on the canary version. A second query should calculate the same value for the baseline. The release decision should compare them, because production conditions change throughout the day. A canary at 9 AM and a baseline at 2 AM represent different load patterns.

OpenTelemetry helps here because it gives applications common ways to emit metrics, traces, and logs with attributes. The exact tooling can be Prometheus, Grafana, Datadog, Honeycomb, CloudWatch, or another platform. The important practice is consistent release labels and version labels across every signal.

![Canary telemetry comparison dashboard showing baseline and canary 5xx rate, p95 latency, checkout success, and CPU per request](/content-assets/articles/article-cicd-deployment-strategies-canary-deployments/canary-telemetry-compare.png)

*Canary decisions need version-labeled telemetry so the team can compare the new slice against the stable baseline during the same time window.*

Once the signals exist, the deployment system can use them as gates.

## Automated Gates
<!-- section-summary: Canary gates turn telemetry into release decisions that pause, promote, or roll back automatically. -->

A **gate** is a rule that decides whether the canary can continue. A manual gate might be a person reviewing a dashboard. An automated gate reads metrics and returns pass or fail. Mature teams usually combine both: automation catches clear failures, and humans review ambiguous changes for high-risk services.

For the checkout API, a canary policy might look like this:

```yaml
steps:
  - weight: 1
    duration: 10m
    pass:
      canary_5xx_rate: "< 0.5%"
      canary_p95_latency: "< baseline_p95 * 1.2"
      synthetic_checkout: "passing"
  - weight: 5
    duration: 15m
    pass:
      canary_5xx_rate: "< baseline_5xx_rate + 0.2%"
      payment_authorization_rate: ">= baseline - 0.5%"
  - weight: 25
    duration: 20m
    pass:
      canary_cpu_per_request: "< baseline * 1.3"
      support_error_events: "no spike"
```

Those rules should match the risk of the service. For a homepage banner service, the business gate may be page-render errors. For checkout, payment authorization and order creation matter more than generic CPU. For a background worker, queue depth and processing delay may matter more than HTTP latency.

A good gate also defines the action on failure:

| Failure | Action |
|---|---|
| Readiness fails before canary traffic | Stop rollout and keep all traffic on baseline. |
| Canary error rate exceeds threshold | Set canary weight to 0 and mark release failed. |
| Canary latency rises but errors stay low | Pause and page the release owner for review. |
| Business metric drops | Stop promotion even if infrastructure metrics look healthy. |

The rollback action should be boring and rehearsed. With weighted routing, rollback often means setting the canary weight back to `0` and keeping the baseline at `100`. The team still needs to check whether the canary wrote data that makes the baseline fail. That is why the database compatibility lessons from blue-green also apply to canary.

Now we can put the full canary release together.

## Putting It All Together
<!-- section-summary: A canary release combines weighted routing, labeled telemetry, watch windows, and automatic rollback rules. -->

The checkout team builds image `registry.example.com/checkout-api@sha256:8f3a...` and deploys it as the canary version. The stable version keeps most traffic. The traffic layer sends 1% of production requests to the canary.

During the first watch window, the deployment system compares canary and baseline telemetry. It checks readiness, HTTP 5xx rate, p95 latency, payment authorization rate, CPU per request, and a synthetic checkout. Because metrics include a `version` label, the team can see whether the canary behaves differently from the stable version during the same time period.

If the canary passes, the controller increases traffic to 5%, then 25%, then 50%, then 100%, with pauses between steps. If a gate fails, the controller sends traffic back to stable and marks the release failed. The release owner can debug the canary with logs, traces, and metrics tied to the canary version.

Canary deployments shine when the main risk appears under real production behavior. They need more observability discipline than rolling or blue-green, because the release decision depends on measured signals. Without clear labels, thresholds, and rollback behavior, a canary becomes a slow full rollout with a nicer name.

![Canary release summary showing small slice, measure, pass, increase, fail, and rollback to zero percent](/content-assets/articles/article-cicd-deployment-strategies-canary-deployments/canary-release-summary.png)

*A canary release is a loop: send a small slice, measure it, increase only on pass, and roll back to zero when a gate fails.*

There is still one more production question. When a deployment fails, should the team roll back to the previous version or roll forward with a fix? The next article focuses on that decision.

## What's Next
<!-- section-summary: Rollback and roll-forward decisions turn release failure into a clear recovery path. -->

The next article covers **rollback vs. roll-forward**. We will use the same checkout service and look at what happens after a bad release starts hurting users. The goal is to choose the fastest safe recovery path before pressure takes over.

---

**References**

- [Argo Rollouts canary strategy](https://argo-rollouts.readthedocs.io/en/stable/features/canary/) - Documents canary steps, traffic weights, pauses, and progressive delivery behavior.
- [Istio traffic shifting](https://istio.io/latest/docs/tasks/traffic-management/traffic-shifting/) - Shows weighted routing between service versions with Istio traffic management.
- [OpenTelemetry metrics concepts](https://opentelemetry.io/docs/concepts/signals/metrics/) - Explains metric signals and attributes used to describe measured behavior.
- [Prometheus alerting practices](https://prometheus.io/docs/practices/alerting/) - Covers alerting rules and keeping alert logic actionable.
- [Google SRE: Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) - Introduces practical service monitoring signals such as latency, traffic, errors, and saturation.
