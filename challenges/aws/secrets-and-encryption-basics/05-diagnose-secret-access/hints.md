The role ARN is `arn:aws:iam::123456789012:role/devpolaris-orders-api-prod-task-role`, the secret ARN is `arn:aws:secretsmanager:us-east-1:123456789012:secret:/devpolaris/orders-api/prod/database-url-a1b2c3`, and the action is `secretsmanager:GetSecretValue`.

---

Use Secrets Manager to inspect metadata for `/devpolaris/orders-api/prod/database-url` before simulating permission.

---

Use IAM policy simulation for the role, action, and secret ARN, then look up the `GetSecretValue` event in CloudTrail.
