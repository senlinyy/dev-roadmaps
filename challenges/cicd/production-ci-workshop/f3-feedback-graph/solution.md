## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### .github/workflows/ci.yml

```yaml
name: CI
on: [pull_request]
permissions:
  contents: read
jobs:
  checks:
    runs-on: ubuntu-24.04
    strategy:
      fail-fast: false
      matrix:
        command: ['npm run lint', 'npm test']
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: ${{ matrix.command }}
  package:
    needs: checks
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run build && tar -czf orders.tar.gz dist
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: orders-package
          path: orders.tar.gz
          if-no-files-found: error
  inspect:
    needs: package
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: orders-package
      - run: tar -tzf orders.tar.gz | grep -Fx 'dist/server.js'
```

## Why this works

Jobs express dependencies; steps express local sequence. A matrix expands independent checks while needs gates packaging on their aggregate result. Each consumer must materialize its inputs. A cache accelerates recomputation; a named artifact is the output another job deliberately consumes.

## Verification and expected evidence

Introduce a lint syntax failure and verify that package and inspect do not run. On a healthy run inspect must execute on a new runner, download orders-package and find dist/server.js.

## Self-review

- [ ] Lint and unit tests can run independently.
- [ ] Packaging requires both checks to succeed.
- [ ] The consumer downloads the named archive and verifies its contents.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/pass-job-outputs)
