---
title: "Resolve a Held Dependency"
sectionSlug: what-does-a-package-manager-record-and-resolve
order: 3
revision: 1
---

Installing `app-server` fails because it needs `libfoo` 2.0 or newer, while the host keeps an older `libfoo` release on hold. A compatible candidate is available from the configured repository.

You start in `/home/dev`. Your job:

1. **Reproduce the failed installation** and read the dependency diagnosis.
2. **Compare the installed and candidate dependency versions.**
3. **Remove the stale hold** without removing the dependency.
4. **Retry the application install** and let the package manager resolve both packages.

The grader checks that you observed the conflict and reached a compatible installed state.
