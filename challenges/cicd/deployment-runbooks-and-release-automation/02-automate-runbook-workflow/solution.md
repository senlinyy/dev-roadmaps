```yaml
name: Deploy Orders API

on:
  workflow_dispatch:
    inputs:
      release_id:
        required: true
        type: string
      image_digest:
        required: true
        type: string
      rollback_task_definition:
        required: true
        type: string

concurrency:
  group: production-orders-api
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    permissions:
      contents: read
      id-token: write
    steps:
      - run: ./scripts/precheck-release.sh
      - run: ./scripts/deploy-orders-api.sh
      - run: ./scripts/smoke-orders-api.sh
      - run: ./scripts/watch-canary.sh
```

Required inputs make the release and rollback targets explicit at dispatch time. Production environment protection, least-privilege OIDC permissions, and non-canceling concurrency keep the automated path reviewable and prevent two releases from changing traffic together.
