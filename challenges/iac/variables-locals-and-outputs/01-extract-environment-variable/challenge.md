---
title: "Extract Environment Variable"
sectionSlug: declaring-variables
order: 1
---

The bucket resource is hardcoded for one environment. Add an input so the same resource shape can be reviewed for dev, staging, or prod without copying the whole file.

Your job:

1. **Declare an environment input** with a clear string type.
2. **Use that input in the bucket name** instead of a fixed production suffix.
3. **Use the same input in the environment tag** so names and tags stay aligned.
4. **Remove the hardcoded production value** from the editable resource file.

The grader checks the variable and resource references in HCL.
