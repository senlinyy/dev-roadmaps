---
title: "Training Orchestration"
description: "Understand how an orchestrator coordinates training work, preserves run state, recovers safely, and fits Airflow, Dagster, Prefect, Kubeflow Pipelines, and managed ML platforms."
overview: "Training orchestration gives a multi-step ML workflow a durable control layer. Learn the graph, execution, state, artifact, repetition, security, and operating decisions that matter before choosing a product."
tags: ["MLOps", "production", "orchestration"]
order: 2
id: "article-mlops-training-pipelines-airflow-prefect-kubeflow-orchestration"
aliases:
  - roadmaps/mlops/modules/training-pipelines/pipeline-design/03-airflow-prefect-kubeflow-orchestration.md
  - child-pipeline-design-03-airflow-prefect-kubeflow-orchestration
---

## Table of Contents

1. [What Does a Training Orchestrator Do?](#what-does-a-training-orchestrator-do)
2. [How Does the Orchestrator Preserve and Repair Workflow State?](#how-does-the-orchestrator-preserve-and-repair-workflow-state)
3. [How Does Orchestration Control Resources, Access, and Workflow Versions?](#how-does-orchestration-control-resources-access-and-workflow-versions)
4. [How Do You Choose an Orchestrator Without Coupling It to Model Code?](#how-do-you-choose-an-orchestrator-without-coupling-it-to-model-code)
5. [How Do Events, Approvals, Time, and Backfills Enter the Workflow?](#how-do-events-approvals-time-and-backfills-enter-the-workflow)
6. [How Should Orchestration Tasks Be Divided and Parallelized?](#how-should-orchestration-tasks-be-divided-and-parallelized)
7. [How Do Scripts, Configuration, Artifacts, Pipelines, and Orchestration Share Responsibility?](#how-do-scripts-configuration-artifacts-pipelines-and-orchestration-share-responsibility)
8. [What Operating Loop Makes Training Orchestration Reliable?](#what-operating-loop-makes-training-orchestration-reliable)
9. [Check Your Answers](#check-your-answers)

A pipeline says `prepare data → train → evaluate`. Training runs for twelve hours on another machine. During hour nine, the process coordinating the workflow restarts. The training job may still be healthy, but the system needs a durable answer to whether it started, which attempt is active, where its outputs belong, and what should happen after it finishes.

A **training orchestrator** turns a pipeline plan into real executions over time. It determines which work is ready, requests compute, launches jobs, observes external state, records progress, retries failures, limits concurrency, and exposes history to operators. The model-training process remains responsible for optimization; the orchestrator manages its lifecycle.

The difficult part is state in an unreliable environment. A completion event can be lost, a worker can disappear after creating an artifact, and the orchestration service itself can restart. Durable state, external job identities, idempotent effects, and reconciliation let the workflow continue without reconstructing truth from memory.

Use these questions to separate the workflow plan from the durable control system that launches work, remembers state, and repairs failures:

1. **What Does a Training Orchestrator Do?**
2. **How Does the Orchestrator Preserve and Repair Workflow State?**
3. **How Does Orchestration Control Resources, Access, and Workflow Versions?**
4. **How Do You Choose an Orchestrator Without Coupling It to Model Code?**
5. **How Do Events, Approvals, Time, and Backfills Enter the Workflow?**
6. **How Should Orchestration Tasks Be Divided and Parallelized?**
7. **How Do Scripts, Configuration, Artifacts, Pipelines, and Orchestration Share Responsibility?**
8. **What Operating Loop Makes Training Orchestration Reliable?**

## What Does a Training Orchestrator Do?
<!-- section-summary: A pipeline describes desired work, while an orchestrator creates runs, tracks task state, launches jobs, observes results, applies policy, and preserves history. -->

A three-command shell script can coordinate simple work. A dedicated orchestrator is needed when the workflow must remember state across long jobs, failures, retries, schedules, and many simultaneous runs.

The cleanest way to understand orchestration is to separate two ideas:

> A **training pipeline** describes the work that should happen.
> A **training orchestrator** is the system that makes that work actually happen over time.

If your pipeline says:

```text
Prepare Data
    ↓
Train
    ↓
Evaluate
    ↓
Register
```

the orchestrator is responsible for turning that static graph into real executions:

```text
"Prepare Data is ready."
        ↓
launch it
        ↓
observe success
        ↓
record its output
        ↓
"Train is now ready."
        ↓
request GPUs
        ↓
launch training
        ↓
training machine fails
        ↓
record failure
        ↓
retry according to policy
        ↓
continue workflow
```

So orchestration is fundamentally about **coordinating stateful work in an unreliable world**. Imagine you have three commands:

```bash
python prepare_data.py
python train.py
python evaluate.py
```

You could coordinate them with:

```bash
python prepare_data.py &
python train.py &
python evaluate.py
```

For a small workflow, this may be enough. The shell is effectively acting as an orchestrator:

```text
run A
↓
if A succeeds, run B
↓
if B succeeds, run C
```

This teaches an important principle:

You do not need an orchestration platform merely because you have multiple steps.

The need for a real orchestrator appears when coordination becomes difficult.

For example:

```text
What if training takes 12 hours

What if the machine running the coordinator restarts

What if only evaluation fails

What if training requires GPUs

What if two steps can run in parallel

What if a job needs three retries

What if a workflow should run every night

What if you need to know what happened last month

What if 500 workflows are running simultaneously
```

At that point:

```text
simple sequencing
```

has become:

```text
distributed state management
```

That is the problem orchestration systems solve. Suppose the pipeline definition is:

```text
A → B → C
```

That's only a dependency graph. Nothing has actually happened yet. The orchestrator creates an execution:

```text
pipeline definition
       │
       ▼
pipeline run #841
```

Then it tracks instances of each step:

```text
pipeline-run-841
│
├── A : SUCCEEDED
├── B : RUNNING
└── C : PENDING
```

Later:

```text
pipeline-run-841
│
├── A : SUCCEEDED
├── B : SUCCEEDED
└── C : RUNNING
```

And eventually:

```text
pipeline-run-841
│
├── A : SUCCEEDED
├── B : SUCCEEDED
└── C : SUCCEEDED
```

The distinction is similar to:

```text
program
vs
running process
```

A pipeline definition is the program. A pipeline run is an execution of that program. The orchestrator manages those executions. Suppose training is running on another machine. The orchestrator needs to know:

```text
Has it started
Is it still running
Did it succeed
Did it fail
Was it cancelled
Did it time out
Which attempt is this
Where are its outputs
```

So each task has a state machine. A simplified version:

```text
PENDING
   │
   ▼
READY
   │
   ▼
RUNNING
  /   \
 ▼     ▼
FAILED SUCCEEDED
   │
   ▼
RETRYING
   │
   └──────▶ RUNNING
```

The orchestrator spends much of its life maintaining these transitions correctly. It sounds mundane, but this is the heart of reliable workflow execution. Suppose training requires eight GPUs. The orchestrator ideally does not contain:

```python
for batch in dataloader:
    loss = model(batch)
    loss.backward()
```

Instead it says something like:

```text
launch training program:
    image = trainer@sha256:...
    command = python -m project.train ...
    resources = 8 GPUs
```

Then some compute system executes that process.

Conceptually:

```text
                   ORCHESTRATOR
                        │
                  "run this job"
                        │
                        ▼
               COMPUTE PLATFORM
                        │
                        ▼
                 TRAINING SCRIPT
                        │
                        ▼
                    ARTIFACTS
```

The orchestrator manages the lifecycle. The training program performs training. This separation is extremely valuable. Most orchestration features can be understood as seven fundamental responsibilities.

### Job 1: Determine what is ready to run

Given:

```text
A ─────▶ C
B ─────▶ C
```

`C` cannot run until both `A` and `B` have completed successfully. The orchestrator repeatedly asks:

```text
Are all dependencies satisfied
```

If yes:

```text
PENDING → READY
```

This is dependency resolution.

### Job 2: Launch work

Once a task becomes ready, the orchestrator needs to start it somewhere.

For example:

```text
Prepare Data:
    4 CPU
    16 GB RAM

Train:
    8 GPU
    128 GB RAM

Evaluate:
    1 GPU
```

The orchestrator may hand these requests to:

```text
Kubernetes
a cloud batch service
a managed ML training service
Slurm
local subprocesses
```

The scheduler decides **when**. The compute backend usually decides **where**.

### Job 3: Observe execution

After launching a job, the orchestrator needs to determine what happened.

For example:

```text
process exit code = 0
        ↓
SUCCEEDED
```

or:

```text
process exit code = 137
        ↓
FAILED
```

It may additionally observe:

```text
heartbeats
external job state
timeouts
cancellation
artifact publication
```

The important part is that execution state eventually becomes durable workflow state.

### Job 4: Record progress durably

Suppose the orchestrator process crashes. If its knowledge existed only in RAM:

```text
A succeeded
B was running
C had not started
```

is lost. A proper orchestrator records its state durably:

```text
workflow database

pipeline-run-841
    A = SUCCEEDED
    B = RUNNING
    C = PENDING
```

When the orchestration service restarts, it can reconstruct reality. This database is therefore a critical component.

### Job 5: Recover failed work

Suppose:

```text
Prepare Data   SUCCEEDED
Train          SUCCEEDED
Evaluate       FAILED
```

The orchestrator should generally not restart:

```text
Prepare Data
Train
```

It should retry:

```text
Evaluate
```

using the already produced model. This requires:

```text
durable step outputs
+
durable step state
+
retry policy
```

Recovery is one of the main reasons orchestration exists.

### Job 6: Enforce policy and limits

Real infrastructure is finite. Suppose 100 workflows each want eight GPUs:

$$
100\times8=800\text{ GPUs}
$$

but you only have 64. Someone must control concurrency. The orchestrator may enforce:

```text
maximum concurrent jobs
GPU quotas
per-team limits
priority
rate limits
timeouts
retry limits
execution windows
```

Without this layer, workflows can overwhelm the system they depend on.

### Job 7: Expose control and history

Humans and automation need answers:

```text
What is running
What failed
Why
What completed
Which model came from this run
Can I retry this stage
Can I cancel the workflow
What ran three months ago
```

So orchestration also needs an operational interface:

```text
UI
API
CLI
logs
run history
metadata
```

An orchestrator isn't useful merely because it can launch jobs. It must make their state understandable.

## How Does the Orchestrator Preserve and Repair Workflow State?
<!-- section-summary: Durable attempts, atomic transitions, reconciliation, and separate workflow, training, and artifact state let the system recover after workers or coordinators fail. -->

Launching tasks is only the visible part. Reliability depends on preserving what happened and repairing disagreement between the workflow database and external compute.

Suppose a pipeline has 20 stages. Even if every stage succeeds 99% of the time, the chance all 20 succeed in one attempt is approximately:

$$
0.99^{20}\approx0.818
$$

So roughly 18% of complete executions could encounter at least one stage failure under that simplistic assumption. The exact number isn't important. The lesson is:

As workflows grow, failure somewhere becomes routine.

Failures can come from:

```text
spot/preemptible machine termination
network interruption
storage outage
GPU failure
out-of-memory error
expired credentials
temporary API failure
software bug
bad data
```

Therefore an orchestrator should be designed around recovery rather than assuming uninterrupted execution. Suppose the training step fails. Do not conceptually change:

```text
train = FAILED
```

back into:

```text
train = RUNNING
```

as if the failure never happened. Instead preserve attempts:

```text
Train Step
│
├── attempt 1
│      FAILED
│
└── attempt 2
       RUNNING
```

Later:

```text
Train Step
│
├── attempt 1 FAILED
└── attempt 2 SUCCEEDED
```

Now you have both operational truth and logical simplicity:

```text
logical step outcome = SUCCEEDED
execution history = one failure, then one success
```

This distinction is extremely useful for debugging. Suppose a registration stage does:

```text
create model registry entry
```

The operation succeeds. Then the worker loses network connectivity before reporting success. The orchestrator sees:

```text
UNKNOWN / FAILED
```

and retries. If the retry simply executes:

```text
create model registry entry
```

again, you might get:

```text
registry entry 91
registry entry 92
```

for the same model. This reveals a deep distributed-systems problem:

The orchestrator cannot always know whether a remote side effect happened before communication failed.

Therefore externally visible operations should ideally be idempotent.

For example:

```text
register(model_id="model-991")
```

can behave as:

```text
if model-991 already registered:
    return existing record
else:
    create it
```

Now retries are safe. People sometimes want:

"Make sure this step executes exactly once."

In distributed systems, guaranteeing that a process literally runs exactly once is difficult. A more practical goal is:

```text
execution may occur more than once
but externally visible result behaves as if it occurred once
```

This is achieved through:

```text
idempotency
unique request IDs
deduplication
immutable outputs
transactional publishing
```

For example:

```text
attempt 1 uploads model-991
attempt 1 loses connection
attempt 2 tries uploading model-991
artifact system sees model-991 already valid
attempt 2 reuses it
```

The computation may have been attempted twice. The durable effect is one model artifact. Consider how important the orchestration database is. It may contain:

```text
pipeline run IDs
step states
attempt states
resolved workflow versions
artifact references
retry counts
timestamps
scheduler decisions
```

If it becomes corrupted, the orchestrator may no longer know:

```text
what is currently running
what succeeded
what needs retrying
what outputs belong to what run
```

So treat it as production state, not merely a cache. Important properties include:

```text
durability
backup
transactional updates
high availability where needed
controlled migrations
access control
```

Imagine this sequence:

```text
1. mark task READY
2. launch job
3. mark task RUNNING
```

The orchestrator crashes between steps 2 and 3. A job is now running, but the database says:

```text
READY
```

The scheduler may launch another copy. This is a classic coordination problem. Real orchestrators use techniques such as:

```text
transactions
leases
job IDs
compare-and-swap updates
reconciliation loops
```

to safely connect their internal state to external execution. You don't need to implement these yourself if you use a mature orchestrator, but understanding the problem explains why orchestration software is more complicated than:

```python
for task in tasks:
    run(task)
```

Instead of assuming:

```text
"I launched this job, therefore my state is correct."
```

the orchestrator can repeatedly compare:

```text
desired state
vs
observed state
```

For example:

```text
database:
    training should be RUNNING

compute platform:
    no training job exists
```

The orchestrator detects the mismatch and repairs it. Or:

```text
database:
    task says RUNNING

compute platform:
    job completed successfully
```

The orchestrator updates:

```text
RUNNING → SUCCEEDED
```

This periodic comparison is often called reconciliation. It's a robust way of dealing with temporary failures and missed events. Suppose an orchestration worker crashes. The training GPU process might continue running. That's fine if the orchestrator can later reconnect:

```text
orchestrator restarts
      ↓
reads workflow DB
      ↓
asks compute backend
      ↓
job-927 is still RUNNING
      ↓
continue monitoring
```

This is much stronger than requiring the original coordinating process to stay alive for 20 hours. Durable state decouples:

```text
workflow lifetime
```

from:

```text
orchestrator-process lifetime
```

There are two different kinds of state. The orchestrator cares about:

```text
step = Train
attempt = 2
status = RUNNING
external_job_id = job-9128
```

The trainer cares about:

```text
epoch = 14
global_step = 183,412
best_loss = 1.82
optimizer_state = ...
```

Don't make the orchestrator understand optimizer internals.

Instead:

```text
ORCHESTRATOR STATE
"Is the training job alive?"

TRAINING CHECKPOINT STATE
"How far has the optimization progressed?"
```

When a training attempt fails:

```text
orchestrator retries step
        ↓
trainer loads checkpoint
        ↓
optimization resumes
```

Two independent recovery systems cooperate. Similarly, don't confuse:

```text
job completed
```

with:

```text
artifact safely published
```

Suppose optimization finishes, but model upload fails. From the pipeline's perspective, training hasn't produced its required contract yet. A safer stage structure is:

```text
RUN TRAINING
      ↓
BUILD OUTPUT BUNDLE
      ↓
PUBLISH ARTIFACT
      ↓
VERIFY OUTPUT
      ↓
STEP SUCCEEDED
```

Success should represent **usable durable output**, not merely completion of in-memory computation.

![Orchestrator state, workload state, and artifact state exchange status and committed outputs while recovery reconciliation queries the external systems](/content-assets/articles/article-mlops-training-pipelines-airflow-prefect-kubeflow-orchestration/three-sources-of-state.png)

*The control-plane database remembers decisions and job identities. Recovery checks the workload system and artifact system before repairing that orchestration record.*

## How Does Orchestration Control Resources, Access, and Workflow Versions?
<!-- section-summary: Queues, concurrency limits, least-privilege identities, resource policies, and frozen workflow definitions protect shared infrastructure and historical meaning. -->

Recovery occurs inside a shared platform, so the same control layer also has to govern scarce resources, credentials, permissions, and which workflow version a run follows.

Training workloads are unusual because they may require scarce resources:

```text
8 × GPU
high-memory CPU
large local SSD
high network bandwidth
special accelerators
```

An orchestrator therefore often coordinates with a resource scheduler.

Conceptually:

```text
Train Step READY
      ↓
request:
    8 GPUs
    128 GB RAM
      ↓
QUEUED
      ↓
resources become available
      ↓
RUNNING
```

Notice a useful extra state:

```text
READY
  ↓
QUEUED
  ↓
RUNNING
```

A task can be logically ready but unable to start because compute isn't available. That's normal. Suppose every pipeline begins with a warehouse query. If 500 training pipelines start simultaneously:

```text
500 massive warehouse queries
```

may overwhelm your database. So orchestration can enforce:

```text
max 10 dataset-building stages concurrently
```

Similarly:

```text
max 4 large GPU trainings
max 20 registry operations
max 50 evaluations
```

The limiting resource isn't always compute. It might be:

```text
database capacity
API quota
network bandwidth
storage throughput
licence seats
```

A good orchestrator lets workflows respect these external constraints. Training may need access to:

```text
data warehouse
object storage
experiment tracker
model registry
```

A naïve pipeline passes:

```text
database_password="..."
```

inside task parameters. Bad idea. Pipeline metadata is often:

```text
logged
stored in databases
shown in UIs
included in error messages
retained for months
```

Instead, workers should obtain credentials from:

```text
workload identity
service accounts
secret manager
short-lived credentials
mounted secrets
```

The pipeline should say:

```text
this task requires identity: training-data-reader
```

not:

```text
here is the secret password
```

Different steps need different permissions.

For example:

```text
Build Dataset
    read raw data
    write prepared datasets

Train
    read prepared datasets
    write model artifacts

Evaluate
    read candidate models
    read evaluation data
    write reports

Register
    read candidate model
    modify registry
```

Training does not necessarily need permission to:

```text
deploy to production
delete datasets
change registry aliases
```

This reduces blast radius. A compromised training job should not automatically become a production-deployment credential. Suppose a workflow definition can request:

```text
gpu_count = 1000
```

If accepted blindly, one user could exhaust the entire cluster. So the orchestration/control layer should validate requests against:

```text
quotas
allowed machine types
team limits
budgets
maximum runtime
allowed regions
```

This is particularly important in ML because training workloads can be extremely expensive. Suppose your pipeline originally was:

```text
Prepare
 ↓
Train
 ↓
Evaluate
```

Then you change it to:

```text
Prepare
 ↓
Validate
 ↓
Train
 ↓
Evaluate
 ↓
Safety Test
```

A pipeline run that started yesterday may still be executing the old graph. Which definition applies to it? Usually:

```text
the version captured when the run started
```

not whatever definition happens to exist now. So pipeline runs should be associated with a workflow version:

```text
pipeline-run-841
workflow-definition = commit 82ab971
```

This makes historical execution understandable. Suppose training has been running for 10 hours. Meanwhile you deploy a new pipeline definition. If the running workflow suddenly adopts new downstream dependencies:

```text
old:
Train → Evaluate

new:
Train → NewSecurityStep → Evaluate
```

you can get confusing semantics. A more predictable model is:

```text
pipeline definition v17
    ↓
instantiate run
    ↓
run retains v17 semantics

pipeline definition v18
    ↓
new runs use v18
```

This is analogous to immutable code/configuration versions elsewhere in the training system.

## How Do You Choose an Orchestrator Without Coupling It to Model Code?
<!-- section-summary: The smallest suitable mechanism should coordinate portable commands and durable references through a thin control plane rather than contain ML implementation details. -->

Those requirements determine the orchestration mechanism. Product names matter less than the execution model, recovery boundary, scale, and operating responsibility.

The right question is not:

"What is the most advanced orchestrator?"

It is:

**What kinds of coordination and failure do I actually need to handle?**

For a tiny local workflow:

```text
shell script
Makefile
Python driver
```

may be completely sufficient. For scheduled data-heavy jobs:

```text
DAG-oriented workflow system
```

may make sense. For container-native ML pipelines:

```text
Kubernetes-oriented workflow system
```

may fit better. For a cloud-managed ML estate:

```text
managed cloud pipeline service
```

may reduce operational burden. For HPC-scale distributed training:

```text
cluster scheduler + workflow layer
```

may be natural. Choose based on required semantics, not branding. A useful evaluation starts with workload requirements.

### Execution model

Do you need:

```text
containers
Python processes
Kubernetes jobs
managed cloud training jobs
Slurm jobs
```

### Workflow shape

Do you need:

```text
simple chains
DAGs
dynamic branching
thousands of mapped tasks
long-running workflows
```

### Risk behavior

Do you need:

```text
retries
resume
task-level reruns
timeouts
manual intervention
```

### Scheduling

Do you need:

```text
cron schedules
event triggers
backfills
ad-hoc launches
```

### Scale

Do you have:

```text
5 runs/day
or
50,000 tasks/day
```

### Operational model

Do you want:

```text
self-hosted
or
managed service
```

Those questions usually narrow the choice considerably. Suppose training itself only works inside an orchestration callback:

```python
@some_vendor_task
def train():
    ...
    full PyTorch implementation here
```

Changing orchestration platforms becomes expensive. Prefer:

```text
orchestrator adapter
       ↓
training command
       ↓
portable training package
```

For example:

```bash
python -m project.train \
  --dataset ... \
  --config ... \
  --output ...
```

Then one orchestrator launches it today. Another could launch it tomorrow. The stable abstraction is the training program contract. A good orchestrator definition often reads like:

```text
dataset = prepare_data(...)

model = train(
    dataset=dataset,
    config=config,
)

report = evaluate(
    model=model,
)

if quality_gate(report):
    register(model)
```

It should mostly describe:

```text
dependencies
resources
execution policy
```

not:

```text
feature engineering mathematics
model architecture
training loops
evaluation implementation
```

The less ML logic lives in orchestration code, the easier the whole system is to change and test. This is a useful systems distinction. The **control plane** manages small metadata:

```text
run IDs
task states
dependencies
resource requests
artifact URIs
```

The **data plane** carries large data:

```text
training datasets
checkpoints
model weights
evaluation files
```

Do not push a 100 GB model through the orchestration database.

Instead:

```text
Train
 ↓
writes model to artifact store
 ↓
returns:
model_uri = artifact://model-991
```

The orchestrator stores the URI. So:

```text
ORCHESTRATOR DATABASE
small control information

ARTIFACT STORE
large durable data
```

This separation is fundamental for scale. Imagine this:

```python
model = train(...)
evaluate(model)
```

Conceptually this looks like the model object is passed directly. In a real distributed pipeline, what usually moves is:

```text
model artifact ID
```

or:

```text
artifact URI
```

So the actual semantics are:

```text
Train
 ↓
writes model-v17
 ↓
orchestrator records "model-v17"
 ↓
Evaluate receives "model-v17"
 ↓
Evaluate downloads/loads model
```

This lets Train and Evaluate run:

```text
hours apart
on different machines
after orchestrator restarts
```

because their dependency is durable.

## How Do Events, Approvals, Time, and Backfills Enter the Workflow?
<!-- section-summary: Events and polling, durable human approval, explicit logical time, and historical parameters let asynchronous and backfill workflows remain reproducible. -->

After the execution platform is chosen, the design still needs to represent signals that arrive outside a normal task chain, including time, events, approvals, and historical intervals.

How does the orchestrator learn a job finished? One option:

```text
worker sends completion event
```

Another:

```text
orchestrator periodically asks:
"is job-821 finished?"
```

Each has tradeoffs. Events can be fast but may occasionally be lost. Polling is simpler but creates latency and load. Mature systems often combine them:

```text
events for speed
+
reconciliation/polling for correctness
```

This illustrates a broader principle:

Don't make correctness depend entirely on one notification arriving exactly once.

Not all pipelines are fully automatic. You may want:

```text
Train
 ↓
Evaluate
 ↓
WAIT FOR REVIEW
 ↓
Register
```

The workflow can remain in:

```text
WAITING_FOR_APPROVAL
```

for hours or days. The orchestrator must remember that state durably without occupying a worker process. This is another reason workflow state should live in the orchestration system rather than inside a long-lived Python script. Some training workflows execute:

```text
every day at 02:00
```

or:

```text
after monthly dataset closes
```

or:

```text
whenever dataset-v43 is published
```

So orchestration may begin from:

```text
time event
```

or:

```text
artifact/data event
```

rather than a user pressing a button. But after triggering, exact inputs should still be resolved and recorded:

```text
scheduled:
2026-08-29

resolved dataset:
transactions-v481

resolved code:
commit 74ad9c

resolved config:
config-v22
```

Schedule tells you **why execution began**. Resolved inputs tell you **what actually ran**. Suppose a daily workflow should have run for:

```text
August 1
August 2
...
August 10
```

but did not. A backfill means creating executions for those historical logical dates:

```text
pipeline(as_of=Aug 1)
pipeline(as_of=Aug 2)
...
pipeline(as_of=Aug 10)
```

The orchestrator coordinates many related workflow instances. The pipeline code should not contain:

```python
datetime.now()
```

where historical time affects semantics. Instead time should be explicit:

```text
logical_date
as_of_timestamp
data_interval
```

Otherwise historical orchestration becomes impossible to reproduce correctly.

![Airflow, Dagster, Prefect, Kubeflow Pipelines, and managed ML pipelines compared by workflow object, compute location, and control-plane ownership](/content-assets/articles/article-mlops-training-pipelines-airflow-prefect-kubeflow-orchestration/orchestrator-workflow-fit.png)

*The selection starts with the workflow's primary object, the execution environment, and the team that will operate the control plane; no option is universally preferred.*

## How Should Orchestration Tasks Be Divided and Parallelized?
<!-- section-summary: Tasks deserve independent boundaries when they need separate resources, retries, outputs, ownership, observability, or parallel execution. -->

The dependency graph also exposes where work may proceed in parallel and where a boundary is too small or too large to recover efficiently.

Suppose:

```text
            ┌──▶ Evaluate Accuracy ──┐
Train ──────┼──▶ Evaluate Latency ───┼──▶ Quality Gate
            └──▶ Evaluate Safety ────┘
```

Once training succeeds, all three evaluations can run concurrently. The orchestrator sees dependency structure:

```text
three tasks become READY
```

and launches them independently, subject to capacity. This can drastically reduce wall-clock time. The workflow graph therefore communicates not just required ordering, but also **where ordering is unnecessary**. Suppose you want to evaluate the model on 100 datasets. The workflow might generate:

```text
Evaluate shard 1
Evaluate shard 2
...
Evaluate shard 100
```

Dynamic task generation can be powerful. But highly dynamic orchestration increases complexity:

```text
more state
more scheduling
more UI noise
more retries
more metadata
```

Sometimes the better design is one evaluation job internally processing 100 shards. A useful question is:

Does this unit of work need independent scheduling, retries, observability, or ownership

If no, it may not deserve to be a separate orchestration task. Suppose your pipeline contains:

```text
Load file
↓
Parse one column
↓
Rename column
↓
Compute mean
↓
Normalize
↓
Write file
```

Each step takes 300 milliseconds, but orchestration overhead takes seconds. That's inefficient. Orchestration boundaries are most useful where you need:

```text
durable outputs
different resources
independent retries
clear ownership
parallelism
meaningful observability
```

Fine-grained Python logic belongs inside a program. Not every function needs to become a pipeline task. At the opposite extreme:

```text
One Giant Task:
    validate data
    build features
    train
    evaluate
    register
    deploy
```

If deployment fails:

```text
rerun everything
```

That's poor failure isolation. So task sizing is a balance. A good orchestration boundary often corresponds to:

**a meaningful durable recovery point.**

For example:

```text
Dataset artifact
Model artifact
Evaluation artifact
Registry entry
```

Those are natural stage boundaries. Without orchestration:

```text
one giant process
     │
     ├── implicit state
     ├── implicit ordering
     └── all-or-nothing recovery
```

With orchestration:

```text
Step A
  ↓ artifact
Step B
  ↓ artifact
Step C
```

Now each boundary gives you:

```text
observable state
retry point
cache/reuse point
ownership boundary
resource boundary
audit point
```

This is why good pipeline design and good artifact design reinforce each other.

## How Do Scripts, Configuration, Artifacts, Pipelines, and Orchestration Share Responsibility?
<!-- section-summary: Each layer owns one contract: computation, recipe, durable result, dependency graph, or execution state through time. -->

Clear task boundaries work only when the surrounding scripts, configurations, artifacts, and pipeline definition retain their own responsibilities.

The complete architecture is now:

```text
                     USER / SCHEDULE
                            │
                            ▼
                    ORCHESTRATOR
                    "when and where"
                            │
                            ▼
                    PIPELINE GRAPH
                    "what depends on what"
                            │
                  ┌─────────┼─────────┐
                  ▼         ▼         ▼
               Program   Program   Program
                 │          │         │
              Config     Config    Config
                 │          │         │
                  └──────┬───┴─────┬──┘
                         ▼         ▼
                     Artifacts   Metadata
```

More concretely:

```text
Orchestrator
    ↓
launch Prepare Data
    ↓
dataset artifact
    ↓
launch Train
    ↓
model artifact
    ↓
launch Evaluate
    ↓
evaluation artifact
    ↓
launch Register
```

Each layer has a distinct responsibility.

### Training script

```text
How does this computation work
```

### Training configuration

```text
Which recipe should this computation use
```

### Training artifact system

```text
What durable outputs did the computation produce
```

### Training pipeline

```text
Which computations depend on which others
```

### Training orchestrator

```text
Which computation should run now,
where should it run,
and what should happen if reality deviates from the plan
```

That last question is orchestration.

## What Operating Loop Makes Training Orchestration Reliable?
<!-- section-summary: A reliable orchestrator repeatedly compares desired workflow state with observed reality, records the result, and safely launches, retries, waits, or continues. -->

The resulting orchestrator is a durable control loop, not merely a tool that starts tasks in order.

A naïve mental model is:

```text
Orchestrator = thing that runs tasks in order.
```

A stronger one is:

> **A training orchestrator is a durable state machine that continuously turns a desired workflow into real executions, while handling dependencies, failures, retries, resources, concurrency, and history.**

Its core loop is conceptually:

```text
read workflow state
       ↓
inspect dependencies
       ↓
determine ready work
       ↓
allocate / request compute
       ↓
launch jobs
       ↓
observe reality
       ↓
record state durably
       ↓
retry or continue
       ↓
repeat
```

The final distinction ties the design together:

```text
TRAINING PIPELINE
describes the dependency graph

TRAINING ORCHESTRATOR
maintains the execution of that graph through time
```

A good orchestrator does not make failures disappear. It makes failures **recorded, localized, recoverable, and boring**. It does not guarantee that a machine won't die. It ensures that when one does, the system still knows:

```text
what had been requested
what had already succeeded
what failed
which outputs remain valid
what should run next
and whether retrying it is safe
```

That is the real purpose of training orchestration.

![A complete training orchestrator creates a run, loads a versioned graph, coordinates state, submits work, verifies outputs, and records the next decision](/content-assets/articles/article-mlops-training-pipelines-airflow-prefect-kubeflow-orchestration/complete-training-orchestrator.png)

*The main control loop sits inside a wider operating boundary with safe repetition, least-privilege identity, capacity controls, restore drills, and named ownership.*

## Check Your Answers

Use these short answers to revisit the reasoning behind each section.

:::expand[What Does a Training Orchestrator Do?]{kind="recap"}
A pipeline describes desired work, while an orchestrator creates runs, tracks task state, launches jobs, observes results, applies policy, and preserves history.
:::

:::expand[How Does the Orchestrator Preserve and Repair Workflow State?]{kind="recap"}
Durable attempts, atomic transitions, reconciliation, and separate workflow, training, and artifact state let the system recover after workers or coordinators fail.
:::

:::expand[How Does Orchestration Control Resources, Access, and Workflow Versions?]{kind="recap"}
Queues, concurrency limits, least-privilege identities, resource policies, and frozen workflow definitions protect shared infrastructure and historical meaning.
:::

:::expand[How Do You Choose an Orchestrator Without Coupling It to Model Code?]{kind="recap"}
The smallest suitable mechanism should coordinate portable commands and durable references through a thin control plane rather than contain ML implementation details.
:::

:::expand[How Do Events, Approvals, Time, and Backfills Enter the Workflow?]{kind="recap"}
Events and polling, durable human approval, explicit logical time, and historical parameters let asynchronous and backfill workflows remain reproducible.
:::

:::expand[How Should Orchestration Tasks Be Divided and Parallelized?]{kind="recap"}
Tasks deserve independent boundaries when they need separate resources, retries, outputs, ownership, observability, or parallel execution.
:::

:::expand[How Do Scripts, Configuration, Artifacts, Pipelines, and Orchestration Share Responsibility?]{kind="recap"}
Each layer owns one contract: computation, recipe, durable result, dependency graph, or execution state through time.
:::

:::expand[What Operating Loop Makes Training Orchestration Reliable?]{kind="recap"}
A reliable orchestrator repeatedly compares desired workflow state with observed reality, records the result, and safely launches, retries, waits, or continues.
:::
