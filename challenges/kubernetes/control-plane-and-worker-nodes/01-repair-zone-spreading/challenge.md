---
title: "Repair Notification API Zone Spreading"
sectionSlug: controllers-and-the-scheduler
order: 1
---

The notification API Deployment retains its production ownership and container context, but its placement policy was removed during review. Author a topology spread constraint so the scheduler balances matching API Pods across zones while still allowing placement during a temporary zone shortage.

Your job:

1. **Keep the Deployment named `notification-api`** in namespace `notifications-prod` with `2` replicas.
2. **Author one topology spread constraint** with maximum skew `1` across topology key `topology.kubernetes.io/zone`.
3. **Set the unsatisfied placement policy** to `ScheduleAnyway`.
4. **Build the constraint selector** around label `app: notification-api`.

The grader checks every exact scheduling literal in the parsed Deployment manifest.
