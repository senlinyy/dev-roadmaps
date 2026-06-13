---
title: "Volumes and Mounts"
description: "Trace where container files live by comparing image layers, writable layers, named volumes, bind mounts, mount hiding, and ownership."
overview: "Containers are disposable, but applications still need files and data. This article follows Docker storage from the image filesystem to runtime mounts so volumes and bind mounts make sense as lifetime choices."
tags: ["docker", "volumes", "bind-mounts", "storage"]
order: 2
id: article-containers-orchestration-docker-volumes-and-bind-mounts
aliases:
  - volumes-and-bind-mounts
  - containers-orchestration/docker/volumes-and-bind-mounts.md
---

## Table of Contents

1. [The Three File Lifetimes](#the-three-file-lifetimes)
2. [Image Layers and the Writable Layer](#image-layers-and-the-writable-layer)
3. [Named Volumes](#named-volumes)
4. [Bind Mounts](#bind-mounts)
5. [Mount Targets and Hidden Files](#mount-targets-and-hidden-files)
6. [Ownership and Write Permissions](#ownership-and-write-permissions)
7. [Backups, Resets, and Compose](#backups-resets-and-compose)
8. [Inspecting Storage](#inspecting-storage)
9. [Common Failure Patterns](#common-failure-patterns)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Three File Lifetimes
<!-- section-summary: Docker storage choices make sense when every path has a clear owner and lifetime. -->

The product catalog stack can receive browser traffic now, and the API can reach Postgres by service name. Then a new problem shows up during a demo. The team removes and recreates the database container, starts the stack again, and the catalog products from yesterday have vanished.

That failure has a different shape from a networking failure. The connection path worked. The missing piece was **file lifetime**. The database wrote its files somewhere that belonged to the old container, and the team removed that container.

Docker storage revolves around three lifetimes. **Image files** come from the image you built or pulled. **Container writable-layer files** belong to one container instance. **Mounted files** come from somewhere outside that container instance, either from a Docker-managed volume or from a host path through a bind mount.

The important beginner question is simple: **who owns this path, and how long should the contents survive?** Database data should survive container recreation. Source code in a development loop should stay owned by the host repository. Temporary cache files can disappear with the container.

The rest of the article follows that question through the catalog stack. Postgres needs durable data, the API needs live source code during development, build output can get hidden by a mount, and generated reports can carry surprising file ownership back to the host.

## Image Layers and the Writable Layer
<!-- section-summary: Image layers provide the starting filesystem, and the writable layer captures runtime changes for one container. -->

An **image layer** is part of the filesystem stored in a Docker image. When you build an API image, Docker records files such as `/app/package.json`, `/app/dist/server.js`, and the runtime dependencies in read-only layers. Every container created from that image starts from those same image files.

A **writable layer** is the container-specific layer Docker adds at runtime. When the process writes a file without a volume or bind mount at that path, the write lands in that container's writable layer. The file belongs to that one container instance.

Here is a small API image:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["node", "dist/server.js"]
```

The built `dist/server.js` file comes from the image. If the running API writes `/tmp/catalog-debug.log`, that debug file goes into the writable layer. Removing the API container removes that writable layer along with the debug file.

This disposable behavior is useful for temporary files. It keeps throwaway shells, one-off test output, and runtime scratch files away from the image. It becomes dangerous when a service writes business data there, because `docker rm` removes the container's writable layer.

The catalog database gives us the practical next step. Postgres writes state under `/var/lib/postgresql/data`, and that path should survive database container replacement. That path needs a volume.

## Named Volumes
<!-- section-summary: A named volume gives Docker-managed data a lifetime outside one container instance. -->

A **named volume** is Docker-managed storage with a stable name. Docker stores it on the Docker host, manages its location, and mounts it into containers that request it. The container sees a normal path, while Docker supplies the contents from the volume.

For the catalog database, the team can create a volume and mount it at the Postgres data directory:

```bash
docker volume create catalog-db-data

docker run -d \
  --name catalog-db \
  --mount type=volume,source=catalog-db-data,target=/var/lib/postgresql/data \
  -e POSTGRES_USER=catalog \
  -e POSTGRES_PASSWORD=catalog \
  -e POSTGRES_DB=catalog \
  postgres:16-alpine
```

Postgres still writes to `/var/lib/postgresql/data`. Docker maps that path to `catalog-db-data`. If the team removes `catalog-db` and starts a new database container with the same volume mounted at the same target, the new container sees the existing database files.

Compose makes the same choice clearer:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: catalog
      POSTGRES_PASSWORD: catalog
      POSTGRES_DB: catalog
    volumes:
      - catalog-db-data:/var/lib/postgresql/data

volumes:
  catalog-db-data:
```

Named volumes fit service-owned data. Local databases, package caches, search indexes, and generated service state often belong in volumes because the host path itself is an implementation detail. Docker owns the location, and the service owns the contents.

The team still needs a different tool for source code. During local development, the host editor should own the API files, and the container should see each edit immediately. That calls for a bind mount.

## Bind Mounts
<!-- section-summary: A bind mount shows a specific host path inside the container filesystem. -->

A **bind mount** maps an existing path from the Docker host into a container. The path might be a project directory, a single config file, or an output folder. The host path owns the visible files, and the container process reads or writes through that mount.

For the catalog API, a development container can mount the host source directory at `/app`:

```bash
docker run --rm \
  --name catalog-api \
  --mount type=bind,src="$(pwd)/api",dst=/app \
  -p 127.0.0.1:8080:3000 \
  catalog-api:dev
```

Now editing `api/src/server.ts` on the host changes what the container sees at `/app/src/server.ts`. If a tool inside the container writes `/app/coverage/index.html`, the host sees that file under `api/coverage/index.html`. That direct connection makes bind mounts very useful for development loops.

Bind mounts also couple the container to the host. The path must exist on the Docker daemon host, and the host filesystem permissions still matter. Docker Desktop adds a virtual-machine file sharing layer, while Linux Docker Engine usually reaches the host path directly.

Bind mounts can be read-only when the container only needs input:

```bash
docker run --rm \
  --mount type=bind,src="$(pwd)/config/dev.json",dst=/app/config/dev.json,readonly \
  catalog-api:dev
```

That small `readonly` option changes the risk. A container that only needs a config file can read it without gaining write access to the host copy. This is a practical habit for local tools, linters, and one-off inspection containers.

Bind mounts solve the source-code workflow, but they introduce one of Docker storage's most surprising behaviors. A mount target can hide files that the image already had at the same path.

## Mount Targets and Hidden Files
<!-- section-summary: A mount target replaces what the container sees at that path while the mount is active. -->

A **mount target** is the container path where Docker attaches a volume or bind mount. At that target, the mounted source becomes the visible content. Files from the image at the same path can become hidden for that container while the mount exists.

Suppose the API image contains this path from the build:

```bash
/app/dist/server.js
```

The image can run because `CMD ["node", "dist/server.js"]` finds the built file. Now the team starts the container with the host repository mounted at `/app`:

```bash
docker run --rm \
  --mount type=bind,src="$(pwd)/api",dst=/app \
  catalog-api:dev
```

If the host `api` directory has no `dist/server.js`, the container command fails. Docker still has the built file in the image layers. The active bind mount changes the container's view of `/app`, so the process sees the host directory at that path.

Volumes have their own related behavior. A non-empty volume mounted over a container directory hides the image files at that path. An empty volume mounted over a container directory that already contains files receives a copy of those files by default, unless the mount uses Docker's `volume-nocopy` option.

This is why development containers often mount a narrower source path instead of the whole application directory. Mounting `./src:/app/src` lets the image keep built dependencies or generated files under other paths. Mounting the entire repository at `/app` gives the host full control of that path, including anything missing from the host copy.

Once a bind mount lets the container write into the host repository, file ownership becomes the next real production-style problem.

## Ownership and Write Permissions
<!-- section-summary: Mounted writes still use Linux user and group IDs, so container users can create surprising host-owned files. -->

File ownership uses **UIDs** and **GIDs**, which are numeric user and group IDs. Linux stores those numbers on files. Usernames are friendly labels, while the numbers decide ownership across bind mounts.

If a container process runs as UID `0` and writes into a bind-mounted report directory, the host may see root-owned files. A developer can open the report in a browser and still fail to edit, delete, or regenerate it from the host editor. The file crossed the mount exactly as requested, with the writer's numeric identity attached.

A typical development command can line up the container process with the host user's UID and GID:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,src="$(pwd)/reports",dst=/reports \
  catalog-api:dev \
  npm test -- --output /reports/results.json
```

The container writes `/reports/results.json` as the same numeric user and group as the host developer. That makes cleanup and edits feel natural on Linux hosts. On Docker Desktop, the VM file-sharing layer can translate some details, but the same question still helps: which numeric user wrote the file at the mounted path?

Named volumes have ownership too. A database image usually initializes its data directory with the user it expects to run as. A custom service image should create and permission its data directories during the build so the runtime user can write without switching back to root.

Ownership touches the next article more deeply, because users, capabilities, and resource limits all sit at the runtime boundary. For storage, the immediate habit is enough: choose the writer deliberately, keep source-code bind mounts narrow, and use read-only mounts when writes have no business value.

## Backups, Resets, and Compose
<!-- section-summary: Durable storage needs deliberate backup and reset commands because volumes can outlive containers. -->

A named volume surviving container recreation is useful only when the team treats it like real data. The catalog database volume should have a backup path before someone runs a reset command during a demo or local migration test. Docker volumes are easy to create, and that makes them easy to forget.

A common backup pattern uses a short-lived helper container. The helper mounts the volume at one path and a host backup directory at another path, then creates an archive:

```bash
mkdir -p backups

docker run --rm \
  --mount type=volume,source=catalog-db-data,target=/data,readonly \
  --mount type=bind,src="$(pwd)/backups",dst=/backup \
  alpine:3.20 \
  tar -czf /backup/catalog-db-data.tgz -C /data .
```

Restore uses the same idea in the other direction. The team should stop the database container first so Postgres is not writing while files are restored. The helper then mounts the volume and expands the archive into the volume path.

```bash
docker run --rm \
  --mount type=volume,source=catalog-db-data,target=/data \
  --mount type=bind,src="$(pwd)/backups",dst=/backup,readonly \
  alpine:3.20 \
  sh -lc 'cd /data && tar -xzf /backup/catalog-db-data.tgz'
```

Compose reset commands deserve the same care. `docker compose down` removes the project's containers and networks by default. `docker compose down -v` also removes named volumes declared by the Compose file, so it can delete local database state.

That difference matters in team instructions. "Restart the stack" and "wipe all local data" should be separate commands with separate names in a Makefile or task runner. The storage lifetime becomes safer when the command name matches the data outcome.

The next step is inspection. Before deleting or changing storage, the team needs to see which source owns each container path.

## Inspecting Storage
<!-- section-summary: Docker inspection shows the source, destination, type, and write mode for each mounted path. -->

Docker records mount information on each container. The `Mounts` section shows the mount type, source, destination, and whether the mount is read-write. That output answers the core storage question: which external source fills this container path?

```bash
docker inspect catalog-db --format '{{json .Mounts}}'
```

A formatted version might show this shape:

```json
[
  {
    "Type": "volume",
    "Name": "catalog-db-data",
    "Source": "/var/lib/docker/volumes/catalog-db-data/_data",
    "Destination": "/var/lib/postgresql/data",
    "RW": true
  }
]
```

The destination is the path the process sees. The source is where Docker supplies that path from. For a volume, the source is Docker-managed storage on the Docker host. For a bind mount, the source is a host path chosen by the user or Compose file.

Volumes have their own inspection command:

```bash
docker volume inspect catalog-db-data
```

The output includes the volume name, driver, labels, options, and mountpoint on the Docker host. Treat the mountpoint as evidence and operational detail. Day-to-day application changes should happen through the application, a backup and restore flow, or a controlled helper container.

Compose can show the final mount configuration after variable substitution and file merging:

```bash
docker compose config
docker compose ps
```

Those commands help when a mount path comes from an environment variable, an override file, or a teammate's local Compose file. The final source and destination often reveal the wrong host path, the wrong container path, or a missing override before anyone changes containers.

## Common Failure Patterns
<!-- section-summary: Storage failures usually come from placing durable data in the writable layer, hiding image files, or writing through mounts with the wrong user. -->

The first failure is missing durability. Postgres writes to its normal data directory, the container gets removed, and the data disappears because the directory lived in the writable layer. A named volume at `/var/lib/postgresql/data` gives that service state a separate lifetime.

The second failure is a bind mount hiding build output. The API image contains `dist/server.js`, but the host directory mounted at `/app` lacks `dist`. The process sees the host-controlled `/app`, so the image's built file sits hidden behind the mount.

The third failure is host coupling. A bind mount uses `/Users/maya/work/catalog/api`, and another developer's machine has the repository under `/home/lee/catalog/api`. Compose variables, relative paths, and documented local setup reduce that mismatch.

The fourth failure is write ownership. A container writes reports, coverage output, or generated code into a bind mount as root. The host user then struggles to edit or clean up those files, so the development command should run with a deliberate `--user` value or write to a volume instead.

The fifth failure is accidental data deletion. `docker compose down -v`, `docker volume rm`, and `docker volume prune` change storage lifetime along with container lifetime. Clear reset commands and simple backups keep local data loss from becoming a weekly surprise.

These problems all return to the same question from the start. A path needs a source, an owner, and a lifetime. Once those three details are explicit, Docker storage becomes predictable enough for daily use.

## Putting It All Together
<!-- section-summary: Volumes, bind mounts, and writable layers serve different jobs because they give paths different owners and lifetimes. -->

The catalog stack now has a clean storage story. The API image contains application files and build output. The API container can use its writable layer for temporary runtime files. Postgres stores database state in the named volume `catalog-db-data`, so the data survives database container replacement.

The host repository owns source files during development through a bind mount. The team keeps that mount narrow enough to avoid hiding image paths by accident. Generated reports either run with the host user's UID and GID or go to a deliberate output location that the team can clean.

The important ideas connect like this:

| Concept | Plain English meaning | Catalog example |
| --- | --- | --- |
| **Image layers** | Files baked into the image | `/app/dist/server.js` after `npm run build` |
| **Writable layer** | Runtime writes owned by one container | `/tmp/catalog-debug.log` |
| **Named volume** | Docker-managed storage outside one container | `catalog-db-data:/var/lib/postgresql/data` |
| **Bind mount** | Specific host path shown inside the container | `./api:/app` during local development |
| **Mount target** | Container path replaced by mounted content | `/app` showing the host repository |
| **UID/GID ownership** | Numeric writer identity on files | Reports written as `$(id -u):$(id -g)` |

The senior habit is to decide storage before trusting the container. If the data matters after recreation, give it a volume, a backup, and a reset story. If the host should own the files, use a bind mount with clear permissions. If the files are temporary, the writable layer is a fine place for them.

## What's Next

Volumes and bind mounts explain where files live. The next question is who writes them and how much power the container process has while it runs. That question shows up immediately when a test container creates root-owned report files or a service gets killed after using too much memory.

The next article follows the runtime controls around users, permissions, Linux capabilities, memory, and CPU. It uses the same catalog stack, because the storage choices we just made become safer only when the process identity and resource limits are deliberate too.

---

**References**

- [Docker Docs: Storage overview](https://docs.docker.com/engine/storage/) - Official overview of Docker storage options, writable layers, volumes, bind mounts, tmpfs mounts, and storage drivers.
- [Docker Docs: Volumes](https://docs.docker.com/engine/storage/volumes/) - Defines volumes, volume lifecycle, mount behavior over existing data, Compose usage, backup, restore, and volume removal.
- [Docker Docs: Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) - Documents bind mount behavior, host coupling, write access, read-only options, Docker Desktop behavior, and hidden existing files.
- [Docker Docs: Define services in Docker Compose](https://docs.docker.com/reference/compose-file/services/#volumes) - Compose service reference for declaring volume and bind mount entries under services.
- [Docker Docs: Define and manage volumes in Docker Compose](https://docs.docker.com/reference/compose-file/volumes/) - Compose top-level volumes reference for named volumes, external volumes, labels, and driver options.
- [Docker Docs: docker compose down](https://docs.docker.com/reference/cli/docker/compose/down/) - CLI reference documenting which containers, networks, and volumes Compose removes by default and with `--volumes`.
