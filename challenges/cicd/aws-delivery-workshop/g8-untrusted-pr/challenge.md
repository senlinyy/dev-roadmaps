---
title: "Remove privileged execution from contributor-controlled code"
sectionSlug: remove-privileged-execution-from-contributor-controlled-code
order: 8
revision: 1
---

## Description

The Orders `pull_request_target` workflow checks out contributor-controlled code, interpolates the PR title into a shell command, and can request AWS credentials. An untrusted contribution therefore reaches execution with trusted repository authority.

As the platform engineer, separate ordinary PR validation from trusted release execution while retaining useful contributor checks.

## Requirements

1. **PR Execution Context**. Use `pull_request` for contributor validation with read-only repository permissions.
2. **Checkout Credentials**. Disable token persistence so checked-out contributor code does not retain repository credentials.
3. **Untrusted Text**. Pass contributor-controlled fields such as the PR title as data rather than interpolating them into shell source.
4. **Release Boundary**. Keep OIDC requests, deployment roles, secrets, and AWS operations out of the PR job; release execution belongs in the trusted workflow.

:::expand[Workspace and verification]{kind="note"}

Editable files: `.github/workflows/pr.yml`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
