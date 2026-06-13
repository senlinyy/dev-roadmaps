---
title: "Debugging Docker"
description: "Diagnose Docker failures by following container state, logs, image metadata, runtime configuration, networking, storage, health checks, and Compose configuration."
overview: "A Docker stack fails at a specific boundary. This article follows a support-ticket app through state, logs, image files, environment values, network names, mounts, health checks, and Compose output so each symptom points to useful evidence."
tags: ["docker", "debugging", "logs", "inspect"]
order: 2
id: article-containers-orchestration-docker-debugging-docker-containers
aliases:
  - debugging-docker
  - debugging-docker-containers
  - containers-orchestration/docker/debugging-docker.md
  - containers-orchestration/docker/debugging-docker-containers.md
---

## Table of Contents

1. [What You Are Debugging](#what-you-are-debugging)
2. [State Before Shell Access](#state-before-shell-access)
3. [Logs and Exit Codes](#logs-and-exit-codes)
4. [Image Files and Startup Command](#image-files-and-startup-command)
5. [Environment and Configuration](#environment-and-configuration)
6. [Network Path](#network-path)
7. [Storage Path](#storage-path)
8. [Health and Startup Order](#health-and-startup-order)
9. [Compose Configuration](#compose-configuration)
10. [A Full Debugging Walkthrough](#a-full-debugging-walkthrough)
11. [Putting It All Together](#putting-it-all-together)

## What You Are Debugging
<!-- section-summary: Docker debugging means matching a symptom to the Docker boundary that controls it. -->

Docker debugging is the work of finding which boundary disagrees with what you expected. A **boundary** is a place where Docker changes the view of the process. The image controls which files exist. The command controls what starts. The environment controls configuration values. The network controls names and ports. The mounts control which files appear at a path. Compose connects several containers into one project.

Let's keep using the support-ticket app from the cleanup article. The stack has a Node API, a worker, Postgres, Redis, one project network, one named Postgres volume, a published API port, and a health check. Someone starts the stack and says, "The app is up, and the browser cannot create tickets."

That sentence contains several possible failures. The API container may be restarting. The API may be running the wrong command. The image may miss `dist/server.js`. The API may point at `localhost` for Postgres. The host may publish the wrong port. A bind mount may cover the files built into the image. The database may run while the API starts before it can accept connections.

The useful debugging order connects the same pieces Docker uses to run the app:

```mermaid
flowchart TD
    Compose["Compose project"]
    Image["Image files"]
    Config["Runtime config<br/>command, env, mounts, ports"]
    Process["Main process"]
    Logs["Logs and exit code"]
    Network["Network path"]
    Storage["Storage path"]
    Health["Health status"]

    Compose --> Config
    Image --> Config
    Config --> Process
    Process --> Logs
    Config --> Network
    Config --> Storage
    Process --> Health
```

This order keeps the investigation grounded. If the process exits immediately, logs and exit code matter before shell access. If the process runs while the browser fails, ports and host-to-container routing matter. If one container fails to reach another, Compose service names and networks matter. Each symptom points to evidence.

## State Before Shell Access
<!-- section-summary: Container state tells you whether the process is running, restarting, completed, paused, unhealthy, or missing. -->

**Container state** is Docker's current view of a container's lifecycle. Common states include running, exited, restarting, paused, and dead. Compose adds service names and health information so you can read the whole project quickly.

For a Compose app, the first state check usually comes from:

```bash
docker compose ps
```

The support-ticket app might show:

```
NAME                  IMAGE                  COMMAND                  SERVICE   STATUS
support-api-1         support-api:dev        "node dist/server.js"    api       Restarting (1) 9 seconds ago
support-db-1          postgres:18            "docker-entrypoint.s..." db        Up 45 seconds (healthy)
support-redis-1       redis:8                "docker-entrypoint.s..." redis     Up 45 seconds
support-worker-1      support-worker:dev     "node dist/worker.js"    worker    Up 40 seconds
```

This table already tells a story. Docker created the API container. Docker tried to start `node dist/server.js`. The process exited with code `1`, and the restart policy keeps trying. The database reports healthy. A shell into the API container may fail because the main process keeps exiting, so logs are the next evidence.

Another state would lead somewhere else. `Exited (0)` often means the command completed successfully. That fits a migration job and fails a long-running API. `Up` with no host access points toward ports or application binding. `Up (unhealthy)` points toward the health check or a dependency the health check uses.

For a single container outside Compose, `docker ps -a` gives the same first branch:

```bash
docker ps -a --filter "name=support-api"
```

State connects to logs because Docker can only show process output if the process wrote something to standard output or standard error. When a container exits, those logs often contain the first useful reason.

## Logs and Exit Codes
<!-- section-summary: Logs show the process point of view, while exit codes show how the main process ended. -->

**Logs** are the output the containerized process wrote to stdout and stderr. For a Compose service, `docker compose logs` groups that output by service. Logs show what the application knew at runtime, which makes them the best next step after a restart or exit state.

The API service logs might show a missing build artifact:

```bash
docker compose logs --tail=80 api
```

```
api-1  | Error: Cannot find module '/app/dist/server.js'
api-1  |     at Module._resolveFilename (node:internal/modules/cjs/loader:1207:15)
api-1  | Node.js v22.11.0
```

That points at the image files, command, or mounted filesystem. The process tried to load `/app/dist/server.js` and failed. Network checks belong later because the application never reached the point where it opened a port or connected to Postgres.

Another log points at runtime configuration and networking:

```
api-1  | Error: connect ECONNREFUSED 127.0.0.1:5432
api-1  | Database connection failed for postgres://app@localhost:5432/tickets
```

Inside the API container, `127.0.0.1` points back to the API container. In a Compose project, the Postgres service name might be `db`, so the API should usually connect to `db:5432` from another service on the same project network.

Exit code gives another clue:

```bash
docker inspect --format '{{.State.ExitCode}} {{.State.Error}}' support-api-1
```

```
1
```

A non-zero exit code means the main process reported failure. An empty `.State.Error` means the container runtime itself may not have produced a separate runtime error. If `.State.Error` contains a message about an executable path, permissions, or mount setup, the failure may come before the application code starts.

Logs connect to image and command because many Docker failures mention a path, module, executable, or argument. The next section checks whether Docker tried to run the command you think it tried to run, and whether the filesystem contains the files that command needs.

## Image Files and Startup Command
<!-- section-summary: The image and startup command decide which executable Docker starts and which files the process can read. -->

An **image** provides the container filesystem and default metadata. A **startup command** tells Docker which process to run as PID 1 inside the container. In Docker terms, `ENTRYPOINT` and `CMD` from the image can combine with command overrides from Compose or `docker run`.

When logs say `Cannot find module '/app/dist/server.js'`, three practical checks help. The current Compose file may override the command. The image may have skipped the build output. A bind mount may cover the built files after the container starts.

Compose can show the final command after file merging and variable interpolation:

```bash
docker compose config
```

A relevant service block might contain:

```yaml
services:
  api:
    build:
      context: /Users/alex/support-ticket/api
    command:
      - node
      - dist/server.js
    working_dir: /app
    volumes:
      - type: bind
        source: /Users/alex/support-ticket/api
        target: /app
```

Now you have two facts. The command expects `/app/dist/server.js`. The bind mount puts the host `./api` directory on top of `/app` inside the container. If the image build created `/app/dist/server.js` and the host directory has no `dist` folder, the running container misses the built file at `/app/dist/server.js`.

One-off inspection can check the filesystem view without relying on the restarting API process:

```bash
docker compose run --rm --entrypoint sh api -lc 'pwd; ls -la; ls -la dist'
```

If that command prints `ls: dist: No such file or directory`, the missing file is real in the runtime view. The fix might be running the local build so the bind mount contains `dist`, changing the development command to use a source watcher, or narrowing the bind mount to keep built image output visible.

For image metadata, `docker image inspect` can show the default working directory and command:

```bash
docker image inspect support-api:dev --format '{{json .Config.WorkingDir}} {{json .Config.Cmd}} {{json .Config.Entrypoint}}'
```

Image and command debugging connects to environment because a container can start the right file and still use the wrong settings. The process can run perfectly while pointing at the wrong database host, port, mode, or secret name.

## Environment and Configuration
<!-- section-summary: Runtime configuration tells the same image which database, port, mode, and credentials to use. -->

**Environment variables** are key-value strings Docker passes into the container process. Many applications use them for database URLs, ports, feature flags, API keys, and runtime mode. The same image can behave differently in development, CI, staging, and production because those values change.

For the support-ticket API, a single value can break the whole stack:

```yaml
environment:
  DATABASE_URL: postgres://app:secret@localhost:5432/tickets
```

That value works for code running directly on the developer's laptop if Postgres publishes port `5432` to the host. It fails inside the API container because `localhost` means the API container itself. Compose service-to-service traffic should use the service name and the container port:

```yaml
environment:
  DATABASE_URL: postgres://app:secret@db:5432/tickets
```

`docker compose config` helps because it shows the resolved Compose model. It can reveal values from `.env`, defaults, overrides, and multiple Compose files:

```bash
docker compose config --environment
docker compose config
```

For a running container, the live environment can be checked from inside:

```bash
docker compose exec api env | sort
```

If the API keeps restarting, inspect the container configuration instead:

```bash
docker inspect support-api-1 --format '{{json .Config.Env}}'
```

Environment debugging also includes ports. Many web servers read a `PORT` variable and listen on that container port. If the app listens on `3000`, the Compose port mapping should publish host traffic to container port `3000`, such as `"8080:3000"`. If the app listens on `8080` while Compose publishes `"8080:3000"`, the browser may hit a port where the container has no listener.

Configuration connects to networking because the value `db:5432` only works if the API and database share a Docker network and Compose service discovery can resolve `db`.

## Network Path
<!-- section-summary: Docker networking separates host access from service-to-service access, so host ports and container service names answer different questions. -->

A **Docker network** gives containers a place to reach each other. In Compose, Docker creates a default project network and each service joins it unless the Compose file says otherwise. Containers on that network can discover each other by service name, such as `api`, `db`, or `redis`.

The most common beginner confusion is host port versus container port. A Compose mapping like this has two sides:

```yaml
ports:
  - "8080:3000"
```

The left side, `8080`, is the host port your browser uses on the laptop. The right side, `3000`, is the container port the API process must listen on. Another container in the same Compose network uses `api:3000` for service-to-service traffic, while `localhost:8080` belongs to the host side.

The host mapping can be checked from Compose:

```bash
docker compose port api 3000
```

```
0.0.0.0:8080
```

Service discovery can be checked from a running container:

```bash
docker compose exec api getent hosts db
```

```
172.19.0.3      db
```

Network membership can be checked from Docker:

```bash
docker network ls
docker network inspect support-ticket_default
```

If `api` and `db` are absent from the same network, the API container cannot resolve the database name. If the database appears on the network and the API still fails to connect, the next checks include database readiness, credentials, and whether Postgres listens on the expected container port.

Networking connects to storage because a service can reach its dependency and still fail when files or database state appear differently inside the container than the developer expected.

## Storage Path
<!-- section-summary: Mounts decide which files appear inside the container, and bind mounts can cover files that the image originally contained. -->

**Storage path** means the source of files the container reads and writes. Docker can show files from the image, from the container writable layer, from a Docker volume, or from a bind mount. The same path inside the container can have different contents depending on the mount configuration.

A **bind mount** maps a host path into the container. Development Compose files often use this for source code:

```yaml
volumes:
  - ./api:/app
```

That mount lets code changes on the host appear inside the container. It can also cover files that the image placed in `/app` during the build. If the Dockerfile built `dist/server.js` inside the image, and the host `./api` directory has no `dist`, the bind-mounted `/app` hides the image's `/app/dist`.

A **volume** is Docker-managed persistent storage. The database service might use:

```yaml
volumes:
  - support_pgdata:/var/lib/postgresql/data
```

This lets Postgres data survive container removal. It also means a broken migration can leave state behind across restarts. If the app acts strange after a schema change, the running database volume may hold old tables, old users, or half-applied migration data.

Mounts can be inspected from Docker:

```bash
docker inspect support-api-1 --format '{{json .Mounts}}'
```

Inside a running container, file checks can confirm what the process sees:

```bash
docker compose exec api sh -lc 'pwd; ls -la /app; ls -la /app/dist'
```

For a database volume, inspect the volume name before deleting anything:

```bash
docker volume ls
docker volume inspect support_pgdata
```

Storage connects to health because the process may start, see the right files, connect over the network, and still report unhealthy while it waits for a database migration, cache warmup, or readiness endpoint.

## Health and Startup Order
<!-- section-summary: Health checks describe readiness, while Compose startup order controls when dependent containers get created. -->

A **health check** is a command Docker runs to decide whether a running container looks healthy. Dockerfile `HEALTHCHECK` and Compose `healthcheck` can run commands such as `curl`, `pg_isready`, or an application-specific script. Health adds another status beside the normal running state.

For the support-ticket API, the process may run while the app is still unable to handle requests. Maybe it is connecting to the database, applying migrations, or loading configuration. A health check can express the real readiness signal:

```yaml
services:
  api:
    build: ./api
    ports:
      - "8080:3000"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:3000/health || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 20s
```

For Postgres, the database service can use:

```yaml
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: tickets
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d tickets"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

Compose can wait for a healthy dependency when `depends_on` uses `condition: service_healthy`:

```yaml
services:
  api:
    depends_on:
      db:
        condition: service_healthy
```

This matters because starting a container and being ready to serve traffic are separate facts. Docker can start Postgres before Postgres accepts SQL connections. The health check gives Compose and humans a better readiness signal.

Health details can be inspected from Docker:

```bash
docker inspect support-api-1 --format '{{json .State.Health}}'
```

If the health check fails, read the test command and ask what it assumes. Does the image include `curl`? Does the app listen on `localhost:3000` inside the container? Does the endpoint require authentication? Does the start period give the app enough time for migrations?

Health connects to Compose configuration because the visible file may differ from the model Docker actually applies. Multiple Compose files, profiles, environment interpolation, and project names can change what reaches the Docker Engine.

## Compose Configuration
<!-- section-summary: Compose debugging checks the resolved project model so hidden overrides, profiles, ports, mounts, and service names become visible. -->

**Compose configuration** is the final service model Docker Compose sends toward the Docker Engine after it merges files, resolves variables, expands short syntax, and applies profiles. The file you are looking at may be only part of the final model.

This matters in real teams. One developer may run:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up
```

CI may run:

```bash
docker compose -f compose.yaml -f compose.ci.yaml up --abort-on-container-exit
```

Those two commands can produce different commands, environment variables, ports, mounts, health checks, and profiles. If the support-ticket API fails only on one machine, the merged configuration can reveal a local override.

`docker compose config` shows the rendered model:

```bash
docker compose config
```

It can answer practical questions:

| Question | Where to look in resolved config |
|---|---|
| Which command runs? | `services.api.command` |
| Which image or build context applies? | `services.api.image` and `services.api.build` |
| Which environment values reach the container? | `services.api.environment` |
| Which host port maps to the app? | `services.api.ports` |
| Which paths mount over image files? | `services.api.volumes` |
| Which dependencies affect startup order? | `services.api.depends_on` |
| Which health check decides readiness? | `services.api.healthcheck` |

Compose also has project identity. The default project name usually comes from the directory name, and Docker uses it to name networks, containers, and volumes. If two checkouts of the same repo run with different project names, they can create separate networks and volumes. If two projects accidentally share external networks or volumes, one stack can affect another.

This is why the final walkthrough starts with Compose state and config, then follows the symptom through logs, image files, environment, network, storage, and health.

## A Full Debugging Walkthrough
<!-- section-summary: A complete investigation follows the symptom through one boundary at a time and stops when evidence explains the failure. -->

The support-ticket app starts with this report from a junior developer: the stack starts, the database says healthy, and the browser at `http://localhost:8080` returns nothing useful. We will walk it like a pairing session.

The walkthrough opens with the state check:

```bash
docker compose ps
```

```
NAME                  SERVICE   STATUS
support-api-1         api       Restarting (1) 6 seconds ago
support-db-1          db        Up 1 minute (healthy)
support-redis-1       redis     Up 1 minute
```

The API restarts. Browser debugging can wait because the service keeps restarting. The next evidence is logs:

```bash
docker compose logs --tail=50 api
```

```
api-1  | Error: Cannot find module '/app/dist/server.js'
```

That message points at image files, command, or mounts. The resolved Compose config shows both the command and the bind mount:

```bash
docker compose config
```

```yaml
services:
  api:
    command:
      - node
      - dist/server.js
    volumes:
      - type: bind
        source: /Users/alex/support-ticket/api
        target: /app
```

The runtime filesystem check confirms the host directory covers `/app` and has no `dist`:

```bash
docker compose run --rm --entrypoint sh api -lc 'ls -la /app; ls -la /app/dist'
```

```
ls: /app/dist: No such file or directory
```

Now the team has a real cause. The image may have built `dist`, and the development bind mount hides it. The team chooses one fix for local development: run the API with a source watcher that reads `src`, or build `dist` on the host before starting, or change the mount layout so `/app/dist` from the image stays visible.

After fixing the command and mount issue, the API starts, and the logs show another problem:

```
api-1  | Error: connect ECONNREFUSED 127.0.0.1:5432
```

The environment check shows the database URL:

```bash
docker compose exec api env | sort | grep DATABASE_URL
```

```
DATABASE_URL=postgres://app:secret@localhost:5432/tickets
```

Inside the API container, `localhost` points at the API container. The Compose network gives the database service the name `db`, so the value changes to:

```yaml
DATABASE_URL: postgres://app:secret@db:5432/tickets
```

The network check verifies service discovery:

```bash
docker compose exec api getent hosts db
```

```
172.19.0.3      db
```

The app now starts and reaches the database, and the first request still fails for a few seconds after `docker compose up`. The Compose startup check shows that `api` depends on `db` without waiting for database health. The team adds a `db` health check and uses `condition: service_healthy` for the API dependency.

The final result is a chain of evidence. Each change came from one boundary: state pointed to logs, logs pointed to files and mounts, the next logs pointed to environment and network, and startup timing pointed to health and Compose dependency configuration.

## Putting It All Together
<!-- section-summary: Docker debugging stays practical when each symptom maps to one boundary and one evidence command. -->

Docker gives you many commands. Each command has a clear job: answer one boundary question about state, logs, image, command, environment, network, storage, health, or Compose.

| Symptom | Boundary to check | Useful evidence |
|---|---|---|
| Container keeps restarting | State, logs, exit code | `docker compose ps`, `docker compose logs SERVICE`, `docker inspect` |
| App says a file is missing | Image, command, mounts | `docker compose config`, `docker image inspect`, `docker compose run --entrypoint sh` |
| App connects to `localhost` and fails | Environment, network | `docker compose exec SERVICE env`, `docker compose exec SERVICE getent hosts db` |
| Browser cannot reach the app | Host port, app bind address, container port | `docker compose port SERVICE PORT`, app logs, service config |
| One service cannot reach another | Compose network and service name | `docker network inspect`, Compose networking config |
| Data seems old after restart | Volume lifecycle | `docker volume ls`, `docker inspect .Mounts`, migration logs |
| Service is running but not ready | Health check and dependency order | `docker inspect .State.Health`, `depends_on.condition`, health check logs |
| Only one machine fails | Resolved Compose model | `docker compose config --environment`, merged file list, profiles |

The support-ticket app gave us a realistic path. The API restarted because a bind mount hid the built `dist` directory. Then it used `localhost` for Postgres from inside a container. Then it started before the database readiness signal matched what the API needed. None of those problems required guessing.

The habit is the important part: **state first, logs next, then the boundary named by the evidence**. Docker has strong boundaries, and good debugging follows them in plain steps. That is the same skill you will use later in Kubernetes, ECS, CI runners, and production container platforms.

---

**References**

- [docker container ls](https://docs.docker.com/reference/cli/docker/container/ls/) - Official Docker CLI reference for listing running and stopped containers with status information.
- [docker container logs](https://docs.docker.com/reference/cli/docker/container/logs/) - Official Docker CLI reference for reading container stdout and stderr logs.
- [docker container inspect](https://docs.docker.com/reference/cli/docker/container/inspect/) - Official Docker CLI reference for detailed container state, configuration, mounts, and health data.
- [docker container exec](https://docs.docker.com/reference/cli/docker/container/exec/) - Official Docker CLI reference for running commands inside a running container.
- [docker compose ps](https://docs.docker.com/reference/cli/docker/compose/ps/) - Official Docker Compose reference for listing project containers and service state.
- [docker compose logs](https://docs.docker.com/reference/cli/docker/compose/logs/) - Official Docker Compose reference for viewing service logs.
- [docker compose config](https://docs.docker.com/reference/cli/docker/compose/config/) - Official Docker Compose reference for rendering the resolved Compose model.
- [Networking in Compose](https://docs.docker.com/compose/how-tos/networking/) - Official Docker guide for default project networks, service discovery, host ports, and network debugging.
- [Control startup and shutdown order in Compose](https://docs.docker.com/compose/how-tos/startup-order/) - Official Docker guide for `depends_on`, `service_healthy`, and readiness ordering.
- [Dockerfile HEALTHCHECK](https://docs.docker.com/reference/dockerfile/#healthcheck) - Official Dockerfile reference for container health checks and health status.
- [Compose service healthcheck](https://docs.docker.com/reference/compose-file/services/#healthcheck) - Official Compose reference for service health check configuration.
- [Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) - Official Docker storage guide covering bind mounts and how mounts can obscure existing container files.
- [Docker volumes](https://docs.docker.com/engine/storage/volumes/) - Official Docker storage guide covering volume persistence beyond container lifecycle.
