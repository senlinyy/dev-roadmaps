---
title: "Centralize Names and Tags"
sectionSlug: consuming-locals-in-resources
order: 1
revision: 2
---

The orders stack repeats its environment-aware name and ownership tags across resources. Replace that repetition with locals so future policy changes have one review point.

Your job:

1. **Build** local `name_prefix` from `orders` and `var.environment`.
2. **Build** local `common_tags` with Service, Environment, and ManagedBy values.
3. **Use** the prefix and tag map in both the logs bucket and queue resources.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
