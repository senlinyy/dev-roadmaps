---
title: "Hardening Container Images"
description: "Build smaller, safer images with minimal packages, non-root users, and fewer runtime privileges."
overview: "Follow a payments-api image before it reaches the registry, and learn how to reduce what ships in it: trusted base images, pinned versions, multi-stage builds, fewer packages, non-root users, safe file ownership, clean build secrets, and a read-only-friendly runtime layout."
tags: ["devsecops", "containers", "image-hardening", "docker"]
order: 1
id: article-devsecops-container-image-security-minimal-base-images
---

## Table of Contents

1. [The Build We Are Hardening](#the-build-we-are-hardening)
2. [Choose A Trusted Minimal Base](#choose-a-trusted-minimal-base)
3. [Pin The Parts That Must Repeat](#pin-the-parts-that-must-repeat)
4. [Use Multi-stage Builds](#use-multi-stage-builds)
5. [Reduce Packages And Files](#reduce-packages-and-files)
6. [Run As A Non-root User](#run-as-a-non-root-user)
7. [Own The Files The App Needs](#own-the-files-the-app-needs)
8. [Keep Build Secrets Out Of Layers](#keep-build-secrets-out-of-layers)
9. [Make The Image Read-only Friendly](#make-the-image-read-only-friendly)
10. [Inspect And Scan Before Push](#inspect-and-scan-before-push)
11. [A Local And CI Checklist](#a-local-and-ci-checklist)
12. [What's Next](#whats-next)

## The Build We Are Hardening
<!-- section-summary: The team wants the payments-api image to carry only the runtime pieces it needs before CI pushes it to the private registry. -->

Let's follow one small team. They build a `payments-api` service in a CI pipeline, push the image into a private registry, and run it on Kubernetes. The service handles payment requests, calls a database, writes logs to standard output, and exposes an HTTP port for the cluster.

A **container image** is the packaged filesystem and startup configuration that a container runtime uses to start a container. It usually contains the operating system libraries, language runtime, application code, dependencies, environment defaults, user settings, and the command that starts the process. For example, a Node.js API image may contain Node.js, compiled JavaScript, production `node_modules`, CA certificates for HTTPS calls, and a `CMD` that runs `node dist/server.js`.

The important part is that an image travels. The same image can move from a developer laptop to CI, from CI to the private registry, and from the registry into Kubernetes. If the image carries an old base image, a shell full of debugging tools, a leaked package token, or a process that runs as root, that risk travels with it.

So this first article stays before the registry. The team has one job: make the `payments-api` image smaller, clearer, and safer before any scanner, registry policy, admission controller, or Kubernetes deployment has to deal with it. Later articles can handle trust, SBOMs, signing, registry controls, and runtime policy. Right now, the Dockerfile itself is the main place where the team can remove unnecessary risk.

Here is the path we will take. Each row names the image-hardening choice first, then connects it to the reason the team checks it before push.

| Step | What the team checks | Why it matters before the registry |
|---|---|---|
| **Base image** | The image starts from a trusted, maintained, minimal base | Old or random base images bring unknown packages and unknown maintenance |
| **Pins and digests** | Versions repeat in CI, and digest updates happen through review | Rebuilds produce explainable changes instead of surprise changes |
| **Multi-stage builds** | Build tools stay in builder stages | Compilers, test tools, and caches do not ship to production |
| **Package reduction** | The final image carries only runtime dependencies | Fewer packages means fewer CVEs and fewer tools for an attacker |
| **Non-root user** | The app process runs as a numeric non-root UID | A compromised process gets fewer permissions inside the container |
| **File ownership** | The app user owns only the paths it needs | Permissions match the runtime user instead of relying on root |
| **Secret hygiene** | Build tokens never land in layers or history | Private registry and package tokens do not travel inside the image |
| **Read-only layout** | Writable paths are explicit and temporary | Kubernetes can later run the container with a read-only root filesystem |
| **Local and CI checks** | Build, inspect, scan, and smoke-test happen before push | The private registry receives an image that already passed basic safety checks |

![Image hardening path infographic showing payments-api moving through trusted base, pinned digest, multi-stage build, non-root user, clean secrets, and read-only readiness before the private registry](/content-assets/articles/article-devsecops-container-image-security-minimal-base-images/image-hardening-path.png)

*The image-hardening path is easiest to review as a pre-registry gate: the team removes risky defaults before the image is a shared release artifact.*

The rest of the article walks through those steps with the same `payments-api` example. We will use Dockerfile snippets and terminal commands, and each command will connect back to what a small production team would actually check.

## Choose A Trusted Minimal Base
<!-- section-summary: Base images set the first layer of risk, so the team starts with a maintained image that contains only the runtime family they need. -->

A **base image** is the image named in a Dockerfile `FROM` line. Every file and package from that base image travels into your image unless a later stage changes the structure. If `payments-api` starts from `node:latest`, it inherits whatever `node:latest` points to at build time. If it starts from a random image maintained by an unknown account, it inherits that maintainer's patch habits and packaging decisions too.

For a small team, the first safe choice is usually a current official or verified image for the language runtime. Docker Official Images and verified publisher images have clearer ownership and maintenance than a random image that happens to work today. For `payments-api`, a reasonable starting point is a current Node.js image with a slim operating system base:

```dockerfile
# syntax=docker/dockerfile:1.8
ARG NODE_VERSION=22.12.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
```

The `node` image gives the app the Node.js runtime it needs. The `bookworm-slim` part says the image uses a smaller Debian 12 family base rather than a fuller general-purpose distribution. The version argument keeps the major runtime choice visible in one place, so a review can discuss "we are moving from Node 22.11 to 22.12" instead of trying to infer that from a long Dockerfile.

**Minimal** means the image includes fewer operating system packages, command-line tools, libraries, and helper programs. This reduces the attack surface, which is the set of things an attacker could try to use after finding a weakness. A minimal image will usually have fewer shell tools, fewer package-manager leftovers, and fewer libraries that can show up in vulnerability reports.

There is a tradeoff the team should discuss in plain terms. A very small runtime image, such as a distroless image or a `scratch` image for a static binary, can reduce packages a lot. It also removes familiar debugging tools like `sh`, `curl`, and package managers. That is often great for production, but the team needs a separate debugging path, such as Kubernetes ephemeral debug containers, logs, metrics, traces, and local reproduction. For this first build, we can still get most of the value by separating build tools from runtime tools and keeping the final image narrow.

The team should also avoid base images that hide too much ownership. A private internal base image can be excellent if a platform team patches it, scans it, publishes release notes, and gives application teams an update process. The same private base image can create drift if nobody owns it. The question is simple: when the next OpenSSL or glibc vulnerability lands, who updates the base image and how does `payments-api` receive the fix?

Now the image starts from a trusted runtime family. The next problem is repeatability. The same Dockerfile should produce an image the team can explain next week, and that brings us to tags, versions, and digests.

## Pin The Parts That Must Repeat
<!-- section-summary: Tags help humans read versions, while digests make important builds repeatable and auditable. -->

A **tag** is a readable label on an image, such as `node:22-bookworm-slim`. Tags help people understand the runtime family and version line. The catch is that many tags can move over time, because publishers rebuild images with patch updates and point the same tag to newer image content.

A **digest** is the content address for an image. It looks like `sha256:...`, and it identifies one exact image artifact. If the team builds from `node:22-bookworm-slim@sha256:<digest>`, Docker pulls that exact content instead of whatever the tag points to today.

The team does not need to treat tags and digests as enemies. A practical production pattern uses both: the tag keeps the Dockerfile readable, and the digest keeps the build repeatable. In a reviewed update, a dependency bot or platform engineer changes the digest after the publisher releases a new patched image, CI scans the result, and the pull request shows the exact base-image change.

```dockerfile
# syntax=docker/dockerfile:1.8
ARG NODE_VERSION=22.12.0

FROM node:${NODE_VERSION}-bookworm-slim@sha256:<reviewed-base-image-digest> AS base
WORKDIR /app
```

The `<reviewed-base-image-digest>` marker matters in this learning example because a real digest changes by platform and update cycle. In a real repository, the team would paste the actual digest from the registry or let tooling update it. The important behavior is that CI receives a known base image instead of silently accepting a different one during a rebuild.

The same idea applies to package managers. If `payments-api` uses Node.js, `package-lock.json` records exact dependency versions. In a Docker build, `npm ci` installs from that lockfile and fails if `package.json` and the lockfile disagree. That gives the team a repeatable dependency install instead of an install that floats every time CI runs.

```dockerfile
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
```

The cache mount speeds up repeated builds by caching npm downloads for the builder. It does not need to appear in the final image. The important part for hardening is `npm ci`, because it follows the lockfile and gives the team a clearer review trail when dependencies change.

Pinned digests create one more operating habit: rebuilds need planned updates. A digest can hold an old base image in place after security fixes exist, so the team needs a scheduled update path. Docker Scout, Renovate, Dependabot, or an internal platform process can open pull requests when a newer digest exists. The team reviews the update, runs tests and scans, and then ships a new `payments-api` image.

Now the base is trusted and repeatable. The next source of risk sits inside the build itself, because building a service needs tools that production should never carry.

## Use Multi-stage Builds
<!-- section-summary: Multi-stage builds let the team use compilers and install tools during the build, then copy only runtime artifacts into the final image. -->

A **multi-stage build** is a Dockerfile with more than one `FROM` line. Each `FROM` starts a separate stage, and the final stage can copy selected files from earlier stages. This lets `payments-api` use Node.js package tools, TypeScript compilation, test helpers, and caches during the build, while the runtime stage receives only the files needed to start the API.

Think about a common Node.js service. During the build, the team may need TypeScript, ESLint, a test runner, native build tooling for dependencies, and package-manager credentials for a private package. At runtime, the Kubernetes pod needs the compiled `dist` directory, production dependencies, a few metadata files, CA certificates from the base image, and the Node runtime.

Here is a practical Dockerfile shape for `payments-api`. The stage names make the build readable, and the `COPY --from` lines show exactly what moves into the runtime image.

```dockerfile
# syntax=docker/dockerfile:1.8
ARG NODE_VERSION=22.12.0

FROM node:${NODE_VERSION}-bookworm-slim@sha256:<reviewed-base-image-digest> AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

The `deps` stage installs dependencies from the lockfile. The `build` stage compiles the source and removes development dependencies with `npm prune --omit=dev`. The `runtime` stage starts again from the base runtime image and copies only `package.json`, `dist`, and production `node_modules`.

This build already removes a lot of clutter. The final image does not include the TypeScript source directory unless the app needs it. It does not include the npm download cache. It does not include test output or a local `.git` directory. It also gives CI a place to stop early if the team wants to debug the build stage:

```bash
docker buildx build --target build -t payments-api:build-check .
```

That command asks Docker Buildx to build the Dockerfile only through the `build` stage and tag the result as `payments-api:build-check`. Developers can use it when a TypeScript build fails in CI, because they can inspect the stage that compiles the app without building the final runtime image first.

![Builder versus runtime infographic showing build tools, tests, compilers, and cache staying in the builder stage while only runtime files move into the smaller payments-api runtime image](/content-assets/articles/article-devsecops-container-image-security-minimal-base-images/builder-vs-runtime.png)

*Multi-stage builds create a clean boundary: the builder can be busy and tool-heavy, while the runtime image carries only the files needed to start the service.*

Now the Dockerfile has a clean build shape. The next step is to check what the final image still contains, because packages and files often sneak in through base images, dependency installs, and broad `COPY` commands.

## Reduce Packages And Files
<!-- section-summary: Package and file reduction removes tools, caches, source files, and accidental build-context content from the production image. -->

**Package reduction** means the final image contains only the operating system packages, language packages, and files the service needs at runtime. This matters because every extra package can add vulnerabilities, licenses, update work, and tools an attacker can use after compromising the app. If `payments-api` ships `curl`, `git`, `bash`, compilers, and a package manager, a shell inside that container has more tools available than the API needs.

The first place to reduce files is `.dockerignore`. The **build context** is the set of files Docker sends to the builder before the build starts. A broad context can send local secrets, test fixtures, coverage reports, Git history, and editor files into the build environment. A careful `.dockerignore` keeps that accidental material away from the builder.

```gitignore
.git
.github
.env
.env.*
coverage
node_modules
npm-debug.log
Dockerfile*
README.md
test
tmp
```

This `.dockerignore` tells Docker to leave local dependencies, environment files, Git metadata, coverage output, and test folders out of the context. The team can tune it for their repository, but the pattern stays the same: CI should send only the files the Dockerfile needs. When the build context is smaller, the chance of copying the wrong thing also drops.

The second place is the Dockerfile itself. Broad `COPY . .` works in quick demos, but production images should copy narrow paths. In the earlier Dockerfile, the dependency stage copies only `package.json` and `package-lock.json`, the build stage copies `tsconfig.json` and `src`, and the runtime stage copies only runtime artifacts from the build stage. That gives reviewers a short list of what can enter the final image.

The third place is package installation. If the team must install operating system packages, `--no-install-recommends` keeps Debian-based images from installing suggested extras. The cleanup at the end removes apt package lists from the final layer.

```dockerfile
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
```

This example installs only `ca-certificates` and `tini`. The certificates let the app make HTTPS calls to services like a payment gateway. `tini` can help a container handle Unix signals and child processes correctly for workloads that need it. If `payments-api` does not spawn child processes and already handles signals well, the team can skip `tini` too.

The team should inspect the image size and layer history before pushing. These commands give a quick local review before the image reaches the private registry.

```bash
docker buildx build --pull --load -t payments-api:local .
docker image ls payments-api:local
docker image history --no-trunc payments-api:local
```

The first command builds the image, asks Docker to check for a fresh base image with `--pull`, and loads the result into the local Docker image store. The second command shows the image size. The third command shows the layer history, including the command that created each layer. `docker image history` helps reviewers catch accidental package installs, copied secrets, and large steps that deserve a closer look.

At this point, the image is smaller and cleaner, but the process still runs with whatever user the image defines by default. Many base images default to root, so the next hardening step is the runtime user.

## Run As A Non-root User
<!-- section-summary: A non-root runtime user limits what the app process can change inside the container and aligns the image with Kubernetes hardening controls. -->

A **container user** is the Linux user account that runs the process inside the container. In Dockerfiles, the `USER` instruction sets that default user for later build steps and for the final container command. If the Dockerfile never sets `USER`, the runtime often starts as root, depending on the base image.

Root inside a container is still powerful inside that container. It can write to root-owned paths, change file permissions, bind privileged ports in some configurations, and interact with any mounted files according to the container's permissions. Container isolation reduces the boundary compared with a normal host process, but a compromised root process still gives an attacker more room than a compromised non-root process.

For `payments-api`, the team can create a dedicated user and group in the runtime stage. This keeps the user definition close to the final image that will actually run in Kubernetes.

```dockerfile
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system --gid 10001 payments \
  && useradd --system --uid 10001 --gid payments --home-dir /app --shell /usr/sbin/nologin payments

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

USER 10001:10001
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

The UID and GID are numeric and stable. Kubernetes can later use the same numbers in `runAsUser` and `runAsGroup`, and security policies can check that the container does not run as UID `0`. The username `payments` still helps humans read the Dockerfile, while the numeric user gives runtime systems a clear value.

The shell path `/usr/sbin/nologin` communicates that this user exists for the application process, not for interactive login. Some minimal images may not include `useradd` or `groupadd`; Alpine uses different commands, and distroless images often provide a pre-created `nonroot` user. The exact command changes by base image, but the outcome stays the same: the final image declares a non-root runtime user.

The team can verify the image configuration locally. This gives the reviewer evidence that the Dockerfile and the built image agree.

```bash
docker image inspect payments-api:local --format '{{.Config.User}}'
docker run --rm payments-api:local id
```

The first command prints the user configured in the image. The second command runs the image and asks the container to print its process identity. If the image has no `id` binary because the team picked a very minimal runtime, the image inspect command still tells them what Docker will use as the default runtime user.

Now the process runs as a non-root user. The next issue is file ownership, because a non-root process can fail at startup if every copied file and writable directory still belongs to root.

## Own The Files The App Needs
<!-- section-summary: File ownership makes the non-root user practical, because the process can read app files and write only to the small paths designed for runtime data. -->

**File ownership** controls which user and group can read, write, or execute each path in the image. When Docker copies files into an image, those files often land as root-owned unless the Dockerfile says otherwise. If `payments-api` runs as UID `10001`, it can read world-readable files, but it cannot write to root-owned directories without write permissions.

Production services should need very few writable paths. A payment API should write logs to standard output so the platform can collect them. It should read configuration from environment variables or mounted files. It may need a temporary directory for a short-lived upload, cache, or socket, but that directory should be explicit and small.

The Dockerfile can use `COPY --chown` so copied runtime files have the correct owner. This keeps ownership attached to the copy operation instead of requiring a broad recursive ownership change later.

```dockerfile
COPY --from=build --chown=10001:10001 /app/package.json ./package.json
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
```

This tells Docker to copy the files from the `build` stage and set the owner to UID `10001` and GID `10001` in the runtime stage. The team can still choose stricter permissions later, but this line removes a common startup problem where a non-root process cannot read its own app files or cannot access a required directory.

For writable paths, create only what the app needs. The `payments-api` container can have one temporary path instead of write access across the application directory.

```dockerfile
RUN mkdir -p /tmp/payments-api \
  && chown -R 10001:10001 /tmp/payments-api

ENV PAYMENTS_TMP_DIR=/tmp/payments-api
USER 10001:10001
```

This creates one temporary directory and gives it to the app user. The app can use `PAYMENTS_TMP_DIR` for temporary files. The rest of the image can stay read-only in Kubernetes later.

The team can check ownership with a temporary debug command. This works best while the team still uses a shell-based runtime image for learning and debugging.

```bash
docker run --rm --entrypoint sh payments-api:local -c 'ls -ld /app /app/dist /tmp/payments-api'
```

This command starts the image with `sh` as the entrypoint and lists ownership for important paths. It works for shell-based images like Debian slim. For images without a shell, the team can test ownership by running the app under the expected user and making the app's health check exercise the temporary directory.

The image now has a specific user and a specific writable path. The next problem comes from the build process itself, because CI often needs private package credentials, and those secrets must stay outside final image layers.

## Keep Build Secrets Out Of Layers
<!-- section-summary: Build secrets should appear only during the build step that needs them, never in Dockerfile arguments, environment variables, copied files, or final layers. -->

A **build secret** is sensitive data needed while building an image. For `payments-api`, that might be an npm token for a private package, a Git token for a private dependency, or credentials for an internal artifact repository. The build needs the secret long enough to download dependencies, and then the secret should disappear.

Docker images store filesystem changes as layers. A layer records what a build step added, changed, or deleted. If a Dockerfile copies `.npmrc` into the image and deletes it later, an earlier layer may still contain that file. If a Dockerfile passes a token through `ARG` or `ENV`, the value can leak through history, provenance, or build logs.

Here is the risky pattern the team should avoid. The token enters the Dockerfile instruction stream, so cleanup after the install cannot remove every trace from build metadata and history.

```dockerfile
ARG NPM_TOKEN
RUN npm config set //registry.npmjs.org/:_authToken=${NPM_TOKEN}
RUN npm ci
RUN npm config delete //registry.npmjs.org/:_authToken
```

This pattern makes the token part of the build command stream. Even if a later step deletes the npm config, the team still has to worry about layer history, caches, logs, and provenance metadata. It also trains developers to pass secrets as build arguments, which creates more places for secrets to appear.

BuildKit secret mounts give a safer pattern. The secret appears as a temporary file only for the `RUN` instruction that needs it, and the mount disappears when that instruction finishes.

```dockerfile
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
  --mount=type=cache,target=/root/.npm \
  npm ci
```

The matching local build command can pass a local `.npmrc` file as a secret. The file stays on the developer machine or CI runner, and BuildKit exposes it only to the dependency install step.

```bash
docker buildx build \
  --secret id=npmrc,src=.npmrc \
  --load \
  -t payments-api:local \
  .
```

The `--secret` flag sends the secret to the builder for that build. The Dockerfile line mounts it at `/root/.npmrc` only while `npm ci` runs. The final image does not receive `.npmrc`, and later stages copy only compiled artifacts and production dependencies.

The team can also inspect layer history after building. This check belongs near the build step, because it gives fast feedback while the Dockerfile change is still fresh.

```bash
docker image history --no-trunc payments-api:local
```

This command cannot prove every possible secret path is clean, but it catches obvious mistakes like tokens in command text or a `COPY .npmrc` layer. CI should combine this with secret scanning in source control and image scanning in the build pipeline, because one check rarely catches every leak.

Now the build no longer leaves obvious secrets behind. The image still needs to cooperate with Kubernetes hardening, especially read-only filesystems.

## Make The Image Read-only Friendly
<!-- section-summary: A read-only-friendly layout lets Kubernetes lock the root filesystem later while still giving the app a deliberate temporary path. -->

A **read-only root filesystem** means the container cannot write to its image filesystem after it starts. In Kubernetes, this is commonly configured with `readOnlyRootFilesystem: true`. The app can still write to explicitly mounted volumes, such as an `emptyDir` mounted at `/tmp`, but it cannot quietly create files anywhere in `/app`, `/usr`, or other image paths.

This matters for `payments-api` because accidental writes hide inside application code. A framework might write compiled templates to the current directory. A library might create a cache under the user's home directory. A developer might configure file logging to `/app/logs` during local testing. Those choices work while the filesystem is writable, then fail when the platform team enables a read-only root filesystem.

The image can prepare for this by making app code read-only in practice and moving runtime writes to a known temporary path. These environment variables also give application code a clear place to look for temporary storage.

```dockerfile
ENV NODE_ENV=production
ENV PAYMENTS_TMP_DIR=/tmp/payments-api
ENV XDG_CACHE_HOME=/tmp/payments-api/cache

RUN mkdir -p /tmp/payments-api/cache \
  && chown -R 10001:10001 /tmp/payments-api

USER 10001:10001
CMD ["node", "dist/server.js"]
```

`PAYMENTS_TMP_DIR` gives the application an explicit place for temporary files. `XDG_CACHE_HOME` gives libraries that honor the XDG cache convention a writable cache path under `/tmp`. The app should still log to standard output and standard error, because Kubernetes and the cluster logging stack expect container logs there.

A local read-only smoke test gives the team fast feedback. It proves the app can start with a locked root filesystem before Kubernetes enforces the same idea.

```bash
docker run --rm \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -e PAYMENTS_TMP_DIR=/tmp/payments-api \
  -p 8080:8080 \
  payments-api:local
```

The `--read-only` flag makes the container root filesystem read-only. The `--tmpfs /tmp:...` option gives the container a writable in-memory `/tmp` with a size limit and safer mount options. The port mapping lets a developer call the health endpoint locally while testing the read-only behavior.

Kubernetes can later express the same idea in a pod or deployment. The image hardening work makes these runtime settings practical instead of surprising.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments-api
spec:
  template:
    spec:
      containers:
        - name: payments-api
          image: registry.internal.example.com/payments-api:2026-06-21-a1b2c3
          ports:
            - containerPort: 8080
          env:
            - name: PAYMENTS_TMP_DIR
              value: /tmp/payments-api
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            runAsGroup: 10001
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

This manifest belongs to runtime security, so later articles can go deeper. For image hardening, the key point is that the image layout made this manifest realistic. The app has a non-root user, a known UID, and a writable temp path that can come from a Kubernetes `emptyDir`.

Now the Dockerfile has the major hardening pieces. Before the image reaches the registry, the team needs repeatable checks that prove those pieces are present.

## Inspect And Scan Before Push
<!-- section-summary: Inspection checks the image shape, while scanning checks known vulnerabilities and gives CI a gate before registry push. -->

**Image inspection** means checking the image metadata, layers, user, size, environment, and startup command. It answers questions like: which user runs by default, what command starts the service, how large is the image, and what did each layer do? These checks catch Dockerfile mistakes that a vulnerability scanner may never care about.

```bash
docker image inspect payments-api:local --format '{{json .Config}}'
docker image inspect payments-api:local --format 'user={{.Config.User}} cmd={{json .Config.Cmd}}'
docker image history --no-trunc payments-api:local
```

The first command prints the image runtime configuration as JSON. The second command prints the default user and command in a short format, which works well in CI logs. The third command prints full layer history so reviewers can see package installs, broad copies, and suspicious command text.

**Image scanning** means checking the image contents against vulnerability and policy data. Docker Scout can scan a local image for CVEs, and other organizations may use Trivy, Grype, Snyk, Prisma Cloud, or a registry-native scanner. The exact scanner can vary, but the workflow should stay consistent: scan before push, fail on the severities the team agreed to block, and keep an exception process for vulnerabilities that have context.

```bash
docker scout cves payments-api:local \
  --only-severity critical,high \
  --exit-code
```

This command asks Docker Scout to report only critical and high CVEs and return a failing exit code when vulnerabilities match. That makes the command useful in CI, because the pipeline can stop before pushing a risky image to the private registry. The team can tune severity, fixability, exploitability, and exception rules over time, but the first useful gate is simply "critical and high findings need attention before this image moves forward."

Scanning should feed review, not replace review. A small image can still contain a dangerous app bug. A large image can sometimes have a CVE in a package the app never calls. The scanner gives evidence, and the team still decides how to update the base image, bump an application dependency, remove a package, or document a temporary exception.

The team should also scan for base-image freshness. A digest-pinned Dockerfile can intentionally hold an old base image, so a tool like Docker Scout's base-image policy or a dependency bot should open pull requests when the pinned digest has a newer secure replacement. That keeps repeatability and patching connected instead of choosing one and forgetting the other.

Now the team has the checks. The final section turns those checks into a local and CI routine the team can reuse for every `payments-api` image.

## A Local And CI Checklist
<!-- section-summary: The checklist turns image hardening into a repeatable routine that developers and CI can run before the private registry receives the image. -->

The practical goal is a boring pipeline. Every pull request that changes the Dockerfile, dependencies, or application startup should build the image, inspect the result, run a basic smoke test, scan the image, and push only after the checks pass. This keeps hardening out of memory and puts it into the normal shipping path.

Here is a local checklist for a developer before opening a pull request. The commands are short enough to run during normal Dockerfile work, and CI should repeat the important ones.

| Check | Command or file | What the team learns |
|---|---|---|
| Build from current base | `docker buildx build --pull --load -t payments-api:local .` | The image builds locally and Docker checks for a fresh base tag |
| Confirm default user | `docker image inspect payments-api:local --format '{{.Config.User}}'` | The image declares the non-root runtime user |
| Review layers | `docker image history --no-trunc payments-api:local` | The layer history has no obvious token, broad copy, or surprise package install |
| Smoke-test as read-only | `docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m -p 8080:8080 payments-api:local` | The app starts without writing into the image filesystem |
| Scan high-risk CVEs | `docker scout cves payments-api:local --only-severity critical,high --exit-code` | Critical and high CVEs stop the local readiness check |
| Check build context | `.dockerignore` | Local secrets, Git metadata, test output, and dependencies stay outside the build context |

The CI version should use the same ideas. This GitHub Actions example builds without pushing first, passes the npm credential as a BuildKit secret, inspects the resulting image, and scans before the registry push step would run.

```yaml
name: payments-api-image

on:
  pull_request:
    paths:
      - Dockerfile
      - package.json
      - package-lock.json
      - src/**

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: docker/setup-buildx-action@v4

      - name: Build local image
        uses: docker/build-push-action@v7
        with:
          context: .
          file: ./Dockerfile
          load: true
          tags: payments-api:${{ github.sha }}
          secrets: |
            npmrc=${{ secrets.NPMRC }}

      - name: Inspect runtime user
        run: |
          test "$(docker image inspect payments-api:${{ github.sha }} --format '{{.Config.User}}')" = "10001:10001"

      - name: Review layer history
        run: |
          docker image history --no-trunc payments-api:${{ github.sha }}

      - name: Scan critical and high CVEs
        run: |
          docker scout cves payments-api:${{ github.sha }} --only-severity critical,high --exit-code
```

The build step uses `load: true` so later shell commands can inspect the local image by tag. The `secrets` block passes the npm configuration as a BuildKit secret instead of putting it in a Dockerfile argument. The inspect step makes the non-root user a hard pipeline rule. The scan step blocks the pull request when Docker Scout reports critical or high vulnerabilities.

A production pipeline would add tests, labels, provenance or attestations, SBOM generation, signing, and then a push to the private registry after the pre-push checks pass. Those topics belong to the next articles in the module. For this first article, the team has already done the essential image hardening work before the registry sees anything.

Here is the full hardened Dockerfile shape assembled in one place. Treat it as a reference baseline that the team can adapt for the real `payments-api` repository.

```dockerfile
# syntax=docker/dockerfile:1.8
ARG NODE_VERSION=22.12.0
ARG BASE_DIGEST=<reviewed-base-image-digest>

FROM node:${NODE_VERSION}-bookworm-slim@sha256:${BASE_DIGEST} AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
  --mount=type=cache,target=/root/.npm \
  npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
ENV PAYMENTS_TMP_DIR=/tmp/payments-api
ENV XDG_CACHE_HOME=/tmp/payments-api/cache

RUN groupadd --system --gid 10001 payments \
  && useradd --system --uid 10001 --gid payments --home-dir /app --shell /usr/sbin/nologin payments \
  && mkdir -p /tmp/payments-api/cache \
  && chown -R 10001:10001 /tmp/payments-api

COPY --from=build --chown=10001:10001 /app/package.json ./package.json
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules

USER 10001:10001
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

This Dockerfile gives the team a concrete baseline. It starts from a reviewed base image, installs from the lockfile, separates build and runtime stages, copies only runtime files, runs as a stable non-root user, assigns ownership intentionally, keeps build secrets out of layers, and prepares the app for a read-only root filesystem.

![Pre-push image checklist infographic with base reviewed, secrets clean, runs non-root, writable paths known, scan passes, and ready for registry checks around payments-api](/content-assets/articles/article-devsecops-container-image-security-minimal-base-images/pre-push-image-checklist.png)

*The final pre-push check turns Dockerfile hardening into release behavior: the registry receives an image that already passed the basic safety review.*

## What's Next

Hardening the image reduces what the team ships. The next question is how the team proves what it built and how other systems decide whether to trust it.

The next article moves from image contents to image trust and SBOMs. We will follow the same `payments-api` image into the private registry and look at package inventories, provenance, signing, and the checks that tell Kubernetes and security teams where the image came from.

---

**References**

- [Docker build best practices](https://docs.docker.com/build/building/best-practices/) - Covers base-image choice, pinned base images, `.dockerignore`, package reduction, frequent rebuilds, and CI builds.
- [Docker base images](https://docs.docker.com/build/building/base-images/) - Explains what a base image is, Docker Official Images, verified publisher images, and minimal `scratch` images.
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/) - Documents multiple `FROM` stages and copying selected artifacts into a final image.
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) - Documents `USER`, `ARG`, `ENV`, `COPY --from`, and other Dockerfile instructions used in hardened builds.
- [Docker Build secrets](https://docs.docker.com/build/building/secrets/) - Explains BuildKit secret mounts and why build arguments and environment variables are a poor fit for secrets.
- [Docker Scout CVE command](https://docs.docker.com/reference/cli/docker/scout/cves/) - Documents `docker scout cves`, severity filters, supported artifact types, and the `--exit-code` option.
- [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html) - Provides practical container guidance for non-root users, read-only filesystems, CI scanning, secrets, and supply chain security.
- [NIST SP 800-190: Application Container Security Guide](https://csrc.nist.gov/pubs/sp/800/190/final) - Defines container security concerns and recommendations across images, registries, runtimes, orchestrators, and hosts.
- [Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) - Documents restricted controls such as non-root users, dropped capabilities, and privilege escalation controls.
- [Kubernetes security context](https://kubernetes.io/docs/tasks/configure-pod-container/security-context/) - Shows how pod and container security settings are expressed in Kubernetes manifests.
