---
title: "Preview a Create Plan"
order: 1
---

The editor starts with an incomplete Terraform AWS root module for a private staging artifact bucket. Finish the relationships between its input, local values, resources, and output, then use the Plan Preview panel to inspect the create plan.

Your job:

1. **Set the environment input** to `staging` and derive the artifact bucket name from that input.
2. **Apply the shared local tags** to the bucket.
3. **Complete the public access block** so all four S3 public access controls are enabled and it references the bucket resource.
4. **Expose the bucket name** from the managed resource, then preview the result and confirm two resources are added.

The grader checks the authored Terraform relationships and safety controls. The Preview Plan button checks the local parser output, not a real cloud account.
