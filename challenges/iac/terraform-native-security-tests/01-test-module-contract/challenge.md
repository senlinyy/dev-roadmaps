---
title: "Test the Module Contract"
sectionSlug: the-module-contract-test
order: 1
revision: 2
---

The bucket module promises that production names include both the service and environment. Add a native plan test that supplies production inputs and asserts the exact computed bucket name.

Your job:

1. **Create** run `production_bucket_name` with command `plan`.
2. **Pass** service name `billing` and environment `prod` through a variables block.
3. **Add** an assert comparing `aws_s3_bucket.this.bucket` with `dp-billing-prod`.
4. **Use** a failure message that identifies the naming contract.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
