---
title: "Investigate a Service Memory Limit"
sectionSlug: when-is-swap-healthy-and-when-is-it-thrashing
order: 7
---

The orders service failed with an OOM result, but the host dashboard shows substantial available RAM. Investigate whether the service reached its own boundary before recommending any limit change. You start in `/home/dev`.

Your job:

1. Inspect available host memory and the effective memory limit and failure result of orders.service.
2. Inspect the kernel OOM event and identify its scope.
3. Correlate the unit's failure journal. Leave the failed service and its configured limit unchanged.

The grader checks actual diagnostic observations, process targeting, and unchanged workloads; copied output is not evidence. MemoryMax is inspected as configuration; this lab does not enforce arbitrary allocations or choose OOM victims.
