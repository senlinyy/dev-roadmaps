---
title: "Recover the Missing Context"
sectionSlug: how-does-severity-narrow-the-search-without-proving-importance
order: 2
---

A reports request triggered a warning, but the alert alone does not reveal its outcome. You start in `/home/dev`; the relevant `app.service` window is 2026-09-01 10:19:00 through 10:19:30 UTC.

1. **Inspect warnings and more severe records** for that unit and exact window.
2. **Expand the same query to include informational records**, while still excluding debug output.
3. **Locate both acceptance and the final request outcome** without changing service state or logs.

The grader checks both priority thresholds, the shared time window, and the recovered context.
