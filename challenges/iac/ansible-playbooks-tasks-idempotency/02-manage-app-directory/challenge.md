---
title: "Manage App Directory"
sectionSlug: "desired-state-modules"
order: 2
---

The orders app needs a stable runtime directory before later tasks write files into it. Add a desired-state task that owns the directory metadata instead of relying on an earlier manual setup.

Your job:

1. **Create the app runtime path** at `/opt/devpolaris-orders`.
2. **Manage it as a directory** owned by `root` and group `root`.
3. **Set the directory mode** to `0755`.

The grader checks the YAML task fields, not a prose explanation.
