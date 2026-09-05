---
title: "Grow the Missing Layer"
sectionSlug: how-do-you-grow-storage-through-every-layer
order: 8
---

A verified backup is available and the change owner has enlarged `/dev/vdb` to accommodate a 120 GiB data partition. The partition and filesystem still have their original 100 GiB capacity. You are authorized to grow partition 1 and the XFS filesystem mounted at `/var/lib/app`; leave the root disk and application data untouched. You start in `/home/dev`.

Your job:

1. Inspect `/dev/vdb` and confirm the live filesystem type and source behind `/var/lib/app`.
2. Grow only partition 1 into the available space and inspect its new size before continuing.
3. Grow the mounted XFS filesystem without changing its data.
4. Verify the data filesystem now reports 120 GiB.

The grader checks targeted command evidence and the required final state. The terminal is a bounded simulation; copied diagnostic text is not evidence.
