---
title: "Find the Right Process"
sectionSlug: how-do-you-inspect-processes-threads-and-states
order: 1
---

Orders is slow, but two Node processes run under the application account. Identify the reindex task without interrupting the worker serving orders.

You start in `/home/dev`. Your job:

1. Find the Node processes owned by `app`, showing their full command lines.
2. Inspect the PID, parent, owner, state, CPU usage, resident memory, and command for the process running `/srv/orders/reindex.js`.
3. Leave both processes running and keep their priorities unchanged.

The grader checks process evidence and final state, not copied output. This terminal uses simulated processes; no host processes are affected.

