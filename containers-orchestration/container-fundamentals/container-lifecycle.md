---
title: "Container Lifecycle"
description: "Follow a container from create to run, stop, restart, inspect, and remove so lifecycle bugs become easier to diagnose."
overview: "Containers have a lifecycle just like ordinary processes, but the runtime records extra state around creation, logs, exit codes, restart policy, and removal. Knowing those states helps you debug without guessing."
tags: ["lifecycle", "run", "stop", "logs", "exit-codes"]
order: 4
id: article-containers-orchestration-container-fundamentals-container-lifecycle
---

## Table of Contents

1. [A Container Is Born Before It Is Useful](#a-container-is-born-before-it-is-useful)
2. [Create and Run](#create-and-run)
3. [Started, Running, and Exited](#started-running-and-exited)
4. [Logs and Exit Codes](#logs-and-exit-codes)
5. [Stop, Kill, and Signals](#stop-kill-and-signals)
6. [Restart Policies](#restart-policies)
7. [Remove and Recreate](#remove-and-recreate)
8. [Failure Mode: Restart Loop](#failure-mode-restart-loop)
9. [Lifecycle Habits Before Orchestration](#lifecycle-habits-before-orchestration)
10. [A Small Local Runbook](#a-small-local-runbook)

## A Container Is Born Before It Is Useful

A container lifecycle is the set of states a container moves through from creation to removal. The image is the package. The container is the runtime object created from that package. That runtime object can be created, started, stopped, restarted, inspected, and removed.

This matters because a container can exist without doing useful work. It can be created but not started. It can be stopped but still present on disk. It can be restarting so quickly that it appears and disappears between commands. If you only know `docker run`, these states look like noise. If you know the lifecycle, they become evidence.

For `devpolaris-orders-api`, the lifecycle tells you whether the API is down because no container exists, because the process exited, because the runtime is restarting it, or because traffic cannot reach it even though it is running.

```mermaid
stateDiagram-v2
    [*] --> Created
    Created --> Running: start
    Running --> Exited: process exits
    Running --> Stopping: stop signal
    Stopping --> Exited: graceful shutdown
    Running --> Exited: kill
    Exited --> Running: restart
    Exited --> Removed: rm
    Removed --> [*]
```

The diagram is simpler than real runtime internals, but it gives you the operational map you need for first debugging.

## Create and Run

`docker create` creates a container object without starting it. `docker start` starts an existing container. `docker run` combines pull if needed, create, and start into one common command.

```bash
$ docker create --name orders-api \
  -p 8080:3000 \
  -e DATABASE_URL=postgres://orders:secret@db.internal:5432/orders \
  ghcr.io/devpolaris/orders-api:1.4.0

f2b3c44a6b2b6f1e9d...

$ docker ps -a --filter name=orders-api
CONTAINER ID   IMAGE                                 STATUS    NAMES
f2b3c44a6b2b   ghcr.io/devpolaris/orders-api:1.4.0   Created   orders-api
```

That container has settings, but no application process is running yet. Starting it moves the lifecycle forward:

```bash
$ docker start orders-api
orders-api

$ docker ps --filter name=orders-api
CONTAINER ID   IMAGE                                 STATUS         PORTS
f2b3c44a6b2b   ghcr.io/devpolaris/orders-api:1.4.0   Up 4 seconds   0.0.0.0:8080->3000/tcp
```

Most local workflows use `docker run` because it is shorter. Understanding `create` still helps when you read runtime output or orchestration events. Platforms often separate "prepared container" from "started process" internally.

## Started, Running, and Exited

A running container has a live main process. An exited container is a runtime record whose process has finished. Docker keeps the record so you can inspect logs, exit codes, and metadata after the process stops.

This is why `docker ps` and `docker ps -a` differ:

```bash
$ docker ps
CONTAINER ID   IMAGE     STATUS    NAMES

$ docker ps -a --filter name=orders-api
CONTAINER ID   IMAGE                                 STATUS                     NAMES
f2b3c44a6b2b   ghcr.io/devpolaris/orders-api:1.4.0   Exited (1) 18 seconds ago  orders-api
```

The default `docker ps` shows only running containers. The `-a` flag includes stopped containers. If a service "does not exist" in the first command, always check the second command before assuming it was never created.

Exit status has the same meaning as Linux process exit status. `0` means the process reported success. Non-zero means failure. For long-running APIs, any exit usually deserves investigation unless the shutdown was intentional.

## Logs and Exit Codes

Logs are attached to the container lifecycle because stdout and stderr from the main process are captured by the runtime. That is why containerized apps should write operational logs to stdout and stderr instead of only writing to files inside the container filesystem.

```bash
$ docker logs orders-api
Error: Missing required environment variable DATABASE_URL
    at readConfig (/app/server.js:14:11)
    at Object.<anonymous> (/app/server.js:22:16)

$ docker inspect orders-api --format '{{.State.Status}} {{.State.ExitCode}}'
exited 1
```

Together, those two commands tell a compact story. The process exited. It returned failure. The log says startup configuration was missing. You do not need to rebuild the image until you know whether the runtime config was correct.

If the process exits with `0` immediately, the image might be running a one-shot command instead of a server:

```bash
$ docker logs orders-api
devpolaris-orders-api migration check complete

$ docker inspect orders-api --format '{{.State.Status}} {{.State.ExitCode}}'
exited 0
```

That is not a crash. It is the command completing. The fix is to check the image command or the command override used at runtime.

## Stop, Kill, and Signals

Stopping a container asks the main process to shut down gracefully. In Docker, `docker stop` sends a termination signal first, then waits for a grace period, then forcefully kills the process if it is still running. A signal is a small message the operating system sends to a process, such as "please terminate" or "interrupt."

```bash
$ docker stop orders-api
orders-api

$ docker ps -a --filter name=orders-api
CONTAINER ID   STATUS                      NAMES
f2b3c44a6b2b   Exited (143) 4 seconds ago   orders-api
```

Exit code `143` often means the process ended after receiving signal 15, `SIGTERM`. For a web API, graceful handling means the app stops accepting new work, finishes in-flight requests if it can, closes database connections, and exits.

`docker kill` skips the polite request and sends a kill signal by default. Use it when the process is stuck and `stop` cannot finish. Do not make it the normal shutdown path for stateful services, because the process loses the chance to clean up.

## Restart Policies

A restart policy tells the runtime what to do after the main process exits. For a local service, `--restart unless-stopped` or `--restart on-failure` can be useful. In orchestrators, restart behavior is usually managed by the platform.

```bash
$ docker run -d --name orders-api \
  --restart on-failure:3 \
  -p 8080:3000 \
  ghcr.io/devpolaris/orders-api:1.4.0

9b0f2a33a2e1
```

This asks Docker to restart the container when the process fails, up to three times. Restart policies are helpful for transient failures. They are harmful when they hide a deterministic startup error. A missing env var will not become present on the third restart.

You can inspect restart behavior:

```bash
$ docker inspect orders-api --format 'restart={{.HostConfig.RestartPolicy.Name}} count={{.RestartCount}}'
restart=on-failure count=3
```

If the restart count keeps rising, your next job is to read the logs from the failed starts, not to add a larger restart limit.

## Remove and Recreate

Removing a container deletes the runtime object and its writable layer. It does not delete the image. This difference is important when you are cleaning up local experiments or forcing a container to pick up changed runtime settings.

```bash
$ docker rm orders-api
orders-api

$ docker image ls ghcr.io/devpolaris/orders-api
REPOSITORY                       TAG       IMAGE ID       SIZE
ghcr.io/devpolaris/orders-api    1.4.0     8f4b1c2a90fd   184MB
```

If you change the port mapping or environment variables for a container created with Docker, you usually remove and recreate the container. Starting the old container again reuses the old settings.

```bash
$ docker rm -f orders-api
orders-api

$ docker run -d --name orders-api \
  -p 8081:3000 \
  -e DATABASE_URL=postgres://orders:secret@db.internal:5432/orders \
  ghcr.io/devpolaris/orders-api:1.4.0
```

That recreate habit becomes central in Kubernetes. You rarely edit a live container. You change the desired configuration and let the platform create replacement containers.

## Failure Mode: Restart Loop

A restart loop happens when the runtime starts a container, the process exits, the restart policy starts it again, and the same failure repeats. From outside, the service may look unstable or permanently down.

```bash
$ docker ps --filter name=orders-api
CONTAINER ID   IMAGE                                 STATUS                         NAMES
9b0f2a33a2e1   ghcr.io/devpolaris/orders-api:1.4.0   Restarting (1) 8 seconds ago   orders-api

$ docker logs --tail 20 orders-api
Error: Missing required environment variable DATABASE_URL
    at readConfig (/app/server.js:14:11)
```

The status tells you the lifecycle shape. The logs tell you the cause. The fix is not "restart it again." The runtime is already doing that. The fix is to provide the missing runtime input and recreate the container with the corrected configuration.

```bash
$ docker rm -f orders-api
orders-api

$ docker run -d --name orders-api \
  --restart on-failure:3 \
  -p 8080:3000 \
  -e DATABASE_URL=postgres://orders:secret@db.internal:5432/orders \
  ghcr.io/devpolaris/orders-api:1.4.0

$ docker ps --filter name=orders-api
CONTAINER ID   STATUS         PORTS
7a9cde21b641   Up 6 seconds   0.0.0.0:8080->3000/tcp
```

The diagnostic lesson is portable. Kubernetes will call this kind of pattern `CrashLoopBackOff`, but the underlying story is the same: a process starts, exits, and is restarted repeatedly.

## Lifecycle Habits Before Orchestration

Good container operators ask lifecycle questions in a consistent order. Does the container exist? Is the main process running? If it exited, what was the exit code? What do the logs say? Was a restart policy involved? Were the runtime settings correct when the container was created?

Those questions scale from one Docker container to a fleet of orchestrated workloads. Kubernetes adds richer event streams and controllers, but it still has to start processes, watch exits, collect logs, and replace failed containers. A clear lifecycle model keeps you from treating every unavailable service as the same kind of failure.

For `devpolaris-orders-api`, the practical rule is to preserve evidence before deleting things. Read `docker ps -a`, `docker logs`, and `docker inspect` before `docker rm -f`. Once the container is gone, some local evidence goes with it.

## A Small Local Runbook

A runbook is a short set of steps for a repeated operational task. For container lifecycle work, a good beginner runbook should gather evidence first, make one change, then verify the result. It should not start by deleting the container because deletion can remove the exact evidence you need.

Here is a compact local runbook for `devpolaris-orders-api` when someone says the container is down:

```text
1. List both running and stopped containers.
   docker ps -a --filter name=orders-api

2. Read recent logs.
   docker logs --tail 80 orders-api

3. Inspect lifecycle state.
   docker inspect orders-api --format '{{.State.Status}} {{.State.ExitCode}} {{.RestartCount}}'

4. Inspect runtime settings.
   docker inspect orders-api --format 'image={{.Config.Image}} ports={{json .NetworkSettings.Ports}}'

5. If config is wrong, remove and recreate with the corrected run command.

6. Verify with a health request.
   curl -i http://localhost:8080/health
```

The runbook uses commands from earlier sections, but now they are arranged as an operating habit. Step 1 separates "not running" from "never created." Step 2 gives the application a chance to explain itself. Step 3 records the lifecycle state. Step 4 checks the settings that were fixed at creation time.

A healthy final result should show both runtime state and user-visible behavior:

```bash
$ docker ps --filter name=orders-api
CONTAINER ID   STATUS          PORTS
2fd91c64aa10   Up 18 seconds   0.0.0.0:8080->3000/tcp

$ curl -i http://localhost:8080/health
HTTP/1.1 200 OK
content-type: application/json

{"status":"ok","service":"orders-api"}
```

The runbook is intentionally small. Bigger platforms add more commands, but the first principle stays the same: preserve evidence, identify the lifecycle state, correct the boundary that is actually wrong, and verify from the caller's point of view.

You can keep a tiny lifecycle reference beside the runbook:

| State or symptom | First command | Likely next question |
|------------------|---------------|----------------------|
| No output from `docker ps` | `docker ps -a` | Did the process exit already? |
| `Exited (1)` | `docker logs` | What did the app report before exit? |
| `Exited (0)` | `docker inspect ... Cmd` | Did the container run a short command? |
| `Restarting` | `docker logs --tail 50` | Is the same startup error repeating? |
| `Up` but no traffic | `docker port` or `docker inspect` | Was the port published correctly? |
| Old settings still used | `docker inspect` | Was the container recreated after config changed? |

That table is not a replacement for understanding the lifecycle. It is a reminder that each state suggests a different next question. If you train yourself to ask the state question first, the container stops feeling like a black box and starts behaving like a normal process with a useful runtime record.

When you later read orchestrator events, map them back to this local lifecycle. "Created" means the runtime prepared the container. "Started" means the process began. "Terminated" means the main process ended and reported a reason. The names vary between tools, but the same process story is underneath.

For now, practice with one local container until the states feel familiar:

```bash
$ docker run --name lifecycle-demo alpine sh -c 'echo hello; exit 7'
hello

$ docker inspect lifecycle-demo --format '{{.State.Status}} {{.State.ExitCode}}'
exited 7
```

That tiny command exits on purpose. It gives you a safe way to see how process exit becomes container state.

---

**References**

- [Docker CLI Reference: docker container run](https://docs.docker.com/reference/cli/docker/container/run/) - Documents container creation, detached mode, restart behavior, and run options.
- [Docker CLI Reference: docker container](https://docs.docker.com/reference/cli/docker/container/) - Lists lifecycle commands such as start, stop, restart, logs, inspect, wait, and rm.
- [Docker Docs: Running containers](https://docs.docker.com/engine/containers/run/) - Explains how Docker starts isolated container processes.
- [OCI Runtime Specification](https://github.com/opencontainers/runtime-spec) - Defines the runtime lifecycle and state model behind OCI-compatible containers.
