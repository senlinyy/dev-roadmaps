---
title: "Read a Timer Unit"
sectionSlug: timers-cron-without-the-footguns
order: 6
---

Systemd timers are the modern replacement for cron. A timer unit (`.timer`) triggers a matching service unit (`.service`) on a schedule. Understanding the `OnCalendar=` and `OnBootSec=` directives tells you when a job will run.

You start in `/home/dev`. Your job:

1. **Read the timer unit** at `/etc/systemd/system/backup.timer` and identify its schedule.
2. **Read the matching service** at `/etc/systemd/system/backup.service` to see what the timer actually runs.
3. **Find all timer units** by listing `/etc/systemd/system/` and grepping for `.timer` files.
4. **Check the cleanup timer** to find which directive schedules it relative to boot time.

The grader requires you to use `cat`, `ls`, and `grep`, and your combined output must contain "OnCalendar", "daily", "OnBootSec", and "backup.sh".
