---
title: "Diagnose an unschedulable release"
sectionSlug: diagnose-an-unschedulable-release
order: 2
revision: 1
---

## Description

The Orders release is queued for `linux && node22 && docker`. The inventory shows a healthy Node 22 host without Docker and an offline Docker host. Someone proposes adding controller executors, which would put repository code inside the controller’s security boundary.

As the Jenkins maintainer, match the job to a genuinely suitable agent. This package workflow requires Node 22 and `tar`, not Docker.

## Requirements

1. **Resource Requirements**. Remove the unnecessary Docker requirement and use a label expression satisfiable by a healthy agent with the required tools.
2. **Agent Configuration**. Correct the supplied agent declaration to reflect actual capabilities rather than adding misleading labels to make scheduling succeed.
3. **Controller Isolation**. Keep the controller executor count at zero; do not resolve the queue by running builds on the controller.
4. **SSH Verification**. Preserve SSH host-key verification instead of bypassing trust checks to bring an agent online.

:::expand[Workspace and verification]{kind="note"}

Editable files: `Jenkinsfile`, `jenkins.yaml`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
