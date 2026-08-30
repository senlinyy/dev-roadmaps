---
title: "ML Service Tracing"
description: "A distributed trace turns one prediction request into a causal timeline of spans, while trace IDs, prediction IDs, metrics, and logs retain distinct jobs."
overview: "A distributed trace turns one prediction request into a causal timeline of spans, while trace IDs, prediction IDs, metrics, and logs retain distinct jobs. Tracing provides causal evidence that joins service latency and failures to feature, model, release, prediction, and outcome evidence in the wider monitoring system."
tags: ["MLOps", "core", "observability"]
order: 3
id: "article-mlops-monitoring-and-feedback-tracing-ml-services"
---

## Table of Contents

1. [How Does a Trace Explain One ML Request across Services?](#how-does-a-trace-explain-one-ml-request-across-services)
2. [How Should Trace Context, Spans, and Attributes Cross Boundaries?](#how-should-trace-context-spans-and-attributes-cross-boundaries)
3. [How Do Automatic Instrumentation, Manual Spans, and Collectors Fit Together?](#how-do-automatic-instrumentation-manual-spans-and-collectors-fit-together)
4. [How Should Sampling Preserve the Traces Most Useful for Investigation?](#how-should-sampling-preserve-the-traces-most-useful-for-investigation)
5. [What Do Online, Release, Batch, and LLM Traces Reveal?](#what-do-online-release-batch-and-llm-traces-reveal)
6. [How Do You Control Span Detail, Overhead, Failure, Searchability, and Sensitive Data?](#how-do-you-control-span-detail-overhead-failure-searchability-and-sensitive-data)
7. [How Should a Team Choose and Test Its Tracing Stack?](#how-should-a-team-choose-and-test-its-tracing-stack)
8. [How Does Tracing Connect Service Health to Model Health?](#how-does-tracing-connect-service-health-to-model-health)
9. [Check Your Answers](#check-your-answers)

An ML request takes two seconds, but the model itself runs for only 80 milliseconds. The remaining time may be waiting in a queue, fetching features, calling another service, retrying a dependency, or serializing a large response. An aggregate latency graph cannot show which request followed which path.

A **distributed trace** records one request as connected spans. Each span represents a timed operation, and parent-child relationships show how work caused or waited for other work across services. That timeline complements metrics, logs, and prediction records rather than replacing them.

These questions build the trace from its identifiers and propagation rules through sampling, investigation, security, and its role in model monitoring:

1. **How Does a Trace Explain One ML Request across Services?**
2. **How Should Trace Context, Spans, and Attributes Cross Boundaries?**
3. **How Do Automatic Instrumentation, Manual Spans, and Collectors Fit Together?**
4. **How Should Sampling Preserve the Traces Most Useful for Investigation?**
5. **What Do Online, Release, Batch, and LLM Traces Reveal?**
6. **How Do You Control Span Detail, Overhead, Failure, Searchability, and Sensitive Data?**
7. **How Should a Team Choose and Test Its Tracing Stack?**
8. **How Does Tracing Connect Service Health to Model Health?**

## How Does a Trace Explain One ML Request across Services?
<!-- section-summary: A distributed trace turns one prediction request into a causal timeline of spans, while trace IDs, prediction IDs, metrics, and logs retain distinct jobs. -->

A distributed trace turns one prediction request into a causal timeline of spans, while trace IDs, prediction IDs, metrics, and logs retain distinct jobs.

An ML service may tell you:

* **metrics:** “p99 latency increased to 1.8 seconds,”
* **logs:** “the feature-store request timed out,”
* **prediction records:** “model v42 produced prediction P8172.”

But an engineer investigating a particular slow request still needs to know:

**Where did the request spend those 1.8 seconds?**

Was it waiting at the API gateway Fetching features Queuing for a GPU Running inference Calling another service Retrying a database request?

That is the problem **distributed tracing** solves. A prediction may look simple from outside:

```text
request
   ↓
ML service
   ↓
prediction
```

But internally it may actually be:

```text
Client
  │
  ▼
API Gateway
  │
  ▼
Prediction Service
  │
  ├── Authentication
  │
  ├── Feature Store
  │
  ├── Preprocessing
  │
  ├── Model Server
  │       └── GPU inference
  │
  ├── Rules Engine
  │
  └── Response
```

Suppose the entire request takes:

```text
1.7 seconds
```

A latency metric tells you the request was slow. It does **not** tell you where the time went. To diagnose the problem, we need to preserve the path that one request took through the system. That leads to the fundamental idea:

> **A trace is a structured timeline of one request as it moves through a system.**

Imagine this prediction request:

```text
Request started                       t = 0 ms
Feature lookup finished             t = 620 ms
Preprocessing finished              t = 640 ms
Model inference finished            t = 710 ms
Response finished                   t = 730 ms
```

A trace can represent that visually:

```text
Prediction request                    730 ms
│
├── authentication                     8 ms
├── feature lookup                   610 ms   ← suspicious
├── preprocessing                     20 ms
├── model inference                   70 ms
└── postprocessing                    22 ms
```

Immediately, the important fact becomes visible:

```text
Total latency         = 730 ms
Model inference       =  70 ms
Feature lookup        = 610 ms
```

Without tracing, someone might blame the model because the endpoint is an ML endpoint. The trace shows that the model itself is not the bottleneck. A trace is made of **spans**. A span represents one operation that took some amount of time.

For example:

```text
Trace: prediction request
│
├── Span: fetch_features
├── Span: preprocess
├── Span: model_inference
└── Span: postprocess
```

Each span typically contains information like:

```text
operation        = model_inference
start_time       = 10:04:21.120
end_time         = 10:04:21.194
duration         = 74 ms
status           = success
model_version    = fraud-v42
```

Conceptually:

$$
Duration_{span}
=
t_{end}-t_{start}
$$

A trace then combines related spans into the history of one request. Suppose one prediction requires a feature lookup and model inference. The prediction operation is the parent:

```text
prediction_request
```

Inside it are child operations:

```text
prediction_request
    │
    ├── feature_lookup
    ├── preprocessing
    └── model_inference
```

If `feature_lookup` itself calls Redis:

```text
prediction_request
    │
    ├── feature_lookup
    │      └── redis_get
    │
    ├── preprocessing
    └── model_inference
```

This hierarchy is important because it shows not just **when** operations happened, but **which operation caused which work**. A trace is therefore more than a timing log. It represents a causal execution tree. Suppose millions of requests are running at the same time.

How does the tracing system know which spans belong together?

Each trace receives an identifier:

```text
trace_id = 7c3a...
```

Every span belonging to that request carries the same trace ID.

For example:

```text
trace_id = 7c3a
span = gateway

trace_id = 7c3a
span = feature_lookup

trace_id = 7c3a
span = model_inference
```

Now the tracing backend can reconstruct:

```text
trace 7c3a
   │
   ├── gateway
   ├── feature lookup
   └── inference
```

Each span also normally has its own:

```text
span_id
```

and a reference to its parent. So conceptually:

```text
trace_id
→ identifies the whole distributed operation

span_id
→ identifies one operation within it

parent_span_id
→ identifies which operation caused it
```

A normal API might call a database and return. An ML prediction may depend on many more moving parts:

```text
                       ┌── Feature store
                       │
Client → Gateway → Prediction API
                       │
                       ├── Cache
                       │
                       ├── Embedding service
                       │
                       ├── Model server
                       │       │
                       │       └── GPU
                       │
                       ├── Rules engine
                       │
                       └── Database
```

A user sees one request. Engineering sees many distributed operations. Tracing reconnects them into a single story. A useful decomposition is:

$$
T_{request}
=
T_{queue}
+
T_{network}
+
T_{feature}
+
T_{preprocess}
+
T_{inference}
+
T_{postprocess}
+
T_{dependencies}
+\ldots
$$

Suppose:

```text
queue              300 ms
feature fetch      180 ms
preprocessing       15 ms
inference           60 ms
postprocessing      10 ms
network             35 ms
--------------------------
total              600 ms
```

If you monitor only:

```text
model inference = 60 ms
```

you might conclude performance is excellent. But users experience:

```text
600 ms
```

Tracing exposes the difference between:

**model execution time**

and:

**end-to-end prediction latency**

That distinction is central to ML serving. Consider a GPU inference server. A request arrives but cannot immediately run because other requests are using the GPU.

```text
request arrives
      │
      ▼
wait in queue       800 ms
      │
      ▼
GPU inference        90 ms
      │
      ▼
response
```

If you instrument only the model execution:

```text
inference = 90 ms
```

everything looks fine. But total latency is nearly a second. Therefore a useful trace might distinguish:

```text
model_request
    │
    ├── inference_queue_wait    800 ms
    └── inference_compute        90 ms
```

That tells you whether the bottleneck is:

```text
slow model
```

or:

```text
insufficient serving capacity
```

Those require completely different fixes. This distinction is worth remembering.

### Metrics

Answer:

“Is there a widespread problem?”

Example:

```text
p99 latency = 1.4 s
```

### Logs

Answer:

“What event happened?”

Example:

```text
feature service timeout after 500 ms
```

### Traces

Answer:

“What happened along this particular request path?”

Example:

```text
Prediction request                  1.4 s
│
├─ gateway                           15 ms
├─ feature service                  920 ms
│    ├─ database query              500 ms
│    └─ retry                       400 ms
├─ inference                         80 ms
└─ other work                       ...
```

A useful investigation flow is therefore:

```text
Metrics
   │
   │ detect anomaly
   ▼
Trace
   │
   │ locate slow/failing operation
   ▼
Logs
   │
   │ inspect detailed failure
   ▼
Root cause
```

The systems complement one another. Prediction logging gives an individual model decision an identity:

```text
prediction_id = pred_8172
```

Tracing gives the entire execution path an identity:

```text
trace_id = trace_a91f
```

A prediction record may therefore contain both:

```text
prediction_id = pred_8172
trace_id      = trace_a91f
```

Now an investigation can move between them:

```text
Prediction record
      │
      │ trace_id
      ▼
Distributed trace
      │
      ▼
feature lookup
model inference
database call
queue waiting
```

And the other direction:

```text
Slow trace
    │
    │ prediction_id
    ▼
Prediction evidence
    │
    ▼
model version
score
decision
feature version
```

This creates a powerful connection between **model behaviour** and **service behaviour**.

## How Should Trace Context, Spans, and Attributes Cross Boundaries?
<!-- section-summary: Trace context must propagate across process and protocol boundaries, and spans should mark risk or latency boundaries with bounded, safe attributes. -->

Trace context must propagate across process and protocol boundaries, and spans should mark risk or latency boundaries with bounded, safe attributes.

Suppose this happens:

```text
Prediction API
      │
      ▼
Feature Service
      │
      ▼
Database
```

The prediction API creates:

```text
trace_id = ABC
```

But when it calls the feature service, imagine it sends no tracing information. The feature service creates:

```text
trace_id = XYZ
```

Now the tracing system sees:

```text
Trace ABC
└── Prediction API

Trace XYZ
└── Feature Service
```

They appear unrelated. The request chain has been broken. Instead, the prediction service propagates **trace context** with the request.

Conceptually:

```text
Prediction API
trace_id = ABC
      │
      │ HTTP request
      │ tracing context: ABC
      ▼
Feature Service
trace_id = ABC
```

If the feature service then calls the database or another service, the context continues. This process is called **context propagation**. Without it, distributed tracing becomes fragmented. The same principle applies whether services communicate using:

```text
HTTP
gRPC
message queues
event streams
RPC
background jobs
```

The trace identity has to move with the unit of work. For synchronous HTTP:

```text
service A
   │
   │ request + trace context
   ▼
service B
```

For asynchronous messaging:

```text
producer
   │
   │ message
   │ trace context in message metadata
   ▼
queue
   │
   ▼
consumer
```

The mechanics differ, but the conceptual requirement is the same:

Preserve causal identity as work moves between components.

Historically, observability vendors often had their own tracing libraries and formats. That creates a problem. Suppose your application is deeply instrumented using vendor A's proprietary API. Later you want to switch to vendor B. You may have to rewrite significant amounts of instrumentation. OpenTelemetry addresses this by providing a vendor-neutral observability framework.

Conceptually:

```text
Application
    │
    │ OpenTelemetry instrumentation
    ▼
Standard telemetry representation
    │
    ▼
Collector
    │
    ├── Backend A
    ├── Backend B
    └── Backend C
```

OpenTelemetry supports telemetry such as:

```text
traces
metrics
logs
```

The important idea is not merely that it is another monitoring library. It provides common conventions for:

```text
creating spans
propagating trace context
describing services
exporting telemetry
```

This reduces coupling between application code and the backend used to store or visualize traces. A simplified architecture looks like:

```text
Your application
      │
      ├── OpenTelemetry API
      └── OpenTelemetry SDK
               │
               ▼
             spans
               │
               ▼
            exporter
```

The application generates spans. Those spans may then go to an OpenTelemetry Collector or directly to some backend. In larger environments, the collector is commonly useful. This is a design decision. You could create spans for almost everything:

```text
parse integer
read variable
add two numbers
allocate tensor
```

But this would create overwhelming amounts of trace data. Instead ask:

“During a real incident, what operations would I want to distinguish?”

For an ML service, useful spans might be:

```text
prediction_request
│
├── authenticate
├── fetch_features
├── preprocess
├── candidate_retrieval
├── inference_queue
├── model_inference
├── postprocess
├── policy_evaluation
└── write_result
```

Each span represents a meaningful investigative boundary. A particularly useful principle is:

Create spans where latency, failure, ownership, or dependencies meaningfully change.

For example:

```text
feature_store_call
```

is useful because:

* it is a separate dependency,
* it can become slow,
* it can fail,
* another team may own it.

Similarly:

```text
model_inference
```

is useful because:

* it consumes expensive compute,
* different model versions behave differently,
* latency may change by hardware or batch size.

But:

```text
convert_float_to_tensor
```

may not need its own span unless it is genuinely operationally important. Timing alone is often insufficient. Suppose:

```text
model_inference = 950 ms
```

Why?

The span might also contain safe, bounded metadata such as:

```text
model.name          = recommender
model.version       = v18
hardware.type       = gpu
batch.size          = 64
region              = eu-west
request.type        = ranking
```

Now you can ask:

```text
Are slow traces concentrated on v18

Are they concentrated on one region

Does batch size correlate with latency
```

Span attributes turn traces from timelines into queryable evidence. It is tempting to attach:

```text
user_email
full_prompt
credit_card_number
raw_feature_vector
authentication_token
```

to spans. That is usually dangerous. Tracing backends are observability systems, not arbitrary secure data vaults. As with prediction logging, traces should generally contain:

```text
safe operational metadata
```

rather than unrestricted raw inputs. You should also think about cardinality. Useful:

```text
model_version = {v17, v18}
region        = {eu, us, apac}
status        = {success, failure}
```

Potentially expensive:

```text
user_id       = millions of values
request_body  = almost every value unique
```

Tracing systems can often tolerate more event-level uniqueness than metric systems, but that does not make unrestricted metadata free or safe.

![Recommendation request trace showing the API forking feature retrieval and candidate retrieval, joining before model inference and policy, plus a separate 900-millisecond critical-path breakdown](/content-assets/articles/article-mlops-monitoring-and-feedback-tracing-ml-services/recommendation-request-trace.png)

*A recommendation request can run feature and candidate work in parallel before model inference and policy. The separate 900-millisecond example shows why the longest dependent chain, not the sum of overlapping spans, controls the caller’s wait.*

## How Do Automatic Instrumentation, Manual Spans, and Collectors Fit Together?
<!-- section-summary: Automatic instrumentation covers common frameworks, manual spans expose ML-specific work, and a collector separates applications from storage and routing concerns. -->

Automatic instrumentation covers common frameworks, manual spans expose ML-specific work, and a collector separates applications from storage and routing concerns.

Many common frameworks already have predictable operations:

```text
incoming HTTP request
outgoing HTTP call
database query
gRPC request
message processing
```

Tracing libraries can often instrument these automatically.

For example:

```text
Prediction request
│
├── HTTP client call
├── SQL query
└── gRPC call
```

without engineers manually creating every span. This is called **automatic instrumentation**. It gives broad coverage quickly. Automatic instrumentation does not understand your domain. It may see:

```text
Python function
```

but not understand:

```text
feature transformation
candidate generation
inference queue
embedding computation
model inference
reranking
fallback model
```

So ML systems often need manual spans around meaningful operations.

For example:

```text
with span("model_inference"):
    prediction = model(features)
```

Conceptually, manual instrumentation tells the tracing system:

This operation has semantic meaning and should appear explicitly in the trace.

Automatic instrumentation gives:

```text
HTTP
database
RPC
framework operations
```

Manual instrumentation adds:

```text
feature computation
GPU queueing
inference
postprocessing
fallback
```

Together:

```text
Prediction request
│
├── HTTP / auth              ← automatic
│
├── feature retrieval
│    └── database query      ← automatic
│
├── preprocess               ← manual
│
├── inference queue          ← manual
│
├── model inference          ← manual
│
└── outgoing RPC             ← automatic
```

This gives infrastructure visibility and ML-specific meaning. Suppose a dependency fails:

```text
feature_store
    │
    ▼
timeout
```

The span should ideally reflect that it did not complete normally.

Conceptually:

```text
span:
operation = feature_lookup
duration  = 500 ms
status    = error
error.type = timeout
```

Then a trace can look like:

```text
Prediction request                  540 ms  ERROR
│
├── feature lookup                 500 ms  ERROR
│     └── network call             500 ms  TIMEOUT
└── fallback                        20 ms
```

This tells you both where the delay occurred and where the error originated. A common tracing architecture looks like:

```text
ML Service
    │
    ▼
OpenTelemetry SDK
    │
    ▼
OpenTelemetry Collector
    │
    ├── process
    ├── batch
    ├── filter
    ├── sample
    └── export
         │
         ▼
Tracing Backend
```

The collector acts as telemetry infrastructure. Instead of every application needing to know:

```text
backend hostname
vendor protocol
retry policy
authentication mechanism
batch settings
```

the applications can send standardized telemetry to the collector. The collector handles much of the downstream complexity. Suppose 300 services are instrumented. Without a collector:

```text
Service 1 ─────► tracing vendor
Service 2 ─────► tracing vendor
Service 3 ─────► tracing vendor
...
```

Every service contains export configuration. With collectors:

```text
services
   │
   ▼
collector layer
   │
   ▼
backend
```

Now telemetry policies can often be managed centrally. The collector might:

```text
remove sensitive fields
drop unwanted spans
batch events
retry delivery
route different telemetry
apply sampling
```

This makes observability architecture easier to evolve.

## How Should Sampling Preserve the Traces Most Useful for Investigation?
<!-- section-summary: Random, head, and tail sampling make different tradeoffs; whichever policy is used must preserve complete traces and the rare failures worth investigating. -->

Random, head, and tail sampling make different tradeoffs; whichever policy is used must preserve complete traces and the rare failures worth investigating.

Suppose your service handles:

$$
20,000 \text{ requests/sec}
$$

and each trace contains:

$$
12 \text{ spans}
$$

Then:

$$
20,000 \times 12 = 240,000
$$

span records are produced every second. Per day:

$$
240,000 \times 86,400
\approx 20.7 \text{ billion spans}
$$

Storing and indexing every trace may become expensive. Therefore tracing systems commonly use **sampling**. Suppose:

```text
sampling rate = 1%
```

Then approximately:

$$
1 / 100
$$

requests are fully traced. Instead of storing one billion traces, perhaps you store roughly ten million. The trade-off is straightforward:

```text
more traces
→ more visibility
→ more cost

fewer traces
→ less cost
→ greater chance of missing interesting requests
```

Imagine:

```text
99.9% requests succeed
0.1% requests fail
```

With low random sampling, some rare failures may disappear from trace storage. But those are precisely the requests you care most about. So smarter strategies can keep:

```text
small sample of normal traces
+
large or complete sample of errors
+
large sample of very slow requests
```

For example:

```text
Normal request       → keep 1%
Error                 → keep 100%
Latency > 2 seconds   → keep 100%
Canary model          → keep 50%
```

This focuses storage on diagnostically useful events. Two important approaches exist.

### Head sampling

The decision is made near the beginning of the request:

```text
request arrives
     │
     ▼
sample
 ┌───┴───┐
yes      no
```

Advantages:

```text
simple
cheap
early decision
```

Problem:

At the beginning you do not yet know whether the request will:

```text
fail
take 8 seconds
hit a rare fallback path
```

### Tail sampling

The system waits until the trace is complete. Then it knows:

```text
latency
status
errors
span contents
```

and can decide:

```text
keep this trace because it failed
```

Conceptually:

```text
complete trace
      │
      ▼
inspect outcome
      │
      ├── error → keep
      ├── very slow → keep
      └── normal → sample lightly
```

Tail sampling can preserve unusual events more intelligently, but requires more telemetry infrastructure because traces must be buffered before the decision. A trace is useful because its spans form a story. Imagine randomly keeping individual spans:

```text
Prediction request
│
├── ?? missing
├── inference
├── ?? missing
└── database
```

The causal path becomes difficult to understand. Tracing systems therefore try to make coherent sampling decisions about the trace as a unit. The principle is:

A trace is valuable because its related spans remain connected.

## What Do Online, Release, Batch, and LLM Traces Reveal?
<!-- section-summary: Concrete traces localize slow requests, release regressions, batch steps, queues, and specialized LLM work while connecting symptoms to the version that caused them. -->

Concrete traces localize slow requests, release regressions, batch steps, queues, and specialized LLM work while connecting symptoms to the version that caused them.

Suppose your service dashboard reports:

```text
normal p99 latency = 300 ms
current p99        = 1.9 seconds
```

Metrics tell you there is a problem. You search traces with:

```text
service = recommendation-api
latency > 1 second
model_version = v28
```

One trace shows:

```text
recommendation_request                 1,860 ms
│
├── authentication                        8 ms
│
├── fetch_user_features                 105 ms
│
├── retrieve_candidates                 120 ms
│
├── model_server_call                 1,510 ms
│     │
│     ├── inference_queue_wait        1,390 ms
│     └── GPU inference                 105 ms
│
└── postprocessing                       20 ms
```

This immediately changes the diagnosis. The model itself takes:

```text
105 ms
```

The queue takes:

```text
1,390 ms
```

Therefore the problem is not primarily model compute. It is capacity or scheduling. Suppose infrastructure metrics for the same period show:

```text
GPU utilization          99%
inference queue depth    380
request traffic          +45%
```

Now there is a coherent causal explanation:

```text
traffic increase
      ↓
GPU capacity exhausted
      ↓
queue depth rises
      ↓
queue waiting time rises
      ↓
request latency rises
```

Tracing identifies **where individual requests spent time**. Metrics show **how widespread the condition was**. Together they support diagnosis. Suppose traffic remains unchanged:

```text
requests/sec → unchanged
```

But after deploying `v29`:

```text
p99 latency ↑
```

Trace comparison shows:

```text
v28:

model_inference = 80 ms
queue_wait      = 15 ms
```

while:

```text
v29:

model_inference = 310 ms
queue_wait      = 700 ms
```

What happened?

A slower model initially increases compute time:

```text
inference time ↑
```

Because each request occupies the GPU longer:

```text
capacity per second ↓
```

Then queues form:

```text
queue wait ↑
```

Then end-to-end latency becomes much worse. The causal sequence is:

```text
larger/slower model
       ↓
GPU occupied longer
       ↓
effective throughput falls
       ↓
queue grows
       ↓
tail latency explodes
```

A single latency metric would show only the final symptom. Tracing helps reveal the internal mechanics. Tracing is not limited to synchronous APIs. Consider:

```text
Batch scoring job
      │
      ├── read dataset
      ├── transform features
      ├── load model
      ├── run partitions
      └── write predictions
```

A trace might represent:

```text
batch_scoring_job                   34 min
│
├── read_input                       4 min
├── feature_processing              12 min
├── inference                       10 min
└── write_output                     8 min
```

Or a trace might follow a single task through a distributed pipeline. However, very long workflows may also be better represented with workflow/run telemetry rather than treating everything as one giant request trace. The same principle applies:

Instrument the execution boundaries that help someone diagnose actual failures.

Consider an LLM request:

```text
user request
    │
    ▼
safety / policy
    │
    ▼
retrieve documents
    │
    ▼
construct prompt
    │
    ▼
model queue
    │
    ▼
prefill
    │
    ▼
token generation
    │
    ▼
postprocess
```

A useful trace might expose:

```text
LLM request                         4.8 s
│
├── retrieval                       180 ms
├── prompt construction              8 ms
├── queue wait                      900 ms
├── time to first token             620 ms
└── token generation               3.1 s
```

For LLM systems, particularly useful attributes may include bounded, safe metadata such as:

```text
model version
input token count
output token count
batch size
retrieval duration
tool-call duration
cache hit/miss
```

Again, full prompts and private user content should not automatically be placed into general tracing telemetry.

![Direct calls using parent-child trace context compared with three independent request contexts linked to one shared GPU batch](/content-assets/articles/article-mlops-monitoring-and-feedback-tracing-ml-services/trace-context-and-span-links.png)

*Parent-child context preserves direct cause across HTTP and gRPC calls. A link set connects all contributing request contexts to shared asynchronous batch work without pretending that one request caused the others.*

## How Do You Control Span Detail, Overhead, Failure, Searchability, and Sensitive Data?
<!-- section-summary: Useful tracing balances diagnostic span boundaries against cardinality, privacy, storage, overhead, graceful failure, and the health of the telemetry pipeline itself. -->

Useful tracing balances diagnostic span boundaries against cardinality, privacy, storage, overhead, graceful failure, and the health of the telemetry pipeline itself.

A large waterfall diagram can look sophisticated while providing little useful information. For each span, ask:

“What question does this let us answer?”

For example:

```text
inference_queue_wait
→ Are requests waiting for compute

feature_store
→ Is feature retrieval causing latency

model_inference
→ Did model execution become slower

fallback
→ Are requests taking degraded paths

policy_engine
→ Is business logic responsible for the final delay
```

Useful tracing is designed around investigation. Suppose the entire service is represented as:

```text
prediction_request = 1.2 seconds
```

Technically this is a trace. Operationally, it tells you little more than the latency metric. You cannot distinguish:

```text
feature lookup
inference
queueing
database
postprocessing
```

So spans must be fine-grained enough to separate meaningful causes. The opposite extreme is:

```text
parse_json             0.3 ms
allocate_array         0.1 ms
convert_dtype          0.2 ms
copy_vector            0.4 ms
function_238           0.1 ms
function_239           0.1 ms
...
```

Now one request produces hundreds or thousands of nearly useless spans. This causes:

```text
high cost
large traces
visual noise
slow investigation
instrumentation overhead
```

The right abstraction is usually:

> **One span per operationally meaningful unit of work.**

Every span requires some combination of:

```text
timestamping
memory
metadata
serialization
network transfer
storage
indexing
```

Therefore tracing is not free. Suppose one request normally takes:

```text
50 ms
```

Instrumentation that adds:

```text
20 ms
```

would materially change the service. Good tracing tries to keep its measurement overhead small relative to the system being measured. This is another reason to use:

```text
sampling
batch export
asynchronous export
careful span design
```

Imagine:

```text
tracing backend unavailable
```

Should predictions stop?

Usually not. You generally want:

```text
tracing fails
      │
      ├── telemetry may be lost
      │
      └── serving continues
```

rather than:

```text
tracing backend fails
      ↓
prediction endpoint fails
```

Observability should usually not become an unnecessary critical dependency of inference. The collector and SDK should therefore be designed with failure isolation in mind. Now we encounter the same recursive problem as prediction logging. If traces are supposed to tell you what happened, how do you know the trace pipeline itself works Useful telemetry about the tracing infrastructure can include:

```text
spans generated
spans exported
spans rejected
collector queue depth
export failures
dropped spans
backend ingestion errors
sampling rates
```

Otherwise you may think:

```text
"No unusual traces exist."
```

when the real explanation is:

```text
"The collector stopped sending traces."
```

A trace backend containing billions of spans is useful only if engineers can find relevant ones. Useful searchable fields may include:

```text
service.name
operation.name
model.version
region
status
deployment.version
endpoint
hardware type
```

Then engineers can query:

```text
service = fraud-api
AND model.version = v42
AND duration > 1s
AND status = error
```

This turns tracing into an investigation tool rather than a giant archive of timelines. Suppose an alert fires:

```text
prediction API p99 > 1 second
```

Ideally the monitoring interface lets you move toward:

```text
example slow traces
```

Then a trace contains:

```text
trace_id = ABC
prediction_id = P91
```

From there:

```text
Trace
  │
  ├── related logs
  └── prediction record
```

Conceptually:

```text
                 Metrics
                    │
              "problem exists"
                    │
                    ▼
                  Trace
            "where did it happen?"
              │             │
              ▼             ▼
            Logs       Prediction record
      "what error?"    "what model decision?"
```

This is much more powerful than operating four isolated observability systems. Tracing can accidentally collect sensitive information from:

```text
HTTP headers
URLs
database queries
RPC payloads
model prompts
feature values
user identifiers
exception messages
```

Automatic instrumentation makes this particularly important. It may capture fields developers did not explicitly think about. Tracing design should therefore include:

```text
redaction
allowlists
access controls
encryption
retention rules
sampling
data classification
```

The principle is:

Capture enough context to diagnose behaviour without copying sensitive application data into observability infrastructure unnecessarily.

Instead of:

```text
prompt = "customer's entire confidential document..."
```

record:

```text
input_tokens = 4821
request_type = summarization
model_version = v7
```

Instead of:

```text
raw_features = [...]
```

record:

```text
feature_schema_version = 12
feature_count = 145
missing_feature_count = 2
```

Instead of:

```text
customer_email = ...
```

you may need no identifying value at all. Good tracing focuses on operational structure rather than indiscriminate payload capture.

## How Should a Team Choose and Test Its Tracing Stack?
<!-- section-summary: Backend choice follows query, scale, retention, integration, and governance needs, and end-to-end tests must prove context propagation and recovery paths. -->

Backend choice follows query, scale, retention, integration, and governance needs, and end-to-end tests must prove context propagation and recovery paths.

At the architecture level, a tracing stack usually has several parts:

```text
Instrumentation
      ↓
Telemetry SDK
      ↓
Collector / pipeline
      ↓
Storage / tracing backend
      ↓
Query / visualization
```

When choosing technologies, think about these layers separately. A reasonable design goal is:

```text
application instrumentation
        ↓
vendor-neutral telemetry
        ↓
replaceable backend
```

That is one reason OpenTelemetry has become important. The “best” tracing system depends on operational constraints. Questions include:

```text
How much trace volume exists

How long must traces be retained

Do we need tail sampling

How quickly must traces become searchable

Can traces correlate with existing logs and metrics

What deployment environment are we using

What data residency rules apply

How much infrastructure can the team operate

What is the cost at expected traffic
```

A Kubernetes-heavy platform may favour a different operational stack from a fully managed cloud environment. The important architectural principle is more stable than any particular vendor:

Keep instrumentation portable where practical, and choose storage/query infrastructure around operational requirements.

Adding tracing code is not enough. You need to know:

```text
Was a trace created

Did child spans inherit the right trace ID

Did context cross HTTP/gRPC/message boundaries

Did the collector receive the spans

Did sampling behave correctly

Did sensitive fields get removed

Can engineers find the trace

Are errors marked correctly
```

A simple test might deliberately send a known request:

```text
test request
      │
      ▼
prediction API
      │
      ▼
feature service
      │
      ▼
model service
```

Then verify that the backend displays:

```text
one trace
│
├── prediction API
├── feature service
└── model service
```

rather than three unrelated traces. The happy path is often the least interesting path. Deliberately test something such as:

```text
feature service timeout
```

Expected trace:

```text
Prediction request                ERROR
│
├── feature lookup               ERROR
│     ├── attempt 1              TIMEOUT
│     └── attempt 2              TIMEOUT
└── fallback                     SUCCESS
```

Now verify:

```text
error status exists
duration is sensible
retry is visible
fallback is visible
trace remains connected
```

This proves the system can explain the incidents for which tracing was built.

## How Does Tracing Connect Service Health to Model Health?
<!-- section-summary: Tracing provides causal evidence that joins service latency and failures to feature, model, release, prediction, and outcome evidence in the wider monitoring system. -->

Tracing provides causal evidence that joins service latency and failures to feature, model, release, prediction, and outcome evidence in the wider monitoring system.

This is perhaps the deepest conceptual distinction. A metric might tell you:

$$
p99Latency = 1.8s
$$

but that does not directly explain causality. A trace can reveal:

```text
database slowed
      ↓
feature lookup waited
      ↓
prediction waited
      ↓
request timed out
```

Or:

```text
new model deployed
      ↓
inference time increased
      ↓
GPU throughput decreased
      ↓
queue formed
      ↓
latency increased
```

Traces help reconstruct the **chain of operations through which a symptom emerged**. They do not mathematically prove every causal claim, but they provide much richer causal evidence than aggregate metrics alone. Consider a request with:

```text
trace_id      = T91
prediction_id = P82
model_version = v17
```

Its trace shows:

```text
feature retrieval             80 ms
inference queue              700 ms
model execution              140 ms
```

Its prediction record shows:

```text
score             = 0.92
decision          = BLOCK
feature_version   = v31
```

Its eventual outcome shows:

```text
actual outcome = legitimate
```

Now multiple dimensions can be connected:

```text
Operational behaviour
      │
      ├── latency
      ├── queueing
      └── dependency calls
      │
      ▼
Prediction event
      │
      ├── model version
      ├── score
      └── decision
      │
      ▼
Later outcome
```

This gives you an end-to-end history from **system execution** to **model behaviour** to **real-world feedback**. A useful model is:

```text
                      USER EXPERIENCE
                            │
                            ▼
                     Service Metrics
                "Is there a problem?"
                            │
                            ▼
                         Traces
             "Where did this request go?"
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
              Logs              Prediction Records
       "What happened?"       "What did ML decide?"
                │                       │
                └───────────┬───────────┘
                            ▼
                       Root Cause
                            │
                            ▼
                          Action
                            │
                            ▼
                      Measure Again
```

Each signal serves a different level of reasoning. A useful starting trace might look like:

```text
prediction_request
│
├── authentication
├── validate_request
├── fetch_features
│    ├── cache_lookup
│    └── feature_store_request
│
├── preprocess
│
├── inference
│    ├── queue_wait
│    └── model_compute
│
├── postprocess
├── business_rules
└── serialize_response
```

Useful attributes could include:

```text
service version
model version
feature version
region
endpoint
request type
batch size
hardware class
status
```

Then add spans only when real investigations demonstrate that more detail is useful. For each ML request, ask four questions.

### Where can time be spent

```text
queue
network
feature retrieval
model inference
database
postprocessing
```

These suggest span boundaries.

### Where can disruption occur

```text
feature service
model server
cache
database
policy service
```

These also suggest spans.

### Which boundaries cross ownership or processes

```text
prediction API → feature service
prediction API → model server
```

These need context propagation.

### What information would distinguish one incident pattern from another

```text
model_version
region
batch_size
hardware_type
fallback_used
```

These become safe span attributes. That gives you a trace design driven by investigation rather than instrumentation for its own sake. The deepest reason ML service tracing exists is that **end-to-end behaviour emerges from many smaller operations**. A user sees:

```text
prediction took 2 seconds
```

But inside the system:

```text
request
   │
   ▼
gateway
   │
   ▼
feature lookup
   │
   ▼
GPU queue
   │
   ▼
model inference
   │
   ▼
policy
   │
   ▼
response
```

A latency metric compresses all of that into:

```text
2 seconds
```

A trace expands it back into a causal timeline:

```text
Prediction request                  2,000 ms
│
├── gateway                            20 ms
├── feature retrieval                 90 ms
├── GPU queue                       1,650 ms  ← problem
├── inference                         180 ms
└── postprocessing                     60 ms
```

So the central idea is:

**ML service tracing preserves the execution path of an individual request so that engineers can understand where time was spent, where failures occurred, how distributed components interacted, and how operational behaviour relates to a particular model prediction.**

And the larger monitoring-and-feedback loop becomes:

```text
Production request
       │
       ▼
Metrics detect a symptom
       │
       ▼
Trace identifies the path
       │
       ▼
Logs and prediction records
provide detailed evidence
       │
       ▼
Root cause identified
       │
       ▼
System or model changed
       │
       ▼
Monitoring verifies improvement
```

That is tracing from the underlying mechanism: **preserve the path of work so that a complex distributed prediction can later be understood as one coherent story.**

![ML tracing incident summary from a candidate-route latency alert through one representative trace, gpu-l4-b memory evidence, containment, repair, small canary, and staged release decision](/content-assets/articles/article-mlops-monitoring-and-feedback-tracing-ml-services/tracing-incident-recovery-summary.png)

*Metrics locate the affected population; one trace identifies candidate inference as the slow operation; logs, resources, and release evidence support repair. A small canary must pass the original latency, memory, fallback, and trace checks before staged rollout continues.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[How Does a Trace Explain One ML Request across Services?]{kind="recap"}
A distributed trace turns one prediction request into a causal timeline of spans, while trace IDs, prediction IDs, metrics, and logs retain distinct jobs.
:::

:::expand[How Should Trace Context, Spans, and Attributes Cross Boundaries?]{kind="recap"}
Trace context must propagate across process and protocol boundaries, and spans should mark risk or latency boundaries with bounded, safe attributes.
:::

:::expand[How Do Automatic Instrumentation, Manual Spans, and Collectors Fit Together?]{kind="recap"}
Automatic instrumentation covers common frameworks, manual spans expose ML-specific work, and a collector separates applications from storage and routing concerns.
:::

:::expand[How Should Sampling Preserve the Traces Most Useful for Investigation?]{kind="recap"}
Random, head, and tail sampling make different tradeoffs; whichever policy is used must preserve complete traces and the rare failures worth investigating.
:::

:::expand[What Do Online, Release, Batch, and LLM Traces Reveal?]{kind="recap"}
Concrete traces localize slow requests, release regressions, batch steps, queues, and specialized LLM work while connecting symptoms to the version that caused them.
:::

:::expand[How Do You Control Span Detail, Overhead, Failure, Searchability, and Sensitive Data?]{kind="recap"}
Useful tracing balances diagnostic span boundaries against cardinality, privacy, storage, overhead, graceful failure, and the health of the telemetry pipeline itself.
:::

:::expand[How Should a Team Choose and Test Its Tracing Stack?]{kind="recap"}
Backend choice follows query, scale, retention, integration, and governance needs, and end-to-end tests must prove context propagation and recovery paths.
:::

:::expand[How Does Tracing Connect Service Health to Model Health?]{kind="recap"}
Tracing provides causal evidence that joins service latency and failures to feature, model, release, prediction, and outcome evidence in the wider monitoring system.
:::
