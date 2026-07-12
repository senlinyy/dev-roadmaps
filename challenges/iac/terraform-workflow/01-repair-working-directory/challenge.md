---
title: "Repair the Working Directory"
sectionSlug: configuration-is-the-teams-starting-point
order: 1
---

The starter root module is missing the pieces a first plan needs: provider setup and one managed object. Repair the working directory so Terraform can preview a single invoice bucket change.

Your job:

1. **Complete the AWS provider setup** with a reviewed provider source, version constraint, and production region.
2. **Add the managed invoice bucket** for the orders production service.
3. **Apply the service ownership tags** from the release brief.
4. **Keep provider setup and resource configuration in focused files**.

The grader checks the HCL files, not a real Terraform command.
