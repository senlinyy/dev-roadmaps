---
title: "Make a Configuration Change Effective"
sectionSlug: how-do-unit-definitions-become-effective-configuration
order: 3
---

A package owns the orders unit under `/usr/lib`. The next release needs a different environment source, but editing the vendor file would make the local change fragile. You start in `/home/dev`.

Your job:

1. Inspect the unit and any overrides before changing them.
2. Create `/etc/systemd/system/orders.service.d/override.conf` so `/etc/orders/release.env` replaces the old environment-file list. Do not change the vendor unit or either environment file.
3. Load the override and replace the process so it receives the new environment.
4. Verify the effective environment-file path and main PID, then inspect the current process environment for `PORT=4000`, `LOG_LEVEL=debug`, and `RELEASE=v2`.

The grader checks the vendor file is preserved, the new definition is loaded, and the live process received the release settings. `cat` shows disk files; `show` describes loaded settings.
