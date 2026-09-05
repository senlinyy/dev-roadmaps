---
title: "Handle an Unresponsive Worker"
sectionSlug: how-do-signals-control-a-process-lifecycle
order: 5
---

An unmanaged export has stopped making progress. Its shutdown contract allows five seconds for TERM; force is authorized only if it still remains after that interval and a fresh state check.

You start in `/home/dev`. Your job:

1. Inspect PID `520`, including its owner, full command, and state.
2. Try graceful termination and allow the five-second shutdown interval.
3. Inspect it again before deciding whether forced termination is necessary.
4. Verify the final absence of PID `520`, leaving the orders worker untouched.

Foreground sleep advances the lab clock immediately, so the shutdown interval does not require a real-time wait. The grader checks process evidence and final state, not copied output. No host processes are affected.
