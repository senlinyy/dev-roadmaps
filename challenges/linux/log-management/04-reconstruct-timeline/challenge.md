---
title: "Reconstruct the Restart Timeline"
sectionSlug: how-do-you-query-the-systemd-journal
order: 4
---

The journal contains a previous-boot OOM event as well as today’s incident. You start in `/home/dev`. Investigate 2026-09-01 10:17:00 through 10:19:00 UTC without restarting anything.

1. **Query the current-boot `app.service` lifecycle** within that exact window.
2. **Inspect current-boot kernel records for the same window** to investigate the forced exit.
3. **Query operator activity by the journal command metadata for `sudo`**, retaining the same window and boot.
4. **Use the replacement PID from the lifecycle records to isolate its current-boot application entries**, using PID metadata rather than a text search.

The grader checks time, boot, source, command, and PID filters. Finding a nearby operator action alone does not prove it caused the failure.
