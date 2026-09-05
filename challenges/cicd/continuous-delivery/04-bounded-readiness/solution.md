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
  production:
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
          policy: "rollout.yaml"
```

### rollout.yaml

```yaml
readiness: true
deadline: 30
batch: 1
surge: true
minHealthy: 3
```

The rollout observes readiness before retiring each old instance. An unsuccessful first batch leaves the old fleet intact; it does not merely paint a completed replacement red.
