---
title: "Commands, Entrypoints, and Environment"
description: "Design predictable Docker container startup with CMD, ENTRYPOINT, runtime arguments, environment variables, WORKDIR, USER, and signal handling."
overview: "A container starts one main process from image defaults and runtime inputs. This article follows a missing configuration bug into a clean startup contract for a small API, then shows how teams design commands, environment, users, working directories, and stop behavior for production."
tags: ["docker", "cmd", "entrypoint", "environment", "signals"]
order: 3
id: article-containers-orchestration-docker-commands-entrypoints-and-environment
---

## Table of Contents

1. [The Startup Map](#the-startup-map)
2. [Reproduce the Missing Configuration](#reproduce-the-missing-configuration)
3. [CMD Sets the Default Job](#cmd-sets-the-default-job)
4. [ENTRYPOINT Sets the Main Executable](#entrypoint-sets-the-main-executable)
5. [Exec Form and Shell Form Change the Process](#exec-form-and-shell-form-change-the-process)
6. [Runtime Overrides Help You Debug One Container](#runtime-overrides-help-you-debug-one-container)
7. [Environment Variables Carry Runtime Settings](#environment-variables-carry-runtime-settings)
8. [Secrets Need a Different Boundary](#secrets-need-a-different-boundary)
9. [WORKDIR and USER Shape the Process Context](#workdir-and-user-shape-the-process-context)
10. [Signals Decide How the Container Stops](#signals-decide-how-the-container-stops)
11. [A Practical Startup Design](#a-practical-startup-design)
12. [Startup Checks Before You Ship](#startup-checks-before-you-ship)
13. [What's Next](#whats-next)

## The Startup Map
<!-- section-summary: Container startup combines image defaults, runtime settings, process context, and stop behavior into one contract. -->

In the last debugging pass, the `tickets-api` container exited because it could not find `DATABASE_URL`. The logs gave us the clue, but the next useful question comes one step earlier: how did Docker choose the process, directory, user, and environment that produced that error?

That question matters in production because most container incidents start as ordinary startup confusion. The image has one default command. The platform injects environment variables. A teammate adds a wrapper script. The process runs as a Linux user inside the container. Then a deployment rolls out, the app exits, and everyone has to answer which layer made the final decision.

This article follows one service, a small support-ticket API. The app listens on port `3000`, reads `DATABASE_URL`, writes temporary upload files under `/app/tmp`, and should stop cleanly when Docker asks it to stop. We will start from the missing configuration bug, then turn the startup rules into a Dockerfile and Compose setup that a team could actually use.

Here are the pieces we will connect:

| Piece | Plain meaning | What it controls for `tickets-api` |
|---|---|---|
| **CMD** | The image's default job or default arguments | The normal job is `node dist/server.js`, unless the operator chooses another command |
| **ENTRYPOINT** | The executable Docker starts first | A tiny startup script runs before handing control to the app |
| **Runtime command** | A one-container command after the image name | The same image can run `npm test`, `node --version`, or a config check |
| **--entrypoint** | A one-container replacement for the image entrypoint | A debug run can open `sh` without the normal startup script |
| **Environment variables** | Key-value settings given to the process | Provide `PORT`, `NODE_ENV`, and the database connection location |
| **Secrets** | Sensitive values passed through a narrower channel | Mount the database URL as a file instead of baking it into the image |
| **WORKDIR** | The directory where Docker runs later commands | Make `/app` the default directory for build and runtime commands |
| **USER** | The Linux user and group for the process | The API runs as `node`, with write access only where it needs it |
| **Signals** | Stop messages sent to the main process | `docker stop` gives the app time to close HTTP and database work |

The key idea is **startup is a contract**. The image should describe the normal way this program runs. The environment should describe where this specific deployment runs. Debug overrides should change one container without changing the image for everyone else.

![Docker startup contract infographic showing image defaults with CMD, ENTRYPOINT, WORKDIR, USER and runtime inputs with env, ports, and secrets merging into tickets-api running node dist/server.js](/content-assets/articles/article-containers-orchestration-docker-commands-entrypoints-and-environment/startup-contract-map.png)

*This map shows why startup bugs can come from more than one place. The image carries defaults like `CMD`, `ENTRYPOINT`, `WORKDIR`, and `USER`, while the runtime supplies environment, ports, and secrets for this specific container.*

## Reproduce the Missing Configuration
<!-- section-summary: A missing environment variable is a simple way to see how image defaults and runtime inputs meet. -->

Let's build the problem in a small, visible way. Imagine the API has already been compiled into `dist/server.js`, and the image has a default command that starts the server. The first local run forgets the database setting:

```bash
docker run --name tickets-api \
  --publish 8080:3000 \
  devpolaris/tickets-api:local
```

The container exits quickly, so we inspect the state and logs:

```bash
docker ps -a --filter name=tickets-api
docker logs tickets-api
```

The output tells the story:

```console
ConfigError: DATABASE_URL is required
The API cannot start without a database connection.
```

This error points at an environment variable, but the fix involves more than adding `-e DATABASE_URL=...` to the command line. We also need to know which process Docker started, where it ran from, which user ran it, and whether the process would receive a clean stop signal after a successful start.

The failed container can be removed so the next runs have a fresh name:

```bash
docker rm tickets-api
```

Now we can design the startup path from the image outward. The image should know the normal command. The runtime should provide the environment. A debug run should have an escape hatch. A production run should stop gracefully instead of leaving half-finished work.

## CMD Sets the Default Job
<!-- section-summary: CMD gives the image a default command, and a runtime command can replace that default for one container. -->

**CMD** is the default job stored in an image. For an application image, that job usually starts the server. For our API, the simplest useful default says: run Node with the compiled server file.

```dockerfile
CMD ["node", "dist/server.js"]
```

With that line in the image, a plain `docker run` has enough information to choose the process:

```bash
docker run --rm \
  --env DATABASE_URL=postgres://tickets:tickets@host.docker.internal:5432/tickets \
  --env PORT=3000 \
  --publish 8080:3000 \
  devpolaris/tickets-api:local
```

Docker creates a container, reads the image config, and starts `node dist/server.js`. The command came from the image. The database URL and port came from the runtime. That split lets the same image run locally, in staging, and in production while each environment supplies its own settings.

A command after the image name replaces the image `CMD` for that one container. This gives you a clean way to run checks from the same filesystem and dependencies:

```bash
docker run --rm devpolaris/tickets-api:local node --version
docker run --rm devpolaris/tickets-api:local npm test
docker run --rm devpolaris/tickets-api:local node scripts/check-config.js
```

Those commands leave the image unchanged. The next plain run still starts `node dist/server.js`. This is useful in CI because one image can run the app, run tests, and run small maintenance scripts without creating a special image for each job.

There is one detail beginners often miss. Docker keeps only the last `CMD` instruction in the final Dockerfile stage. A base image might already define a command, and your final stage should set the application command you want operators to get by default.

So `CMD` gives us a default job. The next question is whether the image should start the server directly, or run a small executable first to prepare and validate startup.

## ENTRYPOINT Sets the Main Executable
<!-- section-summary: ENTRYPOINT fixes the executable Docker starts first, while CMD commonly supplies default arguments to it. -->

**ENTRYPOINT** is the executable Docker starts first for the container. You can think of it as the front door of the image. If the image has an entrypoint, Docker runs that executable and passes the `CMD` values as arguments.

This pattern works well for app images that need a small startup script. The script can check required environment variables, read secret files, print clear startup errors, and then hand control to the real server process.

```dockerfile
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
```

With that image, Docker starts `/usr/local/bin/docker-entrypoint.sh`. The script receives `node`, `dist/server.js` as arguments. The script can validate the startup environment, then run the arguments it received.

Here is a small entrypoint script for the API:

```sh
#!/bin/sh
set -eu

if [ -n "${DATABASE_URL_FILE:-}" ]; then
  DATABASE_URL="$(cat "$DATABASE_URL_FILE")"
  export DATABASE_URL
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "missing required environment variable: DATABASE_URL" >&2
  exit 1
fi

if [ -z "${PORT:-}" ]; then
  export PORT=3000
fi

exec "$@"
```

The script accepts two ways to provide the database setting. Local development can use `DATABASE_URL` directly. Compose or another runtime can mount a secret file and set `DATABASE_URL_FILE` to that file path. The script then exports the final `DATABASE_URL` before starting the server.

The last line matters a lot:

```sh
exec "$@"
```

`exec` replaces the shell script process with the server process. After that replacement, the Node process receives the container's main process role. Docker can send stop signals to the actual application instead of only talking to a shell wrapper.

This entrypoint gives the app a startup guardrail. A missing database URL fails immediately with a clear error. A valid configuration starts the real command from `CMD`. The next piece is the exact form we use to write `CMD` and `ENTRYPOINT`, because the form changes how Docker starts the process.

## Exec Form and Shell Form Change the Process
<!-- section-summary: Exec form starts the requested executable directly, while shell form starts a shell that interprets a command string. -->

Dockerfile instructions such as `RUN`, `CMD`, and `ENTRYPOINT` can use **exec form** or **shell form**. Exec form uses a JSON array, with each command and argument in its own string. Shell form uses one command string, and Docker runs it through a shell.

Here are the two shapes side by side:

| Form | Example | What Docker starts |
|---|---|---|
| **Exec form** | `CMD ["node", "dist/server.js"]` | `node` with `dist/server.js` as an argument |
| **Shell form** | `CMD node dist/server.js` | `/bin/sh -c "node dist/server.js"` |

For long-running application startup, teams usually choose exec form for `ENTRYPOINT` and `CMD`. It avoids an extra shell process, keeps arguments separate, and gives Docker a clearer process tree. The JSON array requires double quotes because Docker parses it as JSON.

Shell form still has a place during builds. It can make `RUN` commands pleasant when you want shell features such as variable expansion, pipes, and `&&`:

```dockerfile
RUN npm ci && npm cache clean --force
```

For container startup, shell form can surprise you. A shell-form entrypoint starts `/bin/sh -c` as the first process. Runtime arguments and `CMD` combine differently with a shell-form entrypoint, and the application process can sit behind the shell during shutdown.

Variable expansion is another common surprise. Exec form skips automatic shell startup, so this command passes the literal string `$PORT` to Node:

```dockerfile
CMD ["node", "dist/server.js", "--port", "$PORT"]
```

The cleaner app design reads environment variables inside the application code. A command can still run a shell explicitly when shell expansion is truly the thing you want:

```dockerfile
CMD ["sh", "-c", "node dist/server.js --port \"$PORT\""]
```

That explicit shell form gives you expansion, but it also adds the shell process to startup. For most web services, the cleaner design is exec-form `CMD`, with the application reading `PORT` from its environment.

Now we have a direct process shape. The next piece is how to change that process for one run without rebuilding the image.

## Runtime Overrides Help You Debug One Container
<!-- section-summary: Runtime commands replace CMD, and --entrypoint replaces ENTRYPOINT for a single container creation request. -->

Runtime overrides let you ask one image a different question. You might want to check the Node version, run tests, inspect files, or open a shell. These overrides should feel temporary. They affect the container you create, then disappear with that container.

The command after the image name replaces the image `CMD`. With the entrypoint script from the previous section, the script still runs first, then receives your replacement command:

```bash
docker run --rm \
  --env DATABASE_URL=postgres://tickets:tickets@host.docker.internal:5432/tickets \
  devpolaris/tickets-api:local \
  node scripts/check-config.js
```

Docker still starts `/usr/local/bin/docker-entrypoint.sh`. The script validates `DATABASE_URL`, then executes `node scripts/check-config.js` instead of the default server command. This lets CI run a startup check through the same entrypoint guardrail that production uses.

Sometimes the entrypoint itself blocks the thing you need to inspect. In our missing-config case, the script exits before you can look around the filesystem. That is exactly where `--entrypoint` helps. It replaces the image entrypoint for one container:

```bash
docker run --rm -it \
  --entrypoint sh \
  devpolaris/tickets-api:local
```

You can also run one shell command and exit:

```bash
docker run --rm \
  --entrypoint sh \
  devpolaris/tickets-api:local \
  -lc 'pwd; id; ls -la; env | sort | grep -E "NODE_ENV|PORT|DATABASE"'
```

That command bypasses the normal entrypoint and starts `sh` directly. It fits debugging, file inspection, and emergency checks. Normal app startup should keep the image entrypoint in place so every deployment uses the same validation path.

Compose gives the same two override ideas with different names. `command` replaces the image `CMD`, and `entrypoint` replaces the image `ENTRYPOINT`:

```yaml
services:
  api:
    image: devpolaris/tickets-api:local
    command: ["node", "scripts/check-config.js"]
```

This is helpful for a one-off service profile or a local task. Production service definitions should stay boring: entrypoint from the image, command from the image, environment from the runtime. That brings us to the environment settings that started the original failure.

## Environment Variables Carry Runtime Settings
<!-- section-summary: Environment variables pass non-secret runtime settings into the process without rebuilding the image. -->

An **environment variable** is a key-value setting available to a process at runtime. Applications use environment variables for values that differ between environments: port numbers, feature flags, log levels, service URLs, and connection locations.

For the ticket API, the image can set safe defaults such as `NODE_ENV=production`, but the runtime should provide deployment-specific values:

```dockerfile
ENV NODE_ENV=production
```

The `ENV` instruction stores the value in the image metadata and makes it available to later build instructions and runtime containers. It fits safe defaults. Environment-specific addresses, credentials, and deployment names belong outside the image because the same image should move across environments.

At runtime, `docker run` can pass environment variables with `--env` or `-e`:

```bash
docker run --rm \
  --env PORT=3000 \
  --env DATABASE_URL=postgres://tickets:tickets@host.docker.internal:5432/tickets \
  --publish 8080:3000 \
  devpolaris/tickets-api:local
```

For local development, an env file keeps the command readable:

```bash
cat > .env.local <<'EOF'
PORT=3000
LOG_LEVEL=debug
DATABASE_URL=postgres://tickets:tickets@host.docker.internal:5432/tickets
EOF

docker run --rm \
  --env-file .env.local \
  --publish 8080:3000 \
  devpolaris/tickets-api:local
```

The env file format is simple: one `KEY=value` per line, with `#` comments on their own lines. Docker passes those values into the container environment. Your app can read them through its normal language runtime, such as `process.env.DATABASE_URL` in Node.

Compose uses the `environment` field for values you want visible in the Compose file:

```yaml
services:
  api:
    image: devpolaris/tickets-api:local
    ports:
      - "8080:3000"
    environment:
      NODE_ENV: production
      PORT: "3000"
      LOG_LEVEL: info
```

Compose also supports `env_file` for larger sets of non-secret variables:

```yaml
services:
  api:
    image: devpolaris/tickets-api:local
    env_file:
      - ./api.env
    ports:
      - "8080:3000"
```

The practical rule is simple: **environment variables are plain runtime configuration**. They work well for non-sensitive settings. Passwords, API keys, and private tokens need a stricter boundary because environment variables can show up in process environments, debug output, crash reports, shell history, and container inspection workflows.

## Secrets Need a Different Boundary
<!-- section-summary: Secrets should enter the container through runtime secret mechanisms or mounted files instead of Dockerfile ENV or ARG. -->

A **secret** is sensitive data such as a password, private key, database URL with a password inside it, or API token. Real teams treat secrets differently from normal configuration because a copied secret keeps working until someone rotates or revokes it.

Secrets belong outside Dockerfile `ENV` and `ARG`. Values placed there can persist in the image metadata, image history, build cache, or final runtime environment. A production image should be shareable inside your organization without carrying a live password.

For local Compose work, Docker Compose secrets give a clearer pattern. The secret value lives in a file on the host, Compose grants it to one service, and the container sees it as a file under `/run/secrets`:

```yaml
services:
  api:
    build: .
    ports:
      - "8080:3000"
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATABASE_URL_FILE: /run/secrets/tickets_database_url
    secrets:
      - tickets_database_url

secrets:
  tickets_database_url:
    file: ./secrets/tickets_database_url.txt
```

The entrypoint script from earlier reads `DATABASE_URL_FILE`, exports `DATABASE_URL`, and starts the app. This keeps the secret out of the Dockerfile and avoids writing the password directly into the Compose service environment.

Many official images use the `_FILE` convention for the same reason. Instead of setting `POSTGRES_PASSWORD` directly, an image may support `POSTGRES_PASSWORD_FILE=/run/secrets/db_password`. The application or entrypoint reads the secret file, then uses the value internally.

In larger production systems, the same idea usually comes from the platform. Kubernetes mounts Secrets as files or environment variables. ECS can inject secrets from AWS Secrets Manager or Systems Manager Parameter Store. Swarm has Docker secrets. The product names differ, but the boundary stays the same: **the image carries code and safe defaults, while the runtime supplies sensitive values through a controlled secret path**.

Now the API has the settings it needs. The next common failure is more physical: the process starts in the wrong directory or runs as a user that cannot read or write the paths it needs.

## WORKDIR and USER Shape the Process Context
<!-- section-summary: WORKDIR controls where commands run, and USER controls which Linux account runs build and runtime commands. -->

**WORKDIR** sets the current directory for later `RUN`, `CMD`, `ENTRYPOINT`, `COPY`, and `ADD` instructions. At runtime, it also gives the main process its starting directory. For an app image, an explicit `WORKDIR` keeps base-image defaults from deciding where your commands run.

```dockerfile
WORKDIR /app
```

With that line, `CMD ["node", "dist/server.js"]` runs from `/app`. Relative paths inside the app, such as `./dist/server.js` or `./tmp/uploads`, resolve from the same directory every time. A debug shell can confirm the starting directory:

```bash
docker run --rm \
  --entrypoint sh \
  devpolaris/tickets-api:local \
  -lc 'pwd'
```

**USER** sets the Linux user and group for later build instructions and for the runtime `ENTRYPOINT` and `CMD`. Containers often start as `root` by default because many base images use root during build steps. Production app processes should run as a non-root user whenever the image and runtime allow it.

The Node official images include a `node` user, so our API can use that account:

```dockerfile
USER node
```

That single line changes the runtime security posture. If the API has a remote-code bug or a dependency vulnerability, the process has the permissions of the `node` user inside the container instead of root. Container isolation still matters, and host security still matters, but the process starts with fewer privileges inside its own filesystem.

Permissions need planning. The API writes temporary upload files under `/app/tmp`, so the Dockerfile should create that directory and give ownership to the runtime user before switching to `USER node`:

```dockerfile
RUN mkdir -p /app/tmp && chown -R node:node /app/tmp
USER node
```

For copied application files, `COPY --chown` keeps ownership clear:

```dockerfile
COPY --chown=node:node package*.json ./
COPY --chown=node:node dist ./dist
```

You can verify the process context with one debug run:

```bash
docker run --rm \
  --entrypoint sh \
  devpolaris/tickets-api:local \
  -lc 'pwd; id; ls -ld /app /app/tmp'
```

A permissions bug often appears as `EACCES` in the logs. The durable fix usually adjusts image ownership or write paths instead of keeping the app on root forever. The container should grant the app the paths it needs and leave the rest of the filesystem alone.

The process now starts with the right command, settings, directory, and user. The final startup concern is shutdown. A container that starts correctly still needs to stop correctly.

## Signals Decide How the Container Stops
<!-- section-summary: Docker stops a container by sending a signal to the main process, so PID 1 and exec usage matter. -->

A **signal** is a Linux message sent to a process. Docker uses signals to ask containers to stop. By default, `docker stop` sends `SIGTERM` to the main process, waits for a grace period, and then sends `SIGKILL` if the process still runs.

For a web API, `SIGTERM` should trigger graceful shutdown. The app can stop accepting new HTTP requests, finish in-flight work, close database connections, flush logs, and exit. `SIGKILL` gives the process no cleanup time, so graceful shutdown depends on the app receiving and handling the first signal.

The main process inside the container has process ID 1. Docker sends stop signals to that process. This is why exec-form startup and `exec "$@"` inside entrypoint scripts matter so much.

Here is the clean path again:

```dockerfile
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
```

```sh
exec "$@"
```

The script validates configuration, then replaces itself with Node. Node holds PID 1, and `docker stop` sends `SIGTERM` to Node. Your application can register a shutdown handler:

```js
const server = app.listen(process.env.PORT || 3000);

process.on("SIGTERM", () => {
  server.close(() => {
    db.close().then(() => process.exit(0));
  });
});
```

During a local check, the API should get enough time to close cleanly:

```bash
docker run --name tickets-api \
  --env-file .env.local \
  --publish 8080:3000 \
  devpolaris/tickets-api:local

docker stop --time 20 tickets-api
docker logs tickets-api
docker rm tickets-api
```

The `--time` value controls how long Docker waits after the first stop signal. Dockerfiles can also set `STOPSIGNAL` when an application expects a different signal, and `docker run` can override the stop signal for a container.

Some workloads create child processes. Docker's `--init` flag adds a tiny init process as PID 1 to handle normal init duties such as reaping child processes. For a simple Node API that runs one server process, exec-form startup and a shutdown handler usually cover the first production need. For process-heavy containers, `--init` can help keep process cleanup healthy.

![Docker ENTRYPOINT CMD and signal flow infographic showing ENTRYPOINT receiving CMD, exec handoff to node dist/server.js as PID 1, and docker stop sending SIGTERM for graceful shutdown](/content-assets/articles/article-containers-orchestration-docker-commands-entrypoints-and-environment/entrypoint-cmd-signal-flow.png)

*The important handoff is `exec "$@"`. The entrypoint can validate configuration first, but the app process should become PID 1 so `docker stop` reaches the server that needs to close HTTP, database, and log work.*

Now we can put the pieces together into a startup design that handles the original missing-config bug and gives the team predictable behavior.

## A Practical Startup Design
<!-- section-summary: A production-friendly container keeps app defaults in the image, runtime settings outside the image, and secrets behind file boundaries. -->

Here is a complete Dockerfile for the support-ticket API. It builds dependencies in one stage, copies only runtime output into the final stage, sets a clear working directory, prepares the writable temp path, switches to the `node` user, and uses an entrypoint script plus exec-form `CMD`.

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node dist ./dist
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /app/tmp \
  && chown -R node:node /app/tmp

USER node
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
```

The matching entrypoint script stays small. It reads the secret-file form first, validates the final environment, sets a safe default port, and uses `exec` for the final handoff.

```sh
#!/bin/sh
set -eu

if [ -n "${DATABASE_URL_FILE:-}" ]; then
  DATABASE_URL="$(cat "$DATABASE_URL_FILE")"
  export DATABASE_URL
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "missing required environment variable: DATABASE_URL" >&2
  exit 1
fi

export PORT="${PORT:-3000}"

exec "$@"
```

The local build command is:

```bash
docker build -t devpolaris/tickets-api:local .
```

A local env file can supply the runtime settings:

```bash
docker run --rm \
  --env-file .env.local \
  --publish 8080:3000 \
  devpolaris/tickets-api:local
```

The same image can run through Compose with a database and a secret file:

```yaml
services:
  api:
    build: .
    ports:
      - "8080:3000"
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATABASE_URL_FILE: /run/secrets/tickets_database_url
    secrets:
      - tickets_database_url
    depends_on:
      - tickets-db

  tickets-db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: tickets
      POSTGRES_USER: tickets
      POSTGRES_PASSWORD_FILE: /run/secrets/tickets_db_password
    secrets:
      - tickets_db_password
    volumes:
      - tickets-db:/var/lib/postgresql/data

secrets:
  tickets_database_url:
    file: ./secrets/tickets_database_url.txt
  tickets_db_password:
    file: ./secrets/tickets_db_password.txt

volumes:
  tickets-db:
```

This Compose file keeps the image generic. The API image carries the app, default command, working directory, user, and startup script. Compose supplies the local database, published port, non-secret environment variables, and secret file paths.

The `tickets_database_url` secret file should use the Compose service name as the database host, for example `postgres://tickets:<password>@tickets-db:5432/tickets`. That keeps the hostname consistent with the raw `docker run` examples from the earlier articles.

The stack starts with the normal Compose command:

```bash
docker compose up --build
```

A one-off config check can run through the same image:

```bash
docker compose run --rm api node scripts/check-config.js
```

An emergency shell can bypass the entrypoint for inspection:

```bash
docker compose run --rm \
  --entrypoint sh \
  api \
  -lc 'pwd; id; ls -la /app; ls -la /run/secrets'
```

This design gives the team a normal path and a debug path. The normal path validates startup and runs the server. The debug path intentionally bypasses the entrypoint so you can inspect the image when startup validation fails.

## Startup Checks Before You Ship
<!-- section-summary: A few small checks catch command, environment, user, workdir, and shutdown mistakes before rollout. -->

Before handing an image to staging or production, a direct image configuration check catches accidental changes to entrypoint, command, working directory, and user:

```bash
docker image inspect devpolaris/tickets-api:local \
  --format 'Entrypoint={{json .Config.Entrypoint}} Cmd={{json .Config.Cmd}} Workdir={{json .Config.WorkingDir}} User={{json .Config.User}}'
```

Expected output should look close to this:

```console
Entrypoint=["/usr/local/bin/docker-entrypoint.sh"] Cmd=["node","dist/server.js"] Workdir="/app" User="node"
```

The failure path deserves a deliberate check. A missing required variable should fail quickly and clearly:

```bash
docker run --rm devpolaris/tickets-api:local
```

Expected output should name the missing setting:

```console
missing required environment variable: DATABASE_URL
```

The success path should use the same settings your local team uses:

```bash
docker run --name tickets-api \
  --env-file .env.local \
  --publish 8080:3000 \
  devpolaris/tickets-api:local
```

Another terminal can confirm the process context and then stop the container cleanly:

```bash
docker exec tickets-api sh -lc 'pwd; id; echo "$NODE_ENV"; echo "$PORT"'
docker stop --time 20 tickets-api
docker logs tickets-api
docker rm tickets-api
```

For Compose, the rendered configuration shows the final service definition before the stack starts:

```bash
docker compose config
docker compose up --build
```

`docker compose config` shows the service definition after interpolation and file merging. It is a useful review step because it reveals the final `command`, `entrypoint`, `environment`, `secrets`, ports, and volumes Compose will send to Docker.

These checks are small, but they prevent a large class of container incidents. A team can see the exact command, verify configuration injection, confirm the non-root user, inspect the working directory, and test graceful shutdown before the image reaches a real deployment.

![Docker startup checklist infographic showing CMD, ENTRYPOINT, WORKDIR, USER node, environment values, secrets, and inspect checks around the tickets-api image](/content-assets/articles/article-containers-orchestration-docker-commands-entrypoints-and-environment/startup-checklist-summary.png)

*A production-friendly image is boring in a good way: the command is visible, the entrypoint is small, the app runs from `/app` as `node`, sensitive values come through secrets, and a short inspect check confirms what the image will actually do.*

## What's Next

The API now has a clear startup contract. Docker knows which process to start, the runtime supplies configuration, secrets stay out of the image, the process runs from `/app` as `node`, and `docker stop` reaches the application cleanly.

The next article adds the next layer of reliability: health checks and restart policies. Startup can succeed while the service still needs warm-up time, a database dependency, or a recovery plan after a crash. Health and restart rules make those states visible instead of hiding them behind a simple `Up` status.

---

**References**

- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) - Official reference for `CMD`, `ENTRYPOINT`, exec form, shell form, `ENV`, `WORKDIR`, `USER`, and `STOPSIGNAL`.
- [docker container run](https://docs.docker.com/reference/cli/docker/container/run/) - Official CLI reference for runtime commands, `--env`, `--env-file`, `--entrypoint`, `--init`, and related container options.
- [docker container stop](https://docs.docker.com/reference/cli/docker/container/stop/) - Documents Docker stop behavior, including `SIGTERM`, grace periods, `SIGKILL`, `--signal`, and `--timeout`.
- [Set environment variables within your container's environment](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/) - Official Compose guidance for `environment`, `env_file`, and runtime `--env` usage.
- [Manage secrets securely in Docker Compose](https://docs.docker.com/compose/how-tos/use-secrets/) - Explains Compose secrets, `/run/secrets/<secret_name>`, per-service secret grants, and the `_FILE` convention used by some images.
- [SecretsUsedInArgOrEnv build check](https://docs.docker.com/reference/build-checks/secrets-used-in-arg-or-env/) - Docker's build-check guidance explaining how Dockerfile `ARG` or `ENV` can expose secrets.
- [Postgres Docker Official Image](https://hub.docker.com/_/postgres) - Documents the Postgres image environment variables, including the file-based secret forms used in the Compose example.
