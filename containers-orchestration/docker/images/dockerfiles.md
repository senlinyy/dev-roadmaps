---
title: "Dockerfiles and Build Context"
description: "Understand Dockerfiles, build context, .dockerignore files, and the basic build recipe that turns application files into a repeatable image."
overview: "A Docker image build has two main inputs: the Dockerfile and the build context. This article follows a small API from a messy local folder to a clean image recipe, with practical guidance for COPY, RUN, .dockerignore, and runtime defaults."
tags: ["docker", "dockerfile", "images"]
order: 1
id: article-containers-orchestration-docker-dockerfiles
aliases:
  - build-context-and-dockerignore
  - article-containers-orchestration-docker-build-context-and-dockerignore
  - containers-orchestration/docker/images/build-context-and-dockerignore.md
---

## Table of Contents

1. [The Build Story for shipping-api](#the-build-story-for-shipping-api)
2. [Dockerfile and Build Context](#dockerfile-and-build-context)
3. [Keeping the Context Clean with .dockerignore](#keeping-the-context-clean-with-dockerignore)
4. [The First Dockerfile Instructions](#the-first-dockerfile-instructions)
5. [Dependency Ordering and Repeatable Builds](#dependency-ordering-and-repeatable-builds)
6. [ARG, ENV, and Build Secrets](#arg-env-and-build-secrets)
7. [A Clean First Dockerfile](#a-clean-first-dockerfile)
8. [Production Review Guidance](#production-review-guidance)
9. [Troubleshooting the First Build](#troubleshooting-the-first-build)
10. [What's Next](#whats-next)

## The Build Story for shipping-api
<!-- section-summary: The team wants one repeatable image that works on laptops, in CI, and later from a registry. -->

Let's set up the story first. Your team owns a small Node.js service named `shipping-api`, and it exposes routes like `/health`, `/shipments`, and `/rates`. Developers run it locally with npm, the CI system needs to build it on every pull request, and the release pipeline will later push the image to a registry so a runtime platform can deploy it.

A **Docker image** is a packaged filesystem plus default runtime metadata. It contains the operating system files, application files, installed dependencies, environment defaults, user setting, and startup command that a container uses. For `shipping-api`, the image should contain Node.js, production dependencies, and `src/server.js`, then start the service the same way on every machine.

That repeatability matters because laptops and CI runners rarely look identical. One developer may have Node 22 installed, another may have Node 24, and CI may start from a clean Linux machine with no local dependencies at all. The Docker build gives the team a single recipe for creating the same application image from the same source files.

The first Docker image build has two main inputs: a **Dockerfile** and a **build context**. The Dockerfile tells Docker what to do. The build context tells Docker which files the Dockerfile may use. Once those two pieces make sense, the rest of the article can move from "why did Docker copy that file?" to "how do we write a clean first production-ready build?"

## Dockerfile and Build Context
<!-- section-summary: The Dockerfile is the recipe, and the build context is the selected file set that recipe can copy from. -->

A **Dockerfile** is a plain text build recipe. Each line uses an instruction such as `FROM`, `COPY`, `RUN`, or `CMD`, and Docker reads those instructions from top to bottom. For `shipping-api`, the Dockerfile chooses a Node base image, creates `/app`, installs dependencies, copies source files, and records the command that starts the server.

A **build context** is the collection of files Docker makes available to the build. In the command below, the final dot selects the current directory as the context. Docker can copy files from that directory after ignore rules run, and Docker keeps files outside that directory away from the build.

```bash
docker build -t shipping-api:local .
```

That final dot looks tiny, and it carries a lot of meaning. If the shell sits inside the `shipping-api` folder, Docker uses that service folder as the context. If the shell sits at a monorepo root and the command uses `.` there, Docker uses the whole repository root as the context.

Here is the local project shape we will use through the article. Keep this folder in mind because every later Dockerfile line either copies from it, filters it, or ignores it.

```markdown
shipping-api/
  Dockerfile
  .dockerignore
  package.json
  package-lock.json
  src/
    server.js
    routes.js
  test/
    shipping-rates.test.js
  coverage/
  .env
  .git/
  node_modules/
```

The production image needs `package.json`, `package-lock.json`, and `src/`. The local folder also contains test output, local dependencies, Git history, and `.env` secrets. Those local files help development, and they should stay out of the image build input.

Docker separates the context from the Dockerfile because the builder may run somewhere other than your laptop process. The Docker client prepares the context and sends it to the builder, which could be the local Docker engine, a BuildKit builder, or a remote builder used by CI. That design explains why Docker complains about files "outside the build context" and why a large context can slow down a build before the first real instruction runs.

![Docker build context gate infographic showing the shipping-api project folder, a .dockerignore filter, the files that enter the build context, the Dockerfile recipe, the builder, and the final Docker image](/content-assets/articles/article-containers-orchestration-docker-dockerfiles/build-context-gate.png)

_This infographic shows the build context as the controlled input to the builder: useful files pass through, local-only files stay out, and `COPY` can only reach what survived the context gate._

Now that the build input has a name, the next job is choosing what stays in that input.

## Keeping the Context Clean with .dockerignore
<!-- section-summary: The .dockerignore file filters local-only files out of the build context before COPY can use them. -->

A **`.dockerignore` file** is a filter for the build context. It lives at the root of the context and lists files or directories that Docker should exclude before sending the context to the builder. For `shipping-api`, this file protects the image from local secrets, local dependency folders, generated reports, and source-control history.

A practical first version can look like this. The exact list changes by team, and the categories should stay the same: secrets, generated output, local dependencies, logs, and local-only tooling.

```dockerignore
.git
.github
.env
.env.*
.npmrc
node_modules
npm-debug.log*
yarn-error.log*
coverage
dist
build
tmp
*.log
*.pem
Dockerfile.local
compose.override.yaml
```

This file gives the team two wins right away. The build context gets smaller because Docker no longer scans and sends `node_modules`, coverage reports, and Git history. The security review also gets simpler because `.env`, `.npmrc`, private key files, and logs stay outside the input that `COPY` can place into an image layer.

Ignore rules support patterns and exceptions. Docker also supports `**` for matching across any number of directories, and a line starting with `!` can bring a file back after a broader rule excluded it. A documentation-heavy repository might keep one README while excluding the rest of the markdown files from a service build.

```dockerignore
**/*.md
!README.md
```

The last matching rule wins, so exception-heavy files deserve careful review. A security reviewer should be able to answer a plain question: "Can a local secret enter this build context?" If the answer takes five minutes of pattern tracing, the ignore file needs cleanup before the team trusts the image.

Docker still sends the Dockerfile and `.dockerignore` to the builder because the builder needs them to run the build. If `.dockerignore` excludes either file, Dockerfile instructions cannot copy that file into the image with `COPY`, `ADD`, or a bind mount. That detail surprises people when they try to copy `.dockerignore` into `/app` for debugging and Docker reports that the file does not exist in the context.

At this point, `shipping-api` has a safer input folder. The next step is learning the Dockerfile instructions that turn those input files into an image.

## The First Dockerfile Instructions
<!-- section-summary: Dockerfile instructions choose the base image, copy files, run build commands, and set runtime defaults. -->

A **Dockerfile instruction** is one step in the image recipe. Some instructions change the filesystem, such as `COPY` and `RUN`. Other instructions set image metadata, such as `ENV`, `USER`, `EXPOSE`, and `CMD`.

Here is a compact Dockerfile that shows the main instructions before we improve it. This version gives us a shared vocabulary first, then the later sections tighten the build for review and CI.

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000

USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
```

The instructions above cover the first vocabulary a Docker image author needs. Each instruction has a small job, and together they describe both the build-time filesystem and the runtime defaults.

| Instruction | What it means for `shipping-api` |
|---|---|
| **FROM** | Chooses the base image that provides Linux files and Node.js. The rest of the build starts from this image. |
| **WORKDIR** | Sets `/app` as the working directory for later `COPY`, `RUN`, and `CMD` instructions. Docker creates it if it does not already exist. |
| **COPY** | Copies files from the build context into the image. The source paths must exist after `.dockerignore` filtering. |
| **RUN** | Executes a command during the image build. `npm ci --omit=dev` installs production dependencies into the image filesystem. |
| **ENV** | Stores default environment variables in image metadata. Containers started from the image receive these values unless the runtime overrides them. |
| **USER** | Sets the default Linux user for later build steps and for the running container process. A non-root runtime user reduces the power of the application process. |
| **EXPOSE** | Records the port the service expects to listen on. A local `-p` flag or a production service still controls actual traffic publishing. |
| **CMD** | Defines the default command for a container created from the image. The JSON-array form runs the program directly instead of through a shell. |

The timing matters. `RUN npm ci --omit=dev` runs while Docker builds the image, so the image stores the installed dependencies. `CMD ["node", "src/server.js"]` runs later when someone starts a container from that image. That split explains why a build can succeed while the container still fails at startup: the build and runtime phases answer different questions.

The `USER` line also deserves early attention. Build steps often need root permissions because package managers create directories and install files. The running application usually needs only enough permission to read its files, open a network port above 1024, and write logs to standard output. A production review should check where the Dockerfile switches away from root and whether the app has write access only where it needs it.

Now the team can read the Dockerfile instructions. The next production concern is instruction order, because order controls how much work Docker repeats during everyday development.

## Dependency Ordering and Repeatable Builds
<!-- section-summary: Copy lockfiles before source files so dependency installs depend on dependency changes, not every code edit. -->

Most application builds have one expensive step. A Node service downloads packages, a Python service installs wheels, a Java service downloads Maven artifacts, and a Rust service compiles crates. For `shipping-api`, the expensive step is `npm ci --omit=dev`.

The dependency identity lives in `package.json` and `package-lock.json`. The application behavior lives in `src/`, and those source files change much more often than the lockfile. A clean Dockerfile separates those two kinds of change so Docker can reuse earlier build work when only route code changes.

This version creates extra work during normal edits. It copies source files and dependency files together before the expensive install step.

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY . .
RUN npm ci --omit=dev

CMD ["node", "src/server.js"]
```

The broad `COPY . .` instruction pulls every included context file into the image before the dependency install. A one-line edit in `src/routes.js` changes the input to that copy step, so the later npm install step has to run again. The dependency files stayed the same, yet the Dockerfile gave Docker no clean boundary between dependency changes and source changes.

This version gives Docker that boundary. The dependency files enter first, and the source files enter after the install step.

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

CMD ["node", "src/server.js"]
```

Now Docker sees dependency files first, runs the install, and copies source code after that. When a developer changes `src/routes.js`, the source copy changes and the final image contains the new code. The dependency install can stay reusable because its inputs, `package.json` and `package-lock.json`, did not change.

The same pattern works across languages. A Python image copies `pyproject.toml` and the lockfile before installing dependencies. A Go image copies `go.mod` and `go.sum` before copying the rest of the module. A Java image copies Maven or Gradle metadata before copying `src/`.

This ordering also helps CI and review. CI spends less time repeating dependency installs for ordinary source edits, and reviewers can see which files control the dependency graph. When the team later studies image layers and cache, this article's ordering will become the foundation for faster builds.

The Dockerfile now handles normal public dependency installs. Some teams also need private packages, build-time version values, or environment defaults, so we need to separate `ARG`, `ENV`, and build secrets before we call the Dockerfile production-ready.

## ARG, ENV, and Build Secrets
<!-- section-summary: ARG configures the build, ENV configures image defaults, and build secrets handle sensitive values for one build step. -->

An **`ARG` value** is a build-time variable. It can parameterize Dockerfile instructions, such as a release version or a base-image variant. For `shipping-api`, CI might pass the Git commit SHA into the build so the application can report which version it runs.

```dockerfile
ARG APP_VERSION=local
ENV APP_VERSION=$APP_VERSION
```

```bash
GIT_SHA="$(git rev-parse --short HEAD)"
docker build --build-arg APP_VERSION="$GIT_SHA" -t shipping-api:"$GIT_SHA" .
```

An **`ENV` value** is an image environment default. Containers created from the image receive that value unless the runtime overrides it. `ENV NODE_ENV=production` and `ENV PORT=3000` make sense because they are safe defaults for the process and they do not contain passwords, API tokens, or private database URLs.

The boundary is important because both `ARG` and `ENV` can expose values through image metadata, build history, provenance, or runtime inspection. A build argument works well for a non-secret version string. An environment variable works well for a non-secret default. A secret needs a different path.

A **build secret** is a sensitive value that Docker exposes only to a specific build instruction. The common `shipping-api` example is a private npm registry token. The build needs the token during `npm ci`, and the final image should not contain that token afterward.

The local build command can pass an npm config file as a secret. The file stays on the build client, and Docker exposes it only to instructions that explicitly request it.

```bash
docker build \
  --secret id=npmrc,src="$HOME/.npmrc" \
  -t shipping-api:local .
```

The Dockerfile can consume that secret for the install step. The mount target gives npm the same config shape it expects without copying the file from the context.

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci --omit=dev
```

That secret mount exists for that `RUN` instruction. The file does not become a normal copied file in the image, and the Dockerfile avoids putting sensitive values in `ARG` or `ENV`. Docker's build checks also flag suspicious `ARG` or `ENV` names that look like they hold secrets, which gives CI another way to catch risky Dockerfiles before a release.

There is a related runtime secret boundary. If `shipping-api` needs `DATABASE_URL` in production, the image should receive that value from the platform that starts the container: Docker Compose for local development, Kubernetes Secrets, a cloud container service, or a secret manager integration. The image should carry the application and safe defaults; the runtime should provide environment-specific secrets.

![ARG ENV and build secret boundary infographic showing build arg version labels, safe environment defaults, a temporary npm token secret mount used for one install step, and a final shipping-api image with no token](/content-assets/articles/article-containers-orchestration-docker-dockerfiles/arg-env-secret-boundary.png)

_This infographic separates the three inputs: build arguments label the image, environment variables provide safe defaults, and secret mounts handle sensitive values without keeping them in image layers._

Now the build input, instruction order, and secret boundary fit together. We can write the first Dockerfile the team can actually use.

## A Clean First Dockerfile
<!-- section-summary: A clean first Dockerfile filters the context, installs from lockfiles, switches to a non-root user, and starts one process. -->

Here is a complete first Dockerfile for `shipping-api`. It keeps the article's first-build scope, so multi-stage builds and cache mounts wait for the next article.

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && chown -R app:app /app

COPY --chown=app:app src ./src

ARG APP_VERSION=local
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
ENV PORT=3000

USER app

EXPOSE 3000

CMD ["node", "src/server.js"]
```

The first line selects the Dockerfile syntax frontend. That line keeps newer BuildKit Dockerfile features available in a clear, explicit way, including secret mounts when the team needs them. The `FROM` line chooses the Node base image, and the `WORKDIR` line gives the application a stable home.

The `RUN addgroup` line creates a dedicated runtime user. The package install still runs before the `USER app` switch, which keeps the build simple. After npm installs production dependencies, `chown -R app:app /app` gives the runtime user ownership of the application directory.

The two `COPY` groups keep dependency files and source files separate. `COPY package.json package-lock.json ./` feeds the dependency install. `COPY --chown=app:app src ./src` brings in the service code after dependencies and gives the runtime user ownership immediately.

The environment defaults carry safe runtime information. `APP_VERSION` can hold a commit SHA, `NODE_ENV` tells Node libraries to use production behavior, and `PORT` documents the port the app reads. Secrets such as `DATABASE_URL`, `JWT_SECRET`, and registry tokens stay outside this Dockerfile.

The matching `.dockerignore` should live beside the Dockerfile. This keeps local-only files out of the context before any `COPY` instruction has a chance to use them.

```dockerignore
.git
.github
.env
.env.*
.npmrc
node_modules
npm-debug.log*
yarn-error.log*
coverage
dist
build
tmp
*.log
*.pem
Dockerfile.local
compose.override.yaml
```

The local build command can stay small. The tag names this local image so the team can run it without pushing anything to a registry.

```bash
docker build -t shipping-api:local .
```

The local smoke test can start the container and call the health route. This proves that the default `CMD`, port, and runtime user work together before CI gets involved.

```bash
docker run --rm -d --name shipping-api-smoke -p 3000:3000 shipping-api:local
curl -fsS http://localhost:3000/health
docker rm -f shipping-api-smoke
```

This Dockerfile gives the team a good first production shape. It has a filtered input, a clear dependency boundary, one process, safe defaults, a non-root runtime user, and an obvious path for CI to tag and push the same artifact later.

## Production Review Guidance
<!-- section-summary: Production review checks the image input, secret handling, runtime user, startup command, and registry handoff. -->

A production Dockerfile review should sound practical. The reviewer should ask what enters the build, what enters the final image, which user runs the process, and how the same image moves from local build to CI to registry. For `shipping-api`, those questions can turn into a short review checklist.

**Context review** checks the build command and `.dockerignore`. The team should know whether CI builds from `shipping-api/` or from a monorepo root. The Dockerfile paths should match that choice, and the context should exclude local dependencies, Git history, coverage output, logs, private key files, `.env`, and token-bearing `.npmrc` files.

**Dockerfile review** checks instruction order and runtime defaults. Dependency manifests should enter the image before source files, broad `COPY . .` should have a clear reason, and `CMD` should use exec form for a long-running service. `EXPOSE 3000` should match the app's listener, and the app should bind to `0.0.0.0` inside the container so Docker's published port can reach it.

**Secret review** checks every `ARG`, `ENV`, and copied config file. Build-time tokens should use `--secret` and a secret mount. Runtime secrets should come from the deployment platform, so the same image can move from staging to production while the secret values change outside the image.

**User review** checks the default runtime identity. The container should run as `app`, `node`, or another dedicated non-root user. If the app needs a writable directory, the Dockerfile should create and own that directory explicitly instead of giving the whole container root permissions.

**Registry review** checks how CI tags and pushes the image. A real pipeline often uses the Git SHA as an immutable tag, pushes the image to a registry, and records the digest returned by the registry. The digest identifies the exact image content and gives deployment systems a precise artifact to promote.

A simple CI build and smoke-test sequence can look like this. The example uses the Git SHA as a tag so the pushed image maps back to a specific source revision.

```bash
GIT_SHA="$(git rev-parse --short HEAD)"
IMAGE="ghcr.io/acme/shipping-api:${GIT_SHA}"

docker build --pull --build-arg APP_VERSION="$GIT_SHA" -t "$IMAGE" .
docker run --rm -d --name shipping-api-smoke -p 3000:3000 "$IMAGE"
curl -fsS http://localhost:3000/health
docker rm -f shipping-api-smoke
docker push "$IMAGE"
```

That flow builds the image, proves that the default command starts the service, and pushes the same image that passed the smoke test. Later deployment steps can pull the tag or digest from the registry and run it in the target environment.

The review work also sets up better troubleshooting. When a build fails, the team can ask whether the failure came from the context, the Dockerfile instruction order, the secret boundary, or the runtime defaults.

## Troubleshooting the First Build
<!-- section-summary: Common first-build failures usually come from context paths, ignore rules, secret handling, port publishing, or file ownership. -->

The most common first error is a missing file during `COPY`. The Dockerfile says `COPY src ./src`, and Docker reports that `src` cannot be found. The usual causes are a build command launched from the wrong directory, a monorepo context that does not match the Dockerfile paths, or a `.dockerignore` rule that excluded too much.

The build command should match the context you intended. In a monorepo, this command uses the service folder as the context while reading the Dockerfile from that same folder:

```bash
docker build -t shipping-api:local services/shipping-api
```

This command uses the monorepo root as the context and points Docker at the service Dockerfile. That shape makes sense when the build needs files shared from the repository root.

```bash
docker build -f services/shipping-api/Dockerfile -t shipping-api:local .
```

Both patterns can work. The Dockerfile's `COPY` paths need to match the chosen context, and the `.dockerignore` file that applies to the build needs to live at the context root or use the Dockerfile-specific ignore file pattern that the team has chosen.

Another common problem is a huge build context. Docker's build output shows a "transferring context" step, and that step may show hundreds of megabytes before Docker runs `npm ci`. That usually means `node_modules`, `.git`, coverage reports, screenshots, or generated bundles entered the context.

The fastest fix is reviewing `.dockerignore` and rebuilding. The next build output should show a smaller context transfer before dependency installation starts.

```bash
docker build --progress=plain -t shipping-api:local .
```

The plain progress output makes the context transfer and each build step easier to see in CI logs. If the context still looks large, the team should check generated directories and token files first because those files carry both performance and security risk.

Secret warnings need a different fix. If Docker reports a `SecretsUsedInArgOrEnv` build check, the Dockerfile likely has a variable name such as `NPM_TOKEN`, `AWS_SECRET_ACCESS_KEY`, or `DATABASE_PASSWORD` in `ARG` or `ENV`. The safer build shape passes the value through `docker build --secret` and consumes it with a `RUN --mount=type=secret` instruction.

Permission errors usually appear after adding `USER app`. The process may try to write into `/app`, create a cache directory, or write a temporary file in a root-owned path. The Dockerfile should create the needed writable path and give ownership to the runtime user.

```dockerfile
RUN mkdir -p /app/tmp && chown -R app:app /app
```

Port problems often come from confusing `EXPOSE` with publishing. `EXPOSE 3000` documents the port in image metadata, and local Docker still needs a `-p` flag to publish traffic from the host into the container. The Node server also needs to listen on `0.0.0.0`, because binding only to `localhost` inside the container keeps the service inside the container namespace.

```bash
docker run --rm -p 3000:3000 shipping-api:local
```

Startup failures belong to the runtime side of the story. The build can finish successfully while `CMD ["node", "src/server.js"]` points to a missing file, the app expects a runtime secret, or the health route crashes during boot. A short container run plus logs usually gives the next clue.

```bash
docker run -d --name shipping-api-debug shipping-api:local
docker logs shipping-api-debug
docker rm -f shipping-api-debug
```

These debugging paths all connect back to the same first build discipline: define the input files, copy them intentionally, keep secrets out of image metadata, and make the runtime defaults visible. Once that foundation works, Docker layers and cache explain why some changes rebuild quickly while others rebuild from the beginning.

![Dockerfile review summary infographic showing small context, lockfiles before src, no secrets in image, non-root user, smoke test, and the final shipping-api local image](/content-assets/articles/article-containers-orchestration-docker-dockerfiles/dockerfile-review-summary.png)

_This summary image turns the first Dockerfile into a review checklist: keep the input small, install from lockfiles, avoid baked-in secrets, run as a non-root user, and smoke test the image before CI publishes it._

## What's Next

You now have the first complete Docker image build for `shipping-api`. The team knows what a Dockerfile does, what the build context contains, how `.dockerignore` protects the input, why dependency files come before source files, and where `ARG`, `ENV`, and build secrets belong.

The next article goes one level deeper into image layers and cache. That is where the Dockerfile changes from a working recipe into a faster, smaller, and easier-to-review build pipeline.

---

**References**

- [Build context](https://docs.docker.com/build/concepts/context/) - Official Docker documentation for local and remote build contexts, `.dockerignore` files, pattern rules, named contexts, and files available to the builder.
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) - Official reference for Dockerfile instructions including `FROM`, `COPY`, `RUN`, `ENV`, `USER`, `EXPOSE`, and `CMD`.
- [Building best practices](https://docs.docker.com/build/building/best-practices/) - Official Docker guidance for `.dockerignore`, build cache, base images, CI builds, and maintainable Dockerfiles.
- [Build secrets](https://docs.docker.com/build/building/secrets/) - Official guidance for passing sensitive values to a build through secret mounts, SSH mounts, and Git authentication for remote contexts.
- [Build variables](https://docs.docker.com/build/building/variables/) - Official explanation of `ARG` and `ENV`, including their build-time and runtime behavior.
- [SecretsUsedInArgOrEnv](https://docs.docker.com/reference/build-checks/secrets-used-in-arg-or-env/) - Official Docker build check that warns when likely secret values appear in `ARG` or `ENV`.
