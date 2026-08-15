---
title: "Manage a Bucket and Its Versioning"
sectionSlug: resource-attributes-feeding-other-blocks
order: 1
revision: 2
---

The orders archive needs one named bucket and versioning managed as separate Terraform resources. Build both objects and connect them through the bucket identity so Terraform can infer ordering.

Your job:

1. **Create** `aws_s3_bucket.orders_archive` named `dp-orders-archive-prod`.
2. **Tag** the bucket with `Service = "orders"` and `Environment = "prod"`.
3. **Create** `aws_s3_bucket_versioning.orders_archive` using the bucket resource ID.
4. **Set** the versioning status to `Enabled`.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
