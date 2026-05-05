Describe the secret first so you can confirm its ARN, Region, KMS key, and tags.

---

Inspect the execution role, not the application task role, because injected ECS secrets are retrieved before the app starts.

---

Use IAM policy simulation for the action `secretsmanager:GetSecretValue` against the payments token secret ARN.
