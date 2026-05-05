```bash
aws secretsmanager describe-secret --secret-id /devpolaris/orders-api/prod/database-url
aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::123456789012:role/devpolaris-orders-api-prod-task-role --action-names secretsmanager:GetSecretValue --resource-arns arn:aws:secretsmanager:us-east-1:123456789012:secret:/devpolaris/orders-api/prod/database-url-a1b2c3
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=GetSecretValue
```

The secret exists, but the task role does not have an allow for `secretsmanager:GetSecretValue`. That is a different problem from a missing secret or a network failure.
