---
title: "Inspect Load Balancer Health"
sectionSlug: health-capacity-and-traffic
order: 2
---

The public entry point for `devpolaris-orders-api` is the Application Load Balancer `devpolaris-orders-alb`. The target group is `devpolaris-orders-api-tg` with ARN `arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/devpolaris-orders-api-tg/6d0ecf831eec9f09`.

Your job:

1. **Inspect the load balancer** named `devpolaris-orders-alb`.
2. **Inspect the HTTPS listener** connected to that load balancer.
3. **Inspect the target group** named `devpolaris-orders-api-tg`.
4. **Inspect target health** for the target group ARN above.

The grader checks AWS evidence for the ALB, listener, target group, health check path, and unhealthy target.
