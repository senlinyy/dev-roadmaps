```yaml
  deploy-staging:
    needs: test
    runs-on: ubuntu-latest
    environment: staging
    steps: [...]

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production
    steps: [...]
```

The `environment` key tells GitHub to only inject secrets scoped to that specific environment. The `test` job does not have an `environment` key, so it cannot access any environment-scoped secrets, even if it tries. This isolation prevents a test job from accidentally using production credentials.
