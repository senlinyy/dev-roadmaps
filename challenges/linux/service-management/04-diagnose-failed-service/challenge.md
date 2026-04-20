---
title: "Diagnose a Failed Service"
sectionSlug: failure-modes-you-will-hit
order: 4
---

When a service fails, your first move is reading the journal log to find the error, then cross-referencing the unit file to understand what went wrong. This system has a broken service that refuses to start.

You start in `/home/dev`. Your job:

1. **Read the journal log** at `/var/log/broken-journal.log` to see the failure messages.
2. **Find the exit status code** by grepping the log for `status`.
3. **Read the unit file** at `/etc/systemd/system/broken.service` to find the `ExecStart` path that failed.
4. **Spot the missing dependency**: the unit file uses `After=postgresql.service` but never declares `Requires=`, so postgresql could be down when broken.service starts.

The grader requires you to use `cat` and `grep`, and checks that your output contains the error message, the exit status, the binary path, and the After directive.
