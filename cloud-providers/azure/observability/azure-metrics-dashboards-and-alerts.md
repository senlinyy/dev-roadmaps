---
title: "Azure Metrics, Dashboards, and Alerts"
description: "Use Azure Monitor metrics, dashboards, alert rules, and action groups to turn raw signals into operating awareness."
overview: "Metrics show shape, dashboards make shared views, alerts decide when humans should look, and action groups decide who gets notified. This article ties those pieces to one Azure backend."
tags: ["metrics", "dashboards", "alerts", "action-groups"]
order: 4
id: article-cloud-providers-azure-observability-azure-metrics-dashboards-alerts
---

## Table of Contents

1. [Numbers Help You See Shape](#numbers-help-you-see-shape)
2. [If You Know CloudWatch Alarms](#if-you-know-cloudwatch-alarms)
3. [Metrics Are Not Logs With Less Detail](#metrics-are-not-logs-with-less-detail)
4. [The Orders API Needs A Small Set Of Signals](#the-orders-api-needs-a-small-set-of-signals)
5. [Dashboards Are Shared Operating Views](#dashboards-are-shared-operating-views)
6. [Alerts Turn Signals Into Attention](#alerts-turn-signals-into-attention)
7. [Action Groups Decide Who Hears About It](#action-groups-decide-who-hears-about-it)
8. [Avoid Alert Noise Before It Trains The Team](#avoid-alert-noise-before-it-trains-the-team)
9. [Failure Modes And First Checks](#failure-modes-and-first-checks)
10. [A Practical Metrics And Alerts Review](#a-practical-metrics-and-alerts-review)

## Numbers Help You See Shape

Logs tell detailed stories. Metrics show shape. A
metric is a number collected over time. That number may
be request count, response time, failed request rate,
CPU usage, database pressure, storage capacity, or
queue length. When a backend is healthy, metrics show
its normal rhythm. When the backend changes, metrics
show the shape of that change. For
`devpolaris-orders-api`, a single checkout failure
matters. But the bigger question during an incident is
often: is this one user, or everyone? Metrics help
answer that. If failed checkout requests stay near zero
and one customer reports a problem, you may start with
one request trace.

If failed checkout requests jump across the service,
you need a broader incident path. Azure Monitor Metrics
is the Azure Monitor feature for numeric time-series
data. Many Azure resources emit platform metrics
without you writing application code. Application
Insights also creates application metrics for monitored
apps. Dashboards and workbooks help visualize signals.
Azure Monitor alerts watch signals and notify action
groups when conditions are met. The mental model is:
metrics show the system's shape. Dashboards help humans
share that view. Alerts decide when the shape needs
attention. Action groups decide who or what receives
that attention.

## If You Know CloudWatch Alarms

If you know AWS, Azure metrics and alerts will feel
familiar. CloudWatch metrics are close to Azure Monitor
Metrics. CloudWatch alarms are close to Azure Monitor
metric alerts or log search alerts. SNS topics or
notification targets are close to Azure Monitor action
groups in the beginner mental model. The names and
setup differ. Use this bridge:

| AWS idea you may know | Azure idea to compare first | Beginner translation |
|---|---|---|
| CloudWatch metric | Azure Monitor metric | A number collected over time |
| CloudWatch dashboard | Azure dashboard, workbook, or Grafana dashboard | A shared view of signals |
| CloudWatch alarm | Azure Monitor alert rule | A condition that fires when a signal crosses a rule |
| SNS notification path | Action group | Who or what gets notified |
| Metric math or log metric filters | Metric alerts or log search alerts | Different ways to turn data into alert conditions |

The transferable habit is: do not alert on everything
you can measure. Alert on signals that need human
action. Everything else can be a dashboard, query, or
investigation tool.

## Metrics Are Not Logs With Less Detail

Metrics and logs answer different questions. A log
might say:

```text
2026-05-03T11:21:04.332Z ERROR requestId=req_18b
operation=checkout dependency=azure-sql
message="database connection timeout"
```

That is detailed. It tells you one event happened. A
metric might say:

```text
checkout_failed_requests
10:55  1
11:00  2
11:05  3
11:10  29
11:15  41
```

That is not detailed. It tells you the shape changed.
The metric helps you notice the incident and measure
its size. The logs help you understand specific causes.
Azure platform metrics are useful because many
resources emit them automatically. App Service,
Container Apps, Azure SQL Database, storage accounts,
and other resources can expose resource-specific
metrics. Application Insights can add application-level
metrics such as request duration and failure rate.

The important habit is to pair metrics with the next
question. If request failures rise, which route is
failing? If latency rises, which dependency is slow? If
database pressure rises, did traffic rise too? Metrics
point you toward the next investigation. They do not
replace the investigation.

## The Orders API Needs A Small Set Of Signals

Beginners often create too many charts. A useful first
dashboard for `devpolaris-orders-api` can be small.
Start with the service's most important promises. Can
users place orders? Is checkout fast enough? Can the
API reach Azure SQL Database? Can the API upload
receipt files to Blob Storage? Is the app restarting
unexpectedly? Those promises become signals.

| Signal | Why it matters |
|---|---|
| Request count | Shows traffic level |
| Failed request rate | Shows user-visible failures |
| Response time | Shows whether checkout feels slow |
| Dependency failure count | Shows SQL, Blob, Cosmos DB, or HTTP call trouble |
| Azure SQL pressure | Shows whether database capacity or queries may be involved |
| Storage failure count | Shows receipt or export write problems |
| Restart count or replica health | Shows runtime instability |

This is enough for a first operating view. It is not
every metric Azure exposes. It is the small set that
helps a team answer: is the app serving customers right
now? When this set is stable, add more signals only
when they answer a real question.

## Dashboards Are Shared Operating Views

A dashboard is a shared view of signals. It is not the
source of truth by itself. It is a way to help humans
see the same shape quickly. Azure gives several
visualization options, including dashboards, workbooks,
and Grafana integrations. For beginner Azure work, the
exact visualization tool matters less than the design
habit. A good dashboard answers a job. For example: the
release dashboard answers "did the new deployment hurt
checkout?" the on-call dashboard answers "is the orders
API healthy right now?" the storage dashboard answers
"are receipt and export files being written
successfully?"

Do not make one giant dashboard for every possible
question. A giant dashboard becomes wallpaper. People
stop reading it. For `devpolaris-orders-api`, a useful
on-call dashboard could include:

```text
Top row:
  request count
  failed request rate
  p95 response time

Middle row:
  checkout failures by route
  dependency failures by target
  Azure SQL pressure

Bottom row:
  recent alerts
  deployment marker
  link to Log Analytics query
```

This is not a required layout. It is a reminder that
dashboards should help with decisions. If a chart never
changes what anyone does, it probably does not belong
on the first screen.

## Alerts Turn Signals Into Attention

An alert rule watches data and fires when a condition
is met. In Azure Monitor, alerts can use metrics, logs,
activity log events, and other signal types. For this
beginner module, focus on metric alerts and log search
alerts. A metric alert watches a number over time. For
example: checkout failed request rate is above 5
percent for 10 minutes. API p95 response time is above
2 seconds for 15 minutes.

Azure SQL CPU or DTU pressure is high for 15 minutes. A
log search alert uses a Log Analytics query. For
example: there are more than 10
`AuthorizationPermissionMismatch` errors from Blob
Storage in 15 minutes. There are failed checkout
exceptions with a specific error type. The rule should
explain what action a human can take. An alert that
fires but gives no direction is frustrating.

For `devpolaris-orders-api`, a useful alert might
include:

```text
Name: checkout-failure-rate-high
Signal: failed POST /checkout requests
Condition: failure rate above 5 percent for 10 minutes
Severity: high
First check: Application Insights failures for POST /checkout, then dependency failures
Action group: orders-api-oncall
```

The "first check" line is not an Azure field in every
setup. It is a good habit for the alert description or
runbook link. The person receiving the alert should
know where to start.

## Action Groups Decide Who Hears About It

An action group defines what happens when an Azure
Monitor alert fires. For a beginner, read it as: who
gets told, and what automation runs? Action groups can
send notifications such as email, SMS, or push
notifications. They can also trigger automation paths
such as webhooks, Azure Functions, Logic Apps, or other
integrations. That flexibility is useful. It also means
you should be careful. Not every alert should page a
human. Not every alert should trigger automation.

For `devpolaris-orders-api`, the team might have:

| Action group | Used for | Notification style |
|---|---|---|
| `orders-api-oncall` | Customer-impacting API failures | Page or urgent notification |
| `orders-api-business-hours` | Non-urgent warning signals | Email or chat |
| `platform-storage-watch` | Storage account or identity issues | Platform team route |
| `release-watch` | Deployment-window alerts | Release owner and on-call |

The important part is ownership. If everyone receives
every alert, nobody owns the response. If the wrong
team receives the alert, the first minutes are spent
forwarding it. Action groups should match the service
ownership model.

## Avoid Alert Noise Before It Trains The Team

Alert noise is dangerous. It teaches people not to
trust monitoring. Noise happens when alerts fire too
often, too vaguely, or without requiring action. Common
causes: thresholds are too sensitive. Alerts fire on
normal deployment behavior. Alerts fire for single
short spikes that recover. The same condition is
covered by several rules. Warnings page people at night
even though they can wait. An alert has no owner.

The fix is not to delete all alerts. The fix is to make
each alert earn attention. Ask: does this alert
indicate customer impact or real risk? Does someone
know what to do? Does the alert include a first check
or runbook link? Should this be a dashboard instead?
Should the threshold use a longer evaluation window?
Should the alert be lower severity? Good alerting is
kind to humans. It protects sleep and attention so that
urgent alerts are taken seriously.

## Failure Modes And First Checks

If an alert did not fire during a real incident,
inspect the signal. Was the metric collected? Was the
alert watching the right resource? Was the threshold
too high? Was the evaluation window too long? Was the
condition based on the wrong route or status code? If
an alert fired but nobody saw it, inspect the action
group. Was the right action group attached? Were
notifications muted or rate-limited? Was the recipient
wrong? Did the alert route to a mailbox nobody checks?
If an alert fired too often, inspect normal behavior.
Does deployment briefly cause failed health checks?

Does nightly export work spike CPU? Does a known batch
job cause temporary storage operations? If a dashboard
looks healthy while users complain, inspect what is
missing. Maybe the dashboard shows average response
time while p95 is bad. Maybe it shows API health but
not dependency failures. Maybe it shows infrastructure
metrics but not user-visible request failures. Here is
a first-check table.

| Symptom | First check |
|---|---|
| Incident happened with no alert | Alert rule signal, resource scope, threshold, evaluation window |
| Alert fired but no one responded | Action group and ownership |
| Alert fires too often | Threshold, severity, normal deployment behavior |
| Dashboard hides user pain | Percentiles, failed request rate, dependency metrics |
| Metric chart looks different from logs | Time range, aggregation, and metric delay |

Metrics and alerts are not magic. They are operating
design. They need review like code does.

## A Practical Metrics And Alerts Review

Before shipping an Azure backend, ask what numbers
matter. For `devpolaris-orders-api`, start with these
questions: what metric tells us checkout is failing?
What metric tells us checkout is slow? What metric
tells us the database is under pressure? What metric
tells us receipt uploads are failing? What dashboard
helps on-call understand health in one minute? Which
alerts should wake someone? Which alerts should wait
until business hours? Which action group owns each
alert? What first check should the alert description
include? Which noisy signals should stay as dashboard
charts instead of alerts? Here is the compact review.

| Area | Good first answer |
|---|---|
| Core user signal | Failed checkout rate and response time |
| Dependency signal | SQL, Blob Storage, Cosmos DB, and external API failures |
| Dashboard | Small on-call view with traffic, failures, latency, dependencies, recent alerts |
| Alert rule | Customer-impacting thresholds with clear windows |
| Action group | Owned route for urgent and non-urgent notifications |
| Noise control | Review alerts after releases and incidents |

This is the practical finish line for the module. Logs
tell you what happened. Application Insights helps
follow requests. Metrics show shape. Dashboards share
that shape. Alerts ask humans to act. When those pieces
work together, `devpolaris-orders-api` is much easier
to operate.

---

**References**

- [Azure Monitor Metrics overview](https://learn.microsoft.com/en-us/azure/azure-monitor/metrics/data-platform-metrics) - Microsoft explains metrics as numeric time-series data collected from resources and applications.
- [What are Azure Monitor alerts?](https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/alerts-overview) - Microsoft explains alert rules, alert types, alert states, and action groups.
- [Action groups](https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/action-groups) - Microsoft explains how action groups define notifications and automated actions for alerts.
- [Create or edit an Azure Workbook](https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-create-workbook) - Microsoft explains how workbooks can query and visualize Azure Monitor data.
- [Azure Monitor overview](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/overview) - Microsoft explains Azure Monitor analysis, visualization, troubleshooting, and alerting features.
