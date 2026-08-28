---
title: "Cloud Logging and Audit Evidence"
description: "Use structured logs, LogEntry fields, audit logs, Log Router sinks, retention, exports, and log-based metrics during a real GCP incident."
overview: "Cloud Logging is an event-evidence system. Structured LogEntry records, monitored resources, trace correlation, audit logs, log-based metrics, routing, and retention let a team reconstruct one checkout incident."
tags: ["gcp", "observability", "logging", "audit-logs", "log-router"]
order: 2
id: article-cloud-providers-gcp-observability-cloud-logging
aliases:
  - cloud-logging
---

## Table of Contents

1. [What Is a LogEntry?](#what-is-a-logentry)
2. [How Do Monitored Resources and Labels Identify the Source?](#how-do-monitored-resources-and-labels-identify-the-source)
3. [Why Do Structured Logs Make Better Queries?](#why-do-structured-logs-make-better-queries)
4. [How Does Trace Correlation Reconstruct One Request?](#how-does-trace-correlation-reconstruct-one-request)
5. [What Evidence Do Audit Logs Add?](#what-evidence-do-audit-logs-add)
6. [How Do Log-Based Metrics Turn Events Into Numbers?](#how-do-log-based-metrics-turn-events-into-numbers)
7. [How Do the Log Router, Sinks, Buckets, and Retention Work?](#how-do-the-log-router-sinks-buckets-and-retention-work)
8. [How Does Cloud Logging Support a Complete Investigation?](#how-does-cloud-logging-support-a-complete-investigation)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A **log** is a record of something that happened. Your application can write a log as it receives a request, saves a file, retries a dependency, catches an error, or rejects bad input. Google Cloud services can write logs as a Cloud Run revision serves traffic, a load balancer receives a request, a storage bucket is accessed, or a control-plane API changes a resource.

**Cloud Logging** is Google Cloud's managed service for storing, searching, routing, and analyzing those records. In a checkout incident, logs tell you what happened inside one request after Cloud Monitoring shows that latency and errors are rising.

Think of logs as the system's dated notebook, written in a way computers can search. A useful notebook entry does not only say "payment failed." It says which service wrote the entry, which revision served the request, which operation failed, which safe error code appeared, and which trace can open the full request path.

Keep these questions in view as you work through the lesson:

1. **What Is a LogEntry?**
2. **How Do Monitored Resources and Labels Identify the Source?**
3. **Why Do Structured Logs Make Better Queries?**
4. **How Does Trace Correlation Reconstruct One Request?**
5. **What Evidence Do Audit Logs Add?**
6. **How Do Log-Based Metrics Turn Events Into Numbers?**
7. **How Do the Log Router, Sinks, Buckets, and Retention Work?**
8. **How Does Cloud Logging Support a Complete Investigation?**

## What Is a LogEntry?
<!-- section-summary: A log is one event record, and Cloud Logging gives those records storage, search, routing, and retention. -->

Logs are especially useful for questions about a specific event. Which checkout failed? Which order was affected? Which sanitized provider error did the payment operation return? Metrics can show that errors are rising, and traces can show the timed path, but logs give the detailed event records responders inspect line by line.

The first useful log question is direct: "Which event explains one failed checkout?" A useful answer might say the route was `POST /checkout`, the operation was `payment.authorize`, the release was `v18`, the order was `ord-9182`, and the sanitized error code was `payment_timeout`.

### How Does Severity Help Triage?
<!-- section-summary: A LogEntry has an envelope for source context and a payload for event details, and severity controls the first triage filter. -->

Cloud Logging stores each record as a **LogEntry**. A beginner can read a LogEntry in two parts. The envelope tells where the event came from, the event time, how severe it was, which log stream stored it, and whether it links to a trace. The payload tells what the application, platform, or audit source reported.

That object model matters because Cloud Logging is not one enormous `log.txt` file. Each event is stored as a separate entry. Its payload can be plain text in `textPayload`, structured JSON in `jsonPayload`, or a protocol-buffer-shaped record in `protoPayload`. Audit logs commonly use `protoPayload`; application logs are often most useful as structured JSON. The standard envelope lets the platform index common context while the payload preserves details specific to the event.

**Severity** is the importance level on the entry. Common values include `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`, `ALERT`, and `EMERGENCY`. During an incident, severity helps the team remove routine noise from the first search. A live triage query can use `severity>=ERROR` first, then narrow by resource labels and time.

Think of the LogEntry envelope as the mailing label and the payload as the letter inside. The mailing label says which project, service, revision, log stream, severity, and timestamp produced the record. The letter says what the application reported. A responder usually checks the mailing label first because a perfect payload from the wrong revision can send the investigation in the wrong direction.

Severity is a triage hint and one part of the truth. An `ERROR` entry should get attention. Repeated `WARNING` entries can also explain a slow incident. A production team should still use stable fields such as route, release, operation, and trace ID so severity does not carry all the meaning.

Severity is not an independent truth detector. The program or logging integration normally chooses it. A database timeout accidentally written at `INFO` is still a timeout, and a harmless retry written at `ERROR` might not be user-visible. Treat severity as an efficient first filter, then confirm the event through its fields, surrounding records, metrics, and request outcome.

Here is a simplified stored entry from the checkout incident:

```json
{
  "insertId": "684ee1a90004b0b6",
  "logName": "projects/checkout-prod/logs/run.googleapis.com%2Fstdout",
  "resource": {
    "type": "cloud_run_revision",
    "labels": {
      "project_id": "checkout-prod",
      "location": "us-central1",
      "service_name": "checkout",
      "revision_name": "checkout-00042-n9p",
      "configuration_name": "checkout"
    }
  },
  "severity": "ERROR",
  "jsonPayload": {
    "message": "payment authorization timed out",
    "route": "POST /checkout",
    "operation": "payment.authorize",
    "order_id": "ord-9182",
    "payment_provider": "stripe",
    "error_code": "payment_timeout",
    "release": "2026-06-14.3"
  },
  "timestamp": "2026-06-14T14:04:12.221Z",
  "trace": "projects/checkout-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "d5b0214a4f6d9a12",
  "traceSampled": true
}
```

The envelope narrows the search to the Cloud Run revision. The payload explains the application event. The trace fields give the team a path from this log entry into the request timeline.

## How Do Monitored Resources and Labels Identify the Source?
<!-- section-summary: Resource labels identify the exact Google Cloud resource that produced a log entry. -->

**Resource labels** are structured fields attached to the monitored resource. For Cloud Run revision logs, labels can include project ID, location, service name, revision name, and configuration name. These fields are the safest first filter because they describe the source of the log entry before the team reads message text.

Think of resource labels as the return address on the evidence. A log line that says `payment authorization timed out` is useful, yet it is incomplete by itself. The responder also needs to know which project, region, service, and revision produced it. Resource labels answer that before the team starts reading application payloads.

For `checkout`, the resource labels tell the responder whether an error came from production or staging, from `us-central1` or another region, and from the new revision or an older revision still receiving traffic. That matters during rollouts because two revisions can serve requests at the same time.

Resource labels are different from application labels. Resource labels come from the Google Cloud monitored resource model. Application labels and JSON payload fields come from your service design. A strong incident query usually uses both: resource labels for the platform source, payload fields for the application meaning.

There are therefore three nearby ideas to keep separate. The monitored resource answers, "Which kind of GCP resource emitted this entry?" Its resource labels identify the concrete project, region, service, or revision. `LogEntry.labels` adds labels to the record itself, while fields inside `jsonPayload` describe the application event. Putting an order ID in a monitored-resource label would misdescribe the infrastructure; putting the Cloud Run revision only inside a message would throw away reliable platform context.

A good first Cloud Logging filter usually follows this order:

1. Choose the monitored resource type, such as `cloud_run_revision`.
2. Choose the production project and region.
3. Choose the service and revision.
4. Add severity or payload fields after the source is correct.

That order keeps a beginner from searching every log in the project for a message string and accidentally mixing staging, old revisions, and unrelated services into one result.

## Why Do Structured Logs Make Better Queries?
<!-- section-summary: Structured JSON logs give Cloud Logging fields that responders can filter, group, route, and correlate. -->

**Structured logs** are log events written as JSON fields instead of one flat string. Cloud Logging can store recognized fields in the LogEntry envelope and the remaining application fields in `jsonPayload`. That gives the team precise filters such as `jsonPayload.error_code="payment_timeout"` instead of fragile searches through message text.

The practical benefit is search accuracy. A flat message like `payment failed for order` requires text matching and human interpretation. A structured event can say `operation="payment.authorize"`, `payment_provider="stripe"`, `error_code="payment_timeout"`, and `release="2026-06-14.3"`. Now the team can count, filter, group, and route logs by stable fields instead of hoping every developer wrote the same sentence.

Structured logs also make dashboards and alerts safer. A log-based metric can count `jsonPayload.error_code="payment_timeout"` without matching unrelated messages that happen to include the same words. That precision is the difference between a useful alert and a noisy one.

This is the difference between a sentence and a small database row. A sentence is pleasant for a person to read once. Stable fields let an incident responder ask repeatable questions: Which release fails? Which payment provider is involved? Does the failure affect one route or several? Are retries succeeding? The message can still summarize the event, but the fields carry the dimensions used by queries and automation.

Here is the application-side JSON event before Cloud Logging stores it:

```json
{
  "severity": "ERROR",
  "message": "payment authorization timed out",
  "route": "POST /checkout",
  "operation": "payment.authorize",
  "order_id": "ord-9182",
  "payment_provider": "stripe",
  "error_code": "payment_timeout",
  "release": "2026-06-14.3",
  "logging.googleapis.com/trace": "projects/checkout-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "logging.googleapis.com/spanId": "d5b0214a4f6d9a12",
  "logging.googleapis.com/trace_sampled": true,
  "logging.googleapis.com/labels": {
    "team": "media",
    "env": "prod",
    "service": "checkout"
  }
}
```

The important pieces are deliberate. `severity` drives the first triage filter. `route`, `operation`, `error_code`, and `release` answer stable incident questions. `order_id` is a support handle, not a metric label. The special `logging.googleapis.com/*` fields let Cloud Logging populate labels and trace fields in the stored LogEntry.

The safety rule is just as important as the shape. Keep tokens, signed URLs, raw card data, full user profiles, session cookies, and private keys out of logs. A good log has enough detail to investigate and enough restraint to avoid creating a second data problem.

Field names also become an operating contract. If one revision writes `error_code`, another writes `errorCode`, and a third only changes the message sentence, one query cannot compare them reliably. Review a small event schema for important operations, keep units explicit, and preserve semantic meaning across releases. A new field can be added without breaking an old query, but silently reusing an existing field for a different meaning corrupts historical comparison.

Record both event time and the platform's receipt context when available. Buffered delivery can make an entry appear in the backend after the event occurred. Incident queries should use the event timestamp for chronology while recognizing that retries, clocks, and ingestion delay can affect apparent order. Shared trace and operation identifiers are stronger causal evidence than two entries merely appearing near one another.

### How Should Queries Answer Incident Questions?
<!-- section-summary: Cloud Logging queries should use the production question, then resource labels, severity, payload fields, and time windows. -->

During the checkout incident, the team first asks which errors came from the affected Cloud Run revision. The query uses the resource first and then narrows to service, region, revision, severity, and time window:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="checkout"
   resource.labels.location="us-central1"
   resource.labels.revision_name="checkout-00042-n9p"
   severity>=ERROR
   timestamp>="2026-06-14T14:00:00Z"
   timestamp<="2026-06-14T14:15:00Z"' \
  --project=checkout-prod \
  --limit=50 \
  --format=json
```

- `resource.type="cloud_run_revision"` keeps the search on Cloud Run revision logs.
- `resource.labels.service_name`, `location`, and `revision_name` point at the running service that served the request.
- `severity>=ERROR` keeps routine request logs out of the first pass.
- The timestamp range keeps the result tied to the incident window.
- `--format=json` shows the full LogEntry for teams that need the envelope and payload.

Example output:

```json
[
  {
    "timestamp": "2026-06-14T14:04:12.221Z",
    "severity": "ERROR",
    "resource": {
      "labels": {
        "service_name": "checkout",
        "revision_name": "checkout-00042-n9p",
        "location": "us-central1"
      }
    },
    "jsonPayload": {
      "message": "payment authorization timed out",
      "operation": "payment.authorize",
      "error_code": "payment_timeout",
      "release": "2026-06-14.3",
      "order_id": "ord-9182"
    },
    "trace": "projects/checkout-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736"
  }
]
```

Healthy output for a calm window returns no rows or a small number of unrelated handled errors. Suspicious output repeats the same revision, operation, release, and error code during the same period where Cloud Monitoring shows checkout latency and `5xx` rate rising.

After the first result shows a pattern, the next query asks how often the payment timeout appears:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="checkout"
   jsonPayload.error_code="payment_timeout"
   jsonPayload.release="2026-06-14.3"' \
  --project=checkout-prod \
  --freshness=30m \
  --limit=20 \
  --format='table(timestamp,severity,jsonPayload.order_id,jsonPayload.payment_provider,trace)'
```

- `jsonPayload.error_code` works because the app writes a stable structured field.
- `jsonPayload.release` checks whether the pattern belongs to the current release.
- `--freshness=30m` keeps a live incident search focused on recent entries.
- The table output gives the incident channel a compact evidence list.

Example output:

```console
TIMESTAMP                    SEVERITY  ORDER_ID  PAYMENT_PROVIDER  TRACE
2026-06-14T14:04:12.221Z     ERROR     ord-9182   stripe    projects/checkout-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736
2026-06-14T14:04:18.904Z     ERROR     ord-9183   stripe    projects/checkout-prod/traces/68b7a1d1f9304c87b6c5e3b8ad44a612
2026-06-14T14:04:25.019Z     ERROR     ord-9184   adyen    projects/checkout-prod/traces/7c3e2a4b99f54e13a6b7c0d19012ab44
```

Healthy output after a rollback should stop growing. Suspicious output keeps adding order IDs with the same error code and release, which means users still hit the failing path.

## How Does Trace Correlation Reconstruct One Request?
<!-- section-summary: Trace fields let one log event open the full request timeline in Cloud Trace. -->

**Trace correlation** means a log entry and a trace refer to the same request. Cloud Logging can link log entries with traces if entries include the `trace`, `spanId`, and `traceSampled` fields in the LogEntry structure. As the app writes structured JSON to stdout or stderr, the special fields `logging.googleapis.com/trace`, `logging.googleapis.com/spanId`, and `logging.googleapis.com/trace_sampled` can populate those LogEntry fields.

The beginner problem is simple: logs tell you events, and traces tell you timing, yet they are much more useful together. A failed checkout log might say `payment_timeout`. The trace can show that payment authorization took 4.7 seconds while cart validation and response handling were normal. Correlation is the bridge between those two views.

Think of trace correlation as putting the same case number on every evidence page. The log page says the payment operation timed out. The trace page shows the slow span. The shared trace ID lets a responder open the whole request timeline from one error record instead of manually comparing timestamps across tools.

This should be tested before an incident. A team can send one known checkout request, find its error or success log, copy the trace field, and query all logs for that trace. If the request path splits into multiple services and only one service has the trace field, context propagation needs more work.

The app needs to carry trace context through the request and write the active trace fields into the log entry. Many frameworks and OpenTelemetry integrations can do part of this automatically, but teams should still test it. During an incident is a bad time to discover that every error log is disconnected from traces.

After the team finds one failed checkout, it can query every log line connected to the same trace:

```bash
gcloud logging read \
  'trace="projects/checkout-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736"' \
  --project=checkout-prod \
  --format='table(timestamp,resource.labels.service_name,severity,jsonPayload.message,jsonPayload.operation)'
```

- The filter uses the trace ID from the representative failed log entry.
- The output can include logs from multiple services if they preserved the same trace context.
- The operation field shows where the request was in the application flow.

Example output:

```console
TIMESTAMP                    SERVICE_NAME       SEVERITY  MESSAGE                          OPERATION
2026-06-14T14:04:11.902Z     checkout   INFO      checkout request received          checkout.receive
2026-06-14T14:04:12.004Z     checkout   INFO      cart validated            cart.validate
2026-06-14T14:04:12.221Z     checkout   ERROR     payment authorization timed out    payment.authorize
2026-06-14T14:04:12.236Z     checkout   ERROR     returning checkout failure response response.write
```

Healthy trace-linked logs show a connected request story. Suspicious output has missing downstream services, repeated errors, or no trace field at all. Missing trace fields usually mean the logging library, framework integration, or OpenTelemetry setup is not attaching the active trace context to log events.

## What Evidence Do Audit Logs Add?
<!-- section-summary: Audit logs show Google Cloud API activity, so they explain who changed production resources around the incident. -->

**Audit logs** are records of Google Cloud API activity. They answer who changed what and at what time. Application logs explain what the checkout service did at runtime. Audit logs explain what people, automation, Google Cloud services, and policy systems did to cloud resources.

Cloud Audit Logs include several categories. **Admin Activity audit logs** record configuration and metadata changes, such as updating a Cloud Run service or changing IAM. **Data Access audit logs** record access to resource data and can be high volume. **System Event audit logs** record Google Cloud system actions. **Policy Denied audit logs** record access denied by security policy.

Admin Activity, System Event, and Policy Denied logs are different evidence streams, not alternative names for application errors. Data Access logs need an explicit volume and cost decision: many are disabled by default, with BigQuery as an important exception, because reads and writes can generate large numbers of entries. Check the configuration before relying on them during an investigation. Also remember that Cloud Audit Logs are not every possible security log. Network, operating-system, application, and product-specific security evidence can live in other log streams.

Application and audit evidence answer complementary questions. An application record might say the checkout could not acquire a database connection. An audit record might show that a deployment service account updated the Cloud Run service shortly before the errors started. Neither record alone proves the deployment caused the failure. Together with revision comparison and trace timing, they give the team a testable chronology instead of a guess based only on nearby timestamps.

A focused query for Cloud Run service updates looks like this:

```bash
gcloud logging read \
  'logName="projects/checkout-prod/logs/cloudaudit.googleapis.com%2Factivity"
   protoPayload.serviceName="run.googleapis.com"
   protoPayload.methodName:"UpdateService"
   timestamp>="2026-06-14T13:45:00Z"
   timestamp<="2026-06-14T14:10:00Z"' \
  --project=checkout-prod \
  --limit=20 \
  --format=json
```

- The `logName` selects the Admin Activity log stream.
- `protoPayload.serviceName="run.googleapis.com"` focuses on Cloud Run API activity.
- `protoPayload.methodName:"UpdateService"` catches service update methods.
- The time window begins before the runtime symptom so recent changes are visible.

Example output:

```json
[
  {
    "timestamp": "2026-06-14T13:58:44.312Z",
    "protoPayload": {
      "authenticationInfo": {
        "principalEmail": "ci-deploy@checkout-prod.iam.gserviceaccount.com"
      },
      "methodName": "google.cloud.run.v2.Services.UpdateService",
      "resourceName": "namespaces/checkout-prod/services/checkout",
      "requestMetadata": {
        "callerSuppliedUserAgent": "google-cloud-sdk gcloud/527.0.0"
      }
    }
  }
]
```

Healthy output shows an expected deployment principal and a resource that matches the planned release. Suspicious output shows an unexpected human account, repeated service updates, a nearby IAM or secret change, or a storage policy change that lines up with the checkout errors.

![Infographic showing audit log deployment evidence followed by runtime application errors in the same incident window.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-logging/audit-runtime-timeline.png)
*Audit logs and application logs answer different questions. The suspicious pattern is a production update shortly before repeated runtime errors in the same incident window.*

## How Do Log-Based Metrics Turn Events Into Numbers?
<!-- section-summary: Log-based metrics turn matching log entries into numbers that dashboards and alerts can use. -->

Logs are detailed event records. Monitoring often needs a number over time. A **log-based metric** bridges those two ideas by counting or extracting values from log entries that match a filter. It is useful for application failures that are already logged with stable fields but do not yet exist as a native metric.

Cloud Logging supports **counter metrics**, which count matching entries, and **distribution metrics**, which extract numeric values such as request size or processing duration into buckets. A counter can answer "How many payment timeouts occurred?" A distribution can answer "How are recorded authorization durations spread?" The filter and extracted value must be designed deliberately; turning every available payload field into a label creates a separate time series for every combination.

For `checkout`, the team already writes `jsonPayload.error_code="payment_timeout"`. During the incident, responders can search the logs by hand. For future incidents, the team can turn that repeated error into a counter metric and alert on the rate.

Create a counter metric from the structured log field:

```bash
gcloud logging metrics create payment_timeout_count \
  --project=checkout-prod \
  --description="Count payment timeout errors from checkout" \
  --log-filter='resource.type="cloud_run_revision"
    resource.labels.service_name="checkout"
    jsonPayload.error_code="payment_timeout"'
```

Important parts:

- The metric name describes the event being counted.
- The filter uses resource labels and the stable `error_code` field, not fragile message text.
- The metric counts future matching log entries after the metric exists; it is not a retroactive search over old logs.

Verify the metric definition:

```bash
gcloud logging metrics describe payment_timeout_count \
  --project=checkout-prod \
  --format="yaml(name,description,filter,metricDescriptor.metricKind,metricDescriptor.valueType)"
```

Example output:

```yaml
description: Count payment timeout errors from checkout
filter: |-
  resource.type="cloud_run_revision"
  resource.labels.service_name="checkout"
  jsonPayload.error_code="payment_timeout"
metricDescriptor:
  metricKind: DELTA
  valueType: INT64
name: payment_timeout_count
```

This output proves the metric is a counter. Cloud Monitoring can graph it as a rate, and an alert policy can notify the team if payment timeouts rise above a small threshold for several minutes. Keep metric labels low-cardinality. A metric label for `release` or `service` can be useful. A metric label for every `order_id` would create too many time series and make the metric harder to operate.

## How Do the Log Router, Sinks, Buckets, and Retention Work?
<!-- section-summary: Routing and retention decide which logs stay searchable, which logs export, and which teams can review them later. -->

After logs exist, the next production question is where they should go and how long they should stay. Cloud Logging receives log entries, then the **Log Router** evaluates them against **sinks**. A **sink** is a routing rule with a filter and a destination. A **retention** policy controls how long stored logs remain available in a log bucket.

The routing path is worth reading in order: a producer emits an entry, Cloud Logging receives it, the Log Router evaluates sink filters, and matching sinks send it to their destinations. A log bucket is the native searchable storage destination. BigQuery supports analytical queries, Cloud Storage supports archival workflows, and Pub/Sub supports downstream processing. Routing a record does not change the historical event; it changes where copies of that evidence remain available.

A sink can route log entries to log buckets, BigQuery, Cloud Storage, Pub/Sub, and other supported destinations. Recent operational logs often stay in log buckets for fast incident search. Security and audit logs often route to central buckets or BigQuery for longer review. Debug logs may use shorter retention because they are high volume and lower value after the immediate troubleshooting window.

Here is a sink that routes Cloud Run error logs for `checkout` into a central operations log bucket:

```bash
gcloud logging sinks create checkout-errors \
  logging.googleapis.com/projects/central-observability/locations/global/buckets/prod-app-errors \
  --project=checkout-prod \
  --log-filter='resource.type="cloud_run_revision"
    resource.labels.service_name="checkout"
    severity>=ERROR'
```

- The sink name is `checkout-errors`.
- The destination is a central log bucket in `central-observability`.
- The filter keeps the route focused on Cloud Run error logs for one service.
- The command creates the sink; the sink writer identity still needs permission on the destination.

Example output:

```console
Created [https://logging.googleapis.com/v2/projects/checkout-prod/sinks/checkout-errors].
Please remember to grant `serviceAccount:service-123456789012@gcp-sa-logging.iam.gserviceaccount.com`
the Logging Bucket Writer role on the destination.
```

Healthy setup output includes a writer identity that the team grants on the destination bucket. Suspicious setup is a sink that exists without destination permission, because the Log Router can match entries and then fail to write them where responders expect them.

Describe the sink and copy the writer identity exactly:

```bash
gcloud logging sinks describe checkout-errors \
  --project=checkout-prod \
  --format="yaml(name,destination,filter,writerIdentity)"
```

Example output:

```yaml
destination: logging.googleapis.com/projects/central-observability/locations/global/buckets/prod-app-errors
filter: |-
  resource.type="cloud_run_revision"
  resource.labels.service_name="checkout"
  severity>=ERROR
name: checkout-errors
writerIdentity: serviceAccount:service-123456789012@gcp-sa-logging.iam.gserviceaccount.com
```

Grant that writer identity permission on the destination log bucket:

```bash
gcloud logging buckets add-iam-policy-binding prod-app-errors \
  --project=central-observability \
  --location=global \
  --member="serviceAccount:service-123456789012@gcp-sa-logging.iam.gserviceaccount.com" \
  --role=roles/logging.bucketWriter
```

Important parts:

- The writer identity belongs to the source project sink.
- The IAM grant belongs on the destination bucket in `central-observability`.
- Without this grant, the sink can exist and still fail to deliver routed logs.

Retention is a separate setting on the log bucket. Set and verify it on the destination bucket:

```bash
gcloud logging buckets update prod-app-errors \
  --project=central-observability \
  --location=global \
  --retention-days=30

gcloud logging buckets describe prod-app-errors \
  --project=central-observability \
  --location=global \
  --format="yaml(name,retentionDays,locked)"
```

Example output:

```yaml
locked: false
name: projects/central-observability/locations/global/buckets/prod-app-errors
retentionDays: 30
```

The delivery check should use one known error after the sink is created. Trigger a harmless staging-style error or wait for the next real matching error, then search the destination bucket through Logs Explorer or your team's approved query path. Useful evidence includes the source project, destination bucket, sink name, writer identity grant, retention setting, and one matching log entry visible in the destination.

Retention defaults differ by bucket. The required `_Required` bucket retains its protected audit logs for 400 days. The `_Default` bucket and user-defined buckets default to 30 days, and user-configurable retention can range from 1 to 3,650 days. A team should confirm the actual bucket setting rather than assuming the default still applies.

The planning equation is simple: logging cost pressure grows with **volume × retention × analysis**. Good field selection reduces expensive broad searches, filters keep low-value noise out of long-lived destinations, and retention matches operational or compliance needs. None of those controls excuses writing secrets. Tokens, private keys, session cookies, raw payment data, and unnecessary personal data should never become searchable evidence in the first place.

## How Does Cloud Logging Support a Complete Investigation?

### How Does the Model Map to AWS?
<!-- section-summary: AWS has similar logging jobs, while GCP uses LogEntry envelopes, monitored resources, and Log Router sinks as the core shape. -->

If you know AWS, Cloud Logging is closest to CloudWatch Logs for application and platform logs. Cloud Logging queries fill the job many teams use CloudWatch Logs Insights for. Cloud Audit Logs fill the change-history job that CloudTrail usually fills. Log Router sinks are close to the routing job you may know from CloudWatch subscription filters, Kinesis Data Firehose delivery, S3 archives, and central logging accounts.

The GCP shape has a few details worth noticing. A LogEntry has a standard envelope with `resource`, `severity`, `timestamp`, `trace`, and payload fields. The monitored resource model gives you service, region, revision, and project context for managed GCP resources. Log Router sinks can live at project, folder, organization, and billing-account levels, which helps centralize audit evidence across many projects.

### What Is the Complete Logging Model?
<!-- section-summary: Logging turns production behavior into searchable evidence and keeps the right records available for incident and audit review. -->

For the checkout incident, Cloud Logging gives you structured runtime events, platform context, trace fields, audit evidence, routing controls, and retention decisions. The practical workflow is steady: filter by resource labels and time, read structured payload fields, follow the trace, check audit logs, then make sure the records that matter are routed and retained for the right team.

The final evidence should answer a chain of bounded questions. What failed? Which source and revision reported it? How many requests showed the same signature? What happened along one representative trace? Which configuration or access events occurred near the start? Did the pattern stop after mitigation? A reliable investigation records both positive and negative evidence: the affected release failed while the previous release remained healthy, payment authorization slowed while cart validation did not, and the error counter stopped increasing after rollback. That comparison is stronger than a pile of matching error messages.

Timestamps help arrange this evidence, but ordering does not establish causation by itself. Clock differences, buffered delivery, retries, and concurrent operations can make nearby events look related. Use shared identifiers, revision fields, trace context, controlled comparisons, and post-mitigation behavior to test the causal story. Logging preserves what the system recorded; disciplined investigation turns those records into a defensible explanation.

The next monitoring layer turns repeated log and request patterns into numbers over time. Logs explain the exact event. Metrics show how often the event happens, how broad the symptom is, and whether a fix is working.

## Check Your Answers

:::expand[What Is a LogEntry?]{kind="recap"}
A LogEntry is one event object, not a line in one giant file. Its standard envelope carries source, time, severity, log name, and correlation context; its text, JSON, or protocol-buffer payload carries the event-specific evidence. Severity helps prioritize a search, but the fields and surrounding evidence determine what happened.
:::

:::expand[How Do Monitored Resources and Labels Identify the Source?]{kind="recap"}
The monitored resource identifies the kind of GCP source, and its resource labels identify the concrete project, location, service, or revision. LogEntry labels add record-level context, while payload fields describe the application event. Strong queries combine platform source context with stable application dimensions.
:::

:::expand[Why Do Structured Logs Make Better Queries?]{kind="recap"}
Structured logs store dimensions such as route, operation, release, provider, and error code as fields. Responders can filter and group those fields precisely, and log-based metrics do not have to match fragile prose. The fields must remain safe: useful evidence never requires secrets or raw sensitive data.
:::

:::expand[How Does Trace Correlation Reconstruct One Request?]{kind="recap"}
Trace, span, and sampling fields put the same request identifier on logs and traces. A responder can start from a representative error entry, find the matching request timeline, and retrieve related events across services. Teams need to test propagation and log enrichment before an incident.
:::

:::expand[What Evidence Do Audit Logs Add?]{kind="recap"}
Application logs describe runtime behavior; audit logs describe cloud API activity. Admin Activity, Data Access, System Event, and Policy Denied logs answer different questions. Data Access availability must be checked deliberately, and timestamp proximity alone does not prove that a change caused an application failure.
:::

:::expand[How Do Log-Based Metrics Turn Events Into Numbers?]{kind="recap"}
A counter metric counts entries matching a filter, while a distribution metric extracts numeric values into a distribution. They let Monitoring graph and alert on events already represented reliably in logs. Low-cardinality labels keep the resulting number of time series controllable.
:::

:::expand[How Do the Log Router, Sinks, Buckets, and Retention Work?]{kind="recap"}
The Log Router evaluates entries against sink filters and sends matching records to destinations such as log buckets, BigQuery, Cloud Storage, or Pub/Sub. Cross-project sinks need destination permission for their writer identity. Retention, access, and delivery must each be verified separately.
:::

:::expand[How Does Cloud Logging Support a Complete Investigation?]{kind="recap"}
Start with the affected resource and time window, inspect stable structured fields, follow one trace, and compare runtime evidence with audit activity. Then confirm that important evidence is routed, searchable, and retained for the required period. This sequence turns scattered records into a testable incident account.
:::

## References

- [Cloud Logging overview](https://docs.cloud.google.com/logging/docs/overview) - Official overview of Cloud Logging storage, search, analysis, and monitoring support.
- [Structured logging](https://docs.cloud.google.com/logging/docs/structured-logging) - Documents structured JSON payloads and special fields for Cloud Logging.
- [LogEntry reference](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry) - Defines LogEntry fields including payloads, resource, labels, trace fields, severity, and timestamps.
- [Cloud Audit Logs](https://docs.cloud.google.com/logging/docs/audit) - Documents Admin Activity, Data Access, System Event, and Policy Denied audit logs.
- [Log Router overview](https://docs.cloud.google.com/logging/docs/routing/overview) - Documents log sinks, filters, and routing destinations.
- [Route logs to supported destinations](https://docs.cloud.google.com/logging/docs/export/configure_export_v2) - Documents sink destinations and cross-project routing patterns.
- [Log-based metrics overview](https://docs.cloud.google.com/logging/docs/logs-based-metrics) - Documents counter and distribution metrics derived from log filters.
