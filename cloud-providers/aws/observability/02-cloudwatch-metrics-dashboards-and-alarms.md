---
title: "CloudWatch Metrics, Dashboards, and Alarms"
description: "Design CloudWatch metrics, dimensions, dashboards, Metrics Insights queries, alarms, anomaly detection, and alert routes for AWS production workloads."
overview: "CloudWatch metrics turn production behavior into time-series numbers that can be graphed, queried, and alarmed on. This article follows a checkout service through metric design, dashboards, alarm evaluation, anomaly detection, composite alarms, recommended alarms, and cross-account operations."
tags: ["cloudwatch", "metrics", "dashboards", "alarms", "aws"]
order: 2
id: article-cloud-iac-observability-metrics-dashboards
aliases:
  - cloudwatch-metrics-dashboards-and-alarms
  - cloudwatch-metrics-alarms
  - cloud-iac/observability/metrics-dashboards.md
  - child-observability-metrics-dashboards
  - cloud-providers/aws/observability/metrics-dashboards.md
  - cloud-providers/aws/observability/cloudwatch-metrics-dashboards-and-alarms.md
  - cloud-providers/aws/observability/03-cloudwatch-metrics-alarms.md
  - cloud-providers/aws/observability/02-cloudwatch-metrics-dashboards-and-alarms.md
  - metrics-dashboards
---

## Table of Contents

