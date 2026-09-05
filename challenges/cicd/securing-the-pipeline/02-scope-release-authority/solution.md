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
        check:
          name: "unit"
  build:
    needs:
      - "validate"
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
        access:
          environment: "production"
          policy: "identity.yaml"
      -
        deploy:
          artifact: "app"
          environment: "production"
    pool: "release"
```

### identity.yaml

```yaml
origins:
  - "mainline"
repositories:
  - "checkout-service"
branches:
  - "main"
environments:
  - "production"
permissions:
  - "deploy:checkout"
secrets:
  - "secret://production-deploy"
trustedPool: true
extensions:
  - "publisher@a1b2c3"
```

Source validation does not receive production authority. The release policy checks workload identity and grants only the required permission and secret reference. Adversarial actions are modeled access requests, not executed attacks.
