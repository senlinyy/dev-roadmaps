---
title: "Replace shared AWS access keys with scoped OIDC"
sectionSlug: replace-shared-aws-access-keys-with-scoped-oidc
order: 4
revision: 1
---

## Description

The production identity-check workflow uses long-lived AWS access keys stored as repository secrets. Their availability extends beyond the protected production boundary, and replacing them must not interrupt the existing identity check.

As the platform engineer, prepare an OIDC-based workflow and trust policy for an administrator to apply, with a safe sequence for retiring the old keys.

## Requirements

1. **Temporary Credentials**. Request an OIDC token from the protected production environment and assume only the supplied AWS role.
2. **Trust Conditions**. Constrain the trust policy to the supplied audience and exact environment subject; do not broaden it to other repositories or environments.
3. **Least Privilege**. Keep this workflow limited to STS identity inspection rather than adding deployment capabilities.
4. **Migration Verification**. Check that the intended identity succeeds and unauthorized repositories or environments are denied. Retire the old keys only after validation.

:::expand[Workspace and verification]{kind="note"}

Editable files: `.github/workflows/identity.yml`, `iam/trust.json`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
