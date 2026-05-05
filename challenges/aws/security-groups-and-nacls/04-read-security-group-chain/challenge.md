---
title: "Read Security Group Chain"
sectionSlug: the-orders-api-rule-chain
order: 4
---

The orders request path crosses three packet rules: public users to `sg-orders-alb` on port `443`, `sg-orders-alb` to `sg-orders-api` on port `3000`, and `sg-orders-api` to `sg-orders-db` on port `5432`. Read those rules as a chain instead of one big firewall list.

Your job:

1. **Inspect the ALB, API, and database security groups**.
2. **Find the source and port for each hop** in the output.

The grader checks that your output shows the public HTTPS rule, the ALB-to-API rule, and the API-to-database rule.
