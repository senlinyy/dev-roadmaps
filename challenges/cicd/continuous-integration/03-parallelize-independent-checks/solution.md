### pipeline.yaml

```yaml
version: 1
jobs:
  lint:
    steps:
      - checkout: true
      - run: npm ci
      - run: npm run lint
  test:
    steps:
      - checkout: true
      - run: npm ci
      - run: npm test
  build:
    needs: [lint, test]
    steps:
      - checkout: true
      - run: npm ci
      - run: npm run build
```

Lint and tests have no dependency on each other, so their prepared workers overlap. Packaging depends on both; removing either gate would allow an invalid change to build.

The modeled healthy timeline finishes in 132 seconds. Lint and test failures appear at 11 and 36 seconds respectively, with packaging skipped. Reordering the original single worker would not create this overlap.
