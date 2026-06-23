---
title: "The Delivery Trust Model"
description: "Understand how to prove code origin, review status, build identity, and artifact integrity across a delivery path."
overview: "Follow one checkout service from pull request to Kubernetes and learn how commit SHA, reviews, workflow identity, image digest, attestations, deployment records, and runtime evidence prove what reached production."
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

1. [The Delivery Trust Path](#the-delivery-trust-path)
2. [The Production Scenario](#the-production-scenario)
3. [Code Origin](#code-origin)
4. [Review Status](#review-status)
5. [Build Identity](#build-identity)
6. [Artifact Integrity](#artifact-integrity)
7. [Registry Identity](#registry-identity)
8. [Deployment Gates](#deployment-gates)
9. [Runtime Provenance](#runtime-provenance)
10. [Tracing One Release](#tracing-one-release)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The Delivery Trust Path
<!-- section-summary: A delivery trust model gives the team evidence for each handoff from source code to running production software. -->

A **delivery trust model** is the evidence path a team uses to answer a simple production question: which exact code is running, who changed it, who reviewed it, which system built it, which artifact came out of that build, which registry stored it, which gate approved it, and which runtime pulled it. The phrase sounds big, so let's make it practical right away. If a customer-facing service starts behaving strangely at 2:00 in the afternoon, the team should trace the running container back to a commit and a review record without guessing.

This matters because modern software delivery has many handoffs. A developer writes code, Git stores a commit, a pull request collects review, a CI system builds an image, a registry stores that image, a deployment system moves it toward production, and a runtime like Kubernetes starts it. Every handoff can preserve evidence, lose evidence, or accept a weak shortcut. DevSecOps tries to keep the speed of automation while adding proof at the points where blind trust used to hide.

In this article, we will follow one service through that path. The path has seven proof points. **Code origin** answers where the change came from. **Review status** answers whether the right people and checks approved it. **Build identity** answers which automation built it. **Artifact integrity** answers which exact output came from the build. **Registry identity** answers where the artifact lives and who can publish there. **Deployment gates** answer why production accepted the artifact. **Runtime provenance** answers what the production platform actually started.

Official standards use similar language. NIST's Secure Software Development Framework, usually called **SSDF**, talks about protecting software from tampering, verifying release integrity, and keeping provenance data. **SLSA**, which stands for Supply-chain Levels for Software Artifacts, focuses on build integrity and provenance. **Sigstore** and **cosign** give teams practical signing and verification tools for container images and other artifacts. These are real industry building blocks, and we will keep them grounded in one normal release.

![Delivery trust path infographic showing commit, review, build, digest, registry, deployment gate, and runtime connected by evidence cards](/content-assets/articles/article-devsecops-security-foundations-security-mental-model-delivery-systems/delivery-trust-path.png)

*The delivery path keeps the same evidence attached as the artifact moves from source code to the running Kubernetes workload.*

## The Production Scenario
<!-- section-summary: One checkout service gives every later section a concrete release to trace from commit to runtime. -->

Let's use a fictional company called Harbor Books. Harbor Books sells books online, and the most important service is `checkout-api`. That service receives the cart, validates coupons, confirms tax, and sends the payment request to a payment provider. If `checkout-api` ships a bad release, customers may see wrong totals or failed checkouts. If an attacker slips code into that release, the damage could reach payments, customer addresses, and the public brand.

The team is shipping a coupon validation fix on June 21, 2026. Maya, an application engineer, opens a pull request called "Reject expired partner coupons." The final commit SHA is `7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20`. A **commit SHA** is the Git identifier for one exact snapshot of the repository. A short SHA like `7c1a2ef` is useful for humans, and the full SHA is the safest value for release records because it identifies the commit more precisely.

The release uses GitHub Actions, GitHub Container Registry, and Kubernetes. The CI workflow builds an image named `ghcr.io/harborbooks/checkout-api`. The build produces this image digest:

```bash
sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

An **image digest** is a cryptographic identifier for the image content. The digest is the value the team wants in production records because a tag like `main` or `2026-06-21` can move later. The digest points to the content that the registry stored for that image at the time of the build.

Here are the release facts we will keep using:

| Evidence point | Example value |
|---|---|
| Repository | `github.com/harborbooks/checkout-api` |
| Pull request | `#482` |
| Commit SHA | `7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20` |
| Workflow | `.github/workflows/release-checkout.yml` |
| Workflow run | `9142337112` |
| Image | `ghcr.io/harborbooks/checkout-api` |
| Image digest | `sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6` |
| Deployment record | `prod-2026-06-21.3` |
| Runtime | Kubernetes namespace `checkout` |

The rest of the article asks one question at a time. First, can the team prove where Maya's code came from?

## Code Origin
<!-- section-summary: Code origin records the repository, commit, author, merge path, and signature evidence for the change entering the delivery path. -->

**Code origin** means the evidence that connects a production release to a real change in source control. In plain English, it answers, "Where did this code come from?" For Harbor Books, the answer should include the repository, branch, commit SHA, pull request, author, committer, and merge event. That gives the release team a source record before the build system ever starts.

Git stores two useful names on a commit: the **author** and the **committer**. The author is the person who originally wrote the change. The committer is the person or system that put the commit into the repository history. In a normal pull request, Maya may be the author, and GitHub may create the final merge commit as the committer. Those fields are useful, and the team treats them as one part of the evidence.

A production team usually adds stronger checks around that Git record. Signed commits or signed tags can prove that a commit or release tag came from a key or identity the team recognizes. Branch protection can require the change to enter through a pull request instead of direct pushes. Repository audit logs can show who merged the pull request. These controls work together: Git gives the object identity, GitHub gives hosted review and merge evidence, and signatures add cryptographic proof where the team chooses to require it.

Maya's team might inspect the source record like this during an incident:

```bash
git rev-parse HEAD
git show --show-signature --format=fuller 7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20
git log --format='%H %an <%ae> %cn <%ce>' -1 7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20
```

The first command prints the current commit SHA. The second shows the commit metadata and signature status. The third prints the author and committer names in a compact form. In a production trace, the team wants the SHA in the deployment record to match the SHA in the pull request and the SHA in the build provenance.

GitHub can also answer source questions from the hosted review record:

```bash
gh pr view 482 \
  --repo harborbooks/checkout-api \
  --json number,title,author,headRefOid,baseRefName,mergedAt,mergedBy,reviewDecision,statusCheckRollup
```

That output gives the pull request number, title, author, head commit, base branch, merge time, merge actor, review decision, and status checks. The exact JSON shape may be more detailed than a beginner needs, so the practical point is this: a team should be able to show that production came from a known repository and a known commit that passed through the expected merge path.

Code origin gives the first piece of the release story. The next question is whether the right people and automated checks agreed that this change could merge.

## Review Status
<!-- section-summary: Review status proves the change passed required human approvals and automated checks before the build used it. -->

**Review status** means the evidence that a change passed the team's merge rules. For Harbor Books, a coupon validation change needs at least one checkout maintainer review, passing unit tests, passing security checks, and no direct push to `main`. The review record matters because a good commit SHA alone only says which code changed. Review evidence adds the approvals, conversations, and required checks that make the merge trustworthy.

GitHub branch protection rules are a common way to enforce this. A protected branch can require a pull request before merging, require approvals, require status checks, require conversation resolution, require signed commits, and restrict who can push. Teams often start with the basics and tighten the rules as the service gets more important. For `checkout-api`, the production branch is important enough to require review and checks on every change.

The Harbor Books repository has a `CODEOWNERS` file that routes sensitive paths to the right reviewers:

```
/services/checkout-api/ @harborbooks/checkout-maintainers
/services/checkout-api/payments/ @harborbooks/payments-security
/.github/workflows/release-checkout.yml @harborbooks/platform-security
/k8s/checkout/ @harborbooks/platform-security
```

This file says changes under the checkout service need checkout maintainers. Payment-related code needs the payments security group. Workflow and Kubernetes deployment changes need platform security because those files control how code reaches production. That last detail is important in real teams. An attacker who can change the build workflow may change the release path even if the application code looks normal.

The protected branch for `main` can use rules like these:

| Rule | Harbor Books setting | Why the team uses it |
|---|---|---|
| Pull request required | Enabled | Every production change gets a review record |
| Required approvals | `2` | One reviewer can miss a risky change |
| Code owner review | Enabled | Sensitive paths reach the right team |
| Status checks | `unit-tests`, `container-scan`, `build-dry-run` | The same checks run before every merge |
| Stale review dismissal | Enabled | A new commit needs fresh approval |
| Direct pushes | Restricted | Release history goes through the same path |

During the June 21 release, Maya's PR has approvals from `@harborbooks/checkout-maintainers` and `@harborbooks/payments-security`. The status checks are green. The merge commit points to the same head SHA that the build later uses. This is the handoff from human review to automated build.

Now the team has a known source change and a known review record. The next proof point asks which system built the production artifact.

## Build Identity
<!-- section-summary: Build identity names the automation that created the artifact, including the workflow, runner, token issuer, and source commit. -->

**Build identity** means the identity of the system that turns source code into an artifact. In our scenario, GitHub Actions builds the `checkout-api` container image. The evidence should show the workflow file, the workflow run ID, the repository, the branch or tag, the commit SHA, and the token identity used to publish the image. This matters because the build system has a powerful role: it can package code, attach metadata, sign artifacts, and push to the registry.

CI/CD means continuous integration and continuous delivery. It is the automation that runs tests, builds packages, and moves changes toward release. Older pipelines often stored long-lived registry passwords or cloud access keys as CI secrets. Modern pipelines try to use **OIDC**, which stands for OpenID Connect. In this context, OIDC lets the CI job request a short-lived identity token that says, "This job came from this repository, this workflow, this branch, and this run." The registry or cloud provider can trust that token for a narrow action, such as pushing one image.

A simplified Harbor Books workflow looks like this:

```yaml
name: release-checkout

on:
  push:
    branches:
      - main

permissions:
  contents: read
  id-token: write
  attestations: write
  packages: write

jobs:
  build:
    runs-on: ubuntu-24.04
    environment: build

    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.sha }}

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

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

The workflow checks out the exact commit that triggered the build. The permissions block gives the job only the token powers it needs: read source, request an OIDC token, write attestations, and publish packages. The image labels store the source repository and commit inside the image metadata. Those labels help humans during debugging, while the digest and provenance record carry stronger evidence.

Build identity also includes the runner environment. GitHub-hosted runners are created fresh for jobs. Some companies use self-hosted runners for private networks or special hardware. Self-hosted runners need extra care because a compromised runner can affect the build output. Teams that use self-hosted runners usually isolate projects, patch runners often, avoid sharing runners between trust zones, and keep build logs and runner inventory for investigations.

At this point, Harbor Books knows the source and the builder. The next question is what exact artifact came out of that build.

## Artifact Integrity
<!-- section-summary: Artifact integrity ties the build output to a digest, signature, and provenance statement so the release uses the exact artifact that CI produced. -->

An **artifact** is a file or package produced by the delivery process. A container image, a compiled binary, a Helm chart, a Java `.jar`, and a Terraform module can all be artifacts. **Artifact integrity** means the team can prove the artifact has the same content that the trusted build created. For `checkout-api`, the artifact is a container image, and the most important identifier is the image digest.

A container tag is a friendly name. The tag `main`, `latest`, or `7c1a2ef` can point to an image. A digest is content-based. Docker and OCI registries use digests like `sha256:...` to identify image content. If the content changes, the digest changes. That is why production records should use the digest whenever possible.

The build step can expose the digest as an output:

```yaml
      - uses: docker/build-push-action@v6
        id: build
        with:
          context: .
          push: true
          tags: ghcr.io/harborbooks/checkout-api:${{ github.sha }}
          labels: |
            org.opencontainers.image.source=https://github.com/harborbooks/checkout-api
            org.opencontainers.image.revision=${{ github.sha }}

      - name: Capture image digest
        run: |
          echo "IMAGE=ghcr.io/harborbooks/checkout-api" >> "$GITHUB_ENV"
          echo "DIGEST=${{ steps.build.outputs.digest }}" >> "$GITHUB_ENV"
```

Now the workflow can produce provenance and signing evidence. **Provenance** means information about how the artifact came to exist. In SLSA language, provenance usually includes the subject artifact, builder identity, build type, source materials, build parameters, and run details. A beginner can think of it as a build receipt that names the artifact and the process that created it.

GitHub Artifact Attestations can create a provenance statement for the image:

```yaml
      - uses: actions/attest@v4
        with:
          subject-name: ghcr.io/harborbooks/checkout-api
          subject-digest: ${{ steps.build.outputs.digest }}
          push-to-registry: true
```

Sigstore cosign can sign the image digest with keyless signing:

```bash
cosign sign ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

Keyless signing uses the workflow's OIDC identity and avoids storing a long-lived signing key as a secret. The signature certificate can include the GitHub workflow identity, such as the repository and workflow file. Later, a deployment gate can verify that the signature came from the expected workflow identity.

Here is the verification shape Harbor Books wants before production:

```bash
cosign verify \
  --certificate-identity "https://github.com/harborbooks/checkout-api/.github/workflows/release-checkout.yml@refs/heads/main" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

This checks that the image digest has a signature tied to the expected GitHub Actions workflow identity and OIDC issuer. In a real pipeline, the same idea can run inside a release job, an admission controller, or a policy engine. The important part is the evidence chain: source commit, build run, image digest, provenance, and signature all point to the same release.

![Artifact integrity gate infographic showing an image digest checked by attestation, signature, and trusted workflow before production deployment](/content-assets/articles/article-devsecops-security-foundations-security-mental-model-delivery-systems/artifact-integrity-gate.png)

*The production gate should verify that attestation, signature, and workflow identity all point to the same image digest before rollout.*

The artifact now has an identity. The next section asks where that artifact lives and who gets to publish there.

## Registry Identity
<!-- section-summary: Registry identity protects the place where artifacts live, so production pulls from a known name, digest, and publishing path. -->

A **registry** is a storage service for artifacts. A container registry stores images, image tags, image manifests, signatures, and sometimes attestations. **Registry identity** means the release process uses a known registry host, repository name, image digest, and publisher identity. For Harbor Books, production should pull from `ghcr.io/harborbooks/checkout-api` by digest.

The registry is a trust boundary because production pulls from it. If many people and jobs can push to the same image name, the team has a weak point. Real teams usually restrict push access, use separate repositories or projects for different services, require CI identity for publishing, keep audit logs, and prefer immutable references in deployment files. Some registries also support tag immutability or retention rules, which help keep release history stable.

The image reference for this release should look like this:

```bash
ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

That reference includes the registry host, namespace, image name, and digest. During release review, the team can inspect the registry record:

```bash
docker buildx imagetools inspect ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

After pulling the image for local investigation, an engineer can inspect source labels:

```bash
docker pull ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
docker inspect ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6 \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

The label should print `7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20`. The team still relies on signatures, attestations, registry audit logs, and build records for stronger proof, because labels come from image metadata. Labels help connect the dots quickly during human debugging.

Registry identity connects artifact integrity to deployment. The image exists at a trusted name, with a known digest, and with publishing controls around it. Now production needs a gate that checks those facts before anything rolls out.

## Deployment Gates
<!-- section-summary: Deployment gates make production acceptance depend on evidence such as review, digest, signature, attestation, and approval records. -->

A **deployment gate** is a rule or approval step that decides whether an artifact may enter an environment. A simple gate might require one production approval. A stronger gate checks the artifact digest, verifies the signature, verifies the attestation, confirms the source branch, checks vulnerability policy, and records who approved the release. The gate turns delivery evidence into a production decision.

For Harbor Books, production release `prod-2026-06-21.3` should record the source and artifact together:

```yaml
service: checkout-api
environment: production
commit: 7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20
pull_request: 482
workflow: .github/workflows/release-checkout.yml
workflow_run: 9142337112
image: ghcr.io/harborbooks/checkout-api
digest: sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
signature_verified: true
attestation_verified: true
approved_by:
  - sasha.release
  - lina.platform
```

That record can live in a deployment system, a release repository, a change-management tool, or a signed release manifest. The format matters less than the facts. The release record gives responders a place to start when production behavior needs investigation.

The automated gate can verify the artifact before changing Kubernetes:

```bash
IMAGE="ghcr.io/harborbooks/checkout-api"
DIGEST="sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6"
REF="${IMAGE}@${DIGEST}"

gh attestation verify "oci://${REF}" \
  -R harborbooks/checkout-api

cosign verify \
  --certificate-identity "https://github.com/harborbooks/checkout-api/.github/workflows/release-checkout.yml@refs/heads/main" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "${REF}"

kubectl -n checkout set image deployment/checkout-api checkout-api="${REF}"
kubectl -n checkout annotate deployment/checkout-api \
  devpolaris.io/commit="7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20" \
  devpolaris.io/workflow-run="9142337112" \
  devpolaris.io/deployment-record="prod-2026-06-21.3"
```

The first verification checks the provenance attestation. The second verifies the Sigstore signature identity. The deployment command uses the digest reference, and the annotation stores release context on the Kubernetes Deployment. These commands show the shape of a practical first version. Many teams later move the same checks into a policy controller or admission controller so every deployment path uses the same rules.

Deployment gates also need rollback behavior. A rollback should choose a previous known-good digest, verify its signature and attestation again, record a new deployment event, and update Kubernetes to that digest. A rollback that uses a floating tag can reintroduce uncertainty. A rollback that uses a recorded digest gives the team the same trace path as a forward release.

Now production has accepted an artifact by digest. The final proof point checks what the runtime actually pulled and started.

## Runtime Provenance
<!-- section-summary: Runtime provenance compares the intended deployment record with the image and digest observed on running workloads. -->

**Runtime provenance** means evidence from the production platform about what is actually running. A deployment record says what should run. The runtime tells the team what the platform pulled and started. For `checkout-api`, Kubernetes can show the image configured on the Deployment and the image IDs reported by running Pods.

This is the moment where many teams find gaps. The release record says one digest, the Deployment template says another digest, and one old Pod may still be running from a previous rollout. Runtime checks catch those differences. They also help during incident response because responders can inspect production without rebuilding the story from memory.

Harbor Books can check the Deployment image like this:

```bash
kubectl -n checkout get deployment checkout-api \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="checkout-api")].image}{"\n"}'
```

The expected output is the digest reference:

```bash
ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

Then the team can inspect the running Pods:

```bash
kubectl -n checkout get pods -l app=checkout-api \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[?(@.name=="checkout-api")].imageID}{"\n"}{end}'
```

The `imageID` field is useful because it comes from the container runtime after the image is pulled. Depending on the runtime, it may include a digest-form reference such as `ghcr.io/harborbooks/checkout-api@sha256:...` or a runtime-specific prefix. The team compares that digest with the deployment record.

The application can also expose a `/version` endpoint:

```json
{
  "service": "checkout-api",
  "commit": "7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20",
  "imageDigest": "sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6",
  "deploymentRecord": "prod-2026-06-21.3"
}
```

That endpoint helps support engineers and dashboards. The platform evidence remains the stronger record because Kubernetes and the registry observed the artifact directly. A good production setup keeps both: the app reports version information for quick triage, and the deployment platform records the digest, annotations, events, and Pod status for audit.

Now we can trace the release from commit to runtime in one pass.

## Tracing One Release
<!-- section-summary: A practical trace follows the same identifiers through PR, build run, image digest, attestation, deployment record, and running Pods. -->

Imagine Sasha is on call for Harbor Books. A support ticket says expired coupons worked for a few customers after the June 21 release. Sasha needs to answer whether production is running Maya's intended fix, an older image, or something unexpected. The trace uses the same few identifiers from the release.

Sasha starts with the commit and pull request:

```bash
COMMIT="7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20"

gh pr list \
  --repo harborbooks/checkout-api \
  --state merged \
  --search "${COMMIT}" \
  --json number,title,author,mergedAt,mergedBy
```

The expected result points to PR `#482`, Maya as the author, and the expected merge actor. Sasha then checks the workflow run for the same commit:

```bash
gh run list \
  --repo harborbooks/checkout-api \
  --workflow release-checkout.yml \
  --commit "${COMMIT}" \
  --json databaseId,displayTitle,headSha,status,conclusion,createdAt

gh run view 9142337112 \
  --repo harborbooks/checkout-api \
  --json headSha,event,workflowName,conclusion,url
```

The build should have `headSha` equal to the commit SHA and `conclusion` equal to `success`. That connects review evidence to the build identity. Next, Sasha checks the artifact evidence:

```bash
IMAGE="ghcr.io/harborbooks/checkout-api"
DIGEST="sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6"
REF="${IMAGE}@${DIGEST}"

docker buildx imagetools inspect "${REF}"

gh attestation verify "oci://${REF}" \
  -R harborbooks/checkout-api

cosign verify \
  --certificate-identity "https://github.com/harborbooks/checkout-api/.github/workflows/release-checkout.yml@refs/heads/main" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  "${REF}"
```

Those checks connect the image digest to the expected build provenance and signature identity. Finally, Sasha checks production:

```bash
kubectl -n checkout get deployment checkout-api \
  -o jsonpath='{.metadata.annotations.devpolaris\.io/deployment-record}{"\n"}{.spec.template.spec.containers[?(@.name=="checkout-api")].image}{"\n"}'

kubectl -n checkout get pods -l app=checkout-api \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[?(@.name=="checkout-api")].imageID}{"\n"}{end}'
```

The first command should print `prod-2026-06-21.3` and the digest reference. The second should show every running `checkout-api` Pod using the same digest. If one Pod shows an older digest, Sasha has a rollout problem. If every Pod shows the expected digest, Sasha can move the investigation into application behavior, data, feature flags, or partner coupon configuration with much more confidence.

This trace is the practical heart of the delivery trust model. It uses a few stable identifiers and checks them at every handoff:

| Step | Evidence Sasha checks | Expected match |
|---|---|---|
| Source | Pull request `#482` | Head SHA equals `7c1a2ef...` |
| Review | Branch protection and approvals | Required reviewers and checks passed |
| Build | Workflow run `9142337112` | `headSha` equals `7c1a2ef...` |
| Artifact | Image digest | Digest equals `sha256:9f3e...` |
| Provenance | Attestation | Subject digest equals the image digest |
| Signature | cosign verification | Certificate identity equals the release workflow |
| Deployment | Production record | Commit and digest match the release |
| Runtime | Kubernetes Pod image IDs | Running Pods use the same digest |

The trace also shows why delivery security needs several records. Source control, CI, registry, signing, deployment, and runtime records all contribute one part of the answer.

## Putting It All Together
<!-- section-summary: A useful delivery trust model keeps a small set of stable identifiers and verifies them at every production handoff. -->

The whole model can fit into one production sentence: Harbor Books is running `checkout-api` from commit `7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20`, merged through PR `#482`, built by workflow run `9142337112`, published as `ghcr.io/harborbooks/checkout-api@sha256:9f3e...`, verified by attestation and signature, approved in deployment record `prod-2026-06-21.3`, and observed on Kubernetes Pods in the `checkout` namespace.

That sentence is long because production evidence has many parts. Real teams usually make it manageable by recording the same identifiers everywhere: commit SHA, pull request number, workflow run ID, image digest, attestation, signature identity, deployment record, and runtime observation. Dashboards can display them. Release records can store them. Incident response runbooks can trace them.

Here is a practical starter checklist for a team building this for the first time:

| Area | First useful control |
|---|---|
| Source | Require pull requests for production branches |
| Review | Use CODEOWNERS for sensitive code and workflow paths |
| Build | Record workflow run ID, commit SHA, and runner type |
| Identity | Prefer OIDC-based publishing over shared long-lived secrets |
| Artifact | Deploy by image digest |
| Provenance | Generate build provenance attestations |
| Signing | Verify the expected workflow identity before deployment |
| Registry | Restrict push access and keep registry audit logs |
| Deployment | Store commit, digest, approvers, and verification results |
| Runtime | Compare Pod image IDs with the approved digest |

This is also where the industry standards connect back to daily work. NIST SSDF gives the secure development practices, including protecting the build and preserving provenance. SLSA gives more detailed language for build integrity and provenance. Sigstore and GitHub Artifact Attestations give practical ways to attach proof to artifacts. Docker and OCI image digests give stable artifact names. Kubernetes gives runtime evidence that responders can compare to the release record.

CISA supply-chain compromise material is a useful reminder that attackers often look for trusted delivery paths. They may target source control, build systems, update channels, credentials, or artifact storage because those systems already have permission to reach production. A delivery trust model gives defenders evidence at each handoff, so a suspicious release can be traced and challenged quickly.

![Release evidence summary infographic showing commit SHA, PR review, workflow run, image digest, deployment record, and running pods connected to one approved release](/content-assets/articles/article-devsecops-security-foundations-security-mental-model-delivery-systems/release-evidence-summary.png)

*A useful release record stores the same few identifiers everywhere, so responders can compare the source, artifact, deployment, and runtime views.*

## What's Next

Now the delivery path has evidence. The next question is access: which humans, services, CI jobs, deployment systems, and runtime identities can perform each step, and which secrets or tokens make those actions possible. The next article moves into least privilege and secrets so the same release path has tighter control over who can change, build, publish, and deploy.

---

**References**

- [CISA: Supply Chain Compromise](https://www.cisa.gov/news-events/alerts/2021/01/07/supply-chain-compromise) - Official CISA alert material about a significant software supply-chain compromise and response guidance.
- [CISA: Defending Against Software Supply Chain Attacks](https://www.cisa.gov/resources-tools/resources/defending-against-software-supply-chain-attacks) - CISA guidance on software supply-chain attack patterns and defensive practices.
- [NIST SP 800-218: Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST's SSDF publication for secure software development practices.
- [SLSA: Build requirements](https://slsa.dev/spec/v1.2/requirements) - SLSA requirements for trusted build platforms and build integrity.
- [SLSA: Provenance](https://slsa.dev/spec/v1.0/provenance) - SLSA provenance format and the evidence fields used to describe artifact builds.
- [Sigstore cosign documentation](https://docs.sigstore.dev/cosign/) - Official cosign documentation for signing and verifying artifacts.
- [Sigstore keyless signing](https://docs.sigstore.dev/cosign/signing/signing_with_containers/) - Sigstore guidance for signing container images with cosign.
- [Docker: Image digests](https://docs.docker.com/dhi/core-concepts/digests/) - Docker documentation explaining image digests and immutable image references.
- [OCI Image Specification](https://github.com/opencontainers/image-spec/blob/main/descriptor.md) - OCI descriptor documentation for media types, sizes, and digests.
- [GitHub: About protected branches](https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) - GitHub documentation for branch protection controls.
- [GitHub: Using artifact attestations to establish provenance for builds](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds) - GitHub documentation for creating build provenance attestations.
- [GitHub: Verifying attestations offline](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations/verifying-attestations-offline) - GitHub documentation for verifying artifact attestations.
- [Kubernetes: Images](https://kubernetes.io/docs/concepts/containers/images/) - Kubernetes documentation for container image names, tags, digests, and image pulls.
