---
title: "Plan Terraform in GitHub Actions"
sectionSlug: testing-layers-in-the-pipeline
order: 2
---

Write `.github/workflows/terraform-prod-checks.yml` so pull requests produce Terraform review evidence for the production orders root module without applying infrastructure.

Your task:

1. Trigger only for pull requests that touch the production orders Terraform directory.
2. Run every Terraform command against that root module, not the repository root.
3. Produce the standard review sequence: initialize, check formatting, validate, and create a non-interactive speculative plan.
4. Do not add an apply step.
