---
title: "Patched on Disk, Old in Memory"
sectionSlug: how-do-security-updates-become-running-code
order: 8
revision: 1
---

A security advisory requires the approved OpenSSL build. Updating files on disk is only half the maintenance task because long-running services may still hold the old library in memory.

You start in `/home/dev`. Your job:

1. **Preview the available package update.**
2. **Upgrade only OpenSSL** to the approved security version.
3. **Inspect which services still need a restart** before declaring the host remediated.

The grader checks the installed security version and restart evidence for both affected services.
