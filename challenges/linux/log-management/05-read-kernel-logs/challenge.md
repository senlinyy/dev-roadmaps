---
title: "Read Kernel Logs"
sectionSlug: the-kernel-ring-buffer-with-dmesg
order: 5
---

The kernel maintains its own log in a fixed-size RAM ring buffer, separate from the application logs in journald and syslog. Hardware events, driver messages, and OOM kills all appear here. On a real system you read it with `dmesg`; in this environment the buffer is stored in a file.

You start in `/home/dev`. Your job:

1. **Read the kernel ring buffer** from `/var/log/dmesg` to see boot and runtime kernel messages.
2. **Find the OOM kill event** by grepping for "Out of memory" in the kernel log.
3. **Identify the disk error** by grepping for "error" to find hardware-related messages.

The grader requires you to use `cat` and `grep`, and your combined output must contain "Out of memory", "Killed process", "I/O error", and "sda".
