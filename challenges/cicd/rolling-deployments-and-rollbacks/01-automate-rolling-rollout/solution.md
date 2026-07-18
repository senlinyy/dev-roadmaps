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

The workflow registers the tested digest, updates the production service, waits for healthy targets, and observes rollout signals. The production environment keeps the release protected, while each check reduces the chance of declaring success before replacement tasks are ready.
