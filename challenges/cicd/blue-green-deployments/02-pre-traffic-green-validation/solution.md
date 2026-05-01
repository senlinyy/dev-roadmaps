```yaml
env:
  TEST_URL: https://orders-api-test.polaris.example
  EXPECTED_TASK_DEFINITION: orders-api:42

jobs:
  validate-green:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/check-ready.sh "$TEST_URL/readyz"
      - run: ./scripts/check-version.sh "$TEST_URL" "$EXPECTED_TASK_DEFINITION"
      - run: ./scripts/smoke-checkout.sh "$TEST_URL"
```

The test listener proves green directly. A passing check against the public URL before the switch would only prove blue still works.

