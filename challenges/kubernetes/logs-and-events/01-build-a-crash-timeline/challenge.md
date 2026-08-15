---
title: "Build a CrashLoop Timeline"
sectionSlug: build-the-timeline
order: 1
---

The orders API rollout contains one repeatedly restarting Pod. Build an evidence timeline from workload state, Kubernetes decisions, and the output from the previously terminated container rather than guessing from the current process.

Your job:

1. **List orders API Pods** in namespace `orders` using label `app=orders-api`.
2. **Describe the restarting Pod** to inspect the BackOff event attached to that exact object.
3. **Read the previous logs** from container `api` in the restarting Pod.
4. **Use the final evidence** to identify why the prior container exited.

The grader checks the label-scoped Pod read, object-specific description, use of previous logs, and final crash evidence.
