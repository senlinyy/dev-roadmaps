---
title: "Capacity or Mount Failure?"
sectionSlug: how-do-mounts-and-etcfstab-attach-storage
order: 5
---

Writes under `/var/lib/app` fail with a read-only filesystem error. The recovery team has mounted the affected XFS filesystem read-only while investigating a device error. Collect the live and persistent evidence; you are not authorized to remount, repair, or change permissions. You start in `/home/dev`.

Your job:

1. Inspect the live backing filesystem and its mount options for `/var/lib/app`.
2. Check whether byte capacity explains the write failure.
3. Read `/etc/fstab` and validate the supported local-device entries without mounting anything.
4. Inspect the current boot's kernel journal for the storage failure. Leave the system unchanged.

The grader checks targeted command evidence and the required final state. The terminal is a bounded simulation; copied diagnostic text is not evidence.
