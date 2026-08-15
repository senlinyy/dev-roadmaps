---
title: "Connect Values Across HCL Files"
sectionSlug: values-flow-through-variables-locals-resources-and-outputs
order: 1
revision: 2
---

The repository has the right file boundaries, but its service name never reaches the managed bucket or the published output. Complete the data flow without duplicating the final name as a literal.

Your job:

1. **Declare** `service_name` with type `string` and default `orders`.
2. **Build** local `bucket_name` with `format("dp-%s-assets", var.service_name)`.
3. **Use** `local.bucket_name` for the bucket and expose the managed bucket ID as output `bucket_id`.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
