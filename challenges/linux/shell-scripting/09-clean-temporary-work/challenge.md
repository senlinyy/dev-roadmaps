---
title: "Create and Clean Temporary Work"
sectionSlug: how-do-functions-temporary-files-signals-and-traps-bound-cleanup
order: 9
---

`stage-release.sh` uses a predictable shared path and leaves it behind. Parallel release jobs could collide or consume stale work.

You start in `/home/dev`. Your job:

1. **Create a private unique directory under `/tmp`** and capture its path.
2. **Define one cleanup function** that removes that directory and register it for shell exit.
3. **Run the script**, print the allocated path, and leave no temporary directory behind.

The grader checks unique allocation, the EXIT cleanup contract, actual execution, and removal of the old predictable path.
