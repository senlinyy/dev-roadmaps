### pipeline.yaml

```yaml
version: 1
jobs:
  validate:
    steps:
      - checkout: true
      - run: npm ci
      - run: npm run lint
      - run: npm test
  build:
    needs: validate
    steps:
      - checkout: true
      - run: npm ci
      - run: npm run build
```

Validation produces the evidence that packaging previously lacked. The build job depends on validation and prepares its own clean workspace; it cannot reuse the validation worker's installation.

Inspect both failing cases: the relevant check fails in validation and the build job is skipped. The healthy case alone would not establish that protection.
