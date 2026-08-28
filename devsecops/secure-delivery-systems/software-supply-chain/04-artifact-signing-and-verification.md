---
title: "Artifact Signing and Verification"
description: "Learn how digests, signatures, signer identity, Cosign keyless certificates, Rekor transparency, admission policy, observability, and verifiable rollback protect artifact deployment."
overview: "Start with the exact artifact bytes, then separate digest identity, cryptographic validity, and signer authorization. Compare long-lived keys with keyless Cosign, understand Fulcio and Rekor, write specific verification policy, distinguish artifact signatures from provenance attestations, enforce the policy at deployment, and keep outages, key compromise, and rollback inside the trust model."
tags: ["devsecops", "artifact-signing", "cosign", "verification"]
order: 4
id: article-devsecops-software-supply-chain-artifact-signing-verification
---

## Table of Contents

1. [Why Must Signing Start with the Artifact Digest?](#why-must-signing-start-with-the-artifact-digest)
2. [What Does a Signature Prove About Identity and Authorization?](#what-does-a-signature-prove-about-identity-and-authorization)
3. [How Do Traditional and Keyless Signing Differ?](#how-do-traditional-and-keyless-signing-differ)
4. [What Do Fulcio and Rekor Add to Keyless Signing?](#what-do-fulcio-and-rekor-add-to-keyless-signing)
5. [How Should a Verification Policy Evaluate Signatures and Attestations?](#how-should-a-verification-policy-evaluate-signatures-and-attestations)
6. [How Does Deployment-Time Verification Protect Kubernetes?](#how-does-deployment-time-verification-protect-kubernetes)
7. [How Do Outages, Rollback, and Key Compromise Affect Trust?](#how-do-outages-rollback-and-key-compromise-affect-trust)
8. [What Does a Complete Production Verification Flow Look Like?](#what-does-a-complete-production-verification-flow-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Start with the object production will run. It may be a container image, binary, archive, package, or firmware file. Security policy needs an exact identity for those bytes.

A cryptographic digest provides that identity:

```text
artifact bytes -> sha256:D
```

The same bytes produce the same digest, and a content change produces a different digest. A tag such as `api:v1.4` can move. A filename such as `api.tar.gz` can be replaced. They are useful labels, not immutable trust roots.

Suppose a team reviews and tests digest D under tag `v1.4`. An attacker with registry write permission moves the tag to malicious digest M. A deployment that says only `v1.4` may fetch M even though every earlier record mentions the familiar version.

Signing should converge on D. Deployment should resolve or specify D. Verification should compare the signature's subject with D. Runtime should report D. That common coordinate keeps evidence attached to exact content.

Keep these questions in view as you work through the lesson:

1. **Why Must Signing Start with the Artifact Digest?**
2. **What Does a Signature Prove About Identity and Authorization?**
3. **How Do Traditional and Keyless Signing Differ?**
4. **What Do Fulcio and Rekor Add to Keyless Signing?**
5. **How Should a Verification Policy Evaluate Signatures and Attestations?**
6. **How Does Deployment-Time Verification Protect Kubernetes?**
7. **How Do Outages, Rollback, and Key Compromise Affect Trust?**
8. **What Does a Complete Production Verification Flow Look Like?**

## Why Must Signing Start with the Artifact Digest?
<!-- section-summary: A signature protects exact artifact content only when the system identifies and deploys that content by immutable digest rather than by a movable tag or filename. -->

![Trust the digest compares a movable tag with an immutable digest, signature, verifier, and allow decision](/content-assets/articles/article-devsecops-software-supply-chain-artifact-signing-verification/trust-the-digest.png)

_The signature authorizes bytes identified by the digest; it does not make a mutable tag immutable._

A digest alone does not establish trust. Anyone can calculate a hash for malicious content. It answers “which bytes?” but not “who made a claim about them?” or “is that identity authorized?”

A digital signature uses a private-key operation over the digest or a structured document containing it. A verifier uses the corresponding public-key trust material to check that the signed bytes were not altered and that the operation came from whoever controlled the private key.

The workflow should sign the final artifact. Signing an intermediate, rebuilding, or converting the file afterward creates new bytes and therefore a different digest. The release path should build once, identify the result, and carry that subject through scan, signing, promotion, and deployment.

Container manifests and multi-platform indexes require precision. A signature for one architecture-specific image may not cover a different manifest list. Verify and deploy the exact subject required by policy rather than assuming related names share trust.

The registry can store the same digest under several tags. That does not create several artifacts; it creates several names for one content object. Conversely, one tag can name many digests over its lifetime. Audit and policy should record both the human release label and immutable digest so operators retain context without sacrificing identity.

The digest also connects signing with other evidence. A vulnerability report against D, provenance for D, and runtime inventory reporting D can be joined reliably. If a scanner reports only `v1.4`, the team must reconstruct what that tag meant at scan time before claiming the result covers production.

## What Does a Signature Prove About Identity and Authorization?
<!-- section-summary: Cryptographic validity shows that an identity-controlled signing operation covered a digest, while policy separately decides whether that identity was authorized to approve these bytes for this environment. -->

A valid signature proves a narrow proposition:

```text
the holder of a private signing capability
authenticated this subject under this signature scheme
```

It does not prove that the artifact is free of vulnerabilities, that source was reviewed, that the builder was trustworthy, or that the signer was authorized for production.

Cryptographic validity and authorization are different. An employee can create a valid key and sign a malicious image. A development workflow can obtain a valid keyless certificate. A retired release key may still verify cryptographically. Production policy must identify which signers and contexts count.

Signer identity is more important than the word “signed.” A useful policy may require an exact workload identity: the ParcelPulse production build workflow in the expected repository, issued by the approved OIDC and certificate infrastructure. “Any signature from our organization” may be too broad when experimental repositories or lower-trust workflows can obtain identities.

Think of a signature as an authorization token for bytes. When the production verifier accepts a signer, it allows that identity to cause any signed digest to cross the deployment boundary. Protect and scope signing authority with the same care as deployment authority.

Signing should happen around a trust transition. The ordinary build executes source, dependencies, compilers, and plugins. Exposing a production private key inside that environment lets any of those components use the key. Separate the signing decision or operation so it receives the final digest and required build evidence but does not expose broad signing authority to all build steps.

The signer should validate what it is asked to sign. A protected signing service that signs any caller-supplied digest is only protecting key extraction, not misuse. Admission can require approved builder identity, source repository, source revision, workflow, and artifact location before authorizing the signature.

Audit records should connect signature to signer identity, request, artifact digest, policy, time, and workflow invocation. A key identifier alone may not distinguish which job or human requested the operation.

Least privilege applies to signing identities. A package release signer should not sign arbitrary container repositories. A staging workflow should not satisfy production policy. Different artifact classes or environments may use distinct identities or policy conditions.

Signing identity should be separated from artifact write when consequence warrants it. A registry publisher can upload bytes. A signer can authorize bytes. If one compromised job has both powers with no independent evidence check, it can upload M and sign M. A signing boundary can require provenance from an approved builder and a protected release record before making the authorization claim.

Review who can change signer policy. Adding a new public key, broadening an OIDC identity expression, changing an issuer, or allowing another repository is equivalent to adding a new authority capable of approving bytes. Protect and audit these configuration changes.

Signature metadata should not be trusted merely because it appears inside the signed object. Verify the entire signed payload and identity chain through the selected scheme. Avoid policies based only on an unprotected annotation such as `signed-by=release`.

## How Do Traditional and Keyless Signing Differ?
<!-- section-summary: Traditional signing relies on a long-lived private key whose custody and lifecycle the organization controls, while keyless signing derives a short-lived key and certificate from authenticated workload identity. -->

Traditional public-key signing has a familiar flow:

```text
protected private key signs digest D
      |
      v
signature stored with artifact
      |
      v
verifier uses trusted public key
```

The private key may live in a hardware security module, KMS, isolated service, or encrypted file. The public key or certificate becomes a verifier trust root.

This design creates long-lived key management: secure generation, storage, access policy, backup, rotation, compromise response, revocation, and distribution of updated public trust. A production signing key is extremely valuable because its signatures may authorize arbitrary bytes.

Never casually store that key as an ordinary CI secret. Repository code, dependencies, actions, or runner compromise can read or use it. Masking hides log output, not signing operations.

An isolated signing service reduces extraction, but job authorization remains essential. If every workflow can ask KMS to sign any digest, a malicious job can produce a valid artifact without stealing the key.

**Keyless signing** changes identity and lifetime:

```text
CI workload authenticates with OIDC
      |
      v
ephemeral key pair and short-lived certificate
      |
      v
sign digest D
      |
      v
publish signature and transparency evidence
```

The user or workflow does not maintain a permanent signing private key. An ephemeral key exists for the operation, and a certificate binds its public key to an identity derived from OIDC claims.

OIDC is useful because the platform can assert repository, workflow, source context, actor, and environment. The certificate infrastructure validates the signed token and translates that workload identity into signing identity. Verification later checks the expected issuer and identity rather than a single long-lived public key.

Short-lived keys reduce the risk that a stolen private key signs artifacts for months. They do not prevent malicious code from using the key during its valid job, and they do not fix broad OIDC trust. Protect the workflow and signing step.

Traditional and keyless approaches solve the same core question—how a verifier connects bytes to an identity—through different lifecycle models. Choose based on trust infrastructure, offline needs, platform support, and operational requirements, then make authorization specific in either model.

Traditional verification can work offline when the verifier has trusted public material and signatures. That can suit constrained environments, but key rotation and revocation information still need distribution. Keyless verification can carry a bundle of certificate and transparency evidence, but its trust roots and identity rules must also be available.

Key rotation should preserve which key was trusted for which period and artifact class. Removing an old public key immediately may make approved rollback artifacts unverifiable. Leaving every historical key fully authorized forever enlarges trust. Use explicit validity and migration policy rather than treating the trust store as an append-only list.

For either model, signing code should receive only the final digest and bounded metadata, not an arbitrary shell in a highly privileged environment. The smaller the code running beside the signing capability, the easier it is to review and monitor.

## What Do Fulcio and Rekor Add to Keyless Signing?
<!-- section-summary: Fulcio binds an ephemeral public key to an OIDC identity, while Rekor records signing evidence in an append-oriented transparency log that supports later verification and investigation. -->

Cosign's keyless flow uses the Sigstore ecosystem. The exact implementation can evolve, but the first-principles roles are stable.

**Fulcio** acts as a certificate authority for short-lived signing identities. The signer proves workload or user identity through an accepted OIDC provider and presents the ephemeral public key. Fulcio issues a short-lived certificate connecting that key with identity claims.

```text
OIDC assertion + ephemeral public key
      -> Fulcio identity validation
      -> short-lived certificate
```

The certificate allows a later verifier to check which issuer and identity were bound to the key used for the signature. Policy can require a specific CI workflow identity instead of distributing one static public key.

Short certificate life creates a historical verification problem. Months later, the certificate is expired. Expiry prevents new use but should not erase evidence that signing occurred while it was valid.

**Rekor** provides a transparency log. A signing event or its relevant metadata is recorded in an append-oriented, publicly auditable structure. Inclusion evidence and signed log checkpoints help demonstrate that the event existed at a particular time and was not created secretly much later.

![Keyless signing flow connects CI OIDC identity, Fulcio certificate, Cosign signature, Rekor transparency, and registry subject](/content-assets/articles/article-devsecops-software-supply-chain-artifact-signing-verification/keyless-signing-flow.png)

_Fulcio connects ephemeral key to identity; Rekor preserves discoverable signing evidence; Cosign binds the signature to the artifact digest._

A transparency log is not a secret database. Do not place credentials or sensitive private data in entries. Public visibility supports audit and detection, not confidentiality.

Rekor adds discoverability and historical evidence. It can help investigate when an identity signed, find unexpected signing events, and assess key or identity compromise. It does not make a bad signature good. A malicious authorized workflow can create a valid logged signature.

Verification of keyless evidence typically checks artifact digest, signature, certificate chain or identity material, expected issuer and identity, transparency inclusion, and timing. Bundled verification material can allow later checks without contacting every service, depending on the tool and mode.

Trust roots still require lifecycle management. Verifiers rely on accepted certificate and transparency infrastructure. Keyless means the workflow does not guard a permanent signing key; it does not mean the system has no roots of trust.

Certificate identity fields should be matched exactly enough for the platform. A broad regular expression may accept a similarly named repository or workflow. Test policy with expected and near-miss identities, including feature branches, forks, renamed workflows, and unrelated repositories in the same organization.

Transparency inclusion can help establish that a signature existed while the short-lived certificate was valid. Verifiers should use the mechanism and bundle formats defined by the signing ecosystem rather than inventing a timestamp rule from an untrusted annotation.

Monitor transparency for your authorized identity patterns. An unexpected digest signed by the production workflow identity can reveal workflow misuse even when no deployment occurred. Transparency becomes a detection source in addition to a verification input.

## How Should a Verification Policy Evaluate Signatures and Attestations?
<!-- section-summary: Verification policy should demand the exact subject, signature integrity, approved issuer and identity, required claim types, protected source and builder context, and any SBOM or provenance relationships. -->

Traditional public-key verification checks that a signature over D validates under an approved public key. Keyless verification checks signature validity plus the certificate or identity chain, OIDC issuer, expected identity, and transparency evidence.

In both models, policy should be specific:

```text
subject digest = deployment digest
signer identity = approved production workflow
issuer = approved identity provider or CA
artifact repository = permitted namespace
source and builder evidence = expected protected path
```

This resembles TLS in one useful way: a certificate or signature can be cryptographically valid while naming the wrong identity. A browser checks that the certificate identity matches the requested host. An artifact verifier should check that the signing identity matches the approved release producer.

Signing an artifact differs from signing provenance.

- An **artifact signature** says an identity signed digest D.
- A **provenance attestation** says structured build facts about D, authenticated by an attester.

The first supports artifact authorization. The second supports origin verification. Production policy may require both: the release signer approves D, and provenance proves D came from the expected source and builder.

SBOM evidence adds a different claim: document S describes the components of D. Signing or attesting the SBOM protects its relationship to the artifact and generator. It does not make the components safe.

Everything should converge on the digest:

```text
artifact signature -> D
provenance         -> D
SBOM               -> D
vulnerability scan -> D
deployment request -> D
runtime state      -> D
```

Policy should reject semantic substitution. A valid SBOM attestation does not satisfy a provenance requirement. A signature from a developer workflow does not satisfy production signer policy. A provenance statement for D1 does not cover D2.

Record policy version and outcome. “Signature verified” is incomplete when verifier configuration later changes. Preserve which identities, issuers, claim types, and thresholds were evaluated.

Trust is a decision over evidence, not an intrinsic sticker on the image. Different environments may accept different identities or require different evidence, but production rules should remain explicit and reviewable.

The policy may require multiple independent claims. For example, D must have an artifact signature from the release identity, SLSA provenance from the controlled builder, and an SBOM attestation from the approved generator. Each claim has its own predicate or signature identity and each must bind to D.

Avoid accepting an artifact solely because its signer email or repository name contains an expected substring. Match issuer and complete identity semantics defined by the tool. A valid certificate from another issuer with a similar subject should fail.

Verification should also check repository or registry scope. A signer authorized for `parcelpulse/api` should not automatically approve `finance/payments`. Binding identity and artifact namespace reduces impact if a signing path is misused.

Policy updates require staged rollout. Test new identity rules against existing approved artifacts and negative fixtures, observe denials in a non-production environment, then enforce. A typo in production signer identity can block every release; a wildcard added to avoid that outage can silently erase the boundary.

## How Does Deployment-Time Verification Protect Kubernetes?
<!-- section-summary: Kubernetes admission provides a natural boundary where policy can resolve the requested image digest, verify required identity and evidence, and reject untrusted workload creation before Pods run. -->

Verification matters most where it controls what executes. A pipeline can verify before calling deployment, but another client or administrator may bypass that pipeline. Kubernetes admission creates a boundary at the API transition that creates or updates workloads.

A Pod specification commonly names an image tag. The admission path should resolve or require an immutable digest, retrieve signatures and attestations for that digest, evaluate policy, and allow or deny the request before the workload runs.

```text
workload request
      |
      v
resolve image subject D
      |
      v
verify signature and required attestations
      |
      v
check signer, issuer, repository, builder, and policy
      |
   allow / reject
```

![Deployment verification checks digest, signer, issuer, policy, transparency, and provenance before allow, reject, or rollback](/content-assets/articles/article-devsecops-software-supply-chain-artifact-signing-verification/deploy-time-verification.png)

_Admission enforces identity questions, not merely the presence of some signature._

An admission rule should ask which identity signed, which issuer authenticated it, which artifact repository and source context are permitted, whether required provenance or SBOM claims exist, and whether the subject matches the requested digest.

Policies can use different strictness. A development cluster may warn on unsigned images. Staging may require an approved CI identity. Production may additionally require expected provenance, protected source, and no expired exception. The progression should be deliberate, not an indefinite production warn mode.

Decide what happens when verification infrastructure is unavailable. A fail-open rule improves availability but creates a bypass during outages or attacks on the verifier. Fail-closed protects the boundary but can block emergency deployment. Some systems use cached trust data plus a separate audited break-glass path.

Verification should be observable. Log request identity, namespace, resolved digest, signatures and attestations found, signer claims, policy version, decision, failure reason, and any exception. Alert on repeated rejection, missing evidence, unexpected signer, or verifier bypass.

Verify the thing actually pulled. If admission verifies a tag and a node later resolves that tag to different bytes, the control fails. Mutate the workload to the verified digest or require digest references so the node fetches the evaluated subject.

Admission should cover every workload path that can cause the cluster to pull an image: Pods, higher-level controllers, scheduled work, operators, and custom resources that generate Pods. A policy applied only to one namespace or API path may leave alternate deployment routes.

Decide how policy handles platform and system images. Exempting an entire privileged namespace can create an attractive bypass. Where exceptions are necessary, restrict them to exact registries, identities, service accounts, and operational owners, and review them regularly.

Caching verification results can improve availability and latency. Cache by immutable digest, policy version, and relevant trust data, not by mutable tag. Define expiry and invalidation for signer revocation or policy changes so a previously accepted result does not outlive the trust decision indefinitely.

## How Do Outages, Rollback, and Key Compromise Affect Trust?
<!-- section-summary: Rollback remains a deployment requiring valid immutable evidence, while verifier outages and signer compromise need explicit policies that preserve availability without silently discarding trust. -->

Rollback is not exempt from verification. It changes production and should deploy an identified artifact whose signature and required evidence still satisfy policy.

Keep previous artifacts immutable and retrievable with their signatures, provenance, SBOMs, and verification history. A rollback to `previous` or `stable` by mutable tag can select unexpected bytes. Use the known digest from the earlier release record.

Signing policy should not make emergency rollback impossible. Retention and key rotation must account for older releases. A new trust root may coexist with an old one for a controlled interval so previously approved artifacts remain verifiable, or the organization can reauthorize known digests through an explicit migration.

Do not solve emergency access through silent fail-open. A break-glass process should name the responder, incident, artifact digest, missing or failed evidence, compensating review, time limit, deployment result, and later reconciliation.

Key compromise changes historical interpretation. If a long-lived private key was stolen, which signatures were made before and after compromise? Can attackers backdate or create apparently old signatures? Timestamp and transparency evidence can help bound the window, though response depends on the signing system.

Transparency changes investigation by making signing events observable. An attacker using a compromised identity may leave an unexpected log entry. Monitor signer identities and artifact namespaces rather than consulting the log only after an incident.

For keyless signing, compromise may involve the CI workflow, OIDC issuer, repository account, or trust policy rather than a stored private key. Identify every signature from the affected workload identity and interval, then map those digests to registries and deployments.

Revoking a signer should not delete historical records. Preserve evidence and mark trust changes so responders can distinguish a previously authorized release from a later unauthorized event.

Rollback planning should include evidence-store availability. A previous image whose registry manifest remains but whose signature or attestation was garbage-collected is not operationally rollback-ready under fail-closed policy. Periodically test retrieval and verification of retained releases.

After key compromise, distinguish private-key extraction, unauthorized signing-service use, workflow identity misuse, and trust-policy broadening. Each produces different evidence and exposure. Query signatures by key or identity, transparency entries, artifact namespaces, and time, then map digests to deployments.

If verification infrastructure is degraded during an incident, prefer a predesigned path that authorizes one known digest rather than disabling policy for all images. The exception can expire automatically and should generate immediate review.

## What Does a Complete Production Verification Flow Look Like?
<!-- section-summary: Production verifies exact digest, authorized signer, identity issuer, provenance, SBOM relationships, policy, and transparency before deployment and records both admission and runtime results. -->

A complete flow is:

1. Protected source enters an approved build workflow.
2. The controlled build creates artifact digest D once.
3. Provenance authenticates source, builder, parameters, and D.
4. An authorized traditional or keyless signing boundary signs D.
5. The registry stores D with signatures, provenance, and SBOM relationships.
6. The deployment request names D.
7. Verification checks cryptography, subject, signer identity, issuer, transparency evidence, provenance, and environment policy.
8. Admission allows only the verified digest.
9. Deployment and runtime records confirm D is running.

A registry compromise illustrates the benefit. Registry write access may let an attacker upload M or move a tag. Without the approved signer and provenance identities, M fails policy. A compromised trusted signer is different: it can authorize malicious bytes. Source controls, builder separation, signing authorization, and provenance reduce the chance that one identity controls every claim.

Signing and provenance reinforce each other. The signature provides an authorization claim for bytes. Provenance supplies origin facts. Signing and SBOMs also reinforce each other when the SBOM relationship to D is authenticated. None of these proves the software is free of defects; together they improve identity, origin, inventory, and policy enforcement.

What each mechanism proves should remain visible:

| Mechanism | Bounded claim |
|---|---|
| Digest | These exact bytes have identity D |
| Signature | Identity-controlled signing authenticated D |
| Signer policy | That identity is authorized for this artifact and environment |
| Provenance | D came from stated source, builder, inputs, and run |
| SBOM | A stated component inventory is associated with D |
| Transparency | The signing event was recorded in the log |
| Admission | This request satisfied policy at deployment time |

A production checklist asks whether images use digests; final bytes are signed; signing authority is isolated; key or OIDC identity is narrow; issuer and signer conditions are exact; Rekor or other historical evidence is handled; provenance and SBOM claims bind to the same subject; admission verifies the object actually pulled; failure behavior is explicit; decisions are logged; previous releases remain immutable and verifiable; and break-glass is tested.

The deepest view is not “signed equals secure.” It is:

```text
exact bytes
  + authenticated signer identity
  + authorization policy
  + origin and inventory evidence
  + enforced verification at execution
  = bounded release trust
```

Verification evidence should support reverse investigation. Starting from a running digest, locate admission decision, signatures, signer identity, provenance, source, and release approval. Starting from a compromised signer, list every digest it authenticated and every environment that admitted those digests.

Test negative cases regularly: unsigned artifact, wrong digest, correct signature from wrong key, correct OIDC issuer but wrong repository, correct repository but wrong workflow, missing transparency evidence, expired exception, and mutable tag resolving after verification. Each denial should be clear enough for operators to fix the correct boundary.

Observe signer use even outside deployments. A malicious signature that never reached production can still reveal compromised release authority. Alerting on unusual volume, time, repository, namespace, or workflow gives response a chance before admission sees the artifact.

Retain verifier configuration and trust roots with release evidence. Historical signature bytes may still validate, but an investigation also needs to know which identity rules and roots were accepted at the time. Record later revocation or policy changes without rewriting the original decision.

Keep signing and verification tools patched and versioned. Parser, certificate, registry, and policy-engine defects can undermine the control even when keys and identities are correct. Roll tool updates through negative fixtures and known signed artifacts before production enforcement.

Record which verifier version made each decision so later incident review can identify releases evaluated by a flawed or misconfigured implementation.

Keep the matching policy bundle, accepted trust roots, and negative-test results with that version so the historical authorization decision can be reconstructed independently.

Periodically rehearse that reconstruction with a retained production digest and its complete evidence set.

Repeat verification whenever signer trust, policy, artifact identity, or deployment context changes.

## Check Your Answers

:::expand[Why Must Signing Start with the Artifact Digest?]{kind="recap"}
Sign, verify, deploy, and observe the same immutable digest so a movable tag cannot substitute different bytes.
:::

:::expand[What Does a Signature Prove About Identity and Authorization?]{kind="recap"}
Cryptography proves an identity-controlled signing operation covered the subject; policy separately decides whether that identity is authorized.
:::

:::expand[How Do Traditional and Keyless Signing Differ?]{kind="recap"}
Traditional signing manages a long-lived key, while keyless signing binds a short-lived key to workload identity; both require narrow authorization.
:::

:::expand[What Do Fulcio and Rekor Add to Keyless Signing?]{kind="recap"}
Fulcio connects OIDC identity to an ephemeral key, and Rekor preserves transparent historical signing evidence without making bad claims trustworthy.
:::

:::expand[How Should a Verification Policy Evaluate Signatures and Attestations?]{kind="recap"}
Require exact subject, approved signer and issuer, correct claim types, and expected source and builder context rather than any valid signature.
:::

:::expand[How Does Deployment-Time Verification Protect Kubernetes?]{kind="recap"}
Admission resolves the image digest and enforces signer and evidence policy before the workload is allowed to run.
:::

:::expand[How Do Outages, Rollback, and Key Compromise Affect Trust?]{kind="recap"}
Keep rollback artifacts verifiable, define verifier outage and break-glass behavior, and preserve historical evidence when signer trust changes.
:::

:::expand[What Does a Complete Production Verification Flow Look Like?]{kind="recap"}
Connect protected source, one artifact digest, authorized signing, provenance and SBOM evidence, admission policy, deployment, and runtime records.
:::

## References

- [Sigstore Cosign signing](https://docs.sigstore.dev/cosign/signing/signing_with_containers/) - Documents container image signing by digest and keyless identity.
- [Sigstore keyless overview](https://docs.sigstore.dev/cosign/signing/signing_with_containers/#keyless-signing-using-openid-connect) - Describes OIDC-based ephemeral signing.
- [Sigstore Fulcio](https://docs.sigstore.dev/certificate_authority/overview/) - Describes short-lived certificates bound to identity.
- [Sigstore Rekor](https://docs.sigstore.dev/logging/overview/) - Describes transparency logging and inclusion evidence.
- [Cosign verification](https://docs.sigstore.dev/cosign/verifying/verify/) - Documents identity, issuer, and signature verification.
- [Kubernetes image digests](https://kubernetes.io/docs/concepts/containers/images/#image-names) - Describes immutable digest image references.
- [Sigstore policy-controller](https://docs.sigstore.dev/policy-controller/overview/) - Describes Kubernetes admission verification for signatures and attestations.
