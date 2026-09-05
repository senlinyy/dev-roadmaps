---
title: "Investigate a Busy Host"
sectionSlug: what-does-load-average-count
order: 1
---

The reporting host slowed down during a batch run. Determine what evidence distinguishes queued CPU work from blocked work before anyone restarts a service. You start in `/home/dev`.

Your job:

1. Inspect the three load windows and the CPU count visible to this host.
2. Collect at least two current activity samples, at least five simulated seconds apart.
3. Inspect process IDs, states, and commands to locate runnable and blocked work. Leave all workloads unchanged.

The grader checks actual diagnostic observations, process targeting, and unchanged workloads; copied output is not evidence. Sampling advances the lab clock immediately; the initial vmstat rates are since-boot averages.
