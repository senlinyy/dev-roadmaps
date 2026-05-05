```bash
aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::123456789012:role/devpolaris-orders-api-prod-task-role --action-names s3:PutObject --resource-arns arn:aws:s3:::devpolaris-orders-exports-prod/orders-api/daily.csv arn:aws:s3:::devpolaris-orders-exports-prod/manual-backups/daily.csv
```

The same action can have two different answers because IAM evaluates the action and resource together.
