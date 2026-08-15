---
title: "Extract an Orders Role"
sectionSlug: role-directory-structure
order: 1
revision: 2
---

Convert a monolithic playbook into a reusable `orders_web` role. The play should call the role, the role should render its own template and notify its own handler, and a safe port default should live under role defaults.

Work across the provided files as needed. The grader checks the resulting Ansible project, including relationships between files, rather than matching a sample answer.
