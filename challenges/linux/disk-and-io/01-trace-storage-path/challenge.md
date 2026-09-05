---
title: "Trace the Failing Path"
sectionSlug: how-do-devices-partitions-and-filesystems-differ
order: 1
---

The orders API cannot append to a log under `/var/log/orders`. A teammate suggests cleaning the much larger reports directory on `/var/lib/app`. Establish which filesystem owns the failure before anyone deletes data. You start in `/home/dev`.

Your job:

1. Map `/var/log/orders` to its live mount, source device, filesystem type, and options.
2. Inspect filesystem identities in the block-device tree.
3. Compare byte capacity for `/` and `/var/lib/app`. Leave files and workloads unchanged.

The grader checks targeted command evidence and the required final state. The terminal is a bounded simulation; copied diagnostic text is not evidence.
