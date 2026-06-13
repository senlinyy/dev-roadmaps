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

1. [The App We Will Follow](#the-app-we-will-follow)
2. [Why Compose Exists](#why-compose-exists)
3. [Projects](#projects)
4. [Services](#services)
5. [The Compose File](#the-compose-file)
6. [Configuration Edges](#configuration-edges)
7. [Startup and Health](#startup-and-health)
8. [What Compose Creates](#what-compose-creates)
9. [Common Model Mistakes](#common-model-mistakes)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The App We Will Follow
<!-- section-summary: Compose makes more sense when we follow one small application from separate containers into one connected project. -->

Imagine you and I are helping a small team build a notes application for internal company training. The app has a web API, a background worker, a PostgreSQL database, Redis for short background-job queues, and Mailpit so developers can see test emails without sending real email.

Those pieces give us the full Compose story without becoming a huge platform. The **API** answers browser requests, the **worker** processes slower jobs, the **database** stores notes, **Redis** passes small queue messages, and **Mailpit** catches local email.

Here is the shape we will keep using. The table is simple on purpose, because each row will turn into a Compose service later.

| Service | Job in the app | Important connection |
| --- | --- | --- |
| `api` | Runs the HTTP API for notes | Talks to `db`, `redis`, and `mailpit` |
| `worker` | Processes background jobs | Talks to `db` and `redis` |
| `db` | Stores application data | Uses a named volume for database files |
| `redis` | Holds short queue messages | Stays private inside the project network |
| `mailpit` | Shows local email in a browser | Publishes a development-only host port |

The important thing is the relationship between the pieces. A single container command can run the API, and the useful development app needs the API, database, queue, worker, network names, ports, storage, and startup rules to line up every time.

## Why Compose Exists
<!-- section-summary: Compose exists because a multi-container app needs one shared description instead of a pile of copied Docker commands. -->

**Docker Compose** is a tool for defining and running multi-container Docker applications from a YAML file. In plain English, Compose lets a team write down the local application shape in one file, then ask Docker to create the containers and supporting resources from that file.

Before Compose, our notes app would need several separate Docker commands. You would create a network, create a volume, start the database, start Redis, start the API with the right environment variables, and then start the worker with many of the same values.

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
  --name notes-api \
  --network notes-net \
  -p 127.0.0.1:8080:3000 \
  -e DATABASE_URL=postgres://notes:notes_dev_password@notes-db:5432/notes \
  -e REDIS_URL=redis://notes-redis:6379 \
  ghcr.io/example/notes-api:dev
```

Those commands can work on one laptop for one afternoon. The problem arrives as soon as a teammate needs the same setup, the database password changes, the API needs a worker beside it, or someone forgets which volume holds the database files.

Compose turns those choices into a **reviewable application model**. The YAML file says which service roles exist, which image or build context each role uses, which ports accept host traffic, which names services use to find each other, and which data should survive container replacement.

## Projects
<!-- section-summary: A Compose project is the named boundary that groups one running copy of the application and keeps it separate from another copy. -->

A **Compose project** is one running copy of an application specification. Docker uses the project name to group resources together, label them, and keep this app separate from another app or another copy of the same app.

In local development, the project name usually comes from the directory name. A checkout in `notes-api` might create resources with names like `notes-api-api-1`, `notes-api-db-1`, and `notes-api_default`. Another checkout in `notes-review` can use the same service names in the Compose file while Docker keeps its resources in a separate project.

That boundary matters for teams that run feature branches, review apps, or training exercises on the same machine. Two projects can each define a service called `db`, and the `api` service in each project can connect to its own `db` service through the project network.

You can set the project name explicitly when a team needs predictable resource names. Teams often do this for shared scripts, demos, and repeatable training environments.

```yaml
name: notes-dev

services:
  api:
    build: .
```

The project name becomes part of the resource boundary. People usually set it explicitly for shared scripts, demos, or CI jobs, and they let Compose derive it from the directory for everyday laptop work.

## Services
<!-- section-summary: A service is the stable role in the app, while containers are the current runtime instances that implement that role. -->

A **service** is a stable role in the application. Docker implements that role by running one or more containers from the service definition, using the image, command, environment, networks, volumes, and other settings from the Compose file.

The notes app has a clear example. `api` is the service role that handles HTTP traffic. Docker might create a container named `notes-dev-api-1` today and replace it tomorrow after a rebuild, while the role in the Compose file remains `api`.

```yaml
services:
  api:
    build:
      context: .
      target: dev
    command: npm run dev
    environment:
      NODE_ENV: development
      PORT: "3000"
      DATABASE_URL: postgres://notes:notes_dev_password@db:5432/notes
      REDIS_URL: redis://redis:6379
```

This distinction saves a lot of confusion. Application code and other services should care about the service role name, like `db` or `redis`, because Compose and Docker can replace container instances while keeping the service role stable.

Services also let one image play more than one role. The `api` and `worker` services might both build from the same source code, then run different commands because one handles HTTP requests and the other processes queued jobs.

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

That pattern shows up in real teams all the time. A Rails app might have `web` and `worker`, a Django app might have `web` and `celery`, and a Node.js app might have `api` and `queue-worker`, all sharing the same source image with different commands.

## The Compose File
<!-- section-summary: The Compose file is the YAML model that tells Docker which service roles, networks, volumes, and configuration values belong together. -->

A **Compose file** is the YAML file that defines the project. Most projects call it `compose.yaml`, and modern Compose reads it through the Compose Specification, which covers services, networks, volumes, configs, secrets, and related options.

Here is a complete first version of the notes app. It includes the service roles, host ports, private service addresses, volume, and startup checks in one place.

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

  worker:
    build:
      context: .
      target: dev
    command: npm run worker
    environment:
      DATABASE_URL: postgres://notes:notes_dev_password@db:5432/notes
      REDIS_URL: redis://redis:6379
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

This file describes the application in layers. The top-level `services` map defines the roles, each role defines its container settings, and the top-level `volumes` section names storage that Docker should manage for the project.

Modern Compose files usually omit the old top-level `version` field. Older tutorials used `version: "3.8"` or similar values during the era of separate Compose file formats; current Docker Compose uses the Compose Specification as the main file model.

## Configuration Edges
<!-- section-summary: Environment values, ports, networks, and volumes describe the edges between services, the host, and persistent state. -->

A Compose file becomes useful because it describes the **edges** around each service. An edge is a connection from one thing to another: the host to the API through a published port, the API to the database through a service name, or the database container to persistent files through a volume.

For our notes app, the API has a host edge and two private service edges. The host edge is `127.0.0.1:8080:3000`, which lets a browser on the laptop reach the API container. The private edges are `db:5432` and `redis:6379`, which only make sense from containers on the project network.

```yaml
services:
  api:
    ports:
      - "127.0.0.1:8080:3000"
    environment:
      DATABASE_URL: postgres://notes:notes_dev_password@db:5432/notes
      REDIS_URL: redis://redis:6379
```

The `ports` value describes traffic from the host into a container. The `DATABASE_URL` and `REDIS_URL` values describe traffic from one service container to another service container on the Compose network.

Volumes describe a different kind of edge. The database service uses a named volume because database files should survive ordinary container replacement during development. Recreating the `db` container should keep the rows unless a developer deliberately removes the volume.

```yaml
services:
  db:
    image: postgres:18
    volumes:
      - db-data:/var/lib/postgresql/data

volumes:
  db-data:
```

This is where Compose starts to feel like an app diagram written as YAML. Services are the boxes, networks and ports are communication lines, environment values carry addresses and settings, and volumes carry state across container lifetimes.

## Startup and Health
<!-- section-summary: Startup rules express which services need other services, while health checks describe the readiness signal Compose should wait for. -->

**Startup order** describes which services Compose should start before other services. **Health** describes whether a container has passed a check that the service author chose, such as Postgres accepting connections through `pg_isready`.

The notes API needs Postgres before it can run database queries. Starting the database container process and having a database ready for connections are two different moments, so the database service should expose a health check that matches the thing the API needs.

```yaml
services:
  api:
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:18
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
```

This does two things for the local app. Compose starts `db` before `api`, and the `service_healthy` condition tells Compose to wait until the database health check passes before starting the API service.

Health checks still need good application behavior. A real API should retry database connections during startup because containers can restart, networks can reconnect, and databases can take longer than expected after a laptop wakes from sleep.

## What Compose Creates
<!-- section-summary: Compose turns the YAML model into Docker resources such as containers, networks, volumes, labels, and port bindings. -->

When you run `docker compose up`, Compose reads the file and creates Docker resources for the project. It creates containers for services, a default network when the file relies on default networking, named volumes, labels that record the project and service, and host port bindings for services that publish ports.

The resources have different lifetimes. A service container can be replaced after a rebuild, the project network usually lives while the project runs, and a named volume can keep data across many container replacements.

```mermaid
flowchart TD
    ComposeFile["compose.yaml"]
    Project["notes-dev project"]
    Api["api container"]
    Worker["worker container"]
    Db["db container"]
    Redis["redis container"]
    Mailpit["mailpit container"]
    Network["notes-dev_default network"]
    Volume["notes-dev_db-data volume"]
    HostPort["127.0.0.1 host ports"]

    ComposeFile --> Project
    Project --> Api
    Project --> Worker
    Project --> Db
    Project --> Redis
    Project --> Mailpit
    Project --> Network
    Project --> Volume
    Api --> HostPort
    Mailpit --> HostPort
    Api --> Network
    Worker --> Network
    Db --> Network
    Redis --> Network
    Volume --> Db
```

The diagram matches what you will see from Docker commands. `docker compose ps` shows service containers, `docker network ls` shows the project network, and `docker volume ls` shows the project volume.

`docker compose config` helps when the model itself feels surprising. It renders the resolved Compose model after variables, file merges, and short syntax expansions, so teams use it before debugging a value that may have come from `.env`, the shell, or another Compose file.

## Common Model Mistakes
<!-- section-summary: Most early Compose mistakes come from mixing up service names, host ports, container lifetimes, and persistent storage lifetimes. -->

The first common mistake is using `localhost` inside one service to reach another service. Inside the API container, `localhost` means the API container itself. The database lives in the `db` service, so the API should use `db:5432` on the Compose network.

The second common mistake is putting host addresses into service-to-service configuration. A browser on your laptop uses `http://127.0.0.1:8080`, while the worker container should use `http://api:3000` if it needs the API. The caller viewpoint decides which address makes sense.

The third common mistake is treating the generated container name as the stable identity. Compose can recreate `notes-dev-api-1` when the image or configuration changes, so peer services should use the service name `api` rather than the current container name or IP address.

The fourth common mistake is confusing container cleanup with data cleanup. Removing and recreating the `db` container can leave the named volume in place, which means old rows can still appear after a rebuild. Removing the volume is a deliberate reset, and the workflow article will show how to do that safely.

## Putting It All Together
<!-- section-summary: The Compose model gives the team one place to review roles, connections, startup rules, and data lifetimes. -->

Compose gives the notes team a shared application map. The project boundary keeps this copy separate, services describe stable roles, the Compose file records the desired graph, and Docker resources implement the graph on the local machine.

That changes the daily team conversation. A new developer can open `compose.yaml` and see that the API talks to `db`, the worker talks to `redis`, Mailpit exposes a local browser UI, and database files live in `db-data`.

The file also makes review possible. When someone adds a search service, reviewers can see whether it joins the right network, whether it needs a volume, whether it publishes a host port, and whether the API receives the correct environment value.

Most Compose debugging starts by asking which part of the model owns the behavior. Service command problems belong in the service definition, host access problems belong in `ports`, service-to-service name problems belong in networks and environment values, and old data problems belong in volumes.

## What's Next

You now have the big Compose shape: one project, several services, and a YAML file that describes how they connect. The next article zooms into the resources that make the model real at runtime.

We will use the same notes app and follow each boundary carefully. The goal is to make network names, published ports, volumes, environment variables, secrets, and health checks feel like concrete Docker resources instead of random Compose syntax.

---

**References**

- [Docker Compose overview](https://docs.docker.com/compose/) - Defines Docker Compose as a tool for defining and running multi-container applications with services, networks, and volumes in a YAML configuration file.
- [How Compose works](https://docs.docker.com/compose/intro/compose-application-model/) - Explains the Compose application model, including services, networks, volumes, configs, secrets, and projects.
- [Compose file reference](https://docs.docker.com/reference/compose-file/) - Documents the Compose Specification and the top-level elements used in modern Compose files.
- [Define services in Docker Compose](https://docs.docker.com/reference/compose-file/services/) - Documents service definitions, commands, environment, ports, health checks, and `depends_on`.
- [Compose Build Specification](https://docs.docker.com/reference/compose-file/build/) - Explains how Compose can build images from source through the `build` section.
- [Networking in Compose](https://docs.docker.com/compose/how-tos/networking/) - Documents default networks, service discovery, and service-name DNS inside a Compose project.
- [Define and manage volumes in Docker Compose](https://docs.docker.com/reference/compose-file/volumes/) - Describes named volumes as persistent data stores managed through Compose.
- [Control startup and shutdown order in Compose](https://docs.docker.com/compose/how-tos/startup-order/) - Documents `depends_on`, dependency order, and health-check-based startup conditions.
- [docker compose config](https://docs.docker.com/reference/cli/docker/compose/config/) - Documents rendering the resolved Compose model after file merging, variable interpolation, and short-syntax expansion.
- [History and development of Docker Compose](https://docs.docker.com/compose/intro/history/) - Explains how legacy file formats merged into the Compose Specification and how modern Compose handles the `version` field.
