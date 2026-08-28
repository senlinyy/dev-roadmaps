---
title: "Cloud Trace and OpenTelemetry"
description: "Follow requests through Cloud Run, GKE, Cloud SQL, Pub/Sub, and external calls using Cloud Trace, trace context, and OpenTelemetry."
overview: "Cloud Trace shows how one request moved through services, while OpenTelemetry gives applications a standard way to create spans, propagate context, correlate logs, and control sampling. The example follows one checkout request across the GCP observability path."
tags: ["gcp", "observability", "trace", "opentelemetry", "distributed-tracing"]
order: 4
id: article-cloud-providers-gcp-observability-cloud-trace-and-opentelemetry
---

## Table of Contents

1. [How Do Traces and Spans Reconstruct One Request?](#how-do-traces-and-spans-reconstruct-one-request)
2. [How Does Trace Context Cross Service Boundaries?](#how-does-trace-context-cross-service-boundaries)
3. [How Do Attributes, Events, and Links Describe Spans?](#how-do-attributes-events-and-links-describe-spans)
4. [How Do OpenTelemetry and Cloud Trace Divide the Work?](#how-do-opentelemetry-and-cloud-trace-divide-the-work)
5. [How Do Exporters and Collectors Move Telemetry?](#how-do-exporters-and-collectors-move-telemetry)
6. [How Do Logs and Async Work Preserve Causality?](#how-do-logs-and-async-work-preserve-causality)
7. [How Does Sampling Control Trace Volume?](#how-does-sampling-control-trace-volume)
8. [How Does Tracing Support One Incident?](#how-does-tracing-support-one-incident)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

One user request can turn into several service calls. A browser sends `POST /checkout` through a frontend to the checkout service. Checkout calls inventory, pricing, and payment services. Payment may wait for a database connection and execute a query. The workflow can also publish a message for work that continues after the response.

In a monolith, the request might enter one process, authenticate, calculate a price, query a database, and return. A profiler and local logs can sometimes explain a five-second response because all work shares one process. Once the application is distributed, the same click becomes several HTTP or RPC calls, a database operation, a message publish, and a later consume across different runtimes. The user still clicked once, so the evidence must preserve one logical identity and its causal history across those boundaries.

On your laptop, you might add a print statement and follow one request by watching the terminal. Production does not give you that simple view. The request may cross multiple services, managed APIs, queues, and workers. Each part can log its own small truth, yet the team still needs one connected path.

Keep these questions in view as you work through the lesson:

1. **How Do Traces and Spans Reconstruct One Request?**
2. **How Does Trace Context Cross Service Boundaries?**
3. **How Do Attributes, Events, and Links Describe Spans?**
4. **How Do OpenTelemetry and Cloud Trace Divide the Work?**
5. **How Do Exporters and Collectors Move Telemetry?**
6. **How Do Logs and Async Work Preserve Causality?**
7. **How Does Sampling Control Trace Volume?**
8. **How Does Tracing Support One Incident?**

## How Do Traces and Spans Reconstruct One Request?
<!-- section-summary: Tracing helps with user requests that split into several service calls and require path and timing evidence. -->

After a request fails or feels slow, logs can tell you what individual services wrote. Metrics can tell you that latency rose. You still need the path and timing for one request. You need to know whether the slow part was the checkout handler, cart validation, payment authorization, database insert, event publish, or a downstream worker.

Knowing that checkout took five seconds is only the starting point. A trace can decompose it into authentication at 30 ms, inventory at 80 ms, pricing at 40 ms, and payment at 4.8 seconds. A child span can then show that payment spent 4.5 seconds acquiring a database connection and 200 ms executing SQL. That causal decomposition is what distinguishes tracing from one end-to-end latency number.

**Distributed tracing** records that request path. In Google Cloud, **Cloud Trace** stores and displays trace data. **OpenTelemetry** gives your application a standard way to create spans, carry context across service boundaries, add attributes, export telemetry, and correlate logs with traces.

### What Is a Trace?
<!-- section-summary: A trace represents one end-to-end operation, such as one checkout request. -->

A **trace** represents one end-to-end operation. For this service, one trace can represent one checkout from the incoming HTTP request to the response. The trace has one trace ID, and every timed piece of work inside that request belongs to that same trace.

The trace ID is the thread that ties the story together. Logs may live in Cloud Logging, spans may show in Cloud Trace, and downstream services may run in different places. The trace ID lets tools and humans say, "these records belong to the same user action." Without that shared ID, a responder has to line up timestamps by hand and hope the clocks and filters are close enough.

One trace is not the whole incident. It is a carefully chosen example of the incident. Metrics show the broad symptom, logs show repeated patterns, and one trace shows the detailed route for a representative request. That keeps the team from guessing which dependency was slow.

For a failed checkout, the trace might show that the whole request lasted 5.2 seconds. The cart validation took 180 milliseconds, database query took 40 milliseconds, event publish took 60 milliseconds, and payment authorization took 4.7 seconds before returning an error. That view lets the team focus on the expensive operation instead of guessing from timestamps.

Cloud Trace can also help compare many requests. If failed traces share the same slow span and release attribute, the team can inspect that release. If slow spans move across dependencies, the incident might involve load, retries, network behavior, or shared configuration.

### What Is a Span?
<!-- section-summary: A span is one timed unit of work inside a trace. -->

A **span** is one timed unit of work inside a trace. It has a name, start time, end time, parent relationship, status, events, and attributes. A trace is the whole checkout story. Spans are the chapters inside that story.

Think of the trace as a timeline and spans as the labeled bars on that timeline. Each bar says one operation started, ran for a measured duration, and ended with a status. If the whole checkout took 5.2 seconds, spans show whether the time went to cart service, payment authorization, database query, event publish, or some code path inside the API.

The span boundary should match work a developer can understand and a responder can act on. `payment.authorize` is useful because it names a real operation. `function_12` is hard to read. A span named with a unique order ID is also harmful because trace tools then see thousands of operation names instead of one operation with many examples.

Useful span names for `checkout` might include `POST /checkout`, `cart.validate`, `payment.authorize`, `database.query`, and `events.checkout.publish`. The names should describe stable operations. A span name such as `POST /checkout/ord-9182` creates a new operation name for every checkout and makes trace views noisy.

The parent-child relationship is also important. The `POST /checkout` server span can be the parent. The cart validation, payment authorization, database query, and event publish spans can be children. That structure shows which work happened inside the request and which operation caused the user-visible delay.

Spans do not have to run one after another. Child spans can overlap when work happens in parallel, so adding all child durations can exceed the trace's wall-clock duration. Their placement on the timeline shows the critical path more accurately than a simple sum.

OpenTelemetry also gives spans a **kind** such as `SERVER`, `CLIENT`, `PRODUCER`, `CONSUMER`, or `INTERNAL`. A server span receives the checkout request, a client span calls a dependency, a producer span publishes work, and a consumer span handles it. Kind describes the operation's role at a boundary and helps the trace viewer reconstruct direction.

## How Does Trace Context Cross Service Boundaries?
<!-- section-summary: Trace context carries the trace identity and parent span information from one service call to the next. -->

**Trace context** is the identity package that travels with an operation. It carries the trace ID for the whole operation, the current parent span ID, and trace flags that include the sampling decision. Each service extracts incoming context before creating its span and injects the resulting context into the next outbound call.

For HTTP calls, OpenTelemetry commonly uses the W3C `traceparent` header to carry that context:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

- `00` is the version.
- `4bf92f3577b34da6a3ce929d0e0e4736` is the trace ID for the end-to-end checkout request.
- `00f067aa0ba902b7` is the parent span ID for the operation that made this call.
- `01` is the sampled flag, which tells downstream instrumentation that this request should be recorded if the SDK respects that decision.

The practical flow is simple. `checkout` receives a request with incoming context or starts a new trace. HTTP server instrumentation creates the server span for `POST /checkout`. Client instrumentation injects context into outbound calls. If another service or worker receives the request, it extracts the context and adds its own spans to the same trace.


## How Do Attributes, Events, and Links Describe Spans?
<!-- section-summary: Attributes add searchable context to spans through stable, safe fields. -->

**Attributes** are key-value pairs attached to spans. They add context that helps search, group, and compare traces. OpenTelemetry defines standard resource attributes such as `service.name`, `service.version`, and `deployment.environment`. Application teams can add safe domain attributes such as `payment.provider` or `operation.name`.

Attributes should be stable and safe. Good trace attributes describe the service, release, route, operation, dependency, status class, or small payment provider. Risky attributes include raw customer IDs, order IDs, full payment responses, raw card details, tokens, order references that contain private details, or payment metadata that was not reviewed for privacy.

The easiest way to choose attributes is to ask what a responder needs to compare. They may need to compare checkout traces by release, environment, route, payment provider, status, or dependency. They usually do not need raw customer names, full payment responses, or full order references. Good attributes make repeated traces searchable without turning telemetry into a privacy dump.

Attributes also help sampling and dashboards later. If traces carry `service.version` and `payment.provider`, the team can compare slow traces from the new release against the old release or see whether one provider is the only affected group. That is the kind of depth a plain duration number cannot provide.

| Trace field | Good example | Why it helps |
|---|---|---|
| `service.name` | `checkout` | Connects spans to the owning service |
| `service.version` | `2026-06-14.3` | Connects traces to the release |
| `deployment.environment` | `prod` | Separates production from lower environments |
| `http.route` | `/checkout` | Groups route latency without unique IDs |
| `payment.provider` | `stripe` | Helps compare performance by a bounded provider name |
| `error.type` | `DatabaseConnectionTimeout` | Helps group failing spans |

A few reviewed attributes can make traces useful. Too many attributes can turn every span into a noisy dump of application internals.

Span attributes describe one operation. **Resource attributes** describe the entity producing telemetry, such as service, version, environment, cloud region, and runtime. Keeping the two levels distinct makes a query easier to reason about: the payment provider belongs to one client operation, while `service.version` describes every span emitted by that service instance.

A span can also contain **events**, **status**, and **links**. An event marks a notable instant, such as a retry or handled exception. Status records whether the operation completed successfully or with an error. A link associates the span with another span context when a strict parent-child tree is inaccurate, which matters for batching and fan-out. These fields complement clear span boundaries; they do not replace them.

## How Do OpenTelemetry and Cloud Trace Divide the Work?
<!-- section-summary: OpenTelemetry gives applications standard APIs, SDKs, instrumentation, propagation, and exporters for traces. -->

**OpenTelemetry** is an open standard and toolkit for collecting telemetry from applications. For tracing, it provides APIs, SDKs, auto-instrumentation, context propagation, resource attributes, and exporters. Cloud Trace can display the trace data after your application or collector sends it to Google Cloud.

The division is important. The OpenTelemetry **API** is what instrumentation calls. The **SDK** creates, samples, processes, and exports telemetry. **Instrumentation** observes frameworks and libraries automatically or through manual spans. **OTLP** is the vendor-neutral protocol used to send telemetry. Cloud Trace is the Google Cloud backend that stores and presents the trace data. OpenTelemetry creates and transports the evidence; Cloud Trace is where a GCP team explores it.

Google Cloud currently recommends OpenTelemetry for application instrumentation and provides a Google Cloud Telemetry API path for OTLP ingestion. This preserves portable application concepts while Google Cloud supplies managed ingestion and analysis. Whichever deployment path the team chooses, it must verify the current setup guide, enabled APIs, service identity, endpoint, and permissions together.

For a Node.js checkout service, the first local setup might install the SDK, common auto-instrumentations, and an OTLP HTTP exporter:

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
OTEL_SERVICE_NAME=checkout \
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
OpenTelemetry SDK started for service checkout
Listening on port 8080
OTLP trace exporter endpoint http://127.0.0.1:4318/v1/traces
```

Healthy startup output confirms that instrumentation starts before the server accepts traffic. Suspicious startup output includes collector connection errors, missing `service.name`, or instrumentation loading after the HTTP framework has already initialized.

Auto-instrumentation is a starting point, not proof of a complete request story. It can create server, client, and database spans for supported libraries, but application operations such as price calculation or checkout validation may still need manual spans. Verify one known request from entry to exit: stable service and version resources, correct server and client kinds, expected dependency spans, preserved context, safe attributes, meaningful status, and a trace-linked log. Missing spans should drive a focused instrumentation change rather than a large set of arbitrary manual spans.

Instrumentation must also avoid changing application behavior. Export should normally happen off the critical request path, and telemetry failures should not fail a customer checkout. Bound queues and batching so a slow backend does not consume unlimited memory. Observability code is production code: version it, test it with the framework and runtime, and monitor its own export failures.

## How Do Exporters and Collectors Move Telemetry?
<!-- section-summary: Exporters send telemetry out of the process, and collectors receive, batch, process, and forward it to Google Cloud. -->

An **exporter** sends telemetry from the SDK to another destination. An application can export directly to a backend, but many production setups send OTLP telemetry to an OpenTelemetry Collector. The **collector** receives telemetry, batches it, adds processing, handles retries, and exports it to Google Cloud.

The collector follows a pipeline: **receivers** accept telemetry, **processors** transform or buffer it, and **exporters** send it onward. Centralizing that pipeline can keep backend-specific settings out of every application and give a platform team one place to apply batching, memory controls, resource detection, filtering, and retry behavior.

The collector is another production component that can fail. If an application reaches the OTLP endpoint but Cloud Trace remains empty, inspect receiver reachability, queue and retry output, authentication, Telemetry API permissions, and exporter responses. A healthy application process proves neither that the collector accepted spans nor that the backend stored them.

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


## How Do Logs and Async Work Preserve Causality?
<!-- section-summary: Log correlation lets a slow or failed span open the exact logs written during the same request. -->

Traces and logs answer different parts of the incident. A trace can show that `payment.authorize` took 4.7 seconds and ended with an error. Logs can show retry count, payment provider, sanitized error code, release, and order ID. **Log correlation** joins those views by putting trace and span fields into log entries.

The practical workflow should feel simple. You find one slow span in Cloud Trace, copy the trace ID, and open the logs for that same request. Or you find an error log first, click through to the trace, and inspect the timed path. Without correlation, the responder has to compare timestamps, request IDs, and guesses across tools.

Correlation does not require copying every span attribute into every log. It means writing the active trace ID and span ID into the LogEntry fields while keeping safe event details in the structured payload. Logs remain useful for unsampled requests, and traces remain useful for timed structure. When a trace exists, the identifiers let both evidence types meet on the same operation.

For the checkout service, correlation lets the team prove that the `database_pool_exhausted` log and the 4.7-second `payment.authorize` span belong to the same user action. That proof keeps the incident focused and makes the evidence easier to share in a review.

Here is the log shape from the active payment span:

```json
{
  "severity": "ERROR",
  "message": "payment authorization timed out",
  "route": "POST /checkout",
  "operation": "payment.authorize",
  "error_code": "database_pool_exhausted",
  "retry_count": 2,
  "release": "2026-06-14.3",
  "logging.googleapis.com/trace": "projects/checkout-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "logging.googleapis.com/spanId": "00f067aa0ba902b7",
  "logging.googleapis.com/trace_sampled": true
}
```

A responder can query Cloud Logging by the trace field:

```bash
gcloud logging read \
  'trace="projects/checkout-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736"' \
  --project=checkout-prod \
  --format='table(timestamp,resource.labels.service_name,severity,jsonPayload.message,jsonPayload.error_code)'
```

- The trace filter comes from Cloud Trace or a trace-linked log entry.
- The table output gives a readable request journal.
- The same query can show multiple services if context propagation and logging hooks are working.

Example output:

```console
TIMESTAMP                    SERVICE_NAME       SEVERITY  MESSAGE                         ERROR_CODE
2026-06-14T14:04:11.902Z     checkout   INFO      checkout request received
2026-06-14T14:04:12.004Z     checkout   INFO      cart validated
2026-06-14T14:04:12.221Z     checkout   ERROR     payment authorization timed out   database_pool_exhausted
2026-06-14T14:04:12.236Z     checkout   ERROR     returning checkout failure       database_pool_exhausted
```

Healthy output shows a connected request story with expected services and no context break. Suspicious output shows only partial logs, missing trace fields, or an error log that cannot be linked back to the trace.

### How Does Context Continue Through Async Work?
<!-- section-summary: Async boundaries need explicit context handoff, and sampling controls how much trace data is recorded. -->

HTTP propagation is the easiest case because headers travel with the request. Async systems need more care because work leaves the request, waits in Pub/Sub or Cloud Tasks, and continues later in another runtime. The producer should carry trace context and a safe business handle into the message so the consumer can continue the story.

A Pub/Sub message for the checkout workflow might carry context like this:

```json
{
  "message": {
    "data": "eyJ1cGxvYWRfaWQiOiJ1cGxfOWYyMSJ9",
    "attributes": {
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      "order_id": "ord-9182",
      "payment_provider": "stripe",
      "service_version": "2026-06-14.3"
    }
  }
}
```

- `traceparent` carries trace context across the message boundary.
- `order_id` gives humans a durable support handle, so it belongs in logs or support tools unless the team has reviewed the cardinality and privacy impact of adding it to traces.
- `service_version` connects the async work to the release that produced it.

The consumer has to extract that context before it starts its own span. In a Node.js worker, the code can look like this:

```javascript
import { context, propagation, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("payment-worker");

export async function handlePubSubMessage(message) {
  const attributes = message.attributes ?? {};
  const parentContext = propagation.extract(context.active(), attributes);

  return context.with(parentContext, async () => {
    const span = tracer.startSpan("payment.worker.process", {
      kind: SpanKind.CONSUMER,
      attributes: {
        "messaging.system": "gcp_pubsub",
        "messaging.destination.name": "payment-jobs",
        "app.payment_provider": attributes.payment_provider ?? "unknown",
        "service.version": attributes.service_version
      }
    });

    try {
      await authorizePayment(message.data);
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
- `app.payment_provider` is a low-cardinality attribute, so it is safer for trace search than one unique order ID per request.
- Keep the unique `order_id` in structured logs or support evidence and connect it to traces through the trace ID.

Healthy output should connect the producer and consumer:

```console
TRACE_ID                          SPAN_NAME                    PARENT
4bf92f3577b34da6a3ce929d0e0e4736  checkout.publish-job       payment.authorize
4bf92f3577b34da6a3ce929d0e0e4736  payment.worker.process     checkout.publish-job
```

- The trace ID stays the same across the API and worker spans.
- The worker span has the publish span as its parent or linked parent, depending on the messaging instrumentation.
- If the worker has a different trace ID and no shared `order_id`, context was lost at the message boundary.

Messaging is not always one parent followed by one child. A batch consumer can process messages from several producers, and one event can fan out to several consumers. OpenTelemetry **span links** preserve those causal associations without pretending that all work has a single parent. Producer and consumer kinds, messaging attributes, and links let the trace distinguish queue time, processing time, retry behavior, batching, and fan-out.

Context also has a lifecycle inside application code. Async frameworks must keep the active context across promises, callbacks, and tasks. A `traceparent` value present in the message is only half the job: the consumer must extract it before creating spans, make that context active while work runs, and inject it again if it calls another service or republishes work.

## How Does Sampling Control Trace Volume?
<!-- section-summary: Sampling limits trace volume while metrics and structured logs preserve evidence about the whole population. -->

Tracing every request can create cost and volume problems for busy services. **Sampling** decides which traces are recorded. A parent-based sampler commonly lets downstream spans follow the upstream sampling decision. Many teams sample routine successful traffic at a lower rate and keep more error traces because error traces have high incident value.

For a busy checkout API, a small parent-based sampler can keep traces consistent across services:

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

The ratio sampler above uses **head sampling** because it decides near the beginning, before the final outcome is known. It is efficient, but it can discard a request that becomes interesting later. **Tail sampling** waits until more or all spans arrive, then can retain traces based on latency, status, or other evidence. Tail sampling requires a collector or backend to buffer and assemble spans, so it adds memory, delay, and operational complexity.

The sampled flag in `traceparent` helps downstream components make a consistent parent-based choice. It is not proof that every span reached the backend. Export failures, collector loss, broken propagation, and late spans can still create incomplete traces. Verify sampling through delivered trace volume, and keep metrics as the census of scope. Traces are selected request evidence, not a complete request count.

## How Does Tracing Support One Incident?

### How Does the Model Map to AWS?
<!-- section-summary: AWS X-Ray and OpenTelemetry solve similar tracing jobs, while GCP uses Cloud Trace and Cloud Logging correlation fields. -->

If you know AWS, Cloud Trace is closest to AWS X-Ray for following one request across services. OpenTelemetry works in both ecosystems, so a team can use the same basic ideas: spans, context propagation, resource attributes, exporters, collectors, and sampling. CloudWatch ServiceLens-style workflows are useful anchors if you have used traces, metrics, and logs together in AWS.

The GCP detail to notice is the Cloud Logging link. Log entries with `trace`, `spanId`, and `traceSampled` let Cloud Logging and Cloud Trace talk about the same request. For Cloud Run and other GCP services, resource labels also help tie the trace back to project, region, service, and revision.

AWS X-Ray performs a similar managed tracing job, and AWS supports OpenTelemetry through its distribution and collector paths. One lifecycle detail matters for teams carrying older instrumentation forward: AWS placed the X-Ray SDKs and daemon into maintenance mode on February 25, 2026. An OpenTelemetry-based design is therefore the safer portable bridge for new work. The concepts still map—trace, segment or span, propagation, sampling, and service graph—but a current instrumentation path should replace an old copied runbook.

### What Is the Complete Tracing Model?
<!-- section-summary: Cloud Trace and OpenTelemetry connect the request path, while logs, metrics, and audit evidence complete the incident story. -->

The checkout incident now has a full request story. Cloud Monitoring shows sustained `5xx` rate and high p95 latency. Cloud Logging shows structured `database_pool_exhausted` errors from revision `checkout-00042-n9p`. Cloud Trace shows one request spending most of its time in `payment.authorize`. Trace-linked logs show retry count, release, payment provider, and sanitized error code. Audit logs show the deployment that moved traffic to the new revision.

OpenTelemetry provides the application side of that story. It creates spans, carries trace context through HTTP and async boundaries, adds service and release attributes, exports OTLP telemetry to a collector, and lets the team connect traces with logs. Google Cloud stores and displays the evidence through Cloud Trace, Cloud Logging, and Cloud Monitoring.

The investigation starts broad and narrows. Monitoring proves that checkout latency and errors affect more than one request. Logging provides a representative error with release and trace context. Cloud Trace shows where time accumulated, whether work ran sequentially or in parallel, and which span ended in error. Audit evidence establishes the nearby deployment. Comparing healthy and failed traces from the old and new revisions tests whether the apparent bottleneck follows the release. After rollback, the team confirms that metrics recover and representative traces no longer show the long payment span.

## Check Your Answers

:::expand[How Do Traces and Spans Reconstruct One Request?]{kind="recap"}
A trace represents one end-to-end operation, while spans represent timed units of work. Parent relationships, overlap, names, status, and span kinds reconstruct the path and critical timing. One trace is representative evidence; metrics are still needed to establish incident scope.
:::

:::expand[How Does Trace Context Cross Service Boundaries?]{kind="recap"}
Trace context carries the trace ID, parent span ID, and sampling flag. HTTP instrumentation extracts incoming `traceparent`, creates a span, and injects updated context into outbound calls. A missing extraction or injection step splits one request into unrelated traces.
:::

:::expand[How Do Attributes, Events, and Links Describe Spans?]{kind="recap"}
Span attributes describe one operation, while resource attributes describe the telemetry-producing service. Events mark notable moments, status records the result, and links preserve causal relationships that are not strict parent-child connections. Every field should be stable, bounded, and safe.
:::

:::expand[How Do OpenTelemetry and Cloud Trace Divide the Work?]{kind="recap"}
OpenTelemetry APIs, SDKs, instrumentation, propagation, OTLP, and exporters create and move portable telemetry. Cloud Trace is the Google Cloud backend for storing and exploring traces. Current Google Cloud instrumentation and Telemetry API guidance determines the concrete ingestion setup.
:::

:::expand[How Do Exporters and Collectors Move Telemetry?]{kind="recap"}
An exporter sends telemetry out of a process. A collector receives it, processes or batches it, and exports it onward through a receiver-processor-exporter pipeline. Receiver reachability, queueing, credentials, API enablement, permissions, and backend response all need verification.
:::

:::expand[How Do Logs and Async Work Preserve Causality?]{kind="recap"}
Trace and span fields connect structured logs to a timed path. Async producers inject context, consumers extract and activate it, and later calls propagate it again. Producer and consumer kinds plus span links model queues, batching, and fan-out without forcing a false single-parent tree.
:::

:::expand[How Does Sampling Control Trace Volume?]{kind="recap"}
Head sampling decides early and is efficient; tail sampling decides after seeing more of the trace and can retain slow or failed operations at greater operational cost. The sampled flag promotes consistent downstream choices, but only delivered traces prove what reached the backend. Metrics and logs cover unsampled traffic.
:::

:::expand[How Does Tracing Support One Incident?]{kind="recap"}
Use metrics to establish breadth, a structured log to select a representative trace, and spans to locate the slow or failed operation. Compare releases and healthy traces, check nearby audit changes, and use post-mitigation metrics and traces to verify the causal story and recovery.
:::

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
