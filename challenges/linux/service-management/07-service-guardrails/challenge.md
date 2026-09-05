---
title: "Apply Service Guardrails"
sectionSlug: how-do-restart-policy-resource-controls-and-timers-add-resilience
order: 7
---

The orders API normally stays below `380M`, but a leak previously crowded out other workloads. You have approved resource boundaries and need to verify they reached the manager and the new process. You start in `/home/dev`.

Your job:

1. Add `/etc/systemd/system/orders.service.d/limits.conf` with a `512M` memory maximum, an `80%` CPU quota, and an open-file limit of `8192`. Preserve the vendor unit.
2. Load the override and replace the running process.
3. Inspect the loaded memory and CPU properties, identify the new main PID, and read that process's open-file limits.

The grader checks loaded limits and the replacement process's `/proc` limit evidence. Memory and CPU values are modeled configuration, not real scheduler or memory enforcement.
