---
title: "Image Layers and Cache"
description: "Understand Docker image layers, build cache rules, BuildKit cache mounts, and multi-stage builds for faster and smaller production images."
overview: "Docker images are built from layers, and Docker uses those layers to decide which build steps can be reused. This article follows the shipping API through slow rebuilds, cache-friendly instruction order, BuildKit cache mounts, and multi-stage runtime images."
tags: ["docker", "cache", "images", "multi-stage"]
order: 2
id: article-containers-orchestration-docker-image-layers-and-cache
---

## Table of Contents

1. [Why a Small Edit Can Trigger a Slow Build](#why-a-small-edit-can-trigger-a-slow-build)
2. [Image Layers](#image-layers)
3. [Build Cache Rules](#build-cache-rules)
4. [Ordering the Dockerfile](#ordering-the-dockerfile)
5. [BuildKit Cache Mounts](#buildkit-cache-mounts)
6. [Multi-Stage Builds](#multi-stage-builds)
7. [Runtime Writes](#runtime-writes)
8. [A CI Build Pattern](#a-ci-build-pattern)
9. [What's Next](#whats-next)

## Why a Small Edit Can Trigger a Slow Build
<!-- section-summary: Docker cache problems usually show up when a tiny source edit forces expensive dependency or compile steps to run again. -->

In the previous article, our `shipping-api` team wrote a cleaner Dockerfile. The build context became smaller, secrets stayed out of the context, and dependency files entered the image before source files. That order matters because Docker reuses matching instructions instead of rerunning everything blindly.

Docker uses a **build cache**. The cache is Docker's memory of earlier build steps. If Docker sees the same instruction with the same relevant inputs, it can reuse the result from a previous build. If Docker sees a changed input, it reruns that instruction and then reruns the instructions after it.

Here is the pain version of the story. A developer changes one route in `src/routes.js`. The application code changed, and the dependencies stayed the same. Still, CI spends three minutes running `npm ci` again. The teammate watching the log asks the right beginner question: why did a tiny route edit make the dependency install happen again?

The answer lives in **image layers** and **cache invalidation**. Docker caches build steps and filesystem changes rather than one big application object. Once one step loses its cache, later steps have to run on top of the new result.

So now we will take the same `shipping-api` Dockerfile and look under the build. First, we need the layer idea, because cache reuse only makes sense once layers make sense.

## Image Layers
<!-- section-summary: An image is a stack of read-only filesystem changes plus metadata, and Docker can share those layers across builds and containers. -->

An **image layer** is one stored filesystem change in a Docker image. When a Dockerfile instruction changes files, Docker can save that change as a layer. The final image is a stack of these read-only layers plus metadata such as environment variables, exposed ports, the default command, and the configured user.

Here is a small Dockerfile again:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
CMD ["node", "src/server.js"]
```

The base image contributes its own layers. The dependency install creates a layer with the installed production packages. The source copy creates a layer with `src/`. Docker stores these layers separately, so another image that uses the same base can share the same base layers, and another build with the same dependency install can reuse that dependency layer.

The layer idea also explains why deleting a file later leaves earlier history intact. If a secret enters the image in one layer and a later instruction deletes it, the final filesystem view may hide the file, while the earlier layer still exists in the image history. The safe path is keeping secrets out of the build context and out of the Dockerfile in the first place.

At runtime, Docker adds a **writable container layer** above the read-only image layers. The application process sees one normal filesystem, but Docker stores runtime writes in that container-specific writable layer. If you start ten containers from the same image, they share the read-only image layers and each container gets its own writable layer.

On Linux systems using the classic `overlay2` storage driver, Docker presents this stack through OverlayFS with lower read-only directories, an upper writable directory, and a merged view. Docker Engine can also use the containerd image store and snapshotters on newer installations. For application developers, the practical idea stays the same: image layers are read-only, and container writes sit above them.

Now that layers are clear, the cache rule becomes more concrete. Docker asks whether it can reuse the layer that came from a previous instruction.

## Build Cache Rules
<!-- section-summary: Docker checks each instruction against previous results, and one cache miss causes every later instruction to run again. -->

**Cache invalidation** means Docker decides a previous build result no longer matches the current build. After that happens, Docker runs the instruction again and builds new results for the instructions below it. This is why one early change can make a later compile or dependency install run again.

Docker uses different checks for different instructions. For a normal `RUN` instruction, Docker mostly compares the command text. If the command still says `RUN npm ci --omit=dev`, Docker uses that command text and the build state leading into the instruction as the cache match.

For `COPY` and `ADD`, Docker must inspect the source files from the build context. If the Dockerfile says `COPY package.json package-lock.json ./`, Docker checks the files involved in that copy. If the package files changed, that copy step loses cache. If those files stayed the same, Docker can reuse the result.

Docker's official cache documentation calls out a detail that helps with debugging: file modification time alone leaves the cache valid for copied files. Docker uses file metadata checks, and an `mtime` change by itself still keeps the cache match. A content or relevant metadata change matters more than a clock timestamp.

The cascading part matters most. Once one instruction loses cache, Docker reruns that instruction and every following Dockerfile command. Later commands may look identical, but they now need to run on top of a new parent result. That is why instruction order has such a big effect on build speed.

Here is the slow version:

```dockerfile
FROM node:22-alpine
WORKDIR /app

COPY . .
RUN npm ci --omit=dev
RUN npm test

CMD ["node", "src/server.js"]
```

Any source edit changes the broad `COPY . .` input. That cache miss forces `npm ci` and `npm test` to run again. Docker is following the rules correctly; the Dockerfile gave it a noisy input too early.

The fix is ordering the Dockerfile around stable and changing inputs.

## Ordering the Dockerfile
<!-- section-summary: Cache-friendly Dockerfiles place stable, expensive work before frequently changing application source files. -->

A **stable input** changes rarely. A dependency lockfile is stable compared with application source code. A base image reference may stay the same for a sprint. An operating system package list may change only during dependency updates. A **noisy input** changes often, like route handlers, templates, tests, and generated local files.

Dockerfiles build faster when stable expensive work appears before noisy work. This gives Docker the best chance to reuse the heavy layers. For `shipping-api`, the dependency install should depend on `package.json` and `package-lock.json`, then the source code should enter after that.

The cache-friendly version looks like this:

```dockerfile
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

CMD ["node", "src/server.js"]
```

Now a route edit changes only the source copy layer and the layers below it. The dependency install layer survives because its inputs stayed the same. A dependency update still reruns `npm ci`, which is correct because the dependency graph changed.

This pattern applies to other languages too:

| Stack | Stable files first | Noisy files after |
|---|---|---|
| Node.js | `package.json`, lockfile | `src/`, views, public assets |
| Python | `pyproject.toml`, `requirements.txt`, lockfile | application package files |
| Java | `pom.xml` or Gradle files | `src/main`, `src/test` |
| Go | `go.mod`, `go.sum` | `.go` source files |

There is also a security benefit. A Dockerfile that copies only the paths it needs gives reviewers fewer places to inspect. `COPY src ./src` says exactly what enters the runtime image. `COPY . .` asks the reader to know every file that survived `.dockerignore`.

Instruction order solves the big dependency cache problem. The next slow spot appears when a clean CI runner has no local npm cache at all. Docker can reuse layers only after it has them. BuildKit cache mounts help with that package-download problem.

## BuildKit Cache Mounts
<!-- section-summary: BuildKit cache mounts let package managers keep reusable download caches without baking those cache files into the final image layer. -->

A **BuildKit cache mount** gives one `RUN` instruction a reusable cache directory during the build. The package manager can write downloaded artifacts there, and later builds can reuse those files. The cache mount helps the build run faster without copying the cache directory into the final image filesystem.

For npm, a common version looks like this:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY src ./src

CMD ["node", "src/server.js"]
```

The `--mount=type=cache,target=/root/.npm` part gives npm a cache location during that `RUN`. The installed `node_modules` still becomes part of the image layer because the command writes it into `/app`. The package tarballs under `/root/.npm` stay in the build cache instead of becoming runtime files.

This distinction matters. The image should contain the files needed to run the application. The build system can keep extra download caches for speed. Mixing those two concerns creates larger images and surprising runtime files.

Other package managers use the same idea with different paths. Python builds may cache pip downloads. Go builds may cache module downloads and compiler output. Apt-based system package installs can also use cache mounts, though teams usually combine that with careful cleanup and base image policy.

In CI, cache mounts work best with a builder that keeps cache between builds or exports cache to a registry. A local laptop may have a warm cache naturally. A fresh CI runner often starts empty, so teams pair cache mounts with external cache export in `docker buildx build`.

Cache mounts speed up building. Image size still needs a separate build design: build-time tools should stay apart from runtime files.

## Multi-Stage Builds
<!-- section-summary: Multi-stage builds use one stage for compiling or packaging and a smaller final stage for the files needed at runtime. -->

A **multi-stage build** uses more than one `FROM` instruction in the same Dockerfile. Each `FROM` creates a named or unnamed build stage. One stage can compile, test, or package the application. A later stage can copy only the finished artifact into a smaller runtime image.

This matters because build tools and runtime files often differ. A TypeScript service may need the TypeScript compiler, test tools, and development dependencies during the build. The running service may only need compiled JavaScript, production dependencies, and Node.js. A Go service may need the Go toolchain during compilation and only the compiled binary at runtime.

Here is a multi-stage version for a Node service that compiles to `dist/`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

The `deps` stage installs the full dependency set so the build can run. The `build` stage copies source and creates `dist/`. The `runtime` stage starts fresh from the Node base image, installs only production dependencies, and copies the compiled output from the build stage.

`COPY --from=build /app/dist ./dist` is the important bridge. It copies files from another stage, separate from the build context. That means source files, test files, compiler caches, and build-only dependencies can stay out of the final runtime image unless the Dockerfile copies them.

For compiled languages, the final stage can become much smaller. A Go service might compile in `golang:1.24` and copy a single binary into `gcr.io/distroless/static` or `scratch`, depending on the application needs. The build stage can be large because it never ships to production.

There is a tradeoff in the Node example. Installing production dependencies again in the runtime stage adds build time. It also keeps development dependencies out of the final image. Some teams copy `node_modules` from a production-deps stage. The right shape depends on the package manager, lockfile behavior, native modules, and review preferences.

Now the build output is clean. The next question comes after the image starts: what happens to files the container writes while it runs?

## Runtime Writes
<!-- section-summary: Container writes go into a container-specific writable layer, so production data should live in volumes, databases, object storage, or platform-managed storage. -->

A running container gets a **writable container layer** on top of the image layers. If `shipping-api` writes `/app/tmp/report.csv`, Docker stores that change in the writable layer for that one container. The image layers stay read-only and shared.

This explains two production rules. First, containers should treat their image filesystem as disposable runtime space. If the container goes away, the writable layer goes away with it. Logs, uploaded files, generated reports, and database files need a real storage plan outside the container layer.

Second, writing heavily into the container layer can hurt operations. Docker's storage documentation recommends volumes for persistent data and many write-heavy workloads. A volume has its own lifecycle outside a single container, and platforms such as Kubernetes have their own persistent volume systems for the same reason.

For `shipping-api`, a healthy design might write request logs to stdout, store uploaded labels in object storage, and keep database records in a managed database. The container can still use `/tmp` for short-lived scratch files during a request, but the service should finish that request without depending on scratch data surviving a restart.

This runtime layer connects back to the image build. The image should contain application code and runtime dependencies. Environment data, secrets, mutable uploads, and machine-specific cache belong outside the image. Clean builds and clean runtime storage are two sides of the same container habit.

Now we can put layers and cache into a CI workflow.

## A CI Build Pattern
<!-- section-summary: CI builds usually combine cache-friendly Dockerfiles, external BuildKit cache export, clear image tags, and a recorded digest. -->

In CI, the builder often starts without the warm cache your laptop has. A good Dockerfile still helps because it gives Docker stable layer boundaries, but the pipeline also needs somewhere to store and retrieve cache across runs. Docker Buildx can export cache to a registry and import it on the next build.

A CI build for `shipping-api` might look like this:

```bash
docker buildx build \
  --cache-from type=registry,ref=registry.example.com/platform/shipping-api:buildcache \
  --cache-to type=registry,ref=registry.example.com/platform/shipping-api:buildcache,mode=max \
  --tag registry.example.com/platform/shipping-api:2026-06-13.42 \
  --push \
  .
```

The `--cache-from` option tells Buildx where to look for previous cache. The `--cache-to` option tells Buildx where to write cache for future builds. The release tag names the image pushed by this CI run. The final dot still means the current directory is the build context.

This pipeline still depends on the Dockerfile design. External cache has limited value when a Dockerfile copies noisy source files before dependency installs. Cache export gives Docker more previous results to reuse. Instruction order decides whether those results still match the current build.

Teams usually add one more step after the push: record the image digest that the registry returns. A tag is a readable release label, but a digest identifies exact image content. The next article focuses on that handoff from local image build to registry distribution.

## What's Next

You now have the build side of Docker images. Layers explain how Docker stores filesystem changes. Cache rules explain why Docker reuses some steps and reruns others. Multi-stage builds explain how build tools can stay out of the final runtime image.

The next article follows the image after the build. We will look at tags, digests, registries, push and pull flows, and why production deployments should know the exact image content they are running.

---

**References**

- [Docker build cache](https://docs.docker.com/build/cache/) - Official Docker overview of build cache concepts and why cache optimization matters.
- [Build cache invalidation](https://docs.docker.com/build/cache/invalidation/) - Documents cache checks for `ADD`, `COPY`, `RUN`, file metadata, modification times, and downstream invalidation.
- [Optimize cache usage in builds](https://docs.docker.com/build/cache/optimize/) - Covers layer order, small build contexts, bind mounts, cache mounts, and external cache backends.
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/) - Explains multiple `FROM` stages and `COPY --from` for copying artifacts between stages or from external images.
- [OverlayFS storage driver](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/) - Describes the classic `overlay2` storage driver, lower directories, upper directories, and merged views.
- [Docker storage](https://docs.docker.com/engine/storage/) - Explains writable container layers, image layers, and the lifecycle of data written inside a container.
- [Containerd image store](https://docs.docker.com/engine/storage/containerd/) - Documents Docker Engine's containerd image store and snapshotter-based layer storage.
