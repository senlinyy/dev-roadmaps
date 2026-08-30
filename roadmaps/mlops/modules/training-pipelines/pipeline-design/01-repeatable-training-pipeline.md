---
title: "Training Pipelines"
description: "Design repeatable training workflows with immutable run identity, explicit stage contracts, reliable retries, safe caching, lineage, and partial replay."
overview: "A production training pipeline is a versioned graph of stage contracts. Immutable run inputs, durable artifacts, explicit state, and controlled replay let teams recover failures without changing the evidence behind a model candidate."
tags: ["MLOps", "production", "orchestration"]
order: 1
id: "article-mlops-training-pipelines-repeatable-training-pipeline"
---

## Table of Contents

1. [What Problem Does a Repeatable Training Pipeline Solve?](#what-problem-does-a-repeatable-training-pipeline-solve)
2. [What Must One Pipeline Run Record Before Expensive Work Begins?](#what-must-one-pipeline-run-record-before-expensive-work-begins)
3. [How Do Retries, Reruns, Reuse, and Duplicate Requests Differ?](#how-do-retries-reruns-reuse-and-duplicate-requests-differ)
4. [How Can a Pipeline Reproduce a Historical Training Run?](#how-can-a-pipeline-reproduce-a-historical-training-run)
5. [How Do Program Boundaries Keep Pipeline Logic Portable and Testable?](#how-do-program-boundaries-keep-pipeline-logic-portable-and-testable)
6. [How Does a Pipeline Record a Provenance Graph?](#how-does-a-pipeline-record-a-provenance-graph)
7. [How Does the Pipeline Recover and Reuse Work Without Changing Its Meaning?](#how-does-the-pipeline-recover-and-reuse-work-without-changing-its-meaning)
8. [How Do Scripts, Configuration, Artifacts, and Orchestration Fit Together?](#how-do-scripts-configuration-artifacts-and-orchestration-fit-together)
9. [Check Your Answers](#check-your-answers)

An engineer builds a dataset, copies its path into a training command, waits four hours, and then starts evaluation by hand. Evaluation loses its machine after three minutes. Without a pipeline record, the engineer may rebuild the dataset and retrain the model even though both outputs already exist and are valid.

A **training pipeline** turns the complete workflow into connected computations with explicit inputs and durable outputs. Each stage states what it consumes, what it produces, and what proves success. The arrows carry identified datasets, models, and reports rather than values remembered by the person running commands.

Repeatability means more than putting steps in order. The system must know whether an interrupted stage can retry, whether an earlier result can be reused, whether a repeated request is a new experiment, and which historical inputs define a replay. Those decisions require identities, manifests, versioned data, and clear boundaries between orchestration and model code.

Follow these questions to see how separate commands turn into one recoverable workflow with durable handoffs and a history that can be replayed:

1. **What Problem Does a Repeatable Training Pipeline Solve?**
2. **What Must One Pipeline Run Record Before Expensive Work Begins?**
3. **How Do Retries, Reruns, Reuse, and Duplicate Requests Differ?**
4. **How Can a Pipeline Reproduce a Historical Training Run?**
5. **How Do Program Boundaries Keep Pipeline Logic Portable and Testable?**
6. **How Does a Pipeline Record a Provenance Graph?**
7. **How Does the Pipeline Recover and Reuse Work Without Changing Its Meaning?**
8. **How Do Scripts, Configuration, Artifacts, and Orchestration Fit Together?**

## What Problem Does a Repeatable Training Pipeline Solve?
<!-- section-summary: A repeatable pipeline coordinates explicit computations and durable handoffs so a complete training request can be inspected, retried, and reproduced. -->

A training command solves one computation. A production workflow also has to find and validate data, train, evaluate, package, and decide what happens next when any stage fails.

Start with the most basic problem. You already have a training program:

```text
data + config + code
        ↓
     train.py
        ↓
model + metrics
```

You can run:

```bash
python -m project.train ...
```

That solves **one computation**. But a real training workflow usually requires more:

```text
find the correct data
↓
validate it
↓
build the training dataset
↓
train
↓
evaluate
↓
package outputs
↓
decide whether the model is acceptable
↓
register it
```

And now failures become possible at every boundary. The purpose of a training pipeline is to turn that whole process into a **repeatable computation with explicit dependencies and durable intermediate results**. Imagine training manually:

```text
1. Run dataset-building notebook.
2. Copy path from its output.
3. Paste path into training command.
4. Wait three hours.
5. Run evaluation script.
6. Inspect metric.
7. Upload model.
```

A human is secretly acting as the orchestrator. The human remembers:

```text
what ran already
which data was used
which file came from which command
what should run next
what failed
what needs rerunning
```

A pipeline makes that state explicit. Instead of:

```text
human memory
    +
shell history
    +
files
```

you get:

```text
pipeline definition
       +
run metadata
       +
durable artifacts
```

The pipeline's fundamental job is:

**Given an intended training request, coordinate all required computations so the final result can be reproduced, inspected, retried, and trusted.**

Suppose you have three computations. Dataset construction:

$$
D = f(R, C_d)
$$

where:

```text
R   = raw data
C_d = dataset configuration
D   = prepared dataset
```

Training:

$$
M = g(D, C_t)
$$

where:

```text
D   = prepared dataset
C_t = training configuration
M   = trained model
```

Evaluation:

$$
E = h(M, V)
$$

where:

```text
M = trained model
V = evaluation dataset
E = evaluation result
```

The complete workflow is therefore:

$$
E = h(g(f(R,C_d), C_t),V)
$$

A pipeline simply makes that composition operational:

```text
Raw Data
   │
   ▼
┌───────────────┐
│ Build Dataset │
└───────────────┘
   │
   ▼
Training Dataset
   │
   ▼
┌───────────────┐
│ Train Model   │
└───────────────┘
   │
   ▼
Candidate Model
   │
   ▼
┌───────────────┐
│ Evaluate      │
└───────────────┘
   │
   ▼
Evaluation Result
```

Each box is a computation. Each arrow carries an explicit result. That is the foundation of a pipeline. You could write:

```python
prepare_data()
train()
evaluate()
```

and technically have a sequence. But that alone doesn't give you a robust pipeline. Suppose training fails after four hours. Do you rerun data preparation Maybe not. Suppose evaluation fails because its machine loses power. Should you retrain the model? Definitely not. Suppose the entire workflow is submitted twice. Should you produce two conflicting models? Maybe not. So the deeper requirement is:

**Each stage should have explicit inputs, explicit outputs, and enough identity that the system knows what can safely be reused or rerun.**

That's where pipeline engineering begins. Consider:

```text
Build Dataset
```

A weak definition is:

"Run `prepare_data.py`."

A stronger definition is:

```text
INPUTS
    raw dataset version
    feature configuration
    code version

OUTPUTS
    immutable training dataset
    dataset manifest
    statistics

SUCCESS
    all required outputs durably published
```

Now training:

```text
INPUTS
    training dataset ID
    resolved training config
    code/container version

OUTPUTS
    model bundle
    metrics
    resolved configuration
    lineage
```

And evaluation:

```text
INPUTS
    candidate model ID
    evaluation dataset ID
    evaluation config

OUTPUTS
    evaluation report
    summary metrics
    pass/fail recommendation
```

This produces a composable system:

```text
Step A
explicit output
    │
    ▼
explicit input
Step B
```

A step should ideally not depend on:

```text
whatever happens to be in /tmp
the previous process's memory
the developer's working directory
some mutable "latest" folder
an undocumented environment variable
```

Those are hidden edges in your pipeline graph. People often focus on pipeline steps:

```text
prepare
train
evaluate
register
```

But reliable systems depend heavily on the **artifacts crossing between them**.

For example:

```text
              dataset-v42
                   │
                   ▼
              ┌─────────┐
              │  Train  │
              └─────────┘
                   │
               model-v17
                   │
                   ▼
             ┌──────────┐
             │ Evaluate │
             └──────────┘
                   │
            evaluation-v17
```

Notice that evaluation doesn't receive:

```text
"whatever model train just produced"
```

It receives:

```text
model-v17
```

an identifiable artifact. That small distinction is crucial for reproducibility.

## What Must One Pipeline Run Record Before Expensive Work Begins?
<!-- section-summary: A run records immutable data, code, resolved configuration, environment, randomness, identities, contracts, and cheap validation before allocating costly compute. -->

The graph is trustworthy only if one run can name every input and reject invalid requests before costly stages begin.

A training run should be identifiable by its actual inputs.

Conceptually:

$$
R =
(
C,
D,
T,
E,
S
)
$$

where:

```text
C = code version
D = dataset version
T = resolved training configuration
E = execution environment
S = randomness / seed information
```

So a run record might contain:

```text
training_run_id: train-8472

code_commit:
    8f37c21

container:
    sha256:74ad...

training_dataset:
    dataset-442

evaluation_dataset:
    dataset-443

resolved_config:
    artifact config-922

seed:
    42

produced_model:
    model-991
```

This lets you later answer:

Why are model A and model B different

You compare their recorded inputs. Without this information, pipelines automate execution but not understanding. Suppose your pipeline input is:

```text
s3://datasets/training/latest/
```

You run on Monday. Then new files arrive Tuesday. On Friday you rerun the Monday pipeline. Did you rerun the same computation? No. The path is the same, but the data isn't. A repeatable pipeline needs something closer to:

```text
dataset_id = transactions-2026-08-24-v3
```

or:

```text
manifest hash = sha256:...
```

Then:

```text
training request
      │
      ├── dataset-v42
      ├── config-v8
      └── code commit 91ab...
```

can be reconstructed later. A mutable path tells you where data lives. An immutable version tells you **which data participated in the computation**. Suppose the pipeline is:

```text
A → B → C
```

The scheduler's job is roughly:

```text
Can A run
↓ yes
launch A

Did A succeed
↓ yes
record outputs

Can B run
↓ yes
launch B

Did B fail
↓ yes
apply retry policy
```

The scheduler doesn't need to understand:

```text
cross entropy
backpropagation
tokenization
gradient clipping
attention
AUC
```

It understands:

```text
dependencies
states
resources
retries
inputs
outputs
```

This separation is extremely important. Think:

```text
ORCHESTRATOR
    "when and where"

TRAINING PROGRAM
    "how to train"
```

A pipeline step generally moves through states similar to:

```text
PENDING
   ↓
RUNNING
   ↓
SUCCEEDED
```

or:

```text
PENDING
   ↓
RUNNING
   ↓
FAILED
   ↓
RETRYING
```

The scheduler also understands dependencies. Given:

```text
A ──▶ B ──▶ D
      │
      └──▶ C
```

if `B` succeeds:

```text
C and D may become eligible
```

subject to their other dependencies. This structure is usually represented as a **directed acyclic graph**, or DAG.

```text
directed
    dependencies have direction

acyclic
    you cannot eventually depend on yourself
```

For example, this is invalid:

```text
Train
  ↓
Evaluate
  ↓
Train
```

because execution has no natural starting/ending ordering. A reasonably complete pipeline might look like:

```text
Input Dataset Version
          │
          ▼
┌──────────────────────┐
│ Validate Input Data  │
└──────────────────────┘
          │
          ▼
┌──────────────────────┐
│ Build Training Data  │
└──────────────────────┘
          │
          ▼
   dataset artifact
          │
          ▼
┌──────────────────────┐
│ Train Candidate      │
└──────────────────────┘
          │
          ▼
     model artifact
          │
          ▼
┌──────────────────────┐
│ Evaluate Candidate   │
└──────────────────────┘
          │
          ▼
   evaluation artifact
          │
          ▼
┌──────────────────────┐
│ Apply Quality Gate   │
└──────────────────────┘
       │          │
      fail       pass
                   │
                   ▼
          ┌────────────────┐
          │ Register Model │
          └────────────────┘
```

Not every project needs every step. The important architecture is the contracts between them. Suppose training costs £20 per hour. You don't want:

```text
allocate 8 GPUs
↓
download 4 TB
↓
initialize distributed cluster
↓
discover config is invalid
```

Instead:

```text
resolve configuration
↓
validate configuration
↓
validate referenced inputs
↓
validate dataset metadata
↓
only then request expensive compute
```

This principle applies at pipeline scale:

**Cheap checks should usually precede expensive irreversible work.**

For example:

```text
config validation     pennies / milliseconds
        ↓
data validation       relatively cheap
        ↓
training              expensive
        ↓
evaluation
```

![A pipeline stage moves immutable inputs through execution, temporary output, validation, and a committed manifest before a downstream task can consume it](/content-assets/articles/article-mlops-training-pipelines-repeatable-training-pipeline/pipeline-stage-output-commit.png)

*The downstream task receives only a committed manifest. Logs and attempt state describe execution, while the validation report records why publication was accepted.*

## How Do Retries, Reruns, Reuse, and Duplicate Requests Differ?
<!-- section-summary: Retries repeat a failed attempt, reruns create new workflow intent, reuse consumes an existing valid result, and duplicate requests require an explicit policy. -->

Once runs and artifacts have identities, the system can distinguish several operations that are often incorrectly grouped under the word rerun.

Suppose training job `train-8472` fails because the VM disappears. The scheduler executes the same logical step again. That's a **retry**:

```text
logical training step
       │
       ├── attempt 1 FAILED
       └── attempt 2 SUCCEEDED
```

Now suppose next week you intentionally execute the whole training workflow again. That's a **new pipeline run**:

```text
pipeline-run-100
pipeline-run-101
```

These should not be conflated. A useful identity structure is:

```text
pipeline_run_id
    │
    └── step_run_id
            │
            ├── attempt-1
            ├── attempt-2
            └── attempt-3
```

This lets you distinguish intention from infrastructure failure. Suppose:

```text
Build Dataset
```

has these inputs:

```text
raw-data-v42
feature-code commit abc123
feature-config-v7
```

You already built the corresponding dataset yesterday. Today another training request uses exactly the same inputs. You might reuse:

```text
dataset-artifact-v91
```

instead of recomputing it. That isn't a retry. It's **memoization/caching**.

Conceptually:

$$
f(x)=y
$$

If you already know:

$$
f(x)=y
$$

and `f` is deterministic enough for your purposes, you can reuse `y`. So distinguish:

```text
RETRY
same requested computation failed;
try executing it again

CACHE HIT / REUSE
same computation already succeeded;
reuse its previous output

NEW RUN
a newly requested workflow execution
```

These have different semantics. Imagine a user clicks "Train" twice. Two pipeline requests arrive:

```text
Request A:
dataset-v42 + config-v7

Request B:
dataset-v42 + config-v7
```

You now have a policy decision. Possible approaches:

```text
run both independently
```

or:

```text
detect identical logical request
and return the existing active run
```

or:

```text
allow duplicate training runs
but give each independent identities
```

There is no universal answer. But don't confuse duplicate-request handling with retries. A retry means:

```text
"the system didn't successfully execute my existing request"
```

A duplicate means:

```text
"I received another request that happens to look the same"
```

Those are operationally different. Suppose a step receives:

```text
input = dataset-v42
config = config-v7
run = 8472
```

and writes:

```text
models/latest/model.pt
```

That's dangerous. A retry can overwrite another run's model.

Instead:

```text
runs/8472/attempt-2/model/
```

creates a private output location. When successful:

```text
run 8472
   ↓
final_result → model-991
```

The general rule is:

> **A step should be safe to execute more than once without corrupting outputs or confusing downstream consumers.**

This is idempotency in the practical pipeline sense. Pure functions are easy:

$$
y=f(x)
$$

Run them twice and you simply get `y` twice. Real pipeline stages have side effects:

```text
write object storage
insert database rows
publish model versions
send notifications
update aliases
trigger deployment
```

Suppose a registration stage says:

```python
registry.create_model_version(...)
```

Then crashes before telling the orchestrator it succeeded. The scheduler retries. It calls:

```python
registry.create_model_version(...)
```

again. Now you might have two registrations for one result. A safer design gives the operation a deterministic identity:

```text
candidate model ID = model-991
```

and registration behaves like:

```text
if model-991 already registered:
    return existing registration
else:
    create registration
```

This principle applies to every externally visible side effect. Imagine:

```text
Prepare Data     ✓ 25 min
Train            ✓ 5 hours
Evaluate         ✗ 3 min
Register
```

A weak pipeline implementation reruns everything:

```text
Prepare Data
↓
Train
↓
Evaluate
```

That's wasteful. Because previous successful stages produced durable outputs:

```text
prepared-dataset-v42
model-v91
```

the system can resume:

```text
prepared-dataset-v42 ✓ reuse
model-v91            ✓ reuse
             ↓
         Evaluate
             ↓
         Register
```

This is one of the strongest reasons to make intermediate results durable artifacts. Without durable boundaries:

```text
pipeline failure
=
start over
```

With durable boundaries:

```text
pipeline failure
=
restart from nearest valid artifact
```

Training has checkpoints:

```text
training progress
↓
checkpoint
↓
failure
↓
resume
```

A pipeline has an analogous concept.

```text
Step A
 ↓
artifact A
 ↓
Step B
 ↓
artifact B
 ↓
Step C fails
```

Because `artifact A` and `artifact B` exist, the whole workflow can resume from `C`. So there are two levels of recovery:

```text
PIPELINE-LEVEL RECOVERY
reuse successful step artifacts

TRAINING-LEVEL RECOVERY
resume optimizer/model state from checkpoint
```

They solve different problems. Suppose:

```text
Train Candidate
```

fails at step 900,000. The pipeline scheduler knows:

```text
Train Candidate FAILED
```

but the training program may know:

```text
checkpoint step-880000 exists
```

The retry can therefore be:

```text
pipeline retry
      ↓
new training-job attempt
      ↓
find latest valid checkpoint
      ↓
resume from 880000
```

This is a nice example of responsibilities composing cleanly:

```text
ORCHESTRATOR:
retry the training step

TRAINER:
resume the computation efficiently
```

The orchestrator doesn't need to understand optimizer checkpoints.

## How Can a Pipeline Reproduce a Historical Training Run?
<!-- section-summary: Historical execution resolves an explicit logical time and immutable versions instead of silently reading current data, current time, or mutable latest aliases. -->

Those repetition rules depend on stable inputs. Historical work fails whenever the pipeline reads today's state while claiming to recreate an earlier decision.

Suppose management asks:

"Retrain the model exactly as we would have trained it on March 31."

This is a fundamentally important pipeline capability. If your pipeline merely says:

```text
read current customers table
```

you cannot do it. A historical rerun requires time/version-aware inputs.

For example:

```text
raw transaction snapshot:
    snapshot-2026-03-31

feature definitions:
    commit af7421

training config:
    config-v19

code:
    commit 883bed
```

Then:

```text
pipeline(
    as_of="2026-03-31"
)
```

can resolve immutable historical inputs. This is called, depending on context:

```text
backfill
historical rerun
reprocessing
point-in-time replay
```

The terminology varies, but the principle is the same. Suppose your feature code contains:

```python
cutoff = datetime.now()
```

You rerun an old pipeline. Now it uses today's date. That's not a historical replay. Similarly:

```sql
SELECT *
FROM transactions
WHERE created_at < CURRENT_TIMESTAMP
```

means the computation depends on wall-clock time. A more reproducible design passes time explicitly:

```python
build_dataset(as_of_date="2026-03-31")
```

Then:

```text
"time"
```

becomes a proper input. This follows a broader rule:

**Anything that can change the output should ideally be represented as an input rather than silently read from the outside world.**

Examples:

```text
dataset/latest
model/latest
container:latest
features/latest
```

These are convenient for humans. They're weak for provenance. Better pipeline internals use immutable identities:

```text
dataset-v42
model-v19
container@sha256:...
feature-code commit 827abc
```

You can still maintain:

```text
latest → dataset-v42
```

for convenience. But resolve it **once at the pipeline boundary** and record the immutable result.

For example:

```text
request:
    dataset = latest

resolution:
    latest → dataset-v42

run record:
    dataset = dataset-v42
```

Now the run remains understandable after `latest` moves.

## How Do Program Boundaries Keep Pipeline Logic Portable and Testable?
<!-- section-summary: Pipeline definitions describe dependencies and policies while packaged data, training, and evaluation programs retain their own portable implementation logic. -->

Historical correctness also depends on keeping model and data logic outside the orchestration definition so the same computation can run in several environments.

This is an architectural boundary worth protecting. Bad:

```python
@pipeline_step
def train():
    model = Transformer(...)
    optimizer = AdamW(...)
    for batch in loader:
        loss = ...
        loss.backward()
```

Now your ML code is tied directly to one orchestrator. Better:

```python
@pipeline_step
def train(...):
    launch(
        "python -m recommender.train ..."
    )
```

or equivalently invoke a packaged training entry point.

Then:

```text
pipeline
   │
   └── launches training program
```

rather than:

```text
pipeline = training program
```

Why? Because you may later change orchestration technology. You don't want to rewrite your model-training implementation because:

```text
Airflow → Argo
Kubeflow → Vertex AI
custom scheduler → another platform
```

Pipeline code should answer:

```text
What depends on what
What are the inputs
What are the outputs
What resources are required
What retry policy applies
What happens on success/failure
```

Training code should answer:

```text
How is the model constructed
How is loss computed
How are batches generated
How does backpropagation work
How are checkpoints written
```

Evaluation code should answer:

```text
How is this candidate measured
```

That separation gives you:

```text
            ORCHESTRATION
                 │
        ┌────────┼─────────┐
        ▼        ▼         ▼
      data     train     evaluate
      code      code       code
```

Each component can be tested independently. A developer might run:

```text
build dataset locally
↓
run smoke training
↓
evaluate locally
```

CI might run:

```text
tiny data
↓
1 epoch
↓
test artifact contract
```

Production might run:

```text
full dataset
↓
64 GPUs
↓
managed artifact store
```

These environments differ. But ideally the underlying programs are the same:

```text
prepare_dataset
train
evaluate
```

What changes is:

```text
data size
runtime configuration
compute resources
storage locations
```

not the fundamental logic. Your laptop may not have:

```text
Kubernetes
S3
8 GPUs
distributed training
production secrets
```

So exact infrastructure equivalence is unrealistic. Instead aim for **semantic equivalence**.

For example:

```text
LOCAL
dataset URI → ./tmp/train.parquet
model URI   → ./tmp/model/

PRODUCTION
dataset URI → object://datasets/v42
model URI   → object://models/v17
```

Both still exercise:

```text
load dataset
train model
write model artifact
```

The storage implementation differs. The contract doesn't. You usually don't want CI to train the full production model.

Instead:

```text
tiny dataset
small model
1 epoch
CPU
```

The purpose is to verify:

```text
pipeline graph builds
config resolves
data stage runs
training command starts
artifact contract is produced
evaluation runs
dependencies connect correctly
```

This is a pipeline smoke test. You're asking:

Does the machine work mechanically

not:

Did we produce a production-quality model

A real managed run validates:

```text
permissions
object storage
GPU scheduling
distributed networking
container images
secret injection
checkpoint upload
logging
large-data performance
```

These cannot all be reproduced locally. So think in layers:

```text
UNIT TESTS
individual functions

LOCAL/CI PIPELINE TEST
workflow semantics

MANAGED INTEGRATION TEST
real infrastructure

FULL TRAINING RUN
model quality + system behavior
```

Each layer answers a different question. Suppose evaluation returns:

```json
{
  "accuracy": 0.927,
  "latency_ms": 28,
  "fairness_gap": 0.013
}
```

Then a quality-gate step could decide:

```text
accuracy >= 0.92
AND latency <= 50
AND fairness_gap <= 0.02
```

This is better than embedding deployment policy inside the trainer:

```python
if accuracy > .92:
    deploy_model()
```

Why? Because:

```text
training
```

should create evidence.

```text
evaluation
```

should measure evidence.

```text
release policy
```

should interpret evidence.

```text
deployment
```

should perform deployment. Separate responsibilities produce safer pipelines.

![A partial replay verifies reused data, feature, and model digests before rerunning evaluation, packaging, and candidate handoff](/content-assets/articles/article-mlops-training-pipelines-repeatable-training-pipeline/partial-replay-path.png)

*The replay keeps the failed evaluation as evidence, creates a new run with a parent link, and recomputes only the repaired downstream path.*

## How Does a Pipeline Record a Provenance Graph?
<!-- section-summary: Executed steps and immutable artifacts form a derivation graph with pipeline-run, step-run, attempt, and artifact identities. -->

After execution, the pipeline is more useful as a record of derivation than as a static list of boxes.

At first, a pipeline looks like:

```text
A → B → C
```

But after execution it is more useful to think:

```text
raw-data-v8
    │
    ▼
dataset-build-run-31
    │
    ▼
training-dataset-v42
    │
    ▼
training-run-91
    │
    ▼
model-v17
    │
    ▼
evaluation-run-102
    │
    ▼
evaluation-report-v17
```

Now you have a graph containing:

```text
artifacts
+
computations
+
edges describing derivation
```

That's provenance. If `model-v17` is deployed, you can walk backwards to learn exactly how it came into existence. A useful pipeline-level manifest could say:

```json
{
  "pipeline_run_id": "pipeline-1032",
  "status": "SUCCEEDED",

  "inputs": {
    "raw_dataset": "raw-811",
    "training_config": "config-42",
    "code_commit": "81ca92f"
  },

  "steps": {
    "prepare_dataset": "step-8821",
    "train": "step-8822",
    "evaluate": "step-8823"
  },

  "outputs": {
    "training_dataset": "dataset-991",
    "model": "model-271",
    "evaluation": "evaluation-104"
  }
}
```

Now one identifier:

```text
pipeline-1032
```

lets you locate the whole computation. A useful hierarchy is:

```text
PIPELINE RUN
"this complete workflow execution"

STEP RUN
"this logical stage inside it"

ATTEMPT
"this actual execution attempt"
```

For example:

```text
pipeline-1032
│
├── dataset-step-1
│      └── attempt-1 SUCCEEDED
│
├── train-step-1
│      ├── attempt-1 FAILED
│      └── attempt-2 SUCCEEDED
│
└── evaluation-step-1
       └── attempt-1 SUCCEEDED
```

Then artifacts have their own identities:

```text
dataset-v42
model-v17
evaluation-v17
```

This is more precise than one giant ambiguous "run ID." A scheduler can decide:

```text
Train needs 8 GPUs.
```

Then some execution backend decides where those GPUs exist.

Conceptually:

```text
pipeline scheduler
       │
       ▼
"run Train with 8 GPUs"
       │
       ▼
compute platform
       │
       ├── Kubernetes
       ├── managed training service
       ├── Slurm
       └── cloud batch
```

This further separates concerns. Your pipeline describes **what needs executing**. The compute platform handles **where the process runs**. This is actually a good sign. A healthy pipeline definition might look conceptually like:

```python
dataset = build_dataset(raw_data, data_config)

model = train(
    dataset=dataset,
    config=training_config,
)

evaluation = evaluate(
    model=model,
    dataset=evaluation_data,
)

approved = quality_gate(evaluation)

if approved:
    register(model)
```

The interesting complexity lives behind each function boundary. The pipeline mostly describes:

```text
dependencies
```

That's desirable. Pipeline definitions that contain hundreds of lines of feature engineering and model logic usually have weak abstraction boundaries.

## How Does the Pipeline Recover and Reuse Work Without Changing Its Meaning?
<!-- section-summary: Durable boundaries support partial replay, deliberate caching, checkpoint resume, failure isolation, and clear ownership without changing scientific semantics accidentally. -->

That provenance lets operators restart at the nearest valid boundary and reuse work only under an explicit semantic policy.

Suppose we want to train a fraud classifier. The request is:

```text
Pipeline run:
    pipeline-5001

as-of date:
    2026-08-28

training config:
    fraud-transformer-v7

code:
    commit 4de192c
```

First, resolve the data:

```text
transactions as-of 2026-08-28
        ↓
raw-dataset-901
```

Then validation:

```text
raw-dataset-901
        ↓
Validate Data
        ↓
validation-report-212
```

Then feature construction:

```text
raw-dataset-901
+
feature-config-v11
        ↓
Build Dataset
        ↓
training-dataset-322
```

Then training:

```text
training-dataset-322
+
fraud-transformer-v7
+
commit 4de192c
        ↓
Train
        ↓
model-781
```

Suppose the first training VM dies:

```text
train-step
    ├── attempt-1 FAILED
    └── attempt-2 SUCCEEDED
```

The logical output remains:

```text
model-781
```

Then evaluation:

```text
model-781
+
evaluation-dataset-87
        ↓
Evaluate
        ↓
evaluation-991
```

Quality gate:

```text
evaluation-991
      ↓
PASS
```

Registration:

```text
model-781
      ↓
fraud-detector candidate
```

Now the complete derivation is inspectable. Suppose evaluation crashes because its machine loses network access. You already have:

```text
training-dataset-322 ✓
model-781            ✓
```

Therefore:

```text
don't rebuild dataset
don't retrain model
retry evaluation
```

The scheduler starts:

```text
evaluation attempt-2
```

using exactly:

```text
model-781
evaluation-dataset-87
```

This is what "rerun the failed part" really means. It requires earlier step outputs to be durable and independently addressable. Now the user intentionally starts:

```text
pipeline-5002
```

with identical inputs. There are several legitimate possibilities. The dataset stage might say:

```text
training-dataset-322 already exists
for identical immutable inputs
        ↓
reuse
```

Training might intentionally execute again because randomness is part of the experiment:

```text
seed changes
        ↓
new model-782
```

Or, with an identical fixed seed and deterministic policy, the system might reuse an existing model. The key is that this should be an explicit policy. Don't let accidental caches determine scientific semantics. Suppose dataset generation depends on:

```text
raw dataset
feature code
feature config
```

Then a logical cache key might be based on:

$$
K =
H(
D,
C,
F
)
$$

where:

```text
D = dataset version
C = code version
F = feature configuration
H = hash function
```

If any relevant input changes:

```text
cache miss
```

If all remain identical:

```text
cache hit
```

This is much safer than caching based merely on:

```text
step name = "build_dataset"
```

Dataset preparation may be almost purely deterministic. Training often isn't. Even with seeds, differences in:

```text
GPU kernels
distributed operation ordering
library versions
hardware
```

can affect results. So indiscriminately caching:

```text
Train Model
```

may have undesirable semantics. You may want:

```text
data-building steps → aggressively cacheable
training → new run by default
evaluation of same immutable model/dataset → often cacheable
```

There isn't one universal rule. What matters is understanding the semantic meaning of reuse. Without a pipeline:

```text
"the training process failed"
```

may describe everything. With explicit stages:

```text
data validation       SUCCEEDED
dataset preparation   SUCCEEDED
training              SUCCEEDED
artifact publication  SUCCEEDED
evaluation            FAILED
registration          NOT STARTED
```

Now you know exactly:

```text
where failure occurred
what remains valid
what must be retried
what downstream work never happened
```

This is a huge operational advantage. Different teams may own:

```text
data pipeline
feature generation
training code
evaluation policy
deployment
```

Explicit artifact interfaces allow this:

```text
Data Team
    │
dataset artifact
    ▼
ML Training Team
    │
model artifact
    ▼
Evaluation System
    │
report artifact
    ▼
Deployment Team
```

Each team can change its internals while maintaining the contract. That's one reason pipelines are as much a software architecture concept as an ML concept.

## How Do Scripts, Configuration, Artifacts, and Orchestration Fit Together?
<!-- section-summary: Scripts perform computations, configurations select recipes, artifacts preserve evidence, pipelines define dependencies, and orchestrators execute that graph through time. -->

The final design assigns one responsibility to each layer and leaves the pipeline itself focused on dependencies, state, and evidence handoffs.

The pieces from the previous topics form one system.

### Training script

```text
HOW does model training work
```

Example:

```bash
python -m fraud_model.train ...
```

### Training configuration

```text
WHICH training recipe should this run use
```

Example:

```yaml
optimizer:
  learning_rate: 0.0003

training:
  epochs: 30
```

### Training artifacts

```text
WHAT durable evidence and outputs did training produce
```

Example:

```text
model bundle
metrics
checkpoints
resolved config
lineage
```

### Training pipeline

```text
WHEN should each computation run,
what should it consume,
what should happen after it,
and how should failures/retries be handled
```

Put together:

```text
                    TRAINING PIPELINE
                           │
              selects inputs + config
                           │
                           ▼
                  TRAINING SCRIPT
                           │
                           ▼
                    runs training
                           │
                           ▼
                 TRAINING ARTIFACTS
                           │
                           ▼
                evaluation / registry
```

A training pipeline can be viewed as a distributed execution of functions over immutable artifacts:

```text
Artifact A
    │
    ▼
 Function 1
    │
    ▼
Artifact B
    │
    ▼
 Function 2
    │
    ▼
Artifact C
```

Each function invocation should ideally have:

```text
explicit inputs
explicit code version
explicit configuration
explicit environment
unique execution identity
durable outputs
clear success/failure
```

Once those properties exist, the scheduler becomes capable of:

```text
retrying
resuming
caching
parallelizing
backfilling
auditing
reproducing
```

without needing to understand the internals of the computation. The naive view is:

```text
A training pipeline is a list of steps.
```

A better view is:

> **A training pipeline is a system that converts an intended model-training request into a graph of reproducible computations and durable artifacts.**

Its important properties are therefore not merely:

```text
A runs before B
B runs before C
```

but:

```text
Every step has explicit inputs.

Every successful step creates explicit durable outputs.

Every run records exactly what it consumed.

Retries don't corrupt previous results.

Repeated requests are distinguished from retries.

Previously successful work can be reused deliberately.

A failure can be resumed from the nearest valid boundary.

Historical data can be replayed using explicit versions.

Training code doesn't depend on the pipeline orchestrator.

The same underlying programs work locally, in CI,
and on managed compute.
```

The clean mental model is:

```text
                    PIPELINE REQUEST
                          │
                          ▼
                  resolve exact inputs
                          │
                          ▼
          ┌─────────────────────────────┐
          │       PIPELINE GRAPH        │
          │                             │
          │  data → train → evaluate   │
          │           → register        │
          └─────────────────────────────┘
              │        │        │
              ▼        ▼        ▼
           durable  durable   durable
           artifact artifact  artifact
              │        │        │
              └────────┴────────┘
                       │
                       ▼
                 provenance graph
```

And the deepest principle is:

**A good training pipeline makes failure and repetition ordinary rather than exceptional.**

Machines can disappear. Jobs can retry. Evaluation can fail. The same request can arrive twice. Yesterday's model may need to be reconstructed. A good pipeline is designed so that none of those events requires a human to reconstruct the truth from memory.

![A repeatable training pipeline connects seven contracted stages to control-plane coordination, durable evidence, and distinct repetition policies](/content-assets/articles/article-mlops-training-pipelines-repeatable-training-pipeline/repeatable-training-pipeline.png)

*The run specification and stage contracts create the main path. Retry, cache, replay, and backfill remain separate recovery choices with different identities.*

## Check Your Answers

Use these short answers to revisit the reasoning behind each section.

:::expand[What Problem Does a Repeatable Training Pipeline Solve?]{kind="recap"}
A repeatable pipeline coordinates explicit computations and durable handoffs so a complete training request can be inspected, retried, and reproduced.
:::

:::expand[What Must One Pipeline Run Record Before Expensive Work Begins?]{kind="recap"}
A run records immutable data, code, resolved configuration, environment, randomness, identities, contracts, and cheap validation before allocating costly compute.
:::

:::expand[How Do Retries, Reruns, Reuse, and Duplicate Requests Differ?]{kind="recap"}
Retries repeat a failed attempt, reruns create new workflow intent, reuse consumes an existing valid result, and duplicate requests require an explicit policy.
:::

:::expand[How Can a Pipeline Reproduce a Historical Training Run?]{kind="recap"}
Historical execution resolves an explicit logical time and immutable versions instead of silently reading current data, current time, or mutable latest aliases.
:::

:::expand[How Do Program Boundaries Keep Pipeline Logic Portable and Testable?]{kind="recap"}
Pipeline definitions describe dependencies and policies while packaged data, training, and evaluation programs retain their own portable implementation logic.
:::

:::expand[How Does a Pipeline Record a Provenance Graph?]{kind="recap"}
Executed steps and immutable artifacts form a derivation graph with pipeline-run, step-run, attempt, and artifact identities.
:::

:::expand[How Does the Pipeline Recover and Reuse Work Without Changing Its Meaning?]{kind="recap"}
Durable boundaries support partial replay, deliberate caching, checkpoint resume, failure isolation, and clear ownership without changing scientific semantics accidentally.
:::

:::expand[How Do Scripts, Configuration, Artifacts, and Orchestration Fit Together?]{kind="recap"}
Scripts perform computations, configurations select recipes, artifacts preserve evidence, pipelines define dependencies, and orchestrators execute that graph through time.
:::
