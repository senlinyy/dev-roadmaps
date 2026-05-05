---
title: "Inspect Runtime Contract"
sectionSlug: how-ecs-delivers-values-to-the-container
order: 4
---

The image for `devpolaris-orders-api` is healthy in staging, but production still fails at startup. Inspect the runtime contract for task definition `devpolaris-orders-api:42` and confirm the secret metadata for `/devpolaris/orders-api/prod/database-url`.

Your job:

1. **Inspect the task definition** for `devpolaris-orders-api:42`.
2. **Find the runtime values** that are ordinary environment variables versus secret references.
3. **Inspect the secret metadata** without printing the secret value.

The grader checks AWS runtime contract evidence, not a written explanation.
