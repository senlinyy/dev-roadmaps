---
title: "Build the Order Events Schema"
sectionSlug: tables-rows-and-schemas
order: 2
---

Complete the BigQuery schema for immutable order events. Require `event_id`, `order_id`, `event_type`, and `occurred_at`; use `STRING`, `STRING`, `STRING`, and `TIMESTAMP` respectively. Add nullable `amount` as `NUMERIC` and nullable `attributes` as `JSON`. Keep exactly these six fields.

The grader parses the schema array and checks every name, type, and mode.
