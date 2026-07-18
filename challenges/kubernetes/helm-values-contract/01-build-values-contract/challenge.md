---
title: "Build the Production Values Contract"
sectionSlug: values-schema-validation
order: 1
---

The orders chart accepts loosely shaped values and hardcodes its image. Build a reviewable values contract across the production values, schema, and Deployment template.

Your job:

1. **Set three replicas** and image repository `registry.example.com/orders-api` with tag `2.6.0` in `values.yaml`.
2. **Require `replicaCount` and `image`** in the schema, with replica minimum 1 and non-empty repository/tag strings.
3. **Render replicas, repository, and tag from values** in the Deployment template.
4. **Read `DATABASE_URL` from Secret `orders-runtime`, key `database-url`**, not from values.

The grader checks all three files and rejects a literal database URL in the values file.
