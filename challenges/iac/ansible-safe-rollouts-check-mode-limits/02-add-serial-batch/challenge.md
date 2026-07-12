---
title: "Add Serial Batch"
sectionSlug: "use-serial-for-batches"
order: 2
---

The production play should not restart the whole orders web fleet at once. Add a play-level batch boundary so the role completes on one host before Ansible moves to the next host.

Your job:

1. **Keep the play targeted** at the `orders_web` group.
2. **Process one host at a time** with the play's serial setting.
3. **Keep the orders web role call** in place.

The grader checks the parsed playbook structure, not command output.
