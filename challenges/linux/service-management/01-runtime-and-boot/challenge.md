---
title: "Running Now, Starting After Boot"
sectionSlug: how-do-loaded-enabled-active-and-failed-state-differ
order: 1
---

The orders API is installed but unavailable. It must run now and return on future boots. The metrics collector is already working and must not be interrupted. You start in `/home/dev`.

Your job:

1. Inspect the current state of `orders.service` before changing it.
2. Bring `orders.service` online and arrange its future startup through the normal server target.
3. Verify both its running state and boot enablement. Leave `metrics.service` unchanged.

The grader checks separate runtime and enablement state, diagnostic evidence, and the untouched metrics workload. Boot links are modeled; this lab does not reboot a host.
