---
title: "Inspect Request Path Evidence"
sectionSlug: the-orders-api-path
order: 4
---

The `devpolaris-orders-api` service is reachable through several network pieces, not one magic service. Collect evidence for public front door `devpolaris-orders-alb`, public subnet `subnet-public-a`, private app subnet `subnet-private-a`, and security groups `sg-orders-alb` and `sg-orders-api`.

Your job:

1. **Inspect the load balancer** named `devpolaris-orders-alb`.
2. **Inspect the public and private subnets** in the request path.
3. **Inspect the ALB and API security groups** so reachability and routing stay separate.

The grader checks that your output shows the public entry point, private app placement, and the security groups involved.
