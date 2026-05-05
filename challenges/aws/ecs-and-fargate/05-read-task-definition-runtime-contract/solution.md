```bash
aws ecs describe-task-definition --task-definition devpolaris-orders-api:42
aws iam get-role --role-name devpolaris-orders-api-prod-task-role
aws iam get-role --role-name devpolaris-orders-api-prod-execution-role
```

The task definition is where the image, port, config names, secrets, roles, and logging contract meet. It is usually the fastest place to check before changing the service.
