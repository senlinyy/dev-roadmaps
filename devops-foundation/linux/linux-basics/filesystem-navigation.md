---
title: "Filesystem & Navigation"
description: "Navigate the Linux filesystem hierarchy, understand mount points, and manage files and directories from the command line."
overview: "Learn how the Linux filesystem organizes directories, configs, logs, programs, user homes, virtual kernel views, and mounted storage."
tags: ["FHS", "cd", "ls", "find"]
order: 1
id: article-devops-foundation-linux-linux-basics-filesystem-navigation
---

## Table of Contents

1. [What the Linux Filesystem Is](#what-the-linux-filesystem-is)
2. [One Tree Under the Root Directory](#one-tree-under-the-root-directory)
3. [Find Your Place with `pwd`](#find-your-place-with-pwd)
4. [Look Around with `ls`](#look-around-with-ls)
5. [Move with `cd` and Path Names](#move-with-cd-and-path-names)
6. [Where Linux Puts Important Things](#where-linux-puts-important-things)
7. [Virtual Filesystems: Live Views from the Kernel](#virtual-filesystems-live-views-from-the-kernel)
8. [Find Files When You Do Not Know the Path](#find-files-when-you-do-not-know-the-path)
9. [Disk Space, Inodes, and Mount Points](#disk-space-inodes-and-mount-points)
10. [References](#references)

## What the Linux Filesystem Is
<!-- section-summary: The Linux filesystem is one directory tree that gives every file, program, log, device, and mounted disk a path. -->

You usually meet the Linux filesystem through a clue from a real server. Nginx says it cannot read `/etc/nginx/nginx.conf`, a deploy script complains about `/srv/web/current`, or a log message points at `/var/log/nginx/error.log`. The server is handing you a path and asking whether you know how to follow it.

The **Linux filesystem** is the way Linux names and organizes files, directories, programs, logs, devices, and mounted storage. Every item receives a path.

A path is a location written as text. `/etc/nginx/nginx.conf` points to a configuration file. `/var/log/nginx/access.log` points to a log file. `/srv/web` often points to application files served by the machine.

That is the beginner version of filesystem work: turn a path in an error message into a real place you can inspect. Before you edit Nginx, restart a service, clean up a full disk, or check a mounted volume, you need to answer a few small questions: where am I, what is nearby, where does Linux usually keep this kind of file, and which path should I inspect next?

The path through the topic matches the order you would use during an SSH session. The root tree comes first, then `pwd`, `ls`, and `cd` for orientation, then standard directories, virtual filesystems, search commands, and disk tools after the first few commands are not enough.

## One Tree Under the Root Directory
<!-- section-summary: Files, directories, devices, and mounted storage share one tree rooted at `/`. -->

A deploy fails because it cannot open `/srv/web/current/config.yml`, then the Nginx log points at `/var/log/nginx/error.log`. Those paths look unrelated at first, yet Linux wants you to walk them from the same starting point. The top of that shared tree is the **root directory**, written as `/`. Every normal file, directory, device path, and mounted disk appears somewhere under `/`.

The root directory gives every program one naming system. A process does not need to know which physical disk, cloud volume, container layer, or network filesystem holds a file before it asks for `/etc/nginx/nginx.conf`. It asks the kernel for that path, and the kernel walks the tree one directory name at a time.

You can ask Linux to list the top level of that tree:

```bash
ls /

# Example output:
# bin   boot  dev  etc  home  lib  proc  root  run  srv  tmp  usr  var
```

Each name is a directory under `/`.

- `/etc` holds system configuration.
- `/home` holds normal user home directories.
- `/var` holds data that changes while the system runs, such as logs and caches.
- `/srv` is often used for data served by the machine.
- `/proc`, `/dev`, and `/sys` expose live kernel, process, and device information.

This layout is different from Windows drive letters such as `C:\` and `D:\`. On Linux, an extra disk or cloud volume gets attached at a directory path inside the same tree. The operating system may live on one disk, while a larger data volume may be mounted at `/var/lib/app-data`. Both still appear as ordinary paths.

A **directory** is a container that maps names to files and other directories. A **file** is content stored under one of those names. A **path** is the route to a file or directory. The path `/srv/web/current` means: go to `/`, enter `srv`, enter `web`, then reach `current`.

In production, this one-tree design explains a common surprise. An application may write uploads to `/var/lib/app-data/uploads`, and that path may live on a separate data disk. If the disk is missing after reboot, Linux may still show the directory name from the root disk. The next decision is to check the mount before blaming the application.

![Linux filesystem tree infographic showing the root directory branching to home, etc, var log, proc, dev, and mnt](/content-assets/articles/article-devops-foundation-linux-linux-basics-filesystem-navigation/one-linux-tree.png)

_The image turns the single Linux tree into a map, so common paths feel connected instead of memorized one by one._

## Find Your Place with `pwd`
<!-- section-summary: `pwd` prints the current working directory, which is the place relative paths start from. -->

After you know every path starts under `/`, the next question is where your shell is standing right now. Picture an SSH session where a cleanup command is sitting in your terminal history. Before running anything that removes, copies, or edits files, you need to know which directory the shell is using.

Your shell always has a current directory. This is also called the **working directory**. When you run a command with a relative path, Linux resolves that path from your current directory.

Use `pwd` when you want to know where the shell is standing:

```bash
pwd

# Example output:
# /home/deploy
```

This output says the current directory is `/home/deploy`.

- The first `/` is the root directory.
- `home` is a directory under `/`.
- `deploy` is a user home directory under `/home`.

This one command prevents many mistakes. If you plan to remove old build files or copy a release archive, check `pwd` first. A command that is safe in `/srv/web/releases` may be dangerous in `/`.

## Look Around with `ls`
<!-- section-summary: `ls` lists files and directories, and long output adds permissions, ownership, size, and timestamps. -->

Once `pwd` tells you where the shell is standing, you need to see what is around you. The `ls` command lists the contents of a directory, so it is usually the next command after `pwd`.

```bash
ls

# Example output:
# releases  scripts
```

This means the current directory contains two entries named `releases` and `scripts`. The plain output is useful for a quick glance, but server work often needs more detail.

Add `-l` for a long listing:

```bash
ls -l

# Example output:
# total 8
# drwxr-xr-x 4 deploy web 4096 Jun 24 09:10 releases
# drwxr-xr-x 2 deploy web 4096 Jun 24 09:10 scripts
```

The long listing adds operational clues.

- The first column shows file type and permissions. A leading `d` means directory.
- The `deploy` column is the owning user.
- The `web` column is the owning group.
- The size and timestamp help you notice recent changes.

Hidden files begin with a dot. Use `-a` to include them, and `-h` to show human-readable sizes:

```bash
ls -lah /srv/web

# Example output:
# total 32K
# drwxr-xr-x  6 deploy web   4.0K Jun 24 09:10 .
# drwxr-xr-x  4 root   root  4.0K Jun 10 12:02 ..
# -rw-r--r--  1 deploy web    612 Jun 24 09:10 package.json
# drwxr-xr-x  3 deploy web   4.0K Jun 24 09:10 src
# drwxr-xr-x  2 deploy web   4.0K Jun 24 09:10 scripts
```

Notice the two special entries at the top. `.` means the current directory. `..` means the parent directory. The first character on each long listing line tells you the file type: `-` marks a regular file, and `d` marks a directory.

Many operators type `ls -lah` by habit because it shows enough detail to catch ownership, permission, and timestamp problems quickly. In the output above, application files belong to `deploy:web`, while the parent directory belongs to `root:root`. That kind of detail often explains why one user can edit a file and another cannot.

## Move with `cd` and Path Names
<!-- section-summary: `cd` changes the shell's current directory, and path style decides where Linux starts resolving the name. -->

After listing the current directory, you usually want to move closer to the file from the error message. The shell always has a current directory. Commands such as `ls`, `cat`, `cp`, and `rm` use that location as their starting point whenever a path is not written from `/`. Changing directory moves the shell's attention to the part of the filesystem you are working on.

Use `cd` to change that current directory. A simple move to an application directory looks like this:

```bash
cd /srv/web
```

`cd` normally prints no output when it succeeds. Confirm the move with `pwd`:

```bash
pwd

# Example output:
# /srv/web
```

Now relative paths begin from `/srv/web`. If you run `ls scripts`, Linux looks for `/srv/web/scripts`.

There are two path styles to learn early:

| Path style | Example | Meaning |
|---|---|---|
| Absolute path | `/etc/nginx/nginx.conf` | Starts from `/` every time |
| Relative path | `scripts/deploy.sh` | Starts from the current directory |

An **absolute path** is useful when a script or runbook must work from any current directory. A **relative path** is useful inside a known project directory because the command stays shorter and easier to read. Linux resolves both paths by walking directory entries. The difference is only the starting point: `/` for absolute paths, and the shell's current directory for relative paths.

Try one absolute path:

```bash
ls /etc/nginx

# Example output:
# conf.d  nginx.conf  sites-available  sites-enabled
```

Try one relative path from `/srv/web`:

```bash
ls scripts

# Example output:
# deploy.sh  healthcheck.sh
```

A few shortcuts save time:

```bash
cd ~
```

`~` means your home directory. For the `deploy` user, that is often `/home/deploy`.

```bash
cd -

# Example output:
# /srv/web
```

`cd -` jumps back to the previous directory and prints the path it returned to.

One small implementation detail explains why `cd` is special. `cd` is a shell builtin because it must change the directory of your current shell. If it ran as a separate program, that separate process would change its own directory, exit, and leave your shell in the same place.

The production symptom is simple: a deploy command works from `/srv/web` and fails from `/home/deploy` with "No such file or directory." That usually means the command used a relative path and the operator ran it from a different directory. The next decision is whether the runbook should `cd` into a known directory first or use absolute paths for important files.

## Where Linux Puts Important Things
<!-- section-summary: The Filesystem Hierarchy Standard gives common locations for configuration, logs, programs, service data, and user files. -->

After `pwd`, `ls`, and `cd` feel familiar, you still need a first guess. During a real debug session, the question is usually practical: where would this server keep the Nginx config, where would it write the error log, and where did the application code land after deploy?

Linux answers that question with a mostly shared directory layout. Configuration usually sits in one part of the tree, logs in another, installed commands in another, and application data in another. The **Filesystem Hierarchy Standard**, often shortened to FHS, gives those common directories a common purpose. Ubuntu, Debian, Fedora, and Red Hat style servers can differ in details, but the broad layout stays familiar.

Here are the paths beginners should learn first:

| Path | What it usually holds | Example |
|---|---|---|
| `/etc` | System-wide configuration | `/etc/nginx/nginx.conf`, `/etc/systemd/system/app.service` |
| `/var` | Data that changes while the system runs | `/var/log/nginx/access.log`, package caches |
| `/srv` | Data served by this machine | `/srv/web` application code |
| `/home` | Normal user home directories | `/home/deploy/.ssh/authorized_keys` |
| `/root` | Root user's home directory | Emergency admin shell files |
| `/usr/bin` | Installed user commands | `curl`, `journalctl`, `systemctl` |
| `/usr/local` | Locally installed software outside the OS package manager | Team helper scripts |
| `/tmp` | Short-lived temporary files | Scratch files that may disappear after reboot |
| `/run` | Runtime files created after boot | PID files and sockets |

Use the purpose of the directory to choose your first place to inspect. If Nginx is returning an error, configuration probably lives under `/etc/nginx`, logs probably live under `/var/log/nginx`, and the application files may live under `/srv/web`.

You can inspect those paths one by one:

```bash
ls /etc/nginx

# Example output:
# conf.d  nginx.conf  sites-available  sites-enabled
```

```bash
ls /var/log/nginx

# Example output:
# access.log  error.log
```

These outputs teach a useful habit. Let the filesystem guide you. You do not need to memorize every file name on day one. Learn the main directory purposes, list the directory, then follow the names.

## Virtual Filesystems: Live Views from the Kernel
<!-- section-summary: Directories such as `/proc`, `/sys`, and `/dev` expose live kernel and device information through file-like paths. -->

Sometimes the normal paths do not answer the question. The config file looks right, the log file is quiet, and the service still misbehaves. At that point, you need to look at state that changes while the machine is running: which process is active, how busy the CPU queue is, how much memory is still available, and which devices the kernel sees.

Directories such as `/proc`, `/sys`, and `/dev` look like ordinary paths, but Linux creates their contents from live kernel information. These are **virtual filesystems**. They let tools and humans inspect processes, devices, memory, disks, and runtime state with the same commands used for normal files.

The first important difference is saved content versus live state. A file under `/etc/nginx` is saved configuration on disk. A file under `/proc` is usually a live report from the kernel. When you read `/proc/meminfo`, the kernel formats current memory information as text at that moment. A few seconds later, the numbers may change.

The easiest place to see the idea is `/proc`. It contains one directory for the kernel itself and one directory for each running process. A process is a running program. A **process ID**, often shortened to PID, is the number Linux uses to track that running program.

Use `pgrep -a` to find a running process:

```bash
pgrep -a node

# Example output:
# 1842 node /srv/web/server.js
```

The number `1842` is the process ID, or PID. Linux exposes information for that process under `/proc/1842`.

That PID gives you a path you can inspect. The process directory is a live kernel view of one running program:

```bash
ls /proc/1842

# Example output:
# cmdline  cwd  environ  exe  fd  limits  status
```

Those names are clues:

- `cmdline` shows the command and arguments used to launch the process.
- `cwd` points to the process working directory.
- `fd` lists open file descriptors, which can help explain open logs, sockets, and deleted files still held by a process.
- `status` gives a readable summary of process state, memory, user IDs, and signals.

Now inspect the command line recorded for that process:

```bash
tr '\0' ' ' < /proc/1842/cmdline

# Example output:
# node /srv/web/server.js
```

The `cmdline` file separates arguments with null bytes. A null byte is a zero-value separator that does not print as a normal character. The `tr '\0' ' '` part turns those separators into spaces so your terminal can show the command clearly. If a process was launched with many flags, this output helps you confirm which config file, port, or runtime option it is actually using.

After you can inspect one process, the next useful question is whether the whole machine is busy. `/proc/loadavg` gives a compact CPU queue signal:

```bash
cat /proc/loadavg

# Example output:
# 0.18 0.22 0.20 1/281 1842
```

Plain-English reading of this output:

- `0.18`, `0.22`, and `0.20` are the average load over roughly the last 1, 5, and 15 minutes.
- Load is the number of tasks running or waiting for CPU or certain disk operations. Treat it as a pressure signal rather than a percentage.
- `1/281` means 1 task is runnable right now out of 281 total tasks known to the scheduler.
- `1842` is the most recent PID created when this file was read.

Load needs context from CPU count. On a one-CPU machine, a load near `1.00` means the CPU is busy. On a four-CPU machine, a load near `1.00` is usually light. If the 1-minute number is much higher than the 15-minute number, the pressure is recent. If all three numbers stay high, the machine has been busy for longer.

Memory is another common reason a service behaves strangely. `/proc/meminfo` shows many memory counters. The first few lines are enough for a beginner check:

```bash
head -5 /proc/meminfo

# Example output:
# MemTotal:        4044104 kB
# MemFree:          812340 kB
# MemAvailable:    2219812 kB
# Buffers:          102840 kB
# Cached:          1249088 kB
```

Plain-English reading of this output:

- `MemTotal` is the installed memory Linux can use.
- `MemFree` is memory doing nothing right now. This number can look low on a healthy Linux server because Linux uses spare memory for cache.
- `MemAvailable` is the more useful beginner number. It estimates how much memory programs can still use without heavy swapping.
- `Buffers` and `Cached` are memory Linux uses to speed up filesystem work. The kernel can often reclaim much of this when applications need memory.

For a quick health check, look at `MemAvailable` before panicking over `MemFree`. In the example, the server has about 4 GB total and about 2.2 GB available, so memory does not look tight from this small sample.

Monitoring tools inspect these files constantly. You can inspect them too when a dashboard is missing or a server is too limited for a full toolchain. Your practical goal is to know that live kernel state has paths, and those paths can answer questions during an SSH session.

`/dev` exposes devices and special endpoints. `/dev/null` discards anything written to it, which explains command patterns like `2>/dev/null` for hiding error output. Disk devices such as `/dev/sda` or `/dev/nvme0n1` also appear there. Treat disk device paths carefully because they represent real storage.

`/sys` exposes hardware and driver state. Most beginners only read from it. It is useful because it shows how Linux represents hardware through paths.

The practical next decision is to ask whether a path is saved content or a live view. Editing files under `/etc` changes saved configuration. Reading files under `/proc` usually inspects live state. Writing to some virtual filesystem paths can change kernel or device behavior, so inspect first and change only with trusted instructions.

![Mount point overlay infographic showing how a mounted filesystem covers a directory path while the root tree keeps one namespace](/content-assets/articles/article-devops-foundation-linux-linux-basics-filesystem-navigation/mount-point-overlay.png)

_The image shows why a mount point can look like an ordinary folder while actually leading to another filesystem._

## Find Files When You Do Not Know the Path
<!-- section-summary: `find`, `locate`, and `tree` help you discover files when memory or documentation is incomplete. -->

Even after you learn the standard directories, a real server will still surprise you. A deploy script may live in `/opt`, a backup may sit under `/var/backups`, or a team helper may be installed under `/usr/local/bin`. Search commands help when the path is unknown and your memory is not enough.

`find` walks the live filesystem and matches paths by name, type, size, time, owner, permission, and many other attributes. Look for Nginx config files first:

```bash
find /etc/nginx -type f -name "*.conf"

# Example output:
# /etc/nginx/nginx.conf
# /etc/nginx/conf.d/gzip.conf
# /etc/nginx/sites-available/web.conf
```

The command reads as: walk `/etc/nginx`, match regular files, and keep names ending in `.conf`.

Search for executable shell scripts under an application directory:

```bash
find /srv/web -type f -name "*.sh" -perm -u+x

# Example output:
# /srv/web/scripts/deploy.sh
# /srv/web/scripts/healthcheck.sh
```

The important pieces are small:

- `-type f` limits matches to regular files.
- `-name "*.sh"` matches file names ending in `.sh`.
- `-perm -u+x` keeps files where the owner execute bit is set.

Search for large log files:

```bash
find /var/log -type f -size +100M

# Example output:
# /var/log/nginx/access.log.1
# /var/log/journal/4b3b0c/system.journal
```

Search for files changed in the last day:

```bash
find /srv/web -type f -mtime -1

# Example output:
# /srv/web/current/package.json
# /srv/web/current/src/server.js
# /srv/web/scripts/deploy.sh
```

`locate` is different. It searches a prebuilt database, so it is fast. The tradeoff is freshness. Very new files may not appear until the database refreshes.

```bash
locate app.service

# Example output:
# /etc/systemd/system/app.service
# /home/deploy/notes/app.service.example
```

Use `locate` for quick discovery and `find` when you need the live filesystem.

`tree` gives a visual outline. Limit the depth so the output stays readable:

```bash
tree -L 2 /srv/web

# Example output:
# /srv/web
# ├── current -> releases/20260624-091000
# ├── releases
# │   └── 20260624-091000
# └── scripts
#     ├── deploy.sh
#     └── healthcheck.sh
```

This output shows structure at a glance. `/srv/web/current` is a symlink to one release directory, and the scripts live under `/srv/web/scripts`.

During an incident, search from the narrowest sensible directory first. Looking under `/etc/nginx` is faster and easier to reason about than searching all of `/`. If you must search broadly, you may choose to hide permission errors:

```bash
find / -name "app.service" 2>/dev/null

# Example output:
# /etc/systemd/system/app.service
```

The `2>/dev/null` part sends error output to `/dev/null`, so unreadable directories do not fill the screen. Use it deliberately. Cleaner output is helpful, and hidden errors can also explain why a search missed some paths.

## Disk Space, Inodes, and Mount Points
<!-- section-summary: `df`, `du`, and mount inspection explain whether storage is full and which path owns the pressure. -->

The last filesystem lesson usually arrives as a strange application error. A service fails to write uploads, Nginx stops logging, or deployments fail while unpacking files. Before chasing application code, check whether the filesystem has free space and free inodes.

Linux tracks storage at the filesystem level, and a filesystem is attached to the tree at a mount point. That means `/var/log` and `/var/lib/app-data` may have different space limits even though both paths start under `/var`. The command output matters because the full path tells you which filesystem owns the problem.

`df` reports capacity for mounted filesystems:

```bash
df -hT

# Example output:
# Filesystem     Type  Size  Used Avail Use% Mounted on
# /dev/vda1      ext4   40G   31G  7.0G  82% /
# /dev/vdb1      xfs   100G   66G   34G  67% /var/lib/app-data
```

The `Mounted on` column is the path your application sees. `/var/lib/app-data` is backed by `/dev/vdb1`, and that filesystem is 67 percent used. This matters because deleting files from `/home` would not free space on `/var/lib/app-data`; each mounted filesystem has its own capacity.

Byte space is only one limit. Filesystems also need a record for each file-like object. Check inode capacity too:

```bash
df -ih

# Example output:
# Filesystem     Inodes IUsed IFree IUse% Mounted on
# /dev/vda1        2.6M  410K  2.2M   16% /
# /dev/vdb1         50M  1.1M   49M    3% /var/lib/app-data
```

An **inode** is the filesystem record behind a file, directory, symlink, or similar object. The filename is the human label in a directory. The inode is the record Linux uses after it follows that label. It stores metadata such as owner, group, permissions, timestamps, size, and the pointers that help the filesystem find the file content.

This extra record exists because a filesystem needs more than raw bytes. It needs a catalog for all the objects inside it. A few huge log files mainly consume byte space. Millions of tiny cache files or session files mainly consume inode records. That is why a filesystem can have free gigabytes and still fail to create new files.

The symptom looks odd at first. A program may print "No space left on device" even though `df -h` shows free gigabytes. Check `df -ih` next. If inode use is near 100 percent, the next decision is to find directories with huge file counts rather than hunting only for large files.

`du` measures directory usage. Use it when `df` says a filesystem is full and you need to know which directory is using the space:

```bash
sudo du -h --max-depth=1 /var | sort -h

# Example output:
# 12M     /var/tmp
# 440M    /var/cache
# 2.4G    /var/log
# 18G     /var/lib
```

The `--max-depth=1` option keeps the report to the first directory level under `/var`. `sort -h` sorts human-readable sizes, so the biggest directory lands near the bottom.

When `df` shows several mounted paths, the `Mounted on` column names the part your application uses. A **mount point** is a directory where Linux attaches a filesystem. The root filesystem is mounted at `/`. Extra storage can be mounted at paths like `/var/lib/app-data`. Use `findmnt` to see the relationship between a path, a device, and a filesystem type:

```bash
findmnt /var/lib/app-data

# Example output:
# TARGET             SOURCE    FSTYPE OPTIONS
# /var/lib/app-data /dev/vdb1 xfs    rw,relatime
```

This says `/var/lib/app-data` is backed by `/dev/vdb1`, uses the `xfs` filesystem, and is mounted read-write.

Mount points also explain why deleting files from the wrong path may fail to free the space you expected. If `/var/lib/app-data` is full, deleting files under `/var/cache` may help the root filesystem while leaving the data volume full. Use `df` to identify the mounted path first, then use `du` inside that path.

Persistent mounts are usually declared in `/etc/fstab`. A typical data volume line might look like this:

```fstab
UUID=7c2b6e0a-0d8e-4c5b-9c2d-7f2b1c6a8f11 /var/lib/app-data xfs defaults,nofail 0 2
```

The fields matter because one wrong value can mount the wrong disk, use the wrong filesystem driver, or block boot:

- `UUID=7c2b6e0a-0d8e-4c5b-9c2d-7f2b1c6a8f11` identifies the storage device in a stable way, even if Linux discovers disks in a different order on the next boot.
- `/var/lib/app-data` is the mount point, so application paths under that directory use this data volume.
- `xfs` names the filesystem driver Linux should use for this volume.
- `defaults,nofail` applies normal mount behavior and allows the machine to keep booting if the optional volume is missing.
- `0` disables the old dump backup flag, which most modern systems leave off.
- `2` tells filesystem checks to run after the root filesystem check. Root usually uses `1`; extra data volumes commonly use `2`.

The `nofail` option can help a cloud server boot even when an optional data disk is temporarily missing, although production teams still alert on that missing mount because the application may need it.

The workflow is now practical. Use `pwd`, `ls`, and `cd` to orient yourself. Use standard directories to make your first guess. Use `find`, `tree`, `df`, `du`, and `findmnt` when the server needs to show you the truth.

![Inodes and open handles infographic showing filenames pointing to inode metadata and a running process holding a deleted file open](/content-assets/articles/article-devops-foundation-linux-linux-basics-filesystem-navigation/inodes-open-handles.png)

_The image connects filenames, inodes, and open file handles so disk-space surprises have a concrete shape._

![Filesystem navigation summary infographic showing root paths, current directory, listings, find, mounts, and disk checks](/content-assets/articles/article-devops-foundation-linux-linux-basics-filesystem-navigation/filesystem-navigation-summary.png)

_The summary image gathers the filesystem habits from the article into one quick review map._

## References

- [Filesystem Hierarchy Standard 3.0](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html) - Defines the purpose of standard Linux directories.
- [Linux `hier(7)` manual](https://man7.org/linux/man-pages/man7/hier.7.html) - Summarizes the filesystem hierarchy from the Linux manual pages.
- [Linux `proc(5)` manual](https://man7.org/linux/man-pages/man5/proc.5.html) - Documents the `/proc` virtual filesystem.
- [Linux `find(1)` manual](https://man7.org/linux/man-pages/man1/find.1.html) - Documents common `find` options and expressions.
- [Linux `df(1)` manual](https://man7.org/linux/man-pages/man1/df.1.html) - Documents filesystem space reporting.
- [Linux `findmnt(8)` manual](https://man7.org/linux/man-pages/man8/findmnt.8.html) - Documents mount inspection.
