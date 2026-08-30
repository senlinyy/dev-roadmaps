---
title: "Training Artifacts"
description: "Log the model, metrics, resolved config, data manifest, schemas, reports, environment details, and review packet that a training run needs."
overview: "A training job produces evidence through several storage boundaries. A production artifact contract classifies that evidence, verifies it in an attempt-specific staging area, commits one immutable bundle, connects lineage, and hands an approved candidate to the next control boundary."
tags: ["MLOps", "core", "training"]
order: 3
id: "article-mlops-training-pipelines-logging-training-outputs-artifacts"
---

## Table of Contents

1. [What Must Survive After a Training Machine Disappears?](#what-must-survive-after-a-training-machine-disappears)
2. [How Are Training Outputs Stored and Published Safely?](#how-are-training-outputs-stored-and-published-safely)
3. [How Do Immutable Artifacts, Attempts, and Checkpoints Get Their Identities?](#how-do-immutable-artifacts-attempts-and-checkpoints-get-their-identities)
4. [What Lineage and Model-Bundle Information Makes an Artifact Usable?](#what-lineage-and-model-bundle-information-makes-an-artifact-usable)
5. [How Are Candidate Creation, Evaluation, and Registry Promotion Separated?](#how-are-candidate-creation-evaluation-and-registry-promotion-separated)
6. [How Do Retry-Safe Publishing and Artifact Tools Preserve History?](#how-do-retry-safe-publishing-and-artifact-tools-preserve-history)
7. [How Should Retention and Deletion Follow Artifact Meaning?](#how-should-retention-and-deletion-follow-artifact-meaning)
8. [What Does the Complete Training Artifact Workflow Produce?](#what-does-the-complete-training-artifact-workflow-produce)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A cloud GPU finishes a six-hour training job and shuts down. If the only copy of the result was `/home/ubuntu/model.pt`, the model disappears with the machine. Even if the file was uploaded, the team may still lack the tokenizer, label mapping, validation metrics, configuration, dataset identity, or evidence that every file arrived intact.

A **training artifact** is a durable input or output that remains useful after the computation ends. Model bundles support inference. Checkpoints support resuming training. Metrics describe behavior. Manifests, lineage, and environment records explain what was produced and how. Logs and diagnostics help investigate the execution.

Artifact engineering turns a temporary training process into a result that another system can identify, verify, evaluate, register, retain, and eventually delete safely. Training is complete only after the required output contract exists in durable storage and cannot be mistaken for a partial upload.

The following questions trace a result from temporary files on a training machine to durable evidence that another system can safely consume:

1. **What Must Survive After a Training Machine Disappears?**
2. **How Are Training Outputs Stored and Published Safely?**
3. **How Do Immutable Artifacts, Attempts, and Checkpoints Get Their Identities?**
4. **What Lineage and Model-Bundle Information Makes an Artifact Usable?**
5. **How Are Candidate Creation, Evaluation, and Registry Promotion Separated?**
6. **How Do Retry-Safe Publishing and Artifact Tools Preserve History?**
7. **How Should Retention and Deletion Follow Artifact Meaning?**
8. **What Does the Complete Training Artifact Workflow Produce?**

## What Must Survive After a Training Machine Disappears?
<!-- section-summary: Training artifacts preserve the model bundle, checkpoints, metrics, provenance, and diagnostics needed after temporary compute is gone. -->

Training compute is temporary, so completion has meaning only when the evidence needed by later systems has crossed a durable boundary.

To understand training artifacts, start with a deceptively simple question:

**When a training process finishes, what evidence must remain after the machine disappears?**

The answer is much more than `model.pt`. A training machine may exist for only a few hours:

```text
GPU machine starts
      ↓
loads data
      ↓
trains model
      ↓
writes outputs
      ↓
machine disappears
```

Anything left only on that machine is effectively gone. So the purpose of training artifacts is to turn a temporary computation into **durable, identifiable, reproducible outputs that other systems can consume**. The fundamental transformation is:

```text
code + data + configuration
             ↓
       training process
             ↓
        durable evidence
```

That durable evidence is the artifact system. An artifact is a durable output or input associated with a computation. For training, examples include:

```text
model weights
checkpoints
resolved configuration
tokenizer
preprocessing state
metrics report
dataset manifest
environment description
model signature
plots
evaluation files
```

For example:

```text
run-8472/
├── resolved_config.yaml
├── metrics.json
├── lineage.json
├── environment.json
├── model/
│   ├── weights.safetensors
│   ├── tokenizer.json
│   └── model_config.json
└── checkpoints/
    ├── step-10000/
    └── step-20000/
```

But there is an important distinction. An artifact is usually something you want to **keep and refer to later**. Temporary files are not necessarily artifacts:

```text
/tmp/shuffled_batch_319.bin
temporary CUDA cache
downloaded package cache
intermediate scratch files
```

Those exist only to help the process execute. A useful mental model is:

```text
temporary state
    ↓
needed while computation runs

artifact
    ↓
needed after computation ends
```

Suppose training leaves you only this:

```text
model.pt
```

Three months later someone asks:

What dataset trained this

Unknown.

What learning rate

Unknown.

Which source-code version

Unknown.

Which tokenizer does it require

Unknown.

Which version of PyTorch

Unknown.

What validation score did it achieve

Unknown.

Was this even the final successful model, or a checkpoint from a failed run

Unknown. The file contains parameters, but almost none of the **meaning surrounding those parameters**. So a useful trained model is really:

$$
\text{Usable Model}
=
\text{Weights}
+
\text{Interpretation}
+
\text{Provenance}
$$

The first is obvious. The latter two are what artifact engineering provides. Instead of saying:

"Training creates some files."

say:

"A successful training run promises to produce these outputs."

For example:

```text
TRAINING RUN OUTPUT CONTRACT

required:
    model bundle
    resolved configuration
    final metrics
    lineage metadata
    artifact manifest

optional:
    checkpoints
    plots
    profiler traces
    sample predictions
```

Now pipeline code can depend on the contract.

For example:

```text
Train
  ↓
verify artifact contract
  ↓
Evaluate
  ↓
Register
```

If `model/` doesn't exist:

```text
training output is invalid
```

If `manifest.json` doesn't exist:

```text
publishing didn't finish
```

If metrics are missing:

```text
candidate cannot enter release review
```

The important shift is from:

```text
"training happened"
```

to:

```text
"a verified output contract was produced"
```

Training usually creates at least five categories.

### Model artifacts

These are required to reconstruct inference:

```text
weights
architecture metadata
tokenizer
vocabulary
feature transformer
normalization statistics
label mapping
```

For a simple sklearn model:

```text
model.pkl
```

may genuinely be enough. For an LLM it might be:

```text
model/
├── config.json
├── model.safetensors
├── tokenizer.json
├── tokenizer_config.json
└── special_tokens_map.json
```

Call this collection the **model bundle**.

### Checkpoints

A checkpoint exists primarily so training can resume:

```text
checkpoint/
├── model weights
├── optimizer state
├── scheduler state
├── RNG state
└── training progress
```

This is different from an inference model. For example, inference doesn't normally need:

```text
Adam optimizer moments
current gradient-scaler state
global training step
```

but resuming training does. So:

```text
checkpoint ≠ release model
```

although a checkpoint may later be converted into one.

### Metrics

Examples:

```text
training_loss
validation_loss
accuracy
F1
AUC
BLEU
perplexity
```

There are usually two forms. Time-series metrics:

```text
step 100 → loss 2.7
step 200 → loss 2.3
step 300 → loss 2.1
```

and final summary metrics:

```json
{
  "validation_loss": 1.82,
  "validation_accuracy": 0.931
}
```

The time series is useful for debugging and visualization. The final summary is useful for pipeline decisions.

### Provenance metadata

This answers:

Where did this thing come from

For example:

```json
{
  "git_commit": "17a92ef",
  "dataset_version": "transactions-2026-08-22",
  "config_hash": "sha256:...",
  "container_digest": "sha256:...",
  "seed": 42
}
```

Without provenance, artifacts become archaeological objects.

### Logs and diagnostics

Examples:

```text
stdout/stderr
GPU-memory logs
profiling traces
loss plots
confusion matrices
sample predictions
```

These primarily answer:

What happened while this computation executed

They're important, but they're not generally the model itself.

## How Are Training Outputs Stored and Published Safely?
<!-- section-summary: Large immutable bytes, searchable metadata, and logs use suitable stores, while a staged and verified commit prevents partial bundles from appearing complete. -->

Different outputs have different access patterns, and publishing several files safely requires more than copying them into a shared folder.

Different outputs have different access patterns. Consider a 20 GB model. You rarely want this inside a relational database row.

Instead:

```text
                    TRAINING JOB
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
 Object storage      Metadata DB       Log system
       │                 │                 │
 model weights        run status       stdout
 checkpoints          parameters       stderr
 reports              metric summaries traces
 large files          artifact URIs
```

A reasonable division is:

| Information                   | Natural home                    |
| ----------------------------- | ------------------------------- |
| 20 GB checkpoint              | Object/artifact storage         |
| Final model                   | Object/artifact storage         |
| Run ID                        | Tracking database               |
| Learning rate                 | Tracking database               |
| Final accuracy                | Tracking database               |
| Training-loss series          | Metrics/tracking store          |
| stdout                        | Log store                       |
| Model approved for production | Registry/control-plane metadata |

MLflow follows this general separation: metadata such as parameters, metrics, and tags belongs to its backend store, while large files such as model weights and other artifacts are stored in an artifact store such as object storage. ([MLflow AI Platform][1]) The principle is more important than the particular product:

**Put bytes where large immutable bytes belong; put searchable facts where searchable metadata belongs.**

Suppose training produces:

```text
/home/ubuntu/output/model.pt
```

and exits successfully. Then your cloud GPU VM is terminated. Your artifact is gone. The local disk should generally be treated as:

```text
scratch space
```

The durable path should be something like:

```text
object-store://ml-artifacts/runs/8472/model/...
```

Conceptually:

```text
temporary GPU machine
        │
        │ upload
        ▼
durable artifact store
        │
        ├── evaluation job
        ├── registry
        └── future deployment
```

The pipeline should regard training as complete only after required durable outputs have been published. One of the simplest improvements you can make is to standardize where training outputs go.

For example:

```text
runs/
└── train-8472/
    ├── manifest.json
    ├── resolved_config.yaml
    ├── metrics.json
    ├── lineage.json
    ├── environment.json
    │
    ├── model/
    │   ├── weights.safetensors
    │   ├── config.json
    │   └── tokenizer.json
    │
    └── checkpoints/
        ├── step-10000/
        ├── step-20000/
        └── step-30000/
```

Now every downstream program knows where to look.

For example:

```python
model_uri = run_output / "model"
metrics_uri = run_output / "metrics.json"
```

rather than:

```python
search_for_whatever_the_training_script_happened_to_create()
```

Standard layouts reduce coupling between teams and pipeline stages. Suppose a model bundle has five files:

```text
model/
├── weights.safetensors
├── config.json
├── tokenizer.json
├── vocab.json
└── preprocessing.json
```

How does a downstream system know whether all five arrived successfully? A manifest can describe the complete bundle:

```json
{
  "schema_version": 1,
  "files": [
    {
      "path": "model/weights.safetensors",
      "sha256": "..."
    },
    {
      "path": "model/config.json",
      "sha256": "..."
    },
    {
      "path": "model/tokenizer.json",
      "sha256": "..."
    }
  ]
}
```

The consumer can verify:

```text
expected file exists
       ↓
correct size
       ↓
correct checksum
       ↓
bundle valid
```

This makes corruption and partial uploads detectable. Suppose you upload a bundle in this order:

```text
weights.safetensors      ✓
config.json              ✓
tokenizer.json           uploading...
```

Then the process crashes. A downstream system sees:

```text
model/
├── weights.safetensors
├── config.json
└── tokenizer.json.partial
```

Is this a valid model? No. But if downstream code merely checks:

```text
does model/ exist
```

it may mistakenly consume the incomplete bundle. A safer publishing protocol is:

```text
1. Create private/staging destination
2. Upload every required file
3. Verify files/checksums
4. Write final manifest
5. Mark bundle READY
```

For example:

```text
runs/8472/staging/model/
```

then, only when verified:

```text
runs/8472/model/
runs/8472/manifest.json
runs/8472/_SUCCESS
```

The key property is:

> **A consumer should never mistake a partially written model for a published model.**

Imagine:

```text
file A
file B
file C
manifest
_SUCCESS
```

If `_SUCCESS` is written last, consumers can use:

```text
if _SUCCESS exists:
    bundle may be consumed
else:
    bundle is incomplete
```

A richer variant is to use a manifest whose state changes from:

```json
{
  "status": "PENDING"
}
```

to:

```json
{
  "status": "READY"
}
```

The exact mechanism depends on your storage system. The underlying pattern is the same:

```text
produce
  ↓
verify
  ↓
commit
  ↓
publish
```

It's the artifact equivalent of a database transaction.

![A training attempt sending events, metrics, metadata, artifacts, and governed data references to their proper stores, with only artifacts and data references forming a registry candidate.](/content-assets/articles/article-mlops-training-pipelines-logging-training-outputs-artifacts/training-output-stores.png)

*Each output uses a store suited to its query and retention needs; the registry identifies the reviewed model package rather than duplicating every record.*

## How Do Immutable Artifacts, Attempts, and Checkpoints Get Their Identities?
<!-- section-summary: Logical run IDs, attempt IDs, model IDs, immutable destinations, and checkpoint policies distinguish requested work from executions and durable results. -->

Once publication is safe, identities must distinguish the requested experiment, each physical attempt, every checkpoint, and the selected model object.

Suppose every training job writes:

```text
models/latest/model.pt
```

Run A finishes:

```text
models/latest/model.pt → model A
```

Run B starts overwriting it. Halfway through, deployment reads it. Now you can get an invalid or ambiguous model. Instead, use immutable identities:

```text
models/candidate-017/model.pt
models/candidate-018/model.pt
models/candidate-019/model.pt
```

Then maintain a small pointer:

```text
production → candidate-018
```

So:

```text
immutable data
+
mutable reference
```

is preferable to:

```text
mutable model contents
```

This pattern appears everywhere in reliable artifact management. Suppose training run:

```text
train-run-8472
```

produces:

```text
model-candidate-991
```

Those are related but conceptually different things. A run is a computation:

```text
"the execution that occurred"
```

A model artifact is an output:

```text
"the durable object produced"
```

One run could theoretically produce several model checkpoints or model candidates:

```text
training run 8472
       │
       ├── model checkpoint A
       ├── model checkpoint B
       └── final model C
```

Modern MLflow 3 makes this distinction explicit: logged models have their own model IDs and can represent multiple model checkpoints associated with one training run. ([MLflow AI Platform][2]) This separation becomes particularly useful for deep learning. Now suppose:

```text
training run = 8472
```

fails because the cloud machine disappears. The orchestrator retries. Did you perform a completely new experiment? Usually no. You attempted the same requested training computation again. So distinguish:

```text
training_run_id = 8472
attempt_id = 1
```

then:

```text
training_run_id = 8472
attempt_id = 2
```

For example:

```text
runs/
└── 8472/
    ├── attempts/
    │   ├── attempt-1/
    │   └── attempt-2/
    │
    └── final/
```

Why? Because otherwise retries can destroy forensic information. Suppose attempt 1 fails after six hours:

```text
attempt-1/
    checkpoint-step-92000
    logs
```

Attempt 2 resumes and succeeds:

```text
attempt-2/
    logs
    final-model
```

You want to know both happened. Distributed infrastructure can behave strangely. Imagine the scheduler believes attempt 1 is dead and starts attempt 2. But attempt 1 was merely disconnected and resumes. Now both processes write:

```text
runs/8472/output/
```

Danger. Separate destinations:

```text
runs/8472/attempts/1/
runs/8472/attempts/2/
```

prevent most accidental interference. Only one successful attempt is later selected as the authoritative output:

```text
runs/8472/final
       ↓
points to attempt 2
```

This is an important distributed-systems principle:

**Separate generation from selection.**

Let attempts independently create immutable things. Then select which thing counts. A long training run might produce:

```text
step-10k
step-20k
step-30k
step-40k
step-50k
...
step-500k
```

If every checkpoint is 40 GB:

$$
50 \times 40\text{ GB} = 2\text{ TB}
$$

per run. So "save everything forever" quickly becomes expensive. Checkpoint policy might be:

```text
keep newest 3
+
keep best validation checkpoint
+
keep every 100k-step milestone
+
keep final checkpoint
```

For example:

```text
step-430k   delete
step-440k   delete
step-450k   keep milestone
step-480k   keep
step-490k   keep
step-500k   keep final
```

This is fundamentally different from retention for deployed models. A production model may need to remain indefinitely for audit or rollback.

## What Lineage and Model-Bundle Information Makes an Artifact Usable?
<!-- section-summary: Versioned data, code, resolved configuration, environment, signatures, label mappings, and secret-safe metadata preserve ancestry and interpretation. -->

An immutable file still has little value if nobody can determine what it means or where it came from, which makes lineage and the complete model bundle essential.

A model is derived from other things.

Conceptually:

```text
source code ───────┐
                   │
training dataset ──┤
                   │
config ────────────┼──▶ training run ───▶ model
                   │
base checkpoint ───┤
                   │
environment ───────┘
```

This is **lineage**.

For example:

```json
{
  "model_id": "model-991",
  "training_run_id": "run-8472",
  "source_commit": "71cd802",
  "training_dataset": "dataset:transactions:v31",
  "base_model": "model:encoder:v14",
  "resolved_config_hash": "sha256:...",
  "container_digest": "sha256:..."
}
```

Then you can walk backward:

```text
deployed model
    ↓
candidate model
    ↓
training run
    ↓
training dataset
    ↓
data-generation pipeline
    ↓
raw dataset
```

This is one of the most important capabilities in mature ML infrastructure. This is weak:

```json
{
  "training_data": "s3://datasets/train/"
}
```

What files existed there on the training date? Maybe today's contents differ. A stronger reference is:

```json
{
  "training_dataset_id": "transactions:v42",
  "manifest_hash": "sha256:46ae..."
}
```

or an immutable storage path:

```text
datasets/transactions/2026-08-22/manifest.json
```

Now the relationship is:

```text
model X
was trained from
dataset version Y
```

not merely:

```text
model X probably read something from this directory
```

A configuration cannot reproduce behavior if the implementation changed. Consider:

```yaml
optimizer:
  name: adamw
  learning_rate: 0.001
```

Commit A might implement:

```python
AdamW(..., eps=1e-8)
```

Commit B might implement:

```python
AdamW(..., eps=1e-6)
```

Same configuration. Different behavior. So record something such as:

```text
git_commit = 79acf21
```

and preferably the exact container/image digest:

```text
sha256:35df...
```

Then the complete provenance becomes closer to:

$$
\text{Model}
=
f(
\text{code},
\text{data},
\text{config},
\text{environment},
\text{randomness}
)
$$

Your artifacts should help identify each term. Suppose the run was launched with:

```text
config = baseline.yaml
```

but:

```text
baseline.yaml
      +
defaults
      +
CLI overrides
      ↓
actual settings
```

were:

```yaml
optimizer:
  learning_rate: 0.0003

training:
  batch_size: 128
  epochs: 40
```

Artifact storage should contain:

```text
resolved_config.yaml
```

representing what the trainer actually used. This is an important connection between training configuration and training artifacts:

```text
configuration system
       ↓
resolve configuration
       ↓
training begins
       ↓
resolved configuration becomes artifact
```

That lets the training recipe survive independently of the configuration machinery. A useful test is:

**What would another process need to correctly load and interpret this model?**

Depending on the system:

```text
model/
├── weights
├── architecture/config
├── tokenizer
├── vocabulary
├── feature definitions
├── preprocessing parameters
├── label mapping
├── model signature
├── dependency/environment metadata
└── README/model card metadata
```

For example, classification weights alone may output:

```text
class index = 2
```

Without:

```json
{
  "0": "cat",
  "1": "dog",
  "2": "horse"
}
```

the output has lost its semantic meaning. Artifacts must preserve not only computation but **interpretation**. Suppose one pipeline expects:

```text
age: float
income: float
country: string
```

but the model expects:

```text
128-dimensional normalized float vector
```

A model signature can describe the expected interface:

```text
INPUT
    amount: float
    merchant_category: string
    account_age_days: int

OUTPUT
    fraud_probability: float
```

Now evaluation and deployment systems can validate whether they are feeding the model correctly. Without an interface contract, model artifacts are easy to misuse. Artifacts tend to be:

```text
replicated
downloaded
cached
shared
backed up
retained
```

Therefore never casually place:

```text
database_password
AWS secret key
private API token
service-account credential
```

inside:

```text
resolved_config.yaml
environment.json
model bundle
logs
```

If your configuration contained secret references, artifact capture should preferably record something like:

```text
credential_source = "training-data-reader"
```

rather than the credential value. Artifacts have long lifetimes. Secrets should have controlled, short lifetimes and separate access policy.

## How Are Candidate Creation, Evaluation, and Registry Promotion Separated?
<!-- section-summary: Training creates candidate evidence; separate evaluation and release authority decide whether an immutable candidate receives a lifecycle role. -->

A usable candidate is still only evidence from training. Promotion requires a separate decision with its own authority and criteria.

Suppose training succeeds and produces:

```text
candidate-model-991
```

Does that mean production should immediately use it? Usually not. There are two separate actions:

```text
CREATE
──────
training produces candidate artifact

SELECT / PROMOTE
────────────────
system decides candidate is suitable for release
```

The pipeline might look like:

```text
Train
  ↓
candidate artifact
  ↓
Evaluate
  ↓
quality/security checks
  ↓
release review
  ↓
registry
  ↓
deployment
```

This keeps training from having authority to deploy itself. Conceptually, an artifact store answers:

Where are the model bytes

A registry answers:

Which models exist, what do they mean, and which one has been selected for some lifecycle role

For example:

```text
fraud-detector
│
├── candidate-87
├── candidate-88
└── candidate-89
       ↑
     approved
```

You might then maintain:

```text
production → candidate-88
staging    → candidate-89
```

The underlying artifact can stay immutable. Only lifecycle metadata changes. Suppose training saves five checkpoints:

```text
epoch-10  accuracy=.917
epoch-11  accuracy=.921
epoch-12  accuracy=.920
epoch-13  accuracy=.924
epoch-14  accuracy=.922
```

Which one should downstream evaluation inspect? Don't make every downstream stage rediscover that decision. Training can explicitly select:

```json
{
  "selected_checkpoint": "epoch-13",
  "selection_metric": "validation_accuracy",
  "selection_mode": "max",
  "selection_value": 0.924
}
```

Then publish a candidate bundle created from that checkpoint:

```text
checkpoints/
   ...
   epoch-13/

candidate-model/
   ↓
derived from epoch-13
```

This distinguishes:

```text
checkpoint selection
```

from:

```text
release approval
```

Training may select the best checkpoint. A later process decides whether the candidate is good enough to release. Suppose:

```text
candidate A
accuracy = 94.2%
latency = 400 ms

candidate B
accuracy = 94.0%
latency = 30 ms
```

Which is better? It depends on requirements. Production selection may include:

```text
accuracy
latency
memory
fairness
stability
cost
security
business constraints
```

Therefore training should generally output **candidate artifacts and measurements**. Release policy should make the deployment decision. That keeps responsibilities clean.

![Three-state artifact publication flow from attempt-specific staging through contract verification to a manifest-gated committed bundle, with failure quarantined.](/content-assets/articles/article-mlops-training-pipelines-logging-training-outputs-artifacts/safe-artifact-publication.png)

*The manifest is published last, so readers discover only a complete, verified attempt.*

## How Do Retry-Safe Publishing and Artifact Tools Preserve History?
<!-- section-summary: Idempotent publication, content hashes, run trackers, artifact graphs, immutable versions, and mutable aliases preserve one trustworthy history across retries. -->

Publication can fail after expensive training succeeds, so retries and product tooling must preserve one verified result without erasing history.

Consider:

```text
training finishes
      ↓
model exists locally
      ↓
upload begins
      ↓
network failure
      ↓
job crashes
```

The expensive computation may have succeeded even though publication did not. A poor design retrains everything. A better system can distinguish:

```text
TRAINING FAILURE
model computation itself failed

from

PUBLISHING FAILURE
model exists, durable publication failed
```

If a recoverable local/durable checkpoint exists, retry publication:

```text
training complete
      ↓
bundle generated
      ↓
publication attempt 1 ✗
      ↓
publication attempt 2
      ↓
verify
      ↓
READY
```

This is another reason publishing should be an explicit phase. Imagine upload retry 2 blindly appends data to an existing object. Bad. Publishing should preferably behave like:

```text
same artifact bytes
+
same destination identity
+
retry
=
same final artifact
```

Content hashes help.

For example:

```text
sha256(model bundle) = f4028a...
```

A publisher can determine:

```text
artifact with same hash already present
        ↓
reuse / verify
```

rather than generate accidental duplicates or corruption. This is **idempotent publishing**. Names can lie:

```text
model-final.pt
model-final-v2.pt
model-final-REALLY-final.pt
```

Hashes describe content:

```text
SHA256(model) = 84c2...
```

If two files have the same strong content hash:

```text
same bytes
```

with overwhelmingly high confidence. Hashes help with:

```text
integrity
deduplication
cache validation
lineage
bundle verification
```

For example:

```json
{
  "artifact_id": "model-991",
  "sha256": "84c2..."
}
```

This gives the artifact both:

```text
semantic identity → model-991
content identity  → sha256:84c2...
```

The important thing is the conceptual mapping:

```text
our concept              MLflow concept
────────────────────────────────────────
training execution   →   Run
parameters/config    →   params / artifacts
metric history       →   metrics
large files          →   artifacts
trained model        →   Logged Model
model identity       →   model ID / model URI
```

MLflow 3 specifically treats logged models as first-class objects separate from ordinary run artifacts. Logged models receive model IDs; multiple checkpoints can be logged within a run, and current documentation recommends using the model URI returned by `log_model()` when referring back to the model. ([MLflow AI Platform][2])

Conceptually:

```python
with mlflow.start_run() as run:
    mlflow.log_params(...)

    train(...)

    mlflow.log_metrics(...)

    model_info = mlflow.pytorch.log_model(
        model,
        name="candidate_model",
    )
```

You could additionally log:

```text
resolved_config.yaml
lineage.json
evaluation plots
```

as run artifacts. The resulting relationship is approximately:

```text
MLflow Run
├── parameters
├── metrics
├── ordinary artifacts
└── Logged Model
       ├── model ID
       ├── model artifacts
       └── model metadata
```

MLflow's model format can also record environment/dependency metadata and input examples/signatures, which makes the model bundle more useful for later loading and serving. ([MLflow AI Platform][3]) The broader lesson isn't "use MLflow." It is:

Give model artifacts identities and lineage separate from the processes that happened to create them.

W&B uses an especially direct input/output artifact model.

Conceptually:

```text
dataset artifact
       │
       ▼
   training run
       │
       ▼
model artifact
```

W&B Artifacts are designed to version datasets, models, and other files and associate them as run inputs or outputs. That allows W&B to derive lineage between artifact versions and runs. ([Weights  Biases Documentation][4]) A simplified pattern is:

```python
with wandb.init(project="fraud-model") as run:
    training_data = run.use_artifact("training-data:v17")

    # train...

    artifact = wandb.Artifact(
        "fraud-model",
        type="model",
    )

    artifact.add_dir("./model_bundle")

    run.log_artifact(artifact)
```

The relationship becomes:

```text
training-data:v17
        ↓
    run abc123
        ↓
 fraud-model:v8
```

That graph is arguably more important than the individual naming convention:

```text
artifact → computation → artifact
```

because it describes how information flowed through the ML system. Suppose you have:

```text
model:v17
model:v18
model:v19
```

These versions should mean immutable historical objects. You might then have aliases:

```text
candidate → v19
staging   → v18
production → v17
```

W&B Registry supports linking artifact versions into registry collections, and aliases can act as mutable references to particular versions. ([Weights  Biases Documentation][5]) Again, the general architectural pattern is:

```text
immutable versions
       +
mutable human-friendly pointers
```

That pattern works regardless of which registry technology you use.

## How Should Retention and Deletion Follow Artifact Meaning?
<!-- section-summary: Retention follows lifecycle value and lineage reachability, so released evidence outlives temporary logs and ordinary checkpoints. -->

Artifacts accumulate quickly. Retention and deletion therefore need the lifecycle state and dependency graph, rather than age alone.

Not every artifact deserves equal protection. You might define:

```text
scratch
   ↓
candidate
   ↓
validated
   ↓
released
   ↓
retired
```

Then retention policy becomes stricter as artifacts move upward.

For example:

| Artifact                  | Example retention |
| ------------------------- | ----------------- |
| Failed attempt logs       | 30 days           |
| Ordinary checkpoints      | 14 days           |
| Candidate models          | 90 days           |
| Approved release models   | Several years     |
| Models required for audit | Policy-dependent  |
| Raw temporary scratch     | Hours             |

The exact numbers depend on your organization. The important idea is:

**Retention should follow artifact meaning, not merely file age.**

Suppose:

```text
model-v17
    ↓ trained from
dataset-v31
```

Can you delete `dataset-v31`? Maybe. But perhaps your reproducibility policy requires retaining it. Similarly:

```text
production
   ↓
model-v17
```

means you probably shouldn't delete `model-v17`. So garbage collection can use reachability:

```text
protected releases
      ↓
referenced artifacts
      ↓
their required ancestors
```

Artifacts outside protected lineage can be candidates for expiration. This resembles garbage collection in programming languages and Git. Suppose a production model must remain available for five years. Does every per-step GPU-utilization sample need five-year retention? Probably not. You might keep:

```text
model bundle              5 years
resolved config           5 years
lineage                    5 years
final evaluation           5 years

full metric time series    1 year
stdout logs                90 days
GPU profiler traces        14 days
```

Again, the principle is:

```text
retain according to future utility
```

rather than treating every training output identically. Imagine logical run:

```text
train-8472
```

which required two attempts. You could represent it conceptually as:

```text
training-runs/
└── train-8472/
    │
    ├── run-metadata.json
    │
    ├── attempts/
    │   ├── attempt-1/
    │   │   ├── logs/
    │   │   └── checkpoints/
    │   │
    │   └── attempt-2/
    │       ├── logs/
    │       └── checkpoints/
    │
    └── result/
        ├── manifest.json
        ├── resolved_config.yaml
        ├── lineage.json
        ├── metrics.json
        ├── environment.json
        └── model/
            ├── weights.safetensors
            ├── config.json
            └── tokenizer.json
```

The corresponding metadata might say:

```json
{
  "training_run_id": "train-8472",
  "successful_attempt_id": "attempt-2",
  "model_id": "model-991",
  "dataset_id": "dataset-442",
  "status": "SUCCEEDED"
}
```

This tells you:

```text
what was requested
which attempt succeeded
what model was produced
what data it used
whether publication completed
```

This distinction is especially useful:

```text
TRAINING RUN ID
"What logical experiment did we request?"

ATTEMPT ID
"Which execution attempt was this?"

MODEL ARTIFACT ID
"Which immutable model object resulted?"
```

For example:

```text
training_run_id = train-8472

attempts:
    attempt-1  FAILED
    attempt-2  SUCCEEDED

produced:
    model-991
```

This prevents a great deal of confusion in production systems.

## What Does the Complete Training Artifact Workflow Produce?
<!-- section-summary: A successful run ends after its required bundle is built, verified, durably published, identified, and made safe for downstream evaluation. -->

The complete workflow joins these storage, identity, publication, lineage, and lifecycle rules into one output contract for the training run.

Putting everything together:

```text
training request
      │
      ▼
assign training_run_id
      │
      ▼
resolve configuration
      │
      ▼
record input lineage
      │
      ▼
create attempt_id
      │
      ▼
start training
      │
      ├──── metrics
      ├──── logs
      └──── checkpoints
      │
      ▼
select final checkpoint
      │
      ▼
construct model bundle
      │
      ▼
write manifest + provenance
      │
      ▼
upload to staging
      │
      ▼
verify hashes/completeness
      │
      ▼
publish atomically in spirit
      │
      ▼
assign immutable model identity
      │
      ▼
mark training run successful
      │
      ▼
downstream evaluation
      │
      ▼
release review
      │
      ▼
registry / approval
      │
      ▼
deployment
```

Notice when training becomes successful:

Not merely after:

```text
optimizer finished its final step
```

but after:

```text
the required durable output contract exists
and can be consumed safely
```

That is a much stronger definition. The previous concepts now fit together elegantly.

### Training script

Defines the computation:

```text
HOW do we train
```

### Training configuration

Defines the recipe:

```text
WHICH training behavior do we want
```

### Training artifacts

Preserve the results:

```text
WHAT did that computation produce
```

So:

```text
          TRAINING SCRIPT
          "how it works"
                 │
                 ▼
Data ───────▶ TRAINING ◀────── Config
                 │
                 ▼
             Artifacts
          "what survived"
```

And the pipeline surrounds all of it:

```text
               PIPELINE
                  │
                  ▼
       choose data + config
                  │
                  ▼
         launch train script
                  │
                  ▼
          verify artifacts
                  │
                  ▼
        evaluate / register
```

A machine-learning model isn't really just a file. It is the result of a historical computation:

$$
M =
T(C,D,K,E,R)
$$

where:

```text
M = model
T = training program
C = code
D = data
K = configuration
E = environment
R = randomness
```

Training artifacts attempt to preserve enough information about that computation that another system—or another human months later—can answer:

```text
What was produced
Who produced it
From what
With which settings
Using which implementation
Did the production finish successfully
Is the output intact
Which retry generated it
Can training resume
Can this model be evaluated
Can this model be deployed
Can we reproduce or audit it
```

If your artifact system can reliably answer those questions, it is doing its job. The most useful mental model is:

```text
TRAINING IS TEMPORARY

        code
         +
        data
         +
       config
         │
         ▼
   ephemeral compute
         │
         ▼
────────────────────────
      ARTIFACT BOUNDARY
────────────────────────
         │
         ▼
    durable outputs
```

Those durable outputs should normally include:

```text
MODEL BUNDLE
The object we may eventually serve.

CHECKPOINTS
The state needed to recover training.

METRICS
Evidence of how the model performed.

RESOLVED CONFIG
The recipe actually used.

LINEAGE
Where code, data, and parent models came from.

MANIFEST
What files constitute the complete result.

IDENTITIES
Run ID, retry/attempt ID, model artifact ID.

COMPLETION STATE
A trustworthy indication that publication succeeded.
```

And the deepest principle is:

> **Training artifacts are the durable boundary between an ephemeral training computation and the rest of the ML system.**

The training job may disappear. The GPU may disappear. The container may disappear. The notebook session may disappear. But the **model, its meaning, its provenance, and the evidence needed to trust it must survive**.

![Six evidence types joining a verified committed bundle, which becomes a selected candidate for a separate release workflow.](/content-assets/articles/article-mlops-training-pipelines-logging-training-outputs-artifacts/release-ready-evidence-summary.png)

*The committed bundle gives a reviewer one trusted identity for the model and the evidence used to select it.*

## Check Your Answers

Use these short answers to revisit the reasoning behind each section.

:::expand[What Must Survive After a Training Machine Disappears?]{kind="recap"}
Training artifacts preserve the model bundle, checkpoints, metrics, provenance, and diagnostics needed after temporary compute is gone.
:::

:::expand[How Are Training Outputs Stored and Published Safely?]{kind="recap"}
Large immutable bytes, searchable metadata, and logs use suitable stores, while a staged and verified commit prevents partial bundles from appearing complete.
:::

:::expand[How Do Immutable Artifacts, Attempts, and Checkpoints Get Their Identities?]{kind="recap"}
Logical run IDs, attempt IDs, model IDs, immutable destinations, and checkpoint policies distinguish requested work from executions and durable results.
:::

:::expand[What Lineage and Model-Bundle Information Makes an Artifact Usable?]{kind="recap"}
Versioned data, code, resolved configuration, environment, signatures, label mappings, and secret-safe metadata preserve ancestry and interpretation.
:::

:::expand[How Are Candidate Creation, Evaluation, and Registry Promotion Separated?]{kind="recap"}
Training creates candidate evidence; separate evaluation and release authority decide whether an immutable candidate receives a lifecycle role.
:::

:::expand[How Do Retry-Safe Publishing and Artifact Tools Preserve History?]{kind="recap"}
Idempotent publication, content hashes, run trackers, artifact graphs, immutable versions, and mutable aliases preserve one trustworthy history across retries.
:::

:::expand[How Should Retention and Deletion Follow Artifact Meaning?]{kind="recap"}
Retention follows lifecycle value and lineage reachability, so released evidence outlives temporary logs and ordinary checkpoints.
:::

:::expand[What Does the Complete Training Artifact Workflow Produce?]{kind="recap"}
A successful run ends after its required bundle is built, verified, durably published, identified, and made safe for downstream evaluation.
:::

## References

[1]: https://mlflow.org/docs/latest/self-hosting/architecture/artifact-store/ "Artifact Stores | MLflow AI Platform"
[2]: https://www.mlflow.org/docs/latest/ml/tracking "ML Experiment Tracking | MLflow AI Platform"
[3]: https://mlflow.org/docs/latest/model "ML Models | MLflow AI Platform"
[4]: https://docs.wandb.ai/models/artifacts "Artifacts overview - Weights  Biases Documentation"
[5]: https://docs.wandb.ai/models/registry "Registry overview - Weights  Biases Documentation"
