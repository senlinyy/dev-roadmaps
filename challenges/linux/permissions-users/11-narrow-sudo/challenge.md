---
title: "Give Access Without Giving Root"
sectionSlug: how-does-sudo-grant-least-privilege-and-how-do-you-debug-denials
order: 11
revision: 1
---

The deployment account needs to restart only `app.service`. It currently has no sudo rule. Granting a shell, all of `systemctl`, or a wildcard would turn a small operational need into broad root access.

You are logged in as `deploy`. Your job:

1. **Inspect the current sudo policy** for the deployment account.
2. **Create `/etc/sudoers.d/app-deploy` through a privileged writer** with one exact passwordless restart command.
3. **Set the policy file to mode `0440` and validate its syntax.**
4. **List the final sudo policy** and confirm that no broader command was granted.

The grader checks the exact rule, root ownership, secure file mode, syntax-validation workflow, and least-privilege policy state.
