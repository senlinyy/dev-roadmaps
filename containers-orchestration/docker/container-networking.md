---
title: "Container Networking"
description: "Connect containers to each other and to the host while diagnosing ports, DNS names, and unreachable services."
overview: "Container networking gives each container its own network view, then lets you choose which paths are private and which paths are published to the host. Most Docker network bugs become manageable once you separate container ports, host ports, and service names."
tags: ["docker", "networking", "ports", "dns"]
order: 5
id: article-containers-orchestration-docker-container-networking
---

## Table of Contents

1. [Separate Private and Published Paths](#separate-private-and-published-paths)
2. [The devpolaris-orders-api Example](#the-devpolaris-orders-api-example)
3. [The Smallest Useful Artifact](#the-smallest-useful-artifact)
4. [Reading Command Output](#reading-command-output)
5. [Configuration Choices That Matter](#configuration-choices-that-matter)
6. [Diagnostics Before Guessing](#diagnostics-before-guessing)
7. [Failure Mode and Fix Direction](#failure-mode-and-fix-direction)
8. [Operational Tradeoffs](#operational-tradeoffs)
9. [The Habit to Practice](#the-habit-to-practice)
10. [Practice Loop for Network Boundaries](#practice-loop-for-network-boundaries)

## Separate Private and Published Paths

A container has its own network namespace, which means it gets its own view of
interfaces, routes, and listening ports. Docker networking lets containers talk
privately to each other and lets you choose which container ports are published to the
host. Most beginner bugs come from mixing those two paths.

The running example is `devpolaris-orders-api`, a Node service with `GET /health`, `POST
/orders`, and a PostgreSQL dependency. The service is ordinary on purpose. Docker
behavior is easier to learn when logs, ports, files, and failures appear in a service
shape you may already recognize.

The key mental model for this article is `network`. Do not treat it as vocabulary to
memorize. Treat it as the boundary that decides where files live, what gets reused,
which name a process can call, or where the next diagnostic command should look.

A good Docker workflow keeps the application image disposable and the operational
evidence visible. If a command changes state, inspect the state. If a config file
controls a runtime choice, read it as part of code review.

## The devpolaris-orders-api Example

For `devpolaris-orders-api`, the team wants a repeatable local path. A new developer
should clone the repository, run the documented Docker command or Compose command, call
`/health`, and know where to look when the result differs from the README.

That local path should not depend on uncommitted files, hidden laptop services, or a
shell environment only one person has. Docker does not remove all environmental
differences, but it makes the important ones explicit: image name, container name,
environment variables, ports, mounts, networks, and startup command.

The example keeps using these values so the evidence stays consistent:

| Setting | Value | Why it matters |
|---------|-------|----------------|
| Service | `devpolaris-orders-api` | Gives logs and requests a real owner |
| Internal port | `3000` | The API listens here inside the container |
| Host port | `8080` | The browser uses this from the host |
| Database | `orders_dev` | The API needs a concrete dependency |
| Health path | `/health` | A cheap endpoint for readiness checks |

When you see a failure later, match it back to this table. A wrong port, wrong database
host, wrong file path, or wrong service name usually explains the symptom.

## The Smallest Useful Artifact

The smallest useful artifact is the file or command that makes the decision reviewable.
For this topic, the artifact looks like this:

```bash
$ docker network create orders-dev
orders-dev

$ docker run -d --name orders-db --network orders-dev postgres:16
$ docker run -d --name orders-api --network orders-dev   -p 127.0.0.1:8080:3000   -e DATABASE_URL=postgres://orders:orders@orders-db:5432/orders_dev   devpolaris/orders-api:local
```

The exact syntax matters less than the shape. The artifact names the thing Docker should
create or connect. It also gives a reviewer something concrete to question. Is the image
tag right? Is the mount path safe? Is the service name reachable from the caller? Is the
command running in the foreground?

Avoid hiding important choices in one-off terminal history. If the team needs the same
command more than twice, place it in a `compose.yaml`, `Dockerfile`, `Makefile`, package
script, or README snippet that can be reviewed.

## Reading Command Output

Docker output is not decoration. It is the first diagnostic interface. Build output
shows cache hits and rebuilt steps. `docker ps` shows lifecycle state and published
ports. Logs show what the process wrote to stdout and stderr. Inspect output shows
metadata that may not be visible in the original command.

```bash
$ docker ps --filter name=orders-api
CONTAINER ID   IMAGE                         STATUS       PORTS                    NAMES
3f2b0ad1f77d   devpolaris/orders-api:local    Up 6 sec     127.0.0.1:8080->3000/tcp orders-api
```

Read the first surprising line, not the last line only. If a build spent 30 seconds on
dependency install, look for the instruction that invalidated the cache. If `docker ps`
shows no host port, the browser cannot reach the container through localhost. If logs
show an application-level error, rebuilding the image may not change anything.

A useful team habit is to paste the smallest evidence block into a pull request, issue,
or incident note. The evidence should answer one question. Large logs make the next
person search again. Small evidence lets the next person continue the reasoning.

## Configuration Choices That Matter

Several Docker choices look like small syntax details but carry operational meaning.
Names decide how humans and DNS refer to containers. Ports decide which traffic crosses
the host boundary. Mounts decide which files survive replacement. Dockerfile order
decides which build work can be reused. Compose service names decide what connection
strings should contain.

For `devpolaris-orders-api`, a production-like local setup should keep secrets out of
the image, keep database data outside the API container, publish only the API port
needed by the browser, and make startup logs visible. Those choices are not ceremony.
They prevent specific failures: leaked `.env` files, empty databases after recreate,
exposed local databases, and containers that exit without useful logs.

| Choice | Safer default | Failure it prevents |
|--------|---------------|---------------------|
| Runtime config | Environment variables at run time | Rebuilding images for each environment |
| Service data | Named volumes | Losing database files with container removal |
| Host access | Explicit port publishing | Accidental exposure or unreachable services |
| App logs | stdout and stderr | Empty `docker logs` during failures |
| Source edits | Bind mounts only for development | Host-specific production behavior |

These defaults are small enough for a junior engineer to apply and concrete enough for a
senior engineer to review.

## Diagnostics Before Guessing

When something breaks, resist the urge to change three things at once. Docker gives you
a clean diagnostic order. Start with the state, then logs, then metadata, then
inside-container checks only if the container is running.

For most local failures, the first four commands are enough:

```bash
$ docker ps -a --filter name=orders
$ docker logs --tail 100 orders-api
$ docker inspect orders-api --format "{.State.Status} {.State.ExitCode}"
$ curl -i http://localhost:8080/health
```

Each command narrows the boundary. `docker ps -a` tells you whether the process is
alive. `docker logs` tells you what the process reported. `docker inspect` tells you
what Docker actually configured. `curl` proves the host-to-container path.

Use `docker exec` after those checks, not before them. A shell inside a container is
useful, but it can also distract you into poking around without a theory. Enter the
container when you know what you need to inspect: an environment variable, a file path,
DNS resolution, a process user, or a command result.

## Failure Mode and Fix Direction

A realistic failure for this topic looks like this:

```text
[2026-05-07T11:31:09.820Z] db error connect ECONNREFUSED 127.0.0.1:5432
```

The fix direction depends on the error text. If the process cannot find a file, inspect
the image layout, working directory, Dockerfile copy steps, and bind mounts. If the
process cannot reach `127.0.0.1`, remember that localhost means the current container,
not the host or another service. If a database table is missing, the network may be fine
and the schema migration may be the actual failure.

Do not stop at naming the failure. Prove the boundary. For a network error, show the
connection string and network membership. For a mount error, show `docker inspect` mount
output and `ls -l` ownership. For a cache error, show the first non-cached layer. For a
Compose timing error, show service health and API logs at the same timestamp.

The repair should live in the durable place: Dockerfile, Compose file, application
startup checks, migration command, or documented run target. A manual change inside a
running container is evidence gathering, not a permanent fix.

## Operational Tradeoffs

Every Docker pattern trades one benefit for another. More isolation can mean more setup.
Smaller images can be harder to debug. Bind mounts give fast feedback but make the
container depend on host files. Named volumes protect data but keep stale state after
containers are removed. Cache speeds builds but can hide missing inputs if the
Dockerfile does not describe the real build.

| Strategy | Gain | Cost |
|----------|------|------|
| Direct CLI | Fast inspection | Hard to repeat as the stack grows |
| Dockerfile | Portable image contract | Requires careful build inputs |
| Named volume | Durable service data | Reset must be deliberate |
| Bind mount | Immediate local edits | Host permissions and hidden image files |
| User-defined network | Stable service names | Another object to inspect |
| Compose | Reviewable local stack | Still not a production orchestrator |

The best default is the one that makes the next failure easiest to diagnose. For a
learning roadmap, that means clear names, short commands, visible logs, and one concrete
service carried through the examples.

## The Habit to Practice

Practice this topic by changing one variable at a time. Start the service, call
`/health`, inspect the state, then intentionally break one boundary. Remove an
environment variable. Change a port mapping. Rename a service. Remove a volume. Reorder
a Dockerfile copy step. Each small break teaches one diagnostic branch.

Write down the command that proved the cause. The command matters because it turns
memory into a repeatable method. A teammate can follow `docker logs`, `docker inspect`,
`docker network inspect`, or `docker volume inspect` even if they did not watch the
original failure happen.

For `devpolaris-orders-api`, the target habit is simple: you can explain where the
process runs, where its files come from, how traffic reaches it, where its data
persists, and which command proves each claim. That is the practical foundation Docker
needs before Kubernetes enters the picture.

## Practice Loop for Network Boundaries

A networking practice loop should prove three paths separately: host to
API, API to database, and API to host-only service. When these paths are
mixed together, Docker networking feels inconsistent. When they are
checked one at a time, the failure usually names itself.

Start with host to API. The evidence is the published port in `docker
ps` plus a host-side HTTP request.

```bash
$ docker ps --filter name=orders-api
CONTAINER ID   IMAGE                         STATUS       PORTS                    NAMES
3f2b0ad1f77d   devpolaris/orders-api:local    Up 6 sec     127.0.0.1:8080->3000/tcp orders-api

$ curl -i http://localhost:8080/health
HTTP/1.1 200 OK
```

Next prove API to database. The evidence should come from inside the API
container because that is where the connection originates.

```bash
$ docker exec orders-api node -e "require('dns').lookup('orders-db', console.log)"
null 172.20.0.2 4

$ docker exec orders-api node -e "const net=require('net'); const s=net.connect(5432,'orders-db',()=>{console.log('connected'); s.end();}); s.on('error',e=>{console.error(e.code); process.exit(1);});"
connected
```

DNS success proves the service name resolves. TCP success proves
something is listening on the target port. Authentication and schema
errors can still happen later, but they are no longer network discovery
problems.

Finally prove API to host when a dependency really runs outside Docker.
On Linux, add a host gateway name if your setup needs it. Then test from
inside the container.

```bash
$ docker run --rm   --add-host=host.docker.internal:host-gateway   alpine:3.20 wget -qO- http://host.docker.internal:8080/health
{"status":"ok"}
```

The practice loop gives each caller the right hostname. Host tools use
`localhost` for published ports. Containers use service names for other
containers. Containers use `host.docker.internal` or an explicit gateway
mapping for host services. Keeping those three paths separate prevents
most Docker networking confusion.

When the path still fails, capture the caller and target in the note. That one line prevents people from applying the wrong hostname rule.

```text
Caller: orders-api container
Target: PostgreSQL container on orders-dev network
Configured URL: postgres://orders:orders@localhost:5432/orders_dev
Expected URL: postgres://orders:orders@orders-db:5432/orders_dev
```

The word `localhost` is wrong only because of who is calling. From a host-side `psql` command against a published port, `localhost` may be exactly right. From the API container, it points at the API container itself.

For Compose projects, repeat the same checks with service names. Compose creates the network for you, but the caller rule stays the same: host callers use published ports, container callers use service names.

A useful final check is to remove the published API port and confirm that container-to-container traffic still works. That proves private networking and host publishing are separate decisions, not one shared switch.

That test also protects future Compose rewrites. If private service calls only work when a host port is published, the application is probably using the host-facing URL from inside the container.

Write the caller in bug reports. "API container cannot reach db" is much more useful than "database is down" because it points directly at DNS, network membership, credentials, and the connection string used by that caller.

When the bug report names the caller, a teammate can reproduce the same viewpoint with `docker exec` or a short diagnostic container on the same network. That keeps the fix tied to evidence instead of laptop assumptions.

Keep that viewpoint in the fix description too. "Changed API DATABASE_URL from localhost to orders-db" explains both the symptom and the Docker networking rule that made the change necessary.

---

**References**

- [Docker Docs: Container networking](https://docs.docker.com/engine/network/) - Official overview of Docker networking drivers and container connectivity.
- [Docker Docs: Bridge network driver](https://docs.docker.com/engine/network/drivers/bridge/) - Details the local bridge networking model used in common Docker development.
- [Docker Docs: Publishing ports](https://docs.docker.com/get-started/docker-concepts/running-containers/publishing-ports/) - Explains host-published ports and container ports.
