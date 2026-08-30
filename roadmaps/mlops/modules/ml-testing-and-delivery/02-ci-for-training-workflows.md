---
title: "Training CI"
description: "Design CI that gives fast feedback on training changes and sends expensive or privileged work through deliberate gates."
overview: "Learn how an ML team classifies changes, runs safe pull-request checks, builds immutable training artifacts, uses short-lived cloud identity, and returns full-training evidence to the release process."
tags: ["MLOps", "production", "ci-cd"]
order: 2
id: "article-mlops-mlops-infrastructure-ci-for-training-workflows"
aliases:
  - roadmaps/mlops/modules/mlops-infrastructure/ci-cd-for-ml/02-ci-for-training-workflows.md
  - roadmaps/mlops/modules/ml-testing-and-delivery/ci-cd-for-ml/02-ci-for-training-workflows.md
  - child-ci-cd-for-ml-02-ci-for-training-workflows
---

## Table of Contents

1. [What Evidence Must Training CI Collect for an ML Change?](#what-evidence-must-training-ci-collect-for-an-ml-change)
2. [What Belongs in the Four Training CI Tiers?](#what-belongs-in-the-four-training-ci-tiers)
3. [How Does Full Training Show Whether a Candidate Is Acceptable?](#how-does-full-training-show-whether-a-candidate-is-acceptable)
4. [How Do Evidence, Provenance, and Artifact Identity Stay Connected?](#how-do-evidence-provenance-and-artifact-identity-stay-connected)
5. [How Do Retries and Change Triggers Avoid Corrupting CI?](#how-do-retries-and-change-triggers-avoid-corrupting-ci)
6. [How Does a Complete Training CI Flow Decide What to Run?](#how-does-a-complete-training-ci-flow-decide-what-to-run)
7. [How Do Long-Running CI Jobs Stay Reproducible and Diagnosable?](#how-do-long-running-ci-jobs-stay-reproducible-and-diagnosable)
8. [What Does a Green Training CI Result Actually Mean?](#what-does-a-green-training-ci-result-actually-mean)
9. [Check Your Answers](#check-your-answers)

A pull request changes one learning-rate value. Linting passes, unit tests pass, and the training container builds. Twelve hours later, the same code produces a model that performs much worse than the production baseline. Ordinary software CI did its job, but it never tested the new artifact created by training.

**Training CI** extends continuous integration across the full model-producing computation. Code, data, configuration, dependencies, and the runtime environment can all change the result. The workflow therefore has to collect evidence in stages: first that local logic works, then that the real environment and integrations work, and finally that full training produces an identifiable model that meets the acceptance policy.

The cost of those checks rises quickly, so the system also needs rules for which changes trigger them, how retries remain isolated, and how the exact tested artifact moves forward. Use these questions to follow one change from a pull request to trustworthy model evidence:

1. **What Evidence Must Training CI Collect for an ML Change?**
2. **What Belongs in the Four Training CI Tiers?**
3. **How Does Full Training Show Whether a Candidate Is Acceptable?**
4. **How Do Evidence, Provenance, and Artifact Identity Stay Connected?**
5. **How Do Retries and Change Triggers Avoid Corrupting CI?**
6. **How Does a Complete Training CI Flow Decide What to Run?**
7. **How Do Long-Running CI Jobs Stay Reproducible and Diagnosable?**
8. **What Does a Green Training CI Result Actually Mean?**

## What Evidence Must Training CI Collect for an ML Change?
<!-- section-summary: Training CI gathers progressively stronger evidence about changes to code, data, configuration, dependencies, and infrastructure before trusting a new model. -->

A passing unit test cannot answer whether a changed training recipe still produces an acceptable model. Training CI begins by defining the claims that need evidence.

Training CI is the part of an ML engineering system that asks:

> **When training code, data logic, dependencies, or infrastructure changes, what evidence do we need before trusting the resulting model?**

Ordinary CI often answers a narrower question:

“Does the software still build and pass its tests?”

Training CI must answer more:

```text
Does the code work
Does the training environment build
Can it talk to the real infrastructure
Can training complete
Does it produce a valid model
Is that model good enough
Can we prove exactly what produced it
```

The important shift is that ML training is not just compilation or application startup. Training itself is a computation that produces a new software artifact:

$$
(\text{code},\text{data},\text{configuration},\text{environment})
\xrightarrow{\text{training}}
\text{model}
$$

So Training CI is best understood as a system for **collecting evidence about that computation before the result is trusted or released**. Suppose a pull request changes:

```python
learning_rate = 0.001
```

to:

```python
learning_rate = 0.01
```

The Python file may:

```text
parse successfully
pass linting
pass unit tests
build into a container
```

and yet the resulting model may become much worse. Likewise, suppose someone changes:

```python
feature = log(income)
```

to:

```python
feature = income
```

Everything may execute successfully. But model quality could change dramatically. Therefore:

$$
\text{software correctness}
\not\Rightarrow
\text{model correctness}
$$

Training CI exists because ML systems need evidence at several levels. It helps to be precise. Training CI cannot prove:

“This model will always work perfectly in production.”

No finite test can establish that. What CI can establish is a collection of narrower claims.

For example:

```text
Claim 1:
The changed Python code passes unit tests.

Claim 2:
The training container can be built.

Claim 3:
The training job can authenticate to the feature store.

Claim 4:
The pipeline can train successfully on representative data.

Claim 5:
The resulting model exceeds minimum evaluation thresholds.

Claim 6:
The candidate has not regressed excessively versus the current model.

Claim 7:
The produced model can be traced back to the exact code, data,
configuration, and environment used to create it.
```

Training CI is therefore not a binary concept of:

```text
tested / untested
```

It is more like an accumulating body of evidence. Suppose a change enters CI. At the beginning, confidence is low. You can run increasingly expensive tests:

$$
E_1 \rightarrow E_2 \rightarrow E_3 \rightarrow E_4
$$

where:

```text
E1 = cheap local software checks
E2 = training environment / container check
E3 = real infrastructure integration check
E4 = full training and model evaluation
```

Each stage gives stronger evidence, but costs more.

For example:

| Stage           |    Time |   Cost | What it tells you                                      |
| --------------- | ------: | -----: | ------------------------------------------------------ |
| Unit tests      | seconds |   tiny | local logic works                                      |
| Container build | minutes |    low | training environment is constructible                  |
| Integration     | minutes | medium | real dependencies work                                 |
| Full training   |   hours |   high | candidate model can actually be produced and evaluated |

This suggests the central optimization problem of Training CI:

$$
\boxed{
\text{maximize useful confidence while minimizing unnecessary compute}
}
$$

You do not want every typo to launch a 64-GPU training job. But you also do not want serious training changes to merge after nothing more than linting. Suppose there are three pull requests.

### Change A

```text
README typo
```

### Change B

```text
training container dependency upgraded
```

### Change C

```text
label-generation logic changed
```

These have very different risks. Running identical CI for all three is wasteful. A better mental model is:

$$
\text{required evidence}
=
f(\text{what changed}, \text{risk of change})
$$

For example:

```text
documentation only
    ↓
maybe no training CI

unit-test-only utility code
    ↓
fast tests

Dockerfile or dependency changes
    ↓
fast tests + container build

feature pipeline changes
    ↓
fast tests + smoke training + possibly full evaluation

training algorithm changes
    ↓
full training and evaluation

deployment interface changes
    ↓
training + serialization + serving compatibility tests
```

This is sometimes called **change-aware CI**. The idea is simple:

Spend expensive verification where the change could realistically invalidate expensive assumptions.

## What Belongs in the Four Training CI Tiers?
<!-- section-summary: The four tiers move from controlled local checks to the real environment, protected integrations, and full training on representative infrastructure. -->

Those claims differ in cost and realism, so the workflow collects them through four progressively stronger tiers.

The first tier should usually be runnable without expensive infrastructure. You want these checks to be:

```text
fast
cheap
deterministic
parallelizable
safe
easy to reproduce locally
```

Typical checks include:

```text
linting
type checking
unit tests
data transformation tests
schema tests
configuration validation
pipeline graph validation
tiny synthetic smoke tests
```

For example:

```bash
pytest tests/unit
pytest tests/data_contracts
python validate_pipeline.py
```

Ideally these do not require:

```text
production databases
cloud GPUs
real feature stores
real model registries
large datasets
```

Why? Because the first job of CI is to reject obviously broken changes quickly. If:

```python
normalize_age()
```

is broken, there is no reason to spend money building a large training cluster. So the ordering should generally be:

$$
\text{cheap failure detection}
\rightarrow
\text{expensive validation}
$$

External services introduce additional variables:

```text
network failures
authentication failures
quota failures
service outages
rate limits
temporary latency
environment drift
```

Suppose a unit test fails because a staging database is unavailable. Did your feature function break? Or did the network break You have contaminated a small test with unrelated failure modes. Therefore Tier 1 usually uses:

```text
mocks
fakes
local files
in-memory databases
synthetic test data
```

The goal is not to prove external integration yet. It is to answer:

**Does our own code behave correctly under controlled conditions?**

Passing Python tests does not prove that the production training environment can be created. Suppose training runs inside a container. Your actual training environment may depend on:

```text
Python version
CUDA version
OS libraries
compiler versions
system packages
ML frameworks
native extensions
environment variables
entrypoints
```

The repository may look fine while:

```dockerfile
RUN pip install some-library==7.2
```

fails. Or a new version of PyTorch may conflict with the installed CUDA version. So CI should often build the same artifact that training will actually use:

```text
source code
   ↓
Docker build
   ↓
training image
```

Conceptually:

$$
\text{source}
\xrightarrow{\text{build}}
I
$$

where $$I$$ is the immutable training image. Then later stages should ideally train using **that exact image**. This matters because otherwise you can accidentally test:

```text
environment A
```

and train with:

```text
environment B
```

which weakens the evidence. Suppose the CI system successfully creates:

```text
training-image:sha256:abc123...
```

That digest identifies the exact image contents. Now full training can consume:

```text
training-image@sha256:abc123...
```

instead of rebuilding something later. This has an important property:

$$
\text{artifact tested}
=
\text{artifact used}
$$

That is stronger than:

```text
“We tested something built from approximately the same source.”
```

The broader principle is:

> **Promote tested artifacts forward; do not casually rebuild supposedly equivalent artifacts at every stage.**

Mocks are useful, but they are not reality. Suppose your code says:

```python
feature_store.read_features(...)
```

A mock can prove:

```text
your code calls the expected method
```

But it cannot prove:

```text
credentials are valid
network policy allows access
the deployed schema matches your assumptions
the installed client version works
permissions are sufficient
serialization formats match
```

Eventually you need tests against real systems. But ideally not against production. Use a protected test or staging environment such as:

```text
staging feature store
sandbox object bucket
temporary database
test model registry
isolated cloud project
```

Then test:

```text
Can the training job authenticate
Can it read the required data
Can it write artifacts
Can it register a model
Can downstream services consume the result
```

These are integration tests. A CI job is automated. Automation plus production credentials can be dangerous. Imagine a broken test that executes:

```python
delete_all_models()
```

against the production registry. Or:

```python
overwrite_training_dataset()
```

against the real dataset. A safer design gives CI credentials with narrowly scoped permissions.

For example:

```text
read staging features
write only to ci/<job-id>/
register only under test namespace
cannot modify production models
cannot deploy production endpoints
```

This is an application of least privilege:

$$
\text{CI permissions}
\subseteq
\text{minimum permissions required by the test}
$$

The testing environment should assume that broken code will eventually run. Because it will. At some point, the strongest useful test may simply be:

Run the real training process.

For example:

```text
same training image
same pipeline
representative/full dataset
real training hardware
real hyperparameters
real evaluation code
```

This answers questions lower tiers cannot. Such as:

```text
Does training converge
Does it fit in GPU memory
Does distributed training work
Does the job finish
Does checkpointing work
Are model artifacts generated
Does evaluation run
```

A tiny smoke test might pass while full training fails at epoch 30 because of:

```text
memory growth
data corruption in later shards
checkpointing bugs
rare categories
distributed synchronization
```

Therefore full training is qualitatively different from tiny CI tests.

![Four training CI tiers add cost and authority from fast pull-request checks through full training](/content-assets/articles/article-mlops-mlops-infrastructure-ci-for-training-workflows/training-ci-tiers.png)

*Training CI spends more compute and grants more authority only when the change requires evidence from the next tier.*

## How Does Full Training Show Whether a Candidate Is Acceptable?
<!-- section-summary: A full run must preserve structured evidence and pass execution, quality, baseline, slice, and policy checks rather than merely exit successfully. -->

The final tier produces a real candidate, which means success must include both a completed computation and an acceptable evaluation result.

Suppose CI says:

```text
FULL TRAINING: PASS
```

That is not enough information. A useful training job should emit structured evidence such as:

```text
model artifact
evaluation metrics
training logs
dataset version
code commit SHA
container digest
hyperparameters
random seed
training duration
hardware type
evaluation dataset version
```

For example:

```text
commit:
    89af31c

container:
    sha256:7bd...

dataset:
    customer_churn_v184

training config:
    lr=0.001
    epochs=20
    hidden_size=512

metrics:
    AUC=0.913
    F1=0.842

artifact:
    model://candidate/89af31c
```

Now the CI result is auditable. Training might finish with:

```text
exit code 0
```

while producing a terrible model. So after:

$$
\text{train}(D,\theta) \rightarrow M
$$

you must evaluate:

$$
\text{evaluate}(M,D_{\text{eval}})
\rightarrow
\text{metrics}
$$

Then define acceptance criteria.

For example:

$$
AUC \ge 0.90
$$

and perhaps:

$$
F1 \ge 0.80
$$

and:

$$
\text{inference latency} < 100ms
$$

depending on the system. The training job becomes a CI success only if both:

$$
\text{execution succeeds}
$$

and:

$$
\text{model satisfies release constraints}
$$

Absolute thresholds can be misleading. Suppose your requirement says:

$$
AUC \ge 0.80
$$

Production currently has:

$$
AUC = 0.94
$$

A candidate with:

$$
AUC = 0.81
$$

technically passes the absolute threshold but is probably a serious regression. So Training CI often compares:

$$
M_{\text{candidate}}
\quad\text{vs}\quad
M_{\text{baseline}}
$$

For example:

$$
AUC_{\text{candidate}}
\ge
AUC_{\text{baseline}} - 0.005
$$

You might also require:

$$
Latency_{\text{candidate}}
\le
Latency_{\text{baseline}} \times 1.10
$$

and:

$$
Size_{\text{candidate}}
\le
2\text{ GB}
$$

This creates a multi-dimensional release gate. Not every metric should necessarily block a pull request. Suppose:

```text
AUC changed from 0.912 to 0.911
```

Maybe that's acceptable. But:

```text
model artifact is missing
```

is clearly fatal. It is useful to separate:

### Hard gates

Failure means the candidate cannot proceed.

For example:

```text
training crashed
model cannot load
AUC below minimum
critical slice fails
security scan fails
```

### Informational evidence

Useful for review but not automatically blocking.

For example:

```text
training time increased 4%
model size increased 3%
some secondary metric moved slightly
```

This prevents CI from becoming a fragile wall of arbitrary thresholds. CI can start because of different events:

```text
pull request opened
new commit pushed
branch merged
scheduled nightly run
new dataset version
new base image
dependency update
manual release request
```

These events do not all need identical jobs.

For example:

```text
pull request
    ↓
Tier 1 + Tier 2

merge to main
    ↓
Tier 1 + Tier 2 + Tier 3

nightly
    ↓
full training

release candidate
    ↓
full training + evaluation + approval
```

Another system might do full training on every important PR. The exact policy depends on:

$$
\text{cost}
+
\text{risk}
+
\text{training duration}
+
\text{team velocity}
$$

Some CI jobs should be automatic. Others may deserve explicit approval. Imagine a training job that costs £5,000 and uses 128 GPUs. You probably do not want any external contributor to trigger it by modifying a comment. So a workflow might be:

```text
PR opened
   ↓
cheap automatic checks
   ↓
maintainer reviews change
   ↓
approve expensive training
   ↓
full training
   ↓
metrics reviewed
```

Similarly, production release may require a stronger boundary:

```text
training succeeded
        ↓
evaluation passed
        ↓
human / policy approval
        ↓
model registered as production candidate
```

Approval is particularly useful where CI crosses a boundary involving:

```text
large cost
sensitive data
production access
deployment
regulatory evidence
```

## How Do Evidence, Provenance, and Artifact Identity Stay Connected?
<!-- section-summary: Caches accelerate work, while immutable evidence links the exact code, data, environment, run, evaluation, and promoted model through one chain of custody. -->

Evaluation is useful only when it remains attached to the exact artifact and the inputs that produced it, not to a mutable name or disposable cache.

This distinction is subtle and extremely important. Suppose downloading the training dataset takes 20 minutes. You may cache it. Suppose installing dependencies takes 10 minutes. You may cache them. Caches accelerate computation. But a cache does **not** prove correctness. Consider:

```text
cache:
    /home/runner/.cache/pip
```

You should think:

“This makes the job faster.”

Not:

“This proves which environment trained the model.”

Similarly:

```text
cached model checkpoint
```

may make a test faster, but it is not necessarily the model artifact that should be released. This gives an important separation:

$$
\text{cache} \neq \text{evidence artifact}
$$

Evidence is something you deliberately preserve because it proves what happened. Examples:

```text
container digest
commit SHA
dataset version
training configuration
evaluation report
signed model artifact
test logs
provenance manifest
```

Caches are disposable. Evidence should be reproducible or traceable. You should be able to delete every cache and still understand:

```text
which model was trained
from which source
with which data
using which environment
and why it was accepted
```

A trained model does not come from one thing. It comes from a set of dependencies:

```text
source commit ──────────────┐
                            │
training container ─────────┤
                            │
dataset version ────────────┤
                            ├──► training run ─► model
configuration ──────────────┤
                            │
hyperparameters ────────────┤
                            │
hardware/runtime ───────────┘
```

We can express this abstractly as:

$$
M = T(C,D,E,H,S)
$$

where:

* $$C$$ = code,
* $$D$$ = data,
* $$E$$ = environment,
* $$H$$ = hyperparameters/configuration,
* $$S$$ = stochastic state such as random seeds.

A trustworthy training system should record these inputs. Otherwise the model becomes an orphan artifact:

```text
model.pkl
```

with no reliable explanation of where it came from. Suppose PR #482 changes feature engineering. Training CI produces:

```text
candidate model:
churn-model/89af31c

AUC:
0.913

baseline:
0.909

training run:
run-78213
```

Those results should be visible from the pull request. A reviewer should not have to search through an unrelated ML platform to discover what happened.

Conceptually:

```text
Pull Request
    │
    ├── code diff
    ├── CI status
    ├── training run
    ├── evaluation report
    └── candidate model
```

Now code review and model review are connected. That gives reviewers a much stronger question than:

“Does this code look reasonable?”

They can also ask:

“What happened when we actually trained it?”

Suppose the candidate model from the PR is approved. A weak release process might run training again:

```text
PR training
     ↓
looks good
     ↓
merge
     ↓
train completely new model
     ↓
deploy that instead
```

Now what did the reviewer actually approve Potentially not the model that went to production. A stronger process is:

```text
PR
 │
 ▼
training run
 │
 ▼
candidate model M
 │
 ▼
evaluation passes
 │
 ▼
M is approved
 │
 ▼
same M promoted
 │
 ▼
production
```

In other words:

$$
\boxed{
\text{test once, promote the tested artifact}
}
$$

rather than:

$$
\text{test one artifact, rebuild another, deploy the second}
$$

when the system allows artifact promotion. Imagine you produced:

```text
model digest:
sha256:a9f1...
```

That exact model was evaluated. Release should ideally refer to:

```text
sha256:a9f1...
```

not:

```text
latest
```

Why? Because mutable names destroy certainty. Today:

```text
latest = sha256:a9f1
```

Tomorrow:

```text
latest = sha256:f72b
```

Now the release record says “latest,” but you no longer know what that meant. Immutable identifiers turn statements like:

“This model passed CI.”

into something verifiable.

## How Do Retries and Change Triggers Avoid Corrupting CI?
<!-- section-summary: Isolated attempts, retained diagnostics, explicit retry rules, and conservative change detection keep repeated or selectively triggered jobs trustworthy. -->

Once CI preserves identity, it can retry failed infrastructure safely and decide which code, data, configuration, or dependency changes require expensive validation.

CI systems fail for reasons unrelated to your code:

```text
runner crashed
network timed out
cloud API returned 503
spot GPU disappeared
registry briefly unavailable
```

You need to rerun jobs. Therefore good CI jobs should be **idempotent** where possible. Idempotent means approximately:

$$
f(f(x)) = f(x)
$$

Operationally:

Running the same job twice should not create dangerous or contradictory side effects.

Suppose a training job writes to:

```text
models/candidate/latest
```

and a rerun overwrites it. That may be risky. Instead, use a unique identity such as:

```text
models/candidates/
    commit-89af31c/
        run-001/
```

A rerun might create:

```text
run-002/
```

or safely overwrite only its own isolated temporary namespace. Every CI run should ideally know:

```text
repository
commit
PR
workflow
job
attempt
```

Then resources can be namespaced.

For example:

```text
s3://ml-ci/
    pr-482/
      commit-89af31c/
        attempt-2/
```

The same principle can apply to:

```text
temporary database schemas
feature-store namespaces
model registry versions
cloud jobs
checkpoints
logs
```

Now a failed attempt is much less likely to contaminate the next attempt. Suppose CI creates:

```text
temporary GPU job
temporary bucket prefix
staging database schema
```

After CI finishes, cleanup is sensible. But imagine cleanup executes before failure logs are preserved. Now your job says:

```text
FAILED
```

and all useful evidence is gone. A better pattern is:

```text
run job
   ↓
capture logs and evidence
   ↓
mark result
   ↓
clean disposable infrastructure
```

This reflects another useful distinction:

```text
temporary execution resources
        ≠
diagnostic evidence
```

The former can disappear. The latter may need retention. Suppose CI reaches:

```text
1. create staging dataset
2. start training
3. upload half a checkpoint
4. fail
```

What happens when rerun begins? If it assumes step 1 has never happened, it may fail. If it treats the partial checkpoint as complete, worse problems can occur. Good jobs either:

```text
start from clean isolated resources
```

or:

```text
validate and resume explicitly from known checkpoints
```

They should not silently depend on accidental leftovers from a previous run. Suppose a job sometimes fails because:

```text
model evaluation intermittently returns NaN
```

Automatically retrying three times may turn:

```text
fail
fail
pass
```

into a green check. But the system is still unstable. Retries are appropriate for failures likely to be transient:

```text
HTTP 503
temporary DNS failure
preempted worker
```

They are dangerous when used to hide deterministic or stochastic correctness problems. A useful mental distinction is:

$$
\text{transient infrastructure failure}
\Rightarrow
\text{retry may help}
$$

whereas:

$$
\text{training correctness failure}
\Rightarrow
\text{retry may hide the bug}
$$

ML models can change even if the code does not. Suppose:

```text
code version = same
training data = new
```

The resulting model may be different. Therefore CI may sometimes need to trigger on:

```text
new dataset version
new labels
new features
new upstream data snapshot
```

Not only:

```text
git push
```

This is one of the biggest conceptual differences from ordinary CI. In software CI, source control changes are usually the primary cause of a new artifact. In ML:

$$
\text{new model}
$$

can be caused by:

$$
\text{new code}
\quad\text{or}\quad
\text{new data}
\quad\text{or}\quad
\text{new configuration}
\quad\text{or}\quad
\text{new environment}
$$

Therefore the triggering system may need to understand all four. Consider:

```yaml
learning_rate: 0.001
batch_size: 128
epochs: 20
```

This configuration can radically affect the resulting model. Yet teams sometimes treat YAML configuration as less important than Python code. From the training function:

$$
M=T(C,D,H,E)
$$

the configuration $$H$$ is one of the direct inputs to the model. So changes to:

```text
hyperparameters
feature flags
dataset selectors
architecture settings
preprocessing options
```

should often trigger appropriate CI. “Only config changed” does not imply “nothing important changed.” Suppose application code is unchanged, but:

```text
pytorch 2.x → 3.x
```

or:

```text
CUDA version changes
```

or:

```text
tokenizer library changes
```

That can alter:

```text
training behavior
numerical results
model serialization
GPU compatibility
runtime memory
inference outputs
```

So dependency manifests are part of the training input. This is why container-building and environment validation deserve their own CI tier.

![Trusted and untrusted CI lanes show how OIDC grants a temporary sandbox role without exposing cloud credentials to fork code](/content-assets/articles/article-mlops-mlops-infrastructure-ci-for-training-workflows/short-lived-identity-boundary.png)

*The trust policy grants short-lived sandbox access to a reviewed workflow. Fork code remains in a restricted runner with no route to cloud credentials.*

## How Does a Complete Training CI Flow Decide What to Run?
<!-- section-summary: A change-aware decision tree selects proportionate checks and records exactly which model and evaluation evidence passed for each proposed change. -->

Those policies combine into a decision tree that selects checks, publishes their evidence, and promotes the already-tested artifact.

Consider a pull request that changes a feature transformation. A sophisticated CI system might do this:

```text
Developer opens PR
        │
        ▼
Detect changed files
        │
        ▼
Tier 1
Unit + schema + DAG tests
        │
        ▼
Tier 2
Build training image
        │
        ▼
Run tiny training smoke test
        │
        ▼
Protected integration tests
        │
        ▼
Human / policy approval if needed
        │
        ▼
Full training
        │
        ▼
Evaluate candidate
        │
        ├── compare to absolute thresholds
        ├── compare to baseline
        └── evaluate important slices
        │
        ▼
Publish evaluation evidence to PR
        │
        ▼
Reviewer approves
        │
        ▼
Merge
        │
        ▼
Promote already-tested model/image
```

Notice that the system does not ask one giant question. It asks a sequence of increasingly expensive questions. You can model it explicitly. Suppose:

$$
C = \text{class of change}
$$

Then:

$$
C \in
\{
\text{docs},
\text{code},
\text{data},
\text{training},
\text{infra}
\}
$$

And define required checks:

$$
R(C)
$$

For example:

$$
R(\text{docs})
=
\{\text{lint}\}
$$

$$
R(\text{code})
=
\{\text{unit},\text{contract},\text{container}\}
$$

$$
R(\text{training})
=
\{\text{unit},\text{container},\text{smoke},\text{full train},\text{evaluation}\}
$$

$$
R(\text{infra})
=
\{\text{container},\text{integration},\text{smoke}\}
$$

Real policies are more complicated, but this mental model is useful. Suppose `feature_utils.py` is shared by 20 models. Someone changes it. A naive rule might fail to notice that model 17 depends on it. Then Training CI skips model 17 even though its behavior changed. So:

$$
\text{change-aware CI}
$$

depends on having a reasonably accurate dependency graph. When uncertain, systems should generally err toward **more validation**, not less. Saving compute is useful. Silently missing important changes is worse. Suppose a dashboard says:

```text
AUC = 0.918
```

That number is nearly meaningless without context. You need to ask:

```text
For which model
Generated from which commit
Using which dataset
Using which evaluation dataset
Using which metric implementation
Using which configuration
```

A metric is evidence only when attached to identity. A useful evidence record might be modeled as:

$$
E =
(M,C,D,E_v,H,V,R)
$$

where:

* $$M$$: model identity
* $$C$$: code revision
* $$D$$: training data version
* $$E_v$$: evaluation data version
* $$H$$: configuration
* $$V$$: runtime/environment
* $$R$$: evaluation result

Without those relationships, CI results can become misleading. There is a useful analogy to evidence handling. A model moves through:

```text
training
   ↓
evaluation
   ↓
approval
   ↓
registry
   ↓
release
```

At every step, you want to maintain identity. Suppose you evaluated:

```text
model A
```

but accidentally deploy:

```text
model B
```

Then all evaluation evidence is irrelevant. So the chain should preserve:

$$
M_{\text{trained}}
=
M_{\text{evaluated}}
=
M_{\text{approved}}
=
M_{\text{released}}
$$

That equality is conceptually one of the strongest guarantees Training CI can provide.

## How Do Long-Running CI Jobs Stay Reproducible and Diagnosable?
<!-- section-summary: Asynchronous orchestration should call independently runnable verification commands, localize failures, parallelize independent evidence, and justify expensive checks by risk. -->

Because full training may run for hours on another platform, the CI architecture must preserve responsibility while keeping verification reproducible and failures easy to locate.

Some training jobs take hours or days. So unlike ordinary CI:

```text
compile → test → done
```

Training CI may involve long-running compute jobs and external ML platforms. Architecturally, the CI system may do:

```text
CI
 │
 ├── submit training job
 │
 ▼
training platform
 │
 ├── GPU cluster
 ├── checkpoints
 └── evaluation
 │
 ▼
result returned to CI
```

The conceptual responsibility remains the same:

CI owns the acceptance decision, even if another platform performs the training computation.

GitHub Actions, GitLab CI, Jenkins, Buildkite, or another orchestrator may execute:

```text
train-model
```

But the correctness logic should live in independently runnable commands.

For example:

```bash
make test-fast
make build-training-image
make test-integration
make train
make evaluate
make compare-baseline
```

CI decides:

```text
when
where
under what credentials
in what sequence
```

The repository defines:

```text
what these operations actually mean
```

That keeps the system reproducible outside CI. Imagine one gigantic job:

```text
train-and-release
```

It fails after four hours. The logs contain:

```text
ERROR
```

This is poor CI design. Better:

```text
unit-tests             PASS
container-build        PASS
feature-store-test     PASS
smoke-training         PASS
full-training          PASS
evaluation             FAIL
```

Now the failure itself tells you something. The CI graph is not merely execution machinery. It is also a diagnostic structure. Not every CI stage must be sequential. Suppose after the training container builds, you can independently run:

```text
security scan
integration tests
serialization test
dependency check
```

Then:

```text
             container build
                 /   |   \
                /    |    \
       security   integration   serialization
                \    |    /
                 \   |   /
                  full training
```

Parallelism reduces wall-clock time. But only parallelize checks that do not logically depend on one another. You should not run model-quality evaluation before a model exists. Imagine full training costs:

$$
\$500
$$

A certain class of changes has only a 0.01% chance of affecting training. Perhaps full training is unnecessary on every such change. But suppose label-generation code changes. The probability of affecting the model is nearly certain. Then skipping training would be hard to justify. You can think approximately in terms of:

$$
\text{run expensive check if}
$$

$$
\text{expected risk reduction}

\text{compute + delay cost}
$$

This is not usually computed numerically, but it is the correct underlying reasoning.

## What Does a Green Training CI Result Actually Mean?
<!-- section-summary: A green result means the checks required by a stated policy passed; trust depends on how relevant and strong that collected evidence actually is. -->

The result is best understood as evidence gathered under a policy, rather than a badge that makes a universal claim about model safety.

A green CI badge does not magically mean:

```text
model is safe
```

It means:

All checks required by the current policy have passed.

So trust depends on the quality of that policy. If CI only runs:

```text
flake8
```

then “CI passed” says almost nothing about an ML model. If CI runs:

```text
unit tests
data contracts
container validation
staging integration
full training
quality regression
slice evaluation
artifact provenance
```

then the green result carries much more information. Thus:

$$
\text{confidence from CI}
\propto
\text{strength and relevance of evidence collected}
$$

not merely whether the badge is green. You can compress most Training CI systems into four questions.

### Tier 1 — Is our code internally plausible

```text
unit tests
contracts
DAG checks
small local smoke tests
```

Question:

$$
\boxed{\text{Did we break our own logic?}}
$$

### Tier 2 — Can we construct the real training environment

```text
container build
dependency resolution
runtime validation
```

Question:

$$
\boxed{\text{Can the software actually run where training runs?}}
$$

### Tier 3 — Can the training system interact with reality

```text
staging storage
feature store
registry
cloud APIs
credentials
```

Question:

$$
\boxed{\text{Do the boundaries between our code and infrastructure work?}}
$$

### Tier 4 — Does real training produce an acceptable model

```text
full training
evaluation
baseline comparison
release gates
```

Question:

$$
\boxed{\text{Did the entire ML process produce something worth releasing?}}
$$

That is a much more useful model than simply thinking:

```text
CI = automated testing
```

Training CI is fundamentally a **progressive proof system for ML changes**. You begin with a proposed change:

$$
\Delta
$$

and progressively ask stronger questions:

```text
Does the local logic work
        ↓
Can the environment be built
        ↓
Can the code interact with real infrastructure
        ↓
Can full training complete
        ↓
Does the resulting model satisfy quality requirements
        ↓
Can we trace and promote exactly what passed
```

The ordering matters because cost and scope increase as you move downward. So a strong Training CI system generally follows:

$$
\boxed{
\text{cheap evidence first}
\rightarrow
\text{expensive evidence later}
}
$$

while preserving the exact identity of:

$$
\boxed{
\text{code}
+
\text{data}
+
\text{configuration}
+
\text{environment}
+
\text{model}
+
\text{evaluation}
}
$$

The most important practical principle is:

**Training CI should not merely tell you that a job ran successfully. It should tell you exactly what was tested, what model was produced, what evidence justified accepting it, and ensure that the same accepted artifact is the one that eventually moves toward release.**

That is what turns CI from “automated commands after a Git push” into a trustworthy ML engineering system.

![The training CI journey links changed paths and fast checks to immutable inputs managed training and a reproducible release record](/content-assets/articles/article-mlops-mlops-infrastructure-ci-for-training-workflows/training-ci-evidence-summary.png)

*A durable evidence chain ties the release decision to the reviewed commit, exact image and configuration, data snapshot, training job, and model identity. A controlled rerun starts from that same manifest.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Evidence Must Training CI Collect for an ML Change?]{kind="recap"}
Training CI gathers progressively stronger evidence about changes to code, data, configuration, dependencies, and infrastructure before trusting a new model.
:::

:::expand[What Belongs in the Four Training CI Tiers?]{kind="recap"}
The four tiers move from controlled local checks to the real environment, protected integrations, and full training on representative infrastructure.
:::

:::expand[How Does Full Training Show Whether a Candidate Is Acceptable?]{kind="recap"}
A full run must preserve structured evidence and pass execution, quality, baseline, slice, and policy checks rather than merely exit successfully.
:::

:::expand[How Do Evidence, Provenance, and Artifact Identity Stay Connected?]{kind="recap"}
Caches accelerate work, while immutable evidence links the exact code, data, environment, run, evaluation, and promoted model through one chain of custody.
:::

:::expand[How Do Retries and Change Triggers Avoid Corrupting CI?]{kind="recap"}
Isolated attempts, retained diagnostics, explicit retry rules, and conservative change detection keep repeated or selectively triggered jobs trustworthy.
:::

:::expand[How Does a Complete Training CI Flow Decide What to Run?]{kind="recap"}
A change-aware decision tree selects proportionate checks and records exactly which model and evaluation evidence passed for each proposed change.
:::

:::expand[How Do Long-Running CI Jobs Stay Reproducible and Diagnosable?]{kind="recap"}
Asynchronous orchestration should call independently runnable verification commands, localize failures, parallelize independent evidence, and justify expensive checks by risk.
:::

:::expand[What Does a Green Training CI Result Actually Mean?]{kind="recap"}
A green result means the checks required by a stated policy passed; trust depends on how relevant and strong that collected evidence actually is.
:::
