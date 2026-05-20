---
title: "Minimal Base Images"
description: "Choose container base images that keep runtime files small, patchable, and easier to inspect."
overview: "A base image is the filesystem your application starts from. This article explains what travels in a runtime image, how multi-stage builds remove build tools, and why smaller images are easier to scan and patch."
tags: ["images", "base-images", "docker"]
order: 1
id: article-devsecops-container-image-security-minimal-base-images
---

## Table of Contents

1. [What Is a Base Image?](#what-is-a-base-image)
2. [What Ships With Your App](#what-ships-with-your-app)
3. [Build Stage and Runtime Stage](#build-stage-and-runtime-stage)
4. [Comparing Images](#comparing-images)
5. [Tradeoffs](#tradeoffs)
6. [Review Evidence](#review-evidence)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## What Is a Base Image?

A container image is a filesystem plus metadata. Your application files sit on top of a base image. The base image may contain a Linux distribution, package manager, shell, CA certificates, language runtime, libraries, and tools.

For `devpolaris-orders-api`, a base image might be `node:22`, `node:22-slim`, or a distroless Node image. Each choice changes what ships with the app.

```text
orders-api image
|-- application files
|-- node runtime
|-- operating system libraries
|-- certificates
|-- shell and package manager
`-- extra tools
```

Minimal base images reduce what travels into production. Fewer packages usually means fewer known vulnerabilities, fewer tools available to an attacker after compromise, and less content for reviewers to inspect.

## What Ships With Your App

A common beginner surprise is that a container image ships operating system files as well as application files. If the image starts from a full distribution, it may include shell utilities, package-manager metadata, documentation, and libraries your app never uses.

The first review artifact is an image inventory:

```text
Image: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
Base: node:22-slim
Application size: 38 MB
OS packages: 92
Package manager present: yes
Shell present: yes
Runs as root: no
```

The `Base` line tells you where the filesystem starts. `OS packages` gives scanning scope. `Package manager present` and `Shell present` tell you what tools exist inside the running container. `Runs as root` belongs here because base image choice often affects default users.

## Build Stage and Runtime Stage

Multi-stage builds separate tools needed to build from files needed to run.

```Dockerfile
FROM node:22 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/server.js"]
```

The `build` stage has the full toolchain. It installs dependencies and compiles the application. The `runtime` stage starts from a smaller image and receives only the files needed to run. The `USER node` line prevents the process from running as root by default.

This pattern is useful because production does not need the whole build workspace. If test fixtures, build caches, local config, or development dependencies remain in the runtime image, they become part of the shipped artifact.

## Comparing Images

Compare images with facts instead of feelings.

| Image | Size | OS packages | Shell | Package manager | Debuggability |
|-------|------|-------------|-------|-----------------|---------------|
| `node:22` | Larger | More | Yes | Yes | Easier |
| `node:22-slim` | Medium | Fewer | Yes | Limited | Still familiar |
| Distroless Node | Smaller | Minimal | Usually no | No | Harder |

Smaller is not automatically better for every team. A distroless image can reduce runtime contents, but it also removes tools engineers may use during debugging. The right question is whether the runtime image contains what the service needs and whether the team has another debugging path when production is broken.

For the orders API, `node:22-slim` may be a practical first step. It removes some unused content while keeping enough familiar behavior for the team. A later move to distroless can happen after logging, health checks, and debug procedures are mature.

## Tradeoffs

Minimal images introduce a real operational tradeoff. If a container has no shell, you cannot `kubectl exec` into it and run `sh`, `cat`, or `curl`. That is often good for security, but it changes incident response.

The replacement is better runtime evidence:

```text
Debug path without shell
- health endpoint exposes version and dependency status
- structured logs include request IDs
- metrics show error rates and latency
- ephemeral debug container can inspect the pod network
- image digest and SBOM are available from release evidence
```

The goal is to avoid depending on random tools inside the production image. The app should explain itself through logs, metrics, health checks, and release evidence.

## Review Evidence

A base image review should record the before and after.

```text
Service: devpolaris-orders-api
Old base: node:22
New base: node:22-slim
Reason: reduce unused OS packages in runtime image
Build tools removed: yes, multi-stage build
Runtime user: node
Scanner result: critical 0, high 2
Debug impact: shell remains available
Owner: orders-team
```

This record gives the reviewer enough context to understand the tradeoff. If a later scanner finding appears, the team can see which base image introduced it.

## Putting It All Together

A base image is the filesystem your application inherits. Minimal base images reduce the amount of operating system content, tools, and package metadata that travel into production. Multi-stage builds keep build tools out of the runtime layer.

For `devpolaris-orders-api`, the practical habit is to choose a base image deliberately, compare image contents, run as a non-root user, remove development files from runtime layers, and keep a debug path that does not depend on a large production image.

## What's Next

Once you know what is inside the image, scan it. The next article explains how image scanners turn operating system and application package metadata into security findings.

---

**References**

- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/) - Docker documents using separate build and runtime stages.
- [Dockerfile best practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/) - Docker documents practical image-building guidance, including base image and layer choices.
- [Google Distroless images](https://github.com/GoogleContainerTools/distroless) - Distroless documents minimal runtime images that omit package managers and shells.
