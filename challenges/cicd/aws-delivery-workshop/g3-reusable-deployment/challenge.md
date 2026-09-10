---
title: "Give reusable deployment a protected environment boundary"
sectionSlug: give-reusable-deployment-a-protected-environment-boundary
order: 3
revision: 1
---

## Description

Orders has copied staging and production deployment jobs that accept arbitrary role ARNs and mutable image tags. A caller can choose AWS authority independently of its destination, and the ECS deployment helper has no stable interface.

As the platform engineer, replace these copies with a reusable deployment interface that uses the existing protected environments.

## Requirements

1. **Deployment Inputs**. Accept an environment and digest-based image reference; allow only `staging` or `production`.
2. **Environment Authority**. Select AWS authority from the destination’s protected environment settings, not a caller-supplied role ARN.
3. **ECS Helper**. Complete the deployment helper and reject mutable image references or images from another repository before deployment.
4. **Caller and Outputs**. Migrate the release caller and expose the deployed image and deployment receipt through the called workflow.

:::expand[Workspace and verification]{kind="note"}

Editable files: `.github/workflows/deploy.yml`, `.github/workflows/release.yml`, `scripts/deploy.sh`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
