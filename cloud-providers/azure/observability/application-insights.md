---
title: "Application Insights"
description: "Use Application Insights to follow backend requests, dependencies, exceptions, traces, and correlation through an Azure application."
overview: "Application Insights shows what your running application did during one request. This article follows one failed checkout through requests, dependencies, exceptions, traces, correlation, Application Map, sampling, and OpenTelemetry."
tags: ["application-insights", "requests", "dependencies", "tracing"]
order: 3
id: article-cloud-providers-azure-observability-azure-application-insights-backend-apis
aliases:
  - azure-application-insights-for-backend-apis
  - cloud-providers/azure/observability/azure-application-insights-for-backend-apis.md
---

## Table of Contents

1. [What Is Application Insights](#what-is-application-insights)
2. [The Application Signal](#the-application-signal)
3. [Workspace and Instrumentation Path](#workspace-and-instrumentation-path)
4. [Requests](#requests)
5. [Dependencies](#dependencies)
6. [Exceptions and Traces](#exceptions-and-traces)
7. [Correlation](#correlation)
8. [Querying One Checkout Failure](#querying-one-checkout-failure)
9. [Application Map and Performance Views](#application-map-and-performance-views)
10. [Sampling, Privacy, and Cost](#sampling-privacy-and-cost)
11. [OpenTelemetry Setup](#opentelemetry-setup)
12. [Validate the Telemetry Path](#validate-the-telemetry-path)
13. [Putting It All Together](#putting-it-all-together)
14. [References](#references)
15. [What's Next](#whats-next)

## What Is Application Insights
<!-- section-summary: Application Insights is the Azure Monitor feature that records application-level telemetry from running code. -->

Let's set up the whole picture before we zoom into queries. In the previous observability article, the Orders team learned where logs go: Azure Monitor collects signals, Log Analytics stores queryable tables, and KQL helps the team ask questions during an incident. That gives the team a place to search evidence, but it still leaves one big question: what did the application code do during one customer request?

**Application Insights** is the application performance monitoring feature of **Azure Monitor**. It collects telemetry from running application code, including incoming requests, outgoing dependency calls, exceptions, traces, metrics, availability checks, and usage signals. For a backend API, that means the team can follow one checkout request from the first HTTP route to the SQL call, storage write, exception, and custom log messages that happened along the way.

We will use one production story through the whole article. The `devpolaris-orders-api` service runs in Azure, sends telemetry to an Application Insights component called `appi-devpolaris-orders-prod`, and stores that telemetry in the Log Analytics workspace `law-devpolaris-prod`. A customer says checkout failed once at 09:42 UTC, and support gives the engineering team operation ID `checkout-5001`.

Here is the structure we will build up:

| Concept | Plain meaning | Orders example |
| --- | --- | --- |
| **Application Insights component** | The Azure resource that receives telemetry from one app or app area | `appi-devpolaris-orders-prod` |
| **Workspace** | The Log Analytics database where queryable rows live | `law-devpolaris-prod` |
| **Instrumentation** | The code or agent path that sends telemetry | Azure Monitor OpenTelemetry Distro in the Orders API |
| **Request** | One incoming operation handled by the app | `POST /checkout` |
| **Dependency** | One outbound call made by the app | SQL write to `orders-db-prod` |
| **Exception** | Error information from code | SQL timeout exception |
| **Trace** | App log or diagnostic message | `charge approved, writing order` |
| **Operation ID** | The shared value that ties rows from one operation together | `checkout-5001` |

That table is the map for the article. Application Insights becomes useful because it connects these pieces. A single failed checkout becomes a readable story instead of a pile of separate log lines.

## The Application Signal
<!-- section-summary: Platform metrics show the outside of a running resource, while Application Insights records what the application did inside one operation. -->

Azure already knows many things about a running resource. Container Apps, App Service, Functions, Azure SQL, and Storage can all produce platform metrics and resource logs. Those signals answer questions such as CPU usage, memory pressure, replica count, HTTP status at the platform edge, database DTU pressure, storage throttling, and resource configuration changes.

Application Insights adds the application side of the story. It answers questions such as which route ran, how long the handler took, which database call slowed down, which exception type appeared, which user or tenant felt the issue, and which log messages belonged to the same operation. That difference matters during incidents because a resource can look healthy while one important workflow fails inside the code.

Imagine the Orders API after a release. CPU sits at 38 percent, memory looks stable, and the container has healthy replicas. At the same time, checkout fails for customers because the code calls a SQL stored procedure with a parameter that the new database migration changed. Platform metrics show a quiet host, while Application Insights shows `POST /checkout` returning `500`, a SQL dependency timing out, and an exception coming from the repository layer.

This is why teams usually combine three levels of evidence:

| Evidence level | What it answers | Example |
| --- | --- | --- |
| **Platform metrics** | Is the hosting resource under pressure? | Container CPU, memory, replicas, restart count |
| **Resource logs** | What did the Azure service report? | Azure SQL audit logs, Storage firewall logs |
| **Application telemetry** | What did the code do during one operation? | Request, dependency, exception, trace, operation ID |

The previous article focused on routing logs into a workspace. Now the team needs to make sure the app actually sends meaningful telemetry into that workspace. That takes us to the resource connection and instrumentation path.

## Workspace and Instrumentation Path
<!-- section-summary: A workspace-based Application Insights component receives telemetry from instrumented code and stores queryable rows in Log Analytics. -->

A modern Application Insights setup usually has two Azure resources working together. The **Application Insights component** represents the monitored application in Azure Monitor. The **Log Analytics workspace** stores the queryable telemetry tables. Microsoft calls this a workspace-based resource because Application Insights uses the workspace as the storage and query home.

In production, the Orders team treats the Application Insights component as part of the application contract. The app code sends telemetry to `appi-devpolaris-orders-prod`, and that component writes records into `law-devpolaris-prod`. The workspace then contains tables such as `AppRequests`, `AppDependencies`, `AppExceptions`, `AppTraces`, and `AppMetrics`.

The application needs a destination value so the telemetry exporter knows where to send data. In Application Insights, that value is the **connection string**. It identifies the Application Insights resource and its ingestion endpoints. The instrumentation key inside the connection string identifies the resource; it is an identifier rather than a password, but teams still pass it through app settings so environments stay clean and deployments stay repeatable.

A small Bicep shape looks like this:

```bicep
param subscriptionId string
param resourceGroupName string
param location string = resourceGroup().location
param workspaceName string = 'law-devpolaris-prod'
param appInsightsName string = 'appi-devpolaris-orders-prod'

var workspaceResourceId = '/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.OperationalInsights/workspaces/${workspaceName}'

resource applicationInsightsComponent 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspaceResourceId
  }
}
```

This creates the monitoring resource and links it to the workspace. The application still needs instrumentation. For most code-based server-side apps, Microsoft recommends the Azure Monitor OpenTelemetry Distro. In plain English, the distro is the package that plugs into your runtime, collects telemetry in the OpenTelemetry format, and exports it to Azure Monitor.

For the Orders API, the runtime setting might look like this:

```bash
APPLICATIONINSIGHTS_CONNECTION_STRING="InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://westeurope-0.in.applicationinsights.azure.com/"
```

The exact app setting depends on the hosting service. App Service, Azure Functions, Container Apps, AKS, and VMs all have slightly different places to put runtime settings. The shape stays the same: create the Application Insights component, link it to a workspace, add instrumentation to the app, and configure the connection string for the correct environment.

![Application Insights telemetry path from an Orders API through OpenTelemetry instrumentation, an Application Insights component, Log Analytics tables, and KQL portal views](/content-assets/articles/article-cloud-providers-azure-observability-azure-application-insights-backend-apis/telemetry-path.png)

*The useful path is not just app to dashboard. Instrumentation sends runtime evidence into an Application Insights component, the workspace stores typed tables, and KQL or portal views turn those rows into answers.*

Once telemetry starts flowing, the first row most backend teams inspect is the request row.

## Requests
<!-- section-summary: A request row records one incoming operation handled by the application, including route, result, duration, success, role, and operation ID. -->

A **request** is one incoming operation handled by the application. For a web API, that usually means one HTTP request such as `POST /checkout`, `GET /orders/{id}`, or `POST /payments/webhook`. Application Insights stores those records in the `AppRequests` table when you query through Log Analytics.

The request row gives the first shape of the incident. It tells the team what route ran, when it started, how long it took, whether the app counted it as successful, which result code the app returned, and which application role produced the row. For `devpolaris-orders-api`, the request row for the failed checkout might say `Name = POST /checkout`, `ResultCode = 500`, `DurationMs = 1840`, `Success = false`, and `OperationId = checkout-5001`.

Here is a first query an engineer might run during the support ticket:

```kusto
AppRequests
| where TimeGenerated between (datetime(2026-06-11T09:30:00Z) .. datetime(2026-06-11T10:00:00Z))
| where Name == "POST /checkout"
| project TimeGenerated, AppRoleName, OperationId, Name, ResultCode, DurationMs, Success
| order by TimeGenerated desc
```

The important beginner habit is to keep the request row as the entry point, because it gives the team the operation ID that connects the rest of the evidence. If support already gives `checkout-5001`, the team can start with that ID. If support gives only a time window and a route, the request table often helps find the right operation.

Common request fields look like this:

| Field | What it tells you | Orders example |
| --- | --- | --- |
| `TimeGenerated` | When the request started | `2026-06-11T09:42:12Z` |
| `AppRoleName` | Which app role emitted the row | `devpolaris-orders-api` |
| `Name` | Route or operation name | `POST /checkout` |
| `ResultCode` | Response code from the app | `500` |
| `DurationMs` | How long the app took | `1840` |
| `Success` | Whether the app marked the request successful | `false` |
| `OperationId` | Shared operation identifier | `checkout-5001` |

The request row tells us the user-facing result, but checkout rarely lives inside one function call. It writes a database row, calls a payment provider, stores a receipt, publishes an event, or calls another service. Those outbound calls are dependencies.

## Dependencies
<!-- section-summary: A dependency row records one outbound call from the application to another service, database, storage account, queue, or API. -->

A **dependency** is something your application calls while it handles work. For a backend API, that might be Azure SQL, Cosmos DB, Blob Storage, Service Bus, Redis, a payment provider, another internal HTTP service, or a file system call on a VM. Application Insights stores dependency records in `AppDependencies`.

Dependency rows matter because many user-facing failures start outside the route handler. The checkout controller may be fine, while the SQL write takes 1.7 seconds and times out. The receipt upload may fail because Storage rejects the request. A downstream payment API may return `429` because the app crossed a rate limit.

The Orders team can query dependencies for the same operation ID:

```kusto
AppDependencies
| where OperationId == "checkout-5001"
| project TimeGenerated, AppRoleName, DependencyType, Target, Name, ResultCode, DurationMs, Success
| order by TimeGenerated asc
```

A useful result might look like this:

| TimeGenerated | DependencyType | Target | Name | ResultCode | DurationMs | Success |
| --- | --- | --- | --- | --- | --- | --- |
| `09:42:12.120` | `HTTP` | `payments.example.com` | `POST /authorize` | `200` | `210` | `true` |
| `09:42:12.421` | `SQL` | `orders-db-prod.database.windows.net` | `InsertOrder` | `Timeout` | `1500` | `false` |
| `09:42:13.930` | `Blob` | `stordersprod.blob.core.windows.net` | `Put receipt` | `Skipped` | `0` | `false` |

Now the story has moved. The request failed with a `500`, and the dependency evidence points at a SQL timeout during the order write. That still leaves a code question. Did the app throw an exception after the dependency failed? Did the logs include the order ID, tenant ID, or retry decision? Exceptions and traces answer that next layer.

## Exceptions and Traces
<!-- section-summary: Exceptions capture code errors, while traces capture app log messages and checkpoints from the same operation. -->

An **exception** is error information from the application runtime. It usually includes an exception type, message, method, stack details, severity, and operation ID. Application Insights stores these rows in `AppExceptions`, and the exact detail depends on the runtime, instrumentation, and how the application handles errors.

A **trace** is an application log or diagnostic message emitted by the code. It might come from a logging framework, OpenTelemetry log exporter, or Application Insights SDK path. Application Insights stores those rows in `AppTraces`, with fields such as `Message`, `SeverityLevel`, `Properties`, `AppRoleName`, and `OperationId`.

For the failed checkout, exceptions and traces add the human-readable code story:

```kusto
AppExceptions
| where OperationId == "checkout-5001"
| project TimeGenerated, AppRoleName, ExceptionType, OuterMessage, Method, SeverityLevel
| order by TimeGenerated asc
```

```kusto
AppTraces
| where OperationId == "checkout-5001"
| project TimeGenerated, AppRoleName, SeverityLevel, Message, Properties
| order by TimeGenerated asc
```

The exception query might show `SqlTimeoutException` from `OrdersRepository.InsertOrder`. The trace query might show `checkout validation complete`, `payment authorization approved`, and `order write failed after sql timeout`. Those messages matter because the dependency row tells us the SQL call failed, while the trace tells us what the app had already done before the failure.

This is also where structured logging pays off. A trace message such as `order write failed` helps a little. A trace with properties such as `orderId`, `customerId`, `tenantId`, `releaseVersion`, `correlationId`, and `featureFlag` helps much more. The `Properties` column can carry that extra context, and operators can filter or summarize by those values during an incident.

So far we have talked about four telemetry types. Requests, dependencies, exceptions, and traces all become useful together because they share a correlation path. That path is the next concept.

## Correlation
<!-- section-summary: Correlation ties request, dependency, exception, and trace rows from the same operation into one readable timeline. -->

**Correlation** means connecting separate telemetry rows that belong to the same operation. A checkout request can create one request row, several dependency rows, one exception row, and many trace rows. Correlation gives those rows shared fields so the team can follow the operation instead of searching every table by hand.

The field beginners see first is usually `OperationId`. In our scenario, `checkout-5001` is the value that connects the request, SQL dependency, exception, and logs. Application Insights also uses parent and child identifiers, such as `Id` and `ParentId`, to show which operation created which child call.

This connects to the wider tracing world. **Distributed tracing** follows work across services. **W3C Trace Context** is the standard header format that lets services pass trace identity through HTTP calls. A **span** is one timed unit of work inside a trace, such as the incoming request span or the SQL dependency span. OpenTelemetry uses this language, and Application Insights maps the collected telemetry into Azure Monitor tables and portal views.

A common production setup carries both platform correlation and business correlation. Application Insights might use `OperationId = checkout-5001`, while the app logs also carry `correlationId = corr-checkout-5001` and `orderId = ord-8147`. The operation ID connects telemetry rows. The business IDs help the team connect telemetry to support tickets, database records, customer communication, and audit trails.

The safest habit is to keep these identifiers consistent and visible:

| Identifier | Where it helps | Orders example |
| --- | --- | --- |
| `OperationId` | Connects telemetry rows in Application Insights | `checkout-5001` |
| `Id` | Identifies one telemetry item, such as a request or dependency span | Request row ID |
| `ParentId` | Shows which telemetry item created this child item | SQL dependency parent points to request |
| `correlationId` | App-defined value that can appear in logs and messages | `corr-checkout-5001` |
| `orderId` | Business record for support and audit | `ord-8147` |
| `AppRoleName` | Service or component name on maps and queries | `devpolaris-orders-api` |

Correlation gives the team the thread. Now the team can write one query that assembles the whole failed checkout timeline.

## Querying One Checkout Failure
<!-- section-summary: A combined KQL query can show the request, dependencies, exceptions, and traces for one operation in chronological order. -->

KQL becomes very practical once the team has the operation ID. The goal is simple: pull the important rows from the main Application Insights tables, shape them into similar columns, and sort them by time. That gives the incident channel one readable timeline.

Here is a combined query for operation ID `checkout-5001`:

```kusto
let operationId = "checkout-5001";
union
  (AppRequests
    | where OperationId == operationId
    | project TimeGenerated, Type, AppRoleName, Name, ResultCode, DurationMs, Success, Detail = tostring(Url)),
  (AppDependencies
    | where OperationId == operationId
    | project TimeGenerated, Type, AppRoleName, Name, ResultCode, DurationMs, Success, Detail = strcat(DependencyType, " ", Target)),
  (AppExceptions
    | where OperationId == operationId
    | project TimeGenerated, Type, AppRoleName, Name = ExceptionType, ResultCode = "", DurationMs = real(null), Success = false, Detail = OuterMessage),
  (AppTraces
    | where OperationId == operationId
    | project TimeGenerated, Type, AppRoleName, Name = Message, ResultCode = "", DurationMs = real(null), Success = bool(null), Detail = tostring(Properties))
| order by TimeGenerated asc
```

The result should read like a timeline:

| TimeGenerated | Type | Name | Detail | DurationMs | Success |
| --- | --- | --- | --- | --- | --- |
| `09:42:12.005` | `AppRequests` | `POST /checkout` | `/checkout` | `1840` | `false` |
| `09:42:12.040` | `AppTraces` | `checkout validation complete` | `orderId=ord-8147` | | |
| `09:42:12.120` | `AppDependencies` | `POST /authorize` | `HTTP payments.example.com` | `210` | `true` |
| `09:42:12.421` | `AppDependencies` | `InsertOrder` | `SQL orders-db-prod.database.windows.net` | `1500` | `false` |
| `09:42:13.925` | `AppExceptions` | `SqlTimeoutException` | `Execution timeout expired` | | `false` |
| `09:42:13.940` | `AppTraces` | `checkout failed before receipt write` | `release=2026.06.11.2` | | |

![One operation ID connecting Application Insights request, trace, dependency, and exception rows for a checkout failure](/content-assets/articles/article-cloud-providers-azure-observability-azure-application-insights-backend-apis/checkout-operation-timeline.png)

*The operation ID is the thread through the incident. The request shows the user-facing failure, traces explain the app's checkpoints, dependencies show the slow SQL call, and the exception names the code failure.*

This is the moment Application Insights earns its keep. The team can explain the failed checkout without guessing from CPU graphs or reading a thousand unrelated log lines. The request failed, payment authorization succeeded, the SQL order write timed out, the app threw a SQL timeout exception, and the receipt write never ran.

That timeline works well for one operation. During a wider incident, the team also needs to see patterns across routes, dependencies, and services. Application Insights gives portal views for that wider shape.

## Application Map and Performance Views
<!-- section-summary: Application Map, failures, and performance views turn telemetry into a service topology and help teams find hot routes and bad dependencies. -->

**Application Map** is the Application Insights view that shows application components and their dependencies as a topology. A node might represent the Orders API, the checkout worker, or another application role. A line might represent an HTTP dependency, SQL call, queue call, or storage dependency discovered from telemetry.

The map uses fields such as application role name and dependency calls to build the picture. This is why naming matters. If every service reports the same role name, the map becomes a blob of mixed telemetry. If `devpolaris-orders-api`, `devpolaris-checkout-worker`, and `devpolaris-receipt-worker` each report clear role names, the map can show which component talks to which dependency.

For the checkout incident, the map can show the Orders API connected to Azure SQL, Blob Storage, and the payment provider. If the SQL connector has a high failure rate or long average duration, the map makes the relationship visible. The operator can select the node or connector and jump into failures, performance, transaction details, or Logs for deeper KQL work.

The portal also has **Failures** and **Performance** views. Failures helps the team group failed operations, exceptions, and failing dependencies. Performance helps the team find slow routes, slow dependencies, and latency patterns. These views help during triage because the team can start broad, find the hotspot, and then drop into the exact operation timeline.

Here are common ways teams use these views:

| View | Good first question | Orders example |
| --- | --- | --- |
| **Application Map** | Which component or dependency looks unhealthy? | SQL connector from Orders API has rising failures |
| **Failures** | Which operation or exception type appears most? | `POST /checkout` and `SqlTimeoutException` spike after release |
| **Performance** | Which route or dependency adds latency? | `InsertOrder` p95 moves from 80 ms to 1400 ms |
| **Transaction details** | What happened inside one operation? | `checkout-5001` request, dependencies, exception, traces |
| **Logs** | What exact query proves the story? | Combined KQL timeline for the operation |

As traffic grows, telemetry volume grows too. A busy API can create a request row, many dependency spans, traces, metrics, and exceptions for every operation. That makes sampling, filtering, privacy, and cost part of the design rather than an afterthought.

## Sampling, Privacy, and Cost
<!-- section-summary: Production telemetry needs volume control, useful filtering, and careful handling of sensitive data before rows land in a workspace. -->

**Sampling** means keeping a controlled portion of telemetry instead of storing every trace from every request. This matters because high-volume applications can produce a lot of telemetry, and Azure Monitor charges for data ingestion and retention. Sampling helps control cost while keeping enough evidence for troubleshooting.

With OpenTelemetry-based Application Insights, Microsoft documents two common sampling styles. **Fixed-rate sampling** keeps a percentage of traces, such as about 10 percent. **Rate-limited sampling** keeps up to a maximum number of traces per second. The important production idea is trace completeness: sampling should keep the pieces of a trace together so the request, dependencies, and spans still tell a coherent story.

Sampling has a tradeoff. For routine successful requests, a sampled trace may be enough. For errors, critical workflows, canary releases, and payment paths, the team may want more complete evidence. Many teams pair sampling with focused logging levels, custom metrics, alert rules, and short-term overrides during high-risk releases.

**Filtering** means dropping or reshaping low-value telemetry before storage. For example, the Orders team may decide that `/healthz` requests add noise because the platform probes the route many times per minute. The team may also filter debug logs that contain large payloads. Application Insights and Azure Monitor support filtering paths through OpenTelemetry configuration and through workspace transformation data collection rules for supported tables.

**Privacy** means keeping secrets and personal data out of telemetry. This is a production access, retention, and trust concern. Queryable logs often reach many engineers, incident tools, dashboards, exports, and retention policies. Application code should avoid sending passwords, tokens, full credit card data, raw request bodies, full authorization headers, and unnecessary personal data in trace messages or dependency details.

A practical production checklist looks like this:

| Area | Safer practice | Orders example |
| --- | --- | --- |
| **Sampling** | Keep traces coherent and review error coverage | Keep checkout failures and release canary traces easy to inspect |
| **Health checks** | Reduce noisy routine probes | Filter or downsample `/healthz` request telemetry |
| **Log level** | Send actionable logs from production | Prefer warnings and errors over verbose debug payloads |
| **Properties** | Store useful IDs without raw secrets | `orderId`, `tenantId`, `releaseVersion`, `correlationId` |
| **Sensitive data** | Redact secrets before export | Avoid tokens, card data, passwords, and raw request bodies |
| **Retention** | Match retention to incident and compliance needs | Keep hot telemetry for operational review, archive only what policy needs |

Now we have the operating choices. The remaining question is how new applications should collect telemetry in a portable way. That brings us to OpenTelemetry.

## OpenTelemetry Setup
<!-- section-summary: OpenTelemetry gives applications a standard way to produce telemetry, and the Azure Monitor distro exports it to Application Insights. -->

**OpenTelemetry** is an open-source observability standard for traces, metrics, and logs. It gives teams common language and APIs for spans, resources, attributes, context propagation, exporters, and collectors. In simple terms, OpenTelemetry helps the app describe what happened, and an exporter sends that description to a backend such as Azure Monitor.

Microsoft recommends the **Azure Monitor OpenTelemetry Distro** for most code-based server-side Application Insights scenarios. A distro is a packaged set of OpenTelemetry components chosen and configured to work well together. The Azure Monitor distro collects common telemetry, supports Azure Monitor features, and exports data to Application Insights through the connection string.

The setup path has four ordinary steps:

1. Create a workspace-based Application Insights resource.
2. Get the Application Insights connection string.
3. Add the Azure Monitor OpenTelemetry Distro to the app.
4. Configure the app setting that points telemetry at the right resource.

The exact code depends on the runtime. The idea stays the same across .NET, Java, Node.js, Python, containers, VMs, and many Azure hosting services. The app emits telemetry with service names, spans, metrics, logs, and useful attributes. Application Insights receives that data and makes it available through portal views and Log Analytics tables.

For a Node.js API, the setup can look like this. The telemetry bootstrap should run before the web framework, database client, or HTTP client starts handling work, because instrumentation needs to see those libraries early.

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

In production, teams pass the connection string through the hosting environment rather than source code. For Container Apps, App Service, Functions, AKS, or a VM, the deployment pipeline should set `APPLICATIONINSIGHTS_CONNECTION_STRING` per environment and keep the value out of the repository. The application startup should also set a clear service or role name so the emitted rows identify `devpolaris-orders-api` instead of a generic process name.

Good setup also names the application role clearly. `devpolaris-orders-api` tells the map and queries what emitted the telemetry. A vague role name such as `web` becomes painful once a system has several APIs, workers, jobs, and background consumers. The role name should match how the team talks about the service during incidents.

For the Orders API, the production telemetry contract might say:

| Contract item | Production value |
| --- | --- |
| Application Insights component | `appi-devpolaris-orders-prod` |
| Workspace | `law-devpolaris-prod` |
| App role name | `devpolaris-orders-api` |
| Required properties | `correlationId`, `orderId`, `tenantId`, `releaseVersion` |
| High-value operations | `POST /checkout`, payment authorization, order write, receipt write |
| Noise policy | Filter routine health probes and verbose request bodies |
| Review path | Application Map, Failures, Performance, KQL timeline |

With that contract in place, a future incident has a known path. The team does not have to invent observability during the outage. They follow the telemetry that the app already emits.

## Validate the Telemetry Path
<!-- section-summary: After instrumentation is deployed, a small smoke test should prove that requests, dependencies, traces, exceptions, and operation IDs reach the workspace. -->

Application Insights setup finishes only after the team proves that telemetry is flowing. Microsoft documentation warns that data can take a few minutes to appear, so the first validation should use a short recent window and a route that the team can trigger on purpose. For the Orders API, a staging smoke test can call `POST /checkout` with a safe test order and then run a query in `law-devpolaris-prod` or the staging workspace.

```kusto
AppRequests
| where TimeGenerated > ago(30m)
| where AppRoleName == "devpolaris-orders-api"
| summarize requests = count(), failures = countif(Success == false), latest = max(TimeGenerated)
```

That query confirms the request table and app role. The next check proves dependency tracking, because checkout is only useful if the SQL, storage, payment, and messaging calls appear as related evidence.

```kusto
AppDependencies
| where TimeGenerated > ago(30m)
| where AppRoleName == "devpolaris-orders-api"
| summarize calls = count(), failedCalls = countif(Success == false) by DependencyType, Target
| order by failedCalls desc, calls desc
```

The team should also validate one correlated timeline. Pick a recent operation ID from `AppRequests`, then query requests, dependencies, exceptions, and traces together. If dependencies appear with a different operation ID, or traces miss the custom properties the incident process expects, the setup needs a fix before the next release.

```kusto
let operationId = toscalar(
  AppRequests
  | where TimeGenerated > ago(30m)
  | where AppRoleName == "devpolaris-orders-api"
  | top 1 by TimeGenerated desc
  | project OperationId
);
union AppRequests, AppDependencies, AppExceptions, AppTraces
| where OperationId == operationId
| project TimeGenerated, Type, AppRoleName, Name, ResultCode, Success, DurationMs, OperationId
| order by TimeGenerated asc
```

A practical release gate can be small: one successful checkout, one controlled validation failure, one dependency call, one trace with `releaseVersion`, and one operation timeline that links the rows. That gate catches broken connection strings, missing role names, noisy health probes, and lost correlation while the team still has deployment context fresh in their heads.

## Putting It All Together
<!-- section-summary: Application Insights turns one failed checkout into a connected evidence story across request, dependency, exception, trace, and map views. -->

Let's walk the full incident one last time. A customer reports that checkout failed at 09:42 UTC. Support finds operation ID `checkout-5001` and sends it to engineering. The Orders API reports telemetry to `appi-devpolaris-orders-prod`, and the component stores queryable rows in `law-devpolaris-prod`.

The engineer starts with `AppRequests` and confirms `POST /checkout` returned `500` after 1840 ms. The request row gives the app role, route, result code, duration, success flag, and operation ID. That gives the team the entry point into the rest of the operation.

Next, the engineer queries `AppDependencies` for the same operation ID. Payment authorization succeeded in 210 ms, while the Azure SQL order insert timed out after 1500 ms. That moves the incident from a vague checkout failure to a specific failed dependency call.

Then the engineer checks `AppExceptions` and `AppTraces`. The exception shows a SQL timeout in `OrdersRepository.InsertOrder`, and the traces show that validation and payment succeeded before the order write failed. The app never reached the receipt write, so the team avoids chasing Blob Storage or email delivery.

Finally, the engineer checks Application Map and Performance views. The SQL connector from `devpolaris-orders-api` has elevated duration and failure rate since release `2026.06.11.2`. The team now has the release, route, dependency, exception, and operation timeline needed for a rollback or narrow database fix.

That is the beginner win. Application Insights helps the team explain what happened inside the app without guessing from platform health alone. Requests tell the user-facing result, dependencies show outbound calls, exceptions show code failures, traces add human context, correlation connects the rows, maps show the wider service shape, and sampling plus privacy rules keep the telemetry useful in production.

![Application Insights operating loop showing instrumentation, collection, correlation, querying, mapping, cost control, and the four signal types combining into one incident story](/content-assets/articles/article-cloud-providers-azure-observability-azure-application-insights-backend-apis/application-insights-operating-loop.png)

*A production team repeats this loop: instrument the app, collect the main signal types, correlate them, query the incident, map the wider service shape, and control telemetry cost so the evidence stays useful.*

## References
<!-- section-summary: Microsoft Learn documentation backs the Application Insights concepts, tables, resource setup, maps, sampling, and OpenTelemetry guidance in this article. -->

- [Introduction to Application Insights - OpenTelemetry observability](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview) - Microsoft overview of Application Insights as an Azure Monitor APM feature, its investigation views, and the current OpenTelemetry setup path.
- [Application Insights telemetry data model](https://learn.microsoft.com/en-us/azure/azure-monitor/app/data-model-complete) - Microsoft reference for request, dependency, exception, trace, metric, and other telemetry types.
- [Create and configure Application Insights resources](https://learn.microsoft.com/en-us/azure/azure-monitor/app/create-workspace-resource) - Microsoft guide for creating workspace-based Application Insights resources, retrieving connection strings, and configuring monitoring.
- [Connection strings in Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/connection-strings) - Microsoft explanation of connection strings, instrumentation keys, application IDs, and ingestion endpoints.
- [Enable OpenTelemetry in Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable) - Microsoft setup guide that also explains how to confirm telemetry is flowing after instrumentation.
- [Configure OpenTelemetry in Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-configuration) - Microsoft configuration guide for OpenTelemetry setup across supported runtimes.
- [Azure Monitor OpenTelemetry for JavaScript](https://learn.microsoft.com/en-us/javascript/api/overview/azure/monitor-opentelemetry-readme?view=azure-node-latest) - Microsoft JavaScript package reference for `@azure/monitor-opentelemetry`, connection strings, and sampling configuration.
- [Dependency tracking in Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/dependencies) - Microsoft guide to tracking outbound calls such as HTTP, database, and storage dependencies.
- [Application Map in Azure Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-map) - Microsoft guide to the topology view, component nodes, dependency edges, failures, performance, and transaction detail entry points.
- [W3C Trace Context](https://www.w3.org/TR/trace-context/) - Official standard for propagating trace context across services for distributed tracing.
- [Sampling in Azure Monitor Application Insights with OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-sampling) - Microsoft guidance on fixed-rate sampling, rate-limited sampling, trace completeness, and cost control.
- [Filter Azure Monitor OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-filter) - Microsoft guidance on filtering telemetry and mapping OpenTelemetry signals to Application Insights tables.
- [AppRequests table reference](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/apprequests) - Microsoft table reference for request fields such as `Name`, `ResultCode`, `DurationMs`, `Success`, and `OperationId`.
- [AppDependencies table reference](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/appdependencies) - Microsoft table reference for dependency fields such as `DependencyType`, `Target`, `ResultCode`, `DurationMs`, and `OperationId`.

## What's Next

Application Insights gives the team a way to investigate one operation and understand application behavior from the inside. The next article turns those signals into operating loops with metrics, dashboards, alert rules, action groups, and alert noise control.
