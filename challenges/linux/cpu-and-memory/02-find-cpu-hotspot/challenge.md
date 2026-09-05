---
title: "Find the CPU Bottleneck"
sectionSlug: how-does-linux-account-for-cpu-time
order: 2
---

The machine-average CPU graph looks moderate, but rendering requests are slow. Find whether one execution path is consuming a CPU while the others have headroom. You start in `/home/dev`.

Your job:

1. Inspect a batch top snapshot showing host CPU categories and processes.
2. Collect a five-second per-CPU sample covering every visible CPU.
3. Rank processes by descending CPU usage and inspect the leading process's identity and command. Do not change its priority or stop it.

The grader checks actual diagnostic observations, process targeting, and unchanged workloads; copied output is not evidence. Only batch top is supported here; there is no full-screen monitor.
