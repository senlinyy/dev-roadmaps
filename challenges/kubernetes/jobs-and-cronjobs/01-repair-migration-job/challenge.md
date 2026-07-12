---
title: "Repair the Migration Job"
sectionSlug: add-command-configuration-and-runtime-limits
order: 1
---

The release migration manifest has the approved workload identity and image, but it does not define the finite execution contract. Build the Job and container blocks needed for one bounded, auditable database migration.

Your job:

1. **Keep Job `notification-add-provider-status-20260614`** in namespace `notifications` and container image `ghcr.io/customer-notification/notification-api:2026.06.14-2`.
2. **Build the migration command contract** so `node` receives arguments `scripts/migrate-notifications.js` and `--operation=provider-status-20260614`.
3. **Build bounded completion behavior** with restart policy `Never`, backoff limit `2`, active deadline `900`, and finished Job TTL `86400`.

The grader checks the parsed Job command, completion behavior, retry budget, deadline, and cleanup window.
