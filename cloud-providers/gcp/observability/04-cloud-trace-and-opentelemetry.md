---
title: "Cloud Trace and OpenTelemetry"
description: "Follow requests through Cloud Run, GKE, Cloud SQL, Pub/Sub, and external calls using Cloud Trace, trace context, and OpenTelemetry."
overview: "Cloud Trace shows how one request moved through services, while OpenTelemetry gives applications a standard way to create spans, propagate context, correlate logs, and control sampling. The example follows one image upload request across the GCP observability path."
tags: ["gcp", "observability", "trace", "opentelemetry", "distributed-tracing"]
order: 4
id: article-cloud-providers-gcp-observability-cloud-trace-and-opentelemetry
---

## Table of Contents

1. [One Request, Several Service Calls](#one-request-several-service-calls)
2. [Trace](#trace)
3. [Span](#span)
4. [Trace Context And Traceparent](#trace-context-and-traceparent)
5. [Attributes](#attributes)
6. [OpenTelemetry](#opentelemetry)
7. [Exporter And Collector](#exporter-and-collector)
8. [Log Correlation](#log-correlation)
9. [Async Work And Sampling](#async-work-and-sampling)
10. [AWS Bridge](#aws-bridge)
11. [Putting It All Together](#putting-it-all-together)
12. [References](#references)

## One Request, Several Service Calls
<!-- section-summary: Tracing helps with user requests that split into several service calls and require path and timing evidence. -->

One user request can turn into several service calls. In the upload product, a browser sends `POST /uploads` to `image-upload-api`. The service stores the original file in Cloud Storage, creates a thumbnail, writes metadata, publishes a Pub/Sub message, and returns a response to the user.

On your laptop, you might add a print statement and follow one request by watching the terminal. Production does not give you that simple view. The request may cross multiple services, managed APIs, queues, and workers. Each part can log its own small truth, yet the team still needs one connected path.

After a request fails or feels slow, logs can tell you what individual services wrote. Metrics can tell you that latency rose. You still need the path and timing for one request. You need to know whether the slow part was the upload handler, Cloud Storage write, thumbnail generation, database insert, Pub/Sub publish, or a downstream worker.

**Distributed tracing** records that request path. In Google Cloud, **Cloud Trace** stores and displays trace data. **OpenTelemetry** gives your application a standard way to create spans, carry context across service boundaries, add attributes, export telemetry, and correlate logs with traces.

## Trace
<!-- section-summary: A trace represents one end-to-end operation, such as one image upload request. -->

A **trace** represents one end-to-end operation. For this service, one trace can represent one image upload from the incoming HTTP request to the response. The trace has one trace ID, and every timed piece of work inside that request belongs to that same trace.

The trace ID is the thread that ties the story together. Logs may live in Cloud Logging, spans may show in Cloud Trace, and downstream services may run in different places. The trace ID lets tools and humans say, "these records belong to the same user action." Without that shared ID, a responder has to line up timestamps by hand and hope the clocks and filters are close enough.

One trace is not the whole incident. It is a carefully chosen example of the incident. Metrics show the broad symptom, logs show repeated patterns, and one trace shows the detailed route for a representative request. That keeps the team from guessing which dependency was slow.

For a failed upload, the trace might show that the whole request lasted 5.2 seconds. The Cloud Storage write took 180 milliseconds, metadata insert took 40 milliseconds, Pub/Sub publish took 60 milliseconds, and thumbnail generation took 4.7 seconds before returning an error. That view lets the team focus on the expensive operation instead of guessing from timestamps.

![Infographic showing one image upload request moving from browser to image-upload-api, Cloud Storage, thumbnail generation, metadata DB, Pub/Sub, and worker, with the thumbnail span highlighted as the timeout.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-trace-and-opentelemetry/image-upload-trace-path.png)
*The trace turns one user action into a timed path. In this incident, the slow error span points the team toward thumbnail generation before they dig into code.*

Cloud Trace can also help compare many requests. If failed traces share the same slow span and release attribute, the team can inspect that release. If slow spans move across dependencies, the incident might involve load, retries, network behavior, or shared configuration.

## Span
<!-- section-summary: A span is one timed unit of work inside a trace. -->

A **span** is one timed unit of work inside a trace. It has a name, start time, end time, parent relationship, status, events, and attributes. A trace is the whole upload story. Spans are the chapters inside that story.

Think of the trace as a timeline and spans as the labeled bars on that timeline. Each bar says one operation started, ran for a measured duration, and ended with a status. If the whole upload took 5.2 seconds, spans show whether the time went to Cloud Storage, thumbnail generation, metadata insert, Pub/Sub publish, or some code path inside the API.

The span boundary should match work a developer can understand and a responder can act on. `thumbnail.generate` is useful because it names a real operation. `function_12` is hard to read. A span named with a unique upload ID is also harmful because trace tools then see thousands of operation names instead of one operation with many examples.

Useful span names for `image-upload-api` might include `POST /uploads`, `storage.objects.create`, `thumbnail.generate`, `metadata.insert`, and `pubsub.uploads.publish`. The names should describe stable operations. A span name such as `POST /uploads/upl_9f21` creates a new operation name for every upload and makes trace views noisy.

The parent-child relationship is also important. The `POST /uploads` server span can be the parent. The Cloud Storage write, thumbnail generation, metadata insert, and Pub/Sub publish spans can be children. That structure shows which work happened inside the request and which operation caused the user-visible delay.

## Trace Context And Traceparent
<!-- section-summary: Trace context carries the trace identity and parent span information from one service call to the next. -->

**Trace context** is the identity package that travels with a request. It carries the trace ID for the whole operation, the current span or parent span information, and usually a sampling decision. Each service reads the incoming context, records its own span, and passes updated context to the next service.

For HTTP calls, OpenTelemetry commonly uses the W3C `traceparent` header to carry that context:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

- `00` is the version.
- `4bf92f3577b34da6a3ce929d0e0e4736` is the trace ID for the end-to-end upload request.
- `00f067aa0ba902b7` is the parent span ID for the operation that made this call.
- `01` is the sampled flag, which tells downstream instrumentation that this request should be recorded if the SDK respects that decision.

The practical flow is simple. `image-upload-api` receives a request with incoming context or starts a new trace. HTTP server instrumentation creates the server span for `POST /uploads`. Client instrumentation injects context into outbound calls. If another service or worker receives the request, it extracts the context and adds its own spans to the same trace.

![Infographic explaining the traceparent header parts and showing trace context moving from upload API to storage, thumbnail worker, and publish step.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-trace-and-opentelemetry/trace-context-propagation.png)
*Trace context keeps the same trace ID across services while each operation creates its own span. A missing propagation step splits one upload into separate traces.*

## Attributes
<!-- section-summary: Attributes add searchable context to spans through stable, safe fields. -->

**Attributes** are key-value pairs attached to spans. They add context that helps search, group, and compare traces. OpenTelemetry defines standard resource attributes such as `service.name`, `service.version`, and `deployment.environment`. Application teams can add safe domain attributes such as `upload.file_size_band`, `image.format`, or `operation.name`.

Attributes should be stable and safe. Good trace attributes describe the service, release, route, operation, dependency, status class, or small file-size band. Risky attributes include raw user IDs, upload IDs, signed URLs, full paths with IDs, tokens, filenames that contain private details, or image metadata that was not reviewed for privacy.

The easiest way to choose attributes is to ask what a responder needs to compare. They may need to compare upload traces by release, environment, route, file-size band, image format, or dependency. They usually do not need raw customer names, signed URLs, or full filenames. Good attributes make repeated traces searchable without turning telemetry into a privacy dump.

Attributes also help sampling and dashboards later. If traces carry `service.version` and `upload.file_size_band`, the team can compare slow traces from the new release against the old release or see whether large files are the only affected group. That is the kind of depth a plain duration number cannot provide.

| Trace field | Good example | Why it helps |
|---|---|---|
| `service.name` | `image-upload-api` | Connects spans to the owning service |
| `service.version` | `2026-06-14.3` | Connects traces to the release |
| `deployment.environment` | `prod` | Separates production from lower environments |
| `http.route` | `/uploads` | Groups route latency without unique IDs |
| `upload.file_size_band` | `10mb_to_25mb` | Helps compare performance by safe size range |
| `error.type` | `ThumbnailTimeoutError` | Helps group failing spans |

A few reviewed attributes can make traces useful. Too many attributes can turn every span into a noisy dump of application internals.

## OpenTelemetry
<!-- section-summary: OpenTelemetry gives applications standard APIs, SDKs, instrumentation, propagation, and exporters for traces. -->

**OpenTelemetry** is an open standard and toolkit for collecting telemetry from applications. For tracing, it provides APIs, SDKs, auto-instrumentation, context propagation, resource attributes, and exporters. Cloud Trace can display the trace data after your application or collector sends it to Google Cloud.

For a Node.js upload service, the first local setup might install the SDK, common auto-instrumentations, and an OTLP HTTP exporter:

```bash
npm install \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http
```

- `@opentelemetry/sdk-node` starts the Node telemetry pipeline.
- `@opentelemetry/auto-instrumentations-node` creates spans for supported HTTP frameworks and client libraries.
- `@opentelemetry/exporter-trace-otlp-http` sends spans through OTLP over HTTP.

Example output:

```console
added 84 packages, and audited 512 packages in 7s
found 0 vulnerabilities
```

Healthy install output completes without dependency conflicts. Suspicious output includes peer dependency warnings around the framework or exporter versions, because failed instrumentation can leave Cloud Trace with only partial spans.

A small instrumentation file can start the SDK before the server handles requests:

```javascript
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  }),
  instrumentations: [getNodeAutoInstrumentations()]
});

sdk.start();
```

Run the service with stable resource attributes:

```bash
OTEL_SERVICE_NAME=image-upload-api \
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=prod,service.version=2026-06-14.3 \
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces \
node --require ./instrumentation.js server.js
```

- `OTEL_SERVICE_NAME` gives Cloud Trace a stable service name.
- `OTEL_RESOURCE_ATTRIBUTES` attaches environment and release context.
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` points the SDK at the local collector endpoint.
- `node --require ./instrumentation.js` loads instrumentation before application code initializes.

Example output:

```console
OpenTelemetry SDK started for service image-upload-api
Listening on port 8080
OTLP trace exporter endpoint http://127.0.0.1:4318/v1/traces
```

Healthy startup output confirms that instrumentation starts before the server accepts traffic. Suspicious startup output includes collector connection errors, missing `service.name`, or instrumentation loading after the HTTP framework has already initialized.

## Exporter And Collector
<!-- section-summary: Exporters send telemetry out of the process, and collectors receive, batch, process, and forward it to Google Cloud. -->

An **exporter** sends telemetry from the SDK to another destination. An application can export directly to a backend, but many production setups send OTLP telemetry to an OpenTelemetry Collector. The **collector** receives telemetry, batches it, adds processing, handles retries, and exports it to Google Cloud.

A simplified collector configuration for traces has this shape:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
      http:

processors:
  batch:

exporters:
  googlecloud:

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [googlecloud]
```

- The OTLP receiver accepts telemetry from the app over gRPC or HTTP.
- The batch processor groups spans before export.
- The `googlecloud` exporter sends trace data to Google Cloud.
- The traces pipeline connects the receiver, processor, and exporter.

Treat this as the smallest teaching shape, not a complete production collector. A production collector usually adds health checks, memory limits, resource detection, authentication choices, retry behavior, and clearer deployment ownership. If the collector runs on Cloud Run, the team also needs to confirm startup health, service identity, network path, and exporter permissions before relying on it for incident evidence.

Example collector startup output:

```console
info    service@v0.102.0/service.go:110    Starting otelcol
info    otlpreceiver@v0.102.0/otlp.go:152  Starting GRPC server endpoint=0.0.0.0:4317
info    otlpreceiver@v0.102.0/otlp.go:100  Starting HTTP server endpoint=0.0.0.0:4318
info    service@v0.102.0/service.go:137    Everything is ready. Begin running and processing data.
```

Healthy output shows the collector listening on the ports the application uses. Suspicious output includes permission denied errors from the exporter, repeated retry messages, authentication failures, or no OTLP receiver on the expected port.

![Infographic showing image-upload-api sending OTLP telemetry to a collector, which batches and exports spans to trace viewer, log search, and metric charts.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-trace-and-opentelemetry/otel-collector-pipeline.png)
*The collector gives the team one standard telemetry path. The verification checklist should confirm service name, release version, downstream spans, and trace-linked logs.*

## Log Correlation
<!-- section-summary: Log correlation lets a slow or failed span open the exact logs written during the same request. -->

Traces and logs answer different parts of the incident. A trace can show that `thumbnail.generate` took 4.7 seconds and ended with an error. Logs can show retry count, file-size band, sanitized error code, release, and upload ID. **Log correlation** joins those views by putting trace and span fields into log entries.

The practical workflow should feel simple. You find one slow span in Cloud Trace, copy the trace ID, and open the logs for that same request. Or you find an error log first, click through to the trace, and inspect the timed path. Without correlation, the responder has to compare timestamps, request IDs, and guesses across tools.

For the upload service, correlation lets the team prove that the `thumbnail_timeout` log and the 4.7-second `thumbnail.generate` span belong to the same user action. That proof keeps the incident focused and makes the evidence easier to share in a review.

Here is the log shape from the active thumbnail span:

```json
{
  "severity": "ERROR",
  "message": "thumbnail generation timed out",
  "route": "POST /uploads",
  "operation": "thumbnail.generate",
  "error_code": "thumbnail_timeout",
  "retry_count": 2,
  "release": "2026-06-14.3",
  "logging.googleapis.com/trace": "projects/media-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "logging.googleapis.com/spanId": "00f067aa0ba902b7",
  "logging.googleapis.com/trace_sampled": true
}
```

A responder can query Cloud Logging by the trace field:

```bash
gcloud logging read \
  'trace="projects/media-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736"' \
  --project=media-prod \
  --format='table(timestamp,resource.labels.service_name,severity,jsonPayload.message,jsonPayload.error_code)'
```

- The trace filter comes from Cloud Trace or a trace-linked log entry.
- The table output gives a readable request journal.
- The same query can show multiple services if context propagation and logging hooks are working.

Example output:

```console
TIMESTAMP                    SERVICE_NAME       SEVERITY  MESSAGE                         ERROR_CODE
2026-06-14T14:04:11.902Z     image-upload-api   INFO      upload request received
2026-06-14T14:04:12.004Z     image-upload-api   INFO      original image stored
2026-06-14T14:04:12.221Z     image-upload-api   ERROR     thumbnail generation timed out   thumbnail_timeout
2026-06-14T14:04:12.236Z     image-upload-api   ERROR     returning upload failure         thumbnail_timeout
```

Healthy output shows a connected request story with expected services and no context break. Suspicious output shows only partial logs, missing trace fields, or an error log that cannot be linked back to the trace.

## Async Work And Sampling
<!-- section-summary: Async boundaries need explicit context handoff, and sampling controls how much trace data is recorded. -->

HTTP propagation is the easiest case because headers travel with the request. Async systems need more care because work leaves the request, waits in Pub/Sub or Cloud Tasks, and continues later in another runtime. The producer should carry trace context and a safe business handle into the message so the consumer can continue the story.

A Pub/Sub message for the upload workflow might carry context like this:

```json
{
  "message": {
    "data": "eyJ1cGxvYWRfaWQiOiJ1cGxfOWYyMSJ9",
    "attributes": {
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      "upload_id": "upl_9f21",
      "file_size_band": "10mb_to_25mb",
      "service_version": "2026-06-14.3"
    }
  }
}
```

- `traceparent` carries trace context across the message boundary.
- `upload_id` gives humans a durable support handle, so it belongs in logs or support tools unless the team has reviewed the cardinality and privacy impact of adding it to traces.
- `service_version` connects the async work to the release that produced it.

The consumer has to extract that context before it starts its own span. In a Node.js worker, the code can look like this:

```javascript
import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("thumbnail-worker");

export async function handlePubSubMessage(message) {
  const attributes = message.attributes ?? {};
  const parentContext = propagation.extract(context.active(), attributes);

  return context.with(parentContext, async () => {
    const span = tracer.startSpan("thumbnail.worker.process", {
      kind: SpanKind.CONSUMER,
      attributes: {
        "messaging.system": "gcp_pubsub",
        "messaging.destination.name": "image-thumbnail-jobs",
        "app.file_size_band": attributes.file_size_band ?? "unknown",
        "service.version": attributes.service_version
      }
    });

    try {
      await renderThumbnail(message.data);
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

- `propagation.extract` reads `traceparent` from the Pub/Sub attributes.
- `context.with` makes the extracted parent context active while the worker runs.
- `SpanKind.CONSUMER` marks this span as message consumption.
- `app.file_size_band` is a low-cardinality attribute, so it is safer for trace search than one unique upload ID per request.
- Keep the unique `upload_id` in structured logs or support evidence and connect it to traces through the trace ID.

Healthy output should connect the producer and consumer:

```console
TRACE_ID                          SPAN_NAME                    PARENT
4bf92f3577b34da6a3ce929d0e0e4736  upload-api.publish-job       thumbnail.generate
4bf92f3577b34da6a3ce929d0e0e4736  thumbnail.worker.process     upload-api.publish-job
```

- The trace ID stays the same across the API and worker spans.
- The worker span has the publish span as its parent or linked parent, depending on the messaging instrumentation.
- If the worker has a different trace ID and no shared `upload_id`, context was lost at the message boundary.

Tracing every request can create cost and volume problems for busy services. **Sampling** decides which traces are recorded. A parent-based sampler commonly lets downstream spans follow the upstream sampling decision. Many teams sample routine successful traffic at a lower rate and keep more error traces because error traces have high incident value.

For a busy upload API, a small parent-based sampler can keep traces consistent across services:

```javascript
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler
} from "@opentelemetry/sdk-trace-base";
import { NodeSDK } from "@opentelemetry/sdk-node";

const sdk = new NodeSDK({
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(0.10),
    remoteParentSampled: new AlwaysOnSampler(),
    remoteParentNotSampled: new AlwaysOffSampler()
  })
});

sdk.start();
```

- `root` samples about 10 percent of new traces that begin in this service.
- `remoteParentSampled` keeps child spans after an upstream service already sampled the trace.
- `remoteParentNotSampled` skips child spans after the upstream service already chose not to sample.
- Errors should still produce structured logs and metrics, because a sampler can skip a successful-looking request before a later system notices the business failure.

Healthy sampling evidence has two parts. Normal traffic shows a steady trace volume rather than every request. Error dashboards and logs still show the real incident rate even if only part of the traffic has full traces. If Cloud Trace has almost no traces for a busy service, check the sampler, exporter, collector logs, and service-account permissions. If Cloud Trace has every request during peak traffic, check cost and retention before the signal gets noisy.

Sampling should never be the only evidence path. Metrics still show scope, and structured logs still explain important events even without a sampled trace. A healthy setup has metrics, logs, and traces supporting each other.

## AWS Bridge
<!-- section-summary: AWS X-Ray and OpenTelemetry solve similar tracing jobs, while GCP uses Cloud Trace and Cloud Logging correlation fields. -->

If you know AWS, Cloud Trace is closest to AWS X-Ray for following one request across services. OpenTelemetry works in both ecosystems, so a team can use the same basic ideas: spans, context propagation, resource attributes, exporters, collectors, and sampling. CloudWatch ServiceLens-style workflows are useful anchors if you have used traces, metrics, and logs together in AWS.

The GCP detail to notice is the Cloud Logging link. Log entries with `trace`, `spanId`, and `traceSampled` let Cloud Logging and Cloud Trace talk about the same request. For Cloud Run and other GCP services, resource labels also help tie the trace back to project, region, service, and revision.

## Putting It All Together
<!-- section-summary: Cloud Trace and OpenTelemetry connect the request path, while logs, metrics, and audit evidence complete the incident story. -->

The upload incident now has a full request story. Cloud Monitoring shows sustained `5xx` rate and high p95 latency. Cloud Logging shows structured `thumbnail_timeout` errors from revision `image-upload-api-00042-n9p`. Cloud Trace shows one request spending most of its time in `thumbnail.generate`. Trace-linked logs show retry count, release, file-size band, and sanitized error code. Audit logs show the deployment that moved traffic to the new revision.

OpenTelemetry provides the application side of that story. It creates spans, carries trace context through HTTP and async boundaries, adds service and release attributes, exports OTLP telemetry to a collector, and lets the team connect traces with logs. Google Cloud stores and displays the evidence through Cloud Trace, Cloud Logging, and Cloud Monitoring.

## References

- [Cloud Trace documentation](https://cloud.google.com/trace/docs) - Official documentation for distributed tracing and latency analysis in Google Cloud.
- [Traces and spans](https://docs.cloud.google.com/trace/docs/traces-and-spans) - Defines traces as end-to-end operations and spans as timed records for operations.
- [Instrument for Cloud Trace](https://cloud.google.com/trace/docs/setup) - Documents Google Cloud instrumentation guidance and OpenTelemetry setup paths.
- [Link log entries with traces](https://docs.cloud.google.com/trace/docs/trace-log-integration) - Documents `trace`, `spanId`, and `traceSampled` fields for log correlation.
- [Trace sampling](https://docs.cloud.google.com/trace/docs/trace-sampling) - Documents sampling behavior and incomplete traces.
- [Deploy Google-Built OpenTelemetry Collector on Cloud Run](https://cloud.google.com/stackdriver/docs/instrumentation/opentelemetry-collector-cloud-run) - Documents the collector path for OTLP telemetry on Cloud Run.
- [OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/) - Explains traces, spans, span context, and trace exporters.
- [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/) - Explains context propagation across service boundaries.
- [W3C Trace Context](https://www.w3.org/TR/trace-context/) - Defines the `traceparent` header format.
