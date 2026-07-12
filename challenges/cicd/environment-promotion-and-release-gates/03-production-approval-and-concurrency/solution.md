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
