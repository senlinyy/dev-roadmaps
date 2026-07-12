---
title: "Create the Orders Bucket"
sectionSlug: the-first-managed-object
order: 2
---

The orders service owns a production invoice bucket. Add the managed resource so Terraform can plan, apply, track, and eventually retire that object through state.

Your job:

1. **Create the invoice bucket resource** for the orders production bucket.
2. **Use the existing local naming value** where the starter files already provide it.
3. **Apply service, environment, and owner tags** so plan review shows the ownership boundary.

The grader checks the HCL resource, not a cloud API call.
