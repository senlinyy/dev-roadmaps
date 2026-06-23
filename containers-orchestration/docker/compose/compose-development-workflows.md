---
title: "Compose Workflows"
description: "Use Compose as a development loop for starting stacks, running one-off commands, updating code, and resetting local state deliberately."
overview: "Compose is more than a file format. This article shows how the same application model supports the daily loop of starting, inspecting, changing, testing, and resetting a local stack."
tags: ["docker", "compose", "development", "workflow"]
order: 3
id: article-containers-orchestration-docker-compose-development-workflows
---

## Table of Contents

1. [The Daily Compose Loop](#the-daily-compose-loop)
2. [The Stack We Are Running](#the-stack-we-are-running)
3. [Start and Reconcile with Up](#start-and-reconcile-with-up)
4. [Foreground and Detached Mode](#foreground-and-detached-mode)
5. [Inspect the Stack with Ps, Logs, and Config](#inspect-the-stack-with-ps-logs-and-config)
6. [Exec for the Running Container View](#exec-for-the-running-container-view)
7. [Run for One-Off Work](#run-for-one-off-work)
8. [Update Code with Rebuilds, Bind Mounts, and Watch](#update-code-with-rebuilds-bind-mounts-and-watch)
9. [Optional Tools Behind Profiles](#optional-tools-behind-profiles)
10. [Stop, Reset, and Prune with Care](#stop-reset-and-prune-with-care)
11. [A Practical Team Workflow](#a-practical-team-workflow)
12. [Putting It All Together](#putting-it-all-together)
13. [References](#references)

## The Daily Compose Loop
<!-- section-summary: A Compose workflow is the repeated local development path for starting the project, checking evidence, changing code, running tasks, and resetting state. -->

In the first two Compose articles, we built a shared application map for a notes app used by an internal training team. The app has an `api`, a `worker`, a PostgreSQL `db`, `redis` for short job queues, and `mailpit` for local email. That map already tells us which services exist, how they talk to each other, which ports reach the host, and which volume keeps database files.

Daily development adds rhythm to that map. A teammate starts the stack in the morning, watches the API logs, changes a file, runs a migration, opens a shell inside the API container, starts an optional database browser, runs tests, and resets the local database after experimenting with a schema. Those are workflow actions, and each one touches a different Docker lifetime.

The most useful way to learn Compose workflows is to connect each command to the thing it changes. **`docker compose up`** reconciles the project against the Compose file. **`docker compose ps`** shows service container state. **`docker compose logs`** reads process output. **`docker compose config`** shows the resolved Compose model. **`docker compose exec`** enters a container that already exists. **`docker compose run`** creates a fresh one-off container for a task. **Watch** responds to file changes. **Profiles** turn optional services on for a specific use case. Cleanup commands decide whether data survives.

![Daily Docker Compose loop infographic showing compose.yaml feeding up, ps, logs, exec, run, watch, and down around api, db, and worker services](/content-assets/articles/article-containers-orchestration-docker-compose-development-workflows/daily-compose-loop.png)

*The daily loop connects each command to the lifetime it touches, from starting the stack to inspecting evidence and resetting local state.*

That separation is what makes the workflow safe. When someone says, "I rebuilt the API," the team knows the database volume should still be there. When someone says, "I ran the full reset," the team knows local rows probably disappeared. Good Compose usage is partly about commands, and partly about shared language.

## The Stack We Are Running
<!-- section-summary: The workflow examples use one notes training app so every command has a concrete service, dependency, port, and data lifetime. -->

Here is the development stack we will use for the rest of the article. It is small enough to read, and it includes the pieces real teams usually need: application services, stateful services, local email, bind mounts for source code, a named database volume, and optional admin tools.

```yaml
name: notes-dev

services:
  api:
    build:
      context: .
      target: dev
    working_dir: /workspace
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
    volumes:
      - .:/workspace
      - api-node-modules:/workspace/node_modules
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started

  worker:
    build:
      context: .
      target: dev
    working_dir: /workspace
    command: npm run worker
    environment:
      DATABASE_URL: postgres://notes:notes_dev_password@db:5432/notes
      REDIS_URL: redis://redis:6379
      SMTP_HOST: mailpit
      SMTP_PORT: "1025"
    volumes:
      - .:/workspace
      - api-node-modules:/workspace/node_modules
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
      start_period: 30s

  redis:
    image: redis:8

  mailpit:
    image: axllent/mailpit:v1.27
    ports:
      - "127.0.0.1:8025:8025"

  adminer:
    image: adminer:5
    profiles: ["admin"]
    ports:
      - "127.0.0.1:8081:8080"
    depends_on:
      db:
        condition: service_healthy

volumes:
  db-data:
  api-node-modules:
```

The core app is `api`, `worker`, `db`, `redis`, and `mailpit`. The API listens inside the container on port `3000`, and the laptop reaches it through `127.0.0.1:8080`. Mailpit publishes a local browser UI on `127.0.0.1:8025`, so the training app can send password reset and enrollment emails without touching real inboxes.

The optional service is `adminer`. It belongs to the `admin` profile, which means normal startup can skip it, and a developer can include it during a database debugging session. That small detail keeps everyday laptops lighter while keeping the tool in the same reviewed Compose file.

## Start and Reconcile with Up
<!-- section-summary: docker compose up reads the Compose model, creates missing resources, starts services, and recreates containers whose configuration or image changed. -->

The main startup command is `docker compose up`. In plain terms, **up** tells Compose to make the running project match the Compose file as closely as it can. Docker's own CLI reference says `up` builds, recreates, starts, and attaches to service containers, and that is exactly the behavior developers use during the local loop.

```bash
docker compose up
```

On a fresh checkout, this command has a lot to do. Compose reads `compose.yaml`, creates the `notes-dev` project boundary, creates the default network, creates named volumes, builds the `api` and `worker` images, starts `db` and `redis`, waits on the database health check before starting dependent services, starts `mailpit`, and attaches the logs to your terminal.

The key concept is **reconciliation**. Reconciliation means Compose compares the desired app shape in the file with the Docker resources that already exist, then makes the running project line up with that desired shape. If a service container is missing, Compose creates it. If a service container already exists and its configuration or image changed, Compose can stop and recreate it while preserving mounted volumes.

That preservation matters for the notes app. If the API image changes, Compose can replace the API container. The `db-data` volume still holds Postgres files because the data lives in a named volume outside the disposable API container. This is why a rebuild usually keeps local notes, training users, and migration history.

When a Dockerfile, dependency file, or build stage changes, the image needs a fresh build before the service uses that change. The `--build` flag asks Compose to build images before starting the services.

```bash
docker compose up --build
```

Teams often use a narrower form while working on one service. This starts the API and anything it depends on, while Compose still reads the whole project model.

```bash
docker compose up --build api
```

Sometimes the file changed in a way that Compose may already detect through its service config hash. Other times the team wants to force a fresh service container because generated files, entrypoint behavior, or build output created confusion. In that case, `--force-recreate` makes the recreation explicit.

```bash
docker compose up --force-recreate api
```

The important habit is to name what you expect to survive. Recreating an application container should keep named volumes. Rebuilding an image should keep named volumes. A data reset should use a cleanup command that clearly targets volumes, and we will get there later.

## Foreground and Detached Mode
<!-- section-summary: Foreground mode keeps the startup story and logs in one terminal, while detached mode leaves the stack running in the background for normal development. -->

Foreground mode is what you get from `docker compose up` without `-d`. Compose attaches the service logs to the terminal, so you can watch startup happen in one place. For a first run, a new branch, or a service that exits during startup, foreground mode gives the most useful evidence because you see `db`, `redis`, `api`, `worker`, and `mailpit` speak as they start.

```bash
docker compose up --build
```

In foreground mode, pressing `Ctrl+C` stops the containers that command is managing. That behavior is useful during a short debugging run because the stack stops when the terminal session ends. It can also surprise a new teammate who expected the project to keep running after closing the terminal.

Detached mode uses `-d`, short for **detached**. Detached mode starts the containers in the background and returns your terminal, so the stack keeps running while you use your editor, browser, test command, and a separate log terminal.

```bash
docker compose up -d
```

This is the normal daily mode after the stack works. A developer can start the app, open `http://127.0.0.1:8080` for the API, open `http://127.0.0.1:8025` for Mailpit, and keep coding. When they need logs, they ask for focused logs instead of leaving every service attached in the startup terminal.

Foreground and detached mode support different moments in the same day. Foreground gives a full startup story. Detached gives a steady workbench. A practical team will usually teach both in the first-run instructions, because the same command with one flag changes how the whole session behaves.

## Inspect the Stack with Ps, Logs, and Config
<!-- section-summary: ps, logs, and config answer three different questions: what containers exist, what the processes are saying, and what Compose model Docker will apply. -->

Once the stack is up, the first question is usually simple: what is running? `docker compose ps` lists containers for the current Compose project, including status and exposed ports. It is the quick health check before you chase a deeper bug.

```bash
docker compose ps
```

For the notes app, this output should show `api`, `worker`, `db`, `redis`, and `mailpit`. The database row may show a health status, and the API row should show the port mapping to `127.0.0.1:8080`. If a service exited, `ps --all` includes stopped containers so the failure still shows up in the table.

```bash
docker compose ps --all
```

The second question is what the process said. `docker compose logs` reads service logs, and `-f` follows new lines as they arrive. Focused logs usually beat a giant terminal full of every service because the API and worker are the services where application errors usually appear.

```bash
docker compose logs -f api worker
```

When the team debugs a failed startup, a short tail keeps the screen readable. When the problem happened a few minutes ago, `--since` gives a time window.

```bash
docker compose logs --tail=100 api
docker compose logs --since=10m worker
```

The third question is about the model itself. `docker compose config` renders the resolved Compose file after file merges, variable interpolation, and short syntax expansion. This matters when the YAML in front of you came from multiple files, shell variables, or an `.env` file.

```bash
docker compose config
```

If the API publishes the wrong host port, `config` shows the resolved `ports` entry. If the database URL has the wrong password, `config --environment` can show the environment values Compose used for interpolation. That keeps the investigation tied to evidence instead of a long round of guesses.

```bash
docker compose config --environment
docker compose config --services
docker compose config --profiles
```

These commands are daily tools for normal development. A healthy team uses `ps` to check service state, `logs` to read process evidence, and `config` to confirm the model before changing the file. That order prevents a lot of random edits.

## Exec for the Running Container View
<!-- section-summary: docker compose exec runs a command inside an existing service container, so it shows the same environment, mounts, and network view as the running process. -->

**`docker compose exec`** runs a command inside a service container that already exists. That phrase is the whole point. If the API is running and behaving strangely, `exec` puts you inside that same runtime context instead of creating a separate task container.

```bash
docker compose exec api sh
```

From that shell, the developer sees the API container's environment, working directory, mounted files, installed tools, and private network view. If the API reports a missing source file, `exec` lets the developer inspect `/workspace` from inside the container. If the API reports a Redis connection failure, the developer can test from the API's own network namespace.

```bash
docker compose exec api printenv DATABASE_URL
docker compose exec api ls -la /workspace
docker compose exec api node -e "console.log(process.env.REDIS_URL)"
```

Database inspection is another common `exec` use. The `db` service already contains the Postgres process and the `psql` client, so the developer can open a SQL prompt inside that existing container.

```bash
docker compose exec db psql -U notes -d notes
```

The same idea works for Redis. The Redis container has the Redis process and usually includes `redis-cli`, so the developer can check queues or keys through the existing service.

```bash
docker compose exec redis redis-cli LLEN training_jobs
```

`exec` fits questions about a container that is already running. The API's environment, the mounted source tree, the database volume, the service network, and the process logs all belong to the running project. `exec` keeps your viewpoint inside that project.

## Run for One-Off Work
<!-- section-summary: docker compose run creates a new temporary container from a service definition, which suits migrations, tests, seed scripts, and other task commands. -->

**`docker compose run`** creates a fresh container from a service definition, runs one command, and then leaves the long-running service container alone. Docker's reference describes it as a one-off command against a service, and that wording maps nicely to development work: migrations, tests, seed scripts, code generators, and repair tasks.

The notes team can run a migration using the `api` service shape. The one-off container gets the API image, environment variables, project network, and source mounts, so it can reach Postgres at `db:5432`.

```bash
docker compose run --rm api npm run db:migrate
```

The `--rm` flag removes the one-off container after the command exits. That keeps `docker compose ps --all` from filling up with old migration containers. The database rows and schema changes remain because the migration wrote to Postgres in the `db-data` volume.

Tests use the same pattern. The test container uses the app image and the same Compose network, while the normal `api` service can keep serving browser requests in the background.

```bash
docker compose run --rm api npm test
```

Training data seeding also fits well. The seed command can create a few demo users, sample notes, and queued background jobs for the workshop.

```bash
docker compose run --rm api npm run seed:training
```

One important `run` detail saves many port collisions. By default, Compose skips the service's port publishing for a `run` container. If your regular API service already uses `127.0.0.1:8080`, a one-off API-shaped task skips that same host port.

```bash
docker compose run --rm --service-ports api npm run dev
```

`--service-ports` asks Compose to publish the service ports for that one-off container. It belongs in commands that really need host access, such as a temporary debug server. Most migrations, tests, lint commands, and code generators should skip host ports.

Some one-off commands need only the image and mounted source files. Linting usually skips Postgres, Redis, and Mailpit, so `--no-deps` keeps the task fast.

```bash
docker compose run --rm --no-deps api npm run lint
```

The boundary between `exec` and `run` is practical. `exec` inspects or operates inside something already running. `run` creates a short-lived task container from a service definition. That one distinction clears up a lot of daily Compose confusion.

## Update Code with Rebuilds, Bind Mounts, and Watch
<!-- section-summary: Code-change workflows decide how edited files reach a service: rebuild the image, mount host files directly, or let Compose Watch sync and rebuild by rule. -->

After the stack starts and the team knows how to inspect it, the next daily question is about code changes. A saved file on the host needs a path into the container somehow. Compose teams usually choose among three workflows: rebuild the image, use bind mounts, or use Compose Watch.

The **rebuild workflow** treats the image as the runtime source of truth. When source files, dependency files, or the Dockerfile change, the developer rebuilds and recreates the service container.

```bash
docker compose up --build -d api worker
```

This is close to the way many deployment environments work because the runtime files come from the image. It is also slower for constant editing in languages with large dependency trees. Teams often use rebuilds for dependency changes and production-like checks, even when they use faster paths for ordinary source edits.

The **bind mount workflow** connects a host path directly into the container. In our Compose file, `.:/workspace` makes source edits from the laptop appear inside the `api` and `worker` containers. The separate `api-node-modules` volume keeps container-installed dependencies from being hidden by the host checkout.

```yaml
services:
  api:
    build:
      context: .
      target: dev
    working_dir: /workspace
    command: npm run dev
    volumes:
      - .:/workspace
      - api-node-modules:/workspace/node_modules
```

This works well when the app process already watches files. A Node.js development server, a Python reload server, or a Rails development server can notice changed files and reload itself. The bind mount keeps the source path simple, and the app's own tooling handles the reload.

The bind mount also explains many local-only bugs. If the image copied files into `/workspace` during the build, the host mount covers that path at runtime. That is why teams keep dependencies, generated caches, and runtime-only directories in named volumes or separate paths when the source directory is mounted.

**Compose Watch** gives a more controlled file-change path through the `develop.watch` section. Watch rules can sync files into the container, rebuild the image, or sync and restart the service when a path changes. Docker documents `sync`, `rebuild`, and `sync+restart` as the main actions, and the right choice depends on what changed.

```yaml
services:
  api:
    build:
      context: .
      target: dev
    working_dir: /workspace
    command: npm run dev
    develop:
      watch:
        - action: sync
          path: ./src
          target: /workspace/src
          initial_sync: true
          ignore:
            - node_modules/
        - action: rebuild
          path: package.json
        - action: sync+restart
          path: ./config/api.dev.json
          target: /workspace/config/api.dev.json
```

```bash
docker compose up --watch
```

In this setup, source edits under `src` sync into the running container, a `package.json` change triggers a rebuild, and a config-file change syncs the file and restarts the API process. That gives the team a clear contract: source code is a sync path, dependencies are a rebuild path, and config is a restart path.

Watch has a few practical requirements. The image needs common file utilities such as `stat`, `mkdir`, and `rmdir`, and the container user needs write access to the target path. Teams that run containers as a non-root user often use `COPY --chown` in the Dockerfile so the app user owns the files that Watch updates.

The best workflow is the one the whole team can explain. Some projects standardize on bind mounts because the framework reloads well. Some projects standardize on Watch because full bind mounts are slow on their laptops. Some projects rebuild for every change because the runtime image must match deployment closely. The important thing is to write down which paths need which action.

![Exec, run, and watch infographic comparing existing-container inspection, one-off task containers, and file-change sync or rebuild rules](/content-assets/articles/article-containers-orchestration-docker-compose-development-workflows/exec-run-watch.png)

*The three cards keep the workflow choices separate: `exec` uses what is already running, `run` creates a task container, and Watch reacts to file changes by rule.*

## Optional Tools Behind Profiles
<!-- section-summary: Profiles let the Compose file include optional services while normal startup runs only the core app. -->

**Profiles** are Compose's way to keep optional services in the same file without starting them every time. Docker's profile documentation explains the default rule: services without a `profiles` attribute are enabled by default, and services with a profile start only when that profile is active or when the service is explicitly targeted.

The notes app keeps `api`, `worker`, `db`, `redis`, and `mailpit` as core services. It puts `adminer` behind the `admin` profile because most daily work skips the database browser.

```yaml
services:
  adminer:
    image: adminer:5
    profiles: ["admin"]
    ports:
      - "127.0.0.1:8081:8080"
    depends_on:
      db:
        condition: service_healthy
```

A normal startup runs the core app. Adminer stays out of that path, so the default development stack remains focused on the application services.

```bash
docker compose up -d
```

When a developer wants the database browser, they enable the profile for that run. Compose starts the unprofiled core services plus services in the `admin` profile.

```bash
docker compose --profile admin up -d
```

Multiple profiles work the same way. A team might add a `queue` profile for a Redis browser or an `email-debug` profile for extra email inspection tools. The profile flag keeps the optional tool choice visible at the command line.

```bash
docker compose --profile admin --profile queue up -d
COMPOSE_PROFILES=admin,queue docker compose up -d
```

Profiles also help with one-off tool services. If a profiled migration service is explicitly targeted with `docker compose run`, Compose can run that targeted service without enabling every service that shares the profile. That makes profiles useful for debug tools and task services as well as long-running optional containers.

The practical team rule is simple. Core services should stay unprofiled so `docker compose up -d` gives every developer a working app. Optional admin tools, heavy observability services, and workshop-only helpers should use profiles so they are available without becoming the default.

## Stop, Reset, and Prune with Care
<!-- section-summary: Cleanup commands have different data effects, so teams should separate stopping containers, removing project resources, deleting volumes, and pruning global Docker state. -->

Cleanup is the workflow where a tiny flag can delete the data someone expected to keep. Compose gives you several levels, and each level touches a different lifetime. The safest team habit is to name the level before running the command.

The gentlest command is `docker compose stop`. It stops running containers and keeps the containers, networks, and volumes in place. Docker documents that stopped containers can be started again with `docker compose start`.

```bash
docker compose stop
docker compose start
```

This is an end-of-day command. It frees CPU and memory while keeping the project state close to where it was. The database container is stopped, and the database files remain in `db-data`.

`docker compose down` removes service containers and project networks by default. It gives the next `up` a clean set of containers while preserving named volumes from the Compose file.

```bash
docker compose down
docker compose up -d
```

This is a clean-container reset. It helps when a container process is stuck, a network needs to be recreated, or the app should start fresh while local data remains. The Postgres rows remain because `down` leaves the named `db-data` volume alone by default.

`docker compose down --volumes` is the full local data reset. It removes named volumes declared in the Compose file, so the next startup creates an empty database volume.

```bash
docker compose down --volumes
docker compose up -d
docker compose run --rm api npm run db:migrate
docker compose run --rm api npm run seed:training
```

That command is useful after a schema experiment or when a workshop needs a clean database. It should be a deliberate action because local notes, training users, queued jobs, and migration state disappear with the volume.

Sometimes the team wants to remove only one named volume. Compose project names become part of Docker volume names, so the notes database volume is usually `notes-dev_db-data` when the project name is `notes-dev`.

```bash
docker compose down
docker volume rm notes-dev_db-data
docker compose up -d
```

This is more precise than deleting every Compose volume. It also leaves a clear terminal history showing that the database data was the reset target.

Prune commands need extra care because they operate outside one Compose project. **Prune** means Docker removes unused resources. `docker system prune` removes unused Docker data such as stopped containers, unused networks, dangling images, and build cache, and Docker can optionally include volumes. `docker volume prune` removes unused local volumes, and with `--all` it can remove unused named volumes too.

```bash
docker system prune
docker system prune --all
docker volume prune
docker volume prune --all
```

These commands are helpful when Docker Desktop or a development machine is low on disk space. They are risky as a casual reset command because "unused" is broader than "this Compose project." A stopped training database volume can look unused if no container references it. A team reset should prefer `docker compose down` and targeted volume removal before reaching for global prune commands.

## A Practical Team Workflow
<!-- section-summary: A team workflow turns Compose commands into a small repeatable path for setup, daily work, task commands, optional tools, resets, and disk cleanup. -->

A good Compose workflow is a small scriptable routine with named paths. New teammates should know the first-run path, the daily path, the task path, the optional-tool path, the reset path, and the disk-cleanup warning.

The first-run path builds images and starts the app in foreground mode. This gives a new developer immediate evidence: build output, database health, API startup, worker startup, and Mailpit startup all appear in one terminal.

```bash
docker compose up --build
```

After that first successful run, the daily path can move to detached mode with focused logs. The app keeps running in the background, while a second terminal follows the services that change most during coding.

```bash
docker compose up -d
docker compose logs -f --tail=100 api worker
```

The inspection path starts with service state and then checks the resolved model when values look wrong. This is the path a teammate should use before changing YAML.

```bash
docker compose ps
docker compose config
docker compose config --environment
```

The task path uses `run --rm` for commands that should have the API service configuration without becoming the long-running API service. Migrations, tests, linting, and training seed data all fit here.

```bash
docker compose run --rm api npm run db:migrate
docker compose run --rm api npm test
docker compose run --rm --no-deps api npm run lint
docker compose run --rm api npm run seed:training
```

The runtime-debug path uses `exec` because the developer wants to stand inside an existing container. That gives the real environment, mounts, network, and process context.

```bash
docker compose exec api sh
docker compose exec db psql -U notes -d notes
docker compose exec redis redis-cli LLEN training_jobs
```

The optional-tool path uses profiles. Adminer stays one flag away, and normal startup remains focused on the app.

```bash
docker compose --profile admin up -d
```

The reset path uses names that say what will happen to data. A clean-container reset preserves the database volume. A full local reset removes it and then rebuilds the database through migrations and seed data.

```bash
docker compose down
docker compose up -d
```

```bash
docker compose down --volumes
docker compose up -d
docker compose run --rm api npm run db:migrate
docker compose run --rm api npm run seed:training
```

Many teams wrap these in scripts after the commands settle. A `package.json`, `Makefile`, or `justfile` can give names to the workflow without hiding the underlying Compose commands from developers.

```json
{
  "scripts": {
    "dev": "docker compose up -d",
    "dev:logs": "docker compose logs -f --tail=100 api worker",
    "dev:migrate": "docker compose run --rm api npm run db:migrate",
    "dev:test": "docker compose run --rm api npm test",
    "dev:admin": "docker compose --profile admin up -d",
    "dev:reset": "docker compose down --volumes && docker compose up -d && docker compose run --rm api npm run db:migrate && docker compose run --rm api npm run seed:training"
  }
}
```

That script block is small, but it gives the team shared language. "Run `dev:reset`" has a clear data meaning. "Run `dev:migrate`" means a one-off API-shaped container will run the migration. "Run `dev:logs`" means follow the API and worker logs without drowning in every service.

## Putting It All Together
<!-- section-summary: Compose workflows stay predictable when every command maps to the project, service, container, file, profile, or volume lifetime it changes. -->

Compose started this module as an application model, and daily workflow is where that model pays off. The same `compose.yaml` describes the notes training app, and each command works against a clear part of that app. `up` reconciles the project, `ps` reads service state, `logs` reads process output, and `config` renders the resolved model.

The runtime commands split into two useful paths. `exec` enters an existing container when you want the real running viewpoint. `run` creates a short-lived task container when you want migrations, tests, linting, seeding, or another command shaped like a service.

Code updates need an explicit team choice. Rebuilds keep the image as the runtime source, bind mounts make host edits visible inside containers, and Compose Watch gives rule-based sync, rebuild, and restart behavior. Profiles keep optional tools available without making every laptop run them by default.

Cleanup works best when the team says which lifetime it is changing. `stop` pauses containers, `down` removes containers and networks while preserving named volumes, `down --volumes` resets local data, and prune commands clean global Docker resources with broader impact. That is the whole daily Compose loop: start the stack, inspect it, change code, run tasks, enable tools when needed, and reset state deliberately.

![Compose workflow runbook checklist covering first run, daily start, inspect, task, optional tools, reset, prune caution, and data cleanup effect](/content-assets/articles/article-containers-orchestration-docker-compose-development-workflows/compose-workflow-runbook.png)

*The runbook summary gives the team a shared command vocabulary and makes the data effect explicit before cleanup.*

## References

- [docker compose up](https://docs.docker.com/reference/cli/docker/compose/up/) - Documents creating, starting, attaching to, and recreating service containers, including `--build`, detached mode, and mounted-volume preservation during recreation.
- [docker compose ps](https://docs.docker.com/reference/cli/docker/compose/ps/) - Documents listing Compose project containers with status and exposed ports.
- [docker compose logs](https://docs.docker.com/reference/cli/docker/compose/logs/) - Documents viewing service log output, following logs, tailing logs, and time filtering.
- [docker compose config](https://docs.docker.com/reference/cli/docker/compose/config/) - Documents rendering the resolved Compose model after file merging, variable interpolation, and short-syntax expansion.
- [docker compose exec](https://docs.docker.com/reference/cli/docker/compose/exec/) - Documents running commands inside existing Compose service containers.
- [docker compose run](https://docs.docker.com/reference/cli/docker/compose/run/) - Documents one-off service containers, command overrides, default port behavior, `--rm`, `--no-deps`, and `--service-ports`.
- [Use Compose Watch](https://docs.docker.com/compose/how-tos/file-watch/) - Documents `develop.watch`, `sync`, `rebuild`, `sync+restart`, `initial_sync`, ignore rules, prerequisites, and `docker compose up --watch`.
- [Using profiles with Compose](https://docs.docker.com/compose/how-tos/profiles/) - Documents optional services, profile activation, multiple profiles, targeted profiled services, and default behavior for unprofiled services.
- [docker compose stop](https://docs.docker.com/reference/cli/docker/compose/stop/) - Documents stopping running containers without removing them.
- [docker compose down](https://docs.docker.com/reference/cli/docker/compose/down/) - Documents removing Compose service containers and networks by default, preserving named volumes unless `--volumes` is used.
- [docker system prune](https://docs.docker.com/reference/cli/docker/system/prune/) - Documents global cleanup of unused Docker data and the optional volume flag.
- [docker volume prune](https://docs.docker.com/reference/cli/docker/volume/prune/) - Documents cleanup of unused local volumes and the `--all` behavior for unused named volumes.
