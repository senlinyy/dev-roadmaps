### pipeline.yaml

```yaml
version: 1
jobs:
  ci:
    steps:
      - checkout: true
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

### package-lock.json

```json
{
  "name": "checkout-service",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "devDependencies": {
        "eslint": "9.0.0",
        "vitest": "^3.0.0",
        "vite": "6.0.0"
      }
    },
    "node_modules/eslint": {
      "version": "9.0.0"
    },
    "node_modules/vitest": {
      "version": "3.0.0"
    },
    "node_modules/vite": {
      "version": "6.0.0"
    }
  }
}
```

The manifest permits a range; the archived lock records vitest 3.0.0 as the approved resolution. Restoring that lock and enforcing it makes both registry cases use the same direct versions. This exercise restores a supplied lock rather than asking you to construct a real npm dependency graph by hand.

The workflow also runs lint and tests before packaging. Inspect the resolved-version evidence in both registries, then confirm that the independent test failure blocks build. A copied lock with an unchanged build-only recipe would leave both policy enforcement and validation incomplete.
