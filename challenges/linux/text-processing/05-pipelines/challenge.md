---
title: "Building Pipelines"
sectionSlug: building-pipelines
order: 6
---

Time to combine multiple tools into pipelines. You have a system log and need to produce a quick incident summary.

The log file is at `/var/log/syslog`.

1. Count how many lines contain the word `error` (case-insensitive). Use `grep` piped into `wc -l`.
2. Extract all unique log levels (the third field: INFO, WARN, ERROR) from the log, sort them, and remove duplicates. Use `cut`, `sort`, and `uniq`.
3. Find lines containing `error` (case-insensitive), extract just the message part (field 4 onward), sort the messages, and count unique ones. Show the result sorted by frequency descending.

The grader checks that you produced the correct count, the sorted unique levels, and the error message frequency ranking.
