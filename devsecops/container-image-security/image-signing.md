---
title: "Image Signing"
description: "Sign and verify container image digests so deployment can trust the release identity."
overview: "Image signing connects an image digest to a trusted identity. This article explains tags, digests, signatures, keyless signing, verification policy, and the 3CX case as a reminder that signing paths must also be protected."
tags: ["signing", "cosign", "provenance"]
order: 4
id: article-devsecops-container-image-security-image-signing
---

## Table of Contents

1. [What Signing Proves](#what-signing-proves)
2. [Sign the Digest](#sign-the-digest)
3. [Keyless Signing](#keyless-signing)
4. [Verification Policy](#verification-policy)
5. [Case Study: 3CX](#case-study-3cx)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## What Signing Proves

Image signing lets a verifier check that a trusted identity signed a specific image digest. The signature answers two questions:

```text
Which image digest was signed?
Which identity signed it?
```

For `devpolaris-orders-api`, a production deploy should accept images signed by the release workflow identity. It should reject unsigned images, images signed by the wrong identity, and images where the signature belongs to a different digest.

Signing does not prove that the application is bug-free. It proves that the artifact passed through a trusted release identity. That identity and release path still need protection.

## Sign the Digest

Sign digests, not mutable tags.

```text
Image tag:    ghcr.io/devpolaris/orders-api:prod
Image digest: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
```

The tag can move. The digest identifies content. A signature over the digest follows the exact artifact.

Release evidence should connect the signature to the build:

```text
Commit: 8f2a91d4c0b8
Workflow: orders-api-delivery #1842
Image: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
Signature identity: repo:devpolaris/orders-api:ref:refs/heads/main
Verification: passed
```

The `Signature identity` line is as important as the signature itself. A valid signature from an unexpected repository or branch should not satisfy production policy.

## Keyless Signing

Keyless signing uses a workload identity and transparency log instead of a long-lived private signing key managed by the team. In a GitHub Actions release workflow, the job can request an OIDC token and use that identity to sign the image.

```text
release workflow
  -> OIDC token
  -> signing service
  -> signature for image digest
  -> transparency log entry
```

This reduces the risk of a private signing key being copied from a secret store. The trust moves to the workflow identity and signing service. That means the workflow boundary matters. If untrusted code can reach the signing job, keyless signing can still endorse the wrong artifact.

## Verification Policy

Signing helps only when deployment verifies. A policy should say which identity may sign which artifact for which environment.

```text
Environment: production
Required image: ghcr.io/devpolaris/orders-api
Required signature identity: repo:devpolaris/orders-api:ref:refs/heads/main
Required provenance: yes
Reject: unsigned images, wrong repo, wrong ref, mutable tag without digest
```

This policy is readable. It says production accepts the orders image when it is signed by the release workflow from `main`. It rejects signatures from feature branches, personal forks, and unrelated repositories.

## Case Study: 3CX

Mandiant's reporting on the 3CX compromise describes a cascading software supply-chain incident where a compromised software package contributed to compromise of another vendor's software build environment. The affected 3CX desktop application was signed and distributed to users, which made the case an important reminder about artifact trust.

The lesson is that signatures are part of a chain. Users and operating systems may trust a signed application because it came from the expected vendor identity. If the vendor's build or release path is compromised before signing, the signature can end up attached to a malicious artifact.

Read the signing path:

```text
source and dependencies
  -> build environment
  -> release artifact
  -> signing identity
  -> customer install
```

The signature protects the handoff after signing. It does not replace hardening before signing. The build environment, dependency sources, release workflow, and signing identity all remain part of the security boundary.

## Putting It All Together

Image signing connects a digest to a trusted identity. Verification makes that signature useful at deployment time. For `devpolaris-orders-api`, production should deploy image digests, verify signatures from the release workflow identity, and record the verification result.

The 3CX case shows the larger lesson. Signed artifacts are easier to trust and trace, but the signing path itself must be protected. Signing belongs with runner isolation, provenance, dependency review, and registry controls.

## What's Next

Signed images still need a safe place to live. The next article covers registry security: who can push, which tags are mutable, how retention works, and which audit events matter during response.

---

**References**

- [Sigstore Cosign overview](https://docs.sigstore.dev/cosign/overview/) - Sigstore documents signing and verifying container images and other artifacts.
- [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) - GitHub explains workload identity that can support keyless signing workflows.
- [Mandiant: 3CX software supply-chain compromise](https://cloud.google.com/blog/topics/threat-intelligence/3cx-software-supply-chain-compromise) - Mandiant analyzes the 3CX compromise and cascading supply-chain behavior.
