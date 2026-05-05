---
title: "Create Secret Metadata"
sectionSlug: secrets-manager-store-secrets-with-a-lifecycle
order: 4
---

The orders API needs a database URL in production. Store practice value `postgres://orders-prod-redacted` as secret `/devpolaris/orders-api/prod/database-url` with tags `service=devpolaris-orders-api` and `env=prod`, then inspect the secret metadata instead of printing the value.

Your job:

1. **Create the secret** with the requested name and tags.
2. **Inspect the secret metadata** so the name, ARN, and tags are visible.

The grader checks the simulated AWS state and your metadata output. It does not require you to print the secret value.
