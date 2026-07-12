```yaml
env:
  TEST_URL: https://orders-api-test.devpolaris.example
  EXPECTED_TASK_DEFINITION: orders-api:42

jobs:
  validate-green:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/check-ready.sh "$TEST_URL/readyz"
      - run: ./scripts/check-version.sh "$TEST_URL" "$EXPECTED_TASK_DEFINITION"
      - run: ./scripts/smoke-checkout.sh "$TEST_URL"
```
