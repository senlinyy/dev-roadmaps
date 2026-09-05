---
title: "Make Precise Changes"
sectionSlug: how-do-operators-motions-undo-and-put-change-text
order: 4
---

A worker config contains one obsolete directive and two values from the previous environment. You start in `/home/dev`.

Your job:

1. **Open `/home/dev/workers.conf` in Vim** and remove the entire `obsolete=yes` line with a Normal-mode deletion.
2. **Change `backend` from `development` to `production`** with a change operator and motion.
3. **Repeat that change on `mirror`** using Vim's repeat-last-change operation, keeping the header and worker count intact.
4. **Save, quit, and display the saved config** from the shell.

The grader checks deletion, operator-based change, repeated change, and the exact resulting file.
