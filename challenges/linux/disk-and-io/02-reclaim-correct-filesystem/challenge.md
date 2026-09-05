---
title: "Reclaim Space on the Correct Filesystem"
sectionSlug: how-do-disk-full-and-disk-slow-runbooks-differ
order: 2
---

Root is nearly full. The release owner confirms that only the expired archive under `/var/cache/releases` is disposable. The live database and the reports on the separate data mount must remain intact. You start in `/home/dev`.

Your job:

1. Inspect root byte usage before cleanup.
2. Measure `/var` without crossing into another filesystem, then locate the large expired archive under `/var/cache/releases`.
3. Remove only that expired archive. Preserve `/var/lib/orders/database.db` and `/var/lib/app/reports/annual.csv`.
4. Recheck root capacity and recover at least 10 GiB of free space.

The grader checks targeted command evidence and the required final state. The terminal is a bounded simulation; copied diagnostic text is not evidence.
