---
title: "Commands and Env"
description: "Understand how Docker combines image defaults, ENTRYPOINT, CMD, runtime arguments, working directories, users, and environment variables."
overview: "A container starts one command, and that command can come from several places. This article follows image defaults and runtime overrides so startup behavior becomes predictable."
tags: ["docker", "cmd", "entrypoint", "environment"]
order: 3
id: article-containers-orchestration-docker-commands-entrypoints-and-environment
---

## Table of Contents

1. [The Startup Contract](#the-startup-contract)
2. [CMD Gives the Default Command](#cmd-gives-the-default-command)
3. [ENTRYPOINT Gives the Main Executable](#entrypoint-gives-the-main-executable)
4. [Exec Form and Shell Form Change Signal Behavior](#exec-form-and-shell-form-change-signal-behavior)
5. [Runtime Arguments Change One Container](#runtime-arguments-change-one-container)
6. [Environment Variables Carry Runtime Settings](#environment-variables-carry-runtime-settings)
7. [Working Directory and User Shape the Process](#working-directory-and-user-shape-the-process)
8. [A Practical Startup Design](#a-practical-startup-design)
9. [Where Startup Usually Breaks](#where-startup-usually-breaks)
10. [What's Next](#whats-next)

## The Startup Contract
<!-- section-summary: Docker starts one main process by combining image defaults with runtime overrides. -->

In the previous article about state, logs, and exec, we watched the `tickets-api` container exit because `DATABASE_URL` was missing. Now we need to move one step earlier and ask how Docker chose the process and settings that produced those logs. This is where **CMD**, **ENTRYPOINT**, **runtime arguments**, **environment variables**, **WORKDIR**, and **USER** all meet.

A container has one main process. Docker builds that process from two places: defaults stored in the image and values passed when the container starts. The image should describe the normal way to start the application, while the container run supplies local or environment-specific settings.

For our ticketing service, the image might say, "Run the Node API from `/app` as the `node` user." The runtime might say, "Use the development database URL, publish the API on host port `8080`, and call this container `tickets-api`." Those choices belong together, and they come from different layers.

The startup contract has a few pieces that show up in image metadata, run commands, and Compose files. Each row names one part of that contract and ties it to the ticketing API:

| Piece | Simple meaning | Ticketing API example |
|---|---|---|
| **CMD** | Default command or default arguments | `["node", "dist/server.js"]` |
| **ENTRYPOINT** | Main executable Docker should start | `["./docker-entrypoint.sh"]` |
| **Runtime command** | One-run command after the image name | `npm test` |
| **Environment** | Key-value settings for the process | `DATABASE_URL=...` |
| **WORKDIR** | Directory where commands run | `/app` |
| **USER** | Linux user for the process | `node` |

We will walk through those pieces in the order Docker makes them matter. That way, a surprising `docker ps` command column or startup log becomes easier to explain from the image and the run command.

## CMD Gives the Default Command
<!-- section-summary: CMD supplies the image's default command or default arguments for a container run. -->

**CMD** is the image's default command or default argument list. For an application image, it often names the server process. If the ticketing API image should start the Node server by default, the Dockerfile can end like this:

```dockerfile
CMD ["node", "dist/server.js"]
```

Then a plain run uses that default. Docker gets the command from the image because the run command leaves the image command in place:

```bash
docker run --name tickets-api devpolaris/tickets-api:local
```

Docker starts `node dist/server.js` because the image provided that command. The container still needs runtime settings such as `DATABASE_URL`, and the image knows the normal application entry command. That split keeps the image reusable across local development, CI, staging, and production.

A command after the image name changes the command for that one container. This is useful for checks, tests, and small maintenance tasks:

```bash
docker run --rm devpolaris/tickets-api:local node --version
docker run --rm devpolaris/tickets-api:local npm test
```

Those runs use the same image filesystem and packages. The first prints the Node version, and the second runs tests. Another plain run later will still use the image's original `CMD`, because the override belonged only to that container creation request.

Docker uses the last effective `CMD` in a Dockerfile stage. A base image may already have a `CMD`, and a later `CMD` in your final stage replaces it. That matters in multi-stage builds because the final stage should declare the command you want people to get by default.

## ENTRYPOINT Gives the Main Executable
<!-- section-summary: ENTRYPOINT sets the executable Docker runs, while CMD often supplies its default arguments. -->

**ENTRYPOINT** sets the executable Docker treats as the image's main program. `CMD` can then provide default arguments to that executable. This pair works well for images that behave like a tool or for apps that need a tiny startup script before the server starts.

For a tool image, the design can be simple. The executable lives in `ENTRYPOINT`, and the default argument lives in `CMD`:

```dockerfile
ENTRYPOINT ["node"]
CMD ["dist/server.js"]
```

With that image, a plain run starts `node dist/server.js`. A runtime argument after the image name becomes an argument to `node`, which changes the one container command:

```bash
docker run --rm devpolaris/tickets-api:local --version
```

That command runs `node --version`. The runtime argument replaced the `CMD` part, while the `ENTRYPOINT` stayed as `node`. This is helpful for tool-style images and sometimes surprising for application images.

Many web application images use an entrypoint script for setup. The script might validate environment variables, wait for a local dependency during development, run a small migration check, and then start the real server. The last step should hand control to the server process so Docker can deliver stop signals cleanly.

```dockerfile
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
```

The script receives the `CMD` as its arguments. A common final line in the script hands control to the real server:

```bash
exec "$@"
```

That line replaces the shell script with the real server process. Docker then sees the server as the main process, and `docker stop` can signal it directly. Without that handoff, the shell can become the process Docker watches while the server runs as a child, which makes shutdown behavior less predictable.

## Exec Form and Shell Form Change Signal Behavior
<!-- section-summary: Exec form starts the process directly, while shell form runs through a shell and changes argument and signal handling. -->

Dockerfile commands have two common shapes. **Exec form** uses a JSON array, such as `["node", "dist/server.js"]`. **Shell form** uses a plain string, such as `node dist/server.js`. Both can start a process, and they behave differently around shell expansion, arguments, and signals.

Exec form starts the executable directly. Docker receives a list where each item is one argument:

```dockerfile
CMD ["node", "dist/server.js"]
```

This form keeps Docker connected to the executable instead of a hidden shell. It also keeps each argument separate, so Docker can pass the argument list straight to the process. Most application images use exec form for `CMD` and `ENTRYPOINT` because the final process receives signals more directly.

Shell form runs through `/bin/sh -c`. The shell receives the command string and handles shell features:

```dockerfile
CMD node dist/server.js
```

Shell form gives you shell features such as variable substitution and command chaining. Those features can be useful in small cases, and they add another process and another parsing layer. Docker's Dockerfile reference calls out this difference for `ENTRYPOINT` and shows `exec` in shell-form entrypoints so long-running executables receive stop signals correctly.

For the ticketing API, exec form keeps the container startup plain. The Dockerfile can describe the working directory, user, and final server command directly:

```dockerfile
WORKDIR /app
USER node
CMD ["node", "dist/server.js"]
```

If the app needs setup logic, a small entrypoint script can handle that setup and then run `exec "$@"`. The script should stay small because every future operator will depend on it during startup, shutdown, logs, and debugging.

## Runtime Arguments Change One Container
<!-- section-summary: Runtime command arguments after the image name override CMD for that container creation request. -->

Runtime arguments are the command and arguments you put after the image name in `docker run`. They change what Docker starts for that one container. This is useful when the image contains everything needed for several related tasks.

Here are three runs from the same ticketing API image. The image stays reusable while each container creation request chooses its own process:

```bash
docker run --rm devpolaris/tickets-api:local
docker run --rm devpolaris/tickets-api:local npm test
docker run --rm devpolaris/tickets-api:local node scripts/seed-dev-data.js
```

The first run starts the default API command. The second run starts the test command. The third run starts a seed script. These runs share the image and diverge only at container creation time.

The exact behavior depends on whether the image has `ENTRYPOINT`. With only `CMD`, the runtime command replaces the default command. With `ENTRYPOINT` plus `CMD`, the runtime command usually replaces the `CMD` arguments and keeps the entrypoint executable. That is why a tool image can expose one executable while still accepting different command-line arguments.

You can override the entrypoint too. This helps when the normal entrypoint blocks the troubleshooting path:

```bash
docker run --rm --entrypoint sh devpolaris/tickets-api:local
```

This kind of override helps when an entrypoint script fails before you can inspect the image. It also helps when you want a troubleshooting shell. It belongs in debugging and special workflows, while the normal application run should stay boring and repeatable.

## Environment Variables Carry Runtime Settings
<!-- section-summary: Environment variables pass configuration into the process at container creation time while the image stays reusable. -->

**Environment variables** are key-value strings available to the process inside the container. They fit settings that change between environments: database URL, log level, feature flag, service URL, port, region, or public mode switch. The same image can move from a laptop to CI to staging because those values arrive at runtime.

The ticketing API can receive its local database URL like this. The image stays the same, and the container receives the local value at creation time:

```bash
docker run -d \
  --name tickets-api \
  -e NODE_ENV=development \
  -e DATABASE_URL=postgres://tickets:tickets@host.docker.internal:5432/tickets \
  -p 8080:3000 \
  devpolaris/tickets-api:local
```

An env file can keep local runs shorter. The file holds the local key-value settings while the command stays readable:

```bash
docker run -d \
  --name tickets-api \
  --env-file .env.local \
  -p 8080:3000 \
  devpolaris/tickets-api:local
```

The image can also declare default environment variables with Dockerfile `ENV`. Those defaults become part of the image configuration and appear in inspection output. Runtime `-e` values can provide the environment-specific values for a container.

```dockerfile
ENV NODE_ENV=production
```

Secrets need more care. Environment variables can show up in inspect output, local shell history, process listings, CI logs, and crash reports. Production passwords and tokens usually belong in a secret manager or orchestrator secret feature, while local throwaway values can still use env files with careful `.gitignore` rules.

## Working Directory and User Shape the Process
<!-- section-summary: WORKDIR chooses where commands run, and USER chooses the Linux identity that runs them. -->

**WORKDIR** sets the default directory for `RUN`, `CMD`, `ENTRYPOINT`, `COPY`, and `ADD` instructions that follow it in the Dockerfile. It also shapes the runtime directory for the container's default command. For the ticketing API, `/app` is a natural working directory because the compiled server and package files live there.

```dockerfile
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist
CMD ["node", "dist/server.js"]
```

With that setup, `node dist/server.js` resolves from `/app`. If the working directory points somewhere else, the same command might fail because `dist/server.js` sits in a different place. `docker inspect` can show the configured working directory under `Config.WorkingDir`.

**USER** sets the Linux user and group for later build instructions and for runtime commands. Running as a non-root user limits what the app can write or change inside the container filesystem. A Node image might create or use a `node` user and switch to it before the final command.

```dockerfile
USER node
CMD ["node", "dist/server.js"]
```

This choice can reveal file-permission bugs during local testing. If the app needs to write to `/app/uploads`, that directory must allow the runtime user to write there. Changing the runtime user to root hides the permission issue during development and brings it back later in production.

## A Practical Startup Design
<!-- section-summary: A good application image keeps the normal command in the image and passes environment-specific settings at runtime. -->

For the ticketing API, a practical Dockerfile startup section might look like this. The image carries the stable application startup path:

```dockerfile
FROM node:24-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist

ENV NODE_ENV=production
USER node
CMD ["node", "dist/server.js"]
```

This image says, "The normal way to start the app is the Node server from `/app` as the `node` user." It keeps the command stable and leaves the environment-specific values outside the image. Local development, CI, and production can all use the same image tag with different runtime settings.

A local run can add those settings. The values describe the local environment rather than the image build:

```bash
docker run -d \
  --name tickets-api \
  -e DATABASE_URL=postgres://tickets:tickets@host.docker.internal:5432/tickets \
  -e LOG_LEVEL=debug \
  -p 8080:3000 \
  devpolaris/tickets-api:local
```

A one-off test run can reuse the same image. The runtime command changes the process for this container only:

```bash
docker run --rm \
  -e DATABASE_URL=postgres://tickets:tickets@host.docker.internal:5432/tickets \
  devpolaris/tickets-api:local npm test
```

That is the practical balance. The image carries the code and normal startup shape. The runtime carries the environment values and special one-run commands. Debugging then lines up with the evidence from the previous article because Docker can show exactly what command, working directory, user, and environment it used.

## Where Startup Usually Breaks
<!-- section-summary: Startup problems usually come from command replacement, entrypoint argument surprises, missing environment, working-directory mistakes, or runtime user permissions. -->

The first common problem is **accidental command replacement**. A developer adds `npm test` after the image name to run tests, then expects the API to stay up. Docker started the requested test command, and the container exited after the tests completed.

The second problem is **entrypoint argument surprise**. With an `ENTRYPOINT`, runtime arguments often replace `CMD` while keeping the entrypoint. A command that looks like it should replace everything may become arguments to the existing executable. `docker inspect` and the `COMMAND` column in `docker ps -a` can show what Docker actually started.

The third problem is **missing runtime environment**. A server image can be perfectly built and still fail because `DATABASE_URL` or another required setting arrived empty. Logs identify the missing value, and inspect confirms whether Docker passed it into the container.

The fourth problem is **working-directory drift**. A command such as `node dist/server.js` depends on the current directory. If `WORKDIR` changes during a refactor or a later stage skips it, the same command can fail with a file path error.

The fifth problem is **runtime user permissions**. A non-root user improves the container's safety profile, and it also requires writable paths to have the right ownership or permissions. A startup log that mentions `EACCES` or permission denied usually points at the filesystem path and the configured `USER` together.

## What's Next

You now know how Docker chooses the process before state and logs appear. `CMD` gives a default, `ENTRYPOINT` gives a main executable, runtime arguments change one container, environment variables carry settings, and `WORKDIR` plus `USER` shape where and how the process runs.

The final article in this container group adds two more runtime signals. Health checks tell us whether a running process can actually serve callers, and restart policies tell Docker what to do after the main process exits.

---

**References**

- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/) - Documents `CMD`, `ENTRYPOINT`, `ENV`, `WORKDIR`, `USER`, shell form, exec form, and signal-related entrypoint guidance.
- [Docker run CLI reference](https://docs.docker.com/reference/cli/docker/container/run/) - Documents command overrides, `--entrypoint`, `--env`, `--env-file`, working-directory, and user flags.
- [Running containers](https://docs.docker.com/engine/containers/run/) - Shows the `docker run [OPTIONS] IMAGE [COMMAND] [ARG...]` form and describes foreground, detached, command, and argument behavior.
- [Docker exec CLI reference](https://docs.docker.com/reference/cli/docker/container/exec/) - Documents runtime exec behavior, environment options, and working-directory options for commands run in a live container.
- [Docker inspect CLI reference](https://docs.docker.com/reference/cli/docker/inspect/) - Documents low-level metadata output used to verify command, environment, working directory, user, and host configuration.
