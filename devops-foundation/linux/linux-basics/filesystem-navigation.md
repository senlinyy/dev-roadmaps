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

The first time a server asks for your attention, it usually gives you a path. Nginx may mention a config file, a deploy script may complain about a missing directory, or a log message may point at a file under `/var/log`. Filesystem navigation is the skill that lets you follow those clues without guessing.

The **Linux filesystem** is the way Linux names and organizes files, directories, programs, logs, devices, and mounted storage. Every item receives a path.

A path is a location written as text. `/etc/nginx/nginx.conf` points to a configuration file. `/var/log/nginx/access.log` points to a log file. `/srv/web` often points to application files served by the machine.

This skill shows up early in real operations work. Before you edit Nginx, restart a service, clean up a full disk, or check a mounted volume, you need to answer a few small questions: where am I, what is nearby, where does Linux usually keep this kind of file, and which path should I inspect next?

A good learning path follows those questions in order. First comes the root tree. Then come `pwd`, `ls`, and `cd`. After that, the standard Linux directories, virtual filesystems, search commands, and disk tools make much more sense.

## One Tree Under the Root Directory
<!-- section-summary: Files, directories, devices, and mounted storage share one tree rooted at `/`. -->

A deploy fails because it cannot open `/srv/web/current/config.yml`, and the Nginx log points at `/var/log/nginx/error.log`. Those paths may live on different disks, but Linux still asks you to follow one shared directory tree. The top of that tree is the **root directory**, written as `/`. Every normal file, directory, device path, and mounted disk appears somewhere under `/`.

The root directory exists so every program can use one naming system. A process does not need to know which physical disk, cloud volume, container layer, or network filesystem holds a file before it asks for `/etc/nginx/nginx.conf`. It asks the kernel for that path, and the kernel walks the tree one directory name at a time.

You can ask Linux to list the top level of that tree:

```bash
ls /
```

Example output:

