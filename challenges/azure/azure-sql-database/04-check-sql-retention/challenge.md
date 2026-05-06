---
title: "Check SQL Retention"
sectionSlug: backups-matter-only-if-restore-is-usable
order: 4
---

The release record for a data migration needs SQL recovery evidence. Use Azure CLI evidence for database `sqldb-devpolaris-orders-prod` on server `sql-devpolaris-orders-prod` in `rg-devpolaris-data-prod`.

Your job:

1. **Inspect** the database backup-retention-related fields.
2. **Inspect** the long-term retention policy.
3. **Keep** the evidence tied to the named server and database.

The grader checks for the database name, short-term retention, and long-term policy values.
