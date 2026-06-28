---
title: "Telemetry Pipelines"
description: "Connect logs, metrics, traces, and events into a production telemetry pipeline without repeating basic signal concepts."
overview: "Logs and metrics carry more value when they travel through a clear pipeline. This article explains how the OpenTelemetry Collector receives, shapes, and exports telemetry in Kubernetes."
tags: ["kubernetes", "operations", "telemetry", "opentelemetry", "prometheus"]
order: 4
id: article-containers-orchestration-kubernetes-operations-telemetry-pipelines
---

## Table of Contents

1. [Why a Telemetry Pipeline Exists](#why-a-telemetry-pipeline-exists)
2. [Receivers, Processors, and Exporters](#receivers-processors-and-exporters)
3. [Choosing the Collector Shape](#choosing-the-collector-shape)
4. [Configuring the Collector](#configuring-the-collector)
5. [Deploying the Collector in Kubernetes](#deploying-the-collector-in-kubernetes)
6. [Pointing devpolaris-orders-api at the Pipeline](#pointing-devpolaris-orders-api-at-the-pipeline)
7. [Keeping Attributes Safe and Affordable](#keeping-attributes-safe-and-affordable)
8. [Verifying the Pipeline](#verifying-the-pipeline)
9. [Troubleshooting Missing Telemetry](#troubleshooting-missing-telemetry)
10. [Operational Checklist](#operational-checklist)

## Why a Telemetry Pipeline Exists
<!-- section-summary: A telemetry pipeline gives every signal from devpolaris-orders-api a controlled route from the Pod to the backend. -->

A slow checkout request leaves several kinds of evidence. The application writes a log line, the service records a latency number, and the request journey can show which step was slow. Those signals are useful only if responders can find them from the same request ID during an incident.

A **telemetry pipeline** is the route operational evidence takes after an application creates it. For `devpolaris-orders-api`, that evidence includes logs, metrics, request traces, and sometimes Kubernetes events around rollouts. Each signal answers a different question, yet all of them need a reliable way to leave the `orders` namespace and reach the tools your team uses during incidents.

Here is the concrete route. The orders API sends telemetry to `otel-collector.observability.svc.cluster.local`. The collector receives the data, removes unsafe fields such as raw tokens, batches the data, and exports it to the backend. Now a responder can search for `request.id=debug-20260616-1005` and see the request path instead of guessing which Pod handled it.

Without a pipeline, every service team usually wires its own exporter, backend URL, authentication token, retry settings, and filtering rules. One service sends traces straight to a vendor. Another writes logs through a sidecar. Another exposes metrics only inside the namespace. That layout works for a small demo, then daily operations start to hurt because every service has a slightly different route for the same kind of evidence.

The **OpenTelemetry Collector** gives the cluster one common place to receive telemetry, shape it, and send it onward. The orders API can send OTLP data to a collector service, while the collector handles batching, memory protection, attribute cleanup, and backend credentials. OTLP means OpenTelemetry Protocol, the standard wire protocol OpenTelemetry SDKs use for traces, metrics, logs, and profiles.

Think about a real release. The team deploys a new `devpolaris-orders-api` image at 10:00. At 10:07, checkout latency rises and a few customers see duplicate order errors. The responder needs three pieces of evidence close together: traces for the slow requests, metrics showing error rate and latency, and logs for the specific order workflow. A pipeline makes that investigation practical because the data moves through a known route with known labels such as `service.name=devpolaris-orders-api`, `k8s.namespace.name=orders`, and `deployment.environment=production`.

The next question is what the collector actually does with that data. That is where receivers, processors, and exporters come in.

## Receivers, Processors, and Exporters
<!-- section-summary: The collector pipeline has entrances, shaping steps, and exits, and each part must be enabled in the service pipeline. -->

The collector configuration is built from **receivers**, **processors**, and **exporters**. A receiver accepts telemetry from applications or other agents. A processor changes, filters, batches, or protects that telemetry while it is inside the collector. An exporter sends the final data to another system, such as Tempo for traces, Prometheus-compatible storage for metrics, Loki for logs, or a commercial observability backend.

The most common receiver for instrumented applications is the **OTLP receiver**. It listens on port `4317` for OTLP over gRPC and port `4318` for OTLP over HTTP. Those ports matter because application SDKs often use them as defaults. If the orders API is configured for OTLP gRPC, it should reach the collector on `4317`. If it is configured for OTLP HTTP, it should reach `4318`.

Processors are where production discipline usually shows up. The **memory limiter** helps protect the collector when traffic spikes. The **batch processor** groups telemetry before exporting so the collector makes fewer outbound calls. The **attributes processor** can delete fields such as `user.email`, `session.token`, or raw authorization headers before they leave the cluster.

Exporters are the exits. A debug exporter is useful while proving the pipeline because it writes readable output to the collector logs. A production exporter usually sends data to a backend over OTLP, Prometheus remote write, or another backend-specific protocol. The important habit is to keep backend tokens and TLS configuration in the collector deployment, not copied into every application.

![Telemetry pipeline flow showing app signals entering a receiver, passing through processors for sampling and attributes, then leaving through exporters to a backend](/content-assets/articles/article-containers-orchestration-kubernetes-operations-telemetry-pipelines/telemetry-pipeline-flow.png)

*The pipeline flow shows the collector as a controlled route for traces, metrics, and logs, with processing steps where teams can batch data, remove unsafe attributes, and control export behavior.*

One detail trips up many teams: defining a component does not run it. The collector only uses components listed under `service.pipelines`. If you configure `attributes/drop_sensitive` but forget to add it to the traces pipeline, the sensitive attributes still flow through unchanged.

Now we can choose where this collector should run in the cluster.

## Choosing the Collector Shape
<!-- section-summary: Kubernetes teams usually choose between gateway, agent, and agent-to-gateway collector layouts depending on traffic, ownership, and backend access. -->

There are three common Kubernetes shapes for collectors. A **gateway collector** runs as one or more Pods behind a Service. Applications send telemetry to that stable Service name. A **node agent collector** runs as a DaemonSet, one collector per node, so workloads can send telemetry close to where they run. An **agent-to-gateway pattern** uses both: lightweight agents receive local traffic, then forward to central gateways that handle stronger processing and backend export.

For `devpolaris-orders-api`, start with a gateway collector in an `observability` namespace. This is simple to understand, easy to scale with a Deployment, and gives the platform team one place to manage backend credentials. The orders API sends telemetry to `otel-collector.observability.svc.cluster.local`, and the collector exports traces to the tracing backend.

A gateway is also a good teaching shape because it keeps ownership clear. The application team owns the application instrumentation and important attributes, such as `service.name` and route names. The platform team owns collector capacity, export credentials, pipeline processors, and dashboards. Both teams can test the same route during an incident.

A node agent or agent-to-gateway layout is useful when the cluster has high telemetry volume, host-level collection, local log scraping, or a hard requirement to keep first-hop telemetry traffic on the node. That design adds more moving pieces, so it should come with dashboards for both agents and gateways. The pipeline idea stays the same; only the number and placement of collectors changes.

![Collector deployment shapes comparing sidecar, DaemonSet agent, and gateway collectors with per-pod control, node coverage, and central routing](/content-assets/articles/article-containers-orchestration-kubernetes-operations-telemetry-pipelines/collector-deployment-shapes.png)

*The collector shape visual compares where telemetry first lands. A small gateway is easier to start with, while agents and sidecars add local control when volume or ownership needs it.*

With the shape chosen, we can write a collector configuration that is small enough to read and close enough to production to be useful.

## Configuring the Collector
<!-- section-summary: The collector ConfigMap wires OTLP input through memory, attribute, and batch processors before exporting traces. -->

The collector usually reads its configuration from a **ConfigMap**. A ConfigMap stores non-secret configuration in Kubernetes. The backend token should live in a Secret, but the receiver, processor, exporter, and pipeline layout can live in a ConfigMap reviewed like any other operations manifest.

This example uses the `opentelemetry-collector-contrib` image because the attribute processor and many production processors live in the contrib distribution. We will build the ConfigMap in pieces first: receiver, processors, exporter, and service pipeline. That keeps the pipeline shape visible before the YAML gets busy.

Start with the ConfigMap shell:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-config
  namespace: observability
data:
  collector.yaml: |
    # receiver, processors, exporters, and service pipeline go here
```

The receiver is the entrance. OTLP over gRPC listens on `4317`, and OTLP over HTTP listens on `4318`:

```yaml
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318
```

The processors protect and shape the data. The memory limiter runs early, the attributes processor deletes unsafe fields, and the batch processor groups data before export:

```yaml
    processors:
      memory_limiter:
        check_interval: 1s
        limit_percentage: 75
        spike_limit_percentage: 15
      attributes/drop_sensitive:
        actions:
          - key: user.email
            action: delete
          - key: session.id
            action: delete
          - key: http.request.header.authorization
            action: delete
      batch:
        timeout: 5s
        send_batch_size: 1024
```

The exporter is the exit. This example sends traces to a Tempo-like OTLP HTTP endpoint and keeps a debug exporter available for short proof tests:

```yaml
    exporters:
      otlphttp/traces:
        endpoint: http://tempo.observability.svc.cluster.local:4318
      debug:
        verbosity: normal
```

The service section turns the pieces on. Defining `attributes/drop_sensitive` above does nothing until the traces pipeline lists that processor:

```yaml
    service:
      telemetry:
        metrics:
          readers:
            - pull:
                exporter:
                  prometheus:
                    host: 0.0.0.0
                    port: 8888
      pipelines:
        traces:
          receivers: [otlp]
          processors: [memory_limiter, attributes/drop_sensitive, batch]
          exporters: [otlphttp/traces]
```

There are a few details worth saying out loud. The receiver binds to `0.0.0.0` because other Pods need to connect to the collector Pod through the Service. That is normal inside a cluster, but the Service and NetworkPolicy still need to limit who can reach those ports. The memory limiter runs early so the collector has a chance to protect itself before queues grow. The attribute cleanup runs before batching so unsafe fields are removed before export.

The debug exporter is available for short tests, while the production traces pipeline exports only to `otlphttp/traces`. During a test, you can temporarily add `debug` to the exporters list for the traces pipeline, apply the ConfigMap, restart the collector, and watch readable spans in the logs. After the test, remove it so collector logs do not turn into a second telemetry store.

Now the collector needs a Deployment, a Service, and a network boundary.

## Deploying the Collector in Kubernetes
<!-- section-summary: A collector Deployment gives applications a stable Service endpoint while NetworkPolicy keeps OTLP ports from turning into a cluster-wide open sink. -->

The gateway collector runs well as a Kubernetes **Deployment**. A Deployment manages a set of replica Pods and rolls them out safely as the image or configuration changes. A **Service** gives those Pods a stable DNS name. `devpolaris-orders-api` should never care which collector Pod receives a request; it only needs the Service endpoint.

Start with the Deployment skeleton:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: otel-collector
  namespace: observability
spec:
  replicas: 2
  selector:
    matchLabels:
      app: otel-collector
  template:
    metadata:
      labels:
        app: otel-collector
    spec:
      containers:
        - name: collector
          image: otel/opentelemetry-collector-contrib:0.154.0
          # config, ports, resources, and volume mounts go here
```

Now add the collector arguments, ports, resource guardrails, and mounted ConfigMap:

```yaml
          args:
            - --config=/conf/collector.yaml
          ports:
            - name: otlp-grpc
              containerPort: 4317
            - name: otlp-http
              containerPort: 4318
            - name: metrics
              containerPort: 8888
          volumeMounts:
            - name: config
              mountPath: /conf
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              memory: 512Mi
      volumes:
        - name: config
          configMap:
            name: otel-collector-config
            items:
              - key: collector.yaml
                path: collector.yaml
```

The Deployment gives you collector Pods. The Service gives applications one stable name for those Pods:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: otel-collector
  namespace: observability
spec:
  selector:
    app: otel-collector
  ports:
    - name: otlp-grpc
      port: 4317
      targetPort: otlp-grpc
    - name: otlp-http
      port: 4318
      targetPort: otlp-http
    - name: metrics
      port: 8888
      targetPort: metrics
```

Apply the manifests and check that both replicas are ready.

```bash
kubectl apply -f k8s/observability/otel-collector-config.yaml
kubectl apply -f k8s/observability/otel-collector.yaml
kubectl -n observability rollout status deploy/otel-collector
kubectl -n observability get pods -l app=otel-collector
```

The Service is convenient, so add a NetworkPolicy that only allows OTLP traffic from the `orders` namespace and whatever other namespaces have approved senders. Namespace labels are the cleanest selector here because the collector lives in `observability` while the application lives in `orders`.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-orders-otlp
  namespace: observability
spec:
  podSelector:
    matchLabels:
      app: otel-collector
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: orders
      ports:
        - protocol: TCP
          port: 4317
        - protocol: TCP
          port: 4318
```

This policy assumes your cluster network plugin enforces NetworkPolicy. In clusters without enforcement, the YAML exists while traffic still flows freely. Treat enforcement support as a platform check the production cluster must pass.

The collector endpoint is ready. The orders API still needs to send telemetry to it.

## Pointing devpolaris-orders-api at the Pipeline
<!-- section-summary: The application Deployment should identify itself clearly and send OTLP traffic to the collector Service instead of a vendor endpoint. -->

Instrumentation libraries usually read OpenTelemetry configuration from environment variables. That is useful in Kubernetes because the application image can stay the same while the Deployment decides where telemetry goes in each environment.

For `devpolaris-orders-api`, the important values are the service name, deployment metadata, protocol, and endpoint. The service name should be stable because it is the main label responders use when they search traces and dashboards. The namespace and environment metadata help filter production evidence without guessing from Pod names.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devpolaris-orders-api
  namespace: orders
spec:
  template:
    metadata:
      labels:
        app: devpolaris-orders-api
    spec:
      containers:
        - name: api
          image: ghcr.io/devpolaris/orders-api:2026-05-07.1
          env:
            - name: OTEL_SERVICE_NAME
              value: devpolaris-orders-api
            - name: OTEL_RESOURCE_ATTRIBUTES
              value: deployment.environment=production,k8s.namespace.name=orders
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: http://otel-collector.observability.svc.cluster.local:4317
            - name: OTEL_EXPORTER_OTLP_PROTOCOL
              value: grpc
```

After applying the Deployment, generate a little traffic and check the collector. Use whatever route your cluster exposes for the orders API. In a local test cluster, that may be a port-forward. In production, it may be an internal ingress or synthetic check.

```bash
kubectl -n orders rollout status deploy/devpolaris-orders-api
kubectl -n orders port-forward deploy/devpolaris-orders-api 8080:8080
curl -s http://localhost:8080/orders/health
curl -s -X POST http://localhost:8080/orders \
  -H 'content-type: application/json' \
  -d '{"sku":"book-123","quantity":1}'
```

If the application uses automatic instrumentation, the exact span names depend on the language and HTTP framework. The operational requirement is more basic: traces should carry `service.name=devpolaris-orders-api`, route or endpoint information, status codes, and enough error context to debug a failed request without storing private customer data.

That last phrase matters, because raw telemetry can carry unsafe attributes.

## Keeping Attributes Safe and Affordable
<!-- section-summary: Attribute cleanup protects privacy, avoids high-cardinality costs, and keeps search indexes useful during incidents. -->

An **attribute** is a key-value field attached to telemetry. Some attributes are excellent for operations, like `http.response.status_code`, `service.name`, `k8s.namespace.name`, or `db.system`. They have clear meaning and a manageable number of values. Other attributes create privacy or cost problems, especially raw user identifiers, emails, session tokens, full request bodies, and unbounded URLs.

For metrics, high-cardinality labels can create huge storage growth. Cardinality means the number of unique label combinations. A metric named `orders_created_total` with labels for `status` and `region` may have a small number of series. The same metric with `user.email` as a label can create one series per customer. Prometheus-style systems treat each label set as a separate series, so the storage and query cost can rise quickly.

For traces and logs, the problem is slightly different. A `user.email` span attribute can enter search indexes, long-term storage, support screenshots, and incident exports. The collector is a good place to enforce a first safety rule while the application team improves instrumentation.

```yaml
processors:
  attributes/drop_sensitive:
    actions:
      - key: user.email
        action: delete
      - key: customer.name
        action: delete
      - key: session.id
        action: delete
      - key: http.request.header.authorization
        action: delete
  transform/normalize_routes:
    error_mode: ignore
    trace_statements:
      - set(span.name, "POST /orders/{orderId}") where span.name == "POST /orders/123456"
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, attributes/drop_sensitive, batch]
      exporters: [otlphttp/traces]
```

The transform example shows the kind of rule teams often want, but route normalization is usually better inside the application instrumentation because the app knows the real route template. The collector can still delete unsafe fields centrally. Treat collector cleanup as a guardrail, then fix the source instrumentation so unsafe attributes do not get emitted in the first place.

A practical review for the orders API checks these questions before a new attribute reaches production:

| Attribute question | Healthy answer |
|---|---|
| Does it identify a person directly? | Keep it out of normal telemetry |
| Can it have millions of unique values? | Avoid it as a metric label |
| Does it help route an incident? | Keep it if it is safe and bounded |
| Does it contain request or auth data? | Delete it or heavily sanitize it |
| Does the backend index it by default? | Review cost and privacy before rollout |

Once the pipeline has safe attributes, the team needs proof that telemetry is actually flowing.

## Verifying the Pipeline
<!-- section-summary: Verification checks the application, collector, and backend separately so responders know where the pipeline is failing. -->

Good pipeline verification checks each hop separately. First, the application should be configured with the expected endpoint and service name. Second, the collector should accept spans without refusing them. Third, the exporter should send data without failures. Fourth, the backend should show the service in queries and dashboards.

Start by checking the orders API environment from the running Deployment.

```bash
kubectl -n orders exec deploy/devpolaris-orders-api -- printenv | grep '^OTEL_'
```

Then check collector logs for startup errors. A bad exporter URL, unknown processor name, or invalid YAML usually shows up before the collector accepts traffic.

```bash
kubectl -n observability logs deploy/otel-collector --tail=80
```

The collector exposes its own internal metrics. Port-forward the metrics port and look for receiver and exporter counters. Metric names can vary slightly by collector version and Prometheus exporter settings, so search by the useful prefixes instead of memorizing one exact spelling.

```bash
kubectl -n observability port-forward deploy/otel-collector 8888:8888
curl -s http://localhost:8888/metrics \
  | grep -E 'otelcol_receiver_(accepted|refused)_spans|otelcol_exporter_send_failed_spans|otelcol_exporter_queue'
```

A healthy trace pipeline has accepted spans increasing during traffic, refused spans staying flat, exporter send failures staying flat, and queue size staying comfortably below capacity. A dashboard should graph those values for the collector itself. The collector is part of production now, so it needs alerts just like an application.

Useful dashboard panels for this scenario include:

| Panel | Why operators need it |
|---|---|
| Receiver accepted spans by receiver and transport | Confirms the orders API can reach the collector |
| Receiver refused spans | Shows receiver-side drops or overload |
| Exporter send failures | Shows backend, auth, DNS, or TLS problems |
| Exporter queue size and capacity | Warns before data backs up |
| Collector memory and restarts | Catches sizing and crash loops |
| Backend service search for `devpolaris-orders-api` | Confirms exported data is queryable |

For a release runbook, include one synthetic request that should create a trace, then a backend query that should find it by service name within a few minutes. That gives the team a simple yes-or-no check after collector or application changes.

When the yes-or-no check fails, use a repeatable troubleshooting path.

## Troubleshooting Missing Telemetry
<!-- section-summary: Missing telemetry is easier to debug when you test endpoint configuration, network reachability, collector ingestion, and exporter delivery in order. -->

Missing telemetry usually points to one of four places: no emission from the application, no network path to the collector, drops inside the collector, or export failure after ingestion. Work through those hops in order so the team can find a NetworkPolicy or backend-token problem before changing instrumentation.

If the collector shows zero accepted spans, check the application endpoint and protocol first.

```bash
kubectl -n orders exec deploy/devpolaris-orders-api -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
kubectl -n orders exec deploy/devpolaris-orders-api -- printenv OTEL_EXPORTER_OTLP_PROTOCOL
kubectl -n orders run otlp-network-check --rm -it --restart=Never \
  --image=curlimages/curl:8.10.1 \
  -- curl -v telnet://otel-collector.observability.svc.cluster.local:4317
```

The `curl` image is only a quick network probe. A successful TCP connection does not prove valid OTLP data, but it does prove DNS, routing, Service selection, and NetworkPolicy are allowing the first hop. If this check fails, inspect the Service selector and NetworkPolicy before changing application code.

```bash
kubectl -n observability get svc otel-collector -o wide
kubectl -n observability get endpoints otel-collector
kubectl -n observability describe networkpolicy allow-orders-otlp
```

If accepted spans increase but the backend has no traces, focus on the exporter. Look for send failures and exporter log messages.

```bash
kubectl -n observability logs deploy/otel-collector \
  | grep -E 'exporter|otlphttp|failed|error'
```

Exporter failures usually come from a wrong backend DNS name, a TLS mismatch, a missing authentication header, or a backend outage. Keep those credentials in collector-owned Secrets and rotate them there. The orders API should not need vendor credentials just to emit trace data.

If refused spans or queue size rise during traffic spikes, the collector may need more memory, more replicas, or a stronger sampling strategy. A quick scale-up can stabilize an incident, but a follow-up review should decide whether the pipeline needs better batching, a gateway tier, tail sampling, or lower-cardinality attributes.

```bash
kubectl -n observability scale deploy/otel-collector --replicas=4
kubectl -n observability rollout status deploy/otel-collector
```

After the incident, record which hop failed. "No traces" is too vague for future responders. "Orders API could reach the collector, collector accepted spans, exporter failed TLS to Tempo" is a useful operational note.

## Operational Checklist
<!-- section-summary: A production telemetry pipeline needs clear ownership, safe attributes, collector health checks, and a tested failure path. -->

Use this checklist when reviewing the telemetry pipeline for `devpolaris-orders-api`:

| Check | Expected result |
|---|---|
| Service identity | Traces include `service.name=devpolaris-orders-api` |
| Endpoint | The app sends OTLP to `otel-collector.observability.svc.cluster.local` |
| Collector pipeline | Receivers, processors, and exporters are all enabled under `service.pipelines` |
| Attribute safety | Sensitive and high-cardinality fields are removed or never emitted |
| Network boundary | Only approved namespaces can reach OTLP ports |
| Collector health | Accepted, refused, failed-export, queue, memory, and restart metrics are dashboarded |
| Backend proof | A synthetic orders request can be found in the tracing backend |
| Ownership | App teams own instrumentation; platform teams own collector export and capacity |

![Telemetry operations checklist with trace proof, safe attributes, batching, dropped data, cardinality, and backend verification](/content-assets/articles/article-containers-orchestration-kubernetes-operations-telemetry-pipelines/telemetry-operations-checklist.png)

*The checklist keeps telemetry operations practical: prove one request end to end, clean unsafe fields, watch dropped data, and verify that the backend can answer incident questions.*

The pipeline is healthy when it is boring during a normal release and useful during an incident. The orders team should know where to send telemetry, the platform team should know how the collector is behaving, and responders should be able to prove which hop is working without guessing from screenshots.

---

**References**

- [OpenTelemetry Collector configuration](https://opentelemetry.io/docs/collector/configuration/) - Official guide to receivers, processors, exporters, extensions, and service pipelines.
- [OpenTelemetry Collector architecture](https://opentelemetry.io/docs/collector/architecture/) - Explains the collector as a vendor-neutral component that receives, processes, and exports telemetry.
- [OpenTelemetry Collector Kubernetes install](https://opentelemetry.io/docs/collector/install/kubernetes/) - Shows Kubernetes installation options and points to Helm and Operator paths for production customization.
- [OpenTelemetry agent-to-gateway deployment pattern](https://opentelemetry.io/docs/collector/deploy/other/agent-to-gateway/) - Describes the combined local-agent and central-gateway layout for larger production environments.
- [OpenTelemetry transforming telemetry](https://opentelemetry.io/docs/collector/transforming-telemetry/) - Covers filtering, attribute updates, resource enrichment, and transformation processors.
- [OpenTelemetry Collector internal telemetry](https://opentelemetry.io/docs/collector/internal-telemetry/) - Documents collector metrics, logs, queue metrics, receiver counts, and exporter failure signals.
- [OpenTelemetry OTLP exporter environment variables](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/) - Lists environment variables such as `OTEL_EXPORTER_OTLP_ENDPOINT` and protocol-specific endpoint settings.
- [Kubernetes Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) - Explains how NetworkPolicy controls Pod ingress and egress when enforced by the cluster network plugin.
- [Kubernetes ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) - Describes ConfigMaps for non-secret configuration consumed by Pods.
