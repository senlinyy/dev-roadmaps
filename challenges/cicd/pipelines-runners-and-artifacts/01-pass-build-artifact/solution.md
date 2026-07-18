```yaml
name: Preview Package
on:
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build
      - run: tar -czf checkout-api.tar.gz dist package.json package-lock.json
      - uses: actions/upload-artifact@v4
        with:
          name: checkout-api-package
          path: checkout-api.tar.gz

  deploy-preview:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: checkout-api-package
      - run: ./scripts/deploy-preview.sh checkout-api.tar.gz
```

Jobs receive separate workspaces, so dependency order alone cannot move the package. Uploading and downloading the named artifact makes the preview deploy consume the exact output built earlier in the same run.
