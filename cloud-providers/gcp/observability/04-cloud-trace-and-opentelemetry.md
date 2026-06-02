---
title: "Cloud Trace and OpenTelemetry"
description: "Follow requests through Cloud Run, GKE, databases, and external calls using distributed tracing."
overview: "When a request spans multiple microservices, isolated logs cannot reveal where the bottleneck is. This article shows how trace contexts propagate across services using CLI tools."
tags: ["gcp", "observability", "trace", "opentelemetry", "distributed-tracing"]
order: 4
id: article-cloud-providers-gcp-observability-cloud-trace-and-opentelemetry
---

## Table of Contents

- [The Distributed Tracing Concept](#the-distributed-tracing-concept)
- [The Traceparent Header](#the-traceparent-header)
- [Context Extraction and Injection](#context-extraction-and-injection)
- [Querying Trace Context in Cloud Logging](#querying-trace-context-in-cloud-logging)
- [Putting It All Together](#putting-it-all-together)

## The Distributed Tracing Concept

Distributed tracing is a mechanism that attaches a unique ID to a web request when it enters a system, passing that ID along to every database, API, and background worker the request touches. When an application runs entirely inside a single container, standard application logs naturally appear in order. When an application splits into multiple independent services, a single user checkout might trigger a web frontend, an inventory service, a payment processor, and a database, all running on different machines. If one of those steps is slow or fails, reading the isolated logs from each machine makes it nearly impossible to reconstruct the timeline.

This article follows a simulated web request into a Google Cloud service. By manually setting a trace header with a simple command-line HTTP client, you will see how OpenTelemetry-aware instrumentation reads the request context, passes the identifier through the network, and how application logs can be linked to traces when they include the expected trace fields.

## The Traceparent Header

At its core, trace propagation means carrying the same request identifier through multiple services. In a web architecture, that identifier is passed as an HTTP header so each service can connect its local work to the same end-to-end request.

When a request hits a service, the system looks for an incoming trace identifier. If one does not exist, the service generates one. You can see this behavior directly by sending a request with a forced tracking ID using `curl`. OpenTelemetry uses a standardized W3C HTTP header named `traceparent`.

```bash
curl -H "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" http://my-service.example.com/api/checkout
```

This command passes a specific, predictable trace ID into the service. The `traceparent` header is not a random string. It follows a strict layout with four distinct parts separated by hyphens:

- **Version (`00`)**: The specification version. Currently, `00` is the only valid version.
- **Trace ID (`4bf92f3577b34da6a3ce929d0e0e4736`)**: A 32-character hex string representing the entire end-to-end transaction. This remains exactly the same across every microservice.
- **Parent Span ID (`00f067aa0ba902b7`)**: A 16-character hex string representing the operation that made this call. A span is a single logical block of work. When the frontend calls the inventory service, the frontend passes the current span ID so the inventory service can create a child span under the same trace.
- **Trace Flags (`01`)**: An 8-bit flag field. A value of `01` means the sampled flag is set. It communicates a sampling decision to downstream services, but storage still depends on the service instrumentation, exporter, and backend.

By providing this header manually, you force the application to adopt `4bf92f3577b34da6a3ce929d0e0e4736` as the overall trace ID for the entire lifecycle of the request.

## Context Extraction and Injection

When the HTTP request arrives at the backend server, OpenTelemetry instrumentation usually runs in framework middleware, an HTTP server wrapper, or a library hook. It reads the incoming headers as part of normal request handling.

The extraction phase reads the incoming HTTP headers. The library parses the `traceparent` header, extracts the 32-character trace ID and the 16-character parent span ID, and stores them in the active OpenTelemetry context. Depending on the language runtime, that context may use thread-local storage, asynchronous context propagation, or another runtime-specific mechanism. Application code does not need to manually pass these IDs through every function, but logs and database spans only become correlated when the relevant logging library, database client, or instrumentation is configured to use that context.

When the service needs to make its own outbound HTTP call, perhaps to verify inventory in another microservice, the injection phase takes over. The OpenTelemetry HTTP client reads the active trace context, generates a brand new 16-character span ID to represent this specific outbound hop, and writes a new `traceparent` header onto the outgoing request. The 32-character trace ID remains identical, showing that this new network hop belongs to the same parent transaction.

## Querying Trace Context in Cloud Logging

Google Cloud can link logs and traces when log entries contain the trace fields Cloud Logging understands, or when supported client libraries and runtime integrations add those fields for you. A plain text line written to standard output does not by itself let the logging agent read application memory. The application, logging library, or instrumentation must include fields such as `trace`, `spanId`, and `traceSampled` in the log entry.

Because you forced the trace ID in the initial `curl` command, you can ask the Cloud Logging API to return every log line that shares that exact trace ID, regardless of which container, service, or machine generated it. You can query this directly using the `gcloud` command-line tool.

```bash
gcloud logging read 'trace="projects/MY_PROJECT/traces/4bf92f3577b34da6a3ce929d0e0e4736"' --format=json
```

This command asks Google Cloud to filter the entire project's log history for the exact trace ID provided in the `curl` request. The `--format=json` flag reveals the underlying structure of the log record as it is stored in the database.

```json
[
  {
    "insertId": "64a4b1c2-0000-24bc-b1c2-089e0832a890",
    "jsonPayload": {
      "message": "Processing checkout for user 12345",
      "status": "success"
    },
    "resource": {
      "type": "cloud_run_revision",
      "labels": {
        "service_name": "checkout-service"
      }
    },
    "timestamp": "2023-10-14T10:30:00.123456Z",
    "trace": "projects/MY_PROJECT/traces/4bf92f3577b34da6a3ce929d0e0e4736",
      "spanId": "a1b2c3d4e5f60718",
    "traceSampled": true
  }
]
```

The raw JSON output reveals exactly how Google Cloud links text logs to distributed traces. Notice the `trace` and `spanId` fields at the root of the JSON object. The `trace` field does not just contain the raw hex string; Google Cloud automatically prefixes it with the project identifier to create a globally unique resource path.

The `spanId` field (`a1b2c3d4e5f60718`) does not match the parent span ID passed in the `curl` command (`00f067aa0ba902b7`). This is expected. The service created a new span ID to represent its own work while maintaining the overall trace ID. Because Cloud Logging indexes the `trace` field, you can filter logs that belong to the same trace. If the services also export spans to Cloud Trace, Cloud Trace can show the request timeline and service-to-service timing.

## Putting It All Together

Trace propagation is not a proprietary Google Cloud protocol. It relies on standard HTTP headers passing through standard network sockets.

- **The Header**: A client or ingress proxy injects a `traceparent` header containing a trace ID and a span ID.
- **The Context**: OpenTelemetry instrumentation extracts those IDs from the header and stores them in the active runtime context.
- **The Telemetry**: Application logging or supported libraries add trace fields to log entries when they are configured to do so.
- **The Platform**: Google Cloud indexes the attached trace ID, allowing tools like `gcloud logging read` to find logs related to the same request.

By following standard W3C propagation rules, OpenTelemetry gives each service a shared trace context to pass forward. The thread stays connected only when every important hop preserves the header and exports the relevant telemetry.

![Cloud Trace and OpenTelemetry summary showing traceparent, Trace ID, Span ID, Context, Structured log, and Cloud Trace.](/content-assets/articles/article-cloud-providers-gcp-observability-cloud-trace-and-opentelemetry/cloud-trace-otel-summary.png)

*Trace linking works only when services propagate context and record the same trace identifiers in spans and structured logs.*

---

**References**

- [OpenTelemetry Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/) - Official documentation on how context moves across network boundaries.
- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/) - The formal standard defining the traceparent header format.
- [Google Cloud Logging Trace Integration](https://cloud.google.com/logging/docs/structured-logging#special-payload-fields) - How GCP maps standard log fields to trace identifiers.
- [Google Cloud Trace Log Integration](https://cloud.google.com/trace/docs/trace-log-integration) - Explains how logs and traces are linked in Google Cloud.
- [Google Cloud Trace Context Propagation](https://cloud.google.com/trace/docs/trace-context) - Explains propagation formats and trace headers for Google Cloud.
