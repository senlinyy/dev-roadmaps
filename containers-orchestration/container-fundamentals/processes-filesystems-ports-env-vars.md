---
title: "Processes, Filesystems, Ports, and Env Vars"
description: "Understand the four runtime surfaces you inspect when a containerized service starts, crashes, or cannot receive traffic."
overview: "A container is easiest to debug when you separate the running process, its filesystem view, its network ports, and its environment variables. Those four surfaces explain most first container failures."
tags: ["processes", "filesystem", "ports", "env"]
order: 3
id: article-containers-orchestration-container-fundamentals-processes-filesystems-ports-env-vars
---

## Table of Contents

1. [Four Surfaces, One Container](#four-surfaces-one-container)
2. [The Main Process Owns the Container](#the-main-process-owns-the-container)
3. [The Filesystem View Starts from the Image](#the-filesystem-view-starts-from-the-image)
4. [Ports Need Two Sides](#ports-need-two-sides)
5. [Environment Variables Are Runtime Inputs](#environment-variables-are-runtime-inputs)
6. [A Request Walkthrough](#a-request-walkthrough)
7. [Failure Mode: Healthy Process, Unreachable Service](#failure-mode-healthy-process-unreachable-service)
8. [A Practical Debugging Order](#a-practical-debugging-order)
9. [Mounts and Temporary Files](#mounts-and-temporary-files)
10. [What to Record in an Incident Note](#what-to-record-in-an-incident-note)

## Four Surfaces, One Container

When a containerized service fails, beginners often reach for one large idea: "Docker is broken." That is rarely the useful explanation. A container gives you four practical surfaces to inspect: the process, the filesystem, the ports, and the environment variables. Each surface answers a different question.

The process surface asks whether the application is running and what exit code it returned. The filesystem surface asks whether the files the process expects are present at the paths it uses. The port surface asks where the process listens and how traffic reaches it from outside. The environment surface asks which configuration values were provided at startup.

`devpolaris-orders-api` is a good example because it touches all four surfaces. It runs `node server.js`, reads files under `/app`, listens on port `3000`, and requires `DATABASE_URL`. A failure in any one surface can produce the same user symptom: the API is unavailable.

```mermaid
flowchart TD
    A["Container"] --> B["Process<br/>node server.js"]
    A --> C["Filesystem<br/>/app, /etc, /tmp"]
    A --> D["Ports<br/>3000 inside, 8080 outside"]
    A --> E["Env vars<br/>DATABASE_URL, NODE_ENV"]
```

Separating these surfaces gives you a diagnostic map. You do not need to understand every runtime detail before you can ask a useful next question.

## The Main Process Owns the Container

A container is alive because its main process is alive. In Docker terms, the main process is the command started by `CMD` or `ENTRYPOINT`, plus any command override passed to `docker run`. If that process exits, the container stops. If it exits with code `0`, the container completed successfully. If it exits with a non-zero code, the process reported failure.

For an API, the main process is usually a long-running server:

```dockerfile
CMD ["node", "server.js"]
```

When you run the image, Docker starts that command as the container's main process:

```bash
$ docker run --name orders-api ghcr.io/devpolaris/orders-api:1.4.0
orders-api listening on 0.0.0.0:3000
```

If `server.js` throws during startup, the container exits. That is not a Docker crash. It is the application process doing exactly what any Linux process does when startup fails.

```bash
$ docker ps -a --filter name=orders-api
CONTAINER ID   IMAGE                                 STATUS                      NAMES
5e91c2a44d10   ghcr.io/devpolaris/orders-api:1.4.0   Exited (1) 9 seconds ago    orders-api

$ docker logs orders-api
Error: Cannot find module '/app/server.js'
```

The status line points at the process surface. The logs point at the filesystem surface. The next check is not a port scan; the process never stayed alive long enough to listen.

## The Filesystem View Starts from the Image

Inside a container, paths are resolved against the container's filesystem view. The process sees `/app/server.js` because the image build copied that file there, not because the host has the same path. This is why a container can run on a host that has no Node project checkout at all.

You can inspect the view from inside a running container:

```bash
$ docker exec orders-api pwd
/app

$ docker exec orders-api ls -la /app
total 156
drwxr-xr-x  1 node node   4096 May  7 09:20 .
drwxr-xr-x  1 root root   4096 May  7 09:20 ..
drwxr-xr-x 96 node node   4096 May  7 09:20 node_modules
-rw-r--r--  1 node node 128442 May  7 09:19 package-lock.json
-rw-r--r--  1 node node    612 May  7 09:19 package.json
-rw-r--r--  1 node node   2410 May  7 09:20 server.js
```

That output tells you what the process can see. If the app tries to open `/config/orders.json` and that path is missing, the fix might be to copy the file into the image, mount it at runtime, or change the app to read configuration from the environment. The right answer depends on whether the file is static application content, environment-specific configuration, or secret material.

The writable layer sits above the image filesystem. It lets the process create temporary files, but it is not a good home for durable business data. An invoice PDF generated by `orders-api` should go to object storage or a mounted volume, not only to `/tmp` inside one container.

## Ports Need Two Sides

Ports are confusing because there is an inside and an outside. The application listens on a container port. The host can publish a host port that forwards traffic to that container port. Those numbers can be the same, but they do not have to be.

For `devpolaris-orders-api`, the app listens on `3000` inside the container:

```bash
$ docker run --name orders-api -p 8080:3000 \
  -e DATABASE_URL=postgres://orders:secret@db.internal:5432/orders \
  ghcr.io/devpolaris/orders-api:1.4.0

orders-api listening on 0.0.0.0:3000
```

The `-p 8080:3000` mapping means host port `8080` forwards to container port `3000`. A request from the host should use `8080`:

```bash
$ curl -i http://localhost:8080/health
HTTP/1.1 200 OK
content-type: application/json

{"status":"ok","service":"orders-api"}
```

If you call `localhost:3000` on the host, you are not automatically calling the container. You are asking the host for something listening on host port `3000`. That may be nothing, or it may be another process entirely.

`EXPOSE 3000` in a Dockerfile documents the intended container port, but it does not publish the port by itself. You still need runtime configuration, such as `-p`, Docker Compose ports, or a Kubernetes Service later in the roadmap.

## Environment Variables Are Runtime Inputs

Environment variables are key-value strings passed into a process when it starts. In Node, they appear in `process.env`. In Python, they appear through `os.environ`. Containers use env vars heavily because they let the same image run in different environments without rebuilding.

For `devpolaris-orders-api`, `DATABASE_URL` should not be baked into the image. Staging and production use different databases. Local development may use a database on the host or in another container. The image should contain code and defaults that are safe to share, while runtime supplies environment-specific values.

```bash
$ docker run --rm \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgres://orders:secret@db.internal:5432/orders \
  ghcr.io/devpolaris/orders-api:1.4.0 env | sort

DATABASE_URL=postgres://orders:secret@db.internal:5432/orders
NODE_ENV=production
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
```

That command is only for demonstration. In real operations, avoid printing secrets into terminal history, logs, screenshots, or tickets. The useful idea is that environment variables are attached to the container process at start time. Changing an env var usually means recreating the container so the process starts with the new value.

## A Request Walkthrough

Now connect the surfaces with one request. The host receives traffic on port `8080`. Docker forwards it to container port `3000`. The Node process reads the request, may call the database using `DATABASE_URL`, and writes logs to stdout.

```text
Browser or curl
  -> localhost:8080 on host
  -> container port 3000
  -> node server.js inside /app
  -> DATABASE_URL for database calls
  -> stdout logs collected by runtime
```

A healthy request leaves evidence at more than one point:

```bash
$ curl -s http://localhost:8080/health
{"status":"ok","service":"orders-api"}

$ docker logs --tail 3 orders-api
orders-api listening on 0.0.0.0:3000
GET /health 200 3ms
```

If the request fails, the place where evidence disappears tells you where to inspect next. No container in `docker ps` points to process startup. A running container with no port mapping points to runtime networking. A `500` in logs points to application behavior or an external dependency.

## Failure Mode: Healthy Process, Unreachable Service

Here is a failure that frustrates new container users because the process is healthy:

```bash
$ docker run --name orders-api \
  -e DATABASE_URL=postgres://orders:secret@db.internal:5432/orders \
  ghcr.io/devpolaris/orders-api:1.4.0

orders-api listening on 127.0.0.1:3000
```

The app is listening on `127.0.0.1` inside the container. That address is loopback for the container itself. Even if you publish a host port, Docker cannot forward external traffic to a server that only accepts connections from the container's own loopback interface. Server apps in containers usually need to listen on `0.0.0.0`, which means all interfaces in that network namespace.

The diagnostic path looks like this:

```bash
$ docker ps --filter name=orders-api
CONTAINER ID   IMAGE                                 PORTS
a44d2f61c9be   ghcr.io/devpolaris/orders-api:1.4.0   0.0.0.0:8080->3000/tcp

$ curl -i http://localhost:8080/health
curl: (52) Empty reply from server

$ docker logs orders-api
orders-api listening on 127.0.0.1:3000
```

The fix is in application startup configuration. For many Node servers, that means binding to `0.0.0.0`:

```js
server.listen(3000, "0.0.0.0", () => {
  console.log("orders-api listening on 0.0.0.0:3000");
});
```

The port mapping was present. The process was running. The missing piece was the address the process used inside the container network namespace.

## A Practical Debugging Order

When you debug a containerized API, use an order that follows the path of execution. First ask whether a container exists and whether its main process is running. Then read logs, because application startup errors usually explain themselves better than runtime metadata does.

Next inspect configuration. Confirm the command, working directory, environment variables, and port mapping. Then test from the host to the published port. After that, test external dependencies such as the database, queue, or object storage from the same network context where the container runs.

```bash
$ docker ps -a --filter name=orders-api
$ docker logs --tail 50 orders-api
$ docker inspect orders-api --format 'cmd={{json .Config.Cmd}} ports={{json .NetworkSettings.Ports}}'
$ curl -i http://localhost:8080/health
```

This order keeps you from chasing the wrong surface. A missing file will not be fixed by changing a port. A missing env var will not be fixed by rebuilding the same image. A host port conflict will not be fixed by editing application code.

## Mounts and Temporary Files

The filesystem surface has one more detail worth learning early: not every path inside a container comes from the image. A runtime can mount a host directory, a named volume, or a secret file into the container. A mount replaces or overlays part of the container filesystem view at a chosen path.

For `devpolaris-orders-api`, a mount might provide a local development config file:

```bash
$ docker run --rm \
  -v "$PWD/config/local.json:/app/config/local.json:ro" \
  -e DATABASE_URL=postgres://orders:secret@host.docker.internal:5432/orders \
  ghcr.io/devpolaris/orders-api:1.4.0
```

The `:ro` suffix means read-only. That is useful when the container should read a file but not modify the host copy. Mounts solve real local-development problems, but they weaken portability if the service quietly depends on a path that only exists on one developer's laptop.

A good diagnostic question is: "Does this file come from the image or from a mount?" You can inspect mounts on a running container:

```bash
$ docker inspect orders-api --format '{{json .Mounts}}'
[{"Type":"bind","Source":"/Users/senlin/orders/config/local.json","Destination":"/app/config/local.json","Mode":"ro"}]
```

Temporary files need a different habit. If the app writes cache files to `/tmp`, that is usually fine. If it writes generated invoices to `/tmp` and expects them to exist after replacement, the design is fragile. Containers are easiest to operate when important state is outside the container and temporary state can be discarded.

## What to Record in an Incident Note

When a container issue affects a teammate or environment, record evidence in the same four-surface model. This helps the next person avoid repeating your search. You do not need a long report. A short note with concrete commands and results is enough.

```text
Incident note: orders-api unreachable in staging

Process:
  docker ps showed container running for 12m
  docker logs showed "listening on 127.0.0.1:3000"

Filesystem:
  /app/server.js present
  no missing module errors

Ports:
  runtime mapping was 0.0.0.0:8080->3000/tcp
  curl localhost:8080 returned empty reply

Env vars:
  DATABASE_URL and NODE_ENV were present

Fix:
  changed server bind address to 0.0.0.0
  rebuilt image and recreated container
```

That note is valuable because it separates what was checked from what was assumed. It also teaches the team that a running process and a published port are not enough if the application binds to the wrong address inside the container.

Use the same structure for other failures. Missing env var, missing file, bad port mapping, and unreachable database all become easier to discuss when the evidence is attached to the surface where it belongs.

A final useful habit is to write down what you did not check. If you proved the process, filesystem, and port mapping were healthy but did not test database reachability, say that. Good incident notes are not only about certainty. They also show the next person where the remaining uncertainty lives.

For `devpolaris-orders-api`, a follow-up note might say:

```text
Remaining checks:
  Database DNS from container network was not tested.
  Credentials were present but not validated against Postgres.
  Host firewall was not checked because localhost health succeeded.
```

That small honesty prevents a teammate from assuming the whole path was proven. It also keeps the debugging model teachable: every surface you check reduces the search space, and every surface you skip remains a candidate.

If you need one memory aid, use the path of a request:

```text
process started
  -> files available
  -> env vars loaded
  -> app listening inside container
  -> host port published
  -> caller receives response
```

The order is not perfect for every incident, but it is a useful first pass. It keeps you close to evidence and away from broad guesses.

---

**References**

- [Docker Docs: Running containers](https://docs.docker.com/engine/containers/run/) - Documents container isolation, filesystem, networking, and environment variable behavior during `docker run`.
- [Docker CLI Reference: docker container run](https://docs.docker.com/reference/cli/docker/container/run/) - Provides the exact command options for environment variables, port publishing, commands, and lifecycle behavior.
- [Kubernetes Docs: Container environment](https://kubernetes.io/docs/concepts/containers/container-environment/) - Shows the same environment variable model in Kubernetes containers.
- [OCI Runtime Specification](https://github.com/opencontainers/runtime-spec) - Defines the runtime configuration model used by OCI-compatible runtimes.
