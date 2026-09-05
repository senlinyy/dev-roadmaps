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
        scan:
          kind: "source"
          policy: "security.yaml"
      -
        scan:
          kind: "dependencies"
          policy: "security.yaml"
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
  security:
    needs:
      - "build"
    steps:
      -
        download:
          artifact: "app"
      -
        scan:
          kind: "image"
          artifact: "app"
          policy: "security.yaml"
  staging:
    needs:
      - "security"
    steps:
      -
        download:
          artifact: "app"
      -
        deploy:
          artifact: "app"
          environment: "staging"
          policy: "release.yaml"
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
          policy: "release.yaml"
```

### security.yaml

```yaml
block:
  - "high"
  - "critical"
```

### release.yaml

```yaml
security: true
```

Source, dependency, and image reports answer different questions. Their placement follows input availability. Failed or absent evidence stops downstream work, while successful security cannot override failed staging health.
