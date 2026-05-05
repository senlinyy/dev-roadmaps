---
title: "Verify Account and Region Before Work"
sectionSlug: account-ids-and-environment-checks
order: 4
---

The release target is the `devpolaris-orders-api` service in AWS account `123456789012` and Region `us-east-1`. Before you touch anything, compare that target with the AWS CLI context.

Your job:

1. **Ask AWS for the current caller identity** so the account is visible.
2. **Check the configured Region** and leave the comparison evidence in the terminal.
3. **Compare the output** with account `123456789012` and Region `us-east-1`.

The grader checks that you inspected the AWS CLI context.
