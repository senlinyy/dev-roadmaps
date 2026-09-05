---
title: "Shut Down Cleanly"
sectionSlug: how-do-signals-control-a-process-lifecycle
order: 4
---

The unmanaged nightly export must stop before a release. It needs five seconds to drain and removes its own lock after a clean shutdown.

You start in `/home/dev`. Your job:

1. Confirm the owner and full command of PID `510` before acting.
2. Request a graceful shutdown and allow its five-second drain period.
3. Verify that the process is gone and `/home/dev/export.lock` has been removed by the worker.
4. Keep the managed orders worker running.

Foreground sleep advances the lab clock immediately, so the drain does not require a real-time wait. The grader checks process evidence and final state, not copied output. No host processes are affected.
