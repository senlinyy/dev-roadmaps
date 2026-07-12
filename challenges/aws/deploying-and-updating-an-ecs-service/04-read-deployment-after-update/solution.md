```bash
aws ecs describe-services --cluster devpolaris-orders-prod --services devpolaris-orders-api
aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/devpolaris-orders-api-tg/6d0ecf831eec9f09
```
