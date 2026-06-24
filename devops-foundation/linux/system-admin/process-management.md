---
title: "Process Management"
description: "Inspect, signal, and supervise running processes on Linux, and diagnose what happens when they refuse to die."
overview: "Learn how Linux runs programs as processes, then inspect and control the API and Nginx processes on a VM during real operations work."
tags: ["processes", "ps", "signals", "top"]
order: 1
id: article-devops-foundation-linux-system-admin-process-management
---

## Table of Contents

1. [Why Processes Matter on the API VM](#why-processes-matter-on-the-api-vm)
2. [What a Process Is](#what-a-process-is)
3. [PID, PPID, and the Process Tree](#pid-ppid-and-the-process-tree)
4. [Inspect Processes with `ps`, `pgrep`, and `top`](#inspect-processes-with-ps-pgrep-and-top)
5. [Signals and Graceful Shutdown](#signals-and-graceful-shutdown)
6. [Foreground, Background, and Jobs](#foreground-background-and-jobs)
7. [Priority, Nice Values, and I/O Priority](#priority-nice-values-and-io-priority)
8. [Inspect Live State in `/proc`](#inspect-live-state-in-proc)
9. [Failure Patterns](#failure-patterns)
10. [References](#references)

## Why Processes Matter on the API VM
<!-- section-summary: Processes are the running programs that make the API, Nginx, shell sessions, and maintenance commands actually execute. -->

On `api-01`, the `inventory-api` code on disk is only a set of files. Linux serves requests only after it starts a process for that code. Nginx is also one or more processes. Your SSH shell is a process. `curl`, `grep`, `journalctl`, and deployment scripts each run as processes too.

Process management answers practical questions during operations. Is the API running? Which user owns it? How much CPU and memory is it using? Did systemd start it, or did someone launch it by hand? Can it handle a graceful restart, or is it stuck? Which parent process will clean it up after it exits?

The next article covers systemd supervision. This article stays one layer lower. It focuses on how Linux represents running programs and how you can inspect them directly when a service dashboard gives you only a symptom.

## What a Process Is
<!-- section-summary: A process is a running program with its own PID, memory, file descriptors, environment, and security identity. -->

A **process** is a running instance of a program. The program file may be `/usr/sbin/nginx` or `/usr/bin/node`, but the process is the live execution: memory, open files, environment variables, current directory, user identity, and kernel bookkeeping.

For the API, a process might look like this:

```bash
$ pgrep -a node
1842 node /srv/inventory-api/current/server.js
```

The number `1842` is the process ID, usually called the PID. The rest is the command line. If the API restarts, the new process usually receives a new PID even though it runs the same program file.

Every process has an owner. That owner controls what files the process can read, which ports it can bind, and which other processes it can signal. A healthy API service runs as `inventory-api` with root reserved for the service manager and privileged setup work.

Processes also have file descriptors. A file descriptor is a small number that points at an open file, socket, pipe, or device. Standard input is descriptor `0`, standard output is `1`, and standard error is `2`. Network sockets and log files receive other descriptor numbers. Many production bugs show up as too many open file descriptors, a deleted log file still held open, or a socket stuck in an unexpected state.

## PID, PPID, and the Process Tree
<!-- section-summary: Parent-child relationships explain who started a process and who should reap it when it exits. -->

Linux processes form a tree. Each process has a PID and usually a parent process ID, called PPID. The parent starts the child and later collects its exit status. On a systemd-based server, PID `1` is systemd, and long-running services usually sit under it.

The process tree for the API and Nginx may look like:

```bash
$ ps -eo pid,ppid,user,stat,cmd --forest | grep -E "systemd|nginx|inventory-api|node"
    1     0 root      Ss   /sbin/init
  912     1 root      Ss    nginx: master process /usr/sbin/nginx -g daemon on; master_process on;
  913   912 www-data  S      \_ nginx: worker process
 1842     1 inventory Ssl  /usr/bin/node /srv/inventory-api/current/server.js
```

Nginx has a master process owned by root and worker processes owned by `www-data`. The master reads privileged config and manages workers. The workers handle requests with less privilege. The API process is owned by `inventory-api` and parented by systemd.

The `STAT` column shows process state and flags. `S` means sleeping, which is normal for a server waiting for network requests. `R` means running on CPU. `Z` means zombie, a process that exited but still needs its parent to collect the status. `l` means multi-threaded.

When a process tree looks wrong, it often tells an operational story. If the API is parented by your SSH shell instead of systemd, someone may have started it manually. It may die when that shell closes. If Nginx workers are missing, the master may be failing to spawn them after a bad reload.

## Inspect Processes with `ps`, `pgrep`, and `top`
<!-- section-summary: Process inspection commands show identity, command line, resource use, and runtime state. -->

`ps` gives a snapshot. A useful service view is:

```bash
$ ps -eo pid,ppid,user,%cpu,%mem,etime,stat,cmd --sort=-%cpu | head
```

This shows process identity, CPU percentage, memory percentage, elapsed runtime, state, and command. Sorting by CPU helps when the VM is slow and you need the top consumers quickly.

`pgrep` finds PIDs by name or command line:

```bash
$ pgrep -a nginx
$ pgrep -a -u inventory-api node
```

The `-a` flag prints the full command line. The `-u` flag limits matches to a user, which prevents a random development `node` process from being confused with the service.

`top` gives a live view:

```bash
$ top
```

Inside `top`, `P` sorts by CPU and `M` sorts by memory. `1` shows per-CPU lines. `c` toggles full command lines. These keys are useful when the API spikes and you need to see whether one process, all Nginx workers, or a background job is responsible.

Many servers also have `htop`, which is friendlier but may require installation. `top` is the safer baseline because it is usually present on minimal systems.

## Signals and Graceful Shutdown
<!-- section-summary: Signals are small messages Linux sends to processes to ask for actions such as reload, stop, or immediate termination. -->

A **signal** is a message sent to a process. Signals are how Linux asks a process to stop, reload, continue, or report certain events. The `kill` command sends signals, even though the name sounds like it always terminates something.

Common signals:

| Signal | Number | Meaning |
|---|---:|---|
| `TERM` | 15 | Ask the process to terminate gracefully |
| `INT` | 2 | Interrupt, similar to pressing `Ctrl+C` |
| `HUP` | 1 | Often used to reload config or reopen logs |
| `KILL` | 9 | Immediate kernel-level termination |
| `USR1` / `USR2` | varies | Application-defined behavior |

A graceful API stop might be:

```bash
$ sudo kill -TERM 1842
```

The process receives `TERM` and has a chance to stop accepting new work, finish in-flight requests, close files, and exit. systemd may then start a replacement depending on the unit policy.

`KILL` is different because the process cannot handle it. The kernel ends it immediately:

```bash
$ sudo kill -KILL 1842
```

That can be necessary for a stuck process, but it skips application cleanup. For the API, a forced kill could interrupt requests, skip shutdown hooks, or leave temporary files behind. The normal escalation is `TERM`, wait a little, inspect, then `KILL` only when the process will not exit.

For Nginx, prefer official controls:

```bash
$ sudo nginx -t
$ sudo systemctl reload nginx
```

The reload path lets Nginx validate config and gracefully replace workers. Sending random signals to production daemons is rarely the best first move when the service manager already knows the right behavior.

## Foreground, Background, and Jobs
<!-- section-summary: Shell job control explains what happens when commands run in your terminal versus under a service manager. -->

When you run a command in your terminal, it usually runs in the foreground. Your shell waits until it finishes. Adding `&` starts it in the background:

```bash
$ long-report-generator &
[1] 2409
```

`jobs` shows background jobs started by the current shell. `fg` brings one back to the foreground, and `Ctrl+Z` suspends a foreground job.

This is useful for short personal work, but it is a poor way to run production services. A background job belongs to your shell session. When the SSH session ends, the process may receive a hangup signal or lose its terminal. Logs, restart policy, environment, and ownership are also unclear.

The production API belongs under systemd supervision:

```bash
$ systemctl status inventory-api
```

If `ps` shows the API parented by `bash` or `zsh`, treat that as a deployment problem. The service manager should own long-running production processes.

## Priority, Nice Values, and I/O Priority
<!-- section-summary: Nice values and I/O priority influence scheduling, but they are tuning tools after the real workload is understood. -->

Linux scheduling decides which process gets CPU time. A **nice value** influences that decision. Lower nice values receive higher priority. Normal processes start at `0`, and positive values such as `10` make a process more polite.

A maintenance task can run with lower CPU priority:

```bash
$ nice -n 10 tar -czf /var/backups/inventory-api.tgz /srv/inventory-api
```

An already running process can be adjusted with `renice`:

```bash
$ sudo renice 10 -p 2409
```

Disk I/O has its own priority through `ionice`:

```bash
$ sudo ionice -c2 -n7 -p 2409
```

These tools help when a backup or report competes with the API. The long-term fix still needs to address the underlying load. If the API needs more CPU, better queries, caching, or another VM, changing nice values may only hide the real capacity problem.

## Inspect Live State in `/proc`
<!-- section-summary: `/proc/<pid>` exposes live kernel details about a process, including command line, limits, environment, and open files. -->

The `/proc` filesystem gives a live process view. For PID `1842`, the directory `/proc/1842` contains kernel data about the API process.

Useful files and directories include:

| Path | What it shows |
|---|---|
| `/proc/1842/cmdline` | Command used to start the process |
| `/proc/1842/environ` | Environment variables, separated by null bytes |
| `/proc/1842/status` | State, memory summary, UIDs, GIDs, threads |
| `/proc/1842/limits` | Resource limits such as open files |
| `/proc/1842/fd` | Open file descriptors |
| `/proc/1842/cwd` | Current working directory symlink |

Commands make those files readable:

```bash
$ tr '\0' ' ' < /proc/1842/cmdline
$ sudo tr '\0' '\n' < /proc/1842/environ | grep '^NODE_ENV='
$ grep -E 'State|Threads|VmRSS' /proc/1842/status
$ ls -lah /proc/1842/fd | head
```

This is useful when systemd says a service is running but you need detail. You can verify the working directory, environment, open sockets, and whether the process still has a deleted log file open.

Permissions still apply. Environment variables can contain secrets, so reading another process's environment usually requires root and should be handled carefully.

## Failure Patterns
<!-- section-summary: Common process failures include runaway CPU, stuck shutdown, zombies, orphaned manual processes, and OOM kills. -->

A few process patterns show up repeatedly on real servers.

**Runaway CPU** happens when a process burns CPU continuously. `top` shows the process at or near a full core. For the API, this might be a bad loop, an expensive request, or a dependency retry storm. The first move is to identify the PID, capture logs, and understand whether the load is tied to one endpoint before restarting it.

**Stuck shutdown** happens when `systemctl restart inventory-api` waits for the old process to exit. The process may be blocked on I/O, stuck in application cleanup, or ignoring `TERM`. Inspect logs and process state before escalating to a forced kill.

**Zombie processes** show `Z` in `ps`. A zombie already exited, but the parent has not collected its status. One or two short-lived zombies can disappear quickly. A growing number points at a parent process bug.

**Orphaned manual processes** happen when someone starts the API outside systemd. They confuse health checks because `systemctl status` may show one state while a stray process is still listening on the port. `ss -ltnp` and `pgrep -a` help find the actual listener.

**OOM kills** happen when the kernel kills a process to recover memory. The service may appear to crash without a clean application error. The next CPU and memory article shows how to confirm that path with `journalctl -k`, `dmesg`, and memory metrics.

Process management gives you the live view. systemd adds the long-running service contract on top of it.

## References

- [Linux `ps(1)` manual](https://man7.org/linux/man-pages/man1/ps.1.html) - Documents process snapshot output and state codes.
- [Linux `pgrep(1)` manual](https://man7.org/linux/man-pages/man1/pgrep.1.html) - Documents process matching by name, user, and command line.
- [Linux `top(1)` manual](https://man7.org/linux/man-pages/man1/top.1.html) - Documents live process monitoring.
- [Linux `signal(7)` manual](https://man7.org/linux/man-pages/man7/signal.7.html) - Documents standard signals and their behavior.
- [Linux `proc(5)` manual](https://man7.org/linux/man-pages/man5/proc.5.html) - Documents `/proc` process and kernel interfaces.
- [systemd service manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) - Documents service process lifecycle behavior under systemd.
