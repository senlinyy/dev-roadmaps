---
title: "Simulate One IAM Request"
sectionSlug: actions-resources-and-conditions
order: 5
---

The team wants to know whether role `arn:aws:iam::123456789012:role/devpolaris-orders-api-prod-task-role` can run `s3:PutObject` only under the approved prefix. Compare the IAM decision for approved object `arn:aws:s3:::devpolaris-orders-exports-prod/orders-api/daily.csv` with unapproved object `arn:aws:s3:::devpolaris-orders-exports-prod/manual-backups/daily.csv` before changing a policy.

Your job:

1. **Check the IAM decision** for `s3:PutObject` on the approved export object.
2. **Check the same action** against the unapproved backup prefix.

The grader checks that your output shows one allowed request and one denied request.
