---
title: "Process Management"
description: "Inspect, signal, and supervise running processes on Linux, and diagnose what happens when they refuse to die."
overview: "Learn how Linux runs programs as processes, then inspect, signal, prioritize, and troubleshoot live processes during operations work."
tags: ["processes", "ps", "signals", "top"]
order: 1
id: article-devops-foundation-linux-system-admin-process-management
---

## Table of Contents

1. [Linux Processes and Running Programs](#linux-processes-and-running-programs)
2. [What a Process Is](#what-a-process-is)
3. [PID, PPID, and the Process Tree](#pid-ppid-and-the-process-tree)
4. [Inspect Processes with `ps`, `pgrep`, and `top`](#inspect-processes-with-ps-pgrep-and-top)
5. [Signals and Graceful Shutdown](#signals-and-graceful-shutdown)
6. [Foreground, Background, and Jobs](#foreground-background-and-jobs)
7. [Priority, Nice Values, and I/O Priority](#priority-nice-values-and-io-priority)
8. [Inspect Live State in `/proc`](#inspect-live-state-in-proc)
9. [Failure Patterns](#failure-patterns)
10. [References](#references)

## Linux Processes and Running Programs
<!-- section-summary: Processes are the running programs that make services, shells, maintenance commands, and background work actually execute. -->

An operations question often starts with something simple: "Is the app actually running?" The answer lives in the process table. Nginx, your SSH shell, `curl`, `grep`, `journalctl`, backup jobs, and deployment scripts all appear there while they are doing work.

A program file on disk is only the recipe. A process is the live run of that recipe. Once the program is running, Linux can track who owns it, how long it has been alive, how much CPU and memory it uses, which files it has open, and which parent launched it.

Process management helps you answer everyday questions. Is the service alive? Who owns it? Did systemd launch it, or did someone run it from a shell? Can it stop cleanly, or is it stuck? Which parent process is responsible for it?

Systemd manages long-running services, but the process layer is still the ground truth for what is alive right now. When a dashboard says a service is unhealthy, process commands let you look at the live Linux objects behind that symptom.

The reason this layer exists is control. Linux cannot manage "a web app" as an idea. It manages concrete running objects with IDs, memory, open files, users, and state. Once you can inspect those objects, service failures stop looking like mystery crashes and start looking like specific processes doing specific things.

## What a Process Is
<!-- section-summary: A process is a running program with its own PID, memory, file descriptors, environment, and security identity. -->

Two processes can run the same file and still behave differently. One Node process may run production config as user `app`, while another test process runs from a developer shell with different environment variables. The file path alone does not explain the live behavior.

A process is the live execution of a program. The first important detail is the process ID, or PID, because Linux uses that number to inspect, signal, and account for the running object.

The next detail is live state. The process has memory, open files, environment variables, a current directory, a user identity, and kernel bookkeeping. Under the hood, the kernel keeps an address space, security credentials, file descriptor table, signal handlers, and scheduling state for it. The program file supplies the code; the process holds the runtime facts.

Find a Node process by name:

```bash
pgrep -a node
```

Example output:

```console
1842 node /srv/app/current/server.js
```

`1842` is the process ID, usually called the PID. The rest is the command line. If the service restarts, the new process usually gets a new PID even though it runs the same file.

Every process also has an owner. The owner controls which files the process can read, which ports it can bind, and which other processes it can signal. Long-running application services should usually run as a dedicated service account, with root reserved for system setup and the service manager.

Processes also have file descriptors. A file descriptor is a small number pointing at an open file, socket, pipe, or device. Standard input is descriptor `0`, standard output is `1`, and standard error is `2`. Log files, network sockets, and pipes get other descriptor numbers. Many production issues show up as too many open descriptors, a deleted log file still held open, or a socket attached to the wrong process.

The practical next decision after identifying a process is to ask what part of its live state matters. For a high-CPU process, inspect command line and logs. For a network listener, inspect sockets and owner. For a disk-space issue, inspect file descriptors. For a config question, inspect the service unit and environment rather than guessing from the program name.

## PID, PPID, and the Process Tree
<!-- section-summary: Parent-child relationships explain who started a process and who should reap it when it exits. -->

A common surprise appears after an SSH session closes and a manually launched service disappears with it. The process was alive, yet its parent was the login shell, so its lifetime was tied to that session.

That is why PID and PPID matter. The PID identifies the process itself. The PPID identifies the parent that launched it. A shell starts commands, Nginx has a master that starts workers, and systemd starts managed services.

On a systemd-based server, PID `1` is systemd. A production service usually belongs under systemd because PID `1` can track the process, collect its exit status, restart it according to policy, and keep it independent from a human SSH session.

Show a process tree:

```bash
ps -eo pid,ppid,user,stat,cmd --forest | grep -E "systemd|nginx|app|node"
```

Example output:

```console
    PID    PPID USER     STAT CMD
      1       0 root     Ss   /sbin/init
    912       1 root     Ss    nginx: master process /usr/sbin/nginx -g daemon on; master_process on;
    913     912 www-data S      \_ nginx: worker process
   1842       1 app      Ssl  /usr/bin/node /srv/app/current/server.js
```

What to notice:

- PID `1` is systemd, the root of the service tree on this server.
- Nginx has a root-owned master and a `www-data` worker.
- The application process is owned by `app` and parented by systemd.
- `STAT` shows state. `S` means sleeping, which is normal for a server waiting for requests. `R` means running on CPU. `Z` means zombie. `D` means uninterruptible sleep, often I/O wait.

The parent tells you how the process was started. If a production service is parented by `bash` or `zsh`, someone may have started it manually. It may die when the SSH session ends, and systemd may know nothing about it.

The next decision is supervision. A service under PID `1` usually belongs to systemd, so use `systemctl` and `journalctl`. A service under a login shell needs cleanup: stop the stray process, move the command into a proper unit, and make sure it starts through the same path after reboot.

## Inspect Processes with `ps`, `pgrep`, and `top`
<!-- section-summary: Process inspection commands show identity, command line, resource use, and runtime state. -->

A high-CPU alert usually needs two answers fast: which process is using the CPU, and whether that process is the service you expected. Use the process tools in layers instead of staring at a full table.

`ps` gives a snapshot. It is useful when you want a pasteable view for an incident note or when you need to sort by CPU or memory.

```bash
ps -eo pid,ppid,user,%cpu,%mem,etime,stat,cmd --sort=-%cpu | head
```

Example output:

```console
    PID    PPID USER     %CPU %MEM     ELAPSED STAT CMD
   1842       1 app      187.4 18.6    03:14:22 Ssl  /usr/bin/node /srv/app/current/server.js
    913     912 www-data  12.3  1.1    14-03:12 S    nginx: worker process
   2409    2310 root       6.8  0.4       12:01 R    tar -czf /var/backups/app.tgz /srv/app
```

The fields answer simple questions:

- `PID` is the process to inspect or signal.
- `PPID` tells you the parent.
- `USER` tells you the security identity.
- `%CPU` and `%MEM` show current resource use.
- `ETIME` shows how long the process has been alive.
- `STAT` shows the process state.

`pgrep` finds matching processes without scanning a full table:

```bash
pgrep -a nginx
```

Example output:

```console
912 nginx: master process /usr/sbin/nginx -g daemon on; master_process on;
913 nginx: worker process
914 nginx: worker process
```

Limit by user when the process name is common:

```bash
pgrep -a -u app node
```

Example output:

```console
1842 node /srv/app/current/server.js
```

`top` gives a live view:

```bash
top
```

Example output:

```console
top - 10:42:15 up 14 days,  3:22,  1 user,  load average: 1.84, 1.62, 1.20
Tasks: 128 total,   2 running, 126 sleeping,   0 stopped,   0 zombie
%Cpu(s): 82.0 us,  6.0 sy,  0.0 ni,  9.0 id,  2.0 wa,  0.0 hi,  1.0 si,  0.0 st
    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
   1842 app       20   0 1840420 742312  45120 S 187.4  18.6  34:10.23 node
    913 www-data  20   0  151248  45224  12140 S  12.3   1.1   2:18.40 nginx
```

Inside `top`, `P` sorts by CPU, `M` sorts by memory, `1` shows per-CPU lines, and `c` toggles full command lines. Many servers also have `htop`, but `top` is the safer baseline because it is present on many minimal systems.

## Signals and Graceful Shutdown
<!-- section-summary: Signals are small messages Linux sends to processes to ask for actions such as reload, stop, or immediate termination. -->

During a deploy, you often need a running process to stop cleanly or reread config. Pulling the plug with an immediate kill can interrupt requests and skip cleanup. Linux gives you a gentler path first: send a signal.

A signal is a small message sent to a process. `TERM` asks the process to shut down cleanly. `HUP` often asks a server to reload config or reopen logs. `KILL` is the hard stop handled by the kernel.

The `kill` command sends these signals, even though the name sounds more dramatic than most signal use. The kernel delivers the signal, and the process either handles it, ignores it, or receives the default behavior. Some signals, such as `KILL`, cannot be caught by the process.

Common signals:

| Signal | Number | Meaning |
|---|---:|---|
| `TERM` | 15 | Ask the process to terminate gracefully |
| `INT` | 2 | Interrupt, similar to pressing `Ctrl+C` |
| `HUP` | 1 | Often used to reload config or reopen logs |
| `KILL` | 9 | Immediate kernel-level termination |
| `USR1` / `USR2` | varies | Application-defined behavior |

Ask a process to stop gracefully:

```bash
sudo kill -TERM 1842
```

No output usually means the signal was sent. Now check whether the PID remains:

```bash
ps -p 1842 -o pid,stat,etime,cmd
```

Example output:

```console
    PID STAT     ELAPSED CMD
   1842 Ssl      03:15:10 /usr/bin/node /srv/app/current/server.js
```

If the process still exists after a reasonable wait, inspect its state and logs. A process in `D` state may be stuck on I/O. A process in `S` state may still be running shutdown code.

`KILL` ends the process immediately:

```bash
sudo kill -KILL 1842
```

`KILL` gives the process no chance to clean up. It can interrupt requests, skip shutdown hooks, and leave temporary files behind. A common escalation is `TERM`, wait, inspect, then `KILL` only after you know the process will not exit.

For managed services, prefer service-aware controls:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Example output:

```console
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Nginx knows how to reload configuration and replace workers gracefully. systemd knows how to stop, restart, and track managed services. Direct signals are useful, but service managers often provide the safer path.

The next decision is escalation. Use `TERM` or a service reload when the process can clean up. Check logs and state if it does not exit. Use `KILL` only after collecting enough evidence, because it skips shutdown handlers, open-request cleanup, and application-level final logs.

## Foreground, Background, and Jobs
<!-- section-summary: Shell job control explains what happens when commands run in your terminal versus under a service manager. -->

A common SSH surprise is a long report command that stops as soon as the laptop sleeps or the network drops. Another version is worse: someone starts a web worker with `&`, logs out, and later nobody knows whether that process still belongs to a terminal, systemd, or nothing at all.

When you type a command in a terminal, it usually runs in the foreground. Your shell waits until it finishes. Adding `&` runs it in the background under that same shell session.

Job control exists for interactive work. The shell tracks foreground and background jobs so you can pause, resume, and move commands while using one terminal. The important production detail is ownership: a background job still belongs to that shell session unless another supervisor takes over.

```bash
long-report-generator &
```

Example output:

```console
[1] 2409
```

The first number is the shell job number. The second number is the PID.

Show background jobs from the current shell:

```bash
jobs
```

Example output:

```console
[1]+  Running                 long-report-generator &
```

Bring a job back to the foreground:

```bash
fg %1
```

Example output:

```console
long-report-generator
```

Shell jobs are useful for short personal work. They are a poor home for production services because they belong to your terminal session. When the SSH session closes, the process may receive a hangup signal or lose its terminal.

Managed services belong under systemd:

```bash
systemctl status app.service --no-pager
```

Example output:

```console
app.service - Application service
     Active: active (running) since Wed 2026-06-24 10:18:36 UTC; 24min ago
   Main PID: 1842 (node)
```

If a long-running service is parented by a shell instead of systemd, treat that as a deployment or operations problem.

The next decision is lifetime. Short commands can live in a shell job. Long-running services, workers, and scheduled jobs need a service manager or scheduler so they have logs, restart policy, boot behavior, and a clear owner.

## Priority, Nice Values, and I/O Priority
<!-- section-summary: Nice values and I/O priority influence scheduling, but they are tuning tools after the real workload is understood. -->

Picture a backup job compressing old releases at noon while the web service is also handling user traffic. Both need CPU, and the backup is less urgent. Priority tools let you make that maintenance work more polite.

A nice value influences CPU scheduling. Normal processes use nice `0`. Positive values, such as `10`, lower the process priority so other CPU work gets preference. Lower nice values raise priority and usually require elevated privileges.

Disk-heavy work has a similar concern. A backup can also compete for I/O, so `ionice` lets you lower its disk priority while it runs.

Run a maintenance task with lower CPU priority:

```bash
nice -n 10 tar -czf /var/backups/app.tgz /srv/app
```

The command may produce no output while it runs. Confirm the nice value from another terminal:

```bash
ps -C tar -o pid,ni,cmd
```

Example output:

```console
    PID  NI CMD
   2409  10 tar -czf /var/backups/app.tgz /srv/app
```

Change an already running process:

```bash
sudo renice 10 -p 2409
```

Example output:

```console
2409 (process ID) old priority 0, new priority 10
```

Disk I/O has its own priority through `ionice`:

```bash
sudo ionice -c2 -n7 -p 2409
```

Confirm CPU priority again:

```bash
ps -p 2409 -o pid,ni,cmd
```

Example output:

```console
    PID  NI CMD
   2409  10 tar -czf /var/backups/app.tgz /srv/app
```

Priority tools help when a backup, compression job, or report export competes with a service. They do not replace capacity work. If the main service always needs more CPU, the real fix may be code changes, scheduling changes, caching, or a larger machine.

The next decision is temporary tuning versus real capacity work. Use `nice` or `ionice` to reduce the impact of maintenance jobs. If normal request handling still saturates the host, tune the application, move background work, scale out, or resize the machine.

## Inspect Live State in `/proc`
<!-- section-summary: `/proc/<pid>` exposes live kernel details about a process, including command line, limits, environment, and open files. -->

A mystery process is easier to handle once you ask concrete questions. What exact command launched it? Which environment did it receive? How much memory does the kernel see? What open-file limit applies? Which files or sockets does it still hold?

`/proc/<pid>` answers those questions from the kernel's live view. For PID `1842`, `/proc/1842` contains details about that process. Tools such as `ps`, `top`, and `free` use this kernel data too, and operators can inspect it directly during an incident.

Useful paths:

| Path | What it shows |
|---|---|
| `/proc/1842/cmdline` | Command used to start the process |
| `/proc/1842/environ` | Environment variables, separated by null bytes |
| `/proc/1842/status` | State, memory summary, UIDs, GIDs, threads |
| `/proc/1842/limits` | Resource limits such as open files |
| `/proc/1842/fd` | Open file descriptors |
| `/proc/1842/cwd` | Current working directory symlink |

Make the command line readable:

```bash
tr '\0' ' ' < /proc/1842/cmdline
```

Example output:

```console
/usr/bin/node /srv/app/current/server.js
```

Pull one environment variable safely:

```bash
sudo tr '\0' '\n' < /proc/1842/environ | grep '^NODE_ENV='
```

Example output:

```console
NODE_ENV=production
```

Check process state and memory:

```bash
grep -E 'State|Threads|VmRSS|VmSize' /proc/1842/status
```

Example output:

```console
State:  S (sleeping)
VmSize: 1840420 kB
VmRSS:   742312 kB
Threads:      18
```

Check open files:

```bash
ls -lah /proc/1842/fd | head
```

Example output:

```console
lrwx------ 1 app app 64 Jun 24 10:45 0 -> /dev/null
l-wx------ 1 app app 64 Jun 24 10:45 1 -> /var/log/app/stdout.log
l-wx------ 1 app app 64 Jun 24 10:45 2 -> /var/log/app/stderr.log
lrwx------ 1 app app 64 Jun 24 10:45 18 -> socket:[48122]
```

Environment variables can contain secrets, so handle `/proc/<pid>/environ` carefully. Use targeted filters, avoid pasting full output into chat systems, and prefer service configuration files or secret managers for normal review.

The next decision is which live fact you need. Use `/proc/<pid>/fd` when disk space, sockets, or deleted files are involved. Use `/proc/<pid>/limits` when the process hits "too many open files." Use `/proc/<pid>/status` when memory, threads, or state needs confirmation. Use `/proc/<pid>/environ` sparingly because it may expose secrets.

## Failure Patterns
<!-- section-summary: Common process failures include runaway CPU, stuck shutdown, zombies, orphaned manual processes, and OOM kills. -->

A troubleshooting session usually starts from symptoms, then maps each symptom to a process clue.

Take one worked diagnosis. Users report intermittent timeouts, and `systemctl status app.service` says the service is healthy. `ss -ltnp` shows port `3000` owned by a `node` process whose parent is `bash`, not systemd. `pgrep -a node` shows two app processes: the managed service and a manual copy launched from an old release directory. At that point, the fix is not another restart. Stop the stray process, confirm the listener belongs to `app.service`, and review the deploy path so long-running work cannot launch outside the service manager again.

If the host CPU stays high, use `top` or sorted `ps` to find the process near a full core or more. Capture the PID, command line, and logs before restarting so the team has evidence for the root cause.

If a restart hangs, the old process may be blocked on I/O, stuck in cleanup, or ignoring `TERM`. Inspect `STAT`, service logs, and open files before escalating to `KILL`.

If `ps` shows `Z`, the process already exited and the parent has not collected its status. One short-lived zombie may disappear quickly. A growing number points at a parent process bug.

If health checks disagree with `systemctl status`, look for a stray manual process. Someone may have launched long-running work outside systemd, and that process may still listen on a port. `ss -ltnp`, `pgrep -a`, and the process tree help find the actual listener.

If a service vanishes without a clean application error, check for an OOM kill. The CPU and memory article shows how to confirm that path with `journalctl -k`, `free`, `vmstat`, and process RSS.

These patterns all point to a next check. Runaway CPU needs the owner, command line, and logs. Stuck shutdown needs state, open files, and service logs. Zombies need the parent process. Orphans need the listener and parent tree. OOM kills need kernel logs and memory history. The process table gives the live clue, then the matching subsystem explains why it happened.

Process management gives you the live view. systemd adds the long-running service contract on top of it.

## References

- [Linux `ps(1)` manual](https://man7.org/linux/man-pages/man1/ps.1.html) - Documents process snapshot output and state codes.
- [Linux `pgrep(1)` manual](https://man7.org/linux/man-pages/man1/pgrep.1.html) - Documents process matching by name, user, and command line.
- [Linux `top(1)` manual](https://man7.org/linux/man-pages/man1/top.1.html) - Documents live process monitoring.
- [Linux `signal(7)` manual](https://man7.org/linux/man-pages/man7/signal.7.html) - Documents standard signals and their behavior.
- [Linux `proc(5)` manual](https://man7.org/linux/man-pages/man5/proc.5.html) - Documents `/proc` process and kernel interfaces.
- [systemd service manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) - Documents service process lifecycle behavior under systemd.
