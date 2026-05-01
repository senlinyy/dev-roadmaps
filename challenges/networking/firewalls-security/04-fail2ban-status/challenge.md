---
title: "Interpret a fail2ban Jail Status Against auth.log"
sectionSlug: automated-defense-with-fail2ban
order: 4
---

The SOC asked you to confirm fail2ban is actively blocking SSH brute-force traffic on `devpolaris-bastion-03`. You have three artifacts:

- `fail2ban-client status sshd`, the live jail status (run it directly, the runtime stubs the binary).
- `/etc/fail2ban/jail.local`, the SSH jail configuration (so you can confirm `maxretry`, `bantime`, and `findtime`).
- `/var/log/auth.log`: the syslog stream the jail watches.

Your job is to read the jail status, then prove the currently-banned IP shows up in `auth.log` with multiple failed SSH logins, then read the jail config to record the active thresholds.

You start in `/home/dev`. Your job:

1. **Check the live `sshd` jail status** so you can see which IP is currently banned and how many failures the jail observed.
2. **Trace that banned IP through `/var/log/auth.log`** and surface the failed SSH attempts that explain why it was blocked.
3. **Inspect `/etc/fail2ban/jail.local`** and surface the active ban thresholds the jail is using.

The grader requires you to use `fail2ban-client`, `grep`, and `cat`, and checks that your combined output mentions `Banned IP list`, `203.0.113.42`, `Failed password`, `maxretry`, and `bantime`.
