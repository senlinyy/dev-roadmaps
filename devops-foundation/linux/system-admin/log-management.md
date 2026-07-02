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

During an incident, symptoms alone leave too much guessing. The log trail helps answer concrete questions: did the service restart, did the kernel kill a process, did Nginx return `502`, did someone run `sudo`, or did a dependency timeout?

Good log management has two jobs. First, you need a quick path to the right logs. Second, you need to keep logs from hurting the server. A log file that grows forever can fill `/`. A log line with a password can leak a secret. Logs that exist only on one VM can disappear when that VM is replaced.

The daily path is practical: find the right log source, filter by time and service, inspect proxy logs, rotate file logs safely, keep application logs structured, and ship important logs away from the VM.

## Two Log Paths on One VM
<!-- section-summary: systemd services commonly log to journald, while Nginx commonly writes access and error logs as files under `/var/log/nginx`. -->

On a systemd server, two log paths are usually the first stops. One shows what services and the host reported through systemd. The other holds plain log files written by tools such as Nginx, authentication services, package managers, and application processes.

The first path is the **systemd journal**. systemd captures service output, service start and stop events, restart attempts, and many host-level messages. You read it with `journalctl`.

The second path is traditional files under `/var/log`. Nginx commonly writes request logs to `/var/log/nginx/access.log` and proxy errors to `/var/log/nginx/error.log`. Authentication and package tools may also write files under `/var/log`, depending on the distribution.

Both paths exist because Linux logging grew in layers. File logs are simple: a program opens a file and appends lines. They are easy to tail, rotate, copy, and inspect with standard text tools. The journal adds indexing and metadata around messages, so you can ask for one unit, one boot, one priority, one process, or one time window without scanning every file by hand.

Under the hood, journald stores entries with fields such as unit name, priority, boot ID, PID, UID, executable path, and message text. A file log usually stores only the text format the application wrote. That difference explains the practical split: use the journal when you need service lifecycle context, and use file logs when the application or proxy writes its own request stream.

Check the service journal:

```bash
sudo journalctl -u app.service -n 5 --no-pager
```

Example output:

```console
Jun 24 10:18:36 web-01 systemd[1]: Started app.service - Application service.
Jun 24 10:18:37 web-01 app[1842]: listening on 127.0.0.1:3000
Jun 24 10:20:01 web-01 app[1842]: request_id=req_7J2 method=GET path=/health status=200 duration_ms=8
```

Check a file log:

```bash
sudo tail -n 5 /var/log/nginx/error.log
```

Example output:

```console
2026/06/24 10:21:13 [error] 913#913: *44 connect() failed (111: Connection refused) while connecting to upstream, client: 203.0.113.42, server: example.com, request: "GET /api/items HTTP/1.1", upstream: "http://127.0.0.1:3000/api/items"
```

The journal tells you what the service and systemd saw. The Nginx log tells you what the proxy saw. Many incidents need both views because each layer records a different part of the same failure.

The next decision is to pick the layer closest to the symptom. If `systemctl status` says a service restarted, inspect the unit journal. If users see `502`, inspect Nginx access and error logs, then connect the timestamps to the service journal.

## Where the Important Logs Live
<!-- section-summary: Knowing the common log locations lets operators start from the right evidence source. -->

During an incident, random log searching wastes time. A service crash, an HTTP `502`, a failed SSH login, and a disk error leave evidence in different places, so pick the source that sits closest to the symptom.

For a crash, the service journal usually shows the process exit and restart. For a `502`, Nginx access logs show the client-facing status while Nginx error logs show what happened when the proxy contacted the upstream. For host pressure, the kernel journal may show OOM kills, disk warnings, or driver messages.

| Log source | Common command or path | What it answers |
|---|---|---|
| Application service | `journalctl -u app.service` | Did the app start, crash, or report errors? |
| Nginx access | `/var/log/nginx/access.log` | Which requests arrived and what status they returned |
| Nginx error | `/var/log/nginx/error.log` | Proxy failures, upstream connection errors, config issues |
| Kernel | `journalctl -k` or `dmesg` | OOM kills, disk errors, driver messages |
| Authentication | `/var/log/auth.log` or `/var/log/secure` | SSH and sudo activity |
| Package changes | `/var/log/apt/history.log` or DNF history | What packages changed during maintenance |
| Boot logs | `journalctl -b` | What happened since the current boot |

Here is a concrete path through a common `502` incident. Users report errors at `10:21`, so you check the Nginx access log for that minute and see repeated `502` responses for `/api/items`. The Nginx error log at the same timestamp says `connect() failed (111: Connection refused)` for `127.0.0.1:3000`. That moves the investigation from Nginx to the app service, where `journalctl -u app.service` shows the application exited at `10:18` and restarted at `10:18:36`. If the service journal says it was killed, the next evidence source is the kernel journal around `10:18`, because an OOM kill or host-level fault may explain why the app disappeared.

