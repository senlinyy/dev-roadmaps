---
title: "Audit sshd_config for Hardening Violations"
sectionSlug: ssh-hardening
order: 3
---

A new server `polaris-bastion-03` was provisioned from a stale Ubuntu image and the security team flagged it in the weekly audit. Compare `/etc/ssh/sshd_config` against the SSH-hardening practices from the article, then write the remediation note you would send back to the image owner.

You start in `/home/dev`. Your job:

1. **Inspect the active sshd configuration** at `/etc/ssh/sshd_config`.
2. **Surface the directives that control root login, password authentication, and the SSH listening port**.
3. **Write `/home/dev/reports/sshd-remediation.note`** with the current value and the corrected hardened value for each directive.
4. **Print the remediation note** so the handoff is visible in the terminal history.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your note includes `PermitRootLogin yes -> no`, `PasswordAuthentication yes -> no`, and `Port 22 -> 2222`.
