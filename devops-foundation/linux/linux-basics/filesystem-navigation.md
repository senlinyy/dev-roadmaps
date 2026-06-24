---
title: "Filesystem & Navigation"
description: "Navigate the Linux filesystem hierarchy, understand mount points, and manage files and directories from the command line."
overview: "Learn the Linux filesystem through a practical server story: finding the API code, Nginx config, logs, runtime files, and mounted storage on a VM."
tags: ["FHS", "cd", "ls", "find"]
order: 1
id: article-devops-foundation-linux-linux-basics-filesystem-navigation
---

## Table of Contents

1. [The Server We Are Operating](#the-server-we-are-operating)
2. [One Tree Starts at the Root Directory](#one-tree-starts-at-the-root-directory)
3. [Moving Around with `pwd`, `ls`, and `cd`](#moving-around-with-pwd-ls-and-cd)
4. [Where Linux Puts Important Things](#where-linux-puts-important-things)
5. [Virtual Filesystems: Live Views from the Kernel](#virtual-filesystems-live-views-from-the-kernel)
6. [Finding Files During an Incident](#finding-files-during-an-incident)
7. [Disk Space, Inodes, and Mount Points](#disk-space-inodes-and-mount-points)
8. [References](#references)

## The Server We Are Operating
<!-- section-summary: This article uses one Linux VM scenario so paths and commands connect to real production work. -->

Imagine a small company running an `inventory-api` service on one Linux VM named `api-01`. Nginx receives public HTTPS traffic on ports `80` and `443`, then forwards requests to the API process listening on `127.0.0.1:3000`. The application code lives under `/srv/inventory-api`, Nginx configuration lives under `/etc/nginx`, service logs appear in `journalctl`, and Nginx writes access and error logs under `/var/log/nginx`.

This is a common early production shape. A team may start with a single VM before moving to containers, autoscaling groups, or Kubernetes. The machine still needs the same basic operating habits: you need to find config files, check logs, inspect disk usage, understand mounted volumes, and avoid deleting the wrong thing while you are connected over SSH.

Filesystem navigation gives you the map for that work. Before you can edit Nginx, restart a service, rotate logs, or debug a full disk, you need to know where Linux places things and how to move through those paths calmly.

## One Tree Starts at the Root Directory
<!-- section-summary: Linux presents files, directories, devices, and mounted storage as one tree rooted at `/`. -->

A **filesystem** is the structure Linux uses to name and organize data. Linux presents that structure as one tree that begins at the root directory, written as `/`. Every file, directory, program, log, device, and mounted disk appears somewhere under that single root.

This differs from Windows drive letters such as `C:\` and `D:\`. On Linux, an extra disk, network share, or cloud volume gets attached at a directory path inside the same tree. For our VM, the operating system may live on one disk, while a larger data volume may be mounted at `/var/lib/inventory-api`. Both still look like ordinary paths.

A **directory** is a container that maps names to files and other directories. Your shell always has a current directory, also called the working directory. When you run a command with a relative path like `logs/current.log`, Linux resolves it from that current directory. When you run a command with an absolute path like `/var/log/nginx/access.log`, Linux starts from `/` every time.

The running scenario makes this concrete. The application code path `/srv/inventory-api` starts at `/`, enters `srv`, then enters `inventory-api`. The Nginx site file `/etc/nginx/sites-enabled/inventory-api.conf` starts at `/`, enters `etc`, then follows the Nginx configuration directories. Every path tells a small route through the same tree.

## Moving Around with `pwd`, `ls`, and `cd`
<!-- section-summary: The first navigation commands answer where you are, what is nearby, and where to go next. -->

Three commands carry most beginner navigation work. `pwd` prints the current working directory. `ls` lists files in a directory. `cd` changes the shell's current directory. Together they answer the first questions you ask after SSHing into a server: where am I, what is here, and how do I reach the file I care about?

A normal investigation might start like this:

```bash
$ pwd
/home/deploy

$ ls
releases  scripts

$ cd /srv/inventory-api
$ pwd
/srv/inventory-api

$ ls -lah
total 32K
drwxr-xr-x  6 deploy inventory 4.0K Jun 24 09:10 .
drwxr-xr-x  4 root   root      4.0K Jun 10 12:02 ..
-rw-r--r--  1 deploy inventory  612 Jun 24 09:10 package.json
drwxr-xr-x  3 deploy inventory 4.0K Jun 24 09:10 src
drwxr-xr-x  2 deploy inventory 4.0K Jun 24 09:10 scripts
```

The `-l` flag gives long output with permissions, owner, group, size, and timestamp. The `-a` flag includes hidden dotfiles such as `.env.example` and `.gitignore`. The `-h` flag makes sizes easier to read. Many operators type `ls -lah` by habit because it shows enough detail to catch permission and ownership mistakes quickly.

Paths can be absolute or relative. An absolute path starts with `/`, such as `/etc/nginx/nginx.conf`. A relative path starts from the current directory, such as `scripts/deploy.sh` when you are already inside `/srv/inventory-api`. The shortcuts `~` and `-` also matter: `cd ~` returns to your home directory, and `cd -` jumps back to the previous directory.

One small detail explains why `cd` behaves differently from commands like `ls`. `cd` is a shell builtin because it must change the directory of the shell process itself. If `cd` ran as a separate program, that separate process would change its own directory, exit, and leave your shell exactly where it was. This is why commands that change shell state, such as `cd`, `export`, and `umask`, live inside the shell.

## Where Linux Puts Important Things
<!-- section-summary: The Filesystem Hierarchy Standard gives common locations for configuration, logs, programs, service data, and user files. -->

Linux distributions follow a shared layout called the **Filesystem Hierarchy Standard**, usually shortened to FHS. It defines the purpose of common directories so an Ubuntu VM, Debian VM, and Red Hat style VM still feel familiar. The exact package names can differ, but the broad paths stay recognizable.

For the `inventory-api` VM, the most important paths are these:

| Path | What it usually holds | Scenario example |
|---|---|---|
| `/etc` | System-wide configuration | `/etc/nginx/sites-enabled/inventory-api.conf`, `/etc/systemd/system/inventory-api.service` |
| `/var` | Data that changes while the system runs | `/var/log/nginx/access.log`, package caches, runtime state |
| `/srv` | Data served by this machine | `/srv/inventory-api` application code |
| `/home` | User home directories | `/home/deploy/.ssh/authorized_keys` |
| `/root` | Root user's home directory | Emergency admin shell files |
| `/usr/bin` | Installed user commands | `systemctl`, `journalctl`, `curl` |
| `/usr/local` | Locally installed software outside the package manager | Custom helper tools built by the team |
| `/tmp` | Short-lived temporary files | Upload scratch files that can disappear after reboot |
| `/run` | Runtime files created after boot | PID files and sockets |

The important idea is purpose. Configuration belongs under `/etc`, so Nginx and systemd files go there. Logs and changing data belong under `/var`, so Nginx logs and package caches appear there. Application code that the server provides to users often belongs under `/srv`, so the API checkout lands at `/srv/inventory-api`.

This layout helps during handoff. If another engineer says, "Nginx is returning 502," you already know the likely first paths: `/etc/nginx` for proxy configuration, `/var/log/nginx` for Nginx logs, `/etc/systemd/system` for the API service unit, and `/srv/inventory-api` for the deployed code.

## Virtual Filesystems: Live Views from the Kernel
<!-- section-summary: Directories such as `/proc`, `/sys`, and `/dev` expose live kernel and device information through file-like paths. -->

Some directories look like normal files but come from the kernel at read time. These are **virtual filesystems**. They give programs and humans a file-shaped way to inspect processes, devices, memory, disks, and runtime state.

The `/proc` directory is the most useful early example. It contains live process and kernel information. Every running process receives a numeric process ID, or PID, and `/proc/<pid>` exposes details about that process. The command below finds the API process, then reads the command line the kernel recorded for it:

```bash
$ pgrep -a node
1842 node /srv/inventory-api/server.js

$ tr '\0' ' ' < /proc/1842/cmdline
node /srv/inventory-api/server.js
```

The file `/proc/meminfo` shows live memory information, `/proc/loadavg` shows load averages, and `/proc/self` points at the process reading it. Monitoring tools read these files constantly. You can read them too when a dashboard is missing or the machine is too broken for a full toolchain.

The `/dev` directory exposes devices and special endpoints. `/dev/null` discards anything written to it, which explains command patterns like `2>/dev/null` for hiding error output. Disk devices such as `/dev/sda` or `/dev/nvme0n1` also appear here, although you handle them carefully because they represent real storage.

The `/sys` directory exposes hardware and driver state. Disk, network, CPU, and device information appears there in a structured way. Most beginners only read from `/sys`; the directory helps explain how Linux turns hardware into paths.

## Finding Files During an Incident
<!-- section-summary: `find`, `locate`, and `tree` help you discover files when memory or documentation is incomplete. -->

Even with the standard layout, real servers collect years of small decisions. A previous engineer may have placed a deploy script in `/opt`, a backup in `/var/backups`, or a local helper in `/usr/local/bin`. Search commands help when the path is unknown.

`find` walks a directory tree and matches files by name, type, size, time, owner, permission, and many other attributes. It reads the live filesystem, so it sees files created seconds ago. The tradeoff is speed because walking a large tree can take time.

```bash
$ find /etc/nginx -type f -name "*.conf"
$ find /srv/inventory-api -type f -name "*.sh" -perm -u+x
$ find /var/log -type f -size +100M
$ find /srv/inventory-api -type f -mtime -1
```

These examples answer practical questions. Which Nginx config files exist? Which executable scripts are inside the API checkout? Which logs are bigger than 100 MB? Which files changed in the last day after a deployment?

`locate` searches a prebuilt database, so it returns results quickly. Its database refreshes on a schedule, often daily, which means very new files may be missing. It works well for older paths like package files or known config names.

```bash
$ locate inventory-api.service
$ locate nginx.conf
```

`tree` gives a visual directory outline. It helps when you join a project and need to understand a checkout without opening every file.

```bash
$ tree -L 2 /srv/inventory-api
/srv/inventory-api
├── package.json
├── scripts
│   ├── deploy.sh
│   └── healthcheck.sh
└── src
    ├── routes
    └── server.js
```

During an incident, search from the narrowest sensible directory first. Looking under `/etc/nginx` is faster and safer than searching all of `/`. When you need to search broadly, redirect permission errors away so the useful matches stay readable:

```bash
$ find / -name "inventory-api.service" 2>/dev/null
```

## Disk Space, Inodes, and Mount Points
<!-- section-summary: `df`, `du`, and mount inspection explain whether storage is full and which path owns the pressure. -->

Storage problems often look like application bugs. The API may fail to write uploads, Nginx may stop logging, or deployments may fail while unpacking files. The first question is whether the filesystem has free blocks and free inodes.

`df` reports capacity for mounted filesystems. Blocks represent storage bytes. Inodes represent file records. A disk can have free bytes and still fail to create new files if the inode count is exhausted, which happens when a directory contains millions of tiny files.

```bash
$ df -hT
Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/vda1      ext4   40G   31G  7.0G  82% /
/dev/vdb1      xfs   100G   66G   34G  67% /var/lib/inventory-api

$ df -ih
Filesystem     Inodes IUsed IFree IUse% Mounted on
/dev/vda1        2.6M  410K  2.2M   16% /
/dev/vdb1         50M  1.1M   49M    3% /var/lib/inventory-api
```

`du` measures directory usage. It answers where the space is going inside one mounted filesystem.

```bash
$ sudo du -h --max-depth=1 /var | sort -h
12M     /var/tmp
440M    /var/cache
2.4G    /var/log
18G     /var/lib
```

A **mount point** is a directory where Linux attaches a filesystem. The root filesystem is mounted at `/`. Extra storage can be mounted at paths like `/var/lib/inventory-api`. The command `findmnt` shows the relationship between paths, devices, and filesystem types.

```bash
$ findmnt /var/lib/inventory-api
TARGET                 SOURCE    FSTYPE OPTIONS
/var/lib/inventory-api /dev/vdb1 xfs    rw,relatime
```

Persistent mounts are usually declared in `/etc/fstab`. A typical line for a data volume might look like this:

```fstab
UUID=7c2b6e0a-0d8e-4c5b-9c2d-7f2b1c6a8f11 /var/lib/inventory-api xfs defaults,nofail 0 2
```

The UUID identifies the device in a stable way. The mount path tells Linux where it should appear. The filesystem type tells Linux how to read it. The `nofail` option can help cloud VMs boot even when an optional data disk is temporarily missing, although production teams still alert on that missing mount because the application may need it.

The pattern is simple after a little practice. Use `pwd`, `ls`, and `cd` to move. Use the standard directories to guess where things belong. Use `find`, `df`, `du`, and `findmnt` when the server disagrees with your guess.

## References

- [Filesystem Hierarchy Standard 3.0](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html) - Defines the purpose of standard Linux directories.
- [Linux `hier(7)` manual](https://man7.org/linux/man-pages/man7/hier.7.html) - Summarizes the filesystem hierarchy from the Linux manual pages.
- [Linux `proc(5)` manual](https://man7.org/linux/man-pages/man5/proc.5.html) - Documents the `/proc` virtual filesystem.
- [Linux `find(1)` manual](https://man7.org/linux/man-pages/man1/find.1.html) - Documents common `find` options and expressions.
- [Linux `df(1)` manual](https://man7.org/linux/man-pages/man1/df.1.html) - Documents filesystem space reporting.
- [Linux `findmnt(8)` manual](https://man7.org/linux/man-pages/man8/findmnt.8.html) - Documents mount inspection.
