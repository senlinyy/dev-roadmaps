---
title: "Docker Images for Model Serving"
description: "Package a model-serving process as a reproducible, secure OCI image, then test and deploy the complete release by immutable identity."
overview: "A production image gives every replica the same files and startup command, with explicit model placement, process lifecycle, health checks, runtime security, supply-chain evidence, smoke testing, deployment, and rollback."
tags: ["MLOps", "production", "containers"]
order: 2
id: "article-mlops-model-serving-docker-images-for-model-serving"
---

## Table of Contents

1. [What Does a Reproducible Model-Serving Image Contain?](#what-does-a-reproducible-model-serving-image-contain)
2. [Where Should a Large Model Artifact Live?](#where-should-a-large-model-artifact-live)
3. [How Do Process Ownership and Health Checks Control Container Readiness?](#how-do-process-ownership-and-health-checks-control-container-readiness)
4. [Which Security, Resource, Kernel, Architecture, and GPU Boundaries Remain?](#which-security-resource-kernel-architecture-and-gpu-boundaries-remain)
5. [How Do Provenance, SBOMs, Multi-Stage Builds, and Promotion Protect the Image?](#how-do-provenance-sboms-multi-stage-builds-and-promotion-protect-the-image)
6. [How Do Smoke Tests, Rollout, Rollback, State, Caches, and Quotas Affect Operation?](#how-do-smoke-tests-rollout-rollback-state-caches-and-quotas-affect-operation)
7. [How Do Supply-Chain Identity, Startup, and Lifecycle State Support Debugging?](#how-do-supply-chain-identity-startup-and-lifecycle-state-support-debugging)
8. [What Does Docker Solve, and What Must the Serving Platform Still Solve?](#what-does-docker-solve-and-what-must-the-serving-platform-still-solve)
9. [Check Your Answers](#check-your-answers)

A model service works on a developer laptop and fails in production because the Python version, native libraries, tokenizer files, and CUDA userspace do not match. Copying the model file solved only one dependency in the prediction path.

A **Docker image** is an immutable layered package used to create containers. For model serving it can carry the application, system libraries, runtime, entrypoint, and sometimes the model itself. The design must still decide artifact placement, startup, process ownership, security, host compatibility, health checks, and release identity.

These questions follow a serving image from its reproducible build to a tested and recoverable production release:

1. **What Does a Reproducible Model-Serving Image Contain?**
2. **Where Should a Large Model Artifact Live?**
3. **How Do Process Ownership and Health Checks Control Container Readiness?**
4. **Which Security, Resource, Kernel, Architecture, and GPU Boundaries Remain?**
5. **How Do Provenance, SBOMs, Multi-Stage Builds, and Promotion Protect the Image?**
6. **How Do Smoke Tests, Rollout, Rollback, State, Caches, and Quotas Affect Operation?**
7. **How Do Supply-Chain Identity, Startup, and Lifecycle State Support Debugging?**
8. **What Does Docker Solve, and What Must the Serving Platform Still Solve?**

## What Does a Reproducible Model-Serving Image Contain?
<!-- section-summary: A serving image packages code, dependencies, system libraries, entrypoint, and deterministic preparation as layered immutable build output identified by a digest. -->

A prediction depends on code and environment as well as the model, so the image begins as a reproducible package for that complete process.

Docker images for model serving are easiest to understand by starting with the underlying deployment problem:

> **A trained model only works if the machine running it has the right code, libraries, files, configuration, and system capabilities.**

Without containers, deployment often looks like:

```text
"It worked on my machine."

Why not production

Python version differs
PyTorch version differs
system libraries differ
tokenizer missing
model file missing
CUDA userspace libraries differ
environment variables differ
startup command differs
```

Docker tries to make a large part of that environment **explicit, packageable, and reproducible**. But a Docker image is not a virtual machine, and it does not contain everything the model needs. That distinction drives almost every good container design decision. Suppose your service is:

```text
HTTP request
    ↓
FastAPI
    ↓
preprocessing
    ↓
model
    ↓
prediction
```

To execute it, a machine may need:

```text
Python
FastAPI
Uvicorn
PyTorch
tokenizer library
your application code
model configuration
possibly model weights
system libraries
CUDA userspace libraries
startup configuration
```

If production installs all of these manually, the deployment procedure itself becomes part of the software.

For example:

```text
Machine A:
Python 3.11
PyTorch X
libXYZ version 4

Machine B:
Python 3.12
PyTorch Y
libXYZ version 5
```

Even with identical application code, behavior can differ. So we want something closer to:

```text
                BUILD
                  │
                  ▼
        ┌──────────────────┐
        │ Docker image     │
        │                  │
        │ OS userspace     │
        │ Python runtime   │
        │ dependencies     │
        │ serving code     │
        │ configuration    │
        └────────┬─────────┘
                 │
        same immutable image
          ┌──────┼──────┐
          ▼      ▼      ▼
       host A  host B  host C
```

The image defines a large portion of the execution environment. This distinction is fundamental. A Docker **image** is roughly:

```text
immutable filesystem
+
metadata
+
default startup configuration
```

A **container** is a running instance of that image. Think:

```text
class        → object
image        → container
blueprint    → running instance
```

You might have one image:

```text
sentiment-server@sha256:ABC...
```

and run:

```text
Container 1
Container 2
Container 3
```

from exactly the same image.

Conceptually:

```text
                 IMAGE
                   │
          ┌────────┼────────┐
          ▼        ▼        ▼
      container container container
          1        2        3
```

The image is the artifact you build. The container is the process environment you operate. Without an image, deployment might mean:

```text
Create machine
↓
Install Python
↓
Install compiler
↓
Install PyTorch
↓
Install application dependencies
↓
Copy source
↓
Copy model
↓
Set environment
↓
Start server
```

Every deployment repeats those steps. A Docker build moves much of that preparation earlier:

```text
                    BUILD TIME

Dockerfile
   ↓
install dependencies
   ↓
copy application
   ↓
prepare runtime
   ↓
Docker image
```

Then production startup becomes much smaller:

```text
                    RUN TIME

exact image
    ↓
create container
    ↓
load/obtain model
    ↓
warm up
    ↓
serve
```

This is one of the deepest benefits of containers:

**Do expensive and failure-prone environment construction before deployment whenever possible.**

Consider:

```dockerfile
FROM python:...
RUN pip install ...
COPY app /app
CMD ["python", "server.py"]
```

Two completely different events happen.

### During image build

Docker executes instructions such as:

```text
FROM
RUN
COPY
```

producing an image.

For example:

```text
install Python packages
compile native extensions
copy application code
possibly copy model artifacts
```

This could happen in CI days before production.

### During container startup

Docker takes the already-built image and executes its command:

```text
python server.py
```

Now your application might:

```text
initialize FastAPI
load model
initialize CUDA
warm model
begin accepting traffic
```

So:

```text
image build
≠
container startup
```

This matters operationally. Suppose every container starts with:

```text
pip install torch
pip install transformers
apt install ...
```

Now every production restart depends on:

```text
package repositories
internet access
dependency availability
dependency resolution
download speed
```

Worse, the result might change from one restart to another. That's undesirable. Prefer:

```text
Build:
    install dependencies

Startup:
    use installed dependencies
```

So instead of:

```text
container startup
    ↓
construct environment
    ↓
serve
```

you want:

```text
image build
    ↓
construct environment once
    ↓
immutable image
    ↓
container startup
    ↓
serve
```

The more deterministic work you move to build time, the more boring production startup becomes. And boring startup is good. Suppose your Dockerfile conceptually says:

```dockerfile
FROM python-base

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY src/ /app/
```

Think of it as layers:

```text
Layer 1: base operating environment
Layer 2: dependency specification
Layer 3: installed dependencies
Layer 4: application code
```

This matters because Docker can cache earlier layers. Imagine you modify only:

```text
app/routes.py
```

Dependencies haven't changed. Docker may reuse:

```text
base                 ✓ cached
Python dependencies  ✓ cached
```

and rebuild only:

```text
application code
```

That makes builds much faster. Imagine this Dockerfile:

```dockerfile
COPY . /app
RUN pip install -r /app/requirements.txt
```

You change one README. The `COPY` layer changes. Therefore everything after it may be rebuilt:

```text
COPY changed
   ↓
dependency installation invalidated
   ↓
reinstall everything
```

Instead:

```dockerfile
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY src/ /app/
```

Now changing application code doesn't invalidate dependency installation. A good mental model is:

```text
rarely changes
      ↓
base image
system dependencies
Python dependencies
application dependencies
      ↓
frequently changes
application code
```

This is especially important when ML dependencies take minutes to install. Imagine:

```text
model weights = 10 GB
application code = 20 MB
```

If your build does:

```dockerfile
COPY . /app
```

and model weights live inside that directory, every small change can create awkward enormous layers or invalidation. Better organization may separate:

```text
dependencies
application code
model artifact
```

because they have different change frequencies.

For example:

```text
framework changes rarely
model changes weekly
application changes daily
```

The image layout should reflect that reality. Consider:

```dockerfile
FROM python:latest
```

Today:

```text
python:latest → image A
```

Next month:

```text
python:latest → image B
```

Same Dockerfile. Different result. Similarly:

```text
pip install some-library
```

without a fixed version can resolve differently later. So:

```text
same source code
```

does not automatically imply:

```text
same image
```

For stronger reproducibility, pin important inputs:

```text
base image version/digest
Python dependencies
system packages where practical
model artifact identity
build configuration
```

At the strongest level, production should care about the final image's immutable digest:

```text
sha256:...
```

Suppose you push:

```text
my-model-server:production
```

Today it might point to:

```text
sha256:AAA
```

Tomorrow:

```text
sha256:BBB
```

So:

```text
production
latest
v1
```

may be mutable references. A digest identifies exact image content:

```text
my-image@sha256:ABC...
```

Conceptually:

```text
tag
  ↓
mutable pointer
  ↓
immutable image digest
```

Tags are convenient for humans. Digests are much stronger for answering:

**Exactly what ran in production?**

## Where Should a Large Model Artifact Live?
<!-- section-summary: A model can be baked into the image, downloaded at startup, or mounted separately; each choice changes size, startup, availability, integrity, and coupling. -->

The largest and most frequently changed component is often the model itself, which forces an explicit placement and startup choice.

This is one of the biggest architectural choices. Three common options are:

```text
A. model inside image
B. model downloaded at startup
C. model mounted/provided separately
```

None is universally correct.

Conceptually:

```text
Image
├── Python
├── dependencies
├── app
└── model weights
```

Then startup is simple:

```text
container starts
   ↓
model already exists locally
   ↓
load
   ↓
serve
```

Advantages:

```text
very reproducible
no model download during startup
image + model move together
easy rollback as one artifact
```

If image digest is:

```text
sha256:ABC
```

you know both serving code and model bytes represented by that image. Suppose:

```text
runtime environment = 4 GB
model = 80 GB
```

The image becomes enormous. That affects:

```text
registry storage
push/pull time
node startup
deployment speed
build caching
network usage
```

Change one model and you may need another massive image. So for large models, coupling model weights to the container image may be operationally painful. Another design:

```text
Image
├── runtime
├── dependencies
└── app

container startup
      ↓
download model artifact
      ↓
verify it
      ↓
load it
      ↓
ready
```

Now one serving image can execute multiple model releases.

For example:

```text
image digest = APP123
model digest = MODEL456
```

The release identity becomes:

$$
Release = (Image,\ Model)
$$

Advantages:

```text
smaller serving images
models and code can version independently
large models need not be rebuilt into images
```

But startup becomes more complicated. If startup says:

```text
download "latest"
```

you have sacrificed reproducibility. Two replicas starting five minutes apart might receive different models.

Instead:

```text
MODEL_ID = immutable-model-digest
```

Then:

```text
container
    ↓
retrieve exact artifact
    ↓
verify checksum/signature
    ↓
load
```

Startup can fail if:

```text
registry unavailable
network unavailable
artifact missing
digest mismatch
download too slow
```

Those failures need to be deliberately handled. You may have:

```text
Container filesystem
       │
       └── /models/model
                ↑
        volume / host storage
```

This can work well when nodes already cache very large model files. But it creates another deployment contract:

```text
image version
+
mounted model version
```

You must ensure the mount can't silently contain the wrong model. So the application should still verify identity:

```text
expected digest
       =
mounted artifact digest
```

before declaring itself ready. Weak design:

```text
/models/current/model.bin
```

and somebody overwrites that file in place. Now a running container may observe:

```text
old model
half-written model
new model
```

depending on timing. A stronger pattern is immutable artifacts:

```text
/models/model-A/
/models/model-B/
```

and an atomic selection of which complete release to load. The model should change by selecting another artifact, not by mutating an artifact in place.

![Build inputs become an immutable OCI image during CI, then a container verifies and warms the model before it becomes ready for traffic.](/content-assets/articles/article-mlops-model-serving-docker-images-for-model-serving/build-to-ready-service.png)

*CI fixes the runtime before deployment; startup uses that tested image to load the approved model and prove readiness without installing new packages.*

## How Do Process Ownership and Health Checks Control Container Readiness?
<!-- section-summary: One primary process owns model resources, while startup, readiness, and liveness probes answer separate lifecycle questions cheaply and accurately. -->

After the files arrive, the container needs a clear resource-owning process and health signals that reflect actual inference readiness.

Suppose the container runs:

```text
FastAPI
background model downloader
cron
SSH daemon
monitoring daemon
database
```

Now lifecycle management becomes confusing. Which process determines whether the container is healthy? Which one receives termination signals? Which one causes the container to exit? A simpler container is often:

```text
Container
    ↓
one serving responsibility
    ↓
one primary process
```

For example:

```text
Uvicorn/FastAPI
    ↓
model
```

or:

```text
specialized inference server
    ↓
model
```

This is not an absolute law, but simplicity helps orchestration enormously. Inside a container, one process becomes PID 1. This process has special responsibilities around:

```text
signals
process reaping
shutdown
```

Suppose the orchestrator sends:

```text
SIGTERM
```

when replacing the container. Your serving process should respond by:

```text
stop accepting new traffic
finish/drain active work
release resources
exit
```

If your startup shell accidentally swallows the signal, graceful shutdown can fail. So something apparently minor like:

```text
what is the container entrypoint
```

can affect whether model requests are dropped during deployments. A common web deployment instinct is:

```text
more workers = more throughput
```

Suppose:

```text
model = 12 GB GPU memory
GPU = 24 GB
```

Now configure:

```text
4 web workers
```

If every worker loads its own model:

```text
worker 1 → 12 GB
worker 2 → 12 GB
worker 3 → 12 GB
worker 4 → 12 GB
```

you conceptually require:

```text
48 GB
```

of model memory before accounting for inference workspace. That doesn't fit. The Docker container did not solve this problem. You could have:

```text
1 container
    ↓
4 worker processes
```

or:

```text
4 containers
    ↓
1 worker each
```

These are not equivalent operationally. For GPU serving, a simple mapping might be:

```text
GPU 1 ← one model-serving process
GPU 2 ← one model-serving process
GPU 3 ← one model-serving process
```

Then scale through replicas rather than blindly adding web workers inside one container. For CPU inference, multiple worker processes may make much more sense. Again ask:

**What expensive state will every process duplicate?**

Don't confuse:

```text
one process
```

with:

```text
one request at a time
```

One process can manage:

```text
many network connections
async operations
a scheduler
dynamic batching
streaming responses
```

while keeping only one copy of the model. For sophisticated GPU inference:

```text
many clients
     ↓
one inference scheduler
     ↓
one shared model
     ↓
GPU
```

can be far more efficient than:

```text
many independent processes
     ↓
many model copies
     ↓
same GPU
```

Containers make this distinction particularly important. Imagine:

```text
container process starts
        ↓
download model        40 sec
        ↓
load model            30 sec
        ↓
initialize GPU        10 sec
        ↓
warmup                 5 sec
```

The container exists for 85 seconds before it can actually serve. Therefore:

```text
container running
```

does not mean:

```text
model ready
```

A startup check is useful when initialization can legitimately take a long time.

Conceptually:

```text
download complete
artifact verified
weights loaded
GPU initialized
warmup complete
```

Until then:

```text
STARTING
```

not:

```text
BROKEN
```

This prevents an orchestrator from repeatedly killing a healthy but slow-starting model service. Once:

```text
model loaded
reference test passed
runtime warm
required dependencies available
```

then:

```text
ready = true
```

The load balancer may route predictions there. During shutdown:

```text
ready = false
```

first. Then traffic stops arriving while existing requests drain. So readiness controls **traffic eligibility**. Suppose an external database is briefly unavailable. Should you kill and restart a perfectly healthy 80 GB model process? Probably not. Otherwise:

```text
dependency fails
     ↓
liveness fails
     ↓
model container restarts
     ↓
downloads/loads 80 GB model
     ↓
dependency still unavailable
     ↓
restart again
```

You've converted a dependency incident into a GPU restart storm. A useful distinction is:

```text
readiness failure
→ don't send traffic

liveness failure
→ process is irrecoverably unhealthy; restart
```

Suppose `/live` performs a full 70-billion-parameter inference. The orchestrator might call it repeatedly. Now your health system competes with customer traffic. That's bad. Health checks should usually verify the minimum necessary property.

For example:

```text
/live
→ event loop/process alive

/ready
→ model loaded + serving state valid
```

A deeper prediction test can happen during startup or as lower-frequency monitoring.

## Which Security, Resource, Kernel, Architecture, and GPU Boundaries Remain?
<!-- section-summary: Non-root execution, read-only artifacts, external secrets, network limits, resource headroom, host kernels, CPU architecture, and GPU allocation remain explicit boundaries. -->

Process isolation does not erase privileges, host architecture, kernels, memory headroom, or GPU ownership, so those boundaries need deliberate controls.

Suppose a model server runs as:

```text
root
```

with:

```text
host filesystem mounted
privileged mode
all Linux capabilities
write access everywhere
```

A compromise of the service now has enormous power. Containers provide isolation mechanisms, but you must actually use them. A production-serving container should generally receive only the privileges it needs. Most model servers don't need root privileges after startup.

Conceptually:

```text
root
  ↓
can modify much of container/system namespace

unprivileged serving user
  ↓
much narrower authority
```

So build files may install packages as root during image construction but configure runtime as a dedicated non-root user. This follows least privilege:

**Give the serving process only the authority required to make predictions.**

The serving process generally needs to:

```text
read model
```

not:

```text
rewrite model weights
```

So immutable or read-only model storage reduces accidental modification. Likewise, if most of the container filesystem can be read-only, that's useful. Writable locations can be limited to things actually needed:

```text
temporary directory
cache directory
explicit output volume
```

Imagine:

```dockerfile
ENV CLOUD_API_KEY=secret123
```

Now the secret may become part of:

```text
image metadata
layers
registry copies
build cache
```

Images are copied widely. Credentials should normally be supplied at runtime by the deployment platform's secret mechanism. Think:

```text
Image:
    code

Runtime:
    identity + secrets
```

not:

```text
Image:
    code + permanent credentials
```

Does an inference container genuinely need arbitrary outbound internet access? Maybe it needs:

```text
model storage
telemetry
one internal service
```

Then unrestricted outbound connectivity may be unnecessary. Security is easier to reason about when dependencies are explicit:

```text
who can call model service
what can model service call
what storage can it access
```

Again, reduce capabilities rather than assuming the container boundary is sufficient. A container can often be assigned limits for:

```text
CPU
RAM
GPU devices
process count
temporary storage
```

Why does this matter? Suppose one model service leaks memory. Without a meaningful boundary:

```text
container
   ↓
consumes host RAM
   ↓
other services fail
```

With resource controls, failure can be more contained. But limits must match real model behavior. Suppose:

```text
model weights = 8 GB
```

Do not conclude:

```text
container memory limit = 8 GB
```

Serving also needs memory for:

```text
Python runtime
tokenizer
input tensors
output tensors
batch buffers
allocator overhead
caches
temporary workspace
request queues
```

Peak memory is more relevant than static model size.

Conceptually:

$$
Memory_{peak}
=
weights
+
runtime
+
inputs
+
working\ buffers
+
cache
+
overhead
$$

A container killed by the host's out-of-memory mechanism may look like a mysterious application crash unless you monitor it correctly. This point is crucial. A Docker image might contain:

```text
CUDA userspace libraries
PyTorch with CUDA support
your model server
```

But it does not contain an actual GPU. At runtime you still need:

```text
physical GPU
compatible host driver
container/runtime GPU integration
device access
sufficient VRAM
```

The relationship is more like:

```text
Container
├── PyTorch
├── CUDA runtime libraries
└── application
         │
         ▼
host NVIDIA driver
         │
         ▼
physical GPU
```

The container packages part of the stack. The host supplies the hardware and important kernel-level components. A container is not a complete separate operating system.

Conceptually:

```text
Container A userspace ─┐
Container B userspace ─┼→ host Linux kernel → hardware
Container C userspace ─┘
```

This means the image does not bundle:

```text
its own Linux kernel
physical CPU
physical GPU
host GPU driver
arbitrary kernel features
```

This is why an image cannot magically make incompatible hardware compatible. An image built for:

```text
x86-64
```

does not automatically run natively on:

```text
ARM64
```

unless a compatible image variant or emulation exists. Likewise, model code may depend on CPU instruction sets:

```text
AVX
AVX2
AVX-512
```

or GPU architecture capabilities. So:

```text
image is portable
```

really means:

**portable across hosts satisfying the image's runtime assumptions.**

Not:

"runs on any computer."

## How Do Provenance, SBOMs, Multi-Stage Builds, and Promotion Protect the Image?
<!-- section-summary: Build provenance, an SBOM, focused multi-stage images, external environment configuration, and build-once promotion preserve inspectable identity. -->

The resulting image is a supply-chain artifact whose exact inputs and contents should remain inspectable as it moves through environments.

Imagine a production incident. You identify image:

```text
sha256:ABC
```

Now someone asks:

What source code produced it

You should ideally be able to trace:

```text
image digest
    ↓
CI build
    ↓
source commit
    ↓
Dockerfile
    ↓
dependency lockfiles
    ↓
base image
    ↓
model artifact
```

This is build provenance. Without it, an immutable image tells you **what bytes ran**, but not necessarily **where those bytes came from**. A serving image may contain hundreds of components:

```text
Python
OpenSSL
glibc
PyTorch
NumPy
FastAPI
tokenizer libraries
system libraries
```

When a security issue appears in dependency X, you want to answer:

```text
Which production images contain X
```

A software bill of materials, or SBOM, provides an inventory of included software components.

Conceptually:

```text
Image ABC
├── package A version ...
├── package B version ...
├── package C version ...
└── ...
```

It's especially valuable when operating many model-serving images. Suppose your production image contains:

```text
compiler
git
curl
debuggers
Jupyter
training datasets
build tools
test dependencies
serving application
```

Most of that isn't needed to predict. Every unnecessary component creates some combination of:

```text
larger downloads
more vulnerabilities
more update work
more attack surface
more accidental dependencies
```

A production-serving image should generally contain what it needs to **run**, not everything needed to **develop and build** it. Imagine a Python/native dependency needs a compiler. You need:

```text
gcc
headers
build tools
```

to build it. But not to execute the resulting application. A multi-stage build conceptually does:

```text
BUILD STAGE
├── compilers
├── headers
├── source
└── build result
        │
        ▼ copy only what is needed
RUNTIME STAGE
├── runtime libraries
├── application
└── built artifacts
```

The final production image doesn't need the entire build environment. This creates a useful separation:

```text
what is necessary to construct software
≠
what is necessary to execute software
```

You could obsessively remove everything until debugging and compatibility become painful. The real objective is:

```text
minimal necessary runtime
+
understandable dependencies
+
operational reliability
```

A slightly larger base image that your organization patches and understands may be better than an exotic tiny image that breaks required ML libraries. Optimize for:

```text
correctness
security
reproducibility
operability
```

before image-size vanity metrics. A dangerous deployment approach is:

```text
build image for dev
build another image for staging
build another image for prod
```

Even from the same source, these builds might differ. A stronger pattern is:

```text
build once
     ↓
image digest ABC
     ↓
test ABC
     ↓
stage ABC
     ↓
promote ABC
     ↓
production ABC
```

Now the artifact you tested is the artifact you run. Configuration that genuinely differs between environments can usually enter at runtime. Suppose staging calls:

```text
database-staging
```

and production calls:

```text
database-production
```

You usually don't want two differently built images just for that.

Instead:

```text
same image
    +
runtime configuration
```

For example:

```text
MODEL_ID
LOG_LEVEL
DOWNSTREAM_ENDPOINT
MAX_BATCH_SIZE
```

But critical configuration should still be observable and auditable, because:

```text
same image
+
different configuration
=
different behavior
```

So a serving release may ultimately be identified by more than the image alone.

![Model-in-image and external-model delivery compared by release identity, startup behavior, and required controls.](/content-assets/articles/article-mlops-model-serving-docker-images-for-model-serving/model-delivery-strategies.png)

*Baking the model into the image creates one artifact identity, while external delivery keeps promotion independent and therefore requires a verified model digest in the release record.*

## How Do Smoke Tests, Rollout, Rollback, State, Caches, and Quotas Affect Operation?
<!-- section-summary: Tests must follow the real request and recovery paths, and releases need exact image-model pairs, disposable local state, cache design, and CPU/GPU resource awareness. -->

Testing and rollout must use that built artifact and exercise request, failure, cache, state, quota, and rollback behaviour rather than source code alone.

Suppose unit tests pass in CI. Then the Dockerfile accidentally forgets:

```text
tokenizer.json
```

Source tests are green. Production fails. The artifact you deploy is the **image**, so test the image. A build pipeline might do:

```text
build image
    ↓
start container
    ↓
wait for readiness
    ↓
send known prediction
    ↓
check response
    ↓
stop container
```

This tests the assembled artifact. Instead of:

```text
import model
print("okay")
```

prefer something closer to:

```text
HTTP request
    ↓
real route
    ↓
real validation
    ↓
real preprocessing
    ↓
loaded model
    ↓
real postprocessing
    ↓
response
```

For example:

```text
known input
   ↓
/predict
   ↓
expected class / output tolerance
```

This catches integration mistakes that unit tests around individual components miss. A production image should not only handle the happy path. Useful smoke/integration tests might cover:

```text
invalid request → correct 4xx
missing model → startup fails
incorrect model digest → startup fails
health endpoint behaves correctly
SIGTERM → graceful shutdown
GPU unavailable → understandable failure
```

A system is defined partly by how it fails. Suppose your serving setup keeps models outside the image.

Then:

```text
image = sha256:AAA
model = sha256:BBB
```

is the real release. You should be able to answer:

```text
Production replica 17:

image_digest = AAA
model_digest = BBB
config_version = CCC
```

If the model is embedded inside the image, the model identity may effectively be covered by the image digest, though explicit model metadata is still useful. Imagine deployment v22 changes:

```text
container image
model
tokenizer
generation settings
```

Then something fails. Rolling back only the model can create:

```text
old model
new tokenizer
new serving code
new generation config
```

which may never have been tested. Instead think:

```text
Release 21:
  image A
  model B
  config C

Release 22:
  image D
  model E
  config F
```

Rollback means:

```text
Release 22
    ↓
Release 21
```

not:

```text
randomly replace one component
```

Suppose you have 100 serving replicas. Instead of:

```text
100 old
   ↓
100 new
```

you could move:

```text
99 old + 1 new
     ↓
95 old + 5 new
     ↓
50 old + 50 new
     ↓
100 new
```

while checking:

```text
startup failures
prediction errors
latency
OOM events
GPU memory
CPU usage
model quality signals
```

If something goes wrong at 1%, rollback is much cheaper. Container immutability makes this pattern easier because old and new replicas can coexist cleanly. Suppose production has a problem and someone does:

```text
docker exec ...
pip install new-package
edit file
restart process
```

Now the running container no longer corresponds cleanly to its image. You have created an untracked snowflake. The better pattern is:

```text
source change
    ↓
new image
    ↓
new digest
    ↓
test
    ↓
deploy
```

Treat running containers as disposable instances of immutable releases. Suppose your model service writes important permanent data only into:

```text
/container/data
```

Then the container is replaced. That filesystem may disappear. Container-local storage is generally best treated as ephemeral unless explicitly backed by persistent storage. For a serving process, this usually means:

```text
logs → external logging system
metrics → monitoring system
model artifacts → registry/object storage
persistent user data → external database/storage
```

The container itself should be replaceable. Model serving often wants caches:

```text
model download cache
tokenizer cache
compiled kernel cache
JIT cache
```

These can dramatically improve startup. But ask:

```text
Is this cache required for correctness
```

Ideally:

```text
No.
```

A fresh machine with an empty cache should still work, perhaps more slowly. That lets you treat caches as optimizations rather than hidden state. These are separate resources. You might have:

```text
container RAM limit = 16 GB
GPU VRAM = 24 GB
```

or vice versa. A model can fail because:

```text
host RAM exhausted
```

even with free GPU memory. Or because:

```text
GPU VRAM exhausted
```

while container RAM looks healthy. Monitoring must reflect both. Suppose your GPU does inference quickly, but CPU preprocessing performs:

```text
tokenization
image decoding
JSON handling
```

The container is allowed only a tiny amount of CPU. Now:

```text
GPU utilization = low
latency = high
```

because requests cannot reach the GPU fast enough. Serving capacity is determined by the slowest constrained stage:

```text
network
↓
CPU preprocessing
↓
queue
↓
GPU
↓
CPU postprocessing
```

Resource limits should follow measurement rather than guesswork.

## How Do Supply-Chain Identity, Startup, and Lifecycle State Support Debugging?
<!-- section-summary: Supply-chain records and the image digest connect incidents to exact contents, while a robust startup state machine validates the host, model, warmup, and readiness. -->

These records make the digest a debugging coordinate and support a startup lifecycle that fails before accepting traffic.

A production image doesn't appear from nowhere. It may depend on:

```text
base image
system repositories
Python package registry
source repository
model registry
CI runners
build scripts
container registry
```

So the trust chain is approximately:

```text
trusted source
    ↓
trusted dependencies
    ↓
trusted build
    ↓
image digest
    ↓
trusted registry
    ↓
verified deployment
```

If an attacker can alter a dependency or replace an image before production, Docker's isolation doesn't solve the problem. Therefore artifact signing, provenance, registry permissions, vulnerability scanning, and SBOMs fit naturally into container security. Imagine an incident:

```text
10% of replicas fail
90% work
```

You inspect:

```text
working:
image digest ABC

failing:
image digest XYZ
```

You've immediately narrowed the investigation. Or:

```text
same image
different model digest
```

points elsewhere. Or:

```text
same image
same model
different GPU type
```

suggests host compatibility. Immutable identities turn vague debugging into concrete comparisons. Suppose all containers use identical image bytes. But one node has:

```text
GPU driver X
```

another:

```text
GPU driver Y
```

and another:

```text
different GPU architecture
```

Behavior can differ. Therefore:

```text
container image identity
```

is necessary for reproducibility but not always sufficient. For GPU serving, you may also care about:

```text
host driver
GPU model
GPU firmware/runtime characteristics
kernel
container runtime
orchestrator configuration
```

This is why infrastructure metadata belongs in observability. For a simple system:

```text
Release
   =
Docker image
```

might be enough because the model is inside it. For a larger system:

$$
Release =
(Image,\ Model,\ Config,\ Infrastructure\ assumptions)
$$

For example:

```text
image_digest  = sha256:AAA
model_digest  = sha256:BBB
config        = version-17
GPU class     = H100
```

The exact representation varies. The principle is:

**Record every independently changing component that can materially alter serving behavior.**

Without tying this to one specific framework, the structure often resembles:

```dockerfile
# Build stage
FROM <pinned-build-base> AS builder

WORKDIR /build

COPY requirements.lock .
RUN install_dependencies

COPY src/ .
RUN build_application


# Runtime stage
FROM <pinned-runtime-base>

RUN create_non_root_user

WORKDIR /app

COPY --from=builder /built/runtime /runtime
COPY --from=builder /build/app /app

USER modelserver

CMD ["server-command"]
```

Potentially:

```text
model included here
```

or:

```text
model supplied by immutable ID at startup
```

Important characteristics:

```text
pinned base
pinned dependencies
separate build/runtime concerns
non-root runtime
minimal unnecessary tooling
clear startup command
```

The exact syntax matters less than the invariants. Container startup might conceptually perform:

```text
process starts
      ↓
read runtime configuration
      ↓
resolve exact model identity
      ↓
obtain model if necessary
      ↓
verify model digest/provenance
      ↓
check hardware compatibility
      ↓
load model
      ↓
run reference prediction
      ↓
warm up runtime
      ↓
READY = true
```

If any critical step fails:

```text
READY must remain false
```

and often the process should exit clearly rather than pretending to serve. A useful mental model is:

```text
          image pulled
               │
               ▼
           STARTING
               │
      load + verify + warm
               │
               ▼
             READY
               │
               ▼
            SERVING
               │
       deployment/termination
               │
               ▼
           DRAINING
               │
               ▼
            STOPPED
```

Health checks and orchestration become much easier once you think in states instead of merely:

```text
container running / container not running
```

## What Does Docker Solve, and What Must the Serving Platform Still Solve?
<!-- section-summary: Docker standardizes packaging and process isolation, while scheduling, hardware, secrets, scaling, traffic, compatibility, and release control remain platform responsibilities. -->

The final boundary clarifies which operational problems Docker reduces and which the surrounding serving platform still owns.

Docker gives you an excellent packaging boundary. It does **not** automatically solve:

```text
model correctness
request validation
GPU scheduling
dynamic batching
autoscaling
authentication
rate limiting
model provenance
safe deserialization
monitoring
secret management
high availability
rollback policy
```

And it doesn't eliminate the need to understand:

```text
CPU
RAM
GPU
network
host kernel
drivers
storage
```

A Docker image makes environment management more disciplined. It does not turn infrastructure into magic. A production path might look like:

```text
                        SOURCE
                           │
                           ▼
                 ┌─────────────────┐
                 │ Reproducible    │
                 │ image build     │
                 │                 │
                 │ pinned base     │
                 │ dependencies    │
                 │ app code        │
                 └────────┬────────┘
                          │
                          ▼
                 immutable image
                    digest AAA
                          │
                    smoke tests
                          │
                          ▼
                    registry
                          │
                          ▼
                  deployment selects
                          │
               ┌──────────┴──────────┐
               │                     │
               ▼                     ▼
        image digest AAA      model digest BBB
               │                     │
               └──────────┬──────────┘
                          ▼
                     CONTAINER
                          │
                       startup
                          │
                  verify / load model
                          │
                       warmup
                          │
                       READY
                          │
                          ▼
                    model traffic
                          │
                          ▼
                  CPU / RAM / GPU
                          │
                          ▼
                        HOST
                kernel + drivers +
                    hardware
```

The image defines much of the userspace. The model defines the prediction behavior. The deployment configuration joins them. The host supplies the physical execution environment. When designing a serving image, reason through these questions:

```text
What should be fixed at build time
              ↓
What must be provided at runtime
              ↓
Is every important dependency pinned
              ↓
Where do the model weights live
              ↓
How is the exact model identified
              ↓
How many processes load that model
              ↓
What CPU/GPU/RAM does each process consume
              ↓
When is the container actually ready
              ↓
What privileges does it really need
              ↓
Can we trace the image back to its build
              ↓
Have we tested the actual built image
              ↓
Can we deploy and roll back the exact release
              ↓
What assumptions still depend on the host
```

Those questions are much more important than memorizing individual Dockerfile commands. A weak mental model is:

```text
Docker
=
put my Python app in a box
```

A stronger model is:

```text
training/model artifacts
          │
          ▼
    serving software
          │
          ▼
  reproducible image build
          │
          ▼
 immutable image identity
          │
          +
 immutable model identity
          │
          ▼
   container startup
          │
    verify + load + warm
          │
          ▼
        READY
          │
          ▼
      prediction
          │
          ▼
host kernel + CPU/GPU + drivers
```

The central principle is:

> **A Docker image is an immutable description of the userspace environment in which your model-serving process should run.**

Its job is to remove accidental variation from deployments:

```text
same serving code
same dependencies
same system libraries
same startup contract
```

But safe model serving requires a larger invariant:

**Given an exact image, an exact model, an exact configuration, and a compatible host, every replica should start in a known way, prove that it can serve correctly, receive only the permissions and resources it needs, and be replaceable by another identical replica.**

Once you think in those terms, image layers, pinned dependencies, multi-stage builds, model placement, process count, health checks, resource limits, provenance, smoke tests, digests, and rollback all become parts of one goal:

```text
turn deployment from
"reconstruct a machine correctly"

into

"run this exact, tested serving release
on a compatible host"
```

![Five-stage production model image path from locked inputs through build evidence, constrained runtime, canary release, and complete rollback.](/content-assets/articles/article-mlops-model-serving-docker-images-for-model-serving/production-image-release-path.png)

*A reliable serving image is the result of one connected release path: lock the inputs, build once, prove the artifact, run it under explicit controls, and promote or restore the same immutable identity.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Does a Reproducible Model-Serving Image Contain?]{kind="recap"}
A serving image packages code, dependencies, system libraries, entrypoint, and deterministic preparation as layered immutable build output identified by a digest.
:::

:::expand[Where Should a Large Model Artifact Live?]{kind="recap"}
A model can be baked into the image, downloaded at startup, or mounted separately; each choice changes size, startup, availability, integrity, and coupling.
:::

:::expand[How Do Process Ownership and Health Checks Control Container Readiness?]{kind="recap"}
One primary process owns model resources, while startup, readiness, and liveness probes answer separate lifecycle questions cheaply and accurately.
:::

:::expand[Which Security, Resource, Kernel, Architecture, and GPU Boundaries Remain?]{kind="recap"}
Non-root execution, read-only artifacts, external secrets, network limits, resource headroom, host kernels, CPU architecture, and GPU allocation remain explicit boundaries.
:::

:::expand[How Do Provenance, SBOMs, Multi-Stage Builds, and Promotion Protect the Image?]{kind="recap"}
Build provenance, an SBOM, focused multi-stage images, external environment configuration, and build-once promotion preserve inspectable identity.
:::

:::expand[How Do Smoke Tests, Rollout, Rollback, State, Caches, and Quotas Affect Operation?]{kind="recap"}
Tests must follow the real request and recovery paths, and releases need exact image-model pairs, disposable local state, cache design, and CPU/GPU resource awareness.
:::

:::expand[How Do Supply-Chain Identity, Startup, and Lifecycle State Support Debugging?]{kind="recap"}
Supply-chain records and the image digest connect incidents to exact contents, while a robust startup state machine validates the host, model, warmup, and readiness.
:::

:::expand[What Does Docker Solve, and What Must the Serving Platform Still Solve?]{kind="recap"}
Docker standardizes packaging and process isolation, while scheduling, hardware, secrets, scaling, traffic, compatibility, and release control remain platform responsibilities.
:::
