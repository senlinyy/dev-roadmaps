```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test

  deploy-staging:
    needs: test
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh staging

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - run: ./deploy.sh production
```

The `environment` key tells GitHub to only inject secrets scoped to that specific environment. The `test` job does not have an `environment` key, so it cannot access any environment-scoped secrets, even if it tries. This isolation prevents a test job from accidentally using production credentials.
