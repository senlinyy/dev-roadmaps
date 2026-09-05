---
title: "Rank HTTP Status Codes"
sectionSlug: how-do-you-build-and-validate-an-incident-pipeline
order: 4
---

Before investigating individual requests, establish which HTTP statuses dominate a deployment sample. The same status appears in separated parts of the log.

You start in `/home/dev`. `/var/log/orders/status-sample.log` uses time, client IP, method, path, status, and bytes, separated by single spaces.

Your job:

1. Print a sample containing the first two records.
2. Extract the status field, group equal values, and print one count/status row per distinct status.
3. Order the result by descending numeric count, with no header.
4. Leave the sample unchanged.

The grader checks the requested command results and file state, not an explanation or manually typed answer.
