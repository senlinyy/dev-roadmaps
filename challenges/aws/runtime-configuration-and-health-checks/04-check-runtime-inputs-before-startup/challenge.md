---
title: "Check Runtime Inputs Before Startup"
sectionSlug: secret-injection-and-iam-access-before-startup
order: 4
---

A task can fail before Node.js prints a single app log if ECS cannot fetch the runtime inputs. In Region `us-east-1`, inspect task definition `devpolaris-orders-api:43`, secret `/devpolaris/orders-api/prod/database-url`, secret ARN `arn:aws:secretsmanager:us-east-1:123456789012:secret:/devpolaris/orders-api/prod/database-url-a1b2c3`, and execution role `arn:aws:iam::123456789012:role/devpolaris-orders-api-prod-execution-role`.

Your job:

1. **Describe the task definition** and find the injected secret name and execution role.
2. **Describe the secret** so the ARN and Region are visible.
3. **Simulate the execution role permission** for `secretsmanager:GetSecretValue` on that secret.

The grader checks that you followed the startup input path before blaming app code.
