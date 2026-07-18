---
title: "Runtime Compatibility"
description: "Connect request contracts, preprocessing, artifacts, libraries, serving runtimes, hardware, loading, and rollback."
overview: "Runtime compatibility is a chain of agreements from the API request to the hardware executing the model. This article develops each boundary before showing how a compatibility matrix and release record preserve supported combinations."
tags: ["MLOps", "production", "packaging"]
order: 3
id: "article-mlops-model-serving-model-artifacts-runtime-dependencies"
---

## Compatibility Is A Chain Across The Serving Path
<!-- section-summary: Runtime compatibility requires every boundary from request to hardware to agree on data, format, software, and behaviour. -->

**Runtime compatibility** means an approved model can load and produce the reviewed behaviour inside the intended serving environment. Compatibility spans several boundaries:

1. Request contract to preprocessing.
2. Preprocessing output to model signature.
3. Serialized artifact to loading library.
4. Language packages to native system libraries.
5. Model format to serving runtime.
6. Runtime to CPU, GPU, driver, and accelerator libraries.
7. Loaded model to readiness, traffic, and fallback.

A release can fail at any one of these boundaries. The API may accept a renamed field that preprocessing ignores. A tokenizer may produce different IDs. A Python object may fail to deserialize under a new library. A CUDA image may require a driver the node cannot support. A server may report HTTP health before the model finishes loading.

The correct response is to model each compatibility relationship and test supported combinations. A manifest records the result afterward; it should not substitute for understanding the chain.

## Request, Preprocessing, And Signature Form One Contract
<!-- section-summary: The request schema, transformation logic, and model signature must agree on names, types, shapes, order, defaults, and semantics. -->

The caller sends an API or batch record. Preprocessing validates and transforms it into the tensor, dataframe, or structured input the model expects. The model signature defines names, types, shapes, and sometimes optionality.

Compatibility includes semantics as well as shape. Two fields may both be floating-point values while one uses dollars and the other cents. A timestamp may be UTC in training and local time in serving. A categorical encoder may assign a new index to an existing value. Passing schema validation can still produce wrong predictions.

Contract tests should begin with reviewed fixtures that travel through the whole path. They compare the preprocessing output with the saved signature and verify known prediction results or tolerances.

```python
def test_request_matches_saved_signature():
    request = Request.model_validate_json(fixture.read_text())
    features = build_features(request)
    model = mlflow.pyfunc.load_model("models/document-classifier")

    expected = [item.name for item in model.metadata.signature.inputs.inputs]
    assert list(features.columns) == expected
    assert features.dtypes.astype(str).to_dict() == expected_dtypes
```

The fixture set should include missing values, optional fields, boundary sizes, unseen categories, and legacy clients. Contract versioning and backward-compatibility policy determine whether an old caller is rejected, translated, or supported by another endpoint version.

## Serialization Defines A Trust And Library Boundary
<!-- section-summary: The artifact format determines how code, weights, metadata, and executable behaviour cross from training to serving. -->

Model artifacts can store only weights, a portable graph, or an executable language object. Pickle-based formats can execute code during loading and require a trusted source. Framework-native formats can still depend on exact library behaviour. ONNX or TensorRT artifacts improve runtime portability for supported operators while introducing export and numerical-compatibility checks.

The artifact should carry or link to preprocessing, postprocessing, label maps, tokenizer, signature, example input, framework version, code identity, and integrity digest. If one of these changes, the loadable release identity changes.

A cryptographic digest detects altered bytes. Signing and provenance can strengthen supply-chain assurance. Scanning catches known package and image vulnerabilities. None of these prove predictive correctness, so load and prediction fixtures remain necessary.

Teams should avoid loading untrusted serialized objects in production or review notebooks. Model registries and artifact stores need restricted write access, immutable versions, audit logs, and promotion controls.

## Package And Native Libraries Must Match The Artifact
<!-- section-summary: Language and system dependencies affect deserialization, preprocessing, operators, numerical behaviour, and performance. -->

A Python lock file can pin PyTorch, scikit-learn, transformers, tokenizer, NumPy, and serving libraries. The container image pins operating-system libraries and runtime components. A digest identifies the exact built image.

Minor upgrades can matter. A changed tokenizer implementation can alter inputs. A numerical library can select another kernel. An OCR dependency can disappear from the base image. A model may load successfully while prediction behaviour moves outside the accepted tolerance.

Compatibility testing should therefore include import and version checks, model load, fixture predictions, concurrency smoke tests, and representative numerical comparison. The approved versions come from evaluation and security review; article examples should never be copied as universal version recommendations.

Training and serving do not always need identical environments. A portable exported artifact may intentionally serve in a smaller runtime. The team must test that boundary and document the supported exporter-to-runtime combination.

