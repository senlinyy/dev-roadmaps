---
title: "Navigate Without Editing"
sectionSlug: how-do-motions-navigate-by-character-word-line-and-file
order: 3
---

A config review needs precise movement, not accidental edits. You start in `/home/dev`; `/home/dev/routing.conf` has six content lines.

Your job:

1. **Open the file in Vim and reach the first character of line 6**, the closing comment.
2. **Return to the first character of line 1**, then reach the start of `api-primary.internal` on line 3, column 9.
3. **Use Vim motions for those destinations**, without arrow-key navigation or edits.
4. **Quit without writing**, then display the unchanged file from the shell.

The grader checks motion-driven visits to all three destinations in one completed session and that the file was never edited.
