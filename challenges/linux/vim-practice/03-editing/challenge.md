---
title: "Editing Practice"
sectionSlug: editing-delete-copy-paste-undo
order: 3
---

Vim editing commands operate on lines and words without entering Insert mode. Practice deleting, copying, pasting, and undoing on a Python script.

A Python file is at `/home/dev/app.py`. Open it with `vim /home/dev/app.py` and try:

1. **Delete a line** - navigate to line 2 (the TODO comment) and press `dd`.
2. **Copy and paste** - move to a function definition, press `3yy` (yank 3 lines), then `p` to paste below.
3. **Undo your changes** with `u` until the file looks original again. Redo with `Ctrl+r`.
4. **Repeat with dot** - delete a line with `dd`, move to another line, and press `.` to repeat the deletion.
5. **Navigate with `/`** - use `/def ` to jump between function definitions.

You can make any edits you want. There is no wrong answer here. We recommend practicing `dd`, `yy`, `p`, `u`, and `.` to build muscle memory. Save with `:wq` or discard with `:q!`.
