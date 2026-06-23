---
title: "Running Containers"
description: "Learn how Docker turns an image into a live container with a saved record, main process, run options, ports, writable layer, and cleanup path."
overview: "This first Docker Containers article follows a local ticketing API and Postgres from image to running containers. You will see what `docker run` creates, why the main process controls lifetime, how foreground, detached, and interactive runs differ, and how teams check names, ports, writable layers, stops, and cleanup."
tags: ["docker", "containers", "runtime", "cli"]
order: 1
id: article-containers-orchestration-docker-docker-cli-basics
aliases:
  - docker-cli-basics
  - containers-orchestration/docker/docker-cli-basics.md
  - container-lifecycle
  - article-containers-orchestration-container-fundamentals-container-lifecycle
  - containers-orchestration/container-fundamentals/container-lifecycle.md
---

## Table of Contents

1. [The Run Story](#the-run-story)
2. [Images Turn Into Container Records](#images-turn-into-container-records)
3. [The Main Process Controls the Lifetime](#the-main-process-controls-the-lifetime)
4. [Run Options Shape This Container](#run-options-shape-this-container)
5. [Foreground, Detached, and Interactive Runs](#foreground-detached-and-interactive-runs)
6. [Names and IDs Give You Handles](#names-and-ids-give-you-handles)
7. [Ports Publish the App to Your Host](#ports-publish-the-app-to-your-host)
8. [The Writable Layer Holds Runtime Files](#the-writable-layer-holds-runtime-files)
9. [Stopping and Removing Containers](#stopping-and-removing-containers)
10. [A Practical First Run With API and Postgres](#a-practical-first-run-with-api-and-postgres)
11. [What's Next](#whats-next)

## The Run Story
<!-- section-summary: Running a container combines an image, run options, one main process, and a saved container record. -->

Let's pair on one small service for the whole article: a **ticketing API** for an internal support team. The API image is `devpolaris/tickets-api:local`, the API listens on port `3000`, and the full local setup uses Postgres for tickets, customers, and assignment history.

This setup gives us enough real-world shape without turning the first Docker lesson into a full deployment system. A local developer still needs the same pieces a production team cares about: a process that keeps running, configuration through environment variables, a port that the host can reach, logs that explain startup, and cleanup that protects useful data.

| Piece | Simple meaning | In the ticketing API run |
|---|---|---|
| **Image** | The packaged filesystem and defaults Docker starts from. | `devpolaris/tickets-api:local` contains the app code, runtime, and default start command. |
| **Run options** | The choices for this one container creation. | `--name`, `-e`, `--network`, `-p`, `-d`, and `-v` describe this local run. |
| **Container record** | The saved object Docker creates from the image plus options. | `tickets-api` keeps its ID, state, logs, port bindings, and writable layer. |
| **Main process** | The process Docker watches as the container's lifetime. | The API server process keeps the container running while it serves requests. |

The sections follow those pieces in the order you usually meet them on a real machine. First Docker creates a record, then the main process decides whether the record stays `Up` or moves to `Exited`, then the run options explain names, ports, storage, and cleanup.

![Docker image to container record infographic showing image defaults, run options, a tickets-api container record with logs, ports, and writable layer, and the main Node process](/content-assets/articles/article-containers-orchestration-docker-docker-cli-basics/image-to-container-record.png)

*This picture keeps the four moving parts in one view: the image gives the package, run options shape this run, the container record stores evidence, and the main process decides whether Docker shows `Up` or `Exited`.*

## Images Turn Into Container Records
<!-- section-summary: Docker creates a container record from the image and run options, then starts the configured command. -->

An **image** is the reusable package: application files, installed dependencies, metadata, and default command settings. A **container record** is the concrete thing Docker creates from that image for one run, including the generated ID, chosen name, config, network settings, writable layer, and current state.

The Docker CLI shows the shape of this operation in the `docker run` form: `docker run [OPTIONS] IMAGE [COMMAND] [ARG...]`. The options describe how Docker should create this container, the image tells Docker what package to use, and the optional command at the end can replace the image's default command for this run.

That command shape is worth slowing down for one moment. Docker reads everything before the image name as container setup, then treats the image name and optional command as the process plan.

```bash
docker run --name tickets-api devpolaris/tickets-api:local
```

That command asks Docker to create one container record named `tickets-api` from the API image, then start the image's default command. Docker also adds a writable layer for this container, attaches default networking, prepares the log stream, and records the process state.

The useful part is that the record still gives you evidence after a short run or a crash. These checks ask Docker what record exists and what state Docker recorded for it:

```bash
docker ps -a --filter name=tickets-api
docker inspect tickets-api --format '{{.Id}} {{.Config.Image}} {{.State.Status}} {{.State.ExitCode}}'
```

`docker ps -a` proves the container record exists even if the process already stopped. `docker inspect` proves Docker kept the image name, container ID, current status, and last exit code as structured data instead of leaving you with only terminal output.

## The Main Process Controls the Lifetime
<!-- section-summary: Docker marks a container running while the main process runs and records an exit code when that process ends. -->

The **main process** is the command Docker starts as the center of the container. For the ticketing API, that might be `node dist/server.js`; for Postgres, it is the database server; for a utility image, it might be a command that prints a result and exits.

Docker watches that one main process. While the process runs, the container status shows `Up`; when the process exits, Docker stores the exit code and the status changes to `Exited`.

This small command uses the same API image for a short one-off process. It keeps the package the same and changes only the command Docker starts:

```bash
docker run --rm devpolaris/tickets-api:local node --version
```

The command proves that a container can finish successfully because the requested process finished successfully. The `--rm` option asks Docker to remove the container record after the process exits, which fits a quick version check because we only care about the printed result.

A server run has a different expectation because the API should keep listening for HTTP requests. In that case, a fast exit usually tells you to check configuration and logs:

```bash
docker run -d --name tickets-api devpolaris/tickets-api:local
docker ps --filter name=tickets-api
docker logs --tail 30 tickets-api
```

`docker ps` proves whether the main process stayed alive. `docker logs` proves what the process wrote during startup, so a missing `DATABASE_URL`, failed migration, or port binding inside the app has a place to explain itself.

## Run Options Shape This Container
<!-- section-summary: Run options describe the local choices Docker should attach to one created container. -->

A **run option** is a setting you pass to Docker when it creates a container. The image supplies defaults, and the run options supply local decisions such as the container name, environment variables, host port, network, cleanup behavior, and background mode.

Here is the API command once we include the choices a developer needs for a real local service. We will run the full database setup later, and this command shows the shape we are building toward:

```bash
docker run -d \
  --name tickets-api \
  --network tickets-net \
  -e NODE_ENV=development \
  -e DATABASE_URL=postgres://tickets:tickets@tickets-db:5432/tickets \
  -p 8080:3000 \
  devpolaris/tickets-api:local
```

Each option answers one setup question. `-d` asks Docker to run in the background, `--name` gives the record a stable handle, `--network` lets the API reach the database container by name, `-e` passes runtime configuration, and `-p` publishes the API to the host.

Those choices belong to the container record Docker creates. If the API needs a different `DATABASE_URL` or a different port mapping, the normal local workflow is to stop and remove the old container record, then create a new one with the corrected options.

## Foreground, Detached, and Interactive Runs
<!-- section-summary: Foreground, detached, and interactive modes change how your terminal connects to the same kind of container process. -->

The first connection choice is **foreground mode**, which is the default for `docker run`. Docker connects your terminal to the container's output streams, so startup logs appear directly in front of you.

Foreground mode works well while you are learning a new image. If the API exits because it fails to reach Postgres, the error appears immediately in your terminal, and you can fix the missing option before creating a long-running background container.

The second choice is **detached mode**, written as `-d` or `--detach`. Docker starts the container, prints the container ID, and returns your shell prompt while the process keeps running in the background.

Detached mode is the normal choice after the startup path is clear. You keep the API running while your terminal stays available for logs, `curl`, tests, and cleanup commands.

```bash
docker run -d --name tickets-api devpolaris/tickets-api:local
docker logs --follow tickets-api
```

The first command proves detached mode creates the same kind of container record while freeing your terminal. The second command proves the logs still exist in Docker, and `--follow` lets you watch new log lines after the background process starts.

The third choice is **interactive mode**, usually written as `-it`. The `-i` flag keeps standard input open, and `-t` gives the session a terminal, which helps when you need a shell inside an image.

Interactive mode is handy when the question is about the image contents rather than the long-running API process. You can inspect installed files or try commands from the same filesystem the app uses.

```bash
docker run --rm -it --entrypoint sh devpolaris/tickets-api:local
```

That command proves the image filesystem can start with a shell process instead of the normal API command, as long as the image actually contains `sh`. This is useful for checking files, installed binaries, and environment behavior during development, while the next article will cover `docker exec` for entering a container that is already running.

## Names and IDs Give You Handles
<!-- section-summary: Container names and IDs let Docker commands refer to one specific created run. -->

Every container receives a long **container ID**, and Docker also assigns a name. A generated name works for quick experiments, while a deliberate name like `tickets-api` makes commands, notes, scripts, and pairing sessions easier to follow.

```bash
docker ps --filter name=tickets-api
docker logs tickets-api
docker stop tickets-api
docker rm tickets-api
```

Those commands prove that the name is more than a label in the table. Docker accepts the name anywhere it needs to identify that container record, so you can read logs, stop the process, and remove the stopped record without copying the long ID.

Names must stay unique on one Docker host. A name conflict usually means a previous `tickets-api` container still exists, and `docker ps -a` shows both running and stopped records:

```bash
docker ps -a --filter name=tickets-api
```

That command proves whether the conflict comes from a container still running or a stopped record waiting for inspection. If the previous run failed, keeping the record for one more minute gives you time to read logs and inspect configuration before cleanup.

## Ports Publish the App to Your Host
<!-- section-summary: Port publishing maps a host port to a container port so tools outside the container can reach the service. -->

A **container port** is the port the process listens on inside the container's network view. A **host port** is the port your laptop, browser, `curl`, or another host-side tool uses to reach that container from outside.

Our API listens on `3000` inside the container. Publishing `8080:3000` means the host receives traffic on port `8080` and Docker forwards it to port `3000` in the container.

That left-right order is the part worth remembering because people often swap it during their first week with Docker. The host port sits on the left, and the container port sits on the right:

```bash
docker run -d \
  --name tickets-api \
  -p 8080:3000 \
  devpolaris/tickets-api:local
```

The left side of `-p 8080:3000` belongs to your host, and the right side belongs to the container. If the app logs say `Listening on 3000`, the browser still uses the host side, so the local URL is `http://localhost:8080`.

Two quick checks prove the mapping from both directions. One asks Docker what it published, and the other sends a real request through that published port:

```bash
docker port tickets-api
curl http://localhost:8080/health
```

`docker port` proves what Docker published for that container record. `curl` proves a real host-side request can reach the API through the published port.

Dockerfiles often include `EXPOSE 3000`, which documents the intended container port for the image. Local `docker run` still needs `-p` when you want host traffic to reach that process, because publishing is a run-time decision tied to this container.

![Docker port and storage boundaries infographic showing host localhost 8080 reaching tickets-api container port 3000, temporary writable layer files, and tickets-db using a durable volume](/content-assets/articles/article-containers-orchestration-docker-docker-cli-basics/port-storage-boundaries.png)

*This image separates the two boundaries beginners usually mix together: traffic crosses from host port `8080` to container port `3000`, while durable Postgres data belongs in a volume instead of the API container writable layer.*

## The Writable Layer Holds Runtime Files
<!-- section-summary: Each container gets its own writable layer for file changes made while that container exists. -->

Docker image layers are reusable and read-only, and Docker adds a **writable layer** for each container. When a process writes a file inside the container filesystem, Docker stores that change in the writable layer for that specific container record.

A tiny Alpine container can show the lifecycle without involving the API. It writes one file, survives a stop and start, and then disappears when the container record is removed:

```bash
docker run -d --name scratch-note alpine:3.20 sh -c 'echo ready > /tmp/container-note && sleep 300'
docker exec scratch-note cat /tmp/container-note
docker stop scratch-note
docker start scratch-note
docker exec scratch-note cat /tmp/container-note
docker rm -f scratch-note
```

The first `cat` proves the process wrote a file into the container filesystem. The second `cat` proves the same writable layer survives a stop and start of the same container record, while `docker rm -f` removes the container record and its writable layer.

This detail matters for the ticketing stack. Temporary files, caches, and generated scratch data can live in the writable layer, while Postgres data needs a **volume** because tickets are business data and should survive container replacement.

```bash
docker volume create tickets-db-data
docker run -d \
  --name tickets-db \
  -e POSTGRES_USER=tickets \
  -e POSTGRES_PASSWORD=tickets \
  -e POSTGRES_DB=tickets \
  -v tickets-db-data:/var/lib/postgresql/data \
  postgres:16
```

The environment variables give the official Postgres image the initial database, user, and password it needs for first startup. The volume gives Docker a persistence path outside one container's writable layer. Real teams use this separation all the time: containers can come and go, while durable state lives in a volume, managed database, object store, or another system built for persistence.

## Stopping and Removing Containers
<!-- section-summary: Stopping asks the main process to exit, and removing deletes the stopped container record plus its writable layer. -->

**Stopping** changes the process state. When you run `docker stop`, Docker sends a termination signal to the main process, waits for a grace period, and then can force the process to exit if it keeps running.

```bash
docker stop tickets-api
docker ps -a --filter name=tickets-api
```

Those commands prove the record still exists after the process stops. That stopped record still has a name, status, exit code, logs, configuration, and writable layer, which is exactly why you can inspect a failed container after the app exits.

**Removing** deletes the stopped container record. This is the cleanup step for an old run after you have collected the logs and state you need:

```bash
docker rm tickets-api
docker ps -a --filter name=tickets-api
```

The second command proves Docker no longer has a container record with that name. Normal `docker rm` also removes the container's writable layer, while named volumes such as `tickets-db-data` stay available until you remove the volume itself.

For one-off commands, `--rm` can clean up automatically. This is a good fit when the command output and exit code are the only things you need after the process ends:

```bash
docker run --rm devpolaris/tickets-api:local npm test
```

That pattern fits quick checks because the result lives in the command output and exit code. For a server that fails during startup, keeping the record until you inspect it gives you better evidence than immediate cleanup.

## A Practical First Run With API and Postgres
<!-- section-summary: A practical first run names both containers, gives Postgres durable storage, publishes the API, and checks evidence in a steady order. -->

Now let's put the pieces together as a small local stack. The goal is simple: run Postgres, run the ticketing API against that database, publish the API on the host, prove the service responds, and clean up only after we know what Docker created.

First create the shared network and the database volume. These two resources prepare the local environment before either service container starts:

```bash
docker network create tickets-net
docker volume create tickets-db-data
```

The network gives the API a way to reach Postgres by the container name `tickets-db`. The volume gives Postgres a durable place for database files, so the database files stay in the volume when you replace the database container.

Next start Postgres. This container is the stateful part of the local stack, so its command carries database settings and the volume mount:

```bash
docker run -d \
  --name tickets-db \
  --network tickets-net \
  -e POSTGRES_USER=tickets \
  -e POSTGRES_PASSWORD=tickets \
  -e POSTGRES_DB=tickets \
  -v tickets-db-data:/var/lib/postgresql/data \
  postgres:16
```

This command proves a real service container usually needs more than an image name. The name gives other containers a handle, the network allows container-to-container traffic, the environment variables initialize the database, and the volume stores data outside the writable layer.

Then start the API. This container is the part your browser reaches, so its command carries the database URL and the published port:

```bash
docker run -d \
  --name tickets-api \
  --network tickets-net \
  -e NODE_ENV=development \
  -e DATABASE_URL=postgres://tickets:tickets@tickets-db:5432/tickets \
  -p 8080:3000 \
  devpolaris/tickets-api:local
```

This command connects the earlier concepts in one place. Docker creates the `tickets-api` record from the image, starts the API as the main process, attaches it to the same network as Postgres, passes the database URL as runtime configuration, and publishes container port `3000` on host port `8080`.

The first checks should read Docker's evidence before changing anything. This keeps the troubleshooting order steady: state first, logs second, network and port details third:

```bash
docker ps --filter "name=tickets-"
docker logs --tail 50 tickets-db
docker logs --tail 50 tickets-api
docker port tickets-api
curl http://localhost:8080/health
docker inspect tickets-api --format '{{json .NetworkSettings.Networks}}'
```

`docker ps` proves both main processes are still running. The log commands prove what each service wrote during startup, `docker port` proves the host-to-container mapping, `curl` proves the host can reach the API, and `docker inspect` proves the API joined the expected network.

The cleanup at the end should match what you want to keep. Service containers and the shared network can go away, while the database volume deserves an explicit choice:

```bash
docker stop tickets-api tickets-db
docker rm tickets-api tickets-db
docker network rm tickets-net
```

Those commands remove the service containers and the network. The `tickets-db-data` volume stays behind on purpose, and a separate `docker volume rm tickets-db-data` only belongs in a throwaway local reset where losing the database contents is acceptable.

After this sequence is familiar, most teams move the same choices into Docker Compose for local development and into an orchestrator for shared environments. The important part for this article is that those higher-level tools still make the same container decisions: image, options, process, network, ports, storage, and lifecycle.

![Docker first run stack summary infographic showing tickets-net, tickets-db, tickets-api, logs, curl health check, and cleanup steps with keep evidence before cleanup](/content-assets/articles/article-containers-orchestration-docker-docker-cli-basics/first-run-stack-summary.png)

*The full local run is a small stack, not a single magic command: create the network and volume, start the database, start the API, read evidence, test `/health`, and only then clean up what you no longer need.*

## What's Next

You now have the first runtime picture: Docker creates a container record from an image and run options, starts one main process, records state, and gives you handles for logs, ports, files, and cleanup. That is enough to understand what Docker created during a normal `docker run`.

The next article follows the same containers after something goes wrong. We will use state, logs, inspect output, and `exec` access in a steady debugging path, so a strange container gives useful evidence before anyone starts guessing.

---

**References**

- [Docker run CLI reference](https://docs.docker.com/reference/cli/docker/container/run/) - Documents `docker run`, detached mode, environment flags, port publishing, `--rm`, and command override shape.
- [Running containers](https://docs.docker.com/engine/containers/run/) - Explains the general `docker run [OPTIONS] IMAGE [COMMAND] [ARG...]` form and image references.
- [Docker create CLI reference](https://docs.docker.com/reference/cli/docker/container/create/) - Explains that Docker creates a writable container layer over an image when creating a container.
- [Docker ps CLI reference](https://docs.docker.com/reference/cli/docker/container/ls/) - Documents that `docker ps` shows running containers by default and `docker ps -a` includes stopped containers.
- [Docker logs CLI reference](https://docs.docker.com/reference/cli/docker/container/logs/) - Documents retrieving logs from a container.
- [Docker inspect CLI reference](https://docs.docker.com/reference/cli/docker/container/inspect/) - Documents detailed inspection output for one or more containers.
- [Docker port CLI reference](https://docs.docker.com/reference/cli/docker/container/port/) - Documents listing published port mappings for a container.
- [Docker stop CLI reference](https://docs.docker.com/reference/cli/docker/container/stop/) - Documents stop signals and the grace period before Docker forcefully stops a container.
- [Docker rm CLI reference](https://docs.docker.com/reference/cli/docker/container/rm/) - Documents removing containers and volume behavior.
- [Docker storage overview](https://docs.docker.com/engine/storage/) - Explains writable container layers and why data in the container layer disappears after container destruction.
- [Docker volumes](https://docs.docker.com/engine/storage/volumes/) - Explains volume lifecycle and why volumes preserve data beyond one container's lifecycle.
- [Docker network create CLI reference](https://docs.docker.com/reference/cli/docker/network/create/) - Documents Docker networks and container communication through a shared network.
- [Postgres Docker Official Image](https://hub.docker.com/_/postgres) - Documents the `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and data directory behavior used in the local database examples.
