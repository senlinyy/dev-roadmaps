---
title: "Check Whether Swap Is Active"
sectionSlug: when-do-swap-and-memory-pressure-become-problems
order: 5
---

The import window is still running and requests have become sluggish. You are collecting evidence only; stopping the importer would interrupt a non-replayable batch. You start in `/home/dev`.

Your job:

1. Inspect available RAM and allocated swap, then collect two current activity samples at least five simulated seconds apart.
2. Inspect memory pressure stalls to check whether tasks are losing progress.
3. Rank resident-memory consumers and inspect the leading process's status, including its swapped memory. Leave the batch running.

The grader checks actual diagnostic observations, process targeting, and unchanged workloads; copied output is not evidence. The authored samples show activity over time; they do not emulate Linux page reclaim.
