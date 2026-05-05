```bash
aws ecs describe-task-definition --task-definition devpolaris-orders-api:42
aws secretsmanager describe-secret --secret-id /devpolaris/orders-api/prod/database-url
```

This checks the startup contract without leaking the actual database URL. The useful evidence is the reference, ownership, Region, and encryption metadata.
