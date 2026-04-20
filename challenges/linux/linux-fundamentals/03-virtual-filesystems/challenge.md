---
title: "Everything Is a File"
sectionSlug: virtual-filesystems-and-everything-is-a-file
order: 3
---

In Linux, even hardware info and running processes are exposed as ordinary files you can read with `cat`. The `/proc` and `/sys` directories are **virtual filesystems** generated live by the kernel. Nothing is stored on disk.

You start in `/home/dev`. Your job:

1. **Read `/proc/cpuinfo`** to see the CPU details.
2. **Read `/proc/meminfo`** to check memory statistics.
3. **Read `/proc/version`** to see the kernel version.
4. **Count the lines** in `/proc/cpuinfo` using `wc`.
5. As your final command, **read `/proc/loadavg`** to see the current system load.

The grader checks that you used `cat` and `wc`, and that your last output contains the load average.
