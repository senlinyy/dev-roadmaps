```bash
aws secretsmanager describe-secret --secret-id devpolaris/orders/prod/payments-token
aws iam get-role --role-name devpolaris-orders-api-prod-execution-role
aws iam list-attached-role-policies --role-name devpolaris-orders-api-prod-execution-role
aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::123456789012:role/devpolaris-orders-api-prod-execution-role --action-names secretsmanager:GetSecretValue --resource-arns arn:aws:secretsmanager:us-east-1:123456789012:secret:devpolaris/orders/prod/payments-token-a1b2c3
```

The simulation returns `implicitDeny` for the payments token. Revision 58 asks ECS to inject a secret that the execution role cannot read.
