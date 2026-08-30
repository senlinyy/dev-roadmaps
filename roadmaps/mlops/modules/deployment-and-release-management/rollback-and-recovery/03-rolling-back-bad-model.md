---
title: "Model Rollbacks"
description: "Design and execute model rollback by restoring the smallest safe production state, verifying recovery, and reconciling declared configuration."
overview: "A model rollback restores a known-good decision path, including the compatible model, features, runtime, policy, traffic, and state. It also verifies recovery and repairs decisions that already reached downstream systems."
tags: ["MLOps", "production", "incidents"]
order: 3
id: "article-mlops-deployment-and-release-management-rolling-back-bad-model"
aliases:
  - roadmaps/mlops/modules/deployment-and-release-management/rollback-and-recovery/01-rolling-back-bad-model.md
  - child-rollback-and-recovery-01-rolling-back-bad-model
---

## Table of Contents

1. [What Complete Known-Good Behaviour Must a Model Rollback Restore?](#what-complete-known-good-behaviour-must-a-model-rollback-restore)
2. [How Do Preplanned Triggers Distinguish Containment, Rollback, Recovery, and Roll-Forward?](#how-do-preplanned-triggers-distinguish-containment-rollback-recovery-and-roll-forward)
3. [How Do Traffic, Registry, Workload, Compatibility, Data, Caches, In-Flight Work, State, and Batch Jobs Complicate Rollback?](#how-do-traffic-registry-workload-compatibility-data-caches-in-flight-work-state-and-batch-jobs-complicate-rollback)
4. [How Do You Verify the Rollback and Repair Decisions Made by the Bad Release?](#how-do-you-verify-the-rollback-and-repair-decisions-made-by-the-bad-release)
5. [How Do Progressive Delivery, Blue-Green Capacity, Shadowing, and Statistics Make Rollback Cheaper?](#how-do-progressive-delivery-blue-green-capacity-shadowing-and-statistics-make-rollback-cheaper)
6. [How Do Feature Dependencies, Release Atomicity, Practice, Recovery Time, and Data Loss Define Readiness?](#how-do-feature-dependencies-release-atomicity-practice-recovery-time-and-data-loss-define-readiness)
7. [How Does a Rollback State Transition Work in a Concrete Example?](#how-does-a-rollback-state-transition-work-in-a-concrete-example)
8. [What Final Principle Defines a Successful Model Rollback?](#what-final-principle-defines-a-successful-model-rollback)
9. [Check Your Answers](#check-your-answers)

A team sees harmful predictions from model `v12` and points production back to `v11`. The old weights now receive new feature definitions and a new threshold, so the system continues making different decisions from the known-good release. The model changed back; behaviour did not.

A **model rollback** restores a complete known-good decision path. It must account for traffic, model and feature artifacts, runtime, configuration, policy, schemas, caches, in-flight work, batch outputs, and historical consequences. Containment, rollback, recovery, and remediation are separate operations.

Use these questions to prepare, execute, verify, and learn from that complete state transition:

1. **What Complete Known-Good Behaviour Must a Model Rollback Restore?**
2. **How Do Preplanned Triggers Distinguish Containment, Rollback, Recovery, and Roll-Forward?**
3. **How Do Traffic, Registry, Workload, Compatibility, Data, Caches, In-Flight Work, State, and Batch Jobs Complicate Rollback?**
4. **How Do You Verify the Rollback and Repair Decisions Made by the Bad Release?**
5. **How Do Progressive Delivery, Blue-Green Capacity, Shadowing, and Statistics Make Rollback Cheaper?**
6. **How Do Feature Dependencies, Release Atomicity, Practice, Recovery Time, and Data Loss Define Readiness?**
7. **How Does a Rollback State Transition Work in a Concrete Example?**
8. **What Final Principle Defines a Successful Model Rollback?**

## What Complete Known-Good Behaviour Must a Model Rollback Restore?
<!-- section-summary: Rollback restores a complete previously known-good decision path, including model, features, preprocessing, runtime, configuration, policy, schemas, and dependent behaviour. -->

Replacing weights is insufficient when other release components determine the production decision, so rollback begins with complete behaviour.

A **model rollback** means replacing a newly released ML model system with an earlier known-good release because the new release is causing unacceptable behavior. That sounds simple:

“Model v12 is bad. Put v11 back.”

In a real production system, however, the model file is only one part of what determines predictions. A release may also change preprocessing, feature definitions, runtime libraries, routing rules, configuration, thresholds, policies, caches, schemas, and downstream behavior. So the first principle is:

> **Rollback is not primarily about restoring an old model file. It is about restoring a previously known-good system behavior.**

That distinction explains nearly everything else. Suppose a fraud system produces:

$$
\text{decision} = f(x)
$$

where $$f$$ is the model. It is tempting to imagine production as:

$$
x \rightarrow \text{model} \rightarrow y
$$

But an actual deployed system is closer to:

$$
\text{raw data}
\rightarrow
\text{feature transformation}
\rightarrow
\text{model}
\rightarrow
\text{calibration}
\rightarrow
\text{threshold/policy}
\rightarrow
\text{business action}
$$

The resulting behavior depends on all of these. We can represent a release as:

$$
R =
(M, F, C, P, S, I, T)
$$

where:

* $$M$$ = model artifact and weights
* $$F$$ = feature/preprocessing logic
* $$C$$ = configuration and thresholds
* $$P$$ = business policies
* $$S$$ = schemas and interfaces
* $$I$$ = serving infrastructure/runtime
* $$T$$ = traffic-routing configuration

A rollback therefore asks:

$$
R_{\text{current}}
\rightarrow
R_{\text{known-good}}
$$

not merely:

$$
M_{12} \rightarrow M_{11}
$$

This is why rollback design belongs to **release engineering**, not just model management. The goal is not necessarily to make every machine identical to its previous state. The goal is to restore the important **system invariants**. For example, before the bad deployment:

$$
P(\text{incorrect fraud rejection}) < 0.1\%
$$

or:

$$
p99\ latency < 150\text{ ms}
$$

or:

$$
\text{prediction schema} = \text{schema expected by downstream service}
$$

A successful rollback restores those operational and product properties. This distinction is important. Suppose model v12 was deployed at 14:00 and caused severe latency. At 14:10 you restore v11. You might now have:

* different pods,
* different process IDs,
* different cache contents,
* different request IDs,
* different machines.

That is fine. A rollback does not have to reproduce the exact historical physical state. It must reproduce the **relevant known-good behavior**. So conceptually:

$$
\text{Successful rollback}
=
\text{restored required invariants}
$$

not:

$$
\text{Successful rollback}
=
\text{perfect historical rewind}
$$

A rollback can change **future behavior**. It usually cannot undo **past consequences**. Suppose the bad model was live for 30 minutes and generated:

* 20,000 loan decisions,
* 5,000 fraud blocks,
* 300 recommendations,
* 2 million batch predictions.

Rolling the model back changes what happens to subsequent requests. It does not automatically reverse those previous decisions. This gives us two distinct problems:

$$
\text{system restoration}
$$

and

$$
\text{consequence repair}
$$

These must not be confused.

For example:

Bad recommendation model:

$$
R_{\text{bad}} \rightarrow \text{bad recommendations}
$$

Rollback fixes:

$$
R_{\text{good}} \rightarrow \text{future good recommendations}
$$

But recommendations already sent by email cannot be “un-sent.” Similarly, if a bad pricing model issued incorrect prices, restoring the model does not repair orders already executed at those prices. Therefore a complete incident response may require:

$$
\text{Containment}
\rightarrow
\text{Rollback}
\rightarrow
\text{Recovery}
\rightarrow
\text{Remediation}
$$

Rollback is only one stage. One of the most dangerous rollback mistakes is saying:

“Roll back to model v17.”

What exactly is model v17 compatible with? Imagine:

### Release 17

Model:

$$
M_{17}
$$

expects:

$$
F_{17} = [age, income, country]
$$

Then Release 18 changes feature construction:

$$
F_{18} = [age, log(income), country, deviceRisk]
$$

and deploys model $$M_{18}$$. If you simply replace $$M_{18}$$ with $$M_{17}$$ while keeping the v18 feature pipeline, you may get:

* wrong feature ordering,
* incompatible tensor dimensions,
* incorrect transformations,
* silent prediction corruption.

So you want releases to be identified as **coherent bundles**.

For example:

```text
release-2026-08-25-1431

model:
  artifact: fraud-model-17
  sha256: ...

features:
  package: fraud-features-17

runtime:
  image: fraud-serving@sha256:...

config:
  threshold: 0.73

schema:
  input: fraud-request-v4
  output: fraud-response-v3

policy:
  policy-version: 12
```

The actual rollback target is this whole known-good release. A useful principle is:

> **Never ask “Which model version was good?” when the real question is “Which complete release was good?”**

Consider two deployment styles. Mutable:

```text
fraud-model:production
```

Today that tag refers to v11. Tomorrow someone updates it to v12. After an incident, what did `production` contain before Maybe you can reconstruct it. Maybe not. An immutable reference instead looks like:

```text
fraud-serving@sha256:ab73...
```

or:

```text
model_id = 7c8f...
```

The principle is simple:

$$
\text{release identifier}
\rightarrow
\text{exact immutable artifacts}
$$

If identifiers can silently change meaning, reliable rollback becomes difficult. You therefore want to retain:

* model artifacts,
* container images,
* configuration,
* feature code,
* dependency versions,
* deployment manifests,
* schemas,
* policies,
* metadata connecting all of them.

Rollback requires **historical reproducibility**.

## How Do Preplanned Triggers Distinguish Containment, Rollback, Recovery, and Roll-Forward?
<!-- section-summary: Immutable releases, prepared procedures, and explicit triggers allow responders to choose containment, rollback, recovery, or forward repair according to evidence. -->

That unit must exist immutably and the team must decide in advance which evidence triggers rollback versus another containment or forward fix.

Rollback should not be invented during the incident. That is equivalent to designing an aircraft emergency procedure after an engine fails. Before release $$R_n$$, you should already know:

$$
R_n \rightarrow R_{n-1}
$$

is technically possible. This means verifying things such as:

$$
\text{Artifact}(R_{n-1}) \text{ still exists}
$$

$$
\text{Runtime}(R_{n-1}) \text{ can still start}
$$

$$
\text{Schema}_{n} \leftrightarrow \text{Schema}_{n-1}
$$

where compatibility is required. You also want the rollback operation to be boring and repeatable.

For example:

```text
deploy release-173
```

is much safer during an incident than:

```text
find the old model
edit the Kubernetes YAML
remember the previous threshold
change feature flags
restart some pods
hope everything agrees
```

Emergency operations should reduce the amount of human reasoning required under pressure. Suppose after deployment:

$$
\text{error rate} = 4.2\%
$$

Is that bad enough to rollback? Maybe. But during an incident people may disagree. One team watches latency. Another watches revenue. Another watches model accuracy. Another worries about customer harm. So releases should have predefined safety conditions.

For example:

$$
\text{Rollback if p99 latency} > 300\text{ ms for 5 min}
$$

or:

$$
\text{Rollback if payment approval rate}
<
\text{baseline} - 8\%
$$

or:

$$
\text{Rollback immediately if malformed outputs occur}
$$

The logic is:

$$
\text{observable signal}
\rightarrow
\text{threshold}
\rightarrow
\text{authorized action}
$$

This avoids debating basic operating policy during the incident. Authorization also matters. If rollback requires approval from someone who cannot be reached, the technically perfect rollback mechanism is still operationally useless. These are often incorrectly treated as synonyms. A good mental sequence is:

1. **Containment:** stop damage from growing—for example, halt rollout, disable a feature, route traffic away, or fall back to rules.
2. **Rollback:** restore the previous known-good release or configuration.
3. **Verification:** prove that infrastructure and product behavior have actually recovered.
4. **Recovery:** restore normal capacity, traffic, queues, and dependent workflows.
5. **Repair:** fix decisions, data, or side effects produced while the faulty release was active.
6. **Reconciliation:** make Git, GitOps, registries, manifests, dashboards, and release records agree with reality.
7. **Follow-up:** understand the failure and improve the release system.

This separation matters because rollback itself may take time. Suppose the model is catastrophically rejecting all payments. You may first switch to:

$$
\text{model decision}
\rightarrow
\text{safe fallback policy}
$$

That is containment. Then deploy the previous release. That is rollback. Then drain queues and restore ordinary traffic. That is recovery. Suppose release $$R_{52}$$ contains a bug. You have two broad choices:

$$
R_{52} \rightarrow R_{51}
$$

or:

$$
R_{52} \rightarrow R_{53}
$$

where $$R_{53}$$ contains a fix. The first is **rollback**. The second is **roll-forward**. Rollback is attractive when $$R_{51}$$:

* is known-good,
* remains compatible,
* can be restored quickly,
* does not reintroduce a worse vulnerability or defect.

Roll-forward may be better when rollback itself is unsafe. Imagine the new release introduced a database schema migration that cannot safely be reversed.

Then:

$$
R_{52} \rightarrow R_{51}
$$

may break the older service. Or imagine $$R_{51}$$ contains a severe security vulnerability. Going backward would restore operational correctness but reintroduce security risk. The actual question is therefore:

$$
\text{Which available transition gives us the safest recovery?}
$$

not:

$$
\text{Can we technically deploy an older version?}
$$

![A safe rollback from search-ranking-r43 to the complete known-good search-ranking-r42 release bundle, with separate prospective recovery and retrospective repair tracks.](/content-assets/articles/article-mlops-deployment-and-release-management-rolling-back-bad-model/complete-release-rollback-target.png)

*Restoring the complete release preserves the compatible model, image, features, policy, API, deployment, and route while prior decisions remain a separate remediation workload.*

## How Do Traffic, Registry, Workload, Compatibility, Data, Caches, In-Flight Work, State, and Batch Jobs Complicate Rollback?
<!-- section-summary: Online traffic, registry labels, workloads, compatibility, migrations, caches, in-flight requests, stateful models, batch outputs, and historical reprocessing move on different timelines. -->

Execution is difficult because traffic, control-plane records, runtime state, data, caches, and long-running work do not switch simultaneously.

Imagine model servers:

```text
v10 instances
v11 instances
```

Requests are routed according to:

$$
P(v10) + P(v11) = 1
$$

During a canary deployment:

$$
P(v11) = 0.05
$$

$$
P(v10) = 0.95
$$

If v11 behaves badly, the fastest containment action may simply be:

$$
P(v11) \rightarrow 0
$$

rather than immediately deleting v11. This is why traffic management is often more important to rollback speed than deployment speed. You can conceptually separate:

$$
\text{what exists}
$$

from

$$
\text{what receives traffic}
$$

A new model can remain deployed while receiving zero traffic. This can make recovery safer and debugging easier. This distinction causes many production mistakes. Suppose someone changes:

```text
production-model -> v10
```

in the model registry. Does that mean all production requests are now using v10? Not necessarily. A running server might have loaded v11 into memory hours ago. So:

$$
\text{Registry state} \neq \text{Runtime state}
$$

Similarly, restarting workloads with v10 does not guarantee they receive traffic. Thus:

$$
\text{Runtime state} \neq \text{Traffic state}
$$

You should think about three independent controls:

$$
\boxed{
\text{Registry}
\quad
\text{Workload}
\quad
\text{Traffic}
}
$$

The registry answers:

Which artifact is designated as a particular release or alias

The workload manager answers:

Which version is actually running

The traffic system answers:

Which running version receives requests

These may be controlled by completely different systems.

For example:

```text
MLflow / model registry
        ↓
Kubernetes Deployment
        ↓
service mesh / gateway
        ↓
customer traffic
```

Changing one layer does not magically update the others. Suppose:

$$
\text{Client v3}
\rightarrow
\text{Model service v3}
$$

Then release v4 changes the response from:

```json
{
  "score": 0.78
}
```

to:

```json
{
  "probability": 0.78,
  "reason_codes": [...]
}
```

Downstream clients migrate to the new schema. Now you restore service v3. It returns:

```json
{
  "score": 0.78
}
```

The model may work perfectly. The system may still fail. This is why safe releases prefer backward-compatible changes. For example, instead of immediately removing:

```json
"score"
```

you temporarily provide both:

```json
{
  "score": 0.78,
  "probability": 0.78,
  "reason_codes": [...]
}
```

This creates an interval during which both old and new consumers work. The general principle is:

$$
\text{Rollbackability requires compatibility across time}
$$

This applies to:

* API schemas,
* feature schemas,
* event formats,
* databases,
* policy rules,
* model inputs,
* model outputs.

Suppose model v7 expects:

```text
customer_age
annual_income
credit_score
```

Release v8 replaces:

```text
annual_income
```

with:

```text
monthly_income
```

and deletes the old feature. If you later restore model v7:

$$
M_7(F_8)
$$

may be impossible. Therefore feature evolution should often use an **expand-and-contract** strategy. First expand:

```text
annual_income
monthly_income
```

Both exist. Deploy consumers that understand the new representation. Only after rollback risk has disappeared do you remove the old field. The same concept applies to databases. Instead of:

$$
\text{old schema}
\rightarrow
\text{new incompatible schema}
$$

prefer:

$$
S_1
\rightarrow
S_{1+2}
\rightarrow
S_2
$$

where the middle state supports both versions. Rollback safety is largely a product of **temporal compatibility**. Suppose model v12 produces:

```text
user123 -> recommendation set A
```

and that result is cached for six hours. At 15:00 you roll back to model v11. But requests for `user123` continue receiving the cached v12 answer. So the actual system behaves like:

$$
\text{new requests}
\rightarrow
\begin{cases}
\text{cached v12 result} \\
\text{fresh v11 result}
\end{cases}
$$

The model may have been rolled back while the **observable application behavior has not**. A useful technique is versioned cache keys:

```text
recommendations:v11:user123
recommendations:v12:user123
```

rather than:

```text
recommendations:user123
```

Now switching releases naturally selects the appropriate cache namespace. This illustrates a broader principle:

Anything derived from the release may need to be release-aware.

Suppose an asynchronous system works like:

```text
request
   ↓
queue
   ↓
worker
   ↓
model
   ↓
result
```

At rollback time, 100,000 jobs may already be queued. Were those jobs created under assumptions belonging to v12? Will v11 understand them? What happens to workers already processing them? A rollback may therefore need:

$$
\text{stop intake}
\rightarrow
\text{classify queued work}
\rightarrow
\text{drain/cancel/replay}
\rightarrow
\text{restore service}
$$

Similarly, Kubernetes may terminate old pods gradually. During deployment:

```text
v11 pod
v11 pod
v12 pod
v12 pod
```

During rollback:

```text
v12 pod terminating
v11 pod starting
v11 pod healthy
```

For some interval both versions can coexist. Your system therefore needs to tolerate **mixed-version operation**. Many models appear stateless:

$$
x \rightarrow f(x) \rightarrow y
$$

But the surrounding application may have state.

For example:

* conversation history,
* recommendation history,
* fraud counters,
* embeddings,
* user profiles,
* online-learned parameters,
* vector indexes,
* session state.

Suppose v12 stores:

```text
embedding_dimension = 1536
```

while v11 expects:

```text
embedding_dimension = 768
```

Rolling back the application without rolling back or converting the stored state may fail. The true release state therefore sometimes becomes:

$$
R =
(\text{code},\text{model},\text{config},\text{persistent state})
$$

Persistent-state changes deserve especially careful design because code can be redeployed easily while data mutations are often irreversible. Consider a daily churn pipeline:

```text
customers
   ↓
features
   ↓
model
   ↓
churn_predictions.csv
   ↓
marketing campaign
```

Suppose Monday's model generated bad predictions. There may be no running service to “roll back.” Instead you need to recreate the previous output:

$$
D_t^{\text{bad}}
\rightarrow
D_t^{\text{corrected}}
$$

using an earlier model. For batch systems, **predictions themselves are data artifacts**. So instead of writing:

```text
/churn/latest/predictions.parquet
```

and overwriting it repeatedly, you might have:

```text
/churn/2026-08-30/model-v23/predictions.parquet
/churn/2026-08-30/model-v24/predictions.parquet
```

Then downstream consumers can reference a specific prediction dataset. This creates lineage:

$$
\text{input data version}
+
\text{feature version}
+
\text{model version}
+
\text{code version}
\rightarrow
\text{prediction dataset version}
$$

Without this lineage, reproducing a batch prediction can become nearly impossible. Suppose you rerun yesterday's predictions using model v11. Will you get the exact results v11 would have produced yesterday Only if you also reproduce yesterday's inputs. That requires:

$$
X_{\text{yesterday}}
$$

rather than today's mutated database state. For reproducibility:

$$
Y_t =
f(
X_t,
F_v,
M_v,
C_v
)
$$

If any input has changed, the output may change. So batch rollback often requires versioning not only models but:

* source snapshots,
* feature datasets,
* configuration,
* reference tables,
* model artifacts,
* software environment.

This is one reason ML lineage is operationally important rather than merely administrative.

## How Do You Verify the Rollback and Repair Decisions Made by the Bad Release?
<!-- section-summary: Verification covers infrastructure, request path, behaviour, metrics, identity, and baseline, while remediation addresses decisions already made and records emergency drift. -->

After routing changes, responders must prove the restored path at several layers and repair decisions the bad version already caused.

Suppose the deployment system reports:

```text
Deployment successful
```

That tells you almost nothing about whether the incident is over. Verification should move outward through the system. At the lowest level:

$$
\text{Are healthy instances running?}
$$

Then:

$$
\text{Are they running the intended model version?}
$$

Then:

$$
\text{Are requests reaching those instances?}
$$

Then:

$$
\text{Are predictions technically valid?}
$$

Then:

$$
\text{Are business outcomes recovering?}
$$

For example:

```text
Pods healthy                     ✓
Model v41 loaded                 ✓
100% traffic on v41              ✓
Error rate normal                ✓
Latency normal                   ✓
Prediction distribution normal   ✓
Checkout conversion normal       ✓
```

This progression matters because an infrastructure recovery can hide a product failure. For an ML system, observability often needs to span:

$$
\text{Infrastructure}
\rightarrow
\text{Serving}
\rightarrow
\text{Model}
\rightarrow
\text{Business}
$$

Suppose model v12 passes offline evaluation:

$$
AUC_{v12} = 0.94
$$

while:

$$
AUC_{v11} = 0.92
$$

So v12 seems better. But after production deployment:

$$
p99\ latency = 2.5\text{ seconds}
$$

and conversion drops 15%. Which model is better? Operationally, v11 may be preferable. A deployed ML model is part of a product system, so release success is multidimensional:

$$
Q =
f(
\text{predictive quality},
\text{latency},
\text{reliability},
\text{cost},
\text{safety},
\text{business outcome}
)
$$

Rollback criteria should reflect the real objective function, not merely offline ML metrics. Suppose model v13 ran from 13:12 to 13:41. You should be able to answer:

$$
\text{Which decisions were produced by } v13
$$

If prediction logs record:

```text
request_id
model_version
feature_version
timestamp
prediction
decision
```

then you can identify:

$$
D_{\text{affected}}
=
\{
d : d.model = v13
\land
13{:}12 \le d.time \le 13{:}41
\}
$$

Those decisions can then be reviewed or repaired. Examples include:

* re-running fraud transactions,
* recalculating prices,
* retracting incorrect recommendations,
* recomputing risk assessments,
* refunding affected users,
* re-running documents through an earlier model.

Without model-version attribution, you may know that something went wrong but not know who or what was affected. So observability is also a **forensic requirement**. Suppose the normal deployment mechanism is GitOps:

```text
Git
 ↓
controller
 ↓
production
```

Git says:

```text
model: v12
```

During an emergency an operator manually changes production to:

```text
model: v11
```

Now:

$$
\text{Git state} \neq \text{production state}
$$

What might the GitOps controller do? It may helpfully change production straight back to v12. That is why emergency rollback procedures need to understand the deployment authority. You may need to:

* pause reconciliation,
* change Git itself,
* execute the rollback through the standard release mechanism,
* or immediately record the emergency state in Git.

The important invariant is:

$$
\text{declared desired state}
=
\text{intended production state}
$$

once the emergency action has stabilized. After a rollback, the release system should not pretend the failed release never happened. Imagine history:

```text
v20 deployed
v21 deployed
v21 rolled back
v20 restored
```

That is more informative than simply:

```text
production = v20
```

The first tells you:

* v21 reached production,
* it was considered unsafe,
* when it happened,
* what replaced it.

The distinction matters for:

* audits,
* investigations,
* compliance,
* debugging,
* future deployment decisions.

You want deployment history to be append-only where practical:

$$
R_{20}
\rightarrow
R_{21}
\rightarrow
\text{rollback}(R_{21})
\rightarrow
R_{20}
$$

rather than erasing $$R_{21}$$ from history.

## How Do Progressive Delivery, Blue-Green Capacity, Shadowing, and Statistics Make Rollback Cheaper?
<!-- section-summary: Progressive exposure limits affected traffic, blue-green retains ready capacity, shadowing supplies comparison evidence, and statistical uncertainty influences trigger confidence. -->

Progressive delivery and blue-green capacity reduce exposure and restoration time, while shadow evidence and uncertainty improve trigger decisions.

Compare two releases. Immediate:

$$
0\% \rightarrow 100\%
$$

Progressive:

$$
0\%
\rightarrow
1\%
\rightarrow
5\%
\rightarrow
25\%
\rightarrow
50\%
\rightarrow
100\%
$$

Suppose failure probability is detected at 5%. Then the maximum affected population is approximately:

$$
0.05N
$$

rather than:

$$
N
$$

for $$N$$ requests or users during that interval. This is the principle behind:

* canary deployments,
* shadow deployments,
* staged rollouts,
* blue/green deployments,
* feature flags.

They do not eliminate failures. They reduce:

$$
\text{blast radius}
$$

and often make rollback faster. Imagine two complete environments:

```text
BLUE  = release v17
GREEN = release v18
```

Traffic currently goes to BLUE. You deploy v18 to GREEN and test it.

Then:

$$
Traffic:
BLUE \rightarrow GREEN
$$

If something goes wrong:

$$
Traffic:
GREEN \rightarrow BLUE
$$

The major advantage is that the old release is still intact. Rollback becomes primarily a routing operation. This illustrates a fundamental trade-off:

$$
\text{more redundancy}
\rightarrow
\text{faster rollback}
$$

but usually:

$$
\text{more redundancy}
\rightarrow
\text{higher infrastructure cost}
$$

Deployment architecture is partly about deciding how much you are willing to pay for recovery speed. With shadow deployment:

$$
\text{production request}
\rightarrow
\begin{cases}
M_{\text{current}} \rightarrow \text{real decision}\\
M_{\text{candidate}} \rightarrow \text{discarded decision}
\end{cases}
$$

The candidate sees real traffic but does not affect users. This can expose problems such as:

* unexpected input distributions,
* runtime crashes,
* extreme latency,
* schema assumptions,
* memory problems.

Shadowing reduces the probability that rollback becomes necessary. But it cannot catch every issue because some failures arise only when predictions actually influence downstream behavior. Traditional software often fails conspicuously:

```text
HTTP 500
process crash
timeout
```

A bad ML release can remain technically healthy.

For example:

```text
HTTP status: 200
latency: 40 ms
CPU: normal
```

while its predictions are systematically wrong. Suppose the normal score distribution is:

$$
Y \sim N(0.35, 0.08)
$$

and after deployment:

$$
Y \sim N(0.82, 0.04)
$$

Nothing crashed. Yet something may be badly wrong. ML rollback therefore requires monitoring signals like:

* prediction distribution,
* feature distribution,
* confidence,
* class balance,
* abstention rate,
* downstream outcomes,
* calibration,
* subgroup behavior.

In other words:

$$
\text{health} \neq \text{availability only}
$$

For ML:

$$
\text{health}
=
\text{technical health}
+
\text{behavioral health}
$$

![A comparison of registry aliases, traffic controls, Kubernetes undo, batch correction runs, and GitOps commits showing what each rollback control changes and what must be verified next.](/content-assets/articles/article-mlops-deployment-and-release-management-rolling-back-bad-model/rollback-control-effects.png)

*Each control changes one layer; recovery requires following declared state through the loaded runtime to the customer or business outcome.*

## How Do Feature Dependencies, Release Atomicity, Practice, Recovery Time, and Data Loss Define Readiness?
<!-- section-summary: Feature changes can defeat model-only rollback; complete release atomicity, drills, and explicit recovery-time and data-loss targets expose whether restoration is actually possible. -->

Rollback can still fail if features or schemas changed, which makes atomic releases, drills, and recovery objectives essential readiness evidence.

Imagine yesterday:

$$
\text{age feature} = 42
$$

Today a feature pipeline bug turns it into:

$$
\text{age feature} = 420
$$

You deploy model v12 at approximately the same time. Predictions go wrong. Someone concludes:

“v12 caused the issue.”

They roll back to v11. But v11 receives:

$$
age = 420
$$

and also fails. The real dependency chain is:

$$
\text{prediction}
=
M(
F(\text{raw inputs})
)
$$

A rollback strategy therefore needs to determine whether the fault lies in:

$$
M
$$

or:

$$
F
$$

or:

$$
C
$$

or somewhere downstream. This is why release correlation and lineage matter so much. Ideally:

$$
R_n
=
\{
M_n,
F_n,
C_n,
P_n
\}
$$

and all elements transition atomically. Reality may look like:

```text
12:00 feature pipeline v7
12:04 model v12
12:07 threshold 0.68
12:12 policy v9
```

If the system breaks at 12:14, what exactly is “the previous version” There may be no single previous version. The production state evolved through:

$$
S_0
\rightarrow
S_1
\rightarrow
S_2
\rightarrow
S_3
\rightarrow
S_4
$$

This suggests an important release-engineering principle:

Coordinate dependent changes into identifiable release units whenever possible.

Where atomic deployment is impossible, maintain enough history to reconstruct each intermediate state. A rollback mechanism that has never been exercised is an assumption. A useful test is not merely:

```text
Can we deploy v11
```

but something closer to:

```text
Deploy v12
Generate representative traffic
Trigger rollback procedure
Restore v11
Confirm routing
Confirm caches
Confirm schemas
Confirm downstream services
Confirm metrics
Confirm GitOps state
Confirm forensic records
```

This exposes failures that documentation cannot.

For example:

* old container image was deleted,
* credentials expired,
* rollback manifest no longer validates,
* database schema is incompatible,
* traffic controller still points to the new version,
* alerting cannot distinguish releases.

A rollback capability is therefore best understood as a **tested recovery path**. Two concepts borrowed from disaster recovery are useful.

### Recovery Time Objective

How quickly should service return to acceptable behavior?

$$
RTO = \text{maximum acceptable recovery time}
$$

For a payment fraud model, perhaps:

$$
RTO = 5\text{ minutes}
$$

For an offline reporting model:

$$
RTO = 6\text{ hours}
$$

Different RTOs justify different architectures.

### Recovery Point

For stateful or batch systems, ask how much output may need to be discarded or recomputed. If you can reproduce data only from midnight:

$$
\text{maximum lost/reprocessed interval}
=
\text{time since midnight}
$$

This encourages engineers to design checkpoints, dataset versions, and logs deliberately.

## How Does a Rollback State Transition Work in a Concrete Example?
<!-- section-summary: A rollback is a controlled state transition from bad release through containment and restored traffic to verification and historical repair. -->

The state-transition model and concrete example show containment, restoration, verification, and remediation as separate steps.

The cleanest way to reason about rollback is to stop thinking in terms of files and instead think in terms of **system state**. Let:

$$
S_t =
(
M_t,
F_t,
C_t,
P_t,
D_t,
I_t,
T_t
)
$$

represent the production system at time $$t$$. A deployment performs:

$$
S_0 \rightarrow S_1
$$

You observe that:

$$
Safety(S_1) = false
$$

The recovery system needs to construct some state:

$$
S_r
$$

such that:

$$
Safety(S_r)=true
$$

Often:

$$
S_r \approx S_0
$$

but not necessarily. You might retain a new database schema while restoring the old model. You might keep new infrastructure but route traffic to an old model. You might apply a new emergency policy while restoring old model weights. Therefore:

$$
S_r \neq S_0
$$

can still be a perfectly successful rollback. The objective is **safe behavioral restoration**, not literal reversal of time. Imagine an online credit-risk service. Release 31 contains:

```text
Model:          credit-v31
Feature code:   features-v14
Threshold:      0.67
Container:      serving-v19
API schema:     v5
Policy:         lending-policy-v8
```

The previous release was:

```text
Model:          credit-v30
Feature code:   features-v13
Threshold:      0.72
Container:      serving-v18
API schema:     v5
Policy:         lending-policy-v8
```

Five percent of traffic is sent to Release 31. Monitoring finds:

$$
\text{approval rate}_{31}=71\%
$$

while the expected rate is:

$$
\approx 42\%
$$

Infrastructure metrics look normal. Because the release system records the entire release bundle, engineers know exactly what changed. They first set:

$$
Traffic(v31)=0
$$

This contains the problem immediately. Traffic continues through v30. Then they investigate and discover a feature transformation bug:

$$
annualIncome
\rightarrow
monthlyIncome
$$

was applied twice. The operational rollback is therefore not simply:

$$
M_{31}\rightarrow M_{30}
$$

Instead the system performs:

$$
Traffic(R_{31})\rightarrow0
$$

and restores:

$$
R_{30}
=
(M_{30},F_{13},C_{30},I_{18})
$$

Then engineers verify:

$$
\text{error rate}
$$

$$
\text{prediction distribution}
$$

$$
\text{approval rate}
$$

$$
\text{latency}
$$

all return to expected ranges. Finally they identify every decision produced by v31:

$$
\{d : d.release=31\}
$$

and send those cases through a correction workflow. Only then is recovery complete.

## What Final Principle Defines a Successful Model Rollback?
<!-- section-summary: Success means known-good system behaviour is restored, attributable, verified, and followed by repair of any consequences the bad release already created. -->

The final principle measures rollback by restored and verified behaviour rather than by which model filename is active.

A production ML system is not:

$$
\boxed{\text{model}}
$$

It is:

$$
\boxed{
\text{data}
+
\text{features}
+
\text{model}
+
\text{runtime}
+
\text{configuration}
+
\text{policy}
+
\text{state}
+
\text{traffic}
+
\text{downstream effects}
}
$$

Therefore model rollback is not:

$$
\boxed{\text{load old weights}}
$$

It is:

$$
\boxed{
\text{restore a known-safe operating state}
}
$$

And good rollback engineering follows from one deeper principle:

$$
\boxed{
\text{Design every release so failure is expected, observable, bounded, and reversible.}
}
$$

If releases are immutable, compatibility is preserved, traffic can be redirected independently, every decision is attributable to a release, state is versioned where necessary, and the rollback path is regularly tested, then rollback becomes an ordinary operational procedure rather than an emergency improvisation.

![The complete online and batch model rollback path from containment and compatibility checks through execution, five recovery gates, durable-state reconciliation, and repair of earlier effects.](/content-assets/articles/article-mlops-deployment-and-release-management-rolling-back-bad-model/model-rollback-summary.png)

*Online and batch paths converge at recovery verification; only written criteria can advance the response to durable state reconciliation and repair of earlier effects.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Complete Known-Good Behaviour Must a Model Rollback Restore?]{kind="recap"}
Rollback restores a complete previously known-good decision path, including model, features, preprocessing, runtime, configuration, policy, schemas, and dependent behaviour.
:::

:::expand[How Do Preplanned Triggers Distinguish Containment, Rollback, Recovery, and Roll-Forward?]{kind="recap"}
Immutable releases, prepared procedures, and explicit triggers allow responders to choose containment, rollback, recovery, or forward repair according to evidence.
:::

:::expand[How Do Traffic, Registry, Workload, Compatibility, Data, Caches, In-Flight Work, State, and Batch Jobs Complicate Rollback?]{kind="recap"}
Online traffic, registry labels, workloads, compatibility, migrations, caches, in-flight requests, stateful models, batch outputs, and historical reprocessing move on different timelines.
:::

:::expand[How Do You Verify the Rollback and Repair Decisions Made by the Bad Release?]{kind="recap"}
Verification covers infrastructure, request path, behaviour, metrics, identity, and baseline, while remediation addresses decisions already made and records emergency drift.
:::

:::expand[How Do Progressive Delivery, Blue-Green Capacity, Shadowing, and Statistics Make Rollback Cheaper?]{kind="recap"}
Progressive exposure limits affected traffic, blue-green retains ready capacity, shadowing supplies comparison evidence, and statistical uncertainty influences trigger confidence.
:::

:::expand[How Do Feature Dependencies, Release Atomicity, Practice, Recovery Time, and Data Loss Define Readiness?]{kind="recap"}
Feature changes can defeat model-only rollback; complete release atomicity, drills, and explicit recovery-time and data-loss targets expose whether restoration is actually possible.
:::

:::expand[How Does a Rollback State Transition Work in a Concrete Example?]{kind="recap"}
A rollback is a controlled state transition from bad release through containment and restored traffic to verification and historical repair.
:::

:::expand[What Final Principle Defines a Successful Model Rollback?]{kind="recap"}
Success means known-good system behaviour is restored, attributable, verified, and followed by repair of any consequences the bad release already created.
:::
