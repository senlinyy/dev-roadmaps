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

1. [The Problem](#the-problem)
2. [Metrics](#metrics)
3. [Platform Metrics](#platform-metrics)
4. [Application Metrics](#application-metrics)
5. [Dashboards](#dashboards)
6. [Alert Rules](#alert-rules)
7. [Action Groups](#action-groups)
8. [Alert Noise](#alert-noise)
9. [Putting It All Together](#putting-it-all-together)

## The Problem

The previous article followed one checkout request through Application Insights. That is perfect for a single user story. But the on-call question is often bigger:

- Is checkout failing for one customer or for everyone?
- Did latency rise after the last deployment?
- Is Azure SQL under pressure, or is the API waiting on another dependency?
- Why did support hear about the problem before engineering?

Metrics, dashboards, and alerts answer those broader operating questions. Metrics show numbers over time. Dashboards put important numbers where the team can see them together. Alert rules watch selected signals. Action groups decide who or what gets notified.

The goal is not to measure everything. The goal is to notice meaningful change early enough to respond.

## Metrics

A metric is a number collected at regular intervals. It might be request count, failure rate, p95 duration, CPU percentage, database storage used, queue length, or dependency failure count. Metrics are less detailed than logs, but they are easier to chart, compare, and alert on.

Metrics show shape:

```text
checkout_failed_requests
10:45  1
10:50  1
10:55  2
11:00  4
11:05  37
11:10  44
```

That shape tells the team the problem is growing. It does not explain the root cause by itself. The next move might be Application Insights failures, dependency telemetry, or Log Analytics queries. Metrics point you toward investigation.

For the orders API, a small first operating set is enough:

| Signal | Why it belongs |
| --- | --- |
| Request count | Shows whether traffic is normal. |
| Failed request rate | Shows user-visible failure. |
| p95 response time | Shows slow tail behavior, not only average speed. |
| Dependency failures | Shows downstream services involved in failures. |
| Runtime restarts or replica health | Shows whether the hosting layer is unstable. |
| Database pressure | Shows whether data capacity or query load may be involved. |

If a chart never changes what a person does, it probably does not belong on the first dashboard.

## Platform Metrics

Platform metrics come from Azure resources. Many Azure resources emit platform metrics automatically without extra configuration. Azure Monitor Metrics stores numeric data in a time-series database, and metrics explorer can help chart it.

For a backend, platform metrics might come from App Service, Container Apps, Azure SQL Database, storage accounts, load balancers, or other Azure services. These metrics answer platform-side questions:

| Resource | Metric-shaped question |
| --- | --- |
| App runtime | Is CPU, memory, replica count, or restart behavior changing? |
| Azure SQL | Is database CPU, DTU, connection, or storage pressure high? |
| Storage account | Are requests failing, throttling, or changing in volume? |
| Load balancer or gateway | Are backend health or response patterns changing? |

The beginner trap is assuming platform metrics explain the application by themselves. They do not know your checkout promise unless you connect them to app-level signals. A storage account can show failed requests, but Application Insights tells you whether those failures belonged to receipt uploads during checkout.

## Application Metrics

Application metrics describe behavior your application cares about. Some can come from Application Insights automatically, such as request duration and failed request count. Others are custom business metrics that your app emits intentionally.

For `devpolaris-orders-api`, useful application metrics might include:

| Application metric | Why it matters |
| --- | --- |
| Checkout attempts | Shows business flow volume, not just HTTP traffic. |
| Checkout success rate | Ties directly to customer impact. |
| Receipt upload failures | Points to one dependency in the workflow. |
| Payment authorization latency | Separates payment-provider slowness from API slowness. |
| Order creation retries | Reveals hidden instability before hard failures. |

Do not turn every log field into a metric. Metrics need stable meaning and bounded labels. A metric with a label for every user ID, order ID, or raw error message can become expensive and hard to use. Keep high-cardinality detail in logs and traces. Use metrics for trends and thresholds.

## Dashboards

A dashboard is a shared operating view. It should answer a job, not decorate a wall. The release dashboard answers, "did the deployment hurt the service?" The on-call dashboard answers, "is checkout healthy right now?" A storage dashboard answers, "are receipt and export files being written successfully?"

A focused orders API dashboard might look like this:

| Row | Signals | Question answered |
| --- | --- | --- |
| Top | Request count, failed request rate, p95 response time | Is the API healthy for users? |
| Middle | Checkout failures by route, dependency failures by target, database pressure | Where should we investigate first? |
| Bottom | Recent alerts, deployment marker, links to saved queries | What changed, and where do we drill in? |

The deployment marker is more valuable than it looks. Many incidents are questions about change. If latency rose two minutes after a release, the dashboard should make that relationship visible.

Avoid the giant dashboard that tries to answer every question. It becomes wallpaper. Start with the promises the service makes to users and the dependencies most likely to break those promises.

## Alert Rules

An alert rule watches data and fires when a condition is met. Azure Monitor alert rules combine the monitored resource, signal, condition, and actions. Metric alerts watch numeric time series. Log search alerts use KQL to watch query results. Other alert types exist, but those two are enough for this beginner module.

A useful alert has a clear action:

| Alert | Better than | Why |
| --- | --- | --- |
| Failed `POST /checkout` rate above 5 percent for 10 minutes | Any single checkout failure | Avoids paging for isolated noise. |
| p95 checkout latency above 2 seconds for 15 minutes | Average latency is high once | Catches sustained user pain. |
| Blob receipt upload failures above threshold | Storage account has some errors | Ties the signal to a workflow dependency. |
| Database pressure high and checkout latency high | Database CPU high alone | Combines platform pressure with user impact. |

The thresholds are examples, not universal numbers. A payment API, internal admin tool, and public checkout flow deserve different sensitivity. Good alerting starts with the service promise and the response you expect from a human.

## Action Groups

An action group decides what happens when an alert fires. It can notify people through channels such as email, SMS, push, voice, or integrations. It can also trigger automation through webhooks, Azure Functions, Logic Apps, ITSM tools, or related paths.

For beginners, read action groups as the routing layer for attention:

| Alert severity | Action group behavior |
| --- | --- |
| Critical user impact | Page the on-call engineer and post to the incident channel. |
| Important but not urgent | Notify the service channel or create a ticket. |
| Informational | Record it or show it on a dashboard without waking anyone. |

Action groups are reusable. The same on-call group can be attached to several alert rules. That is useful, but it also means changing an action group can affect many alerts. Treat action groups as shared operational objects, not casual notification lists.

## Alert Noise

Alert noise is what happens when alerts fire too often, fire without action, or fire for symptoms nobody owns. Noise trains people to ignore alerts, which is worse than having fewer alerts.

Common noise patterns:

| Noise pattern | Better design |
| --- | --- |
| Alert on every single failure | Alert on sustained rate or impact. |
| Alert on low-level resource pressure only | Pair resource pressure with user-facing impact when possible. |
| Alert without a first check | Include description, runbook, dashboard, or query link. |
| Alert every team for one service issue | Route to the owning service first, then escalate. |
| Alert during planned maintenance | Use alert processing rules, maintenance windows, or deployment-aware routing where appropriate. |

The point is not to hide problems. The point is to make alerts trustworthy. A trustworthy alert says, "this signal probably needs attention, and here is where to start."

## Putting It All Together

Return to the checkout incident.

- Metrics showed the failure rate rose from a few requests to a service-wide pattern.
- Platform metrics showed the storage account had failed requests, but not whether checkout caused them.
- Application metrics tied the failures to the checkout workflow.
- The dashboard put request count, failure rate, latency, dependency failures, and deployment timing in one view.
- The alert rule fired only after sustained user-visible impact.
- The action group routed the page to the service owner.
- Noise control kept the alert actionable instead of turning every blip into a wake-up.

This closes the observability module. Logs explain events. Workspaces make logs queryable. Application Insights connects one request story. Metrics and alerts show system shape and route human attention. Together, they turn a running Azure app from a black box into a system that can be understood.

---

**References**

- [Azure Monitor Metrics overview](https://learn.microsoft.com/en-us/azure/azure-monitor/metrics/data-platform-metrics)
- [Azure Monitor alerts overview](https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/alerts-overview)
- [Action groups](https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/action-groups)
- [Application Insights overview](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
