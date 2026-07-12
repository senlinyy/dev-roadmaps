---
title: "Query an Exported Journal"
sectionSlug: query-the-journal
order: 3
---

The production host is not available, but the on-call captured a journal export for `orders-api.service` at `/var/log/journal/orders-api.export`. You start in `/home/dev`.

Your job:

1. **Inspect the exported journal** to see the service timeline.
2. **Find the first useful failure** after the deploy restarted the unit.
3. **Surface the restart evidence** that proves systemd retried the service.
4. **Surface the missing configuration clue** without copying unrelated noise.

The grader checks the exported journal evidence you print, not a prose explanation.
