## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### .github/workflows/reusable-ci.yml

```yaml
name: Reusable CI
on:
  workflow_call:
    inputs:
      node-version:
        type: string
        required: true
    outputs:
      artifact-name:
        value: ${{ jobs.checks.outputs.artifact-name }}
permissions:
  contents: read
jobs:
  checks:
    runs-on: ubuntu-24.04
    outputs:
      artifact-name: ${{ steps.meta.outputs.name }}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: ${{ inputs.node-version }}
          cache: npm
      - run: npm ci
      - run: npm run lint && npm test && npm run build
      - id: meta
        run: echo "name=orders-${GITHUB_RUN_ID}-${GITHUB_JOB}" >> "$GITHUB_OUTPUT"
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: ${{ steps.meta.outputs.name }}
          path: dist/
          if-no-files-found: error
```

### orders/.github/workflows/ci.yml

```yaml
name: Service CI
on: [pull_request]
permissions:
  contents: read
jobs:
  ci:
    uses: ./.github/workflows/reusable-ci.yml
    with:
      node-version: '22'
  inspect:
    needs: ci
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: ${{ needs.ci.outputs.artifact-name }}
      - run: test -s server.js
```

### billing/.github/workflows/ci.yml

```yaml
name: Service CI
on: [pull_request]
permissions:
  contents: read
jobs:
  ci:
    uses: ./.github/workflows/reusable-ci.yml
    with:
      node-version: '24'
  inspect:
    needs: ci
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: ${{ needs.ci.outputs.artifact-name }}
      - run: test -s server.js
```

## Why this works

Reusable workflows own jobs, runners and job-level policy. Inputs are an interface; outputs must travel from a step to a job and then through workflow_call to the caller. A local reference uses the caller's commit. Organization reuse requires an accessible automation repository and a reviewed immutable revision. A composite action would share steps inside an existing job, but would not replace this job boundary.

## Verification and expected evidence

Copy the shared workflow into each test repository at .github/workflows/reusable-ci.yml, then install its corresponding caller as ci.yml. After validating the interface, move the shared file into an organization automation repository and replace the local uses path with acme/automation/.github/workflows/reusable-ci.yml@<reviewed-commit-SHA>. Test a consumer upgrade before changing both.

## Self-review

- [ ] Both callers pass their supported runtime through typed inputs.
- [ ] The workflow publishes and exposes the artifact name.
- [ ] Consumers depend on the public workflow output rather than internal jobs.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
