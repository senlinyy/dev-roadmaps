---
title: "Services and Resources"
description: "Trace how Compose services use networks, ports, volumes, environment, and health checks to create a working local stack."
overview: "A Compose file is an application model, and Docker makes that model real through containers, networks, ports, volumes, environment values, secrets, and health checks."
tags: ["docker", "compose", "networks", "volumes"]
order: 2
id: article-containers-orchestration-docker-compose-services-networks-and-volumes
---

## Table of Contents

1. [From App Map to Runtime Pieces](#from-app-map-to-runtime-pieces)
2. [Services Are the Stable Roles](#services-are-the-stable-roles)
3. [Networks Give Services Private Names](#networks-give-services-private-names)
4. [Ports Depend on Who Is Calling](#ports-depend-on-who-is-calling)
5. [Volumes Give Data Its Own Lifetime](#volumes-give-data-its-own-lifetime)
6. [Bind Mounts Put Host Files in the Container](#bind-mounts-put-host-files-in-the-container)
7. [Environment, Env Files, and Secrets](#environment-env-files-and-secrets)
8. [Health Checks and Dependency Conditions](#health-checks-and-dependency-conditions)
9. [A Practical Debugging Routine](#a-practical-debugging-routine)
10. [The Full Notes Stack](#the-full-notes-stack)
11. [What's Next](#whats-next)

## From App Map to Runtime Pieces
<!-- section-summary: Compose starts as a YAML application map, then Docker turns each part of that map into concrete resources with separate jobs and lifetimes. -->

In the previous article, we used Docker Compose to describe one small notes app for internal company training. The app has an `api` service for HTTP requests, a `worker` service for background jobs, a `db` service for PostgreSQL, a `redis` service for short queue messages, and `mailpit` for local email testing. That file gave the team one shared map of the app.

Now we are going one layer deeper. A Compose file says what the team wants, and Docker creates the runtime pieces that make it happen. Docker turns a **service** into one or more containers, a **network** gives containers private names, a **published port** lets the laptop reach a container, a **volume** stores files outside one container lifetime, a **bind mount** shares host files with a container, an **environment value** configures a process, a **secret** mounts sensitive data as a file, and a **health check** gives Docker a readiness signal.

That separation matters because local stack bugs usually belong to one resource at a time. The browser may fail because a published port is wrong. The API may fail because the database name should be `db` rather than `localhost`. Old rows may appear because the database volume survived a rebuild. A password may leak into logs because it was passed as a normal environment value instead of a secret file.

Here is the runtime shape we will follow through the article.

![Docker Compose runtime pieces showing host ports, containers, app-net and data-net networks, db-data volume, source bind mount, and db-password secret](/content-assets/articles/article-containers-orchestration-docker-compose-services-networks-and-volumes/compose-runtime-pieces.png)

*The runtime map separates the pieces that Compose creates or connects, so a broken stack can be debugged one resource at a time.*

The diagram has many boxes because each resource answers a different question: which process runs, which names work, which callers can connect, which files survive, which values configure the app, and which services are ready enough for other services to start.

## Services Are the Stable Roles
<!-- section-summary: A Compose service is the named role in the application, while the container is the current process Docker created for that role. -->

A **service** is a stable role in the Compose file. In our notes app, `api`, `worker`, `db`, `redis`, and `mailpit` are service names. Docker uses those definitions to create containers, and the current container can be replaced after a rebuild, a config change, or a restart while the service name stays the same.

This is why teams talk about "the API service" rather than memorizing a generated container name. Docker may create a container called `notes-dev-api-1`, remove it, and create another one later. The Compose service remains `api`, and that name is the thing other services should use in URLs and logs.

```yaml
services:
  api:
    build:
      context: .
      target: dev
    command: npm run dev
    working_dir: /workspace
    environment:
      NODE_ENV: development
      PORT: "3000"

  worker:
    build:
      context: .
      target: dev
    command: npm run worker
    working_dir: /workspace
    environment:
      NODE_ENV: development
```

The `api` and `worker` services share the same source image and run different commands. This is common in real projects. A Rails app may have `web` and `worker`; a Django app may have `web` and `celery`; a Node app may have `api` and `worker`. The image contains the application code, and the service definition chooses the runtime role.

When a service fails, the first useful question is about the process Docker created for that role. Which image did it use? Which command did it run? Which working directory did the process start in? Which environment values and mounted files did it receive? The Compose service definition is where those answers live.

```bash
docker compose ps --all
docker compose logs --tail=100 api
```

The first command shows the service containers in the project, including stopped containers when `--all` is present. The second command shows recent output from the `api` service. That pair gives the process status and the process story before we start changing YAML.

Services are the boxes in the app. The next question is how those boxes find each other.

## Networks Give Services Private Names
<!-- section-summary: Compose networks give containers a private communication space where service names resolve through Docker DNS. -->

A **Compose network** is the private network space Docker creates for service-to-service traffic. By default, Compose creates one network for the project and attaches every service to it. Containers on that network can discover each other by service name, so the API can connect to PostgreSQL at `db:5432` and Redis at `redis:6379`.

This is one of the most important daily Compose rules. Inside the `api` container, `db` means the PostgreSQL service on the project network. Inside that same container, `localhost` means the API container itself. A database URL with `localhost:5432` tells the API to call its own container, which explains many first-week Compose bugs.

```yaml
services:
  api:
    environment:
      DATABASE_HOST: db
      DATABASE_PORT: "5432"
      REDIS_URL: redis://redis:6379

  worker:
    environment:
      DATABASE_HOST: db
      DATABASE_PORT: "5432"
      REDIS_URL: redis://redis:6379
```

Docker also gives service names a stable role during container replacement. A recreated `db` container can receive a new IP address, while the service name `db` remains the address the API and worker should use. Long-running applications should reconnect through the service name after a broken connection, because existing connections can close when a container is replaced.

The default network is enough for many local stacks. Custom networks help when the file should show traffic boundaries more clearly. For the notes app, `api` needs to talk both to user-facing support tools and to data services, while `worker`, `db`, and `redis` only need the data side. That gives us a small but useful split.

```yaml
services:
  api:
    networks:
      - app-net
      - data-net

  worker:
    networks:
      - data-net

  db:
    image: postgres:18
    networks:
      - data-net

  redis:
    image: redis:8
    networks:
      - data-net

  mailpit:
    image: axllent/mailpit:v1.27
    networks:
      - app-net

networks:
  app-net:
  data-net:
```

Now the names tell a small story. The `api` service can reach `mailpit` on `app-net` and can reach `db` and `redis` on `data-net`. The `worker` only needs the data services. This kind of split is small in local development, and it trains the team to notice communication boundaries before the app grows.

Once private names work, the next confusion usually comes from ports. The important detail is who is calling.

## Ports Depend on Who Is Calling
<!-- section-summary: Published ports let the host reach a container, while containers in the same Compose network use service names and container ports. -->

A **published port** maps a port on the host machine to a port inside a container. In the notes stack, the API process listens on port `3000` inside its container, and Compose publishes that container port to `127.0.0.1:8080` on the developer laptop.

```yaml
services:
  api:
    ports:
      - "127.0.0.1:8080:3000"
```

The port mapping has three pieces. `127.0.0.1` is the host interface, `8080` is the host port, and `3000` is the container port. A browser on the laptop calls `http://127.0.0.1:8080`, while another Compose service calls `http://api:3000` on the private network.

That difference is the caller viewpoint. The browser is outside the Compose network, so it needs a published host port. The worker is inside the Compose network, so it uses the service name and the container port. Docker's Compose networking guide states this same split: host access uses the host port, and service-to-service access uses the container port.

Mailpit gives us a second example. The API sends email through Mailpit's SMTP port on the private network, while the developer opens Mailpit's web UI from the host browser.

```yaml
services:
  api:
    environment:
      SMTP_HOST: mailpit
      SMTP_PORT: "1025"

  mailpit:
    image: axllent/mailpit:v1.27
    ports:
      - "127.0.0.1:8025:8025"
```

The API uses `mailpit:1025` because it runs inside the project. The browser uses `http://127.0.0.1:8025` because it runs on the host. The SMTP port can stay private because developers usually need the web UI from the host and leave SMTP traffic inside the project network.

Binding a development port to `127.0.0.1` is a useful habit. It keeps the local API or Mailpit UI on the loopback interface instead of publishing it on every host interface. Teams still need normal laptop security, and this avoids accidentally offering a training app to the whole local network.

![Caller viewpoint rules infographic comparing a host browser using 127.0.0.1:8080 with a worker container using api:3000 and db:5432 inside the project network](/content-assets/articles/article-containers-orchestration-docker-compose-services-networks-and-volumes/caller-viewpoint-rules.png)

*The caller decides the address: the laptop uses published host ports, while containers use service names and container ports inside the project network.*

Ports answer network entry. The next resource answers data lifetime.

## Volumes Give Data Its Own Lifetime
<!-- section-summary: A named volume stores Docker-managed data outside the current container so database files can survive ordinary container replacement. -->

A **volume** is Docker-managed storage that a container can mount. Compose named volumes are useful when a service writes important data and that data should survive the current container. Databases are the classic local example because the container process can be disposable while the database files need a longer lifetime.

In the notes app, PostgreSQL stores data under `/var/lib/postgresql/data` inside the container. A named volume called `db-data` gives that path a storage location managed by Docker.

```yaml
services:
  db:
    image: postgres:18
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

The left side, `db-data`, is the volume name in the Compose file. The right side, `/var/lib/postgresql/data`, is the path inside the container. When `docker compose up` creates the project, Docker creates the named volume when it is missing, and later runs can reuse it.

This lifetime is helpful during normal development. The team can rebuild the API image, recreate the database container, and keep local notes, migrations, and seed data. The same lifetime can surprise people during debugging because deleting a container and rebuilding an image can leave database rows in place.

```bash
docker compose ps --all
docker volume ls --filter label=com.docker.compose.project=notes-dev
docker volume inspect notes-dev_db-data
```

These commands separate container status from volume status. The `docker compose ps --all` output talks about service containers. The `docker volume` commands talk about storage that can remain after a container is gone. That distinction explains why a "fresh rebuild" can still show yesterday's rows.

Teams use named volumes for more than databases. They also use them for package caches, search index data, local object storage, and shared scratch data between helper services. The production version of the idea is durable storage with backup and restore procedures. The local Compose version teaches the same habit: process lifetime and data lifetime are two different things.

Volumes keep Docker-managed data. Bind mounts bring host files directly into the container.

## Bind Mounts Put Host Files in the Container
<!-- section-summary: A bind mount connects a host path to a container path, which makes development fast and also makes host-path mistakes visible at runtime. -->

A **bind mount** takes a file or directory from the host machine and mounts it into the container. This is the usual development pattern for source code because the editor writes files on the laptop and the running container sees those edits without a new image build.

For the notes API, the team can mount the project directory into `/workspace` and run the development server from there.

```yaml
services:
  api:
    build:
      context: .
      target: dev
    working_dir: /workspace
    command: npm run dev
    volumes:
      - type: bind
        source: .
        target: /workspace
```

That mount gives the container the host source tree. If a developer changes `src/routes/notes.ts`, the file changes inside `/workspace/src/routes/notes.ts` too, and the development server can reload. This is why bind mounts appear so often in local Compose files and much less often in production deployment files.

Bind mounts have a sharp edge. When a host directory is mounted over a container directory that already has files, the mount hides the files that came from the image at that path. If the image installed dependencies in `/workspace/node_modules` and the host project has a different `node_modules` state, the container can suddenly see the host version or no directory at all.

A common Node development pattern keeps source code on a bind mount and dependencies in a named volume. The source follows host edits, while container-installed dependencies keep a Docker-managed lifetime.

```yaml
services:
  api:
    volumes:
      - type: bind
        source: .
        target: /workspace
      - api-node-modules:/workspace/node_modules

volumes:
  api-node-modules:
```

Bind mounts can also write back to the host by default. That is useful when a formatter, code generator, or test runner writes files that should appear in the working tree. It is risky for config files and credentials. For read-only host files, Compose can mark the mount as read-only.

```yaml
services:
  api:
    volumes:
      - type: bind
        source: ./config/local-ca.pem
        target: /workspace/config/local-ca.pem
        read_only: true
```

Now we have processes, names, ports, and files. The next piece is configuration: the values that tell each process which names, ports, and credentials to use.

## Environment, Env Files, and Secrets
<!-- section-summary: Environment values configure a container process, env files organize ordinary settings, and secrets mount sensitive values as files for only the services that request them. -->

An **environment variable** is a key-value setting passed into a process. Applications use environment values for runtime configuration such as the app mode, port, database host, Redis URL, and SMTP host. In Compose, the `environment` section sets values inside the service container.

```yaml
services:
  api:
    environment:
      NODE_ENV: development
      PORT: "3000"
      DATABASE_HOST: db
      DATABASE_PORT: "5432"
      DATABASE_NAME: notes
      DATABASE_USER: notes
      REDIS_URL: redis://redis:6379
      SMTP_HOST: mailpit
      SMTP_PORT: "1025"
```

This works well for values that are safe to review in the Compose file. It also makes the resource connections visible. The API uses `db` because the database is a Compose service. The API uses `mailpit` because Mailpit is another service. The values show runtime wiring in plain sight.

A `.env` file next to `compose.yaml` has a different job. Compose uses it for variable interpolation in the Compose model, so teams often put host ports, image tags, and local defaults there.

```dotenv
NOTES_API_PORT=8080
MAILPIT_WEB_PORT=8025
POSTGRES_VERSION=18
REDIS_VERSION=8
```

```yaml
services:
  api:
    ports:
      - "127.0.0.1:${NOTES_API_PORT}:3000"

  db:
    image: postgres:${POSTGRES_VERSION}

  redis:
    image: redis:${REDIS_VERSION}

  mailpit:
    ports:
      - "127.0.0.1:${MAILPIT_WEB_PORT}:8025"
```

An `env_file` loads environment variables into the container. Teams use it when a service has many ordinary settings and the main Compose file would get noisy. The service can still keep important wiring visible in `environment`, and Docker Compose gives values in `environment` precedence over values from `env_file`.

```yaml
services:
  api:
    env_file:
      - ./config/api.env
    environment:
      DATABASE_HOST: db
      REDIS_URL: redis://redis:6379
```

Sensitive values deserve a different path. A **secret** is data such as a password, token, or certificate that should only be available to the services that ask for it. Compose secrets are defined at the top level and then granted to individual services. Inside the container, the short syntax mounts the secret as a read-only file under `/run/secrets/<secret_name>`.

```yaml
services:
  api:
    secrets:
      - db-password
    environment:
      DATABASE_PASSWORD_FILE: /run/secrets/db-password

  worker:
    secrets:
      - db-password
    environment:
      DATABASE_PASSWORD_FILE: /run/secrets/db-password

  db:
    image: postgres:18
    secrets:
      - db-password
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db-password

secrets:
  db-password:
    file: ./secrets/db-password.txt
```

This pattern keeps the password out of the normal environment block. The application reads the file path from `DATABASE_PASSWORD_FILE`, and PostgreSQL reads its password from `POSTGRES_PASSWORD_FILE`. The secret source file still needs normal local protection, such as `.gitignore`, restricted sharing, and rotation when a shared value leaks. Compose secrets help with container injection, and secret hygiene around the source file still matters.

Configuration lets services start with the right values. Health checks tell Compose which services are ready enough for their dependents.

## Health Checks and Dependency Conditions
<!-- section-summary: Health checks define readiness signals, and depends_on conditions let startup order wait for those signals when a service needs them. -->

A **health check** is a command Docker runs inside a container to decide whether that container reports `healthy`, `unhealthy`, or still starting. The check should test the thing other services really need. For a database, that usually means accepting database connections. For an API, it may mean answering a local `/healthz` endpoint or running a small script that checks the process.

The notes database can use `pg_isready`, which is included in the PostgreSQL image. The double dollar signs are important in this YAML because Compose performs variable interpolation before the container starts. `$${POSTGRES_USER}` leaves `${POSTGRES_USER}` for the shell inside the container.

```yaml
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_DB: notes
      POSTGRES_USER: notes
      POSTGRES_PASSWORD_FILE: /run/secrets/db-password
    secrets:
      - db-password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
```

`depends_on` expresses startup relationships between services. The basic form starts dependencies before dependents. The long form can add conditions, and those conditions make the startup rule more precise.

```yaml
services:
  api:
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
      migrate:
        condition: service_completed_successfully

  migrate:
    build:
      context: .
      target: dev
    command: npm run db:migrate
    depends_on:
      db:
        condition: service_healthy
```

The three conditions have different meanings. `service_started` means Compose has started the dependency container, which is often enough for a simple Redis service in a local stack. `service_healthy` means the dependency has a health check and that check has passed, which is a strong fit for PostgreSQL. `service_completed_successfully` fits one-shot jobs such as a migration service that should exit with code `0` before the API starts.

Health checks and startup conditions solve the first startup race. They still need application-level retries. A laptop can sleep, a database container can restart, and a network connection can close after the API has already started. A real API should retry database and Redis connections with clear logs instead of assuming the first connection attempt is the only one that matters.

The resource map is now complete enough to debug. The trick is to start from the symptom and move to the resource that owns it.

## A Practical Debugging Routine
<!-- section-summary: Compose debugging works best when each symptom points to the resource that owns the behavior, then one command checks that resource directly. -->

When the notes stack breaks, the team should avoid changing five things at once. Compose gives us a steadier routine: render the model, check service state, read logs, test the caller viewpoint, inspect data lifetime, and check readiness. Each step answers one small question.

Start with the resolved Compose model when a value looks surprising. This catches `.env` interpolation, multiple `-f` files, short syntax expansion, and environment overrides before anyone chases a runtime bug.

```bash
docker compose config
```

The output shows the model Docker Compose will apply. If the API port is wrong there, the fix belongs in `.env`, the shell environment, or the Compose file. If the value is correct there, the problem moved to runtime.

Next, check service state and logs. A service that exited needs process logs before network tests. A service that is still starting may need its health check output. A service that is healthy and unreachable from the host or another service points us toward ports or networks.

```bash
docker compose ps --all
docker compose logs --tail=100 api
docker compose logs --tail=100 db
```

For host access, test the published port from the host viewpoint. The API has to be reachable through the host port, while Mailpit's web UI has to be reachable through its own host port.

```bash
docker compose port api 3000
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8025
```

If the browser fails and `docker compose port api 3000` shows no mapping, the issue belongs to `ports`. If the host port works and the worker still fails to call the API, the issue belongs to service-to-service networking or the worker's environment.

For service-to-service access, inspect the calling container. The container's environment values should use service names and container ports. The exact network tools depend on the image, so teams often keep a tiny debug image or add basic tools to development images.

```bash
docker compose exec api printenv DATABASE_HOST DATABASE_PORT REDIS_URL SMTP_HOST SMTP_PORT
docker compose exec db pg_isready -U notes -d notes
docker compose exec redis redis-cli ping
```

For data surprises, check whether the named volume still exists. Old rows after a rebuild usually mean the database volume did its job. A deliberate reset must include volume removal, which is a separate operation from container recreation.

```bash
docker volume ls --filter label=com.docker.compose.project=notes-dev
docker compose down
docker compose down --volumes
```

The last command removes named volumes for the Compose project, so it belongs in deliberate reset instructions rather than casual debugging. This is the difference between "restart the stack" and "erase my local database."

For mount surprises, check the container path that the process sees. A missing dependency directory, a stale config file, or an unexpected generated file often points to a bind mount hiding image contents or writing back to the host.

```bash
docker compose exec api pwd
docker compose exec api ls -la /workspace
docker compose exec api ls -la /workspace/node_modules
```

For readiness surprises, check health status and the health-check command. A healthy status means the configured check passed. It proves only what the check tested, so a weak health check can still leave the application with a real dependency problem.

```bash
docker compose ps db
docker inspect --format='{{json .State.Health.Status}}' "$(docker compose ps -q db)"
```

That routine turns Compose debugging into a set of small facts. The service owns process output, the network owns service names, ports own host entry, volumes own durable data, bind mounts own host-file visibility, environment owns runtime settings, secrets own sensitive files, and health checks own readiness signals.

## The Full Notes Stack
<!-- section-summary: The complete Compose file brings the resources together so the team can review services, networks, ports, storage, config, secrets, and readiness in one place. -->

Here is a full development Compose file for the notes training app. It includes the same service roles from the first article and adds the resource choices we just walked through.

```yaml
name: notes-dev

services:
  api:
    build:
      context: .
      target: dev
    command: npm run dev
    working_dir: /workspace
    ports:
      - "127.0.0.1:${NOTES_API_PORT:-8080}:3000"
    env_file:
      - ./config/api.env
    environment:
      NODE_ENV: development
      PORT: "3000"
      DATABASE_HOST: db
      DATABASE_PORT: "5432"
      DATABASE_NAME: notes
      DATABASE_USER: notes
      DATABASE_PASSWORD_FILE: /run/secrets/db-password
      REDIS_URL: redis://redis:6379
      SMTP_HOST: mailpit
      SMTP_PORT: "1025"
    secrets:
      - db-password
    volumes:
      - type: bind
        source: .
        target: /workspace
      - api-node-modules:/workspace/node_modules
    networks:
      - app-net
      - data-net
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "node", "./scripts/healthcheck.js"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  worker:
    build:
      context: .
      target: dev
    command: npm run worker
    working_dir: /workspace
    env_file:
      - ./config/worker.env
    environment:
      NODE_ENV: development
      DATABASE_HOST: db
      DATABASE_PORT: "5432"
      DATABASE_NAME: notes
      DATABASE_USER: notes
      DATABASE_PASSWORD_FILE: /run/secrets/db-password
      REDIS_URL: redis://redis:6379
    secrets:
      - db-password
    volumes:
      - type: bind
        source: .
        target: /workspace
      - worker-node-modules:/workspace/node_modules
    networks:
      - data-net
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully

  migrate:
    build:
      context: .
      target: dev
    command: npm run db:migrate
    working_dir: /workspace
    environment:
      NODE_ENV: development
      DATABASE_HOST: db
      DATABASE_PORT: "5432"
      DATABASE_NAME: notes
      DATABASE_USER: notes
      DATABASE_PASSWORD_FILE: /run/secrets/db-password
    secrets:
      - db-password
    volumes:
      - type: bind
        source: .
        target: /workspace
      - migrate-node-modules:/workspace/node_modules
    networks:
      - data-net
    depends_on:
      db:
        condition: service_healthy
    restart: "no"

  db:
    image: postgres:${POSTGRES_VERSION:-18}
    environment:
      POSTGRES_DB: notes
      POSTGRES_USER: notes
      POSTGRES_PASSWORD_FILE: /run/secrets/db-password
    secrets:
      - db-password
    volumes:
      - db-data:/var/lib/postgresql/data
    networks:
      - data-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  redis:
    image: redis:${REDIS_VERSION:-8}
    networks:
      - data-net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  mailpit:
    image: axllent/mailpit:v1.27
    ports:
      - "127.0.0.1:${MAILPIT_WEB_PORT:-8025}:8025"
    networks:
      - app-net

networks:
  app-net:
  data-net:

volumes:
  db-data:
  api-node-modules:
  worker-node-modules:
  migrate-node-modules:

secrets:
  db-password:
    file: ./secrets/db-password.txt
```

The file is longer than the first article's version because it makes the runtime choices explicit. The `api` and `worker` services share code and run different commands. The `db` and `redis` services stay private on `data-net`. Mailpit exposes a browser UI on the host while its SMTP port stays private to `api`. The database data lives in `db-data`, source code comes from bind mounts, sensitive database credentials arrive through a secret file, and startup waits for database and Redis health before starting the app roles.

Real teams often split development conveniences into override files, profiles, or separate local files as the stack grows. The core idea stays the same: Compose gives reviewers one place to see which resources exist, which services can talk, which host ports are exposed, which data survives, and which checks define readiness.

![Compose resource debug map with six symptoms mapped to ports, network and service name, volume, bind mount, secret path, and health check](/content-assets/articles/article-containers-orchestration-docker-compose-services-networks-and-volumes/compose-resource-debug-map.png)

*The debug map turns the resource layer into a symptom checklist, with `config`, `ps`, and `logs` as the first evidence commands.*

## What's Next

The resource layer is now visible. You can look at a Compose file and tell which pieces run processes, which names services use, which ports the host can reach, which files survive, which host paths are mounted, which values configure the app, and which checks gate startup.

The next article turns this into the daily development loop. We will use the same notes app to start the stack, follow logs, run one-off commands, apply migrations, use optional tools, update code, and reset local state without deleting the wrong resource.

---

**References**

- [Define services in Docker Compose](https://docs.docker.com/reference/compose-file/services/) - Documents service attributes including `build`, `command`, `ports`, `environment`, `env_file`, `volumes`, `healthcheck`, `depends_on`, and service-level `secrets`.
- [Define and manage networks in Docker Compose](https://docs.docker.com/reference/compose-file/networks/) - Documents the top-level `networks` element and how services attach to named networks.
- [Networking in Compose](https://docs.docker.com/compose/how-tos/networking/) - Explains the default project network, service-name DNS, dynamic container IPs, and the difference between host ports and container ports.
- [Define and manage volumes in Docker Compose](https://docs.docker.com/reference/compose-file/volumes/) - Documents top-level named volumes and how services mount reusable Docker-managed storage.
- [Volumes](https://docs.docker.com/engine/storage/volumes/) - Explains volume use cases and how volume data exists outside the lifecycle of a container.
- [Bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) - Explains host-path mounts, source-code sharing, mount hiding, and read-only bind mounts.
- [Environment variables in Compose](https://docs.docker.com/compose/how-tos/environment-variables/) - Links to Docker's guidance for setting, interpolating, and understanding environment variables in Compose.
- [Manage secrets securely in Docker Compose](https://docs.docker.com/compose/how-tos/use-secrets/) - Documents top-level secrets, per-service grants, and `/run/secrets/<secret_name>` mounts.
- [Control startup and shutdown order in Compose](https://docs.docker.com/compose/how-tos/startup-order/) - Documents dependency startup order and `depends_on` conditions such as `service_started`, `service_healthy`, and `service_completed_successfully`.
- [docker compose config](https://docs.docker.com/reference/cli/docker/compose/config/) - Documents rendering the resolved Compose model after file merging, variable resolution, and short-syntax expansion.
- [docker compose ps](https://docs.docker.com/reference/cli/docker/compose/ps/) - Documents listing Compose project containers with status and exposed ports.
- [docker compose logs](https://docs.docker.com/reference/cli/docker/compose/logs/) - Documents viewing service logs and following log output.
- [docker compose exec](https://docs.docker.com/reference/cli/docker/compose/exec/) - Documents running commands inside a Compose service container.
