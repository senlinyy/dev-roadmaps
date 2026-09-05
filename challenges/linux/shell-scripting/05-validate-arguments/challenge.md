---
title: "Validate Script Arguments"
sectionSlug: how-do-expansion-quoting-arguments-and-environment-values-work
order: 5
---

`promote.sh` must reject an incomplete release request and safely process every remaining target without collapsing spaces inside an argument.

You start in `/home/dev`. Your job:

1. **Repair `promote.sh`** so fewer than two arguments prints `usage: promote.sh LABEL TARGET...` and exits with status `64`.
2. **Store the first argument as the release label**, remove it from the positional list, and iterate over the remaining arguments without resplitting them.
3. **Run one rejected request and one valid request** using label `release 42` with targets `api blue` and `worker green`.

The grader checks both executions, their statuses, exact argument boundaries, and the script structures that support them.
