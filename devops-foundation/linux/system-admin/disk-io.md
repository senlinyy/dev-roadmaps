---
title: "Disk & I/O"
description: "Diagnose disk pressure, read filesystem and I/O metrics, and resize storage on a live Linux system without taking it down."
overview: "Diagnose storage issues on a Linux API VM: full disks, inode exhaustion, deleted-but-open logs, slow I/O, mount problems, and practical resizing."
tags: ["disk", "filesystem", "iostat", "lvm"]
order: 4
id: article-devops-foundation-linux-system-admin-disk-io
---

## Table of Contents

1. [Why Storage Incidents Look Like App Bugs](#why-storage-incidents-look-like-app-bugs)
2. [Block Devices and Filesystems](#block-devices-and-filesystems)
3. [Mount Points and `/etc/fstab`](#mount-points-and-etcfstab)
4. [Space, Inodes, and Directory Usage](#space-inodes-and-directory-usage)
5. [Deleted Files That Still Use Space](#deleted-files-that-still-use-space)
6. [I/O Latency with `iostat`](#io-latency-with-iostat)
7. [Per-Process I/O](#per-process-io)
8. [Growing a Filesystem](#growing-a-filesystem)
9. [A Disk-Full Runbook](#a-disk-full-runbook)
10. [References](#references)

## Why Storage Incidents Look Like App Bugs
<!-- section-summary: Disk pressure can break writes, logs, uploads, package updates, and deployments while the symptom appears in the application. -->

The `inventory-api` can fail because storage is unhealthy. A full root filesystem can stop Nginx from writing logs. A full data mount can stop uploads. Inode exhaustion can prevent tiny session files from being created even when `df -h` shows free gigabytes. Slow disk I/O can make requests time out while CPU and memory look calm.

This is why disk checks belong early in Linux operations. When the API returns errors after a normal traffic spike, the problem may be a log file growing too fast under `/var/log/nginx`, a report export filling `/var/lib/inventory-api`, or a deleted log file still held open by a process.

The practical goal is to answer four questions. Which filesystem is full or slow? Which directory or process is responsible? Can we safely reclaim space now? Does the server need a permanent storage change?

## Block Devices and Filesystems
<!-- section-summary: A block device is storage hardware or virtual storage, while a filesystem is the structure Linux uses to store files on it. -->

A **block device** is storage presented to Linux in fixed-size blocks. On a cloud VM, it may be a virtual disk such as `/dev/vda` or `/dev/nvme0n1`. A **filesystem** is the format placed on a partition or volume so Linux can store directories and files. Common Linux filesystems include ext4 and XFS.

`lsblk` shows the device layout:

```bash
$ lsblk -f
NAME   FSTYPE FSVER LABEL UUID                                 FSAVAIL FSUSE% MOUNTPOINTS
vda
└─vda1 ext4   1.0         4b0c4d7e-3a12-41a8-9f6c-1b9a72d91211   7.0G    82% /
vdb
└─vdb1 xfs                7c2b6e0a-0d8e-4c5b-9c2d-7f2b1c6a8f11    34G    67% /var/lib/inventory-api
```

This VM has a root filesystem on `/dev/vda1` and a data filesystem mounted at `/var/lib/inventory-api`. That split is common because application data can grow without immediately filling the operating system disk.

Filesystem type matters during resize and repair. ext4 and XFS are both mature, common choices. ext4 uses `resize2fs` for growth. XFS uses `xfs_growfs` and grows while mounted. XFS shrink plans usually involve backup, rebuild, and restore, so volume sizing and backups matter.

## Mount Points and `/etc/fstab`
<!-- section-summary: Mount points attach filesystems into the single Linux tree, and `/etc/fstab` records mounts that should happen at boot. -->

A **mount point** is the directory where a filesystem appears in the Linux tree. The root filesystem is mounted at `/`. The API data disk might be mounted at `/var/lib/inventory-api`.

`findmnt` shows what backs a path:

```bash
$ findmnt /var/lib/inventory-api
TARGET                 SOURCE    FSTYPE OPTIONS
/var/lib/inventory-api /dev/vdb1 xfs    rw,relatime
```

Persistent mounts usually live in `/etc/fstab`:

```fstab
UUID=7c2b6e0a-0d8e-4c5b-9c2d-7f2b1c6a8f11 /var/lib/inventory-api xfs defaults,nofail 0 2
```

The UUID identifies the filesystem. The path says where it mounts. The type says which filesystem driver to use. Options control behavior. The final fields affect dump and filesystem check ordering.

Testing mount configuration is safer than waiting for a reboot:

```bash
$ sudo findmnt --verify
$ sudo mount -a
```

`findmnt --verify` checks `/etc/fstab`. `mount -a` attempts to mount everything declared there. On production VMs, a bad `fstab` entry can break boot, so verify before rebooting.

## Space, Inodes, and Directory Usage
<!-- section-summary: `df` shows filesystem capacity, `df -i` shows inode capacity, and `du` finds which directories consume space. -->

`df` answers filesystem-level space:

```bash
$ df -hT
Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/vda1      ext4   40G   38G  1.1G  98% /
/dev/vdb1      xfs   100G   66G   34G  67% /var/lib/inventory-api
```

The root filesystem is nearly full. The next question is where the space went:

```bash
$ sudo du -h --max-depth=1 /var | sort -h
24M     /var/tmp
480M    /var/cache
3.8G    /var/lib
19G     /var/log
```

Nginx logs may be the culprit:

```bash
$ sudo du -h --max-depth=1 /var/log | sort -h
120M    /var/log/apt
600M    /var/log/journal
17G     /var/log/nginx
```

Inodes are separate from bytes. A filesystem uses one inode for each file, directory, symlink, and similar object. Millions of tiny files can exhaust inodes while space remains:

```bash
$ df -ih
Filesystem     Inodes IUsed IFree IUse% Mounted on
/dev/vda1        2.6M  2.6M  8.0K  100% /
```

Finding inode-heavy directories can start with:

```bash
$ sudo find /var -xdev -type f | cut -d/ -f1-4 | sort | uniq -c | sort -nr | head
```

The `-xdev` flag keeps `find` on one filesystem. That matters on a VM with a separate data mount because you want to avoid mixing root filesystem results with `/var/lib/inventory-api`.

## Deleted Files That Still Use Space
<!-- section-summary: A deleted file keeps using disk space until every process holding it open closes the file descriptor. -->

Linux separates a filename from an open file. If a process opens a log file and another command deletes the filename, the process can keep writing to the already open file descriptor. `du` no longer sees the file by name, but `df` still shows the space in use.

This happens with logs. Someone removes a huge `/var/log/nginx/access.log`, while Nginx keeps the file open. Space returns only after Nginx closes or reopens that descriptor.

Find deleted-but-open files with `lsof`:

```bash
$ sudo lsof +L1
COMMAND  PID     USER   FD   TYPE DEVICE SIZE/OFF NLINK NODE NAME
nginx    913 www-data    7w   REG  252,1  8.5G     0  812 /var/log/nginx/access.log (deleted)
```

The clean fix is to ask the service to reopen logs or restart safely. For Nginx, a reload often reopens log files:

```bash
$ sudo nginx -t
$ sudo systemctl reload nginx
```

For other services, consult the service documentation. Truncating a file descriptor through `/proc/<pid>/fd/<fd>` can reclaim space in emergencies, but it is a sharp tool. Prefer service-aware log rotation and reload behavior.

## I/O Latency with `iostat`
<!-- section-summary: `iostat` shows whether storage devices are busy, waiting, or serving requests slowly. -->

When CPU and memory look fine but requests still lag, disk I/O may be the pressure. The `iostat` command usually comes from the `sysstat` package.

```bash
$ iostat -xz 5
Device            r/s     w/s   rkB/s   wkB/s await aqu-sz  %util
vda              1.2    84.0    48.0  7200.0  38.4   3.20  92.0
vdb             12.5    10.1  2048.0  1024.0   4.2   0.20  18.0
```

Useful fields:

| Field | Meaning |
|---|---|
| `r/s`, `w/s` | Read and write operations per second |
| `rkB/s`, `wkB/s` | Read and write throughput |
| `await` | Average time requests wait and complete, in milliseconds |
| `aqu-sz` | Average queue size |
| `%util` | How busy the device was during the interval |

High `%util` with high `await` on `vda` suggests the root disk is saturated. If `/var/log` is on that disk, heavy logging can slow the whole server. If the data disk `vdb` is busy during report exports, the API's upload or read path may compete with that workload.

`iostat` is device-level. It points to the busy disk. The next question is which process is causing it.

## Per-Process I/O
<!-- section-summary: Per-process I/O tools connect device pressure to the service, backup, export, or log writer causing it. -->

`iotop` shows live per-process I/O, but it may need installation and root:

```bash
$ sudo iotop -oPa
```

The `-o` flag shows processes doing I/O, `-P` groups by process, and `-a` accumulates totals. If a backup process writes heavily during business hours, `iotop` will usually make that obvious.

Without `iotop`, `/proc/<pid>/io` exposes counters:

```bash
$ pid=$(systemctl show -p MainPID --value inventory-api)
$ sudo cat "/proc/${pid}/io"
```

Fields such as `read_bytes` and `write_bytes` show storage I/O attributed to the process. Check the file twice a few seconds apart to see whether the numbers are moving.

For open files, `lsof` connects a process to paths:

```bash
$ sudo lsof -p "$pid" | head
$ sudo lsof -p "$pid" | grep /var/lib/inventory-api
```

This helps when the API reads or writes unexpected files during a slow request.

## Growing a Filesystem
<!-- section-summary: Storage growth requires expanding the cloud disk or volume, then expanding the partition, logical volume, and filesystem as needed. -->

Growing storage depends on the VM layout. Cloud providers usually require two broad steps. First, expand the disk or volume in the cloud control plane. Second, tell Linux to use the new size.

For a simple partition on a cloud disk, the flow may be:

```bash
$ lsblk
$ sudo growpart /dev/vdb 1
$ sudo xfs_growfs /var/lib/inventory-api
```

For ext4, the filesystem step uses `resize2fs`:

```bash
$ sudo growpart /dev/vdb 1
$ sudo resize2fs /dev/vdb1
```

For LVM, there are more layers:

```bash
$ sudo pvresize /dev/vdb1
$ sudo lvextend -r -L +20G /dev/vg_api/lv_data
```

The `-r` flag asks LVM to resize the filesystem too when supported. Before resizing, confirm backups, identify the filesystem type with `lsblk -f`, and know whether the path is ext4, XFS, or another filesystem. Storage changes are routine in production, but they still deserve a written runbook because the wrong device name can damage data.

## A Disk-Full Runbook
<!-- section-summary: A good disk runbook confirms the full filesystem, finds the owner, handles deleted files, applies safe cleanup, then plans permanent capacity. -->

When the VM reports a full disk, start with the filesystem:

```bash
$ df -hT
$ df -ih
```

Then stay on the affected filesystem and find the largest directories:

```bash
$ sudo du -x -h --max-depth=1 / | sort -h
$ sudo du -x -h --max-depth=1 /var | sort -h
```

Look for large files and deleted-open files:

```bash
$ sudo find /var -xdev -type f -size +500M -ls | sort -k7 -n | tail
$ sudo lsof +L1
```

Apply the safest cleanup first. Rotate or compress logs through logrotate. Remove old release directories only after checking the active `current` symlink. Clear package caches when appropriate:

```bash
$ sudo apt clean
$ sudo dnf clean all
```

After reclaiming space, check the service and logs:

```bash
$ systemctl status inventory-api nginx
$ curl --fail --silent --show-error https://api.example.com/health
$ journalctl -u inventory-api -n 50 --no-pager
```

The permanent fix may be better log rotation, moving data to the separate mount, increasing volume size, reducing noisy logs, or moving report generation off the VM. The immediate cleanup keeps the service alive. The follow-up prevents the same disk from filling again next week.

## References

- [Linux `lsblk(8)` manual](https://man7.org/linux/man-pages/man8/lsblk.8.html) - Documents block device listing.
- [Linux `findmnt(8)` manual](https://man7.org/linux/man-pages/man8/findmnt.8.html) - Documents mount inspection and verification.
- [Linux `df(1)` manual](https://man7.org/linux/man-pages/man1/df.1.html) - Documents filesystem space and inode reporting.
- [Linux `du(1)` manual](https://man7.org/linux/man-pages/man1/du.1.html) - Documents directory usage measurement.
- [Linux `lsof` manual](https://man7.org/linux/man-pages/man8/lsof.8.html) - Documents listing open files, including deleted files.
- [sysstat `iostat` manual](https://man7.org/linux/man-pages/man1/iostat.1.html) - Documents extended I/O statistics.
- [XFS grow filesystem manual](https://man7.org/linux/man-pages/man8/xfs_growfs.8.html) - Documents growing XFS filesystems.
- [resize2fs manual](https://man7.org/linux/man-pages/man8/resize2fs.8.html) - Documents resizing ext filesystems.
- [LVM lvextend manual](https://man7.org/linux/man-pages/man8/lvextend.8.html) - Documents logical volume extension.
