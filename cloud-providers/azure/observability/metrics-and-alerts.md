---
title: "Metrics and Alerts"
description: "Use Azure Monitor metrics, dashboards, alert rules, and action groups to notice important changes without creating alert noise."
overview: "Metrics show the shape of a running system, dashboards give teams a shared operating view, and alerts decide when the shape needs human attention. This article connects those pieces to one Azure backend."
tags: ["metrics", "dashboards", "alerts", "action-groups"]
order: 4
id: article-cloud-providers-azure-observability-azure-metrics-dashboards-alerts
aliases:
  - azure-metrics-dashboards-and-alerts
  - cloud-providers/azure/observability/azure-metrics-dashboards-and-alerts.md
---

## Table of Contents

1. [What Is Metrics and Alerts](#what-is-metrics-and-alerts)
2. [Platform vs. Custom Application Metrics](#platform-vs-custom-application-metrics)
3. [Symptomatic vs. Systemic Alerts](#symptomatic-vs-systemic-alerts)
4. [Designing Resilient Alerts and Action Groups](#designing-resilient-alerts-and-action-groups)
5. [Combating Alert Noise and On-Call Fatigue](#combating-alert-noise-and-on-call-fatigue)
6. [Putting It All Together](#putting-it-all-together)

## What Is Metrics and Alerts

A metric is a lightweight, numeric data value captured at uniform time intervals and structured as a multi-dimensional time series. An alert is a stateless background evaluation loop that continuously polls these metric streams against configured conditions, routing operational attention to engineers when thresholds are crossed. While detailed text logs and distributed traces are designed to help you diagnose the root cause of a specific failure, metrics and alerts are built to track the overall system health, monitor trends, and notify humans before users experience service degradation.

If you operate monitoring systems on AWS, these concepts map directly to your existing mental models:

* **Time-Series Metrics**: AWS CloudWatch Metrics and Azure Monitor Metrics serve the same systems role, storing high-velocity data points with associated dimension keys. However, while CloudWatch Metrics are categorized under rigid namespaces, Azure Monitor Metrics enables multi-dimensional metric splitting directly in the metrics explorer, allowing you to filter a single host metric by instance, region, or status code in a single view.
* **Alerting and Notifications**: AWS CloudWatch Alarms and SNS notification paths map directly to Azure Monitor Alert Rules and Action Groups. The Action Group operates as a reusable routing controller, allowing you to bind a single notification list (email, SMS, voice, or custom automation webhooks) to hundreds of independent alert rules.

Understanding metrics and alerts means recognizing that you do not configure alerts for every single error or machine fluctuation. You design structured monitoring loops that separate normal system activity from user-visible pain.

:::expand[Under the Hood: In-Memory Time-Series Storage and Alert Evaluation Loop Physics]{kind="design"}
Azure Monitor separates metrics ingestion and alert evaluation from heavy log indexing to achieve ultra-low query latencies and immediate response times:

* **In-Memory Time-Series Database Grid**: When a resource or application emits a metric, the data point bypasses traditional disk-based database indexes. Azure Monitor Metrics routes the value directly to a high-performance, in-memory time-series database. The engine stores metric values and their associated dimension tags (e.g., `Region: EastUS`, `APIPath: /checkout`) in pre-aggregated, double-delta compressed arrays. This architecture enables the metrics engine to process and plot millions of data points per second with sub-second retrieval times.
* **Stateless Alert Evaluation Loop**: The Azure Monitor Alert Engine runs as a continuous, stateless background microservice. At your configured evaluation interval (e.g., every 1 minute), the engine executes a lightweight aggregation query against the in-memory metrics grid:
    * **Latency Advantage**: Because the query target is in-memory and numeric, the aggregation completes in single-digit milliseconds, consuming almost zero disk I/O.
    * **Consecutive Windows**: The engine evaluates the metric across your designated lookback window. If the value violates the alert threshold for the specified number of consecutive intervals (e.g., 3 out of 3 consecutive 1-minute intervals), the engine changes the alert state to `Fired`.
    * **Asynchronous Dispatch**: The engine generates an alert payload and dispatches it asynchronously to the Azure Resource Manager (ARM) Action Group gateway, which routes the notification to external SMS providers, email servers, or webhook endpoints.

```mermaid
flowchart TD
    Resource["Compute VM / App Service"] -->|"High-Velocity Metric Streams"| InMemGrid["In-Memory Time-Series Database"]
    
    subgraph AlertEngine["Stateless Alert Evaluation Service"]
        Evaluator["Lightweight Aggregation Query"] -->|"Evaluates every 1 Min"| ConditionCheck{"Threshold Violated?"}
        ConditionCheck -->|"No"| Idle["Keep Idle / Resolved State"]
        ConditionCheck -->|"Yes (Consecutive Windows)"| Transition["Transition State to Fired"]
    end
    
    InMemGrid -->|"Single-Digit ms Pull"| Evaluator
    Transition -->|"Asynchronous Payload Dispatch"| ActionGateway["ARM Action Group Gateway"]
    
    ActionGateway -->|"Email/SMS API"| OnCall["On-Call Page"]
    ActionGateway -->|"REST Webhook"| Automation["Auto-Scaling / Recovery Script"]
```
:::

This decoupled database design ensures that your alerting system remains operational and highly responsive even when primary logging databases are experiencing heavy ingest queues or storage latencies.

## Platform vs. Custom Application Metrics

To build a comprehensive operating view, you must combine infrastructure-side metrics with application-side metrics:

* **Platform Metrics**: Auto-generated by Azure hypervisors and host blades without requiring code changes or application instrumentation. These metrics track physical resource constraints, network utilization, and database hardware pressure:
    * **Compute (VM/App Service)**: CPU utilization percentage, memory saturation, replica instance count, and HTTP queue length.
    * **Databases (Azure SQL)**: CPU percentage, Database Transaction Unit (DTU) limits, remote storage I/O throughput, and active connection counts.
    * **Storage (Blob Storage)**: Total request volume, network egress bandwidth, and client throttling counts.
* **Custom Application Metrics**: Emitted intentionally from within your application code using OpenTelemetry libraries. These metrics track business logic volume, transaction rates, and application-specific performance indicators:
    * **Transaction Rates**: Total checkout attempts, order success rates, and payment authorization latencies.
    * **Functional Retries**: Database connection retry rates and queue message backlog items.

While platform metrics reveal whether your virtualized hardware is stable, custom application metrics show whether the software running on that hardware is successfully delivering business value.

## Symptomatic vs. Systemic Alerts

A common monitoring failure is configuring alert rules for every individual resource metric without evaluating the customer impact. This leads to alert noise and on-call fatigue. To design high-signal alerts, differentiate between symptomatic and systemic signals:

* **Symptomatic Alerts (Low-Level Resource Metrics)**: These rules alert on low-level machine fluctuations, such as a virtual machine crossing 90% CPU usage or a database experiencing a brief spike in active connections. Because transient background tasks (e.g., backup sweeps, scheduled log compression, or data exports) frequently trigger short CPU spikes without impacting user workflows, symptomatic alerts create constant false alarms.
* **Systemic Alerts (User-Facing Workflow Metrics)**: These rules alert on indicators that represent true customer pain, such as the checkout API returning an error rate above 5% or p95 transaction response latencies exceeding 2 seconds for consecutive minutes. 

```text
Systemic Alert: Checkout HTTP 5xx Error Rate > 5% (Pages On-Call)
  |
  +-- Diagnosed by Platform Metrics (Storage Latency, Database Connection Pool Saturation)
  |
  +-- Resolved by Logs & Traces (Isolating the failing dependency operation_Id)
```

Adopt a high-signal alerting posture: configure systemic alerts to page on-call engineers for critical user-facing workflow failures, and use symptomatic platform metric alerts as low-priority tickets or dashboard indicators to assist in diagnostic investigations.

## Designing Resilient Alerts and Action Groups

Azure Monitor supports two primary alert rule engines:

* **Metric Alert Rules**: Evaluated against the high-performance, time-series metrics database. They support sub-minute polling intervals, evaluate quickly, and are highly reliable. Use metric alerts for all primary threshold rules.
* **Log Search Alert Rules**: Evaluated by executing a scheduled KQL query against your Log Analytics workspace (e.g., counting the number of error rows written to `StorageBlobLogs` over the last 15 minutes). While log search alerts are highly flexible and can evaluate complex logs across multiple tables, they run against the columnar disk index, which introduces slightly higher evaluation latencies and query costs.

When an alert rule triggers, it routes the payload to a reusable **Action Group**. The Action Group decouples the alerting logic from the notification channels:

| Notification Channel | Operational Use Case | Designing for Reliability |
| --- | --- | --- |
| **SMS / Voice / Push** | Critical user-facing systemic incidents. | Limit to on-call engineers, and restrict voice notifications to high-priority production alerts. |
| **Email** | Low-priority warnings and capacity warnings. | Route to a shared team inbox rather than individual personal addresses to prevent alerts from being lost. |
| **Webhook / Function** | Automated self-healing and auto-scaling triggers. | Enforce transport security (HTTPS) and configure webhook retries to handle transient receiver downtime. |

Treat Action Groups as stable, version-controlled operational resources, ensuring that on-call rotations are managed centrally rather than hardcoded into individual alert rules.

## Combating Alert Noise and On-Call Fatigue

Alert noise occurs when alerts fire too frequently, do not require human action, or monitor variables that do not affect users. High alert noise leads to alert fatigue, training engineers to ignore pages and increasing the resolution time for real production outages.

Implement these five design patterns to mitigate alert noise:

1. **Alert on Sustained Rates, Not Single Events**: Do not alert on a single failed HTTP call or a brief transient CPU spike. Set rules to evaluate rates over consecutive intervals (e.g., "Failure rate is $>5\%$ across 3 consecutive 5-minute evaluation windows").
2. **Use Multi-Dimensional Metric Splitting**: Instead of creating 10 individual alert rules to monitor the CPU usage of 10 virtual machines, create a single alert rule that enables metric splitting by the `Computer` or `Instance` dimension, automatically evaluating and scaling the rule across all hosts.
3. **Configure Alert Processing Rules**: Deploy Alert Processing Rules to automatically suppress notifications during scheduled deployment windows, database maintenance windows, or infrastructure scaling sweeps.
4. **Link Contextual Runbooks**: Ensure that every alert notification payload includes a direct link to the service's operating runbook, a shared dashboard link, and a pre-saved Log Analytics KQL query, giving the receiving engineer a clear starting point for their investigation.
5. **Establish Symptomatic/Systemic Separation**: Regularly audit your alerting history. If an alert rule fires and the receiving engineer marks it as resolved without taking action, delete, disable, or adjust the threshold of the rule immediately.

## Putting It All Together

Metrics and alerts establish a proactive operational loop that tracks system trends and coordinates human attention.

* **In-Memory Speed**: Leverage Azure Monitor's in-memory time-series database to evaluate metric thresholds in milliseconds.
* **Decoupled Routing**: Separate alert evaluation logic from notification channels by utilizing reusable, centralized Action Groups.
* **Custom Context**: Combine automated platform metrics with custom application metrics to monitor both hardware constraints and business workflows.
* **High-Signal Posture**: Prioritize systemic user-facing workflow alerts to page on-call engineers, and relegate symptomatic resource alerts to dashboards and ticketing systems.
* **Noise Mitigation**: Track sustained failure rates across consecutive windows, utilize multi-dimensional metric splitting, and link operational runbooks directly to alert payloads to prevent on-call fatigue.

---

**References**

* [Azure Monitor Metrics overview](https://learn.microsoft.com/en-us/azure/azure-monitor/essentials/data-platform-metrics)
* [Azure Monitor Alerts overview](https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/alerts-overview)
* [Action Groups in Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/action-groups)
* [Metric alert rules in Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/alerts-metric-overview)
