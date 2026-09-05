---
title: "Deleted, but Still Full"
sectionSlug: why-can-a-deleted-file-still-consume-space
order: 4
---

A rotated orders log was deleted, but root usage did not fall. The orders service in this lab does not implement log reopening; the incident owner explicitly approves one targeted restart. Do not delete additional files. You start in `/home/dev`.

Your job:

1. Compare root capacity with reachable usage under `/var`, staying on one filesystem.
2. Identify the deleted file and the service retaining it.
3. Restart only `orders` using the approved maintenance action.
4. Verify recovered root capacity, no remaining deleted-open references, and an active orders service.

The grader checks targeted command evidence and the required final state. The terminal is a bounded simulation; copied diagnostic text is not evidence.
