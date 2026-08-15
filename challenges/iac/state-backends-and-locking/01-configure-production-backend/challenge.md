---
title: "Configure the Production Backend"
sectionSlug: backend-configuration-in-tf-files
order: 1
revision: 2
---

The orders production root module must move from local state to the platform state bucket. Declare only the shared location and keep all credential material outside HCL.

Your job:

1. **Add** one S3 backend under the existing `terraform` block.
2. **Use** bucket `dp-terraform-state-prod`.
3. **Use** key `orders/prod/terraform.tfstate` and region `eu-west-2`.
4. **Enable** native S3 lockfile use with `use_lockfile = true`.
5. **Do** not add access key, secret key, or session token fields.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
