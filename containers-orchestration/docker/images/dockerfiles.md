---
title: "Dockerfiles"
description: "Understand a Dockerfile as the recipe that turns application source into a repeatable image filesystem and runtime defaults."
overview: "A Dockerfile gathers the knowledge needed to run an application into one build recipe. This article follows one small service through the instructions that create its filesystem and container defaults."
tags: ["docker", "dockerfile", "images"]
order: 1
id: article-containers-orchestration-docker-dockerfiles
aliases:
  - dockerfiles
  - containers-orchestration/docker/dockerfiles.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [The Recipe](#the-recipe)
3. [Base Image](#base-image)
4. [Working Directory](#working-directory)
5. [Copy and Run](#copy-and-run)
6. [Runtime Defaults](#runtime-defaults)
7. [Multi-Stage Builds](#multi-stage-builds)
8. [Failure Modes](#failure-modes)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem

The team has agreed to use Docker, but the first Dockerfile becomes another hidden setup script. It copies the whole repository, installs dependencies, runs a build, and starts the application. It works on the first laptop. Then the image becomes large, rebuilds are slow, CI sometimes uses stale files, and production starts with development-only packages still present.

The problem is not that the Dockerfile is complicated. The problem is that a Dockerfile is doing two different kinds of work, and the difference is easy to miss:

- Some instructions create the image filesystem.
- Some instructions set defaults that containers will read later.
- Some files are needed only while building and should not remain in the final runtime image.

A Dockerfile is a recipe with build steps and image metadata. Docker reads it instruction by instruction, creates intermediate build states, records filesystem changes, and stores image configuration. If you understand which instruction affects which output, the file becomes a readable build plan instead of a pile of commands.

## The Recipe

Here is a small Dockerfile for an API that compiles TypeScript and starts a Node server:

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

Read it from top to bottom as a chain of filesystem states. The base image provides a starting filesystem with Node installed. `WORKDIR` chooses where later commands run. `COPY` brings files from the build context into the image. `RUN` executes commands inside a temporary build container and records the resulting filesystem. The final `ENV`, `EXPOSE`, and `CMD` lines shape containers created from the image.

The Dockerfile has two outputs:

| Output | Built by | Used when |
| --- | --- | --- |
| Image filesystem | `FROM`, `COPY`, `RUN` | A container starts and reads files |
| Image configuration | `WORKDIR`, `ENV`, `EXPOSE`, `CMD`, `ENTRYPOINT` | Docker creates the container |

Many Dockerfile mistakes come from treating those outputs as one thing. Installing dependencies changes the filesystem. Setting `CMD` does not start the server during the build. Exposing a port documents container intent. It does not publish a host port.

## Base Image

Every normal Dockerfile starts with `FROM`. The base image is the filesystem and metadata your image begins with:

```dockerfile
FROM node:22-alpine
```

This line says the image should start from a published Node image variant. The tag matters because it controls which operating-system packages, runtime version, package manager behavior, and default metadata enter your build. A broad tag can move over time. A narrow tag is more predictable but still points to a mutable name unless you pin by digest, which the registry article covers later.

The base image choice is an architecture decision. A very small base can reduce image size and attack surface, but it may lack shell tools, certificates, native libraries, or debugging utilities. A larger base may be easier to debug but carries more packages than the application needs. The right choice depends on the runtime, dependency needs, and how the image will be maintained.

The non-obvious rule is that the base image is part of your application supply chain. If the base image changes, your image can change even when your source code does not. Rebuilds include inputs from your repository and from the image you inherit.

## Working Directory

`WORKDIR` sets the directory for later build instructions and for the default container process unless runtime settings override it:

```dockerfile
WORKDIR /app
```

If `/app` does not exist, Docker creates it. After this point, `COPY package*.json ./` copies into `/app`, and `RUN npm ci` runs from `/app`. Without a stable working directory, commands depend on whatever directory the base image happens to define.

That sounds small, but it removes a class of build bugs. Dependency installers, compilers, and relative paths all assume a current directory. The Dockerfile should choose that directory explicitly so future base image changes do not silently move the build.

## Copy and Run

`COPY` brings files from the build context into the image. `RUN` executes a command during the build and records the filesystem changes:

```dockerfile
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
```

The order is deliberate. Dependency installation depends on the package manifests, so those files are copied first. Source files change more often, so they are copied later. That order lets Docker reuse the dependency layer when source changes do not affect dependencies.

`RUN` is build time. It should create files the final image needs, such as installed packages or compiled output. It should not start a long-running application server as the main service. If `RUN npm start` appears in a Dockerfile, the build will try to run the server while building the image, then hang or exit. The server belongs in `CMD` or `ENTRYPOINT`, which Docker reads later when creating a container.

The other subtlety is that `COPY . .` is rarely the best first copy. It makes every file in the context part of the cache key for the next steps. A README edit, local test artifact, or generated directory can invalidate work that did not logically depend on it. A later article focuses on build context and `.dockerignore`, but the Dockerfile already shows the core idea: copy stable inputs before noisy inputs.

## Runtime Defaults

The final lines do not install anything:

```dockerfile
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

They set defaults. `ENV` records an environment value that containers inherit unless the run command overrides it. `EXPOSE` records the container port the application expects to listen on. `CMD` records the default process.

The process model is worth making explicit. A container lives as long as its main process lives. If `node dist/server.js` exits, the container stops. If the command points at a missing file, the container exits quickly. If the command starts a wrapper script that does not handle signals properly, stopping the container can become slow or unreliable.

The JSON-array form of `CMD` is usually preferred because Docker can start the executable directly without a shell interpreting the command string. That reduces quoting surprises and makes signal delivery clearer.

## Multi-Stage Builds

Some files are useful for building but unnecessary at runtime. A TypeScript service may need the compiler, source files, and development dependencies to produce `dist`. The running service may only need the Node runtime, production dependencies, and compiled output.

Multi-stage builds let one Dockerfile use separate stages:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

The first stage has everything needed to compile. The second stage starts fresh and copies only the result it needs. The final image does not automatically include every file from the build stage. That makes the image smaller and reduces the chance that source files, caches, or build-only tools ship to production.

This is the same Dockerfile mechanism used with more discipline. Stages are named build states. `COPY --from=build` crosses from one state into another deliberately.

## Failure Modes

Dockerfile failures usually point to a specific part of the recipe.

If `COPY` cannot find a file, the file is probably outside the build context, excluded by `.dockerignore`, or named differently than the Dockerfile expects. Dockerfiles cannot copy arbitrary host paths unless those paths are part of a context or named build source.

If dependency installation is slow after every source edit, instruction order is probably tying stable dependency work to noisy source files. Copy package manifests before copying the rest of the application.

If a container exits with "file not found," the image may not contain the file that `CMD` references, or `WORKDIR` may differ from the path assumed by the command. Inspect the Dockerfile as a filesystem story: which instruction created the file, and where?

If a secret appears in image history, it was probably copied or echoed during a build step. Removing it in a later layer is not enough because earlier layer data can still exist in the image. Keep secrets out of the context or use BuildKit secret mounts when a build step genuinely needs temporary credentials.

## Putting It All Together

The Dockerfile is the contract between source code and image artifact.

- `FROM` chooses the starting filesystem and supply-chain base.
- `WORKDIR` makes paths predictable for later instructions and containers.
- `COPY` controls which build-context files enter the image.
- `RUN` performs build-time work and records filesystem changes.
- `ENV`, `EXPOSE`, and `CMD` record runtime defaults for containers.
- Multi-stage builds separate build-only tools from the final runtime image.

The team from the opener did not need a longer Dockerfile. They needed a Dockerfile where each instruction had a clear job and each job matched the artifact they wanted to ship.

## What's Next

The next article zooms in on the build context and `.dockerignore`. A Dockerfile can only copy what the builder can see, and that visibility boundary decides whether your image is clean, fast to build, and free of accidental local files.

---

**References**

- [Docker Docs: Dockerfile overview](https://docs.docker.com/build/concepts/dockerfile/)
- [Docker Docs: Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Docker Docs: Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker Docs: Docker overview](https://docs.docker.com/get-started/docker-overview/)
