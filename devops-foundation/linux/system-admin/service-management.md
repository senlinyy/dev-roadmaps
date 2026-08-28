---
title: "Service Management"
description: "Manage system services with systemd, write your own unit files, and keep long-running processes alive across reboots and crashes."
overview: "Use systemd to run long-lived programs as managed Linux services, inspect state, restart safely, read logs, and set practical runtime guardrails."
tags: ["systemd", "systemctl", "services"]
order: 2
id: article-devops-foundation-linux-system-admin-service-management
---

## Table of Contents

1. [Why Does a Long-Running Program Need a Service Manager?](#why-does-a-long-running-program-need-a-service-manager)
2. [How Does systemd Supervise a Workload?](#how-does-systemd-supervise-a-workload)
3. [How Do Loaded, Enabled, Active, and Failed State Differ?](#how-do-loaded-enabled-active-and-failed-state-differ)
4. [How Does a Unit File Define the Service Process?](#how-does-a-unit-file-define-the-service-process)
5. [How Do Start, Stop, Enable, Restart, and Reload Differ?](#how-do-start-stop-enable-restart-and-reload-differ)
6. [How Do Dependencies, Service Types, and Readiness Shape Boot?](#how-do-dependencies-service-types-and-readiness-shape-boot)
7. [How Do the Journal, Exit Codes, and Signals Explain Failure?](#how-do-the-journal-exit-codes-and-signals-explain-failure)
8. [How Do Restart Policy, Resource Controls, and Timers Add Resilience?](#how-do-restart-policy-resource-controls-and-timers-add-resilience)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

You SSH into a server, run `node server.js`, see the health check return `ok`, and leave the terminal open because closing it feels risky. That instinct is correct. The program is running as a process under your shell, so a broken SSH session, a reboot, or a crash can leave the app down with no clear service owner.

A long-running server program needs the machine to take care of it. It needs the right user, the right working directory, the right environment variables, logs in a known place, startup after boot, and a decision about what happens after failure. On modern Linux servers, that kind of managed long-running program is usually run as a **service**.

Here is the fragile shape you want to notice:

```bash
ps -eo pid,ppid,user,stat,cmd --forest | grep -E "sshd|bash|node"

# Example output:
#    2309       1 root     Ss    sshd: deploy [priv]
#    2310    2309 deploy   Ss     \_ -bash
#    2601    2310 deploy   Sl         \_ node server.js
```

Keep these questions in view as you work through the lesson:

1. **Why Does a Long-Running Program Need a Service Manager?**
2. **How Does systemd Supervise a Workload?**
3. **How Do Loaded, Enabled, Active, and Failed State Differ?**
4. **How Does a Unit File Define the Service Process?**
5. **How Do Start, Stop, Enable, Restart, and Reload Differ?**
6. **How Do Dependencies, Service Types, and Readiness Shape Boot?**
7. **How Do the Journal, Exit Codes, and Signals Explain Failure?**
8. **How Do Restart Policy, Resource Controls, and Timers Add Resilience?**

## Why Does a Long-Running Program Need a Service Manager?
<!-- section-summary: Long-running programs need a manager because shell-launched processes can disappear, lose logs, or restart inconsistently. -->

The tree tells the story:

- `node server.js` is running as PID `2601`.
- Its parent is the shell with PID `2310`.
- That shell belongs to the SSH session.
- If the app should run all week, this is a fragile home for it.

The fix is to give the program a service manager. That manager starts it from written instructions, records logs, tracks the main PID, collects the exit status, and applies restart rules. The rest of the examples use a small Node app, but the same pattern applies to web servers, queue workers, agents, schedulers, and many databases.

## How Does systemd Supervise a Workload?
<!-- section-summary: systemd runs as PID 1 on many Linux servers and manages services from unit files. -->

The process lesson ended with PID `1`, the first parent on a modern server. For many Linux distributions, that parent is **systemd**. Instead of leaving a production process under your SSH shell, you ask systemd to start it and keep track of it.

systemd is the service manager. It reads service instructions, starts processes, groups related child processes, captures stdout and stderr in the journal, collects exit statuses, and exposes one main command family through `systemctl`.

Check what PID `1` is on the host:

```bash
ps -p 1 -o pid,ppid,user,stat,cmd

# Example output:
#     PID    PPID USER     STAT CMD
#       1       0 root     Ss   /sbin/init
```

On many systems, `/sbin/init` points to systemd:

```bash
readlink -f /sbin/init

# Example output:
# /usr/lib/systemd/systemd
```

Those checks matter because:

- PID `1` is the process that starts and manages many other system processes.
- systemd can keep service state after you close SSH.
- systemd gives operators consistent commands for status, start, stop, restart, logs, and boot setup.

Under the hood, systemd uses unit files, cgroups, and the journal. A **unit file** is the written instruction file. A **cgroup** lets systemd group and account for the service's process tree. The **journal** stores logs and systemd lifecycle messages. You do not need all internals at once. The command used every day is `systemctl`.

![Systemd supervision map infographic showing unit file, service process, restart policy, journal, dependencies, and timer scheduling](/content-assets/articles/article-devops-foundation-linux-system-admin-service-management/systemd-supervision-map.png)

_The image shows systemd as the supervisor that connects unit instructions, process state, logs, and schedules._

## How Do Loaded, Enabled, Active, and Failed State Differ?
<!-- section-summary: `systemctl status` shows whether systemd thinks a service is running, failed, enabled, and which process it manages. -->

When a service feels unhealthy after a deploy, restarting immediately can erase useful clues. Ask systemd what it sees first. Status shows whether the service is active, failed, restarting, disabled for boot, or attached to a different main PID than expected.

Use `systemctl status` as the first look:

```bash
systemctl status app.service --no-pager

# Example output:
# app.service - Application service
#      Loaded: loaded (/etc/systemd/system/app.service; enabled; preset: enabled)
#      Active: active (running) since Wed 2026-06-24 10:18:36 UTC; 24min ago
#    Main PID: 1842 (node)
#       Tasks: 18
#      Memory: 286.4M
#         CPU: 34.221s
#      CGroup: /system.slice/app.service
#              `-1842 /usr/bin/node /srv/app/current/server.js
```

The important lines are practical:

- `Loaded` shows the unit file path and whether the service is enabled for boot.
- `Active` shows the current service state from systemd's view.
- `Main PID` connects the service to the live process table.
- `Memory` and `CPU` give a quick resource hint.
- `CGroup` shows the process tree systemd is tracking for this service.

Check boot enablement by itself:

```bash
systemctl is-enabled app.service

# Example output:
# enabled
```

That output means systemd has boot-time links for this service. It does not prove the service is running right now, so pair it with `status` when you care about current state.

The common control commands look like this:

```bash
sudo systemctl start app.service
sudo systemctl stop app.service
sudo systemctl restart app.service
sudo systemctl reload nginx
```

These commands often print no output on success. Always follow a change with `status`, a health check, or logs, because systemd can accept the start request and the application can fail a few seconds later due to a missing environment variable, a bad port, or a permission error.

Before those commands can work for your custom app, systemd needs written instructions. That instruction file is the unit file.

## How Does a Unit File Define the Service Process?
<!-- section-summary: A service unit file records the command, user, directory, environment, dependencies, and lifecycle policy for a service. -->

If an operator has to ask "Which command starts this app?" the service is already too dependent on memory. The command, user, directory, environment file, and restart policy should live in a reviewed file so the service starts the same way after every deploy and reboot.

A **service unit file** is the instruction sheet systemd follows for one service. It says what command starts, which Linux user runs it, where it starts from, which environment file it reads, and how systemd should treat failures.

A local application unit can live at `/etc/systemd/system/app.service`:

```ini
[Unit]
Description=Example application service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=app
Group=app
WorkingDirectory=/srv/app/current
EnvironmentFile=/srv/app/config.env
ExecStart=/usr/bin/node /srv/app/current/server.js
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Walk through the file in small pieces:

- `[Unit]` holds the service description and startup relationship lines.
- `Description=` is the human label shown in status output.
- `After=network-online.target` orders the app after the network-online target.
- `Wants=network-online.target` asks systemd to include that target in the startup transaction.
- `[Service]` holds the process instructions.
- `User=app` and `Group=app` run the service with a dedicated account.
- `WorkingDirectory=/srv/app/current` sets the directory for relative paths.
- `EnvironmentFile=/srv/app/config.env` loads runtime settings before start.
- `ExecStart=` is the command systemd launches.
- `Restart=on-failure` and `RestartSec=5s` define basic recovery behavior.
- `[Install]` holds boot enablement instructions.
- `WantedBy=multi-user.target` connects the service to the normal server boot state when enabled.

`Type=simple` means the process started by `ExecStart` is the main service process. That fits many web apps and workers. Programs that fork, run one short task, or notify systemd when ready may need a different type, so match `Type=` to how the program actually starts.

After you create or edit a unit file, ask systemd to reload unit definitions:

```bash
sudo systemctl daemon-reload
```

This command often prints no output. It refreshes systemd's view of unit files. It does not restart the running app by itself, so a changed command, environment file path, or limit still needs the right service action after the reload.

The unit file now points at two setup details that deserve their own look: the environment file and working directory.

### How Do Identity, Environment, and Working Directory Become Process State?
<!-- section-summary: Environment files and working directories make service runtime settings explicit and repeatable. -->

A common service surprise happens after reboot. The app worked when someone exported `PORT=3000` in a shell, but systemd starts it later without that shell's variables. The process launches, then fails because `DATABASE_URL`, `PORT`, or `LOG_LEVEL` is missing.

Environment variables are settings passed into a process at start. Applications often read `NODE_ENV`, `PORT`, `DATABASE_URL`, and `LOG_LEVEL` from the environment. systemd can load those settings from a file so every service start uses the same setup.

An environment file for the app might look like this:

```ini
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgres://app@db.internal:5432/app
```

Each line is part of the process setup:

- `NODE_ENV=production` tells the app to use production behavior.
- `PORT=3000` tells the app which local port to bind.
- `LOG_LEVEL=info` keeps normal production logging at a manageable level.
- `DATABASE_URL=...` points the app at its database and may contain sensitive connection details.

The unit file points to the environment file:

```ini
EnvironmentFile=/srv/app/config.env
```

That one line has a few operational consequences:

- `EnvironmentFile=` belongs in the `[Service]` section of the unit.
- `/srv/app/config.env` should exist before the service starts.
- Changes to this file affect the next process start, so restart the service after editing it.

Protect the file because it may contain secrets:

```bash
sudo chown root:app /srv/app/config.env
sudo chmod 640 /srv/app/config.env
```

These commands often print no output when they succeed:

- `chown root:app` keeps root as the file owner and lets the `app` group read it.
- `chmod 640` allows the owner to read and write, allows the group to read, and blocks everyone else.
- The service account should get only the access it needs through group membership.

Confirm permissions:

```bash
ls -l /srv/app/config.env

# Example output:
# -rw-r----- 1 root app 122 Jun 24 10:12 /srv/app/config.env
```

The permission line confirms the protection:

- `root app` shows root owns the file and the `app` group can read it.
- `rw-r-----` matches mode `640`.
- The file path at the end confirms you checked the intended environment file.

The working directory is the other setup detail beginners often miss. Many applications use relative paths for templates, migrations, static files, or local config. Setting `WorkingDirectory=/srv/app/current` makes those relative paths start from the release directory rather than from whatever directory a human shell happened to use.

After changing an environment file, restart the service:

```bash
sudo systemctl restart app.service
```

This often prints no output when systemd accepts the restart request:

- `restart` stops the current process and starts a new one.
- The new process reads the current environment file.
- Follow with `systemctl status app.service --no-pager` or a health check because the start request can succeed before the app finishes booting.

If you need to prove the running process received one setting, inspect a narrow value from `/proc`:

```bash
pid=$(systemctl show -p MainPID --value app.service)
sudo tr '\0' '\n' < "/proc/${pid}/environ" | grep '^NODE_ENV='

# Example output:
# NODE_ENV=production
```

That check is intentionally narrow because environment output can contain secrets. Prefer logs, health checks, or config review for normal verification, and avoid pasting full environment dumps into tickets.

Now that the service has written setup instructions, the next beginner trap is command verbs. Starting a service right now and enabling it for the next reboot are separate actions.

## How Do Start, Stop, Enable, Restart, and Reload Differ?
<!-- section-summary: systemd verbs affect different parts of service life, so choose the verb that matches the change. -->

You run `sudo systemctl start app.service`, the app works, and the next reboot removes it from the running system. Nothing mysterious happened. `start` launched it for the current boot, but `enable` was the command that would have connected it to future boots.

`start` changes current runtime state. `enable` changes boot setup. `restart` replaces the running process. `reload` asks a running service to reread config if that service supports reload behavior.

Use this table as the plain-English map:

| Command | What it changes |
|---|---|
| `start` | Launches a stopped service during the current boot |
| `stop` | Stops a running service during the current boot |
| `restart` | Stops the current process and starts a fresh one |
| `reload` | Asks a running service to reread config, if supported |
| `enable` | Connects the unit to boot so it starts after reboot |
| `disable` | Removes the boot connection |
| `daemon-reload` | Refreshes systemd's view of unit files |

After creating a new unit, use a clear first-start flow:

```bash
sudo systemctl daemon-reload
sudo systemctl enable app.service
sudo systemctl start app.service
```

Example output from the enable step:

```console
Created symlink /etc/systemd/system/multi-user.target.wants/app.service -> /etc/systemd/system/app.service.
```

The output tells you:

- systemd created a boot-time link under `multi-user.target.wants`.
- The unit is now enabled for normal server boot.
- `enable` did not prove the process is healthy right now, so status still comes next.

Verify current runtime state:

```bash
systemctl status app.service --no-pager
curl --fail --silent --show-error http://127.0.0.1:3000/health

# Example output:
# app.service - Application service
#      Loaded: loaded (/etc/systemd/system/app.service; enabled; preset: enabled)
#      Active: active (running) since Wed 2026-06-24 10:18:36 UTC; 6s ago
#    Main PID: 1842 (node)
#
# ok
```

That combined check answers two questions:

- `Active: active (running)` says systemd sees the service as running.
- `enabled` in `Loaded` says boot setup exists.
- `ok` says the application health endpoint responds locally.

For a unit file change, refresh systemd and restart the app:

```bash
sudo systemctl daemon-reload
sudo systemctl restart app.service
systemctl status app.service --no-pager
journalctl -u app.service -n 20 --no-pager

# Example output:
# app.service - Application service
#      Active: active (running) since Wed 2026-06-24 10:30:04 UTC; 4s ago
#
# Jun 24 10:30:04 web-01 systemd[1]: Started app.service - Application service.
# Jun 24 10:30:05 web-01 app[1901]: listening on 127.0.0.1:3000
```

The status and journal together give you both state and evidence. `restart` may return before the application has finished warming up, so pair it with logs and a health check.

For Nginx config, validate first and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx

# Example output:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
```

This is the safer path for Nginx:

- `nginx -t` checks syntax before changing the live service.
- `reload` asks Nginx to use its graceful config reload behavior.
- Application code deploys more often need `restart`, because the process must start from the new release.

After verbs, the next confusion point is boot timing. A service may have the right command and still fail because it starts too early.

![Safe systemd change loop infographic showing edit unit, daemon-reload, restart service, check status, read journal, and enable timer](/content-assets/articles/article-devops-foundation-linux-system-admin-service-management/safe-systemd-change-loop.png)

_The image turns service changes into a verification loop rather than a one-command guess._

## How Do Dependencies, Service Types, and Readiness Shape Boot?
<!-- section-summary: Dependencies pull units into startup, while ordering controls which units run earlier during boot. -->

The app can work when you start it by hand at 10:00, then fail during reboot at 03:00. By the time you log in, the network is up, so the failure feels confusing. During boot, the service may have started before the network-online target or another local unit was ready.

Here is a concrete boot story. The VM restarts after a kernel update. `app.service` launches as soon as basic system services are ready. The Node process immediately tries to bind to `127.0.0.1:3000` and connect to a local sidecar that prepares credentials. The sidecar unit starts a few seconds later. The app exits with a missing credentials error, systemd retries it, and users see a short `502` window through Nginx.

A longer sleep in the app script is a fragile fix. systemd needs written relationships so boot has the same shape every time. Those relationships have a few names:

- A **dependency** pulls another unit into the same startup transaction. It answers "should systemd also bring this unit into the plan?"
- **Ordering** controls sequence for units already in that plan. It answers "which one should run earlier?"
- A **target** is a named group or milestone. `multi-user.target` is the normal multi-user server state, and `network-online.target` represents the system's idea that network setup has completed.
- `Wants=` is a gentle dependency. It asks systemd to include another unit, while still allowing your unit to continue if that wanted unit fails.
- `Requires=` is a hard dependency. If the required unit fails to start, your unit also fails.
- `After=` is ordering. It waits for the named unit's startup job to finish before this unit starts, but it does not pull that unit into the plan by itself.

For a networked app, use both a dependency and ordering because each line answers a different question:

```ini
After=network-online.target
Wants=network-online.target
```

The two lines do different jobs:

- `Wants=network-online.target` asks systemd to include the network-online target in the startup transaction.
- `After=network-online.target` orders the application after that target has been reached.
- `Requires=` is stricter and can stop the dependent unit when the required unit fails, so reserve it for hard local dependencies.

For a local credential sidecar, the relationship may be stricter:

```ini
Requires=credential-sidecar.service
After=credential-sidecar.service
```

Those lines say the app needs the sidecar and should run after it. Use this for local services that are part of the same host design. For remote databases, queues, or APIs, the application should still retry after it starts, because systemd cannot prove a remote service will stay healthy.

Targets also explain enablement. Server boot usually heads toward `multi-user.target`, while scheduled systemd jobs live under `timers.target`. Enabling a service creates a relationship from a target to that service, which is why the earlier enable output created a symlink under `multi-user.target.wants`.

Inspect dependencies:

```bash
systemctl list-dependencies --plain app.service

# Example output:
# app.service
# |-network-online.target
# `-system.slice
```

The output gives a quick relationship check:

- `network-online.target` appears under the service, so the target is part of the transaction.
- `system.slice` shows the service belongs in the normal system service slice.
- Missing expected local units here can explain boot-time races.

Show the active unit definition and drop-ins:

```bash
systemctl cat app.service

# Example output:
# # /etc/systemd/system/app.service
# [Unit]
# Description=Example application service
# After=network-online.target
# Wants=network-online.target
#
# [Service]
# ExecStart=/usr/bin/node /srv/app/current/server.js
```

The displayed unit answers practical questions:

- The comment line shows the file path systemd loaded.
- The `[Unit]` lines show the current dependency and ordering settings.
- The `[Service]` line confirms the command systemd launches.
- `systemctl cat` also shows drop-in override files under `/etc/systemd/system/app.service.d/` when they exist.

Boot ordering helps with local startup sequence. Your application should still retry databases, APIs, and queues after it starts, because a target reached during boot does not prove every external dependency stays healthy forever.

Once boot timing is written down, logs are the next place to check whether the service followed the path you expected.

## How Do the Journal, Exit Codes, and Signals Explain Failure?
<!-- section-summary: `journalctl` filters service logs by unit, time, priority, and boot so failures have evidence attached to them. -->

A failed service start usually leaves a trail. The app may be missing an environment variable, trying to bind a port that is already in use, failing a permission check, or crashing after a stack trace. `journalctl -u app.service` keeps that evidence tied to the service.

Think of the journal as the service notebook. systemd records lifecycle messages there, and it also captures stdout and stderr from services unless the unit sends logs somewhere else.

Show the latest entries:

```bash
journalctl -u app.service -n 20 --no-pager

# Example output:
# Jun 24 10:30:04 web-01 systemd[1]: Started app.service - Application service.
# Jun 24 10:30:05 web-01 app[1901]: listening on 127.0.0.1:3000
# Jun 24 10:30:07 web-01 app[1901]: request_id=req_7J2 path=/health status=200 duration_ms=7
```

The lines answer different questions:

- The `systemd[1]` line says systemd started the unit.
- The `app[1901]` line includes the service process name and PID.
- The health request line proves the app handled at least one local request.

Follow logs live:

```bash
journalctl -u app.service -f

# Example output:
# Jun 24 10:31:12 web-01 app[1901]: request_id=req_7K1 path=/api/items status=200 duration_ms=44
# Jun 24 10:31:18 web-01 app[1901]: request_id=req_7K2 path=/api/items status=200 duration_ms=39
```

Live follow is useful during a restart, deploy, or config change. Keep it in a separate terminal, make the change in another terminal, then watch what the service actually reports.

Look at a deploy window:

```bash
journalctl -u app.service --since "30 minutes ago" --no-pager

# Example output:
# Jun 24 10:18:31 web-01 systemd[1]: app.service: Main process exited, code=killed, status=9/KILL
# Jun 24 10:18:36 web-01 systemd[1]: Started app.service - Application service.
# Jun 24 10:18:37 web-01 app[1842]: listening on 127.0.0.1:3000
```

The windowed query helps when you know roughly when the incident started. It avoids mixing old boot logs, previous deploys, and unrelated messages into the same screen.

Filter to warnings and higher:

```bash
journalctl -u app.service -p warning --since "today" --no-pager

# Example output:
# Jun 24 09:58:12 web-01 app[1842]: level=warning path=/api/reports/export duration_ms=12004 message="request exceeded slow threshold"
# Jun 24 10:18:31 web-01 systemd[1]: app.service: Main process exited, code=killed, status=9/KILL
```

Priority filtering is useful after you already know the service name. Do not rely on it as the only view, because an application may log useful context at `info` right before a warning appears.

Limit to the current boot:

```bash
journalctl -u app.service -b --no-pager

# Example output:
# Jun 24 08:01:22 web-01 systemd[1]: Started app.service - Application service.
# Jun 24 08:01:23 web-01 app[1204]: listening on 127.0.0.1:3000
```

If a service is crash-looping, the journal usually shows repeated start attempts, stack traces, missing variables, permission errors, or port binding failures. Those repeated lines lead naturally into restart policy and guardrails.

## How Do Restart Policy, Resource Controls, and Timers Add Resilience?
<!-- section-summary: Restart rules, resource limits, and timers give services recovery behavior, safety boundaries, and scheduled execution. -->

A production service needs three different kinds of written behavior. First, it needs a recovery rule for normal crashes. Second, it needs resource boundaries so one bad process cannot consume the whole host. Third, scheduled jobs need the same ownership and logging as long-running services. Keep those three ideas separate while you read a unit file.

The restart story usually starts with a pager at night. The app exits once because a dependency returned a temporary error. A human should not have to SSH in and type `systemctl start app.service`. A **restart policy** tells systemd which exits deserve another attempt.

For a small web service, `Restart=on-failure` is a common starting point. It asks systemd to retry after a nonzero exit code, a signal failure, a timeout, or a watchdog failure. A clean operator stop through `systemctl stop` stays stopped, which prevents systemd from fighting an intentional maintenance action.

```ini
[Service]
Restart=on-failure
RestartSec=5s
```

Those two lines set the basic recovery behavior:

- `Restart=on-failure` restarts the service after failure exits, signals, timeouts, and watchdog failures.
- A clean `systemctl stop app.service` does not count as a failure.
- `RestartSec=5s` waits five seconds before trying again, which avoids an immediate tight loop.

Check the live restart settings systemd loaded:

```bash
systemctl show app.service -p Restart -p RestartUSec -p NRestarts

# Example output:
# Restart=on-failure
# RestartUSec=5s
# NRestarts=1
```

The output connects the config to runtime behavior:

- `Restart=on-failure` confirms the policy systemd loaded.
- `RestartUSec=5s` confirms the wait between attempts.
- `NRestarts=1` says systemd has already restarted this unit once during the current lifetime.

A service that retries forever can hide the first useful error and burn CPU. Rate limiting says how many starts are acceptable in a window before systemd pauses the unit in a failed state:

```ini
[Unit]
StartLimitIntervalSec=60
StartLimitBurst=5
```

These lines limit repeated restarts:

- `StartLimitIntervalSec=60` sets the sixty-second window.
- `StartLimitBurst=5` allows five starts inside that window.
- After the limit is hit, the service enters a failed state so an operator can inspect logs rather than letting the machine spin forever.

Check the failed state:

```bash
systemctl status app.service --no-pager

# Example output:
# app.service - Application service
#      Loaded: loaded (/etc/systemd/system/app.service; enabled; preset: enabled)
#      Active: failed (Result: start-limit-hit) since Wed 2026-06-24 10:36:12 UTC; 12s ago
```

The failed status points to the restart loop guard:

- `Active: failed` says systemd stopped trying for now.
- `Result: start-limit-hit` says the start-rate limit was reached.
- The next useful evidence is the unit journal around the first failure, before repeated retries filled the timeline.

Query the journal around the first failed attempt:

```bash
journalctl -u app.service --since "10 minutes ago" --no-pager

# Example output:
# Jun 24 10:35:42 web-01 app[2031]: Error: missing DATABASE_URL
# Jun 24 10:35:42 web-01 systemd[1]: app.service: Main process exited, code=exited, status=1/FAILURE
# Jun 24 10:36:12 web-01 systemd[1]: app.service: Start request repeated too quickly.
```

Those lines tell you the restart loop is a symptom. The root cause is the missing `DATABASE_URL`. Fix the configuration first, then clear the failed marker.

After fixing the issue, clear the failed state and start again:

```bash
sudo systemctl reset-failed app.service
sudo systemctl start app.service
```

These commands often print no output when they succeed:

- `reset-failed` clears systemd's failed marker for the unit.
- `start` launches the service again after the root cause has been fixed.
- Use this after the fix, because clearing the state alone does not solve a bad config or broken binary.

Then inspect status and logs:

```bash
systemctl status app.service --no-pager
journalctl -u app.service -n 20 --no-pager

# Example output:
# app.service - Application service
#      Active: active (running) since Wed 2026-06-24 10:38:02 UTC; 6s ago
#
# Jun 24 10:38:02 web-01 systemd[1]: Started app.service - Application service.
# Jun 24 10:38:03 web-01 app[2044]: listening on 127.0.0.1:3000
```

The combined check confirms state and evidence:

- `Active: active (running)` says systemd sees the service as live.
- The journal line from systemd confirms the start event.
- The application log line confirms the app reached its listening state.

The second idea is resource boundaries. A service may have a memory leak, a runaway export job, or too many open sockets. A **resource limit** gives the service a boundary before it crowds out the rest of the host.

Pick limits from observed behavior. Suppose normal memory is around `220M`, busy traffic peaks near `380M`, and the VM has other services that also need room. `MemoryMax=512M` leaves some headroom while still stopping a runaway process. Suppose the app should never use a full CPU core forever on a small VM. `CPUQuota=80%` caps sustained CPU time for the service. Suppose Nginx or the app accepts many connections. `LimitNOFILE=8192` raises the maximum open files and sockets above a small default.

```ini
[Service]
MemoryMax=512M
CPUQuota=80%
LimitNOFILE=8192
```

These guardrails apply at service start:

- `MemoryMax=512M` caps memory for the service cgroup.
- `CPUQuota=80%` limits the service to less than one full CPU core of sustained CPU time.
- `LimitNOFILE=8192` sets the maximum open-file count the process receives.

These guardrails use different Linux mechanisms:

- `MemoryMax=512M` applies to the service cgroup, so child processes count too.
- `CPUQuota=80%` limits sustained CPU consumption for the whole unit.
- `LimitNOFILE=8192` sets the soft and hard open-file limit the process receives at start.

After changing these settings, reload systemd and restart the service so the running process receives the new values:

```bash
sudo systemctl daemon-reload
sudo systemctl restart app.service
```

These commands often print no output on success:

- `daemon-reload` tells systemd to reread unit files and drop-ins.
- `restart` replaces the old process, which matters for limits such as `LimitNOFILE`.
- A reload inside the app may not update process limits because the same process can keep running.

Verify open-file limits from the running process:

```bash
pid=$(systemctl show -p MainPID --value app.service)
grep "Max open files" "/proc/${pid}/limits"

# Example output:
# Max open files            8192                 8192                 files
```

That output connects the unit setting to the live process:

- The soft and hard open-file limits both show `8192`.
- The value matches `LimitNOFILE=8192` from the unit.
- A mismatch means the service may need a restart, a daemon reload, or a check for override files.

Check memory and CPU settings through systemd too:

```bash
systemctl show app.service -p MemoryMax -p CPUQuotaPerSecUSec

# Example output:
# MemoryMax=536870912
# CPUQuotaPerSecUSec=800ms
```

The values use systemd's internal units:

- `536870912` bytes is `512M`.
- `800ms` of CPU time per second is an `80%` CPU quota.
- If these values still show `infinity`, systemd did not load the limit you expected.

The third idea is scheduled work. A cleanup script can work during testing and then never run after reboot because it lived only in someone's shell history. A **timer unit** gives scheduled work a systemd owner, schedule, status, logs, and enablement path.

A timer uses two units. The service unit says what command runs. The timer unit says when to run it.

The service side is usually `Type=oneshot`. That tells systemd to run the command, wait for it to finish, record the exit status, and then consider the job complete. Use this for cleanup scripts, report exports, certificate renewal hooks, and backup triggers that do a finite piece of work.

```ini
[Unit]
Description=Clean old application releases

[Service]
Type=oneshot
ExecStart=/srv/app/scripts/cleanup-releases.sh
User=deploy
Group=app
```

The service unit describes the job:

- `Type=oneshot` tells systemd the command runs to completion.
- `ExecStart=/srv/app/scripts/cleanup-releases.sh` is the cleanup command.
- `User=deploy` and `Group=app` run the job with a predictable account and group.
- The job's output goes to the journal, so `journalctl -u app-cleanup.service` can show what happened.

Test the service once before adding the schedule:

```bash
sudo systemctl start app-cleanup.service
journalctl -u app-cleanup.service -n 20 --no-pager

# Example output:
# Jun 24 10:41:02 web-01 systemd[1]: Starting app-cleanup.service - Clean old application releases...
# Jun 24 10:41:03 web-01 cleanup-releases.sh[2214]: removed 2 old releases
# Jun 24 10:41:03 web-01 systemd[1]: app-cleanup.service: Deactivated successfully.
```

That check proves the command, account, permissions, and journal path work before a timer runs it unattended.

The timer side describes the schedule. `OnCalendar=` uses calendar time, and `Persistent=true` handles missed runs after downtime. For example, if the VM is powered off at `03:30` and boots at `06:10`, `Persistent=true` lets systemd run the missed job soon after boot instead of waiting for the next day.

```ini
[Unit]
Description=Run application release cleanup daily

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

The timer unit describes the schedule:

- `OnCalendar=*-*-* 03:30:00` schedules the job daily at 03:30.
- `Persistent=true` lets systemd run a missed job after boot if the machine was off at the scheduled time.
- `WantedBy=timers.target` connects the timer to the normal timer startup path when enabled.

Enable the timer now and for future boots:

```bash
sudo systemctl enable --now app-cleanup.timer

# Example output:
# Created symlink /etc/systemd/system/timers.target.wants/app-cleanup.timer -> /etc/systemd/system/app-cleanup.timer.
```

The enable output shows the timer relationship:

- The symlink under `timers.target.wants` means the timer is enabled for future boots.
- The `--now` flag also starts the timer during the current boot.
- The target path confirms the timer joins the normal systemd timer group.

Inspect the timer:

```bash
systemctl list-timers app-cleanup.timer

# Example output:
# NEXT                        LEFT LAST PASSED UNIT              ACTIVATES
# Thu 2026-06-25 03:30:00 UTC 16h  -    -      app-cleanup.timer app-cleanup.service
```

The timer table shows scheduling and ownership:

- `NEXT` and `LEFT` show the next planned run.
- `UNIT` is the timer that wakes up on the schedule.
- `ACTIVATES` is the service unit the timer runs.
- Empty `LAST` and `PASSED` values mean this timer has not run yet in the shown period.

Check the job logs:

```bash
journalctl -u app-cleanup.service --since "today" --no-pager

# Example output:
# Jun 24 03:30:02 web-01 systemd[1]: Starting app-cleanup.service - Clean old application releases...
# Jun 24 03:30:03 web-01 cleanup-releases.sh[1880]: removed 2 old releases
# Jun 24 03:30:03 web-01 systemd[1]: app-cleanup.service: Deactivated successfully.
```

The job log confirms the full run:

- The first line shows systemd starting the scheduled service.
- The script line shows the useful application-level result.
- `Deactivated successfully` means the oneshot service finished cleanly.

The same service habits apply to scheduled work. A production cleanup, report export, certificate renewal, or backup trigger should have written instructions, logs, ownership, and failure visibility. Personal one-off commands can stay in your shell.

### Why Is a Service More Than One PID?

A service is a managed workload and may contain a main process, workers, helpers, and short-lived children. systemd places those processes in a cgroup so it can account for and act on the group even when ancestry changes. This is why stopping the unit is normally more reliable than killing one PID: the manager knows which processes belong to the declared workload and which policy should follow their exit.

The unit is the general abstraction. Service units manage processes, socket units manage listening endpoints, timer units schedule activation, mount units represent mounts, and target units group or synchronize other units. A common dependency and state model lets systemd build a boot transaction instead of executing one long serial startup script.

`systemctl` is a client that asks the systemd manager to inspect or change unit state. The command does not directly become the service process. The manager loads configuration, resolves dependencies and ordering, creates the execution environment, starts the workload, records the result, and maintains state after the caller disconnects.

System-level and user-level managers are separate. `systemctl --user` talks to a per-user service manager, while ordinary `systemctl` normally talks to the system manager. A user service still has declared lifecycle and logs; it simply runs in the user's manager and authority boundary. Do not confuse it with an untracked shell background job.

### How Should You Read systemd State?

Loaded means systemd found and parsed a unit definition. Enabled means installation links or equivalent activation configuration arrange for future startup through a target or another trigger. Active describes the current runtime state. Failed is a remembered result. These dimensions answer different questions.

An enabled service can be inactive because it was stopped, failed, or has not reached its activation condition. A disabled service can be active because an operator started it manually or another unit, socket, timer, or dependency activated it. A unit can be active without a permanent process: a successful `Type=oneshot` unit may remain logically active, and a mount or target unit is not a daemon.

Use focused checks:

```bash
systemctl is-enabled app.service
systemctl is-active app.service
systemctl is-failed app.service
systemctl show app.service -p LoadState -p UnitFileState -p ActiveState -p SubState -p Result
```

`list-units` shows units currently known in memory, while `list-unit-files` describes installed unit-file enablement. Omitting `.service` works in contexts where systemd can infer the type, but explicit suffixes make automation and mixed unit types clearer.

Masking is stronger than disabling. A masked unit cannot be started through the ordinary path because its definition is linked to an unusable target such as `/dev/null`. Disable removes future enablement links but does not prevent manual or dependency activation. Use a mask only when the operational intention is to block activation, and document why.

Package presets can express distribution or organizational defaults above one machine's current enablement. Installing a package can add or update unit files without making the service active in the way an operator expects. Package management installs code and definitions; service management controls runtime state. Updating a binary may require a restart because reload generally cannot replace already-mapped executable code.

### How Do Unit Definitions Become Effective Configuration?

Vendor units commonly live under `/usr/lib/systemd/system` or `/lib/systemd/system`; local administrator units and overrides live under `/etc/systemd/system`. Editing a vendor file directly risks losing the change during a package update and hides the local difference. `systemctl edit app.service` creates a drop-in override, while `systemctl cat app.service` and `systemctl show` reveal the combined view.

After changing unit files, `systemctl daemon-reload` tells the manager to reread definitions. It does not restart the service. Restart or reload the workload separately when the intended change requires it, then inspect the effective definition and runtime state.

`ExecStart=` is normally parsed by systemd rather than passed through an implicit interactive shell. Shell metacharacters such as `|`, `>`, variable syntax, or `&&` do not automatically have shell meaning. This reduces quoting ambiguity and makes the executable explicit. If a real shell program is required, put reviewed logic in a script or invoke the chosen shell deliberately.

`ExecStartPre=` can validate or prepare before the main command; `ExecStart=` launches the workload; `ExecStop=` can define a documented stop operation. A pre-command that succeeds does not remain as the service, and a failing required pre-command prevents the main start. Keep preparation bounded and observable rather than building a hidden deployment system into many unit directives.

Identity and directory settings become inherited process state. `User=`, `Group=`, `SupplementaryGroups=`, `WorkingDirectory=`, `Environment=`, and `EnvironmentFile=` replace assumptions inherited from a human shell. An absolute executable path avoids dependence on an interactive `PATH`. Explicit writable directories and permissions keep the service from requiring root.

Environment files separate deployment configuration from unit mechanics, but ordinary environment variables are visible through privileged process inspection and are not automatically a secret store. Credentials need restrictive file permissions or a supported systemd credential mechanism. Do not put passwords directly into world-readable units or command-line arguments.

`systemctl show app.service -p User -p Group -p WorkingDirectory -p EnvironmentFiles -p ExecStart` lets you compare declared state with the manual command that works. The common “manual succeeds, unit fails” causes are a different user, group, directory, environment, PATH, permissions, sandbox, or daemonization behavior—not evidence that the service should run as root.

### How Do Lifecycle Commands Express Different Intentions?

Start requests active state now. Stop requests inactive state now. Enable configures future activation; disable removes that configuration. `enable --now` combines two independent requests, and `disable --now` combines removal from future activation with a current stop.

Restart performs a stop-and-start lifecycle and can interrupt in-flight work, drop connections, or replace memory state. Reload asks a running service to reread supported configuration without a full process replacement. Reload exists only when the application and unit define meaningful reload behavior. `reload-or-restart` chooses reload when supported and otherwise restarts, but the operator still needs to understand the availability effect.

Configuration and binary changes differ. Nginx can validate a candidate configuration and reload workers gracefully. A new application binary normally requires a restart to execute the new code. A changed environment also usually requires process replacement because a parent-provided environment is fixed when the process begins.

Stopping sends the configured signal, commonly SIGTERM, and allows the declared timeout. If the workload does not exit, systemd may escalate according to policy. This protocol lets applications drain and clean up. Repeatedly using `kill -9` bypasses it and can cause the manager to restart the workload because an unexpected forced exit matches the restart rule.

### How Do Dependencies and Readiness Stay Separate?

Dependency and ordering answer different questions. `Wants=` or `Requires=` pulls another unit into the transaction with weaker or stronger requirement semantics. `After=` says this unit's start action should be ordered after another unit's start action. `After=` alone does not cause the other unit to start, and it does not mean the other service remains healthy forever.

`Before=` and `After=` describe ordering edges, not duration. systemd can start unrelated units in parallel because only real ordering relationships constrain the graph. Over-ordering slows boot and creates brittle assumptions. Describe actual requirements rather than a desired-looking sequence.

Targets group or synchronize units. The default target identifies the normal boot goal. Network startup illustrates the boundary: a network management unit can be started before DNS, routes, a lease, or a remote dependency is actually usable. `network-online.target` can improve ordering when correctly implemented, but it cannot guarantee that an external API remains reachable. Applications still need connection timeouts, retry, and recovery.

Service type tells systemd what “started” means. `Type=simple` treats the foreground process as the service after execution. This is a good fit for modern daemons that remain in the foreground. `Type=forking` supports programs that daemonize and requires reliable main-process identification. `Type=oneshot` models bounded work. `Type=notify` lets a service explicitly tell systemd when initialization has reached readiness.

Process start, manager-active state, and application readiness are different. `systemctl start` can succeed before the application can serve a request under simple semantics. Operational verification must test the promised interface: a listening socket, health request, queue subscription, or completed output. Dependencies cannot substitute for application health checks and retry behavior.

Socket activation separates endpoint availability from process lifetime. systemd can own a listening socket and start the service when traffic arrives, passing the descriptor to it. This can reduce boot-order coupling because the endpoint can exist before the service finishes starting. It also reinforces that an active unit need not correspond to one continuously running process.

### How Does Evidence Explain a Failed Unit?

A failed service has at least two perspectives: the manager's lifecycle view and the application's own output. `systemctl status` summarizes load state, active state, main PID, recent result, cgroup, and a short log tail. `journalctl -u app.service -b` gives the full unit evidence for the current boot.

Use an exact window around the failure and include manager messages:

```bash
systemctl status app.service --no-pager -l
journalctl -u app.service -b --since '10 minutes ago' --no-pager
systemctl show app.service -p Result -p ExecMainCode -p ExecMainStatus -p NRestarts
```

Exit codes feed the state machine. An exit status the unit declares successful can produce clean inactive state; another status or signal can produce failed state and trigger restart policy. The journal may show both application text and systemd's explanation of how the process ended. Neither view alone necessarily contains the whole cause.

Debug before restart loops erase context. Inspect the first failure, effective unit, identity, paths, permissions, environment, executable, dependency state, and cgroup. Run a syntax or config validator as the service identity where possible. A restart may restore availability, but preserve the evidence that distinguishes bad configuration, permission failure, missing dependency, resource limit, signal, or application bug.

### How Do Policy and Scheduling Protect the Host?

Restart policy handles selected exits. `Restart=on-failure` commonly retries unexpected failures while leaving a clean stop alone; `always` also restarts clean exits and may be wrong for bounded work. `RestartSec=` prevents immediate churn. Start-rate limits bound repeated attempts so a fast crash does not consume CPU and flood logs indefinitely.

A supervisor can turn a transient bug into a persistent restart storm. Track restart count, first failure, and backoff. The policy should provide recovery time without hiding a deterministic error that needs intervention.

Resource controls express the service's share and boundary. `MemoryMax=` can contain memory damage to the unit; CPU weight sets relative preference under contention, while a quota can impose a harder CPU ceiling. `LimitNOFILE=` controls file-descriptor capacity inherited by the process. Limits protect the rest of the machine but can also be the immediate reason an application fails, so expose them in monitoring and logs.

Hardening can narrow authority further with filesystem protection, private temporary directories, restricted address families, capabilities, or system-call policy. `User=` is the beginning, not the entire sandbox. Add controls incrementally and test the real application path; a correctly blocked write still looks like a permission failure to the application.

Timers activate separate service units because scheduling and work have different responsibilities. The timer owns calendar or monotonic timing; the service owns identity, command, resources, status, and logs. A oneshot service can run, finish, and become inactive until the next timer event without keeping a sleeping daemon alive.

This produces one production lifecycle: install code, define or override a unit, verify effective configuration, reload the manager, start and test, enable intended future activation, observe logs and health, apply bounded restart and resource policy, deploy through validated reload or restart, and stop cleanly during maintenance or shutdown. Service management is policy applied to processes across the workload's whole lifetime.

### What Does a First-Principles Service Definition Need?

Begin with the workload contract, not copied directives. Name the executable and arguments, unprivileged identity, group access, working directory, configuration source, writable paths, readiness behavior, stop behavior, expected exit codes, restart intention, dependencies, and resource risks. Then encode only those facts.

```ini
[Unit]
Description=Example API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=app
Group=app
WorkingDirectory=/srv/app/current
EnvironmentFile=/etc/app/app.env
ExecStart=/usr/bin/node /srv/app/current/server.js
Restart=on-failure
RestartSec=5s
MemoryMax=1G
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

This definition says the process remains in the foreground, runs without root, starts from an explicit directory and executable, receives deployment configuration, retries failures with delay, and has selected resource boundaries. It does not prove the application is ready, make external dependencies permanently available, or secure secrets merely because an environment file is named.

Verify the file before activation:

```bash
systemd-analyze verify /etc/systemd/system/app.service
systemctl daemon-reload
systemctl cat app.service
systemctl start app.service
systemctl status app.service --no-pager -l
curl --fail http://127.0.0.1:3000/health
systemctl enable app.service
```

The sequence separates parse validation, manager reload, effective definition, runtime start, lifecycle evidence, application health, and future boot activation. If start fails, investigate before enabling or adding broader privilege.

### Why Do Foreground Daemons Simplify Supervision?

A foreground process lets systemd directly track the main process, collect its exit status, send signals, and group its children. A traditional daemon that forks away requires `Type=forking` and a reliable way to identify the resulting main process. Misdeclaring a forking daemon as simple can make the manager track the wrong lifecycle; forcing a foreground program to daemonize adds complexity without benefit.

`Type=notify` improves readiness when the application can explicitly report completion of initialization. `Type=simple` mainly reports that execution began. `Type=oneshot` models a task that performs bounded work and exits. Choose the type that matches what the program actually does rather than using it as a delay workaround.

Readiness cannot be reduced to a sleep. Startup duration changes with cache, dependency, migration, and host conditions. Prefer explicit notification or an external health check. Even after initial readiness, dependencies can fail later, so application retry and degradation remain necessary.

### How Do Shutdown and Reload Preserve Availability?

During stop, systemd sends the configured signal and waits up to the stop timeout before escalation. The application should stop accepting new work, allow bounded in-flight work to finish, persist required state, close descriptors, and exit. The unit should grant enough time for its documented shutdown without allowing a hung process to block maintenance indefinitely.

Reload is application-specific. Nginx can validate config and replace workers while existing connections drain. Another service may not support reload at all. `ExecReload=` must express the actual supported action. Treat a successful reload command as manager evidence, then verify that the application adopted the intended configuration.

Reverse-order shutdown can benefit from dependency ordering, but dependencies should describe reality. A service that requires a database at startup may still need to handle database loss at runtime and may need the database kept until its own clean stop completes. Test maintenance and shutdown, not only boot.

### How Do Failure Loops Become Observable?

`systemctl reset-failed app.service` clears remembered failed state and start-rate counters after the cause is addressed; it does not repair the cause. `NRestarts`, `Result`, and journal timestamps reveal a loop. Rate limiting prevents unlimited starts during an interval and deliberately leaves the unit failed when the bound is crossed.

An operator should preserve the first application error, the exit status or signal, the restart-policy decision, and the count. Later iterations may fail for secondary reasons such as occupied ports, exhausted files, or rate limits. Alert on repeated restarts even if the service returns to active state between them.

Resource-policy failures need the same timeline. A cgroup memory kill, file-descriptor exhaustion, denied filesystem write, or CPU quota can look like an application fault. Inspect the effective controls and kernel or manager evidence. Raise a boundary only when the workload contract justifies it; otherwise fix the unbounded behavior.

### What Should a Production Review Ask?

Can the service start after boot without a human login? Does enabled state match policy? Is the executable immutable to the runtime user? Are configuration and secrets readable only by intended identities? Are mutable paths explicit? Does the unit use absolute paths and the correct service type? Can the application stop within the timeout and reload safely when claimed?

Are dependency and ordering edges real and minimal? Does startup success differ from application readiness? Are retries bounded and observable? Do resource controls protect the host without surprising normal load? Do logs preserve both application output and manager lifecycle? Does a timer-run job expose the same identity, status, and evidence as a daemon?

Finally, can an operator verify the user-facing function after start, reload, restart, boot, and failure recovery? A service manager maintains declared process state. Production reliability comes from aligning that declaration with the actual application contract and testing the boundary users depend on.

### How Do Timers and Sockets Reuse the Unit Model?

A timer describes when another unit should activate. Calendar timers express wall-clock schedules; monotonic timers express intervals relative to boot, activation, or the last run. Persistence can cause a missed calendar event to run after the machine returns, when configured. Randomized delay can prevent a fleet from starting the same maintenance load simultaneously.

The activated service should normally use `Type=oneshot` for bounded work and return a meaningful exit status. Its journal then records start, application output, completion, failure, duration, and resource accounting. The timer can schedule again without leaving a shell or sleeping daemon alive.

A socket unit can create and own a listening socket before the service starts. When traffic arrives, systemd activates the service and passes the socket according to the supported model. This separates endpoint availability from process startup and can remove some ordering dependency. The application must explicitly support socket activation; simply adding a socket unit does not make an arbitrary program inherit it correctly.

Both patterns show why unit state is broader than a PID. A timer can wait while inactive work has no process, a socket can be listening while its service is not running, and a successful oneshot can finish. Inspect the unit types and activation relationship rather than asking only whether a daemon exists.

### How Should Local Overrides Be Maintained?

Use a drop-in for a small local difference and a full local unit when the complete definition is locally owned. `systemctl edit` creates an override in the administrator path. An empty assignment can reset some list-valued directives before replacement, so review the effective result rather than assuming an override appends in every case.

```bash
systemctl cat app.service
systemctl show app.service -p FragmentPath -p DropInPaths
systemd-delta
```

Record why the override exists, keep it with configuration management, and test it against package upgrades. A vendor update can change the base unit under a still-valid but now-inappropriate override. Effective configuration is the source systemd executes.

### What Happens During Clean Machine Shutdown?

systemd constructs a shutdown transaction and stops units with dependency-aware ordering. A service receives its stop lifecycle even though no human ran `systemctl stop`. This is another reason to implement bounded SIGTERM handling and avoid relying on an SSH session.

Start ordering often implies useful reverse stop ordering: a workload started after and requiring a dependency can be stopped before that dependency disappears. Application-level graceful handling remains necessary because external systems, networks, and peers can fail outside the manager's orderly shutdown.

Test reboot and shutdown behavior in a safe environment. Confirm the workload stops within its timeout, durable state is complete, the next boot activates the intended units, and readiness returns. A unit that works only after a manual second restart has an unresolved dependency, readiness, path, or state problem.

Service management also defines an audit boundary. The effective unit explains intended execution state, the journal records manager and application events, cgroup accounting describes resource use, and lifecycle commands provide a consistent operator interface. Keep ad hoc shell wrappers, undocumented environment changes, and manual root starts outside the production path because they create a second, invisible service definition.

When a deployment changes code, configuration, unit policy, and secrets, name which step requires `daemon-reload`, application reload, restart, or no process action. Verify after each required boundary. This prevents the common state where the file on disk is new, the manager definition is old, and the running process still uses older code or environment.

Use `systemctl show` when status prose is not precise enough. Properties such as `MainPID`, `ActiveEnterTimestamp`, `ExecMainStartTimestamp`, `ExecMainStatus`, `Result`, `NRestarts`, `MemoryCurrent`, and `ControlGroup` connect manager state to the process and resource views. Property availability can vary with systemd version and unit state, so inspect what the host exposes rather than hard-coding an assumed report.

The final responsibility remains with the application contract. systemd can start the right executable, deliver signals, restrict resources, and report results. It cannot make a database migration reversible, make a dependency healthy, decide whether a request result is correct, or infer whether retrying duplicates work. Unit policy and application design meet at readiness, shutdown, exit status, health, and idempotence; production review must cover both.

A well-managed service should be understandable from its effective unit, current state, cgroup, journal, and health interface without reconstructing a former operator's shell session. That inspectability is part of the reliability benefit, not merely administrative convenience.

Keep service names and descriptions stable enough for monitoring, dependency references, automation, and incident history. Renaming a unit changes more than a filename when timers, sockets, targets, alerts, or deployment commands reference it. Review those relationships as one unit graph.

Before removing an old unit, verify it is inactive, disabled, unreferenced, and absent from timer, socket, target, and dependency relationships; then reload the manager and confirm the replacement path.

## Check Your Answers

:::expand[Why Does a Long-Running Program Need a Service Manager?]{kind="recap"}
A service manager separates workload lifetime from SSH, records results, restores declared state, and gives operations one owner.
:::

:::expand[How Does systemd Supervise a Workload?]{kind="recap"}
systemd resolves unit policy, creates process state, groups the workload in a cgroup, and tracks its lifecycle.
:::

:::expand[How Do Loaded, Enabled, Active, and Failed State Differ?]{kind="recap"}
Definition availability, future activation, current runtime, and remembered failure are independent state dimensions.
:::

:::expand[How Does a Unit File Define the Service Process?]{kind="recap"}
The effective unit declares executable, identity, directory, environment, dependencies, type, lifecycle, and policy without an implicit shell.
:::

:::expand[How Do Start, Stop, Enable, Restart, and Reload Differ?]{kind="recap"}
Current state, future activation, process replacement, and in-process configuration refresh are different operations.
:::

:::expand[How Do Dependencies, Service Types, and Readiness Shape Boot?]{kind="recap"}
Requirement, ordering, activation type, manager state, and application readiness must be expressed and verified separately.
:::

:::expand[How Do the Journal, Exit Codes, and Signals Explain Failure?]{kind="recap"}
Combine manager state, application output, exit result, signal, effective configuration, and the first failure timeline.
:::

:::expand[How Do Restart Policy, Resource Controls, and Timers Add Resilience?]{kind="recap"}
Bounded retry, cgroup limits, hardening, and separate timer-triggered services turn process execution into durable policy.
:::

![Service management summary infographic showing units, environment files, start, enable, restart, reload, dependencies, journalctl, restart policy, limits, and timers](/content-assets/articles/article-devops-foundation-linux-system-admin-service-management/service-management-summary.png)

_The summary image gathers the systemd operations that keep one service manageable over time._

## References

- [systemd.service manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) - Documents service unit options and lifecycle behavior.
- [systemd.unit manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html) - Documents unit dependencies, ordering, and install behavior.
- [systemd.exec manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) - Documents execution settings such as user, group, environment, limits, and working directory.
- [systemctl manual](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html) - Documents service management commands.
- [journalctl manual](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html) - Documents journal querying and filtering.
- [systemd.timer manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html) - Documents timer units and calendar schedules.
- [Nginx control signals](https://nginx.org/en/docs/control.html) - Official Nginx documentation for reloads and process control.
