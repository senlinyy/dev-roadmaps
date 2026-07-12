---
title: "Cloud Logging and Audit Evidence"
description: "Use structured logs, LogEntry fields, audit logs, Log Router sinks, retention, exports, and log-based metrics during a real GCP incident."
overview: "Cloud Logging stores application, platform, and audit evidence as structured records. The example follows image-upload-api 500s through jsonPayload fields, resource labels, trace correlation, audit logs, routing, and retention."
tags: ["gcp", "observability", "logging", "audit-logs", "log-router"]
order: 2
id: article-cloud-providers-gcp-observability-cloud-logging
aliases:
  - cloud-logging
---

## Table of Contents

1. [A Log Is A Record](#a-log-is-a-record)
2. [Log Entries And Severity](#log-entries-and-severity)
3. [Resource Labels](#resource-labels)
4. [Structured Logs](#structured-logs)
5. [Queries That Answer Incident Questions](#queries-that-answer-incident-questions)
6. [Trace Correlation](#trace-correlation)
7. [Audit Logs](#audit-logs)
8. [Log-Based Metrics](#log-based-metrics)
9. [Log Router, Sinks, And Retention](#log-router-sinks-and-retention)
10. [AWS Bridge](#aws-bridge)
11. [Putting It All Together](#putting-it-all-together)
12. [References](#references)

## A Log Is A Record
<!-- section-summary: A log is one event record, and Cloud Logging gives those records storage, search, routing, and retention. -->

A **log** is a record of something that happened. Your application can write a log as it receives a request, saves a file, retries a dependency, catches an error, or rejects bad input. Google Cloud services can write logs as a Cloud Run revision serves traffic, a load balancer receives a request, a storage bucket is accessed, or a control-plane API changes a resource.

**Cloud Logging** is Google Cloud's managed service for storing, searching, routing, and analyzing those records. In the `image-upload-api` incident, logs tell you what happened inside one upload request after Cloud Monitoring shows that latency and errors are rising.

Think of logs as the system's dated notebook, written in a way computers can search. A useful notebook entry does not only say "upload failed." It says which service wrote the entry, which revision served the request, which operation failed, which safe error code appeared, and which trace can open the full request path.

Logs are especially useful for questions about a specific event. Which request failed? Which object name did the app try to write? Which sanitized provider error did the payment service return? Metrics can show that errors are rising, and traces can show the timed path, but logs give the detailed event records responders inspect line by line.

The first useful log question is direct: "Which event explains one failed upload?" A useful answer might say the route was `POST /uploads`, the operation was `thumbnail.generate`, the release was `2026-06-14.3`, the file was in the `10mb_to_25mb` size band, and the sanitized error code was `thumbnail_timeout`.

![Infographic comparing a weak unstructured log with a structured log that includes severity, route, release, error code, trace ID, and revision.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-logging/structured-log-evidence.png)
*Structured logs give responders stable fields to filter, group, and connect to traces. The exact library can vary; the field discipline is the important part.*

## Log Entries And Severity
<!-- section-summary: A LogEntry has an envelope for source context and a payload for event details, and severity controls the first triage filter. -->

Cloud Logging stores each record as a **LogEntry**. A beginner can read a LogEntry in two parts. The envelope tells where the event came from, the event time, how severe it was, which log stream stored it, and whether it links to a trace. The payload tells what the application, platform, or audit source reported.

**Severity** is the importance level on the entry. Common values include `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`, `ALERT`, and `EMERGENCY`. During an incident, severity helps the team remove routine noise from the first search. A live triage query can use `severity>=ERROR` first, then narrow by resource labels and time.

Think of the LogEntry envelope as the mailing label and the payload as the letter inside. The mailing label says which project, service, revision, log stream, severity, and timestamp produced the record. The letter says what the application reported. A responder usually checks the mailing label first because a perfect payload from the wrong revision can send the investigation in the wrong direction.

Severity is a triage hint and one part of the truth. An `ERROR` entry should get attention. Repeated `WARNING` entries can also explain a slow incident. A production team should still use stable fields such as route, release, operation, and trace ID so severity does not carry all the meaning.

Here is a simplified stored entry from the upload incident:

```json
{
  "insertId": "684ee1a90004b0b6",
  "logName": "projects/media-prod/logs/run.googleapis.com%2Fstdout",
  "resource": {
    "type": "cloud_run_revision",
    "labels": {
      "project_id": "media-prod",
      "location": "us-central1",
      "service_name": "image-upload-api",
      "revision_name": "image-upload-api-00042-n9p",
      "configuration_name": "image-upload-api"
    }
  },
  "severity": "ERROR",
  "jsonPayload": {
    "message": "thumbnail generation timed out",
    "route": "POST /uploads",
    "operation": "thumbnail.generate",
    "upload_id": "upl_9f21",
    "file_size_band": "10mb_to_25mb",
    "error_code": "thumbnail_timeout",
    "release": "2026-06-14.3"
  },
  "timestamp": "2026-06-14T14:04:12.221Z",
  "trace": "projects/media-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "d5b0214a4f6d9a12",
  "traceSampled": true
}
```

The envelope narrows the search to the Cloud Run revision. The payload explains the application event. The trace fields give the team a path from this log entry into the request timeline.

## Resource Labels
<!-- section-summary: Resource labels identify the exact Google Cloud resource that produced a log entry. -->

**Resource labels** are structured fields attached to the monitored resource. For Cloud Run revision logs, labels can include project ID, location, service name, revision name, and configuration name. These fields are the safest first filter because they describe the source of the log entry before the team reads message text.

Think of resource labels as the return address on the evidence. A log line that says `thumbnail generation timed out` is useful, yet it is incomplete by itself. The responder also needs to know which project, region, service, and revision produced it. Resource labels answer that before the team starts reading application payloads.

For `image-upload-api`, the resource labels tell the responder whether an error came from production or staging, from `us-central1` or another region, and from the new revision or an older revision still receiving traffic. That matters during rollouts because two revisions can serve requests at the same time.

Resource labels are different from application labels. Resource labels come from the Google Cloud monitored resource model. Application labels and JSON payload fields come from your service design. A strong incident query usually uses both: resource labels for the platform source, payload fields for the application meaning.

A good first Cloud Logging filter usually follows this order:

1. Choose the monitored resource type, such as `cloud_run_revision`.
2. Choose the production project and region.
3. Choose the service and revision.
4. Add severity or payload fields after the source is correct.

That order keeps a beginner from searching every log in the project for a message string and accidentally mixing staging, old revisions, and unrelated services into one result.

## Structured Logs
<!-- section-summary: Structured JSON logs give Cloud Logging fields that responders can filter, group, route, and correlate. -->

**Structured logs** are log events written as JSON fields instead of one flat string. Cloud Logging can store recognized fields in the LogEntry envelope and the remaining application fields in `jsonPayload`. That gives the team precise filters such as `jsonPayload.error_code="thumbnail_timeout"` instead of fragile searches through message text.

The practical benefit is search accuracy. A flat message like `upload failed for large file` requires text matching and human interpretation. A structured event can say `operation="thumbnail.generate"`, `file_size_band="10mb_to_25mb"`, `error_code="thumbnail_timeout"`, and `release="2026-06-14.3"`. Now the team can count, filter, group, and route logs by stable fields instead of hoping every developer wrote the same sentence.

Structured logs also make dashboards and alerts safer. A log-based metric can count `jsonPayload.error_code="thumbnail_timeout"` without matching unrelated messages that happen to include the same words. That precision is the difference between a useful alert and a noisy one.

Here is the application-side JSON event before Cloud Logging stores it:

```json
{
  "severity": "ERROR",
  "message": "thumbnail generation timed out",
  "route": "POST /uploads",
  "operation": "thumbnail.generate",
  "upload_id": "upl_9f21",
  "file_size_band": "10mb_to_25mb",
  "error_code": "thumbnail_timeout",
  "release": "2026-06-14.3",
  "logging.googleapis.com/trace": "projects/media-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "logging.googleapis.com/spanId": "d5b0214a4f6d9a12",
  "logging.googleapis.com/trace_sampled": true,
  "logging.googleapis.com/labels": {
    "team": "media",
    "env": "prod",
    "service": "image-upload-api"
  }
}
```

The important pieces are deliberate. `severity` drives the first triage filter. `route`, `operation`, `error_code`, and `release` answer stable incident questions. `upload_id` is a support handle, not a metric label. The special `logging.googleapis.com/*` fields let Cloud Logging populate labels and trace fields in the stored LogEntry.

The safety rule is just as important as the shape. Keep tokens, signed URLs, raw image bytes, full user profiles, session cookies, and private keys out of logs. A good log has enough detail to investigate and enough restraint to avoid creating a second data problem.

## Queries That Answer Incident Questions
<!-- section-summary: Cloud Logging queries should use the production question, then resource labels, severity, payload fields, and time windows. -->

During the upload incident, the team first asks which errors came from the affected Cloud Run revision. The query uses the resource first and then narrows to service, region, revision, severity, and time window:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="image-upload-api"
   resource.labels.location="us-central1"
   resource.labels.revision_name="image-upload-api-00042-n9p"
   severity>=ERROR
   timestamp>="2026-06-14T14:00:00Z"
   timestamp<="2026-06-14T14:15:00Z"' \
  --project=media-prod \
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
        "service_name": "image-upload-api",
        "revision_name": "image-upload-api-00042-n9p",
        "location": "us-central1"
      }
    },
    "jsonPayload": {
      "message": "thumbnail generation timed out",
      "operation": "thumbnail.generate",
      "error_code": "thumbnail_timeout",
      "release": "2026-06-14.3",
      "upload_id": "upl_9f21"
    },
    "trace": "projects/media-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736"
  }
]
```

Healthy output for a calm window returns no rows or a small number of unrelated handled errors. Suspicious output repeats the same revision, operation, release, and error code during the same period where Cloud Monitoring shows upload latency and `5xx` rate rising.

After the first result shows a pattern, the next query asks how often the thumbnail timeout appears:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="image-upload-api"
   jsonPayload.error_code="thumbnail_timeout"
   jsonPayload.release="2026-06-14.3"' \
  --project=media-prod \
  --freshness=30m \
  --limit=20 \
  --format='table(timestamp,severity,jsonPayload.upload_id,jsonPayload.file_size_band,trace)'
```

- `jsonPayload.error_code` works because the app writes a stable structured field.
- `jsonPayload.release` checks whether the pattern belongs to the current release.
- `--freshness=30m` keeps a live incident search focused on recent entries.
- The table output gives the incident channel a compact evidence list.

Example output:

```console
TIMESTAMP                    SEVERITY  UPLOAD_ID  FILE_SIZE_BAND  TRACE
2026-06-14T14:04:12.221Z     ERROR     upl_9f21   10mb_to_25mb    projects/media-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736
2026-06-14T14:04:18.904Z     ERROR     upl_9f22   10mb_to_25mb    projects/media-prod/traces/68b7a1d1f9304c87b6c5e3b8ad44a612
2026-06-14T14:04:25.019Z     ERROR     upl_9f23   25mb_to_50mb    projects/media-prod/traces/7c3e2a4b99f54e13a6b7c0d19012ab44
```

Healthy output after a rollback should stop growing. Suspicious output keeps adding upload IDs with the same error code and release, which means users still hit the failing path.

## Trace Correlation
<!-- section-summary: Trace fields let one log event open the full request timeline in Cloud Trace. -->

**Trace correlation** means a log entry and a trace refer to the same request. Cloud Logging can link log entries with traces if entries include the `trace`, `spanId`, and `traceSampled` fields in the LogEntry structure. As the app writes structured JSON to stdout or stderr, the special fields `logging.googleapis.com/trace`, `logging.googleapis.com/spanId`, and `logging.googleapis.com/trace_sampled` can populate those LogEntry fields.

The beginner problem is simple: logs tell you events, and traces tell you timing, yet they are much more useful together. A failed upload log might say `thumbnail_timeout`. The trace can show that thumbnail generation took 4.7 seconds, while Cloud Storage and metadata writes were normal. Correlation is the bridge between those two views.

Think of trace correlation as putting the same case number on every evidence page. The log page says the thumbnail operation timed out. The trace page shows the slow span. The shared trace ID lets a responder open the whole request timeline from one error record instead of manually comparing timestamps across tools.

This should be tested before an incident. A team can send one known upload request, find its error or success log, copy the trace field, and query all logs for that trace. If the request path splits into multiple services and only one service has the trace field, context propagation needs more work.

The app needs to carry trace context through the request and write the active trace fields into the log entry. Many frameworks and OpenTelemetry integrations can do part of this automatically, but teams should still test it. During an incident is a bad time to discover that every error log is disconnected from traces.

After the team finds one failed upload, it can query every log line connected to the same trace:

```bash
gcloud logging read \
  'trace="projects/media-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736"' \
  --project=media-prod \
  --format='table(timestamp,resource.labels.service_name,severity,jsonPayload.message,jsonPayload.operation)'
```

- The filter uses the trace ID from the representative failed log entry.
- The output can include logs from multiple services if they preserved the same trace context.
- The operation field shows where the request was in the application flow.

Example output:

```console
TIMESTAMP                    SERVICE_NAME       SEVERITY  MESSAGE                          OPERATION
2026-06-14T14:04:11.902Z     image-upload-api   INFO      upload request received          upload.receive
2026-06-14T14:04:12.004Z     image-upload-api   INFO      original image stored            storage.write
2026-06-14T14:04:12.221Z     image-upload-api   ERROR     thumbnail generation timed out    thumbnail.generate
2026-06-14T14:04:12.236Z     image-upload-api   ERROR     returning upload failure response response.write
```

Healthy trace-linked logs show a connected request story. Suspicious output has missing downstream services, repeated errors, or no trace field at all. Missing trace fields usually mean the logging library, framework integration, or OpenTelemetry setup is not attaching the active trace context to log events.

## Audit Logs
<!-- section-summary: Audit logs show Google Cloud API activity, so they explain who changed production resources around the incident. -->

**Audit logs** are records of Google Cloud API activity. They answer who changed what and at what time. Application logs explain what the upload service did at runtime. Audit logs explain what people, automation, Google Cloud services, and policy systems did to cloud resources.

Cloud Audit Logs include several categories. **Admin Activity audit logs** record configuration and metadata changes, such as updating a Cloud Run service or changing IAM. **Data Access audit logs** record access to resource data and can be high volume. **System Event audit logs** record Google Cloud system actions. **Policy Denied audit logs** record access denied by security policy.

A focused query for Cloud Run service updates looks like this:

```bash
gcloud logging read \
  'logName="projects/media-prod/logs/cloudaudit.googleapis.com%2Factivity"
   protoPayload.serviceName="run.googleapis.com"
   protoPayload.methodName:"UpdateService"
   timestamp>="2026-06-14T13:45:00Z"
   timestamp<="2026-06-14T14:10:00Z"' \
  --project=media-prod \
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
        "principalEmail": "ci-deploy@media-prod.iam.gserviceaccount.com"
      },
      "methodName": "google.cloud.run.v2.Services.UpdateService",
      "resourceName": "namespaces/media-prod/services/image-upload-api",
      "requestMetadata": {
        "callerSuppliedUserAgent": "google-cloud-sdk gcloud/527.0.0"
      }
    }
  }
]
```

Healthy output shows an expected deployment principal and a resource that matches the planned release. Suspicious output shows an unexpected human account, repeated service updates, a nearby IAM or secret change, or a storage policy change that lines up with the upload errors.

![Infographic showing audit log deployment evidence followed by runtime application errors in the same incident window.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-logging/audit-runtime-timeline.png)
*Audit logs and application logs answer different questions. The suspicious pattern is a production update shortly before repeated runtime errors in the same incident window.*

## Log-Based Metrics
<!-- section-summary: Log-based metrics turn matching log entries into numbers that dashboards and alerts can use. -->

Logs are detailed event records. Monitoring often needs a number over time. A **log-based metric** bridges those two ideas by counting or extracting values from log entries that match a filter. It is useful for application failures that are already logged with stable fields but do not yet exist as a native metric.

For `image-upload-api`, the team already writes `jsonPayload.error_code="thumbnail_timeout"`. During the incident, responders can search the logs by hand. For future incidents, the team can turn that repeated error into a counter metric and alert on the rate.

Create a counter metric from the structured log field:

```bash
gcloud logging metrics create thumbnail_timeout_count \
  --project=media-prod \
  --description="Count thumbnail timeout errors from image-upload-api" \
  --log-filter='resource.type="cloud_run_revision"
    resource.labels.service_name="image-upload-api"
    jsonPayload.error_code="thumbnail_timeout"'
```

Important parts:

- The metric name describes the event being counted.
- The filter uses resource labels and the stable `error_code` field, not fragile message text.
- The metric counts future matching log entries after the metric exists; it is not a retroactive search over old logs.

Verify the metric definition:

```bash
gcloud logging metrics describe thumbnail_timeout_count \
  --project=media-prod \
  --format="yaml(name,description,filter,metricDescriptor.metricKind,metricDescriptor.valueType)"
```

Example output:

```yaml
description: Count thumbnail timeout errors from image-upload-api
filter: |-
  resource.type="cloud_run_revision"
  resource.labels.service_name="image-upload-api"
  jsonPayload.error_code="thumbnail_timeout"
metricDescriptor:
  metricKind: DELTA
  valueType: INT64
name: thumbnail_timeout_count
```

This output proves the metric is a counter. Cloud Monitoring can graph it as a rate, and an alert policy can notify the team if thumbnail timeouts rise above a small threshold for several minutes. Keep metric labels low-cardinality. A metric label for `release` or `service` can be useful. A metric label for every `upload_id` would create too many time series and make the metric harder to operate.

## Log Router, Sinks, And Retention
<!-- section-summary: Routing and retention decide which logs stay searchable, which logs export, and which teams can review them later. -->

After logs exist, the next production question is where they should go and how long they should stay. Cloud Logging receives log entries, then the **Log Router** evaluates them against **sinks**. A **sink** is a routing rule with a filter and a destination. A **retention** policy controls how long stored logs remain available in a log bucket.

A sink can route log entries to log buckets, BigQuery, Cloud Storage, Pub/Sub, and other supported destinations. Recent operational logs often stay in log buckets for fast incident search. Security and audit logs often route to central buckets or BigQuery for longer review. Debug logs may use shorter retention because they are high volume and lower value after the immediate troubleshooting window.

Here is a sink that routes Cloud Run error logs for `image-upload-api` into a central operations log bucket:

```bash
gcloud logging sinks create image-upload-errors \
  logging.googleapis.com/projects/media-observability/locations/global/buckets/prod-app-errors \
  --project=media-prod \
  --log-filter='resource.type="cloud_run_revision"
    resource.labels.service_name="image-upload-api"
    severity>=ERROR'
```

- The sink name is `image-upload-errors`.
- The destination is a central log bucket in `media-observability`.
- The filter keeps the route focused on Cloud Run error logs for one service.
- The command creates the sink; the sink writer identity still needs permission on the destination.

Example output:

```console
Created [https://logging.googleapis.com/v2/projects/media-prod/sinks/image-upload-errors].
Please remember to grant `serviceAccount:service-123456789012@gcp-sa-logging.iam.gserviceaccount.com`
the Logging Bucket Writer role on the destination.
```

Healthy setup output includes a writer identity that the team grants on the destination bucket. Suspicious setup is a sink that exists without destination permission, because the Log Router can match entries and then fail to write them where responders expect them.

Describe the sink and copy the writer identity exactly:

```bash
gcloud logging sinks describe image-upload-errors \
  --project=media-prod \
  --format="yaml(name,destination,filter,writerIdentity)"
```

Example output:

```yaml
destination: logging.googleapis.com/projects/media-observability/locations/global/buckets/prod-app-errors
filter: |-
  resource.type="cloud_run_revision"
  resource.labels.service_name="image-upload-api"
  severity>=ERROR
name: image-upload-errors
writerIdentity: serviceAccount:service-123456789012@gcp-sa-logging.iam.gserviceaccount.com
```

Grant that writer identity permission on the destination log bucket:

```bash
gcloud logging buckets add-iam-policy-binding prod-app-errors \
  --project=media-observability \
  --location=global \
  --member="serviceAccount:service-123456789012@gcp-sa-logging.iam.gserviceaccount.com" \
  --role=roles/logging.bucketWriter
```

Important parts:

- The writer identity belongs to the source project sink.
- The IAM grant belongs on the destination bucket in `media-observability`.
- Without this grant, the sink can exist and still fail to deliver routed logs.

Retention is a separate setting on the log bucket. Set and verify it on the destination bucket:

```bash
gcloud logging buckets update prod-app-errors \
  --project=media-observability \
  --location=global \
  --retention-days=30

gcloud logging buckets describe prod-app-errors \
  --project=media-observability \
  --location=global \
  --format="yaml(name,retentionDays,locked)"
```

Example output:

```yaml
locked: false
name: projects/media-observability/locations/global/buckets/prod-app-errors
retentionDays: 30
```

The delivery check should use one known error after the sink is created. Trigger a harmless staging-style error or wait for the next real matching error, then search the destination bucket through Logs Explorer or your team's approved query path. Useful evidence includes the source project, destination bucket, sink name, writer identity grant, retention setting, and one matching log entry visible in the destination.

![Infographic showing incoming operational errors, audit logs, and debug noise routed through Log Router filters into log buckets, BigQuery, short retention, and a log-based metric.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-logging/log-routing-plan.png)
*Routing is part of incident design. Operational errors need fast search, audit logs need longer review paths, and noisy debug entries usually need tighter retention.*

## AWS Bridge
<!-- section-summary: AWS has similar logging jobs, while GCP uses LogEntry envelopes, monitored resources, and Log Router sinks as the core shape. -->

If you know AWS, Cloud Logging is closest to CloudWatch Logs for application and platform logs. Cloud Logging queries fill the job many teams use CloudWatch Logs Insights for. Cloud Audit Logs fill the change-history job that CloudTrail usually fills. Log Router sinks are close to the routing job you may know from CloudWatch subscription filters, Kinesis Data Firehose delivery, S3 archives, and central logging accounts.

The GCP shape has a few details worth noticing. A LogEntry has a standard envelope with `resource`, `severity`, `timestamp`, `trace`, and payload fields. The monitored resource model gives you service, region, revision, and project context for managed GCP resources. Log Router sinks can live at project, folder, organization, and billing-account levels, which helps centralize audit evidence across many projects.

## Putting It All Together
<!-- section-summary: Logging turns production behavior into searchable evidence and keeps the right records available for incident and audit review. -->

For the image upload incident, Cloud Logging gives you structured runtime events, platform context, trace fields, audit evidence, routing controls, and retention decisions. The practical workflow is steady: filter by resource labels and time, read structured payload fields, follow the trace, check audit logs, then make sure the records that matter are routed and retained for the right team.

The next monitoring layer turns repeated log and request patterns into numbers over time. Logs explain the exact event. Metrics show how often the event happens, how broad the symptom is, and whether a fix is working.

## References

- [Cloud Logging overview](https://docs.cloud.google.com/logging/docs/overview) - Official overview of Cloud Logging storage, search, analysis, and monitoring support.
- [Structured logging](https://docs.cloud.google.com/logging/docs/structured-logging) - Documents structured JSON payloads and special fields for Cloud Logging.
- [LogEntry reference](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry) - Defines LogEntry fields including payloads, resource, labels, trace fields, severity, and timestamps.
- [Cloud Audit Logs](https://docs.cloud.google.com/logging/docs/audit) - Documents Admin Activity, Data Access, System Event, and Policy Denied audit logs.
- [Log Router overview](https://docs.cloud.google.com/logging/docs/routing/overview) - Documents log sinks, filters, and routing destinations.
- [Route logs to supported destinations](https://docs.cloud.google.com/logging/docs/export/configure_export_v2) - Documents sink destinations and cross-project routing patterns.
- [Log-based metrics overview](https://docs.cloud.google.com/logging/docs/logs-based-metrics) - Documents counter and distribution metrics derived from log filters.
