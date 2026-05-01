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

The workflow accepts the release record values, blocks overlapping production deploys, and keeps the runbook sequence visible for reviewers.

