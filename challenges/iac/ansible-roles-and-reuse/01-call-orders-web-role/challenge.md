---
title: "Call Orders Web Role"
sectionSlug: "calling-the-role-from-playbooks"
order: 1
---

The orders web tasks have moved into a role. Update the play so the playbook targets the right host group and calls the reusable role instead of carrying empty inline tasks.

Your job:

1. **Target the orders web inventory group** for this play.
2. **Keep privilege escalation enabled** because the role manages system files and services.
3. **Call the orders web role** from the play's role list.

The grader checks the playbook structure, not command output.
