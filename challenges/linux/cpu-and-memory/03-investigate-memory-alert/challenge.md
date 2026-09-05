---
title: "Investigate a Memory Alert"
sectionSlug: how-should-you-read-free-and-available-memory
order: 3
---

An alert reports very little completely free RAM. Requests are currently healthy, and the on-call engineer wants evidence before clearing caches or restarting anything. You start in `/home/dev`.

Your job:

1. Inspect memory availability and allocated swap in the memory summary.
2. Inspect the underlying available, cached, reclaimable slab, and unreclaimable slab counters.
3. Collect two current activity samples at least five simulated seconds apart to check whether swap is moving. Keep the host unchanged.

The grader checks actual diagnostic observations, process targeting, and unchanged workloads; copied output is not evidence. The memory summary uses current procps semantics: used is total minus available.
