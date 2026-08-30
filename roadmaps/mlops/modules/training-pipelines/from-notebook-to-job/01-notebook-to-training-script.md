---
title: "Training Scripts"
description: "Turn exploratory notebook work into a versioned Python training entrypoint with clear functions, inputs, outputs, exit behaviour, and tests."
overview: "A production training program makes notebook state explicit through data, configuration, dependency, and output contracts, then exposes one package entrypoint that runs consistently on a laptop, in CI, and as a managed training job."
tags: ["MLOps", "core", "training"]
order: 1
id: "article-mlops-training-pipelines-notebook-to-training-script"
---

## Table of Contents

1. [Why Does Notebook Training Need a Program Boundary?](#why-does-notebook-training-need-a-program-boundary)
2. [What Inputs and Outputs Define One Training Run?](#what-inputs-and-outputs-define-one-training-run)
3. [How Do You Turn Stable Notebook Steps into Testable Functions?](#how-do-you-turn-stable-notebook-steps-into-testable-functions)
4. [How Does One Command Describe a Complete Training Run?](#how-does-one-command-describe-a-complete-training-run)
5. [How Does Packaging Make Training Portable?](#how-does-packaging-make-training-portable)
6. [How Does a Training Program Support Safe Retries and Automation?](#how-does-a-training-program-support-safe-retries-and-automation)
7. [How Do You Test Training Without Running the Full Workload Every Time?](#how-do-you-test-training-without-running-the-full-workload-every-time)
8. [Where Does the Training Program Fit in the Pipeline?](#where-does-the-training-program-fit-in-the-pipeline)
9. [Check Your Answers](#check-your-answers)

A notebook trains a useful fraud model on one engineer's laptop. The engineer ran several cells out of order, downloaded one file by hand, and already had a package installed in the active kernel. When a scheduled runner opens the same notebook in a fresh environment, the data path is missing and the model object does not exist.

The problem is not that notebooks are poor tools. They are excellent for exploring data, changing an idea, and inspecting the result immediately. A scheduled training job has a different responsibility: it must start from nothing, receive every required input, run the full computation, publish durable outputs, and finish with an unambiguous success or failure result.

A **training program** creates that boundary. It turns the stable parts of an experiment into importable functions and one executable command. The same command can then run on a laptop, in CI, inside a container, or on managed compute without depending on hidden notebook state.

Use the questions below to follow the change from an interactive experiment to a program that a scheduler can run and trust:

1. **Why Does Notebook Training Need a Program Boundary?**
2. **What Inputs and Outputs Define One Training Run?**
3. **How Do You Turn Stable Notebook Steps into Testable Functions?**
4. **How Does One Command Describe a Complete Training Run?**
5. **How Does Packaging Make Training Portable?**
6. **How Does a Training Program Support Safe Retries and Automation?**
7. **How Do You Test Training Without Running the Full Workload Every Time?**
8. **Where Does the Training Program Fit in the Pipeline?**

## Why Does Notebook Training Need a Program Boundary?
<!-- section-summary: Notebook exploration can rely on interactive state, while an automated run must rebuild every required input and decision inside a fresh process. -->

A notebook can produce a good model and still be impossible for a scheduler to reproduce. The difference is whether the computation can explain everything it needs after the interactive session is gone.

A training pipeline is easier to understand if we begin with one question:

**What must be true for a computer to train a model reliably without a human sitting in front of it?**

The answer leads naturally from notebooks to training scripts, packaging, retries, testing, and managed training jobs. At the lowest level, training is a computation.

Conceptually:

$$
\text{Training Result}
=
f(
\text{code},
\text{data},
\text{configuration},
\text{environment},
\text{randomness}
)
$$

For example:

```text
code:
    model.py
    train.py

data:
    s3://bucket/train.parquet
    s3://bucket/validation.parquet

configuration:
    learning_rate = 0.001
    batch_size = 64
    epochs = 20

environment:
    Python 3.12
    PyTorch 2.x
    CUDA
    GPU type

randomness:
    seed = 42
```

The output might be:

```text
model.pt
metrics.json
training.log
checkpoints/
```

So a training system fundamentally needs a contract:

```text
explicit inputs
      ↓
training program
      ↓
explicit outputs
```

That sounds obvious, but notebooks often violate this contract in subtle ways. Imagine you are developing a model. You might start with:

```python
df = load_data()

df = clean_data(df)

model = MyModel()

model.fit(df)
```

Then discover something strange. You inspect distributions:

```python
df["age"].hist()
```

Change the preprocessing. Run another cell. Change the learning rate. Run only the training cell again. Inspect predictions. This is exactly what notebooks are good at. Their fundamental optimization target is:

**minimize the time between having an idea and seeing the result.**

A notebook lets you keep objects in memory and manipulate them interactively.

```text
idea
 ↓
change one cell
 ↓
run it
 ↓
inspect result
 ↓
new idea
```

This is extremely useful during research. But automation has almost the opposite requirement. A pipeline wants:

```text
start from nothing
 ↓
execute everything
 ↓
produce result
 ↓
terminate
```

A notebook contains **interactive state**. A training job needs **reconstructible state**. That difference is the reason training scripts exist. Suppose your notebook contains:

```python
model = Model(hidden_size=256)
```

Later you run:

```python
model = Model(hidden_size=512)
```

Then perhaps you rerun an earlier cell but not another one. What exactly produced the final model? It may depend on:

```text
which cells were run
their execution order
variables already in memory
files manually downloaded earlier
environment variables
your current working directory
an authentication session
library versions
random seeds
```

A human can often mentally compensate for these things. A pipeline cannot. A machine needs:

```text
Input A
Input B
Input C
↓
Program
↓
Output
```

with no invisible prerequisites. So the first engineering step is not actually "convert notebook to Python." It is:

**Make the computation explicit.**

## What Inputs and Outputs Define One Training Run?
<!-- section-summary: One training run is a computation over explicit code, data, configuration, environment, randomness, and output destinations. -->

Once hidden state is removed, the next job is to state the run contract in both directions: what enters the program and what must survive after it exits.

Consider this notebook code:

```python
df = pd.read_parquet("../data/train.parquet")

model = Model(
    hidden_size=256,
    dropout=0.1
)

train(model, df)

torch.save(model.state_dict(), "../models/model.pt")
```

Several assumptions are hidden inside it. Where did `../data/train.parquet` come from? Why `256`? Where should the model be stored? What happens if another training run executes simultaneously? A proper training program should receive these things from outside.

Conceptually:

```text
train(
    training_data,
    validation_data,
    training_configuration,
    output_location
)
```

For example:

```bash
python -m fraud_model.train \
    --train-data /data/train.parquet \
    --validation-data /data/validation.parquet \
    --config configs/baseline.yaml \
    --output-dir /outputs/run-123
```

Now someone who has never opened your notebook can understand what the program requires. This is a major principle of production ML:

> **Anything required to reproduce a run should either be an explicit input or part of the versioned execution environment.**

The same reasoning applies in the opposite direction. A bad training program might simply print:

```text
accuracy: 0.917
```

and leave a mysterious `model.pkl` somewhere. A pipeline needs outputs other programs can consume.

For example:

```text
/outputs/run-123/
    model.pt
    metrics.json
    training_config.json
    artifact_manifest.json
```

`metrics.json` might contain:

```json
{
  "validation_loss": 0.184,
  "validation_accuracy": 0.917
}
```

Now the next pipeline stage can mechanically ask:

```text
Is validation_accuracy > 0.90
```

and, if so:

```text
register model
```

The pipeline becomes compositional:

```text
prepare data
    ↓
train model
    ↓
evaluate model
    ↓
register model
    ↓
deploy model
```

Each stage communicates through explicit artifacts rather than human interpretation.

![Four contracts feeding one training program: immutable data, resolved configuration, pinned dependencies, and a verified output bundle.](/content-assets/articles/article-mlops-training-pipelines-notebook-to-training-script/training-program-contracts.png)

*Explicit contracts let tests validate every declared training input and every required output.*

## How Do You Turn Stable Notebook Steps into Testable Functions?
<!-- section-summary: Stable preparation, model construction, training, and evaluation logic moves into functions whose arguments and return values expose the data flow. -->

Explicit inputs are useful only if the stable calculation is also separated from cell order and mutable notebook objects.

During experimentation, code changes rapidly. Eventually some pieces stop changing. Perhaps this:

```python
df["amount_log"] = np.log1p(df["amount"])
df["age_days"] = ...
df = df.dropna(...)
```

has become your accepted preprocessing logic. That logic should leave the notebook.

Instead:

```python
def prepare_features(df):
    ...
    return features
```

Likewise:

```python
def build_model(config):
    ...
    return model
```

and:

```python
def train_model(model, train_loader, config):
    ...
    return training_metrics
```

Why functions? Because functions introduce explicit boundaries. Instead of:

```text
some notebook state
      ↓
more notebook state
```

you get:

```text
input
 ↓
function
 ↓
output
```

And functions are much easier to test. You can test:

```python
features = prepare_features(example_dataframe)
```

without performing an entire six-hour training run. A useful progression is therefore:

```text
exploratory cells
       ↓
logic becomes stable
       ↓
extract functions
       ↓
compose functions into program
```

The notebook can still exist. It simply stops being the authoritative implementation.

## How Does One Command Describe a Complete Training Run?
<!-- section-summary: A single entrypoint turns the complete run into one observable process while keeping execution arguments separate from the training recipe. -->

Those functions need one process boundary that a person, test runner, or scheduler can invoke in exactly the same way.

This is one of the most important transitions. You should eventually be able to say:

```bash
python -m my_project.train ...
```

and have that command execute the entire training computation from beginning to end.

Conceptually:

```python
def main():
    args = parse_args()
    config = load_config(args.config)

    train_data = load_data(args.train_data)
    val_data = load_data(args.validation_data)

    model = build_model(config)

    metrics = train_model(
        model,
        train_data,
        val_data,
        config,
    )

    save_model(model, args.output_dir)
    save_metrics(metrics, args.output_dir)


if __name__ == "__main__":
    main()
```

The important property isn't the exact Python structure. It's this:

There is now a single process whose execution represents one complete training run.

That process boundary is tremendously valuable. The operating system, Docker, Kubernetes, Airflow, SageMaker, Vertex AI, Azure ML, Slurm, or another scheduler can now treat training as:

```text
start process
monitor process
process succeeds or fails
collect outputs
```

Your orchestration infrastructure does not need to understand your neural network. It only needs to understand the program contract. There are usually two different categories of inputs, and mixing them creates confusion. Suppose you have:

```bash
python train.py \
    --learning-rate 0.001 \
    --hidden-size 256 \
    --dropout 0.1 \
    --batch-size 64 \
    --epochs 20 \
    --optimizer adamw \
    --weight-decay 0.01 \
    --train-data ...
```

This can work, but eventually becomes unwieldy. It's useful to distinguish **execution parameters** from **training configuration**.

| Execution arguments  | Training configuration |
| -------------------- | ---------------------- |
| Input data location  | Learning rate          |
| Output directory     | Batch size             |
| Config file location | Architecture           |
| Run ID               | Optimizer              |
| Checkpoint location  | Number of epochs       |
| Resume flag          | Regularization         |

Then your command becomes:

```bash
python -m fraud_model.train \
    --train-data /data/train.parquet \
    --validation-data /data/validation.parquet \
    --config configs/model_v3.yaml \
    --output-dir /outputs/run-123
```

And:

```yaml
learning_rate: 0.001
batch_size: 64
epochs: 20

model:
  hidden_size: 256
  dropout: 0.1

optimizer:
  name: adamw
  weight_decay: 0.01
```

This gives you a clean separation. The command answers:

**Where and how is this run being executed?**

The configuration answers:

**What experiment are we running?**

It also makes experiments easy to compare:

```text
baseline.yaml
larger_model.yaml
higher_dropout.yaml
experiment_017.yaml
```

## How Does Packaging Make Training Portable?
<!-- section-summary: An installable project and pinned environment let the same training code travel independently of a developer's directory and machine. -->

A command remains tied to one laptop if imports, dependencies, and paths depend on that laptop's layout, so portability has to include packaging and the runtime environment.

A notebook often gets away with things like:

```python
sys.path.append("../src")
```

or:

```python
from utils import something
```

Production jobs shouldn't depend on your laptop's directory structure. Instead, package the project.

For example:

```text
fraud-model/
│
├── pyproject.toml
├── configs/
│   └── baseline.yaml
│
├── src/
│   └── fraud_model/
│       ├── __init__.py
│       ├── data.py
│       ├── model.py
│       ├── training.py
│       └── train.py
│
└── tests/
```

Then:

```python
from fraud_model.data import load_training_data
from fraud_model.model import FraudModel
```

works consistently on:

```text
your laptop
CI
a Docker container
a cloud training machine
a Kubernetes pod
```

The broader principle is:

> **Training code should travel independently of the computer on which it was written.**

Usually you eventually package not only the Python code, but its environment too:

```text
code
+
dependencies
+
system libraries
+
runtime
```

often with a container. This removes another category of hidden state. This is perhaps the deepest architectural point. Imagine a pipeline system launching this:

```bash
python -m fraud_model.train \
    --train-data s3://... \
    --config s3://... \
    --output-dir s3://...
```

The pipeline does **not** need to know:

```text
how PyTorch autograd works
how your batching works
what architecture you use
how you calculate loss
which optimizer you selected
```

Those are responsibilities of the training program. The pipeline only needs to know:

```text
inputs
command
resources
outputs
success/failure
```

So the training script becomes an abstraction boundary:

```text
             PIPELINE
                │
       input locations/config
                │
                ▼
       ┌─────────────────┐
       │ Training Program │
       │                 │
       │ ML implementation│
       └─────────────────┘
                │
                ▼
        artifacts + metrics
```

This separation keeps pipeline code from becoming tangled with model code.

![One logical training run branching into a failed upload attempt and a successful retry that verifies and conditionally commits one immutable result.](/content-assets/articles/article-mlops-training-pipelines-notebook-to-training-script/retry-safe-training-run.png)

*Separate attempt workspaces and a single committed manifest keep retries from mixing partial and complete outputs.*

## How Does a Training Program Support Safe Retries and Automation?
<!-- section-summary: Attempt-specific outputs, completion markers, checkpoints, structured logs, and exit codes make retries safe and results machine-readable. -->

Long training jobs will eventually encounter lost machines or interrupted connections. The program contract therefore has to define progress, partial output, and completion clearly.

Now suppose your model trains for four hours. At hour three, the machine disappears. A pipeline scheduler may retry the job. That's useful only if rerunning the training program is safe. Consider dangerous behavior:

```python
database.execute("INSERT INTO experiments ...")
upload_model("models/current/model.pt")
delete_old_model()
```

If the job is executed twice, those side effects may cause problems. A better model is:

```text
run-137/
    checkpoint/
    model.pt
    metrics.json
```

Each training run gets its own output location. The job can write temporary artifacts first:

```text
run-137/in-progress/
```

and only mark the result complete after everything succeeds.

Conceptually:

```text
START
  ↓
write/checkpoint
  ↓
train
  ↓
write model
  ↓
write metrics
  ↓
write SUCCESS marker
```

If the machine dies before the final step, downstream jobs know that the run is incomplete. For expensive training, checkpoints add another property:

```text
start run
  ↓
epoch 1
  ↓ checkpoint
epoch 2
  ↓ checkpoint
machine fails
  ↓
retry
  ↓
resume from checkpoint
```

This principle is often called **idempotency** or retry safety. Perfect bit-for-bit reproducibility isn't always possible—GPU algorithms and distributed training can introduce nondeterminism—but operationally, rerunning the job should not corrupt the system. Humans like:

```text
Epoch 12 looks pretty good!
```

Automation prefers:

```text
epoch=12
train_loss=0.219
validation_loss=0.247
learning_rate=0.0003
```

Training systems generally need three kinds of observability. There are logs for understanding what happened, metrics for understanding model behavior, and a final process result for determining whether the run succeeded.

For example:

```python
logger.info(
    "epoch=%d train_loss=%f validation_loss=%f",
    epoch,
    train_loss,
    validation_loss,
)
```

The program should also obey the standard process convention:

```text
exit code 0     → success
non-zero        → failure
```

That seems primitive, but it is extremely powerful. The orchestration system can simply observe:

```text
training process exited 0
```

and move to:

```text
evaluation
```

Otherwise:

```text
retry / alert / stop pipeline
```

A useful final artifact is a manifest:

```json
{
  "status": "success",
  "model": "model.pt",
  "metrics": "metrics.json",
  "best_checkpoint": "checkpoints/epoch_17.pt"
}
```

Now downstream automation has an unambiguous result.

## How Do You Test Training Without Running the Full Workload Every Time?
<!-- section-summary: Unit tests, tiny end-to-end smoke runs, and managed-infrastructure checks answer different questions at different costs. -->

Retry safety protects production runs, while layered tests catch most wiring problems before a costly run begins.

A common mistake is testing ML training only by launching full training runs. That's too slow. A better mental model has three layers.

### Level 1: test individual logic

For example:

```python
def test_feature_shape():
    features = prepare_features(sample_data)
    assert features.shape == (10, 42)
```

Or:

```python
def test_model_forward():
    output = model(example_batch)
    assert output.shape == (8, 2)
```

These should run quickly.

### Level 2: run the complete training program on tiny data

This answers a different question:

Can all the pieces actually work together

For example:

```bash
python -m fraud_model.train \
    --train-data tests/data/tiny_train.parquet \
    --validation-data tests/data/tiny_val.parquet \
    --config tests/configs/smoke.yaml \
    --output-dir /tmp/test-training
```

Perhaps `smoke.yaml` says:

```yaml
epochs: 1
batch_size: 4
```

You're not testing model quality. You're testing wiring.

```text
data loads
→ preprocessing works
→ model builds
→ forward pass works
→ optimizer works
→ model saves
→ metrics save
```

### Level 3: test the infrastructure integration

Finally, occasionally launch the same program using the real training infrastructure.

```text
pipeline
 ↓
managed GPU job
 ↓
training program
 ↓
object storage
```

This tests things unit tests cannot:

```text
permissions
cloud storage access
container image
GPU availability
networking
resource configuration
job launcher
artifact collection
```

The crucial idea is that it is still **the same training program**. Suppose locally you execute:

```bash
python -m fraud_model.train \
    --train-data ./data/train.parquet \
    --config configs/baseline.yaml \
    --output-dir ./outputs/test
```

Later a managed platform effectively executes:

```bash
python -m fraud_model.train \
    --train-data s3://ml-data/train.parquet \
    --config s3://ml-config/baseline.yaml \
    --output-dir s3://ml-runs/run-781
```

The surrounding machine changed. The program did not. That's the ideal architecture.

```text
                 same training program
                         │
         ┌───────────────┼────────────────┐
         │               │                │
         ▼               ▼                ▼
      laptop          CI runner       GPU cluster
```

A managed platform can add:

```text
GPU allocation
distributed machines
spot-instance recovery
log collection
metric tracking
secret management
job queues
autoscaling
```

without requiring you to rewrite the model-training logic. This is why having a clean executable program matters so much.

## Where Does the Training Program Fit in the Pipeline?
<!-- section-summary: The training program owns model computation, while the pipeline owns ordering, resources, dependencies, and downstream decisions. -->

After the program can run independently, the pipeline can treat it as one replaceable computation between declared upstream inputs and downstream artifacts.

Consider a production ML pipeline:

```text
Raw Data
   │
   ▼
Validate Data
   │
   ▼
Build Training Dataset
   │
   ▼
┌──────────────────────┐
│ Launch Training Job  │
│                      │
│ python -m train ...  │
└──────────────────────┘
   │
   ├──── model.pt
   │
   └──── metrics.json
          │
          ▼
     Evaluate Model
          │
          ▼
      Quality Gate
       /       \
    fail       pass
                │
                ▼
          Register Model
                │
                ▼
              Deploy
```

Notice something important. The pipeline is responsible for **workflow**:

```text
what runs after what
```

The training program is responsible for **training**:

```text
how do we turn this dataset and configuration into a model
```

Keeping those responsibilities separate prevents a common architectural failure where the pipeline definition starts containing model code, preprocessing internals, PyTorch loops, storage logic, and experiment configuration all mixed together. Ideally your training program doesn't care whether it was launched by:

```text
a developer
GitHub Actions
Airflow
Kubeflow
SageMaker
Vertex AI
Azure ML
Argo
Slurm
```

It sees:

```text
data
config
output destination
```

and performs its job. Similarly, your pipeline orchestrator shouldn't need to know whether the training implementation is:

```text
PyTorch
TensorFlow
XGBoost
LightGBM
scikit-learn
JAX
```

It just launches the appropriate executable. This gives you two independently replaceable components:

```text
pipeline orchestration
        │
        │ stable contract
        ▼
training implementation
```

That is a valuable form of software modularity. You might ultimately end up with something like:

```text
project/
│
├── pyproject.toml
├── Dockerfile
│
├── configs/
│   ├── baseline.yaml
│   └── production.yaml
│
├── src/
│   └── recommender/
│       ├── data.py
│       ├── features.py
│       ├── model.py
│       ├── training.py
│       ├── evaluation.py
│       └── train.py
│
├── pipelines/
│   └── training_pipeline.py
│
└── tests/
    ├── unit/
    ├── smoke/
    └── integration/
```

The relationship is:

```text
train.py
   │
   ├── data.py
   ├── features.py
   ├── model.py
   └── training.py

training_pipeline.py
   │
   └── launches train.py
```

The pipeline does **not** become the training implementation. It launches the training implementation. Training scripts aren't really about replacing `.ipynb` with `.py`. They're about transforming an **interactive computation** into an **automatable computation**. You start with:

```text
human
  ↓
notebook
  ↓
experiment
```

Then gradually remove dependence on the human:

```text
explicit data
+
explicit configuration
+
versioned code
+
defined environment
        ↓
training program
        ↓
explicit artifacts
+
metrics
+
exit status
```

At that point a scheduler can execute it:

```text
scheduler
   ↓
training process
   ↓
model artifacts
```

And because the training process has a clean contract, you can surround it with increasingly sophisticated infrastructure without fundamentally changing the ML code. Think of a training script as a **build command for a model**. In ordinary software:

```text
source code
   ↓
build command
   ↓
software artifact
```

In machine learning:

```text
code + data + configuration
            ↓
      training command
            ↓
       model artifact
```

A good training program therefore has roughly this contract:

```text
INPUTS
────────────────────────
training data
validation data
training configuration
random seed
output location

            ↓

      TRAINING PROGRAM

            ↓

OUTPUTS
────────────────────────
trained model
metrics
checkpoints
metadata
logs
success/failure status
```

**Notebooks optimize for humans exploring a problem.** **Training scripts optimize for computers repeatedly executing a defined computation.** **Training pipelines optimize for coordinating that computation with everything that must happen before and after it.** Once those three roles are separated, much of production ML engineering becomes considerably easier to reason about.

![The path from notebook exploration through stable functions and one command to verified evidence across local, CI, and managed-job runtimes.](/content-assets/articles/article-mlops-training-pipelines-notebook-to-training-script/notebook-to-managed-job-summary.png)

*One command and one output contract let the same training program move between execution environments.*

## Check Your Answers

Use these short answers to revisit the reasoning behind each section.

:::expand[Why Does Notebook Training Need a Program Boundary?]{kind="recap"}
Notebook exploration can rely on interactive state, while an automated run must rebuild every required input and decision inside a fresh process.
:::

:::expand[What Inputs and Outputs Define One Training Run?]{kind="recap"}
One training run is a computation over explicit code, data, configuration, environment, randomness, and output destinations.
:::

:::expand[How Do You Turn Stable Notebook Steps into Testable Functions?]{kind="recap"}
Stable preparation, model construction, training, and evaluation logic moves into functions whose arguments and return values expose the data flow.
:::

:::expand[How Does One Command Describe a Complete Training Run?]{kind="recap"}
A single entrypoint turns the complete run into one observable process while keeping execution arguments separate from the training recipe.
:::

:::expand[How Does Packaging Make Training Portable?]{kind="recap"}
An installable project and pinned environment let the same training code travel independently of a developer's directory and machine.
:::

:::expand[How Does a Training Program Support Safe Retries and Automation?]{kind="recap"}
Attempt-specific outputs, completion markers, checkpoints, structured logs, and exit codes make retries safe and results machine-readable.
:::

:::expand[How Do You Test Training Without Running the Full Workload Every Time?]{kind="recap"}
Unit tests, tiny end-to-end smoke runs, and managed-infrastructure checks answer different questions at different costs.
:::

:::expand[Where Does the Training Program Fit in the Pipeline?]{kind="recap"}
The training program owns model computation, while the pipeline owns ordering, resources, dependencies, and downstream decisions.
:::
