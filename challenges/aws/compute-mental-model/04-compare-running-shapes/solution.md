```bash
aws ec2 describe-instances --instance-ids i-orders-api-01
aws ecs describe-services --cluster devpolaris-orders-prod --services devpolaris-orders-api
aws lambda get-function-configuration --function-name devpolaris-receipt-email
```
