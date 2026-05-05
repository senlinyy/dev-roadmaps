```bash
aws ec2 describe-instances --instance-ids i-orders-api-01
aws ecs describe-services --cluster devpolaris-orders-prod --services devpolaris-orders-api
aws lambda get-function-configuration --function-name devpolaris-receipt-email
```

EC2 talks like a machine, ECS talks like a service keeping copies alive, and Lambda talks like a handler with invocation settings.
