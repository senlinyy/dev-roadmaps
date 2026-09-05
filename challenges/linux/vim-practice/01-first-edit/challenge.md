---
title: "Make Your First Edit"
sectionSlug: how-do-vims-modes-turn-keys-into-commands-or-text
order: 1
---

A feature is ready to enable, but its application config still disables it. You start in `/home/dev` with a normal shell.

Your job:

1. **Open `/home/dev/app.conf` in Vim** and switch between Normal and Insert mode to make the edit.
2. **Change `enabled` from `false` to `true`**, preserving the port and the rest of the file.
3. **Save and quit**, then display the saved file from the terminal.

The grader checks an actual Insert-mode edit, a successful write, a completed Vim session, and the saved file.
