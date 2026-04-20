---
title: "Check Disk and Inode Usage"
sectionSlug: inodes-df-and-du
order: 2
---

Disk space is not the only resource that can run out. Every filesystem has a fixed number of inodes, and creating thousands of tiny files can exhaust them even when plenty of bytes remain. Combine `df -h`, `df -i`, and `du` to diagnose both space and inode pressure.

You start in `/home/dev`. Your job:

1. **Run `df -h`** to see disk space usage across all filesystems.
2. **Run `df -i`** to check inode usage and identify which mount has dangerously high inode consumption.
3. **Run `du -sh /data/*`** (or `du --max-depth=1 -h /data`) to find which subdirectory under `/data` is the largest.
4. **Use `find`** to count the files inside `/data/cache` (e.g., `find /data/cache -type f`).

The grader requires you to use `df` and `du`, and that your output contains disk usage values plus references to `cache` and `logs`.
