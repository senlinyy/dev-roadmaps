---
title: "Declare a Resource Rename"
sectionSlug: renaming-a-resource-with-a-moved-block
order: 1
revision: 2
---

A refactor renames the bucket resource from `logs` to `archive`. Preserve the existing state address relationship so the next plan does not propose destroying and recreating the production bucket.

Your job:

1. **Keep** the new resource address `aws_s3_bucket.archive`.
2. **Add** one `moved` block.
3. **Set** `from` to `aws_s3_bucket.logs` and `to` to `aws_s3_bucket.archive`.
4. **Do** not keep a second resource block at the old address.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
