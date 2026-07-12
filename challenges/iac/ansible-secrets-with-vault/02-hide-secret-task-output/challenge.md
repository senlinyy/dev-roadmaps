---
title: "Hide Secret Task Output"
sectionSlug: "using-vault-during-a-run"
order: 2
---

The environment file task renders a secret-bearing template. Tighten the remote file permissions and make the task keep decrypted values out of normal task output.

Your job:

1. **Render the existing environment template** to `/etc/default/devpolaris-orders-api`.
2. **Restrict the rendered file mode** to `0640`.
3. **Hide the task's arguments and result output** because the template contains secrets.

The grader checks the task fields, not command output.
