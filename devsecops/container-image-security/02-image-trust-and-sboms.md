---
title: "Image Trust and SBOMs"
description: "Scan container layers for vulnerabilities, compile SBOM ingredient lists, and cryptographically sign digests with Cosign."
overview: "A compiled container must be auditable and verified. This article explains static layer vulnerability analysis, Software Bills of Materials (SBOMs), and keyless cryptographic signatures."
tags: ["scanning", "sbom", "cosign", "sigstore", "trust"]
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
---

## Table of Contents

1. [The Trust Verification Problem](#the-trust-verification-problem)
2. [Vulnerability Analysis inside Container Layers](#vulnerability-analysis-inside-container-layers)
3. [Triage of Base-Image vs Application Findings](#triage-of-base-image-vs-application-findings)
4. [Documenting the Ingredient List: Software Bills of Materials (SBOM)](#documenting-the-ingredient-list-software-bills-of-materials-sbom)
5. [Proving Identity: Cryptographic Container Signing](#proving-identity-cryptographic-container-signing)
6. [Keyless Signing: The OIDC and Sigstore Trust Flow](#keyless-signing-the-oidc-and-sigstore-trust-flow)
7. [Deploy-Time Verification Policy](#deploy-time-verification-policy)
8. [Putting It All Together](#putting-it-all-together)

## The Trust Verification Problem

When a container image is compiled and pushed to a remote registry, it enters a silent transition period. Between the moment the image is built and the moment it is deployed to production, it sits in storage. During this phase, security teams must be able to verify three critical attributes of the image: they must know what known vulnerabilities exist inside the container layers, they must possess a persistent inventory of every software component shipped within it, and they must prove cryptographically that the image has not been altered or replaced since leaving the trusted builder.

Without these verification controls, a team is exposed to severe supply-chain exploits. First, new vulnerabilities (CVEs) are discovered daily; an image that was completely safe on Monday might contain a critical vulnerability by Friday. Second, without a searchable component inventory, teams cannot easily determine if a newly announced exploit (such as Log4j) resides inside their active containers without manually pulling and scanning every single image layer in production. Third, registries can be compromised. If an attacker acquires push credentials, they can replace a container image with a malicious backdoor while keeping the tag identical, tricking production servers into executing unverified software.

To establish complete trust in our compiled artifacts, we implement a three-layer verification chain: **Software Composition Analysis (SCA)** to scan container layers for vulnerabilities, **Software Bills of Materials (SBOM)** to create searchable ingredient manifests, and **Cryptographic Signing** with Cosign to guarantee origin and integrity.

## Vulnerability Analysis inside Container Layers

A container image is a stacked sequence of compressed tarball layers. Standard repository-level dependency scanners only inspect the source files committed to Git. An image vulnerability scanner, such as Trivy or Grype, operates downstream. It extracts the compiled image layers, parses the absolute filesystem state, and compares the discovered files against a real-time database of public Common Vulnerabilities and Exposures (CVEs).

When a scanner audits a container, it performs two distinct inspections:
* **Operating System Packages**: The scanner reads the base OS package manager databases (such as `/var/lib/dpkg/status` in Debian-based images or `/lib/apk/db/installed` in Alpine-based images) to inventory system libraries like `libssl`, `libc`, and `ca-certificates`.
* **Application Language Runtimes**: The scanner traverses application folders to discover package lockfiles (such as `package-lock.json`, `poetry.lock`, or `Cargo.lock`) and binary assets. It reads their metadata fields to catalog application-level dependencies.

To execute a precise scan, we must always target the immutable cryptographic digest of the image, rather than a mutable tag. A mutable tag (like `:latest` or `:prod`) is merely a reference pointer that can be updated at any time. If you scan an image by tag, the image you inspect during code review can be completely different from the image that actually deploys. Scanning by digest—the unique SHA-256 hash of the image's manifest—guarantees that the exact byte stream you analyze is the exact byte stream that runs:

```bash
$ trivy image ghcr.io/devpolaris/orders-api@sha256:4e1b9f307c9a2d51b765d0b2f3a9b2e6f6a7c5d4e8f90123456789abcdeffeed
```

The output of the scan lists every discovered vulnerability, mapping it to the specific package name, the installed version, and the fixed version where a patch exists. This scan report serves as a formal gate, blocking releases if high or critical findings are detected.

## Triage of Base-Image vs Application Findings

When a scanner reports vulnerabilities inside a container, the triaging engineer must first identify the origin layer of each finding. Because a container combines both operating system libraries and application dependencies, the path to resolve a vulnerability depends entirely on where the vulnerable package entered the image.

First, consider operating system libraries, such as `libssl3` or `libc6`. These packages are inherited directly from the upstream base image defined in your Dockerfile's `FROM` instruction. If `libssl3` contains a critical vulnerability, you cannot resolve it by editing your application's package configuration. Instead, you must pull a refreshed version of the base image that contains the OS-level security patch, and rebuild your container:

```bash
$ docker build --pull -t ghcr.io/devpolaris/orders-api:latest .
```

The `--pull` flag forces the container engine to contact the registry and download the latest, patched snapshot of the upstream base image before compiling, producing a clean, updated layer.

Second, consider application-level packages, such as `express`, `requests`, or `serde`. These dependencies enter the container during the build stage when package managers install libraries listed in the repository's lockfile. If a dependency is vulnerable, rebuilding the base image will have no effect. You must update the dependency inside your repository's lockfile (such as updating `package-lock.json` via npm) and commit the change to Git, allowing the next CI compilation to copy the secure library into the runtime layer.

When triage is complete, the security team records a formal release trace. This trace binds the old digest, the specific CVE identifiers, the resolving commit SHA, and the final clean digest together, ensuring that every deployment can be audited against its active vulnerability history.

## Documenting the Ingredient List: Software Bills of Materials (SBOM)

A vulnerability scan is highly valuable on release day. However, security databases are dynamic. If a critical zero-day exploit is announced next month, scanning old releases by downloading their layers is highly inefficient. To maintain real-time visibility without operational friction, we generate a Software Bill of Materials (SBOM) at build time.

An SBOM is a structured, machine-readable inventory of every single component, library, binary, and OS package shipped inside a software artifact. Think of it as the complete ingredients list on a box of cereal. If a public advisory warns that a specific software package is compromised, you do not have to scan your active runtime servers. You simply query your central SBOM catalog for the affected package name and version.

We generate SBOMs during our compilation pipeline using specialized tools like Syft, outputting the inventory in standard JSON schemas such as CycloneDX or SPDX:

```bash
$ syft ghcr.io/devpolaris/orders-api@sha256:91c8b6bb0e6a... -o cyclonedx-json=orders-api.cdx.json
```

A simplified CycloneDX component record represents this structured transparency:

```json
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.6",
  "metadata": {
    "component": {
      "type": "container",
      "name": "ghcr.io/devpolaris/orders-api",
      "version": "2026.05.20.1",
      "bom-ref": "pkg:oci/orders-api@sha256:91c8b6bb0e6a"
    }
  },
  "components": [
    {
      "type": "library",
      "name": "express",
      "version": "4.18.4",
      "purl": "pkg:npm/express@4.18.4"
    },
    {
      "type": "operating-system-package",
      "name": "libc6",
      "version": "2.36-9+deb12u10",
      "purl": "pkg:deb/debian/libc6@2.36-9%2Bdeb12u10?distro=debian-12"
    }
  ]
}
```

The key field in this record is the **Package URL (purl)**. A purl (such as `pkg:npm/express@4.18.4`) is a standardized string that uniquely identifies the package ecosystem, name, and exact version. Using purls ensures that security scanners and license compliance tools can query and analyze inventories across different programming languages and operating systems without naming ambiguities. Storing these structured SBOM files alongside our images provides a permanent, searchable audit trail of what went into every release.

## Proving Identity: Cryptographic Container Signing

Possessing a clean scan and a detailed SBOM is only meaningful if we can guarantee that the image running in production is the exact same image that passed those checks. If an attacker compromises our registry or intercepts the network path, they can modify container layers in transit. Cryptographic container signing solves this by attaching a tamper-proof digital signature directly to the immutable image digest.

When we sign an image using a tool like **Cosign** (part of the Sigstore project), we perform a mathematical operation on the SHA-256 digest of the container's layers. This signature serves two security functions:
* **Integrity Guarantee**: Because the signature is cryptographically bound to the image's digest, if any attacker alters a single byte of a filesystem layer in transit, the digest changes, rendering the signature invalid and alerting the verifier.
* **Origin Proof**: The signature proves the identity of the signer. Production servers can verify that the image was signed by your specific, trusted CI build runner rather than an external developer's laptop.

```bash
$ cosign sign --yes ghcr.io/devpolaris/orders-api@sha256:91c8b6bb0e6ad134dd19a7e1cf402a23c7c9876543210fedcba9876543210fed
```

By executing this command inside our release pipeline, Cosign uploads the signature metadata directly to the container registry alongside the image manifest. The registry stores the signature as a separate, linked artifact, allowing deployment servers to inspect and verify it without downloading the heavy image layers first.

## Keyless Signing: The OIDC and Sigstore Trust Flow

Traditional cryptographic signing requires engineering teams to generate long-lived private keys, store them in CI/CD repository secrets, and rotate them regularly. If an attacker steals a private key, they can sign malicious images silently. 

To eliminate this credential management risk, we adopt **Keyless Signing**. Keyless signing does not mean we sign without keys; rather, it means we eliminate long-lived, static keys. Instead, we use short-lived, ephemeral keys that are tied to an authenticated OpenID Connect (OIDC) identity provider.

In a keyless Sigstore trust flow, the process executes four sequential steps:

First, when the build runner compiles the container, the CI/CD platform (such as GitHub Actions) generates a short-lived OIDC identity token. This token contains cryptographically signed claims proving the exact identity of the runner: the repository name, the workflow file, the run ID, and the active branch (for example, `refs/heads/main`).

Second, Cosign generates an ephemeral public/private keypair on the runner. This keypair is designed to exist for only a few minutes. Cosign sends the public key and the OIDC token to **Fulcio**, Sigstore's public Certificate Authority.

Third, Fulcio verifies the OIDC token's signature. Once validated, Fulcio issues a short-lived cryptographic certificate (valid for 10 minutes) binding the public key directly to your OIDC identity. The private key remains sandboxed on the runner, never traveling over the network.

Fourth, Cosign uses the ephemeral private key to sign the image digest. It then uploads the signature, the short-lived Fulcio certificate, and a cryptographic proof to **Rekor**, Sigstore's public, append-only Transparency Log. The private key is then immediately destroyed.

When a deployment server verifies the signature, it inspects the Fulcio certificate and checks the Rekor transparency log. Because the log is immutable and public, the server can confirm that the signature was generated during the active certificate window by your exact, trusted CI runner, without requiring any long-lived keys to be stored or rotated.

## Deploy-Time Verification Policy

Container signing and SBOM inventories are only effective if we actively enforce a validation policy at the edge of our production clusters. We achieve this by deploying an admission controller—such as Kyverno or Sigstore's Policy Controller—directly inside our production Kubernetes cluster.

An admission controller intercepts all incoming deployment requests before they are parsed by the Kubernetes API server. It inspects the image reference, extracts the target digest, and executes a keyless verification check against your OIDC configuration:

```yaml
apiVersion: policy.sigstore.dev/v1beta1
kind: ClusterImagePolicy
metadata:
  name: enforce-signed-orders-api
spec:
  images:
    - glob: "ghcr.io/devpolaris/orders-api@sha256:*"
  authorities:
    - keyless:
        identities:
          - issuer: "https://token.actions.githubusercontent.com"
            subject: "https://github.com/devpolaris/orders-api/.github/workflows/delivery.yml@refs/heads/main"
```

In this policy definition, the admission controller applies strict rules:
* It matches all deployment images targeting the `orders-api` repository referenced by digest.
* It verifies that the image digest possesses a valid Sigstore signature.
* It checks the Fulcio certificate claims, validating that the OIDC issuer matches GitHub's token authority and that the subject identity matches the exact release workflow executing on the protected `main` branch.

If a developer attempts to deploy an unsigned container, or an image signed by a local developer laptop or a feature branch workflow, the admission controller blocks the deployment instantly, throwing a policy rejection error and preventing unverified code from ever executing in your cluster.

## Putting It All Together

Establishing container image trust completes the artifact verification chain, ensuring that every workload running in production has been thoroughly audited and cryptographically verified. By combining static layer scanning, structured SBOM catalogs, Cosign digest signatures, keyless OIDC identity federation, and deploy-time admission policies, we build an auditable delivery pipeline that protects production runtimes from supply-chain compromises.

When securing your container verification pipelines, ensure you maintain these five core practices:

First, automate image vulnerability scans targeting immutable digests rather than mutable tags. Block pipelines if critical or high CVE findings are detected, and separate base-image OS fixes from application package updates.

Second, generate a standard CycloneDX SBOM for every production build. Inventory all software components using precise Package URLs (purls), and store these ingredient lists in a searchable catalog to handle zero-day vulnerability responses.

Third, sign container digests cryptographically using Cosign. Ensure that all signatures bind directly to the SHA-256 layer digest, preventing registry-level tampering and tag-hijacking exploits.

Fourth, adopt keyless Sigstore signing in your CI/CD pipelines. Grant your runners minimal `id-token: write` permissions, utilizing Fulcio certificates and Rekor transparency logs to sign digests without managing long-lived keys.

Fifth, enforce strict deploy-time verification policies. Deploy an admission controller in your clusters to validate image signatures, OIDC issuers, and branch subjects before allowing any container to launch.