For a failed deploy, the service journal is usually the first source. For `502` responses, combine Nginx error logs with the service journal. For host pressure, check the kernel journal. For a suspicious change, check authentication and package logs.

## Severity and Signal
<!-- section-summary: Severity levels help filter logs, but good messages still need context such as request IDs, path, status, and duration. -->

Picture a noisy incident window where every request writes an `info` line. Hundreds of successful health checks and normal requests scroll past, while the warning about a slow export and the error about a killed service sit in the same stream. Severity gives you a way to reduce that noise before you inspect the details.

The first useful level is `info`, which usually means normal activity. A healthy request log line often belongs here. The next useful level is `warning`, which means something deserves attention even though the service may still be running. Above that, `err`, `crit`, `alert`, and `emerg` point to failure conditions with increasing urgency.

Severity is a hint from the program that wrote the message. Use it to narrow the stream, then check the surrounding fields and timestamps before deciding what happened.

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
```

Example output:

```console
Jun 24 09:58:12 web-01 app[1842]: level=warning request_id=req_8K9 path=/api/reports/export duration_ms=12004 message="request exceeded slow threshold"
Jun 24 10:18:31 web-01 systemd[1]: app.service: Main process exited, code=killed, status=9/KILL
```

Severity is only one part of useful logging. A helpful log line also includes context: request ID, route, status, duration, safe user or tenant identifier, dependency name, and error type. Avoid secrets such as tokens, passwords, cookies, private keys, and full database URLs.

In production, a useful warning usually leads to a decision. A slow request warning may send you to latency graphs or database logs. A service `KILL` line may send you to kernel OOM logs. A flood of debug messages may send you to configuration because the logging level itself is now creating noise and storage pressure.

## Query the Journal
<!-- section-summary: `journalctl` filters service logs by unit, time, boot, priority, and follow mode. -->

Suppose the application restarted around `10:18`, and users noticed errors a few minutes later. The useful question is narrow: what did this one service, this boot, and this time window report around the restart?

`journalctl` answers that by filtering the systemd journal. The first filter is usually the unit, such as `-u app.service`, because it keeps the output focused on one service. The next filter is time, such as `--since "1 hour ago"` or a deploy window. After that, priority, boot, command name, and kernel filters help widen or narrow the evidence.

The journal can do this because entries carry fields. A service entry has a unit field. A boot has a boot ID. A priority field records severity. `_COMM=sudo` filters by command name. These fields let you ask a precise question even when many services wrote logs at the same time.

For the latest service entries:

```bash
journalctl -u app.service -n 10 --no-pager
```

Example output:

```console
Jun 24 10:18:36 web-01 systemd[1]: Started app.service - Application service.
Jun 24 10:18:37 web-01 app[1842]: listening on 127.0.0.1:3000
Jun 24 10:20:01 web-01 app[1842]: request_id=req_7J2 method=GET path=/health status=200 duration_ms=8
```

For an alert window:

```bash
journalctl -u app.service --since "1 hour ago" --no-pager
```

Example output:

```console
Jun 24 09:42:10 web-01 app[1842]: request_id=req_7G1 path=/api/items status=200 duration_ms=44
Jun 24 10:18:31 web-01 systemd[1]: app.service: Main process exited, code=killed, status=9/KILL
Jun 24 10:18:36 web-01 systemd[1]: Started app.service - Application service.
```

For live debugging:

```bash
journalctl -u app.service -f
```

Example output:

```console
Jun 24 10:24:01 web-01 app[1901]: request_id=req_9A1 path=/health status=200 duration_ms=7
Jun 24 10:24:06 web-01 app[1901]: request_id=req_9A2 path=/api/items status=200 duration_ms=51
```

For the current boot:

```bash
journalctl -u app.service -b --no-pager
```

Example output:

```console
Jun 24 08:01:22 web-01 systemd[1]: Started app.service - Application service.
Jun 24 08:01:23 web-01 app[1204]: listening on 127.0.0.1:3000
```

For kernel events, such as OOM kills or disk errors:

```bash
journalctl -k --since "1 hour ago" --no-pager
```

Example output:

```console
Jun 24 10:18:31 web-01 kernel: Out of memory: Killed process 1842 (node) total-vm:1840420kB, anon-rss:742312kB
Jun 24 10:19:04 web-01 kernel: EXT4-fs warning (device vda1): ext4_dx_add_entry: Directory index full
```

For sudo activity:

```bash
journalctl _COMM=sudo --since "today" --no-pager
```

Example output:

```console
Jun 24 09:12:44 web-01 sudo[1720]: deploy : TTY=pts/0 ; PWD=/srv/app ; USER=root ; COMMAND=/usr/bin/systemctl restart app.service
```

These filters let you build a timeline: who changed something, what the service reported, and what the kernel saw.

The next decision after a journal query is usually a narrower time window or a different field. If the latest entries show only normal traffic, add `--since` around the alert. If the unit restarted, check `-p warning` for higher-severity entries and `journalctl -k` for kernel events at the same timestamp. If the issue started after a login or deploy, query `sudo` and package logs to find the change.

## Read Nginx Access and Error Logs
<!-- section-summary: Nginx access logs show request outcomes, while error logs show proxy and upstream failures. -->

When users report `502` responses, the first question is whether the requests reached Nginx. The access log answers that because it records each request and the status code Nginx returned to the client.

After you confirm the `502`, the next question is why Nginx returned it. The error log answers the proxy side: connection refused, upstream timeout, bad gateway, permission problem, or a config issue. Access logs show the client-facing result. Error logs show the proxy's complaint.

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
```

