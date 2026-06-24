---
title: "Log Management"
description: "Read, route, rotate, and ship Linux logs using journald, rsyslog, logrotate, and structured formats."
overview: "Manage logs for a Linux API VM: read systemd and Nginx logs, rotate files safely, keep useful structure, and ship evidence off the box."
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
<!-- section-summary: Logs explain what the server, proxy, and API observed before, during, and after an issue. -->

When the `inventory-api` returns a slow response or a `502`, logs are the first evidence trail. Nginx logs show the public request and upstream behavior. The API service logs show application errors and request handling. Kernel logs show OOM kills, disk errors, and network messages. Authentication logs show sudo and SSH activity.

Good log management has two sides. You need to read logs quickly during an incident, and you need to keep logs from harming the server. A log file that grows without rotation can fill the root filesystem. A service that logs secrets can leak sensitive data. A VM that stores logs only locally can lose evidence when the disk dies.

The goal is practical: know where logs live, query them by service and time, rotate file logs safely, keep application logs structured, and ship important logs to a central place.

## Two Log Paths on One VM
<!-- section-summary: systemd services commonly log to journald, while Nginx commonly writes access and error logs as files under `/var/log/nginx`. -->

The API VM has two main log paths.

The first path is the **systemd journal**. When `inventory-api.service` writes to stdout or stderr, systemd captures that output in journald. You read it with `journalctl -u inventory-api`. systemd also records service starts, stops, failures, and restart attempts.

The second path is traditional log files under `/var/log`. Nginx commonly writes `/var/log/nginx/access.log` and `/var/log/nginx/error.log`. Authentication logs, package logs, kernel logs, and other service logs may also appear under `/var/log`, depending on the distribution and logging stack.

Both paths matter. The journal is excellent for unit-based service logs and boot filtering. Nginx access logs are excellent for request-level HTTP analysis. Real incidents often need both:

```bash
$ sudo journalctl -u inventory-api --since "30 minutes ago" --no-pager
$ sudo tail -n 100 /var/log/nginx/error.log
$ sudo grep " 502 " /var/log/nginx/access.log | tail
```

This gives the backend story, the proxy error story, and the client request story.

## Where the Important Logs Live
<!-- section-summary: Knowing the common log locations lets operators start from the right evidence source. -->

Log locations vary by distribution, but these paths are common on a systemd VM:

| Log source | Common command or path | What it answers |
|---|---|---|
| API service | `journalctl -u inventory-api` | Did the app start, crash, or report errors? |
| Nginx access | `/var/log/nginx/access.log` | Which requests arrived and what status they returned |
| Nginx error | `/var/log/nginx/error.log` | Proxy failures, upstream connection errors, config issues |
| Kernel | `journalctl -k` or `dmesg` | OOM kills, disk errors, driver messages |
| Authentication | `/var/log/auth.log` or `/var/log/secure` | SSH and sudo activity |
| Package changes | `/var/log/apt/history.log` or DNF history | What packages changed during maintenance |
| Boot logs | `journalctl -b` | What happened since the current boot |

For the API service, prefer journald through systemd. For Nginx request analysis, prefer access logs. For host-level failures, check kernel and authentication logs. Choosing the right source saves time because each layer sees a different part of the request path.

## Severity and Signal
<!-- section-summary: Severity levels help filter logs, but good messages still need context such as request IDs, path, status, and duration. -->

Logs usually carry a severity level. Syslog-style severities run from emergency down to debug:

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

Severity helps filter noise:

```bash
$ journalctl -u inventory-api -p warning --since "today"
```

The quality of a log message still depends on context. A useful API error log includes a request ID, route, status, duration, and error type. A weak log says only "failed" and forces the operator to guess.

For the API, aim for logs that answer these questions: which request was involved, what user or tenant context is safe to include, which dependency failed, how long it took, and whether the request ID also appears in Nginx logs. Avoid logging secrets such as tokens, passwords, private keys, and full connection strings.

## Query the Journal
<!-- section-summary: `journalctl` filters service logs by unit, time, boot, priority, and follow mode. -->

`journalctl` is the main tool for systemd logs. The most useful service queries are:

```bash
$ journalctl -u inventory-api -n 100 --no-pager
$ journalctl -u inventory-api --since "1 hour ago" --no-pager
$ journalctl -u inventory-api -f
$ journalctl -u inventory-api -p warning --since "today"
$ journalctl -u inventory-api -b
```

These commands show recent logs, time-bounded logs, live logs, warning-and-higher logs, and logs from the current boot. `--no-pager` makes output easier to capture in scripts or incident notes.

JSON output can help when logs include structured fields:

```bash
$ journalctl -u inventory-api --since "10 minutes ago" -o json
```

For host-level events:

```bash
$ journalctl -k --since "1 hour ago"
$ journalctl _COMM=sudo --since "today"
```

The first command shows kernel messages. The second filters entries from the `sudo` command. During incident review, these can explain whether the service restarted because of OOM, whether a disk error appeared, or which privileged command ran before the issue.

## Read Nginx Access and Error Logs
<!-- section-summary: Nginx access logs show request outcomes, while error logs show proxy and upstream failures. -->

Nginx access logs usually contain client IP, timestamp, request line, status, bytes sent, referrer, and user agent. A line may look like:

```log
203.0.113.42 - - [24/Jun/2026:09:14:03 +0000] "GET /api/items HTTP/1.1" 200 842 "-" "curl/8.0"
```

The access log answers request questions:

```bash
$ sudo grep " 502 " /var/log/nginx/access.log | tail
$ sudo awk '{count[$9]++} END {for (code in count) print code, count[code]}' /var/log/nginx/access.log | sort
$ sudo awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -nr | head
```

