---
title: "Deployment Works for Root Only"
order: 2
---

An administrator can run `deploy`, but Alice's shell says `command not found`. The approved executable is under `/opt/release/bin`. You are Alice, starting in `/home/alice`.

Your job:

1. **Reproduce the failure** by invoking the command by name.
2. **Inspect command lookup and executable metadata.** Determine whether the file is missing, inaccessible, or outside this session's search path.
3. **Repair this session without moving, copying, or changing the executable.** Preserve the existing command-search directories.
4. **Confirm lookup resolves the approved executable**, then run `deploy` by name without elevated privileges.

The grader checks the failed invocation, successful lookup, an actual script execution, and unchanged executable metadata.
