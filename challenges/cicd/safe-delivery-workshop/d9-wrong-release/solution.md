## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### scripts/recover-release.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${EXPECTED_CURRENT:?Full incident task ARN}" "${KNOWN_GOOD:?Verified task ARN}" "${KNOWN_GOOD_IMAGE:?Verified full image digest}"
current=$(aws ecs describe-services --cluster orders --services orders --query 'services[0].taskDefinition' --output text)
[[ "$current" == "$EXPECTED_CURRENT" ]]
image=$(aws ecs describe-task-definition --task-definition "$KNOWN_GOOD" --query "taskDefinition.containerDefinitions[?name=='orders'].image | [0]" --output text)
[[ "$image" == "$KNOWN_GOOD_IMAGE" ]]
IMAGE="$image" bash scripts/validate-image.sh
aws ecs update-service --cluster orders --service orders --task-definition "$KNOWN_GOOD" > recovery-start.json
aws ecs wait services-stable --cluster orders --services orders
actual=$(aws ecs describe-services --cluster orders --services orders --query 'services[0].taskDefinition' --output text)
[[ "$actual" == "$KNOWN_GOOD" ]]
```

### scripts/validate-image.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${IMAGE:?}" "${REPOSITORY:?}"
[[ "$IMAGE" == "$REPOSITORY"@sha256:* ]]
[[ "${IMAGE##*@}" =~ ^sha256:[a-f0-9]{64}$ ]]
```

## Why this works

Green checks referred to one artifact while production received another. Recovery selects an already verified task definition and checks current state before mutation. The state check requires shared deployment serialization to avoid a concurrent writer. Data compatibility remains an independent prerequisite: a traffic rollback cannot reverse incompatible schema or external side effects.

## Verification and expected evidence

Preserve CloudTrail and release receipts; confirm database compatibility with the migration owner. Acquire the same deployment serialization used by normal releases, set full ARNs/digest and run recovery. Check readiness, real order behavior and task images afterward. Integrate validate-image.sh before future service mutations and promote the build output without rebuilding.

## Self-review

- [ ] Evidence identifies the rebuild after staging approval.
- [ ] Recovery rejects unexpected current state and selects verified known-good bytes.
- [ ] Future deployment rejects tags and does not rebuild during recovery.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-failure-detection.html)
