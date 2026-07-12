---
title: "Configure the AWS Provider"
sectionSlug: the-first-managed-object
order: 1
---

The first managed object needs a provider setup that reviewers can trust. Complete the AWS provider requirement and region configuration before resource code depends on it.

Your job:

1. **Declare the AWS provider package** from the HashiCorp namespace with a reviewed version constraint.
2. **Configure the provider region** for the production orders stack.
3. **Apply the default project tags** that should follow resources managed by this root.

The grader checks the provider requirement and provider configuration in HCL.
