## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

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
```

## Why this works

A unique tag helps humans locate a release, but the digest names content. Build once locally, run smoke checks against that local image, push it, then use the registry digest for every deployment. release.json is an ordinary generated audit record, not a simulator instruction. It needs a consumer and trusted storage before it can authorize a separate release run.

## Verification and expected evidence

Give the build role ECR authorization-token access plus repository-scoped layer upload, PutImage and DescribeImages permissions. In the training run count docker build calls, inspect release.json and compare ECR digest to the workflow output. Release tags include run attempt to avoid collisions with immutable-tag repositories.

## Self-review

- [ ] Only one docker build creates the candidate.
- [ ] The local smoke test runs before that candidate is pushed.
- [ ] The output and release.json contain repository@sha256 plus source/run identity.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)
