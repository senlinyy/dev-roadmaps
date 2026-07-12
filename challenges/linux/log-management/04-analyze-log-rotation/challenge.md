---
title: "Audit Log Rotation"
sectionSlug: rotate-logs-with-logrotate
order: 4
---

Nginx logs grew faster than expected after a marketing launch. You start in `/home/dev`, and the rotation policy plus current log files are already exported.

Your job:

1. **Inspect the Nginx rotation policy** under `/etc/logrotate.d`.
2. **List the current and rotated Nginx logs** so you can compare policy with reality.
3. **Surface the retention and compression settings** from the policy.
4. **Surface the rotated file evidence** that proves rotation already ran.

The grader checks the policy and file evidence you print.
