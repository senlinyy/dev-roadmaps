---
title: "Extended Regex with grep -E"
sectionSlug: extended-regular-expressions
order: 3
---

The application log from earlier also needs a combined search. Using extended regular expressions lets you match multiple patterns in a single command.

The log file is at `/var/log/app.log`.

1. Use `grep -E` to find all lines containing either `ERROR` or `WARN` (case-insensitive) in a single command.
2. Count how many lines matched using `wc -l` piped from the previous command.
3. Use `grep -E` with a pattern to find lines where the timestamp hour is `08:1` or `08:2` (matching `08:1` or `08:2` at the start).
