## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### scripts/test-ci.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p reports
node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=reports/junit.xml test/unit.test.mjs 2>&1 | tee reports/test.log
```

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
      - run: bash scripts/test-ci.sh
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        if: always()
        with:
          name: test-reports
          path: reports/
          if-no-files-found: error
      - run: npm run build
```

## Why this works

A shell pipeline normally reports the last command's exit status; pipefail preserves failure from the test process when tee succeeds. Diagnostic publication should run after failure, but the product build should retain its normal success condition. always() belongs on evidence collection, not on release jobs.

## Verification and expected evidence

Temporarily make one real assertion fail. Run `bash scripts/test-ci.sh`; check its nonzero exit and both report files. In GitHub, confirm report upload runs but compilation is skipped.

## Self-review

- [ ] A failing test yields a nonzero wrapper exit and failed CI job.
- [ ] The failure run retains its JUnit report and console log.
- [ ] Compilation does not run after failed tests.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html)
- [Official reference 2](https://nodejs.org/api/test.html)
