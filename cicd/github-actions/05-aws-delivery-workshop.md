---
id: article-cicd-aws-delivery-workshop
title: "GitHub Actions to AWS"
description: "Worked production delivery patterns, complete reference files and explicit operational verification."
order: 5
tags: ["cicd", "github-actions", "production-workflows"]
---

## Table of Contents

1. [Make required checks reliable for every pull request](#make-required-checks-reliable-for-every-pull-request)
2. [Replace copied CI with a versioned workflow interface](#replace-copied-ci-with-a-versioned-workflow-interface)
3. [Give reusable deployment a protected environment boundary](#give-reusable-deployment-a-protected-environment-boundary)
4. [Replace shared AWS access keys with scoped OIDC](#replace-shared-aws-access-keys-with-scoped-oidc)
5. [Repair ECS authorization without AdministratorAccess](#repair-ecs-authorization-without-administratoraccess)
6. [Publish one tested image and capture its immutable identity](#publish-one-tested-image-and-capture-its-immutable-identity)
7. [Promote staging-tested bytes without rebuilding](#promote-staging-tested-bytes-without-rebuilding)
8. [Remove privileged execution from contributor-controlled code](#remove-privileged-execution-from-contributor-controlled-code)
9. [Reject a stale release after approval](#reject-a-stale-release-after-approval)
10. [Verify the release producer before deployment](#verify-the-release-producer-before-deployment)
11. [Check Your Answers](#check-your-answers)
12. [References](#references)

This chapter extends the event, runner, reusability and security lessons into a concrete AWS delivery path. Start with the repository boundary, then establish workload identity and authorization, publish one image, and deploy that same digest through staging and production. Existing theory remains applicable: these examples supply the missing complete interfaces and operational checks. The reference stack uses ECR, ECS Fargate and an ALB rather than an invented pipeline language.

This chapter answers four connected questions:

- Where should reusable workflow authority live?
- How do AWS identity and authorization differ?
- What binds staging evidence to production?
- Why are digest, provenance and ordering separate checks?

### Before running the examples

The linked editor workspaces contain full independent starting snapshots and reference solutions. Local editing and self-review create no infrastructure. Use disposable repositories and isolated training accounts for optional live verification; configure credentials outside source control, budget for cloud resources, and remove only resources you created after collecting evidence. Do not run recovery scripts against an existing production system.

Use an isolated AWS training account and existing ECR repository, ECS Fargate orders service, ALB and IAM runtime roles. Example account IDs and acme/orders are explicit sample identifiers: substitute your own consistently. AWS CLI v2, jq, curl and Docker are required on the selected runner. The build environment defines ECR_REPOSITORY and AWS_ROLE_ARN; staging/production additionally define ECS_CLUSTER, ECS_SERVICE and HEALTH_URL. Protect production with required reviewers, prevent self-review and restrict deployment branches to main; configure these in GitHub Settings, not imaginary workflow YAML. Only the dedicated deployment roles may update the service. Live runs cost money; do not use production accounts. No live AWS changes run in this editor.

Action references are immutable reviewed commits in the challenge fixtures. Container and tool versions remain explicit operating assumptions: resolve approved digests and test compatibility before deployment rather than copying mutable tags into a production policy.

## Make required checks reliable for every pull request

A required status check must exist for every change governed by the rule. Workflow-level path filtering can prevent the run itself from existing. For a fast application, unconditional checks reduce complexity. If selective execution becomes necessary, put selection inside a workflow that always reports one stable required check and explicitly aggregate failed or cancelled prerequisites.

The operational question is whether the repaired system can demonstrate all of the following:

- Docs-only, code-only and mixed pull requests all report required.
- A failing application test fails required.
- Untrusted pull requests receive only read access.

Here is the central implementation file, `.github/workflows/ci.yml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

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

Use repository branch protection/ruleset UI to require the actual GitHub Actions required check; repository-settings.json is a review record, not an automatically loaded GitHub file. Submit docs-only, code-only and mixed disposable PRs. If merge queue is enabled, also add merge_group and test the queue event.

[Open the make required checks reliable for every pull request challenge](/challenges/cicd/aws-delivery-workshop?step=g1-required-checks).

## Replace copied CI with a versioned workflow interface

Reusable workflows own jobs, runners and job-level policy. Inputs are an interface; outputs must travel from a step to a job and then through workflow_call to the caller. A local reference uses the caller's commit. Organization reuse requires an accessible automation repository and a reviewed immutable revision. A composite action would share steps inside an existing job, but would not replace this job boundary.

The operational question is whether the repaired system can demonstrate all of the following:

- Both callers pass their supported runtime through typed inputs.
- The workflow publishes and exposes the artifact name.
- Consumers depend on the public workflow output rather than internal jobs.

Here is the central implementation file, `.github/workflows/reusable-ci.yml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

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

Copy the shared workflow into each test repository at .github/workflows/reusable-ci.yml, then install its corresponding caller as ci.yml. After validating the interface, move the shared file into an organization automation repository and replace the local uses path with acme/automation/.github/workflows/reusable-ci.yml@<reviewed-commit-SHA>. Test a consumer upgrade before changing both.

[Open the replace copied ci with a versioned workflow interface challenge](/challenges/cicd/aws-delivery-workshop?step=g2-reusable-ci).

## Give reusable deployment a protected environment boundary

The called deployment job owns its environment. GitHub environment protection controls when it receives authority. AWS_ROLE_ARN and target variables come from that environment, making target and authority one reviewed setting. workflow_call does not pass caller environment secrets automatically. The helper must be real code, reject unexpected image repositories, and check that ECS stabilized on its candidate rather than a rollback revision.

The operational question is whether the repaired system can demonstrate all of the following:

- Only staging or production is accepted, each using its environment configuration.
- The helper rejects another repository or a mutable image reference.
- The called workflow publishes the deployed image and deployment receipt.

Here is the central implementation file, `.github/workflows/deploy.yml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

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

In the training account run the caller with a valid ECR digest, then with a tag and wrong repository. Production must wait for environment review. Check the task-definition image and deployment receipt. This task validates the reuse boundary; candidate provenance is added in the attestation task.

[Open the give reusable deployment a protected environment boundary challenge](/challenges/cicd/aws-delivery-workshop?step=g3-reusable-deployment).

## Replace shared AWS access keys with scoped OIDC

OIDC exchanges a short-lived GitHub identity assertion for an AWS session. Token request permission, role trust and role permissions are separate. Match the actual sub claim: this fixture deliberately uses an existing repository's legacy subject; newly created or opted-in repositories can include immutable owner/repository IDs. Environment trust also requires branch restrictions in GitHub because the environment-form subject does not itself constrain a branch.

The operational question is whether the repaired system can demonstrate all of the following:

- The production environment requests a token and assumes only the named role.
- Trust matches the supplied audience and exact environment subject.
- An unauthorized environment or repository is denied; old keys are retired only after validation.

Here is the central implementation file, `.github/workflows/identity.yml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```yaml
name: Identity
on: [workflow_dispatch]
permissions:
  contents: read
jobs:
  identify:
    runs-on: ubuntu-24.04
    environment: production
    permissions:
      id-token: write
    steps:
      - uses: aws-actions/configure-aws-credentials@cabfdba3510de1431bac9dba27511d97497fc100
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: eu-west-1
      - run: aws sts get-caller-identity
```

Administrator: register the GitHub OIDC provider with sts.amazonaws.com audience and apply the role trust policy. Configure production AWS_ROLE_ARN, reviewers and main-only branch policy. Confirm assumed-role identity, then test a rejected environment/repository. Deactivate the legacy key, rerun without key secrets, inspect remaining consumers, then delete the key and secrets after the agreed observation period.

[Open the replace shared aws access keys with scoped oidc challenge](/challenges/cicd/aws-delivery-workshop?step=g4-aws-oidc).

## Repair ECS authorization without AdministratorAccess

The deploy role registers a task definition and requests ECS to run it. PassRole authorizes handing existing runtime roles to ECS; it is not the same as assuming them. The execution role lets ECS pull images and deliver logs; the task role authorizes application API calls. RegisterTaskDefinition and DescribeTaskDefinition use wildcard resources in this baseline; service mutation and PassRole can be narrowly constrained.

The operational question is whether the repaired system can demonstrate all of the following:

- Only orders-task and orders-execution can be passed to ecs-tasks.amazonaws.com.
- Service update and inspection are scoped to orders/orders.
- The reference explains operations that require wildcard resources rather than pretending every action supports ARN scoping.

Here is the central implementation file, `iam/deploy-policy.json`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RegisterTaskDefinition"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeTaskDefinition"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices"
      ],
      "Resource": "arn:aws:ecs:eu-west-1:222222222222:service/orders/orders"
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:PassRole"
      ],
      "Resource": [
        "arn:aws:iam::222222222222:role/orders-task",
        "arn:aws:iam::222222222222:role/orders-execution"
      ],
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "ecs-tasks.amazonaws.com"
        }
      }
    }
  ]
}
```

Apply in a training account through the IAM administrator. Run the real deployment helper from the AWS walkthrough. Attempt an unrelated task role and service and confirm denial. IAM simulation is useful preflight, but validate effective policies including boundaries and organization controls with actual sandbox calls.

[Open the repair ecs authorization without administratoraccess challenge](/challenges/cicd/aws-delivery-workshop?step=g5-aws-authorization).

## Publish one tested image and capture its immutable identity

A unique tag helps humans locate a release, but the digest names content. Build once locally, run smoke checks against that local image, push it, then use the registry digest for every deployment. release.json is an ordinary generated audit record, not a simulator instruction. It needs a consumer and trusted storage before it can authorize a separate release run.

The operational question is whether the repaired system can demonstrate all of the following:

- Only one docker build creates the candidate.
- The local smoke test runs before that candidate is pushed.
- The output and release.json contain repository@sha256 plus source/run identity.

Here is the central implementation file, `.github/workflows/release.yml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

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

Give the build role ECR authorization-token access plus repository-scoped layer upload, PutImage and DescribeImages permissions. In the training run count docker build calls, inspect release.json and compare ECR digest to the workflow output. Release tags include run attempt to avoid collisions with immutable-tag repositories.

[Open the publish one tested image and capture its immutable identity challenge](/challenges/cicd/aws-delivery-workshop?step=g6-build-once).

## Promote staging-tested bytes without rebuilding

Approval authorizes a selected candidate; it should not authorize a fresh build. Within one workflow, needs binds promotion to the successful staging job and the build output. A service-stable waiter can also return after rollback, so the helper verifies the resulting task-definition ARN. Longer-term release selection across separate workflows needs retained, authenticated release evidence.

The operational question is whether the repaired system can demonstrate all of the following:

- Staging and production consume the same build-job image output.
- Production requires successful staging and environment approval.
- A failed staging smoke check blocks production; neither deployment rebuilds.

Here is the central implementation file, `.github/workflows/release.yml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

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

Run a valid training release, download both deployment receipts and inspect both task definitions. Their image fields must equal the build output. Supply a staging failure and confirm production remains skipped. This baseline uses a shared accessible ECR repository; the cross-account exercise adds the registry boundary.

[Open the promote staging-tested bytes without rebuilding challenge](/challenges/cicd/aws-delivery-workshop?step=g7-promote-digest).

## Remove privileged execution from contributor-controlled code

A contributor can change package scripts, source and workflow input fields. Read-only tokens and disposable hosted runners bound the authority of ordinary PR validation. Quoting an interpolated GitHub expression does not make it safe shell data; pass text through an environment variable. Trusted release jobs need a separate reviewed source and event boundary.

The operational question is whether the repaired system can demonstrate all of the following:

- PR validation uses pull_request and read-only repository permission.
- Contributor text is passed as data, not interpolated into a shell program.
- No OIDC request, deployment role or secret is available in the PR job.

Here is the central implementation file, `.github/workflows/pr.yml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

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

Use a fork PR with the supplied title and a malicious package script. The title must print literally. Review the job token permissions and ensure no release credentials exist. Do not test credential theft against a real privileged repository.

[Open the remove privileged execution from contributor-controlled code challenge](/challenges/cicd/aws-delivery-workshop?step=g8-untrusted-pr).

## Reject a stale release after approval

Concurrency prevents overlap within its scope; it does not establish business ordering of releases or coordinate other deployment systems. A freshness check makes the stated current-main policy explicit. Non-cancelling deployment jobs avoid interrupting a live mutation. Rollback deliberately selects an older known-good release and therefore needs a separate protected path, not disabling freshness for everyone.

The operational question is whether the repaired system can demonstrate all of the following:

- Production concurrency is repository/service specific and cancel-in-progress is false.
- An older source commit is rejected before service mutation.
- The solution does not claim GitHub queues are FIFO or that a main-ref check is an atomic cloud lock.

Here is the central implementation file, `scripts/check-current-release.sh`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```bash
#!/usr/bin/env bash
set -euo pipefail
current=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)
if [[ "$GITHUB_SHA" != "$current" ]]; then
  printf '%s\n' "Stale candidate: $GITHUB_SHA; current main: $current" >&2
  exit 1
fi
```

Approve the newer run then the older run in a training repository. The latter must fail before UpdateService. Re-check after any approval wait. The ref may advance after preflight; this enforces current-at-start policy, not a global transaction. If other systems deploy, introduce a shared external deployment coordinator.

[Open the reject a stale release after approval challenge](/challenges/cicd/aws-delivery-workshop?step=g9-release-order).

## Verify the release producer before deployment

Digest verification answers which artifact; provenance verification answers which workflow and source produced it. Generate attestations inside the trusted build job with only the required attestation and OIDC permissions. A verifier should constrain the signer workflow as well as the repository. Keep SBOM and vulnerability policy as separate evidence: neither replaces producer identity.

The operational question is whether the repaired system can demonstrate all of the following:

- Attestation generation binds the published digest to the trusted release workflow.
- Verification checks the expected repository and signer workflow and fails closed.
- An unrelated digest or untrusted producer is rejected before deployment.

Here is the central implementation file, `.github/workflows/release.yml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

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

Authenticate the verifier to ECR for pulling the image, set GH_TOKEN for reading the expected repository's attestations, and invoke verify-producer.sh before deploy.sh. Test a legitimate published digest, an unattested digest and an attestation from another workflow. Retain verification output with the deployment record. GitHub CLI version and repository feature availability are prerequisites.

[Open the verify the release producer before deployment challenge](/challenges/cicd/aws-delivery-workshop?step=g10-provenance).

## Check Your Answers

:::expand[Where should reusable workflow authority live?]{kind="recap"}

The called deployment job selects a protected environment and its approved role; callers pass a constrained interface rather than arbitrary authority.

:::

:::expand[How do AWS identity and authorization differ?]{kind="recap"}

OIDC trust controls which GitHub identity assumes the role; the role policy controls its AWS operations, including narrowly scoped PassRole.

:::

:::expand[What binds staging evidence to production?]{kind="recap"}

Both environments consume the same immutable build output, and production requires staging success plus approval for that candidate.

:::

:::expand[Why are digest, provenance and ordering separate checks?]{kind="recap"}

A digest identifies bytes, provenance identifies their producer, and release ordering prevents a stale approved candidate from replacing the intended release.

:::

## References

- [Official implementation reference 1](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/troubleshooting-required-status-checks)
- [Official implementation reference 2](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
- [Official implementation reference 3](https://github.com/aws-actions/amazon-ecs-deploy-task-definition)
- [Official implementation reference 4](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [Official implementation reference 5](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html)
- [Official implementation reference 6](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)
- [Official implementation reference 7](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [Official implementation reference 8](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [Official implementation reference 9](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Official implementation reference 10](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-artifact-attestations-with-the-github-cli)
