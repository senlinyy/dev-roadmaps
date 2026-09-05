---
title: "Count Actual Failed Requests"
sectionSlug: how-does-grep-select-the-lines-you-need
order: 3
---

The authentication dashboard reports unauthorized requests. A loose search for 401 also matches a documentation URL and a successful response's byte count, so it overstates the incident.

You start in `/home/dev`. `/var/log/orders/access.log` has six single-space-separated fields: time, client IP, method, path, status, and bytes.

Your job:

1. Inspect the first two records to check the format.
2. Print the complete records whose HTTP status is 401, excluding matches in other fields.
3. Print only the count of those requests, with no filename or extra records.
4. Preserve the original log.

The grader checks the requested command results and file state, not an explanation or manually typed answer.
