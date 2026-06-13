---
title: "Running Containers"
description: "Follow what happens when Docker turns an image into a container with a main process, writable layer, name, ports, and lifecycle state."
overview: "After Docker builds an image, the next question is what changes when that image becomes a container. This article traces one `docker run` from image defaults to a live process so Docker CLI output reads like evidence instead of a command list."
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

1. [The Pieces Docker Combines](#the-pieces-docker-combines)
2. [Images Become Container Records](#images-become-container-records)
3. [The Main Process Decides the Lifetime](#the-main-process-decides-the-lifetime)
4. [Foreground, Detached, and Interactive Runs](#foreground-detached-and-interactive-runs)
5. [Names and IDs Give You Handles](#names-and-ids-give-you-handles)
6. [Ports Connect the Host to the Container](#ports-connect-the-host-to-the-container)
7. [The Writable Layer Holds Runtime Changes](#the-writable-layer-holds-runtime-changes)
8. [Stopping and Removing Containers](#stopping-and-removing-containers)
9. [A Practical First Run](#a-practical-first-run)
10. [Where Container Runs Usually Break](#where-container-runs-usually-break)
11. [What's Next](#whats-next)

## The Pieces Docker Combines
<!-- section-summary: A container run combines an image, runtime options, one main process, and a saved container record. -->

Let's say we are pairing on a small **ticketing API** for an events company. The team already built an image called `devpolaris/tickets-api:local`, and that image contains the application files, installed packages, and a default command that starts the server. The image can sit idle on your laptop all day because it is only the packaged starting point.

The interesting part starts when Docker turns that image into a **container**. A container is one running or previously run instance of an image, with its own configuration, name or ID, writable layer, network settings, log stream, and process state. Docker runs the process on the host, while giving that process an isolated filesystem, networking view, and process tree.

There are four pieces to keep in your head as we go. The **image** gives Docker the filesystem and defaults. The **run options** give Docker the local choices for this run, such as name, ports, environment variables, and volume mounts. The **container record** stores what Docker created. The **main process** decides whether the container stays alive.

That structure helps us connect the rest of the article. First we will create the container record, then watch the main process, then talk about terminal attachment, names, ports, storage, cleanup, and the common places where a run fails.

## Images Become Container Records
<!-- section-summary: Docker creates a container record from the image plus run options before it starts the process. -->

The most common command for this transition is `docker run`. Docker's own CLI reference describes it as the command that runs a command in a new container, and the full shape is `docker run [OPTIONS] IMAGE [COMMAND] [ARG...]`. That shape tells you a lot: options belong to the container setup, the image chooses the package, and the optional command at the end can override what the image would normally run.

Here is a plain first run for the ticketing API. The name gives us a stable handle for every command we run after Docker creates the container:

```bash
docker run --name tickets-api devpolaris/tickets-api:local
```

Docker looks up the image, reads its default configuration, creates a container record, prepares a writable layer on top of the image filesystem, attaches the container to the default network, and starts the configured command. The command might come from the image's `CMD`, from `ENTRYPOINT` plus `CMD`, or from a command you put after the image name. We will go deeper on command resolution in a later article.

That container record matters because it survives after the process exits. If the app crashes during startup, Docker can still show the exit code, logs, command, environment, port bindings, and name. So a failed run can still give you useful evidence instead of disappearing from the machine.

## The Main Process Decides the Lifetime
<!-- section-summary: Docker marks the container running while the main process is alive and exited after that process ends. -->

The **main process** is the command Docker starts as the center of the container. In a web API image, it might be `node dist/server.js`. In a Postgres image, it is the database server process. In a small utility image, it might be a command that prints one report and exits.

Docker watches that process. While the process runs, the container shows as `Up`. When the process exits, Docker records the exit code and the container moves to `Exited`. A web server usually should stay `Up`, while a one-off command can exit successfully and still have done exactly what you asked.

You can see this difference with two runs from the same image. The package stays the same, and the process Docker starts changes:

```bash
docker run --name tickets-api devpolaris/tickets-api:local
docker run --rm devpolaris/tickets-api:local node --version
```

The first command uses the image default and should keep the API running. The second command asks the image to run `node --version`, so the process prints the version and completes. Docker treated both commands normally; the difference came from the process you asked Docker to start.

The exit code gives the next clue after a confusing run. Exit code `0` means the process reported success. A non-zero code means the process reported failure, and the application logs usually explain the reason. Docker records the status, while the application decides what the exit code means.

## Foreground, Detached, and Interactive Runs
<!-- section-summary: Foreground, detached, and interactive modes change the terminal connection around the same container process. -->

By default, `docker run` connects your terminal to the container's standard output and standard error. This mode feels direct because you see startup logs immediately. It is useful during the first few runs of a new image, especially when the app might fail because an environment variable or database URL is missing.

Detached mode uses `-d` or `--detach`. Docker starts the same kind of container process, prints a container ID, and gives your prompt back. The API keeps running in the background, and you can use other commands to read logs, inspect settings, or stop it.

```bash
docker run -d --name tickets-api devpolaris/tickets-api:local
docker logs tickets-api
docker ps
```

Interactive mode uses `-i` to keep standard input open and `-t` to allocate a terminal. You will often see them together as `-it` when you want a shell inside a small troubleshooting container. The image still needs a shell program such as `sh` or `bash` for that command to work.

```bash
docker run --rm -it alpine sh
```

These modes answer different pairing needs. Foreground mode lets the junior developer see the app's first words. Detached mode lets the senior keep the local service running while testing from a browser. Interactive mode gives both people a temporary shell when they need to examine a filesystem or try a command inside the image.

## Names and IDs Give You Handles
<!-- section-summary: Container names and IDs give Docker commands a stable way to refer to one created run. -->

Every container gets a long **container ID**. Docker also gives it a generated name if you skip `--name`, and a generated name can be funny or memorable by accident. In real work, a deliberate name saves time because the whole team can type the same handle in examples, scripts, and troubleshooting notes.

```bash
docker run -d --name tickets-api devpolaris/tickets-api:local
docker logs tickets-api
docker stop tickets-api
docker rm tickets-api
```

Names must be unique among existing containers on the same Docker host. If you run the same command again while `tickets-api` still exists, Docker will complain about a name conflict. That message means Docker still has a container record with that name, either running or stopped.

`docker ps` shows running containers. `docker ps -a` includes stopped containers too, which makes it the better command after a run failed quickly.

```console
CONTAINER ID   IMAGE                          COMMAND                  STATUS                     NAMES
1b7f2b6c9a11   devpolaris/tickets-api:local   "node dist/server.js"    Up 15 seconds              tickets-api
88d7c92a4f30   devpolaris/tickets-api:local   "node dist/server.js"    Exited (1) 3 minutes ago   tickets-api-old
```

That table ties the name, image, command, and state together. If the name conflict comes from a stopped container, you can inspect it for evidence before removing it. If the conflict comes from a running container, you can decide whether to keep using it or stop it first.

## Ports Connect the Host to the Container
<!-- section-summary: Port publishing maps a host port to a container port so tools outside the container can reach the service. -->

Our ticketing API listens on port `3000` inside the container. That internal port belongs to the container's network view. Your browser on the host needs a published port if you want to open `http://localhost:8080` and reach the API.

Port publishing uses `-p HOST_PORT:CONTAINER_PORT`. The left side belongs to your host machine, and the right side belongs to the container:

```bash
docker run -d \
  --name tickets-api \
  -p 8080:3000 \
  devpolaris/tickets-api:local
```

Now the host port `8080` forwards traffic to port `3000` inside the container. If the app logs say `Listening on 3000`, that message describes the container side. The browser reaches it through the host side, so the URL becomes `http://localhost:8080`.

This is a common source of first-week Docker confusion. `EXPOSE 3000` in a Dockerfile documents the intended container port and helps tools understand the image. A local `docker run` still needs `-p` when you want host traffic to reach that port.

Port conflicts happen on the host side. If another process already uses `8080`, Docker reports a bind failure for that host port. You can choose a different host port, such as `8081:3000`, while the app inside the container continues to listen on `3000`.

## The Writable Layer Holds Runtime Changes
<!-- section-summary: Each container gets its own writable layer, so runtime file changes belong to that container record. -->

Docker images use layers, and Docker adds a **writable layer** for each container. That layer stores file changes made while that container exists. If the ticketing API writes `/tmp/startup.json`, downloads a cache file, or creates a local SQLite database during a test run, those changes belong to that container's writable layer.

The image stays reusable. A second container created from `devpolaris/tickets-api:local` starts from the same image layers and gets a separate writable layer. This explains why removing a container can remove runtime changes while leaving the image available for future runs.

This detail matters in production habits too. Application logs should go to standard output and standard error so Docker can collect them. Durable data should go into a volume, managed database, object store, or another persistence path. The writable layer suits temporary runtime files, and it gives poor durability for data that the business cares about.

You will see this when a teammate says, "I wrote a file inside the container, then it vanished after I removed the container." Docker behaved according to the container lifecycle. The file lived in that one container record rather than in the image or in a volume.

## Stopping and Removing Containers
<!-- section-summary: Stopping asks the main process to exit, while removing deletes the stopped container record and writable layer. -->

Stopping and removing answer two different questions. **Stopping** changes the process state by asking the main process to exit. **Removing** deletes the container record after the process has stopped, including the writable layer that belonged to that container.

```bash
docker stop tickets-api
docker rm tickets-api
```

`docker stop` sends a termination signal to the main process, waits for a grace period, and then Docker can force the process if it keeps running. That graceful path matters for web servers because the process may need a moment to stop accepting requests, flush logs, or close database connections.

`--rm` gives you automatic cleanup for short-lived containers. It matches commands where you only care about the result:

```bash
docker run --rm devpolaris/tickets-api:local node --version
```

That flag works well for one-off checks, test commands, and quick shells. For a container you want to inspect after a crash, a named container that you keep gives you a record to read later. The cleanup choice should match the kind of evidence you need.

## A Practical First Run
<!-- section-summary: A useful first run names the container, publishes the port, passes required environment, and leaves evidence behind. -->

Now we can put the pieces together for the ticketing API. The app needs a database URL, listens on port `3000`, and should keep running while we test it from the browser. A practical first run gives the container a name, passes required environment, publishes a host port, and runs detached after we trust the startup path.

```bash
docker run -d \
  --name tickets-api \
  -e NODE_ENV=development \
  -e DATABASE_URL=postgres://tickets:tickets@host.docker.internal:5432/tickets \
  -p 8080:3000 \
  devpolaris/tickets-api:local
```

Then the first checks read the evidence Docker collected. Each command asks a different question about the same container record:

```bash
docker ps
docker logs --tail 50 tickets-api
docker inspect tickets-api
```

`docker ps` tells us whether the main process stayed alive. `docker logs` tells us what the process wrote during startup. `docker inspect` shows the configuration Docker used, including environment, command, port bindings, mounts, and state.

This path gives the junior developer a reliable rhythm. First identify the container record. Then check the process state. Then read logs. Then inspect configuration only where the logs or state point you.

## Where Container Runs Usually Break
<!-- section-summary: Most first-run problems come from the command, environment, name, port binding, or persistence expectation. -->

The first failure category is the **main command**. The image can exist and the container can still exit immediately because the command finished, crashed, or pointed at a missing file. `docker ps -a` plus `docker logs` usually separates a completed one-off command from a broken server startup.

The second category is **runtime configuration**. The ticketing API might require `DATABASE_URL`, `JWT_SECRET`, or `NODE_ENV`. If those values arrive through `-e` flags, an env file, or Compose, Docker passes them at container creation time. Rebuilding the image will rarely fix a missing runtime value.

The third category is **port publishing**. The app may listen correctly on `3000` inside the container while the host lacks a published port or uses the wrong host port. `docker ps` shows the port mapping, and `docker inspect` shows the full binding details.

The fourth category is **name and cleanup**. A stopped container can keep the name you want, and a removed container takes its writable layer with it. That is why a deliberate cleanup command belongs at the end of a troubleshooting session, after you have collected the state, logs, and configuration you need.

## What's Next

You now have the first runtime picture: Docker turns an image plus run options into a container record, starts one main process, records the state, and gives you handles for logs, ports, and cleanup. That is enough to understand what Docker created during a normal `docker run`.

The next article uses those same pieces for debugging. We will follow container state, logs, inspect output, and `exec` access in a steady order so a failed or strange container gives useful evidence before anyone starts guessing.

---

**References**

- [Docker run CLI reference](https://docs.docker.com/reference/cli/docker/container/run/) - Documents `docker run`, detached mode, port publishing, environment flags, restart flags, and command override shape.
- [Running containers](https://docs.docker.com/engine/containers/run/) - Explains that Docker runs isolated processes and shows the `docker run [OPTIONS] IMAGE [COMMAND] [ARG...]` form.
- [Docker create CLI reference](https://docs.docker.com/reference/cli/docker/container/create/) - Explains how Docker creates a writable container layer over an image before a container starts.
- [Docker ps CLI reference](https://docs.docker.com/reference/cli/docker/container/ls/) - Documents that `docker ps` shows running containers and `docker ps -a` includes stopped containers.
- [Docker logs CLI reference](https://docs.docker.com/reference/cli/docker/container/logs/) - Documents how Docker retrieves logs from a container.
- [Docker stop CLI reference](https://docs.docker.com/reference/cli/docker/container/stop/) - Documents stop signals and the grace period before Docker forcefully stops a container.
