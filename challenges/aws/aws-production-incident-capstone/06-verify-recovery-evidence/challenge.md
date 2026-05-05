---
title: "Verify Recovery Evidence"
sectionSlug: rollback-target-and-recovery-thinking
order: 6
---

The team restored `devpolaris-orders-api` to task definition `devpolaris-orders-api:57`. Verify the service, target group, alarm, and log evidence before calling the incident recovered.

Your job:

1. **Inspect the ECS service** `devpolaris-orders-api` in cluster `devpolaris-orders-prod`.
2. **Inspect target health** for target group ARN `arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/devpolaris-orders-api-tg/6d0ecf831eec9f09`.
3. **Inspect alarm state** for `devpolaris-orders-api-alb-5xx`.
4. **Inspect log events** in `/ecs/devpolaris-orders-api` related to rollback.

The grader checks AWS evidence that revision 57 is running, targets are healthy, the alarm is OK, and logs record the rollback.
