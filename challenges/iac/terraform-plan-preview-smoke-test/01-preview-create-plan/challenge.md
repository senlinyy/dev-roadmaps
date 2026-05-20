---
title: "Preview a Create Plan"
order: 1
---

The editor starts with a small Terraform AWS root module that creates a private artifact bucket from empty state. Use this as a local smoke test for the Plan Preview panel.

Your job:

1. **Open the preview** without changing anything first.
2. **Confirm the plan summary** shows two resources to add.
3. **Change `environment`** in `variables.tf` from `dev` to `staging`, then preview again and confirm the bucket name updates.

The grader checks that the authored Terraform shape is still intact. The Preview Plan button checks the local parser output, not a real cloud account.
