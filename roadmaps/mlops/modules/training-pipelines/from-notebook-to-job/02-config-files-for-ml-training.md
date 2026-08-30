---
title: "Training Config Files"
description: "Use versioned training config files to control data snapshots, features, model settings, runtime resources, thresholds, and tracking metadata."
overview: "A training configuration system turns run choices into a validated, versioned input. It separates scientific settings from code, infrastructure, and secrets, then records one frozen effective configuration with every run."
tags: ["MLOps", "core", "training"]
order: 2
id: "article-mlops-training-pipelines-config-files-for-ml-training"
---

## Table of Contents

1. [What Does a Training Configuration Control?](#what-does-a-training-configuration-control)
2. [What Belongs in Code, the Training Recipe, Runtime Settings, and Secrets?](#what-belongs-in-code-the-training-recipe-runtime-settings-and-secrets)
3. [How Do You Keep Configuration Small and Validate It Early?](#how-do-you-keep-configuration-small-and-validate-it-early)
4. [How Do You Resolve, Freeze, and Record the Settings a Run Used?](#how-do-you-resolve-freeze-and-record-the-settings-a-run-used)
5. [How Does Configuration Explain Differences Between Training Runs?](#how-does-configuration-explain-differences-between-training-runs)
6. [How Should Configuration Names, Structure, and Compatibility Evolve?](#how-should-configuration-names-structure-and-compatibility-evolve)
7. [How Do Tests and Sweeps Reveal Which Values Should Be Configurable?](#how-do-tests-and-sweeps-reveal-which-values-should-be-configurable)
8. [How Does the Complete Configuration Workflow Support Reproducibility?](#how-does-the-complete-configuration-workflow-support-reproducibility)
9. [Check Your Answers](#check-your-answers)

Two training runs use the same code and dataset. One sets the learning rate to `0.001`; the other uses `0.0003`. The resulting models differ even though nobody changed the implementation. If those values live in an edited Python file or an unrecorded shell command, the team cannot explain which recipe produced either model.

A **training configuration** is the structured set of choices that selects one behavior from a general training program. It can describe the architecture, optimizer, batch size, training duration, data definition, and other values that legitimately vary between runs. It should not silently absorb machine names, temporary paths, or secret credentials just because all of them reach the same process.

The important artifact is the final configuration the program actually used. Defaults, a base file, an experiment file, and a command-line override may all contribute to it. The trainer must resolve those layers once, validate the result, freeze it, and record it before expensive work starts.

Keep these questions in view as the article moves from one training choice to a validated, frozen record of every value the run used:

1. **What Does a Training Configuration Control?**
2. **What Belongs in Code, the Training Recipe, Runtime Settings, and Secrets?**
3. **How Do You Keep Configuration Small and Validate It Early?**
4. **How Do You Resolve, Freeze, and Record the Settings a Run Used?**
5. **How Does Configuration Explain Differences Between Training Runs?**
6. **How Should Configuration Names, Structure, and Compatibility Evolve?**
7. **How Do Tests and Sweeps Reveal Which Values Should Be Configurable?**
8. **How Does the Complete Configuration Workflow Support Reproducibility?**

## What Does a Training Configuration Control?
<!-- section-summary: Training code defines the available behavior, while configuration selects the recipe used by one particular run. -->

Two runs can execute identical Python and still train different models because the selected values differ. Configuration gives those choices an explicit identity.

The easiest way to understand training configuration is to start with a simple observation:

> **The training program describes how training works. The training configuration describes which version of that training behavior we want for a particular run.**

Suppose your training program contains:

```python
model = Model(
    hidden_size=256,
    dropout=0.1,
)

optimizer = AdamW(
    model.parameters(),
    lr=0.001,
)

train(
    model,
    epochs=20,
    batch_size=64,
)
```

Nothing is technically wrong with this. But you've mixed two different things together:

```text
Training logic
──────────────
construct model
construct optimizer
iterate over batches
calculate loss
backpropagate
save model

Training choices
────────────────
hidden_size = 256
dropout = 0.1
learning_rate = 0.001
epochs = 20
batch_size = 64
```

The first category changes relatively slowly. The second category changes constantly. Training configuration exists because those two categories have different lifecycles. Imagine that, conceptually, your training system is a function:

$$
\text{model} = f(\text{data}, \text{code}, \text{configuration})
$$

Ignoring environment and randomness for a moment:

```text
                ┌──────────────┐
Data ──────────▶│              │
                │   Training   │──────▶ Model
Code ──────────▶│              │──────▶ Metrics
                │              │
Config ────────▶│              │
                └──────────────┘
```

The configuration answers questions such as:

```text
Which architecture
How large
Which optimizer
What learning rate
How many epochs
What batch size
Which loss function
Which augmentation strategy
When should training stop
```

So configuration can be thought of as:

**The parameterization of the training program.**

Your code says:

```python
optimizer = AdamW(
    model.parameters(),
    lr=config.optimizer.learning_rate
)
```

The configuration says:

```yaml
optimizer:
  learning_rate: 0.001
```

The code defines the possibility. The configuration selects the choice. Suppose you want to compare three experiments. Experiment A:

```python
learning_rate = 0.001
```

Experiment B:

```python
learning_rate = 0.0003
```

Experiment C:

```python
learning_rate = 0.0001
```

If those values live in the source code, every experiment becomes a source-code modification. You might end up with:

```text
commit A → learning rate 0.001
commit B → learning rate 0.0003
commit C → learning rate 0.0001
```

But none of the *training logic* changed. You were only selecting different parameters. A configuration file lets one version of the program execute many experiments:

```text
                 training code
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
     experiment A experiment B experiment C
       config        config        config
          │           │           │
          ▼           ▼           ▼
        Run A         Run B       Run C
```

For example:

```yaml
# experiment_a.yaml

learning_rate: 0.001
batch_size: 64
epochs: 20
```

and:

```yaml
# experiment_b.yaml

learning_rate: 0.0003
batch_size: 64
epochs: 20
```

Now:

```bash
python -m project.train --config experiment_a.yaml
```

and:

```bash
python -m project.train --config experiment_b.yaml
```

execute the same program with different training recipes. That's the fundamental value of configuration. This is where configuration systems often become messy. Suppose you create:

```yaml
learning_rate: 0.001
batch_size: 64

training_data: s3://company-prod-secret/data.parquet

aws_access_key: ABC123
aws_secret_key: XYZ789

gpu_type: A100
docker_image: company/train:v17

output_dir: /mnt/job-2784
run_id: 842919
```

You've put several fundamentally different concepts into one file. It helps to separate four categories.

## What Belongs in Code, the Training Recipe, Runtime Settings, and Secrets?
<!-- section-summary: Model choices, data choices, runtime placement, and credentials have different meanings, owners, and security requirements. -->

The word configuration can hide several unrelated concerns, so the first design task is to separate the scientific recipe from location, infrastructure, and credentials.

These settings define the actual learning experiment.

For example:

```yaml
model:
  hidden_size: 512
  num_layers: 6
  dropout: 0.1

optimizer:
  name: adamw
  learning_rate: 0.0003
  weight_decay: 0.01

training:
  batch_size: 128
  epochs: 30
```

If you changed one of these values, you'd reasonably say:

"I'm training a different model or using a different training recipe."

These are usually the core contents of a **training configuration**. Some data-related choices genuinely affect the experiment.

For example:

```yaml
data:
  max_sequence_length: 512
  sampling_strategy: balanced
  negative_ratio: 3
```

Changing them changes what the model sees. Those may belong in the experiment configuration. But something like:

```text
s3://ml-prod-eu-west-2/bucket-173923/train/part-003.parquet
```

is different. That's often an execution-time location rather than a modeling choice. A useful distinction is:

```text
"What data definition should I use?"

versus

"Where does today's copy of that data physically live?"
```

The first is often experiment configuration. The second is often runtime configuration. Now consider:

```text
number of GPUs
GPU type
CPU count
RAM
output directory
distributed-training hostnames
temporary directory
job ID
checkpoint mount
```

These describe **where and how the process is running**, not necessarily what model you're trying to train. For instance, these two runs might be scientifically equivalent:

```text
Run A
4 × A100 GPU

Run B
8 × A100 GPU
```

assuming the training algorithm correctly preserves effective batch size and optimization behavior. Therefore:

```yaml
gpu_count: 8
```

usually shouldn't be confused with:

```yaml
learning_rate: 0.0003
```

The former is infrastructure. The latter is training behavior. Secrets are different again:

```text
database passwords
API keys
cloud credentials
private registry tokens
service account credentials
```

A training configuration might be committed to Git:

```text
configs/production.yaml
```

Secrets generally should not be. So avoid:

```yaml
wandb_api_key: abc123...
database_password: hunter2
```

Instead, the execution environment supplies secrets through a secret manager, workload identity, environment variables, mounted credentials, or another secure mechanism.

Conceptually:

```text
           Training recipe
                 │
                 ▼
           training program
                 ▲
                 │
Runtime ─────────┤
Secrets ─────────┤
Data locations ──┘
```

The training program receives all these things. That doesn't mean they should all live in the same configuration file. You can think of one training run as being constructed from several layers:

```text
┌───────────────────────────────┐
│ CODE                          │
│ How training works            │
└───────────────────────────────┘

┌───────────────────────────────┐
│ TRAINING CONFIG               │
│ What training recipe to use   │
└───────────────────────────────┘

┌───────────────────────────────┐
│ DATA                          │
│ What examples to train on     │
└───────────────────────────────┘

┌───────────────────────────────┐
│ RUNTIME                       │
│ Where/how the job executes    │
└───────────────────────────────┘

┌───────────────────────────────┐
│ SECRETS                       │
│ Credentials needed at runtime │
└───────────────────────────────┘
```

Together they determine what actually happens. Separating them makes each component easier to reason about.

![Source code, run configuration, job specification, and secret references feeding one reviewed training execution and its identity record.](/content-assets/articles/article-mlops-training-pipelines-config-files-for-ml-training/training-setting-boundaries.png)

*The four inputs have different owners, yet their identities meet in the evidence for one training execution.*

## How Do You Keep Configuration Small and Validate It Early?
<!-- section-summary: A small declarative interface with type and relationship checks catches invalid recipes before data loading or accelerator allocation. -->

After the boundaries are clear, the public interface should stay as small as possible and reject mistakes before they consume expensive resources.

Configuration systems often become accidental programming languages. You might begin with:

```yaml
learning_rate: 0.001
batch_size: 64
```

and eventually reach:

```yaml
model:
  _target_: project.models.DynamicFactory

optimizer:
  _target_: ${lookup:${environment}:${model.type}}
  partial: true

values:
  merged:
    include:
      - ${path:${env:CONFIG_ROOT}/...}
```

Powerful configuration systems can be useful, but every abstraction has a cost. Keep this boundary clear:

**Configuration should describe choices, not become a second implementation of your program.**

If the business logic becomes complicated, put it in Python. For example, instead of:

```yaml
hidden_size: 256

if_model_is_large_and_gpu_count_gt_4:
  multiply_batch_size_by: 2
```

prefer:

```python
def calculate_batch_size(config, runtime):
    ...
```

Configuration should preferably remain declarative:

```yaml
model:
  size: large

training:
  batch_size_per_gpu: 32
```

Then code interprets it. Suppose your training function accepts:

```python
def train(config):
    ...
```

Then the fields of `config` form an interface.

For example:

```yaml
model:
  hidden_size: 256
  dropout: 0.1

training:
  epochs: 20
  batch_size: 64

optimizer:
  name: adamw
  learning_rate: 0.001
```

Your code expects that structure. So configuration behaves much like a function signature:

```python
train(
    hidden_size=256,
    dropout=0.1,
    epochs=20,
    batch_size=64,
    optimizer="adamw",
    learning_rate=0.001,
)
```

That means configuration deserves many of the same engineering practices as an API:

```text
clear names
documented meaning
types
validation
defaults
backward compatibility
versioning
```

A casual YAML file can quietly become one of the most important APIs in an ML system. Consider this:

```yaml
training:
  batch_size: -64
  epochs: 20

optimizer:
  learning_rate: "fast"
```

YAML itself may consider that perfectly valid syntax. But your training program shouldn't. A naïve program might do:

```text
launch expensive GPU
       ↓
download 400 GB dataset
       ↓
preprocess for 40 minutes
       ↓
initialize model
       ↓
discover batch_size = -64
       ↓
crash
```

That's wasteful.

Instead:

```text
load configuration
       ↓
parse
       ↓
validate
       ↓
only then access expensive resources
```

For example:

```python
class TrainingConfig:
    learning_rate: float
    batch_size: int
    epochs: int
```

And conceptually:

```text
learning_rate > 0
batch_size > 0
epochs >= 1
dropout between 0 and 1
optimizer ∈ {adam, adamw, sgd}
```

Then:

```text
invalid configuration
        ↓
fail in milliseconds
```

rather than:

```text
invalid configuration
        ↓
fail after $150 of GPU usage
```

This is one of the highest-return uses of configuration validation. Some invalid configurations are individually valid fields that make no sense together.

For example:

```yaml
scheduler:
  type: cosine

training:
  epochs: 0
```

Or:

```yaml
model:
  hidden_size: 513
  attention_heads: 8
```

when hidden size must be divisible by attention heads. Or:

```yaml
training:
  mixed_precision: fp16

runtime:
  device: cpu
```

if your implementation doesn't support that combination. So configuration validation has two levels. First:

```text
Field validation
────────────────
epochs is integer
dropout is float
optimizer is string
```

Then:

```text
Semantic validation
───────────────────
epochs > 0
0 ≤ dropout < 1
hidden_size % num_heads == 0
```

The second category is often more valuable.

## How Do You Resolve, Freeze, and Record the Settings a Run Used?
<!-- section-summary: Defaults, files, and explicit overrides must follow a documented precedence and produce one immutable resolved configuration before training begins. -->

Validation alone is insufficient when values arrive from several layers. The system also needs one deterministic answer to what the trainer actually received.

Suppose the code says:

```python
learning_rate = config.get("learning_rate", 0.001)
```

Your configuration says:

```yaml
batch_size: 64
```

What learning rate was used? `0.001`. But someone inspecting only the experiment file can't see that. Now imagine six months later the default changes:

```python
config.get("learning_rate", 0.0003)
```

The same config file now means something different. That's dangerous for reproducibility. There is an important distinction between:

### User configuration

What the user supplied:

```yaml
batch_size: 64
```

and:

### Resolved configuration

What training actually used:

```yaml
learning_rate: 0.001
batch_size: 64
epochs: 20
dropout: 0.1
optimizer: adamw
```

The resolved configuration should normally be recorded with the run. Suppose configuration comes from multiple places:

```text
library defaults
        ↓
base config
        ↓
experiment config
        ↓
command-line overrides
```

Then the file the user passed isn't necessarily the configuration the program actually used.

For example:

### defaults

```yaml
learning_rate: 0.001
batch_size: 32
epochs: 10
```

### config file

```yaml
batch_size: 64
epochs: 30
```

### command line

```bash
--override training.epochs=50
```

The actual training settings are:

```yaml
learning_rate: 0.001
batch_size: 64
epochs: 50
```

That final object is the **resolved configuration**. It should be treated as a first-class training artifact:

```text
run-827/
├── model.pt
├── metrics.json
├── logs/
├── checkpoints/
└── resolved_config.yaml
```

Now you can answer:

"What settings did this model actually use?"

without reconstructing history. Once configuration can come from multiple sources, you need a rule.

For example:

```text
lowest priority

built-in defaults
      ↓
base configuration
      ↓
experiment configuration
      ↓
command-line overrides

highest priority
```

Then:

```yaml
# default
batch_size: 32
```

is overridden by:

```yaml
# experiment
batch_size: 64
```

which is overridden by:

```bash
--override training.batch_size=128
```

giving:

```text
batch_size = 128
```

The exact precedence isn't important. The important part is that it is **deterministic and documented**. Otherwise you get debugging conversations like:

```text
"Why was the batch size 128?"

"I thought YAML said 64."

"The environment variable overrode it."

"Which environment variable?"

"I'm not sure."
```

That is a configuration system failure. Environment variables are useful for runtime concerns:

```bash
OUTPUT_DIR=/mnt/job/123
CUDA_VISIBLE_DEVICES=0,1
LOG_LEVEL=INFO
```

They're especially useful for secrets:

```text
API_TOKEN
DATABASE_PASSWORD
```

But they're dangerous as invisible experiment settings.

For example:

```bash
LEARNING_RATE=0.00001
```

If your training script silently reads that, you have hidden training state. Someone could run:

```bash
python train.py --config baseline.yaml
```

on two machines and receive different models because one shell happened to contain:

```text
LEARNING_RATE=0.00001
```

A useful rule is:

Use environment variables primarily for environment-specific concerns, not invisible model behavior.

And if an environment variable does affect the training recipe, put its resolved value into the recorded configuration. Overrides are convenient for experiments:

```bash
python -m model.train \
    --config configs/baseline.yaml \
    --set optimizer.learning_rate=0.0001
```

This is great for CI, sweeps, and quick experiments. But the run should record:

```yaml
optimizer:
  learning_rate: 0.0001
```

rather than merely storing:

```text
config = baseline.yaml
```

Otherwise your metadata claims the baseline config was used when it actually wasn't. Think of overrides as edits made **before the final configuration is frozen**:

```text
defaults
    +
config file
    +
overrides
    ↓
merge
    ↓
validate
    ↓
FINAL CONFIG
    ↓
record it
    ↓
train
```

That workflow is much easier to reason about. Ideally configuration resolution happens once. Bad architecture:

```text
training starts
   ↓
module A reads YAML
   ↓
module B reads environment variable
   ↓
module C applies another default
   ↓
module D modifies config
   ↓
training continues
```

Now there may not even be a single answer to:

"What was the configuration?"

Prefer:

```text
load
 ↓
merge
 ↓
resolve
 ↓
validate
 ↓
freeze
 ↓
record
 ↓
start training
```

Then everything receives the same immutable configuration object:

```python
model = build_model(config)
optimizer = build_optimizer(model, config)
trainer = Trainer(config)
```

A configuration shouldn't quietly mutate halfway through a run. Training state can change:

```text
current epoch
current learning rate
global step
best loss
```

but that is **runtime state**, not necessarily the original training recipe.

## How Does Configuration Explain Differences Between Training Runs?
<!-- section-summary: The resolved configuration connects a model artifact to the exact recipe used alongside code, data, environment, randomness, and hardware. -->

That frozen object becomes useful evidence when two apparently similar runs produce different outcomes.

Suppose you configure:

```yaml
optimizer:
  learning_rate: 0.001

scheduler:
  type: cosine
```

At epoch 14 the actual learning rate might be:

```text
0.000372
```

Did the configuration change? No. The configuration specified:

```text
initial learning rate = 0.001
scheduler = cosine
```

The trainer's state evolved according to that recipe. This distinction matters:

```text
CONFIGURATION
─────────────
what should happen

STATE
─────
what is currently happening
```

Examples of state:

```text
epoch = 14
global_step = 47,292
current_lr = 0.000372
best_validation_loss = 0.183
```

State belongs in checkpoints and logs. Recipe configuration belongs in the resolved training configuration. Suppose you discover:

```text
fraud_model_v87.pt
```

What generated it? Ideally you can trace:

```text
model artifact
      │
      ▼
training run 84721
      │
      ├── code commit: f19ab62
      ├── dataset version: 2026-08-17
      ├── resolved config
      ├── container image
      └── metrics
```

For example:

```yaml
model:
  architecture: transformer
  hidden_size: 512
  num_layers: 8
  dropout: 0.1

optimizer:
  name: adamw
  learning_rate: 0.0003
  weight_decay: 0.01

training:
  batch_size: 64
  epochs: 30
  seed: 42
```

This transforms configuration from a convenience into **provenance**. Now the question:

"Why is model B different from model A?"

becomes answerable. Suppose:

```text
Run 421
validation accuracy = 91.3%

Run 422
validation accuracy = 89.7%
```

Your first question should often be:

```text
What differed
```

If you've recorded resolved configurations, you can compare:

```diff
 optimizer:
-  learning_rate: 0.001
+  learning_rate: 0.0003

 training:
   batch_size: 64
   epochs: 20
```

Excellent. You've immediately identified one experimental difference. But configuration comparison alone isn't sufficient. You may also need:

```text
code commit
dataset version
random seed
runtime/library versions
hardware
```

Which leads to a deeper principle:

$$
\text{Training reproducibility}
\neq
\text{configuration alone}
$$

More accurately:

$$
R =
f(
C,
D,
S,
E,
H
)
$$

where roughly:

```text
C = code
D = data
S = settings
E = environment
H = hardware/runtime behavior
```

The configuration captures only one important part.

![Configuration layers resolved and validated once, frozen as canonical bytes, hashed, and matched across submission, worker, tracker, and model artifact.](/content-assets/articles/article-mlops-training-pipelines-config-files-for-ml-training/effective-config-identity.png)

*A shared digest proves that every boundary used the same resolved training recipe.*

## How Should Configuration Names, Structure, and Compatibility Evolve?
<!-- section-summary: Semantic field names, concept-based grouping, deliberate schema changes, and separate model compatibility rules keep old runs understandable. -->

As more people and automated systems depend on the schema, names and compatibility rules become part of a maintained interface rather than casual YAML structure.

Consider:

```yaml
x: 512
n: 8
p: 0.1
```

A computer can read that. A human six months later cannot. Prefer:

```yaml
model:
  hidden_size: 512
  attention_heads: 8
  dropout_probability: 0.1
```

Also avoid values whose meaning depends heavily on undocumented conventions:

```yaml
mode: 3
```

Prefer:

```yaml
sampling_strategy: hard_negative
```

Configuration is documentation as well as input. A good configuration file should give an experienced engineer a rough picture of the training experiment without requiring them to inspect the implementation. Flat configurations can become difficult:

```yaml
hidden_size: 512
dropout: 0.1
learning_rate: 0.001
weight_decay: 0.01
batch_size: 64
epochs: 20
scheduler_type: cosine
warmup_steps: 500
max_sequence_length: 1024
```

Grouping reflects system boundaries:

```yaml
model:
  hidden_size: 512
  dropout: 0.1

optimizer:
  name: adamw
  learning_rate: 0.001
  weight_decay: 0.01

scheduler:
  name: cosine
  warmup_steps: 500

training:
  batch_size: 64
  epochs: 20

data:
  max_sequence_length: 1024
```

This makes configuration easier to understand, validate, evolve, and compare. But avoid excessive nesting:

```text
training.algorithm.optimizer.settings.learning_rate.value
```

Structure should clarify concepts, not display cleverness. You could build configuration using:

```text
plain YAML + dataclasses
JSON
TOML
Pydantic
OmegaConf
Hydra
gin-config
custom Python objects
```

The library is secondary. First decide what properties you need. For a modest project:

```text
YAML
 ↓
typed schema
 ↓
validation
 ↓
immutable resolved object
```

may be enough. For a large research environment you might need:

```text
configuration composition
inheritance
experiment variants
CLI overrides
parameter sweeps
nested schemas
```

A more sophisticated library may then make sense. Choose the tool from the requirements. Don't design the architecture around whichever configuration library happens to be fashionable. Suppose you have:

```yaml
# base.yaml

model:
  hidden_size: 512

training:
  epochs: 20
  batch_size: 64

optimizer:
  name: adamw
  learning_rate: 0.001
```

And:

```yaml
# large_model.yaml

inherits: base.yaml

model:
  hidden_size: 1024
```

This avoids duplication. But eventually you can create:

```text
base.yaml
  ↓
gpu.yaml
  ↓
transformer.yaml
  ↓
production.yaml
  ↓
experiment_17.yaml
  ↓
CLI override
```

Now reading `experiment_17.yaml` tells you almost nothing about the actual experiment. This is another reason to always save the **fully resolved config**. Composition may be convenient for humans. Resolved configuration is the truth consumed by the training run. Suppose version 1 looked like:

```yaml
learning_rate: 0.001
```

Later you support different learning rates:

```yaml
optimizer:
  learning_rate: 0.001
```

What happens to old configurations? If you simply change the parser, old experiment files may stop working. There are several reasonable strategies. One is configuration versioning:

```yaml
config_version: 2

optimizer:
  learning_rate: 0.001
```

Then:

```python
if config_version == 1:
    migrate_v1_to_v2(...)
```

Another is simply having explicit backwards-compatible parsing for a while. The deeper principle is:

**Configuration formats are interfaces, and interfaces eventually acquire users.**

Those users may be:

```text
your teammates
CI pipelines
hyperparameter sweeps
scheduled jobs
old experiments
automation systems
```

So schema changes shouldn't be treated casually. Consider changing:

```yaml
model:
  hidden_size: 512
```

to:

```yaml
model:
  hidden_size: 1024
```

The config parser may support both perfectly. But a checkpoint produced using `512` might not load into the `1024` model. These are different concerns:

```text
Configuration schema compatibility
    "Can I understand this config?"

Checkpoint/model compatibility
    "Can I load this old model?"

Training behavior compatibility
    "Will this setting still mean the same thing?"
```

All three matter as training systems mature.

## How Do Tests and Sweeps Reveal Which Values Should Be Configurable?
<!-- section-summary: Parser tests, tiny training runs, managed-job tests, and parameter sweeps expose both invalid settings and values that truly vary between runs. -->

Tests verify that the interface works, while sweeps reveal why experiment choices must be parameterized without exposing every implementation detail.

Just like the training program itself, configuration deserves multiple levels of testing.

### Level 1: parser/schema tests

Does this work?

```yaml
training:
  epochs: 5
```

Does this fail?

```yaml
training:
  epochs: banana
```

Does this fail?

```yaml
training:
  epochs: -10
```

These tests should be extremely fast.

### Level 2: training smoke test

Run tiny training using a real configuration:

```bash
python -m project.train \
    --config tests/configs/smoke.yaml \
    --train-data tests/data/tiny.parquet
```

The configuration might contain:

```yaml
model:
  hidden_size: 32

training:
  batch_size: 2
  epochs: 1
```

Now you're verifying:

```text
config loads
   ↓
config validates
   ↓
model constructor understands it
   ↓
optimizer understands it
   ↓
training loop understands it
   ↓
run finishes
```

### Level 3: managed-job test

Finally execute the configuration using the real training platform. This catches issues such as:

```text
config file not included in container
wrong working directory
storage paths
environment-variable resolution
serialization differences
secret injection
CLI quoting
job-launcher overrides
```

The configuration system should behave consistently whether training runs:

```text
locally
CI
managed cloud training
```

Suppose you want to test:

```text
learning rate:
    0.001
    0.0003
    0.0001

batch size:
    32
    64
```

That's six experiments. A sweep system can generate:

```text
Run 1: lr=.001,  batch=32
Run 2: lr=.001,  batch=64
Run 3: lr=.0003, batch=32
Run 4: lr=.0003, batch=64
Run 5: lr=.0001, batch=32
Run 6: lr=.0001, batch=64
```

Then each run invokes exactly the same training program:

```text
                    train.py

                      ▲
          ┌───────────┼───────────┐
          │           │           │
       config 1    config 2   ... config 6
```

This only works cleanly when training behavior is properly parameterized. If the learning rate is buried in Python:

```python
lr = 0.001
```

your sweep infrastructure has to modify source code. That's a strong signal that the value belongs in configuration. Once configuration becomes useful, there is a temptation to make every implementation detail configurable.

For example:

```yaml
relu_in_layer_1: true
use_bias_in_layer_3: false
matmul_strategy_7: tiled
internal_buffer_size: 918
```

This creates a massive public interface. Every configurable field now becomes something you may need to:

```text
validate
document
support
version
compare
reason about
```

A better principle is:

**Expose a setting when different legitimate runs are expected to choose different values.**

If something is simply an implementation decision, keep it in code.

For example:

```python
def build_attention(...):
    # implementation detail
```

not necessarily:

```yaml
attention_internal_projection_loop_strategy: ...
```

The smallest sufficient configuration is often the most maintainable. Ask:

Would I want to change this without changing the training algorithm

If yes, configuration is a strong candidate.

For example:

```text
learning rate        → probably config
batch size           → probably config
number of layers     → probably config
dropout              → probably config
scheduler            → probably config
```

Now ask:

Is this merely where today's job happens to run

Then it's more likely runtime information.

```text
Kubernetes pod name     → runtime
temporary disk path     → runtime
GPU hostname            → runtime
job attempt number      → runtime
```

Ask:

Is it confidential

Then it's a secret.

```text
API key                 → secret
database password       → secret
cloud credential        → secret
```

And ask:

Is this how the algorithm itself is implemented

Then it likely belongs in code.

## How Does the Complete Configuration Workflow Support Reproducibility?
<!-- section-summary: A reproducible workflow loads, merges, resolves, validates, freezes, records, and then uses one configuration object throughout the run. -->

The final workflow connects all of these controls to the run record so the model's recipe remains available after the original config machinery changes.

A moderately sized project could use:

```text
project/
│
├── configs/
│   ├── base.yaml
│   ├── small.yaml
│   └── large.yaml
│
├── src/project/
│   ├── config.py
│   ├── model.py
│   ├── training.py
│   └── train.py
│
└── tests/
    └── configs/
```

`config.py` handles:

```text
loading
merging
validation
defaults
schema
serialization
```

`model.py` handles:

```text
model implementation
```

`training.py` handles:

```text
training algorithm
```

`train.py` coordinates everything.

Conceptually:

```python
def main():
    args = parse_args()

    config = load_config(args.config)
    config = apply_overrides(config, args.overrides)
    config = validate_and_resolve(config)

    save_config(config, args.output_dir)

    train(config, args)
```

The critical order is:

```text
LOAD
 ↓
MERGE
 ↓
RESOLVE
 ↓
VALIDATE
 ↓
RECORD
 ↓
TRAIN
```

Let's put the whole process together. A user launches:

```bash
python -m recommender.train \
    --config configs/large.yaml \
    --train-data s3://datasets/v42/train \
    --output-dir s3://runs/8921 \
    --set optimizer.learning_rate=0.0003
```

Your program starts with defaults:

```yaml
model:
  dropout: 0.1

optimizer:
  name: adamw
  learning_rate: 0.001

training:
  batch_size: 32
  epochs: 10
```

Then loads `large.yaml`:

```yaml
model:
  hidden_size: 1024
  num_layers: 12

training:
  batch_size: 64
  epochs: 30
```

Then applies:

```text
optimizer.learning_rate = 0.0003
```

The resolved configuration becomes:

```yaml
model:
  hidden_size: 1024
  num_layers: 12
  dropout: 0.1

optimizer:
  name: adamw
  learning_rate: 0.0003

training:
  batch_size: 64
  epochs: 30
```

Then:

```text
validate types
      ↓
validate constraints
      ↓
freeze configuration
      ↓
save resolved_config.yaml
      ↓
initialize expensive resources
      ↓
load training data
      ↓
construct model
      ↓
train
      ↓
save metrics/model
```

The run directory might end up as:

```text
runs/8921/
│
├── resolved_config.yaml
├── model.pt
├── metrics.json
├── metadata.json
└── checkpoints/
```

And metadata might identify:

```text
code commit
dataset version
container image
training platform
random seed
```

Together, those artifacts explain what happened. Recall the training pipeline:

```text
Prepare Data
     ↓
Train Model
     ↓
Evaluate
     ↓
Register
     ↓
Deploy
```

A pipeline might launch many training runs:

```text
                  Training Pipeline
                        │
           ┌────────────┼─────────────┐
           ▼            ▼             ▼
      baseline       candidate A   candidate B
       config          config        config
           │            │             │
           ▼            ▼             ▼
         train         train          train
```

The orchestration system doesn't need separate Python programs for each experiment.

Instead:

```text
one implementation
+
different configurations
=
different training runs
```

This makes configuration one of the primary interfaces between **experiment definition** and **pipeline execution**. Imagine someone says:

"Retrain exactly the model we deployed three months ago."

A weak system has:

```text
model.pt
```

Maybe someone remembers roughly how it was trained. A better system has:

```text
model.pt
config.yaml
```

A much stronger system has:

```text
code commit
dataset version
resolved configuration
random seed
dependency/container version
training environment metadata
```

Now the training run is closer to a reproducible computation:

$$
\text{Artifact}
=
f(
\text{code},
\text{data},
\text{resolved config},
\text{environment},
\text{randomness}
)
$$

The configuration file is therefore not merely a convenience for avoiding hard-coded constants. It is part of the **identity and provenance of a model**. A useful hierarchy is:

```text
CODE
"What training machinery exists?"

DATA
"What examples are available?"

CONFIGURATION
"Which training recipe should we use?"

RUNTIME
"Where/how should this job execute?"

SECRETS
"What credentials does this environment need?"

STATE
"How far has the currently running job progressed?"
```

Keeping those concepts separate dramatically simplifies training systems. The core configuration workflow is:

```text
human / pipeline
      │
      ▼
select base configuration
      │
      ▼
apply experiment configuration
      │
      ▼
apply explicit overrides
      │
      ▼
resolve defaults
      │
      ▼
validate
      │
      ▼
freeze
      │
      ▼
record final configuration
      │
      ▼
start training
      │
      ▼
model + metrics + config + metadata
```

So the deepest principle is:

> **A training configuration is a declarative description of the training recipe that turns one general training program into one specific training experiment.**

The source config is what you **asked for**. The resolved config is what the system **actually used**. And for reproducibility, debugging, experiment comparison, and pipeline automation, the second one is the artifact that ultimately matters most.

![Eight-step training configuration workflow from reviewed settings and precedence through validation, preflight, freezing, job start, and recording the configuration digest with run artifacts.](/content-assets/articles/article-mlops-training-pipelines-config-files-for-ml-training/training-config-workflow-summary.png)

*Run settings, runtime resources, and secret resolution remain separate while one validated recipe follows the job.*

## Check Your Answers

Use these short answers to revisit the reasoning behind each section.

:::expand[What Does a Training Configuration Control?]{kind="recap"}
Training code defines the available behavior, while configuration selects the recipe used by one particular run.
:::

:::expand[What Belongs in Code, the Training Recipe, Runtime Settings, and Secrets?]{kind="recap"}
Model choices, data choices, runtime placement, and credentials have different meanings, owners, and security requirements.
:::

:::expand[How Do You Keep Configuration Small and Validate It Early?]{kind="recap"}
A small declarative interface with type and relationship checks catches invalid recipes before data loading or accelerator allocation.
:::

:::expand[How Do You Resolve, Freeze, and Record the Settings a Run Used?]{kind="recap"}
Defaults, files, and explicit overrides must follow a documented precedence and produce one immutable resolved configuration before training begins.
:::

:::expand[How Does Configuration Explain Differences Between Training Runs?]{kind="recap"}
The resolved configuration connects a model artifact to the exact recipe used alongside code, data, environment, randomness, and hardware.
:::

:::expand[How Should Configuration Names, Structure, and Compatibility Evolve?]{kind="recap"}
Semantic field names, concept-based grouping, deliberate schema changes, and separate model compatibility rules keep old runs understandable.
:::

:::expand[How Do Tests and Sweeps Reveal Which Values Should Be Configurable?]{kind="recap"}
Parser tests, tiny training runs, managed-job tests, and parameter sweeps expose both invalid settings and values that truly vary between runs.
:::

:::expand[How Does the Complete Configuration Workflow Support Reproducibility?]{kind="recap"}
A reproducible workflow loads, merges, resolves, validates, freezes, records, and then uses one configuration object throughout the run.
:::
