---
title: "Package Upgrade Broke Production"
order: 4
---

The API stopped starting after package automation ran. The `api-agent` package was updated, but both release versions remain available in its configured repository. You start in `/home/dev`.

Your job:

1. **Inspect the API journal and package versions** before changing the installation.
2. **Restore the supported release identified by the service evidence** without removing the package or disabling its repository.
3. **Prevent automatic upgrades of this package** until the compatibility issue is resolved.
4. **Restart and verify `api`** using the restored version.

The grader checks version inspection, the installed version, its hold, and the restarted service. Package selection and service behavior are simulated; no repository downloads occur.
