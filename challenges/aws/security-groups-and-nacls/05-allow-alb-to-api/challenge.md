---
title: "Allow ALB To API"
sectionSlug: why-security-group-references-beat-broad-cidrs
order: 5
---

The ALB is healthy, but target security group `sg-orders-api` has no inbound rule from safe source security group `sg-orders-alb` on port `3000`. Add the narrow rule and avoid opening the API to `0.0.0.0/0`.

Your job:

1. **Inspect the API security group** before changing it.
2. **Authorize inbound TCP traffic on port `3000`** from the ALB security group.
3. **Inspect the API security group again** to confirm the source group reference.

The grader checks that the new rule uses `sg-orders-alb` as the source.
