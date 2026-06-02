---
title: "Cloud Monitoring"
description: "Turn metrics into actionable dashboards and automated alerting policies to catch failures early."
overview: "No one can watch dashboards 24/7. This article explains how to query metrics and create symptom-based alerting policies using the gcloud CLI."
tags: ["gcp", "observability", "monitoring", "alerting", "metrics"]
order: 3
id: article-cloud-providers-gcp-observability-cloud-monitoring
---

Cloud Monitoring is the central metrics and alerting service for Google Cloud. It stores numerical telemetry as time series and can evaluate those series against alerting rules. When a high-traffic web service begins dropping customer requests, staring at a dashboard in real time is not a viable operational strategy. You need an automated check that tracks the error rate and notifies an engineer when the symptom crosses a dangerous limit.

## Table of Contents

- [Querying Raw Metrics](#querying-raw-metrics)
- [Defining an Alerting Policy](#defining-an-alerting-policy)
- [Applying the Policy](#applying-the-policy)
- [Symptoms Over Causes](#symptoms-over-causes)
- [Putting It All Together](#putting-it-all-together)
- [What's Next](#whats-next)

## Querying Raw Metrics

At its core, a metric is just a stream of numbers recorded over time, behaving much like a sensor writing down the outside temperature every sixty seconds. In Google Cloud, these continuous streams are called time series. Every managed service, from load balancers to serverless containers, asynchronously emits data points consisting of a timestamp and a numerical value into the central monitoring control plane.

To understand how this data is structured before we build alerts on top of it, we can query the Monitoring API directly. While Google Cloud provides graphical dashboards, fetching the raw data using a terminal session reveals the data model the platform uses for metrics. We will query the API for the number of HTTP requests hitting a Cloud Run service over a specific five-minute window.

```bash
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://monitoring.googleapis.com/v3/projects/my-prod-project/timeSeries?filter=metric.type=%22run.googleapis.com/request_count%22&interval.endTime=2023-10-24T12:00:00Z&interval.startTime=2023-10-24T11:55:00Z"
```

```json
{
  "timeSeries": [
    {
      "metric": {
        "labels": {
          "response_code": "500",
          "response_code_class": "5xx"
        },
        "type": "run.googleapis.com/request_count"
      },
      "resource": {
        "type": "cloud_run_revision",
        "labels": {
          "project_id": "my-prod-project",
          "location": "us-central1",
          "service_name": "checkout-api"
        }
      },
      "points": [
        {
          "interval": {
            "startTime": "2023-10-24T11:59:00Z",
            "endTime": "2023-10-24T12:00:00Z"
          },
          "value": {
            "int64Value": "14"
          }
        },
        {
          "interval": {
            "startTime": "2023-10-24T11:58:00Z",
            "endTime": "2023-10-24T11:59:00Z"
          },
          "value": {
            "int64Value": "2"
          }
        }
      ]
    }
  ]
}
```

The JSON response exposes the strict anatomy of a time series. The system does not just store bare numbers; it tags every data stream with metadata. The `metric` block describes exactly what was measured, identifying the data as a request count and using labels to specify that these particular numbers represent failed requests returning HTTP 500 status codes. The `resource` block identifies the physical or logical origin of the data, pinpointing the exact Cloud Run service and region that emitted the metrics.

The actual numerical data lives inside the `points` array. Notice that each point is not a single instantaneous timestamp, but rather a time interval with a defined start and end. Cloud Run integrates with Cloud Monitoring and exposes metrics under the `cloud_run_revision` monitored resource. In this output, fourteen HTTP 500 errors were reported for the one-minute window ending at 12:00:00Z.

## Defining an Alerting Policy

Querying metrics manually is useful for debugging, but an operational environment requires the platform to evaluate these streams automatically. An alerting policy is an automated metric check. You give it a specific metric query and a threshold rule, and the monitoring engine evaluates that rule in the background, opening an incident when the data breaks the rule.

We can define this automated check declaratively using a standard YAML configuration file. This policy will monitor the checkout service and trigger an alert if the rate of HTTP 5xx errors exceeds five percent of total traffic.

```yaml
displayName: "High 5xx Error Rate on Checkout API"
notificationChannels:
  - projects/my-prod-project/notificationChannels/1234567890
combiner: OR
conditions:
  - displayName: "HTTP 5xx rate exceeded 5%"
    conditionThreshold:
      filter: 'metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision" AND metric.labels.response_code_class="5xx"'
      comparison: COMPARISON_GT
      thresholdValue: 0.05
      duration: "120s"
      aggregations:
        - alignmentPeriod: "60s"
          crossSeriesReducer: REDUCE_SUM
          perSeriesAligner: ALIGN_RATE
      denominatorFilter: 'metric.type="run.googleapis.com/request_count" AND resource.type="cloud_run_revision"'
      denominatorAggregations:
        - alignmentPeriod: "60s"
          crossSeriesReducer: REDUCE_SUM
          perSeriesAligner: ALIGN_RATE
```

The `filter` explicitly limits the policy's view to only the time series representing failed server requests. Because data points arrive continuously and asynchronously from multiple container instances, the engine uses the `aggregations` block to normalize the streams. The `alignmentPeriod` mathematically snaps misaligned timestamps onto a strict sixty-second grid, while the `crossSeriesReducer` sums the values across all active instances of the checkout service to create a single global metric.

To calculate the error rate rather than an absolute error count, the policy uses a `denominatorFilter` to capture all requests regardless of status code. The monitoring engine divides the error rate by the total request rate, comparing the resulting fraction against the `thresholdValue` of `0.05` (five percent). Finally, the `duration` field dictates that this ratio must remain above five percent for at least two consecutive minutes. This prevents the monitoring control plane from waking up an engineer due to a single dropped network packet or a momentary capacity blip.

## Applying the Policy

With the policy defined on disk, we must push it into Cloud Monitoring. We do this using the Google Cloud command-line interface, passing the YAML file directly to the API.

```bash
gcloud monitoring policies create --policy-from-file=alert.yaml
```

```text
Created alerting policy [projects/my-prod-project/alertPolicies/867530912345678].
```

Once this command executes successfully, the policy becomes active. The Monitoring evaluation engine applies the configured aligners and reducers to incoming time series. If the resulting error rate breaches the five percent threshold for the required duration, the system opens an incident. Notifications are sent only when the policy has notification channels, such as the example channel in this YAML. Those channels can point to email, Slack, PagerDuty, webhooks, or other supported destinations.

## Symptoms Over Causes

A practical way to design an effective alerting strategy is to measure the actual user experience rather than the physical hardware. A user does not care if your container CPU is running at ninety-nine percent capacity. A user only cares if their checkout request fails or takes too long to process.

Alerting on error rate is evaluating a symptom, while alerting on CPU usage is evaluating a physical cause. If you build alerting policies based entirely on physical causes, you will suffer from both false positives and false negatives. A heavy background batch job might peg the CPU at maximum capacity for an hour without impacting a single user request, yet an aggressive CPU alert would trigger a severe incident response. Conversely, a deadlocked database connection could leave the application container idling at five percent CPU while completely failing to process any web traffic. A CPU-based alert would completely miss the outage.

By tying the alerting policy directly to the `request_count` metric and filtering for HTTP 5xx responses, the alert follows a user-visible symptom instead of a machine guess. The monitoring engine evaluates the application's output first, leaving the underlying CPU, memory, network, or database cause for the human investigation that follows.

## Putting It All Together

Operational visibility requires moving beyond raw data and building automated safety mechanisms.

- We fetched raw metrics directly from the Monitoring API using `curl` to observe how Google Cloud structures time-series data into timestamped aggregation buckets.
- We constructed a declarative alerting policy that mathematically compares error request rates against total request rates to accurately measure system failure.
- We deployed the policy into Cloud Monitoring using the `gcloud monitoring policies create` command, establishing a continuous automated check.
- We designed the threshold around a symptom rather than a physical cause, so the alert starts from user-visible failure before deeper diagnosis.

## What's Next

We now have an automated alerting policy that can open an incident when a web service returns a high volume of errors. However, knowing that the checkout endpoint is failing is only the first step in incident response. When a complex architecture involves load balancers, API gateways, application containers, and databases, how do we find out exactly which hop in the network is introducing the latency or throwing the error?

![Cloud Monitoring summary showing time series, metric labels, alignment, reduction, alert policy, and notification channel.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-monitoring/cloud-monitoring-summary.png)

*Cloud Monitoring turns time-series data into alert decisions by aligning points, reducing related series, evaluating a policy, and notifying a configured channel.*

---

**References**

- [Cloud Run Monitoring](https://cloud.google.com/run/docs/monitoring) - Explains Cloud Run metrics in Cloud Monitoring.
- [Google Cloud Metrics List](https://cloud.google.com/monitoring/api/metrics_gcp_p_z) - Documents Cloud Run metric types such as `run.googleapis.com/request_count`.
- [Cloud Monitoring Time Series](https://cloud.google.com/monitoring/api/v3/metrics-details) - Explains metric, resource, and point structure.
- [Cloud Monitoring Alerting](https://cloud.google.com/monitoring/alerts) - Explains alerting policies, incidents, and notification channels.
- [gcloud monitoring policies create](https://cloud.google.com/sdk/gcloud/reference/monitoring/policies/create) - Documents creating alerting policies from files.
