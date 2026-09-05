---
title: "Keep Successful Output and Errors Separate"
sectionSlug: how-do-streams-redirection-and-pipes-move-data
order: 8
---

A batch manifest has one available input and one missing input. Preserve the successful data without allowing the diagnostic to contaminate it, then retain a combined troubleshooting capture.

You start in `/home/dev`. Read `ready.txt` followed by `missing.txt` in each attempt. The missing file is intentionally absent; do not create it.

Your job:

1. Capture the successful records in `output.log` and diagnostics in `errors.log`, replacing any previous captures.
2. Repeat the same attempt, appending each stream to its own file so both attempts remain.
3. Run a third attempt with both streams merged. Display that combined stream while saving it to `combined.log` using tee.
4. Keep `ready.txt` unchanged and leave `missing.txt` absent.

The grader checks the requested command results and file state, not an explanation or manually typed answer.
