---
title: "Repair the Nightly Cleanup"
sectionSlug: a-nightly-cronjob
order: 2
---

The stale-delivery cleanup CronJob has an approved workload identity and image, but its scheduling and finite-run contracts are absent. Build the outer schedule policy and nested Job and Pod behavior without changing the approved cleanup image.

Your job:

1. **Build a daily schedule contract** with cron expression `15 2 * * *` and time zone `Etc/UTC`.
2. **Prevent overlapping runs** with policy `Forbid` and allow a missed run to start within `900` seconds.
3. **Retain three successful and three failed Jobs**, and build child Job behavior with backoff limit `2` and restart policy `Never`.
4. **Build the cleanup command contract** for container `cleanup` from `ghcr.io/customer-notification/notification-worker:2026.06.14-2` so `node` receives argument `scripts/expire-stale-deliveries.js`.

The grader checks the CronJob schedule, overlap policy, history, and nested Job template.
