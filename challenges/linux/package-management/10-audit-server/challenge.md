---
title: "Audit an Inherited Server"
sectionSlug: how-do-removal-rollback-and-audit-differ
order: 10
revision: 1
---

You are taking ownership of a small Ubuntu server with incomplete build records. Before approving patching work, create a package-management evidence trail for its installed tools and one internal binary.

You start in `/home/dev`. Your job:

1. **Inventory the installed packages and versions.**
2. **Prove which package owns the health-check client.**
3. **Locate the internal backup command.**
4. **Test whether the package database owns that internal binary.**
5. **Compare the installed and candidate OpenSSL versions** and identify its source.

The grader checks the managed inventory, file ownership, unmanaged binary evidence, and security candidate.
