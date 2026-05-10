---
title: "Debugging Docker Containers"
description: "Diagnose Docker container failures by reading state, logs, metadata, network paths, mounts, users, and health checks in the right order."
overview: "Docker debugging is a sequence of evidence checks. Start with state and logs, then inspect metadata, network paths, files, users, and health signals until the failure has a specific cause."
tags: ["docker", "debugging", "logs", "inspect"]
order: 7
id: article-containers-orchestration-docker-debugging-docker-containers
---

## Table of Contents

1. [Start with the Container State](#start-with-the-container-state)
2. [Logs Before Shells](#logs-before-shells)
3. [Inspect Metadata](#inspect-metadata)
4. [Exec Into the Right Place](#exec-into-the-right-place)
5. [Check Ports and Networks](#check-ports-and-networks)
6. [Check Files, Mounts, and Users](#check-files-mounts-and-users)
7. [Health Checks and Exit Codes](#health-checks-and-exit-codes)
8. [Failure Path: 500s After a Clean Startup](#failure-path-500s-after-a-clean-startup)
9. [A Repeatable Debugging Runbook](#a-repeatable-debugging-runbook)
10. [Practice Loop for Debugging Notes](#practice-loop-for-debugging-notes)

## Start with the Container State

A Docker problem usually appears as one sentence: the container does not work. That
sentence is too broad to fix. The first job is to classify the failure. Is the container
missing, created but not running, restarting repeatedly, running but unhealthy, or
healthy but returning bad application responses?

`devpolaris-orders-api` gives us a practical debugging target. It can fail during
startup because an environment variable is missing. It can run but fail requests because
the database URL points at the wrong host. It can return 404 because the wrong image tag
was run. Each failure needs a different next command.

```bash
$ docker ps -a --filter name=orders-api
CONTAINER ID   IMAGE                         STATUS                            PORTS     NAMES
73f8a00ef9e3   devpolaris/orders-api:local    Restarting (1) 12 seconds ago              orders-api
```

The status tells you this is not a browser problem yet. Docker is trying to restart the
process, and the process exits with code 1. Logs are the next step.

## Logs Before Shells

Read logs before opening a shell. A stopped or restarting container may not stay alive
long enough for `docker exec`, but Docker still keeps stdout and stderr from previous
attempts.

```bash
$ docker logs --tail 30 orders-api
[2026-05-07T12:49:11.032Z] booting devpolaris-orders-api
[2026-05-07T12:49:11.044Z] config PORT=3000 LOG_LEVEL=debug
[2026-05-07T12:49:11.045Z] fatal: DATABASE_URL is required
```

That log gives a specific fix direction: pass `DATABASE_URL` at runtime. Rebuilding the
image would waste time because the failure is runtime configuration.

Use timestamps when several containers are involved.

```bash
$ docker logs --since 15m --timestamps orders-api
2026-05-07T12:49:11.045871Z fatal: DATABASE_URL is required
```

If logs are empty, the process may fail before the application logger starts. Then
inspect metadata: command, entrypoint, working directory, image, mounts, and exit code.

## Inspect Metadata

Docker metadata often explains what actually ran, which can differ from what you thought
you ran. `docker inspect` returns a large JSON document. Use formats when you need a few
fields.

```bash
$ docker inspect orders-api --format "image={{.Config.Image}} cmd={{.Config.Cmd}} workdir={{.Config.WorkingDir}} exit={{.State.ExitCode}}"
image=devpolaris/orders-api:local cmd=[node dist/server.js] workdir=/app exit=1
```

If the command points at `dist/server.js` and the image only contains `server.js`, the
failure is an image build or Dockerfile mismatch. If the command is right but exit code
is 1, logs usually explain the application-level reason.

Inspect environment carefully, but avoid printing real secrets into shared logs or
screenshots. For local training data, a database URL is fine. For production, check
variable presence without dumping secret values.

```bash
$ docker inspect orders-api --format "{{range .Config.Env}}{{println .}}{{end}}" | sort
DATABASE_URL=postgres://orders:orders@db:5432/orders_dev
LOG_LEVEL=debug
NODE_ENV=production
PORT=3000
```

## Exec Into the Right Place

Use `docker exec` when the container is running and you need the view from inside. This
is useful for checking files, environment, DNS, process state, and application-local
commands.

```bash
$ docker exec -it orders-api sh
/app $ ls -lah
total 44K
drwxr-xr-x    1 node     node        4.0K May  7 12:55 .
drwxr-xr-x    1 root     root        4.0K May  7 12:55 ..
drwxr-xr-x    3 node     node        4.0K May  7 12:55 dist
-rw-r--r--    1 node     node         612 May  7 12:55 package.json
/app $ node -e "console.log(process.cwd())"
/app
```

If `docker exec -it orders-api bash` fails, try `sh`. Many minimal images do not include
Bash. If the image has no shell at all, use Docker Debug where available or rebuild a
temporary diagnostic image for local investigation.

Do not make manual fixes inside the container and call the incident done. Edits inside a
running container are not the source of truth. Once you find the cause, move the fix to
source code, Dockerfile, Compose, runtime configuration, or deployment configuration.

## Check Ports and Networks

Network debugging starts by asking where the caller is. A browser on the host, the API
container, and the database container each have a different meaning for `localhost`.

```bash
$ docker ps --filter name=orders-api
CONTAINER ID   IMAGE                         STATUS       PORTS                    NAMES
a91300fd10db   devpolaris/orders-api:local    Up 2 min     127.0.0.1:8080->3000/tcp orders-api

$ curl -i http://localhost:8080/health
HTTP/1.1 200 OK
content-type: application/json

{"status":"ok"}
```

If the API cannot reach the database, exec from the API container and check DNS or TCP
connectivity with whatever tools exist in the image.

```bash
$ docker exec orders-api node -e "require('dns').lookup('db', console.log)"
null 172.22.0.2 4
```

If DNS fails, inspect the network and service name. If DNS works but connection fails,
inspect the database port, credentials, readiness, and whether the database is listening
inside its container.

## Check Files, Mounts, and Users

File and mount bugs often look like application bugs. A container can start with the
right image and wrong files because a bind mount hides image contents. A process can
fail to write because it runs as a non-root user against root-owned files.

```bash
$ docker inspect orders-api --format "{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}}{{println}}{{end}}"
bind /Users/senlin/dev/devpolaris-orders-api -> /app
volume docker_orders-node-modules -> /app/node_modules
```

That output says `/app` comes from the host, while `/app/node_modules` comes from a
named volume. If the source tree on the host lacks a generated file, the container lacks
it too.

```bash
$ docker exec orders-api id
uid=1000(node) gid=1000(node) groups=1000(node)

$ docker exec orders-api sh -c "touch /app/tmp/probe"
touch: /app/tmp/probe: Permission denied
```

Now inspect ownership of the target path. The fix might be `COPY --chown` in the
Dockerfile, a corrected bind-mount user, or choosing a writable runtime path such as
`/tmp` for temporary files.

## Health Checks and Exit Codes

Health checks add another signal. A container can be running while Docker marks it
unhealthy because the health command fails. That distinction is useful: the process
exists, but the service is not meeting its readiness contract.

```bash
$ docker ps --filter name=orders-api
CONTAINER ID   IMAGE                         STATUS                    PORTS                    NAMES
67ff4d23ed97   devpolaris/orders-api:local    Up 1 min (unhealthy)      127.0.0.1:8080->3000/tcp orders-api

$ docker inspect orders-api --format "{{json .State.Health}}"
{"Status":"unhealthy","FailingStreak":3,"Log":[{"ExitCode":1,"Output":"wget: server returned error: HTTP/1.1 500 Internal Server Error"}]}
```

The health output says Docker reached the HTTP endpoint, but the endpoint returned 500.
That is different from a port mapping failure. Check application logs around the same
timestamp.

Exit codes also matter. A container with `Exited (127)` often means the command was not
found. `Exited (1)` usually means the program ran and reported a general failure.

## Failure Path: 500s After a Clean Startup

Here is a complete diagnostic path for a realistic issue. The container starts cleanly,
`/health` returns 200, but `POST /orders` returns 500.

```bash
$ curl -i http://localhost:8080/orders -d '{"sku":"course-linux","quantity":1}'   -H "content-type: application/json"
HTTP/1.1 500 Internal Server Error
content-type: application/json

{"error":"order_create_failed","request_id":"req_921d"}
```

Use the request ID to search logs.

```bash
$ docker logs orders-api | grep req_921d
[2026-05-07T13:12:45.301Z] request_id=req_921d route=POST /orders
[2026-05-07T13:12:45.314Z] request_id=req_921d db error relation "orders" does not exist
[2026-05-07T13:12:45.315Z] request_id=req_921d response=500
```

The network is fine because the database responded. The failure is schema state. Check
whether migrations ran.

```bash
$ docker exec orders-api npm run migrate:status

Migration                    Status
202605061100_create_orders   pending
202605061230_add_status      pending
```

The fix direction is to run migrations against the same database URL the API uses, then
retry the request.

## A Repeatable Debugging Runbook

A repeatable debugging path saves time because it keeps you from jumping to rebuilds or
shell sessions too early.

1. Check container state with `docker ps -a`.
2. Read recent logs with `docker logs --tail 100`.
3. Inspect command, image, env presence, mounts, and exit code with `docker inspect`.
4. Check published ports when the caller is outside Docker.
5. Check service names and DNS when the caller is another container.
6. Use `docker exec` only when the container is running and inside evidence is needed.
7. Move the final fix into source-controlled configuration, not a manual container edit.

| Signal | Current evidence | Next action |
|--------|------------------|-------------|
| State | Running, unhealthy | Inspect health log |
| Logs | `/health` returns 500 | Search application error |
| Network | Port 8080 published | Browser path is valid |
| Database | DNS resolves `db` | Check migrations and credentials |
| Files | Bind mount at `/app` | Confirm generated files exist |

Good Docker debugging is not a collection of clever commands. It is an order of
questions that turns "the container is broken" into one specific failing boundary.

## Practice Loop for Debugging Notes

A debugging note should be short enough that another engineer can trust
it. Capture the state, the strongest evidence, the suspected boundary,
and the durable fix. Do not paste the whole terminal session.

```text
Service: devpolaris-orders-api
Symptom: POST /orders returns 500, /health returns 200
State: container running, port 127.0.0.1:8080->3000/tcp
Evidence: request_id=req_921d logs show relation "orders" does not exist
Boundary: application reached database, schema is missing
Fix: run migrations in the API container against DATABASE_URL used by the service
Verification: POST /orders returned 201 with id ord_1027
```

That note is useful because it rules out several wrong branches. The
port is published. The API is running. The database is reachable. The
missing schema is the first proven failure.

Practice writing one note for each failure you intentionally create:
missing `DATABASE_URL`, wrong database hostname, missing bind-mounted
file, unhealthy health check, and wrong image tag. The command sequence
will feel repetitive, which is the point. Good debugging becomes
repeatable when the evidence format is repeatable.

A good note also says what you did not change. That protects the next investigation from chasing edits that never happened.

```text
No image rebuild during investigation.
No manual package install inside the container.
Only runtime change was DATABASE_URL in compose.yaml.
```

That small audit trail helps the team trust the final fix.

---

**References**

- [Docker Docs: View container logs](https://docs.docker.com/engine/logging/) - Official guide to how Docker captures container stdout and stderr.
- [Docker Docs: docker container inspect](https://docs.docker.com/reference/cli/docker/container/inspect/) - CLI reference for inspecting container metadata, mounts, networks, and health state.
- [Docker Docs: docker exec](https://docs.docker.com/reference/cli/docker/container/exec/) - Official reference for running commands in existing containers.
- [Docker Docs: Docker Debug](https://docs.docker.com/reference/cli/docker/debug/) - Official reference for debugging images that lack shell tools.
