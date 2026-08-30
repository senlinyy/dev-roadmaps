---
title: "Hard Link or Copy?"
sectionSlug: how-do-links-and-mounts-change-what-a-path-reaches
order: 7
revision: 1
---

The release report needs a second recoverable name, but creating another independent copy would let the contents drift. Create a hard link and prove that both names reach the same underlying file.

You start in `/home/dev`. Your job:

1. **Create `report-backup.txt` as a hard link** to `report.txt`.
2. **Inspect both names** and compare their inode and link-count evidence.
3. **Append the line `reviewed` through the backup name**.
4. **Read the original name** and confirm that it sees the appended content.

The grader checks the shared inode, shared content, and the commands used to prove the relationship.
