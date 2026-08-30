---
title: "Inference Optimization and Accuracy Gates"
description:
  "Find the real inference bottleneck, optimize the correct layer, measure
  realistic load, and prove that faster execution preserves model and product
  quality."
overview:
  "Inference optimization changes some part of the path from an incoming request
  to a returned prediction, including the optimization layers, model export,
  graph partitioning, reduced precision, representative benchmarks,
  accuracy gates, and safe production release."
tags: ["MLOps", "advanced", "performance"]
order: 4
id: "article-mlops-model-serving-inference-optimization-accuracy-gates"
---

## Table of Contents

1. [What Product Constraint and Bottleneck Should an Inference Optimization Address?](#what-product-constraint-and-bottleneck-should-an-inference-optimization-address)
2. [How Do Export, Operator Coverage, Fusion, Shapes, and Engine Caches Create a New Candidate?](#how-do-export-operator-coverage-fusion-shapes-and-engine-caches-create-a-new-candidate)
3. [How Do Lower Precision and Model Type Change Accuracy Equivalence?](#how-do-lower-precision-and-model-type-change-accuracy-equivalence)
4. [How Should Workload Distributions and Service Benchmarks Measure the Performance Envelope?](#how-should-workload-distributions-and-service-benchmarks-measure-the-performance-envelope)
5. [How Do Accuracy Gates, Slices, Shadow Traffic, Canaries, Hardware, and Rollback Control Release?](#how-do-accuracy-gates-slices-shadow-traffic-canaries-hardware-and-rollback-control-release)
6. [How Do Benchmark Ladders and Resource Counters Separate Real Gains from Noise?](#how-do-benchmark-ladders-and-resource-counters-separate-real-gains-from-noise)
7. [How Do Worked Examples and a Pareto Frontier Guide Iterative Optimization?](#how-do-worked-examples-and-a-pareto-frontier-guide-iterative-optimization)
8. [Why Are Accuracy Gates Inseparable from Inference Optimization?](#why-are-accuracy-gates-inseparable-from-inference-optimization)
9. [Check Your Answers](#check-your-answers)

A team converts a model to lower precision and measures a 30% faster kernel. The full service improves by only 4%, one rare segment crosses a decision threshold more often, and cold startup takes longer because a new engine must compile. The optimization moved several constraints at once.

Inference optimization changes an executable prediction system under product limits for quality, latency, throughput, memory, and cost. Export, fusion, quantization, shape assumptions, engine caches, and hardware paths all create a new candidate that needs both performance evidence and accuracy gates.

These questions follow the optimization loop from profiling the real bottleneck to a canary-ready Pareto choice:

1. **What Product Constraint and Bottleneck Should an Inference Optimization Address?**
2. **How Do Export, Operator Coverage, Fusion, Shapes, and Engine Caches Create a New Candidate?**
3. **How Do Lower Precision and Model Type Change Accuracy Equivalence?**
4. **How Should Workload Distributions and Service Benchmarks Measure the Performance Envelope?**
5. **How Do Accuracy Gates, Slices, Shadow Traffic, Canaries, Hardware, and Rollback Control Release?**
6. **How Do Benchmark Ladders and Resource Counters Separate Real Gains from Noise?**
7. **How Do Worked Examples and a Pareto Frontier Guide Iterative Optimization?**
8. **Why Are Accuracy Gates Inseparable from Inference Optimization?**

## What Product Constraint and Bottleneck Should an Inference Optimization Address?
<!-- section-summary: Optimization is a constrained product problem, so profiling the full request and applying Amdahl's law identifies the limiting resource worth changing. -->

A faster kernel is irrelevant when another stage dominates the product deadline, so optimization starts from the constraint and measured bottleneck.

Inference optimization begins with a tension. You have some model that produces useful predictions:

$$
y = F(x)
$$

but serving it consumes finite resources:

$$
\text{time},\quad
\text{compute},\quad
\text{memory},\quad
\text{bandwidth},\quad
\text{money}.
$$

You therefore transform the serving system so that predictions are produced faster or more cheaply. The danger is that many optimizations also change the actual computation. After optimization, you may no longer be running exactly $$F$$. You may instead be running:

$$
\tilde F(x).
$$

Perhaps $$\tilde F$$ uses:

* lower numerical precision;
* fused operators;
* a different compiler;
* different kernels;
* quantized weights;
* an exported graph;
* different batching;
* a different accelerator;
* approximate algorithms.

The central question therefore becomes:

$$
\boxed{
\text{Is }\tilde F\text{ cheaper/faster enough, while remaining equivalent enough to }F
}
$$

That is the foundation of both **inference optimization** and **accuracy gates**. A common mistake is thinking:

Optimization means making inference as fast as possible.

That is not the actual goal. Suppose the original service has:

$$
p99 = 900\text{ ms}
$$

and costs:

$$
\$0.01/\text{prediction}.
$$

An optimized implementation produces:

$$
p99 = 250\text{ ms}
$$

and costs:

$$
\$0.003/\text{prediction}.
$$

Excellent—unless model quality falls so much that customers no longer trust it. The real optimization problem looks more like:

$$
\min \text{Cost}
$$

subject to:

$$
L_{p99}\le L_{\max},
$$

$$
Q\ge Q_{\min},
$$

$$
E\le E_{\max},
$$

where:

* $$L$$ = latency,
* $$Q$$ = model/product quality,
* $$E$$ = error or failure rate.

Or perhaps you want:

$$
\max \text{Throughput}
$$

under those same constraints. So optimization means:

$$
\boxed{
\text{improve efficiency without leaving the product's acceptable operating region}
}
$$

not simply "produce a bigger benchmark number." Before modifying the model, ask what actually matters to the product. Consider three systems. A recommendation batch job might tolerate:

$$
5\text{ seconds}
$$

per batch but care intensely about infrastructure cost. An autocomplete service might require:

$$
p99 < 100\text{ ms}
$$

even if GPUs sit partially idle. A fraud detector might tolerate moderate latency but require extremely strict false-negative behavior. These systems should not use the same optimization objective. A useful abstraction is:

$$
\text{Objective}
=
f(
\text{latency},
\text{throughput},
\text{cost},
\text{quality},
\text{reliability}
).
$$

Before optimizing, define the boundaries.

For example:

$$
p99 < 300ms
$$

$$
\text{accuracy drop}<0.2\%
$$

$$
\text{critical-class recall drop}<0.05\%
$$

$$
\text{cost/result}<\$0.002.
$$

Now you know what "better" means. Suppose an API request takes:

$$
500ms.
$$

You discover model execution takes:

$$
80ms.
$$

Optimizing the model from 80 ms to 40 ms cannot make the whole request 2× faster. Original latency:

$$
500ms.
$$

Maximum saving:

$$
40ms.
$$

New latency:

$$
460ms.
$$

Only an 8% improvement. This follows from a fundamental rule:

$$
\boxed{
\text{You cannot significantly accelerate a system by optimizing a component that consumes little of its time.}
}
$$

This is essentially Amdahl's law. Suppose fraction $$p$$ of request time can be accelerated by factor $$s$$. Overall speedup is approximately:

$$
S=
\frac{1}
{(1-p)+\frac{p}{s}}.
$$

Imagine model execution represents:

$$
p=0.2
$$

of total latency. You somehow make inference:

$$
s=10\times
$$

faster. Overall speedup is only:

$$
S=
\frac{1}
{0.8+0.02}
\approx1.22.
$$

Your spectacular 10× model optimization produces only about a 22% end-to-end improvement. If instead the model represents:

$$
p=0.9,
$$

then:

$$
S=
\frac{1}
{0.1+0.09}
\approx5.26.
$$

Same model optimization. Completely different product impact. That is why profiling comes before optimization. A production request may look like:

$$
L_{\text{total}}
=
L_{\text{network}}
+
L_{\text{queue}}
+
L_{\text{preprocess}}
+
L_{\text{transfer}}
+
L_{\text{inference}}
+
L_{\text{postprocess}}
+
L_{\text{return}}.
$$

Suppose measurements show:

| Stage           | p50 contribution |
| --------------- | ---------------: |
| Network/gateway |            20 ms |
| Queue           |           180 ms |
| Tokenization    |            30 ms |
| GPU inference   |           120 ms |
| Postprocessing  |            10 ms |
| Response        |            15 ms |
| **Total**       |       **375 ms** |

If your latency target is 250 ms, optimizing only kernels may not be the first move. Queueing is larger. Perhaps the real problem is saturation. Adding capacity, changing concurrency, or controlling queue depth could matter more than rewriting model execution. Suppose your service is slow because CPU tokenization consumes every available CPU core. Replacing FP16 inference with INT8 might improve GPU execution by 30%, yet end-to-end throughput barely changes because the GPU was already waiting for the CPU. Another service may be constrained by:

$$
\text{GPU memory capacity}.
$$

Quantization could be transformational because it allows more concurrent requests. Another could be:

$$
\text{memory-bandwidth bound}.
$$

Reducing weight size may substantially improve token generation speed. Another could be:

$$
\text{compute bound}.
$$

Better tensor-core kernels may dominate. The general procedure is:

$$
\text{observe}
\rightarrow
\text{identify limiting resource}
\rightarrow
\text{change that resource relationship}
\rightarrow
\text{measure again}.
$$

Optimization should be causal. Imagine:

```text
Before optimization

CPU preprocessing = 20%
GPU inference     = 70%
network           = 10%
```

You make GPU inference 4× faster. The new proportions might become:

```text
After optimization

CPU preprocessing = 47%
GPU inference     = 41%
network           = 12%
```

GPU optimization worked. But GPU inference is no longer the dominant problem. Continuing to optimize GPU kernels may produce rapidly diminishing returns. This is normal. Successful optimization often means:

$$
\boxed{\text{the bottleneck moves}}
$$

because you removed the previous bottleneck.

## How Do Export, Operator Coverage, Fusion, Shapes, and Engine Caches Create a New Candidate?
<!-- section-summary: Exported graphs, operator support, fallback, fusion, shape assumptions, and engine caches produce a distinct executable candidate with versioned build identity. -->

Changing the executable graph or engine creates a new candidate whose operator coverage, fallbacks, shapes, and startup state need verification.

Suppose you trained a model in PyTorch. You then export it into another representation and compile it for an optimized inference runtime. It is tempting to think:

Same weights, therefore same model.

Operationally, that is unsafe. Your training implementation may execute:

$$
F_{\text{framework}}(x)
$$

while the exported engine executes:

$$
F_{\text{engine}}(x).
$$

Those implementations can differ because of:

* graph transformations;
* operator substitutions;
* fused operations;
* numerical precision;
* constant folding;
* kernel selection;
* shape assumptions;
* runtime implementations.

Therefore treat the exported artifact as a new executable implementation that must be tested. The source model is the specification candidate. The optimized engine is a compiled candidate. Suppose your original graph is:

$$
z = \operatorname{ReLU}(Wx+b).
$$

A runtime might transform:

```text
matrix multiply
↓
bias addition
↓
ReLU
```

into one optimized kernel. Mathematically, these should represent approximately the same function. But the sequence of floating-point operations can change. And floating-point arithmetic is not exact real-number arithmetic.

For example:

$$
(a+b)+c
$$

need not equal:

$$
a+(b+c)
$$

bit-for-bit in finite precision. A compiler is therefore allowed to preserve intended semantics while changing low-level numerical details. ML systems need to decide how much difference is acceptable. Suppose the exact mathematical result should be:

$$
1.0000001.
$$

One implementation rounds intermediate values differently and produces:

$$
1.0000000.
$$

Another produces:

$$
1.0000002.
$$

Usually irrelevant. But now imagine these values become logits near a decision boundary. Class A:

$$
2.000001
$$

Class B:

$$
2.000000.
$$

A tiny numerical shift can swap them. Or suppose a business rule says:

$$
score \ge 0.7
\Rightarrow
\text{approve}.
$$

A prediction changing from:

$$
0.70001
$$

to:

$$
0.69998
$$

changes the final decision. This is why accuracy gates must operate at multiple levels. Suppose your optimized engine supports:

```text
matrix multiplication
convolution
normalization
attention
```

but your model contains a custom operator:

```text
weird_special_transform
```

The runtime might:

1. reject the model entirely;
2. execute that operator in a fallback framework;
3. move it to CPU;
4. use an unoptimized generic kernel.

All can dramatically affect performance. Imagine:

```text
GPU optimized ops
█████████████
          ↓
CPU fallback
     20 ms
          ↓
GPU optimized ops
█████████████
```

Now the system may repeatedly synchronize and move data between execution environments. A tiny unsupported operation can dominate latency. Suppose 98% of graph operations execute inside the optimized engine. Sounds excellent. But if the remaining 2% accounts for:

$$
40\%
$$

of execution time, coverage by operation count is misleading. What matters is closer to:

$$
\boxed{
\text{fraction of actual expensive work executing on the intended fast path}
}
$$

not simply percentage of graph nodes. You want to know:

* which operations are optimized;
* which fall back;
* how much time fallback consumes;
* whether transfers or synchronization are introduced.

A correct model with partial acceleration may perform worse than the original runtime. Suppose original framework latency:

$$
100ms.
$$

The new engine accelerates most computation to:

$$
50ms.
$$

But unsupported sections require:

$$
10ms
$$

of data movement and:

$$
50ms
$$

of fallback execution. Total:

$$
50+10+50=110ms.
$$

You've introduced an "optimized" engine that is 10% slower. This is why you benchmark the complete executable path rather than extrapolating from individual optimized kernels. Imagine a sequence:

$$
A\rightarrow B\rightarrow C.
$$

Without fusion:

```text
read inputs
run A
write intermediate
read intermediate
run B
write intermediate
read intermediate
run C
write output
```

With fusion:

```text
read inputs
run A+B+C together
write output
```

Fusion can reduce:

* kernel launch overhead;
* synchronization;
* intermediate memory writes;
* intermediate memory reads.

On memory-bound workloads, reducing data movement can matter as much as reducing arithmetic. Suppose operations A and B each produce a:

$$
100MB
$$

intermediate tensor. Without fusion:

$$
100MB
$$

must be written, then read again. That's approximately:

$$
200MB
$$

of memory traffic just to cross the boundary. If fused, the intermediate may remain in registers, cache, or otherwise avoid full materialization. The model's mathematical operation count may barely change. Yet latency improves because:

$$
\boxed{\text{less data moves through expensive memory hierarchy levels}.}
$$

This illustrates why FLOPs alone do not determine inference speed. A general framework must handle enormous flexibility:

* arbitrary shapes;
* dynamic control;
* many devices;
* training;
* debugging;
* many data types.

An inference engine can often specialize for a much narrower environment. Suppose it knows:

$$
\text{batch}\in[1,32]
$$

and:

$$
\text{sequence length}\le4096.
$$

It may select or generate kernels optimized specifically for those shapes. Specialization trades flexibility for performance. That trade needs to match real production traffic. Suppose you optimized an engine using examples around:

$$
512\text{ tokens}.
$$

Production frequently sees:

$$
8,000\text{ tokens}.
$$

Possible results include:

* engine rejection;
* fallback;
* runtime recompilation;
* inefficient kernels;
* unexpectedly large workspace memory;
* poor latency.

So representative shapes matter both in optimization and benchmarking. A model isn't a single workload. It is a family of computations parameterized by input shape. Optimized runtimes may perform expensive work such as:

* benchmarking candidate kernels;
* compiling code;
* autotuning;
* generating execution plans.

Suppose first startup requires:

$$
90s.
$$

If the resulting engine or compiled kernels can be cached, subsequent starts might require:

$$
15s.
$$

That's excellent. But now the cache itself has an identity problem. A compiled engine may depend on:

$$
(
\text{model},
\text{GPU architecture},
\text{runtime},
\text{precision},
\text{shapes},
\text{compiler settings}
).
$$

Reusing it under an incompatible stack may be invalid. Conceptually, an engine-cache key might represent:

$$
K=
H(
\text{model checksum}
\Vert
\text{runtime version}
\Vert
\text{hardware target}
\Vert
\text{precision config}
\Vert
\text{shape profile}
).
$$

The exact implementation varies. The important principle is:

A compiled artifact is reusable only when the assumptions under which it was compiled still hold.

This is the same first-principles reasoning used for prediction caching—only now you are caching executable optimization work rather than predictions.

![A 140-millisecond p95 inference profile split into authentication and network, image preprocessing, GPU execution, queueing, and postprocessing, comparing a faster kernel with a change to the largest stage.](/content-assets/articles/article-mlops-model-serving-inference-optimization-accuracy-gates/optimize-measured-bottleneck.png)

*The profile gives optimization a finish line: target the stage with enough measured budget to change the product constraint, then reprofile the complete path rather than assuming the bottleneck stayed put.*

## How Do Lower Precision and Model Type Change Accuracy Equivalence?
<!-- section-summary: Precision and quantization approximate computation; calibration and model-specific numerical, decision, ranking, or generation tests define acceptable equivalence. -->

Numerical changes then require a definition of acceptable equivalence that matches the model's actual decisions and outputs.

Suppose a model uses FP32 values. Each weight occupies approximately:

$$
4\text{ bytes}.
$$

Changing to FP16 gives roughly:

$$
2\text{ bytes}.
$$

INT8 gives roughly:

$$
1\text{ byte}.
$$

Nominal 4-bit representations use roughly:

$$
0.5\text{ bytes}
$$

per raw parameter before metadata. This immediately affects:

$$
\text{memory capacity}
$$

and:

$$
\text{memory bandwidth}.
$$

If the accelerator also supports faster arithmetic at lower precision, it can affect:

$$
\text{compute throughput}
$$

too. So lower precision can attack several serving bottlenecks simultaneously. Suppose a floating-point weight is:

$$
w=0.13742.
$$

A lower-precision representation might store something corresponding to:

$$
\hat w=0.136.
$$

The error is:

$$
\epsilon = \hat w-w.
$$

A neural network contains millions or billions of such approximations. The key question isn't whether:

$$
\epsilon=0.
$$

Usually it isn't. The question is whether accumulated approximation changes predictions enough to matter. For a simplified INT8 example, we might map real values into integers:

$$
q
=
\operatorname{round}
\left(
\frac{x}{s}
\right)
$$

where $$s$$ is a scale. Approximate reconstruction is:

$$
\hat x=sq.
$$

The quality of this approximation depends heavily on choosing a suitable scale. Suppose most values lie between:

$$
-1
\text{ and }
1,
$$

but one outlier is:

$$
50.
$$

If the quantization range must include 50, much of the integer range may be wasted representing an outlier. Values around zero may then be represented very coarsely. This is why calibration matters. For post-training quantization, you often run representative inputs through the model to observe activation distributions. Suppose an activation typically lies in:

$$
[-3,3]
$$

but your calibration dataset happens to contain only easy examples where it lies in:

$$
[-0.5,0.5].
$$

You derive quantization parameters from the narrow distribution. Production later sees values around:

$$
2.5.
$$

Those may clip badly. So calibration data must represent production's numerical behavior. Not merely its semantic labels. Suppose production inputs consist of:

$$
95\%
$$

ordinary examples and:

$$
5\%
$$

rare difficult examples. If the rare examples produce unusually large activation ranges, excluding them can make the quantized model look excellent in testing but fail precisely where robustness matters. Representative calibration should therefore account for meaningful variation such as:

* input sizes;
* user populations;
* rare classes;
* language;
* image conditions;
* long sequences;
* unusual feature values.

Calibration is not just "take 100 random samples." It is an attempt to expose the optimized representation to the numerical regimes it must survive. This distinction is important. **Calibration data** helps choose parameters of the optimized numerical representation. **Evaluation data** tests whether the resulting model is acceptable. Using exactly the same data for both can make your confidence too optimistic.

Conceptually:

$$
\text{calibration}
\rightarrow
\text{build candidate}
$$

then:

$$
\text{held-out evaluation}
\rightarrow
\text{judge candidate}.
$$

This is analogous to training and testing. Suppose a classifier's top-line accuracy changes:

$$
95.0\%
\rightarrow
94.9\%.
$$

A 0.1 percentage-point loss seems harmless. But perhaps one rare safety-critical category changed:

$$
80\%\text{ recall}
\rightarrow
60\%.
$$

Aggregate accuracy hid a catastrophic regression. So an accuracy gate needs to reflect actual product risk. For different models, relevant metrics might include:

* precision;
* recall;
* F1;
* calibration;
* ranking NDCG;
* retrieval recall;
* word error rate;
* semantic similarity;
* task success;
* refusal correctness;
* safety violations.

The gate should be defined from product behavior, not merely whichever benchmark the model originally reported. When comparing baseline model $$F$$ and optimized candidate $$\tilde F$$, you can check increasingly meaningful levels.

### Numerical equivalence

Are raw tensors close?

For example:

$$
|F(x)-\tilde F(x)|<\epsilon.
$$

Useful for finding implementation mistakes. But raw numerical difference isn't necessarily product impact.

### Model-metric equivalence

Do metrics such as accuracy or recall stay within limits

For example:

$$
\Delta\text{accuracy}>-0.2\%.
$$

Much better.

### Product-decision equivalence

Do actual downstream decisions remain acceptable

For example:

$$
\text{fraud blocks}
$$

or:

$$
\text{search result ordering}
$$

or:

$$
\text{successful assistant task completion}.
$$

This is often the most important level. Suppose baseline output:

$$
p=0.50001.
$$

Optimized output:

$$
\hat p=0.49999.
$$

Absolute error:

$$
|p-\hat p|
=
0.00002.
$$

Excellent numerical agreement. But if your decision rule is:

$$
p\ge0.5
\Rightarrow
A,
$$

then the decision changed. Therefore:

$$
\boxed{\text{tiny numerical error can create large discrete product effects near thresholds}.}
$$

This is one of the most important reasons for testing downstream decisions. Suppose a fraud system uses:

$$
\text{block transaction if }p_{\text{fraud}}>0.8.
$$

Quantization shifts predictions slightly. Most predictions are far from 0.8:

```text
0.03
0.10
0.25
0.95
0.99
```

They remain unaffected. But suppose many transactions cluster around:

$$
0.79\text{–}0.81.
$$

Tiny changes can flip many business decisions. The relevant question is not just:

$$
E[|p-\hat p|].
$$

You should also inspect:

$$
P(
\text{decision}_F(x)
\ne
\text{decision}_{\tilde F}(x)
).
$$

Call this the **decision flip rate**. That can be far more meaningful than average tensor error. Suppose quantization shifts score calibration but ranking quality remains excellent. Original score distributions:

$$
0.1,\;0.4,\;0.81,\;0.95.
$$

Optimized model tends to produce slightly lower probabilities. Maybe the model itself remains useful but threshold 0.8 is no longer calibrated appropriately. There are two different changes:

$$
\text{model representation changed}
$$

and possibly:

$$
\text{decision threshold should change}.
$$

Do not silently alter both during one experiment and then declare success. Otherwise you can't tell what produced the behavior. Evaluate the optimized model with existing product rules first, then explicitly evaluate recalibration if appropriate. Suppose your ranker outputs:

Baseline:

$$
A=0.901,\quad B=0.900.
$$

Optimized:

$$
A=0.899,\quad B=0.900.
$$

Numerical differences are tiny. But ranking changed:

$$
A>B
$$

became:

$$
B>A.
$$

If A and B are nearly equivalent, this may be harmless. If A is the only relevant item, it may matter greatly. So ranking quality should be evaluated with ranking metrics and product outcomes—not merely score difference. For an LLM:

$$
F(x)
$$

may not have one uniquely correct string output. Even baseline execution can vary due to sampling. So comparing:

```text
baseline output == optimized output
```

is usually too strict. You may instead evaluate:

* task correctness;
* semantic quality;
* instruction following;
* safety;
* factuality;
* structured-output validity;
* tool-use success;
* human preference.

For deterministic or nearly deterministic decoding, exact-output disagreement can still be a useful diagnostic even if it isn't the final quality gate. Suppose token probabilities are:

$$
P(A)=0.50001
$$

$$
P(B)=0.49999.
$$

A tiny numerical perturbation reverses them. Baseline chooses:

$$
A.
$$

Optimized version chooses:

$$
B.
$$

Now the next token distribution is conditioned on a different history. The trajectories diverge:

```text
baseline:
A → C → D → E...

optimized:
B → X → Y → Z...
```

A microscopic numerical difference can produce macroscopically different text. Therefore generative-model evaluation must focus on resulting behavior, not assume output identity.

## How Should Workload Distributions and Service Benchmarks Measure the Performance Envelope?
<!-- section-summary: Representative micro and service benchmarks cover open and closed loop, cold and warm paths, steady state, tails, and the workload performance envelope. -->

Those quality tests need performance measurements on the same representative workload and across the complete service path.

Suppose you benchmark a transformer only with:

$$
\text{batch}=32,\quad
\text{sequence}=512.
$$

You get:

$$
4,000\text{ sequences/sec}.
$$

Production looks like:

```text
batch often 1–8
sequence lengths 20–20,000
bursty arrivals
variable outputs
```

The benchmark is not false. It answers the wrong question. An inference benchmark should approximate the workloads the service will actually see. Model serving performance is a surface, not a point.

Conceptually:

$$
T=
f(
\text{batch size},
\text{input length},
\text{output length},
\text{concurrency},
\text{hardware}
).
$$

For example:

| Batch | Sequence | Latency | Throughput |
| ----: | -------: | ------: | ---------: |
|     1 |      128 |   10 ms |      100/s |
|     8 |      128 |   20 ms |      400/s |
|    32 |      128 |   50 ms |      640/s |
|     1 |     4096 |  100 ms |       10/s |
|     8 |     4096 |  300 ms |       27/s |

A candidate runtime may outperform baseline for large batches but lose for batch 1. Whether that's useful depends on production. A **microbenchmark** asks questions such as:

How fast does this model execute on a GPU at batch size 16

Useful for isolating engine performance. A **service benchmark** asks:

At 500 requests/sec with realistic traffic, what latency distribution and error rate do users see

That includes:

* queueing;
* scheduling;
* batching;
* preprocessing;
* networking;
* contention.

Both are useful. But never substitute the former for the latter. Suppose baseline model execution:

$$
100ms.
$$

Optimized:

$$
70ms.
$$

But the new runtime's batching policy waits longer to build batches. Baseline:

$$
20ms\text{ queue/batch}+100ms
=
120ms.
$$

Optimized:

$$
80ms\text{ queue/batch}+70ms
=
150ms.
$$

The model got 30% faster. The service got 25% slower. This is why the benchmark needs to include the serving scheduler. A closed-loop client behaves roughly like:

```text
send request
↓
wait for response
↓
send next request
```

This is useful for questions such as:

How many requests can a fixed number of clients complete

It naturally incorporates client-perceived latency. But it has a dangerous property. If the server slows down, clients automatically send less traffic. Thus overload reduces offered load. That can hide saturation. An open-loop generator sends requests according to a schedule independent of completion:

```text
t=0ms     request
t=10ms    request
t=20ms    request
t=30ms    request
...
```

If the server slows, arrivals continue. Now queues reveal themselves. This is useful for asking:

Can the service sustain an external arrival process of 100 RPS while meeting the SLO

For capacity determination, this is often crucial. A closed-loop test can help explore:

$$
\text{maximum achieved throughput}
$$

under controlled client concurrency. An open-loop test better exposes:

$$
\text{stability under an imposed arrival rate}.
$$

Suppose service capacity is approximately:

$$
100\text{ req/s}.
$$

An open-loop test sends:

$$
110/s.
$$

Backlog grows:

$$
10/s.
$$

After 60 seconds:

$$
600
$$

requests of backlog accumulate. That's real overload. A closed-loop test may throttle itself and hide much of that behavior. Optimized engines can have several phases:

```text
startup
↓
warmup
↓
steady state
```

During startup:

* weights load;
* kernels compile;
* caches populate;
* memory pools grow;
* execution plans build.

If you benchmark only after a perfect warmup, you understand steady-state efficiency. That's important. But production also experiences:

* rollout;
* autoscaling;
* crash recovery;
* node replacement.

So startup characteristics need separate benchmarks. Suppose:

$$
T_{\text{cold startup}}=120s.
$$

Once warm:

$$
p99=200ms.
$$

A candidate runtime improves warm latency to:

$$
150ms
$$

but increases startup to:

$$
600s.
$$

For a permanent batch cluster, this might be excellent. For aggressively autoscaled online inference, it could be disastrous. Different product constraints produce different winners. Suppose baseline and optimized runtime look like:

|    Load | Baseline p99 | Optimized p99 |
| ------: | -----------: | ------------: |
| 100 RPS |       100 ms |         90 ms |
| 300 RPS |       140 ms |        110 ms |
| 500 RPS |       250 ms |        160 ms |
| 600 RPS |          2 s |        300 ms |
| 700 RPS |         10 s |           4 s |

The optimized runtime didn't just save 10–50 ms. It moved the saturation knee. That can be much more valuable because safe capacity changed dramatically. Optimization should therefore measure:

$$
\text{throughput under latency constraint}
$$

not just unloaded latency. A serving candidate can be described by a region:

$$
\mathcal{R}
=
\{
(\lambda,L,Q,C)
:
L\le L_{\max},
Q\ge Q_{\min},
C\le C_{\max}
\}.
$$

You want the optimized candidate's acceptable region to be better than baseline. Perhaps it:

* supports higher arrival rate;
* uses less hardware;
* lowers latency;
* preserves quality.

This is a stronger claim than:

"The kernel benchmark is 1.7× faster."

## How Do Accuracy Gates, Slices, Shadow Traffic, Canaries, Hardware, and Rollback Control Release?
<!-- section-summary: Accuracy, uncertainty, slices, product quality, shadow and canary evidence, equivalent traffic and hardware, and complete rollback form release gates. -->

A candidate is ready for release only after accuracy, slices, product guardrails, shadow or canary evidence, hardware comparability, and rollback all pass.

An **accuracy gate** is simply a rule saying:

This optimized candidate cannot progress unless measured quality remains within an acceptable range.

For example:

$$
\Delta\text{accuracy}\ge -0.1\%
$$

and:

$$
\Delta\text{critical recall}\ge -0.02\%
$$

and:

$$
\text{decision flip rate}\le0.1\%.
$$

For an LLM, the gate might instead be based on:

$$
\text{task success rate}
$$

$$
\text{safety evaluations}
$$

$$
\text{structured-output validity}
$$

and domain-specific quality evaluations. A gate turns "looks okay" into an explicit engineering constraint. Suppose baseline accuracy is measured as:

$$
90.00\%
$$

and optimized accuracy:

$$
89.95\%.
$$

Is the candidate truly worse by 0.05 points? Maybe. But measurement itself has statistical noise. With only 100 examples, the apparent difference may be meaningless. With 10 million representative examples, it may be highly meaningful. Therefore quality gates should account for:

* sample size;
* confidence intervals;
* variance;
* repeated trials when nondeterminism exists.

A quality comparison should distinguish:

$$
\text{observed difference}
$$

from:

$$
\text{credible underlying difference}.
$$

Suppose overall error changes:

$$
5.00\%
\rightarrow5.05\%.
$$

Looks harmless. But inspect groups:

| Slice           | Baseline error | Candidate error |
| --------------- | -------------: | --------------: |
| Common A        |             4% |              4% |
| Common B        |             6% |              6% |
| Rare critical C |             8% |             20% |

Aggregate metrics hid the failure. Representative evaluation therefore needs meaningful slices. The relevant slices depend on the product, but the principle is:

$$
\boxed{\text{optimization must not hide unacceptable local regressions behind acceptable global averages}.}
$$

The same idea applies to speed. Suppose average latency improves 30%. But:

```text
short requests  → 2× faster
long requests   → 2× slower
```

If production contains important long-context traffic, the average is misleading. So both sides need distributions:

$$
\text{quality distributions}
$$

and:

$$
\text{performance distributions}.
$$

Optimization is multidimensional. Imagine a search model. Offline NDCG is unchanged. But the optimized runtime occasionally outputs NaN for unusual inputs. Maybe only:

$$
0.01\%
$$

of requests. An offline ranking metric may barely notice. Production users see broken pages. So the quality gate also needs operational correctness:

$$
\text{finite outputs}
$$

$$
\text{correct schemas}
$$

$$
\text{valid ranges}
$$

$$
\text{no crashes}
$$

$$
\text{correct fallback behavior}.
$$

"Accuracy" is best understood broadly as preserving the model-serving contract. Suppose baseline is production model A. You introduce optimized candidate B. In shadow mode:

```text
production request
        │
        ├────────→ A → response to user
        │
        └────────→ B → comparison only
```

Users continue receiving A. B receives real production inputs. Now you can compare:

$$
A(x)
$$

versus:

$$
B(x)
$$

on real traffic without exposing B's outputs. This is extremely useful for optimization releases because synthetic datasets rarely reproduce every production shape or edge case. Shadowing can validate:

* compatibility;
* outputs;
* latency;
* memory;
* runtime errors.

But performance measurements need care. If B receives only shadow traffic on separate hardware, it may not experience production queueing exactly. If A and B share resources, the shadow itself can alter performance. And shadowing doesn't reveal user/business reaction because users never receive B. Therefore shadow testing is evidence, not final proof. After shadow validation, route a small percentage of real traffic to B.

For example:

$$
1\%
$$

then perhaps:

$$
5\%,20\%,50\%,100\%.
$$

Now B's outputs affect real requests. Compare:

$$
\text{latency},
\quad
\text{errors},
\quad
\text{model quality proxies},
\quad
\text{business outcomes}.
$$

The key is to preserve an easy path back to A. Suppose candidate B receives mostly small requests while A gets random traffic. You observe:

$$
B\text{ is 30\% faster}.
$$

That may be pure workload bias. You need enough randomization or workload matching that:

$$
P(x\mid A)
\approx
P(x\mid B).
$$

Otherwise you're measuring traffic differences rather than runtime differences. This applies to:

* input size;
* geography;
* model variant;
* tenant;
* hardware;
* concurrency;
* time of day.

Suppose:

```text
A → older GPU
B → newer GPU
```

and B is faster. Was the optimization responsible You don't know. Likewise:

```text
A → driver version X
B → driver version Y
```

confounds the comparison. A good performance experiment minimizes uncontrolled changes. Ideally:

$$
\text{candidate difference}
=
\text{optimization being evaluated}.
$$

Reality is rarely perfect, but every additional changed variable weakens causal confidence. Suppose B uses a new engine format. You deploy:

* new runtime;
* new driver;
* new model export;
* new batching config.

Then discover quality degradation. Rolling back only model weights may not restore A. The rollback unit should be the full compatible serving artifact:

$$
(
\text{model},
\text{runtime},
\text{libraries},
\text{configuration},
\text{hardware assumptions}
).
$$

Optimization increases the importance of reproducible serving stacks because more layers influence behavior.

![An exported and optimized model becoming a versioned executable candidate, then passing compatibility, numerical, model-quality, and product-decision gates before benchmarking, with a threshold-crossing example.](/content-assets/articles/article-mlops-model-serving-inference-optimization-accuracy-gates/optimized-candidate-gates.png)

*Export, provider placement, compilation, and reduced precision create a new executable candidate; even a small paired-score difference must pass the product-action gate before faster execution can advance.*

## How Do Benchmark Ladders and Resource Counters Separate Real Gains from Noise?
<!-- section-summary: A benchmark ladder, resource counters, repeated trials, and operational effect thresholds distinguish bottleneck improvements from measurement noise. -->

Small speedups can disappear in noise or fail to affect service capacity, so a benchmark ladder and resource counters must explain the gain.

Suppose candidate B is slower. There are many possible explanations:

$$
\text{fallback operator},
$$

$$
\text{wrong kernel},
$$

$$
\text{engine cache miss},
$$

$$
\text{different precision path},
$$

$$
\text{new batching behavior},
$$

$$
\text{extra copies},
$$

$$
\text{CPU overhead},
$$

$$
\text{different GPU clocks},
$$

$$
\text{different workload}.
$$

The correct response isn't:

"TensorRT/ONNX/CUDA must be slower."

You need evidence that narrows the causal chain. A useful debugging strategy is to move from narrow to broad measurements. You might compare:

$$
\text{individual kernels}
$$

then:

$$
\text{model execution}
$$

then:

$$
\text{model server}
$$

then:

$$
\text{end-to-end service}.
$$

Suppose:

```text
kernel benchmark      2× faster
model execution       1.7× faster
server throughput     1.1× faster
user latency          unchanged
```

You have learned something valuable. The optimization is being lost between the model and product layers. Now inspect:

* scheduling;
* queueing;
* CPU;
* network;
* batching.

Suppose candidate B is 20% slower. You observe:

```text
GPU compute activity: similar
memory bandwidth: significantly higher
```

Hypothesis:

Candidate is moving more data.

Or:

```text
GPU activity: lower
CPU utilization: much higher
```

Hypothesis:

Host-side processing or fallback is limiting the GPU.

Or:

```text
GPU activity: high
batch size: much smaller
```

Hypothesis:

Scheduling changed and reduced batching efficiency.

Performance diagnosis is much easier if latency changes are connected to physical resource changes. GPU performance can vary because of:

* warmup;
* clock behavior;
* concurrent workloads;
* thermal state;
* input distribution;
* compilation;
* cache state.

Suppose baseline runs once at:

$$
10.0ms
$$

and candidate once at:

$$
9.8ms.
$$

Claiming a 2% win would be weak evidence. You need repeated measurements and sufficiently long runs. The smaller the claimed improvement, the stronger your measurement discipline needs to be. Suppose candidate improves model execution:

$$
100ms\rightarrow98ms.
$$

But:

* implementation becomes far more complicated;
* startup takes longer;
* quality validation becomes harder;
* runtime is less mature.

The optimization may have negative total value. An optimization should justify its complexity. A useful conceptual metric is:

$$
\frac{\text{production value gained}}
{\text{operational complexity introduced}}.
$$

You don't need to compute it numerically, but you should reason about it.

## How Do Worked Examples and a Pareto Frontier Guide Iterative Optimization?
<!-- section-summary: Classification and LLM examples expose quality-performance tradeoffs, and the Pareto frontier selects candidates that are not dominated on relevant objectives. -->

Worked examples and a Pareto frontier make the iterative trade between latency, throughput, memory, cost, and quality explicit.

Suppose you serve a fraud classifier. Baseline:

$$
p99=80ms
$$

$$
\text{throughput}=2,000\text{ req/s/GPU}
$$

$$
\text{fraud recall}=96.0\%
$$

$$
\text{false-positive rate}=1.5\%.
$$

Product requirements are:

$$
p99<100ms
$$

$$
\text{fraud recall}\ge95.8\%
$$

$$
\text{false-positive rate}\le1.6\%.
$$

You quantize from FP16 to INT8. Microbenchmark:

$$
2,000\rightarrow3,100\text{ req/s/GPU}.
$$

Excellent. Numerical comparison shows average probability error:

$$
0.001.
$$

Looks tiny. Overall accuracy changes:

$$
97.2\%\rightarrow97.1\%.
$$

Still fine. But threshold analysis reveals transactions near the fraud threshold flip more frequently than expected. Critical fraud recall becomes:

$$
95.4\%.
$$

The candidate fails. Even though it is:

$$
55\%
$$

faster. That is an accuracy gate doing its job. The correct conclusion is not:

INT8 doesn't work.

It is:

This INT8 configuration fails the current product constraint.

You might investigate:

* different calibration data;
* per-channel quantization;
* keeping sensitive layers at higher precision;
* threshold recalibration, evaluated as a separate product change.

Suppose most layers tolerate INT8, but one numerically sensitive operation causes most degradation. Instead of:

$$
\text{everything FP16}
$$

or:

$$
\text{everything INT8},
$$

you can run:

$$
\text{most operations INT8}
$$

while preserving certain operations in:

$$
\text{FP16/FP32}.
$$

You sacrifice some performance gain but recover quality. Optimization is not necessarily binary. The best candidate often lies somewhere on a Pareto frontier. Imagine candidate configurations:

| Candidate |    p99 |  Cost | Quality |
| --------- | -----: | ----: | ------: |
| A         | 500 ms | $1.00 |    99.0 |
| B         | 350 ms | $0.80 |    99.0 |
| C         | 250 ms | $0.60 |    98.9 |
| D         | 180 ms | $0.45 |    96.0 |

A is dominated by B: B is faster and cheaper at equal quality. D is much faster but perhaps fails the quality gate. C might be the best production choice. There isn't necessarily one scalar "best model." There is a set of tradeoffs:

$$
\boxed{
\text{latency}
\leftrightarrow
\text{cost}
\leftrightarrow
\text{quality}
}
$$

and the product constraints choose the acceptable point. Suppose an LLM server currently uses BF16. Measured workload:

```text
input tokens:
p50 = 500
p95 = 8,000

output tokens:
p50 = 150
p95 = 1,000
```

Baseline:

$$
TTFT_{p99}=900ms
$$

$$
\text{decode}=60\text{ tok/s/user}
$$

$$
\text{fleet throughput}=25,000\text{ tokens/s/GPU}.
$$

You introduce:

* quantized weights;
* fused attention;
* optimized engine.

Microbenchmarks show:

$$
40,000\text{ tokens/s/GPU}.
$$

A 60% improvement. But further inspection finds the improvement is uneven. Short prompts:

$$
+80\%.
$$

Long prefill:

$$
+20\%.
$$

At batch 1:

$$
+10\%.
$$

At high concurrency:

$$
+70\%.
$$

So whether the change is valuable depends on production traffic. Quality evaluation then finds:

```text
general task success: unchanged
code generation: -0.2%
long-context retrieval: -2.5%
structured JSON validity: unchanged
```

If long-context retrieval is important, the candidate may fail despite excellent average benchmarks. Perhaps you then keep certain attention operations at higher precision. Throughput improvement falls from:

$$
60\%
$$

to:

$$
45\%.
$$

Long-context quality returns inside the allowed gate. That 45% candidate may be vastly superior to the nominally "faster" 60% candidate. A mature process looks roughly like this:

$$
\text{define product constraint}
$$

$$
\downarrow
$$

$$
\text{measure workload and bottleneck}
$$

$$
\downarrow
$$

$$
\text{construct one optimization candidate}
$$

$$
\downarrow
$$

$$
\text{verify functional/numerical behavior}
$$

$$
\downarrow
$$

$$
\text{evaluate model and product quality}
$$

$$
\downarrow
$$

$$
\text{benchmark representative workloads}
$$

$$
\downarrow
$$

$$
\text{shadow/canary}
$$

$$
\downarrow
$$

$$
\text{release or reject}
$$

$$
\downarrow
$$

$$
\text{profile again}.
$$

Why profile again? Because the bottleneck may have moved. When someone says:

Candidate B is 30% faster.

You need to know exactly what B is.

For example:

```text
Baseline
model checksum: X
precision: BF16
runtime: R1
GPU: H1
batch policy: B1
driver: D1

Candidate
model checksum: X
precision: INT8
runtime: R2
GPU: H1
batch policy: B1
driver: D1
```

Now the difference is understandable. If instead five things changed simultaneously, regression diagnosis becomes much harder. Optimization works best with disciplined experimental control. A performance report saying:

$$
1.8\times\text{ throughput}
$$

without quality evidence is incomplete. An accuracy report saying:

$$
\Delta Q=0
$$

without serving evidence is also incomplete. For every candidate, you ideally want a compact record such as:

| Dimension       | Baseline | Candidate |
| --------------- | -------: | --------: |
| p99 latency     |   400 ms |    260 ms |
| safe throughput |  100 RPS |   155 RPS |
| cost/result     |   $0.004 |   $0.0027 |
| accuracy        |    94.5% |     94.4% |
| critical recall |    98.2% |     98.2% |
| decision flips  |        — |     0.03% |
| cold start      |     45 s |      60 s |

Now the release decision can be made from evidence instead of benchmark excitement.

## Why Are Accuracy Gates Inseparable from Inference Optimization?
<!-- section-summary: Every optimization changes executable behaviour, so quality and performance evidence must stay together through an iterative, versioned release loop. -->

The final principle is that optimization changes the model system and therefore cannot be separated from accuracy gates.

Suppose the original serving system implements:

$$
F
$$

with resource requirement:

$$
R(F)
$$

and product quality:

$$
Q(F).
$$

Optimization constructs a candidate:

$$
\tilde F
$$

with:

$$
R(\tilde F)<R(F)
$$

or greater throughput / lower latency. But the candidate is valid only if:

$$
Q(\tilde F)\ge Q_{\min}.
$$

And production usefulness further requires:

$$
L(\tilde F)\le L_{\max},
$$

$$
E(\tilde F)\le E_{\max}.
$$

So the problem is:

$$
\boxed{
\text{find the cheapest executable approximation of the model that remains inside all required product constraints}
}
$$

"Approximation" may be exact at the model-semantic level and merely differ in floating-point execution, or it may be deliberately approximate through quantization. Either way, it needs proof. Without optimization, you ask:

Does this model work

With optimization, you need an additional question:

Does this transformed implementation still work enough

Every aggressive optimization exchanges something. Kernel specialization exchanges flexibility for speed. Fusion exchanges implementation simplicity for fewer operations/transfers. Quantization exchanges numerical fidelity for efficiency. Static shapes exchange generality for specialization. GPU-specific compilation exchanges portability for performance. Larger batching exchanges latency for throughput. Therefore every optimization creates assumptions. An accuracy/performance gate verifies that those assumptions remain acceptable. For any proposed optimization, the essential questions are:

1. **What bottleneck does this change attack?**
2. **What resource should improve if the hypothesis is correct?**
3. **What assumptions or numerical behavior does the optimization change?**
4. **What representative workloads could expose failure?**
5. **What model and product metrics are not allowed to regress?**
6. **What happens near important decision thresholds or rare slices?**
7. **Does the complete service improve, not merely a kernel?**
8. **Can we shadow, canary, observe, and roll back the full serving stack?**

If those questions have concrete answers, optimization becomes an engineering experiment rather than guesswork. Inference optimization is not:

$$
\boxed{\text{make the model faster}}
$$

in isolation. It is:

$$
\boxed{
\text{replace the current serving computation with a more efficient executable candidate}
}
$$

subject to the constraint:

$$
\boxed{
\text{the candidate must remain good enough for the product}
}
$$

The process begins by measuring the real bottleneck, because accelerating a non-bottleneck has limited system impact. The optimized export or engine should be treated as a new executable implementation, because graph rewriting, fused kernels, fallback operators, lower precision, and hardware-specific compilation can all change performance and sometimes outputs. Lower precision can dramatically reduce memory use, memory traffic, and compute cost, but calibration must represent production numerical behavior. Performance benchmarks must represent production request shapes and load patterns. Closed-loop tests help study throughput under controlled concurrency, while open-loop tests reveal whether an externally imposed arrival rate causes unstable queue growth. Most importantly, correctness should be checked at several levels:

$$
\text{numerical behavior}
\rightarrow
\text{model metrics}
\rightarrow
\text{product decisions}.
$$

Tiny numerical changes may be irrelevant for most predictions yet flip important decisions near thresholds. Aggregate accuracy may look unchanged while a critical slice regresses badly. Generative models may produce completely different text from tiny early-token perturbations while still preserving—or degrading—actual task quality. So an optimization only passes when:

$$
\boxed{
\text{Performance gain is real}
\land
\text{quality gates pass}
\land
\text{production behavior is safe}
}
$$

and the final proof comes progressively:

$$
\boxed{
\text{offline benchmark}
\rightarrow
\text{quality gates}
\rightarrow
\text{shadow}
\rightarrow
\text{canary}
\rightarrow
\text{gradual rollout}
}
$$

with a tested rollback path for the complete serving stack. That is the first-principles idea: **every inference optimization is a hypothesis that some resource can be used more efficiently, and every accuracy gate is evidence that the cheaper computation is still an acceptable substitute for the original one.**

![Production optimization workflow from a measurable constraint and full profile through a targeted immutable candidate, representative open and closed load tests, quality gates, shadow and canary release, expansion, or complete rollback.](/content-assets/articles/article-mlops-model-serving-inference-optimization-accuracy-gates/optimization-release-summary.png)

*Optimization is released as one measured production change: representative performance and behaviour gates travel with the candidate, and a breached limit restores the complete baseline model, runtime, policy, batching, and cache combination.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Product Constraint and Bottleneck Should an Inference Optimization Address?]{kind="recap"}
Optimization is a constrained product problem, so profiling the full request and applying Amdahl's law identifies the limiting resource worth changing.
:::

:::expand[How Do Export, Operator Coverage, Fusion, Shapes, and Engine Caches Create a New Candidate?]{kind="recap"}
Exported graphs, operator support, fallback, fusion, shape assumptions, and engine caches produce a distinct executable candidate with versioned build identity.
:::

:::expand[How Do Lower Precision and Model Type Change Accuracy Equivalence?]{kind="recap"}
Precision and quantization approximate computation; calibration and model-specific numerical, decision, ranking, or generation tests define acceptable equivalence.
:::

:::expand[How Should Workload Distributions and Service Benchmarks Measure the Performance Envelope?]{kind="recap"}
Representative micro and service benchmarks cover open and closed loop, cold and warm paths, steady state, tails, and the workload performance envelope.
:::

:::expand[How Do Accuracy Gates, Slices, Shadow Traffic, Canaries, Hardware, and Rollback Control Release?]{kind="recap"}
Accuracy, uncertainty, slices, product quality, shadow and canary evidence, equivalent traffic and hardware, and complete rollback form release gates.
:::

:::expand[How Do Benchmark Ladders and Resource Counters Separate Real Gains from Noise?]{kind="recap"}
A benchmark ladder, resource counters, repeated trials, and operational effect thresholds distinguish bottleneck improvements from measurement noise.
:::

:::expand[How Do Worked Examples and a Pareto Frontier Guide Iterative Optimization?]{kind="recap"}
Classification and LLM examples expose quality-performance tradeoffs, and the Pareto frontier selects candidates that are not dominated on relevant objectives.
:::

:::expand[Why Are Accuracy Gates Inseparable from Inference Optimization?]{kind="recap"}
Every optimization changes executable behaviour, so quality and performance evidence must stay together through an iterative, versioned release loop.
:::
