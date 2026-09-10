---
title: "Verify the release producer before deployment"
sectionSlug: verify-the-release-producer-before-deployment
order: 10
revision: 1
---

## Description

Orders production accepts any correctly formatted image digest, and an image from an unrelated build has been submitted for approval. A digest identifies the selected bytes, but does not by itself establish who produced them.

As the platform engineer, add producer verification to the release path so deployment requires trusted provenance as well as immutable image identity.

## Requirements

1. **Provenance Generation**. Generate an attestation in the trusted publish job, bound to the published image digest.
2. **Producer Verification**. Verify the expected repository and signer workflow before deployment; fail closed when verification cannot establish that identity.
3. **Digest Validation**. Preserve the existing digest checks and reject an unrelated digest or untrusted producer before service mutation.
4. **Separate Evidence**. Keep provenance verification distinct from vulnerability scanning; scan results are not proof of the image’s producer.

:::expand[Workspace and verification]{kind="note"}

Editable files: `.github/workflows/release.yml`, `scripts/verify-producer.sh`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
