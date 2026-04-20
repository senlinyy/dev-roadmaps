---
title: "Check Service Status"
sectionSlug: systemctl-verbs-you-will-type-every-day
order: 2
---

The `systemctl status` command is your first stop when checking whether a service is running. On a busy system, you also need to scan status dumps to find problems quickly.

You start in `/home/dev`. Your job:

1. **Run `systemctl status nginx`** to see the current state of the nginx service.
2. **Read the status dump** at `/var/log/systemd-status.txt` that lists all services on the system.
3. **Find which service has failed** by grepping the status dump for `failed`.
4. **Find which service is inactive** by grepping the status dump for `inactive`.

The grader requires you to use `systemctl` and `grep`, and checks that your combined output contains the active state, the failed service name, and the inactive service name.