### Version Pins Do Not Capture The Whole Compatibility Surface

A package lock identifies resolver output, but native numerical software also depends on the operating-system ABI, CPU instruction set, system libraries, and dynamically loaded accelerator components. Two containers with the same Python package list can behave differently if one wheel was built for another architecture or if the host exposes a different driver. Conversely, training and serving can use different package versions safely when a stable exported graph is the deliberate boundary and the combination has passed comparison tests.

This is why “copy the training environment” is an incomplete strategy. It may carry compilers, notebook tools, data clients, and credentials into serving without proving hardware support. The stronger strategy is to define the smallest serving environment, record its immutable image digest, and test the artifact across the exact boundary it will cross.

Compatibility tests should distinguish three outcomes:

1. **Cannot load:** the format, operator, library, or hardware is unsupported.
2. **Loads but changes behaviour:** preprocessing, numerical kernels, precision, or defaults moved results outside tolerance.
3. **Loads correctly but misses the operating envelope:** latency, memory, concurrency, or startup time is unacceptable.

A single import test sees only part of the first outcome. A production compatibility suite needs fixtures, numerical comparison, and resource measurements because an apparently compatible model can still be unreleasable.

## Serving Runtime And Model Format Need A Supported Pair
<!-- section-summary: A serving runtime supports specific formats, repository layouts, operators, batching behaviour, and lifecycle controls. -->

FastAPI can host application code that loads a Python model directly. BentoML packages Python model services. Ray Serve supports distributed Python serving graphs. ONNX Runtime executes ONNX graphs. NVIDIA Triton serves several backends through a model repository and adds scheduling and batching. KServe can operate approved runtimes on Kubernetes.

Each runtime has a contract. Triton expects model repository structure and backend configuration. ONNX Runtime needs supported operators and execution providers. A custom Python service needs process, concurrency, and lifecycle design. A platform should publish supported combinations rather than allow every model to choose arbitrary formats and servers.

TorchServe may appear in existing PyTorch estates, while its official documentation currently marks it as Limited Maintenance. Maintenance status belongs in compatibility and lifecycle decisions because unsupported runtime software can create a security and upgrade blocker.

Runtime selection also affects model behaviour. Dynamic batching changes request grouping and latency. Quantization changes numerical precision. Concurrent execution can expose thread-safety problems in preprocessing. Load tests need correctness checks alongside throughput.

## Hardware Compatibility Extends Through Drivers And Kernels
<!-- section-summary: Accelerator serving requires agreement among model, runtime, container libraries, host driver, device plugin, and node resources. -->

CPU serving mainly depends on architecture, instruction support, libraries, and resources. GPU serving adds model precision, accelerator type, CUDA runtime, host driver, cuDNN or other libraries, Kubernetes device plugin, scheduling labels, and memory capacity.

The container carries user-space accelerator libraries, while the host driver connects to the device. Compatibility follows the vendor's support matrix. A newer container runtime cannot assume every node driver supports it.

Kubernetes workloads request accelerator resources and target an approved node pool:

```yaml
resources:
  requests:
    cpu: "2"
    memory: 8Gi
    nvidia.com/gpu: "1"
  limits:
    nvidia.com/gpu: "1"
nodeSelector:
  accelerator: nvidia-l4
```

Scheduling success does not prove runtime compatibility. Startup tests should report detected device, driver and library versions, model precision, memory allocation, and execution provider. Representative inference should then verify output tolerance and latency.

Multi-instance GPU, tensor parallelism, and distributed inference add further topology and collective-library constraints. These combinations need explicit support and testing rather than inheritance from a generic “GPU compatible” label.

## Load Lifecycle Is Part Of Compatibility
<!-- section-summary: A compatible service loads, warms, reports readiness, handles failure, and exposes the model identity users reach. -->

The process can start before the model is usable. Liveness should indicate that the process can continue. Readiness should remain false until required artifacts are loaded, warm-up or compilation succeeds, dependencies are reachable, and the service can produce a valid fixture result.

Large models may load slowly or exceed memory only under concurrency. Startup timeout, model cache, download retries, disk capacity, and eviction policy need operational testing. A failed reload should preserve the current working model or route to a defined fallback rather than leave a half-initialized endpoint.

The service reports model version and digest, image digest, feature or tokenizer version, runtime, and loaded time. Prediction telemetry records the version handling live requests. This closes the gap between what deployment intended and what users reached.

## A Compatibility Matrix Defines Supported Combinations
<!-- section-summary: CI tests the small set of model, image, runtime, and hardware combinations the platform promises to operate. -->

A platform should avoid testing every possible package and hardware combination. It defines a supported matrix: approved artifact format, serving image, runtime version, CPU architecture or GPU class, driver family, and request contract.

