---
title: "Inspect RDS Instance Shape"
sectionSlug: the-rds-shape-in-aws
order: 4
---

The orders API uses the RDS database instance `devpolaris-orders-prod` in Region `us-east-1`. Before debugging a connection problem, first inspect the database shape AWS knows about: status, endpoint, encryption, backup retention, and whether it is publicly reachable.

Your job:

1. **Describe the DB instance** named `devpolaris-orders-prod`.
2. **Keep the output visible** so the grader can see the endpoint and safety settings.
3. **Do not create or change resources** for this step.

The grader checks the AWS CLI output, not a written explanation.
