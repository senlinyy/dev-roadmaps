---
title: "Image Trust and SBOMs"
description: "Answer what is inside a container image with scanning, SBOMs, base-image drift checks, signing, attestations, and CI evidence."
overview: "Start with the plain production question: what is inside this payments-api image? Then inspect layers and packages, scan known vulnerabilities, publish SBOMs in CycloneDX or SPDX, handle base-image drift, triage findings, sign and attest the digest, and make CI publish the evidence that deployment policy can verify."
tags: ["devsecops", "containers", "sbom", "image-scanning"]
order: 2
id: article-devsecops-container-image-security-image-scanning
aliases:
  - image-scanning
  - article-devsecops-container-image-security-image-scanning
  - devsecops/container-image-security/image-scanning.md
  - sboms
  - article-devsecops-container-image-security-sboms
  - devsecops/container-image-security/sboms.md
  - image-signing
  - article-devsecops-container-image-security-image-signing
  - devsecops/container-image-security/image-signing.md
  - devsecops/container-image-security/02-image-trust-and-sboms.md
  - devsecops/container-image-security/02-image-trust-and-sboms
  - container-image-security/02-image-trust-and-sboms
---

## Table of Contents

1. [Why Must Image Trust Begin with Exact Artifact Identity?](#why-must-image-trust-begin-with-exact-artifact-identity)
2. [How Do SBOMs Describe What an Image Contains?](#how-do-sboms-describe-what-an-image-contains)
3. [Why Can Scanning the Same Image Produce New Results?](#why-can-scanning-the-same-image-produce-new-results)
4. [How Do Base Images Make Vulnerability Work Continuous?](#how-do-base-images-make-vulnerability-work-continuous)
5. [How Do Reachability and Ownership Turn Findings into Decisions?](#how-do-reachability-and-ownership-turn-findings-into-decisions)
6. [What Do Signatures and Attestations Actually Prove?](#what-do-signatures-and-attestations-actually-prove)
7. [How Should CI Build and Publish the Evidence Bundle?](#how-should-ci-build-and-publish-the-evidence-bundle)
8. [What Does an End-to-end Image Trust Chain Look Like?](#what-does-an-end-to-end-image-trust-chain-look-like)
9. [Check Your Answers](#check-your-answers)

An image is an executable supply-chain artifact. Before asking whether it is safe to deploy, the team needs to identify exactly which artifact it is discussing. A familiar name such as `payments-api:1.7` is helpful to people, but it does not by itself prove that two observers received the same bytes.

A tag is a registry label. The label can point to an image manifest today and, unless registry policy prevents it, a different manifest tomorrow. That makes this statement ambiguous:

```text
we scanned payments-api:latest
```

Which value of `latest` was scanned? Did production pull before or after the tag moved? Did the incident responder retrieve the same object?

A digest is content-derived identity, commonly written as:

```text
payments-api@sha256:a724...
```

If any covered content changes, the digest changes. Two different image manifests do not intentionally share the same cryptographic digest. That property gives the trust system a stable subject.

```text
tag:      human-friendly movable label
digest:   exact content identity
```

Keep these questions in view as you work through the lesson:

1. **Why Must Image Trust Begin with Exact Artifact Identity?**
2. **How Do SBOMs Describe What an Image Contains?**
3. **Why Can Scanning the Same Image Produce New Results?**
4. **How Do Base Images Make Vulnerability Work Continuous?**
5. **How Do Reachability and Ownership Turn Findings into Decisions?**
6. **What Do Signatures and Attestations Actually Prove?**
7. **How Should CI Build and Publish the Evidence Bundle?**
8. **What Does an End-to-end Image Trust Chain Look Like?**

## Why Must Image Trust Begin with Exact Artifact Identity?
<!-- section-summary: A tag is a movable name, while an image digest identifies exact content and gives SBOMs, scans, signatures, attestations, deployments, and incidents one common subject. -->

The digest connects otherwise separate evidence:

```text
sha256:ABC
  + inventory of components
  + vulnerability result
  + build provenance
  + signature
  + policy decision
  + deployment record
```

Without that connection, a valid report may describe the wrong artifact. A software bill of materials for one build, a signature over another, and a deployment of a third do not combine into trust merely because each uses the same tag.

Start with the artifact itself. Record the registry, repository, platform or architecture when relevant, manifest digest, creation evidence, and release name. The digest should be captured from the pushed registry object rather than assumed from a local tag, because registries and multi-platform manifests can affect which identity consumers resolve.

Exact identity does not mean the artifact is good. Malware can also have a stable digest. Identity answers “which bytes?” Trust requires decisions about origin, contents, known weaknesses, policy, and context. The digest makes those decisions attach to the correct object.

Identity must also be handled consistently across tools. One scanner may report the digest of a platform-specific manifest, while another tool records the digest of a multi-platform image index. Both can be valid identities for different objects. Preserve the relationship and ensure policy verifies the object the runtime will actually pull for its architecture. A copied artifact in another registry should likewise retain evidence that names the intended subject instead of relying on a similar repository path.

This prevents an easy reasoning error: “the release tag was signed, therefore anything now found at that tag is signed.” Verification must resolve the current artifact and validate evidence over its digest. If the tag moves, the new target needs its own inventory, scan, provenance, and approval.

## How Do SBOMs Describe What an Image Contains?
<!-- section-summary: An SBOM is structured component inventory, and image layers plus multiple packaging systems mean source and final-image SBOMs provide complementary rather than interchangeable views. -->

An SBOM, or software bill of materials, is structured inventory. It records components associated with an artifact: names, versions, package types, identifiers, suppliers, licenses, dependency relationships, hashes, and sometimes the image or file in which each component was observed.

Conceptually, an entry can look like:

```json
{
  "component": "example-library",
  "version": "4.2.0",
  "type": "library",
  "foundIn": "payments-api@sha256:ABC"
}
```

An SBOM is not inherently a vulnerability report. It says what the evidence generator believes is present. A scanner can later combine that inventory with vulnerability intelligence. Keeping those concepts separate is important because inventory is tied mostly to artifact contents, while vulnerability knowledge changes over time.

Container images make inventory less obvious than a flat application directory. Images contain layers from the base, package-installation steps, copied files, and application output. The final merged filesystem can hide a file removed by a later layer even though bytes remain in history. Multiple platforms under one image index can also have different packages.

Package visibility depends on how software was installed. An operating-system package manager leaves a database with names and versions. A language package manager may leave manifests or metadata. A statically linked binary can include library code without a separate package directory. A manually copied executable might have no package-manager record at all. One scanner can therefore see something another misses.

This creates two useful inventory views:

- A **source or build SBOM** describes declared application dependencies and the graph resolved during the build.
- A **final-image SBOM** describes components observable in the artifact that will run, including inherited operating-system packages and copied runtime files.

Neither view always contains the other. A source SBOM may list build dependencies that never ship and preserve dependency relationships unavailable from final files. An image SBOM can reveal the base operating system and accidentally copied software missing from source declarations. Publishing both with clear subjects gives responders more complete evidence.

CycloneDX and SPDX are common structured formats. CycloneDX is often used for component and dependency information in security workflows. SPDX supports detailed software-package, file, relationship, and licensing descriptions. The important control is not choosing a fashionable acronym; it is producing a valid, machine-readable document that identifies its subject and can be retained and queried.

A small conceptual document needs at least enough identity to avoid becoming an orphan:

```json
{
  "artifact": {
    "name": "payments-api",
    "digest": "sha256:ABC"
  },
  "components": [
    {"name": "runtime-package", "version": "1.2.3"},
    {"name": "application-library", "version": "4.5.6"}
  ]
}
```

Real formats include richer identifiers and relationships. What matters first is that a later question about `sha256:ABC` can locate the inventory produced for `sha256:ABC`, not whichever image a tag currently names.

Inventory quality has several dimensions. **Completeness** asks whether relevant components were discovered. **Accuracy** asks whether their identities and versions are correct. **Relationship quality** asks whether parent, dependency, and containment links are useful. **Subject binding** asks whether the document unmistakably describes the intended digest. **Generation evidence** asks which tool and method produced it. A syntactically valid SBOM can still be weak on any of these dimensions.

An SBOM also does not prove its own truth. A document generated from a source manifest can faithfully list declared packages while missing a binary copied into the final image. A final-image scanner can observe a library without knowing why the build selected it. Sign or attest the document and its relationship to the artifact, but remember that a signature proves issuer and integrity, not inventory completeness. Compare independent views where the risk justifies it.

Licenses and supplier fields can support other governance questions, but their presence should not distract from the security purpose here: quickly connect a component disclosure to exact artifacts and owners. Preserve enough identifiers—such as package ecosystem, version, and standardized package coordinates—to avoid confusing unrelated components with similar names.

## Why Can Scanning the Same Image Produce New Results?
<!-- section-summary: Vulnerability scanning joins artifact inventory to changing intelligence, so an unchanged digest can receive different findings as databases, detection, and package understanding evolve. -->

Scanning is best understood as a join between two data sets:

```text
component inventory for sha256:ABC
              +
current vulnerability intelligence
              =
findings at evaluation time
```

The image can remain byte-for-byte unchanged while the result changes. On Monday, a package may have no public advisory. On Thursday, researchers publish a vulnerability and the database maps it to the installed version. The digest remains `sha256:ABC`; current knowledge about that digest is different.

Scanner behavior also changes. Package detection improves, version matching is corrected, advisory feeds add or withdraw mappings, and severity or fix availability changes. A scan report therefore needs its evaluation time, tool or data identity, and artifact digest. “Passed scan” is not a permanent property of the image.

Layers complicate matching. A base package can be upgraded in a later layer, metadata can remain from an earlier version, or a removed file can persist in image history. Scanners vary in whether they analyze the final filesystem, layer history, package databases, file signatures, binaries, or source manifests. Their results should be investigated as observations, not treated as infallible descriptions.

Package visibility is especially difficult for statically compiled applications, vendored libraries, extracted archives, and manually copied executables. Version strings can be absent or misleading. A package database can claim something that the application no longer uses. That is why build-time inventory, final-image analysis, and provenance complement one another.

![Release evidence chain infographic showing a payments-api digest connected to SBOM, scan report, signature, triage record, CI build, and deploy policy](/content-assets/articles/article-devsecops-container-image-security-image-scanning/release-evidence-chain.png)

Rescanning has two distinct uses. Scan before release to stop a known unacceptable artifact from entering production. Rescan stored and deployed digests as intelligence changes so newly disclosed issues become work. Rebuilding the same source against a repaired base or dependency creates a new digest that needs its own evidence.

An SBOM supports fast reevaluation because the team can search known inventories when a new library issue appears. It may still need a fresh artifact scan to confirm package detection and runtime composition. Inventory and scan outputs should be retained as evidence with their own versions rather than overwritten by the newest report.

The changing nature of findings is not scanner failure. It is a consequence of learning about fixed historical bytes over time. A mature workflow treats “artifact identity” as stable and “security knowledge” as time-sensitive.

This separation makes historical questions answerable. The release gate can preserve what the organization knew and decided at deployment time. A current rescan can show what it knows now. Overwriting the old report would lose the original decision context; relying only on the old report would ignore newly disclosed risk. Keep both, label their evaluation times, and connect both to the same digest.

When scanners disagree, compare their inputs before arguing about conclusions. Did they inspect the same manifest and platform? Did both have access to the same advisory data? Did one use the source lockfile while another inspected package databases? Did either exclude development packages or ignored paths? The difference may reveal a coverage gap that needs deliberate treatment.

## How Do Base Images Make Vulnerability Work Continuous?
<!-- section-summary: Applications inherit the base image's packages and history; digest pinning controls change, while regular reviewed rebuilds are still required to adopt repairs and replace vulnerable artifacts. -->

An application image inherits a large part of its software supply chain from the base. Even if the team adds only one binary, the final artifact may include a distribution, runtime, certificates, system libraries, and package metadata selected by another publisher.

That inheritance creates base-image risk. A vulnerability in an operating-system library can affect every application image derived from the same digest. A compromised publisher or unexpected mutable tag can influence many builds. Inventory should therefore show which base was used and which packages it contributed.

Base-image drift occurs when a mutable reference resolves differently at different build times:

```dockerfile
FROM company/python:3.14
```

The tag may receive repaired packages, which is useful, but it also means the same application revision can produce different bytes. Testing one build does not automatically transfer to a later rebuild.

A digest-pinned reference controls that variation:

```dockerfile
FROM company/python:3.14@sha256:AAA
```

Now a change to the base is visible in source review. Pinning gives reproducibility and evidence continuity. It does not install future patches. The organization must monitor the pinned digest, select an updated trusted base, rebuild, retest, rescan, and release the new application digest.

This is why pinning and updating are complementary. Floating silently is not a maintenance plan, and pinning forever is not a maintenance plan. The desired loop is controlled change:

```text
new base or advisory
  -> identify affected application digests
  -> review replacement base digest
  -> rebuild once
  -> test and scan final artifact
  -> publish new SBOM and evidence
  -> promote new digest
```

Base components also create ownership questions. The application team may own deployment, a platform team may select the approved base family, and the base publisher may provide package repairs. A finding needs a coordinator who can move work across those boundaries rather than remaining unassigned because “it came from the base.”

Trust information ages at different speeds. The digest remains the identity of fixed content. An SBOM can remain a useful inventory record but may be corrected or regenerated. A signature remains cryptographically valid unless its key trust changes. Provenance describes a historical build. Vulnerability results become stale quickly as intelligence changes. Policy should account for these different clocks.

The maintenance process should work across a fleet, not one image at a time. Index the relationship from base digest to child application digests and from application digest to deployed workload. When a base advisory arrives, responders can enumerate affected artifacts, prioritize public or privileged services, and trigger controlled rebuilds. Without those relationships, every team must rediscover whether it inherited the component.

Rebuilding is necessary even when the vulnerable package is “only in the base.” Containers do not receive operating-system updates from a host package manager after publication. The repaired bytes must enter a new image, and the workload must move to that new digest. A successful rebuild that is never promoted leaves production exposure unchanged.

## How Do Reachability and Ownership Turn Findings into Decisions?
<!-- section-summary: A vulnerability record becomes actionable only after teams consider affected component, runtime reachability, exposure, fix options, owner, deadline, and any bounded exception or VEX statement. -->

A scanner finding is evidence, not a complete risk decision. It normally says that a component and version are associated with a vulnerability record. It does not automatically prove that an attacker can reach the affected code in this workload or that exploitation would have the same impact in every environment.

Severity is important but different from reachability. A critical vulnerability in an unused command-line tool may be less immediately exploitable than a lower-severity flaw on a public request path. Conversely, “we do not call that function” is weak assurance if untrusted input, dynamic loading, or future code paths can still reach it.

A useful triage record asks:

- Is the component actually present in the final image?
- Which layer, file, or dependency brought it in?
- Is the vulnerable function or behavior reachable?
- Is the workload externally exposed or reachable from sensitive peers?
- What privilege and data does the process hold?
- Is a fixed package or base available?
- Who owns the application, base, or dependency decision?
- By when will the team rebuild, mitigate, or reassess?

Ownership turns detection into work. A finding tied only to a registry repository can sit indefinitely. A finding linked to a service, production deployment, team, and escalation path has somewhere to go.

![Finding triage loop infographic showing a vulnerability finding moving through source, reachability, owner, fix or exception, and new digest decisions for payments-api](/content-assets/articles/article-devsecops-container-image-security-image-scanning/finding-triage-loop.png)

VEX, or vulnerability exploitability exchange, addresses a related question. It communicates a statement such as affected, not affected, fixed, or under investigation for a specific product and vulnerability, with reasoning. VEX does not replace the SBOM: inventory describes components, while VEX records an exploitability position.

A “not affected” statement needs scope and evidence. It should identify the exact artifact or product version, vulnerability, justification, issuer, and time. Application changes, image rebuilds, or new exploitation knowledge can invalidate it. Treat it as versioned decision evidence rather than a permanent dismissal.

The outcome can be a rebuild, configuration mitigation, runtime containment, exposure reduction, accepted bounded exception, or confirmation that the finding does not apply. Each outcome should retain the digest and owner. A rebuilt image is a new artifact, so the decision for `sha256:ABC` does not automatically transfer to `sha256:DEF` without checking their relationship.

Risk decisions should be reversible and observable. If the team temporarily mitigates a reachable vulnerability by disabling a feature or blocking a route, record how monitoring proves that control remains active. If it accepts risk until a vendor fix, give the exception an expiry and named reviewer. If evidence later shows the vulnerable path is reachable, replace the earlier “not affected” assessment rather than leaving contradictory records.

The deployed environment can change reachability without changing the image. A service may become public, receive a new credential, join a more trusted network, or begin processing attacker-controlled documents. Runtime context should therefore be part of reevaluation. SBOM and digest identity supply stable artifact facts; service topology and data flow supply changing exposure facts.

## What Do Signatures and Attestations Actually Prove?
<!-- section-summary: A signature binds an approved identity to exact bytes, while an attestation signs a structured claim about those bytes; both require policy and trusted issuers to become meaningful. -->

An SBOM does not prove that it is accurate merely because it exists. A JSON document can claim to describe any image. The trust system needs a way to bind evidence to the exact artifact and identify who made the claim.

A signature is a cryptographic statement over content identity. In plain language:

```text
the holder of this trusted signing identity approved sha256:ABC
```

An attestation is a signed statement about the artifact. It has a subject and a predicate. Examples include:

```text
subject: sha256:ABC
claim: built by protected workflow release.yml at source revision 123
```

or:

```text
subject: sha256:ABC
claim: SBOM document D describes this artifact
```

The distinction is useful: a signature primarily answers who endorsed these bytes, while an attestation carries a particular verifiable sentence about them. Implementations may package these concepts together, but policy should still know which claim it is relying on.

Neither proves that the software is secure. A trusted signer can approve vulnerable code. A compromised build can honestly attest that it ran. A malicious artifact can be signed by an untrusted key. Cryptography provides integrity and issuer identity under stated assumptions; security policy decides whether the issuer, workflow, claim, and context are acceptable.

Trust is therefore a policy decision over evidence:

```text
allow deployment when
  digest is exact
  AND signer is approved for this repository
  AND provenance names an approved builder and source
  AND required SBOM exists for the same digest
  AND vulnerability decision meets environment policy
```

Key or identity trust requires lifecycle controls. The verifier needs approved issuers, expected repository or workflow scope, time and transparency evidence where used, revocation or compromise response, and protection against one project signing another project's artifacts. “Signature valid” is only one condition.

Attestation freshness varies by claim. Build provenance is historical and should not change for fixed bytes. A vulnerability assessment is time-sensitive. An SBOM may be regenerated by a better tool, but the issuer and method should be clear. Policy should not treat every signed document as equally current or authoritative.

## How Should CI Build and Publish the Evidence Bundle?
<!-- section-summary: CI is where artifact and evidence are born, so it should build once, capture the pushed digest, generate subject-bound inventory and provenance, scan, sign, and promote that same digest. -->

CI observes the source revision, dependency resolution, builder, commands, environment, test results, final image, and registry push. It is the natural place to create evidence, provided the workflow and runner are themselves protected.

The strongest release pattern is build once and promote the same artifact. Do not rebuild source independently for staging and production. A second build can resolve a different base tag, dependency, external download, clock-dependent input, or compromised environment. Even when source is unchanged, the digest can differ.

```text
reviewed source
  -> one controlled build
  -> payments-api@sha256:ABC
  -> tests and staging use sha256:ABC
  -> production policy evaluates sha256:ABC
  -> production runs sha256:ABC
```

After pushing, capture the registry's exact digest. Generate or attach the final-image SBOM to that subject. Preserve source/build inventory where useful. Scan the digest. Record provenance identifying source revision and builder. Sign the digest or produce the required approval attestation. Publish evidence next to the image in the registry or another content-addressed store.

The registry then becomes more than an image warehouse. It can retain the artifact and related SBOM, signature, provenance, and scan or VEX evidence. Co-location is convenient, but exact subject identity is the essential link.

CI should not merely upload files named after a tag. It should verify that every document names the same digest and that the digest has not changed between scan, sign, and push steps. If signing occurs before registry resolution, reconcile the local and remote subjects explicitly.

The evidence bundle also needs access and retention controls. Builders require narrow push and attachment rights. Runtime consumers generally need pull and verification rights, not authority to replace evidence. Incident responders need historical access even after a release stops serving traffic.

Policy at deployment should verify again. The artifact may have been valid at build time but later quarantined, its signer may no longer be trusted, required evidence may be absent, or a new vulnerability decision may block production. Checking only in CI leaves a gap between production and consumption.

Evidence publication should fail clearly. If SBOM generation, provenance signing, or registry attachment fails, the workflow should not substitute an unlabeled empty document or promote only the image. The image and evidence are separate objects, so transaction-like behavior must come from pipeline and policy: publish the artifact into a non-production state, attach and verify the required claims, then make it eligible for promotion.

Protect the identity that issues evidence. It should be available only to the approved workflow, for the expected repository and revision, and for a short build session. A developer's broad personal key or a long-lived secret on a shared runner weakens every downstream verification. The verifier should check issuer, subject, repository, workflow, and expected claims rather than accepting any valid organizational signature.

## What Does an End-to-end Image Trust Chain Look Like?
<!-- section-summary: Image trust is a continuing chain from source and base through one digest-bound build and evidence bundle to deployment verification, runtime inventory, rescanning, triage, and rebuild. -->

Suppose Alice changes the payments API. The complete chain is:

1. Source review identifies the intended change and dependency updates.
2. The build resolves a reviewed base and locked application graph.
3. A protected workflow builds one final image.
4. The registry returns `sha256:ABC` for the pushed artifact.
5. CI creates source and final-image inventory for that digest.
6. The scanner evaluates current intelligence against its components.
7. Provenance states which source and builder produced it.
8. The approved identity signs or attests the digest and claims.
9. Staging tests the same digest.
10. Deployment policy verifies identity, provenance, inventory, and risk decision.
11. Runtime inventory records which service and environment run `sha256:ABC`.
12. Continuous rescanning creates new work when knowledge changes.

![Image trust summary infographic showing inventory, vulnerabilities, provenance, signature, evidence bundle, and deploy policy around a payments-api image](/content-assets/articles/article-devsecops-container-image-security-image-scanning/image-trust-summary.png)

After deployment, SBOMs become particularly valuable. When an advisory names a library, the organization can search inventories, find affected image digests, map those digests to deployments, and identify owners. That shortens the path from a global disclosure to concrete services.

Do not ask only “is the image vulnerable?” Ask a set of narrower questions:

- Which exact artifact is this?
- What components does current evidence say it contains?
- Which known vulnerabilities match those components now?
- Which findings are reachable in this service and environment?
- Who produced and approved the artifact?
- Does provenance describe the expected source and builder?
- Which signer or attester is trusted for this repository?
- Where is this digest deployed, and who owns the response?
- Is the evidence still fresh enough for the policy decision?

The trust chain can fail at any link. An exact digest without inventory is identifiable but opaque. An SBOM without subject identity may describe something else. A scan without current data can miss a new issue. A signature without trusted scope is meaningless. Provenance without protected build controls can document a compromised process. CI approval without deployment verification can be bypassed by another artifact.

The core model is:

```text
artifact identity
  + component inventory
  + current vulnerability knowledge
  + reachability and ownership decision
  + build provenance
  + trusted signature or attestation
  + deployment policy
  + runtime location and continuous review
  = evidence-based image trust
```

Trust is not a one-time sticker placed on an image. The bytes stay fixed, while vulnerability intelligence, deployment location, owner, issuer trust, and policy can change. Preserve the historical evidence, reevaluate the current decision, and create a new digest when remediation changes the artifact.

The operational view should be queryable in both directions. Starting from a vulnerability, responders find components, digests, deployments, environments, and owners. Starting from a deployment, operators find its digest, source, builder, SBOM, scan history, signer, exceptions, and replacement status. Starting from a compromised build identity, security staff find every digest and attestation it issued. These queries are why structured evidence and exact subjects matter more than a pile of human-readable reports.

When a digest is replaced, keep its relationship to the successor. The old artifact may still appear in a dormant cluster, cached node, rollback record, or retained release. Marking a new digest approved does not make the old one disappear. Runtime inventory and registry retention should show where each remains and whether it is still eligible for deployment.

## Check Your Answers

:::expand[Why Must Image Trust Begin with Exact Artifact Identity?]{kind="recap"}
Tags are human labels that may move, while a digest identifies exact content and gives every inventory, scan, claim, deployment, and incident record the same subject.
:::

:::expand[How Do SBOMs Describe What an Image Contains?]{kind="recap"}
An SBOM is component inventory, and source/build plus final-image SBOMs provide complementary views across declared dependencies, inherited packages, layers, and copied files.
:::

:::expand[Why Can Scanning the Same Image Produce New Results?]{kind="recap"}
Scanning joins stable artifact contents with changing vulnerability intelligence and detection logic, so an unchanged digest can receive new or corrected findings later.
:::

:::expand[How Do Base Images Make Vulnerability Work Continuous?]{kind="recap"}
Applications inherit base components; digest pinning makes change explicit, while monitoring and regular reviewed rebuilds adopt fixes and produce new evidence-bound artifacts.
:::

:::expand[How Do Reachability and Ownership Turn Findings into Decisions?]{kind="recap"}
Severity alone is incomplete: triage confirms presence, reachability, exposure, impact, fix, owner, deadline, and any narrowly supported VEX or exception decision.
:::

:::expand[What Do Signatures and Attestations Actually Prove?]{kind="recap"}
A signature endorses exact bytes and an attestation signs a claim about them; policy must still validate the issuer, scope, workflow, evidence, and current context.
:::

:::expand[How Should CI Build and Publish the Evidence Bundle?]{kind="recap"}
Protected CI should build once, capture the pushed digest, create and bind inventory, scans, provenance, and approval evidence to it, then promote that same artifact.
:::

:::expand[What Does an End-to-end Image Trust Chain Look Like?]{kind="recap"}
The chain follows one digest from source and base through build evidence and deployment policy into runtime inventory, continuous rescanning, ownership, and repaired rebuilds.
:::
