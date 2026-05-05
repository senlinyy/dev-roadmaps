---
title: "Inspect Export Objects"
sectionSlug: designing-keys-for-orders-exports
order: 4
---

The DevPolaris orders team stores daily export files in the S3 bucket `devpolaris-orders-exports-prod` in Region `us-east-1`. You need to check which May 2026 daily export objects already exist before a support teammate asks for the latest file.

Your job:

1. **List the objects** in bucket `devpolaris-orders-exports-prod`.
2. **Limit the listing** to the prefix `orders-api/daily/2026/05/`.
3. **Keep the output visible** so the grader can see the object keys.

The grader checks the AWS CLI output, not a written explanation.
