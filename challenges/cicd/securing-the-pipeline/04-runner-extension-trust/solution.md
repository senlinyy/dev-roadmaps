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
    pool: "public"
    fresh: true
  release:
    needs:
      - "validate"
    steps:
      -
        access:
          environment: "production"
          policy: "runner-policy.yaml"
    pool: "release"
    fresh: true
```

### runner-policy.yaml

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

The selected worker determines network reach, while the access policy restricts which workload and extension may use release authority. Pinning controls change identity but is not a claim that the extension is inherently safe.
