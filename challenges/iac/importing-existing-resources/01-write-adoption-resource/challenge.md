---
title: "Write the Adoption Resource"
sectionSlug: write-the-resource-block-first
order: 1
---

Describe the existing invoice bucket in `main.tf` before import.

Requirements:

1. **Resource:** `aws_s3_bucket.orders_invoices`.
2. **Bucket:** `dp-orders-invoices-prod`.
3. **Tags:** `service = "orders-api"`, `environment = "prod"`, `owner = "platform"`.
4. **Do not add** an `import` block in this step.
