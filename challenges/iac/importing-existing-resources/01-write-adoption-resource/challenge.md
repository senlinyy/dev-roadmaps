---
title: "Write the Adoption Resource"
sectionSlug: importing-an-existing-object
order: 1
---

An invoice bucket already exists outside Terraform. Before anyone imports it, the pull request needs a resource block that describes the object Terraform is about to adopt.

Your job:

1. **Describe the existing bucket** named `dp-orders-invoices-prod` as the managed orders invoice bucket.
2. **Capture the ownership tags** from the release brief: service `orders-api`, environment `prod`, and owner `platform`.
3. **Keep this step focused on configuration** so the import mapping can be reviewed separately.

The grader checks the HCL resource shape, not a Terraform CLI run.
