---
title: "Hunt Down Large Files"
sectionSlug: the-disk-full-triage-runbook
order: 3
---

When a disk alert fires, the first job is to find what is eating space. A combination of `df` for the overview, `du` for the per-directory breakdown, and `find -size` for pinpointing individual large files gives you a complete triage path.

You start in `/home/dev`. Your job:

1. **Run `df -h`** to confirm the root filesystem is nearly full.
2. **Use `du`** to find which top-level directories under `/` consume the most space (e.g., `du --max-depth=1 -h /`).
3. **Use `find` with `-size`** to locate files larger than 100MB (e.g., `find / -type f -size +100M`).
4. **Identify the single largest file** on the system from the `find` output.

The grader requires you to use `df`, `du`, and `find`, and that your output mentions `access.log`, `core.dump`, and the `92%` usage figure.
