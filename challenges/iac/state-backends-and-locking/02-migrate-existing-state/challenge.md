---
title: "Initialize and Migrate Existing State"
sectionSlug: initializing-and-migrating-state
order: 2
revision: 2
---

The reviewed backend configuration is present in `/workspace`, and the local state has one managed bucket. Reinitialize explicitly for migration, then plan against the migrated backend to verify no infrastructure change is proposed.

Your job:

1. **Initialize** with state migration enabled.
2. **Run** a plan after migration.
3. **Confirm** the plan reports zero additions, changes, and destroys.

The grader checks the command workflow and resulting Terraform state, not a prose explanation.
