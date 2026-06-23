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

1. [The Debugging Story](#the-debugging-story)
2. [Host-to-Container Traffic](#host-to-container-traffic)
3. [Container Ports and Host Ports](#container-ports-and-host-ports)
4. [Bridge Networks and Service Names](#bridge-networks-and-service-names)
5. [`localhost` Depends on the Caller](#localhost-depends-on-the-caller)
6. [Bind Addresses Inside the Container](#bind-addresses-inside-the-container)
7. [Compose Networking for the Catalog Stack](#compose-networking-for-the-catalog-stack)
8. [Inspecting the Path](#inspecting-the-path)
9. [Common Failure Patterns](#common-failure-patterns)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Debugging Story
<!-- section-summary: Docker network debugging starts with the caller and follows the request path hop by hop. -->

Imagine we are pairing on a small product catalog application. A browser opens the catalog page, a `web` service serves the page and proxies product requests, an `api` service reads product data, and a Postgres `db` service stores the catalog records.

The containers start, the logs look friendly, and the browser still shows a connection error. This is the moment where a senior engineer slows the room down and asks one plain question first: **who is making this request?**

That question matters because Docker gives containers their own **network namespaces**. A network namespace is a private network view with its own interfaces, routes, ports, and `localhost`, so the host laptop, the `web` container, the `api` container, and the `db` container each see the network from a different place. In this article, we will keep the same product catalog stack in view: the browser reaches the `web` service through a published host port, `web` reaches `api` by service name, and `api` reaches `db` by service name on a Docker network.

![Docker request path infographic showing a browser entering host port 8080, crossing a published port into web on 5173, then using service names to reach api on 3000 and db on 5432 inside a Docker network](/content-assets/articles/article-containers-orchestration-docker-container-networking/docker-request-path.png)

_This infographic gives the catalog stack one visible request path, so the host-facing published port and the internal Docker service names stay separate while we move through the article._

## Host-to-Container Traffic
<!-- section-summary: A published port gives callers on the host a specific host address and host port that forward into a container port. -->

**Host-to-container traffic** means a process outside the container wants to enter the container. In local development, that caller is usually your browser, `curl`, an API client, or a test runner running directly on your laptop. Docker uses **port publishing** for this path, because the container can have a process listening on port `5173`, `3000`, or `5432` inside its private network view while the host still needs a separate forwarding rule before outside callers can reach that process.

Here is the catalog `web` service as a single container, with the browser entering through host port `8080`. The example uses the long `--publish` form so the host address, host port, and container port are visible in the command itself.

```bash
docker run --rm \
  --name catalog-web \
  --publish 127.0.0.1:8080:5173 \
  catalog-web:dev
```

The mapping has three pieces. `127.0.0.1` is the **host bind address**, `8080` is the **host port**, and `5173` is the **container port** where the web process listens inside the container. The browser uses the host side of that mapping, because the browser is outside Docker:

```bash
curl -v http://127.0.0.1:8080/
```

The web process still listens on `5173` inside the container. Docker receives traffic on the host at `127.0.0.1:8080`, then forwards that traffic into the container at port `5173`. The host address is a real security choice: `--publish 8080:5173` publishes on all host addresses by default, while `--publish 127.0.0.1:8080:5173` keeps the entry point on the host loopback address for local-only access.

## Container Ports and Host Ports
<!-- section-summary: Host ports belong to callers outside Docker, while container ports belong to processes inside Docker networks. -->

A **container port** is the port a process listens on inside the container. A **host port** is the port Docker opens on the host so outside callers can reach that container process. The two numbers can match, and they often do in small examples, but they can also differ when a laptop already has something running on the same port or when several copies of the same service run at once.

For example, the catalog API can listen on container port `3000` while the host uses port `8081`. That lets the API keep its normal internal port while the host picks an available local entry point.

```bash
docker run --rm \
  --name catalog-api \
  --publish 127.0.0.1:8081:3000 \
  catalog-api:dev
```

From the host, the API health check uses port `8081`. The health check is a host-to-container request, so it uses the host-side number.

```bash
curl -v http://127.0.0.1:8081/health
```

Inside Docker, peer containers still use port `3000` when they call the API. The host port exists for callers outside the Docker network path, and the container port exists for callers that can reach the container directly on a Docker network.

The Dockerfile instruction `EXPOSE 3000` belongs in this discussion too. `EXPOSE` documents the port the image expects to use. Host callers can reach that port after the container starts with `--publish`, `-p`, or a Compose `ports` entry, and that split matters a lot for databases. A Postgres container listens on container port `5432`, while the catalog API can use `db:5432` without publishing the database to the host at all.

## Bridge Networks and Service Names
<!-- section-summary: A user-defined bridge network lets containers talk to each other by name and container port. -->

A **bridge network** is a private Docker network on one Docker host. Containers attached to the same bridge network can communicate with each other, and user-defined bridge networks include Docker DNS so containers can resolve names and aliases.

That DNS behavior is the daily reason teams create user-defined networks. The catalog API should avoid a changing container IP address for Postgres, because Docker can replace the database container and give the new one a different private address. With plain `docker run`, the setup can look like this, where `catalog-net` is the shared private network and `db` is the stable name the API uses:

```bash
docker network create catalog-net

docker run -d \
  --name catalog-db \
  --network catalog-net \
  --network-alias db \
  -e POSTGRES_USER=catalog \
  -e POSTGRES_PASSWORD=catalog \
  -e POSTGRES_DB=catalog \
  postgres:16-alpine

docker run -d \
  --name catalog-api \
  --network catalog-net \
  --publish 127.0.0.1:8081:3000 \
  -e DATABASE_URL=postgres://catalog:catalog@db:5432/catalog \
  catalog-api:dev
```

The API connection string uses `db:5432`. `db` is the network alias on the user-defined bridge network, and `5432` is the Postgres container port. Notice that the database command has no `--publish` flag. The API can reach the database because both containers share `catalog-net`, and the browser on the host cannot reach the database unless the team deliberately publishes a database host port.

This is close to real production practice. Internal services usually communicate on private networks by stable names, while only the edge service that humans or outside clients need receives a host-facing or load-balancer-facing entry point.

## `localhost` Depends on the Caller
<!-- section-summary: `localhost` always points back to the network namespace of the process making the request. -->

**`localhost`** means the loopback address of the caller. On your laptop, it points back to your laptop; inside the `web` container, it points back to `web`; inside the `api` container, it points back to `api`. This is the source of many Docker networking bugs. The browser can use `http://localhost:8080` because the browser runs on the host, while the API needs `db:5432` for Postgres because `localhost:5432` would point the API back to itself.

Here is the catalog stack from each caller's view. The useful address changes because each caller stands in a different network namespace.

| Caller | Address that makes sense | What it reaches |
| --- | --- | --- |
| Browser on the host | `http://127.0.0.1:8080` | Host port `8080`, forwarded to the `web` container |
| `web` container | `http://api:3000` | The `api` service on the Docker network |
| `api` container | `postgres://db:5432/catalog` | The `db` service on the Docker network |
| `api` container | `http://localhost:3000` | The `api` container itself |
| `db` container | `localhost:5432` | The database process inside the `db` container |

The table explains a common frontend surprise too. If JavaScript running in the browser tries to call `http://api:3000`, the browser asks the host network to resolve `api`, and that private Docker service name belongs inside the Docker network. For our catalog stack, the `web` server proxies `/api` requests to `http://api:3000` from inside Docker. The browser only talks to the published `web` host port, and the private service name stays inside the Docker network where it belongs.

![Localhost depends on caller infographic showing host, web container, api container, and db container each with its own localhost loopback while web calls api and api calls db by service name](/content-assets/articles/article-containers-orchestration-docker-container-networking/localhost-caller-map.png)

_This infographic shows why `localhost` must be read from the caller's position: the host uses its published port, while containers use Docker service names for peer services._

## Bind Addresses Inside the Container
<!-- section-summary: The application process must listen on an address that accepts traffic delivered through the container network interface. -->

A **bind address** is the local address where a process accepts incoming connections. `127.0.0.1` means loopback inside that network namespace, while `0.0.0.0` means all IPv4 interfaces inside that same namespace.

This setting sits inside the container, so it is separate from the host address in `--publish 127.0.0.1:8080:5173`. The publish address controls who can reach the host entry point, and the process bind address controls which traffic the application accepts after Docker forwards the connection into the container. Here is a Node server that only accepts loopback traffic inside the container:

```js
server.listen(3000, "127.0.0.1");
```

That can pass a quick test from inside the same container and still fail from the host or from another container. Docker delivers forwarded traffic to the container network interface, and the process only listens on the container loopback interface. For a containerized API, the listener usually needs this shape:

```js
server.listen(3000, "0.0.0.0");
```

Frameworks expose the same idea through different flags or environment variables. In daily work, the command often looks like one of these, and the exact flag depends on the framework.

```bash
npm run dev -- --host 0.0.0.0
next dev -H 0.0.0.0
rails server -b 0.0.0.0
HOST=0.0.0.0 PORT=3000 node server.js
```

The service can still stay local to your laptop. The process can listen on `0.0.0.0` inside the container while Docker publishes the host entry point only on `127.0.0.1`, so the inner listener and the outer exposure remain separate choices.

## Compose Networking for the Catalog Stack
<!-- section-summary: Compose creates a project network, registers service names in Docker DNS, and keeps host-facing ports separate from service-to-service ports. -->

**Docker Compose** describes a multi-container application in one file. For networking, Compose creates a default project network, attaches each service to it, and registers each service name with Docker DNS. Here is the product catalog stack as a Compose file, with only the browser-facing `web` service published to the host:

```yaml
services:
  web:
    build: ./web
    command: npm run dev -- --host 0.0.0.0
    ports:
      - "127.0.0.1:8080:5173"
    environment:
      SERVER_API_URL: http://api:3000
    depends_on:
      - api

  api:
    build: ./api
    command: node server.js
    environment:
      HOST: 0.0.0.0
      PORT: "3000"
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

When the project directory is named `catalog`, Compose creates a network named something like `catalog_default`. The `web`, `api`, and `db` services join that network, and each service can look up the others by service name. The only published port in this file is the `web` service. The browser uses `http://127.0.0.1:8080`, `web` uses `http://api:3000`, and `api` uses `db:5432`.

Compose also makes the host-port and container-port split visible. If a database port were published as `"15432:5432"` for a local admin tool, the host would use `localhost:15432`, while containers on the Compose network would still use `db:5432`. `depends_on` helps with startup order. Application readiness is a separate concern, so production-style services still need retry logic, health checks, or both, because Postgres can take a few seconds to initialize after the container process starts.

## Inspecting the Path
<!-- section-summary: Good Docker network debugging checks the same path the failing caller uses. -->

When the browser cannot reach the catalog page, the host-side evidence comes first. `docker compose ps` and `docker compose port` show which host address and host port Compose published for the `web` service, and `curl` tests the same host URL the browser uses.

```bash
docker compose ps
docker compose port web 5173
curl -v http://127.0.0.1:8080/
```

When `web` cannot reach `api`, the useful test runs from inside the `web` container. Name resolution and TCP reachability are two separate checks, so the command checks both pieces from the caller that is actually failing.

```bash
docker compose exec web sh -lc 'getent hosts api && nc -vz api 3000'
```

When `api` cannot reach Postgres, the test moves into the `api` container. The target should be the Compose service name and the Postgres container port, because that is the same path the application uses in `DATABASE_URL`.

```bash
docker compose exec api sh -lc 'getent hosts db && nc -vz db 5432'
```

Small application images sometimes do not include `getent`, `nc`, `ss`, or `curl`. In that case, teams often attach a temporary network-debugging container to the same Compose network and test from there, so the production image can stay small while the debug tool carries the extra utilities.

```bash
docker run --rm \
  --network catalog_default \
  nicolaka/netshoot \
  sh -lc 'dig api +short && nc -vz api 3000 && nc -vz db 5432'
```

The process listener is its own piece of evidence. A listener on `0.0.0.0:3000` can accept Docker-delivered traffic, while a listener on `127.0.0.1:3000` only accepts loopback traffic inside that container. This check separates a Docker forwarding problem from an application listener problem.

```bash
docker compose exec api sh -lc 'ss -tlnp || netstat -tlnp'
```

The Docker network object can confirm which containers joined the same network and which aliases exist. This helps when two Compose projects have similar names or a service was attached to a custom network by mistake, and it also shows the real network name Docker created.

```bash
docker network inspect catalog_default
docker inspect "$(docker compose ps -q api)" --format '{{json .NetworkSettings.Ports}}'
```

These commands keep the investigation tied to the failing request path. Host callers, peer containers, DNS names, published ports, and process listeners each leave different evidence, so the next command should always match the place where the failing request starts.

## Common Failure Patterns
<!-- section-summary: Most Docker networking failures come from mixing caller location, host ports, container ports, service names, network membership, or listener addresses. -->

Most Docker networking bugs repeat the same few shapes. The fix comes from finding which hop in the path disagrees with the caller's location, then changing that one address, port, network, or listener setting.

| Symptom | Likely cause | Usual fix |
| --- | --- | --- |
| Browser fails at `localhost:3000`, but `docker compose ps` shows `127.0.0.1:8080->5173/tcp` | The browser is using an internal container port instead of the published host port | The browser address should use the host port, such as `http://127.0.0.1:8080` |
| API logs show `ECONNREFUSED localhost:5432` | The API container is calling itself instead of the database container | `DATABASE_URL` should point at `db:5432` |
| `getent hosts db` fails inside `api` | The target name is wrong or the containers do not share a user-defined network | The caller and target need the same Docker network and the Compose service name |
| DNS works, but `nc -vz db 5432` fails | The database process is still starting, unhealthy, or listening on the wrong interface | Database logs, listener state, health checks, and application retry behavior should guide the fix |
| Published port exists, but host requests time out | The application process may be bound to `127.0.0.1` inside the container | Bind the process to `0.0.0.0` inside the container |
| A database is reachable from other machines on the LAN | The Compose file published the database on all host addresses | Remove the `ports` entry or bind it to `127.0.0.1` for local-only access |
| A service works in one Compose project and fails in another | The caller is on a different project network or the project name changed | Inspect the actual network name and service membership |

These failures look similar from the browser because the browser only reports that a connection failed. The Docker evidence separates them into different layers: host publish rule, Docker DNS, shared network, target process, and application readiness.

## Putting It All Together
<!-- section-summary: A working path names the caller, the address it uses, the port on that side, the Docker network, the service name, and the process listener. -->

The product catalog stack now has a clean network story. The browser runs on the host, so it reaches `web` through `127.0.0.1:8080`, and Docker forwards that host port to container port `5173`. The `web` service runs inside the Compose network, so it calls `api:3000` by service name and container port. The `api` service runs on the same network, so it calls Postgres at `db:5432`.

The process bind addresses complete the path. `web` and `api` listen on `0.0.0.0` inside their containers, while Docker keeps the browser-facing entry point on `127.0.0.1` on the host. Here is the short review of the pieces:

| Concept | Plain English meaning | Catalog example |
| --- | --- | --- |
| **Network namespace** | The caller's private network view | Host, `web`, `api`, and `db` each have their own `localhost` |
| **Published port** | Host entry point forwarded into a container | `127.0.0.1:8080` to `web:5173` |
| **Host port** | The port outside Docker callers use | Browser uses `8080` |
| **Container port** | The port the target process uses inside Docker | `api` listens on `3000`, Postgres listens on `5432` |
| **User-defined bridge network** | Private Docker network for related containers | Compose creates `catalog_default` |
| **Service name / Docker DNS** | Stable name containers use for each other | `web` calls `api`, and `api` calls `db` |
| **Bind address** | Local address where the process accepts traffic | API listens on `0.0.0.0:3000` |

The practical habit is simple: name the caller, then follow the same path the caller uses. That gives you a small set of Docker commands and application checks instead of a random pile of port changes, and it keeps every fix tied to the request that actually failed.

![Network debug path infographic showing host port checks, Docker DNS checks, shared network checks, app listener checks, and health check or log evidence](/content-assets/articles/article-containers-orchestration-docker-container-networking/network-debug-path.png)

_This summary image turns the article into a debugging sequence: prove the host entry point, then prove Docker DNS, shared network membership, process listeners, and application health._

## What's Next

The catalog stack can now move traffic cleanly from browser to web, from web to API, and from API to database. The next surprise usually appears after the database container is recreated and the product data disappears.

That takes us to Docker storage. The next article follows image layers, writable container layers, named volumes, bind mounts, file ownership, and the difference between data that belongs inside an image and data that must survive outside a container.

---

**References**

- [Docker Docs: Networking overview](https://docs.docker.com/engine/network/) - Official overview of Docker network drivers and container network connections.
- [Docker Docs: Bridge network driver](https://docs.docker.com/engine/network/drivers/bridge/) - Documents bridge behavior, user-defined bridge networks, service-name DNS, and network isolation.
- [Docker Docs: Port publishing and mapping](https://docs.docker.com/engine/network/port-publishing/) - Explains `-p` / `--publish`, host addresses, host ports, container ports, and default exposure behavior.
- [Docker Docs: Networking in Compose](https://docs.docker.com/compose/how-tos/networking/) - Explains Compose default networks, service discovery, container IP changes, and host-port versus container-port usage.
- [Docker Docs: docker network create](https://docs.docker.com/reference/cli/docker/network/create/) - CLI reference for creating Docker networks and setting network options.
