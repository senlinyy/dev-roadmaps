---
title: "Open, Edit, Save, Quit"
sectionSlug: survival-basics-open-edit-save-quit
order: 1
---

Time to get comfortable with the absolute basics: opening a file, entering Insert mode, making a change, and saving.

A broken Nginx config file is waiting at `/etc/nginx/nginx.conf`. The `server_name` is set to `_` (the default catch-all). Your job:

1. **Open the file** with `vim /etc/nginx/nginx.conf`.
2. **Find the `server_name` line** - try using `/server_name` to search for it.
3. **Enter Insert mode** with `i` and change `server_name _;` to `server_name devpolaris.dev;`.
4. **Press `Esc`** to return to Normal mode.
5. **Save and quit** with `:wq`.

You can accomplish this any way you like, but we recommend practicing the Vim commands listed above. They will become second nature with repetition. Try `:q!` to quit without saving and reopen, or use `u` to undo a mistake.
