---
title: "Read the DNF Transaction"
sectionSlug: how-does-dnf-manage-rpm-based-systems
order: 5
revision: 1
---

A Rocky Linux maintenance window is approaching. The operator needs a precise update preview, the source of the Nginx candidate, the enabled repository set, and proof that the current binary belongs to an RPM package.

You start in `/home/dev`. Your job:

1. **Preview the available updates** and read the nonzero update status as information, not a command failure.
2. **Inspect the Nginx candidate metadata.**
3. **List the enabled repositories** that can supply packages.
4. **Confirm RPM ownership** of `/usr/sbin/nginx`.

The grader checks all four pieces of transaction evidence without requiring an upgrade.
