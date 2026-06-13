---
title: "Logs and Workspaces"
description: "Collect Azure resource logs and application logs into Log Analytics workspaces, then query them with KQL."
overview: "Useful Azure log work connects the resource that emits evidence, the diagnostic setting that routes it, the workspace that stores it, the table that shapes it, and the KQL query that turns it into an answer. This article follows one checkout failure through Azure Monitor, diagnostic settings, Log Analytics workspaces, tables, KQL, retention, cost, and access."
tags: ["azure-monitor", "log-analytics", "diagnostic-settings", "kql"]
order: 2
id: article-cloud-providers-azure-observability-azure-monitor-log-analytics
aliases:
  - azure-monitor-and-log-analytics
  - cloud-providers/azure/observability/azure-monitor-and-log-analytics.md
---

## Table of Contents

1. [The Production Question](#the-production-question)
2. [Azure Monitor and Azure Monitor Logs](#azure-monitor-and-azure-monitor-logs)
3. [Diagnostic Settings](#diagnostic-settings)
4. [Verifying the Log Route](#verifying-the-log-route)
5. [Log Analytics Workspace](#log-analytics-workspace)
6. [Tables](#tables)
7. [KQL](#kql)
8. [Finding One Checkout Failure](#finding-one-checkout-failure)
9. [Retention, Cost, and Access](#retention-cost-and-access)
10. [Workspace Design Choices](#workspace-design-choices)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The Production Question
<!-- section-summary: Azure log work starts with one practical question: where will the evidence live when a production request fails? -->

Let's use one production story for the whole article. The DevPolaris Orders team runs `devpolaris-orders-api` on Azure Container Apps, sends customer traffic through Application Gateway, and stores observability data in a Log Analytics workspace named `law-devpolaris-prod`. A customer reports that checkout failed around `2026-05-07T09:42:00Z`, and the incident note includes operation ID `checkout-5001`.

At that moment, the Azure portal resource list can look calm. The Container App can still have healthy replicas, the gateway can still accept traffic, and the database can still respond to other requests. The team needs records from the running system: the app runtime message, the gateway status, the operation ID, the resource IDs, and the time window around the failure.

This article connects the pieces in the order the team needs them. **Azure Monitor** is the monitoring platform. **Diagnostic settings** route resource logs from Azure services. A **Log Analytics workspace** stores the records. **Tables** give those records a shape. **KQL** turns rows into an answer. **Retention, cost, and access** decide how long the evidence stays, how much it costs, and who can read it.

In real incidents, this order gives the team a checklist. First confirm that each resource has a route. Then confirm that the records reached the expected workspace. Then inspect the table and columns before writing the query. So we will start with Azure Monitor, then follow the records all the way to the KQL query.

![Azure resources flowing through diagnostic settings into Log Analytics tables and a KQL answer](/content-assets/articles/article-cloud-providers-azure-observability-azure-monitor-log-analytics/log-route-before-query.png)

*Logs become useful when the resource, diagnostic setting, workspace, table, and KQL answer are connected before the incident starts.*

## Azure Monitor and Azure Monitor Logs
<!-- section-summary: Azure Monitor collects telemetry, while Azure Monitor Logs stores detailed records that teams query during investigation. -->

**Azure Monitor** is Azure's monitoring platform for collecting, analyzing, visualizing, and alerting on telemetry from Azure resources, applications, and supporting systems. Telemetry is the evidence a running system emits about its behavior. In Azure, that evidence includes metrics, logs, traces, activity records, and alert data.

**Azure Monitor Logs** is the log data platform inside Azure Monitor. It stores detailed records in Log Analytics workspaces and lets you query those records with Kusto Query Language, usually shortened to **KQL**. When the Orders team wants to inspect one failed checkout request, they usually need logs, because logs carry event-level detail such as a message, status code, operation ID, resource ID, timestamp, and sometimes an exception text.

There are a few log types worth separating early. The **Azure Activity log** records subscription-level control-plane events, such as someone updating a resource, creating a diagnostic setting, or changing access. **Resource logs** come from Azure services and describe the operation of those resources, such as Application Gateway access records or Blob Storage read and write records. **Application logs and telemetry** come from the running app or instrumentation layer, such as Container App console logs or Application Insights request and exception records.

For `devpolaris-orders-api`, each type answers a different question. Activity records can show whether someone changed the gateway or diagnostic settings. Resource logs can show that Application Gateway returned HTTP `500` for `POST /checkout`. Application logs can show that the Container App printed `checkout failed while calling sql-devpolaris-orders-prod.database.windows.net`.

Knowing the log types gives the team the vocabulary. The next question is more operational: how do those records leave the Azure resources and arrive in `law-devpolaris-prod`?

## Diagnostic Settings
<!-- section-summary: Diagnostic settings are routing rules that tell Azure which resource logs and metrics to send to a destination such as a Log Analytics workspace. -->

A **diagnostic setting** is a routing rule on an Azure resource. It says which log categories or metrics Azure should collect from that resource and which destination should receive them. Microsoft documents that resource logs need diagnostic settings, and each setting defines both the data to collect and the destination to send it to.

Think about `ca-devpolaris-orders-prod`, the Container App that runs the Orders API. The team wants console logs and system logs in `law-devpolaris-prod`, so the Container App gets a diagnostic setting named `send-containerapp-logs-to-law`. The Application Gateway gets a separate diagnostic setting named `send-appgateway-logs-to-law`, because gateway access logs come from the gateway resource while app runtime logs come from the Container App.

Diagnostic settings can send data to several destination types. A **Log Analytics workspace** is the normal destination for interactive operations, KQL queries, dashboards, and log alerts. A **Storage account** is useful for cheaper audit archives or immutable long-term files. An **Event Hub** streams records to external tools such as a SIEM, a data platform, or a third-party observability system. Azure Monitor partner destinations also exist for supported integrations.

The important beginner detail is that diagnostic settings belong to the emitting resource. If only the Container App sends logs, the team sees only half the checkout path. During the incident, the app might show an internal timeout while the gateway evidence is missing, or the gateway might show a `500` while the app runtime record is missing.

Here is a small Bicep example for the Container App side of the story. The exact log category names vary by resource type, so production templates usually come from a tested module rather than a copy-paste guess.

```bicep
param containerAppName string = 'ca-devpolaris-orders-prod'
param workspaceName string = 'law-devpolaris-prod'

resource containerApp 'Microsoft.App/containerApps@2024-03-01' existing = {
  name: containerAppName
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-07-01' existing = {
  name: workspaceName
}

resource containerAppDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'send-containerapp-logs-to-law'
  scope: containerApp
  properties: {
    workspaceId: workspace.id
    logs: [
      {
        category: 'ContainerAppConsoleLogs'
        enabled: true
      }
      {
        category: 'ContainerAppSystemLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}
```

This template gives the app runtime a path into the workspace. The gateway needs its own diagnostic setting with gateway categories such as access, performance, and firewall logs. Now the records have a route, so the next thing to understand is the destination.

## Verifying the Log Route
<!-- section-summary: A diagnostic setting deserves a quick verification loop so the team knows which categories are enabled and whether rows reached the workspace. -->

After a diagnostic setting is deployed, the team should verify the route before they trust it during an incident. The first check is the resource-side configuration. Azure CLI can list the categories that a resource supports, then list the active diagnostic settings on that resource.

```bash
container_app_id="/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-app-prod/providers/Microsoft.App/containerApps/ca-devpolaris-orders-prod"

az monitor diagnostic-settings categories list \
  --resource "$container_app_id" \
  --query "[].name" \
  --output table

az monitor diagnostic-settings list \
  --resource "$container_app_id" \
  --output table
```

Those commands answer two practical questions. The category list tells the team which log and metric categories Azure exposes for this resource type. The diagnostic settings list tells the team whether a setting exists, which categories it enables, and which destination receives the records.

The second check happens in Log Analytics. After a few minutes of normal traffic, query the expected table for the resource ID and summarize the row count. The exact table depends on the resource and diagnostic mode, so the team starts with the table they expect and adjusts after checking the workspace schema.

```kusto
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(30m)
| where _ResourceId has "/containerApps/ca-devpolaris-orders-prod"
| summarize rows = count(), latest = max(TimeGenerated)
```

A zero-row result can mean the app did not emit logs, the category is disabled, the diagnostic setting points at a different workspace, ingestion has not completed yet, or the team queried the wrong table. That short list gives the operator a calm path: check the diagnostic setting, check the destination workspace, check the table schema, then generate a small known log event and query again.

## Log Analytics Workspace
<!-- section-summary: A Log Analytics workspace is the queryable data store where Azure Monitor Logs keeps collected records in tables. -->

A **Log Analytics workspace** is a data store for log data from Azure resources, non-Azure resources, and applications. In plain English, it is the place where collected log records become searchable. The Orders team uses `law-devpolaris-prod` as the production log home for the app, gateway, and application telemetry connected to the checkout system.

The workspace is more than a folder full of log files. It is a query boundary, a retention boundary, an access boundary, and a cost boundary. The team queries the workspace in Log Analytics, configures retention on the workspace and its tables, grants people access to the workspace or to resource-scoped data, and pays for the data ingested and retained there.

Inside the workspace, Azure Monitor Logs stores records in **tables**. Microsoft documents that a workspace contains multiple tables, and Azure Monitor creates many required tables automatically when data first arrives. For the Orders incident, `law-devpolaris-prod` might contain tables like these:

| Table | What it can tell the Orders team |
| --- | --- |
| `ContainerAppConsoleLogs_CL` | Runtime messages printed by `ca-devpolaris-orders-prod`, including app errors and revision details. |
| `AzureDiagnostics` | Gateway or other resource logs when a resource uses Azure Diagnostics mode. |
| `AGWAccessLogs` | Application Gateway access records when resource-specific tables are used. |
| `AppRequests` | Application Insights request records, including route, result code, duration, and operation ID. |
| `AppDependencies` | Outbound dependency calls, such as SQL, HTTP, or storage calls made by the app. |
| `AppExceptions` | Exception records that can hold the first useful code-level error. |

Notice that the workspace can hold records from different teams and resource groups. The app team may own the Container App, the network team may own the gateway, and the platform team may own the shared workspace. That split is normal in production, and it means naming, tags, resource IDs, and access rules need to stay clear.

The workspace gives the records a home. The table gives each record a shape, so the next section zooms in on tables and columns.

## Tables
<!-- section-summary: Tables organize log rows by schema, which lets engineers query the right columns instead of searching one giant text file. -->

A **table** is a named collection of log rows with a known set of columns. A row is one event or telemetry item. A column is one field on that row, such as `TimeGenerated`, `_ResourceId`, `OperationId`, `ResultCode`, `DurationMs`, `Message`, or `Category`.

This structure is the reason Log Analytics feels different from opening a raw `.log` file. The team can filter by time, resource ID, status code, operation ID, category, or duration and skip manual line parsing. A gateway access record and an app exception record have different columns because they describe different parts of the system.

Azure has both resource-specific tables and broader legacy-style tables. For example, Storage Blob resource logs can land in `StorageBlobLogs`, where fields such as `OperationName`, `StatusCode`, `ObjectKey`, `CallerIpAddress`, and `_ResourceId` make storage investigations very direct. Some resource logs can also appear in `AzureDiagnostics`, which is a wider table used by services in Azure Diagnostics mode.

Application Insights tables have their own shapes. `AppRequests` includes fields such as `Name`, `ResultCode`, `DurationMs`, `Success`, `OperationId`, and `TimeGenerated`. `AppDependencies` tells you about outbound calls from the app. `AppExceptions` carries exception information that often becomes the first useful developer clue.

During the `checkout-5001` incident, table choice changes the question. `ContainerAppConsoleLogs_CL` can answer what the Orders API printed. `AzureDiagnostics` or `AGWAccessLogs` can answer what the gateway saw. `AppRequests`, `AppDependencies`, and `AppExceptions` can answer how the application request, dependency call, and exception relate to one operation.

Tables give us the nouns. KQL gives us the grammar for asking useful questions about those nouns.

## KQL
<!-- section-summary: KQL is the read-only query language Azure Monitor Logs uses to filter, shape, join, and summarize workspace data. -->

**Kusto Query Language**, or **KQL**, is the read-only query language used by Azure Monitor Logs. Microsoft describes Azure Monitor log queries as using the same KQL foundation as Azure Data Explorer. A KQL query usually starts with a table name, then uses pipe-separated operators to filter, shape, group, and order the rows.

The first habit is to start with time. Log work can become expensive and noisy when the query scans a huge window, and incident work usually starts with a known time range. For the Orders incident, the team begins around `2026-05-07T09:42:00Z`, then expands the window if needed.

Here is the basic shape:

```kql
ContainerAppConsoleLogs_CL
| where TimeGenerated between (datetime(2026-05-07T09:35:00Z) .. datetime(2026-05-07T09:50:00Z))
| where OperationId == "checkout-5001"
| project TimeGenerated, OperationId, ResultCode, SeverityLevel, Message, _ResourceId
| order by TimeGenerated asc
```

Read the query from top to bottom. `ContainerAppConsoleLogs_CL` chooses the table. The first `where` narrows the time window. The second `where` keeps the one operation. `project` chooses the columns that matter for the incident note. `order by` puts the records into a timeline.

KQL names are case-sensitive, including table names, column names, operators, and functions. Real Azure schemas also vary across services and collection modes, so a careful engineer inspects the table schema before assuming a column name. If one table uses `OperationId` and another older example uses `operation_Id`, the spelling difference matters.

Once the team can write a small query, the next step is combining evidence from more than one table. That is where logs start helping with real production debugging.

## Finding One Checkout Failure
<!-- section-summary: A useful incident query connects runtime logs, gateway logs, and application telemetry around the same operation and time window. -->

Let's go back to the customer report. The user saw checkout fail. The operation ID is `checkout-5001`. The team has a short incident window around `09:42 UTC`, and the goal is to find the first useful error instead of collecting every possible row.

Start with the app runtime because it is closest to the code path. The Container App console log can show the message the application emitted, the revision that was running, and the result code the app recorded. A good first query keeps the window tight and selects only fields the incident note needs.

```kql
ContainerAppConsoleLogs_CL
| where TimeGenerated between (datetime(2026-05-07T09:35:00Z) .. datetime(2026-05-07T09:50:00Z))
| where OperationId == "checkout-5001"
| project TimeGenerated, SeverityLevel, ResultCode, Message, OperationId, _ResourceId
| order by TimeGenerated asc
```

A useful result might say `checkout failed while calling sql-devpolaris-orders-prod.database.windows.net` with result code `500`. That points toward the application path, but the user reached the app through Application Gateway. The next query checks what the gateway saw for the same time window.

```kql
AzureDiagnostics
| where TimeGenerated between (datetime(2026-05-07T09:35:00Z) .. datetime(2026-05-07T09:50:00Z))
| where _ResourceId has "/applicationGateways/agw-devpolaris-prod"
| where OperationId == "checkout-5001" or Message has "POST /checkout"
| project TimeGenerated, Category, ResultCode, Message, OperationId, _ResourceId
| order by TimeGenerated asc
```

If the gateway row says `Application Gateway backend ca-devpolaris-orders-prod returned 500 for POST /checkout`, the team now has two pieces of evidence. The gateway received the request and returned the backend failure to the user. The app runtime recorded a SQL-related failure at the same time and operation ID.

When Application Insights is connected to the same workspace, the team can build a wider timeline. This query unions common app and platform tables, filters the same operation, and sorts everything by time. It turns separate rows into one incident sequence.

```kql
union ContainerAppConsoleLogs_CL, AzureDiagnostics, AppRequests, AppDependencies, AppExceptions
| where TimeGenerated between (datetime(2026-05-07T09:35:00Z) .. datetime(2026-05-07T09:50:00Z))
| where OperationId == "checkout-5001"
| project TimeGenerated, Type, SeverityLevel, ResultCode, Message, OperationId, _ResourceId
| order by TimeGenerated asc
```

The final answer might be simple: `POST /checkout` returned `500`; the gateway passed that backend failure to the user; the app logged a SQL timeout; Application Insights recorded a dependency timeout and an exception. That is enough to move from "checkout is broken" to "the Orders API failed while calling SQL during one checkout operation."

![Checkout incident evidence connected by the same operation ID across gateway, runtime, dependency, and exception records](/content-assets/articles/article-cloud-providers-azure-observability-azure-monitor-log-analytics/operation-id-incident-trail.png)

*The operation ID keeps gateway, runtime, dependency, and exception evidence in one incident trail.*

Now the incident has an answer. The next production concern is keeping this evidence useful while the workspace stays focused, affordable, and properly protected.

## Retention, Cost, and Access
<!-- section-summary: Retention, cost, and access settings decide how long log data remains useful, how much the workspace costs, and who can read sensitive evidence. -->

**Retention** means how long log data stays available. Log Analytics has an interactive analytics retention period for normal queries and a long-term retention state for older data that can be retrieved through search jobs. Microsoft documents a common default of 30 days for many tables, longer defaults for some tables, analytics retention that can be extended for Analytics tables, and total retention that can reach long-term periods when the business needs it.

For the Orders team, 30 days might be enough for normal debugging, but some audit or security records may need a longer window. A payment-related access investigation might arrive months after the event. A gateway troubleshooting query from yesterday needs interactive search, while a compliance request from last quarter can tolerate a slower retrieval workflow.

**Cost** comes mostly from data ingestion and retention. Microsoft describes workspace cost around the data you ingest and keep, so every selected category can add volume. A noisy debug log category can become expensive quickly if every request prints full payloads, stack traces, or repeated health-check records.

The practical cost habit is to collect the categories the team will actually use. Container app console logs, gateway access logs, gateway firewall logs, Application Insights requests, dependencies, and exceptions can be valuable for the checkout path. A high-volume category with no owner, no query, and no retention reason deserves review before it becomes permanent production noise.

Azure Monitor can also transform or filter some incoming log data before it lands in a workspace through data collection rule-based transformations. This is useful for removing noisy fields, shaping records, or dropping known low-value rows such as routine health probes. Treat transformations like production code because they can remove evidence before anyone can query it. Keep the rule in infrastructure code, review it with the team that owns the incident process, and test a known event after every change.

**Access** controls who can read the log data. A Log Analytics workspace supports workspace-context access, where a user can query workspace data they have permission to see, and resource-context access, where a user opens logs from a resource and sees records associated with resources they can access. This is important because logs can contain URLs, account IDs, IP addresses, user identifiers, exception text, and operational details.

In `law-devpolaris-prod`, the platform team might have workspace-level permissions because they operate shared observability. The Orders app team might use resource-context access so they can inspect their Container App records while broad workspace visibility stays with the platform owners. Security engineers might have table or workspace access for specific audit investigations.

This is also why resource IDs matter. A log row with `_ResourceId` populated can support resource-context queries and cleaner filtering. When a query includes `_ResourceId`, the team can separate gateway evidence, app evidence, and Application Insights evidence even when those rows live in the same workspace.

Retention, cost, and access belong in the first design pass. They are part of the log design. That design shows up most clearly when the team chooses how many workspaces to create.

## Workspace Design Choices
<!-- section-summary: Workspace design balances shared investigation, environment separation, compliance boundaries, regional placement, cost ownership, and access control. -->

A **workspace design** is the decision about which logs go into which Log Analytics workspaces. Microsoft documents that a single workspace can collect many kinds of data, and multiple workspaces can help with regulatory requirements, data location, billing separation, and resilience. In real teams, the choice usually comes down to investigation needs and organizational boundaries.

A single shared production workspace supports cross-service incident queries. The Orders team can union app, gateway, dependency, and exception data in one place. The platform team can build shared dashboards and log alerts around one production workspace ID.

Separate workspaces make sense when the boundary matters more than one big query surface. Development and production usually deserve separate workspaces because dev logs can be noisy, experimental, and less protected. Regulated systems may need their own workspace because access, retention, and data residency rules are stricter. A large company may separate workspaces by business unit so cost ownership and permissions stay understandable.

For DevPolaris, `law-devpolaris-prod` is a reasonable production shared workspace for the Orders scenario. It sits in the observability resource group, receives logs from the app and gateway, and has a clear production retention policy. A matching `law-devpolaris-dev` workspace could collect development logs so test traffic stays out of production incident queries.

Here is a small workspace declaration that keeps the important production choices visible in code:

```bicep
param workspaceName string = 'law-devpolaris-prod'
param location string = resourceGroup().location

resource workspace 'Microsoft.OperationalInsights/workspaces@2025-07-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}
```

The name tells humans this is the production Log Analytics workspace. `retentionInDays` sets the default interactive retention for Analytics tables that still use the workspace default. `enableLogAccessUsingOnlyResourcePermissions` supports the resource-context access model, which helps application teams query logs for resources they are allowed to read.

A healthy workspace has a clear job. The team should be able to explain why a workspace exists, which resources send logs to it, who owns the cost, who can query it, and how long the data stays. That explanation saves time during the next incident.

## Putting It All Together
<!-- section-summary: Azure log operations work when resources route the right categories into a workspace, tables keep the data structured, and KQL turns records into an incident answer. -->

Let's connect the full path for `checkout-5001`. The Container App emits runtime messages. Application Gateway emits access records. Application Insights can emit requests, dependencies, and exceptions. Diagnostic settings route resource logs from the app and gateway into `law-devpolaris-prod`, while the Application Insights configuration writes application telemetry into workspace-backed tables.

The workspace stores those records in tables. `ContainerAppConsoleLogs_CL` carries the app runtime message, `AzureDiagnostics` or `AGWAccessLogs` carries gateway evidence, and Application Insights tables carry request, dependency, and exception detail. Each row has a timestamp, and many useful rows carry an operation ID or resource ID that lets the team connect them.

KQL turns that stored evidence into an answer. Start with a time window, filter by operation ID or resource ID, project the columns that matter, and order the results into a timeline. The team can then explain production behavior from records instead of container access, resource-health guesses, or screenshots from every service owner.

Good log design also includes operational guardrails. Retention keeps recent evidence queryable and older evidence retrievable when the business needs it. Cost review keeps noisy categories under control. Access design lets the right team see the right records while broad workspace exposure stays under control.

That is the practical value of Logs and Workspaces in Azure. They give the Orders team one reliable place to collect, structure, query, protect, and retain the evidence they need when production behavior has to be explained.

![Logs and Workspaces production checklist for collecting, storing, querying, and governing Azure log evidence](/content-assets/articles/article-cloud-providers-azure-observability-azure-monitor-log-analytics/logs-workspaces-checklist.png)

*The production checklist keeps log design grounded in four questions: collect, store, query, and govern.*

## What's Next
<!-- section-summary: Application Insights adds request, dependency, exception, trace, and correlation detail from inside application code. -->

You now have the workspace layer: resource logs are routed, stored in tables, queried with KQL, retained intentionally, and protected with access controls. That is enough to answer many platform and resource questions around a production incident.

The next article goes inside the application. Application Insights adds request telemetry, dependency calls, exceptions, traces, operation IDs, and correlation. That helps the Orders team follow one checkout request through code, SQL, storage, and downstream services instead of stopping at the gateway or container log.

---

**References**

- [Diagnostic settings in Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/platform/diagnostic-settings) - Explains diagnostic setting sources, destinations, category groups, limits, latency, and cost considerations.
- [az monitor diagnostic-settings CLI reference](https://learn.microsoft.com/en-us/cli/azure/monitor/diagnostic-settings?view=azure-cli-latest) - Documents CLI commands for listing, showing, creating, updating, and deleting resource diagnostic settings.
- [az monitor diagnostic-settings categories CLI reference](https://learn.microsoft.com/en-us/cli/azure/monitor/diagnostic-settings/categories?view=azure-cli-latest) - Documents how to list diagnostic setting categories for a resource before choosing which categories to route.
- [Log Analytics workspace overview](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/log-analytics-workspace-overview) - Defines Log Analytics workspaces, log tables, retention states, access concepts, transformations, and cost drivers.
- [Azure Monitor resource log and table reference](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables-index) - Lists Azure Monitor resource log tables and explains that resource logs are stored in tables when exported to a workspace.
- [Log queries in Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/log-query-overview) - Explains where Azure Monitor uses KQL queries, including Log Analytics, log alerts, workbooks, dashboards, automation, and APIs.
- [Kusto Query Language overview](https://learn.microsoft.com/en-us/kusto/query/?view=microsoft-fabric) - Describes KQL, pipe-separated tabular operators, read-only queries, and the data-flow query style.
- [Transformations in Azure Monitor](https://learn.microsoft.com/en-us/azure/azure-monitor/data-collection/data-collection-transformations) - Explains how Azure Monitor transformations can filter or modify incoming data before it reaches a Log Analytics workspace.
- [Manage data retention in a Log Analytics workspace](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-retention-configure) - Documents analytics retention, long-term retention, default periods, search jobs, and table-level retention behavior.
- [Manage access to Log Analytics workspaces](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/manage-access) - Explains workspace-context access, resource-context access, access control modes, Azure RBAC, and table-level access options.
- [StorageBlobLogs table reference](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/storagebloblogs) - Shows common Storage Blob log columns such as operation, status, caller IP, object key, resource ID, and billing fields.
- [AppRequests table reference](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/apprequests) - Documents request telemetry columns such as operation ID, result code, duration, success, resource ID, and timestamp.
