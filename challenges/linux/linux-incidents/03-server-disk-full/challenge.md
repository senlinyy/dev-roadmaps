---
title: "Server Disk Full"
order: 3
---

The host is nearly out of space after log rotation, but the visible log directory looks small. You start in `/home/dev`. A brief restart of `logwriter` is approved; deleting application data or current logs is not.

Your job:

1. **Compare filesystem space, inode availability, and visible directory usage** on the root filesystem.
2. **Inspect running processes and deleted-open files** to account for the missing space.
3. **Recover at least 500 MB** without deleting `/srv/data/orders.db` or `/var/log/logwriter/current.log`.
4. **Verify the service is running, no deleted-open descriptors remain, and space is available.**

The grader checks diagnosis and recovered state. Disk accounting includes authored file sizes and held-open inodes. The lab simulates service restarts, not live processes or block allocation failures.
