---
title: "Runtime Compatibility"
description: "Understand and test the complete compatibility chain from serving requests and model artifacts to native libraries, runtimes, hardware, readiness, and rollback."
overview: "A model can load successfully and still produce the wrong result, miss its latency target, or run on unintended hardware. Compatibility boundaries and supported serving lanes let release and incident evidence identify the exact combination that was tested."
tags: ["MLOps", "production", "packaging"]
order: 3
id: "article-mlops-model-serving-model-artifacts-runtime-dependencies"
---

## Table of Contents

1. [Which Contracts Must Align for a Model Artifact to Run?](#which-contracts-must-align-for-a-model-artifact-to-run)
2. [How Do Packages, Native Libraries, CPUs, GPUs, Resources, and Numerics Affect Compatibility?](#how-do-packages-native-libraries-cpus-gpus-resources-and-numerics-affect-compatibility)
3. [What Are the Three Main Runtime Compatibility Failure Modes?](#what-are-the-three-main-runtime-compatibility-failure-modes)
4. [How Do Startup, Warmup, Behaviour Tests, and a Support Matrix Prove a Combination?](#how-do-startup-warmup-behaviour-tests-and-a-support-matrix-prove-a-combination)
5. [How Do Performance, Quantization, Custom Operators, Shapes, Containers, and Hardware Enter the Release Tuple?](#how-do-performance-quantization-custom-operators-shapes-containers-and-hardware-enter-the-release-tuple)
6. [How Should CI and Debugging Find the First Incompatible Layer?](#how-should-ci-and-debugging-find-the-first-incompatible-layer)
7. [How Do Compatibility, Reproducibility, Portability, and Rollback Differ?](#how-do-compatibility-reproducibility-portability-and-rollback-differ)
8. [Which Layered Invariants Define the Complete Compatible Serving System?](#which-layered-invariants-define-the-complete-compatible-serving-system)
9. [Check Your Answers](#check-your-answers)

A model file loads on a CPU laptop, fails on one GPU host, and runs slowly on another even though all three machines have the same Python package version. The difference may live in the model format, native ABI, driver, hardware capability, operator support, memory, or numerical fast path.

**Runtime compatibility** means that every layer needed for the real prediction path can work together and preserve required behaviour. “The file loads” is only the first rung of a ladder that also includes execution, semantics, performance, capacity, and the public API contract.

Use these questions to test and debug the complete model-runtime-hardware combination rather than relying on package names alone:

1. **Which Contracts Must Align for a Model Artifact to Run?**
2. **How Do Packages, Native Libraries, CPUs, GPUs, Resources, and Numerics Affect Compatibility?**
3. **What Are the Three Main Runtime Compatibility Failure Modes?**
4. **How Do Startup, Warmup, Behaviour Tests, and a Support Matrix Prove a Combination?**
5. **How Do Performance, Quantization, Custom Operators, Shapes, Containers, and Hardware Enter the Release Tuple?**
6. **How Should CI and Debugging Find the First Incompatible Layer?**
7. **How Do Compatibility, Reproducibility, Portability, and Rollback Differ?**
8. **Which Layered Invariants Define the Complete Compatible Serving System?**

## Which Contracts Must Align for a Model Artifact to Run?
<!-- section-summary: Compatibility requires the request, serialization, loader, operators, runtime, libraries, hardware, resources, and response semantics to agree across every link. -->

A model format is useful only when every layer from request to hardware can satisfy the assumptions encoded in that artifact.

Runtime compatibility in model serving becomes much easier to reason about if we start with one question:

**What must be true for a saved model to execute on a particular serving machine and preserve the prediction behaviour we intended?**

A model does not run directly on "a computer." It runs through a stack:

```text
request
   ↓
serving application
   ↓
preprocessing / tokenizer
   ↓
model representation
   ↓
model runtime / framework
   ↓
native libraries
   ↓
accelerator runtime
   ↓
device driver
   ↓
CPU / GPU / accelerator
```

If any adjacent pair cannot communicate correctly, the model may fail. And sometimes the dangerous failure is not:

```text
crash
```

but:

```text
runs successfully
produces wrong predictions
```

That is the core runtime-compatibility problem. A weak definition is:

"The model file loads."

That's not enough. Suppose:

```text
model loads       ✓
GPU initializes   ✓
inference runs    ✓
```

but a tokenizer version changed and produces different token IDs. The service is technically executable but semantically wrong. A stronger definition is:

```text
compatible(model, runtime)
=
can_load
AND can_execute
AND preserves_required_semantics
AND satisfies_resource_requirements
```

So runtime compatibility means:

**The complete serving environment can reconstruct and execute the model's intended prediction function within the behaviour and numerical tolerances the application requires.**

That includes much more than Python versions. Suppose training defines:

$$
y =
P_{out}
(
M_\theta(
P_{in}(x)
)
)
$$

where:

* $$x$$ is the incoming request,
* $$P_{in}$$ is preprocessing,
* $$M_\theta$$ is the trained model,
* $$P_{out}$$ is postprocessing.

Serving attempts to reconstruct that same computation:

```text
raw request
     ↓
same input interpretation
     ↓
compatible preprocessing
     ↓
compatible model execution
     ↓
compatible postprocessing
     ↓
same meaning of output
```

Therefore compatibility is not merely:

```text
Does PyTorch understand weights.pt
```

It is closer to:

```text
Does the serving stack implement the function we approved
```

Suppose a model expects:

```text
input:
    float32
    shape [batch, 3, 224, 224]
    RGB
    normalized with specific mean/std
```

A runtime capable of executing the model is useless if the serving application feeds:

```text
uint8
[batch, 224, 224, 3]
BGR
unnormalized
```

So before asking:

Which runtime can execute this model

establish:

```text
What does the model consume
What does it produce
What preprocessing does it assume
What postprocessing does it assume
```

For a language model, that might mean:

```text
tokenizer family/version
vocabulary size
special token IDs
chat template
maximum context
tensor dtypes
attention mask semantics
generation configuration
```

For a tabular model:

```text
feature names
feature ordering
categorical encodings
missing-value representation
scaling
output meanings
```

Compatibility begins with contracts, not package installation. Consider this stack:

```text
┌──────────────────────────────┐
│ Serving API                  │
├──────────────────────────────┤
│ Pre/postprocessing code      │
├──────────────────────────────┤
│ Python packages              │
├──────────────────────────────┤
│ Model runtime/framework      │
├──────────────────────────────┤
│ Native libraries            │
├──────────────────────────────┤
│ Accelerator runtime         │
├──────────────────────────────┤
│ Device driver               │
├──────────────────────────────┤
│ Hardware                     │
└──────────────────────────────┘
```

Every layer makes assumptions about the one below it.

For example:

```text
your code
    assumes API provided by
PyTorch
    assumes native libraries
CUDA runtime
    assumes compatible
GPU driver
    assumes compatible
GPU hardware
```

Runtime compatibility is therefore a **chain of contracts**. Suppose:

```text
Model → PyTorch        compatible
PyTorch → CUDA         compatible
CUDA → driver          compatible
driver → GPU           compatible
```

Then the chain may work. But one broken link:

```text
Model → PyTorch        compatible
PyTorch → CUDA         compatible
CUDA → driver          ✗
```

means:

```text
whole serving stack    ✗
```

This leads to a powerful debugging principle:

> **When a model does not run, find the first boundary at which the assumptions of the upper layer are not satisfied by the lower layer.**

Don't debug "the whole GPU stack" as one mysterious object. Consider saving:

```text
model artifact
```

What exactly is inside it? There are several possibilities.

### Learned state only

```text
weights
```

Then serving must separately reconstruct:

```text
architecture
configuration
```

before applying those weights.

### Computation graph plus parameters

The representation might capture more of:

```text
operators
graph structure
weights
```

Now the target runtime has to support every represented operator.

### Serialized language objects

The artifact may assume:

```text
specific Python classes
specific module names
specific package behaviour
```

Now compatibility becomes tightly coupled to the software environment. So the serialization format determines the loading contract. Suppose your artifact contains:

```text
layer1.weight
layer1.bias
layer2.weight
...
```

The serving application does:

```python
model = MyArchitecture(config)
model.load_state_dict(weights)
```

The artifact assumes that serving still knows what:

```text
MyArchitecture
```

means. If training used:

```python
class MyArchitectureV1:
    ...
```

but deployment now instantiates:

```python
class MyArchitectureV2:
    ...
```

the tensor names might even load successfully while behaviour changes. So compatibility includes:

```text
weights
↔
architecture implementation
```

not merely:

```text
weights
↔
framework
```

Suppose a model is exported into an intermediate representation:

```text
model graph
   ├── MatMul
   ├── Add
   ├── LayerNorm
   ├── CustomOperatorX
   └── ...
```

A target runtime can execute it only if it supports the required semantics.

Conceptually:

```text
Model requires operators:
{A, B, C, D}

Runtime supports:
{A, B, C}

D missing
→ incompatible
```

Sometimes an operator exists but only for:

```text
certain dtypes
certain tensor dimensions
certain hardware backends
certain format versions
```

So operator support is not always binary. Suppose an exporter writes:

```text
format version 17
```

but your serving runtime only understands:

```text
versions ≤ 15
```

The model may fail before inference begins. This is why the real relationship is:

```text
model format/version
        ↓
runtime implementation/version
```

not simply:

```text
ONNX model → ONNX runtime
```

or:

```text
framework model → framework
```

Names alone do not establish compatibility. Versions and features matter.

## How Do Packages, Native Libraries, CPUs, GPUs, Resources, and Numerics Affect Compatibility?
<!-- section-summary: Python packages sit above ABI, architecture, drivers, accelerators, memory, numerical behaviour, and workload limits that can alter execution or decisions. -->

The visible Python environment is one part of a deeper stack that includes native interfaces, architecture, accelerators, resources, and numerical paths.

Suppose:

```text
pip freeze
```

shows:

```text
torch==X
numpy==Y
fastapi==Z
```

You might think the runtime is fully specified. But packages such as numerical and ML frameworks often contain or call native code:

```text
Python
  ↓
C / C++
  ↓
BLAS
  ↓
CUDA / ROCm / other libraries
```

So two machines can have identical Python package versions and still behave differently because their native environments differ.

For example:

```text
Machine A:
same Python packages
native library A
CPU features X

Machine B:
same Python packages
native library B
CPU features Y
```

Compatibility must be considered across both worlds. At machine-code boundaries, libraries need to agree on things such as:

```text
symbol names
calling conventions
memory layouts
binary interfaces
```

This is an ABI: an Application Binary Interface. At the Python level you may see:

```python
import some_library
```

but underneath it may dynamically load:

```text
libsomething.so
```

If the expected binary interface doesn't exist, you may encounter errors like:

```text
undefined symbol
cannot open shared object
wrong ELF class
library version not found
```

Those aren't really "Python errors." They reveal incompatibility lower in the stack. Suppose a binary was built for:

```text
x86-64
```

and you deploy to:

```text
ARM64
```

The source code might be portable. The binary is not necessarily portable. Even within one CPU architecture, optimized libraries might assume instructions such as:

```text
AVX
AVX2
AVX-512
```

If the target CPU lacks the expected instruction set:

```text
program may fail
```

or a different slower implementation may be selected. So "CPU deployment" does not describe one uniform environment. A simplified GPU stack is:

```text
model
   ↓
framework / inference runtime
   ↓
CUDA userspace libraries
   ↓
NVIDIA driver
   ↓
GPU hardware
```

Or with another accelerator ecosystem:

```text
model
   ↓
runtime
   ↓
accelerator software stack
   ↓
driver
   ↓
hardware
```

Each layer has compatibility requirements. Therefore:

```text
model works on GPU
```

is far too vague. The useful question is:

**Which model/runtime/library/driver/device combination was tested?**

This is an especially useful distinction in containerized serving. Your container might contain:

```text
PyTorch
CUDA userspace libraries
cuDNN
other GPU libraries
```

while the host supplies:

```text
kernel driver
physical GPU
```

Conceptually:

```text
Container
┌─────────────────────┐
│ PyTorch             │
│ CUDA runtime        │
│ cuDNN               │
└──────────┬──────────┘
           │
           ▼
Host
┌─────────────────────┐
│ NVIDIA driver       │
└──────────┬──────────┘
           ▼
         GPU
```

So an identical Docker image can work on one host and fail on another. Docker does not package the entire accelerator stack. Suppose a model expects efficient:

```text
BF16
```

or:

```text
FP8
```

execution. One accelerator supports it directly. Another does not. The runtime might:

```text
reject the model
```

or:

```text
fall back to another precision
```

or:

```text
run a slower implementation
```

These represent three very different operational outcomes. Therefore compatibility sometimes means more than:

```text
can technically execute
```

You may require:

```text
can execute using the intended kernel/precision/performance mode
```

Suppose a model artifact and runtime are logically compatible. But:

```text
model weights       = 38 GB
peak KV cache       = 30 GB
workspace           = 8 GB
GPU VRAM            = 40 GB
```

This model cannot execute under the intended workload. So:

```text
software compatible
```

does not imply:

```text
operationally compatible
```

A useful predicate is:

```text
compatible(model, environment, workload)
```

because memory usage may depend on:

```text
batch size
sequence length
number of concurrent requests
precision
KV-cache configuration
image size
```

Imagine:

```text
batch=1, sequence=512
```

works. But:

```text
batch=16, sequence=8192
```

causes an out-of-memory failure. The runtime is capable of executing the model, but not under every permitted request. So you need to know:

```text
model limit
runtime limit
deployment resource limit
API input limit
```

and make them agree.

For example:

```text
API permits max context = 32k
         ↓
serving runtime must support 32k
         ↓
GPU memory budget must support 32k
```

If they don't line up, the API advertises a capability the deployment cannot provide. Suppose CPU inference returns:

```text
0.9134721
```

while GPU inference returns:

```text
0.9134718
```

Those may be entirely acceptable. Floating-point arithmetic is finite-precision arithmetic. Things such as:

```text
operation ordering
parallel reductions
kernel implementation
precision
hardware
compiler optimisation
```

can produce small differences. Therefore compatibility should rarely mean:

```text
bit-for-bit identical
```

unless you explicitly require it. Instead define tolerances.

For example:

$$
|y_\text{new}-y_\text{reference}|<\epsilon
$$

Suppose classification uses:

```text
approve if score >= 0.500000
```

and two runtimes produce:

```text
Runtime A: 0.500001
Runtime B: 0.499999
```

Numerically:

```text
almost identical
```

Semantically:

```text
opposite decisions
```

So runtime validation should understand the downstream use of predictions. This is particularly important around:

```text
thresholds
argmax ties
beam-search decisions
sampling
numerically unstable operations
```

A meaningful compatibility test is based on required behaviour, not arbitrary decimal equality. Suppose an LLM generates text using:

```text
temperature > 0
sampling enabled
```

Then even on the same machine:

```text
same input
```

can legitimately produce:

```text
different outputs
```

So you cannot test runtime compatibility by asserting:

```text
generated_text == saved_generated_text
```

unless you deliberately configure deterministic inference. Instead you might test lower-level invariants:

```text
tokenizer IDs match
logit dimensions match
deterministic decoding mode gives expected result
outputs contain finite values
known first-token logits are within tolerance
```

Again, the test must match the mathematical properties of the model.

![Seven compatibility boundaries from request contract through preprocessing, model artifact, runtime, native libraries, and hardware, plus the operating-envelope checks required for acceptance.](/content-assets/articles/article-mlops-model-serving-model-artifacts-runtime-dependencies/runtime-compatibility-chain.png)

*A model is compatible only when every translation boundary preserves meaning and the complete service still meets its output, startup, memory, latency, and concurrency targets.*

## What Are the Three Main Runtime Compatibility Failure Modes?
<!-- section-summary: A combination may fail to load, load but fail during execution, or run successfully while changing behaviour, latency, or capacity. -->

Those boundaries fail in three distinct ways, ranging from an immediate load error to a silent semantic change.

A useful failure taxonomy is:

```text
1. load failure
2. execution failure
3. semantic failure
```

They occur at increasingly dangerous levels. Examples:

```text
unsupported serialization version
missing class
missing shared library
incorrect architecture
weight shape mismatch
unknown operator
corrupt artifact
```

This is usually the easiest failure to detect. You get an explicit error.

```text
startup
   ↓
load
   ↓
ERROR
```

The service should remain unready. Examples:

```text
unsupported GPU kernel
insufficient VRAM
operator unsupported for dtype
driver incompatibility
unexpected tensor shape
runtime compiler failure
```

The lifecycle becomes:

```text
load        ✓
warmup      ✗
```

This is why:

**Successful deserialization is not enough to declare readiness.**

A representative inference needs to run. This is the most dangerous class. Examples:

```text
wrong tokenizer
different normalization
changed feature ordering
incorrect label map
runtime operator semantics changed
unexpected precision change
postprocessing changed
```

Now:

```text
model loads      ✓
warmup runs      ✓
requests return  ✓
predictions      ✗
```

Infrastructure health checks may report:

```text
green
```

while the model is functionally wrong. Therefore compatibility validation must include behavioural tests. Think of progressively stronger guarantees:

```text
artifact exists
      ↓
artifact can be parsed
      ↓
architecture can be constructed
      ↓
weights can be loaded
      ↓
runtime can execute operators
      ↓
hardware can execute kernels
      ↓
resources are sufficient
      ↓
reference inputs execute
      ↓
predictions match required behaviour
      ↓
performance meets serving requirements
```

Every level is stronger than the previous one. Saying:

```text
"We tested that it loads."
```

only reaches the middle of the ladder.

## How Do Startup, Warmup, Behaviour Tests, and a Support Matrix Prove a Combination?
<!-- section-summary: Startup loading, representative warmup, end-to-end behavioural checks, explicit requirements, and a small tested matrix turn compatibility into evidence. -->

A release needs evidence for each mode, which makes loading, warmup, representative behaviour, and a documented support matrix part of CI.

Suppose your HTTP server starts first:

```text
Uvicorn listening
        ↓
health endpoint returns 200
        ↓
traffic arrives
        ↓
model loading begins
        ↓
model fails
```

That's backwards. Model initialization belongs before readiness. A better sequence:

```text
container starts
      ↓
verify environment
      ↓
load model
      ↓
run warmup
      ↓
run compatibility checks
      ↓
READY
      ↓
traffic
```

Readiness means the complete serving stack has passed its requirements. Warm-up is often discussed purely as performance optimisation:

```text
first inference slow
→ run dummy inference first
```

But it has another function. It forces execution through layers that loading may not touch:

```text
model graph
   ↓
operator selection
   ↓
kernel loading/compilation
   ↓
device memory allocation
   ↓
hardware execution
```

So a warm-up can reveal:

```text
missing kernels
unsupported operations
GPU OOM
compiler problems
bad device mappings
```

before real traffic arrives. Suppose production allows:

```text
sequence length up to 32,000
```

but your warm-up uses:

```text
sequence length = 1
```

It proves almost nothing about peak memory behaviour. You may want several startup tests:

```text
minimal inference
representative inference
resource-boundary inference
```

Not necessarily the absolute worst-case request—startup should remain reasonable—but enough to exercise important execution paths. A very strong compatibility check is:

```text
known raw input
      ↓
production preprocessing
      ↓
loaded model
      ↓
production postprocessing
      ↓
expected response
```

Instead of merely:

```python
model(dummy_tensor)
```

This catches:

```text
tokenizer incompatibility
input preprocessing differences
model runtime problems
label mapping mistakes
postprocessing changes
```

It's an end-to-end semantic check. Don't rely on:

"I think this model needs CUDA 13-ish."

Instead record metadata conceptually like:

```text
model:
  artifact_digest: ...
  format: ...
  format_version: ...
  architecture: ...

runtime:
  implementation: ...
  supported_versions: ...

software:
  Python: ...
  framework: ...
  tokenizer: ...

hardware:
  device_family: ...
  minimum_memory: ...
  required_features: ...

behaviour:
  reference_tests: ...
  numerical_tolerance: ...
```

Then compatibility becomes partially machine-checkable. Imagine your team claims to support:

```text
Python:
3.10, 3.11, 3.12

PyTorch:
A, B, C

CUDA:
X, Y, Z

GPU:
T4, A10, A100, H100

Model format:
V1, V2, V3
```

The theoretical number of combinations is:

```text
3 × 3 × 3 × 4 × 3
= 324 combinations
```

You probably haven't actually tested 324 environments. This creates **implicit unsupported states**. A better strategy is to deliberately support a small number of known combinations.

For example:

```text
Serving stack 2026.08:
Python P
Framework F
CUDA C
Runtime R
GPU families {A100, H100}
```

Now "supported" means something concrete.

Conceptually:

| Model release | Runtime A | Runtime B | Runtime C |
| ------------- | --------: | --------: | --------: |
| Model 17      |         ✓ |         ✓ |          |
| Model 18      |         ✗ |         ✓ |         ✓ |
| Model 19      |         ✗ |          |         ✓ |

Here:

```text
✓ = tested and supported
✗ = known incompatible
 = not established
```

The critical rule is:

**Unknown should not silently mean supported.**

This is especially useful during upgrades. Suppose current production is:

```text
Model 17
Runtime 5
```

and you want:

```text
Model 18
Runtime 6
```

If you change both at once:

```text
(M17, R5)
      ↓
(M18, R6)
```

and predictions change, what caused it Could be:

```text
model
runtime
interaction between model and runtime
```

A more diagnosable sequence might test:

```text
(M17, R5) current
     ↓
(M17, R6) runtime upgrade
     ↓
(M18, R6) model upgrade
```

when practical. Now each transition changes fewer variables. Suppose:

```text
Model 17 + Runtime 5
```

has been tested. Does that automatically prove:

```text
Model 17 + Runtime 6
```

is safe No. Even if Runtime 6 claims backward compatibility, your application hasn't yet established its required semantics. So:

**A runtime upgrade creates a new model-serving combination that deserves compatibility testing.**

The same applies to:

```text
new driver
new GPU
new compiler
new quantization runtime
new tokenizer version
```

Anything capable of changing execution deserves evaluation proportional to its risk. A library might promise:

```text
old API still works
```

That generally means:

```text
your program should continue functioning
```

not necessarily:

```text
every floating-point result will be identical
latency will be identical
memory use will be identical
kernel choice will be identical
```

For model serving, all of those can matter. So your own compatibility contract may be stricter than a library vendor's API compatibility guarantee.

## How Do Performance, Quantization, Custom Operators, Shapes, Containers, and Hardware Enter the Release Tuple?
<!-- section-summary: Performance, quantization, custom operators, compilation, shapes, containers, hardware, model, and configuration form one versioned release tuple. -->

Successful execution still has to meet performance and resource requirements across quantization, operators, shapes, containers, and hardware.

Suppose Runtime B gives exactly the same predictions as Runtime A. But:

```text
Runtime A:
p99 = 300 ms
GPU memory = 30 GB

Runtime B:
p99 = 1.8 sec
GPU memory = 45 GB
```

If your serving SLO is:

```text
p99 < 500 ms
```

Runtime B is not operationally compatible with your service requirements. So define:

```text
functional compatibility
```

and:

```text
operational compatibility
```

separately. A new stack should satisfy both. Suppose a model is exported as:

```text
INT8
```

or:

```text
FP8
```

Now compatibility may depend on:

```text
quantization scheme
runtime implementation
hardware support
calibration assumptions
special kernels
```

Two runtimes might both claim "INT8 support" while interpreting or implementing quantization differently. Again:

```text
same high-level label
```

does not establish:

```text
same execution semantics
```

The exact model representation and runtime pairing needs testing. Standard operations can often move across runtimes more easily. Suppose your model contains:

```text
CustomAttentionV7
```

Now the serving environment must supply exactly that operation—or a compatible implementation. The artifact may effectively depend on:

```text
model graph
+
custom native library
+
specific runtime integration
```

This increases deployment coupling. Custom operators can be worthwhile for performance, but they narrow the set of compatible environments. Some serving systems compile or optimize a model for a target.

Conceptually:

```text
portable model
    ↓
compile for GPU family X
    ↓
optimized execution artifact
```

That compiled artifact may encode assumptions about:

```text
device architecture
supported kernels
tensor shapes
precision
runtime version
```

Now:

```text
portable source artifact
```

and:

```text
compiled serving artifact
```

should have distinct identities. The latter may be compatible only with a narrower target set. Suppose a model was compiled with:

```text
batch ∈ [1, 8]
sequence ∈ [1, 4096]
```

Then a request with:

```text
sequence = 8192
```

might be mathematically valid for the original model but invalid for the compiled runtime artifact. So the input contract must reflect the deployed runtime's actual capabilities:

```text
model theoretical limits
       ∩
runtime compiled limits
       ∩
resource limits
       =
serving API limits
```

That intersection is what you can safely advertise. Suppose the original model supports:

```text
128k context
```

but your chosen GPU/runtime combination supports only:

```text
64k under your memory budget
```

Then the serving endpoint should not claim:

```text
128k context supported
```

just because the architecture theoretically permits it. The externally visible contract should be bounded by actual deployment compatibility. A useful formula is:

$$
SupportedCapability
=
ModelCapability
\cap RuntimeCapability
\cap HardwareCapability
\cap OperationalPolicy
$$

The smallest constraint wins. Docker can pin:

```text
Python
framework
CUDA userspace libraries
native application dependencies
```

That dramatically reduces variation. But the container still relies on:

```text
host kernel
GPU driver
actual CPU/GPU
container runtime
resource allocation
```

Therefore:

```text
same container digest
```

does not prove:

```text
same complete runtime environment
```

especially for accelerator workloads. Containers control a large piece of the compatibility matrix, not all of it. When an issue occurs, knowing only:

```text
model = v18
```

is insufficient. You might need:

```text
model artifact digest
serving image digest
runtime version
framework version
driver version
device model
precision
runtime configuration
```

For example:

```text
Model 18
Image ABC
Runtime R7
H100
BF16
```

may behave differently from:

```text
Model 18
Image ABC
Runtime R7
A100
BF16
```

Exact deployment metadata gives you a coordinate in the compatibility space. Instead of:

```text
Release = Model
```

a sophisticated serving system is closer to:

$$
Release =
(M,\ S,\ R,\ H,\ C)
$$

where:

* $$M$$ = exact model artifact,
* $$S$$ = serving software/image,
* $$R$$ = runtime stack,
* $$H$$ = hardware class,
* $$C$$ = important runtime configuration.

For example:

```text
M = model sha256:AAA
S = image sha256:BBB
R = inference-runtime-7
H = H100-80GB
C = BF16, max_batch=32
```

This complete combination is what you've actually tested. Avoid production descriptions like:

```text
latest PyTorch
CUDA image
H100 machine
production model
```

Prefer exact identities or controlled version ranges:

```text
serving image digest = ...
model digest = ...
runtime release = ...
driver release = ...
GPU class = ...
```

This makes an incident reproducible. Otherwise "same setup" can secretly mean different things on different days.

![Three runtime compatibility failure classes with the evidence each exposes and the boundaries engineers should investigate.](/content-assets/articles/article-mlops-model-serving-model-artifacts-runtime-dependencies/compatibility-failure-triage.png)

*Load failure, behavioral drift, and operating-envelope failure can look similar from outside the service, but each one sends the investigation to a different part of the compatibility chain.*

## How Should CI and Debugging Find the First Incompatible Layer?
<!-- section-summary: CI should test representative models before traffic, while debugging starts at the lowest layer and walks upward to the first violated invariant. -->

When a combination fails, testing and debugging should locate the first broken invariant instead of treating the stack as one black box.

Suppose a pull request upgrades:

```text
inference runtime 7 → 8
```

Tests should ideally build the actual serving artifact and exercise:

```text
load approved models
run reference predictions
run representative shapes
verify numerical tolerances
verify resource use
verify latency where relevant
```

This turns compatibility from:

```text
knowledge in someone's head
```

into:

```text
an enforced release property
```

If your runtime serves many models, you don't necessarily need to test every historical model on every commit. You can maintain representative classes:

```text
text encoder
vision classifier
large decoder model
quantized model
custom-operator model
dynamic-shape model
```

When upgrading the serving stack, test models covering important execution paths. Then separately certify high-value production models before rollout. The goal is to expose incompatibility early. A good startup sequence looks like:

```text
STARTING
   ↓
identify exact release
   ↓
check runtime metadata
   ↓
check device capabilities
   ↓
verify model
   ↓
load
   ↓
warm-up
   ↓
reference predictions
   ↓
resource checks
   ↓
READY
```

Any compatibility failure before `READY` is preferable to discovering it from customer requests. This is the serving equivalent of type checking before execution. A readiness endpoint should conceptually mean:

**This process has successfully established the invariants required to serve this particular model on this particular runtime.**

Not simply:

```text
HTTP server is listening
```

For a model service:

```text
readiness
=
model_loaded
AND runtime_initialized
AND critical_validation_passed
AND serving_dependencies_available
```

The precise checks vary, but their meaning should be strong. Suppose the model fails during startup. Instead of randomly reinstalling libraries, trace the stack. For a GPU service:

```text
Does OS see GPU
        ↓
Does driver work
        ↓
Can container access GPU
        ↓
Can runtime initialize accelerator
        ↓
Can framework allocate a tensor
        ↓
Can model artifact load
        ↓
Can one model operation execute
        ↓
Can warm-up execute
        ↓
Does reference prediction match
```

This isolates the first broken boundary. Suppose:

```text
model inference falls back to CPU
```

Potential layers:

```text
Hardware:
GPU physically present

Driver:
host can see GPU

Container:
device exposed

Framework:
GPU-enabled build installed

Application:
model moved to GPU
```

Each question corresponds to a boundary. Jumping immediately to:

```text
reinstall model
```

may have nothing to do with the failure. Suppose startup reaches:

```text
weights loaded ✓
```

then warm-up fails:

```text
operator X unsupported
```

The debugging path is:

```text
What operator does the model require
          ↓
What version/variant is represented
          ↓
Does this runtime implement it
          ↓
Does this backend implement it
          ↓
Does this dtype/device combination support it
```

This narrows the issue much faster than treating it as "GPU incompatibility." Suppose:

```text
old environment → score 0.83
new environment → score 0.61
```

Don't assume immediately that numerical drift caused it. Trace the prediction pipeline:

```text
same raw input
    ↓
same preprocessing
    ↓
same tokenizer/vocabulary
    ↓
same token IDs / features
    ↓
same model artifact
    ↓
same raw model outputs
    ↓
same postprocessing
```

Find the first point where the two executions diverge. This is one of the strongest general debugging techniques:

**Compare adjacent intermediate representations until you find the earliest disagreement.**

Suppose:

```text
input
 ↓
tokens
 ↓
embeddings
 ↓
model output
 ↓
postprocessed response
```

Old environment returns A. New environment returns B. Compare:

```text
raw input            same
tokens               same
model output          different
```

Now the bug is below tokenization. If:

```text
tokens               different
```

there's no reason to investigate CUDA kernels yet. Find the earliest divergence. Everything after it is downstream consequence.

## How Do Compatibility, Reproducibility, Portability, and Rollback Differ?
<!-- section-summary: Compatibility means components can work together; reproducibility recreates a result; portability spans environments; rollback restores a complete tested combination. -->

Clear terminology prevents a compatible stack from being mistaken for a reproducible or portable one and ensures rollback restores all coupled layers.

These concepts overlap but differ.

### Compatibility

```text
Can this model run correctly here
```

### Reproducibility

```text
Can we reconstruct the same relevant environment and behaviour later
```

For example, a model might be compatible with:

```text
Runtime 5
Runtime 6
```

but only one of those is the exact production environment. Compatibility gives you a set of acceptable environments. Reproducibility identifies the one you actually used. A format might be highly portable:

```text
many runtimes can consume it
```

but a particular model might contain:

```text
custom operator
hardware-specific optimization
unsupported datatype
```

that reduces actual compatibility. So:

```text
portable format
```

does not imply:

```text
every artifact in that format runs everywhere
```

Model-specific features matter. Avoid:

"We support NVIDIA GPUs."

That's almost meaningless. Better:

```text
Model family A
  supported runtime: R7
  supported precision: BF16
  tested devices:
      device class X
      device class Y
  max configured context:
      32k
```

Now users and operators know the actual contract. A narrow truthful support matrix is better than a broad untested one. Suppose a framework's documentation suggests that:

```text
Runtime R8
```

should work with your GPU. That's useful evidence. But production support should ideally mean:

```text
we built it
we loaded our model
we executed our workload
we validated outputs
we measured resource use
```

In other words:

**"Supported" should be an empirical property of your release process, not an inference from package documentation alone.**

A new runtime can affect:

```text
latency
memory
kernel selection
numerical behaviour
throughput
startup time
```

even when predictions seem compatible in offline tests. So deploy:

```text
old runtime 99%
new runtime 1%
      ↓
compare
      ↓
increase gradually
```

while monitoring:

```text
errors
OOMs
p95/p99 latency
GPU utilisation
prediction drift
business/model metrics
```

Runtime upgrades deserve the same deployment discipline as model upgrades. Suppose the new release changes:

```text
runtime
model
container
configuration
```

and fails. Rollback should restore a previously tested combination:

```text
Model 17
Image A
Runtime R5
Config C
```

not construct a hybrid:

```text
Model 17
Image B
Runtime R6
Config D
```

that has never existed before. A rollback target should itself be a known compatible release.

## Which Layered Invariants Define the Complete Compatible Serving System?
<!-- section-summary: Each layer establishes invariants for the next, and the serving system is compatible only when the entire chain preserves load, execution, behaviour, and operational requirements. -->

The final layered model states the invariants that must hold from serialized artifact to production response.

Think of the stack as a sequence:

```text
raw artifact
    ↓
loader
    ↓
valid model representation
    ↓
runtime
    ↓
valid executable graph
    ↓
backend
    ↓
valid kernels
    ↓
driver/device
    ↓
actual computation
```

Every lower layer must establish properties the upper layer assumes.

For example:

```text
Model:
"I require operator X in BF16."

Runtime:
"I can map operator X to backend implementation Y."

Backend:
"I can execute Y on this GPU architecture."

Hardware:
"I support the required instruction/capability."
```

Compatibility exists only if the assumptions line up all the way down. Before serving a model, establish:

```text
Request contract
    What exactly enters the model

Model representation
    What format/version/operators does it require

Serving code
    What preprocessing and postprocessing does it use

Python/runtime dependencies
    Which APIs must exist

Native dependencies
    Which binary libraries/ABIs are required

Accelerator stack
    Which runtime and driver capabilities are required

Hardware
    Which architecture, precision features, and memory are required

Workload
    Which shapes, batches, contexts, and concurrency must work

Behaviour
    What outputs/tolerances prove semantic correctness

Operations
    What latency, memory, and throughput must be maintained
```

Then test that combination before declaring it supported. A useful overall picture is:

```text
                         REQUEST
                            │
                            ▼
                 ┌────────────────────┐
                 │ Request contract   │
                 │ shape / dtype /    │
                 │ semantics          │
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Preprocessing      │
                 │ tokenizer/features │
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Model artifact     │
                 │ format + weights   │
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Model runtime      │
                 │ framework/engine   │
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Native libraries   │
                 │ kernels / BLAS     │
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Accelerator stack  │
                 │ CUDA/etc. + driver │
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Hardware           │
                 │ CPU / GPU / RAM    │
                 └─────────┬──────────┘
                           ▼
                       EXECUTION
                           │
                           ▼
                 ┌────────────────────┐
                 │ Postprocessing     │
                 └─────────┬──────────┘
                           ▼
                    PREDICTION
```

The system is compatible only if the contracts between **all** these layers hold. A weak mental model is:

```text
"Install the right version of PyTorch
and the model should work."
```

A stronger model is:

```text
exact model artifact
        ↓
compatible serialization semantics
        ↓
compatible serving/preprocessing code
        ↓
compatible framework/runtime
        ↓
compatible native libraries
        ↓
compatible accelerator runtime
        ↓
compatible driver
        ↓
compatible hardware/resources
        ↓
representative inference succeeds
        ↓
prediction behaviour matches
        ↓
operational requirements hold
```

The central principle is:

> **Runtime compatibility is not a property of a model alone or a machine alone. It is a property of a specific model–software–runtime–hardware combination.**

And there are three increasingly serious questions to answer:

```text
Can we load it
       ↓
Can we execute it
       ↓
Does it still implement the behaviour we intended
```

That last question is the one most easily forgotten. If you therefore keep the supported combinations small, identify every release immutably, test loading and warm-up, exercise known predictions, record the runtime and hardware environment, and debug by finding the **first incompatible layer**, runtime compatibility stops being mysterious dependency troubleshooting and becomes a systematic exercise in checking contracts between adjacent layers.

![A tested serving lane moving from qualification into an immutable release record, canary observation, and complete recovery.](/content-assets/articles/article-mlops-model-serving-model-artifacts-runtime-dependencies/tested-serving-lane-summary.png)

*Qualification proves one explicit combination of model, runtime, and hardware; the release record keeps that combination identifiable during canary rollout, diagnosis, and rollback.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[Which Contracts Must Align for a Model Artifact to Run?]{kind="recap"}
Compatibility requires the request, serialization, loader, operators, runtime, libraries, hardware, resources, and response semantics to agree across every link.
:::

:::expand[How Do Packages, Native Libraries, CPUs, GPUs, Resources, and Numerics Affect Compatibility?]{kind="recap"}
Python packages sit above ABI, architecture, drivers, accelerators, memory, numerical behaviour, and workload limits that can alter execution or decisions.
:::

:::expand[What Are the Three Main Runtime Compatibility Failure Modes?]{kind="recap"}
A combination may fail to load, load but fail during execution, or run successfully while changing behaviour, latency, or capacity.
:::

:::expand[How Do Startup, Warmup, Behaviour Tests, and a Support Matrix Prove a Combination?]{kind="recap"}
Startup loading, representative warmup, end-to-end behavioural checks, explicit requirements, and a small tested matrix turn compatibility into evidence.
:::

:::expand[How Do Performance, Quantization, Custom Operators, Shapes, Containers, and Hardware Enter the Release Tuple?]{kind="recap"}
Performance, quantization, custom operators, compilation, shapes, containers, hardware, model, and configuration form one versioned release tuple.
:::

:::expand[How Should CI and Debugging Find the First Incompatible Layer?]{kind="recap"}
CI should test representative models before traffic, while debugging starts at the lowest layer and walks upward to the first violated invariant.
:::

:::expand[How Do Compatibility, Reproducibility, Portability, and Rollback Differ?]{kind="recap"}
Compatibility means components can work together; reproducibility recreates a result; portability spans environments; rollback restores a complete tested combination.
:::

:::expand[Which Layered Invariants Define the Complete Compatible Serving System?]{kind="recap"}
Each layer establishes invariants for the next, and the serving system is compatible only when the entire chain preserves load, execution, behaviour, and operational requirements.
:::
