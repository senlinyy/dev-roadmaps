---
title: "Publish a Production Backup"
sectionSlug: how-does-a-complete-script-keep-its-responsibilities-visible
order: 10
---

The release team needs `/home/dev/backup.sh` to publish a complete archive without exposing partial output or leaving temporary work. The source includes `release notes.txt`, so path handling must remain safe.

You start in `/home/dev`. Your job:

1. **Reject anything except a source directory and destination directory** with usage output and status `64`.
2. **Create the archive in unique temporary work**, register cleanup, and enable strict pipeline-aware failure handling.
3. **Publish only the completed archive** as `/home/dev/backups/release.tar.gz`, then print `backup published`.
4. **Run one invalid request and one valid request** using `/home/dev/release source` and `/home/dev/backups`.

The grader checks both statuses, safe source handling, cleanup, archive contents, and final atomic publication.
