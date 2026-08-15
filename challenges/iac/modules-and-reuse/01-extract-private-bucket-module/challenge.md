---
title: "Extract a Private Bucket Module"
sectionSlug: extracting-one-private-bucket-module
order: 1
revision: 2
---

Two environments need the same protected log bucket behavior. Complete a child module that owns the resource, then call it from production and publish the resulting bucket ID.

Your job:

1. **In** `modules/private-bucket`, declare input `bucket_name`, create `aws_s3_bucket.this`, and output its ID.
2. **In** `live/prod/main.tf`, call module `logs` from `../../modules/private-bucket` and pass `dp-orders-logs-prod`.
3. **In** the production output, reference `module.logs.bucket_id`.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
