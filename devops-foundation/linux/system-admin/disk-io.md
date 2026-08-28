---
title: "Disk & I/O"
description: "Diagnose disk pressure, read filesystem and I/O metrics, and resize storage on a live Linux system without taking it down."
overview: "Diagnose Linux storage issues: full filesystems, inode exhaustion, deleted-but-open logs, slow I/O, mount problems, and practical resizing."
tags: ["disk", "filesystem", "iostat", "lvm"]
order: 4
id: article-devops-foundation-linux-system-admin-disk-io
---

## Table of Contents

1. [What Path Does a Linux File Read or Write Take?](#what-path-does-a-linux-file-read-or-write-take)
2. [How Do Devices, Partitions, and Filesystems Differ?](#how-do-devices-partitions-and-filesystems-differ)
3. [How Do Mounts and /etc/fstab Attach Storage?](#how-do-mounts-and-etcfstab-attach-storage)
4. [How Do df, du, and Inodes Explain Capacity?](#how-do-df-du-and-inodes-explain-capacity)
5. [Why Can a Deleted File Still Consume Space?](#why-can-a-deleted-file-still-consume-space)
6. [How Do You Connect Slow I/O to a Device and Process?](#how-do-you-connect-slow-io-to-a-device-and-process)
7. [How Do You Grow Storage Through Every Layer?](#how-do-you-grow-storage-through-every-layer)
8. [How Do Disk-Full and Disk-Slow Runbooks Differ?](#how-do-disk-full-and-disk-slow-runbooks-differ)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A disk incident often announces itself through one ordinary write that fails. Nginx cannot append to an access log. An upload cannot save its temporary file. `apt` cannot write under `/var/cache`. CPU and memory may look calm because the failing resource is the storage path, not the processor or RAM.

Follow the write one layer at a time. The application writes to a path such as `/var/log/nginx/access.log`. Linux maps that path to a mounted directory such as `/var/log` or `/`. That mount belongs to a filesystem, and the filesystem sits on a disk or virtual disk that Linux sees as a block device.

Each layer answers a different question. The path tells you what the service tried to write. The mount point tells you which filesystem owns that path. The filesystem tells you whether bytes or inodes are running out. The device tells you whether reads and writes are slow or queued. For example, cleaning `/var/lib/app` will not help if the failing path is on `/` and root is the full filesystem.

Keep these questions in view as you work through the lesson:

1. **What Path Does a Linux File Read or Write Take?**
2. **How Do Devices, Partitions, and Filesystems Differ?**
3. **How Do Mounts and `/etc/fstab` Attach Storage?**
4. **How Do `df`, `du`, and Inodes Explain Capacity?**
5. **Why Can a Deleted File Still Consume Space?**
6. **How Do You Connect Slow I/O to a Device and Process?**
7. **How Do You Grow Storage Through Every Layer?**
8. **How Do Disk-Full and Disk-Slow Runbooks Differ?**

## What Path Does a Linux File Read or Write Take?
<!-- section-summary: Disk pressure can break writes, logs, uploads, package updates, and deployments even before CPU or memory look unusual. -->

The practical goal is to answer four questions in order:

- Which filesystem is full, slow, or mounted in the wrong way?
- Which directory or process is responsible?
- Can you safely reclaim space right now?
- Does the server need a permanent storage change?

That order keeps the response disciplined. First learn where the pressure is, then who owns it, then choose a cleanup or resize path. Random deletion on a production server can remove evidence, break services, or clear the wrong filesystem.

![Disk full investigation flow infographic showing df, inode checks, du by path, deleted open files, iostat latency, and safe cleanup or growth](/content-assets/articles/article-devops-foundation-linux-system-admin-disk-io/disk-full-investigation-flow.png)

_The image separates disk incidents into space, inode, deleted-file, latency, and safe-recovery checks._

## How Do Devices, Partitions, and Filesystems Differ?
<!-- section-summary: A block device is storage hardware or virtual storage, while a filesystem is the structure Linux uses to store files on it. -->

During a disk-full or slow-write incident, the path in the error message is only the first clue. The application writes to `/var/lib/app`, but the operational question is which device and filesystem sit behind that path. Without that link, a team can grow the wrong disk, repair the wrong filesystem, or miss that logs and application data share the same small root volume.

At the lowest storage layer, Linux works with chunks of data instead of filenames. A disk is a long addressable space that can read and write those chunks. Linux calls that kind of storage a **block device** because the kernel talks to it in blocks rather than in paths such as `/var/log/nginx/access.log`. A cloud volume, a local SSD, and a virtual disk can all show up this way.

On a cloud VM, a block device might appear as `/dev/vda`, `/dev/sda`, or `/dev/nvme0n1`. The name depends on the virtualization driver and storage type. Treat the name as a label for the storage device. The important idea is that Linux has a device that can store blocks, and another layer has to organize those blocks into files and directories.

That organizing layer is the **filesystem**. A filesystem such as ext4 or XFS gives structure to raw storage. It records directory names, file metadata, permissions, timestamps, and the block locations that hold file contents. Formatting a disk creates those filesystem structures. After that, normal paths such as `/var/log/nginx/access.log` can exist.

Use `lsblk` to see the storage shape:

```bash
lsblk -f -i

# Example output:
# NAME   FSTYPE FSVER LABEL UUID                                 FSAVAIL FSUSE% MOUNTPOINTS
# vda
# `-vda1 ext4   1.0         4b0c4d7e-3a12-41a8-9f6c-1b9a72d91211   1.1G    98% /
# vdb
# `-vdb1 xfs                7c2b6e0a-0d8e-4c5b-9c2d-7f2b1c6a8f11    34G    67% /var/lib/app
```

During an incident, the useful path through the output starts on the right:

- `vda1` is an ext4 filesystem mounted at `/`, so it holds the operating system tree.
- `vdb1` is an XFS filesystem mounted at `/var/lib/app`, so application data written there lands on a separate disk.
- `FSUSE%` says the root filesystem is at `98%`, which is urgent.
- `MOUNTPOINTS` connects device names to paths. Operators usually debug paths first because services write to paths.

Filesystem type matters during resize and repair because each filesystem has its own on-disk layout and tools. ext4 commonly uses `resize2fs` for growth. XFS commonly uses `xfs_growfs` and can grow while mounted. Shrinking XFS usually requires a backup, rebuild, and restore plan, so sizing choices deserve care before production data lands there.

## How Do Mounts and `/etc/fstab` Attach Storage?
<!-- section-summary: Mount points attach filesystems into the single Linux tree, and `/etc/fstab` records mounts that should happen at boot. -->

After adding a data disk, the next risk is what happens after reboot. The app may write to `/var/lib/app` today, then after a reboot that directory may come up as an ordinary folder on the root filesystem if the mount was not recorded correctly. That mistake fills `/` while the original data disk sits unused.

A Linux server presents one directory tree starting at `/`, even if the data comes from several disks. A **mount point** is the directory where one filesystem is attached into that tree. After `/dev/vdb1` is mounted at `/var/lib/app`, applications can write to `/var/lib/app/reports/latest.csv` without knowing the device name. The kernel sees the path, finds the mount point, and sends the write to the filesystem mounted there.

This layout lets teams separate risk. The operating system can live on `/`, application data can live on `/var/lib/app`, and logs can live on `/var/log` or another mount. If the application data disk fills, the root filesystem may still have enough space for SSH, package tools, and emergency repair commands.

Ask Linux what backs a path:

```bash
findmnt /var/lib/app

# Example output:
# TARGET       SOURCE    FSTYPE OPTIONS
# /var/lib/app /dev/vdb1 xfs    rw,relatime
```

The output connects the human path to the storage layer:

- `TARGET` is the path the application uses.
- `SOURCE` is the device or volume behind that path.
- `FSTYPE` is the filesystem format Linux is using.
- `OPTIONS` shows mount behavior. `rw` means read-write.

If an application gets a "read-only filesystem" error, this output is one of the first checks. It tells you whether the path is backed by the expected device and whether Linux mounted it with the expected options.

Mounts that should return after boot usually live in `/etc/fstab`:

```fstab
UUID=7c2b6e0a-0d8e-4c5b-9c2d-7f2b1c6a8f11 /var/lib/app xfs defaults,nofail 0 2
```

Each field answers a boot-time question:

- `UUID=...` identifies the filesystem itself, which is safer than a device name such as `/dev/vdb1` because device names can change after a reboot or storage change.
- `/var/lib/app` is the mount point, so application writes under that path go to this filesystem after the mount succeeds.
- `xfs` tells Linux which filesystem driver to use for the mounted data.
- `defaults,nofail` applies normal mount behavior and lets boot continue if this non-critical disk is missing. Use `nofail` only for mounts the service can safely treat as optional.
- The final `0 2` fields control dump and filesystem-check order on systems that use those paths.

Test mount configuration before a reboot so the mistake shows up while you still have a working SSH session:

```bash
sudo findmnt --verify

# Example output:
# Success, no errors or warnings detected
```

Then ask Linux to mount everything declared in the file:

```bash
sudo mount -a
```

`mount -a` often prints no output when it succeeds. A bad `/etc/fstab` entry can break boot, so verification belongs in the workflow whenever a mount is added or changed.

## How Do `df`, `du`, and Inodes Explain Capacity?
<!-- section-summary: `df` shows filesystem capacity, `df -i` shows inode capacity, and `du` finds which directories consume space. -->

A disk-full error can mean two different resources ran out. The first resource is byte space, which is the storage capacity most people expect. A 40 GB filesystem can run out of bytes because logs, uploads, caches, package files, or backups filled the available blocks.

The second resource is **inodes**. A filesystem stores file content and also keeps one record for each filesystem object, such as a file, directory, symlink, or socket path. That record is the inode. The filename points to the inode, and the inode stores metadata such as owner, group, permissions, timestamps, size, and pointers to the blocks that hold file content.

Here is the beginner version. A directory is a table of names. Each name points to an inode number. The inode is the record Linux uses after it has found the name. That separation is why hard links can give two names to the same file content, and it also explains deleted-open files later in the article.

For everyday operations, the key lesson is file count. A few huge log files consume bytes. Millions of tiny cache files consume inodes. A server can have free GB and still fail to create a new session file, lock file, or upload placeholder because the filesystem has no inode records left.

Check byte capacity first:

```bash
df -hT

# Example output:
# Filesystem     Type  Size  Used Avail Use% Mounted on
# /dev/vda1      ext4   40G   38G  1.1G  98% /
# /dev/vdb1      xfs   100G   66G   34G  67% /var/lib/app
```

`Mounted on` is the column to follow. In this sample, `/` is almost full while `/var/lib/app` still has room. Cleaning the data mount would not solve the root filesystem problem because the failed writes belong to a different filesystem.

Check inode capacity too:

```bash
df -ih

# Example output:
# Filesystem     Inodes IUsed IFree IUse% Mounted on
# /dev/vda1        2.6M  2.6M  8.0K  100% /
# /dev/vdb1         50M   1.2M   49M    3% /var/lib/app
```

Here the root filesystem has almost no inode records left. Even a one-byte file may fail because Linux needs a new inode before it can create the file. This is the clue that cleanup should focus on file count, not only large byte usage.

Now find large directories on the affected filesystem:

```bash
sudo du -x -h --max-depth=1 / | sort -h

# Example output:
# 24M     /tmp
# 220M    /home
# 1.5G    /usr
# 3.8G    /var
```

`-x` keeps `du` on one filesystem, which prevents the command from crossing into a separate mounted data disk. `--max-depth=1` gives a readable first pass. Follow the largest directory:

```bash
sudo du -x -h --max-depth=1 /var | sort -h

# Example output:
# 24M     /var/tmp
# 480M    /var/cache
# 3.8G    /var/lib
# 19G     /var/log
```

If `/var/log` is largest, go one level deeper:

```bash
sudo du -x -h --max-depth=1 /var/log | sort -h

# Example output:
# 120M    /var/log/apt
# 600M    /var/log/journal
# 17G     /var/log/nginx
```

For inode pressure, count files by directory. The goal is to find the directory creating too many filesystem objects, even if those objects are individually small:

```bash
sudo find /var -xdev -type f | cut -d/ -f1-4 | sort | uniq -c | sort -nr | head

# Example output:
# 1280440 /var/lib/app/cache
#   84212 /var/log/nginx
#   12500 /var/cache/apt
```

This output points to file count. `/var/lib/app/cache` owns far more files than the other directories, so it is the first place to inspect for runaway cache behavior, stuck cleanup jobs, or a design that writes one tiny file per request. The safe fix usually starts with application-aware cleanup. Deleting random files under `/var` can break package tools, service state, or logs.

![Filesystem limits infographic showing bytes, inodes, directory usage, reserved blocks, and mount capacity](/content-assets/articles/article-devops-foundation-linux-system-admin-disk-io/filesystem-limits.png)

_The image shows why a filesystem can fail because of bytes, inodes, or where the data is mounted._

## Why Can a Deleted File Still Consume Space?
<!-- section-summary: A deleted file keeps using disk space until every process holding it open closes the file descriptor. -->

One frustrating disk-full case goes like this: someone deletes a huge log file, `du` says the directory is smaller, and `df -h` still says the filesystem is full. The missing piece is a running process that still has the deleted file open.

Linux tracks two things here. The directory entry is the visible name, such as `/var/log/nginx/access.log`. The running process holds an open **file descriptor**, a small handle such as `7w` in `lsof` output. Deleting the name removes the directory entry, yet the descriptor can keep the file's inode and blocks alive.

That explains the split between tools. `du` walks visible names, so it no longer sees the deleted log. `df` asks the filesystem how many blocks are allocated, so it still counts the space. Space returns only after the process closes the descriptor, reopens its logs, or exits.

Find deleted-open files:

```bash
sudo lsof +L1

# Example output:
# COMMAND PID USER     FD   TYPE DEVICE SIZE/OFF NLINK NODE NAME
# nginx   913 www-data  7w   REG  252,1  8.5G     0  812 /var/log/nginx/access.log (deleted)
```

The important pieces are:

- `NLINK` is `0`, which means no directory entry currently points at this inode.
- `(deleted)` confirms the visible filename has gone away.
- `COMMAND` and `PID` name the process still holding the file open.
- `FD` is the file descriptor inside that process. The `w` means the descriptor is open for writing.

In this sample, Nginx owns the descriptor. Restarting the whole VM would release it, but a service-aware reload is smaller and usually safer.

Ask Nginx to validate config, then reload so it reopens logs:

```bash
sudo nginx -t

# Example output:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
```

```bash
sudo systemctl reload nginx
```

This often prints no output when systemd accepts the reload. For other services, use the service's documented log reopen or reload behavior. Truncating `/proc/<pid>/fd/<fd>` can reclaim space in emergencies, but use service-aware rotation and reload whenever possible.

## How Do You Connect Slow I/O to a Device and Process?
<!-- section-summary: `iostat` shows whether storage devices are busy, waiting, or serving requests slowly. -->

A filesystem can have free space and still make the application slow. Storage devices handle a limited number of reads and writes at a time. If too many requests arrive, they wait in a queue. The application may look idle in CPU metrics because its threads are waiting for disk work to finish.

`iostat` gives the device-level view. It shows read and write rates, queueing, wait time, and utilization. For example, if `vda` has high `await` and high `%util` during request timeouts, the disk is a real suspect even if the service process is not using much CPU. The command usually comes from the `sysstat` package.

Sample storage every five seconds:

```bash
iostat -xz 5 2

# Example output:
# Device            r/s     w/s   rkB/s   wkB/s await aqu-sz  %util
# vda              1.2    84.0    48.0  7200.0  38.4   3.20  92.0
# vdb             12.5    10.1  2048.0  1024.0   4.2   0.20  18.0
```

The useful fields answer different questions:

| Field | Meaning |
|---|---|
| `r/s`, `w/s` | Read and write operations per second |
| `rkB/s`, `wkB/s` | Read and write throughput |
| `await` | Average request wait and service time in milliseconds |
| `aqu-sz` | Average queue size |
| `%util` | How busy the device was during the interval |

In the sample, `vda` is busy and slow: `%util` is `92.0`, `await` is `38.4`, and the queue is building. Those numbers make the device a real suspect. If `/var/log` lives on `vda`, heavy logging can slow the whole VM. The next step is to connect that device pressure to a process.

### How Do You Identify the Process Behind Device Activity?
<!-- section-summary: Per-process I/O tools connect device pressure to the service, backup, export, or log writer causing it. -->

Device metrics tell you which disk is busy. Process metrics tell you who is doing the I/O. This distinction matters because the fix changes with the owner. A backup job may need a different schedule. A report export may need throttling. Nginx logs may need rotation. The main service may need code or storage design work.

`iotop` shows live per-process I/O. It may need installation and root:

```bash
sudo iotop -oPa

# Example output:
# Total DISK READ:       0.00 B/s | Total DISK WRITE:       8.12 M/s
#   TID  PRIO  USER     DISK READ  DISK WRITE  SWAPIN      IO>    COMMAND
#  2409 be/4  root        0.00 B/s    7.80 M/s  0.00 %  78.21 % tar -czf /var/backups/app.tgz /srv/app
#   913 be/4  www-data    0.00 B/s  320.00 K/s  0.00 %   4.10 % nginx: worker process
```

`-o` shows processes currently doing I/O, `-P` groups by process, and `-a` accumulates totals. Here the backup process is the main writer, so scheduling or throttling may be the right fix.

Without `iotop`, use `/proc/<pid>/io`. First find the service PID:

```bash
pid=$(systemctl show -p MainPID --value app.service)
sudo cat "/proc/${pid}/io"

# Example output:
# rchar: 18422019
# wchar: 9210021
# syscr: 12210
# syscw: 8220
# read_bytes: 4096000
# write_bytes: 8192000
# cancelled_write_bytes: 0
```

The fields separate what the process asked for from what reached storage:

- `rchar` counts bytes the process asked to read through read-like system calls. This can include data satisfied from cache.
- `wchar` counts bytes the process asked to write through write-like system calls. This can include writes that are buffered before the disk sees them.
- `read_bytes` counts bytes the kernel actually fetched from the storage layer for this process.
- `write_bytes` counts bytes the kernel actually sent toward storage for this process.
- `cancelled_write_bytes` counts dirty bytes that were removed before they had to be written, often because a file was truncated or deleted before flush.

One snapshot only says "this has happened since the process started." To prove the process is causing the current slowdown, check the same file twice a few seconds apart:

```bash
sudo cat "/proc/${pid}/io"
sleep 5
sudo cat "/proc/${pid}/io"

# Example output:
# read_bytes: 4096000
# write_bytes: 8192000
#
# read_bytes: 4096000
# write_bytes: 30408704
```

The second snapshot shows `write_bytes` grew from about `8M` to about `30M` in five seconds, while `read_bytes` stayed flat. That proves this process is actively writing to storage during the slowdown. If only `wchar` grows and `write_bytes` stays flat, the process may be writing into cache, a pipe, or another path that has not reached the device yet.

Open files connect a process to paths:

```bash
sudo lsof -p "$pid" | head

# Example output:
# COMMAND  PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
# node    1842 app  cwd    DIR  252,1     4096  140 /srv/app/current
# node    1842 app    1w   REG  252,1  1048576  891 /var/log/app/stdout.log
# node    1842 app   18u   REG  252,2  7340032 1201 /var/lib/app/reports/latest.csv
```

This output helps you match the busy process to real files and mount points:

- Descriptor `1w` writes standard output to `/var/log/app/stdout.log`.
- Descriptor `18u` has `/var/lib/app/reports/latest.csv` open for reading and writing.
- The `DEVICE` column differs between `252,1` and `252,2`, so the log file and report file may live on different mounted filesystems.
- If `write_bytes` is rising and `lsof` shows a large report file open, the report export is a better suspect than Nginx logging.

## How Do You Grow Storage Through Every Layer?
<!-- section-summary: Storage growth requires expanding the cloud disk or volume, then expanding the partition, logical volume, and filesystem as needed. -->

A common resize surprise happens after the cloud disk was increased from `100G` to `120G`, yet `df -h` still shows the application filesystem at `100G`. The cloud layer changed, and Linux still has to extend the layers above it.

The bottom layer is the virtual disk from the provider or hypervisor. Linux sees it as a block device. A partition may sit on that device. LVM may add physical volumes and logical volumes. The filesystem sits at the top and owns the structures that store files and directories.

`df -h` reports the filesystem layer, so it does not grow just because the provider disk grew. The exact command path depends on the layout: direct partition, LVM, ext4, XFS, or another design. Inspection comes first, then the matching growth command for the layout.

Before resizing anything, do the safety checks first. Confirm there is a recent backup or snapshot for the volume. Confirm the device name, mount point, filesystem type, and whether LVM sits between the partition and filesystem. Also confirm you are on the intended host. Resize commands change real disk metadata, and a wrong device name can damage data that the application still needs.

Inspect the current shape before changing anything:

```bash
lsblk -i /dev/vdb
lsblk -f /dev/vdb
findmnt /var/lib/app

# Example output:
# NAME   MAJ:MIN RM SIZE RO TYPE MOUNTPOINTS
# vdb    252:16   0 120G  0 disk
# `-vdb1 252:17   0 100G  0 part /var/lib/app
#
# NAME   FSTYPE FSVER LABEL UUID                                 FSAVAIL FSUSE% MOUNTPOINTS
# vdb
# `-vdb1 xfs                8f31f0ef-4a2f-4a64-9ca7-f8a6f6f8b6b0   6.2G    94% /var/lib/app
#
# TARGET       SOURCE    FSTYPE OPTIONS
# /var/lib/app /dev/vdb1 xfs    rw,relatime
```

Here the disk is `120G`, the partition is still `100G`, and the mounted filesystem is XFS on `/dev/vdb1`. The extra 20 GB exists at the device layer, yet the filesystem cannot use it until the partition and filesystem grow.

Pause before the command because the next step changes the partition table. `growpart /dev/vdb 1` means "expand partition number 1 on disk `/dev/vdb`." If you accidentally point at `/dev/vda` or the wrong partition number, you are editing the wrong device. Confirm the target in `lsblk`, confirm the backup, then expand partition `1` into the extra space:

```bash
sudo growpart /dev/vdb 1

# Example output:
# CHANGED: partition=1 start=2048 old: size=209713152 end=209715200 new: size=251656159 end=251658207
```

The output says partition `1` kept the same start sector and received a larger end sector. Keeping the start sector is important because moving the start would change where the filesystem data begins.

After the partition grows, grow the filesystem that lives on it. The command depends on the filesystem type. For XFS, grow the mounted filesystem by mount point:

```bash
sudo xfs_growfs /var/lib/app

# Example output:
# meta-data=/dev/vdb1              isize=512    agcount=4, agsize=6553600 blks
# data blocks changed from 26214400 to 31457019
```

For ext4, use `resize2fs` against the device:

```bash
sudo resize2fs /dev/vdb1

# Example output:
# resize2fs 1.47.0 (5-Feb-2023)
# Filesystem at /dev/vdb1 is mounted on /var/lib/app; on-line resizing required
# The filesystem on /dev/vdb1 is now 31457019 (4k) blocks long.
```

For LVM, the flow changes because the filesystem sits on a logical volume. Expand the physical volume first, then extend the logical volume and filesystem together with `-r`:

```bash
sudo pvresize /dev/vdb1
sudo lvextend -r -L +20G /dev/vg_app/lv_data

# Example output:
#   Physical volume "/dev/vdb1" changed
#   Size of logical volume vg_app/lv_data changed from 100.00 GiB to 120.00 GiB.
#   File system xfs found on vg_app/lv_data mounted at /var/lib/app.
#   Extending file system xfs to 120.00 GiB.
```

Verify the result after the resize:

```bash
lsblk -i /dev/vdb
df -hT /var/lib/app

# Example output:
# NAME   MAJ:MIN RM SIZE RO TYPE MOUNTPOINTS
# vdb    252:16   0 120G  0 disk
# `-vdb1 252:17   0 120G  0 part /var/lib/app
#
# Filesystem     Type  Size  Used Avail Use% Mounted on
# /dev/vdb1      xfs   120G  101G   19G  85% /var/lib/app
```

The verification should show the partition and filesystem at the new size. If `lsblk` grew but `df` did not, the partition step worked and the filesystem step still needs attention.

## How Do Disk-Full and Disk-Slow Runbooks Differ?
<!-- section-summary: A good disk runbook confirms the full filesystem, finds the owner, handles deleted files, applies safe cleanup, then plans permanent capacity. -->

A disk-full alert usually sounds urgent because writes can fail quickly: logs stop appending, deployments fail, uploads break, and package tools cannot create temporary files. The first useful split is bytes versus inodes. Bytes answer "is the filesystem out of storage blocks?" Inodes answer "can the filesystem create more file records?"

The two checks lead to different searches. Byte pressure sends you toward large files and large directories. Inode pressure sends you toward huge numbers of tiny files, such as cache entries, sessions, or unpacked build artifacts.

```bash
df -hT
df -ih

# Example output:
# Filesystem     Type  Size  Used Avail Use% Mounted on
# /dev/vda1      ext4   40G   38G  1.1G  98% /
#
# Filesystem     Inodes IUsed IFree IUse% Mounted on
# /dev/vda1        2.6M  2.6M  8.0K  100% /
```

The output says the root filesystem is under byte pressure and inode pressure at the same time. `Use% 98%` means normal writes have very little space left. `IUse% 100%` means the filesystem may also fail to create new files even if you free a small amount of bytes. That points you toward both large files and directories with huge file counts.

After you know the affected mount, stay on that filesystem and find the owner. The `-x` flag keeps `du` from crossing into another mounted disk, which prevents a data volume from confusing a root-filesystem investigation:

```bash
sudo du -x -h --max-depth=1 / | sort -h
sudo du -x -h --max-depth=1 /var | sort -h

# Example output:
# 24M     /var/tmp
# 480M    /var/cache
# 3.8G    /var/lib
# 19G     /var/log
```

The sorted output puts the largest entries at the bottom. Here `/var/log` is the clear owner at `19G`, so the next checks should focus on logs before removing package caches or application data.

If the large directory points at logs or application output, check for very large files and deleted-open files. The first command finds visible large files. The second finds files whose names are gone while a process still holds the space:

```bash
sudo find /var -xdev -type f -size +500M -ls | sort -k7 -n | tail
sudo lsof +L1

# Example output:
#   812 8912896 -rw-r-----   1 www-data adm 9126805504 Jun 24 10:12 /var/log/nginx/access.log
# nginx 913 www-data 7w REG 252,1 9126805504 0 812 /var/log/nginx/access.log (deleted)
```

Interpret those two clues separately:

- The `find` line shows a visible `access.log` around `9.1G`, owned by `www-data:adm`.
- The `lsof` line shows Nginx process `913` still has a deleted `access.log` open.
- The `7w` descriptor means Nginx is writing through file descriptor `7`.
- The `(deleted)` marker means removing the filename did not free the space because the process still holds the file open.

For a visible large log, rotate or compress it through the normal rotation path. For a deleted-open log, reload the owning service so it closes the old descriptor and opens the current filename.

Apply the safest cleanup first: rotate or compress logs through logrotate, remove old release directories only after checking what is active, and clear package caches when appropriate.

```bash
sudo apt clean
```

`apt clean` often prints no output when it succeeds.

```bash
sudo dnf clean all

# Example output:
# 20 files removed
```

After reclaiming space, verify the filesystem, deleted-open files, service state, and recent logs:

```bash
df -hT /
sudo lsof +L1

# Example output:
# Filesystem     Type  Size  Used Avail Use% Mounted on
# /dev/vda1      ext4   40G   29G  9.2G  76% /
```

No output from `lsof +L1` means this check did not find deleted-open files. The `df` line now shows `9.2G` available and `76%` used, so the immediate disk pressure has cleared.

```bash
systemctl status app.service nginx
journalctl -u app.service -n 50 --no-pager

# Example output:
# app.service - Application service
#      Active: active (running) since Wed 2026-06-24 10:25:10 UTC; 2min ago
#
# nginx.service - A high performance web server and a reverse proxy server
#      Active: active (running) since Wed 2026-06-24 10:25:12 UTC; 2min ago
```

The permanent fix may be better log rotation, moving data to the correct mount, increasing volume size, reducing noisy logs, or moving report generation off the VM. The immediate cleanup keeps the service alive. The follow-up prevents the same filesystem from filling again.

### What Happens Between a Path and Durable Storage?

A directory maps a name to an inode-like filesystem object; the name is not the deepest identity of the file. The object stores metadata and points toward data blocks. A hard link can add another name for the same object, and deleting one name removes only that mapping. Space becomes reusable after the final link is gone and no process still holds the object open.

Reads normally pass through the page cache. When the requested page is already in RAM, the filesystem can satisfy the read without a device operation. A cache miss asks the block layer and device to fetch it, after which later reads may be fast. Benchmarking a file twice can therefore measure cache on the second pass rather than storage.

Writes are often buffered too. A successful `write()` can mean the bytes entered kernel memory, not that stable media has committed them. Modified cached pages are dirty until writeback sends them down. `fsync()` asks the system to make the relevant data and metadata durable according to the storage stack's guarantees. Applications such as databases use ordering, logs, and sync calls because “accepted by the kernel” and “survives power loss” are different promises.

Filesystems update metadata as names, sizes, permissions, and block mappings change. Journaling records enough filesystem changes to restore structural consistency after a crash. It is not an application backup and does not guarantee that a partially completed business transaction is correct. Backups protect another copy; journaling protects the filesystem's own consistency rules.

A mount can hide pre-existing directory contents. If files were written to `/var/lib/app` before a data filesystem was mounted there, mounting the device makes those root-filesystem files invisible through that path without deleting them. They still consume space on `/`. Unmounting reveals them again. This is one reason `df`, `findmnt`, and the boot mount state must be checked together.

### How Do LVM and Partitions Add Layers?

A partition divides a block device into address ranges and exposes each range as another block device. A filesystem may be placed directly on that partition. Logical Volume Manager adds a flexible mapping: physical volumes contribute storage to a volume group, and logical volumes receive ranges from that pool. The filesystem then sits on the logical volume.

The complete chain might be:

```text
cloud volume -> /dev/nvme1n1 -> partition -> LVM physical volume
             -> volume group -> logical volume -> XFS -> /var/lib/app
```

Each arrow is a separate capacity boundary. Enlarging the cloud volume does not enlarge the partition. Enlarging the partition does not tell LVM about new extents. Enlarging the logical volume does not automatically enlarge every filesystem. Inspect the actual chain before running a growth command.

Device names can change with discovery order, drivers, and virtualization. `/etc/fstab` commonly uses a filesystem UUID because it identifies the formatted filesystem more stably than `/dev/sdb1`. Confirm the UUID with `blkid` or `lsblk -f`, create the mount point, test `mount -a`, and inspect `findmnt` before reboot. A syntactically wrong persistent mount can delay boot or send application writes to the root directory underneath the missing mount.

### Why Do Capacity Numbers Disagree?

`df` asks a mounted filesystem about its allocated and available block accounting. `du` walks reachable directory entries and sums the blocks associated with the files it can see. They answer different questions, so disagreement is evidence rather than a tool failure.

Deleted-but-open files are the classic difference: the filesystem still allocates their blocks, but `du` cannot reach them by a pathname. Other differences include files hidden under a mount, permissions preventing `du` from walking a tree, filesystem metadata, snapshots, reserved blocks, sparse files, hard links, and the difference between apparent length and allocated blocks.

Use both allocated and apparent views deliberately:

```bash
du -xhd1 /var | sort -h
du -xhd1 --apparent-size /var | sort -h
stat --format='size=%s blocks=%b block_size=%B name=%n' large-file
```

A sparse file can have a large logical length while allocating fewer physical blocks. A database or virtual-disk image can change that relationship as holes are filled. `du -x` stays on one filesystem so a search under `/` does not accidentally traverse another mount and attribute its usage to the root investigation.

Inodes or equivalent metadata objects can become the limiting capacity before bytes. Millions of empty cache files may exhaust the filesystem's available inode count while gigabytes remain free. `df -i` reveals that branch. The repair is to remove or redesign the tiny-file population, not grow one large data file or chase block percentages.

Reserved capacity can protect administrative recovery on some filesystems and explain why an ordinary user sees less available space than the device total suggests. Do not remove the reserve reflexively. Understand which filesystem supports it and why it exists, then size the volume and alert thresholds so production does not depend on consuming the emergency margin.

Snapshots and thin provisioning add capacity outside the mounted filesystem's ordinary view. A snapshot retains old blocks as data changes; a thin pool promises logical space backed by a shared physical pool. The guest filesystem may show free blocks while the snapshot store or thin pool approaches exhaustion. Inspect the storage platform and LVM pool as well as `df`.

### How Should You Interpret Storage Performance?

Throughput is bytes transferred per second. IOPS is operations completed per second. Latency is time per operation. Sequential large transfers can produce high throughput with moderate IOPS, while small random database operations can require high IOPS with modest byte volume. No single threshold describes every device and workload.

Queue depth counts work waiting or active at the device. As demand approaches what the storage can serve, queued operations wait behind one another and latency can rise sharply. `iostat -xz 5` exposes rates, sizes, queue information, and average completion time over repeated intervals. Ignore or label the first report when it represents averages since boot rather than the incident window.

`await` includes the time an operation spends queued and serviced. Compare it with the application's latency needs and the device's normal baseline. `%util` describes how much sample time the device reported work in progress, but modern devices can serve requests in parallel; `100%` does not have one universal throughput meaning, and a lower value does not guarantee good latency.

High throughput with stable `await` may be healthy bulk work. Low throughput with terrible `await` can mean a saturated or failing device serving small requests slowly. High load with idle CPU, blocked tasks, and high device latency points toward I/O waiting. Connect these signals rather than labeling any single column “bad.”

Application writes do not map one-to-one to physical writes because page cache, write combining, filesystem metadata, RAID, device caches, and storage controllers sit between them. `/proc/PID/io` separates characters passed through syscalls from bytes attributed to storage. `read_bytes`, `write_bytes`, and `cancelled_write_bytes` provide useful process evidence, but they are still kernel accounting rather than a perfect ledger of media operations.

Network storage changes the latency and failure assumptions. A path can wait on the local network, remote server, remote disk, or protocol recovery. RAID changes how logical operations map to physical devices. Neither changes the filesystem semantics seen by the application, so diagnosis still traces the same layers and then expands below the affected block or mount layer.

Kernel logs matter when I/O looks pathological:

```bash
journalctl -k --since '1 hour ago' --no-pager |
  grep -Ei 'I/O error|reset|timeout|nvme|scsi|xfs|ext4'
```

Device resets, filesystem errors, transport timeouts, and read-only remounts are integrity or health problems, not ordinary capacity cleanup. Preserve evidence and follow the storage and filesystem recovery procedure instead of stressing the device with an indiscriminate benchmark.

### How Do You Grow the Correct Object Safely?

Start with `findmnt -T PATH`, `lsblk -f`, and the relevant LVM commands. Verify the provider volume, device, partition, physical volume, volume group, logical volume, filesystem type, and mount point. Take or verify a usable backup before changing storage metadata. A snapshot can help, but it is not automatically independent of the same failure domain.

For a partition-backed filesystem, grow the external disk first, then expand the partition with the platform-appropriate tool, then grow the filesystem. For LVM, make the enlarged device visible, resize the physical volume when needed, extend the logical volume, and finally grow the filesystem. ext4 commonly grows with `resize2fs`; XFS grows with `xfs_growfs` against the mounted filesystem. The precise commands depend on the inspected topology.

Growth is normally easier than shrinkage. XFS does not offer the same ordinary shrink path as some filesystems, and reducing any filesystem requires careful support and data-layout checks. Plan recovery as backup, rebuild, and restore when the filesystem cannot shrink safely. Never assume a growth command has a symmetric reverse operation.

After every layer, verify the new boundary before continuing. Confirm device size, partition size, LVM free extents, logical-volume size, filesystem size, and application writes. A successful provider resize with unchanged `df` means the request has not yet reached the filesystem layer.

### What Makes the Two Incident Runbooks Different?

A disk-full runbook begins with `findmnt -T` and `df -hT` for the failing path, then `df -i`, bounded `du -x`, and `lsof +L1`. It identifies whether the missing capacity is blocks, metadata objects, a reachable directory, an open unlinked file, a hidden path, or an outer storage pool. Reclaim the smallest safe target, verify the writing service, and create a retention or sizing follow-up.

A disk-slow runbook samples `vmstat` and `iostat`, identifies the affected device and time window, then attributes activity with `pidstat -d`, `iotop`, `/proc/PID/io`, service logs, and scheduled-work history. It checks kernel errors and the remote or platform layer. The response may be to stop competing backup work, repair a failing device, reduce synchronous write pressure, increase IOPS capacity, or redesign the application's access pattern.

Do not delete database files, container runtime layers, package databases, or unfamiliar logs while a process is using them. Use the owning application's cleanup and retention mechanism. A random deletion can corrupt logical state, and the deleted-open-file rule may prevent it from freeing space anyway.

Storage troubleshooting is dependency tracing. Capacity, metadata capacity, performance, and integrity are separate questions. The path tells you the mount; the mount tells you the filesystem and device chain; the accounting and latency evidence identify the constrained layer; the application and process evidence identify the owner.

### How Do Common Storage Scenarios Differ?

If `df` and `du` both identify `/var/log` as the consumer, inspect the largest files, their owners, recent growth, and rotation policy. Use the application's supported rotation or retention path, preserve incident evidence, and reclaim only known-safe data. The permanent work is to bound growth or provide the intended capacity.

If `df` is full and `du` cannot find the blocks, run `lsof +L1` and inspect mount coverage. An unlinked log held by a process needs that process to close or reopen the descriptor. Data hidden beneath a mount requires a controlled maintenance path to inspect the underlying filesystem. Neither condition is fixed by deleting additional visible files at random.

If load is high but CPUs are mostly idle, inspect `vmstat` blocked tasks and `iostat` latency and queues. A process in `D` may be waiting in the kernel for the storage path. Determine whether production traffic, backup work, writeback, remote storage, or a device error owns the wait.

High throughput with low, stable latency can be a healthy sequential transfer. Low throughput with large latency can be an unhealthy small-operation workload. Compare operation sizes, IOPS, queue depth, latency, and the application's required service time. Throughput alone does not rank storage health.

### How Do Backups and Databases Expose the Storage Contract?

A backup can read large portions of a filesystem, evict useful page cache, generate write traffic at the destination, and contend with application I/O. Compression may add CPU pressure at the same time. Schedule and limit backups using measured production impact, and verify the backup independently. A snapshot created on the same storage platform can provide a recovery point but is not automatically an off-system backup.

Databases make durability and latency visible. Transaction logs and sync operations depend on acknowledged writes reaching the promised durability boundary. Deleting a database file outside the database's own procedure can corrupt logical state even if the filesystem permits it. Use the database's retention, compaction, backup, and recovery tools; use Linux evidence to show which device and operation are slow.

Container storage has similar ownership. Image layers, writable layers, volumes, and runtime metadata have relationships the runtime understands. Removing files inside the runtime's data directory can orphan state or break running containers. Use supported pruning and volume lifecycle commands after identifying which workload owns the space.

### How Do Integrity and Health Differ from Fullness?

A filesystem can have free capacity while the device reports timeouts or media errors. A full filesystem can live on a physically healthy device. `df` answers allocation, not drive health. Device health tools, cloud volume status, RAID state, kernel logs, and filesystem error reports answer other layers.

Some filesystems remount read-only after serious errors to limit damage. An application then reports permission-like write failures even though modes and free bytes look acceptable. Check `findmnt` options and kernel logs before changing permissions. Follow the filesystem's documented repair process, normally from an appropriate offline or recovery state when required.

SSDs and NVMe devices have controller health and wear information that is distinct from filesystem usage. Thin pools and snapshots have outer capacity. RAID has member and rebuild state. Network storage has server and network health. A complete storage dashboard exposes these layers instead of treating “disk percent used” as the whole system.

### What Should Change Verification Prove?

After cleanup, confirm the exact filesystem has free blocks or inodes, the writing process can create and sync a test object where appropriate, deleted-open files are gone, and services remain healthy. After growth, confirm every expanded layer and the mounted filesystem's new total. After performance intervention, repeat the same interval sampling and user operation.

Record what was removed, which owner approved it, whether it can be recovered, and what prevents recurrence. If a service was restarted to release an open log, connect that availability action to the rotation configuration that should make future reopen behavior correct. If a volume was grown, update capacity alerts and forecast so growth is not the only recurring response.

The safest command map follows the question: `findmnt` maps a path to a mount, `lsblk` maps mounts to devices, `df` reports filesystem allocation, `du` walks names, `lsof` finds open references, `iostat` samples devices, `pidstat` and `/proc` attribute work, LVM commands reveal mapping, and kernel logs reveal health. Use the tool whose model matches the unknown.

### How Does One Write Cross the Full Dependency Chain?

An application opens a pathname. Directory lookup resolves names to a filesystem object through the mounted namespace. Permission and mount policy allow or deny the operation. The kernel copies or maps changed data into pages and marks it dirty. The filesystem allocates data and metadata, journals required structural changes, and submits block operations. A device, virtual volume, RAID layer, network target, or cloud service ultimately acknowledges them.

The application can observe success at several boundaries. A buffered write can succeed before writeback. A flush can wait for the filesystem and device durability contract. Replication or database commit can add another application boundary. When a user says “the file was written,” ask which acknowledgement they mean and which failures it must survive.

A read performs the reverse dependency search. Names resolve to metadata and blocks; page cache can satisfy resident data; a miss waits for the block path; readahead may fetch adjacent data; the application receives bytes after the required pages arrive. Cache can hide slow storage during a warm interval and expose it after eviction or a working-set increase.

This chain explains why Linux storage feels layered: each abstraction provides a useful contract and its own accounting. Keep the layers distinct, connect them through the affected path, and change only the boundary that the evidence shows is constrained.

Mount intent also has an operational lifecycle. Create the filesystem with the correct type, identify it stably, create the mount-point directory, mount it temporarily, verify ownership and application access, add and validate the persistent entry, then test the boot path. Writing application data before confirming the mount can place files on the root filesystem underneath it. Changing filesystem ownership while the intended device is absent can modify the wrong directory.

Growing storage should follow the same caution. Stop when the observed topology differs from the runbook. A device may use no partition table, LVM may be absent, a cloud image may use a different device name, or the filesystem may not support the expected online operation. Commands that are correct for one chain can damage another.

When space is urgent, preserve a recovery margin rather than filling it again with diagnostic output, package downloads, or a large archive created on the same filesystem. Direct evidence to another mounted filesystem or remote destination when safe. Restore enough headroom for logs, sockets, temporary files, and administrative commands, then make the durable retention or capacity change.

Storage changes should be rehearsed against the actual filesystem and topology, including rollback and recovery media. Capture `lsblk`, `findmnt`, LVM state, filesystem type, and backups before mutation. If the host cannot tolerate the verified recovery procedure, the change plan is incomplete even when the growth command is familiar.

Capacity alerts should leave time for investigation and recovery, not fire only at `100%`. Growth rate, inode rate, thin-pool usage, snapshot consumption, and expected deployment peaks help set the threshold. A filesystem needs working room for metadata, temporary files, journal activity, and administrative recovery before its last reported block disappears.

Performance baselines should likewise separate normal devices and workloads. Compare latency under similar operation sizes and queue depth. A value acceptable for a bulk archive may violate a database commit target, while the database target may be irrelevant to a cold backup volume.

Record the filesystem path beside every device metric so later reviewers can connect user impact to the correct mount and workload rather than a similarly named disk.

Keep the sample interval and device name as well; rates and latency without a time window cannot be compared reliably.

Tie the sample to the affected request or job whenever possible.

That connection separates useful production work from accidental contention and makes the follow-up owner clear.

## Check Your Answers

:::expand[What Path Does a Linux File Read or Write Take?]{kind="recap"}
A pathname resolves through directories and a mounted filesystem, while cache, writeback, and the block layer connect file operations to durable media.
:::

:::expand[How Do Devices, Partitions, and Filesystems Differ?]{kind="recap"}
Devices store blocks, partitions divide them, LVM remaps capacity, and filesystems turn blocks into named objects and metadata.
:::

:::expand[How Do Mounts and `/etc/fstab` Attach Storage?]{kind="recap"}
A mount attaches one filesystem to the unified tree; persistent intent should use verified identities and survive a tested boot path.
:::

:::expand[How Do `df`, `du`, and Inodes Explain Capacity?]{kind="recap"}
`df` reports filesystem allocation, `du` walks reachable names, and inode accounting reveals tiny-file exhaustion.
:::

:::expand[Why Can a Deleted File Still Consume Space?]{kind="recap"}
Unlinking removes a name, but blocks remain allocated until the last link and open file reference disappear.
:::

:::expand[How Do You Connect Slow I/O to a Device and Process?]{kind="recap"}
Relate latency, throughput, IOPS, queues, blocked tasks, kernel evidence, and per-process accounting in the same sample window.
:::

:::expand[How Do You Grow Storage Through Every Layer?]{kind="recap"}
Inspect the topology, back up, expand each actual layer in order, and verify the boundary before proceeding.
:::

:::expand[How Do Disk-Full and Disk-Slow Runbooks Differ?]{kind="recap"}
Capacity incidents trace allocated space and metadata; performance incidents trace waiting, latency, queues, and workload ownership.
:::

![Disk and IO summary infographic showing devices, filesystems, mount points, deleted files, latency, process IO, filesystem growth, and runbook checks](/content-assets/articles/article-devops-foundation-linux-system-admin-disk-io/disk-io-summary.png)

_The summary image turns disk and I/O troubleshooting into a step-by-step review board._

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
