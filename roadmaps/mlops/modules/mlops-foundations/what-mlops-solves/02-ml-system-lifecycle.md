---
title: "ML System Lifecycle"
description: "Follow the controlled states and handoffs that carry an ML system from a product decision through data, training, release, operation, feedback, and retirement."
overview: "An ML system moves through defined states only after evidence satisfies an explicit gate, and production evidence determines whether the next step is repair, retraining, redefinition, or retirement."
tags: ["MLOps", "core", "lifecycle"]
order: 2
id: "article-mlops-mlops-foundations-ml-system-lifecycle"
aliases:
  - roadmaps/mlops/modules/mlops-foundations/what-mlops-solves/03-ml-system-lifecycle.md
  - child-what-mlops-solves-03-ml-system-lifecycle
---

## Table of Contents

1. [Why Is the ML Lifecycle a Gated Feedback Loop?](#why-is-the-ml-lifecycle-a-gated-feedback-loop)
2. [What Must Be Defined Before Data Preparation?](#what-must-be-defined-before-data-preparation)
3. [What Evidence Makes Data Ready for Training?](#what-evidence-makes-data-ready-for-training)
4. [How Does Training Produce a Reproducible Candidate?](#how-does-training-produce-a-reproducible-candidate)
5. [How Is the Complete Candidate Evaluated and Approved?](#how-is-the-complete-candidate-evaluated-and-approved)
6. [How Is an Approved Model Released and Observed?](#how-is-an-approved-model-released-and-observed)
7. [How Does Production Evidence Choose the Next Action?](#how-does-production-evidence-choose-the-next-action)
8. [How Does Retirement Remove the System Safely?](#how-does-retirement-remove-the-system-safely)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Suppose a team trains a new fraud model. The model has a higher average score than the current version, but that does not yet make it safe to release. The team still needs to check the target and training data. It also needs to test important customer groups and confirm that the serving package meets its latency limit.

If those checks pass, the team can approve and release the model gradually. After release, it watches service health, input data, predictions, confirmed fraud, false declines, and customer impact. The evidence may support wider rollout, a repair, a rollback, or a new training cycle.

That full journey is the **ML system lifecycle**. It begins with the decision the model should support, moves through data, training, evaluation, approval, release, and operation, and ends when the model and its dependencies are safely retired.

Each step has a clear result. Data preparation publishes a known dataset. Training produces a named candidate. Evaluation produces evidence for or against release. Approval records the decision. Deployment exposes a specific version. Monitoring shows what the live system is doing. Feedback supplies later outcomes. Retirement removes traffic, schedules, credentials, and storage that are no longer needed. If one result is missing, the next step has to guess.

That guess creates avoidable risk.

Recorded evidence removes the guess.

Follow one model through that journey by answering these questions:

1. **Why Is the ML Lifecycle a Gated Feedback Loop?**
2. **What Must Be Defined Before Data Preparation?**
3. **What Evidence Makes Data Ready for Training?**
4. **How Does Training Produce a Reproducible Candidate?**
5. **How Is the Complete Candidate Evaluated and Approved?**
6. **How Is an Approved Model Released and Observed?**
7. **How Does Production Evidence Choose the Next Action?**
8. **How Does Retirement Remove the System Safely?**

## Why Is the ML Lifecycle a Gated Feedback Loop?
<!-- section-summary: Each lifecycle state answers a different uncertainty, and evidence at a gate decides whether an ML system may advance, return for repair, or stop. -->

Ordinary software behavior often follows fairly directly from code. A function such as:

```python
def add_tax(price):
    return price * 1.20
```

has behavior that can largely be understood from its implementation and configuration. ML behavior is produced indirectly. Training first maps data to a model:

$$
D \rightarrow Train(D) \rightarrow M
$$

Production then maps an input through that model:

$$
X \rightarrow M(X) \rightarrow \hat{Y}
$$

A more complete training expression is:

$$
M = Train(D, F, C, H, E)
$$

where (D) is the dataset, (F) the feature definitions, (C) the training code, (H) the hyperparameters, and (E) the environment. The product decision may add feature construction and a policy around the score:

$$
Decision = Policy(M(Features(X)))
$$

Raw data, feature code, training code, configuration, model artifacts, serving code, business thresholds, infrastructure, and the production population can all change. Even if the model weights, code, and infrastructure stay fixed, future data may follow a different distribution:

$$
P_{future}(X,Y) \neq P_{training}(X,Y)
$$

Customers, products, prices, markets, language, and fraud tactics change. An ML system therefore needs repeated observation and adaptation rather than a build-once process.

The lifecycle assigns a question to each stage:

| Stage | Question the stage must answer |
| --- | --- |
| Define | Are we solving the right decision problem? |
| Prepare data | Do we have trustworthy, usable historical evidence? |
| Train | Can we produce a useful candidate reproducibly? |
| Evaluate | Is the complete production package good enough? |
| Approve | Are we willing and authorized to expose it? |
| Release | Can exposure increase without unacceptable risk? |
| Operate | Is the live system still functioning and useful? |
| Improve | Which part of the system should change? |
| Retire | Can active dependencies be removed while required history remains? |

Finishing an activity does not establish readiness for the next state. A gate requires evidence and exit criteria. A trained model might need AUC above 0.91, false-positive rate below 1%, inference below 80 milliseconds, available online features, passed security tests, and reproducible lineage. Failure of any required condition keeps the candidate from promotion.

The general form is:

$$
\boxed{\text{Stage} + \text{Evidence} + \text{Exit criteria}}
$$

This makes the lifecycle both a **state machine**, which controls individual versions, and a **feedback loop**, which explains how the overall system evolves.

### Treat Each Model Version as a State Machine

For one model version, a team can define a set of states:

$$
S = \{Development, Candidate, Approved, Deploying, Production, Retired\}
$$

A transition is valid only under named conditions. A candidate can enter `Approved` after validation passes. An approved version can enter `Production` after release checks pass. A failed candidate returns to development. A production incident may send traffic to an earlier version even though the faulty version still exists for investigation.

```text
Development
    ↓ training run produces an identified artifact
Candidate
    ├── validation fails ──→ Development
    └── validation passes → Approved
                                ↓ release checks pass
                            Deploying
                                ├── canary fails → rollback
                                └── canary passes
                                      ↓
                                  Production
                                      ↓ no remaining use
                                   Retired
```

The state name alone is insufficient. Lifecycle metadata should explain why the version is allowed in that state: which evaluation report passed, which person or automated policy approved it, which serving package was selected, and which release evidence justified the current traffic level.

This distinction prevents a registry from turning into a list of unexplained files. The operational question is not merely which models exist. It is which version is authorized for which use and which evidence supports that authorization.

![Candidate and approved states separated by an evidence-gated lifecycle transition](/content-assets/articles/article-mlops-mlops-foundations-ml-system-lifecycle/state-versus-transition.png)

*A completed training job creates a candidate state; a separate evidence gate authorizes the next state.*

## What Must Be Defined Before Data Preparation?
<!-- section-summary: Definition turns a broad business aim into a prediction target, moment, consumer, action, success measure, and set of operating constraints. -->

Data work begins after the intended decision is precise enough to test. “Predict which customers will churn” leaves several important choices unresolved.

The **prediction target** defines the outcome. One possible definition is:

$$
Y =
\begin{cases}
1 & \text{no purchase within 90 days} \\
0 & \text{otherwise}
\end{cases}
$$

The **prediction moment** states when the estimate must be available. Churn risk could be scored immediately after purchase, after 30 days without activity, or during a nightly batch. Each moment gives the model a different history.

The **available information** lists what can exist by that moment. The model output might be (P(\text{churn within 90 days})). A marketing system, customer-support team, or recommendation engine may consume it. The resulting action might send a retention incentive when risk exceeds `0.80`.

Operating constraints complete the definition:

```text
prediction latency < 200 ms
prediction cost < £0.001
customer consent requirements satisfied
false-positive rate below the approved threshold
```

The prediction matters only if it can improve a decision:

```text
prediction
    ↓
decision changes
    ↓
action changes
    ↓
real-world outcome improves
```

An accurate churn estimate has limited value if the consumer cannot take a useful action. The first gate should therefore confirm the prediction, consumer, intervention, success measure, and constraints before expensive modeling begins.

Definition also sets the later evaluation boundary. The team cannot choose representative time periods, useful slices, correct latency tests, or business metrics without knowing how the prediction will operate. A clear target and action keep the rest of the lifecycle attached to the original product need.

## What Evidence Makes Data Ready for Training?
<!-- section-summary: Data readiness requires point-in-time-correct rows, documented meaning, validated structure, trustworthy labels, representative sampling, lineage, and an identifiable version. -->

Historical data has to recreate the intended prediction situation. If prediction occurs at time (t), every feature must obey:

$$
\text{feature information time} \leq t
$$

For a churn prediction on January 1, purchases from the previous 90 days may be valid. A cancellation recorded on January 15 belongs to the future. Training with that later fact creates leakage and produces an unrealistic evaluation.

Having a table is only the beginning of data readiness. The team needs to understand:

- the schema and types, such as `customer_id: string`, `age: integer`, and `last_purchase: timestamp`;
- valid ranges, such as ages from 18 to 120 and nonnegative order values;
- which values are missing and why they are missing;
- whether `churn = true` actually implements the agreed target;
- which customers were sampled and which populations are absent;
- the historical period and time boundaries;
- the origin of each field;
- whether each value could have been known at its prediction moment.

Feature meaning must also agree across training and production. Suppose the training pipeline defines:

```python
customer_average_spend = total_spend / number_of_orders
```

If the serving code handles refunds, time windows, or missing orders differently, then:

$$
F_{training}(x) \neq F_{serving}(x)
$$

The model learned from one representation and receives another in production. A feature platform such as Feast can help keep definitions in a registry and support historical and online retrieval, but the lifecycle requirement comes first: the feature must carry the same semantics across both paths.

The data gate can require:

```text
required fields exist
schema rules pass
label definition is documented
leakage checks pass
time boundaries are correct
feature calculations are reproducible
the population fits the intended use
the dataset has an identifiable version
```

Passing this gate means training starts from a controlled input. It does not promise that the data will support a useful model; it establishes that the evidence is coherent enough for training results to mean something.

## How Does Training Produce a Reproducible Candidate?
<!-- section-summary: A training run is an identifiable function over versioned data, feature logic, code, parameters, environment, and random state, with lineage to its output artifact and metrics. -->

Two engineers can both call `train()` and obtain different results. The dataset, feature transformation, dependency versions, random seed, hyperparameters, runtime, or hardware may differ.

Treat one training run as:

$$
M_i = Train(D_i, C_i, F_i, H_i, E_i, S_i)
$$

where (S_i) represents random state. The run record should explain what entered, what process ran, and what came out:

```text
run: 428
dataset: customers_2026_07_31
features: feature-set-v17
code: git commit a8fe31d
algorithm: LightGBM
num_leaves: 64
learning_rate: 0.03
environment: pinned Python and LightGBM versions
ROC-AUC: 0.923
PR-AUC: 0.641
artifact: churn-model/run-428/model
```

This record links code, data, configuration, and feature definitions to the candidate. It also preserves failed and weaker runs, which can explain why a decision was made and prevent repeated dead ends.

Reproducibility may have a tolerance. Some algorithms and hardware introduce nondeterminism, so identical bytes are not always realistic. The practical requirement is to identify the exact inputs and process and reproduce behavior within an accepted range.

```text
code ───────────┐
data ───────────┼──→ training run ──→ model candidate
configuration ─┘
```

Experiment tracking records run inputs and results. A registry can connect the candidate back to its run and later manage an alias, version, or other lifecycle metadata. Current MLflow registry workflows support model versions, lineage, aliases, tags, and metadata. Its older fixed `Staging` and `Production` stage mechanism has been deprecated in favor of more flexible metadata. That change illustrates why the organization's conceptual states should not depend on one product's fixed names.

The training gate confirms that a candidate artifact was produced with enough lineage to understand and reproduce it. Training success alone does not approve the artifact for production.

### Record the History of the Run

Run lineage also preserves the route that did not lead to production. Suppose run 428 uses `num_leaves = 64` and reaches PR-AUC `0.641`, while run 429 changes the learning rate and performs worse on a critical slice. Retaining both records shows why the team selected one candidate and rejected another. Without the rejected run, a later engineer may repeat the same experiment or misinterpret the chosen parameters as arbitrary.

The record should identify inputs through immutable or otherwise stable references. A friendly dataset name such as `customers_latest` cannot explain a past run if the name later points elsewhere. The run needs the exact underlying version. The same applies to feature definitions, configuration, containers, dependency locks, and external resources that materially affected training.

Random seeds reduce one source of variation, but they do not control every library, accelerator, or distributed operation. A team should define what acceptable reproduction means for the application: perhaps the same evaluation metrics within a tolerance, the same predictions on a fixed golden set, or the same ordering for a ranking task. That standard is part of the training gate.

## How Is the Complete Candidate Evaluated and Approved?
<!-- section-summary: Evaluation tests the weights together with transformations, dependencies, inference code, thresholds, configuration, and post-processing; approval then applies product, policy, and operational judgment. -->

Production operates a package rather than naked weights. The package may contain:

```text
feature transformations
+ model weights
+ runtime dependencies
+ inference code
+ configuration
+ thresholds
+ post-processing rules
```

Call that package (P). The actual system executes:

$$
P(x) \rightarrow decision
$$

Evaluation therefore covers (P). Predictive checks can include precision, recall, F1, ROC-AUC, PR-AUC, RMSE, MAE, and calibration. The correct measures depend on the product question.

Slice evaluation looks for important failures hidden by an average. Overall accuracy of 94% can coexist with 97% for Group A and 75% for Group B. Regions, products, customer types, devices, time periods, and edge cases may need separate evidence.

Temporal evaluation often trains on the past and evaluates on a later period:

```text
train: January–June
validate: July
test: August
```

This arrangement more closely represents a future-facing deployment than an unsuitable random split.

System evaluation covers latency, memory, throughput, artifact size, startup time, dependency compatibility, and failure behavior. A slightly weaker predictive model may be the better package if it is much faster, cheaper, and more stable.

Business evaluation asks whether the prediction improves the real objective. A fraud system may estimate:

$$
\text{expected profit} =
\text{fraud prevented}
- \text{legitimate transactions blocked}
- \text{operating cost}
$$

Approval is a separate event. Evaluation states the evidence; approval decides whether the organization accepts the candidate under that evidence. A model with AUC `0.94` and latency `800 ms` fails a `100 ms` requirement despite its predictive score.

Approval can be expressed as:

$$
Approve = ModelQuality
\land SystemQuality
\land PolicyCompliance
\land OperationalReadiness
$$

An approved object needs an immutable identity:

```text
model: fraud-detector
version: 42
dataset: dataset-v103
training run: training-run-8491
evaluation: validation-report-42
approval: recorded
serving package: sha256:...
```

This identity supports release, rollback, debugging, and audit. It answers exactly which candidate the team has authorized.

### Keep Evaluation and Approval Separate

The separation matters because evidence and authority solve different problems. An automated evaluation job can report that all slice metrics pass, the package starts correctly, and P95 latency is 74 milliseconds. It cannot decide by itself whether a regulated use has completed the required review or whether the organization accepts the residual risk.

For a low-risk internal ranking model, approval may be fully automated after all gates pass. For a high-risk decision, the evidence may need domain, security, privacy, compliance, or clinical review. The lifecycle can support both by making the decision rule explicit.

Required assurance should rise with consequence. Early experiments can tolerate rough code and temporary datasets because their output remains private. A candidate deserves stronger data and evaluation controls because it may influence a release decision. A production model needs monitoring, rollback, incident ownership, and evidence retention because it affects real people or operations.

$$
\text{Required assurance} \propto \text{Potential consequence}
$$

This relationship explains why two ML products should not automatically share identical gates. A movie recommendation and a medical decision-support model can follow the same lifecycle shape while applying very different evidence thresholds and approval rules.

## How Is an Approved Model Released and Observed?
<!-- section-summary: Controlled exposure tests the approved package under real conditions, rollback limits release risk, and production monitoring separates service, data, and model health. -->

Offline and production environments differ. Real traffic introduces concurrency, network dependencies, load, unexpected inputs, latency variation, user effects, and business consequences. Immediate movement from zero to full traffic exposes all users before the team has production evidence.

A shadow release sends real requests to the candidate without allowing it to control decisions:

```text
                    ┌──→ current model → real decision
production request ─┤
                    └──→ candidate → result recorded only
```

This tests input compatibility, errors, latency, and prediction behavior safely.

A canary release gives the candidate a small share of traffic:

```text
95% → model v41
 5% → model v42
```

Exposure can rise through 25%, 50%, and 100% as evidence accumulates. If error rate or another gate fails, traffic returns to v41. Release planning must define both advancement and reversal.

![Shadow, canary, progressive, and full rollout stages compared by production exposure and evidence questions](/content-assets/articles/article-mlops-mlops-foundations-ml-system-lifecycle/controlled-rollout-stages.png)

*Production exposure grows only after the evidence required at each release gate is available.*

CI/CD systems can test code, configuration, containers, data contracts, model criteria, and security properties. Deployment environments can enforce approval and protection rules. These controls extend ordinary software delivery to the extra artifacts and evidence in ML.

After deployment, monitoring covers three categories.

**Operational health** includes availability, errors, latency, CPU, memory, GPU use, throughput, and queue depth. A typical gate may require (P95(\text{latency}) < 100ms).

**Data health** includes schema, null rate, allowed ranges, categories, feature distributions, and freshness. If the UK share moves from 60% in training to 10% in production, the population has changed enough to investigate.

**Model health** includes prediction distribution, confidence, calibration, accuracy, precision, recall, errors by slice, and business outcomes. Labels often arrive later than predictions, so monitoring runs on two timescales:

```text
immediate: latency, errors, feature values, prediction distribution
delayed:   accuracy, precision, recall, financial or product outcome
```

Before production, quality is estimated from evaluation data. After outcomes arrive, quality can be observed. This new evidence closes the operating loop.

## How Does Production Evidence Choose the Next Action?
<!-- section-summary: Diagnosis identifies whether a problem belongs to serving, data, features, population, the learned relationship, or the product objective before the team chooses a remedy. -->

A falling metric does not automatically call for retraining. The first task is to identify what changed.

If prediction latency rises from 80 milliseconds to 3 seconds while model quality remains stable, the cause may be capacity, networking, database latency, resource contention, or a bad deployment. Serving repair is the relevant response.

If `customer_income` null rate rises from 1% to 83%, the upstream data path is likely broken. Retraining on damaged inputs would preserve or amplify the problem; the data pipeline needs repair.

If the production input distribution differs from training:

$$
P_{prod}(X) \neq P_{train}(X)
$$

the system has detected data drift. A shift from mostly desktop customers to mostly mobile customers is a signal to investigate whether performance has suffered. Drift alone does not prove failure.

If the outcome relationship changes:

$$
P_{prod}(Y|X) \neq P_{train}(Y|X)
$$

the system faces concept drift. New fraud behavior may require fresh labels, an updated dataset, and retraining.

If the company moves from maximizing click-through rate to improving long-term retention, the original target no longer represents the objective. The lifecycle returns to definition; more training on the old target cannot repair the mismatch.

The diagnostic map is:

```text
production problem
    ↓
what changed?
    ├── infrastructure ──→ repair serving
    ├── source data ─────→ repair data pipeline
    ├── feature logic ───→ repair feature pipeline
    ├── population ──────→ investigate, then possibly retrain
    ├── relationship ────→ collect labels and retrain
    └── objective ───────→ redefine the task
```

Retraining creates a challenger, not a production replacement. If v42 is the champion and new data produces v43, v43 must pass evaluation, comparison, approval, and controlled release. It should satisfy predictive and business thresholds as well as latency, cost, reliability, fairness, security, and compliance constraints.

The most practical lifecycle document is often a gate table:

| Transition | Evidence required |
| --- | --- |
| Problem → Data | Target, action, success measure, constraints |
| Data → Training | Validation, leakage checks, versioned inputs |
| Training → Candidate | Reproducible run, metrics, artifact |
| Candidate → Approved | Model, system, and policy tests |
| Approved → Production | Release plan, rollback, monitoring |
| Production → Continue | Service and model health within bounds |
| Production → Retrain | Evidence that the model is stale |
| Production → Rollback | Release or system regression |
| Production → Redefine | Objective or environment fundamentally changed |
| Production → Retire | Replacement or no remaining use, plus dependency checks |

Evidence should grow stronger as consequence grows:

$$
\text{Required assurance} \propto \text{Potential consequence}
$$

Early experiments can tolerate rough metrics and temporary data because they do not affect users. Candidates need stronger validation. Production systems need monitoring, rollback, and accountable owners. Higher-risk uses require stricter gates than low-risk recommendations.

### Follow One Fraud Detector Through the Lifecycle

Consider a bank that wants a fraud estimate at authorization time. Definition fixes the operating contract:

```text
goal: estimate fraud probability before authorization completes
P95 latency: below 100 ms
risk below 0.3: approve
risk from 0.3 to 0.8: request additional verification
risk above 0.8: block or review
```

The definition gate confirms that the bank knows who consumes the score, how thresholds affect the transaction, which inputs exist before authorization, and which business and compliance constraints apply.

Data preparation then constructs historical examples from transaction details, merchant history, customer behavior, and eventual fraud outcomes. Every feature must have been knowable at authorization time. The gate requires a valid schema, passed leakage tests, acceptable label quality, a population suited to the intended use, and a recorded dataset version.

Training combines specific inputs:

```text
dataset v31
+ feature definitions v18
+ code commit 92af...
+ resolved configuration and environment
    ↓
training run 847
    ↓
model v12
```

The output is a candidate with lineage. Evaluation may require PR-AUC above the baseline, recall above 85%, false-positive rate below 0.5%, P95 latency below 100 milliseconds, and passed slice checks. Approval records that model v12 satisfies the organization’s release conditions.

The release begins in shadow mode so the bank can compare v12 with live inputs without changing authorization decisions. Canary exposure may then advance through 5%, 25%, 50%, and 100%. A failed error, latency, or behavior gate returns traffic to the established model.

During operation, the team observes errors, latency, feature values, prediction distributions, fraud rate, false positives, and estimated fraud prevented. Three months later, recall falls. Service and source-data checks remain healthy. Investigation finds a new fraud pattern, which means the relationship between known signals and fraud has changed.

The response is to collect the new labels, update the training dataset, train a challenger, evaluate it, approve it, and release it through the same controls. The lifecycle does not skip gates merely because the current production model has lost value.

Eventually v17 replaces v12. After rollback requirements and retention rules permit retirement, the team removes v12 traffic, disables obsolete jobs and resources, revokes unused access, retains required lineage and audit records, and marks the version retired.

This example shows that lifecycle stages remain connected. The target determines data. The data and run identity determine the candidate. Evaluation determines whether approval is defensible. Release determines how risk is limited. Monitoring determines what changed. Diagnosis determines where the next iteration begins.

## How Does Retirement Remove the System Safely?
<!-- section-summary: Retirement removes traffic, jobs, infrastructure, credentials, and unused data dependencies while preserving the lineage and audit history required to explain past operation. -->

A model may leave service after a better version replaces it, the product closes, the prediction loses value, regulation changes, or a required data source disappears. Deleting a model file does not retire its system.

The model sits inside a dependency graph:

```text
feature pipeline
      ↓
training data → model v42 → serving API → application → dashboards
```

Other dependencies may include scheduled retraining, batch scoring, monitoring alerts, feature tables, online feature storage, GPUs, secrets, DNS records, registry entries, retention jobs, and audit records. Leaving them active can create wasted cost, broken jobs, confusing alerts, or security exposure.

Safe retirement first routes production dependence to a replacement or removes the feature from the product. The team confirms that no application still depends on the old version. It stops retraining, batch scoring, and unused materialization schedules. It removes unnecessary endpoints, compute, cached values, temporary artifacts, and credentials.

History may still need to remain. Model lineage, evaluation reports, training configuration, deployment history, prediction evidence, and audit logs can be necessary for debugging, compliance, or explanation of past decisions. Retirement ends operation; retention policy decides which evidence remains.

Lineage should trace a deployment backward:

```text
deployment
    ↓
model version
    ↓
training run
    ↓
code + features + dataset
    ↓
raw sources
```

It should also trace the model forward:

```text
model version → predictions → business decisions → outcomes
```

Different tools record different pieces. Git identifies code. Object storage, a lakehouse, or DVC can identify data and artifacts. Airflow or Kubeflow Pipelines can express the training dependency graph. MLflow can record experiments and registry metadata. Feast can support feature definitions and offline or online retrieval. GitHub Actions or another CI/CD system can run tests and release gates. Serving and monitoring platforms operate the approved package. One product does not need to own every responsibility.

### Map Tools to Lifecycle Responsibilities

Pipeline orchestration turns the dependency order into an executable graph:

```text
validate data → create features → train → evaluate → register
```

Apache Airflow represents such workflows as DAGs containing tasks and dependencies and can orchestrate model-training workloads. Kubeflow Pipelines is more ML-specific: components can exchange parameters and artifacts such as datasets, models, and metrics, while the platform handles execution concerns including caching, retries, and resource requests. In either case, the lifecycle responsibility is a repeatable dependency graph.

Experiment tracking connects parameters, inputs, metrics, and artifacts across many runs. The model registry then connects a chosen artifact to a production identity. Feature management addresses the requirement that offline and online feature meaning agree. CI/CD applies code, container, configuration, validation, security, approval, and release controls. Serving exposes the approved package, and monitoring returns operational and ML evidence.

| Responsibility | Possible implementation |
| --- | --- |
| Code identity | Git |
| Data and artifact identity | Object storage, lakehouse, or DVC |
| Feature management | Feast |
| Orchestration | Airflow or Kubeflow Pipelines |
| Experiment tracking | MLflow |
| Model registry | MLflow or a managed registry |
| CI/CD | GitHub Actions or a similar system |
| Serving | Kubernetes-based or managed endpoint |
| Monitoring | Operational observability plus ML monitoring |

This table is illustrative. A simple system may need only a subset, and a managed platform may combine several rows. Infrastructure is justified by a lifecycle responsibility, not by the appearance of a reference architecture.

The lifecycle has two kinds of correctness. **Artifact correctness** asks whether the team built the candidate from the right data, features, code, configuration, and package. **Ongoing correctness** asks whether data remains healthy, the population and target remain relevant, model value persists, and the service continues to function. The first is established before production; the second must be repeatedly re-established.

Artifact correctness can be demonstrated with bounded evidence. The dataset version is fixed, feature code is identified, training completes, package tests pass, and the resulting report belongs to one candidate. The evidence remains attached to that artifact even after the run ends.

Ongoing correctness depends on the live world. Yesterday's passed report cannot prove that today's source is fresh, today's customers resemble the validated population, or today's business objective still matches the target. The system must gather new evidence continuously and compare it with operating limits.

This leads to two different questions during an incident:

```text
Was this version built correctly from its declared inputs?
Is this correctly built version still appropriate for current operation?
```

A “yes” to the first does not guarantee a “yes” to the second. Conversely, a serving outage does not prove that the model artifact was built incorrectly. Separating the questions helps the team choose a repair without discarding useful evidence.

The full process can be summarized as:

```text
DEFINE → PREPARE DATA → TRAIN → EVALUATE → APPROVE → RELEASE
                                                      ↓
                                                   OPERATE
                                                      ↓
                                                   OBSERVE
                                                      ↓
                                                   DIAGNOSE
                          ┌─────────────┬─────────────┼────────────┐
                          ↓             ↓             ↓            ↓
                       fix data    fix software    retrain     redefine
                          └─────────────┴─────────────┴────────────┘
                                                      ↓
                                               repeat or retire
```

The corresponding long-term chain is:

$$
\text{Requirements}_t
\rightarrow \text{Data}_t
\rightarrow \text{Model}_t
\rightarrow \text{Production}_t
\rightarrow \text{Outcomes}_t
\rightarrow \text{Evidence}_{t+1}
\rightarrow \text{Next decision}
$$

Each arrow should preserve enough identity to travel backward and enough evidence to decide the next forward step. That combination is why the lifecycle is more than the series of jobs needed to train a model. It is the operating control that explains what is being built, what produced it, why it was allowed to advance, what happened after release, how disagreement with reality was diagnosed, and how the system can finally leave service safely.

The compact lifecycle rule is:

$$
\boxed{
\text{Build}
\rightarrow \text{Prove}
\rightarrow \text{Release}
\rightarrow \text{Observe}
\rightarrow \text{Learn}
\rightarrow \text{Repeat or retire}
}
$$

![Full ML system lifecycle from definition through data, candidate, approval, release, operation, learning, repair, and retirement](/content-assets/articles/article-mlops-mlops-foundations-ml-system-lifecycle/full-lifecycle-summary.png)

*The lifecycle controls both forward movement and the return paths chosen after production evidence arrives.*

## Check Your Answers

Use these answers to verify that you can explain both the states of one model version and the feedback loop that changes the larger system.

:::expand[Why Is the ML Lifecycle a Gated Feedback Loop?]{kind="recap"}
Each stage resolves a different uncertainty. Evidence and exit criteria control state transitions, while production outcomes send the wider system back to repair, retraining, redefinition, or retirement.
:::

:::expand[What Must Be Defined Before Data Preparation?]{kind="recap"}
Define the target, prediction moment, available inputs, model output, consumer, resulting action, success measure, latency, cost, risk, and policy constraints so later evidence tests the intended product decision.
:::

:::expand[What Evidence Makes Data Ready for Training?]{kind="recap"}
The dataset needs documented schema, ranges, missingness, labels, sampling, time boundaries, lineage, feature semantics, point-in-time correctness, validation results, and an identifiable version.
:::

:::expand[How Does Training Produce a Reproducible Candidate?]{kind="recap"}
A run records versioned data, features, code, hyperparameters, random state, environment, metrics, and the output artifact. Reproduction may use an accepted behavioral tolerance where exact bits are unrealistic.
:::

:::expand[How Is the Complete Candidate Evaluated and Approved?]{kind="recap"}
Evaluation covers the full serving package through predictive, slice, temporal, system, and business checks. Approval separately applies policy and operational judgment and records one immutable candidate identity.
:::

:::expand[How Is an Approved Model Released and Observed?]{kind="recap"}
Shadow and canary stages increase exposure as production evidence grows, with rollback ready at every stage. Monitoring then separates operational, data, and delayed model or business health.
:::

:::expand[How Does Production Evidence Choose the Next Action?]{kind="recap"}
Diagnosis distinguishes serving failure, source failure, feature failure, data drift, concept drift, and an obsolete objective. Retraining is appropriate only for some of those causes and still produces a candidate that must pass the gates.
:::

:::expand[How Does Retirement Remove the System Safely?]{kind="recap"}
Retirement removes traffic, schedules, endpoints, compute, credentials, and unused data paths after dependency checks, while retaining lineage, evaluation, deployment, and audit evidence required by policy.
:::

## References

- [Feast documentation: Feature retrieval](https://docs.feast.dev/getting-started/concepts/feature-retrieval)
- [Feast documentation: Online store](https://docs.feast.dev/getting-started/components/online-store)
- [MLflow: Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [MLflow: Model Registry workflows](https://www.mlflow.org/docs/latest/ml/model-registry/workflow/)
- [GitHub Docs: Continuous deployment](https://docs.github.com/en/actions/get-started/continuous-deployment)
- [GitHub Docs: Deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)
- [Apache Airflow: Architecture overview](https://airflow.apache.org/docs/apache-airflow/stable/concepts/overview.html)
- [Kubeflow Pipelines: Pipeline concepts](https://www.kubeflow.org/docs/components/pipelines/concepts/pipeline/)
