---
title: "Model Versioning"
description: "Learn how production teams identify every model release precisely, preserve its lineage, promote the same tested assets, and restore a known-good system safely."
overview: "A deployed model is more than a weights file. Its predictions also depend on preprocessing, feature definitions, serving code, libraries, configuration, decision rules, and data evidence. The complete production release connects those parts through MLflow 3, managed model registries, OCI image digests, lineage, compatibility checks, and rollback records."
tags: ["MLOps", "production", "release"]
order: 2
id: "article-mlops-deployment-and-release-management-model-versioning-in-production"
---

## Table of Contents

1. [What Must Be Versioned to Explain a Production Prediction?](#what-must-be-versioned-to-explain-a-production-prediction)
2. [How Do Code, Dependencies, Runtime, Configuration, Policy, Data, Evaluation, and Lineage Join Model Identity?](#how-do-code-dependencies-runtime-configuration-policy-data-evaluation-and-lineage-join-model-identity)
3. [How Do Immutable Versions, Aliases, Hashes, Signatures, Manifests, and Promotion Differ?](#how-do-immutable-versions-aliases-hashes-signatures-manifests-and-promotion-differ)
4. [How Do Compatibility, Attribution, Known-Good Releases, and Rollback Use Version Identity?](#how-do-compatibility-attribution-known-good-releases-and-rollback-use-version-identity)
5. [How Do Retention, Registry Storage, Reproducibility, and Semantic Versions Preserve Restorability?](#how-do-retention-registry-storage-reproducibility-and-semantic-versions-preserve-restorability)
6. [How Do Version Diffs, Golden Requests, Monitoring, Canaries, and Experiments Improve Release Reasoning?](#how-do-version-diffs-golden-requests-monitoring-canaries-and-experiments-improve-release-reasoning)
7. [Which Invariants Make the Full Prediction Path Explainable and Restorable?](#which-invariants-make-the-full-prediction-path-explainable-and-restorable)
8. [What Final State Model Defines Production Versioning?](#what-final-state-model-defines-production-versioning)
9. [Check Your Answers](#check-your-answers)

A fraud decision made yesterday used model `v12`, but that name does not reveal the feature order, runtime, threshold, configuration, or release that produced the final block. Restoring the weights alone may not restore the same behaviour.

**Model versioning** gives immutable identities to behaviour-affecting components and ties them together in a release manifest. Aliases can choose a version, while lineage explains origin and prediction records explain which release handled each case. Retention and compatibility then make that state restorable.

These questions follow identity from the model artifact through promotion, attribution, incident diagnosis, and rollback:

1. **What Must Be Versioned to Explain a Production Prediction?**
2. **How Do Code, Dependencies, Runtime, Configuration, Policy, Data, Evaluation, and Lineage Join Model Identity?**
3. **How Do Immutable Versions, Aliases, Hashes, Signatures, Manifests, and Promotion Differ?**
4. **How Do Compatibility, Attribution, Known-Good Releases, and Rollback Use Version Identity?**
5. **How Do Retention, Registry Storage, Reproducibility, and Semantic Versions Preserve Restorability?**
6. **How Do Version Diffs, Golden Requests, Monitoring, Canaries, and Experiments Improve Release Reasoning?**
7. **Which Invariants Make the Full Prediction Path Explainable and Restorable?**
8. **What Final State Model Defines Production Versioning?**

## What Must Be Versioned to Explain a Production Prediction?
<!-- section-summary: A production prediction depends on a model and its input/output contract, preprocessing, feature order, and complete surrounding path, so a filename is insufficient identity. -->

A model version explains only part of a prediction, so production identity starts with the entire model-facing contract.

A useful way to understand model versioning is to start with one production question:

**A prediction was made yesterday. Can we determine exactly what produced it—and can we reproduce or restore that behavior today?**

Suppose a fraud system returned:

$$
P(\text{fraud}) = 0.91
$$

and the final decision was:

```text
BLOCK
```

Saying:

```text
The model was v7
```

is often not enough. The result may have depended on:

```text
model weights
preprocessing code
feature definitions
feature ordering
runtime libraries
configuration
decision thresholds
business rules
input/output schema
```

So model versioning is ultimately about creating an **unambiguous identity for production behavior**. An ML prediction can be represented roughly as:

$$
y = f_\theta(x)
$$

where:

* $$x$$ = model input
* $$\theta$$ = learned parameters
* $$y$$ = prediction

This makes versioning look simple. Version:

$$
\theta_1,\theta_2,\theta_3,\dots
$$

But production usually looks more like:

$$
D =
R_C
\left(
f_{\theta}
\left(
T_F
\left(
G_S(r)
\right)
\right)
\right)
$$

where:

* $$r$$ = raw request
* $$G_S$$ = feature-generation logic
* $$T_F$$ = preprocessing
* $$f_\theta$$ = trained model
* $$R_C$$ = configuration and decision rules
* $$D$$ = final decision

Every component can change independently.

For example:

```text
Monday:
model v7
features v12
policy v3

Tuesday:
model v7
features v12
policy v4
```

The model did not change. The production decisions did. Therefore:

> **Model versioning must distinguish the model artifact from the complete production release that determines behavior.**

This is one of the most important distinctions. Suppose your registry contains:

```text
fraud-model-v7
```

That might identify only the learned model. But the production release could be:

```text
release R102
```

containing:

```text
model:          fraud-model-v7
preprocessing:  fraud-preprocess-v14
feature_schema: fraud-features-v12
service_code:   commit 8f3c2e...
runtime:        runtime-v21
configuration:  config-v38
policy:         fraud-policy-v5
```

So:

$$
\text{Model Version} \subset \text{Release Version}
$$

A model version answers:

Which mathematical artifact

A release version answers:

Which complete prediction path

This matters enormously for rollback. Imagine model v7 expects these features:

```text
amount
account_age_days
transactions_last_hour
country_risk
```

Model v7 itself never changes. But production preprocessing changes:

```text
transactions_last_hour
```

from:

```text
number of transactions in previous 60 minutes
```

to:

```text
number of transactions since the start of the clock hour
```

Same feature name. Same data type. Different meaning. The model's output can change even though:

```text
model_version = v7
```

has not changed. Therefore the identity of production behavior needs to cover:

$$
\text{behavior identity}
=
(\text{model},
\text{features},
\text{code},
\text{runtime},
\text{config},
\text{policy})
$$

This tuple is much closer to what you actually need to version. Training produces an artifact. Depending on the framework, it might be:

```text
model.pkl
model.onnx
model.pt
model.safetensors
saved_model/
```

or some proprietary representation. The important property is:

Once a model artifact receives a production version, its contents should normally become immutable.

Suppose:

```text
fraud-model-v7
```

initially contains weights $$W_1$$. Someone should not later replace those contents with $$W_2$$ while keeping the name:

```text
fraud-model-v7
```

Otherwise:

$$
v7_{\text{yesterday}} \neq v7_{\text{today}}
$$

The version stops meaning anything.

Instead:

```text
fraud-model-v7 → immutable artifact A

fraud-model-v8 → immutable artifact B
```

Consider:

```text
model-final.pkl
model-final2.pkl
model-really-final.pkl
```

These are names, not a reliable versioning system. A production version usually needs machine-readable identity.

For example:

```text
model_name: fraud-classifier
model_version: 7
artifact_id: mdl_8a762
```

or:

```text
fraud-classifier/2026-08-24.3
```

The exact naming convention is less important than three properties:

```text
unique
immutable
traceable
```

Given a version identifier, operators should be able to retrieve exactly one artifact. A model artifact is meaningful only if we know what it accepts. Suppose model v7 expects:

```text
Input:
amount                 float32
account_age_days       int64
transactions_last_hour int64
country_risk           float32
```

and returns:

```text
Output:
fraud_probability      float32 [0,1]
```

This is often called the model's **signature**, **interface**, or **schema**.

Conceptually:

$$
f:
\mathbb{R}^4
\rightarrow
[0,1]
$$

But names and semantics matter as much as dimensions. A useful signature could say:

```text
Model: fraud-v7
Feature schema: v12

1. amount
   float32
   GBP equivalent
   non-negative

2. account_age_days
   int64
   measured at transaction timestamp

3. transactions_last_hour
   int64
   trailing 60-minute window

4. country_risk
   float32
   range [0,1]
```

Without this contract, loading the correct model artifact may still produce incorrect behavior. Suppose the model was trained with:

$$
x =
[
\text{amount},
\text{account age},
\text{transaction count}
]
$$

Production accidentally sends:

$$
x =
[
\text{account age},
\text{amount},
\text{transaction count}
]
$$

All three may be valid numbers. The model may execute successfully. But the predictions are meaningless. Therefore a feature contract must define not just:

```text
names
```

but where relevant:

```text
types
order
units
ranges
semantics
missing-value behavior
categorical mappings
```

Versioning prevents these implicit assumptions from disappearing. Imagine model v5 was trained after normalizing:

$$
z = \frac{x-\mu_5}{\sigma_5}
$$

Model v6 uses:

$$
z = \frac{x-\mu_6}{\sigma_6}
$$

If production loads:

```text
model v5
```

with:

```text
normalizer v6
```

you have created a combination that may never have been tested. So instead of treating preprocessing as generic:

```text
normalize(x)
```

you want a known relationship:

```text
model-v5 requires preprocessing-v8
model-v6 requires preprocessing-v9
```

or package them together.

Conceptually:

$$
M_5 \leftrightarrow P_8
$$

rather than:

$$
M_5 + \text{whatever preprocessing happens to be installed}
$$

Suppose:

```text
feature-schema-v12
```

contains:

```text
amount
account_age_days
transactions_last_hour
merchant_risk
```

Model v7 declares:

```text
requires feature-schema-v12
```

Now a new pipeline produces:

```text
feature-schema-v13
```

with:

```text
amount
account_age_days
transactions_last_24_hours
merchant_risk
```

The serving system can detect:

```text
model-v7 requires v12
received v13
```

and refuse to start. That is much better than allowing silent semantic corruption. The general principle is:

**Make compatibility explicit enough that incompatible components fail early.**

## How Do Code, Dependencies, Runtime, Configuration, Policy, Data, Evaluation, and Lineage Join Model Identity?
<!-- section-summary: Code, libraries, runtime, configuration, policy, training data, evaluation, model lineage, and release lineage record independently changing causes of behaviour. -->

That contract depends on independently changing code, data, runtime, configuration, policy, and evaluation evidence that need linked versions.

A model prediction is often produced through application code:

```python
features = build_features(request)
score = model.predict(features)
decision = apply_policy(score)
```

Changing any line can affect behavior. Therefore the release should normally point back to an exact source revision.

For example:

```text
git commit:
8f3c2e913...
```

Rather than merely:

```text
branch:
main
```

Why? Because:

```text
main
```

changes. A commit identifier does not. So a release might record:

```text
source_repository: fraud-service
source_commit: 8f3c2e913
```

Now you can identify exactly which source produced the deployed code. Suppose the service uses:

```text
Python
NumPy
scikit-learn
pandas
custom feature library
```

A model trained using one library version may not behave exactly the same—or may not even load—with another. Bad:

```text
scikit-learn >= 1.0
numpy latest
```

Better for a reproducible release:

```text
scikit-learn = exact approved version
numpy = exact approved version
feature-lib = exact approved version
```

Often this is achieved through:

```text
lockfiles
container images
environment manifests
package hashes
```

The principle is:

$$
\text{reproducibility}
\Rightarrow
\text{pin everything capable of altering execution}
$$

Even application dependencies may not be enough. Execution can depend on:

```text
Python version
OS libraries
CUDA version
GPU drivers
Java runtime
native libraries
compiler/runtime behavior
```

So a model-serving container might have an immutable identity:

```text
fraud-service@sha256:8a13...
```

That identifies the actual container contents rather than a mutable tag like:

```text
fraud-service:latest
```

Again, the underlying idea is:

A version should point to fixed content.

Configuration often determines major portions of ML behavior. Consider:

```yaml
model: fraud-v7
threshold: 0.80
missing_feature_policy: reject
timeout_ms: 150
```

Changing:

```text
threshold: 0.80
```

to:

```text
threshold: 0.60
```

could dramatically alter business decisions. The model artifact remains identical. Therefore configuration itself needs identity:

```text
config-v41
```

and the release might record:

```text
model-v7 + config-v41
```

instead of merely:

```text
model-v7
```

Many production models output a score rather than a final action.

For example:

$$
p=0.82
$$

Policy transforms that score into a decision:

$$
D(p)=
\begin{cases}
APPROVE  p<0.40 \\
REVIEW  0.40\le p<0.80 \\
BLOCK  p\ge0.80
\end{cases}
$$

Call that:

```text
policy-v5
```

Now suppose:

```text
policy-v6
```

changes the blocking threshold to:

$$
0.70
$$

Even with the same model:

$$
M_7(x)=0.75
$$

we obtain:

```text
policy-v5 → REVIEW
policy-v6 → BLOCK
```

Therefore:

> **The version that explains the final business decision must include policy, not merely the model.**

A production model should have lineage back to training. Suppose:

```text
fraud-model-v7
```

was created from:

```text
training code: commit a91c...
dataset snapshot: fraud-data-2026-08-10
feature definitions: v12
hyperparameters: training-config-44
random seed: 72819
training job: job-88271
```

This establishes **lineage**.

Conceptually:

```text
Data
  +
Training Code
  +
Feature Logic
  +
Training Configuration
        ↓
    Training Run
        ↓
   Model Artifact
```

If model v7 behaves unexpectedly, lineage tells you what produced it. Two training runs can use exactly the same code and hyperparameters but different data:

$$
M_1 =
Train(D_1,C)
$$

$$
M_2 =
Train(D_2,C)
$$

If:

$$
D_1 \neq D_2
$$

then generally:

$$
M_1 \neq M_2
$$

So provenance should identify the training data. That might mean:

```text
dataset snapshot ID
table snapshot timestamp
data warehouse version
object manifest
commit/version in a data-versioning system
```

The goal is not necessarily storing a second full copy of every dataset. The goal is being able to answer:

Exactly which data population produced this model

A release should also explain **why the organization considered the model acceptable**.

For example:

```text
candidate: fraud-model-v7

validation dataset:
fraud-eval-2026-08

ROC-AUC:       0.943
precision:     0.821
recall:        0.884
p95 latency:   34 ms

approval:
evaluation-suite-v16 passed
```

This creates a relationship:

```text
Model Candidate
      ↓
Evaluation
      ↓
Approval
      ↓
Eligible For Release
```

Without the evaluation record, you know what was deployed but not why it was believed to be safe or useful. A **model registry** primarily answers:

Which model artifacts exist and what state are they in

It might contain:

| Model | Version | Status     |
| ----- | ------: | ---------- |
| fraud |       6 | archived   |
| fraud |       7 | production |
| fraud |       8 | candidate  |

A registry might store:

```text
artifact location
model signature
metrics
owner/team
creation time
status
tags
description
```

Lineage answers:

Where did this artifact come from, and where was it used

For example:

```text
dataset D51
  ↓
training run T902
  ↓
model v7
  ↓
evaluation E63
  ↓
release R102
  ↓
production endpoint fraud-prod
```

Think of the registry as an **inventory**. Think of lineage as a **history graph**. Training lineage might be:

```text
data
 ↓
training job
 ↓
model
```

Production lineage continues:

```text
model
  +
feature implementation
  +
service code
  +
runtime
  +
configuration
  +
policy
       ↓
   release R102
       ↓
production deployment
```

Now you can answer:

Which production releases used model v7

or:

Which requests were processed by release R102

That is much more operationally useful.

![The same credit-risk model output of 0.78 producing different approval decisions under thresholds of 0.75 and 0.80](/content-assets/articles/article-mlops-deployment-and-release-management-model-versioning-in-production/same-weights-different-decisions.png)

*The model version identifies the scorer; the release must also identify the policy and every other component that changes production behaviour.*

## How Do Immutable Versions, Aliases, Hashes, Signatures, Manifests, and Promotion Differ?
<!-- section-summary: Immutable versions identify content; aliases select versions; hashes prove integrity; signatures add authenticity; manifests close dependencies; promotion changes status. -->

Stable identity then requires separating immutable versions and manifests from mutable aliases, labels, and promotion state.

Suppose you assign:

```text
fraud-model-v7
```

Then three weeks later someone retrains it and replaces its artifact. Now your logs from last month say:

```text
model_version = v7
```

but today's `v7` is different. You have destroyed historical traceability. The stronger rule is:

```text
v7 is permanent

new content → v8
```

Even if v7 had a mistake. You can mark it:

```text
deprecated
rejected
archived
```

but do not silently change its contents. Suppose these immutable versions exist:

```text
fraud-v6
fraud-v7
fraud-v8
```

You may also want a human-friendly alias:

```text
production
```

Initially:

```text
production → fraud-v7
```

After promotion:

```text
production → fraud-v8
```

The alias changed. The versions did not. This distinction is useful:

```text
Version = immutable identity
Alias   = movable pointer
```

Other aliases might include:

```text
candidate
staging
champion
previous-production
```

You might attach tags such as:

```text
team=fraud
framework=xgboost
risk-tier=high
training-period=2026-Q3
```

Tags are useful for searching and categorization. But they should generally not be treated as the canonical immutable identity. Why? Because tags can often be edited. So:

```text
version 12345
```

might be identity.

```text
production-approved
```

might be metadata or a mutable status. Names such as:

```text
model-v7
```

depend on your versioning process. A cryptographic hash derives identity from the contents themselves.

For example:

$$
H(\text{artifact}) =
\text{SHA-256 digest}
$$

Suppose:

```text
SHA256(model-v7) =
a4e19f...
```

Change one byte in the artifact and the digest becomes different with overwhelming probability. Therefore hashes are useful for verifying:

Did these bytes change

Suppose you download:

```text
model-v7.onnx
```

and calculate its hash. If the expected digest is:

```text
a4e19f...
```

and the downloaded file produces:

```text
a4e19f...
```

you have strong evidence that the content matches the expected artifact. That establishes **integrity relative to the trusted digest**. But another question remains:

Who says `a4e19f...` is the legitimate production artifact

For that you may use a **digital signature**.

Conceptually:

```text
Release manifest
      ↓
Hash
      ↓
Signed using trusted signing key
      ↓
Signature
```

At deployment, you verify the signature using an approved public key. So:

```text
hash → has the content changed
signature → was this artifact approved/signed by the expected authority
```

Rather than identifying every component independently during deployment, create an immutable release manifest.

For example:

```text
Release: R102

model:
  fraud-model-v7
  sha256: aaa...

preprocessing:
  version 14

feature_schema:
  version 12

service:
  commit 8f3c2e...

container:
  sha256: bbb...

configuration:
  version 41

policy:
  version 5
```

This gives the deployment one top-level identity:

$$
R102
$$

whose contents are fixed. Now logs can simply record:

```text
release_id = R102
```

while the manifest provides the details. A useful way to think about a release is:

Include every dependency whose variation could materially alter the prediction path.

Suppose the prediction depends on:

$$
D =
F(M,P,S,C,R,E)
$$

where:

* $$M$$ = model
* $$P$$ = preprocessing
* $$S$$ = feature schema
* $$C$$ = serving code
* $$R$$ = runtime
* $$E$$ = configuration/policy

Then a release should close over those dependencies. You do not want:

```text
R102 = model-v7 + whatever happens to be installed
```

You want:

```text
R102 = precisely specified components
```

Suppose release R102 is tested in staging. A weak process does this:

```text
Build staging package
      ↓
Test
      ↓
Build another production package
      ↓
Deploy
```

Now the production artifact is not literally the thing you tested. A stronger process is:

```text
Build R102 once
     ↓
Development tests
     ↓
Testing
     ↓
Staging
     ↓
Production
```

The same immutable artifact is **promoted**. So:

$$
R102_{\text{staging}}
=
R102_{\text{production}}
$$

in terms of executable release content. Environment-specific external settings may differ, but those differences should themselves be controlled. Suppose model v8 begins as:

```text
candidate
```

Then:

```text
candidate
 ↓
validated
 ↓
staging
 ↓
production
```

Ideally the artifact does not change during these transitions. Only its status changes. Otherwise:

```text
"the candidate we tested"
```

and:

```text
"the production version"
```

might secretly be different things. This is why immutable artifacts and promotion fit together so naturally.

## How Do Compatibility, Attribution, Known-Good Releases, and Rollback Use Version Identity?
<!-- section-summary: Explicit two-direction compatibility enables coexistence, every prediction records a release ID, and rollback selects the complete known-good release. -->

Those identities make mixed releases, attribution, and rollback possible when old and new components must coexist.

Consider:

```text
API v2
feature schema v12
model v7
policy v5
```

Suppose model v8 requires:

```text
feature schema v13
```

You cannot simply swap:

```text
v7 → v8
```

if production still produces v12. Compatibility could be expressed as:

```text
model-v7 supports feature-schema-v12

model-v8 supports feature-schema-v13
```

Or perhaps:

```text
model-v8 supports feature-schema-v12 and v13
```

The point is to make compatibility something the system can validate rather than something engineers merely remember. Suppose callers currently send:

```json
{
  "amount": 500,
  "country": "GB"
}
```

You want a new service version requiring:

```json
{
  "amount": 500,
  "country": "GB",
  "merchant_type": "retail"
}
```

If `merchant_type` suddenly becomes mandatory, all old callers may break. A safer migration might initially make it optional:

```text
API v2 accepts old and new requests
```

Then callers migrate. Later the old contract can be retired deliberately. This principle matters because:

Rollback is difficult when newer components destroy compatibility with older ones.

Imagine:

```text
Release R101 → model v7
Release R102 → model v8
```

During a canary:

```text
90% R101
10% R102
```

Both versions exist simultaneously. Therefore shared components may need to support both.

For example:

```text
feature service
```

may temporarily need to produce:

```text
schema v12
and
schema v13
```

or maintain a representation compatible with both. This is why deployment design and versioning are deeply connected. Suppose an incident occurs:

Why did transaction 7123 get blocked

A good prediction log might contain:

```text
request_id: 7123

release_id: R102
model_version: fraud-v7
feature_schema: v12
policy_version: v5

prediction: 0.91
decision: BLOCK
timestamp: ...
```

This answers:

What made this decision

Without version identifiers, you may only know:

```text
score = 0.91
```

which is insufficient for serious debugging. Consider two production requests. Request A:

```text
model-v7
policy-v5
```

Request B:

```text
model-v7
policy-v6
```

Both logs say:

```text
model_version = v7
```

but their decision behavior differs.

Instead:

```text
Request A → release R102
Request B → release R103
```

Then:

```text
R102 = model-v7 + policy-v5 + ...
R103 = model-v7 + policy-v6 + ...
```

This makes production analysis much clearer. Suppose production currently points to:

```text
R103
```

and monitoring detects a serious issue. If releases are immutable and compatible, rollback becomes conceptually simple:

```text
production
     ↓
R103
```

changes to:

```text
production
     ↓
R102
```

Nothing inside R102 needs rebuilding. Nothing needs retraining. You simply restore the previous known-good release. That is one of the strongest benefits of good versioning. Imagine:

```text
R102:
model v7
features v12
policy v5
runtime v20
```

and:

```text
R103:
model v8
features v13
policy v6
runtime v21
```

R103 fails. A naive rollback changes:

```text
model v8 → model v7
```

but keeps:

```text
features v13
policy v6
runtime v21
```

Now you have created:

```text
model v7
features v13
policy v6
runtime v21
```

Perhaps that combination has never been tested. Proper rollback restores:

$$
R103 \rightarrow R102
$$

as a complete compatible unit. Suppose:

```text
R101 = known-good
R102 = previous production
R103 = current production
```

Operators should know what the fallback candidate is. You might maintain:

```text
production → R103
previous-production → R102
```

If an incident occurs, the system does not need to search through hundreds of old versions asking:

Which one should we use

The rollback target was identified in advance.

## How Do Retention, Registry Storage, Reproducibility, and Semantic Versions Preserve Restorability?
<!-- section-summary: Retention includes artifacts and dependencies; registries separate metadata and bytes; reproducibility has levels; semantic versions communicate compatibility only when defined. -->

Rollback remains possible only while the registry and retention policy preserve the complete dependency closure and its compatibility meaning.

Rollback is impossible if you immediately delete the previous release. Suppose production moves:

```text
R102 → R103
```

and five minutes later you remove:

```text
R102 container
R102 model artifact
R102 config
R102 dependencies
```

Then your theoretical rollback plan no longer exists. Therefore release management needs a retention policy.

For example:

```text
current release
previous N production releases
all releases within last X days
all releases required by audit policy
```

The exact period depends on operational and regulatory needs. Keeping:

```text
model-v7.onnx
```

is not enough if its runtime disappeared. You may need to retain:

```text
model artifact
container image
feature transformations
configuration
policy
release manifest
source commit/reference
dependency manifests
evaluation record
```

The real test is:

Could we actually run this release again

Not:

Do we still possess the `.onnx` file

Old models may transition through states such as:

```text
candidate
production
deprecated
archived
deleted
```

Archived might mean:

Not active and not immediately deployed, but all information required for restoration or audit remains available.

Deleted means:

We intentionally no longer retain it.

Organizations often keep older releases for:

```text
rollback
auditing
investigations
reproducibility
regulatory retention
comparison
```

before eventual deletion. A practical model platform often has two kinds of storage.

### Metadata store

Contains things like:

```text
model name
version
creation time
metrics
status
lineage
signature
tags
artifact location
hash
```

### Artifact/object store

Contains larger binary objects:

```text
weights
serialized model
tokenizer
preprocessing assets
container images
```

Conceptually:

```text
Registry metadata
      │
      │ artifact URI + hash
      ▼
Artifact storage
      │
      ▼
model-v7 bytes
```

The registry tells you what the object means. The object store holds the actual content. A serving configuration might say:

```text
endpoint: fraud-production
release: R103
```

or:

```text
alias production → R103
```

During promotion:

```text
production → R104
```

But R103 and R104 remain immutable. This gives you:

```text
stable endpoint
+
changeable routing
+
immutable release history
```

That is a useful separation of concerns. A tag such as:

```text
latest
```

might currently point to v8. Tomorrow it points to v9. Therefore this log is weak:

```text
model = latest
```

because you cannot know later which concrete artifact that meant. Better:

```text
resolved_model_version = v8
release_id = R103
```

You may use `latest` during discovery or automation. But production records should resolve it to immutable identity. People sometimes say:

We can reproduce the model.

That may mean several different things.

### Level 1 — Re-run inference

Given the model artifact and an input, can you reproduce its output

$$
f_{\theta}(x)
$$

### Level 2 — Reconstruct serving

Can you recreate:

```text
preprocessing
model
runtime
configuration
policy
```

and reproduce the production decision

### Level 3 — Reproduce training

Can you reconstruct the model itself from:

```text
training code
training data
configuration
random seeds
environment
```

These are related but different goals. Production rollback mainly requires Level 2. Scientific lineage may seek Level 3. Even with careful lineage, retraining may not reproduce byte-for-byte identical weights. Reasons can include:

```text
GPU nondeterminism
parallel computation
randomness
external data sources
library implementation differences
```

This reinforces an important principle:

Preserve the actual approved model artifact rather than assuming you can recreate it later.

Training lineage is valuable. But storing the actual immutable artifact gives much stronger operational recovery. You might use semantic-style versions:

```text
2.4.1
```

or monotonically increasing integers:

```text
147
148
149
```

or timestamps:

```text
2026-08-29.3
```

or opaque IDs:

```text
mdl_01K3...
```

No scheme is universally correct. The important thing is not whether the number itself explains every change. A registry can hold that information. A good identifier primarily needs to be:

```text
unique
stable
unambiguous
```

For an API or feature contract, semantic versioning can be useful:

```text
1.4.2
```

where conventionally:

```text
major → breaking interface change
minor → backward-compatible capability
patch → backward-compatible fix
```

But ML model quality does not naturally fit semantic versioning.

For example:

```text
model 3.0
```

does not inherently mean:

```text
three times better than model 1.0
```

So teams often use simple sequential model versions and track compatibility separately.

![A release controller resolving the candidate alias to model version 27, verifying exact bytes, and creating immutable release r42 before workers load it](/content-assets/articles/article-mlops-deployment-and-release-management-model-versioning-in-production/alias-to-pinned-release.png)

*Resolve a movable alias once at the release boundary, then make workers load the pinned version and digests recorded by the immutable release.*

## How Do Version Diffs, Golden Requests, Monitoring, Canaries, and Experiments Improve Release Reasoning?
<!-- section-summary: Diffs and limited simultaneous changes support causal diagnosis, while golden requests, monitoring, canaries, A/B tests, and prediction lineage use exact identities. -->

With those records, teams can compare versions, test restoration, monitor releases, and interpret canaries and experiments causally.

Suppose at 14:32 you observe a spike in false fraud blocks. Good versioning should allow you to ask:

```text
What changed at 14:30
```

and get:

```text
R102 → R103

model: v7 → v8
feature schema: unchanged
policy: unchanged
service code: unchanged
```

That immediately narrows investigation toward the model. Or perhaps the answer is:

```text
model: unchanged
policy v5 → v6
```

Then retraining is probably irrelevant. Versioning turns debugging from guessing into comparison. Suppose:

```text
R102
```

and:

```text
R103
```

are consecutive releases. A system should ideally be able to produce:

```text
Model:
v7 → v8

Feature schema:
v12 → v12

Policy:
v5 → v5

Service:
8f3c2e → 8f3c2e

Runtime:
21 → 21

Config:
41 → 41
```

That tells operators:

The only intended behavioral change was the model.

Compare that to:

```text
Model:
v7 → v8

Features:
v12 → v13

Policy:
v5 → v6

Runtime:
20 → 21

Service:
17 → 18
```

Now many variables changed simultaneously. Root-cause analysis becomes harder. Suppose production quality falls after release R200. If R200 changes:

```text
model
feature pipeline
threshold
API
runtime
```

you have five plausible causes. If R200 changes only:

```text
model v20 → v21
```

and everything else stays fixed, diagnosis is much easier. This leads to a broader release-management principle:

**Versioning lets us know what changed; disciplined release composition helps us limit how much changes at once.**

A release being stored does not prove it can still be restored. Perhaps:

```text
container was deleted
certificate expired
dependency service changed
feature schema disappeared
database migration became incompatible
permissions changed
```

So organizations with strong recovery requirements test restoration.

Conceptually:

```text
Choose archived release R102
        ↓
Deploy into isolated environment
        ↓
Load all dependencies
        ↓
Run known test requests
        ↓
Compare expected outputs
```

If the release cannot start, your rollback archive is incomplete. Suppose R102 originally produced:

```text
Input A → 0.12
Input B → 0.81
Input C → 0.44
```

Retain representative test inputs with expected behavior. During restoration:

$$
R102(x_A) \approx 0.12
$$

$$
R102(x_B) \approx 0.81
$$

$$
R102(x_C) \approx 0.44
$$

subject to defined numerical tolerances. This checks much more than whether:

```text
the server started
```

It checks whether the restored decision path behaves as expected. Suppose R102 says:

```text
model=v7
features=v12
policy=v5
runtime=v21
```

The restoration test should verify that those exact components were resolved. Not merely:

```text
some model loaded successfully
```

A useful validation is:

```text
Expected:
model hash = A
container hash = B
config hash = C

Observed:
A, B, C
```

Then the system has stronger evidence that the intended release was reconstructed. Suppose your monitoring dashboard shows:

```text
fraud-block-rate
```

Aggregating all model versions together can hide problems. Better:

```text
fraud-block-rate by release_id
```

Then you might see:

```text
R102 → 2.3%
R103 → 14.8%
```

Likewise:

```text
latency by release
error rate by release
prediction distribution by model version
business KPI by release
```

Version identifiers turn monitoring into comparative evidence. Suppose:

```text
95% → R102
5%  → R103
```

Because every request records its release:

$$
Metrics(R102)
$$

can be compared with:

$$
Metrics(R103)
$$

You might discover:

```text
R102:
error rate 0.1%
block rate 2.1%

R103:
error rate 0.1%
block rate 17.4%
```

The new release is technically healthy but behaviorally suspicious. Without version-aware telemetry, this comparison becomes much harder. If users are assigned to two model variants:

```text
Group A → R102
Group B → R103
```

you need the assignment and release identities to remain stable. Otherwise:

```text
A
```

and:

```text
B
```

become vague labels whose implementation changes during the experiment. An experiment should be able to say:

$$
Treatment = R103
$$

$$
Control = R102
$$

where both releases have immutable definitions.

### Model lineage

Answers:

How was this model created

```text
dataset
 ↓
training run
 ↓
model
```

### Prediction lineage

Answers:

How was this particular decision created

```text
request
 ↓
release
 ↓
features
 ↓
model
 ↓
score
 ↓
policy
 ↓
decision
```

Production-grade versioning benefits from both. One explains the artifact. The other explains its use.

## Which Invariants Make the Full Prediction Path Explainable and Restorable?
<!-- section-summary: A version keeps the same meaning, every decision remains attributable, and an approved complete release remains restorable with its dependencies. -->

The worked example and invariants state what identity must guarantee for future explanation and restoration.

Suppose a team trains a new fraud model.

### Training

```text
Training data:
fraud-dataset-2026-08-01

Training code:
commit 41ac...

Feature definitions:
feature-set-v12

Training configuration:
train-config-v33
```

Produces:

```text
fraud-model-v8
```

with hash:

```text
SHA256: ab91...
```

### Evaluation

```text
evaluation-suite-v21
```

reports:

```text
ROC-AUC: 0.951
precision: 0.84
recall: 0.89
latency: acceptable
```

Model is approved.

### Packaging

A release is created:

```text
R103

model:          fraud-model-v8
preprocessing:  v14
feature schema: v12
service commit: 8f3c...
container:      sha256:c881...
config:         v41
policy:         v5
```

R103 itself is made immutable.

### Staging

The exact same R103 artifact is deployed. Tests verify:

```text
input contract
feature compatibility
model loading
known predictions
decision policy
dependency access
```

### Production canary

Traffic becomes:

```text
R102 → 95%
R103 → 5%
```

Every prediction logs:

```text
request_id
release_id
model_version
score
decision
```

Monitoring compares the releases.

### Promotion

If healthy:

```text
5%
↓
20%
↓
50%
↓
100%
```

Eventually:

```text
production → R103
previous-production → R102
```

### Incident

Suppose R103 later produces unacceptable results. Rollback is:

```text
production → R102
```

Because R102's:

```text
model
features
runtime
config
policy
```

were preserved, the complete known-good decision path returns. That entire process depends on versioning. It is tempting to think a model registry is simply:

GitHub for model files.

That misses its deeper role. A registry provides controlled identity and lifecycle for ML artifacts. It helps answer:

```text
What models exist
Which one is approved
Which one is production
What data trained it
What metrics did it achieve
What input schema does it require
Which artifact bytes belong to this version
Which release contains it
What preceded it
```

That creates institutional memory around model evolution. Source control is still the natural home for:

```text
code
configuration templates
feature definitions
tests
deployment manifests
```

A model registry specializes in:

```text
trained artifacts
model metadata
evaluation metrics
model lifecycle
model lineage
```

An artifact store specializes in large files. A deployment system specializes in running releases. These systems often work together:

```text
Git / source control
        +
Data/version systems
        +
Training system
        ↓
Model registry
        ↓
Artifact store
        ↓
Release system
        ↓
Production platform
```

At some moment production has a state:

$$
S_t
$$

For example:

$$
S_t=
(M_7,F_{12},P_{14},C_{41},R_5)
$$

After a release:

$$
S_{t+1}
=
(M_8,F_{12},P_{14},C_{41},R_5)
$$

Versioning gives names to those states.

For example:

$$
S_t = R102
$$

$$
S_{t+1}=R103
$$

Now change becomes:

$$
R102 \rightarrow R103
$$

and rollback becomes:

$$
R103 \rightarrow R102
$$

This is a surprisingly powerful way to think about release management. Suppose someone asks six months later:

What was `R102`

The answer should still be exactly:

```text
model v7
preprocessing v14
features v12
service 8f3c...
runtime 21
config 41
policy 5
```

Not:

It depends on when you looked.

That gives us perhaps the most important versioning rule:

**An immutable version identifier must always resolve to the same content and meaning.**

Aliases may move. Statuses may change. Versions should not. For a decision:

$$
D_i
$$

you ideally want enough metadata to reconstruct:

$$
D_i
=
R_{102}(x_i)
$$

or more explicitly:

$$
D_i =
Policy_5(
Model_7(
Preprocess_{14}(
Features_{12}(x_i)
)))
$$

Now historical behavior becomes inspectable. This matters for:

```text
debugging
customer support
auditing
incident analysis
model evaluation
regulatory review
```

depending on the application. A release history is operationally valuable only if:

$$
Restore(R102)
$$

actually works. Therefore versioning needs:

```text
artifact retention
dependency retention
compatibility
immutable manifests
restoration testing
```

A release record that says:

```text
R102 existed
```

but cannot recreate it is historical documentation, not a rollback capability. You can picture the lifecycle as:

```text
DATA VERSION
      +
TRAINING CODE VERSION
      +
TRAINING CONFIG VERSION
      ↓
 TRAINING RUN
      ↓
MODEL VERSION
      ↓
 EVALUATION
      ↓
  APPROVAL
      ↓
MODEL REGISTRY
      │
      │ combined with
      ▼
PREPROCESSING VERSION
FEATURE CONTRACT VERSION
SERVICE CODE VERSION
RUNTIME VERSION
CONFIG VERSION
POLICY VERSION
      ↓
RELEASE VERSION
      ↓
TEST
      ↓
STAGING
      ↓
PRODUCTION CANARY
      ↓
PRODUCTION
      ↓
PREDICTIONS LOG RELEASE ID
      ↓
MONITOR
   ┌──┴───┐
   │      │
healthy  problem
   │      │
   ▼      ▼
 keep   restore previous
         release
```

## What Final State Model Defines Production Versioning?
<!-- section-summary: Versioning represents durable states and transitions across the prediction system so past behaviour can be explained and selected again. -->

The final state model treats versioning as operational control over which complete behaviour exists at each moment.

Model versioning is not fundamentally about numbering files:

```text
model-v1
model-v2
model-v3
```

It is about establishing **identity, provenance, compatibility, and reversibility**. The production question is not merely:

Which model weights are we running

It is:

Which exact, tested combination of model, features, preprocessing, code, runtime, configuration, and decision policy is producing this result

A strong system therefore separates:

```text
MODEL VERSION
= identity of the learned artifact

RELEASE VERSION
= identity of the complete prediction path

ALIAS
= movable pointer such as "production"

LINEAGE
= history explaining where an artifact came from and where it was used

REGISTRY
= controlled inventory of model versions and their metadata
```

The final equation is:

$$
\boxed{
\text{Reliable Model Versioning}
=
\text{Immutable Identity}
+
\text{Complete Lineage}
+
\text{Explicit Compatibility}
+
\text{Prediction Traceability}
+
\text{Restorability}
}
$$

If you can answer:

**1. Exactly what is running?** **2. Exactly what produced it?** **3. Exactly which release produced a given prediction?** **4. Exactly what changed between two releases?** **5. Can the previous working release actually be restored?** then you have the essential purpose of model versioning in deployment and release management.

![Five release identities feeding an immutable manifest, followed by a clean-environment restore test that either proves restorability or blocks promotion](/content-assets/articles/article-mlops-deployment-and-release-management-model-versioning-in-production/model-versioning-summary.png)

*A versioning system earns trust when a clean environment can reconstruct both the approved release and its retained rollback target.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Must Be Versioned to Explain a Production Prediction?]{kind="recap"}
A production prediction depends on a model and its input/output contract, preprocessing, feature order, and complete surrounding path, so a filename is insufficient identity.
:::

:::expand[How Do Code, Dependencies, Runtime, Configuration, Policy, Data, Evaluation, and Lineage Join Model Identity?]{kind="recap"}
Code, libraries, runtime, configuration, policy, training data, evaluation, model lineage, and release lineage record independently changing causes of behaviour.
:::

:::expand[How Do Immutable Versions, Aliases, Hashes, Signatures, Manifests, and Promotion Differ?]{kind="recap"}
Immutable versions identify content; aliases select versions; hashes prove integrity; signatures add authenticity; manifests close dependencies; promotion changes status.
:::

:::expand[How Do Compatibility, Attribution, Known-Good Releases, and Rollback Use Version Identity?]{kind="recap"}
Explicit two-direction compatibility enables coexistence, every prediction records a release ID, and rollback selects the complete known-good release.
:::

:::expand[How Do Retention, Registry Storage, Reproducibility, and Semantic Versions Preserve Restorability?]{kind="recap"}
Retention includes artifacts and dependencies; registries separate metadata and bytes; reproducibility has levels; semantic versions communicate compatibility only when defined.
:::

:::expand[How Do Version Diffs, Golden Requests, Monitoring, Canaries, and Experiments Improve Release Reasoning?]{kind="recap"}
Diffs and limited simultaneous changes support causal diagnosis, while golden requests, monitoring, canaries, A/B tests, and prediction lineage use exact identities.
:::

:::expand[Which Invariants Make the Full Prediction Path Explainable and Restorable?]{kind="recap"}
A version keeps the same meaning, every decision remains attributable, and an approved complete release remains restorable with its dependencies.
:::

:::expand[What Final State Model Defines Production Versioning?]{kind="recap"}
Versioning represents durable states and transitions across the prediction system so past behaviour can be explained and selected again.
:::
