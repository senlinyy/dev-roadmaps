---
title: "Build the Reviewed Plan Job"
sectionSlug: testing-layers-in-the-pipeline
order: 1
revision: 2
---

Pull requests need one reproducible Terraform plan artifact after local checks. Complete the job so validation gates planning and the exact saved plan can move to a protected apply workflow later.

Your job:

1. **Grant** contents read and id-token write permissions.
2. **Run** format check, initialization, validation, and plan in that order.
3. **Save** the plan as `release.tfplan`.
4. **Upload** `release.tfplan` as artifact `terraform-plan`.
5. **Do** not run apply in the pull-request workflow.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
