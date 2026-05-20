---
title: "Artifact Integrity"
description: "Prove that the package, image, or bundle you deploy is the one produced by the trusted build."
overview: "Artifact integrity connects source, build, registry, and deployment. This article explains digests, checksums, provenance, signatures, and the Codecov and SolarWinds cases as real lessons in trusting build outputs."
tags: ["artifacts", "checksums", "provenance", "signing"]
order: 6
id: article-devsecops-pipeline-security-artifact-integrity
---

## Table of Contents

1. [What Is an Artifact?](#what-is-an-artifact)
2. [Names, Tags, and Digests](#names-tags-and-digests)
3. [Checksums](#checksums)
4. [Provenance](#provenance)
5. [Signatures](#signatures)
6. [Case Study: Codecov](#case-study-codecov)
7. [Deployment Evidence](#deployment-evidence)
8. [Putting It All Together](#putting-it-all-together)

## What Is an Artifact?

An artifact is the thing a build produces and another system consumes. It may be a package, container image, binary, deployment bundle, Terraform plan, SBOM, provenance file, or rendered manifest. Source code starts the path, but the artifact is usually what moves toward production.

For `devpolaris-orders-api`, the main artifact is a container image.

```text
source commit
  -> build workflow
  -> container image
  -> registry
  -> deployment
  -> running service
```

Artifact integrity asks whether the artifact that reached deployment is the artifact the trusted build produced. If someone can replace the artifact between build and deploy, source review no longer tells the whole story.

## Names, Tags, and Digests

Container images have names, tags, and digests.

```text
Name:   ghcr.io/devpolaris/orders-api
Tag:    2026.05.19.1
Digest: sha256:4e1b9f30d4a97a7f5c3f4c7f1f3a0f2c9e86b4d4a4e4d0a9a3f0e1c2b7c8d9a0
```

The name tells you where the artifact lives. The tag is a human-friendly label. The digest identifies the content. Tags can move. Digests are content-addressed.

Deploying by tag is convenient:

```yaml
image: ghcr.io/devpolaris/orders-api:latest
```

Deploying by digest is more reviewable:

```yaml
image: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30d4a97a7f5c3f4c7f1f3a0f2c9e86b4d4a4e4d0a9a3f0e1c2b7c8d9a0
```

The digest lets the team compare the build output, registry record, and running service.

## Checksums

A checksum is a short value calculated from file content. If the content changes, the checksum changes. Checksums are useful for detecting accidental or malicious changes to files during transfer or storage.

```text
orders-api.tar.gz
sha256: 89f2b2d14c3a0ad4f7b3b66d3a4f15b11a6c3c57c8e2d9e1a6e7f7d4c4b2a100
```

The checksum proves content equality, not trust by itself. If an attacker can change both the file and the checksum published beside it, the checksum no longer helps. This is why checksums are often paired with signatures, protected release pages, or provenance.

## Provenance

Provenance records how an artifact was built.

```text
Artifact: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
Source: github.com/devpolaris/orders-api
Commit: 8f2a91d4c0b8
Workflow: orders-api-delivery
Run: #1842
Builder: GitHub Actions hosted runner
```

The source tells you where the build came from. The commit tells you the exact source version. The workflow and run identify the automation. The builder identifies the environment that produced the artifact.

Provenance is useful when deployment asks, "Where did this artifact come from?" It is also useful when incident response asks, "Which builds included the affected dependency?"

## Signatures

A signature lets a verifier check that a trusted identity signed an artifact or provenance statement. Signing does not make bad code good. It proves which identity endorsed the artifact.

```text
Artifact digest: sha256:4e1b9f30...
Signed by: orders-release-identity
Verified for: production deployment
```

The verifier should check the signature identity and the artifact digest. A valid signature from the wrong identity should fail. A valid signature over a different digest should fail. A deployment policy can then require signatures from approved release identities before production accepts an image.

## Case Study: Codecov

Codecov's April 2021 postmortem described a compromise of its Bash Uploader. Many users ran that uploader inside CI. The modified uploader could collect credentials from CI environments. The case matters for artifact integrity because a script or binary downloaded during CI can become part of the trusted build path.

Read the path:

```text
CI job
  -> downloads uploader
  -> executes uploader
  -> uploader can read CI environment
  -> credentials leave the job
```

The integrity question is whether the thing downloaded and executed is the thing the team intended to trust. A checksum, signature, pinned version, package-manager source, or vendor-provided action can help. The stronger control is to reduce what the downloaded tool can read. If a coverage upload job does not need production secrets, keep those secrets out of the job.

SolarWinds gives a different artifact lesson. The SUNBURST compromise involved malicious code entering signed software updates. That shows the limit of signature thinking: a signature proves an artifact came through a signing path, but the signing path itself also needs protection.

## Deployment Evidence

A deployment record should connect artifact identity to production.

```text
Service: devpolaris-orders-api
Commit: 8f2a91d4c0b8
Built artifact: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
Provenance: verified
Signature: orders-release-identity verified
Deployed artifact: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
Environment: production
Result: healthy
```

The `Built artifact` and `Deployed artifact` lines should match. The provenance and signature lines explain why the deployment accepted the artifact. The result shows whether production came back healthy.

If the deployed digest differs from the built digest, stop and explain the gap. It may be a manual deployment, tag movement, rebuild, or registry issue. The evidence should make that visible.

## Putting It All Together

Artifact integrity is the bridge between trusted build and trusted deployment. Names and tags help humans. Digests identify content. Checksums detect changes. Provenance explains how an artifact was built. Signatures let deployment verify an identity.

Codecov shows why downloaded tooling and CI environment boundaries matter. SolarWinds shows why a signed artifact still depends on the security of the build and signing path. For `devpolaris-orders-api`, the practical habit is to deploy immutable digests, preserve provenance, verify release identity, and keep deployment evidence that compares build output with running production.

---

**References**

- [Codecov April 2021 postmortem](https://about.codecov.io/apr-2021-post-mortem/) - Codecov documents the Bash Uploader compromise and customer guidance.
- [Microsoft analysis of Solorigate/SUNBURST](https://www.microsoft.com/en-us/security/blog/2020/12/18/analyzing-solorigate-the-compromised-dll-file-that-started-a-sophisticated-cyberattack-and-how-microsoft-defender-helps-protect/) - Microsoft analyzes the compromised signed DLL used in the SolarWinds attack.
- [SLSA provenance specification](https://slsa.dev/spec/v1.0/provenance) - SLSA defines provenance fields for build inputs, builder, and artifact outputs.
- [Sigstore Cosign documentation](https://docs.sigstore.dev/cosign/overview/) - Sigstore documents signing and verifying container images and other artifacts.
