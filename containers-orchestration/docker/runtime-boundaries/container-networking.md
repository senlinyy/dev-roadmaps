---
title: "Container Networking"
description: "Trace traffic between the host, Docker bridge networks, container ports, service names, and process bind addresses."
overview: "A running container can still be unreachable. This article follows requests across Docker's network boundaries so host ports, container ports, service names, and bind addresses become one readable path."
tags: ["docker", "networking", "ports", "dns"]
order: 1
id: article-containers-orchestration-docker-container-networking
aliases:
  - container-networking
  - containers-orchestration/docker/container-networking.md
---

## Table of Contents

1. [The Four Networking Questions](#the-four-networking-questions)
2. [Host-to-Container Traffic](#host-to-container-traffic)
3. [Container-to-Container Traffic](#container-to-container-traffic)
4. [`localhost` Depends on the Caller](#localhost-depends-on-the-caller)
5. [Process Bind Addresses](#process-bind-addresses)
6. [Compose Networks in Daily Work](#compose-networks-in-daily-work)
7. [Inspecting the Path](#inspecting-the-path)
8. [Common Failure Patterns](#common-failure-patterns)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Four Networking Questions
<!-- section-summary: Docker networking becomes readable when you follow the caller, host entry point, Docker network, and application listener in order. -->

Picture a small team building a product catalog. The stack has a browser-based `web` app, a Node `api` service that listens on port `3000`, and a Postgres `db` service that listens on port `5432`. The containers start cleanly, the API logs say `Listening on 3000`, and then the browser gets a connection error at `http://localhost:3000`.

A junior engineer might say, "The container is running, so why is the port closed?" The senior answer focuses first on **who is making the request**. A browser on the host, a process inside the API container, and a process inside the database container each sees a different network view. That caller-first habit turns the problem into a path the team can check one hop at a time.

This article follows four questions through the same product catalog stack. **Where is the caller?** **Which host port, if any, points into Docker?** **Which Docker network and name carry service-to-service traffic?** **Which address and port does the application process actually listen on?** Those four questions connect every section that follows.

Docker gives each container its own **network namespace**. A network namespace is a private network view with its own interfaces, routes, ports, and loopback address. The host has its own network view too, so the host's port `3000` and the API container's port `3000` are separate places unless Docker creates a forwarding path between them.

## Host-to-Container Traffic
<!-- section-summary: A published port creates a host-side entry point that forwards traffic into a container port. -->

**Host-to-container traffic** means a caller outside the container wants to enter the container. In local development, that caller is usually your browser, curl, an API client, or another program running directly on your laptop. Docker uses **port publishing** to create the entry point from the host into the container.

A container can listen on port `3000` internally while the host has no port `3000` open for that container. The internal port belongs to the container's network namespace. The host needs a published rule that maps a host address and host port to the container port.

```bash
docker run -d \
  --name catalog-api \
  -p 127.0.0.1:8080:3000 \
  catalog-api:dev
```

The mapping says that requests to `127.0.0.1:8080` on the host should forward to port `3000` inside the `catalog-api` container. The API process still listens on `3000`. The browser uses `8080` because `8080` is the host-side door.

The host address matters. `-p 8080:3000` publishes the port on all host interfaces by default, so other machines that can reach your laptop may also reach the service. `-p 127.0.0.1:8080:3000` keeps the host entry point on loopback, which is a safer default for local APIs, admin tools, and databases.

The Dockerfile instruction `EXPOSE 3000` helps humans and tools understand which port the image expects to use. It documents the container port. The actual host forwarding rule appears when the container starts with `-p` or `--publish`, or when Compose declares a `ports` entry.

Host traffic is only half of the catalog stack. After the browser reaches the API, the API still needs to call Postgres, and that second request starts from inside a container.

## Container-to-Container Traffic
<!-- section-summary: Containers on a shared user-defined network reach each other by service name and container port. -->

**Container-to-container traffic** means one container process calls another container process. In the catalog stack, the API connects to Postgres. The caller is now inside the `api` container, so the host-published port is the wrong piece of information for that request.

Docker's normal path for service-to-service traffic is a **user-defined bridge network**. A bridge network is a private network Docker creates on the host so attached containers can exchange traffic. User-defined bridges also provide automatic DNS resolution, so a container can call another container by name or network alias.

In Compose, service names become the everyday DNS names. If the database service is named `db`, the API connection string should use `db:5432` because `5432` is the Postgres container port on the shared network.

```yaml
services:
  api:
    build: .
    environment:
      DATABASE_URL: postgres://catalog:catalog@db:5432/catalog

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: catalog
      POSTGRES_PASSWORD: catalog
      POSTGRES_DB: catalog
```

Compose creates a default project network and attaches both services. The API asks Docker DNS for `db`, Docker returns the current database container address on that network, and the API connects to port `5432` in the database container. If the database container gets recreated with a new private IP, the service name remains the stable name the API uses.

This is why container IP addresses make weak configuration. They describe one container instance at one moment. Service names describe the role the caller wants: "the database for this stack." Docker's official Compose networking docs call out this difference directly: service names stay stable while container IP addresses can change after recreation.

Now the catalog team has two working paths: browser to host port to API, and API to service name to Postgres. The word that still trips people up is `localhost`, so let's slow down there.

## `localhost` Depends on the Caller
<!-- section-summary: `localhost` means the loopback address inside the caller's own network namespace. -->

**`localhost`** is the loopback name for the machine or namespace making the request. On your laptop shell, `localhost` points at the host. Inside the `api` container, `localhost` points back at the `api` container. Inside the `db` container, `localhost` points back at the `db` container.

That caller viewpoint explains two common catalog bugs. The browser can use `http://localhost:8080` because the browser lives on the host and Docker published host port `8080`. The API should use `db:5432` for Postgres because the API lives on the Docker network and the database service name lives there.

Here is the same idea in a small table:

| Caller | Example address | What the address reaches |
| --- | --- | --- |
| Browser on host | `http://localhost:8080` | Host port `8080`, forwarded to API port `3000` |
| API container | `postgres://db:5432/catalog` | The `db` service on the Compose network |
| API container | `http://localhost:3000` | The API container itself |
| Database container | `localhost:5432` | The database container itself |

This is also why a container can seem healthy while the host still fails to reach it. The API may respond to `curl localhost:3000` from inside the container. The browser still needs the host publish rule, the correct host port, and an application listener that accepts traffic coming from the container interface.

That last part brings us to the process bind address. Docker can deliver packets to the container, and the application process still has to accept them.

## Process Bind Addresses
<!-- section-summary: The process bind address controls which container interfaces the application listens on. -->

A **bind address** is the local network address a process chooses for accepting connections. `127.0.0.1` means loopback only. `0.0.0.0` means all IPv4 interfaces inside that namespace. The same application port can behave very differently depending on that address.

Many development servers bind to `127.0.0.1` by default. That works fine when the browser and server run directly on the same laptop network view. Inside a container, `127.0.0.1` belongs to the container's loopback interface, so traffic arriving from Docker's bridge interface may never reach the process.

For a containerized HTTP API that should receive host-published or Compose-network traffic, the application usually needs to listen on `0.0.0.0` inside the container:

```bash
HOST=0.0.0.0 PORT=3000 node server.js
```

Frameworks expose this setting in different ways. Vite often uses `--host 0.0.0.0`, Next.js can receive `-H 0.0.0.0`, Rails has `-b 0.0.0.0`, and many Node servers accept a host argument in `server.listen`. The exact flag belongs to the framework, while the Docker idea stays the same.

Binding to `0.0.0.0` inside the container tells the process to accept traffic on the container's interfaces. The host publish address still controls the outside entry point, so `-p 127.0.0.1:8080:3000` can keep the host-facing side local while the process listens broadly inside the container.

At this point the team knows the separate choices: host port for outside callers, service name for peer containers, and bind address for the process. Compose puts those choices into one repeatable file.

## Compose Networks in Daily Work
<!-- section-summary: Compose separates host-facing ports from service-to-service names, which keeps local stacks predictable. -->

**Docker Compose** describes a multi-container application in one file. For networking, Compose creates a project-scoped network by default, attaches the services to it, and gives each service a DNS name based on the service key. That default is enough for many local stacks.

The product catalog stack can publish only the API to the host while keeping the database available to peer containers by service name:

```yaml
services:
  api:
    build: ./api
    command: npm run dev -- --host 0.0.0.0
    ports:
      - "127.0.0.1:8080:3000"
    environment:
      DATABASE_URL: postgres://catalog:catalog@db:5432/catalog
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: catalog
      POSTGRES_PASSWORD: catalog
      POSTGRES_DB: catalog
```

The `ports` entry creates the host-to-container path for the browser. The `DATABASE_URL` uses `db:5432` for the container-to-container path. The API command binds to `0.0.0.0` so Docker-delivered traffic can reach the process inside the container.

This separation is valuable in production-like local work. Databases and queues often need no host publication at all, because only other services in the stack should reach them. API and web services usually publish a loopback host port so humans and local tools can test them.

`depends_on` affects startup order in Compose. Postgres may still need a few seconds before it accepts connections. Real applications still need retry logic, health checks, or wait behavior because the container may start before the database process has finished initialization.

Once a path fails, the fastest debugging approach is to inspect the same path the caller used. The host path and the container path leave different evidence.

## Inspecting the Path
<!-- section-summary: Network debugging should check the caller's path before checking random Docker objects. -->

For host-to-container traffic, the first evidence is the published port. `docker compose ps` or `docker ps` shows the host address, host port, and container port Docker created. If the API should be reachable at `http://localhost:8080`, the port table should show a rule like `127.0.0.1:8080->3000/tcp`.

```bash
docker compose ps
docker port catalog-api
```

For the process listener, check from inside the API container. The useful evidence is the local address and port the process listens on. A listener on `0.0.0.0:3000` can accept Docker-network traffic, while a listener on `127.0.0.1:3000` only accepts loopback traffic inside that container.

```bash
docker compose exec api sh -lc 'ss -tlnp || netstat -tlnp'
```

For service-to-service traffic, test from the caller container. In the catalog stack, the API is the caller and the database is the target. Name resolution and TCP reachability are separate checks, so the command below tests both.

```bash
docker compose exec api sh -lc 'getent hosts db && nc -vz db 5432'
```

`getent hosts db` checks Docker DNS from the API's viewpoint. `nc -vz db 5432` checks whether the API container can open a TCP connection to the database container port. If DNS works and TCP fails, the name path is fine and the database listener, readiness, network membership, or firewall-like runtime setting needs attention.

The network object itself can also tell a useful story. `docker network inspect` shows which containers attach to the network and which aliases Docker registered. That output helps when two Compose projects have similar names or a service accidentally attaches to a different custom network.

```bash
docker network inspect catalog_default
```

These checks line up with the four questions from the start. Caller, host entry point, network name, and process listener each has its own command and its own evidence.

## Common Failure Patterns
<!-- section-summary: Most Docker networking failures come from mixing up host ports, container ports, names, caller location, or listener addresses. -->

The first common failure is using the container port from the host. The API logs say `Listening on 3000`, so the browser opens `localhost:3000`. If Docker published `127.0.0.1:8080:3000`, the browser needs `localhost:8080` because `8080` is the host-side port.

The second failure is using the host port from another container. The API connects to `localhost:8080` or `localhost:5432` because those addresses worked from the laptop. From inside the API container, `localhost` points back at the API container, so peer services should use service names like `db` and their container ports.

The third failure is missing a shared network. Two containers can both run successfully while they sit on different user-defined networks. Docker DNS only resolves names inside the networks where the caller and target both participate.

The fourth failure is a process bound to loopback. The port publish rule exists and the service name resolves, yet the process accepts only `127.0.0.1` inside its own container. Changing the application host setting to `0.0.0.0` usually fixes that specific shape.

The fifth failure is readiness. Compose can create the network and start containers in the expected order, while Postgres still needs a few seconds before it accepts connections. Application retry logic and health checks handle that real startup gap.

Each failure has a different fix because each one lives at a different part of the path. The senior habit is to name the caller first, then follow the path one hop at a time.

## Putting It All Together
<!-- section-summary: A working Docker network path matches the caller, address, port, Docker network, service name, and process listener. -->

The product catalog stack now has a readable network story. The browser runs on the host, so it enters through `127.0.0.1:8080`. Docker forwards that host port to API port `3000` inside the `api` container. The API process listens on `0.0.0.0:3000`, so it accepts the traffic delivered by Docker.

The API talks to Postgres from inside the Compose network. It uses `db:5432` because `db` is the service name and `5432` is the database container port. Docker DNS resolves the service name on the shared network, and the database process accepts the connection inside the `db` container.

The important ideas connect cleanly:

| Concept | Plain English meaning | Catalog example |
| --- | --- | --- |
| **Network namespace** | The caller's private network view | Host, `api`, and `db` each have their own loopback |
| **Published port** | Host entry point forwarded into a container | `127.0.0.1:8080` to API `3000` |
| **Bridge network** | Private Docker network for attached containers | Compose creates `catalog_default` |
| **Docker DNS** | Name lookup for containers on a user-defined network | `api` resolves `db` |
| **Container port** | Port the target process listens on inside its container | Postgres listens on `5432` |
| **Bind address** | Local address the process accepts traffic on | API listens on `0.0.0.0` |

Networking problems feel random when all those ideas collapse into "the Docker connection failed." They become normal engineering problems when the path is spelled out from the caller's side. The browser, API, and database each get their own path, and each path gives you a small set of evidence to check.

## What's Next

The catalog API can now receive browser traffic and reach Postgres by service name. The next surprise comes from storage. A database container can be reachable and healthy, while its data still disappears after recreation because the files lived in the wrong place.

The next article follows Docker's filesystem view: image layers, writable layers, named volumes, bind mounts, hidden files, and ownership. The same style of thinking applies there too, because storage problems also come from crossing a runtime boundary without naming which side owns the path.

---

**References**

- [Docker Docs: Networking overview](https://docs.docker.com/engine/network/) - Official overview of Docker networking concepts, drivers, and how containers connect.
- [Docker Docs: Bridge network driver](https://docs.docker.com/engine/network/drivers/bridge/) - Documents user-defined bridge networks, automatic DNS resolution, network isolation, and bridge behavior.
- [Docker Docs: Port publishing and mapping](https://docs.docker.com/engine/network/port-publishing/) - Explains how Docker publishes container ports on the host and how host addresses affect exposure.
- [Docker Docs: Publishing and exposing ports](https://docs.docker.com/get-started/docker-concepts/running-containers/publishing-ports/) - Beginner guide covering host ports, container ports, `-p`, `-P`, and `EXPOSE`.
- [Docker Docs: Networking in Compose](https://docs.docker.com/compose/how-tos/networking/) - Explains Compose service names, project networks, container IP changes, and host-versus-container ports.
- [Docker Docs: docker container run](https://docs.docker.com/reference/cli/docker/container/run/) - CLI reference for `--publish`, networking options, and container runtime flags.
