---
title: "Model Service CD"
description: "Learn how continuous delivery moves an immutable model release through evidence gates, staging, approval, controlled production traffic, verification, and rollback."
overview: "Continuous delivery keeps a tested model service ready for production while preserving the exact model, image, contracts, policy, and evidence that earned approval. The delivery path automates repeatable work and keeps high-consequence production authority behind an explicit gate."
tags: ["MLOps", "production", "ci-cd"]
order: 5
id: "article-mlops-mlops-infrastructure-cd-for-model-services"
aliases:
  - roadmaps/mlops/modules/deployment-and-release-management/model-release-basics/04-cd-for-model-services.md
  - roadmaps/mlops/modules/ml-testing-and-delivery/ci-cd-for-ml/03-cd-for-model-services.md
  - roadmaps/mlops/modules/mlops-infrastructure/ci-cd-for-ml/03-cd-for-model-services.md
  - child-ci-cd-for-ml-03-cd-for-model-services
---

## Table of Contents

1. [What Complete Release Does Model-Service CD Control?](#what-complete-release-does-model-service-cd-control)
2. [Which Software, Contract, Security, Model, Behaviour, Edge-Case, and Latency Gates Run before Staging?](#which-software-contract-security-model-behaviour-edge-case-and-latency-gates-run-before-staging)
3. [How Do Staging, Recovery, Observability, and Approval Produce Delivery Evidence?](#how-do-staging-recovery-observability-and-approval-produce-delivery-evidence)
4. [Why Must Deployment and Traffic Exposure Use Layered Production Evidence?](#why-must-deployment-and-traffic-exposure-use-layered-production-evidence)
5. [How Do Identity, Prediction Attribution, Release Records, Retention, and Rollback Preserve Control?](#how-do-identity-prediction-attribution-release-records-retention-and-rollback-preserve-control)
6. [How Do Explicit States, Tool Boundaries, Training Separation, and Environment Promotion Shape the Workflow?](#how-do-explicit-states-tool-boundaries-training-separation-and-environment-promotion-shape-the-workflow)
7. [How Does a Full Release and Failed Canary Demonstrate CD's Recovery Path?](#how-does-a-full-release-and-failed-canary-demonstrate-cds-recovery-path)
8. [What Final Principle Makes Model-Service CD More than Pipeline Plumbing?](#what-final-principle-makes-model-service-cd-more-than-pipeline-plumbing)
9. [Check Your Answers](#check-your-answers)

A new model passes training and evaluation, but production also needs an API-compatible service image, feature contract, configuration, security checks, observability, capacity, and a complete rollback candidate. Deploying only the model leaves the release undefined.

**Model-service continuous delivery** builds one complete release and moves it through evidence-producing stages. Continuous delivery may stop at approval; continuous deployment can continue automatically. In either case, deployment and traffic exposure remain separate controls, and the exact tested release is promoted rather than rebuilt.

Use these questions to follow the release through gates, staging, approval, progressive exposure, verification, and rollback:

1. **What Complete Release Does Model-Service CD Control?**
2. **Which Software, Contract, Security, Model, Behaviour, Edge-Case, and Latency Gates Run before Staging?**
3. **How Do Staging, Recovery, Observability, and Approval Produce Delivery Evidence?**
4. **Why Must Deployment and Traffic Exposure Use Layered Production Evidence?**
5. **How Do Identity, Prediction Attribution, Release Records, Retention, and Rollback Preserve Control?**
6. **How Do Explicit States, Tool Boundaries, Training Separation, and Environment Promotion Shape the Workflow?**
7. **How Does a Full Release and Failed Canary Demonstrate CD's Recovery Path?**
8. **What Final Principle Makes Model-Service CD More than Pipeline Plumbing?**

## What Complete Release Does Model-Service CD Control?
<!-- section-summary: CD controls a complete release of model, service, runtime, features, configuration, policy, and infrastructure, built once and triggered by code, model, or dependency changes. -->

A delivery pipeline must control the same complete decision system that production will run, not a model file in isolation.

A model service is not just a model file. It is a production capability such as:

$$
\text{request}
\rightarrow
\text{features}
\rightarrow
\text{model}
\rightarrow
\text{policy}
\rightarrow
\text{decision}
$$

When any important part changes, we need a reliable way to answer:

**Can this exact new version safely replace the version currently serving production?**

That is the problem **Continuous Delivery (CD)** solves. The central idea is:

$$
\boxed{
\text{Change}
\rightarrow
\text{Build one release}
\rightarrow
\text{collect evidence}
\rightarrow
\text{approve}
\rightarrow
\text{controlled production release}
}
$$

The word **continuous** does not mean "deploy every second." It means the process for making a release production-ready is repeatable, automated, and available whenever a valid change occurs. Imagine a fraud service currently runs:

```text
Release R102

model: fraud-v7
service: v21
features: v12
policy: v5
```

A new model is trained:

```text
fraud-v8
```

You could manually copy it onto the production machine. But then many questions appear:

- Was the model evaluated?
- Is its feature contract compatible?
- Can the service actually load it?
- Did the container include the expected libraries?
- Is the API still compatible with callers?
- Did somebody accidentally package the wrong model?
- Will it meet production latency requirements?
- Can we restore R102?

The purpose of CD is to turn those questions into a controlled pipeline. Instead of:

```text
new model
↓
someone deploys it
```

we create:

```text
new model/change
      ↓
candidate release
      ↓
automated evidence
      ↓
production-like validation
      ↓
approval policy
      ↓
controlled exposure
      ↓
production verification
```

That is Model Service CD. These terms are closely related but answer different questions.

### Continuous Integration — CI

CI asks:

Does this change integrate correctly with the rest of the system

Suppose an engineer changes:

```text
feature preprocessing
```

CI may run:

```text
unit tests
contract tests
static checks
build checks
```

Conceptually:

$$
Change
\rightarrow
CI
\rightarrow
\text{technically valid candidate}
$$

CI primarily protects the shared codebase.

### Continuous Delivery — CD

Continuous Delivery goes farther. It asks:

Can we repeatedly take an accepted change and produce a release that is ready for production

Conceptually:

```text
Candidate
   ↓
Build
   ↓
Validate
   ↓
Package
   ↓
Staging
   ↓
Approval
   ↓
Production-ready
```

Production may still require an explicit decision. So continuous delivery does **not** necessarily mean automatic production deployment.

### Continuous Deployment

Continuous Deployment removes that final manual promotion decision. If every required gate passes:

```text
tests pass
↓
evaluation passes
↓
staging passes
↓
policy passes
↓
automatically release
```

So roughly:

$$
CI
\subset
Continuous\ Delivery
$$

and:

$$
Continuous\ Deployment
=
Continuous\ Delivery
+
\text{automatic production promotion}
$$

The appropriate choice depends on risk. An internal recommendation model may tolerate greater automation than a model controlling high-impact financial decisions. A common misunderstanding is:

CD means automation that copies files to production.

That is too narrow. A good CD pipeline is better understood as:

> **A machine for accumulating evidence about one immutable candidate.**

Suppose:

```text
candidate = R103
```

The pipeline gradually establishes facts:

```text
R103 builds correctly
        ↓
R103 passes software tests
        ↓
R103 passes model tests
        ↓
R103 passes security requirements
        ↓
R103 works with dependencies
        ↓
R103 behaves correctly in staging
        ↓
R103 is approved for production
```

The candidate gains trust. The artifact itself should not change. Traditional software CD is often triggered by:

```text
code merged to main
```

ML systems have more possible sources of behavioral change. A delivery pipeline might begin because:

```text
serving code changed
model version changed
feature contract changed
preprocessing changed
policy/threshold changed
runtime changed
approved retraining produced a new model
security rebuild produced a new container
```

The deeper principle is:

If a change can alter production decisions or the reliability of the prediction path, it may deserve a new release and delivery cycle.

For example, changing:

$$
threshold:0.80\rightarrow0.65
$$

can alter more customer outcomes than some source-code changes, even though the model weights are identical. This distinction is especially important in ML. Training answers:

Can we create a candidate model

Delivery answers:

Can this candidate safely operate as part of the production service

Think of them as two connected systems.

```text
                TRAINING

Data
 +
Training Code
 +
Training Configuration
       ↓
Training Job
       ↓
Candidate Model
       ↓
Model Evaluation
       ↓
Model Registry
       │
       │ approved candidate
       ▼

                DELIVERY

Model
 +
Serving Code
 +
Feature Contract
 +
Policy
 +
Runtime
       ↓
Release R103
       ↓
Delivery Pipeline
       ↓
Production
```

Training ending successfully does not imply that deployment is safe. A training job may know:

```text
ROC-AUC = 0.95
```

but know nothing about:

```text
container startup
API compatibility
feature-store permissions
latency under serving load
rollback
```

Those belong to delivery. Suppose your service code remains:

```text
commit ABC
```

but the registry receives:

```text
fraud-model-v8
```

The delivery pipeline can create:

```text
R103:
service = ABC
model = v8
```

while R102 was:

```text
R102:
service = ABC
model = v7
```

So:

$$
Code_{102}=Code_{103}
$$

but:

$$
Model_{102}\neq Model_{103}
$$

and therefore production behavior can change. This is why a model registry event can legitimately start CD. Suppose you independently deploy:

```text
model
preprocessing
policy
service
```

You can accidentally create untested combinations.

For example:

```text
model v8
preprocessing v13
policy v5
service v20
```

even though testing validated:

```text
model v8
preprocessing v14
policy v6
service v21
```

A stronger design creates one manifest:

```text
Release R103

model:          fraud-v8
preprocessing:  v14
features:       v13
policy:         v6
service:        v21
runtime:        image SHA256:ABC...
```

Then CD operates on:

$$
R103
$$

as one unit. This is one of the strongest CD invariants. Suppose you build one package for staging:

$$
A_{stage}
$$

and then build another for production:

$$
A_{prod}
$$

Even from identical source:

$$
A_{stage}
\neq A_{prod}
$$

is possible because dependencies, build tools, base images, or external downloads may have changed.

Instead:

```text
source + model + release definition
            ↓
         BUILD ONCE
            ↓
          R103
      /      |       \
   test    staging   production
```

The same immutable object moves forward. Therefore:

$$
Hash(R103_{tested})
=
Hash(R103_{production})
$$

This lets testing evidence actually mean something.

## Which Software, Contract, Security, Model, Behaviour, Edge-Case, and Latency Gates Run before Staging?
<!-- section-summary: Fast software and contract checks precede build security and ML-specific quality, baseline, behaviour, slice, latency, and compatibility gates. -->

Once the release unit is immutable, increasingly ML-specific gates can reject defects before expensive staging and production work.

An ML service is still software. Before worrying about model accuracy, the pipeline should establish basic engineering correctness.

For example:

```text
Can the code compile/import
Can the service start
Can the model load
Are dependencies resolvable
Do unit tests pass
Do request validators work
Are API responses valid
```

A model with outstanding statistical performance is irrelevant if:

```text
POST /predict
```

returns HTTP 500 for every request. Suppose the previous service accepted:

```json
{
  "amount": 450,
  "country": "GB"
}
```

A new version suddenly requires:

```json
{
  "amount": 450,
  "country": "GB",
  "device_fingerprint": "..."
}
```

Existing callers may break. CD should test the contract between:

$$
Caller \leftrightarrow ModelService
$$

and between:

$$
ModelService \leftrightarrow Dependencies
$$

This includes the prediction response. Perhaps callers expect:

```json
{
  "score": 0.82,
  "decision": "BLOCK"
}
```

but the new service accidentally returns:

```json
{
  "probability": 0.82
}
```

The model may be correct while the product is broken. Suppose model v8 expects:

```text
amount
account_age_days
transactions_last_hour
merchant_risk
```

The delivery pipeline should verify that the deployed feature path supplies exactly the expected schema and semantics.

For example:

```text
model-v8 requires feature-schema-v13
```

If staging provides:

```text
feature-schema-v12
```

the release should fail. Prefer:

```text
deployment rejected
```

over:

```text
service starts and quietly makes nonsense predictions
```

A model-serving artifact can contain vulnerabilities just like any other production application. The delivery process may inspect:

```text
base runtime
application dependencies
artifact provenance
container contents
secrets accidentally packaged into image
approved package sources
```

The exact controls differ by organization. The first-principles point is:

Security evidence belongs to the same candidate identity as functional and model evidence.

If:

```text
R103
```

passed validation but someone later rebuilds it differently, the earlier security evidence no longer proves anything about the new bytes. Software tests answer:

Does the service work as software

ML tests answer:

Does the model behave acceptably

Those are different dimensions. Suppose R103 has:

```text
0 runtime errors
20 ms latency
perfect API compatibility
```

but its fraud model became much worse. Technically healthy. Functionally unacceptable. So CD needs a model validation stage. Suppose model v8 reports:

$$
Precision=0.84
$$

$$
Recall=0.89
$$

$$
ROC\text{-}AUC=0.95
$$

Those metrics might be compared against:

```text
minimum required quality
previous production model
risk limits
slice-specific requirements
```

For example:

$$
Recall_{v8}
\ge
Recall_{v7}-\epsilon
$$

or:

$$
FalsePositiveRate_{v8}<2\%
$$

The exact criterion is application-specific. The important thing is that promotion uses an explicit policy rather than:

This model looks pretty good.

Absolute thresholds are often not enough. Suppose:

```text
production model v7 accuracy = 94%
candidate v8 accuracy = 92%
```

Even if policy says:

```text
minimum accuracy = 90%
```

v8 has apparently regressed. A useful delivery test is therefore:

$$
Candidate
\quad versus \quad
CurrentProduction
$$

on the same approved evaluation set.

For example:

```text
v7:
precision 0.84
recall    0.88

v8:
precision 0.86
recall    0.91
```

Now the release decision has comparative evidence. Suppose model v8 has almost identical overall accuracy to v7. But for certain important requests:

```text
v7 → APPROVE
v8 → BLOCK
```

Those disagreements may matter. So you can maintain representative or "golden" cases.

For example:

```text
case A:
expected score range 0.00–0.20

case B:
must not produce BLOCK

case C:
missing field must produce controlled failure
```

This tests model behavior at the decision level rather than only overall statistics. Production will eventually see inputs that were rare in training. Examples include:

```text
missing features
extreme numeric values
unseen categories
empty text
very long text
malformed requests
NaN/Infinity
out-of-range values
```

The delivery pipeline should determine the intended behavior.

For example:

$$
missing(feature)
\rightarrow
reject
$$

or:

$$
missing(feature)
\rightarrow
fallback
$$

but not:

$$
missing(feature)
\rightarrow
undefined\ behavior
$$

Suppose v8 is more accurate than v7:

$$
Accuracy_{v8}>Accuracy_{v7}
$$

but inference latency changes:

```text
v7 p95 = 45 ms
v8 p95 = 950 ms
```

If the product requires a decision within 100 ms, v8 is not production-ready. Production ML quality therefore includes:

$$
Quality =
f(
predictive\ quality,
latency,
reliability,
resource\ cost,
safety
)
$$

not merely accuracy.

![Continuous integration and continuous delivery compared by their questions and outcomes, followed by human-approved delivery or policy-authorized continuous deployment](/content-assets/articles/article-mlops-mlops-infrastructure-cd-for-model-services/ci-delivery-deployment.png)

*CI integrates a change, continuous delivery proves that an exact release is production-ready, and continuous deployment automates the final production authority decision.*

## How Do Staging, Recovery, Observability, and Approval Produce Delivery Evidence?
<!-- section-summary: Staging tests deployment, request paths, recovery, and observability; approval is the policy boundary at which continuous delivery may stop. -->

Passing component gates permits a full staging deployment where recovery and observability become part of the evidence and approval decision.

Passing isolated software and model checks still doesn't prove the complete production path works. Staging should exercise:

```text
Request
   ↓
Gateway
   ↓
Service
   ↓
Feature Store
   ↓
Preprocessing
   ↓
Model
   ↓
Policy
   ↓
Response
```

using R103 exactly as production would. This is where many integration errors appear. Ask whether R103 can:

```text
be pulled from artifact storage
start successfully
load its model
retrieve secrets
reach dependencies
pass readiness checks
receive traffic
emit metrics
restart cleanly
scale
shut down correctly
```

These are all part of "the model service works." A test such as:

```python
model.predict(x)
```

proves almost none of them. Suppose the feature store is unavailable. What happens?

```text
Request
   ↓
Feature Store
   X
```

Possible intentional responses might be:

```text
return controlled error
use cached features
invoke fallback model
use business-rule fallback
```

CD should test whichever behavior the system claims to support. The pipeline should not validate only the happy path. The delivery pipeline should confirm that R103 exposes enough information to operate it. For example, can operators observe:

```text
release identity
model identity
request rate
errors
latency
feature failures
prediction distribution
resource usage
```

A model service that works but cannot be diagnosed is difficult to operate safely. After automated and staging evidence is collected, some systems require explicit production approval.

Conceptually:

```text
R103
 │
 ├── software checks PASS
 ├── security checks PASS
 ├── model checks PASS
 ├── staging checks PASS
 │
 ▼
PRODUCTION APPROVAL
```

Approval should attach to:

$$
R103
$$

not to:

whatever happens to be the latest version later.

If R103 changes, it should acquire a new identity and require appropriate new evidence. This is why **continuous delivery** and **continuous deployment** are not identical. At this point R103 may be:

```text
production-ready
```

but not yet:

```text
production-live
```

A human or release policy can decide when to expose it. That lets organizations automate nearly all verification while retaining deliberate control over real-world impact.

## Why Must Deployment and Traffic Exposure Use Layered Production Evidence?
<!-- section-summary: Production deployment creates capacity, while shadow and canary exposure collect operational proxies and later model outcomes before full authority. -->

Production still separates deploying capacity from granting traffic and decision authority because true outcome evidence arrives at different speeds.

Suppose R103 receives:

$$
100\%
$$

of traffic immediately. Any defect gets the maximum possible blast radius. A safer strategy is:

```text
R102 → 99%
R103 → 1%
```

Then inspect evidence. If healthy:

```text
1%
↓
5%
↓
20%
↓
50%
↓
100%
```

The principle is:

Increase exposure only as confidence increases.

This is progressive delivery. You can have:

```text
R103 deployed in production
```

while:

```text
R103 traffic = 0%
```

That can be useful. You can first verify:

```text
service starts
model loads
dependencies reachable
health checks pass
```

Then begin traffic. Therefore:

$$
Deployment \neq Release
$$

and CD can control both independently. For some models, you can send real production requests to both versions:

```text
                     ┌→ R102 → real decision
Request ─────────────┤
                     └→ R103 → result recorded only
```

R103 gets realistic production input, but its decisions do not affect users. You can compare:

$$
Prediction_{102}(x)
$$

with:

$$
Prediction_{103}(x)
$$

before assigning decision authority. This can be particularly valuable when staging data cannot perfectly reproduce production. After releasing R103 to 1%, you may quickly know:

```text
service error rate
latency
CPU/GPU use
timeouts
feature failures
memory consumption
```

These signals arrive almost immediately. So CD can often decide quickly whether the release is operationally healthy. But ML introduces another complication. Suppose a churn model predicts:

```text
customer will churn within 60 days
```

You cannot know today whether today's prediction was correct. Likewise:

```text
fraud chargeback
loan default
customer lifetime value
medical outcome
```

may have delayed ground truth. So:

$$
Time(system\ health)
\ll
Time(model\ ground\ truth)
$$

This makes ML delivery different from many ordinary services. Immediately after release, you may know:

```text
service is healthy
```

Soon afterward:

```text
input distributions look normal
prediction distributions look normal
```

Later:

```text
actual model accuracy/business outcomes are acceptable
```

So a release might be operationally promoted before all long-term model evidence is available. That does not mean long-term evaluation disappears. It means it becomes part of ongoing production model monitoring. Suppose actual fraud confirmation arrives weeks later. Immediately, you might still inspect:

```text
fraction blocked
fraction reviewed
score distribution
model disagreement with previous version
manual-review outcomes
```

These can reveal suspicious behavior.

For example:

```text
R102 block rate = 2%
R103 block rate = 41%
```

Even before ground truth arrives, something likely deserves investigation. But:

Prediction distributions are warning signals, not substitutes for eventual real outcome measurements.

## How Do Identity, Prediction Attribution, Release Records, Retention, and Rollback Preserve Control?
<!-- section-summary: Immutable identities and per-prediction release attribution feed a durable release record, while retention and tested complete rollback preserve recovery. -->

That layered exposure remains trustworthy only when every prediction and state transition refers to immutable release identity and a retained rollback unit.

The pipeline says:

```text
deploy R103
```

but that does not prove production actually runs R103. You need to compare:

$$
DesiredState
$$

with:

$$
ObservedState
$$

Suppose:

```text
Desired:
all new instances = R103
```

but production reports:

```text
server A → R103
server B → R103
server C → R102
```

The rollout is incomplete. Do not rely exclusively on:

```text
image: fraud-service:latest
```

or even:

```text
image: fraud-service:v8
```

if tags can move. A stronger check is:

```text
expected container digest:
SHA256:AAA

observed container digest:
SHA256:AAA
```

and:

```text
expected model digest:
SHA256:BBB

observed model digest:
SHA256:BBB
```

Then the production evidence is tied to exact content. A production response or internal trace might carry:

```text
release_id = R103
model_version = fraud-v8
```

Then monitoring can compare:

$$
Metrics(R102)
$$

against:

$$
Metrics(R103)
$$

during canary rollout. And if someone asks:

Why did request `abc123` receive this decision

you can identify the exact release involved. A release record should make it possible to reconstruct what happened.

Conceptually:

```text
Release R103

source revision:      abc123...
model:                fraud-v8
model digest:         ...
container digest:     ...
feature contract:     v13
policy:               v6
build record:         ...
evaluation record:    ...
security result:      ...
staging result:       ...
production approval:  ...
deployment history:   ...
previous release:     R102
```

The goal is not bureaucracy. The goal is answering:

Exactly what did we release, why was it allowed, and what can we restore

Suppose R103 is:

```text
model v8
features v13
policy v6
service v22
```

and R102 was:

```text
model v7
features v12
policy v5
service v21
```

If R103 fails, changing only:

```text
model v8 → model v7
```

leaves:

```text
features v13
policy v6
service v22
```

That combination may never have been tested. Rollback should instead be:

$$
R103\rightarrow R102
$$

as a complete release. A pipeline should already know:

```text
current = R102
candidate = R103
rollback target = R102
```

before R103 receives production traffic. That is much safer than discovering during an incident that nobody remembers which prior state was compatible. Rollback requires the old release to remain available. That means retaining enough of:

```text
container
model artifact
preprocessing assets
release manifest
configuration version
dependencies
compatibility support
```

to actually run R102 again. Merely keeping:

```text
fraud-v7.pkl
```

does not necessarily make R102 recoverable. One of the most valuable pipeline tests is:

```text
deploy R102
↓
upgrade to R103
↓
verify R103
↓
restore R102
↓
verify R102
```

in a safe environment. This catches issues like:

```text
database change prevents downgrade
feature schema removed
old artifact missing
old runtime unsupported
configuration incompatible
```

A rollback plan is much more trustworthy if it has been executed. People often test the application but assume the pipeline works. The delivery mechanism can fail too. You should know what happens if:

```text
artifact upload fails
registry update fails
staging deploy partially succeeds
approval metadata is missing
production rollout stalls halfway
verification fails
rollback command fails
```

The delivery pipeline is itself production software. It deserves testing, observability, version control, and recovery design.

![Serving-code, model-version, feature-or-policy, and capacity changes routed to different release and desired-state work](/content-assets/articles/article-mlops-mlops-infrastructure-cd-for-model-services/change-to-delivery-path.png)

*The changed boundary determines whether delivery builds a new image, pins a new model, reviews a new behavioural identity, or updates only environment desired state.*

## How Do Explicit States, Tool Boundaries, Training Separation, and Environment Promotion Shape the Workflow?
<!-- section-summary: An explicit state machine prevents invalid transitions; CI/CD coordinates independently runnable work while training and delivery remain distinct pipelines across environments. -->

Explicit delivery states and tool boundaries keep coordination separate from verification and keep training from being accidentally rebuilt inside deployment.

A release may move through states such as:

```text
CREATED
   ↓
BUILT
   ↓
VALIDATED
   ↓
STAGING_VERIFIED
   ↓
PRODUCTION_APPROVED
   ↓
CANARY
   ↓
PRODUCTION
```

If something fails:

```text
CANARY
   ↓
ROLLED_BACK
```

This state machine makes the lifecycle explicit.

For example:

$$
VALIDATED \not\rightarrow PRODUCTION
$$

might be forbidden if policy requires staging first. Suppose R103 fails model validation. A fragile process says:

Please don't deploy it.

A strong pipeline encodes:

```text
model_validation = FAILED
```

therefore:

$$
PromoteToProduction(R103)=DENIED
$$

This is a major purpose of CD automation. Safety rules become enforced constraints instead of institutional memory. "Which CD tool should we use?" is usually the wrong first question. Start with:

What must we deploy, and what controls must the target platform support

If your release is a container deployed to a container orchestration platform, the delivery system needs to manage:

```text
container identity
deployment manifests
health verification
traffic rollout
rollback
```

If inference is serverless:

```text
function/service revision
configuration
traffic split
```

If inference is batch:

```text
job image
schedule
input/output contracts
job rollback/re-run semantics
```

If a managed model-serving platform is used:

```text
model registry version
endpoint configuration
deployment revision
traffic routing
```

The delivery architecture follows the serving architecture. A system such as GitHub Actions can orchestrate:

```text
build
tests
artifact publication
model checks
release manifest creation
staging deployment
approval gate
production deployment
verification
```

but it does not have to be the system actually serving the model.

Conceptually:

```text
Git / Registry Event
       ↓
CD Orchestrator
       ↓
Artifact Registry
       ↓
Deployment Platform
       ↓
Model Service
```

Keeping those responsibilities distinct makes the architecture easier to reason about. Conceptually, a model-service workflow could look like this:

```yaml
name: model-service-delivery

on:
  push-to-main-or-approved-model-event

jobs:

  build:
    - resolve exact source revision
    - resolve exact model version
    - build immutable service image
    - calculate artifact digests
    - create release manifest

  software-validation:
    needs: build
    - run unit tests
    - run API contract tests
    - run feature contract tests
    - run security/build checks

  model-validation:
    needs: build
    - evaluate candidate model
    - compare with current production model
    - run golden prediction cases
    - verify latency/resource limits

  staging:
    needs:
      - software-validation
      - model-validation
    - deploy exact release artifact
    - verify artifact identities
    - run integration tests
    - run end-to-end tests
    - test observability
    - test failure behavior

  production-approval:
    needs: staging
    - require production authorization

  canary:
    needs: production-approval
    - deploy exact approved release
    - verify release identity
    - send small traffic percentage
    - evaluate operational metrics

  promote:
    needs: canary
    - increase traffic gradually
    - record production release

  rollback:
    - restore retained previous release
```

The syntax is intentionally secondary. What matters is the dependency graph:

$$
Build
\rightarrow
Validate
\rightarrow
Stage
\rightarrow
Approve
\rightarrow
Canary
\rightarrow
Promote
$$

Every arrow should preserve the exact candidate identity. It should not conceptually do:

```text
build staging artifact
↓
approve
↓
rebuild production artifact
```

because the production object would no longer be exactly the object that passed validation. It should do:

```text
build R103
      ↓
test R103
      ↓
stage R103
      ↓
approve R103
      ↓
deploy R103
```

That distinction is one of the foundations of trustworthy CD. You could build one giant workflow:

```text
collect data
↓
train model
↓
evaluate model
↓
package
↓
stage
↓
deploy
```

Sometimes that is appropriate. But conceptually it is often cleaner to separate:

```text
Training Pipeline
        ↓
approved model candidate
        ↓
Delivery Pipeline
```

Why? Because training and serving releases have different responsibilities. Training is concerned with:

$$
Data\rightarrow Model
$$

Delivery is concerned with:

$$
Model+Software\rightarrow ReliableProductionCapability
$$

They can evolve independently while still being linked through lineage. Suppose:

```text
model-v8
```

remains unchanged. You discover a serving bug and update the API implementation.

Then:

```text
R103:
model v8
service v21
```

becomes:

```text
R104:
model v8
service v22
```

No retraining occurred. Yet a new delivery pipeline run is necessary. Likewise, a model change can require a new delivery run without source-code modification. This is why model version and release version are separate concepts. The desired lifecycle is:

```text
R103
 │
 ├── test
 │
 ├── staging
 │
 └── production
```

rather than:

```text
R103-dev
R103-stage
R103-prod
```

if those represent separately rebuilt artifacts. Environment configuration can differ, but release identity remains stable. This preserves traceability:

$$
SameRelease
+
DifferentEnvironmentBinding
$$

## How Does a Full Release and Failed Canary Demonstrate CD's Recovery Path?
<!-- section-summary: The full example promotes one release, pauses or rolls back a failed canary, and keeps the incident response routine and traceable. -->

The complete flow shows the normal path and a failed canary using the same evidence and state model.

Suppose production currently uses:

```text
R102
model v7
```

Training creates:

```text
model v8
```

The model registry marks it as an approved delivery candidate. The CD pipeline resolves:

```text
source commit = ABC
model = v8
features = v13
policy = v6
```

and builds:

```text
R103
```

with immutable digests. Software tests pass. Model validation compares v8 with v7. Staging deploys the exact R103. A synthetic request travels through:

```text
API
↓
feature service
↓
preprocessing
↓
model v8
↓
policy v6
↓
decision
```

The expected answer appears. Staging verifies:

```text
release_id = R103
```

Production approval is attached to R103. Production deployment starts R103 with zero traffic. Health checks pass. Traffic becomes:

```text
R102 99%
R103  1%
```

Operational metrics remain normal. Traffic moves:

```text
5%
20%
50%
100%
```

Every production prediction records:

```text
release = R103
model = v8
```

Weeks later, delayed labels confirm that model quality also improved. That entire automated progression is Model Service CD. Imagine at 5% traffic:

```text
R102 block rate = 2.4%
R103 block rate = 26%
```

even though:

```text
error rate = normal
latency = normal
```

The service works technically. Its behavior is suspicious. The CD/release system stops promotion:

```text
R103 5%
↓
R103 0%
```

and restores:

```text
R102 100%
```

The failed candidate remains preserved for diagnosis. You do **not** modify R103 in place. A corrected change produces:

```text
R104
```

which goes through the pipeline again. This is a useful design objective. A failed candidate should look like:

```text
R103 failed gate
↓
promotion stopped
↓
R102 remains/restored
↓
diagnose
↓
produce R104
```

not:

```text
everyone joins emergency call
↓
SSH to production
↓
edit files manually
↓
try random model versions
↓
hope service recovers
```

Good CD converts risky operational improvisation into routine controlled transitions. Every new release introduces uncertainty. Before testing:

$$
U_0 = high
$$

After build verification:

$$
U_1 < U_0
$$

After model validation:

$$
U_2 < U_1
$$

After staging:

$$
U_3 < U_2
$$

After canary production traffic:

$$
U_4 < U_3
$$

You never reduce uncertainty to exactly zero. Instead CD progressively reduces uncertainty while progressively increasing exposure. That gives us a fundamental relationship:

$$
\boxed{
\text{Exposure should grow as evidence grows}
}
$$

This is the deeper logic behind staged delivery. Tools such as workflow runners, container registries, deployment platforms, and model registries are implementation mechanisms. The real system is a chain of controlled assertions:

```text
This is exactly R103.
        ↓
R103 passed software validation.
        ↓
R103 passed model validation.
        ↓
R103 passed staging.
        ↓
R103 was authorized.
        ↓
Exactly R103 entered production.
        ↓
Only a small fraction saw it first.
        ↓
Production confirmed acceptable behavior.
```

That chain is the essence of CD.

## What Final Principle Makes Model-Service CD More than Pipeline Plumbing?
<!-- section-summary: Model-service CD manages uncertainty by accumulating evidence, limiting exposure, preserving identity, and making recovery a normal state transition. -->

The final principle treats CD as controlled uncertainty reduction rather than automation for its own sake.

A concise mental model is:

```text
       MODEL SERVICE CONTINUOUS DELIVERY

Change / New Model
        ↓
Resolve exact inputs
        ↓
BUILD ONCE
        ↓
Immutable Release R103
        ↓
Software + Contract + Security Checks
        ↓
Model + Prediction Behaviour Checks
        ↓
Production-like Staging
        ↓
Approval
        ↓
Deploy exact R103
        ↓
Verify exact R103
        ↓
Small Production Exposure
        ↓
Observe
    ┌───────┴────────┐
    │                │
healthy            problem
    │                │
    ▼                ▼
more traffic     restore R102
    │
    ▼
  100%
```

The definition is:

**Model Service Continuous Delivery is the repeatable process that takes a precisely identified model-service change, builds one immutable release from it, accumulates software, ML, security, integration, and operational evidence about that exact release, and makes it safely eligible for controlled production use while preserving a tested recovery path.**

The deepest invariant is:

$$
\boxed{
\text{Built Release}
=
\text{Tested Release}
=
\text{Approved Release}
=
\text{Deployed Release}
}
$$

And the operational principle is:

$$
\boxed{
\text{Automate evidence collection}
\;+\;
\text{preserve artifact identity}
\;+\;
\text{increase exposure gradually}
\;+\;
\text{keep rollback ready}
}
$$

That is what makes CD valuable for ML: it turns deploying a new model from a one-off operational event into a **controlled, repeatable, evidence-based state transition**.

![A model service delivery loop from intake and immutable packaging through staging proof, scoped authority, controlled admission, immediate and delayed evidence, and complete-release recovery](/content-assets/articles/article-mlops-mlops-infrastructure-cd-for-model-services/model-service-cd-summary.png)

*Delivery uses immediate operational evidence and later mature-label evidence to govern expansion while the complete retained release remains available for recovery.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Complete Release Does Model-Service CD Control?]{kind="recap"}
CD controls a complete release of model, service, runtime, features, configuration, policy, and infrastructure, built once and triggered by code, model, or dependency changes.
:::

:::expand[Which Software, Contract, Security, Model, Behaviour, Edge-Case, and Latency Gates Run before Staging?]{kind="recap"}
Fast software and contract checks precede build security and ML-specific quality, baseline, behaviour, slice, latency, and compatibility gates.
:::

:::expand[How Do Staging, Recovery, Observability, and Approval Produce Delivery Evidence?]{kind="recap"}
Staging tests deployment, request paths, recovery, and observability; approval is the policy boundary at which continuous delivery may stop.
:::

:::expand[Why Must Deployment and Traffic Exposure Use Layered Production Evidence?]{kind="recap"}
Production deployment creates capacity, while shadow and canary exposure collect operational proxies and later model outcomes before full authority.
:::

:::expand[How Do Identity, Prediction Attribution, Release Records, Retention, and Rollback Preserve Control?]{kind="recap"}
Immutable identities and per-prediction release attribution feed a durable release record, while retention and tested complete rollback preserve recovery.
:::

:::expand[How Do Explicit States, Tool Boundaries, Training Separation, and Environment Promotion Shape the Workflow?]{kind="recap"}
An explicit state machine prevents invalid transitions; CI/CD coordinates independently runnable work while training and delivery remain distinct pipelines across environments.
:::

:::expand[How Does a Full Release and Failed Canary Demonstrate CD's Recovery Path?]{kind="recap"}
The full example promotes one release, pauses or rolls back a failed canary, and keeps the incident response routine and traceable.
:::

:::expand[What Final Principle Makes Model-Service CD More than Pipeline Plumbing?]{kind="recap"}
Model-service CD manages uncertainty by accumulating evidence, limiting exposure, preserving identity, and making recovery a normal state transition.
:::
