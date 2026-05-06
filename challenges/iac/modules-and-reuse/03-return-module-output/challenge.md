---
title: "Return a Module Output"
sectionSlug: outputs-connect-modules-without-guessing
order: 3
---

Add the bucket outputs in `modules/private-bucket/outputs.tf`.

Requirements:

1. **Output:** `bucket_name` with value `aws_s3_bucket.this.bucket`.
2. **Output:** `bucket_arn` with value `aws_s3_bucket.this.arn`.
3. **Descriptions:** add a clear `description` to both outputs.
4. **Do not use** a literal ARN string.
