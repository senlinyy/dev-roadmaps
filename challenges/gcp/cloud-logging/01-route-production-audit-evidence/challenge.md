---
title: "Route Production Audit Evidence"
sectionSlug: log-router-sinks-and-retention
order: 1
---

Complete the Log Router sink contract that exports production administrative audit logs from `devpolaris-prod` to the locked audit bucket.

The filter must keep only `cloudaudit.googleapis.com/activity` entries from the production project. Use a unique writer identity so the destination can grant the sink only the permission it needs.
