---
title: "Add the Import Block"
sectionSlug: importing-an-existing-object
order: 2
---

The adoption pull request now needs the state mapping. Keep the resource description and import intent together so reviewers can prove Terraform will adopt the existing bucket instead of creating a new one.

Your job:

1. **Keep the invoice bucket resource** aligned with the existing production bucket and ownership tags.
2. **Map the import** to the same Terraform address the resource block declares.
3. **Use the existing bucket's provider ID** as the import identity.

The grader checks the resource and import mapping files, not a Terraform CLI run.
