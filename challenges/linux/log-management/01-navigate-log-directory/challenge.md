---
title: "Navigate the Log Directory"
sectionSlug: where-logs-actually-live
order: 1
---

Every Linux service writes its logs somewhere under `/var/log/`. Understanding which file belongs to which service is the first step in any troubleshooting workflow. Some services get their own subdirectory; others share `syslog`.

You start in `/home/dev`. Your job:

1. **List all files and directories under `/var/log/`** to see what is available.
2. **Find which log file contains SSH authentication activity** by searching for "sshd" across the log files.
3. **View the most recent syslog entries** using `tail` on the syslog file.
4. **Identify which services wrote to syslog** by reading the file and looking for service names like cron, sshd, and nginx.

The grader requires you to use `cat` and `grep` at least once each, and checks that your combined output mentions `auth.log`, `syslog`, `sshd`, `cron`, and `nginx`.
