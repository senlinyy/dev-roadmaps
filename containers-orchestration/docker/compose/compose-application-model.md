---
title: "Compose Model"
description: "Understand Docker Compose as an application model that turns separate container settings into one reviewable graph."
overview: "Compose turns the separate Docker settings for an API, worker, database, and support tools into one application map that a team can review and run together."
tags: ["docker", "compose", "yaml", "services"]
order: 1
id: article-containers-orchestration-containerization-docker-compose
aliases:
  - docker-compose
  - containers-orchestration/containerization/docker-compose.md
  - containers-orchestration/docker/docker-compose.md
---

## Table of Contents

1. [The App We Will Use](#the-app-we-will-use)
2. [Why Compose Exists](#why-compose-exists)
3. [Compose as an Application Model](#compose-as-an-application-model)
4. [Project Boundaries and Names](#project-boundaries-and-names)
5. [Services as Stable Roles](#services-as-stable-roles)
6. [compose.yaml as the Application Graph](#composeyaml-as-the-application-graph)
7. [How Compose Resolves Resources](#how-compose-resolves-resources)
8. [Startup Order and Health](#startup-order-and-health)
9. [Daily Commands That Use the Model](#daily-commands-that-use-the-model)
10. [Common Modeling Mistakes](#common-modeling-mistakes)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The App We Will Use
<!-- section-summary: We will follow one small notes and training app so every Compose concept has the same concrete example. -->

We are going to use a small internal training app through the whole article. The app lets employees write notes while they move through short lessons. It has an HTTP API, a background worker, a PostgreSQL database, Redis for queue messages, and Mailpit for local email testing.

That mix gives us the real shape of a small team app without turning the example into a giant platform. The **API** handles browser requests. The **worker** sends reminder emails and cleans up old draft notes. The **database** stores users, lessons, notes, and progress. **Redis** holds short queue messages between the API and worker. **Mailpit** catches email during development so nobody sends training reminders to real people by accident.

| Service | Role in the app | Main connections |
| --- | --- | --- |
| `api` | Serves HTTP requests for notes and lessons | Talks to `db`, `redis`, and `mailpit` |
| `worker` | Processes queued jobs in the background | Talks to `db`, `redis`, and `mailpit` |
| `db` | Stores application data in PostgreSQL | Uses a named volume for data files |
| `redis` | Holds short queue messages | Stays private on the project network |
| `mailpit` | Shows local email in a browser UI | Publishes a host port for developers |

This app starts as separate container settings. Someone knows the Postgres image. Someone knows the API command. Someone else knows the Redis address the worker needs. Compose gives the team one place to describe how those pieces connect.

## Why Compose Exists
<!-- section-summary: Compose exists because a multi-container app needs one shared description instead of repeated Docker commands on every laptop and CI job. -->

**Docker Compose** is Docker's tool for defining and running multi-container applications from a YAML file. The official Docker Compose overview describes it as a way to manage services, networks, and volumes in a single YAML configuration file, then create and start the services with one command.

Without Compose, the notes app turns into a pile of commands. A developer needs to create a network, create a volume, start Postgres, start Redis, start Mailpit, start the API with the right environment variables, and start the worker with almost the same settings.

```bash
docker network create notes-net
docker volume create notes-db-data

docker run -d \
  --name notes-db \
  --network notes-net \
  --mount source=notes-db-data,target=/var/lib/postgresql/data \
  -e POSTGRES_DB=notes \
  -e POSTGRES_USER=notes \
  -e POSTGRES_PASSWORD=notes_dev_password \
  postgres:18

docker run -d \
  --name notes-redis \
  --network notes-net \
  redis:8

docker run -d \
  --name notes-mailpit \
  --network notes-net \
  -p 127.0.0.1:8025:8025 \
  axllent/mailpit:v1.27

docker run -d \
  --name notes-api \
  --network notes-net \
  -p 127.0.0.1:8080:3000 \
  -e DATABASE_URL=postgres://notes:notes_dev_password@notes-db:5432/notes \
  -e REDIS_URL=redis://notes-redis:6379 \
  -e SMTP_HOST=notes-mailpit \
  -e SMTP_PORT=1025 \
  ghcr.io/example/notes-api:dev
```

Those commands show the problem clearly. The application shape lives in terminal history, wiki pages, onboarding notes, and memory. The next developer can miss one flag and end up with a database that loses data, an API that points at the wrong host, or a port that is exposed to the whole network.

Compose moves those choices into a file that the team can review. The file says which service roles exist, which images or build contexts they use, which ports the host can reach, which service names containers use, and which data needs a longer lifetime than a container.

## Compose as an Application Model
<!-- section-summary: The Compose model is the graph of services, networks, volumes, configs, secrets, and project boundaries that Docker creates from the YAML. -->

An **application model** is the description of the app as a connected system. For Compose, that model includes **services**, **networks**, **volumes**, **configs**, **secrets**, and the **project** boundary that groups one running copy of the app. Docker's "How Compose works" page uses these same concepts to explain how Compose turns a file into application resources.

In the notes app, the model says the API depends on the database and Redis, the worker uses the same database and queue, Mailpit receives local email, and the database stores files in a named volume. That graph matters more than any single container, because containers can be recreated while the application roles and relationships stay stable.

![Docker Compose app graph showing a browser, api, worker, db, redis, mailpit, and db-data volume inside one notes-dev project boundary](/content-assets/articles/article-containers-orchestration-containerization-docker-compose/compose-app-graph.png)

*The graph keeps the project boundary, service names, host entry point, and database volume visible together, which is the part a pile of `docker run` commands usually hides.*

The graph also gives reviewers something useful to discuss. If a teammate adds a search service later, the pull request can show whether the search service joins the right network, whether it needs a volume, whether the API receives the correct URL, and whether any host ports were opened.

Real teams use Compose in a few places. Local development is the common one because everyone gets the same app shape on a laptop. CI jobs also use Compose to run integration tests against real dependencies. Some teams run simple apps on a single Docker host with Compose, while larger production systems usually map the same roles and dependencies into a scheduler such as Kubernetes, ECS, Nomad, or another platform.

## Project Boundaries and Names
<!-- section-summary: A Compose project is one named running copy of the app, and the project name keeps resources from colliding with another copy. -->

A **Compose project** is one deployment of a Compose application. The project name groups the containers, networks, volumes, labels, and other resources that belong to that copy. The same `compose.yaml` can run twice on the same machine if each run uses a different project name.

The default project name usually comes from the directory that contains the Compose file. If the app is checked out in a folder called `notes-training`, Compose can create resources with names such as `notes-training-api-1`, `notes-training-db-1`, `notes-training_default`, and `notes-training_db-data`.

That boundary matters during daily work. One developer might run the stable branch as `notes-main` and a feature branch as `notes-search`. Both projects can define services named `api`, `db`, and `redis`, and each API will resolve its own database inside its own project network.

```bash
docker compose -p notes-main up -d
docker compose -p notes-search up -d
docker compose -p notes-search ps
docker compose -p notes-search down
```

Docker documents the project name precedence in this order: the `-p` flag, the `COMPOSE_PROJECT_NAME` environment variable, the top-level `name` field, the project directory name, and finally the current directory name when no Compose file is specified. The `-p` flag works well for feature branches and CI jobs because each run can choose a unique boundary.

```bash
COMPOSE_PROJECT_NAME=notes-ci-428 docker compose up -d --build
docker compose -p notes-demo up -d
```

The top-level `name` field belongs in the file when the team wants a predictable default. For the training app, `name: notes-dev` gives shared scripts a stable name. In CI, the command should still override the name so two builds never fight over the same resources.

```yaml
name: notes-dev

services:
  api:
    build:
      context: .
      target: dev
```

Project names have a practical naming rule: use lowercase letters, numbers, dashes, and underscores, and start with a lowercase letter or number. That rule keeps Docker resource names valid and predictable across platforms.

![Two Docker Compose project copies named notes-main and notes-search showing the same api, db, and redis service names with separate networks and volumes](/content-assets/articles/article-containers-orchestration-containerization-docker-compose/project-names-boundaries.png)

*Two project names can run the same service names side by side, while Docker keeps their networks and volumes separate.*

## Services as Stable Roles
<!-- section-summary: Services are the stable roles in the application, while containers are replaceable runtime instances of those roles. -->

A **service** is a stable role in the application. Docker runs one or more containers from the service definition, but the service name is the thing the rest of the app should use. In our app, `api` is the web role, `worker` is the job-processing role, and `db` is the database role.

This distinction saves a lot of confusion. Compose can recreate a container after a rebuild and give the new container a fresh internal IP address. The service name stays stable on the project network, so the API can keep using `db:5432` and the worker can keep using `redis:6379`.

```yaml
services:
  api:
    build:
      context: .
      target: dev
    command: npm run dev
    environment:
      PORT: "3000"
      DATABASE_URL: postgres://notes:notes_dev_password@db:5432/notes
      REDIS_URL: redis://redis:6379
```

The `DATABASE_URL` points at `db`, because `db` is the Compose service name. The API container can use that role name instead of the generated container name, the container IP address, or the host port. Inside the Compose network, the service name is the stable address.

Services also let one image play more than one role. Many web apps use the same source image for an HTTP process and a worker process. The image contains the code, and the Compose service definition chooses the command that role should run.

```yaml
services:
  api:
    build:
      context: .
      target: dev
    command: npm run dev

  worker:
    build:
      context: .
      target: dev
    command: npm run worker
```

That pattern shows up in Rails apps with `web` and `worker`, Django apps with `web` and `celery`, and Node apps with `api` and `queue-worker`. The service names describe jobs in the application, and the commands describe how each job starts.

Compose can also run more than one container for a service. If the worker processes independent queue messages, a developer can scale only that role during a test run.

```bash
docker compose up -d --scale worker=3
docker compose ps worker
```

Scaling works best when the service avoids a fixed `container_name` and avoids publishing the same host port from every replica. The service is the role; the containers are the current workers carrying that role.

## compose.yaml as the Application Graph
<!-- section-summary: The Compose file is the reviewable YAML graph that records roles, connections, storage, ports, startup relationships, and local development values. -->

The default Compose file name is `compose.yaml`, with `compose.yml` also supported. Docker still recognizes older `docker-compose.yaml` and `docker-compose.yml` names for compatibility, but the Docker docs call `compose.yaml` the preferred path.

Here is a complete local version of the notes app. It uses no top-level `version` field. Modern Compose uses the Compose Specification as the file model, and Docker documents the old top-level `version` property as obsolete and informational. If a file still has `version: "3.8"`, current Compose validates against the newest schema anyway and can warn that the field is obsolete.

```yaml
name: notes-dev

services:
  api:
    build:
      context: .
      target: dev
    command: npm run dev
    ports:
      - "127.0.0.1:8080:3000"
    environment:
      NODE_ENV: development
      PORT: "3000"
      DATABASE_URL: postgres://notes:notes_dev_password@db:5432/notes
      REDIS_URL: redis://redis:6379
      SMTP_HOST: mailpit
      SMTP_PORT: "1025"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
      mailpit:
        condition: service_started

  worker:
    build:
      context: .
      target: dev
    command: npm run worker
    environment:
      NODE_ENV: development
      DATABASE_URL: postgres://notes:notes_dev_password@db:5432/notes
      REDIS_URL: redis://redis:6379
      SMTP_HOST: mailpit
      SMTP_PORT: "1025"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
      mailpit:
        condition: service_started

  db:
    image: postgres:18
    environment:
      POSTGRES_DB: notes
      POSTGRES_USER: notes
      POSTGRES_PASSWORD: notes_dev_password
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:8

  mailpit:
    image: axllent/mailpit:v1.27
    ports:
      - "127.0.0.1:8025:8025"

volumes:
  db-data:
```

The file reads like an application graph. The top-level `services` map lists the roles. Each service says how to build or pull the container image, which command to run, which environment values the process receives, which host ports are published, and which other services should start first.

The top-level `volumes` map names storage that Docker should manage for the project. The database service mounts `db-data` into the Postgres data directory, so ordinary container replacement keeps the database files. A full reset still needs a deliberate volume removal.

The password in this example is local training data. Real teams keep production passwords out of Compose files, use secret stores in production, and keep local `.env.example` files limited to safe development defaults. Compose can model secrets and configs, but the platform that runs the app decides how those secret values are stored and protected.

## How Compose Resolves Resources
<!-- section-summary: Compose reads the YAML, applies names and overrides, resolves service references, and creates project-scoped Docker resources. -->

When you run a Compose command, Compose first builds a resolved model from the files and environment around the command. It reads the Compose file, interpolates variables, merges files passed with `-f`, expands short syntax into full objects, and resolves relative paths from the first Compose file's parent directory when multiple files are used.

That sounds abstract, so here is the practical version. A team may keep the base graph in `compose.yaml` and local laptop tweaks in `compose.local.yaml`. The `config` command shows the final model Compose will use after those files are combined.

```bash
docker compose config
docker compose -f compose.yaml -f compose.local.yaml config
```

This command is useful when a value appears from several places. If the API points at the wrong database, `docker compose config` shows the final `DATABASE_URL`. If a port comes from an override file, the rendered model shows the port before containers are created.

After Compose has the model, it creates resources inside the project boundary. With `name: notes-dev`, the default network usually appears as `notes-dev_default`, the database volume appears as `notes-dev_db-data`, and service containers receive names like `notes-dev-api-1` and `notes-dev-worker-1`.

```bash
docker compose up -d
docker compose ps
docker network ls
docker volume ls
```

Service-to-service traffic uses the project network. The API connects to Postgres with `db:5432`, because `db` is the service name on that network. A browser on the host connects to the API with `http://127.0.0.1:8080`, because the `ports` entry maps host port `8080` to container port `3000`.

```yaml
services:
  api:
    ports:
      - "127.0.0.1:8080:3000"
    environment:
      DATABASE_URL: postgres://notes:notes_dev_password@db:5432/notes
```

The two addresses serve two different callers. The host uses the published host port. Other services use the service name and container port. This caller viewpoint explains many Compose networking bugs.

Top-level resources also control ownership. A normal named volume belongs to the project and Compose can create it. An external volume tells Compose to use something that already exists and leave its lifecycle to another owner.

```yaml
services:
  db:
    image: postgres:18
    volumes:
      - shared-notes-db:/var/lib/postgresql/data

volumes:
  shared-notes-db:
    external: true
    name: team-notes-postgres-data
```

External resources need more care because the project boundary no longer owns the whole lifecycle. Teams use them for shared development databases, hand-managed networks, or infrastructure provided by another team. For most beginner projects, project-scoped resources keep the behavior easier to trace.

## Startup Order and Health
<!-- section-summary: depends_on describes startup relationships in the model, while health checks define the readiness signal that a dependent service can wait for. -->

**Startup order** describes which services should be created before another service. **Health** describes whether a running container has passed a check chosen by the service author. Docker's startup-order docs explain that Compose creates services in dependency order and waits for health checks when a dependency uses `condition: service_healthy`.

The notes API needs Postgres before it can run database queries. Starting the Postgres process and accepting SQL connections are separate moments, so the database service should expose a health check that matches what the API needs.

```yaml
services:
  api:
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  db:
    image: postgres:18
    environment:
      POSTGRES_DB: notes
      POSTGRES_USER: notes
      POSTGRES_PASSWORD: notes_dev_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:8
```

The long `depends_on` form says more than "start these first." The `db` edge waits for the health check, and the `redis` edge waits for the Redis container to start. That matches the app: Postgres needs readiness because the API will query it immediately, while Redis often starts fast enough for a simple local queue.

Health checks should test the actual thing the next service needs. For Postgres, `pg_isready` checks database readiness. For an API, a health check might call `/healthz` and confirm the process can answer requests. A health check that only tests whether a process exists can say "healthy" while the app still fails to serve traffic.

Application code still needs retries. Compose handles the initial startup shape, and containers can restart later after a laptop sleeps, a database reloads, or a network reconnects. Real API code should retry database and queue connections with clear logs, because runtime races can still happen after the first startup.

## Daily Commands That Use the Model
<!-- section-summary: Compose commands operate on the project model, so the same file supports start, inspect, logs, one-off tasks, and cleanup. -->

Once the model is in `compose.yaml`, daily work is much more repeatable. A new developer can build and start the whole notes app with one command from the project directory.

```bash
docker compose up --build
```

That command builds services with `build`, pulls images when needed, creates the project network and volume, starts services, and streams logs in the terminal. Many developers run the same thing detached once the app is stable.

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f api worker
```

Those commands keep the conversation at the service level. `ps` shows the services in the project. `logs -f api worker` follows only the API and worker logs, which helps when a queued job starts in the API and finishes in the worker.

Compose also handles one-off commands in the same project context. A migration command can run with the API image and the same database URL, network, and environment shape that the app uses.

```bash
docker compose run --rm api npm run migrate
docker compose exec api npm test
```

Cleanup has two levels. `down` removes the running service containers and project network. `down -v` also removes project volumes, which resets the local database data.

```bash
docker compose down
docker compose down -v
```

Real teams usually make the destructive command explicit in onboarding docs or scripts because `down -v` removes data. For the notes app, that means every local note and training progress row stored in the project database volume disappears.

## Common Modeling Mistakes
<!-- section-summary: Early Compose bugs usually come from mixing host addresses with service addresses, overusing fixed names, or hiding lifecycle choices in the wrong place. -->

The first common mistake is using `localhost` from inside one service to reach another service. Inside the API container, `localhost` points back to the API container. The database lives behind the `db` service name, so the API should use `db:5432` on the Compose network.

The second common mistake is using the host port for service-to-service calls. A browser on the laptop uses `http://127.0.0.1:8080`. The worker should use `http://api:3000` if it calls the API inside the project network. The caller decides which address is correct.

The third common mistake is publishing every port. The notes app publishes the API port and the Mailpit browser UI because developers need those from the host. The database and Redis can stay private on the project network, which reduces accidental access from other local processes.

The fourth common mistake is treating the generated container name as the stable identity. Compose can replace `notes-dev-api-1` after a rebuild, and scaled services may have several containers. Peer services should use `api`, `db`, `redis`, and `mailpit`, because those are the roles in the model.

The fifth common mistake is setting `container_name` for convenience. A fixed container name can collide with another project and can block scaling because every replica wants the same name. The project-service-index names look a little longer, but they preserve the project boundary.

The sixth common mistake is leaving an old top-level `version` field and assuming it selects old behavior. Current Docker Compose treats that field as backward-compatible information, validates against the current Compose Specification, and warns when the obsolete field appears. Removing it keeps the file aligned with modern Compose.

The seventh common mistake is using `depends_on` as the only readiness plan. `depends_on` gives the model a startup edge, and health checks make that edge more useful. The application still needs connection retry logic and clear failure messages because services restart and reconnect after the initial `up`.

The eighth common mistake is mixing container cleanup with data cleanup. Recreating the `db` container leaves the named volume in place, so old rows can still appear after a rebuild. Resetting data is a volume operation, usually `docker compose down -v`, and that command deserves care.

## Putting It All Together
<!-- section-summary: The Compose model gives the team one shared place to review roles, boundaries, resource lifetimes, names, and startup rules. -->

Compose turns the notes app from scattered container settings into a shared application graph. The project name creates the boundary. Services describe stable roles. The Compose file records the connections, ports, volumes, and startup rules. Docker creates the containers, network, and volume from that graph.

That changes the daily team workflow. A new developer can open `compose.yaml` and see the API, worker, database, Redis queue, and Mailpit email catcher in one place. A reviewer can spot whether a new service joins the right network, stores data in the right volume, and exposes only the ports developers need.

The model also gives you a debugging path. If the browser fails to reach the app, look at `ports`. If the API fails to reach the database, look at service names, networks, and `DATABASE_URL`. If the API starts too early, look at `depends_on`, the database health check, and application retries. If old rows keep returning after rebuilds, look at the named volume.

![Compose model review infographic connecting compose.yaml to project boundary, service roles, private names, host ports, data lifetime, and startup rules](/content-assets/articles/article-containers-orchestration-containerization-docker-compose/compose-model-review.png)

*The model review turns the article into a checklist: one app copy, clear roles, private names, host entry points, durable data, and startup rules.*

This is the real value of Compose at the beginning of the Docker Compose journey. The YAML syntax matters, but the deeper skill is seeing the app as roles, connections, boundaries, and lifetimes that the team can reason about together.

## What's Next
<!-- section-summary: The next Compose article can zoom into the Docker resources that make the model real at runtime. -->

You now have the big Compose shape: one project, several service roles, and a YAML file that describes how those roles connect. The next step is to look more closely at the resources created from that model.

We will keep using the notes app and follow the runtime pieces one by one: networks, service DNS, published ports, volumes, environment values, secrets, and health checks. Those pieces are where most real Compose debugging happens.

---

**References**

- [Docker Compose overview](https://docs.docker.com/compose/) - Defines Docker Compose as a tool for defining and running multi-container applications with services, networks, and volumes in one YAML configuration file.
- [How Compose works](https://docs.docker.com/compose/intro/compose-application-model/) - Explains the Compose application model, including services, networks, volumes, configs, secrets, projects, the default `compose.yaml` path, and model merging.
- [Compose file reference](https://docs.docker.com/reference/compose-file/) - Documents the Compose Specification as the latest recommended Compose file format.
- [Version and name top-level elements](https://docs.docker.com/reference/compose-file/version-and-name/) - Documents the obsolete top-level `version` field and the top-level `name` field for project naming.
- [Define services in Docker Compose](https://docs.docker.com/reference/compose-file/services/) - Documents service definitions, `depends_on`, commands, environment values, ports, and health checks.
- [Control startup and shutdown order in Compose](https://docs.docker.com/compose/how-tos/startup-order/) - Documents dependency order and `service_healthy` startup conditions.
- [Specify a project name](https://docs.docker.com/compose/how-tos/project-name/) - Documents project name use cases, valid project names, and project name precedence.
- [Networking in Compose](https://docs.docker.com/compose/how-tos/networking/) - Explains default networks, service-name DNS, host ports, container ports, and why containers should reference services by name.
- [Volumes top-level element](https://docs.docker.com/reference/compose-file/volumes/) - Documents named volumes, external volumes, and service-level volume usage.
- [docker compose config](https://docs.docker.com/reference/cli/docker/compose/config/) - Documents rendering the resolved Compose model for inspection.
