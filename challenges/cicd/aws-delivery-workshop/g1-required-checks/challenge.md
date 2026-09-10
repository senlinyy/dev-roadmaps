---
title: "Make required checks reliable for every pull request"
sectionSlug: make-required-checks-reliable-for-every-pull-request
order: 1
revision: 1
---

## Description

The Orders repository requires a check named `required`, but documentation-only pull requests remain pending because the workflow is path-filtered. A proposed shortcut would skip application tests for mixed documentation and code changes.

As the CI maintainer, restore a dependable merge gate for every pull request while keeping contributor workflows read-only.

## Requirements

1. **Workflow Coverage**. Make documentation-only, code-only, and mixed pull requests all produce a `required` conclusion. Prefer the application’s small unconditional check suite over fragile path skipping.
2. **Failure Reporting**. Ensure a failing application test makes `required` fail rather than reporting success or remaining pending.
3. **Repository Rule**. Keep the check name stable and record the matching required-check rule in `repository-settings.json`.
4. **PR Permissions**. Give untrusted pull requests only read access; do not introduce release credentials or elevated permissions.

:::expand[Workspace and verification]{kind="note"}

Editable files: `.github/workflows/ci.yml`, `repository-settings.json`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
