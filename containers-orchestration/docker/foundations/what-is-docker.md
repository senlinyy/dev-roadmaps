---
title: "What Is Docker"
description: "Learn how Docker packages application code, runtime files, and startup settings into images, then runs them as isolated containers on a host."
overview: "This article follows a small inventory API from source code to image, running container, local port, registry, and storage boundary so the core Docker pieces connect in one clear path."
tags: ["docker", "containers", "images"]
order: 1
id: article-containers-orchestration-docker-what-is-docker
aliases:
  - why-containers-exist
  - article-containers-orchestration-container-fundamentals-why-containers-exist
  - containers-orchestration/container-fundamentals/why-containers-exist.md
  - images-vs-containers
  - article-containers-orchestration-container-fundamentals-images-vs-containers
  - containers-orchestration/container-fundamentals/images-vs-containers.md
  - processes-filesystems-ports-env-vars
  - article-containers-orchestration-container-fundamentals-processes-filesystems-ports-env-vars
  - containers-orchestration/container-fundamentals/processes-filesystems-ports-env-vars.md
  - containers-vs-virtual-machines
  - article-containers-orchestration-container-fundamentals-containers-vs-virtual-machines
  - containers-orchestration/container-fundamentals/containers-vs-virtual-machines.md
---

## Table of Contents

