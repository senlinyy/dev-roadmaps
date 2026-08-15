---
title: "Gate an Optional Log Bucket"
sectionSlug: creating-an-optional-resource
order: 1
revision: 2
---

Development environments may skip the long-term log archive, while production enables it. Use one boolean input to control both the bucket and its public-access guardrail without leaving an invalid reference.

Your job:

1. **Declare** boolean variable `enable_log_archive` with default false.
2. **Set** count on both resources to `var.enable_log_archive ? 1 : 0`.
3. **Reference** the counted bucket as `aws_s3_bucket.log_archive[0].id` from the access block.
4. **Keep** all four public access protections true.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
