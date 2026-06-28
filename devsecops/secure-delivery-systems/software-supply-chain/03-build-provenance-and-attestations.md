---
title: "Build Provenance and Attestations"
description: "Connect a registry artifact to the source repository, commit, workflow, builder, subjects, digests, and signed attestations that produced it."
overview: "After SBOM inventory tells Harbor Books what is inside an artifact, build provenance tells the team how that artifact was made. Follow one checkout image through provenance, in-toto statements, SLSA fields, GitHub artifact attestations, storage, and verification."
tags: ["devsecops", "provenance", "attestations", "slsa"]
order: 3
id: article-devsecops-software-supply-chain-build-provenance-attestations
---

## Table of Contents

1. [The Build Receipt Question](#the-build-receipt-question)
2. [Inventory and Provenance](#inventory-and-provenance)
3. [What Provenance Means](#what-provenance-means)
4. [What an Attestation Adds](#what-an-attestation-adds)
5. [The in-toto Statement Shape](#the-in-toto-statement-shape)
6. [SLSA Provenance Fields](#slsa-provenance-fields)
7. [Builder Identity and Source Revision](#builder-identity-and-source-revision)
8. [Subjects and Digests](#subjects-and-digests)
9. [GitHub Artifact Attestations](#github-artifact-attestations)
10. [Storing Attestations](#storing-attestations)
11. [Verification Before Deployment](#verification-before-deployment)
12. [Operational Checklist](#operational-checklist)
13. [What's Next](#whats-next)
14. [References](#references)

## The Build Receipt Question
<!-- section-summary: After the SBOM inventory answers what is inside an artifact, provenance answers how that exact artifact was built. -->

The SBOM inventory gave Harbor Books a component list. During an advisory, the team can ask which deployed images contain a vulnerable package and which owners need to respond. That solves the ingredient question for a release artifact.

The next question comes from the release path. A new image digest appears in the registry for `checkout-api`. The SBOM says what is inside that image. The release manager still needs the receipt: which repository produced it, which commit was checked out, which workflow ran, which builder created the image, and which digest came out?

Inventory says what is inside; provenance says how the artifact was made. **Build provenance** is the structured build receipt for one artifact. **An attestation** is the signed claim that carries that receipt so another system can verify it later.

This article follows one Harbor Books image:

```bash
ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

The digest after `@` names exact image content. The provenance should describe how that digest was produced. The verifier should then compare the provenance against Harbor Books policy before deployment.

## Inventory and Provenance
<!-- section-summary: SBOMs and provenance answer different questions about the same artifact digest. -->

An **SBOM** answers component inventory questions. It can tell Harbor Books that `checkout-api` image digest `sha256:9f3e...` contains packages such as `@harbor/coupon-rules`, a Node runtime, Linux packages, and application files. That helps vulnerability and license work.

**Provenance** answers build origin questions. It should tell Harbor Books that the same digest came from `github.com/harborbooks/checkout-api`, commit `7c1a2ef...`, workflow `.github/workflows/release-checkout.yml`, and an approved GitHub Actions build path. That helps release verification and incident response.

The two records belong together:

| Question | Evidence |
|---|---|
| What packages and files are inside this image? | SBOM |
| Which source repository and commit produced it? | Provenance |
| Which workflow and builder ran? | Provenance |
| Which digest do the records describe? | SBOM subject and provenance subject |
| Can production trust the release path? | Verification policy over the attestation |

This connection is important during an incident. If production runs a digest that has an SBOM but no provenance, the team knows what is inside but lacks the build receipt. If the image has provenance but no SBOM, the team can verify where it came from but lacks component inventory. A strong release record stores both for the same digest.

## What Provenance Means
<!-- section-summary: Build provenance records the source, build definition, builder, inputs, run metadata, and output digest for one artifact. -->

**Build provenance** is a structured record of how an artifact was produced. In plain English, it says: this output digest came from this source, at this revision, through this build definition, on this builder, with these inputs and run details.

For Harbor Books, provenance should answer:

| Provenance question | `checkout-api` answer |
|---|---|
| Which artifact was produced? | `ghcr.io/harborbooks/checkout-api@sha256:9f3e...` |
| Which source repository was used? | `https://github.com/harborbooks/checkout-api` |
| Which source revision was used? | Commit `7c1a2ef4b49b...` |
| Which workflow ran? | `.github/workflows/release-checkout.yml` |
| Which builder ran it? | Approved GitHub Actions release builder |
| Which run can humans inspect? | Workflow run URL or invocation ID |

Before structured provenance, this evidence often lived in release notes, CI logs, Slack messages, or image tags. Those places help humans, but deployment gates need machine-readable evidence. A tag such as `checkout-api-2026.06.21` is readable. The digest and provenance record give automation the exact artifact and build facts.

Provenance records facts. Verification policy decides trust. The builder should record what happened during the build. The deployment gate should compare those facts with Harbor Books rules: expected repository, expected workflow, expected source ref, approved builder, and matching digest.

## What an Attestation Adds
<!-- section-summary: An attestation wraps a claim about an artifact with signature and identity evidence so verifiers can trust the claim source. -->

An **attestation** is a signed claim about an artifact. The claim might carry SLSA build provenance, an SBOM reference, a vulnerability scan result, or a test result. The signature and identity information help another system decide whether the claim came from a trusted producer.

For `checkout-api`, the attestation says the image digest came from the expected release workflow. The verifier checks the signature, checks the signer identity, checks that the attestation subject equals the digest being deployed, and then checks the provenance fields inside the claim.

This is the point where a build receipt can become a deployment control. A JSON file stored in a workspace can help a human investigation. A signed attestation can let CI or a cluster admission policy ask stronger questions:

| Verification question | Why the attestation helps |
|---|---|
| Did a trusted identity create this claim? | The signature and certificate identify the signer |
| Does the claim describe this exact artifact? | The subject includes the digest |
| Does the claim carry SLSA provenance? | The predicate type names the schema |
| Does the provenance match policy? | The predicate records source, workflow, builder, and run details |

Many modern systems use **Sigstore** for the signing and identity layer. With keyless signing, the build uses a short-lived OpenID Connect identity from the CI platform instead of a long-lived private key stored in repository secrets. GitHub artifact attestations use GitHub Actions identity and Sigstore-backed signing so verification can connect the attestation to a workflow identity.

The next section shows the common envelope that carries these claims.

## The in-toto Statement Shape
<!-- section-summary: in-toto gives attestations a common subject-and-predicate envelope for supply-chain claims. -->

**in-toto attestations** provide a standard envelope for supply-chain claims. The central object is an **in-toto Statement**. A statement has a **subject**, a **predicate type**, and a **predicate**.

The **subject** is the artifact the claim describes. The **predicate type** says what kind of claim is inside, such as SLSA provenance. The **predicate** is the structured body that follows that schema. This shape lets different evidence types use the same envelope.

A simplified in-toto statement for `checkout-api` can look like this:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    {
      "name": "ghcr.io/harborbooks/checkout-api",
      "digest": {
        "sha256": "9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6"
      }
    }
  ],
  "predicateType": "https://slsa.dev/provenance/v1",
  "predicate": {
    "buildDefinition": {
      "buildType": "https://github.com/actions/workflow",
      "externalParameters": {
        "repository": "https://github.com/harborbooks/checkout-api",
        "ref": "refs/heads/main",
        "workflow": ".github/workflows/release-checkout.yml"
      },
      "resolvedDependencies": [
        {
          "uri": "git+https://github.com/harborbooks/checkout-api",
          "digest": {
            "gitCommit": "7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20"
          }
        }
      ]
    },
    "runDetails": {
      "builder": {
        "id": "https://github.com/actions/runner"
      },
      "metadata": {
        "invocationId": "https://github.com/harborbooks/checkout-api/actions/runs/9142337112"
      }
    }
  }
}
```

This example shows the shape rather than every field a real tool may emit. The subject names the image digest. `predicateType` declares SLSA provenance. `buildDefinition` records the requested build inputs. `runDetails` records the builder and run identity.

![Attestation anatomy infographic showing an in-toto statement split into subject, predicate type, and SLSA predicate, with artifact digest, build definition, builder, and source commit callouts](/content-assets/articles/article-devsecops-software-supply-chain-build-provenance-attestations/attestation-anatomy.png)

*An attestation connects the artifact subject to a typed SLSA provenance predicate inside one signed claim.*

The first production check is the subject. If deployment wants `sha256:9f3e...`, the statement subject should carry that same digest.

## SLSA Provenance Fields
<!-- section-summary: SLSA gives common names to provenance fields such as subject, build definition, source, builder, and run metadata. -->

**SLSA** stands for Supply-chain Levels for Software Artifacts. It is a framework for improving software build and release integrity. The SLSA provenance schema gives teams a shared vocabulary for build evidence.

The SLSA provenance predicate has two major areas. **`buildDefinition`** describes what the builder was asked to build. **`runDetails`** describes the build run that happened. Harbor Books can use both to decide whether a release came from the approved path.

| Field area | Plain meaning | Harbor Books policy question |
|---|---|---|
| Statement subject | The artifact the statement describes | Does it match the image digest being deployed? |
| `predicateType` | The schema used by the predicate | Is this SLSA provenance? |
| `buildDefinition.buildType` | The kind of build process | Did the approved workflow type run? |
| `buildDefinition.externalParameters` | Inputs controlled outside the builder | Which repo, ref, workflow, and build arguments started the run? |
| `buildDefinition.resolvedDependencies` | Inputs resolved during the build | Which exact source commit did the build use? |
| `runDetails.builder.id` | The build platform identity | Did an approved builder create the artifact? |
| `runDetails.metadata.invocationId` | The build run identity | Can responders find the workflow run? |

SLSA provenance gives the facts. Harbor Books policy gives the rule. A policy can require the source repository to equal `harborbooks/checkout-api`, the source ref to equal `refs/heads/main` or a protected release tag, the workflow path to equal `.github/workflows/release-checkout.yml`, and the subject digest to equal the image digest in the deployment request.

The two fields teams usually inspect first are builder identity and source revision.

## Builder Identity and Source Revision
<!-- section-summary: Builder identity names the trusted build system, and source revision names the exact code snapshot used by that builder. -->

**Builder identity** answers "which build system created this artifact and attestation?" A GitHub-hosted runner in the expected repository, a platform-owned reusable workflow, and a developer laptop represent different trust stories. Harbor Books should accept only builders it has reviewed.

**Source revision** answers "which exact code snapshot did the builder use?" Branch names and tags can point to different commits over time. A full commit SHA names one source snapshot. Provenance should record the resolved commit, and verification should compare it with the commit approved by the release process.

Harbor Books uses a platform-owned reusable workflow for container releases. Application repositories call it, while the platform team owns the hardened build implementation. That gives every application a smaller release interface and gives the verifier a stable workflow identity to trust.

```yaml
name: release-checkout

on:
  push:
    branches:
      - main

permissions:
  contents: read
  packages: write
  id-token: write
  attestations: write

jobs:
  release:
    uses: harborbooks/build-platform/.github/workflows/container-release.yml@3f4e2d1c9b8a7f6e5d4c3b2a1908172635443321
    with:
      image-name: ghcr.io/harborbooks/checkout-api
      dockerfile: ./Dockerfile
```

The `uses` line pins the reusable workflow to a commit SHA. `id-token: write` allows keyless signing or attestation identity. `attestations: write` allows GitHub Actions to create artifact attestations. `packages: write` allows the workflow to push the image.

During verification, the deployment gate should compare the attested source revision with the release record:

```bash
EXPECTED_COMMIT="7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20"
IMAGE="ghcr.io/harborbooks/checkout-api"
DIGEST="sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6"

gh attestation verify "oci://${IMAGE}@${DIGEST}" \
  --repo harborbooks/checkout-api \
  --source-digest "$EXPECTED_COMMIT" \
  --signer-workflow harborbooks/checkout-api/.github/workflows/release-checkout.yml
```

`EXPECTED_COMMIT` is the source SHA approved by review. The `gh attestation verify` command checks the attestation for the OCI image digest and narrows verification to the expected repository, source digest, and signer workflow.

## Subjects and Digests
<!-- section-summary: The attestation subject must match the exact artifact digest that deployment wants to pull. -->

The **subject** is the artifact the attestation describes. For a container image, the subject usually includes an image name and a digest. The digest is calculated from image content, so it identifies one concrete image.

Tags are still useful. A tag such as `checkout-api-2026.06.21` helps humans read release notes. A tag can move if someone pushes another image under the same tag. A digest should carry the trust decision because it points to exact content.

The release record can store both:

```yaml
service: checkout-api
image: ghcr.io/harborbooks/checkout-api
tag: checkout-api-2026.06.21
digest: sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
commit: 7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20
workflow_run: 9142337112
```

`image` and `tag` are readable labels. `digest` is the artifact identity used by verification and deployment. `commit` and `workflow_run` connect the artifact back to source and CI evidence.

Kubernetes can deploy the digest form:

```yaml
image:
  repository: ghcr.io/harborbooks/checkout-api
  tag: checkout-api-2026.06.21
  digest: sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
```

The deployment tooling can render the final image reference as `repository@digest`. The tag remains release metadata, while the digest is the value checked against the attestation subject.

## GitHub Artifact Attestations
<!-- section-summary: GitHub Actions can create provenance attestations by combining workflow identity, artifact permissions, and the built artifact digest. -->

**GitHub artifact attestations** let a workflow create signed attestations for artifacts it builds. For build provenance, the workflow needs permission to request an OIDC identity token and permission to write attestations. Container-image workflows also need permission to push the image.

A direct workflow can build, push, and attest one image digest:

```yaml
name: release-checkout

on:
  push:
    tags:
      - "checkout-api-v*"

permissions:
  contents: read
  packages: write
  id-token: write
  attestations: write

env:
  IMAGE: ghcr.io/harborbooks/checkout-api

jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.sha }}
          persist-credentials: false

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ env.IMAGE }}:${{ github.ref_name }}

      - uses: actions/attest-build-provenance@v2
        with:
          subject-name: ${{ env.IMAGE }}
          subject-digest: ${{ steps.build.outputs.digest }}
          push-to-registry: true
```

The Docker build step pushes the image and exposes the digest. The attestation step uses the image name and digest as the subject. `push-to-registry: true` stores the attestation where tools can find it with the OCI image.

In a stricter production setup, Harbor Books would pin third-party actions to reviewed commit SHAs, protect release tags, require code-owner review for workflow changes, and prefer a platform-owned reusable workflow. The attestation records which workflow ran, so protecting workflow files is part of protecting the release path.

## Storing Attestations
<!-- section-summary: Attestations need durable storage near the artifact or in a release evidence system so deployments and responders can find them. -->

An attestation helps only if another system can find it. A temporary file in a CI workspace disappears after the job. Deployment gates, auditors, and incident responders need durable storage.

GitHub artifact attestations can be verified through GitHub's attestation service. For container images, attestations can also be pushed to the OCI registry with the image. Registry storage is useful because the evidence travels near the artifact digest.

Harbor Books also keeps a release evidence record:

```yaml
service: checkout-api
environment: production
artifact: ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
source_commit: 7c1a2ef4b49b7c6a1cc2e5d9a9f0d8f63e4c1a20
workflow_run: https://github.com/harborbooks/checkout-api/actions/runs/9142337112
sbom_digest: sha256:df8020fd
attestation_location: oci://ghcr.io/harborbooks/checkout-api@sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6
verification_result: passed
```

This record lets an incident responder start from a running image digest and quickly find source, workflow, SBOM, and provenance evidence. The record should outlive the build job and the rollout.

Public transparency logs can add another review trail. Sigstore's Rekor records signing events for Sigstore workflows, and verification tools can use log information when checking signatures or attestations. Some private organizations use private Sigstore or internal evidence services when release metadata is sensitive.

## Verification Before Deployment
<!-- section-summary: Deployment verification checks the attestation signature, subject digest, source repository, source revision, signer workflow, and builder policy. -->

Verification has two layers. The first layer checks the attestation envelope: signature, signer identity, certificate or key information, transparency data where available, and subject digest. The second layer checks provenance facts against policy: source repository, source revision, source ref, signer workflow, builder identity, and artifact name.

A deployment gate can start with GitHub CLI:

```bash
IMAGE="ghcr.io/harborbooks/checkout-api"
DIGEST="sha256:9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6"

gh attestation verify "oci://${IMAGE}@${DIGEST}" \
  --repo harborbooks/checkout-api \
  --signer-workflow harborbooks/checkout-api/.github/workflows/release-checkout.yml \
  --source-ref refs/heads/main \
  --format json > verified-attestation.json
```

The command verifies an attestation for the exact OCI image digest. `--repo` names the expected repository. `--signer-workflow` narrows trust to the release workflow. `--source-ref` narrows the source ref. `--format json` writes data that a policy step can inspect.

A small policy check can read the JSON:

```bash
EXPECTED_DIGEST="9f3e6f3b1d7e8e8b5f7c6a2e4d1c9b0a4f7e2d6c8b1a0f5e4d3c2b1a09f8e7d6"
EXPECTED_REPO="https://github.com/harborbooks/checkout-api"
EXPECTED_REF="refs/heads/main"

jq -e '
  .[0].verificationResult.statement as $statement
  | $statement.predicateType == "https://slsa.dev/provenance/v1"
  and $statement.subject[0].digest.sha256 == env.EXPECTED_DIGEST
  and $statement.predicate.buildDefinition.externalParameters.repository == env.EXPECTED_REPO
  and $statement.predicate.buildDefinition.externalParameters.ref == env.EXPECTED_REF
' verified-attestation.json
```

The `jq` expression checks the predicate type, subject digest, repository, and source ref. A real deployment gate may use a policy engine rather than a shell script, but the comparison is the same: artifact digest plus trusted build facts.

![Provenance gate infographic showing a deployment request, attestation, and image digest checked against digest, repo, workflow, commit, and builder policy before allow or block](/content-assets/articles/article-devsecops-software-supply-chain-build-provenance-attestations/provenance-gate.png)

*A provenance gate compares the requested digest and build evidence with release policy before production accepts the artifact.*

## Operational Checklist
<!-- section-summary: A practical provenance program turns fields and formats into repeatable release, review, and incident-response checks. -->

Harbor Books turns provenance into a small checklist that appears in release gates and incident runbooks:

| Check | Expected value for `checkout-api` | Evidence |
|---|---|---|
| Subject digest | `sha256:9f3e...` | Attestation subject and registry digest |
| Source repository | `https://github.com/harborbooks/checkout-api` | SLSA external parameters or verified GitHub fields |
| Source revision | `7c1a2ef...` | SLSA resolved dependency and release record |
| Source ref | `refs/heads/main` or protected release tag | SLSA external parameters and GitHub verification |
| Signer workflow | `.github/workflows/release-checkout.yml` or approved reusable workflow | GitHub attestation signer identity |
| Builder identity | Approved GitHub Actions or platform builder | SLSA run details and verification policy |
| Storage | GitHub attestation service, OCI registry, release database | Deployment gate and incident runbook |

This checklist helps the team route failures. A digest mismatch points at artifact substitution or a stale release record. A repository or workflow mismatch points at an unexpected build path. A missing attestation points at publication or storage. A failed source revision check points at a release record gap.

Provenance should also be generated for every candidate image before promotion. Staging and production should use the same verification rules, with stricter enforcement in production. Rollback images need their own provenance too, since an old image without evidence can create the same trust gap during an incident.

![Build evidence chain infographic showing source repo, workflow, builder, image digest, and attestation connected to commit, run, digest, and policy checks](/content-assets/articles/article-devsecops-software-supply-chain-build-provenance-attestations/build-evidence-chain.png)

*This summary image connects the whole article: source commit, workflow run, builder, image digest, attestation, and policy check all describe the same release artifact.*

## What's Next

Provenance gives Harbor Books a signed build receipt. It connects the artifact digest to source, workflow, builder, inputs, and run evidence. The next article moves from build receipt to sealed delivery box.

Artifact signing and verification ask whether production can trust the digest itself. The release path signs the exact artifact, the verifier checks the signer identity, and Kubernetes admission can reject workloads that lack the expected evidence.

---

## References

- [SLSA Build Provenance](https://slsa.dev/spec/v1.2/build-provenance) - SLSA specification for build definition, run details, builder identity, and provenance metadata.
- [SLSA Verifying Artifacts](https://slsa.dev/spec/v1.2/verifying-artifacts) - SLSA guidance for verifying artifact identity, source, builder, dependencies, and provenance.
- [in-toto Attestation Framework](https://github.com/in-toto/attestation/blob/main/spec/README.md) - in-toto specification for statements, subjects, predicate types, and predicates.
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) - GitHub documentation for artifact attestations and provenance.
- [Using artifact attestations to establish provenance for builds](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds) - GitHub workflow guidance for creating build provenance attestations.
- [actions/attest-build-provenance](https://github.com/actions/attest-build-provenance) - GitHub Action documentation for creating build provenance attestations.
- [GitHub CLI `gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify) - GitHub CLI documentation for verifying artifact attestations.
- [Sigstore signing overview](https://docs.sigstore.dev/cosign/signing/overview/) - Sigstore documentation for signing, keyless identity, and verification concepts.
