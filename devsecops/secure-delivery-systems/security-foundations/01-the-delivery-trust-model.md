---
title: "The Delivery Trust Model"
description: "Learn how DevSecOps verifies source, review, build, artifact, registry, deployment, and runtime evidence across a release path."
overview: "Start with a simple restaurant analogy, then follow one checkout API release from source code to Kubernetes. You will see how commit SHAs, reviews, workflow identity, image digests, attestations, signatures, deployment gates, and runtime evidence connect into one trustable delivery story."
tags: ["devsecops", "trust", "supply-chain", "provenance"]
order: 1
id: article-devsecops-security-foundations-security-mental-model-delivery-systems
aliases:
  - security-mental-model-for-delivery-systems
  - article-devsecops-security-foundations-security-mental-model-delivery-systems
  - devsecops/security-foundations/security-mental-model-for-delivery-systems.md
  - threat-modeling-for-devops-workflows
  - article-devsecops-security-foundations-threat-modeling-devops-workflows
  - devsecops/security-foundations/threat-modeling-for-devops-workflows.md
  - devsecops/security-foundations/01-delivery-trust-model.md
  - devsecops/security-foundations/01-delivery-trust-model
  - security-foundations/01-delivery-trust-model
---

## Table of Contents

1. [A Simple Rule for Delivery Trust](#a-simple-rule-for-delivery-trust)
2. [The Restaurant Analogy](#the-restaurant-analogy)
3. [The Release We Will Trace](#the-release-we-will-trace)
4. [Step 1: Trust the Ingredients](#step-1-trust-the-ingredients)
5. [Step 2: Trust the Chefs](#step-2-trust-the-chefs)
6. [Step 3: Trust the Kitchen](#step-3-trust-the-kitchen)
7. [Step 4: Seal the Delivery Box](#step-4-seal-the-delivery-box)
8. [Step 5: Store the Box Safely](#step-5-store-the-box-safely)
9. [Step 6: Check the Box at the Door](#step-6-check-the-box-at-the-door)
10. [Step 7: Check the Plate on the Table](#step-7-check-the-plate-on-the-table)
11. [Trace One Release End to End](#trace-one-release-end-to-end)
12. [The Starter Checklist](#the-starter-checklist)
13. [What's Next](#whats-next)
14. [References](#references)

## A Simple Rule for Delivery Trust
<!-- section-summary: Delivery trust means each release handoff gets verified before production accepts the software. -->

The **delivery trust model** is a DevSecOps way of saying: do not trust a release only because it reached the final step. Verify the people, code, build system, artifact, registry, deployment gate, and runtime evidence along the way.

The simplest version is this: every important handoff in software delivery should leave proof. A developer changes code. A reviewer approves it. A pipeline builds it. A registry stores the image. A deployment system promotes it. Kubernetes runs it. The delivery trust model asks each step to prove what it received, what it produced, and who or what made the decision.

For a beginner, this can sound bigger than it is. At the heart of the idea sits one practical production question:

| Production question | Plain-English meaning |
|---|---|
| Which code is running? | The team can name the exact commit. |
| Who changed it? | The team can find the pull request and author. |
| Who approved it? | The team can see review and branch-rule evidence. |
| Which system built it? | The team can find the CI workflow and run. |
| Which artifact came out? | The team can name the image digest or package hash. |
| Who allowed deployment? | The team can see the gate, approval, and policy result. |
| What is running now? | The team can compare runtime state with the release record. |

This article keeps those questions attached to one story. We will start with an analogy, then map each part into real delivery work.

## The Restaurant Analogy
<!-- section-summary: A restaurant supply chain gives beginners a simple picture before we add DevSecOps terms. -->

Imagine a high-security restaurant that promises customers safe food. The old security habit would be to inspect the final plate right before it leaves the kitchen. A food inspector tastes the finished meal, sees nothing obvious, and lets the waiter serve it.

That final check helps, but it misses several ways the meal can go wrong. A spoiled ingredient may enter the kitchen. A person without permission may change the recipe. A dirty workstation may contaminate the food. A waiter may carry the correct dish to the wrong table. A customer may receive a plate that looks fine but came through a broken process.

The safer restaurant checks the full path:

| Restaurant step | Simple security idea | DevSecOps version |
|---|---|---|
| Check the ingredients | Use safe parts | Review source code and dependencies |
| Check the chefs | Allow trusted people to change recipes | Require identity, review, and ownership |
| Check the kitchen | Keep the build area controlled | Secure the CI/CD runner and workflow |
| Seal the delivery box | Stop tampering after cooking | Use digests, attestations, and signatures |
| Store the box safely | Keep finished meals in a controlled place | Protect the artifact registry |
| Check at the door | Verify the seal before serving | Use deployment gates |
| Check the plate on the table | Confirm what the customer received | Compare runtime evidence with release records |

That is the spine of the delivery trust model. Security moves from one final inspection into a chain of smaller checks. Each check answers a specific question and leaves evidence for the next person or system.

Now we can translate the restaurant into a real release.

## The Release We Will Trace
<!-- section-summary: One checkout API release gives every later concept a concrete place to land. -->

Let's use a fictional company called Harbor Books. It sells books online, and its most important service is `checkout-api`. The service receives a cart, validates coupons, confirms tax, and sends payment requests to a payment provider.

Maya, an application engineer, fixes a coupon bug. Expired partner coupons were still accepted in a narrow edge case. The change sounds small, but the service touches payments and customer orders, so Harbor Books wants proof before production runs the new version.

Here is the first simple release record. It is intentionally small. We will add more pieces through the article:

```yaml
service: checkout-api
repository: github.com/harborbooks/checkout-api
pull_request: 482
commit: 7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20
environment: production
```

The important field for the rest of the article is the **commit SHA**. A commit SHA is Git's identifier for one exact snapshot of the repository. A branch name like `main` can point to different commits over time. A full commit SHA points to one commit.

The delivery trust model now asks a sequence of questions about that commit. Did it come from the expected repository? Did the right people review it? Did a trusted pipeline build it? Which image did the pipeline produce? Did production verify the image before deployment? Did Kubernetes actually run that image?

The same three images in this article are still useful, but we will reach them gradually instead of starting with the whole delivery path at once.

## Step 1: Trust the Ingredients
<!-- section-summary: Source code and dependencies are the ingredients that enter the release before any build happens. -->

In the restaurant story, ingredients are vegetables, meat, spices, and sauces. In a software release, the ingredients are **source code**, **configuration**, and **dependencies**.

**Source code** is the code your team writes. **Dependencies** are packages your team imports from somewhere else, such as npm, PyPI, Maven Central, an internal package registry, or a shared company module. The delivery trust model checks both because production does not care whether risky code came from your own file or from a package you installed.

For Harbor Books, Maya's source change lives in pull request `#482`. The first evidence question is plain:

> Does this production release come from the expected repository and exact commit?

An engineer can inspect the commit locally:

```bash
git show --show-signature --format=fuller 7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20
```

`git show` prints the commit. `--format=fuller` shows author and committer details. `--show-signature` asks Git to show signature verification information if the commit or tag has a signature.

Example output:

```bash
commit 7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20
Author:     Maya Chen <maya@harborbooks.example>
Commit:     GitHub <noreply@github.com>
Date:       Sun Jun 21 10:14:22 2026 +0000

    Reject expired partner coupons
```

This output gives the team a starting point. It names the exact commit, the author, and the commit message. A signed commit or signed release tag can add stronger cryptographic proof, but the beginner habit is already clear: use the exact commit, not a moving branch name.

Dependencies need the same kind of source thinking. Suppose Maya's pull request updates one package:

```json
{
  "dependencies": {
    "@harbor/coupon-rules": "2.4.1"
  }
}
```

That package name is only half the evidence. The team also wants the registry, the resolved version, and the lockfile hash. A private package such as `@harbor/coupon-rules` should come from Harbor Books' internal registry, not from a public registry with a similar name. Later articles in the software supply chain module go deeper into dependency confusion, lockfiles, SBOMs, and vulnerability reachability. Here, the main idea is simple: safe delivery starts with knowing what entered the release.

Once the ingredients are clear, the next question is about people. Who was allowed to change the recipe?

## Step 2: Trust the Chefs
<!-- section-summary: Review evidence proves the change passed the expected people and branch rules before the build used it. -->

In the restaurant, a chef should have permission to enter the kitchen and change the recipe. In software delivery, that maps to **identity**, **ownership**, and **review**.

**Review status** means the change passed the team's merge rules before the build system used it. For `checkout-api`, the team wants a pull request, code-owner review, passing tests, security checks, and no direct push to the production branch.

The pull request record can answer the first review question:

```bash
gh pr view 482 \
  --repo harborbooks/checkout-api \
  --json number,title,author,headRefOid,baseRefName,reviewDecision,statusCheckRollup
```

`gh pr view 482` reads pull request `#482`. `--repo` selects the repository. `--json` asks GitHub CLI for specific fields so the output can be stored or checked by automation.

Example output, shortened for readability:

```json
{
  "number": 482,
  "title": "Reject expired partner coupons",
  "author": { "login": "maya-chen" },
  "headRefOid": "7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20",
  "baseRefName": "main",
  "reviewDecision": "APPROVED"
}
```

The team checks that `headRefOid` matches the commit in the release record. If the pull request approved one commit and the pipeline built another, the release story has a gap.

Harbor Books also uses `CODEOWNERS` to route sensitive changes:

```
/services/checkout-api/ @harborbooks/checkout-maintainers
/services/checkout-api/payments/ @harborbooks/payments-security
/.github/workflows/release-checkout.yml @harborbooks/platform-security
/k8s/checkout/ @harborbooks/platform-security
```

This file is a simple ownership map. Checkout maintainers review checkout service changes. Payment security reviews payment-related code. Platform security reviews workflow and Kubernetes files because those files control the path to production.

Branch protection turns that ownership map into a gate. A protected `main` branch can require pull request reviews, status checks, code-owner approval, conversation resolution, signed commits, merge queues, and restrictions on direct pushes. The exact settings depend on the platform, but the beginner idea is steady: production code should enter through a reviewed path.

At this point, the release has trusted ingredients and trusted reviewers. Now the restaurant hands the recipe to the kitchen.

## Step 3: Trust the Kitchen
<!-- section-summary: Build identity names the automation that turned reviewed source into an artifact. -->

In the restaurant, the kitchen is the controlled place where ingredients turn into a meal. In DevSecOps, the kitchen is the **CI/CD pipeline**.

**CI/CD** means the automation that runs tests, builds packages, scans results, and moves software toward release. A **runner** is the machine that executes a CI/CD job. A build runner may download code, install dependencies, run tests, build a container image, request credentials, and publish artifacts. That makes the runner an important trust boundary.

For Harbor Books, GitHub Actions builds `checkout-api`. A beginner-friendly release workflow can start as a skeleton:

```yaml
name: release-checkout

on:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - name: Build the image
        run: echo "build image here"
      - name: Publish release evidence
        run: echo "publish evidence here"
```

This skeleton has three teaching pieces. `on.push.branches` says the workflow runs after a change reaches `main`. `runs-on` chooses the runner image. The steps show the order: check out the reviewed code, build the artifact, then publish evidence.

The production workflow adds permissions and real build steps:

```yaml
permissions:
  contents: read
  packages: write
  id-token: write
  attestations: write

jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.sha }}

      - uses: docker/build-push-action@v6
        id: build
        with:
          context: .
          push: true
          tags: ghcr.io/harborbooks/checkout-api:${{ github.sha }}
          labels: |
            org.opencontainers.image.source=https://github.com/harborbooks/checkout-api
            org.opencontainers.image.revision=${{ github.sha }}
```

The `permissions` block limits the job token. `contents: read` lets the job read source. `packages: write` lets it publish the image. `id-token: write` lets the job request an OIDC token for keyless signing or cloud federation. `attestations: write` lets it publish artifact attestations.

The checkout step uses `ref: ${{ github.sha }}` so the build uses the exact commit that triggered the workflow. The image label `org.opencontainers.image.revision` stores the commit SHA as image metadata, which helps humans connect an image back to source during debugging.

Now the kitchen has prepared the meal. The next question is how Harbor Books proves the box stayed sealed after the build finished.

## Step 4: Seal the Delivery Box
<!-- section-summary: Artifact integrity ties the build output to a digest, attestation, and signature. -->

In the restaurant story, the finished meal gets a tamper-evident seal before it leaves the kitchen. In software delivery, the seal starts with an **artifact digest**.

An **artifact** is a file or package produced by the delivery process. A container image, compiled binary, Helm chart, Java `.jar`, and Terraform module can all be artifacts. A **digest** is a content-based identifier. If the artifact content changes, the digest changes.

For `checkout-api`, the build produces a container image:

```bash
ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

The part after `@` is the digest. It gives production a stable object to verify. A tag such as `main`, `latest`, or `2026-06-21` is convenient for humans, but a tag can be moved to a different image. A digest names image content.

The workflow can attach provenance to that digest:

```yaml
- uses: actions/attest-build-provenance@v2
  with:
    subject-name: ghcr.io/harborbooks/checkout-api
    subject-digest: ${{ steps.build.outputs.digest }}
    push-to-registry: true
```

**Provenance** is a build receipt. It records information such as the artifact digest, source repository, commit, workflow, builder, and build run. SLSA uses provenance to describe how an artifact was produced. GitHub Artifact Attestations give GitHub Actions users a practical way to create and verify this kind of receipt.

Harbor Books can also sign the image with cosign:

```bash
cosign sign \
  ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

`cosign sign` creates a signature for the image digest. With keyless signing, cosign uses the workflow's OIDC identity instead of a long-lived signing key stored as a secret. That is useful because the signature can say which workflow identity signed the digest.

Example verification command:

```bash
cosign verify \
  --certificate-identity "https://github.com/harborbooks/checkout-api/.github/workflows/release-checkout.yml@refs/heads/main" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

`--certificate-identity` names the workflow identity Harbor Books trusts. `--certificate-oidc-issuer` names GitHub Actions as the OIDC issuer. The final argument is the exact image digest.

Example output:

```bash
Verification for ghcr.io/harborbooks/checkout-api@sha256:9f3e6f...
The following checks were performed:
  - The cosign claims were validated
  - The certificate was verified against Fulcio roots
  - The certificate identity matched the expected workflow
```

The output tells the release system that the signature belongs to the expected workflow identity and the digest has not changed since signing.

![Artifact integrity gate infographic showing an image digest checked by attestation, signature, and trusted workflow before production deployment](/content-assets/articles/article-devsecops-security-foundations-security-mental-model-delivery-systems/artifact-integrity-gate.png)

*The artifact gate checks the digest, provenance, and signature before production accepts the image.*

The sealed box now exists. The next step is storing it in a place production can trust.

## Step 5: Store the Box Safely
<!-- section-summary: Registry identity protects the artifact storage location and publishing path. -->

In the restaurant, finished meals should sit in a controlled pickup area. In software delivery, finished artifacts usually sit in a **registry**.

A **container registry** stores container images, tags, manifests, digests, signatures, and sometimes attestations. Registry identity means the release process knows the registry host, organization, repository, digest, and publisher.

For Harbor Books, the trusted image location is:

```bash
ghcr.io/harborbooks/checkout-api
```

That name breaks down into pieces:

| Piece | Meaning |
|---|---|
| `ghcr.io` | The registry host |
| `harborbooks` | The organization or namespace |
| `checkout-api` | The image repository |
| `sha256:9f3e...` | The content digest |

The registry needs controls because production pulls from it. A weak registry setup lets too many people or jobs push to the same image name. A stronger setup separates push access from pull access, publishes only from CI, logs registry events, keeps old release digests, and uses immutable tags or digest-based deployment.

An engineer can inspect the remote image record:

```bash
docker buildx imagetools inspect \
  ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

`docker buildx imagetools inspect` reads image metadata from the registry. The digest reference makes the command inspect the exact artifact instead of whatever a tag points to today.

Example output, shortened:

```bash
Name:      ghcr.io/harborbooks/checkout-api@sha256:9f3e6f...
MediaType: application/vnd.oci.image.index.v1+json
Digest:    sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
Platform:  linux/amd64
```

The important check is the digest. The release record, registry record, attestation, signature, and deployment manifest should all point to the same value.

The artifact now sits in a controlled place. The next question is how production decides whether to accept it.

## Step 6: Check the Box at the Door
<!-- section-summary: Deployment gates verify the artifact and record the production decision. -->

In the restaurant, a waiter checks the sealed box before serving it. In software delivery, a **deployment gate** checks whether an artifact may enter an environment.

A simple deployment gate may ask for one human approval. A stronger gate verifies the image digest, signature, provenance, vulnerability policy, source branch, and deployment approver. The gate should record its decision so the team can revisit it during an incident or audit.

Now the release record grows:

```yaml
service: checkout-api
environment: production
commit: 7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20
pull_request: 482
workflow_run: 9142337112
image: ghcr.io/harborbooks/checkout-api
digest: sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
signature_verified: true
attestation_verified: true
approved_by:
  - sasha.release
  - lina.platform
```

This record is the software version of the checked delivery box. It connects the source, build, artifact, verification result, and approval.

A deployment job can verify the attestation before it updates Kubernetes:

```bash
IMAGE="ghcr.io/harborbooks/checkout-api"
DIGEST="sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6"
REF="${IMAGE}@${DIGEST}"

gh attestation verify "oci://${REF}" \
  --repo harborbooks/checkout-api
```

`IMAGE` and `DIGEST` keep the reference readable. `REF` combines them into the exact image reference. `gh attestation verify` checks that an attestation exists for the artifact and that it can be traced to the expected repository.

Example output:

```bash
Loaded digest sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
✓ Verification succeeded
sha256:9f3e6f... was attested by harborbooks/checkout-api
```

After verification, the job can update Kubernetes by digest:

```bash
kubectl -n checkout set image deployment/checkout-api \
  checkout-api="${REF}"

kubectl -n checkout annotate deployment/checkout-api \
  devpolaris.io/commit="7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20" \
  devpolaris.io/workflow-run="9142337112" \
  devpolaris.io/deployment-record="prod-2026-06-21.3"
```

`kubectl set image` changes the container image in the Deployment. The image value uses the digest reference. `kubectl annotate` stores release context on the Deployment so responders can find it without leaving the cluster.

Example output:

```bash
deployment.apps/checkout-api image updated
deployment.apps/checkout-api annotated
```

The door check is complete. The final proof comes from the running platform.

## Step 7: Check the Plate on the Table
<!-- section-summary: Runtime evidence proves which artifact the platform actually started. -->

In the restaurant story, the last check confirms the plate at the table matches the sealed order. In production, **runtime evidence** confirms the platform actually runs the approved artifact.

A deployment record says what should run. Kubernetes can show what the Deployment asks for and what each Pod actually pulled. That comparison catches rollout gaps, stale Pods, emergency changes, and tag mistakes.

First, check the Deployment image:

```bash
kubectl -n checkout get deployment checkout-api \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="checkout-api")].image}{"\n"}'
```

`kubectl get deployment` reads the Deployment. `-n checkout` selects the namespace. The `jsonpath` expression prints only the image configured for the `checkout-api` container.

Expected output:

```bash
ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

Then check the running Pods:

```bash
kubectl -n checkout get pods -l app=checkout-api \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[?(@.name=="checkout-api")].imageID}{"\n"}{end}'
```

`-l app=checkout-api` selects only the Pods for the service. The `imageID` field comes from the container runtime after the image is pulled.

Example output:

```bash
checkout-api-7f6c9c6f8b-4p9qx   ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
checkout-api-7f6c9c6f8b-m2t8v   ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

Both Pods use the approved digest. If one Pod showed an older digest, the team would investigate rollout progress, stuck Pods, or manual changes. If every Pod uses the approved digest, the team can move the investigation into application behavior, feature flags, data, or external systems with more confidence.

![Delivery trust path infographic showing commit, review, build, digest, registry, deployment gate, and runtime connected by evidence cards](/content-assets/articles/article-devsecops-security-foundations-security-mental-model-delivery-systems/delivery-trust-path.png)

*The same identifiers move through source, review, build, artifact, registry, deployment, and runtime checks.*

## Trace One Release End to End
<!-- section-summary: A practical trace compares the same commit and digest across each delivery handoff. -->

Now put the full story together. Sasha is on call. Support reports that expired coupons worked for a few customers after the June 21 release. Sasha needs to answer one first question: is production running Maya's approved fix?

The trace starts with source and review:

```bash
gh pr view 482 \
  --repo harborbooks/checkout-api \
  --json number,title,headRefOid,reviewDecision,mergeCommit
```

The command asks for the PR number, title, reviewed commit, review decision, and merge commit.

Example output:

```json
{
  "number": 482,
  "title": "Reject expired partner coupons",
  "headRefOid": "7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20",
  "reviewDecision": "APPROVED",
  "mergeCommit": { "oid": "7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20" }
}
```

Next, Sasha checks the build:

```bash
gh run view 9142337112 \
  --repo harborbooks/checkout-api \
  --json headSha,event,workflowName,conclusion,url
```

`headSha` should match the approved commit. `conclusion` should be `success`.

Example output:

```json
{
  "headSha": "7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20",
  "event": "push",
  "workflowName": "release-checkout",
  "conclusion": "success"
}
```

Then Sasha checks artifact proof:

```bash
REF="ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6"

gh attestation verify "oci://${REF}" \
  --repo harborbooks/checkout-api

cosign verify \
  --certificate-identity "https://github.com/harborbooks/checkout-api/.github/workflows/release-checkout.yml@refs/heads/main" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "${REF}"
```

The first check verifies the build attestation. The second verifies the signature identity. Both commands use the same digest reference.

Finally, Sasha checks production:

```bash
kubectl -n checkout get deployment checkout-api \
  -o jsonpath='{.metadata.annotations.devpolaris\.io/deployment-record}{"\n"}{.spec.template.spec.containers[?(@.name=="checkout-api")].image}{"\n"}'
```

Expected output:

```bash
prod-2026-06-21.3
ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

That is the delivery trust model in action. It does not solve the coupon bug by itself. It tells Sasha that production is running the approved artifact from the expected source and build. That answer narrows the investigation.

| Step | Evidence | Good answer |
|---|---|---|
| Source | Pull request and commit | PR `#482` points to commit `7c1a2ef...` |
| Review | Branch rules and reviews | Required approval and checks passed |
| Build | Workflow run | Run `9142337112` built the same commit |
| Artifact | Digest | Image digest is `sha256:9f3e...` |
| Provenance | Attestation | Attestation subject matches the digest |
| Signature | cosign verification | Expected workflow identity signed it |
| Deployment | Release record | Production accepted the same digest |
| Runtime | Pod image IDs | Running Pods use the same digest |

## The Starter Checklist
<!-- section-summary: A first delivery trust implementation records a small set of identifiers and verifies them at each handoff. -->

A useful delivery trust model does not have to start as a huge platform project. A team can begin by recording the same few identifiers everywhere: commit SHA, pull request number, workflow run ID, image digest, attestation, signature identity, deployment record, and runtime image ID.

Here is a practical first version:

| Area | Starter control |
|---|---|
| Source | Use pull requests for production branches |
| Ownership | Add CODEOWNERS for sensitive app, workflow, and deployment paths |
| Review | Require approvals and status checks before merge |
| Build | Record workflow run ID, commit SHA, runner type, and job result |
| Identity | Prefer short-lived OIDC identity over shared long-lived secrets |
| Artifact | Publish and deploy container images by digest |
| Provenance | Generate a build provenance attestation for the digest |
| Signing | Sign the digest and verify the expected workflow identity |
| Registry | Restrict who can push and keep registry audit logs |
| Deployment | Store approvers, verification result, commit, and digest |
| Runtime | Compare Kubernetes image IDs with the approved digest |

NIST SSDF gives teams a broad secure software development framework. SLSA gives more detailed language for build integrity and provenance. Sigstore and cosign give practical signing and verification tools. GitHub Artifact Attestations give GitHub Actions teams a built-in way to generate provenance. Kubernetes and registries give the runtime and artifact records that responders can compare.

![Release evidence summary infographic showing commit SHA, PR review, workflow run, image digest, deployment record, and running pods connected to one approved release](/content-assets/articles/article-devsecops-security-foundations-security-mental-model-delivery-systems/release-evidence-summary.png)

*The release record is useful because the same identifiers appear in source control, CI, the registry, the deployment gate, and Kubernetes.*

## What's Next

Delivery trust gives the release path a chain of evidence. The next question is access. Which people, services, CI jobs, deployment systems, and runtime identities can perform each step? Which secrets or tokens make those actions possible? The next article moves into least privilege and secrets so the same release path has tighter control over who can change, build, publish, and deploy.

## References

- [NIST SP 800-218: Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST's SSDF publication for secure software development practices.
- [SLSA v1.1: Producing artifacts](https://slsa.dev/spec/v1.1/requirements) - SLSA requirements for build platforms, provenance, and build isolation.
- [SLSA v1.1: Provenance](https://slsa.dev/spec/v1.1/provenance) - SLSA provenance fields and artifact subject structure.
- [Sigstore cosign documentation](https://docs.sigstore.dev/cosign/) - Official cosign documentation for signing and verifying artifacts.
- [GitHub: Using artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) - GitHub documentation for generating and using artifact attestations.
- [GitHub: About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) - GitHub documentation for branch protection rules, review requirements, status checks, and signed commits.
- [Docker: Image digests](https://docs.docker.com/dhi/core-concepts/digests/) - Docker documentation explaining image digests and immutable image references.
- [OCI Image Specification: Descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md) - OCI descriptor documentation for media type, size, and digest fields.
- [Kubernetes: Images](https://kubernetes.io/docs/concepts/containers/images/) - Kubernetes documentation for image names, tags, digests, and image pulls.
