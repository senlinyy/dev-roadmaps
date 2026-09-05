---
title: "Find the Top Five Clients"
sectionSlug: how-do-you-build-and-validate-an-incident-pipeline
order: 5
---

A burst of traffic may be concentrated in a few clients. Produce a bounded ranking that remains reproducible when two clients have equal counts.

You start in `/home/dev`. `/var/log/orders/clients.log` contains client IP, method, path, and status, separated by single spaces.

Your job:

1. Inspect the first two requests.
2. Print exactly the five most frequent client IPs as count/IP rows, ordered by descending numeric count.
3. Break equal-count ties by ascending IP text order. Do not include the two lower-ranked clients.
4. Keep the source unchanged.

The grader checks the requested command results and file state, not an explanation or manually typed answer.
