---
title: "What Is Observability"
description: "Understand how Azure Monitor collects logs, metrics, traces, and alerts so a running Azure app leaves usable production evidence."
overview: "A deployed Azure app can look healthy in the portal while customers still hit errors. This article explains the basic evidence chain behind Azure Monitor, Log Analytics, Application Insights, metrics, traces, dashboards, and alerts."
tags: ["azure", "observability", "logs", "metrics", "traces", "alerts"]
order: 1
id: article-cloud-providers-azure-observability-azure-observability-mental-model
aliases:
  - azure-observability-mental-model
  - cloud-providers/azure/observability/azure-observability-mental-model.md
---

## Table of Contents

1. [The Problem After Deployment](#the-problem-after-deployment)
2. [What Is Observability](#what-is-observability)
3. [Azure Monitor as the Evidence Hub](#azure-monitor-as-the-evidence-hub)
4. [The Four Signals](#the-four-signals)
5. [How Telemetry Reaches Azure Monitor](#how-telemetry-reaches-azure-monitor)
6. [Correlation Across One Request](#correlation-across-one-request)
7. [Dashboards, Alerts, and Response](#dashboards-alerts-and-response)
8. [A Practical First Setup](#a-practical-first-setup)
9. [Operating Habits That Keep Evidence Useful](#operating-habits-that-keep-evidence-useful)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Problem After Deployment
<!-- section-summary: After an app leaves your laptop, Azure resources only tell part of the story, so the app needs to emit evidence about real user work. -->

When you run an app on your laptop, debugging feels direct. You can look at the terminal, add a print statement, open the local database, restart the process, and watch the next request with your own eyes. Production Azure feels very different because the app might run on App Service, Container Apps, Azure Functions, AKS, or virtual machines, and each runtime hides a lot of the machine-level details on purpose.

The article will use one running example the whole way through. A small commerce team has an `orders-api` hosted on Azure App Service. The API accepts `POST /checkout`, writes the order to Azure SQL Database, uploads an invoice PDF to Blob Storage, reads a secret from Key Vault, and sends a message to Service Bus so the warehouse can pack the order.

One afternoon, support says that some customers can pay but never receive a receipt. The Azure portal still shows the App Service as running. CPU looks normal, memory looks normal, and the database has stayed online. Those resource facts matter, while the real production question remains open: what happened to the checkout request that failed?

That question introduces the main pieces in this article. **Telemetry** is the evidence a system emits while it runs. **Logs** describe events, **metrics** measure numbers over time, **traces** follow one request across services, and **alerts** turn important changes into notifications or automation. **Observability** is the practice of designing the app and the Azure resources so those signals can answer real questions during an incident.

## What Is Observability
<!-- section-summary: Observability means a production system leaves enough connected evidence for engineers to explain a failure from the outside. -->

**Observability** means your system emits enough useful evidence that engineers can understand its behavior from the outside. In Azure, that evidence usually flows through Azure Monitor, Log Analytics workspaces, Application Insights, metrics, dashboards, alert rules, and action groups. The tool names come later; the important idea is the evidence.

For the checkout example, a useful observability setup can show that `POST /checkout` started at `10:24:18`, the Azure SQL insert succeeded, the Blob Storage upload returned `403 AuthorizationPermissionMismatch`, and the API returned HTTP `500` after throwing `ReceiptUploadError`. That is a much better incident conversation than "the app is broken" because the team can focus on storage permissions, managed identity, and the exact operation that failed.

Older server monitoring usually focused on machine health: CPU, memory, disk, process uptime, and network reachability. Those checks still matter because a saturated database or exhausted worker pool can break a service. Modern cloud systems also need workflow evidence because a resource can stay online while a user transaction fails because of identity, networking, bad configuration, slow dependencies, or application code.

A helpful beginner rule is to separate **resource health** from **workflow health**. Resource health asks whether the hosting layer can run. Workflow health asks whether users can complete the thing they came to do. The `orders-api` needs both because a healthy App Service instance still leaves checkout, invoice upload, and warehouse handoff unproven.

Here is a small structured log from the checkout failure. The exact logging library can vary, but the shape of the event is the important part. The example below uses stable fields that can travel into Application Insights or a Log Analytics workspace:

```json
{
  "timestamp": "2026-06-11T10:24:18.452Z",
  "level": "error",
  "service": "orders-api",
  "operation": "checkout",
  "operationId": "op-checkout-7a91",
  "orderId": "ord-1024",
  "dependency": "blob-storage",
  "target": "stordersprod.blob.core.windows.net",
  "resultCode": "AuthorizationPermissionMismatch",
  "message": "invoice upload failed"
}
```

This log gives the team searchable fields instead of one flat sentence. The `operationId` connects this event to other telemetry from the same checkout attempt. The `dependency`, `target`, and `resultCode` fields point the investigation toward Blob Storage access instead of sending the team through unrelated database and CPU charts.

## Azure Monitor as the Evidence Hub
<!-- section-summary: Azure Monitor is the shared Azure service that collects, stores, queries, visualizes, and alerts on operational telemetry. -->

**Azure Monitor** is Microsoft's observability service for Azure and hybrid environments. It collects and analyzes telemetry from applications, Azure resources, infrastructure, and other sources. It also provides the experiences that engineers use during incidents: metrics explorer, Log Analytics, Application Insights views, workbooks, dashboards, and alerts.

If you come from AWS, think of Azure Monitor as the broad operating space where several AWS habits meet: CloudWatch-style metrics and alerts, log investigation, and application tracing. The names differ, but the working question is familiar: can the team move from a user symptom to connected evidence?

For our `orders-api`, Azure Monitor is the place where different evidence streams meet. App Service can emit platform metrics such as request count and response status. Azure SQL can emit database metrics and resource logs. Blob Storage can emit resource logs for blob operations. Application Insights can collect request, dependency, exception, trace, and custom event telemetry from the application code.

The next useful idea is storage. Azure Monitor uses different stores because telemetry has different shapes. **Azure Monitor Metrics** stores numeric time-series data, which works well for fast charts and alert checks. **Azure Monitor Logs** stores richer log and trace data in a **Log Analytics workspace**, where engineers query it with **Kusto Query Language**, usually called **KQL**.

In the checkout failure, a metric can tell the team that HTTP `500` responses jumped from 1 percent to 12 percent in five minutes. A log query can show which routes failed and which error codes appeared. A trace can show that the SQL step finished quickly and the Blob Storage step failed. Azure Monitor matters because the team can move between those views without treating each service as a separate little island.

The names can feel crowded at first, so the simple map below keeps the first pass grounded. It also shows how the same checkout scenario will show up across different Azure Monitor pieces.

| Azure piece | Simple meaning | Checkout example |
|---|---|---|
| **Azure Monitor** | The broad observability platform | The team opens Monitor to investigate production health |
| **Log Analytics workspace** | The queryable log and trace store | `AppRequests`, `AppDependencies`, and storage logs land in one workspace |
| **Application Insights** | Application performance monitoring for code | The API sends requests, dependencies, exceptions, traces, and custom events |
| **Azure Monitor Metrics** | Numeric time-series storage | HTTP failures, CPU, SQL DTU, queue length, and latency appear as charts |
| **Alerts and action groups** | The notification and response loop | A high checkout failure rate sends an alert to the on-call channel |

![Azure Monitor evidence hub showing orders-api, generic resource dependencies, logs, metrics, traces, alerts, Application Insights, Log Analytics, and Metrics plus Alerts](/content-assets/articles/article-cloud-providers-azure-observability-azure-observability-mental-model/azure-monitor-evidence-hub.png)

*Azure Monitor helps when application code, Azure resources, and dependency calls send their signals into shared places for investigation, charts, and alerts.*

Knowing the map helps because the rest of the module goes deeper one layer at a time. The next question is what the signals actually look like when the system emits them.

## The Four Signals
<!-- section-summary: Logs, metrics, traces, and alerts answer different production questions, so strong observability uses all four together. -->

**Logs** are timestamped event records. A log usually describes one thing that happened: a user signed in, an upload failed, a database connection timed out, a feature flag changed, or a background job retried. Logs work best when they use structured fields because fields make them searchable in KQL.

In the checkout story, the invoice upload failure should create a log with the order ID, operation ID, storage account, blob container, result code, and request route. The message string helps humans read the event, but the fields help the query engine group thousands of events. A production team can then ask, "show me every failed invoice upload in the last hour, grouped by result code."

**Metrics** are numbers recorded over time. A metric can describe request count, failed request count, p95 latency, CPU percentage, database connection count, queue depth, or successful checkout count. Metrics work well for dashboards and alerts because Azure can evaluate numeric values quickly at regular intervals.

For `orders-api`, a metric called `checkout_failure_rate` can show whether the problem affects one customer or many customers. If one upload failed, the team needs a normal bug investigation. If 40 percent of checkouts fail for five minutes, the team needs an incident response. Metrics give that scale fast.

**Traces** follow one transaction across service boundaries. A trace contains smaller units of work called **spans**. In the checkout request, one span can represent the API handler, another span can represent the SQL insert, another span can represent the Blob Storage upload, and another span can represent the Service Bus send.

Distributed traces matter because modern apps split one user action across many services. Application Insights and OpenTelemetry use trace context to keep those pieces connected as the request moves through HTTP calls, SDK calls, queues, and background workers. The trace turns a pile of separate events into one request timeline.

**Alerts** are rules that evaluate telemetry and create a response when conditions match. An alert can watch a metric threshold, a log query result, an activity log event, or a Prometheus query. An **action group** defines who or what receives the alert, such as email, SMS, push notification, Azure Function, Logic App, webhook, or Event Hub.

These four signals work together during the incident. The alert tells the team that checkout failures crossed the paging threshold. The metric chart shows when the failure started and how widespread it is. The trace shows which dependency failed inside one request. The logs show the exact storage error, identity name, resource ID, and code path.

## How Telemetry Reaches Azure Monitor
<!-- section-summary: Azure collects some platform data automatically, while detailed resource logs and application telemetry need routing and instrumentation choices. -->

After you understand the four signals, the next natural question is where they come from. Azure resources emit some telemetry automatically, but the useful production story usually needs a few explicit choices. Those choices decide whether evidence reaches a workspace, which fields appear, how long data stays available, and whether the team can query it during an incident.

**Platform metrics** come from Azure resources. App Service, Azure SQL Database, Storage Accounts, Service Bus, virtual machines, and many other resources publish built-in metrics. Azure Monitor collects many of these metrics without you changing application code, which gives teams a first view of resource health.

**Resource logs** describe operations inside Azure resources, but many detailed resource logs need a **diagnostic setting**. A diagnostic setting is a routing rule on an Azure resource. It says which log and metric categories to collect and where to send them, such as a Log Analytics workspace, a storage account, an Event Hub, or a partner integration.

For the checkout example, the Blob Storage account needs diagnostic settings for blob read, write, and delete operations if the team wants searchable storage operation records in the workspace. Without that routing, the app may say "upload failed" while the storage-side details never show up in Log Analytics. That missing route can cost the team the exact evidence they need.

**Application telemetry** comes from the code and runtime. Application Insights is the Azure Monitor feature that collects request, dependency, exception, trace, event, and metric telemetry from applications. For most code-based server workloads, Microsoft recommends the Azure Monitor OpenTelemetry Distro because OpenTelemetry gives a standard way to collect telemetry across languages and platforms.

For a Node.js service, the setup can start as small as installing the Azure Monitor OpenTelemetry package and configuring the Application Insights connection string. In a real production app, that connection string usually lives in an app setting or secret-backed configuration value. The code below shows only the first connection point, not the full production logging design:

```bash
npm install @azure/monitor-opentelemetry
```

```js
const { useAzureMonitor } = require("@azure/monitor-opentelemetry");

useAzureMonitor({
  azureMonitorExporterOptions: {
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
  }
});
```

That small code path only opens the application telemetry pipeline so requests, dependencies, exceptions, traces, and metrics can flow into Application Insights. The team still needs useful names, useful custom properties, and careful filtering so telemetry explains production behavior without collecting secrets or noisy low-value events.

## Correlation Across One Request
<!-- section-summary: Correlation gives separate telemetry rows the same operation identity, which lets engineers rebuild one customer journey. -->

Now the telemetry is flowing, but a new problem appears. A busy production system can emit millions of records. One checkout attempt may create an App Service request record, several application traces, a SQL dependency record, a Blob Storage dependency record, one exception record, and resource logs from the storage account.

**Correlation** means those separate records share identifiers that connect them to the same operation. In Application Insights, the important idea is the operation identity. In OpenTelemetry language, the same idea appears through trace IDs and span IDs. The names vary by table and tool view, but the purpose stays the same: connect the local piece of work to the larger request.

Here is a simplified checkout trace. Notice how each row describes a different local event, while the operation identity keeps the rows connected. That shared identity is what lets the team move from scattered records to one customer journey:

| Step | Telemetry type | What it records | Operation identity |
|---|---|---|---|
| Browser calls API | Request | `POST /checkout` returned `500` | `op-checkout-7a91` |
| API validates cart | Trace | Cart and price validation passed | `op-checkout-7a91` |
| API writes order | Dependency | Azure SQL insert returned success | `op-checkout-7a91` |
| API uploads invoice | Dependency | Blob Storage write returned `403` | `op-checkout-7a91` |
| API handles failure | Exception | `ReceiptUploadError` thrown | `op-checkout-7a91` |

![Checkout operation correlation timeline showing POST checkout, Azure SQL success, Blob upload 403, and ReceiptUploadError connected by one operation ID](/content-assets/articles/article-cloud-providers-azure-observability-azure-observability-mental-model/checkout-operation-correlation.png)

*One operation ID lets separate request, dependency, and exception records become one checkout story instead of scattered production clues.*

With correlation in place, KQL can pull the pieces into one timeline. The exact table names and fields depend on the telemetry source and schema, but workspace-based Application Insights commonly uses tables such as `AppRequests`, `AppDependencies`, `AppExceptions`, and `AppTraces`.

```kusto
let checkoutOperation = "op-checkout-7a91";
union AppRequests, AppDependencies, AppExceptions, AppTraces
| where OperationId == checkoutOperation
| order by TimeGenerated asc
| project TimeGenerated, Type, Name, ResultCode, Success, DurationMs, Message
```

The query uses `let` so the operation ID appears once, then `union` reads the common Application Insights tables together. `order by TimeGenerated asc` matters because the team wants the story in the same order the request experienced it. `project` trims the output to the fields that belong in an incident note.

A useful result might look like this:

| TimeGenerated | Type | Name | ResultCode | Success | Message |
|---|---|---|---|---|---|
| `10:24:18.090` | `AppRequests` | `POST /checkout` | `500` | `false` | |
| `10:24:18.214` | `AppDependencies` | `SQL InsertOrder` | `0` | `true` | |
| `10:24:18.381` | `AppDependencies` | `Blob Put invoice` | `403` | `false` | |
| `10:24:18.452` | `AppExceptions` | `ReceiptUploadError` | | `false` | `invoice upload failed` |

This result gives the team a chronological view of one failed checkout. The API started normally, Azure SQL succeeded, Blob Storage rejected the upload, and the application threw an exception after that dependency call. The team now has a path from user symptom to failing dependency.

Correlation also helps across teams. The application engineer can show the storage engineer the operation ID, time range, target storage account, and result code. The storage engineer can query resource logs around the same time and resource. That shared evidence makes the conversation concrete.

## Dashboards, Alerts, and Response
<!-- section-summary: Dashboards show the current shape of the system, while alerts decide when telemetry requires human or automated action. -->

After the team can investigate one request, they need a way to notice broad changes quickly. **Dashboards** and **workbooks** give teams shared views of important metrics, logs, and trends. A checkout dashboard might show request volume, failure rate, p95 latency, SQL latency, Blob Storage errors, Service Bus queue depth, and recent deployment markers.

A dashboard should show both resource and workflow health. CPU, memory, and database capacity explain infrastructure pressure. Checkout success rate, payment authorization latency, invoice upload failures, and queue backlog explain customer impact. When both views sit together, the team can see whether a user problem lines up with a resource problem.

**Alert rules** turn telemetry into a decision loop. A metric alert can check whether checkout failure rate stays above 5 percent for five minutes. A log search alert can run a KQL query that counts `AuthorizationPermissionMismatch` failures from Blob Storage. An activity log alert can fire when a critical production resource changes.

An **action group** defines the response path after the alert fires. It can send email, SMS, push notifications, webhooks, Logic Apps, Azure Functions, ITSM incidents, or Event Hub messages. For the checkout API, a critical alert might notify the on-call engineer and trigger a webhook that opens an incident with the dashboard, time range, and KQL query attached.

Good alerting is based on user impact. A page for every short CPU spike trains the team to ignore noise. A page for checkout failure rate, sustained HTTP `5xx`, or a queue that has stopped draining tells the team that customers need attention. Lower-level resource alerts can still exist, but many of them belong on dashboards or work items rather than high-priority paging.

This connects back to the four signals. Metrics make fast alert conditions. Logs make precise alert conditions. Traces explain the request path after someone opens the incident. Dashboards keep the team oriented while they decide whether to roll back, change a role assignment, scale out, or fix code.

## A Practical First Setup
<!-- section-summary: A useful first observability setup covers application telemetry, resource routing, business metrics, and a small number of high-signal alerts. -->

A beginner Azure observability setup needs a focused first set of signals instead of every possible signal on day one. It needs enough evidence for the first serious incident. For the `orders-api`, that means the team can answer four questions: are customers succeeding, which dependency failed, what changed recently, and who needs to respond?

A practical setup usually uses **Application Insights** for the application. The API should emit request, dependency, exception, trace, and custom event telemetry. Important custom properties include operation name, order ID or a safe internal order reference, tenant or region when useful, dependency target, and failure category. Sensitive data such as card numbers, access tokens, customer secrets, and full personal records should stay out of telemetry.

The next piece is a **Log Analytics workspace** as the central query location. Application Insights telemetry can land there, and selected resource logs from Azure SQL, Blob Storage, Key Vault, Service Bus, networking components, and other production dependencies can land there as well. The workspace gives the team one place to query cross-service evidence.

The setup keeps **platform metrics** and adds a few **custom application metrics**. Platform metrics show resource behavior such as CPU, storage throttling, SQL DTU, and queue depth. Custom metrics show product behavior such as checkout attempts, checkout completions, invoice upload failures, and payment authorization latency. The custom metrics tell the team whether the business workflow is healthy.

A small set of **high-signal alerts** gives the team a sane first response loop. For the checkout system, the first useful alerts might be sustained HTTP `5xx` rate, checkout failure rate, p95 checkout latency, Service Bus queue age, and repeated Blob Storage authorization failures. Each alert should have an owner, a severity, an action group, and a short investigation link to the dashboard or query that helps the responder start.

Here is a compact starter checklist. It keeps the first setup focused on evidence the team will actually need during an incident. The later articles in this module expand these rows into concrete workspace, Application Insights, metric, and alert configuration:

| Setup item | Why it matters for the first incident |
|---|---|
| Application Insights connected to the API | Shows requests, dependencies, exceptions, traces, and operation correlation |
| Log Analytics workspace | Gives one query location for app and resource evidence |
| Diagnostic settings on key resources | Sends detailed resource logs from storage, database, identity-adjacent, and messaging services |
| Custom workflow metrics | Shows whether users can complete checkout and whether the supporting resources are healthy |
| High-signal alert rules | Pages the team for sustained user impact instead of noisy resource blips |
| Action group with a tested path | Sends the alert to the right humans or automation when it matters |

This setup gives the team a good first production loop. An alert says checkout is failing, the dashboard shows the blast radius, the trace shows where one request broke, logs show the exact error, and resource logs confirm what the Azure dependency saw.

## Operating Habits That Keep Evidence Useful
<!-- section-summary: Observability stays useful when teams define user-facing indicators, attach release context, test the evidence path, and write incident notes from telemetry. -->

After the first setup exists, the team needs a few habits that keep the evidence trustworthy. A **service-level indicator**, usually shortened to **SLI**, is a measurement of something users care about. For the checkout system, good SLIs include checkout success rate, p95 checkout latency, receipt upload success rate, and Service Bus message age. These numbers connect observability to the user workflow instead of leaving the team with only CPU, memory, and replica charts.

Release context also matters. Each request, trace, exception, and custom metric should carry a release version such as `2026.06.11.2` or a commit SHA. Azure Activity log records can show resource changes, but application telemetry needs the app version too. During the receipt incident, the team can compare failures before and after the release and decide whether a rollback is a serious option.

Teams should test observability as part of release readiness. In staging, run a normal checkout and a controlled failing checkout, then confirm that Application Insights shows the request, dependency calls, exception or trace message, operation ID, and app role name. In production, run a small post-deploy smoke test and confirm that the dashboard, alert query, and key KQL links still work. A missing operation ID or empty dependency table is much cheaper to fix during a quiet deploy window than during a customer incident.

The last habit is writing incident notes from telemetry. A useful note includes the time window, affected route, operation ID, app role, release version, failing dependency, resource ID, alert name, dashboard link, and the first KQL query that proved the issue. It leaves out secrets, tokens, full customer records, and raw payloads. That note helps the next engineer continue the investigation without starting from screenshots or memory.

## Putting It All Together
<!-- section-summary: Azure observability connects application behavior, resource behavior, and response paths into one production feedback loop. -->

Observability in Azure comes from a simple production reality: after deployment, the team needs evidence from outside the running process. Azure Monitor provides the shared platform for that evidence, and the rest of the names describe where each signal comes from and how engineers use it.

Logs explain individual events. Metrics show numeric behavior over time. Traces connect the steps of one request. Alerts decide when telemetry requires action. Log Analytics gives teams KQL over logs and traces. Application Insights adds application-level telemetry and correlation. Diagnostic settings route resource logs from Azure services into the places where teams can query, alert, archive, or forward them.

For the `orders-api`, that means the team can move from "customers miss receipts" to a specific timeline: checkout request failed, SQL succeeded, Blob Storage rejected invoice upload, the app threw `ReceiptUploadError`, and a recent role assignment or storage rule needs review. That is the practical value of observability. It turns a vague production symptom into evidence the team can act on.

![First production observability loop showing application instrumentation, resource log routing, workflow metrics, and alert response around incident evidence](/content-assets/articles/article-cloud-providers-azure-observability-azure-observability-mental-model/observability-production-loop.png)

*A first observability setup gives the team a loop: collect application evidence, route resource logs, track workflow health, and send alerts to the right response path.*

## What's Next

Now that the basic Azure observability shape is clear, the next article goes deeper into logs and workspaces. We will look at diagnostic settings, Log Analytics workspace design, KQL, retention, and the way Azure resource logs become searchable production evidence.

---

**References**

- [Azure Monitor overview](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/overview)
- [Azure Monitor data platform](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/data-platform)
- [Azure Monitor Logs overview](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-platform-logs)
- [Azure Monitor Metrics overview](https://learn.microsoft.com/en-us/azure/azure-monitor/metrics/data-platform-metrics)
- [Application Insights OpenTelemetry overview](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
- [Enable Azure Monitor OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable)
- [Diagnostic settings in Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/platform/diagnostic-settings)
- [Azure Monitor alerts overview](https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/alerts-overview)
