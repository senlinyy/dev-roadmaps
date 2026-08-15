---
title: "Publish the Managed Service Endpoint"
sectionSlug: outputs-consuming-resources-and-locals
order: 1
revision: 2
---

The deployment pipeline needs the load balancer endpoint after apply. Expose the managed value through a documented output rather than copying a hostname into another system.

Your job:

1. **Declare** output `orders_endpoint`.
2. **Set** its value to the HTTPS URL derived from `aws_lb.orders.dns_name`.
3. **Add** a description that identifies it as the orders API endpoint.
4. **Keep** the output non-sensitive.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
