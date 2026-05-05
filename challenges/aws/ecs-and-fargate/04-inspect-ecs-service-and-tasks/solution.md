```bash
aws ecs describe-services --cluster devpolaris-orders-prod --services devpolaris-orders-api
aws ecs list-tasks --cluster devpolaris-orders-prod --service-name devpolaris-orders-api
aws ecs describe-tasks --cluster devpolaris-orders-prod --tasks arn:aws:ecs:us-east-1:123456789012:task/devpolaris-orders-prod/task-a111 arn:aws:ecs:us-east-1:123456789012:task/devpolaris-orders-prod/task-b222
```

The service tells you what ECS is trying to keep true. The tasks tell you which copies actually exist right now.
