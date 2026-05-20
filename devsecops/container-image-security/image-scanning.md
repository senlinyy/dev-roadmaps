---
title: "Image Scanning"
description: "Read container image findings, separate base-image risk from application risk, and prove the fix."
overview: "Image scanning compares the contents of a container image with known vulnerability data. This article explains package evidence, CVE findings, base image updates, and how to avoid treating scanner output as a final decision."
tags: ["scanning", "cve", "images"]
order: 2
id: article-devsecops-container-image-security-image-scanning
---

## Table of Contents

1. [What Image Scanning Reads](#what-image-scanning-reads)
2. [Base Image Findings](#base-image-findings)
3. [Application Findings](#application-findings)
4. [Reading a Finding](#reading-a-finding)
5. [Fix Evidence](#fix-evidence)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## What Image Scanning Reads

An image scanner inspects the packages and files inside a container image, then compares them with vulnerability data. It may detect operating system packages, language packages, binaries, and metadata from package managers.

For the orders service, the scanner reads the built image. That includes the repository output and the base image content underneath it.

```text
Image: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
OS packages: debian packages from base image
Language packages: npm packages from node_modules
Application files: dist/server.js and supporting files
```

That distinction matters. A dependency scanner may report npm package risk from the repository. An image scanner reports what actually shipped in the built image. The two should usually agree for application dependencies, but image scanning also sees the base image.

## Base Image Findings

Base image findings come from operating system packages inherited from the base image.

```text
Finding: CVE-2026-1111
Package: libssl3
Installed: 3.0.11-1
Fixed: 3.0.13-1
Layer: base image
Image base: node:22-slim
```

The `Layer` line tells you this came from the base image. The fix may be to rebuild after the base image is updated, update the base tag, or move to a newer base image. Editing application code will not fix this package.

Base image findings can feel frustrating because the application team did not write the vulnerable package. The shipped image still contains it. The team owns the artifact it deploys, so it needs a patch path.

## Application Findings

Application findings come from packages your build copied into the image.

```text
Finding: CVE-2026-2222
Package: example-parser
Installed: 1.4.2
Fixed: 1.4.4
Layer: npm install
Path: express -> body-parser -> example-parser
```

This finding connects to dependency scanning. The fix may be a package update, lockfile regeneration, or dependency replacement. After the fix, rebuild the image and scan the new digest.

The digest is important. Scanning `orders-api:latest` can hide which artifact was checked. Scan and record the exact digest that will deploy.

## Reading a Finding

A scanner finding should be read as evidence, not as a panic button.

```text
Severity: high
Package: libxml2
Installed version: 2.9.14
Fixed version: 2.9.14+deb12u2
Exploitability: no known exploit
Reachability: package present through base image, app does not call XML parser directly
Decision: update base image during next patch release
Owner: platform-team
```

The `Severity` line tells you vendor or database severity. `Fixed version` tells you what removes the known issue. `Exploitability` and `Reachability` add local context. `Decision` and `Owner` turn the finding into work.

Some findings are urgent. Some are noise from unused packages. Some have no fixed version yet. The scanner should feed triage, not replace it.

## Fix Evidence

The fix should prove that the deployed digest changed and the finding disappeared or was accepted with a record.

```text
Old image: ghcr.io/devpolaris/orders-api@sha256:1111...
New image: ghcr.io/devpolaris/orders-api@sha256:2222...
Finding: CVE-2026-1111 libssl3
Fix: base image updated from node:22-slim 2026-05-01 to 2026-05-19
Scanner result: finding absent in new digest
Deployment: production updated to sha256:2222...
```

The old and new digest lines prevent confusion. If the scanner passes on a locally built image but production still runs the old digest, the risk is still in production.

## Putting It All Together

Image scanning reads what shipped in the image. It sees both base image packages and application dependencies. The useful review starts by identifying which layer introduced the finding, whether a fixed version exists, whether the vulnerable code is reachable, and which digest is deployed.

For `devpolaris-orders-api`, image scanning should run on the exact image digest produced by the trusted build. Findings should become patch work, dependency work, base image work, or time-limited exceptions with owners.

## What's Next

Image scanning tells you about known findings in the image. An SBOM records the components in the image so future incidents and audits can ask what shipped even when no finding existed at release time.

---

**References**

- [Docker Scout vulnerability analysis](https://docs.docker.com/scout/) - Docker documents image analysis and vulnerability reporting.
- [Anchore Syft](https://github.com/anchore/syft) - Syft generates SBOMs from container images and filesystems.
- [GitHub container scanning with dependency review and code scanning](https://docs.github.com/en/code-security) - GitHub documents code security and supply-chain tools used in review workflows.
