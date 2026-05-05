---
title: "Read Deployment After Update"
sectionSlug: reading-the-deployment-after-it-finishes
order: 4
---

A service update finished for `devpolaris-orders-api`. The ECS cluster is `devpolaris-orders-prod`, and the target group is `arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/devpolaris-orders-api-tg/6d0ecf831eec9f09`.

Your job:

1. **Inspect the ECS service** and its deployment state.
2. **Inspect target health** for the service target group.
3. **Keep both outputs visible** so the grader can see whether running tasks are also healthy targets.

The grader checks AWS service and target health evidence.
