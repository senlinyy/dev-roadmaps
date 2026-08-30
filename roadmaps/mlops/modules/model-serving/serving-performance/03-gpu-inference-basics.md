---
title: "GPU Inference"
description: "Understand what a GPU does during inference, decide which models benefit, and operate accelerator-backed services through memory, batching, Kubernetes, telemetry, and safe releases."
overview: "GPU inference turns a trained model into a production service that can use accelerator hardware efficiently. The complete system includes CPU preparation, device transfers, GPU execution, compatible software, memory planning, scheduling, telemetry, and release controls."
tags: ["MLOps", "advanced", "performance"]
order: 3
id: "article-mlops-model-serving-gpu-inference-basics"
---

## Table of Contents

1. [What Physical Work Makes a GPU Useful for Inference?](#what-physical-work-makes-a-gpu-useful-for-inference)
2. [How Do Memory Capacity, Bandwidth, Compute, Arithmetic Intensity, and Batching Limit a Request?](#how-do-memory-capacity-bandwidth-compute-arithmetic-intensity-and-batching-limit-a-request)
3. [How Do Prefill, Decode, Continuous Batching, Precision, and Multi-GPU Designs Change LLM Serving?](#how-do-prefill-decode-continuous-batching-precision-and-multi-gpu-designs-change-llm-serving)
4. [How Do Drivers, Hardware, Allocation, Partitioning, Time Slicing, and Kubernetes Affect Compatibility?](#how-do-drivers-hardware-allocation-partitioning-time-slicing-and-kubernetes-affect-compatibility)
5. [How Do Readiness, Cold Starts, Autoscaling, Metrics, and Symptoms Reveal the Bottleneck?](#how-do-readiness-cold-starts-autoscaling-metrics-and-symptoms-reveal-the-bottleneck)
6. [How Do Latency-Constrained Capacity and Useful Throughput Determine Cost?](#how-do-latency-constrained-capacity-and-useful-throughput-determine-cost)
7. [How Do Startup, Release Identity, Hardware Experiments, Canaries, and Rollback Control GPU Changes?](#how-do-startup-release-identity-hardware-experiments-canaries-and-rollback-control-gpu-changes)
8. [Which Mental Model and Four Questions Diagnose GPU Serving?](#which-mental-model-and-four-questions-diagnose-gpu-serving)
9. [Check Your Answers](#check-your-answers)

A GPU reports high utilization while requests still miss their latency target. The service may be padding long batches, filling KV-cache memory, waiting between kernels, or processing a few very large prompts that block shorter work. Utilization alone does not identify useful capacity.

**GPU inference** maps prediction work onto parallel compute and high-bandwidth memory. Performance depends on fit, data movement, arithmetic intensity, batching, precision, software compatibility, sharing, startup, and the request distribution. LLM prefill and decode add different resource regimes to the same service.

Use these questions to trace a request through the GPU stack and find the resource that actually limits useful throughput:

1. **What Physical Work Makes a GPU Useful for Inference?**
2. **How Do Memory Capacity, Bandwidth, Compute, Arithmetic Intensity, and Batching Limit a Request?**
3. **How Do Prefill, Decode, Continuous Batching, Precision, and Multi-GPU Designs Change LLM Serving?**
4. **How Do Drivers, Hardware, Allocation, Partitioning, Time Slicing, and Kubernetes Affect Compatibility?**
5. **How Do Readiness, Cold Starts, Autoscaling, Metrics, and Symptoms Reveal the Bottleneck?**
6. **How Do Latency-Constrained Capacity and Useful Throughput Determine Cost?**
7. **How Do Startup, Release Identity, Hardware Experiments, Canaries, and Rollback Control GPU Changes?**
8. **Which Mental Model and Four Questions Diagnose GPU Serving?**

## What Physical Work Makes a GPU Useful for Inference?
<!-- section-summary: GPUs accelerate inference when large amounts of similar arithmetic and data movement can run in parallel; they do not automatically improve every workload. -->

GPU design starts with the arithmetic and data movement required by one prediction rather than with accelerator branding.

The easiest way to understand GPU inference is to temporarily forget CUDA, PyTorch, Kubernetes, and model servers. Start with the physical problem:

A model prediction requires a large number of mathematical operations and a large amount of data movement.

A processor must:

1. get numbers from memory,
2. perform arithmetic on them,
3. write or retain the results,
4. repeat this many times.

GPUs are useful because many ML workloads contain **enormous amounts of similar arithmetic that can happen in parallel**. So GPU inference is fundamentally an attempt to transform:

$$
\text{model request}
$$

into:

$$
\boxed{\text{lots of parallel numerical work}}
$$

while keeping the GPU supplied with data efficiently enough that its expensive compute hardware does not sit idle. Nearly everything else—batching, CUDA, quantization, KV caches, GPU memory, concurrency, MIG, Kubernetes scheduling—is about making that transformation efficient and reliable. Consider matrix multiplication:

$$
C = AB
$$

where:

$$
A\in \mathbb{R}^{m\times k},
\qquad
B\in \mathbb{R}^{k\times n}.
$$

Each output element is:

$$
C_{ij}
=
\sum_{r=1}^{k} A_{ir}B_{rj}.
$$

If $$C$$ contains millions of elements, there are millions of similar calculations that can largely happen in parallel. Neural networks contain huge quantities of operations like:

* matrix multiplication;
* convolution;
* attention;
* vector operations;
* normalization.

That's exactly the kind of workload GPUs are designed to accelerate. A CPU and GPU make different engineering tradeoffs. A CPU typically has relatively few powerful cores optimized for things like:

* low-latency execution;
* branching;
* complicated control flow;
* operating-system tasks;
* sequential logic.

A GPU has many more execution units optimized for:

* parallel arithmetic;
* large vector/matrix operations;
* high aggregate throughput.

A simplified picture:

```text
CPU

[ powerful core ]
[ powerful core ]
[ powerful core ]
[ powerful core ]

Excellent at:
branching
control
low-latency sequential work
```

versus:

```text
GPU

[core][core][core][core][core][core]...
[core][core][core][core][core][core]...
[core][core][core][core][core][core]...
              ...
```

The GPU sacrifices some individual-thread sophistication in exchange for enormous parallel throughput. So the correct question is not:

"Is a GPU faster than a CPU?"

It is:

"Can enough of my computation be reorganized into parallel work to exploit a GPU?"

Imagine a model takes only:

$$
20\mu s
$$

of CPU computation. To run it on a GPU, you might need:

```text
prepare data
↓
transfer / make data GPU-accessible
↓
launch GPU kernel
↓
wait for GPU
↓
retrieve result
```

Suppose that machinery costs:

$$
100\mu s.
$$

Even if the GPU performs the mathematical operation in:

$$
5\mu s,
$$

total latency could be:

$$
100+5=105\mu s.
$$

The CPU wins. GPUs become attractive when the work is sufficiently:

* large;
* parallel;
* repetitive;
* compute-intensive;
* batchable.

This gives us an important rule:

$$
\boxed{\text{Acceleration must exceed acceleration overhead.}}
$$

Suppose you deploy a transformer. The model parameters reside in GPU memory. A request arrives:

```text
text request
    ↓
CPU parses request
    ↓
tokenization
    ↓
batch/scheduling
    ↓
GPU operations
    ↓
model output
    ↓
CPU/network response
```

Only part of this pipeline is GPU inference. A user doesn't experience:

$$
L_{\text{GPU}}
$$

alone. They experience:

$$
L_{\text{request}}
=
L_{\text{network}}
+
L_{\text{queue}}
+
L_{\text{CPU}}
+
L_{\text{transfer}}
+
L_{\text{GPU}}
+
L_{\text{postprocess}}
+
L_{\text{return}}.
$$

A GPU optimization that saves 20 ms is irrelevant if requests spend two seconds waiting in a queue. GPU serving must therefore be optimized as an **entire system**. Consider a simple image classifier. The request might go through:

### Network ingress

```text
JPEG bytes arrive
```

### CPU preprocessing

```text
decode JPEG
resize image
normalize pixels
create tensor
```

### Scheduling

The request may wait for:

* a GPU execution slot;
* a batch to form;
* enough GPU memory.

### Host-to-device movement

Input data becomes accessible on the GPU.

### Kernel execution

The framework launches GPU programs called **kernels**. Examples:

* matrix multiply;
* convolution;
* softmax;
* layer normalization.

### Synchronization

CPU and GPU occasionally need to wait for each other.

### Output processing

Results may move back to CPU memory and be transformed into something such as:

```json
{"class":"cat","probability":0.982}
```

### Network return

Response goes to the caller. The slowest stage can be somewhere completely different from the GPU arithmetic. One detail causes a great deal of confusion. When CPU code says something conceptually like:

```text
launch matrix multiplication
```

the CPU does not necessarily wait for that multiplication to finish. It often submits work to the GPU and continues.

Conceptually:

```text
CPU                         GPU

launch A -----------------> execute A
launch B -----------------> execute B
launch C -----------------> execute C
...
synchronize --------------> finish queued work
```

Therefore naïvely timing only the CPU-side launch can produce nonsense measurements. The GPU may still be working after the CPU call returns. Correct GPU benchmarking has to respect synchronization semantics. A neural network does not normally execute as one gigantic magical GPU operation. It becomes a sequence of GPU kernels.

For example:

```text
embedding lookup
↓
matrix multiply
↓
normalization
↓
attention
↓
matrix multiply
↓
activation
↓
...
```

Every kernel launch has overhead. Suppose you execute 1,000 tiny kernels. Even if each one is fast, launch and synchronization overhead can become significant. That's one reason techniques such as:

* operation fusion;
* optimized inference runtimes;
* CUDA Graphs;
* fused attention kernels;

can improve inference. Instead of:

```text
launch
launch
launch
launch
launch
```

you sometimes perform more useful work per launch. When people say:

"The GPU is full."

they could mean several different things. Three major constraints are:

$$
\boxed{\text{memory capacity}}
$$

$$
\boxed{\text{memory bandwidth}}
$$

$$
\boxed{\text{compute throughput}}
$$

These are not interchangeable. Understanding the difference is one of the most important GPU-serving skills.

## How Do Memory Capacity, Bandwidth, Compute, Arithmetic Intensity, and Batching Limit a Request?
<!-- section-summary: Weights, activations, KV cache, bandwidth, compute, arithmetic intensity, and batch size create independent fit and performance limits with a latency tradeoff. -->

Parallel execution helps only when the model fits and can feed memory and compute efficiently within its latency deadline.

Suppose a GPU has:

$$
80\text{ GB}
$$

of memory. A model needs:

$$
70\text{ GB}.
$$

Only 10 GB remains for everything else. But inference requires more than weights. GPU memory may contain:

$$
M_{\text{total}}
=
M_{\text{weights}}
+
M_{\text{activations}}
+
M_{\text{KV}}
+
M_{\text{workspace}}
+
M_{\text{runtime}}
+
M_{\text{buffers}}
+
M_{\text{fragmentation}}.
$$

For LLM serving, KV cache can become especially important. Suppose a model has:

$$
7\times10^9
$$

parameters. If each parameter requires 4 bytes:

$$
7B\times4
=
28GB.
$$

FP32 therefore needs roughly 28 GB just for the raw weights. At 2 bytes/parameter:

$$
7B\times2
=
14GB.
$$

At roughly 1 byte/parameter:

$$
\approx7GB.
$$

At nominal 4-bit storage:

$$
7B\times0.5
\approx3.5GB.
$$

Actual memory will differ because quantized formats usually need:

* scales;
* metadata;
* padding;
* possibly higher-precision tensors;
* runtime buffers.

Still, the basic relationship is powerful:

$$
\boxed{
\text{weight memory}
\approx
\text{parameter count}
\times
\text{bytes per parameter}
}
$$

Lower precision can therefore change which GPUs a model fits on. Suppose a layer computes:

$$
Y=f(XW).
$$

During inference, intermediate values must exist long enough to feed later operations. These are **activations**. Unlike training, inference generally doesn't need to preserve all activations for backpropagation. That's why inference memory requirements are usually substantially lower than training memory requirements for the same model. But activations are not zero. Their size grows with dimensions such as:

* batch size;
* input shape;
* sequence length.

Thus:

$$
\text{larger batch}
\rightarrow
\text{more activation memory}.
$$

Autoregressive generation introduces an especially important memory consumer. Suppose an LLM has already processed:

```text
The capital of France is
```

and is generating another token. Attention needs information derived from previous tokens. Rather than recomputing everything from scratch for every generated token, servers retain **key/value tensors** for previous tokens. This is the KV cache.

Conceptually:

```text
token 1 ──┐
token 2 ──┤
token 3 ──┤──> stored KV state
token 4 ──┘
             ↓
       generate token 5
```

Its memory roughly grows with:

$$
M_{\text{KV}}
\propto
N_{\text{active sequences}}
\times
N_{\text{cached tokens}}
\times
\text{model-dependent bytes/token}.
$$

So:

$$
\boxed{\text{LLM memory usage depends on traffic state, not merely model size.}}
$$

Suppose your remaining GPU memory supports approximately:

$$
1,000,000
$$

KV-cache token slots. You could theoretically support:

$$
100
$$

sequences of 10,000 cached tokens:

$$
100\times10,000=1,000,000.
$$

Or:

$$
10
$$

sequences of 100,000 tokens. Same GPU. Same model. Very different request concurrency. That is why a limit such as:

```text
maximum requests = 100
```

is often insufficient for LLM serving. A server may need to reason in terms of:

* active tokens;
* KV-cache blocks;
* sequence lengths;
* expected output lengths.

Suppose two GPUs both contain enough memory to hold your model. One has substantially greater memory bandwidth. They may have radically different inference performance. **Memory capacity** asks:

How many bytes can exist in GPU memory

**Memory bandwidth** asks:

How many bytes per second can be transported to/from the compute units

Conceptually:

$$
\text{capacity}=80GB
$$

versus perhaps:

$$
\text{bandwidth}=X\text{ TB/s}.
$$

One is an amount. The other is a rate. GPU compute capability asks:

How many arithmetic operations can the GPU perform per second

For the relevant precision, think approximately:

$$
P = \text{operations/second}.
$$

A workload requiring $$F$$ operations has a theoretical compute time:

$$
T_{\text{compute}}
\gtrsim
\frac{F}{P}.
$$

But computation can't happen until the necessary data reaches the compute units. If $$B$$ bytes must move and memory bandwidth is $$BW$$:

$$
T_{\text{memory}}
\gtrsim
\frac{B}{BW}.
$$

This gives us a very useful lower-bound intuition:

$$
\boxed{
T
\gtrsim
\max
\left(
\frac{F}{P},
\frac{B}{BW}
\right)
}
$$

ignoring many real-world overheads. Define arithmetic intensity:

$$
I=
\frac{\text{operations performed}}
{\text{bytes moved}}.
$$

High arithmetic intensity means:

We perform lots of math for every byte fetched.

Low arithmetic intensity means:

We move lots of data but don't do much computation with it.

Compare the GPU's compute-to-bandwidth ratio:

$$
\frac{P}{BW}.
$$

Very roughly:

* if workload arithmetic intensity is low, memory bandwidth tends to dominate;
* if it is high, compute tends to dominate.

This is the basic idea behind the **roofline model**. Suppose you fetch portions of matrices $$A$$ and $$B$$. If each loaded value participates in many multiply-add operations, you reuse those bytes repeatedly. That yields high arithmetic intensity. Large matrix multiplications can therefore keep GPU arithmetic hardware extremely busy. Small matrix operations have less opportunity for this reuse and parallelism. This helps explain an initially surprising fact:

A model can become dramatically more GPU-efficient when requests are batched together.

Suppose one request produces a tiny matrix multiplication:

$$
1\times4096
$$

multiplied by a large weight matrix. The GPU has enormous parallel capacity, but the operation may not expose enough useful parallel work. Now batch 64 requests:

$$
64\times4096.
$$

The same weight matrix can support much more parallel arithmetic.

Conceptually:

```text
batch = 1

huge GPU
████████████████████████
██ useful work
████████████████████████
```

versus:

```text
batch = 64

huge GPU
████████████████████████
████████████████ useful
████████████████████████
```

So throughput often improves with batch size. To build a batch, requests may need to wait. Suppose request A arrives now. Request B arrives 3 ms later. Request C arrives 5 ms later. If the scheduler waits for them, request A incurs batch-building latency. Thus:

$$
L_{\text{total}}
=
L_{\text{queue}}
+
L_{\text{batch wait}}
+
L_{\text{GPU}}+\cdots
$$

Large batches can improve:

$$
\text{GPU throughput}
$$

while hurting:

$$
\text{individual request latency}.
$$

The best batch size is therefore not:

the largest value that fits.

It is:

the largest/useful batching strategy that improves efficiency while remaining inside the service's latency constraints.

![Seven stages in an end-to-end GPU inference request, separating CPU preparation, host-device transfers, GPU kernels, and response policy, with a small-model CPU-versus-GPU latency comparison.](/content-assets/articles/article-mlops-model-serving-gpu-inference-basics/gpu-prediction-path.png)

*The user waits for the complete path, so a faster kernel changes the product only when queueing, CPU preparation, transfers, and response logic leave enough latency to recover.*

## How Do Prefill, Decode, Continuous Batching, Precision, and Multi-GPU Designs Change LLM Serving?
<!-- section-summary: LLM prefill and decode have different shapes; continuous batching, concurrency, replicas, precision, and multi-GPU partitioning trade memory, throughput, communication, and quality. -->

LLMs make that resource model clearer because prefill, decode, KV cache, precision, batching, and multiple devices stress different limits.

Autoregressive transformer serving is easier to understand by separating:

1. **prefill**
2. **decode**

Suppose the input prompt contains:

$$
4,000\text{ tokens}.
$$

The model first processes those tokens to build state. That's prefill. Then it generates:

```text
token 1
token 2
token 3
...
```

That's decode. The two phases can stress GPUs differently. During prefill, many prompt tokens are available simultaneously. That allows relatively large parallel matrix operations.

Conceptually:

$$
\text{thousands of prompt tokens}
\rightarrow
\text{large parallel computation}.
$$

Prefill can often make relatively good use of GPU compute. Long prompts can therefore create large bursts of computational work. During autoregressive decoding:

$$
y_t
=
F(x,y_1,\ldots,y_{t-1}).
$$

Token $$t+1$$ depends on token $$t$$. So one sequence cannot simply generate all output tokens simultaneously. For a small number of active sequences, each decode step may involve:

* reading a large amount of model state;
* performing relatively little work per loaded byte.

This can make decode strongly memory-bandwidth-sensitive. Then concurrency and continuous batching become extremely useful because you generate the next token for many sequences together. Traditional batching might do:

```text
request A: 100 generated tokens
request B: 20 generated tokens
request C: 300 generated tokens
```

If the batch is rigid, B may finish early while occupying a conceptual batch slot until everything finishes. Continuous batching instead allows:

```text
A  B  C
↓  ↓  ↓

B finishes
    ↓
insert D

A  D  C
```

Requests enter and leave the active batch over time. This is particularly effective for LLMs because output lengths vary widely. Suppose you have one GPU. You could run:

```text
one model server
concurrency = 64
```

or perhaps several model-server processes. But multiple independent replicas may each load their own model weights. If weights require:

$$
20GB,
$$

two independent replicas might need approximately:

$$
40GB
$$

before considering other memory. They may also build smaller independent batches:

```text
replica A batch = 4
replica B batch = 4
```

instead of:

```text
one scheduler batch = 8
```

So more replicas on one GPU do not automatically mean more throughput. Sometimes one larger scheduler makes more effective use of the device. Other workloads benefit from multiple processes. You have to measure. For a GPU service you can adjust:

### Batch size

How much work goes into one GPU execution group.

### Concurrency

How many requests are in flight.

### Replica count

How many independent serving processes/model instances handle traffic. These affect one another.

For example:

$$
\text{higher concurrency}
\rightarrow
\text{more batching opportunities}
\rightarrow
\text{higher GPU utilization}
$$

but also:

$$
\text{higher concurrency}
\rightarrow
\text{more memory use}
+
\text{more queueing}.
$$

And:

$$
\text{more replicas}
\rightarrow
\text{more scheduling parallelism}
$$

but possibly:

$$
\text{duplicate model memory}
+
\text{smaller batches}
+
\text{resource contention}.
$$

There is no independent "best" value for any one of the three. Imagine measurements from one GPU:

| Concurrency | Throughput |      p99 | GPU memory |
| ----------: | ---------: | -------: | ---------: |
|           4 |  100 req/s |   100 ms |      25 GB |
|           8 |        180 |   120 ms |      28 GB |
|          16 |        310 |   160 ms |      34 GB |
|          32 |        420 |   300 ms |      45 GB |
|          48 |        450 |   700 ms |      60 GB |
|          64 |        455 | 2,000 ms |      74 GB |

Going from 48 to 64 requests:

$$
450\rightarrow455
$$

throughput barely changes. But latency:

$$
700ms\rightarrow2000ms
$$

and memory pressure rises sharply. So concurrency 64 is not useful capacity. The GPU has reached some saturation limit. Model weights are numbers. They can be represented using formats with different precision.

Conceptually:

```text
FP32
↓
BF16 / FP16
↓
FP8 / INT8
↓
4-bit formats
```

Lower precision can reduce:

$$
\text{bytes moved}
$$

and:

$$
\text{bytes stored}.
$$

It may also unlock hardware units capable of dramatically higher arithmetic throughput at lower precision. So quantization can improve:

* memory capacity;
* memory bandwidth pressure;
* compute throughput;
* cost.

But it changes numerical behavior. Suppose the original model predicts:

$$
y=0.5001.
$$

After quantization:

$$
\hat y=0.4998.
$$

For some applications that difference is irrelevant. For a threshold:

$$
y>0.5 \Rightarrow \text{approve}
$$

it changes the output category completely. Likewise, tiny changes in LLM logits can affect token selection and cascade into entirely different generations. So the real optimization constraint is:

$$
\min(\text{serving cost})
$$

subject to:

$$
\text{quality}\ge Q_{\min}
$$

and:

$$
\text{latency}\le L_{\max}.
$$

Never declare precision changes successful merely because throughput improved. Useful evaluation may include:

* aggregate model accuracy;
* important customer slices;
* rare classes;
* long-context behavior;
* calibration;
* retrieval quality;
* ranking metrics;
* safety behavior;
* generated-text quality.

The important comparison is:

$$
\text{original serving stack}
$$

versus:

$$
\text{new serving stack}.
$$

Not merely model weights in isolation. A different runtime or kernel implementation can also alter numerical behavior. Suppose one model cannot fit on one GPU. You may divide it across multiple devices.

Conceptually:

```text
GPU 0         GPU 1
layers A      layers B
```

or split matrix operations across devices. Common forms include ideas such as:

* tensor parallelism;
* pipeline parallelism.

But distributing the model introduces communication. Now inference time includes something like:

$$
T
=
T_{\text{compute}}
+
T_{\text{memory}}
+
T_{\text{communication}}
+
T_{\text{synchronization}}.
$$

Two GPUs do not necessarily provide 2× speed. If they constantly exchange tensors, interconnect bandwidth and latency matter. With one GPU, you care heavily about:

* GPU compute;
* local GPU memory bandwidth.

With several communicating GPUs, you also care about:

* PCIe;
* NVLink or equivalent interconnects;
* topology;
* communication libraries.

Two identical GPUs connected differently can have materially different multi-GPU model performance. That is why topology-aware scheduling matters for distributed inference.

## How Do Drivers, Hardware, Allocation, Partitioning, Time Slicing, and Kubernetes Affect Compatibility?
<!-- section-summary: A tested stack includes framework, libraries, CUDA runtime, driver, architecture, allocation model, partitioning or time slicing, and scheduler constraints. -->

Fast execution also depends on a compatible software, driver, hardware, sharing, and scheduling stack.

A GPU model server depends on several layers.

Conceptually:

```text
model
↓
serving runtime / framework
↓
CUDA libraries and kernels
↓
CUDA runtime
↓
GPU driver
↓
GPU hardware
```

The exact terminology varies, but the principle is universal:

Every layer must agree sufficiently with the layers below and above it.

Containers make people think the entire environment is self-contained. GPU containers aren't completely self-contained. The GPU is controlled through the host operating system's GPU driver. A container can package:

* application code;
* framework;
* many user-space CUDA libraries;
* inference runtime.

But it still depends on compatible host driver/device access.

Conceptually:

```text
container
┌────────────────────┐
│ model server       │
│ framework/runtime  │
│ CUDA user libs     │
└─────────┬──────────┘
          │
host      │
┌─────────▼──────────┐
│ GPU driver         │
└─────────┬──────────┘
          │
          ▼
        GPU
```

Thus:

"The container didn't change"

doesn't prove the GPU serving stack didn't change. The host driver may have changed. GPU generations expose different capabilities. An optimized kernel might require a particular GPU architecture. So compatibility is really closer to:

$$
C=
f(
\text{hardware},
\text{driver},
\text{CUDA},
\text{libraries},
\text{framework},
\text{kernel},
\text{model}
).
$$

A container tested on GPU type A may:

* fail;
* fall back to slower kernels;
* compile at runtime;
* behave differently

on GPU type B. Hardware identity belongs in performance reproducibility. Suppose you upgrade a runtime. The model still answers requests correctly. But perhaps an optimized attention kernel is no longer compatible and the framework silently uses a generic implementation. Correctness tests pass. Throughput changes:

$$
200\rightarrow130\text{ requests/sec}.
$$

So compatibility testing needs two dimensions:

$$
\boxed{\text{functional compatibility}}
$$

and:

$$
\boxed{\text{performance compatibility}}.
$$

For serving infrastructure, both matter. Frameworks frequently maintain their own memory pools. A tensor may be deleted by the application, but the framework keeps that GPU memory reserved for future allocations. Therefore you might observe:

```text
application live tensors: 20 GB
GPU process reserved memory: 35 GB
```

This doesn't necessarily mean 15 GB leaked. The allocator may intentionally cache it. You need to distinguish concepts such as:

* live allocated memory;
* framework-reserved memory;
* device-wide used memory.

Suppose 10 GB is technically free, but distributed into many small regions. A new operation needs one sufficiently large contiguous allocation. It may fail despite apparently having enough aggregate free space. This is analogous to having empty seats distributed across several planes when a group must all travel on one plane. Modern allocators work hard to reduce this, but memory fragmentation can still matter. Thus you need headroom rather than planning to use:

$$
100\%
$$

of nominal GPU memory. The simplest deployment model is:

```text
one workload
→
one whole GPU
```

Advantages:

* strong performance predictability;
* entire memory capacity;
* full compute;
* full bandwidth;
* less interference.

It's often appropriate for large, latency-sensitive models. Disadvantage:

A small model might use only:

$$
15\%
$$

of the GPU. You're paying for the whole accelerator. Some GPUs support hardware partitioning such as NVIDIA MIG.

Conceptually:

```text
physical GPU
┌───────────────────────────┐
│ partition A │ partition B │
│             │             │
│ partition C │ partition D │
└───────────────────────────┘
```

Each partition receives a defined portion of hardware resources. Compared with simple time sharing, this can provide substantially stronger resource isolation and more predictable performance. It can be attractive for:

* smaller models;
* independent tenants;
* workloads needing predictable slices.

The tradeoff is flexibility. A large model may need the full GPU, and fixed partition sizes can strand resources. Another strategy is letting multiple workloads take turns using the same GPU.

Conceptually:

```text
time ─────────────────────────────>

workload A: ████      ████
workload B:     ████      ████
```

They share the physical GPU over time. This can improve utilization for bursty workloads. But unlike strong hardware partitioning, workloads can interfere more heavily. If A suddenly becomes busy, B may experience worse latency. Memory and fault isolation characteristics are also different from true hardware partitioning. Therefore:

$$
\boxed{\text{sharing a GPU} \neq \text{partitioning a GPU}.}
$$

A useful conceptual comparison:

| Strategy           | Isolation | Utilization flexibility  | Best fit                    |
| ------------------ | --------- | ------------------------ | --------------------------- |
| Whole GPU          | High      | Lower for tiny workloads | large/predictable workloads |
| Hardware partition | Stronger  | Medium                   | smaller isolated workloads  |
| Time sharing       | Lower     | High                     | bursty tolerant workloads   |

There is no universally superior choice. You are trading:

$$
\text{utilization}
\leftrightarrow
\text{isolation}
\leftrightarrow
\text{predictability}.
$$

Suppose Kubernetes sees:

```text
node A: 4 GPUs
node B: 4 GPUs
```

That doesn't necessarily mean all eight are interchangeable. They may differ in:

* GPU model;
* memory size;
* architecture;
* interconnect;
* driver;
* partition configuration.

A scheduler must eventually place each workload onto hardware satisfying its actual requirements.

For example:

```text
model requires > 40 GB/device
```

immediately rules out some devices. The scheduler's job is fundamentally:

$$
\text{workload requirements}
\rightarrow
\text{compatible available device}.
$$

A production setup commonly needs machinery for:

* advertising GPUs as schedulable resources;
* exposing devices into containers;
* selecting GPU-capable nodes;
* preventing unrelated jobs from occupying them;
* describing hardware classes;
* monitoring device health.

Conceptually:

```text
Pod:
"I need one GPU of the right class"

      ↓

Kubernetes scheduler

      ↓

GPU node with available device

      ↓

device passed into container
```

Kubernetes orchestrates placement. It does not make CUDA compatibility or performance tuning disappear.

## How Do Readiness, Cold Starts, Autoscaling, Metrics, and Symptoms Reveal the Bottleneck?
<!-- section-summary: Readiness must prove inference, cold starts need headroom, and user latency plus allocator, memory, kernel, and queue signals distinguish common bottlenecks. -->

Once deployed, readiness and observability must show whether users are waiting on startup, queues, data transfer, kernels, or memory.

Suppose Kubernetes starts a container. The process is alive after:

$$
2s.
$$

But the model still needs to:

```text
load 50 GB weights
initialize CUDA context
compile kernels
allocate KV cache
warm kernels
```

for another minute. If the readiness check says "healthy" too early, real user traffic arrives before the service is ready. So:

$$
\boxed{\text{process alive} \neq \text{model ready}.}
$$

Readiness should reflect actual serving readiness. A GPU replica startup can contain:

$$
T_{\text{startup}}
=
T_{\text{node acquisition}}
+
T_{\text{image pull}}
+
T_{\text{weight download}}
+
T_{\text{load}}
+
T_{\text{CUDA init}}
+
T_{\text{compile}}
+
T_{\text{warmup}}.
$$

Large model weights are especially important. If 100 GB of model artifacts must come from remote storage, startup time can be dominated by data movement rather than GPU initialization. This makes GPU autoscaling fundamentally slower than simply incrementing a replica number in a configuration file. Suppose traffic doubles instantly. New GPU capacity requires:

$$
90s
$$

to become ready. The existing GPUs must survive those 90 seconds. Your choices include:

* idle headroom;
* queues;
* admission control;
* predictive scaling;
* preprovisioned nodes;
* faster model loading.

Autoscaling can't create past capacity. GPU metrics alone don't tell you whether the service works. A useful monitoring picture contains at least two layers.

### Service layer

Measure:

* request throughput;
* queue depth;
* concurrency;
* p50/p95/p99 latency;
* errors;
* timeouts;
* rejects;
* batch sizes;
* TTFT and token rate for LLMs.

### GPU layer

Measure things such as:

* memory usage;
* compute/SM activity;
* memory-bandwidth activity;
* power;
* clocks;
* temperature;
* hardware errors;
* device interconnect activity.

The important part is correlation. Suppose your dashboard says:

$$
GPU\ utilization=100\%.
$$

Questions remain:

* Which units are busy
* Doing useful matrix operations
* Waiting on memory
* Executing inefficient kernels
* Is throughput good
* Is latency acceptable
* Is one process starving another

Conversely:

$$
GPU\ utilization=40\%
$$

doesn't necessarily mean you can double traffic without consequences. Perhaps:

$$
GPU\ memory=99\%
$$

or requests are latency-sensitive and cannot be batched further. Utilization is evidence, not capacity. Suppose service throughput is too low. Don't immediately ask:

"How do I increase GPU utilization?"

Ask:

"What resource currently prevents throughput from increasing?"

That produces much better diagnoses. Suppose:

```text
GPU compute activity: low
GPU memory: moderate
request latency: high
```

The GPU probably isn't your first bottleneck. Possible causes:

* CPU tokenization;
* image decoding;
* networking;
* request queueing;
* synchronous application logic;
* storage;
* too-small request batches;
* frequent CPU↔GPU synchronization.

You should inspect the timeline:

```text
CPU work ███████████
GPU               ██
CPU                  ███████
GPU                         ██
```

The GPU is starving. Imagine a trace:

```text
GPU:
██████      █████      ███████
      ^^^^^      ^^^^^
       idle       idle
```

Possible explanations:

* CPU can't prepare work quickly enough;
* scheduler isn't batching efficiently;
* data transfers are late;
* synchronization forces pauses;
* kernel launch overhead dominates.

The optimization isn't necessarily "buy a faster GPU." Often it's:

$$
\boxed{\text{keep the existing GPU supplied with work}.}
$$

Suppose:

```text
GPU memory: 98%
compute activity: 45%
```

Potentially the workload is memory-capacity constrained rather than compute constrained. For an LLM, likely suspects include:

* model too large;
* large KV cache;
* excessive concurrency;
* long contexts;
* duplicate replicas;
* workspace allocations.

Possible improvements:

* lower precision;
* reduce concurrency;
* improve KV-cache management;
* shorten context limits;
* use larger-memory devices;
* shard the model.

Increasing batch size may make things worse because it consumes additional memory. Suppose:

| Offered load | Throughput |    p99 |
| -----------: | ---------: | -----: |
|          100 |        100 | 200 ms |
|          200 |        200 | 250 ms |
|          300 |        295 | 350 ms |
|          400 |        320 | 900 ms |
|          500 |        322 |  4 sec |

The GPU system can deliver roughly:

$$
320\text{ req/s}
$$

under this workload. Beyond that:

$$
\text{additional arrivals}
\rightarrow
\text{queue}
$$

rather than additional throughput. That's saturation. The solution is not increasing concurrency indefinitely. You need:

* another GPU;
* a more efficient model/runtime;
* less work/request;
* admission control.

A benchmark might say:

```text
model fits!
```

because it tested one request. Production has 40 simultaneous requests. Now memory becomes:

$$
M_{\text{weights}}
+
40\times M_{\text{request state}}
+\cdots
$$

and the process crashes. This is why GPU memory testing must include realistic:

* concurrency;
* sequence length;
* batch size;
* output length.

"Model fits on GPU" is not equivalent to:

"Production workload fits on GPU."

Suppose most LLM requests contain:

$$
500\text{ input tokens}
$$

but one contains:

$$
100,000.
$$

The enormous prefill can consume a disproportionate amount of GPU time. Depending on scheduler design, smaller requests may wait behind it. Useful mitigations can include:

* workload-aware scheduling;
* prompt-length limits;
* separate workload pools;
* chunked prefill;
* admission control.

Again, the GPU is a finite shared resource. A single request can monopolize a large fraction of that resource budget.

![GPU device-memory budget showing weights, active requests, runtime workspace, sequence cache, model copies, operating headroom, and how batch size, concurrency, and model instances affect distinct components.](/content-assets/articles/article-mlops-model-serving-gpu-inference-basics/gpu-memory-tuning.png)

*Batch size, concurrency, and instance count consume different parts of the same device-memory budget; test their combination against latency, quality, memory, and error limits on representative shapes.*

## How Do Latency-Constrained Capacity and Useful Throughput Determine Cost?
<!-- section-summary: Capacity is useful throughput achieved under the latency objective for the actual workload, while cost includes padding, idle headroom, and failed or inefficient work. -->

Those measurements define capacity under a latency constraint and connect technical utilization to useful economic throughput.

Suppose a GPU reaches:

$$
500\text{ req/s}
$$

at:

$$
p99=10s.
$$

If your SLO is:

$$
p99<1s,
$$

500 req/s is not your production capacity. Perhaps measurements show:

$$
400\text{ req/s}
$$

keeps p99 below the target.

Then:

$$
\boxed{\text{safe GPU capacity}\approx400\text{ req/s}}
$$

for that specific workload and serving stack. Not 500. Suppose the same GPU and model handle:

### Workload A

```text
input = 200 tokens
output = 20 tokens
```

Safe capacity:

$$
100\text{ req/s}.
$$

### Workload B

```text
input = 20,000 tokens
output = 1,000 tokens
```

Safe capacity:

$$
4\text{ req/s}.
$$

So saying:

"This GPU supports 100 RPS"

without describing request work is almost meaningless. For generative workloads, better units might include:

* input tokens/s;
* output tokens/s;
* total tokens/s;
* prefill tokens/s;
* decode tokens/s;
* weighted work units.

Suppose production peak requires:

$$
8,000\text{ work units/sec}.
$$

Load testing shows one GPU safely provides:

$$
500\text{ work units/sec}
$$

under your SLO. Then naive capacity is:

$$
N=
\left\lceil
\frac{8000}{500}
\right\rceil
=
16.
$$

But running exactly at tested capacity leaves little resilience. Suppose you reserve 20% operating headroom. Usable capacity:

$$
500\times0.8=400.
$$

Then:

$$
N=
\left\lceil
\frac{8000}{400}
\right\rceil
=
20.
$$

And you may require still more for hardware failure or zonal failure. Suppose one GPU costs:

$$
\$4/\text{hour}.
$$

It safely produces:

$$
100\text{ accepted results/sec}.
$$

Results/hour:

$$
100\times3600
=
360,000.
$$

GPU cost/result:

$$
\frac{4}{360000}
\approx\$0.0000111.
$$

Now improve batching and runtime efficiency to:

$$
150\text{ accepted results/sec}.
$$

Cost becomes:

$$
\frac{4}{150\times3600}
\approx\$0.00000741.
$$

You didn't make the GPU cheaper. You produced more useful results from every GPU-hour. That is the basic economics of GPU optimization. Imagine two configurations.

### A

```text
GPU utilization: 95%
useful throughput: 100 req/s
```

### B

```text
GPU utilization: 80%
useful throughput: 150 req/s
```

Configuration B is clearly better if all else is equal. Why might A report greater utilization? Perhaps it's doing:

* inefficient kernels;
* unnecessary padding;
* redundant computation.

The resource can be busy doing useless work. Therefore:

$$
\boxed{\text{maximize useful work per GPU-second, not dashboard utilization.}}
$$

Suppose a batch has sequence lengths:

$$
100,\quad120,\quad150,\quad10,000.
$$

A naïve implementation pads all of them to:

$$
10,000.
$$

Instead of processing:

$$
100+120+150+10000=10,370
$$

meaningful positions, some operations may effectively process:

$$
4\times10000=40,000.
$$

A GPU could report very high utilization while most computation is padding. Again:

$$
\text{busy}\neq\text{efficient}.
$$

Bucketing similar lengths together or using more sophisticated kernels/schedulers can reduce waste. Suppose your production service needs eight GPUs at peak but only two overnight. If you permanently reserve eight:

```text
day:   8 needed, 8 running
night: 2 needed, 8 running
```

six GPU equivalents sit mostly idle overnight. Autoscaling can improve economics. But, as discussed earlier, GPU capacity can take significant time to start. Thus you're balancing:

$$
\boxed{\text{idle cost} \leftrightarrow \text{startup risk}.}
$$

## How Do Startup, Release Identity, Hardware Experiments, Canaries, and Rollback Control GPU Changes?
<!-- section-summary: Deployments consume GPU capacity, so startup is a pipeline and releases preserve model, engine, runtime, driver, hardware, configuration, canary evidence, and rollback compatibility. -->

Changing any stack layer is a release that consumes headroom and needs exact identity, canary evidence, and complete rollback compatibility.

Suppose you have:

$$
10
$$

GPU replicas. A rolling deployment wants to start two new replicas before terminating old ones. You temporarily need:

$$
12
$$

GPUs. If the cluster physically contains only 10, the rollout can't behave as designed. Alternatively, terminating an old instance first reduces serving capacity:

$$
10\rightarrow9
$$

while the replacement loads. That may overload the remaining fleet. GPU rollouts therefore have a **capacity cost**. Suppose cold start is:

| Stage            |      Time |
| ---------------- | --------: |
| obtain GPU node  |      60 s |
| pull image       |      20 s |
| download weights |      80 s |
| load weights     |      20 s |
| compile/warm     |      20 s |
| **Total**        | **200 s** |

Optimizing CUDA initialization by:

$$
20\rightarrow10s
$$

only reduces total time to 190 s. But caching model weights locally:

$$
80\rightarrow5s
$$

gives a much bigger win. Like request latency, startup latency must be decomposed end-to-end. A reproducible GPU deployment should identify much more than:

```text
model = model-v17
```

The effective artifact includes things such as:

```text
model weights / checksum
tokenizer
quantization configuration
serving runtime
framework
CUDA libraries
optimized kernels
container image
scheduler configuration
batch settings
driver compatibility
GPU hardware class
```

Why? Because all of those can change:

$$
\text{correctness}
$$

or:

$$
\text{performance}.
$$

A benchmark result belongs to the **stack**, not merely the model. Suppose release A was tested on one GPU generation. Release B runs on another. If throughput differs by 20%, is the software responsible You can't know. Performance comparison should control or explicitly record:

$$
\text{GPU type},
$$

$$
\text{driver},
$$

$$
\text{runtime},
$$

$$
\text{serving config},
$$

$$
\text{workload}.
$$

Otherwise you're comparing multiple changed variables simultaneously. Suppose you upgrade:

```text
runtime-v10
→
runtime-v11.
```

Don't immediately replace the whole fleet. A safer path is:

```text
offline benchmark
        ↓
one/small canary
        ↓
production traffic
        ↓
compare
 ├─ output quality
 ├─ errors
 ├─ p99
 ├─ throughput
 ├─ GPU memory
 └─ GPU behavior
        ↓
gradual rollout
```

GPU-serving regressions are often load-dependent. A model can look perfectly healthy at 5% traffic and collapse near saturation. Suppose old runtime capacity is:

$$
400\text{ req/s/GPU}.
$$

New runtime gives:

$$
390.
$$

At low traffic:

```text
100 req/s
```

both look identical. But a fleet serving:

$$
3,800\text{ req/s}
$$

on ten GPUs has dramatically less headroom after the change. Performance regressions must therefore be evaluated relative to real operating load. Suppose version B requires a newer driver. You upgrade the GPU nodes. Then discover B has a model-quality problem. Can version A still run on the new nodes? If not, your "rollback button" isn't a rollback. A GPU release plan should therefore answer:

* Can old container run with current driver
* Are old kernels compatible with this hardware
* Are old model artifacts still available
* Can the scheduling configuration be restored
* Does rollback require recreating nodes

Rollback is a systems property. When performance is bad, map symptoms to physical resources.

| Symptom                                               | Likely direction to investigate                     |
| ----------------------------------------------------- | --------------------------------------------------- |
| Low GPU activity, high latency                        | CPU, queueing, I/O, batching, synchronization       |
| GPU memory nearly full                                | weights, KV cache, batch/concurrency, fragmentation |
| OOM with long contexts                                | KV cache / request-state growth                     |
| High bandwidth pressure, modest arithmetic throughput | memory-bound workload                               |
| Arithmetic units saturated                            | compute-bound workload                              |
| Large GPU idle gaps                                   | host/scheduler starvation                           |
| Throughput flat, latency increasing                   | saturation                                          |
| Bigger batches improve throughput                     | GPU was underfilled                                 |
| Bigger batches only hurt latency                      | already saturated elsewhere                         |
| Multi-GPU scaling poor                                | communication/topology overhead                     |
| Performance changes across nodes                      | hardware/driver/runtime differences                 |

This isn't a substitute for measurement, but it converts vague symptoms into hypotheses you can test. Suppose you have an LLM whose weights require:

$$
30GB.
$$

GPU memory:

$$
80GB.
$$

Other runtime allocations require:

$$
5GB.
$$

That leaves approximately:

$$
80-30-5=45GB
$$

for KV cache, activations, and operating headroom. Suppose your KV representation consumes, very roughly for this hypothetical model:

$$
0.5MB/token
$$

per active sequence token. Then 45 GB theoretically corresponds to:

$$
\frac{45,000MB}{0.5MB}
=
90,000
$$

cached token slots. But using every last byte would be unsafe, so perhaps you budget only:

$$
70,000.
$$

That might allow roughly:

$$
70
$$

active 1,000-token contexts, or only:

$$
7
$$

active 10,000-token contexts. Already we know concurrency cannot be defined independently of context length. Now load-test:

| Active sequences | Output throughput | p99 TTFT |
| ---------------: | ----------------: | -------: |
|                8 |         600 tok/s |   200 ms |
|               16 |             1,000 |   250 ms |
|               32 |             1,500 |   400 ms |
|               48 |             1,700 |   800 ms |
|               64 |             1,750 | 2,000 ms |

Your TTFT SLO is:

$$
p99<1s.
$$

Then 48 might be the highest SLO-compatible tested concurrency. But you may choose:

$$
40
$$

as the normal operating limit for headroom. Suppose better batching increases throughput at 40 active sequences by 20%. You've increased useful GPU capacity without purchasing another GPU. Suppose INT8 quantization then reduces model memory and increases throughput another 25%, but evaluation shows unacceptable degradation on a critical task. Then that "optimization" cannot ship. This one example captures the whole discipline:

$$
\boxed{
\text{memory}
+
\text{compute}
+
\text{bandwidth}
+
\text{latency}
+
\text{quality}
+
\text{cost}
}
$$

must be considered together.

## Which Mental Model and Four Questions Diagnose GPU Serving?
<!-- section-summary: GPU serving is a flow of work through finite memory and compute; fit, feeding, execution, and useful output identify most failures. -->

The final diagnostic model reduces the complexity to the work, memory, feed, and output questions that locate the limiting resource.

A GPU inference request ultimately demands two things:

$$
F=\text{arithmetic operations}
$$

and

$$
B=\text{bytes moved}.
$$

The hardware offers finite:

$$
P=\text{arithmetic throughput}
$$

$$
BW=\text{memory bandwidth}
$$

$$
M=\text{memory capacity}.
$$

The request must first satisfy:

$$
\boxed{\text{working set}\le M}
$$

or it simply cannot execute in the intended way. Its physical execution time is then constrained by something resembling:

$$
\boxed{
T
\gtrsim
\max
\left(
\frac{F}{P},
\frac{B}{BW}
\right)
}
$$

plus:

$$
\text{kernel overhead}
+
\text{communication}
+
\text{synchronization}
+
\text{CPU/serving overhead}.
$$

Everything we do in GPU inference tries to improve one side of this equation.

### Batching

Increases parallelism and data reuse.

$$
\rightarrow
\text{better hardware efficiency}
$$

at the cost of waiting and memory.

### Concurrency

Keeps enough independent work available to form efficient batches.

$$
\rightarrow
\text{better utilization}
$$

until contention and memory pressure dominate.

### Quantization

Reduces bytes per model value.

$$
\rightarrow
\text{less memory capacity needed}
$$

$$
\rightarrow
\text{less memory traffic}
$$

and potentially:

$$
\rightarrow
\text{more arithmetic throughput}.
$$

But it risks quality changes.

### Kernel fusion

Does more useful work per launch and may avoid unnecessary intermediate memory traffic.

### KV caching

Trades:

$$
\text{more GPU memory}
$$

for:

$$
\text{less repeated computation}.
$$

### Tensor parallelism

Combines multiple GPUs to make a larger effective compute/memory system. But introduces:

$$
\text{communication overhead}.
$$

### Continuous batching

Uses variable-length concurrency more efficiently for autoregressive generation.

### GPU sharing

Trades some isolation/predictability for higher fleet utilization.

### Autoscaling

Reduces idle GPU cost by matching replica count to traffic. But introduces:

$$
\text{cold-start vulnerability}.
$$

All of these are resource trades. When a GPU serving system behaves badly, ask these in order.

### Does the workload fit

$$
\text{weights + runtime state + request state} < \text{GPU memory}
$$

with adequate headroom If not, solve memory capacity first.

### Is the GPU being supplied with enough useful work

If not, investigate:

* batching;
* CPU;
* scheduling;
* transfers;
* synchronization.

### Once busy, what resource is limiting it

Main possibilities:

$$
\text{compute}
$$

or:

$$
\text{memory bandwidth}
$$

or communication in multi-GPU systems.

### Is increasing hardware efficiency still consistent with product requirements

Check:

$$
\text{latency},
\text{quality},
\text{reliability},
\text{cost}.
$$

Those four questions are much more informative than asking:

"How do I get the GPU to 100%?"

GPU inference is fundamentally about matching the **shape of model computation** to the **shape of GPU hardware**. A GPU provides three critical finite budgets:

$$
\boxed{\text{memory capacity}}
$$

—how much model and request state can exist—

$$
\boxed{\text{memory bandwidth}}
$$

—how quickly those bytes can move— and

$$
\boxed{\text{compute throughput}}
$$

—how quickly arithmetic can happen. Your workload consumes all three in different proportions. The first requirement is:

$$
\boxed{\text{working set must fit in memory}.}
$$

Then performance is approximately governed by whichever resource takes longest:

$$
\boxed{
T_{\text{GPU}}
\gtrsim
\max
\left(
\frac{\text{operations}}{\text{compute throughput}},
\frac{\text{bytes moved}}{\text{memory bandwidth}}
\right)
}
$$

with kernel launch, communication, synchronization, and serving overhead added around it. Batching and concurrency help create enough parallel work to exploit the GPU, but eventually consume memory and latency budget. Lower precision reduces data movement and memory consumption and may unlock faster computation, but must be revalidated for model quality. Multiple GPUs increase resources but introduce communication. MIG and time slicing can increase fleet utilization but trade away flexibility or isolation. Kubernetes decides where GPU workloads run but cannot make incompatible hardware/software combinations compatible. Autoscaling changes the number of GPUs only after potentially substantial startup delay. And the ultimate production metric is not:

$$
\text{GPU utilization}.
$$

It is closer to:

$$
\boxed{
\frac{\text{useful predictions delivered within SLO}}
{\text{GPU-seconds purchased}}
}
$$

subject to the model still meeting its required quality. The practical GPU rule is: **fit the working set, keep the accelerator supplied with useful parallel work, identify whether compute or data movement is limiting you, and stop optimizing at the point where additional hardware efficiency would violate latency, reliability, or model quality.**

![Complete GPU serving release from Kubernetes allocation through hardware, driver, container access, backend, artifact, tuning, readiness, seven gates, fleet-representative canary, expansion, or hardware-specific safe-route recovery.](/content-assets/articles/article-mlops-model-serving-gpu-inference-basics/gpu-serving-stack-summary.png)

*A GPU candidate is releasable only when its artifact, software stack, hardware profiles, scheduling policy, operating point, telemetry, and compatible recovery route have passed as one system.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Physical Work Makes a GPU Useful for Inference?]{kind="recap"}
GPUs accelerate inference when large amounts of similar arithmetic and data movement can run in parallel; they do not automatically improve every workload.
:::

:::expand[How Do Memory Capacity, Bandwidth, Compute, Arithmetic Intensity, and Batching Limit a Request?]{kind="recap"}
Weights, activations, KV cache, bandwidth, compute, arithmetic intensity, and batch size create independent fit and performance limits with a latency tradeoff.
:::

:::expand[How Do Prefill, Decode, Continuous Batching, Precision, and Multi-GPU Designs Change LLM Serving?]{kind="recap"}
LLM prefill and decode have different shapes; continuous batching, concurrency, replicas, precision, and multi-GPU partitioning trade memory, throughput, communication, and quality.
:::

:::expand[How Do Drivers, Hardware, Allocation, Partitioning, Time Slicing, and Kubernetes Affect Compatibility?]{kind="recap"}
A tested stack includes framework, libraries, CUDA runtime, driver, architecture, allocation model, partitioning or time slicing, and scheduler constraints.
:::

:::expand[How Do Readiness, Cold Starts, Autoscaling, Metrics, and Symptoms Reveal the Bottleneck?]{kind="recap"}
Readiness must prove inference, cold starts need headroom, and user latency plus allocator, memory, kernel, and queue signals distinguish common bottlenecks.
:::

:::expand[How Do Latency-Constrained Capacity and Useful Throughput Determine Cost?]{kind="recap"}
Capacity is useful throughput achieved under the latency objective for the actual workload, while cost includes padding, idle headroom, and failed or inefficient work.
:::

:::expand[How Do Startup, Release Identity, Hardware Experiments, Canaries, and Rollback Control GPU Changes?]{kind="recap"}
Deployments consume GPU capacity, so startup is a pipeline and releases preserve model, engine, runtime, driver, hardware, configuration, canary evidence, and rollback compatibility.
:::

:::expand[Which Mental Model and Four Questions Diagnose GPU Serving?]{kind="recap"}
GPU serving is a flow of work through finite memory and compute; fit, feeding, execution, and useful output identify most failures.
:::
