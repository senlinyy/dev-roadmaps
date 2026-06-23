---
title: "Container State, Logs, Inspect, and Exec"
description: "Debug Docker containers by reading state first, then logs, inspect metadata, and live exec output when the main process is still running."
overview: "This article follows a ticketing API through real container debugging: checking status, reading logs, inspecting metadata, and using exec commands only while the main process is alive."
tags: ["docker", "containers", "logs", "inspect", "exec"]
order: 2
id: article-containers-orchestration-docker-container-state-logs-and-exec
---

## Table of Contents

1. [The Debugging Path](#the-debugging-path)
2. [State Comes First](#state-comes-first)
3. [Exit Codes Tell You How the Process Ended](#exit-codes-tell-you-how-the-process-ended)
4. [Logs Tell You What the Process Said](#logs-tell-you-what-the-process-said)
5. [Inspect Shows the Container Contract](#inspect-shows-the-container-contract)
6. [Exec Gives You a Live View](#exec-gives-you-a-live-view)
7. [Crash Walkthrough: Missing Configuration](#crash-walkthrough-missing-configuration)
8. [Running Walkthrough: The API Cannot Reach Its Database](#running-walkthrough-the-api-cannot-reach-its-database)
9. [Debugging Habits Real Teams Use](#debugging-habits-real-teams-use)
10. [What's Next](#whats-next)

## The Debugging Path
<!-- section-summary: Container debugging has an order: state tells us whether the process is alive, logs tell us what it said, inspect shows how Docker created it, and exec gives a live view only while it is running. -->

In the previous article, we ran a container from an image and watched Docker create a real process with a name, port mapping, writable layer, and lifecycle state. Now the same container has a problem. A small `tickets-api` service should start on port `3000`, connect to Postgres, and answer requests from the browser.

This is the kind of problem that happens during normal development and production support. Someone says, "The container started, but the API is down," or "The container exits right away after deploy." The useful move is to collect evidence in the same order every time: **state**, then **logs**, then **inspect output**, then **exec** if the main process still runs.

Here is the short structure before we go deeper. **Container state** answers, "Is the main process alive right now?" **Logs** answer, "What did the process print before and during the failure?" **Inspect output** answers, "What command, environment, ports, mounts, and network settings did Docker actually give this container?" **Exec** answers, "What can a new process see from inside the running container?" Those answers build on each other, so each command earns its place.

That order matters because `docker exec` needs the container's primary process to still be running. Docker can start an extra shell or command inside a running container, but once the main process exits, there is no live container environment for that exec session. For exited containers, state, logs, and inspect output carry the evidence.

![Docker debugging evidence path infographic showing state, logs, inspect, and exec in order with exec available only for a running container](/content-assets/articles/article-containers-orchestration-docker-container-state-logs-and-exec/debugging-evidence-path.png)

*The debugging path works because each tool answers a different question. State decides whether the process is alive, logs explain what it said, inspect shows the saved container contract, and exec only helps when there is still a live container to enter.*

## State Comes First
<!-- section-summary: Container state tells us whether Docker still has a running main process, and that state decides which debugging tools can help next. -->

**Container state** is Docker's record of what happened to the container's main process. In a container, the main process is the command Docker started from the image and runtime arguments. For our ticketing API, that might be `node dist/server.js`, and Docker watches that process as the container's life.

The first command is usually `docker ps -a`. The `ps` command lists containers, and `-a` includes stopped containers too. That detail matters because a crashing container can disappear from the normal `docker ps` view while still holding the logs and metadata we need.

```bash
docker ps -a
```

A small Docker host might show this. The exact IDs and timestamps will change on your machine, but the `STATUS`, `PORTS`, and `NAMES` columns are the important parts:

```console
CONTAINER ID   IMAGE                          COMMAND                  CREATED          STATUS                      PORTS                    NAMES
6d9f3c5a80a1   devpolaris/tickets-api:local   "node dist/server.js"    45 seconds ago   Up 44 seconds               0.0.0.0:8080->3000/tcp   tickets-api
9ac5a6f38d21   devpolaris/tickets-api:local   "node dist/server.js"    4 minutes ago    Exited (1) 4 minutes ago                             tickets-api-bad
f238cd15ef40   devpolaris/report-worker       "node worker.js"         12 minutes ago   Exited (0) 12 minutes ago                            ticket-report-job
```

Each row gives us a next step. `Up 44 seconds` means the main process still runs, so we can use logs, inspect output, and eventually `exec`. `Exited (1)` means the process ended with a failure code, so logs and inspect output should explain the startup failure. `Exited (0)` means the process ended successfully, which fits a one-time job but looks surprising for an API that should stay online.

When a machine runs many containers, filters make the state check calmer. These filters keep the first check focused on the service, stopped containers, or a specific exit code:

```bash
docker ps -a --filter name=tickets-api
docker ps -a --filter status=exited
docker ps -a --filter exited=1
```

The name filter proves which containers belong to this service. The `status=exited` filter finds containers whose main process already ended. The `exited=1` filter focuses on containers that returned exit code `1`, which usually means the application or entry command decided startup failed.

## Exit Codes Tell You How the Process Ended
<!-- section-summary: Exit codes give the first clue about whether a container completed normally, failed during startup, or stopped because of a signal. -->

An **exit code** is the number a process returns to the operating system when it ends. A code of `0` means the process reported success. A non-zero code means the process reported failure, and Docker records that number in the container state.

Exit codes are small, but they are useful because they separate "the container stopped" from "the application reported failure." A report job ending with `Exited (0)` can be healthy. A web API ending with `Exited (1)` needs attention because a long-running service should keep its main process alive.

Docker shows the exit code in `docker ps -a`, and `docker inspect` can show the same value with timestamps. This helps when you need to know whether the process died immediately or ran for a while:

```bash
docker inspect --format 'status={{.State.Status}} exit={{.State.ExitCode}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}' tickets-api-bad
```

That command proves four things at once. `status` tells us Docker's current state for the container. `exit` tells us the process result. `started` and `finished` tell us whether the container died immediately after startup or ran for a while first.

Some exit codes also point to Linux signals. For example, a process killed by signal 9 often appears as exit code `137`, because shells commonly report signal exits as `128 + signal_number`. You do not need to memorize every code at this stage, but you should notice the difference between a clean `0`, a normal app failure like `1`, and a signal-shaped value like `137`.

State and exit codes tell us where to start. They still do not tell us why the ticketing API failed. For that, we read what the process printed.

## Logs Tell You What the Process Said
<!-- section-summary: Docker logs are the captured stdout and stderr streams from the container process, so they usually explain startup failures and request-time errors before shell access does. -->

**Docker logs** are the output Docker captured from the container's standard output and standard error streams. Standard output is the normal stream a process prints to, and standard error is the stream many programs use for warnings and failures. Docker captures those streams through the container logging system, so `docker logs` shows what the process said while it ran.

For our `tickets-api`, useful logs include startup lines, configuration validation, database connection errors, and request failures. A good containerized app writes these messages to stdout and stderr because Docker, Docker Compose, Kubernetes, and logging collectors can all pick them up from there.

These commands read the same captured stream with different windows. The command name stays the same, and the flags change how much history you see:

```bash
docker logs tickets-api
docker logs --tail 80 tickets-api
docker logs --since 10m tickets-api
docker logs --follow --tail 20 tickets-api
docker logs --timestamps --tail 50 tickets-api
```

The plain command proves what the container printed across its available log history. `--tail 80` proves the recent ending without flooding the terminal. `--since 10m` proves what happened during a recent deploy or test. `--follow --tail 20` starts with the latest lines and streams new ones while we trigger a request. `--timestamps` proves when each line happened, which helps connect a browser request, a deploy, and an application error.

A missing configuration crash might show the app's startup path. The process says which required value stopped it:

```log
Booting tickets-api
Reading runtime configuration
DATABASE_URL is required
```

That log tells us the app reached its configuration check and stopped before opening the HTTP port. The state showed `Exited (1)`, and the log explains the cause in application language. Now we can inspect the container metadata to confirm which environment variables Docker actually passed in.

Logs also help for containers that stay up. A running API might print a different shape of evidence. This example reaches the listening line and then fails during a database check:

```log
Booting tickets-api
Listening on 0.0.0.0:3000
Database check failed: getaddrinfo ENOTFOUND tickets-db
GET /health 503 18ms
```

This is a different kind of problem. The API process is alive and the port mapping may be correct, but the app cannot resolve or reach `tickets-db`. The logs give us the application symptom, and inspect output tells us whether Docker gave the container the expected environment, network, and port settings.

## Inspect Shows the Container Contract
<!-- section-summary: Inspect output shows the exact command, environment, ports, network settings, mounts, and recorded state Docker stored for the container. -->

**Inspect output** is Docker's detailed metadata for a container. You can think of it as the container contract Docker created: the image, command, arguments, environment variables, working directory, user, port bindings, mounts, networks, restart count, and state timestamps. Logs tell us what the process said, and inspect output tells us what Docker gave the process.

The full inspect output is large JSON, so the first look can be overwhelming. It is still worth seeing once because it shows how much Docker records for a container:

```bash
docker inspect tickets-api
```

Full JSON proves everything Docker knows, and real debugging usually asks focused questions. Docker's `--format` option lets us pull one field or shape a small line with Go template syntax. That keeps the output tied to the question:

```bash
docker inspect --format 'status={{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}}' tickets-api
docker inspect --format 'image={{.Config.Image}} path={{.Path}} args={{json .Args}}' tickets-api
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tickets-api
docker inspect --format 'ports={{json .HostConfig.PortBindings}}' tickets-api
docker inspect --format 'networks={{json .NetworkSettings.Networks}}' tickets-api
docker inspect --format 'restarts={{.RestartCount}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}' tickets-api
```

Each command proves a different part of the contract. The state line proves Docker's current status and exit code. The image and command line prove which image and startup command were used. The environment line proves which variables existed when the container was created. The ports line proves which container ports were published to the host. The networks line proves which Docker network the container joined and what address Docker assigned there. The restart line proves whether Docker has been trying to restart the container.

Environment inspection deserves a small warning. Environment variables often hold connection strings, tokens, and passwords. In a real team, avoid pasting full `docker inspect` output into chat or tickets without masking secrets, and prefer focused checks that reveal only the field you need.

For the ticketing API, this focused command checks only the names we care about. It narrows the environment list to the app's port and database connection:

```bash
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tickets-api | grep -E '^(PORT|DATABASE_URL)='
```

That command proves whether Docker created the container with the runtime configuration the app expects. The pipe to `grep` runs on your host terminal after Docker prints the environment list. If the value is a secret, the safer version checks only presence:

```bash
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tickets-api | grep -E '^(PORT|DATABASE_URL)=' | sed 's/=.*/=<set>/'
```

Inspect output also explains many "the app is running but I cannot reach it" moments. A port mapping like `0.0.0.0:8080->3000/tcp` in `docker ps` proves Docker published host port `8080` to container port `3000`. The app still has to listen inside the container on the matching container port and on an address reachable from the container network, usually `0.0.0.0` for a web server.

At this point, state, logs, and inspect output give us a lot without touching the container. When the main process is still running and we need the view from inside, `exec` gives us that live viewpoint.

## Exec Gives You a Live View
<!-- section-summary: Docker exec starts an extra command inside a running container, so it answers live questions while durable repairs belong in the container contract. -->

**Docker exec** starts a new command inside a running container. That command shares the container's filesystem, environment, network namespace, and process view, so it can answer questions from inside the same runtime environment as the app. Docker can only do this while the container's primary process is running.

The common beginner command is an interactive shell. The first command tries `sh`, and the second tries `bash` when the image includes it:

```bash
docker exec -it tickets-api sh
docker exec -it tickets-api bash
```

`-i` keeps standard input open, and `-t` allocates a terminal. Many small production images include `sh` but skip `bash`, so `sh` is usually the first shell to try. Some minimal images include no shell at all, and then targeted commands from the app runtime are more useful.

Targeted exec commands create less noise than a long shell session. They also produce short output that fits well in a ticket or comparison between runs:

```bash
docker exec tickets-api pwd
docker exec tickets-api printenv PORT
docker exec tickets-api sh -lc 'ls -la /app && cat /etc/resolv.conf'
docker exec tickets-api sh -lc 'getent hosts tickets-db || true'
docker exec tickets-api sh -lc 'nc -vz tickets-db 5432'
```

These commands prove specific facts. `pwd` proves the default working directory for the exec process. `printenv PORT` proves what a new process sees for a selected variable. `cat /etc/resolv.conf` shows the DNS configuration inside the container. `getent hosts tickets-db` checks whether the dependency name resolves from inside the container. `nc -vz tickets-db 5432` checks whether the database port accepts a TCP connection, if the image includes `nc`.

Shell syntax has one important detail. Docker runs the executable you name, so a command with shell operators needs an explicit shell. That keeps Docker responsible for starting `sh`, and the shell responsible for operators like `&&`:

```bash
docker exec tickets-api sh -lc 'echo $HOSTNAME && ps -ef'
```

Here `sh` is the executable, `-lc` asks the shell to run the following string, and the shell handles `$HOSTNAME` plus `&&`. This pattern helps when you need pipes, environment expansion, or a few short checks in one exec call.

Use exec for live diagnosis during a running container session. If you edit a file inside a running container, that change lives in that container's writable layer and disappears when the container is replaced. In production, exec can help confirm a diagnosis, and the durable fix should go back into the image, the startup command, the environment, the network, or the deployment configuration.

Now let's walk through the two common ticketing API failures from start to finish. The first one exits during startup, and the second one keeps running while the database connection fails.

## Crash Walkthrough: Missing Configuration
<!-- section-summary: For an exited API container, state proves the process ended, logs explain the app-level failure, and inspect confirms which runtime configuration Docker supplied. -->

Imagine a developer starts the ticketing API after building the image. The command below intentionally leaves out `DATABASE_URL` so we can follow the failure evidence:

```bash
docker run -d --name tickets-api-bad -p 8080:3000 devpolaris/tickets-api:local
```

The command starts the container in detached mode, gives it the name `tickets-api-bad`, and publishes host port `8080` to container port `3000`. The browser fails immediately, so the first check is state. At this point, the state tells us whether any live command can still run:

```bash
docker ps -a --filter name=tickets-api-bad
```

The output shows the important clue. The row gives us the state and exit code before we spend time on anything else:

```console
CONTAINER ID   IMAGE                          COMMAND                  STATUS                    PORTS     NAMES
9ac5a6f38d21   devpolaris/tickets-api:local   "node dist/server.js"    Exited (1) 8 seconds ago             tickets-api-bad
```

This proves the API has already stopped, and exit code `1` tells us the process reported failure. Since the main process ended, `exec` has no live process to join. The logs are the next useful evidence:

```bash
docker logs --tail 40 tickets-api-bad
```

The logs explain the startup path. The app prints the exact configuration value that blocked startup:

```log
Booting tickets-api
Reading runtime configuration
DATABASE_URL is required
```

Now inspect confirms the container contract. The app says `DATABASE_URL` is missing, so we check what Docker created. The command prints only the environment entries relevant to this service:

```bash
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tickets-api-bad | grep -E '^(PORT|DATABASE_URL)='
```

The output might show only one value. That short result is enough to confirm the missing variable:

```console
PORT=3000
```

That proves Docker created the container without the database URL. The fix is to create a new container with the needed runtime values and put it on the network where the `tickets-db` container runs. Environment variables and network membership are set when the container is created, so the old failed container has already given us its evidence:

```bash
docker rm tickets-api-bad
docker run -d \
  --name tickets-api \
  --network tickets-net \
  -p 8080:3000 \
  -e PORT=3000 \
  -e DATABASE_URL=postgres://tickets:dev@tickets-db:5432/tickets \
  devpolaris/tickets-api:local
```

After that, the same evidence path proves the new result. The commands are the same because the debugging order stays the same:

```bash
docker ps -a --filter name=tickets-api
docker logs --tail 40 tickets-api
docker inspect --format 'status={{.State.Status}} exit={{.State.ExitCode}}' tickets-api
```

The corrected version should show `Up` in `docker ps -a` when `tickets-db` is reachable on `tickets-net`, startup logs that reach the listening line, and `status=running exit=0` from inspect. Exit code `0` appears while the container is running because Docker has no failure exit to report for the active process. If the database name still fails, the next walkthrough handles that network and DNS problem directly.

## Running Walkthrough: The API Cannot Reach Its Database
<!-- section-summary: For a running API with a dependency problem, logs show the application symptom, inspect shows network and environment metadata, and exec checks DNS and TCP connectivity from inside the container. -->

Now the API stays up, but the health endpoint returns an error. This is a common production shape: the process is alive, the port is published, and the service still cannot do useful work because a dependency is missing or unreachable.

The state check starts the same way. We still want Docker's recorded state before we decide whether live debugging can help:

```bash
docker ps -a --filter name=tickets-api
```

The output now points us toward live debugging. The word `Up` tells us the main process still exists:

```console
CONTAINER ID   IMAGE                          COMMAND                  STATUS          PORTS                    NAMES
6d9f3c5a80a1   devpolaris/tickets-api:local   "node dist/server.js"    Up 2 minutes    0.0.0.0:8080->3000/tcp   tickets-api
```

This proves the main process is alive and Docker published host port `8080` to container port `3000`. The port mapping says traffic can reach the container port, and the logs tell us what the application does with that traffic. Now we switch from container state to application evidence:

```bash
docker logs --since 5m tickets-api
```

The output shows the dependency problem. The API can start its HTTP server, then fails when it tries to resolve the database name:

```log
Booting tickets-api
Listening on 0.0.0.0:3000
Database check failed: getaddrinfo ENOTFOUND tickets-db
GET /health 503 18ms
```

This proves the app opened the HTTP server and then failed while resolving `tickets-db`. Now inspect helps us check whether the container joined the network where `tickets-db` should exist. We also verify the hostname the app read from its environment:

```bash
docker inspect --format 'networks={{json .NetworkSettings.Networks}}' tickets-api
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' tickets-api | grep -E '^DATABASE_URL=' | sed 's/:[^:@/]*@/:<password>@/'
```

The network output proves which Docker networks the container joined. The database URL check proves which hostname the app tries to use, while the `sed` expression masks the password part before the value lands in the terminal. If the container is on the default `bridge` network and the database runs on another user-defined network, the name `tickets-db` may never resolve from this container.

Because the API is running, `exec` can test the same network view from inside. These commands ask the container's own DNS and TCP path what they can reach:

```bash
docker exec tickets-api sh -lc 'getent hosts tickets-db || true'
docker exec tickets-api sh -lc 'nc -vz tickets-db 5432'
```

The first command proves whether container DNS resolves `tickets-db`. The second command proves whether the database port accepts TCP connections from this container, assuming `nc` exists in the image. If the image lacks `getent` or `nc`, a Node-based image can still use Node itself for a small DNS check:

```bash
docker exec tickets-api node -e "require('dns').lookup('tickets-db', (err, addr) => { if (err) { console.error(err.message); process.exit(1) } console.log(addr) })"
```

That command proves name resolution with the same runtime family the API uses. A successful DNS answer tells us the name exists, and a TCP failure then points toward the database process, port, firewall, or credentials. A DNS failure points toward the Docker network or the dependency name.

The likely fix is to recreate the API container on the same user-defined network as the database. That gives the API and database a shared Docker DNS space where the name `tickets-db` can resolve. The recreated containers now match the dependency name used in `DATABASE_URL`:

```bash
docker network create tickets-net
docker run -d \
  --name tickets-db \
  --network tickets-net \
  -e POSTGRES_USER=tickets \
  -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=tickets \
  postgres:16
docker rm -f tickets-api
docker run -d \
  --name tickets-api \
  --network tickets-net \
  -p 8080:3000 \
  -e PORT=3000 \
  -e DATABASE_URL=postgres://tickets:dev@tickets-db:5432/tickets \
  devpolaris/tickets-api:local
```

The exact database container setup in a real project will include credentials, volumes, and migrations, so this example focuses only on the debugging shape. The important part is the evidence chain: state proved the API was alive, logs proved the dependency failure, inspect proved the configured network and hostname, and exec tested resolution from inside the running container.

![Docker crash versus running debug infographic comparing an exited tickets-api container with missing DATABASE_URL and a running container that cannot reach tickets-db](/content-assets/articles/article-containers-orchestration-docker-container-state-logs-and-exec/crash-vs-running-debug.png)

*These two failures use different evidence. A startup crash stays with state, logs, and inspect; a running dependency problem can add exec checks because the container still has a live network view.*

## Debugging Habits Real Teams Use
<!-- section-summary: Production teams keep container debugging useful by writing logs to stdout and stderr, using focused inspect queries, limiting exec changes, and turning repeated checks into runbooks. -->

Real teams turn this evidence path into a small runbook. A runbook is a short, repeatable set of checks people follow during an incident or support issue. For a single Docker container, the runbook can be as simple as state, recent logs, focused inspect fields, and one or two targeted exec checks.

The first habit is writing application logs to stdout and stderr. Docker's logging system is designed around those streams, and logging drivers can store or forward them to local files, journald, Fluentd, CloudWatch Logs, or another backend. If the application writes only to a file inside the container, `docker logs` may show very little, and every incident starts with a shell hunt.

The second habit is using focused inspect commands. Full `docker inspect` output is useful and can expose secrets or create noise. A command that prints only `.State`, `.Config.Env`, `.HostConfig.PortBindings`, or `.NetworkSettings.Networks` makes the debugging note clearer for review later.

The third habit is using exec as a focused live check. Exec can confirm DNS, ports, files, users, working directories, and runtime values. Lasting fixes belong in the Dockerfile, image build, runtime command, environment, network, secrets handling, or orchestration configuration.

The fourth habit is saving the proof with the ticket. A good incident note says, "`docker ps -a` showed `Exited (1)`, logs showed `DATABASE_URL is required`, and inspect showed no `DATABASE_URL` in `.Config.Env`." That note lets the next person understand both the symptom and the proof without replaying the whole debugging session.

These habits also carry forward to orchestration systems. Kubernetes has different commands, such as `kubectl get pods`, `kubectl logs`, `kubectl describe`, and `kubectl exec`, but the order stays familiar. First learn the state, then read the process output, then inspect the runtime contract, then enter the live environment only when it helps answer a specific question.

![Docker debugging runbook summary infographic showing incident note, state, recent logs, inspect config, exec live checks, and fixing the container contract](/content-assets/articles/article-containers-orchestration-docker-container-state-logs-and-exec/debugging-runbook-summary.png)

*A useful incident note connects the symptom to proof: state, recent logs, focused inspect output, and live exec checks when the process is still running. The durable fix belongs back in the image, environment, network, ports, or startup command.*

## What's Next

You can now debug the two biggest container shapes: a process that exited during startup and a process that keeps running while a dependency fails. The next article moves one layer earlier in the lifecycle and explains how Docker chooses the startup command, how `ENTRYPOINT` and `CMD` fit together, and how environment variables shape container behavior.

---

**References**

- [Docker: `docker container ls`](https://docs.docker.com/reference/cli/docker/container/ls/) - Documents `docker ps`, `--all`, status filters, exit-code filters, and formatted output.
- [Docker: `docker container logs`](https://docs.docker.com/reference/cli/docker/container/logs/) - Documents `--tail`, `--follow`, `--since`, `--until`, and timestamps for container logs.
- [Docker: View container logs](https://docs.docker.com/engine/logging/) - Explains how Docker uses stdout and stderr, and why some logging drivers or file-only app logs change what `docker logs` can show.
- [Docker: `docker container inspect`](https://docs.docker.com/reference/cli/docker/container/inspect/) - Documents detailed container metadata and `--format` output.
- [Docker: Format command and log output](https://docs.docker.com/engine/cli/formatting/) - Explains Docker CLI Go template formatting used by `--format`.
- [Docker: `docker container exec`](https://docs.docker.com/reference/cli/docker/container/exec/) - Documents running commands inside a running container and the primary-process requirement.
- [Docker: `docker container run`](https://docs.docker.com/reference/cli/docker/container/run/) - Documents runtime options including `--publish`, `--env`, `--network`, logging drivers, and restart-policy fields referenced during inspection.
