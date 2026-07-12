---
title: "Process Management"
description: "Inspect, signal, and supervise running processes on Linux, and diagnose what happens when they refuse to die."
overview: "Learn how Linux runs programs as processes, then inspect, signal, prioritize, and troubleshoot live processes during operations work."
tags: ["processes", "ps", "signals", "top"]
order: 1
id: article-devops-foundation-linux-system-admin-process-management
---

## Table of Contents

1. [From Terminal Commands to Processes](#from-terminal-commands-to-processes)
2. [PID and PPID Badges](#pid-and-ppid-badges)
3. [The Process Tree and Exit Status](#the-process-tree-and-exit-status)
4. [PID 1 and Services Started by systemd](#pid-1-and-services-started-by-systemd)
5. [Ask Linux What Is Running](#ask-linux-what-is-running)
6. [Signals: Polite Messages Before Hard Stops](#signals-polite-messages-before-hard-stops)
7. [Foreground, Background, and SSH Sessions](#foreground-background-and-ssh-sessions)
8. [Priority, Nice Values, and `/proc`](#priority-nice-values-and-proc)
9. [Worked Failure Diagnoses](#worked-failure-diagnoses)
10. [References](#references)

## From Terminal Commands to Processes
<!-- section-summary: Every command, shell, server, and background task is a running program that Linux tracks as a process. -->

You have already started processes if you have opened Terminal, connected to a server with SSH, run `nano`, launched `curl`, or started a Node app. The command may feel like one small line of text, but Linux has to run something real behind that line. While that thing is running, Linux tracks it as a **process**.

A process is one running copy of a program. The file `/usr/bin/curl` can sit on disk all day doing nothing. When you type `curl https://example.com`, Linux starts a live copy of that program, gives it memory, connects it to your terminal, lets it open network connections, and tracks it until it exits.

The same program can have many running copies at the same time. Two people can run `nano` in two SSH sessions. A web server can have several worker processes handling requests. Each copy gets its own process identity, its own memory, and its own live state.

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

## PID and PPID Badges
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

## The Process Tree and Exit Status
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

## PID 1 and Services Started by systemd
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

## Ask Linux What Is Running
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

## Signals: Polite Messages Before Hard Stops
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

## Foreground, Background, and SSH Sessions
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

## Priority, Nice Values, and `/proc`
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

## Worked Failure Diagnoses
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

![Process management summary infographic showing processes, PID trees, systemd, ps, signals, background jobs, nice values, proc, and diagnosis](/content-assets/articles/article-devops-foundation-linux-system-admin-process-management/process-management-summary.png)

_The summary image collects the process-management checks into one incident review map._

## References

- [Linux `ps(1)` manual](https://man7.org/linux/man-pages/man1/ps.1.html) - Documents process snapshot output and state codes.
- [Linux `pgrep(1)` manual](https://man7.org/linux/man-pages/man1/pgrep.1.html) - Documents process matching by name, user, and command line.
- [Linux `top(1)` manual](https://man7.org/linux/man-pages/man1/top.1.html) - Documents live process monitoring.
- [Linux `signal(7)` manual](https://man7.org/linux/man-pages/man7/signal.7.html) - Documents standard signals and their behavior.
- [Linux `proc(5)` manual](https://man7.org/linux/man-pages/man5/proc.5.html) - Documents `/proc` process and kernel interfaces.
- [systemd service manual](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) - Documents service process lifecycle behavior under systemd.
