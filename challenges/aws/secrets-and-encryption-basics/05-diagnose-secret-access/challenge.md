---
title: "Diagnose Secret Access"
sectionSlug: failure-modes-and-diagnosis
order: 5
---

The `devpolaris-orders-api` service cannot read secret `/devpolaris/orders-api/prod/database-url`. Do not guess yet: collect evidence for secret ARN `arn:aws:secretsmanager:us-east-1:123456789012:secret:/devpolaris/orders-api/prod/database-url-a1b2c3`, role `arn:aws:iam::123456789012:role/devpolaris-orders-api-prod-task-role`, and action `secretsmanager:GetSecretValue`.

Your job:

1. **Inspect the secret metadata** to confirm the resource name and ARN.
2. **Check the IAM decision** for the task role reading that ARN.
3. **Find the audit event** for the failed secret read.

The grader checks that your output shows the secret, the IAM decision, and the audit failure.
