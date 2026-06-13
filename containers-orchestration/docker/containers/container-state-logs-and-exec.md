---
title: "State and Logs"
description: "Use container state, logs, inspect output, and exec sessions to understand what a running or exited container actually did."
overview: "A container is easiest to debug when you read its evidence in order. This article follows status, logs, metadata, and shell access so inspection stays tied to the main process instead of becoming command memorization."
tags: ["docker", "logs", "exec", "inspect"]
order: 2
id: article-containers-orchestration-docker-container-state-logs-and-exec
---

## Table of Contents

1. [The Debugging Path](#the-debugging-path)
2. [State Tells You Where to Start](#state-tells-you-where-to-start)
3. [Logs Tell You What the Process Said](#logs-tell-you-what-the-process-said)
4. [Inspect Shows the Container Contract](#inspect-shows-the-container-contract)
5. [Exec Gives You a Live View](#exec-gives-you-a-live-view)
6. [A Crash Walkthrough](#a-crash-walkthrough)
7. [A Running and Unreachable Walkthrough](#a-running-and-unreachable-walkthrough)
8. [Logging Habits That Help Later](#logging-habits-that-help-later)
9. [Where Inspection Usually Breaks](#where-inspection-usually-breaks)
10. [What's Next](#whats-next)

## The Debugging Path
<!-- section-summary: Container debugging works best when state, logs, inspect output, and exec each answer a different question. -->

In the previous article, we ran the `tickets-api` container and gave Docker a name, environment variables, and a port mapping. Now imagine the junior developer opens the browser and sees an error. The first instinct might be to jump inside the container with a shell, and Docker already has several pieces of evidence waiting for us.

The useful path has four stops. **State** tells us whether the main process still runs. **Logs** show what the process wrote to standard output and standard error. **Inspect output** shows the configuration Docker used when it created the container. **Exec** starts an extra process inside a container that already has a running main process.

Those four tools connect to the same container lifecycle. Exec needs a live process namespace for a shell session, so an exited main process sends us back to state, logs, and inspect output. If the main process still runs, logs and inspect output can tell us whether the service started with the settings we expected before we touch the inside of the container.

So we will follow the evidence in order. State first, logs second, inspect third, and exec when the container is alive and we need a live viewpoint.

## State Tells You Where to Start
<!-- section-summary: Container state tells you whether the main process is alive, exited, restarting, paused, or waiting for cleanup. -->

**Container state** is Docker's recorded answer to the question, "What happened to the main process?" A running API should show as `Up`. A failed startup usually shows as `Exited` with an exit code. A restart policy can show `Restarting` when Docker keeps trying to start the process again.

The first command after a confusing run is usually `docker ps -a`. It includes stopped containers, which matters when the process exited quickly:

```bash
docker ps -a
```

Example output might look like this. The rows show three different container lifetimes from the same Docker host:

```console
CONTAINER ID   IMAGE                          COMMAND                  STATUS                      NAMES
1b7f2b6c9a11   devpolaris/tickets-api:local   "node dist/server.js"    Up 45 seconds               tickets-api
88d7c92a4f30   devpolaris/tickets-api:local   "node dist/server.js"    Exited (1) 4 minutes ago    tickets-api-bad
e23c6f9a9124   devpolaris/tickets-worker      "node worker.js"         Exited (0) 10 minutes ago   ticket-report-job
```

The `STATUS` column sets the next question. `Up` means the main process still runs, so live checks and `exec` can help. `Exited (1)` means the process reported a failure, so logs should come next. `Exited (0)` means the process completed successfully, which fits a one-time report job and surprises people only when they expected a long-running service.

Exit codes come from the process, shell, or runtime inside the container. Docker records them and shows them back to you. That small difference matters because Docker can show the symptom while the application log explains the cause.

## Logs Tell You What the Process Said
<!-- section-summary: Docker logs are the captured standard output and standard error streams from the container process. -->

**Docker logs** are the output Docker captured from the container's standard output and standard error streams. In plain English, this is what the process printed while it ran. For a web app, that should include startup messages, configuration warnings, request errors, and crash details.

The common commands are small. Each one reads the same captured stream with a different viewing window:

```bash
docker logs tickets-api
docker logs --tail 80 tickets-api
docker logs -f tickets-api
docker logs --since 10m tickets-api
```

`--tail` keeps the output focused when a service has been running for a while. `-f` follows new log lines as they arrive, which helps while you trigger a browser request in another terminal. `--since` narrows the window if the issue started after a recent run or restart.

For the ticketing API, a startup failure might leave this log. The app says exactly which runtime value blocked startup:

```log
Booting tickets API
Reading runtime configuration
DATABASE_URL is required
```

That log tells us Docker created the container and started the Node process. The app then rejected its runtime configuration. A rebuild would waste time here because the missing value belongs to the container run, Compose file, secret source, or deployment configuration.

This is why production container apps usually write logs to standard output and standard error. Docker can collect those streams, `docker logs` can show them locally, and orchestrators can forward them to a logging system. A log file buried inside the container filesystem gives the operator extra work at the exact moment they need fast evidence.

## Inspect Shows the Container Contract
<!-- section-summary: Inspect output shows the exact configuration Docker saved for the container, including command, environment, ports, mounts, state, and health. -->

**Inspect output** is Docker's saved metadata for a container, image, network, or volume. For a container, it shows the settings Docker used and the state Docker recorded. It can be long, and you usually enter it with one question in mind.

```bash
docker inspect tickets-api
```

For environment and command checks, these fields often matter. They connect the application symptom back to the container settings Docker saved:

```json
{
  "Config": {
    "Cmd": ["node", "dist/server.js"],
    "Env": [
      "NODE_ENV=development",
      "DATABASE_URL=postgres://tickets:tickets@host.docker.internal:5432/tickets"
    ],
    "WorkingDir": "/app"
  },
  "State": {
    "Status": "running",
    "ExitCode": 0
  },
  "HostConfig": {
    "PortBindings": {
      "3000/tcp": [
        {
          "HostIp": "",
          "HostPort": "8080"
        }
      ]
    }
  }
}
```

This metadata helps when the logs point at configuration. If the app says `DATABASE_URL is required`, inspect can confirm whether Docker actually passed it. If the browser fails to reach the API, inspect can confirm whether `3000/tcp` maps to host port `8080`. If the process starts in the wrong folder, inspect can show the configured working directory.

You can format inspect output when the full JSON is too much. This keeps the command focused on the field you are testing:

```bash
docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' tickets-api
docker inspect --format '{{json .HostConfig.PortBindings}}' tickets-api
```

The formatted version works well in notes and scripts. The full JSON works well when you are still exploring and want to see every saved field.

## Exec Gives You a Live View
<!-- section-summary: Exec starts an extra process inside a running container, which makes it useful after state proves the main process is alive. -->

**Docker exec** starts a new command inside an already running container. Docker's official docs point out that the exec command runs only while the container's primary process, PID 1, is running. That makes state the gate before `exec`: `Up` gives you a live target, while an exited process sends you back to logs and inspect.

A common shell session looks like this. It starts a new shell process inside the already running container:

```bash
docker exec -it tickets-api sh
```

The `-i` flag keeps input open and `-t` gives the session a terminal. Many small Linux images include `sh`, while some images keep only the application binary and a tiny runtime. In those small images, an exec session can still run commands that exist in the image. A shell may be absent, so the available commands come from the image contents.

Exec is useful for live questions. You can check whether a file exists, test DNS from inside the container, print environment visible to a process, or call a local health endpoint from the same network view as the app.

```bash
docker exec tickets-api pwd
docker exec tickets-api printenv DATABASE_URL
docker exec tickets-api node -e "fetch('http://127.0.0.1:3000/health').then(r => console.log(r.status))"
```

Exec also has its own environment and working-directory options. Docker can set extra environment variables for the exec process, and those values apply to that one exec command. That can help with a temporary diagnostic command while leaving the container's original runtime configuration unchanged.

## A Crash Walkthrough
<!-- section-summary: A crashed container usually needs state, logs, and inspect before shell access becomes relevant. -->

Let's follow the ticketing API after it exits during startup. The junior developer says, "The run finished and I got my prompt back." That description could mean a normal foreground process completed, a server crashed, or the run was detached and still works in the background.

State gives the first branch. The command narrows the output to the container name we care about:

```bash
docker ps -a --filter name=tickets-api
```

The output shows `Exited (1)`. That tells us the main process reported a failure, and the container record still exists. Logs become the next useful evidence source.

```bash
docker logs tickets-api
```

The log says the app rejected its runtime configuration. The next lines point directly at the missing value:

```log
Booting tickets API
DATABASE_URL is required
```

Now inspect can confirm the configuration Docker used. The environment list should show whether Docker passed the missing value:

```bash
docker inspect --format '{{json .Config.Env}}' tickets-api
```

If `DATABASE_URL` is missing from that list, the fix belongs in the run command, env file, Compose file, or secret injection path. A corrected local run supplies it explicitly:

```bash
docker rm tickets-api
docker run -d \
  --name tickets-api \
  -e DATABASE_URL=postgres://tickets:tickets@host.docker.internal:5432/tickets \
  -p 8080:3000 \
  devpolaris/tickets-api:local
```

That sequence also explains the cleanup timing. We removed the old stopped container after reading its evidence. Removing it first would have taken away the name conflict and the saved logs at the same time.

## A Running and Unreachable Walkthrough
<!-- section-summary: A running container with an unreachable service usually points to port mapping, listening address, or application readiness. -->

Now take a different shape. `docker ps` says the API is `Up`, and `docker logs` says `Listening on 3000`. The browser still fails at `http://localhost:8080`. Since the process is alive, the next question moves from crash evidence to reachability.

The port column in `docker ps` should show a host mapping. That mapping tells us how browser traffic reaches the container port:

```console
PORTS                    NAMES
0.0.0.0:8080->3000/tcp   tickets-api
```

If the `PORTS` column only shows `3000/tcp`, the image exposes a port and the run skipped host publishing. The corrected run needs `-p 8080:3000`. If the mapping points to another host port, the browser URL should use that host port.

When the port mapping looks correct, `exec` can test the service from inside the container. This separates internal service behavior from host-side routing:

```bash
docker exec tickets-api node -e "fetch('http://127.0.0.1:3000/health').then(r => console.log(r.status)).catch(e => console.error(e.message))"
```

If the internal health call works, the application process and container port probably work. The remaining issue may sit on the host side, such as the wrong URL, a port conflict, a proxy, or a firewall rule. If the internal health call fails, the process may be alive while the service endpoint is still warming up, which leads into health checks in the last article of this group.

## Logging Habits That Help Later
<!-- section-summary: Useful container logs include startup configuration facts, readiness changes, request failures, and shutdown events while keeping secrets out. -->

Good container logs save time during incident response. For the ticketing API, a helpful startup log might include the app version, listening port, environment name, and whether optional dependencies connected. It should avoid printing full secrets, passwords, tokens, or private keys.

Here is a useful level of detail. The lines identify version, environment, listener, and dependency state while keeping secrets out:

```log
Booting tickets API version 2026.06.13
Runtime environment: development
HTTP server listening on 0.0.0.0:3000
Database connection pool ready for host postgres
```

Those lines help because they connect directly to Docker evidence. The port line can be compared with `docker ps` port mappings. The database line can be compared with environment and network settings. The version line helps when the team wonders whether the running container came from the image they just built.

Shutdown logs also matter. `docker stop` sends a signal to the main process, and a graceful app can log that it received the signal and closed connections. During local debugging, those lines separate a clean stop from a crash or a forceful kill.

## Where Inspection Usually Breaks
<!-- section-summary: Inspection gets confusing when evidence disappears, logs live in the wrong place, or live-shell expectations ignore the container state. -->

The first common problem is automatic cleanup. `docker run --rm` removes the container record after the process exits. That works well for one-off commands, and it takes away the state and saved metadata that help after a crash. For a new service run, a named container that stays around gives you more evidence.

The second problem is missing or quiet logs. If the app writes only to `/var/log/app.log`, `docker logs` may show almost nothing useful. Local teams can fix that by configuring the app logger to write to standard output and standard error, then letting Docker collect those streams.

The third problem is using `exec` as the first move. Exec answers live questions inside a running container. A startup crash needs the saved state, exit code, logs, and inspect output because the main process has already finished.

The fourth problem is reading the wrong container. A reused image name can create several old containers with similar names, and a generated name can hide the one you care about. `docker ps -a`, deliberate names, and labels in Compose all help the team keep evidence attached to the right run.

## What's Next

You now have a steady debugging path for a container that already exists. State tells you whether the main process lives. Logs show what the process said. Inspect shows the configuration Docker saved. Exec gives you a live view only after the process is still running.

The next article moves one level earlier. We will look at how Docker decides which command to start, how `CMD` and `ENTRYPOINT` work together, and how runtime arguments and environment variables shape the process before state and logs even exist.

---

**References**

- [Docker ps CLI reference](https://docs.docker.com/reference/cli/docker/container/ls/) - Documents container listing and the `--all` flag for stopped containers.
- [Docker logs CLI reference](https://docs.docker.com/reference/cli/docker/container/logs/) - Documents retrieving, tailing, following, and filtering container logs.
- [Docker inspect CLI reference](https://docs.docker.com/reference/cli/docker/inspect/) - Documents Docker's low-level JSON metadata output for Docker objects.
- [Docker exec CLI reference](https://docs.docker.com/reference/cli/docker/container/exec/) - Documents running a command inside a running container and the PID 1 requirement.
- [Docker run CLI reference](https://docs.docker.com/reference/cli/docker/container/run/) - Documents container creation flags, command overrides, environment values, and port publishing.
- [Docker stop CLI reference](https://docs.docker.com/reference/cli/docker/container/stop/) - Documents the signal and timeout behavior Docker uses when stopping a container.
