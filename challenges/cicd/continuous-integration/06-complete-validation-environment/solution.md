### pipeline.yaml

```yaml
version: 2
jobs:
  validate:
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
          name: "postgres"
          image: "postgres-17"
          isolated: true
      -
        wait:
          service: "postgres"
          timeout: 30
      -
        check:
          name: "lint"
      -
        check:
          name: "types"
      -
        check:
          name: "unit"
      -
        check:
          name: "integration"
      -
        build:
          artifact: "app"
    finally:
      -
        cleanup:
          files: true
          processes: true
```

The recipe declares its runtime, recreates dependencies, observes isolated service readiness, and executes each validation layer. Finally cleans resources without changing the original failure result.
