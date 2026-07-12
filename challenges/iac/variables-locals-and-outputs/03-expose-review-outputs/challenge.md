---
title: "Expose Review Outputs"
sectionSlug: consuming-variables-in-locals-and-resources
order: 3
---

The deployment handoff needs the bucket identity after apply. Add outputs for the values humans and scripts actually need, and keep those values tied to the managed resource.

Your job:

1. **Expose the bucket name** from the invoice bucket resource.
2. **Expose the bucket ARN** from the same managed resource.
3. **Describe both outputs** so the module interface is understandable.

The grader checks the output blocks in HCL.
