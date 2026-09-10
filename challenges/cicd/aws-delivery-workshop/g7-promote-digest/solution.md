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
      - run: bash scripts/deploy.sh
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: deployment-production
          path: deployment.json
          if-no-files-found: error
```

### scripts/deploy.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${CLUSTER:?}" "${SERVICE:?}" "${IMAGE:?}" "${REPOSITORY:?}" "${HEALTH_URL:?}"
[[ "$IMAGE" == "$REPOSITORY"@sha256:* ]]
[[ "${IMAGE##*@}" =~ ^sha256:[a-f0-9]{64}$ ]]
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" > "$work/service.json"
jq -e '.failures == [] and (.services | length == 1)' "$work/service.json" >/dev/null
current=$(jq -r '.services[0].taskDefinition' "$work/service.json")
aws ecs describe-task-definition --task-definition "$current" > "$work/current.json"
jq --arg image "$IMAGE" '.taskDefinition
  | del(.taskDefinitionArn,.revision,.status,.requiresAttributes,.compatibilities,.registeredAt,.registeredBy,.deregisteredAt)
  | if ([.containerDefinitions[] | select(.name == "orders")] | length) != 1 then error("Expected one orders container") else . end
  | (.containerDefinitions[] | select(.name == "orders") | .image) = $image' "$work/current.json" > "$work/task.json"
candidate=$(aws ecs register-task-definition --cli-input-json "file://$work/task.json" --query taskDefinition.taskDefinitionArn --output text)
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$candidate" >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" > "$work/after.json"
jq -e --arg td "$candidate" '.services[0] | .taskDefinition == $td and .runningCount == .desiredCount and .desiredCount > 0' "$work/after.json" >/dev/null
curl --fail --silent --show-error --max-time 20 "$HEALTH_URL/orders" | jq -e '.orders | type == "array"'
jq -n --arg image "$IMAGE" --arg previous "$current" --arg deployed "$candidate" '{image:$image,previousTaskDefinition:$previous,taskDefinition:$deployed}' > deployment.json
```

## Why this works

Approval authorizes a selected candidate; it should not authorize a fresh build. Within one workflow, needs binds promotion to the successful staging job and the build output. A service-stable waiter can also return after rollback, so the helper verifies the resulting task-definition ARN. Longer-term release selection across separate workflows needs retained, authenticated release evidence.

## Verification and expected evidence

Run a valid training release, download both deployment receipts and inspect both task definitions. Their image fields must equal the build output. Supply a staging failure and confirm production remains skipped. This baseline uses a shared accessible ECR repository; the cross-account exercise adds the registry boundary.

## Self-review

- [ ] Staging and production consume the same build-job image output.
- [ ] Production requires successful staging and environment approval.
- [ ] A failed staging smoke check blocks production; neither deployment rebuilds.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
