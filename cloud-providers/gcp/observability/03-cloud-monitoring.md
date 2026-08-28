---
title: "Cloud Monitoring"
description: "Turn GCP metrics into useful dashboards, alert policies, SLOs, uptime checks, and incident response loops."
overview: "Cloud Monitoring stores numerical telemetry as time series, then uses dashboards, alert policies, notification channels, SLOs, and Prometheus-compatible workflows to help teams catch production symptoms and verify recovery."
tags: ["gcp", "observability", "monitoring", "alerting", "metrics", "slo"]
order: 3
id: article-cloud-providers-gcp-observability-cloud-monitoring
---

## Table of Contents

1. [What Are Metrics and Time Series?](#what-are-metrics-and-time-series)
2. [How Do Metric Types, Resources, and Labels Identify Data?](#how-do-metric-types-resources-and-labels-identify-data)
3. [How Do Metric Kinds, Distributions, and Aggregation Work?](#how-do-metric-kinds-distributions-and-aggregation-work)
4. [How Do Dashboards and Alerts Turn Data Into Action?](#how-do-dashboards-and-alerts-turn-data-into-action)
5. [How Do SLIs, SLOs, and Error Budgets Define Reliability?](#how-do-slis-slos-and-error-budgets-define-reliability)
6. [How Does Burn Rate Add Urgency?](#how-does-burn-rate-add-urgency)
7. [How Do Prometheus and Outside-In Checks Fit?](#how-do-prometheus-and-outside-in-checks-fit)
8. [How Does Cloud Monitoring Support One Incident?](#how-does-cloud-monitoring-support-one-incident)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

**Metrics** are numbers over time. They answer questions like how big, how often, how slow, how full, and how much. A log can say one checkout failed. A metric can say checkout failures rose from 0.2 percent to 9 percent for ten minutes.

The simplest way to understand metrics is to imagine checking a pulse. One heartbeat tells you very little. A pulse over time tells you whether the body is calm, stressed, improving, or getting worse. A production service has the same need. One request can fail for a harmless reason. A rising error-rate metric tells you the system is moving into a bad state.

Cloud Monitoring stores metric points with time and context. The time shows the shape of the symptom. The context tells you which service, region, revision, response code, database, topic, or VM produced the number. Without that context, `42` is just a number. With context, `42` can mean 42 failed Cloud Run requests in one minute for the new checkout revision.

Keep these questions in view as you work through the lesson:

1. **What Are Metrics and Time Series?**
2. **How Do Metric Types, Resources, and Labels Identify Data?**
3. **How Do Metric Kinds, Distributions, and Aggregation Work?**
4. **How Do Dashboards and Alerts Turn Data Into Action?**
5. **How Do SLIs, SLOs, and Error Budgets Define Reliability?**
6. **How Does Burn Rate Add Urgency?**
7. **How Do Prometheus and Outside-In Checks Fit?**
8. **How Does Cloud Monitoring Support One Incident?**

## What Are Metrics and Time Series?
<!-- section-summary: Metrics answer how many, how often, how slow, how full, and how much over a period of time. -->

**Cloud Monitoring** is Google Cloud's service for metric storage, charts, dashboards, alerting, uptime checks, service monitoring, SLOs, and Prometheus-compatible workflows. For `checkout`, Cloud Monitoring turns raw telemetry into the first production questions: are users affected, how broad is the problem, which service or dependency looks unhealthy, and did the fix work?

The strongest first metrics describe user outcome. For the checkout service, that means checkout success rate, checkout latency, and HTTP `5xx` rate. CPU, memory, instance count, database latency, and database connection use still matter, but they support the investigation after the team knows what users are seeing.

### What Makes One Time Series Distinct?
<!-- section-summary: A time series is a sequence of metric points from one monitored resource and one set of label values. -->

A **time series** is a sequence of measurements from a specific monitored resource. Each point has a time interval and a value. The same metric type can create many time series because different resources and label values produce different streams.

Here is a simplified time-series response for Cloud Run request count:

```json
{
  "metric": {
    "type": "run.googleapis.com/request_count",
    "labels": {
      "response_code": "500",
      "response_code_class": "5xx"
    }
  },
  "resource": {
    "type": "cloud_run_revision",
    "labels": {
      "project_id": "checkout-prod",
      "location": "us-central1",
      "service_name": "checkout",
      "revision_name": "checkout-00042-n9p",
      "configuration_name": "checkout"
    }
  },
  "points": [
    {
      "interval": {
        "startTime": "2026-06-14T14:04:00Z",
        "endTime": "2026-06-14T14:05:00Z"
      },
      "value": {
        "int64Value": "42"
      }
    }
  ]
}
```

The value `42` only makes sense with its envelope. It means Cloud Run counted 42 requests with response code class `5xx` for `checkout`, on revision `checkout-00042-n9p`, in `us-central1`, during that one-minute interval.

The Monitoring API exposes this model directly. A responder might use it while checking whether a dashboard or alert filter selects the expected series:

```bash
FILTER='metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.labels.service_name="checkout"'

curl -G \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  --data-urlencode "filter=${FILTER}" \
  --data-urlencode "interval.startTime=2026-06-14T14:00:00Z" \
  --data-urlencode "interval.endTime=2026-06-14T14:10:00Z" \
  "https://monitoring.googleapis.com/v3/projects/checkout-prod/timeSeries"
```

- `FILTER` chooses the Cloud Run request-count metric for one service.
- `interval.startTime` and `interval.endTime` keep the query inside the incident window.
- The bearer token uses the current `gcloud` identity.
- This command is most useful for debugging filters, dashboards, and alert policies.

Example output:

```json
{
  "timeSeries": [
    {
      "metric": {
        "type": "run.googleapis.com/request_count",
        "labels": {
          "response_code_class": "5xx"
        }
      },
      "resource": {
        "type": "cloud_run_revision",
        "labels": {
          "service_name": "checkout",
          "revision_name": "checkout-00042-n9p",
          "location": "us-central1"
        }
      },
      "points": [
        {
          "interval": {
            "endTime": "2026-06-14T14:05:00Z"
          },
          "value": {
            "int64Value": "42"
          }
        }
      ]
    }
  ]
}
```

Healthy output for a stable period shows mostly successful response classes and low or absent `5xx` values. Suspicious output shows a growing `5xx` series for the new revision during the same window where logs show `payment_timeout`.

## How Do Metric Types, Resources, and Labels Identify Data?
<!-- section-summary: Metric type says what is measured, resource type says where it came from, and labels split the data into useful dimensions. -->

A **metric type** says what is being measured. `run.googleapis.com/request_count` measures Cloud Run requests. A latency metric measures request duration. A custom metric such as `custom.googleapis.com/checkouts/success_count` could measure successful checkout completions.

Beginner confusion often comes from reading a metric name alone. The metric type is only the measurement. It does not fully answer where the measurement came from or which slice of traffic it describes. Cloud Monitoring needs the metric type, resource type, and labels together.

For example, request count can describe a healthy checkout API, an old staging service, a failed production revision, or a different region. The metric type says "request count." The resource type and labels say "Cloud Run revision, checkout-prod, us-central1, checkout, revision 00042, response class 5xx." That full envelope turns the number into evidence.

A **resource type** says what kind of thing produced the measurement. Cloud Run revision metrics use `cloud_run_revision`. Cloud SQL, Cloud SQL, Compute Engine, GKE, and load balancers use their own monitored resource types. The resource labels then identify the specific project, region, service, revision, instance, topic, database, or other resource.

**Labels** split one metric into useful dimensions. Response code class lets you compare `2xx`, `4xx`, and `5xx`. Service and revision labels let you compare rollout versions. Route, dependency, and payment-provider labels can be useful on custom metrics with a small and stable value set.

Label discipline matters because labels create time series. A label such as `status_class` has a small set of values. A label such as `order_id` can have millions of values and can create huge cardinality. Put unique request details in logs or traces, and keep metric labels for stable grouping.

This growth is called **cardinality**. If a metric has 4 regions, 3 revisions, 5 routes, and 6 status values, it can already produce 360 label combinations before instance-level dimensions are considered. A user ID, order ID, or raw URL can make the number effectively unbounded. Cardinality affects query clarity, storage, and operational cost, so unique event identity belongs in logs and traces rather than metric labels.

## How Do Metric Kinds, Distributions, and Aggregation Work?
<!-- section-summary: Metric kinds describe how values behave, distributions retain a spread, and aggregation turns many series into an answer. -->

A metric's **kind** explains how successive values behave. A **gauge** is a current measurement, such as memory usage or active connections. A **cumulative** metric increases from a start time, such as total bytes sent since a process began. A **delta** metric reports the change during each interval, such as requests completed in one minute. A query must align these kinds correctly: summing gauge samples as if they were request deltas would produce a meaningless total.

The value type also matters. A metric can carry integers, floating-point values, booleans, strings, or a **distribution**. A distribution keeps a count, mean, and bucketed spread rather than only one average. Latency is the classic example: an average of 200 ms can hide a slow tail where some customers wait several seconds. Percentiles derived from a distribution reveal that tail.

Monitoring questions usually require three operations. A **filter** chooses matching series, such as checkout request counts from production. **Alignment** puts points from each series into comparable time windows and can convert deltas into rates. **Cross-series reduction** combines matching series, for example summing revisions or calculating a percentile across instances. Preserve the labels needed for comparison before reducing; grouping everything too early can hide the one region or revision that is failing.

Metrics arrive from several sources. Google Cloud services publish built-in platform metrics. Agents and integrations can collect host or third-party metrics. Applications can publish custom metrics, and Managed Service for Prometheus can ingest Prometheus-format telemetry. The source changes how collection is configured, but every resulting time series still needs a measurement, resource identity, labels, points, and intervals.

## How Do Dashboards and Alerts Turn Data Into Action?
<!-- section-summary: Dashboards organize metrics so responders see user impact first, then supporting service, dependency, and change context. -->

A **dashboard** is a shared view of metrics, logs, incidents, SLOs, and operational links. For an incident, the top row should show user impact before lower-level resource pressure. That order keeps the team focused on what users are experiencing.

Think of a dashboard as the first wall display for a remote service. It should help a responder answer "are users affected?" before it asks them to inspect CPU or memory. CPU can be high while users are fine, and CPU can be normal while a dependency failure breaks checkouts. User-facing signals need to lead.

For the checkout service, the top row should show checkout success rate, HTTP `5xx` rate, p95 latency, and request volume. The next row can show Cloud Run instance count, CPU, memory, and container restarts. A later row can show database latency, database connection use, and error logs. That order teaches the team to move from symptom to supporting evidence.

A practical `checkout` dashboard could use this layout:

| Dashboard row | Widgets |
|---|---|
| User impact | Upload success rate, p95 checkout latency, HTTP `5xx` rate, successful checkouts per minute |
| Cloud Run service | Request count, response-code split, active instances, CPU, memory |
| Dependencies | database query latency, Cloud SQL connections, database connection wait time |
| Release and change | Current revision, recent deployment marker, related audit-log link |
| Investigation shortcuts | Logs query link, trace query link, error group link, runbook link |


Dashboards and alerts have different jobs. A dashboard helps humans during investigation. An alert policy decides whether telemetry requires attention and sends that signal to the right people.

A dashboard can still mislead. A truncated y-axis can make a small change look dramatic; an average can conceal a slow tail; a sum can hide that traffic doubled; and a broad project filter can mix staging with production. Every important chart should make the unit, aggregation, time window, resource scope, and grouping visible. Pair ratios with their traffic volume so a single failure during almost zero traffic does not look like a major outage.

### What Makes an Alert Actionable?
<!-- section-summary: Alert policies evaluate telemetry conditions and route incidents through notification channels. -->

An **alert policy** is a rule that Cloud Monitoring evaluates against telemetry. It contains one or more conditions, notification channels, documentation, and labels or severity. After a condition stays true for the configured duration, Cloud Monitoring opens an incident and sends notifications.

A good alert policy describes a user-impacting symptom. For `checkout`, a sustained `5xx` ratio or sustained p95 latency is a better first page than a brief CPU spike. CPU can help diagnosis, but users care whether checkouts finish.

The duration is not only a noise control. It states how long the condition must remain true before it deserves action. Too short and ordinary variation pages the team; too long and real users wait while the policy collects proof. The notification should identify the service, symptom, threshold, duration, dashboard, and first runbook action. If the receiver cannot decide what to do, the policy is recording an interesting graph rather than delivering an actionable alert.

Before a policy can notify anyone, the team needs a notification channel. A small YAML example shows the shape:

```yaml
type: email
displayName: "checkout on-call email"
labels:
  email_address: checkout-oncall@example.com
enabled: true
```

- `type` selects the channel kind.
- `displayName` gives humans a readable target.
- `labels.email_address` is the destination for this email example.
- `enabled` controls whether Cloud Monitoring can use the channel.

Create the channel with:

```bash
gcloud monitoring channels create \
  --project=checkout-prod \
  --channel-content-from-file=checkout-oncall-channel.yaml
```

Example output:

```console
Created notification channel [projects/checkout-prod/notificationChannels/1234567890].
```

Healthy setup output creates the channel in the production project and the team tests that notifications reach the on-call path. Suspicious setup is a disabled channel, stale address, or channel in a different project than the alert policy expects.

Here is a policy that watches the `5xx` ratio for `checkout`:

```yaml
displayName: "checkout high 5xx rate"
combiner: OR
enabled: true
notificationChannels:
  - projects/checkout-prod/notificationChannels/1234567890
documentation:
  content: "Checkouts are returning a sustained 5xx ratio. Open the production dashboard, filter logs by checkout and current revision, then inspect traces for payment and storage spans."
  mimeType: "text/markdown"
conditions:
  - displayName: "5xx ratio above 5 percent"
    conditionThreshold:
      filter: 'metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.labels.service_name="checkout" AND resource.labels.location="us-central1" AND metric.labels.response_code_class="5xx"'
      denominatorFilter: 'metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.labels.service_name="checkout" AND resource.labels.location="us-central1"'
      comparison: COMPARISON_GT
      thresholdValue: 0.05
      duration: "300s"
      aggregations:
        - alignmentPeriod: "60s"
          perSeriesAligner: ALIGN_RATE
          crossSeriesReducer: REDUCE_SUM
      denominatorAggregations:
        - alignmentPeriod: "60s"
          perSeriesAligner: ALIGN_RATE
          crossSeriesReducer: REDUCE_SUM
```

- The numerator filter selects `5xx` request count for the service.
- The denominator filter selects all request count for the same service and region.
- `thresholdValue: 0.05` means 5 percent.
- `duration: "300s"` requires the condition to hold for five minutes.
- `ALIGN_RATE` turns delta request counts into rates, and `REDUCE_SUM` combines matching series.

Create the policy with:

```bash
gcloud monitoring policies create \
  --project=checkout-prod \
  --policy-from-file=checkout-5xx-policy.yaml
```

Example output:

```console
Created alert policy [projects/checkout-prod/alertPolicies/9876543210987654321].
```

Healthy output creates one policy with the expected display name and channel. Suspicious output can still say "Created" while the policy has the wrong filter, weak documentation, or a stale channel, so a reviewer should inspect the stored policy before trusting the page.


## How Do SLIs, SLOs, and Error Budgets Define Reliability?
<!-- section-summary: SLI, SLO, and error budget turn monitoring from raw thresholds into an explicit reliability target. -->

An **SLI**, or service level indicator, is the measurement of service health. For the checkout service, a simple availability SLI could be the percentage of `POST /checkouts` requests without `5xx`. A latency SLI could be the percentage of checkout requests that finish under two seconds for transactions within the supported checkout policy.

An **SLO**, or service level objective, gives the SLI a target over a time window. The team might say that 99.9 percent of production checkout requests  should succeed over 30 days. The size condition matters because a unsupported payment flow should not quietly distort the reliability target for normal ordinary orders.

An **error budget** is the amount of unreliability the service can spend while still meeting the SLO. A 99.9 percent SLO allows 0.1 percent bad events in the window. The budget helps product and engineering talk clearly about risk. If the service is spending too much budget, reliability work moves ahead of risky feature releases.

| Reliability term | Upload example | Plain meaning |
|---|---|---|
| SLI | Percentage of checkout requests  without `5xx` | The measurement |
| SLO | 99.9 percent success over 30 days | The target |
| Error budget | 0.1 percent allowed bad events | The allowed miss |

SLOs should match user experience. CPU, memory, and queue depth are useful supporting signals. The SLO should describe the outcome users care about: the checkout finishes successfully and quickly enough for the product workflow.

The words **good** and **total** make the relationship concrete. An availability SLI divides good checkout requests by all eligible checkout requests. A latency SLI divides requests completed within the target by all eligible requests. The SLO then says how large that fraction should be over a calendar or rolling compliance period. The error budget is `1 - SLO`, expressed as an allowed fraction of bad events or bad time.

An SLO is not merely a stricter alert threshold. A short alert asks whether responders need to act now. An SLO asks whether the service kept its longer reliability promise. One incident may recover quickly yet spend a meaningful share of the monthly budget; another noisy metric may cross a local threshold without affecting the SLI at all.

In Cloud Monitoring, the team can create an SLO from the Services page, through the Monitoring API, or through infrastructure code that calls the same API. A request-based availability SLO for `checkout` has this kind of shape:

```json
{
  "displayName": "Upload availability - 99.9% over 30 days",
  "goal": 0.999,
  "rollingPeriod": "2592000s",
  "serviceLevelIndicator": {
    "requestBased": {
      "goodTotalRatio": {
        "goodServiceFilter": "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" resource.labels.service_name=\"checkout\" metric.labels.response_code_class!=\"5xx\"",
        "totalServiceFilter": "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" resource.labels.service_name=\"checkout\""
      }
    }
  }
}
```

- `goal: 0.999` is the 99.9 percent target.
- `rollingPeriod: 2592000s` is a 30-day rolling window.
- The good filter counts checkout requests that did not return `5xx`.
- The total filter counts all checkout requests in the same Cloud Run service.

After the SLO exists, the service details page should show the SLO status and remaining error budget. A healthy check says the service, SLI filters, and rolling window match the production service name. A suspicious check shows no data, a staging service name, or a denominator that includes unrelated routes.

## How Does Burn Rate Add Urgency?
<!-- section-summary: Burn rate measures how quickly the service is spending its error budget after the SLO and budget are defined. -->

**Burn rate** describes how fast the service is spending its error budget. If the checkout SLO allows a small number of bad requests across 30 days, a severe outage can spend that budget quickly. A slow partial failure can spend it quietly over several hours.

Burn-rate alerts usually use multiple windows. A short-window alert catches fast outages that need immediate response. A longer-window alert catches steady damage before the monthly target is missed. The key beginner idea is simple: burn rate turns "the graph is high" into "the service is using the reliability budget too quickly."

For `checkout`, a fast burn might come from a new revision returning `500` for many checkout requests. A slower burn might come from p95 latency staying above the SLO threshold for large parts of the day. Both cases deserve attention because both spend the reliability promise the team made.

Use burn-rate alerts as action rules, not just graph labels:

| Alert | Example windows | Rough threshold | Action |
|---|---|---|---|
| Fast burn page | 5 minutes and 1 hour | Both above about `14x` budget burn | Page the on-call, check release changes, and prepare rollback or traffic shift. |
| Sustained burn page | 30 minutes and 6 hours | Both above about `6x` budget burn | Page the service owner, inspect error groups and traces, and stop risky deploys. |
| Slow burn ticket | 2 hours and 24 hours | Above about `1x` to `3x` budget burn | Create a reliability ticket, inspect trends, and plan repair before the SLO window is missed. |

Those numbers are starting points, not universal law. A payments API, a checkout API, and an internal admin tool may choose different targets. The useful rule is that every burn-rate page should name a response: rollback, reduce traffic, disable the risky path, scale a bottleneck, or open a focused reliability fix.

Cloud Monitoring's SLO alert flow uses the SLO, a lookback duration, and a burn-rate threshold. The stored condition should be reviewable:

```yaml
displayName: Fast burn - checkout availability
condition:
  timeSeriesQuery:
    timeSeriesFilter:
      filter: select_slo_burn_rate("projects/checkout-prod/services/checkout/serviceLevelObjectives/checkout-availability-999")
      aggregation:
        alignmentPeriod: 300s
  thresholdValue: 14
  duration: 300s
notificationChannels:
- projects/checkout-prod/notificationChannels/oncall-checkout
```

- `select_slo_burn_rate` pulls the burn-rate time series for the SLO.
- `thresholdValue: 14` means the alert fires for budget burn much faster than planned.
- `duration: 300s` keeps the fast alert from firing on a single brief sample.

After creating the alert policy through the console, Terraform, or the Monitoring API, describe it and confirm the SLO selector, threshold, and duration:

```bash
gcloud alpha monitoring policies describe ALERT_POLICY_ID \
  --project=checkout-prod \
  --format="yaml(displayName,conditions,notificationChannels,enabled)"
```

Example output:

```yaml
displayName: Fast burn - checkout availability
enabled: true
conditions:
- displayName: Fast burn - checkout availability
  conditionThreshold:
    filter: select_slo_burn_rate("projects/checkout-prod/services/checkout/serviceLevelObjectives/checkout-availability-999")
    aggregations:
    - alignmentPeriod: 300s
    duration: 300s
    thresholdValue: 14.0
notificationChannels:
- projects/checkout-prod/notificationChannels/oncall-checkout
```

The lookback window and the alert duration should match the response you want. A short burn-rate page should react quickly to sharp user impact. A longer burn-rate page should avoid paging for one noisy minute while still catching steady damage. Review these windows with the SLO target and compliance period so the alert does not page too late or page on noise.

An alert needs a full lifecycle test. Generate a safe test condition or use a controlled test channel, confirm that Monitoring opens an incident after the intended duration, verify that the correct receiver gets the notification and documentation, and then confirm the incident closes when the condition recovers. A policy that exists in configuration but never reaches its owner is not operational protection. Record who owns the policy, which service objective or symptom it protects, and when its threshold and runbook were last reviewed.

Silence is also ambiguous. No page can mean the service is healthy, the filter matches no series, the metric stopped reporting, traffic disappeared, or the channel failed. Pair critical symptom alerts with volume or telemetry-absence checks where appropriate, and make the dashboard show whether the underlying series are present. This prevents a broken measurement path from masquerading as a healthy service.


## How Do Prometheus and Outside-In Checks Fit?
<!-- section-summary: Prometheus metrics and outside-in checks cover gaps that built-in Google Cloud metrics may miss. -->

Many production teams already expose Prometheus-style metrics from applications, Kubernetes workloads, or OpenTelemetry instrumentation. Google Cloud Managed Service for Prometheus can collect Prometheus metrics and lets teams query them through Cloud Monitoring with PromQL. This is useful for services that already emit metrics such as `http.server.request.duration`, queue worker counts, payment authorization duration, and custom checkout success counters.

This complements built-in GCP telemetry instead of replacing it. Managed Service for Prometheus is useful when Kubernetes workloads, portable libraries, or existing dashboards already speak the Prometheus model. Cloud Monitoring can display and alert on those metrics alongside Google Cloud service metrics. **Exemplars** can attach representative trace references to distribution samples, giving a responder a path from a latency point to a request trace.

Prometheus labels need the same discipline as Cloud Monitoring labels. Labels such as `service`, `environment`, `route`, `status_class`, and `operation` work well. Labels such as raw user ID, order ID, raw request ID, or full URL with IDs can create high-cardinality series and make the system expensive or noisy.

For a Prometheus-style checkout failure ratio, the query can stay close to the application metric:

```promql
sum(rate(checkout_requests_total{service="checkout",environment="prod",route="/checkouts",status_class=~"5.."}[5m]))
/
sum(rate(checkout_requests_total{service="checkout",environment="prod",route="/checkouts"}[5m]))
```

Example query output:

```console
TIME                   VALUE
2026-06-14T14:10:00Z   0.031
2026-06-14T14:15:00Z   0.028
```

- `0.031` means about 3.1 percent of checkout requests returned `5xx` during that five-minute window.
- The numerator and denominator use the same service, environment, and route labels, so the ratio compares the same traffic slice.
- If the denominator is near zero, the graph can spike without real user impact. Pair it with request volume before paging.

An **uptime check** or synthetic check tests the public path from outside the service. A simple uptime check is enough for a safe `GET /healthz` endpoint. A synthetic monitor is better for tests that need a small script, such as submitting a test purchase, checking the response, and reversing the test transaction. This catches DNS, TLS, routing, authentication, and end-to-end app failures that internal service metrics may miss.

This is **black-box monitoring**: observe the service from the outside without trusting its internal explanation. Platform and application metrics are **white-box monitoring** because they expose internal behavior such as saturation, queueing, errors, and dependency timing. Both are necessary. A service can report healthy internal metrics while DNS or TLS prevents customers from reaching it, and an outside check can fail without revealing whether the cause is routing, authentication, code, or a dependency.

For organizations with several projects, a **metrics scope** controls which projects a scoping project can query. This lets a central operations project view time series from multiple monitored projects without moving those series into one project. The scope affects visibility, not resource ownership. A missing project in a dashboard can therefore be a metrics-scope problem rather than missing telemetry.

A basic uptime-check review shape can look like this:

```yaml
displayName: checkout public smoke check
period: 300s
timeout: 10s
selectedRegions:
- USA
- EUROPE
httpCheck:
  requestMethod: POST
  path: /health/checkout-smoke
  acceptedResponseStatusCodes:
  - statusClass: STATUS_CLASS_2XX
contentMatchers:
- matcher: CONTAINS_STRING
  content: checkout-smoke-ok
```

Useful output should show both status and latency:

```console
CHECK                              REGION   STATUS   LATENCY_MS
checkout public smoke check USA      PASS     342
checkout public smoke check EUROPE   PASS     511
```

- `PASS` from outside Google Cloud's internal service path proves DNS, TLS, routing, auth, app code, and the smoke endpoint all worked.
- A regional failure points at edge, routing, or dependency behavior that internal Cloud Run metrics might not reveal.
- A passing synthetic check with failing user checkouts can mean the smoke test is too shallow or does not cover the failing payment provider.
- For a current Google Cloud synthetic monitor, keep the monitor name, script location, execution region, linked Cloud Run function, and recent execution result with the runbook. For a simpler uptime check, keep the target URL, regions, expected status, content matcher, and latest pass/fail rows.

A scripted synthetic-monitor evidence record should name the script and its execution path:

```console
MONITOR                         REGION   LINKED_RUNTIME                         LAST_RUN_STATUS  LATENCY_MS
checkout-scripted-smoke     us-east1  cloud-run-function/checkout-smoke-prod   PASS             914
checkout-scripted-smoke     europe-west1 cloud-run-function/checkout-smoke-prod PASS            1088
```

This proves a script ran from outside the service path and finished successfully. Keep the script source, test order prefix, cleanup behavior, linked runtime, region list, and last run result in the runbook so the monitor can be reviewed like production code.

## How Does Cloud Monitoring Support One Incident?

### How Does the Model Map to AWS?
<!-- section-summary: AWS has similar metric and alerting jobs, while GCP has integrated Cloud Monitoring SLO tooling and Google Cloud resource labels. -->

If you know AWS, Cloud Monitoring maps to much of the CloudWatch metrics, alarms, and dashboards workflow. Notification channels and alert policies fill the job of routing alarms to people or automation. Prometheus support in Google Cloud plays a similar role to Prometheus-compatible workflows you may run around EKS, Amazon Managed Service for Prometheus, or self-managed Prometheus.

The GCP detail to watch is the metric model around monitored resources. A Cloud Run metric is not just a number; it is tied to a monitored resource type and resource labels such as project, location, service, and revision. GCP service monitoring also gives first-party SLO concepts, so SLI, SLO, error budget, and burn-rate workflows can live close to the same monitoring system that stores the metrics.

AWS Application Signals and CloudWatch Synthetics can cover similar service-health and outside-in check jobs. The practical bridge is to ask the same production questions in both clouds: what user outcome is failing, what metric proves it, which alert should page, which dashboard supports triage, and which SLO shows reliability risk?

### What Is the Complete Monitoring Model?
<!-- section-summary: Cloud Monitoring turns telemetry into scope, response, reliability targets, and recovery proof. -->

Cloud Monitoring turns the checkout incident into numbers the team can act on. Time series show that `5xx` rate and p95 latency rose after release `2026-06-14.3`. A dashboard shows user impact first, then Cloud Run health, dependencies, and change context. An alert policy pages on sustained user impact. SLOs and burn rate show whether the service is spending its reliability budget too quickly.

Logs explain the exact event. Traces show the request path. Audit logs show production changes. Metrics, dashboards, alert policies, and SLOs decide whether the team needs to act and whether the fix worked.

The incident loop closes with comparison. First confirm a user-facing symptom using availability, latency, and volume. Split by region, service, revision, or response class without creating high-cardinality noise. Use dependency and saturation metrics to form a hypothesis, then consult logs and traces for request-level evidence. After rollback or repair, use the same filters and windows to show that error rate, latency, and burn rate returned to their normal ranges. Recovery is an observed state, not merely the moment a deployment command succeeded.

## Check Your Answers

:::expand[What Are Metrics and Time Series?]{kind="recap"}
A metric is a numeric measurement over time. A time series is one stream for a metric, monitored resource, and exact label set. A value has meaning only with its unit, interval, resource, labels, and the operation used to interpret it.
:::

:::expand[How Do Metric Types, Resources, and Labels Identify Data?]{kind="recap"}
The metric type says what was measured, the monitored resource says what kind of system produced it, and labels select a particular slice. Every additional label can multiply the series count, so stable dimensions belong in metrics while unique request and order identifiers belong in logs or traces.
:::

:::expand[How Do Metric Kinds, Distributions, and Aggregation Work?]{kind="recap"}
Gauges represent current values, cumulative metrics grow from a start time, and delta metrics report interval changes. Distributions preserve a spread that can expose tail latency. Filters choose series, alignment makes their windows comparable, and reducers combine them without discarding needed distinctions too early.
:::

:::expand[How Do Dashboards and Alerts Turn Data Into Action?]{kind="recap"}
A dashboard organizes user impact, service health, dependencies, and change context for human investigation. An alert evaluates a bounded condition for a duration and routes an incident to someone who can act. Units, aggregation, volume, scope, documentation, and notification delivery all need verification.
:::

:::expand[How Do SLIs, SLOs, and Error Budgets Define Reliability?]{kind="recap"}
An SLI measures a user outcome, an SLO gives that measurement a target and compliance window, and the error budget is the allowed miss. These concepts express the service's reliability promise; supporting CPU or queue metrics help explain it but do not replace it.
:::

:::expand[How Does Burn Rate Add Urgency?]{kind="recap"}
Burn rate measures how quickly current failures consume the error budget. Short and long windows distinguish a fast outage from sustained damage. Thresholds should connect to explicit actions such as paging, rollback, traffic reduction, deploy freeze, or a planned reliability repair.
:::

:::expand[How Do Prometheus and Outside-In Checks Fit?]{kind="recap"}
Managed Service for Prometheus brings portable Prometheus metrics and PromQL into Cloud Monitoring. Uptime and synthetic checks test the path from outside, while white-box metrics explain internal state. Metrics scopes let a central project view series from multiple monitored projects without transferring ownership.
:::

:::expand[How Does Cloud Monitoring Support One Incident?]{kind="recap"}
Begin with user outcome, latency, and volume; split the symptom by low-cardinality dimensions; then use supporting metrics, logs, traces, and audit evidence to test a cause. After mitigation, query the same signals to prove recovery and confirm that reliability-budget consumption has slowed.
:::

## References

- [Cloud Monitoring documentation](https://docs.cloud.google.com/monitoring) - Official documentation for metrics, dashboards, alerts, uptime checks, SLOs, PromQL, and monitoring APIs.
- [Metrics, time series, and resources](https://docs.cloud.google.com/monitoring/api/v3/metrics) - Explains the Cloud Monitoring metric model.
- [Structure of time series](https://docs.cloud.google.com/monitoring/api/v3/metrics-details) - Documents metric, resource, point, interval, and value structure.
- [Components of the metric model](https://docs.cloud.google.com/monitoring/api/v3/metric-model) - Documents metric labels, resource labels, and cardinality.
- [Alerting overview](https://docs.cloud.google.com/monitoring/alerts) - Documents alerting policies, incidents, notification channels, and alert evaluation.
- [Service monitoring concepts](https://docs.cloud.google.com/stackdriver/docs/solutions/slo-monitoring) - Documents services, SLIs, SLOs, error budgets, and burn-rate alerting.
- [Creating an SLO](https://docs.cloud.google.com/stackdriver/docs/solutions/slo-monitoring/ui/create-slo) - Documents Cloud Monitoring SLO creation from service metrics.
- [Alerting on your burn rate](https://docs.cloud.google.com/stackdriver/docs/solutions/slo-monitoring/alerting-on-budget-burn-rate) - Documents burn-rate alert policies and `select_slo_burn_rate`.
- [Create a synthetic monitor](https://docs.cloud.google.com/monitoring/synthetic-monitors/create) - Documents synthetic monitors and their test-result signals.
- [Cloud Run monitoring](https://cloud.google.com/run/docs/monitoring) - Documents Cloud Run metrics and monitoring workflows.
- [Managed Service for Prometheus](https://docs.cloud.google.com/stackdriver/docs/managed-prometheus) - Documents managed Prometheus collection and querying on Google Cloud.
- [PromQL for Cloud Monitoring](https://docs.cloud.google.com/monitoring/promql) - Documents PromQL support in Cloud Monitoring and Managed Service for Prometheus workflows.
