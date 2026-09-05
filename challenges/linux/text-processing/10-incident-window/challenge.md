---
title: "Investigate a Bounded Incident Window"
sectionSlug: how-do-you-build-and-validate-an-incident-pipeline
order: 10
---

Orders failed during a fifteen-minute incident. Errors outside the window and successful responses containing 5xx-like numbers would distort a broad search.

You start in `/home/dev`. `/var/log/orders/incident.log` is time-sorted on one day in one timezone. Fields are time, client IP, method, path, status, and bytes, separated by single spaces.

Your job:

1. Preserve complete 5xx records from 14:00:00 inclusive to 14:15:00 exclusive in `/home/dev/incident-errors.log`. Do not change the source.
2. Print only the number of records in that extract.
3. Print the single most frequent failing endpoint and the single most frequent client IP as separate count/value results.
4. Print the first and last complete error records from the extract to verify the time boundary.

The grader checks the requested command results and file state, not an explanation or manually typed answer.
