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

The canary earns promotion by surviving the watch window. Concurrency keeps release signals readable by preventing overlapping production canaries.

