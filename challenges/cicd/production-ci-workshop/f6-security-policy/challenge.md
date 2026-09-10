---
title: "Make vulnerability policy explicit and reviewable"
sectionSlug: make-vulnerability-policy-explicit-and-reviewable
order: 6
revision: 1
---

## Description

The Orders release process runs Trivy but ignores its exit status. Its ignore file also contains a permanent exception with no owner or expiry, so a green release does not demonstrate compliance with the team’s vulnerability policy.

As the release engineer, turn scanning into an enforceable gate with reviewable evidence and explicitly controlled exceptions.

## Requirements

1. **Vulnerability Gate**. Fail the gate for HIGH and CRITICAL findings that are not covered by an approved exception.
2. **Scan Evidence**. Retain JSON scan results and a CycloneDX SBOM even when the gate blocks the release.
3. **Exception Policy**. Remove the unapproved ignore entry. Any exception must identify the vulnerability, owner, reason, and future expiry; none are preapproved.
4. **Image Identity**. Scan the supplied image reference without rebuilding or substituting another image.

:::expand[Workspace and verification]{kind="note"}

Editable files: `scripts/scan.sh`, `.trivyignore.yaml`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
