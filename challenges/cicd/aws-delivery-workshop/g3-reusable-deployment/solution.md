## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### .github/workflows/deploy.yml

```yaml
name: Deploy approved image
on:
  workflow_call:
    inputs:
      environment:
        type: string
        required: true
      image:
        type: string
        required: true
    outputs:
      image:
        value: ${{ jobs.deploy.outputs.image }}
permissions:
  contents: read
  id-token: write
jobs:
  deploy:
    if: inputs.environment == 'staging' || inputs.environment == 'production'
    environment: ${{ inputs.environment }}
    runs-on: ubuntu-24.04
    concurrency:
      group: deploy-${{ inputs.environment }}
      cancel-in-progress: false
    outputs:
      image: ${{ steps.result.outputs.image }}
    env:
      IMAGE: ${{ inputs.image }}
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
      - id: result
        run: echo "image=$IMAGE" >> "$GITHUB_OUTPUT"
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: deployment-${{ inputs.environment }}
          path: deployment.json
          if-no-files-found: error
```

### .github/workflows/release.yml

```yaml
name: Release
on:
  workflow_dispatch:
    inputs:
      image:
        description: Reviewed staging image digest
        required: true
        type: string
permissions:
  contents: read
  id-token: write
jobs:
  staging:
    uses: ./.github/workflows/deploy.yml
    with:
      environment: staging
      image: ${{ inputs.image }}
  production:
    needs: staging
    uses: ./.github/workflows/deploy.yml
    with:
      environment: production
      image: ${{ needs.staging.outputs.image }}
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

The called deployment job owns its environment. GitHub environment protection controls when it receives authority. AWS_ROLE_ARN and target variables come from that environment, making target and authority one reviewed setting. workflow_call does not pass caller environment secrets automatically. The helper must be real code, reject unexpected image repositories, and check that ECS stabilized on its candidate rather than a rollback revision.

## Verification and expected evidence

In the training account run the caller with a valid ECR digest, then with a tag and wrong repository. Production must wait for environment review. Check the task-definition image and deployment receipt. This task validates the reuse boundary; candidate provenance is added in the attestation task.

## Self-review

- [ ] Only staging or production is accepted, each using its environment configuration.
- [ ] The helper rejects another repository or a mutable image reference.
- [ ] The called workflow publishes the deployed image and deployment receipt.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
- [Official reference 2](https://github.com/aws-actions/amazon-ecs-deploy-task-definition)
