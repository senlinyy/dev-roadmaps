---
title: "The Invisible Log File"
sectionSlug: how-do-space-inodes-and-open-files-explain-capacity
order: 10
revision: 1
---

The root filesystem remains at 92% usage after an operator deleted the large `orders-api` log. The visible files below `/var/log` are now small, so identify the process that still holds a deleted file open.

You start in `/home/dev`. Your job:

1. **Confirm filesystem usage** for the root path.
2. **Measure the visible log directory** and confirm that it does not explain the filesystem total.
3. **List open files whose link count has fallen below one** and identify the process, PID, and deleted pathname.

The grader checks the conflicting capacity evidence and the deleted-open-file inspection.
