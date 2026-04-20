---
title: "Explore Block Devices and Mounts"
sectionSlug: block-devices-and-lsblk
order: 1
---

Every Linux disk is represented as a block device under `/dev/`. The `lsblk` command shows how physical disks are partitioned, while `/etc/fstab` records which partitions mount where at boot. Combine these with `df` to get a complete picture of your storage layout.

You start in `/home/dev`. Your job:

1. **Run `lsblk`** to see the block device layout and identify all disks and partitions.
2. **Read `/etc/fstab`** to find which filesystem type the `/data` mount uses.
3. **Run `df -h`** to check current disk space usage across all mounts.
4. **Find which mount has the `noatime` option** by searching through `/etc/fstab`.

The grader requires you to use `lsblk`, `cat`, and `df`, and that your output contains information about both disks, the `/data` mount, its filesystem type, the `noatime` option, and `/boot`.
