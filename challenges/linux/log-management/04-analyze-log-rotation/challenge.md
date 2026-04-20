---
title: "Analyze Log Rotation"
sectionSlug: rotating-logs-with-logrotate
order: 4
---

Without rotation, logs grow until they fill the disk. Logrotate automates compression and deletion on a schedule. Reading a logrotate config tells you how long history is kept, whether old logs are compressed, and how large files can grow before rotating.

You start in `/home/dev`. Your job:

1. **Read the nginx logrotate config** at `/etc/logrotate.d/nginx` and find how many days of logs it keeps.
2. **Check if compression is enabled** in the nginx config.
3. **Read the myapp logrotate config** at `/etc/logrotate.d/myapp` and identify the problems: too few rotations, no compression, and an oversized threshold.
4. **List the rotated nginx log files** under `/var/log/nginx/` to see the naming pattern in action.

The grader requires you to use `cat` and `ls` at least once each, and checks that your output includes key directives from both configs and the rotated filenames.
