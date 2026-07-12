---
title: "ML Service Tracing"
description: "Trace model-serving requests across APIs, feature services, model runtimes, fallbacks, logs, and downstream calls."
overview: "ML service tracing shows the path a prediction request takes through an inference system. This tutorial follows a route ETA ensemble service through OpenTelemetry FastAPI setup, span design, request IDs, sampling, collector export, trace-log correlation, and incident triage."
tags: ["MLOps", "core", "observability"]
order: 3
id: "article-mlops-monitoring-and-feedback-tracing-ml-services"
---

## Table of Contents

1. [Tracing Shows The Path Of One Prediction Request](#tracing-shows-the-path-of-one-prediction-request)
2. [Follow One Route ETA Ensemble](#follow-one-route-eta-ensemble)
3. [Design Spans Around The Serving Workflow](#design-spans-around-the-serving-workflow)
4. [Add OpenTelemetry To FastAPI](#add-opentelemetry-to-fastapi)
5. [Trace Model Steps, Dependencies, And Fallbacks](#trace-model-steps-dependencies-and-fallbacks)
6. [Sample Traces And Export Them Through A Collector](#sample-traces-and-export-them-through-a-collector)
7. [Correlate Traces With Logs And Metrics](#correlate-traces-with-logs-and-metrics)
8. [Practical Checks, Mistakes, And Interview Understanding](#practical-checks-mistakes-and-interview-understanding)
9. [References](#references)

## Tracing Shows The Path Of One Prediction Request
<!-- section-summary: Tracing records the timed path of one request through a model-serving system, including API work, dependency calls, model steps, and fallback decisions. -->

**ML service tracing** means recording the path of one inference request as it moves through APIs, feature services, model runtimes, and downstream calls. A trace is made of **spans**. Each span represents one timed operation, such as accepting the HTTP request, fetching route features, calling a model server, combining model outputs, or writing a fallback response.

Metrics answer aggregate questions: how many requests failed, what p95 latency is, and how much CPU or GPU is in use. Logs answer event questions: which request id, model version, response score, and error message were recorded. Traces answer path questions: where did time go for this request, which dependency slowed down, which model branch ran, and which fallback path produced the answer?

Tracing matters in MLOps because model-serving paths often have more than one moving part. A single prediction can touch feature stores, vector indexes, geospatial services, online models, rule engines, caches, and policy code. Without a trace, a responder sees "ETA API p95 latency is high" and then jumps between dashboards. With a trace, the responder can open one slow request and see the time spent in each step.

## Follow One Route ETA Ensemble
<!-- section-summary: The running scenario is a delivery ETA service where an ensemble combines route, traffic, and weather signals before returning a prediction. -->

Imagine **MetroRoute**, a logistics company that predicts delivery arrival time for couriers. The mobile app calls `/v1/eta` with pickup coordinates, dropoff coordinates, courier id, route option, and timestamp. The service returns an estimated arrival time and a confidence band.

The prediction path uses an ensemble. First, the API validates the request and creates a request id. Then it calls a map feature service for distance, turns, road class, and toll segments. Next, it calls a traffic service for current speed and incident features. A LightGBM model predicts base ETA from route features. A neural adjustment model predicts delay from traffic and weather. Finally, an ensemble function combines those values, applies safety clamps, and returns the ETA.

MetroRoute uses this stack:

| Step | Example Operation | Trace Span Name |
|---|---|---|
| API boundary | FastAPI receives `/v1/eta` | `HTTP POST /v1/eta` |
| Request validation | Pydantic validates coordinates and route id | `eta.validate_request` |
| Map features | internal HTTP call to `map-feature-api` | `eta.fetch_map_features` |
| Traffic features | internal HTTP call to `traffic-snapshot-api` | `eta.fetch_traffic_features` |
| Base model | call to `eta-base-lgbm` runtime | `eta.predict_base_model` |
| Delay model | call to `eta-delay-adjuster` runtime | `eta.predict_delay_model` |
| Ensemble | combine predictions and clamp output | `eta.combine_ensemble` |
| Fallback | cached city-level ETA if dependencies fail | `eta.cached_fallback` |

The trace should show which of these steps ran, how long each one took, and which version labels were involved. A slow request might reveal a traffic API timeout. A wrong ETA report might reveal that the fallback path handled the request. A release incident might reveal that only `eta-delay-adjuster:v18` adds 200 ms under rainy conditions.

## Design Spans Around The Serving Workflow
<!-- section-summary: Span design should mirror the serving workflow and carry stable attributes that explain service, model, dependency, and fallback behavior. -->

A span should represent a meaningful operation that an engineer can act on. Tracing every line of Python creates noise, while tracing only the outer HTTP request hides the useful details. For MetroRoute, the span design follows the serving workflow: validation, feature fetches, model calls, ensemble, and fallback.

Every span can carry **attributes**, which are named fields attached to the operation. Attributes should stay low-cardinality and safe. Good attributes include service name, route, model name, model version, dependency name, cache hit, fallback reason, and coarse region. Risky attributes include courier id, exact coordinates, full request payload, and full feature vectors. Those details belong in controlled logs or data stores with a clear privacy review.

A useful trace for a successful request can look like this:

```yaml
trace_id: 8d2a0f47e4b44b9f8e6d2e8b3b2e4d19
root_span: "HTTP POST /v1/eta"
attributes:
  service.name: eta-api
  deployment.environment.name: prod
  http.route: /v1/eta
  request.id: req_01J1W8H5Z1N6V7M4S9TE
children:
  - span: eta.validate_request
    duration_ms: 2.1
  - span: eta.fetch_map_features
    duration_ms: 38.4
    attributes:
      dependency.name: map-feature-api
      cache.hit: false
  - span: eta.fetch_traffic_features
    duration_ms: 142.7
    attributes:
      dependency.name: traffic-snapshot-api
      region: us-east
  - span: eta.predict_base_model
    duration_ms: 18.2
    attributes:
      ml.model.name: eta-base-lgbm
      ml.model.version: "42"
  - span: eta.predict_delay_model
    duration_ms: 44.9
    attributes:
      ml.model.name: eta-delay-adjuster
      ml.model.version: "18"
  - span: eta.combine_ensemble
    duration_ms: 3.6
    attributes:
      fallback.used: false
      confidence_band: medium
```

The trace gives the responder a timeline. The traffic feature call took most of the time, so the first investigation target is the traffic service, its cache, and its recent deploys. The model spans still matter because they record the model versions involved in the response. If support later asks why a specific ETA was wrong, the trace points to the exact path and versions.

![MetroRoute ETA trace timeline](/content-assets/articles/article-mlops-monitoring-and-feedback-tracing-ml-services/metroroute-eta-trace-timeline.png)
*MetroRoute traces the serving workflow as timed spans, so a vague latency alert turns into a concrete slow dependency and a visible model-version path.*

## Add OpenTelemetry To FastAPI
<!-- section-summary: OpenTelemetry instrumentation creates request spans, exports them through OTLP, and lets the service add model-specific spans around important work. -->

OpenTelemetry is the common open-source standard for traces, metrics, and logs. In Python, the FastAPI instrumentation can create HTTP server spans automatically. You then add manual spans around model-specific operations so traces explain the inference workflow instead of only the web framework.

Here is a minimal FastAPI tracing setup. It creates a tracer provider with service metadata, instruments FastAPI, and exports spans through OTLP to a local OpenTelemetry Collector.

```python
from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

resource = Resource.create(
    {
        "service.name": "eta-api",
        "service.version": "2026.07.05",
        "deployment.environment.name": "prod",
    }
)

trace.set_tracer_provider(
    TracerProvider(
        resource=resource,
        sampler=ParentBased(TraceIdRatioBased(0.10)),
    )
)

span_processor = BatchSpanProcessor(
    OTLPSpanExporter(endpoint="http://otel-collector:4317", insecure=True)
)
trace.get_tracer_provider().add_span_processor(span_processor)

app = FastAPI()
FastAPIInstrumentor.instrument_app(app)
tracer = trace.get_tracer("metroroute.eta")
```

The `Resource` fields identify the service in the tracing backend. The `ParentBased(TraceIdRatioBased(0.10))` sampler keeps about 10 percent of new traces while preserving the parent decision for child spans. That is a common starting point for high-volume services. Teams usually keep all error traces through tail sampling or backend rules, then sample healthy traffic to control cost.

FastAPI instrumentation creates the outer HTTP span. The tracer named `metroroute.eta` is for manual spans around the ML workflow. This split is useful because framework instrumentation handles common HTTP attributes, while manual spans carry model names, model versions, fallback reasons, and dependency details.

## Trace Model Steps, Dependencies, And Fallbacks
<!-- section-summary: Manual spans around feature fetches, model calls, and fallback branches show where prediction time went and which model path produced the response. -->

Manual spans should wrap the operations the team discusses during incidents. MetroRoute cares about map features, traffic features, base model prediction, delay adjustment, and ensemble combination. The code can attach attributes and record exceptions on each span.

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer("metroroute.eta")


async def predict_eta(request_payload: dict) -> dict:
    with tracer.start_as_current_span("eta.validate_request") as span:
        validated = validate_eta_request(request_payload)
        span.set_attribute("eta.route_type", validated.route_type)
        span.set_attribute("eta.region", validated.region)

    try:
        with tracer.start_as_current_span("eta.fetch_map_features") as span:
            span.set_attribute("dependency.name", "map-feature-api")
            map_features = await map_client.features(validated)
            span.set_attribute("feature.count", len(map_features))
            span.set_attribute("cache.hit", map_features.cache_hit)

        with tracer.start_as_current_span("eta.fetch_traffic_features") as span:
            span.set_attribute("dependency.name", "traffic-snapshot-api")
            traffic_features = await traffic_client.snapshot(validated)
            span.set_attribute("traffic.snapshot_age_seconds", traffic_features.age_seconds)

        with tracer.start_as_current_span("eta.predict_base_model") as span:
            span.set_attribute("ml.model.name", "eta-base-lgbm")
            span.set_attribute("ml.model.version", "42")
            base_eta = base_model.predict(map_features.vector)
            span.set_attribute("ml.output.base_eta_seconds", int(base_eta))

        with tracer.start_as_current_span("eta.predict_delay_model") as span:
            span.set_attribute("ml.model.name", "eta-delay-adjuster")
            span.set_attribute("ml.model.version", "18")
            delay_seconds = delay_model.predict(traffic_features.vector)
            span.set_attribute("ml.output.delay_seconds", int(delay_seconds))

        with tracer.start_as_current_span("eta.combine_ensemble") as span:
            response = combine_eta(base_eta, delay_seconds, validated)
            span.set_attribute("fallback.used", False)
            span.set_attribute("eta.confidence_band", response["confidence_band"])
            return response

    except TimeoutError as exc:
        with tracer.start_as_current_span("eta.cached_fallback") as span:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, "traffic dependency timeout"))
            span.set_attribute("fallback.used", True)
            span.set_attribute("fallback.reason", "dependency_timeout")
            return cached_city_eta(validated)
```

This code shows a few useful patterns. Dependency spans name the service being called. Model spans include model name and version. The fallback span records the exception and writes a reason that responders can query. Output attributes are coarse and safe. The code records `base_eta_seconds` and `delay_seconds`, while exact coordinates and courier ids stay out of span attributes.

Errors should appear as span status and events. If `traffic-snapshot-api` times out, the trace should show an error on the relevant dependency span and a fallback span afterward. That sequence helps the responder see that the ETA response came from a fallback path instead of the normal ensemble path.

## Sample Traces And Export Them Through A Collector
<!-- section-summary: Sampling controls trace volume, and the OpenTelemetry Collector centralizes export, batching, filtering, and backend routing. -->

Tracing every request for a busy inference service can create large storage costs. Sampling controls how many traces reach the backend. Head sampling decides near the start of the request, which is simple and cheap. Tail sampling decides after seeing the whole trace, which lets the collector keep errors, slow traces, or specific routes with better targeting.

MetroRoute starts with head sampling in the application and uses collector rules for batching and routing. A production team might move more sampling logic into the collector once it has clear policies for slow requests, errors, and canary traffic.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
      http:

processors:
  batch:
    timeout: 5s
    send_batch_size: 1024

  attributes/safe_trace_fields:
    actions:
      - key: courier_id
        action: delete
      - key: pickup_latitude
        action: delete
      - key: pickup_longitude
        action: delete
      - key: dropoff_latitude
        action: delete
      - key: dropoff_longitude
        action: delete

exporters:
  otlp/tempo:
    endpoint: tempo-distributor.observability.svc.cluster.local:4317
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [attributes/safe_trace_fields, batch]
      exporters: [otlp/tempo]
```

The collector receives OTLP data from the service, removes risky attributes, batches spans, and exports them to a tracing backend such as Grafana Tempo, Jaeger, or another OpenTelemetry-compatible system. The backend choice can vary. The important contract is OTLP export from services and a collector layer where the platform team can centralize batching, filtering, redaction, and routing.

Sampling should also respect incident needs. MetroRoute keeps a way to raise the sample rate for one route or one deployment during an investigation. The runbook might set the canary deployment's trace sample-rate setting to `1.0` for 30 minutes, then restore the normal value after the incident. The key is ownership and time limit, because emergency tracing can raise backend cost quickly.

![MetroRoute OpenTelemetry trace export](/content-assets/articles/article-mlops-monitoring-and-feedback-tracing-ml-services/metroroute-otel-trace-export.png)
*The collector is the control point for trace export: it keeps attributes safe, batches spans, and applies sampling policy before traces reach the backend.*

## Correlate Traces With Logs And Metrics
<!-- section-summary: Request IDs, trace IDs, model labels, and deployment labels let responders move from metric alert to trace timeline to prediction log evidence. -->

Traces are strongest when they connect with metrics and logs. A metric alert tells the team that `/v1/eta` p95 latency crossed 500 ms. The dashboard groups the latency by model version and region. A trace exemplar or trace search opens one slow request. The trace shows `eta.fetch_traffic_features` took 410 ms. The prediction log for the same request id shows the response used `eta-delay-adjuster:v18`, confidence band `low`, and no fallback.

That flow needs shared identifiers. MetroRoute adds `request_id`, `trace_id`, `model_version`, `deployment.environment.name`, and `service.name` to logs. Metrics use bounded labels such as route, region, model version, and environment. Traces use the same service and model labels. The trace id itself stays out of metric labels because it would create a unique time series per request.

A structured prediction log from the ETA service can include trace fields:

```json
{
  "event": "eta_prediction",
  "request_id": "req_01J1W8H5Z1N6V7M4S9TE",
  "trace_id": "8d2a0f47e4b44b9f8e6d2e8b3b2e4d19",
  "span_id": "f19c05c02b1de442",
  "service": "eta-api",
  "environment": "prod",
  "route": "/v1/eta",
  "region": "us-east",
  "base_model_version": "42",
  "delay_model_version": "18",
  "fallback_used": false,
  "eta_seconds": 1764,
  "confidence_band": "medium",
  "latency_ms": 248.7
}
```

Now the incident path is clear. The alert points to a route and region. The metric panel points to a model version or dependency. The trace timeline shows the slow span. The log gives the prediction summary. The responder can decide whether to roll back a model, reduce canary traffic, route around a dependency, scale a service, or open a data-quality investigation.

![MetroRoute incident path from metric to trace to log](/content-assets/articles/article-mlops-monitoring-and-feedback-tracing-ml-services/metroroute-metric-trace-log.png)
*The strongest incident flow connects aggregate symptoms to one trace timeline and then to the prediction log that records model version, request ID, and fallback evidence.*

## Practical Checks, Mistakes, And Interview Understanding
<!-- section-summary: Good ML tracing follows the serving workflow, keeps safe attributes, samples deliberately, and connects traces with logs and metrics. -->

Before launching tracing for a model service, check that every request creates or receives a request id and trace context. The API should create an HTTP server span automatically, and manual spans should cover feature fetches, model calls, ensemble logic, external dependencies, and fallback branches. Span attributes should include service name, environment, route, model name, model version, dependency name, fallback reason, region, and safe output summaries. Sensitive payload fields should stay out of spans.

The common mistakes are practical. Teams enable framework tracing and stop there, which leaves model steps invisible. They put high-cardinality payload data into span attributes, which creates privacy and cost risk. They sample too aggressively during launch and lose the slow traces they needed. They forget to link logs with trace ids, which makes a trace hard to join with prediction evidence. They trace every tiny helper function, which creates noise and hides the path that responders need.

In an interview, you can explain ML service tracing like this: tracing shows the timed path of one prediction request through the serving workflow. A trace has spans for the API boundary, feature fetches, model runtime calls, ensemble logic, dependency calls, and fallbacks. OpenTelemetry is the standard way to create and export traces. You sample traces to control cost, use the collector for batching and filtering, keep safe low-cardinality attributes, and connect traces with metrics and structured logs through request ids, trace ids, and model version labels.

## References

- [OpenTelemetry Python Instrumentation](https://opentelemetry.io/docs/zero-code/python/)
- [OpenTelemetry FastAPI Instrumentation](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/fastapi/fastapi.html)
- [OpenTelemetry Python SDK Tracing](https://opentelemetry-python.readthedocs.io/en/latest/sdk/trace.html)
- [OpenTelemetry Sampling](https://opentelemetry.io/docs/concepts/sampling/)
- [OpenTelemetry Protocol Exporter](https://opentelemetry.io/docs/languages/python/exporters/)
- [OpenTelemetry Semantic Conventions For HTTP](https://opentelemetry.io/docs/specs/semconv/http/)
- [OpenTelemetry Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
