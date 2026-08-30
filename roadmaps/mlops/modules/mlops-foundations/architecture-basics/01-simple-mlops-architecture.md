---
title: "MLOps Architecture"
description: "Understand the connected responsibilities that carry data into training, models into production, and production evidence back into improvement."
overview: "MLOps architecture connects the product, data, model lifecycle, control, and metadata responsibilities needed to produce reliable model changes and learn from their outcomes."
tags: ["MLOps", "core", "architecture"]
order: 1
id: "article-mlops-mlops-foundations-simple-mlops-architecture"
---

## Table of Contents

1. [How Does the Product Define the Architecture?](#how-does-the-product-define-the-architecture)
2. [What Moves Through the Data, Control, and Metadata Planes?](#what-moves-through-the-data-control-and-metadata-planes)
3. [How Do Data and Features Support Training and Inference?](#how-do-data-and-features-support-training-and-inference)
4. [How Does Training Produce an Approved Model Identity?](#how-does-training-produce-an-approved-model-identity)
5. [How Does Serving Turn a Model into a Product Capability?](#how-does-serving-turn-a-model-into-a-product-capability)
6. [How Do Monitoring and Outcomes Close the Learning Loop?](#how-do-monitoring-and-outcomes-close-the-learning-loop)
7. [How Do Coordination, Contracts, and Recovery Hold the System Together?](#how-do-coordination-contracts-and-recovery-hold-the-system-together)
8. [How Much Architecture Does a Production System Need?](#how-much-architecture-does-a-production-system-need)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Imagine two teams using the same type of model. One produces a churn list every night for the next morning's campaign. The other scores a card payment while the customer is waiting at checkout. The first can tolerate a long batch job. The second may have less than a tenth of a second to collect features, run the model, and return a decision.

That difference should shape the architecture. Before choosing tools, the team needs to state when the prediction is needed and which data is available then. It also needs to name the consumer and decide what happens if the model cannot answer.

An **MLOps architecture** connects the systems that prepare data, train and approve models, deliver predictions, record what happened, and feed outcomes back into later work. It also records the versions and owners needed to investigate or recover the system.

For the payment model, an event arrives and a feature path gathers recent account activity. A serving component loads an approved model, and the payment system applies the returned score. The request record identifies the input, model version, score, threshold, action, and fallback. A later fraud outcome returns through a separate path. Training can then use that outcome without pretending it was known at authorization time.

The same drawing should show where each handoff can fail and which team responds. That keeps recovery paths visible beside the normal prediction path.

It also gives every team the same picture during an incident.

Build that architecture from the product outward:

1. **How Does the Product Define the Architecture?**
2. **What Moves Through the Data, Control, and Metadata Planes?**
3. **How Do Data and Features Support Training and Inference?**
4. **How Does Training Produce an Approved Model Identity?**
5. **How Does Serving Turn a Model into a Product Capability?**
6. **How Do Monitoring and Outcomes Close the Learning Loop?**
7. **How Do Coordination, Contracts, and Recovery Hold the System Together?**
8. **How Much Architecture Does a Production System Need?**

## How Does the Product Define the Architecture?
<!-- section-summary: The prediction moment, consumer, action, outcome, latency, and scale requirements reveal which architectural capabilities the product needs. -->

Suppose an online shop predicts whether an order will be returned. At the prediction moment, the model may receive:

$$
x = [
\text{customer history},
\text{product history},
\text{order value},
\text{shipping choice},
\text{device information}
]
$$

The model calculates (f_\theta(x)=0.81). A business policy interprets that score and may offer sizing guidance. Weeks later, the item is either returned or kept. That outcome supplies evidence about the prediction.

This one product path already requires several capabilities:

- obtain historical and current data;
- transform raw facts into model features;
- build an identifiable training dataset;
- train and store a model artifact;
- evaluate whether the candidate is acceptable;
- authorize one model for release;
- deliver predictions at the required time;
- observe service and model behavior;
- connect later returns to earlier predictions;
- feed new evidence into another training cycle.

The model handles (x \rightarrow \hat{y}). The architecture handles every dependency around that transformation.

A fraud detector makes the need even clearer. Saving `fraud_model.pkl` leaves unanswered where features come from, who invokes the model, where it runs, which version is active, how that version was trained, how missing inputs are handled, how fast a score must arrive, how a serving failure is contained, where chargeback labels come from, and how those labels enter a future dataset.

Inference timing shapes the physical design. A nightly churn product can follow:

```text
warehouse
    ↓
batch feature computation
    ↓
model
    ↓
predictions table
    ↓
marketing system
```

It may need neither a prediction API nor an online feature store. Card authorization is different:

```text
transaction request
    ↓
retrieve current features
    ↓
model service
    ↓
fraud score
    ↓
authorization policy
```

The second path may have only tens of milliseconds. A streaming anomaly detector has another shape: events flow through streaming feature computation, inference, and alerting. Architecture follows the required inference pattern, latency, throughput, availability, cost, and feedback delay.

![Seven connected responsibilities carrying data into training, an approved model into production, and outcomes back into learning](/content-assets/articles/article-mlops-mlops-foundations-simple-mlops-architecture/one-connected-mlops-system.png)

*The product requirement creates connected responsibilities from source data through outcome feedback.*

## What Moves Through the Data, Control, and Metadata Planes?
<!-- section-summary: The data plane performs prediction-related work, the control plane decides and coordinates what may happen, and the metadata plane preserves system memory. -->

Three flows make a large ML system easier to reason about.

The **data and prediction flow** carries source facts into features, models, predictions, and business actions:

```text
source data → features → model → prediction → business action
```

The **model lifecycle flow** carries a trained artifact through evaluation and operation:

```text
training → candidate → evaluation → approval → deployment → replacement or retirement
```

The **metadata and control flow** answers questions about identity and authority:

```text
Which data and code ran?
Which run produced the model?
Which metrics passed?
Who approved the release?
Where is the version deployed?
Which predictions did it produce?
What happened afterward?
```

These flows correspond to three architectural planes:

$$
\boxed{\text{Data plane} + \text{Control plane} + \text{Metadata plane}}
$$

The **data plane** carries raw events, processed data, feature values, inference requests, predictions, and outcomes. It does the computation that directly contributes to training or prediction.

The **control plane** schedules and coordinates jobs, evaluates gates, manages approvals, selects versions, changes traffic, applies access rules, retries failed work, and triggers rollback. It decides what the system is permitted to do and when.

The **metadata plane** records datasets, feature definitions, training runs, metrics, artifacts, registry identities, approvals, deployments, incidents, and audit history. It gives the architecture memory.

Consider a source table later found to contain incorrect values. Forward lineage should answer which datasets used it, which models those datasets produced, and which deployments served those models. If one prediction causes concern, backward lineage should identify its model version, training run, dataset, and raw source.

```text
raw source
    ↓
dataset v12
    ↓
feature set v8
    ↓
training run 991
    ↓
model v27
    ↓
deployment 184
    ↓
prediction and outcome
```

The model file cannot preserve all of these relationships. The metadata plane turns “What changed?” and “Where did this come from?” into queries with factual answers.

The planes remain distinct even if one managed platform implements all three. Logical responsibility matters more than the number of products involved.

## How Do Data and Features Support Training and Inference?
<!-- section-summary: Feature values translate real-world facts into model inputs, while offline and online paths serve different workloads under one shared semantic contract. -->

Models consume numeric or otherwise encoded representations, not business objects. A customer history such as three purchases worth £20, £40, and £70 may be represented as:

$$
x = [3, 130, 43.33, 1]
$$

The entries might mean:

```text
transactions_30d = 3
spend_30d = 130
average_order_value = 43.33
purchased_last_24h = 1
```

The model depends on those meanings. If training defines `spend_30d` as the previous 30 complete days while production uses the current calendar month, the names match and the values represent different facts:

$$
F_{train}(x) \neq F_{serve}(x)
$$

The architectural requirement is consistent feature semantics. A feature store can help implement it, but a feature store is not the requirement itself.

Training and inference often need different physical access patterns. Training may scan two years and millions of events, favoring storage and compute optimized for high-throughput batch work where minutes or hours are acceptable. Online prediction may need one customer's latest values in 10 milliseconds, favoring low-latency lookups and high availability.

```text
raw and processed history ──→ offline storage ──→ training
             │
             └──────────────→ current values ───→ online inference
```

Maintaining two paths creates a consistency problem. The same entity key, time window, source rules, missing-value policy, and transformation must preserve the feature's meaning. Merely copying values into two stores does not solve that problem.

The data plane may therefore include acquisition, validation, historical storage, feature computation, an offline table, and an optional online serving store. A fraud feature such as `transactions_last_24h` is defined by counting customer transactions over the previous 24 hours:

$$
transactions\_last\_24h = Count(\text{customer transactions in the preceding 24 hours})
$$

Its contract should state the entity, time boundary, source, valid range, freshness requirement, and missing behavior. The training system reconstructs it historically; the online path keeps the current value available by the decision deadline.

Batch products simplify the path. A warehouse can compute features, run a model over a table, and write predictions for another system. Real-time products add an always-available service and possibly recent feature storage. Streaming products add event ingestion and stateful computation. The product's timing determines which pieces are justified.

### Compare the Three Inference Paths

A batch churn job works over a bounded dataset. It can read every eligible customer, calculate historical windows in SQL, apply one approved model, and write a predictions table. The downstream marketing system can read that table later. Throughput and correctness matter; per-customer response latency usually does not.

An online recommendation request has the opposite shape. The application needs a small set of recent values for one user, and the score must arrive before the page response loses value. The serving path may keep the approved model in memory and fetch precomputed values from a low-latency store. Availability and tail latency now dominate the physical design.

A streaming anomaly detector receives an unbounded event flow. It must maintain recent state, update windowed features, score each event, and emit an alert. Event order, duplicate delivery, late records, checkpointing, and state recovery become part of feature correctness.

These paths can share a model family and feature definitions while using different compute and storage. The architecture must preserve the contract at every path: which entity is scored, which event time defines the window, how fresh the value must be, and what happens if a value is unavailable.

## How Does Training Produce an Approved Model Identity?
<!-- section-summary: Orchestrated training connects versioned inputs to a candidate, evaluation tests the complete package, and control-plane gates authorize one immutable model identity. -->

Production training is a dependency graph:

```text
select a data version
    ↓
validate data
    ↓
compute features
    ↓
build train, validation, and test sets
    ↓
train
    ↓
evaluate
    ↓
package
    ↓
record artifacts and metadata
```

The run can be represented as:

$$
M_i = Train(D_i, F_i, C_i, H_i, E_i)
$$

The architecture preserves the dataset (D_i), features (F_i), code (C_i), hyperparameters (H_i), and environment (E_i) so the resulting model can be explained.

Workflow orchestration enforces dependency order. Evaluation cannot run before training. Training should not start after data validation fails. Registration should not accept a candidate after evaluation fails. The orchestrator determines what starts, what can run in parallel, which task failed, whether retry is safe, which inputs a run used, and when the workflow should run again.

Training and serving commonly use separate compute. A training job might need eight GPUs, 500 GB of memory, and three hours. Serving might use CPU or one GPU, answer within 20 milliseconds, and remain available continuously. Training infrastructure optimizes temporary large-scale learning work. Serving infrastructure optimizes dependable prediction delivery.

Every output needs an identity. Ten files named `model.pkl` cannot tell production which one to load. A registry responsibility gives a family such as `fraud-detector` explicit versions and links each version to its origin:

```text
fraud-detector v40
├── training run 829
├── code commit abc123
├── dataset transactions-v52
├── features v18
├── PR-AUC 0.731
└── immutable artifact reference
```

Experiment tracking and registration answer related questions. The tracker explains what happened during runs—parameters, metrics, artifacts, and failures. The registry gives selected artifacts lifecycle identities such as candidate, deployed, or retired. One platform can implement both, but their architectural purposes differ.

An experiment tracker may contain hundreds of runs:

```text
run 828: learning_rate=.01, AUC=.91
run 829: learning_rate=.03, AUC=.94
run 830: learning_rate=.05, AUC=.90
```

This history helps compare training choices. The registry narrows the operational discussion to selected model artifacts:

```text
fraud-detector
v39 → retired
v40 → deployed
v41 → candidate
```

The difference matters during an incident. Run metadata explains how v40 was built. Registry and deployment metadata explain why v40 was selected and where it is active.

Evaluation sits between training and production. It tests more than weights. The operating package may be:

$$
P = Model + FeatureLogic + Runtime + Configuration + Thresholds + ServingCode
$$

Predictive metrics, calibration, slice performance, latency, memory, robustness, security, and business value may all apply. Quality gates convert results into a control decision. For a candidate (M_{41}):

$$
Approve(M_{41}) = Q \land L \land R \land S
$$

where (Q) is predictive quality, (L) latency, (R) reliability, and (S) safety or policy compliance. Passed gates produce an approved immutable identity. Failed gates leave the candidate rejected or return it for development.

### Make the Metadata Questions Explicit

The architecture should answer which dataset produced the current model, which commit and feature definitions ran, which evaluation report passed, who approved the version, which endpoint serves it, when traffic changed, and which model handled a specific prediction. These are operational questions, not decorative documentation.

Forward and backward lineage serve different investigations. After discovering a faulty source, the team traces forward to affected derived datasets, runs, models, deployments, and decisions. After investigating a harmful prediction, it traces backward from the prediction ID to the deployment, registry version, run, feature set, dataset, and source records.

This graph also supports successful work. If v40 performs well, lineage identifies the inputs and process that should be reproduced. If v41 fails, comparing their graphs reveals whether data, code, parameters, environment, package, policy, or release configuration differed.

## How Does Serving Turn a Model into a Product Capability?
<!-- section-summary: Serving loads the approved package, constructs or retrieves features, returns a versioned prediction, and leaves the business policy free to convert that prediction into an action. -->

A registry entry has no effect until a serving path loads the package and handles requests. An online request might contain:

```json
{
  "customer_id": "123",
  "transaction_amount": 900
}
```

The service validates the input, retrieves or computes recent features, constructs a vector such as:

$$
x=[900,14,2,4300,0.82]
$$

and calculates (f_\theta(x)=0.91). A response can include `fraud_probability`, `model_version`, and a `prediction_id` so later systems can identify the exact computation.

The probability and the business decision are separate responsibilities. A policy may define:

$$
Decision(p)=
\begin{cases}
Approve & p < 0.30 \\
Verify & 0.30 \le p < 0.80 \\
Block & p \ge 0.80
\end{cases}
$$

This separation lets a business owner change the block threshold from `0.80` to `0.85` without retraining the model. It also makes it clear whether a production change came from model behavior or policy behavior.

Clients should call a stable interface such as `fraud-prediction-service`, rather than hard-code a path to version 40. Indirection lets the serving system point that interface to version 41 later without changing every client.

Release architecture combines traffic control, observability, and rollback. Instead of sending all traffic to v41 immediately, it may begin with 5% on v41 and 95% on v40. If health remains acceptable, exposure can rise through 25%, 50%, and 100%. If errors or latency increase, traffic returns to v40.

The mechanism could be Kubernetes, a managed ML endpoint, a service mesh, or a load balancer. The responsibility is stable: increase exposure with evidence and preserve a fast reversal route.

A shadow release can run the candidate alongside the current model without granting it control:

```text
request ──┬──→ v40 → real decision
          └──→ v41 → prediction logged for comparison
```

Shadowing detects input incompatibility, serving errors, latency, and changed prediction behavior against production traffic. It cannot measure the business outcome of actions v41 never took, so canary exposure is still needed for that evidence.

During a canary, routing metadata must preserve which version saw each request. Monitoring should compare error, latency, feature, prediction, and later outcome measures by version. If v41 reaches 25% traffic and begins failing, the stable service interface lets routing return to v40 without requiring every client to change.

Serving designs differ by workload. A batch scoring job writes a predictions table. A real-time API optimizes request latency and availability. A streaming detector combines event ingestion, streaming state, inference, and alerting. No universal serving stack fits all three.

## How Do Monitoring and Outcomes Close the Learning Loop?
<!-- section-summary: Immediate service, input, and prediction signals detect early problems, while delayed outcomes reveal actual model and business performance and provide future training evidence. -->

Service monitoring begins with whether predictions can be delivered. Latency, error rate, throughput, availability, CPU, memory, GPU use, queue depth, and timeouts belong here. Excellent model accuracy cannot compensate for P99 latency of eight seconds when the decision deadline is far shorter.

Infrastructure signals can all look healthy while ML behavior fails. A service may report 99.99% availability, zero errors, P95 latency of 40 milliseconds, and normal CPU while production accuracy collapses.

Input monitoring looks for a changed or broken world. If training transaction amounts ranged from $1 to $10,000 and production suddenly contains many values of $500,000, possible causes include a new business segment, a currency mistake, an upstream bug, or a changed fraud pattern. Schema, nulls, ranges, categories, feature distributions, and freshness supply evidence.

Prediction monitoring provides an earlier warning when labels are delayed. If 5% of training predictions exceeded `0.8` and 60% of production predictions now exceed it, the population, feature pipeline, model, or real phenomenon may have changed. The distribution cannot identify the cause by itself, but it tells the team where to investigate.

Actual quality requires joining predictions with outcomes. A prediction record might contain:

```text
prediction_id: P123
customer: C87
model_version: 41
prediction: 0.82
```

Three months later, the system records that customer C87 churned. Joining the outcome to `P123` allows calculation of (Loss(\hat{y}, y)) on production data.

Monitoring therefore has two timescales:

```text
immediate: service health, input health, prediction behavior
delayed:   accuracy, precision, recall, calibration, business outcomes
```

Production evidence creates the learning loop:

$$
D_t \rightarrow Train \rightarrow M_t \rightarrow Predictions_t
\rightarrow Outcomes_t \rightarrow D_{t+1}
$$

The record should include the features at prediction time, prediction, model version, action, exposure, and eventual outcome. Actions matter because the system can influence the data it later observes. A fraud model that blocks a transaction may never reveal what would have happened after approval. A recommender shows item A, users click item A, and future data records more interest in A partly because the model created that exposure.

Thus (D_{t+1}) may depend on (M_t). The architecture is a feedback system rather than a passive observation pipeline.

### Preserve the Action and Exposure

Recording only the score and eventual label can give a misleading view. If the fraud policy blocks every transaction above `0.8`, the system observes chargebacks mainly for approved transactions. The missing counterfactual—what a blocked transaction would have done—affects how labels should be interpreted.

A recommendation system creates a similar loop. Showing item A increases the chance of a click on item A. A future training set that treats clicks as independent preferences may strengthen the same recommendations because of their prior exposure.

Useful feedback records therefore include:

```text
prediction_id
model_version
features or a traceable feature snapshot
raw score
business policy version
action taken
exposure or treatment
eventual outcome
outcome observation time
```

This evidence lets analysts separate what the model predicted from what the system did and what the world later revealed. It also supports delayed evaluation for fraud, churn, returns, and other outcomes that cannot be known at request time.

![Four complementary views of a production ML problem: service, data, model, and outcome evidence](/content-assets/articles/article-mlops-mlops-foundations-simple-mlops-architecture/four-production-evidence-views.png)

*Immediate operational evidence and delayed outcome evidence answer different production questions.*

## How Do Coordination, Contracts, and Recovery Hold the System Together?
<!-- section-summary: Orchestration, authorization, human and automated gates, version history, explicit contracts, and failure paths coordinate responsibilities across team and system boundaries. -->

Orchestration coordinates ingestion, validation, feature construction, training, evaluation, registration, deployment, monitoring, and retraining. It is the scheduler and conductor, while the architecture contains the full set of components and relationships.

Access control decides who may read customer data, start expensive GPU work, modify feature definitions, approve a model, deploy to production, change thresholds, access sensitive predictions, or delete artifacts. A typical responsibility split might allow an ML engineer to train a candidate, a reviewer to approve it, a deployment service to release only approved identities, an application to request predictions, and an auditor to read lineage and logs.

Humans and automation share the control plane. Unit tests, schema rules, and latency checks may run automatically. Credit or clinical releases may require risk or domain review. The right mix follows consequence.

History crosses every boundary. Code versions, data versions, training runs, model versions, configuration, feature definitions, approvals, deployment events, predictions, monitoring incidents, and outcomes allow a team to reconstruct yesterday after a failure today.

Contracts reduce hidden assumptions. A prediction API can define:

```text
input: customer_id, transaction_amount
output: fraud_probability, model_version, prediction_id
```

A training pipeline can promise a model artifact, evaluation report, and training metadata. A feature contract can state name, type, meaning, freshness, valid range, and missing behavior. Components can change internally while preserving the agreed boundary.

Failure paths are part of the design. Ask what happens if a source is late, schema validation fails, training crashes, evaluation rejects a candidate, registry storage is unavailable, deployment raises errors, the online feature path fails, or monitoring detects drift.

Each case needs a bounded response. A late source can stop the dependent training run without altering the last published dataset. A schema failure can quarantine candidate data. A crashed training job can retry against the same declared run inputs or end with a visible failure. A rejected model remains outside the approved alias. An unavailable registry prevents deployment rather than encouraging a manual untracked copy. An unavailable online feature path follows an explicit fallback or fails safely according to product policy.

| Failure | Safe architectural response |
| --- | --- |
| Source partition late | Hold dependent work and alert the source owner |
| Schema contract fails | Quarantine the candidate dataset |
| Training process crashes | Retry safely or record a failed run |
| Evaluation gate fails | Keep the candidate unapproved |
| Registry unavailable | Stop the release and preserve the current version |
| Canary errors increase | Stop expansion and restore prior traffic |
| Current feature lookup fails | Use the documented fallback or reject the request |
| Drift alert fires | Investigate data and outcome evidence before changing the model |

```text
candidate deployment
    ↓
error rate rises
    ↓
stop expansion
    ↓
route traffic to the previous version
    ↓
preserve evidence for diagnosis
```

Good architecture bounds failures so one unsuccessful step does not corrupt a published dataset, overwrite the approved model, or remove the current serving path. Safe retry, immutable identities, isolated candidate outputs, atomic publication, health gates, and rollback all contribute to recovery.

Contracts make those responses predictable between teams. A source contract defines availability and schema. A feature contract defines semantics and freshness. A training contract defines inputs and outputs. An evaluation contract defines required evidence. A serving contract defines requests, responses, version identity, deadlines, and failure behavior. Monitoring contracts define who receives which alerts and which action they can take.

## How Much Architecture Does a Production System Need?
<!-- section-summary: Every production system covers the same logical responsibilities, while its physical components should grow only in response to demonstrated scale, latency, governance, or reuse needs. -->

Every production ML architecture must answer a stable set of questions:

| Responsibility | Fundamental question |
| --- | --- |
| Data acquisition | Where does evidence come from? |
| Data validation | Can the arriving data be trusted? |
| Feature computation | What exactly does the model receive? |
| Training | How is a candidate produced? |
| Experiment tracking | What happened in the run? |
| Artifact storage | Where is the model package? |
| Model registry | Which model identity is under discussion? |
| Evaluation | Is the complete package good enough? |
| Approval | Is it allowed to advance? |
| Deployment | How does it reach an environment? |
| Serving | How does a consumer receive predictions? |
| Monitoring | Is the service and model still healthy? |
| Feedback | What happened after the action? |
| Orchestration | What runs, when, and in which order? |
| Access control | Who may perform each action? |
| Lineage | How are all artifacts and events connected? |

These are logical responsibilities. The physical architecture assigns them to technologies. One cloud platform may cover several. Another company may use source control, a data platform, an orchestrator, experiment tracking, artifact storage, a registry, CI/CD, a serving platform, operational observability, and ML monitoring as separate systems. Coverage and operability matter more than tool count.

A large organization serving millions of predictions per second across hundreds of models may justify streaming infrastructure, a feature platform, GPU scheduling, multi-region serving, traffic control, a data catalog, a policy engine, specialized model monitoring, and centralized observability. Each component also adds deployment, security, maintenance, monitoring, failure modes, upgrades, and expertise.

For one nightly churn model, a smaller path can be sufficient:

```text
Git repository
    ↓
scheduled pipeline
    ↓
warehouse and feature SQL
    ↓
training and evaluation script
    ↓
artifact storage and model metadata
    ↓
batch prediction job
    ↓
predictions table
    ↓
monitoring and later outcomes
```

Kubernetes, stream processing, a GPU cluster, a service mesh, an online feature store, and a real-time model server add risk if the product does not need them.

A small real-time system may add a prediction API and recent feature path:

```text
training: warehouse → features → train → evaluate → approved model
serving:  application → prediction API → model + recent features → response
feedback: prediction logs + outcomes → warehouse → next training cycle
```

Architecture should grow through:

$$
\boxed{\text{Problem} \rightarrow \text{Responsibility} \rightarrow \text{Tool}}
$$

Ten models reusing inconsistent customer features may justify a feature platform. Hundreds of regulated releases may justify centralized approval. Thousands of distributed GPU jobs may justify specialized training infrastructure. The problem supplies the reason.

Architecture exists at several levels. The product level maps user, application, prediction, and decision. The lifecycle level maps data, training, evaluation, release, and monitoring. The platform level maps storage, compute, orchestration, registry, serving, and observability. The infrastructure level maps networks, containers, clusters, databases, object storage, and IAM. Engineers should move between these levels without treating them as interchangeable.

The logical architecture stays stable across implementations. “Training, registry, serving, and monitoring” names responsibilities. A physical architecture might implement training with managed cloud jobs, the registry with product X, serving on Kubernetes, and monitoring with product Y. A later migration can change the physical assignments while preserving the logical contracts.

At the product level, the question is how a user or business event reaches a model-assisted decision. At the lifecycle level, the question is how evidence creates and replaces model versions. At the platform level, the question is which shared services support teams. At the infrastructure level, the question is how networks, identities, storage, and compute make those services reliable and secure.

The architecture's real output is a **reliable model change**. Fast training alone does not make the learning loop fast if release takes three weeks, labels require six months of manual work, or nobody monitors quality.

$$
T_{learning}=T_{data}+T_{training}+T_{evaluation}+T_{release}+T_{feedback}
$$

The whole loop must become reliable and efficient.

One monthly production flow may validate new data, compute features, run training job 981, record inputs and metrics, create model v52, evaluate it, approve it, send 5% of traffic, expand exposure, record versioned predictions, join outcomes, measure production performance, diagnose problems, and start the next cycle. Orchestration, access control, versioning, logging, lineage, monitoring, and rollback surround every step.

The sequence demonstrates why the architecture should optimize the entire loop. Reducing training from three hours to ten minutes has limited value if evaluation waits days for manual evidence or deployment takes three weeks. Fully automated deployment offers little learning speed if outcomes require six months of untracked SQL. Fast prediction delivery is incomplete if no one can relate the results to actual returns or fraud.

The architecture's output is therefore the ability to make a reliable model change:

```text
new evidence
    ↓
identified candidate
    ↓
validated improvement
    ↓
controlled production change
    ↓
observed outcome
```

That ability joins development and operation. It measures how safely the organization can learn, rather than how quickly one isolated training job can finish.

![Minimum production ML architecture connecting versioned data, reproducible training, evaluation, release, prediction delivery, and feedback](/content-assets/articles/article-mlops-mlops-foundations-simple-mlops-architecture/minimum-production-ml-architecture.png)

*The minimum architecture covers the complete loop; additional components should solve a demonstrated operating problem.*

## Check Your Answers

Use these answers to check whether you can explain an ML architecture through responsibilities and flows before naming products.

:::expand[How Does the Product Define the Architecture?]{kind="recap"}
The prediction moment, consumer, action, outcome delay, latency, throughput, availability, and cost determine whether the system needs batch, online, or streaming paths and which responsibilities must connect them.
:::

:::expand[What Moves Through the Data, Control, and Metadata Planes?]{kind="recap"}
The data plane carries facts, features, requests, predictions, and outcomes. The control plane schedules and authorizes work. The metadata plane records identities, lineage, metrics, approvals, deployments, and history.
:::

:::expand[How Do Data and Features Support Training and Inference?]{kind="recap"}
Feature definitions translate real facts into model inputs. Offline paths reconstruct large histories, while online paths serve current values quickly; both must preserve the same entity, time, source, and missing-value semantics.
:::

:::expand[How Does Training Produce an Approved Model Identity?]{kind="recap"}
An orchestrated run connects versioned data, features, code, parameters, and environment to a candidate. Evaluation tests the complete serving package, and gates authorize one immutable registry identity.
:::

:::expand[How Does Serving Turn a Model into a Product Capability?]{kind="recap"}
Serving validates requests, obtains features, runs the approved package, and returns a versioned prediction. A separate policy converts the score into an action, while stable interfaces and traffic control support release and rollback.
:::

:::expand[How Do Monitoring and Outcomes Close the Learning Loop?]{kind="recap"}
Immediate service, input, and prediction signals expose early problems. Delayed outcomes reconnect to prediction IDs, reveal actual model and business performance, and provide evidence for future datasets while recording feedback effects.
:::

:::expand[How Do Coordination, Contracts, and Recovery Hold the System Together?]{kind="recap"}
Orchestration, permissions, automated and human gates, history, interface contracts, isolated candidate outputs, and rollback keep components and teams coordinated and make failures bounded and recoverable.
:::

:::expand[How Much Architecture Does a Production System Need?]{kind="recap"}
Every system needs the logical responsibilities, but physical complexity should follow actual batch, latency, scale, reuse, governance, and recovery needs. The architecture should optimize reliable changes across the whole learning loop.
:::

## References

- [MLflow documentation](https://mlflow.org/docs/latest/)
- [Apache Airflow documentation](https://airflow.apache.org/docs/)
- [Kubeflow Pipelines documentation](https://www.kubeflow.org/docs/components/pipelines/)
- [Feast documentation](https://docs.feast.dev/)
- [GitHub Actions documentation](https://docs.github.com/en/actions)
