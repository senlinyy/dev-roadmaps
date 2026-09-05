---
title: "Find Errors Without the Noise"
sectionSlug: how-does-grep-select-the-lines-you-need
order: 1
---

An orders-service incident contains mixed-case severity labels and an innocent message about an error budget. Search the severity field, not every occurrence of the word.

You start in `/home/dev`. The timestamp-sorted source is `/var/log/orders/app.log`.

Your job:

1. Inspect the first two and last two records to establish the log boundaries.
2. Print every error-severity record with its original line number, regardless of capitalization.
3. Print the literal `request_id=req.42` record with one neighboring record on each side and original line numbers. The similarly named `reqX42` request is unrelated.
4. Leave the source log unchanged.

The grader checks the requested command results and file state, not an explanation or manually typed answer.
