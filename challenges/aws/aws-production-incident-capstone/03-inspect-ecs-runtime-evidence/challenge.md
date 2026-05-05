---
title: "Inspect ECS Runtime Evidence"
sectionSlug: from-artifact-to-running-version
order: 3
---

The target group showed one unhealthy target from the new deployment. The ECS cluster is `devpolaris-orders-prod`, the service is `devpolaris-orders-api`, and the new task definition revision is `devpolaris-orders-api:58`.

Your job:

1. **Inspect the ECS service** to see deployment counts and recent events.
2. **Inspect the task list** for service `devpolaris-orders-api` in cluster `devpolaris-orders-prod`.
3. **Inspect the task details** for the tasks returned by ECS.
4. **Inspect task definition** `devpolaris-orders-api:58` to see image, environment, and secret references.

The grader checks AWS evidence for the mixed deployment, stopped task reason, and secret reference used by revision 58.
