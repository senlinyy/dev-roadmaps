---
title: "Free Bytes, No Inodes"
sectionSlug: how-do-df-du-and-inodes-explain-capacity
order: 3
---

The application cannot create a new session even though the data filesystem has ample byte capacity. This scaled-down fixture has a deliberately small inode budget. The cache owner authorizes deleting the expired subtree only. You start in `/home/dev`.

Your job:

1. Inspect both byte capacity and inode capacity for `/var/lib/app` before changing anything.
2. List the cache files under `/var/lib/app/cache` without crossing filesystem boundaries.
3. Remove `/var/lib/app/cache/expired` while preserving the active session.
4. Verify that at least eight inodes are free on the data filesystem.

The grader checks targeted command evidence and the required final state. The terminal is a bounded simulation; copied diagnostic text is not evidence.
