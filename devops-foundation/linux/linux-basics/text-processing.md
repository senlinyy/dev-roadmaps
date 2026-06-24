---
title: "Text Processing"
description: "Use grep, sed, awk, and pipes to search, transform, and analyze text streams and log files."
overview: "Use classic Linux text tools to inspect Nginx logs, service logs, config files, and deployment output for a small API running on a VM."
tags: ["grep", "sed", "awk", "pipes"]
order: 4
id: article-devops-foundation-linux-linux-basics-text-processing
---

## Table of Contents

1. [Why Text Tools Matter in Operations](#why-text-tools-matter-in-operations)
2. [Streams, Pipes, and Redirection](#streams-pipes-and-redirection)
3. [Search with `grep`](#search-with-grep)
4. [Read Live Logs with `tail` and `journalctl`](#read-live-logs-with-tail-and-journalctl)
5. [Transform Lines with `sed`](#transform-lines-with-sed)
6. [Summarize Fields with `awk`](#summarize-fields-with-awk)
7. [Build Incident Pipelines](#build-incident-pipelines)
8. [References](#references)

## Why Text Tools Matter in Operations
<!-- section-summary: Linux exposes configs, logs, command output, and process data as text, so text tools become daily operations tools. -->

The `inventory-api` VM produces text all day. Nginx writes access logs and error logs. systemd stores service logs that `journalctl` prints as text. Config files under `/etc` are mostly text. Deployment scripts print text. Even kernel interfaces under `/proc` often return text.

Text processing is the skill of turning those streams into answers. When the public endpoint returns errors, you may need to count Nginx `5xx` responses by minute, find the latest stack trace from the API service, replace a backend port in a config file, or list the IP addresses sending the most traffic.

The tools in this article are old, small, and still everywhere: `grep` searches, `sed` edits streams, `awk` splits lines into fields, and pipes connect commands together. Observability platforms give richer long-term views. These tools keep you effective when you only have SSH and a terminal.

## Streams, Pipes, and Redirection
<!-- section-summary: Linux commands read from standard input, write normal output to stdout, and write errors to stderr. -->

Most command-line tools work with streams. **Standard input** is the input stream a command reads. **Standard output**, or stdout, is where normal output goes. **Standard error**, or stderr, is where errors go. The shell lets you connect and redirect these streams.

A pipe sends stdout from one command into stdin of the next command:

```bash
$ cat /var/log/nginx/access.log | grep " 500 "
```

Many tools can read files directly, so this shorter version does the same work:

```bash
$ grep " 500 " /var/log/nginx/access.log
```

Redirection writes output to a file or reads input from a file:

```bash
$ journalctl -u inventory-api --since "10 minutes ago" > /tmp/inventory-api-recent.log
$ grep "ERROR" < /tmp/inventory-api-recent.log
```

The symbols `>` and `>>` differ. `>` replaces the destination file. `>>` appends to it. For incident notes, append is often safer:

```bash
$ date >> /tmp/api-incident-notes.log
$ curl -i https://api.example.com/health >> /tmp/api-incident-notes.log
```

stderr is file descriptor `2`. Redirecting `2>/dev/null` hides error messages, which is useful when searching directories that contain paths your user cannot read:

```bash
$ find / -name "inventory-api.conf" 2>/dev/null
```

Use that pattern with care. Hiding errors makes output cleaner, but the errors may explain missing results. During production debugging, clean output helps only when you understand what you are discarding.

## Search with `grep`
<!-- section-summary: `grep` finds lines that match text or regular expressions, making it the first tool for logs and config. -->

`grep` searches text for matching lines. The simplest use is literal text:

```bash
$ grep "inventory-api" /var/log/nginx/error.log
```

Useful flags make `grep` practical on a server:

| Flag | Meaning | Example use |
|---|---|---|
| `-n` | Show line numbers | Jump back into Vim at the exact line |
| `-i` | Ignore case | Match `error`, `Error`, and `ERROR` |
| `-r` | Search directories recursively | Search all Nginx config files |
| `-v` | Invert the match | Hide noisy health checks |
| `-c` | Count matching lines | Count recent failures |
| `-E` | Use extended regular expressions | Match several status codes |

Here are common operations examples:

```bash
$ grep -n "proxy_pass" /etc/nginx/sites-enabled/inventory-api.conf
$ grep -ri "client_max_body_size" /etc/nginx
$ grep -c " 502 " /var/log/nginx/access.log
$ grep -v "/health" /var/log/nginx/access.log
$ grep -E " 50[0-9] " /var/log/nginx/access.log
```

The spaces around status codes matter for Nginx combined logs because they reduce accidental matches inside URLs or user-agent strings. Real log formats vary, so always look at a few raw lines before building a command that assumes field positions.

`grep` also works with `journalctl` output:

```bash
$ journalctl -u inventory-api --since "1 hour ago" --no-pager | grep -i "timeout"
```

This command asks systemd for the API service logs from the last hour, then searches for timeout messages. It is a simple bridge between service management and text processing.

## Read Live Logs with `tail` and `journalctl`
<!-- section-summary: `tail -f` and `journalctl -f` let you watch logs while reproducing a request. -->

Static searches answer what already happened. Live following helps when you reproduce a request and want to watch the server react.

For Nginx files, `tail -f` follows appended lines:

```bash
$ sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
```

For systemd-managed services, `journalctl -f` follows the journal:

```bash
$ sudo journalctl -u inventory-api -f
```

A practical debugging flow uses two terminals. In the first terminal, follow logs. In the second terminal, send the request:

```bash
$ curl -i https://api.example.com/health
```

If Nginx returns `502 Bad Gateway`, the access log shows the public request, the Nginx error log may show connection refusal to `127.0.0.1:3000`, and the service journal may show whether the API process crashed. Seeing all three makes the path clear: public client to Nginx, Nginx to local API process, API process to its own dependencies.

`journalctl` can filter by time without a separate `grep`:

```bash
$ sudo journalctl -u inventory-api --since "2026-06-24 09:00" --until "2026-06-24 09:30"
$ sudo journalctl -u inventory-api -p warning --since "today"
```

The `-p warning` filter shows warning, error, critical, alert, and emergency entries. That is useful when normal request logs are too noisy.

## Transform Lines with `sed`
<!-- section-summary: `sed` applies stream edits, most often substitutions, to preview or update text files. -->

`sed` is a stream editor. It reads lines, applies editing commands, and prints the result. The most common operation is substitution:

```bash
$ sed 's/127.0.0.1:3000/127.0.0.1:3100/g' inventory-api.conf
```

That command prints a preview of the changed version to the terminal because there is no `-i` flag. Previewing first is a healthy habit with production config.

To edit a file in place with a backup:

```bash
$ sudo sed -i.bak 's/127.0.0.1:3000/127.0.0.1:3100/g' \
  /etc/nginx/sites-available/inventory-api.conf
```

This writes the edited file and keeps a `.bak` copy. Afterward, Nginx still needs validation:

```bash
$ sudo nginx -t
$ sudo systemctl reload nginx
```

`sed` can also print a section of a file:

```bash
$ sed -n '1,80p' /etc/nginx/sites-enabled/inventory-api.conf
```

The `-n` flag suppresses automatic printing, and `p` prints only the requested line range. This is handy when an error message points to a specific region and you want to paste a small, relevant snippet into an incident channel.

For complex structured config such as JSON, YAML, or TOML, use a structure-aware tool when one exists. `jq` understands JSON. YAML-aware tools understand YAML. `sed` is excellent for line-based text, but it has no understanding of nested syntax.

## Summarize Fields with `awk`
<!-- section-summary: `awk` splits lines into fields and can count, filter, and aggregate log data directly in the terminal. -->

`awk` reads input line by line, splits each line into fields, and runs small actions. By default, fields are separated by whitespace and named `$1`, `$2`, `$3`, and so on. `$0` means the whole line.

In a typical Nginx combined access log, the first field is the client IP and the status code is often field 9:

```log
203.0.113.42 - - [24/Jun/2026:09:14:03 +0000] "GET /api/items HTTP/1.1" 200 842 "-" "curl/8.0"
```

Counting status codes can start with:

```bash
$ awk '{count[$9]++} END {for (code in count) print code, count[code]}' \
  /var/log/nginx/access.log | sort
```

That creates a counter keyed by status code, then prints the totals at the end. A quick output might look like:

```bash
200 18420
404 91
499 32
502 18
```

The same idea can count top client IPs:

```bash
$ awk '{count[$1]++} END {for (ip in count) print count[ip], ip}' \
  /var/log/nginx/access.log | sort -nr | head
```

`awk` can filter and print selected fields:

```bash
$ awk '$9 ~ /^5/ {print $1, $4, $5, $7, $9}' /var/log/nginx/access.log
```

This prints client IP, timestamp pieces, request path, and status for `5xx` responses. It gives enough detail to see whether failures hit one endpoint or the whole API.

## Build Incident Pipelines
<!-- section-summary: Pipelines combine small tools into focused investigations for real API failures. -->

The power of Linux text processing comes from composition. Each tool does a small job, and the pipe connects the jobs. During an incident, that lets you move from raw logs to a usable answer quickly.

For example, the public API starts returning intermittent `502` responses. A first pass counts failures by minute:

```bash
$ grep " 502 " /var/log/nginx/access.log |
  awk '{print substr($4, 2, 17)}' |
  sort |
  uniq -c |
  tail
```

This pipeline searches for `502` lines, extracts the timestamp minute, sorts, counts repeated minutes, and shows the latest buckets. It tells you whether the problem is growing, fading, or clustered around a deployment.

Another pipeline finds the most common failing paths:

```bash
$ grep -E " 50[0-9] " /var/log/nginx/access.log |
  awk '{print $7}' |
  sort |
  uniq -c |
  sort -nr |
  head
```

If `/api/reports/export` dominates the output, the issue may be one expensive endpoint. If every path appears, the backend process or local network path is more likely.

For API service logs, a pipeline can pull errors after a deploy:

```bash
$ journalctl -u inventory-api --since "30 minutes ago" --no-pager |
  grep -Ei "error|exception|timeout" |
  tail -50
```

These commands are the reliable first layer before a full observability system. They help you form a good next question before opening dashboards, paging another team, or rolling back.

## References

- [GNU Grep manual](https://www.gnu.org/software/grep/manual/grep.html) - Official documentation for grep patterns and options.
- [GNU sed manual](https://www.gnu.org/software/sed/manual/sed.html) - Official documentation for stream editing and substitution.
- [GNU Awk manual](https://www.gnu.org/software/gawk/manual/gawk.html) - Official documentation for awk programs, fields, and actions.
- [Linux `tail(1)` manual](https://man7.org/linux/man-pages/man1/tail.1.html) - Documents following file output.
- [journalctl manual](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html) - Documents journal queries, unit filters, priorities, and following logs.
- [Nginx log module](https://nginx.org/en/docs/http/ngx_http_log_module.html) - Documents access log configuration and log formats.
