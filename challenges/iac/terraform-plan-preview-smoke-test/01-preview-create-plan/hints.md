Start with the variable and locals. The bucket name should stay derived from the environment rather than becoming a second hardcoded name.
---
The public access block protects the bucket created in the other resource block, so connect it through that resource attribute.
---
After completing the output, Preview Plan should resolve the staging bucket name through the same resource attribute the output exposes.
