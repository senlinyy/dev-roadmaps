---
title: "Read Target Health With AWS CLI"
sectionSlug: what-target-health-really-means
order: 4
---

The public URL is returning intermittent errors. Before blaming DNS or IAM, inspect ALB `devpolaris-orders-alb`, its HTTPS listener on port `443`, target group `devpolaris-orders-api-tg`, and health check path `/health`.

Your job:

1. **Inspect the load balancer and listener**.
2. **Inspect the target group**.
3. **Read target health** for the target group.

The grader checks that your output shows the target group, health check path, and one unhealthy target.
