---
title: "Cleanup and Prune"
description: "Clean Docker disk usage safely by separating stopped containers, unused images, build cache, networks, and volumes before running prune commands."
overview: "Docker keeps old runtime objects around so you can inspect, restart, and reuse them. This article teaches how to read what is taking space, decide which owner can lose it, and prune without deleting data by surprise."
tags: ["docker", "cleanup", "prune", "volumes"]
order: 1
id: article-containers-orchestration-docker-cleanup-and-prune
---

## Table of Contents

1. [What Docker Cleanup Means](#what-docker-cleanup-means)
2. [Start With Disk Usage](#start-with-disk-usage)
3. [Clean Stopped Containers](#clean-stopped-containers)
4. [Clean Images Without Losing Your Build Path](#clean-images-without-losing-your-build-path)
5. [Clean Build Cache](#clean-build-cache)
6. [Treat Volumes Like Data](#treat-volumes-like-data)
7. [Clean a Compose Project](#clean-a-compose-project)
8. [Use Labels and Filters for Team Safety](#use-labels-and-filters-for-team-safety)
9. [A Safe Cleanup Routine](#a-safe-cleanup-routine)
10. [Production Habits for Shared Machines](#production-habits-for-shared-machines)
11. [Putting It Together](#putting-it-together)
12. [What's Next](#whats-next)
13. [Official References](#official-references)

## What Docker Cleanup Means
<!-- section-summary: Docker cleanup removes local Docker objects, and each object type has a different risk level. -->

Docker cleanup means removing Docker objects from one machine so the Docker daemon stops using disk space for them. A **Docker object** can be a container, image, build cache record, network, or volume. The important beginner idea is that these objects carry different kinds of value, so a cleanup command should match the thing you are trying to remove.

Let's use one steady example all the way through. A small team runs a support-ticket app with four services: `api`, `worker`, `postgres`, and `redis`. The API and worker are built from local Dockerfiles, Postgres stores tickets in a named volume, and Redis stores temporary queues in another volume during development.

After a few weeks, someone opens Docker Desktop and sees a huge disk number. The team has rebuilt the API many times, run migration containers, switched branches, pulled new base images, and restarted the database during testing. At this moment, "clean Docker" sounds like one action, but it is really a set of small decisions.

The safe order is simple. First, measure space with **Docker disk usage**. Then clean **stopped containers** because they hold old runtime history. Then clean **unused images** and **build cache** because those can usually be rebuilt or pulled again. Finally, review **volumes** because volumes often contain the only local copy of database data.

![Docker cleanup map infographic showing Docker disk usage split across stopped containers, images, build cache, networks, and volumes with volumes at the higher-risk end](/content-assets/articles/article-containers-orchestration-docker-cleanup-and-prune/docker-cleanup-map.png)

*The cleanup map separates Docker object types by risk so image and cache cleanup do not get mixed up with database volume deletion.*

## Start With Disk Usage
<!-- section-summary: `docker system df -v` shows which Docker object type owns the space before you delete anything. -->

The command `docker system df` asks Docker for a disk report. The `df` name means disk free, and Docker uses it to summarize how much space images, containers, volumes, and build cache use. The verbose form, `docker system df -v`, adds names and relationships so you can point to the exact objects involved.

For our support-ticket app, the first short report might look like this. We are looking for the largest owner before we pick any cleanup command:

```bash
docker system df
```

```
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          28        8         14.6GB    9.2GB (63%)
Containers      21        4         2.4GB     2.0GB (83%)
Local Volumes   7         3         18.8GB    5.6GB (29%)
Build Cache     91        0         8.7GB     8.7GB
```

The **TYPE** column tells you the owner of the space. The **ACTIVE** column tells you whether Docker sees a current relationship, such as a container using an image or a volume. The **RECLAIMABLE** column gives Docker's estimate of space it can remove, but the human still decides whether the data matters.

The verbose report gives more useful evidence. It shows names, sizes, and relationships that the short summary hides:

```bash
docker system df -v
```

```
Images space usage:

REPOSITORY        TAG       IMAGE ID       CREATED        SIZE      SHARED SIZE   UNIQUE SIZE   CONTAINERS
support-api       dev       9f3a1c72d88f   3 hours ago    1.12GB    726MB         401MB         1
support-api       qa        71d0b62730aa   8 days ago     1.06GB    726MB         339MB         0
<none>            <none>    c3b921e1e456   9 days ago     988MB     726MB         262MB         0
postgres          18        19cfce768f4b   3 weeks ago    448MB     0B            448MB         1

Containers space usage:

CONTAINER ID   IMAGE                LOCAL VOLUMES   SIZE      CREATED       STATUS                      NAMES
9b4df0b24ff9   support-api:dev      0               84MB      3 hours ago   Up 3 hours                  support-api-1
482e1c72aa10   support-api:qa       0               612MB     8 days ago    Exited (1) 8 days ago       support-api-migration-qa
fc81a92210cd   support-worker:dev   0               391MB     5 days ago    Exited (0) 5 days ago       support-worker-replay

Local Volumes space usage:

VOLUME NAME          LINKS     SIZE
support_pgdata       1         13.2GB
support_redisdata    1         1.1GB
support_pgdata_old   0         4.5GB

Build cache usage:

CACHE ID       CACHE TYPE     SIZE      CREATED       LAST USED
vf9rjgw3y041   regular        1.4GB     9 days ago    9 days ago
p7u1w2qf3b0e   regular        712MB     2 days ago    2 days ago
```

This report already tells a useful story. Stopped containers have a couple of gigabytes. Images have old support API tags and dangling records. Build cache is large and currently unused. Volumes need a separate conversation because `support_pgdata_old` may hold an old database copy from a bug investigation.

## Clean Stopped Containers
<!-- section-summary: Stopped containers preserve old process state, logs, and writable-layer files until you remove them. -->

A **container** is a runtime object created from an image plus settings such as environment variables, ports, mounts, and command. A stopped container has already finished or failed, but Docker still keeps its name, exit code, logs, configuration, and writable layer. The writable layer is the small filesystem layer where a container writes files that are outside mounted volumes.

In the support-ticket app, stopped containers usually come from one-off migrations, failed API starts, queue replay tests, and old Compose service names. The first check is a full container list, because it shows both running and stopped containers:

```bash
docker ps -a
```

```
CONTAINER ID   IMAGE                COMMAND                  STATUS                      NAMES
9b4df0b24ff9   support-api:dev      "node dist/server.js"    Up 3 hours                  support-api-1
844e4c9d1c71   postgres:18          "docker-entrypoint.s..." Up 3 hours                  support-db-1
482e1c72aa10   support-api:qa       "npm run migrate"        Exited (1) 8 days ago       support-api-migration-qa
fc81a92210cd   support-worker:dev   "node dist/replay.js"    Exited (0) 5 days ago       support-worker-replay
```

Now the question is plain: do you still need the stopped container's logs or local files? If `support-api-migration-qa` failed during a customer-ticket migration test, someone may want its logs. Save them first:

```bash
docker logs support-api-migration-qa > support-api-migration-qa.log
docker inspect support-api-migration-qa > support-api-migration-qa.inspect.json
```

After the useful evidence is saved, you can remove one container directly. This keeps the cleanup narrow while the rest of the project stays untouched:

```bash
docker rm support-worker-replay
```

For a broader cleanup, use the targeted prune command. Docker asks for confirmation before it removes stopped containers:

```bash
docker container prune
```

```
WARNING! This will remove all stopped containers.
Are you sure you want to continue? [y/N] y
Deleted Containers:
fc81a92210cda820a91b3fbcf4f9cbf9c4410b847a820a6de6b0b1676a21b35c

Total reclaimed space: 391MB
```

A filter gives you a better daily habit. This command removes stopped containers older than twenty-four hours and leaves today's failures for debugging:

```bash
docker container prune --filter "until=24h"
```

Container cleanup connects to image cleanup because stopped containers keep image relationships alive. After old containers disappear, Docker may treat old image tags as unused.

## Clean Images Without Losing Your Build Path
<!-- section-summary: Image cleanup removes packaged files and layers, so protect one-off images that only exist locally. -->

An **image** is the packaged filesystem and metadata Docker uses to start containers. For the support-ticket app, `support-api:dev` may contain Node, installed dependencies, and the compiled server files. Docker stores images as layers, and several images can share the same base layers.

The image list is the first check. It shows which tags exist locally and which entries have already lost their tag:

```bash
docker image ls
```

```
REPOSITORY        TAG       IMAGE ID       CREATED        SIZE
support-api       dev       9f3a1c72d88f   3 hours ago    1.12GB
support-api       qa        71d0b62730aa   8 days ago     1.06GB
support-worker    dev       b15adcc6e487   3 hours ago    1.03GB
<none>            <none>    c3b921e1e456   9 days ago     988MB
postgres          18        19cfce768f4b   3 weeks ago    448MB
redis             8         2f66aad5324a   3 weeks ago    137MB
```

A **dangling image** is an image with no tag, often shown as `<none>`. Docker commonly creates these during rebuilds because the old image loses its tag when the new build receives the same tag. A normal image can also be unused if no container references it.

The small image prune removes dangling images. This is the gentler image cleanup because it targets images that already lost their tag:

```bash
docker image prune
```

The wider image prune includes all images without a container reference. Use it after you know important local images can come back from a Dockerfile or registry:

```bash
docker image prune -a
```

That `-a` flag needs a quick source check. If `support-api:qa` came from a Dockerfile in your repository, you can build it again. If it came from an old emergency image that nobody pushed to a registry and nobody can rebuild, keep it until the team exports it or publishes it somewhere durable.

Time filters make image cleanup friendlier on busy developer machines:

```bash
docker image prune -a --filter "until=168h"
```

That command targets unused images created more than 168 hours ago, which is seven days. A team can use this on local laptops to avoid deleting a branch image someone built earlier the same afternoon.

## Clean Build Cache
<!-- section-summary: Build cache saves previous build work, so pruning it usually trades disk space for slower future builds. -->

**Build cache** is saved work from Docker builds. If your Dockerfile installs packages, copies dependency manifests, compiles TypeScript, or downloads OS packages, Docker can reuse previous layers when the inputs match. This cache is why the second build of `support-api` often runs much faster than the first build.

Build cache is usually a good cleanup target on a full laptop or CI runner because the source code and package registries can recreate it. The practical cost is time and network usage during the next build. For our support-ticket app, pruning cache may make the next `docker compose build api worker` download dependencies again.

The targeted command is `docker builder prune`. Docker shows a warning because it is about to remove saved build work:

```bash
docker builder prune
```

```
WARNING! This will remove all dangling build cache.
Are you sure you want to continue? [y/N] y
Deleted build cache objects:
vf9rjgw3y041
p7u1w2qf3b0e

Total reclaimed space: 2.1GB
```

The wider form includes all unused build cache:

```bash
docker builder prune -a
```

For routine cleanup, a storage budget is safer than a full wipe. This asks Docker to keep about five gigabytes of cache where it can:

```bash
docker builder prune --keep-storage 5GB
```

CI machines often run cache cleanup on a schedule because each job creates build records. Developer machines usually do better with a budget and an age filter:

```bash
docker builder prune --filter "until=72h" --keep-storage 8GB
```

Build cache cleanup connects to volume cleanup through one important habit. Cache is replaceable work. Volumes often contain data. That difference is the reason the next section slows down.

## Treat Volumes Like Data
<!-- section-summary: Volumes are designed to outlive containers, so review and back up important volumes before removal. -->

A **Docker volume** is persistent storage managed by Docker. A container mounts the volume at a path, and Docker keeps the contents on the host. Volumes are useful because they survive container replacement, image rebuilds, and normal `docker compose down` runs.

In the support-ticket app, `support_pgdata` holds the Postgres data directory. If the API container disappears, the tickets remain because the database files live in the volume. That is exactly what you want during normal development and testing.

The volume list is the first check. It gives you names before you make any data decision:

```bash
docker volume ls
```

```
DRIVER    VOLUME NAME
local     support_pgdata
local     support_redisdata
local     support_pgdata_old
local     7c1bdcc7a5b2f8b2cbe1a114a986a2b1f2a7
```

Inspection adds labels, driver, and mount information. Those details help you find the owner before deleting a volume:

```bash
docker volume inspect support_pgdata_old
```

```
[
  {
    "CreatedAt": "2026-06-02T09:14:11Z",
    "Driver": "local",
    "Labels": {
      "com.docker.compose.project": "support",
      "devpolaris.cleanup": "review"
    },
    "Mountpoint": "/var/lib/docker/volumes/support_pgdata_old/_data",
    "Name": "support_pgdata_old",
    "Scope": "local"
  }
]
```

Before deleting a database-style volume, make a backup. A file-level archive is useful for a development volume, and it is quick enough for a local safety copy:

```bash
mkdir -p ./docker-volume-backups

docker run --rm \
  -v support_pgdata_old:/from:ro \
  -v "$PWD/docker-volume-backups":/backup \
  alpine \
  sh -c "tar -czf /backup/support_pgdata_old-$(date +%Y%m%d).tgz -C /from ."
```

That command mounts the volume read-only at `/from`, mounts a host backup directory at `/backup`, and writes a tar archive. For a real Postgres environment, teams usually prefer a database-aware backup such as `pg_dump` or a managed snapshot because it captures database state cleanly. The archive still gives a local safety copy before a development cleanup.

![Volume deletion path infographic showing inspect, label, back up, remove by name, and verify app steps around protected database data](/content-assets/articles/article-containers-orchestration-docker-cleanup-and-prune/volume-deletion-path.png)

*The volume path makes the database decision visible: inspect ownership, back up useful data, remove a named target, then prove the app still works.*

The default volume prune removes unused anonymous local volumes. That default is more cautious than removing every unused named volume:

```bash
docker volume prune
```

The broader volume prune can include unused named volumes. This is the command shape for an intentional data reset after review:

```bash
docker volume prune --all
```

Use the broader volume prune during an intentional reset, after checking names, labels, and backups. A named database volume can be inactive because the containers are down, while the data still matters to the person who was debugging a ticket import.

## Clean a Compose Project
<!-- section-summary: Compose cleanup removes project containers and networks by default, while images and volumes require explicit options. -->

**Docker Compose** runs a multi-container application from a Compose file. Our support-ticket Compose project creates the API container, worker container, Postgres container, Redis container, project network, and named volumes. Compose cleanup helps because it understands which objects belong to the project.

The everyday shutdown command is `docker compose down`. It gives you a clean project stop while keeping declared named volumes:

```bash
docker compose down
```

By default, Compose removes the service containers and project networks it created. Named volumes declared in the Compose file stay in place, which means `support_pgdata` survives and the next `docker compose up` can reuse the same database files.

When the Compose file changed and old service containers remain, add orphan cleanup. This fits branch switches and service renames:

```bash
docker compose down --remove-orphans
```

That helps after renaming `worker` to `ticket-worker`, or after deleting a temporary `mailhog` service from the Compose file. The old service container can keep using names, networks, or images, so removing orphans keeps the project tidy.

To clean images created by Compose builds, use an image option. This is useful when local service images are easy to rebuild:

```bash
docker compose down --rmi local
```

`--rmi local` removes service images that use Compose's local image naming. For a stronger reset, `--rmi all` removes all images used by services:

```bash
docker compose down --rmi all
```

Volume removal is the sharpest Compose cleanup option. This is the Compose command for a planned local data wipe:

```bash
docker compose down --volumes
```

For our support-ticket app, that can remove named volumes declared in the Compose file and anonymous volumes attached to containers. Use it for a planned local reset, such as "start with an empty Postgres database," after the team agrees that the old development data can go.

## Use Labels and Filters for Team Safety
<!-- section-summary: Labels and filters turn cleanup from a broad local command into a team policy. -->

A **label** is a key-value tag attached to a Docker object. Teams use labels to mark ownership, environment, cleanup policy, and retention needs. A **filter** narrows a Docker command to objects that match a condition such as age or label.

For our support-ticket stack, a Compose file can label project objects:

```yaml
services:
  api:
    build:
      context: ./api
      labels:
        devpolaris.app: support-ticket
        devpolaris.cleanup: weekly
    labels:
      devpolaris.app: support-ticket
      devpolaris.owner: platform

volumes:
  pgdata:
    labels:
      devpolaris.app: support-ticket
      devpolaris.cleanup: keep
  redisdata:
    labels:
      devpolaris.app: support-ticket
      devpolaris.cleanup: weekly
      devpolaris.cleanup.scope: support-ticket-weekly
```

A developer can list volumes that need human review. The command uses the label value from the Compose file:

```bash
docker volume ls \
  --filter "label=devpolaris.app=support-ticket" \
  --filter "label!=devpolaris.cleanup=weekly"
```

One detail matters for volume prune filters. A single scoped cleanup label is safer for the prune target than stacked positive project and policy labels. That keeps the automated cleanup narrow even when other support-ticket volumes use different policies.

A team can list volumes that carry that scoped cleanup label:

```bash
docker volume ls --filter "label=devpolaris.cleanup.scope=support-ticket-weekly"
```

After the list looks right, the team can prune only unused volumes with that scoped cleanup label. The `--all` flag matters because default volume prune only removes unused anonymous volumes, while this reviewed reset may include unused named volumes such as `support_redisdata`:

```bash
docker volume prune --all \
  --filter "label=devpolaris.cleanup.scope=support-ticket-weekly"
```

This command shape uses a positive label for one reviewed cleanup group. The protected Postgres volume and unrelated volumes stay outside this support-ticket cleanup.

Image filters are useful for old branch images. This example combines age and cleanup policy:

```bash
docker image prune -a \
  --filter "until=240h" \
  --filter "label=devpolaris.cleanup=weekly"
```

The same idea works for stopped containers. The app label keeps the cleanup scoped to this project:

```bash
docker container prune \
  --filter "until=48h" \
  --filter "label=devpolaris.app=support-ticket"
```

These filters make cleanup repeatable. They also make cleanup reviewable, because a teammate can read the label policy and understand why one object is protected while another one is disposable.

## A Safe Cleanup Routine
<!-- section-summary: A safe routine measures first, saves evidence, prunes low-risk objects, and handles volumes only after backup or approval. -->

A good cleanup routine uses a short checklist that works on a laptop, a shared development VM, or a CI runner. The details may change, but the order keeps the risky choices near the end.

The first check is your Docker context. This prevents cleaning the wrong Docker daemon:

```bash
docker context show
```

Then capture the disk report. Keep the verbose report as a small audit trail before anything disappears:

```bash
docker system df -v > docker-disk-before.txt
docker system df
```

Save logs for failed containers you still care about. The inspect output keeps the runtime configuration beside the logs:

```bash
docker ps -a --filter "status=exited"
docker logs support-api-migration-qa > support-api-migration-qa.log
docker inspect support-api-migration-qa > support-api-migration-qa.inspect.json
```

Clean stopped containers with an age filter. The recent debugging window stays available:

```bash
docker container prune --filter "until=24h"
```

Clean old unused images. The seven-day window gives active branch work some breathing room:

```bash
docker image prune -a --filter "until=168h"
```

Trim build cache with a budget. This saves disk while keeping some recent build speed:

```bash
docker builder prune --filter "until=72h" --keep-storage 8GB
```

Review volumes separately. Volume review stays outside the quick prune path:

```bash
docker volume ls
docker volume inspect support_pgdata_old
```

Back up important volumes before deletion. The archive goes into the local backup directory:

```bash
docker run --rm \
  -v support_pgdata_old:/from:ro \
  -v "$PWD/docker-volume-backups":/backup \
  alpine \
  sh -c "tar -czf /backup/support_pgdata_old-$(date +%Y%m%d).tgz -C /from ."
```

Then remove a known volume by name if the team agreed. Direct removal is clearer than a broad volume prune for one reviewed volume:

```bash
docker volume rm support_pgdata_old
```

Finish by measuring again and starting the app. The cleanup should end with proof that the support-ticket stack still runs:

```bash
docker system df
docker compose up -d
docker compose ps
```

This routine gives you proof before and after cleanup. It also gives the next person a trail: what was measured, what evidence was saved, what was pruned, and which volume decisions were deliberate.

## Production Habits for Shared Machines
<!-- section-summary: Shared Docker hosts need ownership, schedules, and protected data paths so cleanup stays predictable for other teams. -->

Many teams use Docker on more than personal laptops. They may have CI runners, shared QA machines, build hosts, or demo environments. Cleanup on those machines should follow a team rule because one person's unused object may be another person's debugging evidence.

For CI runners, aggressive cleanup is common because builds recreate containers, images, and cache constantly. A scheduled job might run `docker container prune --force --filter "until=24h"` and `docker builder prune --force --filter "until=24h" --keep-storage 20GB`. The `--force` flag removes the confirmation prompt, so it belongs in reviewed scripts with narrow filters.

For shared QA machines, protect volumes and known images with labels. Keep a short runbook that says which projects own which volumes, where backups go, and who approves volume deletion. Use project names and labels so `support_pgdata` sits beside clear ownership metadata instead of anonymous hashes with no owner.

For production workloads, teams usually rely on orchestration platforms, managed databases, image registries, and host monitoring rather than hand-running prune during an incident. Docker prune commands still matter on build hosts and standalone servers, but production data should live in planned storage with backup and restore procedures.

## Putting It Together
<!-- section-summary: The full cleanup path follows the evidence from disk report to targeted commands and a final smoke test. -->

Let's walk through the support-ticket app as a real cleanup. Docker reports 43GB used, and the laptop has almost no free space. The team starts with `docker system df -v` and sees old API images, old migration containers, a large build cache, and one unused named Postgres volume.

The stopped migration container failed eight days ago, so the developer saves logs and inspect output. Then they run `docker container prune --filter "until=24h"` and reclaim about 1GB. The current API and worker keep running because container prune only targets stopped containers.

Next, they run `docker image prune -a --filter "until=168h"`. Docker removes old branch images and dangling rebuild leftovers. The latest `support-api:dev`, `support-worker:dev`, `postgres:18`, and `redis:8` remain because current containers still reference them.

Build cache is the largest easy win, so they run `docker builder prune --filter "until=72h" --keep-storage 8GB`. The next build may take longer, but the source still exists, the Dockerfiles still exist, and the package registries still exist. That is an acceptable trade for the team.

The volume `support_pgdata_old` gets a different treatment. The developer inspects it, sees the support-ticket project label, asks the teammate who ran the old migration test, and creates an archive before deletion. After that, `docker volume rm support_pgdata_old` removes the old local copy.

The final check is `docker system df`, followed by `docker compose up -d` and `docker compose ps`. Cleanup is finished only after the support-ticket app starts cleanly and the database still contains the expected local test tickets.

![Safe cleanup routine infographic showing measure, save evidence, prune containers, prune images, trim cache, review volumes, and smoke test steps for the support-ticket stack](/content-assets/articles/article-containers-orchestration-docker-cleanup-and-prune/safe-cleanup-routine.png)

*The summary routine keeps the cleanup order practical: collect evidence first, clean replaceable objects, review volumes separately, and finish with a smoke test.*

## What's Next

Cleanup teaches you where Docker keeps containers, images, cache, networks, and volumes. The next Docker Operations article uses the same support-ticket app to debug failures, starting with container state, logs, exit codes, image metadata, runtime configuration, networks, mounts, health checks, and Compose output.

## Official References

- [Docker: Prune unused Docker objects](https://docs.docker.com/engine/manage-resources/pruning/)
- [Docker CLI reference: `docker system df`](https://docs.docker.com/reference/cli/docker/system/df/)
- [Docker CLI reference: `docker container prune`](https://docs.docker.com/reference/cli/docker/container/prune/)
- [Docker CLI reference: `docker image prune`](https://docs.docker.com/reference/cli/docker/image/prune/)
- [Docker CLI reference: `docker builder prune`](https://docs.docker.com/reference/cli/docker/builder/prune/)
- [Docker CLI reference: `docker volume ls`](https://docs.docker.com/reference/cli/docker/volume/ls/)
- [Docker CLI reference: `docker volume inspect`](https://docs.docker.com/reference/cli/docker/volume/inspect/)
- [Docker CLI reference: `docker volume prune`](https://docs.docker.com/reference/cli/docker/volume/prune/)
- [Docker CLI reference: `docker compose down`](https://docs.docker.com/reference/cli/docker/compose/down/)
