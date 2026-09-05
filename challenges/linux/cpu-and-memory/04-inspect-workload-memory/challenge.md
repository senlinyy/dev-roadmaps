---
title: "Inspect a Workload's Footprint"
sectionSlug: how-do-virtual-memory-and-physical-ram-differ
order: 4
---

A dashboard reports that the orders process has an 8 GiB virtual size. Before treating that as consumed RAM, connect the current service process to resident and shared-memory evidence. You start in `/home/dev`.

Your job:

1. Inspect host memory availability and rank processes by descending resident memory, including virtual size.
2. Resolve the current main PID of orders.service rather than relying on a remembered PID.
3. Inspect that process's status and memory rollup. Leave the service and its unit file unchanged.

The grader checks actual diagnostic observations, process targeting, and unchanged workloads; copied output is not evidence. RSS and virtual size in ps are KiB. PSS apportions shared pages across processes.
