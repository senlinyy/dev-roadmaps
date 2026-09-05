### pipeline.yaml

```yaml
version: 2
jobs:
  build:
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
        check:
          name: "lint"
      -
        check:
          name: "unit"
      -
        build:
          artifact: "app"
      -
        upload:
          artifact: "app"
  release:
    needs:
      - "build"
    steps:
      -
        download:
          artifact: "app"
      -
        deploy:
          artifact: "app"
          environment: "production"
      -
        observe:
          artifact: "app"
          policy: "health-policy.yaml"
```

### health-policy.yaml

```yaml
minSeconds: 300
minRequests: 1000
maxErrorRate: 1
maxLatency: 250
minPurchaseRate: 95
```

Observation evaluates the current deployed package against all required thresholds. This produces a progression decision, not a simulated claim that the entire fleet has already rolled out.
