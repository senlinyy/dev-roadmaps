---
title: "Set Safe Defaults for New Files"
sectionSlug: how-do-chmod-ownership-and-umask-shape-access
order: 7
revision: 1
---

A deployment workspace currently creates group-writable files. New reports should be private to the owner except for group read access, and new directories should allow the group to list and traverse without writing.

You start in `/home/dev`. Your job:

1. **Inspect the current creation mask.**
2. **Set a mask that removes group write and all access for others.**
3. **Create `/home/dev/report.txt` and `/home/dev/reports`.**
4. **Inspect both objects** to verify the resulting file and directory modes.

The grader checks the active mask and the modes produced by normal creation, not modes repaired afterward.
