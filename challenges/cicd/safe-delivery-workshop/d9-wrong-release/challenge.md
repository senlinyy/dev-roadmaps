---
title: "Recover the intended artifact after a green but incorrect release"
sectionSlug: recover-the-intended-artifact-after-a-green-but-incorrect-release
order: 9
revision: 1
---

## Description

Staging approved `orders:42`, but production runs `orders:43`, and the deployment receipts identify different image digests. Schema expansion is backward-compatible and the contract phase has not run, leaving a possible recovery path that still needs verification.

As the incident responder, trace the release mismatch, implement guarded recovery, and prevent mutable image selection from repeating the incident.

## Requirements

1. **Incident Evidence**. Preserve and trace the supplied receipts to identify the rebuild after staging approval and the resulting digest mismatch.
2. **Compatibility Review**. Check the supplied data/schema compatibility before selecting the verified known-good task definition for rollback.
3. **Guarded Recovery**. Reject unexpected current service state and recover to the verified image bytes without rebuilding.
4. **Future Validation**. Reject mutable image tags before deployment so later releases cannot silently replace the approved artifact.

:::expand[Workspace and verification]{kind="note"}

Editable files: `scripts/recover-release.sh`, `scripts/validate-image.sh`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
