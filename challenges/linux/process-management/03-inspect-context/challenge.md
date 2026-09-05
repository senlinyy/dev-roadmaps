---
title: "Inspect the Running Context"
sectionSlug: how-do-identity-proc-priority-and-cgroups-describe-resources
order: 3
---

The orders worker behaves differently from a developer's shell. Investigate PID `310` as it is actually running, without changing its files or printing its entire environment.

You start in `/home/dev`. Your job:

1. Resolve its executable and working directory.
2. Print only its `NODE_ENV` setting; elevated access is available for the protected process environment.
3. Inspect the open-file limit and the descriptor targets, including standard output.
4. Leave the worker running and unchanged.

The grader checks process evidence and final state, not copied output. This terminal uses simulated processes; no host processes are affected.

