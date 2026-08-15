---
title: "Compose Two Service Plays"
sectionSlug: hosts-plays-tasks-and-modules
order: 1
revision: 2
---

Create one playbook that configures the database tier before the web tier. Each play must target its own inventory group, apply privilege escalation, and use purpose-built modules for the desired package and service states.

Work across the provided files as needed. The grader checks the resulting Ansible project, including relationships between files, rather than matching a sample answer.
