---
title: "Check Certificate And Listener"
sectionSlug: https-listeners-terminate-tls
order: 5
---

DNS can point to the right ALB and HTTPS can still fail if the certificate or listener is wrong. For `orders.devpolaris.com`, check certificate `arn:aws:acm:us-east-1:123456789012:certificate/orders-cert` and listener `arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/devpolaris-orders-alb/50dc6c495c0c9188/9f49d4c9` together.

Your job:

1. **Describe the ACM certificate** for the orders domain.
2. **Describe the ALB listener** that uses the certificate.

The grader checks that your output shows the domain, issued certificate, HTTPS port, and target group.
