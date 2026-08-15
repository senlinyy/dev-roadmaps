---
title: "Shape Resource Values with Expressions"
sectionSlug: functions-that-shape-strings-maps-and-lists
order: 1
revision: 2
---

Callers supply environment names with inconsistent casing and spacing. Normalize the input once, build a bounded bucket name, and merge required tags with caller tags before resource creation.

Your job:

1. **Create** local `environment` with `lower(trimspace(var.environment))`.
2. **Create** local `bucket_name` with `substr(format("dp-orders-%s", local.environment), 0, 63)`.
3. **Create** local `tags` by merging required Service and Environment tags with `var.extra_tags`.
4. **Use** the derived bucket name and tag map in `aws_s3_bucket.orders`.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
