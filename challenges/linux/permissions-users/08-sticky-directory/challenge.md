---
title: "Shared but Not Deletable"
sectionSlug: when-do-acls-and-special-bits-extend-basic-permissions
order: 8
revision: 1
---

`/shared` is intentionally writable by everyone, but users must not delete one another's files. The directory already carries the policy; you need to verify its behavior rather than weakening it.

You are logged in as Alice. Your job:

1. **Inspect `/shared` and identify its special directory bit.**
2. **Attempt to remove Bob's file** and confirm the operation is rejected.
3. **Create your own file in the same directory, then remove it successfully.**

The grader checks that Bob's file survives, Alice can clean up her own file, and the sticky directory mode remains unchanged.
