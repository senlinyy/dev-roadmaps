---
title: "Declare an Existing Bucket Import"
sectionSlug: importing-an-existing-object
order: 2
revision: 2
---

The audit bucket already exists in AWS but has no Terraform ownership record. Declare both the desired resource and its import so the first reviewed plan can reconcile configuration with the existing object.

Your job:

1. **Declare** `aws_s3_bucket.audit` with bucket name `dp-security-audit-prod`.
2. **Add** an `import` block targeting `aws_s3_bucket.audit`.
3. **Use** import ID `dp-security-audit-prod`.
4. **Keep** the import target and resource address identical.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
