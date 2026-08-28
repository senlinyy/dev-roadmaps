---
title: "Build Provenance and Attestations"
description: "Learn how artifact digests, in-toto Statements, SLSA provenance, authenticated attestations, builder identity, storage, and deployment verification establish software origin."
overview: "Start with the bytes you actually deploy and ask where they came from. Separate inventory, digest, signature, provenance, and attestation; read the in-toto Statement and SLSA build model; bind source, resolved dependencies, builder, run, and subject; authenticate claims with workload identity; store an evidence graph; and enforce deployment expectations without confusing signed evidence with safe source or a trustworthy builder."
tags: ["devsecops", "provenance", "attestations", "slsa"]
order: 3
id: article-devsecops-software-supply-chain-build-provenance-attestations
---

## Table of Contents

1. [Why Does a Deployed Artifact Need Provenance?](#why-does-a-deployed-artifact-need-provenance)
2. [How Does an in-toto Attestation Describe a Claim?](#how-does-an-in-toto-attestation-describe-a-claim)
3. [What Does SLSA Provenance Record About a Build?](#what-does-slsa-provenance-record-about-a-build)
4. [How Is Provenance Authenticated Without a Long-Lived Signing Secret?](#how-is-provenance-authenticated-without-a-long-lived-signing-secret)
5. [How Does Verification Turn Provenance into a Deployment Control?](#how-does-verification-turn-provenance-into-a-deployment-control)
6. [How Do Attestations Form a Searchable Evidence Graph?](#how-do-attestations-form-a-searchable-evidence-graph)
7. [What Determines the Strength and Limits of Provenance?](#what-determines-the-strength-and-limits-of-provenance)
8. [What Does a Production Provenance Workflow Look Like?](#what-does-a-production-provenance-workflow-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Start with the object that production actually runs: a container image, package, binary, archive, or firmware bundle. Source control may contain reviewed code, but production does not execute a pull-request page. It executes bytes produced by a build.

The first supply-chain question is:

```text
Where did these exact bytes come from?
```

**Build provenance** is evidence about an artifact's origin and production process. It can connect an artifact digest to the source repository and revision, build workflow, builder identity, resolved dependencies, invocation, and time.

Inventory and provenance solve different mysteries. An SBOM or package inventory can answer what components an artifact contains. Provenance answers how this artifact was produced and from which inputs. During an incident, one may reveal that library X is present; the other can reveal which builder and source revision created every affected release.

Source history is not enough. Reviewed commit C might exist while a developer builds different local content, a compromised runner substitutes output, a mutable dependency resolves differently, or an attacker uploads unrelated bytes under the expected tag. The repository proves what happened to source. It does not, by itself, bind production bytes to that source.

Keep these questions in view as you work through the lesson:

1. **Why Does a Deployed Artifact Need Provenance?**
2. **How Does an in-toto Attestation Describe a Claim?**
3. **What Does SLSA Provenance Record About a Build?**
4. **How Is Provenance Authenticated Without a Long-Lived Signing Secret?**
5. **How Does Verification Turn Provenance into a Deployment Control?**
6. **How Do Attestations Form a Searchable Evidence Graph?**
7. **What Determines the Strength and Limits of Provenance?**
8. **What Does a Production Provenance Workflow Look Like?**

## Why Does a Deployed Artifact Need Provenance?
<!-- section-summary: Provenance connects one immutable artifact subject to the source, resolved inputs, build process, builder identity, and invocation that created its bytes. -->

A cryptographic digest is necessary because it gives exact artifact identity:

```text
artifact bytes -> sha256:D
```

If one byte changes, the digest changes. Tags such as `v1.4` or `latest` and filenames such as `service.tar.gz` are useful human labels but can point to different content over time. Provenance should name the digest as its **subject**.

A digest alone does not establish origin. Anyone can hash malicious bytes. A digital signature establishes that an identity-controlled key made a claim over the digest or attestation, but a valid signature does not explain the claim or decide whether the signer was authorized.

An **attestation** is an authenticated statement about a subject. The claim could say that artifact D was built from commit C by builder B, that an SBOM S describes D, or that a scanner evaluated D under policy P. **Provenance** is one kind of claim; **attestation** is the authenticated envelope and statement structure used to carry it.

```text
artifact digest -> exact object
provenance      -> origin and build facts
attestation     -> authenticated claim about the object
policy          -> which claims and identities are acceptable
```

The distinction prevents vague language such as “the artifact has provenance” from hiding whether the evidence is authenticated, who produced it, or what it actually states.

Imagine two container images with the same application version label. One was built on the approved CI service from the reviewed merge commit. The other was built on a laptop from a modified working tree and uploaded under the same label. Source history and the tag look familiar in both cases. A provenance record bound to each digest distinguishes their origins.

The artifact is the stable center of the model. Build logs can expire, branches move, workflow files change, and people leave. If the production inventory preserves digest D, responders can ask which provenance applies to D and then follow its recorded identifiers back to the historical event.

Inventory can say “production runs D.” Provenance can say “B produced D from C.” Neither alone proves that C passed review, B was uncompromised, or production currently matches the inventory. Those are separate claims supplied by source controls, builder security, deployment evidence, and runtime observation. Strong supply-chain assurance joins them without letting one record pretend to answer every question.

Hashes also support comparison across systems. The build service, registry, scanner, signer, deployment controller, and runtime can all name the same digest without sharing a mutable database ID. This common coordinate turns independent evidence into a chain. When any stage names a different digest, the mismatch is explicit.

Signatures should likewise be interpreted narrowly. A signature binds an identity-controlled signing operation to bytes. It does not say whether those bytes are an artifact, an attestation, or arbitrary text until the signed format and policy supply that meaning. Provenance makes the claim structured; authentication makes later alteration detectable; policy supplies authorization.

## How Does an in-toto Attestation Describe a Claim?
<!-- section-summary: An in-toto Statement gives attestations a common structure with a document type, immutable subject, predicate type, and predicate containing the claim. -->

The in-toto Statement provides a common shape for supply-chain attestations. A simplified statement looks like:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    {
      "name": "registry.example.test/parcelpulse/api",
      "digest": {
        "sha256": "a8219f..."
      }
    }
  ],
  "predicateType": "https://slsa.dev/provenance/v1",
  "predicate": {
    "...": "the SLSA provenance claim"
  }
}
```

`_type` says which statement language and schema this document follows. A verifier should not guess structure from convenient field names. Explicit type allows tools to reject an unknown or malformed envelope.

`subject` identifies what the statement is about. It can contain one or more named objects with cryptographic digests. The digest is the decisive join. If production requests digest D2 while the attestation names D1, the claim does not apply.

`predicateType` identifies the kind of claim. SLSA provenance has one type; an SBOM, vulnerability scan, test result, or policy claim may have another. A valid attestation of type X should not satisfy policy requiring type Y.

`predicate` contains the actual claim in the schema named by `predicateType`. For SLSA provenance, it describes build definition and invocation details. For an SBOM-related attestation, it may identify or embed a component document. The Statement creates a shared outer grammar without forcing every claim to have the same inner fields.

![Attestation anatomy separates the in-toto subject, predicate type, and SLSA predicate into exact artifact and build claims](/content-assets/articles/article-devsecops-software-supply-chain-build-provenance-attestations/attestation-anatomy.png)

_The subject answers “which object?”, the predicate type answers “which kind of claim?”, and the predicate carries the claim itself._

The Statement still needs authentication. An unsigned JSON file can be edited by anyone with storage access. A signature or authenticated envelope binds an identity to the statement bytes and lets a verifier check integrity.

Authentication does not automatically authorize the identity. A valid statement from a developer laptop may be useful for debugging but should not necessarily satisfy production policy. The verifier evaluates signer or workload identity, issuer, repository, workflow, builder, subject, and claim type against expected rules.

The subject should remain external to the artifact it describes. Baking provenance only inside a container creates circular and weak evidence: replacing the artifact replaces the embedded claim, and discovering the claim requires trusting or running the object. Store attestations alongside or associated with the digest through a registry or evidence service.

Names provide context, but policy should converge on immutable identity. A statement can call an object `api:v1`; the digest ensures that the claim cannot silently follow the tag when it moves.

Multiple subjects are possible when one invocation produces several related outputs. Policy should decide whether the claim covers a platform-specific binary, archive, manifest, or multi-platform image index and should verify the exact subject selected for deployment. Do not assume that evidence for one child image covers a different index or package.

The statement's type fields prevent semantic substitution. An attacker should not satisfy a provenance requirement by presenting a valid SBOM attestation for the same digest. Both are authenticated statements, but their predicates make different claims. The verifier must request the type needed for the decision.

The predicate can evolve independently of the outer Statement. A tool that supports in-toto Statement v1 may still need to understand SLSA provenance v1 fields before it can evaluate repository, builder, or invocation expectations. Unknown predicate versions should not be treated as equivalent merely because the signature verifies.

Authentication normally covers a canonical or defined representation of the statement so changing its subject, type, or predicate invalidates verification. Storage systems must preserve the signed bytes or envelope and the identity material needed later. Reconstructing “equivalent JSON” from a database risks losing the object that was actually authenticated.

An attestation may be correct but irrelevant. A developer can truthfully attest that their laptop built digest D from local source. Production policy can reject it because the attester and builder are not approved for production. Trust decisions remain contextual rather than labeling attestations globally good or bad.

The same outer structure lets systems compose claims without one enormous schema. A builder emits provenance. An SBOM generator emits component evidence. A scanner emits findings. Each attester stays responsible for the facts it can observe, and policy combines them at the transition where they matter.

## What Does SLSA Provenance Record About a Build?
<!-- section-summary: SLSA provenance separates the intended build definition from the observed invocation and records external parameters, resolved dependencies, builder identity, run details, and the resulting artifact subject. -->

SLSA provenance derives evidence from the build event. Its model separates what build was defined from what happened during one run.

A simplified structure is:

```json
{
  "buildDefinition": {
    "buildType": "https://example.test/buildtypes/container/v1",
    "externalParameters": {
      "repository": "https://github.com/parcelpulse/api",
      "ref": "refs/heads/main"
    },
    "internalParameters": {
      "runnerImage": "builder-image@sha256:..."
    },
    "resolvedDependencies": [
      {
        "uri": "git+https://github.com/parcelpulse/api@...",
        "digest": { "gitCommit": "3f92c8a..." }
      }
    ]
  },
  "runDetails": {
    "builder": {
      "id": "https://github.com/parcelpulse/api/.github/workflows/build.yml@refs/heads/main"
    },
    "metadata": {
      "invocationId": "run-18429",
      "startedOn": "2026-08-25T14:31:00Z",
      "finishedOn": "2026-08-25T14:37:00Z"
    }
  }
}
```

`buildDefinition` describes what build was supposed to happen. `buildType` identifies the build process or contract. A verifier can apply different expectations to a container build, package build, or release workflow rather than treating any JSON with a repository field as equivalent.

**External parameters** are inputs that the caller can influence: repository, source ref, target platform, release option, build argument, or manually supplied value. They are security-sensitive because a trusted builder can faithfully build the wrong thing. A workflow may be approved, but an attacker could request an unreviewed repository, branch, Dockerfile, or release target if input validation is broad.

Provenance should record those parameters so verification can reject unexpected values. Production policy can require the ParcelPulse repository, protected source reference, approved build definition, and permitted release configuration.

**Resolved dependencies** record what mutable names became during the build. `main` is a moving name; commit `3f92c8a...` is the resolved source revision. A package version range, base-image tag, or tool reference may similarly resolve to an exact version or digest. Recording resolution makes the run reconstructable and helps expose substitution.

Source revision is security evidence, not decoration. It joins provenance with source review, required checks, ownership, and branch protection. If the recorded revision differs from the reviewed release commit, the chain fails even when the artifact was created by an approved builder.

**Internal parameters** describe builder-controlled details such as runner image, worker configuration, or invocation features that the external caller did not choose directly. These fields can help investigate behavior, but their trust follows the build platform that reports them.

`runDetails` describes the actual invocation. **Builder identity** is one of the most important fields. It should identify the controlled build service or workflow responsible for the claim, not merely a generic organization name. Policy can distinguish the approved release workflow from a developer-created workflow in the same repository.

The builder is not necessarily the signer. A build platform may create provenance and another attestation service may authenticate it. Verification must decide whether the signer was authorized to speak for that builder and whether the recorded builder identity is itself protected.

Invocation IDs and timestamps help correlate source, runner, logs, registry uploads, and deployments. Time alone is not a secure join, but it supports investigation when combined with immutable identities.

Put together, the claim says:

```text
builder B ran build type T
with external parameters E
after resolving dependencies to R
during invocation I
and produced subject digest D
```

The subject D closes the loop between build facts and deployable bytes.

External parameters deserve a threat model of their own. A generic workflow may accept `repository`, `ref`, `dockerfile`, `target`, `buildArgs`, and `registry`. If the production builder identity is trusted regardless of those values, a caller can ask it to build a different repository or use a Dockerfile that downloads attacker content. Provenance reveals the request, but verification must reject values outside the allowed production definition.

Defaults also matter. An omitted parameter may resolve through workflow configuration, environment, or platform policy. The provenance model distinguishes what the caller supplied from internal builder behavior, but the implementation must record enough information for a verifier to understand the effective build. A field absent from evidence can become an ambiguity rather than proof of a safe default.

Resolved dependencies are a snapshot of name resolution at invocation time. For source, record the immutable commit. For a base image, record the digest selected from the tag. For a reusable build tool, record its version or digest. If the build reads a mutable remote script without recording its identity, provenance may be incomplete even when the source revision is precise.

Materials can include more than application source. Build configuration, submodules, compiler toolchains, generated inputs, patches, and base images can affect output. The exact representation depends on build type and available tooling, but the principle is that security-relevant resolved inputs should not remain hidden behind moving names.

Internal parameters are not automatically secret or trustworthy. They are parameters controlled by the build platform rather than the external caller. If the platform is compromised, it can lie about them. Some internal details may also be unsuitable for broad publication. Evidence design should record what supports verification and investigation without exposing credentials.

Builder identity should be stable enough for policy and specific enough for separation. “CI” is too broad when any repository can create a workflow. A workflow path and protected ref can distinguish the production build from an experimental job. A platform-level builder identifier can distinguish isolated managed generation from a statement created inside ordinary user steps.

Invocation identity links the abstract claim to operational evidence. Run `18429` can locate runner logs, OIDC claims, checkout event, artifact upload, and failure details. Timestamps help order events and identify compromise windows, but run ID and digest provide stronger joins than temporal proximity.

The provenance predicate should describe the build that actually produced the subject. Generating a template before the build and later inserting a digest can miss resolved inputs or final parameters. Reconstructing provenance days later from release labels risks recording intention rather than execution. Generate it as part of the controlled build service while the facts are authoritative.

One build can have legitimate nondeterminism such as timestamps or randomized archives. Provenance does not require reproducibility, but it should not claim a subject produced by a different invocation. Each output digest maps to the run that created it.

## How Is Provenance Authenticated Without a Long-Lived Signing Secret?
<!-- section-summary: Workload identity lets a protected CI invocation authenticate its attestation with short-lived contextual credentials instead of exposing a permanent production signing key to ordinary build code. -->

An identity signing or otherwise protecting the Statement turns provenance into an authenticated attestation. A traditional design can keep a private key and use it to sign build evidence. That makes the key highly valuable: anyone who obtains it may create provenance that appears to come from the trusted signer.

Placing a production signing key inside the ordinary build environment is dangerous. Repository code, dependencies, actions, or a compromised runner can read or use it. A malicious build does not need to extract the bytes; it can ask the signing operation to authenticate a false statement while the key is available.

The signing operation should occur at a trust boundary. The controlled platform observes the source, workflow, builder, and output digest, constructs the claim at the point where those facts are known, and authenticates it through an identity unavailable to arbitrary build steps.

Workload identity improves this model. A protected CI job obtains a short-lived OIDC assertion containing repository, workflow, ref, and environment context. An attestation service or certificate authority validates those claims and binds an ephemeral signing credential to the workload identity. The credential expires after the run, removing a permanent signing secret from CI.

```text
approved CI invocation
      -> signed OIDC workload assertion
      -> identity validation
      -> ephemeral signing identity
      -> authenticated attestation for digest D
```

Short life reduces theft persistence. It does not make an overbroad identity safe. Trust policy must still restrict which repository, workflow, source context, and issuer may create production provenance. If every workflow can obtain the same attester identity, a malicious workflow can create valid signed garbage.

GitHub artifact attestations illustrate the platform model. A workflow can create an attestation for an artifact and associate it with repository and workflow identity. Verification can check the subject digest and expected source owner or repository, depending on the command and policy used.

The valuable claim is not merely “GitHub signed this.” The verifier asks which issuer, repository, workflow, ref, and builder context produced the attestation, and whether those values match the protected production path.

The workflow file controlling attestation generation must be protected. If an attacker can edit it and obtain the same workload identity, authentication succeeds for attacker-chosen bytes. Branch rules, CODEOWNERS, token boundaries, ephemeral runners, and build isolation strengthen the evidence before signing.

Attestation creation should happen at the point of truth. The build service knows the resolved source and output digest. The scanner knows the rule set and examined digest. A deployment controller knows the target and result. Having a later generic script reconstruct all claims from user-supplied text weakens their connection to reality.

Authentication records should be observable. Preserve issuer, subject or workload claims, certificate or signature details, invocation, and verification outcome without relying on a secret key identifier alone.

Long-lived signing keys create lifecycle questions: generation, storage, access, rotation, backup, recovery, revocation, and historical verification. A hardware-backed or isolated signing service can reduce exposure, but build code still needs a controlled authorization path to request a signature. If every job can ask the service to sign any digest, extraction resistance does not prevent abuse.

Workload identity replaces key distribution with claim validation. The attestation service trusts an issuer and accepts only assertions whose repository, workflow, source context, and audience match policy. It then produces a certificate or signed record connecting an ephemeral public key to that identity. The private key exists briefly for one workload instead of being shared across releases.

This improves attribution. An investigation can see which repository and workflow identity produced the statement rather than only a generic key named `ci-signing`. It also makes revocation different: responders can revoke or distrust an issuer, builder, workflow, or identity pattern rather than rotate a secret copied into many systems.

OIDC claims must be interpreted carefully. A branch name can be recreated, an environment name may be unprotected, and a reusable workflow can change. The trust policy should require claims whose governance matches the desired assurance and should protect the configuration that determines those claims.

GitHub attestation creation needs token permission to request identity and publish the resulting evidence. Give that permission only to the job that knows the final artifact subject. Earlier tests and dependency installation do not need attestation authority. Isolating the step reduces the amount of code capable of making authenticated production claims.

A caller can also attest a file or binary rather than a registry image. Verification must compute or obtain the same subject digest and evaluate source identity. Copying or renaming the file does not change the digest; rebuilding it does.

Keyless does not mean identityless or key-free. An ephemeral key and certificate still exist, and the verifier still relies on an issuer, certificate authority, identity claims, and sometimes transparency evidence. “Keyless” removes long-term private-key custody from the user workflow; it does not remove cryptographic trust roots.

## How Does Verification Turn Provenance into a Deployment Control?
<!-- section-summary: Verification checks cryptographic integrity first, then enforces expected subject, claim type, issuer, repository, workflow, source revision, builder, and policy before deployment. -->

Attestations create security value when a verifier uses them to decide a protected transition. Storing a signed file without enforcement provides investigation evidence but does not prevent substitution.

Verification step one checks cryptographic validity and integrity. Was the attestation altered, and does the authenticated identity verify under the expected trust roots? A valid signature is necessary, not sufficient.

Deployment policy should then check:

- The artifact requested for deployment has digest D.
- The attestation subject is exactly D.
- The statement and predicate types are expected.
- The issuer or trust root is approved.
- The workload identity names the approved owner, repository, and workflow.
- SLSA builder identity matches the controlled builder.
- Resolved source revision is the reviewed release revision.
- External parameters name permitted source and build targets.
- Required evidence is fresh and not revoked or superseded.

![Provenance gate compares deployment subject, attestation, repository, workflow, revision, and builder policy before allow or block](/content-assets/articles/article-devsecops-software-supply-chain-build-provenance-attestations/provenance-gate.png)

_Cryptographic validity authenticates the claim; deployment policy decides whether this claim and identity authorize this digest._

This defeats an important substitution attack. Suppose an attacker can write to the registry and replaces `api:v1.4` with malicious digest M. Deployment resolves the tag to M. Existing provenance names approved digest D, so subject verification fails. The attacker would also need an authorized attester to create acceptable evidence for M.

Provenance also catches “built from the wrong source.” An authorized builder might be invoked with an unreviewed branch or attacker repository. The signature and builder check can pass, but the recorded external parameter or resolved dependency violates source policy.

Build once and deploy by digest. Release tags should not be the trust root. They help people select a release, but the verifier must resolve the tag and evaluate the actual digest.

Source controls reinforce provenance. CODEOWNERS, required checks, protected branches, runner isolation, dependency pinning, and workload identity make the recorded inputs and builder more trustworthy. Provenance then connects their evidence to the artifact.

```text
reviewed source and workflow
      -> controlled builder
      -> authenticated provenance for digest D
      -> deployment verification
      -> runtime uses D
```

Policy needs failure behavior. If the attestation is absent, signature validation fails, the subject differs, or the identity is unexpected, sensitive deployment should reject rather than treat missing evidence as success. Define a narrow break-glass path for genuine emergencies and record which checks were bypassed.

Verification should produce evidence: requested digest, located attestations, identity and claim checks, policy version, decision, time, and deployment request. This supports incident response and reveals a verifier that was silently disabled.

Valid signature is only the first step because several signed claims may exist for one digest. A developer, test workflow, production builder, and attacker-controlled repository can all create cryptographically valid statements under their own identities. Authorization selects the identity and claim context accepted for this environment.

Use positive allow conditions rather than only a denylist of known bad identities. Require the expected issuer, repository owner, repository, workflow, and builder. Check the source revision against the approved release record. A broadly valid identity domain such as “any workflow from our organization” can let a lower-trust repository become a production attester.

Artifact substitution can occur after verification if the deployer verifies tag `v1` while the platform later pulls whatever `v1` names. Resolve the tag once, verify that digest, and pass the digest into deployment. Runtime policy can recheck the resolved image so the verified object and executed object remain identical.

Wrong-source protection needs more than a repository name. If policy accepts any branch in the repository, a feature branch can produce valid provenance. Require the protected revision, release tag policy, or an external release record joining the source commit to approvals and required checks.

Wrong-builder protection matters when several workflows produce similar artifacts. An experimental developer-controlled workflow may run in the approved repository. Require the production build identity, and protect its workflow file and runner environment.

Verification can happen at CI promotion, registry import, deployment controller, or runtime admission. Earlier checks give faster feedback. Enforcement closest to execution prevents an alternate deployment client from bypassing CI. Higher assurance often repeats verification at more than one boundary while using the same digest and policy source.

Availability policy is part of security. If the evidence store or issuer metadata is unavailable, decide whether production fails closed, uses a recent trusted cache, or invokes break-glass. Silent fail-open behavior converts an outage into a supply-chain bypass. The choice can vary by environment and consequence, but it must be deliberate and observable.

## How Do Attestations Form a Searchable Evidence Graph?
<!-- section-summary: Digest-linked attestations can connect provenance, SBOMs, scans, tests, signing, deployment, and runtime state when storage preserves subject association and authorized attester identity. -->

One artifact can have several statements:

```text
artifact digest D
  -> SLSA provenance from builder B
  -> SBOM claim from generator G
  -> vulnerability scan from scanner S
  -> test result from workflow T
  -> deployment event to environment E
```

This is an evidence graph, not a pile of unrelated files. Each edge states which identity made which kind of claim about which subject.

An SBOM can itself be attested. The attestation may bind SBOM document S to artifact D and identify the generator. A scan attestation can state that scanner version V evaluated D against database snapshot N under policy P. These claims age differently while the artifact digest remains stable.

Storage must preserve the artifact-attestation association. OCI registries are a natural location for container-related artifacts because referrer mechanisms can associate signatures, provenance, and SBOMs with a digest. Other evidence stores can work when they retain immutable subjects, claim types, identity, and lookup.

Do not rely only on the artifact carrying its own evidence. External association lets a verifier discover claims without executing the object and prevents replacement of the object from automatically replacing the trusted record.

Retention matters. If the artifact remains in production after CI deletes its attestation, future verification and incident response fail. Preserve evidence for the release and investigation lifecycle, and define how deletion, garbage collection, and artifact replication handle associated records.

Transparency logs solve another problem: they make signed events discoverable and difficult to hide or backdate without evidence. A log does not make a bad signature good, and public transparency is not a secret database. It improves auditability and key-compromise investigation by showing that a signing event existed.

The value of an attestation depends on the attester. A build platform is authoritative for build invocation facts. A scanner is authoritative for what its analysis observed. A deployment controller is authoritative for what it attempted. A developer should not necessarily be trusted to attest that their own local build satisfies production policy.

Different attesters should be trusted for different statement types. An approved SBOM generator may describe components but cannot authorize deployment. A provenance builder may state origin but cannot decide that vulnerabilities are acceptable. Policy composes evidence from identities with bounded roles.

The graph supports reverse queries. Starting from a compromised builder, find every artifact it produced and environment that received them. Starting from a source revision, find builds and subjects. Starting from a digest, find provenance, SBOM, scans, deployments, and current runtime.

Storage should support those joins by digest, invocation, source revision, builder, and claim type rather than only by mutable release name.

Attestations can reference other evidence rather than embed everything. An SBOM attestation may identify the SBOM digest stored as an OCI artifact. A scan claim may identify a report and database version. These additional objects also need integrity and retention so the graph does not end in missing or mutable documents.

Evidence graphs benefit from consistent coordinates. Artifact digest joins build, SBOM, scan, signature, deployment, and runtime. Source commit joins provenance to pull request and review. Invocation ID joins provenance to CI logs. Environment and deployment ID join the release to operational reality.

Replication and garbage collection can break associations. Copying an image to another registry without its referrers may leave provenance behind. Deleting an untagged manifest may also delete attestations still required for a running deployment. Registry operations should preserve the evidence set or record a trustworthy mapping to the destination digest.

Access control differs for producing, reading, and deleting evidence. Build identities create particular claims. Verifiers need read access. Few administrators should delete or rewrite associations. Audit destructive operations because removing an unfavorable attestation can be as meaningful as adding a false one.

Transparency can show that a signing event was recorded, but sensitive internal source names, identity claims, or artifact metadata may need privacy analysis before public logging. Transparency systems are designed for append-oriented public evidence, not secret storage. Choose what is logged and where full internal claims remain available.

Evidence can disagree. Two scanners may report different findings, or provenance and registry upload time may not match expected order. Preserve the disagreement and let policy or triage resolve it. Replacing several claims with one summary “PASS” loses useful context.

The graph should also preserve negative and exception decisions. If a vulnerability finding was accepted temporarily, link the exception, owner, expiry, and compensating control to the artifact and deployment. Provenance answers origin; it should not erase later risk decisions.

## What Determines the Strength and Limits of Provenance?
<!-- section-summary: Provenance strength depends on who observes and authenticates build facts, how isolated and protected the builder is, and whether verification enforces the claim; detailed signed text cannot compensate for an untrusted attester. -->

Not all provenance has equal strength. A developer-run script can write a detailed JSON document saying that a local artifact came from `main`. If the same developer controls the inputs, output, statement, and signing key, the evidence may be self-asserted.

A controlled build platform can observe source resolution, invocation, builder image, and output, then generate evidence outside the build step's direct control. That separation makes falsification harder. SLSA assurance levels are fundamentally about strength of build and provenance properties, not how many fields appear in the document.

Builder identity often matters more than provenance verbosity. A short authenticated statement from an isolated approved builder can be stronger than pages of fields produced by an untrusted script. Ask who could cause the builder to say something false, modify the output after measurement, or obtain the attester identity.

Reproducibility and provenance are related but different. Provenance records how one artifact was produced. Reproducibility asks whether independent builds from the same inputs create the same result. Reproducibility can help detect unexpected variation, but many legitimate builds are not bit-for-bit reproducible. Provenance remains useful even then.

Beware **signed garbage**. A signature proves an identity made a claim. If a trusted workflow accepts arbitrary source or lets proposed code choose the artifact subject, it can faithfully sign malicious bytes. Authorization must validate inputs and protect workflow control.

Trust is transitive:

```text
trust artifact D
because provenance says builder B made it
because attestation identity I speaks for B
because issuer and workflow claims are trusted
because repository, branch, runner, and policy are protected
```

Every link can fail.

Provenance cannot save the system from malicious reviewed source. It can accurately prove that the approved builder built the malicious commit. It cannot save a compromised trusted builder that changes output while emitting expected claims unless other controls detect the compromise. It cannot help when verification policy is weak, when verification is not enforced, or when deployment ignores the verified digest and uses a mutable tag.

The source, builder, attester, verifier, registry, and deployment controller form a chain of custody. Strength comes from independent, protected roles and object-bound evidence across the chain.

Review evidence freshness and revocation. If an attester identity or builder is compromised, historical claims need investigation. Transparency, invocation records, builder versions, and release mappings help identify the affected interval.

Provenance created entirely by a developer script is weaker not because developers are inherently untrusted, but because the same principal can choose input, change output, write the claim, and authenticate it. Independent observation reduces opportunities to falsify the relationship. The stronger architecture separates source approval, build execution, attestation generation, and deployment verification.

Builder isolation protects claim accuracy. If untrusted build code can modify the provenance generator or intercept its output, the record may describe intention rather than actual behavior. Generate core facts in the build platform control plane or another protected component that observes the sandbox from outside.

Attester scope should be narrow. The builder can attest to build facts it observed, but it should not attest that the source was secure, that every vulnerability is acceptable, or that production deployment succeeded. Those claims belong to reviewers, scanners, risk owners, and deployers with their own evidence.

SLSA evidence strength increases when provenance is generated by the build platform, authenticated, resistant to tampering by user build steps, and tied to an isolated builder. The label or level is useful only when its underlying properties are actually implemented and verified.

Reproducible builds can cross-check provenance. If two independent trusted builders from the same resolved inputs produce D, confidence in hidden build manipulation improves. If they differ, investigate nondeterminism, toolchain, environment, or compromise. Non-reproducibility does not invalidate provenance, but it removes this comparison signal.

Malicious reviewed source illustrates an assurance boundary. Provenance can provide excellent chain of custody for harmful code. Code review, testing, scanning, and product security must prevent or detect the source issue. Provenance makes accountability clearer; it does not judge program intent.

A compromised trusted builder is more difficult. It can emit malicious bytes and false build facts if it controls both execution and attestation. Builder hardening, isolation, ephemeral workers, protected control plane, reproducibility, independent scanning, and monitoring reduce this risk. Provenance helps identify every output from the affected builder once compromise is known.

Weak verification policy can accept valid but irrelevant evidence. Verification not enforced can leave perfect attestations unused. A mutable deployment reference can substitute bytes after a successful check. These failures show why evidence generation, policy, enforcement, and exact subject deployment are separate necessary controls.

## What Does a Production Provenance Workflow Look Like?
<!-- section-summary: A production path resolves protected source, builds once on an approved builder, creates authenticated subject-bound evidence, stores it with the artifact, verifies policy before deployment, and records runtime identity. -->

A practical production model is:

1. Protected source control accepts a reviewed revision.
2. An approved workflow resolves that exact commit and declared dependencies.
3. An isolated builder creates one artifact and computes digest D.
4. The build service creates SLSA provenance at the point of truth.
5. A protected workload identity authenticates an in-toto Statement whose subject is D.
6. The registry stores the artifact and its associated attestation.
7. Staging and production requests reference D, not only a tag.
8. Deployment policy verifies integrity, claim type, issuer, repository, workflow, builder, revision, parameters, and subject.
9. The deployment record and runtime state preserve that D is running.

![Build evidence chain connects protected source, workflow, builder, artifact digest, attestation, policy, deployment, and runtime](/content-assets/articles/article-devsecops-software-supply-chain-build-provenance-attestations/build-evidence-chain.png)

_Provenance supplies origin evidence; source controls and builder isolation strengthen its facts; deployment policy makes the evidence enforceable._

If an attacker compromises only registry write access, they can upload M but cannot produce acceptable provenance for M. If the CI workflow itself is malicious and still authorized, it may produce valid evidence for malicious bytes; workflow review and input policy are therefore critical. If the verifier checks only “some signature exists,” an unauthorized attester may pass; identity policy must be specific.

Provenance also enables incident response. Given digest D, responders can locate source revision, build run, builder image, parameters, resolved dependencies, logs, SBOM, scans, and deployments. Given a compromised builder version, they can query every produced subject and affected environment.

An operational checklist asks:

- Are production artifacts addressed by immutable digest?
- Does provenance name exact source and resolved inputs?
- Is builder identity specific and protected?
- Is the attestation generated outside untrusted build control?
- Does authentication use a narrow workload identity rather than a shared key?
- Are workflow files and identity claims protected?
- Can the registry or evidence store retrieve claims by digest?
- Does retention match artifact lifetime?
- Does deployment verify exact subject, source, workflow, builder, issuer, and policy?
- Is verification enforced and observable?
- Can responders query forward and backward across the evidence graph?
- Is break-glass narrow and recorded?

The simplest mental model has four parts: artifact is the thing; provenance explains its origin; attestation authenticates a structured claim; policy decides whether that claim authorizes the transition. The deepest idea is that trust should follow verifiable evidence bound to exact bytes, not a familiar filename, tag, or pipeline label.

The workflow should answer forward queries. Given a source revision or vulnerable dependency resolution, identify every build invocation, subject digest, registry location, deployment, and runtime. This supports emergency response when source or a material becomes suspect.

It should also answer reverse queries. Given a suspicious runtime digest, identify its deployment, provenance, builder, invocation, external parameters, resolved source, workflow definition, reviewers, and related evidence. A reverse query exposes artifacts introduced outside the normal path because their expected joins are missing.

Test the gate with negative fixtures. Present an unsigned artifact, an attestation for the wrong digest, a valid statement from the wrong repository, a correct repository but unapproved workflow, an unexpected source branch, and a trusted builder with forbidden external parameters. Each should be rejected for a clear recorded reason.

Test storage lifecycle too. Copy an image between approved registries, retain it beyond CI-log expiry, roll back to an older digest, and verify that provenance remains discoverable and valid. Evidence that works only immediately after a build will fail during the incidents when it is most valuable.

Finally, review trust roots and identities on a schedule. Remove retired workflows and repositories, update issuer and certificate roots deliberately, review builders and runner images, and map historical evidence before deprecating verification mechanisms. Supply-chain identity has a lifecycle just like the artifacts it protects.

The review should also confirm that every live production digest still has retrievable provenance and that policy can verify it without depending on expired CI workspaces.

Review whether the attestation was created by the component that actually observed each fact. A user-supplied repository field, builder label, or invocation ID should not be treated as platform-observed evidence merely because it appears inside a signed predicate. Document which fields come from external parameters, protected control-plane observation, or later reconstruction.

Check that provenance covers every release variant. Multi-platform images, architecture-specific binaries, debug and production packages, and separately published manifests can have different subjects and build invocations. Evidence for one variant should not authorize a sibling that was built through a different path.

Finally, rehearse compromise queries. Mark one builder image, workflow revision, issuer identity, or resolved dependency as suspect and enumerate every affected subject and deployment. The exercise tests whether the evidence graph is operational rather than merely present.

Record missing subjects, broken associations, and unverifiable historical claims as engineering work with owners and deadlines.

Repeat the exercise after repairs and preserve the successful query as operational evidence that provenance remains usable beyond the original build window.

Review the result with the builder and deployment owners.

Together.

Then retain the review.

## Check Your Answers

:::expand[Why Does a Deployed Artifact Need Provenance?]{kind="recap"}
Provenance binds one artifact digest to the source, resolved inputs, build process, builder, and invocation that created it.
:::

:::expand[How Does an in-toto Attestation Describe a Claim?]{kind="recap"}
The Statement identifies its schema, immutable subject, claim type, and predicate, while authentication binds an identity to those statement bytes.
:::

:::expand[What Does SLSA Provenance Record About a Build?]{kind="recap"}
SLSA separates build definition from run details and records external parameters, resolved dependencies, internal context, builder, invocation, and subject.
:::

:::expand[How Is Provenance Authenticated Without a Long-Lived Signing Secret?]{kind="recap"}
Use protected workload identity and short-lived signing context at the point of truth instead of exposing a permanent production key to build code.
:::

:::expand[How Does Verification Turn Provenance into a Deployment Control?]{kind="recap"}
After cryptographic validation, enforce exact subject, claim type, issuer, repository, workflow, revision, parameters, and builder before deployment.
:::

:::expand[How Do Attestations Form a Searchable Evidence Graph?]{kind="recap"}
Link provenance, SBOMs, scans, tests, and deployments to artifact digests and bounded attester identities in durable queryable storage.
:::

:::expand[What Determines the Strength and Limits of Provenance?]{kind="recap"}
Evidence strength follows protected observation, builder isolation, attester authority, and enforced verification; signed detail cannot rescue an untrusted chain.
:::

:::expand[What Does a Production Provenance Workflow Look Like?]{kind="recap"}
Build protected source once, authenticate subject-bound provenance, store it with the digest, verify policy before promotion, and record runtime identity.
:::

## References

- [SLSA provenance v1.0](https://slsa.dev/spec/v1.0/provenance) - Defines build definition, run details, builder, and resolved dependency fields.
- [in-toto Statement](https://github.com/in-toto/attestation/tree/main/spec/v1) - Defines the statement subject and predicate structure.
- [GitHub artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations-to-establish-provenance-for-builds) - Documents workflow-generated build provenance.
- [GitHub verifying attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations-to-establish-provenance-for-builds#verifying-artifact-attestations) - Documents subject and source verification.
- [OCI image and distribution specifications](https://github.com/opencontainers/image-spec) - Defines digest-addressed container artifacts.
