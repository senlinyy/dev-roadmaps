---
title: "Copy and Recover"
sectionSlug: how-do-operators-motions-undo-and-put-change-text
order: 5
---

A probe configuration needs a second copy of a target entry before a later rollout customizes it. You start in `/home/dev`.

Your job:

1. **Open `/home/dev/targets.conf` in Vim** and yank the entire `primary=api.internal` line.
2. **Put one copy immediately below the original**, without retyping the line.
3. **Undo the insertion, then redo it**, so you finish with exactly two adjacent target lines.
4. **Save, quit, and display the saved file**, preserving the header and health entry.

The grader checks yank, put, an effective undo and redo, and exactly one additional target line.
