---
title: "Text Processing"
description: "Use grep, sed, awk, and pipes to search, transform, and analyze text streams and log files."
overview: "Use classic Linux text tools to inspect Nginx logs, service logs, config files, command output, and deployment output."
tags: ["grep", "sed", "awk", "pipes"]
order: 4
id: article-devops-foundation-linux-linux-basics-text-processing
---

## Table of Contents

1. [Why Do Linux Operations Produce So Much Text?](#why-do-linux-operations-produce-so-much-text)
2. [How Do Streams, Redirection, and Pipes Move Data?](#how-do-streams-redirection-and-pipes-move-data)
3. [How Does grep Select the Lines You Need?](#how-does-grep-select-the-lines-you-need)
4. [How Do tail and journalctl Follow Events over Time?](#how-do-tail-and-journalctl-follow-events-over-time)
5. [How Does sed Transform Lines Without Hiding the Original?](#how-does-sed-transform-lines-without-hiding-the-original)
6. [How Does awk Turn Records and Fields into Summaries?](#how-does-awk-turn-records-and-fields-into-summaries)
7. [How Do You Build and Validate an Incident Pipeline?](#how-do-you-build-and-validate-an-incident-pipeline)
8. [When Should You Use Line Tools, Structured Tools, or Another Interface?](#when-should-you-use-line-tools-structured-tools-or-another-interface)
9. [Check Your Answers](#check-your-answers)

Open an SSH session during a small outage and the screen fills with text. Nginx writes access logs and error logs. systemd stores service logs that `journalctl` prints as text. Config files under `/etc` are mostly text. Commands print text to the terminal. Deployment scripts print text. Even kernel interfaces under `/proc` often return text.

**Text processing** is the skill of turning logs, config files, command output, and live streams into answers. When a public endpoint returns errors, you may need to count Nginx `5xx` responses by minute, find the latest stack trace from a service, replace a backend port in a config file, or list the IP addresses sending the most traffic.

Keep these questions in view as you work through the lesson:

1. **Why Do Linux Operations Produce So Much Text?**
2. **How Do Streams, Redirection, and Pipes Move Data?**
3. **How Does `grep` Select the Lines You Need?**
4. **How Do `tail` and `journalctl` Follow Events over Time?**
5. **How Does `sed` Transform Lines Without Hiding the Original?**
6. **How Does `awk` Turn Records and Fields into Summaries?**
7. **How Do You Build and Validate an Incident Pipeline?**
8. **When Should You Use Line Tools, Structured Tools, or Another Interface?**

## Why Do Linux Operations Produce So Much Text?
<!-- section-summary: Linux exposes configs, logs, command output, and process data as text, so text tools serve daily operations work. -->

The tools here are old, small, and still everywhere. `grep` searches. `sed` edits streams. `awk` splits lines into fields. Pipes connect commands together. Observability platforms give richer long-term views, and these tools keep you effective when you only have SSH and a terminal.

## How Do Streams, Redirection, and Pipes Move Data?
<!-- section-summary: Linux commands read from standard input, write normal output to stdout, and write errors to stderr. -->

Run a noisy log command during an incident and two kinds of text may land on the same screen. Some lines are the request or error you wanted. Other lines say files could not be opened or directories were denied. Before pipes feel useful, it helps to separate normal output from error output.

A **stream** is a flow of bytes that a process reads or writes. The normal output stream is **standard output**, or stdout. Error messages usually go to **standard error**, or stderr. Input that a command reads from another command or a file is **standard input**, or stdin.

Linux gives each process three default file descriptors: `0` for stdin, `1` for stdout, and `2` for stderr. This design lets programs connect without each tool knowing about the next tool. One command writes normal output to descriptor `1`, and the shell can send that stream into another command.

A pipe sends stdout from one command into stdin of the next command. For example, `cat` can print a log file and `grep` can search that stream:

```bash
cat /var/log/nginx/access.log | grep " 500 "

# Example output:
# 203.0.113.42 - - [24/Jun/2026:09:14:03 +0000] "GET /checkout HTTP/1.1" 500 842 "-" "curl/8.0"
```

Many tools can read files directly, so this shorter command usually does the same work:

```bash
grep " 500 " /var/log/nginx/access.log

# Example output:
# 203.0.113.42 - - [24/Jun/2026:09:14:03 +0000] "GET /checkout HTTP/1.1" 500 842 "-" "curl/8.0"
```

The spaces around `500` matter because they reduce accidental matches inside URLs or user-agent strings.

Redirection writes output to a file or reads input from a file. Capture recent service logs:

```bash
journalctl -u app.service --since "10 minutes ago" > /tmp/app-recent.log
```

Now search the saved file:

```bash
grep "ERROR" < /tmp/app-recent.log

# Example output:
# Jun 24 09:18:12 server01 app[1842]: ERROR database connection timed out
```

The symbols `>` and `>>` differ. `>` replaces the destination file. `>>` appends to it. For incident notes, append is often safer:

```bash
date >> /tmp/incident-notes.log
```

```bash
curl -i https://example.com/health >> /tmp/incident-notes.log
```

stderr is file descriptor `2`. Redirecting `2>/dev/null` hides error messages, which is useful when searching directories that contain paths your user cannot read:

```bash
find / -name "web.conf" 2>/dev/null

# Example output:
# /etc/nginx/sites-available/web.conf
```

Use that pattern with care. Hiding errors makes output cleaner, and those errors may explain missing results. During production debugging, clean output helps only when you understand what you are discarding.

The practical next decision is to separate normal output from errors when saving evidence. If a command should produce a clean list of paths, redirect stderr to a separate file during debugging. If the errors may explain the failure, keep them visible.

Descriptor order matters when combining streams. `command >run.log 2>&1` first points stdout at `run.log`, then points stderr at the destination stdout currently uses. Reversing those redirections can leave stderr attached to the terminal. Bash also supports `&>run.log` for both streams, but the longer form makes the descriptor relationship visible and is more portable across shells.

`tee` copies stdin to a file and stdout at the same time. It is useful when an operator must watch a command and retain the evidence:

```bash
journalctl -u app.service --since '10 minutes ago' 2>&1 |
  tee /tmp/app-investigation.log |
  grep -E 'ERROR|WARN'
```

A pipeline normally streams data as processes produce and consume it rather than creating one complete temporary file between every stage. That reduces storage and lets live monitoring begin immediately. Buffering can still delay visible output: a program may buffer more when stdout is a pipe than when it is a terminal. If a live pipeline appears quiet, confirm that the producer is emitting records and consult its line-buffering or flush options before assuming there are no events.

![Pipeline pattern infographic showing stdout flowing through grep, cut, sort, uniq, and awk-style reporting](/content-assets/articles/article-devops-foundation-linux-linux-basics-text-processing/pipeline-pattern.png)

_The image shows a pipeline as a stream of records moving through small focused tools._

## How Does `grep` Select the Lines You Need?
<!-- section-summary: `grep` finds lines that match text or regular expressions, making it the first tool for logs and config. -->

After you understand where stdout and stderr go, the next pain is volume. Logs and config files often contain far more text than a person can read line by line. During an incident, the useful question is smaller: which lines mention this error, host, port, user, or request path? `grep` answers that question by searching text for matching lines.

`grep` works by testing each input line against a pattern. A plain quoted string matches that text. A regular expression describes a shape, such as any `5xx` status code. Most incident questions need line selection first: keep the matching lines, drop the noise, then inspect the smaller set.

The simplest use is literal text:

```bash
grep "connect() failed" /var/log/nginx/error.log

# Example output:
# 2026/06/24 09:14:03 [error] 2210#2210: *418 connect() failed (111: Connection refused) while connecting to upstream
```

This line says Nginx tried to reach an upstream service and the connection was refused. That often points to an application process that is down or listening on a different port.

Useful flags make `grep` practical on a server:

| Flag | Meaning | Example use |
|---|---|---|
| `-n` | Show line numbers | Jump back into Vim at the exact line |
| `-i` | Ignore case | Match `error`, `Error`, and `ERROR` |
| `-r` | Search directories recursively | Search all Nginx config files |
| `-v` | Invert the match | Hide noisy health checks |
| `-c` | Count matching lines | Count recent failures |
| `-E` | Use extended regular expressions | Match several status codes |

Choose literal and regex searches deliberately. `grep -F 'user.name@example.com'` treats punctuation as ordinary characters. A regex search would treat `.` as “any character” unless escaped. Extended regular expressions make alternation and grouped patterns easier:

```bash
grep -E 'HTTP/[0-9.]+ 5[0-9]{2} ' /var/log/nginx/access.log
grep -F 'upstream timed out' /var/log/nginx/error.log
```

Context flags retain nearby evidence. `-B 2` includes two lines before a match, `-A 3` includes three after, and `-C 2` includes both sides. This helps with multiline application events whose exception or request metadata sits beside the matching error line. Keep the context window bounded so one broad match does not reproduce the whole file.

Find where Nginx sends traffic:

```bash
grep -n "proxy_pass" /etc/nginx/sites-enabled/web.conf

# Example output:
# 18:    proxy_pass http://127.0.0.1:8080;
```

The `18:` prefix is the line number. If you need to edit the file in Vim, `18G` jumps to that line.

Search every Nginx config file for an upload limit:

```bash
grep -ri "client_max_body_size" /etc/nginx

# Example output:
# /etc/nginx/conf.d/uploads.conf:client_max_body_size 25m;
```

Count gateway errors:

```bash
grep -c " 502 " /var/log/nginx/access.log

# Example output:
# 18
```

Hide routine health checks:

```bash
grep -v "/health" /var/log/nginx/access.log | head

# Example output:
# 203.0.113.42 - - [24/Jun/2026:09:14:03 +0000] "GET /checkout HTTP/1.1" 500 842 "-" "curl/8.0"
# 198.51.100.9 - - [24/Jun/2026:09:14:05 +0000] "GET /products HTTP/1.1" 200 2481 "-" "Mozilla/5.0"
```

Search for all `5xx` status codes:

```bash
grep -E " 50[0-9] " /var/log/nginx/access.log

# Example output:
# 203.0.113.42 - - [24/Jun/2026:09:14:03 +0000] "GET /checkout HTTP/1.1" 500 842 "-" "curl/8.0"
# 203.0.113.43 - - [24/Jun/2026:09:14:11 +0000] "GET /reports HTTP/1.1" 502 166 "-" "curl/8.0"
```

Real log formats vary, so inspect a few raw lines before building a command that assumes field positions.

The production symptom of a weak pattern is a count that looks too high or too low. `grep "500"` may match a status code, a byte count, or part of a URL. The next decision is to include surrounding spaces, use a stronger regular expression, or switch to `awk` when field positions are known.

`grep` also works with `journalctl` output:

```bash
journalctl -u app.service --since "1 hour ago" --no-pager | grep -i "timeout"

# Example output:
# Jun 24 09:18:12 server01 app[1842]: database timeout after 5000ms
# Jun 24 09:18:17 server01 app[1842]: upstream request timeout
```

This command asks systemd for service logs from the last hour, then searches for timeout messages.

![Grep context window infographic showing matching lines with before and after context around an error](/content-assets/articles/article-devops-foundation-linux-linux-basics-text-processing/grep-context-window.png)

_The image shows how context flags turn a raw match into a useful slice of the surrounding incident story._

## How Do `tail` and `journalctl` Follow Events over Time?
<!-- section-summary: `tail -f` and `journalctl -f` let you watch logs while reproducing a request. -->

After `grep` finds old evidence, you often need to watch the next request happen. During a live debug, you may send one request and watch what Nginx and the application log at that exact moment. Live following keeps the terminal attached to new log lines as they arrive.

For Nginx files, `tail -f` follows appended lines:

```bash
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log

# Example output:
# ==> /var/log/nginx/access.log <==
# 203.0.113.42 - - [24/Jun/2026:09:20:02 +0000] "GET /health HTTP/1.1" 200 2 "-" "curl/8.0"
#
# ==> /var/log/nginx/error.log <==
# 2026/06/24 09:20:08 [error] 2210#2210: *419 connect() failed (111: Connection refused) while connecting to upstream
```

For systemd-managed services, `journalctl -f` follows the journal:

```bash
sudo journalctl -u app.service -f

# Example output:
# Jun 24 09:20:08 server01 app[1842]: received GET /health
# Jun 24 09:20:08 server01 app[1842]: database connection pool exhausted
```

A practical debugging flow uses two terminals. In the first terminal, follow logs. In the second terminal, send the request:

```bash
curl -i https://example.com/health

# Example output:
# HTTP/2 502
# server: nginx
# content-type: text/html
```

Now compare the three places. The access log shows the public request. The Nginx error log may show connection refusal to `127.0.0.1:8080`. The service journal may show whether the application process crashed or could not reach a dependency.

`journalctl` can filter by time without a separate `grep`:

```bash
sudo journalctl -u app.service --since "2026-06-24 09:00" --until "2026-06-24 09:30"

# Example output:
# Jun 24 09:14:01 server01 app[1842]: starting release 20260624-091000
# Jun 24 09:18:12 server01 app[1842]: ERROR database connection timed out
```

Filter by priority:

```bash
sudo journalctl -u app.service -p warning --since "today"

# Example output:
# Jun 24 09:18:12 server01 app[1842]: ERROR database connection timed out
# Jun 24 09:19:02 server01 app[1842]: WARNING retrying database connection
```

The `-p warning` filter includes warning, error, critical, alert, and emergency entries. That is useful when normal request logs are too noisy.

## How Does `sed` Transform Lines Without Hiding the Original?
<!-- section-summary: `sed` applies stream edits, most often substitutions, to preview or update text files. -->

Search shows you where text appears. Sometimes the next job is changing repeated text safely. A config might contain the same backend address in several places, or a generated file might need one value replaced before another command reads it. `sed` is useful for that kind of line-by-line transformation.

`sed` is a stream editor. It reads lines, applies editing commands, and prints the result. The most common operation is substitution.

Substitution exists for repeated text edits. The basic shape is `s/old/new/`, which means "replace the first match of `old` on each line with `new`." Adding `g` changes every match on the line. `sed` processes text as lines, so it is best for simple line-based changes that you can preview.

Preview a backend port change:

```bash
sed 's/127.0.0.1:8080/127.0.0.1:8081/g' web.conf

# Example output:
# location / {
#     proxy_pass http://127.0.0.1:8081;
# }
```

This command prints the changed version to the terminal because there is no `-i` flag. Previewing first is a healthy habit with production config.

To edit a file in place with a backup:

```bash
sudo sed -i.bak 's/127.0.0.1:8080/127.0.0.1:8081/g' /etc/nginx/sites-available/web.conf
```

Check that the backup exists:

```bash
ls -l /etc/nginx/sites-available/web.conf*

# Example output:
# -rw-r--r-- 1 root root 1280 Jun 24 09:22 /etc/nginx/sites-available/web.conf
# -rw-r--r-- 1 root root 1280 Jun 24 09:21 /etc/nginx/sites-available/web.conf.bak
```

Afterward, Nginx still needs validation:

```bash
sudo nginx -t

# Example output:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
```

```bash
sudo systemctl reload nginx
```

`sed` can also print a section of a file:

```bash
sed -n '1,80p' /etc/nginx/sites-enabled/web.conf

# Example output:
# server {
#     listen 80;
#     server_name example.com;
#
#     location / {
#         proxy_pass http://127.0.0.1:8081;
#     }
# }
```

The `-n` flag suppresses automatic printing, and `p` prints only the requested line range. This is handy when an error message points to a specific region and you want to paste a small, relevant snippet into an incident channel.

For structured config such as JSON, YAML, or TOML, use a structure-aware tool when one exists. `jq` understands JSON. YAML-aware tools understand YAML. `sed` is excellent for line-based text, but it has no understanding of nested syntax.

The next decision after a `sed` preview is validation. If the output changes only the intended line, run the in-place command with a backup and then validate the service config. If the preview changes comments, examples, or unrelated blocks, edit with Vim or use a config-aware tool.

![Text stream filters infographic showing grep selecting, sed editing, awk extracting fields, and sort summarizing lines](/content-assets/articles/article-devops-foundation-linux-linux-basics-text-processing/text-stream-filters.png)

_The image shows how text tools divide the work: select, transform, extract, and summarize._

## How Does `awk` Turn Records and Fields into Summaries?
<!-- section-summary: `awk` splits lines into fields and can count, filter, and aggregate log data directly in the terminal. -->

After filtering logs for errors, you usually want the shape of the problem. Which client IPs are causing most of the failures? Which status codes dominate? Which paths appear most often? Counting by hand from raw log lines wastes time and misses patterns.

`awk` reads input line by line, splits each line into fields, and runs small actions. By default, fields are separated by whitespace and named `$1`, `$2`, `$3`, and so on. `$0` means the whole line.

Field splitting exists because many logs are regular enough to ask column questions. In an Nginx access log, one field may be the client IP, another may be the request path, and another may be the status code. `awk` lets you count and compare those fields without writing a full program.

In a typical Nginx combined access log, the first field is the client IP and the status code is often field 9:

```log
203.0.113.42 - - [24/Jun/2026:09:14:03 +0000] "GET /items HTTP/1.1" 200 842 "-" "curl/8.0"
```

Print only the first field:

```bash
awk '{print $1}' /var/log/nginx/access.log | head

# Example output:
# 203.0.113.42
# 198.51.100.9
# 203.0.113.42
```

Print only the status code field:

```bash
awk '{print $9}' /var/log/nginx/access.log | head

# Example output:
# 200
# 502
# 200
```

Now count status codes:

```bash
awk '{count[$9]++} END {for (code in count) print code, count[code]}' /var/log/nginx/access.log | sort

# Example output:
# 200 18420
# 404 91
# 499 32
# 502 18
```

In the `awk` program, `count[$9]++` increments a bucket named after field 9. The `END` block prints the buckets after every line has been processed. The final `sort` makes the output stable enough to compare between repeated runs.

The same idea can count top client IPs:

```bash
awk '{count[$1]++} END {for (ip in count) print count[ip], ip}' /var/log/nginx/access.log | sort -nr | head

# Example output:
# 482 203.0.113.42
# 311 198.51.100.9
# 97 192.0.2.18
```

`awk` can filter and print selected fields:

```bash
awk '$9 ~ /^5/ {print $1, $4, $5, $7, $9}' /var/log/nginx/access.log

# Example output:
# 203.0.113.42 [24/Jun/2026:09:14:03 +0000] /checkout 500
# 203.0.113.43 [24/Jun/2026:09:14:11 +0000] /reports 502
```

This prints client IP, timestamp pieces, request path, and status for `5xx` responses. It gives enough detail to see whether failures hit one endpoint or the whole application.

The production caution is that field numbers depend on the log format. A custom Nginx log format, quoted user-agent, or extra upstream field can move the value you want. The next decision is to inspect one raw line, confirm the field number, then build the `awk` command.

## How Do You Build and Validate an Incident Pipeline?
<!-- section-summary: Pipelines combine small tools into focused investigations for real service failures. -->

By this point you have seen each tool alone. An incident usually asks a messier question: are the `502` responses scattered across the site, or are they concentrated in one endpoint and one minute? A single command rarely answers that cleanly. A pipeline lets each tool remove one layer of noise.

The power of Linux text processing comes from composition. Each tool does a small job, and the pipe connects the jobs. During an incident, that lets you move from raw logs to a usable answer quickly.

An incident pipeline exists to reduce noise step by step. The first command should select the event type. The next command should extract the useful part. Later commands can sort, count, or keep the most recent lines. Each stage should answer one small question.

Suppose a public site returns intermittent `502` responses. First select only the `502` lines:

```bash
grep " 502 " /var/log/nginx/access.log

# Example output:
# 203.0.113.43 - - [24/Jun/2026:09:14:11 +0000] "GET /reports HTTP/1.1" 502 166 "-" "curl/8.0"
# 203.0.113.51 - - [24/Jun/2026:09:15:03 +0000] "GET /checkout HTTP/1.1" 502 166 "-" "curl/8.0"
```

Next, extract the minute from the timestamp:

```bash
grep " 502 " /var/log/nginx/access.log | awk '{print substr($4, 2, 17)}'

# Example output:
# 24/Jun/2026:09:14
# 24/Jun/2026:09:15
# 24/Jun/2026:09:15
```

Then sort and count matching minutes:

```bash
grep " 502 " /var/log/nginx/access.log |
  awk '{print substr($4, 2, 17)}' |
  sort |
  uniq -c |
  tail

# Example output:
#       1 24/Jun/2026:09:14
#       7 24/Jun/2026:09:15
#      10 24/Jun/2026:09:16
```

Each stage narrows the question. `grep` selects failed gateway responses. `awk` trims the timestamp down to minute-level buckets. `sort` groups identical minutes together. `uniq -c` counts them. `tail` keeps the latest part of the investigation visible.

Another pipeline finds the most common failing paths:

```bash
grep -E " 50[0-9] " /var/log/nginx/access.log |
  awk '{print $7}' |
  sort |
  uniq -c |
  sort -nr |
  head

# Example output:
#      14 /reports
#       6 /checkout
#       2 /health
```

If one path dominates the output, the issue may live in that endpoint. If every path appears, inspect the backend process, local port, database, or dependency health.

For service logs, a pipeline can pull errors after a deploy:

```bash
journalctl -u app.service --since "30 minutes ago" --no-pager |
  grep -Ei "error|exception|timeout" |
  tail -50

# Example output:
# Jun 24 09:18:12 server01 app[1842]: ERROR database connection timed out
# Jun 24 09:18:13 server01 app[1842]: exception while loading report data
# Jun 24 09:18:17 server01 app[1842]: upstream request timeout
```

These commands are the reliable first layer before a full observability system. They help you form a good next question before opening dashboards, paging another team, or rolling back.

The practical next decision comes from the shape of the output. A spike in one minute points toward a short deploy or dependency event. One failing path points toward endpoint code or data. Failures across every path point toward the backend process, local port, database, or shared dependency.

![Text processing summary infographic showing streams, pipes, grep, tail, sed, awk, and incident pipelines](/content-assets/articles/article-devops-foundation-linux-linux-basics-text-processing/text-processing-summary.png)

_The summary image collects the command patterns used to turn noisy logs into evidence._

Before choosing a different parser, make the contracts of `sed` and `awk` explicit. A substitution such as `sed 's/old/new/'` changes only the first match on each line; adding `g` changes every match on that line. An address limits which records are eligible:

```bash
sed -n '20,40p' /etc/nginx/nginx.conf
sed '/^#/d' /etc/example.conf
sed 's/http:\/\/old\.internal/http:\/\/new.internal/g' input.txt
```

The first command prints a bounded line range because `-n` suppresses normal automatic output and `p` selects the addressed lines. The second drops comment lines from the output stream. The third transforms every matching old endpoint in each line. None changes the source file because no in-place option was used.

For file edits, preview the transformation, compare it, then write through a backup or candidate file. `sed -i` changes the file and behaves differently across implementations, so production config deserves an explicit validation and rollback path rather than a one-liner applied without review.

`awk` treats each input line as a record and splits it into fields. `$0` is the whole record, `$1` is the first field, and `NF` is the field count. `BEGIN` runs before input, `END` runs after input, and variables can accumulate state across records:

```bash
awk '
BEGIN { errors = 0; total = 0 }
{
    total++
    if ($9 ~ /^5[0-9][0-9]$/) {
        errors++
        by_status[$9]++
    }
}
END {
    printf "requests=%d errors=%d\n", total, errors
    for (status in by_status) {
        printf "%s %d\n", status, by_status[status]
    }
}' /var/log/nginx/access.log
```

This assumes the status code is truly field nine in the selected log format. If the Nginx format changes or quoted fields contain unexpected whitespace, the assumption can fail. `FS` selects an input separator and `OFS` selects the separator used by `print`, but a delimiter is not a complete parser for formats with quoting and escaping.

## When Should You Use Line Tools, Structured Tools, or Another Interface?

Line tools work best when the input contract is genuinely line-oriented. A newline separates records, and characters or a stable delimiter separate fields. That model fits many logs, command outputs, and configuration fragments. It is a poor fit for arbitrary binary data, multiline records, or structured formats whose quoting and nesting rules carry meaning.

Supporting commands complete many pipelines. `head` limits early records, `wc -l` counts lines, `cut -d: -f1` extracts simple delimiter-separated fields, `tr` maps or deletes characters, and `sort | uniq -c` groups identical adjacent values. `uniq` does not search the entire input for duplicates by itself; sorting first makes equal records adjacent.

```bash
awk '{print $1}' /var/log/nginx/access.log |
  sort |
  uniq -c |
  sort -nr |
  head -10
```

Each stage has one visible responsibility: extract client addresses, group equal values, count them, order the counts, and keep the largest ten. Build this from left to right and inspect a sample after each stage. If the `awk` output is wrong, adding more commands cannot repair the meaning.

Field separators must match the real format. Whitespace splitting can work for an Nginx access log whose first field is an address, but it cannot safely parse CSV with quoted commas or JSON with nested objects. Use `jq` for JSON and a real CSV parser for CSV. Structured tools understand escaping, types, arrays, and missing fields instead of treating punctuation as an informal delimiter.

```bash
journalctl -u app.service -o json |
  jq -r 'select(.PRIORITY <= "3") | [.SYSLOG_IDENTIFIER, .MESSAGE] | @tsv'
```

Binary data also needs a binary-aware interface. `grep`, `sed`, and `awk` commonly assume text records; they may stop, warn, corrupt display, or misinterpret zero bytes. Use tools designed for the file type, or convert the data through a documented decoder before applying line operations.

Locale can change character classes, collation, and sort order. When automation requires byte-stable ordering, set an explicit locale such as `LC_ALL=C` for that command. When human-language ordering matters, keep the intended locale and test with representative characters.

Text commands report exit statuses that scripts can use. `grep` commonly returns `0` for a match, `1` for no match, and a larger value for an error. A pipeline also has a status; in Bash, `set -o pipefail` prevents an early stage's failure from being hidden by a successful final stage. Treat “no matching errors” differently from “the log file could not be read.”

Finally, avoid transforming the evidence before preserving enough of it to debug. During an incident, save the command, time range, host, and a bounded raw sample beside the derived count. An elegant total without the source window can hide malformed lines, rotation gaps, clock differences, or a parser assumption that failed halfway through the data.

Live pipelines require a time boundary as well as a text boundary. `tail -F` follows a filename across common rotations, while `tail -f` follows the open file descriptor and may remain attached to an old renamed file. A filter or runtime may buffer output when its destination is a pipe instead of a terminal, so a quiet screen does not always prove that no events arrived. Test the producer alone, then add the filter, and use the program's documented line-buffering option when timely delivery matters.

```bash
tail -F /var/log/nginx/access.log |
  grep --line-buffered ' 5[0-9][0-9] ' |
  awk '{ count[$9]++; if (NR % 20 == 0) fflush() }
       END { for (code in count) print code, count[code] }'
```

This example demonstrates the concern, but it prints the final summary only when the pipeline ends. For a continuing operational view, print per record or emit summaries on a time-aware schedule. A line counter cannot infer “per minute” unless the input contains trustworthy timestamps or the surrounding tool creates explicit time windows.

Exit status belongs in the output contract of a text command. In a script, do not turn every non-match into an error:

```bash
if grep -qF 'deployment complete' "$log_file"; then
  printf '%s\n' 'completion marker found'
else
  status=$?
  if [[ $status -eq 1 ]]; then
    printf '%s\n' 'completion marker not present yet'
  else
    printf 'could not inspect %s\n' "$log_file" >&2
    exit "$status"
  fi
fi
```

Fixed-string mode is intentional because the marker is literal. Quoting the pattern prevents the shell from interpreting spaces or wildcard characters; `-F` prevents grep from interpreting regular-expression metacharacters. The script preserves the difference between an ordinary negative answer and an unreadable input.

For a complete incident query, state the population before counting it. Choose the host, service, boot, start and end time, and log format. Preserve a bounded raw extract, validate the field assumptions on a sample, then calculate the summary:

```bash
journalctl -u app.service \
  --since '2026-08-25 10:00:00' \
  --until '2026-08-25 10:15:00' \
  --no-pager > app-incident.raw

head -20 app-incident.raw
grep -F 'request failed' app-incident.raw |
  sed -n 's/.*status=\([0-9][0-9][0-9]\).*/\1/p' |
  sort | uniq -c | sort -nr
```

An empty summary can mean no failures, a wrong time window, a pattern mismatch, or a failed input command. Check the raw file and statuses before declaring the incident clear. The pipeline is valuable because every interface is visible and testable, not because a long one-liner is automatically correct.

## Check Your Answers

:::expand[Why Do Linux Operations Produce So Much Text?]{kind="recap"}
Linux tools expose observations as composable text so small programs can inspect, filter, transform, and summarize system evidence.
:::

:::expand[How Do Streams, Redirection, and Pipes Move Data?]{kind="recap"}
Standard input, output, and error are separate streams; redirection changes destinations and pipes connect process interfaces.
:::

:::expand[How Does `grep` Select the Lines You Need?]{kind="recap"}
`grep` filters records by literal or regular-expression patterns and can include context, counts, filenames, and line numbers.
:::

:::expand[How Do `tail` and `journalctl` Follow Events over Time?]{kind="recap"}
`tail` follows files, while `journalctl` queries journal events by unit, boot, priority, and time boundary.
:::

:::expand[How Does `sed` Transform Lines Without Hiding the Original?]{kind="recap"}
`sed` describes stream transformations; preview output before using in-place edits and preserve a recoverable original.
:::

:::expand[How Does `awk` Turn Records and Fields into Summaries?]{kind="recap"}
`awk` applies rules to records and fields, enabling selection, arithmetic, grouping inputs, and formatted summaries.
:::

:::expand[How Do You Build and Validate an Incident Pipeline?]{kind="recap"}
Build one stage at a time, inspect intermediate output, bound time and volume, then preserve both evidence and derivation.
:::

:::expand[When Should You Use Line Tools, Structured Tools, or Another Interface?]{kind="recap"}
Use line tools for stable text records, format-aware parsers for structured data, and binary-aware tools for nontext input.
:::

### References

- [GNU Grep manual](https://www.gnu.org/software/grep/manual/grep.html) - Official documentation for grep patterns and options.
- [GNU sed manual](https://www.gnu.org/software/sed/manual/sed.html) - Official documentation for stream editing and substitution.
- [GNU Awk manual](https://www.gnu.org/software/gawk/manual/gawk.html) - Official documentation for awk programs, fields, and actions.
- [Linux `tail(1)` manual](https://man7.org/linux/man-pages/man1/tail.1.html) - Documents following file output.
- [journalctl manual](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html) - Documents journal queries, unit filters, priorities, and following logs.
- [Nginx log module](https://nginx.org/en/docs/http/ngx_http_log_module.html) - Documents access log configuration and log formats.
