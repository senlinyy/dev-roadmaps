---
title: "Find the Incident Window"
sectionSlug: how-do-you-query-the-systemd-journal
order: 1
---

Users reported errors around 10:21 UTC, but the application is healthy now. You start in `/home/dev`; the simulated clock is 2026-09-01 10:30:00 UTC.

1. **Inspect the latest two records** for `app.service` to see the current context.
2. **Query the same unit from 10:17:00 through 10:23:00 UTC on 2026-09-01**, including both endpoints.
3. **Keep unrelated units and incidents outside that window out of the incident query**, preserving all existing evidence.

The grader checks journal targeting, time boundaries, and records returned by the queries. This is a read-only investigation.