CI can test CPU load and fixtures on every candidate. GPU jobs may run on release branches or a dedicated pool. Staging then tests startup, warm-up, load, concurrency, and telemetry under production-like configuration.

The matrix should include rollback compatibility. A previous model may not run after a breaking feature or image update. Either retain a complete previous release or prove that the old artifact works in the new runtime before treating it as a rollback target.

Failures are easier to locate when tests follow the same boundaries as the framework: request-to-feature, feature-to-signature, artifact-to-library, format-to-runtime, runtime-to-hardware, and load-to-readiness.

The matrix should stay intentionally small. Teams sometimes respond to compatibility risk by generating a combinatorial grid of every framework, Python, image, and GPU version. That test estate quickly grows unaffordable and still fails to define what users may rely on. A platform instead publishes a few supported lanes—for example, current CPU, current GPU, and the retained rollback lane—and gives each lane an owner and an upgrade window. Experimental combinations may run in a sandbox; promotion into the supported matrix makes them production options.

Upgrades then follow a controlled migration. First add the proposed runtime or hardware as a new lane. Run existing artifacts and fixtures on both old and new lanes. Compare task quality, numerical tolerance, load behaviour, and performance. Move canary traffic only after the new lane passes. Keep the old lane until rollback has been exercised. Removing it is a separate decision from declaring the new lane healthy.

The matrix can run as a small set of release jobs rather than one vague “serving test”:

```yaml
include:
  - id: cpu-current
    artifact: document-classifier-42.onnx
    image: document-api@sha256:cb41...
    runner: linux-x86_64-avx2
    providers: [CPUExecutionProvider]
  - id: gpu-l4
    artifact: document-classifier-42.onnx
    image: document-api-cuda@sha256:912e...
    runner: nvidia-l4-driver-550
    providers: [CUDAExecutionProvider]
  - id: rollback-cpu
    artifact: document-classifier-41.onnx
    image: document-api@sha256:cb41...
    runner: linux-x86_64-avx2
    providers: [CPUExecutionProvider]
```

Each job validates the request fixture, feature tensor, runtime providers, loaded digest, output tolerance, two concurrent predictions, and readiness metadata. `rollback-cpu` answers a separate question: whether the retained artifact still works after the image changed. A green current-model test cannot answer it.

The job should print the first failed boundary:

```json
{
  "matrix_id": "gpu-l4",
  "state": "failed",
  "boundary": "runtime_to_hardware",
  "expected_provider": "CUDAExecutionProvider",
  "available_providers": ["CPUExecutionProvider"],
  "loaded_model": false,
  "traffic_allowed": false
}
```

This output points operators toward image libraries, driver compatibility, device exposure, or scheduling. Retrying artifact download cannot repair a missing provider. After the node or image is corrected, the same matrix job must report the expected provider and pass the prediction fixture before the release can advance.

## The Release Record Captures The Proven Combination
<!-- section-summary: A compatibility record links the tested model, schema, software, hardware, lifecycle, and rollback identities. -->

After the relationships pass, a release record can identify the supported combination:

```yaml
model:
  version: document-classifier-42
  artifact_sha256: 5f31d2f6...
schema:
  request: document-request-v3
  features: document-features-v5
runtime:
  image: ghcr.io/example/document-api@sha256:cb41...
  server: fastapi
hardware:
  node_pool: cpu-inference-v4
verification:
  fixture_suite: document-serving-compatibility-v8
rollback:
  release: document-classifier-41
```

The record makes the tested result reviewable. It should link to detailed test evidence rather than repeat every dependency. Any changed component that can alter compatibility creates a new matrix result and release decision.

## Compatibility Incidents Follow The Boundary Chain
<!-- section-summary: Incident triage identifies the first incompatible boundary and restores a complete known release. -->

A schema error points to caller, validation, or preprocessing. A deserialization error points to artifact and library compatibility. Missing GPU providers point to image, driver, or scheduling. Readiness failures point to download, load, warm-up, or dependency lifecycle. Wrong outputs with healthy service metrics point to semantic preprocessing or numerical change.

Rollback restores the previous model, image, schema path, and compatible feature configuration as one release. Operators verify the loaded identity and fixture result before returning traffic.

Runtime compatibility is therefore a chain of explicit agreements. The manifest is useful because the team has already understood and tested those agreements.

## References

- [MLflow model signatures](https://mlflow.org/docs/latest/ml/model/signatures/)
- [ONNX Runtime compatibility](https://onnxruntime.ai/docs/reference/compatibility.html)
- [NVIDIA CUDA compatibility](https://docs.nvidia.com/deploy/cuda-compatibility/)
- [NVIDIA GPU Operator platform support](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/platform-support.html)
- [NVIDIA Triton Inference Server](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/)
- [TorchServe documentation](https://docs.pytorch.org/serve/)
