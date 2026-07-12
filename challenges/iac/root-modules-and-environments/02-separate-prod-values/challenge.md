---
title: "Separate Prod Values"
sectionSlug: what-lives-in-an-environment-folder
order: 2
---

The production folder already has its module call. Move production decisions into the values file so reviewers can see what production changes without editing module source code.

Your job:

1. **Set the production environment and region values** in the production tfvars file.
2. **Use production capacity and safety settings** for the orders service.
3. **Provide the production invoice and export bucket names** as values.
4. **Keep module source and module blocks out of the values file**.

The grader checks the production values file in HCL.
