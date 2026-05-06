---
title: "Call a Private Bucket Module"
sectionSlug: root-modules-and-child-modules
order: 1
---

Add the private bucket module call in `main.tf` using the existing root context.

Requirements:

1. **Module:** `invoice_bucket`.
2. **Source:** `../../modules/private-bucket`.
3. **Inputs:** `bucket_name = "dp-orders-invoices-prod"`, `service = "orders-api"`, `environment = "prod"`.
4. **Ownership and recovery:** `owner = "platform"`, `versioning_enabled = true`.
