---
title: "Docker CLI Basics"
description: "Run, inspect, stop, and clean up containers from the Docker CLI while keeping local development predictable."
overview: "Docker CLI basics are the daily moves that turn an image into a running process you can inspect, connect to, stop, and remove. This article follows a small orders API so each command has a reason."
tags: ["docker", "cli", "containers", "logs"]
order: 1
id: article-containers-orchestration-docker-docker-cli-basics
aliases:
  - containers-orchestration/containerization/docker-basics.md
  - article-containers-orchestration-containerization-docker-basics
---

## Table of Contents

1. [What Docker Runs](#what-docker-runs)
2. [Images, Containers, and Names](#images-containers-and-names)
3. [Running devpolaris-orders-api](#running-devpolaris-orders-api)
4. [Foreground, Detached, and Logs](#foreground-detached-and-logs)
5. [Ports and Environment Variables](#ports-and-environment-variables)
6. [Shell Access and One-Off Commands](#shell-access-and-one-off-commands)
7. [Stopping, Removing, and Cleaning Up](#stopping-removing-and-cleaning-up)
8. [Failure Path: It Exited Immediately](#failure-path-it-exited-immediately)
9. [Tradeoffs for Daily CLI Work](#tradeoffs-for-daily-cli-work)

## What Docker Runs

Before containers, a local service often depended on whatever happened to be installed
on your laptop. One developer had Node 20, another had Node 22, a third had PostgreSQL
running on a different port, and the README slowly became a list of small exceptions.
Docker gives the service a repeatable boundary: a process starts from an image, with its
own filesystem view, network view, environment, and default command.

A Docker image is the packaged template. It contains the application files, runtime,
installed packages, and metadata that says what command should run. A container is a
running instance of that image. If an image is like a JavaScript class, a container is
one object created from that class, except the object is an operating-system process
with isolation around it.

Docker fits between your source code and the machine that runs the process. It does not
replace your framework, database, or deployment platform. It gives those pieces a
predictable runtime wrapper. For `devpolaris-orders-api`, that wrapper lets the team run
the same API command on a laptop, in CI, and later inside an orchestrator such as
Kubernetes.

The Docker CLI is the first operating surface. You use it to pull images, run
containers, check logs, open a shell, publish ports, inspect metadata, and remove old
containers. Each command either creates a container, asks a container what happened,
changes its lifecycle, or cleans up local state.

## Images, Containers, and Names

Start by separating the words Docker uses every day. An image has a name and usually a
tag, such as `node:22-alpine`. A tag is a human label that points at an image version. A
container has an ID and can also have a friendly name, such as `orders-api-dev`. You can
run several containers from the same image, just as you can start several copies of the
same program.

The smallest useful inspection loop is `docker images` for image templates and `docker
ps` for running containers. Add `-a` when you want stopped containers too. Stopped
containers still exist because Docker keeps their writable layer, exit code, logs, and
metadata until you remove them.

```bash
$ docker images devpolaris/orders-api
REPOSITORY                TAG       IMAGE ID       CREATED          SIZE
devpolaris/orders-api     local     7c4b9e2a8012   9 minutes ago    182MB

$ docker ps -a --filter name=orders-api-dev
CONTAINER ID   IMAGE                         COMMAND           STATUS                    PORTS     NAMES
5a19d0a45d21   devpolaris/orders-api:local    "node server.js"  Exited (1) 2 minutes ago            orders-api-dev
```

That output already tells a story. The image exists, the container was created from that
image, and the process exited with code 1. The next useful question is not how to run
Docker harder. It is what the process printed before it exited. That question leads to
`docker logs`.

## Running devpolaris-orders-api

Imagine `devpolaris-orders-api` is a small Node service that exposes `GET /health` and
`POST /orders`. It reads `PORT`, `DATABASE_URL`, and `LOG_LEVEL` from environment
variables. Locally, you want to run it without installing the exact Node version on
every laptop.

After an image has been built, the first useful run command names the container, removes
it when it exits, and maps the container port to your host. The host is your laptop or
VM. The container port is the port the process listens on inside its isolated network
namespace.

```bash
$ docker run --rm --name orders-api-dev   -p 8080:3000   -e PORT=3000   -e DATABASE_URL=postgres://orders:orders@host.docker.internal:5432/orders_dev   devpolaris/orders-api:local

[2026-05-07T10:12:18.421Z] orders-api listening on port 3000
[2026-05-07T10:12:18.423Z] database target host.docker.internal:5432/orders_dev
```

Read `-p 8080:3000` as host port 8080 forwards to container port 3000. Your browser
calls `http://localhost:8080/health`, Docker forwards the traffic into the container,
and the API receives it on port 3000.

```bash
$ curl -i http://localhost:8080/health
HTTP/1.1 200 OK
content-type: application/json

{"status":"ok","service":"devpolaris-orders-api"}
```

That `curl` call proves three things at once: the process is running, Docker published
the port, and the application is responding through the same HTTP path a teammate would
use.

## Foreground, Detached, and Logs

A container started without `-d` stays attached to your terminal. That foreground mode
is useful for the first run because you see startup logs immediately and can stop the
process with Ctrl+C. A longer development session usually runs detached so your terminal
is free.

```bash
$ docker run -d --name orders-api-dev   -p 8080:3000   -e PORT=3000   devpolaris/orders-api:local
9f64237b93a3cbca1be2e98494961b3f11a2a40a869be4ef3bca5dff3491e8c7

$ docker logs --tail 5 orders-api-dev
[2026-05-07T10:18:04.110Z] booting devpolaris-orders-api
[2026-05-07T10:18:04.191Z] loaded route /health
[2026-05-07T10:18:04.195Z] orders-api listening on port 3000
```

Detached mode returns the container ID instead of keeping the process in front of you.
The logs are still available because Docker captures stdout and stderr from the main
process. That is why containerized applications should write operational logs to stdout
and stderr, not only to files inside the container.

Use `docker logs -f orders-api-dev` when you want to follow new lines as they arrive.
Use `--since 10m` or `--tail 100` when the container has been running for a while and
you need a smaller window.

## Ports and Environment Variables

Port publishing and environment variables are where many first Docker mistakes happen.
Docker does not automatically expose every application port on your laptop. The
application can listen on port 3000 inside the container forever, and your host still
cannot reach it unless you publish that port.

```bash
$ docker run -d --name orders-api-hidden -e PORT=3000 devpolaris/orders-api:local
3143cc0d7046f6e16d345677f51a0d1b27aa4189d28ec815538f804281198913

$ curl http://localhost:3000/health
curl: (7) Failed to connect to localhost port 3000 after 0 ms: Connection refused

$ docker ps --filter name=orders-api-hidden
CONTAINER ID   IMAGE                         STATUS         PORTS      NAMES
3143cc0d7046   devpolaris/orders-api:local    Up 8 seconds   3000/tcp   orders-api-hidden
```

The `PORTS` column shows `3000/tcp` without a host mapping. That means the image
declares or the process uses port 3000, but Docker is not forwarding host traffic to it.
Remove that container and run again with `-p 8080:3000`.

Environment variables are similar. Docker only passes what you provide, plus values
baked into the image with `ENV`. If `DATABASE_URL` is missing, the container may start
and then fail during its first database query. Prefer explicit variables in development
scripts so a working shell session on one laptop does not hide missing configuration.

## Shell Access and One-Off Commands

Sometimes the process is running, but you need to inspect the container from the inside.
`docker exec` starts a new command inside an existing running container. It does not
rebuild the image and it does not restart the main process.

```bash
$ docker exec -it orders-api-dev sh
/app $ pwd
/app
/app $ ls -1
package.json
server.js
src
/app $ printenv PORT
3000
```

The `-it` flags allocate an interactive terminal. Many slim images include `sh` but not
`bash`. If `bash` fails, try `sh` before assuming the container is broken.

One-off commands are also useful without an interactive shell. Checking the environment
from inside the same container can prove whether the application received the value you
expected.

```bash
$ docker exec orders-api-dev node -e "console.log(process.env.DATABASE_URL)"
postgres://orders:orders@host.docker.internal:5432/orders_dev
```

Use `docker exec` for inspection, not for permanent fixes. If you install a package or
edit a file inside a running container, that change lives in that container only.
Recreate the container and the change disappears. Permanent changes belong in the
Dockerfile, Compose file, or source repository.

## Stopping, Removing, and Cleaning Up

Containers have a lifecycle. They are created, started, stopped, and removed. A stopped
container is not using CPU, but it still uses local disk for metadata, logs, and its
writable layer. A development machine that runs experiments for weeks can accumulate a
surprising amount of stopped state.

```bash
$ docker stop orders-api-dev
orders-api-dev

$ docker rm orders-api-dev
orders-api-dev

$ docker ps -a --filter name=orders-api-dev
CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS    PORTS     NAMES
```

`docker stop` asks the main process to exit. `docker rm` removes the stopped container
record. If the container was started with `--rm`, Docker handles the removal after the
process exits.

Images are separate from containers. Removing a container does not remove the image it
came from. That separation is useful because you can delete failed runs without forcing
the next run to pull or rebuild the image.

```bash
$ docker container prune
WARNING! This will remove all stopped containers.
Are you sure you want to continue? [y/N] y
Deleted Containers:
5a19d0a45d21
3143cc0d7046

Total reclaimed space: 18.4MB
```

Use prune commands deliberately. They are helpful in local development and risky if you
do not know what state a stopped container still holds. Named volumes are not removed by
`docker container prune`, which protects database data by default.

## Failure Path: It Exited Immediately

A common first failure is a container that appears, exits, and leaves no service to
call. The right diagnostic path is short: check `docker ps -a`, read the exit code,
inspect logs, then inspect configuration.

```bash
$ docker run -d --name orders-api-broken devpolaris/orders-api:local
8f547c1e35cc01e8d3eb514312c2ae0f81f054de69110d88d59146d10ab9b242

$ docker ps -a --filter name=orders-api-broken
CONTAINER ID   IMAGE                         STATUS                     NAMES
8f547c1e35cc   devpolaris/orders-api:local    Exited (1) 4 seconds ago   orders-api-broken

$ docker logs orders-api-broken
[2026-05-07T10:31:44.120Z] booting devpolaris-orders-api
[2026-05-07T10:31:44.139Z] fatal: DATABASE_URL is required
```

The fix direction is clear. The image probably started correctly, but the container
environment was incomplete. Run again with `-e DATABASE_URL=...`, or move the service
into a Compose file where required variables are easier to review.

If logs are empty, inspect the container command and image metadata. A missing
executable, wrong working directory, or incompatible CPU architecture can fail before
your application logger starts.

```bash
$ docker inspect orders-api-broken --format "{{.Config.WorkingDir}} {{.Config.Cmd}} {{.State.ExitCode}}"
/app [node server.js] 1
```

This command prints the working directory, configured command, and exit code from Docker
metadata. If the command is wrong, fix the Dockerfile. If the command is right and logs
show missing configuration, fix the run command or Compose file.

## Tradeoffs for Daily CLI Work

The CLI gives you direct control, which is perfect while learning and debugging. The
tradeoff is that long `docker run` commands are easy to forget and hard to review. Once
a service needs a database, a cache, a network, and several environment variables,
Compose becomes the better daily interface.

For one container, the CLI is fast and explicit. For a team workflow, write down
repeatable choices. A `Makefile` target, npm script, or Compose file prevents every
developer from inventing their own port mapping and environment shape.

| Task | CLI command | What to inspect |
|------|-------------|-----------------|
| Start one API | `docker run` | Container status and logs |
| Check service output | `docker logs` | Startup line, errors, request IDs |
| Enter running container | `docker exec -it ... sh` | Files, env vars, network checks |
| Stop cleanly | `docker stop` | Exit code and final logs |
| Remove old state | `docker rm` or `docker container prune` | What state will disappear |

> Treat the CLI as your microscope first. Once the command becomes a habit for the whole team, turn it into a file.

The next article moves from running an existing image to writing the Dockerfile that
creates one.

---

**References**

- [Docker Docs: Running containers](https://docs.docker.com/engine/containers/run/) - Official reference for container execution, options, networking, mounts, and exit codes.
- [Docker Docs: docker container run](https://docs.docker.com/reference/cli/docker/container/run/) - CLI reference for the command used to create and start containers.
- [Docker Docs: View container logs](https://docs.docker.com/engine/logging/) - Explains how Docker captures stdout and stderr for `docker logs`.
