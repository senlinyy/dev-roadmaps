---
title: "Filter by Severity"
sectionSlug: syslog-severity-levels
order: 2
---

Production logs mix routine info with critical alerts. Filtering by severity level lets you cut through the noise and focus on what matters. Syslog defines 8 severity levels from Emergency (0) down to Debug (7).

You start in `/home/dev`. Your job:

1. **Read the severity reference file** at `/home/dev/severity-reference.txt` to review the 8 standard syslog severity levels.
2. **Find all ERROR messages** in `/var/log/app/application.log` using `grep`.
3. **Count how many WARNING messages** exist in the application log using `grep -c`.
4. **Find all CRITICAL messages** in the application log.

The grader requires you to use `grep` and `cat` at least once each, and checks that your output includes the ERROR and CRITICAL message content plus the correct WARNING count.
