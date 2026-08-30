---
title: "Managed or Manually Installed?"
sectionSlug: what-does-a-package-manager-record-and-resolve
order: 1
revision: 1
---

An inherited web server contains the expected Nginx binary and an internal `ordersctl` utility. Before planning updates, you need to establish which software is visible to the operating system package inventory.

You start in `/home/dev`. Your job:

1. **Identify the installed package** that owns `/usr/sbin/nginx`.
2. **Inspect that package's recorded version, origin, and purpose.**
3. **Locate `ordersctl` through command resolution** and note why its `/usr/local` location deserves separate provenance checks.

The grader checks the package ownership evidence, recorded version, and unmanaged command location.
