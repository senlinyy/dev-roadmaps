---
title: "Build Common Locals"
sectionSlug: consuming-variables-in-locals-and-resources
order: 2
---

The resource repeats naming and tag logic that should live in one local expression. Shape the service and environment inputs once, then let the bucket consume those local values.

Your job:

1. **Create a local name prefix** from the service and environment inputs.
2. **Create common tags** from service, environment, managed-by, and caller-provided extra tags.
3. **Use the local name prefix** when building the invoice bucket name.
4. **Use the local tag map** on the bucket resource.

The grader checks the locals and resource references in HCL.
