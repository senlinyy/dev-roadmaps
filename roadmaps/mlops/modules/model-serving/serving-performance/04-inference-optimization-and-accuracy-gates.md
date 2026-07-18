---
title: "Inference Optimization and Accuracy Gates"
description: "Profile inference, choose the correct optimization layer, benchmark representative load, and protect numerical and product quality."
overview: "Inference optimization changes request handling, model representation, precision, runtime, or hardware. This article develops a bottleneck-first framework and uses ONNX Runtime, TensorRT, and quantization as implementation examples."
tags: ["MLOps", "advanced", "performance"]
order: 4
id: "article-mlops-model-serving-inference-optimization-accuracy-gates"
---

## Optimization Starts With A Constraint And A Bottleneck
<!-- section-summary: Inference optimization improves a measured latency, throughput, memory, or cost constraint while preserving required quality. -->

**Inference optimization** changes how requests or a trained model execute so the service uses less time, memory, or compute. The goal must be stated as a service constraint: 95th-percentile latency below 60 milliseconds at 120 requests per second, throughput above a target per GPU, memory below a limit, or cost below a budget.

The framework has six stages:

1. Define performance and quality requirements.
2. Profile the complete request path and classify the bottleneck.
3. Choose the optimization layer that owns the bottleneck.
4. Build a benchmark matrix under representative load.
5. Apply numerical, task-quality, and product-decision gates.
6. Release progressively with the baseline available for rollback.

This order matters because no single toolchain is the default optimization path. Converting a model to ONNX and TensorRT adds little value when image decoding or queueing consumes most latency. Quantization may improve throughput and damage a rare safety class. Batching may improve GPU use and violate a tail-latency target.

## Profile The End-To-End Request Path
<!-- section-summary: Profiling separates queueing, network, decoding, feature lookup, preprocessing, transfer, model execution, and postprocessing. -->

A service-level latency number does not identify the layer to change. Instrument the request path into queue wait, authentication, network calls, input decoding, feature retrieval, preprocessing, host-to-device transfer, model execution, postprocessing, serialization, and response time.

GPU work is asynchronous, so dedicated benchmarks need CUDA events or synchronization around measured regions. Production tracing should avoid synchronizing every request because that can reduce throughput.

Measure cold start and warm steady state separately. Record 50th-, 95th-, and 99th-percentile (**p50**, **p95**, and **p99**) latency, throughput, queue depth, concurrency, CPU and accelerator utilization, memory, errors, and batch-size distribution. P50 describes the middle request, while p95 and p99 expose increasingly slow tails. Run enough warm-up for compilation, caching, and allocator behaviour to settle.

The profile classifies the bottleneck. Queueing points to capacity, concurrency, or traffic shaping. Preprocessing points to decoding, vectorization, caching, or moving work. Model execution points to architecture, graph, precision, runtime, or hardware. Transfer overhead points to batching, data layout, or device placement.

## Optimization Layers Solve Different Problems
<!-- section-summary: Request, batching, model, graph, precision, runtime, and hardware optimizations carry different quality and operating tradeoffs. -->

**Request-shape optimization** reduces unnecessary payload, repeated work, or variable shapes. Input limits and canonical shapes can improve predictability.

**Caching** avoids repeated deterministic work when keys, freshness, privacy, and invalidation are sound. It can shift cost from computation to storage and create stale-result risk.

**Batching and queueing** combine requests for more efficient execution. They improve throughput and utilization while adding wait time. Dynamic batching needs a maximum delay tied to the service latency budget.

**Model architecture optimization** uses pruning, distillation, smaller backbones, early exits, or task-specific redesign. It can produce the largest gains and requires renewed training and evaluation.

**Graph and compiler optimization** exports, fuses operators, removes constants, or compiles hardware-specific kernels. ONNX Runtime, TensorRT, OpenVINO, XLA, and `torch.compile` fit parts of this layer.

**Precision optimization** uses FP16, BF16, FP8, or INT8 where hardware and operators support them. Reduced precision changes numerical behaviour and may need calibration.

**Runtime and hardware optimization** selects execution providers, accelerators, instance counts, threads, and memory policy. Faster hardware can hide inefficient software and increase cost or operational complexity.

Choose the lowest-risk layer that addresses the measured bottleneck, then reprofile. Several layers can interact, so change one controlled variable or use a documented matrix.

## Export Is A Compatibility And Numerical Change
<!-- section-summary: Model export creates another executable representation that needs structural and output validation before performance comparison. -->

ONNX represents a computation graph and tensor contract. ONNX Runtime executes that graph through hardware-specific execution providers. Export can change operator decomposition, shapes, and numerical order.

```python
import torch

onnx_program = torch.onnx.export(
    model.eval().cpu(),
    (example_input,),
    input_names=["pixel_values"],
    output_names=["logits"],
    dynamic_shapes=({0: "batch"},),
    opset_version=18,
    dynamo=True,
    verify=True,
)
onnx_program.save("parcel_damage_v17.onnx")
```

The exact exporter API and supported operators change over time, so pin versions and check current framework documentation. The opset, preprocessing, dynamic shapes, and model digest belong to the release identity.

