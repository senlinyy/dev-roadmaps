---
title: "Read /proc for Live Process Data"
sectionSlug: the-proc-filesystem-live-introspection
order: 2
---

The `/proc` filesystem exposes live data for every running process. Each PID directory contains files like `status`, `cmdline`, `limits`, and `environ` that you can read with `cat` and filter with `grep`.

You start in `/home/dev`. Your job:

1. **Find how much physical memory PID 501 uses** by grepping for `VmRSS` in its status file.
2. **Check what the process actually is** by reading its `cmdline` file.
3. **Find the system load averages** by reading `/proc/loadavg`.
4. **Determine how many threads PID 501 has** by grepping for `Threads` in its status file.

The grader requires you to use `cat` and `grep`, and your combined output must include the memory value, the process name, the three load averages, and the thread count.
