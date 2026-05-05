```bash
aws application-autoscaling describe-scalable-targets --service-namespace ecs --resource-ids service/devpolaris-orders-prod/devpolaris-orders-api
aws sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/devpolaris-orders-export-jobs --attribute-names All
```

Scaling evidence starts with the bounds, then the backlog. More capacity may help, but only after you confirm the queue is actually building up.
