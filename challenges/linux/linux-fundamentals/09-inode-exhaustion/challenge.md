---
title: "No Space, but Space Is Free"
sectionSlug: how-do-space-inodes-and-open-files-explain-capacity
order: 9
revision: 1
---

The root filesystem refuses to create another session file with `No space left on device`, even though its byte-capacity report shows plenty of room. Operations suspects the session cache contains an excessive number of tiny files.

You start in `/home/dev`. Your job:

1. **Check byte capacity** for the root filesystem.
2. **Check inode capacity** for that same filesystem.
3. **Count the regular files** below `/var/cache/sessions` through a pipeline.

The grader checks that you distinguished free bytes from exhausted inode records and verified the suspected file-heavy directory.
