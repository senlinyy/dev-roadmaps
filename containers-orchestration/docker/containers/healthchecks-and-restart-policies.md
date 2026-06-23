---
title: "Health Checks and Restart Policies"
description: "Learn how Docker separates running, healthy, ready, and restarting states so local services start clearly and recover from real process exits."
overview: "A container can be running while the service inside it is still warming up, stuck, waiting for a database, or crashing and restarting. This article uses one local API stack to connect startup commands, health checks, readiness, Compose dependencies, and restart policies."
tags: ["docker", "healthchecks", "restart", "readiness"]
order: 4
id: article-containers-orchestration-docker-healthchecks-and-restart-policies
---

## Table of Contents

1. [The Four Signals In One Stack](#the-four-signals-in-one-stack)
2. [The Startup Command Gives Docker The First Signal](#the-startup-command-gives-docker-the-first-signal)
3. [Health Checks Observe A Running Container](#health-checks-observe-a-running-container)
4. [A Health Endpoint Answers A Small Real Question](#a-health-endpoint-answers-a-small-real-question)
5. [Readiness Connects Services Together](#readiness-connects-services-together)
6. [Restart Policies React To Process Exit](#restart-policies-react-to-process-exit)
7. [Restart Loops Need Logs And Exit Codes](#restart-loops-need-logs-and-exit-codes)
8. [Compose Turns Health Into Startup Order](#compose-turns-health-into-startup-order)
9. [Production Habits For Health And Recovery](#production-habits-for-health-and-recovery)
10. [Putting It All Together](#putting-it-all-together)

## The Four Signals In One Stack
<!-- section-summary: Running, healthy, ready, and restarting answer different questions about the same containerized service. -->

Let's keep one example all the way through this article. We have a small `tickets-api` service that creates support tickets, stores them in Postgres, and exposes HTTP routes on port `3000`. A developer wants to run it locally with Docker and Compose. Later, the same patterns will help when the team moves the service into a real environment.

At first, the service looks simple. Build the image, start the container, open the browser, and create a ticket. Then the first strange moment arrives: `docker ps` says the container is `Up`, but the browser still gets a `503`. Or the API starts before Postgres accepts connections. Or the app crashes every few seconds, and Docker keeps trying again. These are separate problems, so Docker gives us separate signals.

**Running** means Docker started the container and the main process inside the container is still alive. Docker watches the process with PID 1 inside the container. If that process exits, the container exits.

**Healthy** means a configured Docker health check command has passed. Docker runs that command inside the container on a schedule and stores the result beside the normal container state. A container can be running while its health status says `starting`, `healthy`, or `unhealthy`.

**Ready** means the service can handle the kind of request its callers need. For `tickets-api`, ready usually means the HTTP server is listening, the app has loaded its configuration, migrations have completed, and the database accepts a small query.

**Restarting** means Docker is applying a restart policy after the main process exits. Restarting talks about process recovery. Health talks about service usefulness while the process is still running.

Here is the connection we will build. Keep this table nearby as the article moves from the startup command to service health, dependency readiness, and process recovery.

| Signal | Question it answers | Example in `tickets-api` |
|---|---|---|
| **Running** | Is the main container process alive? | `node dist/server.js` still runs as PID 1. |
| **Healthy** | Does Docker's health command pass? | `node scripts/healthcheck.js` receives a good `/ready` response. |
| **Ready** | Can callers use the service now? | The API can answer HTTP and make a small Postgres query. |
| **Restarting** | Did the main process exit and trigger a policy? | Docker starts the API again after a non-zero exit. |

This separation matters because each signal leads to a different fix. A bad startup command needs a command change. A bad health check needs a better probe. A readiness problem needs dependency handling and application retry logic. A restart loop needs logs, exit codes, and usually a code or configuration fix.

![Docker service signals infographic showing Running, Healthy, Ready, and Restarting around tickets-api and tickets-db](/content-assets/articles/article-containers-orchestration-docker-healthchecks-and-restart-policies/four-service-signals.png)

*The four signals answer four different questions. `Running` checks the process, `Healthy` checks Docker's probe, `Ready` checks caller usefulness, and `Restarting` tells you Docker is reacting to a process exit.*

Now we can start at the first signal Docker sees: the startup command. If Docker starts the wrong process or watches a wrapper that hides failures, every later signal gets harder to trust.

## The Startup Command Gives Docker The First Signal
<!-- section-summary: Docker can only track the main process honestly when the container command runs the real service in the foreground. -->

A **startup command** is the command Docker runs when it creates the container. In a Dockerfile, that usually comes from `CMD`, sometimes together with `ENTRYPOINT`. Docker treats the process started by that command as the main process for the container.

For our API, the command should run the server in the foreground. This keeps the real service process attached to Docker, so logs, exits, and restart policies all describe the same thing.

```dockerfile
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.js"]
```

This is the clean starting point. Docker starts `node dist/server.js`, the Node process stays attached to the container, and Docker has a real process to watch. If the server exits with code `0`, Docker sees a clean exit. If the server exits with a non-zero code, Docker sees a failure.

Problems start when the startup command hides the real service. A shell script might start the server in the background and then exit. A script might run migrations, swallow an error, and still start the server. A process manager inside the container might restart children outside Docker's clear view. The container may stay `Up` while the real app inside it has failed.

When a wrapper script is useful, make it hand control to the service process with `exec`. The script can still do small setup work first, and the final running process stays visible to Docker.

```sh
#!/bin/sh
set -eu

npm run migrate
exec node dist/server.js
```

The `exec` line replaces the shell with the Node process. Docker now watches the API process directly instead of watching a shell that launched something else. The `set -eu` line also helps the script fail when a command fails or a required variable is missing, so a broken migration or missing secret ends as a clear startup failure instead of a half-started service.

In many teams, migrations run as a separate release step or a separate Compose service. That pattern gives the API one job: start the server and serve requests. We will use that pattern later in the Compose stack, because it keeps startup, readiness, and recovery easier to understand.

Once Docker has a real process to watch, the next question appears. The process is alive, but can the service answer?

## Health Checks Observe A Running Container
<!-- section-summary: A Docker health check runs a command inside the container and records starting, healthy, or unhealthy beside the normal process state. -->

A **Docker health check** is a command Docker runs inside a running container on a schedule. The command returns exit code `0` for success. It returns exit code `1` when the check finds an unhealthy service. Docker reserves exit code `2`, so normal checks should avoid it.

The important detail is that health status sits next to the normal container status. A failed health check changes the health status. The main process keeps running unless the application exits or another system decides to replace the container.

For `tickets-api`, the Dockerfile can include one health check. The command lives with the image, so every container created from the image carries the same default service check.

```dockerfile
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --start-interval=5s --retries=3 \
  CMD node ./scripts/healthcheck.js
```

Docker supports only one `HEALTHCHECK` instruction in a Dockerfile. If a Dockerfile has multiple health checks, the last one takes effect. A Compose file can also override the image health check for local development or for a specific stack.

The timing values control how Docker reads the result. These settings should match the normal boot time and response time of the service instead of guessing from a perfect local run.

| Option | Meaning in plain English | Example use |
|---|---|---|
| `interval` | How often Docker runs the check after startup. | Check the API every `10s`. |
| `timeout` | How long one check may run before Docker treats it as failed. | Give the endpoint `3s`. |
| `retries` | How many failures in a row make the container `unhealthy`. | Mark unhealthy after `3` bad checks. |
| `start-period` | Startup time where Docker ignores failures for the retry count. | Let Node boot and connect pools for `30s`. |
| `start-interval` | Check frequency during the start period in newer Docker versions. | Probe every `5s` while warming up. |

At runtime, the status shows up in `docker ps`. The normal container state and the health state share the same status column, which is why `Up` and `(healthy)` can appear together.

```console
$ docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
NAMES         STATUS                    PORTS
tickets-api   Up 42 seconds (healthy)   0.0.0.0:8080->3000/tcp
```

When the check fails, `docker inspect` shows the recent health history. That output often gives the first useful clue, especially when the application logs are noisy. The command below prints the stored health object as JSON:

```bash
docker inspect --format '{{json .State.Health}}' tickets-api
```

A short failure message helps a lot. The health command can print `ready endpoint timed out after 2500ms` or `database ping failed: connection refused`. Docker stores only a small amount of probe output, so the check should print a compact reason and leave full debugging details to the application logs.

Here is a small Node health check script that calls the API from inside the container. This avoids depending on `curl` or `wget` being installed in a small production image.

```js
const http = require("node:http");

let done = false;

function finish(code, message) {
  if (done) return;
  done = true;
  if (message) {
    const output = code === 0 ? console.log : console.error;
    output(message);
  }
  process.exit(code);
}

const request = http.get("http://127.0.0.1:3000/ready", { timeout: 2500 }, (response) => {
  if (response.statusCode >= 200 && response.statusCode < 300) {
    finish(0, "ready");
    return;
  }

  finish(1, `ready endpoint returned ${response.statusCode}`);
});

request.on("timeout", () => {
  request.destroy();
  finish(1, "ready endpoint timed out after 2500ms");
});

request.on("error", (error) => {
  finish(1, error.message);
});
```

The script checks `127.0.0.1` because it runs inside the same container as the API. It uses the container's own loopback address instead of the host port mapping, the browser, or another container reaching the API. It answers a narrow question: can the API answer its own readiness endpoint right now?

That leads to the next design choice. The health command is only as useful as the endpoint it calls.

## A Health Endpoint Answers A Small Real Question
<!-- section-summary: Health endpoints should be cheap, bounded, side-effect free, and connected to what callers actually need. -->

A **health endpoint** is an application route that returns a small answer about service condition. For a web API, teams often expose `/live`, `/health`, or `/ready`. The names vary, so the useful part is the question each endpoint answers.

For `tickets-api`, a basic liveness endpoint can answer a very small question: is the HTTP server process able to run a handler? This route should stay small enough that it works even during a partial dependency outage.

```js
app.get("/live", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "tickets-api"
  });
});
```

That endpoint is intentionally shallow. It proves the Node process is accepting HTTP work and running route code. Ticket creation needs Postgres, so this route only covers the HTTP part.

Readiness usually asks a deeper question. For this service, `/ready` can verify the API has configuration and can complete a small database query. That makes it a better route for Compose dependency order than a purely shallow process check.

```js
async function withTimeout(work, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), milliseconds);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

app.get("/ready", async (_request, response) => {
  try {
    await withTimeout(db.query("select 1"), 1500);

    response.status(200).json({
      status: "ready",
      checks: {
        http: "ok",
        database: "ok"
      }
    });
  } catch (error) {
    response.status(503).json({
      status: "not_ready",
      checks: {
        http: "ok",
        database: "failed"
      }
    });
  }
});
```

The endpoint does a small `select 1` query, uses a short timeout, and returns quickly. It avoids writes, migrations, external payment calls, email delivery, full search indexing, and any check that could overload a dependency during an incident. A health endpoint should create evidence with minimal extra load.

Real teams often split these questions. A load balancer or orchestrator may use readiness to decide whether to send traffic. A deeper monitoring check may test a full user journey from outside the service. Docker gives a single container health status, so pick the endpoint that matches the thing using the status. For local Compose dependency order, `/ready` is often the useful choice because the API should wait until dependencies can support requests.

Now the API can describe itself. The next problem is the dependency that the API needs before it can be ready.

## Readiness Connects Services Together
<!-- section-summary: Readiness says whether a service can serve callers now, including the dependencies needed for that caller path. -->

A **dependency** is another service your container needs in order to do useful work. `tickets-api` needs Postgres. The API container can start quickly, but Postgres may still be initializing its data directory, replaying logs, creating the database, or waiting for credentials. During that time, the API process can be running while the API is unready.

The simple version is: running means the process exists, readiness means callers can use it. For our stack, the API needs to handle this in two places.

First, the application should retry dependency connections during startup and during normal request handling. Compose can help with initial order, but a database can restart later. A healthy startup sequence still leaves the need for application-level timeouts, retries, and clear error handling.

Second, the stack should expose dependency readiness clearly. Postgres already includes a small readiness tool called `pg_isready`. In Compose, the database service can use it as the health check:

```yaml
services:
  tickets-db:
    image: postgres:18
    environment:
      POSTGRES_USER: tickets
      POSTGRES_PASSWORD: tickets_dev_password
      POSTGRES_DB: tickets
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    volumes:
      - tickets-db:/var/lib/postgresql/data
```

The doubled dollar signs matter in Compose. `$$POSTGRES_USER` sends `$POSTGRES_USER` into the container command so Postgres can read its own environment variable. A single `$POSTGRES_USER` would be expanded by Compose on the host side before the container runs.

For the API, `/ready` can include the database because creating tickets requires the database. That choice still needs limits. If the API can still serve cached read-only pages while an email provider is down, the email provider should usually stay out of readiness. If every request fails without Postgres, the database belongs in readiness.

A useful way to choose is to ask what callers need from this service right now. The readiness check should cover the dependencies that gate that caller path, with short timeouts and no side effects.

Once readiness can describe dependency state, we can talk about process recovery. A dependency problem may make the service unready. A process exit is a different event, and Docker handles it with restart policies.

## Restart Policies React To Process Exit
<!-- section-summary: Restart policies tell Docker what to do after the main container process exits. -->

A **restart policy** tells the Docker daemon whether it should start a container again after the container's main process exits. This is process recovery. It is separate from health status.

Docker supports these common restart policies for normal containers. The right choice depends on whether the container is a long-running service, a worker, a one-shot job, or a local dependency.

| Policy | What Docker does | Good fit |
|---|---|---|
| `no` | Leaves the container stopped after exit. | One-shot jobs, local experiments, migration containers. |
| `on-failure[:max-retries]` | Restarts only after a non-zero exit code, with an optional retry limit. | Batch jobs, workers, services where clean exit should stay stopped. |
| `always` | Restarts after exit and also starts after daemon restart, with manual-stop rules. | Long-running services managed mainly by Docker. |
| `unless-stopped` | Restarts after exit and daemon restart unless someone stopped it. | Local services and small host-managed services. |

For a single container, the flag sits on `docker run`. This makes the restart behavior part of the container configuration at creation time.

```bash
docker run -d \
  --name tickets-api \
  --restart unless-stopped \
  -p 8080:3000 \
  devpolaris/tickets-api:local
```

For Compose, the same idea usually sits on the service. That keeps the restart rule beside the ports, environment variables, health check, and dependency rules for the same service.

```yaml
services:
  api:
    build: .
    restart: unless-stopped
```

Restart policies only start a new container process after the old main process exits. A failing health check by itself changes the health status. Docker keeps an unhealthy result as status with the basic Engine restart policy. Some orchestrators can replace unhealthy tasks, and some applications choose to exit when a critical dependency stays broken, but the Docker restart policy itself watches process exit.

This difference gives you a cleaner local workflow. If `tickets-api` crashes because of a temporary process failure, `restart: unless-stopped` can bring it back. If the API keeps running but loses access to Postgres, the health status should show `unhealthy` while logs and readiness output explain the dependency problem.

For migrations, use a different policy. A migration container should usually run once, succeed, and stop. If it fails because the SQL is bad, restarting forever adds noise. A local stack may use `restart: "no"` for the migration service so the failure stays visible.

Restart policies are useful, and they can also make a broken service noisy. The next skill is reading a restart loop without guessing.

## Restart Loops Need Logs And Exit Codes
<!-- section-summary: Restart loops are debugging evidence, so read the restart count, exit code, logs, and events before changing the policy. -->

A **restart loop** happens when a container exits, Docker restarts it, and the new process exits again. You may see `Restarting` in `docker ps`, or you may see a container that appears `Up` for a few seconds and then starts over.

Docker adds backoff between restart attempts, starting with a short delay and increasing up to a maximum delay. Docker also resets that delay after a container runs successfully for at least 10 seconds. That backoff protects the daemon from a tight crash loop, while the service still needs a real fix.

For `tickets-api`, a restart loop usually comes from a clear cause: missing `DATABASE_URL`, invalid credentials, an application exception during boot, a process killed by memory limits, or a command that exits after doing one task. The fastest path is to read the evidence Docker already has. These commands keep the first debugging pass focused on facts.

```bash
docker ps --all --filter name=tickets-api
docker logs --tail 100 tickets-api
docker inspect --format 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' tickets-api
docker events --filter container=tickets-api
```

The output tells a story. `exit=1` often points to application startup failure. `oom=true` points to memory pressure or a memory limit that is too low. A restart count that climbs quickly tells you the policy is active. Logs tell you what the process said before it exited.

Here is a common local failure. The logs show the app missing configuration, and the inspect output shows Docker repeatedly restarting the failed process.

```console
$ docker logs --tail 20 tickets-api
Error: DATABASE_URL is required

$ docker inspect --format 'exit={{.State.ExitCode}} restarts={{.RestartCount}}' tickets-api
exit=1 restarts=7
```

The useful fix is setting the missing environment variable or failing the stack clearly until the developer sets it. A restart policy should recover from process exits that can recover. It should keep configuration mistakes, broken migrations, and code that exits immediately by design visible.

Once the restart story is clear, we can put the local stack together. Compose gives us a place to express database readiness, migration completion, API health, and restart behavior in one file.

## Compose Turns Health Into Startup Order
<!-- section-summary: Compose can wait for a dependency to become healthy before creating the service that depends on it. -->

**Docker Compose** runs a multi-container application from a YAML file. It is perfect for our local `tickets-api` stack because the API, database, and migration step belong together during development.

The key Compose detail is startup order. Basic `depends_on` can create services in dependency order, but Compose only waits until a dependency is running. A database can be running while it still rejects SQL connections. To wait for usefulness, Compose needs `condition: service_healthy`, and the dependency needs a health check.

Here is a practical local stack. It gives the database, migration job, and API separate responsibilities instead of making the API startup command do every piece of work.

```yaml
services:
  tickets-db:
    image: postgres:18
    environment:
      POSTGRES_USER: tickets
      POSTGRES_PASSWORD: tickets_dev_password
      POSTGRES_DB: tickets
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    volumes:
      - tickets-db:/var/lib/postgresql/data
    restart: unless-stopped

  migrate:
    build: .
    command: ["npm", "run", "migrate"]
    environment:
      DATABASE_URL: postgres://tickets:tickets_dev_password@tickets-db:5432/tickets
    depends_on:
      tickets-db:
        condition: service_healthy
    restart: "no"

  api:
    build: .
    command: ["node", "dist/server.js"]
    environment:
      NODE_ENV: development
      PORT: "3000"
      DATABASE_URL: postgres://tickets:tickets_dev_password@tickets-db:5432/tickets
    ports:
      - "8080:3000"
    depends_on:
      tickets-db:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "node", "scripts/healthcheck.js"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 30s
      start_interval: 5s
    restart: unless-stopped

volumes:
  tickets-db:
```

This file gives each service a clear role. `tickets-db` owns database readiness. `migrate` waits for a healthy database, runs once, and stops. `api` waits for database health and migration success before Compose creates it. Then `api` exposes its own health status so the developer can see whether the service is ready.

The local workflow is now concrete. The developer can build the stack, inspect service state, follow logs, and run the same health command manually from inside the API container.

```bash
docker compose up --build
docker compose ps
docker compose logs -f api tickets-db
docker compose exec api node scripts/healthcheck.js
```

The `ps` output should show the health state. This gives a quick first look before opening logs or inspecting the full health history.

```console
$ docker compose ps
NAME                 SERVICE   STATUS
tickets-db-1         tickets-db running (healthy)
tickets-migrate-1    migrate   exited (0)
tickets-api-1        api       running (healthy)
```

If Postgres takes longer than usual, Compose waits because `api` depends on `tickets-db` with `service_healthy`. If migrations fail, `api` stays uncreated because it depends on `migrate` with `service_completed_successfully`. If the API starts and then loses the database later, the application still needs its own retry and error handling, because Compose dependency conditions are mostly about creation order.

Compose also supports `restart: true` inside a long-form `depends_on` entry. That setting tells Compose to restart a dependent service after an explicit Compose operation restarts or updates its dependency, such as `docker compose restart tickets-db`. That can help local services reconnect during developer-driven restarts, while application retry logic still handles real runtime disconnects.

![Docker Compose startup order infographic showing tickets-db healthy first, migrate complete second, and tickets-api healthy last with host port 8080 to container port 3000](/content-assets/articles/article-containers-orchestration-docker-healthchecks-and-restart-policies/compose-health-startup-order.png)

*Compose startup order stays clear when each service has one job: the database proves health, migrations complete once, and the API starts last with its own health check and published port.*

This local stack is practical enough to use. Now we can step back and name the production habits behind it.

## Production Habits For Health And Recovery
<!-- section-summary: Real teams keep checks small, separate readiness from recovery, and make failures visible through logs and metrics. -->

Production health checks work best when they are boring. The check should finish quickly, use a short timeout, avoid writes, avoid slow third-party calls, and return a clear result. It should check the service path that matters for routing or dependency order instead of every possible downstream system.

For our API, a good Docker health check calls `/ready`, and `/ready` checks HTTP handling plus a tiny database query. The check should avoid sending test tickets, running migrations, calling payment providers, creating email messages, or scanning whole tables. Those actions belong in smoke tests, monitoring checks, or release verification instead of a container health probe that runs every few seconds.

Readiness and recovery also need separate thinking. Readiness tells callers whether the service should receive traffic now. Restart policy tells Docker whether to start the process again after exit. A service that loses Postgres for 10 seconds may report unready while it retries. A service that fails to boot because required configuration is missing should fail loudly and leave evidence.

The same ideas map to larger platforms. Kubernetes has separate liveness, readiness, and startup probes. Cloud load balancers usually have target health checks. Process supervisors and orchestrators have their own restart controls. Docker's health check and restart policy give you the smaller local version of the same operational conversation, which is why learning the separation here pays off later.

A simple production checklist for this topic looks like this. It is short on purpose, because reliable container health usually comes from a few boring habits applied consistently.

| Area | Good habit |
|---|---|
| Startup command | Run the real service in the foreground, and use `exec` in wrapper scripts. |
| Health command | Keep it short, bounded, side-effect free, and easy to inspect. |
| Readiness | Include dependencies that block the caller path, with timeouts. |
| Restart policy | Use it for process exits, and avoid infinite restarts for one-shot jobs. |
| Debugging | Read logs, exit code, OOM status, restart count, and health output together. |
| Compose | Use `service_healthy` for dependencies that need readiness rather than only start order. |

These habits keep local Docker from giving false comfort. `Up` is useful, but it is only the first signal. The service still needs to prove it can answer, and a crash still needs a clear recovery policy.

## Putting It All Together
<!-- section-summary: Health checks observe service usefulness, restart policies recover exited processes, and Compose connects the two for local stacks. -->

Let's replay the `tickets-api` stack from the beginning. The Dockerfile gives Docker a clean startup command, so the container state reflects the real Node server process. The app exposes `/live` for the shallow process check and `/ready` for the request path that needs Postgres. The health check calls `/ready` with a short timeout and returns a simple exit code.

Postgres gets its own health check with `pg_isready`. Compose waits for Postgres to become healthy, runs migrations once, and then starts the API after migration success. The API has `restart: unless-stopped` because it is a long-running local service. The migration container has `restart: "no"` because a failed migration should stay visible.

When something breaks, the signal tells you where to look. `Up` without healthy points to the health endpoint, dependency readiness, or the check command. `Restarting` points to process exit, logs, exit code, OOM state, and restart count. A dependency outage after startup points to application retry behavior and readiness responses. Those are different debugging paths, and separating them saves time.

That is the practical Docker loop for this last container article: design the startup command so Docker watches the right process, add health checks so a running container can prove usefulness, use readiness to coordinate dependencies, and use restart policies for process recovery without hiding broken configuration. The local stack stays understandable because every signal answers one clear question.

![Docker restart loop evidence summary infographic showing logs, exit code, OOMKilled, restart count, health output, and fixing root causes such as env, memory, command, and dependency](/content-assets/articles/article-containers-orchestration-docker-healthchecks-and-restart-policies/restart-loop-evidence-summary.png)

*A restart loop should send you back to evidence, not straight to a stronger restart policy. Logs, exit code, OOM state, restart count, and health output point toward the real fix: configuration, memory, command, or dependency behavior.*

---

**References**

- [Dockerfile `HEALTHCHECK` reference](https://docs.docker.com/reference/dockerfile/#healthcheck) - Documents health check forms, timing options, exit codes, health status, probe output, and the one-healthcheck rule.
- [Docker Compose `healthcheck` reference](https://docs.docker.com/reference/compose-file/services/#healthcheck) - Documents Compose health checks, `test`, `interval`, `timeout`, `retries`, `start_period`, `start_interval`, and disabling inherited checks.
- [Control startup and shutdown order in Compose](https://docs.docker.com/compose/how-tos/startup-order/) - Explains `depends_on`, `service_healthy`, `service_completed_successfully`, and the difference between running and ready dependencies.
- [Start containers automatically](https://docs.docker.com/engine/containers/start-containers-automatically/) - Explains Docker restart policies, the `--restart` flag, manual stop behavior, and Docker's guidance to use restart policies instead of process managers.
- [Docker run restart policies](https://docs.docker.com/reference/cli/docker/container/run/#restart-policies---restart) - Documents `no`, `on-failure`, `always`, `unless-stopped`, restart backoff, restart count inspection, and `--rm` compatibility.
- [Docker container update](https://docs.docker.com/reference/cli/docker/container/update/#update-a-containers-restart-policy---restart) - Shows how to change a restart policy on an already running container.
- [PostgreSQL `pg_isready`](https://www.postgresql.org/docs/current/app-pg-isready.html) - Documents the readiness command used by the Postgres health check examples.
- [Postgres Docker Official Image](https://hub.docker.com/_/postgres) - Documents the official image environment variables and data directory used by the local Postgres service.
