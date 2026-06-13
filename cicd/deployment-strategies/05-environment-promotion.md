---
title: "Environment Promotion"
description: "Enforce progressive quality gates and environment parity by promoting a single compiled artifact across staging and production."
overview: "Compiling source code multiple times for separate environments introduces dangerous version drift. Learn how to implement the Build Once, Run Everywhere golden rule, how to manage stateless applications by injecting credentials dynamically at runtime, and how to configure progressive promotion pipelines with manual and automated release gates."
tags: ["environment-promotion", "artifact-management", "progressive-delivery", "twelve-factor"]
order: 5
id: article-cicd-deployment-strategies-environment-promotion-and-release-gates
aliases:
  - /cicd/deployment-strategies/environment-promotion-and-release-gates
---

## Table of Contents

1. [Why Promotion Exists](#why-promotion-exists)
2. [Build Once, Promote the Same Artifact](#build-once-promote-the-same-artifact)
3. [Runtime Configuration](#runtime-configuration)
4. [Quality Gates](#quality-gates)
5. [Registry Promotion](#registry-promotion)
6. [Provenance and Traceability](#provenance-and-traceability)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Why Promotion Exists
<!-- section-summary: Environment promotion moves one proven artifact through checks instead of rebuilding different artifacts for each environment. -->

The earlier articles focused on how production traffic moves during a release. Rolling replaces instances gradually. Blue-green switches between environments. Canary sends a small slice of traffic to the new version. Before any of that happens, the team needs to answer a quieter question: what exactly are we deploying?

Imagine the checkout API passes tests in staging. The staging pipeline built image `checkout-api:staging-7421` from commit `8f3a12`. Later, the production pipeline builds again from the same branch and creates `checkout-api:prod-7421`. The names look related, but they came from two separate builds. The production build might pull a newer base image, a different package version, or a changed build argument. A release can fail even though "the same code" passed staging.

**Environment promotion** means the team builds one artifact, proves it in lower environments, and then promotes that exact artifact through staging, approval, and production. An artifact is the thing the runtime will execute: a container image, binary, package, serverless bundle, or static site bundle. Promotion moves trust and deployment intent forward while the compiled output stays the same.

This gives the release story a stable object. When someone asks what is running in production, the answer can be a digest, commit SHA, build run, provenance record, and deployment history. That makes rollback, audit, debugging, and compliance much cleaner.

The first rule is simple to say and very important in practice: build once, then promote the same artifact.

## Build Once, Promote the Same Artifact
<!-- section-summary: The same immutable artifact should move across environments so staging evidence applies to production. -->

**Build once, promote the same artifact** means the pipeline compiles and packages the application one time, then uses that exact output in each environment. For a containerized checkout API, the artifact should be addressed by an image digest such as `sha256:8f3a...`, rather than only by a mutable tag like `latest` or `prod`.

A **digest** is a content-based identifier. In OCI container images, descriptors include a digest that identifies the content. If the image changes, the digest changes. This gives deployment systems a stable way to say, "run this exact image."

Here is the shape:

| Stage | Action | Output |
|---|---|---|
| Build | Compile, test, package, scan | `checkout-api@sha256:8f3a...` |
| Dev deploy | Deploy same digest to dev | Dev evidence |
| Staging deploy | Deploy same digest to staging | Staging evidence |
| Production deploy | Deploy same digest to production | Production release |

![Environment promotion flow showing build once, same digest, dev, staging, approval, production, and no rebuild](/content-assets/articles/article-cicd-deployment-strategies-environment-promotion-and-release-gates/build-once-promotion-flow.png)

*Promotion keeps one built artifact moving forward, so staging evidence applies to the same digest that reaches production.*

The pipeline should pass the digest between jobs as data. Here is a simplified GitHub Actions example:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      image_digest: ${{ steps.build.outputs.digest }}
    steps:
      - uses: actions/checkout@v6
      - name: Build and push image
        id: build
        run: |
          ./scripts/build-image.sh checkout-api "$GITHUB_SHA"
          ./scripts/push-image.sh checkout-api "$GITHUB_SHA"
          ./scripts/print-image-digest.sh checkout-api "$GITHUB_SHA" >> "$GITHUB_OUTPUT"

  deploy_staging:
    needs: build
    environment: staging
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: ./scripts/deploy.sh staging "${{ needs.build.outputs.image_digest }}"

  deploy_production:
    needs: [build, deploy_staging]
    environment: production
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: ./scripts/deploy.sh production "${{ needs.build.outputs.image_digest }}"
```

The important detail is that production uses `needs.build.outputs.image_digest`. Production deploys the existing build output. The staging result means something because production receives the same artifact.

This rule creates the next question. If the image stays the same, how can dev, staging, and production use different databases, secrets, URLs, and feature flags? That is runtime configuration.

## Runtime Configuration
<!-- section-summary: Environment differences should come from runtime config and secrets, while the artifact stays unchanged. -->

**Runtime configuration** means values supplied when the application starts or runs, instead of values baked into the artifact during the build. Examples include database URLs, API keys, queue names, log levels, and feature flag keys.

The Twelve-Factor App describes config as something that should live in the environment. In daily engineering terms, the container image should know how to read `DATABASE_URL`; the environment decides what `DATABASE_URL` contains. Dev points to a dev database. Staging points to staging. Production points to production. The image stays identical.

Here is a small Kubernetes Deployment fragment:

```yaml
containers:
  - name: checkout-api
    image: registry.example.com/checkout-api@sha256:8f3a...
    env:
      - name: NODE_ENV
        value: production
      - name: DATABASE_URL
        valueFrom:
          secretKeyRef:
            name: checkout-api-secrets
            key: database-url
      - name: PAYMENTS_BASE_URL
        valueFrom:
          configMapKeyRef:
            name: checkout-api-config
            key: payments-base-url
```

This keeps secrets and environment-specific values out of the image. The same image can move from staging to production, while each environment injects its own secret and config sources.

![Runtime configuration boundary showing the same image receiving staging and production secrets, feature flags, and payment URLs at runtime](/content-assets/articles/article-cicd-deployment-strategies-environment-promotion-and-release-gates/runtime-config-boundary.png)

*The artifact stays the same; each environment supplies its own runtime config, secrets, feature flags, and external endpoints.*

Runtime config still needs discipline. A production deploy should record which config version was active, which feature flags were enabled, and which secret references the service used. A release can fail because config changed, even when the artifact stayed the same. Teams often treat config as its own reviewed change, with environment-level protection rules for production secrets.

Once the same artifact and runtime config boundary are clear, the pipeline can promote the artifact through gates.

## Quality Gates
<!-- section-summary: Gates decide whether the artifact has enough evidence to move to the next environment. -->

A **quality gate** is a check that must pass before the artifact moves forward. Some gates are automated, like unit tests or vulnerability scans. Some gates are manual, like production approval for a high-risk checkout change. The useful part is that the gate attaches evidence to one artifact.

For the checkout API, a promotion path can look like this:

| Gate | What it checks | Where it runs |
|---|---|---|
| Build gate | Unit tests, linting, type checks, image build | CI |
| Security gate | Dependency scan, container scan, secret scan | CI |
| Dev gate | Service starts and basic API smoke test passes | Dev |
| Staging gate | Integration tests, contract tests, synthetic checkout | Staging |
| Approval gate | Release owner or on-call approves production | Production environment |
| Production gate | Canary, health checks, metrics watch | Production |

GitHub Actions environments can hold environment secrets and require reviewers before a job targeting that environment proceeds. GitLab environments can track deployments, and GitLab deployment safety features can prevent outdated deployment jobs from rolling older code over newer deployments. Different platforms use different names, but the release idea stays the same: the production step has a clear gate.

Here is a compact GitHub Actions production job:

```yaml
deploy_production:
  needs: deploy_staging
  environment:
    name: production
    url: https://checkout.example.com
  concurrency:
    group: checkout-api-production
    cancel-in-progress: false
  steps:
    - uses: actions/checkout@v6
    - run: ./scripts/deploy.sh production "$IMAGE_DIGEST"
    - run: ./scripts/smoke-test.sh https://checkout.example.com
```

The `environment: production` line connects the job to production protection rules. The `concurrency` group prevents two production deploys for the same service from racing each other. The smoke test proves the service answers the main path after deployment.

Gates should produce visible evidence. A good release record says: artifact digest, commit, CI run, scan results, staging deployment, staging smoke test, approver, production deployment, and post-release checks. That evidence becomes very useful when rollback or audit questions appear later.

There is one more practical layer. Some teams promote the same image digest by copying it between registry locations or changing tags in a controlled way. That is registry promotion.

## Registry Promotion
<!-- section-summary: Registry promotion gives teams controlled names for the same digest without rebuilding the image. -->

An **artifact registry** stores built artifacts. For containers, that might be Amazon ECR, GitHub Container Registry, GitLab Container Registry, Docker Hub, JFrog Artifactory, or another registry. Registry promotion means the team marks the same digest as approved for a later environment.

There are two common patterns:

| Pattern | What changes | What stays stable |
|---|---|---|
| Same repository, environment tags | Tags such as `staging` and `production` move to the digest. | The digest identifies the exact image. |
| Separate repositories or registries | The digest gets copied from a build repo to an approved production repo. | The content digest and provenance stay tied to the build. |

Mutable tags can be convenient for humans, but deployment records should still store the digest. A tag like `production` can move. A digest points at content. If an incident starts, the team needs the digest to know exactly what is running.

A registry promotion script might do this:

```bash
IMAGE_DIGEST="sha256:8f3a..."
SOURCE="registry.example.com/build/checkout-api@$IMAGE_DIGEST"
TARGET="registry.example.com/prod/checkout-api:2026.06.13.2"

skopeo copy "docker://$SOURCE" "docker://$TARGET"
```

The exact tool can be Docker, Skopeo, Crane, cloud registry CLI, or a platform feature. The important rule is that promotion copies or labels the already-built artifact while source compilation stays in the build stage.

Registry promotion connects closely to supply chain security. The team wants to know who built the artifact, from which commit, with which workflow, and whether anyone changed it.

## Provenance and Traceability
<!-- section-summary: Provenance links the deployed artifact back to the build that produced it and the source commit it came from. -->

**Provenance** means evidence about where an artifact came from and how it was built. A provenance record can connect the checkout image to the repository, commit SHA, workflow run, builder, and build instructions. Artifact attestations and SLSA-style provenance help teams verify that production runs artifacts created by trusted pipelines.

This matters because environment promotion creates trust over time. Staging passed for digest `sha256:8f3a...`. Production approval applied to digest `sha256:8f3a...`. If someone can swap the image behind a tag, the evidence chain breaks. Provenance and digest-based deployment keep the chain intact.

A useful release record includes:

| Field | Example |
|---|---|
| Service | `checkout-api` |
| Artifact digest | `sha256:8f3a...` |
| Source commit | `8f3a12` |
| Build workflow | `github.com/acme/checkout/actions/runs/7421` |
| Attestation | Signed provenance attached to the artifact |
| Staging result | `passed synthetic checkout at 2026-06-13T10:15Z` |
| Production approver | `release-manager@example.com` |
| Production deployment | `deployment-20260613-1042` |

During an incident, this record answers fast questions. Which version changed? Which artifact should we roll back to? Did production rebuild anything? Did the artifact pass staging? Which person approved the gate?

Now the full promotion story is ready.

## Putting It All Together
<!-- section-summary: Promotion gives every deployment pattern a stable, traceable artifact to release and recover. -->

The checkout team commits code at SHA `8f3a12`. CI builds one container image, scans it, tests it, signs or attests it, and stores digest `sha256:8f3a...` in the release record. Dev deploys that digest. Staging deploys that digest with staging config and runs integration tests plus synthetic checkout. Production receives the same digest after the approval gate.

Runtime configuration supplies the environment differences. Production database credentials and staging URLs stay outside the artifact. Each environment injects its own secrets and config at runtime, and the release record keeps track of which config version went with the deployment.

The production deployment can then use rolling, blue-green, or canary. Those strategies decide how traffic moves. Environment promotion decides what artifact moves. When a release fails, rollback can return to a known previous digest, and responders can see exactly which build and gate produced it.

![Promotion traceability summary showing commit, build, digest, staging pass, approval, production, and release record](/content-assets/articles/article-cicd-deployment-strategies-environment-promotion-and-release-gates/promotion-traceability-summary.png)

*A promotion record connects the deployed version back to its commit, build, digest, staging result, approval, and production deployment.*

## What's Next
<!-- section-summary: Deployment runbooks turn the release process into repeatable operations that humans and automation can follow under pressure. -->

The final article in this module covers **deployment runbooks**. We will take the promotion path, gates, rollback decision, smoke tests, and production watch window and turn them into a repeatable runbook that a team can execute without guessing.

---

**References**

- [OCI image descriptor specification](https://github.com/opencontainers/image-spec/blob/main/descriptor.md) - Defines descriptors, including media type, digest, and size for OCI content.
- [The Twelve-Factor App: Config](https://12factor.net/config) - Explains storing configuration in the environment rather than baking environment-specific values into code.
- [GitHub Actions environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) - Documents environment secrets, protection rules, deployment branches, and environment settings.
- [GitHub Actions reviewing deployments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments) - Shows approval and rejection flow for jobs waiting on deployment review.
- [GitLab deployment safety](https://docs.gitlab.com/ci/environments/deployment_safety/) - Documents deployment safety controls such as preventing outdated deployment jobs.
- [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) - Defines provenance fields that describe how an artifact was built.
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) - Explains signed build provenance and integrity claims for artifacts.
