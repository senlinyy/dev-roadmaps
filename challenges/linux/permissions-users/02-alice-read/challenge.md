---
title: "Why Can't Alice Read It?"
sectionSlug: what-do-rwx-permissions-mean-for-files-and-directories
order: 2
revision: 1
---

Alice is already an active member of the `analysts` group, but `/srv/secure/secrets.txt` still returns `Permission denied`. The file should remain owned by root and must not become readable to everyone.

You are logged in as Alice. Your job:

1. **Reproduce the failed read** and inspect the file's current owner, group, and mode.
2. **Give the analysts group read access** while keeping root as the owner.
3. **Verify that Alice can read the file after the repair.**

The grader checks the failed-access evidence and the final least-privilege state. World-readable or world-writable repairs are rejected.
