---
title: "Create the Orders Bucket"
sectionSlug: resources-are-the-objects-terraform-owns
order: 2
---

Add the invoice bucket resource in `s3.tf` using the existing provider and local values.

Requirements:

1. **Resource:** `aws_s3_bucket.orders_invoices`.
2. **Bucket:** `dp-orders-invoices-prod`.
3. **Tags:** `service = "devpolaris-orders"`, `environment = "prod"`, `owner = "platform"`.
