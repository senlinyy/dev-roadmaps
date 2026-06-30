---
title: "Telemetry Pipelines"
description: "Connect logs, metrics, traces, and events into a production telemetry pipeline without repeating basic signal concepts."
tags: ["Kubernetes", "Operations", "Telemetry", "OpenTelemetry"]
area: "Containers & Orchestration"
order: 4
id: article-containers-orchestration-kubernetes-operations-telemetry-pipelines
---
## Table of Contents

- [Why a Telemetry Pipeline Exists](#why-a-telemetry-pipeline-exists)
- [Receivers, Processors, and Exporters](#receivers-processors-and-exporters)
- [Choose the Collector Shape](#choose-the-collector-shape)
- [Configure the Collector in Layers](#configure-the-collector-in-layers)
- [Deploy the Collector in Kubernetes](#deploy-the-collector-in-kubernetes)
- [The App Sends Signals To The Pipeline](#the-app-sends-signals-to-the-pipeline)
- [Keep Attributes Safe and Affordable](#keep-attributes-safe-and-affordable)
- [Verify One Request End to End](#verify-one-request-end-to-end)
- [Troubleshoot Missing Telemetry](#troubleshoot-missing-telemetry)
- [Operational Checklist](#operational-checklist)
- [References](#references)

## Why a Telemetry Pipeline Exists
<!-- section-summary: A telemetry pipeline receives application signals, processes them safely, and exports them to backends that responders can query during incidents. -->

A Kubernetes **telemetry pipeline** is the path that carries logs, metrics, traces, and events from workloads to the systems where teams search, alert, and debug. The pipeline usually includes application instrumentation, a collector, processors that clean or batch data, and exporters that send data to a backend.

For `devpolaris-orders-api`, the incident question might be: a checkout request failed, so where did it slow down and which dependency returned the error? Raw logs alone can help, but a trace with stable service names and safe attributes can connect the API, payment client, database call, and response status.

The practical goal is: **prove one request can travel from the app, through the collector, into the backend with the fields responders need.**

## Receivers, Processors, and Exporters
<!-- section-summary: The collector receives telemetry, changes or protects it with processors, then exports it to one or more backends. -->

OpenTelemetry Collector configuration has three main pieces. A **receiver** accepts data, a **processor** changes or protects data, and an **exporter** sends data onward.

The pipeline skeleton looks like this before details:

```yaml
receivers:
  otlp:

processors:
  batch:

exporters:
  otlp:

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp]
```

What the skeleton shows:

- The app sends OTLP data to the collector.
- The collector batches data before export.
- The traces pipeline connects receiver, processor, and exporter by name.

![Telemetry pipeline flow showing app signals entering a receiver, passing through processors for sampling and attributes, then leaving through exporters to a backend](/content-assets/articles/article-containers-orchestration-kubernetes-operations-telemetry-pipelines/telemetry-pipeline-flow.png)

*The flow shows the collector as an operational checkpoint between application signals and backend storage.*

## Choose the Collector Shape
<!-- section-summary: Collector placement decides who owns local collection, central routing, backend credentials, and scaling. -->

Kubernetes teams usually choose one of three collector shapes:

| Shape | Where it runs | Good fit |
|---|---|---|
| Sidecar | Beside each app container | App-specific control and isolation |
| DaemonSet agent | One collector per node | Node-local collection and log scraping |
| Gateway Deployment | Shared collector service | Central routing, batching, and backend credentials |

For a first production path, a gateway Deployment is easy to understand: apps send OTLP to one stable Service, and the platform team operates the collector. Larger clusters often combine DaemonSet agents with a gateway.

![Collector deployment shapes comparing sidecar, DaemonSet agent, and gateway collectors with per-pod control, node coverage, and central routing](/content-assets/articles/article-containers-orchestration-kubernetes-operations-telemetry-pipelines/collector-deployment-shapes.png)

*The deployment shape decides where telemetry is gathered, processed, and routed.*

## Configure the Collector in Layers
<!-- section-summary: Build collector config from a working OTLP path, then add batching, memory protection, safe attributes, and exporter settings. -->

Add collector config in layers so failures have a clear place to land. Use OTLP in and OTLP out first, then add safety processors.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
```

What this receiver does:

- Listens for OTLP over gRPC on `4317`.
- Listens for OTLP over HTTP on `4318`.
- Gives instrumented apps a standard endpoint.

Add processors for production behavior:

```yaml
processors:
  memory_limiter:
    check_interval: 5s
    limit_percentage: 80
    spike_limit_percentage: 25
  batch:
    timeout: 5s
    send_batch_size: 8192
```

Processor notes:

- `memory_limiter` protects the collector from unlimited buffering.
- `batch` reduces exporter overhead.
- The values should match collector resources and backend limits.

Add a safe exporter:

```yaml
exporters:
  otlp/tempo:
    endpoint: tempo.observability.svc.cluster.local:4317
    tls:
      insecure: true
```

Exporter notes:

- The endpoint points to the tracing backend Service.
- Production TLS settings should match the backend certificate setup.
- Name exporters clearly when a collector sends signals to multiple backends.

Finally wire the pipeline:

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/tempo]
```

This final block is the actual trace route. A receiver or exporter defined above does nothing until a service pipeline uses it.

## Deploy the Collector in Kubernetes
<!-- section-summary: The Kubernetes deployment gives the collector a ConfigMap, Service, resource budget, and rollout path. -->

In Kubernetes, the collector usually needs a ConfigMap, a Deployment, and a Service. Keep the first manifest small enough to review.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: otel-collector
  namespace: observability
spec:
  selector:
    app.kubernetes.io/name: otel-collector
  ports:
    - name: otlp-grpc
      port: 4317
      targetPort: 4317
    - name: otlp-http
      port: 4318
      targetPort: 4318
```

What this Service gives apps:

- A stable DNS name: `otel-collector.observability.svc.cluster.local`.
- Standard OTLP ports.
- A selector that routes traffic to collector Pods.

Check the rollout:

```bash
$ kubectl -n observability rollout status deploy/otel-collector
deployment "otel-collector" successfully rolled out

$ kubectl -n observability get svc otel-collector
NAME             TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)             AGE
otel-collector   ClusterIP   10.43.91.144   <none>        4317/TCP,4318/TCP   3m
```

The output proves the Deployment is available and the Service exists for app traffic.

## The App Sends Signals To The Pipeline
<!-- section-summary: The application should send telemetry to the collector Service with stable service identity fields. -->

The app should know the collector endpoint and its own service identity. For many OpenTelemetry SDKs, environment variables are enough to configure the first path.

```yaml
env:
  - name: OTEL_SERVICE_NAME
    value: devpolaris-orders-api
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: http://otel-collector.observability.svc.cluster.local:4318
  - name: OTEL_RESOURCE_ATTRIBUTES
    value: deployment.environment=prod,k8s.namespace.name=orders
```

What these values do:

- `OTEL_SERVICE_NAME` gives traces a stable service name.
- `OTEL_EXPORTER_OTLP_ENDPOINT` sends data to the collector Service.
- `OTEL_RESOURCE_ATTRIBUTES` adds environment and namespace context.

After rollout, check app logs for exporter errors:

```bash
$ kubectl -n orders logs deploy/devpolaris-orders-api -c api --tail=40
2026-06-30T11:10:14Z INFO telemetry exporter configured endpoint=http://otel-collector.observability.svc.cluster.local:4318
```

This log confirms the app loaded the expected endpoint. It is not enough by itself; the collector and backend still need verification.

## Keep Attributes Safe and Affordable
<!-- section-summary: Attribute controls prevent secrets, personal data, and high-cardinality values from making telemetry unsafe or expensive. -->

Telemetry attributes can create two production problems: sensitive data exposure and high-cardinality cost. A trace attribute such as `user.email` can leak private data. A field such as `request.id` can create a unique label for every request in a metrics backend.

Use processors to delete unsafe fields:

```yaml
processors:
  attributes/safe:
    actions:
      - key: http.request.header.authorization
        action: delete
      - key: user.email
        action: delete
```

What this processor protects:

- Authorization headers stay out of the backend.
- Personal data stays out of normal incident search.
- The collector enforces the rule centrally.

Add the processor to the trace pipeline:

```yaml
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, attributes/safe, batch]
      exporters: [otlp/tempo]
```

Order matters here: delete sensitive attributes before batching and exporting.

## Verify One Request End to End
<!-- section-summary: End-to-end verification proves the app emitted telemetry, the collector accepted it, and the backend can query it. -->

Use one synthetic request to prove the pipeline. The exact backend query changes by tool, but the Kubernetes-side checks stay similar.

```bash
$ kubectl -n observability logs deploy/otel-collector --tail=80
2026-06-30T11:14:03Z info TracesExporter {"exporter":"otlp/tempo","spans":18}
```

What this collector log says:

- The collector received trace spans.
- The exporter sent spans to the backend.
- The exporter name matches the configured route.

If the collector exposes metrics, watch accepted and failed data:

```bash
$ kubectl -n observability port-forward deploy/otel-collector 8888:8888
Forwarding from 127.0.0.1:8888 -> 8888
```

Expected follow-up checks:

- `otelcol_receiver_accepted_spans` should rise after the synthetic request.
- `otelcol_exporter_sent_spans` should rise after export.
- `otelcol_exporter_send_failed_spans` should stay at `0` during the test.

## Troubleshoot Missing Telemetry
<!-- section-summary: Missing telemetry debugging follows the path from app configuration to network access, collector receiver, processor drops, exporter errors, and backend indexing. -->

When traces are missing, trace the pipeline hop by hop:

| Hop | Check | Evidence |
|---|---|---|
| App config | Environment variables | App logs show OTLP endpoint |
| Network | Service DNS and NetworkPolicy | App Pod can reach collector Service |
| Receiver | Collector logs or metrics | Accepted spans increase |
| Processor | Drop counters and config | Unsafe filters are intentional |
| Exporter | Exporter errors | Failed sends stay near zero |
| Backend | Search by service name | `devpolaris-orders-api` appears |

Example network check from a debug Pod:

```bash
$ kubectl -n orders run otlp-check --rm -it --image=curlimages/curl -- curl -sS http://otel-collector.observability.svc.cluster.local:4318
404 page not found
```

What this result means:

- DNS and TCP routing to the collector worked.
- The `404` is acceptable for a raw GET against an OTLP HTTP endpoint.
- A timeout or connection refused would point to Service, Pod, port, or NetworkPolicy issues.

## Operational Checklist
<!-- section-summary: A production telemetry pipeline needs clear ownership, safe attributes, collector health checks, and a tested failure path. -->

Use this checklist when reviewing the telemetry pipeline for `devpolaris-orders-api`:

| Check | Expected result |
|---|---|
| Service identity | Traces include `service.name=devpolaris-orders-api` |
| Endpoint | The app sends OTLP to `otel-collector.observability.svc.cluster.local` |
| Collector pipeline | Receivers, processors, and exporters are connected under `service.pipelines` |
| Attribute safety | Sensitive and high-cardinality fields are removed or never emitted |
| Network boundary | Only approved namespaces can reach OTLP ports |
| Collector health | Accepted, refused, failed-export, queue, memory, and restart metrics are dashboarded |
| Backend proof | A synthetic orders request can be found in the tracing backend |
| Ownership | App teams own instrumentation; platform teams own collector export and capacity |

![Telemetry operations checklist with trace proof, safe attributes, batching, dropped data, cardinality, and backend verification](/content-assets/articles/article-containers-orchestration-kubernetes-operations-telemetry-pipelines/telemetry-operations-checklist.png)

*The checklist keeps telemetry operations practical: prove one request end to end, clean unsafe fields, watch dropped data, and verify that the backend can answer incident questions.*

The pipeline is ready when a responder can name which hop failed: app emission, collector receive, processor filtering, exporter delivery, or backend indexing.

## References

- [OpenTelemetry Collector configuration](https://opentelemetry.io/docs/collector/configuration/) - Official guide to receivers, processors, exporters, extensions, and service pipelines.
- [OpenTelemetry Collector architecture](https://opentelemetry.io/docs/collector/architecture/) - Explains the collector as a vendor-neutral component that receives, processes, and exports telemetry.
- [OpenTelemetry Collector Kubernetes install](https://opentelemetry.io/docs/collector/install/kubernetes/) - Shows Kubernetes installation options and points to Helm and Operator paths for production customization.
- [OpenTelemetry agent-to-gateway deployment pattern](https://opentelemetry.io/docs/collector/deploy/other/agent-to-gateway/) - Describes the combined local-agent and central-gateway layout for larger production environments.
- [OpenTelemetry transforming telemetry](https://opentelemetry.io/docs/collector/transforming-telemetry/) - Covers filtering, attribute updates, resource enrichment, and transformation processors.
- [OpenTelemetry Collector internal telemetry](https://opentelemetry.io/docs/collector/internal-telemetry/) - Documents collector metrics, logs, queue metrics, receiver counts, and exporter failure signals.
- [OpenTelemetry OTLP exporter environment variables](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/) - Lists environment variables such as `OTEL_EXPORTER_OTLP_ENDPOINT` and protocol-specific endpoint settings.
- [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - Explains how NetworkPolicy controls Pod ingress and egress when enforced by the cluster network plugin.
- [Kubernetes ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) - Describes ConfigMaps for non-secret configuration consumed by Pods.
