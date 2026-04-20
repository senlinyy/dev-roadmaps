---
title: "Grep Through Real Logs"
sectionSlug: querying-with-journalctl
order: 3
---

In production you rarely read logs top-to-bottom. Instead you filter for a specific service, a severity keyword, or an error code. This step simulates exported journal output and asks you to extract the signal from the noise.

You start in `/home/dev`. Your job:

1. **Find all log lines from the "myapp" service** in `/var/log/journal-export.log` using `grep`.
2. **Search for "error" case-insensitively** across the entire log using `grep -i`.
3. **Count how many lines mention "postgresql"** using `grep -c`.
4. **Extract the lines containing HTTP status 502**.

The grader requires you to use `grep`, and checks that your output includes key phrases from the myapp crash messages, the 502 error, and the postgresql count.
