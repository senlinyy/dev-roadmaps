---
title: "Keep or Discard Changes"
sectionSlug: how-do-you-open-save-and-leave-a-file-safely
order: 2
---

You need to save a diagnostic logging change, then reject a more verbose experiment. You start in `/home/dev`.

Your job:

1. **Open `/home/dev/logging.conf` in Vim**, change `log_level` to `debug`, and write without leaving the editor.
2. **Try `trace` as a second value without saving it**, then attempt an ordinary quit so Vim warns about the unsaved change.
3. **Discard only that second edit and quit**. Preserve the previously saved `debug` value and the port.
4. **Display the saved file** from the terminal to verify what survived.

The grader checks the write, blocked quit, discarded buffer change, and final saved content in the same Vim session.
