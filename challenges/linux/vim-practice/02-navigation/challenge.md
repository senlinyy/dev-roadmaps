---
title: "Navigation Practice"
sectionSlug: moving-around-navigation
order: 2
---

Moving efficiently in Vim means never touching the mouse. Practice the movement commands on a real server log.

A 40-line application log is at `/var/log/app/server.log`. Open it with `vim /var/log/app/server.log` and try the following:

1. **Jump to the last line** with `G`, then back to the top with `gg`.
2. **Jump to line 15** with `:15` or `15G`.
3. **Move word by word** with `w` (forward) and `b` (backward).
4. **Jump to the end of a line** with `$` and the beginning with `0`.
5. **Scroll half-page** with `Ctrl+d` (down) and `Ctrl+u` (up).
6. **Search for text** - use `/ERROR` to jump to the first error line, then `n` to find the next one.
7. **Try `f` + character** to jump to the next occurrence of that character on the current line.

You can use arrow keys if you prefer, but we encourage you to practice `hjkl` and the motion commands above. They are much faster once they click. Quit with `:q` when done.
