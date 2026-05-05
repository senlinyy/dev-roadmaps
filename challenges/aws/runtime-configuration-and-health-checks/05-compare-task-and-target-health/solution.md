```bash
aws ecs describe-tasks --cluster devpolaris-orders-prod --tasks arn:aws:ecs:us-east-1:123456789012:task/devpolaris-orders-prod/task-broken-health
aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/devpolaris-orders-api-tg/6d0ecf831eec9f09
```

Running is ECS evidence. Target health is traffic evidence. When they disagree, the fix often belongs in the health contract, app readiness, port, or load balancer path.
