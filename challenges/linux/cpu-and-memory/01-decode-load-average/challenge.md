---
title: "Decode Load Average"
sectionSlug: load-average-decoded
order: 1
---

The three numbers in `/proc/loadavg` tell you how busy the system has been over the last 1, 5, and 15 minutes. To know if the system is overloaded, you compare those numbers against the CPU core count.

You start in `/home/dev`. Your job:

1. **Read `/proc/loadavg`** to find the 1-minute, 5-minute, and 15-minute load averages.
2. **Count the CPU cores** by grepping `/proc/cpuinfo` for "processor" lines.
3. **Check the system uptime** by reading `/proc/uptime` and noting the first number (total seconds since boot).
4. **Determine if the system is overloaded**: a 1-minute load of 4.82 on 2 cores means the per-core load is well above 1.

The grader requires you to use `cat` and `grep`, and your combined output must contain the three load averages, the core count, and the uptime in seconds.
