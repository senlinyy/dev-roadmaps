## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### .github/workflows/ci.yml

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  checks:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

### package.json

```json
{
  "name": "orders-api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "lint": "tsc --noEmit",
    "test": "node --test test/unit.test.mjs",
    "integration": "node --test test/integration.test.mjs",
    "start": "node dist/server.js"
  },
  "devDependencies": {
    "typescript": "5.9.3"
  }
}
```

## Why this works

A job starts with the runner image, not the developer's shell profile. setup-node selects the runtime; npm ci checks manifest/lockfile agreement and installs the locked dependency graph. npm scripts resolve project-local executables, so build should invoke tsc through npm rather than an absolute global path. Cache downloads to reduce network work, but keep installation mandatory on every independent runner.

## Verification and expected evidence

In a disposable checkout with Node 22, run `npm ci && npm run lint && npm test && npm run build`. Change only the manifest compiler version, rerun `npm ci`, and confirm a nonzero exit; restore the manifest afterward.

## Self-review

- [ ] A clean checkout installs from the existing lockfile and runs lint, tests and compilation.
- [ ] No developer files, global compiler or restored node_modules are required.
- [ ] Changing a manifest dependency without updating the lockfile fails installation.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.npmjs.com/cli/v11/commands/npm-ci)
