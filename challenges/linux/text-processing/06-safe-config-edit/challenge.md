---
title: "Preview a Targeted Configuration Change"
sectionSlug: how-does-sed-transform-lines-without-hiding-the-original
order: 6
---

A release candidate must switch to production. Other occurrences of development are intentional documentation and fallback settings, not deployment targets.

You start in `/home/dev`. Edit `/home/dev/app.env`, a simple line-based configuration file.

Your job:

1. Preview the complete candidate with only the active `environment` setting changed from development to production.
2. Apply that targeted change and preserve the original content in `/home/dev/app.env.bak`.
3. Print the updated file to verify it, leaving all comments and unrelated settings unchanged.

The grader checks the requested command results and file state, not an explanation or manually typed answer.
