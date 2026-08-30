---
title: "Which Version Will APT Choose?"
sectionSlug: how-do-third-party-sources-and-pins-change-risk
order: 4
revision: 1
---

An Nginx update is scheduled, but the maintenance ticket does not say which version APT will select or which installed package owns the running binary. Confirm the plan before anyone upgrades the host.

You start in `/home/dev`. Your job:

1. **Compare the installed and candidate Nginx versions.**
2. **Confirm the package that owns the server binary.**
3. **Show the package in the upgrade preview** without changing installed state.

The grader checks the candidate, repository, ownership, and upgrade evidence.
