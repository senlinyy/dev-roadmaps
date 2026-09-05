---
title: "Make Maintenance Less Disruptive"
sectionSlug: how-do-identity-proc-priority-and-cgroups-describe-resources
order: 7
---

Start a one-off maintenance backup without stopping the orders service. The authored `backup-worker --once` command represents a long-running backup in this lab; it does not create a real archive.

You start in `/home/dev`. Your job:

1. Launch the backup in the background with initial nice value `10`.
2. Adjust the running backup to nice value `15`.
3. Set best-effort I/O class `2` with priority `7`.
4. Verify the backup's CPU nice value and I/O priority, leaving the orders worker unchanged.

The grader checks process evidence and final state, not copied output. This terminal uses simulated processes; no host processes are affected.