The error log answers proxy questions:

```bash
$ sudo tail -n 100 /var/log/nginx/error.log
$ sudo grep -i "upstream" /var/log/nginx/error.log | tail
```

Common Nginx upstream errors include connection refused, timeout, and invalid response from upstream. Connection refused usually means Nginx reached the VM but nothing was listening on the backend port. Timeout means the upstream accepted the connection or request path but did not answer in time. Those meanings guide the next check: process status, API logs, CPU and memory, or network dependency.

## Rotate Logs with logrotate
<!-- section-summary: logrotate compresses, removes, and recreates log files so file logs do not fill the server. -->

File logs need rotation. **logrotate** is the standard tool that renames old logs, compresses them, keeps a set number of archives, and signals services when needed. Nginx packages usually install a rotation config automatically.

A simplified Nginx rotation rule looks like:

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

This rotates daily, keeps fourteen archives, compresses old logs, skips empty logs, creates new files with specific ownership, and reloads Nginx so it reopens log files. The reload step matters because of deleted-but-open files from the disk article.

Test a logrotate config without waiting:

```bash
$ sudo logrotate -d /etc/logrotate.d/nginx
```

The `-d` flag runs debug mode and prints what would happen. A forced rotation can be tested carefully in non-peak time:

```bash
$ sudo logrotate -f /etc/logrotate.d/nginx
```

For journald, retention is configured differently through `journald.conf` settings such as `SystemMaxUse`, `SystemKeepFree`, and `MaxRetentionSec`. On a small VM, set journal limits so service logs do not compete forever with the root filesystem.

## Structured Application Logs
<!-- section-summary: Structured logs make request and error analysis easier because fields can be filtered without fragile string parsing. -->

Plain text logs are easy to read, but structured logs are easier to search and aggregate. A structured log writes fields consistently, often as JSON. The API might log one request like this:

```json
{"level":"info","time":"2026-06-24T09:14:03Z","request_id":"req_7J2","method":"GET","path":"/api/items","status":200,"duration_ms":42}
```

An error might include safe context:

```json
{"level":"error","time":"2026-06-24T09:15:10Z","request_id":"req_8K9","path":"/api/reports/export","status":500,"duration_ms":12004,"error":"report_timeout"}
```

The request ID is the bridge. Nginx can include the same ID in access logs, and the application can include it in its own logs. During an incident, one failing request can be traced through proxy and API layers.

Structured logs need discipline. Use stable field names. Keep timestamps in an unambiguous format such as ISO 8601. Avoid secrets. Keep high-volume debug logs disabled in normal production because they can increase cost, fill disks, and hide important warnings.

## Ship Logs Off the VM
<!-- section-summary: Central log shipping preserves evidence when the VM fails and lets teams search across services. -->

Local logs help during SSH debugging, but production teams usually ship logs to a central system. Central storage protects evidence when the VM is replaced, gives search across multiple servers, and supports alerts and dashboards.

Common shipping paths include an agent that reads journald and files, rsyslog forwarding, or a cloud provider's logging agent. The exact tool varies by company, but the principle stays the same: important logs leave the VM quickly and include enough metadata to identify host, service, environment, and version.

A simple rsyslog forwarding rule can look like:

```rsyslog
*.* @@logs.internal.example.com:514
authpriv.* @@security-logs.internal.example.com:514
```

The `@@` form uses TCP. A single `@` uses UDP. TCP gives delivery behavior that is usually better for important logs, although real production setups often add TLS, buffering, authentication, and backpressure handling.

When logs are shipped, still keep local retention. Local logs are valuable when the network to the logging system is down or when the central system is delayed. The balance is usually short local retention plus longer central retention.

## Common Log Failures
<!-- section-summary: Log systems fail through disk growth, missing rotation, noisy debug output, secret leaks, time drift, and broken shipping. -->

A few log failures appear repeatedly.

**Disk growth** happens when access logs or debug logs grow faster than rotation expects. The disk article's `du`, `df`, and `lsof +L1` checks confirm the storage side.

**Missing reopen after rotation** happens when a service keeps writing to the old file descriptor. Nginx reloads solve this for Nginx logs. Other services may need their own signal, restart, or logging configuration.

**Noisy debug logs** can hide important messages and fill disks. Debug mode should have an owner, a time limit, and a rollback plan.

**Secret leaks** happen when logs include tokens, passwords, cookies, authorization headers, private keys, or full database URLs. Logging policy should treat secrets as production data exposure, not as harmless text.

**Time drift** makes incident timelines confusing. Servers should use time synchronization so Nginx, API, kernel, and central log timestamps line up.

**Broken shipping** leaves the central log system blind. Agents and forwarders need health checks, local buffering, and alerts when they fall behind.

Good log management makes the next incident shorter. The server keeps enough local detail to debug quickly, rotates logs before they fill storage, and sends evidence to a central place before the VM disappears.

## References

- [journalctl manual](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html) - Documents querying and filtering the systemd journal.
- [journald.conf manual](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html) - Documents journal storage and retention settings.
- [Nginx log module](https://nginx.org/en/docs/http/ngx_http_log_module.html) - Documents access log configuration and log formats.
- [Nginx core module error_log](https://nginx.org/en/docs/ngx_core_module.html#error_log) - Documents Nginx error log configuration and severity.
- [logrotate manual](https://man7.org/linux/man-pages/man8/logrotate.8.html) - Documents rotation options and testing flags.
- [rsyslog basic configuration](https://www.rsyslog.com/doc/configuration/index.html) - Official rsyslog configuration documentation.
- [systemd journal fields](https://www.freedesktop.org/software/systemd/man/latest/systemd.journal-fields.html) - Documents structured fields stored by the journal.
