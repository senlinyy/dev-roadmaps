---
title: "Rename customer data without breaking the old release"
sectionSlug: rename-customer-data-without-breaking-the-old-release
order: 4
revision: 1
---

## Description

Orders stores customer names in a small PostgreSQL `customers` table. Version 2 needs `display_name`, while version 1 will continue writing `name` during rollout. The proposed immediate column rename would break old instances and remove a safe rollback path.

As the application engineer, prepare an expand-and-contract migration that supports the mixed-version period before any destructive change.

## Requirements

1. **Additive Expansion**. Add the new representation without removing the existing column or breaking version 1 queries.
2. **Write Compatibility**. Keep `name` as the write authority during coexistence and ensure old writes populate the new column.
3. **Backfill and Reads**. Backfill existing rows and provide a compatible read query that works before and after backfill.
4. **Delayed Contract**. Place the destructive contract phase in a separately approved file. Drop the old column only after old binaries and writers are retired, never in the expansion deployment.

:::expand[Workspace and verification]{kind="note"}

Editable files: `db/expand.sql`, `db/read-customer.sql`, `db/contract.sql`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