```console
bin   boot  dev  etc  home  lib  proc  root  run  srv  tmp  usr  var
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

## Find Your Place with `pwd`
<!-- section-summary: `pwd` prints the current working directory, which is the place relative paths start from. -->

Picture an SSH session where a cleanup command is sitting in your terminal history. Before running anything that removes, copies, or edits files, you need to know which directory the shell is using right now.

Your shell always has a current directory. This is also called the **working directory**. When you run a command with a relative path, Linux resolves that path from your current directory.

Use `pwd` when you want to know where the shell is standing:

```bash
pwd
```

Example output:

```console
/home/deploy
```

This output says the current directory is `/home/deploy`.

- The first `/` is the root directory.
- `home` is a directory under `/`.
- `deploy` is a user home directory under `/home`.

This one command prevents many mistakes. If you plan to remove old build files or copy a release archive, check `pwd` first. A command that is safe in `/srv/web/releases` may be dangerous in `/`.

## Look Around with `ls`
<!-- section-summary: `ls` lists files and directories, and long output adds permissions, ownership, size, and timestamps. -->

After you know where you are, the next question is what is nearby. The `ls` command lists the contents of a directory.

```bash
ls
```

Example output:

```console
releases  scripts
```

This means the current directory contains two entries named `releases` and `scripts`. The plain output is useful for a quick glance, but server work often needs more detail.

Add `-l` for a long listing:

```bash
ls -l
```

Example output:

```console
total 8
drwxr-xr-x 4 deploy web 4096 Jun 24 09:10 releases
drwxr-xr-x 2 deploy web 4096 Jun 24 09:10 scripts
```

The long listing adds operational clues.

- The first column shows file type and permissions. A leading `d` means directory.
- The `deploy` column is the owning user.
- The `web` column is the owning group.
- The size and timestamp help you notice recent changes.

Hidden files begin with a dot. Use `-a` to include them, and `-h` to show human-readable sizes:

```bash
ls -lah /srv/web
```

Example output:

```console
total 32K
drwxr-xr-x  6 deploy web   4.0K Jun 24 09:10 .
drwxr-xr-x  4 root   root  4.0K Jun 10 12:02 ..
-rw-r--r--  1 deploy web    612 Jun 24 09:10 package.json
drwxr-xr-x  3 deploy web   4.0K Jun 24 09:10 src
drwxr-xr-x  2 deploy web   4.0K Jun 24 09:10 scripts
```

Notice the two special entries at the top. `.` means the current directory. `..` means the parent directory. The first character on each long listing line tells you the file type: `-` marks a regular file, and `d` marks a directory.

Many operators type `ls -lah` by habit because it shows enough detail to catch ownership, permission, and timestamp problems quickly. In the output above, application files belong to `deploy:web`, while the parent directory belongs to `root:root`. That kind of detail often explains why one user can edit a file and another cannot.

## Move with `cd` and Path Names
<!-- section-summary: `cd` changes the shell's current directory, and path style decides where Linux starts resolving the name. -->

The shell always has a current directory. Commands such as `ls`, `cat`, `cp`, and `rm` use that location as their starting point whenever a path is not written from `/`. Changing directory is how you move the shell's attention to the part of the filesystem you are working on.

Use `cd` to change that current directory. A simple move to an application directory looks like this:

```bash
cd /srv/web
```

`cd` normally prints no output when it succeeds. Confirm the move with `pwd`:

```bash
pwd
```

Example output:

```console
/srv/web
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
```

Example output:

```console
conf.d  nginx.conf  sites-available  sites-enabled
```

Try one relative path from `/srv/web`:

```bash
ls scripts
```

Example output:

```console
deploy.sh  healthcheck.sh
```

A few shortcuts save time:

```bash
cd ~
```

`~` means your home directory. For the `deploy` user, that is often `/home/deploy`.

```bash
cd -
```

Example output:

```console
/srv/web
```

`cd -` jumps back to the previous directory and prints the path it returned to.

One small implementation detail explains why `cd` is special. `cd` is a shell builtin because it must change the directory of your current shell. If it ran as a separate program, that separate process would change its own directory, exit, and leave your shell in the same place.

The production symptom is simple: a deploy command works from `/srv/web` and fails from `/home/deploy` with "No such file or directory." That usually means the command used a relative path and the operator ran it from a different directory. The next decision is whether the runbook should `cd` into a known directory first or use absolute paths for important files.

## Where Linux Puts Important Things
<!-- section-summary: The Filesystem Hierarchy Standard gives common locations for configuration, logs, programs, service data, and user files. -->

During a real debug session, the first question is rarely "what is every Linux directory for?" The question is more practical: where would this server keep the Nginx config, where would it write the error log, and where did the application code land after deploy?

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
```

Example output:

```console
conf.d  nginx.conf  sites-available  sites-enabled
```

```bash
ls /var/log/nginx
```

Example output:

```console
access.log  error.log
```

These outputs teach a useful habit. Let the filesystem guide you. You do not need to memorize every file name on day one. Learn the main directory purposes, list the directory, then follow the names.

## Virtual Filesystems: Live Views from the Kernel
<!-- section-summary: Directories such as `/proc`, `/sys`, and `/dev` expose live kernel and device information through file-like paths. -->

A service may look broken even though the config file and log file both look normal. The next clue may be live process state, memory pressure, mounted devices, or kernel information that is not stored in ordinary project files. Directories such as `/proc`, `/sys`, and `/dev` give you that view through file-like paths.

Some directories look like normal files and directories, but Linux creates their contents from live kernel information. These are **virtual filesystems**. They let tools and humans inspect processes, devices, memory, disks, and runtime state through file-like paths.

Virtual filesystems exist because many pieces of system state are easier to inspect through the same file tools you already know. The kernel fills these paths on demand. Reading `/proc/meminfo` asks the kernel to format current memory information as text.

The easiest example is `/proc`. It contains process and kernel information. Use `pgrep -a` to find a running process:

```bash
pgrep -a node
```

Example output:

```console
1842 node /srv/web/server.js
```

The number `1842` is the process ID, or PID. Linux exposes information for that process under `/proc/1842`.

Now inspect the command line recorded for that process:

```bash
tr '\0' ' ' < /proc/1842/cmdline
```

