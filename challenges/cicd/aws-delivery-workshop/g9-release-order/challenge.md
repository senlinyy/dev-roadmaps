---
title: "Reject a stale release after approval"
sectionSlug: reject-a-stale-release-after-approval
order: 9
revision: 1
---

## Description

Two Orders mainline releases are waiting for production approval. An older run can be approved last and overwrite a newer deployment, but cancelling a deployment already in progress is also unsafe. Team policy permits only the current protected `main` commit to start a new production deployment.

As the release engineer, enforce this policy at the approval-to-deployment boundary without claiming stronger ordering guarantees than the workflow provides.

## Requirements

1. **Production Serialization**. Use repository/service-specific production concurrency with `cancel-in-progress: false`.
2. **Post-Approval Freshness**. Check the approved run against the current protected `main` ref immediately before deployment, after approval.
3. **Stale Release Rejection**. Reject an older source commit before any service mutation rather than deploying it because it eventually received approval.
4. **Recovery Boundary**. Preserve an explicit rollback procedure. Do not rely on FIFO queue ordering or treat a ref check as an atomic cloud lock.

:::expand[Workspace and verification]{kind="note"}

Editable files: `scripts/check-current-release.sh`, `.github/workflows/release.yml`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
