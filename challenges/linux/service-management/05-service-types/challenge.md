---
title: "Identify Service Types"
sectionSlug: service-types-and-what-active-means
order: 5
---

The `Type=` directive in a unit file tells systemd how the service signals readiness. Getting it wrong means systemd thinks a service is ready before it actually is, or waits forever for a notification that never comes.

You start in `/home/dev`. Your job:

1. **Read the unit file** at `/etc/systemd/system/api.service` and identify its `Type=` value.
2. **Read the unit file** at `/etc/systemd/system/worker.service` and identify its `Type=` value.
3. **Find the unit that uses `Type=oneshot`** by grepping across all unit files in `/etc/systemd/system/`.
4. **Check the status file** at `/var/run/api.status` to see what readiness mechanism the API uses.

The grader requires you to use `cat` and `grep`, and your combined output must contain the words "notify", "simple", "oneshot", and "READY=1".
