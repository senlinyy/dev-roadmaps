---
title: "Check Secret Access"
sectionSlug: config-secrets-and-permissions
order: 4
---

Revision `devpolaris-orders-api:58` injects secret `PAYMENTS_API_TOKEN` from `arn:aws:secretsmanager:us-east-1:123456789012:secret:devpolaris/orders/prod/payments-token-a1b2c3`. The execution role is `arn:aws:iam::123456789012:role/devpolaris-orders-api-prod-execution-role`.

Your job:

1. **Inspect the secret metadata** for `devpolaris/orders/prod/payments-token`.
2. **Inspect the execution role** named `devpolaris-orders-api-prod-execution-role`.
3. **Inspect the attached policies** for that role.
4. **Evaluate whether the role can read** the payments token secret.

The grader checks AWS evidence for the secret, execution role, attached policy list, and permission decision.
