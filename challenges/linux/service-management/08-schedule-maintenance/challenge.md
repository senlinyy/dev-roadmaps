---
title: "Schedule a Maintenance Job"
sectionSlug: how-do-restart-policy-resource-controls-and-timers-add-resilience
order: 8
---

The release-maintenance workload has a reviewed oneshot service but no working schedule. First establish that the job completes, then configure its separate timer. You start in `/home/dev`.

Your job:

1. Run `releases.service` once and inspect its journal for successful completion. Leave its service file unchanged.
2. Complete `/etc/systemd/system/releases.timer` for daily `03:30:00 UTC` activation, with persistent catch-up enabled and installation under `timers.target`.
3. Load the definition, enable and start the timer, and inspect which service it activates and its next scheduled run.

The grader checks a completed simulated job, the separate active and enabled timer, and schedule inspection. Only daily UTC schedules and authored workloads run in this lab; persistent catch-up is inspected as configuration, not a simulated reboot.
