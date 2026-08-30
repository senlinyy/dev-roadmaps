---
title: "Distributed Training"
description: "Learn how distributed workers share data, model state, communication, checkpoints, and recovery to complete one trustworthy training run."
overview: "Distributed training uses several processes and accelerators to solve a speed or memory limit that one device cannot solve alone. The learning path covers the worker model, collective communication, data and optimization semantics, parallelism strategies, recovery, scaling tests, and the frameworks that implement them."
tags: ["MLOps", "advanced", "compute"]
order: 2
id: "article-mlops-training-pipelines-distributed-training-basics"
---

## Table of Contents

1. [What Single-Device Limit Requires Distributed Training?](#what-single-device-limit-requires-distributed-training)
2. [How Does Synchronous Data Parallel Training Keep Model Copies Aligned?](#how-does-synchronous-data-parallel-training-keep-model-copies-aligned)
3. [How Do State Sharding, Tensor Parallelism, and Pipeline Parallelism Solve Memory Limits?](#how-do-state-sharding-tensor-parallelism-and-pipeline-parallelism-solve-memory-limits)
4. [How Do Communication and Slow Workers Limit Scaling?](#how-do-communication-and-slow-workers-limit-scaling)
5. [What Must a Distributed Checkpoint Preserve for Recovery?](#what-must-a-distributed-checkpoint-preserve-for-recovery)
6. [How Do Frameworks and Training Pipelines Manage Distributed Jobs?](#how-do-frameworks-and-training-pipelines-manage-distributed-jobs)
7. [How Do Scaling Experiments Measure Useful Distributed Work?](#how-do-scaling-experiments-measure-useful-distributed-work)
8. [How Do You Choose the Smallest Distributed Strategy That Meets the Constraint?](#how-do-you-choose-the-smallest-distributed-strategy-that-meets-the-constraint)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

One model fits on a single GPU but needs ten days to train. Another model cannot complete its first step because parameters, gradients, optimizer state, and activations exceed the device's memory. Both may use several GPUs, but they need different ways of dividing the work.

**Distributed training** decomposes one logical optimization process across cooperating worker processes. Each worker needs an identity, a device, the correct portion of data or model state, and a communication path. Together they must preserve the training semantics the team cares about and publish one recoverable result.

For a model that fits but is slow, data parallelism can split batches while synchronizing gradients. A model that does not fit may need optimizer, gradient, and parameter sharding or tensor and pipeline parallelism. Every strategy trades additional memory or compute for communication, coordination, checkpoint complexity, and new failure modes.

The questions below start with the single-device limit, then follow the extra communication, state, recovery, and measurement needed when several workers train one model:

1. **What Single-Device Limit Requires Distributed Training?**
2. **How Does Synchronous Data Parallel Training Keep Model Copies Aligned?**
3. **How Do State Sharding, Tensor Parallelism, and Pipeline Parallelism Solve Memory Limits?**
4. **How Do Communication and Slow Workers Limit Scaling?**
5. **What Must a Distributed Checkpoint Preserve for Recovery?**
6. **How Do Frameworks and Training Pipelines Manage Distributed Jobs?**
7. **How Do Scaling Experiments Measure Useful Distributed Work?**
8. **How Do You Choose the Smallest Distributed Strategy That Meets the Constraint?**

## What Single-Device Limit Requires Distributed Training?
<!-- section-summary: Distribution should address a measured throughput or memory limit, and each cooperating process needs a rank, device, group, and shared run identity. -->

A model that fits but finishes too late has a different problem from a model whose training state cannot fit on one device. The first diagnosis determines what must be divided.

Suppose one GPU trains a model like this:

$$
\theta_{t+1}
=
\theta_t-\eta\nabla L(\theta_t)
$$

At each training step, the device must:

```text
load a batch
    ↓
run forward pass
    ↓
compute loss
    ↓
run backward pass
    ↓
compute gradients
    ↓
update parameters
```

Now suppose one GPU is no longer enough. There are two fundamentally different reasons:

```text
Problem A:
Training fits on one GPU,
but takes too long.

Problem B:
Training cannot fit in one GPU's memory.
```

These lead to different forms of distributed training. The central idea is:

$$
\boxed{
\text{Distributed training means dividing some part of the training work or state across devices}
}
$$

The hard question is therefore not:

"How do I use eight GPUs?"

It is:

**"What exactly should those eight GPUs divide, and what information must they exchange to behave like one coherent training system?"**

Imagine training takes:

```text
1 GPU
10 days
```

But the model and batch fit comfortably in memory. Your constraint is **compute throughput**. You might want:

```text
8 GPUs
≈ much less than 10 days
```

That suggests dividing the data workload. Now consider a different model:

```text
model training state = 140 GB
GPU memory = 80 GB
```

Training cannot even start on one GPU. Your constraint is **memory capacity**. You need to divide model/training state. So the first diagnostic is:

```text
Why am I distributing

        ┌───────────────────────┐
        │                       │
        ▼                       ▼
Need more throughput       Need more memory
        │                       │
        ▼                       ▼
Data parallelism          State/model sharding
```

Sometimes you need both. Suppose you allocate four GPUs. A common setup is:

```text
Machine
├── GPU 0 ← worker process 0
├── GPU 1 ← worker process 1
├── GPU 2 ← worker process 2
└── GPU 3 ← worker process 3
```

With two machines:

```text
Node A
├── GPU 0 ← worker 0
├── GPU 1 ← worker 1
├── GPU 2 ← worker 2
└── GPU 3 ← worker 3

Node B
├── GPU 0 ← worker 4
├── GPU 1 ← worker 5
├── GPU 2 ← worker 6
└── GPU 3 ← worker 7
```

Each worker is usually an independent OS process. They run the same training program, but each process needs to know:

```text
Who am I
How many workers exist
Which GPU belongs to me
How do I contact the other workers
```

Distributed frameworks commonly define:

$$
\text{world size}=N
$$

where $$N$$ is the total number of worker processes. Each gets a unique:

$$
\text{rank}\in\{0,\ldots,N-1\}
$$

For eight workers:

```text
world_size = 8

rank 0
rank 1
rank 2
rank 3
rank 4
rank 5
rank 6
rank 7
```

There is often also a **local rank**:

```text
Node A:
rank 0 → local_rank 0 → GPU 0
rank 1 → local_rank 1 → GPU 1
rank 2 → local_rank 2 → GPU 2
rank 3 → local_rank 3 → GPU 3

Node B:
rank 4 → local_rank 0 → GPU 0
rank 5 → local_rank 1 → GPU 1
...
```

So:

* **global rank** identifies a worker across the whole job.
* **local rank** identifies its device within one machine.
* **world size** tells everyone how many participants exist.

PyTorch's current distributed system uses these process-oriented concepts and supports communication across one or multiple machines; `DistributedDataParallel` builds synchronous distributed training on top of those primitives. ([PyTorch Docs][1]) You will often see special code:

```python
if rank == 0:
    save_checkpoint()
```

That can create the wrong intuition. Rank 0 usually isn't:

```text
the trainer
```

while everybody else assists. In data-parallel training, all workers train:

```text
rank 0 → forward + backward
rank 1 → forward + backward
rank 2 → forward + backward
rank 3 → forward + backward
```

Rank 0 is simply often given coordination duties:

```text
logging
progress display
writing one copy of some metadata
final reporting
```

because you don't want every process printing or writing identical files.

## How Does Synchronous Data Parallel Training Keep Model Copies Aligned?
<!-- section-summary: Each worker starts from the same model, receives different data, computes local gradients, combines them through AllReduce, and applies the same update with an explicit global batch size. -->

When the complete model fits on every worker, data parallelism is the simplest way to add throughput, provided the workers preserve one mathematical update.

Suppose one model fits into each GPU. Then the easiest strategy is **data parallelism**. Every GPU receives the complete model:

```text
GPU 0: complete model θ
GPU 1: complete model θ
GPU 2: complete model θ
GPU 3: complete model θ
```

But each receives different training examples:

```text
global batch

examples 1–32     → GPU 0
examples 33–64    → GPU 1
examples 65–96    → GPU 2
examples 97–128   → GPU 3
```

Each computes gradients independently. Then they combine those gradients. Suppose the global batch contains $$B$$ examples. On one GPU, the gradient would be:

$$
g
=
\frac{1}{B}
\sum_{i=1}^{B}
\nabla_\theta L(x_i,\theta)
$$

Now use four workers. Let each process handle $$b$$ examples:

$$
B=4b
$$

Worker $$k$$ computes:

$$
g_k
=
\frac{1}{b}
\sum_{i\in D_k}
\nabla_\theta L(x_i,\theta)
$$

Then average the four local gradients:

$$
g
=
\frac{1}{4}
(g_0+g_1+g_2+g_3)
$$

Substitute the definitions:

$$
g
=
\frac{1}{4b}
\sum_{i=1}^{4b}
\nabla_\theta L(x_i,\theta)
$$

which is exactly the gradient over the combined global batch. That is the central mathematical observation behind synchronous data-parallel training:

> **Workers can independently process different examples and synchronize the resulting gradients before updating the model.**

Suppose every GPU has computed:

```text
GPU 0 → gradient g₀
GPU 1 → gradient g₁
GPU 2 → gradient g₂
GPU 3 → gradient g₃
```

They need everyone to obtain:

$$
g=g_0+g_1+g_2+g_3
$$

or the corresponding average. A collective operation called **AllReduce** performs this kind of operation:

```text
before:

GPU 0: g₀
GPU 1: g₁
GPU 2: g₂
GPU 3: g₃

          AllReduce
              ↓

after:

GPU 0: g
GPU 1: g
GPU 2: g
GPU 3: g
```

Then every worker applies the same optimizer update:

$$
\theta_{t+1}
=
\theta_t-\eta g
$$

So the model copies remain synchronized. This is the fundamental synchronization loop of Distributed Data Parallel training. Imagine:

```text
GPU 0 parameters = θ₀
GPU 1 parameters = θ₁
```

If:

$$
\theta_0\neq\theta_1
$$

then even identical data could produce different gradients. So distributed training establishes a common initial state.

Conceptually:

```text
initialize / load checkpoint
            │
            ▼
     same parameters
            │
    ┌───────┼────────┐
    ▼       ▼        ▼
 worker 0 worker 1 worker 2
```

After that, gradient synchronization keeps replicas aligned. A surprisingly easy mistake is:

```text
GPU 0 → batch A
GPU 1 → batch A
GPU 2 → batch A
GPU 3 → batch A
```

Now you're doing the same calculation four times. You have not increased the effective data throughput.

Instead:

```text
GPU 0 → A
GPU 1 → B
GPU 2 → C
GPU 3 → D
```

The dataset therefore needs a distributed sampler or equivalent sharding mechanism.

For example:

```text
dataset indices:

0 1 2 3 4 5 6 7 8 9 ...

rank 0 → 0, 4, 8, ...
rank 1 → 1, 5, 9, ...
rank 2 → 2, 6, 10, ...
rank 3 → 3, 7, 11, ...
```

The exact assignment does not matter nearly as much as these properties:

```text
workers collectively cover intended data
duplicates are controlled
shuffling is correct
epochs are reproducible
```

This is one of the most important distributed-training details. Suppose one GPU uses:

```text
batch size = 32
```

Now run four GPUs, each with batch size 32. Your effective global batch is no longer 32. It is:

$$
B_{\text{global}}
=
N_{\text{workers}}
\times
B_{\text{per-worker}}
$$

Thus:

$$
4\times32=128
$$

With gradient accumulation:

$$
\boxed{
B_{\text{global}}
=
N
\times
B_{\text{micro}}
\times
K_{\text{accumulation}}
}
$$

For:

```text
8 GPUs
microbatch = 16
accumulate 4 steps
```

you get:

$$
8\times16\times4=512
$$

examples per optimizer update. Suppose your original experiment was:

```text
1 GPU
batch = 32
learning rate = 0.001
```

Then you switch to:

```text
8 GPUs
batch per GPU = 32
```

Now:

$$
B_{\text{global}}=256
$$

You're no longer merely making the same experiment faster. You changed the optimization process. The gradient averages over eight times as many examples per optimizer step. That can affect:

```text
gradient variance
number of optimizer updates per epoch
learning-rate behavior
generalization
convergence
```

So distinguish:

### Strong scaling

Keep the total workload essentially fixed and divide it across more devices.

```text
global batch stays 256

1 GPU  → 256
2 GPUs → 128 each
4 GPUs → 64 each
8 GPUs → 32 each
```

### Batch scaling

Keep per-device batch fixed:

```text
1 GPU  → global 32
2 GPUs → global 64
4 GPUs → global 128
8 GPUs → global 256
```

This offers more parallel work but changes the training configuration. There are learning-rate adjustment heuristics for larger batches, but they are not universal laws. Treat global batch size as an ML hyperparameter, not merely infrastructure configuration.

![Two DDP workers process different batches with full model replicas, calculate local gradients, average those gradients through all-reduce, and apply the same synchronized optimizer update so the replicas remain aligned.](/content-assets/articles/article-mlops-training-pipelines-distributed-training-basics/one-ddp-training-step.png)

*DDP divides the data rather than the model. Gradient synchronization gives every replica the same update after each worker processes a different local batch.*

## How Do State Sharding, Tensor Parallelism, and Pipeline Parallelism Solve Memory Limits?
<!-- section-summary: Data parallelism replicates state; ZeRO or fully sharded methods partition training state; tensor and pipeline parallelism split layer computation and can be combined. -->

Replicating the model does not reduce per-device training-state memory, so larger models require sharding or splitting the model's computation itself.

Standard data parallelism looks like:

```text
GPU 0:
parameters
gradients
optimizer state

GPU 1:
parameters
gradients
optimizer state

GPU 2:
parameters
gradients
optimizer state
```

Everything is replicated. If training requires:

```text
70 GB/device
```

and your GPUs have:

```text
40 GB
```

then adding 100 GPUs does not magically help. Every GPU still needs approximately 70 GB. So:

$$
\boxed{
\text{ordinary data parallelism increases compute capacity,
not per-device model-state capacity}
}
$$

That is why large-model training needs another idea. Consider parameters $$\theta$$. Training may need:

```text
parameters
gradients
optimizer moments
master-precision parameters
activations
temporary buffers
```

For Adam-like optimization, optimizer state alone can be substantial. A simplified memory decomposition is:

$$
M
=
M_{\text{parameters}}
+
M_{\text{gradients}}
+
M_{\text{optimizer}}
+
M_{\text{activations}}
+
M_{\text{temporary}}
$$

If we cannot reduce the first three enough, the model may not fit. So instead of replicating everything, we can **shard training state**. Suppose there are four GPUs. Instead of:

```text
GPU 0: optimizer state A B C D
GPU 1: optimizer state A B C D
GPU 2: optimizer state A B C D
GPU 3: optimizer state A B C D
```

we can store:

```text
GPU 0: optimizer state A
GPU 1: optimizer state B
GPU 2: optimizer state C
GPU 3: optimizer state D
```

Now each device stores roughly:

$$
\frac{1}{4}
$$

of that distributed state. But nothing is free. When a worker needs state owned by another worker, communication must occur. So state sharding trades:

$$
\boxed{
\text{less memory}
\leftrightarrow
\text{more communication/coordination}
}
$$

That tradeoff appears throughout large-model training. DeepSpeed's current ZeRO design progressively partitions training state:

```text
ZeRO-1:
partition optimizer state

ZeRO-2:
partition optimizer state
+ gradients

ZeRO-3:
partition optimizer state
+ gradients
+ model parameters
```

DeepSpeed also supports offloading state toward CPU or NVMe through ZeRO-Infinity when accelerator memory alone is insufficient. ([DeepSpeed][2]) The conceptual progression is:

```text
less replication
      ↓
lower per-GPU memory
      ↓
more state must be communicated when required
```

So ZeRO is not "a faster DDP." Its central purpose is eliminating memory redundancy while preserving distributed training semantics. PyTorch's distributed ecosystem currently includes DDP, fully sharded data parallelism, tensor parallelism and related distributed abstractions. ([PyTorch Docs][3]) The key idea of fully sharded training is similar:

```text
ordinary DDP:

GPU 0 [complete model]
GPU 1 [complete model]
GPU 2 [complete model]
GPU 3 [complete model]
```

versus:

```text
fully sharded:

GPU 0 [model shard A]
GPU 1 [model shard B]
GPU 2 [model shard C]
GPU 3 [model shard D]
```

When a layer must execute, workers temporarily obtain whatever parameter pieces they require. After the computation, those full parameters need not remain resident everywhere. Again:

$$
\text{memory saved}
$$

at the cost of:

$$
\text{additional communication}
$$

Suppose a Transformer layer contains:

$$
Y=XW
$$

and matrix $$W$$ itself is enormous. Instead of storing the entire matrix on every GPU, divide it:

```text
W = [W₁ | W₂ | W₃ | W₄]

GPU 0 → W₁
GPU 1 → W₂
GPU 2 → W₃
GPU 3 → W₄
```

Each GPU performs part of the matrix multiplication:

$$
Y_i=XW_i
$$

and results are combined. This is **tensor parallelism**. Now we're not merely distributing storage. We're dividing the computation of a single layer. Data parallelism says:

```text
different data
same complete model
```

Tensor parallelism says:

```text
same logical layer
different pieces of its tensor computation
```

For example:

```text
                 giant matrix multiplication

                   X × W

                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
       GPU 0       GPU 1       GPU 2
       W₀          W₁          W₂

         └───────────┼───────────┘
                     ▼
                combine output
```

This helps when:

```text
one layer itself is too large
```

or when you want several GPUs collaborating on each large matrix operation. But tensor parallelism is communication-heavy because layers execute frequently. It therefore benefits enormously from fast GPU-to-GPU interconnects. Another strategy is:

```text
GPU 0:
layers 1–10

GPU 1:
layers 11–20

GPU 2:
layers 21–30

GPU 3:
layers 31–40
```

The forward pass moves through GPUs:

```text
input
 ↓
GPU 0
 ↓ activations
GPU 1
 ↓ activations
GPU 2
 ↓ activations
GPU 3
 ↓
loss
```

Backward propagation travels in the reverse direction. This is **pipeline parallelism**. The name comes from overlapping different minibatches/microbatches across stages:

```text
time →

GPU 0: batch1  batch2  batch3  batch4
GPU 1:   idle  batch1  batch2  batch3
GPU 2:   idle   idle   batch1  batch2
GPU 3:   idle   idle    idle   batch1
```

Once the pipeline fills, several stages can work simultaneously. But gaps at startup and shutdown create the **pipeline bubble**. Large-scale training often combines several axes. Imagine 64 GPUs. You might have:

```text
8-way data parallel
×
4-way tensor parallel
×
2-way pipeline parallel

= 64 GPUs
```

Conceptually:

```text
DATA PARALLEL
different batches

       │
       ▼

PIPELINE PARALLEL
different layer groups

       │
       ▼

TENSOR PARALLEL
different pieces within a layer
```

This is sometimes described as multidimensional or hybrid parallelism. The goal is to make the model:

```text
fit in memory
```

while also making enough devices:

```text
do useful work concurrently
```

## How Do Communication and Slow Workers Limit Scaling?
<!-- section-summary: Communication bandwidth, latency, synchronization, stragglers, data supply, and node boundaries create a distribution tax that can dominate saved compute. -->

Every partition adds messages and waiting. Measuring communication and per-rank timing shows whether extra devices are accelerating the optimization or mostly coordinating it.

Suppose one GPU takes:

$$
T_1=100\text{ ms}
$$

per step. Naively, with four GPUs you might hope for:

$$
T_4=25\text{ ms}
$$

But distributed training introduces communication. Perhaps:

```text
local computation      25 ms
gradient communication 12 ms
synchronization         3 ms
```

Then:

$$
T_4=40\text{ ms}
$$

The speedup is:

$$
S(4)=\frac{100}{40}=2.5
$$

not $$4$$. The core equation is:

$$
\boxed{
T_{\text{distributed}}
=
T_{\text{compute}}
+
T_{\text{communication}}
+
T_{\text{synchronization}}
+
T_{\text{other overhead}}
}
$$

As the number of GPUs increases, compute per worker often decreases. Communication does not disappear. Eventually communication dominates. Inside one GPU server, GPUs may have very fast direct interconnects. Across servers, traffic crosses a network.

Conceptually:

```text
same node:

GPU ───────── GPU
   fast link

different nodes:

GPU
 ↓
host/network interface
 ↓
switch/network
 ↓
host
 ↓
GPU
```

Communication performance depends on things like:

$$
\text{latency}
$$

and:

$$
\text{bandwidth}
$$

Roughly:

$$
T_{\text{transfer}}
\approx
T_{\text{latency}}
+
\frac{\text{bytes transferred}}{\text{bandwidth}}
$$

If gradients total 5 GB per step, network performance suddenly becomes an ML training issue. This is why "eight GPUs" does not specify a complete training system. You need to know how those GPUs are connected. Consider synchronous training:

```text
worker 0 compute → done at 100 ms
worker 1 compute → done at 101 ms
worker 2 compute → done at 99 ms
worker 3 compute → done at 180 ms
```

Gradient synchronization cannot complete normally until worker 3 participates. So the step behaves approximately like:

```text
worker 0 ██████████........
worker 1 ██████████........
worker 2 ██████████........
worker 3 ██████████████████
                         ↑
                    everyone waits
```

Worker 3 is a **straggler**. Possible causes include:

```text
slow data loading
network congestion
thermal throttling
different hardware
background processes
storage stalls
uneven batch sizes
checkpoint writes
```

So average GPU utilization is not enough. You want per-rank timing. Instead of recording:

```text
step = 800 ms
```

break it down:

```text
data loading      80 ms
forward          190 ms
backward         320 ms
gradient sync    150 ms
optimizer         40 ms
other             20 ms
```

Now you know what optimization to make. If:

```text
gradient sync = 50%
```

then buying faster GPUs may make the problem worse because computation gets faster while communication remains unchanged. If:

```text
data loading = 50%
```

your distributed cluster is probably starving. If:

```text
forward/backward = 85%
```

more/faster compute may help. You don't necessarily have to:

```text
finish entire backward pass
       ↓
communicate every gradient
       ↓
continue
```

During backpropagation, gradients become available layer by layer. So frameworks can conceptually do:

```text
compute gradient for layer 100
            │
            ├── communicate it
            │
compute gradient for layer 99
            │
            ├── communicate it
            │
compute gradient for layer 98
```

Now:

$$
T_{\text{step}}
$$

may be closer to the maximum of compute and communication rather than their full sum. That overlap is an important optimization in distributed training. But it only works when computation is large enough to hide communication. Suppose throughput is:

```text
1 GPU  → 1,000 tokens/s
2 GPUs → 1,900 tokens/s
4 GPUs → 3,500 tokens/s
8 GPUs → 5,600 tokens/s
```

Speedup:

$$
S(N)
=
\frac{\text{throughput}_N}
{\text{throughput}_1}
$$

So:

```text
2 GPUs → 1.9×
4 GPUs → 3.5×
8 GPUs → 5.6×
```

Scaling efficiency is:

$$
E(N)
=
\frac{S(N)}{N}
$$

Therefore:

```text
2 GPUs → 95%
4 GPUs → 87.5%
8 GPUs → 70%
```

Eight GPUs are faster. But each additional GPU contributes less useful throughput. Suppose one GPU costs:

```text
£2/hour
```

One GPU trains in:

```text
8 hours
```

so:

$$
C_1=£16
$$

Four GPUs train in:

```text
2.5 hours
```

Cost:

$$
C_4=4\times2.5\times£2=£20
$$

Eight GPUs train in:

```text
1.7 hours
```

Cost:

$$
C_8=8\times1.7\times£2=£27.20
$$

So:

| GPUs |  Time |   Cost |
| ---: | ----: | -----: |
|    1 |   8 h |    £16 |
|    4 | 2.5 h |    £20 |
|    8 | 1.7 h | £27.20 |

The correct choice depends on your constraint. If training must finish in three hours, four GPUs may be ideal. If overnight is acceptable, one may be cheaper. Suppose your model is tiny. One GPU:

```text
compute = 30 ms
```

Four GPUs:

```text
compute = 8 ms
communication = 20 ms
synchronization = 7 ms

total = 35 ms
```

Now four GPUs are slower than one. Why? Because:

$$
\text{saved compute}
<
\text{added distributed overhead}
$$

Distribution is valuable only when enough useful parallel work exists to amortize communication and coordination. Suppose one server contains eight GPUs. Going from:

```text
1 → 2 → 4 → 8 GPUs
```

may scale reasonably well because communication remains inside the machine. Going from:

```text
8 → 16 GPUs
```

may suddenly require a second machine. Now the communication path changes:

```text
GPU ↔ GPU interconnect
```

becomes partly:

```text
machine A
    ↕
network
    ↕
machine B
```

So scaling curves often have discontinuities around node boundaries. Always benchmark:

```text
single GPU
multi-GPU single node
multi-node
```

separately.

## What Must a Distributed Checkpoint Preserve for Recovery?
<!-- section-summary: Recovery may require model, optimizer, scheduler, precision, random, sampler, topology, data, and sharding state, sometimes with resharding for a new world size. -->

More workers also create more failure points, which makes the exact checkpoint contents and restoration topology part of the distributed design.

On one GPU:

```text
GPU fails
→ job fails
```

With 128 workers:

```text
any important worker fails
→ collective operation may fail
→ whole distributed attempt may fail
```

As you add machines, there are simply more components that can fail:

```text
GPU
host
network
process
storage access
driver/runtime
orchestrator
```

Therefore checkpointing becomes more important as jobs become larger and longer. Suppose you save only:

```text
model parameters
```

You may be able to perform inference. But you may not be able to resume training exactly. A robust training checkpoint may need:

```text
model parameters/shards

optimizer state
learning-rate scheduler state
gradient-scaler state

global training step
epoch

random-number-generator states

sampler/data-loader position

training configuration
precision configuration

distributed topology/sharding metadata

dataset snapshot/version
```

Why sampler state? Imagine the job fails after consuming:

```text
47% of epoch 8
```

If you restore weights but restart the data loader at the beginning of epoch 8, the model sees data twice. That isn't an exact continuation. With ordinary DDP, each worker may contain a full parameter copy. You can often let rank 0 write one model checkpoint. With fully sharded training:

```text
rank 0 owns shard A
rank 1 owns shard B
rank 2 owns shard C
rank 3 owns shard D
```

No worker necessarily has the whole training state. So checkpointing may itself be distributed:

```text
checkpoint/
    rank-000/
    rank-001/
    rank-002/
    rank-003/
    metadata.json
```

Restoration needs to understand how the pieces compose. This becomes especially important if you want to resume using a different number of GPUs. Suppose training originally used:

```text
64 GPUs
```

but only 32 are available after failure. Can the checkpoint resume? Not automatically. A checkpoint format might encode shards assuming:

```text
world_size = 64
```

To resume on 32 workers, the system may have to **reshard** the state. So there are two different goals:

```text
checkpointing:
resume after failure

elastic checkpointing:
resume after failure
even with changed distributed topology
```

If elasticity matters, design for it explicitly. Suppose 128 processes all execute:

```python
torch.save(model, "checkpoint.pt")
```

onto shared storage. You can get:

```text
file corruption
write contention
128 redundant copies
confusing logs
```

Distributed code therefore needs rank-aware side effects.

For example:

```text
all ranks:
participate in distributed checkpoint creation

rank 0:
write run metadata
emit human-readable progress
register final artifact
```

The precise rule depends on whether the training state is replicated or sharded.

![Four parallelism strategies map completion time to data parallelism, training-state memory to state sharding, an oversized layer to tensor parallelism, and depth or activation pressure to pipeline parallelism.](/content-assets/articles/article-mlops-training-pipelines-distributed-training-basics/four-ways-to-split-training.png)

*Each strategy divides a different object. The measured single-device limit determines whether the team should split examples, persistent state, calculations inside a layer, or groups of layers.*

## How Do Frameworks and Training Pipelines Manage Distributed Jobs?
<!-- section-summary: Compute frameworks distribute model work, job frameworks launch workers, platforms manage clusters, and the pipeline controls the surrounding request, data, checkpoint, evaluation, and release lifecycle. -->

Frameworks solve different layers of that problem, while the training pipeline remains responsible for the lifecycle before worker launch and after the distributed computation ends.

These tools are sometimes spoken about as if they're alternatives. They are often complementary. Think in layers.

### DeepSpeed

DeepSpeed focuses heavily on **how large-scale model computation and state are executed efficiently**. Its features include memory-saving techniques such as ZeRO; current DeepSpeed documentation describes ZeRO stages that shard optimizer state, gradients and eventually parameters, with CPU/NVMe offload available for still larger models. ([DeepSpeed][4])

Conceptually:

```text
DeepSpeed asks:

How should this model's training state
and computation be distributed efficiently
```

### Ray Train

Ray Train operates more at the **distributed job execution/orchestration layer**. It launches worker processes, assigns resources, sets up framework distributed environments, runs the training function on each worker, and integrates metrics/checkpoint handling. Its current `ScalingConfig` exposes worker count and GPU-resource choices, among other configuration. ([Ray][5])

Conceptually:

```text
Ray Train asks:

How do I launch and manage this training
function across a cluster of workers
```

And they can be used together: Ray's current documentation explicitly shows Ray Train launching DeepSpeed workloads across a Ray cluster. ([Ray][6]) So:

```text
Ray Train
     │
     │ launches/manages workers
     ▼
DeepSpeed
     │
     │ distributes model training/state
     ▼
PyTorch + GPUs
```

That's a much better mental model than:

```text
DeepSpeed vs Ray
```

Distributed training itself might start here:

```text
64 workers are running
```

But a training **pipeline** must deal with everything around that:

```text
training request
      ↓
select cluster size
      ↓
allocate nodes
      ↓
place workers
      ↓
prepare dataset
      ↓
establish distributed group
      ↓
train
      ↓
checkpoint
      ↓
recover from failures
      ↓
evaluate
      ↓
save model
      ↓
release 64 expensive GPUs
```

This is why distributed-training frameworks and workflow orchestrators are different concepts. One handles the mathematics/runtime of cooperation. The other manages the lifecycle. Suppose your training specification says:

```text
nodes = 4
GPUs per node = 8
world_size = 32
```

A managed platform can conceptually:

```text
provision 4 machines
       ↓
install/start training image
       ↓
give workers rendezvous information
       ↓
assign ranks/devices
       ↓
start 32 processes
       ↓
attach data/checkpoint storage
       ↓
collect logs/metrics
       ↓
detect job completion
       ↓
destroy compute
```

The platform manages machines. Your training framework still manages distributed computation. As a concrete current example, SageMaker supports single- and multi-instance distributed training and integrates with options including PyTorch DDP, FSDP, DeepSpeed and related distributed mechanisms; its documentation also emphasizes the importance of network topology and storage location for collective operations such as AllReduce. ([AWS Documentation][7]) Imagine one GPU consumes:

```text
500 MB/s
```

Eight GPUs might require:

$$
8\times500=4\text{ GB/s}
$$

If your storage system can provide only:

```text
1.2 GB/s
```

then eight GPUs will compete for data. You might see:

```text
1 GPU → 95% utilization
8 GPUs → 35% utilization each
```

Not because distributed training is bad. Because storage became the bottleneck. This is another recurring principle:

$$
\boxed{
\text{every part of the pipeline must scale with the training workers}
}
$$

That includes:

```text
storage
CPU preprocessing
networking
checkpoint writes
metadata systems
```

Ray Train, for example, can integrate with Ray Data to split and stream data across training workers and scale preprocessing separately from GPU workers. ([Ray][8]) Suppose you have:

```text
seed = 42
```

On one GPU that may define:

```text
parameter initialization
dropout
data shuffle
augmentation randomness
```

With eight workers you now need to reason about:

```text
global seed
per-worker seed
data sampler seed
epoch
rank
restart behavior
```

You often want deterministic-but-different worker random streams:

$$
s_k=f(s_{\text{global}},\text{rank}_k,\text{epoch})
$$

rather than:

```text
every worker uses identical random augmentation
```

But exact bit-level reproducibility can still be difficult because parallel floating-point reductions may execute in different orders. So record:

```text
world size
parallelism strategy
rank topology
precision
framework version
communication backend
hardware
random seeds
checkpoint
```

along with the usual experiment metadata.

## How Do Scaling Experiments Measure Useful Distributed Work?
<!-- section-summary: Matched runs across increasing device counts record throughput, phase timing, rank imbalance, memory, cost, quality, and scaling efficiency. -->

Representative scaling runs make the trade visible instead of assuming that speedup follows device count linearly.

Suppose you train an image model. Single GPU:

```text
batch = 64

forward = 90 ms
backward = 140 ms
optimizer = 20 ms

step = 250 ms
```

Throughput:

$$
\frac{64}{0.25}=256
$$

images/sec. Now use four GPUs with 64 examples per worker. Global batch:

$$
4\times64=256
$$

Each GPU independently calculates:

```text
GPU 0 → 64 images → g₀
GPU 1 → 64 images → g₁
GPU 2 → 64 images → g₂
GPU 3 → 64 images → g₃
```

Then:

```text
AllReduce(g₀,g₁,g₂,g₃)
```

takes 30 ms. The local compute still costs roughly:

```text
250 ms
```

and synchronization adds:

```text
30 ms
```

so:

$$
T=280\text{ ms}
$$

Throughput is:

$$
\frac{256}{0.28}
\approx914
$$

images/sec. Speedup:

$$
\frac{914}{256}
\approx3.57
$$

Efficiency:

$$
\frac{3.57}{4}
\approx89\%
$$

That's a healthy distributed scaling result. Suppose 32 GPUs produce:

```text
7,000 images/sec
```

The ideal throughput would be:

$$
32\times256=8192
$$

Efficiency:

$$
\frac{7000}{8192}\approx85\%
$$

Still good. At 128 GPUs, suppose you get:

```text
15,000 images/sec
```

Ideal:

$$
128\times256=32768
$$

Efficiency:

$$
\frac{15000}{32768}\approx46\%
$$

You're still training faster than on 32 GPUs. But the return per extra GPU has collapsed. Now you should ask whether your objective really requires 128. Don't jump from:

```text
1 GPU
```

straight to:

```text
256 GPUs
```

Benchmark a sequence:

```text
1
2
4
8
16
32
64
```

For each record:

| Metric                     | Why                  |
| -------------------------- | -------------------- |
| examples/tokens per second | useful throughput    |
| step time                  | raw latency          |
| compute time               | GPU work             |
| communication time         | distribution tax     |
| data wait time             | input bottleneck     |
| memory per GPU             | capacity             |
| max/min rank timing        | stragglers           |
| cost/hour                  | infrastructure price |
| cost to target quality     | economic result      |
| validation quality         | ML correctness       |

Then find where:

$$
\frac{\text{additional throughput}}
{\text{additional GPUs}}
$$

stops being worthwhile.

## How Do You Choose the Smallest Distributed Strategy That Meets the Constraint?
<!-- section-summary: The chosen strategy partitions only what the measured constraint requires and stops scaling when added coordination costs exceed useful time, memory, or economic value. -->

The final choice starts from the constraint and uses the smallest topology that meets memory and completion goals with acceptable cost, quality, and recovery behavior.

A useful decision tree is:

```text
Does model + training state fit on one GPU
                │
        ┌───────┴───────┐
       yes              no
        │                │
        ▼                ▼
Need training        Need memory
faster              reduction
        │                │
       yes               ▼
        │           shard state
        ▼           (FSDP / ZeRO)
 data parallel             │
                           ▼
                    Are individual layers
                    still too large
                           │
                          yes
                           ▼
                    tensor/model
                     parallelism
                           │
                           ▼
                    Need further split
                           │
                           ▼
                    pipeline/hybrid
```

Then benchmark communication. Because a theoretically valid distribution strategy can still be practically terrible. Suppose:

```text
one GPU training = 50 minutes
business requirement = model by tomorrow
```

There may be no reason to distribute. Distributed training adds:

```text
code complexity
network dependency
synchronization
checkpoint complexity
failure modes
observability requirements
cost
```

If one device already satisfies the objective:

$$
\text{simpler architecture}
$$

may be the better architecture. Distributed training should solve a real constraint. It should not be a status symbol for the pipeline. The easiest way to reason about distributed training is to imagine three things moving around the cluster.

### Data

```text
Which examples does each worker see
```

### Model/training state

```text
Where do parameters,
gradients and optimizer state live
```

### Messages

```text
What information must workers exchange
to stay mathematically consistent
```

Every distributed strategy changes these three flows.

For example:

| Strategy          | Data                 | Model/state        | Communication                  |
| ----------------- | -------------------- | ------------------ | ------------------------------ |
| Data parallel     | split                | replicated         | gradients                      |
| Fully sharded     | split                | sharded            | parameters + gradients/state   |
| Tensor parallel   | shared logical batch | tensor pieces      | activations/partial results    |
| Pipeline parallel | microbatches flow    | layer groups split | activations + gradients        |
| Hybrid            | several splits       | several splits     | several communication patterns |

That table is more fundamental than the names of specific frameworks. Distributed training is not:

**"Run my training script on many GPUs."**

It is:

**"Decompose one logical optimization process into cooperating workers while preserving the training semantics I care about."**

The reasoning chain is:

$$
\boxed{
\text{single-device bottleneck}
\rightarrow
\text{choose what to partition}
\rightarrow
\text{assign workers/ranks}
\rightarrow
\text{split data or state}
\rightarrow
\text{communicate required information}
\rightarrow
\text{synchronize}
\rightarrow
\text{checkpoint distributed state}
\rightarrow
\text{measure scaling}
}
$$

For a model that **fits but is slow**, start by considering data parallelism. For a model whose **training state does not fit**, shard parameters, gradients and optimizer state. For layers that are individually too large or computationally enormous, split the model itself using tensor or pipeline parallelism. And throughout all of these, remember the fundamental trade:

$$
\boxed{
\text{more devices}
\Rightarrow
\text{more potential compute/memory}
+
\text{more communication and coordination}
}
$$

The winning distributed architecture is therefore not the one using the most GPUs. It is the smallest, simplest topology that satisfies your **memory requirement and time-to-train objective with acceptable scaling efficiency, cost, and failure behavior**.

![A trustworthy distributed run follows six steps from diagnosing the one-device limit through strategy selection, coordinated worker launch, preserved training semantics, checkpoint recovery, and measured scaling value.](/content-assets/articles/article-mlops-training-pipelines-distributed-training-basics/trustworthy-distributed-run.png)

*The distributed design is complete after the team can account for the data, explain the optimizer semantics, restore a complete checkpoint, preserve model quality, and show that the extra devices improved the operating result.*

## Check Your Answers

Use these short answers to revisit the reasoning behind each section.

:::expand[What Single-Device Limit Requires Distributed Training?]{kind="recap"}
Distribution should address a measured throughput or memory limit, and each cooperating process needs a rank, device, group, and shared run identity.
:::

:::expand[How Does Synchronous Data Parallel Training Keep Model Copies Aligned?]{kind="recap"}
Each worker starts from the same model, receives different data, computes local gradients, combines them through AllReduce, and applies the same update with an explicit global batch size.
:::

:::expand[How Do State Sharding, Tensor Parallelism, and Pipeline Parallelism Solve Memory Limits?]{kind="recap"}
Data parallelism replicates state; ZeRO or fully sharded methods partition training state; tensor and pipeline parallelism split layer computation and can be combined.
:::

:::expand[How Do Communication and Slow Workers Limit Scaling?]{kind="recap"}
Communication bandwidth, latency, synchronization, stragglers, data supply, and node boundaries create a distribution tax that can dominate saved compute.
:::

:::expand[What Must a Distributed Checkpoint Preserve for Recovery?]{kind="recap"}
Recovery may require model, optimizer, scheduler, precision, random, sampler, topology, data, and sharding state, sometimes with resharding for a new world size.
:::

:::expand[How Do Frameworks and Training Pipelines Manage Distributed Jobs?]{kind="recap"}
Compute frameworks distribute model work, job frameworks launch workers, platforms manage clusters, and the pipeline controls the surrounding request, data, checkpoint, evaluation, and release lifecycle.
:::

:::expand[How Do Scaling Experiments Measure Useful Distributed Work?]{kind="recap"}
Matched runs across increasing device counts record throughput, phase timing, rank imbalance, memory, cost, quality, and scaling efficiency.
:::

:::expand[How Do You Choose the Smallest Distributed Strategy That Meets the Constraint?]{kind="recap"}
The chosen strategy partitions only what the measured constraint requires and stops scaling when added coordination costs exceed useful time, memory, or economic value.
:::

## References

[1]: https://docs.pytorch.org/docs/stable/distributed.html "Distributed communication package - torch.distributed — PyTorch 2.13 documentation"
[2]: https://www.deepspeed.ai/tutorials/zero/ "Zero Redundancy Optimizer - DeepSpeed"
[3]: https://docs.pytorch.org/tutorials/distributed.html "Distributed — PyTorch Tutorials 2.13.0+cu130 documentation"
[4]: https://www.deepspeed.ai/tutorials/zero/ "Zero Redundancy Optimizer - DeepSpeed"
[5]: https://docs.ray.io/en/latest/train/overview.html "Ray Train Overview — Ray 2.56.0"
[6]: https://docs.ray.io/en/latest/train/deepspeed.html "Get Started with DeepSpeed — Ray 2.55.1"
[7]: https://docs.aws.amazon.com/sagemaker/latest/dg/distributed-training.html "Distributed training in Amazon SageMaker AI - Amazon SageMaker AI"
[8]: https://docs.ray.io/en/latest/train/user-guides/data-loading-preprocessing.html "Data Loading and Preprocessing — Ray 2.57.0"
