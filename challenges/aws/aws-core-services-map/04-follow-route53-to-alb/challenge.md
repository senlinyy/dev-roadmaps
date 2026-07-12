---
title: "Follow Route 53 To ALB"
sectionSlug: traffic-how-users-reach-the-app
order: 4
---

A customer types the friendly name `orders.devpolaris.com` in the hosted zone `devpolaris.com`, but AWS routes traffic to the `devpolaris-orders-alb` load balancer DNS name. Follow the DNS record to the ALB and keep the domain as one hop in the system.

Your job:

1. **Find the hosted zone** for `devpolaris.com`.
2. **List the record sets** in that zone.
3. **Inspect `devpolaris-orders-alb`** after the alias record points you at the ALB.

The grader checks that your output connects `orders.devpolaris.com` to the ALB DNS name.
