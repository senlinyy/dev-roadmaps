---
title: "Compare Task And Target Health"
sectionSlug: alb-target-health-in-practice
order: 5
---

The ECS task `arn:aws:ecs:us-east-1:123456789012:task/devpolaris-orders-prod/task-broken-health` in Region `us-east-1` can be running while target group `arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/devpolaris-orders-api-tg/6d0ecf831eec9f09` still refuses to send it real traffic. Compare both views before deciding where the fix belongs.

Your job:

1. **Describe the ECS task** in cluster `devpolaris-orders-prod` and check whether the container is running.
2. **Describe target health** and check what the load balancer says about the same private task IP.

The grader checks that you gathered both ECS health and ALB target health evidence.
