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
      url: https://orders-api.polaris.example
    steps:
      - run: ./scripts/deploy-ecs.sh orders-api-prod "${{ inputs.image_digest }}"
      - run: ./scripts/smoke.sh https://orders-api.polaris.example
```

The environment gate pauses the job before production access is available. The deploy remains automated after approval, and concurrency keeps two production releases from interleaving.

