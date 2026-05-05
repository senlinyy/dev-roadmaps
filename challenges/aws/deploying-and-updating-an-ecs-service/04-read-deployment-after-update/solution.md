```bash
aws ecs describe-services --cluster devpolaris-orders-prod --services devpolaris-orders-api
aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/devpolaris-orders-api-tg/6d0ecf831eec9f09
```

A deployment is not done just because tasks are running. The target group confirms whether the load balancer agrees those tasks can receive traffic.
