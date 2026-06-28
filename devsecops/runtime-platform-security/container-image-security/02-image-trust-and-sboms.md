---
title: "Image Trust and SBOMs"
description: "Answer what is inside a container image with scanning, SBOMs, base-image drift checks, signing, attestations, and CI evidence."
overview: "Start with the plain production question: what is inside this payments-api image? Then inspect layers and packages, scan known vulnerabilities, publish SBOMs in CycloneDX or SPDX, handle base-image drift, triage findings, sign and attest the digest, and make CI publish the evidence that deployment policy can verify."
tags: ["devsecops", "containers", "sbom", "image-scanning"]
order: 2
id: article-devsecops-container-image-security-image-scanning
aliases:
  - image-scanning
  - article-devsecops-container-image-security-image-scanning
  - devsecops/container-image-security/image-scanning.md
  - sboms
  - article-devsecops-container-image-security-sboms
  - devsecops/container-image-security/sboms.md
  - image-signing
  - article-devsecops-container-image-security-image-signing
  - devsecops/container-image-security/image-signing.md
  - devsecops/container-image-security/02-image-trust-and-sboms.md
  - devsecops/container-image-security/02-image-trust-and-sboms
  - container-image-security/02-image-trust-and-sboms
---

## Table of Contents

1. [What Is Inside This Image?](#what-is-inside-this-image)
2. [What Image Scanning Checks](#what-image-scanning-checks)
3. [Layers and Package Visibility](#layers-and-package-visibility)
4. [What an SBOM Records](#what-an-sbom-records)
5. [CycloneDX and SPDX in Practice](#cyclonedx-and-spdx-in-practice)
6. [Base-Image Drift Creates New Work](#base-image-drift-creates-new-work)
7. [Triage Uses Severity, Reachability, and Ownership](#triage-uses-severity-reachability-and-ownership)
8. [Signing and Attestations Connect Evidence to Trust](#signing-and-attestations-connect-evidence-to-trust)
9. [CI Publishes the Evidence](#ci-publishes-the-evidence)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)
12. [References](#references)

## What Is Inside This Image?
<!-- section-summary: Image trust starts by naming the exact digest and answering what software the image contains. -->

In the previous article, the team made the `payments-api` shipping box smaller. They used a trusted base image, kept build tools out of the runtime stage, ran as a non-root user, and prepared the image for a read-only filesystem.

Now the team asks the next plain question: **what is inside this exact image?** That question sounds simple, but production images have layers. A Node.js API image can contain Debian packages from the base image, npm packages from `package-lock.json`, compiled JavaScript, CA certificates, startup metadata, and sometimes files the team did not expect.

A **digest** gives the team the exact image object, such as `ghcr.io/devpolaris/payments-api@sha256:...`. A **scan report** compares discovered packages with known vulnerability data. An **SBOM**, short for Software Bill of Materials, records the package inventory. A **signature** and **attestation** connect the digest and evidence back to the trusted CI workflow.

Here is the small release record we will grow through the article:

```yaml
service: payments-api
image: ghcr.io/devpolaris/payments-api
digest: sha256:2c1a9f7b6d4e8b0c7a91e4d2f6c3b8a5d4e7f90123456789abcdef0123456789
source_commit: 4f8c2a19d5be
```

The `image` field names the repository. The `digest` field names the exact image content. The `source_commit` field connects the image back to the code review and build. Every later piece of evidence should point back to this same digest.

The table below shows the evidence chain before we zoom into each part:

| Release question | Evidence the team should keep |
|---|---|
| Which exact image did CI build? | The immutable image digest, such as `ghcr.io/devpolaris/payments-api@sha256:...` |
| What software is inside that image? | A **Software Bill of Materials**, usually shortened to **SBOM** |
| Which known vulnerabilities affect those packages? | An image scan report from a tool such as Trivy, Docker Scout, or Grype |
| Who built and approved this image? | A signature, provenance attestation, and CI identity claims |
| Which findings were accepted, fixed, or deferred? | A triage record with severity, reachability, owner, and due date |

This is the same image journey from a few angles. The digest tells us which image object we are discussing. The SBOM tells us what ingredients sit inside it. The scan report compares those ingredients with vulnerability databases. The signature and attestations connect the evidence back to the trusted CI pipeline. The triage record explains the human decision when a scanner finds something.

![Release evidence chain infographic showing a payments-api digest connected to SBOM, scan report, signature, triage record, CI build, and deploy policy](/content-assets/articles/article-devsecops-container-image-security-image-scanning/release-evidence-chain.png)

*The release evidence chain keeps every trust decision attached to one digest, so later scanners, reviewers, and deployment policies all talk about the same artifact.*

The first step is scanning, because scanning gives the team the first concrete list of packages and vulnerabilities for the digest.

## What Image Scanning Checks
<!-- section-summary: Image scanning inspects a built container image and compares discovered packages with vulnerability databases. -->

**Image scanning** is an automated inspection of a built container image. A scanner pulls the image layers, rebuilds the final filesystem view, discovers packages, and compares those packages with vulnerability databases. In plain English, it asks, "Which known risky libraries and operating system packages did we ship in this exact image?"

For `payments-api`, the team should scan the pushed image by digest after CI builds it. A **digest** is a content address for the image manifest, usually a SHA-256 value. A tag such as `:main` or `:prod` is a friendly pointer that teams can move, so scan reports and deployment evidence should name the digest.

```bash
IMAGE="ghcr.io/devpolaris/payments-api@sha256:2c1a9f7b6d4e8b0c7a91e4d2f6c3b8a5d4e7f90123456789abcdef0123456789"

trivy image \
  --severity HIGH,CRITICAL \
  --ignore-unfixed \
  "$IMAGE"
```

This command asks Trivy to scan one immutable image digest and show high or critical vulnerabilities with known fixes. The `--ignore-unfixed` flag helps teams focus on findings that have a patch path, which is useful for release gates. Many teams also save the full JSON or SARIF output so the result can be attached to the build:

```bash
mkdir -p evidence

trivy image \
  --format json \
  --output evidence/trivy-payments-api.json \
  "$IMAGE"
```

The scan usually reports package name, installed version, vulnerability ID, severity, fixed version, and the package type. A finding might say that `openssl` from the Debian base image has a critical CVE and a fixed version exists. Another finding might say that an npm package copied with the Node application has a high severity vulnerability in a transitive dependency.

The fix path changes by package source. Operating system package findings usually come from the base image. Application package findings usually come from the repository lockfile. To make those decisions well, the team needs to understand layers and package visibility.

## Layers and Package Visibility
<!-- section-summary: Layer and package visibility tells teams where a vulnerable component entered the image and which owner can fix it. -->

A container image is built from **layers**. The OCI Image Specification describes an image manifest that points to a config object and an ordered set of layers. Each layer represents filesystem changes from build steps, and the container runtime combines those layers into the filesystem the process sees.

You can think about a Dockerfile as a trail of build decisions. The `FROM` line brings in base-image packages. A package manager command adds operating system tools. A language install step adds application dependencies. A `COPY` instruction brings in the compiled application or source files.

Here is a small version of the `payments-api` runtime image. It shows where base packages, npm dependencies, and application files enter the final container.

```dockerfile
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

A scanner gets useful visibility from two places. It reads operating system package databases such as Debian's `dpkg` status files, Alpine's `apk` database, or RPM metadata. It also reads application dependency metadata such as `package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`, `go.mod`, `Cargo.lock`, and language-specific package metadata inside the final image.

This visibility turns a vague warning into an actionable fix. If `libssl3` came from `node:22-bookworm-slim`, the platform or container owner needs a refreshed base image and a rebuild. If `express` or a transitive npm package came from `package-lock.json`, the application team needs a dependency update and a new lockfile commit.

Tools can show package inventory in a simple table before the team even talks about vulnerabilities. This output also helps the team spot packages that were accidentally left in the final runtime image.

```bash
syft packages "$IMAGE" -o table
```

That table gives engineers a quick way to answer, "Is the package actually in the runtime image?" Multi-stage builds often install build tools in a builder stage and leave them out of the final stage. A clean final image gives scanners fewer runtime packages to report and gives humans fewer findings to triage.

Scanning tells us what is risky today. The next need is an inventory that survives beyond today's vulnerability database.

## What an SBOM Records
<!-- section-summary: An SBOM is a machine-readable inventory of the software components inside an artifact. -->

A **Software Bill of Materials**, or **SBOM**, is a machine-readable inventory of software components inside an artifact. For a container image, an SBOM usually lists operating system packages, language packages, versions, package identifiers, relationships, and sometimes license or supplier data. It is the release inventory for the exact image digest.

The simple reason teams keep SBOMs is response speed. Imagine a serious OpenSSL issue gets announced next month. The team can query the SBOM catalog for `openssl`, affected versions, and the image digests that contain them. That is much faster than pulling every production image and rediscovering the same packages from scratch.

For `payments-api`, CI can generate an SBOM immediately after the image is pushed. The commands below produce CycloneDX and SPDX JSON for the same immutable image digest.

```bash
mkdir -p evidence

syft packages "$IMAGE" \
  -o cyclonedx-json=evidence/payments-api.cdx.json

syft packages "$IMAGE" \
  -o spdx-json=evidence/payments-api.spdx.json
```

The two output files describe the same image inventory in two common standards. A simplified component record from a CycloneDX-style SBOM might look like this. This snippet keeps only enough fields to show the package names, versions, and package identifiers:

```json
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.6",
  "components": [
    {
      "type": "library",
      "name": "express",
      "version": "4.18.3",
      "purl": "pkg:npm/express@4.18.3"
    },
    {
      "type": "library",
      "name": "openssl",
      "version": "3.0.14-1~deb12u2",
      "purl": "pkg:deb/debian/openssl@3.0.14-1~deb12u2?distro=debian-12"
    }
  ]
}
```

The **Package URL**, usually written as **purl**, gives tools a consistent way to identify a package across ecosystems. `pkg:npm/express@4.18.3` means an npm package named `express` at that exact version. `pkg:deb/debian/openssl@...` means a Debian package, which helps scanners and inventory systems avoid confusing packages that share a name across ecosystems.

An SBOM also helps compliance and operations teams. Security can search for vulnerable components, legal teams can review licenses, and platform teams can compare two releases. The file should travel with the image digest because an SBOM without the digest leaves everyone guessing which artifact the inventory describes.

Once the team knows what an SBOM records, the next question is which SBOM format they should publish. The format choice depends on the systems that need to read the SBOM: scanners, registries, customer portals, and internal review tools.

## CycloneDX and SPDX in Practice
<!-- section-summary: CycloneDX and SPDX are the two common SBOM standards teams use to exchange image inventory data. -->

**CycloneDX** is an SBOM standard designed for software supply chain risk. It represents components, services, dependencies, vulnerabilities, and related metadata. Many security tools support CycloneDX because it fits vulnerability management workflows well.

**SPDX** is another SBOM standard with strong roots in license and provenance tracking. SPDX is also an ISO standard, and many organizations use it when they need a widely recognized exchange format for component, license, and file-level metadata. In production, the right choice often depends on which format the consuming tools expect.

Here is a practical way to choose for the `payments-api` release. The team can publish both formats when different consumers need different evidence.

| Consumer | Useful SBOM format | Why it helps |
|---|---|---|
| Vulnerability management platform | CycloneDX JSON | It maps cleanly to components, dependencies, vulnerabilities, and VEX-style status records |
| Legal or open source review process | SPDX JSON | It has strong license metadata support and broad standards recognition |
| Customer security questionnaire | CycloneDX or SPDX | Customers often accept either standard when it names the artifact digest and component versions |
| Registry or developer tooling | Tool-dependent | Docker Scout, Syft, Trivy, and commercial scanners can read or generate common SBOM formats |

**VEX**, short for Vulnerability Exploitability eXchange, is a way to record how a known vulnerability affects a specific product or artifact. For example, a scanner may report a vulnerable library in the image, while the team proves the vulnerable code path is unreachable in `payments-api`. A VEX record can say the image is under investigation, affected, fixed, or not affected, with a reason.

That VEX decision should never be a casual note in a chat thread. It belongs with the release evidence, tied to the image digest, vulnerability ID, affected package, reviewer, and expiration date. If a future code change starts using the vulnerable feature, the old VEX decision needs another review.

SBOM standards help the inventory travel between tools. The inventory still changes over time, because base images and vulnerability databases keep moving.

## Base-Image Drift Creates New Work
<!-- section-summary: Base-image drift means old releases keep receiving new vulnerability work as upstream packages and advisory data change. -->

**Base-image drift** is the gap between the base image you built from and the current security state of that base image family. The `payments-api` Dockerfile might say `FROM node:22-bookworm-slim`, and that tag may point to a newer digest next week after Debian or Node image maintainers publish patches. The application source code stayed the same, while the safe rebuild target moved.

There is also vulnerability knowledge drift. A package can sit inside yesterday's clean image and receive a new CVE tomorrow because researchers published new information. The bytes inside the image stayed the same, while the vulnerability database gained a new advisory.

This is why mature teams schedule rebuilds even when the application code has no changes. A weekly or monthly rebuild pulls the current base image, rebuilds `payments-api`, regenerates the SBOM, reruns the scanner, and publishes a new digest. The rebuild gives the team a normal path to collect upstream operating system patches.

```bash
docker buildx build \
  --pull \
  --tag ghcr.io/devpolaris/payments-api:base-refresh-candidate \
  --load \
  .

trivy image ghcr.io/devpolaris/payments-api:base-refresh-candidate
```

The `--pull` flag asks the builder to fetch the current base image before building. This is useful for scheduled refresh pipelines because the team wants patched base layers even when the Dockerfile text stayed the same. After the candidate scan passes, CI should push the image, capture the new digest, generate new SBOMs, and sign the new digest.

Base-image findings usually follow a different ownership path from application dependency findings. The table below connects the package source to the team action and the evidence that should change.

| Finding source | Typical owner | Common fix | Evidence to update |
|---|---|---|---|
| Debian, Ubuntu, Alpine, or RHEL package from the base image | Platform or container owner | Pull patched base image and rebuild | Image digest, SBOM, scan report, base image digest |
| Node, Python, Go, Java, Rust, or .NET dependency from the app | Application team | Update lockfile and commit dependency change | Commit SHA, SBOM, scan report, dependency changelog |
| Package installed only for debugging or build convenience | Team that owns the Dockerfile | Remove package from runtime image or move it to a builder stage | Dockerfile diff, SBOM diff, scan report |
| Package with no fixed version yet | Security and owning team together | Create an exception with scope, reachability notes, and review date | Triage record, issue link, compensating control |

This is where scanning turns into triage. The scanner can show a list of findings, while the team still needs to decide what blocks a release, what can wait, and what evidence supports the decision.

## Triage Uses Severity, Reachability, and Ownership
<!-- section-summary: Vulnerability triage combines scanner severity with runtime reachability, fix ownership, and release risk. -->

**Triage** is the process of turning scan findings into decisions. A scanner gives the team vulnerability IDs and severities, but humans need to answer whether the vulnerable code can run in this service, whether a fix exists, who owns the package, and how much risk the release can carry.

**Severity** usually comes from advisory data, often using CVSS scores and vendor ratings such as low, medium, high, or critical. Severity is a strong first filter because a remote code execution issue deserves faster attention than a low-risk local denial-of-service issue. Severity still needs context from the image and application.

**Reachability** asks whether `payments-api` can actually execute the vulnerable code path. A vulnerable package may be present because the runtime needs it, present because a transitive dependency installed it, or present because a debug tool was accidentally left in the image. Reachability review uses application routes, runtime flags, package usage, network exposure, and sometimes runtime telemetry.

**Ownership** answers who can fix the finding. The platform team can refresh a base image. The application team can update `package-lock.json`. The security team can review an exception. The release manager can decide whether the risk fits the release window.

Here is a realistic triage table for one `payments-api` release. Notice how each row pairs the scanner finding with a concrete owner decision.

| Finding | Where it appears | Reachability question | Decision | Evidence |
|---|---|---|---|---|
| `CVE-2026-10001` in `openssl` | Debian package from `node:22-bookworm-slim` | Does the patched base image include a fixed OpenSSL package? | Rebuild from refreshed base image before production | New base digest, new image digest, passing scan |
| `CVE-2026-10444` in `body-parser` | Transitive npm dependency in `package-lock.json` | Does `payments-api` parse request bodies through the affected code path? | Update npm dependency and run API tests | Lockfile commit, test result, new SBOM |
| `CVE-2026-11120` in `curl` | Runtime image package installed for debugging | Does the production container need outbound curl at runtime? | Remove `curl` from the final image | Dockerfile diff, SBOM diff, reduced scan output |
| `CVE-2026-11991` in `libxml2` | OS package with no fixed version yet | Does the service parse attacker-controlled XML? | Create time-limited exception after review | Triage record, owner, expiration date, compensating control |

The key habit is writing down the decision. A release gate that only says "scan failed" teaches the team very little. A release gate that stores package name, version, CVE, owner, fix path, reachability notes, and due date gives the team a useful security record.

Many organizations also publish VEX records for important exceptions. If the team gives `payments-api` a `not_affected` VEX status because the vulnerable feature is unreachable, the VEX record should explain that reason and point to the evidence. This helps future reviewers separate accepted risk from forgotten risk.

![Finding triage loop infographic showing a vulnerability finding moving through source, reachability, owner, fix or exception, and new digest decisions for payments-api](/content-assets/articles/article-devsecops-container-image-security-image-scanning/finding-triage-loop.png)

*Triage turns scanner output into a decision loop: find the source, check reachability, assign an owner, and ship a new digest or a reviewed exception.*

Now the team has scan reports, SBOMs, and triage decisions. The next question is how Kubernetes can trust that the image it pulls is the same image that produced that evidence.

## Signing and Attestations Connect Evidence to Trust
<!-- section-summary: Signatures prove which identity approved a digest, and attestations attach claims such as SBOMs or provenance to that digest. -->

**Image signing** attaches a cryptographic signature to an image digest. The signature lets another system verify that a trusted identity approved that exact digest. For `payments-api`, the trusted identity should be the CI release workflow, and developer laptop signatures should stay out of the production release path.

**Attestations** attach structured claims to an artifact. An SBOM attestation can say, "this SBOM describes this digest." A provenance attestation can say, "this digest came from this repository, this workflow, this commit, and this build command." SLSA provenance is a common format for that build history.

Cosign, from the Sigstore project, is a common tool for signing container images and attaching attestations. In a keyless flow, CI receives a short-lived OpenID Connect token from the CI platform. Cosign uses that identity to create a short-lived signing certificate, signs the digest, and stores verification material so other systems can check who signed the image.

```bash
cosign sign --yes "$IMAGE"

cosign attest --yes \
  --predicate evidence/payments-api.cdx.json \
  --type cyclonedx \
  "$IMAGE"
```

The first command signs the digest. The second command attaches the CycloneDX SBOM as an attestation to the same digest. Registry support and policy tooling vary by environment, so teams should test how their registry stores and exposes these attached artifacts before making them required for production.

Verification should name the identity the team trusts. This example expects the image to be signed by the GitHub Actions release workflow on the protected `main` branch. A different CI platform would use different issuer and identity values:

```bash
cosign verify \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  --certificate-identity "https://github.com/devpolaris/payments-api/.github/workflows/release.yml@refs/heads/main" \
  "$IMAGE"
```

This is where signing connects to deployment trust. A Kubernetes admission policy can require a valid signature from the release workflow before it admits a workload. The cluster can also require digest-based image references so the policy checks the exact artifact that CI scanned, signed, and documented.

The final piece is the CI pipeline itself. The pipeline should publish the evidence in a repeatable shape so each release follows the same security path.

## CI Publishes the Evidence
<!-- section-summary: CI should publish digest-bound evidence: scan reports, SBOMs, signatures, attestations, provenance, and triage decisions. -->

The CI pipeline is the best place to create release evidence because it already has the source checkout, build logs, test results, registry credentials, and image digest. The pipeline should produce the same evidence every time so security review follows a repeatable checklist.

For `payments-api`, a simple evidence bundle should include these items. Each item points back to the same image digest so reviewers can connect the files without guessing.

| Evidence item | Example file or location | Why the team keeps it |
|---|---|---|
| Image digest | `image-ref.txt` | Names the exact artifact that deploys |
| Vulnerability scan | `evidence/trivy-payments-api.json` | Records known findings at release time |
| SBOM | `evidence/payments-api.cdx.json` and optionally SPDX JSON | Records package inventory for future searches |
| Signature | Registry-attached Cosign signature | Proves the trusted CI workflow signed the digest |
| Provenance | Registry-attached SLSA provenance attestation | Records repository, workflow, commit, and build information |
| Triage record | `evidence/triage-summary.json` or an issue link | Explains accepted findings, owners, and review dates |

Here is a compact GitHub Actions-style example that shows the release shape. The exact actions and registry login steps can change by organization, but the important idea is the same: build once, capture the digest, scan that digest, generate SBOMs for that digest, sign that digest, and upload the evidence.

```yaml
name: payments-api-release

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write
  id-token: write

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

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
          pull: true
          tags: ghcr.io/devpolaris/payments-api:${{ github.sha }}

      - name: Capture image digest
        run: |
          mkdir -p evidence
          echo "ghcr.io/devpolaris/payments-api@${{ steps.build.outputs.digest }}" > image-ref.txt
          echo "IMAGE=$(cat image-ref.txt)" >> "$GITHUB_ENV"

      - name: Scan image
        run: |
          trivy image --format json --output evidence/trivy-payments-api.json "$IMAGE"
          trivy image --severity HIGH,CRITICAL --ignore-unfixed "$IMAGE"

      - name: Generate SBOMs
        run: |
          syft packages "$IMAGE" -o cyclonedx-json=evidence/payments-api.cdx.json
          syft packages "$IMAGE" -o spdx-json=evidence/payments-api.spdx.json

      - name: Sign image and attach SBOM
        run: |
          cosign sign --yes "$IMAGE"
          cosign attest --yes --predicate evidence/payments-api.cdx.json --type cyclonedx "$IMAGE"

      - uses: actions/upload-artifact@v4
        with:
          name: payments-api-release-evidence
          path: |
            image-ref.txt
            evidence/
```

The `id-token: write` permission is needed for keyless signing because Cosign needs the CI platform to issue an OIDC identity token. The `packages: write` permission allows the workflow to push the image and registry-attached signature material. Teams should keep these permissions scoped to the release job and avoid giving every workflow broad package or identity permissions.

Some teams also publish provenance through the build system itself. Docker BuildKit and GitHub's artifact attestation features can generate provenance records, and SLSA gives a shared vocabulary for describing the build. The exact implementation can vary, while the evidence goal stays stable: a reviewer should be able to connect the digest back to source, workflow, dependency inventory, scan results, and signing identity.

## Putting It All Together
<!-- section-summary: Image trust combines inventory, vulnerability decisions, and cryptographic proof around one immutable digest. -->

Let's connect the pieces back to the `payments-api` release. CI builds a hardened image and pushes it to the private registry. The pipeline records the digest, scans the image, generates SBOMs, signs the digest, attaches attestations, and saves the evidence bundle.

The scan tells the team which known vulnerabilities affect the packages in the image today. The SBOM lets the team search the image inventory later when new advisories appear. The triage record explains what the team fixed, accepted, or scheduled. The signature and attestations prove that the trusted release workflow created and approved the exact digest.

This gives Kubernetes a stronger deployment story. A cluster policy can require images from the private registry, referenced by digest, signed by the release workflow, and backed by required attestations. The runtime platform then pulls the artifact that matches the evidence without relying on a moving tag.

The daily work also gets more practical. Base-image patches turn into scheduled rebuilds. Application dependency CVEs turn into lockfile updates. Debug packages left in the runtime image turn into Dockerfile cleanups. Exceptions turn into visible records with owners and review dates.

![Image trust summary infographic showing inventory, vulnerabilities, provenance, signature, evidence bundle, and deploy policy around a payments-api image](/content-assets/articles/article-devsecops-container-image-security-image-scanning/image-trust-summary.png)

*Image trust is the whole evidence bundle together: inventory explains what is inside, scans explain current risk, and signatures connect the digest back to the release workflow.*

## What's Next

The next article moves from image evidence to registry control. Once the team has signed digests, SBOMs, and scan reports for `payments-api`, the registry is the release checkpoint that must protect those artifacts.

We will look at private registry access, push and pull permissions, immutable tags, digest-based deploys, lifecycle rules, and how to stop a trusted tag from quietly pointing at a different image. That completes the path from hardened image, to signed evidence, to controlled registry release.

## References

- [OCI Image Manifest Specification](https://github.com/opencontainers/image-spec/blob/main/manifest.md) - Defines the image manifest, config reference, and ordered layer references used by container images.
- [Trivy container image scanning documentation](https://trivy.dev/latest/docs/target/container_image/) - Documents scanning container images and supported image targets.
- [Syft SBOM getting started guide](https://oss.anchore.com/docs/guides/sbom/getting-started/) - Shows how Syft generates SBOMs from container images and directories.
- [Docker Scout SBOM documentation](https://docs.docker.com/scout/how-tos/view-create-sboms/) - Explains viewing and creating SBOMs for container images with Docker tooling.
- [CycloneDX specification overview](https://cyclonedx.org/specification/overview/) - Describes CycloneDX as a standard for SBOM and supply chain risk data.
- [SPDX specifications](https://spdx.dev/use/specifications/) - Provides the official SPDX specification resources for SBOM exchange.
- [Sigstore Cosign documentation](https://docs.sigstore.dev/cosign/) - Documents signing, verification, and container image workflows with Cosign.
- [SLSA build provenance](https://slsa.dev/spec/v1.2/build-provenance) - Defines provenance fields for describing how an artifact was built.
- [NIST Secure Software Development Framework SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) - Gives secure software development practices, including maintaining provenance and protecting release integrity.
