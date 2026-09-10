---
title: "Promote staging-tested bytes without rebuilding"
sectionSlug: promote-staging-tested-bytes-without-rebuilding
order: 7
revision: 1
---

## Description

Orders passes staging verification, but production performs another Docker build after a human approves the release. The approval therefore refers to staging evidence for different bytes than those deployed to production.

As the release engineer, use the supplied publication job to promote one image through staging and protected production without rebuilding.

## Requirements

1. **Immutable Promotion**. Make both environments consume the same digest-based image output from the build job.
2. **Staging Verification**. Deploy and smoke-test staging before production becomes eligible; a staging failure must block production.
3. **Production Approval**. Require successful staging and the protected production environment’s approval before production deployment.
4. **Deployment Receipts**. Complete the deployment helper and capture each environment’s task-definition receipt, keeping both tied to the same image.

:::expand[Workspace and verification]{kind="note"}

Editable files: `.github/workflows/release.yml`, `scripts/deploy.sh`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
