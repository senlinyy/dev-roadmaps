---
title: "Parameterize with Inputs"
sectionSlug: inputs-and-outputs
order: 2
---

Your composite action hardcodes Node.js version 22, but some backend services require Node 18. You need to make the version configurable so that different caller workflows can specify which version they need.

Your task:

1. **Declare an input parameter** for the Node.js version with a sensible default value.
2. **Reference the input** in the setup step so it uses the caller's value instead of a hardcoded one.

The grader validates that the inputs block exists and that the input is referenced in the steps.
