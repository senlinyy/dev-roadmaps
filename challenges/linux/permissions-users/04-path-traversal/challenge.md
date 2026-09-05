---
title: "The File Is Readable, but Unreachable"
sectionSlug: how-does-a-complete-access-check-work
order: 4
revision: 1
---

The application account belongs to `web`, and the final configuration file grants group read. Its read test still fails. This is a pathname problem, so changing the file itself would miss the blocking layer.

You start in `/home/dev`. Your job:

1. **Reproduce the failed read test as `app`** and trace every pathname component.
2. **Repair only the blocking parent directory** so the `web` group can traverse it.
3. **Repeat the read test as `app`** to prove the complete path now works.

The grader checks the failed-access evidence, the parent directory's final state, and service-user access.