1. [The First Metric Question](#the-first-metric-question)
2. [What a CloudWatch Metric Stores](#what-a-cloudwatch-metric-stores)
3. [Namespaces, Dimensions, Units, and Resolution](#namespaces-dimensions-units-and-resolution)
4. [Standard Metrics and Custom Metrics](#standard-metrics-and-custom-metrics)
5. [Publish Application Metrics Safely](#publish-application-metrics-safely)
6. [Query Fleets With Metrics Insights](#query-fleets-with-metrics-insights)
7. [Build Dashboards for Triage](#build-dashboards-for-triage)
8. [Alarms as State Machines](#alarms-as-state-machines)
9. [Thresholds, Missing Data, and Anomaly Detection](#thresholds-missing-data-and-anomaly-detection)
10. [Composite Alarms and Recommended Alarms](#composite-alarms-and-recommended-alarms)
11. [Cross-Account Operations](#cross-account-operations)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## The First Metric Question
<!-- section-summary: Metrics give the fast production overview that tells a team whether customers are affected and which part of the system is under pressure. -->

During an incident, logs can feel tempting because logs contain the exact error. The problem is timing. If a flash sale sends thousands of shoppers through checkout, the log stream might contain millions of events. Searching all of that first can burn the first ten minutes of the incident.

Metrics give the first shape of the problem. A **metric** is a number recorded over time. Instead of reading every checkout log event, you can look at completed checkouts per minute, p95 checkout latency, target 5xx errors from the load balancer, RDS database connections, and SQS queue age. In a few seconds, the team can see whether the issue affects all users, one service, one dependency, or one Region.

Let's keep using the same checkout service from the previous article. A customer clicks pay. The request enters an Application Load Balancer, reaches an ECS service, writes to RDS, calls a payment provider, and sends an SQS message for confirmation email. The most useful first metrics are the ones that answer these questions:

| Question | CloudWatch metric path |
|---|---|
| Are customers completing checkout? | Custom metric `CompletedCheckouts` |
| Is the API slow? | ALB `TargetResponseTime` with p95 statistic |
| Are backend tasks returning errors? | ALB `HTTPCode_Target_5XX_Count` |
| Are ECS tasks saturated? | ECS `CPUUtilization` and `MemoryUtilization` |
| Is the database under pressure? | RDS `DatabaseConnections`, CPU, write latency |
| Are background jobs delayed? | SQS `ApproximateAgeOfOldestMessage` |

That first view tells the team where to look next. If completed checkouts drop and ALB 5xx errors rise, the checkout API path needs attention. If completed checkouts are stable but SQS message age rises, customer payment might work while confirmation emails lag. Metrics make that difference visible.

## What a CloudWatch Metric Stores
<!-- section-summary: A CloudWatch metric is a named time-series made from datapoints, timestamps, optional units, and a stable identity. -->

In CloudWatch, a **metric** is a time-ordered set of datapoints. Each datapoint has a timestamp and a value. It can also have a unit such as `Count`, `Seconds`, `Milliseconds`, `Bytes`, or `Percent`. CloudWatch aggregates datapoints over a **period**, such as 60 seconds, and returns statistics such as average, sum, minimum, maximum, sample count, or percentile.

The identity of a metric has three main parts: **namespace**, **metric name**, and **dimensions**. A namespace groups related metrics. A metric name says what is being measured. Dimensions are name/value pairs that split one metric into useful series.

For example, the load balancer latency metric might look like this:

| Part | Example |
|---|---|
| Namespace | `AWS/ApplicationELB` |
| Metric name | `TargetResponseTime` |
| Dimension | `LoadBalancer=app/prod-checkout/50dc6c495c0c9188` |
| Statistic | `p95` |
| Period | `60` seconds |
| Unit | `Seconds` |

CloudWatch metrics exist in the Region where they are created. Metric data also rolls up over time. The highest-resolution recent data has shorter retention, and older data is stored at coarser resolution. This is one reason teams keep dashboards focused on recent triage and use longer windows for capacity planning.

CloudWatch cannot delete a metric directly. A metric stops appearing in normal metric lists after it stops receiving recent datapoints, and old datapoints expire on the CloudWatch retention schedule. That matters for naming. If a team accidentally publishes `CheckoutLatency` with a typo in the namespace, that mistaken metric can stay discoverable for a while even after the code is fixed.

![CloudWatch metric identity broken into namespace, metric name, dimensions, unit, and period](/content-assets/articles/article-cloud-iac-observability-metrics-dashboards/metric-identity.png)

*The visual shows why dimensions matter so much. The namespace and metric name start the address, but dimensions decide the exact time series CloudWatch stores and alarms on.*

## Namespaces, Dimensions, Units, and Resolution
<!-- section-summary: Metric identity choices control how CloudWatch stores, filters, aggregates, bills, and alarms on time-series data. -->

A **namespace** is the top-level container for metrics. AWS service namespaces usually use the `AWS/ServiceName` pattern, such as `AWS/EC2`, `AWS/Lambda`, `AWS/RDS`, `AWS/ECS`, and `AWS/ApplicationELB`. Custom application namespaces should be clear and stable, such as `DevPolaris/Checkout` or `Custom/Checkout`.

A **dimension** is a name/value pair that is part of the metric identity. CloudWatch supports up to 30 dimensions for a metric, but more dimensions do not automatically mean a better design. Every unique dimension combination creates a separate metric series. That is useful for `Environment=prod` and `Service=checkout-api`. It is dangerous for `requestId=req-7b91` because every request would create a new series.

This is the important design rule:

| Good metric dimension | Risky metric dimension |
|---|---|
| `Environment=prod` | `RequestId=req-7b91` |
| `Service=checkout-api` | `CustomerId=cust-882` |
| `Dependency=payment-provider` | `OrderId=order-1042` |
| `Route=POST /checkout` | `SessionId=sess-91a...` |

Low-cardinality dimensions have a small and predictable set of values. High-cardinality dimensions grow with users, requests, sessions, or orders. Put high-cardinality values in logs and traces. Keep metrics for stable operational coordinates.

**Resolution** controls how frequently datapoints are stored. Standard CloudWatch metrics have one-minute granularity. High-resolution custom metrics can be stored at one-second granularity and read at periods such as 1, 5, 10, or 30 seconds. High-resolution metrics can help for fast-moving workloads, but they cost more because each `PutMetricData` call and high-resolution alarm can add charges.

For our checkout service, one-minute metrics are enough for most dashboard and paging alarms. A high-resolution metric might make sense for a short-lived flash-sale admission gate where the system needs to react inside a minute. It would be wasteful for a daily invoice job.

## Standard Metrics and Custom Metrics
<!-- section-summary: AWS service metrics show infrastructure and managed-service health, while custom metrics show application and business outcomes. -->

AWS services publish many metrics automatically. That gives you a starting point before your application emits anything. The load balancer publishes request count, target response time, target errors, and healthy host count. ECS publishes CPU and memory utilization. RDS publishes CPU, connections, storage, I/O, and latency metrics. SQS publishes queue depth and message age.

Those standard service metrics show infrastructure and service behavior. They can tell you that the target group has 5xx errors or that the database has too many connections. They cannot tell you whether checkout completed, whether payment was declined by business rule, or whether a promotion code path produced empty orders. That evidence belongs in **custom metrics**.

A practical checkout metric set combines both:

| Metric type | Example | Why it matters |
|---|---|---|
| AWS service metric | ALB `TargetResponseTime` p95 | User-facing API latency |
| AWS service metric | ALB `HTTPCode_Target_5XX_Count` | Backend server errors |
| AWS service metric | ECS `CPUUtilization` | Compute saturation |
| AWS service metric | RDS `DatabaseConnections` | Connection pool pressure |
| AWS service metric | SQS `ApproximateAgeOfOldestMessage` | Async delay |
| Custom metric | `CompletedCheckouts` | Business outcome |
| Custom metric | `PaymentAuthorizationFailures` | Dependency and payment health |
| Custom metric | `CheckoutValidationFailures` | Product or input health |

For custom metrics, AWS now recommends OpenTelemetry for new implementations. OpenTelemetry gives richer labels and standard metric types, and CloudWatch can query OpenTelemetry metrics with PromQL. The CloudWatch API and AWS CLI still matter for simple scripts, legacy applications, and direct integrations that already use `PutMetricData`.

The main design choice is ownership. Platform teams often own standard infrastructure dashboards. Application teams should own business and application metrics because they understand what success means for their service.

## Publish Application Metrics Safely
<!-- section-summary: Custom metric publishing needs stable names, low-cardinality dimensions, correct units, and a clear path for either OpenTelemetry, PutMetricData, or embedded metric format. -->

There are three common ways to publish custom application metrics to CloudWatch: OpenTelemetry, the CloudWatch API, and embedded metric format. Each one fits a different operational style.

**OpenTelemetry** is the recommended path for new custom metric instrumentation in AWS documentation. A team uses an OpenTelemetry SDK or collector, attaches consistent attributes such as service name and environment, and sends metrics to the CloudWatch OTLP endpoint. CloudWatch can then query those metrics with PromQL, build dashboards, and create alarms.

**PutMetricData** is the direct CloudWatch API path. It is useful for scripts, batch jobs, deployment checks, or applications that need a simple direct call. Here is a CLI example that publishes one completed checkout:

```bash
aws cloudwatch put-metric-data \
  --namespace "DevPolaris/Checkout" \
  --metric-data '[
    {
      "MetricName": "CompletedCheckouts",
      "Dimensions": [
        {"Name": "Environment", "Value": "prod"},
        {"Name": "Service", "Value": "checkout-api"},
        {"Name": "PaymentProvider", "Value": "stripe"}
      ],
      "Value": 1,
      "Unit": "Count"
    }
  ]'
```

The dimensions are stable. `Environment`, `Service`, and `PaymentProvider` have a small number of expected values. The command avoids `requestId`, `customerId`, and `orderId` because those belong in logs and traces.

**Embedded metric format**, usually shortened to EMF, lets a service write structured JSON logs that CloudWatch Logs can extract into metrics. This is useful for Lambda functions and containers because the same event can carry detailed log fields and metric values.

```json
{
  "_aws": {
    "Timestamp": 1781344800000,
    "CloudWatchMetrics": [
      {
        "Namespace": "DevPolaris/Checkout",
        "Dimensions": [["Environment", "Service"]],
        "Metrics": [
          {"Name": "CompletedCheckouts", "Unit": "Count"},
          {"Name": "CheckoutLatency", "Unit": "Milliseconds"}
        ]
      }
    ]
  },
  "Environment": "prod",
  "Service": "checkout-api",
  "CompletedCheckouts": 1,
  "CheckoutLatency": 183,
  "requestId": "req-7b91",
  "traceId": "1-684d5b12-7f4c1e46a5b14d1a9d9e1052"
}
```

In this event, `requestId` and `traceId` are present for log search and trace correlation, but they are excluded from `Dimensions`. That detail saves money and keeps the metric useful. AWS documentation warns that EMF extraction creates a custom metric for each unique dimension combination, so high-cardinality dimensions can produce a surprising bill.

## Query Fleets With Metrics Insights
<!-- section-summary: Metrics Insights uses SQL-like queries to group, filter, rank, and alarm on large metric fleets without hand-picking every resource. -->

CloudWatch Metrics Insights is a SQL-like query engine for CloudWatch metrics. It helps when the team needs to ask fleet questions instead of selecting one metric at a time. The `GROUP BY` clause can split results into time series by dimension, and `ORDER BY` plus `LIMIT` can produce top-N views.

For example, this query finds the top ECS services by average CPU utilization:

```sql
SELECT AVG(CPUUtilization)
FROM SCHEMA("AWS/ECS", ClusterName, ServiceName)
GROUP BY ClusterName, ServiceName
ORDER BY AVG() DESC
LIMIT 10
```

This query finds the load balancers with the highest active connection count:

```sql
SELECT MAX(ActiveConnectionCount)
FROM SCHEMA("AWS/ApplicationELB", LoadBalancer)
GROUP BY LoadBalancer
ORDER BY MAX() DESC
LIMIT 10
```

And this one finds queues with the oldest visible work:

```sql
SELECT AVG(ApproximateAgeOfOldestMessage)
FROM SCHEMA("AWS/SQS", QueueName)
GROUP BY QueueName
ORDER BY AVG() DESC
LIMIT 10
```

Metrics Insights is especially useful for dynamic environments. If an Auto Scaling group adds instances or ECS launches a new service, a query-based widget can catch new resources without someone editing a dashboard by hand. CloudWatch can also create alarms on Metrics Insights queries, which helps with fleet-level alarms that track changing resources.

In cross-account observability, Metrics Insights can group or filter by `AWS.AccountId`. That helps a platform team answer questions such as, "Which production account has the hottest ECS service right now?" without switching accounts.

## Build Dashboards for Triage
<!-- section-summary: A useful dashboard starts with customer impact, then moves down through ingress, compute, data, async work, alarms, and runbook context. -->

A CloudWatch dashboard is a shared page made from widgets. Widgets can show metrics, alarms, logs, text, and other operational context. The dashboard body is JSON, so teams can manage important dashboards with infrastructure as code or deploy them from a repository.

The main dashboard design rule is order. Put customer impact first, then show the request path. During an incident, the on-call engineer should be able to scan from top to bottom and see where the signal changes.

| Dashboard row | Checkout widgets |
|---|---|
| Customer outcome | `CompletedCheckouts`, `PaymentAuthorizationFailures`, p95 checkout latency |
| Ingress | ALB request count, ALB target 5xx, ALB target response time |
| Compute | ECS CPU, memory, running task count, deployment version note |
| Data | RDS connections, write latency, CPU, storage |
| Async | SQS visible messages, oldest message age, worker Lambda errors |
| Response | Alarm widgets, runbook links, owner and escalation notes |

Here is a small dashboard body with one metric widget and one text widget. The real load balancer dimension value would come from your environment.

```json
{
  "start": "-PT3H",
  "periodOverride": "auto",
  "widgets": [
    {
      "type": "metric",
      "x": 0,
      "y": 0,
      "width": 12,
      "height": 6,
      "properties": {
        "region": "us-east-1",
        "title": "Checkout ALB latency and target 5xx",
        "period": 60,
        "metrics": [
          [
            "AWS/ApplicationELB",
            "TargetResponseTime",
            "LoadBalancer",
            "app/prod-checkout/50dc6c495c0c9188",
            {"stat": "p95", "label": "p95 target response time"}
          ],
          [
            ".",
            "HTTPCode_Target_5XX_Count",
            ".",
            ".",
            {"stat": "Sum", "label": "target 5xx", "yAxis": "right"}
          ]
        ]
      }
    },
    {
      "type": "text",
      "x": 12,
      "y": 0,
      "width": 12,
      "height": 6,
      "properties": {
        "markdown": "### Checkout response\nOwner: Payments Platform\nRunbook: internal checkout latency runbook\nEscalation: page checkout-primary first, database-primary second."
      }
    }
  ]
}
```

You can publish it with:

```bash
aws cloudwatch put-dashboard \
  --dashboard-name "checkout-prod" \
  --dashboard-body file://checkout-dashboard.json
```

CloudWatch dashboards can include cross-account and cross-Region widgets by using `accountId` and `region` in dashboard JSON. That helps teams build one high-level view across production accounts and Regions. The dashboard should still stay readable. A dashboard with fifty charts and no order usually slows response because every chart asks for attention at once.

![Triage dashboard layout with customer health, edge latency, app errors, data pressure, queue delay, and recent changes](/content-assets/articles/article-cloud-iac-observability-metrics-dashboards/triage-dashboard-layout.png)

*A dashboard should guide the responder's eyes. Customer impact comes first, then the path through edge, application, data, async work, and recent changes.*

## Alarms as State Machines
<!-- section-summary: A CloudWatch alarm evaluates metric data over time and changes state only when the configured evaluation rule is satisfied. -->

A CloudWatch alarm is a state machine attached to a metric, metric math expression, Metrics Insights query, anomaly detection model, or PromQL query. The alarm state is one of `OK`, `ALARM`, or `INSUFFICIENT_DATA`. It changes state based on the datapoints CloudWatch evaluates.

The most important alarm settings are:

| Setting | Meaning |
|---|---|
| Metric or query | The signal the alarm evaluates |
| Statistic | The aggregation, such as `Average`, `Sum`, `Maximum`, or `p95` |
| Period | The time window for each datapoint |
| Threshold | The value that marks a datapoint as breaching |
| Evaluation periods | How many periods CloudWatch considers |
| Datapoints to alarm | How many breaching datapoints are needed |
| Missing data treatment | How CloudWatch handles missing datapoints |
| Actions | What happens on state changes |

Here is a production-style alarm for checkout load balancer p95 latency. It pages only when three out of five one-minute datapoints breach the two-second threshold.

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "checkout-prod-alb-p95-latency-high" \
  --alarm-description "p95 target response time is above 2 seconds for checkout. Dashboard: checkout-prod" \
  --namespace "AWS/ApplicationELB" \
  --metric-name "TargetResponseTime" \
  --dimensions Name=LoadBalancer,Value=app/prod-checkout/50dc6c495c0c9188 \
  --extended-statistic "p95" \
  --period 60 \
  --evaluation-periods 5 \
  --datapoints-to-alarm 3 \
  --threshold 2 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:us-east-1:111122223333:checkout-critical-alerts
```

This is an **M out of N** alarm. `datapoints-to-alarm` is M. `evaluation-periods` is N. A `3 out of 5` alarm can catch sustained pain while giving the system room for a short spike. A `5 out of 5` alarm waits for five consecutive breaches. A `1 out of 1` alarm fires quickly and can create noise.

Percentile latency alarms should usually watch a customer-impacting percentile such as p95 or p99. Average latency can hide a painful tail where a smaller group of users waits several seconds. CloudWatch supports percentile statistics, and the alarm can decide how to behave with low sample counts for percentile-based alarms.

## Thresholds, Missing Data, and Anomaly Detection
<!-- section-summary: Good alarms choose thresholds from user impact, handle missing data intentionally, and use anomaly detection for patterns that shift by hour or day. -->

A threshold should express a condition that deserves action. A checkout p95 latency threshold of two seconds might come from a product requirement, an SLO, or historical data showing that conversion drops beyond that point. A CPU threshold of 80% might be useful for a worker service if the team has seen queue age rise above that level. The threshold needs a reason.

CloudWatch lets you choose how an alarm treats missing data. The default behavior is `missing`, which can lead to `INSUFFICIENT_DATA` when recent datapoints are missing. Other options are `breaching`, `notBreaching`, and `ignore`.

The right choice depends on what silence means:

| Metric pattern | Good missing-data choice | Reason |
|---|---|---|
| Continuous heartbeat or request count | `breaching` or `missing` | Silence might mean telemetry or workload failure |
| Error-only metric such as throttles | `notBreaching` | No datapoint can mean no errors occurred |
| Sparse business event in low traffic | `missing` or `notBreaching` | Silence might be normal overnight |
| Rollback safety metric after deploy | Often `breaching` | Missing telemetry during release can be risky |

**Anomaly detection** helps when a static threshold is too blunt. CloudWatch anomaly detection uses statistical and machine learning algorithms to learn the expected range for a metric, including hourly, daily, and weekly patterns. An alarm can then trigger when the metric moves above or below that expected band.

For checkout, anomaly detection can help with `CompletedCheckouts`. A static threshold like "below 100 checkouts per minute" might fire every night and miss daytime underperformance. An anomaly band can learn that Sunday night traffic differs from Monday lunch traffic. The alarm can then focus on unusual drops compared with the normal pattern for that time.

Anomaly detection still needs judgment. A launch day, pricing change, or planned marketing campaign can shift normal behavior. CloudWatch lets teams exclude time periods from model training, and AWS notes that new models can take time to train. Treat anomaly alarms as production signals that need review, tuning, and runbook context.

## Composite Alarms and Recommended Alarms
<!-- section-summary: Composite alarms reduce noise by combining lower-level alarms, while AWS recommended alarms provide service-specific starting points. -->

Real systems can produce many alarms. During one checkout incident, the load balancer latency alarm, API 5xx alarm, ECS CPU alarm, and payment failure alarm might all change state. If each one pages separately, the team receives noise instead of clarity.

A **composite alarm** combines other alarms with a rule. It can notify only when the combined condition matters. For example, page the checkout team when customer-facing latency is high and backend errors are high, while still showing the lower-level alarms on the dashboard.

```bash
aws cloudwatch put-composite-alarm \
  --alarm-name "checkout-prod-customer-impact" \
  --alarm-description "Customer-impacting checkout issue. Check the checkout-prod dashboard and payment dependency runbook." \
  --alarm-rule 'ALARM("checkout-prod-alb-p95-latency-high") AND ALARM("checkout-prod-target-5xx-high")' \
  --alarm-actions arn:aws:sns:us-east-1:111122223333:checkout-critical-alerts
```

Composite alarms are useful for paging because they can reduce alarm noise. They have limits. AWS documentation notes that composite alarms can send SNS notifications and create investigations, Systems Manager OpsItems, or incidents, but they cannot perform EC2 actions or Auto Scaling actions. Keep automation on the metric alarm that owns the scaling signal, and keep composite alarms for incident routing and context.

AWS also publishes **recommended alarms** for many AWS service metrics. In the CloudWatch console, the alarm recommendations filter can show metrics that have AWS recommended alarm settings. For some metrics, CloudWatch can pre-fill the intent, threshold, period, evaluation periods, and datapoints. The console can also download infrastructure-as-code alarm definitions for recommended alarms.

Recommended alarms are a starting point for the AWS service layer. They fit service basics such as Lambda errors, SQS dead-letter queue movement, RDS storage or memory pressure, and EKS pod CPU or memory pressure. The application team still adds service-specific business alarms such as checkout completions, payment failure rate, and order confirmation delay.

## Cross-Account Operations
<!-- section-summary: Cross-account observability lets a central monitoring account view and alarm on metrics from linked source accounts. -->

Production AWS environments often use separate accounts for each environment, workload, or team. That account structure helps security and ownership, but it can split telemetry across many places. During a checkout incident, the application account might hold ECS metrics, the shared networking account might hold load balancer metrics, and the central operations team might work from another account.

CloudWatch cross-account observability uses a monitoring account and source accounts. Source accounts share telemetry. The monitoring account views and analyzes it. Shared telemetry can include CloudWatch metrics, CloudWatch Logs log groups, X-Ray traces, Application Signals services and SLOs, Application Insights applications, and Internet Monitor data.

For metrics and dashboards, cross-account work shows up in two practical ways. First, dashboards can include widgets from other accounts and Regions by setting `accountId` and `region`. Second, Metrics Insights queries in a monitoring account can filter or group by `AWS.AccountId`.

```sql
SELECT AVG(CPUUtilization)
FROM SCHEMA("AWS/ECS", ClusterName, ServiceName)
GROUP BY AWS.AccountId, ClusterName, ServiceName
ORDER BY AVG() DESC
LIMIT 10
```

CloudWatch can also create alarms that watch metrics in other accounts when cross-account functionality is enabled. AWS documents a few limitations: cross-account composite alarms are unavailable, and some metric math functions are unavailable for cross-account alarms. The safe operating pattern is to keep a small number of central customer-impact alarms in the monitoring account and keep workload-specific automation close to the source account that owns the resource.

## Putting It All Together
<!-- section-summary: A production metric system connects business metrics, AWS service metrics, dashboards, alarms, anomaly detection, composite routing, and cross-account visibility. -->

Let's build the checkout operating path from the first signal to the response.

1. The application emits `CompletedCheckouts`, `PaymentAuthorizationFailures`, and `CheckoutLatency` with stable dimensions such as `Environment` and `Service`.
2. AWS services publish ALB, ECS, RDS, Lambda, and SQS metrics automatically.
3. A CloudWatch dashboard puts completed checkouts and p95 latency at the top, then ingress, compute, data, async work, and alarm state below.
4. Metrics Insights widgets show top ECS services, queues, and load balancers by pressure, so new resources appear without manual widget edits.
5. Metric alarms watch customer-impacting thresholds such as p95 latency, target 5xx count, and SQS oldest message age.
6. Anomaly detection watches business metrics whose healthy value changes by hour or day, such as completed checkouts.
7. Composite alarms combine lower-level alarms into one customer-impacting page.
8. Cross-account observability lets the monitoring account inspect production metrics without account switching.

That gives the on-call engineer a useful path. The page says customer impact. The dashboard shows scope. Metrics Insights highlights the hottest dependency. Logs and traces provide detail after metrics narrow the search. The runbook tells the team which rollback, scaling, or dependency escalation is approved.

The production checklist is:

- **Name metrics clearly** with stable namespaces, metric names, units, and low-cardinality dimensions.
- **Combine AWS service metrics with custom business metrics** because infrastructure health and user outcomes answer different questions.
- **Prefer OpenTelemetry for new application metrics** where it fits the runtime, and use CloudWatch API or EMF for simple direct publishing.
- **Use Metrics Insights for fleets** so dashboards and alarms keep up with changing resources.
- **Design dashboards from customer impact downward** so responders can triage quickly.
- **Tune alarms with M out of N evaluation and missing-data behavior** so pages match real action.
- **Use anomaly detection and composite alarms carefully** to catch shifting patterns and reduce noise.
- **Centralize visibility across accounts** while keeping resource-owning teams responsible for their workload signals.

![CloudWatch metric response flow from datapoints through statistic, threshold, alarm state, SNS route, and runbook action](/content-assets/articles/article-cloud-iac-observability-metrics-dashboards/from-metric-to-response.png)

*The summary image connects metric design to incident response. A number helps only after the alarm state reaches the right route and the runbook action is clear.*

## What's Next
<!-- section-summary: The following observability work adds deeper log and trace practices so metrics can lead into exact evidence. -->

Metrics, dashboards, and alarms tell you when the checkout system is unhealthy and where the pressure appears. The next layer is detailed evidence. Logs show exact events and error fields, and traces show the path of one request across services and dependencies. Together, those signals turn a metric spike into a root-cause investigation.

---

**References**

- [Metrics concepts - Amazon CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html) - Documents metrics, namespaces, dimensions, Region behavior, retention, timestamps, resolution, units, periods, aggregation, and percentiles.
- [Publish custom metrics - Amazon CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/publishingMetrics.html) - Documents publishing custom metrics with OpenTelemetry, CloudWatch OTLP endpoints, PromQL querying, `PutMetricData`, namespaces, names, and dimensions.
- [Embedding metrics within logs - Amazon CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format.html) - Documents embedded metric format, automatic metric extraction from logs, Logs Insights correlation, permissions, and high-cardinality cost risk.
- [Query your CloudWatch metrics with CloudWatch Metrics Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/query_with_cloudwatch-metrics-insights.html) - Documents Metrics Insights query editor, `GROUP BY`, `ORDER BY`, and top-N metric analysis.
- [Metrics Insights sample queries](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch-metrics-insights-queryexamples.html) - Official AWS examples for ALB, ECS, RDS, Lambda, SQS, SNS, and other service queries.
- [Using Amazon CloudWatch dashboards](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Dashboards.html) - Documents CloudWatch dashboards and cross-account cross-Region dashboard parameters.
- [Dashboard body structure and syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Dashboard-Body-Structure.html) - Documents dashboard JSON, widget arrays, metric widget properties, `accountId`, and dashboard structure.
- [Using Amazon CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Alarms.html) - Documents alarm capabilities, states, dashboard alarm display, cross-account alarm support, actions, and composite alarm behavior.
- [Alarm evaluation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-evaluation.html) - Documents M out of N evaluation, evaluation intervals, and high-resolution alarm periods.
- [Configuring how CloudWatch alarms treat missing data](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarms-and-missing-data.html) - Documents `breaching`, `notBreaching`, `ignore`, and `missing` behavior for alarm evaluation.
- [Using CloudWatch anomaly detection](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Anomaly_Detection.html) - Documents anomaly detection models, expected-value bands, seasonality, metric math support, training, and pricing notes.
- [Create a composite alarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Composite_Alarm.html) - Documents composite alarm creation, alarm rules, descriptions, markdown links, and dependency-cycle warnings.
- [Best practice alarm recommendations for AWS services](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best-Practice-Alarms.html) - Documents finding recommended alarms, pre-filled settings, and infrastructure-as-code downloads.
- [Recommended alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html) - Lists AWS recommended service alarm metrics, intents, thresholds, periods, datapoints, and evaluation settings.
- [CloudWatch cross-account observability](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Unified-Cross-Account.html) - Documents monitoring accounts, source accounts, shared telemetry types, Observability Access Manager, and Organizations-based onboarding.
