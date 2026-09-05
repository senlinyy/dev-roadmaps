### pipeline.yaml

```yaml
version: 1
jobs:
  build:
    steps:
      - checkout: true
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - upload: {name: checkout-app, path: dist/app.json}
  staging:
    needs: build
    steps:
      - download: {name: checkout-app, path: package/app.json}
      - deploy: {environment: staging, path: package/app.json}
      - verify: package/app.json
  production:
    needs: staging
    steps:
      - download: {name: checkout-app, path: package/app.json}
      - deploy: {environment: production, path: package/app.json}
```

The candidate is created once, after source validation. Staging and production download that same artifact instead of rebuilding from a matching source checkout. Staging verifies the package after deployment; production waits for the whole staging job.

Compare build count and deployment digests in the healthy case. In the staging-failure case, staging deploys but verification fails and production is skipped. Merely ordering the original jobs would still deploy separately built bytes.
