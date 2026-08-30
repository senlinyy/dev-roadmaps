---
title: "Choosing CPU or GPU Training"
description: "Choose training hardware from workload shape, memory fit, measured bottlenecks, end-to-end completion time, cost, and reproducibility evidence."
overview: "CPU and GPU training suit different kinds of work. This guide builds a hardware decision from model operations, batchability, memory, precision, data movement, profiling, platform scheduling, cost, and verified training outcomes."
tags: ["MLOps", "advanced", "compute"]
order: 1
id: "article-mlops-training-pipelines-cpu-vs-gpu-training"
---

## Table of Contents

1. [What Training Objective and Workload Should Drive the Hardware Choice?](#what-training-objective-and-workload-should-drive-the-hardware-choice)
2. [Which Workloads Fit CPUs and GPUs Well?](#which-workloads-fit-cpus-and-gpus-well)
3. [How Do Memory, Batch Size, Precision, and Data Movement Affect GPU Training?](#how-do-memory-batch-size-precision-and-data-movement-affect-gpu-training)
4. [Which Measurements Compare the Complete Training Path?](#which-measurements-compare-the-complete-training-path)
5. [How Do CPU and GPU Work Combine in Managed Training?](#how-do-cpu-and-gpu-work-combine-in-managed-training)
6. [When Should One GPU Scale Up or Scale Out?](#when-should-one-gpu-scale-up-or-scale-out)
7. [How Do Representative Benchmarks Reveal the Real Bottleneck?](#how-do-representative-benchmarks-reveal-the-real-bottleneck)
8. [How Should a Training Pipeline Select and Record Compute Resources?](#how-should-a-training-pipeline-select-and-record-compute-resources)
9. [Check Your Answers](#check-your-answers)

A team moves image-model training to a more expensive GPU and expects a large speedup. The GPU stays idle most of the time because two CPU workers decode and augment only 650 images per second. The accelerator could process thousands, but the next batch is never ready. Buying a faster GPU would increase the bill without fixing the run.

CPU or GPU selection starts with the complete training objective: required model quality, completion deadline, and acceptable total cost. A training step includes reading data, parsing and preprocessing it, moving batches, running forward and backward passes, updating parameters, synchronizing workers, validating, and writing checkpoints. The slowest important part limits the result.

CPUs provide powerful general-purpose cores for irregular and control-heavy work. GPUs provide many execution units for large, regular tensor operations. The right choice depends on workload size, arithmetic intensity, memory, precision, data movement, queue time, and the cost to reach the required quality.

Use the questions below to make the hardware choice from measured work, memory, data movement, completion time, and cost instead of the CPU or GPU label alone:

1. **What Training Objective and Workload Should Drive the Hardware Choice?**
2. **Which Workloads Fit CPUs and GPUs Well?**
3. **How Do Memory, Batch Size, Precision, and Data Movement Affect GPU Training?**
4. **Which Measurements Compare the Complete Training Path?**
5. **How Do CPU and GPU Work Combine in Managed Training?**
6. **When Should One GPU Scale Up or Scale Out?**
7. **How Do Representative Benchmarks Reveal the Real Bottleneck?**
8. **How Should a Training Pipeline Select and Record Compute Resources?**

## What Training Objective and Workload Should Drive the Hardware Choice?
<!-- section-summary: Hardware selection starts with required quality, deadline, and cost, then profiles data preparation, movement, computation, synchronization, and overhead. -->

The label machine learning does not identify the right processor. The choice follows from the result the run must produce and the physical work required to produce it.

Suppose you have a training algorithm:

$$
\theta^* = \text{Train}(D,\; A,\; H)
$$

where:

* $$D$$ = training data
* $$A$$ = algorithm/model
* $$H$$ = hyperparameters
* $$\theta^*$$ = trained parameters

You now have to decide where `Train()` should run. At first glance, the choice seems simple:

```text
CPU = general-purpose
GPU = faster
```

That mental model is misleading. A GPU can be dramatically faster than a CPU for one training workload and slower or much more expensive for another. The useful question is:

> **What work must physically happen to complete this training run, and which machine architecture performs that work most efficiently?**

That leads to a better model:

$$
\boxed{
\text{Training time}
=
\text{data preparation}
+
\text{data movement}
+
\text{computation}
+
\text{synchronization}
+
\text{other overhead}
}
$$

Choosing CPU or GPU means understanding which term dominates. Before choosing hardware, define what you are optimizing.

For example:

```text
Train model M
on dataset D
to validation quality Q
within 2 hours
for less than £20
```

Those constraints matter because there are several possible objectives. You might want to minimize:

$$
\text{wall-clock training time}
$$

or:

$$
\text{compute cost}
$$

or:

$$
\text{time to acceptable validation quality}
$$

or:

$$
\text{cost per successful experiment}
$$

These are not equivalent.

For example:

```text
CPU:
4 hours × £0.50/hour = £2

GPU:
15 minutes × £3/hour = £0.75
```

The GPU is both faster and cheaper. But another workload might look like:

```text
CPU:
3 minutes × £0.50/hour

GPU:
1 minute × £3/hour
```

The GPU is faster, but you may not care about saving two minutes. So the real objective might be:

$$
\boxed{
\text{Choose hardware that satisfies the training requirement at acceptable total cost}
}
$$

not:

$$
\text{Choose the processor with the largest FLOPS number}
$$

A training iteration is not simply:

```text
processor → calculate gradients
```

The complete path often looks like:

```text
Object storage / database
          │
          ▼
       disk/network
          │
          ▼
       CPU memory
          │
    decode / parse
    augment / tokenize
          │
          ▼
      training batch
          │
    CPU → GPU transfer
          │
          ▼
        GPU memory
          │
     forward pass
          │
     backward pass
          │
   optimizer update
          │
          ▼
       next batch
```

This matters enormously. Imagine that the GPU can process a batch in:

```text
40 ms
```

but creating the next batch takes:

```text
120 ms
```

Then the GPU repeatedly does this:

```text
compute ████ 40 ms
wait    ░░░░░░░░░░░░ 120 ms

compute ████
wait    ░░░░░░░░░░░░
```

Buying a GPU twice as fast barely helps. The bottleneck wasn't GPU computation. It was feeding the GPU. A CPU is designed to perform many different kinds of computation efficiently.

Conceptually:

```text
CPU

few powerful cores

Core ───────── complex control
Core ───────── large cache
Core ───────── branch prediction
Core ───────── sophisticated execution
Core ───────── low-latency tasks
```

A GPU is designed around massive parallelism:

```text
GPU

many smaller execution units

■■■■■■■■■■■■■■■■
■■■■■■■■■■■■■■■■
■■■■■■■■■■■■■■■■
■■■■■■■■■■■■■■■■
```

The GPU's advantage emerges when a large number of similar calculations can be performed simultaneously. For example, matrix multiplication:

$$
C = AB
$$

contains enormous numbers of independent multiply-and-add operations. If:

$$
A \in \mathbb{R}^{4096\times4096}
$$

and:

$$
B \in \mathbb{R}^{4096\times4096}
$$

then computing $$C$$ requires roughly:

$$
2 \times 4096^3
$$

floating-point operations. That's about:

$$
137 \text{ billion operations}
$$

and much of that work is highly parallel. This is exactly the sort of computation GPUs are designed to perform. Consider a simple vector operation:

$$
y_i = 3x_i + 7
$$

for ten million independent values. The calculation for:

$$
x_1
$$

doesn't depend on:

$$
x_2
$$

or $$x_3$$, $$x_4$$, and so forth. So thousands of calculations can run at once.

Conceptually:

```text
CPU

core 1 → x1
core 2 → x2
core 3 → x3
...
```

versus:

```text
GPU

unit 1    → x1
unit 2    → x2
unit 3    → x3
...
unit 5000 → x5000
```

The exact hardware is considerably more complicated, but this is the useful intuition. Deep learning contains enormous quantities of this kind of work:

```text
matrix multiplication
convolution
attention
embedding operations
activation functions
gradient calculations
```

Therefore:

$$
\boxed{
\text{large dense tensor operations}
\Rightarrow
\text{GPU-friendly}
}
$$

## Which Workloads Fit CPUs and GPUs Well?
<!-- section-summary: CPUs favor small, irregular, branch-heavy, preprocessing-dominated work; GPUs favor sufficiently large regular tensor operations with optimized kernels. -->

Processor architecture matters only after the workload is large and regular enough to use it efficiently.

Suppose you need to add two numbers:

$$
3 + 5
$$

A GPU technically can do it. But getting the operation onto the GPU may cost vastly more than doing the addition.

Conceptually:

```text
CPU:
calculate → done

GPU:
prepare kernel
send command
possibly transfer data
launch kernel
calculate
synchronize
return result
```

For very small workloads:

$$
\text{GPU overhead} > \text{GPU compute advantage}
$$

So workload **size** matters. A model with:

```text
4,000 rows
20 features
```

may train more efficiently on a CPU even if its algorithm has a GPU implementation. The GPU needs enough work to amortize the overhead of using it. A useful concept is **arithmetic intensity**:

$$
\text{Arithmetic intensity}
=
\frac{\text{amount of computation}}
{\text{amount of data moved}}
$$

Suppose an operation loads huge amounts of data but performs almost no calculations on each byte. It may be limited by memory bandwidth rather than processor arithmetic. Another operation might repeatedly calculate with the same data. That can have high arithmetic intensity. Roughly:

```text
low arithmetic intensity
        ↓
data movement often dominates

high arithmetic intensity
        ↓
compute performance matters more
```

Large neural-network matrix multiplications tend to have favorable characteristics for accelerators because huge quantities of mathematical work can be extracted from large blocks of data. This is one reason:

```text
large Transformer
```

and:

```text
CSV parsing
```

have completely different hardware preferences. Both may be part of the same training pipeline. CPU does **not** mean "slow version of GPU." CPUs are optimized for different kinds of work. CPU training is often appropriate when:

* the dataset is small
* the model is small
* operations aren't massively parallel
* there is significant branching or irregular control flow
* data preprocessing dominates
* GPU startup/transfer overhead would dominate
* a GPU implementation isn't well optimized
* training latency isn't particularly important
* CPU instances are substantially cheaper

Consider a small logistic regression problem:

```text
50,000 examples
30 features
```

The entire problem might fit comfortably in cache or RAM and finish quickly on a CPU. Launching an expensive accelerator may accomplish almost nothing useful. Likewise, many classical ML workflows work very well on CPUs:

```text
linear models
many scikit-learn algorithms
small gradient-boosting jobs
small random forests
small tabular experiments
feature preprocessing
data validation
```

Although some of these algorithms also have excellent GPU implementations at larger scales. The model family alone therefore doesn't determine the answer. Size and implementation matter. Consider training a neural network. A layer might calculate:

$$
Y = XW + b
$$

where $$X$$ contains a whole batch. Then backpropagation requires more large matrix operations. A modern network performs variations of these calculations over and over:

```text
forward

matrix multiply
activation
matrix multiply
normalization
attention
...

backward

gradient
gradient
gradient
...

optimizer

parameter updates
```

Hundreds, thousands, or millions of large tensor operations occur during training. This gives GPUs enough parallel work to remain busy. So a useful heuristic is:

> **Large batches of regular numerical computation usually favor GPUs. Small, irregular or control-heavy workloads often favor CPUs.**

People sometimes say:

"My dataset is huge, therefore I need a GPU."

Not necessarily. Suppose you have:

```text
2 TB of data
```

but the algorithm mostly performs:

```text
parsing
hashing
sorting
grouping
branch-heavy logic
```

The workload might remain CPU-heavy. Conversely, suppose you have a modest dataset but train a computationally expensive neural network over it for hundreds of epochs. The dataset may be small enough to fit in RAM, while the model's mathematical workload strongly favors GPUs. So distinguish:

$$
\text{data volume}
$$

from:

$$
\text{compute volume}
$$

and:

$$
\text{model memory footprint}
$$

They are separate constraints.

![A training step moves stored examples through CPU reading, decoding, batching, host memory, device transfer, GPU memory, parallel tensor computation, and CPU-coordinated logging, evaluation, and checkpointing.](/content-assets/articles/article-mlops-training-pipelines-cpu-vs-gpu-training/cpu-gpu-training-step.png)

*CPU and GPU are parts of one training path. The slowest read, transform, transfer, compute, or coordination stage sets end-to-end throughput.*

## How Do Memory, Batch Size, Precision, and Data Movement Affect GPU Training?
<!-- section-summary: Training-state memory, activation memory, batch size, numeric precision, preprocessing, transfer, and prefetching determine whether the accelerator can stay productive. -->

Even a GPU-friendly model can fail to fit or remain idle because training state, batches, preprocessing, and transfers consume memory and time.

A GPU has its own memory, usually called accelerator memory or VRAM. Training needs more memory than just storing the model. A rough decomposition is:

$$
M_{\text{training}}
=
M_{\text{parameters}}
+
M_{\text{gradients}}
+
M_{\text{optimizer}}
+
M_{\text{activations}}
+
M_{\text{batch}}
+
M_{\text{workspace}}
$$

That distinction is important. Suppose model parameters consume:

```text
8 GB
```

It does **not** follow that an 8 GB GPU can train the model. You might need:

```text
Parameters          8 GB
Gradients           8 GB
Optimizer state    16 GB
Activations        12 GB
Temporary buffers   3 GB
--------------------------------
Total              47 GB
```

The precise numbers depend heavily on framework, optimizer, precision, architecture and batch size. But the principle remains:

**Training memory is much larger than model-file size.**

Suppose one training example requires $$m$$ bytes of activation memory. With batch size $$B$$:

$$
M_{\text{activations}} \approx Bm
$$

Increasing batch size therefore tends to increase memory use. But larger batches can also give the GPU more parallel work:

```text
batch = 1

GPU:
■■□□□□□□□□□□□□□□

batch = 256

GPU:
■■■■■■■■■■■■■■■■
```

So you often face a tradeoff:

```text
larger batch
    ↓
more GPU parallelism
    ↓
better throughput

but

larger batch
    ↓
more memory
```

The largest batch that physically fits is not automatically the statistically best batch, either. Batch size also changes optimization dynamics. Hardware decisions and ML experiment decisions therefore interact. Suppose a parameter is stored using 32 bits. A billion parameters alone require approximately:

$$
10^9 \times 4 \text{ bytes} = 4\text{ GB}
$$

If some computation/storage can safely use 16-bit values:

$$
10^9 \times 2 \text{ bytes} = 2\text{ GB}
$$

So numeric precision affects:

```text
memory
memory bandwidth
compute throughput
numerical stability
final model behavior
```

Training might involve:

```text
FP32
FP16
BF16
FP8 in selected operations
mixed precision
```

depending on the model and hardware. Modern accelerators often have specialized hardware that performs lower-precision tensor operations much faster. Consequently:

$$
\text{hardware choice}
\leftrightarrow
\text{precision choice}
$$

They're not completely separate decisions. But lowering precision is not merely an infrastructure optimization. It can alter numerical behavior. Therefore record precision in the experiment metadata just like:

```text
learning rate
batch size
optimizer
model architecture
```

Suppose the GPU can perform the actual training calculation for each batch in:

$$
20\text{ ms}
$$

But getting the batch ready takes:

```text
read from storage    50 ms
decode               40 ms
augmentation         30 ms
CPU→GPU transfer     10 ms
GPU compute          20 ms
```

Naively:

$$
T_{\text{batch}} = 150\text{ ms}
$$

Only:

$$
\frac{20}{150} \approx 13\%
$$

of the time is spent doing GPU computation. Even an infinitely fast GPU could only eliminate those 20 ms. The maximum possible improvement would therefore be limited. This is an instance of a broader principle similar to Amdahl's law:

Improving a component doesn't substantially improve the whole system when that component isn't the dominant cost.

A poorly designed loop does this:

```text
load batch 1
process batch 1
send batch 1
train batch 1

load batch 2
process batch 2
send batch 2
train batch 2
```

The GPU sits idle during loading. Instead overlap operations:

```text
CPU:
prepare batch 2 ────────────────┐
                                │
GPU:
              train batch 1 ────┤
                                │
CPU:
                    prepare 3 ──┤
                                │
GPU:
                           train 2
```

Common techniques include:

* multiple data-loader workers
* asynchronous prefetching
* pinned host memory where appropriate
* efficient batch formats
* caching
* moving expensive transformations offline
* overlapping transfer and compute

The goal is:

```text
GPU completes batch N
        ↓
batch N+1 is already available
```

not:

```text
GPU completes batch N
        ↓
everyone now starts looking for the next batch
```

## Which Measurements Compare the Complete Training Path?
<!-- section-summary: Utilization is diagnostic; representative end-to-end benchmarks compare throughput, time and cost to target quality, queue time, failures, and total pipeline work. -->

Those bottlenecks make isolated FLOPS or utilization numbers insufficient; the benchmark has to follow the complete path to an acceptable model.

Suppose monitoring shows:

```text
GPU utilization = 35%
```

That might mean the GPU is underfed. But now imagine:

```text
GPU utilization = 98%
```

Is everything optimal? Not necessarily. The GPU might be working constantly but inefficiently.

For example:

```text
Configuration A:
GPU utilization 98%
1,000 examples/sec

Configuration B:
GPU utilization 92%
1,800 examples/sec
```

Configuration B is clearly better for training throughput. Therefore look at utilization alongside meaningful application metrics:

$$
\text{examples/sec}
$$

$$
\text{tokens/sec}
$$

$$
\text{steps/sec}
$$

$$
\text{seconds/epoch}
$$

$$
\text{time-to-target-quality}
$$

and ultimately:

$$
\text{cost-to-target-quality}
$$

Hardware utilization is a diagnostic metric. Training throughput is an outcome metric. A common hardware benchmark measures something like:

```text
matrix multiplication throughput
```

But your system isn't being paid to multiply matrices. It's being paid to produce a model. So benchmark:

```text
dataset retrieval
        ↓
preprocessing
        ↓
training
        ↓
validation
        ↓
checkpointing
        ↓
final model
```

For example:

| Configuration | Epoch time | Total training |  Cost | Target quality |
| ------------- | ---------: | -------------: | ----: | -------------- |
| 16 CPU cores  |     18 min |         3h 00m | £5.40 | reached        |
| 1 GPU         |      4 min |         40 min | £2.80 | reached        |
| 4 GPUs        |      2 min |         25 min | £8.50 | reached        |

Four GPUs are fastest. But one GPU may have the best cost/performance. Your choice depends on whether:

```text
25 minutes vs 40 minutes
```

is worth:

```text
£8.50 vs £2.80
```

Suppose:

```text
CPU machine:
£1/hour

GPU machine:
£5/hour
```

It's tempting to conclude:

```text
CPU is five times cheaper.
```

But if:

```text
CPU takes 10 hours
GPU takes 1 hour
```

then:

$$
C_{\text{CPU}} = 10 \times £1 = £10
$$

while:

$$
C_{\text{GPU}} = 1 \times £5 = £5
$$

The GPU is cheaper. A better metric is:

$$
\boxed{
\text{Run cost}
=
\text{resource price}
\times
\text{resource duration}
+
\text{associated infrastructure cost}
}
$$

Even better:

$$
\boxed{
\text{Cost per successful model}
}
$$

because failures matter too. Suppose unstable 8-GPU training succeeds only 70% of the time while 2-GPU training succeeds 99% of the time. The theoretical throughput advantage of eight GPUs may disappear once retries are counted. Imagine:

```text
GPU A reaches validation accuracy 90% in 40 min.

GPU B reaches validation accuracy 90% in 55 min.
```

GPU A seems better. But perhaps B costs one-third as much. Or perhaps you are comparing different batch sizes and optimization behavior:

```text
Hardware A:
2,000 samples/sec
needs 50 epochs

Hardware B:
1,500 samples/sec
needs 35 epochs
```

The proper objective is often:

$$
\text{time to target metric}
$$

rather than:

$$
\text{time per epoch}
$$

because the purpose of training is not to complete epochs. It is to obtain an acceptable model.

## How Do CPU and GPU Work Combine in Managed Training?
<!-- section-summary: CPU workers feed and coordinate accelerators, while managed services and Kubernetes place requested resources without deciding whether the workload benefits from them. -->

Real accelerator jobs also rely on CPUs and a scheduling platform, so placement and the data path remain part of the design.

A GPU training machine still has CPUs. A healthy architecture might look like:

```text
               TRAINING NODE

storage
   │
   ▼
CPU cores
 ├── read data
 ├── decode
 ├── tokenize
 ├── augment
 └── construct batches
          │
          ▼
       GPU memory
          │
          ▼
         GPU
 ├── matrix multiplication
 ├── attention
 ├── forward pass
 └── backward pass
```

So the practical question is frequently:

How much CPU capacity should accompany each GPU

If your accelerator is starving because two CPU cores can't preprocess data quickly enough, upgrading the GPU is the wrong intervention. A rough starting map is useful.

| Workload                                    | Likely starting point       |
| ------------------------------------------- | --------------------------- |
| Tiny tabular experiment                     | CPU                         |
| Logistic regression on modest data          | CPU                         |
| Small decision tree                         | CPU                         |
| Data preprocessing                          | CPU                         |
| Large gradient boosting workload            | Benchmark CPU and GPU       |
| CNN training                                | GPU                         |
| Transformer training                        | GPU                         |
| Large language-model fine-tuning            | GPU/accelerator             |
| Large embedding computation                 | Often GPU                   |
| Hyperparameter search over many tiny models | Many CPUs may be excellent  |
| One huge neural model                       | GPU, possibly multiple GPUs |

These aren't laws. They are hypotheses to benchmark. Suppose you have 100 independent training configurations:

```text
learning_rate = ...
depth = ...
regularization = ...
```

Each model itself may be small. You have two kinds of parallelism available:

### Within one model

```text
one training run
        ↓
use a GPU to accelerate its math
```

### Across models

```text
experiment 1 → CPU
experiment 2 → CPU
experiment 3 → CPU
...
experiment 100 → CPU
```

If each individual model takes two minutes on a CPU, distributing experiments across many cheap CPU workers can outperform putting them sequentially on one GPU. So always ask:

Where does the parallelism exist

It might exist inside one training job. Or across many training jobs. Cloud training services can provision machines, attach storage, stream logs, checkpoint models and tear machines down afterward.

Conceptually:

```text
Training Request
      │
      ▼
Orchestrator
      │
      ▼
request:
CPU = 16
RAM = 64 GB
GPU = 1
GPU type = ...
      │
      ▼
Managed compute platform
      │
      ▼
training container
```

The managed platform solves lifecycle problems. It doesn't solve hardware selection automatically. You still need to know whether:

```text
1 GPU
```

beats:

```text
32 CPU cores
```

for your workload. In Kubernetes-like systems, a training workload can conceptually request:

```text
CPU: 8
RAM: 32 GiB
GPU: 1
```

The scheduler then needs a node capable of satisfying those resources. So:

```text
Pod requests GPU
        │
        ▼
scheduler finds GPU node
        │
        ▼
device allocated
        │
        ▼
container starts
```

Two important concerns appear here. First is **placement**:

```text
Where can this job run
```

Second is **training performance**:

```text
Is that hardware actually appropriate
```

Those are different problems. Kubernetes successfully placing your job onto a GPU doesn't mean using a GPU was a good decision. Suppose CPUs are readily available:

```text
CPU queue = 10 seconds
```

but GPUs are heavily contested:

```text
GPU queue = 45 minutes
```

Training itself might take:

```text
CPU training = 35 minutes

GPU training = 5 minutes
```

If you're optimizing end-to-end completion:

```text
CPU:
10 sec queue + 35 min training ≈ 35 min

GPU:
45 min queue + 5 min training = 50 min
```

The CPU produces the model sooner. Thus:

$$
\text{job completion latency}
=
\text{queue latency}
+
\text{startup}
+
\text{training latency}
$$

Infrastructure availability belongs in your hardware decision.

![CPU candidates suit irregular work, small models, feature preparation, and short runs, while GPU candidates suit dense tensor operations, regular batches, supported operators, and device-memory fit; both feed the same matched benchmark.](/content-assets/articles/article-mlops-training-pipelines-cpu-vs-gpu-training/match-workload-to-hardware.png)

*Workload shape suggests CPU or GPU candidates. A matched benchmark compares time to required quality, peak memory, queue-to-artifact time, and full cost before the team selects the operating default.*

## When Should One GPU Scale Up or Scale Out?
<!-- section-summary: Multiple GPUs add memory and compute along with communication, synchronization, failure, cost, and reproducibility concerns; scaling efficiency measures the trade. -->

If one accelerator cannot satisfy memory or deadline requirements, the team can compare a larger device with several cooperating devices.

Suppose one GPU trains the model in:

```text
100 minutes
```

You might imagine:

```text
2 GPUs → 50 minutes
4 GPUs → 25 minutes
8 GPUs → 12.5 minutes
```

Real systems rarely scale perfectly. Why? Multiple GPUs must coordinate. For data-parallel training:

```text
GPU 1 ─┐
GPU 2 ─┤
GPU 3 ─┼→ synchronize gradients
GPU 4 ─┘
```

Synchronization costs time. So a simplified model becomes:

$$
T(N)
=
\frac{T_{\text{parallel compute}}}{N}
+
T_{\text{communication}}(N)
+
T_{\text{serial}}
$$

As $$N$$ increases, computation per GPU falls. But communication may increase. Eventually adding another GPU barely helps. Suppose:

```text
1 GPU → 1,000 examples/sec
2 GPU → 1,850 examples/sec
4 GPU → 3,200 examples/sec
8 GPU → 4,500 examples/sec
```

Calculate speedup:

$$
S(N)=\frac{\text{throughput}(N)}
{\text{throughput}(1)}
$$

Then:

```text
2 GPUs → 1.85×
4 GPUs → 3.20×
8 GPUs → 4.50×
```

Scaling efficiency:

$$
E(N)=\frac{S(N)}{N}
$$

gives:

```text
2 GPUs → 92.5%
4 GPUs → 80.0%
8 GPUs → 56.25%
```

Eight GPUs are faster. But you're paying for eight GPUs to obtain only 4.5 times the throughput. That may or may not make economic sense. **Scale up** means use a more powerful device:

```text
smaller GPU → larger GPU
```

**Scale out** means use more devices:

```text
1 GPU → 2 → 4 → 8 GPUs
```

Scaling up often preserves a simpler programming model. Scaling out introduces:

```text
network communication
gradient synchronization
distributed failure modes
worker coordination
distributed checkpointing
```

So if one larger accelerator can meet the requirement economically, it may be simpler than distributing across several smaller accelerators. But large models may simply not fit on one device. Then scaling out becomes necessary rather than optional. Consider a model needing:

```text
120 GB of training state
```

If your GPU has:

```text
80 GB
```

the question is no longer:

```text
Would multiple GPUs make this faster
```

It's:

```text
Can this training run exist at all on one GPU
```

You may need techniques such as:

```text
data parallelism
model/tensor parallelism
pipeline parallelism
sharded optimizer state
activation checkpointing
CPU offloading
```

These techniques trade among:

$$
\text{memory}
\leftrightarrow
\text{computation}
\leftrightarrow
\text{communication}
$$

For example, activation checkpointing reduces stored activation memory but recomputes some values during the backward pass. So you spend computation to save memory. Ideally:

```text
same data
same code
same hyperparameters
same random seed
```

would produce exactly the same model. In numerical computing, that is not always true. Different hardware can introduce differences through:

```text
floating-point rounding
parallel reduction order
different kernels
library versions
mixed precision
non-deterministic algorithms
```

For example, mathematically:

$$
(a+b)+c = a+(b+c)
$$

But floating-point arithmetic has finite precision, so computationally the two can produce slightly different results. Parallel hardware may change reduction ordering. Those tiny differences can propagate through many optimization steps. Therefore reproducibility has levels.

### Exact reproducibility

```text
bit-identical output
```

This can be expensive or impossible for some configurations.

### Statistical reproducibility

```text
similar quality and behavior
within defined tolerances
```

This is often more practical in ML. Record enough metadata to understand differences:

```text
CPU/GPU model
GPU count
driver/runtime versions
framework version
precision mode
determinism settings
random seeds
container image
dataset snapshot
code commit
```

Suppose you trained:

```text
Experiment A
GPU X
FP32
batch size 32
```

and then:

```text
Experiment B
GPU Y
BF16
batch size 256
```

If validation performance changes, you haven't only changed infrastructure. You may have changed:

```text
numerical behavior
batch-size dynamics
gradient noise
number of updates
kernel implementations
```

That means hardware changes sometimes cross the boundary into experimental changes. Do not treat all infrastructure substitutions as invisible.

## How Do Representative Benchmarks Reveal the Real Bottleneck?
<!-- section-summary: Matched experiments reveal whether data loading, CPU, memory, GPU compute, storage, network, or communication actually limits completion. -->

Scaling decisions should come from matched measurements, not from assumptions based on dataset size or model family alone.

Instead of guessing CPU vs GPU, start with representative experiments.

For example:

```text
Configuration A
16 CPU
64 GB RAM
no GPU

Configuration B
16 CPU
64 GB RAM
1 GPU

Configuration C
32 CPU
128 GB RAM
1 faster GPU
```

Run the **same training specification**. Measure:

```text
startup time
data-loading time
training throughput
validation time
peak RAM
peak GPU memory
CPU utilization
GPU utilization
total wall time
total cost
final validation quality
```

Then compare. The critical rule is:

Benchmark with representative data, model sizes and preprocessing.

A benchmark using 1% of the dataset can favor CPU because the accelerator has insufficient work. The full-scale workload might behave completely differently. Suppose your training job takes 100 minutes:

```text
data preparation       45 min
GPU computation        40 min
validation             10 min
checkpoint upload       5 min
```

You replace the GPU with one twice as fast. Best-case result:

```text
data preparation       45 min
GPU computation        20 min
validation             10 min
checkpoint upload       5 min

total                   80 min
```

You doubled GPU performance but improved total runtime only:

$$
100 \rightarrow 80
$$

or 20%. The first question should therefore be:

$$
\boxed{\text{What is limiting throughput right now?}}
$$

Possible answers include:

```text
CPU
GPU compute
GPU memory
host RAM
disk
object storage
network
CPU→GPU transfer
distributed communication
data-loader workers
checkpoint writes
```

Hardware choice follows bottleneck identification. Not the other way around. A training pipeline can make the choice systematically. Start here:

```text
What model and training objective
             │
             ▼
Is the computation highly parallel
and supported by optimized GPU kernels
         /             \
       no               yes
       │                 │
       ▼                 ▼
start CPU         Is workload large enough
                  to amortize GPU overhead
                       /        \
                     no          yes
                     │            │
                     ▼            ▼
                start CPU    Does it fit
                             GPU memory
                              /      \
                            yes       no
                            │          │
                            ▼          ▼
                        benchmark    reduce memory,
                                     bigger GPU,
                                     or distribute
```

Then regardless of that initial choice:

```text
measure full pipeline
      ↓
identify bottleneck
      ↓
measure time-to-quality
      ↓
measure cost-to-quality
      ↓
change hardware only if measurements justify it
```

Imagine:

```text
dataset: 300,000 rows
features: 80
algorithm: gradient boosting
training target: under 10 minutes
```

CPU result:

```text
16 cores
training = 90 sec
cost = £0.04
```

GPU result:

```text
1 accelerator
initialization + transfer = 8 sec
training = 22 sec
cost = £0.10
```

The GPU is faster. But both are far below the ten-minute requirement. If cost and simplicity matter more, CPU may be the rational choice. The answer is not:

```text
GPU won the benchmark.
```

It is:

```text
Both meet the objective.
CPU satisfies it more economically/simply.
```

Now imagine:

```text
dataset: 100 million examples
model: deep neural network
parameters: 800 million
```

CPU:

```text
estimated training time:
several days
```

GPU:

```text
training time:
hours
```

The mathematical workload contains enormous tensor operations, so the accelerator's parallelism dominates its startup and transfer overhead. Here the answer is likely unambiguous:

```text
GPU
```

Then the optimization question becomes:

```text
Which GPU
How much memory
What precision
What batch size
How many GPUs
```

Suppose you migrate a model from CPU to GPU. You observe:

```text
CPU training:
500 samples/sec

GPU training:
650 samples/sec
```

You expected 10×. Monitoring shows:

```text
GPU utilization: 18%
CPU utilization: 100%
```

Now inspect the pipeline:

```text
JPEG read
   ↓
JPEG decode
   ↓
random crop
   ↓
resize
   ↓
augmentation
   ↓
batch creation
   ↓
GPU
```

The CPU data pipeline can only generate:

```text
650 samples/sec
```

The GPU could process:

```text
5,000 samples/sec
```

but never receives enough work. So replacing the GPU again won't help. You might instead:

```text
increase data-loader workers
cache decoded inputs
precompute transformations
use faster storage
parallelize augmentation
prefetch batches
```

Then perhaps:

```text
GPU throughput:
4,200 samples/sec
```

Same GPU. Completely different result. Suppose:

```text
1 GPU
training time = 4 hours
price = £2/hour

cost = £8
```

Four GPUs:

```text
training time = 1.5 hours
price = £8/hour

cost = £12
```

The four-GPU system is:

$$
\frac{4}{1.5} \approx 2.67\times
$$

faster, not 4× faster. If your objective says:

```text
must finish within 2 hours
```

then four GPUs may be required. If your objective says:

```text
must finish before tomorrow morning
```

then one GPU may be the better choice. The same benchmark can therefore lead to different hardware decisions depending on the actual objective.

## How Should a Training Pipeline Select and Record Compute Resources?
<!-- section-summary: A resource specification records eligibility, performance, economics, precision, data-loader support, and environment evidence for the measured workload. -->

The pipeline can then turn the selected evidence into an explicit resource contract and preserve the hardware environment with the run.

Once you understand the workload, resource choice becomes part of orchestration. A training specification might conceptually say:

```text
model:
    recommendation_transformer

resources:
    cpu: 16
    memory: 128 GB
    gpu: 1
    accelerator_memory_required: >= 40 GB

precision:
    bf16

data_loader:
    workers: 12

execution:
    timeout: 6 hours
```

A different model might say:

```text
model:
    churn_logistic_regression

resources:
    cpu: 8
    memory: 32 GB
    gpu: 0
```

This is healthier than blindly putting every ML workload onto GPU nodes. A clean training platform distinguishes three related decisions.

### Resource eligibility

Can the job run there?

```text
model needs 42 GB accelerator memory
GPU has 24 GB

→ impossible
```

### Resource performance

Will it run efficiently there

```text
model fits

but GPU utilization = 12%
because input pipeline is slow

→ technically possible, operationally poor
```

### Resource economics

Is the improvement worth the price?

```text
GPU:
10 min, £1.20

CPU:
14 min, £0.08

→ depends on your objective
```

Those questions should not be collapsed into:

"Does this framework support GPU?"

The CPU/GPU decision becomes much clearer if you stop imagining training as a single calculation. Think of it as a flow of bytes and operations:

```text
               BYTES                           OPERATIONS

storage
   │
   │ read
   ▼
host memory
   │
   │ preprocessing ───────────→ CPU computation
   │
   │ transfer
   ▼
accelerator memory
   │
   │ tensors ─────────────────→ GPU computation
   │
   │ gradients
   ▼
model state
   │
   │ checkpoints
   ▼
storage
```

Every arrow has:

```text
bandwidth
latency
capacity
cost
```

Every computation has:

```text
parallelism
precision
memory requirements
runtime
```

Your training speed is controlled by whichever resource becomes the bottleneck. Do not ask:

**"Are GPUs better for machine learning?"**

Ask:

**"Where is the work in this training pipeline, and what hardware makes that work finish under my objective?"**

The basic reasoning chain is:

$$
\boxed{
\text{training objective}
\rightarrow
\text{workload shape}
\rightarrow
\text{data movement}
\rightarrow
\text{memory requirement}
\rightarrow
\text{hardware candidate}
\rightarrow
\text{benchmark}
\rightarrow
\text{cost/time-to-quality}
}
$$

Use CPUs when powerful general-purpose cores, large host memory, irregular computation, small workloads, or low cost are the better match. Use GPUs when training exposes enough large-scale parallel tensor computation to justify moving data onto an accelerator and keeping that accelerator busy. And once one GPU becomes insufficient, don't automatically add more. First determine whether you're constrained by **compute, memory, data loading, communication, or the deadline**. The strongest invariant for a training platform is therefore:

$$
\boxed{
\text{Choose resources from measured end-to-end training behavior,
not from the label “machine learning.”}
}
$$

A GPU is not inherently the faster training machine. It is an extraordinarily effective machine for a particular shape of computation. The job of a well-designed training pipeline is to recognize when the workload actually has that shape.

![A six-step hardware decision moves from the training objective through profiling, hardware fit, bottleneck repair, and matched benchmarking to the smallest reliable operating configuration, with quality, time, cost, and reproducibility evidence kept with the run.](/content-assets/articles/article-mlops-training-pipelines-cpu-vs-gpu-training/choose-training-hardware-evidence.png)

*The hardware choice starts with the training objective, then follows profiling, fit, bottleneck repair, and a matched benchmark. The run record keeps the evidence required to reproduce the decision.*

## Check Your Answers

Use these short answers to revisit the reasoning behind each section.

:::expand[What Training Objective and Workload Should Drive the Hardware Choice?]{kind="recap"}
Hardware selection starts with required quality, deadline, and cost, then profiles data preparation, movement, computation, synchronization, and overhead.
:::

:::expand[Which Workloads Fit CPUs and GPUs Well?]{kind="recap"}
CPUs favor small, irregular, branch-heavy, preprocessing-dominated work; GPUs favor sufficiently large regular tensor operations with optimized kernels.
:::

:::expand[How Do Memory, Batch Size, Precision, and Data Movement Affect GPU Training?]{kind="recap"}
Training-state memory, activation memory, batch size, numeric precision, preprocessing, transfer, and prefetching determine whether the accelerator can stay productive.
:::

:::expand[Which Measurements Compare the Complete Training Path?]{kind="recap"}
Utilization is diagnostic; representative end-to-end benchmarks compare throughput, time and cost to target quality, queue time, failures, and total pipeline work.
:::

:::expand[How Do CPU and GPU Work Combine in Managed Training?]{kind="recap"}
CPU workers feed and coordinate accelerators, while managed services and Kubernetes place requested resources without deciding whether the workload benefits from them.
:::

:::expand[When Should One GPU Scale Up or Scale Out?]{kind="recap"}
Multiple GPUs add memory and compute along with communication, synchronization, failure, cost, and reproducibility concerns; scaling efficiency measures the trade.
:::

:::expand[How Do Representative Benchmarks Reveal the Real Bottleneck?]{kind="recap"}
Matched experiments reveal whether data loading, CPU, memory, GPU compute, storage, network, or communication actually limits completion.
:::

:::expand[How Should a Training Pipeline Select and Record Compute Resources?]{kind="recap"}
A resource specification records eligibility, performance, economics, precision, data-loader support, and environment evidence for the measured workload.
:::