Example output:

```console
node /srv/web/server.js
```

The `cmdline` file separates arguments with null bytes, so the `tr` command turns those null bytes into spaces for display.

Other useful live files include:

```bash
cat /proc/loadavg
```

Example output:

```console
0.18 0.22 0.20 1/281 1842
```

The first three numbers are load averages. They help show whether the machine has been busy recently.

```bash
head -5 /proc/meminfo
```

Example output:

```console
MemTotal:        4044104 kB
MemFree:          812340 kB
MemAvailable:    2219812 kB
Buffers:          102840 kB
Cached:          1249088 kB
```

Monitoring tools read these files constantly. You can read them too when a dashboard is missing or a server is too limited for a full toolchain.

`/dev` exposes devices and special endpoints. `/dev/null` discards anything written to it, which explains command patterns like `2>/dev/null` for hiding error output. Disk devices such as `/dev/sda` or `/dev/nvme0n1` also appear there. Treat disk device paths carefully because they represent real storage.

`/sys` exposes hardware and driver state. Most beginners only read from it. It is useful because it shows how Linux represents hardware through paths.

The practical next decision is to ask whether a path is real stored content or a live view. Editing files under `/etc` changes saved configuration. Reading files under `/proc` usually inspects live state. Writing to some virtual filesystem paths can change kernel or device behavior, so read first and change only with trusted instructions.

## Find Files When You Do Not Know the Path
<!-- section-summary: `find`, `locate`, and `tree` help you discover files when memory or documentation is incomplete. -->

Even with a standard layout, real servers collect local choices. A deploy script may live in `/opt`, a backup may sit under `/var/backups`, or a team helper may be installed under `/usr/local/bin`. Search commands help when the path is unknown.

`find` walks the live filesystem and matches paths by name, type, size, time, owner, permission, and many other attributes. Look for Nginx config files first:

```bash
find /etc/nginx -type f -name "*.conf"
```

Example output:

```console
/etc/nginx/nginx.conf
/etc/nginx/conf.d/gzip.conf
/etc/nginx/sites-available/web.conf
```

The command reads as: walk `/etc/nginx`, match regular files, and keep names ending in `.conf`.

Search for executable shell scripts under an application directory:

```bash
find /srv/web -type f -name "*.sh" -perm -u+x
```

Example output:

```console
/srv/web/scripts/deploy.sh
/srv/web/scripts/healthcheck.sh
```

The important pieces are small:

- `-type f` limits matches to regular files.
- `-name "*.sh"` matches file names ending in `.sh`.
- `-perm -u+x` keeps files where the owner execute bit is set.

Search for large log files:

```bash
find /var/log -type f -size +100M
```

Example output:

```console
/var/log/nginx/access.log.1
/var/log/journal/4b3b0c/system.journal
```

Search for files changed in the last day:

```bash
find /srv/web -type f -mtime -1
```

Example output:

```console
/srv/web/current/package.json
/srv/web/current/src/server.js
/srv/web/scripts/deploy.sh
```

`locate` is different. It searches a prebuilt database, so it is fast. The tradeoff is freshness. Very new files may not appear until the database refreshes.

```bash
locate app.service
```

Example output:

```console
/etc/systemd/system/app.service
/home/deploy/notes/app.service.example
```

Use `locate` for quick discovery and `find` when you need the live filesystem.

`tree` gives a visual outline. Limit the depth so the output stays readable:

```bash
tree -L 2 /srv/web
```

Example output:

```console
/srv/web
├── current -> releases/20260624-091000
├── releases
│   └── 20260624-091000
└── scripts
    ├── deploy.sh
    └── healthcheck.sh
```

This output shows structure at a glance. `/srv/web/current` is a symlink to one release directory, and the scripts live under `/srv/web/scripts`.

During an incident, search from the narrowest sensible directory first. Looking under `/etc/nginx` is faster and easier to reason about than searching all of `/`. If you must search broadly, you may choose to hide permission errors:

```bash
find / -name "app.service" 2>/dev/null
```

Example output:

```console
/etc/systemd/system/app.service
```

