```bash
aws ecs describe-task-definition --task-definition devpolaris-orders-api:42
aws secretsmanager describe-secret --secret-id /devpolaris/orders-api/prod/database-url
```
