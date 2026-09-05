---
title: "Summarize Transfer Usage with awk"
sectionSlug: how-does-awk-turn-records-and-fields-into-summaries
order: 7
---

An export records completed transfers in megabytes. One user appears twice, and a transfer exactly at the alert threshold must not be included in the over-threshold list.

You start in `/home/dev`. `/home/dev/transfers.log` has a username and integer megabyte value per whitespace-separated record, with no header.

Your job:

1. Inspect the first two transfer records.
2. Print username/megabyte rows for individual transfers strictly greater than 100 MB, in source order.
3. Print a one-line whole-file summary in the format `records=N total_mb=N`.
4. Aggregate megabytes per username, then print username/total rows sorted by username. Keep the source unchanged.

The grader checks the requested command results and file state, not an explanation or manually typed answer.
