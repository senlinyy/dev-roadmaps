---
title: "CPU & Memory"
description: "Diagnose CPU saturation, memory pressure, and swap thrashing using load average, vmstat, mpstat, free, and /proc."
overview: "Diagnose CPU saturation, memory pressure, swap activity, and per-process resource use on a Linux system with practical command-line checks."
tags: ["cpu", "memory", "load", "vmstat"]
order: 3
id: article-devops-foundation-linux-system-admin-cpu-memory
---

## Table of Contents

1. [What Does a CPU and Memory Investigation Measure?](#what-does-a-cpu-and-memory-investigation-measure)
2. [How Does Linux Account for CPU Time?](#how-does-linux-account-for-cpu-time)
3. [What Does Load Average Count?](#what-does-load-average-count)
4. [How Should You Read Free and Available Memory?](#how-should-you-read-free-and-available-memory)
5. [Why Does Linux Use RAM for Cache and Kernel Data?](#why-does-linux-use-ram-for-cache-and-kernel-data)
6. [When Do Swap and Memory Pressure Become Problems?](#when-do-swap-and-memory-pressure-become-problems)
7. [How Does vmstat Connect CPU, Memory, and I/O?](#how-does-vmstat-connect-cpu-memory-and-io)
8. [Which Processes Use Resources and How Do You Respond?](#which-processes-use-resources-and-how-do-you-respond)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A CPU and memory investigation often starts with a messy report: the web page is slow, SSH takes longer than usual, and a deploy command times out halfway through. The temptation is to restart the service first. A calmer first move is to ask what the server is waiting for.

CPU pressure means the machine has more work ready to run than its CPUs can clear quickly. Memory pressure means applications, the kernel, and filesystem cache are all competing for RAM. For example, a report export may use two full CPU cores, while a separate Node process slowly grows until Linux starts swapping. Both incidents feel like "the server is slow", yet the fixes are different.

The first-pass tools are intentionally ordinary: `uptime`, `top`, `nproc`, `free`, `vmstat`, `ps`, `journalctl`, and files under `/proc`. Use them in a steady order. Confirm whether the host has a backlog, compare that backlog with CPU count, check whether memory is truly available after Linux cache is counted, look for swap movement, then connect the pressure to a process or a kernel event.

Keep these questions in view as you work through the lesson:

1. **What Does a CPU and Memory Investigation Measure?**
2. **How Does Linux Account for CPU Time?**
3. **What Does Load Average Count?**
4. **How Should You Read Free and Available Memory?**
5. **Why Does Linux Use RAM for Cache and Kernel Data?**
6. **When Do Swap and Memory Pressure Become Problems?**
7. **How Does `vmstat` Connect CPU, Memory, and I/O?**
8. **Which Processes Use Resources and How Do You Respond?**

## What Does a CPU and Memory Investigation Measure?
<!-- section-summary: CPU and memory checks separate busy CPU, memory pressure, swap activity, and waiting on I/O. -->

![CPU and memory triage runbook infographic showing top, load versus cores, free available memory, vmstat pressure, process memory, and OOM logs](/content-assets/articles/article-devops-foundation-linux-system-admin-cpu-memory/cpu-memory-triage-runbook.png)

_The image gives the CPU and memory investigation a concrete order from broad signals to the noisy process._

## How Does Linux Account for CPU Time?
<!-- section-summary: CPU time is split into categories such as user, system, idle, wait, steal, and interrupt handling. -->

A familiar CPU incident starts with one vague number on a graph: CPU is high. That number says the CPUs spent a lot of the sample doing work, yet it does not say whose work it was. Before blaming the application, ask Linux how it divided the time.

The first bucket is **user time**. This is time spent running code outside the kernel: your application, a language runtime, compression, encryption, report generation, or query processing. For example, a Node service doing JSON serialization and a `tar -czf` backup both spend most of their CPU time in user space.

The next bucket is **system time**. This is CPU time the kernel spends on behalf of processes. Heavy networking, filesystem metadata work, process creation, and many small syscalls can raise system time. A server with high system time may need a networking, filesystem, or process-churn investigation instead of only an application profiling session.

Other buckets explain slow servers that do not fit the simple "app used CPU" story. **I/O wait** means tasks were waiting on storage, so the CPU had no runnable work for that moment. **Steal time** appears on virtual machines when the hypervisor gave CPU time to another guest instead of this VM. **Idle time** is spare room in the sample.

Under the hood, the scheduler hands small turns to runnable tasks on each CPU. The CPU line in `top` summarizes where those turns went during the sample window. That is why the line matters: it tells you whether the machine spent its time running app code, kernel work, waiting on I/O, sitting idle, or losing time to the VM host.

`top` gives a live view of both the whole machine and individual processes:

```bash
top

# Example output:
# top - 10:42:15 up 14 days,  3:22,  1 user,  load average: 1.84, 1.62, 1.20
# Tasks: 128 total,   2 running, 126 sleeping,   0 stopped,   0 zombie
# %Cpu(s): 82.0 us,  6.0 sy,  0.0 ni,  9.0 id,  2.0 wa,  0.0 hi,  1.0 si,  0.0 st
# MiB Mem :   3901.0 total,    260.0 free,   2140.0 used,   1501.0 buff/cache
# MiB Swap:   2048.0 total,   1928.0 free,    120.0 used.   1320.0 avail Mem
```

Use the CPU line like a short story of the last sample:

- `us` is user-space CPU time. High `us` usually points to application code, runtime work, compression, encryption, or data processing.
- `sy` is kernel CPU time. High `sy` can appear with heavy networking, filesystem work, or process churn.
- `id` is idle CPU. Low `id` means the CPUs have little free room.
- `wa` is I/O wait. High `wa` points toward storage or network-backed disk waits.
- `st` is steal time. High `st` on a cloud VM means the hypervisor is taking CPU time away from this guest.

The process list tells you who is using the time:

```bash
ps -eo pid,user,%cpu,%mem,etime,cmd --sort=-%cpu | head

# Example output:
#     PID USER     %CPU %MEM     ELAPSED CMD
#    1842 app     187.4 18.6    03:14:22 /usr/bin/node /srv/app/current/server.js
#     913 www-data 12.3  1.1    14-03:12 nginx: worker process
#    2409 root      6.8  0.4       12:01 /usr/bin/tar -czf /var/backups/app.tgz /srv/app
```

Here `app` is using almost two full CPU cores because `%CPU` can add work across multiple cores. `ETIME` helps you separate a long-running service from a short maintenance command. If the backup command appears near the top during user traffic, the practical fix may be moving, scheduling, or throttling that job before changing application code.

The next decision comes from the largest CPU bucket. High `us` with one application at the top points to code, queries, compression, encryption, or a traffic spike. High `sy` points toward kernel-heavy work such as networking, filesystem churn, or too many short-lived processes. High `wa` moves the investigation toward disk or network storage. High `st` on a VM is a cloud capacity signal, so compare it with provider metrics or move the workload to a less contested host class.

## What Does Load Average Count?
<!-- section-summary: Load average counts tasks running or waiting to run, and on Linux it also includes uninterruptible I/O waits. -->

A server can feel stuck even when one CPU graph does not explain it. SSH accepts your login, then every command pauses. Health checks time out. The shell prompt returns slowly. In that situation, check whether Linux has a backlog of work.

Load average is a small queue signal. It counts tasks running now, tasks waiting for CPU, and on Linux, tasks stuck in uninterruptible waits. Those uninterruptible waits often involve disk or network storage. For example, a two-vCPU VM with a load average near `8` may have too many CPU-hungry workers, many processes stuck on disk, or both.

CPU usage alone does not show all waiting work. A two-vCPU machine can show busy CPUs while several more tasks wait their turn. Load average gives a short history of that backlog over one, five, and fifteen minutes, so you can tell a quick burst from a sustained problem.

The simple reading is this: compare load with CPU count. If the queue usually sits near the CPU count, the machine is busy. If it stays far above the CPU count, work is waiting. Then check CPU, I/O, and swap because Linux load can rise from runnable CPU work or from tasks blocked in storage waits.

Check the load average:

```bash
uptime

# Example output:
#  10:42:15 up 14 days,  3:22,  1 user,  load average: 3.80, 2.40, 1.10
```

The three numbers are rolling averages over one, five, and fifteen minutes:

- `3.80` says the recent one-minute backlog is high.
- `2.40` says the five-minute window has also been busy.
- `1.10` says the fifteen-minute window was calmer, so the pressure may be recent.

Now compare that load with the number of CPU slots:

```bash
nproc

# Example output:
# 2
```

On a two-vCPU VM, sustained load above `2` means more work exists than there are CPU slots. The sample load of `3.80` is high for this VM. On an eight-vCPU VM, the same load would usually be less urgent.

High load with low CPU usage can point to blocked work. Look for processes in `D` state:

```bash
ps -eo state,pid,user,cmd | awk '$1 ~ /D/ {print}'

# Example output:
# D  2518 app      /usr/bin/python3 /srv/app/jobs/export_report.py
# D  2520 app      /usr/bin/python3 /srv/app/jobs/export_report.py
```

`D` means uninterruptible sleep. In practice, the process is often waiting on disk or network storage. High load plus high `us` CPU points toward CPU work. High load plus `D` state or high `wa` points toward I/O. High load plus active swap movement points toward memory pressure.

The next decision is to split the queue. If `r` in `vmstat` is high and CPU idle is low, reduce CPU work, throttle a job, or add CPU capacity. If `D`, `b`, or `wa` is high, switch to disk and storage checks. If swap is moving at the same time, treat the load as a memory-pressure symptom.

## How Should You Read Free and Available Memory?
<!-- section-summary: `free` shows total memory, used memory, reclaimable cache, and the more useful available estimate. -->

The first time `free -h` shows only `260Mi` free on a 4 GiB VM, it can look like the server is almost out of memory. Linux is usually doing something useful there: it keeps recently used files in RAM so later reads can skip the disk. The scary column is not always the most useful column.

The plain idea is that "used" memory includes application memory and useful kernel cache. Empty RAM does not make the app faster. Cache often does. For example, if Nginx reads the same static file many times, Linux can keep that file data in memory and serve later reads faster.

Use `free -h` for the first memory view:

```bash
free -h

# Example output:
#                total        used        free      shared  buff/cache   available
# Mem:           3.8Gi       2.1Gi       260Mi       110Mi       1.4Gi       1.3Gi
# Swap:          2.0Gi       120Mi       1.9Gi
```

The beginner column to trust first is `available`. The `free` column is memory doing absolutely nothing. The `available` column estimates how much memory Linux can hand to applications without heavy swapping. In this example, `260Mi` free may look scary, but `1.3Gi` available means the VM still has usable room.

Next, connect memory use to processes:

```bash
ps -eo pid,user,%mem,rss,vsz,cmd --sort=-rss | head

# Example output:
#     PID USER     %MEM     RSS      VSZ CMD
#    1842 app      18.6  742312  1840420 /usr/bin/node /srv/app/current/server.js
#     913 www-data  1.1   45224   151248 nginx: worker process
#    2409 root       0.4   17296    65044 /usr/bin/tar -czf /var/backups/app.tgz /srv/app
```

`RSS` is resident set size, which means memory currently held in RAM for the process. `VSZ` is virtual memory size, which includes address space the process may not actively use. For first-pass triage, RSS usually tells the clearer story.

If the same service grows from `250MiB` RSS to `1.8GiB` RSS over a few hours with similar traffic, investigate memory growth in the application. If the largest process is a maintenance job, the service may be affected by host pressure caused by that job.

## Why Does Linux Use RAM for Cache and Kernel Data?
<!-- section-summary: Linux uses memory for filesystem cache and kernel data structures, and much of it can be reclaimed under pressure. -->

A common memory scare happens after `free -h` shows a tiny `free` value while the service still responds normally. A better question is whether Linux can give enough of that memory back to applications during pressure.

The first piece is the **page cache**. When a process reads files from disk, Linux can keep those file pages in RAM. Later reads of the same files can come from memory instead of waiting on storage again. For example, a package repository mirror or web server may hold a lot of cached file data after normal traffic.

The next piece is **buffers**. Buffers help with block-device bookkeeping while Linux works with storage. They are usually much smaller than page cache on many application servers, yet they still appear in memory reports and should not surprise you.

The last piece here is **slab memory**. The kernel keeps frequently used objects in slab caches, such as dentries, inodes, and networking structures. If a server has touched millions of files, the kernel may hold many directory and inode objects. Some slab memory is reclaimable under pressure, and some has to stay until the kernel no longer needs those objects.

For more detail than `free`, inspect `/proc/meminfo`:

```bash
grep -E 'MemTotal|MemAvailable|Buffers|Cached|Slab|SReclaimable|SUnreclaim' /proc/meminfo

# Example output:
# MemTotal:        3995488 kB
# MemAvailable:   1374280 kB
# Buffers:           84212 kB
# Cached:          1092232 kB
# Slab:             238540 kB
# SReclaimable:     151304 kB
# SUnreclaim:        87236 kB
```

Map the fields back to the earlier idea:

- `MemAvailable` should match the general idea from `free -h`.
- `Cached` is file data Linux can often reclaim.
- `SReclaimable` is kernel slab memory that can be reclaimed under pressure.
- `SUnreclaim` is slab memory with a more constrained reclaim path.

Avoid clearing caches as a routine fix. Dropping caches can make a graph look better for a moment while forcing the server to reread useful data from disk. The better operational question is whether applications have enough available memory during normal traffic.

In production, high cache with healthy `MemAvailable` is usually good. High `SUnreclaim` that keeps growing, low `MemAvailable`, and rising latency deserve a deeper look because kernel memory can squeeze applications too. The next decision is to compare memory over time: stable cache is normal, falling availability with growing application RSS or unreclaimable slab needs investigation.

## When Do Swap and Memory Pressure Become Problems?
<!-- section-summary: Swap can absorb temporary pressure, but active swapping during requests usually means the VM lacks enough RAM for the workload. -->

A memory-pressure incident often feels strange: CPU has some idle room, the service has not crashed, yet requests crawl. Disk I/O rises because Linux is moving memory pages between RAM and swap. The first trap is to look at one `Swap: used` number and decide the machine is either doomed or fine.

Swap is disk-backed space Linux can use when RAM is tight. It can help the machine survive a short spike. Active swapping during live requests is much slower than RAM, so a service can appear slow because Linux is reading and writing memory pages on disk.

The `free` output shows how much swap is allocated, but used swap alone is not enough. A machine may have old, cold pages sitting in swap and still run fine. Current swap movement is the signal to watch.

Under the hood, Linux moves memory in pages. A page that has not been used recently may move from RAM to swap so RAM can serve hotter work. Later, if the process touches that page again, Linux has to read it back from swap. That back-and-forth turns a memory shortage into slow disk I/O.

Use `vmstat` to sample every five seconds:

```bash
vmstat 5 3

# Example output:
# procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
#  r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
#  3  0 122880 260000  84000 1092000  0    0    12    40 1200 2100 78  7 15  0  0
#  4  1 180224 120000  74000  810000 64  128  420  900 1800 2800 65 10 18  7  0
#  5  1 196608  90000  73000  760000 80  160  510 1100 1900 3100 61 11 16 12  0
```

Focus on the later sample lines, not only the first line. Important beginner signals:

- `si` means swap in. Linux is reading pages back from swap into RAM.
- `so` means swap out. Linux is writing pages from RAM to swap.
- Sustained nonzero `si` and `so` during live traffic point to memory pressure.
- `b` shows blocked tasks, and `wa` shows I/O wait. These can rise because swapping turns memory pressure into disk pressure.

When swap activity appears, check top RSS processes, recent deployments, scheduled jobs, traffic changes, and OOM messages. Adding RAM may be the infrastructure fix, but a growing process still needs investigation.

The practical next decision is about current movement as well as allocation. A nonzero `swpd` value with zero `si` and `so` usually means old swapped pages are sitting quietly. Nonzero `si` and `so` during slow requests point to active swapping. At that point, reduce memory use, stop the competing job, restart a leaking service after collecting evidence, or add RAM. Swap can buy time, and normal request traffic should stay mostly in RAM.

![Memory pressure map infographic showing available memory, page cache, swap traffic, reclaim, and OOM risk](/content-assets/articles/article-devops-foundation-linux-system-admin-cpu-memory/memory-pressure-map.png)

_The image shows how memory pressure appears before the machine reaches an out-of-memory event._

## How Does `vmstat` Connect CPU, Memory, and I/O?
<!-- section-summary: `vmstat 5` gives a compact five-second view of runnable tasks, memory, swap, I/O, interrupts, context switches, and CPU categories. -->

A slow server often gives overlapping clues. Load is high, memory looks tight, and users report timeouts. If you check one command at a time with long gaps between commands, the samples may describe different moments.

`vmstat` helps because one sampled table puts the main clues beside each other. It shows runnable CPU work, blocked work, memory, swap movement, disk reads and writes, interrupts, context switches, and CPU time categories in the same five-second window. For example, a line with high `r`, low `id`, and zero `wa` points to CPU. A line with high `b`, high `wa`, and disk reads points to I/O waiting.

Run it with a repeat interval and a count:

```bash
vmstat 5 3

# Example output:
# procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
#  r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
#  1  0 122880 340000  88000 1200000  0    0     8    35 1100 1900 22  5 72  1  0
#  6  0 122880 310000  87000 1190000  0    0    10    50 2400 4200 91  6  3  0  0
#  7  0 122880 300000  87000 1185000  0    0    12    55 2500 4300 92  5  3  0  0
```

The most useful columns are:

| Column | Meaning |
|---|---|
| `r` | Runnable tasks waiting for CPU |
| `b` | Tasks blocked, often on I/O |
| `swpd` | Memory currently placed in swap |
| `free` | Completely unused memory |
| `buff` / `cache` | Buffer and page-cache memory |
| `si` / `so` | Swap in and swap out |
| `bi` / `bo` | Blocks read from and written to disk |
| `in` / `cs` | Interrupts and context switches |
| `us` / `sy` | User and kernel CPU time |
| `id` | Idle CPU |
| `wa` | I/O wait |
| `st` | Steal time on a VM |

The first data line can include averages since boot, so the later lines are usually more useful for a live issue. In the sample, the second and third lines show `r` at `6` and `7`, `us` above `90`, and `id` at `3`. On a small VM, that points to CPU saturation from user-space work. A different sample with high `b` and high `wa` would point toward storage waits. A sample with nonzero `si` and `so` would point toward active swapping.

The next decision is the branch: high `r` plus low `id` means CPU, high `b` plus high `wa` means I/O, nonzero `si` and `so` means memory pressure, and high `st` means the VM lost CPU time to the host. Then pick the article or runbook that matches that branch.

## Which Processes Use Resources and How Do You Respond?
<!-- section-summary: Per-process RSS and kernel OOM logs reveal which process consumed memory and whether Linux killed one to recover. -->

A service can vanish in the middle of traffic with no application stack trace. The restart counter increments, users see a short outage, and the app log ends without a graceful shutdown message. When the application cannot explain its own death, check whether the kernel killed it to recover memory.

OOM means out of memory. When the system cannot reclaim enough memory, the Linux kernel may kill a process so the machine can keep running. For example, a Node service may be killed at `10:18:31`, and systemd may restart it five seconds later. From the service side, that looks like a sudden crash.

The OOM killer is a last-resort safety valve. If the kernel cannot free enough memory through cache reclaim, compaction, or swap, the whole machine can stall. Killing one process can free memory so PID `1`, SSH, and other services have a chance to keep running.

Under the hood, the kernel scores processes and chooses a victim based on memory use and OOM adjustment settings. A large process often has a higher score, while protected services can set lower scores. The selection gives you the process that freed memory at that moment. The root cause still needs follow-up evidence.

Check the kernel journal for OOM evidence:

```bash
journalctl -k --since "1 hour ago" --no-pager | grep -Ei "out of memory|killed process|oom"

# Example output:
# Jun 24 10:18:31 web-01 kernel: Out of memory: Killed process 1842 (node) total-vm:1840420kB, anon-rss:742312kB, file-rss:0kB, shmem-rss:0kB
# Jun 24 10:18:31 web-01 kernel: oom_reaper: reaped process 1842 (node), now anon-rss:0kB
```

The useful pieces are the PID, command name, and resident memory. In the sample, Linux killed PID `1842`, the command was `node`, and `anon-rss` shows a large amount of anonymous process memory. That is evidence, not the full root cause. You still need to ask why that process held so much memory.

Now check the service journal around the same time:

```bash
journalctl -u app.service --since "1 hour ago" --no-pager | tail -20

# Example output:
# Jun 24 10:18:31 web-01 systemd[1]: app.service: Main process exited, code=killed, status=9/KILL
# Jun 24 10:18:31 web-01 systemd[1]: app.service: Failed with result 'signal'.
# Jun 24 10:18:36 web-01 systemd[1]: app.service: Scheduled restart job, restart counter is at 1.
# Jun 24 10:18:36 web-01 systemd[1]: Started app.service - Application service.
```

This connects the kernel event to the service lifecycle. The kernel killed PID `1842`, and systemd restarted the service because the unit policy allowed it.

For the current process, ask systemd for the main PID and inspect `/proc`:

```bash
pid=$(systemctl show -p MainPID --value app.service)
grep -E 'Name|State|VmRSS|VmSize|Threads' "/proc/${pid}/status"

# Example output:
# Name:   node
# State:  S (sleeping)
# VmSize:  1218400 kB
# VmRSS:    286420 kB
# Threads:      18
```

`VmRSS` should roughly match the RSS value from `ps`. `Threads` helps spot thread growth. `State` confirms whether the process is running, sleeping, or stuck. If the process keeps growing after each restart, investigate the application path that allocates memory. If another job caused the pressure, move that job away from peak traffic or run it with clear resource limits.

The next decision is evidence before action. If the killed process is the main service and RSS had been climbing, capture logs and memory graphs before restarting repeatedly. If the killed process is a backup, export, or build job, move it out of peak traffic, add a systemd memory guardrail, or run it on a separate worker host.

### How Does a Practical CPU and Memory Runbook Work?
<!-- section-summary: A repeatable runbook confirms the symptom, then checks load, CPU categories, memory availability, swap activity, and process ownership. -->

A realistic CPU and memory incident might arrive as a page that says the checkout endpoint has been slow for fifteen minutes. The service is still up, so collect enough evidence before restarting anything. The runbook has a simple rhythm: confirm the user-facing symptom, check whether the host is overloaded, then connect the pressure to a process or kernel event.

The first decision is whether users are seeing real latency right now. The `curl` line measures one request and prints total time. After that, `uptime` and `nproc` tell you whether the load is high for this machine's CPU count.

The second decision is which resource branch owns the pressure. `vmstat 5 3` samples CPU, blocked tasks, swap, and I/O together. Then `free -h` explains whether memory is truly available after Linux cache is accounted for.

The third decision is ownership. The two `ps` commands show top CPU consumers and top resident-memory consumers. The service and kernel journals tell you whether the process restarted, hit an application error, or was killed by the kernel.

```bash
curl -w '\n%{time_total}s\n' -o /dev/null -s https://example.com/health
uptime
nproc
vmstat 5 3
free -h
ps -eo pid,user,%cpu,%mem,rss,etime,cmd --sort=-%cpu | head
ps -eo pid,user,%cpu,%mem,rss,etime,cmd --sort=-rss | head
journalctl -u app.service --since "30 minutes ago" --no-pager | tail -100
journalctl -k --since "30 minutes ago" --no-pager | grep -Ei "oom|killed process|out of memory"
```

Each command narrows the story:

- `curl -w` confirms the user-facing symptom and prints total request time.
- `uptime` and `nproc` compare load average with CPU count.
- `vmstat 5 3` separates runnable CPU work, blocked work, swap activity, I/O wait, and steal time.
- `free -h` shows memory availability after Linux cache is accounted for.
- The first `ps` command finds top CPU consumers, while the second finds top resident-memory consumers.
- The service journal shows application errors and restarts near the slowdown.
- The kernel journal confirms OOM kills and memory-pressure events.

Treat the output as one timeline. High CPU with the service at the top points to application work. High load with high I/O wait points to storage. Low available memory plus active swap points to memory pressure. OOM messages explain sudden restarts. A maintenance job near the top may be competing with production traffic.

The immediate action should match the evidence. You might roll back a release, restart a leaking service, stop a runaway report job, increase VM size, add swap as a temporary safety net, or move background work elsewhere. The habit to keep is simple: measure first, then choose the fix that matches the pressure.

### How Do CPU Capacity, Queues, and Time Series Fit Together?

CPU capacity is the number of processor time slices available during an interval. On a four-CPU machine, four CPU-bound threads can run at once; a fifth runnable thread waits for a turn. `nproc` gives the CPU count visible to the current environment, which may differ from the physical host when a container or cgroup limits the workload.

One process can therefore report more than `100%` CPU. Many Linux tools use one logical CPU as `100%`, so a multithreaded process doing work on two logical CPUs can appear near `200%`. Always compare process CPU with the visible CPU count and the sampling convention of the tool.

Load average is not a CPU percentage. It is a smoothed count of tasks that are runnable plus certain tasks in uninterruptible sleep, commonly blocked on I/O. The three values cover roughly one, five, and fifteen minutes. A load of `8` can mean heavy contention on a two-CPU VM, comfortable parallel work on a thirty-two-CPU server, or blocked storage work on a mostly idle CPU. The number becomes useful only beside CPU count, CPU categories, and task states.

Three patterns illustrate the distinction:

- High load, low idle CPU, many runnable tasks, and high user time indicate CPU contention.
- High load, substantial idle CPU, blocked tasks, and high I/O wait indicate work stalled below the CPU.
- Low load with one slow request may indicate a local lock, dependency delay, or tail-latency problem that a machine average hides.

Queueing becomes nonlinear near saturation. At low utilization, new work usually gets a CPU quickly. Near full capacity, a small increase in arrivals can create a much longer runnable queue because there is little spare service time to drain bursts. This is why a host that looks acceptable at an average of `70%` can still have painful latency during short peaks. Inspect time series, percentiles, and repeated samples instead of trusting one average.

Context switches are part of the cost. The scheduler saves one task's state and restores another's so multiple processes and threads can share CPUs. Context switching is necessary, but an excessive runnable population can spend more time switching, invalidating caches, and coordinating than doing useful work. Adding threads beyond the available parallel work can reduce throughput instead of increasing it.

`nice` changes relative scheduling preference among contending ordinary tasks. It does not create CPU capacity or impose a precise percentage limit. A nice value matters little while CPUs are idle; task contention is what makes it relevant. Use cgroup or systemd CPU controls when a workload needs an explicit share or quota, and validate the user-facing effect rather than assuming a nicer number solved saturation.

Virtual machines add steal time. `st` means the guest had runnable work but the hypervisor scheduled something else on the physical CPU. High steal can make the guest appear busy and slow even when no guest process explains all of the missing capacity. That result points toward host contention, VM sizing, or the provider layer rather than an application-only fix.

### How Do Virtual Memory and Physical RAM Differ?

Every process operates in a virtual address space. An address visible to the process is translated by the kernel and hardware into a physical page, a shared page, a file-backed page, a swapped page, or no committed physical page yet. `VIRT` or `VSZ` describes the virtual address range and is not a direct statement of RAM consumed.

Resident set size, or RSS, counts pages from the process that are currently in physical memory. RSS is more useful than virtual size, but shared pages can be counted in the RSS of several processes. Summing RSS across a server may therefore double-count shared libraries and shared mappings. Proportional set size, or PSS, divides shared pages across the processes using them and can give a fairer workload total.

Inspect one process in more detail:

```bash
pid=$(systemctl show app.service -p MainPID --value)
grep -E 'Rss|Pss|Private|Shared|Anonymous|Swap' "/proc/$pid/smaps_rollup"

# Example output:
# Rss:              512840 kB
# Pss:              470220 kB
# Shared_Clean:      68240 kB
# Private_Dirty:    420100 kB
# Anonymous:        418900 kB
# Swap:              16384 kB
```

File-backed pages come from executables, libraries, or mapped files. Clean copies can often be discarded and read again from the file. Anonymous pages hold heaps, stacks, and other data without a file copy; reclaim normally requires swap or process termination. Dirty file-backed pages must be written before their memory can be reused. These differences explain why two equal RSS values can produce different reclaim behavior.

Memory allocation can also be optimistic. A runtime may reserve a large virtual region before touching every page. Linux can accept an allocation and provide physical pages later, when the process actually writes. Severe pressure can therefore appear after the earlier allocation call looked successful. Diagnose resident growth and pressure over time, not only the application's reported reservation.

Page faults are the mechanism that connects an address to a usable page. A minor fault resolves without reading storage, perhaps by mapping an existing cached page or allocating a fresh zero-filled page. A major fault requires storage I/O and can add much more latency. Fault counts are not automatically errors; the rate, type, and workload effect decide whether they are normal demand paging or evidence of a working set that no longer fits.

On large multiprocessor systems, non-uniform memory access adds location. A CPU reaches nearby memory faster than memory attached to another NUMA node. A machine can have free RAM in total while one node is under pressure or a workload frequently crosses nodes. NUMA tools become relevant after the ordinary system-to-process investigation shows a placement-sensitive problem; they should not replace the basic model on a small VM.

### What Do Reclaim, Working Set, and Dirty Pages Explain?

The working set is the memory a workload actively needs over the time window that matters. A process can reserve gigabytes yet touch only a stable fraction. Conversely, many individually modest processes can create machine pressure when their combined active pages, kernel data, and cache exceed available RAM.

Linux reclaims memory by finding pages it can reuse. Clean file-backed cache is comparatively cheap to discard. Dirty file-backed pages must be written to storage. Anonymous pages may move to swap when swap exists. Kernel slab objects have their own reclaim behavior. The `available` estimate in `free` considers memory the kernel expects it can provide without swapping aggressively; it is more informative than `free`, but it remains an estimate rather than a guarantee.

Page cache is a performance feature. A read can be served from RAM after the data was cached, and writes can be combined before storage writeback. Dropping caches makes the `free` number larger by deliberately throwing away useful cached data, often causing slower future reads. It is normally a diagnostic experiment only under a controlled test, not a routine cure for memory pressure.

Buffers describe kernel bookkeeping and block-I/O-related data in traditional reports, while slab holds caches of kernel objects such as dentries and inodes. Slab growth can reflect legitimate filesystem or network activity, reclaimable caches, or an abnormal kernel-side consumer. `/proc/meminfo` separates fields such as `Slab`, `SReclaimable`, `SUnreclaim`, `Cached`, `Dirty`, and `Writeback` so the investigation can move beyond the single `buff/cache` summary.

Dirty pages create a CPU-memory-storage connection. An application can write quickly into RAM until writeback must push those pages to storage. If the device cannot keep up, dirty data accumulates, reclaim becomes harder, and the kernel can throttle writers. A “memory” slowdown may therefore be storage latency appearing through reclaim and writeback.

Pressure stall information measures time during which tasks cannot make progress because CPU, memory, or I/O resources are contended. Inspect it directly when available:

```bash
cat /proc/pressure/cpu
cat /proc/pressure/memory
cat /proc/pressure/io

# Example output:
# some avg10=12.40 avg60=6.21 avg300=2.10 total=91827364
# full avg10=1.02 avg60=0.41 avg300=0.12 total=1827364
```

Utilization describes occupancy; PSI describes lost progress. Two systems can show the same memory utilization while one reclaims clean cache smoothly and the other repeatedly stalls all useful work. CPU pressure can be high even before a CPU graph is pinned if runnable tasks spend meaningful time waiting. Monitor both occupancy and pain.

### When Is Swap Healthy and When Is It Thrashing?

Swap is storage used as a backing place for memory pages. Some swap consumption is not proof of a current problem. Linux may have moved cold anonymous pages out earlier and left them there while active work fits comfortably in RAM. `free` tells you capacity; `vmstat` `si` and `so` show current movement.

Thrashing occurs when the active working set does not fit and the machine repeatedly exchanges needed pages between RAM and storage. Symptoms include sustained swap-in and swap-out, major faults, I/O pressure, low useful CPU progress, and severe latency. The dangerous condition is activity and stalled work, not a nonzero “swap used” number.

`swappiness` influences reclaim preference; it is not a percentage of RAM at which swapping begins. Disabling swap removes one recovery option and can turn pressure into an earlier OOM kill. Enabling a small swap area can provide time to observe and recover from a transient spike, but it cannot make an undersized machine fast. Capacity, working-set reduction, process isolation, and application behavior are the long-term levers.

If reclaim cannot free enough pages, the kernel invokes the out-of-memory killer to recover the machine. Selection considers more than the largest resident process; memory use, adjustment scores, protection, and the scope of the OOM event influence the choice. Read kernel evidence instead of guessing:

```bash
journalctl -k --since '2 hours ago' --no-pager |
  grep -Ei 'out of memory|oom-kill|killed process'
cat /proc/1842/oom_score
cat /proc/1842/oom_score_adj
```

A cgroup or systemd `MemoryMax=` limit can cause a workload-scoped OOM even when the machine still has RAM. This is intentional isolation: one service reaches its boundary rather than consuming the whole host. Check both the unit's resource configuration and the kernel log. Repeatedly raising a limit without understanding growth can simply move the failure to the machine level.

### How Do You Distinguish a Leak from Legitimate Growth?

One memory snapshot cannot prove a leak. A service may warm caches, load a larger dataset, accept more connections, or temporarily buffer a batch. A leak is an allocation pattern that retains memory no longer needed, so the evidence is a rising baseline across comparable workload cycles and time.

A healthy cache-like pattern may climb during warm-up, level off, and sometimes fall under reclaim. Suspicious growth continues after traffic returns to normal, repeats after each workload cycle, and approaches a limit or OOM. Correlate RSS, PSS, anonymous memory, request volume, queue depth, process count, and release time. Runtime heap tools can then connect system evidence to objects or allocation paths.

Process count matters. A deployment that starts fifty workers instead of five may multiply ordinary per-process overhead until the host is pressured even though no single process looks enormous. Rank memory and count workload members separately. Threads also reserve stacks and add scheduler work; unbounded thread growth can hurt both resources.

### How Do the Main Diagnostic Branches Differ?

Start at the machine, move to the workload, then inspect the process. That order avoids profiling one visible process while the real cause is VM steal, storage wait, or the combined footprint of many workers.

For CPU constraint, confirm low idle time, high user or system time, a runnable queue relative to CPU count, and CPU pressure. Rank processes, connect the owner to traffic or scheduled work, then profile the responsible code or move competing work. Scaling capacity can relieve the incident, but it does not explain an unexpected regression.

For memory constraint, confirm low available memory, reclaim or swap activity, memory PSI, major faults, or an OOM event. Rank resident consumers, inspect workload totals and cgroup limits, then distinguish stable working set from growth. Stop or limit expendable work before repeatedly restarting the primary service.

For high load without CPU saturation, inspect blocked tasks, I/O wait, device latency, network storage, and process states. A task in uninterruptible sleep cannot be made faster by adding CPU. The disk and I/O investigation owns that branch.

For a machine that looks healthy while users report latency, narrow the time window. Inspect the dependency path, application queues, locks, network calls, garbage-collection pauses, and tail latency. Machine-wide averages can hide one stalled endpoint.

The compact CPU model is capacity, runnable demand, and time spent. The compact memory model is working set, reclaimable pages, and pressure. They interact: reclaim and faults consume CPU, swap and dirty writeback wait on storage, and excessive concurrency creates both scheduling and memory overhead. Measure the interaction before assigning the incident to one graph.

### Which Raw Kernel Counters Support the Summary Tools?

`top`, `free`, `vmstat`, and `ps` summarize kernel counters. When a column needs explanation, inspect the underlying interfaces. `/proc/stat` contains cumulative CPU accounting by category, so two samples separated by an interval produce the percentages shown by monitoring tools. `/proc/loadavg` exposes load values plus runnable and total task counts. `/proc/meminfo` breaks memory into available, cached, anonymous, slab, dirty, writeback, page-table, swap, and many other categories.

```bash
head -5 /proc/stat
cat /proc/loadavg
grep -E 'MemAvailable|Cached|AnonPages|Slab|SReclaimable|Dirty|Writeback|Swap' /proc/meminfo
```

Cumulative counters require a difference over time. One raw CPU total since boot does not describe the current minute. This also explains the first line of some `vmstat` versions: it can represent averages since boot, while following lines represent the requested sample interval. Diagnose with the repeated lines.

`vmstat 5` can be read as a dependency map. `r` is work ready for CPU, `b` is tasks blocked in uninterruptible sleep, `si` and `so` are swap movement, `bi` and `bo` are block input and output, `in` is interrupts, `cs` is context switches, and the CPU columns divide time. Interpret simultaneous movement: high `r` with low idle means CPU queueing; high `b`, I/O traffic, and wait points toward storage; swap movement with poor progress indicates memory pressure.

`mpstat -P ALL 5` adds per-CPU distribution. One CPU can saturate because a single-threaded workload, interrupt affinity, or process affinity pins work while other CPUs stay idle. Machine-average CPU then looks moderate even though the constrained execution path has no spare capacity. Confirm whether the workload can parallelize before adding threads or CPUs.

### How Should Capacity Changes Be Evaluated?

Adding CPU raises service capacity only for work that can use it. A single serialized lock, one event-loop thread, or an external dependency can remain the bottleneck. Adding RAM helps when the useful working set or cache can use it and reduces harmful reclaim; it does not correct an unbounded leak. Adding swap increases backing capacity and recovery time but remains far slower than RAM for active pages.

Compare a capacity change with a matched workload and the same user-facing measures. CPU utilization may fall after doubling cores while latency remains unchanged because storage owns the delay. RSS may stay constant after adding RAM while page-cache hit rate improves. The operational outcome, queue, and pressure counters decide whether the change addressed the constraint.

Near saturation, protect headroom. Background compression, backups, report generation, and builds can be correct work that competes with latency-sensitive traffic. Schedule them outside peaks, place them in separate workers, or apply workload resource policy. The purpose is not to make every graph low; it is to ensure important work can make progress within its latency target.

### What Evidence Should You Preserve Before Intervention?

Record the host, time window, CPU count, load, repeated `vmstat`, memory summary, pressure files, top CPU and RSS processes, service restart history, and kernel OOM evidence. If a process is growing, preserve a short time series rather than only the last value. If VM steal is high, preserve the guest evidence and provider or host metrics for the same interval.

A restart resets process counters and memory shape. It may be the right availability action, but capture enough evidence first to distinguish a leak, traffic spike, oversized batch, worker-count change, cgroup limit, and machine-wide pressure. Repeated restarts without a hypothesis can hide the growth curve while users continue to experience the same cycle.

After intervention, rerun the exact probes. Confirm the request latency, runnable and blocked counts, swap movement, available memory, pressure, process ownership, and service logs. “The command succeeded” is not the same as “the resource bottleneck cleared.”

Monitoring should preserve both occupancy and pain. CPU percentage and memory used describe how much of a resource appears occupied. Runnable delay, memory PSI, swap movement, major faults, OOM events, and request latency describe whether work is losing progress. Alerting only on occupancy creates false alarms for healthy cache and misses short queues that harm tail latency.

Use baselines by workload and time. A nightly report can make high CPU expected while still competing incorrectly with traffic. A language runtime can hold a stable large heap without leaking. Compare the incident with the same service, release, traffic band, worker count, and scheduled-work window. Then make the causal claim falsifiable: if the report job owns contention, pausing or isolating it should reduce runnable pressure and latency while other conditions remain comparable.

The sentence to remember is that CPU trouble is demand waiting for execution capacity, while memory trouble is an active working set forcing costly reclaim or failure. Percentages are clues; queues, movement, stalls, and workload ownership reveal the mechanism.

One final example combines the model. A four-CPU VM shows load `10`, user CPU near `90%`, `r=9`, no swap movement, and one report process at `350%`. That is runnable demand competing for CPU, not a memory incident. The immediate choices are to stop or isolate the report and preserve service headroom; the permanent choices involve scheduling, resource control, parallel efficiency, and capacity. If the same load appears with idle CPU, `b=8`, high `wa`, and device latency, the queue is blocked below the CPU and belongs to storage diagnosis. If CPU is moderate but `si` and `so` remain active, memory PSI rises, and requests fault from disk, the working set is forcing reclaim. The load number did not change meaning by itself; the surrounding evidence identified which work could not progress.

Use that comparison when reading dashboards. A resource graph is a measurement, not a cause. Ask which tasks are queued, which pages are moving, which component owns them, and whether user work improved after the selected action.

Keep CPU and memory samples on the same clock as application latency and deployment events. Without a shared time window, a top process observed after the incident may be blamed for pressure it did not create. Evidence supports a causal claim only if the resource mechanism, workload, and user effect overlap.

Repeat measurements after traffic returns to baseline. A transient spike and a sustained capacity gap can produce the same peak while requiring different changes. Duration, recurrence, and recovery show whether the system drained its queue or remained close to saturation.

## Check Your Answers

:::expand[What Does a CPU and Memory Investigation Measure?]{kind="recap"}
Begin with machine capacity, queues, progress, available memory, reclaim, and workload ownership rather than one busy process.
:::

:::expand[How Does Linux Account for CPU Time?]{kind="recap"}
CPU accounting separates user work, kernel work, idle time, I/O wait, interrupts, and VM steal across a sample.
:::

:::expand[What Does Load Average Count?]{kind="recap"}
Load is a smoothed task count that includes runnable work and some blocked work, so compare it with CPUs and states.
:::

:::expand[How Should You Read Free and Available Memory?]{kind="recap"}
Available memory estimates reclaimable room; virtual size, RSS, PSS, shared pages, and working set answer different questions.
:::

:::expand[Why Does Linux Use RAM for Cache and Kernel Data?]{kind="recap"}
Cache accelerates files, slab holds kernel objects, and dirty pages connect RAM pressure to storage writeback.
:::

:::expand[When Do Swap and Memory Pressure Become Problems?]{kind="recap"}
Swap capacity is not the failure; repeated page movement, stalls, major faults, and OOM evidence reveal real pressure.
:::

:::expand[How Does `vmstat` Connect CPU, Memory, and I/O?]{kind="recap"}
Repeated samples connect runnable and blocked tasks, swap traffic, device traffic, and CPU time in one view.
:::

:::expand[Which Processes Use Resources and How Do You Respond?]{kind="recap"}
Move from system to workload to process, preserve time-series evidence, and choose the action that matches the constrained branch.
:::

![CPU and memory summary infographic showing CPU buckets, load versus cores, available memory, page cache, swap traffic, and OOM clues](/content-assets/articles/article-devops-foundation-linux-system-admin-cpu-memory/cpu-memory-summary.png)

_The summary image gathers the CPU and memory clues operators should compare before taking action._

## References

- [Linux `proc(5)` manual](https://man7.org/linux/man-pages/man5/proc.5.html) - Documents `/proc/meminfo`, `/proc/loadavg`, and process status files.
- [Linux `top(1)` manual](https://man7.org/linux/man-pages/man1/top.1.html) - Documents live CPU and memory process display.
- [Linux `free(1)` manual](https://man7.org/linux/man-pages/man1/free.1.html) - Documents memory reporting and the available column.
- [Linux `vmstat(8)` manual](https://man7.org/linux/man-pages/man8/vmstat.8.html) - Documents virtual memory statistics.
- [Linux `ps(1)` manual](https://man7.org/linux/man-pages/man1/ps.1.html) - Documents process snapshot fields.
- [systemd resource control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html) - Documents systemd CPU and memory resource controls.
