---
title: "Implement Safe Structured Logging"
sectionSlug: json-logs-and-discovered-fields
order: 2
---

Implement createLogRecord for the orders API. Emit one JSON-ready object with timestamp, level, service, environment, requestId, route, outcome, durationMs, and optional error name. Validate the level and required correlation fields. Never copy request bodies, authorization headers, passwords, tokens, or arbitrary extra fields into the record. The provided tests verify searchable fields, deterministic timestamp injection, and secret exclusion.
