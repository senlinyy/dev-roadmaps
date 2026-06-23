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

1. [The Incident We Will Debug](#the-incident-we-will-debug)
2. [Start With Compose State](#start-with-compose-state)
3. [Use Logs and Exit Codes](#use-logs-and-exit-codes)
4. [Inspect the Container Docker Created](#inspect-the-container-docker-created)
5. [Check the Image and Startup Command](#check-the-image-and-startup-command)
6. [Check Environment Values](#check-environment-values)
7. [Separate Host Ports From Service Discovery](#separate-host-ports-from-service-discovery)
8. [Check Bind Mounts and Volumes](#check-bind-mounts-and-volumes)
9. [Add Health Checks and Startup Order](#add-health-checks-and-startup-order)
10. [Render the Compose Configuration](#render-the-compose-configuration)
11. [Full Debugging Walkthrough](#full-debugging-walkthrough)
12. [Putting It All Together](#putting-it-all-together)
13. [References](#references)

## The Incident We Will Debug
<!-- section-summary: Docker debugging works best when every command answers one question about state, logs, config, network, storage, or health. -->

Imagine we are on a small production support rotation for a support-ticket app. The app has an `api` service that receives tickets, a `worker` service that sends email notifications, a `db` service running Postgres, and a `redis` service for background jobs. The team uses Docker Compose in development and staging because it lets the whole stack run with one `compose.yaml` file.

The support message says, "The ticket page loads, but creating a ticket fails." That sounds simple, but Docker gives that symptom several possible causes. The API container may be restarting. The API may have the wrong startup command. The image may miss the compiled JavaScript files. The API may use `localhost` for Postgres from inside the container. The browser may hit the wrong host port. A bind mount may cover the files built into the image. Postgres may start before it accepts connections.

So we need a calm order of operations. **Container state** tells us whether the process is running. **Logs** tell us what the process said before it failed. **Inspect output** tells us what Docker actually created. **Image metadata** tells us the default working directory, command, and entrypoint. **Environment variables** tell us which database URL, Redis URL, and port the process received. **Networking** separates browser-to-container traffic from container-to-container traffic. **Mounts and volumes** explain which files the process can see and which data survives restarts. **Health checks** explain readiness, and **Compose config** shows the final model after overrides and variable interpolation.

![Docker debugging path infographic showing state, logs, inspect, image, config, network, health, and verified fix as the evidence path for a Compose failure](/content-assets/articles/article-containers-orchestration-docker-debugging-docker-containers/docker-debugging-path.png)

*The debugging path keeps each command tied to one boundary, so the investigation moves from state to evidence before changing the Compose stack.*

Here is a simplified version of the stack we will keep referring to:

```yaml
services:
  api:
    build: ./api
    image: support-api:dev
    command: ["node", "dist/server.js"]
    working_dir: /app
    restart: unless-stopped
    environment:
      NODE_ENV: development
      PORT: "3000"
      DATABASE_URL: postgres://tickets:tickets@localhost:5432/tickets
      REDIS_URL: redis://redis:6379
    ports:
      - "8080:3000"
    volumes:
      - ./api:/app
    depends_on:
      - db
      - redis

  worker:
    build: ./worker
    image: support-worker:dev
    command: ["node", "dist/worker.js"]
    environment:
      DATABASE_URL: postgres://tickets:tickets@db:5432/tickets
      REDIS_URL: redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:18
    environment:
      POSTGRES_USER: tickets
      POSTGRES_PASSWORD: tickets
      POSTGRES_DB: tickets
    volumes:
      - ticket-db:/var/lib/postgresql/data

  redis:
    image: redis:8

volumes:
  ticket-db:
```

This file has realistic mistakes on purpose. The article will debug them one by one, because real Docker work usually starts with a stack that almost looks right.

## Start With Compose State
<!-- section-summary: Compose state tells you whether each service is running, restarting, exited, unhealthy, or missing from the project. -->

**Compose state** is Docker's current report for every service in the project. It answers the first practical question: did Docker create the containers, and are their main processes still alive? This matters because a browser error from the API means something different when the API is restarting every five seconds.

The first command I usually want is:

```bash
docker compose ps
```

A broken support-ticket stack might show this:

```
NAME                  IMAGE                     COMMAND                  SERVICE   STATUS
support-api-1         support-api:dev           "node dist/server.js"    api       Restarting (1) 8 seconds ago
support-db-1          postgres:18               "docker-entrypoint.s..." db        Up 42 seconds
support-redis-1       redis:8                   "docker-entrypoint.s..." redis     Up 42 seconds
support-worker-1      support-worker:dev        "node dist/worker.js"    worker    Up 38 seconds
```

There is already a useful clue here. Docker created the API container, tried to run `node dist/server.js`, and the process exited with code `1`. The `restart: unless-stopped` policy keeps bringing it back. A shell inside the API container may be annoying because the main process keeps dying, so the next evidence comes from logs and inspect output.

Different state values point to different branches. `Exited (0)` usually means the command finished successfully, which is fine for a migration job and suspicious for a web API. `Up` with a browser failure points toward port mapping, app binding, or application errors. `Up (unhealthy)` points toward the health check and the dependency it checks. `Restarting (127)` often means Docker could not find the executable or shell command. `Restarting (137)` often means the process received `SIGKILL`, which can happen during memory pressure or a forced stop.

When stopped containers matter, use the full view:

```bash
docker compose ps --all
```

For a single container outside Compose, the same state check comes from Docker directly:

```bash
docker ps -a --filter "name=support-api"
```

In team practice, this first state snapshot belongs in the incident notes. It gives everyone the same starting point before people start changing Compose files, rebuilding images, or deleting volumes.

## Use Logs and Exit Codes
<!-- section-summary: Logs show what the container process wrote, and exit codes show how the main process ended. -->

**Container logs** are the stdout and stderr output from the process running in the container. For our API, that means the Node process can print stack traces, database connection errors, startup messages, and request errors. Logs are usually the fastest way to learn whether the process reached application code.

The API is restarting, so we ask Compose for the last part of the API logs:

```bash
docker compose logs --tail=80 api
```

The output might be:

```
api-1  | node:internal/modules/cjs/loader:1228
api-1  |   throw err;
api-1  |   ^
api-1  |
api-1  | Error: Cannot find module '/app/dist/server.js'
api-1  |     at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)
api-1  |     at Module._load (node:internal/modules/cjs/loader:1051:27)
api-1  | code: 'MODULE_NOT_FOUND'
api-1  |
api-1  | Node.js v22.11.0
```

That message puts us at the file and command boundary. The API has not reached the database, Redis, or the HTTP port yet. The process tried to load `/app/dist/server.js`, and that file was missing from the container filesystem it received at runtime.

Exit code confirms the process ended as an application failure:

```bash
docker inspect --format 'status={{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}} oom={{.State.OOMKilled}}' support-api-1
```

```
status=restarting exit=1 error= oom=false
```

An exit code of `1` usually means the application or command reported a general failure. Exit code `126` often points to a permission problem where a command exists but execute permission or runtime policy blocks it. Exit code `127` often points to a missing command. Exit code `137` usually means the process was killed with signal 9. A normal stop commonly sends `SIGTERM`, and Docker reports that as exit code `143`.

Logs also help when the process runs and then fails during startup. After the missing file problem is fixed, the API might print:

```
api-1  | Listening on http://0.0.0.0:3000
api-1  | Database connection failed: connect ECONNREFUSED 127.0.0.1:5432
api-1  | DATABASE_URL=postgres://tickets:*****@localhost:5432/tickets
```

That message moves the investigation from image files to runtime configuration. Inside the API container, `127.0.0.1` means the API container itself. The Postgres service lives in the `db` container, so the service-to-service address should use `db:5432` on the Compose network.

## Inspect the Container Docker Created
<!-- section-summary: Docker inspect shows the real container settings, including command, working directory, environment, ports, mounts, networks, and health state. -->

**Inspect output** is Docker's detailed JSON record for a container, image, network, or volume. It helps when the Compose file and the running container disagree in your head. Maybe an override file changed the command. Maybe an environment variable came from the shell. Maybe the mount source is a different path than the one you expected.

For the API container, this command shows the command and working directory Docker used:

```bash
docker inspect support-api-1 --format 'path={{json .Path}} args={{json .Args}} workdir={{json .Config.WorkingDir}}'
```

```
path="node" args=["dist/server.js"] workdir="/app"
```

Now the log message lines up with the runtime command. Docker started `node` inside `/app` with `dist/server.js` as the argument. If the file is missing under `/app`, the container exits before the application can do anything useful.

Inspect can also show the mount list:

```bash
docker inspect support-api-1 --format '{{range .Mounts}}{{printf "%s %s -> %s\n" .Type .Source .Destination}}{{end}}'
```

```
bind /Users/alex/support-ticket/api -> /app
```

This is an important discovery. The image may have built `/app/dist/server.js`, but the bind mount places the host `./api` directory over `/app` at container startup. If the host directory has source files but no local `dist` folder, the running container cannot see the built `dist` files from the image.

Inspect can also show published ports from Docker's point of view:

```bash
docker inspect support-api-1 --format '{{json .NetworkSettings.Ports}}'
```

```
{"3000/tcp":[{"HostIp":"0.0.0.0","HostPort":"8080"}]}
```

The container exposes port `3000/tcp` to the Docker network, and Docker publishes it on host port `8080`. This is the split we will use later: the browser on the host uses `localhost:8080`, while another service in Compose uses `api:3000`.

## Check the Image and Startup Command
<!-- section-summary: Image metadata and one-off service containers explain which files, working directory, command, and entrypoint the service starts with. -->

An **image** is the packaged filesystem and metadata Docker uses to create containers. The filesystem includes things like `/app/dist/server.js`, `node_modules`, shell tools, certificates, and application code. The metadata includes the default working directory, entrypoint, command, environment values, and health check.

The API log says `/app/dist/server.js` is missing. We can check the image metadata first:

```bash
docker image inspect support-api:dev --format 'workdir={{json .Config.WorkingDir}} entrypoint={{json .Config.Entrypoint}} cmd={{json .Config.Cmd}}'
```

```
workdir="/app" entrypoint=null cmd=["node","dist/server.js"]
```

That output tells us the image itself expects to run `node dist/server.js` from `/app`. The next question is whether the file exists in the runtime filesystem after Compose applies mounts. A one-off Compose container is useful here because it starts from the same service definition, including mounts and environment, while letting us replace the command with a shell. It creates a temporary container, so it is good for filesystem and configuration checks rather than inspecting the exact live process. Service port publishing only happens when you add `--service-ports` or an explicit `--publish` mapping.

```bash
docker compose run --rm --entrypoint sh api -lc 'pwd; ls -la; ls -la dist; echo exit=$?'
```

```
/app
total 208
drwxr-xr-x  14 node node    448 Jun 21 09:12 .
drwxr-xr-x   1 root root   4096 Jun 21 09:15 ..
-rw-r--r--   1 node node    214 Jun 21 09:12 package.json
drwxr-xr-x   8 node node    256 Jun 21 09:12 src
ls: dist: No such file or directory
exit=2
```

Now we know the missing file problem is real in the running service view. The fix depends on the purpose of the service. For a development service with a source bind mount, the command might use a watcher that reads `src` directly. For a production-like service, the bind mount should usually disappear so the image's built `/app/dist` files remain visible.

A development override could look like this:

```yaml
services:
  api:
    command: ["npm", "run", "dev"]
    volumes:
      - ./api:/app
      - api-node-modules:/app/node_modules

volumes:
  api-node-modules:
```

A staging or production Compose file would usually keep the built image and remove the source bind mount:

```yaml
services:
  api:
    image: registry.example.com/support-api:2026-06-21
    command: ["node", "dist/server.js"]
```

Real teams separate those two modes because the debugging story changes. Development wants fast source changes through a bind mount. Staging wants the same image shape that production will run.

## Check Environment Values
<!-- section-summary: Environment inspection confirms the exact URLs, ports, modes, and flags the process received at startup. -->

**Environment variables** are string values Docker passes into the process. Applications commonly use them for database URLs, Redis URLs, listening ports, runtime modes, feature flags, and secrets. A Docker image can be correct while one environment value points it at the wrong place.

Our Compose file gave the API this value:

```yaml
environment:
  DATABASE_URL: postgres://tickets:tickets@localhost:5432/tickets
```

That value is the bug after the missing `dist` file is fixed. `localhost` inside the API container points back to the API container. The Postgres container is the `db` service on the Compose network, so the API should receive this value:

```yaml
environment:
  DATABASE_URL: postgres://tickets:tickets@db:5432/tickets
```

For a running container, the live environment can be checked from inside the service:

```bash
docker compose exec api sh -lc 'env | sort | grep -E "DATABASE_URL|REDIS_URL|PORT|NODE_ENV"'
```

```
DATABASE_URL=postgres://tickets:tickets@localhost:5432/tickets
NODE_ENV=development
PORT=3000
REDIS_URL=redis://redis:6379
```

For a restarting container, `docker inspect` can show the configured environment without needing a shell in the process:

```bash
docker inspect support-api-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | sort | grep -E 'DATABASE_URL|REDIS_URL|PORT|NODE_ENV'
```

```
DATABASE_URL=postgres://tickets:tickets@localhost:5432/tickets
NODE_ENV=development
PORT=3000
REDIS_URL=redis://redis:6379
```

Compose can also show the resolved model after `.env` interpolation and override files:

```bash
docker compose config --environment
docker compose config api
```

This matters because `.env` has two common roles in Compose projects. It can provide values for interpolation in the Compose file, such as `${API_PORT}`. Container environment variables come from `environment`, `env_file`, image `ENV`, and command-line overrides. Teams often find a bug where `.env` contains `DATABASE_URL=...`, but the service never injects that value into the container.

Configuration debugging should include safe secret handling. In incident notes, record the variable name and the host part, such as `DATABASE_URL uses localhost`, instead of pasting passwords, tokens, or full connection strings into chat.

## Separate Host Ports From Service Discovery
<!-- section-summary: Host ports are for traffic from your laptop or load balancer, while Compose service names are for traffic between containers. -->

**Docker networking** gives containers a private network path to each other. In Compose, the default network lets services reach each other by service name. The `api` service can connect to `db:5432` and `redis:6379` because Compose registers those names in Docker's internal DNS for the project network.

The `ports` mapping answers a different question. It publishes a container port to the host machine:

```yaml
ports:
  - "8080:3000"
```

The left side, `8080`, is the host port used by a browser on the laptop: `http://localhost:8080`. The right side, `3000`, is the container port where the API process must listen. A worker container in the same Compose network would use `http://api:3000`, because it speaks to the API service name and container port.

![Two traffic paths infographic showing host localhost 8080 to api 3000, service api to db 5432, a bind mount covering app files, and a ticket-db volume persisting data](/content-assets/articles/article-containers-orchestration-docker-debugging-docker-containers/two-traffic-paths.png)

*The traffic and filesystem paths sit side by side because Docker debugging often mixes host access, service discovery, bind mounts, and volumes in the same symptom.*

Compose can print the current host mapping:

```bash
docker compose port api 3000
```

```
0.0.0.0:8080
```

Service discovery can be checked from another container. The `getent hosts` command asks the container's resolver for the `db` service name:

```bash
docker compose exec api getent hosts db
```

```
172.23.0.3      db
```

The next check asks whether a TCP connection to Postgres can open from the API container. This example uses Node because the API image already has Node, while minimal images often lack `nc` or `curl`:

```bash
docker compose exec api node -e "const net=require('net'); const s=net.connect(5432,'db',()=>{console.log('db:5432 reachable'); s.end();}); s.on('error',e=>{console.error(e.message); process.exit(1);});"
```

```
db:5432 reachable
```

Host access has one more container-specific detail. Many web frameworks default to binding on `127.0.0.1`. Inside a container, that address belongs to the container loopback interface. For host-published ports, the application should listen on `0.0.0.0` inside the container so traffic forwarded by Docker can reach it. A useful startup log says both the address and port, such as `Listening on http://0.0.0.0:3000`.

When the browser fails and containers can talk to each other, the next check is the host side. When the API logs show `ECONNREFUSED 127.0.0.1:5432`, the next check is the service-to-service side. Keeping those two paths separate saves a lot of random command running.

## Check Bind Mounts and Volumes
<!-- section-summary: Bind mounts change the container filesystem from the host, while volumes persist container-generated data under Docker management. -->

**Bind mounts** place a host file or directory into the container. They are great for local development because source edits on the host appear inside the container immediately. They also explain many "the image built correctly but the container cannot find the file" bugs because a mount at `/app` can cover files that existed in the image at `/app`.

The mount list from `docker inspect` showed this:

```bash
docker inspect support-api-1 --format '{{range .Mounts}}{{printf "%s %s -> %s\n" .Type .Source .Destination}}{{end}}'
```

```
bind /Users/alex/support-ticket/api -> /app
```

The one-off shell confirmed the result:

```bash
docker compose run --rm --entrypoint sh api -lc 'test -f /app/dist/server.js; echo "dist_exists_exit=$?"'
```

```
dist_exists_exit=1
```

That exit code means the test did not find the file. The fix should match the mode. In a development service, use a dev command that reads source files or builds `dist` inside the mounted directory. In a production-like service, remove the source bind mount and run the image exactly as built.

**Volumes** are different. A Docker volume is managed by Docker and commonly stores data generated by the container, such as a Postgres data directory. The support-ticket database uses a named volume:

```yaml
volumes:
  - ticket-db:/var/lib/postgresql/data
```

The volume can be inspected:

```bash
docker volume ls --filter name=ticket-db
docker volume inspect support-ticket_ticket-db --format 'name={{.Name}} driver={{.Driver}} mountpoint={{.Mountpoint}}'
```

```
DRIVER    VOLUME NAME
local     support-ticket_ticket-db
name=support-ticket_ticket-db driver=local mountpoint=/var/lib/docker/volumes/support-ticket_ticket-db/_data
```

Volumes matter during debugging because database state survives container replacement. If the API says a column is missing after a migration change, recreating the API container will not reset the Postgres volume. A deliberate data reset uses `docker compose down -v`, and that `-v` flag deletes named volumes for the project. In shared development or staging environments, that command deserves extra care because it removes data, not just containers.

Storage checks connect naturally to health checks. The database container may be running with a valid volume, but the API still needs a readiness signal before it connects.

## Add Health Checks and Startup Order
<!-- section-summary: Health checks describe readiness, and depends_on with service_healthy lets Compose wait for a dependency before starting another service. -->

A **health check** is a command Docker runs inside a container to decide whether the service is healthy. For Postgres, the process can be running while the database is still starting up. A health check gives Compose a more useful readiness signal than "the process exists."

For the database, a practical health check uses `pg_isready`:

```yaml
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: tickets
      POSTGRES_PASSWORD: tickets
      POSTGRES_DB: tickets
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tickets -d tickets"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
```

The health state appears in Compose:

```bash
docker compose ps db
```

```
NAME            IMAGE         COMMAND                  SERVICE   STATUS
support-db-1    postgres:18   "docker-entrypoint.s..." db        Up 28 seconds (healthy)
```

Docker stores recent health check output in inspect data:

```bash
docker inspect support-db-1 --format 'health={{.State.Health.Status}}{{range .State.Health.Log}}{{printf "\nexit=%d output=%q" .ExitCode .Output}}{{end}}'
```

```
health=healthy
exit=0 output="/var/run/postgresql:5432 - accepting connections\n"
```

Now the API can use `depends_on` with the `service_healthy` condition:

```yaml
services:
  api:
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
```

This tells Compose to start the API after Postgres reports healthy and after Redis has started. For Redis, teams often add a health check too:

```yaml
services:
  redis:
    image: redis:8
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Health checks are part of the runtime contract. The application should still retry database and Redis connections because containers can restart, networks can pause, and a dependency can pass one health check and fail later. In production systems, the same idea usually appears in orchestrators, load balancers, readiness probes, and application startup retries.

## Render the Compose Configuration
<!-- section-summary: docker compose config shows the final service model after Compose merges files, expands short syntax, and interpolates variables. -->

**Compose configuration** often comes from more than one place. A project may have `compose.yaml`, `compose.override.yaml`, a dev override, environment variables from the shell, and a `.env` file for interpolation. The file you are reading may differ from the model Docker actually sends to the engine.

The command that removes that guesswork is:

```bash
docker compose config
```

For our API, the rendered output may include the important parts:

```yaml
services:
  api:
    build:
      context: /Users/alex/support-ticket/api
    command:
      - node
      - dist/server.js
    environment:
      DATABASE_URL: postgres://tickets:tickets@localhost:5432/tickets
      NODE_ENV: development
      PORT: "3000"
      REDIS_URL: redis://redis:6379
    ports:
      - mode: ingress
        target: 3000
        published: "8080"
        protocol: tcp
    volumes:
      - type: bind
        source: /Users/alex/support-ticket/api
        target: /app
```

This one view explains three failures: the command expects `dist/server.js`, the bind mount can hide `dist`, and `DATABASE_URL` points at `localhost`. It also confirms that host port `8080` maps to container port `3000`.

Compose config also helps with targeted checks. A team can render one service, include multiple files, or fail fast in CI:

```bash
docker compose -f compose.yaml -f compose.dev.yaml config api
docker compose config --services
docker compose config --quiet
```

In real projects, this command belongs near the top of the runbook. It catches indentation mistakes, missing variables, unexpected override files, and short syntax that expands into something different from what the team pictured.

## Full Debugging Walkthrough
<!-- section-summary: A full Docker debugging pass follows one symptom through state, logs, inspect output, config, network checks, storage checks, and health checks. -->

Now let's walk the whole incident like we are pairing on it. The user reports that the ticket form returns a failure. We start with the whole project, because a request touches the API, Postgres, Redis, and the worker.

```bash
docker compose ps
```

```
NAME                  IMAGE                     COMMAND                  SERVICE   STATUS
support-api-1         support-api:dev           "node dist/server.js"    api       Restarting (1) 6 seconds ago
support-db-1          postgres:18               "docker-entrypoint.s..." db        Up 51 seconds
support-redis-1       redis:8                   "docker-entrypoint.s..." redis     Up 51 seconds
support-worker-1      support-worker:dev        "node dist/worker.js"    worker    Up 47 seconds
```

The API is the first failure. The logs explain why:

```bash
docker compose logs --tail=50 api
```

```
api-1  | Error: Cannot find module '/app/dist/server.js'
api-1  | code: 'MODULE_NOT_FOUND'
```

We inspect the command and mounts:

```bash
docker inspect support-api-1 --format 'path={{json .Path}} args={{json .Args}} workdir={{json .Config.WorkingDir}}'
docker inspect support-api-1 --format '{{range .Mounts}}{{printf "%s %s -> %s\n" .Type .Source .Destination}}{{end}}'
```

```
path="node" args=["dist/server.js"] workdir="/app"
bind /Users/alex/support-ticket/api -> /app
```

Then the one-off shell confirms the runtime filesystem:

```bash
docker compose run --rm --entrypoint sh api -lc 'ls -la /app/dist; echo exit=$?'
```

```
ls: /app/dist: No such file or directory
exit=2
```

We choose the development fix because this is a developer Compose stack. The API should use the dev command with the bind mount:

```yaml
services:
  api:
    command: ["npm", "run", "dev"]
    volumes:
      - ./api:/app
      - api-node-modules:/app/node_modules

volumes:
  api-node-modules:
```

After rebuilding and starting the API, the state improves:

```bash
docker compose up -d --build api
docker compose ps api
```

```
NAME            IMAGE             COMMAND             SERVICE   STATUS
support-api-1   support-api:dev   "npm run dev"       api       Up 8 seconds
```

The browser still returns a ticket creation error, so logs again:

```bash
docker compose logs --tail=80 api
```

```
api-1  | Listening on http://0.0.0.0:3000
api-1  | Database connection failed: connect ECONNREFUSED 127.0.0.1:5432
api-1  | DATABASE_URL=postgres://tickets:*****@localhost:5432/tickets
```

Now we inspect environment:

```bash
docker compose exec api sh -lc 'env | sort | grep -E "DATABASE_URL|REDIS_URL|PORT"'
```

```
DATABASE_URL=postgres://tickets:tickets@localhost:5432/tickets
PORT=3000
REDIS_URL=redis://redis:6379
```

The fix is the Compose service name:

```yaml
services:
  api:
    environment:
      DATABASE_URL: postgres://tickets:tickets@db:5432/tickets
      REDIS_URL: redis://redis:6379
```

Before restarting, we verify that service discovery and the database port work from inside the API container:

```bash
docker compose exec api getent hosts db
docker compose exec api node -e "const net=require('net'); const s=net.connect(5432,'db',()=>{console.log('db:5432 reachable'); s.end();}); s.on('error',e=>{console.error(e.message); process.exit(1);});"
```

```
172.23.0.3      db
db:5432 reachable
```

The next failure appears only on cold starts. Sometimes the API starts before Postgres is ready. We add the database health check and the `service_healthy` dependency:

```yaml
services:
  db:
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tickets -d tickets"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  api:
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
```

Now we render the final Compose model:

```bash
docker compose config api
```

The rendered service should show the dev command, `DATABASE_URL` with `db:5432`, port `8080 -> 3000`, and the expected bind mount. This is the point where the debugging notes can change from investigation to fix summary.

Finally, the host path and service path both work:

```bash
docker compose port api 3000
curl -i http://localhost:8080/health
docker compose exec worker node -e "const net=require('net'); const s=net.connect(6379,'redis',()=>{console.log('redis:6379 reachable'); s.end();}); s.on('error',e=>{console.error(e.message); process.exit(1);});"
```

```
0.0.0.0:8080
HTTP/1.1 200 OK
content-type: application/json

{"status":"ok","database":"ok","redis":"ok"}
redis:6379 reachable
```

The final fix was several small corrections, not one magical command. The API command had to match the mounted filesystem. The database URL had to use the Compose service name. Postgres needed a readiness check. The browser had to use the host port, while containers used service names and container ports.

## Putting It All Together
<!-- section-summary: Good Docker debugging turns symptoms into evidence, then changes only the boundary that the evidence points to. -->

A useful Docker debugging habit is to keep each command tied to one question. `docker compose ps` asks which services are alive. `docker compose logs` asks what the process said. `docker inspect` asks what Docker created. `docker image inspect` asks what the image declares. `docker compose run --entrypoint` asks what the service filesystem and tools look like under the Compose configuration. `docker compose config` asks what Compose will actually apply.

Here is the quick field guide for the support-ticket stack:

| Symptom | First evidence | Likely boundary |
|---|---|---|
| API says `Restarting (1)` | `docker compose logs api` | Application startup, missing files, bad config |
| `Cannot find module /app/dist/server.js` | `docker compose run --entrypoint sh api -lc 'ls -la dist'` | Image files, command, bind mount |
| `ECONNREFUSED 127.0.0.1:5432` | `docker compose exec api env` | Environment value and service discovery |
| Browser cannot reach API | `docker compose port api 3000` and API startup log | Host port mapping and app bind address |
| API reaches Redis but worker fails | `docker compose logs worker` and service DNS checks | Worker config, queue URL, network |
| Database data looks stale | `docker volume inspect ...` | Named volume and migration state |
| Cold start fails sometimes | `docker inspect db --format ...Health...` | Health check, dependency readiness, app retries |
| Runtime differs from the Compose file you read | `docker compose config` | Override files, interpolation, expanded syntax |

Industrial teams build these checks into daily work. They keep a short runbook for common incidents, make applications log the address and port they bind to, avoid printing secrets in logs, add health endpoints that check real dependencies, use retries around database and Redis connections, and run `docker compose config --quiet` in CI for Compose projects. They also separate development bind mounts from production image runs, because that one difference explains many confusing file and dependency bugs.

The most important pattern is simple: use the current symptom to choose the next boundary. State leads to logs. Logs lead to command, files, or configuration. Configuration leads to network, storage, and health checks. Once the evidence points to one boundary, change that boundary deliberately and check the state again.

![Debugging summary infographic showing symptom, evidence, boundary, fix, and verify as a five-step Docker debugging loop](/content-assets/articles/article-containers-orchestration-docker-debugging-docker-containers/debugging-summary.png)

*The final loop is the whole article in one pass: observe the symptom, collect evidence, name the boundary, make one focused fix, and verify the app.*

## References

- [docker compose ps](https://docs.docker.com/reference/cli/docker/compose/ps/) - Official Docker CLI reference for listing Compose project containers and statuses.
- [docker compose logs](https://docs.docker.com/reference/cli/docker/compose/logs/) - Official Docker CLI reference for viewing service logs, tailing logs, and filtering log output.
- [docker inspect](https://docs.docker.com/reference/cli/docker/inspect/) - Official Docker CLI reference for low-level object inspection and Go template formatting.
- [docker image inspect](https://docs.docker.com/reference/cli/docker/image/inspect/) - Official Docker CLI reference for inspecting image metadata such as command, entrypoint, and working directory.
- [docker compose config](https://docs.docker.com/reference/cli/docker/compose/config/) - Official Docker CLI reference for rendering the resolved Compose model.
- [docker compose run](https://docs.docker.com/reference/cli/docker/compose/run/) - Official Docker CLI reference for running one-off commands against a Compose service.
- [Networking in Compose](https://docs.docker.com/compose/how-tos/networking/) - Docker guidance on Compose default networks and service-name discovery.
- [Set environment variables in Compose](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/) - Docker guidance on setting container environment variables in Compose.
- [Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) - Docker documentation for host paths mounted into containers.
- [Volumes](https://docs.docker.com/engine/storage/volumes/) - Docker documentation for Docker-managed persistent data volumes.
- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) - Docker reference for Dockerfile metadata, including `HEALTHCHECK`.
- [Control startup and shutdown order in Compose](https://docs.docker.com/compose/how-tos/startup-order/) - Docker guidance for `depends_on`, health checks, and startup order.
