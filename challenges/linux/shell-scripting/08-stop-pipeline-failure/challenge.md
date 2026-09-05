---
title: "Stop on a Hidden Pipeline Failure"
sectionSlug: how-do-you-build-a-safer-and-repeatable-deploy-script
order: 8
---

`publish.sh` continues after the first pipeline command fails because the final command reports success. That lets the script create a publication marker for work that never completed.

You start in `/home/dev`. Your job:

1. **Enable strict failure handling**, including failure propagation from any pipeline segment.
2. **Run `publish.sh`** and let the intentional pipeline failure determine the script status.
3. **Prove `/home/dev/release.published` is not created** after the failed pipeline.

The grader checks the strict options, non-zero script run, and absence of the later mutation.
