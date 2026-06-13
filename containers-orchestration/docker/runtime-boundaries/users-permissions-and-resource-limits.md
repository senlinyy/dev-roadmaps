---
title: "Users and Limits"
description: "Understand how containers share the host kernel while using users, permissions, capabilities, memory limits, and CPU limits to narrow runtime behavior."
overview: "Docker isolation narrows a process through host-kernel controls. This article follows container users, bind-mount ownership, Linux capabilities, memory limits, and CPU limits as practical runtime choices."
tags: ["docker", "permissions", "resources", "security"]
order: 3
id: article-containers-orchestration-docker-users-permissions-and-resource-limits
---

## Table of Contents

1. [The Runtime Controls](#the-runtime-controls)
2. [Users, UIDs, and GIDs](#users-uids-and-gids)
3. [Build an Image That Runs as Non-Root](#build-an-image-that-runs-as-non-root)
4. [Bind Mount Permissions](#bind-mount-permissions)
5. [Linux Capabilities](#linux-capabilities)
6. [Privileged Containers](#privileged-containers)
7. [Memory Limits](#memory-limits)
8. [CPU Limits](#cpu-limits)
9. [Inspecting Runtime State](#inspecting-runtime-state)
10. [Putting It All Together](#putting-it-all-together)

## The Runtime Controls
<!-- section-summary: A container is a host process shaped by users, permissions, capabilities, and cgroup resource controls. -->

The catalog stack now has clear network paths and clear storage lifetimes. The browser reaches the API, the API reaches Postgres, and database files live in a named volume. Then the next set of problems appears during normal development work.

The test container writes reports into the host repository, and the editor fails to replace them. A worker process imports a huge CSV and gets killed halfway through. A network-debug container tries to change an interface setting and gets `Operation not permitted`. Each problem comes from a runtime control such as process identity, kernel privilege, or cgroup capacity.

Docker runs container processes through the host kernel. The kernel still enforces **user IDs**, **group IDs**, **file modes**, **Linux capabilities**, and **cgroups**. Docker combines those controls so the process gets a narrowed view of the host and a set of runtime limits.

The article follows the same catalog application through five questions. **Which user runs the process?** **Which user writes mounted files?** **Which privileged operations can the process attempt?** **How much memory can it use?** **How much CPU time can it consume?** Those questions connect the permission and resource parts of the runtime boundary.

## Users, UIDs, and GIDs
<!-- section-summary: Container file access follows numeric Linux user and group IDs, even when names differ between host and container. -->

A **container user** is the Linux user that runs the main process inside the container. Linux represents that user with a numeric **UID**, and it represents the primary group with a numeric **GID**. Usernames such as `node`, `postgres`, or `app` make output readable, while the numeric IDs drive permission checks.

Docker's `docker container run` documentation states that the default user inside a container is root, UID `0`, unless the image sets a different default with the Dockerfile `USER` instruction or the runtime command overrides it with `--user`. That default explains many beginner surprises. A process may feel "inside Docker" while still writing files as UID `0` through a bind mount.

The catalog API can show its runtime identity with `id`:

```bash
docker compose exec api id
```

Example output might look like this:

```bash
uid=10001(app) gid=10001(app) groups=10001(app)
```

The process runs as UID `10001` and GID `10001`. If it writes inside the image filesystem to a path owned by that UID, the write succeeds. If it writes to a bind-mounted host path, the host filesystem checks the same numeric writer against the host file ownership and mode bits.

This is where the storage article connects to runtime identity. A named volume gives data a separate lifetime. A bind mount gives the container a real host path. The user running the process decides how writes across that mount appear on the host.

## Build an Image That Runs as Non-Root
<!-- section-summary: A good application image creates a runtime user, makes app paths writable, and sets USER before the main command. -->

Running application processes as **non-root** is a practical baseline. It reduces the set of files the process can modify inside the container and makes accidental privileged behavior less likely. The image should prepare its directories so the runtime user can work without switching back to UID `0`.

For the catalog API, an Alpine-based Node image might create an `app` user and assign ownership of `/app` before setting `USER`:

```dockerfile
FROM node:22-alpine

RUN addgroup -S app && adduser -S -G app app

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

RUN chown -R app:app /app
USER app

CMD ["node", "dist/server.js"]
```

The important sequence is the part near the end. The image creates or copies the application files, changes ownership to the runtime user, then sets `USER app` before the command starts. The main process now runs as the `app` user by default.

Some teams prefer numeric IDs in images, especially when they want consistent behavior across base images:

```dockerfile
RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app
USER 10001:10001
```

Numeric IDs make the runtime identity explicit. The tradeoff is readability, because logs and shells may show numbers instead of friendly names unless `/etc/passwd` contains a matching entry. Either way, the key point is that the image chooses a deliberate runtime user.

The image user handles the normal container filesystem. Bind mounts add the host filesystem to the story, and that is where local development often needs one more runtime choice.

## Bind Mount Permissions
<!-- section-summary: A bind mount exposes host ownership rules, so development commands often need a deliberate --user value. -->

**Bind mount permissions** come from the host path and the container process identity. If the catalog test command writes reports into `./reports`, Linux records the numeric UID and GID of the writer. On a Linux host, files written as UID `0` usually appear as root-owned files.

A local test command can line up the writer with the host developer:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,src="$(pwd)/reports",dst=/reports \
  catalog-api:test \
  npm test -- --reporter json --output /reports/results.json
```

The container process runs with the host user's numeric UID and GID for this command. The report file arrives on the host with ownership the editor can usually modify. This works well for one-off tools, code generators, and test containers that write into the repository.

Compose can express the same idea for a development service:

```yaml
services:
  api:
    build: ./api
    user: "${UID:-1000}:${GID:-1000}"
    volumes:
      - ./api:/app
      - ./reports:/reports
```

The environment variables come from the developer's shell or a local `.env` file. The values should be documented in team setup instructions because macOS, Linux, WSL, and remote Docker daemons can expose slightly different host-file behavior.

There is another useful approach: keep source bind mounts read-only and write generated output to a named volume or a dedicated output directory. That reduces accidental host edits. It also makes cleanup clearer because one path exists for generated artifacts instead of letting tools write across the whole repository.

Once file writes are under control, the next question is privilege. A process can run as root or non-root and still have a separate list of kernel-level operations it may attempt.

## Linux Capabilities
<!-- section-summary: Linux capabilities split privileged operations into smaller permissions that Docker can add or drop. -->

**Linux capabilities** are small privilege flags for kernel-level operations. Classic Unix treated UID `0` as the broad privileged identity. Modern Linux splits many privileged actions into capability bits such as `NET_ADMIN`, `SYS_ADMIN`, `CHOWN`, and `NET_BIND_SERVICE`.

Docker starts containers with a default capability set and drops many dangerous capabilities. That is why a process can run as root inside the container and still fail to mount a filesystem or change network settings. Root identity and capability permission are related, but they answer different questions.

For the catalog API, the normal web process should need no extra capabilities. It reads config, opens a network listener, talks to Postgres, and writes logs. A separate network-debug container might need a capability such as `NET_ADMIN` for a short troubleshooting session.

```bash
docker run --rm \
  --cap-add NET_ADMIN \
  nicolaka/netshoot \
  ip route
```

Compose can express capability changes too:

```yaml
services:
  network-debug:
    image: nicolaka/netshoot
    cap_add:
      - NET_ADMIN
```

The safer pattern is to start from the smallest set of capabilities. For workloads that can run with very little privilege, Docker can drop all capabilities and then add back one specific capability when the workload truly needs it.

```bash
docker run --rm \
  --cap-drop ALL \
  --cap-add NET_BIND_SERVICE \
  catalog-api:prod
```

That example focuses on narrowing privileged operations instead of fixing application bugs. If a container asks for `SYS_ADMIN` or a broad capability list, the team should pause and name the exact operation that requires it. The next section covers the broad shortcut that often hides that conversation.

## Privileged Containers
<!-- section-summary: The privileged flag grants broad host-level access, so application containers should reach for narrower capabilities first. -->

`--privileged` is Docker's broad runtime privilege switch. Docker's CLI reference explains that privileged containers receive all Linux kernel capabilities, lose several default security profiles, gain access to host devices, and can do much more against the host system. That flag exists for special cases such as Docker-in-Docker or low-level system tooling.

For an application container like the catalog API, privileged mode is usually a sign that the real requirement still needs a clear name. The service may need one device, one capability, a read-only config mount, or a different file permission. `--privileged` grants a large bundle when the workload often needs one small piece.

A better troubleshooting conversation sounds like this: "The packet capture tool needs raw socket access for ten minutes in development, so we will run a separate debug container with the specific capability and no application secrets." That keeps the privilege decision attached to a concrete job.

Compose has a `privileged` service key, and it should receive the same caution:

```yaml
services:
  system-tool:
    image: internal/system-tool:debug
    privileged: true
```

That YAML should be rare, reviewed, and separated from normal application services. The runtime boundary gets weaker as privilege grows, so broad privilege deserves a clear reason, a short lifetime, and a narrow environment.

Permissions and privileges control what the process may do. Resource limits control how much host capacity the process may consume.

## Memory Limits
<!-- section-summary: Memory limits use cgroups to cap container memory and make runaway processes fail inside a defined boundary. -->

A **memory limit** is a cgroup setting that caps how much memory the container's process tree can allocate. Docker's resource constraints documentation states that containers have no resource constraints by default and can use as much of a resource as the host kernel scheduler allows. A limit turns that open-ended behavior into a defined ceiling.

The catalog team notices the CSV import worker sometimes grows until the laptop becomes unusable. A memory limit keeps that worker inside a predictable range:

```bash
docker run --rm \
  --memory 512m \
  --memory-swap 512m \
  catalog-worker:dev \
  node import-catalog.js data/huge.csv
```

`--memory 512m` sets the memory ceiling. Setting `--memory-swap` to the same value keeps swap from extending the total memory available to the container on hosts where swap is configured. If the process grows beyond the limit, the kernel can kill it, and Docker records that the container exited after an out-of-memory event.

Compose can make the local expectation repeatable:

```yaml
services:
  worker:
    build: ./worker
    mem_limit: 512m
```

Memory limits help in two ways. They protect the host and neighboring containers from a runaway process. They also expose sizing problems early, because the worker fails in development or CI instead of silently using every available byte on a large laptop.

The limit should match the workload's expected shape. A database, a compiler, and a small HTTP API have different memory needs. If a service hits the limit during ordinary traffic, the right response is to investigate the workload, tune the application, or size the container differently.

CPU uses the same cgroup family, but it affects scheduling time rather than stored bytes.

## CPU Limits
<!-- section-summary: CPU limits control scheduler time, so busy containers stay inside defined host CPU limits under load. -->

A **CPU limit** controls how much CPU time the container can receive from the host scheduler. The most readable Docker flag is `--cpus`, which accepts fractional CPU values. `--cpus "1.5"` means the container can use roughly one and a half CPUs worth of time under contention.

The catalog import worker can get a CPU ceiling during local testing:

```bash
docker run --rm \
  --cpus "1.5" \
  catalog-worker:dev \
  node import-catalog.js data/huge.csv
```

This limit leaves the code path the same. It changes how much scheduler time the process receives when the host has CPU pressure. A worker may run longer, timeouts may appear, and concurrency bugs may become easier to reproduce because the workload now runs under a defined resource shape.

Compose can carry the same expectation:

```yaml
services:
  worker:
    build: ./worker
    cpus: "1.5"
    mem_limit: 512m
```

CPU limits are useful when a local stack has several busy services. The API, worker, database, and search service can all run on one laptop without letting one import job consume the whole machine. In shared environments, CPU settings also make capacity conversations more concrete.

CPU shares, quotas, periods, and CPU sets give deeper control for specialized cases. Beginners usually get the most value from `--cpus`, because it reads like the capacity decision the team meant to make. A small API might get `0.5`, a worker might get `1.5`, and a database might get a separate setting after measurement.

With users, capabilities, memory, and CPU in place, the last practical skill is inspection. The runtime boundary should be visible from Docker commands rather than guessed from symptoms.

## Inspecting Runtime State
<!-- section-summary: Runtime inspection checks the actual user, capabilities, memory state, CPU settings, and mount ownership from the container's viewpoint. -->

The runtime checks start with identity. `id` shows the UID and GID inside the container. `whoami` can be useful, but the numbers matter most because file ownership and bind mounts use numeric IDs.

```bash
docker compose exec api id
docker compose exec api sh -lc 'touch /reports/probe && ls -ln /reports/probe'
```

The `ls -ln` output shows numeric ownership for the probe file. If the host developer fails to edit generated files, this check usually reveals which UID and GID wrote them. The team can then adjust `USER`, `--user`, directory ownership, or the mount strategy.

Container configuration lives in `docker inspect`. The `HostConfig` section shows runtime choices such as user overrides, memory limits, CPU quota settings, privileged mode, and capability additions or drops.

```bash
docker inspect catalog-api --format '{{json .HostConfig}}'
```

Live resource usage comes from `docker stats`:

```bash
docker stats catalog-api catalog-worker catalog-db
```

An out-of-memory event also appears in container state:

```bash
docker inspect catalog-worker --format 'OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}}'
```

For Compose, the final rendered configuration can prevent a lot of confusion:

```bash
docker compose config
```

That output shows the final `user`, `cap_add`, `cap_drop`, `privileged`, `cpus`, and `mem_limit` values after Compose applies environment variables and override files. It is especially helpful when one developer has a local override that changes runtime behavior.

These checks connect symptoms to runtime controls. A permission error points to UID, GID, mount mode, or file ownership. An operation error points to capabilities or security settings. A sudden container exit under load points to memory limits, CPU pressure, or application failure evidence.

## Putting It All Together
<!-- section-summary: Users, permissions, capabilities, and limits make the container runtime boundary explicit enough to operate safely. -->

The catalog stack now has a complete runtime-boundary story. Networking defines how requests move between host ports, Docker DNS, container ports, and listeners. Storage defines which paths come from image layers, writable layers, named volumes, and bind mounts. Users and limits define who the process runs as, which privileged operations it may attempt, and how much host capacity it can consume.

The practical choices line up like this:

| Control | Plain English meaning | Catalog example |
| --- | --- | --- |
| **UID/GID** | Numeric identity used for file permissions | API runs as `10001:10001` |
| **Dockerfile USER** | Default user for image commands and runtime | `USER app` before `CMD` |
| **Runtime --user** | Per-run identity override | Test reports written as `$(id -u):$(id -g)` |
| **Bind mount permissions** | Host path checks the writer's numeric identity | `./reports:/reports` uses host ownership rules |
| **Capabilities** | Small kernel privilege flags | Debug container gets `NET_ADMIN` |
| **Privileged mode** | Broad privilege bundle for special tooling | Kept away from normal API containers |
| **Memory limit** | Cgroup memory ceiling | Worker gets `mem_limit: 512m` |
| **CPU limit** | Cgroup scheduler ceiling | Worker gets `cpus: "1.5"` |

The senior habit is to make each runtime choice boring and visible. The image should name its runtime user. Development commands should line up bind-mount writers with host ownership. Extra capabilities should match a specific operation. Memory and CPU limits should describe the capacity the service expects.

Those explicit choices turn Docker into a set of boundaries you can inspect, explain, and adjust without guessing.

---

**References**

- [Docker Docs: Running containers](https://docs.docker.com/engine/containers/run/) - Official guide covering container runtime options, including the default user, `USER`, and `--user`.
- [Docker Docs: Dockerfile reference - USER](https://docs.docker.com/reference/dockerfile/#user) - Defines the Dockerfile `USER` instruction, UID/GID syntax, and how it affects later build and runtime commands.
- [Docker Docs: docker container run](https://docs.docker.com/reference/cli/docker/container/run/) - CLI reference for `--user`, `--cap-add`, `--cap-drop`, `--privileged`, memory flags, CPU flags, and other runtime options.
- [Docker Docs: Resource constraints](https://docs.docker.com/engine/containers/resource_constraints/) - Official details on memory constraints, swap behavior, OOM behavior, CPU constraints, and scheduler controls.
- [Docker Docs: Define services in Docker Compose](https://docs.docker.com/reference/compose-file/services/) - Compose service reference for `user`, `cap_add`, `cap_drop`, `privileged`, `cpus`, `mem_limit`, and related runtime attributes.
- [Docker Docs: Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) - Documents bind mount host coupling, default write access, read-only mounts, and Docker Desktop filesystem behavior.
- [Docker Docs: Isolate containers with a user namespace](https://docs.docker.com/engine/security/userns-remap/) - Official guide to user namespace remapping and host UID/GID isolation considerations.
