## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### .github/workflows/integration.yml

```yaml
name: Integration
on: [pull_request]
permissions:
  contents: read
jobs:
  integration:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: orders
          POSTGRES_PASSWORD: test-only
          POSTGRES_DB: orders
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      DATABASE_URL: postgres://orders:test-only@localhost:5432/orders
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: sudo apt-get update && sudo apt-get install -y postgresql-client
      - run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001-orders.sql
      - run: npm run integration
```

## Why this works

A PostgreSQL service container belongs to one job. A job running on the host reaches its published port through localhost; a containerized job instead uses the service hostname. Readiness is separate from process creation. ON_ERROR_STOP turns SQL errors into failed steps, and transaction rollback in a test keeps test data isolated within that database.

## Verification and expected evidence

Run two pull requests concurrently. Both integration jobs must pass without staging credentials. Introduce invalid SQL in a disposable branch; migration must fail before tests. GitHub cleans up its service containers when jobs finish.

## Self-review

- [ ] Each job uses a fresh PostgreSQL instance with explicit readiness.
- [ ] Migrations and test assertions run against that job's database.
- [ ] A bad migration fails CI without touching staging.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)
