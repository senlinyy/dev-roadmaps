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

1. [The Build Starts with Two Inputs](#the-build-starts-with-two-inputs)
2. [The Build Context](#the-build-context)
3. [The `.dockerignore` File](#the-dockerignore-file)
4. [Dockerfile Instructions](#dockerfile-instructions)
5. [Dependency Installs and Source Files](#dependency-installs-and-source-files)
6. [Runtime Defaults](#runtime-defaults)
7. [A Clean First Dockerfile](#a-clean-first-dockerfile)
8. [Common Build Problems](#common-build-problems)
9. [What's Next](#whats-next)

## The Build Starts with Two Inputs
<!-- section-summary: A Docker image build combines a recipe with a selected set of project files, so the first job is knowing what enters the build. -->

When a team first puts an application into Docker, the first version often feels simple. You have a project folder, you write a few Dockerfile lines, you run `docker build`, and Docker gives you an image. That feels like copying your laptop folder into a small Linux machine, installing dependencies, and saving the result.

That picture helps for the first five minutes. A production build needs a little more care. A Docker build has two main inputs: the **Dockerfile** and the **build context**. The Dockerfile gives the builder a recipe. The build context gives the builder the files that recipe can use.

We will follow a small Node.js service called `shipping-api`. The team wants the same image to run on a developer laptop, in CI, and later in a container orchestrator. The service needs `package.json`, `package-lock.json`, `src/`, and maybe a small public config file. Local-only files such as `.env`, `.git`, local `node_modules`, test screenshots, editor settings, and database dumps should stay on the host.

A **Dockerfile** is a plain text build recipe. Each instruction says something specific, like choose a base image, set the working directory, copy files, install packages, or define the command that runs when a container starts. Docker reads those instructions from top to bottom and creates an image from the result.

A **build context** is the file set Docker makes available to that build. For a local build, the context usually comes from a directory on your machine. In `docker build -t shipping-api:local .`, the final dot means "use this current directory as the context." The Dockerfile can only copy files that exist inside that context, plus files produced by earlier build stages.

Those two inputs explain many beginner Docker problems. A build can fail because the Dockerfile asks for a file that never entered the context. A build can leak secrets because the context included `.env` and the Dockerfile copied too much. A build can take five minutes before the first instruction runs because Docker had to scan and send a huge local folder.

So before we write a cleaner Dockerfile, we need to slow down and look at the context.

## The Build Context
<!-- section-summary: The build context is the snapshot of files the builder can see, and its size and contents affect speed, security, and repeatability. -->

The **build context** is the selected project snapshot that Docker sends to the builder. Think about it as the allowed input folder for the build. If the file remains in the context after filtering, Dockerfile instructions such as `COPY` and `ADD` can use it. Files outside the context stay outside the builder's reach.

In day-to-day local work, the context often appears as a single dot:

```bash
docker build -t shipping-api:local .
```

That command gives Docker a tag name, `shipping-api:local`, and a context path, `.`. The context path matters as much as the Dockerfile. If you run the command from the repository root, Docker sees the repository root. If you run it from a nested `services/shipping-api` folder, Docker sees that nested folder instead.

Docker uses this separation because the builder may run somewhere else. The builder might be the local Docker engine, a BuildKit builder, or a remote build service in CI. The client prepares a context and sends that context to the builder instead of depending on live access to your laptop filesystem.

Here is the shape of our `shipping-api` repository:

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
    fixtures/
  .env
  .git/
  node_modules/
```

The application only needs a few of these paths for the production image. The rest may help local development, testing, or version control. Those local paths should stay outside the image build input because Docker has to evaluate the context before a `COPY` line can run.

A large context hurts the build in two ways. First, Docker spends time scanning and transferring files that the image never needs. Second, every extra file becomes a possible source of cache changes. If a test screenshot or local log file changes, a broad `COPY . .` can make Docker rebuild steps that had nothing to do with the application.

A context with secrets creates a stronger problem. If `.env` enters the context, a careless `COPY . .` can place database passwords or API keys inside an image layer. Once a secret enters an image layer and somebody pushes the image to a registry, the cleanup becomes incident response work rather than ordinary refactoring.

That is why the next file exists.

## The `.dockerignore` File
<!-- section-summary: A .dockerignore file removes local-only files from the build context before Dockerfile instructions can copy them. -->

A **`.dockerignore` file** is the filter Docker applies to the build context. It works like a gate at the entrance to the build. The file lives at the root of the context, and its patterns tell Docker which files and directories should stay out of the context snapshot.

For `shipping-api`, a practical first version looks like this:

```dockerignore
.git
.github
.env
.env.*
node_modules
npm-debug.log
coverage
dist
build
tmp
*.log
Dockerfile.local
compose.override.yaml
```

This file keeps version control history, local secrets, local dependencies, test output, build output, and developer-only Docker files out of the context. The image build still gets the files it needs: `package.json`, `package-lock.json`, and `src/`. The context becomes smaller, and the Dockerfile loses access to files that should never reach a production image.

Docker's ignore rules support normal pattern matching and a special `**` wildcard for matching across directories. They also support exceptions with `!`. For example, a documentation-heavy repository might exclude markdown files while keeping the application README:

```dockerignore
*.md
!README.md
```

The order matters because the last matching line decides whether Docker includes or excludes a file. A team should keep `.dockerignore` simple enough that the whole file can be reviewed during a security pass. Complicated exception chains make security review slower because reviewers have to trace every later override.

There is one Docker detail worth knowing early. Docker may still send the Dockerfile and `.dockerignore` to the builder because the builder needs them to run the build. If those files match ignore patterns, Dockerfile instructions lose access to them for image copies. So a line such as `COPY .dockerignore /app/.dockerignore` can fail when `.dockerignore` excludes itself.

Now our context is safer and smaller. The builder has the right input files. The next question is how the Dockerfile should use them.

## Dockerfile Instructions
<!-- section-summary: Dockerfile instructions describe the base image, filesystem changes, metadata, and default process for the image. -->

A **Dockerfile instruction** is one step in the image recipe. Docker reads the file from top to bottom, and each instruction changes either the image filesystem, the image metadata, or the build state used by later instructions.

Here is a small Dockerfile that has the important pieces:

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

`FROM` chooses the **base image**. A base image gives your build a starting filesystem and runtime. For `shipping-api`, `node:22-alpine` gives the image Node.js and a small Linux userland. A Python service might start from `python:3.13-slim`. A Go binary might use one image for building and a tiny runtime image later.

`WORKDIR` sets the working directory for following instructions. After `WORKDIR /app`, later `COPY`, `RUN`, and `CMD` instructions run relative to `/app` unless they use absolute paths. This avoids a pile of repeated `/app/...` paths and makes the image layout easier to inspect.

`COPY` moves files from the build context into the image. `COPY package.json package-lock.json ./` copies two manifest files into `/app`. `COPY src ./src` copies the application source into `/app/src`. The source files must exist in the context after `.dockerignore` filtering, or Docker will stop with a missing file error.

`RUN` executes a command during the build. In this example, `RUN npm ci --omit=dev` installs dependencies into the image filesystem. The important detail is timing: `RUN` happens while building the image, long before any container starts from the image.

`ENV` writes environment variables into the image metadata. `ENV NODE_ENV=production` gives the runtime process a default value. Application teams often use `ENV` for safe defaults. Secrets should come from the runtime platform, such as Docker secrets, Kubernetes secrets, or a cloud secret manager.

`USER` sets the default Linux user for the container process. The Node official images include a `node` user, so this Dockerfile runs the application without root privileges. In production, running as a non-root user reduces the damage from many application-level bugs.

`EXPOSE` documents the port the service listens on. It acts as image metadata for humans and tools. A local `docker run -p 3000:3000 ...` or an orchestrator service still controls network publishing.

`CMD` gives the default command for containers started from the image. The JSON-array form is called **exec form**. Docker runs the executable directly with its arguments, which gives cleaner signal handling than wrapping everything in a shell string.

Now that we know the instruction vocabulary, the next production problem appears in the order of those instructions.

## Dependency Installs and Source Files
<!-- section-summary: Stable dependency files should enter the image before noisy source files so ordinary code edits keep expensive build work reusable. -->

Most application Dockerfiles have one expensive step: installing dependencies. A Node service downloads npm packages. A Python service resolves wheels. A Java service downloads Maven artifacts. A Rust service compiles crates. That work can take seconds on a warm laptop and several minutes in a cold CI runner.

For `shipping-api`, the dependency identity lives in `package.json` and `package-lock.json`. The application source code lives in `src/`. Source files change many times a day. Lockfiles change only when the dependency set changes. A good Dockerfile keeps those two kinds of change separate.

This version creates unnecessary rebuild work:

```dockerfile
FROM node:22-alpine
WORKDIR /app

COPY . .
RUN npm ci --omit=dev

CMD ["node", "src/server.js"]
```

The broad `COPY . .` copies every included context file before the dependency install. A change to `src/routes.js` changes the input to that `COPY` instruction. Docker then has to rerun the later `RUN npm ci --omit=dev` step, even though the dependency files stayed the same.

This version separates stable dependency files from noisy source files:

```dockerfile
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

CMD ["node", "src/server.js"]
```

Now Docker can reuse the dependency install result when only `src/` changes. The source copy still changes, and the final image still contains the new application code. The expensive package install stays cached for ordinary route edits.

The same pattern works across stacks. A Python project copies `pyproject.toml` and lockfiles before `pip install`. A Java project copies `pom.xml` or Gradle files before source. A Go project copies `go.mod` and `go.sum` before the rest of the module. The names change, but the build idea stays the same: dependency identity first, source code after.

This instruction order also improves reviews. When a teammate reads the Dockerfile, they can see which files control dependencies and which files are runtime source. That makes it easier to spot accidental context leaks and slow cache behavior before the pipeline starts hurting.

We have a build recipe now. The final piece in this first Dockerfile is the shape of the running process.

## Runtime Defaults
<!-- section-summary: Runtime defaults define how containers start, which user they use, and which safe metadata travels with the image. -->

A Docker image also carries **runtime defaults**. These defaults tell Docker what should happen when somebody runs the image with a short command line. Deployment configuration still controls environment-specific behavior, and image defaults give every environment a consistent starting point.

`CMD` and `ENTRYPOINT` control the process. `CMD ["node", "src/server.js"]` says the default container process should start the Node server. `ENTRYPOINT` can lock in the executable while `CMD` supplies default arguments. Many application images only need `CMD`; tool images often use `ENTRYPOINT` because the image behaves like a command-line program.

The exec form matters here:

```dockerfile
CMD ["node", "src/server.js"]
```

The shell form also exists:

```dockerfile
CMD node src/server.js
```

The shell form runs through a command shell. The exec form runs the executable directly. For long-running services, teams usually prefer exec form so the application process receives signals from Docker and the orchestrator in a predictable way during shutdown.

`USER` controls the Linux user for the default process:

```dockerfile
USER node
```

This line matters because many base images start as root during the build. Root can install packages and create directories, which helps the build. The application process usually needs much less power at runtime. If the base image provides a non-root user, the Dockerfile can switch to it after file ownership and installs are complete.

`ENV` gives safe defaults:

```dockerfile
ENV NODE_ENV=production
```

This value becomes part of the image metadata. Anyone who can inspect the image can see it, so it should hold normal configuration. Passwords, database URLs with credentials, Stripe keys, and cloud tokens should arrive from the runtime environment.

`EXPOSE` tells readers and tools which port the service expects:

```dockerfile
EXPOSE 3000
```

The line communicates intent. Local runs still need a publishing rule such as `-p 3000:3000`, and orchestrators still need service configuration to make port `3000` reachable.

At this point, the Dockerfile has a safe context, stable dependency order, and a clean default process. Now we can put the first version together.

## A Clean First Dockerfile
<!-- section-summary: A practical first Dockerfile keeps the context filtered, installs dependencies from lockfiles, copies only needed source, and runs with safe defaults. -->

Here is a complete first Dockerfile for `shipping-api`:

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

And here is the matching `.dockerignore`:

```dockerignore
.git
.github
.env
.env.*
node_modules
npm-debug.log
coverage
dist
build
tmp
*.log
Dockerfile.local
compose.override.yaml
```

The build command stays boring:

```bash
docker build -t shipping-api:local .
```

This first version gives the team a repeatable base. The build context contains only the files the image should consider. The dependency install depends on the lockfiles. The source copy happens after dependencies. The image runs the service as the `node` user and documents port `3000`.

In a real production pipeline, the team would add more checks around this. CI might run tests before building the production image. Security scanning might inspect the result. The release job might push the image with an immutable version tag and record the digest. Those pieces belong to later articles in this module, but this Dockerfile gives them a clean artifact to work from.

There are still improvements coming. Multi-stage builds can keep build tools out of the final runtime image. Build cache mounts can speed up dependency downloads. Digest pinning can make base image updates explicit. Those ideas sit on top of this first recipe rather than replacing it.

Before we move to layers and cache, let us handle the errors this file will help you recognize.

## Common Build Problems
<!-- section-summary: Many Dockerfile errors come from context filtering, broad copy steps, misplaced secrets, or confusing build-time and runtime configuration. -->

The first common problem is a missing file during `COPY`. The Dockerfile says `COPY src ./src`, but Docker prints an error because `src/` did not enter the context. The usual causes are a wrong build directory, a `.dockerignore` rule that matched too much, or a CI job running `docker build` from a different folder than local developers.

A good debugging habit is to check the build command first. In a monorepo, `docker build -f services/shipping-api/Dockerfile .` uses the repository root as the context, while `docker build .` from inside `services/shipping-api` uses only that service folder. Both can be valid, but the Dockerfile paths must match the chosen context.

The second problem is a secret inside the image. This usually comes from `COPY . .` combined with a weak `.dockerignore`. If a local `.env` enters the context and then enters an image layer, deleting the file in a later Dockerfile line leaves the earlier layer history intact. The safer fix is keeping the secret out of the context before the build starts.

The third problem is a slow build with no obvious expensive instruction. The context may be the expensive part. Local `node_modules`, `.git`, coverage files, screenshots, and generated bundles can make the client send a huge context before the first Dockerfile instruction does useful work. A tighter `.dockerignore` often cuts minutes from the build loop.

The fourth problem is putting runtime configuration into the image. A Dockerfile can set safe defaults with `ENV`. Environment-specific values should come from the environment that runs the container, so the same image can move from staging to production while a database hostname or feature flag changes outside the build.

The fifth problem is treating `EXPOSE` like a firewall or port publish rule. `EXPOSE 3000` records intent in image metadata. Local Docker still needs `docker run -p 3000:3000 shipping-api:local`, and a production platform still needs its own service or ingress configuration.

These problems all connect back to the same first principle for Docker images: define the input files clearly, then write the recipe clearly. Once that feels normal, the next article can explain why Docker rebuilds some steps and reuses others.

## What's Next

You now have the two inputs of an image build: the Dockerfile and the build context. You also have the first practical shape of a clean Dockerfile: filter the context, copy dependency files before source files, install from lockfiles, and set safe runtime defaults.

The next article goes under that build recipe. We will look at image layers, cache invalidation, and multi-stage builds. That is where a Dockerfile moves from "it works" to "it builds fast and ships a smaller runtime image."

---

**References**

- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) - Official reference for Dockerfile instructions, shell and exec forms, `.dockerignore`, `COPY`, `RUN`, `CMD`, `ENTRYPOINT`, `USER`, and related syntax.
- [Build context](https://docs.docker.com/build/concepts/context/) - Explains local build contexts, `.dockerignore` behavior, wildcard patterns, negation rules, and files available to the builder.
- [Building best practices](https://docs.docker.com/build/building/best-practices/) - Covers practical Dockerfile guidance, including excluding unnecessary files with `.dockerignore`.
- [CopyIgnoredFile build check](https://docs.docker.com/reference/build-checks/copy-ignored-file/) - Documents why files excluded by `.dockerignore` are unavailable to `ADD` and `COPY`.
- [docker buildx build](https://docs.docker.com/reference/cli/docker/buildx/build/) - Documents modern build command options, including build contexts and BuildKit behavior.
