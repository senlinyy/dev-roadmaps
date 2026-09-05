---
title: "Explain an Unexpected Restart"
sectionSlug: which-processes-use-resources-and-how-do-you-respond
order: 6
---

The orders API is running again after an abrupt exit within the last hour. The application log contains no exception. Establish whether the kernel killed the previous process, then inspect the process serving traffic now. You start in `/home/dev`.

Your job:

1. Inspect kernel events from the last hour for the killed process and its memory evidence.
2. Correlate those events with the orders.service exit and restart history for the same window.
3. Resolve the current main PID and inspect its status. Preserve the running service and unit configuration.

The grader checks actual diagnostic observations, process targeting, and unchanged workloads; copied output is not evidence. The earlier OOM is an authored historical event, not a live memory-allocation simulation.
