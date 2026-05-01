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

The AppSpec should describe the replacement task set, not the current blue task set. The container name and port tell CodeDeploy where the load balancer should send traffic after green is created.

