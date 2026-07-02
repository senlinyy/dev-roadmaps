---
title: "Service Management"
description: "Manage system services with systemd, write your own unit files, and keep long-running processes alive across reboots and crashes."
overview: "Use systemd to run long-lived programs as managed Linux services, inspect state, restart safely, read logs, and set practical runtime guardrails."
tags: ["systemd", "systemctl", "services"]
order: 2
id: article-devops-foundation-linux-system-admin-service-management
---

## Table of Contents

1. [Why Services Need a Manager](#why-services-need-a-manager)
2. [Daily `systemctl` Commands](#daily-systemctl-commands)
3. [Anatomy of an Application Unit File](#anatomy-of-an-application-unit-file)
4. [Enable, Start, Restart, and Reload](#enable-start-restart-and-reload)
5. [Environment Files and Working Directories](#environment-files-and-working-directories)
6. [Dependencies, Ordering, and Targets](#dependencies-ordering-and-targets)
7. [Read Service Logs with `journalctl`](#read-service-logs-with-journalctl)
8. [Restart Policy and Resource Guardrails](#restart-policy-and-resource-guardrails)
9. [Timers for Scheduled Work](#timers-for-scheduled-work)
10. [References](#references)

## Why Services Need a Manager
<!-- section-summary: systemd starts, supervises, logs, and restarts long-running programs so they survive beyond a shell session. -->

Running a web server by typing a command in an SSH session works only while that session and process survive. Close the terminal, reboot the machine, or hit a crash at the wrong moment, and the program may disappear with no clear owner. That is why long-running programs need a service manager instead of a human keeping a shell open.

Web servers, workers, schedulers, databases, and agents all need the same basic care. They need to start after boot, run as the right user, receive the right environment, write logs somewhere predictable, and restart after certain failures. In Linux, a program managed this way is usually called a **service**.

On most modern Linux distributions, the service manager is **systemd**. systemd runs as PID `1`, starts services, tracks their processes, records service output in the journal, and gives operators one command family through `systemctl`.

Nginx usually comes with a systemd unit from the OS package. A custom application can have one too. Once a program runs as `app.service`, operators have a clear control surface: `systemctl status app.service` shows state, `journalctl -u app.service` shows logs, and restart behavior lives in a unit file that can be reviewed.

systemd exists because production programs need more than a command in a shell. The machine needs one early process that can start the rest of the system, collect child processes, apply policies, and keep service state consistent across boot, crash, and restart events. That early process is PID `1`.

Under the hood, systemd reads unit files, builds a startup transaction, starts processes, tracks them in cgroups, collects their exit status, and records stdout and stderr in the journal. That is why `systemctl status` can show the main PID, child processes, memory, CPU time, and recent log lines from one place.

The next decision is whether a program needs management. A one-time command can run in your shell. A web server, worker, queue consumer, or agent should run as a service so it has boot behavior, logs, restart policy, environment, and a clear owner.

## Daily `systemctl` Commands
<!-- section-summary: `systemctl` is the main operator interface for checking and changing service state. -->

A service feels unhealthy after a deploy: the health check fails, users see errors, and the tempting move is to restart immediately. Check status first. `systemctl status` tells you whether systemd thinks the service is running, failed, restarting, disabled, or using a different main PID than expected.

That first look protects evidence. A restart can clear the failed process, replace the PID, and move the most useful log lines farther away. Status gives the current state, the unit file path, recent logs, and the process tree before you change anything.

```bash
systemctl status app.service --no-pager
```

Example output:

```console
app.service - Application service
     Loaded: loaded (/etc/systemd/system/app.service; enabled; preset: enabled)
     Active: active (running) since Wed 2026-06-24 10:18:36 UTC; 24min ago
   Main PID: 1842 (node)
      Tasks: 18
     Memory: 286.4M
        CPU: 34.221s
     CGroup: /system.slice/app.service
             `-1842 /usr/bin/node /srv/app/current/server.js
```

Notice the beginner-friendly pieces:

- `Loaded` shows the unit file path and whether the service is enabled for boot.
- `Active` shows the current service state.
- `Main PID` connects systemd to the process article.
- `Memory` and `CPU` give a quick resource hint.
- `CGroup` shows the process tree systemd is tracking for this unit.

Check whether a service is configured to start on boot:

```bash
systemctl is-enabled app.service
```

Example output:

```console
enabled
```

The common state-changing commands are:

```bash
sudo systemctl start app.service
sudo systemctl stop app.service
sudo systemctl restart app.service
sudo systemctl reload nginx
```

These commands often print no output when systemd accepts the request. Always follow with `status` or logs. A command can return successfully while the service fails a few seconds later because of a bad port, missing environment variable, or permission problem.

The output also shows the cgroup path. A cgroup is the kernel's way to group and account for related processes. systemd puts each service in its own cgroup so child processes stay attached to the unit and resource controls can apply to the whole service rather than only the first PID.

## Anatomy of an Application Unit File
<!-- section-summary: A unit file declares what starts, which user it runs as, where it runs, and how systemd handles its lifecycle. -->

After a program is important enough for systemd to manage, the next question is where its rules live. Operators should not have to guess which command starts the app, which account runs it, or which environment file it needs. Those choices belong in one reviewed file so the service behaves the same way after every reboot and deploy.

In systemd, that file is a **unit file**. It acts as the service contract: what command starts, which user runs it, which directory it starts from, which environment file it reads, and how systemd should handle failure.

Unit files exist so service behavior is reviewable and repeatable. Without a unit file, important details live in someone's shell history or deployment script. With a unit file, another operator can see the user, working directory, start command, restart policy, and boot target in one place.

A locally managed application unit can live at `/etc/systemd/system/app.service`:

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

The unit has three important parts:

- `[Unit]` describes the service and startup ordering.
- `After=network-online.target` says this service should start after the network-online target has been reached.
- `Wants=network-online.target` asks systemd to include that target in the startup transaction.
- `[Service]` describes the process systemd manages.
- `User` and `Group` run the application with limited privileges.
- `WorkingDirectory` sets the starting directory for relative paths.
- `EnvironmentFile` loads runtime settings from a separate file.
- `ExecStart` is the command systemd launches.
- `Restart=on-failure` tells systemd to restart after many failure exits.
- `[Install]` explains enablement.
- `WantedBy=multi-user.target` means the service should join the normal server boot path when enabled.

`Type=simple` means systemd treats the process started by `ExecStart` as the main service process. That fits many web applications and workers. Other service types exist for programs that fork, notify systemd when ready, or run one short task, so choose the type that matches how the program starts.

After creating or editing a unit file, ask systemd to reread unit definitions:

```bash
sudo systemctl daemon-reload
```

This often prints no output when systemd reloads the unit definitions. This command does not restart the running process. It only refreshes systemd's view of unit files.

The next decision after editing a unit is two-step: refresh systemd's unit cache with `daemon-reload`, then restart or reload the affected service if the running process needs the new settings.

## Enable, Start, Restart, and Reload
<!-- section-summary: Service changes need the right verb because start, restart, reload, and enable affect different parts of runtime state. -->

A beginner-friendly service mistake is easy to make: the service works after `systemctl start`, then disappears after the next reboot. Another common mistake is using `restart` for a config change that the service could reload without dropping active work. The command verbs sound similar, and each one changes a different part of service life.

The first split is current runtime versus future boot. `start` launches a stopped service during the current boot. `enable` connects the service to a boot target so systemd starts it after reboot.

The second split is restart versus reload. `restart` stops the process and launches a new one. `reload` asks a running service to reread config when it supports that behavior.

| Command | What it does |
|---|---|
| `start` | Launches a stopped service now |
| `stop` | Stops a running service now |
| `restart` | Stops then starts the service |
| `reload` | Asks a service to reread config without a full stop, when supported |
| `enable` | Adds boot-time startup links |
| `disable` | Removes boot-time startup links |
| `daemon-reload` | Rereads unit files |

Runtime state and boot configuration are separate in systemd. systemd can launch a unit immediately without adding it to future boot. It can also enable a unit for future boot while leaving the current process stopped until an operator launches it.

After creating a new unit, use this flow:

```bash
sudo systemctl daemon-reload
```

This often prints no output when systemd accepts the reload.

```bash
sudo systemctl enable app.service
```

Example output:

```console
Created symlink /etc/systemd/system/multi-user.target.wants/app.service -> /etc/systemd/system/app.service.
```

```bash
sudo systemctl start app.service
```

This often prints no output when systemd accepts the start request.

Now inspect the service:

```bash
systemctl status app.service --no-pager
```

Example output:

```console
app.service - Application service
     Loaded: loaded (/etc/systemd/system/app.service; enabled; preset: enabled)
     Active: active (running) since Wed 2026-06-24 10:18:36 UTC; 6s ago
   Main PID: 1842 (node)
```

Check the application directly on its local port if it has one:

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/health
```

Example output:

```console
ok
```

After changing the unit file, use a slightly different flow:

```bash
sudo systemctl daemon-reload
sudo systemctl restart app.service
systemctl status app.service --no-pager
journalctl -u app.service -n 20 --no-pager
```

Example output:

```console
app.service - Application service
     Active: active (running) since Wed 2026-06-24 10:30:04 UTC; 4s ago

Jun 24 10:30:04 web-01 systemd[1]: Started app.service - Application service.
Jun 24 10:30:05 web-01 app[1901]: listening on 127.0.0.1:3000
```

Status and logs belong together. `restart` may return successfully before the application has finished starting.

For Nginx config changes, validate first, then reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Example output:

```console
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Reload is useful only for services that support it. For application code deploys, restart is more common because the process needs to start from the new release.

The next decision is the safest verb for the change. Use `reload` for config that the service can reread safely, such as many Nginx config changes. Use `restart` for new code, changed environment variables, changed unit resource settings, or services without reload support. Use `enable --now` when a new service should start immediately and also after reboot.

## Environment Files and Working Directories
<!-- section-summary: Environment files and working directories make service runtime settings explicit and repeatable. -->

A deploy can pass health checks in one SSH session and fail after reboot because the service lost `PORT`, `DATABASE_URL`, or `LOG_LEVEL`. That happens when runtime settings live in a human shell instead of the service definition. The running app had the values once, but systemd did not know how to supply them next time.

Environment variables are settings passed to a process. Applications often read `NODE_ENV`, `PORT`, `DATABASE_URL`, or `LOG_LEVEL` from the environment. systemd can load those settings from a file so the service starts the same way after boot, restart, or deploy.

Environment files exist to keep runtime settings out of the start command. They also help deployments because the same unit can start the application in a predictable way while the environment file supplies per-server or per-environment values.

An environment file might look like:

```ini
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgres://app@db.internal:5432/app
```

The file uses simple key-value lines:

- `NODE_ENV=production` tells the app to use production behavior.
- `PORT=3000` tells the app which local port to bind.
- `LOG_LEVEL=info` keeps normal production logging at a manageable level.
- `DATABASE_URL=...` points the app at its database and may contain sensitive connection details.

The unit file points to it:

```ini
EnvironmentFile=/srv/app/config.env
```

That unit line loads the file before systemd launches the process:

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
```

Example output:

```console
-rw-r----- 1 root app 122 Jun 24 10:12 /srv/app/config.env
```

The permission line confirms the protection:

- `root app` shows root owns the file and the `app` group can read it.
- `rw-r-----` matches mode `640`.
- The file path at the end confirms you checked the intended environment file.

The working directory also matters. Many applications use relative paths for templates, migrations, static files, or local config. Setting `WorkingDirectory=/srv/app/current` makes the runtime predictable.

After changing an environment file, restart the service:

```bash
sudo systemctl restart app.service
```

This often prints no output when systemd accepts the restart request:

- `restart` stops the current process and starts a new one.
- The new process reads the current environment file.
- Follow with `systemctl status app.service --no-pager` or a health check because the start request can succeed before the app finishes booting.

systemd reads the environment file when it starts the process. A running process does not automatically receive changes from that file.

The next decision after changing an environment file is to restart the service and verify the setting from logs, health checks, or a narrow `/proc/<pid>/environ` check. Also decide whether the file contains secrets. If it does, lock down permissions and avoid printing the whole file during debugging.

## Dependencies, Ordering, and Targets
<!-- section-summary: systemd dependencies describe startup relationships, while targets group services into boot states. -->

An application may fail during boot because it launches before the network is ready or before a local supporting unit has joined the boot transaction. The unit file needs to express two separate ideas: which units should be included, and which units should run earlier.

A **dependency** pulls another unit into the transaction. `Wants=` asks for a supporting unit. `Requires=` is stronger and should be reserved for hard local requirements.

**Ordering** controls sequence. `After=` says this unit should run after another unit has reached its point in the transaction. `Before=` says the opposite. Ordering alone does not pull the other unit in; it only arranges units that are already part of the transaction.

For many networked application services, this pair is common:

```ini
After=network-online.target
Wants=network-online.target
```

The two lines do different jobs:

- `Wants=network-online.target` asks systemd to include the network-online target in the startup transaction.
- `After=network-online.target` orders the application after that target has been reached.
- `Requires=` is stricter and can stop the dependent unit when the required unit fails, so reserve it for hard local dependencies.

Targets group units into boot states. `multi-user.target` is the normal server state with networking and services.

A target is a named group of units. Server boot usually heads toward `multi-user.target`, while timers head toward `timers.target`. Enabling a service creates a relationship from a target to that service, so systemd knows it belongs in that boot state.

Inspect dependencies:

```bash
systemctl list-dependencies --plain app.service
```

Example output:

```console
app.service
|-network-online.target
`-system.slice
```

The dependency output gives a quick relationship check:

- `network-online.target` appears under the service, so the target is part of the transaction.
- `system.slice` shows the service belongs in the normal system service slice.
- Missing expected local units here can explain boot-time races.

Show the active unit definition and drop-ins:

```bash
systemctl cat app.service
```

Example output:

```console
# /etc/systemd/system/app.service
[Unit]
Description=Example application service
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/node /srv/app/current/server.js
```

The displayed unit answers two practical questions:

- The comment line shows the file path systemd loaded.
- The `[Unit]` lines show the current dependency and ordering settings.
- The `[Service]` line confirms the command systemd launches.
- `systemctl cat` also shows drop-in override files under `/etc/systemd/system/app.service.d/` when they exist.

Application retry behavior still belongs in the application. systemd can help with boot ordering, while the application should handle temporary database or network failures after it starts.

The next decision is how strong the relationship should be. Use `Wants=` for helpful supporting units. Use `Requires=` only when the service truly cannot make sense without the other local unit. Use `After=` when startup order matters. Still build application-level retries for databases, APIs, and networks because boot ordering does not guarantee those dependencies stay healthy.

## Read Service Logs with `journalctl`
<!-- section-summary: systemd captures service stdout and stderr in the journal, where `journalctl` can filter by unit, time, priority, and boot. -->

A failed service start usually leaves evidence in the journal. The unit may be missing an environment variable, binding a port that is already in use, failing a permission check, or exiting after a stack trace. `journalctl -u app.service` keeps that evidence tied to the service instead of mixing it with every host message.

systemd captures service stdout and stderr in the journal. If the application writes logs there, the unit journal is the first evidence path after a start, restart, or failure.

Show the latest entries:

```bash
journalctl -u app.service -n 20 --no-pager
```

Example output:

```console
Jun 24 10:30:04 web-01 systemd[1]: Started app.service - Application service.
Jun 24 10:30:05 web-01 app[1901]: listening on 127.0.0.1:3000
Jun 24 10:30:07 web-01 app[1901]: request_id=req_7J2 path=/health status=200 duration_ms=7
```

Follow logs live:

```bash
journalctl -u app.service -f
```

Example output:

```console
Jun 24 10:31:12 web-01 app[1901]: request_id=req_7K1 path=/api/items status=200 duration_ms=44
Jun 24 10:31:18 web-01 app[1901]: request_id=req_7K2 path=/api/items status=200 duration_ms=39
```

Look at a deploy window:

```bash
journalctl -u app.service --since "30 minutes ago" --no-pager
```

Example output:

```console
Jun 24 10:18:31 web-01 systemd[1]: app.service: Main process exited, code=killed, status=9/KILL
Jun 24 10:18:36 web-01 systemd[1]: Started app.service - Application service.
Jun 24 10:18:37 web-01 app[1842]: listening on 127.0.0.1:3000
```

Filter to warnings and higher:

```bash
journalctl -u app.service -p warning --since "today" --no-pager
```

Example output:

```console
Jun 24 09:58:12 web-01 app[1842]: level=warning path=/api/reports/export duration_ms=12004 message="request exceeded slow threshold"
Jun 24 10:18:31 web-01 systemd[1]: app.service: Main process exited, code=killed, status=9/KILL
```

Limit to the current boot:

```bash
journalctl -u app.service -b --no-pager
```

Example output:

```console
Jun 24 08:01:22 web-01 systemd[1]: Started app.service - Application service.
Jun 24 08:01:23 web-01 app[1204]: listening on 127.0.0.1:3000
```

If a service is crash-looping, the journal usually shows repeated start attempts, stack traces, missing environment variables, permission errors, or port binding failures.

## Restart Policy and Resource Guardrails
<!-- section-summary: Restart policies and resource limits help services recover from simple failures and avoid consuming the entire VM. -->

A service that crashes once at 03:00 should not wait for a human to type the same start command. A service that crashes every second should not spin forever and hide the original error under hundreds of restarts. Restart policy and limits handle both sides of that operational problem.

Restart policy tells systemd what to do after a service exits. `Restart=on-failure` is a common default for a small web service. It restarts after a nonzero exit, signal failure, timeout, or watchdog failure. It does not restart after a clean operator stop.

Restart policy exists to handle simple failures without a human doing the same command by hand. A service can crash because of a transient dependency, a temporary file issue, or a one-off runtime error. A measured restart policy can recover from that class of failure while still stopping a tight crash loop.

```ini
[Service]
Restart=on-failure
RestartSec=5s
```

Those two lines set the basic recovery behavior:

- `Restart=on-failure` restarts the service after failure exits, signals, timeouts, and watchdog failures.
- A clean `systemctl stop app.service` does not count as a failure.
- `RestartSec=5s` waits five seconds before trying again, which avoids an immediate tight loop.

Restart loops need limits. Add start-rate limiting in the `[Unit]` section:

```ini
[Unit]
StartLimitIntervalSec=60
StartLimitBurst=5
```

These lines limit repeated restarts:

- `StartLimitIntervalSec=60` sets the sixty-second window.
- `StartLimitBurst=5` allows five starts inside that window.
- After the limit is hit, the service enters a failed state so an operator can inspect logs rather than letting the machine spin forever.

Check a failed service:

```bash
systemctl status app.service --no-pager
```

Example output:

```console
app.service - Application service
     Loaded: loaded (/etc/systemd/system/app.service; enabled; preset: enabled)
     Active: failed (Result: start-limit-hit) since Wed 2026-06-24 10:36:12 UTC; 12s ago
```

The failed status points to a restart loop guard:

- `Active: failed` says systemd stopped trying for now.
- `Result: start-limit-hit` says the start-rate limit was reached.
- The next useful evidence is the unit journal around the first failure, before repeated retries filled the timeline.

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
```

Example output:

```console
app.service - Application service
     Active: active (running) since Wed 2026-06-24 10:38:02 UTC; 6s ago

Jun 24 10:38:02 web-01 systemd[1]: Started app.service - Application service.
Jun 24 10:38:03 web-01 app[2044]: listening on 127.0.0.1:3000
```

The combined check confirms both state and evidence:

- `Active: active (running)` says systemd sees the service as live.
- The journal line from systemd confirms the start event.
- The application log line confirms the app reached its listening state.

Resource guardrails can also live in the unit:

```ini
MemoryMax=512M
CPUQuota=80%
LimitNOFILE=8192
```

These guardrails apply at service start:

- `MemoryMax=512M` caps memory for the service cgroup.
- `CPUQuota=80%` limits the service to less than one full CPU core of sustained CPU time.
- `LimitNOFILE=8192` sets the maximum open-file count the process receives.

Set guardrails from observed behavior. If normal RSS is around `220M` and peak request traffic reaches `380M`, `512M` may leave enough headroom. If logs show OOM kills at that value, raise the limit, reduce memory growth, or move heavy work away from the VM.

These guardrails use the service cgroup. That means `MemoryMax=512M` applies to the service's process tree, not only the main PID. `CPUQuota=80%` limits CPU consumption for the unit. `LimitNOFILE=8192` sets the open-file limit that the process receives at start.

Verify open-file limits from the running process:

```bash
pid=$(systemctl show -p MainPID --value app.service)
grep "Max open files" "/proc/${pid}/limits"
```

Example output:

```console
Max open files            8192                 8192                 files
```

That connects the unit setting to the live process:

- The soft and hard open-file limits both show `8192`.
- The value matches `LimitNOFILE=8192` from the unit.
- A mismatch means the service may need a restart, a daemon reload, or a check for override files.

The next decision is evidence-based limits. Set limits wide enough for normal peak traffic, low enough to stop one unit from consuming the whole VM, and close enough to real behavior that alerts catch growth early. After changing resource settings, use `daemon-reload`, restart the service, and verify the live process state.

## Timers for Scheduled Work
<!-- section-summary: systemd timers run scheduled jobs with the same logging and unit management model as services. -->

A cleanup script can work perfectly during testing and then never run after the next reboot because it lived only in someone's shell history. Another script can run from cron and fail silently because nobody checked the right mailbox or log file. Scheduled production work needs the same ownership, logs, and status checks as services.

Cron is still common, but systemd timers are useful on systemd servers because scheduled jobs get normal unit files, status, logs, and enablement behavior.

Timers exist so scheduled work can use the same service model as long-running work. The schedule lives in the timer unit. The actual command lives in the service unit. That split gives the job a user, logs, status, and resource settings just like other systemd-managed work.

A cleanup service might look like:

```ini
[Unit]
Description=Clean old application releases

[Service]
Type=oneshot
ExecStart=/srv/app/scripts/cleanup-releases.sh
User=deploy
Group=app
```

The service unit describes the job itself:

- `Type=oneshot` tells systemd the command runs to completion instead of staying alive.
- `ExecStart=/srv/app/scripts/cleanup-releases.sh` is the cleanup command.
- `User=deploy` and `Group=app` run the job with a predictable account and group.
- The job's output goes to the journal, so `journalctl -u app-cleanup.service` can show what happened.

The timer controls the schedule:

```ini
[Unit]
Description=Run application release cleanup daily

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

The timer unit describes when the job runs:

- `OnCalendar=*-*-* 03:30:00` schedules the job daily at 03:30.
- `Persistent=true` lets systemd run a missed job after boot if the machine was off at the scheduled time.
- `WantedBy=timers.target` connects the timer to the normal timer startup path when enabled.

Enable the timer now and for future boots:

```bash
sudo systemctl enable --now app-cleanup.timer
```

Example output:

```console
Created symlink /etc/systemd/system/timers.target.wants/app-cleanup.timer -> /etc/systemd/system/app-cleanup.timer.
```

The enable output shows the boot relationship:

- The symlink under `timers.target.wants` means the timer is enabled for future boots.
- The `--now` flag also starts the timer during the current boot.
- The target path confirms the timer joins the normal systemd timer group.

Inspect the timer:

```bash
systemctl list-timers app-cleanup.timer
```

Example output:

```console
NEXT                        LEFT LAST PASSED UNIT              ACTIVATES
Thu 2026-06-25 03:30:00 UTC 16h  -    -      app-cleanup.timer app-cleanup.service
```

The timer table shows scheduling and ownership:

- `NEXT` and `LEFT` show the next planned run.
- `UNIT` is the timer that wakes up on the schedule.
- `ACTIVATES` is the service unit the timer runs.
- Empty `LAST` and `PASSED` values mean this timer has not run yet in the shown period.

Check the job logs:

```bash
journalctl -u app-cleanup.service --since "today" --no-pager
```

Example output:

```console
Jun 24 03:30:02 web-01 systemd[1]: Starting app-cleanup.service - Clean old application releases...
Jun 24 03:30:03 web-01 cleanup-releases.sh[1880]: removed 2 old releases
Jun 24 03:30:03 web-01 systemd[1]: app-cleanup.service: Deactivated successfully.
```

The job log confirms the full run:

- The first line shows systemd starting the scheduled service.
- The script line shows the useful application-level result.
- `Deactivated successfully` means the oneshot service finished cleanly.

The same service habits apply to scheduled work. The job has a user, logs, status, and a unit file, which makes it easier to audit than a forgotten one-line cron entry.

The next decision is where the job belongs. A personal cleanup command can stay manual. A production cleanup, report export, certificate renewal, or backup trigger should have a timer, logs, ownership, and failure visibility.

## References

- [systemd.service manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) - Documents service unit options and lifecycle behavior.
- [systemd.unit manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html) - Documents unit dependencies, ordering, and install behavior.
- [systemd.exec manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) - Documents execution settings such as user, group, environment, limits, and working directory.
- [systemctl manual](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html) - Documents service management commands.
- [journalctl manual](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html) - Documents journal querying and filtering.
- [systemd.timer manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html) - Documents timer units and calendar schedules.
- [Nginx control signals](https://nginx.org/en/docs/control.html) - Official Nginx documentation for reloads and process control.