The `2>/dev/null` part sends error output to `/dev/null`, so unreadable directories do not fill the screen. Use it deliberately. Cleaner output is helpful, and hidden errors can also explain why a search missed some paths.

## Disk Space, Inodes, and Mount Points
<!-- section-summary: `df`, `du`, and mount inspection explain whether storage is full and which path owns the pressure. -->

Storage problems often look like application bugs. A service may fail to write uploads, Nginx may stop logging, or deployments may fail while unpacking files. The first check is whether the filesystem has free space and free inodes.

Linux tracks storage at the filesystem level, and a filesystem is attached to the tree at a mount point. That means `/var/log` and `/var/lib/app-data` may have different space limits even though both paths start under `/var`. The command output matters because the full path tells you which filesystem owns the problem.

`df` reports capacity for mounted filesystems:

```bash
df -hT
```

Example output:

```console
Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/vda1      ext4   40G   31G  7.0G  82% /
/dev/vdb1      xfs   100G   66G   34G  67% /var/lib/app-data
```

The `Mounted on` column is the path your application sees. `/var/lib/app-data` is backed by `/dev/vdb1`, and that filesystem is 67 percent used. This matters because deleting files from `/home` would not free space on `/var/lib/app-data`; each mounted filesystem has its own capacity.

Byte space is only one limit. Filesystems also need a record for each file-like object. Check inode capacity too:

```bash
df -ih
```

Example output:

```console
Filesystem     Inodes IUsed IFree IUse% Mounted on
/dev/vda1        2.6M  410K  2.2M   16% /
/dev/vdb1         50M  1.1M   49M    3% /var/lib/app-data
```

An **inode** is the filesystem record behind a file, directory, symlink, or similar object. The filename is the human label in a directory. The inode is the record Linux uses after it follows that label. It stores metadata such as owner, group, permissions, timestamps, size, and the pointers that help the filesystem find the file content.

This extra record exists because a filesystem needs more than raw bytes. It needs a catalog for all the objects inside it. A few huge log files mainly consume byte space. Millions of tiny cache files or session files mainly consume inode records. That is why a filesystem can have free gigabytes and still fail to create new files.

The symptom looks odd at first. A program may print "No space left on device" even though `df -h` shows free gigabytes. Check `df -ih` next. If inode use is near 100 percent, the next decision is to find directories with huge file counts rather than hunting only for large files.

`du` measures directory usage. Use it when `df` says a filesystem is full and you need to know which directory is using the space:

```bash
sudo du -h --max-depth=1 /var | sort -h
```

Example output:

```console
12M     /var/tmp
440M    /var/cache
2.4G    /var/log
18G     /var/lib
```

The `--max-depth=1` option keeps the report to the first directory level under `/var`. `sort -h` sorts human-readable sizes, so the biggest directory lands near the bottom.

A **mount point** is a directory where Linux attaches a filesystem. The root filesystem is mounted at `/`. Extra storage can be mounted at paths like `/var/lib/app-data`. Use `findmnt` to see the relationship between a path, a device, and a filesystem type:

```bash
findmnt /var/lib/app-data
```

Example output:

```console
TARGET             SOURCE    FSTYPE OPTIONS
/var/lib/app-data /dev/vdb1 xfs    rw,relatime
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

## References

- [Filesystem Hierarchy Standard 3.0](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html) - Defines the purpose of standard Linux directories.
- [Linux `hier(7)` manual](https://man7.org/linux/man-pages/man7/hier.7.html) - Summarizes the filesystem hierarchy from the Linux manual pages.
- [Linux `proc(5)` manual](https://man7.org/linux/man-pages/man5/proc.5.html) - Documents the `/proc` virtual filesystem.
- [Linux `find(1)` manual](https://man7.org/linux/man-pages/man1/find.1.html) - Documents common `find` options and expressions.
- [Linux `df(1)` manual](https://man7.org/linux/man-pages/man1/df.1.html) - Documents filesystem space reporting.
- [Linux `findmnt(8)` manual](https://man7.org/linux/man-pages/man8/findmnt.8.html) - Documents mount inspection.
