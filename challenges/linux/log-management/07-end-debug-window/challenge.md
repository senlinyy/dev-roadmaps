---
title: "End the Debug Window"
sectionSlug: how-do-you-diagnose-common-logging-failures
order: 7
---

An investigation ended, but `app.service` still uses debug logging. You start in `/home/dev`; the simulated clock begins at 2026-09-01 10:30:00 UTC. A controlled restart of this application is approved.

1. **Inspect the service environment** before changing it.
2. **Back up `/etc/systemd/system/app.service` as `app.service.bak` in the same directory**, then change only the logging level to `info`, keeping the production environment and workload intact.
3. **Load the saved definition and restart the service** so the running process uses the new level.
4. **Advance five simulated seconds**, then query `app.service` from 10:30:00 UTC onward to verify new normal, warning, and error records without debug noise.

The grader checks the running process environment and freshly generated journal records. The fixture emits a bounded diagnostic sample when time advances; it does not simulate continuous traffic.
