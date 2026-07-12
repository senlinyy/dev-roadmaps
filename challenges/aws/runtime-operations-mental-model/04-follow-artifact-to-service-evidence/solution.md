```bash
aws ecr describe-images --repository-name devpolaris-orders-api
aws ecs describe-task-definition --task-definition devpolaris-orders-api:42
aws ecs describe-services --cluster devpolaris-orders-prod --services devpolaris-orders-api
```
