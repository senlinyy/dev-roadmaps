---
title: "Inspect the Local Network"
sectionSlug: which-tools-reveal-each-network-layer
order: 1
---

A new worker has two adapters, but monitoring reports one link is unavailable. Inspect the local interfaces before anyone changes a route. You start in `/home/dev`.

1. Inspect link state for both `eth0` and `eth1`, including carrier and MTU.
2. Inspect their assigned IPv4 addresses and prefixes.
3. Leave interfaces, files, and workloads unchanged.

The grader checks targeted observations and unchanged state, not copied text. This read-only IPv4 simulation has no live network access. Captures cover a bounded authored window; probes finish immediately.
