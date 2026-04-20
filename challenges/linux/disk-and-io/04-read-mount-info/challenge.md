---
title: "Read Mount and Filesystem Info"
sectionSlug: mount-points-and-etcfstab
order: 4
---

The `/etc/fstab` file is the blueprint for how a Linux system mounts its filesystems at boot. Reading and interpreting it is essential for understanding any server's storage layout: which devices mount where, what filesystem types are in use, and what options govern their behavior.

You start in `/home/dev`. Your job:

1. **Read `/etc/fstab`** to see all configured filesystem entries, both active and commented-out.
2. **Find the swap partition** entry in the file and note how it is identified (hint: it uses a UUID).
3. **Run `df -T`** to display currently mounted filesystems with their types.
4. **Search `/etc/fstab` for any NFS entries** using `grep`.

The grader requires you to use `cat`, `grep`, and `df`, and that your output contains references to all filesystem types found in fstab: `ext4`, `xfs`, `swap`, and `nfs`.
