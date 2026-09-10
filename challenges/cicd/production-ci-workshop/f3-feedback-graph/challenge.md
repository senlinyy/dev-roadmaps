---
title: "Move expensive packaging behind independent checks"
sectionSlug: move-expensive-packaging-behind-independent-checks
order: 3
revision: 1
---

## Description

The Orders pipeline performs expensive packaging before reporting lint and test failures. Its downstream inspection job also expects build files from another runner, so a successful producer does not guarantee the package is available to the consumer.

As the CI maintainer, redesign the job graph to provide earlier feedback and transfer the package explicitly across isolated workspaces.

## Requirements

1. **Independent Checks**. Run lint and unit tests as independent jobs that can overlap.
2. **Packaging Gate**. Allow packaging only after both checks succeed; do not spend packaging time on a known-failing change.
3. **Artifact Handoff**. Publish a named package archive and download it in a fresh downstream inspection job. Do not transfer `node_modules`.
4. **Consumer Verification**. Verify the downloaded archive’s contents without relying on files left by another job.

:::expand[Workspace and verification]{kind="note"}

Editable files: `.github/workflows/ci.yml`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
