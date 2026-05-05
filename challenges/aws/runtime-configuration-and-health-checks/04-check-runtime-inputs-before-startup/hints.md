Inspect the ECS task definition first. The secret ARN and execution role are both in that output.

---

After checking the secret metadata in Secrets Manager, simulate the execution role's IAM permissions against that secret ARN and action name.
