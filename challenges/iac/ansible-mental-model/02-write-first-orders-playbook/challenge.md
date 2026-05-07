---
title: "Write the First Orders Playbook"
sectionSlug: "the-first-orders-playbook"
order: 2
---

Complete `site.yml` so the first Ansible change targets the orders web hosts and installs nginx safely.

Requirements:

1. **Play target:** `hosts: orders_web`.
2. **Privilege:** `become: true`.
3. **Task:** install package `nginx` with `ansible.builtin.apt`.
4. **Package state:** `state: present` and `update_cache: true`.
