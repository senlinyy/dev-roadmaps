---
title: "Map the Log Homes"
sectionSlug: where-the-important-logs-live
order: 1
---

The checkout VM has separate evidence streams for system lifecycle messages, Nginx request handling, Nginx upstream errors, and application JSON logs. You start in `/home/dev`.

Your job:

1. **Inspect the log directories** under `/var/log` so you know which files exist before you search.
2. **Surface one lifecycle message** for `orders-api.service`.
3. **Surface the Nginx request and upstream-error evidence** for the checkout failure.
4. **Surface the application JSON error** that carries the matching request id.

The grader checks that your terminal output includes evidence from multiple log homes, not a written report.
