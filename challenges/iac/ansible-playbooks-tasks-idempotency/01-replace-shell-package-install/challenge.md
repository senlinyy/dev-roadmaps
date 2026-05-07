---
title: "Replace Shell Package Install"
sectionSlug: "desired-state-in-real-tasks"
order: 1
---

Replace the shell-shaped nginx install with an idempotent Ansible package task.

Requirements:

1. **Module:** use `ansible.builtin.apt`.
2. **Package:** `name: nginx`.
3. **State:** `state: present`.
4. **Cache:** `update_cache: true`.
5. **Do not use:** `ansible.builtin.shell` for package install.
