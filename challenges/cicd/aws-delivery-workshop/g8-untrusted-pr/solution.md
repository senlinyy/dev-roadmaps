## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### .github/workflows/pr.yml

```yaml
name: PR
on: [pull_request]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
      - name: Print title as data
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
        run: printf '%s\n' "$PR_TITLE"
      - run: npm ci && npm test
```

## Why this works

A contributor can change package scripts, source and workflow input fields. Read-only tokens and disposable hosted runners bound the authority of ordinary PR validation. Quoting an interpolated GitHub expression does not make it safe shell data; pass text through an environment variable. Trusted release jobs need a separate reviewed source and event boundary.

## Verification and expected evidence

Use a fork PR with the supplied title and a malicious package script. The title must print literally. Review the job token permissions and ensure no release credentials exist. Do not test credential theft against a real privileged repository.

## Self-review

- [ ] PR validation uses pull_request and read-only repository permission.
- [ ] Contributor text is passed as data, not interpolated into a shell program.
- [ ] No OIDC request, deployment role or secret is available in the PR job.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
