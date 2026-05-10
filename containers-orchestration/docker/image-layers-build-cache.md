---
title: "Image Layers and Build Cache"
description: "Read Docker image layers, understand cache invalidation, and structure builds that are fast without hiding stale dependencies."
overview: "Image layers explain why Docker builds can be quick one minute and slow the next. Once you can read cache hits and misses, Dockerfile order becomes an engineering choice instead of guesswork."
tags: ["docker", "layers", "cache", "buildkit"]
order: 3
id: article-containers-orchestration-docker-image-layers-build-cache
---

## Table of Contents

1. [Read the Build as Evidence](#read-the-build-as-evidence)
2. [The devpolaris-orders-api Example](#the-devpolaris-orders-api-example)
3. [The Smallest Useful Artifact](#the-smallest-useful-artifact)
4. [Reading Command Output](#reading-command-output)
5. [Configuration Choices That Matter](#configuration-choices-that-matter)
6. [Diagnostics Before Guessing](#diagnostics-before-guessing)
7. [Failure Mode and Fix Direction](#failure-mode-and-fix-direction)
8. [Operational Tradeoffs](#operational-tradeoffs)
9. [The Habit to Practice](#the-habit-to-practice)
10. [Practice Loop for Cache Changes](#practice-loop-for-cache-changes)

## Read the Build as Evidence

Docker images are built from layers. A layer is a filesystem change produced by a
Dockerfile instruction, such as installing packages or copying files. Docker keeps
layers separate so it can reuse work, share common base layers between images, and
transfer only the parts that changed.

The running example is `devpolaris-orders-api`, a Node service with `GET /health`, `POST
/orders`, and a PostgreSQL dependency. The service is ordinary on purpose. Docker
behavior is easier to learn when logs, ports, files, and failures appear in a service
shape you may already recognize.

The key mental model for this article is `layer cache`. Do not treat it as vocabulary to
memorize. Treat it as the boundary that decides where files live, what gets reused,
which name a process can call, or where the next diagnostic command should look.

A good Docker workflow keeps the application image disposable and the operational
evidence visible. If a command changes state, inspect the state. If a config file
controls a runtime choice, read it as part of code review.

## The devpolaris-orders-api Example

For `devpolaris-orders-api`, the team wants a repeatable local path. A new developer
should clone the repository, run the documented Docker command or Compose command, call
`/health`, and know where to look when the result differs from the README.

That local path should not depend on uncommitted files, hidden laptop services, or a
shell environment only one person has. Docker does not remove all environmental
differences, but it makes the important ones explicit: image name, container name,
environment variables, ports, mounts, networks, and startup command.

The example keeps using these values so the evidence stays consistent:

| Setting | Value | Why it matters |
|---------|-------|----------------|
| Service | `devpolaris-orders-api` | Gives logs and requests a real owner |
| Internal port | `3000` | The API listens here inside the container |
| Host port | `8080` | The browser uses this from the host |
| Database | `orders_dev` | The API needs a concrete dependency |
| Health path | `/health` | A cheap endpoint for readiness checks |

When you see a failure later, match it back to this table. A wrong port, wrong database
host, wrong file path, or wrong service name usually explains the symptom.

## The Smallest Useful Artifact

The smallest useful artifact is the file or command that makes the decision reviewable.
For this topic, the artifact looks like this:

```dockerfile
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY server.js ./server.js
```

The exact syntax matters less than the shape. The artifact names the thing Docker should
create or connect. It also gives a reviewer something concrete to question. Is the image
tag right? Is the mount path safe? Is the service name reachable from the caller? Is the
command running in the foreground?

Avoid hiding important choices in one-off terminal history. If the team needs the same
command more than twice, place it in a `compose.yaml`, `Dockerfile`, `Makefile`, package
script, or README snippet that can be reviewed.

## Reading Command Output

Docker output is not decoration. It is the first diagnostic interface. Build output
shows cache hits and rebuilt steps. `docker ps` shows lifecycle state and published
ports. Logs show what the process wrote to stdout and stderr. Inspect output shows
metadata that may not be visible in the original command.

```bash
$ docker build -t devpolaris/orders-api:local .
[+] Building 2.4s (10/10) FINISHED
 => CACHED [3/6] COPY package*.json ./                       0.0s
 => CACHED [4/6] RUN npm ci --omit=dev                       0.0s
 => [5/6] COPY src ./src                                     0.1s
 => exporting to image                                       0.2s
```

Read the first surprising line, not the last line only. If a build spent 30 seconds on
dependency install, look for the instruction that invalidated the cache. If `docker ps`
shows no host port, the browser cannot reach the container through localhost. If logs
show an application-level error, rebuilding the image may not change anything.

A useful team habit is to paste the smallest evidence block into a pull request, issue,
or incident note. The evidence should answer one question. Large logs make the next
person search again. Small evidence lets the next person continue the reasoning.

## Configuration Choices That Matter

Several Docker choices look like small syntax details but carry operational meaning.
Names decide how humans and DNS refer to containers. Ports decide which traffic crosses
the host boundary. Mounts decide which files survive replacement. Dockerfile order
decides which build work can be reused. Compose service names decide what connection
strings should contain.

For `devpolaris-orders-api`, a production-like local setup should keep secrets out of
the image, keep database data outside the API container, publish only the API port
needed by the browser, and make startup logs visible. Those choices are not ceremony.
They prevent specific failures: leaked `.env` files, empty databases after recreate,
exposed local databases, and containers that exit without useful logs.

| Choice | Safer default | Failure it prevents |
|--------|---------------|---------------------|
| Runtime config | Environment variables at run time | Rebuilding images for each environment |
| Service data | Named volumes | Losing database files with container removal |
| Host access | Explicit port publishing | Accidental exposure or unreachable services |
| App logs | stdout and stderr | Empty `docker logs` during failures |
| Source edits | Bind mounts only for development | Host-specific production behavior |

These defaults are small enough for a junior engineer to apply and concrete enough for a
senior engineer to review.

## Diagnostics Before Guessing

When something breaks, resist the urge to change three things at once. Docker gives you
a clean diagnostic order. Start with the state, then logs, then metadata, then
inside-container checks only if the container is running.

For most local failures, the first four commands are enough:

```bash
$ docker ps -a --filter name=orders
$ docker logs --tail 100 orders-api
$ docker inspect orders-api --format "{.State.Status} {.State.ExitCode}"
$ curl -i http://localhost:8080/health
```

Each command narrows the boundary. `docker ps -a` tells you whether the process is
alive. `docker logs` tells you what the process reported. `docker inspect` tells you
what Docker actually configured. `curl` proves the host-to-container path.

Use `docker exec` after those checks, not before them. A shell inside a container is
useful, but it can also distract you into poking around without a theory. Enter the
container when you know what you need to inspect: an environment variable, a file path,
DNS resolution, a process user, or a command result.

## Failure Mode and Fix Direction

A realistic failure for this topic looks like this:

```text
Generated types are out of date. Run npm run generate:types.
```

The fix direction depends on the error text. If the process cannot find a file, inspect
the image layout, working directory, Dockerfile copy steps, and bind mounts. If the
process cannot reach `127.0.0.1`, remember that localhost means the current container,
not the host or another service. If a database table is missing, the network may be fine
and the schema migration may be the actual failure.

Do not stop at naming the failure. Prove the boundary. For a network error, show the
connection string and network membership. For a mount error, show `docker inspect` mount
output and `ls -l` ownership. For a cache error, show the first non-cached layer. For a
Compose timing error, show service health and API logs at the same timestamp.

The repair should live in the durable place: Dockerfile, Compose file, application
startup checks, migration command, or documented run target. A manual change inside a
running container is evidence gathering, not a permanent fix.

## Operational Tradeoffs

Every Docker pattern trades one benefit for another. More isolation can mean more setup.
Smaller images can be harder to debug. Bind mounts give fast feedback but make the
container depend on host files. Named volumes protect data but keep stale state after
containers are removed. Cache speeds builds but can hide missing inputs if the
Dockerfile does not describe the real build.

| Strategy | Gain | Cost |
|----------|------|------|
| Direct CLI | Fast inspection | Hard to repeat as the stack grows |
| Dockerfile | Portable image contract | Requires careful build inputs |
| Named volume | Durable service data | Reset must be deliberate |
| Bind mount | Immediate local edits | Host permissions and hidden image files |
| User-defined network | Stable service names | Another object to inspect |
| Compose | Reviewable local stack | Still not a production orchestrator |

The best default is the one that makes the next failure easiest to diagnose. For a
learning roadmap, that means clear names, short commands, visible logs, and one concrete
service carried through the examples.

## The Habit to Practice

Practice this topic by changing one variable at a time. Start the service, call
`/health`, inspect the state, then intentionally break one boundary. Remove an
environment variable. Change a port mapping. Rename a service. Remove a volume. Reorder
a Dockerfile copy step. Each small break teaches one diagnostic branch.

Write down the command that proved the cause. The command matters because it turns
memory into a repeatable method. A teammate can follow `docker logs`, `docker inspect`,
`docker network inspect`, or `docker volume inspect` even if they did not watch the
original failure happen.

For `devpolaris-orders-api`, the target habit is simple: you can explain where the
process runs, where its files come from, how traffic reaches it, where its data
persists, and which command proves each claim. That is the practical foundation Docker
needs before Kubernetes enters the picture.

## Practice Loop for Cache Changes

You learn cache behavior fastest by making one change at a time and
watching where the first non-cached line appears. Start with a clean
build, then change only application source.

```bash
$ docker build -t devpolaris/orders-api:cache-lab .
[+] Building 21.2s (10/10) FINISHED
 => [4/6] RUN npm ci --omit=dev                             13.9s
 => [5/6] COPY src ./src                                     0.1s
```

Now edit `src/routes/health.ts` and build again.

```bash
$ docker build -t devpolaris/orders-api:cache-lab .
[+] Building 2.1s (10/10) FINISHED
 => CACHED [4/6] RUN npm ci --omit=dev                       0.0s
 => [5/6] COPY src ./src                                     0.1s
```

That is the expected result. Source changed, so the source copy layer
rebuilt. Dependencies did not change, so the dependency layer stayed
cached. Next, change `package-lock.json` by adding a package and build
again.

```bash
$ docker build -t devpolaris/orders-api:cache-lab .
[+] Building 18.4s (10/10) FINISHED
 => [3/6] COPY package*.json ./                              0.1s
 => [4/6] RUN npm ci --omit=dev                             12.7s
 => [5/6] COPY src ./src                                     0.1s
```

That rebuild is correct because the dependency input changed. A bad
Dockerfile cannot distinguish these two cases because it copies the
whole repository before `npm ci`.

```dockerfile
COPY . .
RUN npm ci --omit=dev
```

With that order, a route edit and a dependency edit both invalidate `npm
ci`. The failure is not visible as a red error. It appears as slow
feedback. Slow feedback matters because developers rebuild less often,
CI costs more, and broken images are noticed later.

The cache practice loop is therefore simple: change source, change
dependency metadata, change `.dockerignore`, and read the first
non-cached step each time. Once you can predict the first cache miss
before running the build, Dockerfile order has become a design tool
rather than folklore.

Also practice the no-cache check once, but use it as a diagnostic tool rather than a daily habit.

```bash
$ docker build --no-cache -t devpolaris/orders-api:no-cache .
[+] Building 42.6s (10/10) FINISHED
 => [4/6] RUN npm ci --omit=dev                             15.3s
 => [5/6] COPY src ./src                                     0.2s
```

A no-cache build answers a narrow question: can the Dockerfile build from scratch with only the declared inputs? If the no-cache build fails, the cache was hiding an undeclared input or stale generated output.

Record one cache observation in the pull request when a Dockerfile changes. A note such as "route edits keep npm ci cached" tells the reviewer that the order was tested, not only rearranged.

If CI uses a remote builder, run the same observation there once. Local cache and CI cache are separate stores, so a Dockerfile can be well ordered even when the first CI build after a cache reset is still slow.

Keep the cache note close to the Dockerfile diff. Reviewers should not need to infer whether a copied file is part of dependency installation or only part of application runtime.

---

**References**

- [Docker Docs: Docker build cache](https://docs.docker.com/build/cache/) - Official explanation of layer cache behavior and invalidation.
- [Docker Docs: Optimize cache usage](https://docs.docker.com/build/cache/optimize/) - Practical guidance for ordering Dockerfiles and reducing rebuild time.
- [Docker Docs: Build context and .dockerignore](https://docs.docker.com/build/concepts/context/#dockerignore-files) - Explains how build context inputs affect Docker builds.
