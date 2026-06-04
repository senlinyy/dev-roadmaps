---
title: "Telemetry Pipelines"
description: "Connect logs, metrics, traces, and events into a production telemetry pipeline without repeating basic signal concepts."
overview: "Logs and metrics become much more useful when they travel through a clear pipeline. This article explains how the OpenTelemetry Collector receives, shapes, and exports telemetry in Kubernetes."
tags: ["kubernetes", "operations", "telemetry", "opentelemetry", "prometheus"]
order: 4
id: article-containers-orchestration-kubernetes-operations-telemetry-pipelines
---

A telemetry pipeline is the path operational evidence follows after an application creates it. Logs, metrics, traces, and events may start inside different containers, but they need a controlled route to storage and analysis tools. Instead of hardcoding vendor authentication tokens into every microservice, teams often send telemetry to an OpenTelemetry Collector. The collector receives selected signals, batches them, filters unsafe attributes, and exports them to observability backends.

## Table of Contents

- [The Collector Configuration](#the-collector-configuration)
- [Applying the Collector](#applying-the-collector)
- [Emitting Traces](#emitting-traces)
- [Trimming Unsafe Attributes](#trimming-unsafe-attributes)
- [Verifying the Pipeline](#verifying-the-pipeline)
- [Putting It All Together](#putting-it-all-together)
- [What's Next](#whats-next)

## The Collector Configuration

At its core, a telemetry pipeline is a small processing path with an entrance, optional shaping steps, and an exit. The application sends trace spans or metrics to a receiver. The collector changes or batches the data in processors. Then an exporter sends the final payload to a backend such as a tracing system, metrics database, or vendor service.

![Kubernetes telemetry collector configuration map showing receiver, processor, exporter, backend, and internal metrics](/content-assets/articles/article-containers-orchestration-kubernetes-operations-telemetry-pipelines/collector-config-map.png)

*A telemetry collector is a pipeline: receivers accept signals, processors shape them, and exporters send them onward.*


The OpenTelemetry Collector reads a configuration file that defines this pipeline using three distinct stages: receivers, processors, and exporters. Receivers open network sockets to listen for incoming data, processors shape and filter that data in memory, and exporters open outbound connections to send the final payload to another system.

When deploying to Kubernetes, this configuration is stored in a ConfigMap.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-conf
  labels:
    app: opentelemetry-collector
data:
  otel-collector-config: |
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318
    processors:
      batch:
        send_batch_size: 1000
        timeout: 10s
    exporters:
      debug:
        verbosity: detailed
    service:
      pipelines:
        traces:
          receivers: [otlp]
          processors: [batch]
          exporters: [debug]
```

The `receivers` block tells the collector to bind to the standard OpenTelemetry Protocol (OTLP) ports. The endpoint `0.0.0.0` means the collector listens on all network interfaces inside its Pod. That is convenient for Pod-to-Pod traffic, but production deployments should protect it with Service design, NetworkPolicy, TLS, or a gateway pattern. The `processors` block buffers the incoming data into batches to reduce the number of outbound requests made to the backend. The `exporters` block defines the destination; in this case, the `debug` exporter writes a readable troubleshooting view to standard output. Finally, the `service.pipelines` block wires these separate components together to form a continuous data flow for trace data.

## Applying the Collector

With the configuration defined, you can deploy the collector binary as a DaemonSet. A DaemonSet runs a copy of the collector on each eligible Kubernetes Node. That makes a node-local collector possible, but it does not automatically guarantee local traffic. If applications send telemetry to an ordinary Service, Kubernetes may route them to a collector Pod on another Node. To keep ingestion local, the endpoint design must use a node-local pattern such as host networking, a per-node address, a headless discovery pattern, or a Service configured with local internal traffic policy.

Apply the configuration and the DaemonSet manifests to the cluster.

```bash
kubectl apply -f otel-config.yaml
kubectl apply -f otel-daemonset.yaml
```

```text
configmap/otel-collector-conf created
daemonset.apps/otel-collector created
```

Once the pods schedule, you can inspect the collector's startup sequence. The OpenTelemetry Collector starts the configured components and reports whether exporters, receivers, and pipelines are ready.

```bash
kubectl logs -l app=opentelemetry-collector
```

```text
2024-03-12T10:01:23.456Z	info	builder/exporters_builder.go:254	Exporter is starting...	{"kind": "exporter", "data_type": "traces", "name": "debug"}
2024-03-12T10:01:23.457Z	info	builder/exporters_builder.go:261	Exporter started.	{"kind": "exporter", "data_type": "traces", "name": "debug"}
2024-03-12T10:01:23.458Z	info	builder/receivers_builder.go:226	Receiver is starting...	{"kind": "receiver", "name": "otlp", "data_type": "traces"}
2024-03-12T10:01:23.459Z	info	builder/receivers_builder.go:231	Receiver started.	{"kind": "receiver", "name": "otlp", "data_type": "traces"}
2024-03-12T10:01:23.460Z	info	setup/setup.go:252	Everything is ready. Begin running and processing data.
```

The logs reveal the collector's component startup. In this example, the `debug` exporter starts before the `otlp` receiver, so the troubleshooting output path exists before the collector accepts incoming trace data. The receiver then opens the `4317` and `4318` sockets on the Pod's network interface.

## Emitting Traces

To prove the pipeline works, you deploy a sample checkout service that is instrumented with an OpenTelemetry library. The application is configured to push its trace data to the local node's collector address.

After generating some traffic against the checkout service, check the collector logs again. Because the `debug` exporter is wired into the traces pipeline, the collector writes a readable view of the received telemetry to standard output.

```bash
kubectl logs -l app=opentelemetry-collector --tail 25
```

```text
2024-03-12T10:05:12.123Z	info	TracesExporter	{"kind": "exporter", "data_type": "traces", "name": "debug", "resource spans": 1, "spans": 2}
ResourceSpans #0
Resource SchemaURL: https://opentelemetry.io/schemas/1.6.1
Resource attributes:
     -> service.name: Str(checkout-service)
     -> k8s.pod.name: Str(checkout-service-7b9cd5-x2b4)
ScopeSpans #0
ScopeSpans SchemaURL:
InstrumentationScope opentelemetry.instrumentation.http 1.0.0
Span #0
    Trace ID       : 5b8aa5a2d2c872e8321cf37308d69df2
    Parent ID      :
    ID             : 1c3a7f85e4b2a9d1
    Name           : /checkout
    Kind           : Server
    Start time     : 2024-03-12 10:05:11.900 +0000 UTC
    End time       : 2024-03-12 10:05:12.100 +0000 UTC
    Status code    : Unset
    Status message :
Attributes:
     -> http.method: Str(POST)
     -> http.status_code: Int(200)
     -> user.id: Str(u-987654321)
```

The payload is strictly typed and separated into logical layers. The `Resource attributes` block identifies the physical infrastructure, confirming that the trace came from a specific pod named `checkout-service-7b9cd5-x2b4`. The `Span #0` block captures the application's runtime behavior, recording the exact start and end timestamps of the HTTP POST request. Finally, the `Attributes` block holds the custom business context, including the specific `user.id` that initiated the transaction.

## Trimming Unsafe Attributes

Telemetry often carries attributes that are useful for one investigation but dangerous to store everywhere. A label such as `http.status_code` has a small set of values, so it is safe for many metrics. A value such as `user.id` or `session.token` can create millions of unique values and may also expose private information.

![Kubernetes telemetry attribute trimming path showing raw span, processor, safe span, exporter, and backend](/content-assets/articles/article-containers-orchestration-kubernetes-operations-telemetry-pipelines/attribute-trim-path.png)

*Attribute processors keep unsafe or high-cardinality fields from reaching the backend.*


For metrics, high-cardinality labels are especially expensive because Prometheus-style systems treat the metric name plus label set as a separate time series. If an application emits a metric tagged with a unique `user.id`, the metrics backend may need to store millions of distinct series. For traces, a `user.id` span attribute does not create Prometheus time series in this example, but it can still increase indexing cost, retention risk, and privacy exposure in the tracing backend.

To prevent an application team from accidentally sending unsafe values downstream, you insert an attributes processor into the collector configuration and then wire that processor into the trace pipeline.

```yaml
    processors:
      batch:
        send_batch_size: 1000
        timeout: 10s
      attributes/trim:
        actions:
          - key: user.id
            action: delete
    service:
      pipelines:
        traces:
          receivers: [otlp]
          processors: [attributes/trim, batch]
          exporters: [debug]
```

When you update the ConfigMap and restart the DaemonSet, the pipeline changes. Defining the processor is not enough. The `service.pipelines.traces.processors` list controls which processors actually run and in what order. In this configuration, `attributes/trim` runs before `batch`, drops the `user.id` key from spans, and passes the safer version forward. The pipeline enforces a basic data-governance rule at the edge without requiring the application team to rewrite code immediately.

## Verifying the Pipeline

While logs are useful for debugging, they do not provide a real-time view of data throughput. To prove the collector is actively handling traffic across the cluster, you can query its internal metrics endpoint.

The OpenTelemetry Collector can expose Prometheus-formatted internal metrics. In this example, the collector's internal telemetry endpoint is available on port `8888`. You can use the `kubectl exec` command to enter one collector Pod and run `curl` directly against this internal loopback interface.

```bash
kubectl exec -it daemonset/otel-collector -- curl -s http://localhost:8888/metrics | grep otelcol_receiver_accepted_spans
```

```text
# HELP otelcol_receiver_accepted_spans Number of spans successfully pushed into the pipeline.
# TYPE otelcol_receiver_accepted_spans counter
otelcol_receiver_accepted_spans{receiver="otlp",transport="grpc"} 1450
otelcol_receiver_accepted_spans{receiver="otlp",transport="http"} 0
```

The output proves that data is flowing. The `otelcol_receiver_accepted_spans` metric is a monotonic counter that tracks every item the pipeline ingests. Here, it shows that the `otlp` receiver has successfully accepted 1,450 spans over the `grpc` transport. If this number stays at zero while the application is under load, the application cannot reach the collector. If the accepted count climbs but the destination database remains empty, a processor or exporter is dropping the data deeper in the pipeline.

## Putting It All Together

We started by mapping out a telemetry pipeline with receivers, processors, and exporters defined in a ConfigMap. We deployed the OpenTelemetry Collector as a DaemonSet, then treated node-local traffic as an endpoint-design choice rather than an automatic guarantee. By reading the container logs, we saw the collector start its components and observed readable trace output from a sample application. Finally, we separated metric label cardinality from trace attribute governance, wired the trimming processor into the active pipeline, and verified pipeline throughput using the collector's internal metrics port.

## What's Next

With the pipeline in place, we can now establish RBAC and operational access.

![Telemetry pipeline summary showing receiver, processor, exporter, DaemonSet deployment, safe attributes, and internal metrics.](/content-assets/articles/article-containers-orchestration-kubernetes-operations-telemetry-pipelines/telemetry-pipeline-summary.png)

*A telemetry pipeline receives signals, shapes them safely, exports them to a backend, and exposes its own metrics so operators can prove data is flowing.*

---

**References**

- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/) - Defines receivers, processors, exporters, and service pipelines.
- [OpenTelemetry Transforming Telemetry](https://opentelemetry.io/docs/collector/transforming-telemetry/) - Explains how processors modify telemetry before export.
- [Kubernetes DaemonSet](https://kubernetes.io/docs/concepts/workloads/controllers/daemonset/) - Describes how DaemonSets schedule Pods on eligible Nodes.
- [Kubernetes Service Internal Traffic Policy](https://kubernetes.io/docs/concepts/services-networking/service-traffic-policy/) - Explains local traffic routing for Services.
- [Prometheus Data Model](https://prometheus.io/docs/concepts/data_model/) - Defines metric series and label sets.
