---
title: "Cloud Logging and Audit Evidence"
description: "Use structured logs, LogEntry fields, audit logs, Log Router sinks, retention, exports, and log-based metrics during a real GCP incident."
overview: "Cloud Logging stores application, platform, and audit evidence as structured records. This article follows checkout-api 500s through jsonPayload fields, resource labels, trace correlation, audit logs, routing, retention, and log-based metrics."
tags: ["gcp", "observability", "logging", "audit-logs", "log-router"]
order: 2
id: article-cloud-providers-gcp-observability-cloud-logging
aliases:
  - cloud-logging
---

## Table of Contents

1. [Why Logs Carry The Incident Details](#why-logs-carry-the-incident-details)
2. [Writing Structured Application Logs](#writing-structured-application-logs)
3. [Reading The LogEntry Envelope](#reading-the-logentry-envelope)
4. [Querying Cloud Run Logs During The 500s](#querying-cloud-run-logs-during-the-500s)
5. [Connecting Logs To Traces](#connecting-logs-to-traces)
6. [Audit Logs For Who Changed What](#audit-logs-for-who-changed-what)
7. [Log Router, Sinks, Retention, And Exports](#log-router-sinks-retention-and-exports)
8. [Log-Based Metrics](#log-based-metrics)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## Why Logs Carry The Incident Details
<!-- section-summary: Metrics show the size of the problem, while logs explain the exact event that happened inside one service. -->

The `checkout-api` alert tells the team that the HTTP `5xx` rate is high. That signal matters because it says customers are affected. It still leaves a very large question open: what happened inside the service when one checkout failed?

That is where **Cloud Logging** comes in. Cloud Logging is Google Cloud's managed service for storing, searching, routing, and analyzing log entries. Managed platforms such as Cloud Run can send request logs, container stdout, container stderr, and platform events into Cloud Logging. Application code can add structured logs with the fields that only the application understands.

The difference between a weak log and a useful log is the difference between a sentence and evidence. A weak log says `payment failed`. A useful log says the route was `POST /checkout`, the release was `2026-06-14.3`, the dependency was `payment-provider`, the error code was `provider_timeout`, and the active trace ID was `4bf92f3577b34da6a3ce929d0e0e4736`.

Logs also need care because they are searchable records. A production team keeps access tokens, card numbers, raw passwords, session cookies, private keys, and full personal records out of logs. The goal is enough detail to investigate, with enough discipline to keep telemetry from turning into a data leak.

![Infographic comparing a weak unstructured log with a structured log that includes severity, route, release, error code, trace ID, and revision.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-logging/structured-log-evidence.png)
*Structured logs give responders stable fields to filter, group, and connect to traces. The exact wording can vary by language, but the field discipline is the part that matters.*

## Writing Structured Application Logs
<!-- section-summary: Structured JSON logs give Cloud Logging fields that responders can filter, group, route, and connect to traces. -->

**Structured logging** means the application writes log events as JSON fields instead of one flat string. Cloud Logging can map recognized fields into the `LogEntry` envelope, and it usually stores the remaining application fields in `jsonPayload`. That gives the team queries like `jsonPayload.error_code="provider_timeout"` instead of fragile text searches.

Here is a practical error event from `checkout-api` during the incident:

```json
{
  "severity": "ERROR",
  "message": "payment provider rejected checkout request",
  "route": "POST /checkout",
  "checkout_id": "chk_9f21",
  "payment_provider": "stripe",
  "error_code": "provider_timeout",
  "release": "2026-06-14.3",
  "logging.googleapis.com/trace": "projects/shop-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "logging.googleapis.com/spanId": "d5b0214a4f6d9a12",
  "logging.googleapis.com/trace_sampled": true,
  "logging.googleapis.com/labels": {
    "team": "checkout",
    "env": "prod",
    "service": "checkout-api"
  }
}
```

The top-level `severity` tells Cloud Logging how important the event is. The `message` gives a human-readable summary. The route, checkout ID, provider, error code, and release fields stay in `jsonPayload` so the team can filter and group them. The special `logging.googleapis.com/*` fields tell Cloud Logging to populate log labels and trace fields in the `LogEntry` envelope.

The shape is more important than the exact library. A Node service might use Pino or Winston, a Python service might use the standard logging module with JSON formatting, and a Go service might use `slog` or a structured logger. In every language, the production habit is the same: create stable fields for stable questions, keep high-cardinality request details out of labels, and keep sensitive data out of every telemetry path.

## Reading The LogEntry Envelope
<!-- section-summary: A LogEntry has an envelope for source context and a payload for event details, and both parts matter during incident search. -->

Cloud Logging stores each record as a **LogEntry**. A beginner can read a `LogEntry` in two parts. The envelope tells where the event came from, when it happened, how severe it was, which log stream it belongs to, and which trace it connects to. The payload tells what the application, platform, or audit source reported.

A simplified stored entry from the checkout incident looks like this:

```json
{
  "insertId": "684ee1a90004b0b6",
  "logName": "projects/shop-prod/logs/run.googleapis.com%2Fstdout",
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
  "severity": "ERROR",
  "jsonPayload": {
    "message": "payment provider rejected checkout request",
    "route": "POST /checkout",
    "checkout_id": "chk_9f21",
    "payment_provider": "stripe",
    "error_code": "provider_timeout",
    "release": "2026-06-14.3"
  },
  "labels": {
    "team": "checkout",
    "env": "prod",
    "service": "checkout-api"
  },
  "timestamp": "2026-06-14T14:04:12.221Z",
  "trace": "projects/shop-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "d5b0214a4f6d9a12",
  "traceSampled": true
}
```

The `resource.type` and `resource.labels` fields identify the exact Google Cloud resource. This lets the team filter by Cloud Run service, region, and revision before reading payloads. The `logName` tells which log stream stored the event, such as Cloud Run stdout, stderr, request logs, or audit logs. The `timestamp` is the event time used for the incident window.

The payload can take different shapes. `jsonPayload` holds structured application fields. `textPayload` holds a plain string. `protoPayload` commonly appears for audit logs because those events use protocol buffer structures. A strong responder learns to read the envelope first, then the payload, because the envelope narrows the search and the payload explains the event.

## Querying Cloud Run Logs During The 500s
<!-- section-summary: Resource-first filters make Cloud Logging searches precise before the team reads application fields. -->

During the checkout incident, the team starts with the service and revision. The query below filters by the Cloud Run revision resource, the production service, the affected region, the new revision, the severity, and the incident window:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="checkout-api"
   resource.labels.location="us-central1"
   resource.labels.revision_name="checkout-api-00042-n9p"
   severity>=ERROR
   timestamp>="2026-06-14T14:00:00Z"
   timestamp<="2026-06-14T14:15:00Z"' \
  --project=shop-prod \
  --limit=50 \
  --format=json
```

This first query is intentionally resource-first. `resource.type="cloud_run_revision"` keeps the search on Cloud Run revision logs. The service, location, and revision labels point at the deployed code that started receiving traffic. The timestamp range keeps the result inside the first incident window, and `--limit=50` prevents a live incident terminal from flooding the screen.

A suspicious result repeats the same error shape:

```json
[
  {
    "timestamp": "2026-06-14T14:04:12.221Z",
    "severity": "ERROR",
    "resource": {
      "labels": {
        "service_name": "checkout-api",
        "revision_name": "checkout-api-00042-n9p",
        "location": "us-central1"
      }
    },
    "jsonPayload": {
      "message": "payment provider rejected checkout request",
      "error_code": "provider_timeout",
      "release": "2026-06-14.3",
      "checkout_id": "chk_9f21"
    },
    "trace": "projects/shop-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736"
  },
  {
    "timestamp": "2026-06-14T14:04:18.904Z",
    "severity": "ERROR",
    "jsonPayload": {
      "message": "payment authorization timed out after provider retry",
      "error_code": "provider_timeout",
      "release": "2026-06-14.3",
      "checkout_id": "chk_9f22"
    }
  }
]
```

Healthy output might have no rows for this revision, or it might show a small number of unrelated handled errors. Suspicious output clusters around the same revision, release, route, and error code during the same minutes that Cloud Monitoring shows `5xx` traffic.

After that first pass, the team can ask more specific application questions. The next query filters for the error code that appears in structured logs:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="checkout-api"
   jsonPayload.error_code="provider_timeout"
   jsonPayload.release="2026-06-14.3"' \
  --project=shop-prod \
  --freshness=30m \
  --limit=20 \
  --format='table(timestamp,severity,jsonPayload.checkout_id,jsonPayload.payment_provider,trace)'
```

The second query changes the question from "what errors happened on this revision?" to "how often do we see the payment timeout pattern?" The `jsonPayload.error_code` and `jsonPayload.release` filters depend on the application writing stable structured fields.

```console
TIMESTAMP                    SEVERITY  CHECKOUT_ID  PAYMENT_PROVIDER  TRACE
2026-06-14T14:04:12.221Z     ERROR     chk_9f21     stripe            projects/shop-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736
2026-06-14T14:04:18.904Z     ERROR     chk_9f22     stripe            projects/shop-prod/traces/68b7a1d1f9304c87b6c5e3b8ad44a612
2026-06-14T14:04:25.019Z     ERROR     chk_9f23     stripe            projects/shop-prod/traces/7c3e2a4b99f54e13a6b7c0d19012ab44
```

Healthy output after a rollback should shrink quickly or stop entirely. Suspicious output keeps adding new checkout IDs with the same provider and release, which means customers are still hitting the failing path.

That table gives the incident channel a short evidence list: time, severity, checkout ID, provider, and trace. The table output works well for quick triage, while JSON output works better when a responder needs to inspect the full envelope or paste a precise entry into the incident notes.

Cloud Logging filters should stay as specific as the question allows. A filter that starts with `severity>=ERROR` across the whole project might return unrelated service failures. A filter that names `resource.type`, service, region, revision, and a tight time window gives the team a much smaller and more trustworthy result set.

## Connecting Logs To Traces
<!-- section-summary: Trace fields let one log event open the full request timeline in Cloud Trace. -->

The checkout log includes `trace`, `spanId`, and `traceSampled`. These fields connect the log event to the distributed trace. When a responder sees one failed checkout log, they can query the rest of the logs for that exact trace:

```bash
gcloud logging read \
  'trace="projects/shop-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736"' \
  --project=shop-prod \
  --format='table(timestamp,resource.labels.service_name,severity,jsonPayload.message,jsonPayload.dependency)'
```

The trace query is useful after the team finds one representative failed checkout. The filter asks Cloud Logging for every log entry whose `trace` field matches that request, regardless of which service wrote it.

```console
TIMESTAMP                    SERVICE_NAME    SEVERITY  MESSAGE                                           DEPENDENCY
2026-06-14T14:04:11.902Z     checkout-api    INFO      checkout request received
2026-06-14T14:04:12.004Z     inventory-api   INFO      inventory reservation completed                   inventory
2026-06-14T14:04:12.221Z     checkout-api    ERROR     payment authorization timed out after retry        payment-provider
2026-06-14T14:04:12.236Z     checkout-api    ERROR     returning checkout failure response
```

Healthy trace-linked logs show a complete request story with normal dependency messages and a success response. Suspicious output has a gap where a downstream service failed to preserve context, repeated `ERROR` rows, or an error message that appears before the final HTTP `500`.

The result should show related log entries from `checkout-api` and any other service that preserved the same trace context. If `inventory-api` and `payment-worker` also write trace-linked logs, the team can read the request story across services without guessing from timestamps.

This trace link works when the application or instrumentation writes the trace fields. Cloud Logging indexes trace fields that reach the `LogEntry` structure. OpenTelemetry instrumentation, framework integration, a logging library hook, or a small logging wrapper has to put the active trace ID and span ID into each important event.

The practical standard is simple. Every service that handles a customer request should preserve incoming trace context, inject context into outbound calls, and write logs from the active context. A service that drops context turns the incident story into separate chapters.

## Audit Logs For Who Changed What
<!-- section-summary: Cloud Audit Logs explain control-plane changes around the same time as the application symptom. -->

Application logs explain what the application did. **Cloud Audit Logs** explain what people, automation, Google Cloud services, and policy systems did to cloud resources. During the checkout incident, the team needs both views because a code exception and a deployment event can belong to the same story.

Cloud Audit Logs include several categories. **Admin Activity audit logs** record user-driven API calls and actions that modify resource configuration or metadata, such as deploying a Cloud Run revision or changing IAM permissions. **Data Access audit logs** record access to resource data and can be large, so teams enable and retain them deliberately. **System Event audit logs** record Google Cloud system actions. **Policy Denied audit logs** record access denied by security policy.

Audit log entries are also `LogEntry` objects, but their audit details live in `protoPayload`. A focused query for Cloud Run service updates might look like this:

```bash
gcloud logging read \
  'logName="projects/shop-prod/logs/cloudaudit.googleapis.com%2Factivity"
   protoPayload.serviceName="run.googleapis.com"
   protoPayload.methodName:"UpdateService"
   timestamp>="2026-06-14T13:45:00Z"
   timestamp<="2026-06-14T14:10:00Z"' \
  --project=shop-prod \
  --limit=20 \
  --format=json
```

The audit query searches the Admin Activity log stream. `protoPayload.serviceName="run.googleapis.com"` focuses on Cloud Run API activity, and `protoPayload.methodName:"UpdateService"` captures service update calls. The time window starts before the metric spike so the team can see changes that happened just before customers noticed errors.

```json
[
  {
    "timestamp": "2026-06-14T13:58:44.312Z",
    "protoPayload": {
      "authenticationInfo": {
        "principalEmail": "ci-deploy@shop-prod.iam.gserviceaccount.com"
      },
      "methodName": "google.cloud.run.v2.Services.UpdateService",
      "resourceName": "namespaces/shop-prod/services/checkout-api",
      "requestMetadata": {
        "callerSuppliedUserAgent": "google-cloud-sdk gcloud/527.0.0"
      }
    }
  }
]
```

Healthy output shows an expected deployment principal and a resource name that matches the planned release. Suspicious output shows a different principal, an unplanned update, repeated service changes, or nearby changes to secrets, IAM, networking, or environment variables that could explain the runtime errors.

The important fields in the result are usually `protoPayload.authenticationInfo.principalEmail`, `protoPayload.methodName`, `protoPayload.resourceName`, request metadata, and timestamps. If the principal is `ci-deploy@shop-prod.iam.gserviceaccount.com`, the team can connect the runtime symptom to the deployment pipeline. If the principal is a human administrator, the incident notes should record the change path and approval context.

![Infographic showing audit log deployment evidence at 13:58 followed by runtime application errors at 14:04 and 14:05.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-logging/audit-runtime-timeline.png)
*Audit logs and application logs answer different questions. The suspicious pattern is a production update immediately before repeated runtime errors in the same incident window.*

Audit logs also support compliance and security review. A central platform or security team might route Admin Activity and Policy Denied logs from many projects into a central BigQuery dataset. Application teams can still query their project logs during incidents, while security keeps a longer organization-wide history.

## Log Router, Sinks, Retention, And Exports
<!-- section-summary: Routing and retention decide which logs stay searchable, which logs export, and which teams can review them later. -->

Cloud Logging receives log entries, then the **Log Router** evaluates them against **sinks**. A sink is a routing rule with a filter and a destination. Destinations can include log buckets, BigQuery, Cloud Storage, Pub/Sub, and supported external or partner destinations depending on the use case.

The default path is enough for many day-to-day searches, but production teams usually design a routing plan. Recent operational logs stay in log buckets for fast incident queries. Security and audit logs often route to central buckets or BigQuery for longer retention and review. High-volume debug logs might have shorter retention or exclusion rules. Compliance archives might route to Cloud Storage with lifecycle rules and restricted access.

Here is a sink that routes Cloud Run error logs for `checkout-api` into a central operations log bucket:

```bash
gcloud logging sinks create checkout-api-errors \
  logging.googleapis.com/projects/shop-observability/locations/global/buckets/prod-app-errors \
  --project=shop-prod \
  --log-filter='resource.type="cloud_run_revision"
    resource.labels.service_name="checkout-api"
    severity>=ERROR'
```

The destination names a central log bucket. The `--log-filter` controls which entries route to that bucket, so this sink sends only Cloud Run error logs for `checkout-api`. The command creates routing; it does not automatically grant the sink writer access to the destination.

```console
Created [https://logging.googleapis.com/v2/projects/shop-prod/sinks/checkout-api-errors].
Please remember to grant `serviceAccount:service-123456789012@gcp-sa-logging.iam.gserviceaccount.com`
the Logging Bucket Writer role on the destination.
```

Healthy setup output includes a writer identity that the team then grants on the destination bucket. Suspicious setup is a sink that exists but has permission errors, because the Log Router will match entries and then fail to write them where the incident team expects them.

For audit evidence, an organization or folder sink can centralize records across many projects. This pattern helps when every product team owns its own project, but security needs one place to review production changes:

```bash
gcloud logging sinks create org-admin-activity-to-bq \
  bigquery.googleapis.com/projects/sec-logs/datasets/gcp_admin_activity \
  --organization=123456789012 \
  --include-children \
  --log-filter='logName:"cloudaudit.googleapis.com%2Factivity"'
```

The `--organization` flag moves the routing rule above one project, and `--include-children` includes projects under that organization. The filter selects Admin Activity logs, which are the first control-plane change evidence many incident and security reviews need.

```console
Created [https://logging.googleapis.com/v2/organizations/123456789012/sinks/org-admin-activity-to-bq].
Writer identity: serviceAccount:o123456789012-987654@gcp-sa-logging.iam.gserviceaccount.com
```

Healthy output gives security a writer identity to grant on the BigQuery dataset. Suspicious output is less about the command text and more about the design: an organization sink without `--include-children` may miss child project logs, and an overly broad filter may export far more data than the team intended.

After creating a sink, the team has to grant the sink writer identity permission on the destination. This is a common setup miss. The command output shows a service account for the sink, and that service account needs the right destination role, such as permission to write to a BigQuery dataset or a logging bucket.

Retention belongs in the design conversation too. A short retention window saves cost but can erase evidence needed for a slow customer report, compliance request, or monthly reliability review. A long retention window helps investigations but can increase cost and data exposure. The practical pattern is to choose retention by log class: hot operational logs, security audit logs, debug logs, and long-term compliance exports usually deserve different policies.

## Log-Based Metrics
<!-- section-summary: Log-based metrics turn repeated log patterns into alertable numbers when a direct application metric is missing. -->

Sometimes a team needs a number from a repeated log pattern. A **log-based metric** counts or measures log entries that match a filter. For `checkout-api`, the team can count payment provider timeout logs even before the application exposes a custom metric for that exact failure.

Here is a counter metric for the incident pattern:

```bash
gcloud logging metrics create checkout_payment_provider_timeouts \
  --project=shop-prod \
  --description="Payment provider timeout logs from checkout-api" \
  --log-filter='resource.type="cloud_run_revision"
    resource.labels.service_name="checkout-api"
    jsonPayload.error_code="provider_timeout"'
```

The metric counts log entries that match the incident pattern. `resource.type` and `service_name` keep the metric scoped to one Cloud Run service, while `jsonPayload.error_code` depends on the structured log field the application emits.

```console
Created metric [checkout_payment_provider_timeouts].
```

After a few matching logs arrive, the metric appears in Cloud Monitoring as a user-defined logging metric. Healthy output after a fix shows the time series dropping to zero. Suspicious output keeps increasing while the `5xx` ratio stays high, which means the error pattern still reaches production.

This metric gives Cloud Monitoring a time series based on matching log entries. The team can put the time series on a dashboard or create an alert if the count rises above a threshold. This is useful when the application already emits reliable structured logs and the team needs an alert quickly.

Log-based metrics still need care. They depend on ingestion and log shape, so a code change that renames `jsonPayload.error_code` can break the metric. They also count events after the application emits logs, so they should complement direct service metrics such as request count, error rate, latency, and saturation. They fit important business or error patterns that logs can express cleanly.

![Infographic showing incoming operational errors, audit logs, and debug noise routed through Log Router filters into log buckets, BigQuery, short retention, and a log-based metric.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-logging/log-routing-plan.png)
*Routing is part of incident design. Operational errors need fast search, audit logs need longer review paths, and noisy debug entries usually need tighter retention.*

## Putting It All Together
<!-- section-summary: Logging turns the incident into searchable evidence, and routing keeps that evidence available for the right team. -->

For the `checkout-api` 500s, Cloud Logging gives the team structured runtime events, platform context, audit evidence, trace fields, and routing controls. The useful habit is to filter by `resource.type`, resource labels, severity, time window, and trace first, then read `jsonPayload` and `protoPayload` for the specific story.

The production design is also clear now. Application logs should be structured. Audit logs should be reviewable. Log Router sinks should send the right records to the right retention and analysis destinations. Log-based metrics should turn repeated important log patterns into alertable time series before the application exposes the metric directly.

## What's Next

The next article moves from log evidence to Cloud Monitoring. We will use metrics, dashboards, alert policies, notification channels, uptime checks, SLOs, SLIs, error budgets, burn-rate thinking, and Prometheus-style workflows to make the `checkout-api` symptom visible before customers flood support.

---

**References**

- [Cloud Logging documentation](https://cloud.google.com/logging/docs) - Explains Cloud Logging concepts, storage, querying, and routing.
- [Structured logging](https://docs.cloud.google.com/logging/docs/structured-logging) - Documents structured JSON fields such as `severity`, `message`, `logging.googleapis.com/trace`, labels, and `httpRequest`.
- [LogEntry reference](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry) - Defines `LogEntry` fields including payloads, resource, labels, trace fields, severity, and timestamps.
- [Cloud Audit Logs](https://docs.cloud.google.com/logging/docs/audit) - Explains Admin Activity, Data Access, System Event, and Policy Denied audit logs.
- [Log Router overview](https://docs.cloud.google.com/logging/docs/routing/overview) - Describes how sinks route log entries at project, folder, and organization levels.
- [Log-based metrics overview](https://docs.cloud.google.com/logging/docs/logs-based-metrics) - Explains counter and distribution metrics derived from log filters.