Example output:

```console
203.0.113.42 - - [24/Jun/2026:10:21:13 +0000] "GET /api/items HTTP/1.1" 502 157 "-" "curl/8.0"
203.0.113.42 - - [24/Jun/2026:10:21:14 +0000] "GET /api/items HTTP/1.1" 502 157 "-" "curl/8.0"
```

Count status codes:

```bash
sudo awk '{count[$9]++} END {for (code in count) print code, count[code]}' /var/log/nginx/access.log | sort
```

Example output:

```console
200 18420
301 54
404 82
502 23
```

Find the busiest client IPs:

```bash
sudo awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -nr | head
```

Example output:

```console
  742 203.0.113.42
  221 198.51.100.17
   98 192.0.2.55
```

The `$9` status-code command assumes the common combined log format. If your Nginx log format is custom, confirm which field holds the status code.

Now inspect the error log:

```bash
sudo tail -n 20 /var/log/nginx/error.log
```

Example output:

```console
2026/06/24 10:21:13 [error] 913#913: *44 connect() failed (111: Connection refused) while connecting to upstream, client: 203.0.113.42, server: example.com, request: "GET /api/items HTTP/1.1", upstream: "http://127.0.0.1:3000/api/items"
```

Search for upstream problems:

```bash
sudo grep -i "upstream" /var/log/nginx/error.log | tail
```

Example output:

```console
2026/06/24 10:21:13 [error] 913#913: *44 connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://127.0.0.1:3000/api/items"
2026/06/24 10:22:01 [error] 913#913: *57 upstream timed out (110: Connection timed out) while reading response header from upstream
```

Connection refused usually means nothing was listening on the backend port. Timeout means the upstream accepted the request or connection but did not respond quickly enough. Match these timestamps with `journalctl -u app.service` to see what the application reported at the same time.

## Rotate Logs with logrotate
<!-- section-summary: logrotate compresses, removes, and recreates log files so file logs do not fill the server. -->

File logs need rotation because a busy service can write many gigabytes over time. `logrotate` renames old files, compresses archives, keeps a set number of copies, creates new files, and can tell a service to reopen its logs.

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
        systemctl reload nginx >/dev/null 2>&1 || true
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
- `sharedscripts` runs the reload once for the whole pattern instead of once per log file.
- The `postrotate` block reloads Nginx so it reopens log files. Without that step, a service can keep writing to an old deleted file descriptor after rotation.

Test a rule in debug mode:

```bash
sudo logrotate -d /etc/logrotate.d/nginx
```

Example output:

```console
reading config file /etc/logrotate.d/nginx
considering log /var/log/nginx/access.log
  log needs rotating
rotating pattern: /var/log/nginx/*.log  after 1 days (14 rotations)
```

`-d` prints what would happen without changing files. It is the safe check after editing a rotation rule.

Force a rotation only when you mean to test the real action:

```bash
sudo logrotate -f /etc/logrotate.d/nginx
```

This often prints no output when the rotation finishes without errors. Confirm the files and service state:

```bash
ls -lh /var/log/nginx
```

Example output:

```console
-rw-r----- 1 www-data adm      0 Jun 24 10:30 access.log
-rw-r----- 1 www-data adm   1.2M Jun 24 10:30 access.log.1
-rw-r----- 1 www-data adm      0 Jun 24 10:30 error.log
```

```bash
sudo lsof +L1 | grep nginx
```

No output means this check did not find deleted-open Nginx files. Then check the service:

```bash
systemctl status nginx --no-pager
```

Example output:

```console
nginx.service - A high performance web server and a reverse proxy server
     Active: active (running) since Wed 2026-06-24 10:30:04 UTC; 15s ago
```

