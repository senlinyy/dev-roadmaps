---
title: "What Is GCP Observability"
description: "Understand how Google Cloud connects logs, metrics, traces, errors, profiles, audit logs, labels, and alerts around one production incident."
overview: "GCP observability gives a team enough evidence to answer what users saw, where the request ran, what code failed, who changed the system, and whether the fix worked. This article follows one checkout-api incident through the first set of signals."
tags: ["gcp", "observability", "logging", "monitoring", "trace", "labels", "audit-logs"]
order: 1
id: article-cloud-providers-gcp-observability-what-is-gcp-observability
---

## Table of Contents

1. [The Production Question](#the-production-question)
2. [What GCP Observability Means](#what-gcp-observability-means)
3. [The Signals GCP Collects](#the-signals-gcp-collects)
4. [The Context That Connects The Signals](#the-context-that-connects-the-signals)
5. [The First Incident Walkthrough](#the-first-incident-walkthrough)
6. [Application Monitoring And Service Views](#application-monitoring-and-service-views)
7. [A Practical First Setup](#a-practical-first-setup)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Production Question
<!-- section-summary: A production incident gives every observability signal a clear job, so the module starts with one concrete GCP story. -->

Let's use one story for the whole module. The DevPolaris shop runs a service called `checkout-api` on Cloud Run in project `shop-prod` and region `us-central1`. The service accepts `POST /checkout`, checks inventory through `inventory-api`, calls a payment provider, writes the order to Cloud SQL, and publishes a receipt job to Pub/Sub.

At 14:05 UTC, support reports that customers can open the checkout page, but payment submission returns HTTP `500`. The last deployment moved traffic to Cloud Run revision `checkout-api-00042-n9p` a few minutes earlier. The on-call engineer now needs answers that live outside a normal local debugger.

The first question is plain: how many customers are affected? After that, the team needs the exact failing request, the code path that failed, the dependency that returned the error, the revision that served the request, the person or pipeline that changed production, and the graph that proves the fix worked. Those answers live in different signals, so observability is the way the team connects them.

## What GCP Observability Means
<!-- section-summary: GCP observability is the Google Cloud evidence system for understanding running applications and infrastructure from the outside. -->

**GCP observability** is the Google Cloud set of services that helps teams understand the behavior, health, and performance of applications and infrastructure. In plain words, it is the evidence trail for production. It collects logs for events, metrics for numbers over time, traces for request timelines, errors for grouped exceptions, profiles for runtime cost, audit logs for control-plane changes, and labels for sorting all of that evidence.

The important beginner idea is that observability starts before an incident. The application has to emit useful telemetry while it runs. Google Cloud managed services add a lot of platform evidence, but the application still has to name its service, preserve trace context, log important business steps, avoid secrets in telemetry, and attach release or environment fields that help a tired responder filter the data.

For `checkout-api`, a useful evidence trail can answer a full production sentence: production checkout in `us-central1` started returning `500` responses after release `2026-06-14.3`, most failed requests came from revision `checkout-api-00042-n9p`, traces show slow payment authorization calls, logs show `provider_timeout`, and audit logs show the deployment came from `ci-deploy@shop-prod.iam.gserviceaccount.com`.

That is why this topic deserves a module instead of one quick definition. Logs, metrics, traces, and audit records are different tools, but they serve one workflow during an incident. The team moves from user symptom, to scope, to detailed request evidence, to change evidence, to a verified recovery.

## The Signals GCP Collects
<!-- section-summary: Logs, metrics, traces, errors, profiles, and audit logs answer different incident questions, so teams use them together. -->

The first signal many engineers open is **logs**. A log is a timestamped event record from an application, platform, service, or audit source. For Cloud Run, container output and request logs can reach Cloud Logging automatically, and application code can emit structured JSON logs with fields such as `severity`, `message`, `checkout_id`, `release`, `error_code`, and trace fields.

**Metrics** are numeric measurements stored over time. Cloud Monitoring stores metrics as time series, which means each data point belongs to a metric type, a monitored resource, labels, and a timestamp interval. During the checkout incident, the team watches request count, `5xx` count, latency percentiles, Cloud Run instance count, CPU, memory, and any custom business metrics such as completed checkouts.

**Traces** follow one request across services. Cloud Trace stores spans, and each span represents one timed piece of work. A failed checkout trace might include the incoming Cloud Run handler, an inventory call, a payment provider call, a Cloud SQL insert, and a Pub/Sub publish step. The trace helps the team see the slow or failing hop instead of lining up logs from several services by hand.

**Error Reporting** groups similar application errors. If `checkout-api` throws the same `PaymentGatewayTimeout` exception one thousand times, the team should see one error group with first seen time, recent count, stack frames, and affected versions. That grouping keeps the investigation from turning into a scroll through repeated stack traces.

**Cloud Profiler** shows where an application spends CPU time, heap, or other runtime resources when profiling is enabled for a supported runtime. A profiler matters when the incident looks like high CPU, memory growth, or slow code without a clean exception. In the checkout story, a profile would help if release `2026-06-14.3` made every request spend too much time serializing a payment payload or waiting inside a client library.

**Cloud Audit Logs** record Google Cloud API activity. They help answer who changed what and when. For this incident, audit evidence can show the Cloud Run service update, the service account that deployed the revision, IAM changes, secret updates, networking changes, or policy-denied events around the same time window.

## The Context That Connects The Signals
<!-- section-summary: Project, region, resource labels, service names, releases, and trace IDs turn scattered telemetry into one investigation path. -->

GCP telemetry carries **monitored resource** context. For Cloud Run revision telemetry, the monitored resource is `cloud_run_revision`, and its resource labels include values such as project ID, location, service name, revision name, and configuration name. This context is much stronger than searching for a service name inside log text because Google Cloud stores it as structured metadata.

The project is the first boundary because production, staging, and development often live in separate projects. The region narrows the runtime location. The service name tells the team which application emitted the signal. The revision name tells the team which deployed version handled a request. In Cloud Run, the revision matters because traffic can split between revisions during a rollout or rollback.

User-defined labels add ownership and operating context. A team might use labels like `env=prod`, `team=checkout`, `service=checkout-api`, `release=2026-06-14.3`, and `cost_center=commerce`. These labels should stay low-cardinality, which means they should have a small and predictable set of values. Values like customer IDs, checkout IDs, and request IDs belong in logs or traces, because using them as metric or resource labels can create too many series and can leak sensitive data.

Trace IDs connect request-level evidence. If the active trace ID appears in a log entry, then Cloud Logging can show the logs for the same request that Cloud Trace displays as spans. This gives the responder two directions of travel. A trace can lead to the exact log lines written by the failing span, and a structured error log can lead back to the trace timeline for that request.

Here is the shape of a useful application log from `checkout-api`:

```json
{
  "severity": "ERROR",
  "message": "payment provider rejected checkout request",
  "checkout_id": "chk_9f21",
  "route": "POST /checkout",
  "dependency": "payment-provider",
  "error_code": "provider_timeout",
  "release": "2026-06-14.3",
  "logging.googleapis.com/trace": "projects/shop-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "logging.googleapis.com/spanId": "00f067aa0ba902b7",
  "logging.googleapis.com/trace_sampled": true,
  "logging.googleapis.com/labels": {
    "team": "checkout",
    "env": "prod",
    "service": "checkout-api"
  }
}
```

This log gives the team several handles. `severity` makes the event easy to filter. `route` and `dependency` describe the code path. `checkout_id` helps the support team connect the ticket to internal evidence. `release` ties the event to rollout history. The trace fields let Cloud Logging and Cloud Trace talk about the same request.

## The First Incident Walkthrough
<!-- section-summary: A good first pass moves from customer symptom to exact runtime evidence, then to change evidence and recovery proof. -->

The first useful movement is from user symptom to metric scope. Cloud Monitoring shows `run.googleapis.com/request_count` for Cloud Run, filtered to `checkout-api`, `us-central1`, and response code class `5xx`. If the graph jumps from a quiet baseline to a sustained spike, the team knows the issue is broad enough to treat as an incident.

The second movement is from scope to exact events. The team uses Cloud Logging to filter by resource type, service name, location, revision, severity, and time window. Resource fields narrow the search before the team reads payload details:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="checkout-api"
   resource.labels.location="us-central1"
   resource.labels.revision_name="checkout-api-00042-n9p"
   severity>=ERROR
   timestamp>="2026-06-14T14:00:00Z"' \
  --project=shop-prod \
  --limit=25 \
  --format=json
```

The third movement is from one error event to one request story. If a matching log entry includes `trace`, the team can query every log with the same trace ID and open the trace to see the request timeline. The trace might show `POST /checkout` spending 2.8 seconds inside `payment.authorize`, followed by an exception and an HTTP `500` response.

The fourth movement is from runtime evidence to change evidence. Cloud Audit Logs can show whether a deployment, secret update, IAM change, or networking change happened just before the metric spike. If the audit log shows that the CI/CD service account updated the Cloud Run service at 13:58 UTC and the spike started at 14:01 UTC, the team has a strong rollout suspect.

The last movement is recovery proof. A rollback or fix should move the same user-facing metric back toward normal, reduce error logs, stop new error-group events, and show healthy traces for the same route. The team should close the incident with evidence from the same signals that opened it.

## Application Monitoring And Service Views
<!-- section-summary: Application Monitoring gives teams a higher-level view of services, workloads, topology, and connected telemetry. -->

Google Cloud also has **Application Monitoring**, which focuses on applications, services, workloads, and topology. A raw log query is great when the team knows the exact service and field. A service view helps when the system has several pieces and the responder needs to see how the pieces relate before drilling into one signal.

For the checkout system, the service view might show `checkout-api`, `inventory-api`, a payment worker, Cloud SQL, Pub/Sub, and external provider calls. The value is orientation. The responder can see which service reports errors, which dependency looks slow, and which telemetry types support that view.

Application Monitoring still depends on good telemetry hygiene. Services need stable names, useful labels, and instrumentation that emits traces and metrics. A clean set of OpenTelemetry resource attributes such as `service.name=checkout-api`, `deployment.environment=prod`, and `service.version=2026-06-14.3` helps the service view, dashboards, logs, and traces agree with each other.

This is also where production teams decide ownership. The checkout team owns the application telemetry and runbook. The platform team might own shared collectors, log routing, metrics scopes, and cross-project views. The security team might own organization-level audit log exports. A strong setup lets each team do its part without making an incident responder jump through five unrelated tools.

## A Practical First Setup
<!-- section-summary: A beginner-friendly GCP setup covers platform metrics, structured logs, trace context, audit evidence, dashboards, and a small alert set. -->

A useful first GCP observability setup starts smaller than every possible feature. It needs enough evidence for the first real incident. For `checkout-api`, that means the team can answer whether customers are affected, which request failed, which dependency failed, which revision served it, what changed, and whether the fix worked.

The platform layer starts with Cloud Run's built-in metrics and logs. Cloud Monitoring can graph request count, response code class, latency, and instance behavior. Cloud Logging can store request logs, container logs, and application logs. The team should verify that production Cloud Run services have labels for environment, team, and service ownership.

The first verification can be very concrete. Before creating a dashboard, confirm the service identity, revision, labels, and runtime service account:

```bash
gcloud run services describe checkout-api \
  --project=shop-prod \
  --region=us-central1 \
  --format='yaml(metadata.labels,spec.template.metadata.labels,spec.template.spec.serviceAccountName,status.latestReadyRevisionName,status.url)'
```

Then confirm that the service emits request logs and application errors with the resource fields the team expects:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="checkout-api"
   resource.labels.location="us-central1"
   severity>=ERROR' \
  --project=shop-prod \
  --freshness=1h \
  --limit=20 \
  --format='table(timestamp,resource.labels.revision_name,severity,jsonPayload.message,textPayload)'
```

The application layer starts with structured logs and traces. The app should write JSON logs with stable fields, should keep secrets and payment data out of telemetry, and should attach trace and span fields when possible. OpenTelemetry is the normal production direction because it gives standard APIs and attributes across languages, collectors, metrics, logs, and traces.

The audit layer starts with Cloud Audit Logs and a retention plan. Admin Activity audit logs should be easy to query during incidents, and security-sensitive logs often need central routing to a controlled project or BigQuery dataset. Data Access audit logs can be high volume, so teams enable them deliberately for the resources where that evidence matters.

The audit check should use the same incident time window as the runtime evidence. A deployment audit query might look like this:

```bash
gcloud logging read \
  'logName="projects/shop-prod/logs/cloudaudit.googleapis.com%2Factivity"
   protoPayload.serviceName="run.googleapis.com"
   protoPayload.methodName:"UpdateService"' \
  --project=shop-prod \
  --freshness=24h \
  --limit=20 \
  --format='table(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.methodName,protoPayload.resourceName)'
```

The response layer starts with a small dashboard and a small alert set. The top row should show user-facing health: checkout success, `5xx` rate, and p95 latency. The lower rows should show Cloud Run instances, dependency latency, database health, Pub/Sub backlog, recent deployment markers, and current incidents. The first alerts should page on sustained user impact, while brief infrastructure wiggles usually belong on dashboards or lower-priority tickets.

| Setup item | Why it matters during the first incident |
|---|---|
| Cloud Run request metrics | Shows traffic, `5xx` rate, latency, and revision-level scope |
| Structured application logs | Gives searchable fields for route, dependency, release, and error code |
| Trace context and Cloud Trace | Connects one failed checkout across services and dependencies |
| Error Reporting | Groups repeated exceptions so responders see the pattern quickly |
| Cloud Audit Logs | Shows deployment, IAM, secret, and configuration changes |
| Log routing and retention | Keeps operational and audit evidence available for the right team |
| Dashboards and alert policies | Turns telemetry into response instead of passive charts |

This setup is enough to begin operating like a production team. Later refinements can add service-level objectives, burn-rate alerts, Prometheus metrics, custom business metrics, synthetic checks, profiling, cross-project metrics scopes, and deeper security exports.

## Putting It All Together
<!-- section-summary: GCP observability works when every signal has a job and enough shared context to join the incident story. -->

The checkout incident now has a connected shape. Cloud Monitoring notices the customer symptom through error rate and latency. Cloud Logging shows structured application events, platform logs, and audit evidence. Cloud Trace follows one failed checkout through service calls. Error Reporting groups repeated exceptions. Cloud Profiler helps when runtime cost or memory pressure causes the symptom. Labels and resource fields connect every signal to project, region, service, revision, release, team, and trace ID.

The operating habit is steady: start with the user symptom, narrow by resource context, read structured evidence, follow the trace, check change history, fix the cause, and verify the same user-facing metric. Google Cloud gives the services, but the team still has to make the telemetry useful by naming services clearly, writing structured logs, preserving context, and labeling production resources consistently.

## What's Next

The next article goes deeper into Cloud Logging and audit evidence. We will keep the same `checkout-api` incident and look at `LogEntry` fields, structured JSON logs, trace-linked logs, audit queries, Log Router sinks, retention choices, and log-based metrics.

---

**References**

- [Google Cloud Observability overview](https://docs.cloud.google.com/stackdriver/docs) - Defines Google Cloud Observability and describes logs, metrics, traces, and application health.
- [Cloud Logging documentation](https://cloud.google.com/logging/docs) - Explains Cloud Logging concepts, log storage, querying, routing, and analysis.
- [Cloud Monitoring documentation](https://docs.cloud.google.com/monitoring) - Covers metrics, dashboards, alerting, uptime checks, and service health workflows.
- [Cloud Trace documentation](https://cloud.google.com/trace/docs) - Documents distributed tracing and latency analysis in Google Cloud.
- [Error Reporting documentation](https://cloud.google.com/error-reporting/docs) - Explains grouped application errors and exception visibility.
- [Cloud Profiler documentation](https://cloud.google.com/profiler/docs) - Documents continuous profiling for supported applications.
- [Cloud Logging monitored resource list](https://docs.cloud.google.com/logging/docs/api/v2/resource-list) - Lists monitored resource types and resource labels such as Cloud Run revision labels.
- [Cloud Run monitoring](https://cloud.google.com/run/docs/monitoring) - Documents Cloud Run request logs, metrics, and service monitoring workflows.
- [Google Cloud SDK: gcloud run services describe](https://docs.cloud.google.com/sdk/gcloud/reference/run/services/describe) - Documents the service inspection command used to verify labels, revision, URL, and runtime settings.
