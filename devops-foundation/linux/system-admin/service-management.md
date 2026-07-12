---
title: "Service Management"
description: "Manage system services with systemd, write your own unit files, and keep long-running processes alive across reboots and crashes."
overview: "Use systemd to run long-lived programs as managed Linux services, inspect state, restart safely, read logs, and set practical runtime guardrails."
tags: ["systemd", "systemctl", "services"]
order: 2
id: article-devops-foundation-linux-system-admin-service-management
---

## Table of Contents

1. [The Fragile SSH Command Problem](#the-fragile-ssh-command-problem)
2. [systemd as the Service Manager](#systemd-as-the-service-manager)
3. [Ask systemd About a Service](#ask-systemd-about-a-service)
4. [Unit Files as Written Instructions](#unit-files-as-written-instructions)
5. [Environment Files and Working Directories](#environment-files-and-working-directories)
6. [Start, Enable, Restart, and Reload](#start-enable-restart-and-reload)
7. [Dependencies, Ordering, and Boot Timing](#dependencies-ordering-and-boot-timing)
8. [journalctl as Service Evidence](#journalctl-as-service-evidence)
9. [Restart Policy, Resource Limits, and Timers](#restart-policy-resource-limits-and-timers)
10. [References](#references)

## The Fragile SSH Command Problem
<!-- section-summary: Long-running programs need a manager because shell-launched processes can disappear, lose logs, or restart inconsistently. -->

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

The tree tells the story:

- `node server.js` is running as PID `2601`.
- Its parent is the shell with PID `2310`.
- That shell belongs to the SSH session.
- If the app should run all week, this is a fragile home for it.

The fix is to give the program a service manager. That manager starts it from written instructions, records logs, tracks the main PID, collects the exit status, and applies restart rules. The rest of the examples use a small Node app, but the same pattern applies to web servers, queue workers, agents, schedulers, and many databases.

## systemd as the Service Manager
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

## Ask systemd About a Service
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

## Unit Files as Written Instructions
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

## Environment Files and Working Directories
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

## Start, Enable, Restart, and Reload
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

## Dependencies, Ordering, and Boot Timing
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

## journalctl as Service Evidence
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

## Restart Policy, Resource Limits, and Timers
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
