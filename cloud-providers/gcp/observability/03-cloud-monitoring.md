---
title: "Cloud Monitoring"
description: "Turn GCP metrics into useful dashboards, alert policies, SLOs, uptime checks, and incident response loops."
overview: "Cloud Monitoring stores numerical telemetry as time series, then uses dashboards, alert policies, notification channels, SLOs, and Prometheus-compatible workflows to help teams catch production symptoms and verify recovery."
tags: ["gcp", "observability", "monitoring", "alerting", "metrics", "slo"]
order: 3
id: article-cloud-providers-gcp-observability-cloud-monitoring
---

## Table of Contents

1. [The Alert That Starts The Response](#the-alert-that-starts-the-response)
2. [What A Time Series Contains](#what-a-time-series-contains)
3. [Cloud Run Metrics For Checkout](#cloud-run-metrics-for-checkout)
4. [Dashboards That Support Triage](#dashboards-that-support-triage)
5. [Alert Policies, Conditions, And Notification Channels](#alert-policies-conditions-and-notification-channels)
6. [Error Rate As A Ratio](#error-rate-as-a-ratio)
7. [SLOs, SLIs, Error Budgets, And Burn Rate](#slos-slis-error-budgets-and-burn-rate)
8. [Uptime Checks, Synthetic Checks, And Prometheus Metrics](#uptime-checks-synthetic-checks-and-prometheus-metrics)
9. [Operating The Monitoring Setup](#operating-the-monitoring-setup)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Alert That Starts The Response
<!-- section-summary: Cloud Monitoring turns raw metric streams into charts and alert decisions that start incident response. -->

In the previous article, logs explained the exact `checkout-api` error. Cloud Monitoring answers the question that usually starts the response: how big is the symptom, and does someone need to act now?

**Cloud Monitoring** is Google Cloud's service for metric storage, charts, dashboards, alerting, uptime checks, SLOs, and related service health workflows. It stores numerical telemetry as **time series**. A time series is a sequence of measured values over time, such as Cloud Run request count, HTTP `5xx` count, p95 latency, instance count, CPU utilization, memory utilization, Pub/Sub backlog, or Cloud SQL connections.

For the checkout incident, the first useful page should come from a user-facing symptom. Customers care that checkout fails or takes too long, and container CPU matters when that pressure hurts the checkout outcome. The strongest first alert watches sustained `5xx` rate, latency, or checkout completion drop, then lets the responder use lower-level metrics to find the cause.

This article keeps using `checkout-api` in project `shop-prod` and region `us-central1`. The goal is to turn the raw platform metrics into a monitoring setup that pages only when production needs attention, gives the on-call engineer a helpful dashboard, and proves that a rollback or fix worked.

## What A Time Series Contains
<!-- section-summary: A metric point only makes sense with its metric type, resource type, labels, value, and time interval. -->

A **metric** is the thing being measured. In Google Cloud, metric types have names such as `run.googleapis.com/request_count` for Cloud Run requests. Metric labels add detail about the measurement, such as response code class. The metric value is the number recorded for a specific interval.

A **monitored resource** is the Google Cloud resource that produced the metric. Cloud Run revision metrics use the `cloud_run_revision` monitored resource. Resource labels then tell Cloud Monitoring which project, location, service, revision, and configuration the data point belongs to.

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
      "project_id": "shop-prod",
      "location": "us-central1",
      "service_name": "checkout-api",
      "revision_name": "checkout-api-00042-n9p",
      "configuration_name": "checkout-api"
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

The value `42` means very little by itself. The envelope says those are Cloud Run requests, from `checkout-api`, on revision `checkout-api-00042-n9p`, in `us-central1`, with response code class `5xx`, during one one-minute interval. That structure is what lets dashboards and alert policies ask precise questions.

![Infographic showing a Cloud Monitoring data point surrounded by metric type, resource type, service, region, revision, response code class, interval, and healthy versus suspicious interpretation.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-monitoring/time-series-context.png)
*A metric value needs its envelope. The same number can mean very different things depending on the service, revision, response class, and time interval.*

The Monitoring API can return this shape directly. A responder might use the API when debugging an alert rule or proving that a filter selects the expected series:

```bash
FILTER='metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.labels.service_name="checkout-api"'

curl -G \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  --data-urlencode "filter=${FILTER}" \
  --data-urlencode "interval.startTime=2026-06-14T14:00:00Z" \
  --data-urlencode "interval.endTime=2026-06-14T14:10:00Z" \
  "https://monitoring.googleapis.com/v3/projects/shop-prod/timeSeries"
```

This command mainly helps while debugging filters because it shows the same data model that dashboards, alert policies, SLOs, and API clients use underneath. `-G` sends the values as query parameters, `--data-urlencode` protects the Monitoring filter syntax, and the bearer token uses the current `gcloud` identity.

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
          "service_name": "checkout-api",
          "revision_name": "checkout-api-00042-n9p",
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

Healthy output for a stable period shows mostly `2xx` points and low or absent `5xx` values. Suspicious output shows a growing `5xx` series for the new revision during the same window where logs show `provider_timeout`.

## Cloud Run Metrics For Checkout
<!-- section-summary: Cloud Run request, latency, instance, CPU, and memory metrics give the first operating view for a serverless service. -->

Cloud Run publishes useful metrics into Cloud Monitoring. For the checkout incident, the most important one is `run.googleapis.com/request_count`. It is a delta metric that counts requests reaching the revision and includes labels for response code and response code class. The response code class label makes it possible to separate `2xx`, `4xx`, and `5xx` traffic.

Latency matters right next to errors. A service can return HTTP `200` while taking eight seconds to respond, and customers still experience a broken checkout. Cloud Run request latency metrics can show percentiles such as p50, p95, and p99. The p95 value often works well for alerting because it focuses on slow common user experience without letting one strange outlier dominate the page.

Instance count, CPU, and memory explain pressure after the user-facing symptom is visible. If `5xx` rises while instance count is pinned at the maximum, the service might need scaling or dependency relief. If memory climbs until instances crash, the app might have a leak. If CPU stays calm while errors rise, the cause might live in a dependency, configuration, IAM, or code path rather than raw compute capacity.

The dashboard should also include dependency metrics. A checkout service usually depends on Cloud SQL, Pub/Sub, Secret Manager, external payment APIs, and sometimes GKE or another Cloud Run service. Cloud Monitoring can show Google Cloud resource metrics directly, and application metrics can add business signals such as `checkout_attempts`, `checkout_successes`, `payment_timeouts`, and `receipt_publish_failures`.

| Metric layer | Example signal | Incident question |
|---|---|---|
| User outcome | Completed checkouts per minute | Are customers finishing the flow? |
| API symptom | Cloud Run `5xx` rate and p95 latency | Is checkout failing or slow? |
| Runtime pressure | Instance count, CPU, memory | Is the service resource constrained? |
| Dependency health | Cloud SQL latency, Pub/Sub backlog | Which downstream system is under pressure? |
| Release context | Revision and deployment marker | Did the symptom start after a rollout? |

This order matters because it starts with the customer. A responder should know the user impact before diving into CPU, memory, or queue graphs.

## Dashboards That Support Triage
<!-- section-summary: A useful dashboard puts customer impact first, then shows runtime, dependencies, releases, and links to deeper evidence. -->

A **dashboard** is a shared view of metrics, logs, incidents, SLOs, and other operational context. The dashboard should help the on-call engineer start the incident with a small number of high-signal widgets. For `checkout-api`, that means the top row should show user-facing health.

A practical dashboard layout could look like this:

| Dashboard row | Widgets |
|---|---|
| Customer impact | Completed checkouts, checkout success rate, p95 latency, `5xx` rate |
| Cloud Run service | Request count, response code class split, active instances, CPU, memory |
| Dependencies | Cloud SQL latency and connections, Pub/Sub oldest unacked message age, payment timeout count |
| Release and change | Current revision, recent deployment annotations, related audit log link |
| Investigation shortcuts | Logs query link, trace query link, Error Reporting group link, runbook link |

The row order gives the responder a natural path. First the team sees whether customers are hurt. Then the team sees whether the Cloud Run service has pressure. Then the team sees whether a dependency lines up with the symptom. Then the team sees whether a recent change is involved.

Dashboards also need stable filters. If every chart uses a different service label or region filter, the responder has to translate chart by chart. The same service name, environment, project, region, and release naming should appear across dashboards, logs, metrics, traces, and alert documentation.

Dashboards and alerts have different jobs. A dashboard helps humans triage when they are looking. An alert policy decides when telemetry requires attention and sends that signal to the right place.

![Infographic showing a checkout-api dashboard ordered by customer impact, service health, dependencies, and change context.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-monitoring/dashboard-response-order.png)
*The dashboard order should match the responder's path. Start with customer impact, then inspect service health, dependencies, and recent changes.*

## Alert Policies, Conditions, And Notification Channels
<!-- section-summary: Alert policies evaluate metric or query conditions and route incidents through notification channels. -->

An **alerting policy** is a rule that Cloud Monitoring evaluates against telemetry. A policy contains one or more conditions, a combiner that says how conditions relate, documentation, severity or labels, and notification channels. When a condition stays true for the configured duration, Cloud Monitoring opens an incident and sends notifications through the configured channels.

A **condition** is the actual check. It might say that `5xx` rate is above 5 percent for five minutes, p95 latency is above two seconds for ten minutes, or Pub/Sub oldest unacked message age is above the team's recovery threshold. The duration matters because a one-minute spike might be normal, while a sustained spike means customers are likely affected.

A **notification channel** is the route from monitoring to people or automation. It can be email, chat, PagerDuty, webhooks, Pub/Sub, or another supported target. A production alert should include enough documentation for the responder to start well: what the alert means, what service owns it, which dashboard to open, which log query to run, and what rollback or mitigation paths are approved.

Before creating the alert policy, the team needs a notification channel. In many production teams this is managed by Terraform, but a small YAML example shows the fields Cloud Monitoring expects:

```yaml
type: email
displayName: "checkout on-call email"
labels:
  email_address: checkout-oncall@example.com
enabled: true
```

The `type` selects the channel kind, `displayName` gives humans a readable target, `labels.email_address` is the email destination for this example, and `enabled` controls whether Cloud Monitoring can use the channel. A production PagerDuty, webhook, Pub/Sub, or chat channel has different labels, but the same review question applies: will this alert reach the responder who owns `checkout-api`?

```bash
gcloud monitoring channels create \
  --project=shop-prod \
  --channel-content-from-file=checkout-oncall-channel.yaml
```

Expected output gives the channel resource name that the alert policy references:

```console
Created notification channel [projects/shop-prod/notificationChannels/1234567890].
```

Healthy setup output creates a channel in the production project and the team tests that notifications reach the on-call path. Suspicious setup is a disabled channel, a stale email list, or a channel in a different project than the alert policy expects.

Here is the creation command for a policy stored in a YAML file:

```bash
gcloud monitoring policies create \
  --project=shop-prod \
  --policy-from-file=checkout-5xx-policy.yaml
```

That command matters because alert policies should be treated like production configuration. Many teams manage them through Terraform or another infrastructure-as-code workflow, but the YAML shape is still useful for learning the fields that Cloud Monitoring evaluates. `--policy-from-file` points at the reviewed policy document, and `--project` decides where the policy lives.

```console
Created alert policy [projects/shop-prod/alertPolicies/9876543210987654321].
```

Healthy output creates one policy with the expected display name and channel. Suspicious output can still say "Created" while the policy has the wrong filter, wrong notification channel, or weak documentation, so a reviewer should inspect the stored policy before trusting the page.

## Error Rate As A Ratio
<!-- section-summary: A ratio alert compares failed requests to total requests, which keeps alerting tied to customer impact instead of raw volume. -->

Raw error count is useful, but it can page at the wrong time. Ten `5xx` responses might be a disaster if the service only had twelve requests. Ten `5xx` responses might be a small blip if the service had one hundred thousand requests. **Error rate** compares failed requests with total requests, so the alert follows the share of users affected.

Cloud Monitoring threshold conditions can use a numerator filter and a denominator filter. The numerator selects the failed request series. The denominator selects all request series for the same service. The policy below watches `checkout-api` in `us-central1` and opens an incident when the `5xx` ratio stays above 5 percent for five minutes:

```yaml
displayName: "checkout-api high 5xx rate"
combiner: OR
enabled: true
notificationChannels:
  - projects/shop-prod/notificationChannels/1234567890
documentation:
  content: "Checkout is returning a sustained 5xx ratio. First response path: production dashboard, logs filtered by checkout-api and the current revision, then recent Cloud Run audit logs before rollback."
  mimeType: "text/markdown"
conditions:
  - displayName: "5xx ratio above 5 percent"
    conditionThreshold:
      filter: 'metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.labels.service_name="checkout-api" AND resource.labels.location="us-central1" AND metric.labels.response_code_class="5xx"'
      denominatorFilter: 'metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND resource.labels.service_name="checkout-api" AND resource.labels.location="us-central1"'
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

The `alignmentPeriod` groups incoming points into one-minute intervals. The `ALIGN_RATE` aligner turns delta request counts into a per-second rate. The `REDUCE_SUM` reducer combines the matching series, such as multiple revisions during a rollout, into one value for the service. The numerator and denominator use the same resource filters so the ratio compares the same service and region.

![Infographic showing a Cloud Monitoring alert policy flow from metric filter and denominator through a ratio condition, incident, notification channel, and runbook.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-monitoring/alert-ratio-policy.png)
*A useful page has a clear signal and a clear next step. The ratio compares failed checkout requests with all checkout requests, then routes the incident to the team that can act.*

This policy still needs production tuning. A low-traffic service might need a minimum request volume condition so one failed request stays out of high-priority paging. A very critical service might need a lower threshold or a shorter duration. The right threshold comes from the service's reliability target, traffic pattern, and incident response expectations.

The same policy belongs naturally in Terraform when the team manages monitoring as reviewed infrastructure:

```hcl
resource "google_monitoring_alert_policy" "checkout_5xx_ratio" {
  project      = var.project_id
  display_name = "checkout-api high 5xx rate"
  combiner     = "OR"
  enabled      = true

  notification_channels = [
    google_monitoring_notification_channel.oncall.name
  ]

  documentation {
    content   = "Checkout is returning a sustained 5xx ratio. Open the production dashboard, filter logs by checkout-api and the current revision, then check recent Cloud Run audit logs before rollback."
    mime_type = "text/markdown"
  }

  conditions {
    display_name = "5xx ratio above 5 percent"

    condition_threshold {
      filter             = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"checkout-api\" AND resource.labels.location=\"us-central1\" AND metric.labels.response_code_class=\"5xx\""
      denominator_filter = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"checkout-api\" AND resource.labels.location=\"us-central1\""
      comparison         = "COMPARISON_GT"
      threshold_value    = 0.05
      duration           = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }

      denominator_aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}
```

The Terraform version makes alert review part of the same change process as Cloud Run, IAM, and networking. A reviewer can see the metric filter, denominator filter, duration, threshold, notification channel, and runbook text before the alert starts paging people.

A Terraform plan should show a new alert policy with the intended fields before anyone applies it:

```console
  # google_monitoring_alert_policy.checkout_5xx_ratio will be created
  + resource "google_monitoring_alert_policy" "checkout_5xx_ratio" {
      + display_name          = "checkout-api high 5xx rate"
      + enabled               = true
      + notification_channels = [
          + "projects/shop-prod/notificationChannels/1234567890",
        ]

      + conditions {
          + display_name = "5xx ratio above 5 percent"
        }
    }
```

Healthy plan output names the expected production project, the expected notification channel, and the expected condition. Suspicious plan output changes a shared channel, removes documentation, or points the filter at the wrong service or region.

## SLOs, SLIs, Error Budgets, And Burn Rate
<!-- section-summary: SLO monitoring turns service health into explicit reliability targets and uses burn rate to page when the target is being spent too quickly. -->

After the first alert set works, teams usually want a clearer reliability target. A **service level indicator**, or **SLI**, is the measurement of service health. For checkout, a simple availability SLI could be the percentage of `POST /checkout` requests without `5xx`. A latency SLI could be the percentage of checkout requests that finish under two seconds.

A **service level objective**, or **SLO**, gives the SLI a target over a time window. For example, the team might set an objective that 99.9 percent of production checkout requests should succeed over 30 days. That target creates an **error budget**, which is the amount of unreliability the service can spend while still meeting the objective.

Burn rate describes how fast the service is spending that error budget. A high burn rate means the service is consuming its monthly budget too quickly. Burn-rate alerts are useful because they page on reliability risk instead of one instant threshold. A short-window burn-rate alert catches fast outages, while a long-window burn-rate alert catches slow damage that might miss a simple spike alert.

For `checkout-api`, the team might start with two SLOs:

| SLO | SLI idea | Why it matters |
|---|---|---|
| Availability | Good events are checkout requests without `5xx` | Customers need payment submission to work |
| Latency | Good events finish under two seconds | Slow checkout can still lose orders |

SLOs should use signals that match user experience. A CPU SLO describes resource pressure, while a checkout SLO should describe the service behavior that users care about. CPU can support diagnosis, and the reliability target should stay tied to checkout success or latency.

![Infographic showing an SLI, SLO, error budget, fast burn, and slow burn for checkout-api reliability.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-monitoring/slo-burn-rate.png)
*SLOs give the incident a reliability target. A fast burn needs immediate response, while a slower burn still needs investigation before the monthly target is missed.*

## Uptime Checks, Synthetic Checks, And Prometheus Metrics
<!-- section-summary: Outside-in checks and Prometheus-style metrics cover gaps that built-in service metrics miss. -->

Cloud Run metrics show requests that reach the service. An **uptime check** or **synthetic monitor** can test the public path from outside the service. That matters when the failure is DNS, TLS, routing, authentication, a load balancer, or a dependency path that normal internal metrics miss.

For checkout, a safe synthetic check should avoid charging real payment cards or creating real orders. It might call a health endpoint that validates the service can reach required dependencies, or it might run a test checkout path against a sandbox payment provider and a clearly marked test tenant. The check should create enough evidence to catch public route failure without creating noisy business data.

Many production teams also use Prometheus-style metrics. Google Cloud Managed Service for Prometheus can collect Prometheus metrics and lets teams use PromQL in Cloud Monitoring. This is especially useful for GKE, hybrid environments, or applications that already expose OpenTelemetry or Prometheus metrics such as `http.server.request.duration`, queue worker counts, and custom business metrics.

Prometheus metrics need the same label discipline as Cloud Monitoring metrics. Labels like `service`, `environment`, `route`, `status_class`, and `dependency` work well. Labels like `user_id`, `checkout_id`, full URL paths with IDs, or request IDs create high-cardinality series and can make dashboards expensive, slow, and hard to read.

## Operating The Monitoring Setup
<!-- section-summary: Monitoring stays useful when teams tune noise, test notifications, document response, and review alerts after incidents. -->

A monitoring setup continues after the policy is created. The team has to operate it. That means testing notification channels, checking that runbook links still work, tuning noisy thresholds, and making sure every alert has a clear owner.

Every high-priority alert should answer five questions in its documentation. What user symptom does this represent? Which dashboard should the responder open first? Which log or trace query starts the investigation? Which rollback, scaling, or mitigation actions are allowed? Which team owns follow-up work after the incident?

After the checkout incident, the team should review the monitoring path. If customers reported the failure before Cloud Monitoring paged, the alert was too weak or the signal was missing. If the page fired and the dashboard left the team confused, the dashboard needs better context. If five alerts fired for one symptom, the team should choose the one high-signal page and demote the rest to dashboard or ticket-level visibility.

Cost and cardinality also need routine review. A new custom metric with too many labels can create thousands of series. A log-based metric based on a renamed field can silently stop matching. A dashboard with old revision filters can drift out of date. Small monitoring reviews after incidents keep the system trustworthy.

## Putting It All Together
<!-- section-summary: Cloud Monitoring turns telemetry into scope, response, reliability targets, and recovery proof. -->

For `checkout-api`, Cloud Monitoring gives the team the operational loop around the logs and traces. Time series show that `5xx` rate jumped after release `2026-06-14.3`. A dashboard shows customer impact, Cloud Run health, dependencies, and rollout context. An alert policy compares failed requests with total requests and pages only when the symptom is sustained. SLOs turn checkout reliability into a target, and burn-rate alerts show when the team is spending the error budget too quickly.

The best monitoring design starts with user impact, then gives the responder enough supporting evidence to find the cause. Logs explain the exact event. Traces show the request path. Audit logs show the change history. Metrics, dashboards, alert policies, and SLOs decide when the team needs to act and whether the fix worked.

## What's Next

The next article follows one failed checkout request through Cloud Trace and OpenTelemetry. We will look at trace context, spans, propagation, OpenTelemetry instrumentation, trace-to-log correlation, sampling, async handoff, and the practical checks that prove a request can be followed across services.

---

**References**

- [Cloud Monitoring documentation](https://docs.cloud.google.com/monitoring) - Covers metrics, dashboards, alerts, uptime checks, SLOs, PromQL, and monitoring APIs.
- [Structure of time series](https://docs.cloud.google.com/monitoring/api/v3/metrics-details) - Explains metric, resource, point, interval, and value structure.
- [Cloud Run monitoring](https://cloud.google.com/run/docs/monitoring) - Documents Cloud Run health and performance monitoring.
- [Google Cloud metrics list](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z) - Documents Cloud Run metric types such as `run.googleapis.com/request_count`.
- [Alerting overview](https://docs.cloud.google.com/monitoring/alerts) - Explains alerting policies, incidents, notification channels, and alert evaluation.
- [gcloud monitoring policies create](https://docs.cloud.google.com/sdk/gcloud/reference/monitoring/policies/create) - Documents creating alerting policies from JSON or YAML files.
- [Service monitoring concepts](https://docs.cloud.google.com/stackdriver/docs/solutions/slo-monitoring) - Explains services, SLIs, SLOs, error budgets, and burn-rate alerting.
- [PromQL for Cloud Monitoring](https://docs.cloud.google.com/monitoring/promql) - Documents PromQL support in Cloud Monitoring and Managed Service for Prometheus workflows.
- [Terraform Registry: google_monitoring_alert_policy](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) - Defines the Terraform alert policy resource, threshold conditions, aggregations, documentation, and notification channels.
