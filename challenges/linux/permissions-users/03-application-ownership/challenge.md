---
title: "Fix the Application's Ownership"
sectionSlug: how-do-ownership-changes-differ-from-mode-changes
order: 3
revision: 1
---

The `myapp` service starts successfully but cannot update its cache database. The parent directory already admits the service identity, so widening permissions across the application tree would hide the ownership mistake rather than repair it.

You start in `/home/dev`. Your job:

1. **Trace the pathname ownership and modes** for `/srv/myapp/data/cache.db`.
2. **Assign the cache database to the service account** without changing its existing mode.
3. **Test write access as `myapp`** and inspect the repaired file.

The grader checks ownership, preserved mode, and write access for the service identity.
