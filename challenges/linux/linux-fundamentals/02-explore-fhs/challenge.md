---
title: "Explore the Filesystem Hierarchy"
sectionSlug: the-filesystem-hierarchy-standard
order: 2
---

Linux follows the Filesystem Hierarchy Standard (FHS) so every distribution puts things in the same places. Time to explore where critical system files live.

You start in `/home/dev`. Your job:

1. **Navigate to `/etc`** and list its contents to see system configuration files.
2. **Read `/etc/hostname`** to find this machine's name.
3. **Read `/etc/resolv.conf`** to see the DNS resolver configuration.
4. **Navigate to `/var/log`** and show the **last 5 lines** of `syslog`.
5. As your final command, **read `/etc/os-release`** to identify the operating system.

The grader checks that you used `cd`, `ls`, `cat`, and `tail`, and that your last output contains the OS release information.
