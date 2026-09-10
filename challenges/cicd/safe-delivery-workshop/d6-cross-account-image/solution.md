## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### scripts/promote-image.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${SOURCE_PROFILE:?}" "${DESTINATION_PROFILE:?}" "${DIGEST:?}"
[[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]
source_repo=111111111111.dkr.ecr.eu-west-1.amazonaws.com/orders
destination=222222222222.dkr.ecr.eu-west-1.amazonaws.com/orders
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
aws --profile "$SOURCE_PROFILE" ecr get-login-password --region eu-west-1 | skopeo login --authfile "$work/auth.json" --username AWS --password-stdin "${source_repo%%/*}"
aws --profile "$DESTINATION_PROFILE" ecr get-login-password --region eu-west-1 | skopeo login --authfile "$work/auth.json" --username AWS --password-stdin "${destination%%/*}"
tag="release-${DIGEST#sha256:}"
skopeo copy --all --preserve-digests --authfile "$work/auth.json" "docker://$source_repo@$DIGEST" "docker://$destination:$tag"
skopeo inspect --raw --authfile "$work/auth.json" "docker://$destination:$tag" > "$work/manifest.json"
actual=$(skopeo manifest-digest "$work/manifest.json")
[[ "$actual" == "$DIGEST" ]]
printf '%s\n' "$destination@$actual"
```

### iam/source-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "arn:aws:ecr:eu-west-1:111111111111:repository/orders"
    }
  ]
}
```

### iam/destination-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage"
      ],
      "Resource": "arn:aws:ecr:eu-west-1:222222222222:repository/orders"
    }
  ]
}
```

## Why this works

A registry transfer need not change content. skopeo --all copies the manifest list and platform images; --preserve-digests rejects conversions that alter identity. Separate role profiles scope the two sides. Image copying does not automatically establish runtime pull permission or transfer every signature/referrer. Those are explicit promotion preconditions.

## Verification and expected evidence

Supply approved profiles and a real multi-platform digest. Compare raw manifest digests and deploy the destination@digest output. Confirm unrelated repositories are denied. If an immutable destination tag already exists, inspect and verify it rather than overwrite it. Verify provenance subject-name policy separately when the registry name changes.

## Self-review

- [ ] Copy selects a source digest and preserves all platform manifests.
- [ ] Destination digest matches the approved digest before deployment.
- [ ] Source reads and destination writes are repository-scoped.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://github.com/containers/skopeo/blob/main/docs/skopeo-copy.1.md)
- [Official reference 2](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.html)
