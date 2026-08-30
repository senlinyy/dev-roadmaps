---
title: "ML System Assets"
description: "Explain the main assets that need storage, versioning, and ownership."
overview: "An ML system is a connected graph of identifiable code, data, features, runtimes, runs, models, evidence, releases, predictions, actions, and outcomes that can be traced and recovered."
tags: ["MLOps", "core", "architecture"]
order: 2
id: "article-mlops-mlops-foundations-ml-system-assets"
---

## Table of Contents

1. [Why Is the Model Only One ML System Asset?](#why-is-the-model-only-one-ml-system-asset)
2. [What Gives an Asset a Reliable Identity?](#what-gives-an-asset-a-reliable-identity)
3. [How Are Code, Data, Labels, and Features Identified?](#how-are-code-data-labels-and-features-identified)
4. [How Do the Environment, Training Run, and Model Package Connect?](#how-do-the-environment-training-run-and-model-package-connect)
5. [How Do Evaluation, Approval, Release, and Deployment Differ?](#how-do-evaluation-approval-release-and-deployment-differ)
6. [What Should Prediction, Action, and Outcome Records Preserve?](#what-should-prediction-action-and-outcome-records-preserve)
7. [How Does Asset Lineage Support Investigation and Impact Analysis?](#how-does-asset-lineage-support-investigation-and-impact-analysis)
8. [How Do Retention and Recovery Preserve a Usable System?](#how-do-retention-and-recovery-preserve-a-usable-system)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Six months after a model release, someone asks why one customer received a particular prediction. Finding `model.pkl` is not enough. The file does not identify the training rows, labels, or feature definitions. It also leaves out the code, configuration, approval tests, and production package.

All of those items are **ML system assets**. They include source code, datasets, feature definitions, configurations, environments, training runs, model files, evaluation reports, approvals, deployment records, prediction logs, and later outcomes.

Each important asset needs a stable identity and a connection to the assets that produced or consumed it. Those connections let a team compare candidates, reproduce a run, trace a bad label forward to affected models, restore a known-good release, and explain a past decision.

For one prediction, the trace might say that request `req-1842` used feature set `fraud-features-v7`, model `fraud-v18`, and threshold `0.85`. Release `release-204` sent the payment to review, and a confirmed outcome arrived two weeks later. The identifiers turn a vague investigation into a path through concrete records.

That path also identifies the owner of each missing record.

Use these questions to build that connected record:

1. **Why Is the Model Only One ML System Asset?**
2. **What Gives an Asset a Reliable Identity?**
3. **How Are Code, Data, Labels, and Features Identified?**
4. **How Do the Environment, Training Run, and Model Package Connect?**
5. **How Do Evaluation, Approval, Release, and Deployment Differ?**
6. **What Should Prediction, Action, and Outcome Records Preserve?**
7. **How Does Asset Lineage Support Investigation and Impact Analysis?**
8. **How Do Retention and Recovery Preserve a Usable System?**

## Why Is the Model Only One ML System Asset?
<!-- section-summary: A production prediction depends on a graph of persistent, identifiable objects and records, while the model file preserves only one output of that graph. -->

A simple description of training is (M=Train(D)). A production run depends on more inputs:

$$
M = Train(D,L,F,C,H,E)
$$

Here, (D) is data, (L) labels, (F) feature definitions, (C) training code, (H) configuration and hyperparameters, and (E) the execution environment.

Serving introduces further dependencies:

$$
\hat{y}=Serve(M,F_{serve},C_{serve},Config,x)
$$

Reproducing or explaining (\hat{y}) therefore requires more than the model weights. The team may need the data and label identity, feature version, source and serving code, configuration, runtime, evaluation report, approval, release manifest, deployment event, request evidence, policy action, and outcome.

An **ML system asset** is something with persistent identity that matters to producing, evaluating, releasing, operating, recovering, or explaining the system. Examples include:

```text
source code
training configuration
dataset and labels
feature definitions and feature values
execution environment
training run
model package
evaluation report
approval record
release manifest
deployment record
prediction record
outcome record
```

An asset can be a file, object, table version, database row, container image, experiment entry, registry version, or signed decision. Its physical form is secondary to its stable identity and recorded relationships.

The asset and its metadata are related without being identical. `model-v42.bin` is an artifact. Its name, version, run ID, creation time, AUC, and owner are metadata. `transactions-2026-07.parquet` is a data artifact; schema, source systems, checksum, time range, row count, owner, and creation job describe it.

Both parts matter. The object without metadata is difficult to interpret. Metadata without a retrievable object cannot reproduce or recover the system.

### Separate the Object from Its Description

This separation appears throughout the system:

| Asset object or event | Metadata that makes it manageable |
| --- | --- |
| Dataset files or table snapshot | Schema, time range, sources, checksum, row count, owner, creation job |
| Container image | Digest, build commit, base image, dependency inventory, creation time |
| Training run | Input references, parameters, environment, logs, metrics, output references |
| Model package | Model family, version, run, owner, interface contract, lifecycle state |
| Evaluation report | Model, dataset, evaluation code, configuration, thresholds, results |
| Deployment event | Environment, release, traffic, timestamp, status, rollback target |

The asset may live in object storage while its metadata lives in a catalog or registry. They do not need the same storage system. They do need stable references in both directions so the metadata resolves to the object and the object can be recognized in the historical graph.

![Code, data, run, model, evaluation, and approval records connected to one recoverable production release](/content-assets/articles/article-mlops-mlops-foundations-ml-system-assets/release-evidence-bundle.png)

*One production release depends on a connected evidence bundle rather than a standalone model file.*

## What Gives an Asset a Reliable Identity?
<!-- section-summary: Stable version identity, immutability, ownership, lifecycle state, dependencies, and retention policy keep an asset meaningful after teams and systems change. -->

Three files named `model.pkl` do not supply operational identity. Useful identifiers distinguish logical families from specific versions:

```text
dataset: transactions-training-v31
feature set: fraud-features-v18
training code: git commit 7ab29e1
training run: run-9182
model: fraud-detector-v42
serving package: fraud-service:42.7
release: fraud-prod-release-2026-08-14-01
```

Identity establishes that two versions are different even if they belong to the same model or dataset family.

Once a version participates in evaluation, approval, release, or another important lifecycle event, changing its contents destroys that meaning. If `fraud_model_v42` is approved and someone later replaces the file under the same name, v42 yesterday and v42 today no longer identify the same asset. The stronger practice is to preserve v42 and create v43.

Immutability applies to models and often to dataset versions, feature definitions, configuration, containers, evaluation reports, approvals, and release manifests. Friendly labels such as `latest`, `stable`, and `production` remain useful as movable aliases. They should resolve to an immutable version:

```text
production ──alias──→ release-1037
```

Content digests strengthen identity. A container tag such as `fraud-api:v42` can potentially be rebuilt and overwritten. `sha256:...` identifies exact content.

Important assets also need ownership. If `customer-30d-spend` produces incorrect values, its version number does not say who should investigate. A manageable record can include:

```text
identity: customer-30d-spend
version: 17
owner: customer-ml-features
status: active
dependencies: named sources and downstream users
created_at: recorded timestamp
retention: documented policy
```

Assets change operational states. A dataset can move from created to validated, used, superseded, and archived. A model can move from experimental to candidate, approved, deployed, and retired. A container can move through built, tested, released, and deprecated. State explains how an asset may be used; it does not alter the immutable contents of a version.

Lifecycle state is evidence about allowed use. A candidate can exist and remain forbidden from production. A superseded dataset can stay available for reproduction while new training uses another version. A deprecated image can support rollback until its retention deadline.

State changes should create records rather than rewrite history. Approval does not erase the earlier candidate state, and retirement does not erase prior production use. The sequence explains which decisions were made and when.

## How Are Code, Data, Labels, and Features Identified?
<!-- section-summary: Code, configuration, datasets, label policies, feature definitions, feature values, and time semantics each require separate identities because changing any one can change the model. -->

Training code includes more than `train.py`. Extraction, cleaning, feature computation, splitting, training, evaluation, packaging, serving, and post-processing code can affect the final behavior. A Git commit gives the run an immutable source reference:

$$
Run_{9182} \rightarrow CodeCommit_{7ab29e1}
$$

Configuration is also an input. Two runs can use the same function and different learning rates, tree depths, feature switches, sampling rules, thresholds, training dates, class weights, random seeds, or resource settings.

```text
Model A: learning_rate=0.1, max_depth=6
Model B: learning_rate=0.02, max_depth=12
```

Thus (Model=f(Code,Config)). Configuration values belong in the run record instead of remaining in a notebook cell or operator memory.

Training data needs an exact logical identity. “The customer table” cannot reproduce a run because tables receive new rows, corrections, and backfilled labels. The run may reference a snapshot timestamp, table version, partition list, source-file manifest, content hash, or other version such as `training-dataset-v91`.

Data lineage connects that version to its sources and transformations:

```text
orders ─────┐
customers ──┼──→ feature job v18 ──→ training-dataset-v91
returns ────┘
```

If `returns` is later found corrupt, the graph can identify affected datasets and models.

Labels deserve an identity separate from the table. `customer_churned` could mean no purchase for 30 days, no purchase for 60 days, subscription cancellation, or permanent account closure. Changing the label definition changes the problem:

$$
Y=LabelDefinition(Data)
$$

A versioned label policy records the outcome window, class mapping, exclusions, maturity rule, and handling of unknown cases.

Feature names also fail to preserve meaning. A definition for `average_spend_30d` must say which purchases count, how refunds work, which timezone defines a day, whether the current transaction is included, what happens after zero purchases, and how currencies are converted.

The **feature definition** describes the computation. **Feature data** contains values produced by that definition, such as customer A → 4, customer B → 0, and customer C → 19 for `transactions_24h`. Both can participate in lineage.

Historical feature values must respect the prediction boundary:

$$
FeatureTime \le PredictionTime
$$

Event time, processing time, observation time, and label time help show whether the historical row used only information that could have existed at the live decision. These timestamps are part of the evidence against leakage.

### Preserve Meaning Alongside Values

Consider a churn table with one column called `label`. The bytes may remain valid while a policy change turns the outcome from “no purchase within 90 days” into “subscription cancelled.” A table version alone cannot explain that semantic shift. The dataset must reference the label definition that gave those values meaning.

The same applies to `average_spend_30d`. Excluding refunded orders changes the definition even if its type remains `float`. The definition receives a new version, and newly materialized values point to it. Models built before and after the change can then be compared honestly.

For a prediction at 10:00, an event at 09:55 that reached the production source at 10:10 was unavailable to the live model. Event and observation times let the historical builder avoid making training data cleaner than the real serving path.

## How Do the Environment, Training Run, and Model Package Connect?
<!-- section-summary: A run joins versioned inputs and a pinned environment to its metrics and model package, while the package carries every preprocessing, model, post-processing, schema, and runtime component needed for inference. -->

Code, data, and configuration may still produce a different result after the environment changes. Python, NumPy, scikit-learn, CUDA, the base image, operating-system libraries, and hardware can influence execution.

Environment assets may include:

```text
dependency lockfile
container image and digest
language runtime version
CUDA version
base image
system libraries
hardware type
```

A container digest is useful because it identifies one immutable runtime package. Hardware can still introduce nondeterminism, while the digest records a much stronger execution boundary.

The training run is an asset representing the event that connects inputs to outputs:

```text
training run: run-9182

inputs
  code: commit-7ab29e1
  dataset: training-v91
  labels: churn-policy-v4
  features: feature-set-v18
  config: config-v6
  environment: image@sha256:...

outputs
  metrics
  logs
  model package
  evaluation files
```

Graphically:

```text
code ──────────┐
data ──────────┤
labels ────────┤
features ──────┤
config ────────┼──→ run-9182 ──→ model-v42
environment ───┘
```

Runs preserve unsuccessful history too. AUC values of `.903`, `.916`, and `.941` across runs 9180–9182 show what was tried, which parameters underperformed, and how stable the search was. The winning artifact alone cannot explain that history.

The usable model may contain more than weights:

$$
Package = Preprocessing + Model + Postprocessing + Schema + RuntimeRequirements
$$

A language model application needs the correct tokenizer. A tabular model may need category encoders, normalization statistics, label mapping, and threshold logic. A scikit-learn pipeline may package preprocessing with the estimator.

The package also needs an input/output contract:

```text
input
  transaction_amount: float
  merchant_category: string
  customer_age_days: integer
  transactions_24h: integer

output
  fraud_probability: float in [0,1]
```

The contract prevents a client from sending values that are structurally accepted and semantically wrong.

### Retain the Full Experimental History

Tracking should not record only the winning candidate. A failed run may reveal a dependency crash, an unstable parameter combination, or a critical slice that deteriorated despite a better average. The history prevents repeated dead ends and explains why one version was chosen.

The run also supplies a comparison boundary. If runs 9181 and 9182 share code, data, features, and environment but differ in configuration, the observed change can be attributed more narrowly. If all those assets changed together, the record shows that several explanations remain possible.

For a model package, input types alone do not preserve semantics. `transaction_amount: float` should also define currency, scaling, missing behavior, and whether the current transaction is included. The output contract should say whether a value is a probability, score, class, embedding, or ranking and which post-processing produced it.

## How Do Evaluation, Approval, Release, and Deployment Differ?
<!-- section-summary: Evaluation records evidence about specific model and test assets, approval records permission to proceed, a release defines the exact operating bundle, and deployment records what reached an environment. -->

Evaluation evidence explains why a model was considered production-worthy. For v42 it may include:

```text
ROC-AUC: 0.947
PR-AUC: 0.721
P95 latency: 38 ms
memory: 620 MB
```

Country and customer-segment results, calibration, load tests, security checks, and robustness tests may also be required.

The report must bind to its inputs:

$$
Evaluation=Eval(ModelVersion,EvaluationDataset,EvaluationCode,Config)
$$

An AUC value without a model, dataset, evaluation implementation, and thresholds cannot justify a release.

Approval is another asset. Evaluation says what the tests found. Approval records that an authorized person or process accepts the candidate under that evidence:

```text
candidate: model-v42
decision: approved
evidence: evaluation-report-842
approver: risk-review-process
timestamp: recorded
conditions: recorded
```

The release is the exact set of components intended to operate together. Model v42 alone may be insufficient because production also uses feature definitions, serving code, a container, configuration, decision thresholds, and monitoring rules.

```text
release R2026-08-14-01
├── model: fraud-v42
├── feature set: fraud-features-v18
├── serving image: fraud-api@sha256:abc...
├── decision policy: fraud-policy-v7
├── production config: prod-config-v29
└── monitoring config: monitoring-v12
```

This is an ML bill of materials. It answers what the team intended to release and preserves a recoverable combination.

Deployment records what actually reached an environment. An approved v42 can coexist with production accidentally serving v41. A deployment record should include environment, release ID, timestamp, immutable digests, traffic allocation, and result:

```text
deployment: D4401
environment: production-eu
release: R2026-08-14-01
traffic: 25%
result: healthy
```

Approval grants permission. Release names the operating bundle. Deployment records the real action. Keeping them separate supports canaries, rollbacks, and audits.

### Use the Release as a Bill of Materials

This view prevents partial rollback. Restoring model v42 with feature set v19, policy v8, and a newly built image does not restore the earlier system evaluated as R1037. A complete manifest identifies the exact model, feature contract, image digest, policy, configuration, and monitoring rules intended to work together.

Friendly labels such as `production`, `candidate`, and `stable` can point to release identities. Historical records should retain the resolved immutable ID as well as the alias used at the time. Otherwise a moved alias can make a past prediction appear to belong to today's release.

Deployment distinguishes intent from reality. An approved release may never deploy. A canary may stop at 25% traffic. A failed deployment may leave the previous version active. Deployment history records each result instead of collapsing them into one `production` label.

## What Should Prediction, Action, and Outcome Records Preserve?
<!-- section-summary: Production records connect one prediction to its exact release, product action, and delayed outcome while retaining only the evidence allowed by privacy, security, cost, and policy. -->

Predictions enter the system's history after release. A useful record can include prediction ID, timestamp, release and model version, input or feature references, score, request context, and decision:

```text
prediction_id: P982713
release: R1037
model: fraud-v42
fraud_probability: 0.91
business_decision: additional_verification
```

The architecture does not always store every raw input forever. Privacy, security, regulation, and cost may limit retention. A system might keep a full input, a feature snapshot, references to source records, or aggregated privacy-preserving evidence. The requirement is to retain enough permitted information for the stated debugging, audit, monitoring, and recovery needs.

The outcome may arrive weeks later. A chargeback record `O721982` should link to prediction `P982713`. The join allows calculation of production loss, precision, recall, and other measures.

Action needs its own field. If a high-risk score causes the bank to block a transaction and no chargeback later appears, the absence of a chargeback does not prove the prediction was wrong. The intervention changed what could happen.

```text
prediction → decision → action → outcome
```

Recording the policy version and action distinguishes model behavior from business behavior and makes feedback effects visible.

## How Does Asset Lineage Support Investigation and Impact Analysis?
<!-- section-summary: Backward lineage explains the provenance of an output, while forward lineage exposes every downstream model, release, deployment, prediction, and workflow affected by a changed input. -->

The full asset chain is a graph:

```text
source data
    ↓
dataset and label version
    ↓
feature definition and values
    ↓
training run ← code + config + environment
    ↓
model package
    ↓
evaluation
    ↓
approval
    ↓
release ← serving code + policy + release config
    ↓
deployment
    ↓
prediction
    ↓
decision and action
    ↓
outcome
```

Backward tracing follows `P982713` to release R1037, model v42, run 9182, dataset v91, and the source records. This is provenance:

$$
Output \rightarrow Inputs
$$

Forward tracing starts with a corrupted label set in dataset v91 and discovers run 9182, model v42, release R1037, deployments, predictions, and affected customers or workflows. This is impact analysis:

$$
Input \rightarrow Outputs
$$

Bidirectional lineage supports debugging, audit, remediation, and reproduction. Yesterday's release may use model v42, features v18, and config v29; today's may use the same model and config with features v19. If accuracy falls, the asset comparison immediately exposes the feature change.

It also supports controlled comparisons. A candidate may differ from the current release only by dataset version, or it may change data, features, code, and model together. The asset graph states exactly which variables moved.

![Backward lineage from a prediction to its source assets and forward lineage from a changed dataset to affected predictions](/content-assets/articles/article-mlops-mlops-foundations-ml-system-assets/two-way-lineage-trace.png)

*Provenance travels from an output to its causes; impact analysis travels from a changed input to its dependents.*

Assets naturally live in different systems. Code may live in Git, data in a lake or warehouse, images in a container registry, run metadata in an experiment tracker, models in object storage and a registry, releases in deployment systems, predictions in logs or a lakehouse, and outcomes in operational systems.

Logical identity connects these physical locations. Metadata should reference a 20 TB dataset through its ID, storage location, table version, checksum, query, or snapshot timestamp rather than copy it into the tracker. Large model artifacts and logs follow the same reference pattern.

| Asset | Typical physical home |
| --- | --- |
| Code and configuration | Git repository or configuration system |
| Large datasets | Warehouse, lake, or object storage |
| Feature definitions | Code repository or feature platform |
| Run parameters and metrics | Experiment tracker |
| Run logs | Logging or observability platform |
| Model binaries | Artifact or object storage |
| Model lifecycle metadata | Model registry |
| Container images | Container registry |
| Evaluation reports | Artifact store, tracker, or registry |
| Approval and release records | Governance, registry, deployment system, or Git |
| Deployment history | CI/CD or serving platform |
| Predictions | Logs, database, or lakehouse |
| Outcomes | Operational systems or warehouse |
| Lineage edges | Catalog, lineage platform, or linked metadata records |

One system can implement several rows. The table describes logical homes rather than a requirement to purchase one product per asset type.

The graph must survive team boundaries. A data team may own the dataset, an ML team the model, a platform team serving, and a product team the decision policy. Shared dataset IDs, feature versions, model versions, release IDs, deployment IDs, and prediction IDs keep their work traceable.

### Represent the Full Dependency Graph

One release can be drawn more precisely:

```text
dataset D91 ────────┐       code commit C17
feature set F18 ────┤              │
label policy L4 ────┼──→ training run T9182
config H6 ──────────┤              │
runtime E8 ─────────┘              ↓
                                model M42
                                    │
evaluation dataset EV12 ────────────┤
evaluation code EC7 ────────────────┘
                                    ↓
                             evaluation Q842
                                    ↓
                              approval A193
                                    ↓
serving image S24 ──────────────────┐
policy P7 ──────────────────────────┼──→ release R1037
release config RC29 ────────────────┤
model M42 ──────────────────────────┘
                                    ↓
                             deployment D4401
                                    ↓
                           predictions and actions
                                    ↓
                                 outcomes
```

The graph explains why a model and a release are different identities. A bad evaluation dataset invalidates approval evidence. A serving-image defect can require a new release while the model remains M42. A policy change can alter outcomes without altering scores.

Ownership can attach to graph nodes. The data team owns D91, the ML team M42, the risk process A193, the platform team S24 and D4401, and the product team P7. Shared references coordinate their responsibilities without forcing every asset into one database.

## How Do Retention and Recovery Preserve a Usable System?
<!-- section-summary: Retention policy keeps complete reconstructable units for the required period, and tested recovery proves that the retained model, runtime, configuration, features, policy, and dependencies can operate together. -->

Retiring v42 does not automatically authorize deletion of its model, dataset, runtime, or logs. The release may still be needed for rollback, investigation, regulation, historical reproduction, or a customer dispute.

Retention periods differ by asset and policy. Prediction logs might remain for 90 days, model artifacts for three years, audit records for seven years, and temporary training caches for seven days. The correct values depend on organizational requirements.

Retaining arbitrary files can still leave the system unrecoverable. Keeping model v42 while deleting its feature definition, serving image, policy, or configuration does not preserve release R1037. Retention should protect complete recoverable units:

```text
release R1037
├── model v42
├── serving image digest
├── config v29
├── feature contract v18
├── decision policy v7
└── required dependencies and access path
```

Recovery asks a stronger question than retention. The model may exist while the container is missing. The container may exist while a required secret or compatible configuration has gone. The data may remain while transformation code is unavailable.

A recovery test resolves R1037 to its immutable components and redeploys that combination in a safe environment. Testing proves that references, credentials, runtime compatibility, and artifacts still work together.

### Use Assets for Debugging and Comparison

Suppose production quality falls after R1042. History shows:

```text
yesterday: R1037, model v42, features v18, config v29
today:     R1042, model v42, features v19, config v29
```

The model and configuration stayed fixed; the feature version changed. The asset graph gives the investigation a factual starting point.

Candidate comparison works the same way. If v43 uses dataset v96 with the same features and code as v42, the dataset is the intended difference. If v44 changes the dataset, features, and code together, several variables could explain performance. Asset identity exposes the comparison scope.

Recovery should be exercised before an emergency. A test can resolve the previous release, verify every digest and reference, obtain configuration and credentials through the approved path, deploy it, run contract checks, and confirm that the stable service interface can route traffic to it. A file that cannot pass this exercise is retained data, not a proven recovery unit.

Asset identity also enables reproduction:

$$
M_{42}=Train(D_{91},F_{18},C_{7ab29e1},H_6,E_{abc})
$$

For one serious production model, a useful minimum asset set identifies source code, training configuration, dataset and labels, feature definitions, environment, run, model package, evaluation evidence, approval, release manifest, deployment history, predictions, and outcomes—plus the relationships among them.

That minimum can begin with a Git commit, dated dataset snapshot, run directory, model version, Docker image, deployment log, and prediction table. An enterprise feature platform, central catalog, specialized lineage graph, or large registry can follow after scale, risk, collaboration, or compliance creates the need.

The asset system should reliably answer:

```text
What exactly is running?
How was this model produced?
Which inputs did this run use?
Which components were released together?
Which release produced this prediction?
Which prediction and action preceded this outcome?
Which models and predictions depend on this bad input?
Can a previous release actually be recovered?
```

![Connected ML assets protected by identity, ownership, integrity, and retention controls](/content-assets/articles/article-mlops-mlops-foundations-ml-system-assets/explainable-release-summary.png)

*Asset management supplies the memory required to reproduce, explain, recover, compare, and assess impact.*

## Check Your Answers

Use these answers to verify that you can trace one production result across the complete asset graph rather than stopping at the model version.

:::expand[Why Is the Model Only One ML System Asset?]{kind="recap"}
A prediction depends on data, labels, features, code, configuration, runtime, model package, evaluation, approval, release, deployment, action, and outcome. The model file preserves only one artifact in that chain.
:::

:::expand[What Gives an Asset a Reliable Identity?]{kind="recap"}
An asset needs a stable version, immutable contents after important lifecycle use, an owner, status, dependencies, creation evidence, and retention policy. Movable aliases should resolve to immutable versions.
:::

:::expand[How Are Code, Data, Labels, and Features Identified?]{kind="recap"}
Git commits identify code, recorded configuration identifies run choices, snapshots or manifests identify data, label-policy versions identify target meaning, and feature-definition versions identify transformations and time semantics.
:::

:::expand[How Do the Environment, Training Run, and Model Package Connect?]{kind="recap"}
The run links code, data, labels, features, configuration, environment, metrics, logs, and outputs. The model package then carries the preprocessing, weights, post-processing, schema, and runtime requirements needed for inference.
:::

:::expand[How Do Evaluation, Approval, Release, and Deployment Differ?]{kind="recap"}
Evaluation records test evidence for named assets. Approval authorizes progress. A release lists the exact operating components, and deployment records which release actually reached an environment and how much traffic it received.
:::

:::expand[What Should Prediction, Action, and Outcome Records Preserve?]{kind="recap"}
They should connect an identifiable prediction to its release, permitted input evidence, score, policy, action, and delayed outcome. Retention must satisfy debugging and audit needs within privacy, security, cost, and regulatory limits.
:::

:::expand[How Does Asset Lineage Support Investigation and Impact Analysis?]{kind="recap"}
Backward lineage traces an output to its causes. Forward lineage traces a changed input to affected runs, models, releases, deployments, predictions, and workflows. Shared identities connect assets across storage systems and teams.
:::

:::expand[How Do Retention and Recovery Preserve a Usable System?]{kind="recap"}
Retention protects complete reconstructable releases for the required time. Recovery tests prove that the model, image, configuration, features, policy, dependencies, references, and access path can still work together.
:::

## References

- [Git documentation](https://git-scm.com/doc)
- [MLflow: Tracking](https://mlflow.org/docs/latest/ml/tracking/)
- [MLflow: Model Registry](https://mlflow.org/docs/latest/ml/model-registry/)
- [OpenLineage documentation](https://openlineage.io/docs/)
