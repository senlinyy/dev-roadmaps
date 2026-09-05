---
title: "App Won't Start"
order: 1
---

The deployment finished, but `myapp` will not start. Its first error is `Permission denied reading /etc/myapp/config.json`. You start in `/home/dev`.

Your job:

1. **Inspect the failed service and its execution identity**, then inspect the configuration's ownership and mode.
2. **Restore access without changing the configuration contents.** Keep `root` as owner with read/write access, give the service's group read-only access, and give everyone else no access.
3. **Restart and verify `myapp`** after the repair.

The grader checks diagnostic evidence, restricted access, and the restarted service. Service inspection and restart use an authored identity and saved JSON configuration, not a real systemd process.
