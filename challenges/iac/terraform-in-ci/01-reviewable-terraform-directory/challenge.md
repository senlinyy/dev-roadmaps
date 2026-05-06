---
title: "Make Terraform Reviewable"
sectionSlug: pull-request-checks
order: 1
---

Make the production Terraform root module safe for pull request checks.

Requirements:

1. **Provider source:** `hashicorp/aws`.
2. **Version constraint:** `~> 5.0`.
3. **Region:** `eu-west-2`.
4. **Do not include:** `access_key`, `secret_key`, or static credential literals.
