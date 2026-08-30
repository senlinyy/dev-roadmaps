---
title: "Which Filesystem Is Full?"
sectionSlug: how-do-links-and-mounts-change-what-a-path-reaches
order: 8
revision: 1
---

Uploads under `/srv/orders-api/uploads` are failing. The root filesystem still has room, so determine which mounted filesystem actually supplies that application path before looking for the largest consumer inside it.

You start in `/home/dev`. Your job:

1. **Identify the mount** that supplies `/srv/orders-api/uploads`.
2. **Check capacity for that application path**, not just for `/`.
3. **Measure the first directory level** below the upload path and identify the largest consumer.

The grader checks the mount source, filesystem type, capacity evidence, and directory usage.
