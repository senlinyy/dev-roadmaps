---
title: "Images vs Containers"
description: "Separate container images from running containers so you can build, tag, run, inspect, and debug them correctly."
overview: "An image is the packaged filesystem and startup metadata. A container is a running instance created from that image, with its own writable layer, process state, and runtime settings."
tags: ["images", "containers", "layers", "tags"]
order: 2
id: article-containers-orchestration-container-fundamentals-images-vs-containers
---

## Table of Contents

1. [The Build Artifact and the Running Process](#the-build-artifact-and-the-running-process)
2. [What Lives in an Image](#what-lives-in-an-image)
3. [What Changes in a Container](#what-changes-in-a-container)
4. [Tags, Digests, and Review Evidence](#tags-digests-and-review-evidence)
5. [The Writable Layer](#the-writable-layer)
6. [Inspecting the Difference](#inspecting-the-difference)
7. [A Failure from Confusing the Two](#a-failure-from-confusing-the-two)
8. [The Tradeoff Between Rebuild and Patch](#the-tradeoff-between-rebuild-and-patch)
9. [How Registries Fit the Model](#how-registries-fit-the-model)
10. [Reviewing Image Changes](#reviewing-image-changes)

## The Build Artifact and the Running Process

The first container vocabulary trap is mixing up the thing you build with the thing you run. An image is the packaged artifact. It contains a filesystem snapshot and metadata such as the default command, environment variables, working directory, exposed ports, and labels. A container is what the runtime creates when it starts an image with a particular set of runtime settings.

If you have used JavaScript, the difference is close to a class and an object, but do not push the analogy too far. The image is reusable source material. The container is one running instance with state: a process ID, logs, a start time, network settings, exit status, and a writable layer. You can start ten containers from the same image, just as you can run the same Node script ten times.

For `devpolaris-orders-api`, the image answers: "Which files and default command are we shipping?" The container answers: "Is one instance of that package running right now, with which port mapping and env vars?"

```mermaid
flowchart TD
    A["Dockerfile<br/>recipe"] --> B["Image<br/>devpolaris-orders-api:1.4.0"]
    B --> C["Container A<br/>staging env vars"]
    B --> D["Container B<br/>production env vars"]
    B --> E["Container C<br/>local debug port"]
```

This distinction becomes practical during incidents. If production is running the wrong image, rebuilding is not the first check. You inspect the running container or deployment and confirm the image reference it actually uses.

## What Lives in an Image

An image is built from layers. A layer is a filesystem change produced by a build step, such as installing packages or copying application files. Layers are content-addressed, which means their identity is derived from their content. That lets registries and hosts reuse layers instead of downloading the same bytes repeatedly.

A simplified image for `devpolaris-orders-api` might contain these pieces:

```text
Image: ghcr.io/devpolaris/orders-api:1.4.0

Layers:
  1. Debian slim userland
  2. Node runtime files
  3. /app/package.json and /app/package-lock.json
  4. node_modules installed by npm ci --omit=dev
  5. /app/server.js and route files

Metadata:
  WorkingDir: /app
  Env: NODE_ENV=production
  ExposedPorts: 3000/tcp
  Cmd: ["node", "server.js"]
```

The metadata matters as much as the files. If the command points at a missing script, the image builds but containers fail at startup. If the working directory is wrong, relative paths break. If the default environment is misleading, operators may assume the image is production-ready when it still needs runtime configuration.

The image should not contain secrets. A database password copied into an image can be pulled by anyone with image access and can survive in old layers even after you remove it from a later Dockerfile line. Runtime configuration such as `DATABASE_URL` belongs outside the image.

## What Changes in a Container

When you run an image, the runtime creates a container. It adds runtime settings and starts the configured process. The image itself remains read-only. The container gets a writable layer on top, which captures files created or changed while the container runs.

Here is a local run:

```bash
$ docker run --name orders-api \
  -p 8080:3000 \
  -e DATABASE_URL=postgres://orders:secret@db.internal:5432/orders \
  ghcr.io/devpolaris/orders-api:1.4.0

orders-api listening on 0.0.0.0:3000
```

That command does not create a new image. It creates a container from an existing image. The container has the name `orders-api`, a host port mapping from `8080` to container port `3000`, and a runtime environment variable that was not baked into the image.

You can see running containers separately from local images:

```bash
$ docker image ls ghcr.io/devpolaris/orders-api
REPOSITORY                       TAG       IMAGE ID       CREATED        SIZE
ghcr.io/devpolaris/orders-api    1.4.0     8f4b1c2a90fd   2 hours ago    184MB

$ docker container ls --filter name=orders-api
CONTAINER ID   IMAGE                                 STATUS          PORTS
93d8a17f22ab   ghcr.io/devpolaris/orders-api:1.4.0   Up 12 seconds   0.0.0.0:8080->3000/tcp
```

The image can exist without any container running. A stopped container can exist even after the process exits. This is why Docker has separate commands for images and containers.

## Tags, Digests, and Review Evidence

An image tag is a human-friendly label such as `1.4.0`, `staging`, or `latest`. A digest is a content identity such as `sha256:...` that points to exact image bytes. Tags are convenient. Digests are stronger evidence.

This matters because tags can move. A team might build `ghcr.io/devpolaris/orders-api:staging` at 10:00, test it, then another build might push a different image to the same tag at 10:20. If production deploys the tag later, it may not deploy the bytes that passed testing.

```bash
$ docker image inspect ghcr.io/devpolaris/orders-api:1.4.0 \
  --format '{{index .RepoDigests 0}}'

ghcr.io/devpolaris/orders-api@sha256:7c8d9b6a2f2a1e3b1d0a...
```

A release record should include both a readable tag and an immutable digest. The tag helps humans talk about the release. The digest proves the exact artifact.

| Reference | Good for | Risk |
|-----------|----------|------|
| `orders-api:latest` | Quick local experiments | Moves often and hides what changed |
| `orders-api:1.4.0` | Human release notes | Can still be overwritten in weak registries |
| `orders-api@sha256:...` | Exact deployment evidence | Harder for humans to read |

In serious deployments, you often use a tag for discovery and a digest for the final pin. Kubernetes, CI systems, and registries all build on this distinction.

## The Writable Layer

A container's writable layer is useful for temporary process state. It is also a common source of false confidence. If `devpolaris-orders-api` writes uploaded invoices to `/app/uploads` inside the container, those files are not part of the image and may disappear when the container is removed.

```bash
$ docker exec orders-api sh -c 'echo test > /app/uploads/probe.txt'
$ docker exec orders-api ls /app/uploads
probe.txt

$ docker rm -f orders-api
orders-api

$ docker run --name orders-api ghcr.io/devpolaris/orders-api:1.4.0 ls /app/uploads
```

The last command prints nothing because a new container starts with the image filesystem, not the old container's writable layer. Durable data belongs in a volume, object storage, or database. The writable layer is best treated as scratch space.

This rule protects you during rollouts. If a container can be deleted and recreated without losing important data, the platform has room to reschedule, restart, and replace it. If important data lives only in the container layer, every restart becomes risky.

## Inspecting the Difference

Docker exposes different inspection surfaces because images and containers answer different questions. Use image inspection when you need to know what was built. Use container inspection when you need to know how a specific instance is running.

```bash
$ docker image inspect ghcr.io/devpolaris/orders-api:1.4.0 \
  --format 'cmd={{json .Config.Cmd}} workdir={{.Config.WorkingDir}}'

cmd=["node","server.js"] workdir=/app

$ docker container inspect orders-api \
  --format 'image={{.Image}} status={{.State.Status}} exit={{.State.ExitCode}}'

image=sha256:8f4b1c2a90fd... status=running exit=0
```

The image inspection tells you the default command and working directory. The container inspection tells you the image ID, current status, and exit code for one instance. If the image metadata is correct but the container exits, move to logs and runtime settings.

```bash
$ docker logs orders-api
orders-api listening on 0.0.0.0:3000
GET /health 200 3ms
GET /orders 500 22ms database connection refused
```

Those logs show the image and process started. The failure is now outside the image build and inside runtime dependency access, probably the database endpoint, credentials, DNS, or network path.

## A Failure from Confusing the Two

One realistic mistake is patching a running container and thinking the image has changed. A developer enters the container, installs a missing package, sees the service work, and assumes the fix will survive.

```bash
$ docker exec -it orders-api sh
# apt-get update && apt-get install -y ca-certificates
# exit

$ docker restart orders-api
orders-api
```

That may appear to work for the same container because the package landed in its writable layer. The next deployment rebuilds or recreates the container from the original image, and the package is gone. The fix belongs in the Dockerfile or base image, not in a live container shell.

The diagnostic path is to compare the image history and the running container changes:

```bash
$ docker diff orders-api
C /etc
C /etc/ssl
A /etc/ssl/certs/ca-certificates.crt

$ docker image history ghcr.io/devpolaris/orders-api:1.4.0 --no-trunc
IMAGE          CREATED BY
8f4b1c2a90fd   CMD ["node" "server.js"]
<missing>      COPY server.js ./server.js
<missing>      RUN npm ci --omit=dev
```

`docker diff` shows changes made in the container layer. `docker image history` shows the build steps that created the image. If the certificate package appears only in the container diff, the team has a live patch, not a reproducible fix.

## The Tradeoff Between Rebuild and Patch

Rebuilding an image is slower than editing a live container, but it gives you repeatability. The Dockerfile change can be reviewed, CI can build the image, a scanner can inspect it, and staging can run the same artifact that production will run.

Live patches still have a place in short emergency investigation. You might enter a container to inspect files, run `env`, check DNS, or prove that a missing package is the cause. Treat that as diagnosis. The durable repair goes back into the image recipe or runtime configuration.

For `devpolaris-orders-api`, the working rule is simple: image changes are made in Git and rebuilt; container settings are supplied at run time; durable business data lives outside the container. Keeping those three ideas separate prevents many first container mistakes.

## How Registries Fit the Model

A registry stores images so other machines can pull them. Docker Hub, GitHub Container Registry, Amazon ECR, Azure Container Registry, and Google Artifact Registry all fill this role. The registry is not where containers run. It is where image artifacts wait until a runtime pulls them.

The workflow for `devpolaris-orders-api` might look like this:

```text
CI runner:
  build image from Dockerfile
  tag image as ghcr.io/devpolaris/orders-api:1.4.0
  push image to registry

Staging host:
  pull ghcr.io/devpolaris/orders-api:1.4.0
  create container with staging env vars
  run smoke test

Production host:
  pull the approved image digest
  create container with production env vars
  receive real traffic after health check
```

This is why image identity matters. If staging tested one digest and production pulled another digest behind the same tag, the registry did not break the release. The team used a weak reference for a strong promise. Tags are useful names, but release evidence should preserve the digest.

You can also use a registry to separate build permissions from run permissions. CI may be allowed to push images. Production hosts may only be allowed to pull approved images. That split reduces the chance that a compromised runtime host can overwrite the artifact other environments trust.

## Reviewing Image Changes

Image reviews should focus on the runtime contract, not only the Dockerfile syntax. A reviewer asks whether the image contains the expected files, whether dependency installation is repeatable, whether secrets are kept out, whether the default command starts the right process, and whether the image is small enough to operate comfortably.

Here is a compact review record:

```text
Image review for ghcr.io/devpolaris/orders-api:1.4.0

Base image:        node:22-bookworm-slim
Install command:   npm ci --omit=dev
Default command:   node server.js
Working directory: /app
Exposed port:      3000/tcp
Runtime secrets:   none baked into image
Health evidence:   GET /health returned 200 in CI
Digest:            sha256:7c8d9b6a2f2a...
```

That style of review keeps the image and container distinction visible. The image review does not need the production database URL. It needs proof that the image starts correctly when a runtime supplies a database URL.

A useful failure check is to scan for values that look like secrets in the image history. The exact tooling varies by team, but the habit is stable: assume old layers are still recoverable by anyone who can pull the image. If a secret appears in a build step, rotate the secret and rebuild from clean history instead of only deleting the line from the latest Dockerfile.

For first projects, do not chase perfect image hardening before you understand the artifact model. Start with a clear Dockerfile, no secrets in the image, repeatable dependency install, a stable tag and digest, and a smoke test that proves the container can start from the image.

You can practice the review by comparing two release candidates:

```text
Candidate A:
  tag:      ghcr.io/devpolaris/orders-api:latest
  digest:   not recorded
  command:  npm start
  health:   not run in CI

Candidate B:
  tag:      ghcr.io/devpolaris/orders-api:1.4.0
  digest:   sha256:7c8d9b6a2f2a...
  command:  node server.js
  health:   GET /health returned 200
```

Candidate B gives a reviewer more evidence. The tag is meaningful, the digest pins the bytes, the command is explicit, and the health check proves the runtime can create a working container. Candidate A may still run, but the team has less proof about what was tested and what will be deployed.

The same thinking helps during rollback. If release `1.4.1` fails because it cannot connect to Postgres, a previous digest lets the team redeploy the last known good image. If the team only has `latest`, rollback becomes a search through registry history and CI logs.

```text
Rollback note:
  Bad image:       ghcr.io/devpolaris/orders-api@sha256:b91e...
  Last good image: ghcr.io/devpolaris/orders-api@sha256:7c8d...
  Symptom:         GET /orders returned 500 after startup
  Evidence:        /health stayed 200, database query failed in logs
```

That note keeps image identity separate from application diagnosis. The image tells you what artifact ran. The logs tell you how that artifact behaved.

One last check is worth adding to your mental model: deleting a container does not delete the image, and deleting an image does not stop an already running container in the simple way beginners often expect. The runtime has already created the container from image content. Cleanup commands should therefore be precise.

```bash
$ docker rm orders-api
orders-api

$ docker image rm ghcr.io/devpolaris/orders-api:1.4.0
Untagged: ghcr.io/devpolaris/orders-api:1.4.0
```

Use container cleanup when you want to remove a runtime instance. Use image cleanup when you want to remove local cached artifacts. Mixing those commands is a common sign that the image and container model still needs practice.

---

**References**

- [Docker Docs: What is an image?](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-an-image/) - Explains images as standardized packages containing files, binaries, libraries, and configuration.
- [Docker Docs: Docker overview](https://docs.docker.com/engine/docker-overview/) - States the core Docker model, including that a container is a runnable instance of an image.
- [Docker CLI Reference: docker container](https://docs.docker.com/reference/cli/docker/container/) - Documents container commands such as run, inspect, logs, rm, and wait.
- [Open Container Initiative Image Specification](https://github.com/opencontainers/image-spec) - Defines the open image format used across compatible container tools.
