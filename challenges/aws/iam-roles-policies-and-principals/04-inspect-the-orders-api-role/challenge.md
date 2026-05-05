---
title: "Inspect The Orders API Role"
sectionSlug: the-ecs-task-role-for-the-orders-api
order: 4
---

The `devpolaris-orders-api` service runs on ECS, so its AWS access should come from the `devpolaris-orders-api-prod-task-role` task role, not from a developer's login.

Your job:

1. **Inspect role metadata** for `devpolaris-orders-api-prod-task-role`.
2. **Find the policies attached to that role** so the role's job is visible.

The grader checks that you found the task role and its attached runtime policy.
