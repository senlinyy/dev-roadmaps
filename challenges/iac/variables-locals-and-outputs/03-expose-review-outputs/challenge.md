---
title: "Expose Review Outputs"
sectionSlug: outputs-expose-selected-results
order: 3
---

Add the bucket outputs in `outputs.tf` using the resource from `s3.tf`.

Requirements:

1. **Output:** `bucket_name` with value `aws_s3_bucket.orders_invoices.bucket`.
2. **Output:** `bucket_arn` with value `aws_s3_bucket.orders_invoices.arn`.
3. **Descriptions:** add a clear `description` to both outputs.
