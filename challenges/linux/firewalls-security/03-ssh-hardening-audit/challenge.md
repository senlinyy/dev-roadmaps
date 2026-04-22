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

1. **Inspect the active sshd configuration** at `/etc/ssh/sshd_config` so you can compare it against the hardening baseline.
2. **Find the directive that controls root logins** and show the current value.
3. **Find the directive that controls password authentication** and show the current value.
4. **Find the SSH port directive** and show the value the daemon is actually listening on.

The grader requires you to use `cat` and `grep`, and checks that your combined output mentions `PermitRootLogin yes`, `PasswordAuthentication yes`, and `Port 22`.
