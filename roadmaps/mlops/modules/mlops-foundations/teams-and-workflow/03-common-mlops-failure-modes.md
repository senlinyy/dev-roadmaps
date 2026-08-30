---
title: "MLOps Failure Modes"
description: "Learn how broken lifecycle contracts create recurring production ML failures, and how teams investigate, contain, repair, and prevent them."
overview: "Production ML usually fails at a handoff: exploration cannot run as a job, training data cannot be recovered, serving computes different features, evaluation misses product risk, releases lack a proven rollback, monitoring loses contact with reality, feedback is defective, ownership is unclear, or the platform grows faster than the models it serves. A lifecycle-contract framework connects each failure to its visible symptoms, evidence path, industrial repair, and prevention controls."
tags: ["MLOps", "core", "teams"]
order: 3
id: "article-mlops-mlops-foundations-common-mlops-failure-modes"
---

## Table of Contents

1. [What Counts as Failure in an ML System?](#what-counts-as-failure-in-an-ml-system)
2. [How Do Unreproducible Experiments and Hidden State Break Development?](#how-do-unreproducible-experiments-and-hidden-state-break-development)
3. [How Do Leakage, Skew, Schema, Freshness, and Label Problems Corrupt Data?](#how-do-leakage-skew-schema-freshness-and-label-problems-corrupt-data)
4. [How Can Splits, Metrics, and Promotion Rules Select the Wrong Model?](#how-can-splits-metrics-and-promotion-rules-select-the-wrong-model)
5. [How Do Artifact, Configuration, Dependency, Deployment, and Rollback Failures Break Release?](#how-do-artifact-configuration-dependency-deployment-and-rollback-failures-break-release)
6. [How Do Drift, Delayed Labels, Feedback, and Actionless Monitoring Hide Production Failure?](#how-do-drift-delayed-labels-feedback-and-actionless-monitoring-hide-production-failure)
7. [How Do Ownership, Permissions, Pipelines, and Platform Design Amplify Failure?](#how-do-ownership-permissions-pipelines-and-platform-design-amplify-failure)
8. [How Do Broken Contracts and Layered Defences Guide Recovery?](#how-do-broken-contracts-and-layered-defences-guide-recovery)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A model service returns `200 OK`, latency looks normal, and the servers are healthy. At the same time, fraud recall falls from `0.89` to `0.52` because an upstream change altered one feature. The system is available, yet the ML product is failing.

ML failures can begin in data, labels, feature logic, splits, metrics, artifacts, configuration, deployment, monitoring, feedback, permissions, or ownership. A mistake at one step can pass quietly into every later step.

Investigation should therefore begin with the broken assumption. What information changed? Which transformation or decision used it? Which versions are affected? Who can contain the harm? How will the team prove that the repair worked?

Use these questions to trace the common failure paths:

1. **What Counts as Failure in an ML System?**
2. **How Do Unreproducible Experiments and Hidden State Break Development?**
3. **How Do Leakage, Skew, Schema, Freshness, and Label Problems Corrupt Data?**
4. **How Can Splits, Metrics, and Promotion Rules Select the Wrong Model?**
5. **How Do Artifact, Configuration, Dependency, Deployment, and Rollback Failures Break Release?**
6. **How Do Drift, Delayed Labels, Feedback, and Actionless Monitoring Hide Production Failure?**
7. **How Do Ownership, Permissions, Pipelines, and Platform Design Amplify Failure?**
8. **How Do Broken Contracts and Layered Defences Guide Recovery?**

## What Counts as Failure in an ML System?

<!-- section-summary: Failure means the complete system no longer produces acceptable outcomes under its intended conditions. -->

A clear starting point for understanding MLOps failure modes is to start with one fact:

> **An ML system is not one program. It is a chain of transformations and decisions.**

A useful abstraction is:

$$
\text{Raw Data}
\rightarrow
\text{Features}
\rightarrow
\text{Training}
\rightarrow
\text{Model}
\rightarrow
\text{Evaluation}
\rightarrow
\text{Release}
\rightarrow
\text{Serving}
\rightarrow
\text{Decisions}
\rightarrow
\text{Outcomes}
\rightarrow
\text{Feedback}
$$

Every arrow is a place where information can be lost, changed, misunderstood, delayed, or incorrectly trusted. Most MLOps failures can therefore be traced to an assumption that broke while crossing one of those boundaries:

$$
\boxed{
\text{Most ML failures are failures of assumptions across boundaries.}
}
$$

The model's mathematics can be correct even while the complete ML system produces the wrong result.

### What does “failure” actually mean?

A failure is not limited to:

```text
service crashed
```

An ML system can fail while every server is healthy. Imagine a fraud model where:

```text
HTTP status = 200
latency = 40 ms
CPU = 35%
```

Everything looks technically healthy. But perhaps:

$$
\text{Fraud Recall}:
0.89 \rightarrow 0.52
$$

because fraud patterns changed. The application is available, yet the ML system is failing. Or suppose model quality is excellent, but the system blocks too many legitimate customers.

Again:

$$
\text{Model works}
$$

but:

$$
\text{Product fails}
$$

So a better definition is:

$$
\boxed{
\text{ML Failure}
=
\text{The system no longer produces acceptable outcomes under its intended conditions.}
}
$$

Under that definition, failure can originate in software, data, the model, team coordination, or the business decision around the prediction.

### Why ML systems have more failure modes than ordinary software

Traditional software is frequently approximately:

$$
y=f(x)
$$

where programmers explicitly define $$f$$. If the code does not change and the inputs satisfy the contract, behavior is commonly fairly predictable. ML changes this.

The function itself is learned:

$$
f_\theta
=
\operatorname{Train}(D,C,H)
$$

where:

* $$D$$ is data,
* $$C$$ is training code,
* $$H$$ is configuration and hyperparameters.

Production output then becomes:

$$
\hat y=f_\theta(x_{production})
$$

Therefore behavior depends on at least:

$$
\text{Code}
+
\text{Training Data}
+
\text{Production Data}
+
\text{Learned Parameters}
+
\text{Infrastructure}
+
\text{Business Policy}
$$

Each can change independently. The result gives ML systems a much larger failure surface.

### Most failures begin with an assumption

Suppose a model was trained assuming:

$$
0 \leq \text{customer\_age} \leq 100
$$

The training code may never explicitly say:

“Production age values will remain in this range.”

It merely assumes it. Or the model may assume:

```text
income is measured in GBP
```

Or:

```text
missing means unknown
```

Or:

```text
the label represents actual fraud
```

Or:

```text
the future resembles the training period
```

Leaving these assumptions implicit makes them dangerous. One practical way to understand robustness is:

$$
\text{Reliable ML}
=
\text{Assumptions}
+
\text{Checks on those assumptions}
$$

An unchecked assumption is a future failure mode.

## How Do Unreproducible Experiments and Hidden State Break Development?

<!-- section-summary: Hidden cell order, local files, undeclared packages, mutable data, missing configuration, and lost randomness make the visible source differ from the run that created the model. -->

### Failure: the experiment cannot be reproduced

Imagine a data scientist creates:

```text
model_final.pkl
```

It performs extremely well. Three months later nobody can reconstruct how it was trained. Perhaps the organization knows the Git commit but not the dataset.

Or the dataset is known but the Python environment changed. Or nobody recorded the hyperparameters. The model can be thought of as:

$$
M=
F(
C,
D,
H,
E,
R
)
$$

where:

* $$C$$ = code,
* $$D$$ = data,
* $$H$$ = hyperparameters,
* $$E$$ = environment,
* $$R$$ = randomness.

If any of these are unknown, reproducing $$M$$ becomes difficult. The result creates downstream problems:

```text
Cannot debug model
Cannot audit model
Cannot compare fairly
Cannot rebuild model
Cannot explain production behavior
```

The root failure is **lost lineage**. MLOps addresses it by recording the provenance of training artifacts.

### Failure: hidden notebook state

A notebook can produce a correct-looking result from an execution order nobody intended. Suppose the notebook contains:

```text
Cell 1: load data
Cell 2: create features
Cell 3: learning_rate = 0.1
Cell 4: train
Cell 5: learning_rate = 0.01
```

But the actual execution order was:

$$
1 \rightarrow 2 \rightarrow 5 \rightarrow 4
$$

The visible notebook order no longer describes the experiment. The failure comes from:

$$
\text{Program State}
\neq
\text{Visible Source Order}
$$

This is one reason production training moves important logic into explicit scripts or pipelines. For example:

```text
python train.py --config production.yaml
```

has a much clearer execution contract.

![Common production ML failures appearing at the handoffs between exploration, data preparation, training, release, operation, and learning](/content-assets/articles/article-mlops-mlops-foundations-common-mlops-failure-modes/failures-at-handoffs.png)

*Recurring failures frequently reveal a missing contract at a lifecycle handoff. Identity, evidence, ownership, and a return path make the handoff operable.*

## How Do Leakage, Skew, Schema, Freshness, and Label Problems Corrupt Data?

<!-- section-summary: Leakage supplies future information, skew gives training and serving different transformations, semantic schema changes preserve types while altering meaning, stale features violate the decision-time contract, and defect -->

### Failure: data leakage

Data leakage is one of the most dangerous development failures because it creates the illusion of success. Suppose you want to predict whether a customer will cancel tomorrow. You accidentally include:

```text
account_closed_date
```

as a feature. That value might only exist *after* cancellation. The model sees information from the future.

You might obtain:

$$
Accuracy=99.7\%
$$

but production performance collapses. Why? During evaluation:

$$
X_{test}
\supset
\text{future information}
$$

while during real prediction:

$$
X_{production}
\not\supset
\text{future information}
$$

Therefore:

$$
\text{Evaluation Problem}
\neq
\text{Production Problem}
$$

The model did not generalize poorly. You accidentally tested it on an easier problem.

### Failure: training and serving use different features

Suppose training computes:

```python
average_purchase = total_spend / order_count
```

but production computes:

```python
average_purchase = total_spend / max(order_count, 1)
```

They look similar. But they are not identical. Or training normalizes:

$$
x' = \frac{x-\mu_{train}}{\sigma_{train}}
$$

while production accidentally computes new $$\mu$$ and $$\sigma$$ every day. Now the model receives feature values different from those it was trained to interpret. This is called **training-serving skew**.

Formally:

$$
g_{train}(x)
\neq
g_{serve}(x)
$$

where $$g$$ is the feature transformation. Even if:

$$
f_\theta
$$

is unchanged, predictions can become wrong because:

$$
f_\theta(g_{train}(x))
\neq
f_\theta(g_{serve}(x))
$$

This is why shared feature definitions and feature tests matter.

### Failure: the data schema still “looks valid”

Some data failures are obvious. For example:

```text
expected: integer
received: string
```

But subtler failures are more dangerous. Suppose the model expects:

```text
income = annual income in GBP
```

The upstream system changes it to:

```text
income = monthly income in GBP
```

The field is still numeric. The column name is still `income`. The schema validator passes.

Yet values are approximately:

$$
12\times
$$

smaller than expected. This is a **semantic schema failure**. The lesson is:

$$
\text{Type Correctness}
\neq
\text{Meaning Correctness}
$$

A useful data contract records what a value means, its unit and allowed range, how fresh it must be, and who owns it. A SQL type covers only part of that agreement.

### Failure: stale data

Suppose a fraud model depends on:

```text
transactions_last_10_minutes
```

but the feature pipeline is four hours behind. The field may contain perfectly valid numbers. The schema is correct.

The service does not crash. But the model is making decisions from old information. That means:

$$
\text{Feature Freshness}

\text{Maximum Useful Freshness}
$$

This is particularly dangerous because the value itself does not advertise that it is stale. The production contract therefore needs temporal properties such as:

$$
\text{freshness} < 5\text{ minutes}
$$

not just value constraints.

### Failure: bad labels

ML systems learn from labels:

$$
(x_i,y_i)
$$

If $$y_i$$ is wrong, the model learns the wrong relationship. Imagine a support team labels transactions as:

```text
fraud
not_fraud
```

but a process change means 30% of fraud cases are never investigated. Now:

$$
y_{\text{recorded}}
\neq
y_{\text{true}}
$$

The model may appear to train correctly, yet its objective has become corrupted. Label problems are especially hard because features receive lots of engineering attention while labels are frequently treated as unquestioned truth. The practical limit is simple:

$$
\boxed{
\text{A supervised model cannot be better than the meaning of its target.}
}
$$

## How Can Splits, Metrics, and Promotion Rules Select the Wrong Model?

<!-- section-summary: Entity or future leakage can make a test set too easy. -->

### Failure: poor train-test splitting

Suppose you randomly split transaction data:

$$
80\%\rightarrow training
$$

$$
20\%\rightarrow test
$$

That sounds reasonable. But imagine multiple transactions belong to the same customer. Transactions from customer Alice may appear in both sets.

Now the model indirectly sees Alice during training and testing. Evaluation may become unrealistically easy. Or suppose you randomly mix historical and future transactions.

Then the test set no longer represents:

$$
\text{Train on past}
\rightarrow
\text{Predict future}
$$

A more realistic split might be temporal:

$$
D_{train}
=
\text{January--June}
$$

$$
D_{test}
=
\text{July}
$$

A test result is relevant only when the test examples resemble the conditions the deployed model must handle.

### Failure: optimizing the wrong metric

Suppose a fraud dataset contains:

$$
99.5\%\text{ legitimate}
$$

and:

$$
0.5\%\text{ fraud}
$$

A model predicting:

```text
not fraud
```

for everything obtains:

$$
Accuracy=99.5\%
$$

Excellent? Obviously not. The system has:

$$
Recall_{\text{fraud}}=0
$$

The mathematical failure is not necessarily in the model. The organization optimized the wrong objective. This principle generalizes:

$$
\boxed{
\text{Good optimization of the wrong metric produces a bad system efficiently.}
}
$$

MLOps evaluation therefore needs metrics linked to actual system goals.

### Failure: offline metrics do not represent business value

Imagine two recommendation models. Model A:

$$
CTR=8.4\%
$$

Model B:

$$
CTR=8.7\%
$$

Model B wins offline and is released. Then revenue falls. Maybe Model B encourages clicks on low-value items.

So:

$$
\text{Higher CTR}
\not\Rightarrow
\text{Higher Business Value}
$$

ML metrics are proxies. The chain is:

$$
\text{Model Metric}
\rightarrow
\text{User Behaviour}
\rightarrow
\text{Business Outcome}
$$

Every arrow introduces uncertainty. Production evaluation must therefore eventually include downstream outcomes, not just statistical model scores.

### Failure: evaluating on yesterday's world

Suppose a model was evaluated on data generated under an old business process. Then the company changes:

```text
pricing
customer acquisition
website design
country coverage
```

A test set might remain statistically well curated while no longer representing production. Formally:

$$
P_{eval}(X,Y)
\neq
P_{prod}(X,Y)
$$

Therefore:

$$
\text{Evaluation Accuracy}
$$

may no longer predict:

$$
\text{Production Accuracy}
$$

A model evaluation is always conditional on a distribution. That distribution can expire.

### Failure: model promotion based on one number

Suppose the current model has:

$$
AUC=0.90
$$

and the candidate:

$$
AUC=0.92
$$

An automated process promotes the candidate. But perhaps:

$$
P95 latency:
50ms \rightarrow 800ms
$$

and:

$$
Memory:
500MB \rightarrow 12GB
$$

or fairness on an important subgroup deteriorates. Production suitability is multidimensional. A better mental model is:

$$
\text{Release Readiness}
=
f(
\text{Quality},
\text{Reliability},
\text{Latency},
\text{Cost},
\text{Risk},
\text{Business Impact}
)
$$

No single metric necessarily dominates all others.

### Failure: “newer means better”

Automated retraining creates a subtle trap. Suppose:

```text
new data arrives
→ model retrains
→ v38 created
```

It is tempting to automatically do:

```text
v38 → production
```

But:

$$
\text{Newer}
\not\Rightarrow
\text{Better}
$$

The new data may be noisy. Labels may be incomplete. An upstream system may have changed.

Optimization may converge differently. So retraining and release need separation:

$$
\text{Retrain}
\rightarrow
\text{Candidate}
\rightarrow
\text{Evaluate}
\rightarrow
\text{Approve}
\rightarrow
\text{Release}
$$

not:

$$
\text{Retrain}
\rightarrow
\text{Production}
$$

## How Do Artifact, Configuration, Dependency, Deployment, and Rollback Failures Break Release?

<!-- section-summary: Production behaviour relies on the exact artifact, runtime image, feature contract, policy, configuration, dependencies, infrastructure, and route. -->

### Failure: artifact confusion

Consider these files:

```text
model.pkl
model_new.pkl
model_final.pkl
model_final_v2.pkl
model_final_REAL.pkl
```

Which model is production using? If nobody knows, the system has an identity problem. Production models need immutable identities.

For example:

```text
fraud-model:v27
artifact hash: 8c93...
```

Now:

$$
\text{Production Version}
\rightarrow
\text{Exact Artifact}
$$

Without this mapping, debugging and rollback become unreliable.

### Failure: configuration drift

The source code might be identical in staging and production, but configuration differs. For example:

```text
staging:
threshold = 0.85
```

while:

```text
production:
threshold = 0.65
```

The deployed model artifact is identical. Yet business behavior changes drastically. This demonstrates:

$$
\text{Production Behaviour}
=
f(
\text{Model},
\text{Code},
\text{Configuration}
)
$$

Configuration helps determine live behavior, so it belongs under the same versioning and control discipline as other production inputs.

### Failure: dependency drift

A model may have been trained using one library version and loaded using another. For example:

```text
training:
library version A
```

versus:

```text
production:
library version B
```

Sometimes that causes an obvious crash. That is actually the easier failure. The harder failure is when it loads successfully but numerical behavior changes slightly.

Then:

$$
\text{No Error}
\not\Rightarrow
\text{Same Behaviour}
$$

Controlled environments and integration tests reduce this class of problem.

### Failure: deployment succeeds technically but fails operationally

A model can pass every offline test and still be unsuitable for production. Suppose:

$$
P95\ inference=3.2s
$$

but the calling service needs:

$$
P95 < 100ms
$$

Or perhaps each replica requires:

$$
32GB\ GPU\ memory
$$

and serving cost becomes enormous. The model's theoretical quality does not matter if it cannot meet the operational contract. Therefore:

$$
\text{Model Quality}
\neq
\text{Service Quality}
$$

Production evaluation needs both.

### Failure: no rollback path

Suppose deployment succeeds. Five minutes later, the business KPI collapses. The team discovers that returning to the old model requires:

```text
find old notebook
rerun training
rebuild image
manually modify production
```

The problem is not merely that v28 failed. The deployment system failed to preserve a known-good recovery path. A mature release mechanism should preserve:

$$
M_{current}
$$

and:

$$
M_{previous}
$$

so recovery can be:

$$
v28 \rightarrow v27
$$

rather than:

$$
v28 \rightarrow \text{emergency reconstruction}
$$

![Evidence-first investigation order with user-impact containment running in parallel](/content-assets/articles/article-mlops-mlops-foundations-common-mlops-failure-modes/evidence-first-investigation.png)

*The investigation validates evidence and recent changes before assigning blame. Containment runs in parallel so user impact does not wait for a complete root-cause analysis.*

## How Do Drift, Delayed Labels, Feedback, and Actionless Monitoring Hide Production Failure?

<!-- section-summary: Data drift changes inputs, while concept drift changes their relationship to outcomes. -->

### Failure: monitoring only the servers

Suppose your dashboards show:

```text
CPU
memory
request count
latency
HTTP errors
```

Those are necessary. But they cannot tell you that customer data changed drastically. For ML, monitoring needs at least four conceptual layers:

| Layer          | Question                              |
| -------------- | ------------------------------------- |
| Infrastructure | Is the system running?                |
| Data           | Are inputs still valid?               |
| Model          | Are predictions behaving as expected? |
| Outcome        | Is the system still useful?           |

If you monitor only infrastructure, you can have:

$$
\text{All dashboards green}
$$

while:

$$
\text{Model usefulness}=0
$$

### Failure: data drift

Suppose training income follows:

$$
P_{train}(\text{income})
$$

but six months later:

$$
P_{prod}(\text{income})
$$

has changed significantly. Perhaps the company entered another country. Perhaps inflation changed customer behavior.

Perhaps a new acquisition campaign attracts a different demographic. This is broadly called **data drift**. Conceptually:

$$
P_{train}(X)
\neq
P_{prod}(X)
$$

But drift does not automatically mean failure. Some drift is harmless. The real question is:

Does the distribution change invalidate assumptions important to model behavior?

So drift metrics should trigger investigation, not automatic panic.

### Failure: concept drift

Data drift concerns the inputs. Concept drift concerns the relationship between inputs and outcomes. Originally:

$$
P(Y|X)=P_{old}(Y|X)
$$

Later:

$$
P(Y|X)=P_{new}(Y|X)
$$

Consider fraudsters adapt. The same transaction pattern that previously indicated fraud may stop doing so. Even if:

$$
P(X)
$$

looks similar, the meaning of those inputs has changed. This is particularly dangerous because ordinary input-distribution monitoring might not detect it. You frequently need labels or business outcomes to detect concept drift reliably.

### Failure: labels arrive too late

Suppose you predict 90-day default risk. Today's prediction cannot be evaluated today. Actual ground truth may appear months later.

The result creates a visibility gap:

$$
t_{prediction}
\ll
t_{label}
$$

During that gap, you may monitor:

```text
feature distributions
prediction distributions
system health
business proxies
```

But you cannot yet know true model accuracy. A mature monitoring strategy distinguishes:

$$
\text{Immediate Proxies}
$$

from:

$$
\text{Delayed Ground Truth}
$$

Without that connection, a dashboard may look like model-performance monitoring even though it reports only indirect warning signs.

### Failure: feedback loops change the world

This is one of the most interesting ML failures. Suppose a model predicts:

“Customer is likely to churn.”

The company sends that customer a retention discount. The customer stays. Later, the training pipeline observes:

```text
high churn probability
customer did not churn
```

Was the model wrong? Not necessarily. The model's prediction caused an intervention that changed the outcome.

Now:

$$
\text{Prediction}
\rightarrow
\text{Action}
\rightarrow
\text{Outcome}
$$

Therefore the observed label is influenced by the model itself. The system is no longer passively predicting the world. It is participating in creating the world it later learns from.

This is a **feedback loop**.

### Failure: selective labels

Consider fraud detection. The model marks suspicious transactions. Only suspicious transactions receive manual investigation.

Then high-risk transactions acquire high-quality labels while low-risk ones may never be investigated. Now the training dataset contains:

$$
P(\text{label observed}|X)
$$

that depends partly on the previous model. The next model learns from a biased view of reality. Similar problems appear in lending, hiring, moderation, healthcare, and recommendation systems.

The deeper principle is:

$$
\text{Observed Data}
\neq
\text{Neutral Sample of Reality}
$$

especially when previous ML decisions influence what gets observed.

### Failure: monitoring without action

Suppose you have 40 dashboards and 200 alerts. A feature-distribution alert fires:

```text
transaction_amount drift detected
```

Then nothing happens because nobody knows who owns it. A metric gains operational value only after the team defines a response path:

$$
\text{Signal}
\rightarrow
\text{Owner}
\rightarrow
\text{Diagnosis}
\rightarrow
\text{Action}
$$

Without that:

$$
\text{Monitoring}
=
\text{Visualization}
$$

rather than:

$$
\text{Monitoring}
=
\text{Control System}
$$

This connects monitoring directly to organizational design.

### Failure: alert fatigue

The opposite problem is generating too many alerts. Imagine:

```text
feature drift!
latency drift!
prediction drift!
missing values!
CPU warning!
accuracy warning!
```

every few minutes. If most alerts do not require intervention, engineers learn:

$$
P(\text{real problem}|\text{alert})
\approx 0
$$

Eventually alerts get ignored. A useful alert should ideally imply:

“Someone should investigate or act.”

A useful observation that requires no immediate response belongs on a dashboard; a pager should be reserved for signals that call for action.

### Failure: wrong monitoring thresholds

Suppose a model normally produces:

$$
5\%-8\%
$$

high-risk predictions. An alert fires whenever this exceeds:

$$
8.1\%
$$

The system may trigger constantly from ordinary variance. Alternatively, if the threshold is:

$$
80\%
$$

you will detect problems far too late. Thresholds need to account for:

$$
\text{Normal Variation}
+
\text{Business Risk}
+
\text{Required Reaction Time}
$$

This is fundamentally a control-system design problem.

### Failure: detecting failure but lacking observability

Suppose business conversion drops sharply. The team knows something is wrong. But it cannot answer:

```text
Which model version handled these requests?
Which feature version was used?
Which data source supplied customer_age?
Which threshold was active?
Which deployment occurred beforehand?
```

This is an observability failure. Metrics tell you:

Something happened.

Lineage and structured telemetry help answer:

Why?

A useful relationship is:

$$
\text{Debuggability}
=
\text{Observability}
+
\text{Lineage}
+
\text{Change History}
$$

## How Do Ownership, Permissions, Pipelines, and Platform Design Amplify Failure?

<!-- section-summary: Ambiguous authority delays containment, shared identities erase accountability, excessive permissions enlarge blast radius, and brittle or duplicated pipelines spread defects. -->

### Failure: nobody owns the whole service

Imagine an incident. The data team says:

“The warehouse is healthy.”

The ML team says:

“Model accuracy was fine yesterday.”

The platform team says:

“Kubernetes is healthy.”

The API team says:

“Requests are returning 200.”

Yet customers are receiving nonsense predictions. Each component has an owner. The outcome does not.

This happens when:

$$
\text{Component Ownership}
$$

exists but:

$$
\text{End-to-End Ownership}
$$

does not. A production ML system needs somebody accountable for whether the entire service fulfills its purpose.

### Failure: ownership is ambiguous during incidents

Imagine the model's high-risk prediction rate suddenly doubles. Who gets called? Data engineering?

ML engineering? Data science? SRE?

Product? If the answer is:

“We'll figure it out when it happens,”

the organization has created an incident-response failure before the incident even occurs. Every important alert should have an expected route. Conceptually:

$$
\text{Alert Type}
\rightarrow
\text{Initial Owner}
\rightarrow
\text{Escalation Path}
$$

The initial owner doesn't need to know the root cause immediately. They need responsibility for starting the investigation.

### Failure: too many owners

The opposite of no ownership is collective ownership. Suppose:

```text
Data Science
ML Engineering
Platform
Risk
Product
```

are all listed as owners. Then frequently:

$$
\text{Everyone Owns It}
\Rightarrow
\text{Nobody Feels Accountable}
$$

Many people can participate. But one decision should commonly have a clear accountable owner. For example:

```text
Model quality → ML owner
Data freshness → Data owner
Production reliability → Service owner
Business threshold → Product/Risk owner
Incident coordination → Incident commander
```

Clarity beats vague shared responsibility.

### Failure: manual production changes

Suppose a production problem occurs. Someone SSHs into a server and edits:

```text
threshold = 0.85
```

to:

```text
threshold = 0.72
```

The problem disappears. But the Git repository still says:

```text
threshold = 0.85
```

Now:

$$
\text{Declared State}
\neq
\text{Actual State}
$$

Nobody may remember the change two weeks later. This is configuration drift caused by out-of-band modification. MLOps systems reduce this by requiring production changes to pass through versioned, auditable release processes.

### Failure: shared production credentials

Imagine five engineers use:

```text
ml-prod-admin
```

to deploy models. Later an unauthorized change appears. Who made it?

Nobody knows. Shared identities destroy accountability. A stronger model is:

$$
\text{Human}
\rightarrow
\text{Individual Identity}
$$

and:

$$
\text{Deployment Pipeline}
\rightarrow
\text{Service Identity}
$$

Then audit logs can reconstruct:

$$
\text{Who requested}
\rightarrow
\text{Who approved}
\rightarrow
\text{What automation deployed}
$$

### Failure: excessive permissions

Suppose a training job only needs to:

```text
read training data
write model artifact
```

but its cloud role can also:

```text
delete production database
change IAM policies
modify networking
```

The system has violated least privilege. The resulting risk follows a simple relationship:

$$
\text{Potential Blast Radius}
\propto
\text{Unnecessary Authority}
$$

Each platform component should receive only the permissions and capabilities needed to perform its assigned function.

### Failure: brittle pipelines

Imagine a pipeline with 23 steps where a failed job requires an engineer to rerun everything from the beginning. Or one stage silently produces partial output and the next stage accepts it. A pipeline is not robust merely because it is automated.

A reliable workflow needs properties such as:

$$
\text{Failure Visibility}
$$

$$
\text{Idempotency}
$$

$$
\text{Retry Safety}
$$

$$
\text{Checkpointing}
$$

$$
\text{Clear Dependencies}
$$

Automation can make a good process faster. It can also make a bad process fail faster.

### Failure: pipeline coupling

Suppose changing one feature requires coordinated edits to:

```text
notebook
training script
batch inference job
online API
monitoring code
documentation
```

If the same business concept is independently implemented in six places, divergence becomes likely. If each implementation has probability $$p$$ of being wrong after a change, multiple copies amplify the risk. The deeper design principle is:

$$
\text{Duplicate Logic}
\rightarrow
\text{Synchronization Burden}
\rightarrow
\text{Failure Risk}
$$

Centralizing reusable definitions can reduce this.

### Failure: building too much platform too early

A team has two models. It builds:

```text
Kubernetes
feature store
model registry
workflow orchestration
custom metadata service
internal deployment framework
custom monitoring system
```

Six months later, more engineering effort goes into the platform than the ML product. This is a platform-design failure. The relevant relationship is:

$$
\text{Platform Value}
=
\text{Problems Removed}
-
\text{Complexity Introduced}
$$

Infrastructure should solve recurring problems. Complexity itself is not evidence of maturity.

### Failure: every team builds its own platform

The opposite problem appears in large organizations. Suppose 30 ML teams independently create:

```text
training pipeline
model storage
deployment scripts
monitoring
feature computation
```

Now the organization has:

$$
30\times
\text{Duplicated Infrastructure}
$$

with different reliability and security standards. The result creates operational fragmentation. The platform opportunity is to centralize stable, repeated capabilities:

$$
\text{Common Problem}
\rightarrow
\text{Reusable Platform Capability}
$$

Domain teams can then keep ownership of the ML logic that is specific to their product or problem.

### Failure: abstraction that hides too much

Platforms can also go too far. Imagine a platform exposes:

```text
deploy_model()
```

but hides:

```text
resources
autoscaling
traffic routing
data access
rollback rules
runtime assumptions
```

This may initially seem convenient. But when something breaks, engineers have no mental model of the actual system. Good abstractions hide unnecessary detail without hiding the information required for diagnosis.

So:

$$
\text{Useful Abstraction}
=
\text{Reduced Complexity}
-
\text{Lost Control/Visibility}
$$

Too little abstraction creates repetitive work. Too much creates mysterious systems.

### Failure: platform teams optimize for themselves

A platform team might measure success as:

```text
number of features shipped
number of APIs
number of supported runtimes
```

while ML teams care about:

```text
time to train
time to deploy
reliability
debuggability
ease of experimentation
```

If platform success is not tied to user outcomes, complexity can grow without improving ML productivity. A useful platform should decrease things like:

$$
\text{Time-to-Production}
$$

$$
\text{Operational Toil}
$$

$$
\text{Repeated Engineering}
$$

while increasing:

$$
\text{Reliability}
$$

$$
\text{Reproducibility}
$$

$$
\text{Safety}
$$

### Failure: production and training disagree about reality

Consider an ML model trained on:

```text
country = ["UK", "US", "FR"]
```

Then production starts sending:

```text
country = "GB"
```

The production team considers that perfectly reasonable. The ML code doesn't. Or training uses:

```text
missing age → median
```

while production uses:

```text
missing age → 0
```

These are boundary failures. They happen because different stages hold different interpretations of the same concept. A powerful general rule is:

$$
\boxed{
\text{Every workflow boundary needs an explicit contract.}
}
$$

## How Do Broken Contracts and Layered Defences Guide Recovery?

<!-- section-summary: Classify the failure as wrong information, transformation, artifact, assumption, decision rule, feedback, or ownership, then trace the affected lifecycle contract. -->

### Think of MLOps failure as broken contracts

The result gives us a unified framework. Between data and training:

$$
\text{Data Contract}
$$

Between training and model registry:

$$
\text{Artifact Contract}
$$

Between model and serving:

$$
\text{Inference Contract}
$$

Between serving and product:

$$
\text{Prediction Contract}
$$

Between monitoring and operations:

$$
\text{Response Contract}
$$

Between teams:

$$
\text{Ownership Contract}
$$

Many production incidents trace back to a contract that was absent, incorrectly defined, or broken at runtime.

### Detecting failure is only one part of reliability

Suppose a production feature becomes invalid. A mature system ideally goes through:

$$
\text{Prevent}
\rightarrow
\text{Detect}
\rightarrow
\text{Limit}
\rightarrow
\text{Recover}
\rightarrow
\text{Learn}
$$

For example: **Prevent:** schema validation rejects invalid changes. **Detect:** production monitoring identifies unexpected feature behavior.

**Limit:** canary deployment prevents the problem reaching all traffic. **Recover:** rollback restores the last known-good model. **Learn:** post-incident analysis leads to a new test or control.

The strongest MLOps systems do not merely detect problems. They reduce:

$$
\text{Probability of Failure}
$$

and:

$$
\text{Impact of Failure}
$$

and:

$$
\text{Time to Recovery}
$$

### One failure can propagate through the whole system

Suppose an upstream team changes:

```text
transaction_amount
```

from:

```text
GBP
```

to:

```text
pence
```

without informing the ML team. Then:

```text
Data semantic change
        ↓
Feature values ×100
        ↓
Prediction distribution shifts
        ↓
Most transactions become "high risk"
        ↓
Customers are blocked
        ↓
Support contacts spike
        ↓
Revenue falls
```

The root cause is tiny. The production consequence is huge. This is why MLOps focuses heavily on boundaries, lineage, monitoring, staged release, and ownership.

They contain propagation.

### The Swiss-cheese model of MLOps reliability

No individual safeguard is perfect. Suppose you have:

```text
data validation
unit tests
offline evaluation
peer review
canary release
monitoring
rollback
```

Each can miss something. But the failure must pass through several layers before causing major harm. Conceptually:

$$
P(\text{catastrophic failure})
\approx
P(F_1\cap F_2\cap \cdots \cap F_n)
$$

where $$F_i$$ means safeguard $$i$$ failed to stop the problem. This is **defense in depth**. Good MLOps rarely relies on one magical test.

It builds several imperfect controls.

### The most dangerous failures are often silent

There are two broad classes of failure. A **loud failure** looks like:

```text
training crashed
API unavailable
schema mismatch
container won't start
```

These are painful but visible. A **silent failure** looks like:

```text
service healthy
predictions returned
no exceptions
business decisions gradually worsening
```

Silent failures are frequently more dangerous because:

$$
\text{Time to Detection}
$$

can be very large. ML-specific observability exists largely to detect these failures.

### A compact mental model for failure analysis

When something goes wrong, trace the system in order:

$$
\boxed{
\text{Data}
\rightarrow
\text{Features}
\rightarrow
\text{Model}
\rightarrow
\text{Release}
\rightarrow
\text{Runtime}
\rightarrow
\text{Decision}
\rightarrow
\text{Outcome}
}
$$

At each stage ask: **Was the input correct?** **Was the transformation correct?**

**Was the right version used?** **Did assumptions still hold?** **Was the output passed correctly to the next stage?**

**Did somebody own the resulting signal?** This is commonly more productive than immediately assuming:

“The model is bad.”

### A practical failure taxonomy

Most MLOps failures reduce to a few fundamental categories.

$$
\boxed{
\text{Wrong Information}
}
$$

Examples: corrupted data, leakage, stale features, incorrect labels.

$$
\boxed{
\text{Wrong Transformation}
}
$$

Examples: feature bugs, training-serving skew, broken code.

$$
\boxed{
\text{Wrong Artifact}
}
$$

Examples: wrong model version, dependency drift, configuration drift.

$$
\boxed{
\text{Wrong Assumption}
}
$$

Examples: data drift, concept drift, outdated evaluation set.

$$
\boxed{
\text{Wrong Decision Rule}
}
$$

Examples: bad threshold, wrong metric, misaligned business objective.

$$
\boxed{
\text{Missing Feedback}
}
$$

Examples: no labels, missing monitoring, no outcome measurement.

$$
\boxed{
\text{Missing Ownership}
}
$$

Examples: nobody responds to alerts, unclear release authority, incident chaos. Almost every specific failure mode is a variation of one of these.

### What to remember

The beginner's mental model of ML failure is:

$$
\text{Bad Model}
\Rightarrow
\text{Bad Predictions}
$$

The MLOps mental model is much larger:

$$
\text{Bad Data}
$$

or

$$
\text{Bad Feature Logic}
$$

or

$$
\text{Bad Evaluation}
$$

or

$$
\text{Wrong Artifact}
$$

or

$$
\text{Bad Deployment}
$$

or

$$
\text{Changing World}
$$

or

$$
\text{Missing Monitoring}
$$

or

$$
\text{Bad Business Rule}
$$

or

$$
\text{Unclear Ownership}
$$

can all produce:

$$
\boxed{\text{Bad Production Outcome}}
$$

even when the model's mathematics is perfectly reasonable. So the real purpose of MLOps is not merely:

**Deploy models automatically.**

It is:

$$
\boxed{
\text{Make the assumptions and transitions of an ML system visible, testable, reproducible, observable, and recoverable.}
}
$$

That principle leads to a concrete set of operating rules:

$$
\boxed{
\begin{aligned}
&\text{Every assumption should have a check where practical.}\\
&\text{Every workflow boundary should have a contract.}\\
&\text{Every artifact should have an identity and lineage.}\\
&\text{Every release should have a recovery path.}\\
&\text{Every important production signal should have an owner.}\\
&\text{Every incident should teach the system something.}
\end{aligned}
}
$$

Those properties cannot eliminate every failure. They make failures easier to detect early, explain quickly, contain safely, and keep from recurring.

![Incident loop from detection through evidence validation, containment, handoff repair, and proven recovery](/content-assets/articles/article-mlops-mlops-foundations-common-mlops-failure-modes/proven-recovery-summary.png)

*Repair changes the system. Recovery proof demonstrates that the original failure is gone and the user-facing behavior is healthy through the agreed observation window.*

## Check Your Answers

Use these answers to revisit the evidence, boundaries, and operating decisions behind each question.

:::expand[What Counts as Failure in an ML System?]{kind="recap"}
Failure means the complete system no longer produces acceptable outcomes under its intended conditions. A crash is one form, but valid responses can also carry stale inputs, poor predictions, harmful policy decisions, defective feedback, or outcomes that no longer serve the product.
:::

:::expand[How Do Unreproducible Experiments and Hidden State Break Development?]{kind="recap"}
Hidden cell order, local files, undeclared packages, mutable data, missing configuration, and lost randomness make the visible source differ from the run that created the model. Explicit entry points, locked environments, recoverable snapshots, stable splits, and tracked run identities restore the development contract.
:::

:::expand[How Do Leakage, Skew, Schema, Freshness, and Label Problems Corrupt Data?]{kind="recap"}
Leakage supplies future information, skew gives training and serving different transformations, semantic schema changes preserve types while altering meaning, stale features violate the decision-time contract, and defective labels change the target itself. Data and feature contracts need meaning, time, lineage, ownership, and tests as well as shape.
:::

:::expand[How Can Splits, Metrics, and Promotion Rules Select the Wrong Model?]{kind="recap"}
Entity or future leakage can make a test set too easy.

A convenient metric can ignore imbalance, capacity, cost, important segments, or business value. An outdated evaluation population and a one-number promotion rule can then approve a newer candidate without proving that it is safer or more useful than the active release.
:::

:::expand[How Do Artifact, Configuration, Dependency, Deployment, and Rollback Failures Break Release?]{kind="recap"}
Production behaviour relies on the exact artifact, runtime image, feature contract, policy, configuration, dependencies, infrastructure, and route. If those pieces lack one immutable release record and a retained compatible fallback, deployment can report success while users receive the wrong or unrecoverable system.
:::

:::expand[How Do Drift, Delayed Labels, Feedback, and Actionless Monitoring Hide Production Failure?]{kind="recap"}
Data drift changes inputs, while concept drift changes their relationship to outcomes.

Labels may arrive late, selectively, or after model-driven interventions. Monitoring must verify its own freshness and coverage, distinguish proxies from ground truth, and route actionable signals to owners with pre-agreed investigation or containment steps.
:::

:::expand[How Do Ownership, Permissions, Pipelines, and Platform Design Amplify Failure?]{kind="recap"}
Ambiguous authority delays containment, shared identities erase accountability, excessive permissions enlarge blast radius, and brittle or duplicated pipelines spread defects. Platform underinvestment duplicates unsafe paths, while overbuilding and opaque abstractions create more components than teams can understand and operate.
:::

:::expand[How Do Broken Contracts and Layered Defences Guide Recovery?]{kind="recap"}
Classify the failure as wrong information, transformation, artifact, assumption, decision rule, feedback, or ownership, then trace the affected lifecycle contract. Prevent, detect, limit, recover, and learn through several independent controls, and use drills to prove that evidence, authority, fallback, rollback, and user-facing recovery work together.
:::

## References

- [Google Cloud: MLOps continuous delivery and automation pipelines in machine learning](https://docs.cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning) - Covers data and model validation, pipeline automation, metadata, continuous delivery, online validation, and production monitoring.
- [Google for Developers: Rules of Machine Learning](https://developers.google.com/machine-learning/guides/rules-of-ml/) - Gives production guidance on testing infrastructure, training-serving consistency, feature behaviour, and monitoring.
