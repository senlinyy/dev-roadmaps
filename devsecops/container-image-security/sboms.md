---
id: article-devsecops-container-image-security-sboms
title: "SBOMs"
description: "Generate and use software bills of materials for container images so reviewers can see what shipped."
overview: "An SBOM records the components inside a software artifact. You will learn how SBOMs support image review, incident response, vulnerability triage, and release evidence for containerized services."
tags: ["sbom", "packages", "evidence"]
order: 3
---

## Table of Contents

1. [The First Boundary To Understand](#the-first-boundary-to-understand)
2. [The devpolaris-orders-api Thread](#the-devpolaris-orders-api-thread)
3. [The Smallest Useful Artifact](#the-smallest-useful-artifact)
4. [Reading The Evidence](#reading-the-evidence)
5. [Diagnostic Path Before Changes](#diagnostic-path-before-changes)
6. [Failure Modes And Fix Directions](#failure-modes-and-fix-directions)
7. [Review Questions For Pull Requests](#review-questions-for-pull-requests)
8. [Operational Tradeoffs](#operational-tradeoffs)

## The First Boundary To Understand

SBOMs matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is parts list. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

You should read the examples as review evidence, not as commands to paste blindly. A senior reviewer is not looking for perfect-looking YAML. They are looking for a chain of proof: this image was built from this source, contains these components, passed these checks, and runs with these limits.

```dockerfile
FROM node:22-slim AS build
WORKDIR /workspace
COPY package*.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

The first diagnostic step is to anchor the discussion to a digest. A tag can help humans find an image, but the digest identifies the immutable content. When a report mentions `ghcr.io/devpolaris/orders-api@sha256:2f4a1234`, everyone can inspect the same artifact instead of arguing about where `latest` pointed yesterday.

For parts list, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## The devpolaris-orders-api Thread

SBOMs matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is formats. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

You should read the examples as review evidence, not as commands to paste blindly. A senior reviewer is not looking for perfect-looking YAML. They are looking for a chain of proof: this image was built from this source, contains these components, passed these checks, and runs with these limits.

```dockerfile
FROM node:22-slim AS build
WORKDIR /workspace
COPY package*.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

The first diagnostic step is to anchor the discussion to a digest. A tag can help humans find an image, but the digest identifies the immutable content. When a report mentions `ghcr.io/devpolaris/orders-api@sha256:2f4a1234`, everyone can inspect the same artifact instead of arguing about where `latest` pointed yesterday.

For formats, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## The Smallest Useful Artifact

SBOMs matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is generation. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

You should read the examples as review evidence, not as commands to paste blindly. A senior reviewer is not looking for perfect-looking YAML. They are looking for a chain of proof: this image was built from this source, contains these components, passed these checks, and runs with these limits.

```dockerfile
FROM node:22-slim AS build
WORKDIR /workspace
COPY package*.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

The first diagnostic step is to anchor the discussion to a digest. A tag can help humans find an image, but the digest identifies the immutable content. When a report mentions `ghcr.io/devpolaris/orders-api@sha256:2f4a1234`, everyone can inspect the same artifact instead of arguing about where `latest` pointed yesterday.

For generation, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## Reading The Evidence

SBOMs matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is reading evidence. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

You should read the examples as review evidence, not as commands to paste blindly. A senior reviewer is not looking for perfect-looking YAML. They are looking for a chain of proof: this image was built from this source, contains these components, passed these checks, and runs with these limits.

```dockerfile
FROM node:22-slim AS build
WORKDIR /workspace
COPY package*.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

The first diagnostic step is to anchor the discussion to a digest. A tag can help humans find an image, but the digest identifies the immutable content. When a report mentions `ghcr.io/devpolaris/orders-api@sha256:2f4a1234`, everyone can inspect the same artifact instead of arguing about where `latest` pointed yesterday.

For reading evidence, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## Diagnostic Path Before Changes

SBOMs matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is incident use. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

You should read the examples as review evidence, not as commands to paste blindly. A senior reviewer is not looking for perfect-looking YAML. They are looking for a chain of proof: this image was built from this source, contains these components, passed these checks, and runs with these limits.

```dockerfile
FROM node:22-slim AS build
WORKDIR /workspace
COPY package*.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

The first diagnostic step is to anchor the discussion to a digest. A tag can help humans find an image, but the digest identifies the immutable content. When a report mentions `ghcr.io/devpolaris/orders-api@sha256:2f4a1234`, everyone can inspect the same artifact instead of arguing about where `latest` pointed yesterday.

For incident use, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## Failure Modes And Fix Directions

SBOMs matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is storage failures. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

You should read the examples as review evidence, not as commands to paste blindly. A senior reviewer is not looking for perfect-looking YAML. They are looking for a chain of proof: this image was built from this source, contains these components, passed these checks, and runs with these limits.

```dockerfile
FROM node:22-slim AS build
WORKDIR /workspace
COPY package*.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

The first diagnostic step is to anchor the discussion to a digest. A tag can help humans find an image, but the digest identifies the immutable content. When a report mentions `ghcr.io/devpolaris/orders-api@sha256:2f4a1234`, everyone can inspect the same artifact instead of arguing about where `latest` pointed yesterday.

For storage failures, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## Review Questions For Pull Requests

SBOMs matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is signing link. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

You should read the examples as review evidence, not as commands to paste blindly. A senior reviewer is not looking for perfect-looking YAML. They are looking for a chain of proof: this image was built from this source, contains these components, passed these checks, and runs with these limits.

```bash
$ docker build -t ghcr.io/devpolaris/orders-api:GIT_SHA .
$ docker push ghcr.io/devpolaris/orders-api:GIT_SHA
$ cosign sign --yes ghcr.io/devpolaris/orders-api@sha256:2f4a1234
$ cosign verify --certificate-oidc-issuer https://token.actions.githubusercontent.com ghcr.io/devpolaris/orders-api@sha256:2f4a1234
```

The first diagnostic step is to anchor the discussion to a digest. A tag can help humans find an image, but the digest identifies the immutable content. When a report mentions `ghcr.io/devpolaris/orders-api@sha256:2f4a1234`, everyone can inspect the same artifact instead of arguing about where `latest` pointed yesterday.

For signing link, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## Operational Tradeoffs

SBOMs matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is detail tradeoffs. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

You should read the examples as review evidence, not as commands to paste blindly. A senior reviewer is not looking for perfect-looking YAML. They are looking for a chain of proof: this image was built from this source, contains these components, passed these checks, and runs with these limits.

```dockerfile
FROM node:22-slim AS build
WORKDIR /workspace
COPY package*.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

The first diagnostic step is to anchor the discussion to a digest. A tag can help humans find an image, but the digest identifies the immutable content. When a report mentions `ghcr.io/devpolaris/orders-api@sha256:2f4a1234`, everyone can inspect the same artifact instead of arguing about where `latest` pointed yesterday.

For detail tradeoffs, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

---

**References**

- [SPDX specification](https://spdx.dev/specifications/) - Official or canonical reference for the behavior described in this article.
- [CycloneDX specification](https://cyclonedx.org/specification/overview/) - Official or canonical reference for the behavior described in this article.
- [CISA SBOM resources](https://www.cisa.gov/sbom) - Official or canonical reference for the behavior described in this article.
- [Syft documentation](https://github.com/anchore/syft) - Official or canonical reference for the behavior described in this article.
