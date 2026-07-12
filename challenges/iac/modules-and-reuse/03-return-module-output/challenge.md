---
title: "Return a Module Output"
sectionSlug: extracting-one-private-bucket-module
order: 3
---

A downstream IAM policy needs to reference the bucket created inside the module. Expose the module values callers actually need instead of asking them to rebuild provider identifiers by hand.

Your job:

1. **Publish the bucket name** from the managed bucket resource.
2. **Publish the bucket ARN** from the same resource so policies can reference it safely.
3. **Describe both outputs** so the module contract is readable.
4. **Avoid rebuilding provider identifiers** from literal strings.

The grader checks the output blocks in HCL.
