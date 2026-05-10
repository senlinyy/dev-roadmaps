---
id: article-devsecops-container-image-security-runtime-container-hardening
title: "Runtime Container Hardening"
description: "Run containers with fewer Linux privileges, clearer resource limits, and safer runtime defaults."
overview: "Runtime hardening controls what a container can do after it starts. You will learn how Linux users, capabilities, filesystems, seccomp, and Kubernetes security settings reduce the damage from application compromise."
tags: ["runtime", "linux", "containers"]
order: 6
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

Runtime Container Hardening matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is runtime boundary. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

You should read the examples as review evidence, not as commands to paste blindly. A senior reviewer is not looking for perfect-looking YAML. They are looking for a chain of proof: this image was built from this source, contains these components, passed these checks, and runs with these limits.

```yaml
securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
```

The first diagnostic step is to anchor the discussion to a digest. A tag can help humans find an image, but the digest identifies the immutable content. When a report mentions `ghcr.io/devpolaris/orders-api@sha256:2f4a1234`, everyone can inspect the same artifact instead of arguing about where `latest` pointed yesterday.

For runtime boundary, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## The devpolaris-orders-api Thread

Runtime Container Hardening matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is non root user. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

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

For non root user, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## The Smallest Useful Artifact

Runtime Container Hardening matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is capabilities. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

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

For capabilities, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## Reading The Evidence

Runtime Container Hardening matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is read only filesystem. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

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

For read only filesystem, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## Diagnostic Path Before Changes

Runtime Container Hardening matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is resource limits. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

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

For resource limits, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## Failure Modes And Fix Directions

Runtime Container Hardening matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is Kubernetes context. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

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

For Kubernetes context, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## Review Questions For Pull Requests

Runtime Container Hardening matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is secrets and host access. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

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

For secrets and host access, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

## Operational Tradeoffs

Runtime Container Hardening matters when the team can connect a security idea to a specific image that will run somewhere. In this section, the image is `devpolaris-orders-api`, built with Docker, published to GHCR for review, and promoted to ECR for production. The service listens on port `3000`, exposes `GET /health`, and is deployed by digest after the release workflow records evidence.

The concept in focus here is hardening tradeoffs. In plain terms, it is the part of the container workflow that helps you answer one operational question before the image reaches production. The question may be what files are present, which known vulnerabilities are reported, who produced the digest, who can replace it in the registry, or what Linux privileges the process receives after startup.

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

For hardening tradeoffs, the useful evidence is small and specific. Capture the command output that proves the claim, the file or policy that controls the behavior, and the failure text that appears when the behavior is wrong. A long terminal transcript is weaker than five lines that show the image, actor, package, setting, or denied operation.

A realistic failure path starts with one mismatch. The Dockerfile says the process runs as `node`, but inspection shows an empty user field. The scanner report says a package is vulnerable, but the base image has a vendor backport. The signature verifies, but the certificate identity belongs to a pull request workflow instead of the release workflow. Each mismatch points to a different fix direction.

Do not fix these problems by adding broad permissions or copying more files into the image. Fix the durable boundary. Update the Dockerfile, dependency lockfile, registry policy, signing workflow, deployment manifest, or exception record. Then rebuild or republish the image so the new evidence belongs to a new digest.

For pull request review, ask three questions. What exact artifact will run? Which command proves the claim in this section? What would fail if this control were removed? If the answer depends on a person remembering a manual step, move that step into CI or a checked-in policy.

The tradeoff is worth naming in the pull request. Tighter images reduce scan noise but can remove shell diagnostics. Strict scan gates catch known risks but can block urgent changes. Signatures prove producer identity but need verification policy. Registry separation improves access control but adds promotion work. Runtime hardening reduces blast radius but exposes hidden write and permission assumptions.

Keep the orders API thread visible as you learn the topic. The service is ordinary, and that is the point. Container security work becomes repeatable when the team can apply the same evidence pattern to every normal API, worker, and scheduled job it ships.

---

**References**

- [Docker container security](https://docs.docker.com/engine/security/) - Official or canonical reference for the behavior described in this article.
- [Kubernetes security context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Official or canonical reference for the behavior described in this article.
- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) - Official or canonical reference for the behavior described in this article.
- [Linux capabilities](https://man7.org/linux/man-pages/man7/capabilities.7.html) - Official or canonical reference for the behavior described in this article.
- [Kubernetes seccomp](https://kubernetes.io/docs/tutorials/security/seccomp/) - Official or canonical reference for the behavior described in this article.
