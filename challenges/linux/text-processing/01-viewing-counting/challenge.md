---
title: "Viewing and Counting"
sectionSlug: everything-is-text
order: 1
---

A web server has been running for a while and its access log is getting long. Your job is to inspect it with the basic text viewing tools.

You start in `/home/dev`. The log file is at `/var/log/app.log`.

1. Print the **first 5 lines** of the log file using `head`.
2. Print the **last 3 lines** of the log file using `tail`.
3. Count the **total number of lines** in the log file using `wc -l`.

The grader checks that your output contains the first 5 lines, the last 3 lines, and the line count.
