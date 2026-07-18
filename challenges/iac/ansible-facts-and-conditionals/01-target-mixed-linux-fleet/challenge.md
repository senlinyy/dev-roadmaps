---
title: "Target the Mixed Linux Fleet"
sectionSlug: a-mixed-linux-fleet-example
order: 1
---

The web role hardcodes the Debian package name and therefore fails on the Red Hat hosts in the same inventory. Make the task choose from observed host facts while staying limited to supported operating-system families.

Your job:

1. **Define package names for Debian and RedHat** in `web_package_by_os`.
2. **Install the package selected by `ansible_facts.os_family`** with `ansible.builtin.package`.
3. **Run the task only for Debian and RedHat families**.
4. **Keep the desired package state `present`**.

The grader checks the fact-driven lookup, supported-family condition, and package state.
