### pipeline.yaml

```yaml
version: 2
jobs:
  worker:
    needs: []
    steps:
      -
        cleanup:
          files: true
          processes: true
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
      -
        build:
          artifact: "app"
    fresh: false
    pool: "linux-only"
    finally:
      -
        cleanup:
          files: true
          processes: true
```

Preparation removes authored leftovers before they affect service startup or packaging. Finally handles both success and failure. The exercise models files and processes, not a real VM or container lifecycle.
