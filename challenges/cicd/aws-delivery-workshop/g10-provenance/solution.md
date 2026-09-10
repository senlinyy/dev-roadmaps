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
      attestations: write
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
          echo "digest=$digest" >> "$GITHUB_OUTPUT"
          jq -n --arg image "$image" --arg source "$GITHUB_SHA" --arg run "$GITHUB_RUN_ID" '{image:$image,source:$source,run:$run}' > release.json
      - uses: actions/attest-build-provenance@43d14bc2b83dec42d39ecae14e916627a18bb661
        with:
          subject-name: ${{ env.REPOSITORY }}
          subject-digest: ${{ steps.publish.outputs.digest }}
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: release
          path: release.json
          if-no-files-found: error
```

### scripts/verify-producer.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${IMAGE:?}" "${EXPECTED_REPO:?}" "${GH_TOKEN:?}" "${EXPECTED_SOURCE:?Approved source commit}"
[[ "$IMAGE" =~ @sha256:[a-f0-9]{64}$ ]]
gh attestation verify "oci://$IMAGE" --repo "$EXPECTED_REPO" --signer-workflow "$EXPECTED_REPO/.github/workflows/release.yml" --source-ref refs/heads/main --source-digest "$EXPECTED_SOURCE" --deny-self-hosted-runners --format json > provenance-verification.json
```

## Why this works

Digest verification answers which artifact; provenance verification answers which workflow and source produced it. Generate attestations inside the trusted build job with only the required attestation and OIDC permissions. A verifier should constrain the signer workflow as well as the repository. Keep SBOM and vulnerability policy as separate evidence: neither replaces producer identity.

## Verification and expected evidence

Authenticate the verifier to ECR for pulling the image, set GH_TOKEN for reading the expected repository's attestations, and invoke verify-producer.sh before deploy.sh. Test a legitimate published digest, an unattested digest and an attestation from another workflow. Retain verification output with the deployment record. GitHub CLI version and repository feature availability are prerequisites. Set EXPECTED_SOURCE from the approved release's source commit so another otherwise trusted build cannot satisfy this candidate's verification.

## Self-review

- [ ] Attestation generation binds the published digest to the trusted release workflow.
- [ ] Verification checks the expected repository and signer workflow and fails closed.
- [ ] An unrelated digest or untrusted producer is rejected before deployment.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-artifact-attestations-with-the-github-cli)
