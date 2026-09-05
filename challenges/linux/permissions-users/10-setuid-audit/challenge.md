---
title: "Audit a Privileged Executable"
sectionSlug: when-do-acls-and-special-bits-extend-basic-permissions
order: 10
revision: 1
---

A legacy helper under `/usr/local/bin` unexpectedly carries setuid root. The application no longer depends on elevated identity, so the special bit should be removed while ordinary execution remains available.

You start in `/home/dev`. Your job:

1. **Find setuid files under `/usr/local/bin`** using a permission-bit search.
2. **Inspect the reported helper's complete mode and ownership.**
3. **Remove only the setuid bit** and verify that the executable remains mode `0755`.

The grader checks the audit command and the narrow final mode. Removing all execute access does not pass.
