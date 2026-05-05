---
title: "Check Private Outbound Path"
sectionSlug: private-apps-still-need-outbound-access
order: 4
---

Private ECS tasks cannot receive direct internet traffic, but they still need safe outbound paths for images, logs, secrets, and supporting APIs. Check private route table `rtb-private-orders`, NAT gateway `nat-orders-a`, and VPC endpoints `vpce-secretsmanager` and `vpce-logs`.

Your job:

1. **Inspect the private route table** for the default outbound target.
2. **Inspect the NAT gateway** used by that route.
3. **Inspect the VPC endpoints** for private AWS service access.

The grader checks that your output shows both NAT and private AWS service access.
