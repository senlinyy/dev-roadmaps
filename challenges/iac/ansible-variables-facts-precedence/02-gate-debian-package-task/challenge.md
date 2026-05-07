---
title: "Gate Debian Package Task"
sectionSlug: "conditionals-with-variables-and-facts"
order: 2
---

Make the apt task run only on Debian-family hosts.

Requirements:

1. **Task:** install `nginx` with `ansible.builtin.apt`.
2. **Condition:** `when: ansible_facts.os_family == "Debian"`.
