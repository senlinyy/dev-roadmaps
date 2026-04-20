---
title: "Sorting and Counting"
sectionSlug: supporting-utilities
order: 5
---

A web server access log records which IP addresses made requests. Your task is to find out which IPs are most active.

The access log is at `/var/log/access.log`. Each line starts with an IP address.

1. Use a pipeline to extract all the IP addresses, sort them, count unique occurrences, and sort by count in descending order. Print only the **top 3**.

Hint: you can combine `cut`, `sort`, `uniq -c`, `sort -rn`, and `head` in a single pipeline.

The grader checks that your output contains the correct top 3 IPs with their counts.
