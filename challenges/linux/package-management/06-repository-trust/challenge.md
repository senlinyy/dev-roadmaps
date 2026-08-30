---
title: "Quarantine an Untrusted Repository"
sectionSlug: how-do-repositories-establish-software-trust
order: 6
revision: 1
---

Package metadata refresh fails because an inherited vendor repository cannot prove its signature. The official Ubuntu source remains healthy, but policy forbids bypassing signature verification or importing an unknown key during the incident.

You start in `/home/dev`. Your job:

1. **Reproduce the metadata refresh failure** and identify the trust problem.
2. **Quarantine the vendor source file** by moving it to a disabled filename while preserving it for review.
3. **Refresh metadata again** using only the trusted official source.
4. **Confirm the vendor package has no current candidate** after its repository is disabled.

The grader checks that you observed the signature failure, preserved the source file, and restored a trusted package index.
