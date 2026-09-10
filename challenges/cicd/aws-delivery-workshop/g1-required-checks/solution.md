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
  required:
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

### repository-settings.json

```json
{"required_status_checks":[{"context":"required","app_id":15368}],"required_pull_request_reviews":{"required_approving_review_count":1}}
```

## Why this works

A required status check must exist for every change governed by the rule. Workflow-level path filtering can prevent the run itself from existing. For a fast application, unconditional checks reduce complexity. If selective execution becomes necessary, put selection inside a workflow that always reports one stable required check and explicitly aggregate failed or cancelled prerequisites.

## Verification and expected evidence

Use repository branch protection/ruleset UI to require the actual GitHub Actions required check; repository-settings.json is a review record, not an automatically loaded GitHub file. Submit docs-only, code-only and mixed disposable PRs. If merge queue is enabled, also add merge_group and test the queue event.

## Self-review

- [ ] Docs-only, code-only and mixed pull requests all report required.
- [ ] A failing application test fails required.
- [ ] Untrusted pull requests receive only read access.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/troubleshooting-required-status-checks)
