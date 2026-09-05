### pipeline.yaml

```yaml
version: 2
jobs:
  tests:
    needs: []
    steps:
      -
        checkout:
          ref: "candidate"
      -
        setup:
          runtime: "24"
      -
        install:
          mode: "locked"
      -
        service:
          name: "app"
          image: "checkout-test"
          isolated: true
      -
        wait:
          service: "app"
          timeout: 10
      -
        check:
          name: "unit"
    finally:
      -
        report:
          check: "unit"
          path: "test-results.json"
      -
        cleanup:
          files: true
          processes: true
  package:
    needs:
      - "tests"
    steps:
      -
        checkout:
          ref: "candidate"
      -
        setup:
          runtime: "24"
      -
        install:
          mode: "locked"
      -
        build:
          artifact: "app"
```

Finally preserves the test report before deleting generated files and stopping the modeled process. It does not turn a failed test into success, so packaging remains skipped.
