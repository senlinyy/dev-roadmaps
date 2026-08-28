---
title: "The Delivery Trust Model"
description: "Learn how DevSecOps verifies source, build, artifact, registry, deployment, and runtime evidence across a release path."
overview: "Follow one software release from its source commit to the running workload. Connect exact inputs, human and machine identity, controlled builds, provenance, digests, signatures, registry controls, deployment policy, and runtime evidence into one verifiable chain of custody."
tags: ["devsecops", "trust", "supply-chain", "provenance"]
order: 1
id: article-devsecops-security-foundations-security-mental-model-delivery-systems
aliases:
  - security-mental-model-for-delivery-systems
  - article-devsecops-security-foundations-security-mental-model-delivery-systems
  - devsecops/security-foundations/security-mental-model-for-delivery-systems.md
  - threat-modeling-for-devops-workflows
  - article-devsecops-security-foundations-threat-modeling-devops-workflows
  - devsecops/security-foundations/threat-modeling-for-devops-workflows.md
  - devsecops/security-foundations/01-delivery-trust-model.md
  - devsecops/security-foundations/01-delivery-trust-model
  - security-foundations/01-delivery-trust-model
---

## Table of Contents

1. [Why Must Production Verify the Whole Delivery Chain?](#why-must-production-verify-the-whole-delivery-chain)
2. [What Evidence Turns Delivery Trust into a Verifiable Claim?](#what-evidence-turns-delivery-trust-into-a-verifiable-claim)
3. [How Do Exact Inputs and Strong Identities Start the Chain?](#how-do-exact-inputs-and-strong-identities-start-the-chain)
4. [Why Must the Build Environment Produce Provenance?](#why-must-the-build-environment-produce-provenance)
5. [How Do Digests, Signatures, and Registries Preserve Integrity?](#how-do-digests-signatures-and-registries-preserve-integrity)
6. [How Do Policy and Deployment Verification Make Evidence Operational?](#how-do-policy-and-deployment-verification-make-evidence-operational)
7. [Why Do Runtime Verification and Transitive Trust Still Matter?](#why-do-runtime-verification-and-transitive-trust-still-matter)
8. [How Do You Trace a Release and Strengthen Its Trust Model?](#how-do-you-trace-a-release-and-strengthen-its-trust-model)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

When production receives a software artifact, the first security question is not whether the pipeline displayed a green check. It is why the production system should believe that the arriving bytes are the intended release.

A release crosses several systems:

```text
developer -> source repository -> dependencies -> CI builder
          -> artifact registry -> deployment system -> runtime
```

Every arrow crosses a boundary where trust can be lost. A compromised developer account can submit unwanted source. A package repository can provide a malicious dependency. CI can execute modified build logic. Someone can replace an image after scanning. A deployment path can skip an approval. A correctly deployed container can drift after it starts.

The **Delivery Trust Model** treats trust as a chain-of-custody question. A production artifact is trustworthy only to the extent that verifiable evidence connects its running content to the approved source, inputs, identities, build process, storage path, and deployment decision.

Keep these questions in view as you work through the lesson:

1. **Why Must Production Verify the Whole Delivery Chain?**
2. **What Evidence Turns Delivery Trust into a Verifiable Claim?**
3. **How Do Exact Inputs and Strong Identities Start the Chain?**
4. **Why Must the Build Environment Produce Provenance?**
5. **How Do Digests, Signatures, and Registries Preserve Integrity?**
6. **How Do Policy and Deployment Verification Make Evidence Operational?**
7. **Why Do Runtime Verification and Transitive Trust Still Matter?**
8. **How Do You Trace a Release and Strengthen Its Trust Model?**

## Why Must Production Verify the Whole Delivery Chain?
<!-- section-summary: Production should trust a release only when the complete path from source to runtime supplies evidence that can be verified. -->

Consider a release named `payments-api:2.4.1`. Before running it, production needs more than the name. It needs to identify the source commit and approval, the dependencies and base image, the build workload, the security checks, the resulting content digest, the registry history, the deployment requester, and the workload that is actually running.

The tag is an entry point for humans. Trust belongs to the artifact plus the evidence of how it came to exist.

The same idea can be understood through a restaurant. Source and dependencies are ingredients; repositories are suppliers; developers and CI identities are chefs; the build environment is the kitchen; the workflow is the recipe; security checks resemble inspection; a signed immutable artifact resembles a tamper-evident package; the registry stores it; deployment policy checks it at the door; runtime controls inspect what is finally served.

A sealed package does not help if the kitchen was compromised. A clean kitchen cannot make malicious ingredients safe. Good ingredients do not help if the package is replaced during delivery. Trust must remain supported at every transition.

## What Evidence Turns Delivery Trust into a Verifiable Claim?
<!-- section-summary: Trust is defensible if evidence identifies inputs, actors, build history, artifact content, enforcement decisions, and runtime state. -->

A useful model is:

```text
delivery trust = evidence + verification
```

The evidence set connects several properties:

- **Trusted inputs** identify the exact source, dependencies, tools, and base artifacts.
- **Trusted identity** attributes sensitive actions to authenticated humans or workloads with scoped authority.
- **Trusted build** constrains where and how the artifact is assembled.
- **Provenance** records the source, builder, workflow, inputs, run, and output.
- **Artifact integrity** identifies exact content and reveals substitution.
- **Controlled storage** preserves the artifact and its associated evidence.
- **Deployment verification** evaluates evidence against production policy.
- **Runtime verification** checks whether current execution still matches approved state.

These are connected controls rather than independent badges. An image stored in a company registry proves only its location. A stronger claim says that the exact digest was built from commit `abc123` in an approved repository, through an approved workflow, by an authorized workload, after required checks, and that production verified those facts before starting that digest.

Three questions organize much of the evidence:

| Question | Evidence it needs |
|---|---|
| Who performed the sensitive action? | Authenticated human or workload identity and authorization record |
| Is this the exact object that was approved? | Immutable digest, signature, registry and deployment record |
| Where did this object come from? | Source history, build provenance, inputs and attestations |

Scanning addresses a different question. An image with no known critical vulnerabilities may still be intentionally malicious. Code can exfiltrate data without matching a vulnerability signature. Conversely, a legitimate image can acquire a newly disclosed CVE after release. Vulnerability status and supply-chain origin both matter, but one does not prove the other.

A signature is also a bounded proof. It demonstrates that a particular key or workload identity signed particular content. It does not automatically establish that the signer was authorized to approve this service. Useful trust combines signature validity, signer identity, allowed scope, and policy.

Trust should therefore be specific. “We trust the CI server” is too broad. A scoped statement says that a named release workload may build `acme/payments-api` from a protected source reference through one reviewed workflow and produce production artifacts. That statement can be turned into policy and audited.

## How Do Exact Inputs and Strong Identities Start the Chain?
<!-- section-summary: A trustworthy build begins with precisely identified ingredients and authenticated actors whose permissions match their roles. -->

The obvious build input is application source, but a real build also consumes dependency packages, base images, compilers, package managers, plugins, scripts, operating-system packages, configuration, and infrastructure modules. Every input can affect the bytes that leave the builder.

A mutable reference hides this fact:

```dockerfile
FROM ubuntu:latest
```

The name can resolve to different content tomorrow. A digest reference identifies one base-image object:

```dockerfile
FROM ubuntu@sha256:91fa...
```

Lockfiles, checksums, version constraints, and pinned workflow actions serve the same purpose at other boundaries. They turn an input label into a reviewable identity. Precise identification does not guarantee that the input is safe, but it makes scanning, approval, reproduction, and incident lookup possible.

An SBOM, or Software Bill of Materials, records the components associated with an artifact. It acts as an ingredient list: packages, versions, libraries, files, or other components depending on format and generator. It contributes to trust by making the contents queryable, but it remains evidence rather than a complete decision. The SBOM must describe the exact artifact, be generated at an appropriate point, and be evaluated with other release evidence.

Actors also become inputs to the trust decision. Delivery systems involve both people and machines:

```text
developer opens change
reviewer approves change
CI workload builds release
deployment identity requests promotion
runtime platform admits workload
```

Each sensitive action should answer who acted and what that identity was allowed to do. Human accounts need strong authentication and review boundaries. Machine workloads need distinct identities rather than shared passwords that make every holder indistinguishable.

Long-lived registry or cloud credentials stored as CI secrets increase the value of one leak. Workload identity provides a stronger pattern: the running workflow proves its identity to an issuer, receives short-lived authorization for a narrow operation, and loses that authorization after the run. The identity can also become part of keyless signing evidence.

Least privilege applies to trust itself. The build identity may read the intended source, pull approved inputs, write one repository path, and request an attestation. It should not automatically administer the registry, change branch protection, deploy every service, or impersonate unrelated workflows. Narrow authority reduces what a compromised link can claim or change.

## Why Must the Build Environment Produce Provenance?
<!-- section-summary: A controlled builder records a machine-readable receipt connecting exact inputs and build identity to the output digest. -->

Clean source and dependencies can still produce malicious output when the compiler, runner, workflow, or build host is compromised. The build environment is therefore part of the trusted computing base.

A controlled build commonly starts from an isolated, ephemeral runner. It checks out an approved source revision, resolves pinned inputs, executes a declared build, emits an artifact and evidence, and is then destroyed. Minimal privilege limits the builder's reach. Audit records connect the run to its initiating event and identity. Reproducibility can provide another comparison, but it is not required for understanding the basic trust chain.

Build **provenance** is the structured receipt for this activity. It connects an output such as:

```text
registry.acme.com/payments-api@sha256:8472...
```

to facts such as:

```text
source repository: acme/payments-api
source revision: abc123
builder identity: payments-production-builder
workflow: .github/workflows/release.yml
build invocation: run 9142337112
output digest: sha256:8472...
```

Source control history alone cannot provide this receipt. It records what was committed and reviewed, not what a particular builder actually checked out, what other inputs it resolved, which workflow ran, or which bytes it emitted.

An **attestation** is an authenticated statement about an object. Builders can attest that they produced artifact X from source Y. Scanners can attest that they scanned X. Test systems can attest that X passed a particular test set. SBOM generators can associate a component inventory with X. The artifact becomes the center of a graph of verifiable claims.

```text
                       build provenance
                              |
SBOM ---------------- artifact digest ---------------- test result
                              |
                    vulnerability evidence
```

The claims remain only as strong as the identities that created them and the points at which they were generated. Build provenance should be produced by the build platform that observed the build. A developer-authored text file saying “CI built this” is weaker because it does not independently establish the builder or invocation.

![Delivery trust path infographic showing commit, review, build, digest, registry, deployment gate, and runtime connected by evidence cards](/content-assets/articles/article-devsecops-security-foundations-security-mental-model-delivery-systems/delivery-trust-path.png)

_The path shows that provenance and identity connect source approval to one exact build output._

## How Do Digests, Signatures, and Registries Preserve Integrity?
<!-- section-summary: Digests identify exact content, signatures bind claims to identity, and registry controls preserve chain of custody. -->

A cryptographic hash creates a content fingerprint. Changing an artifact changes its digest with overwhelming probability. This makes:

```text
payments-api@sha256:8472...
```

a stronger deployment identity than:

```text
payments-api:latest
```

A tag is a useful mutable name. A digest identifies exact content. Release records can keep both, but policy should compare the digest named by evidence with the digest requested for deployment.

Signing adds an identity claim. Production can verify that the signature covers the artifact digest and that the signer matches an authorized release identity. Keyless approaches can bind a short-lived CI workload identity to the signing event instead of storing one long-lived private key in the repository.

Neither operation replaces provenance. A digest says which bytes are present. A signature says which identity signed those bytes. Provenance explains how the bytes were produced. Verification policy needs the parts relevant to its trust decision.

The artifact registry becomes a custody boundary. Useful controls include immutable storage, scoped upload and pull permissions, audit logging, scan association, retention rules, and restricted promotion. Artifact evidence must remain associated with the digest it describes.

The safest promotion model builds once and moves the same object through environments:

```text
one build -> digest A -> development -> staging -> production
```

Rebuilding separately for production produces new bytes and requires a new trust argument. Promoting one digest lets the team say that the object tested before release is the object now requested in production.

![Artifact integrity gate infographic showing an image digest checked by attestation, signature, and trusted workflow before production deployment](/content-assets/articles/article-devsecops-security-foundations-security-mental-model-delivery-systems/artifact-integrity-gate.png)

_The gate compares immutable artifact identity with authenticated evidence rather than trusting a tag._

## How Do Policy and Deployment Verification Make Evidence Operational?
<!-- section-summary: Evidence improves security only when production policy evaluates it and blocks artifacts that do not meet explicit requirements. -->

A delivery system can collect SBOMs, signatures, provenance, test reports, scan results, and audit records without changing a single deployment decision. A policy stating what must be true and an enforcement point evaluating it make evidence operational.

```text
deployment request
        |
        v
evidence verification -> policy decision -> allow or deny
```

A production policy for the example service might require all of the following:

- The deployment names an immutable digest.
- A valid attestation covers that same digest.
- The attestation identity is the approved build workload.
- Provenance names the expected repository and protected source revision.
- The reviewed release workflow produced the artifact.
- Required SBOM, test, and vulnerability evidence is associated with the digest.
- Vulnerability findings satisfy the release threshold or an approved exception.

The deployment or admission system checks these facts before execution. Documentation tells people what they should do; enforcement makes the platform refuse evidence that does not meet policy.

This model resists artifact substitution. If someone compromises a registry and replaces a mutable tag, the substituted digest will not match the approved attestation. It also catches a build from the wrong repository or workflow even when that build is signed by some otherwise valid identity.

Verification must compare expectations, not only cryptography. A mathematically valid signature from an attacker-controlled identity is not authorized. A trusted builder can faithfully build the wrong source when external parameters are manipulated. A complete verifier checks signature, signer, subject digest, provenance fields, expected source, build path, and evidence policy.

The trust decision is also scoped. A scanner may be trusted to report vulnerability results, while the build platform is trusted to report provenance. Neither identity should automatically make source-approval claims. Different attesters have authority for different predicates.

## Why Do Runtime Verification and Transitive Trust Still Matter?
<!-- section-summary: Deployment verifies approved state at entry, while runtime controls detect later deviation and trust analysis includes every upstream dependency. -->

Admission is a point-in-time decision. After a valid artifact starts, an actor might change configuration, mount unexpected code, launch a privileged process, alter the filesystem, or create an unapproved network path. The approved state and actual state can diverge.

Runtime verification observes that final boundary. Relevant signals include unexpected processes, binaries, filesystem mutations, privilege escalation, network connections, workloads, or configuration drift. The exact controls depend on the platform, but the trust question remains stable: does current execution still correspond to what production admitted?

Runtime monitoring does not repair an untrusted build. Likewise, perfect build provenance does not observe a later compromise. Delivery and runtime evidence cover different moments in the lifecycle.

Trust is also transitive. If production trusts a CI builder, and that builder trusts source hosting, package repositories, base-image registries, workflow actions, compilers, runner infrastructure, and an identity provider, production depends indirectly on all of them.

```text
production trusts builder
                   |-- source repository
                   |-- package repository
                   |-- base images
                   |-- build actions
                   |-- runner infrastructure
                   `-- identity provider
```

Every dependency expands the attack surface. Reducing unnecessary build plugins, mutable actions, broad credentials, and persistent infrastructure makes the trust graph smaller. Pinning and verification make the remaining edges more explicit.

Trust boundaries are often more useful for threat modeling than pipeline stage names. At every crossing, ask how the receiver identifies the sender, verifies the object, and records origin. Developer to repository, repository to CI, CI to registry, registry to production, and deployment to runtime each need a receiver-side check.

## How Do You Trace a Release and Strengthen Its Trust Model?
<!-- section-summary: Trace one immutable artifact through source, build, storage, deployment, and runtime, then move maturity from belief toward enforced verification. -->

Trace the example release from its beginning. A developer submits commit `abc123` through a protected pull request. The repository records reviewers and the approved revision. An approved CI workload checks out that revision in an isolated runner, resolves precise dependencies, executes the declared workflow, and creates `payments-api@sha256:8472...`.

The builder emits provenance naming the repository, commit, workflow, builder, invocation, and subject digest. It signs or authenticates the attestation through its workload identity. The registry stores the immutable artifact and evidence with controlled access and audit history.

A deployment request names `sha256:8472...`. Production verifies that the subject digest, signer identity, source, workflow, and required evidence match policy. The admitted workload runs the same digest. Runtime monitoring checks meaningful deviations.

This produces a defensible chain:

```text
running workload
  -> exact artifact digest
  -> approved builder identity
  -> provenance for commit abc123
  -> protected source and review
  -> identified dependencies and build inputs
```

The same evidence supports incident response. A responder can begin with a running digest and find its build, source, SBOM, tests, scanner results, deployment decision, and owners. They can also begin with a compromised source revision or builder and query which artifacts and environments were affected.

Maturity develops by replacing implicit belief with stronger evidence and automatic verification:

1. Record what was deployed.
2. Connect the deployment to a source commit.
3. Connect that commit to one artifact digest.
4. Verify the artifact cryptographically.
5. attach authenticated provenance identifying the builder and build path.
6. Enforce production policy over the evidence.
7. Continuously compare runtime with approved state.

A practical first review asks whether every production artifact maps to an exact commit; dependencies and base images are precisely identified; human and machine actors use strong identities; production builds run in controlled, preferably ephemeral CI; provenance identifies source, builder, workflow, inputs, and output; immutable digests anchor evidence; signatures or attestations are verified; the registry enforces custody; one artifact is promoted rather than rebuilt; admission enforces policy; SBOM and scan evidence match the same digest; runtime deviation is observed; and audit records reconstruct the release.

### What Can the Trust Evidence Never Prove by Itself?

Provenance can accurately show that an approved builder produced an artifact from a particular commit and still describe an unsafe release. The reviewed source may contain a malicious instruction. The trusted builder may be compromised. A policy may accept an overly broad signer. Verification may run in audit-only mode and never block. A deployment may verify one digest and then execute a mutable tag.

These are different broken links:

| Broken link | Why apparently valid evidence is insufficient |
|---|---|
| Malicious approved source | Provenance correctly connects the artifact to code that should not have been approved |
| Compromised trusted builder | The authorized platform can emit unwanted bytes and valid-looking build evidence |
| Weak signer policy | A valid signature from an unrelated identity is accepted |
| Missing enforcement | Evidence is collected but no gate changes the deployment decision |
| Mutable execution reference | The checked object and the pulled object can differ |

The trust model therefore composes source protection, builder isolation, authenticated claims, exact artifact identity, policy, enforcement, and runtime observation. Strength in one link does not cancel a missing link elsewhere.

Reproducible builds provide another kind of evidence. Independent builders can run the same declared inputs and compare outputs. Matching results reduce the chance that one hidden build variation changed the artifact. Provenance and reproducibility remain different: provenance records what one build did, while reproducibility tests whether another build can produce the same result.

Attestation storage also matters. Baking provenance into the artifact it describes changes that artifact's digest and creates a circular identity problem. Container ecosystems can store attestations as related OCI objects; other systems can keep them in an evidence store or transparency service. Whatever the mechanism, the subject digest must remain joined to its claims through retention, replication, and promotion.

Transparency adds public or append-oriented evidence that a signing event occurred. It can make later deletion or hidden issuance harder, but it does not decide whether the signer was authorized. The verifier still applies local trust policy.

### How Does Trust Scope Limit a Builder's Authority?

A build identity should be authorized for a bounded statement. The payments release builder can claim that it built a payments artifact through its reviewed workflow. It should not automatically sign payroll artifacts, approve source reviews, or attest to tests it did not run. This keeps compromise of one attester from creating convincing evidence for every system.

The same scoping applies to external parameters. A trusted builder can faithfully execute an unsafe request when an attacker changes the repository, ref, workflow input, or dependency location. Provenance must record those parameters, and deployment policy must compare them with what the service allows.

Trust analysis consequently follows both objects and authorities. The object path asks whether source, artifact, stored digest, deployment request, and running workload match. The authority path asks whether each human, workflow, builder, scanner, signer, promoter, and runtime controller had permission for that exact claim or action.

When both paths can be reconstructed, the organization can move from “our normal pipeline probably produced this” to an independently checkable release argument.

![Release evidence summary infographic showing commit SHA, PR review, workflow run, image digest, deployment record, and running pods connected to one approved release](/content-assets/articles/article-devsecops-security-foundations-security-mental-model-delivery-systems/release-evidence-summary.png)

_The summary connects one running workload back through its immutable release evidence._

## Check Your Answers

:::expand[Why Must Production Verify the Whole Delivery Chain?]{kind="recap"}
Trust belongs to an artifact and the verifiable history that moved it from approved source to current runtime.
:::

:::expand[What Evidence Turns Delivery Trust into a Verifiable Claim?]{kind="recap"}
Inputs, identities, build history, immutable content, enforcement decisions, and runtime state support different parts of the claim.
:::

:::expand[How Do Exact Inputs and Strong Identities Start the Chain?]{kind="recap"}
Pin every meaningful input and attribute sensitive actions to authenticated humans or narrowly authorized workloads.
:::

:::expand[Why Must the Build Environment Produce Provenance?]{kind="recap"}
A controlled builder should record an authenticated receipt linking source, inputs, workflow, invocation, identity, and output digest.
:::

:::expand[How Do Digests, Signatures, and Registries Preserve Integrity?]{kind="recap"}
Digests name exact bytes, signatures bind claims to identity, and registry controls preserve the artifact-evidence association.
:::

:::expand[How Do Policy and Deployment Verification Make Evidence Operational?]{kind="recap"}
Production must compare authenticated evidence with explicit expectations and deny artifacts that do not satisfy them.
:::

:::expand[Why Do Runtime Verification and Transitive Trust Still Matter?]{kind="recap"}
Runtime can drift after admission, and production inherits risk from every source, tool, service, and identity trusted by its builder.
:::

:::expand[How Do You Trace a Release and Strengthen Its Trust Model?]{kind="recap"}
Anchor the trace on one digest, follow evidence backward to source and forward to runtime, then automate the resulting policy checks.
:::

## References

- [SLSA supply-chain security framework](https://slsa.dev/) - Defines progressively stronger integrity guarantees for software artifacts and build systems.
- [in-toto attestation framework](https://in-toto.io/) - Defines verifiable statements about software supply-chain steps and artifacts.
- [Sigstore documentation](https://docs.sigstore.dev/) - Documents identity-based signing, verification, and transparency services.
- [CycloneDX specification](https://cyclonedx.org/specification/overview/) - Defines a standard format for software bills of materials and related supply-chain data.
- [SPDX specifications](https://spdx.dev/use/specifications/) - Defines SPDX formats for software component and licensing information.
