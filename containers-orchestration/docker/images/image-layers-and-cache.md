---
title: "Image Layers and Cache"
description: "Understand Docker image layers, build cache rules, BuildKit cache mounts, and multi-stage builds for faster and smaller production images."
overview: "Docker images are built from layers, and Docker uses those layers to decide which build steps can be reused. This article follows the shipping API through slow rebuilds, cache-friendly instruction order, BuildKit cache mounts, and multi-stage runtime images."
tags: ["docker", "cache", "images", "multi-stage"]
order: 2
id: article-containers-orchestration-docker-image-layers-and-cache
---

## Table of Contents

1. [Why the Second Build Got Slow](#why-the-second-build-got-slow)
2. [Image Layers and Content Reuse](#image-layers-and-content-reuse)
3. [Cache Invalidation Rules](#cache-invalidation-rules)
4. [Cache-Friendly Dockerfile Ordering](#cache-friendly-dockerfile-ordering)
5. [BuildKit Cache Mounts](#buildkit-cache-mounts)
6. [Multi-Stage Builds](#multi-stage-builds)
7. [The Runtime Writable Layer](#the-runtime-writable-layer)
8. [External Cache in CI](#external-cache-in-ci)
9. [A Practical CI Build Pattern](#a-practical-ci-build-pattern)
10. [What's Next](#whats-next)

## Why the Second Build Got Slow
<!-- section-summary: The shipping-api team already has a clean Dockerfile, and the next production problem is learning why Docker reuses some build work and repeats other work. -->

In the previous article, the `shipping-api` team cleaned up the first Dockerfile. The build context stayed small, `.env` stayed out, the lockfiles entered before `src/`, and the image started with safe runtime defaults.

Now the team hits the next real build problem. A developer changes one route handler in `src/routes.js`, CI runs the image build again, and the log spends another few minutes installing dependencies while `package-lock.json` stayed the same.

That problem gives us the path for this article. First we need **image layers**, because Docker stores image filesystem changes as reusable pieces. Then we need **cache invalidation**, because Docker has rules for deciding when a previous build result still matches the current inputs. After that, Dockerfile ordering, BuildKit cache mounts, external cache, multi-stage builds, and the runtime writable layer all connect back to the same idea: keep stable work reusable and keep production images focused.

A **cache hit** means Docker reused the result of an earlier build step. A **cache miss** means Docker ran that step again and then had to evaluate the steps after it on top of the new result. The difference between those two words can decide whether a team gets a 20-second image build or a 6-minute image build.

## Image Layers and Content Reuse
<!-- section-summary: A Docker image is made from reusable read-only filesystem layers plus image metadata, and those layers let builds and containers share content. -->

An **image layer** is a stored filesystem change inside an image. You can think of it as one saved checkpoint in the image filesystem history: one layer may contain the Node base image files, another may contain `/app/package.json`, another may contain `node_modules`, and another may contain `src/`.

An image also has **metadata**. Metadata includes values such as the default command, environment variables, exposed ports, labels, and the default user. Instructions that change files contribute filesystem data, while instructions such as `CMD`, `ENV`, `EXPOSE`, and `USER` mainly shape the image configuration that Docker uses when a container starts.

Here is the first `shipping-api` Dockerfile from the previous article:

```dockerfile
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
USER node
EXPOSE 3000

CMD ["node", "src/server.js"]
```

The base image supplies its own layers. The `COPY package.json package-lock.json ./` step records the package files, the `RUN npm ci --omit=dev` step records the installed production dependencies, and the `COPY src ./src` step records the application source.

Docker can reuse layer content when the same content already exists in the builder or engine. If another image on the same machine uses `node:22-alpine`, Docker can share those base layers instead of storing another full copy. If the `npm ci` step matches a previous build, Docker can reuse the dependency layer instead of downloading and installing every package again.

A local inspection makes this visible:

```bash
docker buildx build --progress=plain -t shipping-api:layers .
docker image history shipping-api:layers
```

The build output shows which steps ran and which steps came from cache. The history output shows the image instructions and their contribution to image size, which helps the team spot large dependency layers, broad copy steps, or accidental build artifacts.

![Docker cache hit and miss infographic showing the first shipping-api build creating each Dockerfile step and a later src/routes.js edit reusing FROM, WORKDIR, and npm dependency steps while rebuilding COPY src and CMD metadata](/content-assets/articles/article-containers-orchestration-docker-image-layers-and-cache/cache-hit-miss-flow.png)

_This infographic shows the cache chain after a small route edit: stable setup and dependencies stay reusable, while the source copy and later image metadata need a new result._

This layer history also explains a security rule from the previous article. If a secret enters one layer and a later instruction removes it, the secret may still exist in the earlier layer history. A production team keeps secrets outside the build context and uses dedicated secret mounts for build-time secrets because earlier layer history can survive later file deletion.

Layers explain how Docker stores the image. The next question is how Docker decides whether it can reuse a layer from an earlier build.

## Cache Invalidation Rules
<!-- section-summary: Docker checks each Dockerfile instruction against the current inputs, and one cache miss makes later instructions run on top of a new result. -->

**Cache invalidation** means Docker decides that a previous build result stopped matching the current Dockerfile instruction and its relevant inputs. Docker reads the Dockerfile in order, checks each instruction, and either reuses a previous result or runs the instruction again.

The order matters because every instruction depends on the filesystem and metadata created by the instructions above it. When an early instruction gets a cache miss, the instructions after it need fresh results too because they now run on top of a different parent result.

For most `RUN` instructions, Docker compares the instruction text and the build state that came before it. If the Dockerfile still says `RUN npm ci --omit=dev` and the earlier state matches, Docker can reuse that layer. Time passing by itself leaves the cached result eligible, so a package install step can keep using a cached result until the instruction, its inputs, or an earlier layer changes.

For `COPY` and `ADD`, Docker checks the files involved in the instruction. Docker calculates a cache checksum from file metadata for the source files, and a relevant metadata change invalidates the cache. Docker ignores file modification time, usually called **mtime**, when it calculates that checksum, so a timestamp-only change leaves the cache match intact.

This detail matters when tools restore files, unpack archives, or touch files during local workflows. A content change, permissions change, ownership change, file size change, or path change can affect the cache. A changed clock timestamp alone gives Docker no reason to treat the copied file content as changed.

Here is the version that hurts `shipping-api`:

```dockerfile
FROM node:22-alpine
WORKDIR /app

COPY . .
RUN npm ci --omit=dev
RUN npm test

CMD ["node", "src/server.js"]
```

The broad `COPY . .` step uses every included file in the build context as an input. A route edit changes the input to that copy step, so Docker creates a new result for it. The dependency install and test steps sit below that miss, so they run again even when the dependency lockfile stayed exactly the same.

The cache rules also explain package update surprises. If a Dockerfile has `RUN apk add curl` or `RUN apt-get update && apt-get install -y curl`, Docker can reuse the cached result when the command text and previous state match. Teams usually handle base image and operating system package updates intentionally with scheduled rebuilds, base image updates, dependency review, or a one-off `--no-cache` build when they need to force fresh package resolution.

The cache rules are strict, which helps repeatability. The Dockerfile should place stable, expensive inputs before noisy application inputs so the strict rules work in the team's favor.

## Cache-Friendly Dockerfile Ordering
<!-- section-summary: Cache-friendly ordering separates stable dependency inputs from frequently changing source files so ordinary edits keep expensive layers reusable. -->

A **stable input** is a file or setting that changes rarely. For `shipping-api`, `package.json` and `package-lock.json` are stable compared with route handlers, controllers, templates, and tests. A **noisy input** changes often during normal feature work.

The best build order puts stable inputs before expensive work, then puts noisy source files later. This gives Docker a small and meaningful set of files to check before the dependency install. When a route changes, Docker only needs to rebuild the source copy and the steps below it.

The cache-friendly version looks like this:

```dockerfile
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
USER node
EXPOSE 3000

CMD ["node", "src/server.js"]
```

Now `npm ci --omit=dev` depends on the package manifests and the previous base state. A change in `src/routes.js` affects the later `COPY src ./src` step, while the dependency install remains reusable. A change in `package-lock.json` reruns the install, which is the correct result because the dependency graph changed.

The same habit works across common stacks:

| Stack | Stable files copied before install | Noisy files copied later |
|---|---|---|
| Node.js | `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` | `src/`, views, public assets |
| Python | `pyproject.toml`, `requirements.txt`, lockfiles | application packages and scripts |
| Java | `pom.xml`, Gradle files, wrapper files | `src/main`, `src/test` |
| Go | `go.mod`, `go.sum` | `.go` source files |

There is also a review benefit. A Dockerfile that says `COPY src ./src` tells the reviewer exactly what enters the runtime image at that point. A broad `COPY . .` asks the reviewer to combine the Dockerfile, `.dockerignore`, and the whole repository tree in their head.

In production, teams usually pair this ordering with a strict `.dockerignore` and lockfile-based installs. The lockfile gives the dependency step a precise input, and the ignore file keeps local noise such as `.git`, `node_modules`, coverage output, and temporary files away from cache checks.

Instruction order saves the expensive layer when source changes. The next problem appears when the install really does need to run, especially on a clean CI machine with an empty package cache.

## BuildKit Cache Mounts
<!-- section-summary: BuildKit cache mounts give package managers a reusable download cache during a RUN step without adding that cache directory to the final image. -->

A **BuildKit cache mount** is a reusable directory that exists during a specific `RUN` instruction. The build command can read and write that directory across builds, which helps package managers reuse downloaded packages, compiled objects, or module caches.

For `shipping-api`, npm already creates a download cache. The image needs `node_modules` at runtime, and npm's tarball download cache belongs in the builder cache. A BuildKit cache mount keeps those tarballs in the builder cache instead of baking them into an image layer.

Here is the same dependency step with a cache mount:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,id=shipping-api-npm,target=/root/.npm \
    npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
USER node
EXPOSE 3000

CMD ["node", "src/server.js"]
```

The `id=shipping-api-npm` value gives the cache a stable name. The `target=/root/.npm` value tells BuildKit where to mount it inside the build container for that one `RUN` instruction. The installed packages under `/app/node_modules` become part of the image layer, while the npm download cache stays in BuildKit's cache storage.

A build can use the cache mount like this:

```bash
docker buildx build --progress=plain -t shipping-api:cache-mount .
```

The first run still downloads packages because the cache starts empty. Later runs can reuse package downloads when the install step runs again, so a lockfile change or a cold dependency layer may still avoid downloading every package from the public registry.

Different tools need different cache directories. Python projects often mount pip's cache directory, Go projects often mount `/go/pkg/mod` and `/root/.cache/go-build`, and apt-based package installs often need locked sharing because apt expects exclusive access to its data files.

For apt, a build step may look like this:

```dockerfile
# syntax=docker/dockerfile:1

FROM ubuntu:24.04

RUN rm -f /etc/apt/apt.conf.d/docker-clean
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates
```

The `sharing=locked` option matters for package managers that expect one writer at a time. Parallel builds using the same cache wait instead of writing to the same files at the same moment.

Cache mounts are a performance tool. A production build should still succeed with an empty cache because builders can prune cache data, CI machines can start fresh, and cache backends can change. The Dockerfile should treat the cache mount as a speed boost, while required application files should come from the build context, earlier stages, or package installs.

![BuildKit cache and multi-stage build infographic showing npm downloads stored outside the image, deps build and prod-deps stages, dist output, production dependencies, and the final runtime image](/content-assets/articles/article-containers-orchestration-docker-image-layers-and-cache/buildkit-multistage-flow.png)

_This infographic connects the two ideas: cache mounts speed up package installs, and multi-stage builds decide which artifacts move into the final runtime image._

Cache mounts help with repeated downloads. Multi-stage builds solve a different problem: separating build-time tools from the final runtime image.

## Multi-Stage Builds
<!-- section-summary: Multi-stage builds use separate Dockerfile stages for dependencies, tests, builds, and runtime files so production images ship only what they need. -->

A **multi-stage build** uses more than one `FROM` instruction in one Dockerfile. Each `FROM` starts a new stage, and later stages can copy selected files from earlier stages with `COPY --from=...`.

This matters because build-time files and runtime files often differ. A Node service may need test tools, TypeScript, bundlers, and development dependencies while building. The running container usually needs only production dependencies, compiled output, and the runtime command.

Here is a practical `shipping-api` version where the app builds to `dist/`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=shipping-api-npm,target=/root/.npm \
    npm ci

FROM deps AS build
COPY src ./src
RUN npm test
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=shipping-api-npm,target=/root/.npm \
    npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

The `deps` stage installs the full dependency set so tests and the build can run. The `build` stage adds source code, runs tests, and creates the compiled `dist/` output. The `prod-deps` stage installs only production dependencies from the same lockfile. The final `runtime` stage copies production dependencies and compiled output, then runs as the `node` user.

The important bridge is `COPY --from=build /app/dist ./dist`. That line copies from another build stage instead of copying from the build context. Source files, test files, development dependencies, and build caches stay out of the final image unless the Dockerfile explicitly copies them into the runtime stage.

Multi-stage builds also make debugging easier in CI. The team can stop at a specific stage when they want to inspect a build failure, and that gives the team a focused log for the build and test step.

```bash
docker buildx build --target build --progress=plain -t shipping-api:build-stage .
```

For compiled languages, this pattern often cuts image size dramatically. A Go service can compile in a `golang` stage and copy one binary into a small runtime image. A Java service can build with Maven or Gradle in one stage and copy the final JAR into a runtime stage.

For production Node services, the team should choose the stage layout based on lockfile behavior and native module needs. Some projects install production dependencies in a separate stage, as shown above. Others build a package artifact and install from that artifact. The goal stays practical: the final runtime image contains the files the application needs to start, and build-only tools stay behind.

The image now has cleaner build-time boundaries. The next boundary appears after the image starts and the process writes files.

## The Runtime Writable Layer
<!-- section-summary: A running container adds a thin writable layer above the read-only image layers, so durable application data needs storage outside the container layer. -->

A **runtime writable layer** is the container-specific filesystem layer Docker adds on top of the image layers when a container starts. The image layers remain read-only and shareable, while writes from the running process go into that one container's writable layer.

This gives every container its own scratch area. If `shipping-api` writes `/tmp/label-preview.pdf`, Docker stores that file in the writable layer for that container. If the container is removed, Docker removes that writable layer with it, while the original image stays unchanged.

A local demo can show the idea:

```bash
docker run --name shipping-layer-demo shipping-api:layers \
  sh -c 'printf "temporary label\n" > /tmp/label.txt && sleep 300'

docker ps --size --filter name=shipping-layer-demo

docker rm -f shipping-layer-demo
```

The `docker ps --size` output reports writable-layer size for the running container. This size belongs to that container, and deleting the container removes that data.

Production services should keep durable data outside the writable layer. `shipping-api` should send logs to stdout, store uploaded shipping labels in object storage, keep orders in a database, and use a volume or platform storage feature for data that must survive container replacement. Short-lived scratch files in `/tmp` are fine when the request can finish without needing that file after a restart.

Teams often make this rule visible during hardening by running the container with a read-only root filesystem and a dedicated writable temporary directory. That setup mirrors the way many orchestrators run hardened workloads. A local run can try the same shape.

```bash
docker run --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -p 3000:3000 \
  shipping-api:layers
```

This local run catches accidental writes to `/app`, hidden SQLite files, local upload folders, and libraries that assume the whole filesystem is writable. Container platforms have similar settings, such as read-only root filesystem options and mounted temporary directories.

The runtime writable layer connects back to image layers. The image should carry application code, dependencies, and safe defaults. Runtime state, secrets, uploads, logs, and environment-specific files belong to the platform around the container.

Now the team has a cache-friendly Dockerfile and a clean runtime shape. CI needs one more piece because CI runners often start without the local cache that a developer laptop has.

## External Cache in CI
<!-- section-summary: CI builds need explicit external cache import and export because runners often start clean and lose local BuildKit cache between jobs. -->

An **external cache** stores BuildKit cache data outside the local builder. In CI, this usually means a registry cache, a local directory cache on a persistent runner, an inline cache attached to an image, or a GitHub Actions cache backend.

This matters because many CI runners are short-lived. A laptop may keep BuildKit cache for weeks, but a hosted runner may start from an empty disk for every job. A cache-friendly Dockerfile still helps, and an external cache gives the new runner previous build results to import.

Buildx uses `--cache-from` to import cache and `--cache-to` to export cache:

```bash
docker buildx build \
  --cache-from type=registry,ref=ghcr.io/acme/shipping-api-build-cache:main \
  --cache-to type=registry,ref=ghcr.io/acme/shipping-api-build-cache:main,mode=max \
  --tag ghcr.io/acme/shipping-api:cache-demo \
  --push \
  .
```

The registry cache pattern works well for teams that already push images to a registry. The cache lives next to the release image, and any runner that can authenticate to the registry can import it.

The `mode=max` option exports cache records for intermediate stages as well as the final image result. That helps multi-stage Dockerfiles because the `deps`, `build`, and `prod-deps` stages can all produce reusable work. The default `mode=min` exports less cache data, which can reduce storage and transfer time for simpler builds.

Branch builds need careful cache names. Docker's cache backend documentation warns that writing two builds to the same cache location overwrites the previous data. A common pattern imports cache from both the current branch and `main`, then writes the current branch cache to its own reference.

```bash
docker buildx build \
  --cache-from type=registry,ref=ghcr.io/acme/shipping-api-build-cache:main \
  --cache-from type=registry,ref=ghcr.io/acme/shipping-api-build-cache:feature-shipping-rates \
  --cache-to type=registry,ref=ghcr.io/acme/shipping-api-build-cache:feature-shipping-rates,mode=max \
  --tag ghcr.io/acme/shipping-api:feature-shipping-rates \
  --push \
  .
```

External cache and cache mounts solve related but different problems. External cache helps BuildKit reuse previous build results across machines. Cache mounts help package managers avoid repeated downloads inside a `RUN` step that has to execute. The build should still produce the same image when either cache starts empty.

Now we can combine the pieces into a practical CI pattern for `shipping-api`.

## A Practical CI Build Pattern
<!-- section-summary: A production image pipeline combines Dockerfile checks, cache import/export, a runtime target, immutable image tags, and digest recording. -->

A practical CI build for `shipping-api` has a small sequence. It checks the Dockerfile, builds the `runtime` target, imports cache from `main` and the current branch, exports branch cache, pushes an immutable image tag, and records the digest for deployment.

Here is the command shape a CI job can run after authenticating to the registry:

```bash
set -euo pipefail

IMAGE="ghcr.io/acme/shipping-api"
CACHE_IMAGE="ghcr.io/acme/shipping-api-build-cache"
GIT_SHA="${GIT_SHA:-$(git rev-parse --short=12 HEAD)}"
BRANCH_CACHE="${BRANCH_CACHE:-main}"

docker buildx build \
  --check \
  --file Dockerfile \
  --target runtime \
  .

docker buildx build \
  --file Dockerfile \
  --target runtime \
  --metadata-file build-metadata.json \
  --tag "${IMAGE}:${GIT_SHA}" \
  --cache-from "type=registry,ref=${CACHE_IMAGE}:main" \
  --cache-from "type=registry,ref=${CACHE_IMAGE}:${BRANCH_CACHE}" \
  --cache-to "type=registry,ref=${CACHE_IMAGE}:${BRANCH_CACHE},mode=max" \
  --push \
  .
```

The `--check` run asks Buildx to evaluate Dockerfile build checks before the full build. The second command builds the `runtime` stage, pushes the image, writes cache for the next run, and writes build metadata to `build-metadata.json`.

That metadata file includes the pushed image digest. A deployment system can store `ghcr.io/acme/shipping-api@sha256:...` in release notes, an environment manifest, or a deployment record. The readable tag helps humans find the build, and the digest identifies the exact image content.

In a real team, CI also sets `BRANCH_CACHE` to a registry-safe branch name. For example, `feature/shipping-rates` might become `feature-shipping-rates` before it appears in a cache tag. Main branch builds usually write both the release image tag and the main cache reference so feature branches can import a healthy baseline.

The production guidance stays practical. Keep the Dockerfile ordered around stable inputs, use cache mounts only for speed, export cache explicitly in CI, ship the smallest runtime stage that still has everything the app needs, and record the digest that the registry returns.

![Docker CI cache summary infographic showing stable files first, a buildx builder, registry cache import and export, pushed registry image, recorded digest, runtime target, and writes going outside the container](/content-assets/articles/article-containers-orchestration-docker-image-layers-and-cache/ci-cache-summary.png)

_This summary image shows the production build loop: design the Dockerfile for cache reuse, import and export cache in CI, build the runtime target, record the digest, and keep durable writes outside the container layer._

## What's Next

The `shipping-api` team now understands what Docker is reusing during a build and why a small file change can cause a larger rebuild. Layers explain storage and sharing, cache invalidation explains rebuild behavior, multi-stage builds keep the runtime image focused, and the writable layer explains where runtime changes go.

The next article follows the image after CI pushes it. We will look at **tags**, **digests**, and **registries**, including why teams use readable tags for workflow and immutable digests for production deployment records.

---

**References**

- [Docker build cache](https://docs.docker.com/build/cache/) - Official overview of Docker build cache concepts and why cache-aware Dockerfiles speed up builds.
- [Build cache invalidation](https://docs.docker.com/build/cache/invalidation/) - Documents cache matching rules for Dockerfile instructions, including `COPY`, `ADD`, `RUN`, file metadata checks, and the `mtime` detail.
- [Optimize cache usage in builds](https://docs.docker.com/build/cache/optimize/) - Covers layer ordering, smaller contexts, cache mounts, bind mounts, and external cache as Docker build optimization techniques.
- [Cache storage backends](https://docs.docker.com/build/cache/backends/) - Documents BuildKit external cache backends, registry cache examples, branch cache patterns, and cache export modes.
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/) - Explains multiple `FROM` stages and `COPY --from` for copying selected artifacts into a final stage.
- [docker buildx build](https://docs.docker.com/reference/cli/docker/buildx/build/) - Reference for Buildx options such as `--cache-from`, `--cache-to`, `--target`, `--check`, and `--metadata-file`.
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) - Official reference for Dockerfile syntax, including `RUN --mount=type=cache`, `COPY`, `ADD`, and build mounts.
- [Docker storage drivers](https://docs.docker.com/engine/storage/drivers/) - Explains image layers, writable container layers, copy-on-write behavior, shared read-only data, and Docker storage driver responsibilities.
