---
title: "Prove Rotation and Reopening Work"
sectionSlug: how-does-rotation-keep-file-and-journal-logs-bounded
order: 6
---

This isolated fixture deliberately omits the automatic reopen hook so you can verify the two operations separately. You start in `/home/dev`; one forced rotation of `/etc/logrotate.d/nginx` is approved. Keep Nginx running and preserve its history.

1. **Rotate the authored Nginx logs exactly once**, without changing the policy.
2. **Send the log-reopen signal to the master identified by `/run/nginx.pid`**, without restarting or terminating it.
3. **Advance the simulated clock by five seconds** so the fixture produces a health request and a warning.
4. **Inspect the current and archived files with inode information**, then read new records from both current logs under `/var/log/nginx`.

The grader checks preserved old inodes, fresh writes to replacement files, ownership, and service state. Compressed archives use a virtual base64 container around gzip bytes; general extraction is not provided.
