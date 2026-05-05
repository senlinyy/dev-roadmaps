```bash
aws ecs describe-task-definition --task-definition devpolaris-orders-api:43
aws secretsmanager describe-secret --secret-id /devpolaris/orders-api/prod/database-url
aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::123456789012:role/devpolaris-orders-api-prod-execution-role --action-names secretsmanager:GetSecretValue --resource-arns arn:aws:secretsmanager:us-east-1:123456789012:secret:/devpolaris/orders-api/prod/database-url-a1b2c3
```

This checks the path ECS needs before your app starts: task definition names the secret, the secret exists in the right Region, and the execution role can read it.
