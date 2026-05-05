---
title: "Follow Route 53 To ALB"
sectionSlug: alias-records-connect-the-friendly-name-to-aws
order: 4
---

A customer types the friendly name `orders.devpolaris.com` in the hosted zone `devpolaris.com`, but AWS routes traffic to the `devpolaris-orders-alb` load balancer DNS name. Follow the DNS record to the ALB instead of treating the domain as the whole system.

Your job:

1. **Find the hosted zone** for `devpolaris.com`.
2. **List the record sets** in that zone.
3. **Inspect `devpolaris-orders-alb`** after the alias record points you at the ALB.

The grader checks that your output connects `orders.devpolaris.com` to the ALB DNS name.
