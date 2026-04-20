---
title: "Check Disk Space"
sectionSlug: disk-space-df-du-and-inode-exhaustion
order: 5
---

Checking how much space is used, and where, is a routine sysadmin task. `df` shows the filesystem-level view, `du` drills into specific directories, and `df -i` reveals inode usage.

You start in `/home/dev`. Your job:

1. **Run `df -hT`** to see mounted filesystems with human-readable sizes and types.
2. **Run `du -sh /var/log`** to check how much space the logs directory uses.
3. **Run `du -sh /var/*`** to get a per-directory breakdown under `/var`.
4. **Run `df -i`** to check inode usage across all filesystems.
5. As your final command, **check inode usage of the root filesystem** with `df -i /`.

The grader checks that you used `df` and `du`, and that your output contains the expected filesystem information.