Structural validation checks the graph, input and output names, types, and shapes. Golden fixtures compare baseline and exported logits or predictions under explicit tolerances. Fixtures should include every important class, boundary shapes, unusual inputs, and examples near product thresholds.

## Execution Providers Need Fallback Evidence
<!-- section-summary: Execution-provider order determines which graph regions run on CPU, CUDA, TensorRT, or another backend. -->

An ONNX Runtime **execution provider** assigns supported graph regions to a backend. A session may list TensorRT, CUDA, and CPU in priority order. Unsupported operations can fall back.

```python
session = ort.InferenceSession(
    "model.onnx",
    providers=[
        ("TensorrtExecutionProvider", {"trt_fp16_enable": True}),
        "CUDAExecutionProvider",
        "CPUExecutionProvider",
    ],
)
```

Provider availability does not prove the hot path used it. Profiling and runtime logs should show graph partitioning, unexpected CPU nodes, device transfers, engine build, and cache behaviour. CPU fallback inside a GPU service can create tail-latency spikes.

TensorRT compiles supported graphs into hardware-optimized engines. Engine caches depend on the graph, shapes, TensorRT and CUDA versions, precision settings, and hardware compatibility. Build time, cache invalidation, and startup failure are production concerns alongside steady-state speed.

## Quantization Trades Numerical Range For Efficiency
<!-- section-summary: Lower precision reduces memory and can increase throughput while calibration and per-class analysis protect quality. -->

**Quantization** represents weights or activations with fewer bits. FP16 or BF16 may require little calibration on suitable hardware. Static INT8 commonly uses a representative calibration set to estimate ranges.

The calibration set should represent production input ranges, devices, lighting, languages, segments, and hard threshold cases. It stays separate from final evaluation. A calibration cache is tied to the exact graph and preprocessing version.

Quantization support differs by runtime and hardware. A CPU QDQ path and a TensorRT GPU path may require different artifacts and calibration handling. Follow current runtime documentation rather than applying one recipe across providers.

When quality regresses, compare intermediate activations, per-layer error, saturation, and class-specific effects. Sensitive nodes can remain at higher precision. The team can improve calibration, use mixed precision, change architecture, or reject the optimization.

## Benchmark A Matrix Under Representative Load
<!-- section-summary: Benchmarks compare controlled combinations of model, runtime, precision, shape, batch, concurrency, and hardware. -->

A benchmark matrix records model and preprocessing versions, runtime and provider, precision, hardware SKU, driver and accelerator libraries, batch size, concurrency, input shapes, warm-up, duration, and traffic distribution.

Single-request microbenchmarks isolate model execution. Service benchmarks include decoding, networking, queueing, and serialization. Load should reproduce ordinary, burst, and worst supported shapes. Report latency percentiles at achieved throughput rather than presenting latency and throughput from separate favourable runs.

Resource evidence includes CPU, GPU utilization, memory, power where available, queue depth, batch distribution, errors, and cold-start time. Cost is calculated from sustained capacity and utilization, not one peak request.

Compare the complete candidate pair—model representation plus runtime configuration—with the baseline release. A faster model whose new server consumes more idle GPUs may not reduce cost.

### A Benchmark Must Isolate Cause Without Hiding Interactions

Change one major layer at a time during diagnosis: baseline runtime versus exported graph, then precision, then batching, then hardware. This makes it possible to explain where a gain or regression came from. Afterward, test the combined candidate because optimizations interact. A graph compiler may fuse operators only for fixed shapes; dynamic batching may change those shapes; quantization may select different kernels; a faster kernel may move the bottleneck into preprocessing or the queue.

Use the same input corpus for paired correctness comparisons, but use an arrival pattern for capacity tests. Feeding requests as fast as possible measures saturation throughput; it does not reproduce an online service with bursts and idle gaps. Record offered load separately from completed throughput, and include rejected, timed-out, or fallback responses. Otherwise a candidate can appear faster simply because it discarded difficult work.

Treat warm-up as part of the experimental protocol. Compilation, kernel selection, memory pools, caches, and frequency scaling can make the first requests unlike steady state. Measure cold-start behaviour separately, then begin steady-state samples after a declared warm-up condition. Repeat runs and report variation; a single best run is not release evidence.

## Quality Gates Operate At Three Levels
<!-- section-summary: Numerical, task, and product gates protect different consequences of optimization. -->

A **numerical gate** compares baseline and candidate outputs on golden inputs using absolute and relative tolerances, cosine similarity, or top-k agreement. Tolerances follow the output scale and model type.

A **task-quality gate** recomputes metrics on a held-out dataset. Classification may use macro-F1, per-class recall, calibration, and confusion matrices. Ranking may use NDCG and recall. Generation needs task-specific evaluation.

A **product-decision gate** checks whether numerical changes cross thresholds or alter actions. A small logit change can switch manual-review routing, fraud blocks, medical prioritization, or safety moderation. Measure changed-decision rate overall and by important segment, then inspect the changed examples.