1. [The Story We Will Follow](#the-story-we-will-follow)
2. [The Problem Docker Solves](#the-problem-docker-solves)
3. [Images](#images)
4. [Dockerfiles, Build Context, and Layers](#dockerfiles-build-context-and-layers)
5. [Containers](#containers)
6. [Docker Engine](#docker-engine)
7. [Registries, Tags, and Digests](#registries-tags-and-digests)
8. [Files, Ports, Environment, and Mounts](#files-ports-environment-and-mounts)
9. [Containers and Virtual Machines](#containers-and-virtual-machines)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Story We Will Follow
<!-- section-summary: We will follow one inventory API from source code to image, container, host port, registry, and storage boundary. -->

Let's follow a small service called `inventory-api`. It powers a warehouse dashboard, returns product counts through HTTP, and listens on port `3000`. The service is simple enough for a first Docker article, and it is real enough to show the problems teams hit in daily work.

On a developer laptop, the service might start with `npm start`. That command depends on more than the JavaScript files in the repository. It also depends on the Node version, package manager behavior, native libraries, environment variables, network access to a database, and the operating system details around the process.

Docker gives the team a way to package the service runtime into a **Docker image** and run that package as a **container**. The image carries the application files and startup defaults. The container is the live process created from that image.

![Docker package path infographic showing inventory-api source code flowing through a Dockerfile into an image, a running container, a registry, and host port 8080](/content-assets/articles/article-containers-orchestration-docker-what-is-docker/docker-package-path.png)

*The Docker path starts with source code, turns the runtime recipe into an image, and then runs that image as a container that can publish a host port or move through a registry.*

That path gives us the structure for the article. We will start with the environment problem, then move through images, Dockerfiles, build context, layers, containers, Docker Engine, registries, runtime settings, and virtual machines. Each part answers one practical question the inventory team has to solve before the service can run reliably.

## The Problem Docker Solves
<!-- section-summary: Docker turns a fragile local setup into a repeatable package that can run across developer machines, CI, and production hosts. -->

A **runtime environment** is everything the application needs around the code to start and behave correctly. For `inventory-api`, that means Node, npm dependencies, compiled native packages, Linux libraries, a startup command, a working directory, a port, and settings such as `DATABASE_URL` and `LOG_LEVEL`.

Without Docker, every place that runs the service has to recreate that environment by hand or through separate setup scripts. One developer may have Node 22, another may have Node 20, and CI may use a fresh Linux machine with no cached packages. The same source code then travels through several slightly different worlds before it reaches production.

This is a common team problem Docker helps with. A new engineer clones the repository and the install fails because a package needs a missing system library. The CI job passes after someone adds a hidden setup step to the build machine. The production server has an older runtime, so the deployment starts successfully and crashes on the first request.

The team still handles configuration, databases, networks, and operations work. Docker gives the team a stronger boundary for the application package. The team writes the runtime setup once, builds it into an image, and starts containers from that image in local development, CI, staging, and production.

For the inventory team, this changes the daily conversation. Instead of asking "Which Node version did you install on your laptop?" the team can ask "Which image tag did you run?" That more precise question leads us to the first Docker object to define: the image.

## Images
<!-- section-summary: A Docker image is the packaged application filesystem and startup metadata that Docker can use to create containers. -->

A **Docker image** is a packaged set of files and metadata used to create containers. It commonly includes a base filesystem, a language runtime, application dependencies, application code, and default startup instructions. In the inventory story, the image is the packaged form of `inventory-api`.

An image is read-only from the container's point of view. Docker can create many containers from the same image, and each container starts from the same packaged files. This is why images work well as deployment artifacts: the image that passed tests can be the same image that staging or production pulls later.

For `inventory-api`, the image needs a few concrete pieces. It needs Node because the service runs JavaScript. It needs the production npm dependencies because the app imports libraries. It needs the `src` directory because that contains the server code. It also needs a default command so Docker knows what process to start.

A local image name often looks like this:

```bash
inventory-api:local
```

The part before the colon is the image repository name, and the part after the colon is the **tag**. A tag is a readable label for humans and tools. In local development, `local` is fine. In CI, a team may use a Git SHA, a release number, or a date-based build label.

An image can sit in the local Docker image store on a developer machine. That is useful for testing, and it is only the first half of the story. To create the image in a repeatable way, the team needs a recipe, and Docker calls that recipe a Dockerfile.

## Dockerfiles, Build Context, and Layers
<!-- section-summary: A Dockerfile describes how to build an image, the build context supplies files to the builder, and layers let Docker reuse repeated work. -->

A **Dockerfile** is a file of build instructions. Each instruction tells Docker how to prepare part of the image. A Dockerfile gives the team a plain, reviewable place to describe the runtime setup for `inventory-api`.

Here is a beginner-friendly Dockerfile for the service:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 3000
CMD ["node", "src/server.js"]
```

The `FROM` instruction chooses the base image. `node:22-alpine` gives the service Node 22 on a small Alpine Linux base. The team starts from a maintained Node image so they can focus on the application instead of building Node from scratch.

The `WORKDIR` instruction sets `/app` as the default directory for later instructions and for the container's command. The first `COPY` brings in the package files before the source code. The `RUN npm ci --omit=dev` instruction installs production dependencies in a predictable way.

The second `COPY` brings the application source into the image. `EXPOSE 3000` documents that the app expects to listen on port `3000` inside the container. `CMD ["node", "src/server.js"]` sets the default process for containers created from this image.

The build command often looks like this:

```bash
docker build -t inventory-api:local .
```

The final `.` is the **build context**. The build context is the set of files the builder can read while it processes the Dockerfile. In this command, Docker sends the current directory as the build context, so `COPY package*.json ./` and `COPY src ./src` can read those files.

The build context deserves attention because it can accidentally include too much. A repository may contain `node_modules`, `.git`, test reports, local database dumps, and `.env` files. Real teams usually add a `.dockerignore` file so the builder receives only the files it needs.

```dockerignore
node_modules
.git
.env
coverage
tmp
```

Docker builds images in **layers**. A layer records a filesystem change from a build step, such as installing dependencies or copying source files. Docker stores layers by content, so repeated builds can reuse unchanged work.

That layer behavior explains the order of the Dockerfile. Package files change less often than application source files, so the Dockerfile copies package files first and installs dependencies before copying `src`. If a developer changes only `src/server.js`, Docker can reuse the dependency layer and rebuild the later source layer.

The image now exists as a package. The next step creates a live process from it.

## Containers
<!-- section-summary: A container is a running instance of an image with its own process, network view, and writable layer. -->

A **container** is a running instance of an image. Docker takes the image, creates a container record, gives it a writable layer, prepares networking, and starts the image's command as a process. For our service, that process is `node src/server.js`, and the first local run might look like this:

```bash
docker run --name inventory-api -p 8080:3000 -e PORT=3000 inventory-api:local
```

This command asks Docker to create a container named `inventory-api` from the `inventory-api:local` image. The `-e PORT=3000` flag passes an environment variable into the process. The `-p 8080:3000` flag publishes container port `3000` on host port `8080`, so a browser on the developer machine can call `http://localhost:8080`.

Inside the container, the service sees a filesystem built from the image plus its own writable layer. It also sees its own process view and network setup. The host still runs the real operating system, and Docker gives the container enough isolation for the app to behave like a separate runtime area.

The phrase **running instance** is important. The image is the package, and the container is one live copy of that package. The team can start one container for local testing, another in CI for integration tests, and several in production for traffic. They can all come from the same image tag.

The container's writable layer is useful for temporary runtime changes. If `inventory-api` writes `/tmp/request.log`, that file lands in the container's writable layer. If the team removes the container and starts a fresh one from the same image, the fresh container starts from the original packaged files again.

That lifecycle gives Docker a clean replacement pattern. Instead of repairing a long-running app directory by hand, teams build a new image and start new containers from it. The old container can stop after traffic moves away.

Something on the host has to receive the `docker run` request, prepare all of this, and keep track of the container. Docker Engine is the host system that does that work.

## Docker Engine
<!-- section-summary: Docker Engine is the client-server system that receives Docker commands and manages images, containers, networks, volumes, and runtimes. -->

**Docker Engine** is Docker's core client-server system for building and running containers. The `docker` command in the terminal is the client. The Docker daemon, usually called `dockerd`, receives API requests and manages Docker objects on the host.

This split is important because the daemon handles the host-level work behind each Docker command. The CLI sends a request. The daemon checks local images, pulls missing images if needed, prepares storage and networking, asks the lower-level runtime to start the process, and records the container state.

![Docker Engine request path infographic showing docker CLI calling the Docker API, dockerd managing images networks and volumes, then the container runtime starting the inventory-api process](/content-assets/articles/article-containers-orchestration-docker-what-is-docker/docker-engine-request-path.png)

*The CLI is only the front door. Docker Engine receives the request, manages local Docker objects, and asks the runtime to start the application process.*

On a Linux server, Docker Engine usually runs directly on the host operating system. On Docker Desktop for macOS and Windows, Docker runs a Linux environment behind the scenes so Linux containers have the kernel features they need. The user still types normal Docker commands from the native terminal.

The daemon also owns local Docker state. It stores built images, pulled images, stopped container records, networks, named volumes, and build cache. That state speeds up development because the next build can reuse layers and the next run can reuse a local image.

The same local state can also fill disk space over time. A developer who builds many tags and leaves old containers around may eventually need cleanup commands such as `docker ps -a`, `docker image ls`, and `docker system prune`. The workflow article will spend more time on those daily commands.

At this point, the image and container work on one machine. A team also needs to move the image between machines without rebuilding it every time, and that sharing problem brings us to registries.

## Registries, Tags, and Digests
<!-- section-summary: A registry stores image repositories, tags give images readable names, and digests identify exact image content. -->

A **container registry** stores and distributes images. Docker Hub is Docker's public registry service, and many production teams use private registries such as Amazon ECR, Google Artifact Registry, Azure Container Registry, GitHub Container Registry, or private Docker Hub repositories. The registry gives laptops, CI, staging, and production a shared place to exchange image artifacts.

An image reference can include a registry host, namespace, repository, and tag. A production-style reference for the inventory service might look like this. The registry host is fake here, and the shape matches what teams use with private registries:

```bash
registry.example.com/platform/inventory-api:2026-06-21.1
```

In that example, `registry.example.com` is the registry host. `platform/inventory-api` is the repository path. `2026-06-21.1` is the tag. The tag gives the release a readable name that humans can discuss in tickets, dashboards, and deployment logs.

The publish flow has three common commands. The team can tag the local image for the registry, push it, and later pull the same reference from another machine. The commands use the same fake registry host from the previous example:

```bash
docker tag inventory-api:local registry.example.com/platform/inventory-api:2026-06-21.1
docker push registry.example.com/platform/inventory-api:2026-06-21.1
docker pull registry.example.com/platform/inventory-api:2026-06-21.1
```

The inventory team can build once in CI, run tests against that image, then push the approved image to the registry. Staging and production can pull that same image instead of rebuilding from source on each server. This keeps the deployment artifact tied to the tested artifact.

Tags need discipline because a tag is a name that can be reused by whoever can push to the repository. A team may push a new image to `latest`, and the name now points at new content. That is convenient during experiments and risky for production records.

A **digest** identifies image content by a cryptographic hash. A digest-based reference points to exact image bytes rather than a movable tag. Production systems often record digests in deployment history, and some teams deploy by digest after using tags for human-friendly release names.

The registry answers the sharing question. The next question is how a container receives settings and data at runtime, because the same image should run in development, staging, and production with different surroundings.

## Files, Ports, Environment, and Mounts
<!-- section-summary: Runtime settings connect a container to host traffic, configuration values, temporary files, and durable storage. -->

The image should contain the application package, and the runtime should supply environment-specific details. For `inventory-api`, development may use a local database, staging may use a shared test database, and production may use managed database credentials from a secret system. One reusable image can receive a different database URL in each environment.

**Environment variables** pass configuration into the process. An environment variable is a name-value setting visible to the app at runtime, such as `PORT`, `DATABASE_URL`, or `LOG_LEVEL`. The image stays the same, while each environment passes the values it needs.

```bash
docker run \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  -e LOG_LEVEL=debug \
  -e DATABASE_URL=postgres://inventory:secret@inventory-db:5432/inventory \
  inventory-api:local
```

**Ports** connect container networking to the host. The service listens on port `3000` inside the container, and `-p 8080:3000` publishes it on port `8080` on the host. The left side belongs to the host, and the right side belongs to the container.

That means a developer opens `http://localhost:8080` from the laptop. The application still listens on `3000` inside the container. This split lets teams run several services with their normal internal ports while choosing host ports that fit the local machine.

**Files** inside the container come from the image layers plus the container's writable layer. The image layers contain the packaged app. The writable layer catches changes made after the container starts, such as temporary files, generated cache files, or logs written to local disk.

The writable layer belongs to that one container. If a developer removes the container, data in that layer goes with it. That is fine for temporary files, and it is a poor place for important state such as database files, uploaded documents, or anything the team expects to survive replacement.

**Volumes** store data outside an individual container's writable layer. A named volume is managed by Docker and can remain after a container is removed. For a local PostgreSQL database used by the inventory service, the database container can store its data in a named volume.

```bash
docker volume create inventory-db-data

docker run \
  --name inventory-db \
  -e POSTGRES_PASSWORD=secret \
  -v inventory-db-data:/var/lib/postgresql/data \
  postgres:16
```

In that command, `inventory-db-data` is the named volume, and `/var/lib/postgresql/data` is the path inside the container where PostgreSQL stores database files. The database container can be deleted and recreated while the named volume keeps the local data.

**Bind mounts** connect a specific host path into a container. During development, the team may mount the working tree into a container so code changes show up immediately. That is useful for fast feedback, and the team should still run clean image builds because production runs from the image rather than a live laptop folder.

```bash
docker run \
  --name inventory-api-dev \
  -p 8080:3000 \
  -v "$PWD/src:/app/src" \
  -e PORT=3000 \
  inventory-api:local
```

These runtime settings are the daily bridge between the packaged app and the real machine around it. Files, ports, environment variables, volumes, and bind mounts decide what the container can read, where it can listen, and which data survives replacement.

With those pieces in place, Docker starts to sound like a small machine around the app. That raises a common beginner question: how is this different from a virtual machine?

## Containers and Virtual Machines
<!-- section-summary: Containers isolate application processes on a shared host kernel, while virtual machines package complete guest operating systems. -->

A **virtual machine** is a full guest machine. It has virtual hardware, a guest operating system, a guest kernel, system services, and then the application. A **container** runs as an isolated process on a Docker host and shares the host kernel with other containers on that host.

For the inventory service, a VM path might create an Ubuntu VM, install Node, copy the app, configure a service manager, open a firewall rule, and patch the guest OS over time. A Docker path builds an image with Node, dependencies, app files, and startup metadata, then starts a container from that image on a host that already runs Docker.

| Topic | Container | Virtual machine |
| --- | --- | --- |
| Boundary | Application process with Docker-managed isolation | Complete guest machine |
| Kernel | Shares the host kernel | Uses a guest kernel |
| Startup path | Starts the app process | Boots an operating system and starts services |
| Package contents | App files, runtime, libraries, metadata | Guest OS plus application setup |
| Common use | Services, jobs, CI tasks, development environments | Strong OS separation, legacy workloads, mixed operating systems |

The shared-kernel design gives containers a practical advantage for many services. They often start quickly, use fewer resources than a full guest machine, and let teams run several isolated application processes on one host. Many production platforms combine both approaches: cloud VMs or Kubernetes nodes provide the host layer, and containers run the application processes on those hosts.

This boundary also explains why container security still needs care. Teams choose trusted base images, rebuild regularly, scan images, avoid running application processes as root where possible, limit mounted host paths, and keep the Docker host patched. Docker gives useful isolation, and teams still treat the host as an important security boundary, so the final step is connecting the whole path from source code to running service.

## Putting It All Together
<!-- section-summary: Docker connects the source code, Dockerfile, image, container, engine, registry, and runtime settings into one repeatable service path. -->

Let's replay `inventory-api` from the start. The team has a small service with Node code, package files, and a server that listens on port `3000`. The Dockerfile describes the runtime setup: start from a Node base image, set `/app` as the working directory, install production dependencies, copy the source, document the port, and start `node src/server.js`. The build command creates the image:

```bash
docker build -t inventory-api:local .
```

The `.` gives Docker the build context, and `.dockerignore` keeps unnecessary or sensitive files out of that context. Docker builds the image in layers, so dependency work can be reused during normal source-code edits. A developer can start the service locally from the image:

```bash
docker run \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  -e DATABASE_URL=postgres://inventory:secret@inventory-db:5432/inventory \
  inventory-api:local
```

The Docker CLI sends the request to Docker Engine. The daemon finds the image, prepares the container filesystem, sets up networking, passes the environment variables, and starts the runtime process. The developer calls `http://localhost:8080`, while the service listens on `3000` inside the container.

If the service needs temporary files, it can write them into the container's writable layer. If the local database needs durable files, the database container uses a named volume. If the developer wants fast edit-refresh feedback, a bind mount can connect the host source directory into a development container. After tests pass, CI tags the image and pushes it to a registry:

```bash
docker tag inventory-api:local registry.example.com/platform/inventory-api:2026-06-21.1
docker push registry.example.com/platform/inventory-api:2026-06-21.1
```

Staging and production pull the reviewed image from the registry and create containers from it. Deployment logs can record the tag for readability and the digest for exact content. The team now has a connected path from source code to a repeatable runtime artifact.

![Docker Foundations summary infographic showing Dockerfile, Image, Container, Ports plus Env, Volumes, and Registry plus Digest as the core Docker pieces](/content-assets/articles/article-containers-orchestration-docker-what-is-docker/docker-foundations-summary.png)

*The foundation is the same path every time: define the runtime, build the image, run containers, pass runtime settings, protect data, and share exact image content.*

That is the core of Docker. It gives teams a way to describe an application package, build it into an image, run containers from that image, share it through a registry, and keep runtime settings separate from the artifact. The inventory service stays small in this article, and the same path scales to larger services with more dependencies and stricter release controls.

## What's Next

You now know the main Docker pieces: images, Dockerfiles, build context, layers, containers, Docker Engine, registries, tags, digests, ports, environment variables, writable layers, volumes, bind mounts, and the virtual machine comparison. Those pieces are the vocabulary you need before the module moves into daily Docker commands.

The next article, Docker Workflow, turns those pieces into daily practice. It follows the same `inventory-api` service through building, running, listing, inspecting, logging, stopping, removing, rebuilding, and cleaning up Docker objects.

---

**References**

- [What is a container?](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/) - Defines containers as isolated application processes and compares containers with virtual machines.
- [What is an image?](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-an-image/) - Explains images as standardized packages with files, binaries, libraries, configuration, immutability, and layers.
- [What is a registry?](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-registry/) - Introduces registries, repositories, tags, pushing images, and pulling images.
- [Docker Engine](https://docs.docker.com/engine/) - Describes Docker Engine, the Docker daemon, APIs, CLI, and Docker objects such as images, containers, networks, and volumes.
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) - Documents Dockerfile instructions such as `FROM`, `WORKDIR`, `COPY`, `RUN`, `EXPOSE`, and `CMD`.
- [Build context](https://docs.docker.com/build/concepts/context/) - Explains the files available to the builder during image builds and why context size matters.
- [Publishing and exposing ports](https://docs.docker.com/get-started/docker-concepts/running-containers/publishing-ports/) - Shows how host ports map to container ports for local access.
- [Persisting container data](https://docs.docker.com/get-started/docker-concepts/running-containers/persisting-container-data/) - Explains volumes and why durable state belongs outside a container writable layer.
- [Sharing local files with containers](https://docs.docker.com/get-started/docker-concepts/running-containers/sharing-local-files/) - Covers bind mounts for connecting host files into containers during development.
- [Storage drivers](https://docs.docker.com/engine/storage/drivers/) - Explains image layers, writable container layers, and copy-on-write storage behavior.