Journald retention uses different settings, usually in `journald.conf`, such as `SystemMaxUse`, `SystemKeepFree`, and `MaxRetentionSec`. On small VMs, set journal limits so system logs do not compete forever with application files.

The next decision is based on what rotation protects. If `/var/log/nginx` grows quickly, tune the Nginx logrotate rule or reduce noisy logging. If `/var/log/journal` grows quickly, set journald retention. If `lsof +L1` shows deleted-open logs, reload the owning service so disk space can return.

## Structured Application Logs
<!-- section-summary: Structured logs make request and error analysis easier because fields can be filtered without fragile string parsing. -->

During a small incident, a plain sentence in a log may be fine. During a larger incident, operators need to ask questions across thousands of lines: which route returned `500`, which request ID failed, and which requests took more than ten seconds?

Structured logs make those questions easier by writing the same fields every time, often as JSON. Stable fields let log systems filter `status`, `duration_ms`, `request_id`, and `error` directly. If every service invents its own wording, searches turn into fragile string matching.

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
```

Example output:

```console
rsyslogd: version 8.2302.0, config validation run
rsyslogd: End of config validation run. Bye.
```

Restart and check the forwarder:

```bash
sudo systemctl restart rsyslog
systemctl status rsyslog --no-pager
```

Example output:

```console
rsyslog.service - System Logging Service
     Active: active (running) since Wed 2026-06-24 10:40:11 UTC; 5s ago
```

Send a test message:

```bash
logger "devpolaris log shipping test"
```

`logger` often prints no output after sending the test message. Then confirm the message either in the local journal or the central logging system:

```bash
journalctl --since "1 minute ago" --no-pager | grep "devpolaris log shipping test"
```

Example output:

```console
Jun 24 10:40:28 web-01 deploy[2210]: devpolaris log shipping test
```

Keep short local retention even when shipping works. Local logs help when the network path to the logging system is down or delayed.

The next decision is reliability. Use local retention for quick SSH debugging, central shipping for long-term search and alerting, and health checks for the forwarder. If central logs go quiet while local logs continue, investigate the agent, network route, credentials, and buffer usage.

## Common Log Failures
<!-- section-summary: Log systems fail through disk growth, missing rotation, noisy debug output, secret leaks, time drift, and broken shipping. -->

After an incident, log problems usually show up as concrete review notes.

One note might say the server nearly ran out of disk during the outage. Access logs or debug logs grew faster than rotation expected. Confirm the storage side with `df`, `du`, and `lsof +L1` from the disk article, then tune rotation or reduce noisy output.

Another note might say rotation ran, yet space did not return. That points to a service still writing to the old file descriptor. Nginx reloads solve this for Nginx logs. Other services may need their own signal, reload command, or logging configuration.

A third note might say important warnings were buried. Debug mode can hide useful messages and fill disks, so it needs an owner, a time limit, and a rollback plan.

Security review may find secrets in logs: tokens, passwords, cookies, authorization headers, private keys, or full database URLs. Treat secrets in logs as production data exposure.

Timeline review may find that timestamps do not line up across Nginx, the application, the kernel, and the central log system. Time synchronization keeps incident timelines trustworthy.

Operations review may find that central logs went quiet while local logs continued. That points to broken shipping. Agents and forwarders need health checks, local buffering, and alerts when they fall behind.

Here is a short worked path. Users saw intermittent `502` responses, and the first review says "Nginx had no useful error logs." You check `/var/log/nginx/error.log` and find it empty because rotation created the file as `root:root` with mode `0600`. Nginx kept writing to an older deleted file, so disk space stayed high and the live filename stayed empty. The fix path is to correct the logrotate `create` owner and mode, force or wait for a safe rotation window, reload Nginx so it opens the new file, then confirm `lsof +L1` no longer shows deleted-open Nginx logs.

Good log management makes the next incident shorter. The server keeps enough local detail to debug quickly, rotates logs before they fill storage, and sends evidence to a central place before the VM disappears.

## References

- [journalctl manual](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html) - Documents querying and filtering the systemd journal.
- [journald.conf manual](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html) - Documents journal storage and retention settings.
- [Nginx log module](https://nginx.org/en/docs/http/ngx_http_log_module.html) - Documents access log configuration and log formats.
- [Nginx core module error_log](https://nginx.org/en/docs/ngx_core_module.html#error_log) - Documents Nginx error log configuration and severity.
- [logrotate manual](https://man7.org/linux/man-pages/man8/logrotate.8.html) - Documents rotation options and testing flags.
- [rsyslog basic configuration](https://www.rsyslog.com/doc/configuration/index.html) - Official rsyslog configuration documentation.
- [systemd journal fields](https://www.freedesktop.org/software/systemd/man/latest/systemd.journal-fields.html) - Documents structured fields stored by the journal.
