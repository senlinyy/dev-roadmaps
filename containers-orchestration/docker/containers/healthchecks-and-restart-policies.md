---
title: "Health and Restarts"
description: "Separate running, healthy, ready, and restarted states so containers recover from process exits while readiness problems stay visible."
overview: "A running container can still be an unusable service. This article explains Docker health checks and restart policies as two separate signals: one observes whether the service can answer, and the other decides what happens after the process exits."
tags: ["docker", "healthchecks", "restart", "readiness"]
order: 4
id: article-containers-orchestration-docker-healthchecks-and-restart-policies
---

## Table of Contents

1. [Four Different Signals](#four-different-signals)
2. [Health Checks Observe a Running Service](#health-checks-observe-a-running-service)
3. [A Useful Health Endpoint Answers a Real Question](#a-useful-health-endpoint-answers-a-real-question)
4. [Readiness Connects One Service to Another](#readiness-connects-one-service-to-another)
5. [Restart Policies React to Process Exit](#restart-policies-react-to-process-exit)
6. [Restart Loops Need Logs and Exit Codes](#restart-loops-need-logs-and-exit-codes)
7. [Compose Startup Order Uses Health Evidence](#compose-startup-order-uses-health-evidence)
8. [A Practical Local Stack](#a-practical-local-stack)
9. [Where Health and Restart Setup Usually Breaks](#where-health-and-restart-setup-usually-breaks)
10. [Putting It All Together](#putting-it-all-together)

## Four Different Signals
<!-- section-summary: Running, healthy, ready, and restarting describe different parts of a containerized service. -->

The ticketing API now has a clear startup command and good logs. The container shows `Up`, and everyone feels like the service should be fine. Then the browser gets a 503 because migrations are still running, or the API starts before Postgres accepts connections, or the process crashes every few seconds and Docker keeps starting it again.

Those situations mix four different signals. **Running** means Docker's main process is alive. **Healthy** means a configured check command passes inside the container. **Ready** means the service can handle the kind of request its callers need. **Restarting** means Docker is applying a policy after the main process exits.

These signals answer different questions. A process can be alive while the app warms up. A health check can report failure while the process still runs. A restart policy can keep trying after a crash. Compose can wait for a dependency to become healthy before creating a dependent service.

We will keep following the same `tickets-api` and local Postgres setup. The API needs a database, the database needs a warm-up period, and the developer needs a local stack that starts reliably while broken configuration stays visible.

## Health Checks Observe a Running Service
<!-- section-summary: A Docker health check runs a command inside the container and records healthy, starting, or unhealthy status. -->

A **Docker health check** is a command Docker runs inside a container on a schedule. The command returns exit code `0` for success and a non-zero failure code for an unhealthy result. Docker stores that result as health status in addition to the normal process status.

For the ticketing API, a useful health check can call the API from inside the container. The check asks the service to prove it can answer locally:

```dockerfile
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node ./scripts/healthcheck.js
```

That script might make an HTTP request to `http://127.0.0.1:3000/health`. Inside the container, `127.0.0.1` points to the container itself, so the check tests the API process independently from host port publishing. This is useful because the service can prove its internal listener works before a human tests it from the browser.

The timing options tell Docker how to schedule the check. `interval` controls how often Docker runs it after startup. `timeout` controls how long one check can run before Docker treats it as failed. `retries` controls how many consecutive failures Docker needs before the container becomes `unhealthy`. `start-period` gives the app a bootstrap window before Docker counts failed checks toward the retry limit.

The status appears in `docker ps`. The normal process state and the health state sit together in the status column:

```console
CONTAINER ID   IMAGE                          STATUS                    NAMES
1b7f2b6c9a11   devpolaris/tickets-api:local   Up 40 seconds (healthy)   tickets-api
```

Inspect output gives more detail when a check fails. The health object includes recent probe results and short probe output:

```bash
docker inspect --format '{{json .State.Health}}' tickets-api
```

Health check output should stay short and useful. Docker stores a small amount of stdout and stderr from the health command, so a message like `database ping timed out after 2s` helps much more than a full stack trace or a silent exit code.

## A Useful Health Endpoint Answers a Real Question
<!-- section-summary: A useful health endpoint checks the service behavior callers depend on while keeping the check small and reliable. -->

A **health endpoint** is an application route that reports whether the service can answer a small diagnostic request. For a web API, `/health` or `/ready` gives Docker, Compose, and humans a consistent place to ask about service usefulness. The endpoint should be cheap, predictable, and meaningful.

For the ticketing API, a shallow health endpoint might only prove the HTTP server is alive. That can be enough for a basic process check:

```json
{
  "status": "ok",
  "service": "tickets-api",
  "version": "2026.06.13"
}
```

That helps with a basic process-level question. The server is accepting HTTP connections and can run a handler. It says little about whether the app can create tickets, because ticket creation needs the database.

A readiness endpoint can go one step deeper. It can include the dependencies normal requests need:

```json
{
  "status": "ready",
  "checks": {
    "http": "ok",
    "database": "ok",
    "migrations": "ok"
  }
}
```

This endpoint answers the caller-facing question. If the API needs Postgres to serve normal requests, the readiness endpoint should include a small database check. If migrations must finish before requests work, it should include migration state. The check should stay small because Docker will run it repeatedly.

Teams often split health into two routes in larger systems. `/health` can mean the process is alive. `/ready` can mean the service can receive traffic. Docker Engine has one health status per container, so local Docker setups usually choose the one that best matches the next dependency decision.

## Readiness Connects One Service to Another
<!-- section-summary: Readiness means a dependency can handle the request the next service needs during startup. -->

**Readiness** is the condition that a service can handle the specific work another service needs from it. For our local stack, Postgres might have a running process before it accepts the `tickets` database login. The API needs the database to accept real SQL connections, so a simple "Postgres process exists" signal gives too little information.

Postgres images often use `pg_isready` for this job. In Compose, the database service can define a health check that runs inside the database container and reports readiness:

```yaml
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_DB: tickets
      POSTGRES_USER: tickets
      POSTGRES_PASSWORD: tickets
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

The double dollar signs matter in Compose files because Compose has its own variable interpolation step. `$${POSTGRES_USER}` lets the container shell receive `$POSTGRES_USER` instead of Compose trying to fill it from the host environment. That is a small syntax detail, and it prevents a lot of confusing local startup failures.

Now the API can base its startup order on the database health signal. The goal is plain: the API starts after the database reports that it can accept the connection the API needs. Application retry logic still handles disconnects after startup, and the Compose health signal makes the local development path calmer.

## Restart Policies React to Process Exit
<!-- section-summary: Restart policies tell Docker what to do after the main process exits. -->

A **restart policy** is Docker's rule for what to do after a container's main process exits. It reacts to exit events, which makes it different from a health check. Health checks observe a running process. Restart policies decide whether Docker should start the container again after the process stops.

Docker supports these common policies. Each one answers a different recovery question after the main process exits:

| Policy | Meaning in plain English | Local example |
|---|---|---|
| `no` | Leave the container stopped after exit | One-off commands and debugging |
| `on-failure[:max-retries]` | Restart after a non-zero exit code, optionally with a limit | API crashes from temporary dependency failures |
| `always` | Restart after exits and after daemon restarts, with manual-stop behavior documented by Docker | Long-running local services |
| `unless-stopped` | Restart across daemon restarts unless the operator stopped it | Local databases people want to keep around |

You can set a policy on `docker run`. The policy becomes part of the container configuration:

```bash
docker run -d \
  --name tickets-api \
  --restart on-failure:3 \
  -e DATABASE_URL=postgres://tickets:tickets@db:5432/tickets \
  devpolaris/tickets-api:local
```

You can also update an existing container. Docker applies the new restart policy to that container:

```bash
docker update --restart=on-failure:3 tickets-api
```

Restart policies help with real transient failures. A process may exit because the database restarted, the network blipped, or the host rebooted. The policy gives Docker a small recovery rule and keeps process-manager logic outside the container.

They can also hide a configuration problem if people stop reading the logs. If `DATABASE_URL` is empty and the app exits every time, `on-failure` will keep retrying the same broken startup. The right fix still lives in the runtime configuration.

## Restart Loops Need Logs and Exit Codes
<!-- section-summary: A restart loop means Docker keeps applying the policy, so the useful evidence lives in recent logs, exit codes, and restart count. -->

A **restart loop** happens when the main process exits, Docker restarts it, and the new process exits again. The `STATUS` column may show `Restarting` or an `Up` time that keeps resetting. This tells us Docker is doing recovery work, while the application still needs a real fix.

The first evidence stays familiar. State, logs, exit code, and restart count tell the same story from different angles:

```bash
docker ps -a --filter name=tickets-api
docker logs --tail 80 tickets-api
docker inspect --format '{{.State.ExitCode}} {{.RestartCount}}' tickets-api
```

Recent logs usually show the repeated cause. A missing environment variable, failed migration, bad file permission, or unreachable database can make every restart fail the same way. The restart count confirms the loop shape.

Docker adds backoff between restart attempts for active restart policies, so a broken container receives spaced-out retries. That backoff helps the Docker daemon, and the developer still needs to fix the cause. The loop should lead to a focused read of logs and inspect output rather than a stronger restart policy.

For local development, `on-failure:3` can be kinder than unlimited retries while you are still wiring a new service. Three attempts give the API a chance to survive a short dependency race and then settle into a stopped state with logs intact. Long-running local databases may use `unless-stopped` because developers expect them to come back after Docker Desktop restarts.

## Compose Startup Order Uses Health Evidence
<!-- section-summary: Compose can wait for dependency services marked service_healthy before it creates the dependent service. -->

Docker Compose runs multi-container applications from a YAML file. Our local ticketing stack has at least two services: `api` and `db`. The API depends on the database, and the database needs time to initialize before the API can connect.

Compose has `depends_on` for service relationships. With the short syntax, Compose starts dependency services before the dependent service. With the long syntax and `condition: service_healthy`, Compose waits for a dependency's health check to pass before it creates the dependent service.

```yaml
services:
  api:
    image: devpolaris/tickets-api:local
    ports:
      - "8080:3000"
    environment:
      DATABASE_URL: postgres://tickets:tickets@db:5432/tickets
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:18
    environment:
      POSTGRES_DB: tickets
      POSTGRES_USER: tickets
      POSTGRES_PASSWORD: tickets
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```

This Compose file says the API should wait for the database health check before creation. It gives local startup a clear order, and it makes the health check part of the developer workflow instead of a detail hidden inside production.

The API should still handle database disconnects after startup. Compose startup order helps with the initial race, while application retry and graceful error handling help during normal runtime. Those two behaviors support each other because startup and runtime failures have different shapes.

## A Practical Local Stack
<!-- section-summary: A practical local stack combines database readiness, API health, useful logs, and restart policies with clear limits. -->

Now let's put the pieces into one local Compose file. The database gets a health check because the API depends on it. The API gets its own health check because humans and tools need to see whether the running server can answer. Restart policies stay conservative while the team is still learning the failure modes.

```yaml
services:
  api:
    image: devpolaris/tickets-api:local
    ports:
      - "8080:3000"
    environment:
      NODE_ENV: development
      DATABASE_URL: postgres://tickets:tickets@db:5432/tickets
    depends_on:
      db:
        condition: service_healthy
    restart: on-failure:3
    healthcheck:
      test: ["CMD", "node", "./scripts/healthcheck.js"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 20s

  db:
    image: postgres:18
    environment:
      POSTGRES_DB: tickets
      POSTGRES_USER: tickets
      POSTGRES_PASSWORD: tickets
    volumes:
      - tickets-db-data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

volumes:
  tickets-db-data:
```

This setup gives each signal a job. The database health check says the database can accept the connection the API needs. The API health check says the server can answer its own internal diagnostic command. The API restart policy gives a few recovery attempts after non-zero exits. The database restart policy brings the local data service back after Docker restarts unless the developer stopped it.

The first commands after `docker compose up -d` stay familiar. Compose gives service-level commands, and Docker still stores the underlying container details:

```bash
docker compose ps
docker compose logs --tail 80 api
docker inspect --format '{{json .State.Health}}' "$(docker compose ps -q api)"
```

This is the same evidence path from the previous articles, now applied to a multi-service stack. State tells you what Docker sees. Logs tell you what the process says. Health tells you whether the configured check passes. Inspect gives the detailed status when the short table is too small.

## Where Health and Restart Setup Usually Breaks
<!-- section-summary: Health and restart problems usually come from weak checks, heavy checks, missing tools, startup timing, or policies that hide configuration errors. -->

The first common problem is a **weak health check**. A check that only proves the process exists can report healthy while real requests fail. For the ticketing API, a useful readiness check should cover the HTTP handler and the database path if normal requests need the database.

The second problem is a **heavy health check**. A check that runs expensive SQL, calls third-party APIs, or writes data every few seconds can create its own reliability problem. Health checks should ask a small question that matches caller usefulness.

The third problem is a **missing tool inside the image**. A health command that uses `curl`, `wget`, `bash`, or `pg_isready` needs that tool inside the container where the check runs. Small production images may omit those tools, so a tiny Node or application-native health script can be more reliable.

The fourth problem is **startup timing**. A service that needs 20 seconds to initialize can fail early checks before it has a fair chance to boot. `start_period` gives that known bootstrap window while Docker still counts later probe failures.

The fifth problem is **restart policy overuse**. A restart policy can recover from exits, and it can also repeat the same bad configuration over and over. Logs, exit code, and restart count should guide the fix before anyone changes the retry count.

## Putting It All Together
<!-- section-summary: Health checks observe usefulness, restart policies recover from exits, and Compose can use health to order local services. -->

The container runtime story now has all the important signals. Docker starts one main process from the image and runtime configuration. State tells you whether that process lives. Logs tell you what it said. Inspect shows what Docker created. Exec gives a live view when the process is running.

Health checks add an application-level observation. They tell Docker whether a running process can pass a command that represents useful service behavior. Restart policies add recovery behavior after the process exits. Compose can use health evidence to order dependent services in a local stack.

For the ticketing API, that means the local workflow becomes clear. The database starts and reports healthy after it accepts the expected connection. The API starts with the right environment, waits for the database health signal through Compose, reports its own health, and writes useful logs. If it exits, the restart policy gives a limited recovery path while logs and inspect output keep the cause visible.

That is the everyday Docker container loop: create the container with clear startup settings, watch the main process, read the evidence, add health checks for service usefulness, and use restart policies for recovery while configuration mistakes stay visible. The same loop scales from one local API to a larger Compose stack because the questions stay connected.

---

**References**

- [Dockerfile HEALTHCHECK reference](https://docs.docker.com/reference/dockerfile/#healthcheck) - Documents health check forms, timing options, health states, exit codes, stored output, and health status events.
- [Docker run restart policies](https://docs.docker.com/reference/cli/docker/container/run/#restart-policies---restart) - Documents `--restart`, `no`, `on-failure`, `always`, `unless-stopped`, restart count inspection, and restart backoff.
- [Start containers automatically](https://docs.docker.com/engine/containers/start-containers-automatically/) - Explains Docker restart policies and Docker's guidance around restart policies and process managers.
- [Docker update CLI reference](https://docs.docker.com/reference/cli/docker/container/update/) - Documents updating a container's restart policy with `docker update --restart`.
- [Control startup and shutdown order in Compose](https://docs.docker.com/compose/how-tos/startup-order/) - Documents `depends_on` startup order and `service_healthy` behavior.
- [Compose services reference](https://docs.docker.com/reference/compose-file/services/) - Documents `depends_on`, `condition: service_healthy`, service health checks, and service-level restart configuration.
