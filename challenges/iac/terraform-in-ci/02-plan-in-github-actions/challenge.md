---
title: "Plan Terraform in GitHub Actions"
sectionSlug: a-beginner-safe-github-actions-workflow
order: 2
---

Write `.github/workflows/terraform-prod-checks.yml` so pull requests produce Terraform review evidence.

Requirements:

1. **Trigger scope:** pull requests that touch `infra/orders/prod/**`.
2. **Working directory:** `infra/orders/prod`.
3. **Steps:** run `terraform init -input=false`, `terraform fmt -check`, `terraform validate`, then `terraform plan -input=false`.
4. **Do not add** an apply step.
