---
title: "Gate Debian Package Task"
sectionSlug: "facts-registered-results-and-set_fact"
order: 2
---

The package task uses the Debian apt module, so it should only run when the managed host facts say the host belongs to the Debian family. Add the condition without changing the package intent.

Your job:

1. **Keep the Nginx apt task** in the play.
2. **Gate the task with the OS family fact** for Debian hosts.
3. **Leave the condition at task level** so the module arguments stay focused on package state.

The grader checks the parsed playbook structure, not command output.
