```yaml
concurrency:
  group: orders-api-canary
  cancel-in-progress: false

jobs:
  canary:
    runs-on: ubuntu-latest
    environment:
      name: production
    steps:
      - run: ./scripts/create-codedeploy-canary.sh "${{ inputs.image_digest }}"
      - run: ./scripts/watch-canary.sh "$DEPLOYMENT_ID" --minutes 5
      - run: ./scripts/check-codedeploy-success.sh "$DEPLOYMENT_ID"
```

Production environment protection provides the approval boundary, while concurrency prevents overlapping canaries from corrupting the comparison window. The workflow creates the canary, observes its signals, and confirms the deployment result before treating it as successful.
