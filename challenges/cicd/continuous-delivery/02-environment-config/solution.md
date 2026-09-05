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
  staging:
    needs:
      - "build"
    steps:
      -
        download:
          artifact: "app"
      -
        deploy:
          artifact: "app"
          environment: "staging"
          config: "staging.yaml"
      -
        verify:
          artifact: "app"
          environment: "staging"
  production:
    needs:
      - "staging"
    steps:
      -
        download:
          artifact: "app"
      -
        deploy:
          artifact: "app"
          environment: "production"
          config: "production.yaml"
```

### staging.yaml

```yaml
database: "staging-db"
secret: "secret://staging-db"
newCheckout: true
```

### production.yaml

```yaml
database: "production-db"
secret: "secret://production-db"
newCheckout: false
```

One package is promoted with independent runtime configuration. Feature exposure changes without rebuilding, and secret references remain environment-scoped. Staging verification remains a control dependency for production.
