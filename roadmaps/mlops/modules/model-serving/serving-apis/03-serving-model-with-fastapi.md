---
title: "Serving a Model with FastAPI"
description: "Build a production-oriented FastAPI inference boundary with model lifecycle, typed contracts, controlled execution, probes, telemetry, container configuration, tests, and rollback."
overview: "FastAPI supplies the HTTP application boundary around inference and connects it to model loading, prediction services, execution capacity, observability, security, deployment, and release evidence."
tags: ["MLOps", "production", "serving"]
order: 3
id: "article-mlops-model-serving-serving-model-with-fastapi"
aliases:
  - roadmaps/mlops/modules/model-serving/serving-apis/01-serving-model-with-fastapi.md
  - child-serving-apis-01-serving-model-with-fastapi
---

## Table of Contents

1. [How Does One Prediction Travel through a FastAPI Model Service?](#how-does-one-prediction-travel-through-a-fastapi-model-service)
2. [How Do Async, Threads, Processes, Batching, and Concurrency Match the Workload?](#how-do-async-threads-processes-batching-and-concurrency-match-the-workload)
3. [How Do Startup, Readiness, Liveness, and Warmup Protect Traffic?](#how-do-startup-readiness-liveness-and-warmup-protect-traffic)
4. [Which Traces and Metrics Explain Tail Latency and Throughput?](#which-traces-and-metrics-explain-tail-latency-and-throughput)
5. [How Do Containers, Workers, GPUs, Autoscaling, Backpressure, and Shutdown Own Resources?](#how-do-containers-workers-gpus-autoscaling-backpressure-and-shutdown-own-resources)
6. [How Should a Request Handler, Scheduler Boundary, Capacity Model, and Streaming Path Fit Together?](#how-should-a-request-handler-scheduler-boundary-capacity-model-and-streaming-path-fit-together)
7. [What Belongs inside FastAPI, and How Should the Architecture Evolve?](#what-belongs-inside-fastapi-and-how-should-the-architecture-evolve)
8. [What Complete Mental Model Keeps the API Separate from Inference Scheduling?](#what-complete-mental-model-keeps-the-api-separate-from-inference-scheduling)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A FastAPI endpoint can load a model and return a prediction in a few lines. Under concurrent traffic, that same service may load one model per worker, block the event loop with CPU work, exhaust GPU memory, or declare readiness before warmup completes.

FastAPI provides the web boundary: HTTP parsing, validation, routing, and responses. It does not decide how scarce CPU or GPU inference should be scheduled. A production design therefore follows one request through concurrency, lifecycle, observability, capacity, backpressure, and graceful shutdown.

These questions build that service from a minimal endpoint to a clear API-server and inference-scheduler boundary:

1. **How Does One Prediction Travel through a FastAPI Model Service?**
2. **How Do Async, Threads, Processes, Batching, and Concurrency Match the Workload?**
3. **How Do Startup, Readiness, Liveness, and Warmup Protect Traffic?**
4. **Which Traces and Metrics Explain Tail Latency and Throughput?**
5. **How Do Containers, Workers, GPUs, Autoscaling, Backpressure, and Shutdown Own Resources?**
6. **How Should a Request Handler, Scheduler Boundary, Capacity Model, and Streaming Path Fit Together?**
7. **What Belongs inside FastAPI, and How Should the Architecture Evolve?**
8. **What Complete Mental Model Keeps the API Separate from Inference Scheduling?**

## How Does One Prediction Travel through a FastAPI Model Service?
<!-- section-summary: FastAPI handles HTTP parsing, validation, routing, and responses around a model loaded once, while larger designs may separate API and inference processes or services. -->

A small service is easiest to understand by tracing one request from validation through model execution to its response.

Serving a model with FastAPI is easiest to understand by ignoring FastAPI for a moment and asking:

**What must happen between “a client wants a prediction” and “the client receives one”?**

At minimum:

```text
client request
    ↓
receive bytes
    ↓
understand the request
    ↓
validate it
    ↓
convert it into model input
    ↓
find compute capacity
    ↓
run inference
    ↓
convert model output
    ↓
send response
```

FastAPI helps with the **network/API side** of this pipeline. It does not, by itself, solve GPU scheduling, batching, model parallelism, memory management, or inference optimization. That distinction is the foundation. Suppose we have a model:

```python
def predict(x):
    return x * 2
```

Locally, calling it is easy:

```python
result = predict(5)
```

But another machine cannot call a Python function inside your process. It knows how to do something like:

```text
POST /predict

{
  "x": 5
}
```

So we need an adapter:

```text
HTTP world                 Python/model world

POST /predict
{"x": 5}
       │
       ▼
   FastAPI
       │
       ▼
      x=5
       │
       ▼
   model(x)
       │
       ▼
      10
       │
       ▼
   FastAPI
       │
       ▼
{"prediction": 10}
```

That is FastAPI's basic role. A useful mental model is:

```text
FastAPI = interface layer around your serving logic
```

It gives you things like:

```text
HTTP routing
request parsing
schema validation
response serialization
dependency injection
error handling
OpenAPI documentation
async request handling
application startup/shutdown hooks
```

For example:

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class PredictionRequest(BaseModel):
    text: str

@app.post("/predict")
def predict(request: PredictionRequest):
    result = model.predict(request.text)
    return {"prediction": result}
```

FastAPI takes care of a lot here:

```text
HTTP bytes
    ↓
JSON decoding
    ↓
request object validation
    ↓
PredictionRequest
    ↓
your function
    ↓
Python dictionary
    ↓
JSON response
```

But an important distinction is hiding underneath. FastAPI is an **ASGI application framework**. A server such as Uvicorn typically owns the network socket and runs the event loop that actually receives requests and invokes the FastAPI application. ([FastAPI][1]) So conceptually:

```text
Internet
   ↓
Uvicorn
   ↓
FastAPI
   ↓
your serving code
   ↓
model
```

That distinction matters when diagnosing latency and concurrency. Consider:

```text
POST /predict
```

with:

```json
{
  "text": "The movie was fantastic"
}
```

Let's trace exactly what happens.

### Step 1: the request reaches your server

A TCP connection eventually delivers HTTP bytes to the server.

Conceptually:

```text
network
   ↓
Uvicorn / ASGI server
```

The server doesn't yet care that you're running a transformer. It sees an HTTP request.

### Step 2: FastAPI finds the route

FastAPI sees:

```text
POST /predict
```

and matches it to:

```python
@app.post("/predict")
def predict(...):
    ...
```

This is routing.

### Step 3: the body is parsed

The bytes:

```text
{"text":"The movie was fantastic"}
```

become Python data. Then your request schema establishes useful invariants.

For example:

```python
class PredictionRequest(BaseModel):
    text: str
```

means downstream code doesn't have to deal with:

```json
{"text": 493849}
```

as if it were valid model input.

### Step 4: preprocessing happens

A language model normally cannot consume strings directly. You might do:

```python
tokens = tokenizer(request.text)
```

producing something conceptually like:

```text
"The movie was fantastic"

        ↓ tokenizer

[101, 1996, 3185, 2001, 10392, 102]
```

For an image model:

```text
JPEG bytes
    ↓
decode
    ↓
resize
    ↓
normalize
    ↓
tensor
```

Preprocessing is part of serving latency. It is easy to overlook because it isn't "the model." Eventually:

```python
output = model(tokens)
```

This might consume:

```text
CPU
GPU
TPU
accelerator memory
memory bandwidth
```

The model produces tensors:

```text
[0.03, 0.97]
```

Then you might transform those into:

```json
{
  "label": "positive",
  "confidence": 0.97
}
```

Finally FastAPI serializes the response and the HTTP server sends it back. So the real latency is approximately:

$$
T_{request}
=
T_{network}
+T_{parse}
+T_{validate}
+T_{preprocess}
+T_{queue}
+T_{inference}
+T_{postprocess}
+T_{serialize}
+T_{network-response}
$$

Not merely:

$$
T_{request}=T_{model}
$$

That difference becomes extremely important in production. A first implementation might accidentally do this:

```python
@app.post("/predict")
def predict(request):
    model = load_model()
    return model(request.text)
```

Suppose:

```text
load model       = 8 seconds
prediction       = 100 ms
```

Then every request takes roughly:

```text
8.1 seconds
```

That's absurd because model weights normally don't change between requests. Instead, model loading should happen approximately once per serving process:

```text
process starts
     ↓
load model
     ↓
warm model
     ↓
serve request
     ↓
serve request
     ↓
serve request
     ↓
...
```

FastAPI provides application lifespan handling specifically for shared resources such as machine-learning models: initialize before serving requests and clean up during shutdown. ([FastAPI][2])

For example:

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI


model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model

    model = load_model()
    warm_up(model)

    yield

    del model


app = FastAPI(lifespan=lifespan)
```

Then:

```python
@app.post("/predict")
def predict(request: PredictionRequest):
    return model.predict(request.text)
```

The important principle isn't the particular Python syntax. It's:

> **Separate expensive model initialization from per-request work.**

There are several fundamentally different architectures.

### Architecture A: model inside the FastAPI process

```text
Client
   ↓
FastAPI process
   ├── HTTP handling
   ├── tokenizer
   └── model
          ↓
         GPU
```

This is wonderfully simple. You can deploy:

```text
app.py
model weights
FastAPI
Uvicorn
```

as one container. Good for:

```text
small models
low traffic
simple services
prototypes
CPU models
one-model-per-GPU deployments
```

But FastAPI and inference now share the same process. Another design:

```text
               ┌────────────────┐
Client ───────→│ FastAPI        │
               │ API service    │
               └───────┬────────┘
                       │
                       │ RPC
                       ▼
               ┌────────────────┐
               │ Model runtime  │
               │ / inference    │
               │ server         │
               └───────┬────────┘
                       ▼
                      GPU
```

FastAPI handles:

```text
authentication
request schemas
business logic
rate limits
API compatibility
```

The inference server handles:

```text
model weights
GPU memory
batching
scheduling
KV cache
tensor parallelism
inference execution
```

This is often preferable for large generative models. Why? Because HTTP application concurrency and GPU inference scheduling are different problems. You might want:

```text
20 API replicas
```

but only:

```text
4 GPUs
```

There is no reason those numbers must be equal. You can go one step further:

```text
Client
   ↓
your FastAPI API
   ↓
remote inference endpoint
   ↓
model
```

Now your FastAPI layer contains no model weights at all. Its work might be:

```python
@app.post("/predict")
async def predict(request):
    result = await inference_client.predict(request)
    return result
```

This is architecturally very different from running PyTorch directly inside the endpoint. And that brings us to concurrency.

## How Do Async, Threads, Processes, Batching, and Concurrency Match the Workload?
<!-- section-summary: Async helps waiting I/O, threads and processes create other concurrency boundaries, batching combines work, and scarce model resources require deliberate limits. -->

The expensive inference step determines whether waiting I/O, CPU work, GPU ownership, or batching should shape concurrency.

Imagine a single worker receives request A. A does this:

```text
call remote database
wait 100 ms
```

During those 100 ms, the CPU isn't actually computing anything. It is waiting. Without concurrency:

```text
A: compute ───── WAIT ───── compute
B:                              compute...
```

The waiting period is wasted. Async allows something closer to:

```text
A: compute ───── WAIT ───── compute
B:          compute ─ WAIT ───── compute
C:                  compute ...
```

The same thread can make progress on other requests while A waits for I/O. This makes `async` extremely useful for:

```text
network calls
database calls
object storage
remote inference calls
async file/network I/O
```

FastAPI supports both `async def` and ordinary `def` path operations; its documentation recommends choosing according to whether the underlying operations are awaitable or blocking. ([FastAPI][3]) This mistake causes a lot of bad model-serving designs. Suppose:

```python
@app.post("/predict")
async def predict(request):
    result = extremely_expensive_python_computation()
    return result
```

Adding:

```python
async
```

doesn't magically produce:

```text
16 CPU cores
```

Async primarily addresses **concurrency while waiting**. Compare:

```text
I/O-bound:

request
   ↓
send network request
   ↓
WAIT                ← async can exploit this
   ↓
receive response
```

versus:

```text
CPU-bound:

request
   ↓
compute
compute
compute             ← CPU is actually occupied
compute
compute
```

There is no waiting period for the event loop to exploit. So:

**Async is principally a mechanism for efficiently interleaving waiting tasks, not a mechanism for making heavy computation run faster.**

Suppose you have blocking code:

```python
result = some_blocking_library()
```

If it blocks the event-loop thread, other asynchronous requests may be unable to progress. One solution is a thread:

```text
event loop
   │
   ├─ Request A → worker thread ─── blocking operation
   │
   ├─ Request B
   ├─ Request C
   └─ ...
```

FastAPI itself can run ordinary synchronous `def` path operations using its thread-pool machinery rather than directly on the event loop. ([FastAPI][3]) Threads are particularly useful for:

```text
blocking I/O
libraries without async APIs
native libraries that release Python's GIL
```

But threads aren't automatically ideal for arbitrary Python CPU work. For pure Python computation, the Global Interpreter Lock means multiple threads generally don't execute Python bytecode simultaneously inside one process.

Conceptually:

```text
Thread A ──Python──┐
                   │ one at a time
Thread B ──Python──┤
                   │
Thread C ──Python──┘
```

So if your workload is genuinely CPU-bound Python:

```text
feature engineering
custom loops
large pure-Python algorithms
```

threads don't necessarily give CPU parallelism. Processes can. You can run:

```text
Process 1 → CPU core
Process 2 → CPU core
Process 3 → CPU core
Process 4 → CPU core
```

Each process has its own Python interpreter. So CPU-bound work can execute in parallel. FastAPI/Uvicorn deployments can use multiple worker processes. ([FastAPI][4]) For an ordinary API, that might be excellent. For model serving, however, there is a giant caveat. Imagine your model requires:

```text
8 GB memory
```

One worker:

```text
Worker 1
  └─ model = 8 GB
```

Four workers can conceptually become:

```text
Worker 1 → 8 GB
Worker 2 → 8 GB
Worker 3 → 8 GB
Worker 4 → 8 GB

total ≈ 32 GB
```

FastAPI's deployment documentation explicitly warns that processes have separate memory, so loading a large model in several workers can multiply memory usage. ([FastAPI][4]) For a GPU this can be worse:

```text
GPU VRAM = 24 GB
model = 12 GB
```

Then:

```text
4 workers × 12 GB
```

obviously cannot fit on one 24 GB GPU. So the standard web-server instinct:

"More workers = more throughput."

is not universally valid for model serving. Suppose your GPU can efficiently process:

```text
one large inference workload at a time
```

Starting 32 FastAPI threads doesn't create:

```text
32 GPUs
```

You still have:

```text
32 request handlers
          ↓
        queue
          ↓
        1 GPU
```

The scarce resource determines capacity. This is the queueing structure:

```text
incoming requests
  ↓ ↓ ↓ ↓ ↓ ↓
┌───────────────┐
│     queue     │
└───────┬───────┘
        ↓
┌───────────────┐
│ inference     │
│ resource      │
└───────────────┘
```

Concurrency at the API level cannot eliminate the bottleneck. It can merely determine how efficiently requests wait for it. Imagine GPU inference needs:

```text
4 GB temporary memory/request
```

and you allow 100 requests to enter inference simultaneously. You might get:

```text
GPU out of memory
```

rather than high throughput. A concurrency guard can establish:

```text
at most N inference operations at once
```

Conceptually:

```python
semaphore = Semaphore(4)

async def predict(...):
    async with semaphore:
        return await inference(...)
```

Now:

```text
100 incoming requests
      ↓
  FastAPI
      ↓
   queue
      ↓
maximum 4 admitted
      ↓
     GPU
```

A good model service does not merely accept concurrency. It **controls** it. Suppose running one prediction takes:

```text
10 ms
```

You might expect 8 predictions to take:

```text
80 ms
```

But GPUs are highly parallel. Perhaps:

```text
batch size 1  → 10 ms
batch size 8  → 18 ms
```

Then instead of:

```text
R1 → GPU
R2 → GPU
R3 → GPU
R4 → GPU
```

you can do:

```text
R1 ┐
R2 │
R3 ├── batch → GPU
R4 │
R5 ┘
```

This trades some queueing delay for higher throughput. That is why mature inference systems often have a dedicated scheduler or batcher rather than letting arbitrary FastAPI workers independently call the GPU. A useful comparison is:

| Work                              | Usually useful mechanism                |
| --------------------------------- | --------------------------------------- |
| Waiting on remote model API       | `async`                                 |
| Waiting on database/network       | `async`                                 |
| Blocking I/O library              | thread                                  |
| Native numeric code releasing GIL | threads may work                        |
| Heavy pure-Python CPU code        | processes                               |
| Large GPU model                   | controlled inference scheduler/batching |
| Multi-GPU giant LLM               | specialized inference runtime           |

The mistake is starting from:

```text
Should I use async
```

Start instead from:

**What resource is occupied while this request is in progress?**

Then pick concurrency accordingly.

![A transaction-risk request moving from the client through the gateway, Pydantic validation, feature and preprocessing service, immutable model, decision policy, and typed response under one trace.](/content-assets/articles/article-mlops-model-serving-serving-model-with-fastapi/fastapi-prediction-path.png)

*FastAPI owns the typed HTTP boundary while the prediction service, model, and policy remain explicit stages whose latency and release identities can be traced together.*

## How Do Startup, Readiness, Liveness, and Warmup Protect Traffic?
<!-- section-summary: Startup loads dependencies, readiness confirms the warmed prediction path can serve, and liveness decides whether a stuck process should restart. -->

Before any concurrency is useful, each process must load and warm the model and advertise the correct lifecycle state.

Suppose the container process starts at:

```text
12:00:00
```

FastAPI exists immediately. But then:

```text
download model     20 sec
load weights       15 sec
initialize CUDA     5 sec
warm kernels        5 sec
```

The model isn't truly usable until:

```text
12:00:45
```

So:

```text
process exists
```

does not imply:

```text
service can serve predictions
```

We need different health concepts. Think of them this way.

### Startup

**Has initialization completed?**

For example:

```text
weights loaded
tokenizer loaded
GPU initialized
warmup complete
```

Until this succeeds, the application is still booting.

### Readiness

**Should new user traffic be sent here?**

A readiness endpoint might conceptually answer:

```text
model loaded             ✓
serving pool initialized ✓
required dependency      ✓
accepting requests       ✓
```

Then:

```text
ready = true
```

A load balancer can send traffic. If a replica is draining or cannot currently serve correctly:

```text
ready = false
```

Traffic should go elsewhere.

### Liveness

**Is the application fundamentally alive, or should it be restarted?**

For example:

```text
HTTP event loop responsive
process healthy
fatal serving loop still running
```

A transient dependency outage should not necessarily make liveness fail. Why? Imagine:

```text
database unavailable
        ↓
liveness fails
        ↓
container restarts
        ↓
database still unavailable
        ↓
liveness fails
        ↓
restart
        ↓
...
```

You've created a restart storm without fixing the database. So a useful distinction is:

```text
readiness failure
    → stop sending traffic

liveness failure
    → restart me
```

These should not mean the same thing.

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


model = None
ready = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, ready

    model = load_model()
    warm_up(model)
    ready = True

    yield

    ready = False
    model = None


app = FastAPI(lifespan=lifespan)


class PredictionRequest(BaseModel):
    text: str


@app.get("/live")
def live():
    return {"status": "alive"}


@app.get("/ready")
def readiness():
    if not ready:
        raise HTTPException(status_code=503, detail="not ready")

    return {"status": "ready"}


@app.post("/predict")
def predict(request: PredictionRequest):
    if not ready:
        raise HTTPException(status_code=503, detail="not ready")

    prediction = model.predict(request.text)

    return {"prediction": prediction}
```

Real production systems normally have more sophisticated health behavior, but the separation is what matters. The first model call can behave differently from subsequent calls.

For example:

```text
load model        4 sec
first inference   3 sec
later inference   100 ms
```

Why? Potential initialization might include:

```text
CUDA context creation
memory allocation
kernel loading
JIT compilation
graph compilation
cache creation
```

So after:

```python
model = load_model()
```

you may perform:

```python
model(dummy_input)
```

before declaring readiness.

Conceptually:

```text
load
  ↓
initialize
  ↓
warm
  ↓
READY
```

not:

```text
load
  ↓
READY
  ↓
first customer pays startup cost
```

## Which Traces and Metrics Explain Tail Latency and Throughput?
<!-- section-summary: Correlation traces follow one prediction across layers, while latency distributions, queue time, throughput, errors, and resource metrics expose different bottlenecks. -->

Once traffic arrives, traces and distributions must show where requests wait and which resource limits throughput.

Suppose a customer says:

"Predictions are taking two seconds."

A single metric:

```text
request_latency = 2 seconds
```

doesn't tell you why. You want to decompose the path.

For example:

```text
total request       2000 ms

validation             2 ms
tokenization           30 ms
queue wait           1300 ms
GPU inference          500 ms
postprocessing          20 ms
serialization            3 ms
other                  145 ms
```

Now the diagnosis is obvious:

```text
model isn't necessarily slow
queueing is slow
```

Without stage-level instrumentation, someone might waste weeks optimizing CUDA kernels. Give each prediction something like:

```text
request_id = abc123
```

Then logs can show:

```text
abc123 request_received
abc123 validation_complete      2 ms
abc123 preprocessing_complete  31 ms
abc123 inference_queued
abc123 inference_started
abc123 inference_complete     497 ms
abc123 response_sent
```

If inference is a separate service:

```text
FastAPI
    trace abc123
        ↓
Inference service
    trace abc123
        ↓
GPU scheduler
    trace abc123
```

The trace survives across boundaries. Then one slow request can be reconstructed end to end. Metrics tell you:

```text
p50 latency = 220 ms
p95 latency = 600 ms
p99 latency = 2.4 sec

requests/sec = 140
errors/sec = 0.2

GPU utilization = 91%
queue depth = 42
```

They answer:

**Is the system behaving normally?**

Traces tell you:

```text
request xyz spent
1.7 sec waiting for inference
```

They answer:

**Why did this particular request behave this way?**

Logs tell you discrete events and debugging details. A production service generally benefits from all three:

```text
metrics
traces
logs
```

Suppose:

```text
99 requests = 100 ms
1 request   = 10 seconds
```

Average latency is roughly:

```text
199 ms
```

which doesn't sound terrible. But one in every hundred users experiences:

```text
10 seconds
```

So model-serving dashboards should usually care about percentiles:

```text
p50
p90
p95
p99
```

rather than only averages. Queueing problems show up especially strongly in high percentiles. Suppose you collect requests for batching. Waiting:

```text
20 ms
```

might let you form:

```text
batch size 16
```

and substantially increase GPU utilization. But every request now pays an extra:

```text
≤20 ms
```

of batching delay. So:

```text
larger batches
    ↓
better throughput

but potentially
    ↓
higher latency
```

Serving design is therefore an optimization problem:

$$
\text{maximize throughput}
$$

subject to something like:

$$
p99\ latency < 500\text{ ms}
$$

rather than simply:

```text
make batch size enormous
```

## How Do Containers, Workers, GPUs, Autoscaling, Backpressure, and Shutdown Own Resources?
<!-- section-summary: Worker count follows model ownership; CPU and GPU services scale differently, and bounded queues, timeouts, graceful shutdown, and bottleneck-aware autoscaling protect capacity. -->

Those measurements drive worker, container, GPU, autoscaling, queue, timeout, and shutdown decisions.

Now imagine packaging the service in Docker. A simple deployment might be:

```text
┌──────────────────────────────┐
│ Container                    │
│                              │
│ Uvicorn                      │
│    ↓                         │
│ FastAPI                      │
│    ↓                         │
│ model                        │
│    ↓                         │
│ GPU                          │
└──────────────────────────────┘
```

This is easy to understand and operate. A common pattern for a GPU-backed service is approximately:

```text
one container
one serving process
one loaded model
one GPU
```

Not because this is a universal rule, but because resource ownership is extremely clear. Suppose:

```text
machine = 16 CPU cores
model = 500 MB
RAM = 64 GB
```

You might run several worker processes:

```text
              ┌─ Worker 1 → model
requests ─────┼─ Worker 2 → model
              ├─ Worker 3 → model
              └─ Worker 4 → model
```

Now genuine CPU work can occur across cores. But watch for another subtle problem:

```text
4 processes
× 8 internal BLAS threads each
= 32 computational threads
```

on:

```text
16 CPU cores
```

This can create oversubscription and make performance worse. So you must reason not only about:

```text
FastAPI worker count
```

but also:

```text
PyTorch threads
NumPy/BLAS threads
tokenizer threads
OpenMP threads
```

Concurrency multiplies across layers. Suppose:

```text
GPU memory = 24 GB
model weights = 18 GB
```

This:

```text
4 FastAPI workers
```

may mean four attempts to initialize an 18 GB model. That cannot work. Instead you might use:

```text
Container
   ↓
1 FastAPI process
   ↓
1 model copy
   ↓
1 GPU
```

and scale horizontally:

```text
load balancer
   │
   ├── replica 1 → GPU 1
   ├── replica 2 → GPU 2
   ├── replica 3 → GPU 3
   └── replica 4 → GPU 4
```

Now each replica owns a coherent unit of compute. For a larger architecture:

```text
                    ┌─ API replica
Client → LB ────────┼─ API replica
                    ├─ API replica
                    └─ API replica
                          │
                          ▼
                    request queue
                          │
                    ┌─────┴─────┐
                    ▼           ▼
               GPU worker   GPU worker
```

Now:

```text
API replicas
```

can scale according to:

```text
HTTP traffic
auth processing
network concurrency
```

while:

```text
GPU workers
```

scale according to:

```text
inference queue
GPU utilization
tokens/sec
```

That separation is often powerful. A normal web service might scale based on:

```text
CPU utilization
```

But imagine an LLM server:

```text
CPU = 15%
GPU = 100%
queue = 200 requests
```

CPU-based autoscaling says:

```text
everything is fine
```

while users are waiting. For model serving, useful scaling signals may instead be:

```text
queue depth
queue wait time
GPU utilization
active sequences
tokens/sec
requests/sec
KV-cache utilization
p95/p99 latency
```

The scaling metric should correspond to the actual bottleneck. Imagine:

```text
service capacity = 100 requests/sec
incoming load    = 500 requests/sec
```

If every request is accepted into an unbounded queue:

```text
second 1 → +400 waiting
second 2 → +800
second 3 → +1200
...
```

Eventually:

```text
latency explodes
memory grows
timeouts cascade
service collapses
```

A healthy service eventually says:

```text
I cannot accept more work right now.
```

That might involve:

```text
bounded queue
concurrency limit
429 / 503 response
load shedding
client retry policy
```

Rejecting some requests quickly can be better than accepting everything and completing nothing reliably. Suppose:

```text
Client timeout              = 5 sec
FastAPI → model timeout     = 60 sec
```

If the client disappears after five seconds but inference continues for another 55 seconds, you're spending GPU resources producing a response nobody wants. Good systems think about:

```text
client timeout
gateway timeout
application timeout
queue timeout
inference timeout
downstream timeout
```

and ideally propagate cancellation where supported. Again, model serving is not simply:

```python
output = model(input)
```

It's resource management around that operation. Suppose a deployment replaces an old container. Bad sequence:

```text
SIGTERM
   ↓
process disappears
   ↓
50 active requests fail
```

Better:

```text
mark not ready
      ↓
load balancer stops new traffic
      ↓
finish or cancel existing requests
      ↓
release model/GPU resources
      ↓
exit
```

This is called draining. The lifecycle becomes:

```text
STARTING
   ↓
READY
   ↓
SERVING
   ↓
DRAINING
   ↓
STOPPED
```

That is a better mental model than simply:

```text
process on / process off
```

![FastAPI application lifecycle loading and verifying a model before readiness, alongside a separate request-capacity path with bounded workers and overload responses.](/content-assets/articles/article-mlops-model-serving-serving-model-with-fastapi/lifecycle-capacity-controls.png)

*Startup, readiness, and liveness govern whether a replica may serve; concurrency and backpressure govern how much prediction work an already-ready replica may admit.*

## How Should a Request Handler, Scheduler Boundary, Capacity Model, and Streaming Path Fit Together?
<!-- section-summary: A boring handler delegates scheduling, and capacity uses work units; LLM token generation and streaming add time-to-first-token and long-lived connection concerns. -->

The request handler stays simple when a clear scheduler boundary owns scarce work and the capacity model reflects real units such as tokens.

Your API endpoint ideally does not contain the entire serving system:

```python
@app.post("/predict")
async def predict(request: PredictionRequest):
    validated = validate_request(request)

    result = await predictor.predict(validated)

    return PredictionResponse.from_result(result)
```

The interesting complexity can live behind:

```text
predictor.predict(...)
```

Maybe today:

```text
predictor
    ↓
local PyTorch model
```

Tomorrow:

```text
predictor
    ↓
dedicated GPU process
```

Later:

```text
predictor
    ↓
remote inference cluster
```

Your HTTP contract doesn't need to change. This separation is valuable. A clean architecture could look like:

```text
┌─────────────────────────────┐
│ API layer                   │
│ FastAPI routes              │
│ auth                        │
│ HTTP errors                 │
├─────────────────────────────┤
│ Application layer           │
│ validation                  │
│ prediction orchestration    │
│ business rules              │
├─────────────────────────────┤
│ Inference abstraction       │
│ Predictor                   │
├─────────────────────────────┤
│ Runtime                     │
│ PyTorch / ONNX / remote     │
│ inference server            │
├─────────────────────────────┤
│ Compute                     │
│ CPU / GPU / accelerator     │
└─────────────────────────────┘
```

FastAPI belongs primarily at the top. That's a useful architectural constraint because it prevents your entire inference stack from becoming tangled into route handlers. This distinction is worth emphasizing. FastAPI/Uvicorn can efficiently manage:

```text
HTTP connection A
HTTP connection B
HTTP connection C
...
```

But an LLM inference scheduler needs to manage things like:

```text
sequence A has generated 42 tokens
sequence B has generated 301 tokens
sequence C is waiting
KV cache has 7 GB free
request D can join this decoding iteration
request E should wait
```

Those are radically different scheduling problems. So for sufficiently sophisticated workloads:

```text
FastAPI
```

should remain the front door, while a specialized inference runtime owns the model. Suppose one model replica can sustain:

```text
μ = 40 requests/second
```

and incoming traffic is:

```text
λ = 38 requests/second
```

Utilization is approximately:

$$
\rho = \frac{\lambda}{\mu}
$$

so:

$$
\rho = \frac{38}{40}=0.95
$$

You're at 95% capacity. Even though:

```text
38 < 40
```

queueing latency can become very high as utilization approaches saturation. The service might look healthy at average load while p99 latency becomes terrible. This is why production systems typically need headroom. Roughly:

```text
capacity exactly equal to demand
```

is not a robust serving strategy. Consider:

```text
Request A:
10 input tokens
10 output tokens

Request B:
100,000 input tokens
8,000 output tokens
```

Both count as:

```text
1 request
```

but they have radically different costs. For generative serving, useful units include:

```text
input tokens/sec
output tokens/sec
total tokens/sec
active sequences
KV-cache occupancy
time to first token
inter-token latency
```

So tracing only:

```text
requests/sec
```

can hide what's actually happening. For a traditional classifier:

```text
request
  ↓
compute
  ↓
complete response
```

One latency number may be enough. For a streaming language model:

```text
request
   ↓
prefill
   ↓
token 1
   ↓
token 2
   ↓
token 3
   ↓
...
```

User experience has at least two important dimensions.

### Time to first token

$$
TTFT
$$

How long until the model starts responding?

### Inter-token latency

How quickly subsequent tokens arrive.

For example:

```text
Service A:
TTFT = 200 ms
tokens = 30 tokens/sec

Service B:
TTFT = 4 sec
tokens = 100 tokens/sec
```

Which feels faster depends on the application. Your observability should match the model's interaction pattern. An LLM can produce:

```text
token 1
token 2
token 3
...
```

rather than waiting for the entire completion. FastAPI can expose streaming responses so the network layer forwards chunks as they become available.

Conceptually:

```text
model
  │
  ├─ token → client
  ├─ token → client
  ├─ token → client
  └─ token → client
```

Now connection handling can be long-lived, making efficient I/O concurrency particularly relevant. But again:

```text
async HTTP delivery
```

doesn't make:

```text
GPU token generation
```

faster. They're separate concerns.

## What Belongs inside FastAPI, and How Should the Architecture Evolve?
<!-- section-summary: FastAPI should own the public web contract and lightweight coordination, while dedicated schedulers or serving systems take over batching and scarce accelerator work as scale grows. -->

As workload grows, the architecture can move inference scheduling out of the web process without changing the public contract.

A useful division is:

### FastAPI/API concerns

```text
routes
request schemas
authentication
authorization
rate limits
request IDs
HTTP error mapping
streaming transport
API versioning
health endpoints
```

### Serving concerns

```text
model loading
tokenization
pre/postprocessing
batching
inference
concurrency control
timeouts
resource admission
```

### Infrastructure concerns

```text
replicas
containers
GPUs
autoscaling
load balancing
deployment rollout
logging/tracing backend
```

They interact, but keeping them conceptually separate makes design decisions much easier. A small project can reasonably start:

```text
Stage 1

Client
  ↓
FastAPI + model
  ↓
CPU/GPU
```

Then traffic increases:

```text
Stage 2

Client
  ↓
load balancer
  ↓
FastAPI+model replicas
  ↓
one compute resource each
```

Then the model becomes sophisticated:

```text
Stage 3

Client
  ↓
FastAPI API layer
  ↓
inference service / scheduler
  ↓
GPU pool
```

You don't need Stage 3 architecture on day one. But understanding the boundaries makes migration possible. When deciding whether something should happen:

```text
inside FastAPI
inside a thread
inside another process
inside an inference server
inside another container
```

ask:

**What resource owns this work, and what happens when many requests do it simultaneously?**

For example:

```text
remote API call
→ network wait
→ async

blocking disk library
→ blocked thread
→ thread pool

pure Python CPU transformation
→ CPU
→ processes may help

GPU inference
→ GPU memory + compute
→ bounded concurrency / batching

large LLM
→ complex GPU scheduling
→ specialized model runtime often makes sense
```

This reasoning is more durable than memorizing a deployment recipe.

## What Complete Mental Model Keeps the API Separate from Inference Scheduling?
<!-- section-summary: The API server translates product requests, the inference scheduler allocates model work, and the model runtime executes it under explicit lifecycle and capacity controls. -->

The final model separates HTTP concerns, scheduling, and runtime execution so each layer can scale and fail predictably.

The whole system can be pictured as:

```text
                         INTERNET
                            │
                            ▼
                  ┌──────────────────┐
                  │ Load balancer    │
                  └────────┬─────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Uvicorn / HTTP     │
                 │ server             │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ FastAPI            │
                 │                    │
                 │ routing            │
                 │ validation         │
                 │ authentication     │
                 │ API contract       │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Prediction layer   │
                 │                    │
                 │ preprocessing      │
                 │ admission control  │
                 │ timeout            │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Scheduler / queue  │
                 │                    │
                 │ concurrency        │
                 │ batching           │
                 └─────────┬──────────┘
                           │
                           ▼
                 ┌────────────────────┐
                 │ Model runtime      │
                 │                    │
                 │ model weights      │
                 │ inference          │
                 └─────────┬──────────┘
                           │
                           ▼
                     CPU / GPU
```

For a small application, several of these boxes might exist in one Python process. For a large serving platform, each could be a separate system. The concepts remain the same. FastAPI does **not** turn a model into a production serving system simply because you write:

```python
@app.post("/predict")
def predict(...):
    return model(...)
```

It solves one important part of the problem:

```text
network request
       ↓
well-defined Python operation
       ↓
network response
```

Around that, you still have to reason about:

```text
             What accepts the request
                       ↓
             Is the request valid
                       ↓
             Where does preprocessing run
                       ↓
             What resource executes inference
                       ↓
             How many requests may use it
                       ↓
             Should requests be batched
                       ↓
             What happens when overloaded
                       ↓
             How do we know the service is ready
                       ↓
             Where is latency being spent
                       ↓
             How many model copies should exist
                       ↓
             How should replicas map to CPUs/GPUs
```

The complete model is therefore:

> **FastAPI is the control/interface layer that turns remote requests into local serving work. Model serving is the larger resource-management problem of getting that work onto scarce compute safely, efficiently, observably, and predictably.**

Once you separate **HTTP concurrency**, **application concurrency**, and **inference concurrency**, decisions about `async`, threads, processes, workers, containers, batching, health checks, and GPU layouts become much easier to reason about.

![Six production boundaries for a FastAPI model service: contract, lifecycle, execution, evidence, security, and release, joined by one tested request path and release gate.](/content-assets/articles/article-mlops-model-serving-serving-model-with-fastapi/fastapi-production-summary.png)

*A production FastAPI service is complete only when the same tested request path connects its public contract to lifecycle, capacity, evidence, security, and recoverable release controls.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[How Does One Prediction Travel through a FastAPI Model Service?]{kind="recap"}
FastAPI handles HTTP parsing, validation, routing, and responses around a model loaded once, while larger designs may separate API and inference processes or services.
:::

:::expand[How Do Async, Threads, Processes, Batching, and Concurrency Match the Workload?]{kind="recap"}
Async helps waiting I/O, threads and processes create other concurrency boundaries, batching combines work, and scarce model resources require deliberate limits.
:::

:::expand[How Do Startup, Readiness, Liveness, and Warmup Protect Traffic?]{kind="recap"}
Startup loads dependencies, readiness confirms the warmed prediction path can serve, and liveness decides whether a stuck process should restart.
:::

:::expand[Which Traces and Metrics Explain Tail Latency and Throughput?]{kind="recap"}
Correlation traces follow one prediction across layers, while latency distributions, queue time, throughput, errors, and resource metrics expose different bottlenecks.
:::

:::expand[How Do Containers, Workers, GPUs, Autoscaling, Backpressure, and Shutdown Own Resources?]{kind="recap"}
Worker count follows model ownership; CPU and GPU services scale differently, and bounded queues, timeouts, graceful shutdown, and bottleneck-aware autoscaling protect capacity.
:::

:::expand[How Should a Request Handler, Scheduler Boundary, Capacity Model, and Streaming Path Fit Together?]{kind="recap"}
A boring handler delegates scheduling, and capacity uses work units; LLM token generation and streaming add time-to-first-token and long-lived connection concerns.
:::

:::expand[What Belongs inside FastAPI, and How Should the Architecture Evolve?]{kind="recap"}
FastAPI should own the public web contract and lightweight coordination, while dedicated schedulers or serving systems take over batching and scarce accelerator work as scale grows.
:::

:::expand[What Complete Mental Model Keeps the API Separate from Inference Scheduling?]{kind="recap"}
The API server translates product requests, the inference scheduler allocates model work, and the model runtime executes it under explicit lifecycle and capacity controls.
:::

## References

[1]: https://fastapi.tiangolo.com/deployment/ "Deployment - FastAPI"
[2]: https://fastapi.tiangolo.com/advanced/events/ "Lifespan Events - FastAPI"
[3]: https://fastapi.tiangolo.com/async/ "Concurrency and async / await - FastAPI"
[4]: https://fastapi.tiangolo.com/deployment/concepts/ "Deployments Concepts - FastAPI"
