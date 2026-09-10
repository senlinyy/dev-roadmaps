---
title: "Copy the approved image across accounts without changing its digest"
sectionSlug: copy-the-approved-image-across-accounts-without-changing-its-digest
order: 6
revision: 1
---

## Description

Orders staging and production use ECR repositories in different AWS accounts. Promotion currently rebuilds the source in production, so staging evidence no longer proves the identity of the production image.

As the release engineer, copy the approved image between registries without rebuilding, using the administrator-supplied AWS role profiles.

## Requirements

1. **Source Selection**. Select the approved source image by digest rather than a mutable tag.
2. **Image Preservation**. Copy registry-to-registry while preserving all platform manifests and the approved digest.
3. **Destination Verification**. Verify that the destination digest matches before exposing it for deployment. Print only the verified destination image reference.
4. **Scoped Permissions**. Limit source permissions to the necessary repository reads and destination permissions to the necessary repository writes.

:::expand[Workspace and verification]{kind="note"}

Editable files: `scripts/promote-image.sh`, `iam/source-policy.json`, `iam/destination-policy.json`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
