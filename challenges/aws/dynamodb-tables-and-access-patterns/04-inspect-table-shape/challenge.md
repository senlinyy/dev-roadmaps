---
title: "Inspect Table Shape"
sectionSlug: tables-items-and-keys
order: 4
---

The checkout flow records idempotency state in the DynamoDB table `devpolaris-checkout-state` in Region `us-east-1`. Before writing code against it, inspect the table shape so you know the partition key, sort key, billing mode, and supporting index.

Your job:

1. **Describe the table** named `devpolaris-checkout-state`.
2. **Keep the output visible** so the grader can see the key schema and billing mode.
3. **Do not create or change resources** for this step.

The grader checks the AWS CLI output, not a written explanation.
