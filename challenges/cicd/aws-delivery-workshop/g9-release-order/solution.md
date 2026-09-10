## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### scripts/check-current-release.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
current=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)
if [[ "$GITHUB_SHA" != "$current" ]]; then
  printf '%s\n' "Stale candidate: $GITHUB_SHA; current main: $current" >&2
  exit 1
fi
```

### .github/workflows/release.yml

```yaml
name: Release
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  build:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      id-token: write
    environment: build
    outputs:
      image: ${{ steps.publish.outputs.image }}
    env:
      REPOSITORY: ${{ vars.ECR_REPOSITORY }}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: aws-actions/configure-aws-credentials@cabfdba3510de1431bac9dba27511d97497fc100
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: eu-west-1
      - id: publish
        shell: bash
        run: |
          set -euo pipefail
          registry="${REPOSITORY%%/*}"
          aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin "$registry"
          tag="$REPOSITORY:$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
          docker build -t "$tag" .
          IMAGE="$tag" bash scripts/smoke.sh
          docker push "$tag"
          digest=$(aws ecr describe-images --repository-name "${REPOSITORY#*/}" --image-ids "imageTag=$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" --query 'imageDetails[0].imageDigest' --output text)
          [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]
          image="$REPOSITORY@$digest"
          echo "image=$image" >> "$GITHUB_OUTPUT"
          jq -n --arg image "$image" --arg source "$GITHUB_SHA" --arg run "$GITHUB_RUN_ID" '{image:$image,source:$source,run:$run}' > release.json
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: release
          path: release.json
          if-no-files-found: error
  staging:
    needs: [build]
    runs-on: ubuntu-24.04
    environment: staging
    permissions:
      contents: read
      id-token: write
    concurrency:
      group: orders-staging
      cancel-in-progress: false
    env:
      IMAGE: ${{ needs.build.outputs.image }}
      REPOSITORY: ${{ vars.ECR_REPOSITORY }}
      CLUSTER: ${{ vars.ECS_CLUSTER }}
      SERVICE: ${{ vars.ECS_SERVICE }}
      HEALTH_URL: ${{ vars.HEALTH_URL }}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: aws-actions/configure-aws-credentials@cabfdba3510de1431bac9dba27511d97497fc100
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: eu-west-1
      - run: bash scripts/deploy.sh
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: deployment-staging
          path: deployment.json
          if-no-files-found: error
  production:
    needs: [build, staging]
    runs-on: ubuntu-24.04
    environment: production
    permissions:
      contents: read
      id-token: write
    concurrency:
      group: orders-production
      cancel-in-progress: false
    env:
      IMAGE: ${{ needs.build.outputs.image }}
      REPOSITORY: ${{ vars.ECR_REPOSITORY }}
      CLUSTER: ${{ vars.ECS_CLUSTER }}
      SERVICE: ${{ vars.ECS_SERVICE }}
      HEALTH_URL: ${{ vars.HEALTH_URL }}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: aws-actions/configure-aws-credentials@cabfdba3510de1431bac9dba27511d97497fc100
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: eu-west-1
      - run: bash scripts/check-current-release.sh
        env:
          GH_TOKEN: ${{ github.token }}
      - run: bash scripts/deploy.sh
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: deployment-production
          path: deployment.json
          if-no-files-found: error
```

## Why this works

Concurrency prevents overlap within its scope; it does not establish business ordering of releases or coordinate other deployment systems. A freshness check makes the stated current-main policy explicit. Non-cancelling deployment jobs avoid interrupting a live mutation. Rollback deliberately selects an older known-good release and therefore needs a separate protected path, not disabling freshness for everyone.

## Verification and expected evidence

Approve the newer run then the older run in a training repository. The latter must fail before UpdateService. Re-check after any approval wait. The ref may advance after preflight; this enforces current-at-start policy, not a global transaction. If other systems deploy, introduce a shared external deployment coordinator.

## Self-review

- [ ] Production concurrency is repository/service specific and cancel-in-progress is false.
- [ ] An older source commit is rejected before service mutation.
- [ ] The solution does not claim GitHub queues are FIFO or that a main-ref check is an atomic cloud lock.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
