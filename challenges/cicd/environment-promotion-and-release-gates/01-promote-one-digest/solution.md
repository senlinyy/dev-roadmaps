```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      image_digest: ${{ steps.digest.outputs.image_digest }}

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - run: ./scripts/deploy-ecs.sh orders-api-staging "${{ needs.build.outputs.image_digest }}"
      - run: ./scripts/smoke.sh https://orders-api-staging.devpolaris.example

  deploy-production:
    needs: [build, deploy-staging]
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: ./scripts/deploy-ecs.sh orders-api-prod "${{ needs.build.outputs.image_digest }}"
```
