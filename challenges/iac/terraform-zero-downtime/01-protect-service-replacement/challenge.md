---
title: "Protect Service Replacement with Health Gates"
sectionSlug: health-checks-before-traffic-moves
order: 1
revision: 2
---

A launch template update must not move traffic to unhealthy instances or drain the entire fleet. Complete the target health contract and the Auto Scaling refresh policy that protects capacity during replacement.

Your job:

1. **Configure** target group health checks for path `/ready`, matcher `200-299`, interval 30 seconds, and healthy threshold 3.
2. **Configure** `instance_refresh` with strategy `Rolling`.
3. **Set** refresh preferences to minimum healthy percentage 90 and instance warmup 120 seconds.
4. **Add** lifecycle `create_before_destroy = true` to the launch template.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
