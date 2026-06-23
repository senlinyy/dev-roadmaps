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

1. [The Catalog Data Bug](#the-catalog-data-bug)
2. [Image Files and Container Writes](#image-files-and-container-writes)
3. [Choosing a File Lifetime](#choosing-a-file-lifetime)
4. [Named Volumes for Postgres](#named-volumes-for-postgres)
5. [Bind Mounts for Local Development](#bind-mounts-for-local-development)
6. [Why `--mount` Is Clearer Than `-v`](#why---mount-is-clearer-than--v)
7. [Mount Targets and Hidden Image Files](#mount-targets-and-hidden-image-files)
8. [Read-Only Mounts and Temporary Scratch Space](#read-only-mounts-and-temporary-scratch-space)
9. [Ownership and Permissions](#ownership-and-permissions)
10. [Compose Volumes in the Catalog Stack](#compose-volumes-in-the-catalog-stack)
11. [Backups, Restores, and Resets](#backups-restores-and-resets)
12. [Inspecting and Debugging Mounts](#inspecting-and-debugging-mounts)
13. [Common Failure Patterns](#common-failure-patterns)
14. [Putting It All Together](#putting-it-all-together)
15. [What's Next](#whats-next)

## The Catalog Data Bug
<!-- section-summary: Storage debugging starts by asking which side owns a path and how long the files should live. -->

Let's stay with the product catalog stack from the networking article. The browser reaches the API through `127.0.0.1:8080`, the API reaches Postgres through `db:5432`, and the team finally has a working request path. A junior engineer adds three products through the UI, refreshes the page, and everything still looks good.

Then the team rebuilds the database container during a local demo. The container starts cleanly, the API reconnects, and the catalog is empty. The network path worked the whole time, so this is a different kind of bug. The missing piece is **where Postgres wrote its files**.

Docker storage has a very practical question behind it: **who owns this path, and how long should the files survive?** The image owns files that were baked during `docker build`. One container owns files written into its writable layer. A mounted source outside that container owns files shown through a volume, bind mount, or tmpfs mount.

That question sounds small, but it changes daily work. Database rows need to survive a container replacement. Source code should stay in the host repository while a developer edits it. Test reports should land somewhere the editor can delete. Temporary scratch files can disappear after the container stops.

This article follows the catalog team through those choices. We will keep Postgres as the durable service, the Node API as the editable service, and the host repository as the place developers actually work.

## Image Files and Container Writes
<!-- section-summary: An image gives the starting filesystem, while the writable layer records runtime changes for one container. -->

An **image filesystem** is the set of files that Docker stores in an image. Each Dockerfile instruction can add a layer, and most image layers are read-only when a container starts. If the API image copies `package.json`, installs dependencies, copies source code, and builds `dist/server.js`, every container created from that image sees those files at startup.

A **container writable layer** is the thin writeable layer Docker adds for one running container. If the API writes `/tmp/catalog-debug.log` without a mount at that path, Docker stores that file in the writable layer for that container. A second API container starts from the same image with its own writable layer and its own debug files. Here is a small Dockerfile for the catalog API, where the build output is part of the image filesystem.

```dockerfile
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

CMD ["node", "dist/server.js"]
```

The files under `/app` come from the image after the build finishes. The runtime can still create new files, change files, or delete files from its own view, and Docker records those runtime changes in the writable layer. That layer belongs to the container instance, not to the image tag. A quick shell experiment makes the lifetime visible:

```bash
docker run --name catalog-scratch catalog-api:dev \
  sh -lc 'mkdir -p /tmp/catalog && echo demo > /tmp/catalog/probe.txt && cat /tmp/catalog/probe.txt'

docker container rm catalog-scratch
docker run --rm catalog-api:dev \
  sh -lc 'test -f /tmp/catalog/probe.txt || echo "probe file is gone"'
```

The first container writes `probe.txt` into its writable layer. Removing the container removes that writable layer, so the next container starts from the image again and the file is gone. Docker documents this directly: data in a container's writable layer disappears after the container is deleted, and Docker recommends volumes for data that must outlive the container.

That explains the catalog database bug. If Postgres writes database files into the container writable layer, the data disappears with the removed database container. The API debug file can live there, but the database cannot.

## Choosing a File Lifetime
<!-- section-summary: The storage choice should match the owner of the data: image, container, Docker volume, host path, or memory. -->

Before adding flags, the senior engineer usually slows the debugging session down and names the lifetime. This keeps the team from treating every path as "some Docker file" and guessing at random fixes. Each path needs a source, a writer, and a cleanup story.

For the catalog stack, the choices line up like this. The table gives each important path a clear owner and lifetime.

| File or directory | Owner | Good Docker storage choice | Why it fits |
| --- | --- | --- | --- |
| `/app/dist/server.js` | API image | Image layer | Build output should ship with the image |
| `/var/lib/postgresql/data` | Postgres service | Named volume | Database state should survive container recreation |
| `./api/src` | Host repository | Bind mount | Developer edits should appear in the container |
| `/app/tmp/uploads` | One API container | Writable layer or tmpfs | Temporary request files can disappear after the run |
| `./reports/results.json` | Host developer | Bind mount with deliberate user | Test output should be editable from the host |

An **image layer** fits files that belong to the released application. A **writable layer** fits disposable runtime output. A **named volume** fits service-owned data that should live outside one container. A **bind mount** fits host-owned files that a container should read or write. A **tmpfs mount** fits temporary data that should stay out of both the writable layer and the host filesystem as much as Docker can manage.

The table also shows why no single storage feature solves every problem. Postgres wants Docker-managed durability, while the API development loop wants host-file access. Test reports need the host to own the output, while temporary uploads may need no durable storage at all. Now we can fix the database first, because it is the bug that loses real data.

![Docker file lifetimes infographic comparing image layer, writable layer, named volume, bind mount, and tmpfs with their catalog stack examples and lifetimes](/content-assets/articles/article-containers-orchestration-docker-volumes-and-bind-mounts/docker-file-lifetimes.png)

_This infographic maps each important catalog path to the storage lifetime it needs, from image-owned build output to Docker-managed database data and host-owned source files._

## Named Volumes for Postgres
<!-- section-summary: A named volume gives service data a Docker-managed lifetime outside any one container. -->

A **named volume** is Docker-managed storage with a stable name. Docker creates it on the Docker host, stores it outside a specific container's writable layer, and mounts it into containers that ask for it. The container process sees a normal directory path, while Docker supplies the backing storage from the volume.

For Postgres, the important container path is `/var/lib/postgresql/data`. The official Postgres image stores database files there by default. The catalog team wants those files to survive replacing the `db` container, so that path gets a named volume:

```bash
docker volume create catalog-db-data

docker run -d \
  --name catalog-db \
  --network catalog-net \
  --mount type=volume,source=catalog-db-data,target=/var/lib/postgresql/data \
  -e POSTGRES_USER=catalog \
  -e POSTGRES_PASSWORD=catalog_dev_password \
  -e POSTGRES_DB=catalog \
  postgres:16-alpine
```

The key part is the mount option. `source=catalog-db-data` names the Docker volume. `target=/var/lib/postgresql/data` names the path Postgres writes inside the container. Postgres keeps doing normal filesystem writes, and Docker routes that directory to the volume.

The lifetime changes immediately. The team can remove and recreate the database container, then attach the same volume at the same target path.

```bash
docker container rm -f catalog-db

docker run -d \
  --name catalog-db \
  --network catalog-net \
  --mount type=volume,source=catalog-db-data,target=/var/lib/postgresql/data \
  -e POSTGRES_USER=catalog \
  -e POSTGRES_PASSWORD=catalog_dev_password \
  -e POSTGRES_DB=catalog \
  postgres:16-alpine
```

The new container sees the existing database files because the files live in `catalog-db-data`. The container is replaceable, while the volume remains until someone removes the volume itself. That difference is the whole reason named volumes exist in local database stacks.

Named volumes also work well for service-owned caches and indexes. A package registry cache, a search index, or a queue data directory often belongs to the service rather than to the host repository. Docker can manage those paths without making the developer care about the host directory layout.

The catalog API has the opposite need during development. The developer wants the container to read files from the host editor as they change, so the API source path needs a bind mount. That takes us from Docker-managed storage to host-owned files.

## Bind Mounts for Local Development
<!-- section-summary: A bind mount shows a specific host file or directory inside a container. -->

A **bind mount** maps a host path into a container path. The source path is a real file or directory on the Docker daemon host, and the target path is where the container sees it. If the container writes through a read-write bind mount, it changes the host path.

For the catalog API, a development container can mount the source directory from the host repository into the container. The host editor stays in control of the source files, and the container gets the live view it needs for a hot-reload loop.

```bash
docker run --rm \
  --name catalog-api \
  --network catalog-net \
  --mount type=bind,src="$(pwd)/api/src",dst=/app/src \
  --mount type=bind,src="$(pwd)/api/package.json",dst=/app/package.json,readonly \
  -p 127.0.0.1:8080:3000 \
  -e DATABASE_URL=postgres://catalog:catalog_dev_password@catalog-db:5432/catalog \
  catalog-api:dev \
  npm run dev -- --host 0.0.0.0
```

The source code stays in `$(pwd)/api/src` on the host. The container sees that directory at `/app/src`, so an edit in the host editor appears in the running development process. The `package.json` mount is read-only because the container only needs to read it for this workflow.

This is the normal development reason for bind mounts. They let the host editor, Git checkout, test runner, and container process share files directly. Docker's bind mount docs list source code, build artifacts, generated files, and host-provided configuration as typical bind mount use cases.

Bind mounts also tie the container to the host layout. A path such as `/Users/maya/work/catalog/api/src` works only on a host that has that path. Compose relative paths help teams avoid hardcoded laptop paths, but the path still belongs to the host machine where the Docker daemon runs.

That last detail matters for remote Docker daemons and Docker Desktop. On a Linux Docker Engine host, the daemon usually sees the same Linux filesystem the shell sees. On Docker Desktop, the daemon runs inside a Linux virtual machine, and Docker Desktop provides file sharing so native host paths can appear inside containers.

The next small choice is syntax. Docker supports both `--mount` and the older `-v` form, but the catalog team should write new examples with `--mount`. The explicit syntax helps teammates read the storage boundary without decoding a compact colon string.

## Why `--mount` Is Clearer Than `-v`
<!-- section-summary: The `--mount` syntax names source, target, type, and options explicitly, which makes reviews and failures clearer. -->

Docker can create volume and bind mounts with either `--mount` or `-v`. The legacy `-v` form is compact, so many older examples use it. The newer `--mount` form uses key-value pairs, which names the mount type, source, target, and options directly in a code review. Here are equivalent named-volume examples, first with `--mount` and then with `-v`:

```bash
docker run --rm \
  --mount type=volume,source=catalog-db-data,target=/var/lib/postgresql/data \
  postgres:16-alpine

docker run --rm \
  -v catalog-db-data:/var/lib/postgresql/data \
  postgres:16-alpine
```

Both commands mount the volume at the Postgres data directory. The first command says `type=volume`, `source=...`, and `target=...` out loud. That explicit shape helps when a teammate is checking whether a path is a Docker volume or a host path. Bind mounts show the difference even more clearly:

```bash
docker run --rm \
  --mount type=bind,src="$(pwd)/api/src",dst=/app/src,readonly \
  catalog-api:dev

docker run --rm \
  -v "$(pwd)/api/src:/app/src:ro" \
  catalog-api:dev
```

The `--mount` form also has useful behavior for missing bind sources. By default, Docker reports an error when the `src` path is missing. With `-v`, Docker can create a missing host path as a directory, which can hide a typo until the container sees an empty directory where a file or project folder was expected.

That is why this article uses `--mount` for `docker run` examples. Compose files still use their own `volumes` syntax, which we will cover shortly. The idea is the same: make the source path, target path, and write mode obvious. Now that the team can create the right mounts, the next debugging surprise is what happens at the target path.

## Mount Targets and Hidden Image Files
<!-- section-summary: A mount target replaces the container's view at that path, so image files underneath can disappear from the running container's view. -->

A **mount target** is the container path where Docker attaches the mounted source. At that path, the mounted content is what the process sees. If the image already had files at the same path, those image files can be hidden while the mount is active.

This is a common catalog API bug. The image build created `/app/dist/server.js`, and the Dockerfile command expects that file. The file exists in the image, so the first instinct is to blame the build, but the runtime mount can change the view:

```dockerfile
CMD ["node", "dist/server.js"]
```

Then a developer mounts the whole host API directory over `/app`. That broad target covers the image's `/app` directory during the container run.

```bash
docker run --rm \
  --mount type=bind,src="$(pwd)/api",dst=/app \
  catalog-api:dev
```

If the host `api` directory lacks `dist/server.js`, the container fails with a missing-file error. The image still contains the built file, and the bind mount changes the visible content of `/app`. The process sees the host directory at `/app` instead of the image directory that was there before the mount.

Volumes have a related behavior. If a non-empty volume is mounted over a container directory that already has files, the mounted volume hides those existing files. If an empty volume is mounted over a directory that has files in the image, Docker copies the image files into the empty volume by default. Docker provides `volume-nocopy` for cases where that automatic copy should not happen.

The practical fix is usually a narrower target. For hot reload, the API may only need `./api/src` mounted at `/app/src`, while dependencies and build output stay inside the image or inside a separate named cache. A narrow mount gives the host ownership of the editable path without replacing the entire application directory.

Mount hiding also explains some "the file exists in the image" arguments during debugging. A file can exist in the image and still be invisible in a running container if a mount covers its parent path. The running container's mount table is the source of truth for that runtime view. Some mounts only need input access, so the next small safety improvement is making those mounts read-only.

![Mount target hides files infographic showing a bind mount covering an image app folder, hiding build output, and a narrower source-only mount keeping build output visible](/content-assets/articles/article-containers-orchestration-docker-volumes-and-bind-mounts/mount-target-hides-files.png)

_This infographic shows the mount-target problem visually: a broad bind mount can cover image files, while a narrower source mount keeps the built application output visible._

## Read-Only Mounts and Temporary Scratch Space
<!-- section-summary: Read-only mounts reduce accidental host writes, while tmpfs covers temporary data that should not persist after the container stops. -->

A **read-only mount** lets the container read mounted content without writing back through that mount. This matters because bind mounts have write access to the host path by default. A process in the container can create, modify, or delete files in the mounted host directory unless the mount is read-only or the host permissions block it.

The catalog API might need a local config file during development. The container needs to read that file, while the host repository should keep ownership of changes to it.

```bash
docker run --rm \
  --mount type=bind,src="$(pwd)/config/catalog.dev.json",dst=/app/config/catalog.dev.json,readonly \
  catalog-api:dev
```

The `readonly` option says the container can read `/app/config/catalog.dev.json`, but it cannot change the host file through that mount. This is a good fit for config files, test fixtures, seed files, and other inputs. A read-only bind mount can still reveal sensitive data to the container process, so the team should mount only the file the process needs.

Named volumes can also be mounted read-only. A backup helper container is a good example because it should read database files and write the archive somewhere else, so the source volume can stay protected during the backup.

```bash
docker run --rm \
  --mount type=volume,source=catalog-db-data,target=/data,readonly \
  --mount type=bind,src="$(pwd)/backups",dst=/backup \
  alpine:3.20 \
  tar -czf /backup/catalog-db-data.tgz -C /data .
```

A **tmpfs mount** is a temporary in-memory mount. On Linux, Docker can mount tmpfs at a container path so files written there stay outside the container writable layer and disappear when the container stops. Docker's docs call out tmpfs for non-persistent state and for cases where the application should avoid writing data permanently to the host or container layer.

For the catalog API, tmpfs can be useful for request scratch files. The path can hold short-lived processing data without turning that data into a durable part of the container.

```bash
docker run --rm \
  --mount type=tmpfs,dst=/app/tmp,tmpfs-size=67108864,tmpfs-mode=1770 \
  catalog-api:dev
```

This gives `/app/tmp` a temporary mount with a size option. User-facing uploads need a durable storage path, because files in this tmpfs mount disappear with the container. The tmpfs path fits short-lived scratch data that the application can regenerate or discard. Storage lifetime is now clearer, but mounted files still have Linux permissions, and the catalog team sees that as soon as tests write reports back to the host.

## Ownership and Permissions
<!-- section-summary: Mounted writes use numeric Linux user and group IDs, so the writer inside the container affects host file ownership. -->

Linux stores file ownership with numeric **UIDs** and **GIDs**. A UID identifies a user, and a GID identifies a group. Names such as `node`, `postgres`, or `app` make shell output readable, but the numeric IDs decide who owns files across a bind mount.

Here is the catalog team problem. A test container writes coverage and JSON reports into the host repository, and the resulting files should stay easy for the developer to edit or delete.

```bash
mkdir -p reports

docker run --rm \
  --mount type=bind,src="$(pwd)/reports",dst=/reports \
  catalog-api:test \
  npm test -- --reporter json --output /reports/results.json
```

If the process inside the container runs as UID `0`, the host may see root-owned files in `./reports`. The tests passed, but the developer cannot clean the report directory from the host editor without changing permissions. Docker did exactly what was requested: a container process wrote through a host mount using its numeric identity.

A common local fix is to run the one-off command with the host user's UID and GID. The command keeps the containerized test runner, while the output lands with host-friendly ownership.

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --mount type=bind,src="$(pwd)/reports",dst=/reports \
  catalog-api:test \
  npm test -- --reporter json --output /reports/results.json
```

Now the report file arrives with the same numeric owner as the developer. This works especially well for one-off generators, linters, test runners, and documentation tools that write back into the repository. It keeps host-owned project files under the host user's control.

Service-owned data has a different pattern. The Postgres image expects to run with the user and directory permissions it sets up for `/var/lib/postgresql/data`. The catalog API image should also create any service-owned writable directories during the image build and run as a deliberate application user. That deeper user boundary continues in the next article.

For this storage article, the habit is practical. Bind mounts that write to the repository should name the writer. Volumes that hold service data should match the service process. Read-only mounts should be read-only in the command or Compose file, not just trusted by convention. Now we can put the choices into Compose so the whole catalog stack starts the same way for the team.

## Compose Volumes in the Catalog Stack
<!-- section-summary: Compose records service storage choices beside networks, ports, and environment values. -->

**Docker Compose** describes the catalog stack as services plus the shared objects they need. The networking article used Compose to give the API a service name for Postgres and a host-facing port for the browser. Storage belongs in the same file because the API, database, and developer workflow all need predictable paths. Here is a development-oriented `compose.yaml` for the catalog stack:

```yaml
services:
  api:
    build: ./api
    command: npm run dev -- --host 0.0.0.0
    ports:
      - "127.0.0.1:8080:3000"
    environment:
      DATABASE_URL: postgres://catalog:catalog_dev_password@db:5432/catalog
    volumes:
      - type: bind
        source: ./api/src
        target: /app/src
      - type: bind
        source: ./config/catalog.dev.json
        target: /app/config/catalog.dev.json
        read_only: true
      - type: bind
        source: ./reports
        target: /reports
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: catalog
      POSTGRES_PASSWORD: catalog_dev_password
      POSTGRES_DB: catalog
    volumes:
      - type: volume
        source: catalog-db-data
        target: /var/lib/postgresql/data

volumes:
  catalog-db-data:
```

The top-level `volumes` section declares the named volume `catalog-db-data`. The `db` service mounts it at the Postgres data path. Compose creates the volume during `docker compose up` when the volume is missing, and it reuses the existing volume on later runs.

The API service uses bind mounts because those paths belong to the host project. `./api/src` is editable source code. `./config/catalog.dev.json` is read-only input. `./reports` is a host-visible output directory, so the team should pair it with a deliberate user setting for one-off commands that write reports.

The long-form Compose mount syntax is a little more verbose than `./api/src:/app/src`. The payoff is the same as `--mount`: each entry names the type, source, target, and read mode. Reviewers can scan those fields directly, especially after a stack has several services.

Compose also makes cleanup decisions explicit, and that matters because volumes can outlive containers. The next section gives the catalog team a safe backup and reset story before anyone runs a destructive command.

## Backups, Restores, and Resets
<!-- section-summary: Durable volumes need explicit backup, restore, and reset commands because container cleanup and data cleanup are separate operations. -->

A **backup** is a copy of data that can restore a useful state later. For a real production Postgres database, teams usually use database-native tools such as `pg_dump`, filesystem snapshots designed for databases, managed database backups, and tested restore procedures. For a local Docker learning stack, a helper container that archives a stopped volume is a simple way to see the volume mechanics.

A careful local backup flow stops the database first so Postgres has no active writes while files are archived. The helper container mounts the database volume read-only and writes the archive into a host backup directory.

```bash
mkdir -p backups

docker compose stop db

docker run --rm \
  --mount type=volume,source=containers-orchestration_catalog-db-data,target=/data,readonly \
  --mount type=bind,src="$(pwd)/backups",dst=/backup \
  alpine:3.20 \
  tar -czf /backup/catalog-db-data.tgz -C /data .

docker compose start db
```

The exact Compose volume name may include the project name as a prefix. `docker volume ls` shows the real name, and `docker volume inspect` shows its Docker-managed mountpoint. The backup helper mounts the database volume read-only at `/data` and the host backup directory at `/backup`, then writes one archive file to the host.

Restore goes in the opposite direction. The team should stop the database, clear the target volume only when they mean to replace it, and expand the archive into the mounted volume. This is a destructive workflow, so the command should live in a clearly named script rather than a vague restart helper:

```bash
docker compose stop db

docker run --rm \
  --mount type=volume,source=containers-orchestration_catalog-db-data,target=/data \
  --mount type=bind,src="$(pwd)/backups",dst=/backup,readonly \
  alpine:3.20 \
  sh -lc 'rm -rf /data/* && tar -xzf /backup/catalog-db-data.tgz -C /data'

docker compose start db
```

That restore command is intentionally explicit because it deletes existing files in the mounted volume. In team scripts, backup, restore, and reset should have names that say what happens to data. A script named `restart` should not erase a database volume.

Compose has two cleanup levels that developers should memorize. `docker compose down` removes containers and networks created for the project by default. `docker compose down -v` also removes named volumes declared in the Compose file and anonymous volumes attached to containers.

That difference explains many local surprises. If the team wants to restart containers while keeping catalog rows, `docker compose down` is enough. If the team wants a clean database for a migration rehearsal, `docker compose down -v` is the reset command, and it deserves the same caution as deleting any database. Before deleting or changing storage, the team needs evidence. Docker already exposes the mount table, volume list, and final Compose model.

## Inspecting and Debugging Mounts
<!-- section-summary: Mount debugging reads the runtime mount table, the volume object, the final Compose file, and the filesystem view from inside the caller container. -->

The first storage debugging command is usually `docker inspect` on the running container. Docker records each mount with a type, source, destination, write mode, and propagation details. The destination is the path the process sees inside the container. For the catalog database, the mount list should show a volume at the Postgres data directory:

```bash
docker inspect catalog-db --format '{{json .Mounts}}'
```

The output should have a shape like this. The exact source path can differ by host, while the type and destination should match the service design.

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

The important fields are `Type`, `Source`, `Destination`, and `RW`. A `Type` of `volume` tells the team Docker manages the source. A `Type` of `bind` points to a host path. `RW: false` tells the team the mount is read-only from the container's viewpoint.

Volume objects have their own commands. These commands help the team confirm the volume name and Docker-managed source before backup or reset work.

```bash
docker volume ls
docker volume inspect catalog-db-data
docker volume inspect containers-orchestration_catalog-db-data
```

The inspect output includes the volume driver, labels, options, and mountpoint on the Docker host. Treat the mountpoint as operational evidence, not as the normal editing path. Application changes should usually happen through the application, database tools, or a controlled helper container. Compose can show the final configuration after defaults, environment variables, profiles, and override files are applied:

```bash
docker compose config
docker compose ps
```

Those commands answer questions such as "which source path did Compose resolve?" and "which services are running right now?" They also help with project-name prefixes. If the volume name in a backup command is wrong, `docker compose config` and `docker volume ls` usually reveal the mismatch. The final check happens from inside the container that uses the path:

```bash
docker compose exec api sh -lc 'pwd && ls -la /app && ls -la /app/src && mount | grep /app || true'
docker compose exec db sh -lc 'ls -la /var/lib/postgresql/data | head'
docker compose exec api sh -lc 'touch /reports/probe && ls -ln /reports/probe'
```

The API checks show what `/app` and `/app/src` actually contain at runtime. The database check confirms that the expected data directory is visible. The report probe shows numeric ownership with `ls -ln`, which is more useful than usernames when host and container name maps differ.

With these commands, the storage bug usually stops being mysterious. The team can see whether a path is image-owned, writable-layer data, a volume, a bind mount, read-only, missing, or written by the wrong UID.

## Common Failure Patterns
<!-- section-summary: Docker storage failures usually come from the wrong lifetime, the wrong target, the wrong host path, or the wrong writer. -->

The first failure is keeping durable data in the writable layer. Postgres starts, writes data, and works during the first run. After `docker rm` or a Compose recreation, the rows vanish because the database files belonged to the removed container instead of a named volume.

The second failure is mounting the wrong target path. A volume mounted at `/var/lib/postgresql` may still leave the real data directory somewhere else, depending on the image and configuration. The fix starts by checking the image documentation and the process logs, then mounting the volume at the exact path the service writes.

The third failure is hiding image files with a broad bind mount. The image contains `/app/dist/server.js`, while the host directory mounted at `/app` has no `dist` directory. The running process sees the host view of `/app`, so it reports a missing built file.

The fourth failure is a missing or mistyped host path. With `-v`, Docker may create a missing source as an empty directory. With `--mount`, Docker reports the missing source by default, so the typo usually appears during the first run.

The fifth failure is giving a container more host write access than it needs. A read-write mount of the whole repository lets the container change source files, lock files, generated files, and sometimes configuration. Narrow bind mounts and `readonly` options reduce the amount of host filesystem the process can change.

The sixth failure is wrong ownership. A root-running container writes reports into `./reports`, and the host developer cannot clean them normally. A one-off command with `--user "$(id -u):$(id -g)"` or a deliberate image user keeps host-visible outputs manageable.

The seventh failure is confusing restart with reset. `docker compose down` removes containers and networks, while `docker compose down -v` also removes declared named volumes. Team runbooks and Makefile targets should use names such as `restart`, `reset-db`, and `backup-db` so the data outcome is clear before anyone presses enter.

The final failure is expecting a bind mount to travel with the image. A bind mount depends on the host path where the Docker daemon runs. It works well for local development, but a production environment should usually use image files, managed volumes, object storage, secrets, configs, or orchestrator-provided storage instead of a developer laptop path.

All of these failures point back to the same storage questions. Which side owns the path? Which process writes it? Which command removes it? The answer should be visible in the Dockerfile, the run command, or the Compose file.

## Putting It All Together
<!-- section-summary: A reliable Docker storage setup gives each important path an owner, a writer, a lifetime, and a recovery path. -->

The catalog stack now has a clean storage story. The API image owns the built application files that should ship with the image. The API writable layer can hold temporary logs and scratch files that have no value after the container disappears.

Postgres owns database state, so `/var/lib/postgresql/data` is backed by the named volume `catalog-db-data`. The volume outlives container replacement, and the team has backup, restore, and reset commands that treat data cleanup as a deliberate operation.

The host repository owns editable source code and local output. Bind mounts show `./api/src` inside the API container during development, mount config files read-only, and write reports through a known UID and GID. The team keeps bind mounts narrow so they do not hide image files by accident.

The main ideas connect like this. The table is the quick review the team can use before changing a Dockerfile, a run command, or a Compose mount.

| Concept | Plain English meaning | Catalog example |
| --- | --- | --- |
| **Image filesystem** | Files stored in image layers during build | `/app/dist/server.js` |
| **Writable layer** | Runtime writes owned by one container | `/tmp/catalog-debug.log` |
| **Named volume** | Docker-managed storage outside one container | `catalog-db-data` for Postgres data |
| **Bind mount** | Host path shown inside the container | `./api/src` at `/app/src` |
| **Mount target** | Container path filled by mounted content | `/app/src`, `/reports`, `/var/lib/postgresql/data` |
| **Read-only mount** | Mounted source the container can read but not change | `catalog.dev.json` |
| **tmpfs mount** | Temporary memory-backed mount on Linux | `/app/tmp` request scratch space |
| **UID/GID ownership** | Numeric writer identity on files | Reports written as `$(id -u):$(id -g)` |

The senior habit is simple enough to use during real debugging. Name the path, name the owner, name the writer, and name the cleanup command. If the path matters after replacement, it needs a volume or another durable storage system. If the host should own the files, it needs a bind mount with clear permissions. If the data can disappear, the writable layer or tmpfs can be the right place.

![Storage operations loop infographic showing inspect mounts, back up volume, restore carefully, reset with down -v, named volume, helper container, and host backup](/content-assets/articles/article-containers-orchestration-docker-volumes-and-bind-mounts/storage-operations-loop.png)

_This summary image connects the operational side of Docker storage: inspect the real mount, back up the named volume, restore deliberately, and reserve `down -v` for an intentional reset._

## What's Next

The storage story naturally points to the next runtime boundary. A bind mount can show the right path, but the process can still write files as the wrong user. A database can have a durable volume, but the container process still needs the right permissions and resource limits. A debug container can see the files, but Linux capabilities still decide which privileged operations it may attempt.

The next article follows **users, permissions, and limits** through the same catalog stack. We will look at container users, bind-mount ownership, Linux capabilities, memory limits, and CPU limits, because storage choices become much safer when the process identity and available resources are deliberate too.

---

**References**

- [Docker Docs: Volumes](https://docs.docker.com/engine/storage/volumes/) - Defines Docker-managed volumes, volume lifecycle, empty-volume copy behavior, read-only volumes, Compose usage, backups, restores, and removal.
- [Docker Docs: Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) - Documents bind mount use cases, host coupling, hidden existing files, read-only options, Docker Desktop behavior, and `--mount` versus `-v`.
- [Docker Docs: tmpfs mounts](https://docs.docker.com/engine/storage/tmpfs/) - Explains temporary memory-backed mounts, limitations, mount hiding, and `--mount type=tmpfs` options.
- [Docker Docs: Storage drivers](https://docs.docker.com/engine/storage/drivers/) - Explains image layers, container writable layers, copy-on-write behavior, and why writable-layer data disappears after container deletion.
- [Docker Docs: docker volume](https://docs.docker.com/reference/cli/docker/volume/) - CLI reference for creating, inspecting, listing, removing, pruning, and updating Docker volumes.
- [Docker Docs: Define and manage volumes in Docker Compose](https://docs.docker.com/reference/compose-file/volumes/) - Compose reference for top-level named volumes, external volumes, labels, drivers, and driver options.
- [Docker Docs: docker compose down](https://docs.docker.com/reference/cli/docker/compose/down/) - Documents which containers, networks, and volumes Compose removes by default and what changes with `--volumes`.
