---
title: "Environment Promotion"
description: "Enforce progressive quality gates and environment parity by promoting a single compiled artifact across staging and production."
overview: "Rebuilding for each environment breaks the evidence chain. Learn how one immutable artifact accumulates evidence through risk zones while runtime configuration, gates, registry boundaries, provenance, parity, and authorization remain traceable."
tags: ["environment-promotion", "artifact-management", "quality-gates", "provenance"]
order: 5
id: article-cicd-deployment-strategies-environment-promotion-and-release-gates
aliases:
  - /cicd/deployment-strategies/environment-promotion-and-release-gates
---

## Table of Contents

1. [Why Are Environments Different Risk Zones?](#why-are-environments-different-risk-zones)
2. [Why Must One Immutable Artifact Move Forward?](#why-must-one-immutable-artifact-move-forward)
3. [How Does Runtime Configuration Stay Separate from the Artifact?](#how-does-runtime-configuration-stay-separate-from-the-artifact)
4. [How Do Quality Gates Promote Evidence?](#how-do-quality-gates-promote-evidence)
5. [How Do Registry Boundaries, Provenance, and Traceability Promote without Rebuilding?](#how-do-registry-boundaries-provenance-and-traceability-promote-without-rebuilding)
6. [How Much Environment Parity Does Evidence Require?](#how-much-environment-parity-does-evidence-require)
7. [Why Must Artifact Creation Be Separate from Production Authorization?](#why-must-artifact-creation-be-separate-from-production-authorization)
8. [How Do Promotion and Recovery Complete the Release Flow?](#how-do-promotion-and-recovery-complete-the-release-flow)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

The earlier articles focused on how production traffic moves during a release. Rolling replaces instances gradually. Blue-green switches between environments. Canary sends a small slice of traffic to the new version. Before any of that happens, the team needs to answer a quieter question: what exactly are we deploying?

Imagine an application service passes tests in staging. The staging pipeline built image `service:staging-7421` from commit `8f3a12`. Later, the production pipeline builds again from the same branch and creates `service:prod-7421`. The names look related, but they came from two separate builds. The production build might pull a newer base image, a different package version, or a changed build argument. A release can fail even though "the same code" passed staging.

**Environment promotion** means the team builds one artifact, proves it in lower environments, and then promotes that exact artifact through staging, approval, and production. An artifact is the thing the runtime will execute: a container image, binary, package, serverless bundle, or static site bundle. Promotion moves trust and deployment intent forward while the compiled output stays the same.

The object being promoted stays the same; what changes is the environment-specific configuration, accumulated evidence, and authority to expose it to greater production risk.

Keep these questions in view as you work through the lesson:

1. **Why Are Environments Different Risk Zones?**
2. **Why Must One Immutable Artifact Move Forward?**
3. **How Does Runtime Configuration Stay Separate from the Artifact?**
4. **How Do Quality Gates Promote Evidence?**
5. **How Do Registry Boundaries, Provenance, and Traceability Promote without Rebuilding?**
6. **How Much Environment Parity Does Evidence Require?**
7. **Why Must Artifact Creation Be Separate from Production Authorization?**
8. **How Do Promotion and Recovery Complete the Release Flow?**

## Why Are Environments Different Risk Zones?
<!-- section-summary: Environment promotion moves one proven artifact through checks instead of rebuilding different artifacts for each environment. -->

The immutable artifact gives the release story a stable object. When someone asks what is running in production, the answer can be a digest, commit SHA, build run, provenance record, and deployment history. That makes rollback, audit, debugging, and compliance much cleaner.

The first rule is simple to say and very important in practice: build once, then promote the same artifact.

The real problem is uncertainty. A source commit does not prove the resulting binary works, a passing build does not prove it can start with deployment configuration, and a healthy staging instance does not prove it is authorized or safe for production. Promotion reduces uncertainty in controlled risk zones.

Development, test, staging, and production are not merely different names for servers. They carry different data sensitivity, user impact, access authority, scale, and operational consequence. Failure in an isolated test environment is cheap; failure in production can affect users and irreversible business state. Evidence and authorization should grow with risk.

Promotion is not rebuilding. If each environment compiles its own output, the process creates several siblings that may differ through base images, dependency resolution, toolchains, flags, timestamps, or registry state. Staging then proves one artifact while production executes another. The chain of evidence is broken even when both builds started from the same commit.

## Why Must One Immutable Artifact Move Forward?
<!-- section-summary: The same immutable artifact should move across environments so staging evidence applies to production. -->

**Build once, promote the same artifact** means the pipeline compiles and packages the application one time, then uses that exact output in each environment. For a containerized application service, the artifact should be addressed by an image digest such as `sha256:8f3a...`, rather than only by a mutable tag like `latest` or `prod`.

A **digest** is a content-based identifier. In OCI container images, descriptors include a digest that identifies the content. If the image changes, the digest changes. This gives deployment systems a stable way to say, "run this exact image."

Artifact identity matters because a source revision is not the runtime object. The build process contributes compilers, dependencies, operating-system layers, generated assets, and packaging behavior. Record both source and artifact identity. The statement “staging passed digest ABC” is stronger than “staging tested the main branch.”

Here is the shape:

| Stage | Action | Output |
|---|---|---|
| Build | Compile, test, package, scan | `service@sha256:8f3a...` |
| Dev deploy | Deploy same digest to dev | Dev evidence |
| Staging deploy | Deploy same digest to staging | Staging evidence |
| Production deploy | Deploy same digest to production | Production release |

![Environment promotion flow showing build once, same digest, dev, staging, approval, production, and no rebuild](/content-assets/articles/article-cicd-deployment-strategies-environment-promotion-and-release-gates/build-once-promotion-flow.png)

*Promotion keeps one built artifact moving forward, so staging evidence applies to the same digest that reaches production.*

The pipeline should pass the immutable identifier between stages as data:

```yaml
build:
  output: artifact_digest
deploy_dev:
  input: artifact_digest
deploy_staging:
  input: artifact_digest
  requires: dev_evidence
deploy_production:
  input: artifact_digest
  requires: staging_evidence_and_approval
```

The important detail is that every environment consumes the same recorded digest. Production deploys the existing build output. The staging result means something because production receives the exact artifact staging evaluated.

This rule creates the next question. If the image stays the same, how can dev, staging, and production use different databases, secrets, URLs, and feature flags? That is runtime configuration.

Promotion really promotes evidence attached to the artifact. The bytes do not become better by moving between registries. Confidence grows because the same bytes accumulate build results, scans, lower-environment behavior, staging integration evidence, and authorization. Any mutation of the artifact invalidates evidence that referred to the earlier content.

## How Does Runtime Configuration Stay Separate from the Artifact?
<!-- section-summary: Environment differences should come from runtime config and secrets, while the artifact stays unchanged. -->

**Runtime configuration** means values supplied when the application starts or runs, instead of values baked into the artifact during the build. Examples include database URLs, API keys, queue names, log levels, and feature flag keys.

In practical terms, the container image should know how to read `DATABASE_URL`; the environment decides what `DATABASE_URL` contains. Dev points to a dev database. Staging points to staging. Production points to production. The image stays identical.

Here is a small Kubernetes Deployment fragment:

```yaml
containers:
  - name: service
    image: registry.example.com/service@sha256:8f3a...
    env:
      - name: NODE_ENV
        value: production
      - name: DATABASE_URL
        valueFrom:
          secretKeyRef:
            name: service-secrets
            key: database-url
      - name: DEPENDENCY_BASE_URL
        valueFrom:
          configMapKeyRef:
            name: service-config
            key: dependency-base-url
```

This keeps secrets and environment-specific values out of the image. The same image can move from staging to production, while each environment injects its own secret and config sources.

![Runtime configuration boundary showing the same image receiving staging and production secrets, feature flags, and dependency URLs at runtime](/content-assets/articles/article-cicd-deployment-strategies-environment-promotion-and-release-gates/runtime-config-boundary.png)

*The artifact stays the same; each environment supplies its own runtime config, secrets, feature flags, and external endpoints.*

Runtime config still needs discipline. A production deploy should record which config version was active, which feature flags were enabled, and which secret references the service used. A release can fail because config changed, even when the artifact stayed the same. Teams often treat config as its own reviewed change, with environment-level protection rules for production secrets.

Artifact and configuration form the deployed release together. The artifact says what executable code exists. Configuration selects environment-specific dependencies, limits, flags, and identities. Keeping them separate allows the same executable to move, but configuration still needs versioning, review, validation, and traceability.

Build-time environment configuration defeats promotion. If staging runs `build --environment=staging` and production runs `build --environment=production`, the process generates different bundles. Staging can no longer prove the production binary. Prefer a runtime lookup, startup configuration file, or deploy-time environment injection that does not change artifact content.

Not every difference can be removed from runtime, and secrets should never be baked into a broadly promoted artifact. Record config revision and secret references beside the digest so responders can distinguish “new code” from “new environment input” during an incident.

Once the same artifact and runtime config boundary are clear, the pipeline can promote the artifact through gates.

## How Do Quality Gates Promote Evidence?
<!-- section-summary: Gates decide whether the artifact has enough evidence to move to the next environment. -->

A **quality gate** is a check that must pass before the artifact moves forward. Some gates are automated, like unit tests or vulnerability scans. Some gates are manual, like production approval for a high-risk service change. The useful part is that the gate attaches evidence to one artifact.

For an application service, a promotion path can look like this:

| Gate | What it checks | Where it runs |
|---|---|---|
| Build gate | Unit tests, linting, type checks, image build | CI |
| Security gate | Dependency scan, container scan, secret scan | CI |
| Dev gate | Service starts and basic API smoke test passes | Dev |
| Staging gate | Integration tests, contract tests, synthetic transaction | Staging |
| Approval gate | Release owner or on-call approves production | Production environment |
| Production gate | Canary, health checks, metrics watch | Production |

The delivery platform may implement gates with protected environments, approval services, policy engines, or pipeline conditions. The release idea stays the same: production authorization attaches to an identified artifact and rejects stale or superseded deployment work.

A compact controller-neutral production gate looks like this:

```yaml
production_gate:
  artifact: "sha256:8f3a..."
  requires:
    - staging_deployment_healthy
    - contract_tests_passed
    - security_policy_passed
    - production_approval_recorded
  concurrency: one_release_per_service
```

The gate prevents two production deploys for the same service from racing and requires evidence before authorization. Post-deployment checks still prove the main path after the artifact enters production.

Gates should produce visible evidence. A good release record says: artifact digest, commit, CI run, scan results, staging deployment, staging smoke test, approver, production deployment, and post-release checks. That evidence helps when rollback or audit questions appear later.

Promotion should be monotonic in confidence: each stage adds relevant evidence without changing the subject being evaluated or silently discarding earlier results. A unit-test pass remains useful in staging; staging adds integration and environment evidence; production approval adds authorization; progressive release adds real-traffic evidence.

Quality gates are policy, not ceremony. A gate should name the risk it controls, the evidence it consumes, the threshold or decision authority, the artifact it applies to, and what happens on failure or missing data. A button that everyone clicks automatically does not reduce uncertainty.

Higher-risk environments usually require stronger evidence. Development may accept build and smoke results. Staging may require integration, migration, load, security, and rollback tests. Production may add separation of duties, a change window, approval, artifact allowlisting, and post-release gates.

Manual approval is also a gate. Its value comes from a person checking release context that automation cannot fully decide: timing, incident state, business readiness, or coordinated dependencies. Record who approved which digest and evidence set. Approval of “the latest build” is ambiguous if that name can move.

All gate results attach to artifact identity. If a newer build appears, it starts its own evidence chain. A deployment queue should not let an older approved job overwrite a newer production release merely because it finally resumed.

There is one more practical layer. Some teams promote the same image digest by copying it between registry locations or changing tags in a controlled way. That is registry promotion.

## How Do Registry Boundaries, Provenance, and Traceability Promote without Rebuilding?
<!-- section-summary: Registry promotion gives teams controlled names for the same digest without rebuilding the image. -->

An **artifact registry** stores built artifacts. Registry promotion means the team marks or copies the same content digest into a location authorized for a later environment.

There are two common patterns:

| Pattern | What changes | What stays stable |
|---|---|---|
| Same repository, environment tags | Tags such as `staging` and `production` move to the digest. | The digest identifies the exact image. |
| Separate repositories or registries | The digest gets copied from a build repo to an approved production repo. | The content digest and provenance stay tied to the build. |

Mutable tags can be convenient for humans, but deployment records should still store the digest. A tag like `production` can move. A digest points at content. If an incident starts, the team needs the digest to know exactly what is running.

Promotion by tagging can add human names such as `staging-approved` or `production`, all pointing at the same digest. The tag is a reference, not immutable proof. Protect tag mutation, retain the digest in every deployment record, and never infer that current tag content is what ran historically.

Separate registry or repository boundaries can enforce authorization. The build identity writes candidate storage, a staging promotion identity copies verified content into staging-approved storage, and a narrower production service moves only policy-approved digests into production storage. Application developers need not receive direct production-registry write access.

This makes promotion a security boundary as well as a quality process. Creation and authorization use different identities. A compromised build job should not be able to label its own untested output as production-approved, and a production deploy job should not compile arbitrary source.

Registry boundaries can also express monotonic trust. Candidate storage may accept frequent builds. Staging storage accepts only content whose automated gates passed. Production storage accepts only an existing staging digest plus production authorization. The content remains identical while write permissions and policy become narrower. Copy operations should verify the resulting digest rather than trusting that a transfer command preserved the intended object.

Mutable names remain useful as discovery pointers, but they must never become the sole evidence. If `production` points to ABC today and DEF tomorrow, a historical record saying only “deployed production” is meaningless. Store digest, source registry or repository, destination, promotion identity, policy result, and time for every movement.

Promotion by boundary also prevents lower environments from pulling production-only content accidentally when the organization's policy requires stricter separation. The access design should still allow rollback to approved earlier digests without giving general build jobs production write permission.

Record negative policy results too. A rejected artifact, missing staging result, invalid origin, or unauthorized promotion attempt explains why content did not move and helps distinguish policy protection from platform failure. Evidence chains include blocked transitions as well as successful ones.

A registry promotion operation can be expressed as:

```bash
source = candidate/service@sha256:8f3a...
target = production/service@sha256:8f3a...
copy verified content without rebuilding
```

The important rule is that promotion copies or labels the already-built content while source compilation stays in the build stage.

Registry promotion connects closely to supply chain security. The team wants to know who built the artifact, from which commit, with which workflow, and whether anyone changed it.

<!-- section-summary: Provenance links the deployed artifact back to the build that produced it and the source commit it came from. -->

**Provenance** means evidence about where an artifact came from and how it was built. A provenance record can connect the image to the repository, commit SHA, build identity, builder, toolchain, dependencies, and instructions. Production policy can then verify that the artifact came from the expected creation path.

This matters because environment promotion creates trust over time. Staging passed for digest `sha256:8f3a...`. Production approval applied to digest `sha256:8f3a...`. If someone can swap the image behind a tag, the evidence chain breaks. Provenance and digest-based deployment keep the chain intact.

A useful release record includes:

| Field | Example |
|---|---|
| Service | `service` |
| Artifact digest | `sha256:8f3a...` |
| Source commit | `8f3a12` |
| Build workflow | `build-run-7421` |
| Build evidence | Toolchain, dependencies, tests, and scan results |
| Staging result | `passed synthetic transaction at 2026-06-13T10:15Z` |
| Production approver | `release-manager@example.com` |
| Production deployment | `deployment-20260613-1042` |

During an incident, this record answers fast questions. Which version changed? Which artifact should we roll back to? Did production rebuild anything? Did the artifact pass staging? Which person approved the gate?

Provenance matters operationally beyond audit. If a vulnerable dependency is discovered, build records can identify which artifacts contain it and where those artifacts run. During an outage, responders can compare artifact and configuration revisions precisely instead of asking what someone deployed that afternoon.

Traceability creates a chain of custody:

```text
source commit
  -> build identity and toolchain
  -> artifact digest
  -> test and security evidence
  -> staging deployment and results
  -> production authorization
  -> production deployment and release signals
```

The environment itself should also be traceable. Record runtime versions, topology, dependency versions, policy, configuration revision, and scale characteristics that affect what lower-environment evidence means.

## How Much Environment Parity Does Evidence Require?
<!-- section-summary: Lower environments should reproduce the production properties relevant to the risks being tested, without pretending every scale and data detail can be identical. -->

Environment parity determines how much evidence transfers. If staging uses a different database major version, one instance instead of a large fleet, no network proxy, weaker identity, or different feature flags, a staging pass may not address production's failure modes.

Promotion does not require literal identity. Production may have more capacity, real regulated data, stricter access control, and integrations that cannot be duplicated safely. The goal is **risk-relevant parity**: match the versions, protocols, topology, configuration semantics, and policies needed to test the claim being made. Document unavoidable differences and cover them with other evidence.

“It worked in staging” is incomplete without “what did staging represent?” A performance result from a tiny environment, a migration test on an empty database, or an authorization check using administrator credentials can be true and still provide weak production evidence.

Production can itself be another promotion stage. Progressive traffic, shadow evaluation, or a limited cohort adds evidence unavailable elsewhere. Deployment places the artifact into production capacity; release controls whether and how users encounter it. Keeping those concepts separate lets production evidence grow without rebuilding.

Database migrations follow their own compatible sequence. Promote an artifact that can operate with the current shared state, expand schemas before dependence, and contract only after every rollback version is retired. Promote the artifact, not a snapshot of an entire lower environment with its data and secrets.

## Why Must Artifact Creation Be Separate from Production Authorization?
<!-- section-summary: A build system should create candidate content, while an independent policy and identity decide whether that content may enter production. -->

Immutable infrastructure strengthens promotion because instances are created from versioned images and configuration instead of being changed manually in place. Replacing a runtime with artifact ABC is easier to trace than copying files into a server whose earlier state is unknown.

Creation and authorization are different powers. The build system needs to read source, resolve dependencies, and write candidate artifacts. The promotion system needs to verify evidence and copy or authorize an existing digest. The production deployment identity needs to select an approved digest and change runtime state. Separating these capabilities limits what one compromised stage can do.

The weakest promotion process says “deploy whatever the branch currently builds” in each environment. The strongest mental model says “this immutable digest, produced by this trusted build, has accumulated this evidence and is now authorized by this policy for this risk zone.”

Security, quality, and audit therefore meet at the same object. Permissions control who may create, promote, and deploy. Gates control evidence. Provenance controls origin. The digest ensures all decisions refer to unchanged content.

Now the full promotion story is ready.

## How Do Promotion and Recovery Complete the Release Flow?
<!-- section-summary: Promotion gives every deployment pattern a stable, traceable artifact to release and recover. -->

The service team commits code at SHA `8f3a12`. CI builds one container image, scans and tests it, records its provenance, and stores digest `sha256:8f3a...` in the release record. Dev deploys that digest. Staging deploys that digest with staging config and runs integration tests plus a synthetic transaction. Production receives the same digest after the approval gate.

Runtime configuration supplies the environment differences. Production database credentials and staging URLs stay outside the artifact. Each environment injects its own secrets and config at runtime, and the release record keeps track of which config version went with the deployment.

The production deployment can then use rolling, blue-green, or canary. Those strategies decide how traffic moves. Environment promotion decides what artifact moves. When a release fails, rollback can return to a known previous digest, and responders can see exactly which build and gate produced it.

The complete flow is creation, automated validation, deployment into a lower risk zone, staging promotion, production authorization, production promotion, and result recording. At every step, record the same digest plus newly accumulated evidence. A failure prevents forward movement without destroying the earlier approved state.

Step by step, the build stage compiles, packages, tests, scans, records dependencies and toolchain, publishes candidate content, and returns the digest. Automated validation checks the artifact without changing it. Development deployment proves basic runtime and configuration interfaces. Staging adds representative integration, migration, performance, recovery, and operational evidence.

The production approval stage receives the digest, release notes, staging result, known environment differences, data risk, and recovery plan. It creates authorization for that artifact, not for a branch name or whatever is newest later. Production promotion then copies or selects the already-approved digest through a narrower identity and records config revision and desired runtime state.

After deployment, rolling, blue-green, or canary logic controls exposure and collects production evidence. The final record marks whether the release was accepted, held, rolled back, or replaced. The same artifact history remains queryable after tags move and pipelines finish.

This protects against several common failures: staging testing different bytes; production configuration baked into a separate build; untested code reaching production; a mutable tag being overwritten; unknown artifact origin; and responders being unable to identify current production state. Promotion cannot prove correctness, but it makes the subject and evidence unambiguous.

![Promotion traceability summary showing commit, build, digest, staging pass, approval, production, and release record](/content-assets/articles/article-cicd-deployment-strategies-environment-promotion-and-release-gates/promotion-traceability-summary.png)

*A promotion record connects the deployed version back to its commit, build, digest, staging result, approval, and production deployment.*

<!-- section-summary: Promotion creates an ordered history of approved immutable artifacts, giving recovery a known previous digest and fixes a new evidence chain. -->

Rollback selects a previous promoted artifact whose compatibility window remains open. Because its digest, configuration record, gates, and production history are known, responders can distinguish “return to artifact AAA” from “rebuild old source and hope it matches.” Promotion does not guarantee state reversibility, so database and message compatibility still decide whether AAA can run.

Roll-forward creates artifact CCC from a fix and starts a new evidence chain. Urgency may compress the number or duration of gates, but the team should not silently mutate artifact BBB or reuse BBB's approval. The new digest needs evidence proportional to the recovery risk.

A first-principles expression is:

```text
promotion confidence
  = artifact identity
  + relevant evidence
  + environment representativeness
  + explicit authorization
  + traceable result
```

These terms do not form a literal numeric score. The equation is a review checklist: changing the artifact invalidates its evidence; weak parity limits transfer; missing authorization blocks the risk-zone transition; and missing records make recovery uncertain.

The strongest promotion system also prevents accidental backward movement. If production already runs digest CCC, an older paused job for BBB should not resume and overwrite it unless an explicit rollback decision authorizes BBB. Compare expected current state before applying the change, serialize release operations, and distinguish normal promotion from recovery.

Promotion protects roll-forward as well as rollback. A hotfix creates a new immutable artifact and can follow an accelerated but explicit evidence path. Responders still know which subject was tested and approved. Reusing a mutable tag or editing a running environment may look faster, but it destroys the traceability needed to know whether recovery succeeded.

## Check Your Answers

:::expand[Why Are Environments Different Risk Zones?]{kind="recap"}
Each environment carries different user impact, data, authority, scale, and consequence. Promotion reduces uncertainty as one artifact crosses those zones. Rebuilding at each stage creates a different subject and breaks the claim that staging proved production bytes.
:::

:::expand[Why Must One Immutable Artifact Move Forward?]{kind="recap"}
The runtime artifact includes build inputs beyond source. A digest identifies exact content. Build once, record source and build identity, then pass the same digest through environments so every test, scan, approval, deployment, and rollback refers to unchanged bytes.
:::

:::expand[How Does Runtime Configuration Stay Separate from the Artifact?]{kind="recap"}
The artifact defines executable behavior; each environment injects database addresses, secrets, endpoints, flags, and limits at runtime. Version and review configuration separately. Building environment-specific bundles creates different artifacts and invalidates promotion evidence.
:::

:::expand[How Do Quality Gates Promote Evidence?]{kind="recap"}
Each gate adds evidence to one digest: build quality, security, lower-environment health, integration behavior, approval, and production observation. Gates should express risk policy, attach to immutable identity, fail on missing requirements, and prevent stale releases from overtaking newer state.
:::

:::expand[How Do Registry Boundaries, Provenance, and Traceability Promote without Rebuilding?]{kind="recap"}
Tags provide movable human names; digests preserve identity. Promotion can retag the same digest or copy verified content into staging and production boundaries. Separate identities for building, promoting, and deploying prevent one compromised stage from self-authorizing untested output.

Trace source, builder, toolchain, dependencies, digest, tests, scans, staging, approval, production, and configuration. This chain answers origin, vulnerability impact, current state, and recovery questions. Record environment properties too, because they bound what lower-stage evidence represents.
:::

:::expand[How Much Environment Parity Does Evidence Require?]{kind="recap"}
Lower environments need risk-relevant parity in versions, protocols, topology, configuration semantics, identities, and policy. They need not copy production scale or sensitive data exactly. Document differences and avoid claiming that weak staging tests prove risks they did not reproduce.
:::

:::expand[Why Must Artifact Creation Be Separate from Production Authorization?]{kind="recap"}
The build creates candidate bytes. Promotion verifies evidence and authorizes an existing digest. Production deployment changes runtime state using only approved content. Separating those capabilities joins quality, supply-chain integrity, audit, and least privilege around one immutable object.
:::

:::expand[How Do Promotion and Recovery Complete the Release Flow?]{kind="recap"}
Build once, validate automatically, deploy the same digest to lower zones, accumulate staging evidence, authorize production, deploy without rebuilding, and record the result. Traffic strategy then controls release exposure while promotion controls artifact identity and evidence.

Rollback selects a known previous promoted digest if shared state remains compatible. Roll-forward creates a new digest and new evidence chain. Confidence depends on immutable identity, relevant evidence, representative environments, explicit authorization, and a traceable result.
:::

## References
