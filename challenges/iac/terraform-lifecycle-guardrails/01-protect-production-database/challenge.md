---
title: "Protect a Production Database"
sectionSlug: lifecycle-for-guardrails-and-replacement-behavior
order: 1
revision: 2
---

The production database must never be destroyed by an ordinary plan, and a replacement should create the successor before removing the old instance. Add both lifecycle guardrails to the managed resource.

Your job:

1. **Add** a lifecycle block inside `aws_db_instance.orders`.
2. **Set** `prevent_destroy` to true.
3. **Set** `create_before_destroy` to true.
4. **Keep** the database identifier and engine unchanged.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
