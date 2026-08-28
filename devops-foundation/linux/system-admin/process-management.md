---
title: "Process Management"
description: "Inspect, signal, and supervise running processes on Linux, and diagnose what happens when they refuse to die."
overview: "Learn how Linux runs programs as processes, then inspect, signal, prioritize, and troubleshoot live processes during operations work."
tags: ["processes", "ps", "signals", "top"]
order: 1
id: article-devops-foundation-linux-system-admin-process-management
---

## Table of Contents

1. [What Is a Linux Process?](#what-is-a-linux-process)
2. [How Do Process Creation, PIDs, Parents, and Exit Status Fit Together?](#how-do-process-creation-pids-parents-and-exit-status-fit-together)
3. [Why Are PID 1 and Service Managers Special?](#why-are-pid-1-and-service-managers-special)
4. [How Do You Inspect Processes, Threads, and States?](#how-do-you-inspect-processes-threads-and-states)
5. [How Do Signals Control a Process Lifecycle?](#how-do-signals-control-a-process-lifecycle)
6. [How Do Terminals, Jobs, Sessions, and SSH Affect Lifetime?](#how-do-terminals-jobs-sessions-and-ssh-affect-lifetime)
7. [How Do Identity, /proc, Priority, and cgroups Describe Resources?](#how-do-identity-proc-priority-and-cgroups-describe-resources)
8. [How Do You Diagnose a Process That Exits, Hangs, or Returns?](#how-do-you-diagnose-a-process-that-exits-hangs-or-returns)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

You have already started processes if you have opened Terminal, connected to a server with SSH, run `nano`, launched `curl`, or started a Node app. The command may feel like one small line of text, but Linux has to run something real behind that line. While that thing is running, Linux tracks it as a **process**.

A process is one running copy of a program. The file `/usr/bin/curl` can sit on disk all day doing nothing. When you type `curl https://example.com`, Linux starts a live copy of that program, gives it memory, connects it to your terminal, lets it open network connections, and tracks it until it exits.

The same program can have many running copies at the same time. Two people can run `nano` in two SSH sessions. A web server can have several worker processes handling requests. Each copy gets its own process identity, its own memory, and its own live state.

Keep these questions in view as you work through the lesson:

1. **What Is a Linux Process?**
2. **How Do Process Creation, PIDs, Parents, and Exit Status Fit Together?**
3. **Why Are PID 1 and Service Managers Special?**
4. **How Do You Inspect Processes, Threads, and States?**
5. **How Do Signals Control a Process Lifecycle?**
6. **How Do Terminals, Jobs, Sessions, and SSH Affect Lifetime?**
7. **How Do Identity, `/proc`, Priority, and cgroups Describe Resources?**
8. **How Do You Diagnose a Process That Exits, Hangs, or Returns?**

## What Is a Linux Process?
<!-- section-summary: Every command, shell, server, and background task is a running program that Linux tracks as a process. -->

Try a tiny command that stays alive long enough to inspect:

```bash
sleep 60
```

In another terminal, ask Linux to find it:

```bash
pgrep -a sleep

# Example output:
# 2409 sleep 60
```

The output tells you two useful things:

- `2409` is the process ID for this running copy.
- `sleep 60` is the command line that launched it.
- If you run another `sleep 60`, Linux gives that second copy a different process ID.

Under the hood, the kernel stores more than the command name. It tracks the process owner, current directory, environment variables, open files, signal rules, memory, CPU scheduling information, and parent process. The simplest handle is the process ID.

## How Do Process Creation, PIDs, Parents, and Exit Status Fit Together?
<!-- section-summary: PID names the running process itself, while PPID names the process that started it. -->

You open an SSH session and type `nano notes.txt`. The editor appears in your terminal, and your shell waits for it to finish. Linux does not remember that situation as a vague idea like "the editor is open." It gives the running editor an ID badge so other parts of the system can talk about that exact process.

The **PID** is the process ID badge. It identifies one running process right now. The **PPID** is the parent process ID badge. It points to the process that started this one, usually your shell for interactive commands or systemd for managed services.

Run a command that starts another program from your shell:

```bash
ps -o pid,ppid,user,stat,cmd -p $$

# Example output:
#     PID    PPID USER     STAT CMD
#    2310    2309 deploy   Ss   -bash
```

The important lines are small but powerful:

- `PID 2310` is the shell you are using.
- `PPID 2309` is the process that started that shell, often the SSH session process.
- `CMD -bash` tells you this process is your shell.

Now start `nano`, `curl`, or a Node script from that shell. The child process gets its own PID, and its PPID points back to the shell. A concrete example might look like this while `nano` is open:

```bash
ps -eo pid,ppid,user,stat,cmd --forest | grep -E "sshd|bash|nano"

# Example output:
#    2309       1 root     Ss    sshd: deploy [priv]
#    2310    2309 deploy   Ss     \_ -bash
#    2468    2310 deploy   S+         \_ nano notes.txt
```

The tree runs from the SSH session down to the editor:

- `sshd` accepted the remote login and started the session.
- `bash` is the shell inside that SSH session.
- `nano` is the child process launched by the shell.
- The `+` in `S+` means `nano` is in the foreground process group for the terminal.

This is why PPID is more than a trivia field. If a process belongs to your shell, its life is tied to that interactive session unless you take special steps. If a production service belongs to systemd, it has a service manager watching it after you disconnect.

![Process anatomy infographic showing PID, PPID, user, state, CPU, memory, command, and child processes](/content-assets/articles/article-devops-foundation-linux-system-admin-process-management/process-anatomy.png)

_The image turns a process row into named fields so `ps` output is easier to inspect._

### How Do the Process Tree and Exit Status Carry Lifecycle Information?
<!-- section-summary: Parent processes start child processes and collect their small exit reports after they finish. -->

You have probably seen a command fail and then checked `$?`, or watched a shell prompt return after a command finishes. That little return to the prompt hides an important process habit. The child finished, and the parent shell collected its ending result.

A parent process starts a child process, then later collects the child's **exit status**. Think of exit status as a tiny report card. `0` means the command says it succeeded. A nonzero number means the command reports some kind of failure, and the exact number depends on the program.

Run one successful command and one failing command:

```bash
true
echo $?
false
echo $?

# Example output:
# 0
# 1
```

The output means:

- `true` exited with status `0`, so the shell treats it as success.
- `false` exited with status `1`, so the shell treats it as failure.
- Scripts, deploy commands, and health checks use this same success-or-failure signal.

Parents also have a cleanup job. After a child exits, the parent collects the exit status so the kernel can finish cleaning up the child's process record. If a child exits and the parent has not collected that status yet, `ps` may show the child as a zombie with state `Z`.

Here is what a small process tree can look like on a web server:

```bash
ps -eo pid,ppid,user,stat,cmd --forest | grep -E "systemd|nginx|node|bash"

# Example output:
#     PID    PPID USER     STAT CMD
#       1       0 root     Ss   /sbin/init
#     912       1 root     Ss    nginx: master process /usr/sbin/nginx -g daemon on; master_process on;
#     913     912 www-data S      \_ nginx: worker process
#    1842       1 app      Ssl  /usr/bin/node /srv/app/current/server.js
#    2310    2309 deploy   Ss   -bash
```

The tree gives you the story:

- Nginx has a master process that started worker processes.
- The Node app has PID `1842` and parent PID `1`.
- Your interactive shell has its own place in the tree.
- `STAT` shows current state: `S` is sleeping, `R` is running, `Z` is zombie, and `D` usually points to uninterruptible I/O wait.

Under the hood, Linux keeps this parent-child shape so resources and endings can be accounted for. You do not need to memorize kernel data structures. In daily operations, the useful question is simpler: who started this process, and who is responsible for cleaning it up or restarting it?

## Why Are PID 1 and Service Managers Special?
<!-- section-summary: On modern Linux servers, systemd usually runs as PID 1 and starts the long-running services that should survive your SSH session. -->

Now picture a more painful beginner moment. You SSH into a server, run `node server.js`, see the app respond, close the laptop, and later the site is down. The program worked while your terminal was alive, but it was living under your login shell instead of under the service manager.

On most modern Linux servers, **systemd** is the first long-lived parent process. It runs as PID `1`. Services that should survive logouts and reboots usually sit under systemd so there is one clear manager for start, stop, restart, logs, and exit collection.

Check PID `1`:

```bash
ps -p 1 -o pid,ppid,user,stat,cmd

# Example output:
#     PID    PPID USER     STAT CMD
#       1       0 root     Ss   /sbin/init
```

On many distributions, `/sbin/init` points to systemd:

```bash
readlink -f /sbin/init

# Example output:
# /usr/lib/systemd/systemd
```

Those two checks tell you:

- PID `1` is the root process for normal service management on this host.
- systemd starts services from unit files instead of from your shell history.
- When a managed service exits, systemd can collect its exit status and apply restart policy.

This is the bridge from process management to service management. Processes are the live running objects. systemd is the parent and manager you usually want for long-running server work. If you find an app process parented by `bash`, treat that as a clue that someone started it by hand.

## How Do You Inspect Processes, Threads, and States?
<!-- section-summary: `ps`, `pgrep`, and `top` let you inspect the process table from quick lookup to live resource view. -->

Suppose the server feels slow. You do not need to guess which program is busy. Start by asking Linux for the process table, then narrow the answer until you know the process, owner, parent, command line, and resource use.

`ps` gives a snapshot. Use it when you need a stable view for troubleshooting notes or a sorted list of current CPU and memory users.

```bash
ps -eo pid,ppid,user,%cpu,%mem,etime,stat,cmd --sort=-%cpu | head

# Example output:
#     PID    PPID USER     %CPU %MEM     ELAPSED STAT CMD
#    1842       1 app      187.4 18.6    03:14:22 Ssl  /usr/bin/node /srv/app/current/server.js
#     913     912 www-data  12.3  1.1    14-03:12 S    nginx: worker process
#    2409    2310 deploy     6.8  0.4       12:01 R    tar -czf /var/backups/app.tgz /srv/app
```

Use the fields like a checklist:

- `PID` names the process you can inspect or signal.
- `PPID` tells you who started it.
- `USER` tells you which Linux account owns it.
- `%CPU` and `%MEM` show current resource pressure.
- `ETIME` tells you how long it has been alive.
- `STAT` gives a compact state code.

`pgrep` is the faster tool when you already know part of the name:

```bash
pgrep -a -u app node

# Example output:
# 1842 node /srv/app/current/server.js
```

The options matter:

- `-a` prints the full command line, which helps distinguish two copies of the same program.
- `-u app` limits the search to processes owned by the `app` account.
- `node` is the process name pattern you are searching for.

`top` gives a live view that updates while you watch:

```bash
top

# Example output:
# top - 10:42:15 up 14 days,  3:22,  1 user,  load average: 1.84, 1.62, 1.20
# Tasks: 128 total,   2 running, 126 sleeping,   0 stopped,   0 zombie
# %Cpu(s): 82.0 us,  6.0 sy,  0.0 ni,  9.0 id,  2.0 wa,  0.0 hi,  1.0 si,  0.0 st
#     PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
#    1842 app       20   0 1840420 742312  45120 S 187.4  18.6  34:10.23 node
#     913 www-data  20   0  151248  45224  12140 S  12.3   1.1   2:18.40 nginx
```

Inside `top`, press `P` to sort by CPU, `M` to sort by memory, `1` to show per-CPU lines, and `c` to toggle full command lines. Many teams install `htop` too, but `top` is the reliable baseline on minimal servers.

Once you identify the process, the next question is usually control. If it is healthy but busy, keep gathering evidence. If it needs to stop or reload, send the right message instead of reaching straight for the harshest option.

## How Do Signals Control a Process Lifecycle?
<!-- section-summary: Signals are small messages to processes, and graceful stop signals should come before forced termination. -->

During a deploy, you may need an old process to stop so a new one can start. During a config change, you may want a server to reread files without dropping active work. Linux handles these requests with **signals**, which are small messages sent to a process.

A signal asks a process to do something. `TERM` asks for a clean shutdown. `INT` is similar to pressing `Ctrl+C` in a terminal. `HUP` often tells server programs to reload config or reopen logs. `KILL` is the hard stop that the kernel applies immediately.

Common signals:

| Signal | Number | Typical use |
|---|---:|---|
| `TERM` | 15 | Ask the process to shut down cleanly |
| `INT` | 2 | Interrupt from a terminal, usually `Ctrl+C` |
| `HUP` | 1 | Reload config or reopen logs for programs that support it |
| `KILL` | 9 | Force immediate termination through the kernel |
| `USR1` / `USR2` | varies | Application-specific behavior |

Ask a process to stop cleanly:

```bash
sudo kill -TERM 1842
```

The command usually prints no output when the signal is sent. Check whether the process exited:

```bash
ps -p 1842 -o pid,stat,etime,cmd

# Example output:
#     PID STAT     ELAPSED CMD
#    1842 Ssl      03:15:10 /usr/bin/node /srv/app/current/server.js
```

This output means the process still exists:

- `PID 1842` is still present.
- `STAT Ssl` says it is sleeping with multiple threads and a session-leading process state.
- The command line confirms you are still looking at the Node service.

If it does not exit after a reasonable wait, inspect logs and state before using a harder signal. A process may be finishing requests, flushing data, or stuck on storage. Jumping straight to `KILL` can skip cleanup code and remove the final application log line that would have explained the problem.

Use `KILL` only after the graceful path has failed:

```bash
sudo kill -KILL 1842
```

For managed services, use the service-aware command when possible:

```bash
sudo nginx -t
sudo systemctl reload nginx

# Example output:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
```

The lines matter because they show a safer path:

- `nginx -t` validates the config before the live process reloads it.
- `systemctl reload nginx` asks systemd to use the service's reload behavior.
- If reload is unsupported, `systemctl restart service-name` is usually clearer than sending random signals by hand.

Signals are process-level control. Services add another layer above that control, which is why the parent relationship from earlier keeps paying off.

![Process incident evidence infographic showing process tree, PID and PPID, signals, priority, nice values, proc evidence, SIGTERM, and SIGKILL](/content-assets/articles/article-devops-foundation-linux-system-admin-process-management/process-incident-evidence.png)

_The image shows the evidence path for a process incident before reaching for a hard kill._

## How Do Terminals, Jobs, Sessions, and SSH Affect Lifetime?
<!-- section-summary: Foreground and background jobs explain why shell-launched work can disappear with an SSH session. -->

A very normal beginner move is to start a long command over SSH, then worry about closing the laptop. Maybe it is a database export, a tar backup, or a script that takes twenty minutes. The command is a process, but it is also attached to a terminal session unless another tool takes ownership.

When a command runs in the **foreground**, your shell waits for it and your terminal input goes to that command. When you add `&`, the command runs in the **background** and the shell gives you the prompt back. It is still a child of that shell, so the SSH session is still part of the story.

Start a background job:

```bash
long-report-generator &

# Example output:
# [1] 2409
```

The two numbers are easy to mix up at first:

- `[1]` is the shell's job number for this terminal session.
- `2409` is the Linux PID for the running process.
- Another terminal cannot use `%1` because that job number belongs to this shell.

Show background jobs from the current shell:

```bash
jobs

# Example output:
# [1]+  Running                 long-report-generator &
```

Bring the job back to the foreground:

```bash
fg %1

# Example output:
# long-report-generator
```

This is useful for personal terminal work. It is risky for production services because closing the SSH session can send a hangup signal, remove the terminal, or leave a process nobody expects. Tools such as `tmux` can help with long interactive sessions, but a web server or worker should live under systemd.

Compare a service process:

```bash
systemctl status app.service --no-pager

# Example output:
# app.service - Application service
#      Active: active (running) since Wed 2026-06-24 10:18:36 UTC; 24min ago
#    Main PID: 1842 (node)
```

The status output ties the process to a service:

- `Active: active (running)` tells you systemd is managing it.
- `Main PID: 1842` connects the service back to the process table.
- The service keeps a clear owner after you disconnect from SSH.

Keep shell jobs for short interactive work. Move long-running services, workers, and scheduled production tasks into systemd units or timers so logs, restarts, and boot behavior are written down.

## How Do Identity, `/proc`, Priority, and cgroups Describe Resources?
<!-- section-summary: Nice values influence CPU scheduling, while `/proc/<pid>` exposes the live process details behind command output. -->

Picture a backup job compressing old releases at noon while the web app is serving users. Both jobs need CPU, and the backup is less urgent. Linux lets you mark that backup as lower priority so request handling has a better chance to run first.

A **nice value** influences CPU scheduling. Normal processes usually start at nice `0`. A higher nice value, such as `10`, makes the process more polite to other CPU work. Lower nice values raise priority and usually require elevated privileges.

Run a maintenance command with lower CPU priority:

```bash
nice -n 10 tar -czf /var/backups/app.tgz /srv/app
```

This command may not print anything while it runs. Check the nice value from another terminal:

```bash
ps -C tar -o pid,ppid,ni,stat,cmd

# Example output:
#     PID    PPID  NI STAT CMD
#    2409    2310  10 R    tar -czf /var/backups/app.tgz /srv/app
```

The fields explain the setup:

- `NI 10` confirms the lower CPU priority.
- `PPID 2310` says the backup came from the shell with PID `2310`.
- `STAT R` says the process is currently runnable or running.

Change a process that is already running:

```bash
sudo renice 10 -p 2409

# Example output:
# 2409 (process ID) old priority 0, new priority 10
```

Disk-heavy work has the same kind of concern, only the shared resource is storage instead of CPU. A backup that reads a large release directory and writes a compressed archive can slow request logs, database files, or upload handling on the same disk. `ionice` lets you tell the kernel that this process can wait behind more urgent disk work.

Apply a low I/O priority to the running backup:

```bash
sudo ionice -c2 -n7 -p 2409
```

The command often prints no output on success:

- `-c2` selects the best-effort I/O scheduling class, which is suitable for normal work that can share the disk.
- `-n7` uses the lowest priority inside that class, so the backup should yield to other best-effort disk users.
- `-p 2409` applies the setting to the running backup process.

Check the I/O scheduling class after setting it:

```bash
sudo ionice -p 2409

# Example output:
# best-effort: prio 7
```

That output proves the process now has best-effort I/O priority `7`. It does not prove the backup is harmless, so pair it with disk metrics such as `iostat`, `iotop`, or `/proc/<pid>/io` when the server is still slow.

When process commands leave you with a missing detail, inspect `/proc/<pid>`. `/proc` is a live filesystem view from the kernel. It is not a normal directory full of saved files. Linux creates entries there to expose what the kernel currently knows about processes, memory, mounts, devices, and other runtime state. Each running process gets its own directory, so PID `1842` has `/proc/1842`.

A beginner usually checks `/proc/<pid>` for questions that normal command output only hints at:

- Which exact command and arguments started this process?
- Which environment variables did the process receive?
- Which resource limits apply right now?
- Which files, sockets, and pipes are still open?
- Which working directory is the process using?

The command line is a gentle first check because it connects a PID to the program you recognize:

```bash
tr '\0' ' ' < /proc/1842/cmdline

# Example output:
# /usr/bin/node /srv/app/current/server.js
```

The strange `tr '\0' ' '` part is there because the kernel stores command-line arguments separated by NUL bytes. Converting those separators to spaces makes the output readable in the terminal.

Some useful `/proc` paths answer different operational questions:

- `/proc/1842/cmdline` shows the exact command that launched this process.
- `/proc/1842/environ` shows the environment variables the process received.
- `/proc/1842/status` shows state, memory, UIDs, GIDs, and thread count from the kernel.
- `/proc/1842/limits` shows resource limits such as maximum open files.
- `/proc/1842/fd` shows the process's open file descriptors.
- `/proc/1842/cwd` points to the working directory the process is using.

Check process state and memory from `/proc`:

```bash
grep -E 'State|Threads|VmRSS|VmSize' /proc/1842/status

# Example output:
# State:  S (sleeping)
# VmSize: 1840420 kB
# VmRSS:   742312 kB
# Threads:      18
```

Pull one environment variable safely:

```bash
sudo tr '\0' '\n' < /proc/1842/environ | grep '^NODE_ENV='

# Example output:
# NODE_ENV=production
```

The `fd` directory deserves a slower look because it explains many production surprises. A **file descriptor** is a small number a process uses for something it has opened. It can point to a regular file, a log file, a socket, a pipe, `/dev/null`, or another kernel object. Programs usually reserve descriptor `0` for standard input, `1` for standard output, and `2` for standard error. Higher numbers are files and connections the program opened later.

Check open file descriptors:

```bash
ls -lah /proc/1842/fd | head

# Example output:
# lrwx------ 1 app app 64 Jun 24 10:45 0 -> /dev/null
# l-wx------ 1 app app 64 Jun 24 10:45 1 -> /var/log/app/stdout.log
# l-wx------ 1 app app 64 Jun 24 10:45 2 -> /var/log/app/stderr.log
# lrwx------ 1 app app 64 Jun 24 10:45 18 -> socket:[48122]
```

Read each line from right to left:

- `0 -> /dev/null` means standard input is connected to `/dev/null`, so the service is not waiting for keyboard input.
- `1 -> /var/log/app/stdout.log` means standard output is being written to that log file.
- `2 -> /var/log/app/stderr.log` means errors written to stderr go to a separate log file.
- `18 -> socket:[48122]` means descriptor `18` is a socket. The bracketed number is a kernel socket identifier, not a path on disk.
- `l-wx------` means descriptor `1` and `2` are symbolic links and the process has write access through them.

This check helps with concrete problems. If disk space stays full after you remove a log file, `/proc/<pid>/fd` or `lsof` may show that a service still holds the deleted file open. If an app cannot write logs, the descriptor target may reveal the wrong path or permissions. If a service should listen on a socket, socket descriptors help confirm it opened network connections.

Environment variables can contain secrets, so inspect `/proc/<pid>/environ` with care. Use targeted filters, avoid pasting full environment output into tickets or chat, and prefer service config files or secret managers for normal review.

Priority tools are useful for maintenance jobs. `/proc` is useful for live facts. Both are part of the same habit: inspect the process you actually have, then choose the smallest action that fits the evidence.

## How Do You Diagnose a Process That Exits, Hangs, or Returns?
<!-- section-summary: Process clues help you diagnose high CPU, stray manual services, stuck shutdown, zombies, and memory kills. -->

Troubleshooting usually starts with a human symptom. Someone says the site is slow, a deploy hangs, or a health check disagrees with the service status. The process table helps turn that broad symptom into a specific running object.

**The site is slow and one process is burning CPU.** A sorted snapshot shows the busiest process first:

```bash
ps -eo pid,ppid,user,%cpu,%mem,etime,stat,cmd --sort=-%cpu | head

# Example output:
#     PID    PPID USER     %CPU %MEM     ELAPSED STAT CMD
#    1842       1 app      197.0 22.1    04:02:11 Rsl  /usr/bin/node /srv/app/current/server.js
```

Work the clue in order:

- `PID 1842` is the target for deeper inspection.
- `PPID 1` says systemd started it, so use `systemctl status app.service` and `journalctl -u app.service`.
- `%CPU 197.0` means it is using about two CPU cores.
- Capture logs, current route traffic, and any recent deploy details before restarting.

**The health check passes, but `systemctl status` shows the service failed.** Look for a stray manual process holding the port:

```bash
ss -ltnp | grep ':3000'
pgrep -a node
ps -o pid,ppid,user,cmd -p 2601

# Example output:
# LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=2601,fd=18))
# 1842 node /srv/app/current/server.js
# 2601 node /home/deploy/app/server.js
#     PID    PPID USER     CMD
#    2601    2310 deploy   node /home/deploy/app/server.js
```

This diagnosis has a clear story:

- PID `2601` owns the port that the health check reaches.
- Its PPID is the deploy user's shell, not systemd.
- The service unit may have failed while a manual copy kept answering checks.
- Stop the stray process, start the managed service, and fix the deploy path so long-running work starts through systemd.

**A stop or restart hangs.** Ask whether the old process is still alive and what state it reports:

```bash
ps -p 1842 -o pid,ppid,stat,etime,cmd
journalctl -u app.service -n 30 --no-pager

# Example output:
#     PID    PPID STAT     ELAPSED CMD
#    1842       1 Dsl      04:15:44 /usr/bin/node /srv/app/current/server.js
```

The important detail is `D` in the state field. That often means uninterruptible I/O wait, such as a stuck disk or network filesystem operation. Sending `KILL` may not remove it immediately because the kernel is waiting for the I/O path. Check storage, mounts, and recent kernel logs before assuming the app ignored shutdown.

**A zombie appears in `ps`.** A zombie is already dead as a running program, but its parent has not collected the exit report yet:

```bash
ps -eo pid,ppid,stat,cmd | grep ' Z'

# Example output:
#    2712    1842 Z    [node] <defunct>
```

Use the PPID to find the parent:

```bash
ps -p 1842 -o pid,user,stat,cmd

# Example output:
#     PID USER     STAT CMD
#    1842 app      Ssl  /usr/bin/node /srv/app/current/server.js
```

One short-lived zombie may vanish quickly. A growing list of zombies points toward a parent process that is failing to collect child exit statuses. That is usually an application bug or process supervisor bug, not a reason to signal the zombie itself.

**A service vanishes with no clean application error.** Check whether the kernel killed it because memory was exhausted:

```bash
journalctl -k --since "1 hour ago" --no-pager | grep -i 'killed process'

# Example output:
# Jun 24 11:03:18 web-01 kernel: Out of memory: Killed process 1842 (node) total-vm:1840420kB, anon-rss:742312kB
```

This output points away from normal application shutdown:

- `Out of memory` says the kernel selected a process during memory pressure.
- `Killed process 1842 (node)` ties the event to the PID you were investigating.
- The next checks are memory history, service limits, traffic spike, and recent code paths that allocate large objects.

Each diagnosis follows the same shape. Start from the symptom, find the PID, check the parent, inspect state, then choose the next tool. That habit keeps process management practical instead of turning it into a pile of commands to memorize.

### How Do `fork()` and `exec()` Create a Process?

Unix separates process creation into two ideas. `fork()` creates a child process based on the calling process. The child begins with inherited process state such as environment, current directory, open file descriptors, identity, and signal configuration. `exec()` then replaces the current process image with a new program while preserving selected process context such as the PID and already prepared descriptors.

This separation is useful to a shell. The shell can fork, arrange the child's standard input and output, change the child's environment or working directory, then exec the requested program. The parent shell remains available to wait, launch another command, or maintain interactive state. Redirection is therefore process setup performed before the new program runs.

Pipes use the same model. The shell creates a pipe with a read end and a write end, forks the commands, connects their file descriptors to the appropriate ends, closes unused copies, and execs the programs. The programs do not need to know who created the pipe; one writes standard output and the next reads standard input.

Some commands must remain shell builtins. If an ordinary child process performed `cd`, it would change only its own working directory and then exit; the parent shell would stay where it was. `export`, job control, and shell options similarly change state owned by the current shell. This is the same child-process boundary that makes sourcing a script different from executing it.

PIDs are temporary handles. After a process exits and its lifecycle record is collected, the kernel can reuse the number for a later process. A PID written into an old incident note is not a permanent service identity. Confirm start time, executable, command line, cgroup, and service ownership before signaling it.

### What Happens When a Process Exits?

A process returns an exit status and the kernel releases most of its resources. The parent still needs to collect the termination information with a wait operation. Until then, a small zombie entry remains so the parent can learn which child ended and how. A zombie is already dead: it has no ordinary program code left to kill and consumes no normal address space. Fix a growing zombie population by investigating why the parent does not reap its children.

If a parent exits before a child, the child becomes orphaned and is adopted by an appropriate subreaper, ultimately represented through the PID 1 responsibility in the process namespace. The child can continue running; parent-child ancestry describes creation and lifecycle collection, not an eternal control relationship.

Exit status is separate from standard output. A command can print useful text and fail, print nothing and succeed, or write errors to standard error while returning a nonzero code. Shells, service managers, and automation use the status as the machine-readable lifecycle result. Signals can also be reflected in the termination result so a supervisor can distinguish a clean exit from a forced end.

PID 1 must reap orphaned children and participate in system startup and shutdown. It also has special signal and namespace behavior. In a container, a program may see itself as PID 1 inside its PID namespace even though the host assigns another PID. That program inherits the reaping and signal-forwarding responsibilities within the namespace. A minimal wrapper that ignores them can leave zombies or fail to deliver termination to the real workload.

### What Do Process States Actually Mean?

`ps` state codes summarize what the kernel knows at the sample moment. `R` means running or runnable; it does not promise the task was literally executing on a CPU for the whole interval. `S` is interruptible sleep, common for a process waiting for a timer, socket, pipe, or event. `D` is uninterruptible sleep, often a wait in the kernel for I/O. `T` means stopped or traced. `Z` is a zombie awaiting collection.

A sleeping server is usually healthy. Event-driven services spend much of their time waiting for work. A process in `D` is not automatically broken either, but a long-lived or growing group of `D` tasks can reveal a stuck storage, network-filesystem, or device path. `SIGKILL` cannot end the task until the kernel wait reaches a point where termination can complete, so repeated `kill -9` does not repair the underlying I/O.

Processes and threads differ in what they share. Threads in one process share the address space and many resources while the kernel schedules each execution thread. Tools may show a process summary or individual task IDs. A multithreaded process can use several CPUs, and one blocked thread does not imply every thread is blocked. Use `ps -L`, `top -H`, or `/proc/PID/task` when the process-wide view hides the active thread.

The scheduler chooses among runnable tasks. A nice value changes relative preference under CPU contention; it is not a speed limit. CPU affinity restricts which logical CPUs may run a task, which can help specialized placement but can also create an artificial bottleneck. cgroup CPU controls express workload shares or quotas more directly than renicing one PID in a managed service.

### How Do File Descriptors Explain Hidden Process State?

A process's file-descriptor table connects small integers to open kernel objects. Descriptors `0`, `1`, and `2` conventionally represent standard input, output, and error. Other descriptors can name regular files, sockets, pipes, devices, directories, or event objects. The open reference belongs to the process, not to the pathname text used earlier.

Inspect it through `/proc`:

```bash
pid=1842
ls -l "/proc/$pid/fd"
readlink "/proc/$pid/exe"
readlink "/proc/$pid/cwd"
tr '\0' '\n' < "/proc/$pid/environ" | sed 's/=.*$/=<redacted>/'
```

`/proc/PID/exe` identifies the executable mapping and can differ from a shortened command name. `cwd` shows the current directory used for relative paths. `fd` reveals open files and sockets. The environment is sensitive process state; inspect it with privilege only when needed and avoid printing secret values into tickets or logs.

Deleting a pathname does not close a process's descriptor. The process can continue reading or writing the unlinked object, and its blocks remain allocated. `lsof +L1` connects a disk-full symptom to the owning process. Restarting or directing that process to reopen logs releases the old reference; creating another empty pathname does not.

Open descriptors also explain SSH jobs that behave oddly. A background program may still read from the terminal, write into a closed session, or receive a terminal-related signal. `nohup` changes SIGHUP handling and redirects output when appropriate, but it does not provide restart policy, boot activation, identity configuration, resource controls, or durable log ownership. Use `tmux` or `screen` for a human interactive session and a service manager for a real daemon.

### How Do Signals Form a Lifecycle Protocol?

Signals are asynchronous notifications. `SIGTERM` requests termination and can be caught so a program stops accepting work, closes resources, flushes state, and exits. `SIGINT` is commonly sent by `Ctrl+C` to the terminal foreground process group. `SIGTSTP`, commonly from `Ctrl+Z`, stops the group for job control rather than terminating it. `SIGHUP` historically reports terminal loss and is also used by some daemons as a reload convention.

`SIGKILL` and `SIGSTOP` cannot be caught or ignored. They are kernel enforcement mechanisms. `SIGKILL` gives the process no cleanup opportunity, so it can interrupt application-level writes, leave temporary state, or prevent a graceful handoff. Send TERM first, wait for the service's documented shutdown interval, inspect why it remains, and reserve KILL for an intentional last step.

Signal permission follows identity and privilege rules. An ordinary process generally cannot signal an unrelated process owned by another user. The command named `kill` does not imply termination; it sends the selected signal. Use `kill -TERM PID`, `kill -HUP PID`, or `kill -0 PID` to make the intent visible. Signal zero performs permission and existence checks without delivering a normal action signal.

Foreground and background are terminal relationships. The terminal has a foreground process group that receives interactive input and terminal-generated signals. A shell job can contain several processes in a pipeline, so a job number is not the same as one PID. Process groups let the shell signal the whole pipeline. Sessions group process groups and associate them with a controlling terminal.

A service manager extends the protocol. It knows the unit's cgroup, main process, child processes, expected exit codes, stop signal, timeout, and restart policy. `systemctl stop app.service` is normally safer than signaling a remembered PID because it applies the unit's declared lifecycle to the full managed workload. Killing one worker may only cause the supervisor to replace it.

### How Do Identity, Memory, and cgroups Change the View?

Processes carry real and effective user and group identities, supplementary groups, capabilities, namespaces, resource limits, environment, and security context. These values determine which files, processes, sockets, and privileged operations the process can access. “It works in my shell” may fail under a service because the service has a different identity, current directory, environment, limit, or sandbox.

Virtual memory means a process's address range is not the same as physical RAM. RSS counts resident pages, but shared pages may be counted for several processes. `/proc/PID/maps` lists mapped address ranges and their permissions; `smaps_rollup` aggregates resident, proportional, private, shared, anonymous, and swap data. A large virtual range alone does not prove a leak.

Process trees answer who created whom, but modern workload ownership can outlive or cross simple ancestry. A daemon can fork, reparent, or create many workers. cgroups answer which managed workload the kernel accounts together. Inspect a systemd service's cgroup with `systemctl status`, `systemd-cgls`, or `/proc/PID/cgroup` before treating one PID as the whole service.

Resource limits belong to the same process state. File-descriptor limits, memory limits, process counts, CPU controls, and affinity can make a program fail while the machine still has spare global capacity. Inspect `/proc/PID/limits` and the service definition. Raising a limit may remove a symptom, but first establish why the workload reached it.

### How Does an Unknown-Process Investigation Work?

Start with a snapshot that does not mutate anything:

```bash
pid=1842
ps -o pid,ppid,user,group,lstart,etime,stat,ni,psr,%cpu,%mem,rss,cmd -p "$pid"
readlink -f "/proc/$pid/exe"
readlink -f "/proc/$pid/cwd"
cat "/proc/$pid/cgroup"
sudo lsof -p "$pid" | head -50
```

Confirm whether the PID still describes the same process, who owns it, when it began, what executable is mapped, which service or container owns it, what state it is in, and what resources it holds. Then inspect the parent and children with `pstree -aps PID` or a forest view. Do not signal an unknown production process based only on a familiar command name.

If a process will not die, confirm the signal was permitted and delivered, inspect state, and check whether it is a service that restarts. A `D` state points to the waited-on kernel resource. A new PID after termination points to a supervisor. The same PID remaining after TERM may be performing graceful shutdown or ignoring the signal; compare logs and the declared timeout before escalating.

If a process returns after it is killed, find the owner above the PID: systemd, a container runtime, a process supervisor, or another parent. Stop or reconfigure the controller. Repeatedly killing the child fights the policy without changing it.

If an SSH job disappears, distinguish a human session from a service. For a one-off interactive job, use a persistent terminal multiplexer and reconnect. For scheduled or long-running production work, create a service or timer with explicit output, identity, restart, and resource policy.

If a process appears alive but the application is unhealthy, test the actual interface. A PID can exist while the service is deadlocked, not listening, returning errors, or still starting. Service status combines process lifecycle evidence; operational health requires the port, request, queue, or output the workload promises.

The complete lifecycle is inheritance, optional setup, program replacement, scheduling and waiting, communication through descriptors and signals, exit, kernel cleanup, parent notification, and supervision policy. Placing each symptom on that lifecycle makes process management predictable instead of treated as a mysterious PID.

### How Do Shell Jobs Build on Processes?

The shell maintains a job table for commands it launched from that interactive session. `jobs` lists that shell's jobs; `ps` lists kernel processes and knows nothing about shell job numbers. A pipeline such as `producer | consumer` is one shell job containing multiple processes, normally placed in one process group so terminal signals reach the group.

Appending `&` lets the shell continue without waiting in the foreground, but it does not detach every relationship. The job can retain the controlling terminal and open standard streams. `fg` places a job's process group back in the foreground, while `bg` continues a stopped job in the background. `disown` changes the shell's job tracking and HUP behavior; details depend on the shell and still do not create service supervision.

Sessions organize process groups and a controlling terminal. SSH creates a remote session boundary. When the connection disappears, descriptors close and terminal/session signals may reach jobs. Programs react differently depending on their signal handlers and I/O. Redirecting output and using `nohup` can preserve a one-off noninteractive task, but only a declared service provides boot activation, stable logs, ownership, restart policy, and resource accounting.

### Why Can a Process Be Alive but Make No Progress?

Process existence proves only that the kernel still tracks it. A runnable task may receive little CPU under contention. A sleeping task may correctly await input. A task can block on a lock, socket, pipe, filesystem, page fault, or device. A multithreaded service can have one deadlocked path while health checks still run on another thread.

Sample state and wait information over time rather than labeling one snapshot. `ps -o pid,stat,wchan:32,cmd -p PID` can show a kernel wait channel where available. `strace -p PID` can reveal repeated or blocked syscalls, but attaching changes observation conditions, requires permission, can add overhead, and may expose sensitive data. Use it deliberately after ordinary evidence narrows the process.

Open network sockets add another view:

```bash
ss -ntp
ss -lntp
sudo lsof -Pan -p 1842 -i
```

A listener proves a socket is bound, not that the application can complete a request. An established connection can be waiting on the peer or application protocol. Combine socket state with request logs, timeouts, thread state, and downstream evidence.

### How Do Automatic Restart and PID Reuse Mislead Operators?

Suppose PID `1842` is consuming CPU. By the time an operator runs `kill 1842`, that process may have exited and the number may identify a different process. Confirm the current start time, executable, user, and cgroup immediately before mutation. Prefer a stable unit or container identity when the workload is managed.

If systemd has `Restart=on-failure`, terminating the main process may produce a new PID by design. A container orchestrator may replace the container, and an application master may replace a worker. The return is not evidence that `kill` failed. It is evidence that a controller observed an undesired state and restored its policy.

Trace from child to controller:

```bash
pstree -aps 1842
cat /proc/1842/cgroup
systemctl status app.service --no-pager
systemctl show app.service -p MainPID -p Restart -p NRestarts
```

Then decide whether to stop the controller, change restart policy, fix the underlying failure, or leave recovery working. Fighting individual PIDs can turn a manageable service incident into a restart storm.

### How Do Namespaces Change What a PID Means?

PID namespaces allow the same process to have different IDs as seen from a container and the host. A process can be PID 1 inside its namespace and PID `29104` outside. Commands executed in the container see the inner process tree; host tools see the outer one. Logs and alerts should include container or cgroup identity so a PID is not interpreted in the wrong namespace.

Other namespaces change mounts, network interfaces, hostnames, users, and IPC views. `/proc` is mounted for the observing namespace, so “all processes” can mean all visible processes in that boundary. When an expected PID, socket, or file is missing, confirm whether the command runs on the host, inside the correct container, or in another namespace.

User namespaces can map numeric identities. A container process appearing as root inside may map to an unprivileged host UID. Signal and file permissions follow the relevant kernel identity mapping, not the printed name alone. Use the runtime and host ownership evidence before changing permission or privilege.

### How Do Process Resources Interact?

A CPU-bound process remains runnable and accumulates CPU time. An I/O-bound process alternates brief CPU work with waits. A process under memory pressure can spend CPU handling faults and reclaim while also waiting on storage for swap or file data. Classifying one process requires state over time, not its command name.

Priority affects CPU scheduling only within its policy and contention. It does not directly prioritize disk I/O, network traffic, locks, or memory. I/O priority and cgroup controls exist, but begin by identifying the constrained resource and owner. Tuning the wrong scheduler can make the graph change without improving the application.

CPU affinity can be inspected with `taskset -pc PID`. It may be inherited from a parent or manager and can explain why one CPU saturates. Changing affinity without understanding cache locality, interrupts, NUMA, and workload design can shift rather than remove contention.

Memory limits and OOM behavior can be scoped to a cgroup. A service may be killed at its unit boundary even while the host has memory available. Conversely, one unbounded workload can force machine-wide OOM selection. Connect `/proc` process memory, cgroup resource files, service controls, and kernel messages before calling the largest RSS value the cause.

### What Does a Careful Stop Procedure Look Like?

Identify the workload owner and user-facing impact. For a managed service, inspect status and recent logs, then use the manager's stop or restart command so declared signals, timeouts, and the cgroup apply. For an unmanaged process, send `SIGTERM`, observe whether it begins cleanup, and wait for a bounded interval based on its contract.

If it remains, collect state, children, descriptors, wait channel, and logs. Decide whether the process is making slow graceful progress, blocked in an interruptible wait, stuck in uninterruptible I/O, or ignoring the signal. Send `SIGKILL` only when forced termination and its cleanup consequences are accepted. Verify that every relevant process ended and that no supervisor restored it unexpectedly.

Afterward, check exit result, service state, sockets, temporary or lock files, open deleted files, and application health. A forced process end can release kernel resources while leaving application-level work incomplete. Recovery must follow the owning application's consistency procedure.

### Which Mistakes Does the Process Model Prevent?

Do not equate a program file with a running instance; several instances may map the same executable. Do not equate a command name with identity; it can be shortened, changed, or reused. Do not treat a PID as permanent. Do not kill a zombie. Do not assume `D` state yields to KILL immediately. Do not use `nohup` as a full service manager.

Do not sum process RSS as exact machine memory without accounting for shared pages. Do not treat nice as a CPU limit. Do not assume a parent always controls the child after creation. Do not stop one service worker when the unit owns a cgroup. Do not inspect secret-bearing environment or command lines without protecting the output.

The practical command map follows the unknown: `pgrep` locates candidates, `ps` describes a snapshot, `pstree` shows ancestry, `top` samples change, `ss` maps sockets, `lsof` maps descriptors, `/proc` exposes kernel state, `systemctl` identifies unit ownership, and logs explain lifecycle results. Each command provides evidence for one part of the model rather than a universal answer.

### What Can `/proc` Reveal Without a Specialized Agent?

`/proc/PID/status` summarizes identity, state, threads, memory, capabilities, and namespace identifiers. `stat` provides machine-oriented process fields. `cmdline` stores null-delimited arguments, while `comm` stores a shorter task name. `exe`, `cwd`, `root`, and `fd` are symbolic links into live process state. `maps` shows address mappings, `io` shows attributed I/O counters, `limits` shows inherited resource limits, and `cgroup` shows workload membership.

These files can change while being read because the process is live. It may exit between the directory listing and the next open, or a counter may advance. Permissions intentionally restrict sensitive information. Treat `/proc` as a point-in-time kernel interface, not a consistent historical database.

```bash
pid=1842
grep -E '^(Name|State|Pid|PPid|Uid|Gid|Threads|VmRSS|voluntary_ctxt_switches)' "/proc/$pid/status"
tr '\0' ' ' < "/proc/$pid/cmdline"; printf '\n'
cat "/proc/$pid/limits"
cat "/proc/$pid/io"
```

Command-line arguments and environment values can contain credentials. Collect only the fields needed for the incident and redact outputs before sharing. Process observability is also a security boundary.

### How Does Exit Become Service Evidence?

When the main service process exits, systemd receives the same fundamental termination information a parent receives: exit code or terminating signal. It combines that result with unit policy. A clean status can transition a oneshot job to success; an unexpected code can set `failed`; a matching restart rule can create a new process.

This means process and service logs should share a timeline. The application may print its last domain error, the manager records the exit result, the kernel may record an OOM kill, and a proxy may record user-visible failure. Correlating those events explains why the process disappeared and why it did or did not return.

`systemctl status` reporting a PID is not the same as health. The manager can know that the expected process tree exists and still have no knowledge of a deadlocked request handler. Likewise, a service can be intentionally inactive after successful bounded work. Interpret status through the declared unit type and application contract.

### How Do Servers Use Multiple Processes or Threads?

A prefork server can create worker processes so failures and address spaces are isolated and multiple CPUs serve work. A threaded server shares one address space across worker threads, reducing some communication cost while requiring synchronization. An event-driven server may use a small thread set to coordinate many sockets. None is universally superior; the model explains the process tree, CPU distribution, memory accounting, and signal behavior you observe.

A master process can receive reload, start new workers with new configuration, and allow old workers to drain. Killing one worker may be routine and lead to replacement. Killing the master may trigger a broader outage or supervisor restart. Identify roles from the service documentation, command line, tree, sockets, and logs before signaling a member.

Shared memory and libraries complicate per-process memory totals. Threads complicate process-wide CPU percentages. Worker recycling can look like PID churn while the service remains healthy. The operational unit may be the cgroup, deployment, or service rather than one process row.

### What Does the Full Process Lifecycle Look Like in Practice?

An interactive shell parses a command, creates pipes or redirections, forks, adjusts the child's descriptors and environment, and execs the program. The kernel schedules its threads. The program allocates virtual memory, opens files and sockets, communicates, sleeps while awaiting events, and receives signals. Its cgroup and identities constrain resources and authority.

The program ends by returning, calling an exit operation, or receiving a terminating signal. The kernel closes descriptors and releases mappings, preserves the termination record, and notifies the parent. The parent waits and obtains the status. If a service manager owns the workload, it updates unit state and may restart according to policy.

Every common incident fits a transition: creation failed, the wrong state was inherited, exec named the wrong file, scheduling is contended, a descriptor or dependency is blocked, a signal was mishandled, cleanup is incomplete, the parent did not reap, or a supervisor restored the process. Naming that transition produces a smaller and safer investigation.

### How Should a Process Investigation Be Recorded?

Record host or container, namespace, timestamp, PID, start time, executable, command line, user and group, parent, service or cgroup, state, CPU, memory, descriptors of interest, sockets, and relevant logs. Start time and workload identity protect against PID reuse. The namespace protects against comparing an inner PID with an unrelated host PID.

For a changing problem, repeat the same snapshot. CPU percentage requires an interval, memory leaks require a trend, wait states can alternate, and a supervisor can replace the process. A small series with consistent fields is usually more useful than one enormous unstructured dump.

Preserve mutation boundaries. Note which signal was sent, by whom, at what time, which result followed, and whether a controller restarted the workload. If KILL was required, record why graceful termination could not complete and which consistency checks followed. This turns an emergency command into evidence for repairing the lifecycle.

Finally, separate immediate availability from permanent correction. Restarting a leaked service can restore users; it does not locate retained allocations. Stopping a backup can clear CPU contention; it does not establish a safe future schedule. Releasing an open deleted file clears blocks; rotation still needs a correct reopen path. Process management solves the live transition and hands the mechanism to the owning system for repair.

The same discipline applies to unknown high CPU. Rank processes, confirm the instance and workload, inspect whether one thread or many are active, compare runnable pressure with CPU count, and correlate the start time with traffic, deployment, or scheduled work. A profiler can then explain where the process spends CPU. Renicing or killing first can change the symptom before establishing whether the work is necessary, malicious, stuck, or simply underprovisioned.

For unknown memory, distinguish virtual reservation, resident pages, proportional share, anonymous memory, mappings, and cgroup totals. Compare several samples. A process with large stable RSS may be expected; many workers can create the real total; a rising anonymous baseline can suggest retained allocations. The kernel and service manager provide the machine-level consequences, while the runtime profiler explains objects and ownership inside the program.

Process management is therefore observation plus lifecycle authority. Observation establishes the live instance and mechanism. Authority determines whether the shell, user, service manager, container runtime, or kernel owns the next action. Acting through the correct owner keeps cleanup, restart, logs, limits, and future desired state consistent.

The kernel's process view and the application's work view should meet in a request, job, or queue identifier. A busy PID explains where resources go; application evidence explains which useful or faulty work created that demand. Both are needed before a permanent fix is selected.

Inspect process ownership before attaching debuggers or reading descriptors because observation can expose user data and credentials. Use the least privilege required, preserve only relevant evidence, and avoid leaving tracing enabled after the bounded diagnostic window.

When the process is part of a horizontally scaled workload, compare peers. One abnormal instance suggests local state, traffic skew, or a stuck path; every peer changing together suggests shared input, release, or dependency. The comparison narrows the mechanism without treating replacement as explanation.

Compare the same process role across peers, because a master, worker, scheduler, and sidecar can have intentionally different CPU, memory, socket, and lifecycle patterns. Role-aware evidence prevents a healthy coordinator from being judged against a busy request worker.

Record the deployed version too, because two identical command lines can execute different binaries or application code after a rollout.

Confirm the executable mapping and release symlink rather than trusting the visible name alone.

Include the precise observation timestamp so a later reviewer can align the instance with logs, metrics, deployments, and supervisor events.

## Check Your Answers

:::expand[What Is a Linux Process?]{kind="recap"}
A process is a live program instance with kernel-tracked identity, memory, descriptors, environment, directory, scheduling state, and lifecycle.
:::

:::expand[How Do Process Creation, PIDs, Parents, and Exit Status Fit Together?]{kind="recap"}
Fork inherits process state, exec replaces the program, PIDs identify live instances, and wait collects a child's result.
:::

:::expand[Why Are PID 1 and Service Managers Special?]{kind="recap"}
PID 1 anchors userspace and reaping, while a service manager applies declared lifecycle policy to whole workloads.
:::

:::expand[How Do You Inspect Processes, Threads, and States?]{kind="recap"}
Use snapshots and repeated samples to connect identity, command, ancestry, threads, scheduler state, time, and resource use.
:::

:::expand[How Do Signals Control a Process Lifecycle?]{kind="recap"}
Signals request stop, interrupt, continue, reload, or forced action; graceful TERM should normally precede uncatchable KILL.
:::

:::expand[How Do Terminals, Jobs, Sessions, and SSH Affect Lifetime?]{kind="recap"}
Terminal foreground groups, jobs, sessions, descriptors, and SIGHUP explain why a shell background command is not a service.
:::

:::expand[How Do Identity, `/proc`, Priority, and cgroups Describe Resources?]{kind="recap"}
Kernel and cgroup views reveal effective identity, mappings, open resources, limits, scheduling preference, and workload ownership.
:::

:::expand[How Do You Diagnose a Process That Exits, Hangs, or Returns?]{kind="recap"}
Verify the instance, parent, state, descriptors, cgroup, logs, and supervisor before choosing a lifecycle action.
:::

![Process management summary infographic showing processes, PID trees, systemd, ps, signals, background jobs, nice values, proc, and diagnosis](/content-assets/articles/article-devops-foundation-linux-system-admin-process-management/process-management-summary.png)

_The summary image collects the process-management checks into one incident review map._

## References

- [Linux `ps(1)` manual](https://man7.org/linux/man-pages/man1/ps.1.html) - Documents process snapshot output and state codes.
- [Linux `pgrep(1)` manual](https://man7.org/linux/man-pages/man1/pgrep.1.html) - Documents process matching by name, user, and command line.
- [Linux `top(1)` manual](https://man7.org/linux/man-pages/man1/top.1.html) - Documents live process monitoring.
- [Linux `signal(7)` manual](https://man7.org/linux/man-pages/man7/signal.7.html) - Documents standard signals and their behavior.
- [Linux `proc(5)` manual](https://man7.org/linux/man-pages/man5/proc.5.html) - Documents `/proc` process and kernel interfaces.
- [systemd service manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) - Documents service process lifecycle behavior under systemd.
