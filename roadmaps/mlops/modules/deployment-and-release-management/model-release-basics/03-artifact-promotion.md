---
title: "Artifact Promotion"
description: "Move one immutable, tested release candidate through environment controls while preserving its identity, evidence, and recovery path."
overview: "Artifact promotion gives a more trusted environment authority to deploy an already tested release candidate. The model, serving image, contracts, evidence, and digests stay fixed; approvals, environment configuration, desired state, and deployment records change around them."
tags: ["MLOps", "production", "release"]
order: 3
id: "article-mlops-mlops-infrastructure-organizing-artifacts-across-environments"
aliases:
  - roadmaps/mlops/modules/mlops-infrastructure/storage-systems/03-organizing-artifacts-across-environments.md
  - child-storage-systems-03-organizing-artifacts-across-environments
---

## Table of Contents

1. [What Does It Mean to Promote an Immutable Artifact with Its Evidence?](#what-does-it-mean-to-promote-an-immutable-artifact-with-its-evidence)
2. [How Do Registries, Versions, Aliases, Configuration, Secrets, and Scoped Approval Support Promotion?](#how-do-registries-versions-aliases-configuration-secrets-and-scoped-approval-support-promotion)
3. [How Do Atomic Release Units, Concurrency, and Policy Protect State Transitions?](#how-do-atomic-release-units-concurrency-and-policy-protect-state-transitions)
4. [How Do Push or Pull Promotion, Partial Traffic, and Post-Promotion Verification Work?](#how-do-push-or-pull-promotion-partial-traffic-and-post-promotion-verification-work)
5. [How Do Rollback, Retention, Restoration, Exceptions, and Signatures Preserve Trust?](#how-do-rollback-retention-restoration-exceptions-and-signatures-preserve-trust)
6. [How Does a Promotion State Machine Extend Model Provenance into Release Lineage?](#how-does-a-promotion-state-machine-extend-model-provenance-into-release-lineage)
7. [How Does One Release Carry Evidence from Creation to Production?](#how-does-one-release-carry-evidence-from-creation-to-production)
8. [What Final Principle Makes Artifact Promotion a Chain of Trust?](#what-final-principle-makes-artifact-promotion-a-chain-of-trust)
9. [Check Your Answers](#check-your-answers)

A candidate passes evaluation in staging. If production rebuilds it from the same source, the new bytes may use a different dependency, base image, or generated file. The team would deploy something similar to the tested candidate, not the tested candidate itself.

**Artifact promotion** advances an immutable release and its evidence through controlled lifecycle states. The bytes keep the same identity; approvals, environment scope, aliases, desired state, and traffic authority change around them. A registry and audit trail make those transitions verifiable and reversible.

Use these questions to follow one release from candidate evidence to atomic production promotion and restoration:

1. **What Does It Mean to Promote an Immutable Artifact with Its Evidence?**
2. **How Do Registries, Versions, Aliases, Configuration, Secrets, and Scoped Approval Support Promotion?**
3. **How Do Atomic Release Units, Concurrency, and Policy Protect State Transitions?**
4. **How Do Push or Pull Promotion, Partial Traffic, and Post-Promotion Verification Work?**
5. **How Do Rollback, Retention, Restoration, Exceptions, and Signatures Preserve Trust?**
6. **How Does a Promotion State Machine Extend Model Provenance into Release Lineage?**
7. **How Does One Release Carry Evidence from Creation to Production?**
8. **What Final Principle Makes Artifact Promotion a Chain of Trust?**

## What Does It Mean to Promote an Immutable Artifact with Its Evidence?
<!-- section-summary: Promotion changes an immutable candidate's approved lifecycle state and carries its identity and evidence forward without rebuilding the bytes. -->

Copying or rebuilding files cannot prove that production received the candidate that passed evaluation; promotion preserves identity and evidence.

Artifact promotion becomes much easier to understand if we start with one question:

**How can we be confident that the software/model running in production is exactly the thing we tested and approved?**

Suppose we create a model-serving release:

```text
fraud-release R103
```

We test it in staging and everything passes. If we then rebuild the software for production, download a slightly different model, reinstall newer dependencies, or manually edit the package, we no longer know whether production is running what we tested. So the foundational principle is:

$$
\boxed{\text{Build once} \rightarrow \text{Test} \rightarrow \text{Promote the same artifact}}
$$

Artifact promotion is the mechanism for moving a **known, immutable release candidate through increasing levels of trust** without changing its identity. An artifact is a concrete output of the build or training process that can be stored and deployed. For ordinary software, an artifact might be:

```text
container image
JAR
wheel/package
binary executable
deployment bundle
```

For an ML system, artifacts might include:

```text
trained model
tokenizer
preprocessing assets
container image
release manifest
```

Suppose training produces:

```text
fraud-model-v8
```

and the serving build produces:

```text
fraud-service image
```

A release manifest might combine them:

```text
Release R103

model:
  fraud-model-v8

service:
  fraud-service image

feature_contract:
  fraud-features-v12

policy:
  fraud-policy-v5
```

The thing being promoted may therefore be either an individual artifact or, more usefully, a complete immutable **release** referencing all required artifacts. Imagine this lifecycle:

```text
Build
  ↓
Candidate
  ↓
Testing
  ↓
Staging
  ↓
Approved
  ↓
Production
```

A naive interpretation is:

At every arrow, copy the files somewhere else.

But that is not the essential idea. Promotion really means:

**The same immutable candidate has acquired enough evidence and authorization to be used in a more trusted environment.**

For example:

```text
R103
```

might initially have:

```text
status = candidate
```

After automated tests:

```text
status = validated
```

After staging:

```text
status = staging-approved
```

After human or policy approval:

```text
status = production-approved
```

The artifact did not change. Its **trust state** changed. These concepts are related but should be separated.

### Deployment

Means:

Put an artifact into an environment.

For example:

```text
Deploy R103 to staging.
```

### Promotion

Means:

Declare that an already identified artifact is eligible for the next stage of use.

For example:

```text
Promote R103 from staging-approved
to production-approved.
```

Then deployment might use that approval:

```text
Production deployment system
        ↓
find production-approved R103
        ↓
deploy R103
```

So:

$$
\text{promotion} = \text{change in eligibility/trust}
$$

while:

$$
\text{deployment} = \text{change in what is running}
$$

Keeping those concepts separate makes release systems easier to reason about. Consider this process:

```text
Source code
   ↓
Build dev artifact
   ↓
test

Source code
   ↓
Build staging artifact
   ↓
test

Source code
   ↓
Build production artifact
```

These three builds may have been produced from nominally the same source. But they are not necessarily identical. Between builds:

```text
dependencies may change
base images may change
package repositories may change
build tools may change
external downloads may change
environment variables may differ
```

Therefore:

$$
A_{\text{staging}}
\neq
A_{\text{production}}
$$

is possible. You have tested one thing and deployed another. A stronger design is:

```text
Source
  ↓
BUILD ONCE
  ↓
Artifact R103
  ↓
Testing
  ↓
Staging
  ↓
Production
```

Mathematically:

$$
R103_{\text{test}}
=
R103_{\text{staging}}
=
R103_{\text{production}}
$$

The environment around R103 may differ. But R103 itself does not. This gives us the central invariant:

**Promotion should change where an artifact may be used, not what the artifact contains.**

Suppose your build system produces:

```text
fraud-service:latest
```

The problem is that `latest` can change. At 9 AM:

```text
latest → build A
```

At noon:

```text
latest → build B
```

So this statement:

```text
We tested latest.
```

does not tell you what was actually tested. Instead, assign an immutable identity:

```text
release_id = R103
```

or:

```text
container digest =
sha256:a781...
```

or both.

Then:

```text
R103 → exact immutable contents
```

must remain true forever. A human-readable version such as:

```text
R103
```

depends on your release database being correct. A cryptographic digest is calculated from content:

$$
H(A)=d
$$

For example:

```text
sha256:a78164...
```

If the bytes change, the digest changes with overwhelming probability. Therefore a release might say:

```text
Release: R103

container:
  sha256:a781...

model:
  sha256:c918...

manifest:
  sha256:2bb4...
```

Now a production system can verify:

These are exactly the bytes that R103 is supposed to contain.

Suppose R103 passes:

```text
unit tests
integration tests
security scans
model evaluation
performance tests
staging validation
```

Those results should not live only in some engineer's terminal. They should be connected to:

```text
R103
```

Conceptually:

```text
                    ┌→ unit tests PASS
                    ├→ integration PASS
                    ├→ security PASS
R103 ───────────────┼→ model evaluation PASS
                    ├→ staging PASS
                    └→ approval granted
```

Now promotion asks:

Does **this exact candidate** have the required evidence

rather than:

Did something similar pass tests recently

A test report saying:

```text
All tests passed.
```

is weak. A better report says:

```text
Release: R103
Container digest: sha256:a781...
Model: fraud-v8
Model digest: sha256:c918...

Integration tests: PASS
Security scan: PASS
Model evaluation: PASS
```

Why? Because otherwise you can accidentally do:

```text
test R102
promote R103
```

The test evidence must bind to the thing being promoted. In first-principles terms:

$$
Evidence(A)
$$

should authorize artifact $$A$$, not some unspecified artifact. Think of a release candidate as beginning with very little trust.

```text
R103
candidate
```

Evidence accumulates:

```text
build verified
↓
tests passed
↓
security checks passed
↓
staging behavior verified
↓
business/model approval obtained
```

Eventually:

```text
R103
production eligible
```

So promotion can be thought of as a function:

$$
Promotable(A,E,P)
$$

where:

* $$A$$ = artifact
* $$E$$ = collected evidence
* $$P$$ = release policy

If:

$$
E \models P
$$

then the artifact may move to the next stage. That is the deeper idea behind release gates.

## How Do Registries, Versions, Aliases, Configuration, Secrets, and Scoped Approval Support Promotion?
<!-- section-summary: A registry coordinates immutable versions and mutable aliases; external versioned configuration and secrets stay controlled; approvals bind identity, scope, and authority. -->

That operation needs a registry, separate configuration and secrets, and approval whose scope is bound to the immutable release.

A registry gives artifacts stable identities and metadata. It might contain:

| Release | State      | Model | Deployment eligibility |
| ------- | ---------- | ----- | ---------------------- |
| R101    | archived   | v6    | none                   |
| R102    | production | v7    | production             |
| R103    | approved   | v8    | production eligible    |
| R104    | candidate  | v9    | test only              |

The registry might know:

```text
artifact digests
creation time
model version
test evidence
signatures
approval records
lineage
release status
```

The actual large binary artifacts may live elsewhere in artifact or object storage.

Conceptually:

```text
Registry
   │
   │ identity + metadata
   ▼
Artifact Store
   │
   ▼
immutable bytes
```

Suppose the immutable releases are:

```text
R101
R102
R103
```

Those identities should never move. But aliases can.

For example:

```text
candidate → R103
staging   → R102
production → R102
```

After promotion:

```text
candidate → R104
staging   → R103
production → R102
```

Later:

```text
production → R103
```

So:

$$
\text{version} = \text{immutable identity}
$$

while:

$$
\text{alias} = \text{movable reference}
$$

This separation is extremely useful. Imagine:

```text
fraud-model-staging
```

contains some model. When approved, someone copies it to:

```text
fraud-model-production
```

Later another candidate overwrites `fraud-model-staging`. Now it becomes difficult to determine which concrete model originally became production. A stronger system preserves immutable identities:

```text
fraud-model-v8
```

and moves references:

```text
staging → v8
production → v7
```

Then promotion changes:

```text
production → v8
```

but `v8` itself remains unchanged. Production and staging naturally differ.

For example:

```text
staging database
production database

staging API endpoint
production API endpoint

different credentials
different scaling limits
```

You therefore cannot make the entire environments byte-for-byte identical. The solution is to separate:

$$
\text{release artifact}
$$

from:

$$
\text{environment configuration}
$$

For example:

```text
R103
  +
staging-config
```

in staging. And:

```text
R103
  +
production-config
```

in production. The release stays unchanged. Only the environment binding changes. Separating configuration does not mean configuration can be arbitrary. Suppose:

```text
R103
```

was tested with:

```text
fraud_threshold = 0.80
```

but production silently uses:

```text
fraud_threshold = 0.25
```

The artifact may be identical, but behavior is completely different. So important environment configuration should still be:

```text
versioned
validated
reviewed
auditable
compatible with the release
```

A production deployment record might therefore say:

```text
release: R103
environment_config: prod-config-v41
```

This lets you distinguish:

Same artifact, different environment binding.

Suppose a container contains:

```text
DATABASE_PASSWORD=...
API_KEY=...
```

Now the artifact itself is environment-specific. That creates several problems. The same artifact cannot safely move between environments, and credentials become embedded in artifact storage. A better pattern is:

```text
immutable artifact
       +
runtime secret injection
       ↓
running deployment
```

For example:

```text
R103
+
production secret reference
```

Secrets are supplied through an appropriate secret-management system. This preserves the "build once, promote many" property. An approval saying:

```text
R103 approved
```

can be ambiguous. Approved for what Perhaps:

```text
approved for staging
```

does not imply:

```text
approved for production
```

Or perhaps a model has been approved for:

```text
fraud review assistance
```

but not:

```text
automatic transaction blocking
```

So an approval should have context.

Conceptually:

```text
candidate: R103
approver: authorized identity
time: ...
scope: production
purpose: fraud decision service
decision: approved
```

The exact controls depend on organizational risk. Approval may be made by:

```text
automated policy
engineer
model reviewer
security process
business owner
risk/compliance function
```

depending on the application. The important principle is traceability. A future investigation should be able to answer:

Why was R103 allowed into production

And see something like:

```text
R103

integration gate: passed
security gate: passed
model evaluation gate: passed
production approval: granted
```

rather than:

Somebody must have approved it.

Suppose an approver reviews:

```text
R103
digest = AAA
```

and grants approval. If someone later changes R103's contents to:

```text
digest = BBB
```

the approval must no longer apply. Formally:

$$
Approval(A)
$$

should not imply:

$$
Approval(A')
$$

when:

$$
A \neq A'
$$

This is another reason immutable artifacts are essential. Approval attaches to identity. If content changes, identity must change.

![The same tested model version, image digest, request contract, preprocessing, and policy passing through staging and scoped production approval while production supplies only environment settings](/content-assets/articles/article-mlops-mlops-infrastructure-organizing-artifacts-across-environments/build-once-promotion-boundary.png)

*Promotion keeps the candidate identity fixed; rebuilding or retraining creates a new candidate that must restart the evidence path.*

## How Do Atomic Release Units, Concurrency, and Policy Protect State Transitions?
<!-- section-summary: The complete release moves atomically under policy and concurrency control so partial or conflicting promotion cannot expose mixed state. -->

Several release parts and concurrent actors create a state-consistency problem best handled as one atomic policy transition.

Now consider a release made of several components:

```text
R103

model = v8
service = v21
policy = v5
features = v12
```

A bad promotion sequence could be:

```text
production.model → v8
```

then the process crashes before:

```text
production.service → v21
production.policy → v5
```

Production is now in an unintended mixed state. This is a **partial promotion** problem. Instead of independently changing several aliases:

```text
production-model
production-service
production-policy
```

you can promote one release manifest:

```text
production-release → R103
```

R103 resolves to:

```text
model v8
service v21
policy v5
features v12
```

The desired update becomes conceptually:

$$
production:
R102 \rightarrow R103
$$

as one transaction. This dramatically simplifies reasoning. Suppose:

```text
R102:
model v7
features v12
policy v5
```

and:

```text
R103:
model v8
features v13
policy v6
```

An incomplete update might accidentally create:

```text
model v8
features v12
policy v5
```

Perhaps nobody has ever tested that combination. Promotion should therefore preserve the invariant:

**Production always resolves to one valid release manifest.**

Not an accidental mixture assembled halfway through an update. Imagine two release processes run simultaneously. Engineer/process A promotes:

```text
R103
```

while process B promotes:

```text
R104
```

Without coordination:

```text
A reads production = R102
B reads production = R102

A writes production = R103
B writes production = R104
```

Depending on timing, one update silently overwrites the other. Release systems therefore need concurrency control.

Conceptually:

```text
Promote R103 only if production is still R102.
```

If production changed in the meantime, reject and re-evaluate the operation. This is similar to compare-and-swap:

$$
CAS(R102,R103)
$$

A fragile release process says:

Remember to run the security test before changing production.

A stronger system encodes:

```text
Production promotion requires:

integration_passed = true
security_passed = true
model_validation_passed = true
approval_present = true
artifact_signed = true
```

Then the release system refuses promotion if the conditions are missing. This changes safety from:

$$
\text{human remembers rule}
$$

to:

$$
\text{system enforces invariant}
$$

which is far more reliable.

## How Do Push or Pull Promotion, Partial Traffic, and Post-Promotion Verification Work?
<!-- section-summary: Push and pull mechanisms can promote desired state without immediately sending all traffic, and verification compares observed identity and behaviour with that intent. -->

The state change may be delivered by push or pull and can precede gradual traffic exposure, but the resulting deployment must be verified.

One design is:

```text
CI/CD pipeline
       ↓
promotes R103
       ↓
pushes R103 into staging
       ↓
pushes R103 into production
```

The release pipeline directly changes environments.

Conceptually:

```text
artifact → environment
```

This is common and straightforward. Another design is:

```text
Registry:
production-approved → R103
```

Then the production deployment system observes the desired state:

```text
Desired production release = R103
```

and reconciles production toward it.

Conceptually:

```text
Environment
    ↓
reads desired state
    ↓
pulls approved artifact
```

This style is common in declarative deployment systems. The deeper principle is independent of push versus pull:

The environment should run only artifacts whose immutable identities satisfy the promotion policy.

Suppose R103 becomes:

```text
production-approved
```

That does not mean all users immediately receive it. The release process could be:

```text
R103 approved for production
        ↓
deploy R103
        ↓
0% traffic
        ↓
1%
        ↓
5%
        ↓
20%
        ↓
100%
```

Promotion controls **eligibility**. Traffic rollout controls **exposure**. These are distinct controls.

For example:

```text
R102 = current production
R103 = newly production-approved
```

Both may be deployed:

```text
95% → R102
 5% → R103
```

Production telemetry is then compared. If R103 behaves correctly:

```text
5%
↓
20%
↓
50%
↓
100%
```

If not:

```text
5%
↓
0%
```

The artifact doesn't need to be rebuilt or altered. The traffic allocation changes. Suppose the registry says:

```text
production → R103
```

Does that prove every production server actually runs R103? No. One host might still run R102. Another might accidentally run R104. A cache might be stale. A deployment might have partially failed. So you need to verify **observed state** against **desired state**. The control plane says:

```text
Desired:
production = R103
```

The runtime reports:

```text
Instance A = R103
Instance B = R103
Instance C = R102
```

Therefore:

$$
Observed \neq Desired
$$

The deployment is not complete. A robust release system continually or explicitly checks:

$$
Observed = Desired
$$

before considering promotion successful. Suppose a production container reports:

```text
fraud-service:v8
```

That tag might have been reused. Stronger verification is:

```text
expected digest:
sha256:a781...

observed digest:
sha256:a781...
```

Likewise for the model:

```text
expected model digest:
sha256:c918...

observed:
sha256:c918...
```

Now you're verifying content identity rather than trusting mutable naming. Correct artifact identity is necessary, but not always sufficient. Imagine:

```text
R103
```

is present correctly, but the production environment gives it the wrong configuration. Therefore post-deployment verification might also execute known requests.

For example:

```text
synthetic transaction
      ↓
R103
      ↓
expected decision = REVIEW
```

This checks whether the complete prediction path is functioning. A useful distinction is:

```text
artifact verification
→ Are the correct bytes running

behavior verification
→ Is the resulting system behaving correctly
```

You often want both. A deployment record could look conceptually like:

```text
Environment:
production

Release:
R103

Container digest:
sha256:a781...

Model:
fraud-v8

Model digest:
sha256:c918...

Environment config:
prod-config-v41

Deployment:
successful

Verified:
yes

Timestamp:
...
```

Now an incident investigation can answer:

What exactly was running

rather than relying on assumptions about registry aliases. Imagine:

```text
08:00 R103 created
08:14 automated validation passed
09:20 deployed to staging
10:10 staging verification passed
11:00 production approval granted
11:10 production alias changed R102 → R103
11:15 canary started
12:40 rollout completed
```

This history reconstructs how the artifact reached production. It is valuable for:

```text
incident investigation
compliance
debugging
release analytics
accountability
```

Most importantly, it answers:

What sequence of evidence and decisions led to production

## How Do Rollback, Retention, Restoration, Exceptions, and Signatures Preserve Trust?
<!-- section-summary: Rollback is another promotion of a retained known-good unit; restoration tests, controlled exceptions, expiry, and signatures protect the trust chain. -->

Because promotions can fail or need reversal, retention, restoration, signatures, and disciplined exceptions are part of the same system.

Suppose:

```text
production → R103
```

and R103 turns out to be unhealthy. If R102 is retained and still valid:

```text
production → R102
```

This is conceptually just another change in the production pointer. So rollback can be understood as:

$$
Promote_{\text{production}}(R102)
$$

rather than inventing a special recovery artifact. Good promotion architecture therefore naturally makes rollback easier. Imagine R102 was production last week. During an incident someone says:

Let's rebuild R102 from source.

That introduces risk. The reconstructed artifact could differ because:

```text
dependencies changed
base images changed
build tools changed
package mirrors changed
external resources changed
```

A safer approach is:

Retain the exact artifact that previously ran successfully.

Then:

```text
R103 → R102
```

restores known bytes rather than creating a new approximation of old behavior. Promotion has an often-overlooked consequence:

When you replace something, keep the thing you may need to restore.

Suppose:

```text
R102
↓
R103
```

If R102 is immediately deleted, rollback capability disappears. A retention policy might preserve:

```text
current production release
previous production releases
recent approved releases
audit-required historical releases
```

The exact duration depends on operational and regulatory requirements. Keeping only:

```text
model-v7.onnx
```

may not be enough to restore R102. You may need:

```text
model
container image
release manifest
runtime
preprocessing assets
policy
configuration schema
migration compatibility
```

The real question is:

$$
CanRestore(R102)
$$

not:

$$
DoWeHaveModelFile(R102)
$$

Those are very different guarantees. A release can appear restorable until you actually try. Suppose R102 is retained, but:

```text
its container image was garbage-collected
its old feature contract is unsupported
a database migration removed required data
its credentials mechanism changed
```

Then your rollback plan exists only on paper. A restoration test might do:

```text
R102
 ↓
deploy into isolated environment
 ↓
verify all artifact hashes
 ↓
load dependencies
 ↓
run known requests
 ↓
compare expected outputs
```

If it succeeds, you have stronger evidence that rollback is real. Here's a dangerous pattern:

```text
R103 arrives in production
        ↓
operator edits a file
        ↓
restart
```

Now the running system is no longer exactly R103. It is:

$$
R103 + \text{unrecorded mutation}
$$

This breaks artifact promotion's main guarantee. If a change is needed, ideally create:

```text
R104
```

or a newly versioned environment configuration. The production state should remain reconstructable from versioned inputs. Real systems occasionally need emergency actions. For example, an urgent incident might require a temporary configuration override. The important thing is not to pretend exceptions never happen. Instead, constrain them. An exception should ideally be:

```text
explicitly authorized
narrow in scope
recorded
time-limited
observable
reconciled back into the normal release process
```

The problem is not necessarily having an emergency path. The dangerous situation is when the emergency path silently becomes the everyday deployment process. Suppose an incident requires:

```text
disable_model_v8 = true
```

A manual override without expiry can remain for six months. Then engineers forget why production behaves differently from configuration in source control. A stronger emergency override might include:

```text
override
reason
owner
creation time
expiry time
ticket/incident reference
```

After recovery, normal versioned state should become authoritative again. Hashes answer:

Did the artifact bytes change

Digital signatures can additionally answer:

Was this artifact signed by an authorized producer or release process

Conceptually:

```text
Build R103
    ↓
calculate digest
    ↓
sign digest
    ↓
store artifact + signature
```

Before production:

```text
retrieve R103
    ↓
verify signature
    ↓
verify digest
    ↓
check promotion policy
    ↓
deploy
```

This helps prevent untrusted artifacts from entering the release path.

![An immutable release candidate fanning out to provenance, signature and SBOM, model evaluation, compatibility, and vulnerability checks before a scoped approval decision](/content-assets/articles/article-mlops-mlops-infrastructure-organizing-artifacts-across-environments/promotion-evidence-gates.png)

*Each evidence type answers a different release question, so promotion reports the specific failed gate instead of collapsing them into one generic score.*

## How Does a Promotion State Machine Extend Model Provenance into Release Lineage?
<!-- section-summary: Allowed states and transitions prevent invalid movement and extend training provenance through approval, deployment, and the actual production release. -->

A state machine makes the allowed lifecycle explicit and carries provenance forward from training into release lineage.

A clean mental model is:

```text
CREATED
   ↓
VALIDATED
   ↓
STAGING_APPROVED
   ↓
PRODUCTION_APPROVED
   ↓
PRODUCTION
   ↓
DEPRECATED
   ↓
ARCHIVED
```

Transitions have rules.

For example:

$$
CREATED \rightarrow VALIDATED
$$

requires automated tests.

$$
VALIDATED \rightarrow STAGING\_APPROVED
$$

requires integration validation.

$$
STAGING\_APPROVED \rightarrow PRODUCTION\_APPROVED
$$

may require approval. The important property is:

The artifact does not mutate while moving between states.

Suppose policy says an artifact must pass staging before production. The system should reject:

```text
CREATED
  ↓
PRODUCTION
```

rather than merely warning about it. Likewise:

```text
security_scan = failed
```

should block production promotion if policy requires security approval. This turns release policy into enforceable state transitions. ML systems make artifact identity slightly more complicated because the serving result can depend on multiple independent artifacts:

```text
model weights
tokenizer
preprocessing logic
feature definitions
label maps
calibration parameters
decision thresholds
runtime
```

Suppose the model remains unchanged but the tokenizer changes. For an NLP model:

$$
Tokens_{v1}(text)
\neq
Tokens_{v2}(text)
$$

Therefore:

$$
Model(Tokens_{v1}(text))
$$

may differ from:

$$
Model(Tokens_{v2}(text))
$$

The promoted release needs to preserve compatible combinations. Suppose model v8 requires:

```text
tokenizer v3
preprocessing v12
policy v5
```

Do not independently promote:

```text
model → v8
```

while production still uses arbitrary companion components. Instead promote:

```text
R103

model: v8
tokenizer: v3
preprocessing: v12
policy: v5
```

Now the promoted unit corresponds to a tested behavior. This connects artifact promotion directly to model versioning. A good candidate should be traceable backward. For an ML release:

```text
training data snapshot
        +
training code
        +
training configuration
        ↓
training run
        ↓
model v8
        +
serving code
        +
runtime
        ↓
release R103
        ↓
tests
        ↓
approval
        ↓
promotion
```

So if production behaves unexpectedly, you can travel backward through the chain. Promotion should preserve this lineage rather than sever it. You want to answer:

Where did R103 go

For example:

```text
R103
 ├─ staging
 ├─ production-canary
 └─ production
```

And perhaps:

```text
R103 served:
12.4 million requests
```

This lets you connect:

$$
artifact \rightarrow deployments \rightarrow predictions
$$

which is extremely useful during incidents and audits.

## How Does One Release Carry Evidence from Creation to Production?
<!-- section-summary: The end-to-end example shows one identified candidate accumulating tests and approvals while staying byte-for-byte the same across environments. -->

The worked release demonstrates how evidence accumulates without changing the artifact that evidence describes.

Consider a fraud model. Training creates:

```text
fraud-model-v8
digest = MODEL-AAA
```

The serving build produces:

```text
fraud-service
digest = IMAGE-BBB
```

A release manifest is created:

```text
R103

model:
  fraud-model-v8
  MODEL-AAA

container:
  IMAGE-BBB

features:
  schema-v12

policy:
  policy-v5
```

R103 becomes immutable.

### Candidate validation

Automated systems attach:

```text
unit tests: PASS
integration tests: PASS
model validation: PASS
security scan: PASS
```

So:

```text
R103:
candidate → validated
```

No artifact contents change.

### Staging

The deployment system resolves:

```text
staging → R103
```

It retrieves exactly:

```text
IMAGE-BBB
MODEL-AAA
```

Staging reports those same hashes after deployment. Synthetic predictions pass. Now:

```text
R103 → staging-approved
```

### Production approval

The release policy checks:

```text
required tests passed
staging verification passed
artifact signature valid
required approval present
```

R103 becomes:

```text
production-approved
```

Again, no rebuild occurs.

### Production deployment

Production retrieves exactly the same:

```text
IMAGE-BBB
MODEL-AAA
```

but combines them with:

```text
production-config-v41
production secrets
```

Post-deployment verification confirms:

```text
release = R103
container = IMAGE-BBB
model = MODEL-AAA
config = prod-v41
```

### Gradual release

Traffic begins:

```text
R102 → 99%
R103 → 1%
```

Then:

```text
5%
20%
50%
100%
```

If monitoring remains healthy:

```text
production → R103
previous-production → R102
```

### Risk

Suppose R103 causes unacceptable fraud-block rates. The system does not modify R103. It restores:

```text
production → R102
```

The previously retained R102 artifacts are redeployed or receive traffic again. That is the complete artifact-promotion lifecycle. Strictly speaking, we usually cannot fully test the future production environment before release. But artifact promotion gives us something powerful:

> **The executable object in production is the same executable object for which we collected pre-production evidence.**

We can express that as:

$$
Hash(A_{\text{tested}})
=
Hash(A_{\text{production}})
$$

That equality removes one major source of uncertainty. You still need production monitoring because:

$$
Environment_{\text{staging}}
\neq
Environment_{\text{production}}
$$

and:

$$
Traffic_{\text{staging}}
\neq
Traffic_{\text{production}}
$$

But at least the artifact itself is controlled. Imagine a production incident. Without artifact promotion, possible causes include:

```text
different source
different build
different dependencies
different model
different package
different configuration
different environment
different data
```

If you know:

$$
Artifact_{\text{staging}}
=
Artifact_{\text{production}}
$$

you can remove several possibilities. You can focus on:

```text
production configuration
production dependencies outside artifact
real traffic/data
scale
infrastructure
external services
```

Good release management is partly about reducing uncertainty. We can now see promotion as:

```text
Source / Training
      ↓
Build
      ↓
Immutable Candidate
      ↓
Automated Evidence
      ↓
Staging Evidence
      ↓
Authorization
      ↓
Production Eligibility
      ↓
Verified Production Deployment
```

Every step answers a question. Build:

What exactly did we create

Identity:

Can we uniquely refer to it

Tests:

Does this exact candidate satisfy technical requirements

Approval:

Is its use authorized

Promotion:

May this candidate enter the next trust boundary

Deployment:

Is it running

Verification:

Is the thing actually running exactly what we intended

Rollback:

Can we restore a previous trusted state

## What Final Principle Makes Artifact Promotion a Chain of Trust?
<!-- section-summary: Promotion converts evidence into controlled authority for an exact release and preserves an auditable, reversible chain of trust. -->

The final trust-chain view explains why promotion is evidence-backed authority rather than file movement.

Artifact promotion is not fundamentally about moving files between folders called:

```text
dev/
staging/
production/
```

It is about maintaining a controlled relationship between:

$$
\text{identity}
+
\text{evidence}
+
\text{authorization}
+
\text{environment}
$$

The central rule is:

$$
\boxed{
\text{Artifact tested}
=
\text{Artifact approved}
=
\text{Artifact deployed}
}
$$

Only its **status, environment binding, and traffic exposure** should change. A strong artifact-promotion system therefore gives you this lifecycle:

```text
BUILD ONCE
    ↓
IMMUTABLE R103
    ↓
TEST R103
    ↓
ATTACH EVIDENCE
    ↓
APPROVE R103
    ↓
PROMOTE R103
    ↓
DEPLOY EXACT R103
    ↓
VERIFY EXACT R103
    ↓
RELEASE TRAFFIC
    ↓
MONITOR
 ┌──┴─────────┐
 │            │
healthy     problem
 │            │
keep          ▼
          restore R102
```

The central definition is:

> **Artifact promotion is the controlled increase in trust and deployment eligibility of an immutable release, based on evidence and authorization, without rebuilding or altering the release itself.**

And the major ideas follow directly from that definition:

$$
\boxed{
\text{Safe Promotion}
=
\text{Immutable Identity}
+
\text{Attached Evidence}
+
\text{Controlled Approval}
+
\text{Atomic State Changes}
+
\text{Environment Separation}
+
\text{Runtime Verification}
+
\text{Retained Rollback}
}
$$

If you can answer **exactly which artifact was tested, exactly which one was approved, exactly which one reached production, and exactly which previous one can be restored**, then artifact promotion is doing its job.

![The complete artifact-promotion path from a pinned candidate through evidence, scoped authorization, atomic desired state, runtime verification, and verified promotion or controlled recovery](/content-assets/articles/article-mlops-mlops-infrastructure-organizing-artifacts-across-environments/artifact-promotion-summary.png)

*Promotion closes only when desired state and observed runtime agree; a mismatch freezes expansion and uses the retained release or repairs the target path.*

## Check Your Answers

Use these answers to revisit the reasoning behind each section.

:::expand[What Does It Mean to Promote an Immutable Artifact with Its Evidence?]{kind="recap"}
Promotion changes an immutable candidate's approved lifecycle state and carries its identity and evidence forward without rebuilding the bytes.
:::

:::expand[How Do Registries, Versions, Aliases, Configuration, Secrets, and Scoped Approval Support Promotion?]{kind="recap"}
A registry coordinates immutable versions and mutable aliases; external versioned configuration and secrets stay controlled; approvals bind identity, scope, and authority.
:::

:::expand[How Do Atomic Release Units, Concurrency, and Policy Protect State Transitions?]{kind="recap"}
The complete release moves atomically under policy and concurrency control so partial or conflicting promotion cannot expose mixed state.
:::

:::expand[How Do Push or Pull Promotion, Partial Traffic, and Post-Promotion Verification Work?]{kind="recap"}
Push and pull mechanisms can promote desired state without immediately sending all traffic, and verification compares observed identity and behaviour with that intent.
:::

:::expand[How Do Rollback, Retention, Restoration, Exceptions, and Signatures Preserve Trust?]{kind="recap"}
Rollback is another promotion of a retained known-good unit; restoration tests, controlled exceptions, expiry, and signatures protect the trust chain.
:::

:::expand[How Does a Promotion State Machine Extend Model Provenance into Release Lineage?]{kind="recap"}
Allowed states and transitions prevent invalid movement and extend training provenance through approval, deployment, and the actual production release.
:::

:::expand[How Does One Release Carry Evidence from Creation to Production?]{kind="recap"}
The end-to-end example shows one identified candidate accumulating tests and approvals while staying byte-for-byte the same across environments.
:::

:::expand[What Final Principle Makes Artifact Promotion a Chain of Trust?]{kind="recap"}
Promotion converts evidence into controlled authority for an exact release and preserves an auditable, reversible chain of trust.
:::
