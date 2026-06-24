---
title: "Service Management"
description: "Manage system services with systemd, write your own unit files, and keep long-running processes alive across reboots and crashes."
overview: "Use systemd to run the API as a managed Linux service, inspect its state, restart it safely, read logs, and set practical runtime guardrails."
tags: ["systemd", "systemctl", "services"]
order: 2
id: article-devops-foundation-linux-system-admin-service-management
---

## Table of Contents

1. [Why Services Need a Manager](#why-services-need-a-manager)
2. [Daily `systemctl` Commands](#daily-systemctl-commands)
3. [Anatomy of the API Unit File](#anatomy-of-the-api-unit-file)
4. [Enable, Start, Restart, and Reload](#enable-start-restart-and-reload)
5. [Environment Files and Working Directories](#environment-files-and-working-directories)
6. [Dependencies, Ordering, and Targets](#dependencies-ordering-and-targets)
7. [Read Service Logs with `journalctl`](#read-service-logs-with-journalctl)
8. [Restart Policy and Resource Guardrails](#restart-policy-and-resource-guardrails)
9. [Timers for Scheduled Work](#timers-for-scheduled-work)
10. [References](#references)

## Why Services Need a Manager
<!-- section-summary: systemd starts, supervises, logs, and restarts long-running programs so they survive beyond a shell session. -->

The `inventory-api` process needs a life beyond one person's SSH session. It needs to start after boot, restart after certain crashes, receive a predictable environment, write logs somewhere central, and run as the right user. That is the job of a service manager.

On most modern Linux distributions, that service manager is **systemd**. systemd runs as PID `1`, starts system services, tracks their processes, records service output in the journal, and gives operators one interface through `systemctl`.

Nginx already comes with a systemd unit from the OS package. Our API needs one too. Once the API is a systemd service, operations become clearer: `systemctl status inventory-api` shows the active state, `journalctl -u inventory-api` shows logs, and restart behavior lives in a reviewed unit file instead of a deploy script's memory.

## Daily `systemctl` Commands
<!-- section-summary: `systemctl` is the main operator interface for checking and changing service state. -->

The most common service commands answer whether a service is running and let you change that state intentionally:

```bash
$ systemctl status inventory-api
$ sudo systemctl start inventory-api
$ sudo systemctl stop inventory-api
$ sudo systemctl restart inventory-api
$ sudo systemctl reload nginx
$ systemctl is-enabled inventory-api
```

`status` gives the current state, recent logs, the main PID, and the unit file path. A healthy API might show `active (running)` with a main PID owned by the service.

`start` and `stop` affect the current boot. `enable` and `disable` affect future boots. That distinction matters on cloud VMs because a service can be running today and still fail to start after the next reboot.

```bash
$ sudo systemctl enable inventory-api
$ sudo systemctl disable inventory-api
```

After editing a unit file, systemd needs to reload unit definitions:

```bash
$ sudo systemctl daemon-reload
```

That command asks systemd to reread unit files. A changed service usually needs `systemctl restart inventory-api` afterward.

## Anatomy of the API Unit File
<!-- section-summary: A unit file declares what starts, which user it runs as, where it runs, and how systemd handles its lifecycle. -->

A systemd service is defined by a **unit file**. For a locally managed API, the file can live at `/etc/systemd/system/inventory-api.service`.

```ini
[Unit]
Description=Inventory API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=inventory-api
Group=inventory
WorkingDirectory=/srv/inventory-api/current
EnvironmentFile=/srv/inventory-api/config.env
ExecStart=/usr/bin/node /srv/inventory-api/current/server.js
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

The `[Unit]` section describes the service and its ordering. `After=network-online.target` means systemd should start this service after the network-online target has been reached. `Wants=network-online.target` asks systemd to pull that target into the transaction.

The `[Service]` section describes the process. `User` and `Group` run the API with limited privileges. `WorkingDirectory` sets the directory the process starts from. `EnvironmentFile` loads variables such as `NODE_ENV`, database URLs, or feature flags. `ExecStart` is the command systemd launches.

The `[Install]` section explains how enabling works. `WantedBy=multi-user.target` means the service should start during the normal multi-user server boot path when enabled.

This unit file also matches the deployment script from the shell article. The script updates `/srv/inventory-api/current`, and the service runs from that symlink. The service and deploy procedure agree on one release layout.

## Enable, Start, Restart, and Reload
<!-- section-summary: Service changes need the right verb because start, restart, reload, and enable affect different parts of runtime state. -->

The verbs sound similar, but they do different work.

| Command | What it does |
|---|---|
| `start` | Launches a stopped service now |
| `stop` | Stops a running service now |
| `restart` | Stops then starts the service |
| `reload` | Asks a service to reread config without a full stop, when supported |
| `enable` | Adds boot-time startup links |
| `disable` | Removes boot-time startup links |
| `daemon-reload` | Rereads unit files |

For the API, most code deployments use `restart` because the Node process needs to start from the new release. For Nginx config changes, `reload` is preferred after `nginx -t` because Nginx can replace workers gracefully without dropping the master process.

The practical flow after creating the API unit is:

```bash
$ sudo systemctl daemon-reload
$ sudo systemctl enable inventory-api
$ sudo systemctl start inventory-api
$ systemctl status inventory-api
$ curl --fail --silent --show-error http://127.0.0.1:3000/health
```

The practical flow after changing the unit file is:

```bash
$ sudo systemctl daemon-reload
$ sudo systemctl restart inventory-api
$ systemctl status inventory-api
$ journalctl -u inventory-api -n 50 --no-pager
```

Status and logs belong in the same workflow as the restart. A command returning successfully means systemd accepted the request. The service can still fail seconds later because the application could not bind a port, read config, or connect to a dependency.

## Environment Files and Working Directories
<!-- section-summary: Environment files and working directories make service runtime settings explicit and repeatable. -->

The environment is the set of variables available to a process. Application frameworks often read settings such as `NODE_ENV`, `PORT`, `DATABASE_URL`, or `LOG_LEVEL` from environment variables. systemd can load those variables from a file.

For our API, `/srv/inventory-api/config.env` might contain:

```ini
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgres://inventory_app@db.internal:5432/inventory
```

The unit file points to it:

```ini
EnvironmentFile=/srv/inventory-api/config.env
```

Permissions should protect this file because it may contain secrets:

```bash
$ sudo chown root:inventory /srv/inventory-api/config.env
$ sudo chmod 640 /srv/inventory-api/config.env
```

The `WorkingDirectory` setting also matters. Many applications read relative paths for templates, migrations, static files, or local config. Setting it in the unit file makes the runtime consistent across boot, restart, and manual operator actions.

After changing an environment file, restart the service:

```bash
$ sudo systemctl restart inventory-api
```

systemd reads the environment file when starting the service process. A running process does not automatically receive changes from the file.

## Dependencies, Ordering, and Targets
<!-- section-summary: systemd dependencies describe startup relationships, while targets group services into boot states. -->

systemd has two related ideas: dependencies and ordering. Dependencies decide what units are pulled into a transaction. Ordering decides which unit starts before another. `Wants=` and `Requires=` are dependency settings. `After=` and `Before=` are ordering settings.

`Wants=network-online.target` asks for the network-online target but lets the API still start if that target fails. `Requires=` is stricter and can stop the dependent unit when the required unit fails. For many application services, `Wants=` plus `After=` is a reasonable starting point for network readiness.

Targets group units. `multi-user.target` is the normal server state with networking and services but no graphical desktop. Enabling the API with `WantedBy=multi-user.target` makes it part of that boot state.

You can inspect relationships:

```bash
$ systemctl list-dependencies inventory-api
$ systemctl cat inventory-api
```

`systemctl cat` prints the active unit definition and any drop-in overrides. This is important in production because a service may have vendor defaults plus local overrides under directories like `/etc/systemd/system/inventory-api.service.d/`.

Use dependencies to describe real startup needs. Application retry problems still belong in the application. If the API depends on a database across the network, the service should handle temporary connection failures with retries. systemd ordering can help boot sequencing, while the application handles dependency health after startup.

## Read Service Logs with `journalctl`
<!-- section-summary: systemd captures service stdout and stderr in the journal, where `journalctl` can filter by unit, time, priority, and boot. -->

systemd captures service output in the journal. If the API writes logs to stdout and stderr, `journalctl` is the first place to inspect it.

Useful commands:

```bash
$ journalctl -u inventory-api -n 100 --no-pager
$ journalctl -u inventory-api -f
$ journalctl -u inventory-api --since "30 minutes ago"
$ journalctl -u inventory-api -p warning --since "today"
$ journalctl -u inventory-api -b
```

`-u` filters by unit. `-n` shows recent entries. `-f` follows new entries. `--since` filters by time. `-p warning` shows warning and more severe messages. `-b` limits output to the current boot.

Logs connect service management to incident work. After a restart, check status and recent logs together:

```bash
$ systemctl status inventory-api
$ journalctl -u inventory-api -n 50 --no-pager
```

If the service is crash-looping, the journal usually shows repeated start attempts, application stack traces, missing environment variables, permission errors, or port binding failures. That is more useful than only knowing the state is `failed`.

## Restart Policy and Resource Guardrails
<!-- section-summary: Restart policies and resource limits help services recover from simple failures and avoid consuming the entire VM. -->

`Restart=on-failure` tells systemd to restart the API after a nonzero exit, signal failure, timeout, or watchdog failure. It does not restart after a clean `systemctl stop`. `RestartSec=5s` waits five seconds before trying again.

That is a healthy default for a small API, but restart loops need limits. systemd has start-rate limiting through settings such as `StartLimitIntervalSec` and `StartLimitBurst` in the `[Unit]` section:

```ini
[Unit]
StartLimitIntervalSec=60
StartLimitBurst=5
```

With this, repeated failures stop after five starts in sixty seconds. The service enters a failed state instead of burning CPU forever. An operator can inspect logs, fix the problem, then clear the failure:

```bash
$ sudo systemctl reset-failed inventory-api
$ sudo systemctl start inventory-api
```

Resource guardrails can also live in the unit:

```ini
MemoryMax=512M
CPUQuota=80%
LimitNOFILE=8192
```

These settings limit memory, CPU share, and open files for the service. They are operational guardrails that need workload knowledge and monitoring. A memory limit that is too low can cause restarts during normal traffic, while no limit can let one broken process pressure the whole VM.

## Timers for Scheduled Work
<!-- section-summary: systemd timers run scheduled jobs with the same logging and unit management model as services. -->

Cron is still common, but systemd timers are a strong option on systemd servers. A timer activates a service on a schedule, and the job gets normal systemd logging and status.

A simple cleanup service might remove old release directories after the deployment script keeps enough history:

```ini
[Unit]
Description=Clean old inventory API releases

[Service]
Type=oneshot
ExecStart=/srv/inventory-api/scripts/cleanup-releases.sh
User=deploy
Group=inventory
```

The timer controls when it runs:

```ini
[Unit]
Description=Run inventory API release cleanup daily

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and inspect it:

```bash
$ sudo systemctl enable --now inventory-api-cleanup.timer
$ systemctl list-timers inventory-api-cleanup.timer
$ journalctl -u inventory-api-cleanup.service --since "today"
```

The same service habits apply. The job has a user, logs, status, and a unit file. That makes scheduled work easier to audit than a forgotten one-line cron entry.

## References

- [systemd.service manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) - Documents service unit options and lifecycle behavior.
- [systemd.unit manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html) - Documents unit dependencies, ordering, and install behavior.
- [systemd.exec manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) - Documents execution settings such as user, group, environment, limits, and working directory.
- [systemctl manual](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html) - Documents service management commands.
- [journalctl manual](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html) - Documents journal querying and filtering.
- [systemd.timer manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html) - Documents timer units and calendar schedules.
- [Nginx control signals](https://nginx.org/en/docs/control.html) - Official Nginx documentation for reloads and process control.
