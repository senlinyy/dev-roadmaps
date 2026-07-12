---
title: "Replace Shell Package Install"
sectionSlug: "desired-state-modules"
order: 1
---

The orders web playbook still installs Nginx through a shell command. Replace that task with package desired state so a repeat run can settle cleanly.

Your job:

1. **Use the apt module** to manage the `nginx` package.
2. **Keep the package present** and refresh the package cache for this install task.
3. **Remove the shell-based package install** from the play.

The grader checks the parsed playbook structure, not command output.
