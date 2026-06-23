---
title: "Users and Limits"
description: "Understand how containers share the host kernel while using users, permissions, capabilities, memory limits, and CPU limits to narrow runtime behavior."
overview: "Docker isolation narrows a process through host-kernel controls. This article follows container users, bind-mount ownership, Linux capabilities, memory limits, and CPU limits as practical runtime choices."
tags: ["docker", "permissions", "resources", "security"]
order: 3
id: article-containers-orchestration-docker-users-permissions-and-resource-limits
---

## Table of Contents

1. [The Last Runtime Boundary](#the-last-runtime-boundary)
2. [Containers Are Host Processes](#containers-are-host-processes)
3. [Users, UIDs, and GIDs](#users-uids-and-gids)
4. [Build an Image That Runs as Non-Root](#build-an-image-that-runs-as-non-root)
5. [Runtime User Overrides for Local Files](#runtime-user-overrides-for-local-files)
6. [Capabilities and Security Profiles](#capabilities-and-security-profiles)
7. [Privileged Containers and Debug Exceptions](#privileged-containers-and-debug-exceptions)
8. [User Namespaces and Rootless Docker](#user-namespaces-and-rootless-docker)
9. [Memory Limits](#memory-limits)
10. [CPU Limits](#cpu-limits)
11. [Inspecting Runtime State](#inspecting-runtime-state)
12. [Common Failure Patterns](#common-failure-patterns)
13. [Putting It All Together](#putting-it-all-together)

## The Last Runtime Boundary
<!-- section-summary: Runtime user, privilege, and resource controls decide what the container process can do after networking and storage are already wired. -->

The catalog stack now has two working stories behind it. Networking explains how the browser reaches `web`, how `web` reaches `api`, and how `api` reaches Postgres at `db:5432`. Storage explains why Postgres uses a named volume, why source code uses a bind mount, and why generated reports need a clear writer.

The next problems sound different. A test container writes root-owned files into `./reports`, and the editor cannot clean them. A CSV import worker grows until the laptop slows down. A temporary network-debug container tries to adjust routing and receives `Operation not permitted`. These failures come from **runtime controls**: the process user, file permissions, Linux capabilities, security profiles, and resource limits.

Docker runs containers through the host operating system kernel. That means the kernel still enforces **UIDs**, **GIDs**, file modes, capabilities, cgroups, namespaces, and security profiles. Docker packages those controls into flags, Dockerfile instructions, and Compose fields so teams can describe how much access and capacity a container should receive.

We will stay with the same catalog application. The API serves requests, the worker imports a large supplier CSV, the database keeps catalog rows, and the test runner writes reports back into the host repository. Each section answers one production-style question: who runs the process, who writes the files, which privileged operations are allowed, and how much memory and CPU the process can consume.

## Containers Are Host Processes
<!-- section-summary: A container process uses Linux kernel controls, so Docker isolation depends on the host enforcing namespaces, permissions, and limits. -->

A **container process** is a normal process on the Docker host with extra isolation around it. Docker gives that process its own view of parts of the system, such as the filesystem, process list, network stack, and hostname. The process still reaches the host kernel for file access, networking, memory allocation, CPU scheduling, and privileged operations.

That detail explains why Docker runtime settings matter. The API process may see `/app` as its application directory, and it may see `api` and `db` on a private Docker network. The host kernel still decides whether the process can write a bind-mounted file, open a low-level network operation, allocate another 500 MB of memory, or use more CPU time. Here is the catalog API running with several runtime choices in one command:

```bash
docker run --rm \
  --name catalog-api \
  --user 10001:10001 \
  --cap-drop ALL \
  --memory 512m \
  --cpus "1.0" \
  --mount type=bind,src="$(pwd)/reports",dst=/reports \
  catalog-api:prod
```

This command gives the process a numeric user, removes Linux capabilities from the default set, gives it a memory ceiling, gives it a CPU ceiling, and mounts a host report directory. Those choices describe the runtime boundary more clearly than the image tag alone. The image says what code runs, and the runtime settings say how that code may behave on this host. The first runtime setting to understand is the user, because file ownership issues show up quickly in local Docker work.

![Container runtime controls infographic showing catalog-api process wrapped by UID and GID, capabilities, seccomp, memory cgroup, CPU cgroup, user namespace, and host kernel controls](/content-assets/articles/article-containers-orchestration-docker-users-permissions-and-resource-limits/container-runtime-controls.png)

_This infographic shows the container as a host process wrapped by kernel controls, so user identity, capabilities, security profiles, namespaces, memory, and CPU all stay visible._

## Users, UIDs, and GIDs
<!-- section-summary: Linux checks numeric user and group IDs, so container names and host names matter less than the UID and GID. -->

A **user** is the identity the process runs as. Linux stores that identity as a numeric **UID**, and it stores the primary group as a numeric **GID**. Usernames such as `node`, `postgres`, and `app` make shells and logs readable, but the numeric IDs drive permission checks.

Docker's container run reference states that the default user inside a container is root, UID `0`, unless the image sets a different user with the Dockerfile `USER` instruction or the runtime command supplies `--user`. Beginners often miss that because the process looks separated from the host by Docker, while the file write still carries a UID and bind mounts expose that UID to the host filesystem.

The catalog team can check the API process identity from inside the running service. The `id` command gives the numeric values that matter for file permissions.

```bash
docker compose exec api id
```

Example output might look like this. The name in parentheses helps humans, while the numbers are the part Linux checks.

```bash
uid=10001(app) gid=10001(app) groups=10001(app)
```

That output says the API process runs as UID `10001` and GID `10001`. If the process writes to a directory owned by `10001:10001` inside the image, the write should succeed. If it writes through a bind mount into the host repository, the host sees a write from numeric user `10001`, even if the host has no username called `app`.

This connects directly to the storage article. A named volume usually belongs to the service process that owns the data. A bind mount belongs to the host path first, and the container process must line up with that host path's permissions. The article now turns that into a Dockerfile pattern.

## Build an Image That Runs as Non-Root
<!-- section-summary: A production application image should create a runtime user, prepare writable paths, and set USER before the main command. -->

Running application code as **non-root** is a normal baseline for container images. It reduces accidental writes to root-owned paths inside the container and keeps the process away from broad root behavior unless the application has a real reason for it. Non-root execution also makes Kubernetes, CI runners, and security scanners much happier with the image later.

For the catalog API, the Dockerfile can create a dedicated application user, copy the app, prepare writable paths, and set `USER` before `CMD`. The important detail is that ownership is prepared while the build can still make those filesystem changes.

```dockerfile
FROM node:22-alpine

RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

RUN mkdir -p /app/tmp /app/logs \
  && chown -R app:app /app

USER 10001:10001
CMD ["node", "dist/server.js"]
```

The image creates UID `10001` and GID `10001`, gives `/app` and the writable runtime directories to that user, and then starts the main process as that user. The runtime process can write to `/app/tmp` and `/app/logs` because the Dockerfile prepared those paths before switching users.

Numeric IDs help teams keep behavior steady across base images. A name such as `app` is useful for humans, while `10001:10001` makes the file-permission contract explicit. The numeric choice should be documented in the image or team convention so related services, mounted directories, and CI jobs know which identity the image expects.

Some applications need package installs or build steps as root during image build. That can still be fine. The important line is where the runtime user changes before the main command. Build-time root and runtime root create different risk profiles, so the Dockerfile should make the runtime choice visible near the end.

The image-level user handles the normal service. Local development and test commands sometimes need a per-run override so host-visible files come back with host-friendly ownership.

## Runtime User Overrides for Local Files
<!-- section-summary: The --user flag lets one-off containers write bind-mounted files with the host developer's numeric identity. -->

A **runtime user override** changes the user for one container run without rebuilding the image. Docker exposes that with `--user`, and Compose exposes it with the `user` field. This is useful when a container writes into a bind-mounted host directory during local development.

The catalog test runner writes JSON reports into `./reports`. That directory belongs to the host repository, so the writer matters as much as the output path.

```bash
mkdir -p reports

docker run --rm \
  --mount type=bind,src="$(pwd)/reports",dst=/reports \
  catalog-api:test \
  npm test -- --reporter json --output /reports/results.json
```

If the image or command runs as root, the host may see `./reports/results.json` as root-owned on a Linux host. The test passed, but the developer may need elevated permissions to delete or replace the report. That makes a normal test command feel broken.

For one-off tools that write into the repository, the command can borrow the host developer's numeric UID and GID. The container still runs the same test image, while the file write uses the host-friendly numeric identity.

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,src="$(pwd)/reports",dst=/reports \
  catalog-api:test \
  npm test -- --reporter json --output /reports/results.json
```

Now the report file arrives with the host developer's numeric ownership. This pattern works well for formatters, code generators, test reporters, local docs builds, and export jobs. It should stay attached to host-owned outputs, and application images should still define a proper runtime user for normal service work. Compose can carry the same local setting:

```yaml
services:
  api:
    build: ./api
    user: "${UID:-1000}:${GID:-1000}"
    volumes:
      - type: bind
        source: ./api/src
        target: /app/src
      - type: bind
        source: ./reports
        target: /reports
```

Many teams put `UID` and `GID` in a local `.env` file or export them from the shell before starting Compose. Docker Desktop, WSL, Linux hosts, and remote Docker daemons can show slightly different host-file behavior, so the team should test the report-writing workflow on the environments developers actually use. User identity controls file access. The next runtime control covers privileged kernel operations that file permissions cannot express on their own.

![UID writes through mounts infographic comparing a root writer creating a root-owned report through a bind mount and a host user writer creating an editable report with a user override](/content-assets/articles/article-containers-orchestration-docker-users-permissions-and-resource-limits/uid-mount-writes.png)

_This infographic makes the bind-mount ownership issue concrete: the same `./reports` mount can produce root-owned output or host-editable output depending on the numeric writer._

## Capabilities and Security Profiles
<!-- section-summary: Capabilities and security profiles narrow privileged operations beyond the process UID. -->

**Linux capabilities** split privileged operations into smaller flags. Classic Unix treated UID `0` as the broad privileged identity. Modern Linux uses capability bits such as `NET_ADMIN`, `CHOWN`, `SYS_ADMIN`, and `NET_BIND_SERVICE` to control categories of privileged operations.

Docker starts containers with a default capability set and drops many powerful operations. That is why a process can run as root inside a container and still fail to mount a filesystem, change routing tables, or perform other low-level actions. UID and capabilities answer related questions, and both affect the runtime boundary.

The catalog API should need no extra capabilities for normal work. It reads config, listens on a port above `1024`, talks to Postgres, and writes application files. A temporary network-debug container has a different job and might need a specific capability for that session:

```bash
docker run --rm \
  --network catalog_default \
  --cap-add NET_ADMIN \
  nicolaka/netshoot \
  ip route
```

Compose can express the same narrow debug choice. The debug service carries the capability, and the normal API service can keep its smaller runtime boundary.

```yaml
services:
  network-debug:
    image: nicolaka/netshoot
    network_mode: service:api
    cap_add:
      - NET_ADMIN
```

For application services, many teams move in the opposite direction and drop capabilities. This makes the expected privilege set explicit in the Compose file.

```yaml
services:
  api:
    build: ./api
    user: "10001:10001"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
```

`cap_drop: [ALL]` removes Linux capabilities from the service. `no-new-privileges:true` asks the kernel to keep the process from gaining extra privileges through exec paths such as setuid binaries. Docker also uses a default seccomp profile on Linux to block or restrict selected system calls, and custom seccomp profiles can tighten or change that behavior for specialized workloads.

The practical review question stays concrete. The team should name the operation that needs a capability or security-profile exception. "The API needs to serve HTTP traffic" rarely explains `SYS_ADMIN`. "The debug helper needs to inspect network routes in a development session" gives the exception a job, a tool, and a short lifetime. The broad shortcut for privilege has its own section because it changes many controls at once.

## Privileged Containers and Debug Exceptions
<!-- section-summary: Privileged mode grants a broad host-facing bundle, so application services should keep exceptions narrow and temporary. -->

`--privileged` is Docker's broad privilege switch. Docker's CLI reference explains that privileged containers receive all Linux capabilities, receive expanded access to host devices, and bypass several normal isolation settings. That flag exists for special system-level cases, and it is a large runtime change.

For the catalog API, privileged mode should raise a review conversation. The service may need one bind mount, one device, one capability, or a separate helper container. A broad privileged flag grants many powers at once, and the team loses the ability to explain the exact permission the app needs. Here is the shape that should make reviewers slow down:

```yaml
services:
  api:
    build: ./api
    privileged: true
```

That setting mixes normal application traffic, application secrets, database credentials, mounted source code, and broad host-level privileges. A cleaner troubleshooting path separates the concern by leaving the API ordinary and putting debug privilege on a short-lived helper.

```yaml
services:
  api:
    build: ./api
    user: "10001:10001"

  packet-debug:
    image: nicolaka/netshoot
    network_mode: service:api
    cap_add:
      - NET_RAW
      - NET_ADMIN
    profiles:
      - debug
```

The debug service exists only when someone starts the `debug` profile. It shares the network view needed for investigation and carries the specific capabilities for packet or route work. The API keeps its normal runtime boundary, and the exception stays visible in the Compose file.

Capabilities and privileged mode affect one container's access. Docker also has host-level options that change how container UIDs map to host UIDs and how the Docker daemon itself runs.

## User Namespaces and Rootless Docker
<!-- section-summary: User namespace remapping and rootless Docker reduce how container root maps onto the host. -->

A **user namespace** lets Linux map user IDs inside a namespace to different user IDs outside it. Docker's user namespace remapping feature uses this idea so UID `0` inside a container maps to an unprivileged UID range on the host. The container may think a process is root inside its own view, while the host sees a less privileged host UID.

This matters for teams that run untrusted workloads, shared development hosts, CI runners, or multi-user lab machines. If a process breaks out of a weak container boundary or writes through certain host-facing paths, user namespace remapping can reduce the host-level power attached to container root.

There is a tradeoff. User namespace remapping changes UID and GID behavior for bind mounts, volume ownership, and some low-level workflows. A team should test existing Compose files and host mounts before turning it on for a shared Docker host. The feature helps most when the team owns the host configuration and can document the mapping.

**Rootless Docker** goes one level wider. In rootless mode, the Docker daemon and containers run inside a user namespace under an unprivileged user instead of a root-owned daemon. This can reduce the host impact of daemon or container issues, especially on developer machines or shared build hosts.

Rootless mode also has operational differences. Some networking, storage, port, and cgroup behaviors can vary by host configuration. Docker's rootless documentation covers the setup details and limitations, so teams should treat rootless mode as a host design choice, not a random per-container flag.

For the catalog stack, the everyday article takeaway is smaller. Build app images to run as non-root. Use `--user` for host-owned outputs. Add capabilities only for named operations. Consider user namespace remapping or rootless Docker when the Docker host itself needs a stronger isolation stance.

Now we move from access to capacity. The same host kernel that checks permissions also decides how much memory and CPU the process can use.

## Memory Limits
<!-- section-summary: Memory limits set a cgroup ceiling so a runaway container fails inside a known capacity boundary. -->

A **memory limit** is a cgroup setting that caps how much memory the container process tree can allocate. Docker's resource constraints documentation explains that containers can use host resources freely by default, subject to what the kernel scheduler and host capacity allow. A memory limit gives the service a ceiling.

The catalog worker imports a large supplier CSV. During one test, it loads too much data into memory and makes the laptop nearly unusable. The team can run that worker with a 512 MB ceiling, which gives the failure a clear container boundary instead of letting it consume the whole host:

```bash
docker run --rm \
  --memory 512m \
  --memory-swap 512m \
  catalog-worker:dev \
  node import-catalog.js data/supplier-feed.csv
```

`--memory 512m` sets the memory limit. `--memory-swap 512m` sets the combined memory and swap allowance to the same value on hosts where swap accounting applies, so swap cannot silently extend the total available memory for this container. If the worker grows past the limit, the kernel may kill it, and Docker records the out-of-memory state.

Compose can keep the local expectation repeatable. The limit then travels with the service definition rather than living only in one person's shell history.

```yaml
services:
  worker:
    build: ./worker
    command: node import-catalog.js data/supplier-feed.csv
    mem_limit: 512m
```

The limit protects the host and neighboring services. It also gives developers earlier evidence that the worker needs streaming, batching, backpressure, or a larger runtime size. The fix should come from the workload and capacity decision, not from quietly removing every limit after the first failure. Memory is about stored bytes. CPU limits shape scheduler time.

## CPU Limits
<!-- section-summary: CPU limits control host scheduler time so one busy container cannot consume all available CPU during load. -->

A **CPU limit** controls how much CPU time a container can receive from the host scheduler. Docker's `--cpus` flag is the readable starting point because it accepts values such as `0.5`, `1.0`, or `1.5`. A value of `"1.5"` gives the container roughly one and a half CPUs worth of time under CPU contention.

The catalog import worker can run with a CPU ceiling during local testing. The command keeps the workload realistic while making host scheduling pressure visible.

```bash
docker run --rm \
  --cpus "1.5" \
  catalog-worker:dev \
  node import-catalog.js data/supplier-feed.csv
```

The code path stays the same, while the scheduler budget changes. Under load, the worker may take longer, timeouts may show up, and noisy-neighbor behavior shows up during testing. That is useful because the local stack often includes the API, worker, database, and maybe a search service on one laptop. Compose can carry the same resource shape:

```yaml
services:
  worker:
    build: ./worker
    cpus: "1.5"
    mem_limit: 512m
```

Docker also exposes deeper controls such as CPU shares, quotas, periods, and CPU sets. Beginners usually get the most value from `--cpus` and `mem_limit` because those settings read like capacity decisions. After the team has metrics, the deeper knobs can support more specialized scheduling requirements.

At this point, the catalog team has user, privilege, memory, and CPU controls. The last skill is inspection, because runtime boundaries should show up in commands rather than guesses.

## Inspecting Runtime State
<!-- section-summary: Runtime inspection checks identity, mounts, capabilities, security options, memory state, and CPU settings from the actual container. -->

The first check is identity. `id` shows the UID and GID inside the container. `ls -ln` shows numeric file ownership, which is more useful than usernames when the host and container have different name databases.

```bash
docker compose exec api id
docker compose exec api sh -lc 'touch /reports/probe && ls -ln /reports/probe'
```

If the host developer cannot delete generated reports, this check usually shows the writer. The fix might be a Dockerfile `USER`, a `--user "$(id -u):$(id -g)"` override for the tool command, or a change to which path is bind-mounted.

`docker inspect` shows the runtime settings Docker applied. These commands pull out the specific fields a reviewer usually needs during a permissions or limits investigation.

```bash
docker inspect catalog-api --format '{{json .Config.User}}'
docker inspect catalog-api --format '{{json .HostConfig.CapAdd}} {{json .HostConfig.CapDrop}}'
docker inspect catalog-api --format 'Privileged={{.HostConfig.Privileged}} Memory={{.HostConfig.Memory}} NanoCpus={{.HostConfig.NanoCpus}}'
docker inspect catalog-api --format '{{json .HostConfig.SecurityOpt}}'
```

For Compose projects, the rendered configuration often gives the cleanest review view. It shows the service settings after environment variables, profiles, and override files have been applied.

```bash
docker compose config
```

That output shows the final `user`, `cap_add`, `cap_drop`, `security_opt`, `privileged`, `cpus`, and `mem_limit` values after Compose applies environment variables and override files. It helps when one developer has a local override or a profile changes the debug services. Live resource usage comes from `docker stats`:

```bash
docker stats catalog-api catalog-worker catalog-db
```

An out-of-memory kill appears in container state. This check is useful when a worker exits suddenly and the application logs stop before they can explain the failure.

```bash
docker inspect catalog-worker --format 'OOMKilled={{.State.OOMKilled}} ExitCode={{.State.ExitCode}}'
```

These checks match symptoms to controls. A host-file cleanup problem points at UID, GID, mount mode, or host ownership. An `Operation not permitted` error points at capabilities, seccomp, AppArmor, or privileged mode. A sudden worker exit under load points at memory limits, CPU pressure, or application failure evidence.

## Common Failure Patterns
<!-- section-summary: Runtime-boundary failures usually come from the wrong user, too much privilege, too little capacity, or hidden host-level assumptions. -->

The first failure is a root-running test container writing into the host repository. The test result is correct, and the host files are painful to clean. A one-off `--user "$(id -u):$(id -g)"` command or a dedicated output directory fixes the writer instead of blaming the test framework.

The second failure is an image that switches to a non-root user before making writable directories. The API starts as UID `10001`, then fails to write `/app/tmp` or `/app/logs`. The Dockerfile should create and `chown` those paths before the `USER` instruction.

The third failure is adding `--privileged` to solve a specific error. The error might need one capability, one device mount, or one debug helper. A broad privilege flag hides the exact requirement and gives the application service far more host access than the job asks for.

The fourth failure is treating rootless Docker or user namespace remapping as a per-container magic switch. These are host or daemon-level design choices with file ownership and networking effects. A team should test them against real bind mounts, Compose projects, and CI jobs before rolling them across shared hosts.

The fifth failure is setting memory too low and then removing the limit after the worker fails. The failure is useful evidence. The team should check whether the worker needs streaming, batching, a larger limit, or different input sizing.

The sixth failure is forgetting that CPU limits affect timing. A worker capped at `0.5` CPU may hit application timeouts that never appeared on an uncapped laptop. That can reveal a real production risk because shared hosts and orchestrators often run services under resource pressure.

The final failure is inspecting the image instead of the running container. The image may set `USER app`, while Compose overrides it. The image may need no capabilities, while a debug profile adds them. Runtime boundaries belong to the running container, so `docker inspect`, `docker compose config`, and checks from inside the container matter.

## Putting It All Together
<!-- section-summary: Users, permissions, capabilities, namespaces, and limits make the Docker runtime boundary visible and reviewable. -->

The catalog stack now has a complete runtime-boundary story. Networking names how requests move from host ports to Docker DNS and container listeners. Storage names which paths come from images, writable layers, volumes, bind mounts, and tmpfs mounts. Users and limits name who the process runs as, which privileged operations it can attempt, and how much host capacity it can consume. The practical choices line up like this:

| Control | Plain English meaning | Catalog example |
| --- | --- | --- |
| **UID/GID** | Numeric identity used for file permissions | API runs as `10001:10001` |
| **Dockerfile USER** | Default runtime user baked into the image | `USER 10001:10001` before `CMD` |
| **Runtime --user** | Per-run identity override | Test reports written as `$(id -u):$(id -g)` |
| **Bind mount permissions** | Host path checks the writer's numeric identity | `./reports` receives host-owned output |
| **Capabilities** | Small kernel privilege flags | Debug helper gets `NET_ADMIN` |
| **Security options** | Kernel and runtime guardrails around privilege changes and syscalls | `no-new-privileges:true` with Docker's seccomp profile |
| **Privileged mode** | Broad host-facing privilege bundle | Kept out of normal API services |
| **User namespace remapping** | Maps container UIDs to less privileged host UIDs | Shared Docker host reduces container-root impact |
| **Rootless Docker** | Runs Docker daemon and containers under an unprivileged user | Developer or build host uses rootless mode after testing limitations |
| **Memory limit** | Cgroup memory ceiling | Worker gets `mem_limit: 512m` |
| **CPU limit** | Cgroup scheduler ceiling | Worker gets `cpus: "1.5"` |

The senior habit is steady and practical. The image should name its runtime user. Host-writing tools should line up with host ownership. Extra capabilities should match a named operation. Privileged mode should stay out of normal application services. Memory and CPU limits should describe the workload's expected shape.

That finishes the Docker runtime and boundaries module. The main takeaway is visibility. A teammate should be able to read the Dockerfile, run command, or Compose file and explain how traffic moves, where files live, who writes them, and how much privilege and capacity the process receives.

![Runtime boundary checklist infographic showing non-root user, host writes matching UID, dropped capabilities, no privileged mode, memory limit, CPU limit, and inspect actual state](/content-assets/articles/article-containers-orchestration-docker-users-permissions-and-resource-limits/runtime-boundary-checklist.png)

_This summary image turns the final article into a review checklist for ordinary application containers: keep the user explicit, host writes predictable, privileges narrow, limits visible, and runtime state inspectable._

---

**References**

- [Docker Docs: Dockerfile reference - USER](https://docs.docker.com/reference/dockerfile/#user) - Defines the Dockerfile `USER` instruction, UID/GID syntax, and how it affects later build and runtime commands.
- [Docker Docs: docker container run](https://docs.docker.com/reference/cli/docker/container/run/) - CLI reference for `--user`, `--cap-add`, `--cap-drop`, `--privileged`, memory flags, CPU flags, and other runtime options.
- [Docker Docs: Resource constraints](https://docs.docker.com/engine/containers/resource_constraints/) - Official details on memory constraints, swap behavior, OOM behavior, CPU constraints, and scheduler controls.
- [Docker Docs: Define services in Docker Compose](https://docs.docker.com/reference/compose-file/services/) - Compose service reference for `user`, `cap_add`, `cap_drop`, `security_opt`, `privileged`, `cpus`, `mem_limit`, and related runtime attributes.
- [Docker Docs: Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) - Documents bind mount host coupling, default write access, read-only mounts, and Docker Desktop filesystem behavior.
- [Docker Docs: Isolate containers with a user namespace](https://docs.docker.com/engine/security/userns-remap/) - Official guide to user namespace remapping and host UID/GID isolation considerations.
- [Docker Docs: Rootless mode](https://docs.docker.com/engine/security/rootless/) - Explains running the Docker daemon and containers as a non-root user, plus setup details and limitations.
- [Docker Docs: Seccomp security profiles](https://docs.docker.com/engine/security/seccomp/) - Explains Docker's default seccomp profile and how seccomp restricts system calls.
