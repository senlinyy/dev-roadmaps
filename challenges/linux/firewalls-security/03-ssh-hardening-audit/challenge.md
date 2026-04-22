---
title: "Audit sshd_config for Hardening Violations"
sectionSlug: ssh-hardening
order: 3
---

A new server `polaris-bastion-03` was provisioned from a stale Ubuntu image and the security team flagged it in the weekly audit. Your job is to read `/etc/ssh/sshd_config` and find the three default settings that violate the hardening baseline:

- Root must not be allowed to log in over SSH (`PermitRootLogin no`).
- Password authentication must be off (`PasswordAuthentication no`); only public keys are allowed.
- The daemon must not listen on the default port 22 (use a non-standard port like 2222 to drop scanner noise).

You start in `/home/dev`. Your job:

1. **Read the active sshd config** with `cat /etc/ssh/sshd_config`.
2. **Show the `PermitRootLogin` setting** with `grep "PermitRootLogin" /etc/ssh/sshd_config`.
3. **Show the `PasswordAuthentication` setting** with another `grep`.
4. **Show the `Port` directive** by grepping for `^Port`.

The grader requires you to use `cat` and `grep`, and checks that your combined output mentions `PermitRootLogin yes`, `PasswordAuthentication yes`, and `Port 22`.
