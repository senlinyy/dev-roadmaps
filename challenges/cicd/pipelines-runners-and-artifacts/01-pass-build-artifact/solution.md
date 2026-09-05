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
  smoke:
    needs: build
    steps:
      - download: {name: checkout-app, path: package/app.json}
      - verify: package/app.json
```

The producer validates source, builds once, and uploads an immutable package. The dependency makes the consumer wait; the download—not that dependency—populates its workspace at package/app.json.

The consumer needs no source checkout or dependency installation because it only verifies the received package. Compare the upload, download, and verification digests. Test failure blocks build, while build failure blocks upload and skips the consumer.
