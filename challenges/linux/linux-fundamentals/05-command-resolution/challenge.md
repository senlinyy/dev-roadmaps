---
title: "Which Command Will Run?"
sectionSlug: how-do-you-find-files-and-commands
order: 5
revision: 1
---

Two Python launchers are installed on this server, and a locally managed operations tool should also be available. Determine what the current shell will execute instead of searching the entire filesystem by filename.

You start in `/home/dev`. Your job:

1. **Report the first `python` executable** selected by the current `PATH`.
2. **Show every reachable `python` executable** in shell search order.
3. **Report the executable selected for `ordersctl`**.

The grader checks the shell-resolution evidence and the order of the Python candidates.
