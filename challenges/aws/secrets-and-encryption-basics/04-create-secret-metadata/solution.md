```bash
aws secretsmanager create-secret --name /devpolaris/orders-api/prod/database-url --secret-string postgres://orders-prod-redacted --tags Key=service,Value=devpolaris-orders-api Key=env,Value=prod
aws secretsmanager describe-secret --secret-id /devpolaris/orders-api/prod/database-url
```

In real work, the secret value would come from a secure handoff. The habit here is naming and tagging the secret so the app can reference it without spreading the value around.
