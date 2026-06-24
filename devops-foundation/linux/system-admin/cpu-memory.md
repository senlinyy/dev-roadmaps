---
title: "CPU & Memory"
description: "Diagnose CPU saturation, memory pressure, and swap thrashing using load average, vmstat, mpstat, free, and /proc."
overview: "Diagnose a slow Linux API VM by reading CPU, load average, memory, swap, and per-process signals with practical command-line checks."
tags: ["cpu", "memory", "load", "vmstat"]
order: 3
id: article-devops-foundation-linux-system-admin-cpu-memory
---

## Table of Contents

1. [The Slow API Problem](#the-slow-api-problem)
2. [How Linux Accounts for CPU Time](#how-linux-accounts-for-cpu-time)
3. [Load Average and Runnable Work](#load-average-and-runnable-work)
4. [Memory: Used, Free, and Available](#memory-used-free-and-available)
5. [Page Cache, Buffers, and Slab](#page-cache-buffers-and-slab)
6. [Swap and Memory Pressure](#swap-and-memory-pressure)
7. [`vmstat` as the First Triage Tool](#vmstat-as-the-first-triage-tool)
8. [Per-Process Memory and the OOM Killer](#per-process-memory-and-the-oom-killer)
9. [A Practical CPU and Memory Runbook](#a-practical-cpu-and-memory-runbook)
10. [References](#references)

## The Slow API Problem
<!-- section-summary: CPU and memory checks start with a user symptom, then separate busy CPU from memory pressure and waiting on I/O. -->

The alert says `https://api.example.com/health` is slow. Nginx is still answering, but requests to the `inventory-api` take several seconds. At this point, "the server is slow" is too vague. The VM may be out of CPU, short on memory, swapping, waiting on disk, or blocked on another dependency.

CPU and memory triage gives you the first split. If CPU is saturated, you look for a hot process or expensive request path. If memory is under pressure, you look for growth, leaks, cache behavior, and OOM kills. If both look calm, the next article's disk and I/O checks may be the better path.

The tools here are intentionally basic: `uptime`, `top`, `free`, `vmstat`, `ps`, `journalctl`, and `/proc`. They work over SSH on a small VM and give enough signal to decide what to do next.

## How Linux Accounts for CPU Time
<!-- section-summary: CPU time is split into categories such as user, system, idle, wait, steal, and interrupt handling. -->

CPU usage is time accounting. Linux tracks how CPU time is spent across categories. The labels vary by tool, but the core categories are consistent.

| Category | Meaning | Operational hint |
|---|---|---|
| `us` | User-space application code | API code, Node runtime, compression, JSON work |
| `sy` | Kernel work | Networking, filesystem, process management |
| `id` | Idle time | CPU has room |
| `wa` | I/O wait | Tasks are waiting on disk or network-backed storage |
| `st` | Steal time | Hypervisor time taken away on a virtual machine |
| `hi` / `si` | Hardware and software interrupts | Network or device interrupt handling |

`top` shows these categories in the CPU line:

```bash
$ top
%Cpu(s): 82.0 us,  6.0 sy,  0.0 ni,  9.0 id,  2.0 wa,  0.0 hi,  1.0 si,  0.0 st
```

This example mostly points at user-space work. The API process may be doing expensive application work. If `wa` were high, disk or storage latency would deserve attention. If `st` were high on a cloud VM, the host may be overcommitted or the instance class may be noisy.

Per-process CPU shows who is spending time:

```bash
$ ps -eo pid,user,%cpu,%mem,etime,cmd --sort=-%cpu | head
```

If `inventory-api` sits at 190% CPU on a two-vCPU VM, it is using almost two full cores. If Nginx workers dominate, the problem may be TLS, buffering, request volume, or bot traffic. If a backup process dominates, lower its priority or move it out of the peak window.

## Load Average and Runnable Work
<!-- section-summary: Load average counts tasks running or waiting to run, and on Linux it also includes uninterruptible I/O waits. -->

**Load average** is a rolling measure of work waiting for CPU or stuck in certain uninterruptible waits. `uptime` shows one-minute, five-minute, and fifteen-minute averages:

```bash
$ uptime
09:30:12 up 14 days,  3:21,  2 users,  load average: 3.80, 2.40, 1.10
```

The number needs CPU context. On a one-vCPU VM, load `3.80` means a queue is forming. On an eight-vCPU VM, load `3.80` may be comfortable. Check CPU count:

```bash
$ nproc
2
```

For a two-vCPU VM, a sustained load above `2` means more runnable or waiting work exists than CPU slots. A short spike may be fine. A rising one-minute number followed by rising five-minute and fifteen-minute numbers means the condition is lasting.

Load can rise because CPU is busy, but Linux load also includes tasks in uninterruptible sleep, often shown as `D` state in `ps`. That means high load with low CPU can point toward disk or network storage waits:

```bash
$ ps -eo state,pid,user,cmd | awk '$1 ~ /D/ {print}'
```

This is the transition to careful diagnosis. High load plus high `us` CPU points toward application work. High load plus high `wa` or `D` state points toward I/O. High load plus memory pressure and swap activity points toward RAM pressure.

## Memory: Used, Free, and Available
<!-- section-summary: `free` shows total memory, used memory, reclaimable cache, and the more useful available estimate. -->

Memory output can confuse beginners because Linux uses spare RAM for cache. That is healthy behavior. Unused RAM does not help performance, so Linux keeps recently read file data in memory and releases it when applications need space.

`free -h` shows the main view:

```bash
$ free -h
               total        used        free      shared  buff/cache   available
Mem:           3.8Gi       2.1Gi       260Mi       110Mi       1.4Gi       1.3Gi
Swap:          2.0Gi       120Mi       1.9Gi
```

The `free` column may be small while the system is still healthy. The `available` column estimates how much memory can be given to applications without heavy swapping. In this example, `1.3Gi` available memory means the VM has room even though only `260Mi` is completely unused.

The process view connects memory to services:

```bash
$ ps -eo pid,user,%mem,rss,vsz,cmd --sort=-rss | head
```

`RSS` is resident set size, the memory physically in RAM for that process. `VSZ` is virtual memory size, which includes address space the process may not be actively using. For day-to-day triage, RSS is usually the more useful first number.

If `inventory-api` grows from `250MiB` RSS to `1.8GiB` over several hours with similar traffic, suspect a memory leak or unbounded cache. If memory is stable but `available` shrinks during a batch job, the job may be the immediate pressure source.

## Page Cache, Buffers, and Slab
<!-- section-summary: Linux uses memory for filesystem cache and kernel data structures, and much of it can be reclaimed under pressure. -->

The **page cache** stores file contents in memory after they are read from disk. If Nginx serves static files, or the API reads local templates or data files, repeated reads can come from RAM instead of storage. This improves performance and explains why memory appears "used" after normal activity.

Buffers hold block device metadata. Slab memory holds kernel objects such as dentries, inodes, and network structures. You can see more detail in `/proc/meminfo`:

```bash
$ grep -E 'MemTotal|MemAvailable|Buffers|Cached|Slab|SReclaimable|SUnreclaim' /proc/meminfo
MemTotal:        3995488 kB
MemAvailable:   1374280 kB
Buffers:           84212 kB
Cached:          1092232 kB
Slab:             238540 kB
SReclaimable:     151304 kB
SUnreclaim:        87236 kB
```

`SReclaimable` is slab memory the kernel can reclaim when needed. `SUnreclaim` is slab memory with a more constrained reclaim path. Large unreclaimable slab growth can point to kernel or driver pressure. Most API VM issues still come from application RSS, page cache behavior, or swap.

Avoid clearing caches as a routine fix. Commands that drop caches can make graphs look better for a moment while hurting performance by forcing the system to reread data from disk. The better question is whether applications have enough available memory under normal traffic.

## Swap and Memory Pressure
<!-- section-summary: Swap can absorb temporary pressure, but active swapping during requests usually means the VM lacks enough RAM for the workload. -->

**Swap** is disk-backed space Linux can use when RAM is under pressure. It can help the system survive short spikes, but active swapping is much slower than RAM. On a latency-sensitive API, heavy swap activity can turn normal requests into slow requests.

The `free` output shows how much swap is used, but used swap alone is not enough. A VM can have old pages in swap and still run fine. The important signal is current swap activity.

`vmstat` shows swap-in and swap-out rates:

```bash
$ vmstat 5
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
 3  0 122880 260000  84000 1092000  0    0    12    40 1200 2100 78  7 15  0  0
 4  1 180224 120000  74000  810000 64  128  420  900 1800 2800 65 10 18  7  0
```

`si` means swap in, and `so` means swap out. Sustained nonzero values during API traffic point to memory pressure. The `b` column shows blocked processes, and `wa` shows I/O wait. Together they can explain slow requests caused by memory pressure turning into disk pressure.

When swap activity appears, check the top RSS processes, recent deployments, traffic changes, and OOM events. Adding RAM may be the right infrastructure fix, but application memory growth should still be understood.

## `vmstat` as the First Triage Tool
<!-- section-summary: `vmstat 5` gives a compact five-second view of runnable tasks, memory, swap, I/O, interrupts, context switches, and CPU categories. -->

`vmstat 5` prints one line every five seconds. The first line is an average since boot, so focus on the later lines.

```bash
$ vmstat 5
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
 1  0  122880 340000 88000 1200000  0    0     8    35 1100 1900 22  5 72  1  0
 6  0  122880 310000 87000 1190000  0    0    10    50 2400 4200 91  6  3  0  0
```

Important columns:

| Column | Meaning |
|---|---|
| `r` | Runnable tasks waiting for CPU |
| `b` | Tasks blocked, often on I/O |
| `si` / `so` | Swap in and swap out |
| `bi` / `bo` | Blocks read from and written to disk |
| `us` / `sy` | User and kernel CPU time |
| `id` | Idle CPU |
| `wa` | I/O wait |
| `st` | Steal time on a VM |

In the second sample line, `r` is `6` on a small VM, `us` is `91`, and idle is `3`. That points toward CPU saturation in user-space code. A different line with high `b` and high `wa` would point toward disk or storage waits. A line with nonzero `si` and `so` points toward active swapping.

This is why `vmstat` is a good first command. It separates the main paths quickly so the next check has a direction.

## Per-Process Memory and the OOM Killer
<!-- section-summary: Per-process RSS and kernel OOM logs reveal which process consumed memory and whether Linux killed one to recover. -->

When memory runs out, Linux may invoke the **OOM killer**. OOM means out of memory. The kernel chooses a process to kill so the system can keep running. From the service view, it may look like the API simply crashed.

Check kernel logs:

```bash
$ journalctl -k --since "1 hour ago" | grep -i "out of memory"
$ journalctl -k --since "1 hour ago" | grep -i "killed process"
```

If systemd recorded the signal, service logs may also help:

```bash
$ journalctl -u inventory-api --since "1 hour ago" --no-pager
```

Per-process memory gives the current state:

```bash
$ ps -eo pid,user,rss,%mem,cmd --sort=-rss | head
```

For deeper process detail:

```bash
$ pid=$(systemctl show -p MainPID --value inventory-api)
$ grep -E 'VmRSS|VmSize|Threads|State' "/proc/${pid}/status"
```

If the API gets OOM-killed after every deployment, compare the release version, request pattern, and memory limit in the systemd unit. If another process causes memory pressure, such as a backup, report export, or build step, move that work off the production VM or run it with clear limits.

## A Practical CPU and Memory Runbook
<!-- section-summary: A repeatable runbook starts with symptom confirmation, then checks load, CPU categories, memory availability, swap activity, and process ownership. -->

A beginner-friendly triage flow for the slow API can be short:

```bash
$ curl -w '\n%{time_total}s\n' -o /dev/null -s https://api.example.com/health
$ uptime
$ nproc
$ vmstat 5
$ free -h
$ ps -eo pid,user,%cpu,%mem,rss,etime,cmd --sort=-%cpu | head
$ ps -eo pid,user,%cpu,%mem,rss,etime,cmd --sort=-rss | head
$ journalctl -u inventory-api --since "30 minutes ago" --no-pager | tail -100
$ journalctl -k --since "30 minutes ago" --no-pager | grep -Ei "oom|killed process|out of memory"
```

Read the results as a story. High CPU with the API at the top points to application work. High load with high I/O wait points to storage. Low available memory plus active swap points to memory pressure. OOM messages explain sudden restarts. A non-API process at the top may be a maintenance job competing with production traffic.

The immediate action depends on that story. You might roll back a release, restart a leaking service, stop a runaway report job, increase VM size, add swap as a temporary safety net, or move background work elsewhere. The important habit is measuring first so the fix matches the pressure.

## References

- [Linux `proc(5)` manual](https://man7.org/linux/man-pages/man5/proc.5.html) - Documents `/proc/meminfo`, `/proc/loadavg`, and process status files.
- [Linux `top(1)` manual](https://man7.org/linux/man-pages/man1/top.1.html) - Documents live CPU and memory process display.
- [Linux `free(1)` manual](https://man7.org/linux/man-pages/man1/free.1.html) - Documents memory reporting and the available column.
- [Linux `vmstat(8)` manual](https://man7.org/linux/man-pages/man8/vmstat.8.html) - Documents virtual memory statistics.
- [Linux `ps(1)` manual](https://man7.org/linux/man-pages/man1/ps.1.html) - Documents process snapshot fields.
- [systemd resource control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html) - Documents systemd CPU and memory resource controls.
