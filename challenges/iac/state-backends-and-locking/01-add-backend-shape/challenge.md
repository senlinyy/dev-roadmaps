---
title: "Add Backend Shape"
sectionSlug: backend-configuration-in-tf-files
order: 1
---

The production root module still uses local state. Add a backend configuration that points this stack at the shared protected state location, while keeping credentials out of the Terraform files.

Your job:

1. **Configure the S3 backend** for the orders production state record.
2. **Use the production state bucket, key, and region** from the platform handoff.
3. **Leave credential material out of backend configuration** so the runner identity supplies access.

The grader checks the backend block in HCL.
