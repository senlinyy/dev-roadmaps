---
title: "Add Backend Shape"
sectionSlug: a-backend-for-devpolaris-orders
order: 1
---

Add the shared production backend in `main.tf`.

Requirements:

1. **Backend type:** `s3`.
2. **Bucket:** `dp-terraform-state-prod`.
3. **Key:** `devpolaris-orders/prod/terraform.tfstate`.
4. **Region:** `eu-west-2`.
5. **Do not add** inline credential fields or AWS credential environment names.
