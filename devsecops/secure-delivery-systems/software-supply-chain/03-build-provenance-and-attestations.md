---
title: "Build Provenance and Attestations"
description: "Connect a registry artifact to the source repo, commit, workflow, builder, inputs, and digest that produced it."
overview: "After an SBOM tells you what is inside an artifact, build provenance tells you where the artifact came from and how it was produced. This article follows one container release through in-toto attestations, SLSA provenance fields, GitHub artifact attestations, storage choices, and verification checks."
tags: ["devsecops", "provenance", "attestations", "slsa"]
order: 3
id: article-devsecops-software-supply-chain-build-provenance-attestations
---

## Table of Contents

1. [Why Provenance Comes After the SBOM](#why-provenance-comes-after-the-sbom)
2. [The Release Scenario](#the-release-scenario)
3. [What Provenance Means](#what-provenance-means)
4. [What an Attestation Adds](#what-an-attestation-adds)
5. [The in-toto Statement Shape](#the-in-toto-statement-shape)
6. [SLSA Provenance Fields](#slsa-provenance-fields)
7. [Builder Identity and Source Revision](#builder-identity-and-source-revision)
8. [Subjects, Digests, and Registry Reality](#subjects-digests-and-registry-reality)
9. [Creating GitHub Artifact Attestations](#creating-github-artifact-attestations)
10. [Storing Attestations](#storing-attestations)
11. [Verifying Provenance Before Deployment](#verifying-provenance-before-deployment)
12. [Operational Review Checklist](#operational-review-checklist)
13. [What's Next](#whats-next)

In the last article, the team learned how to create an **SBOM**, which is the inventory of software components inside an artifact. That is a huge step, because now a security engineer can answer questions like "does this image contain the vulnerable version of OpenSSL?" or "which services ship this npm package?" Inventory gives the team a list of ingredients.

The next question comes from the release side. A container image shows up in the registry with a tag that says `refund-worker-v1.18.0`. The SBOM can tell us what packages went into the image, but the team still needs proof that this exact image came from the expected repository, the expected commit, the expected workflow, and the expected build system. That proof is **build provenance**, and the signed record carrying that proof is an **attestation**.

## Why Provenance Comes After the SBOM
<!-- section-summary: An SBOM explains what is inside the artifact, while provenance explains where that exact artifact came from and how the build produced it. -->

Let's stay with one production team so the ideas have a place to land. AtlasPay runs a small payment platform, and one service handles refund jobs in the background. The service lives in `github.com/atlaspay/refund-worker`, builds into a container image, and deploys from `ghcr.io/atlaspay/refund-worker`.

The security team already asked for SBOMs. That helped them answer vulnerability questions faster, because every release had a package inventory. Then one Friday afternoon, a release manager sees a new image digest in the registry and asks a different question: "Who built this, from which commit, and through which workflow?"

That question matters because modern delivery has many moving parts. A developer pushes source code. GitHub Actions starts a workflow. The workflow checks out code, installs tools, builds a container, pushes the image, and writes metadata. A deployment system later pulls the image by digest and sends it to production. Every step can be legitimate, misconfigured, or compromised.

**Provenance** gives the release manager a machine-readable build story for one artifact. It connects the artifact in the registry to source control, the build definition, the build platform, the inputs, and the output digest. The key detail is the exact artifact, because a tag can move, while a cryptographic digest identifies one concrete image.

So the SBOM answers "what is inside this image?" Provenance answers "which process produced this image?" Those two records belong together, because a strong supply-chain review needs both the ingredients and the route through the build system.

## The Release Scenario
<!-- section-summary: The article follows one container release so each concept maps to a concrete artifact, workflow, and verification gate. -->

AtlasPay has a normal release path for the refund worker. Engineers merge code into `main`, tests run, a release tag gets created, and GitHub Actions builds a container image. The image gets pushed to GitHub Container Registry under a human-friendly tag like `refund-worker-v1.18.0`, and the deployment tool eventually deploys the image by digest.

The team wants to trust only images that match this expected path. The image should come from the `atlaspay/refund-worker` repository. The source revision should point at the commit that passed review. The build should run through `.github/workflows/release.yml`, because that workflow uses the hardened container build process. The builder should be GitHub Actions or an approved reusable workflow owned by the platform team.

Here is the kind of evidence the team wants for one release:

| Question | Evidence the team wants |
|---|---|
| Which artifact are we talking about? | `ghcr.io/atlaspay/refund-worker@sha256:...` |
| Which source produced it? | `github.com/atlaspay/refund-worker` at one commit SHA |
| Which workflow produced it? | `.github/workflows/release.yml` from the same repo |
| Which builder ran it? | A trusted GitHub Actions builder or platform-owned reusable workflow |
| Which inputs went into it? | Source commit, workflow file, build parameters, and dependencies recorded by the builder |
| Who can verify it later? | CI, deployment gates, incident responders, and auditors |

This is the practical reason provenance matters. The team wants deployment to accept a release from the normal path and stop a release that came from a local laptop build, a forked workflow, a registry push with a stolen token, or a tag that someone moved after the fact. The rest of the article walks through the pieces that make this check possible.

![Build evidence chain infographic showing source repo, workflow, builder, image digest, and attestation connected to commit, run, digest, and policy evidence](/content-assets/articles/article-devsecops-software-supply-chain-build-provenance-attestations/build-evidence-chain.png)

*Provenance turns a release into a chain of evidence that connects the source repo, workflow, builder, image digest, and signed attestation.*

## What Provenance Means
<!-- section-summary: Provenance is a structured record of the source, builder, inputs, and output for one build result. -->

**Build provenance** is a record that explains how an artifact was produced. In simple terms, it says: this output came from this source, at this revision, through this build definition, on this builder, with these inputs. For AtlasPay, the output is the refund worker container image digest.

You can think of provenance as the production receipt for a build. A shopping receipt lists the store, time, items, and total. Build provenance lists the source repository, commit, workflow, builder, parameters, and resulting artifact digest. The receipt comparison helps at first, but the real value comes from machine checks: software can verify provenance before the artifact reaches production.

Before teams used structured provenance, release evidence often lived in release notes, build logs, Slack messages, or artifact names. A tag like `refund-worker-v1.18.0` gives a useful human label, and provenance supplies the exact commit and build path behind that label. A build log may show useful details, but logs expire, get truncated, or live in a system that a deployment gate cannot easily query.

Structured provenance solves that by putting the important build facts into a standard shape. The verifier can compare those facts against policy. For example, the policy can require the source repo to equal `atlaspay/refund-worker`, the source ref to equal `refs/heads/main` or a release tag, the workflow path to equal `.github/workflows/release.yml`, and the subject digest to equal the image digest being deployed.

Here is the production habit that matters: provenance should describe the artifact as built, then verification should decide whether that artifact meets policy. The builder records facts. The verifier enforces trust. Keeping those jobs separate helps teams review the build system without mixing every security rule into the build script itself.

## What an Attestation Adds
<!-- section-summary: An attestation wraps a claim about an artifact with identity and signature evidence so another system can verify who made the claim. -->

An **attestation** is a signed claim about an artifact. The claim might say "this image has this SLSA provenance," "this file has this SBOM," or "this binary passed this vulnerability scan." The signature and identity information help another system decide whether the claim came from a trusted producer.

For AtlasPay, the claim is about the refund worker image digest. The attestation says the image digest came from a GitHub Actions workflow in the expected repository. The verifier checks the signature, checks the identity that signed it, and then checks the provenance fields inside the claim.

This is where provenance moves from a nice record to something a deployment gate can enforce. A JSON file sitting beside an image can help a human investigate, but a signed attestation lets CI ask stronger questions. Did the trusted build system create this statement? Does the subject digest match the artifact we plan to deploy? Does the statement name the source repo and workflow we expect?

Many modern systems use **Sigstore** for this identity and signing layer. Sigstore supports keyless signing, where the build uses an OpenID Connect identity from the CI platform instead of a long-lived private key stored as a secret. GitHub artifact attestations use GitHub Actions identity with Sigstore-backed signing so the verifier can connect the attestation to a workflow identity.

This design reduces the need to manage a permanent signing key inside every application repo. The build job receives a short-lived identity token, the signing system binds that identity into the attestation, and later verification checks the identity details. The next article goes deeper into artifact signing, but for provenance the important idea is simple: the build facts need a trustworthy envelope around them.

## The in-toto Statement Shape
<!-- section-summary: in-toto provides the common envelope that binds an artifact subject to a typed predicate such as SLSA provenance. -->

**in-toto attestations** give teams a standard way to express signed supply-chain claims. The in-toto project defines a **Statement**, which has a subject and a predicate. The subject is the artifact the claim talks about. The predicate is the typed body of the claim, such as SLSA provenance or an SBOM reference.

This subject-and-predicate pattern keeps the format flexible. The same envelope can carry different evidence types, and each evidence type gets its own predicate schema. For the refund worker, one in-toto statement can carry SLSA build provenance, while another statement can carry an SBOM predicate for the same image digest.

A simplified in-toto statement for AtlasPay can look like this:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    {
      "name": "ghcr.io/atlaspay/refund-worker",
      "digest": {
        "sha256": "8b3c2c9f4b9a7d2f6a2f5c1d0e7a9f4e6c2a0b9d8f7e6a5b4c3d2e1f0a9b8c7d"
      }
    }
  ],
  "predicateType": "https://slsa.dev/provenance/v1",
  "predicate": {
    "buildDefinition": {
      "buildType": "https://github.com/actions/workflow",
      "externalParameters": {
        "repository": "https://github.com/atlaspay/refund-worker",
        "ref": "refs/tags/refund-worker-v1.18.0",
        "workflow": ".github/workflows/release.yml"
      },
      "resolvedDependencies": [
        {
          "uri": "git+https://github.com/atlaspay/refund-worker",
          "digest": {
            "gitCommit": "6b1f4a8f3a7e2c9d0b5a4c3e2f1a9b8c7d6e5f4a"
          }
        }
      ]
    },
    "runDetails": {
      "builder": {
        "id": "https://github.com/actions/runner"
      },
      "metadata": {
        "invocationId": "https://github.com/atlaspay/refund-worker/actions/runs/1234567890"
      }
    }
  }
}
```

This example shows the shape without pretending that every tool emits the exact same values. The subject names the artifact and digest. The `predicateType` says the predicate follows the SLSA provenance schema. The predicate then carries build details such as the build type, external parameters, resolved source commit, builder identity, and workflow run.

![Attestation anatomy infographic showing an in-toto statement split into subject, predicate type, and SLSA predicate, with artifact digest, build definition, builder, and source commit callouts](/content-assets/articles/article-devsecops-software-supply-chain-build-provenance-attestations/attestation-anatomy.png)

*An attestation wraps the artifact subject and the SLSA provenance predicate inside one signed claim that another system can verify.*

The important production review starts at the subject. The attestation must talk about the same digest the deployment wants to pull. If the deployment uses `ghcr.io/atlaspay/refund-worker@sha256:8b3c...`, the subject digest inside the statement needs to match that digest. A perfect-looking provenance statement for a different digest gives you evidence about a different artifact.

## SLSA Provenance Fields
<!-- section-summary: SLSA provenance gives common names to the build facts a verifier needs, including subject, build definition, source, builder, and run metadata. -->

**SLSA** stands for Supply-chain Levels for Software Artifacts. It is a supply-chain security framework that defines practices for building and verifying software artifacts. One important part of SLSA is the provenance schema, which gives teams a shared vocabulary for build evidence.

The SLSA provenance format has two big areas. **`buildDefinition`** describes what the builder was asked to build. **`runDetails`** describes the actual build run. That split matters because the requested build and the completed build answer different questions.

For AtlasPay, the build definition can include the release workflow, the source repository, the ref, build inputs, build type, and resolved dependencies. If the workflow builds from a tag, the provenance should still point back to the exact commit that tag resolved to. If the workflow accepts parameters, those parameters belong in the build definition because they may change what the build produces.

The run details can include the builder identity, run metadata, timestamps, and byproducts. The builder identity tells the verifier which build platform claims to have produced the artifact. The invocation ID can point to the workflow run, which helps incident responders connect the attestation to logs and approvals.

Here is the SLSA field map that a beginner should keep nearby:

| Field area | Simple meaning | AtlasPay review question |
|---|---|---|
| **Statement subject** | The artifact the statement talks about | Does this digest equal the image digest being deployed? |
| **`predicateType`** | The schema used by the predicate | Does this claim use SLSA provenance? |
| **`buildDefinition.buildType`** | The kind of build process | Did the approved workflow or reusable build type produce it? |
| **`buildDefinition.externalParameters`** | Inputs controlled outside the builder | Which repo, ref, workflow, tag, and build arguments started the build? |
| **`buildDefinition.resolvedDependencies`** | Inputs resolved during the build | Which exact commit and dependency sources did the build use? |
| **`runDetails.builder.id`** | The build platform identity | Did a trusted builder produce this evidence? |
| **`runDetails.metadata.invocationId`** | The build run identity | Can we connect this attestation to a workflow run for review? |

SLSA provenance gives the verifier the facts needed to make a trust decision. A strong policy then says which repos, refs, workflows, builders, and artifact names the organization accepts. The schema supplies evidence, and the organization's policy decides trust.

That last point explains why teams usually start with a narrow policy. AtlasPay trusts the release workflow for the refund worker, plus a small set of platform-owned reusable workflows. Narrow trust keeps the verification rule understandable.

## Builder Identity and Source Revision
<!-- section-summary: The two most important provenance facts are the trusted builder that created the record and the exact source revision that went into the artifact. -->

Two fields carry most of the security weight in day-to-day provenance checks: **builder identity** and **source revision**. The builder identity answers "which build system produced this evidence?" The source revision answers "which exact code did that builder use?"

The builder matters because build systems have different trust levels. A GitHub-hosted runner in the expected repository, an organization-controlled reusable workflow, and a developer laptop all represent very different security stories. The verifier should accept only the builders that the organization has reviewed.

AtlasPay's platform team handles this by owning a reusable release workflow in `atlaspay/build-platform`. Application teams call that workflow instead of copying build steps into every repo. The reusable workflow pins important actions, builds containers in a controlled way, generates provenance, and publishes attestations. Application repos still own their source code, but the build machinery comes from a smaller, reviewed place.

The source revision matters because branches and tags can move. A human may say "this came from `main`," but `main` names a moving branch. A Git commit SHA names one snapshot of the source tree. The provenance should record the resolved commit, and verification should compare that commit with the commit approved by the release process.

A release review often follows this shape:

```bash
export IMAGE="ghcr.io/atlaspay/refund-worker"
export IMAGE_DIGEST="sha256:8b3c2c9f4b9a7d2f6a2f5c1d0e7a9f4e6c2a0b9d8f7e6a5b4c3d2e1f0a9b8c7d"
export EXPECTED_COMMIT="6b1f4a8f3a7e2c9d0b5a4c3e2f1a9b8c7d6e5f4a"

git -C refund-worker merge-base --is-ancestor "$EXPECTED_COMMIT" origin/main
gh run view 1234567890 --repo atlaspay/refund-worker
gh attestation verify "oci://$IMAGE@$IMAGE_DIGEST" \
  --repo atlaspay/refund-worker \
  --source-digest "$EXPECTED_COMMIT" \
  --source-ref refs/tags/refund-worker-v1.18.0 \
  --signer-workflow atlaspay/refund-worker/.github/workflows/release.yml
```

The first command checks that the expected commit lives in the main branch history. The second command lets the reviewer inspect the workflow run tied to the release. The third command asks GitHub CLI to verify the attestation for the container image and check the expected source digest, source ref, repository, and signer workflow.

Production teams usually automate these checks instead of relying on a person to type them for every release. The deployment gate can receive the image digest, fetch or verify the attestation, and reject the deployment when the repository, commit, ref, workflow, or builder identity falls outside policy. Human review still helps during exceptions, but normal releases should follow the same machine check every time.

## Subjects, Digests, and Registry Reality
<!-- section-summary: The subject digest ties the attestation to one artifact, while tags and names serve as helpful labels around that digest. -->

The **subject** is the artifact the attestation talks about. For a container image, the subject usually includes a name such as `ghcr.io/atlaspay/refund-worker` and a digest such as `sha256:8b3c...`. The digest matters because it is calculated from the image content.

Container tags help humans and workflows. `refund-worker-v1.18.0` is easy to read in a release note, and `staging` may help a test environment pull the latest staging build. Tags also act like pointers, and registries usually allow a tag to point to a different digest later.

That is why deployment systems should promote and deploy by digest. A digest pins the exact image. If AtlasPay approves `ghcr.io/atlaspay/refund-worker@sha256:8b3c...`, production should deploy that digest, and the attestation subject should carry that same digest.

The difference shows up in a normal release:

```bash
docker buildx imagetools inspect ghcr.io/atlaspay/refund-worker:refund-worker-v1.18.0
```

The output includes the digest behind the tag. The team stores that digest in the release record, verifies the attestation for that digest, and passes the digest to the deployment system. Kubernetes manifests, Helm values, Terraform variables, or Argo CD parameters can all carry the digest depending on the platform.

Here is a simple deployment value file:

```yaml
image:
  repository: ghcr.io/atlaspay/refund-worker
  tag: refund-worker-v1.18.0
  digest: sha256:8b3c2c9f4b9a7d2f6a2f5c1d0e7a9f4e6c2a0b9d8f7e6a5b4c3d2e1f0a9b8c7d
```

The tag remains useful for humans, and the digest gives the deployment a stable artifact identity. The attestation verification should use the digest. The release notes can include both so developers can read the version and automation can verify the exact bytes.

## Creating GitHub Artifact Attestations
<!-- section-summary: GitHub Actions can generate provenance attestations during a build by using workflow identity, artifact permissions, and the artifact digest. -->

**GitHub artifact attestations** let a workflow create signed provenance for artifacts that it builds. In GitHub Actions, the job needs permission to request an OIDC identity token and permission to write attestations. For container images, the job also needs permission to push the image to the registry.

AtlasPay starts with one release workflow in the application repo. The workflow builds and pushes the image, captures the image digest from the build step, and then creates an attestation for that digest. A readable first version can look like this:

```yaml
name: Release refund worker

on:
  push:
    tags:
      - "refund-worker-v*"

permissions:
  contents: read
  packages: write
  id-token: write
  attestations: write
  artifact-metadata: write

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: atlaspay/refund-worker

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.ref_name }}

      - uses: actions/attest@v4
        with:
          subject-name: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          subject-digest: ${{ steps.build.outputs.digest }}
          push-to-registry: true
```

The build step pushes the image and exposes the digest as an output. The attestation step uses the image name and digest as the subject, then publishes the attestation so later tools can find it. The `id-token: write` permission allows the job to use GitHub's OIDC identity for signing, and `attestations: write` allows the job to create the attestation record.

In a mature setup, AtlasPay would make this workflow stricter. The team would pin third-party actions to full commit SHAs, require protected tags or protected branches, use a reusable workflow from the platform team, and require code owner review for workflow changes. The attestation tells the verifier which workflow ran, so protecting the workflow file matters as much as protecting application code.

The organization can also separate the application repo from the build policy. The application repo calls a reusable workflow like this:

```yaml
name: Release refund worker

on:
  push:
    tags:
      - "refund-worker-v*"

permissions:
  contents: read
  packages: write
  id-token: write
  attestations: write
  artifact-metadata: write

jobs:
  release:
    uses: atlaspay/build-platform/.github/workflows/container-release.yml@3f4e2d1c9b8a7f6e5d4c3b2a1908172635443321
    with:
      image-name: ghcr.io/atlaspay/refund-worker
      dockerfile: ./Dockerfile
```

This pattern gives application teams a simple release interface while the platform team owns the hardened implementation. The provenance still points to the application source, and the signer workflow or builder identity can point to the approved build workflow. That gives deployment policy a stable thing to trust.

## Storing Attestations
<!-- section-summary: Attestations need durable storage near the artifact or in a platform attestation service so CI, deployments, and audits can find them later. -->

Generating an attestation during the build helps only if another system can find it later. That means storage is part of the design. A build log may mention the digest and workflow run, but the deployment gate needs a durable lookup path.

GitHub artifact attestations can live in GitHub's attestation service and, for container images, can also be pushed to the OCI registry with the image when `push-to-registry: true` is set. The registry path is useful because the evidence travels close to the artifact. A verifier can ask for the attestation associated with `ghcr.io/atlaspay/refund-worker@sha256:...` instead of hunting through old workflow runs.

Some teams also keep an internal release record. AtlasPay writes the image name, digest, commit SHA, workflow run URL, SBOM location, and attestation verification result into a release database. That database helps incident response because responders can start from a production image digest and quickly find the source commit, SBOM, and provenance evidence.

For open source or public workflows, transparency logs can add another durable record. Sigstore's public transparency log, Rekor, records signing events so later verifiers can detect unexpected signing history. GitHub uses Sigstore technology for artifact attestations, and the exact transparency behavior depends on the repository visibility and GitHub's attestation implementation.

The storage rule is simple in production terms: the attestation should outlive the build job. The team should know where to fetch it during deployment, during a rollback, during an audit, and during an incident. If the only copy lives in a temporary workspace directory, the verification story will fail exactly when people need it.

## Verifying Provenance Before Deployment
<!-- section-summary: Verification checks both the attestation signature and the provenance policy before an artifact reaches production. -->

Verification has two layers. The first layer checks the attestation itself: signature, certificate identity, transparency information where available, and subject digest. The second layer checks the build facts against AtlasPay policy: source repository, source commit, ref, signer workflow, builder identity, and artifact name.

GitHub CLI can verify GitHub artifact attestations for files and OCI images. A human reviewer can start with a command like this:

```bash
export IMAGE="ghcr.io/atlaspay/refund-worker"
export IMAGE_DIGEST="sha256:8b3c2c9f4b9a7d2f6a2f5c1d0e7a9f4e6c2a0b9d8f7e6a5b4c3d2e1f0a9b8c7d"

gh attestation verify "oci://$IMAGE@$IMAGE_DIGEST" \
  --repo atlaspay/refund-worker \
  --signer-workflow atlaspay/refund-worker/.github/workflows/release.yml \
  --source-ref refs/tags/refund-worker-v1.18.0 \
  --format json > verified-attestation.json
```

The command verifies the attestation for the exact OCI image digest. The repository flag tells GitHub which repository should own the attestation. The signer workflow and source ref flags make the check narrower, which helps prevent an unrelated workflow from satisfying the release policy.

The JSON output can feed a policy script. A small gate might check the predicate type, subject digest, source repository, source ref, and invocation URL before deployment:

```bash
export EXPECTED_DIGEST="8b3c2c9f4b9a7d2f6a2f5c1d0e7a9f4e6c2a0b9d8f7e6a5b4c3d2e1f0a9b8c7d"
export EXPECTED_REPO="https://github.com/atlaspay/refund-worker"
export EXPECTED_REF="refs/tags/refund-worker-v1.18.0"

jq -e '
  .[0].verificationResult.statement as $statement
  | $statement.predicateType == "https://slsa.dev/provenance/v1"
  and $statement.subject[0].digest.sha256 == env.EXPECTED_DIGEST
  and $statement.predicate.buildDefinition.externalParameters.repository == env.EXPECTED_REPO
  and $statement.predicate.buildDefinition.externalParameters.ref == env.EXPECTED_REF
' verified-attestation.json
```

Real deployment gates usually use a policy engine or platform integration instead of a short `jq` script. The script still shows the heart of the check: the deployment should compare the artifact digest and provenance fields against explicit expectations. A green signature check tells you who signed the claim, and a green policy check tells you the claim matches your release rules.

One GitHub-specific detail deserves attention. GitHub's verification documentation explains that some attestation values come from the workflow environment, while the signing certificate and verified timestamps come from the signing system. That means a team should protect workflow files, pin or approve reusable workflows, and give signer identity special weight in the policy.

## Operational Review Checklist
<!-- section-summary: A practical provenance program turns the format into repeatable release, review, and incident-response checks. -->

A production team should translate provenance into a small set of checks that everyone understands. AtlasPay writes those checks into the release pipeline and also keeps them in the incident runbook. That way the same evidence supports normal deployment and urgent investigation.

The first check is **artifact identity**. The image digest in the deployment request must match the subject digest inside the attestation. The deployment system should pass the digest to the verifier, because resolving a tag inside the verifier can hide tag movement.

The second check is **trusted source**. The provenance should point to `github.com/atlaspay/refund-worker`, and the commit should match the release record. If the release comes from a branch, the commit should have passed branch protection and review. If the release comes from a tag, the tag should follow the organization's protected tag rules.

The third check is **trusted build path**. The signer workflow should equal the approved release workflow or an approved platform reusable workflow. Workflow file changes should require code owner review because workflow changes can change the build and the attestation that the build emits.

The fourth check is **trusted builder**. The builder identity should match the build platform the organization accepts for this artifact. For GitHub Actions, that usually means trusting GitHub's workflow identity plus organization controls around the workflow. For another build system, the same idea applies: choose the builder identity in advance, then verify it for every release.

The fifth check is **durable evidence**. The team should be able to fetch the attestation, SBOM, workflow run, and release record from stable locations. If an incident responder starts from the production image digest, they should quickly find the source commit, workflow run, package inventory, and verification result.

A simple review table can keep those checks visible:

| Check | Expected value for `refund-worker-v1.18.0` | Evidence |
|---|---|---|
| Subject digest | `sha256:8b3c...` | Attestation subject and registry digest |
| Source repository | `https://github.com/atlaspay/refund-worker` | SLSA `externalParameters` or verified GitHub fields |
| Source revision | `6b1f4a8...` | SLSA resolved dependency and release record |
| Source ref | `refs/tags/refund-worker-v1.18.0` | SLSA external parameters and GitHub verification |
| Signer workflow | `.github/workflows/release.yml` or approved reusable workflow | GitHub attestation certificate identity |
| Builder identity | Approved GitHub Actions or platform builder | SLSA `runDetails.builder.id` and verification policy |
| Storage | GitHub attestation service, OCI registry, release record | Deployment gate and incident runbook |

This checklist also helps when something fails. If the digest mismatches, the team has an artifact substitution problem. If the repo or workflow mismatches, the team has a build path problem. If the attestation lookup fails, the team has a storage or publication problem. Each failure points to a different owner and a different fix.

![Provenance gate infographic showing a deployment request, attestation, and image digest checked against digest, repo, workflow, commit, and builder policy before allow or block](/content-assets/articles/article-devsecops-software-supply-chain-build-provenance-attestations/provenance-gate.png)

*A provenance gate compares the artifact digest and build evidence with release policy, then allows the deployment only when the trusted path matches.*

## What's Next

Provenance gives the team a signed record of where an artifact came from and how the build produced it. That record lets deployment systems compare a registry digest against the expected repository, commit, workflow, builder, and inputs.

The next article moves one step closer to enforcement. It covers **artifact signing and verification**, where the team verifies the artifact identity itself, connects signatures to trusted identities, and decides how registries, deployment controllers, and admission policies should accept or reject releases.

---

**References**

- [SLSA Build Provenance v1.2](https://slsa.dev/spec/v1.2/build-provenance) - Defines the SLSA provenance predicate, including build definition, run details, builder identity, and metadata.
- [SLSA Verifying Artifacts v1.2](https://slsa.dev/spec/v1.2/verifying-artifacts) - Explains the verification flow for provenance, source, builder, dependencies, and artifact identity.
- [in-toto Attestation Framework](https://github.com/in-toto/attestation/blob/main/spec/README.md) - Defines the in-toto Statement model with subjects, predicate type, and predicate body.
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) - Describes GitHub artifact attestations and how they help establish where and how software was built.
- [Using artifact attestations to establish provenance for builds](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds) - Shows GitHub Actions workflows for generating build provenance.
- [actions/attest](https://github.com/actions/attest) - Documents the GitHub Action used to create artifact attestations from workflow runs.
- [GitHub CLI `gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify) - Documents command-line verification for files and OCI images, including repository, source, and signer workflow checks.
- [Sigstore signing overview](https://docs.sigstore.dev/cosign/signing/overview/) - Explains keyless signing, identity-based certificates, and transparency log concepts used by modern artifact signing workflows.
