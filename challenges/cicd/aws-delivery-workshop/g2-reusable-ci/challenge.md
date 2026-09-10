---
title: "Replace copied CI with a versioned workflow interface"
sectionSlug: replace-copied-ci-with-a-versioned-workflow-interface
order: 2
revision: 1
---

## Description

Orders and Billing maintain copied CI workflows, so fixes reach one service but not the other. Orders uses Node 22 and Billing’s approved runtime is Node 24; both need to deliver a compiled package to a downstream job without depending on the shared workflow’s internal job names.

As the platform engineer, create a reusable CI interface and migrate both callers. The caller files represent separate repositories, not two workflows to install in one repository.

## Requirements

1. **Reusable Interface**. Accept each caller’s supported Node runtime through a typed workflow input.
2. **Shared Build**. Keep checks and package creation in the shared workflow while preserving each service’s selected runtime.
3. **Public Artifact Output**. Publish the compiled archive and expose its artifact name through the reusable workflow’s outputs.
4. **Caller Migration**. Update both callers and their downstream consumers to use the public output rather than internal job names.

:::expand[Workspace and verification]{kind="note"}

Editable files: `.github/workflows/reusable-ci.yml`, `orders/.github/workflows/ci.yml`, `billing/.github/workflows/ci.yml`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
