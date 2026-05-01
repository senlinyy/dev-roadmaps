```yaml
jobs:
  rollout:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://orders-api.devpolaris.example
    steps:
      - run: ./scripts/register-task-definition.sh "${{ inputs.image_digest }}"
      - run: ./scripts/update-ecs-service.sh orders-api-prod
      - run: ./scripts/wait-target-health.sh orders-api-prod
      - run: ./scripts/watch-rollout.sh orders-api-prod --minutes 15
```

The workflow should show the operational sequence clearly. The service update is not proof of success, so the rollout must wait for target health and then watch release signals.

