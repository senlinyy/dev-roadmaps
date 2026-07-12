---
title: "Call a Private Bucket Module"
sectionSlug: calling-the-module-from-an-environment
order: 1
---

Production needs the reviewed private bucket pattern, not another copied S3 resource. Add the module call from the environment root and pass the release values the child module expects.

Your job:

1. **Call the private bucket module** from the production root using the local module source already used in this repository.
2. **Pass the invoice bucket name and service context** for the orders production bucket.
3. **Preserve the ownership and recovery choices** from the release brief, including platform ownership and versioning.

The grader checks the module call and inputs in HCL.
