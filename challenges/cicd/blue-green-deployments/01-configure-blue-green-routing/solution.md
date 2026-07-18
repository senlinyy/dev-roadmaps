```yaml
version: 1
Resources:
  - TargetService:
      Type: AWS::ECS::Service
      Properties:
        TaskDefinition: arn:aws:ecs:us-east-1:123456789012:task-definition/orders-api:42
        LoadBalancerInfo:
          ContainerName: orders-api
          ContainerPort: 8080
```

The AppSpec points CodeDeploy at the replacement task definition and the exact container endpoint registered with the load balancer. Keeping those values aligned prevents green from starting successfully while receiving no test or production traffic.
