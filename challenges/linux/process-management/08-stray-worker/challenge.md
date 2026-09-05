---
title: "Remove the Stray Worker"
sectionSlug: how-do-you-diagnose-a-process-that-exits-hangs-or-returns
order: 8
---

Two Node workers are consuming orders. The intended worker runs `/srv/orders/worker.js` under the orders service. A manually launched old release must be removed without disrupting the intended worker.

You start in `/home/dev`. Your job:

1. Inspect both workers, including their parent, owner, and full command.
2. Confirm the duplicate's working directory and workload membership.
3. Terminate only the accidental duplicate through a graceful request.
4. Verify that the duplicate is gone and the managed worker is still running.

The grader checks process evidence and final state, not copied output. This terminal uses simulated processes; no host processes are affected.

