```bash
aws ecs describe-services --cluster devpolaris-orders-prod --services devpolaris-orders-api
aws ecs list-tasks --cluster devpolaris-orders-prod --service-name devpolaris-orders-api
aws ecs describe-tasks --cluster devpolaris-orders-prod --tasks arn:aws:ecs:us-east-1:123456789012:task/devpolaris-orders-prod/task-rev58-unhealthy arn:aws:ecs:us-east-1:123456789012:task/devpolaris-orders-prod/task-rev58-stopped
aws ecs describe-task-definition --task-definition devpolaris-orders-api:58
```

The service is in a mixed state: revision 58 is primary, revision 57 still has healthy capacity, and one revision 58 task stopped while retrieving `PAYMENTS_API_TOKEN`.
