```yaml
concurrency:
  group: production-orders-api
  cancel-in-progress: false

jobs:
  deploy-production:
    needs: [build, deploy-staging]
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://orders-api.devpolaris.example
    steps:
      - run: ./scripts/deploy-ecs.sh orders-api-prod "${{ inputs.image_digest }}"
      - run: ./scripts/smoke.sh https://orders-api.devpolaris.example
```

The protected production environment provides the human release gate, while a stable concurrency group serializes production changes. Setting cancellation to false lets an active deployment finish safely instead of interrupting it halfway through a traffic change.
