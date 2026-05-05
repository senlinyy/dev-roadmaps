```bash
aws ecr describe-images --repository-name devpolaris-orders-api
aws ecs describe-task-definition --task-definition devpolaris-orders-api:42
aws ecs describe-services --cluster devpolaris-orders-prod --services devpolaris-orders-api
```

Following the release means connecting three pieces: the pushed image, the runtime recipe, and the service that actually launches tasks from that recipe.
