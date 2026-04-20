---
title: "Searching with grep"
sectionSlug: searching-with-grep
order: 2
---

The same log file from before needs investigating. An incident report asks you to find all errors and warnings.

The log file is at `/var/log/app.log`.

1. Find all lines containing `ERROR` (case-insensitive) and print them **with line numbers** using `grep`.
2. Count how many lines contain `WARN` using `grep -c`.
3. Print all lines that do **not** contain `INFO` using `grep -v`.

The grader checks that you used the right grep flags and that your output contains the expected data.
