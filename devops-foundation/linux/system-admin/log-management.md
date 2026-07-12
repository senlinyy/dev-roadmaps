---
title: "Log Management"
description: "Read, route, rotate, and ship Linux logs using journald, rsyslog, logrotate, and structured formats."
overview: "Manage Linux logs: read systemd, kernel, authentication, and Nginx evidence, rotate files safely, keep useful structure, and ship logs off the box."
tags: ["logs", "journalctl", "logrotate", "rsyslog"]
order: 5
id: article-devops-foundation-linux-system-admin-log-management
---

## Table of Contents

1. [Why Logs Are Operational Evidence](#why-logs-are-operational-evidence)
2. [Two Log Paths on One VM](#two-log-paths-on-one-vm)
3. [Where the Important Logs Live](#where-the-important-logs-live)
4. [Severity and Signal](#severity-and-signal)
5. [Query the Journal](#query-the-journal)
6. [Read Nginx Access and Error Logs](#read-nginx-access-and-error-logs)
7. [Rotate Logs with logrotate](#rotate-logs-with-logrotate)
8. [Structured Application Logs](#structured-application-logs)
9. [Ship Logs Off the VM](#ship-logs-off-the-vm)
10. [Common Log Failures](#common-log-failures)
11. [References](#references)

## Why Logs Are Operational Evidence
<!-- section-summary: Logs explain what the system, services, proxy, kernel, and authentication layer observed before, during, and after an issue. -->

A log investigation often starts with one uncomfortable sentence: "Users saw errors around 10:21." That is not enough to act on. Logs turn that vague report into concrete questions: did the service restart, did the kernel kill a process, did Nginx return `502`, did someone run `sudo`, or did a dependency timeout?

Good log management has two jobs. First, you need a quick path to the right evidence. Second, you need to keep the evidence from hurting the server. A log file that grows forever can fill `/`. A log line with a password can leak a secret. Logs that exist only on one VM can disappear when that VM is replaced.

The daily path is practical. The closest layer to the symptom comes first, then time and service filters, proxy logs for HTTP errors, safe rotation for file logs, structured fields for application logs, and central shipping for important evidence.

## Two Log Paths on One VM
<!-- section-summary: systemd services commonly log to journald, while Nginx commonly writes access and error logs as files under `/var/log/nginx`. -->

On a systemd server, two log paths are usually the first stops. One shows what services and the host reported through systemd. The other holds plain log files written by tools such as Nginx, authentication services, package managers, and application processes. A missing service error sends you to the journal. A `502` from Nginx sends you to Nginx files and then back to the app journal.

The first path is the **systemd journal**. systemd captures service output, service start and stop events, restart attempts, and many host-level messages. For example, if `app.service` exits and systemd restarts it, the journal records that lifecycle.

The second path is traditional files under `/var/log`. Nginx commonly writes request logs to `/var/log/nginx/access.log` and proxy errors to `/var/log/nginx/error.log`. Authentication and package tools may also write files under `/var/log`, depending on the distribution.

Both paths exist because Linux logging grew in layers. File logs are simple: a program opens a file and appends lines. They are easy to tail, rotate, copy, and inspect with standard text tools. The journal adds indexing and metadata around messages, so you can ask for one unit, one boot, one priority, one process, or one time window without scanning every file by hand.

Under the hood, journald stores entries with fields such as unit name, priority, boot ID, PID, UID, executable path, and message text. A file log usually stores the text format the application wrote. That difference explains the practical split: use the journal for service lifecycle context, and use file logs when the application or proxy writes its own request stream.

Check the service journal:

```bash
sudo journalctl -u app.service -n 5 --no-pager

# Example output:
# Jun 24 10:18:36 web-01 systemd[1]: Started app.service - Application service.
# Jun 24 10:18:37 web-01 app[1842]: listening on 127.0.0.1:3000
# Jun 24 10:20:01 web-01 app[1842]: request_id=req_7J2 method=GET path=/health status=200 duration_ms=8
```

Check a file log:

```bash
sudo tail -n 5 /var/log/nginx/error.log

# Example output:
# 2026/06/24 10:21:13 [error] 913#913: *44 connect() failed (111: Connection refused) while connecting to upstream, client: 203.0.113.42, server: example.com, request: "GET /api/items HTTP/1.1", upstream: "http://127.0.0.1:3000/api/items"
```

The journal tells you what the service and systemd saw. The Nginx log tells you what the proxy saw. Many incidents need both views because each layer records a different part of the same failure.

The next decision is to pick the layer closest to the symptom. If `systemctl status` says a service restarted, inspect the unit journal. If users see `502`, inspect Nginx access and error logs, then connect the timestamps to the service journal.

![Log evidence pipeline infographic showing one request connected through Nginx access logs, app JSON logs, journalctl, a central log store, and an incident timeline by request ID](/content-assets/articles/article-devops-foundation-linux-system-admin-log-management/log-evidence-pipeline.png)

_The image shows how one request can leave connected evidence across proxy logs, app logs, host logs, and a central log view._

## Where the Important Logs Live
<!-- section-summary: Knowing the common log locations lets operators start from the right evidence source. -->

During an incident, random log searching wastes time. A service crash, an HTTP `502`, a failed SSH login, and a disk error leave evidence in different places. The source closest to the symptom is the first useful place to inspect.

Think in layers. If users see an HTTP error, the proxy is closest to the user. Nginx access logs show which requests arrived and which status code Nginx returned. Nginx error logs show the proxy's complaint, such as connection refused, upstream timeout, permission denied, or config trouble.

If the proxy points at the application, move inward. The application service journal answers whether the service started, crashed, restarted, or logged an application error. If the service was killed by the host, move down to the kernel journal. Kernel logs show OOM kills, disk warnings, filesystem errors, and driver messages.

Other logs answer change questions. Authentication logs such as `/var/log/auth.log` or `/var/log/secure` show SSH and sudo activity. Package history, such as `/var/log/apt/history.log` or DNF history, shows maintenance changes. Boot logs from `journalctl -b` show what happened since the current boot.

Here is a concrete path through a common `502` incident. Users report errors at `10:21`. You check the Nginx access log for that minute and see repeated `502` responses for `/api/items`. That proves the requests reached Nginx and Nginx returned the client-facing error. The next useful question is why the proxy returned `502`, so you inspect the Nginx error log at the same timestamp.

The error log says `connect() failed (111: Connection refused)` for `127.0.0.1:3000`. That points away from Nginx syntax and toward the upstream app process. The next check is `journalctl -u app.service` around `10:21`. If the service journal says the app exited at `10:18` and restarted at `10:18:36`, the timeline now has a missing app process before the proxy errors. If the service journal says it was killed, query the kernel journal around `10:18` because an OOM kill or host-level fault may explain why the app disappeared.

Use the same path for other symptoms. A failed deploy usually starts in the service journal. A suspicious maintenance change sends you to sudo and package logs. Disk pressure sends you to kernel logs and the disk runbook. The goal is to follow the symptom through the layer that observed it, then move one layer inward or downward based on what the evidence proves.

## Severity and Signal
<!-- section-summary: Severity levels help filter logs, but good messages still need context such as request IDs, path, status, and duration. -->

Picture a noisy incident window where every request writes an `info` line. Hundreds of successful health checks and normal requests scroll past, while the warning about a slow export and the error about a killed service sit in the same stream. Severity gives you a way to reduce that noise before you inspect the details.

The first useful level is `info`, which usually means normal activity. A healthy request log line often belongs here. The next useful level is `warning`, which means something deserves attention even though the service may still be running. Above that, `err`, `crit`, `alert`, and `emerg` point to failure conditions with increasing urgency.

Severity is a hint from the program that wrote the message. Use it to narrow the stream, then check the surrounding fields and timestamps before deciding what happened. For example, a single `warning` about a slow export may explain a latency spike, while a `KILL` line from systemd pushes you toward kernel memory evidence.

| Severity | Meaning |
|---|---|
| `emerg` | System is unusable |
| `alert` | Immediate action needed |
| `crit` | Critical condition |
| `err` | Error condition |
| `warning` | Warning condition |
| `notice` | Normal but significant event |
| `info` | Informational message |
| `debug` | Detailed debugging output |

Filter a service to warnings and higher:

```bash
journalctl -u app.service -p warning --since "today" --no-pager

# Example output:
# Jun 24 09:58:12 web-01 app[1842]: level=warning request_id=req_8K9 path=/api/reports/export duration_ms=12004 message="request exceeded slow threshold"
# Jun 24 10:18:31 web-01 systemd[1]: app.service: Main process exited, code=killed, status=9/KILL
```

Severity is only one part of useful logging. A helpful log line also includes context: request ID, route, status, duration, safe user or tenant identifier, dependency name, and error type. Avoid secrets such as tokens, passwords, cookies, private keys, and full database URLs.

In production, a useful warning usually leads to a decision. A slow request warning may send you to latency graphs or database logs. A service `KILL` line may send you to kernel OOM logs. A flood of debug messages may send you to configuration because the logging level itself is now creating noise and storage pressure.

## Query the Journal
<!-- section-summary: `journalctl` filters service logs by unit, time, boot, priority, and follow mode. -->

Keep the same incident from the previous section. Users reported `502` responses at `10:21`, and Nginx said the upstream connection to `127.0.0.1:3000` was refused. The next question is about the app service: was it running at that time, or did it disappear before Nginx tried to connect?

`journalctl` filters the systemd journal. A service entry carries unit metadata, so `-u app.service` focuses the output on that one unit. Time filters then narrow the window around the incident. Kernel and command filters help only after the service evidence points in that direction.

Pull the latest app service entries:

```bash
journalctl -u app.service -n 10 --no-pager

# Example output:
# Jun 24 10:18:36 web-01 systemd[1]: Started app.service - Application service.
# Jun 24 10:18:37 web-01 app[1842]: listening on 127.0.0.1:3000
# Jun 24 10:20:01 web-01 app[1842]: request_id=req_7J2 method=GET path=/health status=200 duration_ms=8
```

This proves the app was running after `10:18:37` and handled a health request at `10:20:01`. It does not explain the `10:21` `502` yet. The next step is a tighter incident window so older normal startup lines do not crowd the evidence.

```bash
journalctl -u app.service --since "2026-06-24 10:17:00" --until "2026-06-24 10:23:00" --no-pager

# Example output:
# Jun 24 10:18:31 web-01 systemd[1]: app.service: Main process exited, code=killed, status=9/KILL
# Jun 24 10:18:36 web-01 systemd[1]: Started app.service - Application service.
# Jun 24 10:20:01 web-01 app[1842]: request_id=req_7J2 path=/health status=200 duration_ms=8
# Jun 24 10:21:13 web-01 app[1842]: request_id=req_8K9 path=/api/items status=500 duration_ms=12004 error=report_timeout
```

This proves two things. The app was killed at `10:18:31`, then came back. At `10:21:13`, the app handled `/api/items` but returned `500` after a slow operation. Nginx returned `502` for at least some client requests, so you now have two branches to check: the earlier kill event and the slow application error.

Filter to warnings and errors inside the same window:

```bash
journalctl -u app.service -p warning --since "2026-06-24 10:17:00" --until "2026-06-24 10:23:00" --no-pager

# Example output:
# Jun 24 10:18:31 web-01 systemd[1]: app.service: Main process exited, code=killed, status=9/KILL
# Jun 24 10:21:13 web-01 app[1842]: level=error request_id=req_8K9 path=/api/items error=report_timeout duration_ms=12004
```

The filtered output keeps the two strongest signals. The `KILL` line points to host-level evidence. The application error points to a slow report path. Check the kernel at the kill timestamp before assuming the application caused its own exit.

```bash
journalctl -k --since "2026-06-24 10:18:00" --until "2026-06-24 10:19:00" --no-pager

# Example output:
# Jun 24 10:18:31 web-01 kernel: Out of memory: Killed process 1842 (node) total-vm:1840420kB, anon-rss:742312kB
```

This proves the kernel killed the Node process because the host ran out of memory. The next step is to inspect memory usage, recent deploy changes, and systemd resource limits for `app.service`. It also explains why Nginx saw connection problems around the same period: the upstream process was gone or restarting.

Now check whether an operator action happened right before the kill:

```bash
journalctl _COMM=sudo --since "2026-06-24 09:45:00" --until "2026-06-24 10:19:00" --no-pager

# Example output:
# Jun 24 10:05:12 web-01 sudo[1720]: deploy : TTY=pts/0 ; PWD=/srv/app ; USER=root ; COMMAND=/usr/bin/systemctl restart app.service
```

This proves someone restarted the service before the OOM kill. Treat the restart as a deploy or maintenance timestamp to compare against release notes, package history, and app logs before deciding what caused the memory spike.

After you apply a fix, live-follow the unit during the restart:

```bash
journalctl -u app.service -f

# Example output:
# Jun 24 10:34:01 web-01 systemd[1]: Started app.service - Application service.
# Jun 24 10:34:02 web-01 app[2101]: listening on 127.0.0.1:3000
# Jun 24 10:34:09 web-01 app[2101]: request_id=req_9A2 path=/api/items status=200 duration_ms=51
```

This proves the service started, bound to the expected port, and served a successful request after the fix. At that point, keep the follow window open only long enough to confirm stability, then move the incident notes into a timeline: user symptom, Nginx result, app journal result, kernel evidence, operator action, fix, and verification.

## Read Nginx Access and Error Logs
<!-- section-summary: Nginx access logs show request outcomes, while error logs show proxy and upstream failures. -->

When users report `502` responses, the first question is whether the requests reached Nginx. The access log answers that because it records each request and the status code Nginx returned to the client.

After you confirm the `502`, the next question is why Nginx returned it. The error log answers the proxy side: connection refused, upstream timeout, bad gateway, permission problem, or a config issue. Access logs show the client-facing result. Error logs show the proxy's complaint.

Use the same incident timeline. At `10:21`, users reported errors for `/api/items`. The access log tells you whether this is one client, one route, one status code, or a broader traffic problem.

A typical access log line may look like this:

```log
203.0.113.42 - - [24/Jun/2026:10:21:13 +0000] "GET /api/items HTTP/1.1" 502 157 "-" "curl/8.0"
```

In the common combined log format, the fields are positional:

- Field `1` is the client IP, here `203.0.113.42`.
- Fields `4` and `5` hold the timestamp with timezone.
- Fields `6`, `7`, and `8` are the quoted request method, path, and protocol.
- Field `9` is the HTTP status code, here `502`, which is why the later `awk` command counts `$9`.
- Field `10` is the response size in bytes.
- The final quoted values are the referrer and user agent.

Sample recent `502` responses:

```bash
sudo grep " 502 " /var/log/nginx/access.log | tail

# Example output:
# 203.0.113.42 - - [24/Jun/2026:10:21:13 +0000] "GET /api/items HTTP/1.1" 502 157 "-" "curl/8.0"
# 203.0.113.42 - - [24/Jun/2026:10:21:14 +0000] "GET /api/items HTTP/1.1" 502 157 "-" "curl/8.0"
```

This proves Nginx received requests from `203.0.113.42` and returned `502` for `/api/items`. If the same minute has many `200` responses for other routes, the incident may be route-specific. If every route returns `502`, the upstream service or proxy configuration is a stronger suspect.

Count status codes:

```bash
sudo awk '{count[$9]++} END {for (code in count) print code, count[code]}' /var/log/nginx/access.log | sort

# Example output:
# 200 18420
# 301 54
# 404 82
# 502 23
```

Use the count as a size check, not a full diagnosis. `502 23` says the failure exists, while `200 18420` says the whole site was not down for the whole log period. A small `502` count may still matter if those requests hit checkout or login. After the count, narrow by time and path so the next command follows the actual incident:

```bash
sudo grep '24/Jun/2026:10:21' /var/log/nginx/access.log | grep ' /api/items '

# Example output:
# 203.0.113.42 - - [24/Jun/2026:10:21:13 +0000] "GET /api/items HTTP/1.1" 502 157 "-" "curl/8.0"
# 203.0.113.42 - - [24/Jun/2026:10:21:14 +0000] "GET /api/items HTTP/1.1" 502 157 "-" "curl/8.0"
```

This keeps the working set tied to the alert minute and route. The next step is client pattern, because repeated requests from one source have a different response than failures across many clients.

Find the busiest client IPs:

```bash
sudo awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -nr | head

# Example output:
#   742 203.0.113.42
#   221 198.51.100.17
#    98 192.0.2.55
```

The busiest-client result tells you where to aim the next check. If one IP dominates the failing minute, check whether it is a monitor, load test, scraper, NAT gateway, or real customer path. If many clients have the same `502`, focus on the upstream app because the failure is probably shared. The `$9` status-code command assumes the common combined log format. If your Nginx log format is custom, confirm which field holds the status code.

Now inspect the error log:

```bash
sudo tail -n 20 /var/log/nginx/error.log

# Example output:
# 2026/06/24 10:21:13 [error] 913#913: *44 connect() failed (111: Connection refused) while connecting to upstream, client: 203.0.113.42, server: example.com, request: "GET /api/items HTTP/1.1", upstream: "http://127.0.0.1:3000/api/items"
```

This error log line changes the investigation. Nginx could reach the client side, but the upstream connection to `127.0.0.1:3000` was refused. The next check is no longer "did Nginx receive the request?" It is "was the app listening on port `3000` at `10:21`?"

Search for upstream problems:

```bash
sudo grep -i "upstream" /var/log/nginx/error.log | tail

# Example output:
# 2026/06/24 10:21:13 [error] 913#913: *44 connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://127.0.0.1:3000/api/items"
# 2026/06/24 10:22:01 [error] 913#913: *57 upstream timed out (110: Connection timed out) while reading response header from upstream
```

Connection refused usually means nothing was listening on the backend port. Timeout means the upstream accepted the request or connection and did not respond quickly enough. Match these timestamps with the app journal:

```bash
journalctl -u app.service --since "2026-06-24 10:20:00" --until "2026-06-24 10:23:00" --no-pager

# Example output:
# Jun 24 10:21:13 web-01 app[1842]: request_id=req_8K9 path=/api/items status=500 duration_ms=12004 error=report_timeout
# Jun 24 10:22:03 web-01 app[1842]: request_id=req_8L2 path=/api/items status=200 duration_ms=48
```

This bridge tells you whether the app saw the same request window. If Nginx has connection refused and the app journal has a restart at the same timestamp, treat service availability as the main branch. If Nginx has upstream timeouts and the app journal has slow request errors, treat application latency or dependency slowness as the main branch. If Nginx has a request and the app has no matching log, check upstream address, port, firewall, process state, and whether request IDs are passed through.

## Rotate Logs with logrotate
<!-- section-summary: logrotate compresses, removes, and recreates log files so file logs do not fill the server. -->

A file-log problem often starts quietly. Access logs grow every day, rotation is missing or misconfigured, and then `/` fills during a traffic spike. `logrotate` prevents that by renaming old files, compressing archives, keeping a set number of copies, creating new files, and telling a service to reopen its logs.

The lifecycle is important. First, logrotate decides whether the file meets a rule such as daily rotation or size threshold. Then it moves the current file aside, optionally compresses older archives, creates a fresh file with the right owner and mode, and runs any `postrotate` commands. The service must then write to the fresh file. Services that keep the old file descriptor open can keep filling the old inode even after the filename changed.

A simplified Nginx rotation rule looks like this:

```logrotate
/var/log/nginx/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        kill -USR1 $(cat /run/nginx.pid) >/dev/null 2>&1 || true
    endscript
}
```

The important pieces in that rule:

- `/var/log/nginx/*.log` selects the log files this rule manages.
- `daily` checks the files for rotation once per day.
- `missingok` avoids a failure if one matching log file does not exist.
- `rotate 14` keeps fourteen old copies before removing older ones.
- `compress` reduces disk use for older rotated files.
- `delaycompress` leaves the newest rotated file uncompressed for one cycle, which helps services and humans that may still read it.
- `notifempty` skips empty logs so rotation does not create useless archives.
- `create 0640 www-data adm` creates the fresh log with permissions Nginx can write and administrators can read.
- `sharedscripts` runs the reopen action once for the whole pattern instead of once per log file.
- The `postrotate` block sends `USR1` to the Nginx master process. The master reopens the log files and assigns their ownership to the unprivileged worker user. A newly created file that temporarily shows `root:root` and mode `0600` does not prove that logging will fail after this reopen action. Check the master signal, the ownership after reopen, and whether new lines arrive before changing permissions. Without a reopen action, workers can keep writing through an old file descriptor after rotation.

Test a rule in debug mode:

```bash
sudo logrotate -d /etc/logrotate.d/nginx

# Example output:
# reading config file /etc/logrotate.d/nginx
# considering log /var/log/nginx/access.log
#   log needs rotating
# rotating pattern: /var/log/nginx/*.log  after 1 days (14 rotations)
```

`-d` prints what would happen without changing files. It is the safe check after editing a rotation rule.

Force a rotation only when you mean to test the real action:

```bash
sudo logrotate -f /etc/logrotate.d/nginx
```

This often prints no output when the rotation finishes without errors. Confirm the files and service state:

```bash
ls -lh /var/log/nginx

# Example output:
# -rw-r----- 1 www-data adm      0 Jun 24 10:30 access.log
# -rw-r----- 1 www-data adm   1.2M Jun 24 10:30 access.log.1
# -rw-r----- 1 www-data adm      0 Jun 24 10:30 error.log
```

```bash
sudo lsof +L1 | grep nginx
```

No output means this check did not find deleted-open Nginx files. Then check the service:

```bash
systemctl status nginx --no-pager

# Example output:
# nginx.service - A high performance web server and a reverse proxy server
#      Active: active (running) since Wed 2026-06-24 10:30:04 UTC; 15s ago
```

Journald retention uses different settings, usually in `journald.conf`, such as `SystemMaxUse`, `SystemKeepFree`, and `MaxRetentionSec`. On small VMs, set journal limits so system logs do not compete forever with application files.

The next decision is based on what rotation protects. If `/var/log/nginx` grows quickly, tune the Nginx logrotate rule or reduce noisy logging. If `/var/log/journal` grows quickly, set journald retention. If `lsof +L1` shows deleted-open logs, reload the owning service so disk space can return.

![Logrotate open file infographic showing a service writing to an old file handle until reload creates a fresh log target](/content-assets/articles/article-devops-foundation-linux-system-admin-log-management/logrotate-open-file.png)

_The image shows why rotation and service reload behavior must agree, especially for busy logs._

## Structured Application Logs
<!-- section-summary: Structured logs make request and error analysis easier because fields can be filtered without fragile string parsing. -->

During a small incident, a plain sentence in a log may be fine. During a larger incident, operators need to ask questions across thousands of lines: which route returned `500`, which request ID failed, and which requests took more than ten seconds?

Structured logs make those questions easier by writing the same fields every time, often as JSON. Stable fields let log systems filter `status`, `duration_ms`, `request_id`, and `error` directly. For example, searching `error=report_timeout` is more reliable than searching every possible sentence an application might print about a slow report.

A successful request might look like:

```json
{"level":"info","time":"2026-06-24T10:20:01Z","request_id":"req_7J2","method":"GET","path":"/api/items","status":200,"duration_ms":42}
```

An error might look like:

```json
{"level":"error","time":"2026-06-24T10:21:13Z","request_id":"req_8K9","path":"/api/reports/export","status":500,"duration_ms":12004,"error":"report_timeout"}
```

The fields make the log searchable:

- `level` lets operators filter normal traffic away from warnings and errors.
- `time` records an unambiguous timestamp that can line up with Nginx, kernel, and central logging records.
- `request_id` connects the proxy log, application log, and any downstream service log for one request.
- `method`, `path`, and `status` describe what the client asked for and what the application returned.
- `duration_ms` exposes slow requests without parsing a sentence.
- `error` gives a stable failure code that dashboards and alerts can count.

The request ID is the bridge. If Nginx and the application both log the same request ID, you can follow one failing request across the proxy and application layers. Stable field names also help central logging systems filter by route, status, duration, or error type.

Keep structure practical. Use unambiguous timestamps such as ISO 8601. Avoid secrets. Keep high-volume debug logging disabled during normal production work because it can increase cost, fill disks, and bury warnings.

The next decision is schema discipline. Choose a small set of fields that appear on every request log, add extra fields only when they help debugging, and keep names stable across releases. A central search is much more useful when `request_id`, `level`, `status`, and `duration_ms` mean the same thing for every service.

## Ship Logs Off the VM
<!-- section-summary: Central log shipping preserves evidence when the VM fails and lets teams search across services. -->

SSH debugging often starts with local logs, and production teams usually send important logs to a central system too. Central logs survive VM replacement, support search across hosts, and make alerting easier. The exact tool varies by company: rsyslog, journald forwarding, Fluent Bit, Vector, cloud logging agents, and vendor agents are all common.

Central shipping exists because a single VM is a fragile evidence store. The server can be replaced, the disk can fill, or an attacker can remove local evidence. Shipping also lets teams ask cross-service questions, such as whether every web VM saw the same error spike.

Under the hood, a local agent reads from files, journald, or both. It batches entries, attaches host and service labels, buffers during short network failures, and sends data to a collector or logging platform. Backpressure matters because a broken logging path should not take down the application by filling disk or blocking writes.

A simple rsyslog forwarding rule can look like:

```rsyslog
*.* @@logs.internal.example.com:514
authpriv.* @@security-logs.internal.example.com:514
```

The rule has a few important parts:

- `*.*` forwards all facilities and severities to the general log collector.
- `authpriv.*` sends authentication-sensitive logs to a separate security collector.
- `@@` means TCP forwarding. A single `@` means UDP.
- `logs.internal.example.com:514` is the collector host and port.
- Real production setups usually add TLS, buffering, authentication, and backpressure handling.

Validate rsyslog config syntax:

```bash
sudo rsyslogd -N1

# Example output:
# rsyslogd: version 8.2302.0, config validation run
# rsyslogd: End of config validation run. Bye.
```

Restart and check the forwarder:

```bash
sudo systemctl restart rsyslog
systemctl status rsyslog --no-pager

# Example output:
# rsyslog.service - System Logging Service
#      Active: active (running) since Wed 2026-06-24 10:40:11 UTC; 5s ago
```

Send a test message:

```bash
logger "devpolaris log shipping test"
```

`logger` often prints no output after sending the test message. Then confirm the message either in the local journal or the central logging system:

```bash
journalctl --since "1 minute ago" --no-pager | grep "devpolaris log shipping test"

# Example output:
# Jun 24 10:40:28 web-01 deploy[2210]: devpolaris log shipping test
```

Keep short local retention even when shipping works. Local logs help when the network path to the logging system is down or delayed.

The next decision is reliability. Use local retention for quick SSH debugging, central shipping for long-term search and alerting, and health checks for the forwarder. If central logs go quiet while local logs continue, investigate the agent, network route, credentials, and buffer usage.

## Common Log Failures
<!-- section-summary: Log systems fail through disk growth, missing rotation, noisy debug output, secret leaks, time drift, and broken shipping. -->

Log failures usually appear while you are already solving another problem. The app was slow, users saw `502`, or the disk filled. The useful habit is to ask what the log system itself proved, then fix the evidence path as carefully as the application.

Disk growth is the most common path. Suppose `/` reaches `98%` used during an outage, and `/var/log` is the largest directory. You confirm it with `df -hT /` and `sudo du -x -h --max-depth=1 /var | sort -h`. If Nginx access logs own the space, the next action is log rotation or reducing noisy access logs. If application debug logs own the space, turn off debug mode, set a time limit for any future debug window, and make sure rotation covers the file.

Rotation can also run without freeing space. That usually means the filename changed, while the service kept writing through an old file descriptor. Check it directly:

```bash
sudo lsof +L1 | grep nginx

# Example output:
# nginx 913 www-data 7w REG 252,1 9126805504 0 812 /var/log/nginx/access.log (deleted)
```

This proves Nginx still holds a deleted log file open. The practical fix is to correct the logrotate `create` owner and mode if needed, then reload Nginx so it opens the current log files:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo lsof +L1 | grep nginx

# Example output:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
```

No output from the final `lsof` pipeline means this check did not find deleted-open Nginx logs. The next verification is `df -hT /` so you know the filesystem actually recovered space.

Missing error logs need a different path. Suppose `/var/log/nginx/error.log` stays empty during `502` errors. Check ownership and permissions:

```bash
ls -l /var/log/nginx/error.log

# Example output:
# -rw------- 1 root root 0 Jun 24 10:30 /var/log/nginx/error.log
```

This shows the live error log is currently owned by `root:root` with mode `0600`, but that snapshot alone does not prove logging has failed. During normal rotation, the Nginx master process receives `USR1`, reopens the log files, and assigns ownership to the unprivileged worker user. Check that the signal reached the master process, inspect ownership again after the reopen, and confirm whether new lines arrive. If the file remains inaccessible after that sequence, correct the logrotate rule, rotate or recreate the file safely, and verify logging again.

Noisy debug output is another evidence failure. If important warnings are buried under thousands of debug lines, the logging level needs an owner and an expiry time. Check the service environment or config first:

```bash
systemctl show app.service -p Environment --no-pager

# Example output:
# Environment=LOG_LEVEL=debug NODE_ENV=production
```

That output says the service is still running with debug logging. Change debug logging back to the normal level after the investigation, restart or reload the service according to its design, then verify the journal or file logs show warnings and errors without overwhelming normal request records.

Secret leaks are security incidents, not formatting mistakes. If logs contain tokens, passwords, cookies, authorization headers, private keys, or full database URLs, remove the source of the leak, rotate the exposed secret, and treat stored logs as sensitive data. After the fix, run a targeted search for the pattern that leaked:

```bash
sudo grep -R --line-number -E "Authorization:|password=|DATABASE_URL=" /var/log/nginx /var/log/app 2>/dev/null

# Example output:
# /var/log/app/app.log.1:1842:Authorization: Bearer eyJhbGci...
```

One match means the old log archive still contains sensitive data. The next steps are secret rotation, access review for stored logs, and retention cleanup according to the team's incident policy.

Timeline problems can break an otherwise good investigation. If Nginx says `10:21`, the app says `10:18`, and the central log system shows another time, verify host time sync and timezone handling before trusting the order of events:

```bash
timedatectl status

# Example output:
# System clock synchronized: yes
#               Time zone: UTC
```

This proves whether the host clock is synchronized and which timezone the host reports. Good incident notes need timestamps that line up across Nginx, the application journal, the kernel, and central logs.

Shipping failures show up when local logs continue while central logs go quiet. Check the forwarder service, its journal, its buffer path, and network access to the collector:

```bash
systemctl status rsyslog --no-pager
journalctl -u rsyslog -n 20 --no-pager

# Example output:
# rsyslog.service - System Logging Service
#      Active: active (running)
# Jun 24 10:42:11 web-01 rsyslogd[1221]: action 'forward-logs' resumed
```

`active (running)` tells you the forwarder process is alive. The journal line tells you whether forwarding resumed or failed. A healthy logging design keeps short local retention for SSH debugging and central shipping for longer search and alerting.

Good log management makes the next incident shorter. The server keeps enough local detail to debug quickly, rotates logs before they fill storage, and sends evidence to a central place before the VM disappears.

![Log management summary infographic showing journal logs, access logs, severity, rotation, structured logs, shipping, and failure checks](/content-assets/articles/article-devops-foundation-linux-system-admin-log-management/log-management-summary.png)

_The summary image gathers the log sources and maintenance checks operators use during incidents._

## References

- [journalctl manual](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html) - Documents querying and filtering the systemd journal.
- [journald.conf manual](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html) - Documents journal storage and retention settings.
- [Nginx log module](https://nginx.org/en/docs/http/ngx_http_log_module.html) - Documents access log configuration and log formats.
- [Nginx core module error_log](https://nginx.org/en/docs/ngx_core_module.html#error_log) - Documents Nginx error log configuration and severity.
- [Controlling Nginx](https://nginx.org/en/docs/control.html) - Documents the `USR1` log reopen process and ownership change performed by the master process.
- [logrotate manual](https://man7.org/linux/man-pages/man8/logrotate.8.html) - Documents rotation options and testing flags.
- [rsyslog basic configuration](https://www.rsyslog.com/doc/configuration/index.html) - Official rsyslog configuration documentation.
- [systemd journal fields](https://www.freedesktop.org/software/systemd/man/latest/systemd.journal-fields.html) - Documents structured fields stored by the journal.
