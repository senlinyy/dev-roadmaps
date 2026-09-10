---
title: "Reproduce the build on a clean runner"
sectionSlug: reproduce-the-build-on-a-clean-runner
order: 1
revision: 1
---

## Description

The Orders application builds on a developer’s laptop, but its first clean CI run cannot find the compiler. A previous workaround installed tools globally, leaving the build dependent on machine setup rather than the repository’s package files and lockfile.

As the engineer responsible for CI, repair the workflow and package scripts so a fresh runner can reproduce the build. Use `evidence/build.log` to investigate the failure.

## Requirements

1. **Runner Setup**. Use a fresh Node 22 runner and check out the repository without relying on developer files or a previous workspace.
2. **Dependency Installation**. Install from the committed lockfile. Do not install tools globally, restore `node_modules`, or commit installed dependencies.
3. **Build and Checks**. Configure package scripts and workflow steps to run lint, tests, and compilation using repository-managed tools.
4. **Lockfile Enforcement**. Ensure installation fails when a manifest dependency changes without a corresponding lockfile update.

:::expand[Workspace and verification]{kind="note"}

Editable files: `.github/workflows/ci.yml`, `package.json`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
