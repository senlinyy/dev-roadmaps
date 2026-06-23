---
title: "Docker Workflow"
description: "Practice the daily Docker loop: build images, run containers, inspect logs, replace stale containers, keep local data safe, and clean unused objects."
overview: "This article follows the same inventory API through edit, build, run, inspect, replace, debug, storage, registry, and cleanup steps so each Docker command has a clear job."
tags: ["docker", "workflow", "containers"]
order: 2
id: article-containers-orchestration-docker-docker-workflow
---

## Table of Contents

1. [The Daily Docker Loop](#the-daily-docker-loop)
2. [Start With the Project Files](#start-with-the-project-files)
3. [Build the Image](#build-the-image)
4. [Keep the Build Context Clean](#keep-the-build-context-clean)
5. [Tag Images So Humans Can Talk About Them](#tag-images-so-humans-can-talk-about-them)
6. [Run the API Container](#run-the-api-container)
7. [Check Running and Stopped Containers](#check-running-and-stopped-containers)
8. [Use Logs, Exit Codes, and Inspect](#use-logs-exit-codes-and-inspect)
9. [Rebuild, Stop, Remove, and Rerun](#rebuild-stop-remove-and-rerun)
10. [Use `--rm` for One-Off Work](#use-rm-for-one-off-work)
11. [Use Bind Mounts for Development](#use-bind-mounts-for-development)
12. [Debug With `docker exec`](#debug-with-docker-exec)
13. [Use Volumes for Data](#use-volumes-for-data)
14. [Push and Pull Through a Registry](#push-and-pull-through-a-registry)
15. [Clean Up Carefully](#clean-up-carefully)
16. [Putting It All Together](#putting-it-all-together)

## The Daily Docker Loop
<!-- section-summary: The daily Docker workflow moves from source files to an image, then to a container, then to evidence, replacement, sharing, and cleanup. -->

Imagine we are still working on the same small service from the Docker Foundations module: an `inventory-api` that stores product counts for a warehouse team. The service has one job. It answers requests like "how many blue jackets are left?" and "which shelf holds item `SKU-1042`?" It is small enough to understand, but it has all the moving parts that show up in real Docker work: source code, dependencies, configuration, a port, logs, and some local data.

The daily Docker workflow is the loop a developer repeats around that service. We edit source files, build an image, run a container from that image, check what Docker is actually doing, replace the old container when the code changes, debug the running process when it acts strangely, keep important data outside the throwaway container layer, share the image through a registry, and clean up old local state with care.

Here is the loop we will follow:

![Daily Docker loop infographic showing inventory-api moving through edit, build, run, observe, replace, cleanup, with registry and volume side paths](/content-assets/articles/article-containers-orchestration-docker-docker-workflow/docker-daily-loop.png)

*The daily loop repeats after each source change: build a new image, run a container, observe evidence, replace stale runtime state, and clean up deliberately.*

The first few Docker commands give us a lot of verbs: `build`, `run`, `ps`, `logs`, `inspect`, `stop`, `rm`, `exec`, `push`, `pull`, `prune`. In daily work, each verb answers a plain question. **Build** asks, "what artifact did my source files produce?" **Run** asks, "can that artifact start as a process?" **Logs** ask, "what did the process say?" **Inspect** asks, "what settings did Docker apply?" **Stop** and **rm** ask, "am I ready to replace this runtime copy?"

This article walks through those questions in order. By the end, those commands should line up as one connected routine for the `inventory-api`.

## Start With the Project Files
<!-- section-summary: Docker starts from an application directory, a Dockerfile, and the files allowed into the build context. -->

Before we build anything, we need a project directory. A Docker workflow usually starts from a normal application folder that already has source code and a Dockerfile. A **Dockerfile** is the recipe for creating an image. It tells Docker which base image to use, which files to copy, which dependencies to install, and which command starts the app.

Our `inventory-api` project might look like this:

```bash
inventory-api/
  Dockerfile
  package.json
  package-lock.json
  src/
    server.js
    inventory-store.js
  data/
    seed.json
  .dockerignore
```

The Dockerfile can stay small for the beginning version of the service:

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY data ./data

ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
```

This file says: start from Node, use `/app` as the working directory, install production dependencies, copy the application files, document that the process listens on port `3000`, and start the server with Node. The service still needs runtime values later, such as the active environment or a data directory, but this is enough to build the first local image.

One detail matters before we run the first command. Docker builds from a **build context**. The build context is the set of files the builder can see for this build. When we run `docker build .`, the final `.` means "use this current directory as the context." Docker can copy files from that context into the image. Files outside that context stay outside the build.

That idea connects the project folder to the first real workflow step. Once the files and Dockerfile are in place, we can ask Docker to produce an image artifact.

## Build the Image
<!-- section-summary: `docker build` turns the Dockerfile and build context into a local image that can create containers. -->

A **Docker image** is the packaged filesystem and startup metadata for the app. It includes the operating-system layer from the base image, the Node runtime, installed dependencies, copied source files, and the default command. A container starts from an image, so the image is the reusable artifact in this workflow.

From the `inventory-api` directory, build the image like this:

```bash
docker build -t inventory-api:local .
```

The command has three important pieces. `docker build` starts the build. `-t inventory-api:local` adds a tag so the result has a name we can use later. The final `.` provides the current directory as the build context.

The output usually shows each Dockerfile step:

```bash
[+] Building 8.4s
 => [internal] load build definition from Dockerfile
 => [internal] load .dockerignore
 => [internal] load build context
 => [1/6] FROM docker.io/library/node:22-alpine
 => [2/6] WORKDIR /app
 => [3/6] COPY package*.json ./
 => [4/6] RUN npm ci --omit=dev
 => [5/6] COPY src ./src
 => [6/6] COPY data ./data
 => exporting to image
 => naming to docker.io/library/inventory-api:local
```

This output gives useful evidence. Docker loaded the Dockerfile, loaded the ignore file, loaded the context, executed the Dockerfile instructions, and named the image `inventory-api:local`. If the build fails, the failed step usually tells us where to look. A failure during `npm ci` points at dependencies. A failure during `COPY src ./src` points at the context or file path.

After the build finishes, prove the image exists locally:

```bash
docker image ls inventory-api
```

A normal local result looks like this:

```bash
REPOSITORY      TAG       IMAGE ID       CREATED          SIZE
inventory-api   local     7a1d9f7e2c30   20 seconds ago   156MB
```

That row confirms, "this machine has an image named `inventory-api` with the `local` tag." The container we run next will come from that local image unless the command points somewhere else.

Build speed depends heavily on the context and cache, so the next step is cleaning up what Docker sends into the build.

## Keep the Build Context Clean
<!-- section-summary: `.dockerignore` keeps noisy, large, or sensitive files out of the build context and helps Docker build faster. -->

The build context is powerful because it gives Docker the files it needs. It can also cause trouble because it may include files the image should never receive. A local `node_modules` folder can contain thousands of files. A `.env` file can contain passwords. A `.git` directory can be large and noisy. Test output, coverage reports, and temporary files can slow the build and make cache behavior harder to read.

A **`.dockerignore` file** tells Docker which files and directories to exclude from the build context. It works like a project boundary for the builder. The Dockerfile still controls what gets copied into the image, but `.dockerignore` reduces what the builder can see in the first place.

For `inventory-api`, start with something like this:

```gitignore
node_modules
.git
.env
.env.*
coverage
dist
npm-debug.log
Dockerfile.notes
```

The `.env` lines deserve special attention. Local environment files often contain database URLs, API tokens, or credentials used only on a developer machine. Those values belong in runtime configuration, a secret manager, or a deployment platform. They should stay out of the image build context so a careless `COPY . .` cannot place them inside an image layer.

The build cache is the other reason this section matters. Docker builds an image in layers. If an instruction and its relevant inputs match a previous build, Docker can reuse the cached result. That is why the Dockerfile copied `package*.json` before `src`. Changing `src/server.js` should not force `npm ci` to run again when the package files stayed the same.

Here is the practical version:

```dockerfile
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY data ./data
```

The dependency layer changes when `package.json` or `package-lock.json` changes. The source layer changes when files under `src` or `data` change. This layout gives fast rebuilds during normal API edits while still producing a clean image from the Dockerfile.

Now the image builds quickly and only sees the intended files. The next workflow question is naming the artifact in a way humans and automation can both understand.

## Tag Images So Humans Can Talk About Them
<!-- section-summary: Tags give image versions readable names, but the local image list and image IDs provide evidence of what actually exists. -->

A **tag** is a readable label attached to an image name. In `inventory-api:local`, `inventory-api` is the repository name and `local` is the tag. Tags help humans talk about image versions without passing long image IDs around.

Local development often uses a short tag:

```bash
docker build -t inventory-api:local .
```

A team build or release build usually uses a version, commit SHA, or both:

```bash
docker build \
  -t ghcr.io/acme/inventory-api:2026-06-21 \
  -t ghcr.io/acme/inventory-api:git-8f4a2c1 \
  .
```

The first tag is friendly for release notes. The second tag ties the image to a source commit. Real teams often keep both because each answers a different question. "What release is this?" points to the date or version tag. "Exactly which source commit produced it?" points to the commit tag.

There is one habit to build early: check local image evidence before running or pushing.

```bash
docker image ls inventory-api
docker image ls ghcr.io/acme/inventory-api
```

The tag is a label, and labels can move. If you rebuild `inventory-api:local`, Docker points that tag at the new image. Old containers may still point at the previous image ID. That is one reason `docker ps`, `docker inspect`, and a clean replacement loop matter later.

We now have a named image. The next step is turning that image into a running container with the right runtime settings.

## Run the API Container
<!-- section-summary: `docker run` creates a container from an image and applies runtime settings such as name, port publishing, environment variables, and detach mode. -->

`docker run` creates and starts a new container from an image. A **container** is the running copy of the image plus runtime settings: a name, port mappings, environment variables, mounts, networks, and a writable layer for changes made while the process runs.

Start the API in the foreground first so we can watch the startup output:

```bash
docker run \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  -e INVENTORY_DATA_DIR=/app/data \
  inventory-api:local
```

The `--name inventory-api` flag gives the container a stable name. Docker also creates random names, but a real workflow needs names people can type. A stable name lets us run `docker logs inventory-api`, `docker stop inventory-api`, and `docker inspect inventory-api`.

The `-p 8080:3000` flag publishes a port. The left side, `8080`, is the host port on the developer machine. The right side, `3000`, is the container port where the Node process listens. The browser calls `http://localhost:8080`, and Docker forwards that traffic into the container on port `3000`.

The `-e` flags set environment variables inside the container. Environment variables are simple runtime settings. In this example, `PORT=3000` tells the app which port to listen on, and `INVENTORY_DATA_DIR=/app/data` tells it where the seed data lives.

If the app starts correctly, the terminal might show:

```bash
inventory-api listening on port 3000
loaded 42 inventory records from /app/data
```

That foreground run is useful for the first check. After the startup path works, most service runs move to detached mode:

```bash
docker run \
  -d \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  -e INVENTORY_DATA_DIR=/app/data \
  inventory-api:local
```

The `-d` flag runs the container in the background and prints the container ID. The API keeps running after the terminal prompt returns. From this point on, we use Docker inspection commands to see what happened instead of staring at the attached terminal.

One practical warning belongs here. The container name and host port are claimed by this container record. Running the same command again while the old container exists will hit a name conflict. Running another service on host port `8080` will hit a port conflict. Those conflicts are normal signs that Docker still has a container record or a listener already using the setting.

That takes us directly into the observation part of the workflow.

## Check Running and Stopped Containers
<!-- section-summary: `docker ps` shows running containers, while `docker ps -a` also shows stopped containers and their exit status. -->

Once the API runs in the background, the first observation command is `docker ps`. It lists running containers:

```bash
docker ps
```

For our API, the output might look like this:

```bash
CONTAINER ID   IMAGE                 STATUS          PORTS                    NAMES
6c51b9ad8a21   inventory-api:local   Up 2 minutes    0.0.0.0:8080->3000/tcp   inventory-api
```

This one row gives a lot of daily evidence. The `IMAGE` column says which tag started the container. The `STATUS` column says the process is still running. The `PORTS` column says host port `8080` forwards to container port `3000`. The `NAMES` column gives the name we can pass to later commands.

If the browser cannot reach `http://localhost:8080`, this row is the first place to look. A missing `PORTS` value means the container may be listening internally but the host cannot reach it. A missing row means the container may have exited.

Stopped containers show up with `docker ps -a`:

```bash
docker ps -a
```

Now a failed startup might appear like this:

```bash
CONTAINER ID   IMAGE                 STATUS                    PORTS     NAMES
9edc1f7a22d0   inventory-api:local   Exited (1) 12 seconds ago           inventory-api
```

The `Exited (1)` value is the exit code from the container's main process. Exit code `0` usually means the process finished successfully. Exit code `1` usually means a general application error. Other codes can point to signal exits or program-specific failures. Docker records the code because the main process inside the container ended.

Now we know whether the process is running or stopped. The next question is why.

## Use Logs, Exit Codes, and Inspect
<!-- section-summary: Logs explain what the process printed, exit codes summarize how it ended, and inspect shows the exact container configuration Docker applied. -->

`docker logs` reads the stdout and stderr output Docker captured for a container. For a service, logs are usually the fastest way to turn "it exited" into a concrete reason.

```bash
docker logs inventory-api
```

A configuration failure might show:

```bash
Error: DATABASE_URL is required when INVENTORY_MODE=postgres
    at loadConfig (/app/src/server.js:22:11)
    at startServer (/app/src/server.js:47:18)
```

Now we know the failure came from runtime configuration. The image can start Node, but the runtime settings asked for Postgres mode without a database URL. The fix belongs in the run command, a local `.env` file loaded by Compose later, a secret manager in production, or the deployment configuration. For this raw Docker CLI workflow, we can pass it directly:

```bash
docker run \
  -d \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  -e INVENTORY_MODE=memory \
  inventory-api:local
```

Logs also support follow mode when the service is running:

```bash
docker logs -f inventory-api
```

Follow mode is useful while sending requests from another terminal:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/items/SKU-1042
```

When logs show only part of the story, `docker inspect` gives the full Docker-side configuration as JSON:

```bash
docker inspect inventory-api
```

The full output is large, so real workflows often format one field at a time:

```bash
docker inspect \
  --format '{{json .Config.Env}}' \
  inventory-api

docker inspect \
  --format '{{json .NetworkSettings.Ports}}' \
  inventory-api

docker inspect \
  --format '{{.State.Status}} {{.State.ExitCode}}' \
  inventory-api
```

Those commands answer specific questions. Which environment variables did the container receive? Which host port did Docker bind? Is the state `running` or `exited`, and what exit code did Docker record? `inspect` is especially helpful when the run command has changed several times and nobody remembers which flags created the current container.

![Docker debug evidence map infographic showing inventory-api connected to docker ps -a status and ports, docker logs error line, docker inspect env and mounts, and docker exec inside view](/content-assets/articles/article-containers-orchestration-docker-docker-workflow/docker-debug-evidence-map.png)

*Docker debugging works best when each command has a job: status and ports from `ps`, process output from `logs`, configuration from `inspect`, and the container's own view from `exec`.*

Observation leads to action. Once we understand the current container, the next daily move is replacing it with a fresh one after a code or configuration change.

## Rebuild, Stop, Remove, and Rerun
<!-- section-summary: The clean replacement loop rebuilds the image, stops the old container, removes the old container record, and starts a new container with the same name and port. -->

Now imagine the warehouse team asks for a new response field called `reorderStatus`. We edit `src/inventory-store.js`, update the route, and save the file. The running container still uses the files copied into the image when we last built it. A clean image workflow needs a new image and a new container.

The replacement loop is:

```bash
docker build -t inventory-api:local .
docker stop inventory-api
docker rm inventory-api
docker run \
  -d \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  -e INVENTORY_MODE=memory \
  inventory-api:local
```

`docker stop` asks the main process to shut down. Docker sends a stop signal first, usually `SIGTERM`, then sends a kill signal after the grace period if the process keeps running. For a web API, that first signal gives the server a chance to stop accepting new requests and finish active work.

`docker rm` removes the stopped container record. That releases the name `inventory-api` and removes the container's writable layer. The next `docker run` creates a new container from the freshly built image and can reuse the same name and host port.

The order matters in daily work because the image and container are different objects. Rebuilding the image moves the `inventory-api:local` tag to a new image. The already-running container keeps using the image it started from. Stopping and removing that old container clears the way for a new runtime copy.

A quick verification closes the loop:

```bash
docker ps
curl http://localhost:8080/items/SKU-1042
docker logs --tail 20 inventory-api
```

This is the core Docker edit cycle. Build the new artifact, replace the old runtime copy, then prove the replacement is running and answering requests.

Some Docker work runs and exits on purpose, so the next section handles that shorter path.

## Use `--rm` for One-Off Work
<!-- section-summary: `--rm` tells Docker to remove a short-lived container automatically after it exits, which keeps local state cleaner for tests and utility commands. -->

Many containers are long-running services. The `inventory-api` server should keep running so we can call it and inspect it. Other containers are one-off jobs. A test command, a migration preview, or a quick Node script should run, print output, and exit.

For short-lived work, `--rm` keeps Docker from collecting stopped container records:

```bash
docker run --rm inventory-api:local npm test
```

That command starts a new container from the image, runs `npm test` instead of the default server command, streams the output, and removes the container when the test process exits. The image stays. The finished container record goes away.

Here is another one-off check:

```bash
docker run --rm inventory-api:local node -e "console.log(process.version)"
```

This pattern is helpful because it keeps the local Docker view clean. `docker ps -a` should show containers worth inspecting, not dozens of old test runs that already served their purpose.

There is a tradeoff. An auto-removed container leaves less evidence behind after failure. For a mysterious failing command, run it without `--rm` once, inspect the stopped container, read the logs, and remove it after you understand what happened.

Now we have the clean image path and the short-lived command path. During active coding, developers often want faster feedback, and that is where bind mounts enter the workflow.

## Use Bind Mounts for Development
<!-- section-summary: Bind mounts share host files with a container for fast local feedback, while clean image builds remain the proof before shipping. -->

A **bind mount** shares a file or directory from the host machine into the container. For development, that means the container can see source edits immediately instead of waiting for a new image build each time. If the API uses a dev server such as `nodemon`, a saved file can trigger a restart inside the container.

Here is a development command for the same service:

```bash
docker run \
  -d \
  --name inventory-api-dev \
  -p 8080:3000 \
  -e PORT=3000 \
  --mount type=bind,src="$(pwd)",target=/app \
  -w /app \
  node:22-alpine \
  sh -c "npm install && npm run dev"
```

This command uses the public `node:22-alpine` image as a dev runtime, mounts the current project directory into `/app`, sets `/app` as the working directory, installs dependencies, and starts the dev command. The container reads the host files through the mount. When `src/server.js` changes on the host, the container sees the changed file.

Bind mounts are excellent for local development, but they are a different workflow from a clean image build. The bind-mounted dev container depends on the developer's working tree. A production or CI image should come from the Dockerfile, the build context, and a repeatable build command:

```bash
docker build -t inventory-api:local .
docker run --rm inventory-api:local npm test
```

That clean build proves the image contains everything it needs. This distinction prevents a common beginner problem: the app works in a bind-mounted dev container because the host directory has extra files, then fails when built as an image because the Dockerfile forgot to copy something.

Use bind mounts for fast edits. Use clean image builds for the artifact the team trusts, tests, pushes, and deploys.

Once the service runs, sometimes logs are not enough. We need to ask questions from inside the container.

## Debug With `docker exec`
<!-- section-summary: `docker exec` starts another process inside an already running container so you can inspect the runtime environment from the app's point of view. -->

`docker exec` runs a new command inside an existing running container. The main API process keeps running, and Docker starts a second process in the same container environment. This is useful when a problem depends on the container's filesystem, environment variables, working directory, or network view.

Open a shell inside the running API:

```bash
docker exec -it inventory-api sh
```

The `-i` flag keeps standard input open. The `-t` flag gives the session a terminal. The shell opens inside the container, and now we can inspect what the API sees:

```bash
pwd
ls -la /app
printenv PORT
printenv INVENTORY_MODE
node -e "console.log(process.cwd())"
```

For the inventory API, this helps with practical questions. Did the image copy `data/seed.json` to `/app/data`? Did the container receive `INVENTORY_MODE=memory`? Does the Node version match the base image we expected? Is the working directory `/app`?

`docker exec` also supports one command without an interactive shell:

```bash
docker exec inventory-api node -e "console.log(process.env.PORT)"
```

There is an important boundary. Changes made through an exec shell affect that one container's writable layer. If we edit `/app/src/server.js` inside the container, that edit belongs to the container record. Removing the container removes that change. The fix should go back into the source tree, then into a rebuilt image.

Debugging answers runtime questions. Data raises a separate question: which files should survive when the container is replaced?

## Use Volumes for Data
<!-- section-summary: Volumes give Docker-managed storage a lifecycle outside one container, so data can survive replacement. -->

A container has a writable layer. The app can create files there while it runs. That layer belongs to the container, so `docker rm inventory-api` removes it. This is fine for temporary files and caches. It is risky for application data that should survive the replacement loop.

A **volume** is Docker-managed storage with its own lifecycle. A container can mount the volume at a path, write data there, stop, get removed, and a new container can mount the same volume later. The volume survives because it is a separate Docker object.

Suppose the local `inventory-api` writes a small SQLite database during development. Create a named volume:

```bash
docker volume create inventory-data
```

Run the API with that volume mounted at the app's data path:

```bash
docker run \
  -d \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  -e INVENTORY_DB=/var/lib/inventory/inventory.sqlite \
  --mount type=volume,src=inventory-data,target=/var/lib/inventory \
  inventory-api:local
```

Now the container can write `/var/lib/inventory/inventory.sqlite`, and Docker stores that data in the named volume. If we rebuild the image and replace the container, we mount the same volume again:

```bash
docker stop inventory-api
docker rm inventory-api
docker run \
  -d \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  -e INVENTORY_DB=/var/lib/inventory/inventory.sqlite \
  --mount type=volume,src=inventory-data,target=/var/lib/inventory \
  inventory-api:local
```

The service starts from a fresh container, but the database files remain in `inventory-data`. That is the key storage rule for the Docker workflow: **containers are replaceable, data needs an intentional home**.

Use volumes for Docker-managed persistent data. Use bind mounts when you specifically want to share a host path, usually source code or a local config file during development. Mixing those two ideas causes confusion, so name the reason before choosing the mount type.

After the image builds and runs locally, the next team question is sharing it with another machine.

## Push and Pull Through a Registry
<!-- section-summary: A registry stores image repositories so CI, teammates, and deployment machines can pull the same image by name and tag. -->

A **container registry** stores images. Docker Hub, GitHub Container Registry, Amazon ECR, Azure Container Registry, and Google Artifact Registry all serve this role. The local machine builds an image, tags it with a registry path, pushes it, and another machine pulls it.

For a team image, the name needs the registry and namespace:

```bash
docker build \
  -t ghcr.io/acme/inventory-api:git-8f4a2c1 \
  -t ghcr.io/acme/inventory-api:latest \
  .
```

Before pushing, authenticate with the registry your team uses:

```bash
docker login ghcr.io
```

Then push the tags:

```bash
docker push ghcr.io/acme/inventory-api:git-8f4a2c1
docker push ghcr.io/acme/inventory-api:latest
```

Another developer, CI job, or deployment host can pull the same image:

```bash
docker pull ghcr.io/acme/inventory-api:git-8f4a2c1
docker run \
  -d \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  ghcr.io/acme/inventory-api:git-8f4a2c1
```

The commit-style tag is useful because it points to one build result. The `latest` tag is convenient for quick demos, but it can move whenever someone pushes a newer image. Production workflows usually prefer a version tag, commit tag, or digest so a deployment can say exactly which image it is running.

A digest is the content address for one exact image manifest. After CI pushes a tested image, a deployment system can pin the pull to that digest:

```bash
docker pull ghcr.io/acme/inventory-api@sha256:2f4b8c7d...
```

That pinned reference protects the rollout from a moving tag. The team can still keep friendly tags for humans, while the production deployment records the exact image content it started.

Registries change the Docker workflow from "it runs on my laptop" to "the team can pull the same artifact." The local commands still matter because CI and deployment systems use the same ideas: build from a context, tag the image, push it, pull it, run it with runtime settings, and observe it.

The last routine command group is cleanup. Docker keeps useful evidence, but old images, stopped containers, and unused volumes can pile up.

## Clean Up Carefully
<!-- section-summary: Cleanup removes unused Docker objects, so inspect what will be affected and treat volumes with extra care. -->

Docker stores images, containers, networks, build cache, and volumes. That local state helps the workflow. Stopped containers preserve logs and exit codes. Cached layers make rebuilds faster. Volumes preserve data across replacement. Over time, unused objects can consume disk space.

Start cleanup with narrow commands:

```bash
docker ps -a
docker image ls
docker volume ls
```

Remove one stopped container when you know you no longer need its logs or writable layer:

```bash
docker rm inventory-api
```

Remove one image tag when no container needs it:

```bash
docker image rm inventory-api:local
```

For broader cleanup, Docker provides prune commands. `docker system prune` removes unused data such as stopped containers, unused networks, dangling images, and build cache:

```bash
docker system prune
```

Docker asks for confirmation because this command can remove useful evidence. Add `-a` only when you also want to remove unused images beyond dangling ones:

```bash
docker system prune -a
```

Volumes deserve the most caution. A volume may contain a local database, uploaded files, or any other data the app wrote outside the container layer. Docker keeps volumes by default during system prune. Use volume cleanup only after checking the names and deciding the data can go:

```bash
docker volume ls
docker volume rm inventory-data
```

There is also a volume prune command:

```bash
docker volume prune
```

Treat that command like deleting local databases. It removes unused volumes, and "unused" means no container currently attaches them. A stopped experiment from last week might have the only copy of data you care about. Check first, then remove.

With cleanup in place, we can close the module by putting the whole Docker Foundations workflow into one practical runbook.

## Putting It All Together
<!-- section-summary: The full Docker workflow builds the image, runs the service, observes evidence, replaces containers after changes, protects data, shares through a registry, and cleans up intentionally. -->

Here is the daily runbook for the `inventory-api`. This is the version a beginner can keep beside the terminal while practicing.

Start from the project directory and build the image:

```bash
cd inventory-api
docker build -t inventory-api:local .
docker image ls inventory-api
```

Run the service with a stable name, a published port, and explicit runtime settings:

```bash
docker run \
  -d \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  -e INVENTORY_MODE=memory \
  inventory-api:local
```

Check that Docker has the container running and that the API answers:

```bash
docker ps
curl http://localhost:8080/health
docker logs --tail 20 inventory-api
```

If the container exited, include stopped containers and read the logs:

```bash
docker ps -a
docker logs inventory-api
docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' inventory-api
```

After a source change, rebuild and replace the container:

```bash
docker build -t inventory-api:local .
docker stop inventory-api
docker rm inventory-api
docker run \
  -d \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  -e INVENTORY_MODE=memory \
  inventory-api:local
```

For one-off test runs, let Docker remove the finished container automatically:

```bash
docker run --rm inventory-api:local npm test
```

For fast local coding, use a bind-mounted dev container, then return to a clean build before trusting the result:

```bash
docker run \
  -d \
  --name inventory-api-dev \
  -p 8080:3000 \
  -e PORT=3000 \
  --mount type=bind,src="$(pwd)",target=/app \
  -w /app \
  node:22-alpine \
  sh -c "npm install && npm run dev"
```

When the running container has a mystery, inspect it from the inside:

```bash
docker exec -it inventory-api sh
printenv
ls -la /app
```

When the service writes data that should survive replacement, create and mount a named volume:

```bash
docker volume create inventory-data
docker run \
  -d \
  --name inventory-api \
  -p 8080:3000 \
  -e PORT=3000 \
  -e INVENTORY_DB=/var/lib/inventory/inventory.sqlite \
  --mount type=volume,src=inventory-data,target=/var/lib/inventory \
  inventory-api:local
```

When the team needs the image on another machine, tag and push it through a registry:

```bash
docker build \
  -t ghcr.io/acme/inventory-api:git-8f4a2c1 \
  .
docker push ghcr.io/acme/inventory-api:git-8f4a2c1
docker pull ghcr.io/acme/inventory-api:git-8f4a2c1
```

When local Docker state gets messy, inspect before removing:

```bash
docker ps -a
docker image ls
docker volume ls
docker system prune
```

That is the Docker Foundations workflow in one path. **Images are the build artifacts. Containers are replaceable runtime copies. Logs, exit codes, and inspect output are evidence. Bind mounts speed up local editing. Volumes protect data. Registries share images. Cleanup should be deliberate.**

![Docker Workflow Runbook infographic showing inventory-api moving through docker build, docker run, ps plus logs, stop plus rm, push plus pull, and prune carefully with a check volumes first warning](/content-assets/articles/article-containers-orchestration-docker-docker-workflow/docker-workflow-runbook.png)

*The runbook keeps the command order practical: build the artifact, run it with settings, observe evidence, replace old containers, share the image, and check volumes before cleanup.*

Once those pieces connect, each Docker command has a job in the daily loop for building, running, checking, replacing, and sharing a service.

---

**References**

- [Docker buildx build CLI reference](https://docs.docker.com/reference/cli/docker/buildx/build/) - Documents image builds, tags, build arguments, secrets, cache options, and registry output.
- [Docker build context](https://docs.docker.com/build/concepts/context/) - Explains build contexts and `.dockerignore` behavior.
- [Using the Docker build cache](https://docs.docker.com/get-started/docker-concepts/building-images/using-the-build-cache/) - Explains how Docker reuses cached layers and how cache invalidation affects rebuilds.
- [Docker container run CLI reference](https://docs.docker.com/reference/cli/docker/container/run/) - Documents `docker run`, names, environment variables, mounts, published ports, detached mode, and `--rm`.
- [Publishing and exposing ports](https://docs.docker.com/get-started/docker-concepts/running-containers/publishing-ports/) - Explains host-to-container port publishing with `-p`.
- [Docker container ls CLI reference](https://docs.docker.com/reference/cli/docker/container/ls/) - Documents `docker ps`, `docker ps -a`, status output, filters, and formatting.
- [Docker container logs CLI reference](https://docs.docker.com/reference/cli/docker/container/logs/) - Documents retrieving, following, tailing, and timestamping container logs.
- [Docker container inspect CLI reference](https://docs.docker.com/reference/cli/docker/container/inspect/) - Documents detailed JSON inspection for containers.
- [Docker container stop CLI reference](https://docs.docker.com/reference/cli/docker/container/stop/) - Documents graceful container stopping and stop timeout behavior.
- [Docker container rm CLI reference](https://docs.docker.com/reference/cli/docker/container/rm/) - Documents removing container records.
- [Docker container exec CLI reference](https://docs.docker.com/reference/cli/docker/container/exec/) - Documents running additional commands inside running containers.
- [Persisting container data](https://docs.docker.com/get-started/docker-concepts/running-containers/persisting-container-data/) - Explains volumes and Docker-managed persistent data.
- [Sharing local files with containers](https://docs.docker.com/get-started/docker-concepts/running-containers/sharing-local-files/) - Explains bind mounts and host file sharing.
- [Docker image push CLI reference](https://docs.docker.com/reference/cli/docker/image/push/) - Documents pushing images to a registry.
- [Docker image pull CLI reference](https://docs.docker.com/reference/cli/docker/image/pull/) - Documents pulling images and using tags or digests.
- [Docker system prune CLI reference](https://docs.docker.com/reference/cli/docker/system/prune/) - Documents cleanup behavior and volume caution.
