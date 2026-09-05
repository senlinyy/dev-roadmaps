---
title: "Trace Who Started It"
sectionSlug: how-do-process-creation-pids-parents-and-exit-status-fit-together
order: 2
---

A teammate left a preview process running after testing a release. Compare its ownership with the managed orders worker before deciding which launch method belongs in production.

You start in `/home/dev`. Your job:

1. Trace the ancestors of preview PID `410`, including the login shell.
2. Inspect the parent and full command of managed worker PID `310`.
3. Read the workload membership of both processes and leave them unchanged.

The grader checks process evidence and final state, not copied output. This terminal uses simulated processes; no host processes are affected.