The levels are deliberately not interchangeable. A classifier can have low average numerical error while flipping the decision for a small, high-risk group. It can preserve aggregate F1 while losing recall for a safety class. It can preserve offline metrics while changing calibration enough that an existing threshold sends many more cases to manual review. Each gate catches a different path from floating-point change to product consequence.

Set tolerances before looking at the candidate result. If the team chooses them afterward, the gate merely justifies a preferred optimization instead of enforcing an acceptance rule. Record which slices and decision thresholds are protected, why those limits are meaningful, and who can approve an exception. An exception should create new evidence and a release decision without silently editing the old gate.

Performance and quality criteria should be predeclared. A candidate passes only when it improves the intended constraint and stays inside all blocking quality limits. An average metric cannot cover a sensitive rare class.

One gate can calculate all three levels from paired baseline and optimized outputs:

```python
import numpy as np
import pandas as pd
from sklearn.metrics import f1_score, recall_score

rows = pd.read_parquet("optimization-comparison.parquet")
logit_error = np.abs(rows.optimized_logit - rows.baseline_logit)
rows["baseline_action"] = rows.baseline_logit >= rows.policy_threshold
rows["optimized_action"] = rows.optimized_logit >= rows.policy_threshold
rows["changed_action"] = rows.baseline_action != rows.optimized_action

baseline_macro_f1 = f1_score(
    rows.true_label, rows.baseline_class, average="macro"
)
optimized_macro_f1 = f1_score(
    rows.true_label, rows.optimized_class, average="macro"
)
baseline_damage_recall = recall_score(
    rows.true_label, rows.baseline_class, labels=["damage"], average=None
)[0]
optimized_damage_recall = recall_score(
    rows.true_label, rows.optimized_class, labels=["damage"], average=None
)[0]

report = {
    "max_absolute_logit_error": float(logit_error.max()),
    "macro_f1_delta": float(optimized_macro_f1 - baseline_macro_f1),
    "changed_action_rate": float(rows.changed_action.mean()),
    "damage_recall_delta": float(
        optimized_damage_recall - baseline_damage_recall
    ),
    "changed_case_ids": rows.loc[rows.changed_action, "parcel_id"].head(100).tolist(),
}

assert report["max_absolute_logit_error"] <= 0.02 + 1e-12
assert report["macro_f1_delta"] >= -0.002
assert report["changed_action_rate"] <= 0.001
assert report["damage_recall_delta"] >= -0.005
```

The numerical limit catches broad export divergence; the tiny `1e-12` addition only absorbs binary floating-point representation at the declared boundary. The macro-F1 and damage-recall limits protect task quality overall and for an important class. These metrics are recomputed from paired prediction columns; they do not rely on `DataFrame.attrs`, which Parquet files do not provide as a durable evaluation contract. The action rate measures the effect after the product threshold. `changed_case_ids` gives reviewers the parcels that actually switched route.

Suppose INT8 improves p95 latency from 71 to 46 milliseconds and passes macro-F1, while damage recall drops by 1.4 percentage points. The task-specific assertion fails, so the optimization cannot enter canary traffic. The team can improve calibration coverage, keep sensitive layers in higher precision, or retain FP16. It reruns the complete benchmark and the paired gate after each change.

CI should also test the gate itself. A fixture with one score crossing the threshold must increase `changed_action_rate`; a fixture with one rare-class miss must reduce `damage_recall_delta`. These tests prevent a reporting bug from approving an optimized artifact whose performance numbers look excellent.

## Progressive Release Preserves The Baseline
<!-- section-summary: Shadow and canary stages verify the optimized runtime with current traffic while a complete baseline release remains available. -->

Staging verifies startup, model identity, fixtures, load, and telemetry. Shadow traffic checks current shapes, provider fallback, latency, errors, and prediction divergence without affecting users. A canary tests real product decisions and resource behaviour under limited exposure.

Stop signals include quality-proxy changes, decision-switch limits, class or segment regressions, latency, errors, fallback, memory, and cost. Rollback restores the baseline model, runtime image, precision, preprocessing, and provider configuration as a complete release.

Incident triage follows the optimization layer. Numerical divergence points to graph, precision, or kernels. Latency spikes point to batching, fallback, compilation, shape changes, or queueing. Startup failures point to compatibility or engine caches. Product changes with close logits point to thresholds and calibration.

## Optimization Is A Controlled Experiment On The Runtime
<!-- section-summary: A safe optimization connects a measured bottleneck to one chosen layer, representative benchmarks, quality gates, and recovery. -->

ONNX Runtime, TensorRT, and quantization are useful implementation choices after the framework identifies model execution as the bottleneck. Other services may need batching, caching, preprocessing changes, a smaller architecture, or different hardware.

The release succeeds when the team can explain which layer changed, why it addressed the bottleneck, how performance was measured, which quality differences were allowed, and how the complete baseline returns if live evidence disagrees.

## References

- [PyTorch ONNX exporter](https://docs.pytorch.org/docs/stable/onnx.html)
- [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/)
- [ONNX Runtime quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
- [TensorRT documentation](https://docs.nvidia.com/deeplearning/tensorrt/latest/)
- [NVIDIA Triton performance analyzer](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/perf_analyzer/docs/README.html)
