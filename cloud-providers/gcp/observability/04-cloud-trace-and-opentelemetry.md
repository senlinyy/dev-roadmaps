---
title: "Cloud Trace and OpenTelemetry"
description: "Follow requests through Cloud Run, GKE, Cloud SQL, Pub/Sub, and external calls using Cloud Trace, trace context, and OpenTelemetry."
overview: "Cloud Trace shows how one request moved through services, while OpenTelemetry gives applications a standard way to create spans, propagate context, correlate logs, and control sampling. This article follows one checkout request across the GCP observability path."
tags: ["gcp", "observability", "trace", "opentelemetry", "distributed-tracing"]
order: 4
id: article-cloud-providers-gcp-observability-cloud-trace-and-opentelemetry
---

## Table of Contents

1. [The Request Path Problem](#the-request-path-problem)
2. [What Cloud Trace Shows](#what-cloud-trace-shows)
3. [Trace Context And The Traceparent Header](#trace-context-and-the-traceparent-header)
4. [Spans And Attributes](#spans-and-attributes)
5. [OpenTelemetry As The Instrumentation Path](#opentelemetry-as-the-instrumentation-path)
6. [Sending Telemetry To Google Cloud](#sending-telemetry-to-google-cloud)
7. [Trace-To-Log Correlation](#trace-to-log-correlation)
8. [Async Work, Pub/Sub, And Background Jobs](#async-work-pubsub-and-background-jobs)
9. [Sampling, Cost, And Signal Quality](#sampling-cost-and-signal-quality)
10. [Putting It All Together](#putting-it-all-together)

## The Request Path Problem
<!-- section-summary: Logs explain local events, while tracing follows one request across every service and dependency that helped serve it. -->

The checkout incident has reached the point where logs and metrics agree. Cloud Monitoring shows a sustained `5xx` spike. Cloud Logging shows `provider_timeout` errors from revision `checkout-api-00042-n9p`. The next question is about the path of one failed request.

A customer experiences one checkout. The system sees many pieces of work. The request enters Cloud Run, checks inventory through another service, calls a payment provider, writes an order to Cloud SQL, publishes a receipt message to Pub/Sub, and may wake a background worker. The services produce many records, while the customer experiences one slow or failed transaction.

**Distributed tracing** gives that transaction a shared identity and records timed work along the way. Instead of opening several log queries and trying to line up timestamps, the team can see the request timeline, the parent-child relationship between operations, the dependency that took the most time, and the logs connected to the same trace.

In Google Cloud, **Cloud Trace** stores and displays trace data. **OpenTelemetry** gives applications a standard way to create spans, propagate context, export telemetry, and use consistent service attributes across languages and platforms.

## What Cloud Trace Shows
<!-- section-summary: Cloud Trace stores spans for individual requests and helps teams inspect latency, errors, and service-to-service timing. -->

**Cloud Trace** is Google Cloud's distributed tracing service. It lets teams inspect latency data for individual requests and view aggregate latency for applications. A trace represents one end-to-end operation, and the trace is made of spans. Each span records one timed unit of work.

For a failed checkout request, a trace might look like this:

![Infographic showing one checkout request moving from browser to checkout-api, inventory-api, payment provider, database, queue, and worker, with the payment span highlighted as the timeout that caused HTTP 500.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-trace-and-opentelemetry/checkout-trace-path.png)
*The trace turns one customer action into a timed path. In this incident, the slow error span points the team toward payment authorization before they dig into code.*

Cloud Trace can show the timing for each span. The `POST /checkout` span might last 3.2 seconds. The inventory span might finish in 80 milliseconds. The payment provider span might last 2.8 seconds and end with an error status. That timing view is exactly what logs alone struggle to show.

Trace views also help teams compare requests. If many failed traces share the same slow provider span and the same release attribute, the team can focus on the payment integration. If the slow span moves between dependencies, the incident might involve load, network, retries, or a shared configuration problem.

## Trace Context And The Traceparent Header
<!-- section-summary: Trace context carries the trace ID, parent span ID, and sampling decision from one operation to the next. -->

**Trace context** is the small identity package that travels with a request. It carries the trace ID for the whole request, the span ID for the current operation, and usually a sampling decision. Each service reads the incoming context, records its own span, and passes updated context to the next service.

OpenTelemetry commonly uses the W3C `traceparent` header for HTTP propagation:

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

The header has four parts. `00` is the version. `4bf92f3577b34da6a3ce929d0e0e4736` is the trace ID for the end-to-end checkout request. `00f067aa0ba902b7` is the parent span ID for the operation that made this call. `01` sets the sampled flag, which tells downstream instrumentation that the parent wants this request recorded.

Google Cloud services can also participate in context propagation, and support varies by service and configuration. Cloud Run, Cloud Load Balancing, Pub/Sub, Cloud Tasks, App Engine, and other services can sit in request paths where context matters. The important production habit is to test the path your system actually uses, because one missing propagation step can split the trace.

Here is the practical flow in `checkout-api`. The service receives a request with incoming context, or it starts a new trace if no context exists. The HTTP server instrumentation creates a server span for `POST /checkout`. The HTTP client instrumentation injects context into the inventory and payment calls. The database instrumentation records the Cloud SQL query. The Pub/Sub instrumentation or application code carries enough context into the message so a worker can continue the story.

![Infographic explaining the traceparent header parts and showing trace context moving from checkout-api to inventory-api and payment-api.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-trace-and-opentelemetry/trace-context-propagation.png)
*Trace context keeps the same trace ID across services while each operation creates its own span. A missing propagation step splits one checkout into separate traces.*

## Spans And Attributes
<!-- section-summary: Spans are timed units of work, and attributes add searchable context when teams choose stable fields. -->

A **span** is one timed unit of work inside a trace. It has a name, start time, end time, parent relationship, status, events, and attributes. In the checkout trace, useful span names might be `POST /checkout`, `inventory.reserve`, `payment.authorize`, `cloudsql.orders.insert`, and `pubsub.receipts.publish`.

Span names should describe stable operations. A name like `POST /checkout/chk_9f21` creates a unique operation name for every checkout, which makes trace views noisy. A stable name like `POST /checkout` keeps aggregation useful, while the checkout ID can live in logs or a carefully reviewed trace attribute.

**Attributes** are key-value pairs attached to spans. OpenTelemetry defines standard resource attributes such as `service.name`, `service.version`, and `deployment.environment`. Application teams can add their own attributes for useful investigation fields, such as `payment.provider`, `checkout.route`, or `tenant.tier`.

Attributes need the same safety rules as logs. Low-cardinality fields make traces easier to search and group. High-cardinality fields such as raw user IDs, request IDs, full URLs with IDs, or checkout IDs can create noise and data exposure. Sensitive values such as tokens, card data, full addresses, and private payloads should stay out of trace attributes.

| Trace field | Good example | Why it helps |
|---|---|---|
| `service.name` | `checkout-api` | Connects spans to the owning service |
| `service.version` | `2026-06-14.3` | Connects traces to the release |
| `deployment.environment` | `prod` | Separates production from lower environments |
| `http.route` | `/checkout` | Groups route latency without unique IDs |
| `payment.provider` | `stripe` | Helps compare dependency behavior |
| `error.type` | `PaymentGatewayTimeout` | Helps group failing spans |

This table is small on purpose. A few stable attributes can make traces extremely useful. Too many attributes can turn every trace into a noisy dump of application internals.

## OpenTelemetry As The Instrumentation Path
<!-- section-summary: OpenTelemetry gives applications standard APIs, SDKs, auto-instrumentation, resource attributes, and exporters for traces. -->

**Instrumentation** means the code, library, agent, or runtime setup that creates telemetry. For tracing, instrumentation creates spans around incoming requests, outbound HTTP calls, database calls, cloud client calls, queue operations, and custom business steps. Cloud Trace can only display detailed spans after something creates and exports them.

Google Cloud documentation recommends open-source, vendor-neutral instrumentation such as OpenTelemetry for application tracing. OpenTelemetry gives teams standard APIs, SDKs, auto-instrumentation, resource attributes, context propagation, and OTLP exporters. The same instrumented service can send telemetry to Google Cloud and can often support another compatible backend later.

For a Node.js `checkout-api`, the first application setup might look like this:

```bash
npm install \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http
```

This command adds the OpenTelemetry SDK, common Node auto-instrumentations, and an OTLP HTTP trace exporter. The SDK starts the telemetry pipeline, auto-instrumentations create spans for supported framework and client calls, and the exporter sends spans to the collector endpoint.

```console
added 84 packages, and audited 512 packages in 7s
found 0 vulnerabilities
```

Healthy install output completes without dependency conflicts. Suspicious output includes peer dependency warnings around the framework or exporter versions, because instrumentation that fails to load can leave Cloud Trace with only partial spans.

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

```bash
OTEL_SERVICE_NAME=checkout-api \
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=prod,service.version=2026-06-14.3 \
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces \
node --require ./instrumentation.js server.js
```

The environment variables are part of the telemetry contract. `OTEL_SERVICE_NAME` gives Cloud Trace and logs a stable service name. `OTEL_RESOURCE_ATTRIBUTES` attaches production and release context to the spans. `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` points at the local collector endpoint, and `node --require ./instrumentation.js` loads instrumentation before the application starts handling requests.

```console
OpenTelemetry SDK started for service checkout-api
Listening on port 8080
OTLP trace exporter endpoint http://127.0.0.1:4318/v1/traces
```

Healthy startup output confirms that the SDK starts before the server accepts traffic. Suspicious startup output includes connection refused errors to the collector, a missing `service.name`, or instrumentation loaded after the HTTP server has already initialized.

This code starts the pipeline, and the team still designs the important span names and attributes. Auto-instrumentation can create spans for common framework and library calls, while the team adds custom spans around domain-specific business steps such as `payment.authorize` or `fraud.score`.

## Sending Telemetry To Google Cloud
<!-- section-summary: Applications usually export OTLP telemetry to a collector, and the collector sends traces, metrics, and logs to Google Cloud. -->

OpenTelemetry applications commonly export telemetry using **OTLP**, the OpenTelemetry Protocol. In production, the application often sends OTLP data to a collector. The collector batches data, adds resource detection, handles retries, and exports telemetry to Google Cloud.

Google Cloud provides guidance for running the Google-Built OpenTelemetry Collector on platforms such as Cloud Run, GKE, Compute Engine, and Container-Optimized OS. A simplified collector configuration for traces has this shape:

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

The receiver accepts OTLP traffic from the application. The batch processor groups spans before export, which reduces overhead. The `googlecloud` exporter sends traces to Google Cloud using the workload identity or service account available to the collector runtime.

A healthy collector startup log should show the pipeline components starting and the collector listening for OTLP traffic:

```console
info    service@v0.102.0/service.go:110    Starting otelcol
info    otlpreceiver@v0.102.0/otlp.go:152  Starting GRPC server endpoint=0.0.0.0:4317
info    otlpreceiver@v0.102.0/otlp.go:100  Starting HTTP server endpoint=0.0.0.0:4318
info    service@v0.102.0/service.go:137    Everything is ready. Begin running and processing data.
```

Suspicious collector output includes authentication failures, permission denied errors from the exporter, repeated retry messages, or no OTLP receiver listening on the port the application uses.

The application sends spans to the collector. The collector sends those spans to Google Cloud, where Cloud Trace can store and display them. The same general pattern can also support metrics and logs when the collector and application are configured for those signals.

Authentication depends on where the code runs. Workloads running on Google Cloud usually use the runtime service account and Application Default Credentials. Workloads outside Google Cloud need an explicit credential path or workload identity setup. In production, the service account should have only the roles needed to write telemetry, and collector configuration should avoid embedding secrets directly.

The verification step matters. After deployment, the team should send a known request, find the trace in Cloud Trace, confirm that the service name and version are correct, confirm that downstream spans appear, and confirm that trace-linked logs can be found in Cloud Logging. Missing smoke tests often leave tracing failures hidden until an incident needs the data.

![Infographic showing checkout-api sending OTLP telemetry to a collector, which batches and exports spans to trace viewer, log search, and metric charts.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-trace-and-opentelemetry/otel-collector-pipeline.png)
*The collector gives the team one standard telemetry path. The verification checklist should confirm service name, release version, downstream spans, and trace-linked logs.*

## Trace-To-Log Correlation
<!-- section-summary: Trace-to-log correlation lets a slow span open the exact logs written during the same request. -->

Tracing and logging solve different parts of the incident. A trace shows that `payment.authorize` took 2.8 seconds and returned an error. Logs show the provider error code, retry attempt, sanitized response category, release, and checkout ID. **Trace-to-log correlation** joins those views with shared trace and span fields.

Cloud Logging can link log entries with traces when log entries include `trace`, `spanId`, and `traceSampled` fields in the `LogEntry` structure. When writing structured JSON to stdout or stderr, applications can use special fields such as `logging.googleapis.com/trace`, `logging.googleapis.com/spanId`, and `logging.googleapis.com/trace_sampled`.

Here is the log shape from the active payment span:

```json
{
  "severity": "ERROR",
  "message": "payment authorization timed out after provider retry",
  "route": "POST /checkout",
  "dependency": "payment-provider",
  "error_code": "provider_timeout",
  "retry_count": 2,
  "release": "2026-06-14.3",
  "logging.googleapis.com/trace": "projects/shop-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "logging.googleapis.com/spanId": "00f067aa0ba902b7",
  "logging.googleapis.com/trace_sampled": true
}
```

A responder can query Cloud Logging by the trace field:

```bash
gcloud logging read \
  'trace="projects/shop-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736"' \
  --project=shop-prod \
  --format='table(timestamp,resource.labels.service_name,severity,jsonPayload.message,jsonPayload.error_code)'
```

This query starts from a trace ID found in Cloud Trace and asks Cloud Logging for the logs written during the same request. The table format keeps the request journal readable during incident chat.

```console
TIMESTAMP                    SERVICE_NAME    SEVERITY  MESSAGE                                      ERROR_CODE
2026-06-14T14:04:11.902Z     checkout-api    INFO      checkout request received
2026-06-14T14:04:12.004Z     inventory-api   INFO      inventory reservation completed
2026-06-14T14:04:12.221Z     checkout-api    ERROR     payment authorization timed out after retry   provider_timeout
2026-06-14T14:04:12.236Z     checkout-api    ERROR     returning checkout failure response           provider_timeout
```

Healthy output shows a connected request story with the expected services and no unexpected context break. Suspicious output shows only `checkout-api` logs when downstream services should appear, or it shows the payment error without the earlier inventory span, which means propagation or logging hooks may be incomplete.

That query turns a trace ID into a readable request journal. The trace gives timing and topology. The logs give application detail. Together they let the team explain one failed checkout without guessing which log lines belong to the same customer action.

## Async Work, Pub/Sub, And Background Jobs
<!-- section-summary: Async boundaries need explicit context handoff because the request leaves HTTP and continues later in another runtime. -->

HTTP propagation is the simplest case because headers travel with the request. Async systems need more care because work leaves the original request, waits in Pub/Sub or Cloud Tasks, and continues in another process later. The trace still needs a way to carry context from producer to consumer.

For the checkout flow, `checkout-api` publishes a receipt event after the payment step. If the request fails before the event, the trace ends in the API. If the request succeeds and publishes a message, the receipt worker should be able to continue the trace or at least log the same durable business ID.

A practical Pub/Sub message can carry both forms of context. Trace context helps Cloud Trace connect producer and consumer spans. A business ID such as `checkout_id` helps humans search logs even when a downstream system or library drops trace context.

```json
{
  "message": {
    "data": "eyJjaGVja291dF9pZCI6ImNoa185ZjIxIn0=",
    "attributes": {
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      "checkout_id": "chk_9f21",
      "service_version": "2026-06-14.3"
    }
  }
}
```

The `traceparent` attribute carries trace context across the message boundary. `checkout_id` gives humans a durable search handle even if a downstream worker starts a separate trace. `service_version` helps the team connect the async work to the same release that changed the API.

A consumer log that proves the handoff worked might look like this:

```json
{
  "severity": "INFO",
  "message": "receipt worker started checkout receipt job",
  "checkout_id": "chk_9f21",
  "service_version": "2026-06-14.3",
  "logging.googleapis.com/trace": "projects/shop-prod/traces/4bf92f3577b34da6a3ce929d0e0e4736",
  "logging.googleapis.com/spanId": "9c82b41acb7e2a33"
}
```

Healthy async output keeps the same trace ID or at least the same durable business ID across producer and consumer logs. Suspicious output has a worker log with no trace field and no `checkout_id`, because the responder cannot confidently connect the background work to the customer request.

The consumer reads the `traceparent` attribute, starts a consumer span, and records its own work. If it sends an email, writes a receipt record, or calls another service, it injects context again. The trace then shows the handoff from API to message to worker instead of treating the worker as a separate mystery.

Async propagation deserves a smoke test. The team should send one test checkout, find the producer span, find the consumer span, and confirm that logs on both sides share trace context or at least the same business ID. This test catches the most common tracing break before production stress makes it painful.

## Sampling, Cost, And Signal Quality
<!-- section-summary: Sampling controls how many traces are recorded, and teams should sample with incident value and cost in mind. -->

Tracing every request can create cost and volume problems for busy services. **Sampling** decides which traces are recorded. A sampling decision can start at the first service and travel with the trace context so downstream services make compatible decisions.

The W3C `traceparent` header has a sampled flag, and Google Cloud documentation explains that parent sampling can act as a hint for child components. Instrumentation still has to respect that decision. OpenTelemetry commonly uses a parent-based sampler so children follow the parent when appropriate.

Sampling should match business risk. A high-volume health endpoint might need a low sample rate. A checkout route, payment route, or error path might deserve higher coverage. Many teams also keep all traces with errors while sampling successful routine traffic at a lower rate. The exact setup depends on language SDKs, collectors, service traffic, and cost limits.

Good sampling also needs good attributes and logs. A sampled trace with weak span names, missing service names, and no trace-linked logs gives little incident value. When sampling skips a trace, structured logs and metrics still need to provide enough evidence for the incident. Tracing is one signal alongside the others.

## Putting It All Together
<!-- section-summary: Cloud Trace and OpenTelemetry connect the request path, while logs, metrics, and audit evidence complete the incident story. -->

The final checkout story now has the full observability loop. Cloud Monitoring pages because `checkout-api` has a sustained `5xx` ratio. Cloud Logging shows structured `provider_timeout` errors from revision `checkout-api-00042-n9p`. Cloud Trace shows one request spending most of its time in `payment.authorize`. Trace-linked logs show retry count, provider, release, and sanitized error code. Cloud Audit Logs show the deployment that moved traffic to the new revision.

OpenTelemetry provides the application side of that story. It creates spans, carries trace context through HTTP and async boundaries, adds service and release attributes, exports OTLP telemetry to a collector, and lets the team connect traces with logs. Google Cloud stores and displays the evidence through Cloud Trace, Cloud Logging, and Cloud Monitoring.

This is the production habit the module has been building toward. Metrics show the symptom. Logs explain events. Traces show the request path. Audit logs show changes. Labels and resource context connect the evidence. The team fixes the cause, watches the same metrics return to normal, and leaves incident notes that another engineer can follow later.

---

**References**

- [Cloud Trace documentation](https://cloud.google.com/trace/docs) - Documents distributed tracing, traces, spans, latency analysis, and Trace views.
- [Instrument for Cloud Trace](https://cloud.google.com/trace/docs/setup) - Explains Google Cloud's instrumentation guidance and recommends OpenTelemetry for application tracing.
- [Trace context](https://cloud.google.com/trace/docs/trace-context) - Explains trace IDs, span IDs, parent span IDs, sampling context, and propagation.
- [Link log entries with traces](https://cloud.google.com/trace/docs/trace-log-integration) - Documents the `trace`, `spanId`, and `traceSampled` fields used to correlate logs and traces.
- [Deploy Google-Built OpenTelemetry Collector on Cloud Run](https://cloud.google.com/stackdriver/docs/instrumentation/opentelemetry-collector-cloud-run) - Shows the collector path for OTLP telemetry on Cloud Run.
- [OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/) - Explains traces, spans, span context, and trace structure.
- [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/) - Explains how context moves across service boundaries.
- [W3C Trace Context](https://www.w3.org/TR/trace-context/) - Defines the `traceparent` header format used for standard trace propagation.
